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
const SOURCE_MAX_SAVE_FILE_NUMBER = 99999999;
const SOURCE_SAVE_SLOT_ID_PATTERN = /^\d{8}$/;

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

function normalizeSaveSlotId(slotId: string): string {
  const trimmed = slotId.trim();
  const leaf = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return leaf.replace(/\.(?:sav|save)$/i, '');
}

function requireSaveSlotId(slotId: string): string {
  const normalized = normalizeSaveSlotId(slotId);
  if (!normalized) {
    throw new Error('Save slot ID must not be empty.');
  }
  return normalized;
}

function formatSourceSaveSlotId(fileNumber: number): string {
  return String(fileNumber).padStart(8, '0');
}

function formatSaveDownloadName(slotId: string): string {
  const normalized = requireSaveSlotId(slotId);
  return `${normalized}.sav`;
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
    const normalizedSlotId = requireSaveSlotId(slotId);
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_FILES).put(data, normalizedSlotId);
      tx.objectStore(STORE_METADATA).put({ slotId: normalizedSlotId, ...metadata }, normalizedSlotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadFromDB(slotId: string): Promise<{ data: ArrayBuffer; metadata: SaveMetadata } | null> {
    const normalizedSlotId = requireSaveSlotId(slotId);
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readonly');
      const fileReq = tx.objectStore(STORE_FILES).get(normalizedSlotId);
      const metaReq = tx.objectStore(STORE_METADATA).get(normalizedSlotId);
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
    const normalizedSlotId = requireSaveSlotId(slotId);
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_FILES).delete(normalizedSlotId);
      tx.objectStore(STORE_METADATA).delete(normalizedSlotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Source parity: GameState::findNextSaveFilename() searches 00000000.sav upward
   * and returns the lowest missing filename. Browser slot IDs omit the .sav suffix.
   */
  async findNextSourceSaveSlotId(): Promise<string> {
    const db = await this.getDb();
    const usedSourceSlotIds = new Set<string>();
    for (const storeName of [STORE_FILES, STORE_METADATA]) {
      const keys = await txGetAllKeys(db, storeName);
      for (const key of keys) {
        const normalized = normalizeSaveSlotId(String(key));
        if (SOURCE_SAVE_SLOT_ID_PATTERN.test(normalized)) {
          usedSourceSlotIds.add(normalized);
        }
      }
    }

    for (let i = 0; i <= SOURCE_MAX_SAVE_FILE_NUMBER; i++) {
      const slotId = formatSourceSaveSlotId(i);
      if (!usedSourceSlotIds.has(slotId)) {
        return slotId;
      }
    }

    throw new Error('Unable to find an available source-compatible save slot.');
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
    anchor.download = formatSaveDownloadName(slotId);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Upload a save file from a File object.
   */
  async uploadSaveFile(file: File): Promise<string> {
    const data = await file.arrayBuffer();
    const slotId = requireSaveSlotId(file.name);
    let info: ReturnType<typeof parseSaveGameInfo>;
    try {
      info = parseSaveGameInfo(data);
    } catch (error) {
      throw new Error(
        `File "${file.name}" is not a C&C Generals save file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const timestamp = saveDateToTimestamp(info.date);
    const metadata: Omit<SaveMetadata, 'slotId'> = {
      description: info.description.trim() || `Imported: ${file.name}`,
      mapName: info.mapLabel.trim() || info.missionMapName.trim(),
      timestamp: timestamp > 0 ? timestamp : Date.now(),
      sizeBytes: data.byteLength,
    };
    await this.saveToDB(slotId, data, metadata);
    return slotId;
  }
}
