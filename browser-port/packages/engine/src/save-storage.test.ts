import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { SaveStorage } from './save-storage.js';
import { SaveFileType } from './save-game-file.js';

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

function buildImportedSaveFile(options: {
  description?: string;
  mapLabel?: string;
  saveFileType?: SaveFileType;
} = {}): ArrayBuffer {
  const {
    description = 'Imported Campaign Save',
    mapLabel = 'Downtown Assault',
    saveFileType = SaveFileType.SAVE_FILE_TYPE_NORMAL,
  } = options;
  const bytes: number[] = [];
  const gameStateData: number[] = [];

  gameStateData.push(2);
  pushInt32(gameStateData, saveFileType);
  pushAsciiString(gameStateData, '');
  pushUint16(gameStateData, 2026);
  pushUint16(gameStateData, 4);
  pushUint16(gameStateData, 2);
  pushUint16(gameStateData, 4);
  pushUint16(gameStateData, 19);
  pushUint16(gameStateData, 8);
  pushUint16(gameStateData, 7);
  pushUint16(gameStateData, 123);
  pushUnicodeString(gameStateData, description);
  pushAsciiString(gameStateData, mapLabel);
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

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('normalizes source save filenames at the storage boundary', async () => {
    const data = makeTestData('source filename');
    await storage.saveToDB('00000044.sav', data, {
      description: 'Source filename',
      mapName: '',
      timestamp: 1000,
      sizeBytes: data.byteLength,
    });

    const loadedBySlot = await storage.loadFromDB('00000044');
    const loadedByFilename = await storage.loadFromDB('Save\\00000044.sav');
    const saves = await storage.listSaves();

    expect(loadedBySlot).not.toBeNull();
    expect(loadedByFilename).not.toBeNull();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.slotId).toBe('00000044');

    await storage.deleteSave('00000044.sav');
    expect(await storage.loadFromDB('00000044')).toBeNull();
  });

  it('finds the lowest source-compatible numeric save slot', async () => {
    await storage.saveToDB('00000000.sav', makeTestData('zero'), {
      description: 'Zero',
      mapName: '',
      timestamp: 1000,
      sizeBytes: 4,
    });
    await storage.saveToDB('00000002', makeTestData('two'), {
      description: 'Two',
      mapName: '',
      timestamp: 1000,
      sizeBytes: 3,
    });
    await storage.saveToDB('manual-save', makeTestData('manual'), {
      description: 'Manual',
      mapName: '',
      timestamp: 1000,
      sizeBytes: 6,
    });

    await expect(storage.findNextSourceSaveSlotId()).resolves.toBe('00000001');
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
    expect(loaded?.metadata.saveFileType).toBe(SaveFileType.SAVE_FILE_TYPE_NORMAL);
  });

  it('preserves empty source descriptions when importing save files', async () => {
    const file = new File([buildImportedSaveFile({ description: '', mapLabel: 'Downtown Assault' })], '00000046.sav', {
      type: 'application/octet-stream',
    });

    const slotId = await storage.uploadSaveFile(file);
    const loaded = await storage.loadFromDB(slotId);

    expect(loaded?.metadata.description).toBe('');
    expect(loaded?.metadata.mapName).toBe('Downtown Assault');
  });

  it('preserves mission save type metadata when importing save files', async () => {
    const file = new File([buildImportedSaveFile({
      saveFileType: SaveFileType.SAVE_FILE_TYPE_MISSION,
    })], '00000047.sav', {
      type: 'application/octet-stream',
    });

    const slotId = await storage.uploadSaveFile(file);
    const loaded = await storage.loadFromDB(slotId);

    expect(loaded?.metadata.saveFileType).toBe(SaveFileType.SAVE_FILE_TYPE_MISSION);
  });

  it('strips .save extension aliases when importing save files', async () => {
    const file = new File([buildImportedSaveFile()], '00000043.save', {
      type: 'application/octet-stream',
    });

    const slotId = await storage.uploadSaveFile(file);

    expect(slotId).toBe('00000043');
  });

  it('downloads save files with a single .sav extension', async () => {
    const data = makeTestData('download');
    await storage.saveToDB('00000045.sav', data, {
      description: 'Download',
      mapName: '',
      timestamp: 1000,
      sizeBytes: data.byteLength,
    });

    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:save'),
      revokeObjectURL: vi.fn(),
    });

    await storage.downloadSaveFile('00000045.sav');

    expect(anchor.download).toBe('00000045.sav');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:save');
  });

  it('rejects non-Generals save files on import', async () => {
    const file = new File([new Uint8Array([0x04, 0x49, 0x44, 0x4c, 0x00])], 'scipy.sav', {
      type: 'application/octet-stream',
    });

    await expect(storage.uploadSaveFile(file)).rejects.toThrow(
      'File "scipy.sav" is not a C&C Generals save file',
    );
    expect(await storage.listSaves()).toEqual([]);
  });
});
