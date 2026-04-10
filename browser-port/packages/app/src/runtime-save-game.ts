import {
  GameState,
  SaveCode,
  SaveFileType,
  XferLoad,
  XferMode,
  XferSave,
  listSaveGameChunks,
  parseSaveGameInfo,
  parseSaveGameMapInfo,
  type ParsedSaveGameInfo,
  type Snapshot,
  type Xfer,
} from '@generals/engine';
import type { CameraState } from '@generals/input';
import * as THREE from 'three';
import {
  buildSourceMapEntityChunk,
  parseSourceMapEntityChunk,
  type MapEntityChunkLayoutInspection,
  type SourceMapEntitySaveState,
  SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME,
  WEAPON_SET_FLAG_MASK_BY_NAME,
  xferMapEntity,
  type GameDifficulty,
  type GameLogicCaveTrackerSaveState,
  type GameLogicBuildableOverrideSaveState,
  type GameLogicBridgeSegmentSaveState,
  type GameLogicControlBarOverrideSaveState,
  type GameLogicCoreSaveState,
  type GameLogicInGameUiSaveState,
  type GameLogicObjectXferOverlayState,
  type GameLogicObjectTriggerAreaSaveState,
  type GameLogicPlayerTunnelTrackerSaveState,
  type GameLogicRadarEventSaveState,
  type GameLogicRadarObjectSaveState,
  type GameLogicPlayersSaveState,
  type GameLogicPartitionSaveState,
  type GameLogicRadarSaveState,
  type GameLogicSourceScriptGroupSaveState,
  type GameLogicSourceScriptListSaveState,
  type GameLogicSourceScriptSaveState,
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
  type RenderableEntityState as GameLogicRenderableEntityState,
  type SourceInGameUiSuperweaponState,
  type StructuredGameLogicRadarSaveState,
} from '@generals/game-logic';
import type {
  MapDataJSON,
  ParticleSystemManagerSaveState,
} from '@generals/renderer';
import {
  SourceParticleSystemSnapshot,
  parseSourceParticleSystemChunk,
} from './runtime-particle-system-save.js';
import {
  applySourceTeamFactoryChunkToState,
  buildSourceTeamFactoryChunk,
} from './runtime-team-factory-save.js';
import type { ScriptCameraEffectFadeSaveState } from './script-camera-effects-runtime.js';

const SOURCE_CAMPAIGN_BLOCK = 'CHUNK_Campaign';
const SOURCE_TERRAIN_LOGIC_BLOCK = 'CHUNK_TerrainLogic';
const SOURCE_TEAM_FACTORY_BLOCK = 'CHUNK_TeamFactory';
const SOURCE_PLAYERS_BLOCK = 'CHUNK_Players';
const SOURCE_PARTITION_BLOCK = 'CHUNK_Partition';
const SOURCE_RADAR_BLOCK = 'CHUNK_Radar';
const SOURCE_SCRIPT_ENGINE_BLOCK = 'CHUNK_ScriptEngine';
const SOURCE_SIDES_LIST_BLOCK = 'CHUNK_SidesList';
const SOURCE_TACTICAL_VIEW_BLOCK = 'CHUNK_TacticalView';
const SOURCE_GAME_CLIENT_BLOCK = 'CHUNK_GameClient';
const SOURCE_IN_GAME_UI_BLOCK = 'CHUNK_InGameUI';
const SOURCE_GAME_LOGIC_BLOCK = 'CHUNK_GameLogic';
const SOURCE_PARTICLE_SYSTEM_BLOCK = 'CHUNK_ParticleSystem';
const SOURCE_TERRAIN_VISUAL_BLOCK = 'CHUNK_TerrainVisual';
const SOURCE_GHOST_OBJECT_BLOCK = 'CHUNK_GhostObject';
export const BROWSER_RUNTIME_STATE_BLOCK = 'CHUNK_TS_RuntimeState';
const SOURCE_FRAME_FOREVER = 0x3fffffff;
const SOURCE_UPDATE_PHASE_NORMAL = 2;
const SOURCE_UPDATE_PHASE_FINAL = 3;
const SOURCE_HELPER_MODULE_TAG_DEFECTION = 'ModuleTag_DefectionHelper';
const SOURCE_HELPER_MODULE_TAG_FIRING_TRACKER = 'ModuleTag_FiringTrackerHelper';
const SOURCE_HELPER_MODULE_TAG_SMC = 'ModuleTag_SMCHelper';
const SOURCE_HELPER_MODULE_TAG_REPULSOR = 'ModuleTag_RepulsorHelper';
const SOURCE_HELPER_MODULE_TAG_STATUS_DAMAGE = 'ModuleTag_StatusDamageHelper';
const SOURCE_HELPER_MODULE_TAG_WEAPON_STATUS = 'ModuleTag_WeaponStatusHelper';
const SOURCE_HELPER_MODULE_TAG_TEMP_WEAPON_BONUS = 'ModuleTag_TempWeaponBonusHelper';
const SOURCE_HELPER_MODULE_TAG_SUBDUAL_DAMAGE = 'ModuleTag_SubdualDamageHelper';
const SOURCE_SCRIPT_STATUS_DISABLED = 0x01;
const SOURCE_SCRIPT_STATUS_UNPOWERED = 0x02;
const SOURCE_SCRIPT_STATUS_UNSELLABLE = 0x04;
const SOURCE_SCRIPT_STATUS_UNSTEALTHED = 0x08;
const SOURCE_SCRIPT_STATUS_TARGETABLE = 0x10;
const SOURCE_DISABLED_NAMES_IN_ORDER = [
  'DEFAULT',
  'DISABLED_HACKED',
  'DISABLED_EMP',
  'DISABLED_HELD',
  'DISABLED_PARALYZED',
  'DISABLED_UNMANNED',
  'DISABLED_UNDERPOWERED',
  'DISABLED_FREEFALL',
  'DISABLED_AWESTRUCK',
  'DISABLED_BRAINWASHED',
  'DISABLED_SUBDUED',
  'DISABLED_SCRIPT_DISABLED',
  'DISABLED_SCRIPT_UNDERPOWERED',
] as const;
const SOURCE_DISABLED_NAME_SET = new Set<string>(SOURCE_DISABLED_NAMES_IN_ORDER);
const SOURCE_OBJECT_STATUS_NAME_SET = new Set<string>(SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.keys());
const SOURCE_OBJECT_STATUS_ALIASES = new Map<string, string>([
  ['BRAKING', 'IS_BRAKING'],
  ['IS_USING_ABILITY', 'USING_ABILITY'],
  ['CARBOMB', 'IS_CARBOMB'],
  ['RIDER1', 'STATUS_RIDER1'],
  ['RIDER2', 'STATUS_RIDER2'],
  ['RIDER3', 'STATUS_RIDER3'],
  ['RIDER4', 'STATUS_RIDER4'],
  ['RIDER5', 'STATUS_RIDER5'],
  ['RIDER6', 'STATUS_RIDER6'],
  ['RIDER7', 'STATUS_RIDER7'],
  ['RIDER8', 'STATUS_RIDER8'],
  ['MISSILE_KILLING_SELF', 'KILLING_SELF'],
]);

interface SourceObjectModuleSaveState {
  identifier: string;
  blockData: Uint8Array;
}

const SOURCE_SCRIPT_STATUS_BITS_BY_NAME = new Map<string, number>([
  ['SCRIPT_DISABLED', SOURCE_SCRIPT_STATUS_DISABLED],
  ['SCRIPT_UNPOWERED', SOURCE_SCRIPT_STATUS_UNPOWERED],
  ['SCRIPT_UNSELLABLE', SOURCE_SCRIPT_STATUS_UNSELLABLE],
  ['SCRIPT_UNSTEALTHED', SOURCE_SCRIPT_STATUS_UNSTEALTHED],
  ['SCRIPT_TARGETABLE', SOURCE_SCRIPT_STATUS_TARGETABLE],
]);
const SOURCE_WEAPON_LOCK_STATUS_BY_NAME = new Map<MapEntity['weaponLockStatus'], number>([
  ['NOT_LOCKED', 0],
  ['LOCKED_TEMPORARILY', 1],
  ['LOCKED_PERMANENTLY', 2],
]);
const EMPTY_STATUS_FLAG_SET = new Set<string>();
const PASSTHROUGH_BLOCK_ORDER = [
  SOURCE_GAME_LOGIC_BLOCK,
  SOURCE_GAME_CLIENT_BLOCK,
  SOURCE_IN_GAME_UI_BLOCK,
  SOURCE_PARTICLE_SYSTEM_BLOCK,
  SOURCE_TERRAIN_VISUAL_BLOCK,
  SOURCE_GHOST_OBJECT_BLOCK,
] as const;
const KNOWN_RUNTIME_SAVE_BLOCKS = new Set<string>([
  'CHUNK_GameState',
  SOURCE_CAMPAIGN_BLOCK,
  'CHUNK_GameStateMap',
  SOURCE_TERRAIN_LOGIC_BLOCK,
  SOURCE_TEAM_FACTORY_BLOCK,
  SOURCE_PLAYERS_BLOCK,
  SOURCE_GAME_LOGIC_BLOCK,
  SOURCE_RADAR_BLOCK,
  SOURCE_SCRIPT_ENGINE_BLOCK,
  SOURCE_SIDES_LIST_BLOCK,
  SOURCE_TACTICAL_VIEW_BLOCK,
  SOURCE_IN_GAME_UI_BLOCK,
  SOURCE_PARTITION_BLOCK,
  BROWSER_RUNTIME_STATE_BLOCK,
].map((name) => name.toLowerCase()));

const GAME_STATE_VERSION = 2;
const SOURCE_CAMPAIGN_SNAPSHOT_FRESH_VERSION = 3;
const SOURCE_CAMPAIGN_SNAPSHOT_MAX_VERSION = 5;
const GAME_STATE_MAP_VERSION = 2;
const BROWSER_RUNTIME_STATE_VERSION = 1;
const SOURCE_SKIRMISH_GAME_INFO_SNAPSHOT_VERSION = 4;
const SOURCE_SKIRMISH_GAME_SLOT_COUNT = 8;
const SOURCE_SKIRMISH_GAME_INFO_RELEASE_CRC_INTERVAL = 100;
const SOURCE_MONEY_SNAPSHOT_VERSION = 1;
const SOURCE_TERRAIN_LOGIC_SNAPSHOT_VERSION = 2;
const SOURCE_PARTITION_SNAPSHOT_VERSION = 2;
const SOURCE_PARTITION_CELL_SNAPSHOT_VERSION = 1;
const SOURCE_PARTITION_PLAYER_COUNT = 8;
const LEGACY_PLAYER_SNAPSHOT_VERSION = 2;
const SOURCE_PLAYERS_LIST_SNAPSHOT_VERSION = 1;
const SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION = 8;
const SOURCE_UPGRADE_SNAPSHOT_VERSION = 1;
const SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION = 1;
const SOURCE_ENERGY_SNAPSHOT_VERSION = 3;
const SOURCE_BUILD_LIST_INFO_SNAPSHOT_VERSION = 2;
const SOURCE_AI_PLAYER_SNAPSHOT_VERSION = 1;
const SOURCE_AI_SKIRMISH_PLAYER_SNAPSHOT_VERSION = 1;
const SOURCE_TEAM_IN_QUEUE_SNAPSHOT_VERSION = 1;
const SOURCE_WORK_ORDER_SNAPSHOT_VERSION = 1;
const SOURCE_RESOURCE_GATHERING_MANAGER_SNAPSHOT_VERSION = 1;
const SOURCE_TUNNEL_TRACKER_SNAPSHOT_VERSION = 1;
const SOURCE_SCORE_KEEPER_SNAPSHOT_VERSION = 1;
const SOURCE_SQUAD_SNAPSHOT_VERSION = 1;
const SOURCE_PLAYER_HOTKEY_SQUAD_COUNT = 10;
const SOURCE_SIDES_LIST_SAVE_STATE_VERSION = 2;
const SOURCE_GAME_LOGIC_SNAPSHOT_VERSION = 10;
const SOURCE_GAME_CLIENT_SNAPSHOT_VERSION = 3;
const SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION = 1;
const SOURCE_TERRAIN_VISUAL_SNAPSHOT_VERSION = 1;
const SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION = 1;
const SOURCE_RADAR_SNAPSHOT_VERSION = 2;
const SOURCE_RADAR_OBJECT_LIST_VERSION = 1;
const SOURCE_SCRIPT_ENGINE_SNAPSHOT_VERSION = 5;
const SOURCE_IN_GAME_UI_SNAPSHOT_VERSION = 3;
const SOURCE_RADAR_EVENT_COUNT = 64;
const SOURCE_SCRIPT_ENGINE_MAX_COUNTERS = 256;
const SOURCE_SCRIPT_ENGINE_MAX_FLAGS = 256;
const SOURCE_SCRIPT_ENGINE_MAX_ATTACK_PRIORITIES = 256;
const SOURCE_SCRIPT_ENGINE_PLAYER_COUNT = 16;
const SOURCE_SCRIPT_ENGINE_FIRST_LOAD_FADE_DECREASE_FRAMES = 33;
const INVALID_MISSION_NUMBER = -1;
export const SOURCE_GAME_MODE_SINGLE_PLAYER = 0;
export const SOURCE_GAME_MODE_SKIRMISH = 2;
const SOURCE_DIFFICULTY_EASY = 0;
const SOURCE_DIFFICULTY_NORMAL = 1;
const SOURCE_DIFFICULTY_HARD = 2;
const SOURCE_SLOT_STATE_CLOSED = 1;
const SOURCE_SLOT_STATE_PLAYER = 5;
const SOURCE_IN_GAME_UI_TIMESTAMP_UNINITIALIZED = 0xFFFFFFFF;
const DRAWABLE_STATUS_SHADOWS = 0x00000002;
const NUM_DRAWABLE_MODULE_TYPES = 2;
const TERRAIN_DECAL_NONE = 0;
const FADING_NONE = 0;
const STEALTHLOOK_NONE = 0;
const SOURCE_SCRIPT_ENGINE_FADE_NONE = 0;
const SOURCE_SCRIPT_ENGINE_FADE_SUBTRACT = 1;
const SOURCE_SCRIPT_ENGINE_FADE_ADD = 2;
const SOURCE_SCRIPT_ENGINE_FADE_SATURATE = 3;
const SOURCE_SCRIPT_ENGINE_FADE_MULTIPLY = 4;

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
  version: number;
  currentCampaign: string;
  currentMission: string;
  currentRankPoints: number;
  difficulty: GameDifficulty;
  isChallengeCampaign: boolean;
  playerTemplateNum: number;
  challengeGameInfoState: RuntimeSaveChallengeGameInfoState | null;
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
  version?: number;
  campaignName: string;
  missionName: string;
  missionNumber: number;
  difficulty: GameDifficulty;
  rankPoints: number;
  isChallengeCampaign: boolean;
  playerTemplateNum: number;
  sourceMapName?: string | null;
  playerDisplayName?: string | null;
  challengeGameInfoState?: RuntimeSaveChallengeGameInfoState | null;
}

export interface RuntimeSaveChallengeGameSlotState {
  state: number;
  name: string;
  isAccepted: boolean;
  isMuted: boolean;
  color: number;
  startPos: number;
  playerTemplate: number;
  teamNumber: number;
  origColor: number;
  origStartPos: number;
  origPlayerTemplate: number;
}

export interface RuntimeSaveChallengeGameInfoState {
  version: number;
  preorderMask: number;
  crcInterval: number;
  inGame: boolean;
  inProgress: boolean;
  surrendered: boolean;
  gameId: number;
  slots: RuntimeSaveChallengeGameSlotState[];
  localIp: number;
  mapName: string;
  mapCrc: number;
  mapSize: number;
  mapMask: number;
  seed: number;
  superweaponRestriction: number;
  startingCash: number;
}

export interface RuntimeSaveGameClientState {
  version: number;
  prefixBytes: ArrayBuffer;
  briefingLines: string[];
  drawables: readonly RuntimeSaveRawGameClientDrawableState[];
}

export interface RuntimeSaveInGameUiNamedTimerState {
  timerName: string;
  timerText: string;
  isCountdown: boolean;
}

export interface RuntimeSaveInGameUiSuperweaponState {
  playerIndex: number;
  templateName: string;
  powerName: string;
  objectId: number;
  timestamp: number;
  hiddenByScript: boolean;
  hiddenByScience: boolean;
  ready: boolean;
  evaReadyPlayed: boolean;
}

export interface RuntimeSaveTrackedInGameUiSuperweaponState {
  timestamp: number;
  evaReadyPlayed: boolean;
}

export interface RuntimeSaveInGameUiState {
  version: number;
  namedTimerLastFlashFrame: number;
  namedTimerUsedFlashColor: boolean;
  showNamedTimers: boolean;
  namedTimers: RuntimeSaveInGameUiNamedTimerState[];
  superweaponHiddenByScript: boolean;
  superweapons: RuntimeSaveInGameUiSuperweaponState[];
}

interface RuntimeSaveDrawableSnapshotState {
  readonly drawableId: number;
  readonly objectId: number;
  readonly templateName: string;
  readonly modelConditionFlags: readonly string[];
  readonly transformMatrixBytes: Uint8Array;
  readonly statusBits: number;
  readonly explicitOpacity: number;
  readonly stealthOpacity: number;
  readonly effectiveStealthOpacity: number;
  readonly ambientSoundEnabled: boolean;
  readonly ambientSoundEnabledFromScript: boolean;
  readonly flashCount: number;
  readonly flashColor: number;
  readonly hidden: boolean;
  readonly hiddenByStealth: boolean;
  readonly shroudStatusObjectId: number;
}

interface RuntimeSaveRawGameClientDrawableState {
  readonly templateName: string;
  readonly objectId: number;
  readonly blockData: ArrayBuffer;
}

type RuntimeSaveGameClientDrawableEntry =
  | {
      readonly kind: 'generated';
      readonly state: RuntimeSaveDrawableSnapshotState;
    }
  | {
      readonly kind: 'raw';
      readonly state: RuntimeSaveRawGameClientDrawableState;
    };

export interface RuntimeSavePassthroughBlock {
  blockName: string;
  blockData: ArrayBuffer;
}

export interface RuntimeSaveBootstrap {
  metadata: ParsedSaveGameInfo;
  mapData: MapDataJSON | null;
  mapPath: string | null;
  mapObjectIdCounter: number;
  mapDrawableIdCounter: number;
  cameraState: CameraState | null;
  tacticalViewState: RuntimeSaveTacticalViewState | null;
  gameClientState: RuntimeSaveGameClientState | null;
  inGameUiState: RuntimeSaveInGameUiState | null;
  particleSystemState: ParticleSystemManagerSaveState | null;
  sourceTeamFactoryChunkData: Uint8Array | null;
  gameLogicTerrainLogicState: GameLogicTerrainLogicSaveState | null;
  gameLogicTeamFactoryState: GameLogicTeamFactorySaveState | null;
  gameLogicPlayersState: GameLogicPlayersSaveState | null;
  gameLogicPartitionState: GameLogicPartitionSaveState | null;
  gameLogicRadarState: GameLogicRadarSaveState | null;
  gameLogicSidesListState: GameLogicSidesListSaveState | null;
  gameLogicScriptEngineState: GameLogicScriptEngineSaveState | null;
  scriptEngineFadeState: ScriptCameraEffectFadeSaveState | null;
  gameLogicInGameUiState: GameLogicInGameUiSaveState | null;
  gameLogicCoreState: GameLogicCoreSaveState | null;
  gameLogicState: unknown | null;
  sourceGameLogicPrototypeNames: readonly string[] | null;
  campaign: RuntimeSaveCampaignBootstrap | null;
  passthroughBlocks: RuntimeSavePassthroughBlock[];
}

export type RuntimeSaveCoreChunkMode =
  | 'parsed'
  | 'legacy'
  | 'raw_passthrough'
  | 'missing';

export interface RuntimeSaveCoreChunkStatus {
  blockName: string;
  mode: RuntimeSaveCoreChunkMode;
}

export interface RuntimeSaveGameLogicChunkLayoutInspection {
  layout: 'source_outer' | 'legacy' | 'unknown';
  version: number | null;
  frameCounter: number | null;
  objectTocCount: number | null;
  objectCount: number | null;
  firstObjectTemplateName: string | null;
  firstObjectTocId: number | null;
  firstObjectVersion: number | null;
  firstObjectInternalName: string | null;
  firstObjectTeamId: number | null;
  firstObjectLayout: MapEntityChunkLayoutInspection | null;
  reason?: string;
}

interface ParsedSourceGameLogicObjectState {
  tocId: number;
  templateName: string | null;
  blockData: ArrayBuffer;
  state: SourceMapEntitySaveState;
}

interface ParsedSourceGameLogicControlBarOverrideState {
  name: string;
  commandButtonName: string | null;
}

interface ParsedSourceGameLogicPolygonTriggerState {
  triggerId: number;
  snapshot: SourcePolygonTriggerSnapshotState;
}

interface ParsedSourceGameLogicChunkState {
  version: number;
  frameCounter: number;
  objectTocEntries: Array<{ templateName: string; tocId: number }>;
  objects: ParsedSourceGameLogicObjectState[];
  campaignState: RuntimeSaveCampaignState;
  caveTrackers: GameLogicCaveTrackerSaveState[];
  scriptScoringEnabled: boolean;
  polygonTriggers: ParsedSourceGameLogicPolygonTriggerState[];
  rankLevelLimit: number | null;
  sellingEntities: GameLogicSellingEntitySaveState[];
  buildableOverrides: GameLogicBuildableOverrideSaveState[];
  showBehindBuildingMarkers: boolean | null;
  drawIconUI: boolean | null;
  showDynamicLOD: boolean | null;
  scriptHulkMaxLifetimeOverride: number | null;
  controlBarOverrideEntries: ParsedSourceGameLogicControlBarOverrideState[];
  rankPointsToAddAtGameStart: number | null;
  superweaponRestriction: number | null;
}

function getLeafName(path: string | null): string {
  if (!path) {
    return 'Embedded Map';
  }
  const normalized = path.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  return leaf.replace(/\.[^.]+$/, '') || leaf;
}

function createDefaultRuntimeSaveInGameUiState(): RuntimeSaveInGameUiState {
  return {
    version: SOURCE_IN_GAME_UI_SNAPSHOT_VERSION,
    namedTimerLastFlashFrame: 0,
    namedTimerUsedFlashColor: false,
    showNamedTimers: true,
    namedTimers: [],
    superweaponHiddenByScript: false,
    superweapons: [],
  };
}

function getScriptEngineStateRecord(
  payload: GameLogicScriptEngineSaveState | null | undefined,
): Record<string, unknown> {
  return payload?.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : {};
}

function getRuntimeStateMap<T = unknown>(
  state: Record<string, unknown>,
  key: string,
): Map<string | number, T> {
  const value = state[key];
  return value instanceof Map ? value as Map<string | number, T> : new Map();
}

function getRuntimeStateArray<T = unknown>(
  state: Record<string, unknown>,
  key: string,
): T[] {
  const value = state[key];
  return Array.isArray(value) ? value as T[] : [];
}

function getRuntimeStateBoolean(
  state: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = state[key];
  return typeof value === 'boolean' ? value : fallback;
}

function getRuntimeStateNumber(
  state: Record<string, unknown>,
  key: string,
  fallback = 0,
): number {
  const value = state[key];
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeOptionalAsciiString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function createEmptyScriptEngineFadeState(): ScriptCameraEffectFadeSaveState {
  return {
    fadeType: 'MULTIPLY',
    minFade: 1,
    maxFade: 0,
    currentFadeValue: 0,
    currentFadeFrame: 0,
    increaseFrames: 0,
    holdFrames: 0,
    decreaseFrames: SOURCE_SCRIPT_ENGINE_FIRST_LOAD_FADE_DECREASE_FRAMES,
  };
}

function normalizeScriptEngineFadeTypeToSourceValue(
  fadeType: ScriptCameraEffectFadeSaveState['fadeType'] | null,
): number {
  switch (fadeType) {
    case 'SUBTRACT':
      return SOURCE_SCRIPT_ENGINE_FADE_SUBTRACT;
    case 'ADD':
      return SOURCE_SCRIPT_ENGINE_FADE_ADD;
    case 'SATURATE':
      return SOURCE_SCRIPT_ENGINE_FADE_SATURATE;
    case 'MULTIPLY':
      return SOURCE_SCRIPT_ENGINE_FADE_MULTIPLY;
    default:
      return SOURCE_SCRIPT_ENGINE_FADE_NONE;
  }
}

function normalizeSourceFadeValueToScriptEngineFadeType(
  fadeType: number,
): ScriptCameraEffectFadeSaveState['fadeType'] | null {
  switch (Math.trunc(fadeType)) {
    case SOURCE_SCRIPT_ENGINE_FADE_SUBTRACT:
      return 'SUBTRACT';
    case SOURCE_SCRIPT_ENGINE_FADE_ADD:
      return 'ADD';
    case SOURCE_SCRIPT_ENGINE_FADE_SATURATE:
      return 'SATURATE';
    case SOURCE_SCRIPT_ENGINE_FADE_MULTIPLY:
      return 'MULTIPLY';
    default:
      return null;
  }
}

function resolveSourceDifficultyValue(difficulty: GameDifficulty | null | undefined): number {
  switch (difficulty) {
    case 'EASY':
      return SOURCE_DIFFICULTY_EASY;
    case 'HARD':
      return SOURCE_DIFFICULTY_HARD;
    case 'NORMAL':
    default:
      return SOURCE_DIFFICULTY_NORMAL;
  }
}

function resolveDifficultyFromSourceValue(difficulty: number): GameDifficulty {
  switch (Math.trunc(difficulty)) {
    case SOURCE_DIFFICULTY_EASY:
      return 'EASY';
    case SOURCE_DIFFICULTY_HARD:
      return 'HARD';
    default:
      return 'NORMAL';
  }
}

function createEmptyRuntimeSaveTeamFactoryState(): GameLogicTeamFactorySaveState {
  return {
    version: 1,
    state: {
      scriptTeamsByName: new Map<string, unknown>(),
      scriptTeamInstanceNamesByPrototypeName: new Map<string, string[]>(),
      scriptNextSourceTeamId: 1,
      scriptNextSourceTeamPrototypeId: 1,
    },
  };
}

function getPlayerSideByIndexMap(
  playerState: GameLogicPlayersSaveState | null | undefined,
): Map<number, string> {
  const value = playerState?.state.playerSideByIndex;
  return value instanceof Map ? value as Map<number, string> : new Map();
}

function getPlayerIndexBySideMap(
  playerState: GameLogicPlayersSaveState | null | undefined,
): Map<string, number> {
  const value = playerState?.state.sidePlayerIndex;
  return value instanceof Map ? value as Map<string, number> : new Map();
}

function resolvePlayerIndexForScriptSide(
  side: string,
  playerState: GameLogicPlayersSaveState | null | undefined,
): number {
  const normalizedSide = side.trim();
  if (!normalizedSide) {
    return -1;
  }
  const sidePlayerIndex = getPlayerIndexBySideMap(playerState);
  const direct = sidePlayerIndex.get(normalizedSide);
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }
  const normalizedUpper = normalizedSide.toUpperCase();
  for (const [candidateSide, playerIndex] of sidePlayerIndex) {
    if (candidateSide.trim().toUpperCase() === normalizedUpper) {
      return Math.trunc(playerIndex);
    }
  }
  for (const [playerIndex, candidateSide] of getPlayerSideByIndexMap(playerState)) {
    if (candidateSide.trim().toUpperCase() === normalizedUpper) {
      return Math.trunc(playerIndex);
    }
  }
  return -1;
}

function resolveSideForPlayerIndex(
  playerIndex: number,
  playerState: GameLogicPlayersSaveState | null | undefined,
): string {
  return getPlayerSideByIndexMap(playerState).get(Math.trunc(playerIndex)) ?? '';
}

function resolveSourceTeamIdByName(
  teamNameUpper: string | null,
  teamFactoryState: GameLogicTeamFactorySaveState | null | undefined,
): number {
  if (!teamNameUpper) {
    return 0;
  }
  const teamsByName = teamFactoryState?.state.scriptTeamsByName;
  if (!(teamsByName instanceof Map)) {
    return 0;
  }
  const team = teamsByName.get(teamNameUpper);
  const sourceTeamId = team && typeof team === 'object'
    ? Number((team as { sourceTeamId?: unknown }).sourceTeamId)
    : NaN;
  return Number.isFinite(sourceTeamId) ? Math.max(0, Math.trunc(sourceTeamId)) : 0;
}

function resolveTeamNameBySourceId(
  sourceTeamId: number,
  teamFactoryState: GameLogicTeamFactorySaveState | null | undefined,
): string | null {
  if (!Number.isFinite(sourceTeamId) || Math.trunc(sourceTeamId) === 0) {
    return null;
  }
  const teamsByName = teamFactoryState?.state.scriptTeamsByName;
  if (!(teamsByName instanceof Map)) {
    return null;
  }
  const targetId = Math.trunc(sourceTeamId);
  for (const [teamNameUpper, team] of teamsByName) {
    if (!team || typeof team !== 'object') {
      continue;
    }
    const candidateId = Number((team as { sourceTeamId?: unknown }).sourceTeamId);
    if (Number.isFinite(candidateId) && Math.trunc(candidateId) === targetId) {
      return typeof teamNameUpper === 'string' ? teamNameUpper : null;
    }
  }
  return null;
}

function resolveScriptNameByEntityId(
  entityId: number,
  coreState: GameLogicCoreSaveState | null | undefined,
  sourceGameLogicState?: ParsedSourceGameLogicChunkState | null,
): string {
  if (!Number.isFinite(entityId) || Math.trunc(entityId) === 0) {
    return '';
  }
  const targetId = Math.trunc(entityId);
  const entity = coreState?.spawnedEntities.find((candidate) => candidate.id === targetId);
  if (entity?.scriptName?.trim()) {
    return entity.scriptName.trim();
  }
  const sourceEntity = sourceGameLogicState?.objects.find((candidate) => candidate.state.objectId === targetId);
  return sourceEntity?.state.internalName.trim() ?? '';
}

function resolveEntityIdByScriptName(
  scriptName: string,
  coreState: GameLogicCoreSaveState | null | undefined,
  namedEntitiesByName: Map<string, number>,
  sourceGameLogicState?: ParsedSourceGameLogicChunkState | null,
): number | null {
  const normalized = scriptName.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  const existingId = namedEntitiesByName.get(normalized);
  if (typeof existingId === 'number' && Number.isFinite(existingId) && Math.trunc(existingId) > 0) {
    return Math.trunc(existingId);
  }
  const entity = coreState?.spawnedEntities.find((candidate) => candidate.scriptName?.trim().toUpperCase() === normalized);
  if (entity) {
    return entity.id;
  }
  const sourceEntity = sourceGameLogicState?.objects.find(
    (candidate) => candidate.state.internalName.trim().toUpperCase() === normalized,
  );
  return sourceEntity ? sourceEntity.state.objectId : null;
}

function resolveWaypointPositionByName(
  mapData: MapDataJSON | null | undefined,
  waypointName: string,
): { x: number; z: number } | null {
  const normalized = waypointName.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  const node = mapData?.waypoints?.nodes.find((candidate) => candidate.name.trim().toUpperCase() === normalized);
  return node ? { x: node.position.x, z: node.position.z } : null;
}

function xferScriptEngineAsciiStringUIntEntries(
  xfer: Xfer,
  entries: Array<[string, number]>,
): Array<[string, number]> {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine string/u32 list snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: Array<[string, number]> = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push([
        xfer.xferAsciiString(''),
        xfer.xferUnsignedInt(0),
      ]);
    }
    return loaded;
  }
  for (const [name, value] of entries) {
    xfer.xferAsciiString(name);
    xfer.xferUnsignedInt(Math.max(0, Math.trunc(value)) >>> 0);
  }
  return entries;
}

function xferScriptEngineAsciiStringEntries(
  xfer: Xfer,
  entries: string[],
): string[] {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine string list snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: string[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const entry of entries) {
    xfer.xferAsciiString(entry);
  }
  return entries;
}

function xferScriptEngineAsciiStringObjectIdEntries(
  xfer: Xfer,
  entries: Array<[string, number]>,
): Array<[string, number]> {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine string/object-id list snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: Array<[string, number]> = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push([
        xfer.xferAsciiString(''),
        xfer.xferObjectID(0),
      ]);
    }
    return loaded;
  }
  for (const [name, objectId] of entries) {
    xfer.xferAsciiString(name);
    xfer.xferObjectID(Math.max(0, Math.trunc(objectId)));
  }
  return entries;
}

function xferScriptEngineAsciiStringCoord3DEntries(
  xfer: Xfer,
  entries: Array<[string, { x: number; y: number; z: number }]>,
): Array<[string, { x: number; y: number; z: number }]> {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine string/coord list snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: Array<[string, { x: number; y: number; z: number }]> = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push([
        xfer.xferAsciiString(''),
        xfer.xferCoord3D({ x: 0, y: 0, z: 0 }),
      ]);
    }
    return loaded;
  }
  for (const [name, coord] of entries) {
    xfer.xferAsciiString(name);
    xfer.xferCoord3D(coord);
  }
  return entries;
}

function xferScriptEngineScienceNames(
  xfer: Xfer,
  sciences: string[],
): string[] {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine science list snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(sciences.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: string[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const scienceName of sciences) {
    xfer.xferAsciiString(scienceName);
  }
  return sciences;
}

function xferScriptEngineObjectTypeList(
  xfer: Xfer,
  listName: string,
  objectTypes: string[],
): { listName: string; objectTypes: string[] } {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine object-type snapshot version ${version}`);
  }
  const resolvedListName = xfer.xferAsciiString(listName);
  const count = xfer.xferUnsignedShort(objectTypes.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loadedTypes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      loadedTypes.push(xfer.xferAsciiString(''));
    }
    return { listName: resolvedListName, objectTypes: loadedTypes };
  }
  for (const objectType of objectTypes) {
    xfer.xferAsciiString(objectType);
  }
  return { listName: resolvedListName, objectTypes };
}

function xferScriptEngineAttackPrioritySet(
  xfer: Xfer,
  name: string,
  defaultPriority: number,
  entries: Array<[string, number]>,
): {
  name: string;
  defaultPriority: number;
  entries: Array<[string, number]>;
} {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported script-engine attack-priority snapshot version ${version}`);
  }
  const resolvedName = xfer.xferAsciiString(name);
  const resolvedDefaultPriority = xfer.xferInt(Math.trunc(defaultPriority));
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: Array<[string, number]> = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push([
        xfer.xferAsciiString(''),
        xfer.xferInt(0),
      ]);
    }
    return { name: resolvedName, defaultPriority: resolvedDefaultPriority, entries: loaded };
  }
  for (const [templateName, priority] of entries) {
    xfer.xferAsciiString(templateName);
    xfer.xferInt(Math.trunc(priority));
  }
  return { name: resolvedName, defaultPriority: resolvedDefaultPriority, entries };
}

function xferScriptEngineSequentialScript(
  xfer: Xfer,
  sequentialScript: {
    teamId: number;
    objectId: number;
    scriptNameUpper: string;
    currentInstruction: number;
    timesToLoop: number;
    framesToWait: number;
    dontAdvanceInstruction: boolean;
  },
): typeof sequentialScript {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported sequential-script snapshot version ${version}`);
  }
  const teamId = xfer.xferInt(Math.max(0, Math.trunc(sequentialScript.teamId)));
  const objectId = xfer.xferObjectID(Math.max(0, Math.trunc(sequentialScript.objectId)));
  const scriptNameUpper = xfer.xferAsciiString(sequentialScript.scriptNameUpper);
  const currentInstruction = xfer.xferInt(Math.trunc(sequentialScript.currentInstruction));
  const timesToLoop = xfer.xferInt(Math.trunc(sequentialScript.timesToLoop));
  const framesToWait = xfer.xferInt(Math.trunc(sequentialScript.framesToWait));
  const dontAdvanceInstruction = xfer.xferBool(Boolean(sequentialScript.dontAdvanceInstruction));
  return {
    teamId,
    objectId,
    scriptNameUpper,
    currentInstruction,
    timesToLoop,
    framesToWait,
    dontAdvanceInstruction,
  };
}

export function createRuntimeSaveInGameUiSuperweaponKey(params: {
  playerIndex: number;
  objectId: number;
  powerName: string;
}): string {
  return `${Math.trunc(params.playerIndex)}:${Math.trunc(params.objectId)}:${params.powerName.trim().toUpperCase()}`;
}

function normalizeRuntimeSaveInGameUiNamedTimers(
  timers: readonly RuntimeSaveInGameUiNamedTimerState[],
): RuntimeSaveInGameUiNamedTimerState[] {
  const byName = new Map<string, RuntimeSaveInGameUiNamedTimerState>();
  for (const timer of timers) {
    const timerName = timer.timerName.trim();
    if (!timerName) {
      continue;
    }
    byName.set(timerName, {
      timerName,
      timerText: timer.timerText,
      isCountdown: Boolean(timer.isCountdown),
    });
  }
  return [...byName.values()].sort((left, right) => left.timerName.localeCompare(right.timerName));
}

function normalizeRuntimeSaveInGameUiSuperweapons(
  superweapons: readonly RuntimeSaveInGameUiSuperweaponState[],
): RuntimeSaveInGameUiSuperweaponState[] {
  return superweapons
    .flatMap((superweapon) => {
      const templateName = superweapon.templateName.trim();
      const powerName = superweapon.powerName.trim();
      if (!templateName || !powerName || !Number.isFinite(superweapon.objectId)) {
        return [];
      }
      return [{
        playerIndex: Number.isFinite(superweapon.playerIndex)
          ? Math.max(0, Math.trunc(superweapon.playerIndex))
          : 0,
        templateName,
        powerName,
        objectId: Math.max(0, Math.trunc(superweapon.objectId)),
        timestamp: Number.isFinite(superweapon.timestamp)
          ? Math.trunc(superweapon.timestamp) >>> 0
          : SOURCE_IN_GAME_UI_TIMESTAMP_UNINITIALIZED,
        hiddenByScript: Boolean(superweapon.hiddenByScript),
        hiddenByScience: Boolean(superweapon.hiddenByScience),
        ready: Boolean(superweapon.ready),
        evaReadyPlayed: Boolean(superweapon.evaReadyPlayed),
      }];
    })
    .sort((left, right) =>
      left.playerIndex - right.playerIndex
      || left.powerName.localeCompare(right.powerName)
      || left.objectId - right.objectId);
}

function readLegacyInGameUiStateBoolean(
  state: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = state?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function deriveNamedTimersFromGameLogicInGameUiState(
  gameLogicState: GameLogicInGameUiSaveState | null | undefined,
): RuntimeSaveInGameUiNamedTimerState[] {
  const counters = gameLogicState?.state?.scriptDisplayedCounters;
  if (!(counters instanceof Map)) {
    return [];
  }

  const timers: RuntimeSaveInGameUiNamedTimerState[] = [];
  for (const [counterName, rawCounter] of counters.entries()) {
    const normalizedCounterName = typeof counterName === 'string'
      ? counterName.trim()
      : '';
    if (!normalizedCounterName || !rawCounter || typeof rawCounter !== 'object') {
      continue;
    }
    const record = rawCounter as Partial<{
      counterName: string;
      counterText: string;
      isCountdown: boolean;
    }>;
    timers.push({
      timerName: record.counterName?.trim() || normalizedCounterName,
      timerText: typeof record.counterText === 'string'
        ? record.counterText
        : normalizedCounterName,
      isCountdown: Boolean(record.isCountdown),
    });
  }
  return normalizeRuntimeSaveInGameUiNamedTimers(timers);
}

export function buildRuntimeSaveInGameUiState(params: {
  gameLogicState: GameLogicInGameUiSaveState | null;
  superweapons?: readonly SourceInGameUiSuperweaponState[];
  trackedSuperweapons?: ReadonlyMap<string, RuntimeSaveTrackedInGameUiSuperweaponState>;
  namedTimerLastFlashFrame?: number;
  namedTimerUsedFlashColor?: boolean;
}): RuntimeSaveInGameUiState {
  const state = params.gameLogicState?.state as Record<string, unknown> | undefined;
  const trackedSuperweapons = params.trackedSuperweapons;
  const superweapons = normalizeRuntimeSaveInGameUiSuperweapons(
    (params.superweapons ?? []).map((superweapon) => {
      const trackedState = trackedSuperweapons?.get(
        createRuntimeSaveInGameUiSuperweaponKey({
          playerIndex: superweapon.playerIndex,
          objectId: superweapon.objectId,
          powerName: superweapon.powerName,
        }),
      );
      return {
        playerIndex: superweapon.playerIndex,
        templateName: superweapon.templateName,
        powerName: superweapon.powerName,
        objectId: superweapon.objectId,
        timestamp: trackedState?.timestamp ?? SOURCE_IN_GAME_UI_TIMESTAMP_UNINITIALIZED,
        hiddenByScript: superweapon.hiddenByScript,
        hiddenByScience: superweapon.hiddenByScience,
        ready: superweapon.isReady,
        evaReadyPlayed: trackedState?.evaReadyPlayed ?? superweapon.isReady,
      };
    }),
  );

  return {
    version: SOURCE_IN_GAME_UI_SNAPSHOT_VERSION,
    namedTimerLastFlashFrame: Number.isFinite(params.namedTimerLastFlashFrame)
      ? Math.trunc(params.namedTimerLastFlashFrame ?? 0)
      : 0,
    namedTimerUsedFlashColor: Boolean(params.namedTimerUsedFlashColor),
    showNamedTimers: readLegacyInGameUiStateBoolean(state, 'scriptNamedTimerDisplayEnabled', true),
    namedTimers: deriveNamedTimersFromGameLogicInGameUiState(params.gameLogicState),
    superweaponHiddenByScript: !readLegacyInGameUiStateBoolean(
      state,
      'scriptSpecialPowerDisplayEnabled',
      true,
    ),
    superweapons,
  };
}

function buildGameLogicInGameUiSaveStateFromRuntimeSaveState(
  inGameUiState: RuntimeSaveInGameUiState,
): GameLogicInGameUiSaveState {
  return {
    version: 1,
    state: {
      scriptDisplayedCounters: new Map(
        normalizeRuntimeSaveInGameUiNamedTimers(inGameUiState.namedTimers).map((timer) => [
          timer.timerName,
          {
            counterName: timer.timerName,
            counterText: timer.timerText,
            isCountdown: timer.isCountdown,
            frame: 0,
          },
        ]),
      ),
      scriptNamedTimerDisplayEnabled: Boolean(inGameUiState.showNamedTimers),
      scriptSpecialPowerDisplayEnabled: !inGameUiState.superweaponHiddenByScript,
      scriptHiddenSpecialPowerDisplayEntityIds: new Set(
        normalizeRuntimeSaveInGameUiSuperweapons(inGameUiState.superweapons)
          .filter((superweapon) => superweapon.hiddenByScript)
          .map((superweapon) => superweapon.objectId),
      ),
    },
  };
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

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isChallengeCampaignName(name: string | null | undefined): boolean {
  return /^challenge_\d+$/i.test(name?.trim() ?? '');
}

function createEmptyChallengeGameSlotState(): RuntimeSaveChallengeGameSlotState {
  return {
    state: SOURCE_SLOT_STATE_CLOSED,
    name: 'Closed',
    isAccepted: false,
    isMuted: false,
    color: -1,
    startPos: -1,
    playerTemplate: -1,
    teamNumber: -1,
    origColor: -1,
    origStartPos: -1,
    origPlayerTemplate: -1,
  };
}

function createEmptyChallengeGameInfoState(): RuntimeSaveChallengeGameInfoState {
  return {
    version: SOURCE_SKIRMISH_GAME_INFO_SNAPSHOT_VERSION,
    preorderMask: 0,
    crcInterval: SOURCE_SKIRMISH_GAME_INFO_RELEASE_CRC_INTERVAL,
    inGame: false,
    inProgress: false,
    surrendered: false,
    gameId: 0,
    slots: Array.from({ length: SOURCE_SKIRMISH_GAME_SLOT_COUNT }, () => createEmptyChallengeGameSlotState()),
    localIp: 0,
    mapName: 'NOMAP',
    mapCrc: 0,
    mapSize: 0,
    mapMask: 0,
    seed: 0,
    superweaponRestriction: 0,
    startingCash: 10000,
  };
}

function createChallengePlayerSlotState(
  playerDisplayName: string,
  playerTemplateNum: number,
): RuntimeSaveChallengeGameSlotState {
  return {
    ...createEmptyChallengeGameSlotState(),
    state: SOURCE_SLOT_STATE_PLAYER,
    name: playerDisplayName,
    isAccepted: true,
    playerTemplate: playerTemplateNum,
  };
}

function resolveFreshCampaignSnapshotVersion(
  campaign: RuntimeSaveCampaignBootstrap | null | undefined,
): number {
  if (campaign?.version !== undefined) {
    return campaign.version;
  }
  if (campaign?.isChallengeCampaign || campaign?.challengeGameInfoState) {
    return SOURCE_CAMPAIGN_SNAPSHOT_MAX_VERSION;
  }
  return SOURCE_CAMPAIGN_SNAPSHOT_FRESH_VERSION;
}

function createFreshChallengeGameInfoState(
  campaign: RuntimeSaveCampaignBootstrap,
  gameRandomSeed: number | undefined,
): RuntimeSaveChallengeGameInfoState {
  const state = createEmptyChallengeGameInfoState();
  state.inGame = true;
  state.inProgress = false;
  state.seed = typeof gameRandomSeed === 'number' && Number.isFinite(gameRandomSeed)
    ? Math.trunc(gameRandomSeed)
    : state.seed;
  if (campaign.sourceMapName && campaign.sourceMapName.trim().length > 0) {
    state.mapName = campaign.sourceMapName.trim();
  }
  if (campaign.playerTemplateNum >= 0) {
    state.slots[0] = createChallengePlayerSlotState(
      campaign.playerDisplayName?.trim() || '',
      campaign.playerTemplateNum,
    );
  }
  return state;
}

function resolveChallengeGameInfoState(
  campaign: RuntimeSaveCampaignBootstrap | null | undefined,
  gameRandomSeed: number | undefined,
): RuntimeSaveChallengeGameInfoState | null {
  if (!campaign?.isChallengeCampaign) {
    return campaign?.challengeGameInfoState ?? null;
  }
  if (campaign.challengeGameInfoState) {
    return campaign.challengeGameInfoState;
  }
  return createFreshChallengeGameInfoState(campaign, gameRandomSeed);
}

function xferMoneyAmount(xfer: Xfer, value: number): number {
  const version = xfer.xferVersion(SOURCE_MONEY_SNAPSHOT_VERSION);
  if (version !== SOURCE_MONEY_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported money snapshot version ${version}`);
  }
  return xfer.xferUnsignedInt(value);
}

function xferChallengeGameSlotState(
  xfer: Xfer,
  slotState: RuntimeSaveChallengeGameSlotState,
  version: number,
): RuntimeSaveChallengeGameSlotState {
  const state = xfer.xferInt(slotState.state);
  const name = version >= 2 ? xfer.xferUnicodeString(slotState.name) : slotState.name;
  const isAccepted = xfer.xferBool(slotState.isAccepted);
  const isMuted = xfer.xferBool(slotState.isMuted);
  const color = xfer.xferInt(slotState.color);
  const startPos = xfer.xferInt(slotState.startPos);
  const playerTemplate = xfer.xferInt(slotState.playerTemplate);
  const teamNumber = xfer.xferInt(slotState.teamNumber);
  const origColor = xfer.xferInt(slotState.origColor);
  const origStartPos = xfer.xferInt(slotState.origStartPos);
  const origPlayerTemplate = xfer.xferInt(slotState.origPlayerTemplate);
  return {
    state,
    name,
    isAccepted,
    isMuted,
    color,
    startPos,
    playerTemplate,
    teamNumber,
    origColor,
    origStartPos,
    origPlayerTemplate,
  };
}

function xferChallengeGameInfoState(
  xfer: Xfer,
  state: RuntimeSaveChallengeGameInfoState,
): RuntimeSaveChallengeGameInfoState {
  const version = xfer.xferVersion(
    xfer.getMode() === XferMode.XFER_LOAD
      ? SOURCE_SKIRMISH_GAME_INFO_SNAPSHOT_VERSION
      : state.version,
  );
  if (version < 2 || version > SOURCE_SKIRMISH_GAME_INFO_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported skirmish game info snapshot version ${version}`);
  }

  const preorderMask = xfer.xferInt(state.preorderMask);
  const crcInterval = xfer.xferInt(state.crcInterval);
  const inGame = xfer.xferBool(state.inGame);
  const inProgress = xfer.xferBool(state.inProgress);
  const surrendered = xfer.xferBool(state.surrendered);
  const gameId = xfer.xferInt(state.gameId);

  const slotCount = xfer.xferInt(
    state.slots.length > 0 ? state.slots.length : SOURCE_SKIRMISH_GAME_SLOT_COUNT,
  );
  if (slotCount !== SOURCE_SKIRMISH_GAME_SLOT_COUNT) {
    throw new Error(
      `Skirmish game info slot count mismatch: expected ${SOURCE_SKIRMISH_GAME_SLOT_COUNT}, got ${slotCount}`,
    );
  }

  const slots: RuntimeSaveChallengeGameSlotState[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    slots.push(
      xferChallengeGameSlotState(
        xfer,
        state.slots[index] ?? createEmptyChallengeGameSlotState(),
        version,
      ),
    );
  }

  const localIp = xfer.xferUnsignedInt(state.localIp);
  const mapName = xfer.xferAsciiString(state.mapName);
  const mapCrc = xfer.xferUnsignedInt(state.mapCrc);
  const mapSize = xfer.xferUnsignedInt(state.mapSize);
  const mapMask = xfer.xferInt(state.mapMask);
  const seed = xfer.xferInt(state.seed);

  let superweaponRestriction = state.superweaponRestriction;
  let startingCash = state.startingCash;
  if (version >= 3) {
    superweaponRestriction = xfer.xferUnsignedShort(superweaponRestriction);
    if (version === 3) {
      xfer.xferBool(false);
    }
    startingCash = xferMoneyAmount(xfer, startingCash);
  } else if (xfer.getMode() === XferMode.XFER_LOAD) {
    superweaponRestriction = 0;
    startingCash = 10000;
  }

  return {
    version,
    preorderMask,
    crcInterval,
    inGame,
    inProgress,
    surrendered,
    gameId,
    slots,
    localIp,
    mapName,
    mapCrc,
    mapSize,
    mapMask,
    seed,
    superweaponRestriction,
    startingCash,
  };
}

function extractPassthroughBlocks(data: ArrayBuffer): RuntimeSavePassthroughBlock[] {
  const source = new Uint8Array(data);
  return listSaveGameChunks(data)
    .filter((chunk) => !KNOWN_RUNTIME_SAVE_BLOCKS.has(chunk.blockName.toLowerCase()))
    .map((chunk) => ({
      blockName: chunk.blockName,
      blockData: copyBytesToArrayBuffer(
        source.slice(chunk.blockDataOffset, chunk.blockDataOffset + chunk.blockSize),
      ),
    }));
}

function extractSaveChunkData(data: ArrayBuffer, blockName: string): Uint8Array | null {
  const chunk = listSaveGameChunks(data).find(
    (candidate) => candidate.blockName.toLowerCase() === blockName.toLowerCase(),
  );
  if (!chunk) {
    return null;
  }
  return new Uint8Array(data, chunk.blockDataOffset, chunk.blockSize).slice();
}

function orderPassthroughBlocks(
  passthroughBlocks: readonly RuntimeSavePassthroughBlock[] | undefined,
): RuntimeSavePassthroughBlock[] {
  const blocks = (passthroughBlocks ?? []).map((block, index) => ({ block, index }));
  const orderedNames = new Map<string, number>(
    PASSTHROUGH_BLOCK_ORDER.map((name, index) => [name.toLowerCase(), index]),
  );
  return blocks
    .sort((left, right) => {
      const leftOrder = orderedNames.get(left.block.blockName.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderedNames.get(right.block.blockName.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map(({ block }) => block);
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

function shouldWriteBrowserRuntimeStateBlock(gameLogicState: unknown): boolean {
  if (gameLogicState === null || gameLogicState === undefined) {
    return false;
  }
  if (Array.isArray(gameLogicState) || typeof gameLogicState !== 'object') {
    return true;
  }
  const prototype = Object.getPrototypeOf(gameLogicState);
  if (prototype !== Object.prototype && prototype !== null) {
    return true;
  }
  return Object.keys(gameLogicState).some((key) => key !== 'version');
}

function hasPassthroughBlock(
  passthroughBlocks: readonly RuntimeSavePassthroughBlock[],
  blockName: string,
): boolean {
  const normalizedBlockName = blockName.toLowerCase();
  return passthroughBlocks.some((block) => block.blockName.toLowerCase() === normalizedBlockName);
}

function mergeBriefingLines(
  existingLines: readonly string[],
  newLines: readonly string[],
): string[] {
  const merged: string[] = [];
  for (const line of [...existingLines, ...newLines]) {
    if (!line || merged.includes(line)) {
      continue;
    }
    merged.push(line);
  }
  return merged;
}

function buildIdentityMatrix3DBytes(): Uint8Array {
  return buildTransformMatrix3DBytes(0, 0, 0, 0);
}

function buildTransformMatrix3DBytes(
  x: number,
  y: number,
  z: number,
  rotationY: number,
): Uint8Array {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0,
    ),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        0,
        Number.isFinite(rotationY) ? rotationY : 0,
        0,
        'XYZ',
      ),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  const e = matrix.elements;
  const values = new Float32Array([
    e[0]!, e[4]!, e[8]!, e[12]!,
    e[1]!, e[5]!, e[9]!, e[13]!,
    e[2]!, e[6]!, e[10]!, e[14]!,
  ]);
  return new Uint8Array(values.buffer.slice(0));
}

function xferModelConditionFlags(xfer: Xfer, flags: readonly string[]): void {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported ModelConditionFlags snapshot version ${version}`);
  }
  const normalizedFlags = [...new Set(flags.filter((flag) => flag.length > 0))].sort();
  const count = xfer.xferInt(normalizedFlags.length);
  if (xfer.getMode() !== XferMode.XFER_SAVE) {
    throw new Error('ModelConditionFlags xfer is save-only in the TS runtime.');
  }
  if (count !== normalizedFlags.length) {
    throw new Error(`ModelConditionFlags count mismatch: expected ${normalizedFlags.length}, got ${count}`);
  }
  for (const flag of normalizedFlags) {
    xfer.xferAsciiString(flag);
  }
}

function shouldEnableDrawableShadows(state: GameLogicRenderableEntityState): boolean {
  const shadowType = state.shadowType?.trim().toUpperCase() ?? '';
  return shadowType.length > 0 && shadowType !== 'NONE' && shadowType !== 'SHADOW_NONE';
}

function clampOpacity(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const numericValue = value ?? fallback;
  return Math.min(1, Math.max(0, numericValue));
}

function buildSourceGameClientDrawableStates(
  renderableEntityStates: readonly GameLogicRenderableEntityState[] | null | undefined,
  gameLogicState: GameLogicCoreSaveState,
  liveEntityIdsOverride?: readonly number[] | null,
): RuntimeSaveDrawableSnapshotState[] {
  if (!renderableEntityStates || renderableEntityStates.length === 0) {
    return [];
  }

  const liveIds = new Set<number>(
    liveEntityIdsOverride
      ?? gameLogicState.spawnedEntities.map((entity) => entity.id),
  );
  const result: RuntimeSaveDrawableSnapshotState[] = [];
  for (const state of renderableEntityStates) {
    if (!liveIds.has(state.id)) {
      continue;
    }
    const visualTemplateName = state.disguiseTemplateName ?? state.templateName;
    if (!visualTemplateName) {
      continue;
    }

    result.push({
      drawableId: state.id,
      objectId: state.id,
      templateName: visualTemplateName,
      modelConditionFlags: state.modelConditionFlags ?? [],
      transformMatrixBytes: buildTransformMatrix3DBytes(
        state.x,
        state.y,
        state.z,
        state.rotationY,
      ),
      statusBits: shouldEnableDrawableShadows(state) ? DRAWABLE_STATUS_SHADOWS : 0,
      explicitOpacity: clampOpacity(state.tunnelTransitionOpacity, 1),
      stealthOpacity: clampOpacity(state.stealthFriendlyOpacity, 1),
      effectiveStealthOpacity: clampOpacity(state.tunnelTransitionOpacity, 1),
      ambientSoundEnabled: state.scriptAmbientSoundEnabled ?? true,
      ambientSoundEnabledFromScript: state.scriptAmbientSoundEnabled ?? true,
      flashCount: Math.max(0, Math.trunc(state.scriptFlashCount ?? 0)),
      flashColor: (state.scriptFlashColor ?? 0) & 0xffffff,
      hidden: state.shroudStatus === 'SHROUDED',
      hiddenByStealth: false,
      shroudStatusObjectId: state.id,
    });
  }

  result.sort((left, right) => left.drawableId - right.drawableId);
  return result;
}

function buildGameClientDrawableEntries(
  savedGameClientState: RuntimeSaveGameClientState | null | undefined,
  generatedDrawables: readonly RuntimeSaveDrawableSnapshotState[],
): RuntimeSaveGameClientDrawableEntry[] {
  const rawDrawables = savedGameClientState?.drawables ?? [];
  if (rawDrawables.length === 0) {
    return generatedDrawables.map((state) => ({ kind: 'generated', state }));
  }
  if (generatedDrawables.length === 0) {
    return rawDrawables.map((state) => ({ kind: 'raw', state }));
  }

  const remainingGeneratedByObjectId = new Map<number, RuntimeSaveDrawableSnapshotState>();
  const remainingGeneratedWithoutObject: RuntimeSaveDrawableSnapshotState[] = [];
  for (const drawable of generatedDrawables) {
    if (drawable.objectId !== 0 && !remainingGeneratedByObjectId.has(drawable.objectId)) {
      remainingGeneratedByObjectId.set(drawable.objectId, drawable);
      continue;
    }
    remainingGeneratedWithoutObject.push(drawable);
  }

  const mergedEntries: RuntimeSaveGameClientDrawableEntry[] = [];
  for (const drawable of rawDrawables) {
    if (drawable.objectId !== 0) {
      const regenerated = remainingGeneratedByObjectId.get(drawable.objectId);
      if (regenerated) {
        mergedEntries.push({ kind: 'generated', state: regenerated });
        remainingGeneratedByObjectId.delete(drawable.objectId);
        continue;
      }
    }
    mergedEntries.push({ kind: 'raw', state: drawable });
  }

  const remainingGenerated = [
    ...remainingGeneratedByObjectId.values(),
    ...remainingGeneratedWithoutObject,
  ].sort((left, right) => left.drawableId - right.drawableId);
  for (const drawable of remainingGenerated) {
    mergedEntries.push({ kind: 'generated', state: drawable });
  }
  return mergedEntries;
}

class DrawableSnapshot implements Snapshot {
  private readonly identityMatrixBytes = buildIdentityMatrix3DBytes();

  constructor(private readonly state: RuntimeSaveDrawableSnapshotState) {}

  crc(_xfer: Xfer): void {
    // Source drawable snapshot is currently save-only in the TS runtime.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(7);
    if (version !== 7) {
      throw new Error(`Unsupported drawable snapshot version ${version}`);
    }

    xfer.xferUnsignedInt(this.state.drawableId);
    xferModelConditionFlags(xfer, this.state.modelConditionFlags);
    xfer.xferUser(this.state.transformMatrixBytes);
    xfer.xferBool(false);
    xfer.xferBool(false);
    xfer.xferInt(TERRAIN_DECAL_NONE);
    xfer.xferReal(this.state.explicitOpacity);
    xfer.xferReal(this.state.stealthOpacity);
    xfer.xferReal(this.state.effectiveStealthOpacity);
    xfer.xferReal(0);
    xfer.xferReal(0);
    xfer.xferReal(0);
    xfer.xferObjectID(this.state.objectId);
    xfer.xferUnsignedInt(this.state.statusBits);
    xfer.xferUnsignedInt(0);
    xfer.xferUnsignedInt(0);
    xfer.xferInt(FADING_NONE);
    xfer.xferUnsignedInt(0);
    xfer.xferUnsignedInt(0);
    xfer.xferBool(false);
    xfer.xferVersion(1);
    xfer.xferUnsignedShort(NUM_DRAWABLE_MODULE_TYPES);
    for (let index = 0; index < NUM_DRAWABLE_MODULE_TYPES; index += 1) {
      xfer.xferUnsignedShort(0);
    }
    xfer.xferInt(STEALTHLOOK_NONE);
    xfer.xferInt(this.state.flashCount);
    xfer.xferColor(this.state.flashColor);
    xfer.xferBool(this.state.hidden);
    xfer.xferBool(this.state.hiddenByStealth);
    xfer.xferReal(0);
    xfer.xferBool(true);
    xfer.xferUser(this.identityMatrixBytes);
    xfer.xferReal(1);
    xfer.xferObjectID(this.state.shroudStatusObjectId);
    xfer.xferUnsignedInt(0);
    xfer.xferUnsignedByte(0);
    xfer.xferBool(this.state.ambientSoundEnabled);
    xfer.xferBool(this.state.ambientSoundEnabledFromScript);
    xfer.xferBool(false);
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

function parseGameClientState(data: ArrayBuffer): RuntimeSaveGameClientState | null {
  const chunkData = extractSaveChunkData(data, SOURCE_GAME_CLIENT_BLOCK);
  if (!chunkData) {
    return null;
  }

  const xferLoad = new XferLoad(copyBytesToArrayBuffer(chunkData));
  xferLoad.open('parse-game-client-state');
  try {
    const version = xferLoad.xferVersion(SOURCE_GAME_CLIENT_SNAPSHOT_VERSION);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION);
    const tocEntriesById = new Map<number, string>();
    const tocCount = xferLoad.xferUnsignedInt(0);
    for (let index = 0; index < tocCount; index += 1) {
      const templateName = xferLoad.xferAsciiString('');
      const tocId = xferLoad.xferUnsignedShort(0);
      tocEntriesById.set(tocId, templateName);
    }

    const drawables: RuntimeSaveRawGameClientDrawableState[] = [];
    const drawableCount = xferLoad.xferUnsignedShort(0);
    for (let index = 0; index < drawableCount; index += 1) {
      const tocId = xferLoad.xferUnsignedShort(0);
      const templateName = tocEntriesById.get(tocId);
      if (!templateName) {
        throw new Error(`Game-client drawable references unknown TOC id ${tocId}.`);
      }
      const blockSize = xferLoad.beginBlock();
      const blockStart = xferLoad.getOffset();
      const objectId = xferLoad.xferObjectID(0);
      const bytesConsumed = xferLoad.getOffset() - blockStart;
      xferLoad.skip(blockSize - bytesConsumed);
      xferLoad.endBlock();
      drawables.push({
        templateName,
        objectId,
        blockData: copyBytesToArrayBuffer(chunkData.slice(blockStart, blockStart + blockSize)),
      });
    }

    const prefixBytes = copyBytesToArrayBuffer(chunkData.slice(0, xferLoad.getOffset()));
    const briefingLines: string[] = [];
    if (version >= 2) {
      const briefingCount = xferLoad.xferInt(0);
      if (briefingCount < 0) {
        throw new Error(`Game-client briefing count ${briefingCount} is invalid.`);
      }
      for (let index = 0; index < briefingCount; index += 1) {
        briefingLines.push(xferLoad.xferAsciiString(''));
      }
    }

    return {
      version,
      prefixBytes,
      briefingLines,
      drawables,
    };
  } finally {
    xferLoad.close();
  }
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
    const version = xfer.xferVersion(
      xfer.getMode() === XferMode.XFER_LOAD
        ? SOURCE_CAMPAIGN_SNAPSHOT_MAX_VERSION
        : this.state.version,
    );
    this.state.version = version;
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
        this.state.challengeGameInfoState = xferChallengeGameInfoState(
          xfer,
          this.state.challengeGameInfoState ?? createEmptyChallengeGameInfoState(),
        );
        if (version < 5 && this.state.playerTemplateNum < 0) {
          this.state.playerTemplateNum = this.state.challengeGameInfoState.slots[0]?.playerTemplate ?? -1;
        }
      } else if (xfer.getMode() === XferMode.XFER_LOAD) {
        this.state.challengeGameInfoState = null;
      }
    } else if (xfer.getMode() === XferMode.XFER_LOAD) {
      this.state.isChallengeCampaign = isChallengeCampaignName(this.state.currentCampaign);
      this.state.challengeGameInfoState = null;
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

function createEmptyPartitionSaveState(): GameLogicPartitionSaveState {
  return {
    version: SOURCE_PARTITION_SNAPSHOT_VERSION,
    cellSize: 0,
    totalCellCount: 0,
    cells: [],
    pendingUndoShroudReveals: [],
  };
}

function xferSourcePartitionShroudLevel(
  xfer: Xfer,
  level: { currentShroud: number; activeShroudLevel: number },
): { currentShroud: number; activeShroudLevel: number } {
  return {
    currentShroud: xfer.xferShort(level.currentShroud),
    activeShroudLevel: xfer.xferShort(level.activeShroudLevel),
  };
}

function xferSourcePartitionUndoReveal(
  xfer: Xfer,
  reveal: {
    where: { x: number; y: number; z: number };
    howFar: number;
    forWhom: number;
    data: number;
  },
): {
  where: { x: number; y: number; z: number };
  howFar: number;
  forWhom: number;
  data: number;
} {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported partition undo-reveal snapshot version ${version}`);
  }
  return {
    where: xfer.xferCoord3D(reveal.where),
    howFar: xfer.xferReal(reveal.howFar),
    forWhom: xfer.xferUnsignedShort(reveal.forWhom),
    data: xfer.xferUnsignedInt(reveal.data),
  };
}

class PartitionSnapshot implements Snapshot {
  payload: GameLogicPartitionSaveState | null;

  constructor(payload: GameLogicPartitionSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Partition snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_PARTITION_SNAPSHOT_VERSION);
    if (version !== SOURCE_PARTITION_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported partition snapshot version ${version}`);
    }

    const payload = this.payload ?? createEmptyPartitionSaveState();
    payload.version = version;
    payload.cellSize = xfer.xferReal(payload.cellSize);
    payload.totalCellCount = xfer.xferInt(payload.totalCellCount);
    if (payload.totalCellCount < 0) {
      throw new Error(`Partition snapshot cell count ${payload.totalCellCount} is invalid.`);
    }

    const cells: GameLogicPartitionSaveState['cells'] = [];
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      for (let cellIndex = 0; cellIndex < payload.totalCellCount; cellIndex += 1) {
        const cellVersion = xfer.xferVersion(SOURCE_PARTITION_CELL_SNAPSHOT_VERSION);
        if (cellVersion !== SOURCE_PARTITION_CELL_SNAPSHOT_VERSION) {
          throw new Error(`Unsupported partition cell snapshot version ${cellVersion}`);
        }
        const shroudLevels = [];
        for (let playerIndex = 0; playerIndex < SOURCE_PARTITION_PLAYER_COUNT; playerIndex += 1) {
          shroudLevels.push(
            xferSourcePartitionShroudLevel(xfer, { currentShroud: 1, activeShroudLevel: 0 }),
          );
        }
        cells.push({ shroudLevels });
      }
    } else {
      for (const cell of payload.cells) {
        const shroudLevels = cell?.shroudLevels ?? [];
        xfer.xferVersion(SOURCE_PARTITION_CELL_SNAPSHOT_VERSION);
        for (let playerIndex = 0; playerIndex < SOURCE_PARTITION_PLAYER_COUNT; playerIndex += 1) {
          xferSourcePartitionShroudLevel(
            xfer,
            shroudLevels[playerIndex] ?? { currentShroud: 1, activeShroudLevel: 0 },
          );
        }
        cells.push({
          shroudLevels: shroudLevels.map((level) => ({ ...level })),
        });
      }
    }
    payload.cells = cells;

    const queueSize = xfer.xferInt(payload.pendingUndoShroudReveals.length);
    if (queueSize < 0) {
      throw new Error(`Partition snapshot undo-reveal queue size ${queueSize} is invalid.`);
    }
    const pendingUndoShroudReveals: GameLogicPartitionSaveState['pendingUndoShroudReveals'] = [];
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      for (let index = 0; index < queueSize; index += 1) {
        pendingUndoShroudReveals.push(xferSourcePartitionUndoReveal(xfer, {
          where: { x: 0, y: 0, z: 0 },
          howFar: 0,
          forWhom: 0,
          data: 0,
        }));
      }
    } else {
      for (const reveal of payload.pendingUndoShroudReveals) {
        pendingUndoShroudReveals.push(xferSourcePartitionUndoReveal(xfer, reveal));
      }
    }
    payload.pendingUndoShroudReveals = pendingUndoShroudReveals;
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

function createEmptyCampaignSnapshotState(): RuntimeSaveCampaignState {
  return {
    version: SOURCE_CAMPAIGN_SNAPSHOT_FRESH_VERSION,
    currentCampaign: '',
    currentMission: '',
    currentRankPoints: 0,
    difficulty: 'NORMAL',
    isChallengeCampaign: false,
    playerTemplateNum: -1,
    challengeGameInfoState: null,
  };
}

function xferSourceCaveTrackerVector(
  xfer: Xfer,
  trackers: GameLogicCaveTrackerSaveState[],
): GameLogicCaveTrackerSaveState[] {
  const maxCaveIndex = trackers.reduce(
    (currentMax, tracker) => Math.max(currentMax, Math.trunc(tracker.caveIndex)),
    -1,
  );
  const vectorLength = xfer.xferUnsignedShort(maxCaveIndex >= 0 ? maxCaveIndex + 1 : 0);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: GameLogicCaveTrackerSaveState[] = [];
    for (let caveIndex = 0; caveIndex < vectorLength; caveIndex += 1) {
      loaded.push({
        caveIndex,
        tracker: xferSourceTunnelTrackerState(xfer, {
          tunnelIds: [],
          passengerIds: [],
          tunnelCount: 0,
        }),
      });
    }
    return loaded;
  }

  const trackerByIndex = new Map<number, GameLogicCaveTrackerSaveState>();
  for (const tracker of trackers) {
    trackerByIndex.set(Math.max(0, Math.trunc(tracker.caveIndex)), tracker);
  }
  for (let caveIndex = 0; caveIndex < vectorLength; caveIndex += 1) {
    xferSourceTunnelTrackerState(
      xfer,
      trackerByIndex.get(caveIndex)?.tracker ?? {
        tunnelIds: [],
        passengerIds: [],
        tunnelCount: 0,
      },
    );
  }
  return trackers;
}

type SourcePolygonTriggerPoint = { x: number; y: number; z: number };

interface SourcePolygonTriggerSnapshotState {
  points: SourcePolygonTriggerPoint[];
  bounds: {
    lo: { x: number; y: number };
    hi: { x: number; y: number };
  };
  radius: number;
  boundsNeedsUpdate: boolean;
}

function buildSourcePolygonTriggerSnapshotState(
  points: readonly SourcePolygonTriggerPoint[],
): SourcePolygonTriggerSnapshotState {
  const normalizedPoints = points.map((point) => ({
    x: Math.trunc(point.x),
    y: Math.trunc(point.y),
    z: Math.trunc(point.z),
  }));
  const xs = normalizedPoints.map((point) => point.x);
  const ys = normalizedPoints.map((point) => point.y);
  const loX = xs.length > 0 ? Math.min(...xs) : 0;
  const loY = ys.length > 0 ? Math.min(...ys) : 0;
  const hiX = xs.length > 0 ? Math.max(...xs) : 0;
  const hiY = ys.length > 0 ? Math.max(...ys) : 0;
  const halfWidth = (hiX - loX) / 2.0;
  const halfHeight = (hiY + loY) / 2.0;
  return {
    points: normalizedPoints,
    bounds: {
      lo: { x: loX, y: loY },
      hi: { x: hiX, y: hiY },
    },
    radius: Math.sqrt((halfHeight * halfHeight) + (halfWidth * halfWidth)),
    boundsNeedsUpdate: false,
  };
}

function xferSourcePolygonTriggerSnapshot(
  xfer: Xfer,
  snapshot: SourcePolygonTriggerSnapshotState,
): SourcePolygonTriggerSnapshotState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source polygon trigger snapshot version ${version}`);
  }

  const pointCount = xfer.xferInt(snapshot.points.length);
  const points: SourcePolygonTriggerPoint[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < pointCount; index += 1) {
      points.push({
        x: xfer.xferInt(0),
        y: xfer.xferInt(0),
        z: xfer.xferInt(0),
      });
    }
  } else {
    for (const point of snapshot.points) {
      xfer.xferInt(point.x);
      xfer.xferInt(point.y);
      xfer.xferInt(point.z);
      points.push(point);
    }
  }

  const bounds = {
    lo: {
      x: xfer.xferInt(snapshot.bounds.lo.x),
      y: xfer.xferInt(snapshot.bounds.lo.y),
    },
    hi: {
      x: xfer.xferInt(snapshot.bounds.hi.x),
      y: xfer.xferInt(snapshot.bounds.hi.y),
    },
  };
  const radius = xfer.xferReal(snapshot.radius);
  const boundsNeedsUpdate = xfer.xferBool(snapshot.boundsNeedsUpdate);
  return {
    points,
    bounds,
    radius,
    boundsNeedsUpdate,
  };
}

function parseSourceGameLogicChunkState(
  data: ArrayBuffer | Uint8Array,
): ParsedSourceGameLogicChunkState | null {
  try {
    const chunkData = data instanceof Uint8Array
      ? copyBytesToArrayBuffer(data)
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('parse-source-game-logic');
    try {
      const version = xferLoad.xferVersion(SOURCE_GAME_LOGIC_SNAPSHOT_VERSION);
      if (version < 1 || version > SOURCE_GAME_LOGIC_SNAPSHOT_VERSION) {
        throw new Error(`Unsupported source game-logic snapshot version ${version}`);
      }

      const frameCounter = xferLoad.xferUnsignedInt(0);
      const tocVersion = xferLoad.xferVersion(1);
      if (tocVersion !== 1) {
        throw new Error(`Unsupported object TOC version ${tocVersion}`);
      }

      const objectTocCount = xferLoad.xferUnsignedInt(0);
      const objectTocEntries: Array<{ templateName: string; tocId: number }> = [];
      for (let index = 0; index < objectTocCount; index += 1) {
        objectTocEntries.push({
          templateName: xferLoad.xferAsciiString(''),
          tocId: xferLoad.xferUnsignedShort(0),
        });
      }

      const objectCount = xferLoad.xferUnsignedInt(0);
      const objects: ParsedSourceGameLogicObjectState[] = [];
      for (let index = 0; index < objectCount; index += 1) {
        const tocId = xferLoad.xferUnsignedShort(0);
        const objectDataSize = xferLoad.beginBlock();
        if (objectDataSize < 1) {
          throw new Error(`Object block ${index} is empty.`);
        }
        const objectData = xferLoad.xferUser(new Uint8Array(objectDataSize));
        xferLoad.endBlock();
        const state = parseSourceMapEntityChunk(objectData);
        if (state === null) {
          throw new Error(`Object block ${index} failed structured Object::xfer parsing.`);
        }
        objects.push({
          tocId,
          templateName: objectTocEntries.find((entry) => entry.tocId === tocId)?.templateName ?? null,
          blockData: copyBytesToArrayBuffer(objectData),
          state,
        });
      }

      const campaignState = createEmptyCampaignSnapshotState();
      xferLoad.xferSnapshot(new CampaignSnapshot(campaignState));
      const caveTrackers = xferSourceCaveTrackerVector(xferLoad, []);
      const scriptScoringEnabled = version >= 2
        ? xferLoad.xferBool(false)
        : true;

      const polygonTriggers: ParsedSourceGameLogicPolygonTriggerState[] = [];
      if (version >= 3) {
        const polygonTriggerCount = xferLoad.xferUnsignedInt(0);
        for (let index = 0; index < polygonTriggerCount; index += 1) {
          const triggerId = xferLoad.xferInt(0);
          polygonTriggers.push({
            triggerId,
            snapshot: xferSourcePolygonTriggerSnapshot(
              xferLoad,
              buildSourcePolygonTriggerSnapshotState([]),
            ),
          });
        }
      }

      const rankLevelLimit = version >= 5 ? xferLoad.xferInt(0) : null;
      const sellingEntities = version >= 6 ? xferSourceSellingEntities(xferLoad, []) : [];
      const buildableOverrides = version >= 7 ? xferSourceBuildableOverrideMap(xferLoad, []) : [];
      const showBehindBuildingMarkers = version >= 8 ? xferLoad.xferBool(false) : null;
      const drawIconUI = version >= 8 ? xferLoad.xferBool(false) : null;
      const showDynamicLOD = version >= 8 ? xferLoad.xferBool(false) : null;
      const scriptHulkMaxLifetimeOverride = version >= 8 ? xferLoad.xferInt(0) : null;
      const controlBarOverrideEntries = version >= 8
        ? xferSourceControlBarOverrideMapEntries(xferLoad, [])
        : [];
      const rankPointsToAddAtGameStart = version >= 9 ? xferLoad.xferInt(0) : null;
      const superweaponRestriction = version >= 10 ? xferLoad.xferUnsignedShort(0) : null;

      if (xferLoad.getRemaining() !== 0) {
        throw new Error(`${xferLoad.getRemaining()} trailing bytes remain after source GameLogic parse.`);
      }

      return {
        version,
        frameCounter,
        objectTocEntries,
        objects,
        campaignState,
        caveTrackers,
        scriptScoringEnabled,
        polygonTriggers,
        rankLevelLimit,
        sellingEntities,
        buildableOverrides,
        showBehindBuildingMarkers,
        drawIconUI,
        showDynamicLOD,
        scriptHulkMaxLifetimeOverride,
        controlBarOverrideEntries,
        rankPointsToAddAtGameStart,
        superweaponRestriction,
      };
    } finally {
      xferLoad.close();
    }
  } catch {
    return null;
  }
}

function xferSourceBuildableOverrideMap(
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
        buildableStatus: decodeBuildableStatus(xfer.xferInt(0)),
      });
    }
    return loaded;
  }

  for (const override of overrides) {
    xfer.xferAsciiString(override.templateName);
    xfer.xferInt(encodeBuildableStatus(override.buildableStatus));
  }
  xfer.xferAsciiString('');
  return overrides;
}

function xferSourceControlBarOverrideMapEntries(
  xfer: Xfer,
  entries: ParsedSourceGameLogicControlBarOverrideState[],
): ParsedSourceGameLogicControlBarOverrideState[] {
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: ParsedSourceGameLogicControlBarOverrideState[] = [];
    for (;;) {
      const name = xfer.xferAsciiString('');
      if (name.length === 0) {
        break;
      }
      const commandButtonName = xfer.xferAsciiString('');
      loaded.push({
        name,
        commandButtonName: commandButtonName.length > 0 ? commandButtonName : null,
      });
    }
    return loaded;
  }

  for (const entry of entries) {
    xfer.xferAsciiString(entry.name);
    xfer.xferAsciiString(entry.commandButtonName ?? '');
  }
  xfer.xferAsciiString('');
  return entries;
}

function inspectSourceGameLogicChunk(
  data: ArrayBuffer | Uint8Array,
): RuntimeSaveGameLogicChunkLayoutInspection | null {
  const parsed = parseSourceGameLogicChunkState(data);
  if (parsed === null) {
    return null;
  }
  const firstObject = parsed.objects[0] ?? null;
  const firstObjectLayout = firstObject
    ? {
        layout: 'source_partial' as const,
        version: firstObject.state.version,
        objectId: firstObject.state.objectId,
        parsedThrough: 'complete' as const,
        moduleCount: firstObject.state.modules.length,
        moduleIdentifiers: firstObject.state.modules.map((module) => module.identifier),
        remainingBytes: 0,
      }
    : null;
  return {
    layout: 'source_outer',
    version: parsed.version,
    frameCounter: parsed.frameCounter,
    objectTocCount: parsed.objectTocEntries.length,
    objectCount: parsed.objects.length,
    firstObjectTemplateName: firstObject?.templateName ?? null,
    firstObjectTocId: firstObject?.tocId ?? null,
    firstObjectVersion: firstObject?.state.version ?? null,
    firstObjectInternalName: firstObject?.state.internalName ?? null,
    firstObjectTeamId: firstObject?.state.teamId ?? null,
    firstObjectLayout,
  };
}

function collectSourceGameLogicPrototypeNames(
  state: ParsedSourceGameLogicChunkState | null | undefined,
): string[] {
  if (state === null || state === undefined) {
    return [];
  }
  const prototypeNames: string[] = [];
  const seen = new Set<string>();
  for (const object of state.objects) {
    const prototypeNameUpper = object.state.originalTeamName.trim().toUpperCase();
    if (!prototypeNameUpper || seen.has(prototypeNameUpper)) {
      continue;
    }
    seen.add(prototypeNameUpper);
    prototypeNames.push(prototypeNameUpper);
  }
  return prototypeNames;
}

function buildSourceTransformMatrixValues(
  x: number,
  y: number,
  z: number,
  rotationY: number,
): number[] {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0,
    ),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        0,
        Number.isFinite(rotationY) ? rotationY : 0,
        0,
        'XYZ',
      ),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  const e = matrix.elements;
  return [
    e[0]!, e[4]!, e[8]!, e[12]!,
    e[1]!, e[5]!, e[9]!, e[13]!,
    e[2]!, e[6]!, e[10]!, e[14]!,
  ];
}

function normalizeSourcePackedColor(value: number): number {
  const packedColor = Math.trunc(value) | 0;
  if ((packedColor >>> 24) !== 0) {
    return packedColor;
  }
  return packedColor | 0xff000000;
}

function normalizeSourceObjectStatusName(statusName: string): string | null {
  const normalized = statusName.trim().toUpperCase();
  if (!normalized || normalized === 'NONE') {
    return null;
  }
  const withoutPrefix = normalized.startsWith('OBJECT_STATUS_')
    ? normalized.slice('OBJECT_STATUS_'.length)
    : normalized;
  const aliased = SOURCE_OBJECT_STATUS_ALIASES.get(withoutPrefix) ?? withoutPrefix;
  return SOURCE_OBJECT_STATUS_NAME_SET.has(aliased) ? aliased : null;
}

function collectSourceObjectStatusBits(entity: MapEntity): string[] {
  const names = new Set<string>();
  const objectStatusFlags = entity.objectStatusFlags instanceof Set
    ? entity.objectStatusFlags
    : EMPTY_STATUS_FLAG_SET;
  for (const rawStatusName of objectStatusFlags) {
    const normalized = normalizeSourceObjectStatusName(rawStatusName);
    if (!normalized) {
      continue;
    }
    names.add(normalized);
  }
  return [...names].sort((left, right) =>
    (SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function sourceObjectStatusNameToType(statusName: string | null | undefined): number {
  if (typeof statusName !== 'string') {
    return 0;
  }
  const normalized = normalizeSourceObjectStatusName(statusName);
  if (!normalized) {
    return 0;
  }
  const bitIndex = SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get(normalized);
  return bitIndex === undefined ? 0 : bitIndex + 1;
}

function collectSourceScriptStatus(entity: MapEntity): number {
  let scriptStatus = 0;
  const objectStatusFlags = entity.objectStatusFlags instanceof Set
    ? entity.objectStatusFlags
    : EMPTY_STATUS_FLAG_SET;
  for (const rawStatusName of objectStatusFlags) {
    const normalized = rawStatusName.trim().toUpperCase();
    const bit = SOURCE_SCRIPT_STATUS_BITS_BY_NAME.get(normalized);
    if (bit !== undefined) {
      scriptStatus |= bit;
    }
  }
  return scriptStatus;
}

function resolveSourceDisabledState(
  sourceState: SourceMapEntitySaveState,
  entity: MapEntity,
  scriptStatus: number,
): Pick<SourceMapEntitySaveState, 'disabledMask' | 'disabledTillFrame'> {
  const activeDisabledNames = new Set<string>();
  const objectStatusFlags = entity.objectStatusFlags instanceof Set
    ? entity.objectStatusFlags
    : EMPTY_STATUS_FLAG_SET;
  for (const rawStatusName of objectStatusFlags) {
    const normalized = rawStatusName.trim().toUpperCase();
    if (normalized === 'DISABLED' || normalized === 'DISABLED_DEFAULT') {
      activeDisabledNames.add('DEFAULT');
      continue;
    }
    if (SOURCE_DISABLED_NAME_SET.has(normalized)) {
      activeDisabledNames.add(normalized);
    }
  }
  if ((scriptStatus & SOURCE_SCRIPT_STATUS_DISABLED) !== 0) {
    activeDisabledNames.add('DISABLED_SCRIPT_DISABLED');
  }
  if ((scriptStatus & SOURCE_SCRIPT_STATUS_UNPOWERED) !== 0) {
    activeDisabledNames.add('DISABLED_SCRIPT_UNDERPOWERED');
  }

  const disabledTillFrame = SOURCE_DISABLED_NAMES_IN_ORDER.map((name, index) => {
    if (!activeDisabledNames.has(name)) {
      return 0;
    }
    const preservedValue = Number.isFinite(sourceState.disabledTillFrame[index])
      ? Math.max(0, Math.trunc(sourceState.disabledTillFrame[index]!))
      : 0;
    switch (name) {
      case 'DISABLED_HACKED':
        return Math.max(preservedValue, Math.max(0, Math.trunc(entity.disabledHackedUntilFrame)));
      case 'DISABLED_EMP':
        return Math.max(preservedValue, Math.max(0, Math.trunc(entity.disabledEmpUntilFrame)));
      case 'DISABLED_PARALYZED':
      case 'DISABLED_SUBDUED':
        return Math.max(preservedValue, Math.max(0, Math.trunc(entity.disabledParalyzedUntilFrame)));
      default:
        return preservedValue > 0 ? preservedValue : SOURCE_FRAME_FOREVER;
    }
  });

  return {
    disabledMask: SOURCE_DISABLED_NAMES_IN_ORDER.filter((name) => activeDisabledNames.has(name)),
    disabledTillFrame,
  };
}

function overlaySourceWeaponSetFromLiveEntity(
  sourceState: SourceMapEntitySaveState,
  entity: MapEntity,
): SourceMapEntitySaveState['weaponSet'] {
  if (sourceState.weaponSet === null) {
    return null;
  }
  const weaponSetFlagsMask = Number.isFinite(entity.weaponSetFlagsMask)
    ? Math.trunc(entity.weaponSetFlagsMask)
    : null;
  const currentWeapon = Number.isInteger(entity.attackWeaponSlotIndex)
    && entity.attackWeaponSlotIndex >= 0
    && entity.attackWeaponSlotIndex < sourceState.weaponSet.weapons.length
      ? entity.attackWeaponSlotIndex
      : sourceState.weaponSet.currentWeapon;
  const weaponSetFlags = weaponSetFlagsMask === null
    ? sourceState.weaponSet.templateSetFlags
    : Array.from(WEAPON_SET_FLAG_MASK_BY_NAME.entries())
      .filter(([, bit]) => (weaponSetFlagsMask & bit) !== 0)
      .map(([name]) => name);
  const weapons = sourceState.weaponSet.weapons.map((weapon, slotIndex) => {
    if (weapon === null || slotIndex !== currentWeapon) {
      return weapon;
    }
    const lastFireFrame = Array.isArray(entity.lastShotFrameBySlot)
      && Number.isFinite(entity.lastShotFrameBySlot[slotIndex])
        ? entity.lastShotFrameBySlot[slotIndex]!
        : (Number.isFinite(entity.lastShotFrame) ? entity.lastShotFrame : weapon.lastFireFrame);
    return {
      ...weapon,
      templateName: entity.attackWeapon?.name ?? weapon.templateName,
      slot: slotIndex,
      ammoInClip: Number.isFinite(entity.attackAmmoInClip)
        ? Math.max(0, Math.trunc(entity.attackAmmoInClip))
        : weapon.ammoInClip,
      whenWeCanFireAgain: Number.isFinite(entity.nextAttackFrame)
        ? Math.max(0, Math.trunc(entity.nextAttackFrame))
        : weapon.whenWeCanFireAgain,
      whenPreAttackFinished: Number.isFinite(entity.preAttackFinishFrame)
        ? Math.max(0, Math.trunc(entity.preAttackFinishFrame))
        : weapon.whenPreAttackFinished,
      lastFireFrame: Math.max(0, Math.trunc(lastFireFrame)),
      maxShotCount: Number.isFinite(entity.maxShotsRemaining)
        ? Math.max(0, Math.trunc(entity.maxShotsRemaining))
        : weapon.maxShotCount,
      leechWeaponRangeActive: typeof entity.leechRangeActive === 'boolean'
        ? entity.leechRangeActive
        : weapon.leechWeaponRangeActive,
    };
  });
  return {
    ...sourceState.weaponSet,
    templateName: typeof entity.templateName === 'string' && entity.templateName
      ? entity.templateName
      : sourceState.weaponSet.templateName,
    templateSetFlags: weaponSetFlags,
    weapons,
    currentWeapon,
    currentWeaponLockedStatus: SOURCE_WEAPON_LOCK_STATUS_BY_NAME.get(entity.weaponLockStatus)
      ?? sourceState.weaponSet.currentWeaponLockedStatus,
    totalAntiMask: Number.isFinite(entity.totalWeaponAntiMask)
      ? Math.trunc(entity.totalWeaponAntiMask)
      : sourceState.weaponSet.totalAntiMask,
  };
}

function resolveSourceContainedByState(
  sourceState: SourceMapEntitySaveState,
  entity: MapEntity,
): Pick<SourceMapEntitySaveState, 'containedById' | 'containedByFrame'> {
  const containedById = entity.parkingSpaceProducerId
    ?? entity.helixCarrierId
    ?? entity.garrisonContainerId
    ?? entity.transportContainerId
    ?? entity.tunnelContainerId
    ?? null;
  if (containedById === null) {
    return {
      containedById: null,
      containedByFrame: 0,
    };
  }
  if (entity.tunnelContainerId !== null && Number.isFinite(entity.tunnelEnteredFrame)) {
    return {
      containedById,
      containedByFrame: Math.max(0, Math.trunc(entity.tunnelEnteredFrame)),
    };
  }
  if (entity.transportContainerId !== null
    && Number.isFinite(entity.healContainEnteredFrame)
    && entity.healContainEnteredFrame > 0) {
    return {
      containedById,
      containedByFrame: Math.max(0, Math.trunc(entity.healContainEnteredFrame)),
    };
  }
  return {
    containedById,
    containedByFrame: sourceState.containedById === containedById
      ? sourceState.containedByFrame
      : 0,
  };
}

function resolveSourceTriggerAreaState(
  sourceState: SourceMapEntitySaveState,
  triggerAreaState: GameLogicObjectTriggerAreaSaveState | null | undefined,
): Pick<SourceMapEntitySaveState, 'enteredOrExitedFrame' | 'triggerAreas'> {
  if (!triggerAreaState) {
    return {
      enteredOrExitedFrame: sourceState.enteredOrExitedFrame,
      triggerAreas: sourceState.triggerAreas,
    };
  }
  return {
    enteredOrExitedFrame: Math.max(0, Math.trunc(triggerAreaState.enteredOrExitedFrame)),
    triggerAreas: (triggerAreaState.triggerAreas ?? []).flatMap((triggerArea) => {
      if (!triggerArea || typeof triggerArea.triggerName !== 'string') {
        return [];
      }
      return [{
        triggerName: triggerArea.triggerName,
        entered: triggerArea.entered ? 1 : 0,
        exited: triggerArea.exited ? 1 : 0,
        isInside: triggerArea.isInside ? 1 : 0,
      }];
    }),
  };
}

function overlaySourceSpecialPowerBitsFromLiveEntity(
  sourceState: SourceMapEntitySaveState,
  entity: MapEntity,
): string[] {
  if (!Array.isArray(entity.sourceSpecialPowerBitNames)) {
    return sourceState.specialPowerBits;
  }

  const liveNames: string[] = [];
  const liveNameSet = new Set<string>();
  for (const rawName of entity.sourceSpecialPowerBitNames) {
    const normalizedName = typeof rawName === 'string' ? rawName.trim().toUpperCase() : '';
    if (!normalizedName || normalizedName === 'NONE' || liveNameSet.has(normalizedName)) {
      continue;
    }
    liveNameSet.add(normalizedName);
    liveNames.push(normalizedName);
  }

  const orderedNames: string[] = [];
  const emittedNames = new Set<string>();
  for (const rawName of sourceState.specialPowerBits) {
    const normalizedName = typeof rawName === 'string' ? rawName.trim().toUpperCase() : '';
    if (!normalizedName || !liveNameSet.has(normalizedName) || emittedNames.has(normalizedName)) {
      continue;
    }
    emittedNames.add(normalizedName);
    orderedNames.push(normalizedName);
  }
  for (const liveName of liveNames) {
    if (emittedNames.has(liveName)) {
      continue;
    }
    emittedNames.add(liveName);
    orderedNames.push(liveName);
  }
  return orderedNames;
}

function buildSourceUpdateModuleWakeFrame(frame: number, phase = SOURCE_UPDATE_PHASE_NORMAL): number {
  const normalizedFrame = Math.max(0, Math.min(SOURCE_FRAME_FOREVER, Math.trunc(frame)));
  return (normalizedFrame << 2) | (phase & 0x03);
}

function buildSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-update-module-block');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(nextCallFrameAndPhase);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceObjectHelperBaseBlockData(nextCallFrameAndPhase: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-object-helper-block');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(nextCallFrameAndPhase);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceBaseOnlyObjectHelperBlockData(
  nextCallFrameAndPhase: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-base-only-object-helper');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceObjectHelperBaseBlockData(nextCallFrameAndPhase));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceObjectDefectionHelperBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-object-defection-helper');
  try {
    const active = entity.undetectedDefectorUntilFrame > currentFrame && !entity.destroyed;
    saver.xferVersion(1);
    saver.xferUser(buildSourceObjectHelperBaseBlockData(
      active
        ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferUnsignedInt(entity.defectorHelperDetectionStartFrame);
    saver.xferUnsignedInt(entity.defectorHelperDetectionEndFrame);
    saver.xferReal(entity.defectorHelperFlashPhase);
    saver.xferBool(entity.defectorHelperDoFx);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFiringTrackerBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-firing-tracker');
  try {
    const nextCallFrame = entity.continuousFireCooldownFrame > currentFrame
      ? entity.continuousFireCooldownFrame
      : SOURCE_FRAME_FOREVER;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferInt(Math.max(0, Math.trunc(entity.consecutiveShotsAtTarget)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.consecutiveShotsTargetEntityId ?? 0)));
    saver.xferUnsignedInt(
      entity.continuousFireCooldownFrame > 0
        ? Math.max(0, Math.trunc(entity.continuousFireCooldownFrame))
        : 0,
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceOverchargeBehaviorBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-overcharge-behavior');
  try {
    const active = entity.overchargeActive && !entity.destroyed;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      active
        ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferBool(active);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceAutoHealBehaviorBlockData(
  data: Uint8Array,
): { upgradeExecuted: boolean; radiusParticleSystemId: number; soonestHealFrame: number; stopped: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-auto-heal-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(1);
    const upgradeExecuted = xferLoad.xferBool(false);
    const radiusParticleSystemId = xferLoad.xferUnsignedInt(0);
    const soonestHealFrame = xferLoad.xferUnsignedInt(0);
    const stopped = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? { upgradeExecuted, radiusParticleSystemId, soonestHealFrame, stopped }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function resolveSourceAutoHealBehaviorNextCallFrame(
  entity: MapEntity,
  currentFrame: number,
  upgradeExecuted: boolean,
): number {
  const profile = entity.autoHealProfile;
  if (!profile || entity.destroyed || entity.autoHealStopped) {
    return SOURCE_FRAME_FOREVER;
  }
  if (!profile.initiallyActive && !upgradeExecuted) {
    return SOURCE_FRAME_FOREVER;
  }
  if (profile.singleBurst && entity.autoHealSingleBurstDone) {
    return SOURCE_FRAME_FOREVER;
  }
  if (profile.affectsWholePlayer || profile.radius > 0) {
    return entity.autoHealNextFrame > currentFrame
      ? entity.autoHealNextFrame
      : currentFrame + 1;
  }
  if (entity.health >= entity.maxHealth) {
    return SOURCE_FRAME_FOREVER;
  }
  const nextHealFrame = Math.max(
    Math.max(0, Math.trunc(entity.autoHealNextFrame)),
    Math.max(0, Math.trunc(entity.autoHealDamageDelayUntilFrame)),
  );
  return nextHealFrame > currentFrame ? nextHealFrame : currentFrame + 1;
}

function buildSourceAutoHealBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  upgradeExecuted: boolean,
  radiusParticleSystemId: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-auto-heal-behavior');
  try {
    const nextCallFrame = resolveSourceAutoHealBehaviorNextCallFrame(entity, currentFrame, upgradeExecuted);
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(radiusParticleSystemId)));
    saver.xferUnsignedInt(
      entity.autoHealStopped
        ? SOURCE_FRAME_FOREVER
        : Math.max(0, Math.min(SOURCE_FRAME_FOREVER, Math.trunc(entity.autoHealSoonestHealFrame))),
    );
    saver.xferBool(entity.autoHealStopped);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceGrantStealthBehaviorBlockData(
  data: Uint8Array,
): { radiusParticleSystemId: number; currentScanRadius: number } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-grant-stealth-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    const radiusParticleSystemId = xferLoad.xferUnsignedInt(0);
    const currentScanRadius = xferLoad.xferReal(0);
    return xferLoad.getRemaining() === 0
      ? { radiusParticleSystemId, currentScanRadius }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceGrantStealthBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  radiusParticleSystemId: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-grant-stealth-behavior');
  try {
    const profile = entity.grantStealthProfile;
    const currentScanRadius = Number.isFinite(entity.grantStealthCurrentRadius)
      ? entity.grantStealthCurrentRadius
      : (profile?.startRadius ?? 0);
    const stillExpanding = !entity.destroyed
      && profile !== null
      && currentScanRadius < profile.finalRadius;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      stillExpanding
        ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(radiusParticleSystemId)));
    saver.xferReal(currentScanRadius);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceCountermeasuresBehaviorBlockData(
  data: Uint8Array,
): { upgradeExecuted: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-countermeasures-behavior');
  try {
    const version = xferLoad.xferVersion(2);
    if (version < 1 || version > 2) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(1);
    const upgradeExecuted = xferLoad.xferBool(false);
    xferLoad.xferObjectIDList([]);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? { upgradeExecuted }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceCountermeasuresBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  upgradeExecuted: boolean,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-countermeasures-behavior');
  try {
    const state = entity.countermeasuresState;
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      upgradeExecuted && !entity.destroyed
        ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    saver.xferObjectIDList(state?.flareIds ?? []);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.availableCountermeasures ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.activeCountermeasures ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.divertedMissiles ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.incomingMissiles ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.reactionFrame ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.nextVolleyFrame ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceWeaponBonusUpdateBlockData(nextCallFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-weapon-bonus-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePowerPlantUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-power-plant-update');
  try {
    const state = entity.powerPlantUpdateState;
    const nextCallFrame = state && state.upgradeFinishFrame > currentFrame
      ? state.upgradeFinishFrame
      : SOURCE_FRAME_FOREVER;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferBool(state?.extended === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceOclUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  moduleIndex: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-ocl-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.oclUpdateNextCreationFrames[moduleIndex] ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.oclUpdateTimerStartedFrames[moduleIndex] ?? 0)));
    saver.xferBool(entity.oclUpdateFactionNeutral[moduleIndex] === true);
    saver.xferInt(Math.trunc(entity.oclUpdateCurrentPlayerColors[moduleIndex] ?? 0));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceHordeUpdateBlockData(
  data: Uint8Array,
): { hasFlag: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-horde-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferBool(false);
    const hasFlag = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? { hasFlag }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceEnemyNearUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-enemy-near-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.enemyNearNextScanCountdown)));
    saver.xferBool(entity.enemyNearDetected === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceHordeUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  hasFlag: boolean,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-horde-update');
  try {
    const nextCallFrame = entity.kindOf.has('INFANTRY')
      ? (entity.hordeNextCheckFrame > currentFrame ? entity.hordeNextCheckFrame : currentFrame + 1)
      : currentFrame + 1;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferBool(entity.isInHorde === true);
    saver.xferBool(hasFlag);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceProneUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-prone-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferInt(Math.trunc(entity.proneFramesRemaining));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceFireOclAfterCooldownUpdateBlockData(
  data: Uint8Array,
): { upgradeExecuted: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-fire-ocl-after-cooldown-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferVersion(1);
    const upgradeExecuted = xferLoad.xferBool(false);
    xferLoad.xferBool(false);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? { upgradeExecuted }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceFireOclAfterCooldownUpdateBlockData(
  currentFrame: number,
  upgradeExecuted: boolean,
  state: { valid: boolean; consecutiveShots: number; startFrame: number },
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-fire-ocl-after-cooldown-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    saver.xferBool(state.valid === true);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state.consecutiveShots)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state.startFrame)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAutoFindHealingUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-auto-find-healing-update');
  try {
    const nextScanFrames = Math.max(
      0,
      Math.trunc(entity.autoFindHealingNextScanFrame) - currentFrame - 1,
    );
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferInt(nextScanFrames);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceRadiusDecalUpdateBlockData(
  data: Uint8Array,
): { killWhenNoLongerAttacking: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-radius-decal-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    const killWhenNoLongerAttacking = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? { killWhenNoLongerAttacking }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceRadiusDecalUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  killWhenNoLongerAttacking: boolean,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-radius-decal-update');
  try {
    const hasActiveDecal = entity.radiusDecalStates.some((state) => state.visible);
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(
        hasActiveDecal ? currentFrame + 1 : SOURCE_FRAME_FOREVER,
      ),
    ));
    saver.xferBool(killWhenNoLongerAttacking);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceBaseRegenerateUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-base-regenerate-update');
  try {
    let nextCallFrame = SOURCE_FRAME_FOREVER;
    if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) {
      nextCallFrame = currentFrame + 1;
    } else if (!entity.objectStatusFlags.has('SOLD') && entity.health < entity.maxHealth) {
      nextCallFrame = entity.baseRegenDelayUntilFrame > currentFrame
        ? entity.baseRegenDelayUntilFrame
        : currentFrame + 3;
    }
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceLeafletDropBehaviorBlockData(entity: MapEntity): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-leaflet-drop-behavior');
  try {
    saver.xferVersion(1);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.leafletDropState?.startFrame ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceEmpUpdateBlockData(): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-emp-update');
  try {
    saver.xferVersion(1);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRadarUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-radar-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.radarExtendDoneFrame)));
    saver.xferBool(entity.radarExtendComplete === true);
    saver.xferBool(entity.radarActive === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceNeutronMissileStateToInt(
  state: 'PRELAUNCH' | 'LAUNCH' | 'ATTACK' | 'DEAD',
): number {
  switch (state) {
    case 'PRELAUNCH': return 0;
    case 'LAUNCH': return 1;
    case 'ATTACK': return 2;
    case 'DEAD': return 3;
  }
}

function buildDefaultSourceNeutronMissileRawLaunchParamsBytes(currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-default-source-neutron-missile-raw-launch-params');
  try {
    saver.xferInt(0);
    saver.xferInt(0);
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferUnsignedInt(Math.max(0, Math.trunc(currentFrame)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceNeutronMissileUpdateBlockData(
  data: Uint8Array,
): {
  rawLaunchParamsBytes: Uint8Array;
  rawTailBytes: Uint8Array;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-neutron-missile-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferInt(0);
    xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    xferLoad.xferObjectID(0);
    const rawLaunchParamsBytes = xferLoad.xferUser(new Uint8Array(24));
    xferLoad.xferBool(false);
    xferLoad.xferBool(false);
    xferLoad.xferReal(0);
    xferLoad.xferBool(false);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferReal(0);
    const remaining = xferLoad.getRemaining();
    const rawTailBytes = remaining > 0
      ? xferLoad.xferUser(new Uint8Array(remaining))
      : new Uint8Array();
    return {
      rawLaunchParamsBytes,
      rawTailBytes,
    };
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceNeutronMissileUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: {
    rawLaunchParamsBytes: Uint8Array;
    rawTailBytes: Uint8Array;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-neutron-missile-update');
  try {
    const state = entity.neutronMissileUpdateState;
    const rawLaunchParamsBytes = preservedState?.rawLaunchParamsBytes?.byteLength === 24
      ? preservedState.rawLaunchParamsBytes
      : buildDefaultSourceNeutronMissileRawLaunchParamsBytes(currentFrame);
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUser(
      sourceNeutronMissileStateToInt(state?.state ?? 'PRELAUNCH'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferCoord3D({
      x: state?.targetX ?? 0,
      y: state?.targetY ?? 0,
      z: state?.targetZ ?? 0,
    });
    saver.xferCoord3D({
      x: state?.intermedX ?? 0,
      y: state?.intermedY ?? 0,
      z: state?.intermedZ ?? 0,
    });
    saver.xferObjectID(Math.max(0, Math.trunc(state?.launcherId ?? 0)));
    saver.xferUser(rawLaunchParamsBytes);
    saver.xferBool(state?.isLaunched === true);
    saver.xferBool(state?.isArmed === true);
    saver.xferReal(state?.noTurnDistLeft ?? 0);
    saver.xferBool(state?.reachedIntermediatePos === true);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.frameAtLaunch ?? 0)));
    saver.xferReal(state?.heightAtLaunch ?? 0);
    if (preservedState?.rawTailBytes && preservedState.rawTailBytes.byteLength > 0) {
      saver.xferUser(preservedState.rawTailBytes);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceSpyVisionUpdateBlockData(
  data: Uint8Array,
): {
  currentlyActive: boolean;
  resetTimersNextUpdate: boolean;
  disabledUntilFrame: number;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-spy-vision-update');
  try {
    const version = xferLoad.xferVersion(2);
    if (version < 1 || version > 2) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    const currentlyActive = xferLoad.xferBool(false);
    const resetTimersNextUpdate = version >= 2 ? xferLoad.xferBool(false) : false;
    const disabledUntilFrame = version >= 2 ? xferLoad.xferUnsignedInt(0) : 0;
    return xferLoad.getRemaining() === 0
      ? { currentlyActive, resetTimersNextUpdate, disabledUntilFrame }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpyVisionUpdateBlockData(
  deactivateFrame: number,
  preservedState?: {
    currentlyActive: boolean;
    resetTimersNextUpdate: boolean;
    disabledUntilFrame: number;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-spy-vision-update');
  try {
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(deactivateFrame)));
    saver.xferBool(preservedState?.currentlyActive ?? false);
    saver.xferBool(preservedState?.resetTimersNextUpdate ?? false);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(preservedState?.disabledUntilFrame ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceSpecialAbilityPackingStateToInt(
  state: 'NONE' | 'PACKING' | 'UNPACKING' | 'PACKED' | 'UNPACKED',
): number {
  switch (state) {
    case 'NONE': return 0;
    case 'PACKING': return 1;
    case 'UNPACKING': return 2;
    case 'PACKED': return 3;
    case 'UNPACKED': return 4;
  }
}

function tryParseSourceSpecialAbilityUpdateBlockData(
  data: Uint8Array,
): {
  targetPos: { x: number; y: number; z: number };
  locationCount: number;
  specialObjectIdList: number[];
  specialObjectEntries: number;
  facingInitiated: boolean;
  facingComplete: boolean;
  doDisableFxParticles: boolean;
  captureFlashPhase: number;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-special-ability-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferBool(false);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferObjectID(0);
    const targetPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const locationCount = xferLoad.xferInt(0);
    const specialObjectIdList = xferLoad.xferObjectIDList([]);
    const specialObjectEntries = xferLoad.xferUnsignedInt(0);
    xferLoad.xferBool(false);
    xferLoad.xferInt(0);
    const facingInitiated = xferLoad.xferBool(false);
    const facingComplete = xferLoad.xferBool(false);
    xferLoad.xferBool(false);
    const doDisableFxParticles = xferLoad.xferBool(true);
    const captureFlashPhase = xferLoad.xferReal(0);
    return xferLoad.getRemaining() === 0
      ? {
        targetPos,
        locationCount,
        specialObjectIdList,
        specialObjectEntries,
        facingInitiated,
        facingComplete,
        doDisableFxParticles,
        captureFlashPhase,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpecialAbilityUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: {
    targetPos: { x: number; y: number; z: number };
    locationCount: number;
    specialObjectIdList: number[];
    specialObjectEntries: number;
    facingInitiated: boolean;
    facingComplete: boolean;
    doDisableFxParticles: boolean;
    captureFlashPhase: number;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-special-ability-update');
  try {
    const profile = entity.specialAbilityProfile;
    const state = entity.specialAbilityState;
    const nextCallFrame = state?.active === true || profile?.alwaysValidateSpecialObjects === true
      ? currentFrame + 1
      : SOURCE_FRAME_FOREVER;
    const targetEntityId = state?.targetEntityId ?? null;
    let targetPos = preservedState?.targetPos ?? { x: 0, y: 0, z: 0 };
    if (targetEntityId !== null) {
      targetPos = { x: 0, y: 0, z: 0 };
    } else if (Number.isFinite(state?.targetX) || Number.isFinite(state?.targetZ)) {
      targetPos = {
        x: Number.isFinite(state?.targetX) ? state!.targetX! : 0,
        y: preservedState?.targetPos.y ?? 0,
        z: Number.isFinite(state?.targetZ) ? state!.targetZ! : 0,
      };
    } else if (state?.noTargetCommand === true) {
      targetPos = { x: 0, y: 0, z: 0 };
    }
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferBool(state?.active === true);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.prepFrames ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.animFrames ?? 0)));
    saver.xferObjectID(Math.max(0, Math.trunc(targetEntityId ?? 0)));
    saver.xferCoord3D(targetPos);
    saver.xferInt(Math.trunc(preservedState?.locationCount ?? 0));
    saver.xferObjectIDList(preservedState?.specialObjectIdList ?? []);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(preservedState?.specialObjectEntries ?? 0)));
    saver.xferBool(state?.noTargetCommand === true);
    saver.xferUser(
      sourceSpecialAbilityPackingStateToInt(state?.packingState ?? 'NONE'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferBool(preservedState?.facingInitiated ?? false);
    saver.xferBool(preservedState?.facingComplete ?? false);
    saver.xferBool(state?.withinStartAbilityRange === true);
    saver.xferBool(preservedState?.doDisableFxParticles ?? true);
    saver.xferReal(preservedState?.captureFlashPhase ?? 0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceMissileDoorStateToInt(
  state: 'CLOSED' | 'OPENING' | 'OPEN' | 'WAITING_TO_CLOSE' | 'CLOSING',
): number {
  switch (state) {
    case 'CLOSED': return 0;
    case 'OPENING': return 1;
    case 'OPEN': return 2;
    case 'WAITING_TO_CLOSE': return 3;
    case 'CLOSING': return 4;
  }
}

function sourceStructureToppleStateToInt(
  state: 'STANDING' | 'WAITING' | 'TOPPLING' | 'WAITING_DONE' | 'DONE',
): number {
  switch (state) {
    case 'STANDING': return 0;
    case 'WAITING': return 1;
    case 'TOPPLING': return 2;
    case 'WAITING_DONE': return 3;
    case 'DONE': return 4;
  }
}

function sourceToppleStateToInt(
  state: 'NONE' | 'TOPPLING' | 'BOUNCING' | 'DONE',
): number {
  switch (state) {
    case 'NONE': return 0;
    case 'TOPPLING':
    case 'BOUNCING':
      return 1;
    case 'DONE':
      return 2;
  }
}

function sourceStructureCollapseStateToInt(
  state: 'WAITING' | 'COLLAPSING' | 'DONE' | null | undefined,
): number {
  switch (state) {
    case 'WAITING': return 1;
    case 'COLLAPSING': return 2;
    case 'DONE': return 3;
    default: return 0;
  }
}

function tryParseSourceToppleUpdateBlockData(
  data: Uint8Array,
): {
  angleDeltaX: number;
  numAngleDeltaX: number;
  doBounceFx: boolean;
  options: number;
  stumpId: number;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-topple-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    xferLoad.xferInt(0);
    xferLoad.xferReal(0);
    const angleDeltaX = xferLoad.xferReal(0);
    const numAngleDeltaX = xferLoad.xferInt(0);
    const doBounceFx = xferLoad.xferBool(false);
    const options = xferLoad.xferUnsignedInt(0);
    const stumpId = xferLoad.xferObjectID(0);
    return xferLoad.getRemaining() === 0
      ? { angleDeltaX, numAngleDeltaX, doBounceFx, options, stumpId }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceToppleUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: {
    angleDeltaX: number;
    numAngleDeltaX: number;
    doBounceFx: boolean;
    options: number;
    stumpId: number;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-topple-update');
  try {
    const profile = entity.toppleProfile;
    const nextCallFrame = entity.toppleState !== 'NONE' && entity.toppleState !== 'DONE'
      ? currentFrame + 1
      : SOURCE_FRAME_FOREVER;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferReal(entity.toppleAngularVelocity);
    saver.xferReal((profile?.initialAccelPercent ?? 0) * entity.toppleSpeed);
    saver.xferCoord3D({ x: entity.toppleDirX, y: entity.toppleDirZ, z: 0 });
    saver.xferUser(
      sourceToppleStateToInt(entity.toppleState),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferReal(entity.toppleAngularAccumulation);
    saver.xferReal(preservedState?.angleDeltaX ?? 0);
    saver.xferInt(Math.trunc(preservedState?.numAngleDeltaX ?? 0));
    saver.xferBool(preservedState?.doBounceFx ?? false);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(preservedState?.options ?? 0)));
    saver.xferObjectID(Math.max(0, Math.trunc(preservedState?.stumpId ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStructureCollapseUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-structure-collapse-update');
  try {
    const state = entity.structureCollapseState;
    const nextCallFrame = state && state.state !== 'DONE'
      ? currentFrame + 1
      : SOURCE_FRAME_FOREVER;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.collapseFrame ?? 0)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.burstFrame ?? 0)));
    saver.xferUser(
      sourceStructureCollapseStateToInt(state?.state),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferReal(state?.collapseVelocity ?? 0);
    saver.xferReal(state?.currentHeight ?? 0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceStructureToppleUpdateBlockData(
  data: Uint8Array,
): {
  nextBurstFrame: number;
  delayBurstLocation: { x: number; y: number; z: number };
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-structure-topple-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    xferLoad.xferInt(0);
    xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    const nextBurstFrame = xferLoad.xferInt(0);
    const delayBurstLocation = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    return xferLoad.getRemaining() === 0
      ? { nextBurstFrame, delayBurstLocation }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceStructureToppleUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: {
    nextBurstFrame: number;
    delayBurstLocation: { x: number; y: number; z: number };
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-structure-topple-update');
  try {
    const state = entity.structureToppleState;
    const nextCallFrame = state && state.state !== 'STANDING' && state.state !== 'DONE'
      ? currentFrame + 1
      : SOURCE_FRAME_FOREVER;
    const delayBurstLocation = state?.delayBurstLocation
      && Number.isFinite(state.delayBurstLocation.x)
      && Number.isFinite(state.delayBurstLocation.y)
      && Number.isFinite(state.delayBurstLocation.z)
        ? state.delayBurstLocation
        : (preservedState?.delayBurstLocation ?? { x: 0, y: 0, z: 0 });
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.toppleFrame ?? 0)));
    saver.xferReal(state?.toppleDirX ?? 0);
    saver.xferReal(state?.toppleDirZ ?? 0);
    saver.xferUser(
      sourceStructureToppleStateToInt(state?.state ?? 'STANDING'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferReal(state?.toppleVelocity ?? 0);
    saver.xferReal(state?.accumulatedAngle ?? 0.001);
    saver.xferReal(state?.structuralIntegrity ?? 0);
    saver.xferReal(state?.lastCrushedLocation ?? 0);
    saver.xferInt(
      Number.isFinite(state?.nextBurstFrame) && (state?.nextBurstFrame ?? -1) >= 0
        ? Math.trunc(state!.nextBurstFrame)
        : Math.trunc(preservedState?.nextBurstFrame ?? -1),
    );
    saver.xferCoord3D(delayBurstLocation);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceMissileLauncherBuildingUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-missile-launcher-building-update');
  try {
    const state = entity.missileLauncherBuildingState;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUser(
      sourceMissileDoorStateToInt(state?.doorState ?? 'CLOSED'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferUser(
      sourceMissileDoorStateToInt(state?.timeoutState ?? 'CLOSED'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.timeoutFrame ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCheckpointUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-checkpoint-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferBool(entity.checkpointEnemyNear === true);
    saver.xferBool(entity.checkpointAllyNear === true);
    saver.xferReal(entity.checkpointMaxMinorRadius);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.checkpointScanCountdown)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceHijackerUpdateBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-hijacker-update');
  try {
    const state = entity.hijackerState;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferObjectID(state?.targetId ?? 0);
    saver.xferCoord3D({
      x: state?.ejectX ?? 0,
      y: state?.ejectY ?? 0,
      z: state?.ejectZ ?? 0,
    });
    saver.xferBool(state !== null);
    saver.xferBool(state?.isInVehicle === true);
    saver.xferBool(state?.wasTargetAirborne === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceWeaponBonusFlagToCondition(flag: number): number {
  if (!Number.isInteger(flag) || flag <= 0 || (flag & (flag - 1)) !== 0) {
    return -1;
  }
  return Math.trunc(Math.log2(flag));
}

function buildSourceTempWeaponBonusHelperBlockData(entity: MapEntity): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-temp-weapon-bonus-helper');
  try {
    const expiryFrame = entity.tempWeaponBonusFlag !== 0
      ? Math.max(0, Math.trunc(entity.tempWeaponBonusExpiryFrame))
      : 0;
    saver.xferVersion(1);
    saver.xferUser(buildSourceObjectHelperBaseBlockData(
      expiryFrame > 0
        ? buildSourceUpdateModuleWakeFrame(expiryFrame)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferInt(sourceWeaponBonusFlagToCondition(entity.tempWeaponBonusFlag));
    saver.xferUnsignedInt(expiryFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSubdualDamageHelperBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-subdual-damage-helper');
  try {
    const active = entity.currentSubdualDamage > 0 && !entity.destroyed;
    saver.xferVersion(1);
    saver.xferUser(buildSourceObjectHelperBaseBlockData(
      active
        ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.subdualHealingCountdown)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceObjectSmcHelperBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const specialModelConditionUntil = Math.max(
    entity.cheerTimerFrames > 0 ? currentFrame + Math.max(1, Math.trunc(entity.cheerTimerFrames)) : 0,
    entity.raisingFlagTimerFrames > 0 ? currentFrame + Math.max(1, Math.trunc(entity.raisingFlagTimerFrames)) : 0,
  );
  return buildSourceBaseOnlyObjectHelperBlockData(
    specialModelConditionUntil > currentFrame
      ? buildSourceUpdateModuleWakeFrame(specialModelConditionUntil)
      : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
  );
}

function buildSourceObjectRepulsorHelperBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  return buildSourceBaseOnlyObjectHelperBlockData(
    entity.repulsorHelperUntilFrame > currentFrame
      ? buildSourceUpdateModuleWakeFrame(entity.repulsorHelperUntilFrame)
      : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
  );
}

function buildSourceStatusDamageHelperBlockData(entity: MapEntity, currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-status-damage-helper');
  try {
    const active = entity.statusDamageStatusName !== null
      && entity.statusDamageClearFrame > currentFrame
      && !entity.destroyed;
    saver.xferVersion(1);
    saver.xferUser(buildSourceObjectHelperBaseBlockData(
      active
        ? buildSourceUpdateModuleWakeFrame(entity.statusDamageClearFrame)
        : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    ));
    saver.xferInt(active ? sourceObjectStatusNameToType(entity.statusDamageStatusName) : 0);
    saver.xferUnsignedInt(active ? Math.max(0, Math.trunc(entity.statusDamageClearFrame)) : 0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceObjectWeaponStatusHelperBlockData(currentFrame: number): Uint8Array {
  return buildSourceBaseOnlyObjectHelperBlockData(
    buildSourceUpdateModuleWakeFrame(currentFrame + 1, SOURCE_UPDATE_PHASE_FINAL),
  );
}

function overlaySourceObjectModulesFromLiveEntity(
  sourceModules: readonly SourceObjectModuleSaveState[],
  entity: MapEntity,
  currentFrame: number,
  templateName?: string | null,
  resolveSourceObjectModuleTypeByTag?: ((templateName: string, moduleTag: string) => string | null) | null,
): SourceObjectModuleSaveState[] {
  return sourceModules.map((module) => {
    switch (module.identifier) {
      case SOURCE_HELPER_MODULE_TAG_FIRING_TRACKER:
        return {
          identifier: module.identifier,
          blockData: buildSourceFiringTrackerBlockData(entity, currentFrame),
        };
      case SOURCE_HELPER_MODULE_TAG_SMC:
        return {
          identifier: module.identifier,
          blockData: buildSourceObjectSmcHelperBlockData(entity, currentFrame),
        };
      case SOURCE_HELPER_MODULE_TAG_REPULSOR:
        return {
          identifier: module.identifier,
          blockData: buildSourceObjectRepulsorHelperBlockData(entity, currentFrame),
        };
      case SOURCE_HELPER_MODULE_TAG_STATUS_DAMAGE:
        return {
          identifier: module.identifier,
          blockData: buildSourceStatusDamageHelperBlockData(entity, currentFrame),
        };
      case SOURCE_HELPER_MODULE_TAG_WEAPON_STATUS:
        return {
          identifier: module.identifier,
          blockData: buildSourceObjectWeaponStatusHelperBlockData(currentFrame),
        };
      case SOURCE_HELPER_MODULE_TAG_DEFECTION:
        return {
          identifier: module.identifier,
          blockData: buildSourceObjectDefectionHelperBlockData(entity, currentFrame),
        };
      case SOURCE_HELPER_MODULE_TAG_TEMP_WEAPON_BONUS:
        return {
          identifier: module.identifier,
          blockData: buildSourceTempWeaponBonusHelperBlockData(entity),
        };
      case SOURCE_HELPER_MODULE_TAG_SUBDUAL_DAMAGE:
        return {
          identifier: module.identifier,
          blockData: buildSourceSubdualDamageHelperBlockData(entity, currentFrame),
        };
      default:
        if (templateName && typeof resolveSourceObjectModuleTypeByTag === 'function') {
          const moduleType = resolveSourceObjectModuleTypeByTag(templateName, module.identifier)?.trim().toUpperCase() ?? '';
          if (moduleType === 'AUTOHEALBEHAVIOR' && entity.autoHealProfile) {
            const parsedSourceState = tryParseSourceAutoHealBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceAutoHealBehaviorBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState.upgradeExecuted,
                  parsedSourceState.radiusParticleSystemId,
                ),
              };
            }
          }
          if (moduleType === 'OVERCHARGEBEHAVIOR') {
            return {
              identifier: module.identifier,
              blockData: buildSourceOverchargeBehaviorBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'GRANTSTEALTHBEHAVIOR' && entity.grantStealthProfile) {
            const parsedSourceState = tryParseSourceGrantStealthBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceGrantStealthBehaviorBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState.radiusParticleSystemId,
                ),
              };
            }
          }
          if (moduleType === 'COUNTERMEASURESBEHAVIOR' && entity.countermeasuresState) {
            const parsedSourceState = tryParseSourceCountermeasuresBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceCountermeasuresBehaviorBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState.upgradeExecuted,
                ),
              };
            }
          }
          if (moduleType === 'WEAPONBONUSUPDATE' && entity.weaponBonusUpdateProfiles.length > 0) {
            const moduleTag = module.identifier.trim().toUpperCase();
            const moduleIndex = entity.weaponBonusUpdateProfiles.findIndex(
              (profile) => profile.moduleTag === moduleTag,
            );
            if (moduleIndex >= 0) {
              const nextPulseFrame = entity.weaponBonusUpdateNextPulseFrames[moduleIndex] ?? 0;
              return {
                identifier: module.identifier,
                blockData: buildSourceWeaponBonusUpdateBlockData(
                  nextPulseFrame > currentFrame ? nextPulseFrame : currentFrame + 1,
                ),
              };
            }
          }
          if (moduleType === 'OCLUPDATE' && entity.oclUpdateProfiles.length > 0) {
            const moduleTag = module.identifier.trim().toUpperCase();
            const moduleIndex = entity.oclUpdateProfiles.findIndex(
              (profile) => profile.moduleTag === moduleTag,
            );
            if (moduleIndex >= 0) {
              return {
                identifier: module.identifier,
                blockData: buildSourceOclUpdateBlockData(entity, currentFrame, moduleIndex),
              };
            }
          }
          if (moduleType === 'POWERPLANTUPDATE' && entity.powerPlantUpdateState) {
            return {
              identifier: module.identifier,
              blockData: buildSourcePowerPlantUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'ENEMYNEARUPDATE' && entity.enemyNearScanDelayFrames > 0) {
            return {
              identifier: module.identifier,
              blockData: buildSourceEnemyNearUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'HORDEUPDATE' && entity.hordeProfile) {
            const parsedSourceState = tryParseSourceHordeUpdateBlockData(module.blockData);
            return {
              identifier: module.identifier,
              blockData: buildSourceHordeUpdateBlockData(
                entity,
                currentFrame,
                parsedSourceState?.hasFlag ?? false,
              ),
            };
          }
          if (moduleType === 'PRONEUPDATE' && entity.proneDamageToFramesRatio !== null) {
            return {
              identifier: module.identifier,
              blockData: buildSourceProneUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'FIREOCLAFTERWEAPONCOOLDOWNUPDATE' && entity.fireOCLAfterCooldownProfiles.length > 0) {
            const moduleTag = module.identifier.trim().toUpperCase();
            const moduleIndex = entity.fireOCLAfterCooldownProfiles.findIndex(
              (profile) => (profile.moduleTag ?? null) === moduleTag,
            );
            if (moduleIndex >= 0) {
              const parsedSourceState = tryParseSourceFireOclAfterCooldownUpdateBlockData(module.blockData);
              const state = entity.fireOCLAfterCooldownStates[moduleIndex];
              if (parsedSourceState && state) {
                return {
                  identifier: module.identifier,
                  blockData: buildSourceFireOclAfterCooldownUpdateBlockData(
                    currentFrame,
                    parsedSourceState.upgradeExecuted,
                    state,
                  ),
                };
              }
            }
          }
          if (moduleType === 'AUTOFINDHEALINGUPDATE' && entity.autoFindHealingProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceAutoFindHealingUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'RADIUSDECALUPDATE') {
            const parsedSourceState = tryParseSourceRadiusDecalUpdateBlockData(module.blockData);
            const liveKillWhenNoLongerAttacking = entity.radiusDecalStates.some(
              (state) => state.killWhenNoLongerAttacking,
            );
            return {
              identifier: module.identifier,
              blockData: buildSourceRadiusDecalUpdateBlockData(
                entity,
                currentFrame,
                liveKillWhenNoLongerAttacking || (parsedSourceState?.killWhenNoLongerAttacking ?? false),
              ),
            };
          }
          if (moduleType === 'BASEREGENERATEUPDATE') {
            return {
              identifier: module.identifier,
              blockData: buildSourceBaseRegenerateUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'LEAFLETDROPBEHAVIOR' && entity.leafletDropState) {
            return {
              identifier: module.identifier,
              blockData: buildSourceLeafletDropBehaviorBlockData(entity),
            };
          }
          if (moduleType === 'EMPUPDATE' && entity.empUpdateProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceEmpUpdateBlockData(),
            };
          }
          if (moduleType === 'RADARUPDATE' && entity.radarUpdateProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceRadarUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'NEUTRONMISSILEUPDATE' && entity.neutronMissileUpdateProfile && entity.neutronMissileUpdateState) {
            const parsedSourceState = tryParseSourceNeutronMissileUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceNeutronMissileUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'SPYVISIONUPDATE') {
            const parsedSourceState = tryParseSourceSpyVisionUpdateBlockData(module.blockData);
            const liveSpyVisionModule = Array.from(entity.specialPowerModules.values()).find(
              (specialPowerModule) => specialPowerModule.moduleType === 'SPYVISIONSPECIALPOWER',
            );
            if (parsedSourceState && liveSpyVisionModule) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSpyVisionUpdateBlockData(
                  liveSpyVisionModule.spyVisionDeactivateFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'SPECIALABILITYUPDATE' && entity.specialAbilityProfile && entity.specialAbilityState) {
            return {
              identifier: module.identifier,
              blockData: buildSourceSpecialAbilityUpdateBlockData(
                entity,
                currentFrame,
                tryParseSourceSpecialAbilityUpdateBlockData(module.blockData),
              ),
            };
          }
          if (moduleType === 'TOPPLEUPDATE' && entity.toppleProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceToppleUpdateBlockData(
                entity,
                currentFrame,
                tryParseSourceToppleUpdateBlockData(module.blockData),
              ),
            };
          }
          if (moduleType === 'STRUCTURECOLLAPSEUPDATE' && entity.structureCollapseProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceStructureCollapseUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'MISSILELAUNCHERBUILDINGUPDATE' && entity.missileLauncherBuildingProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceMissileLauncherBuildingUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'CHECKPOINTUPDATE' && entity.checkpointProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceCheckpointUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'STRUCTURETOPPLEUPDATE' && entity.structureToppleProfile && entity.structureToppleState) {
            return {
              identifier: module.identifier,
              blockData: buildSourceStructureToppleUpdateBlockData(
                entity,
                currentFrame,
                tryParseSourceStructureToppleUpdateBlockData(module.blockData),
              ),
            };
          }
          if (moduleType === 'HIJACKERUPDATE' && entity.hijackerState) {
            return {
              identifier: module.identifier,
              blockData: buildSourceHijackerUpdateBlockData(entity, currentFrame),
            };
          }
        }
        return {
          identifier: module.identifier,
          blockData: new Uint8Array(module.blockData),
        };
    }
  });
}

function overlaySourceObjectStateFromLiveEntity(
  sourceState: SourceMapEntitySaveState,
  entity: MapEntity,
  currentFrame: number,
  triggerAreaState?: GameLogicObjectTriggerAreaSaveState | null,
  objectXferOverlayState?: GameLogicObjectXferOverlayState | null,
  templateName?: string | null,
  resolveSourceObjectModuleTypeByTag?: ((templateName: string, moduleTag: string) => string | null) | null,
): SourceMapEntitySaveState {
  const hasTransform = Number.isFinite(entity.x)
    && Number.isFinite(entity.y)
    && Number.isFinite(entity.z)
    && Number.isFinite(entity.rotationY);
  const scriptStatus = collectSourceScriptStatus(entity);
  const disabledState = resolveSourceDisabledState(sourceState, entity, scriptStatus);
  const customIndicatorColor = typeof entity.customIndicatorColor === 'number'
    && Number.isFinite(entity.customIndicatorColor)
      ? entity.customIndicatorColor
      : null;
  return {
    ...sourceState,
    objectId: entity.id,
    transformMatrix: hasTransform
      ? buildSourceTransformMatrixValues(entity.x, entity.y, entity.z, entity.rotationY)
      : sourceState.transformMatrix,
    position: hasTransform
      ? { x: entity.x, y: entity.y, z: entity.z }
      : sourceState.position,
    orientation: hasTransform ? entity.rotationY : sourceState.orientation,
    internalName: entity.scriptName?.trim() || sourceState.internalName,
    statusBits: collectSourceObjectStatusBits(entity),
    scriptStatus,
    privateStatus: objectXferOverlayState?.privateStatus ?? sourceState.privateStatus,
    visionRange: Number.isFinite(entity.visionRange) ? entity.visionRange : sourceState.visionRange,
    shroudClearingRange: Number.isFinite(entity.shroudClearingRange)
      ? entity.shroudClearingRange
      : sourceState.shroudClearingRange,
    builderId: Number.isFinite(entity.builderId) ? Math.trunc(entity.builderId) : sourceState.builderId,
    disabledMask: disabledState.disabledMask,
    disabledTillFrame: disabledState.disabledTillFrame,
    specialModelConditionUntil:
      objectXferOverlayState?.specialModelConditionUntil ?? sourceState.specialModelConditionUntil,
    experienceTracker: {
      ...sourceState.experienceTracker,
      currentLevel: Number.isFinite(entity.experienceState?.currentLevel)
        ? entity.experienceState.currentLevel
        : sourceState.experienceTracker.currentLevel,
      currentExperience: Number.isFinite(entity.experienceState?.currentExperience)
        ? entity.experienceState.currentExperience
        : sourceState.experienceTracker.currentExperience,
      experienceSinkObjectId: Number.isFinite(entity.experienceState?.experienceSinkEntityId)
        && entity.experienceState.experienceSinkEntityId > 0
        ? entity.experienceState.experienceSinkEntityId
        : 0,
      experienceScalar: Number.isFinite(entity.experienceState?.experienceScalar)
        ? entity.experienceState.experienceScalar
        : sourceState.experienceTracker.experienceScalar,
    },
    ...resolveSourceContainedByState(sourceState, entity),
    constructionPercent: Number.isFinite(entity.constructionPercent)
      ? entity.constructionPercent
      : sourceState.constructionPercent,
    completedUpgradeNames: entity.completedUpgrades instanceof Set
      ? [...entity.completedUpgrades].sort()
      : sourceState.completedUpgradeNames,
    originalTeamName: entity.sourceTeamNameUpper?.trim().toUpperCase() || sourceState.originalTeamName,
    ...resolveSourceTriggerAreaState(sourceState, triggerAreaState),
    indicatorColor: customIndicatorColor !== null
      ? normalizeSourcePackedColor(customIndicatorColor)
      : sourceState.indicatorColor,
    healthBoxOffset:
      entity.healthBoxOffset
      && Number.isFinite(entity.healthBoxOffset.x)
      && Number.isFinite(entity.healthBoxOffset.y)
      && Number.isFinite(entity.healthBoxOffset.z)
        ? {
            x: entity.healthBoxOffset.x,
            y: entity.healthBoxOffset.y,
            z: entity.healthBoxOffset.z,
          }
        : sourceState.healthBoxOffset,
    soleHealingBenefactorId: entity.soleHealingBenefactorId ?? sourceState.soleHealingBenefactorId,
    soleHealingBenefactorExpirationFrame: Number.isFinite(entity.soleHealingBenefactorExpirationFrame)
      ? Math.max(0, Math.trunc(entity.soleHealingBenefactorExpirationFrame))
      : sourceState.soleHealingBenefactorExpirationFrame,
    weaponSetFlags: Number.isFinite(entity.weaponSetFlagsMask)
      ? Array.from(WEAPON_SET_FLAG_MASK_BY_NAME.entries())
        .filter(([, bit]) => (entity.weaponSetFlagsMask & bit) !== 0)
        .map(([name]) => name)
      : sourceState.weaponSetFlags,
    weaponBonusCondition: Number.isFinite(entity.weaponBonusConditionFlags)
      ? entity.weaponBonusConditionFlags
      : sourceState.weaponBonusCondition,
    lastWeaponCondition: Array.isArray(objectXferOverlayState?.lastWeaponCondition)
      ? [...objectXferOverlayState.lastWeaponCondition]
      : sourceState.lastWeaponCondition,
    weaponSet: overlaySourceWeaponSetFromLiveEntity(sourceState, entity),
    specialPowerBits: overlaySourceSpecialPowerBitsFromLiveEntity(sourceState, entity),
    modules: overlaySourceObjectModulesFromLiveEntity(
      sourceState.modules,
      entity,
      currentFrame,
      templateName,
      resolveSourceObjectModuleTypeByTag,
    ),
    commandSetStringOverride: typeof entity.commandSetStringOverride === 'string'
      ? entity.commandSetStringOverride
      : sourceState.commandSetStringOverride,
    modulesReady: objectXferOverlayState?.modulesReady ?? sourceState.modulesReady,
    isReceivingDifficultyBonus: typeof entity.receivingDifficultyBonus === 'boolean'
      ? entity.receivingDifficultyBonus
      : sourceState.isReceivingDifficultyBonus,
  };
}

function buildSourceGameLogicChunk(
  sourceState: ParsedSourceGameLogicChunkState,
  options: {
    campaignState?: RuntimeSaveCampaignState | null;
    coreState?: GameLogicCoreSaveState | null;
    objectXferOverlayStates?: readonly GameLogicObjectXferOverlayState[] | null;
    resolveSourceObjectModuleTypeByTag?: ((templateName: string, moduleTag: string) => string | null) | null;
  } = {},
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-game-logic');
  try {
    const coreState = options.coreState ?? null;
    const campaignState = options.campaignState ?? sourceState.campaignState;
    const liveEntityById = new Map(
      (coreState?.spawnedEntities ?? []).map((entity) => [entity.id, entity]),
    );
    const liveTriggerAreaStateByEntityId = new Map(
      (coreState?.objectTriggerAreaStates ?? []).map((state) => [state.entityId, state]),
    );
    const objectXferOverlayStateByEntityId = new Map(
      (options.objectXferOverlayStates ?? []).map((state) => [state.entityId, state]),
    );
    saver.xferVersion(sourceState.version);
    saver.xferUnsignedInt(coreState?.frameCounter ?? sourceState.frameCounter);
    saver.xferVersion(1);
    saver.xferUnsignedInt(sourceState.objectTocEntries.length);
    for (const tocEntry of sourceState.objectTocEntries) {
      saver.xferAsciiString(tocEntry.templateName);
      saver.xferUnsignedShort(tocEntry.tocId);
    }

    saver.xferUnsignedInt(sourceState.objects.length);
    for (const object of sourceState.objects) {
      saver.xferUnsignedShort(object.tocId);
      saver.beginBlock();
      const liveEntity = liveEntityById.get(object.state.objectId);
      saver.xferUser(
        liveEntity
          ? new Uint8Array(buildSourceMapEntityChunk(
              overlaySourceObjectStateFromLiveEntity(
                object.state,
                liveEntity,
                coreState?.frameCounter ?? sourceState.frameCounter,
                liveTriggerAreaStateByEntityId.get(liveEntity.id),
                objectXferOverlayStateByEntityId.get(liveEntity.id),
                object.templateName ?? liveEntity.templateName,
                options.resolveSourceObjectModuleTypeByTag,
              ),
            ))
          : new Uint8Array(object.blockData),
      );
      saver.endBlock();
    }

    saver.xferSnapshot(new CampaignSnapshot({
      version: campaignState.version,
      currentCampaign: campaignState.currentCampaign,
      currentMission: campaignState.currentMission,
      currentRankPoints: campaignState.currentRankPoints,
      difficulty: campaignState.difficulty,
      isChallengeCampaign: campaignState.isChallengeCampaign,
      playerTemplateNum: campaignState.playerTemplateNum,
      challengeGameInfoState: campaignState.challengeGameInfoState,
    }));
    xferSourceCaveTrackerVector(saver, coreState?.caveTrackers ?? sourceState.caveTrackers);
    if (sourceState.version >= 2) {
      saver.xferBool(coreState?.scriptScoringEnabled ?? sourceState.scriptScoringEnabled);
    }
    if (sourceState.version >= 3) {
      saver.xferUnsignedInt(sourceState.polygonTriggers.length);
      for (const polygonTrigger of sourceState.polygonTriggers) {
        saver.xferInt(polygonTrigger.triggerId);
        xferSourcePolygonTriggerSnapshot(saver, polygonTrigger.snapshot);
      }
    }
    if (sourceState.version >= 5) {
      saver.xferInt(coreState?.rankLevelLimit ?? sourceState.rankLevelLimit ?? 0);
    }
    if (sourceState.version >= 6) {
      xferSourceSellingEntities(saver, coreState?.sellingEntities ?? sourceState.sellingEntities);
      xferSourceBuildableOverrideMap(
        saver,
        coreState?.buildableOverrides ?? sourceState.buildableOverrides,
      );
    }
    if (sourceState.version >= 8) {
      saver.xferBool(coreState?.showBehindBuildingMarkers ?? sourceState.showBehindBuildingMarkers ?? false);
      saver.xferBool(coreState?.drawIconUI ?? sourceState.drawIconUI ?? false);
      saver.xferBool(coreState?.showDynamicLOD ?? sourceState.showDynamicLOD ?? false);
      saver.xferInt(coreState?.scriptHulkMaxLifetimeOverride ?? sourceState.scriptHulkMaxLifetimeOverride ?? 0);
      xferSourceControlBarOverrideMapEntries(saver, sourceState.controlBarOverrideEntries);
    }
    if (sourceState.version >= 9) {
      saver.xferInt(coreState?.rankPointsToAddAtGameStart ?? sourceState.rankPointsToAddAtGameStart ?? 0);
    }
    if (sourceState.version >= 10) {
      saver.xferUnsignedShort(coreState?.superweaponRestriction ?? sourceState.superweaponRestriction ?? 0);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

export function inspectGameLogicChunkLayout(
  data: ArrayBuffer | Uint8Array,
): RuntimeSaveGameLogicChunkLayoutInspection {
  const sourceInspection = inspectSourceGameLogicChunk(data);
  if (sourceInspection?.layout === 'source_outer') {
    return sourceInspection;
  }
  if (tryParseLegacyGameLogicChunk(data) !== null) {
    return {
      layout: 'legacy',
      version: null,
      frameCounter: null,
      objectTocCount: null,
      objectCount: null,
      firstObjectTemplateName: null,
      firstObjectTocId: null,
      firstObjectVersion: null,
      firstObjectInternalName: null,
      firstObjectTeamId: null,
      firstObjectLayout: null,
      reason: sourceInspection?.reason ?? 'Source GameLogic parse failed.',
    };
  }
  return sourceInspection ?? {
    layout: 'unknown',
    version: null,
    frameCounter: null,
    objectTocCount: null,
    objectCount: null,
    firstObjectTemplateName: null,
    firstObjectTocId: null,
    firstObjectVersion: null,
    firstObjectInternalName: null,
    firstObjectTeamId: null,
    firstObjectLayout: null,
    reason: 'Unable to classify game-logic chunk layout.',
  };
}

interface SourcePlayerUpgradeState {
  name: string;
  status: number;
}

interface SourcePlayerBuildListInfoState {
  buildingName: string;
  templateName: string;
  location: { x: number; y: number; z: number };
  rallyPointOffset: { x: number; y: number };
  angle: number;
  isInitiallyBuilt: boolean;
  numRebuilds: number;
  script: string;
  health: number;
  whiner: boolean;
  unsellable: boolean;
  repairable: boolean;
  automaticallyBuild: boolean;
  objectId: number;
  objectTimestamp: number;
  underConstruction: boolean;
  resourceGatherers: number[];
  isSupplyBuilding: boolean;
  desiredGatherers: number;
  priorityBuild: boolean;
  currentGatherers: number;
}

interface SourcePlayerWorkOrderState {
  templateName: string;
  factoryId: number;
  numCompleted: number;
  numRequired: number;
  required: boolean;
  isResourceGatherer: boolean;
}

interface SourcePlayerTeamInQueueState {
  workOrders: SourcePlayerWorkOrderState[];
  priorityBuild: boolean;
  teamId: number;
  frameStarted: number;
  sentToStartLocation: boolean;
  stopQueueing: boolean;
  reinforcement: boolean;
  reinforcementId: number;
}

interface SourcePlayerAiState {
  isSkirmishAi: boolean;
  teamBuildQueue: SourcePlayerTeamInQueueState[];
  teamReadyQueue: SourcePlayerTeamInQueueState[];
  readyToBuildTeam: boolean;
  readyToBuildStructure: boolean;
  teamTimer: number;
  structureTimer: number;
  buildDelay: number;
  teamDelay: number;
  teamSeconds: number;
  currentWarehouseId: number;
  frameLastBuildingBuilt: number;
  difficulty: number;
  skillsetSelector: number;
  baseCenter: { x: number; y: number; z: number };
  baseCenterSet: boolean;
  baseRadius: number;
  structuresToRepair: number[];
  repairDozer: number;
  structuresInQueue: number;
  dozerQueuedForRepair: boolean;
  dozerIsRepairing: boolean;
  bridgeTimer: number;
  curFrontBaseDefense: number;
  curFlankBaseDefense: number;
  curFrontLeftDefenseAngle: number;
  curFrontRightDefenseAngle: number;
  curLeftFlankLeftDefenseAngle: number;
  curLeftFlankRightDefenseAngle: number;
  curRightFlankLeftDefenseAngle: number;
  curRightFlankRightDefenseAngle: number;
}

interface SourcePlayerResourceGatheringManagerState {
  supplyWarehouses: number[];
  supplyCenters: number[];
}

interface SourcePlayerRelationEntry {
  id: number;
  relationship: number;
}

interface SourcePlayerScoreKeeperState {
  totalMoneyEarned: number;
  totalMoneySpent: number;
  totalUnitsDestroyed: number[];
  totalUnitsBuilt: number;
  totalUnitsLost: number;
  totalBuildingsDestroyed: number[];
  totalBuildingsBuilt: number;
  totalBuildingsLost: number;
  totalTechBuildingsCaptured: number;
  totalFactionBuildingsCaptured: number;
  currentScore: number;
  playerIndex: number;
}

interface SourcePlayerBattlePlanBonusesState {
  armorScalar: number;
  sightRangeScalar: number;
  bombardment: number;
  holdTheLine: number;
  searchAndDestroy: number;
  validKindOf: string[];
  invalidKindOf: string[];
}

interface SourcePlayerKindOfCostModifierState {
  kindOfName: string;
  percent: number;
  refCount: number;
}

interface SourcePlayerEntryState {
  playerIndex: number;
  side: string;
  money: number;
  upgrades: SourcePlayerUpgradeState[];
  isPreorder: boolean;
  sciencesDisabled: string[];
  sciencesHidden: string[];
  radarCount: number;
  isPlayerDead: boolean;
  disableProofRadarCount: number;
  radarDisabled: boolean;
  upgradesInProgress: string[];
  upgradesCompleted: string[];
  powerSabotagedTillFrame: number;
  teamPrototypeIds: number[];
  buildListInfos: SourcePlayerBuildListInfoState[];
  aiPlayer: SourcePlayerAiState | null;
  resourceGatheringManager: SourcePlayerResourceGatheringManagerState | null;
  tunnelTracker: GameLogicTunnelTrackerSaveState | null;
  defaultTeamId: number;
  sciences: string[];
  rankLevel: number;
  skillPoints: number;
  sciencePurchasePoints: number;
  levelUp: number;
  levelDown: number;
  generalName: string;
  playerRelations: SourcePlayerRelationEntry[];
  teamRelations: SourcePlayerRelationEntry[];
  canBuildUnits: boolean;
  canBuildBase: boolean;
  observer: boolean;
  skillPointsModifier: number;
  listInScoreScreen: boolean;
  attackedByPlayerIndices: number[];
  cashBountyPercent: number;
  scoreKeeper: SourcePlayerScoreKeeperState;
  kindOfCostModifiers: SourcePlayerKindOfCostModifierState[];
  specialPowerReadyTimers: Array<{ templateId: number; readyFrame: number }>;
  squads: number[][];
  currentSelection: number[];
  battlePlanBonuses: SourcePlayerBattlePlanBonusesState | null;
  bombardBattlePlans: number;
  holdTheLineBattlePlans: number;
  searchAndDestroyBattlePlans: number;
  unitsShouldHunt: boolean;
}

function normalizeControllingPlayerTokenValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

function resolveSourcePlayersCount(
  payload: GameLogicPlayersSaveState | null,
  mapData: MapDataJSON | null | undefined,
): number {
  const mapCount = mapData?.sidesList?.sides.length ?? 0;
  if (mapCount > 0) {
    return mapCount;
  }
  const state = payload?.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : {};
  const indices = new Set<number>();
  const playerSideByIndex = getPlayerSideByIndexMap(payload);
  for (const playerIndex of playerSideByIndex.keys()) {
    if (Number.isFinite(playerIndex)) {
      indices.add(Math.max(0, Math.trunc(playerIndex)));
    }
  }
  const sidePlayerIndex = getPlayerIndexBySideMap(payload);
  for (const playerIndex of sidePlayerIndex.values()) {
    if (Number.isFinite(playerIndex)) {
      indices.add(Math.max(0, Math.trunc(playerIndex)));
    }
  }
  const localPlayerIndex = Number((state as Record<string, unknown>).localPlayerIndex ?? 0);
  if (Number.isFinite(localPlayerIndex)) {
    indices.add(Math.max(0, Math.trunc(localPlayerIndex)));
  }
  if (indices.size === 0) {
    return 0;
  }
  return Math.max(...indices) + 1;
}

function resolveSourcePlayerSide(
  playerIndex: number,
  payload: GameLogicPlayersSaveState | null,
  mapData: MapDataJSON | null | undefined,
): string {
  const direct = getPlayerSideByIndexMap(payload).get(playerIndex);
  if (direct && direct.trim().length > 0) {
    return direct.trim();
  }
  const sideEntry = mapData?.sidesList?.sides[playerIndex];
  const playerFaction = typeof sideEntry?.dict?.playerFaction === 'string'
    ? sideEntry.dict.playerFaction.trim()
    : '';
  if (playerFaction.length > 0) {
    return playerFaction;
  }
  const playerName = typeof sideEntry?.dict?.playerName === 'string'
    ? sideEntry.dict.playerName.trim()
    : '';
  return playerName;
}

function xferSourceStringBitFlags(
  xfer: Xfer,
  values: string[],
): string[] {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source bitflags snapshot version ${version}`);
  }
  const uniqueValues = [...new Set(values.filter((value) => value.trim().length > 0))];
  const count = xfer.xferInt(uniqueValues.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: string[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const value of uniqueValues) {
    xfer.xferAsciiString(value);
  }
  return uniqueValues;
}

function xferSourceScienceNames(
  xfer: Xfer,
  values: string[],
): string[] {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source science-vector version ${version}`);
  }
  const uniqueValues = [...new Set(values.filter((value) => value.trim().length > 0))];
  const count = xfer.xferUnsignedShort(uniqueValues.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: string[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const value of uniqueValues) {
    xfer.xferAsciiString(value);
  }
  return uniqueValues;
}

function xferSourceObjectIdLinkedList(
  xfer: Xfer,
  objectIds: number[],
): number[] {
  const count = xfer.xferUnsignedShort(objectIds.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: number[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferObjectID(0));
    }
    return loaded;
  }
  for (const objectId of objectIds) {
    xfer.xferObjectID(Math.max(0, Math.trunc(objectId)));
  }
  return objectIds;
}

function xferSourceCoord2D(
  xfer: Xfer,
  coord: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: xfer.xferReal(coord.x),
    y: xfer.xferReal(coord.y),
  };
}

function xferSourceUpgradeState(
  xfer: Xfer,
  upgrade: SourcePlayerUpgradeState,
): SourcePlayerUpgradeState {
  const version = xfer.xferVersion(SOURCE_UPGRADE_SNAPSHOT_VERSION);
  if (version !== SOURCE_UPGRADE_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported source upgrade snapshot version ${version}`);
  }
  return {
    name: upgrade.name,
    status: xfer.xferInt(upgrade.status),
  };
}

function xferSourcePlayerRelationEntries(
  xfer: Xfer,
  entries: SourcePlayerRelationEntry[],
): SourcePlayerRelationEntry[] {
  const version = xfer.xferVersion(SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION);
  if (version !== SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported player relation map snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: SourcePlayerRelationEntry[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        id: xfer.xferInt(0),
        relationship: xfer.xferInt(0),
      });
    }
    return loaded;
  }
  for (const entry of entries) {
    xfer.xferInt(Math.trunc(entry.id));
    xfer.xferInt(Math.trunc(entry.relationship));
  }
  return entries;
}

function xferSourceTeamRelationEntries(
  xfer: Xfer,
  entries: SourcePlayerRelationEntry[],
): SourcePlayerRelationEntry[] {
  const version = xfer.xferVersion(SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION);
  if (version !== SOURCE_PLAYER_RELATION_MAP_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported team relation map snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(entries.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: SourcePlayerRelationEntry[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        id: xfer.xferUnsignedInt(0),
        relationship: xfer.xferInt(0),
      });
    }
    return loaded;
  }
  for (const entry of entries) {
    xfer.xferUnsignedInt(Math.max(0, Math.trunc(entry.id)));
    xfer.xferInt(Math.trunc(entry.relationship));
  }
  return entries;
}

function xferSourceBuildListInfoState(
  xfer: Xfer,
  buildListInfo: SourcePlayerBuildListInfoState,
): SourcePlayerBuildListInfoState {
  const version = xfer.xferVersion(SOURCE_BUILD_LIST_INFO_SNAPSHOT_VERSION);
  if (version !== 1 && version !== SOURCE_BUILD_LIST_INFO_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported build-list snapshot version ${version}`);
  }
  const nextState: SourcePlayerBuildListInfoState = {
    ...buildListInfo,
    buildingName: xfer.xferAsciiString(buildListInfo.buildingName),
    templateName: xfer.xferAsciiString(buildListInfo.templateName),
    location: xfer.xferCoord3D(buildListInfo.location),
    rallyPointOffset: xferSourceCoord2D(xfer, buildListInfo.rallyPointOffset),
    angle: xfer.xferReal(buildListInfo.angle),
    isInitiallyBuilt: xfer.xferBool(buildListInfo.isInitiallyBuilt),
    numRebuilds: xfer.xferUnsignedInt(buildListInfo.numRebuilds),
    script: xfer.xferAsciiString(buildListInfo.script),
    health: xfer.xferInt(buildListInfo.health),
    whiner: xfer.xferBool(buildListInfo.whiner),
    unsellable: xfer.xferBool(buildListInfo.unsellable),
    repairable: xfer.xferBool(buildListInfo.repairable),
    automaticallyBuild: xfer.xferBool(buildListInfo.automaticallyBuild),
    objectId: xfer.xferObjectID(buildListInfo.objectId),
    objectTimestamp: xfer.xferUnsignedInt(buildListInfo.objectTimestamp),
    underConstruction: xfer.xferBool(buildListInfo.underConstruction),
    resourceGatherers: xfer.xferObjectIDList(buildListInfo.resourceGatherers),
    isSupplyBuilding: xfer.xferBool(buildListInfo.isSupplyBuilding),
    desiredGatherers: xfer.xferInt(buildListInfo.desiredGatherers),
    priorityBuild: xfer.xferBool(buildListInfo.priorityBuild),
    currentGatherers: version >= 2
      ? xfer.xferInt(buildListInfo.currentGatherers)
      : buildListInfo.currentGatherers,
  };
  return nextState;
}

function xferSourceWorkOrderState(
  xfer: Xfer,
  workOrder: SourcePlayerWorkOrderState,
): SourcePlayerWorkOrderState {
  const version = xfer.xferVersion(SOURCE_WORK_ORDER_SNAPSHOT_VERSION);
  if (version !== SOURCE_WORK_ORDER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported work-order snapshot version ${version}`);
  }
  return {
    templateName: xfer.xferAsciiString(workOrder.templateName),
    factoryId: xfer.xferObjectID(workOrder.factoryId),
    numCompleted: xfer.xferInt(workOrder.numCompleted),
    numRequired: xfer.xferInt(workOrder.numRequired),
    required: xfer.xferBool(workOrder.required),
    isResourceGatherer: xfer.xferBool(workOrder.isResourceGatherer),
  };
}

function xferSourceTeamInQueueState(
  xfer: Xfer,
  teamInQueue: SourcePlayerTeamInQueueState,
): SourcePlayerTeamInQueueState {
  const version = xfer.xferVersion(SOURCE_TEAM_IN_QUEUE_SNAPSHOT_VERSION);
  if (version !== SOURCE_TEAM_IN_QUEUE_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported team-in-queue snapshot version ${version}`);
  }
  const workOrderCount = xfer.xferUnsignedShort(teamInQueue.workOrders.length);
  const workOrders: SourcePlayerWorkOrderState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < workOrderCount; index += 1) {
      workOrders.push(xferSourceWorkOrderState(xfer, {
        templateName: '',
        factoryId: 0,
        numCompleted: 0,
        numRequired: 0,
        required: false,
        isResourceGatherer: false,
      }));
    }
  } else {
    for (const workOrder of teamInQueue.workOrders) {
      workOrders.push(xferSourceWorkOrderState(xfer, workOrder));
    }
  }
  return {
    workOrders,
    priorityBuild: xfer.xferBool(teamInQueue.priorityBuild),
    teamId: xfer.xferUnsignedInt(teamInQueue.teamId),
    frameStarted: xfer.xferInt(teamInQueue.frameStarted),
    sentToStartLocation: xfer.xferBool(teamInQueue.sentToStartLocation),
    stopQueueing: xfer.xferBool(teamInQueue.stopQueueing),
    reinforcement: xfer.xferBool(teamInQueue.reinforcement),
    reinforcementId: xfer.xferObjectID(teamInQueue.reinforcementId),
  };
}

function xferSourceAiPlayerState(
  xfer: Xfer,
  aiPlayer: SourcePlayerAiState,
  playerIndex: number,
): SourcePlayerAiState {
  const version = xfer.xferVersion(
    aiPlayer.isSkirmishAi
      ? SOURCE_AI_SKIRMISH_PLAYER_SNAPSHOT_VERSION
      : SOURCE_AI_PLAYER_SNAPSHOT_VERSION,
  );
  if (version !== 1) {
    throw new Error(`Unsupported AI player snapshot version ${version}`);
  }
  const teamBuildQueueCount = xfer.xferUnsignedShort(aiPlayer.teamBuildQueue.length);
  const teamBuildQueue: SourcePlayerTeamInQueueState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < teamBuildQueueCount; index += 1) {
      teamBuildQueue.push(xferSourceTeamInQueueState(xfer, {
        workOrders: [],
        priorityBuild: false,
        teamId: 0,
        frameStarted: 0,
        sentToStartLocation: false,
        stopQueueing: false,
        reinforcement: false,
        reinforcementId: 0,
      }));
    }
  } else {
    for (const teamInQueue of aiPlayer.teamBuildQueue) {
      teamBuildQueue.push(xferSourceTeamInQueueState(xfer, teamInQueue));
    }
  }
  const teamReadyQueueCount = xfer.xferUnsignedShort(aiPlayer.teamReadyQueue.length);
  const teamReadyQueue: SourcePlayerTeamInQueueState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < teamReadyQueueCount; index += 1) {
      teamReadyQueue.push(xferSourceTeamInQueueState(xfer, {
        workOrders: [],
        priorityBuild: false,
        teamId: 0,
        frameStarted: 0,
        sentToStartLocation: false,
        stopQueueing: false,
        reinforcement: false,
        reinforcementId: 0,
      }));
    }
  } else {
    for (const teamInQueue of aiPlayer.teamReadyQueue) {
      teamReadyQueue.push(xferSourceTeamInQueueState(xfer, teamInQueue));
    }
  }
  const savedPlayerIndex = xfer.xferInt(playerIndex);
  if (savedPlayerIndex !== playerIndex) {
    throw new Error(`AI player index mismatch: expected ${playerIndex}, got ${savedPlayerIndex}`);
  }
  const nextState: SourcePlayerAiState = {
    ...aiPlayer,
    teamBuildQueue,
    teamReadyQueue,
    readyToBuildTeam: xfer.xferBool(aiPlayer.readyToBuildTeam),
    readyToBuildStructure: xfer.xferBool(aiPlayer.readyToBuildStructure),
    teamTimer: xfer.xferInt(aiPlayer.teamTimer),
    structureTimer: xfer.xferInt(aiPlayer.structureTimer),
    buildDelay: xfer.xferInt(aiPlayer.buildDelay),
    teamDelay: xfer.xferInt(aiPlayer.teamDelay),
    teamSeconds: xfer.xferInt(aiPlayer.teamSeconds),
    currentWarehouseId: xfer.xferObjectID(aiPlayer.currentWarehouseId),
    frameLastBuildingBuilt: xfer.xferInt(aiPlayer.frameLastBuildingBuilt),
    difficulty: xfer.xferInt(aiPlayer.difficulty),
    skillsetSelector: xfer.xferInt(aiPlayer.skillsetSelector),
    baseCenter: xfer.xferCoord3D(aiPlayer.baseCenter),
    baseCenterSet: xfer.xferBool(aiPlayer.baseCenterSet),
    baseRadius: xfer.xferReal(aiPlayer.baseRadius),
    structuresToRepair: xfer.xferObjectIDList(aiPlayer.structuresToRepair),
    repairDozer: xfer.xferObjectID(aiPlayer.repairDozer),
    structuresInQueue: xfer.xferInt(aiPlayer.structuresInQueue),
    dozerQueuedForRepair: xfer.xferBool(aiPlayer.dozerQueuedForRepair),
    dozerIsRepairing: xfer.xferBool(aiPlayer.dozerIsRepairing),
    bridgeTimer: xfer.xferInt(aiPlayer.bridgeTimer),
    curFrontBaseDefense: aiPlayer.curFrontBaseDefense,
    curFlankBaseDefense: aiPlayer.curFlankBaseDefense,
    curFrontLeftDefenseAngle: aiPlayer.curFrontLeftDefenseAngle,
    curFrontRightDefenseAngle: aiPlayer.curFrontRightDefenseAngle,
    curLeftFlankLeftDefenseAngle: aiPlayer.curLeftFlankLeftDefenseAngle,
    curLeftFlankRightDefenseAngle: aiPlayer.curLeftFlankRightDefenseAngle,
    curRightFlankLeftDefenseAngle: aiPlayer.curRightFlankLeftDefenseAngle,
    curRightFlankRightDefenseAngle: aiPlayer.curRightFlankRightDefenseAngle,
  };
  if (aiPlayer.isSkirmishAi) {
    nextState.curFrontBaseDefense = xfer.xferInt(aiPlayer.curFrontBaseDefense);
    nextState.curFlankBaseDefense = xfer.xferInt(aiPlayer.curFlankBaseDefense);
    nextState.curFrontLeftDefenseAngle = xfer.xferReal(aiPlayer.curFrontLeftDefenseAngle);
    nextState.curFrontRightDefenseAngle = xfer.xferReal(aiPlayer.curFrontRightDefenseAngle);
    nextState.curLeftFlankLeftDefenseAngle = xfer.xferReal(aiPlayer.curLeftFlankLeftDefenseAngle);
    nextState.curLeftFlankRightDefenseAngle = xfer.xferReal(aiPlayer.curLeftFlankRightDefenseAngle);
    nextState.curRightFlankLeftDefenseAngle = xfer.xferReal(aiPlayer.curRightFlankLeftDefenseAngle);
    nextState.curRightFlankRightDefenseAngle = xfer.xferReal(aiPlayer.curRightFlankRightDefenseAngle);
  }
  return nextState;
}

function xferSourceResourceGatheringManagerState(
  xfer: Xfer,
  resourceGatheringManager: SourcePlayerResourceGatheringManagerState,
): SourcePlayerResourceGatheringManagerState {
  const version = xfer.xferVersion(SOURCE_RESOURCE_GATHERING_MANAGER_SNAPSHOT_VERSION);
  if (version !== SOURCE_RESOURCE_GATHERING_MANAGER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported resource-gathering snapshot version ${version}`);
  }
  return {
    supplyWarehouses: xferSourceObjectIdLinkedList(xfer, resourceGatheringManager.supplyWarehouses),
    supplyCenters: xferSourceObjectIdLinkedList(xfer, resourceGatheringManager.supplyCenters),
  };
}

function xferSourcePlayerTunnelTrackerSnapshot(
  xfer: Xfer,
  tunnelTracker: GameLogicTunnelTrackerSaveState,
): GameLogicTunnelTrackerSaveState {
  const version = xfer.xferVersion(SOURCE_TUNNEL_TRACKER_SNAPSHOT_VERSION);
  if (version !== SOURCE_TUNNEL_TRACKER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported tunnel-tracker snapshot version ${version}`);
  }
  const tunnelIds = xferSourceObjectIdLinkedList(xfer, tunnelTracker.tunnelIds);
  const passengerCount = xfer.xferInt(tunnelTracker.passengerIds.length);
  const passengerIds: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < passengerCount; index += 1) {
      passengerIds.push(xfer.xferObjectID(0));
    }
  } else {
    for (const passengerId of tunnelTracker.passengerIds) {
      passengerIds.push(xfer.xferObjectID(passengerId));
    }
  }
  return {
    tunnelIds,
    passengerIds,
    tunnelCount: xfer.xferUnsignedInt(tunnelTracker.tunnelCount),
  };
}

function xferSourceScoreObjectCountMap(
  xfer: Xfer,
  objectCounts: Array<{ templateName: string; count: number }>,
): Array<{ templateName: string; count: number }> {
  const count = xfer.xferUnsignedShort(objectCounts.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: Array<{ templateName: string; count: number }> = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        templateName: xfer.xferAsciiString(''),
        count: xfer.xferInt(0),
      });
    }
    return loaded;
  }
  for (const objectCount of objectCounts) {
    xfer.xferAsciiString(objectCount.templateName);
    xfer.xferInt(objectCount.count);
  }
  return objectCounts;
}

function xferSourceScoreKeeperState(
  xfer: Xfer,
  scoreKeeper: SourcePlayerScoreKeeperState,
): SourcePlayerScoreKeeperState {
  const version = xfer.xferVersion(SOURCE_SCORE_KEEPER_SNAPSHOT_VERSION);
  if (version !== SOURCE_SCORE_KEEPER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported score-keeper snapshot version ${version}`);
  }
  const totalUnitsDestroyed = [...scoreKeeper.totalUnitsDestroyed];
  while (totalUnitsDestroyed.length < SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
    totalUnitsDestroyed.push(0);
  }
  const totalBuildingsDestroyed = [...scoreKeeper.totalBuildingsDestroyed];
  while (totalBuildingsDestroyed.length < SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
    totalBuildingsDestroyed.push(0);
  }
  const nextState: SourcePlayerScoreKeeperState = {
    ...scoreKeeper,
    totalMoneyEarned: xfer.xferInt(scoreKeeper.totalMoneyEarned),
    totalMoneySpent: xfer.xferInt(scoreKeeper.totalMoneySpent),
    totalUnitsDestroyed: totalUnitsDestroyed.map((value) => xfer.xferInt(value)),
    totalUnitsBuilt: xfer.xferInt(scoreKeeper.totalUnitsBuilt),
    totalUnitsLost: xfer.xferInt(scoreKeeper.totalUnitsLost),
    totalBuildingsDestroyed: totalBuildingsDestroyed.map((value) => xfer.xferInt(value)),
    totalBuildingsBuilt: xfer.xferInt(scoreKeeper.totalBuildingsBuilt),
    totalBuildingsLost: xfer.xferInt(scoreKeeper.totalBuildingsLost),
    totalTechBuildingsCaptured: xfer.xferInt(scoreKeeper.totalTechBuildingsCaptured),
    totalFactionBuildingsCaptured: xfer.xferInt(scoreKeeper.totalFactionBuildingsCaptured),
    currentScore: xfer.xferInt(scoreKeeper.currentScore),
    playerIndex: xfer.xferInt(scoreKeeper.playerIndex),
  };
  void xferSourceScoreObjectCountMap(xfer, []);
  const destroyedArraySize = xfer.xferUnsignedShort(SOURCE_SCRIPT_ENGINE_PLAYER_COUNT);
  if (destroyedArraySize !== SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
    throw new Error(`Unexpected score destroyed-array size ${destroyedArraySize}`);
  }
  for (let index = 0; index < destroyedArraySize; index += 1) {
    void xferSourceScoreObjectCountMap(xfer, []);
  }
  void xferSourceScoreObjectCountMap(xfer, []);
  void xferSourceScoreObjectCountMap(xfer, []);
  return nextState;
}

function xferSourceKindOfNames(
  xfer: Xfer,
  kindOfNames: string[],
): string[] {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported kindOf-name snapshot version ${version}`);
  }
  const uniqueNames = [...new Set(kindOfNames.filter((value) => value.trim().length > 0))];
  const count = xfer.xferInt(uniqueNames.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: string[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferAsciiString(''));
    }
    return loaded;
  }
  for (const kindOfName of uniqueNames) {
    xfer.xferAsciiString(kindOfName);
  }
  return uniqueNames;
}

function xferSourceKindOfCostModifiers(
  xfer: Xfer,
  modifiers: SourcePlayerKindOfCostModifierState[],
): SourcePlayerKindOfCostModifierState[] {
  const count = xfer.xferUnsignedShort(modifiers.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: SourcePlayerKindOfCostModifierState[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        kindOfName: xferSourceKindOfNames(xfer, [])[0] ?? '',
        percent: xfer.xferReal(0),
        refCount: xfer.xferUnsignedInt(0),
      });
    }
    return loaded;
  }
  for (const modifier of modifiers) {
    xferSourceKindOfNames(xfer, [modifier.kindOfName]);
    xfer.xferReal(modifier.percent);
    xfer.xferUnsignedInt(modifier.refCount);
  }
  return modifiers;
}

function xferSourceSquadObjectIds(
  xfer: Xfer,
  objectIds: number[],
): number[] {
  const version = xfer.xferVersion(SOURCE_SQUAD_SNAPSHOT_VERSION);
  if (version !== SOURCE_SQUAD_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported squad snapshot version ${version}`);
  }
  const count = xfer.xferUnsignedShort(objectIds.length);
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    const loaded: number[] = [];
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferObjectID(0));
    }
    return loaded;
  }
  for (const objectId of objectIds) {
    xfer.xferObjectID(objectId);
  }
  return objectIds;
}

function xferSourceBattlePlanBonusesState(
  xfer: Xfer,
  bonuses: SourcePlayerBattlePlanBonusesState,
): SourcePlayerBattlePlanBonusesState {
  return {
    armorScalar: xfer.xferReal(bonuses.armorScalar),
    sightRangeScalar: xfer.xferReal(bonuses.sightRangeScalar),
    bombardment: xfer.xferInt(bonuses.bombardment),
    holdTheLine: xfer.xferInt(bonuses.holdTheLine),
    searchAndDestroy: xfer.xferInt(bonuses.searchAndDestroy),
    validKindOf: xferSourceKindOfNames(xfer, bonuses.validKindOf),
    invalidKindOf: xferSourceKindOfNames(xfer, bonuses.invalidKindOf),
  };
}

function buildDefaultSourceAiPlayerState(
  side: string,
  payload: GameLogicPlayersSaveState | null,
): SourcePlayerAiState {
  const state = payload?.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : {};
  const skillset = getRuntimeStateMap<number>(state, 'sideScriptSkillset').get(side) ?? 0;
  const currentWarehouseId = getRuntimeStateMap<number>(state, 'scriptCurrentSupplyWarehouseBySide').get(side) ?? 0;
  const skirmishCenterAndRadius = getRuntimeStateMap<{
    centerX?: unknown;
    centerZ?: unknown;
    radius?: unknown;
  }>(state, 'scriptSkirmishBaseCenterAndRadiusBySide').get(side);
  const skirmishDefenseState = getRuntimeStateMap<Record<string, unknown>>(state, 'scriptSkirmishBaseDefenseStateBySide').get(side);
  const isSkirmishAi = getRuntimeStateMap<unknown>(state, 'skirmishAIStates').has(side);
  return {
    isSkirmishAi,
    teamBuildQueue: [],
    teamReadyQueue: [],
    readyToBuildTeam: false,
    readyToBuildStructure: false,
    teamTimer: 0,
    structureTimer: 0,
    buildDelay: 0,
    teamDelay: 0,
    teamSeconds: Math.max(0, Math.trunc(getRuntimeStateMap<number>(state, 'sideTeamBuildDelaySecondsByScript').get(side) ?? 0)),
    currentWarehouseId: Math.max(0, Math.trunc(currentWarehouseId)),
    frameLastBuildingBuilt: 0,
    difficulty: SOURCE_DIFFICULTY_NORMAL,
    skillsetSelector: Number.isFinite(skillset) ? Math.trunc(skillset) : 0,
    baseCenter: {
      x: Number(skirmishCenterAndRadius?.centerX ?? 0),
      y: 0,
      z: Number(skirmishCenterAndRadius?.centerZ ?? 0),
    },
    baseCenterSet: Number.isFinite(skirmishCenterAndRadius?.centerX) && Number.isFinite(skirmishCenterAndRadius?.centerZ),
    baseRadius: Number(skirmishCenterAndRadius?.radius ?? 0),
    structuresToRepair: [],
    repairDozer: 0,
    structuresInQueue: 0,
    dozerQueuedForRepair: false,
    dozerIsRepairing: false,
    bridgeTimer: 0,
    curFrontBaseDefense: Number(skirmishDefenseState?.curFrontBaseDefense ?? 0),
    curFlankBaseDefense: Number(skirmishDefenseState?.curFlankBaseDefense ?? 0),
    curFrontLeftDefenseAngle: Number(skirmishDefenseState?.curFrontLeftDefenseAngle ?? 0),
    curFrontRightDefenseAngle: Number(skirmishDefenseState?.curFrontRightDefenseAngle ?? 0),
    curLeftFlankLeftDefenseAngle: Number(skirmishDefenseState?.curLeftFlankLeftDefenseAngle ?? 0),
    curLeftFlankRightDefenseAngle: Number(skirmishDefenseState?.curLeftFlankRightDefenseAngle ?? 0),
    curRightFlankLeftDefenseAngle: Number(skirmishDefenseState?.curRightFlankLeftDefenseAngle ?? 0),
    curRightFlankRightDefenseAngle: Number(skirmishDefenseState?.curRightFlankRightDefenseAngle ?? 0),
  };
}

function buildSourcePlayerBuildListInfos(
  playerIndex: number,
  side: string,
  payload: GameLogicPlayersSaveState | null,
  mapData: MapDataJSON | null | undefined,
): SourcePlayerBuildListInfoState[] {
  const mapSide = mapData?.sidesList?.sides[playerIndex];
  if (mapSide?.buildList && mapSide.buildList.length > 0) {
    return mapSide.buildList.map((entry) => ({
      buildingName: entry.buildingName ?? '',
      templateName: entry.templateName ?? '',
      location: {
        x: entry.location.x,
        y: entry.location.y,
        z: entry.location.z,
      },
      rallyPointOffset: { x: 0, y: 0 },
      angle: entry.angle ?? 0,
      isInitiallyBuilt: entry.initiallyBuilt ?? false,
      numRebuilds: entry.numRebuilds ?? 0,
      script: entry.script ?? '',
      health: entry.health ?? 100,
      whiner: entry.whiner ?? false,
      unsellable: entry.unsellable ?? false,
      repairable: entry.repairable ?? true,
      automaticallyBuild: true,
      objectId: 0,
      objectTimestamp: 0,
      underConstruction: false,
      resourceGatherers: [],
      isSupplyBuilding: false,
      desiredGatherers: 0,
      priorityBuild: false,
      currentGatherers: 0,
    }));
  }
  const state = payload?.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : {};
  const runtimeEntries = getRuntimeStateMap<Array<{ templateNameUpper?: unknown; locationX?: unknown; locationZ?: unknown }>>(
    state,
    'scriptAiBuildListEntriesBySide',
  ).get(side);
  if (!Array.isArray(runtimeEntries)) {
    return [];
  }
  return runtimeEntries.flatMap((entry, index) => {
    const templateName = normalizeOptionalAsciiString(entry.templateNameUpper);
    const locationX = Number(entry.locationX);
    const locationZ = Number(entry.locationZ);
    if (!templateName || !Number.isFinite(locationX) || !Number.isFinite(locationZ)) {
      return [];
    }
    return [{
      buildingName: `${side}_BUILD_${index}`,
      templateName,
      location: { x: locationX, y: 0, z: locationZ },
      rallyPointOffset: { x: 0, y: 0 },
      angle: 0,
      isInitiallyBuilt: false,
      numRebuilds: 0,
      script: '',
      health: 100,
      whiner: false,
      unsellable: false,
      repairable: true,
      automaticallyBuild: true,
      objectId: 0,
      objectTimestamp: 0,
      underConstruction: false,
      resourceGatherers: [],
      isSupplyBuilding: false,
      desiredGatherers: 0,
      priorityBuild: false,
      currentGatherers: 0,
    }];
  });
}

function buildSourcePlayerEntryState(
  playerIndex: number,
  payload: GameLogicPlayersSaveState | null,
  options: {
    mapData?: MapDataJSON | null;
    teamFactoryState?: GameLogicTeamFactorySaveState | null;
    sidesListState?: GameLogicSidesListSaveState | null;
  } = {},
): SourcePlayerEntryState {
  const state = payload?.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : {};
  const side = resolveSourcePlayerSide(playerIndex, payload, options.mapData);
  const sideCredits = getRuntimeStateMap<number>(state, 'sideCredits');
  const sidePlayerTypes = getRuntimeStateMap<string>(state, 'sidePlayerTypes');
  const sideRadarState = getRuntimeStateMap<Record<string, unknown>>(state, 'sideRadarState').get(side);
  const sideRankState = getRuntimeStateMap<Record<string, unknown>>(state, 'sideRankState').get(side);
  const sideScoreState = getRuntimeStateMap<Record<string, unknown>>(state, 'sideScoreState').get(side);
  const sideScienceAvailability = getRuntimeStateMap<Map<string, string>>(state, 'sideScienceAvailability').get(side);
  const sideSciencesBySide = getRuntimeStateMap<Set<string>>(state, 'sideSciences').get(side);
  const sideCompletedUpgrades = getRuntimeStateMap<Set<string>>(state, 'sideCompletedUpgrades').get(side);
  const sideUpgradesInProduction = getRuntimeStateMap<Set<string>>(state, 'sideUpgradesInProduction').get(side);
  const sideCashBountyPercent = getRuntimeStateMap<number>(state, 'sideCashBountyPercent').get(side);
  const sideSkillPointsModifier = getRuntimeStateMap<number>(state, 'sideSkillPointsModifier').get(side);
  const sideBattlePlanBonuses = getRuntimeStateMap<Record<string, unknown>>(state, 'sideBattlePlanBonuses').get(side);
  const sideScoreScreenExcluded = state.sideScoreScreenExcluded instanceof Set
    ? state.sideScoreScreenExcluded as Set<string>
    : new Set<string>();
  const sideIsPreorder = getRuntimeStateMap<boolean>(state, 'sideIsPreorder').get(side);
  const sideCanBuildBaseByScript = getRuntimeStateMap<boolean>(state, 'sideCanBuildBaseByScript').get(side);
  const sideCanBuildUnitsByScript = getRuntimeStateMap<boolean>(state, 'sideCanBuildUnitsByScript').get(side);
  const teamRelationshipOverrides = getRuntimeStateMap<number>(state, 'teamRelationshipOverrides');
  const playerRelationshipOverrides = getRuntimeStateMap<number>(state, 'playerRelationshipOverrides');
  const relationSeparator = '\u0000';
  const defaultTeamNameBySide = getRuntimeStateMap<string>(state, 'scriptDefaultTeamNameBySide');
  const teamsByName = options.teamFactoryState?.state.scriptTeamsByName instanceof Map
    ? options.teamFactoryState.state.scriptTeamsByName as Map<string, Record<string, unknown>>
    : new Map<string, Record<string, unknown>>();
  const defaultTeamName = defaultTeamNameBySide.get(side)?.trim().toUpperCase() ?? '';
  const defaultTeam = defaultTeamName ? teamsByName.get(defaultTeamName) : undefined;
  const teamPrototypeIds = [...teamsByName.values()].flatMap((team) => {
    const controllingSide = normalizeOptionalAsciiString(team.controllingSide);
    const prototypeId = Number(team.sourcePrototypeId);
    return controllingSide === side && Number.isFinite(prototypeId)
      ? [Math.max(0, Math.trunc(prototypeId))]
      : [];
  });
  const playerRelations: SourcePlayerRelationEntry[] = [];
  const teamRelations: SourcePlayerRelationEntry[] = [];
  for (const [key, relationship] of playerRelationshipOverrides) {
    if (typeof key !== 'string' || !Number.isFinite(relationship)) {
      continue;
    }
    const [sourceSide, targetSide] = key.split(relationSeparator);
    if (sourceSide !== side || !targetSide) {
      continue;
    }
    const targetPlayerIndex = getPlayerIndexBySideMap(payload).get(targetSide);
    if (targetPlayerIndex === undefined || !Number.isFinite(targetPlayerIndex)) {
      continue;
    }
    playerRelations.push({
      id: Math.trunc(targetPlayerIndex),
      relationship: Math.trunc(relationship),
    });
  }
  for (const [key, relationship] of teamRelationshipOverrides) {
    if (typeof key !== 'string' || !Number.isFinite(relationship)) {
      continue;
    }
    const [sourceSide, targetSide] = key.split(relationSeparator);
    if (sourceSide !== side || !targetSide) {
      continue;
    }
    const targetDefaultTeamName = defaultTeamNameBySide.get(targetSide)?.trim().toUpperCase() ?? '';
    const targetDefaultTeam = targetDefaultTeamName ? teamsByName.get(targetDefaultTeamName) : undefined;
    const teamId = Number(targetDefaultTeam?.sourceTeamId);
    if (!Number.isFinite(teamId)) {
      continue;
    }
    teamRelations.push({
      id: Math.max(0, Math.trunc(teamId)),
      relationship: Math.trunc(relationship),
    });
  }
  const sciencesDisabled: string[] = [];
  const sciencesHidden: string[] = [];
  if (sideScienceAvailability instanceof Map) {
    for (const [scienceName, availability] of sideScienceAvailability.entries()) {
      if (availability === 'disabled') {
        sciencesDisabled.push(scienceName);
      } else if (availability === 'hidden') {
        sciencesHidden.push(scienceName);
      }
    }
  }
  const upgrades: SourcePlayerUpgradeState[] = [
    ...[...(sideUpgradesInProduction ?? new Set<string>())].map((name) => ({ name, status: 1 })),
    ...[...(sideCompletedUpgrades ?? new Set<string>())]
      .filter((name) => !(sideUpgradesInProduction?.has(name) ?? false))
      .map((name) => ({ name, status: 2 })),
  ];
  const kindOfCostModifiers = getRuntimeStateMap<Array<Record<string, unknown>>>(state, 'sideKindOfProductionCostModifiers').get(side);
  const expandedKindOfCostModifiers: SourcePlayerKindOfCostModifierState[] = Array.isArray(kindOfCostModifiers)
    ? kindOfCostModifiers.flatMap((modifier) => {
      const kindOfSet = modifier.kindOf instanceof Set ? [...modifier.kindOf.values()] : [];
      const percent = Number(modifier.multiplier);
      const refCount = Number(modifier.refCount);
      return kindOfSet.flatMap((kindOfName) =>
        typeof kindOfName === 'string' && Number.isFinite(percent) && Number.isFinite(refCount)
          ? [{
            kindOfName,
            percent,
            refCount: Math.max(0, Math.trunc(refCount)),
          }]
          : []);
    })
    : [];
  const tunnelTracker = (payload?.tunnelTrackers ?? []).find((tracker) => tracker.side === side)?.tracker ?? null;
  const aiPlayer = sidePlayerTypes.get(side) === 'COMPUTER'
    ? buildDefaultSourceAiPlayerState(side, payload)
    : null;
  return {
    playerIndex,
    side,
    money: Math.max(0, Math.trunc(sideCredits.get(side) ?? 0)),
    upgrades,
    isPreorder: Boolean(sideIsPreorder),
    sciencesDisabled,
    sciencesHidden,
    radarCount: Math.max(0, Math.trunc(Number(sideRadarState?.radarCount ?? 0))),
    isPlayerDead: false,
    disableProofRadarCount: Math.max(0, Math.trunc(Number(sideRadarState?.disableProofRadarCount ?? 0))),
    radarDisabled: Boolean(sideRadarState?.radarDisabled),
    upgradesInProgress: [...(sideUpgradesInProduction ?? new Set<string>())],
    upgradesCompleted: [...(sideCompletedUpgrades ?? new Set<string>())],
    powerSabotagedTillFrame: 0,
    teamPrototypeIds: [...new Set(teamPrototypeIds)].sort((a, b) => a - b),
    buildListInfos: buildSourcePlayerBuildListInfos(playerIndex, side, payload, options.mapData),
    aiPlayer,
    resourceGatheringManager: {
      supplyWarehouses: aiPlayer?.currentWarehouseId ? [aiPlayer.currentWarehouseId] : [],
      supplyCenters: [],
    },
    tunnelTracker,
    defaultTeamId: Number.isFinite(defaultTeam?.sourceTeamId)
      ? Math.max(0, Math.trunc(Number(defaultTeam?.sourceTeamId)))
      : 0,
    sciences: [...(sideSciencesBySide ?? new Set<string>())],
    rankLevel: Math.max(0, Math.trunc(Number(sideRankState?.rankLevel ?? 0))),
    skillPoints: Math.max(0, Math.trunc(Number(sideRankState?.skillPoints ?? 0))),
    sciencePurchasePoints: Math.max(0, Math.trunc(Number(sideRankState?.sciencePurchasePoints ?? 0))),
    levelUp: 0,
    levelDown: 0,
    generalName: '',
    playerRelations,
    teamRelations,
    canBuildUnits: sideCanBuildUnitsByScript !== false,
    canBuildBase: sideCanBuildBaseByScript !== false,
    observer: false,
    skillPointsModifier: Number.isFinite(sideSkillPointsModifier) ? Number(sideSkillPointsModifier) : 1,
    listInScoreScreen: !sideScoreScreenExcluded.has(side),
    attackedByPlayerIndices: [],
    cashBountyPercent: Number.isFinite(sideCashBountyPercent) ? Number(sideCashBountyPercent) : 0,
    scoreKeeper: {
      totalMoneyEarned: Math.max(0, Math.trunc(Number(sideScoreState?.moneyEarned ?? 0))),
      totalMoneySpent: Math.max(0, Math.trunc(Number(sideScoreState?.moneySpent ?? 0))),
      totalUnitsDestroyed: Array.from({ length: SOURCE_SCRIPT_ENGINE_PLAYER_COUNT }, () => 0),
      totalUnitsBuilt: Math.max(0, Math.trunc(Number(sideScoreState?.unitsBuilt ?? 0))),
      totalUnitsLost: Math.max(0, Math.trunc(Number(sideScoreState?.unitsLost ?? 0))),
      totalBuildingsDestroyed: Array.from({ length: SOURCE_SCRIPT_ENGINE_PLAYER_COUNT }, () => 0),
      totalBuildingsBuilt: Math.max(0, Math.trunc(Number(sideScoreState?.structuresBuilt ?? 0))),
      totalBuildingsLost: Math.max(0, Math.trunc(Number(sideScoreState?.structuresLost ?? 0))),
      totalTechBuildingsCaptured: 0,
      totalFactionBuildingsCaptured: 0,
      currentScore: 0,
      playerIndex,
    },
    kindOfCostModifiers: expandedKindOfCostModifiers,
    specialPowerReadyTimers: [],
    squads: Array.from({ length: SOURCE_PLAYER_HOTKEY_SQUAD_COUNT }, () => [] as number[]),
    currentSelection: [],
    battlePlanBonuses: sideBattlePlanBonuses
      ? {
        armorScalar: 1,
        sightRangeScalar: 1,
        bombardment: Math.max(0, Math.trunc(Number(sideBattlePlanBonuses.bombardmentCount ?? 0))),
        holdTheLine: Math.max(0, Math.trunc(Number(sideBattlePlanBonuses.holdTheLineCount ?? 0))),
        searchAndDestroy: Math.max(0, Math.trunc(Number(sideBattlePlanBonuses.searchAndDestroyCount ?? 0))),
        validKindOf: [],
        invalidKindOf: [],
      }
      : null,
    bombardBattlePlans: Math.max(0, Math.trunc(Number(sideBattlePlanBonuses?.bombardmentCount ?? 0))),
    holdTheLineBattlePlans: Math.max(0, Math.trunc(Number(sideBattlePlanBonuses?.holdTheLineCount ?? 0))),
    searchAndDestroyBattlePlans: Math.max(0, Math.trunc(Number(sideBattlePlanBonuses?.searchAndDestroyCount ?? 0))),
    unitsShouldHunt: false,
  };
}

function buildGameLogicPlayersStateFromSourcePlayers(
  players: SourcePlayerEntryState[],
  mapData: MapDataJSON | null | undefined,
): GameLogicPlayersSaveState {
  const state: Record<string, unknown> = {};
  const playerSideByIndex = new Map<number, string>();
  const sidePlayerIndex = new Map<string, number>();
  const sideCredits = new Map<string, number>();
  const sidePlayerTypes = new Map<string, 'HUMAN' | 'COMPUTER'>();
  const sideScienceAvailability = new Map<string, Map<string, 'enabled' | 'disabled' | 'hidden'>>();
  const sideSciences = new Map<string, Set<string>>();
  const sideRadarState = new Map<string, { radarCount: number; disableProofRadarCount: number; radarDisabled: boolean }>();
  const sideRankState = new Map<string, { rankLevel: number; skillPoints: number; sciencePurchasePoints: number }>();
  const sideScoreState = new Map<string, {
    structuresBuilt: number;
    structuresLost: number;
    structuresDestroyed: number;
    unitsBuilt: number;
    unitsLost: number;
    unitsDestroyed: number;
    moneySpent: number;
    moneyEarned: number;
  }>();
  const sideCompletedUpgrades = new Map<string, Set<string>>();
  const sideUpgradesInProduction = new Map<string, Set<string>>();
  const sideIsPreorder = new Map<string, boolean>();
  const sideCanBuildBaseByScript = new Map<string, boolean>();
  const sideCanBuildUnitsByScript = new Map<string, boolean>();
  const sideSkillPointsModifier = new Map<string, number>();
  const sideCashBountyPercent = new Map<string, number>();
  const sideBattlePlanBonuses = new Map<string, {
    bombardmentCount: number;
    holdTheLineCount: number;
    searchAndDestroyCount: number;
  }>();
  const playerRelationshipOverrides = new Map<string, number>();
  const teamRelationshipOverrides = new Map<string, number>();
  const scriptAiBuildListEntriesBySide = new Map<string, Array<{ templateNameUpper: string; locationX: number; locationZ: number }>>();
  const sideScoreScreenExcluded = new Set<string>();
  const sideScriptSkillset = new Map<string, number>();
  const scriptCurrentSupplyWarehouseBySide = new Map<string, number>();
  const scriptSkirmishBaseCenterAndRadiusBySide = new Map<string, { centerX: number; centerZ: number; radius: number }>();
  const scriptSkirmishBaseDefenseStateBySide = new Map<string, Record<string, number>>();
  const sideTeamBuildDelaySecondsByScript = new Map<string, number>();
  const skirmishAIStates = new Map<string, Record<string, never>>();
  const controllingPlayerScriptCredits = new Map<string, number>();
  const controllingPlayerScriptSciences = new Map<string, Set<string>>();
  const controllingPlayerScriptSciencePurchasePoints = new Map<string, number>();
  const defaultTeamIdToSide = new Map<number, string>();

  for (const player of players) {
    if (!player.side) {
      continue;
    }
    playerSideByIndex.set(player.playerIndex, player.side);
    sidePlayerIndex.set(player.side, player.playerIndex);
    defaultTeamIdToSide.set(player.defaultTeamId, player.side);
  }

  for (const player of players) {
    if (!player.side) {
      continue;
    }
    playerSideByIndex.set(player.playerIndex, player.side);
    sidePlayerIndex.set(player.side, player.playerIndex);
    sideCredits.set(player.side, player.money);
    sidePlayerTypes.set(player.side, player.aiPlayer ? 'COMPUTER' : 'HUMAN');
    sideIsPreorder.set(player.side, player.isPreorder);
    sideCanBuildBaseByScript.set(player.side, player.canBuildBase);
    sideCanBuildUnitsByScript.set(player.side, player.canBuildUnits);
    sideSkillPointsModifier.set(player.side, player.skillPointsModifier);
    sideCashBountyPercent.set(player.side, player.cashBountyPercent);
    sideSciences.set(player.side, new Set(player.sciences));
    sideScienceAvailability.set(player.side, new Map<string, 'enabled' | 'disabled' | 'hidden'>([
      ...player.sciencesDisabled.map(
        (scienceName): [string, 'disabled'] => [scienceName, 'disabled'],
      ),
      ...player.sciencesHidden.map(
        (scienceName): [string, 'hidden'] => [scienceName, 'hidden'],
      ),
    ]));
    sideCompletedUpgrades.set(
      player.side,
      new Set(player.upgrades.filter((upgrade) => upgrade.status === 2).map((upgrade) => upgrade.name)),
    );
    sideUpgradesInProduction.set(
      player.side,
      new Set(player.upgrades.filter((upgrade) => upgrade.status === 1).map((upgrade) => upgrade.name)),
    );
    sideRadarState.set(player.side, {
      radarCount: player.radarCount,
      disableProofRadarCount: player.disableProofRadarCount,
      radarDisabled: player.radarDisabled,
    });
    sideRankState.set(player.side, {
      rankLevel: player.rankLevel,
      skillPoints: player.skillPoints,
      sciencePurchasePoints: player.sciencePurchasePoints,
    });
    sideScoreState.set(player.side, {
      structuresBuilt: player.scoreKeeper.totalBuildingsBuilt,
      structuresLost: player.scoreKeeper.totalBuildingsLost,
      structuresDestroyed: player.scoreKeeper.totalBuildingsDestroyed.reduce((sum, value) => sum + value, 0),
      unitsBuilt: player.scoreKeeper.totalUnitsBuilt,
      unitsLost: player.scoreKeeper.totalUnitsLost,
      unitsDestroyed: player.scoreKeeper.totalUnitsDestroyed.reduce((sum, value) => sum + value, 0),
      moneySpent: player.scoreKeeper.totalMoneySpent,
      moneyEarned: player.scoreKeeper.totalMoneyEarned,
    });
    if (!player.listInScoreScreen) {
      sideScoreScreenExcluded.add(player.side);
    }
    if (player.battlePlanBonuses) {
      sideBattlePlanBonuses.set(player.side, {
        bombardmentCount: player.bombardBattlePlans,
        holdTheLineCount: player.holdTheLineBattlePlans,
        searchAndDestroyCount: player.searchAndDestroyBattlePlans,
      });
    }
    if (player.buildListInfos.length > 0) {
      scriptAiBuildListEntriesBySide.set(player.side, player.buildListInfos.map((entry) => ({
        templateNameUpper: entry.templateName.trim().toUpperCase(),
        locationX: entry.location.x,
        locationZ: entry.location.z,
      })));
    }
    if (player.aiPlayer) {
      sideScriptSkillset.set(player.side, player.aiPlayer.skillsetSelector);
      if (player.aiPlayer.currentWarehouseId > 0) {
        scriptCurrentSupplyWarehouseBySide.set(player.side, player.aiPlayer.currentWarehouseId);
      }
      if (player.aiPlayer.teamSeconds > 0) {
        sideTeamBuildDelaySecondsByScript.set(player.side, player.aiPlayer.teamSeconds);
      }
      if (player.aiPlayer.baseCenterSet) {
        scriptSkirmishBaseCenterAndRadiusBySide.set(player.side, {
          centerX: player.aiPlayer.baseCenter.x,
          centerZ: player.aiPlayer.baseCenter.z,
          radius: player.aiPlayer.baseRadius,
        });
      }
      if (player.aiPlayer.isSkirmishAi) {
        skirmishAIStates.set(player.side, {});
        scriptSkirmishBaseDefenseStateBySide.set(player.side, {
          curFrontBaseDefense: player.aiPlayer.curFrontBaseDefense,
          curFlankBaseDefense: player.aiPlayer.curFlankBaseDefense,
          curFrontLeftDefenseAngle: player.aiPlayer.curFrontLeftDefenseAngle,
          curFrontRightDefenseAngle: player.aiPlayer.curFrontRightDefenseAngle,
          curLeftFlankLeftDefenseAngle: player.aiPlayer.curLeftFlankLeftDefenseAngle,
          curLeftFlankRightDefenseAngle: player.aiPlayer.curLeftFlankRightDefenseAngle,
          curRightFlankLeftDefenseAngle: player.aiPlayer.curRightFlankLeftDefenseAngle,
          curRightFlankRightDefenseAngle: player.aiPlayer.curRightFlankRightDefenseAngle,
        });
      }
    }
    for (const relation of player.playerRelations) {
      const targetSide = playerSideByIndex.get(relation.id);
      if (!targetSide) {
        continue;
      }
      playerRelationshipOverrides.set(`${player.side}\u0000${targetSide}`, relation.relationship);
    }
    for (const relation of player.teamRelations) {
      const targetSide = defaultTeamIdToSide.get(relation.id);
      if (!targetSide) {
        continue;
      }
      teamRelationshipOverrides.set(`${player.side}\u0000${targetSide}`, relation.relationship);
    }
    const playerName = typeof mapData?.sidesList?.sides[player.playerIndex]?.dict?.playerName === 'string'
      ? mapData.sidesList.sides[player.playerIndex]!.dict.playerName as string
      : '';
    const normalizedPlayerName = normalizeControllingPlayerTokenValue(playerName);
    if (normalizedPlayerName) {
      controllingPlayerScriptCredits.set(normalizedPlayerName, player.money);
      controllingPlayerScriptSciences.set(normalizedPlayerName, new Set(player.sciences));
      controllingPlayerScriptSciencePurchasePoints.set(normalizedPlayerName, player.sciencePurchasePoints);
    }
  }

  state.playerSideByIndex = playerSideByIndex;
  state.sidePlayerIndex = sidePlayerIndex;
  state.nextPlayerIndex = players.length;
  state.localPlayerIndex = 0;
  state.sideCredits = sideCredits;
  state.sidePlayerTypes = sidePlayerTypes;
  state.sideIsPreorder = sideIsPreorder;
  state.sideCanBuildBaseByScript = sideCanBuildBaseByScript;
  state.sideCanBuildUnitsByScript = sideCanBuildUnitsByScript;
  state.sideSkillPointsModifier = sideSkillPointsModifier;
  state.sideCashBountyPercent = sideCashBountyPercent;
  state.sideScienceAvailability = sideScienceAvailability;
  state.sideSciences = sideSciences;
  state.sideCompletedUpgrades = sideCompletedUpgrades;
  state.sideUpgradesInProduction = sideUpgradesInProduction;
  state.sideRadarState = sideRadarState;
  state.sideRankState = sideRankState;
  state.sideScoreState = sideScoreState;
  state.sideScoreScreenExcluded = sideScoreScreenExcluded;
  state.sideBattlePlanBonuses = sideBattlePlanBonuses;
  state.playerRelationshipOverrides = playerRelationshipOverrides;
  state.teamRelationshipOverrides = teamRelationshipOverrides;
  state.scriptAiBuildListEntriesBySide = scriptAiBuildListEntriesBySide;
  state.sideScriptSkillset = sideScriptSkillset;
  state.scriptCurrentSupplyWarehouseBySide = scriptCurrentSupplyWarehouseBySide;
  state.scriptSkirmishBaseCenterAndRadiusBySide = scriptSkirmishBaseCenterAndRadiusBySide;
  state.scriptSkirmishBaseDefenseStateBySide = scriptSkirmishBaseDefenseStateBySide;
  state.sideTeamBuildDelaySecondsByScript = sideTeamBuildDelaySecondsByScript;
  state.skirmishAIStates = skirmishAIStates;
  state.controllingPlayerScriptCredits = controllingPlayerScriptCredits;
  state.controllingPlayerScriptSciences = controllingPlayerScriptSciences;
  state.controllingPlayerScriptSciencePurchasePoints = controllingPlayerScriptSciencePurchasePoints;

  return {
    version: 1,
    state,
    tunnelTrackers: players.flatMap((player) =>
      player.side && player.tunnelTracker
        ? [{ side: player.side, tracker: player.tunnelTracker }]
        : []),
  };
}

class SourcePlayersSnapshot implements Snapshot {
  payload: GameLogicPlayersSaveState | null;
  private readonly mapData: MapDataJSON | null | undefined;
  private readonly teamFactoryState: GameLogicTeamFactorySaveState | null | undefined;
  private readonly sidesListState: GameLogicSidesListSaveState | null | undefined;

  constructor(
    payload: GameLogicPlayersSaveState | null = null,
    options: {
      mapData?: MapDataJSON | null;
      teamFactoryState?: GameLogicTeamFactorySaveState | null;
      sidesListState?: GameLogicSidesListSaveState | null;
    } = {},
  ) {
    this.payload = payload;
    this.mapData = options.mapData;
    this.teamFactoryState = options.teamFactoryState;
    this.sidesListState = options.sidesListState;
  }

  crc(_xfer: Xfer): void {
    // Player-list snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_PLAYERS_LIST_SNAPSHOT_VERSION);
    if (version !== SOURCE_PLAYERS_LIST_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported players list snapshot version ${version}`);
    }

    const playerCount = xfer.xferInt(resolveSourcePlayersCount(this.payload, this.mapData));
    if (playerCount < 0 || playerCount > SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
      throw new Error(`Player list count ${playerCount} is invalid.`);
    }
    const loadedPlayers: SourcePlayerEntryState[] = [];
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const player = xfer.getMode() === XferMode.XFER_LOAD
        ? ({
          playerIndex,
          side: resolveSourcePlayerSide(playerIndex, this.payload, this.mapData),
          money: 0,
          upgrades: [],
          isPreorder: false,
          sciencesDisabled: [],
          sciencesHidden: [],
          radarCount: 0,
          isPlayerDead: false,
          disableProofRadarCount: 0,
          radarDisabled: false,
          upgradesInProgress: [],
          upgradesCompleted: [],
          powerSabotagedTillFrame: 0,
          teamPrototypeIds: [],
          buildListInfos: [],
          aiPlayer: null,
          resourceGatheringManager: null,
          tunnelTracker: null,
          defaultTeamId: 0,
          sciences: [],
          rankLevel: 0,
          skillPoints: 0,
          sciencePurchasePoints: 0,
          levelUp: 0,
          levelDown: 0,
          generalName: '',
          playerRelations: [],
          teamRelations: [],
          canBuildUnits: true,
          canBuildBase: true,
          observer: false,
          skillPointsModifier: 1,
          listInScoreScreen: true,
          attackedByPlayerIndices: [],
          cashBountyPercent: 0,
          scoreKeeper: {
            totalMoneyEarned: 0,
            totalMoneySpent: 0,
            totalUnitsDestroyed: Array.from({ length: SOURCE_SCRIPT_ENGINE_PLAYER_COUNT }, () => 0),
            totalUnitsBuilt: 0,
            totalUnitsLost: 0,
            totalBuildingsDestroyed: Array.from({ length: SOURCE_SCRIPT_ENGINE_PLAYER_COUNT }, () => 0),
            totalBuildingsBuilt: 0,
            totalBuildingsLost: 0,
            totalTechBuildingsCaptured: 0,
            totalFactionBuildingsCaptured: 0,
            currentScore: 0,
            playerIndex,
          },
          kindOfCostModifiers: [],
          specialPowerReadyTimers: [],
          squads: Array.from({ length: SOURCE_PLAYER_HOTKEY_SQUAD_COUNT }, () => [] as number[]),
          currentSelection: [],
          battlePlanBonuses: null,
          bombardBattlePlans: 0,
          holdTheLineBattlePlans: 0,
          searchAndDestroyBattlePlans: 0,
          unitsShouldHunt: false,
        } satisfies SourcePlayerEntryState)
        : buildSourcePlayerEntryState(playerIndex, this.payload, {
          mapData: this.mapData,
          teamFactoryState: this.teamFactoryState,
          sidesListState: this.sidesListState,
        });

      const playerVersion = xfer.xferVersion(SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION);
      if (playerVersion !== 1 && playerVersion !== 2 && playerVersion !== 3 && playerVersion !== 4 && playerVersion !== 5 && playerVersion !== 6 && playerVersion !== 7 && playerVersion !== SOURCE_PLAYER_ENTRY_SNAPSHOT_VERSION) {
        throw new Error(`Unsupported player snapshot version ${playerVersion}`);
      }
      const moneyVersion = xfer.xferVersion(SOURCE_MONEY_SNAPSHOT_VERSION);
      if (moneyVersion !== SOURCE_MONEY_SNAPSHOT_VERSION) {
        throw new Error(`Unsupported money snapshot version ${moneyVersion}`);
      }
      player.money = xfer.xferUnsignedInt(player.money);
      const upgradeCount = xfer.xferUnsignedShort(player.upgrades.length);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.upgrades = [];
        for (let index = 0; index < upgradeCount; index += 1) {
          const name = xfer.xferAsciiString('');
          player.upgrades.push(xferSourceUpgradeState(xfer, { name, status: 0 }));
        }
      } else {
        for (const upgrade of player.upgrades) {
          xfer.xferAsciiString(upgrade.name);
          xferSourceUpgradeState(xfer, upgrade);
        }
      }
      if (playerVersion >= 7) {
        player.isPreorder = xfer.xferBool(player.isPreorder);
      }
      if (playerVersion >= 8) {
        player.sciencesDisabled = xferSourceScienceNames(xfer, player.sciencesDisabled);
        player.sciencesHidden = xferSourceScienceNames(xfer, player.sciencesHidden);
      }
      player.radarCount = xfer.xferInt(player.radarCount);
      player.isPlayerDead = xfer.xferBool(player.isPlayerDead);
      player.disableProofRadarCount = xfer.xferInt(player.disableProofRadarCount);
      player.radarDisabled = xfer.xferBool(player.radarDisabled);
      player.upgradesInProgress = xferSourceStringBitFlags(xfer, player.upgradesInProgress);
      player.upgradesCompleted = xferSourceStringBitFlags(xfer, player.upgradesCompleted);
      const energyVersion = xfer.xferVersion(SOURCE_ENERGY_SNAPSHOT_VERSION);
      if (energyVersion === 1) {
        void xfer.xferInt(0);
        void xfer.xferInt(0);
      } else if (energyVersion !== 2 && energyVersion !== SOURCE_ENERGY_SNAPSHOT_VERSION) {
        throw new Error(`Unsupported energy snapshot version ${energyVersion}`);
      }
      const energyPlayerIndex = xfer.xferInt(player.playerIndex);
      if (energyPlayerIndex !== player.playerIndex) {
        throw new Error(`Energy player index mismatch: expected ${player.playerIndex}, got ${energyPlayerIndex}`);
      }
      if (energyVersion >= 3) {
        player.powerSabotagedTillFrame = xfer.xferUnsignedInt(player.powerSabotagedTillFrame);
      }
      const teamPrototypeCount = xfer.xferUnsignedShort(player.teamPrototypeIds.length);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.teamPrototypeIds = [];
        for (let index = 0; index < teamPrototypeCount; index += 1) {
          player.teamPrototypeIds.push(xfer.xferUnsignedInt(0));
        }
      } else {
        for (const teamPrototypeId of player.teamPrototypeIds) {
          xfer.xferUnsignedInt(teamPrototypeId);
        }
      }
      const buildListInfoCount = xfer.xferUnsignedShort(player.buildListInfos.length);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.buildListInfos = [];
        for (let index = 0; index < buildListInfoCount; index += 1) {
          player.buildListInfos.push(xferSourceBuildListInfoState(xfer, {
            buildingName: '',
            templateName: '',
            location: { x: 0, y: 0, z: 0 },
            rallyPointOffset: { x: 0, y: 0 },
            angle: 0,
            isInitiallyBuilt: false,
            numRebuilds: 0,
            script: '',
            health: 100,
            whiner: false,
            unsellable: false,
            repairable: true,
            automaticallyBuild: true,
            objectId: 0,
            objectTimestamp: 0,
            underConstruction: false,
            resourceGatherers: [],
            isSupplyBuilding: false,
            desiredGatherers: 0,
            priorityBuild: false,
            currentGatherers: 0,
          }));
        }
      } else {
        player.buildListInfos = player.buildListInfos.map((entry) => xferSourceBuildListInfoState(xfer, entry));
      }
      const aiPlayerPresent = xfer.xferBool(player.aiPlayer !== null);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.aiPlayer = aiPlayerPresent
          ? xferSourceAiPlayerState(
              xfer,
              buildDefaultSourceAiPlayerState(player.side, this.payload),
              player.playerIndex,
            )
          : null;
      } else if (aiPlayerPresent && player.aiPlayer) {
        player.aiPlayer = xferSourceAiPlayerState(xfer, player.aiPlayer, player.playerIndex);
      }
      const resourceGatheringManagerPresent = xfer.xferBool(player.resourceGatheringManager !== null);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.resourceGatheringManager = resourceGatheringManagerPresent
          ? xferSourceResourceGatheringManagerState(xfer, { supplyWarehouses: [], supplyCenters: [] })
          : null;
      } else if (resourceGatheringManagerPresent && player.resourceGatheringManager) {
        player.resourceGatheringManager = xferSourceResourceGatheringManagerState(xfer, player.resourceGatheringManager);
      }
      const tunnelTrackerPresent = xfer.xferBool(player.tunnelTracker !== null);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.tunnelTracker = tunnelTrackerPresent
          ? xferSourcePlayerTunnelTrackerSnapshot(xfer, { tunnelIds: [], passengerIds: [], tunnelCount: 0 })
          : null;
      } else if (tunnelTrackerPresent && player.tunnelTracker) {
        player.tunnelTracker = xferSourcePlayerTunnelTrackerSnapshot(xfer, player.tunnelTracker);
      }
      player.defaultTeamId = xfer.xferUnsignedInt(player.defaultTeamId);
      if (playerVersion >= 5) {
        player.sciences = xferSourceScienceNames(xfer, player.sciences);
      }
      player.rankLevel = xfer.xferInt(player.rankLevel);
      player.skillPoints = xfer.xferInt(player.skillPoints);
      player.sciencePurchasePoints = xfer.xferInt(player.sciencePurchasePoints);
      player.levelUp = xfer.xferInt(player.levelUp);
      player.levelDown = xfer.xferInt(player.levelDown);
      player.generalName = xfer.xferUnicodeString(player.generalName);
      player.playerRelations = xferSourcePlayerRelationEntries(xfer, player.playerRelations);
      player.teamRelations = xferSourceTeamRelationEntries(xfer, player.teamRelations);
      player.canBuildUnits = xfer.xferBool(player.canBuildUnits);
      player.canBuildBase = xfer.xferBool(player.canBuildBase);
      player.observer = xfer.xferBool(player.observer);
      if (playerVersion >= 2) {
        player.skillPointsModifier = xfer.xferReal(player.skillPointsModifier);
      } else {
        player.skillPointsModifier = 1;
      }
      if (playerVersion >= 3) {
        player.listInScoreScreen = xfer.xferBool(player.listInScoreScreen);
      } else {
        player.listInScoreScreen = true;
      }
      const attackedBy: number[] = [];
      for (let index = 0; index < SOURCE_SCRIPT_ENGINE_PLAYER_COUNT; index += 1) {
        if (xfer.xferBool(player.attackedByPlayerIndices.includes(index))) {
          attackedBy.push(index);
        }
      }
      player.attackedByPlayerIndices = attackedBy;
      player.cashBountyPercent = xfer.xferReal(player.cashBountyPercent);
      player.scoreKeeper = xferSourceScoreKeeperState(xfer, player.scoreKeeper);
      player.kindOfCostModifiers = xferSourceKindOfCostModifiers(xfer, player.kindOfCostModifiers);
      if (playerVersion < 4) {
        player.specialPowerReadyTimers = [];
      } else {
        const timerListSize = xfer.xferUnsignedShort(player.specialPowerReadyTimers.length);
        if (xfer.getMode() === XferMode.XFER_LOAD) {
          player.specialPowerReadyTimers = [];
          for (let index = 0; index < timerListSize; index += 1) {
            player.specialPowerReadyTimers.push({
              templateId: xfer.xferUnsignedInt(0),
              readyFrame: xfer.xferUnsignedInt(0),
            });
          }
        } else {
          for (const timer of player.specialPowerReadyTimers) {
            xfer.xferUnsignedInt(timer.templateId);
            xfer.xferUnsignedInt(timer.readyFrame);
          }
        }
      }
      const squadCount = xfer.xferUnsignedShort(player.squads.length);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.squads = [];
        for (let index = 0; index < squadCount; index += 1) {
          player.squads.push(xferSourceSquadObjectIds(xfer, []));
        }
      } else {
        for (const squad of player.squads) {
          xferSourceSquadObjectIds(xfer, squad);
        }
      }
      const currentSelectionPresent = xfer.xferBool(player.currentSelection.length > 0);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.currentSelection = currentSelectionPresent ? xferSourceSquadObjectIds(xfer, []) : [];
      } else if (currentSelectionPresent) {
        player.currentSelection = xferSourceSquadObjectIds(xfer, player.currentSelection);
      }
      const battlePlanBonusPresent = xfer.xferBool(player.battlePlanBonuses !== null);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        player.battlePlanBonuses = battlePlanBonusPresent
          ? xferSourceBattlePlanBonusesState(xfer, {
            armorScalar: 1,
            sightRangeScalar: 1,
            bombardment: 0,
            holdTheLine: 0,
            searchAndDestroy: 0,
            validKindOf: [],
            invalidKindOf: [],
          })
          : null;
      } else if (battlePlanBonusPresent && player.battlePlanBonuses) {
        player.battlePlanBonuses = xferSourceBattlePlanBonusesState(xfer, player.battlePlanBonuses);
      }
      player.bombardBattlePlans = xfer.xferInt(player.bombardBattlePlans);
      player.holdTheLineBattlePlans = xfer.xferInt(player.holdTheLineBattlePlans);
      player.searchAndDestroyBattlePlans = xfer.xferInt(player.searchAndDestroyBattlePlans);
      if (playerVersion >= 6) {
        player.unitsShouldHunt = xfer.xferBool(player.unitsShouldHunt);
      } else {
        player.unitsShouldHunt = false;
      }

      loadedPlayers.push(player);
    }

    if (xfer.getMode() === XferMode.XFER_LOAD) {
      this.payload = buildGameLogicPlayersStateFromSourcePlayers(loadedPlayers, this.mapData);
    }
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class LegacyPlayersSnapshot implements Snapshot {
  payload: GameLogicPlayersSaveState | null;

  constructor(payload: GameLogicPlayersSaveState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // Player snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(LEGACY_PLAYER_SNAPSHOT_VERSION);
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
    if (version !== LEGACY_PLAYER_SNAPSHOT_VERSION) {
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

function buildScriptEngineNamedEventSlots(
  state: Record<string, unknown>,
  key: string,
  playerState: GameLogicPlayersSaveState | null | undefined,
): Array<Array<[string, number]>> {
  const slots = Array.from({ length: SOURCE_SCRIPT_ENGINE_PLAYER_COUNT }, () => [] as Array<[string, number]>);
  const bySide = getRuntimeStateMap<unknown>(state, key);
  for (const [side, rawEvents] of bySide) {
    if (typeof side !== 'string' || !Array.isArray(rawEvents)) {
      continue;
    }
    const playerIndex = resolvePlayerIndexForScriptSide(side, playerState);
    if (playerIndex < 0 || playerIndex >= SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
      continue;
    }
    for (const rawEvent of rawEvents) {
      if (!rawEvent || typeof rawEvent !== 'object') {
        continue;
      }
      const name = normalizeOptionalAsciiString((rawEvent as { name?: unknown }).name);
      const sourceEntityId = Number((rawEvent as { sourceEntityId?: unknown }).sourceEntityId);
      if (!name) {
        continue;
      }
      slots[playerIndex]!.push([
        name,
        Number.isFinite(sourceEntityId) ? Math.max(0, Math.trunc(sourceEntityId)) : 0,
      ]);
    }
  }
  return slots;
}

function buildScriptEngineScienceSlots(
  state: Record<string, unknown>,
  playerState: GameLogicPlayersSaveState | null | undefined,
): string[][] {
  const slots = Array.from({ length: SOURCE_SCRIPT_ENGINE_PLAYER_COUNT }, () => [] as string[]);
  const bySide = getRuntimeStateMap<unknown>(state, 'sideScriptAcquiredSciences');
  for (const [side, rawSciences] of bySide) {
    if (typeof side !== 'string' || !(rawSciences instanceof Set)) {
      continue;
    }
    const playerIndex = resolvePlayerIndexForScriptSide(side, playerState);
    if (playerIndex < 0 || playerIndex >= SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
      continue;
    }
    slots[playerIndex] = [...rawSciences.values()].filter((scienceName): scienceName is string => typeof scienceName === 'string');
  }
  return slots;
}

function buildScriptEngineToppleEntries(
  state: Record<string, unknown>,
  coreState: GameLogicCoreSaveState | null | undefined,
  sourceGameLogicState?: ParsedSourceGameLogicChunkState | null,
): Array<[string, { x: number; y: number; z: number }]> {
  const entries: Array<[string, { x: number; y: number; z: number }]> = [];
  const toppleDirections = getRuntimeStateMap<unknown>(state, 'scriptToppleDirectionByEntityId');
  for (const [entityId, rawDirection] of toppleDirections) {
    if (typeof entityId !== 'number' || !rawDirection || typeof rawDirection !== 'object') {
      continue;
    }
    const name = resolveScriptNameByEntityId(entityId, coreState, sourceGameLogicState);
    const x = Number((rawDirection as { x?: unknown }).x);
    const z = Number((rawDirection as { z?: unknown }).z);
    if (!name || !Number.isFinite(x) || !Number.isFinite(z)) {
      continue;
    }
    entries.push([name, { x, y: 0, z }]);
  }
  return entries;
}

function buildScriptEngineRevealEntries(
  state: Record<string, unknown>,
): Array<{
  revealName: string;
  waypointName: string;
  radius: number;
  playerName: string;
}> {
  const entries: Array<{
    revealName: string;
    waypointName: string;
    radius: number;
    playerName: string;
  }> = [];
  const reveals = getRuntimeStateMap<unknown>(state, 'scriptNamedMapRevealByName');
  for (const [key, rawReveal] of reveals) {
    if (!rawReveal || typeof rawReveal !== 'object') {
      continue;
    }
    const revealName = normalizeOptionalAsciiString((rawReveal as { revealName?: unknown }).revealName)
      || (typeof key === 'string' ? key : '');
    const waypointName = normalizeOptionalAsciiString((rawReveal as { waypointName?: unknown }).waypointName);
    const playerName = normalizeOptionalAsciiString((rawReveal as { playerName?: unknown }).playerName);
    const radius = Number((rawReveal as { radius?: unknown }).radius);
    if (!revealName || !waypointName || !playerName || !Number.isFinite(radius)) {
      continue;
    }
    entries.push({
      revealName,
      waypointName,
      radius,
      playerName,
    });
  }
  return entries;
}

function buildScriptEngineObjectTypeEntries(
  state: Record<string, unknown>,
): Array<{ listName: string; objectTypes: string[] }> {
  const entries: Array<{ listName: string; objectTypes: string[] }> = [];
  const byName = getRuntimeStateMap<unknown>(state, 'scriptObjectTypeListsByName');
  for (const [listName, rawObjectTypes] of byName) {
    if (typeof listName !== 'string' || !Array.isArray(rawObjectTypes)) {
      continue;
    }
    entries.push({
      listName,
      objectTypes: rawObjectTypes.filter((objectType): objectType is string => typeof objectType === 'string'),
    });
  }
  return entries;
}

function buildScriptEngineFadeState(
  payload: GameLogicScriptEngineSaveState | null | undefined,
  explicitFadeState: ScriptCameraEffectFadeSaveState | null | undefined,
): ScriptCameraEffectFadeSaveState | null {
  if (explicitFadeState) {
    return {
      fadeType: explicitFadeState.fadeType,
      minFade: explicitFadeState.minFade,
      maxFade: explicitFadeState.maxFade,
      currentFadeValue: explicitFadeState.currentFadeValue,
      currentFadeFrame: Math.max(0, Math.trunc(explicitFadeState.currentFadeFrame)),
      increaseFrames: Math.max(0, Math.trunc(explicitFadeState.increaseFrames)),
      holdFrames: Math.max(0, Math.trunc(explicitFadeState.holdFrames)),
      decreaseFrames: Math.max(0, Math.trunc(explicitFadeState.decreaseFrames)),
    };
  }
  const state = getScriptEngineStateRecord(payload);
  const fadeRequests = getRuntimeStateArray<Record<string, unknown>>(state, 'scriptCameraFadeRequests');
  const request = fadeRequests.length > 0 ? fadeRequests[fadeRequests.length - 1]! : null;
  if (!request || typeof request !== 'object') {
    return null;
  }
  const fadeType = normalizeSourceFadeValueToScriptEngineFadeType(
    normalizeScriptEngineFadeTypeToSourceValue(normalizeOptionalAsciiString(request.fadeType) as ScriptCameraEffectFadeSaveState['fadeType']),
  );
  if (!fadeType) {
    return null;
  }
  const minFade = Number(request.minFade);
  const maxFade = Number(request.maxFade);
  const increaseFrames = Number(request.increaseFrames);
  const holdFrames = Number(request.holdFrames);
  const decreaseFrames = Number(request.decreaseFrames);
  if (
    !Number.isFinite(minFade)
    || !Number.isFinite(maxFade)
    || !Number.isFinite(increaseFrames)
    || !Number.isFinite(holdFrames)
    || !Number.isFinite(decreaseFrames)
  ) {
    return null;
  }
  return {
    fadeType,
    minFade,
    maxFade,
    currentFadeValue: minFade,
    currentFadeFrame: 0,
    increaseFrames: Math.max(0, Math.trunc(increaseFrames)),
    holdFrames: Math.max(0, Math.trunc(holdFrames)),
    decreaseFrames: Math.max(0, Math.trunc(decreaseFrames)),
  };
}

class ScriptEngineSnapshot implements Snapshot {
  payload: GameLogicScriptEngineSaveState | null;
  fadeState: ScriptCameraEffectFadeSaveState | null;
  private readonly playerState: GameLogicPlayersSaveState | null | undefined;
  private readonly teamFactoryState: GameLogicTeamFactorySaveState | null | undefined;
  private readonly coreState: GameLogicCoreSaveState | null | undefined;
  private readonly sourceGameLogicState: ParsedSourceGameLogicChunkState | null | undefined;
  private readonly mapData: MapDataJSON | null | undefined;
  private readonly difficulty: GameDifficulty;
  private readonly currentMusicTrackName: string;

  constructor(
    payload: GameLogicScriptEngineSaveState | null = null,
    options: {
      playerState?: GameLogicPlayersSaveState | null;
      teamFactoryState?: GameLogicTeamFactorySaveState | null;
      coreState?: GameLogicCoreSaveState | null;
      sourceGameLogicState?: ParsedSourceGameLogicChunkState | null;
      mapData?: MapDataJSON | null;
      difficulty?: GameDifficulty | null;
      currentMusicTrackName?: string | null;
      fadeState?: ScriptCameraEffectFadeSaveState | null;
    } = {},
  ) {
    this.payload = payload;
    this.fadeState = options.fadeState ?? null;
    this.playerState = options.playerState;
    this.teamFactoryState = options.teamFactoryState;
    this.coreState = options.coreState;
    this.sourceGameLogicState = options.sourceGameLogicState;
    this.mapData = options.mapData;
    this.difficulty = options.difficulty ?? 'NORMAL';
    this.currentMusicTrackName = options.currentMusicTrackName?.trim() ?? '';
  }

  crc(_xfer: Xfer): void {
    // Script-engine snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_SCRIPT_ENGINE_SNAPSHOT_VERSION);
    if (version < 1 || version > SOURCE_SCRIPT_ENGINE_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported script-engine snapshot version ${version}`);
    }

    const state = getScriptEngineStateRecord(this.payload);
    const sequentialScripts = getRuntimeStateArray<Record<string, unknown>>(state, 'scriptSequentialScripts');
    const sequentialScriptCount = xfer.xferUnsignedShort(sequentialScripts.length);
    const loadedSequentialScripts: Array<Record<string, unknown>> = [];
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      for (let index = 0; index < sequentialScriptCount; index += 1) {
        const loaded = xferScriptEngineSequentialScript(xfer, {
          teamId: 0,
          objectId: 0,
          scriptNameUpper: '',
          currentInstruction: -1,
          timesToLoop: 0,
          framesToWait: -1,
          dontAdvanceInstruction: false,
        });
        loadedSequentialScripts.push({
          scriptNameUpper: loaded.scriptNameUpper,
          objectId: loaded.objectId > 0 ? loaded.objectId : null,
          teamNameUpper: resolveTeamNameBySourceId(loaded.teamId, this.teamFactoryState),
          currentInstruction: loaded.currentInstruction,
          timesToLoop: loaded.timesToLoop,
          framesToWait: loaded.framesToWait,
          dontAdvanceInstruction: loaded.dontAdvanceInstruction,
          nextScript: null,
        });
      }
    } else {
      for (const rawSequentialScript of sequentialScripts.slice(0, sequentialScriptCount)) {
        const scriptNameUpper = normalizeOptionalAsciiString(rawSequentialScript.scriptNameUpper).trim().toUpperCase();
        if (!scriptNameUpper) {
          xferScriptEngineSequentialScript(xfer, {
            teamId: 0,
            objectId: 0,
            scriptNameUpper: '',
            currentInstruction: -1,
            timesToLoop: 0,
            framesToWait: -1,
            dontAdvanceInstruction: false,
          });
          continue;
        }
        const objectId = Number(rawSequentialScript.objectId);
        const teamNameUpper = normalizeOptionalAsciiString(rawSequentialScript.teamNameUpper).trim().toUpperCase();
        const currentInstruction = Number(rawSequentialScript.currentInstruction);
        const timesToLoop = Number(rawSequentialScript.timesToLoop);
        const framesToWait = Number(rawSequentialScript.framesToWait);
        xferScriptEngineSequentialScript(xfer, {
          teamId: resolveSourceTeamIdByName(teamNameUpper || null, this.teamFactoryState),
          objectId: Number.isFinite(objectId) && objectId > 0 ? Math.trunc(objectId) : 0,
          scriptNameUpper,
          currentInstruction: Number.isFinite(currentInstruction)
            ? Math.trunc(currentInstruction)
            : -1,
          timesToLoop: Number.isFinite(timesToLoop)
            ? Math.trunc(timesToLoop)
            : 0,
          framesToWait: Number.isFinite(framesToWait)
            ? Math.trunc(framesToWait)
            : -1,
          dontAdvanceInstruction: Boolean(rawSequentialScript.dontAdvanceInstruction),
        });
      }
    }

    const countersByName = getRuntimeStateMap<{ value?: unknown; isCountdownTimer?: unknown }>(state, 'scriptCountersByName');
    const counterEntries = [...countersByName.entries()].flatMap(([name, counterState]) =>
      typeof name === 'string'
        ? [{
            name,
            value: Number.isFinite(counterState?.value) ? Math.trunc(counterState.value as number) : 0,
            isCountdownTimer: Boolean(counterState?.isCountdownTimer),
          }]
        : []);
    const countersSize = xfer.xferUnsignedShort(counterEntries.length);
    if (countersSize > SOURCE_SCRIPT_ENGINE_MAX_COUNTERS) {
      throw new Error(`Script-engine counter count ${countersSize} exceeds source max ${SOURCE_SCRIPT_ENGINE_MAX_COUNTERS}.`);
    }
    const loadedCountersByName = new Map<string, { value: number; isCountdownTimer: boolean }>();
    for (let index = 0; index < countersSize; index += 1) {
      const entry = counterEntries[index] ?? { name: '', value: 0, isCountdownTimer: false };
      const value = xfer.xferInt(entry.value);
      const name = xfer.xferAsciiString(entry.name);
      const isCountdownTimer = xfer.xferBool(entry.isCountdownTimer);
      if (xfer.getMode() === XferMode.XFER_LOAD && name) {
        loadedCountersByName.set(name, { value, isCountdownTimer });
      }
    }
    xfer.xferInt(countersSize);

    const flagsByName = getRuntimeStateMap<boolean>(state, 'scriptFlagsByName');
    const flagEntries = [...flagsByName.entries()].flatMap(([name, value]) =>
      typeof name === 'string' ? [{ name, value: Boolean(value) }] : []);
    const flagsSize = xfer.xferUnsignedShort(flagEntries.length);
    if (flagsSize > SOURCE_SCRIPT_ENGINE_MAX_FLAGS) {
      throw new Error(`Script-engine flag count ${flagsSize} exceeds source max ${SOURCE_SCRIPT_ENGINE_MAX_FLAGS}.`);
    }
    const loadedFlagsByName = new Map<string, boolean>();
    for (let index = 0; index < flagsSize; index += 1) {
      const entry = flagEntries[index] ?? { name: '', value: false };
      const value = xfer.xferBool(entry.value);
      const name = xfer.xferAsciiString(entry.name);
      if (xfer.getMode() === XferMode.XFER_LOAD && name) {
        loadedFlagsByName.set(name, value);
      }
    }
    xfer.xferInt(flagsSize);

    const attackPrioritySets = getRuntimeStateMap<unknown>(state, 'scriptAttackPrioritySetsByName');
    const attackPriorityEntries = [...attackPrioritySets.entries()].flatMap(([nameUpper, rawSet]) => {
      if (typeof nameUpper !== 'string' || !rawSet || typeof rawSet !== 'object') {
        return [];
      }
      const templatePriorityByName = (rawSet as { templatePriorityByName?: unknown }).templatePriorityByName;
      return [{
        nameUpper,
        defaultPriority: Number.isFinite((rawSet as { defaultPriority?: unknown }).defaultPriority)
          ? Math.trunc((rawSet as { defaultPriority?: unknown }).defaultPriority as number)
          : 0,
        templateEntries: templatePriorityByName instanceof Map
          ? [...templatePriorityByName.entries()].flatMap(([templateName, priority]) =>
            typeof templateName === 'string' && Number.isFinite(priority)
              ? [[templateName, Math.trunc(priority as number)] as [string, number]]
              : [])
          : [],
      }];
    });
    const attackPriorityInfoSize = xfer.xferUnsignedShort(attackPriorityEntries.length);
    if (attackPriorityInfoSize > SOURCE_SCRIPT_ENGINE_MAX_ATTACK_PRIORITIES) {
      throw new Error(`Script-engine attack-priority count ${attackPriorityInfoSize} exceeds source max ${SOURCE_SCRIPT_ENGINE_MAX_ATTACK_PRIORITIES}.`);
    }
    const loadedAttackPrioritySets = new Map<string, { nameUpper: string; defaultPriority: number; templatePriorityByName: Map<string, number> }>();
    for (let index = 0; index < attackPriorityInfoSize; index += 1) {
      const entry = attackPriorityEntries[index] ?? {
        nameUpper: '',
        defaultPriority: 0,
        templateEntries: [],
      };
      const loaded = xferScriptEngineAttackPrioritySet(
        xfer,
        entry.nameUpper,
        entry.defaultPriority,
        entry.templateEntries,
      );
      if (xfer.getMode() === XferMode.XFER_LOAD && loaded.name) {
        loadedAttackPrioritySets.set(loaded.name, {
          nameUpper: loaded.name,
          defaultPriority: loaded.defaultPriority,
          templatePriorityByName: new Map(loaded.entries),
        });
      }
    }
    xfer.xferInt(attackPriorityInfoSize);

    const endGameTimer = this.coreState && this.coreState.scriptEndGameTimerActive && this.coreState.gameEndFrame !== null
      ? Math.max(0, Math.trunc(this.coreState.gameEndFrame - this.coreState.frameCounter))
      : -1;
    xfer.xferInt(endGameTimer);
    xfer.xferInt(-1);

    const namedEntitiesByName = getRuntimeStateMap<number>(state, 'scriptNamedEntitiesByName');
    const namedObjectEntries = [...namedEntitiesByName.entries()].flatMap(([name, entityId]) =>
      typeof name === 'string'
        ? [[name, Number.isFinite(entityId) ? Math.max(0, Math.trunc(entityId)) : 0] as [string, number]]
        : []);
    const namedObjectsCount = xfer.xferUnsignedShort(namedObjectEntries.length);
    const loadedNamedEntitiesByName = new Map<string, number>();
    const namedEntitiesForLookup = new Map<string, number>();
    const namedObjects = xferScriptEngineAsciiStringObjectIdEntries(
      xfer,
      namedObjectEntries.slice(0, namedObjectsCount),
    );
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      for (const [name, objectId] of namedObjects) {
        const normalizedName = name.trim().toUpperCase();
        if (!normalizedName) {
          continue;
        }
        loadedNamedEntitiesByName.set(normalizedName, objectId);
        namedEntitiesForLookup.set(normalizedName, objectId);
      }
    } else {
      for (const [name, objectId] of namedObjectEntries) {
        namedEntitiesForLookup.set(name.trim().toUpperCase(), objectId);
      }
    }

    xfer.xferBool(false);

    const resolvedFadeState = buildScriptEngineFadeState(this.payload, this.fadeState);
    const sourceFadeValue = normalizeScriptEngineFadeTypeToSourceValue(resolvedFadeState?.fadeType ?? null);
    const loadedSourceFadeValue = xfer.xferInt(sourceFadeValue);
    const loadedMinFade = xfer.xferReal(resolvedFadeState?.minFade ?? 1);
    const loadedMaxFade = xfer.xferReal(resolvedFadeState?.maxFade ?? 0);
    const loadedCurrentFadeValue = xfer.xferReal(resolvedFadeState?.currentFadeValue ?? 0);
    const loadedCurrentFadeFrame = xfer.xferInt(resolvedFadeState?.currentFadeFrame ?? 0);
    const loadedIncreaseFrames = xfer.xferInt(resolvedFadeState?.increaseFrames ?? 0);
    const loadedHoldFrames = xfer.xferInt(resolvedFadeState?.holdFrames ?? 0);
    const loadedDecreaseFrames = xfer.xferInt(resolvedFadeState?.decreaseFrames ?? 0);

    const completedVideos = xferScriptEngineAsciiStringEntries(
      xfer,
      getRuntimeStateArray<string>(state, 'scriptCompletedVideos').filter((value): value is string => typeof value === 'string'),
    );

    const testingSpeechEntries = xferScriptEngineAsciiStringUIntEntries(
      xfer,
      [...getRuntimeStateMap<number>(state, 'scriptTestingSpeechCompletionFrameByName').entries()]
        .flatMap(([name, frame]) =>
          typeof name === 'string' && Number.isFinite(frame)
            ? [[name, Math.max(0, Math.trunc(frame as number))] as [string, number]]
            : []),
    );
    const testingAudioEntries = xferScriptEngineAsciiStringUIntEntries(
      xfer,
      [...getRuntimeStateMap<number>(state, 'scriptTestingAudioCompletionFrameByName').entries()]
        .flatMap(([name, frame]) =>
          typeof name === 'string' && Number.isFinite(frame)
            ? [[name, Math.max(0, Math.trunc(frame as number))] as [string, number]]
            : []),
    );

    const uiInteractions = xferScriptEngineAsciiStringEntries(
      xfer,
      [...(state.scriptUIInteractions instanceof Set ? state.scriptUIInteractions.values() : [])]
        .filter((value): value is string => typeof value === 'string'),
    );

    const loadedTriggeredSpecialPowerEvents = new Map<string, Array<{ name: string; sourceEntityId: number }>>();
    const loadedMidwaySpecialPowerEvents = new Map<string, Array<{ name: string; sourceEntityId: number }>>();
    const loadedCompletedSpecialPowerEvents = new Map<string, Array<{ name: string; sourceEntityId: number }>>();
    const loadedCompletedUpgradeEvents = new Map<string, Array<{ name: string; sourceEntityId: number }>>();
    const namedEventStateByKey: Array<[string, Map<string, Array<{ name: string; sourceEntityId: number }>>]> = [
      ['sideScriptTriggeredSpecialPowerEvents', loadedTriggeredSpecialPowerEvents],
      ['sideScriptMidwaySpecialPowerEvents', loadedMidwaySpecialPowerEvents],
      ['sideScriptCompletedSpecialPowerEvents', loadedCompletedSpecialPowerEvents],
      ['sideScriptCompletedUpgradeEvents', loadedCompletedUpgradeEvents],
    ];
    for (const [stateKey, targetMap] of namedEventStateByKey) {
      const playerCount = xfer.xferUnsignedShort(SOURCE_SCRIPT_ENGINE_PLAYER_COUNT);
      if (playerCount !== SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
        throw new Error(`Script-engine named-event slot count mismatch for ${stateKey}: ${playerCount}`);
      }
      const slots = buildScriptEngineNamedEventSlots(state, stateKey, this.playerState);
      for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
        const loadedEntries = xferScriptEngineAsciiStringObjectIdEntries(
          xfer,
          slots[playerIndex] ?? [],
        );
        if (xfer.getMode() === XferMode.XFER_LOAD) {
          const side = resolveSideForPlayerIndex(playerIndex, this.playerState);
          if (!side || loadedEntries.length === 0) {
            continue;
          }
          targetMap.set(
            side,
            loadedEntries.map(([name, sourceEntityId]) => ({ name, sourceEntityId })),
          );
        }
      }
    }

    const acquiredSciencesBySide = new Map<string, Set<string>>();
    const acquiredSciencesCount = xfer.xferUnsignedShort(SOURCE_SCRIPT_ENGINE_PLAYER_COUNT);
    if (acquiredSciencesCount !== SOURCE_SCRIPT_ENGINE_PLAYER_COUNT) {
      throw new Error(`Script-engine acquired-science slot count mismatch: ${acquiredSciencesCount}`);
    }
    const acquiredScienceSlots = buildScriptEngineScienceSlots(state, this.playerState);
    for (let playerIndex = 0; playerIndex < acquiredSciencesCount; playerIndex += 1) {
      const sciences = xferScriptEngineScienceNames(xfer, acquiredScienceSlots[playerIndex] ?? []);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        const side = resolveSideForPlayerIndex(playerIndex, this.playerState);
        if (!side || sciences.length === 0) {
          continue;
        }
        acquiredSciencesBySide.set(side, new Set(sciences));
      }
    }

    const toppleDirections = xferScriptEngineAsciiStringCoord3DEntries(
      xfer,
      buildScriptEngineToppleEntries(state, this.coreState, this.sourceGameLogicState),
    );

    const breezeState = state.scriptBreezeState && typeof state.scriptBreezeState === 'object'
      ? state.scriptBreezeState as Record<string, unknown>
      : {};
    const loadedBreezeDirection = xfer.xferReal(getRuntimeStateNumber(breezeState, 'direction', 0));
    const loadedBreezeDirectionX = xfer.xferReal(getRuntimeStateNumber(breezeState, 'directionX', 0));
    const loadedBreezeDirectionY = xfer.xferReal(getRuntimeStateNumber(breezeState, 'directionY', 0));
    const loadedBreezeIntensity = xfer.xferReal(getRuntimeStateNumber(breezeState, 'intensity', 0));
    const loadedBreezeLean = xfer.xferReal(getRuntimeStateNumber(breezeState, 'lean', 0));
    const loadedBreezeRandomness = xfer.xferReal(getRuntimeStateNumber(breezeState, 'randomness', 0));
    const loadedBreezePeriodFrames = xfer.xferShort(getRuntimeStateNumber(breezeState, 'breezePeriodFrames', 0));
    const loadedBreezeVersion = xfer.xferShort(getRuntimeStateNumber(breezeState, 'version', 1));

    const loadedDifficulty = resolveDifficultyFromSourceValue(
      xfer.xferInt(resolveSourceDifficultyValue(this.difficulty)),
    );
    const freezeByScript = xfer.xferBool(getRuntimeStateBoolean(state, 'scriptTimeFrozenByScript'));

    const loadedNamedReveals = new Map<string, {
      revealName: string;
      waypointName: string;
      playerName: string;
      playerIndex: number;
      worldX: number;
      worldZ: number;
      radius: number;
      applied: boolean;
    }>();
    const loadedObjectTypeLists = new Map<string, string[]>();
    if (version >= 2) {
      const namedRevealEntries = buildScriptEngineRevealEntries(state);
      const namedRevealCount = xfer.xferUnsignedShort(namedRevealEntries.length);
      if (xfer.getMode() === XferMode.XFER_LOAD) {
        for (let index = 0; index < namedRevealCount; index += 1) {
          const revealName = xfer.xferAsciiString('');
          const waypointName = xfer.xferAsciiString('');
          const radius = xfer.xferReal(0);
          const playerName = xfer.xferAsciiString('');
          const waypointPosition = resolveWaypointPositionByName(this.mapData, waypointName);
          const playerIndex = resolvePlayerIndexForScriptSide(playerName, this.playerState);
          loadedNamedReveals.set(revealName, {
            revealName,
            waypointName,
            playerName,
            playerIndex,
            worldX: waypointPosition?.x ?? 0,
            worldZ: waypointPosition?.z ?? 0,
            radius,
            applied: false,
          });
        }
      } else {
        for (const entry of namedRevealEntries.slice(0, namedRevealCount)) {
          xfer.xferAsciiString(entry.revealName);
          xfer.xferAsciiString(entry.waypointName);
          xfer.xferReal(entry.radius);
          xfer.xferAsciiString(entry.playerName);
        }
      }

      const objectTypeEntries = buildScriptEngineObjectTypeEntries(state);
      const objectTypeCount = xfer.xferUnsignedShort(objectTypeEntries.length);
      for (let index = 0; index < objectTypeCount; index += 1) {
        const entry = objectTypeEntries[index] ?? { listName: '', objectTypes: [] };
        const loaded = xferScriptEngineObjectTypeList(xfer, entry.listName, entry.objectTypes);
        if (xfer.getMode() === XferMode.XFER_LOAD && loaded.listName) {
          loadedObjectTypeLists.set(loaded.listName, loaded.objectTypes);
        }
      }
    }

    const objectsShouldReceiveDifficultyBonus = version >= 3
      ? xfer.xferBool(getRuntimeStateBoolean(state, 'scriptObjectsReceiveDifficultyBonus', true))
      : true;
    const currentTrackName = version >= 4
      ? xfer.xferAsciiString(
          this.currentMusicTrackName
          || normalizeOptionalAsciiString(
            (state.scriptMusicTrackState && typeof state.scriptMusicTrackState === 'object')
              ? (state.scriptMusicTrackState as { trackName?: unknown }).trackName
              : '',
          ),
        )
      : '';
    const chooseVictimAlwaysUsesNormal = version >= 5
      ? xfer.xferBool(getRuntimeStateBoolean(state, 'scriptChooseVictimAlwaysUsesNormal'))
      : false;

    if (xfer.getMode() === XferMode.XFER_LOAD) {
      const resolvedFadeType = normalizeSourceFadeValueToScriptEngineFadeType(loadedSourceFadeValue);
      this.fadeState = resolvedFadeType
        ? {
            fadeType: resolvedFadeType,
            minFade: loadedMinFade,
            maxFade: loadedMaxFade,
            currentFadeValue: loadedCurrentFadeValue,
            currentFadeFrame: Math.max(0, Math.trunc(loadedCurrentFadeFrame)),
            increaseFrames: Math.max(0, Math.trunc(loadedIncreaseFrames)),
            holdFrames: Math.max(0, Math.trunc(loadedHoldFrames)),
            decreaseFrames: Math.max(0, Math.trunc(loadedDecreaseFrames)),
          }
        : createEmptyScriptEngineFadeState();

      const restoredState: Record<string, unknown> = {
        scriptSequentialScripts: loadedSequentialScripts,
        scriptCountersByName: loadedCountersByName,
        scriptFlagsByName: loadedFlagsByName,
        scriptCompletedVideos: completedVideos,
        scriptTestingSpeechCompletionFrameByName: new Map(testingSpeechEntries),
        scriptTestingAudioCompletionFrameByName: new Map(testingAudioEntries),
        scriptUIInteractions: new Set(uiInteractions),
        sideScriptTriggeredSpecialPowerEvents: loadedTriggeredSpecialPowerEvents,
        sideScriptMidwaySpecialPowerEvents: loadedMidwaySpecialPowerEvents,
        sideScriptCompletedSpecialPowerEvents: loadedCompletedSpecialPowerEvents,
        sideScriptCompletedUpgradeEvents: loadedCompletedUpgradeEvents,
        sideScriptAcquiredSciences: acquiredSciencesBySide,
        scriptToppleDirectionByEntityId: new Map(
          toppleDirections.flatMap(([name, coord]) => {
            const entityId = resolveEntityIdByScriptName(
              name,
              this.coreState,
              namedEntitiesForLookup,
              this.sourceGameLogicState,
            );
            return entityId === null ? [] : [[entityId, { x: coord.x, z: coord.z }] as const];
          }),
        ),
        scriptNamedEntitiesByName: loadedNamedEntitiesByName,
        scriptBreezeState: {
          version: loadedBreezeVersion,
          direction: loadedBreezeDirection,
          directionX: loadedBreezeDirectionX,
          directionY: loadedBreezeDirectionY,
          intensity: loadedBreezeIntensity,
          lean: loadedBreezeLean,
          randomness: loadedBreezeRandomness,
          breezePeriodFrames: loadedBreezePeriodFrames,
        },
        scriptTimeFrozenByScript: freezeByScript,
        scriptNamedMapRevealByName: loadedNamedReveals,
        scriptObjectTypeListsByName: loadedObjectTypeLists,
        scriptObjectsReceiveDifficultyBonus: objectsShouldReceiveDifficultyBonus,
        scriptChooseVictimAlwaysUsesNormal: chooseVictimAlwaysUsesNormal,
      };
      if (loadedAttackPrioritySets.size > 0) {
        restoredState.scriptAttackPrioritySetsByName = loadedAttackPrioritySets;
      }
      if (currentTrackName) {
        restoredState.scriptMusicTrackState = {
          trackName: currentTrackName,
          fadeOut: false,
          fadeIn: false,
          frame: 0,
        };
      }
      void loadedDifficulty;
      this.payload = {
        version: 1,
        state: restoredState,
      };
      return;
    }

    this.fadeState = resolvedFadeState;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

function xferSourceScriptState(
  xfer: Xfer,
  scriptState: GameLogicSourceScriptSaveState,
): GameLogicSourceScriptSaveState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported sides-list script snapshot version ${version}`);
  }
  return {
    active: xfer.xferBool(scriptState.active),
  };
}

function xferSourceScriptGroupState(
  xfer: Xfer,
  groupState: GameLogicSourceScriptGroupSaveState,
): GameLogicSourceScriptGroupSaveState {
  const version = xfer.xferVersion(2);
  if (version !== 2 && version !== 1) {
    throw new Error(`Unsupported sides-list script-group snapshot version ${version}`);
  }

  const active = version >= 2
    ? xfer.xferBool(groupState.active)
    : groupState.active;
  const count = xfer.xferUnsignedShort(groupState.scripts.length);
  const scripts: GameLogicSourceScriptSaveState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < count; index += 1) {
      scripts.push(xferSourceScriptState(xfer, { active: true }));
    }
  } else {
    for (const scriptState of groupState.scripts) {
      scripts.push(xferSourceScriptState(xfer, scriptState));
    }
  }

  return {
    active,
    scripts,
  };
}

function xferSourceScriptListState(
  xfer: Xfer,
  scriptListState: GameLogicSourceScriptListSaveState,
): GameLogicSourceScriptListSaveState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported sides-list script-list snapshot version ${version}`);
  }

  const scriptCount = xfer.xferUnsignedShort(scriptListState.scripts.length);
  const scripts: GameLogicSourceScriptSaveState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < scriptCount; index += 1) {
      scripts.push(xferSourceScriptState(xfer, { active: true }));
    }
  } else {
    for (const scriptState of scriptListState.scripts) {
      scripts.push(xferSourceScriptState(xfer, scriptState));
    }
  }

  const groupCount = xfer.xferUnsignedShort(scriptListState.groups.length);
  const groups: GameLogicSourceScriptGroupSaveState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < groupCount; index += 1) {
      groups.push(xferSourceScriptGroupState(xfer, { active: true, scripts: [] }));
    }
  } else {
    for (const groupState of scriptListState.groups) {
      groups.push(xferSourceScriptGroupState(xfer, groupState));
    }
  }

  return {
    present: true,
    scripts,
    groups,
  };
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
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      throw new Error('Sides-list snapshot load should use parseSourceSidesListChunk().');
    }
    if (this.payload === null) {
      throw new Error('Sides-list snapshot payload is missing during save.');
    }
    if (this.payload.version !== SOURCE_SIDES_LIST_SAVE_STATE_VERSION) {
      throw new Error(
        `Unsupported source sides-list save-state version ${this.payload.version}.`,
      );
    }
    const scriptLists = this.payload.scriptLists ?? [];
    xfer.xferInt(scriptLists.length);
    for (const scriptListState of scriptLists) {
      const present = xfer.xferBool(scriptListState.present);
      if (present) {
        xferSourceScriptListState(xfer, scriptListState);
      }
    }
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

function tryParseSourceSidesListChunk(data: ArrayBuffer | Uint8Array): GameLogicSidesListSaveState | null {
  const xferLoad = new XferLoad(
    data instanceof Uint8Array ? copyBytesToArrayBuffer(data) : data.slice(0),
  );
  xferLoad.open('source-sides-list');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const sideCount = xferLoad.xferInt(0);
    if (sideCount < 0 || sideCount > 64) {
      return null;
    }

    const scriptLists: GameLogicSourceScriptListSaveState[] = [];
    for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
      const present = xferLoad.xferBool(false);
      if (!present) {
        scriptLists.push({ present: false, scripts: [], groups: [] });
        continue;
      }
      const scriptList = xferSourceScriptListState(xferLoad, {
        present: true,
        scripts: [],
        groups: [],
      });
      scriptLists.push(scriptList);
    }
    if (xferLoad.getRemaining() !== 0) {
      return null;
    }
    return {
      version: SOURCE_SIDES_LIST_SAVE_STATE_VERSION,
      state: {},
      scriptLists,
    };
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseLegacySidesListChunk(data: ArrayBuffer | Uint8Array): GameLogicSidesListSaveState | null {
  return tryParseLegacyLongStringChunk<GameLogicSidesListSaveState>(data, 'legacy-sides-list');
}

function tryParseLegacyLongStringChunk<T>(data: ArrayBuffer | Uint8Array, label: string): T | null {
  const xferLoad = new XferLoad(
    data instanceof Uint8Array ? copyBytesToArrayBuffer(data) : data.slice(0),
  );
  xferLoad.open(label);
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const serialized = xferLoad.xferLongString('');
    if (serialized.length === 0) {
      return null;
    }
    if (xferLoad.getRemaining() !== 0) {
      return null;
    }
    return JSON.parse(serialized, runtimeJsonReviver) as T;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

export function parseSourceSidesListChunk(data: ArrayBuffer | Uint8Array): GameLogicSidesListSaveState | null {
  return tryParseSourceSidesListChunk(data) ?? tryParseLegacySidesListChunk(data);
}

function tryParseLegacyScriptEngineChunk(data: ArrayBuffer | Uint8Array): GameLogicScriptEngineSaveState | null {
  return tryParseLegacyLongStringChunk<GameLogicScriptEngineSaveState>(data, 'legacy-script-engine');
}

function tryParseSourceScriptEngineChunk(
  data: ArrayBuffer | Uint8Array,
  options: {
    mapData?: MapDataJSON | null;
    playerState?: GameLogicPlayersSaveState | null;
    teamFactoryState?: GameLogicTeamFactorySaveState | null;
    coreState?: GameLogicCoreSaveState | null;
    sourceGameLogicState?: ParsedSourceGameLogicChunkState | null;
  } = {},
): { state: GameLogicScriptEngineSaveState | null; fadeState: ScriptCameraEffectFadeSaveState | null } | null {
  try {
    const snapshot = new ScriptEngineSnapshot(null, {
      mapData: options.mapData ?? null,
      playerState: options.playerState ?? null,
      teamFactoryState: options.teamFactoryState ?? null,
      coreState: options.coreState ?? null,
      sourceGameLogicState: options.sourceGameLogicState ?? null,
    });
    const chunkData = data instanceof Uint8Array
      ? (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        })()
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('source-script-engine');
    xferLoad.xferSnapshot(snapshot);
    xferLoad.close();
    return {
      state: snapshot.payload ?? null,
      fadeState: snapshot.fadeState ?? null,
    };
  } catch {
    return null;
  }
}

function tryParseInGameUiChunk(data: ArrayBuffer | Uint8Array): RuntimeSaveInGameUiState | null {
  try {
    const snapshot = new InGameUiSnapshot();
    const chunkData = data instanceof Uint8Array
      ? (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        })()
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('source-in-game-ui');
    xferLoad.xferSnapshot(snapshot);
    xferLoad.close();
    return snapshot.payload ?? null;
  } catch {
    return null;
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

function tryParseLegacyTeamFactoryChunk(data: ArrayBuffer | Uint8Array): GameLogicTeamFactorySaveState | null {
  try {
    const snapshot = new TeamFactorySnapshot();
    const chunkData = data instanceof Uint8Array
      ? (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        })()
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('legacy-team-factory');
    xferLoad.xferSnapshot(snapshot);
    xferLoad.close();
    return snapshot.payload ?? null;
  } catch {
    return null;
  }
}

function tryParseSourcePlayersChunk(
  data: ArrayBuffer | Uint8Array,
  options: {
    mapData?: MapDataJSON | null;
    teamFactoryState?: GameLogicTeamFactorySaveState | null;
    sidesListState?: GameLogicSidesListSaveState | null;
  } = {},
): GameLogicPlayersSaveState | null {
  try {
    const snapshot = new SourcePlayersSnapshot(null, options);
    const chunkData = data instanceof Uint8Array
      ? (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        })()
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('source-players');
    xferLoad.xferSnapshot(snapshot);
    xferLoad.close();
    return snapshot.payload ?? null;
  } catch {
    return null;
  }
}

function tryParseLegacyPlayersChunk(data: ArrayBuffer | Uint8Array): GameLogicPlayersSaveState | null {
  try {
    const snapshot = new LegacyPlayersSnapshot();
    const chunkData = data instanceof Uint8Array
      ? (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        })()
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('legacy-players');
    xferLoad.xferSnapshot(snapshot);
    xferLoad.close();
    return snapshot.payload ?? null;
  } catch {
    return null;
  }
}

function tryParseSourceGameLogicChunk(data: ArrayBuffer | Uint8Array): GameLogicCoreSaveState | null {
  const inspection = inspectSourceGameLogicChunk(data);
  if (inspection?.layout !== 'source_outer') {
    return null;
  }
  return null;
}

function tryParseLegacyGameLogicChunk(data: ArrayBuffer | Uint8Array): GameLogicCoreSaveState | null {
  const inspection = inspectSourceGameLogicChunk(data);
  if (inspection?.layout === 'source_outer') {
    return null;
  }
  try {
    const snapshot = new LegacyGameLogicSnapshot();
    const chunkData = data instanceof Uint8Array
      ? (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy.buffer;
        })()
      : data;
    const xferLoad = new XferLoad(chunkData);
    xferLoad.open('legacy-game-logic');
    xferLoad.xferSnapshot(snapshot);
    xferLoad.close();
    return snapshot.payload ?? null;
  } catch {
    return null;
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
  payload: RuntimeSaveInGameUiState | null;

  constructor(payload: RuntimeSaveInGameUiState | null = null) {
    this.payload = payload;
  }

  crc(_xfer: Xfer): void {
    // In-game UI snapshot is not part of source parity CRC yet.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_IN_GAME_UI_SNAPSHOT_VERSION);
    if (version === 1) {
      const serialized = xfer.xferLongString('');
      if (serialized.length === 0) {
        this.payload = null;
        return;
      }
      const legacyState = JSON.parse(serialized, runtimeJsonReviver) as GameLogicInGameUiSaveState;
      this.payload = {
        ...buildRuntimeSaveInGameUiState({
          gameLogicState: legacyState,
        }),
        version: legacyState.version,
      };
      return;
    }
    if (version !== 2 && version !== SOURCE_IN_GAME_UI_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported in-game UI snapshot version ${version}`);
    }

    const payload = this.payload ?? createDefaultRuntimeSaveInGameUiState();
    payload.version = version;
    payload.namedTimerLastFlashFrame = xfer.xferInt(payload.namedTimerLastFlashFrame);
    payload.namedTimerUsedFlashColor = xfer.xferBool(payload.namedTimerUsedFlashColor);
    payload.showNamedTimers = xfer.xferBool(payload.showNamedTimers);

    if (xfer.getMode() === XferMode.XFER_SAVE) {
      const namedTimers = normalizeRuntimeSaveInGameUiNamedTimers(payload.namedTimers);
      let timerCount = namedTimers.length;
      timerCount = xfer.xferInt(timerCount);
      for (const timer of namedTimers) {
        xfer.xferAsciiString(timer.timerName);
        xfer.xferUnicodeString(timer.timerText);
        xfer.xferBool(timer.isCountdown);
      }
    } else {
      const timerCount = xfer.xferInt(0);
      const namedTimers: RuntimeSaveInGameUiNamedTimerState[] = [];
      for (let index = 0; index < timerCount; index += 1) {
        namedTimers.push({
          timerName: xfer.xferAsciiString(''),
          timerText: xfer.xferUnicodeString(''),
          isCountdown: xfer.xferBool(false),
        });
      }
      payload.namedTimers = normalizeRuntimeSaveInGameUiNamedTimers(namedTimers);
    }

    payload.superweaponHiddenByScript = xfer.xferBool(payload.superweaponHiddenByScript);
    if (xfer.getMode() === XferMode.XFER_SAVE) {
      const superweapons = normalizeRuntimeSaveInGameUiSuperweapons(payload.superweapons);
      for (const superweapon of superweapons) {
        xfer.xferInt(superweapon.playerIndex);
        xfer.xferAsciiString(superweapon.templateName);
        xfer.xferAsciiString(superweapon.powerName);
        xfer.xferObjectID(superweapon.objectId);
        xfer.xferUnsignedInt(Math.max(0, superweapon.timestamp >>> 0));
        xfer.xferBool(superweapon.hiddenByScript);
        xfer.xferBool(superweapon.hiddenByScience);
        xfer.xferBool(superweapon.ready);
        if (version >= 3) {
          xfer.xferBool(superweapon.evaReadyPlayed);
        }
      }
      xfer.xferInt(-1);
    } else {
      const superweapons: RuntimeSaveInGameUiSuperweaponState[] = [];
      for (;;) {
        const playerIndex = xfer.xferInt(0);
        if (playerIndex === -1) {
          break;
        }
        const templateName = xfer.xferAsciiString('');
        const powerName = xfer.xferAsciiString('');
        const objectId = xfer.xferObjectID(0);
        const timestamp = xfer.xferUnsignedInt(0);
        const hiddenByScript = xfer.xferBool(false);
        const hiddenByScience = xfer.xferBool(false);
        const ready = xfer.xferBool(false);
        const evaReadyPlayed = version >= 3
          ? xfer.xferBool(false)
          : ready;
        superweapons.push({
          playerIndex,
          templateName,
          powerName,
          objectId,
          timestamp,
          hiddenByScript,
          hiddenByScience,
          ready,
          evaReadyPlayed,
        });
      }
      payload.superweapons = normalizeRuntimeSaveInGameUiSuperweapons(superweapons);
    }

    this.payload = payload;
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class LegacyGameLogicSnapshot implements Snapshot {
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
      && version !== 7
      && version !== 8
      && version !== 9
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
        showBehindBuildingMarkers: version >= 8 ? xfer.xferBool(false) : undefined,
        drawIconUI: version >= 8 ? xfer.xferBool(true) : undefined,
        showDynamicLOD: version >= 8 ? xfer.xferBool(true) : undefined,
        scriptHulkMaxLifetimeOverride: version >= 8 ? xfer.xferInt(-1) : undefined,
        rankPointsToAddAtGameStart: version >= 9 ? xfer.xferInt(0) : undefined,
        superweaponRestriction: version >= 10 ? xfer.xferUnsignedShort(0) : undefined,
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
    if (version >= 8) {
      xfer.xferBool(this.payload.showBehindBuildingMarkers ?? false);
      xfer.xferBool(this.payload.drawIconUI ?? true);
      xfer.xferBool(this.payload.showDynamicLOD ?? true);
      xfer.xferInt(this.payload.scriptHulkMaxLifetimeOverride ?? -1);
    }
    if (version >= 9) {
      xfer.xferInt(this.payload.rankPointsToAddAtGameStart ?? 0);
    }
    if (version >= 10) {
      xfer.xferUnsignedShort(this.payload.superweaponRestriction ?? 0);
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

class RawPassthroughSnapshot implements Snapshot {
  private readonly bytes: Uint8Array;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  crc(_xfer: Xfer): void {
    // Passthrough chunks are preserved verbatim and are not part of TS-side CRC.
  }

  xfer(xfer: Xfer): void {
    if (xfer.getMode() === XferMode.XFER_LOAD) {
      throw new Error('Raw passthrough snapshots are save-only.');
    }
    xfer.xferUser(this.bytes);
  }

  loadPostProcess(): void {
    // No post-process work for passthrough chunks.
  }
}

class GameClientSnapshot implements Snapshot {
  constructor(
    private readonly frame: number,
    private readonly briefingLines: readonly string[] = [],
    private readonly drawables: readonly RuntimeSaveGameClientDrawableEntry[] = [],
    private readonly rawPrefixBytes: Uint8Array | null = null,
    private readonly version = SOURCE_GAME_CLIENT_SNAPSHOT_VERSION,
  ) {}

  crc(_xfer: Xfer): void {
    // Source game-client snapshot is currently save-only in the TS runtime.
  }

  xfer(xfer: Xfer): void {
    if (this.rawPrefixBytes !== null && this.drawables.length === 0) {
      xfer.xferUser(this.rawPrefixBytes);
      if (this.version >= 2) {
        xfer.xferInt(this.briefingLines.length);
        for (const briefingLine of this.briefingLines) {
          xfer.xferAsciiString(briefingLine);
        }
      }
      return;
    }

    const version = xfer.xferVersion(SOURCE_GAME_CLIENT_SNAPSHOT_VERSION);
    if (version !== SOURCE_GAME_CLIENT_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported game-client snapshot version ${version}`);
    }

    xfer.xferUnsignedInt(this.frame);

    const tocVersion = xfer.xferVersion(SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION);
    if (tocVersion !== SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported game-client TOC snapshot version ${tocVersion}`);
    }
    const tocEntries = new Map<string, number>();
    for (const drawable of this.drawables) {
      const templateName = drawable.kind === 'generated'
        ? drawable.state.templateName
        : drawable.state.templateName;
      if (!tocEntries.has(templateName)) {
        tocEntries.set(templateName, tocEntries.size + 1);
      }
    }
    xfer.xferUnsignedInt(tocEntries.size);
    for (const [templateName, tocId] of tocEntries.entries()) {
      xfer.xferAsciiString(templateName);
      xfer.xferUnsignedShort(tocId);
    }

    xfer.xferUnsignedShort(this.drawables.length);
    for (const drawable of this.drawables) {
      const templateName = drawable.kind === 'generated'
        ? drawable.state.templateName
        : drawable.state.templateName;
      const tocId = tocEntries.get(templateName);
      if (!tocId) {
        throw new Error(`Missing game-client TOC entry for drawable template "${templateName}".`);
      }
      xfer.xferUnsignedShort(tocId);
      xfer.beginBlock();
      if (drawable.kind === 'generated') {
        xfer.xferObjectID(drawable.state.objectId);
        xfer.xferSnapshot(new DrawableSnapshot(drawable.state));
      } else {
        xfer.xferUser(new Uint8Array(drawable.state.blockData));
      }
      xfer.endBlock();
    }

    const briefingCount = xfer.xferInt(this.briefingLines.length);
    if (xfer.getMode() !== XferMode.XFER_SAVE) {
      for (let index = 0; index < briefingCount; index += 1) {
        xfer.xferAsciiString('');
      }
      return;
    }
    for (const briefingLine of this.briefingLines) {
      xfer.xferAsciiString(briefingLine);
    }
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class ParticleSystemSnapshot implements Snapshot {
  constructor(
    private readonly state: ParticleSystemManagerSaveState | null = null,
  ) {}

  crc(_xfer: Xfer): void {
    // Source particle-system snapshot is currently save-only in the TS runtime.
  }

  xfer(xfer: Xfer): void {
    new SourceParticleSystemSnapshot(
      this.state ?? {
        version: 1,
        nextId: 1,
        systems: [],
      },
    ).xfer(xfer);
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class TerrainVisualSnapshot implements Snapshot {
  crc(_xfer: Xfer): void {
    // Source terrain-visual snapshot is currently save-only in the TS runtime.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_TERRAIN_VISUAL_SNAPSHOT_VERSION);
    if (version !== SOURCE_TERRAIN_VISUAL_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported terrain-visual snapshot version ${version}`);
    }
  }

  loadPostProcess(): void {
    // No cross-snapshot fixup required.
  }
}

class GhostObjectSnapshot implements Snapshot {
  constructor(private readonly localPlayerIndex: number) {}

  crc(_xfer: Xfer): void {
    // Source ghost-object snapshot is currently save-only in the TS runtime.
  }

  xfer(xfer: Xfer): void {
    const version = xfer.xferVersion(SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION);
    if (version !== SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported ghost-object snapshot version ${version}`);
    }
    xfer.xferInt(this.localPlayerIndex);
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
  gameClientBriefingLines?: readonly string[];
  gameClientState?: RuntimeSaveGameClientState | null;
  inGameUiState?: RuntimeSaveInGameUiState | null;
  scriptEngineFadeState?: ScriptCameraEffectFadeSaveState | null;
  renderableEntityStates?: readonly GameLogicRenderableEntityState[] | null;
  gameClientLiveEntityIds?: readonly number[] | null;
  particleSystemState?: ParticleSystemManagerSaveState | null;
  currentMusicTrackName?: string | null;
  sourceDifficulty?: GameDifficulty | null;
  gameLogic: (Pick<
    GameLogicSubsystem,
    | 'captureBrowserRuntimeSaveState'
    | 'captureSourceTerrainLogicRuntimeSaveState'
    | 'captureSourcePartitionRuntimeSaveState'
    | 'captureSourceRadarRuntimeSaveState'
    | 'captureSourceSidesListRuntimeSaveState'
    | 'captureSourceTeamFactoryRuntimeSaveState'
    | 'captureSourceScriptEngineRuntimeSaveState'
    | 'captureSourceInGameUiRuntimeSaveState'
    | 'captureSourcePlayerRuntimeSaveState'
    | 'captureSourceGameLogicRuntimeSaveState'
    | 'getObjectIdCounter'
  > & Partial<Pick<GameLogicSubsystem, 'captureSourceObjectXferOverlayState' | 'resolveSourceObjectModuleTypeByTag'>>);
  embeddedMapBytes?: Uint8Array | null;
  sourceGameMode?: number;
  campaign?: RuntimeSaveCampaignBootstrap | null;
  passthroughBlocks?: readonly RuntimeSavePassthroughBlock[];
}): {
  data: ArrayBuffer;
  metadata: {
    description: string;
    mapName: string;
    timestamp: number;
    sizeBytes: number;
  };
} {
  const browserGameLogicState = params.gameLogic.captureBrowserRuntimeSaveState();
  const runtimePayload: BrowserRuntimeSavePayload = {
    version: BROWSER_RUNTIME_STATE_VERSION,
    cameraState: buildBrowserRuntimeCameraSaveState(params.cameraState),
    gameLogicState: browserGameLogicState,
  };
  const tacticalViewPayload = params.tacticalViewState
    ?? buildTacticalViewSaveState(params.cameraState);
  const terrainLogicPayload = params.gameLogic.captureSourceTerrainLogicRuntimeSaveState();
  const partitionPayload = params.gameLogic.captureSourcePartitionRuntimeSaveState();
  const radarPayload = params.gameLogic.captureSourceRadarRuntimeSaveState();
  const sidesListPayload = params.gameLogic.captureSourceSidesListRuntimeSaveState();
  const teamFactoryPayload = params.gameLogic.captureSourceTeamFactoryRuntimeSaveState();
  const scriptEnginePayload = params.gameLogic.captureSourceScriptEngineRuntimeSaveState();
  const inGameUiLogicPayload = params.gameLogic.captureSourceInGameUiRuntimeSaveState();
  const inGameUiPayload = params.inGameUiState
    ? {
        ...params.inGameUiState,
        namedTimers: normalizeRuntimeSaveInGameUiNamedTimers(params.inGameUiState.namedTimers),
        superweapons: normalizeRuntimeSaveInGameUiSuperweapons(params.inGameUiState.superweapons),
      }
    : buildRuntimeSaveInGameUiState({
        gameLogicState: inGameUiLogicPayload,
      });
  const playerPayload = params.gameLogic.captureSourcePlayerRuntimeSaveState();
  const gameLogicPayload = params.gameLogic.captureSourceGameLogicRuntimeSaveState();
  const objectXferOverlayPayload = typeof params.gameLogic.captureSourceObjectXferOverlayState === 'function'
    ? params.gameLogic.captureSourceObjectXferOverlayState()
    : [];
  const gameClientDrawableStates = buildSourceGameClientDrawableStates(
    params.renderableEntityStates,
    gameLogicPayload,
    params.gameClientLiveEntityIds,
  );
  const gameClientDrawableEntries = buildGameClientDrawableEntries(
    params.gameClientState,
    gameClientDrawableStates,
  );
  const orderedPassthroughBlocks = orderPassthroughBlocks(params.passthroughBlocks);
  const mergedGameClientBriefingLines = mergeBriefingLines(
    params.gameClientState?.briefingLines ?? [],
    params.gameClientBriefingLines ?? [],
  );
  const localPlayerIndex = Number(
    (playerPayload?.state as Record<string, unknown> | undefined)?.localPlayerIndex ?? 0,
  );
  const resolvedLocalPlayerIndex = Number.isFinite(localPlayerIndex) ? Math.trunc(localPlayerIndex) : 0;
  const resolvedChallengeGameInfoState = resolveChallengeGameInfoState(
    params.campaign,
    gameLogicPayload.gameRandomSeed,
  );

  const metadataState = createMetadataState(params.description, params.mapPath);
  const campaignState: RuntimeSaveCampaignState = {
    version: resolveFreshCampaignSnapshotVersion(params.campaign),
    currentCampaign: params.campaign?.campaignName ?? '',
    currentMission: params.campaign?.missionName ?? '',
    currentRankPoints: params.campaign?.rankPoints ?? 0,
    difficulty: params.campaign?.difficulty ?? 'NORMAL',
    isChallengeCampaign: params.campaign?.isChallengeCampaign ?? false,
    playerTemplateNum: params.campaign?.playerTemplateNum ?? -1,
    challengeGameInfoState: resolvedChallengeGameInfoState,
  };
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
  const teamFactoryChunk = buildSourceTeamFactoryChunk(
    teamFactoryPayload,
    playerPayload,
    sidesListPayload,
  );
  state.addSnapshotBlock('CHUNK_GameState', new MetadataSnapshot(metadataState));
  state.addSnapshotBlock(SOURCE_CAMPAIGN_BLOCK, new CampaignSnapshot(campaignState));
  state.addSnapshotBlock('CHUNK_GameStateMap', new MapSnapshot(mapState));
  state.addSnapshotBlock(SOURCE_TERRAIN_LOGIC_BLOCK, new TerrainLogicSnapshot(terrainLogicPayload));
  state.addSnapshotBlock(SOURCE_TEAM_FACTORY_BLOCK, new RawPassthroughSnapshot(teamFactoryChunk));
  if (hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_PLAYERS_BLOCK)) {
    const passthroughBlock = orderedPassthroughBlocks.find(
      (block) => block.blockName.toLowerCase() === SOURCE_PLAYERS_BLOCK.toLowerCase(),
    );
    if (!passthroughBlock) {
      throw new Error('Missing players passthrough block after presence check.');
    }
    state.addSnapshotBlock(
      SOURCE_PLAYERS_BLOCK,
      new RawPassthroughSnapshot(passthroughBlock.blockData),
    );
  } else {
    state.addSnapshotBlock(
      SOURCE_PLAYERS_BLOCK,
      new SourcePlayersSnapshot(playerPayload, {
        mapData: params.mapData,
        teamFactoryState: teamFactoryPayload,
        sidesListState: sidesListPayload,
      }),
    );
  }
  if (hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_GAME_LOGIC_BLOCK)) {
    const passthroughBlock = orderedPassthroughBlocks.find(
      (block) => block.blockName.toLowerCase() === SOURCE_GAME_LOGIC_BLOCK.toLowerCase(),
    );
    if (!passthroughBlock) {
      throw new Error('Missing game-logic passthrough block after presence check.');
    }
    const parsedSourceGameLogicState = parseSourceGameLogicChunkState(passthroughBlock.blockData);
    state.addSnapshotBlock(
      SOURCE_GAME_LOGIC_BLOCK,
      new RawPassthroughSnapshot(
        parsedSourceGameLogicState
          ? buildSourceGameLogicChunk(parsedSourceGameLogicState, {
              campaignState,
              coreState: gameLogicPayload,
              objectXferOverlayStates: objectXferOverlayPayload,
              resolveSourceObjectModuleTypeByTag:
                typeof params.gameLogic.resolveSourceObjectModuleTypeByTag === 'function'
                  ? params.gameLogic.resolveSourceObjectModuleTypeByTag.bind(params.gameLogic)
                  : null,
            })
          : passthroughBlock.blockData,
      ),
    );
  } else {
    state.addSnapshotBlock(SOURCE_GAME_LOGIC_BLOCK, new LegacyGameLogicSnapshot(gameLogicPayload));
  }
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, new RadarSnapshot(radarPayload));
  if (hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_SCRIPT_ENGINE_BLOCK)) {
    const passthroughBlock = orderedPassthroughBlocks.find(
      (block) => block.blockName.toLowerCase() === SOURCE_SCRIPT_ENGINE_BLOCK.toLowerCase(),
    );
    if (!passthroughBlock) {
      throw new Error('Missing script-engine passthrough block after presence check.');
    }
    state.addSnapshotBlock(
      SOURCE_SCRIPT_ENGINE_BLOCK,
      new RawPassthroughSnapshot(passthroughBlock.blockData),
    );
  } else {
    state.addSnapshotBlock(
      SOURCE_SCRIPT_ENGINE_BLOCK,
      new ScriptEngineSnapshot(scriptEnginePayload, {
        mapData: params.mapData,
        playerState: playerPayload,
        teamFactoryState: teamFactoryPayload,
        coreState: gameLogicPayload,
        difficulty: params.sourceDifficulty ?? params.campaign?.difficulty ?? 'NORMAL',
        currentMusicTrackName: params.currentMusicTrackName ?? null,
        fadeState: params.scriptEngineFadeState ?? null,
      }),
    );
  }
  state.addSnapshotBlock(SOURCE_SIDES_LIST_BLOCK, new SidesListSnapshot(sidesListPayload));
  state.addSnapshotBlock(SOURCE_TACTICAL_VIEW_BLOCK, new TacticalViewSnapshot(tacticalViewPayload));
  for (const passthroughBlock of orderedPassthroughBlocks) {
    if (passthroughBlock.blockName.toLowerCase() === BROWSER_RUNTIME_STATE_BLOCK.toLowerCase()) {
      continue;
    }
    if (KNOWN_RUNTIME_SAVE_BLOCKS.has(passthroughBlock.blockName.toLowerCase())) {
      if (passthroughBlock.blockName.toLowerCase() === SOURCE_IN_GAME_UI_BLOCK.toLowerCase()) {
        state.addSnapshotBlock(
          passthroughBlock.blockName,
          new RawPassthroughSnapshot(passthroughBlock.blockData),
        );
      }
      continue;
    }
    if (passthroughBlock.blockName.toLowerCase() === SOURCE_GAME_CLIENT_BLOCK.toLowerCase()) {
      state.addSnapshotBlock(
        passthroughBlock.blockName,
        new RawPassthroughSnapshot(passthroughBlock.blockData),
      );
    }
  }
  if (!hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_GAME_CLIENT_BLOCK)) {
    state.addSnapshotBlock(
      SOURCE_GAME_CLIENT_BLOCK,
      new GameClientSnapshot(
        gameLogicPayload.frameCounter,
        mergedGameClientBriefingLines,
        gameClientDrawableEntries,
        gameClientDrawableEntries.length === 0 && params.gameClientState?.prefixBytes
          ? new Uint8Array(params.gameClientState.prefixBytes)
          : null,
        params.gameClientState?.version ?? SOURCE_GAME_CLIENT_SNAPSHOT_VERSION,
      ),
    );
  }
  if (!hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_IN_GAME_UI_BLOCK)) {
    state.addSnapshotBlock(SOURCE_IN_GAME_UI_BLOCK, new InGameUiSnapshot(inGameUiPayload));
  }
  state.addSnapshotBlock(SOURCE_PARTITION_BLOCK, new PartitionSnapshot(partitionPayload));
  if (params.particleSystemState) {
    state.addSnapshotBlock(
      SOURCE_PARTICLE_SYSTEM_BLOCK,
      new ParticleSystemSnapshot(params.particleSystemState),
    );
  } else if (!hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_PARTICLE_SYSTEM_BLOCK)) {
    state.addSnapshotBlock(SOURCE_PARTICLE_SYSTEM_BLOCK, new ParticleSystemSnapshot());
  }
  if (!hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_TERRAIN_VISUAL_BLOCK)) {
    state.addSnapshotBlock(SOURCE_TERRAIN_VISUAL_BLOCK, new TerrainVisualSnapshot());
  }
  if (!hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_GHOST_OBJECT_BLOCK)) {
    state.addSnapshotBlock(SOURCE_GHOST_OBJECT_BLOCK, new GhostObjectSnapshot(resolvedLocalPlayerIndex));
  }
  for (const passthroughBlock of orderedPassthroughBlocks) {
    const normalizedName = passthroughBlock.blockName.toLowerCase();
    if (normalizedName === BROWSER_RUNTIME_STATE_BLOCK.toLowerCase()) {
      continue;
    }
    if (
      normalizedName === SOURCE_PARTICLE_SYSTEM_BLOCK.toLowerCase()
      && params.particleSystemState
    ) {
      continue;
    }
    if (KNOWN_RUNTIME_SAVE_BLOCKS.has(normalizedName)) {
      continue;
    }
    if (normalizedName !== SOURCE_GAME_CLIENT_BLOCK.toLowerCase()) {
      state.addSnapshotBlock(
        passthroughBlock.blockName,
        new RawPassthroughSnapshot(passthroughBlock.blockData),
      );
    }
  }
  if (shouldWriteBrowserRuntimeStateBlock(browserGameLogicState)) {
    state.addSnapshotBlock(BROWSER_RUNTIME_STATE_BLOCK, new BrowserRuntimeSnapshot(runtimePayload));
  }
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
    version: SOURCE_CAMPAIGN_SNAPSHOT_FRESH_VERSION,
    currentCampaign: '',
    currentMission: '',
    currentRankPoints: 0,
    difficulty: 'NORMAL',
    isChallengeCampaign: false,
    playerTemplateNum: -1,
    challengeGameInfoState: null,
  });
  const terrainLogicSnapshot = new TerrainLogicSnapshot();
  const partitionSnapshot = new PartitionSnapshot();
  const radarSnapshot = new RadarSnapshot();
  const tacticalViewSnapshot = new TacticalViewSnapshot();
  const runtimeSnapshot = new BrowserRuntimeSnapshot();
  const state = new GameState();
  state.addSnapshotBlock(SOURCE_CAMPAIGN_BLOCK, campaignSnapshot);
  state.addSnapshotBlock(SOURCE_TERRAIN_LOGIC_BLOCK, terrainLogicSnapshot);
  state.addSnapshotBlock(SOURCE_PARTITION_BLOCK, partitionSnapshot);
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, radarSnapshot);
  state.addSnapshotBlock(SOURCE_TACTICAL_VIEW_BLOCK, tacticalViewSnapshot);
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
  const teamFactoryChunk = extractSaveChunkData(data, SOURCE_TEAM_FACTORY_BLOCK);
  const legacyTeamFactoryState = teamFactoryChunk
    ? tryParseLegacyTeamFactoryChunk(teamFactoryChunk)
    : null;
  const playersChunk = extractSaveChunkData(data, SOURCE_PLAYERS_BLOCK);
  const sourcePlayersState = playersChunk
    ? tryParseSourcePlayersChunk(playersChunk, { mapData })
    : null;
  const legacyPlayersState = sourcePlayersState === null && playersChunk
    ? tryParseLegacyPlayersChunk(playersChunk)
    : null;
  const resolvedPlayersState = sourcePlayersState ?? legacyPlayersState;
  const gameLogicChunk = extractSaveChunkData(data, SOURCE_GAME_LOGIC_BLOCK);
  const sourceGameLogicState = gameLogicChunk
    ? parseSourceGameLogicChunkState(gameLogicChunk)
    : null;
  const sourceGameLogicPrototypeNames = collectSourceGameLogicPrototypeNames(sourceGameLogicState);
  const sourceGameLogicCoreState = gameLogicChunk
    ? tryParseSourceGameLogicChunk(gameLogicChunk)
    : null;
  const legacyGameLogicCoreState = sourceGameLogicCoreState === null && gameLogicChunk
    ? tryParseLegacyGameLogicChunk(gameLogicChunk)
    : null;
  const gameLogicCoreState = sourceGameLogicCoreState ?? legacyGameLogicCoreState;
  const sidesListChunk = extractSaveChunkData(data, SOURCE_SIDES_LIST_BLOCK);
  const sidesListState = sidesListChunk
    ? parseSourceSidesListChunk(sidesListChunk)
    : null;
  const resolvedTeamFactoryState = legacyTeamFactoryState
    ?? (
      teamFactoryChunk
        ? (() => {
            try {
              return applySourceTeamFactoryChunkToState(
                teamFactoryChunk,
                createEmptyRuntimeSaveTeamFactoryState(),
                resolvedPlayersState,
                sidesListState,
                gameLogicCoreState,
                sourceGameLogicPrototypeNames,
              );
            } catch {
              return null;
            }
          })()
        : null
    );
  const scriptEngineChunk = extractSaveChunkData(data, SOURCE_SCRIPT_ENGINE_BLOCK);
  const parsedScriptEngineChunk = scriptEngineChunk
    ? (
      tryParseSourceScriptEngineChunk(scriptEngineChunk, {
        mapData,
        playerState: resolvedPlayersState,
        teamFactoryState: resolvedTeamFactoryState,
        coreState: gameLogicCoreState,
        sourceGameLogicState,
      })
      ?? (() => {
        const legacyState = tryParseLegacyScriptEngineChunk(scriptEngineChunk);
        return legacyState
          ? { state: legacyState, fadeState: null }
          : null;
      })()
    )
    : null;
  const scriptEngineState = parsedScriptEngineChunk?.state ?? null;
  const scriptEngineFadeState = parsedScriptEngineChunk?.fadeState ?? null;
  const inGameUiChunk = extractSaveChunkData(data, SOURCE_IN_GAME_UI_BLOCK);
  const inGameUiState = inGameUiChunk
    ? tryParseInGameUiChunk(inGameUiChunk)
    : null;
  const gameLogicInGameUiState = inGameUiState
    ? buildGameLogicInGameUiSaveStateFromRuntimeSaveState(inGameUiState)
    : null;
  const particleSystemChunk = extractSaveChunkData(data, SOURCE_PARTICLE_SYSTEM_BLOCK);
  const particleSystemState = particleSystemChunk
    ? parseSourceParticleSystemChunk(particleSystemChunk)
    : null;
  const campaign = campaignSnapshot.state.currentCampaign.length > 0
      ? {
        version: campaignSnapshot.state.version,
        campaignName: campaignSnapshot.state.currentCampaign,
        missionName: campaignSnapshot.state.currentMission,
        missionNumber: metadata.missionNumber,
        difficulty: campaignSnapshot.state.difficulty,
        rankPoints: campaignSnapshot.state.currentRankPoints,
        isChallengeCampaign: campaignSnapshot.state.isChallengeCampaign,
        playerTemplateNum: campaignSnapshot.state.playerTemplateNum,
        challengeGameInfoState: campaignSnapshot.state.challengeGameInfoState,
      }
    : null;

  return {
    metadata,
    mapData,
    mapPath: resolvedMapPath,
    mapObjectIdCounter: mapInfo.objectIdCounter,
    mapDrawableIdCounter: mapInfo.drawableIdCounter,
    cameraState: resolveRestoredCameraState(tacticalViewSnapshot.payload, browserCameraState),
    tacticalViewState: tacticalViewSnapshot.payload,
    gameClientState: parseGameClientState(data),
    inGameUiState,
    particleSystemState,
    sourceTeamFactoryChunkData: teamFactoryChunk ?? null,
    gameLogicTerrainLogicState: terrainLogicSnapshot?.payload ?? null,
    gameLogicTeamFactoryState: legacyTeamFactoryState,
    gameLogicPlayersState: resolvedPlayersState,
    gameLogicPartitionState: partitionSnapshot?.payload ?? null,
    gameLogicRadarState: radarSnapshot?.payload ?? null,
    gameLogicSidesListState: sidesListState,
    gameLogicScriptEngineState: scriptEngineState,
    scriptEngineFadeState,
    gameLogicInGameUiState,
    gameLogicCoreState,
    gameLogicState: payload?.gameLogicState ?? null,
    sourceGameLogicPrototypeNames,
    campaign,
    passthroughBlocks: [
      ...extractPassthroughBlocks(data).filter(
        (block) => block.blockName.toLowerCase() !== SOURCE_GAME_CLIENT_BLOCK.toLowerCase(),
      ),
      ...(playersChunk && resolvedPlayersState === null
        ? [{ blockName: SOURCE_PLAYERS_BLOCK, blockData: copyBytesToArrayBuffer(playersChunk) }]
        : []),
      ...(gameLogicChunk && gameLogicCoreState === null
        ? [{ blockName: SOURCE_GAME_LOGIC_BLOCK, blockData: copyBytesToArrayBuffer(gameLogicChunk) }]
        : []),
      ...(scriptEngineChunk && scriptEngineState === null
        ? [{ blockName: SOURCE_SCRIPT_ENGINE_BLOCK, blockData: copyBytesToArrayBuffer(scriptEngineChunk) }]
        : []),
      ...(inGameUiChunk && inGameUiState === null
        ? [{ blockName: SOURCE_IN_GAME_UI_BLOCK, blockData: copyBytesToArrayBuffer(inGameUiChunk) }]
        : []),
    ],
  };
}

export function inspectRuntimeSaveCoreChunkStatus(
  data: ArrayBuffer,
): RuntimeSaveCoreChunkStatus[] {
  const parsed = parseRuntimeSaveFile(data);
  const chunkNames = new Set(
    listSaveGameChunks(data).map((chunk) => chunk.blockName.toLowerCase()),
  );
  const playersChunk = extractSaveChunkData(data, SOURCE_PLAYERS_BLOCK);
  const parsedSourcePlayersChunk = playersChunk
    ? tryParseSourcePlayersChunk(playersChunk, { mapData: parsed.mapData })
    : null;
  const gameLogicChunk = extractSaveChunkData(data, SOURCE_GAME_LOGIC_BLOCK);
  const parsedGameLogicChunkLayout = gameLogicChunk
    ? inspectGameLogicChunkLayout(gameLogicChunk)
    : null;
  const scriptEngineChunk = extractSaveChunkData(data, SOURCE_SCRIPT_ENGINE_BLOCK);
  const parsedScriptEngineChunk = scriptEngineChunk
    ? tryParseSourceScriptEngineChunk(scriptEngineChunk, {
      mapData: parsed.mapData,
      playerState: parsed.gameLogicPlayersState,
      teamFactoryState: parsed.gameLogicTeamFactoryState,
      coreState: parsed.gameLogicCoreState,
    })
    : null;
  const passthroughNames = new Set(
    parsed.passthroughBlocks.map((block) => block.blockName.toLowerCase()),
  );

  const describeChunk = (
    blockName: string,
    parsedState: unknown,
    modeWhenParsed: Exclude<RuntimeSaveCoreChunkMode, 'raw_passthrough' | 'missing'> = 'parsed',
  ): RuntimeSaveCoreChunkStatus => {
    const normalizedName = blockName.toLowerCase();
    if (!chunkNames.has(normalizedName)) {
      return { blockName, mode: 'missing' };
    }
    if (parsedState !== null && parsedState !== undefined) {
      return { blockName, mode: modeWhenParsed };
    }
    if (passthroughNames.has(normalizedName)) {
      return { blockName, mode: 'raw_passthrough' };
    }
    return { blockName, mode: 'missing' };
  };

  return [
    describeChunk(
      SOURCE_PLAYERS_BLOCK,
      parsed.gameLogicPlayersState,
      parsedSourcePlayersChunk ? 'parsed' : 'legacy',
    ),
    describeChunk(
      SOURCE_GAME_LOGIC_BLOCK,
      parsedGameLogicChunkLayout?.layout === 'source_outer'
        ? parsedGameLogicChunkLayout
        : parsed.gameLogicCoreState,
      parsedGameLogicChunkLayout?.layout === 'source_outer' ? 'parsed' : 'legacy',
    ),
    describeChunk(
      SOURCE_SCRIPT_ENGINE_BLOCK,
      parsed.gameLogicScriptEngineState,
      parsedScriptEngineChunk ? 'parsed' : 'legacy',
    ),
    describeChunk(
      SOURCE_IN_GAME_UI_BLOCK,
      parsed.inGameUiState,
      parsed.inGameUiState?.version === 1 ? 'legacy' : 'parsed',
    ),
  ];
}
