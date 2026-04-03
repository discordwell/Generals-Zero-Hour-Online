import { describe, expect, it } from 'vitest';

import {
  SaveFileType,
  SOURCE_GAME_STATE_BLOCK,
  SOURCE_GAME_STATE_MAP_BLOCK,
  listSaveGameChunks,
  parseSaveGameInfo,
  parseSaveGameMapInfo,
  saveDateToTimestamp,
} from './save-game-file.js';

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

function pushBlock(bytes: number[], blockName: string, blockData: number[]): void {
  pushAsciiString(bytes, blockName);
  pushInt32(bytes, blockData.length);
  bytes.push(...blockData);
}

function buildSyntheticSaveFile(): ArrayBuffer {
  const bytes: number[] = [];

  const gameStateData: number[] = [];
  gameStateData.push(2);
  pushInt32(gameStateData, SaveFileType.SAVE_FILE_TYPE_MISSION);
  pushAsciiString(gameStateData, 'Maps/MD_USA02');
  pushUint16(gameStateData, 2026);
  pushUint16(gameStateData, 4);
  pushUint16(gameStateData, 2);
  pushUint16(gameStateData, 4);
  pushUint16(gameStateData, 17);
  pushUint16(gameStateData, 23);
  pushUint16(gameStateData, 45);
  pushUint16(gameStateData, 678);
  pushUnicodeString(gameStateData, 'Bridge Assault');
  pushAsciiString(gameStateData, 'USA Mission 2');
  pushAsciiString(gameStateData, 'America');
  pushInt32(gameStateData, 1);

  pushBlock(bytes, SOURCE_GAME_STATE_BLOCK, gameStateData);
  const gameStateMapData: number[] = [];
  gameStateMapData.push(2);
  pushAsciiString(gameStateMapData, 'Save\\00000042.map');
  pushAsciiString(gameStateMapData, 'Maps\\MD_USA02\\MD_USA02.map');
  pushInt32(gameStateMapData, 1);
  const embeddedMapData = [1, 2, 3, 4, 5, 6];
  pushInt32(gameStateMapData, embeddedMapData.length);
  gameStateMapData.push(...embeddedMapData);
  pushInt32(gameStateMapData, 4001);
  pushInt32(gameStateMapData, 8123);
  gameStateMapData.push(0xaa, 0xbb);
  pushBlock(bytes, SOURCE_GAME_STATE_MAP_BLOCK, gameStateMapData);
  pushBlock(bytes, 'CHUNK_Dummy', [0xde, 0xad, 0xbe, 0xef]);
  pushAsciiString(bytes, 'SG_EOF');

  return Uint8Array.from(bytes).buffer;
}

describe('save-game-file', () => {
  it('parses CHUNK_GameState metadata from a source-format save buffer', () => {
    const saveData = buildSyntheticSaveFile();

    const info = parseSaveGameInfo(saveData);

    expect(info.saveFileType).toBe(SaveFileType.SAVE_FILE_TYPE_MISSION);
    expect(info.missionMapName).toBe('Maps/MD_USA02');
    expect(info.description).toBe('Bridge Assault');
    expect(info.mapLabel).toBe('USA Mission 2');
    expect(info.campaignSide).toBe('America');
    expect(info.missionNumber).toBe(1);
    expect(info.date).toEqual({
      year: 2026,
      month: 4,
      day: 2,
      dayOfWeek: 4,
      hour: 17,
      minute: 23,
      second: 45,
      milliseconds: 678,
    });
  });

  it('lists source chunk names and sizes in stream order', () => {
    const saveData = buildSyntheticSaveFile();

    const chunks = listSaveGameChunks(saveData);

    expect(chunks.map((chunk) => chunk.blockName)).toEqual([
      'CHUNK_GameState',
      'CHUNK_GameStateMap',
      'CHUNK_Dummy',
    ]);
    expect(chunks[0]?.blockSize).toBeGreaterThan(0);
    expect(chunks[2]?.blockSize).toBe(4);
    expect(chunks[0]?.blockDataOffset).toBeGreaterThan(chunks[0]?.blockStartOffset ?? 0);
  });

  it('parses CHUNK_GameStateMap runtime bootstrap data', () => {
    const saveData = buildSyntheticSaveFile();

    const info = parseSaveGameMapInfo(saveData);

    expect(info.saveGameMapPath).toBe('Save\\00000042.map');
    expect(info.pristineMapPath).toBe('Maps\\MD_USA02\\MD_USA02.map');
    expect(info.gameMode).toBe(1);
    expect(new Uint8Array(info.embeddedMapData)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(info.objectIdCounter).toBe(4001);
    expect(info.drawableIdCounter).toBe(8123);
    expect(new Uint8Array(info.trailingBytes)).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it('converts SaveDate values into a local timestamp', () => {
    const timestamp = saveDateToTimestamp({
      year: 2026,
      month: 4,
      day: 2,
      dayOfWeek: 4,
      hour: 17,
      minute: 23,
      second: 45,
      milliseconds: 678,
    });

    const reconstructed = new Date(timestamp);
    expect(reconstructed.getFullYear()).toBe(2026);
    expect(reconstructed.getMonth()).toBe(3);
    expect(reconstructed.getDate()).toBe(2);
    expect(reconstructed.getHours()).toBe(17);
    expect(reconstructed.getMinutes()).toBe(23);
    expect(reconstructed.getSeconds()).toBe(45);
    expect(reconstructed.getMilliseconds()).toBe(678);
  });
});
