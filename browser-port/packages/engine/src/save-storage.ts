/**
 * SaveStorage — IndexedDB persistence for save game files.
 *
 * Two object stores:
 * - 'save-files': binary save data (ArrayBuffer)
 * - 'save-metadata': description, mapName, timestamp, sizeBytes
 *
 * Also provides download/upload helpers for file import/export.
 */

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

function txPut(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
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

function txDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
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
    await txPut(db, STORE_FILES, slotId, data);
    await txPut(db, STORE_METADATA, slotId, { slotId, ...metadata });
  }

  async loadFromDB(slotId: string): Promise<{ data: ArrayBuffer; metadata: SaveMetadata } | null> {
    const db = await this.getDb();
    const data = await txGet<ArrayBuffer>(db, STORE_FILES, slotId);
    const metadata = await txGet<SaveMetadata>(db, STORE_METADATA, slotId);
    if (!data || !metadata) return null;
    return { data, metadata };
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
    await txDelete(db, STORE_FILES, slotId);
    await txDelete(db, STORE_METADATA, slotId);
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
    const slotId = file.name.replace(/\.sav$/i, '');
    const metadata: Omit<SaveMetadata, 'slotId'> = {
      description: `Imported: ${file.name}`,
      mapName: '',
      timestamp: Date.now(),
      sizeBytes: data.byteLength,
    };
    await this.saveToDB(slotId, data, metadata);
    return slotId;
  }
}
