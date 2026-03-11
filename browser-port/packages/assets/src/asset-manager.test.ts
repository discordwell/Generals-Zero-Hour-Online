import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AssetManager } from './asset-manager.js';
import { AssetFetchError, AssetIntegrityError, AssetNotFoundError, ManifestLoadError } from './errors.js';
import { sha256Hex } from './hash.js';
import {
  DEFAULT_CONFIG,
  RUNTIME_ASSET_BASE_URL,
  RUNTIME_MANIFEST_FILE,
  RUNTIME_MANIFEST_PUBLIC_PATH,
} from './types.js';
import type { ConversionManifest } from '@generals/core';

// Helper: create a Response-like mock
function mockFetchResponse(body: string | ArrayBuffer, status = 200): Response {
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': String(data.byteLength) }),
    text: () => Promise.resolve(typeof body === 'string' ? body : new TextDecoder().decode(data)),
    arrayBuffer: () => Promise.resolve(data.buffer as ArrayBuffer),
    json: () => Promise.resolve(JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(data))),
    body: null, // Disable streaming in tests for simplicity
  } as unknown as Response;
}

function makeManifest(entries: ConversionManifest['entries']): ConversionManifest {
  return {
    version: 1,
    generatedAt: '2025-01-01T00:00:00.000Z',
    entryCount: entries.length,
    entries,
  };
}

function makeMapEntry(outputHash: string): ConversionManifest['entries'][0] {
  return {
    sourcePath: 'maps/Alpine.map',
    sourceHash: 'src-hash',
    outputPath: 'maps/Alpine.json',
    outputHash,
    converter: 'map-converter',
    converterVersion: '1.0.0',
    timestamp: '2025-01-01T00:00:00.000Z',
  };
}

describe('AssetManager', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  const mapJSON = JSON.stringify({ heightmap: { width: 64, height: 64 } });
  const runtimeBaseUrl = RUNTIME_ASSET_BASE_URL;
  const runtimeManifestUrl = RUNTIME_MANIFEST_PUBLIC_PATH;
  const runtimeIniBundleUrl = `${runtimeBaseUrl}/data/ini-bundle.json`;
  const runtimeMapUrl = `${runtimeBaseUrl}/maps/Alpine.json`;
  const mixedCaseRuntimeBaseUrl = 'Assets';
  const mixedCaseRuntimeManifestUrl = `${mixedCaseRuntimeBaseUrl}/${RUNTIME_MANIFEST_FILE}`;
  const mixedCaseRuntimeMapUrl = `${mixedCaseRuntimeBaseUrl}/maps/Alpine.json`;
  const cdnRuntimeBaseUrl = `https://cdn.example.com/${RUNTIME_ASSET_BASE_URL}`;
  const cdnRuntimeMapUrl = `${cdnRuntimeBaseUrl}/maps/Alpine.json`;
  const rootRuntimeBaseUrl = `/${RUNTIME_ASSET_BASE_URL}`;
  const rootRuntimeManifestUrl = `${rootRuntimeBaseUrl}/${RUNTIME_MANIFEST_FILE}`;
  const rootRuntimeMapUrl = `${rootRuntimeBaseUrl}/maps/Alpine.json`;
  const rootRuntimeDoubleManifestUrl = `${rootRuntimeBaseUrl}/${RUNTIME_MANIFEST_PUBLIC_PATH}`;
  let mapHash: string;

  beforeEach(async () => {
    mapHash = await sha256Hex(new TextEncoder().encode(mapJSON).buffer as ArrayBuffer);
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createManager(opts: {
    manifestEntries?: ConversionManifest['entries'];
    manifest404?: boolean;
    cacheEnabled?: boolean;
    integrityChecks?: boolean;
    requireManifest?: boolean;
  } = {}) {
    const {
      manifestEntries = [],
      manifest404 = false,
      cacheEnabled = false,
      integrityChecks = true,
      requireManifest = false,
    } = opts;

    const manifest = makeManifest(manifestEntries);

    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes(RUNTIME_MANIFEST_FILE)) {
        if (manifest404) {
          return Promise.resolve(mockFetchResponse('', 404));
        }
        return Promise.resolve(mockFetchResponse(JSON.stringify(manifest)));
      }
      if (typeof url === 'string' && url.includes('maps/Alpine.json')) {
        return Promise.resolve(mockFetchResponse(mapJSON));
      }
      return Promise.resolve(mockFetchResponse('', 404));
    });

    return new AssetManager({
      cacheEnabled,
      integrityChecks,
      requireManifest,
      dbName: 'test-am-' + Math.random(),
    });
  }

  describe('init', () => {
    it('keeps runtime manifest constants aligned with default config', () => {
      expect(RUNTIME_MANIFEST_PUBLIC_PATH).toBe(`${RUNTIME_ASSET_BASE_URL}/${RUNTIME_MANIFEST_FILE}`);
      expect(DEFAULT_CONFIG.manifestUrl).toBe(RUNTIME_MANIFEST_PUBLIC_PATH);
    });

    it('loads manifest on init', async () => {
      const am = createManager({ manifestEntries: [] });
      await am.init();
      expect(am.hasManifest).toBe(true);
      am.dispose();
    });

    it('sets hasManifest=false on 404', async () => {
      const am = createManager({ manifest404: true });
      await am.init();
      expect(am.hasManifest).toBe(false);
      am.dispose();
    });

    it('throws when manifest is required and missing', async () => {
      const am = createManager({ manifest404: true, requireManifest: true });
      await expect(am.init()).rejects.toThrow(ManifestLoadError);
      am.dispose();
    });

    it('throws when manifest is required and has duplicate output paths', async () => {
      const duplicateOutputEntries: ConversionManifest['entries'] = [
        makeMapEntry(mapHash),
        {
          sourcePath: 'maps/Another.map',
          sourceHash: 'src-hash-2',
          outputPath: 'maps/Alpine.json',
          outputHash: 'other-hash',
          converter: 'map-converter',
          converterVersion: '1.0.0',
          timestamp: '2025-01-01T00:00:00.000Z',
        },
      ];
      const am = createManager({ manifestEntries: duplicateOutputEntries, requireManifest: true });
      await expect(am.init()).rejects.toThrow(ManifestLoadError);
      am.dispose();
    });
  });

  describe('loadJSON', () => {
    it('loads and parses JSON', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      const handle = await am.loadJSON<{ heightmap: { width: number } }>('maps/Alpine.json');
      expect(handle.data.heightmap.width).toBe(64);
      expect(handle.path).toBe('maps/Alpine.json');
      expect(handle.cached).toBe(false);

      am.dispose();
    });
  });

  describe('loadArrayBuffer', () => {
    it('loads raw ArrayBuffer', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      const handle = await am.loadArrayBuffer('maps/Alpine.json');
      const text = new TextDecoder().decode(handle.data);
      expect(text).toBe(mapJSON);

      am.dispose();
    });
  });

  describe('integrity checks', () => {
    it('passes when hash matches', async () => {
      const am = createManager({
        manifestEntries: [makeMapEntry(mapHash)],
      });
      await am.init();

      const handle = await am.loadJSON('maps/Alpine.json');
      expect(handle.hash).toBe(mapHash);

      am.dispose();
    });

    it('throws AssetIntegrityError on hash mismatch', async () => {
      const am = createManager({
        manifestEntries: [makeMapEntry('wrong-hash')],
      });
      await am.init();

      await expect(am.loadJSON('maps/Alpine.json')).rejects.toThrow(AssetIntegrityError);

      am.dispose();
    });

    it('throws AssetNotFoundError for unknown paths when manifest is loaded', async () => {
      const am = createManager({ manifestEntries: [] });
      await am.init();

      await expect(am.loadArrayBuffer('unknown/file.bin')).rejects.toThrow(AssetNotFoundError);

      am.dispose();
    });

    it('throws AssetNotFoundError for unknown paths that include runtime base prefix', async () => {
      const am = createManager({ manifestEntries: [] });
      await am.init();

      await expect(am.loadArrayBuffer(`${runtimeBaseUrl}/unknown/file.bin`)).rejects.toThrow(AssetNotFoundError);

      am.dispose();
    });

    it('throws ManifestLoadError when manifest output paths include runtime base prefix', async () => {
      const prefixedManifest = makeManifest([
        {
          ...makeMapEntry(mapHash),
          outputPath: `${runtimeBaseUrl}/maps/Alpine.json`,
        },
      ]);

      fetchMock.mockImplementation((url: string) => {
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(prefixedManifest)));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        requireManifest: true,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await expect(am.init()).rejects.toThrow(ManifestLoadError);

      am.dispose();
    });

    it('allows unknown paths when manifest is not loaded', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      const handle = await am.loadArrayBuffer('maps/Alpine.json');
      expect(handle.data.byteLength).toBeGreaterThan(0);

      am.dispose();
    });
  });

  describe('path validation', () => {
    it('rejects path traversal', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      await expect(am.loadArrayBuffer('../../etc/passwd')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });

    it('rejects absolute paths', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      await expect(am.loadArrayBuffer('/etc/passwd')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });

    it('rejects protocol URLs', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      await expect(am.loadArrayBuffer('https://evil.com/payload')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });

    it('rejects windows drive absolute paths', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      await expect(am.loadArrayBuffer('C:/Windows/System32/kernel32.dll')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });

    it('rejects backslash-separated paths', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      await expect(am.loadArrayBuffer('maps\\Alpine.json')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });
  });

  describe('fetch errors', () => {
    it('throws AssetFetchError on HTTP error', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      fetchMock.mockImplementation((_url: string) => {
        return Promise.resolve(mockFetchResponse('', 500));
      });

      await expect(am.loadArrayBuffer('bad/path')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });

    it('throws AssetFetchError on network failure', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      fetchMock.mockImplementation(() => Promise.reject(new TypeError('Network error')));

      await expect(am.loadArrayBuffer('bad/path')).rejects.toThrow(AssetFetchError);

      am.dispose();
    });
  });

  describe('in-flight deduplication', () => {
    it('deduplicates simultaneous requests for same path', async () => {
      const am = createManager({ manifest404: true });
      await am.init();

      // Track how many fetch calls hit the asset URL
      let assetFetchCount = 0;
      fetchMock.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('maps/Alpine.json')) {
          assetFetchCount++;
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      // Fire two loads simultaneously
      const [h1, h2] = await Promise.all([
        am.loadArrayBuffer('maps/Alpine.json'),
        am.loadArrayBuffer('maps/Alpine.json'),
      ]);

      expect(assetFetchCount).toBe(1);
      // Data should be equivalent but not necessarily same instance (clone on dedup)
      expect(new TextDecoder().decode(h1.data)).toBe(mapJSON);
      expect(new TextDecoder().decode(h2.data)).toBe(mapJSON);

      am.dispose();
    });
  });

  describe('IndexedDB caching', () => {
    it('serves from cache on second load', async () => {
      const am = createManager({
        cacheEnabled: true,
        manifestEntries: [makeMapEntry(mapHash)],
      });
      await am.init();

      // First load — from network
      const h1 = await am.loadJSON('maps/Alpine.json');
      expect(h1.cached).toBe(false);

      // Wait for fire-and-forget cache write
      await new Promise((r) => setTimeout(r, 50));

      // Second load — should come from cache
      const h2 = await am.loadJSON<{ heightmap: { width: number } }>('maps/Alpine.json');
      expect(h2.cached).toBe(true);
      expect(h2.data.heightmap.width).toBe(64);

      am.dispose();
    });
  });

  describe('loadBatch', () => {
    it('loads multiple assets in parallel', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes(RUNTIME_MANIFEST_FILE)) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([]))));
        }
        return Promise.resolve(mockFetchResponse(mapJSON));
      });

      const am = new AssetManager({
        cacheEnabled: false,
        integrityChecks: false,
      });
      await am.init();

      const progress = vi.fn();
      const handles = await am.loadBatch(['a.json', 'b.json', 'c.json'], progress);

      expect(handles).toHaveLength(3);
      expect(progress).toHaveBeenCalledTimes(3);

      am.dispose();
    });
  });

  describe('baseUrl resolution', () => {
    it('prepends baseUrl to paths', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes(RUNTIME_MANIFEST_FILE)) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([]))));
        }
        return Promise.resolve(mockFetchResponse(mapJSON));
      });

      const am = new AssetManager({
        baseUrl: cdnRuntimeBaseUrl,
        cacheEnabled: false,
        integrityChecks: false,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      // Check that fetch was called with the full URL
      const calls = fetchMock.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain(cdnRuntimeMapUrl);

      am.dispose();
    });

    it('uses app runtime asset paths (<base>/<manifest> + <base>/<outputPath>)', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'data/ini-bundle.json',
              sourceHash: 'src-hash',
              outputPath: 'data/ini-bundle.json',
              outputHash: mapHash,
              converter: 'convert-all',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeIniBundleUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('data/ini-bundle.json');

      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).toContain(runtimeIniBundleUrl);

      am.dispose();
    });

    it('uses app runtime manifest URL and fails fast when manifest is required but missing', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        requireManifest: true,
        cacheEnabled: false,
        integrityChecks: true,
      });

      let initError: unknown = null;
      try {
        await am.init();
      } catch (error) {
        initError = error;
      }

      expect(initError).toBeInstanceOf(ManifestLoadError);
      expect(initError).toMatchObject({ url: runtimeManifestUrl });
      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}/${runtimeManifestUrl}`);

      am.dispose();
    });

    it('fails fast with root-relative baseUrl when manifestUrl already includes runtime base', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: rootRuntimeBaseUrl,
        manifestUrl: runtimeManifestUrl,
        requireManifest: true,
        cacheEnabled: false,
        integrityChecks: true,
      });

      let initError: unknown = null;
      try {
        await am.init();
      } catch (error) {
        initError = error;
      }

      expect(initError).toBeInstanceOf(ManifestLoadError);
      expect(initError).toMatchObject({ url: rootRuntimeManifestUrl });
      expect(calls[0]).toBe(rootRuntimeManifestUrl);
      expect(calls).not.toContain(rootRuntimeDoubleManifestUrl);

      am.dispose();
    });

    it('does not double-prefix baseUrl when manifestUrl already includes it', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: runtimeManifestUrl,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}/${runtimeManifestUrl}`);
      expect(calls).toContain(runtimeMapUrl);

      am.dispose();
    });

    it('accepts paths that already include runtime base prefix', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      const handle = await am.loadArrayBuffer(`${runtimeBaseUrl}/maps/Alpine.json`);

      expect(handle.path).toBe('maps/Alpine.json');
      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).toContain(runtimeMapUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}/${runtimeBaseUrl}/maps/Alpine.json`);

      am.dispose();
    });

    it('accepts paths that include mixed-case runtime base prefix', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      const handle = await am.loadArrayBuffer(`${mixedCaseRuntimeBaseUrl}/maps/Alpine.json`);

      expect(handle.path).toBe('maps/Alpine.json');
      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).toContain(runtimeMapUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}/${mixedCaseRuntimeMapUrl}`);

      am.dispose();
    });

    it('accepts mixed-case runtime-prefixed paths with root-relative baseUrl', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === rootRuntimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === rootRuntimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: rootRuntimeBaseUrl,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      const handle = await am.loadArrayBuffer(`${mixedCaseRuntimeBaseUrl}/maps/Alpine.json`);

      expect(handle.path).toBe('maps/Alpine.json');
      expect(calls[0]).toBe(rootRuntimeManifestUrl);
      expect(calls).toContain(rootRuntimeMapUrl);
      expect(calls).not.toContain(`/${mixedCaseRuntimeMapUrl}`);

      am.dispose();
    });

    it('canonicalizes mixed-case manifestUrl when it already includes runtime base', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: runtimeBaseUrl,
        manifestUrl: mixedCaseRuntimeManifestUrl,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).not.toContain(mixedCaseRuntimeManifestUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}/${mixedCaseRuntimeManifestUrl}`);
      expect(calls).toContain(runtimeMapUrl);

      am.dispose();
    });

    it('canonicalizes mixed-case manifestUrl with root-relative baseUrl', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === rootRuntimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === rootRuntimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: rootRuntimeBaseUrl,
        manifestUrl: mixedCaseRuntimeManifestUrl,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(rootRuntimeManifestUrl);
      expect(calls).not.toContain(`/${mixedCaseRuntimeManifestUrl}`);
      expect(calls).not.toContain(`${rootRuntimeBaseUrl}/${mixedCaseRuntimeManifestUrl}`);
      expect(calls).toContain(rootRuntimeMapUrl);

      am.dispose();
    });

    it('does not prefix absolute manifestUrl, but still prefixes relative asset paths', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === 'https://cdn.example.com/runtime/manifest.json') {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === cdnRuntimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: cdnRuntimeBaseUrl,
        manifestUrl: 'https://cdn.example.com/runtime/manifest.json',
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe('https://cdn.example.com/runtime/manifest.json');
      expect(calls).not.toContain(`${cdnRuntimeBaseUrl}/https://cdn.example.com/runtime/manifest.json`);
      expect(calls).toContain(cdnRuntimeMapUrl);

      am.dispose();
    });

    it('handles root-relative baseUrl without double-prefixing manifestUrl', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === rootRuntimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === rootRuntimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: rootRuntimeBaseUrl,
        manifestUrl: runtimeManifestUrl,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(rootRuntimeManifestUrl);
      expect(calls).not.toContain(rootRuntimeDoubleManifestUrl);
      expect(calls).toContain(rootRuntimeMapUrl);

      am.dispose();
    });

    it('uses default manifestUrl correctly with root-relative baseUrl', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === rootRuntimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === rootRuntimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: rootRuntimeBaseUrl,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(rootRuntimeManifestUrl);
      expect(calls).not.toContain(rootRuntimeDoubleManifestUrl);
      expect(calls).toContain(rootRuntimeMapUrl);

      am.dispose();
    });

    it('normalizes trailing slash in root-relative baseUrl', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === rootRuntimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === rootRuntimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: `${rootRuntimeBaseUrl}/`,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(rootRuntimeManifestUrl);
      expect(calls).toContain(rootRuntimeMapUrl);
      expect(calls).not.toContain(`${rootRuntimeBaseUrl}//${RUNTIME_MANIFEST_FILE}`);
      expect(calls).not.toContain(`${rootRuntimeBaseUrl}//maps/Alpine.json`);

      am.dispose();
    });

    it('normalizes ./manifestUrl with trailing-slash baseUrl', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: `${runtimeBaseUrl}/`,
        manifestUrl: `./${RUNTIME_MANIFEST_FILE}`,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('maps/Alpine.json');

      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).toContain(runtimeMapUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}//${RUNTIME_MANIFEST_FILE}`);
      expect(calls).not.toContain(`${runtimeBaseUrl}//maps/Alpine.json`);

      am.dispose();
    });

    it('normalizes repeated ./ prefixes and redundant separators', async () => {
      const calls: string[] = [];
      fetchMock.mockImplementation((url: string) => {
        calls.push(url);
        if (url === runtimeManifestUrl) {
          return Promise.resolve(mockFetchResponse(JSON.stringify(makeManifest([
            {
              sourcePath: 'maps/Alpine.map',
              sourceHash: 'src-hash',
              outputPath: 'maps/Alpine.json',
              outputHash: mapHash,
              converter: 'map-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ]))));
        }
        if (url === runtimeMapUrl) {
          return Promise.resolve(mockFetchResponse(mapJSON));
        }
        return Promise.resolve(mockFetchResponse('', 404));
      });

      const am = new AssetManager({
        baseUrl: `${runtimeBaseUrl}/`,
        manifestUrl: `././${RUNTIME_MANIFEST_FILE}`,
        cacheEnabled: false,
        integrityChecks: true,
      });
      await am.init();

      await am.loadArrayBuffer('././maps//./Alpine.json');

      expect(calls[0]).toBe(runtimeManifestUrl);
      expect(calls).toContain(runtimeMapUrl);
      expect(calls).not.toContain(`${runtimeBaseUrl}/./${RUNTIME_MANIFEST_FILE}`);
      expect(calls).not.toContain(`${runtimeBaseUrl}/./maps//./Alpine.json`);
      expect(calls.some((url) => url.includes('/./'))).toBe(false);

      am.dispose();
    });
  });

  describe('dispose', () => {
    it('cleans up state', async () => {
      const am = createManager();
      await am.init();
      expect(am.hasManifest).toBe(true);

      am.dispose();
      expect(am.hasManifest).toBe(false);
    });
  });

  describe('resolveModelPath', () => {
    function makeGlbEntry(sourcePath: string, outputPath: string): ConversionManifest['entries'][0] {
      return {
        sourcePath,
        sourceHash: 'src-hash',
        outputPath,
        outputHash: 'out-hash',
        converter: 'w3d-converter',
        converterVersion: '1.0.0',
        timestamp: '2025-01-01T00:00:00.000Z',
      };
    }

    it('resolves a bare model name to its manifest output path', async () => {
      const am = createManager({
        manifestEntries: [
          makeGlbEntry('Art/W3D/AVThundrblt_d1.w3d', 'models/W3DZH/Art/W3D/AVThundrblt_d1.glb'),
        ],
        integrityChecks: false,
      });
      await am.init();
      expect(am.resolveModelPath('AVThundrblt_D1')).toBe('models/W3DZH/Art/W3D/AVThundrblt_d1.glb');
      am.dispose();
    });

    it('resolves case-insensitively', async () => {
      const am = createManager({
        manifestEntries: [
          makeGlbEntry('Art/W3D/ABBarracks.w3d', 'models/W3DZH/Art/W3D/ABBarracks.glb'),
        ],
        integrityChecks: false,
      });
      await am.init();
      expect(am.resolveModelPath('abbarracks')).toBe('models/W3DZH/Art/W3D/ABBarracks.glb');
      expect(am.resolveModelPath('ABBARRACKS')).toBe('models/W3DZH/Art/W3D/ABBarracks.glb');
      am.dispose();
    });

    it('strips .w3d extension before resolving', async () => {
      const am = createManager({
        manifestEntries: [
          makeGlbEntry('Art/W3D/ABBarracks.w3d', 'models/W3DZH/Art/W3D/ABBarracks.glb'),
        ],
        integrityChecks: false,
      });
      await am.init();
      expect(am.resolveModelPath('ABBarracks.w3d')).toBe('models/W3DZH/Art/W3D/ABBarracks.glb');
      am.dispose();
    });

    it('returns null for unknown model names', async () => {
      const am = createManager({
        manifestEntries: [
          makeGlbEntry('Art/W3D/ABBarracks.w3d', 'models/W3DZH/Art/W3D/ABBarracks.glb'),
        ],
        integrityChecks: false,
      });
      await am.init();
      expect(am.resolveModelPath('NonExistentModel')).toBeNull();
      am.dispose();
    });

    it('returns null when manifest is not loaded', async () => {
      const am = createManager({ manifest404: true });
      await am.init();
      expect(am.resolveModelPath('ABBarracks')).toBeNull();
      am.dispose();
    });
  });
});
