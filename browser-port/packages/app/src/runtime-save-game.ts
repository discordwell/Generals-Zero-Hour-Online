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
import {
  xferMapEntity,
  type GameDifficulty,
  type GameLogicCaveTrackerSaveState,
  type GameLogicBuildableOverrideSaveState,
  type GameLogicBridgeSegmentSaveState,
  type GameLogicControlBarOverrideSaveState,
  type GameLogicCoreSaveState,
  type GameLogicInGameUiSaveState,
  type GameLogicPlayerTunnelTrackerSaveState,
  type GameLogicRadarEventSaveState,
  type GameLogicRadarObjectSaveState,
  type GameLogicPlayersSaveState,
  type GameLogicRadarSaveState,
  type GameLogicScriptEngineSaveState,
  type GameLogicSellingEntitySaveState,
  type GameLogicSidesListSaveState,
  type GameLogicTeamFactorySaveState,
  type GameLogicTerrainLogicSaveState,
  type GameLogicTerrainWaterUpdateSaveState,
  type GameLogicSubsystem,
  type GameLogicTunnelTrackerSaveState,
  type LegacyGameLogicRadarSaveState,
  type MapEntity,
  type StructuredGameLogicRadarSaveState,
} from '@generals/game-logic';
import type { MapDataJSON } from '@generals/renderer';

const SOURCE_CAMPAIGN_BLOCK = 'CHUNK_Campaign';
const SOURCE_TERRAIN_LOGIC_BLOCK = 'CHUNK_TerrainLogic';
const SOURCE_TEAM_FACTORY_BLOCK = 'CHUNK_TeamFactory';
const SOURCE_PLAYERS_BLOCK = 'CHUNK_Players';
const SOURCE_RADAR_BLOCK = 'CHUNK_Radar';
const SOURCE_SCRIPT_ENGINE_BLOCK = 'CHUNK_ScriptEngine';
const SOURCE_SIDES_LIST_BLOCK = 'CHUNK_SidesList';
const SOURCE_TACTICAL_VIEW_BLOCK = 'CHUNK_TacticalView';
const SOURCE_IN_GAME_UI_BLOCK = 'CHUNK_InGameUI';
const SOURCE_GAME_LOGIC_BLOCK = 'CHUNK_GameLogic';
export const BROWSER_RUNTIME_STATE_BLOCK = 'CHUNK_TS_RuntimeState';

const GAME_STATE_VERSION = 2;
const CAMPAIGN_VERSION = 5;
const GAME_STATE_MAP_VERSION = 2;
const BROWSER_RUNTIME_STATE_VERSION = 1;
const SOURCE_TERRAIN_LOGIC_SNAPSHOT_VERSION = 2;
const SOURCE_PLAYER_SNAPSHOT_VERSION = 2;
const SOURCE_GAME_LOGIC_SNAPSHOT_VERSION = 7;
const SOURCE_RADAR_SNAPSHOT_VERSION = 2;
const SOURCE_RADAR_OBJECT_LIST_VERSION = 1;
const SOURCE_RADAR_EVENT_COUNT = 64;
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
  mapPath?: string | null;
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
  gameLogicTerrainLogicState: GameLogicTerrainLogicSaveState | null;
  gameLogicTeamFactoryState: GameLogicTeamFactorySaveState | null;
  gameLogicPlayersState: GameLogicPlayersSaveState | null;
  gameLogicRadarState: GameLogicRadarSaveState | null;
  gameLogicSidesListState: GameLogicSidesListSaveState | null;
  gameLogicScriptEngineState: GameLogicScriptEngineSaveState | null;
  gameLogicInGameUiState: GameLogicInGameUiSaveState | null;
  gameLogicCoreState: GameLogicCoreSaveState | null;
  gameLogicState: unknown | null;
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

function createEmptyTerrainLogicSaveState(): GameLogicTerrainLogicSaveState {
  return {
    version: SOURCE_TERRAIN_LOGIC_SNAPSHOT_VERSION,
    activeBoundary: 0,
    waterUpdates: [],
  };
}

function xferSourceTerrainWaterUpdate(
  xfer: Xfer,
  waterUpdate: GameLogicTerrainWaterUpdateSaveState,
): GameLogicTerrainWaterUpdateSaveState {
  return {
    triggerId: xfer.xferInt(waterUpdate.triggerId),
    changePerFrame: xfer.xferReal(waterUpdate.changePerFrame),
    targetHeight: xfer.xferReal(waterUpdate.targetHeight),
    damageAmount: xfer.xferReal(waterUpdate.damageAmount),
    currentHeight: xfer.xferReal(waterUpdate.currentHeight),
  };
}

class TerrainLogicSnapshot implements Snapshot {
  payload: GameLogicTerrainLogicSaveState | null;

  constructor(payload: GameLogicTerrainLogicSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Terrain-logic snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TERRAIN_LOGIC_SNAPSHOT_VERSION);
    if (version !== SOURCE_TERRAIN_LOGIC_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported terrain-logic snapshot version ${version}`);
    }

    const payload = this.payload ?? createEmptyTerrainLogicSaveState();
    payload.version = version;
    payload.activeBoundary = xfer.xferInt(payload.activeBoundary);

    const waterUpdateCount = xfer.xferInt(payload.waterUpdates.length);
    const waterUpdates: GameLogicTerrainWaterUpdateSaveState[] = [];
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      for (let index = 0; index < waterUpdateCount; index += 1) {
        waterUpdates.push(xferSourceTerrainWaterUpdate(xfer, {
          triggerId: 0,
          changePerFrame: 0,
          targetHeight: 0,
          damageAmount: 0,
          currentHeight: 0,
        }));
      }
    } else {
      for (const waterUpdate of payload.waterUpdates) {
        waterUpdates.push(xferSourceTerrainWaterUpdate(xfer, waterUpdate));
      }
    }
    payload.waterUpdates = waterUpdates;
    this.payload = payload;
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

function xferNullableAsciiString(xfer: Xfer, value: string | null): string | null {
  const hasValue = xfer.xferBool(value !== null && value.length > 0);
  if (hasValue) {
    return xfer.xferAsciiString(value ?? '');
  }
  return null;
}

function xferSourceTunnelTrackerState(
  xfer: Xfer,
  state: GameLogicTunnelTrackerSaveState,
): GameLogicTunnelTrackerSaveState {
  const tunnelIds = xfer.xferObjectIDList(state.tunnelIds);
  const savedPassengerCount = xfer.xferInt(state.passengerIds.length);
  if (savedPassengerCount < 0) {
    throw new Error(`Tunnel tracker passenger count ${savedPassengerCount} is invalid.`);
  }

  const passengerIds: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < savedPassengerCount; index += 1) {
      passengerIds.push(xfer.xferObjectID(0));
    }
  } else {
    for (const passengerId of state.passengerIds) {
      xfer.xferObjectID(passengerId);
      passengerIds.push(passengerId);
    }
  }

  const tunnelCount = xfer.xferUnsignedInt(state.tunnelCount);
  return {
    tunnelIds,
    passengerIds,
    tunnelCount,
  };
}

function xferSourcePlayerTunnelTrackers(
  xfer: Xfer,
  trackers: GameLogicPlayerTunnelTrackerSaveState[],
): GameLogicPlayerTunnelTrackerSaveState[] {
  const count = xfer.xferUnsignedShort(trackers.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicPlayerTunnelTrackerSaveState[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        side: xfer.xferAsciiString(''),
        tracker: xferSourceTunnelTrackerState(xfer, { tunnelIds: [], passengerIds: [], tunnelCount: 0 }),
      });
    }
    return loaded;
  }

  for (const tracker of trackers) {
    xfer.xferAsciiString(tracker.side);
    xferSourceTunnelTrackerState(xfer, tracker.tracker);
  }
  return trackers;
}

function xferSourceCaveTrackers(
  xfer: Xfer,
  trackers: GameLogicCaveTrackerSaveState[],
): GameLogicCaveTrackerSaveState[] {
  const count = xfer.xferUnsignedShort(trackers.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicCaveTrackerSaveState[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        caveIndex: xfer.xferInt(0),
        tracker: xferSourceTunnelTrackerState(xfer, { tunnelIds: [], passengerIds: [], tunnelCount: 0 }),
      });
    }
    return loaded;
  }

  for (const tracker of trackers) {
    xfer.xferInt(tracker.caveIndex);
    xferSourceTunnelTrackerState(xfer, tracker.tracker);
  }
  return trackers;
}

function encodeBuildableStatus(buildableStatus: string): number {
  switch (buildableStatus) {
    case 'IGNORE_PREREQUISITES':
      return 1;
    case 'NO':
      return 2;
    case 'ONLY_BY_AI':
      return 3;
    default:
      return 0;
  }
}

function decodeBuildableStatus(rawValue: number): GameLogicBuildableOverrideSaveState['buildableStatus'] {
  switch (rawValue) {
    case 1:
      return 'IGNORE_PREREQUISITES';
    case 2:
      return 'NO';
    case 3:
      return 'ONLY_BY_AI';
    default:
      return 'YES';
  }
}

function xferSourceSellingEntities(
  xfer: Xfer,
  entries: GameLogicSellingEntitySaveState[],
): GameLogicSellingEntitySaveState[] {
  const count = xfer.xferInt(entries.length);
  if (count < 0) {
    throw new Error(`Selling entity count ${count} is invalid.`);
  }
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicSellingEntitySaveState[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        entityId: xfer.xferObjectID(0),
        sellFrame: xfer.xferUnsignedInt(0),
      });
    }
    return loaded;
  }

  for (const entry of entries) {
    xfer.xferObjectID(entry.entityId);
    xfer.xferUnsignedInt(entry.sellFrame);
  }
  return entries;
}

function xferSourceBuildableOverrides(
  xfer: Xfer,
  overrides: GameLogicBuildableOverrideSaveState[],
): GameLogicBuildableOverrideSaveState[] {
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicBuildableOverrideSaveState[] = [];
    for (;;) {
      const templateName = xfer.xferAsciiString('');
      if (templateName.length === 0) {
        break;
      }
      loaded.push({
        templateName,
        buildableStatus: decodeBuildableStatus(xfer.xferUnsignedByte(0)),
      });
    }
    return loaded;
  }

  for (const override of overrides) {
    xfer.xferAsciiString(override.templateName);
    xfer.xferUnsignedByte(encodeBuildableStatus(override.buildableStatus));
  }
  xfer.xferAsciiString('');
  return overrides;
}

function xferSourceControlBarOverrides(
  xfer: Xfer,
  overrides: GameLogicControlBarOverrideSaveState[],
): GameLogicControlBarOverrideSaveState[] {
  const count = xfer.xferInt(overrides.length);
  if (count < 0) {
    throw new Error(`Control-bar override count ${count} is invalid.`);
  }
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicControlBarOverrideSaveState[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        commandSetName: xfer.xferAsciiString(''),
        slot: xfer.xferUnsignedByte(0),
        commandButtonName: xferNullableAsciiString(xfer, null),
      });
    }
    return loaded;
  }

  for (const override of overrides) {
    xfer.xferAsciiString(override.commandSetName);
    xfer.xferUnsignedByte(override.slot);
    xferNullableAsciiString(xfer, override.commandButtonName);
  }
  return overrides;
}

function xferSourceBridgeSegments(
  xfer: Xfer,
  segments: GameLogicBridgeSegmentSaveState[],
): GameLogicBridgeSegmentSaveState[] {
  const count = xfer.xferUnsignedInt(segments.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicBridgeSegmentSaveState[] = [];
    for (let index = 0; index < count; index += 1) {
      const segmentId = xfer.xferInt(0);
      const passable = xfer.xferBool(false);
      const cellIndices = xfer.xferIntList([]);
      const transitionIndices = xfer.xferIntList([]);
      const hasControlEntities = xfer.xferBool(false);
      const controlEntityIds = hasControlEntities ? xfer.xferObjectIDList([]) : undefined;
      const hasWorldEndpoints = xfer.xferBool(false);
      loaded.push({
        segmentId,
        passable,
        cellIndices,
        transitionIndices,
        controlEntityIds,
        startWorldX: hasWorldEndpoints ? xfer.xferReal(0) : undefined,
        startWorldZ: hasWorldEndpoints ? xfer.xferReal(0) : undefined,
        endWorldX: hasWorldEndpoints ? xfer.xferReal(0) : undefined,
        endWorldZ: hasWorldEndpoints ? xfer.xferReal(0) : undefined,
        startSurfaceY: hasWorldEndpoints ? xfer.xferReal(0) : undefined,
        endSurfaceY: hasWorldEndpoints ? xfer.xferReal(0) : undefined,
      });
    }
    return loaded;
  }

  for (const segment of segments) {
    xfer.xferInt(segment.segmentId);
    xfer.xferBool(segment.passable);
    xfer.xferIntList(segment.cellIndices);
    xfer.xferIntList(segment.transitionIndices);
    const controlEntityIds = segment.controlEntityIds ?? [];
    xfer.xferBool(controlEntityIds.length > 0);
    if (controlEntityIds.length > 0) {
      xfer.xferObjectIDList(controlEntityIds);
    }
    const hasWorldEndpoints =
      Number.isFinite(segment.startWorldX)
      && Number.isFinite(segment.startWorldZ)
      && Number.isFinite(segment.endWorldX)
      && Number.isFinite(segment.endWorldZ)
      && Number.isFinite(segment.startSurfaceY)
      && Number.isFinite(segment.endSurfaceY);
    xfer.xferBool(hasWorldEndpoints);
    if (hasWorldEndpoints) {
      xfer.xferReal(segment.startWorldX ?? 0);
      xfer.xferReal(segment.startWorldZ ?? 0);
      xfer.xferReal(segment.endWorldX ?? 0);
      xfer.xferReal(segment.endWorldZ ?? 0);
      xfer.xferReal(segment.startSurfaceY ?? 0);
      xfer.xferReal(segment.endSurfaceY ?? 0);
    }
  }
  return segments;
}

function xferSourceGameLogicCombatBridgeState(
  xfer: Xfer,
  payload: Pick<GameLogicCoreSaveState, 'pendingWeaponDamageEvents' | 'historicDamageLog'>,
): Pick<GameLogicCoreSaveState, 'pendingWeaponDamageEvents' | 'historicDamageLog'> {
  const serialized = xfer.xferLongString(JSON.stringify({
    pendingWeaponDamageEvents: payload.pendingWeaponDamageEvents ?? [],
    historicDamageLog: payload.historicDamageLog ?? [],
  }, runtimeJsonReplacer));
  if (serialized.length === 0) {
    return {
      pendingWeaponDamageEvents: [],
      historicDamageLog: [],
    };
  }
  const restored = JSON.parse(serialized, runtimeJsonReviver) as Partial<GameLogicCoreSaveState>;
  return {
    pendingWeaponDamageEvents: Array.isArray(restored.pendingWeaponDamageEvents)
      ? restored.pendingWeaponDamageEvents
      : [],
    historicDamageLog: Array.isArray(restored.historicDamageLog)
      ? restored.historicDamageLog
      : [],
  };
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
    const version = xfer.xferVersion(SOURCE_PLAYER_SNAPSHOT_VERSION);
    if (version === 1) {
      const serialized = xfer.xferLongString(
        this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
      );
      if (serialized.length === 0) {
        this.payload = null;
        return;
      }
      this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicPlayersSaveState;
      return;
    }
    if (version !== SOURCE_PLAYER_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported player snapshot version ${version}`);
    }

    const serializedState = xfer.xferLongString(
      this.payload === null
        ? ''
        : JSON.stringify(
            {
              version: this.payload.version,
              state: this.payload.state,
            },
            runtimeJsonReplacer,
          ),
    );
    const tunnelTrackers = xferSourcePlayerTunnelTrackers(
      xfer,
      this.payload?.tunnelTrackers ?? [],
    );

    if (serializedState.length === 0) {
      this.payload = null;
      return;
    }
    const basePayload = JSON.parse(serializedState, runtimeJsonReviver) as GameLogicPlayersSaveState;
    this.payload = {
      version: basePayload.version,
      state: basePayload.state,
      tunnelTrackers,
    };
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

function createEmptySourceRadarEventState(): GameLogicRadarEventSaveState {
  return {
    type: 0,
    active: false,
    createFrame: 0,
    dieFrame: 0,
    fadeFrame: 0,
    color1: { red: 0, green: 0, blue: 0, alpha: 0 },
    color2: { red: 0, green: 0, blue: 0, alpha: 0 },
    worldLoc: { x: 0, y: 0, z: 0 },
    radarLoc: { x: 0, y: 0 },
    soundPlayed: false,
    sourceEntityId: null,
    sourceTeamName: null,
  };
}

function createEmptyStructuredRadarSaveState(): StructuredGameLogicRadarSaveState {
  return {
    version: SOURCE_RADAR_SNAPSHOT_VERSION,
    radarHidden: false,
    radarForced: false,
    localObjectList: [],
    objectList: [],
    events: Array.from({ length: SOURCE_RADAR_EVENT_COUNT }, () => createEmptySourceRadarEventState()),
    nextFreeRadarEvent: 0,
    lastRadarEvent: -1,
  };
}

function xferSourceRadarObject(
  xfer: Xfer,
  objectState: GameLogicRadarObjectSaveState,
): GameLogicRadarObjectSaveState {
  const version = xfer.xferVersion(SOURCE_RADAR_OBJECT_LIST_VERSION);
  if (version !== SOURCE_RADAR_OBJECT_LIST_VERSION) {
    throw new Error(`Unsupported radar object snapshot version ${version}`);
  }

  return {
    objectId: xfer.xferObjectID(objectState.objectId),
    color: xfer.xferColor(objectState.color),
  };
}

function xferSourceRadarObjectList(
  xfer: Xfer,
  objectList: GameLogicRadarObjectSaveState[],
): GameLogicRadarObjectSaveState[] {
  const version = xfer.xferVersion(SOURCE_RADAR_OBJECT_LIST_VERSION);
  if (version !== SOURCE_RADAR_OBJECT_LIST_VERSION) {
    throw new Error(`Unsupported radar object list version ${version}`);
  }

  const count = xfer.xferUnsignedShort(objectList.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicRadarObjectSaveState[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xferSourceRadarObject(xfer, { objectId: 0, color: 0 }));
    }
    return loaded;
  }

  for (const objectState of objectList) {
    xferSourceRadarObject(xfer, objectState);
  }
  return objectList;
}

function xferSourceRadarEvent(
  xfer: Xfer,
  eventState: GameLogicRadarEventSaveState,
): GameLogicRadarEventSaveState {
  return {
    type: xfer.xferInt(eventState.type),
    active: xfer.xferBool(eventState.active),
    createFrame: xfer.xferUnsignedInt(eventState.createFrame),
    dieFrame: xfer.xferUnsignedInt(eventState.dieFrame),
    fadeFrame: xfer.xferUnsignedInt(eventState.fadeFrame),
    color1: xfer.xferRGBAColorInt(eventState.color1),
    color2: xfer.xferRGBAColorInt(eventState.color2),
    worldLoc: xfer.xferCoord3D(eventState.worldLoc),
    radarLoc: xfer.xferICoord2D(eventState.radarLoc),
    soundPlayed: xfer.xferBool(eventState.soundPlayed),
    sourceEntityId: xferNullableObjectId(xfer, eventState.sourceEntityId),
    sourceTeamName: xferNullableAsciiString(xfer, eventState.sourceTeamName),
  };
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
    const version = xfer.xferVersion(SOURCE_RADAR_SNAPSHOT_VERSION);
    if (version === 1) {
      const legacyPayload = this.payload?.version === 1 ? this.payload : null;
      const serialized = xfer.xferLongString(
        legacyPayload === null ? '' : JSON.stringify(legacyPayload, runtimeJsonReplacer),
      );
      if (serialized.length === 0) {
        this.payload = null;
        return;
      }
      this.payload = JSON.parse(serialized, runtimeJsonReviver) as LegacyGameLogicRadarSaveState;
      return;
    }
    if (version !== SOURCE_RADAR_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported radar snapshot version ${version}`);
    }

    const payload = this.payload?.version === SOURCE_RADAR_SNAPSHOT_VERSION
      ? this.payload
      : createEmptyStructuredRadarSaveState();
    payload.version = version;
    payload.radarHidden = xfer.xferBool(payload.radarHidden);
    payload.radarForced = xfer.xferBool(payload.radarForced);
    payload.localObjectList = xferSourceRadarObjectList(xfer, payload.localObjectList);
    payload.objectList = xferSourceRadarObjectList(xfer, payload.objectList);

    const eventCountVerify = SOURCE_RADAR_EVENT_COUNT;
    const eventCount = xfer.xferUnsignedShort(eventCountVerify);
    if (eventCount !== eventCountVerify) {
      throw new Error(
        `Radar snapshot event count mismatch: expected ${eventCountVerify}, got ${eventCount}`,
      );
    }

    const events: GameLogicRadarEventSaveState[] = [];
    for (let index = 0; index < eventCount; index += 1) {
      events.push(
        xferSourceRadarEvent(xfer, payload.events[index] ?? createEmptySourceRadarEventState()),
      );
    }
    payload.events = events;
    payload.nextFreeRadarEvent = xfer.xferInt(payload.nextFreeRadarEvent);
    payload.lastRadarEvent = xfer.xferInt(payload.lastRadarEvent);
    this.payload = payload;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class ScriptEngineSnapshot implements Snapshot {
  payload: GameLogicScriptEngineSaveState | null;

  constructor(payload: GameLogicScriptEngineSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Script-engine snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported script-engine snapshot version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicScriptEngineSaveState;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class SidesListSnapshot implements Snapshot {
  payload: GameLogicSidesListSaveState | null;

  constructor(payload: GameLogicSidesListSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Sides-list snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported sides-list snapshot version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicSidesListSaveState;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class TeamFactorySnapshot implements Snapshot {
  payload: GameLogicTeamFactorySaveState | null;

  constructor(payload: GameLogicTeamFactorySaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Team-factory snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(1);
    if (version !== 1) {
      throw new Error(`Unsupported team-factory snapshot version ${version}`);
    }

    const serialized = xfer.xferLongString(
      this.payload === null ? '' : JSON.stringify(this.payload, runtimeJsonReplacer),
    );
    if (serialized.length === 0) {
      this.payload = null;
      return;
    }
    this.payload = JSON.parse(serialized, runtimeJsonReviver) as GameLogicTeamFactorySaveState;
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
    const version = xfer.xferVersion(SOURCE_GAME_LOGIC_SNAPSHOT_VERSION);
    if (
      version !== 1
      && version !== 2
      && version !== 3
      && version !== 4
      && version !== 5
      && version !== 6
      && version !== SOURCE_GAME_LOGIC_SNAPSHOT_VERSION
    ) {
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
      const caveTrackers = version >= 2 ? xferSourceCaveTrackers(xfer, []) : [];
      const sellingEntities = version >= 3 ? xferSourceSellingEntities(xfer, []) : [];
      const buildableOverrides = version >= 3 ? xferSourceBuildableOverrides(xfer, []) : [];
      const controlBarOverrides = version >= 4 ? xferSourceControlBarOverrides(xfer, []) : [];
      const bridgeSegments = version >= 5 ? xferSourceBridgeSegments(xfer, []) : [];
      const combatBridgeState = version >= 6
        ? xferSourceGameLogicCombatBridgeState(xfer, {
            pendingWeaponDamageEvents: [],
            historicDamageLog: [],
          })
        : {
            pendingWeaponDamageEvents: [],
            historicDamageLog: [],
          };

      this.payload = {
        version: 1,
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
        rankLevelLimit: xfer.xferInt(0),
        difficultyBonusesInitialized: xfer.xferBool(false),
        scriptScoringEnabled: xfer.xferBool(true),
        gameRandomSeed: version >= 7 ? xfer.xferUnsignedInt(1) : undefined,
        spawnedEntities,
        caveTrackers,
        sellingEntities,
        buildableOverrides,
        controlBarOverrides,
        bridgeSegments,
        pendingWeaponDamageEvents: combatBridgeState.pendingWeaponDamageEvents,
        historicDamageLog: combatBridgeState.historicDamageLog,
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
    if (version >= 2) {
      xferSourceCaveTrackers(xfer, this.payload.caveTrackers ?? []);
    }
    if (version >= 3) {
      xferSourceSellingEntities(xfer, this.payload.sellingEntities ?? []);
      xferSourceBuildableOverrides(xfer, this.payload.buildableOverrides ?? []);
    }
    if (version >= 4) {
      xferSourceControlBarOverrides(xfer, this.payload.controlBarOverrides ?? []);
    }
    if (version >= 5) {
      xferSourceBridgeSegments(xfer, this.payload.bridgeSegments ?? []);
    }
    if (version >= 6) {
      xferSourceGameLogicCombatBridgeState(xfer, {
        pendingWeaponDamageEvents: this.payload.pendingWeaponDamageEvents ?? [],
        historicDamageLog: this.payload.historicDamageLog ?? [],
      });
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
    xfer.xferInt(this.payload.rankLevelLimit ?? 0);
    xfer.xferBool(this.payload.difficultyBonusesInitialized ?? false);
    xfer.xferBool(this.payload.scriptScoringEnabled ?? true);
    if (version >= 7) {
      xfer.xferUnsignedInt(this.payload.gameRandomSeed ?? 1);
    }
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
    | 'captureSourceTerrainLogicRuntimeSaveState'
    | 'captureSourceRadarRuntimeSaveState'
    | 'captureSourceSidesListRuntimeSaveState'
    | 'captureSourceTeamFactoryRuntimeSaveState'
    | 'captureSourceScriptEngineRuntimeSaveState'
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
    cameraState: buildBrowserRuntimeCameraSaveState(params.cameraState),
    gameLogicState: params.gameLogic.captureBrowserRuntimeSaveState(),
  };
  const tacticalViewPayload = params.tacticalViewState
    ?? buildTacticalViewSaveState(params.cameraState);
  const terrainLogicPayload = params.gameLogic.captureSourceTerrainLogicRuntimeSaveState();
  const radarPayload = params.gameLogic.captureSourceRadarRuntimeSaveState();
  const sidesListPayload = params.gameLogic.captureSourceSidesListRuntimeSaveState();
  const teamFactoryPayload = params.gameLogic.captureSourceTeamFactoryRuntimeSaveState();
  const scriptEnginePayload = params.gameLogic.captureSourceScriptEngineRuntimeSaveState();
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
  state.addSnapshotBlock(SOURCE_TERRAIN_LOGIC_BLOCK, new TerrainLogicSnapshot(terrainLogicPayload));
  state.addSnapshotBlock(SOURCE_TEAM_FACTORY_BLOCK, new TeamFactorySnapshot(teamFactoryPayload));
  state.addSnapshotBlock(SOURCE_PLAYERS_BLOCK, new PlayersSnapshot(playerPayload));
  state.addSnapshotBlock(SOURCE_GAME_LOGIC_BLOCK, new GameLogicSnapshot(gameLogicPayload));
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, new RadarSnapshot(radarPayload));
  state.addSnapshotBlock(SOURCE_SCRIPT_ENGINE_BLOCK, new ScriptEngineSnapshot(scriptEnginePayload));
  state.addSnapshotBlock(SOURCE_SIDES_LIST_BLOCK, new SidesListSnapshot(sidesListPayload));
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

  const campaignSnapshot = new CampaignSnapshot({
    currentCampaign: '',
    currentMission: '',
    currentRankPoints: 0,
    difficulty: 'NORMAL',
    isChallengeCampaign: false,
    playerTemplateNum: -1,
  });
  const terrainLogicSnapshot = new TerrainLogicSnapshot();
  const teamFactorySnapshot = new TeamFactorySnapshot();
  const playersSnapshot = new PlayersSnapshot();
  const gameLogicSnapshot = new GameLogicSnapshot();
  const radarSnapshot = new RadarSnapshot();
  const sidesListSnapshot = new SidesListSnapshot();
  const scriptEngineSnapshot = new ScriptEngineSnapshot();
  const tacticalViewSnapshot = new TacticalViewSnapshot();
  const inGameUiSnapshot = new InGameUiSnapshot();
  const runtimeSnapshot = new BrowserRuntimeSnapshot();
  const state = new GameState();
  state.addSnapshotBlock(SOURCE_CAMPAIGN_BLOCK, campaignSnapshot);
  state.addSnapshotBlock(SOURCE_TERRAIN_LOGIC_BLOCK, terrainLogicSnapshot);
  state.addSnapshotBlock(SOURCE_TEAM_FACTORY_BLOCK, teamFactorySnapshot);
  state.addSnapshotBlock(SOURCE_PLAYERS_BLOCK, playersSnapshot);
  state.addSnapshotBlock(SOURCE_GAME_LOGIC_BLOCK, gameLogicSnapshot);
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, radarSnapshot);
  state.addSnapshotBlock(SOURCE_SCRIPT_ENGINE_BLOCK, scriptEngineSnapshot);
  state.addSnapshotBlock(SOURCE_SIDES_LIST_BLOCK, sidesListSnapshot);
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
  const payload = runtimeSnapshot.payload;
  if (payload !== null && payload.version !== BROWSER_RUNTIME_STATE_VERSION) {
    throw new Error(`Unsupported browser runtime save payload version ${payload.version}`);
  }
  const browserCameraState = payload === null
    ? null
    : coerceBrowserRuntimeCameraSaveState(payload.cameraState);

  const resolvedMapPath = (
    mapInfo.pristineMapPath
    || mapInfo.saveGameMapPath
    || (
      typeof payload?.mapPath === 'string' && payload.mapPath.length > 0
        ? payload.mapPath
        : null
    )
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
    gameLogicTerrainLogicState: terrainLogicSnapshot?.payload ?? null,
    gameLogicTeamFactoryState: teamFactorySnapshot?.payload ?? null,
    gameLogicPlayersState: playersSnapshot?.payload ?? null,
    gameLogicRadarState: radarSnapshot?.payload ?? null,
    gameLogicSidesListState: sidesListSnapshot?.payload ?? null,
    gameLogicScriptEngineState: scriptEngineSnapshot?.payload ?? null,
    gameLogicInGameUiState: inGameUiSnapshot?.payload ?? null,
    gameLogicCoreState: gameLogicSnapshot?.payload ?? null,
    gameLogicState: payload?.gameLogicState ?? null,
    campaign,
  };
}
