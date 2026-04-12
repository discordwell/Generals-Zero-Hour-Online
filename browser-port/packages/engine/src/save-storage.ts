/**
 * SaveStorage — IndexedDB persistence for save game files.
 *
 * Two object stores:
 * - 'save-files': binary save data (ArrayBuffer)
 * - 'save-metadata': description, mapName, timestamp, sizeBytes
 *
 * Also provides download/upload helpers for file import/export.
 */

import { parseSaveGameInfo, saveDateToTimestamp } from './save-game-file.js';

export interface SaveMetadata {
  slotId: string;
  description: string;
  mapName: string;
  timestamp: number;
  sizeBytes: number;
}

const DEFAULT_DB_NAME = 'generals-saves';
const DB_VERSION = 1;
const STORE_FILES = 'save-files';
const STORE_METADATA = 'save-metadata';

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

export class SaveStorage {
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

  async saveToDB(slotId: string, data: ArrayBuffer, metadata: Omit<SaveMetadata, 'slotId'>): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_FILES).put(data, slotId);
      tx.objectStore(STORE_METADATA).put({ slotId, ...metadata }, slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadFromDB(slotId: string): Promise<{ data: ArrayBuffer; metadata: SaveMetadata } | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readonly');
      const fileReq = tx.objectStore(STORE_FILES).get(slotId);
      const metaReq = tx.objectStore(STORE_METADATA).get(slotId);
      tx.oncomplete = () => {
        const data = fileReq.result as ArrayBuffer | undefined;
        const metadata = metaReq.result as SaveMetadata | undefined;
        if (!data || !metadata) { resolve(null); return; }
        resolve({ data, metadata });
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async listSaves(): Promise<SaveMetadata[]> {
    const db = await this.getDb();
    const keys = await txGetAllKeys(db, STORE_METADATA);
    const results: SaveMetadata[] = [];
    for (const key of keys) {
      const meta = await txGet<SaveMetadata>(db, STORE_METADATA, key);
      if (meta) results.push(meta);
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteSave(slotId: string): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_FILES).delete(slotId);
      tx.objectStore(STORE_METADATA).delete(slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Download a save file as a .sav file via browser download.
   */
  async downloadSaveFile(slotId: string): Promise<void> {
    const save = await this.loadFromDB(slotId);
    if (!save) throw new Error(`Save "${slotId}" not found`);

    const blob = new Blob([save.data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slotId}.sav`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Upload a save file from a File object.
   */
  async uploadSaveFile(file: File): Promise<string> {
    const data = await file.arrayBuffer();
    const slotId = file.name.replace(/\.(?:sav|save)$/i, '');
    let metadata: Omit<SaveMetadata, 'slotId'>;
    try {
      const info = parseSaveGameInfo(data);
      const timestamp = saveDateToTimestamp(info.date);
      metadata = {
        description: info.description.trim() || `Imported: ${file.name}`,
        mapName: info.mapLabel.trim() || info.missionMapName.trim(),
        timestamp: timestamp > 0 ? timestamp : Date.now(),
        sizeBytes: data.byteLength,
      };
    } catch {
      metadata = {
        description: `Imported: ${file.name}`,
        mapName: '',
        timestamp: Date.now(),
        sizeBytes: data.byteLength,
      };
    }
    await this.saveToDB(slotId, data, metadata);
    return slotId;
  }
}
