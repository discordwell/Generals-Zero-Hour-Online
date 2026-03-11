/**
 * AssetManager — central runtime asset loading subsystem.
 *
 * Implements the Subsystem interface from @generals/core. Orchestrates:
 *  - Manifest loading and indexed lookups
 *  - IndexedDB caching with hash-based invalidation
 *  - In-flight request deduplication
 *  - SHA-256 integrity verification
 *  - Streaming progress reporting
 */

import type { Subsystem } from '@generals/engine';
import type { AssetHandle, AssetManagerConfig, ProgressCallback } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { AssetFetchError, AssetIntegrityError, AssetNotFoundError, ManifestLoadError } from './errors.js';
import { sha256Hex } from './hash.js';
import { RuntimeManifest, loadManifest } from './manifest-loader.js';
import { CacheStore } from './cache.js';

export class AssetManager implements Subsystem {
  readonly name = 'AssetManager';

  private config: AssetManagerConfig;
  private manifest: RuntimeManifest | null = null;
  private cache: CacheStore | null = null;

  /** In-flight deduplication: path → pending Promise<ArrayBuffer>. */
  private readonly inflight = new Map<string, Promise<ArrayBuffer>>();

  constructor(config: Partial<AssetManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Subsystem lifecycle
  // ===========================================================================

  async init(): Promise<void> {
    const manifestUrl = this.resolveUrl(this.config.manifestUrl);

    // Load manifest. For app/runtime-integrated flows this can be strict.
    try {
      this.manifest = await loadManifest(manifestUrl);
      if (!this.manifest && this.config.requireManifest) {
        throw new ManifestLoadError(manifestUrl, 'HTTP 404');
      }
    } catch (error) {
      if (this.config.requireManifest) {
        throw error;
      }
      console.warn('AssetManager: manifest unavailable, proceeding without manifest.', error);
      this.manifest = null;
    }

    // Open IndexedDB cache
    if (this.config.cacheEnabled) {
      this.cache = new CacheStore(this.config.dbName, this.config.maxCacheSize);
      try {
        await this.cache.open();
      } catch {
        // IndexedDB may be unavailable (incognito, etc.) — continue without cache
        console.warn('AssetManager: IndexedDB unavailable, caching disabled.');
        this.cache = null;
      }
    }
  }

  update(_dt: number): void {
    // Assets are loaded on-demand, nothing to do per frame.
  }

  dispose(): void {
    this.cache?.close();
    this.cache = null;
    this.manifest = null;
    this.inflight.clear();
  }

  reset(): void {
    this.inflight.clear();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /** Whether the manifest was successfully loaded. */
  get hasManifest(): boolean {
    return this.manifest !== null;
  }

  /** Get the loaded RuntimeManifest (may be null). */
  getManifest(): RuntimeManifest | null {
    return this.manifest;
  }

  /**
   * Resolve a bare model name (e.g. "AVThundrblt_D1") to its manifest output path.
   * Strips any file extension, lowercases, and looks up in the basename index.
   * Returns the manifest outputPath on match, or null.
   */
  resolveModelPath(bareName: string): string | null {
    if (!this.manifest) return null;
    // Strip extension if present (e.g. "model.w3d" → "model")
    const dotIdx = bareName.lastIndexOf('.');
    const stripped = dotIdx > 0 ? bareName.slice(0, dotIdx) : bareName;
    const entry = this.manifest.getByBasenameLower(stripped);
    return entry?.outputPath ?? null;
  }

  /**
   * Load a JSON asset by output path.
   * Returns parsed JSON of type T.
   */
  async loadJSON<T = unknown>(path: string, onProgress?: ProgressCallback): Promise<AssetHandle<T>> {
    const raw = await this.loadRaw(path, onProgress);
    const text = new TextDecoder().decode(raw.data);
    const data = JSON.parse(text) as T;
    return { path: raw.path, data, hash: raw.hash, cached: raw.cached };
  }

  /**
   * Load a raw ArrayBuffer asset by output path.
   */
  async loadArrayBuffer(path: string, onProgress?: ProgressCallback): Promise<AssetHandle<ArrayBuffer>> {
    return this.loadRaw(path, onProgress);
  }

  /**
   * Load multiple assets in parallel with aggregate progress.
   */
  async loadBatch(
    paths: string[],
    onProgress?: ProgressCallback,
  ): Promise<AssetHandle<ArrayBuffer>[]> {
    let completedCount = 0;
    const totalCount = paths.length;

    const handles = await Promise.all(
      paths.map(async (path) => {
        const handle = await this.loadRaw(path);
        completedCount++;
        onProgress?.(completedCount, totalCount);
        return handle;
      }),
    );

    return handles;
  }

  // ===========================================================================
  // Core loading logic
  // ===========================================================================

  private async loadRaw(path: string, onProgress?: ProgressCallback): Promise<AssetHandle<ArrayBuffer>> {
    this.validatePath(path);
    const normalizedPath = this.normalizeAssetPath(path);

    const manifestEntry = this.manifest?.getByOutputPath(normalizedPath);
    const expectedHash = manifestEntry?.outputHash ?? null;

    // If manifest is loaded and integrity checks are on, require the path to be known
    if (this.manifest && this.config.integrityChecks && !manifestEntry) {
      throw new AssetNotFoundError(normalizedPath);
    }

    // 1. Check IndexedDB cache
    if (this.cache) {
      const cached = await this.cache.get(normalizedPath, expectedHash ?? undefined);
      if (cached) {
        onProgress?.(cached.size, cached.size);
        return { path: normalizedPath, data: cached.data, hash: cached.hash, cached: true };
      }
    }

    // 2. Fetch with in-flight deduplication (clone buffer to prevent detach issues)
    const shared = await this.fetchDeduped(normalizedPath, onProgress);
    const data = this.inflight.has(normalizedPath) ? shared.slice(0) : shared;

    // 3. Integrity check
    let actualHash: string | null = null;
    if (this.config.integrityChecks && expectedHash) {
      actualHash = await sha256Hex(data);
      if (actualHash !== expectedHash) {
        throw new AssetIntegrityError(path, expectedHash, actualHash);
      }
    }

    // 4. Cache write (fire-and-forget)
    if (this.cache && actualHash) {
      this.cache.put(normalizedPath, data, actualHash).catch((e) => console.warn('Cache write failed:', e));
    } else if (this.cache && !actualHash) {
      sha256Hex(data).then((hash) => {
        this.cache?.put(normalizedPath, data, hash).catch((e) => console.warn('Cache write failed:', e));
      }).catch((e) => console.warn('Hash computation for cache failed:', e));
    }

    return { path: normalizedPath, data, hash: actualHash, cached: false };
  }

  private fetchDeduped(path: string, onProgress?: ProgressCallback): Promise<ArrayBuffer> {
    const existing = this.inflight.get(path);
    if (existing) return existing;

    const promise = this.fetchAsset(path, onProgress).finally(() => {
      this.inflight.delete(path);
    });

    this.inflight.set(path, promise);
    return promise;
  }

  private async fetchAsset(path: string, onProgress?: ProgressCallback): Promise<ArrayBuffer> {
    const url = this.resolveUrl(path);
    let response: Response;

    try {
      response = await fetch(url);
    } catch {
      throw new AssetFetchError(path, 0);
    }

    if (!response.ok) {
      throw new AssetFetchError(path, response.status);
    }

    // Streaming progress if callback provided and content-length available
    if (onProgress && response.body) {
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > 0) {
        return this.readWithProgress(response.body, contentLength, onProgress);
      }
    }

    return response.arrayBuffer();
  }

  private async readWithProgress(
    body: ReadableStream<Uint8Array>,
    total: number,
    onProgress: ProgressCallback,
  ): Promise<ArrayBuffer> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(received, total);
    }

    // Concatenate chunks
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result.buffer as ArrayBuffer;
  }

  private validatePath(path: string): void {
    if (
      path.includes('..')
      || path.includes('\\')
      || path.startsWith('/')
      || /^[a-z]+:\/\//i.test(path)
      || /^[A-Za-z]:($|[\\/])/.test(path)
    ) {
      throw new AssetFetchError(path, 0);
    }
  }

  private normalizeRelativePath(path: string): string {
    return path
      .replace(/^(?:\.\/)+/, '')
      .replace(/^\/+/, '')
      .replace(/\/\.\//g, '/')
      .replace(/\/{2,}/g, '/');
  }

  private normalizeAssetPath(path: string): string {
    const normalizedPath = this.normalizeRelativePath(path);
    const basePrefix = this.basePathPrefix();
    if (basePrefix) {
      const normalizedPathLower = normalizedPath.toLowerCase();
      const basePrefixLower = basePrefix.toLowerCase();
      if (normalizedPathLower === basePrefixLower) {
        return '';
      }
      if (normalizedPathLower.startsWith(`${basePrefixLower}/`)) {
        return normalizedPath.slice(basePrefix.length + 1);
      }
    }
    return normalizedPath;
  }

  private basePathPrefix(): string | null {
    const base = this.config.baseUrl.trim();
    if (!base) return null;

    let basePath = base;
    if (/^[a-z]+:\/\//i.test(base)) {
      try {
        basePath = new URL(base).pathname;
      } catch {
        return null;
      }
    }

    const normalizedBasePath = this.normalizeRelativePath(basePath).replace(/\/+$/, '');
    return normalizedBasePath.length > 0 ? normalizedBasePath : null;
  }

  private resolveUrl(path: string): string {
    const base = this.config.baseUrl;
    if (!base) return path;

    // Absolute/protocol URLs bypass baseUrl prefixing.
    if (path.startsWith('/') || /^[a-z]+:\/\//i.test(path)) {
      return path;
    }

    const normalizedBase = base.replace(/\/+$/, '');
    const normalizedPath = this.normalizeRelativePath(path);
    const matchBase = normalizedBase.replace(/^\/+/, '');
    const matchPath = normalizedPath.replace(/^\/+/, '');
    const matchBaseLower = matchBase.toLowerCase();
    const matchPathLower = matchPath.toLowerCase();

    // If the path already starts with the base segment, don't double-prefix it.
    if (matchPathLower === matchBaseLower) {
      return normalizedBase;
    }
    if (matchPathLower.startsWith(`${matchBaseLower}/`)) {
      const suffix = matchPath.slice(matchBase.length + 1);
      return suffix.length > 0 ? `${normalizedBase}/${suffix}` : normalizedBase;
    }

    return `${normalizedBase}/${normalizedPath}`;
  }
}
