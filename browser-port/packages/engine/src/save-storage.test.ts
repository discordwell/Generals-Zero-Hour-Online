import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { SaveStorage } from './save-storage.js';

let testCounter = 0;

function pushInt32(bytes: number[], value: number): void {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt32(0, value, true);
  bytes.push(...new Uint8Array(buffer));
}

function pushUint16(bytes: number[], value: number): void {
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  view.setUint16(0, value, true);
  bytes.push(...new Uint8Array(buffer));
}

function pushAsciiString(bytes: number[], value: string): void {
  bytes.push(value.length & 0xff);
  for (let i = 0; i < value.length; i++) {
    bytes.push(value.charCodeAt(i) & 0xff);
  }
}

function pushUnicodeString(bytes: number[], value: string): void {
  bytes.push(value.length & 0xff);
  for (let i = 0; i < value.length; i++) {
    pushUint16(bytes, value.charCodeAt(i));
  }
}

function buildImportedSaveFile(): ArrayBuffer {
  const bytes: number[] = [];
  const gameStateData: number[] = [];

  gameStateData.push(2);
  pushInt32(gameStateData, 0);
  pushAsciiString(gameStateData, '');
  pushUint16(gameStateData, 2026);
  pushUint16(gameStateData, 4);
  pushUint16(gameStateData, 2);
  pushUint16(gameStateData, 4);
  pushUint16(gameStateData, 19);
  pushUint16(gameStateData, 8);
  pushUint16(gameStateData, 7);
  pushUint16(gameStateData, 123);
  pushUnicodeString(gameStateData, 'Imported Campaign Save');
  pushAsciiString(gameStateData, 'Downtown Assault');
  pushAsciiString(gameStateData, 'America');
  pushInt32(gameStateData, 2);

  pushAsciiString(bytes, 'CHUNK_GameState');
  pushInt32(bytes, gameStateData.length);
  bytes.push(...gameStateData);
  pushAsciiString(bytes, 'SG_EOF');

  return Uint8Array.from(bytes).buffer;
}

describe('SaveStorage', () => {
  let storage: SaveStorage;

  beforeEach(() => {
    testCounter++;
    storage = new SaveStorage(`generals-saves-test-${testCounter}`);
  });

  function makeTestData(content: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(content).buffer as ArrayBuffer;
  }

  it('saves and loads a file', async () => {
    const data = makeTestData('test save data');
    await storage.saveToDB('slot1', data, {
      description: 'My Save',
      mapName: 'TestMap',
      timestamp: 1000,
      sizeBytes: data.byteLength,
    });

    const result = await storage.loadFromDB('slot1');
    expect(result).not.toBeNull();
    expect(result!.metadata.slotId).toBe('slot1');
    expect(result!.metadata.description).toBe('My Save');
    expect(result!.metadata.mapName).toBe('TestMap');
    expect(result!.data.byteLength).toBe(data.byteLength);
  });

  it('returns null for non-existent slot', async () => {
    const result = await storage.loadFromDB('nonexistent');
    expect(result).toBeNull();
  });

  it('lists saves sorted by timestamp descending', async () => {
    await storage.saveToDB('slot-old', makeTestData('old'), {
      description: 'Old save',
      mapName: '',
      timestamp: 1000,
      sizeBytes: 3,
    });
    await storage.saveToDB('slot-new', makeTestData('new'), {
      description: 'New save',
      mapName: '',
      timestamp: 3000,
      sizeBytes: 3,
    });
    await storage.saveToDB('slot-mid', makeTestData('mid'), {
      description: 'Mid save',
      mapName: '',
      timestamp: 2000,
      sizeBytes: 3,
    });

    const saves = await storage.listSaves();
    expect(saves).toHaveLength(3);
    expect(saves[0]!.slotId).toBe('slot-new');
    expect(saves[1]!.slotId).toBe('slot-mid');
    expect(saves[2]!.slotId).toBe('slot-old');
  });

  it('deletes a save', async () => {
    await storage.saveToDB('to-delete', makeTestData('data'), {
      description: 'Delete me',
      mapName: '',
      timestamp: 1000,
      sizeBytes: 4,
    });

    await storage.deleteSave('to-delete');
    const result = await storage.loadFromDB('to-delete');
    expect(result).toBeNull();

    const saves = await storage.listSaves();
    expect(saves.find((s) => s.slotId === 'to-delete')).toBeUndefined();
  });

  it('overwrites existing slot', async () => {
    await storage.saveToDB('slot1', makeTestData('original'), {
      description: 'Original',
      mapName: '',
      timestamp: 1000,
      sizeBytes: 8,
    });
    await storage.saveToDB('slot1', makeTestData('overwritten'), {
      description: 'Overwritten',
      mapName: '',
      timestamp: 2000,
      sizeBytes: 11,
    });

    const result = await storage.loadFromDB('slot1');
    expect(result!.metadata.description).toBe('Overwritten');
    expect(result!.metadata.timestamp).toBe(2000);

    const saves = await storage.listSaves();
    expect(saves.filter((s) => s.slotId === 'slot1')).toHaveLength(1);
  });

  it('preserves binary data integrity', async () => {
    const data = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xFF]);
    await storage.saveToDB('binary', data.buffer as ArrayBuffer, {
      description: 'Binary test',
      mapName: '',
      timestamp: 1000,
      sizeBytes: data.byteLength,
    });

    const result = await storage.loadFromDB('binary');
    expect(new Uint8Array(result!.data)).toEqual(data);
  });

  it('extracts source save metadata when importing a .sav file', async () => {
    const file = new File([buildImportedSaveFile()], '00000042.sav', {
      type: 'application/octet-stream',
    });

    const slotId = await storage.uploadSaveFile(file);
    const loaded = await storage.loadFromDB(slotId);

    expect(slotId).toBe('00000042');
    expect(loaded).not.toBeNull();
    expect(loaded?.metadata.description).toBe('Imported Campaign Save');
    expect(loaded?.metadata.mapName).toBe('Downtown Assault');
    expect(loaded?.metadata.sizeBytes).toBe(file.size);
    expect(loaded?.metadata.timestamp).toBeGreaterThan(0);
  });

  it('strips .save extension aliases when importing save files', async () => {
    const file = new File([buildImportedSaveFile()], '00000043.save', {
      type: 'application/octet-stream',
    });

    const slotId = await storage.uploadSaveFile(file);

    expect(slotId).toBe('00000043');
  });
});
