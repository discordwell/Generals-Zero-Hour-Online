import type { ReplayFile } from './replay-manager.js';

export interface ReplayMetadata {
  replayId: string;
  description: string;
  mapPath: string;
  version: number;
  timestamp: number;
  sizeBytes: number;
  totalFrames: number;
  playerCount: number;
}

const DEFAULT_DB_NAME = 'generals-replays';
const DB_VERSION = 1;
const STORE_FILES = 'replay-files';
const STORE_METADATA = 'replay-metadata';

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function txGetAllKeys(db: IDBDatabase, storeName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => reject(request.error);
  });
}

function buildReplayMetadata(
  replayId: string,
  replay: ReplayFile,
  sizeBytes: number,
  description?: string,
): ReplayMetadata {
  return {
    replayId,
    description: description?.trim() || replayId,
    mapPath: replay.mapPath,
    version: replay.version,
    timestamp: Date.parse(replay.recordedAt) || Date.now(),
    sizeBytes,
    totalFrames: replay.totalFrames,
    playerCount: replay.playerCount,
  };
}

export class ReplayStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(dbName: string = DEFAULT_DB_NAME) {
    this.dbName = dbName;
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase(this.dbName);
    }
    return this.dbPromise;
  }

  async saveToDB(replayId: string, replay: ReplayFile, description?: string): Promise<void> {
    const db = await this.getDb();
    const serializedReplay = JSON.stringify(replay);
    const metadata = buildReplayMetadata(replayId, replay, serializedReplay.length, description);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_FILES).put(serializedReplay, replayId);
      tx.objectStore(STORE_METADATA).put(metadata, replayId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadFromDB(replayId: string): Promise<{ replay: ReplayFile; metadata: ReplayMetadata } | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readonly');
      const fileReq = tx.objectStore(STORE_FILES).get(replayId);
      const metaReq = tx.objectStore(STORE_METADATA).get(replayId);
      tx.oncomplete = () => {
        const replayJson = fileReq.result as string | undefined;
        const metadata = metaReq.result as ReplayMetadata | undefined;
        if (!replayJson || !metadata) {
          resolve(null);
          return;
        }
        try {
          resolve({
            replay: JSON.parse(replayJson) as ReplayFile,
            metadata,
          });
        } catch {
          resolve(null);
        }
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async listReplays(): Promise<ReplayMetadata[]> {
    const db = await this.getDb();
    const keys = await txGetAllKeys(db, STORE_METADATA);
    const results: ReplayMetadata[] = [];
    for (const key of keys) {
      const metadata = await txGet<ReplayMetadata>(db, STORE_METADATA, key);
      if (metadata) {
        results.push(metadata);
      }
    }
    return results.sort((left, right) => right.timestamp - left.timestamp);
  }

  async deleteReplay(replayId: string): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_FILES).delete(replayId);
      tx.objectStore(STORE_METADATA).delete(replayId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async copyReplay(sourceReplayId: string, targetReplayId: string, description?: string): Promise<void> {
    const replay = await this.loadFromDB(sourceReplayId);
    if (!replay) {
      throw new Error(`Replay "${sourceReplayId}" not found`);
    }
    await this.saveToDB(targetReplayId, replay.replay, description ?? replay.metadata.description);
  }

  async downloadReplayFile(replayId: string): Promise<void> {
    const replay = await this.loadFromDB(replayId);
    if (!replay) {
      throw new Error(`Replay "${replayId}" not found`);
    }

    const blob = new Blob([JSON.stringify(replay.replay, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${replayId}.replay.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async uploadReplayFile(file: File, replayId?: string, description?: string): Promise<string> {
    const replayJson = await file.text();
    const replay = JSON.parse(replayJson) as ReplayFile;
    const normalizedReplayId = replayId ?? file.name.replace(/\.replay\.json$/i, '').replace(/\.json$/i, '');
    await this.saveToDB(normalizedReplayId, replay, description ?? normalizedReplayId);
    return normalizedReplayId;
  }
}
