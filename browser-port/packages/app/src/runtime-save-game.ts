import {
  GameState,
  SaveCode,
  SaveFileType,
  XferMode,
  parseSaveGameInfo,
  parseSaveGameMapInfo,
  type ParsedSaveGameInfo,
  type Snapshot,
  type Xfer,
} from '@generals/engine';
import type { CameraState } from '@generals/input';
import type { GameLogicSubsystem } from '@generals/game-logic';
import type { MapDataJSON } from '@generals/renderer';

export const BROWSER_RUNTIME_STATE_BLOCK = 'CHUNK_TS_RuntimeState';

const GAME_STATE_VERSION = 2;
const GAME_STATE_MAP_VERSION = 2;
const BROWSER_RUNTIME_STATE_VERSION = 1;
const INVALID_MISSION_NUMBER = -1;

interface RuntimeSaveMetadataState {
  saveFileType: SaveFileType;
  missionMapName: string;
  date: {
    year: number;
    month: number;
    day: number;
    dayOfWeek: number;
    hour: number;
    minute: number;
    second: number;
    milliseconds: number;
  };
  description: string;
  mapLabel: string;
  campaignSide: string;
  missionNumber: number;
}

interface RuntimeSaveMapState {
  saveGameMapPath: string;
  pristineMapPath: string;
  gameMode: number;
  embeddedMapBytes: Uint8Array;
  objectIdCounter: number;
  drawableIdCounter: number;
}

export interface BrowserRuntimeSavePayload {
  version: number;
  mapPath: string | null;
  cameraState: CameraState | null;
  gameLogicState: unknown;
}

export interface RuntimeSaveBootstrap {
  metadata: ParsedSaveGameInfo;
  mapData: MapDataJSON;
  mapPath: string | null;
  cameraState: CameraState | null;
  gameLogicState: unknown;
}

function getLeafName(path: string | null): string {
  if (!path) {
    return 'Embedded Map';
  }
  const normalized = path.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  return leaf.replace(/\.[^.]+$/, '') || leaf;
}

function createMetadataState(description: string, mapPath: string | null): RuntimeSaveMetadataState {
  const now = new Date();
  return {
    saveFileType: SaveFileType.SAVE_FILE_TYPE_NORMAL,
    missionMapName: '',
    date: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      dayOfWeek: now.getDay(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
      milliseconds: now.getMilliseconds(),
    },
    description,
    mapLabel: getLeafName(mapPath),
    campaignSide: '',
    missionNumber: INVALID_MISSION_NUMBER,
  };
}

function encodeJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeJsonBytes<T>(bytes: ArrayBuffer | Uint8Array): T {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = new TextDecoder().decode(array);
  return JSON.parse(text, runtimeJsonReviver) as T;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(encoded, 'base64'));
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function runtimeJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return {
      __runtimeType: 'Map',
      entries: Array.from(value.entries()),
    };
  }
  if (value instanceof Set) {
    return {
      __runtimeType: 'Set',
      values: Array.from(value.values()),
    };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return {
      __runtimeType: 'TypedArray',
      ctor: value.constructor.name,
      base64: bytesToBase64(bytes),
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      __runtimeType: 'ArrayBuffer',
      base64: bytesToBase64(new Uint8Array(value)),
    };
  }
  return value;
}

function runtimeJsonReviver(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const runtimeType = typeof record.__runtimeType === 'string'
    ? record.__runtimeType
    : null;
  if (!runtimeType) {
    return value;
  }

  switch (runtimeType) {
    case 'Map':
      return new Map(Array.isArray(record.entries) ? record.entries as Array<[unknown, unknown]> : []);
    case 'Set':
      return new Set(Array.isArray(record.values) ? record.values as unknown[] : []);
    case 'ArrayBuffer': {
      const encoded = typeof record.base64 === 'string' ? record.base64 : '';
      return base64ToBytes(encoded).buffer.slice(0);
    }
    case 'TypedArray': {
      const encoded = typeof record.base64 === 'string' ? record.base64 : '';
      const ctorName = typeof record.ctor === 'string' ? record.ctor : 'Uint8Array';
      const bytes = base64ToBytes(encoded);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      switch (ctorName) {
        case 'Int8Array':
          return new Int8Array(buffer);
        case 'Uint8ClampedArray':
          return new Uint8ClampedArray(buffer);
        case 'Int16Array':
          return new Int16Array(buffer);
        case 'Uint16Array':
          return new Uint16Array(buffer);
        case 'Int32Array':
          return new Int32Array(buffer);
        case 'Uint32Array':
          return new Uint32Array(buffer);
        case 'Float32Array':
          return new Float32Array(buffer);
        case 'Float64Array':
          return new Float64Array(buffer);
        default:
          return new Uint8Array(buffer);
      }
    }
    default:
      return value;
  }
}

class MetadataSnapshot implements Snapshot {
  constructor(private readonly state: RuntimeSaveMetadataState) {}

  crc(_xfer: Xfer): void {
    // Save metadata does not participate in browser runtime CRC checks.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(GAME_STATE_VERSION);
    if (version >= 2) {
      this.state.saveFileType = xfer.xferInt(this.state.saveFileType) as SaveFileType;
      this.state.missionMapName = xfer.xferAsciiString(this.state.missionMapName);
    }

    this.state.date.year = xfer.xferUnsignedShort(this.state.date.year);
    this.state.date.month = xfer.xferUnsignedShort(this.state.date.month);
    this.state.date.day = xfer.xferUnsignedShort(this.state.date.day);
    this.state.date.dayOfWeek = xfer.xferUnsignedShort(this.state.date.dayOfWeek);
    this.state.date.hour = xfer.xferUnsignedShort(this.state.date.hour);
    this.state.date.minute = xfer.xferUnsignedShort(this.state.date.minute);
    this.state.date.second = xfer.xferUnsignedShort(this.state.date.second);
    this.state.date.milliseconds = xfer.xferUnsignedShort(this.state.date.milliseconds);
    this.state.description = xfer.xferUnicodeString(this.state.description);
    this.state.mapLabel = xfer.xferAsciiString(this.state.mapLabel);
    this.state.campaignSide = xfer.xferAsciiString(this.state.campaignSide);
    this.state.missionNumber = xfer.xferInt(this.state.missionNumber);
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class MapSnapshot implements Snapshot {
  constructor(private readonly state: RuntimeSaveMapState) {}

  crc(_xfer: Xfer): void {
    // Browser runtime save/load currently does not contribute this block to network CRC.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(GAME_STATE_MAP_VERSION);
    this.state.saveGameMapPath = xfer.xferAsciiString(this.state.saveGameMapPath);
    this.state.pristineMapPath = xfer.xferAsciiString(this.state.pristineMapPath);
    if (version >= 2) {
      this.state.gameMode = xfer.xferInt(this.state.gameMode);
    }

    if (xfer.getMode() === XferMode.XFER_LOAD) {
      const embeddedMapSize = xfer.beginBlock();
      this.state.embeddedMapBytes = xfer.xferUser(new Uint8Array(embeddedMapSize));
      xfer.endBlock();
    } else {
      xfer.beginBlock();
      xfer.xferUser(this.state.embeddedMapBytes);
      xfer.endBlock();
    }

    this.state.objectIdCounter = xfer.xferObjectID(this.state.objectIdCounter);
    this.state.drawableIdCounter = xfer.xferUnsignedInt(this.state.drawableIdCounter);
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class BrowserRuntimeSnapshot implements Snapshot {
  payload: BrowserRuntimeSavePayload | null;

  constructor(payload: BrowserRuntimeSavePayload | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Browser runtime chunk is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(BROWSER_RUNTIME_STATE_VERSION);
    if (version !== BROWSER_RUNTIME_STATE_VERSION) {
      throw new Error(`Unsupported browser runtime save version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as BrowserRuntimeSavePayload;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

export function buildRuntimeSaveFile(params: {
  description: string;
  mapPath: string | null;
  mapData: MapDataJSON;
  cameraState: CameraState | null;
  gameLogic: Pick<GameLogicSubsystem, 'captureBrowserRuntimeSaveState' | 'getObjectIdCounter'>;
}): {
  data: ArrayBuffer;
  metadata: {
    description: string;
    mapName: string;
    timestamp: number;
    sizeBytes: number;
  };
} {
  const runtimePayload: BrowserRuntimeSavePayload = {
    version: BROWSER_RUNTIME_STATE_VERSION,
    mapPath: params.mapPath,
    cameraState: params.cameraState,
    gameLogicState: params.gameLogic.captureBrowserRuntimeSaveState(),
  };

  const metadataState = createMetadataState(params.description, params.mapPath);
  const mapState: RuntimeSaveMapState = {
    saveGameMapPath: params.mapPath ?? '',
    pristineMapPath: params.mapPath ?? '',
    gameMode: 0,
    embeddedMapBytes: encodeJsonBytes(params.mapData),
    objectIdCounter: params.gameLogic.getObjectIdCounter(),
    drawableIdCounter: params.gameLogic.getObjectIdCounter(),
  };

  const state = new GameState();
  state.addSnapshotBlock('CHUNK_GameState', new MetadataSnapshot(metadataState));
  state.addSnapshotBlock('CHUNK_GameStateMap', new MapSnapshot(mapState));
  state.addSnapshotBlock(BROWSER_RUNTIME_STATE_BLOCK, new BrowserRuntimeSnapshot(runtimePayload));
  const saveResult = state.saveGame(params.description);

  return {
    data: saveResult.data,
    metadata: {
      description: metadataState.description,
      mapName: metadataState.mapLabel,
      timestamp: Date.now(),
      sizeBytes: saveResult.data.byteLength,
    },
  };
}

export function parseRuntimeSaveFile(data: ArrayBuffer): RuntimeSaveBootstrap {
  const metadata = parseSaveGameInfo(data);
  const mapInfo = parseSaveGameMapInfo(data);

  const runtimeSnapshot = new BrowserRuntimeSnapshot();
  const state = new GameState();
  state.addSnapshotBlock(BROWSER_RUNTIME_STATE_BLOCK, runtimeSnapshot);
  const loadCode = state.loadGame(data);
  if (loadCode !== SaveCode.SC_OK || runtimeSnapshot.payload === null) {
    throw new Error(
      'This save file contains retail metadata, but no browser runtime snapshot block. ' +
      'Retail C++ save-state chunk restore is not wired yet.',
    );
  }

  const payload = runtimeSnapshot.payload;
  if (payload.version !== BROWSER_RUNTIME_STATE_VERSION) {
    throw new Error(`Unsupported browser runtime save payload version ${payload.version}`);
  }

  const resolvedMapPath = (
    typeof payload.mapPath === 'string' && payload.mapPath.length > 0
      ? payload.mapPath
      : (mapInfo.pristineMapPath || mapInfo.saveGameMapPath || null)
  );

  return {
    metadata,
    mapData: decodeJsonBytes<MapDataJSON>(mapInfo.embeddedMapData),
    mapPath: resolvedMapPath,
    cameraState: payload.cameraState,
    gameLogicState: payload.gameLogicState,
  };
}
