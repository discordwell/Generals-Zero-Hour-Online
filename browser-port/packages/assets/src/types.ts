/**
 * Asset system types — runtime loading, caching, and integrity verification.
 */

/** Runtime asset base URL served by Vite public dir. */
export const RUNTIME_ASSET_BASE_URL = 'assets';
/** Runtime manifest filename resolved relative to base URL in app mode. */
export const RUNTIME_MANIFEST_FILE = 'manifest.json';
/** Runtime manifest public path used by non-app default config. */
export const RUNTIME_MANIFEST_PUBLIC_PATH = `${RUNTIME_ASSET_BASE_URL}/${RUNTIME_MANIFEST_FILE}`;

/** Broad classification of asset types for typed loading. */
export enum AssetType {
  JSON = 'json',
  ArrayBuffer = 'arraybuffer',
  Texture = 'texture',
  Model = 'model',
  Audio = 'audio',
}

/** Handle returned by the asset manager after loading an asset. */
export interface AssetHandle<T = unknown> {
  /** The output path used to load this asset. */
  readonly path: string;
  /** The loaded data. */
  readonly data: T;
  /** SHA-256 hash of the raw bytes (if verified). */
  readonly hash: string | null;
  /** Whether this was served from IndexedDB cache. */
  readonly cached: boolean;
}

/** Progress callback signature. */
export type ProgressCallback = (loaded: number, total: number) => void;

/** Configuration for the AssetManager. */
export interface AssetManagerConfig {
  /** Base URL prepended to all asset paths. Default: '' (relative). */
  baseUrl: string;
  /** URL of the manifest file. Default: RUNTIME_MANIFEST_PUBLIC_PATH. */
  manifestUrl: string;
  /** Require a valid manifest at init; fail if missing. Default: false. */
  requireManifest: boolean;
  /** Whether to enable IndexedDB caching. Default: true. */
  cacheEnabled: boolean;
  /** Whether to verify SHA-256 hashes against manifest. Default: true. */
  integrityChecks: boolean;
  /** Maximum cache size in bytes. Default: 256 MB. */
  maxCacheSize: number;
  /** IndexedDB database name. Default: 'generals-assets'. */
  dbName: string;
  /** Maximum time to wait for an IndexedDB cache read before fetching. */
  cacheReadTimeoutMs: number;
}

/** Default asset manager configuration. */
export const DEFAULT_CONFIG: AssetManagerConfig = {
  baseUrl: '',
  manifestUrl: RUNTIME_MANIFEST_PUBLIC_PATH,
  requireManifest: false,
  cacheEnabled: true,
  integrityChecks: true,
  maxCacheSize: 256 * 1024 * 1024,
  dbName: 'generals-assets',
  cacheReadTimeoutMs: 1500,
};

/** An entry stored in the IndexedDB cache. */
export interface CachedAssetEntry {
  /** The output path (key). */
  path: string;
  /** Raw asset data. */
  data: ArrayBuffer;
  /** SHA-256 hash of the data at write time. */
  hash: string;
  /** Timestamp of last access (for LRU eviction). */
  lastAccessed: number;
  /** Size in bytes. */
  size: number;
}
