import {
  GameState,
  SaveCode,
  SaveFileType,
  XferMode,
  listSaveGameChunks,
  parseSaveGameInfo,
  parseSaveGameMapInfo,
  type ParsedSaveGameInfo,
  type Snapshot,
  type Xfer,
} from '@generals/engine';
import type { CameraState } from '@generals/input';
import {
  xferMapEntity,
  type GameDifficulty,
  type GameLogicCoreSaveState,
  type GameLogicInGameUiSaveState,
  type GameLogicPlayersSaveState,
  type GameLogicRadarSaveState,
  type GameLogicSubsystem,
  type MapEntity,
} from '@generals/game-logic';
import type { MapDataJSON } from '@generals/renderer';

const SOURCE_CAMPAIGN_BLOCK = 'CHUNK_Campaign';
const SOURCE_PLAYERS_BLOCK = 'CHUNK_Players';
const SOURCE_RADAR_BLOCK = 'CHUNK_Radar';
const SOURCE_TACTICAL_VIEW_BLOCK = 'CHUNK_TacticalView';
const SOURCE_IN_GAME_UI_BLOCK = 'CHUNK_InGameUI';
const SOURCE_GAME_LOGIC_BLOCK = 'CHUNK_GameLogic';
export const BROWSER_RUNTIME_STATE_BLOCK = 'CHUNK_TS_RuntimeState';

const GAME_STATE_VERSION = 2;
const CAMPAIGN_VERSION = 5;
const GAME_STATE_MAP_VERSION = 2;
const BROWSER_RUNTIME_STATE_VERSION = 1;
const INVALID_MISSION_NUMBER = -1;
export const SOURCE_GAME_MODE_SINGLE_PLAYER = 0;
export const SOURCE_GAME_MODE_SKIRMISH = 2;
const SOURCE_DIFFICULTY_EASY = 0;
const SOURCE_DIFFICULTY_NORMAL = 1;
const SOURCE_DIFFICULTY_HARD = 2;

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

interface RuntimeSaveCampaignState {
  currentCampaign: string;
  currentMission: string;
  currentRankPoints: number;
  difficulty: GameDifficulty;
  isChallengeCampaign: boolean;
  playerTemplateNum: number;
}

export interface BrowserRuntimeCameraSaveState {
  zoom: number;
  pitch: number;
  targetX?: number;
  targetZ?: number;
  angle?: number;
}

export interface RuntimeSaveTacticalViewState {
  version: number;
  angle: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export interface BrowserRuntimeSavePayload {
  version: number;
  mapPath: string | null;
  cameraState: BrowserRuntimeCameraSaveState | null;
  gameLogicState: unknown;
}

export interface RuntimeSaveCampaignBootstrap {
  campaignName: string;
  missionName: string;
  missionNumber: number;
  difficulty: GameDifficulty;
  rankPoints: number;
  isChallengeCampaign: boolean;
  playerTemplateNum: number;
}

export interface RuntimeSaveBootstrap {
  metadata: ParsedSaveGameInfo;
  mapData: MapDataJSON | null;
  mapPath: string | null;
  cameraState: CameraState | null;
  tacticalViewState: RuntimeSaveTacticalViewState | null;
  gameLogicPlayersState: GameLogicPlayersSaveState | null;
  gameLogicRadarState: GameLogicRadarSaveState | null;
  gameLogicInGameUiState: GameLogicInGameUiSaveState | null;
  gameLogicCoreState: GameLogicCoreSaveState | null;
  gameLogicState: unknown;
  campaign: RuntimeSaveCampaignBootstrap | null;
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

function applyCampaignMetadata(
  metadata: RuntimeSaveMetadataState,
  campaign: RuntimeSaveCampaignBootstrap | null | undefined,
): void {
  if (!campaign) {
    return;
  }
  metadata.campaignSide = campaign.campaignName;
  metadata.missionNumber = campaign.missionNumber;
}

function encodeJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeJsonBytes<T>(bytes: ArrayBuffer | Uint8Array): T {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = new TextDecoder().decode(array);
  return JSON.parse(text, runtimeJsonReviver) as T;
}

function tryDecodeJsonBytes<T>(bytes: ArrayBuffer | Uint8Array): T | null {
  try {
    return decodeJsonBytes<T>(bytes);
  } catch {
    return null;
  }
}

function encodeSourceDifficulty(difficulty: GameDifficulty): number {
  switch (difficulty) {
    case 'EASY':
      return SOURCE_DIFFICULTY_EASY;
    case 'HARD':
      return SOURCE_DIFFICULTY_HARD;
    default:
      return SOURCE_DIFFICULTY_NORMAL;
  }
}

function decodeSourceDifficulty(rawDifficulty: number): GameDifficulty {
  switch (rawDifficulty) {
    case SOURCE_DIFFICULTY_EASY:
      return 'EASY';
    case SOURCE_DIFFICULTY_NORMAL:
      return 'NORMAL';
    case SOURCE_DIFFICULTY_HARD:
      return 'HARD';
    default:
      throw new Error(`Unsupported campaign difficulty value ${rawDifficulty}`);
  }
}

function buildBrowserRuntimeCameraSaveState(
  cameraState: CameraState | null,
): BrowserRuntimeCameraSaveState | null {
  if (cameraState === null) {
    return null;
  }
  return {
    zoom: cameraState.zoom,
    pitch: cameraState.pitch,
  };
}

function buildTacticalViewSaveState(
  cameraState: CameraState | null,
  targetY = 0,
): RuntimeSaveTacticalViewState {
  return {
    version: 1,
    angle: cameraState?.angle ?? 0,
    position: {
      x: cameraState?.targetX ?? 0,
      y: targetY,
      z: cameraState?.targetZ ?? 0,
    },
  };
}

function coerceBrowserRuntimeCameraSaveState(value: unknown): BrowserRuntimeCameraSaveState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const zoom = Number(record.zoom);
  const pitch = Number(record.pitch);
  if (!Number.isFinite(zoom) || !Number.isFinite(pitch)) {
    return null;
  }

  const state: BrowserRuntimeCameraSaveState = { zoom, pitch };
  const targetX = Number(record.targetX);
  const targetZ = Number(record.targetZ);
  const angle = Number(record.angle);
  if (Number.isFinite(targetX)) {
    state.targetX = targetX;
  }
  if (Number.isFinite(targetZ)) {
    state.targetZ = targetZ;
  }
  if (Number.isFinite(angle)) {
    state.angle = angle;
  }
  return state;
}

function resolveRestoredCameraState(
  tacticalViewState: RuntimeSaveTacticalViewState | null,
  browserCameraState: BrowserRuntimeCameraSaveState | null,
): CameraState | null {
  if (browserCameraState === null && tacticalViewState === null) {
    return null;
  }

  const targetX = tacticalViewState?.position.x ?? browserCameraState?.targetX;
  const targetZ = tacticalViewState?.position.z ?? browserCameraState?.targetZ;
  const angle = tacticalViewState?.angle ?? browserCameraState?.angle;
  const zoom = browserCameraState?.zoom;
  const pitch = browserCameraState?.pitch;
  if (
    !Number.isFinite(targetX)
    || !Number.isFinite(targetZ)
    || !Number.isFinite(angle)
    || !Number.isFinite(zoom)
    || !Number.isFinite(pitch)
  ) {
    return null;
  }

  return {
    targetX: Number(targetX),
    targetZ: Number(targetZ),
    angle: Number(angle),
    zoom: Number(zoom),
    pitch: Number(pitch),
  };
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

class CampaignSnapshot implements Snapshot {
  constructor(readonly state: RuntimeSaveCampaignState) {}

  crc(_xfer: Xfer): void {
    // Campaign save metadata does not participate in browser runtime CRC checks.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(CAMPAIGN_VERSION);
    this.state.currentCampaign = xfer.xferAsciiString(this.state.currentCampaign);
    this.state.currentMission = xfer.xferAsciiString(this.state.currentMission);

    if (version >= 2) {
      this.state.currentRankPoints = xfer.xferInt(this.state.currentRankPoints);
    }

    if (version >= 3) {
      this.state.difficulty = decodeSourceDifficulty(
        xfer.xferInt(encodeSourceDifficulty(this.state.difficulty)),
      );
    }

    if (version >= 4) {
      this.state.isChallengeCampaign = xfer.xferBool(this.state.isChallengeCampaign);
      if (this.state.isChallengeCampaign) {
        throw new Error(
          'Challenge campaign save-state interoperability is not wired yet. ' +
          'The CHUNK_Campaign challenge payload cannot be restored accurately.',
        );
      }
    }

    if (version >= 5) {
      this.state.playerTemplateNum = xfer.xferInt(this.state.playerTemplateNum);
    }
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

function xferNullableObjectId(xfer: Xfer, value: number | null): number | null {
  const hasValue = xfer.xferBool(value !== null);
  if (hasValue) {
    return xfer.xferObjectID(value ?? 0);
  }
  return null;
}

function xferNullableInt(xfer: Xfer, value: number | null): number | null {
  const hasValue = xfer.xferBool(value !== null);
  if (hasValue) {
    return xfer.xferInt(value ?? 0);
  }
  return null;
}

class PlayersSnapshot implements Snapshot {
  payload: GameLogicPlayersSaveState | null;

  constructor(payload: GameLogicPlayersSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Player snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported player snapshot version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicPlayersSaveState;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class RadarSnapshot implements Snapshot {
  payload: GameLogicRadarSaveState | null;

  constructor(payload: GameLogicRadarSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Radar snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported radar snapshot version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicRadarSaveState;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class TacticalViewSnapshot implements Snapshot {
  payload: RuntimeSaveTacticalViewState | null;

  constructor(payload: RuntimeSaveTacticalViewState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Tactical-view snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported tactical-view snapshot version ${version}`);
    }

    const payload = this.payload ?? {
      version,
      angle: 0,
      position: { x: 0, y: 0, z: 0 },
    };
    payload.version = version;
    payload.angle = xfer.xferReal(payload.angle);
    payload.position.x = xfer.xferReal(payload.position.x);
    payload.position.y = xfer.xferReal(payload.position.y);
    payload.position.z = xfer.xferReal(payload.position.z);
    this.payload = payload;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class InGameUiSnapshot implements Snapshot {
  payload: GameLogicInGameUiSaveState | null;

  constructor(payload: GameLogicInGameUiSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // In-game UI snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported in-game UI snapshot version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicInGameUiSaveState;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class GameLogicSnapshot implements Snapshot {
  payload: GameLogicCoreSaveState | null;

  constructor(payload: GameLogicCoreSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Game-logic snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported game-logic snapshot version ${version}`);
    }

    if (xfer.getMode() === XferMode.XFER_LOAD) {
      const defeatedSides = xfer.xferStringSet(new Set<string>());
      const selectedEntityIds = xfer.xferObjectIDList([]);
      const entityCount = xfer.xferUnsignedInt(0);
      const spawnedEntities: MapEntity[] = [];
      for (let index = 0; index < entityCount; index += 1) {
        xfer.beginBlock();
        const entity = {} as Record<string, unknown>;
        xferMapEntity(xfer, entity);
        xfer.endBlock();
        spawnedEntities.push(entity as unknown as MapEntity);
      }

      this.payload = {
        version,
        nextId: xfer.xferObjectID(0),
        nextProjectileVisualId: xfer.xferUnsignedInt(0),
        animationTime: xfer.xferReal(0),
        selectedEntityId: xferNullableObjectId(xfer, null),
        selectedEntityIds,
        scriptSelectionChangedFrame: xfer.xferInt(0),
        frameCounter: xfer.xferUnsignedInt(0),
        controlBarDirtyFrame: xfer.xferInt(0),
        scriptObjectTopologyVersion: xfer.xferUnsignedInt(0),
        scriptObjectCountChangedFrame: xfer.xferUnsignedInt(0),
        defeatedSides,
        gameEndFrame: xferNullableInt(xfer, null),
        scriptEndGameTimerActive: xfer.xferBool(false),
        spawnedEntities,
      };
      return;
    }

    if (this.payload === null) {
      throw new Error('Game-logic snapshot payload is missing during save.');
    }

    xfer.xferStringSet(this.payload.defeatedSides);
    xfer.xferObjectIDList([...this.payload.selectedEntityIds]);
    xfer.xferUnsignedInt(this.payload.spawnedEntities.length);
    for (const entity of this.payload.spawnedEntities) {
      xfer.beginBlock();
      xferMapEntity(xfer, entity as unknown as Record<string, unknown>);
      xfer.endBlock();
    }
    xfer.xferObjectID(this.payload.nextId);
    xfer.xferUnsignedInt(this.payload.nextProjectileVisualId);
    xfer.xferReal(this.payload.animationTime);
    xferNullableObjectId(xfer, this.payload.selectedEntityId);
    xfer.xferInt(this.payload.scriptSelectionChangedFrame);
    xfer.xferUnsignedInt(this.payload.frameCounter);
    xfer.xferInt(this.payload.controlBarDirtyFrame);
    xfer.xferUnsignedInt(this.payload.scriptObjectTopologyVersion);
    xfer.xferUnsignedInt(this.payload.scriptObjectCountChangedFrame);
    xferNullableInt(xfer, this.payload.gameEndFrame);
    xfer.xferBool(this.payload.scriptEndGameTimerActive);
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
  tacticalViewState?: RuntimeSaveTacticalViewState | null;
  gameLogic: Pick<
    GameLogicSubsystem,
    | 'captureBrowserRuntimeSaveState'
    | 'captureSourceRadarRuntimeSaveState'
    | 'captureSourceInGameUiRuntimeSaveState'
    | 'captureSourcePlayerRuntimeSaveState'
    | 'captureSourceGameLogicRuntimeSaveState'
    | 'getObjectIdCounter'
  >;
  embeddedMapBytes?: Uint8Array | null;
  sourceGameMode?: number;
  campaign?: RuntimeSaveCampaignBootstrap | null;
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
    cameraState: buildBrowserRuntimeCameraSaveState(params.cameraState),
    gameLogicState: params.gameLogic.captureBrowserRuntimeSaveState(),
  };
  const tacticalViewPayload = params.tacticalViewState
    ?? buildTacticalViewSaveState(params.cameraState);
  const radarPayload = params.gameLogic.captureSourceRadarRuntimeSaveState();
  const inGameUiPayload = params.gameLogic.captureSourceInGameUiRuntimeSaveState();
  const playerPayload = params.gameLogic.captureSourcePlayerRuntimeSaveState();
  const gameLogicPayload = params.gameLogic.captureSourceGameLogicRuntimeSaveState();

  const metadataState = createMetadataState(params.description, params.mapPath);
  const campaignState: RuntimeSaveCampaignState = {
    currentCampaign: params.campaign?.campaignName ?? '',
    currentMission: params.campaign?.missionName ?? '',
    currentRankPoints: params.campaign?.rankPoints ?? 0,
    difficulty: params.campaign?.difficulty ?? 'NORMAL',
    isChallengeCampaign: params.campaign?.isChallengeCampaign ?? false,
    playerTemplateNum: params.campaign?.playerTemplateNum ?? -1,
  };
  if (campaignState.isChallengeCampaign) {
    throw new Error(
      'Challenge campaign save-state interoperability is not wired yet. ' +
      'Saving challenge campaigns would produce an incomplete CHUNK_Campaign payload.',
    );
  }
  applyCampaignMetadata(metadataState, params.campaign ?? null);
  const mapState: RuntimeSaveMapState = {
    saveGameMapPath: params.mapPath ?? '',
    pristineMapPath: params.mapPath ?? '',
    gameMode: params.sourceGameMode ?? SOURCE_GAME_MODE_SINGLE_PLAYER,
    embeddedMapBytes: params.embeddedMapBytes ?? encodeJsonBytes(params.mapData),
    objectIdCounter: params.gameLogic.getObjectIdCounter(),
    drawableIdCounter: params.gameLogic.getObjectIdCounter(),
  };

  const state = new GameState();
  state.addSnapshotBlock('CHUNK_GameState', new MetadataSnapshot(metadataState));
  state.addSnapshotBlock(SOURCE_CAMPAIGN_BLOCK, new CampaignSnapshot(campaignState));
  state.addSnapshotBlock('CHUNK_GameStateMap', new MapSnapshot(mapState));
  state.addSnapshotBlock(SOURCE_PLAYERS_BLOCK, new PlayersSnapshot(playerPayload));
  state.addSnapshotBlock(SOURCE_GAME_LOGIC_BLOCK, new GameLogicSnapshot(gameLogicPayload));
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, new RadarSnapshot(radarPayload));
  state.addSnapshotBlock(SOURCE_TACTICAL_VIEW_BLOCK, new TacticalViewSnapshot(tacticalViewPayload));
  state.addSnapshotBlock(SOURCE_IN_GAME_UI_BLOCK, new InGameUiSnapshot(inGameUiPayload));
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
  const chunkNames = new Set(
    listSaveGameChunks(data).map((chunk) => chunk.blockName.toLowerCase()),
  );
  const hasBrowserRuntimeBlock = chunkNames.has(BROWSER_RUNTIME_STATE_BLOCK.toLowerCase());

  const campaignSnapshot = new CampaignSnapshot({
    currentCampaign: '',
    currentMission: '',
    currentRankPoints: 0,
    difficulty: 'NORMAL',
    isChallengeCampaign: false,
    playerTemplateNum: -1,
  });
  const playersSnapshot = new PlayersSnapshot();
  const gameLogicSnapshot = new GameLogicSnapshot();
  const radarSnapshot = new RadarSnapshot();
  const tacticalViewSnapshot = new TacticalViewSnapshot();
  const inGameUiSnapshot = new InGameUiSnapshot();
  const runtimeSnapshot = new BrowserRuntimeSnapshot();
  const state = new GameState();
  state.addSnapshotBlock(SOURCE_CAMPAIGN_BLOCK, campaignSnapshot);
  state.addSnapshotBlock(SOURCE_PLAYERS_BLOCK, playersSnapshot);
  state.addSnapshotBlock(SOURCE_GAME_LOGIC_BLOCK, gameLogicSnapshot);
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, radarSnapshot);
  state.addSnapshotBlock(SOURCE_TACTICAL_VIEW_BLOCK, tacticalViewSnapshot);
  state.addSnapshotBlock(SOURCE_IN_GAME_UI_BLOCK, inGameUiSnapshot);
  state.addSnapshotBlock(BROWSER_RUNTIME_STATE_BLOCK, runtimeSnapshot);
  const loadCode = state.loadGame(data);
  if (loadCode !== SaveCode.SC_OK) {
    const loadError = state.getLastLoadError();
    if (loadError) {
      throw loadError;
    }
    throw new Error('Runtime save load failed before the browser snapshot payload could be restored.');
  }
  if (!hasBrowserRuntimeBlock || runtimeSnapshot.payload === null) {
    throw new Error(
      'This save file contains retail metadata, but no browser runtime snapshot block. ' +
      'Retail C++ save-state chunk restore is not wired yet.',
    );
  }

  const payload = runtimeSnapshot.payload;
  if (payload.version !== BROWSER_RUNTIME_STATE_VERSION) {
    throw new Error(`Unsupported browser runtime save payload version ${payload.version}`);
  }
  const browserCameraState = coerceBrowserRuntimeCameraSaveState(payload.cameraState);

  const resolvedMapPath = (
    typeof payload.mapPath === 'string' && payload.mapPath.length > 0
      ? payload.mapPath
      : (mapInfo.pristineMapPath || mapInfo.saveGameMapPath || null)
  );
  const mapData = tryDecodeJsonBytes<MapDataJSON>(mapInfo.embeddedMapData);
  const campaign = campaignSnapshot.state.currentCampaign.length > 0
    ? {
        campaignName: campaignSnapshot.state.currentCampaign,
        missionName: campaignSnapshot.state.currentMission,
        missionNumber: metadata.missionNumber,
        difficulty: campaignSnapshot.state.difficulty,
        rankPoints: campaignSnapshot.state.currentRankPoints,
        isChallengeCampaign: campaignSnapshot.state.isChallengeCampaign,
        playerTemplateNum: campaignSnapshot.state.playerTemplateNum,
      }
    : null;

  return {
    metadata,
    mapData,
    mapPath: resolvedMapPath,
    cameraState: resolveRestoredCameraState(tacticalViewSnapshot.payload, browserCameraState),
    tacticalViewState: tacticalViewSnapshot.payload,
    gameLogicPlayersState: playersSnapshot?.payload ?? null,
    gameLogicRadarState: radarSnapshot?.payload ?? null,
    gameLogicInGameUiState: inGameUiSnapshot?.payload ?? null,
    gameLogicCoreState: gameLogicSnapshot?.payload ?? null,
    gameLogicState: payload.gameLogicState,
    campaign,
  };
}
