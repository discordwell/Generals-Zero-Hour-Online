import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { SaveStorage } from './save-storage.js';

let testCounter = 0;

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
});
