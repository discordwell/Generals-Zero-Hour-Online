import type { Snapshot } from './snapshot.js';
import type { Xfer } from './xfer.js';
import { XferLoad } from './xfer-load.js';

export const SOURCE_SAVE_FILE_EOF = 'SG_EOF';
export const SOURCE_GAME_STATE_BLOCK = 'CHUNK_GameState';
export const SOURCE_GAME_STATE_MAP_BLOCK = 'CHUNK_GameStateMap';

export enum SaveFileType {
  SAVE_FILE_TYPE_NORMAL = 0,
  SAVE_FILE_TYPE_MISSION = 1,
}

export interface SaveDate {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
  second: number;
  milliseconds: number;
}

export interface ParsedSaveGameInfo {
  saveFileType: SaveFileType;
  missionMapName: string;
  date: SaveDate;
  description: string;
  mapLabel: string;
  campaignSide: string;
  missionNumber: number;
}

export interface SaveGameChunkInfo {
  blockName: string;
  blockSize: number;
  blockStartOffset: number;
  blockDataOffset: number;
}

export interface ParsedSaveGameMapInfo {
  saveGameMapPath: string;
  pristineMapPath: string;
  gameMode: number;
  embeddedMapData: ArrayBuffer;
  objectIdCounter: number;
  drawableIdCounter: number;
  trailingBytes: ArrayBuffer;
}

const INVALID_MISSION_NUMBER = -1;
const GAME_STATE_VERSION = 2;

function createDefaultSaveDate(): SaveDate {
  return {
    year: 0,
    month: 0,
    day: 0,
    dayOfWeek: 0,
    hour: 0,
    minute: 0,
    second: 0,
    milliseconds: 0,
  };
}

function createDefaultSaveGameInfo(): ParsedSaveGameInfo {
  return {
    saveFileType: SaveFileType.SAVE_FILE_TYPE_NORMAL,
    missionMapName: '',
    date: createDefaultSaveDate(),
    description: '',
    mapLabel: '',
    campaignSide: '',
    missionNumber: INVALID_MISSION_NUMBER,
  };
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

class GameStateInfoSnapshot implements Snapshot {
  readonly info = createDefaultSaveGameInfo();

  crc(_xfer: Xfer): void {
    // Metadata-only parser: no CRC contribution needed here.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(GAME_STATE_VERSION);

    if (version >= 2) {
      this.info.saveFileType = xfer.xferInt(this.info.saveFileType) as SaveFileType;
      this.info.missionMapName = xfer.xferAsciiString(this.info.missionMapName);
    }

    this.info.date.year = xfer.xferUnsignedShort(this.info.date.year);
    this.info.date.month = xfer.xferUnsignedShort(this.info.date.month);
    this.info.date.day = xfer.xferUnsignedShort(this.info.date.day);
    this.info.date.dayOfWeek = xfer.xferUnsignedShort(this.info.date.dayOfWeek);
    this.info.date.hour = xfer.xferUnsignedShort(this.info.date.hour);
    this.info.date.minute = xfer.xferUnsignedShort(this.info.date.minute);
    this.info.date.second = xfer.xferUnsignedShort(this.info.date.second);
    this.info.date.milliseconds = xfer.xferUnsignedShort(this.info.date.milliseconds);
    this.info.description = xfer.xferUnicodeString(this.info.description);
    this.info.mapLabel = xfer.xferAsciiString(this.info.mapLabel);
    this.info.campaignSide = xfer.xferAsciiString(this.info.campaignSide);
    this.info.missionNumber = xfer.xferInt(this.info.missionNumber);
  }

  loadPostProcess(): void {
    // No post-process work for metadata-only reads.
  }
}

export function listSaveGameChunks(data: ArrayBuffer): SaveGameChunkInfo[] {
  const xferLoad = new XferLoad(data);
  xferLoad.open('save-game-file');

  try {
    const chunks: SaveGameChunkInfo[] = [];
    while (true) {
      const token = xferLoad.xferAsciiString('');
      if (token.toLowerCase() === SOURCE_SAVE_FILE_EOF.toLowerCase()) {
        break;
      }

      const blockStartOffset = xferLoad.getOffset();
      const blockSize = xferLoad.beginBlock();
      const blockDataOffset = xferLoad.getOffset();
      chunks.push({
        blockName: token,
        blockSize,
        blockStartOffset,
        blockDataOffset,
      });
      xferLoad.skip(blockSize);
      xferLoad.endBlock();
    }
    return chunks;
  } finally {
    xferLoad.close();
  }
}

export function parseSaveGameInfo(data: ArrayBuffer): ParsedSaveGameInfo {
  const xferLoad = new XferLoad(data);
  xferLoad.open('save-game-file');

  try {
    while (true) {
      const token = xferLoad.xferAsciiString('');
      if (token.toLowerCase() === SOURCE_SAVE_FILE_EOF.toLowerCase()) {
        throw new Error(`Save file does not contain ${SOURCE_GAME_STATE_BLOCK}`);
      }

      const blockSize = xferLoad.beginBlock();
      if (token.toLowerCase() === SOURCE_GAME_STATE_BLOCK.toLowerCase()) {
        const snapshot = new GameStateInfoSnapshot();
        snapshot.xfer(xferLoad);
        xferLoad.endBlock();
        return snapshot.info;
      }

      xferLoad.skip(blockSize);
      xferLoad.endBlock();
    }
  } finally {
    xferLoad.close();
  }
}

export function saveDateToTimestamp(date: SaveDate): number {
  if (
    date.year <= 0
    || date.month <= 0
    || date.day <= 0
  ) {
    return 0;
  }

  return new Date(
    date.year,
    date.month - 1,
    date.day,
    date.hour,
    date.minute,
    date.second,
    date.milliseconds,
  ).getTime();
}

export function parseSaveGameMapInfo(data: ArrayBuffer): ParsedSaveGameMapInfo {
  const xferLoad = new XferLoad(data);
  xferLoad.open('save-game-file');

  try {
    while (true) {
      const token = xferLoad.xferAsciiString('');
      if (token.toLowerCase() === SOURCE_SAVE_FILE_EOF.toLowerCase()) {
        throw new Error(`Save file does not contain ${SOURCE_GAME_STATE_MAP_BLOCK}`);
      }

      const blockSize = xferLoad.beginBlock();
      const blockDataOffset = xferLoad.getOffset();
      if (token.toLowerCase() === SOURCE_GAME_STATE_MAP_BLOCK.toLowerCase()) {
        const blockEndOffset = blockDataOffset + blockSize;
        const version = xferLoad.xferVersion(2);
        const saveGameMapPath = xferLoad.xferAsciiString('');
        const pristineMapPath = xferLoad.xferAsciiString('');
        const gameMode = version >= 2 ? xferLoad.xferInt(0) : 0;

        const embeddedMapBlockSize = xferLoad.beginBlock();
        const embeddedMapData = xferLoad.xferUser(new Uint8Array(embeddedMapBlockSize));
        xferLoad.endBlock();

        const objectIdCounter = xferLoad.xferUnsignedInt(0);
        const drawableIdCounter = xferLoad.xferUnsignedInt(0);

        const trailingBytesLength = blockEndOffset - xferLoad.getOffset();
        const trailingBytes = trailingBytesLength > 0
          ? xferLoad.xferUser(new Uint8Array(trailingBytesLength))
          : new Uint8Array(0);
        xferLoad.endBlock();

        return {
          saveGameMapPath,
          pristineMapPath,
          gameMode,
          embeddedMapData: copyToArrayBuffer(embeddedMapData),
          objectIdCounter,
          drawableIdCounter,
          trailingBytes: copyToArrayBuffer(trailingBytes),
        };
      }

      xferLoad.skip(blockSize);
      xferLoad.endBlock();
    }
  } finally {
    xferLoad.close();
  }
}
