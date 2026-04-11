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
  type Coord3D,
  type ParsedSaveGameInfo,
  type Snapshot,
  type Xfer,
} from '@generals/engine';
import type { CameraState } from '@generals/input';
import * as THREE from 'three';
import {
  ARMOR_SET_FLAG_MASK_BY_NAME,
  buildSourceMapEntityChunk,
  calcBodyDamageState,
  createEmptySourceMapEntitySaveState,
  parseSourceMapEntityChunk,
  type MapEntityChunkLayoutInspection,
  type SourceMapEntitySaveState,
  SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT,
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
  type GameLogicSourceObjectModuleDescriptor,
  type GameLogicSourceScriptGroupSaveState,
  type GameLogicSourceScriptListSaveState,
  type GameLogicSourceScriptSaveState,
  type GameLogicScriptEngineSaveState,
  type GameLogicSellingEntitySaveState,
  type GameLogicSidesListSaveState,
  type GameLogicTeamFactorySaveState,
  type GameLogicTerrainLogicSaveState,
  type GameLogicTerrainWaterUpdateSaveState,
  type GameLogicSourceGameLogicImportSaveState,
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
const SOURCE_STEALTH_UPDATE_PULSE_PHASE_RATE = 0.2;
const SOURCE_HELPER_MODULE_TAG_DEFECTION = 'ModuleTag_DefectionHelper';
const SOURCE_HELPER_MODULE_TAG_FIRING_TRACKER = 'ModuleTag_FiringTrackerHelper';
const SOURCE_HELPER_MODULE_TAG_SMC = 'ModuleTag_SMCHelper';
const SOURCE_HELPER_MODULE_TAG_REPULSOR = 'ModuleTag_RepulsorHelper';
const SOURCE_HELPER_MODULE_TAG_STATUS_DAMAGE = 'ModuleTag_StatusDamageHelper';
const SOURCE_HELPER_MODULE_TAG_WEAPON_STATUS = 'ModuleTag_WeaponStatusHelper';
const SOURCE_HELPER_MODULE_TAG_TEMP_WEAPON_BONUS = 'ModuleTag_TempWeaponBonusHelper';
const SOURCE_HELPER_MODULE_TAG_SUBDUAL_DAMAGE = 'ModuleTag_SubdualDamageHelper';
const SOURCE_DERIVED_SPECIAL_POWER_MODULE_TYPES = new Set([
  'BAIKONURLAUNCHPOWER',
  'CASHBOUNTYPOWER',
  'CASHHACKSPECIALPOWER',
  'CLEANUPAREAPOWER',
  'DEFECTORSPECIALPOWER',
  'DEMORALIZESPECIALPOWER',
  'FIREWEAPONPOWER',
  'OCLSPECIALPOWER',
  'SPECIALABILITY',
  'SPYVISIONSPECIALPOWER',
]);
const SOURCE_UPGRADE_MODULE_TYPES = new Set([
  'LOCOMOTORSETUPGRADE',
  'MAXHEALTHUPGRADE',
  'ARMORUPGRADE',
  'WEAPONSETUPGRADE',
  'COMMANDSETUPGRADE',
  'STATUSBITSUPGRADE',
  'STEALTHUPGRADE',
  'WEAPONBONUSUPGRADE',
  'COSTMODIFIERUPGRADE',
  'GRANTSCIENCEUPGRADE',
  'POWERPLANTUPGRADE',
  'RADARUPGRADE',
  'PASSENGERSFIREUPGRADE',
  'UNPAUSESPECIALPOWERUPGRADE',
  'EXPERIENCESCALARUPGRADE',
  'MODELCONDITIONUPGRADE',
  'OBJECTCREATIONUPGRADE',
  'ACTIVESHROUDUPGRADE',
  'REPLACEOBJECTUPGRADE',
]);
const SOURCE_CREATE_MODULE_TYPES = new Set([
  'GRANTUPGRADECREATE',
  'LOCKWEAPONCREATE',
  'PREORDERCREATE',
  'SPECIALPOWERCREATE',
  'SUPPLYCENTERCREATE',
  'SUPPLYWAREHOUSECREATE',
  'VETERANCYGAINCREATE',
]);
const SOURCE_OPEN_CONTAIN_MAX_FIRE_POINTS = 32;
const SOURCE_MATRIX3D_BYTE_LENGTH = 48;
const SOURCE_OPEN_CONTAIN_FIRE_POINTS_BYTE_LENGTH =
  SOURCE_OPEN_CONTAIN_MAX_FIRE_POINTS * SOURCE_MATRIX3D_BYTE_LENGTH;
const SOURCE_OBJECT_ENTER_EXIT_TYPE_BYTE_LENGTH = 4;
const SOURCE_DEATH_TYPE_POISONED = 5;
const SOURCE_DEATH_TYPE_BY_NAME = new Map<string, number>([
  ['NORMAL', 0],
  ['NONE', 1],
  ['CRUSHED', 2],
  ['BURNED', 3],
  ['EXPLODED', 4],
  ['POISONED', 5],
  ['TOPPLED', 6],
  ['FLOODED', 7],
  ['SUICIDED', 8],
  ['LASERED', 9],
  ['DETONATED', 10],
  ['SPLATTED', 11],
  ['POISONED_BETA', 12],
  ['EXTRA_2', 13],
  ['EXTRA_3', 14],
  ['EXTRA_4', 15],
  ['EXTRA_5', 16],
  ['EXTRA_6', 17],
  ['EXTRA_7', 18],
  ['EXTRA_8', 19],
]);
const SOURCE_MINEFIELD_MAX_IMMUNITY = 3;
const SOURCE_FIRESTORM_MAX_SYSTEMS = 16;
const SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH = SOURCE_FIRESTORM_MAX_SYSTEMS * 4;
const SOURCE_WEAPON_STATUS_READY_TO_FIRE = 0;
const SOURCE_WEAPON_STATUS_OUT_OF_AMMO = 1;
const SOURCE_WEAPON_STATUS_BETWEEN_FIRING_SHOTS = 2;
const SOURCE_WEAPON_STATUS_RELOADING_CLIP = 3;
const SOURCE_WEAPON_NO_MAX_SHOTS_LIMIT = 0x7fffffff;
const SOURCE_WEAPON_UNLIMITED_CLIP_AMMO = 0x7fffffff;
const SOURCE_PHYSICS_FLAG_STICK_TO_GROUND = 0x0001;
const SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE = 0x0002;
const SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE = 0x0004;
const SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN = 0x0008;
const SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME = 0x0010;
const SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE = 0x0020;
const SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL = 0x0040;
const SOURCE_PHYSICS_FLAG_HAS_PITCH_ROLL_YAW = 0x0080;
const SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE = 0x0100;
const SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL = 0x0200;
const SOURCE_PHYSICS_FLAG_IS_IN_UPDATE = 0x0400;
const SOURCE_PHYSICS_FLAG_IS_STUNNED = 0x0800;
const SOURCE_PHYSICS_LIVE_OWNED_FLAG_MASK = SOURCE_PHYSICS_FLAG_STICK_TO_GROUND
  | SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE
  | SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE
  | SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN
  | SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME
  | SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE
  | SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL
  | SOURCE_PHYSICS_FLAG_HAS_PITCH_ROLL_YAW
  | SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE
  | SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL
  | SOURCE_PHYSICS_FLAG_IS_IN_UPDATE
  | SOURCE_PHYSICS_FLAG_IS_STUNNED;
const SOURCE_PHYSICS_TURNING_BYTE_LENGTH = 4;
const SOURCE_RAILROAD_BEHAVIOR_CURRENT_VERSION = 3;
const SOURCE_RAILROAD_PULL_INFO_CURRENT_VERSION = 1;
const SOURCE_RAILROAD_ENUM_BYTE_LENGTH = 4;
const SOURCE_WAVEGUIDE_CURRENT_VERSION = 1;
const SOURCE_WAVEGUIDE_MAX_SHAPE_POINTS = 64;
const SOURCE_WAVEGUIDE_MAX_SHAPE_EFFECTS = 3;
const SOURCE_COORD3D_BYTE_LENGTH = 12;
const SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH =
  SOURCE_WAVEGUIDE_MAX_SHAPE_POINTS * SOURCE_COORD3D_BYTE_LENGTH;
const SOURCE_WAVEGUIDE_SHAPE_EFFECTS_BYTE_LENGTH =
  SOURCE_WAVEGUIDE_MAX_SHAPE_POINTS * SOURCE_WAVEGUIDE_MAX_SHAPE_EFFECTS * 4;
const SOURCE_PROJECTILE_STREAM_MAX = 20;
const SOURCE_PROJECTILE_STREAM_MAX_ACTIVE = SOURCE_PROJECTILE_STREAM_MAX - 1;
const SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT = 4;
const SOURCE_BONE_FX_MAX_BONES = 8;
const SOURCE_BONE_FX_BONES_RESOLVED_BYTE_LENGTH = SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT;
const SOURCE_SLOW_DEATH_FLAG_ACTIVATED = 1 << 0;
const SOURCE_SLOW_DEATH_FLAG_MIDPOINT_EXECUTED = 1 << 1;
const SOURCE_SLOW_DEATH_FLAG_FLUNG_INTO_AIR = 1 << 2;
const SOURCE_SLOW_DEATH_FLAG_BOUNCED = 1 << 3;
const SOURCE_SLOW_DEATH_LIVE_OWNED_FLAG_MASK = SOURCE_SLOW_DEATH_FLAG_ACTIVATED
  | SOURCE_SLOW_DEATH_FLAG_MIDPOINT_EXECUTED
  | SOURCE_SLOW_DEATH_FLAG_FLUNG_INTO_AIR
  | SOURCE_SLOW_DEATH_FLAG_BOUNCED;
const SOURCE_MAX_NEUTRON_BLASTS = 9;
const SOURCE_SPAWN_POINT_MAX_POINTS = 10;
const SOURCE_FLAMMABLE_STATUS_NORMAL = 0;
const SOURCE_FLAMMABLE_STATUS_AFLAME = 1;
const SOURCE_FLAMMABLE_STATUS_BURNED = 2;
const SOURCE_BATTLE_PLAN_NONE = 0;
const SOURCE_BATTLE_PLAN_BOMBARDMENT = 1;
const SOURCE_BATTLE_PLAN_HOLD_THE_LINE = 2;
const SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY = 3;
const SOURCE_BATTLE_PLAN_STATUS_IDLE = 0;
const SOURCE_BATTLE_PLAN_STATUS_UNPACKING = 1;
const SOURCE_BATTLE_PLAN_STATUS_ACTIVE = 2;
const SOURCE_BATTLE_PLAN_STATUS_PACKING = 3;
const SOURCE_PRODUCTION_INVALID = 0;
const SOURCE_PRODUCTION_UNIT = 1;
const SOURCE_PRODUCTION_UPGRADE = 2;
const SOURCE_PRODUCTIONID_INVALID = 0;
const SOURCE_PRODUCTION_DOOR_INFO_BYTE_LENGTH = 64;
const SOURCE_DAMAGE_TYPE_UNRESISTABLE = 11;
const SOURCE_PLAYER_MASK_BYTE_LENGTH = 2;
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

type LiveSpecialPowerModuleProfile = MapEntity['specialPowerModules'] extends Map<string, infer T> ? T : never;
type LiveUpgradeModuleProfile = MapEntity['upgradeModules'] extends Array<infer T> ? T : never;

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
  gameLogicCoreState?: GameLogicCoreSaveState | null;
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
  sourceGameLogicImportState: GameLogicSourceGameLogicImportSaveState | null;
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
  polygonTriggerCount: number | null;
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

function buildSourceTeamIdByNameMap(
  teamFactoryState: GameLogicTeamFactorySaveState | null | undefined,
): Map<string, number> {
  const teamsByName = teamFactoryState?.state.scriptTeamsByName;
  const sourceTeamIdByName = new Map<string, number>();
  if (!(teamsByName instanceof Map)) {
    return sourceTeamIdByName;
  }
  for (const [teamName, team] of teamsByName) {
    if (typeof teamName !== 'string' || !team || typeof team !== 'object') {
      continue;
    }
    const normalizedTeamName = teamName.trim().toUpperCase();
    const sourceTeamId = Number((team as { sourceTeamId?: unknown }).sourceTeamId);
    if (!normalizedTeamName || !Number.isFinite(sourceTeamId)) {
      continue;
    }
    const normalizedSourceTeamId = Math.max(0, Math.trunc(sourceTeamId));
    if (normalizedSourceTeamId > 0) {
      sourceTeamIdByName.set(normalizedTeamName, normalizedSourceTeamId);
    }
  }
  return sourceTeamIdByName;
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

function encodeSourceControlBarOverrideName(
  override: GameLogicControlBarOverrideSaveState,
): string | null {
  const commandSetName = override.commandSetName.trim().toUpperCase();
  const tsSlot = Math.trunc(override.slot);
  if (!commandSetName || tsSlot < 1 || tsSlot > 18) {
    return null;
  }
  const sourceSlot = tsSlot - 1;
  return `${String.fromCharCode('0'.charCodeAt(0) + sourceSlot)}${commandSetName}`;
}

function decodeSourceControlBarOverrideName(
  name: string,
): { commandSetName: string; slot: number } | null {
  if (name.length < 2) {
    return null;
  }
  const sourceSlot = name.charCodeAt(0) - '0'.charCodeAt(0);
  if (sourceSlot < 0 || sourceSlot >= 18) {
    return null;
  }
  const commandSetName = name.slice(1).trim().toUpperCase();
  if (!commandSetName) {
    return null;
  }
  return {
    commandSetName,
    slot: sourceSlot + 1,
  };
}

function buildSourceControlBarOverrideMapEntries(
  overrides: readonly GameLogicControlBarOverrideSaveState[] | null | undefined,
): ParsedSourceGameLogicControlBarOverrideState[] {
  const entries: ParsedSourceGameLogicControlBarOverrideState[] = [];
  for (const override of overrides ?? []) {
    if (!override || typeof override.commandSetName !== 'string' || !Number.isFinite(override.slot)) {
      continue;
    }
    const name = encodeSourceControlBarOverrideName(override);
    if (name === null) {
      continue;
    }
    entries.push({
      name,
      commandButtonName: typeof override.commandButtonName === 'string'
        ? (override.commandButtonName.trim().toUpperCase() || null)
        : null,
    });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function buildCoreControlBarOverridesFromSourceEntries(
  entries: readonly ParsedSourceGameLogicControlBarOverrideState[],
): GameLogicControlBarOverrideSaveState[] {
  const overrides: GameLogicControlBarOverrideSaveState[] = [];
  for (const entry of entries) {
    const decoded = decodeSourceControlBarOverrideName(entry.name);
    if (!decoded) {
      continue;
    }
    overrides.push({
      commandSetName: decoded.commandSetName,
      slot: decoded.slot,
      commandButtonName: entry.commandButtonName === null
        ? null
        : entry.commandButtonName.trim().toUpperCase(),
    });
  }
  return overrides.sort((left, right) => {
    const commandSetCompare = left.commandSetName.localeCompare(right.commandSetName);
    if (commandSetCompare !== 0) {
      return commandSetCompare;
    }
    return left.slot - right.slot;
  });
}

function buildSourceGameLogicPolygonTriggerStates(
  mapData: MapDataJSON | null | undefined,
  terrainLogicState: GameLogicTerrainLogicSaveState | null | undefined,
): ParsedSourceGameLogicPolygonTriggerState[] {
  const currentWaterHeightByTriggerId = new Map<number, number>();
  for (const waterUpdate of terrainLogicState?.waterUpdates ?? []) {
    if (!waterUpdate || !Number.isFinite(waterUpdate.triggerId) || !Number.isFinite(waterUpdate.currentHeight)) {
      continue;
    }
    currentWaterHeightByTriggerId.set(
      Math.trunc(waterUpdate.triggerId),
      waterUpdate.currentHeight,
    );
  }

  return (mapData?.triggers ?? [])
    .filter((trigger) =>
      trigger
      && Number.isFinite(trigger.id)
      && Array.isArray(trigger.points)
      && trigger.points.length >= 2)
    .map((trigger) => {
      const triggerId = Math.trunc(trigger.id);
      const currentWaterHeight = currentWaterHeightByTriggerId.get(triggerId);
      const points = trigger.points.map((point) => ({
        x: point.x,
        y: point.y,
        z: currentWaterHeight ?? point.z,
      }));
      return {
        triggerId,
        snapshot: buildSourcePolygonTriggerSnapshotState(points),
      };
    });
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
    polygonTriggerCount: parsed.polygonTriggers.length,
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

function buildSourceGameLogicImportSaveState(
  state: ParsedSourceGameLogicChunkState | null | undefined,
  objectIdCounter: number,
): GameLogicSourceGameLogicImportSaveState | null {
  if (!state) {
    return null;
  }
  return {
    version: 1,
    sourceChunkVersion: state.version,
    frameCounter: state.frameCounter,
    objectIdCounter: Math.max(1, Math.trunc(objectIdCounter) || 1),
    objects: state.objects.map((object) => ({
      templateName: object.templateName,
      state: object.state,
    })),
    caveTrackers: state.caveTrackers,
    sellingEntities: state.sellingEntities,
    buildableOverrides: state.buildableOverrides,
    scriptScoringEnabled: state.scriptScoringEnabled,
    rankLevelLimit: state.rankLevelLimit,
    showBehindBuildingMarkers: state.showBehindBuildingMarkers,
    drawIconUI: state.drawIconUI,
    showDynamicLOD: state.showDynamicLOD,
    scriptHulkMaxLifetimeOverride: state.scriptHulkMaxLifetimeOverride,
    controlBarOverrides: buildCoreControlBarOverridesFromSourceEntries(state.controlBarOverrideEntries),
    rankPointsToAddAtGameStart: state.rankPointsToAddAtGameStart,
    superweaponRestriction: state.superweaponRestriction,
  };
}

function createFreshSourceGameLogicChunkState(
  campaignState: RuntimeSaveCampaignState,
  mapData?: MapDataJSON | null,
  terrainLogicState?: GameLogicTerrainLogicSaveState | null,
): ParsedSourceGameLogicChunkState {
  return {
    version: SOURCE_GAME_LOGIC_SNAPSHOT_VERSION,
    frameCounter: 0,
    objectTocEntries: [],
    objects: [],
    campaignState: {
      version: campaignState.version,
      currentCampaign: campaignState.currentCampaign,
      currentMission: campaignState.currentMission,
      currentRankPoints: campaignState.currentRankPoints,
      difficulty: campaignState.difficulty,
      isChallengeCampaign: campaignState.isChallengeCampaign,
      playerTemplateNum: campaignState.playerTemplateNum,
      challengeGameInfoState: campaignState.challengeGameInfoState,
    },
    caveTrackers: [],
    scriptScoringEnabled: true,
    polygonTriggers: buildSourceGameLogicPolygonTriggerStates(mapData, terrainLogicState),
    rankLevelLimit: null,
    sellingEntities: [],
    buildableOverrides: [],
    showBehindBuildingMarkers: false,
    drawIconUI: true,
    showDynamicLOD: true,
    scriptHulkMaxLifetimeOverride: -1,
    controlBarOverrideEntries: [],
    rankPointsToAddAtGameStart: 0,
    superweaponRestriction: 0,
  };
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

function tryParseSourceFireWeaponWhenDeadBehaviorBlockData(
  data: Uint8Array,
): { upgradeExecuted: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-fire-weapon-when-dead-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferSourceBehaviorModuleBase(xferLoad);
    const upgradeMuxVersion = xferLoad.xferVersion(1);
    if (upgradeMuxVersion !== 1) {
      return null;
    }
    const upgradeExecuted = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? { upgradeExecuted }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceFireWeaponWhenDeadUpgradeExecuted(
  entity: MapEntity,
  moduleIndex: number,
  preservedUpgradeExecuted: boolean,
): boolean {
  const states = (entity as MapEntity & { fireWeaponWhenDeadUpgradeExecuted?: unknown }).fireWeaponWhenDeadUpgradeExecuted;
  if (Array.isArray(states) && typeof states[moduleIndex] === 'boolean') {
    return states[moduleIndex];
  }
  return preservedUpgradeExecuted;
}

function buildSourceFireWeaponWhenDeadBehaviorBlockData(upgradeExecuted: boolean): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-fire-weapon-when-dead-behavior');
  try {
    saver.xferVersion(1);
    xferSourceBehaviorModuleBase(saver);
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFireOclAfterCooldownUpdateBlockData(
  currentFrame: number,
  upgradeExecuted: boolean,
  state: { valid: boolean; consecutiveShots: number; startFrame: number; upgradeExecuted?: boolean },
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-fire-ocl-after-cooldown-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferVersion(1);
    saver.xferBool(state.upgradeExecuted ?? upgradeExecuted);
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

function buildSourceLifetimeUpdateBlockData(entity: MapEntity): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-lifetime-update');
  try {
    const dieFrame = Math.max(0, Math.trunc(entity.lifetimeDieFrame ?? 0)) >>> 0;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(dieFrame),
    ));
    saver.xferUnsignedInt(dieFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceDeletionUpdateBlockData(entity: MapEntity): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-deletion-update');
  try {
    const dieFrame = Math.max(0, Math.trunc(entity.deletionDieFrame ?? 0)) >>> 0;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(dieFrame),
    ));
    saver.xferUnsignedInt(dieFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

type SourceHeightDieUpdateBlockState = {
  hasDied: boolean;
  particlesDestroyed: boolean;
  lastPosition: { x: number; y: number; z: number };
  earliestDeathFrame: number;
};

function createDefaultSourceHeightDieUpdateBlockState(): SourceHeightDieUpdateBlockState {
  return {
    hasDied: false,
    particlesDestroyed: false,
    lastPosition: { x: -1, y: -1, z: -1 },
    earliestDeathFrame: 0xffffffff,
  };
}

function tryParseSourceHeightDieUpdateBlockData(
  data: Uint8Array,
): SourceHeightDieUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-height-die-update');
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
    const hasDied = xferLoad.xferBool(false);
    const particlesDestroyed = xferLoad.xferBool(false);
    const lastPosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const earliestDeathFrame = version >= 2 ? xferLoad.xferUnsignedInt(0) : 0;
    return xferLoad.getRemaining() === 0
      ? {
          hasDied,
          particlesDestroyed,
          lastPosition,
          earliestDeathFrame,
        }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceHeightDieUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: SourceHeightDieUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-height-die-update');
  try {
    const earliestDeathFrame = entity.heightDieActiveFrame > 0
      ? (Math.max(0, Math.trunc(entity.heightDieActiveFrame)) >>> 0)
      : (Math.max(0, Math.trunc(preservedState?.earliestDeathFrame ?? 0xffffffff)) >>> 0);
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferBool(entity.heightDieHasDied === true);
    saver.xferBool(entity.heightDieParticlesDestroyed === true);
    saver.xferCoord3D({
      x: Number.isFinite(entity.heightDieLastPositionX)
        ? entity.heightDieLastPositionX
        : preservedState?.lastPosition.x ?? -1,
      y: Number.isFinite(entity.heightDieLastPositionZ)
        ? entity.heightDieLastPositionZ
        : preservedState?.lastPosition.y ?? -1,
      z: Number.isFinite(entity.heightDieLastY)
        ? entity.heightDieLastY
        : preservedState?.lastPosition.z ?? -1,
    });
    saver.xferUnsignedInt(earliestDeathFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

type SourceStickyBombUpdateBlockState = {
  nextCallFrameAndPhase: number;
  targetId: number;
  dieFrame: number;
  nextPingFrame: number;
};

function createDefaultSourceStickyBombUpdateBlockState(): SourceStickyBombUpdateBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    targetId: 0,
    dieFrame: 0,
    nextPingFrame: 0,
  };
}

function tryParseSourceStickyBombUpdateBlockData(data: Uint8Array): SourceStickyBombUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-sticky-bomb-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const targetId = xferLoad.xferObjectID(0);
    const dieFrame = xferLoad.xferUnsignedInt(0);
    const nextPingFrame = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        targetId,
        dieFrame,
        nextPingFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceStickyBombUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceStickyBombUpdateBlockState = createDefaultSourceStickyBombUpdateBlockState(),
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-sticky-bomb-update');
  try {
    const dieFrame = sourceFlammableUnsignedFrame(entity.stickyBombDieFrame, preservedState.dieFrame);
    const targetId = normalizeSourceObjectId(entity.stickyBombTargetId ?? preservedState.targetId);
    let nextPingFrame: number;
    if (Number.isFinite(entity.stickyBombNextPingFrame) && entity.stickyBombNextPingFrame > 0) {
      nextPingFrame = Math.max(0, Math.trunc(entity.stickyBombNextPingFrame)) >>> 0;
    } else if (dieFrame > 0) {
      const remainingFrames = Math.max(0, dieFrame - (currentFrame >>> 0));
      const pings = Math.trunc(remainingFrames / 30);
      nextPingFrame = (dieFrame - (pings * 30)) >>> 0;
    } else {
      nextPingFrame = preservedState.nextPingFrame;
    }
    const nextCallFrameAndPhase = targetId > 0 || dieFrame > 0 || nextPingFrame > 0
      ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
      : preservedState.nextCallFrameAndPhase;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    saver.xferObjectID(targetId);
    saver.xferUnsignedInt(dieFrame);
    saver.xferUnsignedInt(nextPingFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceCleanupHazardUpdateBlockData(
  data: Uint8Array,
): { position: { x: number; y: number; z: number }; moveRange: number } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-cleanup-hazard-update');
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
    xferLoad.xferObjectID(0);
    xferLoad.xferBool(false);
    xferLoad.xferInt(0);
    xferLoad.xferInt(0);
    const position = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const moveRange = xferLoad.xferReal(0);
    return xferLoad.getRemaining() === 0 ? { position, moveRange } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function createDefaultSourceCleanupHazardUpdateBlockState(): {
  position: { x: number; y: number; z: number };
  moveRange: number;
} {
  return {
    position: { x: 0, y: 0, z: 0 },
    moveRange: 0,
  };
}

function buildSourceCleanupHazardUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: { position: { x: number; y: number; z: number }; moveRange: number },
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-cleanup-hazard-update');
  try {
    const state = entity.cleanupHazardState;
    const cleanupAreaMoveRange = state?.cleanupAreaMoveRange;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferObjectID(Math.max(0, Math.trunc(state?.bestTargetId ?? 0)) >>> 0);
    saver.xferBool(state?.inRange === true);
    saver.xferInt(Math.trunc(state?.nextScanFrame ?? 0));
    saver.xferInt(Math.max(0, Math.trunc(state?.nextShotAvailableFrame ?? currentFrame) - currentFrame));
    saver.xferCoord3D(state?.cleanupAreaPosition ?? preservedState.position);
    saver.xferReal(Number.isFinite(cleanupAreaMoveRange)
      ? Math.max(0, cleanupAreaMoveRange as number)
      : preservedState.moveRange);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceDemoTrapUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-demo-trap-update');
  try {
    const nextScanFrames = entity.demoTrapNextScanFrame > currentFrame
      ? Math.trunc(entity.demoTrapNextScanFrame - currentFrame)
      : 0;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferInt(nextScanFrames);
    saver.xferBool(entity.demoTrapDetonated === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCommandButtonHuntUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-command-button-hunt-update');
  try {
    const buttonName = entity.commandButtonHuntMode !== 'NONE'
      ? entity.commandButtonHuntButtonName.trim()
      : '';
    const nextCallFrame = buttonName.length > 0
      ? Math.max(currentFrame + 1, Math.trunc(entity.commandButtonHuntNextScanFrame))
      : SOURCE_FRAME_FOREVER;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferAsciiString(buttonName);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAutoDepositUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-auto-deposit-update');
  try {
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.autoDepositNextFrame)));
    saver.xferBool(entity.autoDepositCaptureBonusPending === true);
    saver.xferBool(entity.autoDepositInitialized === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceDynamicShroudClearingRangeUpdateBlockData(
  data: Uint8Array,
): { decalsCreated: boolean; visionChangePerInterval: number } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-dynamic-shroud-clearing-range-update');
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
    xferLoad.xferInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferUnsignedInt(0);
    const decalsCreated = xferLoad.xferBool(false);
    const visionChangePerInterval = xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    xferLoad.xferReal(0);
    return xferLoad.getRemaining() === 0
      ? { decalsCreated, visionChangePerInterval }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceDynamicShroudClearingRangeUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-dynamic-shroud-clearing-range-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferInt(Math.trunc(entity.dynamicShroudStateCountdown));
    saver.xferInt(Math.trunc(entity.dynamicShroudTotalFrames));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.dynamicShroudGrowStartDeadline)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.dynamicShroudSustainDeadline)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.dynamicShroudShrinkStartDeadline)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.dynamicShroudDoneForeverFrame)));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.dynamicShroudChangeIntervalCountdown)));
    saver.xferBool(entity.dynamicShroudDecalsCreated === true);
    saver.xferReal(entity.dynamicShroudVisionChangePerInterval);
    saver.xferReal(entity.dynamicShroudNativeClearingRange);
    saver.xferReal(entity.dynamicShroudCurrentClearingRange);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceStealthUpdateBlockData(
  data: Uint8Array,
): {
  stealthAllowedFrame: number;
  detectionExpiresFrame: number;
  enabled: boolean;
  pulsePhaseRate: number;
  pulsePhase: number;
  disguiseAsPlayerIndex: number;
  disguiseTemplateName: string;
  disguiseTransitionFrames: number;
  disguiseHalfpointReached: boolean;
  transitioningToDisguise: boolean;
  disguised: boolean;
  framesGranted: number;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-stealth-update');
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
    const stealthAllowedFrame = xferLoad.xferUnsignedInt(0);
    const detectionExpiresFrame = xferLoad.xferUnsignedInt(0);
    const enabled = xferLoad.xferBool(false);
    const pulsePhaseRate = xferLoad.xferReal(0);
    const pulsePhase = xferLoad.xferReal(0);
    const disguiseAsPlayerIndex = xferLoad.xferInt(-1);
    const disguiseTemplateName = xferLoad.xferAsciiString('');
    const disguiseTransitionFrames = xferLoad.xferUnsignedInt(0);
    const disguiseHalfpointReached = xferLoad.xferBool(false);
    const transitioningToDisguise = xferLoad.xferBool(false);
    const disguised = xferLoad.xferBool(false);
    const framesGranted = version >= 2 ? xferLoad.xferUnsignedInt(0) : 0;
    return xferLoad.getRemaining() === 0
      ? {
        stealthAllowedFrame,
        detectionExpiresFrame,
        enabled,
        pulsePhaseRate,
        pulsePhase,
        disguiseAsPlayerIndex,
        disguiseTemplateName,
        disguiseTransitionFrames,
        disguiseHalfpointReached,
        transitioningToDisguise,
        disguised,
        framesGranted,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceStealthUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: {
    stealthAllowedFrame: number;
    detectionExpiresFrame: number;
    enabled: boolean;
    pulsePhaseRate: number;
    pulsePhase: number;
    disguiseAsPlayerIndex: number;
    disguiseTemplateName: string;
    disguiseTransitionFrames: number;
    disguiseHalfpointReached: boolean;
    transitioningToDisguise: boolean;
    disguised: boolean;
    framesGranted: number;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-stealth-update');
  try {
    const canStealth = entity.objectStatusFlags.has('CAN_STEALTH');
    const isStealthed = entity.objectStatusFlags.has('STEALTHED');
    const isDisguised = entity.objectStatusFlags.has('DISGUISED');
    const enabled = entity.stealthEnabled === true
      || entity.temporaryStealthGrant === true
      || isStealthed
      || isDisguised
      || (!entity.stealthProfile ? false : canStealth);
    const stealthAllowedFrame = !enabled && !canStealth
      ? Math.max(0, Math.trunc(preservedState?.stealthAllowedFrame ?? SOURCE_FRAME_FOREVER))
      : Math.max(
        0,
        Math.trunc(
          entity.stealthDelayRemaining > 0 && !isStealthed
            ? currentFrame + entity.stealthDelayRemaining
            : currentFrame,
        ),
      );
    const disguiseAsPlayerIndex = isDisguised
      ? Math.trunc(entity.stealthDisguisePlayerIndex ?? preservedState?.disguiseAsPlayerIndex ?? -1)
      : -1;
    const disguiseTemplateName = isDisguised
      ? (entity.disguiseTemplateName ?? '')
      : '';
    const disguiseTransitionFrames = Math.max(
      0,
      Math.trunc(entity.stealthDisguiseTransitionFrames ?? preservedState?.disguiseTransitionFrames ?? 0),
    );
    const disguiseHalfpointReached = entity.stealthDisguiseHalfpointReached
      ?? preservedState?.disguiseHalfpointReached
      ?? false;
    const transitioningToDisguise = entity.stealthTransitioningToDisguise
      ?? preservedState?.transitioningToDisguise
      ?? false;
    const framesGranted = entity.temporaryStealthGrant && entity.temporaryStealthExpireFrame > currentFrame
      ? entity.temporaryStealthExpireFrame - currentFrame
      : 0;
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(enabled ? currentFrame + 1 : SOURCE_FRAME_FOREVER),
    ));
    saver.xferUnsignedInt(stealthAllowedFrame);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(entity.detectedUntilFrame)));
    saver.xferBool(enabled);
    saver.xferReal(entity.stealthPulsePhaseRate ?? preservedState?.pulsePhaseRate ?? SOURCE_STEALTH_UPDATE_PULSE_PHASE_RATE);
    saver.xferReal(entity.stealthPulsePhase ?? preservedState?.pulsePhase ?? 0);
    saver.xferInt(disguiseAsPlayerIndex);
    saver.xferAsciiString(disguiseTemplateName);
    saver.xferUnsignedInt(disguiseTransitionFrames);
    saver.xferBool(disguiseHalfpointReached);
    saver.xferBool(transitioningToDisguise);
    saver.xferBool(isDisguised);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(framesGranted)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceStealthDetectorUpdateBlockData(
  data: Uint8Array,
): { enabled: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-stealth-detector-update');
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
    const enabled = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0 ? { enabled } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceStealthDetectorUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-stealth-detector-update');
  try {
    const nextCallFrame = entity.detectorEnabled
      ? Math.max(currentFrame + 1, Math.trunc(entity.detectorNextScanFrame))
      : SOURCE_FRAME_FOREVER;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferBool(entity.detectorEnabled === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourcePhysicsBehaviorBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  yawRate: number;
  rollRate: number;
  pitchRate: number;
  accel: Coord3D;
  prevAccel: Coord3D;
  vel: Coord3D;
  turningBytes: Uint8Array;
  ignoreCollisionsWith: number;
  flags: number;
  mass: number;
  currentOverlap: number;
  previousOverlap: number;
  motiveForceExpires: number;
  extraBounciness: number;
  extraFriction: number;
  velMag: number;
}

interface SourceRailroadBehaviorPullInfoBlockState {
  version: number;
  direction: number;
  speed: number;
  trackDistance: number;
  towHitchPosition: Coord3D;
  mostRecentSpecialPointHandle: number;
  previousWaypoint: number;
  currentWaypoint: number;
}

interface SourceRailroadBehaviorBlockState {
  version: number;
  physics: SourcePhysicsBehaviorBlockState;
  nextStationTaskBytes: Uint8Array;
  trailerId: number;
  currentPointHandle: number;
  waitAtStationTimer: number;
  carriagesCreated: boolean;
  hasEverBeenHitched: boolean;
  waitingInWings: boolean;
  endOfLine: boolean;
  isLocomotive: boolean;
  isLeadCarraige: boolean;
  wantsToBeLeadCarraige: number;
  disembark: boolean;
  inTunnel: boolean;
  conductorStateBytes: Uint8Array;
  anchorWaypointIdBytes: Uint8Array;
  pullInfo: SourceRailroadBehaviorPullInfoBlockState;
  conductorPullInfo: SourceRailroadBehaviorPullInfoBlockState;
  held: boolean;
}

interface SourceWaveGuideUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  activeFrame: number;
  needDisable: boolean;
  initialized: boolean;
  shapePointsBytes: Uint8Array;
  transformedShapePointsBytes: Uint8Array;
  shapeEffectsBytes: Uint8Array;
  shapePointCount: number;
  splashSoundFrame: number;
  finalDestination: Coord3D;
}

function createDefaultSourcePhysicsBehaviorBlockState(entity: MapEntity): SourcePhysicsBehaviorBlockState {
  const profile = entity.physicsBehaviorProfile;
  let flags = SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE;
  flags = setSourcePhysicsFlag(flags, SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE, profile?.allowBouncing === true);
  flags = setSourcePhysicsFlag(flags, SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE, profile?.allowCollideForce !== false);
  return {
    version: 2,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    yawRate: 0,
    rollRate: 0,
    pitchRate: 0,
    accel: { x: 0, y: 0, z: 0 },
    prevAccel: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    turningBytes: new Uint8Array(SOURCE_PHYSICS_TURNING_BYTE_LENGTH),
    ignoreCollisionsWith: 0,
    flags,
    mass: sourcePhysicsFinite(profile?.mass, 1),
    currentOverlap: 0,
    previousOverlap: 0,
    motiveForceExpires: 0,
    extraBounciness: 0,
    extraFriction: 0,
    velMag: 0,
  };
}

function createDefaultSourceRailroadBehaviorPullInfoBlockState(): SourceRailroadBehaviorPullInfoBlockState {
  return {
    version: SOURCE_RAILROAD_PULL_INFO_CURRENT_VERSION,
    direction: 1,
    speed: 0,
    trackDistance: 0,
    towHitchPosition: { x: 0, y: 0, z: 0 },
    mostRecentSpecialPointHandle: 0x00facade,
    previousWaypoint: 0x00facade,
    currentWaypoint: 0x00facade,
  };
}

function createDefaultSourceRailroadBehaviorBlockState(entity: MapEntity): SourceRailroadBehaviorBlockState {
  const pullInfo = createDefaultSourceRailroadBehaviorPullInfoBlockState();
  return {
    version: SOURCE_RAILROAD_BEHAVIOR_CURRENT_VERSION,
    physics: createDefaultSourcePhysicsBehaviorBlockState(entity),
    nextStationTaskBytes: buildSourceRawInt32Bytes(0),
    trailerId: 0,
    currentPointHandle: 0x00facade,
    waitAtStationTimer: 0,
    carriagesCreated: false,
    hasEverBeenHitched: false,
    waitingInWings: true,
    endOfLine: false,
    isLocomotive: false,
    isLeadCarraige: false,
    wantsToBeLeadCarraige: 0,
    disembark: false,
    inTunnel: false,
    conductorStateBytes: buildSourceRawInt32Bytes(0),
    anchorWaypointIdBytes: buildSourceRawInt32Bytes(0x7fffffff),
    pullInfo,
    conductorPullInfo: { ...pullInfo },
    held: false,
  };
}

function createDefaultSourceWaveGuideUpdateBlockState(currentFrame: number): SourceWaveGuideUpdateBlockState {
  return {
    version: SOURCE_WAVEGUIDE_CURRENT_VERSION,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    activeFrame: 0,
    needDisable: true,
    initialized: false,
    shapePointsBytes: new Uint8Array(SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH),
    transformedShapePointsBytes: new Uint8Array(SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH),
    shapeEffectsBytes: new Uint8Array(SOURCE_WAVEGUIDE_SHAPE_EFFECTS_BYTE_LENGTH),
    shapePointCount: 0,
    splashSoundFrame: 0,
    finalDestination: { x: 0, y: 0, z: 0 },
  };
}

function sourcePhysicsFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sourcePhysicsFlag(flags: number, bit: number): boolean {
  return (flags & bit) !== 0;
}

function setSourcePhysicsFlag(flags: number, bit: number, enabled: boolean): number {
  return enabled ? (flags | bit) : (flags & ~bit);
}

function buildSourcePhysicsBehaviorFlags(
  preservedFlags: number,
  entity: MapEntity,
  yawRate: number,
  rollRate: number,
  pitchRate: number,
): number {
  const state = entity.physicsBehaviorState;
  const profile = entity.physicsBehaviorProfile;
  let flags = preservedFlags & ~SOURCE_PHYSICS_LIVE_OWNED_FLAG_MASK;
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN,
    typeof state?.updateEverRun === 'boolean'
      ? state.updateEverRun
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_UPDATE_EVER_RUN),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_STICK_TO_GROUND,
    typeof state?.stickToGround === 'boolean'
      ? state.stickToGround
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_STICK_TO_GROUND),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE,
    typeof profile?.allowBouncing === 'boolean'
      ? profile.allowBouncing
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_ALLOW_BOUNCE),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME,
    typeof state?.wasAirborneLastFrame === 'boolean'
      ? state.wasAirborneLastFrame
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_WAS_AIRBORNE_LAST_FRAME),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE,
    typeof profile?.allowCollideForce === 'boolean'
      ? profile.allowCollideForce
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_ALLOW_COLLIDE_FORCE),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL,
    typeof state?.allowToFall === 'boolean'
      ? state.allowToFall
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_ALLOW_TO_FALL),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_HAS_PITCH_ROLL_YAW,
    typeof state?.hasPitchRollYaw === 'boolean'
      ? state.hasPitchRollYaw
      : (yawRate !== 0 || rollRate !== 0 || pitchRate !== 0),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE,
    typeof state?.applyFriction2dWhenAirborne === 'boolean'
      ? state.applyFriction2dWhenAirborne
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_APPLY_FRICTION2D_WHEN_AIRBORNE),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE,
    typeof state?.immuneToFallingDamage === 'boolean'
      ? state.immuneToFallingDamage
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_IMMUNE_TO_FALLING_DAMAGE),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL,
    typeof state?.isInFreeFall === 'boolean'
      ? state.isInFreeFall
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_IS_IN_FREEFALL),
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_IS_IN_UPDATE,
    typeof state?.isInUpdate === 'boolean' ? state.isInUpdate : false,
  );
  flags = setSourcePhysicsFlag(
    flags,
    SOURCE_PHYSICS_FLAG_IS_STUNNED,
    typeof state?.isStunned === 'boolean'
      ? state.isStunned
      : sourcePhysicsFlag(preservedFlags, SOURCE_PHYSICS_FLAG_IS_STUNNED),
  );
  return flags | 0;
}

function readSourcePhysicsBehaviorBlockState(
  xferLoad: XferLoad,
): SourcePhysicsBehaviorBlockState | null {
  const version = xferLoad.xferVersion(2);
  if (version !== 1 && version !== 2) {
    return null;
  }
  xferLoad.xferVersion(1);
  xferLoad.xferVersion(1);
  xferLoad.xferVersion(1);
  xferLoad.xferVersion(1);
  const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
  const yawRate = xferLoad.xferReal(0);
  const rollRate = xferLoad.xferReal(0);
  const pitchRate = xferLoad.xferReal(0);
  const accel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
  const prevAccel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
  const vel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
  if (version < 2) {
    xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
  }
  const turningBytes = xferLoad.xferUser(new Uint8Array(SOURCE_PHYSICS_TURNING_BYTE_LENGTH));
  const ignoreCollisionsWith = xferLoad.xferObjectID(0);
  const flags = xferLoad.xferInt(0);
  const mass = xferLoad.xferReal(0);
  const currentOverlap = xferLoad.xferObjectID(0);
  const previousOverlap = xferLoad.xferObjectID(0);
  const motiveForceExpires = xferLoad.xferUnsignedInt(0);
  const extraBounciness = xferLoad.xferReal(0);
  const extraFriction = xferLoad.xferReal(0);
  const velMag = xferLoad.xferReal(0);
  return {
    version,
    nextCallFrameAndPhase,
    yawRate,
    rollRate,
    pitchRate,
    accel,
    prevAccel,
    vel,
    turningBytes,
    ignoreCollisionsWith,
    flags,
    mass,
    currentOverlap,
    previousOverlap,
    motiveForceExpires,
    extraBounciness,
    extraFriction,
    velMag,
  };
}

function tryParseSourcePhysicsBehaviorBlockData(
  data: Uint8Array,
): SourcePhysicsBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-physics-behavior');
  try {
    const state = readSourcePhysicsBehaviorBlockState(xferLoad);
    return state && xferLoad.getRemaining() === 0 ? state : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function writeSourcePhysicsBehaviorBlockData(
  saver: XferSave,
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourcePhysicsBehaviorBlockState,
): void {
  const state = entity.physicsBehaviorState;
  const profile = entity.physicsBehaviorProfile;
  const yawRate = sourcePhysicsFinite(state?.yawRate, preservedState.yawRate);
  const rollRate = sourcePhysicsFinite(state?.rollRate, preservedState.rollRate);
  const pitchRate = sourcePhysicsFinite(state?.pitchRate, preservedState.pitchRate);
  const accel = {
    x: sourcePhysicsFinite(state?.accelX, preservedState.accel.x),
    y: sourcePhysicsFinite(state?.accelZ, preservedState.accel.y),
    z: sourcePhysicsFinite(state?.accelY, preservedState.accel.z),
  };
  const prevAccel = {
    x: sourcePhysicsFinite(state?.prevAccelX, preservedState.prevAccel.x),
    y: sourcePhysicsFinite(state?.prevAccelZ, preservedState.prevAccel.y),
    z: sourcePhysicsFinite(state?.prevAccelY, preservedState.prevAccel.z),
  };
  const vel = {
    x: sourcePhysicsFinite(state?.velX, preservedState.vel.x),
    y: sourcePhysicsFinite(state?.velZ, preservedState.vel.y),
    z: sourcePhysicsFinite(state?.velY, preservedState.vel.z),
  };
  const turning = state?.turning;
  const turningBytes = Number.isFinite(turning)
    ? buildSourceRawInt32Bytes(Math.trunc(turning as number))
    : (
      preservedState.turningBytes.byteLength === SOURCE_PHYSICS_TURNING_BYTE_LENGTH
        ? preservedState.turningBytes
        : new Uint8Array(SOURCE_PHYSICS_TURNING_BYTE_LENGTH)
    );
  saver.xferVersion(2);
  saver.xferUser(buildSourceUpdateModuleBaseBlockData(
    buildSourceUpdateModuleWakeFrame(currentFrame + 1),
  ));
  saver.xferReal(yawRate);
  saver.xferReal(rollRate);
  saver.xferReal(pitchRate);
  saver.xferCoord3D(accel);
  saver.xferCoord3D(prevAccel);
  saver.xferCoord3D(vel);
  saver.xferUser(turningBytes);
  saver.xferObjectID(Math.max(0, Math.trunc(
    sourcePhysicsFinite(state?.ignoreCollisionsWith, preservedState.ignoreCollisionsWith),
  )) >>> 0);
  saver.xferInt(buildSourcePhysicsBehaviorFlags(
    preservedState.flags,
    entity,
    yawRate,
    rollRate,
    pitchRate,
  ));
  saver.xferReal(sourcePhysicsFinite(profile?.mass, preservedState.mass));
  saver.xferObjectID(Math.max(0, Math.trunc(
    sourcePhysicsFinite(state?.currentOverlap, preservedState.currentOverlap),
  )) >>> 0);
  saver.xferObjectID(Math.max(0, Math.trunc(
    sourcePhysicsFinite(state?.previousOverlap, preservedState.previousOverlap),
  )) >>> 0);
  saver.xferUnsignedInt(Math.max(0, Math.trunc(
    sourcePhysicsFinite(state?.motiveForceExpires, preservedState.motiveForceExpires),
  )) >>> 0);
  saver.xferReal(sourcePhysicsFinite(state?.extraBounciness, preservedState.extraBounciness));
  saver.xferReal(sourcePhysicsFinite(state?.extraFriction, preservedState.extraFriction));
  saver.xferReal(sourcePhysicsFinite(state?.velMag, preservedState.velMag));
}

function buildSourcePhysicsBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourcePhysicsBehaviorBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-physics-behavior');
  try {
    writeSourcePhysicsBehaviorBlockData(saver, entity, currentFrame, preservedState);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function readSourceRailroadBehaviorPullInfoBlockState(
  xferLoad: XferLoad,
): SourceRailroadBehaviorPullInfoBlockState | null {
  const version = xferLoad.xferVersion(SOURCE_RAILROAD_PULL_INFO_CURRENT_VERSION);
  if (version !== SOURCE_RAILROAD_PULL_INFO_CURRENT_VERSION) {
    return null;
  }
  return {
    version,
    direction: xferLoad.xferReal(0),
    speed: xferLoad.xferReal(0),
    trackDistance: xferLoad.xferReal(0),
    towHitchPosition: xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }),
    mostRecentSpecialPointHandle: xferLoad.xferInt(0),
    previousWaypoint: xferLoad.xferUnsignedInt(0),
    currentWaypoint: xferLoad.xferUnsignedInt(0),
  };
}

function tryParseSourceRailroadBehaviorBlockData(
  data: Uint8Array,
): SourceRailroadBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-railroad-behavior');
  try {
    const version = xferLoad.xferVersion(SOURCE_RAILROAD_BEHAVIOR_CURRENT_VERSION);
    if (version !== 2 && version !== SOURCE_RAILROAD_BEHAVIOR_CURRENT_VERSION) {
      return null;
    }
    const physics = readSourcePhysicsBehaviorBlockState(xferLoad);
    if (!physics) {
      return null;
    }
    const nextStationTaskBytes = xferLoad.xferUser(new Uint8Array(SOURCE_RAILROAD_ENUM_BYTE_LENGTH));
    const trailerId = xferLoad.xferObjectID(0);
    const currentPointHandle = xferLoad.xferInt(0);
    const waitAtStationTimer = xferLoad.xferInt(0);
    const carriagesCreated = xferLoad.xferBool(false);
    const hasEverBeenHitched = xferLoad.xferBool(false);
    const waitingInWings = xferLoad.xferBool(false);
    const endOfLine = xferLoad.xferBool(false);
    const isLocomotive = xferLoad.xferBool(false);
    const isLeadCarraige = xferLoad.xferBool(false);
    const wantsToBeLeadCarraige = xferLoad.xferInt(0);
    const disembark = xferLoad.xferBool(false);
    const inTunnel = xferLoad.xferBool(false);
    const conductorStateBytes = xferLoad.xferUser(new Uint8Array(SOURCE_RAILROAD_ENUM_BYTE_LENGTH));
    const anchorWaypointIdBytes = xferLoad.xferUser(new Uint8Array(SOURCE_RAILROAD_ENUM_BYTE_LENGTH));
    const pullInfo = readSourceRailroadBehaviorPullInfoBlockState(xferLoad);
    const conductorPullInfo = readSourceRailroadBehaviorPullInfoBlockState(xferLoad);
    if (!pullInfo || !conductorPullInfo) {
      return null;
    }
    const held = version >= 3 ? xferLoad.xferBool(false) : false;
    if (xferLoad.getRemaining() !== 0) {
      return null;
    }
    return {
      version,
      physics,
      nextStationTaskBytes,
      trailerId,
      currentPointHandle,
      waitAtStationTimer,
      carriagesCreated,
      hasEverBeenHitched,
      waitingInWings,
      endOfLine,
      isLocomotive,
      isLeadCarraige,
      wantsToBeLeadCarraige,
      disembark,
      inTunnel,
      conductorStateBytes,
      anchorWaypointIdBytes,
      pullInfo,
      conductorPullInfo,
      held,
    };
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceRailroadRuntimeNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function sourceRailroadRuntimeInt(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(Number(value)) : Math.trunc(fallback);
}

function sourceRailroadRuntimeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sourceRailroadRuntimeByteArray(
  value: unknown,
  fallback: Uint8Array,
  byteLength = SOURCE_RAILROAD_ENUM_BYTE_LENGTH,
): Uint8Array {
  const bytes = Array.isArray(value)
    ? value.map((entry) => Math.trunc(Number(entry)) & 0xff)
    : Array.from(fallback);
  const result = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    result[index] = bytes[index] ?? 0;
  }
  return result;
}

function sourceRailroadRuntimePullInfoToSource(
  state: SourceRailroadBehaviorPullInfoRuntimeState | null | undefined,
  fallback: SourceRailroadBehaviorPullInfoBlockState,
): SourceRailroadBehaviorPullInfoBlockState {
  return {
    version: SOURCE_RAILROAD_PULL_INFO_CURRENT_VERSION,
    direction: sourceRailroadRuntimeNumber(state?.direction, fallback.direction),
    speed: sourceRailroadRuntimeNumber(state?.speed, fallback.speed),
    trackDistance: sourceRailroadRuntimeNumber(state?.trackDistance, fallback.trackDistance),
    towHitchPosition: {
      x: sourceRailroadRuntimeNumber(state?.towHitchPositionX, fallback.towHitchPosition.x),
      y: sourceRailroadRuntimeNumber(state?.towHitchPositionZ, fallback.towHitchPosition.y),
      z: sourceRailroadRuntimeNumber(state?.towHitchPositionY, fallback.towHitchPosition.z),
    },
    mostRecentSpecialPointHandle: sourceRailroadRuntimeInt(
      state?.mostRecentSpecialPointHandle,
      fallback.mostRecentSpecialPointHandle,
    ),
    previousWaypoint: normalizeSourceObjectId(
      sourceRailroadRuntimeInt(state?.previousWaypoint, fallback.previousWaypoint),
    ),
    currentWaypoint: normalizeSourceObjectId(
      sourceRailroadRuntimeInt(state?.currentWaypoint, fallback.currentWaypoint),
    ),
  };
}

function writeSourceRailroadBehaviorPullInfoBlockData(
  saver: XferSave,
  state: SourceRailroadBehaviorPullInfoBlockState,
): void {
  saver.xferVersion(SOURCE_RAILROAD_PULL_INFO_CURRENT_VERSION);
  saver.xferReal(state.direction);
  saver.xferReal(state.speed);
  saver.xferReal(state.trackDistance);
  saver.xferCoord3D(state.towHitchPosition);
  saver.xferInt(state.mostRecentSpecialPointHandle);
  saver.xferUnsignedInt(normalizeSourceObjectId(state.previousWaypoint));
  saver.xferUnsignedInt(normalizeSourceObjectId(state.currentWaypoint));
}

function buildSourceRailroadBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceRailroadBehaviorBlockState,
): Uint8Array {
  const runtimeState = (entity as {
    sourceRailroadBehaviorState?: SourceRailroadBehaviorRuntimeState | null;
  }).sourceRailroadBehaviorState ?? null;
  const pullInfo = sourceRailroadRuntimePullInfoToSource(runtimeState?.pullInfo, preservedState.pullInfo);
  const conductorPullInfo = sourceRailroadRuntimePullInfoToSource(
    runtimeState?.conductorPullInfo,
    preservedState.conductorPullInfo,
  );
  const saver = new XferSave();
  saver.open('build-source-railroad-behavior');
  try {
    saver.xferVersion(SOURCE_RAILROAD_BEHAVIOR_CURRENT_VERSION);
    writeSourcePhysicsBehaviorBlockData(saver, entity, currentFrame, preservedState.physics);
    saver.xferUser(sourceRailroadRuntimeByteArray(
      runtimeState?.nextStationTaskBytes,
      preservedState.nextStationTaskBytes,
    ));
    saver.xferObjectID(normalizeSourceObjectId(sourceRailroadRuntimeInt(
      runtimeState?.trailerId,
      preservedState.trailerId,
    )));
    saver.xferInt(sourceRailroadRuntimeInt(runtimeState?.currentPointHandle, preservedState.currentPointHandle));
    saver.xferInt(sourceRailroadRuntimeInt(runtimeState?.waitAtStationTimer, preservedState.waitAtStationTimer));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.carriagesCreated, preservedState.carriagesCreated));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.hasEverBeenHitched, preservedState.hasEverBeenHitched));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.waitingInWings, preservedState.waitingInWings));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.endOfLine, preservedState.endOfLine));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.isLocomotive, preservedState.isLocomotive));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.isLeadCarraige, preservedState.isLeadCarraige));
    saver.xferInt(sourceRailroadRuntimeInt(
      runtimeState?.wantsToBeLeadCarraige,
      preservedState.wantsToBeLeadCarraige,
    ));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.disembark, preservedState.disembark));
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.inTunnel, preservedState.inTunnel));
    saver.xferUser(sourceRailroadRuntimeByteArray(
      runtimeState?.conductorStateBytes,
      preservedState.conductorStateBytes,
    ));
    saver.xferUser(sourceRailroadRuntimeByteArray(
      runtimeState?.anchorWaypointIdBytes,
      preservedState.anchorWaypointIdBytes,
    ));
    writeSourceRailroadBehaviorPullInfoBlockData(saver, pullInfo);
    writeSourceRailroadBehaviorPullInfoBlockData(saver, conductorPullInfo);
    saver.xferBool(sourceRailroadRuntimeBool(runtimeState?.held, preservedState.held));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceWaveGuideUpdateBlockData(
  data: Uint8Array,
): SourceWaveGuideUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-wave-guide-update');
  try {
    const version = xferLoad.xferVersion(SOURCE_WAVEGUIDE_CURRENT_VERSION);
    if (version !== SOURCE_WAVEGUIDE_CURRENT_VERSION) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const activeFrame = xferLoad.xferUnsignedInt(0);
    const needDisable = xferLoad.xferBool(false);
    const initialized = xferLoad.xferBool(false);
    const shapePointsBytes = xferLoad.xferUser(new Uint8Array(SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH));
    const transformedShapePointsBytes = xferLoad.xferUser(
      new Uint8Array(SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH),
    );
    const shapeEffectsBytes = xferLoad.xferUser(new Uint8Array(SOURCE_WAVEGUIDE_SHAPE_EFFECTS_BYTE_LENGTH));
    const shapePointCount = xferLoad.xferInt(0);
    const splashSoundFrame = xferLoad.xferUnsignedInt(0);
    const finalDestination = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    if (xferLoad.getRemaining() !== 0) {
      return null;
    }
    return {
      version,
      nextCallFrameAndPhase,
      activeFrame,
      needDisable,
      initialized,
      shapePointsBytes,
      transformedShapePointsBytes,
      shapeEffectsBytes,
      shapePointCount,
      splashSoundFrame,
      finalDestination,
    };
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceWaveGuideRuntimeNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function sourceWaveGuideRuntimeInt(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(Number(value)) : Math.trunc(fallback);
}

function sourceWaveGuideRuntimeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sourceWaveGuideRuntimeByteArray(
  value: unknown,
  fallback: Uint8Array,
  byteLength: number,
): Uint8Array {
  const source = Array.isArray(value)
    ? value.map((entry) => Math.trunc(Number(entry)) & 0xff)
    : Array.from(fallback);
  const result = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    result[index] = source[index] ?? 0;
  }
  return result;
}

function buildSourceWaveGuideUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceWaveGuideUpdateBlockState,
): Uint8Array {
  const runtimeState = (entity as {
    sourceWaveGuideUpdateState?: SourceWaveGuideUpdateRuntimeState | null;
  }).sourceWaveGuideUpdateState ?? null;
  const saver = new XferSave();
  saver.open('build-source-wave-guide-update');
  try {
    saver.xferVersion(SOURCE_WAVEGUIDE_CURRENT_VERSION);
    xferSourceUpdateModuleBase(
      saver,
      sourceFlammableUnsignedFrame(
        runtimeState?.nextCallFrameAndPhase,
        preservedState.nextCallFrameAndPhase,
      ),
    );
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(runtimeState?.activeFrame, preservedState.activeFrame));
    saver.xferBool(sourceWaveGuideRuntimeBool(runtimeState?.needDisable, preservedState.needDisable));
    saver.xferBool(sourceWaveGuideRuntimeBool(runtimeState?.initialized, preservedState.initialized));
    saver.xferUser(sourceWaveGuideRuntimeByteArray(
      runtimeState?.shapePointsBytes,
      preservedState.shapePointsBytes,
      SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH,
    ));
    saver.xferUser(sourceWaveGuideRuntimeByteArray(
      runtimeState?.transformedShapePointsBytes,
      preservedState.transformedShapePointsBytes,
      SOURCE_WAVEGUIDE_SHAPE_POINTS_BYTE_LENGTH,
    ));
    saver.xferUser(sourceWaveGuideRuntimeByteArray(
      runtimeState?.shapeEffectsBytes,
      preservedState.shapeEffectsBytes,
      SOURCE_WAVEGUIDE_SHAPE_EFFECTS_BYTE_LENGTH,
    ));
    saver.xferInt(sourceWaveGuideRuntimeInt(runtimeState?.shapePointCount, preservedState.shapePointCount));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      runtimeState?.splashSoundFrame,
      preservedState.splashSoundFrame,
    ));
    saver.xferCoord3D({
      x: sourceWaveGuideRuntimeNumber(runtimeState?.finalDestinationX, preservedState.finalDestination.x),
      y: sourceWaveGuideRuntimeNumber(runtimeState?.finalDestinationZ, preservedState.finalDestination.y),
      z: sourceWaveGuideRuntimeNumber(runtimeState?.finalDestinationY, preservedState.finalDestination.z),
    });
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceProjectileStreamUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  projectileIds: number[];
  nextFreeIndex: number;
  firstValidIndex: number;
  owningObject: number;
  targetObject: number;
  targetPosition: Coord3D;
}

function createDefaultSourceProjectileStreamUpdateBlockState(
  currentFrame: number,
): SourceProjectileStreamUpdateBlockState {
  return {
    version: 2,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    projectileIds: Array.from({ length: SOURCE_PROJECTILE_STREAM_MAX }, () => 0),
    nextFreeIndex: 0,
    firstValidIndex: 0,
    owningObject: 0,
    targetObject: 0,
    targetPosition: { x: 0, y: 0, z: 0 },
  };
}

function normalizeSourceObjectId(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value)) >>> 0
    : 0;
}

function normalizeSourceCoord3D(value: Coord3D | undefined, fallback: Coord3D): Coord3D {
  return {
    x: sourcePhysicsFinite(value?.x, fallback.x),
    y: sourcePhysicsFinite(value?.y, fallback.y),
    z: sourcePhysicsFinite(value?.z, fallback.z),
  };
}

function tryParseSourceProjectileStreamUpdateBlockData(
  data: Uint8Array,
): SourceProjectileStreamUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-projectile-stream-update');
  try {
    const version = xferLoad.xferVersion(2);
    if (version !== 1 && version !== 2) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const projectileIds: number[] = [];
    for (let index = 0; index < SOURCE_PROJECTILE_STREAM_MAX; index += 1) {
      projectileIds.push(xferLoad.xferObjectID(0));
    }
    const nextFreeIndex = xferLoad.xferInt(0);
    const firstValidIndex = xferLoad.xferInt(0);
    const owningObject = xferLoad.xferObjectID(0);
    const targetObject = version >= 2 ? xferLoad.xferObjectID(0) : 0;
    const targetPosition = version >= 2 ? xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 };
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        projectileIds,
        nextFreeIndex,
        firstValidIndex,
        owningObject,
        targetObject,
        targetPosition,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceProjectileStreamUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceProjectileStreamUpdateBlockState,
): Uint8Array {
  const state = entity.projectileStreamState;
  // Source asserts after an add if nextFreeIndex catches firstValidIndex, so a valid
  // source save can represent at most 19 active entries in the 20-slot ring.
  const liveProjectileIds = Array.isArray(state?.projectileIds)
    ? state.projectileIds.map(normalizeSourceObjectId).slice(-SOURCE_PROJECTILE_STREAM_MAX_ACTIVE)
    : [];
  const projectileIds = Array.from({ length: SOURCE_PROJECTILE_STREAM_MAX }, (_, index) =>
    liveProjectileIds[index] ?? 0,
  );
  const saver = new XferSave();
  saver.open('build-source-projectile-stream-update');
  try {
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    for (const projectileId of projectileIds) {
      saver.xferObjectID(projectileId);
    }
    saver.xferInt(liveProjectileIds.length % SOURCE_PROJECTILE_STREAM_MAX);
    saver.xferInt(0);
    saver.xferObjectID(normalizeSourceObjectId(state?.ownerEntityId ?? preservedState.owningObject));
    saver.xferObjectID(normalizeSourceObjectId(state?.targetObjectId ?? preservedState.targetObject));
    saver.xferCoord3D(normalizeSourceCoord3D(state?.targetPosition, preservedState.targetPosition));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceBoneFxUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  particleSystemIds: number[];
  nextFxFrame: number[][];
  nextOclFrame: number[][];
  nextParticleSystemFrame: number[][];
  fxBonePositions: Coord3D[][];
  oclBonePositions: Coord3D[][];
  particleSystemBonePositions: Coord3D[][];
  currentBodyState: number;
  bonesResolvedBytes: Uint8Array;
  active: boolean;
}

function createSourceBoneFxNumberGrid(value: number): number[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, () =>
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, () => value),
  );
}

function createSourceBoneFxCoordGrid(): Coord3D[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, () =>
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, () => ({ x: 0, y: 0, z: 0 })),
  );
}

function createDefaultSourceBoneFxUpdateBlockState(currentFrame: number): SourceBoneFxUpdateBlockState {
  return {
    version: 1,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    particleSystemIds: [],
    nextFxFrame: createSourceBoneFxNumberGrid(-1),
    nextOclFrame: createSourceBoneFxNumberGrid(-1),
    nextParticleSystemFrame: createSourceBoneFxNumberGrid(-1),
    fxBonePositions: createSourceBoneFxCoordGrid(),
    oclBonePositions: createSourceBoneFxCoordGrid(),
    particleSystemBonePositions: createSourceBoneFxCoordGrid(),
    currentBodyState: 0,
    bonesResolvedBytes: new Uint8Array(SOURCE_BONE_FX_BONES_RESOLVED_BYTE_LENGTH),
    active: false,
  };
}

function xferSourceBoneFxIntGrid(xfer: Xfer, values: readonly (readonly number[])[]): number[][] {
  const result: number[][] = [];
  for (let damageState = 0; damageState < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; damageState += 1) {
    const row: number[] = [];
    const sourceRow = values[damageState] ?? [];
    for (let boneIndex = 0; boneIndex < SOURCE_BONE_FX_MAX_BONES; boneIndex += 1) {
      row.push(xfer.xferInt(Math.trunc(sourcePhysicsFinite(sourceRow[boneIndex], 0))));
    }
    result.push(row);
  }
  return result;
}

function xferSourceBoneFxCoordGrid(xfer: Xfer, values: readonly (readonly Coord3D[])[]): Coord3D[][] {
  const result: Coord3D[][] = [];
  for (let damageState = 0; damageState < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT; damageState += 1) {
    const row: Coord3D[] = [];
    const sourceRow = values[damageState] ?? [];
    for (let boneIndex = 0; boneIndex < SOURCE_BONE_FX_MAX_BONES; boneIndex += 1) {
      row.push(xfer.xferCoord3D(sourceRow[boneIndex] ?? { x: 0, y: 0, z: 0 }));
    }
    result.push(row);
  }
  return result;
}

function buildSourceBoneFxFrameGrid(
  liveGrid: readonly (readonly number[])[] | undefined,
  preservedGrid: readonly (readonly number[])[],
): number[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, (_, damageState) => (
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, (_, boneIndex) => {
      const liveValue = liveGrid?.[damageState]?.[boneIndex];
      if (typeof liveValue === 'number' && Number.isFinite(liveValue)) {
        return Math.trunc(liveValue);
      }
      return Math.trunc(sourcePhysicsFinite(preservedGrid[damageState]?.[boneIndex], -1));
    })
  ));
}

function buildSourceBoneFxCoordGrid(
  liveGrid: readonly (readonly Coord3D[])[] | undefined,
  preservedGrid: readonly (readonly Coord3D[])[],
): Coord3D[][] {
  return Array.from({ length: SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT }, (_, damageState) => (
    Array.from({ length: SOURCE_BONE_FX_MAX_BONES }, (_, boneIndex) => {
      const preservedValue = preservedGrid[damageState]?.[boneIndex] ?? { x: 0, y: 0, z: 0 };
      return normalizeSourceCoord3D(liveGrid?.[damageState]?.[boneIndex], preservedValue);
    })
  ));
}

function sourceBoneFxBodyState(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const state = Math.trunc(value);
    if (state >= 0 && state < SOURCE_BONE_FX_BODY_DAMAGE_TYPE_COUNT) {
      return state;
    }
  }
  return Math.trunc(sourcePhysicsFinite(fallback, 0));
}

function normalizeSourceBoneFxParticleSystemIds(values: unknown): number[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.slice(0, 0xffff).map(normalizeSourceObjectId);
}

function buildSourceBoneFxResolvedBytes(
  liveValues: readonly boolean[] | undefined,
  preservedBytes: Uint8Array,
): Uint8Array {
  if (!Array.isArray(liveValues)) {
    return preservedBytes.byteLength === SOURCE_BONE_FX_BONES_RESOLVED_BYTE_LENGTH
      ? preservedBytes
      : new Uint8Array(SOURCE_BONE_FX_BONES_RESOLVED_BYTE_LENGTH);
  }
  return new Uint8Array(
    Array.from({ length: SOURCE_BONE_FX_BONES_RESOLVED_BYTE_LENGTH }, (_, index) =>
      liveValues[index] === true ? 1 : 0,
    ),
  );
}

function tryParseSourceBoneFxUpdateBlockData(
  data: Uint8Array,
): SourceBoneFxUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-bone-fx-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const particleSystemCount = xferLoad.xferUnsignedShort(0);
    const particleSystemIds: number[] = [];
    for (let index = 0; index < particleSystemCount; index += 1) {
      particleSystemIds.push(xferLoad.xferUnsignedInt(0));
    }
    const nextFxFrame = xferSourceBoneFxIntGrid(xferLoad, []);
    const nextOclFrame = xferSourceBoneFxIntGrid(xferLoad, []);
    const nextParticleSystemFrame = xferSourceBoneFxIntGrid(xferLoad, []);
    const fxBonePositions = xferSourceBoneFxCoordGrid(xferLoad, []);
    const oclBonePositions = xferSourceBoneFxCoordGrid(xferLoad, []);
    const particleSystemBonePositions = xferSourceBoneFxCoordGrid(xferLoad, []);
    const currentBodyState = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const bonesResolvedBytes = xferLoad.xferUser(new Uint8Array(SOURCE_BONE_FX_BONES_RESOLVED_BYTE_LENGTH));
    const active = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        particleSystemIds,
        nextFxFrame,
        nextOclFrame,
        nextParticleSystemFrame,
        fxBonePositions,
        oclBonePositions,
        particleSystemBonePositions,
        currentBodyState,
        bonesResolvedBytes,
        active,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceBoneFxUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceBoneFxUpdateBlockState,
): Uint8Array {
  const state = entity.boneFXState;
  const particleSystemIds = normalizeSourceBoneFxParticleSystemIds(
    state?.activeParticleIds ?? preservedState.particleSystemIds,
  );
  const saver = new XferSave();
  saver.open('build-source-bone-fx-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedShort(particleSystemIds.length);
    for (const particleSystemId of particleSystemIds) {
      saver.xferUnsignedInt(particleSystemId);
    }
    xferSourceBoneFxIntGrid(saver, buildSourceBoneFxFrameGrid(state?.nextFXFrame, preservedState.nextFxFrame));
    xferSourceBoneFxIntGrid(saver, buildSourceBoneFxFrameGrid(state?.nextOCLFrame, preservedState.nextOclFrame));
    xferSourceBoneFxIntGrid(
      saver,
      buildSourceBoneFxFrameGrid(state?.nextParticleFrame, preservedState.nextParticleSystemFrame),
    );
    xferSourceBoneFxCoordGrid(
      saver,
      buildSourceBoneFxCoordGrid(state?.fxBonePositions, preservedState.fxBonePositions),
    );
    xferSourceBoneFxCoordGrid(
      saver,
      buildSourceBoneFxCoordGrid(state?.oclBonePositions, preservedState.oclBonePositions),
    );
    xferSourceBoneFxCoordGrid(
      saver,
      buildSourceBoneFxCoordGrid(
        state?.particleSystemBonePositions,
        preservedState.particleSystemBonePositions,
      ),
    );
    saver.xferUser(buildSourceRawInt32Bytes(
      sourceBoneFxBodyState(state?.currentBodyState, preservedState.currentBodyState),
    ));
    saver.xferUser(buildSourceBoneFxResolvedBytes(state?.bonesResolved, preservedState.bonesResolvedBytes));
    saver.xferBool(typeof state?.active === 'boolean' ? state.active : preservedState.active);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceFlammableUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  status: number;
  aflameEndFrame: number;
  burnedEndFrame: number;
  damageEndFrame: number;
  flameDamageLimit: number;
  lastFlameDamageDealt: number;
}

function sourceFlammableStatusToInt(status: MapEntity['flameStatus'] | undefined): number {
  switch (status) {
    case 'AFLAME': return SOURCE_FLAMMABLE_STATUS_AFLAME;
    case 'BURNED': return SOURCE_FLAMMABLE_STATUS_BURNED;
    case 'NORMAL':
    default: return SOURCE_FLAMMABLE_STATUS_NORMAL;
  }
}

function sourceFlammableUnsignedFrame(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value)) >>> 0
    : Math.max(0, Math.trunc(fallback)) >>> 0;
}

function sourceFlammableNextWakeFrame(entity: MapEntity, currentFrame: number): number {
  if (entity.flameStatus !== 'AFLAME' || entity.flameEndFrame <= currentFrame) {
    return SOURCE_FRAME_FOREVER;
  }
  let soonest = sourceFlammableUnsignedFrame(entity.flameEndFrame);
  const burnedFrame = sourceFlammableUnsignedFrame(entity.flameBurnedEndFrame);
  if (burnedFrame > currentFrame && burnedFrame < soonest) {
    soonest = burnedFrame;
  }
  const damageFrame = sourceFlammableUnsignedFrame(entity.flameDamageNextFrame);
  if (damageFrame > currentFrame && damageFrame < soonest) {
    soonest = damageFrame;
  }
  return soonest;
}

function sourceFlammableRemainingDamageLimit(
  entity: MapEntity,
  preservedState: SourceFlammableUpdateBlockState,
): number {
  const limit = entity.flammableProfile?.flameDamageLimit;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return preservedState.flameDamageLimit;
  }
  return limit - sourcePhysicsFinite(entity.flameDamageAccumulated, 0);
}

function tryParseSourceFlammableUpdateBlockData(
  data: Uint8Array,
): SourceFlammableUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-flammable-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const status = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const aflameEndFrame = xferLoad.xferUnsignedInt(0);
    const burnedEndFrame = xferLoad.xferUnsignedInt(0);
    const damageEndFrame = xferLoad.xferUnsignedInt(0);
    const flameDamageLimit = xferLoad.xferReal(0);
    const lastFlameDamageDealt = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        status,
        aflameEndFrame,
        burnedEndFrame,
        damageEndFrame,
        flameDamageLimit,
        lastFlameDamageDealt,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceFlammableUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceFlammableUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-flammable-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(sourceFlammableNextWakeFrame(entity, currentFrame)),
    ));
    saver.xferUser(buildSourceRawInt32Bytes(sourceFlammableStatusToInt(entity.flameStatus)));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(entity.flameEndFrame, preservedState.aflameEndFrame));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(entity.flameBurnedEndFrame, preservedState.burnedEndFrame));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(entity.flameDamageNextFrame, preservedState.damageEndFrame));
    saver.xferReal(sourceFlammableRemainingDamageLimit(entity, preservedState));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.flameLastDamageReceivedFrame,
      preservedState.lastFlameDamageDealt,
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceFireSpreadUpdateBlockData(
  data: Uint8Array,
): { nextCallFrameAndPhase: number } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-fire-spread-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0 ? { nextCallFrameAndPhase } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceFireSpreadUpdateBlockData(entity: MapEntity): Uint8Array {
  const nextWakeFrame = entity.flameStatus === 'AFLAME' && entity.fireSpreadNextFrame > 0
    ? sourceFlammableUnsignedFrame(entity.fireSpreadNextFrame)
    : SOURCE_FRAME_FOREVER;
  const saver = new XferSave();
  saver.open('build-source-fire-spread-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextWakeFrame),
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourcePoisonedBehaviorBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  poisonDamageFrame: number;
  poisonOverallStopFrame: number;
  poisonDamageAmount: number;
  deathType: number;
}

interface SourceMinefieldImmuneBlockState {
  objectId: number;
  collideTime: number;
}

interface SourceMinefieldBehaviorBlockState {
  nextCallFrameAndPhase: number;
  virtualMinesRemaining: number;
  nextDeathCheckFrame: number;
  scootFramesLeft: number;
  scootVelocity: Coord3D;
  scootAcceleration: Coord3D;
  ignoreDamage: boolean;
  regenerates: boolean;
  draining: boolean;
  immunes: SourceMinefieldImmuneBlockState[];
}

interface SourceGenerateMinefieldBehaviorBlockState {
  upgradeExecuted: boolean;
  generated: boolean;
  hasTarget: boolean;
  upgraded: boolean;
  target: Coord3D;
  mineIds: number[];
}

function createDefaultSourceFlammableUpdateBlockState(entity: MapEntity): SourceFlammableUpdateBlockState {
  const profileLimit = entity.flammableProfile?.flameDamageLimit;
  return {
    version: 1,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    status: SOURCE_FLAMMABLE_STATUS_NORMAL,
    aflameEndFrame: 0,
    burnedEndFrame: 0,
    damageEndFrame: 0,
    flameDamageLimit: typeof profileLimit === 'number' && Number.isFinite(profileLimit) ? profileLimit : 20,
    lastFlameDamageDealt: 0,
  };
}

function createDefaultSourcePoisonedBehaviorBlockState(): SourcePoisonedBehaviorBlockState {
  return {
    version: 2,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    poisonDamageFrame: 0,
    poisonOverallStopFrame: 0,
    poisonDamageAmount: 0,
    deathType: SOURCE_DEATH_TYPE_POISONED,
  };
}

function createDefaultSourceMinefieldBehaviorBlockState(entity: MapEntity): SourceMinefieldBehaviorBlockState {
  const virtualMines = sourceFlammableUnsignedFrame(entity.minefieldProfile?.numVirtualMines, 0);
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    virtualMinesRemaining: virtualMines,
    nextDeathCheckFrame: 0,
    scootFramesLeft: 0,
    scootVelocity: { x: 0, y: 0, z: 0 },
    scootAcceleration: { x: 0, y: 0, z: 0 },
    ignoreDamage: false,
    regenerates: entity.minefieldProfile?.regenerates === true,
    draining: false,
    immunes: Array.from({ length: SOURCE_MINEFIELD_MAX_IMMUNITY }, () => ({
      objectId: 0,
      collideTime: 0,
    })),
  };
}

function createDefaultSourceGenerateMinefieldBehaviorBlockState(): SourceGenerateMinefieldBehaviorBlockState {
  return {
    upgradeExecuted: false,
    generated: false,
    hasTarget: false,
    upgraded: false,
    target: { x: 0, y: 0, z: 0 },
    mineIds: [],
  };
}

function tryParseSourcePoisonedBehaviorBlockData(
  data: Uint8Array,
): SourcePoisonedBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-poisoned-behavior');
  try {
    const version = xferLoad.xferVersion(2);
    if (version < 1 || version > 2) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const poisonDamageFrame = xferLoad.xferUnsignedInt(0);
    const poisonOverallStopFrame = xferLoad.xferUnsignedInt(0);
    const poisonDamageAmount = xferLoad.xferReal(0);
    const deathType = version >= 2
      ? parseSourceRawInt32Bytes(xferLoad.xferUser(buildSourceRawInt32Bytes(SOURCE_DEATH_TYPE_POISONED)))
      : SOURCE_DEATH_TYPE_POISONED;
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        poisonDamageFrame,
        poisonOverallStopFrame,
        poisonDamageAmount,
        deathType,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourcePoisonedWakeFrame(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourcePoisonedBehaviorBlockState,
): number {
  const poisonDamageAmount = sourcePhysicsFinite(entity.poisonDamageAmount, preservedState.poisonDamageAmount);
  const poisonDamageFrame = sourceFlammableUnsignedFrame(entity.poisonNextDamageFrame, preservedState.poisonDamageFrame);
  const poisonOverallStopFrame =
    sourceFlammableUnsignedFrame(entity.poisonExpireFrame, preservedState.poisonOverallStopFrame);
  if (poisonDamageAmount <= 0 || poisonOverallStopFrame === 0) {
    return SOURCE_FRAME_FOREVER;
  }
  const candidates = [poisonDamageFrame, poisonOverallStopFrame].filter((frame) => frame > 0);
  const nextWakeFrame = candidates.length > 0 ? Math.min(...candidates) : currentFrame + 1;
  return nextWakeFrame > currentFrame ? nextWakeFrame : currentFrame + 1;
}

function sourceDeathTypeFromRuntimeName(value: unknown, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }
  return SOURCE_DEATH_TYPE_BY_NAME.get(value.trim().toUpperCase()) ?? fallback;
}

function buildSourcePoisonedBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourcePoisonedBehaviorBlockState,
): Uint8Array {
  const poisonDamageAmount = sourcePhysicsFinite(entity.poisonDamageAmount, preservedState.poisonDamageAmount);
  const isPoisoned = poisonDamageAmount > 0;
  const saver = new XferSave();
  saver.open('build-source-poisoned-behavior');
  try {
    saver.xferVersion(2);
    xferSourceUpdateModuleBase(
      saver,
      buildSourceUpdateModuleWakeFrame(sourcePoisonedWakeFrame(entity, currentFrame, preservedState)),
    );
    saver.xferUnsignedInt(isPoisoned
      ? sourceFlammableUnsignedFrame(entity.poisonNextDamageFrame, preservedState.poisonDamageFrame)
      : 0);
    saver.xferUnsignedInt(isPoisoned
      ? sourceFlammableUnsignedFrame(entity.poisonExpireFrame, preservedState.poisonOverallStopFrame)
      : 0);
    saver.xferReal(isPoisoned ? poisonDamageAmount : 0);
    saver.xferUser(buildSourceRawInt32Bytes(sourceDeathTypeFromRuntimeName(entity.poisonDeathType, preservedState.deathType)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceMinefieldBehaviorBlockData(
  data: Uint8Array,
): SourceMinefieldBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-minefield-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const virtualMinesRemaining = xferLoad.xferUnsignedInt(0);
    const nextDeathCheckFrame = xferLoad.xferUnsignedInt(0);
    const scootFramesLeft = xferLoad.xferUnsignedInt(0);
    const scootVelocity = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const scootAcceleration = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const ignoreDamage = xferLoad.xferBool(false);
    const regenerates = xferLoad.xferBool(false);
    const draining = xferLoad.xferBool(false);
    const maxImmunity = xferLoad.xferUnsignedByte(SOURCE_MINEFIELD_MAX_IMMUNITY);
    if (maxImmunity !== SOURCE_MINEFIELD_MAX_IMMUNITY) {
      return null;
    }
    const immunes: SourceMinefieldImmuneBlockState[] = [];
    for (let index = 0; index < maxImmunity; index += 1) {
      immunes.push({
        objectId: xferLoad.xferObjectID(0),
        collideTime: xferLoad.xferUnsignedInt(0),
      });
    }
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        virtualMinesRemaining,
        nextDeathCheckFrame,
        scootFramesLeft,
        scootVelocity,
        scootAcceleration,
        ignoreDamage,
        regenerates,
        draining,
        immunes,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceMinefieldImmuneEntries(entity: MapEntity): SourceMinefieldImmuneBlockState[] {
  const entries = Array.isArray(entity.mineImmunes) ? entity.mineImmunes : [];
  return Array.from({ length: SOURCE_MINEFIELD_MAX_IMMUNITY }, (_, index) => {
    const entry = entries[index];
    return {
      objectId: normalizeSourceObjectId(entry?.entityId ?? 0),
      collideTime: sourceFlammableUnsignedFrame(entry?.collideFrame, 0),
    };
  });
}

function sourceMinefieldWakeFrame(
  entity: MapEntity,
  currentFrame: number,
  immunes: readonly SourceMinefieldImmuneBlockState[],
): number {
  if (entity.mineDraining
    || sourceFlammableUnsignedFrame(entity.mineScootFramesLeft, 0) > 0
    || immunes.some((entry) => entry.objectId !== 0)) {
    return currentFrame + 1;
  }
  if (entity.mineRegenerates
    && entity.minefieldProfile?.stopsRegenAfterCreatorDies
    && Number.isFinite(entity.mineNextDeathCheckFrame)) {
    const nextDeathCheckFrame = Math.max(0, Math.trunc(entity.mineNextDeathCheckFrame));
    return nextDeathCheckFrame > currentFrame ? nextDeathCheckFrame : currentFrame + 1;
  }
  return SOURCE_FRAME_FOREVER;
}

function buildSourceMinefieldBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceMinefieldBehaviorBlockState,
): Uint8Array {
  const immunes = sourceMinefieldImmuneEntries(entity);
  const saver = new XferSave();
  saver.open('build-source-minefield-behavior');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(
      saver,
      buildSourceUpdateModuleWakeFrame(sourceMinefieldWakeFrame(entity, currentFrame, immunes)),
    );
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.mineVirtualMinesRemaining,
      preservedState.virtualMinesRemaining,
    ));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.mineNextDeathCheckFrame,
      preservedState.nextDeathCheckFrame,
    ));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.mineScootFramesLeft,
      preservedState.scootFramesLeft,
    ));
    saver.xferCoord3D(preservedState.scootVelocity);
    saver.xferCoord3D(preservedState.scootAcceleration);
    saver.xferBool(typeof entity.mineIgnoreDamage === 'boolean'
      ? entity.mineIgnoreDamage
      : preservedState.ignoreDamage);
    saver.xferBool(typeof entity.mineRegenerates === 'boolean'
      ? entity.mineRegenerates
      : preservedState.regenerates);
    saver.xferBool(typeof entity.mineDraining === 'boolean'
      ? entity.mineDraining
      : preservedState.draining);
    saver.xferUnsignedByte(SOURCE_MINEFIELD_MAX_IMMUNITY);
    for (const entry of immunes) {
      saver.xferObjectID(entry.objectId);
      saver.xferUnsignedInt(entry.collideTime);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceGenerateMinefieldBehaviorBlockData(
  data: Uint8Array,
): SourceGenerateMinefieldBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-generate-minefield-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferSourceBehaviorModuleBase(xferLoad);
    const upgradeMuxVersion = xferLoad.xferVersion(1);
    if (upgradeMuxVersion !== 1) {
      return null;
    }
    const upgradeExecuted = xferLoad.xferBool(false);
    const generated = xferLoad.xferBool(false);
    const hasTarget = xferLoad.xferBool(false);
    const upgraded = xferLoad.xferBool(false);
    const target = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const mineCount = xferLoad.xferUnsignedByte(0);
    const mineIds: number[] = [];
    for (let index = 0; index < mineCount; index += 1) {
      mineIds.push(xferLoad.xferObjectID(0));
    }
    return xferLoad.getRemaining() === 0
      ? {
        upgradeExecuted,
        generated,
        hasTarget,
        upgraded,
        target,
        mineIds,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceGenerateMinefieldMineIds(
  entity: MapEntity,
  preservedState: SourceGenerateMinefieldBehaviorBlockState,
): number[] {
  const sourceIds = Array.isArray(entity.generateMinefieldMineIds)
    ? entity.generateMinefieldMineIds
    : preservedState.mineIds;
  const mineIds = sourceIds.map(normalizeSourceObjectId);
  if (mineIds.length > 0xff) {
    throw new Error(`GenerateMinefieldBehavior source save has ${mineIds.length} mine ids; C++ xfers an unsigned byte count.`);
  }
  return mineIds;
}

function sourceGenerateMinefieldTarget(
  entity: MapEntity,
  preservedState: SourceGenerateMinefieldBehaviorBlockState,
): Coord3D {
  return runtimeCoord3DToSourceCoord3D(
    {
      x: entity.generateMinefieldTargetX,
      y: entity.generateMinefieldTargetY,
      z: entity.generateMinefieldTargetZ,
    },
    preservedState.target,
  );
}

function buildSourceGenerateMinefieldBehaviorBlockData(
  entity: MapEntity,
  preservedState: SourceGenerateMinefieldBehaviorBlockState,
): Uint8Array {
  const mineIds = sourceGenerateMinefieldMineIds(entity, preservedState);
  const saver = new XferSave();
  saver.open('build-source-generate-minefield-behavior');
  try {
    saver.xferVersion(1);
    xferSourceBehaviorModuleBase(saver);
    saver.xferVersion(1);
    saver.xferBool(typeof entity.generateMinefieldUpgradeExecuted === 'boolean'
      ? entity.generateMinefieldUpgradeExecuted
      : preservedState.upgradeExecuted);
    saver.xferBool(typeof entity.generateMinefieldDone === 'boolean'
      ? entity.generateMinefieldDone
      : preservedState.generated);
    saver.xferBool(typeof entity.generateMinefieldHasTarget === 'boolean'
      ? entity.generateMinefieldHasTarget
      : preservedState.hasTarget);
    saver.xferBool(typeof entity.generateMinefieldUpgraded === 'boolean'
      ? entity.generateMinefieldUpgraded
      : preservedState.upgraded);
    saver.xferCoord3D(sourceGenerateMinefieldTarget(entity, preservedState));
    saver.xferUnsignedByte(mineIds.length);
    for (const objectId of mineIds) {
      saver.xferObjectID(objectId);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceDynamicGeometryInfoUpdateBlockState {
  nextCallFrameAndPhase: number;
  startingDelayCountdown: number;
  timeActive: number;
  started: boolean;
  finished: boolean;
  reverseAtTransitionTime: boolean;
  direction: number;
  switchedDirections: boolean;
  initialHeight: number;
  initialMajorRadius: number;
  initialMinorRadius: number;
  finalHeight: number;
  finalMajorRadius: number;
  finalMinorRadius: number;
}

interface SourceFirestormDynamicGeometryInfoUpdateBlockState {
  dynamic: SourceDynamicGeometryInfoUpdateBlockState;
  particleSystemIdBytes: Uint8Array;
  effectsFired: boolean;
  scorchPlaced: boolean;
  lastDamageFrame: number;
}

function xferSourceDynamicGeometryInfoUpdate(
  xfer: Xfer,
  state: SourceDynamicGeometryInfoUpdateBlockState,
): SourceDynamicGeometryInfoUpdateBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source DynamicGeometryInfoUpdate version ${version}`);
  }
  const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xfer, state.nextCallFrameAndPhase);
  const startingDelayCountdown = xfer.xferUnsignedInt(state.startingDelayCountdown);
  const timeActive = xfer.xferUnsignedInt(state.timeActive);
  const started = xfer.xferBool(state.started);
  const finished = xfer.xferBool(state.finished);
  const reverseAtTransitionTime = xfer.xferBool(state.reverseAtTransitionTime);
  const direction = parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.direction)));
  const switchedDirections = xfer.xferBool(state.switchedDirections);
  const initialHeight = xfer.xferReal(state.initialHeight);
  const initialMajorRadius = xfer.xferReal(state.initialMajorRadius);
  const initialMinorRadius = xfer.xferReal(state.initialMinorRadius);
  const finalHeight = xfer.xferReal(state.finalHeight);
  const finalMajorRadius = xfer.xferReal(state.finalMajorRadius);
  const finalMinorRadius = xfer.xferReal(state.finalMinorRadius);
  return {
    nextCallFrameAndPhase,
    startingDelayCountdown,
    timeActive,
    started,
    finished,
    reverseAtTransitionTime,
    direction,
    switchedDirections,
    initialHeight,
    initialMajorRadius,
    initialMinorRadius,
    finalHeight,
    finalMajorRadius,
    finalMinorRadius,
  };
}

function createDefaultSourceDynamicGeometryInfoUpdateState(): SourceDynamicGeometryInfoUpdateBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    startingDelayCountdown: 1,
    timeActive: 0,
    started: false,
    finished: false,
    reverseAtTransitionTime: false,
    direction: 1,
    switchedDirections: false,
    initialHeight: 0,
    initialMajorRadius: 0,
    initialMinorRadius: 0,
    finalHeight: 0,
    finalMajorRadius: 0,
    finalMinorRadius: 0,
  };
}

function tryParseSourceDynamicGeometryInfoUpdateBlockData(
  data: Uint8Array,
): SourceDynamicGeometryInfoUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-dynamic-geometry-info-update');
  try {
    const parsed = xferSourceDynamicGeometryInfoUpdate(
      xferLoad,
      createDefaultSourceDynamicGeometryInfoUpdateState(),
    );
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceDynamicGeometryInfoUpdateState(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceDynamicGeometryInfoUpdateBlockState,
): SourceDynamicGeometryInfoUpdateBlockState {
  const profile = entity.dynamicGeometryProfile;
  const state = entity.dynamicGeometryState;
  return {
    ...preservedState,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    startingDelayCountdown: sourceFlammableUnsignedFrame(
      state?.delayCountdown,
      sourceFlammableUnsignedFrame(profile?.initialDelayFrames, preservedState.startingDelayCountdown),
    ),
    timeActive: sourceFlammableUnsignedFrame(state?.timeActive, preservedState.timeActive),
    started: typeof state?.started === 'boolean' ? state.started : preservedState.started,
    finished: typeof state?.finished === 'boolean' ? state.finished : preservedState.finished,
    reverseAtTransitionTime: typeof state?.reverseAtTransitionTime === 'boolean'
      ? state.reverseAtTransitionTime
      : (typeof profile?.reverseAtTransitionTime === 'boolean'
        ? profile.reverseAtTransitionTime
        : preservedState.reverseAtTransitionTime),
    initialHeight: sourcePhysicsFinite(
      state?.initialHeight,
      sourcePhysicsFinite(profile?.initialHeight, preservedState.initialHeight),
    ),
    initialMajorRadius: sourcePhysicsFinite(
      state?.initialMajorRadius,
      sourcePhysicsFinite(profile?.initialMajorRadius, preservedState.initialMajorRadius),
    ),
    initialMinorRadius: sourcePhysicsFinite(
      state?.initialMinorRadius,
      sourcePhysicsFinite(profile?.initialMinorRadius, preservedState.initialMinorRadius),
    ),
    finalHeight: sourcePhysicsFinite(
      state?.finalHeight,
      sourcePhysicsFinite(profile?.finalHeight, preservedState.finalHeight),
    ),
    finalMajorRadius: sourcePhysicsFinite(
      state?.finalMajorRadius,
      sourcePhysicsFinite(profile?.finalMajorRadius, preservedState.finalMajorRadius),
    ),
    finalMinorRadius: sourcePhysicsFinite(
      state?.finalMinorRadius,
      sourcePhysicsFinite(profile?.finalMinorRadius, preservedState.finalMinorRadius),
    ),
  };
}

function buildSourceDynamicGeometryInfoUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceDynamicGeometryInfoUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-dynamic-geometry-info-update');
  try {
    xferSourceDynamicGeometryInfoUpdate(
      saver,
      buildSourceDynamicGeometryInfoUpdateState(entity, currentFrame, preservedState),
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceFirestormDynamicGeometryInfoUpdateBlockData(
  data: Uint8Array,
): SourceFirestormDynamicGeometryInfoUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-firestorm-dynamic-geometry-info-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const dynamic = xferSourceDynamicGeometryInfoUpdate(
      xferLoad,
      createDefaultSourceDynamicGeometryInfoUpdateState(),
    );
    const particleSystemIdBytes = xferLoad.xferUser(
      new Uint8Array(SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH),
    );
    const effectsFired = xferLoad.xferBool(false);
    const scorchPlaced = xferLoad.xferBool(false);
    const lastDamageFrame = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        dynamic,
        particleSystemIdBytes,
        effectsFired,
        scorchPlaced,
        lastDamageFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceFirestormDynamicGeometryInfoUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceFirestormDynamicGeometryInfoUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-firestorm-dynamic-geometry-info-update');
  try {
    saver.xferVersion(1);
    xferSourceDynamicGeometryInfoUpdate(
      saver,
      buildSourceDynamicGeometryInfoUpdateState(entity, currentFrame, preservedState.dynamic),
    );
    saver.xferUser(normalizedSourceUserBytes(
      preservedState.particleSystemIdBytes,
      SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH,
    ));
    saver.xferBool(preservedState.effectsFired);
    saver.xferBool(preservedState.scorchPlaced);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.firestormDamageState?.lastDamageFrame,
      preservedState.lastDamageFrame,
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceFirestormDynamicGeometryInfoUpdateBlockState():
  SourceFirestormDynamicGeometryInfoUpdateBlockState {
  return {
    dynamic: createDefaultSourceDynamicGeometryInfoUpdateState(),
    particleSystemIdBytes: new Uint8Array(SOURCE_FIRESTORM_PARTICLE_IDS_BYTE_LENGTH),
    effectsFired: false,
    scorchPlaced: false,
    lastDamageFrame: 0,
  };
}

function buildSourceSmartBombTargetHomingUpdateBlockData(currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-smart-bomb-target-homing-update');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(saver, buildSourceUpdateModuleWakeFrame(currentFrame + 1));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceWeaponSnapshotBlockState {
  version: number;
  templateName: string;
  slot: number;
  status: number;
  ammoInClip: number;
  whenWeCanFireAgain: number;
  whenPreAttackFinished: number;
  whenLastReloadStarted: number;
  lastFireFrame: number;
  suspendFxFrame: number;
  projectileStreamObjectId: number;
  laserObjectIdUnused: number;
  maxShotCount: number;
  currentBarrel: number;
  numShotsForCurrentBarrel: number;
  scatterTargetsUnused: number[];
  pitchLimited: boolean;
  leechWeaponRangeActive: boolean;
}

interface SourceWeaponSaveProfileSnapshot {
  name: string;
  clipSize: number;
  clipReloadFrames: number;
  shotsPerBarrel: number;
  minTargetPitch: number;
  maxTargetPitch: number;
  suspendFXDelayFrames: number;
  scatterTargetCount: number;
}

interface SourceFireWeaponUpdateBlockState {
  nextCallFrameAndPhase: number;
  weapon: SourceWeaponSnapshotBlockState;
  initialDelayFrame: number;
}

interface SourceFireWeaponCollideBlockState {
  weaponPresent: boolean;
  weapon: SourceWeaponSnapshotBlockState;
  everFired: boolean;
}

interface SourceFireWhenDamagedWeaponBlockState {
  weaponPresent: boolean;
  weapon: SourceWeaponSnapshotBlockState;
}

interface SourceFireWhenDamagedBlockState {
  nextCallFrameAndPhase: number;
  upgradeExecuted: boolean;
  reactionWeapons: [
    SourceFireWhenDamagedWeaponBlockState,
    SourceFireWhenDamagedWeaponBlockState,
    SourceFireWhenDamagedWeaponBlockState,
    SourceFireWhenDamagedWeaponBlockState,
  ];
  continuousWeapons: [
    SourceFireWhenDamagedWeaponBlockState,
    SourceFireWhenDamagedWeaponBlockState,
    SourceFireWhenDamagedWeaponBlockState,
    SourceFireWhenDamagedWeaponBlockState,
  ];
}

interface SourceDeployStyleAIUpdateBlockState {
  blockData: Uint8Array;
  state: number;
  frameToWaitForDeploy: number;
}

interface SourceAssaultTransportAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  members: Array<{ entityId: number; isHealing: boolean }>;
  attackMoveGoal: Coord3D;
  designatedTargetId: number;
  assaultState: number;
  framesRemaining: number;
  isAttackMove: boolean;
  isAttackObject: boolean;
}

interface SourceSupplyTruckAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  preferredDockId: number;
  numberBoxes: number;
  forcePending: boolean;
}

interface SourceHackInternetAIUpdateBlockState {
  blockData: Uint8Array;
  stateMachineOffset: number;
  currentStateOffset: number;
  framesRemainingOffset: number;
  pendingCommandOffset: number;
  currentStateId: number;
  framesRemaining: number;
  hasPendingCommand: boolean;
}

interface SourceAICommandStorageBlockState {
  command: number;
  position: Coord3D;
  objectId: number;
}

interface SourceJetAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  version: number;
  producerLocation: Coord3D;
  commandStorageBytes: Uint8Array;
  attackLocoExpireFrame: number;
  attackersMissExpireFrame: number;
  returnToBaseFrame: number;
  targetedBy: number[];
  untargetableExpireFrame: number;
  lockonDrawableTemplateName: string;
  flags: number;
  enginesOn: boolean | null;
}

interface SourceMissileAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  version: number;
  originalTargetPos: Coord3D;
  state: number;
  stateTimestamp: number;
  nextTargetTrackTime: number;
  launcherId: number;
  victimId: number;
  isArmed: boolean;
  fuelExpirationDate: number;
  noTurnDistLeft: number;
  maxAccel: number;
  detonationWeaponTemplateName: string;
  exhaustSystemTemplateName: string;
  isTrackingTarget: boolean;
  prevPos: Coord3D;
  extraBonusFlags: number;
  exhaustIdBytes: Uint8Array;
  framesTillDecoyed: number;
  noDamage: boolean;
  isJammed: boolean;
}

interface SourceRadiusDecalTemplateBlockState {
  name: string;
  shadowTypeBytes: Uint8Array;
  minOpacity: number;
  maxOpacity: number;
  opacityThrobTime: number;
  color: number;
  onlyVisibleToOwningPlayer: boolean;
}

interface SourceDeliverPayloadAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  version: number;
  targetPos: Coord3D;
  moveToPos: Coord3D;
  visibleItemsDelivered: number;
  diveState: number;
  visibleDropBoneName: string;
  visibleSubObjectName: string;
  visiblePayloadTemplateName: string;
  distToTarget: number;
  preOpenDistance: number;
  maxAttempts: number;
  dropOffset: Coord3D;
  dropVariance: Coord3D;
  dropDelay: number;
  fireWeapon: boolean;
  selfDestructObject: boolean;
  visibleNumBones: number;
  diveStartDistance: number;
  diveEndDistance: number;
  strafingWeaponSlot: number;
  visibleItemsDroppedPerInterval: number;
  inheritTransportVelocity: boolean;
  isParachuteDirectly: boolean;
  exitPitchRate: number;
  strafeLength: number;
  visiblePayloadWeaponTemplateName: string;
  deliveryDecalTemplate: SourceRadiusDecalTemplateBlockState;
  deliveryDecalRadius: number;
  hasStateMachine: boolean;
  stateMachineBytes: Uint8Array;
  freeToExit: boolean;
  acceptingCommands: boolean;
  previousDistanceSqr: number;
}

interface SourceDumbProjectileBehaviorBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  launcherId: number;
  victimId: number;
  flightPathSegments: number;
  flightPathSpeed: number;
  flightPathStart: Coord3D;
  flightPathEnd: Coord3D;
  detonationWeaponTemplateName: string;
  lifespanFrame: number;
}

function createDefaultSourceDumbProjectileBehaviorBlockState(
  currentFrame: number,
): SourceDumbProjectileBehaviorBlockState {
  return {
    version: SOURCE_DUMB_PROJECTILE_BEHAVIOR_CURRENT_VERSION,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    launcherId: 0,
    victimId: 0,
    flightPathSegments: 0,
    flightPathSpeed: 0,
    flightPathStart: { x: 0, y: 0, z: 0 },
    flightPathEnd: { x: 0, y: 0, z: 0 },
    detonationWeaponTemplateName: '',
    lifespanFrame: 0,
  };
}

interface SourceMissileAIUpdateRuntimeState {
  originalTargetX?: unknown;
  originalTargetY?: unknown;
  originalTargetZ?: unknown;
  state?: unknown;
  stateTimestamp?: unknown;
  nextTargetTrackTime?: unknown;
  launcherId?: unknown;
  victimId?: unknown;
  isArmed?: unknown;
  fuelExpirationDate?: unknown;
  noTurnDistLeft?: unknown;
  maxAccel?: unknown;
  detonationWeaponTemplateName?: unknown;
  exhaustSystemTemplateName?: unknown;
  isTrackingTarget?: unknown;
  prevX?: unknown;
  prevY?: unknown;
  prevZ?: unknown;
  extraBonusFlags?: unknown;
  exhaustIdBytes?: unknown;
  framesTillDecoyed?: unknown;
  noDamage?: unknown;
  isJammed?: unknown;
}

interface SourceDeliverPayloadAIUpdateRuntimeState {
  targetX?: unknown;
  targetY?: unknown;
  targetZ?: unknown;
  moveToX?: unknown;
  moveToY?: unknown;
  moveToZ?: unknown;
  visibleItemsDelivered?: unknown;
  diveState?: unknown;
  visibleDropBoneName?: unknown;
  visibleSubObjectName?: unknown;
  visiblePayloadTemplateName?: unknown;
  distToTarget?: unknown;
  preOpenDistance?: unknown;
  maxAttempts?: unknown;
  dropOffsetX?: unknown;
  dropOffsetY?: unknown;
  dropOffsetZ?: unknown;
  dropVarianceX?: unknown;
  dropVarianceY?: unknown;
  dropVarianceZ?: unknown;
  dropDelay?: unknown;
  fireWeapon?: unknown;
  selfDestructObject?: unknown;
  visibleNumBones?: unknown;
  diveStartDistance?: unknown;
  diveEndDistance?: unknown;
  strafingWeaponSlot?: unknown;
  visibleItemsDroppedPerInterval?: unknown;
  inheritTransportVelocity?: unknown;
  isParachuteDirectly?: unknown;
  exitPitchRate?: unknown;
  strafeLength?: unknown;
  visiblePayloadWeaponTemplateName?: unknown;
  deliveryDecalTemplateName?: unknown;
  deliveryDecalTemplateShadowTypeBytes?: unknown;
  deliveryDecalTemplateMinOpacity?: unknown;
  deliveryDecalTemplateMaxOpacity?: unknown;
  deliveryDecalTemplateOpacityThrobTime?: unknown;
  deliveryDecalTemplateColor?: unknown;
  deliveryDecalTemplateOnlyVisibleToOwningPlayer?: unknown;
  deliveryDecalRadius?: unknown;
  hasStateMachine?: unknown;
  stateMachineBytes?: unknown;
  freeToExit?: unknown;
  acceptingCommands?: unknown;
  previousDistanceSqr?: unknown;
}

interface SourceDumbProjectileBehaviorRuntimeState {
  nextCallFrameAndPhase?: unknown;
  launcherId?: unknown;
  victimId?: unknown;
  flightPathSegments?: unknown;
  flightPathSpeed?: unknown;
  flightPathStartX?: unknown;
  flightPathStartY?: unknown;
  flightPathStartZ?: unknown;
  flightPathEndX?: unknown;
  flightPathEndY?: unknown;
  flightPathEndZ?: unknown;
  detonationWeaponTemplateName?: unknown;
  lifespanFrame?: unknown;
}

interface SourceRailroadBehaviorPullInfoRuntimeState {
  version?: unknown;
  direction?: unknown;
  speed?: unknown;
  trackDistance?: unknown;
  towHitchPositionX?: unknown;
  towHitchPositionY?: unknown;
  towHitchPositionZ?: unknown;
  mostRecentSpecialPointHandle?: unknown;
  previousWaypoint?: unknown;
  currentWaypoint?: unknown;
}

interface SourceRailroadBehaviorRuntimeState {
  nextStationTaskBytes?: unknown;
  trailerId?: unknown;
  currentPointHandle?: unknown;
  waitAtStationTimer?: unknown;
  carriagesCreated?: unknown;
  hasEverBeenHitched?: unknown;
  waitingInWings?: unknown;
  endOfLine?: unknown;
  isLocomotive?: unknown;
  isLeadCarraige?: unknown;
  wantsToBeLeadCarraige?: unknown;
  disembark?: unknown;
  inTunnel?: unknown;
  conductorStateBytes?: unknown;
  anchorWaypointIdBytes?: unknown;
  pullInfo?: SourceRailroadBehaviorPullInfoRuntimeState | null;
  conductorPullInfo?: SourceRailroadBehaviorPullInfoRuntimeState | null;
  held?: unknown;
}

interface SourceWaveGuideUpdateRuntimeState {
  nextCallFrameAndPhase?: unknown;
  activeFrame?: unknown;
  needDisable?: unknown;
  initialized?: unknown;
  shapePointsBytes?: unknown;
  transformedShapePointsBytes?: unknown;
  shapeEffectsBytes?: unknown;
  shapePointCount?: unknown;
  splashSoundFrame?: unknown;
  finalDestinationX?: unknown;
  finalDestinationY?: unknown;
  finalDestinationZ?: unknown;
}

interface SourceWorkerAIUpdateBlockState {
  blockData: Uint8Array;
  taskOffset: number;
  supplyTailOffset: number;
  tasks: Array<{ targetObjectId: number; taskOrderFrame: number }>;
  preferredDockId: number;
  numberBoxes: number;
  forcePending: boolean;
}

interface SourceChinookAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  version: number;
  flightStatus: number;
  airfieldForHealing: number;
  originalPos: Coord3D | null;
}

interface SourcePOWTruckAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  aiMode: number;
  currentTask: number;
  targetId: number;
  prisonId: number;
  enteredWaitingFrame: number;
  lastFindFrame: number;
}

interface SourceDozerAIUpdateBlockState {
  blockData: Uint8Array;
  taskOffset: number;
  tasks: Array<{ targetObjectId: number; taskOrderFrame: number }>;
}

interface SourceRebuildHoleBehaviorBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  workerId: number;
  reconstructingId: number;
  spawnerId: number;
  workerWaitCounter: number;
  workerTemplateName: string;
  rebuildTemplateName: string;
}

interface SourcePropagandaTowerBehaviorBlockState {
  nextCallFrameAndPhase: number;
  lastScanFrame: number;
  trackedIds: number[];
}

interface SourceBridgeScaffoldBehaviorBlockState {
  nextCallFrameAndPhase: number;
  targetMotion: number;
  createPos: Coord3D;
  riseToPos: Coord3D;
  buildPos: Coord3D;
  lateralSpeed: number;
  verticalSpeed: number;
  targetPos: Coord3D;
}

interface SourceBridgeBehaviorBlockState {
  nextCallFrameAndPhase: number;
  towerIds: number[];
  scaffoldPresent: boolean;
  scaffoldIds: number[];
  deathFrame: number;
}

interface SourceBridgeTowerBehaviorBlockState {
  bridgeId: number;
  towerType: number;
}

const SOURCE_BRIDGE_MAX_TOWERS = 4;

interface SourceSpecialPowerCompletionDieBlockState {
  creatorId: number;
  creatorSet: boolean;
}

interface SourceParkingPlaceBehaviorBlockState {
  nextCallFrameAndPhase: number;
  spaces: Array<{ occupantId: number; reservedForExit: boolean }>;
  runways: Array<{ inUseBy: number; nextInLineForTakeoff: number; wasInLine: boolean }>;
  healees: Array<{ entityId: number; healStartFrame: number }>;
  heliRallyPoint: Coord3D;
  heliRallyPointExists: boolean;
  nextHealFrame: number;
}

interface SourceFlightDeckBehaviorBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  spaces: number[];
  runways: Array<{ takeoffId: number; landingId: number }>;
  healees: Array<{ entityId: number; healStartFrame: number }>;
  nextHealFrame: number;
  nextCleanupFrame: number;
  startedProductionFrame: number;
  nextAllowedProductionFrame: number;
  designatedTargetId: number;
  designatedCommandType: number;
  designatedPosition: Coord3D;
  nextLaunchWaveFrame: number[];
  rampUpFrame: number[];
  catapultSystemFrame: number[];
  lowerRampFrame: number[];
  rampUpXferFlags: boolean[];
}

const SOURCE_FLIGHT_DECK_MAX_RUNWAYS = 2;

interface SourceBaseOnlyUpdateModuleBlockState {
  nextCallFrameAndPhase: number;
}

interface SourceSlowDeathBehaviorBlockState {
  nextCallFrameAndPhase: number;
  sinkFrame: number;
  midpointFrame: number;
  destructionFrame: number;
  acceleratedTimeScale: number;
  flags: number;
}

interface SourceBattleBusSlowDeathBehaviorBlockState {
  slowDeath: SourceSlowDeathBehaviorBlockState;
  isRealDeath: boolean;
  isInFirstDeath: boolean;
  groundCheckFrame: number;
  penaltyDeathFrame: number;
}

interface SourceHelicopterSlowDeathBehaviorBlockState {
  slowDeath: SourceSlowDeathBehaviorBlockState;
  orbitDirection: number;
  forwardAngle: number;
  forwardSpeed: number;
  selfSpin: number;
  selfSpinTowardsMax: boolean;
  lastSelfSpinUpdateFrame: number;
  bladeFlyOffFrame: number;
  hitGroundFrame: number;
}

interface SourceJetSlowDeathBehaviorBlockState {
  slowDeath: SourceSlowDeathBehaviorBlockState;
  timerDeathFrame: number;
  timerOnGroundFrame: number;
  rollRate: number;
}

interface SourceNeutronMissileSlowDeathBehaviorBlockState {
  slowDeath: SourceSlowDeathBehaviorBlockState;
  activationFrame: number;
  completedBlasts: boolean[];
  completedScorchBlasts: boolean[];
  scorchPlaced: boolean;
}

interface SourceProductionExitRallyState {
  nextCallFrameAndPhase: number;
  rallyPoint: Coord3D;
  rallyPointExists: boolean;
}

interface SourceQueueProductionExitBlockState extends SourceProductionExitRallyState {
  currentDelay: number;
  creationClearDistance: number;
  currentBurstCount: number;
}

interface SourceSpawnPointProductionExitBlockState {
  nextCallFrameAndPhase: number;
  occupierIds: number[];
}

interface SourceDockUpdateBlockState {
  nextCallFrameAndPhase: number;
  enterPosition: Coord3D;
  dockPosition: Coord3D;
  exitPosition: Coord3D;
  numberApproachPositions: number;
  positionsLoaded: boolean;
  approachPositions: Coord3D[];
  approachPositionOwners: number[];
  approachPositionReached: boolean[];
  activeDocker: number;
  dockerInside: boolean;
  dockCrippled: boolean;
  dockOpen: boolean;
}

interface SourceSupplyWarehouseDockUpdateBlockState {
  dock: SourceDockUpdateBlockState;
  boxesStored: number;
}

interface SourceRepairDockUpdateBlockState {
  dock: SourceDockUpdateBlockState;
  lastRepair: number;
  healthToAddPerFrame: number;
}

interface SourceRailedTransportAIUpdateBlockState {
  blockData: Uint8Array;
  tailOffset: number;
  inTransit: boolean;
  paths: Array<{ startWaypointID: number; endWaypointID: number }>;
  currentPath: number;
  waypointDataLoaded: boolean;
}

interface SourceRailedTransportDockUpdateBlockState {
  dock: SourceDockUpdateBlockState;
  dockingObjectId: number;
  pullInsideDistancePerFrame: number;
  unloadingObjectId: number;
  pushOutsideDistancePerFrame: number;
  unloadCount: number;
}

interface SourceSupplyWarehouseCripplingBehaviorBlockState {
  nextCallFrameAndPhase: number;
  healingSuppressedUntilFrame: number;
  nextHealingFrame: number;
}

interface SourceSpawnBehaviorBlockState {
  version: number;
  initialBurstTimesInited: boolean;
  spawnTemplateName: string;
  oneShotCountdown: number;
  framesToWait: number;
  firstBatchCount: number;
  replacementTimes: number[];
  spawnIds: number[];
  active: boolean;
  aggregateHealth: boolean;
  spawnCount: number;
  selfTaskingSpawnCount: number;
}

function createDefaultSourceWeaponSnapshotState(): SourceWeaponSnapshotBlockState {
  return {
    version: 3,
    templateName: '',
    slot: 0,
    status: SOURCE_WEAPON_STATUS_READY_TO_FIRE,
    ammoInClip: 0,
    whenWeCanFireAgain: 0,
    whenPreAttackFinished: 0,
    whenLastReloadStarted: 0,
    lastFireFrame: 0,
    suspendFxFrame: 0,
    projectileStreamObjectId: 0,
    laserObjectIdUnused: 0,
    maxShotCount: 0,
    currentBarrel: 0,
    numShotsForCurrentBarrel: 0,
    scatterTargetsUnused: [],
    pitchLimited: false,
    leechWeaponRangeActive: false,
  };
}

function sourceWeaponProfileNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sourceWeaponProfileInt(value: unknown, fallback: number): number {
  return Math.trunc(sourceWeaponProfileNumber(value, fallback));
}

function sourceWeaponSaveProfileFromUnknown(value: unknown): SourceWeaponSaveProfileSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const profile = value as Record<string, unknown>;
  const name = typeof profile.name === 'string' && profile.name.trim()
    ? profile.name.trim()
    : '';
  if (!name) {
    return null;
  }
  return {
    name,
    clipSize: Math.max(0, sourceWeaponProfileInt(profile.clipSize, 0)),
    clipReloadFrames: Math.max(0, sourceWeaponProfileInt(profile.clipReloadFrames, 0)),
    shotsPerBarrel: Math.max(1, sourceWeaponProfileInt(profile.shotsPerBarrel, 1)),
    minTargetPitch: sourceWeaponProfileNumber(profile.minTargetPitch, -Math.PI),
    maxTargetPitch: sourceWeaponProfileNumber(profile.maxTargetPitch, Math.PI),
    suspendFXDelayFrames: Math.max(0, sourceWeaponProfileInt(profile.suspendFXDelayFrames, 0)),
    scatterTargetCount: Math.max(0, sourceWeaponProfileInt(profile.scatterTargetCount, 0)),
  };
}

function requireSourceWeaponSaveProfile(
  sourceProfile: unknown,
  moduleType: string,
  moduleTag: string,
  weaponName: string | null | undefined,
): SourceWeaponSaveProfileSnapshot {
  const profile = sourceWeaponSaveProfileFromUnknown(sourceProfile);
  if (profile) {
    return profile;
  }
  const resolvedWeaponName = weaponName?.trim() || '<missing weapon>';
  throw new Error(
    `Cannot synthesize source ${moduleType} "${moduleTag}" without Weapon::xfer template fields for ${resolvedWeaponName}.`,
  );
}

function sourceWeaponScatterTargetIndices(profile: SourceWeaponSaveProfileSnapshot): number[] {
  return Array.from(
    { length: Math.min(0xffff, profile.scatterTargetCount) },
    (_unused, index) => index,
  );
}

function buildSourceWeaponSnapshotFromProfile(
  profile: SourceWeaponSaveProfileSnapshot,
  currentFrame: number,
  options: {
    status: number;
    ammoInClip: number;
    whenWeCanFireAgain: number;
    whenLastReloadStarted: number;
    scatterTargetsUnused: number[];
  },
): SourceWeaponSnapshotBlockState {
  return {
    version: 3,
    templateName: profile.name,
    slot: 0,
    status: options.status,
    ammoInClip: options.ammoInClip,
    whenWeCanFireAgain: options.whenWeCanFireAgain,
    whenPreAttackFinished: 0,
    whenLastReloadStarted: options.whenLastReloadStarted,
    lastFireFrame: 0,
    suspendFxFrame: sourceFlammableUnsignedFrame(currentFrame + profile.suspendFXDelayFrames),
    projectileStreamObjectId: 0,
    laserObjectIdUnused: 0,
    maxShotCount: SOURCE_WEAPON_NO_MAX_SHOTS_LIMIT,
    currentBarrel: 0,
    numShotsForCurrentBarrel: profile.shotsPerBarrel,
    scatterTargetsUnused: options.scatterTargetsUnused,
    pitchLimited: profile.minTargetPitch > -Math.PI || profile.maxTargetPitch < Math.PI,
    leechWeaponRangeActive: false,
  };
}

function buildSourceWeaponConstructorSnapshot(
  profile: SourceWeaponSaveProfileSnapshot,
  currentFrame: number,
): SourceWeaponSnapshotBlockState {
  return buildSourceWeaponSnapshotFromProfile(profile, currentFrame, {
    status: SOURCE_WEAPON_STATUS_OUT_OF_AMMO,
    ammoInClip: 0,
    whenWeCanFireAgain: 0,
    whenLastReloadStarted: 0,
    scatterTargetsUnused: [],
  });
}

function buildSourceWeaponLoadedSnapshot(
  profile: SourceWeaponSaveProfileSnapshot,
  currentFrame: number,
  whenWeCanFireAgain: number,
): SourceWeaponSnapshotBlockState {
  const ammoInClip = profile.clipSize > 0 ? profile.clipSize : SOURCE_WEAPON_UNLIMITED_CLIP_AMMO;
  return buildSourceWeaponSnapshotFromProfile(profile, currentFrame, {
    status: whenWeCanFireAgain > currentFrame
      ? SOURCE_WEAPON_STATUS_BETWEEN_FIRING_SHOTS
      : SOURCE_WEAPON_STATUS_RELOADING_CLIP,
    ammoInClip,
    whenWeCanFireAgain,
    whenLastReloadStarted: currentFrame,
    scatterTargetsUnused: sourceWeaponScatterTargetIndices(profile),
  });
}

function xferSourceCollideModuleBase(xfer: Xfer): void {
  const collideVersion = xfer.xferVersion(1);
  if (collideVersion !== 1) {
    throw new Error(`Unsupported source CollideModule version ${collideVersion}`);
  }
  xferSourceBehaviorModuleBase(xfer);
}

function xferSourceWeaponSnapshot(
  xfer: Xfer,
  state: SourceWeaponSnapshotBlockState,
): SourceWeaponSnapshotBlockState {
  const version = xfer.xferVersion(state.version);
  if (version < 1 || version > 3) {
    throw new Error(`Unsupported source Weapon version ${version}`);
  }
  const templateName = version >= 2 ? xfer.xferAsciiString(state.templateName) : '';
  const slot = xfer.xferInt(state.slot);
  const status = xfer.xferInt(state.status);
  const ammoInClip = xfer.xferUnsignedInt(state.ammoInClip);
  const whenWeCanFireAgain = xfer.xferUnsignedInt(state.whenWeCanFireAgain);
  const whenPreAttackFinished = xfer.xferUnsignedInt(state.whenPreAttackFinished);
  const whenLastReloadStarted = xfer.xferUnsignedInt(state.whenLastReloadStarted);
  const lastFireFrame = xfer.xferUnsignedInt(state.lastFireFrame);
  const suspendFxFrame = version >= 3 ? xfer.xferUnsignedInt(state.suspendFxFrame) : 0;
  const projectileStreamObjectId = xfer.xferObjectID(state.projectileStreamObjectId);
  const laserObjectIdUnused = xfer.xferObjectID(state.laserObjectIdUnused);
  const scatterTargetsInput = Array.isArray(state.scatterTargetsUnused) ? state.scatterTargetsUnused : [];
  const maxShotCount = xfer.xferInt(state.maxShotCount);
  const currentBarrel = xfer.xferInt(state.currentBarrel);
  const numShotsForCurrentBarrel = xfer.xferInt(state.numShotsForCurrentBarrel);
  const scatterCount = xfer.xferUnsignedShort(scatterTargetsInput.length);
  const scatterTargetsUnused: number[] = [];
  for (let index = 0; index < scatterCount; index += 1) {
    scatterTargetsUnused.push(xfer.xferInt(scatterTargetsInput[index] ?? 0));
  }
  const pitchLimited = xfer.xferBool(state.pitchLimited);
  const leechWeaponRangeActive = xfer.xferBool(state.leechWeaponRangeActive);
  return {
    version,
    templateName,
    slot,
    status,
    ammoInClip,
    whenWeCanFireAgain,
    whenPreAttackFinished,
    whenLastReloadStarted,
    lastFireFrame,
    suspendFxFrame,
    projectileStreamObjectId,
    laserObjectIdUnused,
    maxShotCount,
    currentBarrel,
    numShotsForCurrentBarrel,
    scatterTargetsUnused,
    pitchLimited,
    leechWeaponRangeActive,
  };
}

function xferSourceFireWhenDamagedWeapon(
  xfer: Xfer,
  state: SourceFireWhenDamagedWeaponBlockState,
): SourceFireWhenDamagedWeaponBlockState {
  const weaponPresent = xfer.xferBool(state.weaponPresent);
  return {
    weaponPresent,
    weapon: weaponPresent
      ? xferSourceWeaponSnapshot(xfer, state.weapon)
      : state.weapon,
  };
}

function createSourceFireWhenDamagedWeaponState(
  weaponPresent: boolean,
  weapon: SourceWeaponSnapshotBlockState = createDefaultSourceWeaponSnapshotState(),
): SourceFireWhenDamagedWeaponBlockState {
  return { weaponPresent, weapon };
}

function tryParseSourceFireWhenDamagedBlockData(
  data: Uint8Array,
): SourceFireWhenDamagedBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-fire-weapon-when-damaged');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const upgradeMuxVersion = xferLoad.xferVersion(1);
    if (upgradeMuxVersion !== 1) {
      return null;
    }
    const upgradeExecuted = xferLoad.xferBool(false);
    const reactionWeapons = [
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
    ] as SourceFireWhenDamagedBlockState['reactionWeapons'];
    const continuousWeapons = [
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
      xferSourceFireWhenDamagedWeapon(xferLoad, createSourceFireWhenDamagedWeaponState(false)),
    ] as SourceFireWhenDamagedBlockState['continuousWeapons'];
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        upgradeExecuted,
        reactionWeapons,
        continuousWeapons,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceFireWeaponUpdateBlockData(
  data: Uint8Array,
): SourceFireWeaponUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-fire-weapon-update');
  try {
    const version = xferLoad.xferVersion(2);
    if (version < 1 || version > 2) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const weapon = xferSourceWeaponSnapshot(xferLoad, createDefaultSourceWeaponSnapshotState());
    const initialDelayFrame = version >= 2 ? xferLoad.xferUnsignedInt(0) : 0;
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        weapon,
        initialDelayFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceFireWeaponCollideBlockData(
  data: Uint8Array,
): SourceFireWeaponCollideBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-fire-weapon-collide');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferSourceCollideModuleBase(xferLoad);
    const weaponPresent = xferLoad.xferBool(false);
    const weapon = weaponPresent
      ? xferSourceWeaponSnapshot(xferLoad, createDefaultSourceWeaponSnapshotState())
      : createDefaultSourceWeaponSnapshotState();
    const everFired = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? {
        weaponPresent,
        weapon,
        everFired,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function findLiveSourceFireWeaponCollideProfileIndex(
  entity: MapEntity,
  moduleTag: string,
  preservedState: SourceFireWeaponCollideBlockState,
): number {
  const profiles = entity.fireWeaponCollideProfiles ?? [];
  if (profiles.length === 0) {
    return -1;
  }
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const tagMatch = profiles.findIndex(
    (profile) => normalizeSourceObjectModuleTag(profile.moduleTag) === normalizedModuleTag,
  );
  if (tagMatch >= 0) {
    return tagMatch;
  }

  const normalizedWeaponName = preservedState.weapon.templateName.trim().toUpperCase();
  const weaponMatches = profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => profile.collideWeapon.trim().toUpperCase() === normalizedWeaponName);
  if (weaponMatches.length === 1) {
    return weaponMatches[0]!.index;
  }
  return profiles.length === 1 ? 0 : -1;
}

function buildSourceFireWeaponCollideBlockData(
  entity: MapEntity,
  moduleTag: string,
  preservedState: SourceFireWeaponCollideBlockState,
): Uint8Array | null {
  const profileIndex = findLiveSourceFireWeaponCollideProfileIndex(entity, moduleTag, preservedState);
  if (profileIndex < 0) {
    return null;
  }
  const profile = entity.fireWeaponCollideProfiles[profileIndex]!;
  const saver = new XferSave();
  saver.open('build-source-fire-weapon-collide');
  try {
    saver.xferVersion(1);
    xferSourceCollideModuleBase(saver);
    saver.xferBool(preservedState.weaponPresent);
    if (preservedState.weaponPresent) {
      xferSourceWeaponSnapshot(saver, {
        ...preservedState.weapon,
        version: 3,
        templateName: profile.collideWeapon || preservedState.weapon.templateName,
      });
    }
    saver.xferBool(
      typeof entity.fireWeaponCollideEverFired?.[profileIndex] === 'boolean'
        ? entity.fireWeaponCollideEverFired[profileIndex]!
        : preservedState.everFired,
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceDeployStyleStateToInt(state: unknown, fallback: number): number {
  switch (state) {
    case 'READY_TO_MOVE': return 0;
    case 'DEPLOY': return 1;
    case 'READY_TO_ATTACK': return 2;
    case 'UNDEPLOY': return 3;
    default:
      return Number.isFinite(fallback) ? Math.max(0, Math.trunc(fallback)) : 0;
  }
}

const SOURCE_AI_STATE_IDLE = 0;
const SOURCE_HACK_INTERNET_STATE_UNPACKING = 1000;
const SOURCE_HACK_INTERNET_STATE_HACKING = 1001;
const SOURCE_HACK_INTERNET_STATE_PACKING = 1002;
const SOURCE_HACK_INTERNET_AI_STATE_MACHINE_OFFSET = 18;
const SOURCE_HACK_INTERNET_STATE_SNAPSHOT_BYTE_LENGTH = 5;
const SOURCE_AICMD_MOVE_TO_POSITION = 0;
const SOURCE_AICMD_IDLE = 5;
const SOURCE_AICMD_ATTACK_OBJECT = 11;
const SOURCE_AI_FAST_AS_POSSIBLE = 999999.0;
const SOURCE_AI_PRIOR_WAYPOINT_DEFAULT = 0xfacade;
const SOURCE_AI_CURRENT_WAYPOINT_DEFAULT = 0xfacade;
const SOURCE_AI_INVALID_WAYPOINT_ID = 0x7fffffff;
const SOURCE_AI_CMD_FROM_AI = 2;
const SOURCE_AI_GUARDTARGET_NONE = 3;
const SOURCE_AI_TURRET_INVALID = -1;
const SOURCE_AI_ATTITUDE_NORMAL = 0;
const SOURCE_AI_INVALID_STATE_ID = 999999;
const SOURCE_AI_MAX_TURRETS = 2;
const SOURCE_LOCOMOTOR_SET_TYPE_BY_NAME = new Map<string, number>([
  ['SET_NORMAL', 0],
  ['SET_NORMAL_UPGRADED', 1],
  ['SET_FREEFALL', 2],
  ['SET_WANDER', 3],
  ['SET_PANIC', 4],
  ['SET_TAXIING', 5],
  ['SET_SUPERSONIC', 6],
  ['SET_SLUGGISH', 7],
]);
const SOURCE_JET_FLAG_HAS_PENDING_COMMAND = 1 << 0;
const SOURCE_JET_FLAG_ALLOW_AIR_LOCO = 1 << 1;
const SOURCE_JET_FLAG_HAS_PRODUCER_LOCATION = 1 << 2;
const SOURCE_JET_FLAG_TAKEOFF_IN_PROGRESS = 1 << 3;
const SOURCE_JET_FLAG_LANDING_IN_PROGRESS = 1 << 4;
const SOURCE_JET_FLAG_USE_SPECIAL_RETURN_LOCO = 1 << 5;
const SOURCE_JET_TARGETED_BY_LIMIT = 0xffff;
const SOURCE_MISSILE_AI_UPDATE_CURRENT_VERSION = 6;
const SOURCE_MISSILE_AI_STATE_MIN = 0;
const SOURCE_MISSILE_AI_STATE_MAX = 7;
const SOURCE_DELIVER_PAYLOAD_AI_UPDATE_CURRENT_VERSION = 5;
const SOURCE_DELIVER_PAYLOAD_DIVE_STATE_MIN = 0;
const SOURCE_DELIVER_PAYLOAD_DIVE_STATE_MAX = 2;
const SOURCE_DUMB_PROJECTILE_BEHAVIOR_CURRENT_VERSION = 1;

function isSourceHackInternetStateId(value: number): boolean {
  return value === SOURCE_AI_STATE_IDLE
    || value === SOURCE_HACK_INTERNET_STATE_UNPACKING
    || value === SOURCE_HACK_INTERNET_STATE_HACKING
    || value === SOURCE_HACK_INTERNET_STATE_PACKING;
}

function isSourceBoolByte(value: number): boolean {
  return value === 0 || value === 1;
}

function sourceAIUnsignedFrame(value: unknown, fallback: number): number {
  return sourceFlammableUnsignedFrame(value, fallback);
}

function sourceAILocomotorSetType(setName: unknown): number {
  if (typeof setName !== 'string') {
    return -1;
  }
  return SOURCE_LOCOMOTOR_SET_TYPE_BY_NAME.get(setName.trim().toUpperCase()) ?? -1;
}

function sourceAIIdleInitialSleepOffset(entity: MapEntity): number {
  const value = (entity as { sourceAIIdleInitialSleepOffset?: unknown }).sourceAIIdleInitialSleepOffset;
  return Number.isFinite(value)
    ? Math.max(0, Math.min(0xffff, Math.trunc(Number(value))))
    : 0;
}

function buildGeneratedSourceAIStateMachineBlockData(entity: MapEntity): Uint8Array {
  const saver = new XferSave();
  saver.open('build-generated-source-ai-state-machine');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(SOURCE_AI_STATE_IDLE);
    saver.xferUnsignedInt(SOURCE_AI_STATE_IDLE);
    saver.xferBool(false);
    saver.xferVersion(1);
    saver.xferUnsignedShort(sourceAIIdleInitialSleepOffset(entity));
    saver.xferBool(true);
    saver.xferBool(true);
    saver.xferObjectID(0);
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferBool(false);
    saver.xferBool(true);
    saver.xferInt(0);
    saver.xferAsciiString('');
    saver.xferBool(false);
    saver.xferUnsignedInt(SOURCE_AI_INVALID_STATE_ID);
    saver.xferUnsignedInt(0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function xferGeneratedSourceLocomotorSnapshot(
  saver: XferSave,
  snapshot: {
    donutTimer?: unknown;
    maintainPos?: unknown;
    brakingFactor?: unknown;
    maxLift?: unknown;
    maxSpeed?: unknown;
    maxAccel?: unknown;
    maxBraking?: unknown;
    maxTurnRate?: unknown;
    closeEnoughDist?: unknown;
    flags?: unknown;
    preferredHeight?: unknown;
    preferredHeightDamping?: unknown;
    angleOffset?: unknown;
    offsetIncrement?: unknown;
  },
): void {
  const maintainPos = snapshot.maintainPos && typeof snapshot.maintainPos === 'object'
    ? snapshot.maintainPos as Partial<Coord3D>
    : {};
  const real = (value: unknown, fallback: number) => Number.isFinite(value) ? Number(value) : fallback;
  saver.xferVersion(2);
  saver.xferUnsignedInt(sourceAIUnsignedFrame(snapshot.donutTimer, 0));
  saver.xferCoord3D({
    x: real(maintainPos.x, 0),
    y: real(maintainPos.y, 0),
    z: real(maintainPos.z, 0),
  });
  saver.xferReal(real(snapshot.brakingFactor, 1.0));
  saver.xferReal(real(snapshot.maxLift, 99999.0));
  saver.xferReal(real(snapshot.maxSpeed, 99999.0));
  saver.xferReal(real(snapshot.maxAccel, 99999.0));
  saver.xferReal(real(snapshot.maxBraking, 99999.0));
  saver.xferReal(real(snapshot.maxTurnRate, 99999.0));
  saver.xferReal(real(snapshot.closeEnoughDist, 1.0));
  saver.xferUnsignedInt(sourceFiniteInt(snapshot.flags, 0));
  saver.xferReal(real(snapshot.preferredHeight, 0));
  saver.xferReal(real(snapshot.preferredHeightDamping, 1));
  saver.xferReal(real(snapshot.angleOffset, 0));
  saver.xferReal(real(snapshot.offsetIncrement, 0));
}

function xferGeneratedSourceLocomotorSetAndCurLocoPtr(saver: XferSave, entity: MapEntity): void {
  const activeSetName = typeof entity.activeLocomotorSet === 'string' ? entity.activeLocomotorSet : 'SET_NORMAL';
  const activeProfile = entity.locomotorSets?.get(activeSetName)
    ?? entity.locomotorSets?.get('SET_NORMAL')
    ?? null;
  if (!activeProfile) {
    saver.xferVersion(1);
    saver.xferUnsignedShort(0);
    saver.xferInt(0);
    saver.xferBool(false);
    saver.xferAsciiString('');
    return;
  }

  const snapshots = Array.isArray(activeProfile.sourceLocomotorSnapshots)
    ? activeProfile.sourceLocomotorSnapshots
    : [];
  if (snapshots.length > 0xffff) {
    throw new Error(`Cannot serialize ${snapshots.length} locomotors in source LocomotorSet.`);
  }

  saver.xferVersion(1);
  saver.xferUnsignedShort(snapshots.length);
  for (const snapshot of snapshots) {
    const templateName = typeof snapshot.templateName === 'string' ? snapshot.templateName : '';
    if (!templateName) {
      throw new Error(`Cannot serialize source LocomotorSet for ${entity.templateName}: missing locomotor template name.`);
    }
    saver.xferAsciiString(templateName);
    xferGeneratedSourceLocomotorSnapshot(saver, snapshot);
  }
  saver.xferInt(sourceFiniteInt(activeProfile.surfaceMask, 0));
  saver.xferBool(activeProfile.downhillOnly === true);
  const currentTemplateName = typeof activeProfile.sourceCurrentLocomotorTemplateName === 'string'
    && activeProfile.sourceCurrentLocomotorTemplateName.length > 0
    ? activeProfile.sourceCurrentLocomotorTemplateName
    : (snapshots[0]?.templateName ?? '');
  saver.xferAsciiString(currentTemplateName);
}

function buildGeneratedSourceAIUpdateInterfaceBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-generated-source-ai-update-interface');
  try {
    saver.xferVersion(4);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedInt(SOURCE_AI_PRIOR_WAYPOINT_DEFAULT);
    saver.xferUnsignedInt(SOURCE_AI_CURRENT_WAYPOINT_DEFAULT);
    saver.xferUser(buildGeneratedSourceAIStateMachineBlockData(entity));
    saver.xferBool(false);
    saver.xferBool(entity.scriptAiRecruitable !== false);
    saver.xferUnsignedInt(0);
    saver.xferObjectID(normalizeSourceObjectId(entity.attackTargetEntityId ?? 0));
    saver.xferReal(SOURCE_AI_FAST_AS_POSSIBLE);
    saver.xferUser(buildSourceRawInt32Bytes(SOURCE_AI_CMD_FROM_AI));
    saver.xferUser(buildSourceRawInt32Bytes(SOURCE_AI_GUARDTARGET_NONE));
    saver.xferUser(buildSourceRawInt32Bytes(SOURCE_AI_GUARDTARGET_NONE));
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferObjectID(0);
    saver.xferAsciiString('');
    saver.xferAsciiString(typeof entity.scriptAttackPrioritySetName === 'string'
      ? entity.scriptAttackPrioritySetName
      : '');
    saver.xferInt(0);
    saver.xferInt(0);
    saver.xferBool(false);
    saver.xferUnsignedInt(SOURCE_AI_INVALID_WAYPOINT_ID);
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferObjectID(0);
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferObjectID(normalizeSourceObjectId(entity.ignoredMovementObstacleId ?? 0));
    saver.xferReal(0);
    saver.xferICoord2D(entity.pathfindGoalCell
      ? { x: entity.pathfindGoalCell.x, y: entity.pathfindGoalCell.z }
      : { x: -1, y: -1 });
    saver.xferICoord2D(entity.pathfindPosCell
      ? { x: entity.pathfindPosCell.x, y: entity.pathfindPosCell.z }
      : { x: -1, y: -1 });
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(0);
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferBool(false);
    saver.xferBool(entity.locomotorUpgradeEnabled === true);
    saver.xferBool(false);
    saver.xferBool(true);
    saver.xferObjectID(0);
    saver.xferObjectID(0);
    saver.xferObjectID(0);
    saver.xferObjectID(0);
    xferGeneratedSourceLocomotorSetAndCurLocoPtr(saver, entity);
    saver.xferUser(buildSourceRawInt32Bytes(sourceAILocomotorSetType(entity.activeLocomotorSet)));
    saver.xferUser(buildSourceRawInt32Bytes(0));
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    for (let index = 0; index < SOURCE_AI_MAX_TURRETS; index += 1) {
      // Null turret pointers are not serialized; this loop documents MAX_TURRETS ordering.
    }
    saver.xferUser(buildSourceRawInt32Bytes(SOURCE_AI_TURRET_INVALID));
    saver.xferUser(buildSourceRawInt32Bytes(sourceFiniteInt(entity.scriptAttitude, SOURCE_AI_ATTITUDE_NORMAL)));
    saver.xferUnsignedInt(sourceAIUnsignedFrame(entity.autoTargetScanNextFrame, currentFrame));
    saver.xferObjectID(0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceAsciiStringEndOffset(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset >= data.byteLength) {
    return null;
  }
  const length = data[offset] ?? 0;
  const endOffset = offset + 1 + length;
  return endOffset <= data.byteLength ? endOffset : null;
}

function tryParseSourceAICommandStorage(xferLoad: XferLoad): SourceAICommandStorageBlockState | null {
  try {
    const command = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const duplicateCommand = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    if (command !== duplicateCommand) {
      return null;
    }
    const position = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const objectId = xferLoad.xferObjectID(0);
    xferLoad.xferObjectID(0);
    xferLoad.xferAsciiString('');
    const coordCount = xferLoad.xferInt(0);
    if (coordCount < 0 || coordCount > 256) {
      return null;
    }
    for (let index = 0; index < coordCount; index += 1) {
      xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    }
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferAsciiString('');
    xferLoad.xferInt(0);
    xferSourceDamageInfo(xferLoad, createDefaultSourceDamageInfoState());
    xferLoad.xferAsciiString('');
    const hasPath = xferLoad.xferBool(false);
    return hasPath ? null : { command, position, objectId };
  } catch {
    return null;
  }
}

function findSourceHackInternetAIStateMachineBlock(data: Uint8Array): {
  offset: number;
  currentStateOffset: number;
  framesRemainingOffset: number;
  currentStateId: number;
  framesRemaining: number;
} | null {
  if (data.byteLength < 44 || data[0] !== 1) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = SOURCE_HACK_INTERNET_AI_STATE_MACHINE_OFFSET;
    offset + 43 <= data.byteLength;
    offset += 1
  ) {
    if (data[offset] !== 1 || data[offset + 1] !== 1 || data[offset + 14] !== 0 || data[offset + 15] !== 1) {
      continue;
    }
    const defaultStateId = view.getUint32(offset + 6, true);
    const currentStateId = view.getUint32(offset + 10, true);
    if (defaultStateId !== SOURCE_AI_STATE_IDLE || !isSourceHackInternetStateId(currentStateId)) {
      continue;
    }
    if (!isSourceBoolByte(data[offset + 36] ?? 2) || !isSourceBoolByte(data[offset + 37] ?? 2)) {
      continue;
    }

    const goalPathCount = view.getInt32(offset + 38, true);
    if (goalPathCount < 0 || goalPathCount > 256) {
      continue;
    }
    const waypointNameOffset = offset + 42 + goalPathCount * 12;
    if (sourceAsciiStringEndOffset(data, waypointNameOffset) === null) {
      continue;
    }

    return {
      offset,
      currentStateOffset: offset + 10,
      framesRemainingOffset: offset + 16,
      currentStateId,
      framesRemaining: currentStateId === SOURCE_AI_STATE_IDLE
        ? 0
        : view.getUint32(offset + 16, true),
    };
  }
  return null;
}

function tryParseSourceAICommandStorageToEnd(data: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset >= data.byteLength) {
    return false;
  }
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data.subarray(offset)));
  xferLoad.open('parse-source-ai-command-storage');
  try {
    return tryParseSourceAICommandStorage(xferLoad) !== null && xferLoad.getRemaining() === 0;
  } catch {
    return false;
  } finally {
    xferLoad.close();
  }
}

function findSourceHackInternetPendingCommandOffset(
  data: Uint8Array,
  searchStartOffset: number,
): { offset: number; hasPendingCommand: boolean } | null {
  if (data.byteLength < 1) {
    return null;
  }
  const lastByte = data[data.byteLength - 1] ?? 2;
  if (lastByte === 0) {
    return { offset: data.byteLength - 1, hasPendingCommand: false };
  }

  for (let offset = Math.max(1, searchStartOffset); offset < data.byteLength; offset += 1) {
    if (data[offset] !== 1) {
      continue;
    }
    if (tryParseSourceAICommandStorageToEnd(data, offset + 1)) {
      return { offset, hasPendingCommand: true };
    }
  }
  return null;
}

function tryParseSourceHackInternetAIUpdateBlockData(
  data: Uint8Array,
): SourceHackInternetAIUpdateBlockState | null {
  const stateMachine = findSourceHackInternetAIStateMachineBlock(data);
  if (!stateMachine) {
    return null;
  }
  const stateMachineEndSearchOffset = stateMachine.offset
    + 42
    + SOURCE_HACK_INTERNET_STATE_SNAPSHOT_BYTE_LENGTH;
  const pendingCommand = findSourceHackInternetPendingCommandOffset(data, stateMachineEndSearchOffset);
  if (!pendingCommand) {
    return null;
  }
  return {
    blockData: new Uint8Array(data),
    stateMachineOffset: stateMachine.offset,
    currentStateOffset: stateMachine.currentStateOffset,
    framesRemainingOffset: stateMachine.framesRemainingOffset,
    pendingCommandOffset: pendingCommand.offset,
    currentStateId: stateMachine.currentStateId,
    framesRemaining: stateMachine.framesRemaining,
    hasPendingCommand: pendingCommand.hasPendingCommand,
  };
}

function sourceHackInternetStateForEntity(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceHackInternetAIUpdateBlockState,
): { stateId: number; framesRemaining: number } {
  const pending = entity.hackInternetPendingCommand;
  if (pending) {
    return {
      stateId: SOURCE_HACK_INTERNET_STATE_PACKING,
      framesRemaining: sourceFlammableUnsignedFrame(
        Number(pending.executeFrame) - currentFrame,
        preservedState.framesRemaining,
      ),
    };
  }
  const hackState = entity.hackInternetRuntimeState;
  if (hackState) {
    return {
      stateId: SOURCE_HACK_INTERNET_STATE_HACKING,
      framesRemaining: sourceFlammableUnsignedFrame(
        Number(hackState.nextCashFrame) - currentFrame,
        preservedState.framesRemaining,
      ),
    };
  }
  return {
    stateId: preservedState.currentStateId === SOURCE_HACK_INTERNET_STATE_HACKING
      || preservedState.currentStateId === SOURCE_HACK_INTERNET_STATE_UNPACKING
      || preservedState.currentStateId === SOURCE_HACK_INTERNET_STATE_PACKING
      ? SOURCE_AI_STATE_IDLE
      : preservedState.currentStateId,
    framesRemaining: 0,
  };
}

function sourceCommandTypeForPendingHackCommand(command: unknown): number | null {
  if (!command || typeof command !== 'object') {
    return null;
  }
  switch ((command as { type?: unknown }).type) {
    case 'moveTo': return SOURCE_AICMD_MOVE_TO_POSITION;
    case 'attackEntity': return SOURCE_AICMD_ATTACK_OBJECT;
    case 'stop': return SOURCE_AICMD_IDLE;
    default: return null;
  }
}

function sourceCommandTargetPosition(command: Record<string, unknown>): Coord3D {
  const targetX = Number.isFinite(command.targetX) ? Number(command.targetX) : Number(command.x);
  const targetZ = Number.isFinite(command.targetZ) ? Number(command.targetZ) : Number(command.z);
  return {
    x: Number.isFinite(targetX) ? targetX : 0,
    y: Number.isFinite(targetZ) ? targetZ : 0,
    z: 0,
  };
}

function sourceCommandTargetObjectId(command: Record<string, unknown>): number {
  const targetEntityId = Number.isFinite(command.targetEntityId)
    ? Number(command.targetEntityId)
    : Number(command.targetId);
  return Number.isFinite(targetEntityId) ? normalizeSourceObjectId(targetEntityId) : 0;
}

function writeSourceAICommandStorage(saver: XferSave, command: unknown): boolean {
  const sourceCommandType = sourceCommandTypeForPendingHackCommand(command);
  if (sourceCommandType === null || !command || typeof command !== 'object') {
    return false;
  }
  const commandRecord = command as Record<string, unknown>;
  const targetPosition = sourceCommandTargetPosition(commandRecord);
  const targetEntityId = sourceCommandTargetObjectId(commandRecord);

  saver.xferUser(buildSourceRawInt32Bytes(sourceCommandType));
  // Source bug parity: AICommandParmsStorage::doXfer writes &m_cmd for sizeof(m_cmdSource).
  saver.xferUser(buildSourceRawInt32Bytes(sourceCommandType));
  saver.xferCoord3D(targetPosition);
  saver.xferObjectID(sourceCommandType === SOURCE_AICMD_ATTACK_OBJECT ? targetEntityId : 0);
  saver.xferObjectID(0);
  saver.xferAsciiString('');
  saver.xferInt(0);
  saver.xferUnsignedInt(0xffffffff);
  saver.xferAsciiString('');
  saver.xferInt(0);
  xferSourceDamageInfo(saver, createDefaultSourceDamageInfoState());
  saver.xferAsciiString('');
  saver.xferBool(false);
  return true;
}

function buildSourceAICommandStorageBytes(command: unknown): Uint8Array | null {
  const saver = new XferSave();
  saver.open('build-source-ai-command-storage');
  try {
    if (!writeSourceAICommandStorage(saver, command)) {
      return null;
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourcePendingHackCommandTail(entity: MapEntity): Uint8Array | null {
  const pending = entity.hackInternetPendingCommand;
  const command = pending?.command;
  if (!command) {
    return new Uint8Array([0]);
  }
  const saver = new XferSave();
  saver.open('build-source-hack-internet-pending-command');
  try {
    saver.xferBool(true);
    if (!writeSourceAICommandStorage(saver, command)) {
      return null;
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceHackInternetAIUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceHackInternetAIUpdateBlockState,
): Uint8Array | null {
  const pendingTail = buildSourcePendingHackCommandTail(entity);
  if (!pendingTail) {
    return null;
  }
  const state = sourceHackInternetStateForEntity(entity, currentFrame, preservedState);
  const blockData = new Uint8Array(preservedState.pendingCommandOffset + pendingTail.byteLength);
  blockData.set(preservedState.blockData.subarray(0, preservedState.pendingCommandOffset));
  blockData.set(pendingTail, preservedState.pendingCommandOffset);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  view.setUint32(preservedState.currentStateOffset, state.stateId, true);
  view.setUint32(preservedState.framesRemainingOffset, state.framesRemaining, true);
  return blockData;
}

function tryParseSourceJetAIUpdateBlockData(data: Uint8Array): SourceJetAIUpdateBlockState | null {
  const version = data[0] ?? 0;
  if (version < 1 || version > 2) {
    return null;
  }

  for (let tailOffset = 1; tailOffset < data.byteLength; tailOffset += 1) {
    const xferLoad = new XferLoad(copyBytesToArrayBuffer(data.subarray(tailOffset)));
    xferLoad.open('parse-source-jet-ai-update-tail');
    try {
      const producerLocation = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      const commandStorageStart = xferLoad.getOffset();
      if (!tryParseSourceAICommandStorage(xferLoad)) {
        continue;
      }
      const commandStorageEnd = xferLoad.getOffset();
      const attackLocoExpireFrame = xferLoad.xferUnsignedInt(0);
      const attackersMissExpireFrame = xferLoad.xferUnsignedInt(0);
      const returnToBaseFrame = xferLoad.xferUnsignedInt(0);
      const listVersion = xferLoad.xferVersion(1);
      if (listVersion !== 1) {
        continue;
      }
      const targetedByCount = xferLoad.xferUnsignedShort(0);
      if (targetedByCount > SOURCE_JET_TARGETED_BY_LIMIT) {
        continue;
      }
      const targetedBy: number[] = [];
      for (let index = 0; index < targetedByCount; index += 1) {
        targetedBy.push(xferLoad.xferObjectID(0));
      }
      const untargetableExpireFrame = xferLoad.xferUnsignedInt(0);
      const lockonDrawableTemplateName = xferLoad.xferAsciiString('');
      const flags = xferLoad.xferInt(0);
      const enginesOn = version >= 2 ? xferLoad.xferBool(false) : null;
      if (xferLoad.getRemaining() !== 0) {
        continue;
      }
      return {
        blockData: new Uint8Array(data),
        tailOffset,
        version,
        producerLocation,
        commandStorageBytes: new Uint8Array(
          data.subarray(tailOffset + commandStorageStart, tailOffset + commandStorageEnd),
        ),
        attackLocoExpireFrame,
        attackersMissExpireFrame,
        returnToBaseFrame,
        targetedBy,
        untargetableExpireFrame,
        lockonDrawableTemplateName,
        flags,
        enginesOn,
      };
    } catch {
      continue;
    } finally {
      xferLoad.close();
    }
  }
  return null;
}

function sourceJetFlagsForEntity(entity: MapEntity, preservedFlags: number): number {
  const jetState = entity.jetAIState as {
    state?: unknown;
    allowAirLoco?: unknown;
    pendingCommand?: unknown;
    useReturnLoco?: unknown;
    producerX?: unknown;
    producerZ?: unknown;
  } | null | undefined;
  let flags = preservedFlags;
  const setFlag = (mask: number, enabled: boolean) => {
    flags = enabled ? (flags | mask) : (flags & ~mask);
  };

  const hasPendingCommand = !!jetState?.pendingCommand;
  setFlag(SOURCE_JET_FLAG_HAS_PENDING_COMMAND, hasPendingCommand);
  if (typeof jetState?.allowAirLoco === 'boolean') {
    setFlag(SOURCE_JET_FLAG_ALLOW_AIR_LOCO, jetState.allowAirLoco);
  }
  setFlag(
    SOURCE_JET_FLAG_HAS_PRODUCER_LOCATION,
    Number.isFinite(jetState?.producerX) && Number.isFinite(jetState?.producerZ),
  );
  setFlag(SOURCE_JET_FLAG_TAKEOFF_IN_PROGRESS, jetState?.state === 'TAKING_OFF');
  setFlag(SOURCE_JET_FLAG_LANDING_IN_PROGRESS, jetState?.state === 'LANDING');
  if (typeof jetState?.useReturnLoco === 'boolean') {
    setFlag(SOURCE_JET_FLAG_USE_SPECIAL_RETURN_LOCO, jetState.useReturnLoco);
  }
  return flags;
}

function buildSourceJetAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceJetAIUpdateBlockState,
): Uint8Array | null {
  const jetState = entity.jetAIState as {
    producerX?: unknown;
    producerZ?: unknown;
    pendingCommand?: unknown;
    attackLocoExpireFrame?: unknown;
    returnToBaseFrame?: unknown;
  } | null | undefined;
  const pendingCommand = jetState?.pendingCommand ?? null;
  const commandStorageBytes = pendingCommand
    ? buildSourceAICommandStorageBytes(pendingCommand)
    : preservedState.commandStorageBytes;
  if (!commandStorageBytes) {
    return null;
  }

  const saver = new XferSave();
  saver.open('build-source-jet-ai-update-tail');
  try {
    saver.xferCoord3D({
      x: Number.isFinite(jetState?.producerX) ? Number(jetState!.producerX) : preservedState.producerLocation.x,
      y: Number.isFinite(jetState?.producerZ) ? Number(jetState!.producerZ) : preservedState.producerLocation.y,
      z: preservedState.producerLocation.z,
    });
    saver.xferUser(commandStorageBytes);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      jetState?.attackLocoExpireFrame,
      preservedState.attackLocoExpireFrame,
    ));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.attackersMissExpireFrame,
      preservedState.attackersMissExpireFrame,
    ));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      jetState?.returnToBaseFrame,
      preservedState.returnToBaseFrame,
    ));
    saver.xferVersion(1);
    saver.xferUnsignedShort(preservedState.targetedBy.length);
    for (const objectId of preservedState.targetedBy) {
      saver.xferObjectID(normalizeSourceObjectId(objectId));
    }
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      preservedState.untargetableExpireFrame,
      preservedState.untargetableExpireFrame,
    ));
    saver.xferAsciiString(preservedState.lockonDrawableTemplateName);
    saver.xferInt(sourceJetFlagsForEntity(entity, preservedState.flags));
    if (preservedState.version >= 2) {
      saver.xferBool(preservedState.enginesOn === true);
    }

    const tailBytes = new Uint8Array(saver.getBuffer());
    const blockData = new Uint8Array(preservedState.tailOffset + tailBytes.byteLength);
    blockData.set(preservedState.blockData.subarray(0, preservedState.tailOffset));
    blockData.set(tailBytes, preservedState.tailOffset);
    return blockData;
  } finally {
    saver.close();
  }
}

function isSourceMissileAIState(value: number): boolean {
  return Number.isFinite(value)
    && Math.trunc(value) >= SOURCE_MISSILE_AI_STATE_MIN
    && Math.trunc(value) <= SOURCE_MISSILE_AI_STATE_MAX;
}

function tryParseSourceMissileAIUpdateBlockData(data: Uint8Array): SourceMissileAIUpdateBlockState | null {
  const version = data[0] ?? 0;
  if (version < 1 || version > SOURCE_MISSILE_AI_UPDATE_CURRENT_VERSION) {
    return null;
  }

  for (let tailOffset = 1; tailOffset < data.byteLength; tailOffset += 1) {
    const xferLoad = new XferLoad(copyBytesToArrayBuffer(data.subarray(tailOffset)));
    xferLoad.open('parse-source-missile-ai-update-tail');
    try {
      const originalTargetPos = version >= 2
        ? xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 })
        : { x: 0, y: 0, z: 0 };
      const state = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
      if (!isSourceMissileAIState(state)) {
        continue;
      }
      const stateTimestamp = xferLoad.xferUnsignedInt(0);
      const nextTargetTrackTime = xferLoad.xferUnsignedInt(0);
      const launcherId = xferLoad.xferObjectID(0);
      const victimId = xferLoad.xferObjectID(0);
      const isArmed = xferLoad.xferBool(false);
      const fuelExpirationDate = xferLoad.xferUnsignedInt(0);
      const noTurnDistLeft = xferLoad.xferReal(0);
      const maxAccel = xferLoad.xferReal(0);
      const detonationWeaponTemplateName = xferLoad.xferAsciiString('');
      const exhaustSystemTemplateName = xferLoad.xferAsciiString('');
      const isTrackingTarget = xferLoad.xferBool(false);
      const prevPos = version >= 3
        ? xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 })
        : { x: 0, y: 0, z: 0 };
      const extraBonusFlags = version >= 4 ? xferLoad.xferUnsignedInt(0) : 0;
      const exhaustIdBytes = version >= 4 ? xferLoad.xferUser(new Uint8Array(4)) : new Uint8Array(4);
      const framesTillDecoyed = version >= 5 ? xferLoad.xferUnsignedInt(0) : 0;
      const noDamage = version >= 5 ? xferLoad.xferBool(false) : false;
      const isJammed = version >= 6 ? xferLoad.xferBool(false) : false;
      if (xferLoad.getRemaining() !== 0) {
        continue;
      }
      return {
        blockData: new Uint8Array(data),
        tailOffset,
        version,
        originalTargetPos,
        state,
        stateTimestamp,
        nextTargetTrackTime,
        launcherId,
        victimId,
        isArmed,
        fuelExpirationDate,
        noTurnDistLeft,
        maxAccel,
        detonationWeaponTemplateName,
        exhaustSystemTemplateName,
        isTrackingTarget,
        prevPos,
        extraBonusFlags,
        exhaustIdBytes: new Uint8Array(exhaustIdBytes),
        framesTillDecoyed,
        noDamage,
        isJammed,
      };
    } catch {
      continue;
    } finally {
      xferLoad.close();
    }
  }
  return null;
}

function sourceMissileRuntimeNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function sourceMissileRuntimeInt(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(Number(value)) : Math.trunc(fallback);
}

function sourceMissileRuntimeUnsignedFrame(value: unknown, fallback: number): number {
  return sourceFlammableUnsignedFrame(value, fallback);
}

function sourceMissileRuntimeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sourceMissileRuntimeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function sourceMissileRuntimeExhaustIdBytes(value: unknown, fallback: Uint8Array): Uint8Array {
  if (value instanceof Uint8Array && value.byteLength === 4) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value) && value.length === 4 && value.every((entry) => Number.isFinite(entry))) {
    return new Uint8Array(value.map((entry) => Math.trunc(Number(entry)) & 0xff));
  }
  return new Uint8Array(fallback);
}

function sourceMissileRuntimeCoordToSource(
  state: SourceMissileAIUpdateRuntimeState | null,
  xKey: keyof SourceMissileAIUpdateRuntimeState,
  yKey: keyof SourceMissileAIUpdateRuntimeState,
  zKey: keyof SourceMissileAIUpdateRuntimeState,
  fallback: Coord3D,
): Coord3D {
  return {
    x: sourceMissileRuntimeNumber(state?.[xKey], fallback.x),
    y: sourceMissileRuntimeNumber(state?.[zKey], fallback.y),
    z: sourceMissileRuntimeNumber(state?.[yKey], fallback.z),
  };
}

function buildSourceMissileAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceMissileAIUpdateBlockState,
): Uint8Array | null {
  const runtimeState = (entity as {
    sourceMissileAIUpdateState?: SourceMissileAIUpdateRuntimeState | null;
  }).sourceMissileAIUpdateState ?? null;
  const state = sourceMissileRuntimeInt(runtimeState?.state, preservedState.state);
  if (!isSourceMissileAIState(state)) {
    return null;
  }

  const saver = new XferSave();
  saver.open('build-source-missile-ai-update-tail');
  try {
    if (preservedState.version >= 2) {
      saver.xferCoord3D(sourceMissileRuntimeCoordToSource(
        runtimeState,
        'originalTargetX',
        'originalTargetY',
        'originalTargetZ',
        preservedState.originalTargetPos,
      ));
    }
    saver.xferUser(buildSourceRawInt32Bytes(state));
    saver.xferUnsignedInt(sourceMissileRuntimeUnsignedFrame(
      runtimeState?.stateTimestamp,
      preservedState.stateTimestamp,
    ));
    saver.xferUnsignedInt(sourceMissileRuntimeUnsignedFrame(
      runtimeState?.nextTargetTrackTime,
      preservedState.nextTargetTrackTime,
    ));
    saver.xferObjectID(normalizeSourceObjectId(sourceMissileRuntimeInt(
      runtimeState?.launcherId,
      preservedState.launcherId,
    )));
    saver.xferObjectID(normalizeSourceObjectId(sourceMissileRuntimeInt(
      runtimeState?.victimId,
      preservedState.victimId,
    )));
    saver.xferBool(sourceMissileRuntimeBool(runtimeState?.isArmed, preservedState.isArmed));
    saver.xferUnsignedInt(sourceMissileRuntimeUnsignedFrame(
      runtimeState?.fuelExpirationDate,
      preservedState.fuelExpirationDate,
    ));
    saver.xferReal(sourceMissileRuntimeNumber(runtimeState?.noTurnDistLeft, preservedState.noTurnDistLeft));
    saver.xferReal(sourceMissileRuntimeNumber(runtimeState?.maxAccel, preservedState.maxAccel));
    saver.xferAsciiString(sourceMissileRuntimeString(
      runtimeState?.detonationWeaponTemplateName,
      preservedState.detonationWeaponTemplateName,
    ));
    saver.xferAsciiString(sourceMissileRuntimeString(
      runtimeState?.exhaustSystemTemplateName,
      preservedState.exhaustSystemTemplateName,
    ));
    saver.xferBool(sourceMissileRuntimeBool(runtimeState?.isTrackingTarget, preservedState.isTrackingTarget));
    if (preservedState.version >= 3) {
      saver.xferCoord3D(sourceMissileRuntimeCoordToSource(
        runtimeState,
        'prevX',
        'prevY',
        'prevZ',
        preservedState.prevPos,
      ));
    }
    if (preservedState.version >= 4) {
      saver.xferUnsignedInt(sourceMissileRuntimeUnsignedFrame(
        runtimeState?.extraBonusFlags,
        preservedState.extraBonusFlags,
      ));
      saver.xferUser(sourceMissileRuntimeExhaustIdBytes(
        runtimeState?.exhaustIdBytes,
        preservedState.exhaustIdBytes,
      ));
    }
    if (preservedState.version >= 5) {
      saver.xferUnsignedInt(sourceMissileRuntimeUnsignedFrame(
        runtimeState?.framesTillDecoyed,
        preservedState.framesTillDecoyed,
      ));
      saver.xferBool(sourceMissileRuntimeBool(runtimeState?.noDamage, preservedState.noDamage));
    }
    if (preservedState.version >= 6) {
      saver.xferBool(sourceMissileRuntimeBool(runtimeState?.isJammed, preservedState.isJammed));
    }

    const tailBytes = new Uint8Array(saver.getBuffer());
    const blockData = new Uint8Array(preservedState.tailOffset + tailBytes.byteLength);
    blockData.set(preservedState.blockData.subarray(0, preservedState.tailOffset));
    blockData.set(tailBytes, preservedState.tailOffset);
    return blockData;
  } finally {
    saver.close();
  }
}

function isSourceDeliverPayloadDiveState(value: number): boolean {
  return Number.isFinite(value)
    && Math.trunc(value) >= SOURCE_DELIVER_PAYLOAD_DIVE_STATE_MIN
    && Math.trunc(value) <= SOURCE_DELIVER_PAYLOAD_DIVE_STATE_MAX;
}

function sourceDeliverPayloadTrailerLength(version: number): number {
  return (version >= 2 ? 1 : 0)
    + (version >= 3 ? 1 : 0)
    + (version >= 4 ? 4 : 0);
}

function createDefaultSourceRadiusDecalTemplateBlockState(): SourceRadiusDecalTemplateBlockState {
  return {
    name: '',
    shadowTypeBytes: new Uint8Array(4),
    minOpacity: 0,
    maxOpacity: 0,
    opacityThrobTime: 0,
    color: 0,
    onlyVisibleToOwningPlayer: false,
  };
}

function xferSourceRadiusDecalTemplateBlockState(
  xfer: Xfer,
  state: SourceRadiusDecalTemplateBlockState,
): SourceRadiusDecalTemplateBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported RadiusDecalTemplate version ${version}.`);
  }
  return {
    name: xfer.xferAsciiString(state.name),
    shadowTypeBytes: new Uint8Array(xfer.xferUser(state.shadowTypeBytes)),
    minOpacity: xfer.xferReal(state.minOpacity),
    maxOpacity: xfer.xferReal(state.maxOpacity),
    opacityThrobTime: xfer.xferUnsignedInt(state.opacityThrobTime),
    color: xfer.xferInt(state.color),
    onlyVisibleToOwningPlayer: xfer.xferBool(state.onlyVisibleToOwningPlayer),
  };
}

function tryParseSourceDeliverPayloadAIUpdateBlockData(
  data: Uint8Array,
): SourceDeliverPayloadAIUpdateBlockState | null {
  const version = data[0] ?? 0;
  if (version < 1 || version > SOURCE_DELIVER_PAYLOAD_AI_UPDATE_CURRENT_VERSION) {
    return null;
  }

  for (let tailOffset = 1; tailOffset < data.byteLength; tailOffset += 1) {
    const tailData = data.subarray(tailOffset);
    const xferLoad = new XferLoad(copyBytesToArrayBuffer(tailData));
    xferLoad.open('parse-source-deliver-payload-ai-update-tail');
    try {
      const targetPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      const moveToPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      const visibleItemsDelivered = xferLoad.xferInt(0);
      const diveState = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
      if (!isSourceDeliverPayloadDiveState(diveState)) {
        continue;
      }
      const visibleDropBoneName = xferLoad.xferAsciiString('');
      const visibleSubObjectName = xferLoad.xferAsciiString('');
      const visiblePayloadTemplateName = xferLoad.xferAsciiString('');
      const distToTarget = xferLoad.xferReal(0);
      const preOpenDistance = version >= 5 ? xferLoad.xferReal(0) : 0;
      const maxAttempts = xferLoad.xferInt(0);
      const dropOffset = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      const dropVariance = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
      const dropDelay = xferLoad.xferUnsignedInt(0);
      const fireWeapon = xferLoad.xferBool(false);
      const selfDestructObject = xferLoad.xferBool(false);
      const visibleNumBones = xferLoad.xferInt(0);
      const diveStartDistance = xferLoad.xferReal(0);
      const diveEndDistance = xferLoad.xferReal(0);
      const strafingWeaponSlot = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
      const visibleItemsDroppedPerInterval = xferLoad.xferInt(0);
      const inheritTransportVelocity = xferLoad.xferBool(false);
      const isParachuteDirectly = xferLoad.xferBool(false);
      const exitPitchRate = xferLoad.xferReal(0);
      const strafeLength = xferLoad.xferReal(0);
      const visiblePayloadWeaponTemplateName = xferLoad.xferAsciiString('');
      const deliveryDecalTemplate = xferSourceRadiusDecalTemplateBlockState(
        xferLoad,
        createDefaultSourceRadiusDecalTemplateBlockState(),
      );
      const deliveryDecalRadius = xferLoad.xferReal(0);
      const hasStateMachineOffset = xferLoad.getOffset();
      if (!isSourceBoolByte(tailData[hasStateMachineOffset] ?? 2)) {
        continue;
      }
      const hasStateMachine = xferLoad.xferBool(false);
      const trailerLength = sourceDeliverPayloadTrailerLength(version);
      const stateMachineByteLength = hasStateMachine && version >= 2
        ? xferLoad.getRemaining() - trailerLength
        : 0;
      if (stateMachineByteLength < 0) {
        continue;
      }
      if ((!hasStateMachine || version < 2) && xferLoad.getRemaining() !== trailerLength) {
        continue;
      }
      const stateMachineBytes = stateMachineByteLength > 0
        ? xferLoad.xferUser(new Uint8Array(stateMachineByteLength))
        : new Uint8Array();

      const trailerOffset = xferLoad.getOffset();
      if (version >= 2 && !isSourceBoolByte(tailData[trailerOffset] ?? 2)) {
        continue;
      }
      if (version >= 3 && !isSourceBoolByte(tailData[trailerOffset + 1] ?? 2)) {
        continue;
      }
      const freeToExit = version >= 2 ? xferLoad.xferBool(false) : false;
      const acceptingCommands = version >= 3 ? xferLoad.xferBool(false) : false;
      const previousDistanceSqr = version >= 4 ? xferLoad.xferReal(0) : 0;
      if (xferLoad.getRemaining() !== 0) {
        continue;
      }
      return {
        blockData: new Uint8Array(data),
        tailOffset,
        version,
        targetPos,
        moveToPos,
        visibleItemsDelivered,
        diveState,
        visibleDropBoneName,
        visibleSubObjectName,
        visiblePayloadTemplateName,
        distToTarget,
        preOpenDistance,
        maxAttempts,
        dropOffset,
        dropVariance,
        dropDelay,
        fireWeapon,
        selfDestructObject,
        visibleNumBones,
        diveStartDistance,
        diveEndDistance,
        strafingWeaponSlot,
        visibleItemsDroppedPerInterval,
        inheritTransportVelocity,
        isParachuteDirectly,
        exitPitchRate,
        strafeLength,
        visiblePayloadWeaponTemplateName,
        deliveryDecalTemplate,
        deliveryDecalRadius,
        hasStateMachine,
        stateMachineBytes: new Uint8Array(stateMachineBytes),
        freeToExit,
        acceptingCommands,
        previousDistanceSqr,
      };
    } catch {
      continue;
    } finally {
      xferLoad.close();
    }
  }
  return null;
}

function sourceDeliverPayloadRuntimeNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function sourceDeliverPayloadRuntimeInt(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(Number(value)) : Math.trunc(fallback);
}

function sourceDeliverPayloadRuntimeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sourceDeliverPayloadRuntimeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function sourceDeliverPayloadRuntimeUnsignedInt(value: unknown, fallback: number): number {
  return sourceFlammableUnsignedFrame(value, fallback);
}

function sourceDeliverPayloadRuntimeByteArray(
  value: unknown,
  fallback: Uint8Array,
  requiredLength?: number,
): Uint8Array {
  const matchesLength = (length: number) => requiredLength === undefined || length === requiredLength;
  if (value instanceof Uint8Array && matchesLength(value.byteLength)) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)
    && matchesLength(value.length)
    && value.every((entry) => Number.isFinite(entry))) {
    return new Uint8Array(value.map((entry) => Math.trunc(Number(entry)) & 0xff));
  }
  return new Uint8Array(fallback);
}

function sourceDeliverPayloadRuntimeCoordToSource(
  state: SourceDeliverPayloadAIUpdateRuntimeState | null,
  xKey: keyof SourceDeliverPayloadAIUpdateRuntimeState,
  yKey: keyof SourceDeliverPayloadAIUpdateRuntimeState,
  zKey: keyof SourceDeliverPayloadAIUpdateRuntimeState,
  fallback: Coord3D,
): Coord3D {
  return {
    x: sourceDeliverPayloadRuntimeNumber(state?.[xKey], fallback.x),
    y: sourceDeliverPayloadRuntimeNumber(state?.[zKey], fallback.y),
    z: sourceDeliverPayloadRuntimeNumber(state?.[yKey], fallback.z),
  };
}

function sourceDeliverPayloadRuntimeRadiusDecalTemplate(
  state: SourceDeliverPayloadAIUpdateRuntimeState | null,
  preservedTemplate: SourceRadiusDecalTemplateBlockState,
): SourceRadiusDecalTemplateBlockState {
  return {
    name: sourceDeliverPayloadRuntimeString(
      state?.deliveryDecalTemplateName,
      preservedTemplate.name,
    ),
    shadowTypeBytes: sourceDeliverPayloadRuntimeByteArray(
      state?.deliveryDecalTemplateShadowTypeBytes,
      preservedTemplate.shadowTypeBytes,
      4,
    ),
    minOpacity: sourceDeliverPayloadRuntimeNumber(
      state?.deliveryDecalTemplateMinOpacity,
      preservedTemplate.minOpacity,
    ),
    maxOpacity: sourceDeliverPayloadRuntimeNumber(
      state?.deliveryDecalTemplateMaxOpacity,
      preservedTemplate.maxOpacity,
    ),
    opacityThrobTime: sourceDeliverPayloadRuntimeUnsignedInt(
      state?.deliveryDecalTemplateOpacityThrobTime,
      preservedTemplate.opacityThrobTime,
    ),
    color: sourceDeliverPayloadRuntimeInt(
      state?.deliveryDecalTemplateColor,
      preservedTemplate.color,
    ),
    onlyVisibleToOwningPlayer: sourceDeliverPayloadRuntimeBool(
      state?.deliveryDecalTemplateOnlyVisibleToOwningPlayer,
      preservedTemplate.onlyVisibleToOwningPlayer,
    ),
  };
}

function buildSourceDeliverPayloadAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceDeliverPayloadAIUpdateBlockState,
): Uint8Array | null {
  const runtimeState = (entity as {
    sourceDeliverPayloadAIUpdateState?: SourceDeliverPayloadAIUpdateRuntimeState | null;
  }).sourceDeliverPayloadAIUpdateState ?? null;
  const diveState = sourceDeliverPayloadRuntimeInt(runtimeState?.diveState, preservedState.diveState);
  if (!isSourceDeliverPayloadDiveState(diveState)) {
    return null;
  }

  const hasStateMachine = sourceDeliverPayloadRuntimeBool(
    runtimeState?.hasStateMachine,
    preservedState.hasStateMachine,
  );
  const stateMachineBytes = sourceDeliverPayloadRuntimeByteArray(
    runtimeState?.stateMachineBytes,
    preservedState.stateMachineBytes,
  );

  const saver = new XferSave();
  saver.open('build-source-deliver-payload-ai-update-tail');
  try {
    saver.xferCoord3D(sourceDeliverPayloadRuntimeCoordToSource(
      runtimeState,
      'targetX',
      'targetY',
      'targetZ',
      preservedState.targetPos,
    ));
    saver.xferCoord3D(sourceDeliverPayloadRuntimeCoordToSource(
      runtimeState,
      'moveToX',
      'moveToY',
      'moveToZ',
      preservedState.moveToPos,
    ));
    saver.xferInt(sourceDeliverPayloadRuntimeInt(
      runtimeState?.visibleItemsDelivered,
      preservedState.visibleItemsDelivered,
    ));
    saver.xferUser(buildSourceRawInt32Bytes(diveState));
    saver.xferAsciiString(sourceDeliverPayloadRuntimeString(
      runtimeState?.visibleDropBoneName,
      preservedState.visibleDropBoneName,
    ));
    saver.xferAsciiString(sourceDeliverPayloadRuntimeString(
      runtimeState?.visibleSubObjectName,
      preservedState.visibleSubObjectName,
    ));
    saver.xferAsciiString(sourceDeliverPayloadRuntimeString(
      runtimeState?.visiblePayloadTemplateName,
      preservedState.visiblePayloadTemplateName,
    ));
    saver.xferReal(sourceDeliverPayloadRuntimeNumber(runtimeState?.distToTarget, preservedState.distToTarget));
    if (preservedState.version >= 5) {
      saver.xferReal(sourceDeliverPayloadRuntimeNumber(
        runtimeState?.preOpenDistance,
        preservedState.preOpenDistance,
      ));
    }
    saver.xferInt(sourceDeliverPayloadRuntimeInt(runtimeState?.maxAttempts, preservedState.maxAttempts));
    saver.xferCoord3D(sourceDeliverPayloadRuntimeCoordToSource(
      runtimeState,
      'dropOffsetX',
      'dropOffsetY',
      'dropOffsetZ',
      preservedState.dropOffset,
    ));
    saver.xferCoord3D(sourceDeliverPayloadRuntimeCoordToSource(
      runtimeState,
      'dropVarianceX',
      'dropVarianceY',
      'dropVarianceZ',
      preservedState.dropVariance,
    ));
    saver.xferUnsignedInt(sourceDeliverPayloadRuntimeUnsignedInt(runtimeState?.dropDelay, preservedState.dropDelay));
    saver.xferBool(sourceDeliverPayloadRuntimeBool(runtimeState?.fireWeapon, preservedState.fireWeapon));
    saver.xferBool(sourceDeliverPayloadRuntimeBool(
      runtimeState?.selfDestructObject,
      preservedState.selfDestructObject,
    ));
    saver.xferInt(sourceDeliverPayloadRuntimeInt(runtimeState?.visibleNumBones, preservedState.visibleNumBones));
    saver.xferReal(sourceDeliverPayloadRuntimeNumber(
      runtimeState?.diveStartDistance,
      preservedState.diveStartDistance,
    ));
    saver.xferReal(sourceDeliverPayloadRuntimeNumber(runtimeState?.diveEndDistance, preservedState.diveEndDistance));
    saver.xferUser(buildSourceRawInt32Bytes(sourceDeliverPayloadRuntimeInt(
      runtimeState?.strafingWeaponSlot,
      preservedState.strafingWeaponSlot,
    )));
    saver.xferInt(sourceDeliverPayloadRuntimeInt(
      runtimeState?.visibleItemsDroppedPerInterval,
      preservedState.visibleItemsDroppedPerInterval,
    ));
    saver.xferBool(sourceDeliverPayloadRuntimeBool(
      runtimeState?.inheritTransportVelocity,
      preservedState.inheritTransportVelocity,
    ));
    saver.xferBool(sourceDeliverPayloadRuntimeBool(
      runtimeState?.isParachuteDirectly,
      preservedState.isParachuteDirectly,
    ));
    saver.xferReal(sourceDeliverPayloadRuntimeNumber(runtimeState?.exitPitchRate, preservedState.exitPitchRate));
    saver.xferReal(sourceDeliverPayloadRuntimeNumber(runtimeState?.strafeLength, preservedState.strafeLength));
    saver.xferAsciiString(sourceDeliverPayloadRuntimeString(
      runtimeState?.visiblePayloadWeaponTemplateName,
      preservedState.visiblePayloadWeaponTemplateName,
    ));
    xferSourceRadiusDecalTemplateBlockState(
      saver,
      sourceDeliverPayloadRuntimeRadiusDecalTemplate(runtimeState, preservedState.deliveryDecalTemplate),
    );
    saver.xferReal(sourceDeliverPayloadRuntimeNumber(
      runtimeState?.deliveryDecalRadius,
      preservedState.deliveryDecalRadius,
    ));
    saver.xferBool(hasStateMachine);
    if (hasStateMachine && preservedState.version >= 2) {
      saver.xferUser(stateMachineBytes);
    }
    if (preservedState.version >= 2) {
      saver.xferBool(sourceDeliverPayloadRuntimeBool(runtimeState?.freeToExit, preservedState.freeToExit));
    }
    if (preservedState.version >= 3) {
      saver.xferBool(sourceDeliverPayloadRuntimeBool(
        runtimeState?.acceptingCommands,
        preservedState.acceptingCommands,
      ));
    }
    if (preservedState.version >= 4) {
      saver.xferReal(sourceDeliverPayloadRuntimeNumber(
        runtimeState?.previousDistanceSqr,
        preservedState.previousDistanceSqr,
      ));
    }

    const tailBytes = new Uint8Array(saver.getBuffer());
    const blockData = new Uint8Array(preservedState.tailOffset + tailBytes.byteLength);
    blockData.set(preservedState.blockData.subarray(0, preservedState.tailOffset));
    blockData.set(tailBytes, preservedState.tailOffset);
    return blockData;
  } finally {
    saver.close();
  }
}

function tryParseSourceDumbProjectileBehaviorBlockData(
  data: Uint8Array,
): SourceDumbProjectileBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-dumb-projectile-behavior');
  try {
    const version = xferLoad.xferVersion(SOURCE_DUMB_PROJECTILE_BEHAVIOR_CURRENT_VERSION);
    if (version !== SOURCE_DUMB_PROJECTILE_BEHAVIOR_CURRENT_VERSION) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const launcherId = xferLoad.xferObjectID(0);
    const victimId = xferLoad.xferObjectID(0);
    const flightPathSegments = xferLoad.xferInt(0);
    const flightPathSpeed = xferLoad.xferReal(0);
    const flightPathStart = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const flightPathEnd = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const detonationWeaponTemplateName = xferLoad.xferAsciiString('');
    const lifespanFrame = xferLoad.xferUnsignedInt(0);
    if (xferLoad.getRemaining() !== 0) {
      return null;
    }
    return {
      version,
      nextCallFrameAndPhase,
      launcherId,
      victimId,
      flightPathSegments,
      flightPathSpeed,
      flightPathStart,
      flightPathEnd,
      detonationWeaponTemplateName,
      lifespanFrame,
    };
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceDumbProjectileRuntimeNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function sourceDumbProjectileRuntimeInt(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(Number(value)) : Math.trunc(fallback);
}

function sourceDumbProjectileRuntimeUnsignedFrame(value: unknown, fallback: number): number {
  return sourceFlammableUnsignedFrame(value, fallback);
}

function sourceDumbProjectileRuntimeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function sourceDumbProjectileRuntimeCoordToSource(
  state: SourceDumbProjectileBehaviorRuntimeState | null,
  xKey: keyof SourceDumbProjectileBehaviorRuntimeState,
  yKey: keyof SourceDumbProjectileBehaviorRuntimeState,
  zKey: keyof SourceDumbProjectileBehaviorRuntimeState,
  fallback: Coord3D,
): Coord3D {
  return {
    x: sourceDumbProjectileRuntimeNumber(state?.[xKey], fallback.x),
    y: sourceDumbProjectileRuntimeNumber(state?.[zKey], fallback.y),
    z: sourceDumbProjectileRuntimeNumber(state?.[yKey], fallback.z),
  };
}

function buildSourceDumbProjectileBehaviorBlockData(
  entity: MapEntity,
  preservedState: SourceDumbProjectileBehaviorBlockState,
): Uint8Array {
  const runtimeState = (entity as {
    sourceDumbProjectileBehaviorState?: SourceDumbProjectileBehaviorRuntimeState | null;
  }).sourceDumbProjectileBehaviorState ?? null;
  const saver = new XferSave();
  saver.open('build-source-dumb-projectile-behavior');
  try {
    saver.xferVersion(preservedState.version);
    xferSourceUpdateModuleBase(
      saver,
      sourceDumbProjectileRuntimeUnsignedFrame(
        runtimeState?.nextCallFrameAndPhase,
        preservedState.nextCallFrameAndPhase,
      ),
    );
    saver.xferObjectID(normalizeSourceObjectId(sourceDumbProjectileRuntimeInt(
      runtimeState?.launcherId,
      preservedState.launcherId,
    )));
    saver.xferObjectID(normalizeSourceObjectId(sourceDumbProjectileRuntimeInt(
      runtimeState?.victimId,
      preservedState.victimId,
    )));
    saver.xferInt(sourceDumbProjectileRuntimeInt(
      runtimeState?.flightPathSegments,
      preservedState.flightPathSegments,
    ));
    saver.xferReal(sourceDumbProjectileRuntimeNumber(
      runtimeState?.flightPathSpeed,
      preservedState.flightPathSpeed,
    ));
    saver.xferCoord3D(sourceDumbProjectileRuntimeCoordToSource(
      runtimeState,
      'flightPathStartX',
      'flightPathStartY',
      'flightPathStartZ',
      preservedState.flightPathStart,
    ));
    saver.xferCoord3D(sourceDumbProjectileRuntimeCoordToSource(
      runtimeState,
      'flightPathEndX',
      'flightPathEndY',
      'flightPathEndZ',
      preservedState.flightPathEnd,
    ));
    saver.xferAsciiString(sourceDumbProjectileRuntimeString(
      runtimeState?.detonationWeaponTemplateName,
      preservedState.detonationWeaponTemplateName,
    ));
    saver.xferUnsignedInt(sourceDumbProjectileRuntimeUnsignedFrame(
      runtimeState?.lifespanFrame,
      preservedState.lifespanFrame,
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceDeployStyleAIUpdateBlockData(
  data: Uint8Array,
): SourceDeployStyleAIUpdateBlockState | null {
  if (data.byteLength < 9 || data[0] !== 4) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    blockData: new Uint8Array(data),
    state: view.getInt32(data.byteLength - 8, true),
    frameToWaitForDeploy: view.getUint32(data.byteLength - 4, true),
  };
}

function buildSourceDeployStyleAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceDeployStyleAIUpdateBlockState,
): Uint8Array {
  const blockData = new Uint8Array(preservedState.blockData);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  view.setInt32(
    blockData.byteLength - 8,
    sourceDeployStyleStateToInt(entity.deployState, preservedState.state),
    true,
  );
  view.setUint32(
    blockData.byteLength - 4,
    sourceFlammableUnsignedFrame(entity.deployFrameToWait, preservedState.frameToWaitForDeploy),
    true,
  );
  return blockData;
}

function buildGeneratedSourceDeployStyleAIUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-generated-source-deploy-style-ai-update');
  try {
    saver.xferVersion(4);
    saver.xferUser(buildGeneratedSourceAIUpdateInterfaceBlockData(entity, currentFrame));
    saver.xferUser(buildSourceRawInt32Bytes(sourceDeployStyleStateToInt(entity.deployState, 0)));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(entity.deployFrameToWait, 0));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

const SOURCE_ASSAULT_TRANSPORT_MAX_SLOTS = 10;

function tryParseSourceAssaultTransportAIUpdateBlockData(
  data: Uint8Array,
): SourceAssaultTransportAIUpdateBlockState | null {
  if (data.byteLength < 31 || data[0] !== 1) {
    return null;
  }

  const blockData = new Uint8Array(data);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  // AssaultTransportAIUpdate xfers AIUpdateInterface first; the assault fields are the fixed suffix
  // except for the persisted member array, which is bounded by MAX_TRANSPORT_SLOTS.
  for (let memberCount = SOURCE_ASSAULT_TRANSPORT_MAX_SLOTS; memberCount >= 0; memberCount -= 1) {
    const tailOffset = blockData.byteLength - (30 + memberCount * 5);
    if (tailOffset < 2 || view.getInt32(tailOffset, true) !== memberCount) {
      continue;
    }

    const members: SourceAssaultTransportAIUpdateBlockState['members'] = [];
    let cursor = tailOffset + 4;
    let valid = true;
    for (let index = 0; index < memberCount; index += 1) {
      const isHealingByte = view.getUint8(cursor + 4);
      if (isHealingByte !== 0 && isHealingByte !== 1) {
        valid = false;
        break;
      }
      members.push({
        entityId: view.getUint32(cursor, true),
        isHealing: isHealingByte !== 0,
      });
      cursor += 5;
    }
    if (!valid) {
      continue;
    }

    const isAttackMoveByte = view.getUint8(blockData.byteLength - 2);
    const isAttackObjectByte = view.getUint8(blockData.byteLength - 1);
    if (
      (isAttackMoveByte !== 0 && isAttackMoveByte !== 1)
      || (isAttackObjectByte !== 0 && isAttackObjectByte !== 1)
    ) {
      continue;
    }

    return {
      blockData,
      tailOffset,
      members,
      attackMoveGoal: {
        x: view.getFloat32(cursor, true),
        y: view.getFloat32(cursor + 4, true),
        z: view.getFloat32(cursor + 8, true),
      },
      designatedTargetId: view.getUint32(cursor + 12, true),
      assaultState: view.getInt32(cursor + 16, true),
      framesRemaining: view.getUint32(cursor + 20, true),
      isAttackMove: isAttackMoveByte !== 0,
      isAttackObject: isAttackObjectByte !== 0,
    };
  }

  return null;
}

function sourceAssaultTransportMembersForEntity(
  entity: MapEntity,
  preservedState: SourceAssaultTransportAIUpdateBlockState,
): SourceAssaultTransportAIUpdateBlockState['members'] {
  const state = entity.assaultTransportState;
  const liveMembers = state && Array.isArray(state.members) ? state.members : preservedState.members;
  if (liveMembers.length > SOURCE_ASSAULT_TRANSPORT_MAX_SLOTS) {
    throw new Error(
      `AssaultTransportAIUpdate member count ${liveMembers.length} exceeds limit ${SOURCE_ASSAULT_TRANSPORT_MAX_SLOTS}.`,
    );
  }
  return liveMembers.map((member) => ({
    entityId: Number.isFinite(member.entityId)
      ? Math.max(0, Math.trunc(member.entityId))
      : 0,
    isHealing: member.isHealing === true,
  }));
}

function buildSourceAssaultTransportAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceAssaultTransportAIUpdateBlockState,
): Uint8Array {
  const state = entity.assaultTransportState;
  const members = sourceAssaultTransportMembersForEntity(entity, preservedState);
  const tailLength = 30 + members.length * 5;
  const blockData = new Uint8Array(preservedState.tailOffset + tailLength);
  blockData.set(preservedState.blockData.subarray(0, preservedState.tailOffset));
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  let cursor = preservedState.tailOffset;
  view.setInt32(cursor, members.length, true);
  cursor += 4;
  for (const member of members) {
    view.setUint32(cursor, member.entityId, true);
    view.setUint8(cursor + 4, member.isHealing ? 1 : 0);
    cursor += 5;
  }
  view.setFloat32(
    cursor,
    Number.isFinite(state?.attackMoveGoalX) ? state!.attackMoveGoalX : preservedState.attackMoveGoal.x,
    true,
  );
  view.setFloat32(
    cursor + 4,
    Number.isFinite(state?.attackMoveGoalY) ? state!.attackMoveGoalY : preservedState.attackMoveGoal.y,
    true,
  );
  view.setFloat32(
    cursor + 8,
    Number.isFinite(state?.attackMoveGoalZ) ? state!.attackMoveGoalZ : preservedState.attackMoveGoal.z,
    true,
  );
  view.setUint32(
    cursor + 12,
    Number.isFinite(state?.designatedTargetId)
      ? Math.max(0, Math.trunc(state!.designatedTargetId ?? 0))
      : preservedState.designatedTargetId,
    true,
  );
  view.setInt32(
    cursor + 16,
    Number.isFinite(state?.assaultState)
      ? Math.trunc(state!.assaultState)
      : preservedState.assaultState,
    true,
  );
  view.setUint32(
    cursor + 20,
    Number.isFinite(state?.framesRemaining)
      ? Math.max(0, Math.trunc(state!.framesRemaining))
      : preservedState.framesRemaining,
    true,
  );
  view.setUint8(cursor + 24, state?.isAttackMove === true ? 1 : 0);
  view.setUint8(cursor + 25, state?.isAttackObject === true ? 1 : 0);
  return blockData;
}

function tryParseSourceSupplyTruckAIUpdateBlockData(
  data: Uint8Array,
): SourceSupplyTruckAIUpdateBlockState | null {
  if (data.byteLength < 10 || data[0] !== 1) {
    return null;
  }
  const blockData = new Uint8Array(data);
  const tailOffset = blockData.byteLength - 9;
  if (tailOffset < 2) {
    return null;
  }
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  const forcePendingByte = view.getUint8(blockData.byteLength - 1);
  if (forcePendingByte !== 0 && forcePendingByte !== 1) {
    return null;
  }
  return {
    blockData,
    tailOffset,
    preferredDockId: view.getUint32(tailOffset, true),
    numberBoxes: view.getInt32(tailOffset + 4, true),
    forcePending: forcePendingByte !== 0,
  };
}

function findLiveSupplyTruckState(
  coreState: GameLogicCoreSaveState | null | undefined,
  entityId: number,
) {
  return coreState?.supplyTruckStates?.find((candidate) => candidate.entityId === entityId)?.state ?? null;
}

function buildSourceSupplyTruckAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceSupplyTruckAIUpdateBlockState,
  coreState?: GameLogicCoreSaveState | null,
): Uint8Array {
  const liveState = findLiveSupplyTruckState(coreState, entity.id);
  const blockData = new Uint8Array(preservedState.blockData);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  view.setUint32(
    preservedState.tailOffset,
    normalizeSourceObjectId(liveState?.preferredDockId ?? preservedState.preferredDockId),
    true,
  );
  view.setInt32(
    preservedState.tailOffset + 4,
    sourceFiniteInt(liveState?.currentBoxes, preservedState.numberBoxes),
    true,
  );
  view.setUint8(
    preservedState.tailOffset + 8,
    (typeof liveState?.forceBusy === 'boolean' ? liveState.forceBusy : preservedState.forcePending) ? 1 : 0,
  );
  return blockData;
}

function isSourceStubStateMachineAt(data: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + SOURCE_STUB_STATE_MACHINE_BYTE_LENGTH > data.byteLength) {
    return false;
  }
  // Wrapper xferVersion(1), then StateMachine::xfer version 1 with snapshotAllStates=false.
  return data[offset] === 1 && data[offset + 1] === 1 && data[offset + 14] === 0;
}

function tryParseSourceWorkerAIUpdateBlockData(
  data: Uint8Array,
): SourceWorkerAIUpdateBlockState | null {
  if (data.byteLength < 1 + 4 + SOURCE_DOZER_NUM_TASKS * SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH
    + SOURCE_WORKER_FIXED_AFTER_DOZER_MACHINE_BYTE_LENGTH || data[0] !== 1) {
    return null;
  }

  const blockData = new Uint8Array(data);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  const dozerSuffixOffset = blockData.byteLength - SOURCE_WORKER_FIXED_AFTER_DOZER_MACHINE_BYTE_LENGTH;
  if (dozerSuffixOffset < 2 || view.getInt32(dozerSuffixOffset + 4, true) !== SOURCE_DOZER_NUM_DOCK_POINTS) {
    return null;
  }

  let cursor = dozerSuffixOffset + 8;
  for (let taskIndex = 0; taskIndex < SOURCE_DOZER_NUM_TASKS; taskIndex += 1) {
    for (let pointIndex = 0; pointIndex < SOURCE_DOZER_NUM_DOCK_POINTS; pointIndex += 1) {
      const validByte = view.getUint8(cursor);
      if (validByte !== 0 && validByte !== 1) {
        return null;
      }
      cursor += SOURCE_DOZER_DOCK_POINT_BYTE_LENGTH;
    }
  }

  const supplyMachineOffset = dozerSuffixOffset + SOURCE_DOZER_FIXED_SUFFIX_BYTE_LENGTH;
  const supplyTailOffset = supplyMachineOffset + SOURCE_STUB_STATE_MACHINE_BYTE_LENGTH;
  const workerMachineOffset = supplyTailOffset + SOURCE_SUPPLY_TRUCK_TAIL_BYTE_LENGTH;
  if (!isSourceStubStateMachineAt(blockData, supplyMachineOffset)
    || !isSourceStubStateMachineAt(blockData, workerMachineOffset)) {
    return null;
  }
  const forcePendingByte = view.getUint8(supplyTailOffset + 8);
  if (forcePendingByte !== 0 && forcePendingByte !== 1) {
    return null;
  }

  const taskOffset = findSourceDozerTaskOffset(blockData, dozerSuffixOffset);
  if (taskOffset < 0) {
    return null;
  }
  const tasks: SourceWorkerAIUpdateBlockState['tasks'] = [];
  cursor = taskOffset + 4;
  for (let index = 0; index < SOURCE_DOZER_NUM_TASKS; index += 1) {
    tasks.push({
      targetObjectId: view.getUint32(cursor, true),
      taskOrderFrame: view.getUint32(cursor + 4, true),
    });
    cursor += SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH;
  }

  return {
    blockData,
    taskOffset,
    supplyTailOffset,
    tasks,
    preferredDockId: view.getUint32(supplyTailOffset, true),
    numberBoxes: view.getInt32(supplyTailOffset + 4, true),
    forcePending: forcePendingByte !== 0,
  };
}

function buildSourceWorkerAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceWorkerAIUpdateBlockState,
  coreState?: GameLogicCoreSaveState | null,
): Uint8Array {
  const liveState = findLiveSupplyTruckState(coreState, entity.id);
  const blockData = new Uint8Array(preservedState.blockData);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  const taskCursor = (taskIndex: number) =>
    preservedState.taskOffset + 4 + taskIndex * SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH;
  const buildTask = preservedState.tasks[SOURCE_DOZER_TASK_BUILD] ?? { targetObjectId: 0, taskOrderFrame: 0 };
  const repairTask = preservedState.tasks[SOURCE_DOZER_TASK_REPAIR] ?? { targetObjectId: 0, taskOrderFrame: 0 };

  let cursor = taskCursor(SOURCE_DOZER_TASK_BUILD);
  view.setUint32(cursor, normalizeSourceObjectId(entity.dozerBuildTargetEntityId || buildTask.targetObjectId), true);
  view.setUint32(cursor + 4, sourceFlammableUnsignedFrame(entity.dozerBuildTaskOrderFrame, buildTask.taskOrderFrame), true);

  cursor = taskCursor(SOURCE_DOZER_TASK_REPAIR);
  view.setUint32(cursor, normalizeSourceObjectId(entity.dozerRepairTargetEntityId || repairTask.targetObjectId), true);
  view.setUint32(cursor + 4, sourceFlammableUnsignedFrame(entity.dozerRepairTaskOrderFrame, repairTask.taskOrderFrame), true);

  view.setUint32(
    preservedState.supplyTailOffset,
    normalizeSourceObjectId(liveState?.preferredDockId ?? preservedState.preferredDockId),
    true,
  );
  view.setInt32(
    preservedState.supplyTailOffset + 4,
    sourceFiniteInt(liveState?.currentBoxes, preservedState.numberBoxes),
    true,
  );
  view.setUint8(
    preservedState.supplyTailOffset + 8,
    (typeof liveState?.forceBusy === 'boolean' ? liveState.forceBusy : preservedState.forcePending) ? 1 : 0,
  );

  return blockData;
}

function sourceChinookFlightStatusToInt(status: unknown, fallback: number): number {
  switch (status) {
    case 'TAKING_OFF': return 0;
    case 'FLYING': return 1;
    case 'DOING_COMBAT_DROP': return 2;
    case 'LANDING': return 3;
    case 'LANDED': return 4;
    default:
      return Number.isFinite(fallback) ? Math.trunc(fallback) : 1;
  }
}

function tryParseSourceChinookAIUpdateBlockData(
  data: Uint8Array,
): SourceChinookAIUpdateBlockState | null {
  if (data.byteLength < 9) {
    return null;
  }
  const version = data[0] ?? 0;
  if (version < 1 || version > 2) {
    return null;
  }
  const tailLength = version >= 2 ? 20 : 8;
  const tailOffset = data.byteLength - tailLength;
  if (tailOffset < 2) {
    return null;
  }
  const blockData = new Uint8Array(data);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  return {
    blockData,
    tailOffset,
    version,
    flightStatus: view.getInt32(tailOffset, true),
    airfieldForHealing: view.getUint32(tailOffset + 4, true),
    originalPos: version >= 2
      ? {
        x: view.getFloat32(tailOffset + 8, true),
        y: view.getFloat32(tailOffset + 12, true),
        z: view.getFloat32(tailOffset + 16, true),
      }
      : null,
  };
}

function buildSourceChinookAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceChinookAIUpdateBlockState,
): Uint8Array {
  const blockData = new Uint8Array(preservedState.blockData);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  view.setInt32(
    preservedState.tailOffset,
    sourceChinookFlightStatusToInt(entity.chinookFlightStatus, preservedState.flightStatus),
    true,
  );
  view.setUint32(
    preservedState.tailOffset + 4,
    normalizeSourceObjectId(entity.chinookHealingAirfieldId ?? preservedState.airfieldForHealing),
    true,
  );
  return blockData;
}

function tryParseSourcePOWTruckAIUpdateBlockData(
  data: Uint8Array,
): SourcePOWTruckAIUpdateBlockState | null {
  if (data.byteLength < 25 || data[0] !== 1) {
    return null;
  }
  const blockData = new Uint8Array(data);
  const tailOffset = blockData.byteLength - 24;
  if (tailOffset < 2) {
    return null;
  }
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  return {
    blockData,
    tailOffset,
    aiMode: view.getInt32(tailOffset, true),
    currentTask: view.getInt32(tailOffset + 4, true),
    targetId: view.getUint32(tailOffset + 8, true),
    prisonId: view.getUint32(tailOffset + 12, true),
    enteredWaitingFrame: view.getUint32(tailOffset + 16, true),
    lastFindFrame: view.getUint32(tailOffset + 20, true),
  };
}

function buildSourcePOWTruckAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourcePOWTruckAIUpdateBlockState,
): Uint8Array {
  const blockData = new Uint8Array(preservedState.blockData);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  view.setInt32(
    preservedState.tailOffset,
    sourceFiniteInt(entity.powTruckAIMode, preservedState.aiMode),
    true,
  );
  view.setInt32(
    preservedState.tailOffset + 4,
    sourceFiniteInt(entity.powTruckCurrentTask, preservedState.currentTask),
    true,
  );
  view.setUint32(
    preservedState.tailOffset + 8,
    normalizeSourceObjectId(entity.powTruckTargetId ?? preservedState.targetId),
    true,
  );
  view.setUint32(
    preservedState.tailOffset + 12,
    normalizeSourceObjectId(entity.powTruckPrisonId ?? preservedState.prisonId),
    true,
  );
  view.setUint32(
    preservedState.tailOffset + 16,
    sourceFlammableUnsignedFrame(entity.powTruckEnteredWaitingFrame, preservedState.enteredWaitingFrame),
    true,
  );
  view.setUint32(
    preservedState.tailOffset + 20,
    sourceFlammableUnsignedFrame(entity.powTruckLastFindFrame, preservedState.lastFindFrame),
    true,
  );
  return blockData;
}

const SOURCE_DOZER_NUM_TASKS = 3;
const SOURCE_DOZER_NUM_DOCK_POINTS = 3;
const SOURCE_DOZER_TASK_BUILD = 0;
const SOURCE_DOZER_TASK_REPAIR = 1;
const SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH = 8;
const SOURCE_DOZER_DOCK_POINT_BYTE_LENGTH = 13;
const SOURCE_DOZER_FIXED_SUFFIX_BYTE_LENGTH = 4
  + 4
  + SOURCE_DOZER_NUM_TASKS * SOURCE_DOZER_NUM_DOCK_POINTS * SOURCE_DOZER_DOCK_POINT_BYTE_LENGTH
  + 4;
const SOURCE_STUB_STATE_MACHINE_BYTE_LENGTH = 33;
const SOURCE_SUPPLY_TRUCK_TAIL_BYTE_LENGTH = 9;
const SOURCE_WORKER_FIXED_AFTER_DOZER_MACHINE_BYTE_LENGTH = SOURCE_DOZER_FIXED_SUFFIX_BYTE_LENGTH
  + SOURCE_STUB_STATE_MACHINE_BYTE_LENGTH
  + SOURCE_SUPPLY_TRUCK_TAIL_BYTE_LENGTH
  + SOURCE_STUB_STATE_MACHINE_BYTE_LENGTH;

function findSourceDozerTaskOffset(data: Uint8Array, suffixOffset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const afterTaskByteLength = 4 + SOURCE_DOZER_NUM_TASKS * SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH;
  for (let offset = 1; offset + afterTaskByteLength + 2 <= suffixOffset; offset += 1) {
    if (view.getInt32(offset, true) !== SOURCE_DOZER_NUM_TASKS) {
      continue;
    }
    const machineOffset = offset + afterTaskByteLength;
    // DozerPrimaryStateMachine::xfer writes version 1, then StateMachine::xfer writes version 1.
    if (data[machineOffset] === 1 && data[machineOffset + 1] === 1) {
      return offset;
    }
  }
  return -1;
}

function tryParseSourceDozerAIUpdateBlockData(
  data: Uint8Array,
): SourceDozerAIUpdateBlockState | null {
  if (data.byteLength < 1 + 4 + SOURCE_DOZER_NUM_TASKS * SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH
    + SOURCE_DOZER_FIXED_SUFFIX_BYTE_LENGTH || data[0] !== 1) {
    return null;
  }
  const suffixOffset = data.byteLength - SOURCE_DOZER_FIXED_SUFFIX_BYTE_LENGTH;
  if (suffixOffset < 2) {
    return null;
  }
  const blockData = new Uint8Array(data);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  if (view.getInt32(suffixOffset + 4, true) !== SOURCE_DOZER_NUM_DOCK_POINTS) {
    return null;
  }
  let cursor = suffixOffset + 8;
  for (let taskIndex = 0; taskIndex < SOURCE_DOZER_NUM_TASKS; taskIndex += 1) {
    for (let pointIndex = 0; pointIndex < SOURCE_DOZER_NUM_DOCK_POINTS; pointIndex += 1) {
      const validByte = view.getUint8(cursor);
      if (validByte !== 0 && validByte !== 1) {
        return null;
      }
      cursor += SOURCE_DOZER_DOCK_POINT_BYTE_LENGTH;
    }
  }

  const taskOffset = findSourceDozerTaskOffset(blockData, suffixOffset);
  if (taskOffset < 0) {
    return null;
  }
  const tasks: SourceDozerAIUpdateBlockState['tasks'] = [];
  cursor = taskOffset + 4;
  for (let index = 0; index < SOURCE_DOZER_NUM_TASKS; index += 1) {
    tasks.push({
      targetObjectId: view.getUint32(cursor, true),
      taskOrderFrame: view.getUint32(cursor + 4, true),
    });
    cursor += SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH;
  }
  return { blockData, taskOffset, tasks };
}

function buildSourceDozerAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceDozerAIUpdateBlockState,
): Uint8Array {
  const blockData = new Uint8Array(preservedState.blockData);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  const taskCursor = (taskIndex: number) =>
    preservedState.taskOffset + 4 + taskIndex * SOURCE_DOZER_TASK_ENTRY_BYTE_LENGTH;
  const buildTask = preservedState.tasks[SOURCE_DOZER_TASK_BUILD] ?? { targetObjectId: 0, taskOrderFrame: 0 };
  const repairTask = preservedState.tasks[SOURCE_DOZER_TASK_REPAIR] ?? { targetObjectId: 0, taskOrderFrame: 0 };

  let cursor = taskCursor(SOURCE_DOZER_TASK_BUILD);
  view.setUint32(cursor, normalizeSourceObjectId(entity.dozerBuildTargetEntityId ?? buildTask.targetObjectId), true);
  view.setUint32(cursor + 4, sourceFiniteInt(entity.dozerBuildTaskOrderFrame, buildTask.taskOrderFrame), true);

  cursor = taskCursor(SOURCE_DOZER_TASK_REPAIR);
  view.setUint32(cursor, normalizeSourceObjectId(entity.dozerRepairTargetEntityId ?? repairTask.targetObjectId), true);
  view.setUint32(cursor + 4, sourceFiniteInt(entity.dozerRepairTaskOrderFrame, repairTask.taskOrderFrame), true);
  return blockData;
}

function tryParseSourceRebuildHoleBehaviorBlockData(
  data: Uint8Array,
): SourceRebuildHoleBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-rebuild-hole-behavior');
  try {
    const version = xferLoad.xferVersion(2);
    if (version < 1 || version > 2) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(
      xferLoad,
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    );
    const workerId = xferLoad.xferObjectID(0);
    const reconstructingId = xferLoad.xferObjectID(0);
    const spawnerId = version >= 2 ? xferLoad.xferObjectID(0) : 0;
    const workerWaitCounter = xferLoad.xferUnsignedInt(0);
    const workerTemplateName = xferLoad.xferAsciiString('');
    const rebuildTemplateName = xferLoad.xferAsciiString('');
    return xferLoad.getRemaining() === 0
      ? {
          version,
          nextCallFrameAndPhase,
          workerId,
          reconstructingId,
          spawnerId,
          workerWaitCounter,
          workerTemplateName,
          rebuildTemplateName,
        }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceRebuildHoleBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceRebuildHoleBehaviorBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-rebuild-hole-behavior');
  try {
    const workerId = normalizeSourceObjectId(entity.rebuildHoleWorkerEntityId ?? preservedState.workerId);
    const profileWorkerName = entity.rebuildHoleProfile?.workerObjectName?.trim() ?? '';
    const workerTemplateName = workerId !== 0 && profileWorkerName
      ? profileWorkerName
      : preservedState.workerTemplateName;
    const rebuildTemplateName = entity.rebuildHoleRebuildTemplateName?.trim()
      || preservedState.rebuildTemplateName;

    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(entity.destroyed ? SOURCE_FRAME_FOREVER : currentFrame + 1),
    ));
    saver.xferObjectID(workerId);
    saver.xferObjectID(normalizeSourceObjectId(
      entity.rebuildHoleReconstructingEntityId ?? preservedState.reconstructingId,
    ));
    saver.xferObjectID(normalizeSourceObjectId(entity.rebuildHoleSpawnerEntityId ?? preservedState.spawnerId));
    saver.xferUnsignedInt(sourceNonNegativeInt(
      entity.rebuildHoleWorkerWaitCounter,
      preservedState.workerWaitCounter,
    ));
    saver.xferAsciiString(workerTemplateName);
    saver.xferAsciiString(rebuildTemplateName);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceRebuildHoleBehaviorBlockState(): SourceRebuildHoleBehaviorBlockState {
  return {
    version: 2,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    workerId: 0,
    reconstructingId: 0,
    spawnerId: 0,
    workerWaitCounter: 0,
    workerTemplateName: '',
    rebuildTemplateName: '',
  };
}

function tryParseSourcePropagandaTowerBehaviorBlockData(
  data: Uint8Array,
): SourcePropagandaTowerBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-propaganda-tower-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(
      xferLoad,
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    );
    const lastScanFrame = xferLoad.xferUnsignedInt(0);
    const trackedIds = xferSourceObjectIdListByUnsignedShortCount(xferLoad, []);
    return xferLoad.getRemaining() === 0
      ? {
          nextCallFrameAndPhase,
          lastScanFrame,
          trackedIds,
        }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourcePropagandaTowerBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourcePropagandaTowerBehaviorBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-propaganda-tower-behavior');
  try {
    const scanDelayFrames = sourceNonNegativeInt(
      entity.propagandaTowerProfile?.scanDelayFrames,
      0,
    );
    const nextScanFrame = sourceNonNegativeInt(
      entity.propagandaTowerNextScanFrame,
      preservedState.lastScanFrame + scanDelayFrames,
    );
    const lastScanFrame = Math.max(0, nextScanFrame - scanDelayFrames);
    const statusFlags = entity.objectStatusFlags ?? new Set<string>();
    const sleepsForever = entity.destroyed || statusFlags.has('SOLD');

    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(sleepsForever ? SOURCE_FRAME_FOREVER : currentFrame + 1),
    ));
    saver.xferUnsignedInt(lastScanFrame);
    xferSourceObjectIdListByUnsignedShortCount(
      saver,
      Array.isArray(entity.propagandaTowerTrackedIds)
        ? entity.propagandaTowerTrackedIds
        : preservedState.trackedIds,
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourcePropagandaTowerBehaviorBlockState(): SourcePropagandaTowerBehaviorBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    lastScanFrame: 0,
    trackedIds: [],
  };
}

function tryParseSourceBridgeScaffoldBehaviorBlockData(
  data: Uint8Array,
): SourceBridgeScaffoldBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-bridge-scaffold-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(
      xferLoad,
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    );
    const targetMotion = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const createPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const riseToPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const buildPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const lateralSpeed = xferLoad.xferReal(0);
    const verticalSpeed = xferLoad.xferReal(0);
    const targetPos = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    return xferLoad.getRemaining() === 0
      ? {
          nextCallFrameAndPhase,
          targetMotion,
          createPos,
          riseToPos,
          buildPos,
          lateralSpeed,
          verticalSpeed,
          targetPos,
        }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceBridgeBehaviorBlockData(
  data: Uint8Array,
): SourceBridgeBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-bridge-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(
      xferLoad,
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    );
    const towerIds: number[] = [];
    for (let index = 0; index < SOURCE_BRIDGE_MAX_TOWERS; index += 1) {
      towerIds.push(xferLoad.xferObjectID(0));
    }
    const scaffoldPresent = xferLoad.xferBool(false);
    const scaffoldCount = xferLoad.xferUnsignedShort(0);
    const scaffoldIds: number[] = [];
    for (let index = 0; index < scaffoldCount; index += 1) {
      scaffoldIds.push(xferLoad.xferObjectID(0));
    }
    const deathFrame = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        towerIds,
        scaffoldPresent,
        scaffoldIds,
        deathFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceBridgeFixedTowerIds(
  entity: MapEntity,
  preservedState: SourceBridgeBehaviorBlockState,
): number[] {
  const sourceIds = Array.isArray(entity.bridgeBehaviorState?.towerIds)
    ? entity.bridgeBehaviorState.towerIds
    : preservedState.towerIds;
  return Array.from({ length: SOURCE_BRIDGE_MAX_TOWERS }, (_, index) =>
    normalizeSourceObjectId(sourceIds[index] ?? 0));
}

function sourceBridgeScaffoldIds(
  entity: MapEntity,
  preservedState: SourceBridgeBehaviorBlockState,
): number[] {
  const sourceIds = Array.isArray(entity.bridgeBehaviorState?.scaffoldIds)
    ? entity.bridgeBehaviorState.scaffoldIds
    : preservedState.scaffoldIds;
  const scaffoldIds = sourceIds.map(normalizeSourceObjectId);
  if (scaffoldIds.length > 0xffff) {
    throw new Error(`BridgeBehavior source save has ${scaffoldIds.length} scaffold ids; C++ xfers an unsigned short count.`);
  }
  return scaffoldIds;
}

function buildSourceBridgeBehaviorBlockData(
  entity: MapEntity,
  preservedState: SourceBridgeBehaviorBlockState,
): Uint8Array {
  const towerIds = sourceBridgeFixedTowerIds(entity, preservedState);
  const scaffoldIds = sourceBridgeScaffoldIds(entity, preservedState);
  const bridgeState = entity.bridgeBehaviorState;
  const scaffoldPresent = typeof bridgeState?.scaffoldPresent === 'boolean'
    ? bridgeState.scaffoldPresent
    : (scaffoldIds.length > 0 ? true : preservedState.scaffoldPresent);
  const saver = new XferSave();
  saver.open('build-source-bridge-behavior');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(preservedState.nextCallFrameAndPhase));
    for (const towerId of towerIds) {
      saver.xferObjectID(towerId);
    }
    saver.xferBool(scaffoldPresent);
    saver.xferUnsignedShort(scaffoldIds.length);
    for (const scaffoldId of scaffoldIds) {
      saver.xferObjectID(scaffoldId);
    }
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(bridgeState?.deathFrame, preservedState.deathFrame));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceBridgeBehaviorBlockState(): SourceBridgeBehaviorBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    towerIds: Array.from({ length: SOURCE_BRIDGE_MAX_TOWERS }, () => 0),
    scaffoldPresent: false,
    scaffoldIds: [],
    deathFrame: 0,
  };
}

function tryParseSourceBridgeTowerBehaviorBlockData(
  data: Uint8Array,
): SourceBridgeTowerBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-bridge-tower-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferSourceBehaviorModuleBase(xferLoad);
    const bridgeId = xferLoad.xferObjectID(0);
    const towerType = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    return xferLoad.getRemaining() === 0 ? { bridgeId, towerType } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceBridgeTowerBehaviorBlockData(
  entity: MapEntity,
  preservedState: SourceBridgeTowerBehaviorBlockState,
): Uint8Array {
  const towerState = entity.bridgeTowerState;
  const saver = new XferSave();
  saver.open('build-source-bridge-tower-behavior');
  try {
    saver.xferVersion(1);
    xferSourceBehaviorModuleBase(saver);
    saver.xferObjectID(normalizeSourceObjectId(towerState?.bridgeEntityId ?? preservedState.bridgeId));
    saver.xferUser(buildSourceRawInt32Bytes(sourceFiniteInt(towerState?.towerType, preservedState.towerType)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceBridgeTowerBehaviorBlockState(): SourceBridgeTowerBehaviorBlockState {
  return {
    bridgeId: 0,
    towerType: 0,
  };
}

function tryParseSourceSpecialPowerCompletionDieBlockData(
  data: Uint8Array,
): SourceSpecialPowerCompletionDieBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-special-power-completion-die');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferSourceDieModuleBase(xferLoad);
    const creatorId = xferLoad.xferObjectID(0);
    const creatorSet = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0 ? { creatorId, creatorSet } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpecialPowerCompletionDieBlockData(
  entity: MapEntity,
  preservedState: SourceSpecialPowerCompletionDieBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-special-power-completion-die');
  try {
    saver.xferVersion(1);
    xferSourceDieModuleBase(saver);
    saver.xferObjectID(normalizeSourceObjectId(
      entity.specialPowerCompletionCreatorId ?? preservedState.creatorId,
    ));
    saver.xferBool(typeof entity.specialPowerCompletionCreatorSet === 'boolean'
      ? entity.specialPowerCompletionCreatorSet
      : preservedState.creatorSet);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceSpecialPowerCompletionDieBlockState(): SourceSpecialPowerCompletionDieBlockState {
  return {
    creatorId: 0,
    creatorSet: false,
  };
}

function tryParseSourceParkingPlaceBehaviorBlockData(
  data: Uint8Array,
): SourceParkingPlaceBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-parking-place-behavior');
  try {
    const version = xferLoad.xferVersion(3);
    if (version < 1 || version > 3) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const spaceCount = xferLoad.xferUnsignedByte(0);
    const spaces: SourceParkingPlaceBehaviorBlockState['spaces'] = [];
    for (let index = 0; index < spaceCount; index += 1) {
      spaces.push({
        occupantId: xferLoad.xferObjectID(0),
        reservedForExit: xferLoad.xferBool(false),
      });
    }
    const runwayCount = xferLoad.xferUnsignedByte(0);
    const runways: SourceParkingPlaceBehaviorBlockState['runways'] = [];
    for (let index = 0; index < runwayCount; index += 1) {
      runways.push({
        inUseBy: xferLoad.xferObjectID(0),
        nextInLineForTakeoff: xferLoad.xferObjectID(0),
        wasInLine: xferLoad.xferBool(false),
      });
    }
    const healCount = xferLoad.xferUnsignedByte(0);
    const healees: SourceParkingPlaceBehaviorBlockState['healees'] = [];
    for (let index = 0; index < healCount; index += 1) {
      healees.push({
        entityId: xferLoad.xferObjectID(0),
        healStartFrame: xferLoad.xferUnsignedInt(0),
      });
    }
    const heliRallyPoint = version >= 2 ? xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 };
    const heliRallyPointExists = version >= 2 ? xferLoad.xferBool(false) : false;
    const nextHealFrame = version >= 3 ? xferLoad.xferUnsignedInt(0) : 0;
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        spaces,
        runways,
        healees,
        heliRallyPoint,
        heliRallyPointExists,
        nextHealFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function assertSourceUnsignedByteCount(label: string, count: number): void {
  if (count > 0xff) {
    throw new Error(`${label} has ${count} entries; C++ xfers an unsigned byte count.`);
  }
}

function sourceParkingSpacesForEntity(
  entity: MapEntity,
  preservedState: SourceParkingPlaceBehaviorBlockState,
): SourceParkingPlaceBehaviorBlockState['spaces'] {
  const profile = entity.parkingPlaceProfile;
  const count = Math.max(0, Math.trunc(profile?.totalSpaces ?? preservedState.spaces.length));
  assertSourceUnsignedByteCount('ParkingPlaceBehavior spaces', count);

  const occupantIds = Array.isArray(profile?.spaceOccupantIds) ? profile!.spaceOccupantIds : [];
  const reservedFlags = Array.isArray(profile?.spaceReservedForExit) ? profile!.spaceReservedForExit : [];
  const spaces = Array.from({ length: count }, (_, index) => ({
    occupantId: normalizeSourceObjectId(occupantIds[index] ?? preservedState.spaces[index]?.occupantId ?? 0),
    reservedForExit: typeof reservedFlags[index] === 'boolean'
      ? reservedFlags[index]!
      : preservedState.spaces[index]?.reservedForExit === true,
  }));

  const liveOccupiedIds = profile?.occupiedSpaceEntityIds instanceof Set
    ? Array.from(profile.occupiedSpaceEntityIds.values()).map(normalizeSourceObjectId).filter((entityId) => entityId > 0)
    : [];
  for (const occupiedId of liveOccupiedIds) {
    if (spaces.some((space) => space.occupantId === occupiedId)) {
      continue;
    }
    const freeSpace = spaces.find((space) => space.occupantId <= 0 && !space.reservedForExit);
    if (freeSpace) {
      freeSpace.occupantId = occupiedId;
    }
  }
  return spaces;
}

function sourceParkingRunwaysForEntity(
  entity: MapEntity,
  preservedState: SourceParkingPlaceBehaviorBlockState,
): SourceParkingPlaceBehaviorBlockState['runways'] {
  const profile = entity.parkingPlaceProfile;
  const inUseByIds = Array.isArray(profile?.runwayInUseByIds) ? profile!.runwayInUseByIds : [];
  const nextInLineIds = Array.isArray(profile?.runwayNextInLineForTakeoffIds)
    ? profile!.runwayNextInLineForTakeoffIds
    : [];
  const wasInLine = Array.isArray(profile?.runwayWasInLine) ? profile!.runwayWasInLine : [];
  const count = Math.max(inUseByIds.length, nextInLineIds.length, wasInLine.length, preservedState.runways.length);
  assertSourceUnsignedByteCount('ParkingPlaceBehavior runways', count);
  return Array.from({ length: count }, (_, index) => ({
    inUseBy: normalizeSourceObjectId(inUseByIds[index] ?? preservedState.runways[index]?.inUseBy ?? 0),
    nextInLineForTakeoff: normalizeSourceObjectId(
      nextInLineIds[index] ?? preservedState.runways[index]?.nextInLineForTakeoff ?? 0,
    ),
    wasInLine: typeof wasInLine[index] === 'boolean'
      ? wasInLine[index]!
      : preservedState.runways[index]?.wasInLine === true,
  }));
}

function sourceParkingHealeesForEntity(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceParkingPlaceBehaviorBlockState,
): SourceParkingPlaceBehaviorBlockState['healees'] {
  const profile = entity.parkingPlaceProfile;
  const healeeStates = Array.isArray(profile?.healeeStates) ? profile!.healeeStates : preservedState.healees;
  const healees = healeeStates
    .map((healee) => ({
      entityId: normalizeSourceObjectId(healee.entityId),
      healStartFrame: sourceFlammableUnsignedFrame(healee.healStartFrame, currentFrame),
    }))
    .filter((healee) => healee.entityId > 0);
  const healeeIds = profile?.healeeEntityIds instanceof Set
    ? Array.from(profile.healeeEntityIds.values()).map(normalizeSourceObjectId).filter((entityId) => entityId > 0)
    : [];
  for (const entityId of healeeIds) {
    if (!healees.some((healee) => healee.entityId === entityId)) {
      healees.push({ entityId, healStartFrame: Math.max(0, Math.trunc(currentFrame)) });
    }
  }
  assertSourceUnsignedByteCount('ParkingPlaceBehavior healees', healees.length);
  return healees;
}

function buildSourceParkingPlaceBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceParkingPlaceBehaviorBlockState,
): Uint8Array {
  const profile = entity.parkingPlaceProfile;
  const spaces = sourceParkingSpacesForEntity(entity, preservedState);
  const runways = sourceParkingRunwaysForEntity(entity, preservedState);
  const healees = sourceParkingHealeesForEntity(entity, currentFrame, preservedState);
  const heliRallyPoint = profile?.heliRallyPoint ?? preservedState.heliRallyPoint;
  const saver = new XferSave();
  saver.open('build-source-parking-place-behavior');
  try {
    saver.xferVersion(3);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(preservedState.nextCallFrameAndPhase));
    saver.xferUnsignedByte(spaces.length);
    for (const space of spaces) {
      saver.xferObjectID(space.occupantId);
      saver.xferBool(space.reservedForExit);
    }
    saver.xferUnsignedByte(runways.length);
    for (const runway of runways) {
      saver.xferObjectID(runway.inUseBy);
      saver.xferObjectID(runway.nextInLineForTakeoff);
      saver.xferBool(runway.wasInLine);
    }
    saver.xferUnsignedByte(healees.length);
    for (const healee of healees) {
      saver.xferObjectID(healee.entityId);
      saver.xferUnsignedInt(healee.healStartFrame);
    }
    saver.xferCoord3D({
      x: Number.isFinite(heliRallyPoint.x) ? heliRallyPoint.x : preservedState.heliRallyPoint.x,
      y: Number.isFinite(heliRallyPoint.y) ? heliRallyPoint.y : preservedState.heliRallyPoint.y,
      z: Number.isFinite(heliRallyPoint.z) ? heliRallyPoint.z : preservedState.heliRallyPoint.z,
    });
    saver.xferBool(typeof profile?.heliRallyPointExists === 'boolean'
      ? profile.heliRallyPointExists
      : preservedState.heliRallyPointExists);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(profile?.nextHealFrame, preservedState.nextHealFrame));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceParkingPlaceBehaviorBlockState(
  currentFrame: number,
): SourceParkingPlaceBehaviorBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    spaces: [],
    runways: [],
    healees: [],
    heliRallyPoint: { x: 0, y: 0, z: 0 },
    heliRallyPointExists: false,
    nextHealFrame: SOURCE_FRAME_FOREVER,
  };
}

function tryParseSourceFlightDeckBehaviorBlockData(data: Uint8Array): SourceFlightDeckBehaviorBlockState | null {
  if (data.byteLength < 78 || data[0] !== 1) {
    return null;
  }

  const blockData = new Uint8Array(data);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  for (let tailOffset = 1; tailOffset <= blockData.byteLength - 77; tailOffset += 1) {
    let cursor = tailOffset;
    const spaceCount = view.getUint8(cursor);
    cursor += 1;
    if (cursor + spaceCount * 4 >= blockData.byteLength) {
      continue;
    }
    const spaces: number[] = [];
    for (let index = 0; index < spaceCount; index += 1) {
      spaces.push(view.getUint32(cursor, true));
      cursor += 4;
    }

    if (cursor >= blockData.byteLength) {
      continue;
    }
    const runwayCount = view.getUint8(cursor);
    cursor += 1;
    if (cursor + runwayCount * 8 >= blockData.byteLength) {
      continue;
    }
    const runways: SourceFlightDeckBehaviorBlockState['runways'] = [];
    for (let index = 0; index < runwayCount; index += 1) {
      runways.push({
        takeoffId: view.getUint32(cursor, true),
        landingId: view.getUint32(cursor + 4, true),
      });
      cursor += 8;
    }

    if (cursor >= blockData.byteLength) {
      continue;
    }
    const healCount = view.getUint8(cursor);
    cursor += 1;
    if (cursor + healCount * 8 + 74 !== blockData.byteLength) {
      continue;
    }
    const healees: SourceFlightDeckBehaviorBlockState['healees'] = [];
    for (let index = 0; index < healCount; index += 1) {
      healees.push({
        entityId: view.getUint32(cursor, true),
        healStartFrame: view.getUint32(cursor + 4, true),
      });
      cursor += 8;
    }

    const nextHealFrame = view.getUint32(cursor, true); cursor += 4;
    const nextCleanupFrame = view.getUint32(cursor, true); cursor += 4;
    const startedProductionFrame = view.getUint32(cursor, true); cursor += 4;
    const nextAllowedProductionFrame = view.getUint32(cursor, true); cursor += 4;
    const designatedTargetId = view.getUint32(cursor, true); cursor += 4;
    const designatedCommandType = view.getInt32(cursor, true); cursor += 4;
    const designatedPosition = {
      x: view.getFloat32(cursor, true),
      y: view.getFloat32(cursor + 4, true),
      z: view.getFloat32(cursor + 8, true),
    };
    cursor += 12;
    const maxRunways = view.getUint32(cursor, true);
    cursor += 4;
    if (maxRunways !== SOURCE_FLIGHT_DECK_MAX_RUNWAYS) {
      continue;
    }

    const nextLaunchWaveFrame: number[] = [];
    const rampUpFrame: number[] = [];
    const catapultSystemFrame: number[] = [];
    const lowerRampFrame: number[] = [];
    const rampUpXferFlags: boolean[] = [];
    let valid = true;
    for (let index = 0; index < SOURCE_FLIGHT_DECK_MAX_RUNWAYS; index += 1) {
      nextLaunchWaveFrame.push(view.getUint32(cursor, true)); cursor += 4;
      rampUpFrame.push(view.getUint32(cursor, true)); cursor += 4;
      catapultSystemFrame.push(view.getUint32(cursor, true)); cursor += 4;
      lowerRampFrame.push(view.getUint32(cursor, true)); cursor += 4;
      const rampFlag = view.getUint8(cursor);
      cursor += 1;
      if (rampFlag !== 0 && rampFlag !== 1) {
        valid = false;
        break;
      }
      rampUpXferFlags.push(rampFlag !== 0);
    }
    if (!valid || cursor !== blockData.byteLength) {
      continue;
    }

    return {
      blockData,
      tailOffset,
      spaces,
      runways,
      healees,
      nextHealFrame,
      nextCleanupFrame,
      startedProductionFrame,
      nextAllowedProductionFrame,
      designatedTargetId,
      designatedCommandType,
      designatedPosition,
      nextLaunchWaveFrame,
      rampUpFrame,
      catapultSystemFrame,
      lowerRampFrame,
      rampUpXferFlags,
    };
  }
  return null;
}

function concatSourceBytes(prefix: Uint8Array, suffix: Uint8Array): Uint8Array {
  const result = new Uint8Array(prefix.byteLength + suffix.byteLength);
  result.set(prefix, 0);
  result.set(suffix, prefix.byteLength);
  return result;
}

function sourceFlightDeckCommandType(command: unknown, fallback: number): number {
  switch (typeof command === 'string' ? command.trim().toUpperCase() : '') {
    case 'NONE': return -1;
    case 'IDLE': return 5;
    case 'ATTACK_OBJECT': return 11;
    case 'FORCE_ATTACK_OBJECT': return 12;
    case 'ATTACK_POSITION': return 14;
    case 'ATTACKMOVE_TO_POSITION': return 15;
    case 'GUARD_POSITION': return 29;
    default:
      return Number.isFinite(fallback) ? Math.trunc(fallback) : -1;
  }
}

function sourceFlightDeckHealeesForEntity(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceFlightDeckBehaviorBlockState,
): SourceFlightDeckBehaviorBlockState['healees'] {
  const state = entity.flightDeckState;
  const healeeStates = Array.isArray(state?.healeeStates) ? state!.healeeStates : preservedState.healees;
  const healees = healeeStates
    .map((healee) => ({
      entityId: normalizeSourceObjectId(healee.entityId),
      healStartFrame: sourceFlammableUnsignedFrame(healee.healStartFrame, currentFrame),
    }))
    .filter((healee) => healee.entityId > 0);
  const healeeIds = state?.healeeEntityIds instanceof Set
    ? Array.from(state.healeeEntityIds.values()).map(normalizeSourceObjectId).filter((entityId) => entityId > 0)
    : [];
  for (const entityId of healeeIds) {
    if (!healees.some((healee) => healee.entityId === entityId)) {
      healees.push({ entityId, healStartFrame: Math.max(0, Math.trunc(currentFrame)) });
    }
  }
  assertSourceUnsignedByteCount('FlightDeckBehavior healees', healees.length);
  return healees;
}

function buildSourceFlightDeckBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceFlightDeckBehaviorBlockState,
): Uint8Array {
  const state = entity.flightDeckState;
  const spaces = Array.isArray(state?.parkingSpaces)
    ? state!.parkingSpaces.map((space) => normalizeSourceObjectId(space.occupantId))
    : preservedState.spaces;
  assertSourceUnsignedByteCount('FlightDeckBehavior spaces', spaces.length);
  const runways = Array.from(
    { length: Math.max(state?.runwayTakeoffReservation?.length ?? 0, state?.runwayLandingReservation?.length ?? 0, preservedState.runways.length) },
    (_, index) => ({
      takeoffId: normalizeSourceObjectId(state?.runwayTakeoffReservation?.[index] ?? preservedState.runways[index]?.takeoffId ?? 0),
      landingId: normalizeSourceObjectId(state?.runwayLandingReservation?.[index] ?? preservedState.runways[index]?.landingId ?? 0),
    }),
  );
  assertSourceUnsignedByteCount('FlightDeckBehavior runways', runways.length);
  const healees = sourceFlightDeckHealeesForEntity(entity, currentFrame, preservedState);
  const rawRampFlags = Array.isArray(state?.sourceRampUpXferFlags) && state!.sourceRampUpXferFlags.length >= SOURCE_FLIGHT_DECK_MAX_RUNWAYS
    ? state!.sourceRampUpXferFlags
    : (Array.isArray(state?.rampUp) ? state!.rampUp : preservedState.rampUpXferFlags);

  const tail = new XferSave();
  tail.open('build-source-flight-deck-tail');
  try {
    tail.xferUnsignedByte(spaces.length);
    for (const occupantId of spaces) {
      tail.xferObjectID(occupantId);
    }
    tail.xferUnsignedByte(runways.length);
    for (const runway of runways) {
      tail.xferObjectID(runway.takeoffId);
      tail.xferObjectID(runway.landingId);
    }
    tail.xferUnsignedByte(healees.length);
    for (const healee of healees) {
      tail.xferObjectID(healee.entityId);
      tail.xferUnsignedInt(healee.healStartFrame);
    }
    tail.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.nextHealFrame, preservedState.nextHealFrame));
    tail.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.nextCleanupFrame, preservedState.nextCleanupFrame));
    tail.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.startedProductionFrame, preservedState.startedProductionFrame));
    tail.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.nextAllowedProductionFrame, preservedState.nextAllowedProductionFrame));
    tail.xferObjectID(normalizeSourceObjectId(state?.designatedTargetId ?? preservedState.designatedTargetId));
    tail.xferInt(sourceFlightDeckCommandType(state?.designatedCommand, state?.designatedCommandType ?? preservedState.designatedCommandType));
    tail.xferCoord3D({
      x: sourcePhysicsFinite(state?.designatedPositionX, preservedState.designatedPosition.x),
      y: sourcePhysicsFinite(state?.designatedPositionY, preservedState.designatedPosition.y),
      z: sourcePhysicsFinite(state?.designatedPositionZ, preservedState.designatedPosition.z),
    });
    tail.xferUnsignedInt(SOURCE_FLIGHT_DECK_MAX_RUNWAYS);
    for (let index = 0; index < SOURCE_FLIGHT_DECK_MAX_RUNWAYS; index += 1) {
      tail.xferUnsignedInt(sourceFlammableUnsignedFrame(
        state?.nextLaunchWaveFrame?.[index],
        preservedState.nextLaunchWaveFrame[index] ?? 0,
      ));
      tail.xferUnsignedInt(sourceFlammableUnsignedFrame(
        state?.rampUpFrame?.[index],
        preservedState.rampUpFrame[index] ?? 0,
      ));
      tail.xferUnsignedInt(sourceFlammableUnsignedFrame(
        state?.catapultSystemFrame?.[index],
        preservedState.catapultSystemFrame[index] ?? 0,
      ));
      tail.xferUnsignedInt(sourceFlammableUnsignedFrame(
        state?.lowerRampFrame?.[index],
        preservedState.lowerRampFrame[index] ?? 0,
      ));
      tail.xferBool(rawRampFlags[index] === true);
    }
    return concatSourceBytes(
      preservedState.blockData.subarray(0, preservedState.tailOffset),
      new Uint8Array(tail.getBuffer()),
    );
  } finally {
    tail.close();
  }
}

function runtimeCoord3DToSourceCoord3D(
  coord: { x: number; y: number; z: number } | undefined,
  fallback: Coord3D,
): Coord3D {
  return {
    x: sourcePhysicsFinite(coord?.x, fallback.x),
    y: sourcePhysicsFinite(coord?.z, fallback.y),
    z: sourcePhysicsFinite(coord?.y, fallback.z),
  };
}

function buildSourceBridgeScaffoldBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceBridgeScaffoldBehaviorBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-bridge-scaffold-behavior');
  try {
    const state = entity.bridgeScaffoldState;
    const targetMotion = sourceFiniteInt(state?.targetMotion, preservedState.targetMotion);
    const nextCallFrame = targetMotion === 0
      ? Math.max(0, Math.trunc(preservedState.nextCallFrameAndPhase >>> 2))
      : currentFrame + 1;

    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferUser(buildSourceRawInt32Bytes(targetMotion));
    saver.xferCoord3D(runtimeCoord3DToSourceCoord3D(state?.createPos, preservedState.createPos));
    saver.xferCoord3D(runtimeCoord3DToSourceCoord3D(state?.riseToPos, preservedState.riseToPos));
    saver.xferCoord3D(runtimeCoord3DToSourceCoord3D(state?.buildPos, preservedState.buildPos));
    saver.xferReal(sourcePhysicsFinite(state?.lateralSpeed, preservedState.lateralSpeed));
    saver.xferReal(sourcePhysicsFinite(state?.verticalSpeed, preservedState.verticalSpeed));
    saver.xferCoord3D(runtimeCoord3DToSourceCoord3D(state?.targetPos, preservedState.targetPos));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceBridgeScaffoldBehaviorBlockState(): SourceBridgeScaffoldBehaviorBlockState {
  return {
    nextCallFrameAndPhase: 0,
    targetMotion: 0,
    createPos: { x: 0, y: 0, z: 0 },
    riseToPos: { x: 0, y: 0, z: 0 },
    buildPos: { x: 0, y: 0, z: 0 },
    lateralSpeed: 1,
    verticalSpeed: 1,
    targetPos: { x: 0, y: 0, z: 0 },
  };
}

function tryParseSourceBaseOnlyUpdateModuleBlockData(
  data: Uint8Array,
  label: string,
): SourceBaseOnlyUpdateModuleBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open(`parse-source-${label}`);
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(
      xferLoad,
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    );
    return xferLoad.getRemaining() === 0 ? { nextCallFrameAndPhase } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceBaseOnlyUpdateModuleBlockData(
  label: string,
  nextCallFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open(`build-source-${label}`);
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

function sourceTechBuildingNextWakeFrame(entity: MapEntity, currentFrame: number): number {
  const profile = entity.techBuildingProfile;
  const modelConditionFlags = entity.modelConditionFlags;
  const captured = modelConditionFlags instanceof Set && modelConditionFlags.has('CAPTURED');
  if (profile?.hasPulseFX === true && profile.pulseFXRateFrames > 0 && captured) {
    return currentFrame + Math.max(1, Math.trunc(profile.pulseFXRateFrames));
  }
  return SOURCE_FRAME_FOREVER;
}

function createDefaultSourceSlowDeathBehaviorBlockState(): SourceSlowDeathBehaviorBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    sinkFrame: 0,
    midpointFrame: 0,
    destructionFrame: 0,
    acceleratedTimeScale: 1,
    flags: 0,
  };
}

function xferSourceSlowDeathBehaviorBlockState(
  xfer: Xfer,
  state: SourceSlowDeathBehaviorBlockState,
): SourceSlowDeathBehaviorBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source SlowDeathBehavior version ${version}`);
  }
  const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xfer, state.nextCallFrameAndPhase);
  return {
    nextCallFrameAndPhase,
    sinkFrame: xfer.xferUnsignedInt(state.sinkFrame),
    midpointFrame: xfer.xferUnsignedInt(state.midpointFrame),
    destructionFrame: xfer.xferUnsignedInt(state.destructionFrame),
    acceleratedTimeScale: xfer.xferReal(state.acceleratedTimeScale),
    flags: xfer.xferUnsignedInt(state.flags),
  };
}

function tryParseSourceSlowDeathBehaviorBlockData(data: Uint8Array): SourceSlowDeathBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-slow-death-behavior');
  try {
    const state = xferSourceSlowDeathBehaviorBlockState(
      xferLoad,
      createDefaultSourceSlowDeathBehaviorBlockState(),
    );
    return xferLoad.getRemaining() === 0 ? state : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceSlowDeathFlagsForEntity(entity: MapEntity, preservedFlags: number): number {
  const state = entity.slowDeathState;
  let flags = preservedFlags & ~SOURCE_SLOW_DEATH_LIVE_OWNED_FLAG_MASK;
  if (state) {
    flags |= SOURCE_SLOW_DEATH_FLAG_ACTIVATED;
    if (state.midpointExecuted) {
      flags |= SOURCE_SLOW_DEATH_FLAG_MIDPOINT_EXECUTED;
    }
    if (state.isFlung) {
      flags |= SOURCE_SLOW_DEATH_FLAG_FLUNG_INTO_AIR;
    }
    if (state.hasBounced) {
      flags |= SOURCE_SLOW_DEATH_FLAG_BOUNCED;
    }
  }
  return flags >>> 0;
}

function sourceSlowDeathWakeFrame(entity: MapEntity, currentFrame: number): number {
  return buildSourceUpdateModuleWakeFrame(
    entity.slowDeathState || entity.battleBusEmptyHulkDestroyFrame > currentFrame
      ? currentFrame + 1
      : SOURCE_FRAME_FOREVER,
  );
}

function buildSourceSlowDeathBehaviorState(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceSlowDeathBehaviorBlockState,
): SourceSlowDeathBehaviorBlockState {
  const state = entity.slowDeathState;
  return {
    nextCallFrameAndPhase: sourceSlowDeathWakeFrame(entity, currentFrame),
    sinkFrame: sourceFlammableUnsignedFrame(state?.sinkFrame, preservedState.sinkFrame),
    midpointFrame: sourceFlammableUnsignedFrame(state?.midpointFrame, preservedState.midpointFrame),
    destructionFrame: sourceFlammableUnsignedFrame(state?.destructionFrame, preservedState.destructionFrame),
    acceleratedTimeScale: sourcePhysicsFinite(
      preservedState.acceleratedTimeScale,
      createDefaultSourceSlowDeathBehaviorBlockState().acceleratedTimeScale,
    ),
    flags: sourceSlowDeathFlagsForEntity(entity, preservedState.flags),
  };
}

function buildSourceSlowDeathBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceSlowDeathBehaviorBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-slow-death-behavior');
  try {
    xferSourceSlowDeathBehaviorBlockState(
      saver,
      buildSourceSlowDeathBehaviorState(entity, currentFrame, preservedState),
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceBattleBusSlowDeathBehaviorBlockData(
  data: Uint8Array,
): SourceBattleBusSlowDeathBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-battle-bus-slow-death-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const slowDeath = xferSourceSlowDeathBehaviorBlockState(
      xferLoad,
      createDefaultSourceSlowDeathBehaviorBlockState(),
    );
    const isRealDeath = xferLoad.xferBool(false);
    const isInFirstDeath = xferLoad.xferBool(false);
    const groundCheckFrame = xferLoad.xferUnsignedInt(0);
    const penaltyDeathFrame = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? { slowDeath, isRealDeath, isInFirstDeath, groundCheckFrame, penaltyDeathFrame }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceBattleBusSlowDeathBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceBattleBusSlowDeathBehaviorBlockState,
): Uint8Array {
  const state = entity.slowDeathState;
  const isInFirstDeath = state?.isBattleBusFakeDeath === true;
  const isRealDeath = state !== null && state !== undefined && !isInFirstDeath;
  const saver = new XferSave();
  saver.open('build-source-battle-bus-slow-death-behavior');
  try {
    saver.xferVersion(1);
    xferSourceSlowDeathBehaviorBlockState(
      saver,
      buildSourceSlowDeathBehaviorState(entity, currentFrame, preservedState.slowDeath),
    );
    saver.xferBool(isRealDeath);
    saver.xferBool(isInFirstDeath);
    saver.xferUnsignedInt(isInFirstDeath
      ? sourceFlammableUnsignedFrame(state?.battleBusLandingCheckFrame, preservedState.groundCheckFrame)
      : 0);
    saver.xferUnsignedInt(!state && entity.battleBusEmptyHulkDestroyFrame > currentFrame
      ? sourceFlammableUnsignedFrame(entity.battleBusEmptyHulkDestroyFrame, preservedState.penaltyDeathFrame)
      : 0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceBattleBusSlowDeathBehaviorBlockState(): SourceBattleBusSlowDeathBehaviorBlockState {
  return {
    slowDeath: createDefaultSourceSlowDeathBehaviorBlockState(),
    isRealDeath: false,
    isInFirstDeath: false,
    groundCheckFrame: 0,
    penaltyDeathFrame: 0,
  };
}

function tryParseSourceHelicopterSlowDeathBehaviorBlockData(
  data: Uint8Array,
): SourceHelicopterSlowDeathBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-helicopter-slow-death-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const slowDeath = xferSourceSlowDeathBehaviorBlockState(
      xferLoad,
      createDefaultSourceSlowDeathBehaviorBlockState(),
    );
    const orbitDirection = xferLoad.xferInt(0);
    const forwardAngle = xferLoad.xferReal(0);
    const forwardSpeed = xferLoad.xferReal(0);
    const selfSpin = xferLoad.xferReal(0);
    const selfSpinTowardsMax = xferLoad.xferBool(false);
    const lastSelfSpinUpdateFrame = xferLoad.xferUnsignedInt(0);
    const bladeFlyOffFrame = xferLoad.xferUnsignedInt(0);
    const hitGroundFrame = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        slowDeath,
        orbitDirection,
        forwardAngle,
        forwardSpeed,
        selfSpin,
        selfSpinTowardsMax,
        lastSelfSpinUpdateFrame,
        bladeFlyOffFrame,
        hitGroundFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceHelicopterSlowDeathBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceHelicopterSlowDeathBehaviorBlockState,
): Uint8Array {
  const state = entity.helicopterSlowDeathState;
  const saver = new XferSave();
  saver.open('build-source-helicopter-slow-death-behavior');
  try {
    saver.xferVersion(1);
    xferSourceSlowDeathBehaviorBlockState(
      saver,
      buildSourceSlowDeathBehaviorState(entity, currentFrame, preservedState.slowDeath),
    );
    saver.xferInt(sourceFiniteInt(state?.orbitDirection, preservedState.orbitDirection));
    saver.xferReal(sourcePhysicsFinite(state?.forwardAngle, preservedState.forwardAngle));
    saver.xferReal(sourcePhysicsFinite(state?.forwardSpeed, preservedState.forwardSpeed));
    saver.xferReal(sourcePhysicsFinite(state?.selfSpin, preservedState.selfSpin));
    saver.xferBool(typeof state?.selfSpinTowardsMax === 'boolean'
      ? state.selfSpinTowardsMax
      : preservedState.selfSpinTowardsMax);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      state?.lastSelfSpinUpdateFrame,
      preservedState.lastSelfSpinUpdateFrame,
    ));
    saver.xferUnsignedInt(preservedState.bladeFlyOffFrame);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.hitGroundFrame, preservedState.hitGroundFrame));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceHelicopterSlowDeathBehaviorBlockState():
  SourceHelicopterSlowDeathBehaviorBlockState {
  return {
    slowDeath: createDefaultSourceSlowDeathBehaviorBlockState(),
    orbitDirection: 1,
    forwardAngle: 0,
    forwardSpeed: 0,
    selfSpin: 0,
    selfSpinTowardsMax: false,
    lastSelfSpinUpdateFrame: 0,
    bladeFlyOffFrame: 0,
    hitGroundFrame: 0,
  };
}

function tryParseSourceJetSlowDeathBehaviorBlockData(
  data: Uint8Array,
): SourceJetSlowDeathBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-jet-slow-death-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const slowDeath = xferSourceSlowDeathBehaviorBlockState(
      xferLoad,
      createDefaultSourceSlowDeathBehaviorBlockState(),
    );
    const timerDeathFrame = xferLoad.xferUnsignedInt(0);
    const timerOnGroundFrame = xferLoad.xferUnsignedInt(0);
    const rollRate = xferLoad.xferReal(0);
    return xferLoad.getRemaining() === 0
      ? { slowDeath, timerDeathFrame, timerOnGroundFrame, rollRate }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceJetSlowDeathBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceJetSlowDeathBehaviorBlockState,
): Uint8Array {
  const state = entity.jetSlowDeathState;
  const saver = new XferSave();
  saver.open('build-source-jet-slow-death-behavior');
  try {
    saver.xferVersion(1);
    xferSourceSlowDeathBehaviorBlockState(
      saver,
      buildSourceSlowDeathBehaviorState(entity, currentFrame, preservedState.slowDeath),
    );
    saver.xferUnsignedInt(state
      ? sourceFlammableUnsignedFrame(state.secondaryExecuted ? 0 : state.deathFrame, preservedState.timerDeathFrame)
      : 0);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.groundFrame, preservedState.timerOnGroundFrame));
    saver.xferReal(sourcePhysicsFinite(state?.rollRate, preservedState.rollRate));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceJetSlowDeathBehaviorBlockState(): SourceJetSlowDeathBehaviorBlockState {
  return {
    slowDeath: createDefaultSourceSlowDeathBehaviorBlockState(),
    timerDeathFrame: 0,
    timerOnGroundFrame: 0,
    rollRate: 0,
  };
}

function tryParseSourceNeutronMissileSlowDeathBehaviorBlockData(
  data: Uint8Array,
): SourceNeutronMissileSlowDeathBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-neutron-missile-slow-death-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const slowDeath = xferSourceSlowDeathBehaviorBlockState(
      xferLoad,
      createDefaultSourceSlowDeathBehaviorBlockState(),
    );
    const activationFrame = xferLoad.xferUnsignedInt(0);
    const maxNeutronBlasts = xferLoad.xferUnsignedByte(SOURCE_MAX_NEUTRON_BLASTS);
    if (maxNeutronBlasts !== SOURCE_MAX_NEUTRON_BLASTS) {
      return null;
    }
    const completedBlasts: boolean[] = [];
    for (let index = 0; index < maxNeutronBlasts; index += 1) {
      completedBlasts.push(xferLoad.xferBool(false));
    }
    const completedScorchBlasts: boolean[] = [];
    for (let index = 0; index < maxNeutronBlasts; index += 1) {
      completedScorchBlasts.push(xferLoad.xferBool(false));
    }
    const scorchPlaced = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? { slowDeath, activationFrame, completedBlasts, completedScorchBlasts, scorchPlaced }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceNeutronMissileSlowDeathBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceNeutronMissileSlowDeathBehaviorBlockState,
): Uint8Array {
  const state = entity.neutronMissileSlowDeathState;
  const saver = new XferSave();
  saver.open('build-source-neutron-missile-slow-death-behavior');
  try {
    saver.xferVersion(1);
    xferSourceSlowDeathBehaviorBlockState(
      saver,
      buildSourceSlowDeathBehaviorState(entity, currentFrame, preservedState.slowDeath),
    );
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(state?.activationFrame, preservedState.activationFrame));
    saver.xferUnsignedByte(SOURCE_MAX_NEUTRON_BLASTS);
    for (let index = 0; index < SOURCE_MAX_NEUTRON_BLASTS; index += 1) {
      saver.xferBool(state?.completedBlasts[index] ?? preservedState.completedBlasts[index] ?? false);
    }
    for (let index = 0; index < SOURCE_MAX_NEUTRON_BLASTS; index += 1) {
      saver.xferBool(state?.completedScorchBlasts[index] ?? preservedState.completedScorchBlasts[index] ?? false);
    }
    saver.xferBool(preservedState.scorchPlaced);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceNeutronMissileSlowDeathBehaviorBlockState():
  SourceNeutronMissileSlowDeathBehaviorBlockState {
  return {
    slowDeath: createDefaultSourceSlowDeathBehaviorBlockState(),
    activationFrame: 0,
    completedBlasts: Array.from({ length: SOURCE_MAX_NEUTRON_BLASTS }, () => false),
    completedScorchBlasts: Array.from({ length: SOURCE_MAX_NEUTRON_BLASTS }, () => false),
    scorchPlaced: false,
  };
}

function xferSourceProductionExitRallyState(
  xfer: Xfer,
  state: SourceProductionExitRallyState,
): SourceProductionExitRallyState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source production exit version ${version}`);
  }
  const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xfer, state.nextCallFrameAndPhase);
  const rallyPoint = xfer.xferCoord3D(state.rallyPoint);
  const rallyPointExists = xfer.xferBool(state.rallyPointExists);
  return {
    nextCallFrameAndPhase,
    rallyPoint,
    rallyPointExists,
  };
}

function createDefaultSourceProductionExitRallyState(): SourceProductionExitRallyState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    rallyPoint: { x: 0, y: 0, z: 0 },
    rallyPointExists: false,
  };
}

function tryParseSourceProductionExitRallyBlockData(
  data: Uint8Array,
): SourceProductionExitRallyState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-production-exit-rally');
  try {
    const state = xferSourceProductionExitRallyState(xferLoad, createDefaultSourceProductionExitRallyState());
    return xferLoad.getRemaining() === 0 ? state : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceProductionExitRallyBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceProductionExitRallyState,
  active = false,
): Uint8Array {
  const rallyPointExists = entity.rallyPoint != null;
  const saver = new XferSave();
  saver.open('build-source-production-exit-rally');
  try {
    xferSourceProductionExitRallyState(saver, {
      nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(
        active ? currentFrame + 1 : SOURCE_FRAME_FOREVER,
      ),
      rallyPoint: {
        x: entity.rallyPoint?.x ?? preservedState.rallyPoint.x,
        y: rallyPointExists
          ? sourcePhysicsFinite(entity.rallyPointY, preservedState.rallyPoint.y)
          : preservedState.rallyPoint.y,
        z: entity.rallyPoint?.z ?? preservedState.rallyPoint.z,
      },
      rallyPointExists,
    });
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceQueueProductionExitBlockState(
  entity: MapEntity,
): SourceQueueProductionExitBlockState {
  return {
    ...createDefaultSourceProductionExitRallyState(),
    currentDelay: 0,
    creationClearDistance: 0,
    currentBurstCount: sourceNonNegativeInt(entity.queueProductionExitProfile?.initialBurst, 0),
  };
}

function tryParseSourceQueueProductionExitBlockData(
  data: Uint8Array,
): SourceQueueProductionExitBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-queue-production-exit');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const currentDelay = xferLoad.xferUnsignedInt(0);
    const rallyPoint = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const rallyPointExists = xferLoad.xferBool(false);
    const creationClearDistance = xferLoad.xferReal(0);
    const currentBurstCount = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        currentDelay,
        rallyPoint,
        rallyPointExists,
        creationClearDistance,
        currentBurstCount,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceQueueProductionExitBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceQueueProductionExitBlockState,
): Uint8Array {
  const rallyPointExists = entity.rallyPoint != null;
  const saver = new XferSave();
  saver.open('build-source-queue-production-exit');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(saver, buildSourceUpdateModuleWakeFrame(currentFrame + 1));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.queueProductionExitDelayFramesRemaining,
      preservedState.currentDelay,
    ));
    saver.xferCoord3D({
      x: entity.rallyPoint?.x ?? preservedState.rallyPoint.x,
      y: rallyPointExists
        ? sourcePhysicsFinite(entity.rallyPointY, preservedState.rallyPoint.y)
        : preservedState.rallyPoint.y,
      z: entity.rallyPoint?.z ?? preservedState.rallyPoint.z,
    });
    saver.xferBool(rallyPointExists);
    saver.xferReal(sourcePhysicsFinite(
      entity.queueProductionExitCreationClearDistance,
      preservedState.creationClearDistance,
    ));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.queueProductionExitBurstRemaining,
      preservedState.currentBurstCount,
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceSpawnPointProductionExitBlockData(
  data: Uint8Array,
): SourceSpawnPointProductionExitBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-spawn-point-production-exit');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const occupierIds: number[] = [];
    for (let index = 0; index < SOURCE_SPAWN_POINT_MAX_POINTS; index += 1) {
      occupierIds.push(xferLoad.xferObjectID(0));
    }
    return xferLoad.getRemaining() === 0
      ? { nextCallFrameAndPhase, occupierIds }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpawnPointProductionExitBlockData(
  entity: MapEntity,
  _currentFrame: number,
  preservedState: SourceSpawnPointProductionExitBlockState,
): Uint8Array {
  const liveOccupiers = entity.spawnPointExitState?.occupierIds;
  const saver = new XferSave();
  saver.open('build-source-spawn-point-production-exit');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(saver, buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER));
    for (let index = 0; index < SOURCE_SPAWN_POINT_MAX_POINTS; index += 1) {
      saver.xferObjectID(normalizeSourceObjectId(liveOccupiers?.[index] ?? preservedState.occupierIds[index] ?? 0));
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceSpawnPointProductionExitBlockState(): SourceSpawnPointProductionExitBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    occupierIds: Array.from({ length: SOURCE_SPAWN_POINT_MAX_POINTS }, () => 0),
  };
}

const SOURCE_DOCK_VECTOR_LIMIT = 0xffff;
const SOURCE_RAILED_TRANSPORT_MAX_WAYPOINT_PATHS = 32;
const SOURCE_DOCK_DYNAMIC_APPROACH_VECTOR_FLAG = -1;
const SOURCE_DOCK_DYNAMIC_APPROACH_VECTOR_SIZE = 10;

function createDefaultSourceDockUpdateBlockState(
  numberApproachPositions = 0,
): SourceDockUpdateBlockState {
  const normalizedCount = sourceFiniteInt(numberApproachPositions, 0);
  const vectorSize = normalizedCount === SOURCE_DOCK_DYNAMIC_APPROACH_VECTOR_FLAG
    ? SOURCE_DOCK_DYNAMIC_APPROACH_VECTOR_SIZE
    : Math.max(0, normalizedCount);
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    enterPosition: { x: 0, y: 0, z: 0 },
    dockPosition: { x: 0, y: 0, z: 0 },
    exitPosition: { x: 0, y: 0, z: 0 },
    numberApproachPositions: normalizedCount,
    positionsLoaded: false,
    approachPositions: Array.from({ length: vectorSize }, () => ({ x: 0, y: 0, z: 0 })),
    approachPositionOwners: Array.from({ length: vectorSize }, () => 0),
    approachPositionReached: Array.from({ length: vectorSize }, () => false),
    activeDocker: 0,
    dockerInside: false,
    dockCrippled: false,
    dockOpen: true,
  };
}

function sourceFiniteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function sourceNonNegativeInt(value: unknown, fallback: number): number {
  const resolved = sourceFiniteInt(value, fallback);
  return Math.max(0, resolved);
}

function xferSourceDockCoordVector(xfer: Xfer, values: readonly Coord3D[]): Coord3D[] {
  const count = xfer.xferInt(values.length);
  if (count < 0 || count > SOURCE_DOCK_VECTOR_LIMIT) {
    throw new Error(`Unsupported source DockUpdate Coord3D vector size ${count}`);
  }
  const loaded: Coord3D[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferCoord3D(values[index] ?? { x: 0, y: 0, z: 0 }));
  }
  return loaded;
}

function xferSourceDockObjectIdVector(xfer: Xfer, values: readonly number[]): number[] {
  const count = xfer.xferInt(values.length);
  if (count < 0 || count > SOURCE_DOCK_VECTOR_LIMIT) {
    throw new Error(`Unsupported source DockUpdate ObjectID vector size ${count}`);
  }
  const loaded: number[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferObjectID(normalizeSourceObjectId(values[index] ?? 0)));
  }
  return loaded;
}

function xferSourceDockBoolVector(xfer: Xfer, values: readonly boolean[]): boolean[] {
  const count = xfer.xferInt(values.length);
  if (count < 0 || count > SOURCE_DOCK_VECTOR_LIMIT) {
    throw new Error(`Unsupported source DockUpdate Bool vector size ${count}`);
  }
  const loaded: boolean[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferBool(values[index] ?? false));
  }
  return loaded;
}

function xferSourceDockUpdateBlockState(
  xfer: Xfer,
  state: SourceDockUpdateBlockState,
): SourceDockUpdateBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source DockUpdate version ${version}`);
  }
  const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xfer, state.nextCallFrameAndPhase);
  const enterPosition = xfer.xferCoord3D(state.enterPosition);
  const dockPosition = xfer.xferCoord3D(state.dockPosition);
  const exitPosition = xfer.xferCoord3D(state.exitPosition);
  const numberApproachPositions = xfer.xferInt(state.numberApproachPositions);
  const positionsLoaded = xfer.xferBool(state.positionsLoaded);
  const approachPositions = xferSourceDockCoordVector(xfer, state.approachPositions);
  const approachPositionOwners = xferSourceDockObjectIdVector(xfer, state.approachPositionOwners);
  const approachPositionReached = xferSourceDockBoolVector(xfer, state.approachPositionReached);
  const activeDocker = xfer.xferObjectID(normalizeSourceObjectId(state.activeDocker));
  const dockerInside = xfer.xferBool(state.dockerInside);
  const dockCrippled = xfer.xferBool(state.dockCrippled);
  const dockOpen = xfer.xferBool(state.dockOpen);
  return {
    nextCallFrameAndPhase,
    enterPosition,
    dockPosition,
    exitPosition,
    numberApproachPositions,
    positionsLoaded,
    approachPositions,
    approachPositionOwners,
    approachPositionReached,
    activeDocker,
    dockerInside,
    dockCrippled,
    dockOpen,
  };
}

function tryParseSourceDockOnlyUpdateBlockData(data: Uint8Array): SourceDockUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-dock-only-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const parsed = xferSourceDockUpdateBlockState(xferLoad, createDefaultSourceDockUpdateBlockState());
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceSupplyWarehouseDockUpdateBlockData(
  data: Uint8Array,
): SourceSupplyWarehouseDockUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-supply-warehouse-dock-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const dock = xferSourceDockUpdateBlockState(xferLoad, createDefaultSourceDockUpdateBlockState());
    const boxesStored = xferLoad.xferInt(0);
    return xferLoad.getRemaining() === 0 ? { dock, boxesStored } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceRepairDockUpdateBlockData(data: Uint8Array): SourceRepairDockUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-repair-dock-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const dock = xferSourceDockUpdateBlockState(xferLoad, createDefaultSourceDockUpdateBlockState());
    const lastRepair = xferLoad.xferObjectID(0);
    const healthToAddPerFrame = xferLoad.xferReal(0);
    return xferLoad.getRemaining() === 0
      ? { dock, lastRepair, healthToAddPerFrame }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceRailedTransportAIUpdateBlockData(
  data: Uint8Array,
): SourceRailedTransportAIUpdateBlockState | null {
  if (data.byteLength < 10 || data[0] !== 1) {
    return null;
  }

  const blockData = new Uint8Array(data);
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  // RailedTransportAIUpdate xfers the large AIUpdateInterface base before this fixed tail.
  // Preserve those base bytes and only decode/rewrite the C++ railed transport suffix.
  for (let pathCount = SOURCE_RAILED_TRANSPORT_MAX_WAYPOINT_PATHS; pathCount >= 0; pathCount -= 1) {
    const tailOffset = blockData.byteLength - (10 + pathCount * 8);
    if (tailOffset < 2) {
      continue;
    }

    const inTransitByte = view.getUint8(tailOffset);
    const waypointDataLoadedByte = view.getUint8(blockData.byteLength - 1);
    if (
      (inTransitByte !== 0 && inTransitByte !== 1)
      || (waypointDataLoadedByte !== 0 && waypointDataLoadedByte !== 1)
      || view.getInt32(tailOffset + 1, true) !== pathCount
    ) {
      continue;
    }

    const paths: SourceRailedTransportAIUpdateBlockState['paths'] = [];
    let cursor = tailOffset + 5;
    for (let index = 0; index < pathCount; index += 1) {
      paths.push({
        startWaypointID: view.getUint32(cursor, true),
        endWaypointID: view.getUint32(cursor + 4, true),
      });
      cursor += 8;
    }

    return {
      blockData,
      tailOffset,
      inTransit: inTransitByte !== 0,
      paths,
      currentPath: view.getInt32(cursor, true),
      waypointDataLoaded: waypointDataLoadedByte !== 0,
    };
  }

  return null;
}

function sourceRailedTransportPathsForEntity(
  entity: MapEntity,
  preservedState: SourceRailedTransportAIUpdateBlockState,
): SourceRailedTransportAIUpdateBlockState['paths'] {
  const livePaths = entity.railedTransportState?.paths;
  const paths = Array.isArray(livePaths) ? livePaths : preservedState.paths;
  if (paths.length > SOURCE_RAILED_TRANSPORT_MAX_WAYPOINT_PATHS) {
    throw new Error(
      `RailedTransportAIUpdate path count ${paths.length} exceeds limit ${SOURCE_RAILED_TRANSPORT_MAX_WAYPOINT_PATHS}.`,
    );
  }
  return paths.map((path) => ({
    startWaypointID: Math.max(0, Math.trunc(path.startWaypointID)),
    endWaypointID: Math.max(0, Math.trunc(path.endWaypointID)),
  }));
}

function buildSourceRailedTransportAIUpdateBlockData(
  entity: MapEntity,
  preservedState: SourceRailedTransportAIUpdateBlockState,
): Uint8Array {
  const paths = sourceRailedTransportPathsForEntity(entity, preservedState);
  const tailLength = 10 + paths.length * 8;
  const blockData = new Uint8Array(preservedState.tailOffset + tailLength);
  blockData.set(preservedState.blockData.subarray(0, preservedState.tailOffset));
  const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);
  const state = entity.railedTransportState;
  let cursor = preservedState.tailOffset;
  view.setUint8(cursor, state?.inTransit === true ? 1 : 0);
  cursor += 1;
  view.setInt32(cursor, paths.length, true);
  cursor += 4;
  for (const path of paths) {
    view.setUint32(cursor, path.startWaypointID, true);
    view.setUint32(cursor + 4, path.endWaypointID, true);
    cursor += 8;
  }
  view.setInt32(
    cursor,
    Number.isFinite(state?.currentPath)
      ? Math.trunc(state?.currentPath ?? preservedState.currentPath)
      : preservedState.currentPath,
    true,
  );
  cursor += 4;
  view.setUint8(cursor, state?.waypointDataLoaded === true ? 1 : 0);
  return blockData;
}

function tryParseSourceRailedTransportDockUpdateBlockData(
  data: Uint8Array,
): SourceRailedTransportDockUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-railed-transport-dock-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const dock = xferSourceDockUpdateBlockState(xferLoad, createDefaultSourceDockUpdateBlockState());
    const dockingObjectId = xferLoad.xferObjectID(0);
    const pullInsideDistancePerFrame = xferLoad.xferReal(0);
    const unloadingObjectId = xferLoad.xferObjectID(0);
    const pushOutsideDistancePerFrame = xferLoad.xferReal(0);
    const unloadCount = xferLoad.xferInt(-1);
    return xferLoad.getRemaining() === 0
      ? {
        dock,
        dockingObjectId,
        pullInsideDistancePerFrame,
        unloadingObjectId,
        pushOutsideDistancePerFrame,
        unloadCount,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceDockStateForRuntimeFrame(
  preservedState: SourceDockUpdateBlockState,
  currentFrame: number,
  dockCrippled?: boolean,
): SourceDockUpdateBlockState {
  return {
    ...preservedState,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    dockCrippled: dockCrippled ?? preservedState.dockCrippled,
  };
}

function buildSourceDockOnlyUpdateBlockData(
  currentFrame: number,
  preservedState: SourceDockUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-dock-only-update');
  try {
    saver.xferVersion(1);
    xferSourceDockUpdateBlockState(
      saver,
      sourceDockStateForRuntimeFrame(preservedState, currentFrame),
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function findLiveSupplyWarehouseBoxes(
  coreState: GameLogicCoreSaveState | null | undefined,
  entityId: number,
  fallback: number,
): number {
  const liveState = coreState?.supplyWarehouseStates?.find((candidate) => candidate.entityId === entityId);
  return sourceFiniteInt(liveState?.state?.currentBoxes, fallback);
}

function createDefaultSourceSupplyWarehouseDockUpdateBlockState(
  entity: MapEntity,
): SourceSupplyWarehouseDockUpdateBlockState {
  return {
    dock: createDefaultSourceDockUpdateBlockState(entity.supplyWarehouseProfile?.numberApproachPositions),
    boxesStored: sourceNonNegativeInt(entity.supplyWarehouseProfile?.startingBoxes, 1),
  };
}

function buildSourceSupplyWarehouseDockUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceSupplyWarehouseDockUpdateBlockState,
  coreState?: GameLogicCoreSaveState | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-supply-warehouse-dock-update');
  try {
    saver.xferVersion(1);
    xferSourceDockUpdateBlockState(
      saver,
      sourceDockStateForRuntimeFrame(
        preservedState.dock,
        currentFrame,
        entity.swCripplingDockDisabled === true ? true : preservedState.dock.dockCrippled,
      ),
    );
    saver.xferInt(findLiveSupplyWarehouseBoxes(coreState, entity.id, preservedState.boxesStored));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRepairDockUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceRepairDockUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-repair-dock-update');
  try {
    const lastRepair = sourceNonNegativeInt(entity.repairDockLastRepairEntityId, preservedState.lastRepair);
    saver.xferVersion(1);
    xferSourceDockUpdateBlockState(
      saver,
      sourceDockStateForRuntimeFrame(preservedState.dock, currentFrame),
    );
    saver.xferObjectID(normalizeSourceObjectId(lastRepair));
    saver.xferReal(lastRepair > 0
      ? (typeof entity.repairDockHealthToAddPerFrame === 'number'
        && Number.isFinite(entity.repairDockHealthToAddPerFrame)
          ? Math.max(0, entity.repairDockHealthToAddPerFrame)
          : preservedState.healthToAddPerFrame)
      : 0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceRepairDockUpdateBlockState(entity: MapEntity): SourceRepairDockUpdateBlockState {
  return {
    dock: createDefaultSourceDockUpdateBlockState(entity.repairDockProfile?.numberApproachPositions),
    lastRepair: 0,
    healthToAddPerFrame: 0,
  };
}

function buildSourceRailedTransportDockUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceRailedTransportDockUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-railed-transport-dock-update');
  try {
    const liveState = entity.railedTransportState?.dockState;
    saver.xferVersion(1);
    xferSourceDockUpdateBlockState(
      saver,
      sourceDockStateForRuntimeFrame(preservedState.dock, currentFrame),
    );
    saver.xferObjectID(normalizeSourceObjectId(liveState?.dockingObjectId ?? preservedState.dockingObjectId));
    saver.xferReal(sourcePhysicsFinite(
      liveState?.pullInsideDistancePerFrame,
      preservedState.pullInsideDistancePerFrame,
    ));
    saver.xferObjectID(normalizeSourceObjectId(liveState?.unloadingObjectId ?? preservedState.unloadingObjectId));
    saver.xferReal(sourcePhysicsFinite(
      liveState?.pushOutsideDistancePerFrame,
      preservedState.pushOutsideDistancePerFrame,
    ));
    saver.xferInt(sourceFiniteInt(liveState?.unloadCount, preservedState.unloadCount));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceRailedTransportDockUpdateBlockState(): SourceRailedTransportDockUpdateBlockState {
  return {
    dock: createDefaultSourceDockUpdateBlockState(),
    dockingObjectId: 0,
    pullInsideDistancePerFrame: 0,
    unloadingObjectId: 0,
    pushOutsideDistancePerFrame: 0,
    unloadCount: -1,
  };
}

function tryParseSourceSupplyWarehouseCripplingBehaviorBlockData(
  data: Uint8Array,
): SourceSupplyWarehouseCripplingBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-supply-warehouse-crippling-behavior');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xferLoad, 0);
    const healingSuppressedUntilFrame = xferLoad.xferUnsignedInt(0);
    const nextHealingFrame = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        nextCallFrameAndPhase,
        healingSuppressedUntilFrame,
        nextHealingFrame,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function sourceSupplyWarehouseCripplingWakeFrame(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceSupplyWarehouseCripplingBehaviorBlockState,
): number {
  if (Number.isFinite(entity.health)
    && Number.isFinite(entity.maxHealth)
    && entity.maxHealth > 0
    && entity.health >= entity.maxHealth) {
    return SOURCE_FRAME_FOREVER;
  }
  const healingSuppressedUntilFrame = sourceFlammableUnsignedFrame(
    entity.swCripplingHealSuppressedUntilFrame,
    preservedState.healingSuppressedUntilFrame,
  );
  if (healingSuppressedUntilFrame > currentFrame) {
    return healingSuppressedUntilFrame;
  }
  const nextHealingFrame = sourceFlammableUnsignedFrame(
    entity.swCripplingNextHealFrame,
    preservedState.nextHealingFrame,
  );
  return nextHealingFrame > currentFrame ? nextHealingFrame : currentFrame + 1;
}

function buildSourceSupplyWarehouseCripplingBehaviorBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceSupplyWarehouseCripplingBehaviorBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-supply-warehouse-crippling-behavior');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(
      saver,
      buildSourceUpdateModuleWakeFrame(
        sourceSupplyWarehouseCripplingWakeFrame(entity, currentFrame, preservedState),
      ),
    );
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.swCripplingHealSuppressedUntilFrame,
      preservedState.healingSuppressedUntilFrame,
    ));
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(
      entity.swCripplingNextHealFrame,
      preservedState.nextHealingFrame,
    ));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceSupplyWarehouseCripplingBehaviorBlockState():
  SourceSupplyWarehouseCripplingBehaviorBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    healingSuppressedUntilFrame: 0,
    nextHealingFrame: 0,
  };
}

function xferSourceIntListByUnsignedShortCount(xfer: Xfer, values: readonly number[]): number[] {
  const count = xfer.xferUnsignedShort(values.length);
  const loaded: number[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferInt(sourceFiniteInt(values[index], 0)));
  }
  return loaded;
}

function xferSourceObjectIdListByUnsignedShortCount(xfer: Xfer, values: readonly number[]): number[] {
  const count = xfer.xferUnsignedShort(values.length);
  const loaded: number[] = [];
  for (let index = 0; index < count; index += 1) {
    loaded.push(xfer.xferObjectID(normalizeSourceObjectId(values[index] ?? 0)));
  }
  return loaded;
}

function xferSourceSpawnBehaviorBlockState(
  xfer: Xfer,
  state: SourceSpawnBehaviorBlockState,
): SourceSpawnBehaviorBlockState {
  const version = xfer.xferVersion(state.version);
  if (version < 1 || version > 2) {
    throw new Error(`Unsupported source SpawnBehavior version ${version}`);
  }
  xferSourceBehaviorModuleBase(xfer);
  const initialBurstTimesInited = version >= 2
    ? xfer.xferBool(state.initialBurstTimesInited)
    : false;
  const spawnTemplateName = xfer.xferAsciiString(state.spawnTemplateName);
  const oneShotCountdown = xfer.xferInt(state.oneShotCountdown);
  const framesToWait = xfer.xferInt(state.framesToWait);
  const firstBatchCount = xfer.xferInt(state.firstBatchCount);
  xfer.xferVersion(1);
  const replacementTimes = xferSourceIntListByUnsignedShortCount(xfer, state.replacementTimes);
  xfer.xferVersion(1);
  const spawnIds = xferSourceObjectIdListByUnsignedShortCount(xfer, state.spawnIds);
  const active = xfer.xferBool(state.active);
  const aggregateHealth = xfer.xferBool(state.aggregateHealth);
  const spawnCount = xfer.xferInt(state.spawnCount);
  const selfTaskingSpawnCount = xfer.xferUnsignedInt(state.selfTaskingSpawnCount);
  return {
    version,
    initialBurstTimesInited,
    spawnTemplateName,
    oneShotCountdown,
    framesToWait,
    firstBatchCount,
    replacementTimes,
    spawnIds,
    active,
    aggregateHealth,
    spawnCount,
    selfTaskingSpawnCount,
  };
}

function createDefaultSourceSpawnBehaviorBlockState(): SourceSpawnBehaviorBlockState {
  return {
    version: 2,
    initialBurstTimesInited: false,
    spawnTemplateName: '',
    oneShotCountdown: -1,
    framesToWait: 0,
    firstBatchCount: 0,
    replacementTimes: [],
    spawnIds: [],
    active: true,
    aggregateHealth: false,
    spawnCount: -1,
    selfTaskingSpawnCount: 0,
  };
}

function tryParseSourceSpawnBehaviorBlockData(data: Uint8Array): SourceSpawnBehaviorBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-spawn-behavior');
  try {
    const parsed = xferSourceSpawnBehaviorBlockState(xferLoad, createDefaultSourceSpawnBehaviorBlockState());
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpawnBehaviorBlockData(
  entity: MapEntity,
  preservedState: SourceSpawnBehaviorBlockState,
): Uint8Array | null {
  const state = entity.spawnBehaviorState;
  if (!state) {
    return null;
  }
  const profile = state.profile;
  const templateNames = Array.isArray(profile.spawnTemplateNames) ? profile.spawnTemplateNames : [];
  const templateIndex = sourceNonNegativeInt(state.templateNameIndex, 0);
  const spawnTemplateName = templateNames[templateIndex] ?? templateNames[0] ?? preservedState.spawnTemplateName;
  const slaveIds = Array.isArray(state.slaveIds) ? state.slaveIds.map(normalizeSourceObjectId) : preservedState.spawnIds;
  const replacementTimes = Array.isArray(state.replacementFrames)
    ? state.replacementFrames.map((frame) => sourceFiniteInt(frame, 0))
    : preservedState.replacementTimes;
  const oneShotRemaining = sourceFiniteInt(state.oneShotRemaining, preservedState.oneShotCountdown);
  const oneShotCompleted = state.oneShotCompleted === true;
  const initialBurstApplied = state.initialBurstApplied === true;
  const spawnCount = slaveIds.length > 0 || initialBurstApplied
    ? slaveIds.length
    : preservedState.spawnCount;

  const saver = new XferSave();
  saver.open('build-source-spawn-behavior');
  try {
    xferSourceSpawnBehaviorBlockState(saver, {
      ...preservedState,
      version: Math.max(1, Math.min(2, Math.trunc(preservedState.version || 2))),
      initialBurstTimesInited: initialBurstApplied,
      spawnTemplateName,
      oneShotCountdown: oneShotRemaining,
      replacementTimes,
      spawnIds: slaveIds,
      active: profile.oneShot ? !oneShotCompleted : preservedState.active,
      aggregateHealth: profile.aggregateHealth === true,
      spawnCount,
    });
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildDefaultSourceSpawnBehaviorBlockData(): Uint8Array {
  const saver = new XferSave();
  saver.open('build-default-source-spawn-behavior');
  try {
    xferSourceSpawnBehaviorBlockState(saver, createDefaultSourceSpawnBehaviorBlockState());
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function findLiveSourceFireWeaponUpdateProfileIndex(
  entity: MapEntity,
  moduleTag: string,
  preservedState: SourceFireWeaponUpdateBlockState,
): number {
  const profiles = entity.fireWeaponUpdateProfiles ?? [];
  if (profiles.length === 0) {
    return -1;
  }
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const tagMatch = profiles.findIndex(
    (profile) => normalizeSourceObjectModuleTag(profile.moduleTag) === normalizedModuleTag,
  );
  if (tagMatch >= 0) {
    return tagMatch;
  }

  const normalizedWeaponName = preservedState.weapon.templateName.trim().toUpperCase();
  const weaponMatches = profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => profile.weaponName.trim().toUpperCase() === normalizedWeaponName);
  if (weaponMatches.length === 1) {
    return weaponMatches[0]!.index;
  }
  return profiles.length === 1 ? 0 : -1;
}

function buildSourceFireWeaponUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  moduleTag: string,
  preservedState: SourceFireWeaponUpdateBlockState,
): Uint8Array | null {
  const profileIndex = findLiveSourceFireWeaponUpdateProfileIndex(entity, moduleTag, preservedState);
  if (profileIndex < 0) {
    return null;
  }
  const profile = entity.fireWeaponUpdateProfiles[profileIndex]!;
  const liveNextFireFrame = sourceFlammableUnsignedFrame(
    entity.fireWeaponUpdateNextFireFrames?.[profileIndex],
    preservedState.weapon.whenWeCanFireAgain,
  );
  const saver = new XferSave();
  saver.open('build-source-fire-weapon-update');
  try {
    saver.xferVersion(2);
    xferSourceUpdateModuleBase(saver, buildSourceUpdateModuleWakeFrame(currentFrame + 1));
    xferSourceWeaponSnapshot(saver, {
      ...preservedState.weapon,
      version: 3,
      templateName: profile.weaponName || preservedState.weapon.templateName,
      status: liveNextFireFrame > currentFrame
        ? SOURCE_WEAPON_STATUS_BETWEEN_FIRING_SHOTS
        : SOURCE_WEAPON_STATUS_READY_TO_FIRE,
      whenWeCanFireAgain: liveNextFireFrame,
    });
    saver.xferUnsignedInt(liveNextFireFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function findGeneratedSourceFireWeaponUpdateProfileIndex(entity: MapEntity, moduleTag: string): number {
  const profiles = entity.fireWeaponUpdateProfiles ?? [];
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const tagMatch = profiles.findIndex(
    (profile) => normalizeSourceObjectModuleTag(profile.moduleTag) === normalizedModuleTag,
  );
  if (tagMatch >= 0) {
    return tagMatch;
  }
  return profiles.length === 1 ? 0 : -1;
}

function buildGeneratedSourceFireWeaponUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  moduleTag: string,
): Uint8Array | null {
  const profileIndex = findGeneratedSourceFireWeaponUpdateProfileIndex(entity, moduleTag);
  if (profileIndex < 0) {
    return null;
  }
  const profile = entity.fireWeaponUpdateProfiles[profileIndex]!;
  const sourceWeaponProfile = requireSourceWeaponSaveProfile(
    profile.sourceWeaponProfile,
    'FireWeaponUpdate',
    moduleTag,
    profile.weaponName,
  );
  const initialDelayFrame = sourceFlammableUnsignedFrame(
    entity.fireWeaponUpdateNextFireFrames?.[profileIndex],
    currentFrame + sourceNonNegativeInt(profile.initialDelayFrames, 0),
  );
  const weapon = buildSourceWeaponLoadedSnapshot(
    sourceWeaponProfile,
    currentFrame,
    initialDelayFrame > currentFrame ? initialDelayFrame : currentFrame,
  );

  const saver = new XferSave();
  saver.open('build-generated-source-fire-weapon-update');
  try {
    saver.xferVersion(2);
    xferSourceUpdateModuleBase(saver, buildSourceUpdateModuleWakeFrame(currentFrame + 1));
    xferSourceWeaponSnapshot(saver, weapon);
    saver.xferUnsignedInt(initialDelayFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function findGeneratedSourceFireWeaponCollideProfileIndex(entity: MapEntity, moduleTag: string): number {
  const profiles = entity.fireWeaponCollideProfiles ?? [];
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const tagMatch = profiles.findIndex(
    (profile) => normalizeSourceObjectModuleTag(profile.moduleTag) === normalizedModuleTag,
  );
  if (tagMatch >= 0) {
    return tagMatch;
  }
  return profiles.length === 1 ? 0 : -1;
}

function buildGeneratedSourceFireWeaponCollideBlockData(
  entity: MapEntity,
  currentFrame: number,
  moduleTag: string,
): Uint8Array | null {
  const profileIndex = findGeneratedSourceFireWeaponCollideProfileIndex(entity, moduleTag);
  if (profileIndex < 0) {
    return null;
  }
  if (entity.fireWeaponCollideEverFired?.[profileIndex] === true) {
    throw new Error(
      `Cannot synthesize source FireWeaponCollide "${moduleTag}" after it fired without preserved Weapon::xfer state.`,
    );
  }
  const profile = entity.fireWeaponCollideProfiles[profileIndex]!;
  const sourceWeaponProfile = requireSourceWeaponSaveProfile(
    profile.sourceWeaponProfile,
    'FireWeaponCollide',
    moduleTag,
    profile.collideWeapon,
  );

  const saver = new XferSave();
  saver.open('build-generated-source-fire-weapon-collide');
  try {
    saver.xferVersion(1);
    xferSourceCollideModuleBase(saver);
    saver.xferBool(true);
    xferSourceWeaponSnapshot(saver, buildSourceWeaponConstructorSnapshot(sourceWeaponProfile, currentFrame));
    saver.xferBool(false);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function findLiveSourceFireWhenDamagedProfileIndex(
  entity: MapEntity,
  moduleTag: string,
): number {
  const profiles = entity.fireWhenDamagedProfiles ?? [];
  if (profiles.length === 0) {
    return -1;
  }
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const tagMatch = profiles.findIndex(
    (profile) => normalizeSourceObjectModuleTag(profile.moduleTag) === normalizedModuleTag,
  );
  if (tagMatch >= 0) {
    return tagMatch;
  }
  return profiles.length === 1 ? 0 : -1;
}

function buildSourceFireWhenDamagedWeaponState(
  preservedWeapon: SourceFireWhenDamagedWeaponBlockState,
  weaponName: string | null,
  nextFireFrame: number | undefined,
  currentFrame: number,
): SourceFireWhenDamagedWeaponBlockState {
  if (!preservedWeapon.weaponPresent) {
    return preservedWeapon;
  }
  const liveNextFireFrame = sourceFlammableUnsignedFrame(nextFireFrame, preservedWeapon.weapon.whenWeCanFireAgain);
  return {
    weaponPresent: true,
    weapon: {
      ...preservedWeapon.weapon,
      version: 3,
      templateName: weaponName || preservedWeapon.weapon.templateName,
      status: liveNextFireFrame > currentFrame
        ? SOURCE_WEAPON_STATUS_BETWEEN_FIRING_SHOTS
        : SOURCE_WEAPON_STATUS_READY_TO_FIRE,
      whenWeCanFireAgain: liveNextFireFrame,
    },
  };
}

function buildGeneratedSourceFireWhenDamagedWeaponState(
  sourceWeaponProfile: unknown,
  moduleTag: string,
  weaponName: string | null | undefined,
  nextFireFrame: number | undefined,
  currentFrame: number,
): SourceFireWhenDamagedWeaponBlockState {
  if (!weaponName) {
    return createSourceFireWhenDamagedWeaponState(false);
  }
  const profile = requireSourceWeaponSaveProfile(
    sourceWeaponProfile,
    'FireWeaponWhenDamagedBehavior',
    moduleTag,
    weaponName,
  );
  const resolvedNextFireFrame = sourceFlammableUnsignedFrame(
    nextFireFrame && nextFireFrame > 0 ? nextFireFrame : undefined,
    currentFrame + profile.clipReloadFrames,
  );
  return createSourceFireWhenDamagedWeaponState(
    true,
    buildSourceWeaponLoadedSnapshot(profile, currentFrame, resolvedNextFireFrame),
  );
}

function buildGeneratedSourceFireWhenDamagedBlockData(
  entity: MapEntity,
  currentFrame: number,
  moduleTag: string,
): Uint8Array | null {
  const profileIndex = findLiveSourceFireWhenDamagedProfileIndex(entity, moduleTag);
  if (profileIndex < 0) {
    return null;
  }
  const profile = entity.fireWhenDamagedProfiles[profileIndex]!;
  const reactionWeaponProfiles = profile.reactionWeaponProfiles ?? [null, null, null, null];
  const continuousWeaponProfiles = profile.continuousWeaponProfiles ?? [null, null, null, null];
  const reactionWeapons = profile.reactionWeapons.map((weaponName, index) => buildGeneratedSourceFireWhenDamagedWeaponState(
    reactionWeaponProfiles[index],
    moduleTag,
    weaponName,
    profile.reactionNextFireFrame[index],
    currentFrame,
  )) as SourceFireWhenDamagedBlockState['reactionWeapons'];
  const continuousWeapons = profile.continuousWeapons.map((weaponName, index) => buildGeneratedSourceFireWhenDamagedWeaponState(
    continuousWeaponProfiles[index],
    moduleTag,
    weaponName,
    profile.continuousNextFireFrame[index],
    currentFrame,
  )) as SourceFireWhenDamagedBlockState['continuousWeapons'];
  const upgradeExecuted = profile.upgradeExecuted === true;
  const hasContinuousWeapon = continuousWeapons.some((weaponState) => weaponState.weaponPresent);
  const nextCallFrameAndPhase = upgradeExecuted && hasContinuousWeapon
    ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
    : buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER);

  const saver = new XferSave();
  saver.open('build-generated-source-fire-weapon-when-damaged');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(saver, nextCallFrameAndPhase);
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    for (const weaponState of reactionWeapons) {
      xferSourceFireWhenDamagedWeapon(saver, weaponState);
    }
    for (const weaponState of continuousWeapons) {
      xferSourceFireWhenDamagedWeapon(saver, weaponState);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFireWhenDamagedBlockData(
  entity: MapEntity,
  currentFrame: number,
  moduleTag: string,
  preservedState: SourceFireWhenDamagedBlockState,
): Uint8Array | null {
  const profileIndex = findLiveSourceFireWhenDamagedProfileIndex(entity, moduleTag);
  if (profileIndex < 0) {
    return null;
  }
  const profile = entity.fireWhenDamagedProfiles[profileIndex]!;
  const upgradeExecuted = typeof profile.upgradeExecuted === 'boolean'
    ? profile.upgradeExecuted
    : preservedState.upgradeExecuted;
  const hasContinuousWeapon = profile.continuousWeapons.some((weaponName) => Boolean(weaponName));
  const nextCallFrameAndPhase = !upgradeExecuted
    ? buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER)
    : (hasContinuousWeapon ? buildSourceUpdateModuleWakeFrame(currentFrame + 1) : preservedState.nextCallFrameAndPhase);
  const reactionWeapons = preservedState.reactionWeapons.map((weaponState, index) => buildSourceFireWhenDamagedWeaponState(
    weaponState,
    profile.reactionWeapons[index] ?? null,
    profile.reactionNextFireFrame[index],
    currentFrame,
  )) as SourceFireWhenDamagedBlockState['reactionWeapons'];
  const continuousWeapons = preservedState.continuousWeapons.map((weaponState, index) => buildSourceFireWhenDamagedWeaponState(
    weaponState,
    profile.continuousWeapons[index] ?? null,
    profile.continuousNextFireFrame[index],
    currentFrame,
  )) as SourceFireWhenDamagedBlockState['continuousWeapons'];

  const saver = new XferSave();
  saver.open('build-source-fire-weapon-when-damaged');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(saver, nextCallFrameAndPhase);
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    for (const weaponState of reactionWeapons) {
      xferSourceFireWhenDamagedWeapon(saver, weaponState);
    }
    for (const weaponState of continuousWeapons) {
      xferSourceFireWhenDamagedWeapon(saver, weaponState);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceAnimationSteeringUpdateBlockData(currentFrame: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-animation-steering-update');
  try {
    saver.xferVersion(1);
    xferSourceUpdateModuleBase(saver, buildSourceUpdateModuleWakeFrame(currentFrame + 1));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceBodyModuleBaseBlockState {
  damageScalar: number;
}

interface SourceDamageInfoInputBlockState {
  sourceId: number;
  sourcePlayerMaskBytes: Uint8Array;
  damageType: number;
  damageFxOverride: number;
  deathType: number;
  amount: number;
  kill: boolean;
  damageStatusType: number;
  shockWaveVector: Coord3D;
  shockWaveAmount: number;
  shockWaveRadius: number;
  shockWaveTaperOff: number;
  sourceTemplateName: string;
}

interface SourceDamageInfoOutputBlockState {
  actualDamageDealt: number;
  actualDamageClipped: number;
  noEffect: boolean;
}

interface SourceDamageInfoBlockState {
  input: SourceDamageInfoInputBlockState;
  output: SourceDamageInfoOutputBlockState;
}

interface SourceActiveBodyBlockState extends SourceBodyModuleBaseBlockState {
  currentHealth: number;
  currentSubdualDamage: number;
  prevHealth: number;
  maxHealth: number;
  initialHealth: number;
  curDamageState: number;
  nextDamageFXTime: number;
  lastDamageFXDone: number;
  lastDamageInfo: SourceDamageInfoBlockState;
  lastDamageTimestamp: number;
  lastHealingTimestamp: number;
  frontCrushed: boolean;
  backCrushed: boolean;
  lastDamageCleared: boolean;
  indestructible: boolean;
  particleSystemIds: number[];
  armorSetFlags: string[];
}

type SourceBodyModuleKind = 'active' | 'structure' | 'hiveStructure' | 'undead' | 'inactive';

interface SourceBodyModuleBlockState {
  kind: SourceBodyModuleKind;
  base?: SourceBodyModuleBaseBlockState;
  active?: SourceActiveBodyBlockState;
  constructorObjectId?: number;
  isSecondLife?: boolean;
}

function normalizeSourceBodyModuleKind(moduleType: string): SourceBodyModuleKind | null {
  switch (moduleType.trim().toUpperCase()) {
    case 'ACTIVEBODY':
    case 'IMMORTALBODY':
    case 'HIGHLANDERBODY':
      return 'active';
    case 'STRUCTUREBODY':
      return 'structure';
    case 'HIVESTRUCTUREBODY':
      return 'hiveStructure';
    case 'UNDEADBODY':
      return 'undead';
    case 'INACTIVEBODY':
      return 'inactive';
    default:
      return null;
  }
}

function sourceBodyUnsignedFrame(value: unknown, fallback: number): number {
  return sourceFlammableUnsignedFrame(value, fallback);
}

function sourceBodyDamageScalar(entity: MapEntity, fallback: number): number {
  return sourcePhysicsFinite(entity.battlePlanDamageScalar, fallback);
}

function sourceBodyBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sourceBodyArmorSetFlags(entity: MapEntity, preservedFlags: string[]): string[] {
  const mask = sourcePhysicsFinite(entity.armorSetFlagsMask, NaN);
  if (!Number.isFinite(mask)) {
    return preservedFlags;
  }
  const normalizedMask = Math.trunc(mask);
  return Array.from(ARMOR_SET_FLAG_MASK_BY_NAME.entries())
    .filter(([, bit]) => (normalizedMask & bit) !== 0)
    .map(([name]) => name);
}

function xferSourceBodyModuleBase(
  xfer: Xfer,
  state: SourceBodyModuleBaseBlockState,
): SourceBodyModuleBaseBlockState {
  const bodyVersion = xfer.xferVersion(1);
  const behaviorVersion = xfer.xferVersion(1);
  const objectModuleVersion = xfer.xferVersion(1);
  const moduleVersion = xfer.xferVersion(1);
  if (bodyVersion !== 1 || behaviorVersion !== 1 || objectModuleVersion !== 1 || moduleVersion !== 1) {
    throw new Error('Unsupported source BodyModule base version');
  }
  return {
    damageScalar: xfer.xferReal(state.damageScalar),
  };
}

function xferSourceDamageInfoInput(
  xfer: Xfer,
  state: SourceDamageInfoInputBlockState,
): SourceDamageInfoInputBlockState {
  const version = xfer.xferVersion(3);
  const sourceId = xfer.xferObjectID(normalizeSourceObjectId(state.sourceId));
  const sourcePlayerMaskBytes = xfer.xferUser(
    state.sourcePlayerMaskBytes.byteLength === SOURCE_PLAYER_MASK_BYTE_LENGTH
      ? state.sourcePlayerMaskBytes
      : new Uint8Array(SOURCE_PLAYER_MASK_BYTE_LENGTH),
  );
  const damageType = parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.damageType)));
  const damageFxOverride = version >= 2
    ? parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.damageFxOverride)))
    : SOURCE_DAMAGE_TYPE_UNRESISTABLE;
  const deathType = parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.deathType)));
  const amount = xfer.xferReal(state.amount);
  const kill = xfer.xferBool(state.kill);
  const damageStatusType = parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.damageStatusType)));
  const shockWaveVector = xfer.xferCoord3D(state.shockWaveVector);
  const shockWaveAmount = xfer.xferReal(state.shockWaveAmount);
  const shockWaveRadius = xfer.xferReal(state.shockWaveRadius);
  const shockWaveTaperOff = xfer.xferReal(state.shockWaveTaperOff);
  const sourceTemplateName = version >= 3 ? xfer.xferAsciiString(state.sourceTemplateName) : '';
  return {
    sourceId,
    sourcePlayerMaskBytes,
    damageType,
    damageFxOverride,
    deathType,
    amount,
    kill,
    damageStatusType,
    shockWaveVector,
    shockWaveAmount,
    shockWaveRadius,
    shockWaveTaperOff,
    sourceTemplateName,
  };
}

function xferSourceDamageInfoOutput(
  xfer: Xfer,
  state: SourceDamageInfoOutputBlockState,
): SourceDamageInfoOutputBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source DamageInfoOutput version ${version}`);
  }
  return {
    actualDamageDealt: xfer.xferReal(state.actualDamageDealt),
    actualDamageClipped: xfer.xferReal(state.actualDamageClipped),
    noEffect: xfer.xferBool(state.noEffect),
  };
}

function xferSourceDamageInfo(
  xfer: Xfer,
  state: SourceDamageInfoBlockState,
): SourceDamageInfoBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source DamageInfo version ${version}`);
  }
  return {
    input: xferSourceDamageInfoInput(xfer, state.input),
    output: xferSourceDamageInfoOutput(xfer, state.output),
  };
}

function xferSourceActiveBody(
  xfer: Xfer,
  state: SourceActiveBodyBlockState,
): SourceActiveBodyBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source ActiveBody version ${version}`);
  }
  const base = xferSourceBodyModuleBase(xfer, state);
  const currentHealth = xfer.xferReal(state.currentHealth);
  const currentSubdualDamage = xfer.xferReal(state.currentSubdualDamage);
  const prevHealth = xfer.xferReal(state.prevHealth);
  const maxHealth = xfer.xferReal(state.maxHealth);
  const initialHealth = xfer.xferReal(state.initialHealth);
  const curDamageState = parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.curDamageState)));
  const nextDamageFXTime = xfer.xferUnsignedInt(state.nextDamageFXTime);
  const lastDamageFXDone = parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(state.lastDamageFXDone)));
  const lastDamageInfo = xferSourceDamageInfo(xfer, state.lastDamageInfo);
  const lastDamageTimestamp = xfer.xferUnsignedInt(state.lastDamageTimestamp);
  const lastHealingTimestamp = xfer.xferUnsignedInt(state.lastHealingTimestamp);
  const frontCrushed = xfer.xferBool(state.frontCrushed);
  const backCrushed = xfer.xferBool(state.backCrushed);
  const lastDamageCleared = xfer.xferBool(state.lastDamageCleared);
  const indestructible = xfer.xferBool(state.indestructible);
  const particleSystemCount = xfer.xferUnsignedShort(state.particleSystemIds.length);
  const particleSystemIds: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < particleSystemCount; index += 1) {
      particleSystemIds.push(parseSourceRawInt32Bytes(xfer.xferUser(new Uint8Array(4))));
    }
  } else {
    for (const particleSystemId of state.particleSystemIds) {
      particleSystemIds.push(particleSystemId);
      xfer.xferUser(buildSourceRawInt32Bytes(particleSystemId));
    }
  }
  const armorSetFlags = xferSourceStringBitFlags(xfer, state.armorSetFlags);
  return {
    ...base,
    currentHealth,
    currentSubdualDamage,
    prevHealth,
    maxHealth,
    initialHealth,
    curDamageState,
    nextDamageFXTime,
    lastDamageFXDone,
    lastDamageInfo,
    lastDamageTimestamp,
    lastHealingTimestamp,
    frontCrushed,
    backCrushed,
    lastDamageCleared,
    indestructible,
    particleSystemIds,
    armorSetFlags,
  };
}

function overlaySourceDamageInfoFromLiveEntity(
  entity: MapEntity,
  preservedState: SourceDamageInfoBlockState,
): SourceDamageInfoBlockState {
  const hasLiveDamageSnapshot =
    sourcePhysicsFinite(entity.lastDamageInfoFrame, 0) > 0
    || sourcePhysicsFinite(entity.lastDamageFrame, 0) > 0;
  if (!hasLiveDamageSnapshot) {
    return preservedState;
  }
  const liveSourceId = entity.scriptLastDamageSourceEntityId === null
    ? 0
    : normalizeSourceObjectId(entity.scriptLastDamageSourceEntityId);
  const liveSourceTemplateName = typeof entity.scriptLastDamageSourceTemplateName === 'string'
    ? entity.scriptLastDamageSourceTemplateName.trim()
    : '';
  return {
    input: {
      ...preservedState.input,
      sourceId: liveSourceId,
      sourceTemplateName: liveSourceTemplateName,
    },
    output: {
      ...preservedState.output,
      noEffect: sourceBodyBool(entity.lastDamageNoEffect, preservedState.output.noEffect),
    },
  };
}

function buildSourceActiveBodyState(
  entity: MapEntity,
  preservedState: SourceActiveBodyBlockState,
): SourceActiveBodyBlockState {
  const currentHealth = sourcePhysicsFinite(entity.health, preservedState.currentHealth);
  const maxHealth = sourcePhysicsFinite(entity.maxHealth, preservedState.maxHealth);
  const initialHealth = sourcePhysicsFinite(entity.initialHealth, preservedState.initialHealth);
  const lastDamageFrame = sourcePhysicsFinite(entity.lastDamageFrame, 0);
  const lastDamageInfoFrame = sourcePhysicsFinite(entity.lastDamageInfoFrame, 0);
  const liveLastDamageTimestamp = lastDamageFrame > 0 ? lastDamageFrame : lastDamageInfoFrame;
  return {
    ...preservedState,
    damageScalar: sourceBodyDamageScalar(entity, preservedState.damageScalar),
    currentHealth,
    currentSubdualDamage: sourcePhysicsFinite(entity.currentSubdualDamage, preservedState.currentSubdualDamage),
    prevHealth: currentHealth,
    maxHealth,
    initialHealth,
    curDamageState: calcBodyDamageState(currentHealth, maxHealth),
    lastDamageInfo: overlaySourceDamageInfoFromLiveEntity(entity, preservedState.lastDamageInfo),
    lastDamageTimestamp: liveLastDamageTimestamp > 0
      ? sourceBodyUnsignedFrame(liveLastDamageTimestamp, preservedState.lastDamageTimestamp)
      : preservedState.lastDamageTimestamp,
    frontCrushed: sourceBodyBool(entity.frontCrushed, preservedState.frontCrushed),
    backCrushed: sourceBodyBool(entity.backCrushed, preservedState.backCrushed),
    indestructible: sourceBodyBool(entity.isIndestructible, preservedState.indestructible),
    armorSetFlags: sourceBodyArmorSetFlags(entity, preservedState.armorSetFlags),
  };
}

function tryParseSourceBodyModuleBlockData(
  data: Uint8Array,
  moduleType: string,
): SourceBodyModuleBlockState | null {
  const kind = normalizeSourceBodyModuleKind(moduleType);
  if (!kind) {
    return null;
  }
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-body-module');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    let parsed: SourceBodyModuleBlockState;
    if (kind === 'inactive') {
      parsed = {
        kind,
        base: xferSourceBodyModuleBase(xferLoad, { damageScalar: 1 }),
      };
    } else if (kind === 'hiveStructure') {
      const structureVersion = xferLoad.xferVersion(1);
      if (structureVersion !== 1) {
        return null;
      }
      parsed = {
        kind,
        active: xferSourceActiveBody(xferLoad, createDefaultSourceActiveBodyState()),
        constructorObjectId: xferLoad.xferObjectID(0),
      };
    } else {
      parsed = {
        kind,
        active: xferSourceActiveBody(xferLoad, createDefaultSourceActiveBodyState()),
      };
      if (kind === 'structure') {
        parsed.constructorObjectId = xferLoad.xferObjectID(0);
      } else if (kind === 'undead') {
        parsed.isSecondLife = xferLoad.xferBool(false);
      }
    }
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceBodyModuleBlockData(
  entity: MapEntity,
  moduleType: string,
  preservedState: SourceBodyModuleBlockState,
): Uint8Array {
  const kind = normalizeSourceBodyModuleKind(moduleType);
  if (!kind || kind !== preservedState.kind) {
    return new Uint8Array();
  }
  const saver = new XferSave();
  saver.open('build-source-body-module');
  try {
    saver.xferVersion(1);
    if (kind === 'inactive') {
      xferSourceBodyModuleBase(saver, {
        damageScalar: sourceBodyDamageScalar(entity, preservedState.base?.damageScalar ?? 1),
      });
    } else {
      const active = buildSourceActiveBodyState(
        entity,
        preservedState.active ?? createDefaultSourceActiveBodyState(),
      );
      if (kind === 'hiveStructure') {
        saver.xferVersion(1);
      }
      xferSourceActiveBody(saver, active);
      if (kind === 'structure' || kind === 'hiveStructure') {
        saver.xferObjectID(normalizeSourceObjectId(
          sourcePhysicsFinite(entity.builderId, preservedState.constructorObjectId ?? 0),
        ));
      } else if (kind === 'undead') {
        saver.xferBool(sourceBodyBool(entity.undeadIsSecondLife, preservedState.isSecondLife ?? false));
      }
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceDamageInfoState(): SourceDamageInfoBlockState {
  return {
    input: {
      sourceId: 0,
      sourcePlayerMaskBytes: new Uint8Array(SOURCE_PLAYER_MASK_BYTE_LENGTH),
      damageType: 0,
      damageFxOverride: SOURCE_DAMAGE_TYPE_UNRESISTABLE,
      deathType: 0,
      amount: 0,
      kill: false,
      damageStatusType: 0,
      shockWaveVector: { x: 0, y: 0, z: 0 },
      shockWaveAmount: 0,
      shockWaveRadius: 0,
      shockWaveTaperOff: 0,
      sourceTemplateName: '',
    },
    output: {
      actualDamageDealt: 0,
      actualDamageClipped: 0,
      noEffect: false,
    },
  };
}

function createDefaultSourceActiveBodyState(): SourceActiveBodyBlockState {
  return {
    damageScalar: 1,
    currentHealth: 0,
    currentSubdualDamage: 0,
    prevHealth: 0,
    maxHealth: 0,
    initialHealth: 0,
    curDamageState: 0,
    nextDamageFXTime: 0,
    lastDamageFXDone: 0,
    lastDamageInfo: createDefaultSourceDamageInfoState(),
    lastDamageTimestamp: 0xffffffff,
    lastHealingTimestamp: 0xffffffff,
    frontCrushed: false,
    backCrushed: false,
    lastDamageCleared: false,
    indestructible: false,
    particleSystemIds: [],
    armorSetFlags: [],
  };
}

function createDefaultSourceBodyModuleBlockState(moduleType: string): SourceBodyModuleBlockState | null {
  const kind = normalizeSourceBodyModuleKind(moduleType);
  if (!kind) {
    return null;
  }
  if (kind === 'inactive') {
    return {
      kind,
      base: { damageScalar: 1 },
    };
  }
  return {
    kind,
    active: createDefaultSourceActiveBodyState(),
    constructorObjectId: 0,
    isSecondLife: false,
  };
}

interface SourceSpecialPowerModuleBlockState {
  availableOnFrame: number;
  pausedCount: number;
  pausedOnFrame: number;
  pausedPercent: number;
}

function normalizeSourceObjectModuleType(moduleType: string): string {
  return moduleType.trim().toUpperCase();
}

function normalizeSourceObjectModuleTag(moduleTag: unknown): string {
  return typeof moduleTag === 'string' ? moduleTag.trim().toUpperCase() : '';
}

function isSourceSpecialPowerModuleType(moduleType: string): boolean {
  return SOURCE_DERIVED_SPECIAL_POWER_MODULE_TYPES.has(normalizeSourceObjectModuleType(moduleType));
}

function isSourceUpgradeModuleType(moduleType: string): boolean {
  return SOURCE_UPGRADE_MODULE_TYPES.has(normalizeSourceObjectModuleType(moduleType));
}

function isSourceCreateModuleType(moduleType: string): boolean {
  return SOURCE_CREATE_MODULE_TYPES.has(normalizeSourceObjectModuleType(moduleType));
}

function xferSourceBehaviorModuleBase(xfer: Xfer): void {
  const behaviorVersion = xfer.xferVersion(1);
  const objectModuleVersion = xfer.xferVersion(1);
  const moduleVersion = xfer.xferVersion(1);
  if (behaviorVersion !== 1 || objectModuleVersion !== 1 || moduleVersion !== 1) {
    throw new Error('Unsupported source BehaviorModule base version');
  }
}

function xferSourceDieModuleBase(xfer: Xfer): void {
  const dieVersion = xfer.xferVersion(1);
  if (dieVersion !== 1) {
    throw new Error(`Unsupported source DieModule base version ${dieVersion}`);
  }
  xferSourceBehaviorModuleBase(xfer);
}

function xferSourceCreateModule(
  xfer: Xfer,
  needToRunOnBuildComplete: boolean,
): { needToRunOnBuildComplete: boolean } {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source CreateModule version ${version}`);
  }
  xferSourceBehaviorModuleBase(xfer);
  return { needToRunOnBuildComplete: xfer.xferBool(needToRunOnBuildComplete) };
}

function tryParseSourceCreateModuleBlockData(
  data: Uint8Array,
  moduleType: string,
): { needToRunOnBuildComplete: boolean } | null {
  if (!isSourceCreateModuleType(moduleType)) {
    return null;
  }
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-create-module');
  try {
    const derivedVersion = xferLoad.xferVersion(1);
    if (derivedVersion !== 1) {
      return null;
    }
    const parsed = xferSourceCreateModule(xferLoad, false);
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function findLiveSourceCreateModuleState(
  entity: MapEntity,
  moduleType: string,
  moduleTag: string,
): { needToRunOnBuildComplete: boolean } | null {
  const normalizedModuleType = normalizeSourceObjectModuleType(moduleType);
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const states = Array.isArray(entity.createModuleStates) ? entity.createModuleStates : [];
  const matches = states.filter(
    (state) => normalizeSourceObjectModuleType(state.moduleType) === normalizedModuleType,
  );
  if (normalizedModuleTag) {
    const tagMatch = matches.find(
      (state) => normalizeSourceObjectModuleTag(state.moduleTag) === normalizedModuleTag,
    );
    return tagMatch ?? null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

function buildSourceCreateModuleBlockData(needToRunOnBuildComplete: boolean): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-create-module');
  try {
    saver.xferVersion(1);
    xferSourceCreateModule(saver, needToRunOnBuildComplete);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceUpgradeModuleBlockData(
  data: Uint8Array,
  moduleType: string,
): { upgradeExecuted: boolean } | null {
  if (!isSourceUpgradeModuleType(moduleType)) {
    return null;
  }
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-upgrade-module');
  try {
    const derivedVersion = xferLoad.xferVersion(1);
    if (derivedVersion !== 1) {
      return null;
    }
    const upgradeModuleVersion = xferLoad.xferVersion(1);
    if (upgradeModuleVersion !== 1) {
      return null;
    }
    xferSourceBehaviorModuleBase(xferLoad);
    const upgradeMuxVersion = xferLoad.xferVersion(1);
    if (upgradeMuxVersion !== 1) {
      return null;
    }
    const upgradeExecuted = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0 ? { upgradeExecuted } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function findLiveSourceUpgradeModule(
  entity: MapEntity,
  moduleType: string,
  moduleTag: string,
): LiveUpgradeModuleProfile | null {
  const normalizedModuleType = normalizeSourceObjectModuleType(moduleType);
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const upgradeModules = Array.isArray(entity.upgradeModules) ? entity.upgradeModules : [];
  const matches = upgradeModules.filter(
    (module) => normalizeSourceObjectModuleType(module.moduleType) === normalizedModuleType,
  );
  if (matches.length === 0) {
    return null;
  }
  if (normalizedModuleTag) {
    const tagMatches = matches.filter(
      (module) => normalizeSourceObjectModuleTag(module.moduleTag) === normalizedModuleTag,
    );
    if (tagMatches.length === 1) {
      return tagMatches[0]!;
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

function buildSourceUpgradeModuleBlockData(upgradeExecuted: boolean): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-upgrade-module');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    xferSourceBehaviorModuleBase(saver);
    saver.xferVersion(1);
    saver.xferBool(upgradeExecuted);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function xferSourceSpecialPowerModule(
  xfer: Xfer,
  state: SourceSpecialPowerModuleBlockState,
): SourceSpecialPowerModuleBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source SpecialPowerModule version ${version}`);
  }
  xferSourceBehaviorModuleBase(xfer);
  return {
    availableOnFrame: xfer.xferUnsignedInt(state.availableOnFrame),
    pausedCount: xfer.xferInt(state.pausedCount),
    pausedOnFrame: xfer.xferUnsignedInt(state.pausedOnFrame),
    pausedPercent: xfer.xferReal(state.pausedPercent),
  };
}

function createDefaultSourceSpecialPowerModuleState(): SourceSpecialPowerModuleBlockState {
  return {
    availableOnFrame: 0,
    pausedCount: 0,
    pausedOnFrame: 0,
    pausedPercent: 0,
  };
}

function tryParseSourceSpecialPowerModuleBlockData(
  data: Uint8Array,
  moduleType: string,
): SourceSpecialPowerModuleBlockState | null {
  if (!isSourceSpecialPowerModuleType(moduleType)) {
    return null;
  }
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-special-power-module');
  try {
    const derivedVersion = xferLoad.xferVersion(1);
    if (derivedVersion !== 1) {
      return null;
    }
    const parsed = xferSourceSpecialPowerModule(xferLoad, createDefaultSourceSpecialPowerModuleState());
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function findLiveSourceSpecialPowerModule(
  entity: MapEntity,
  moduleType: string,
  moduleTag: string,
): LiveSpecialPowerModuleProfile | null {
  const normalizedModuleType = normalizeSourceObjectModuleType(moduleType);
  const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
  const matches = Array.from(entity.specialPowerModules?.entries() ?? []).filter(
    ([, profile]) => normalizeSourceObjectModuleType(profile.moduleType) === normalizedModuleType,
  );
  if (matches.length === 0) {
    return null;
  }

  if (normalizedModuleTag) {
    const tagMatches = matches.filter(
      ([, profile]) => normalizeSourceObjectModuleTag(profile.moduleTag) === normalizedModuleTag,
    );
    if (tagMatches.length === 1) {
      return tagMatches[0]![1];
    }

    const powerNameMatches = matches.filter(([powerName, profile]) =>
      normalizeSourceObjectModuleTag(powerName) === normalizedModuleTag
      || normalizeSourceObjectModuleTag(profile.specialPowerTemplateName) === normalizedModuleTag);
    if (powerNameMatches.length === 1) {
      return powerNameMatches[0]![1];
    }
  }

  return matches.length === 1 ? matches[0]![1] : null;
}

function buildSourceSpecialPowerModuleState(
  liveModule: LiveSpecialPowerModuleProfile,
  preservedState: SourceSpecialPowerModuleBlockState,
): SourceSpecialPowerModuleBlockState {
  const pausedCount = sourcePhysicsFinite(liveModule.pausedCount, preservedState.pausedCount);
  return {
    availableOnFrame: sourceFlammableUnsignedFrame(liveModule.availableOnFrame, preservedState.availableOnFrame),
    pausedCount: Math.max(0, Math.trunc(pausedCount)),
    pausedOnFrame: sourceFlammableUnsignedFrame(liveModule.pausedOnFrame, preservedState.pausedOnFrame),
    pausedPercent: sourcePhysicsFinite(liveModule.pausedPercent, preservedState.pausedPercent),
  };
}

function buildSourceSpecialPowerModuleBlockData(
  moduleType: string,
  preservedState: SourceSpecialPowerModuleBlockState,
  liveModule: LiveSpecialPowerModuleProfile,
): Uint8Array {
  if (!isSourceSpecialPowerModuleType(moduleType)) {
    return new Uint8Array();
  }
  const saver = new XferSave();
  saver.open('build-source-special-power-module');
  try {
    saver.xferVersion(1);
    xferSourceSpecialPowerModule(
      saver,
      buildSourceSpecialPowerModuleState(liveModule, preservedState),
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildDefaultSourceSpecialPowerModuleBlockData(
  moduleType: string,
  preservedState = createDefaultSourceSpecialPowerModuleState(),
): Uint8Array | null {
  if (!isSourceSpecialPowerModuleType(moduleType)) {
    return null;
  }
  const saver = new XferSave();
  saver.open('build-default-source-special-power-module');
  try {
    saver.xferVersion(1);
    xferSourceSpecialPowerModule(saver, preservedState);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

type SourceContainModuleKind =
  | 'open'
  | 'transport'
  | 'overlord'
  | 'helix'
  | 'parachute'
  | 'garrison'
  | 'tunnel'
  | 'cave'
  | 'heal'
  | 'prison'
  | 'propagandaCenter'
  | 'internetHack'
  | 'riderChange'
  | 'railedTransport'
  | 'mobNexus';

interface SourceOpenContainEnterExitEntry {
  objectId: number;
  type: number;
}

interface SourceOpenContainBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  passengerIds: number[];
  playerEnteredMaskBytes: Uint8Array;
  lastUnloadSoundFrame: number;
  lastLoadSoundFrame: number;
  stealthUnitsContained: number;
  doorCloseCountdown: number;
  conditionState: string[];
  firePointsBytes: Uint8Array;
  firePointStart: number;
  firePointNext: number;
  firePointSize: number;
  noFirePointsInArt: boolean;
  rallyPoint: Coord3D;
  rallyPointExists: boolean;
  enterExitEntries: SourceOpenContainEnterExitEntry[];
  whichExitPath: number;
  passengerAllowedToFire: boolean;
}

interface SourceTransportContainBlockState {
  open: SourceOpenContainBlockState;
  payloadCreated: boolean;
  extraSlotsInUse: number;
  frameExitNotBusy: number;
}

interface SourcePrisonVisualBlockState {
  objectId: number;
  drawableId: number;
}

interface SourcePrisonBehaviorBlockState {
  open: SourceOpenContainBlockState;
  visuals: SourcePrisonVisualBlockState[];
}

interface SourcePropagandaCenterBehaviorBlockState {
  prison: SourcePrisonBehaviorBlockState;
  brainwashingSubjectId: number;
  brainwashingSubjectStartFrame: number;
  brainwashedIds: number[];
}

interface SourceParachuteContainBlockState {
  open: SourceOpenContainBlockState;
  pitch: number;
  roll: number;
  pitchRate: number;
  rollRate: number;
  startZ: number;
  isLandingOverrideSet: boolean;
  landingOverride: Coord3D;
  riderAttachBone: Coord3D;
  riderSwayBone: Coord3D;
  paraAttachBone: Coord3D;
  paraSwayBone: Coord3D;
  riderAttachOffset: Coord3D;
  riderSwayOffset: Coord3D;
  paraAttachOffset: Coord3D;
  paraSwayOffset: Coord3D;
  needToUpdateRiderBones: boolean;
  needToUpdateParaBones: boolean;
  opened: boolean;
}

interface SourceContainModuleBlockState {
  kind: SourceContainModuleKind;
  open?: SourceOpenContainBlockState;
  transport?: SourceTransportContainBlockState;
  prison?: SourcePrisonBehaviorBlockState;
  propagandaCenter?: SourcePropagandaCenterBehaviorBlockState;
  helixPortableStructureId?: number;
  redirectionActivated?: boolean;
  originalTeamId?: number;
  needToRunOnBuildComplete?: boolean;
  isCurrentlyRegistered?: boolean;
  caveIndex?: number;
  extraSlotsInUse?: number;
  riderChangePayloadCreated?: boolean;
  riderChangeExtraSlotsInUse?: number;
  riderChangeFrameExitNotBusy?: number;
  parachute?: SourceParachuteContainBlockState;
}

function normalizeSourceContainModuleKind(moduleType: string): SourceContainModuleKind | null {
  switch (normalizeSourceObjectModuleType(moduleType)) {
    case 'OPENCONTAIN': return 'open';
    case 'TRANSPORTCONTAIN': return 'transport';
    case 'OVERLORDCONTAIN': return 'overlord';
    case 'HELIXCONTAIN': return 'helix';
    case 'PARACHUTECONTAIN': return 'parachute';
    case 'GARRISONCONTAIN': return 'garrison';
    case 'TUNNELCONTAIN': return 'tunnel';
    case 'CAVECONTAIN': return 'cave';
    case 'HEALCONTAIN': return 'heal';
    case 'PRISONBEHAVIOR': return 'prison';
    case 'PROPAGANDACENTERBEHAVIOR': return 'propagandaCenter';
    case 'INTERNETHACKCONTAIN': return 'internetHack';
    case 'RIDERCHANGECONTAIN': return 'riderChange';
    case 'RAILEDTRANSPORTCONTAIN': return 'railedTransport';
    case 'MOBNEXUSCONTAIN': return 'mobNexus';
    default: return null;
  }
}

function normalizedSourceUserBytes(bytes: Uint8Array, byteLength: number): Uint8Array {
  if (bytes.byteLength === byteLength) {
    return bytes;
  }
  const normalized = new Uint8Array(byteLength);
  normalized.set(bytes.subarray(0, byteLength));
  return normalized;
}

function xferSourceUpdateModuleBase(
  xfer: Xfer,
  nextCallFrameAndPhase: number,
): number {
  const updateVersion = xfer.xferVersion(1);
  const behaviorVersion = xfer.xferVersion(1);
  const objectModuleVersion = xfer.xferVersion(1);
  const moduleVersion = xfer.xferVersion(1);
  if (updateVersion !== 1 || behaviorVersion !== 1 || objectModuleVersion !== 1 || moduleVersion !== 1) {
    throw new Error('Unsupported source UpdateModule base version');
  }
  return xfer.xferUnsignedInt(nextCallFrameAndPhase);
}

function xferSourceObjectIdListByUnsignedCount(xfer: Xfer, objectIds: readonly number[]): number[] {
  const count = xfer.xferUnsignedInt(objectIds.length);
  const loaded: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferObjectID(0));
    }
    return loaded;
  }
  for (const objectId of objectIds) {
    loaded.push(xfer.xferObjectID(normalizeSourceObjectId(objectId)));
  }
  return loaded;
}

function xferSourceStlObjectIdList(xfer: Xfer, objectIds: readonly number[]): number[] {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source STL ObjectID list version ${version}`);
  }
  const count = xfer.xferUnsignedShort(objectIds.length);
  const loaded: number[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < count; index += 1) {
      loaded.push(xfer.xferObjectID(0));
    }
    return loaded;
  }
  for (const objectId of objectIds) {
    loaded.push(xfer.xferObjectID(normalizeSourceObjectId(objectId)));
  }
  return loaded;
}

function xferSourceOpenContainEnterExitEntries(
  xfer: Xfer,
  entries: readonly SourceOpenContainEnterExitEntry[],
): SourceOpenContainEnterExitEntry[] {
  const count = xfer.xferUnsignedShort(entries.length);
  const loaded: SourceOpenContainEnterExitEntry[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        objectId: xfer.xferObjectID(0),
        type: parseSourceRawInt32Bytes(xfer.xferUser(new Uint8Array(SOURCE_OBJECT_ENTER_EXIT_TYPE_BYTE_LENGTH))),
      });
    }
    return loaded;
  }
  for (const entry of entries) {
    loaded.push({
      objectId: xfer.xferObjectID(normalizeSourceObjectId(entry.objectId)),
      type: parseSourceRawInt32Bytes(xfer.xferUser(buildSourceRawInt32Bytes(entry.type))),
    });
  }
  return loaded;
}

function xferSourceOpenContain(
  xfer: Xfer,
  state: SourceOpenContainBlockState,
): SourceOpenContainBlockState {
  const version = xfer.xferVersion(2);
  if (version < 1 || version > 2) {
    throw new Error(`Unsupported source OpenContain version ${version}`);
  }
  const nextCallFrameAndPhase = xferSourceUpdateModuleBase(xfer, state.nextCallFrameAndPhase);
  const passengerIds = xferSourceObjectIdListByUnsignedCount(xfer, state.passengerIds);
  const playerEnteredMaskBytes = xfer.xferUser(
    normalizedSourceUserBytes(state.playerEnteredMaskBytes, SOURCE_PLAYER_MASK_BYTE_LENGTH),
  );
  const lastUnloadSoundFrame = xfer.xferUnsignedInt(state.lastUnloadSoundFrame);
  const lastLoadSoundFrame = xfer.xferUnsignedInt(state.lastLoadSoundFrame);
  const stealthUnitsContained = xfer.xferUnsignedInt(state.stealthUnitsContained);
  const doorCloseCountdown = xfer.xferUnsignedInt(state.doorCloseCountdown);
  const conditionState = xferSourceStringBitFlags(xfer, state.conditionState);
  const firePointsBytes = xfer.xferUser(
    normalizedSourceUserBytes(state.firePointsBytes, SOURCE_OPEN_CONTAIN_FIRE_POINTS_BYTE_LENGTH),
  );
  const firePointStart = xfer.xferInt(state.firePointStart);
  const firePointNext = xfer.xferInt(state.firePointNext);
  const firePointSize = xfer.xferInt(state.firePointSize);
  const noFirePointsInArt = xfer.xferBool(state.noFirePointsInArt);
  const rallyPoint = xfer.xferCoord3D(state.rallyPoint);
  const rallyPointExists = xfer.xferBool(state.rallyPointExists);
  const enterExitEntries = xferSourceOpenContainEnterExitEntries(xfer, state.enterExitEntries);
  const whichExitPath = xfer.xferInt(state.whichExitPath);
  const passengerAllowedToFire = version >= 2
    ? xfer.xferBool(state.passengerAllowedToFire)
    : state.passengerAllowedToFire;
  return {
    version,
    nextCallFrameAndPhase,
    passengerIds,
    playerEnteredMaskBytes,
    lastUnloadSoundFrame,
    lastLoadSoundFrame,
    stealthUnitsContained,
    doorCloseCountdown,
    conditionState,
    firePointsBytes,
    firePointStart,
    firePointNext,
    firePointSize,
    noFirePointsInArt,
    rallyPoint,
    rallyPointExists,
    enterExitEntries,
    whichExitPath,
    passengerAllowedToFire,
  };
}

function xferSourceTransportContain(
  xfer: Xfer,
  state: SourceTransportContainBlockState,
): SourceTransportContainBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source TransportContain version ${version}`);
  }
  return {
    open: xferSourceOpenContain(xfer, state.open),
    payloadCreated: xfer.xferBool(state.payloadCreated),
    extraSlotsInUse: xfer.xferInt(state.extraSlotsInUse),
    frameExitNotBusy: xfer.xferUnsignedInt(state.frameExitNotBusy),
  };
}

function xferSourcePrisonVisuals(
  xfer: Xfer,
  visuals: readonly SourcePrisonVisualBlockState[],
): SourcePrisonVisualBlockState[] {
  const count = xfer.xferUnsignedShort(visuals.length);
  const loaded: SourcePrisonVisualBlockState[] = [];
  if (xfer.getMode() === XferMode.XFER_LOAD) {
    for (let index = 0; index < count; index += 1) {
      loaded.push({
        objectId: xfer.xferObjectID(0),
        drawableId: xfer.xferUnsignedInt(0),
      });
    }
    return loaded;
  }
  for (const visual of visuals) {
    loaded.push({
      objectId: xfer.xferObjectID(normalizeSourceObjectId(visual.objectId)),
      drawableId: xfer.xferUnsignedInt(Math.max(0, Math.trunc(visual.drawableId))),
    });
  }
  return loaded;
}

function xferSourcePrisonBehavior(
  xfer: Xfer,
  state: SourcePrisonBehaviorBlockState,
): SourcePrisonBehaviorBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source PrisonBehavior version ${version}`);
  }
  return {
    open: xferSourceOpenContain(xfer, state.open),
    visuals: xferSourcePrisonVisuals(xfer, state.visuals),
  };
}

function xferSourcePropagandaCenterBehavior(
  xfer: Xfer,
  state: SourcePropagandaCenterBehaviorBlockState,
): SourcePropagandaCenterBehaviorBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source PropagandaCenterBehavior version ${version}`);
  }
  return {
    prison: xferSourcePrisonBehavior(xfer, state.prison),
    brainwashingSubjectId: xfer.xferObjectID(normalizeSourceObjectId(state.brainwashingSubjectId)),
    brainwashingSubjectStartFrame: xfer.xferUnsignedInt(
      Math.max(0, Math.trunc(state.brainwashingSubjectStartFrame)),
    ),
    brainwashedIds: xferSourceStlObjectIdList(xfer, state.brainwashedIds),
  };
}

function xferSourceParachuteContain(
  xfer: Xfer,
  state: SourceParachuteContainBlockState,
): SourceParachuteContainBlockState {
  const version = xfer.xferVersion(1);
  if (version !== 1) {
    throw new Error(`Unsupported source ParachuteContain version ${version}`);
  }
  return {
    open: xferSourceOpenContain(xfer, state.open),
    pitch: xfer.xferReal(state.pitch),
    roll: xfer.xferReal(state.roll),
    pitchRate: xfer.xferReal(state.pitchRate),
    rollRate: xfer.xferReal(state.rollRate),
    startZ: xfer.xferReal(state.startZ),
    isLandingOverrideSet: xfer.xferBool(state.isLandingOverrideSet),
    landingOverride: xfer.xferCoord3D(state.landingOverride),
    riderAttachBone: xfer.xferCoord3D(state.riderAttachBone),
    riderSwayBone: xfer.xferCoord3D(state.riderSwayBone),
    paraAttachBone: xfer.xferCoord3D(state.paraAttachBone),
    paraSwayBone: xfer.xferCoord3D(state.paraSwayBone),
    riderAttachOffset: xfer.xferCoord3D(state.riderAttachOffset),
    riderSwayOffset: xfer.xferCoord3D(state.riderSwayOffset),
    paraAttachOffset: xfer.xferCoord3D(state.paraAttachOffset),
    paraSwayOffset: xfer.xferCoord3D(state.paraSwayOffset),
    needToUpdateRiderBones: xfer.xferBool(state.needToUpdateRiderBones),
    needToUpdateParaBones: xfer.xferBool(state.needToUpdateParaBones),
    opened: xfer.xferBool(state.opened),
  };
}

function createDefaultSourceOpenContainState(): SourceOpenContainBlockState {
  return {
    version: 2,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    passengerIds: [],
    playerEnteredMaskBytes: new Uint8Array(SOURCE_PLAYER_MASK_BYTE_LENGTH),
    lastUnloadSoundFrame: 0,
    lastLoadSoundFrame: 0,
    stealthUnitsContained: 0,
    doorCloseCountdown: 0,
    conditionState: [],
    firePointsBytes: new Uint8Array(SOURCE_OPEN_CONTAIN_FIRE_POINTS_BYTE_LENGTH),
    firePointStart: 0,
    firePointNext: 0,
    firePointSize: 0,
    noFirePointsInArt: false,
    rallyPoint: { x: 0, y: 0, z: 0 },
    rallyPointExists: false,
    enterExitEntries: [],
    whichExitPath: 1,
    passengerAllowedToFire: false,
  };
}

function createDefaultSourceTransportContainState(): SourceTransportContainBlockState {
  return {
    open: createDefaultSourceOpenContainState(),
    payloadCreated: false,
    extraSlotsInUse: 0,
    frameExitNotBusy: 0,
  };
}

function createDefaultSourcePrisonBehaviorState(): SourcePrisonBehaviorBlockState {
  return {
    open: createDefaultSourceOpenContainState(),
    visuals: [],
  };
}

function createDefaultSourcePropagandaCenterBehaviorState(): SourcePropagandaCenterBehaviorBlockState {
  return {
    prison: createDefaultSourcePrisonBehaviorState(),
    brainwashingSubjectId: 0,
    brainwashingSubjectStartFrame: 0,
    brainwashedIds: [],
  };
}

function createDefaultSourceParachuteContainState(): SourceParachuteContainBlockState {
  return {
    open: createDefaultSourceOpenContainState(),
    pitch: 0,
    roll: 0,
    pitchRate: 0,
    rollRate: 0,
    startZ: 0,
    isLandingOverrideSet: false,
    landingOverride: { x: 0, y: 0, z: 0 },
    riderAttachBone: { x: 0, y: 0, z: 0 },
    riderSwayBone: { x: 0, y: 0, z: 0 },
    paraAttachBone: { x: 0, y: 0, z: 0 },
    paraSwayBone: { x: 0, y: 0, z: 0 },
    riderAttachOffset: { x: 0, y: 0, z: 0 },
    riderSwayOffset: { x: 0, y: 0, z: 0 },
    paraAttachOffset: { x: 0, y: 0, z: 0 },
    paraSwayOffset: { x: 0, y: 0, z: 0 },
    needToUpdateRiderBones: false,
    needToUpdateParaBones: false,
    opened: false,
  };
}

function createDefaultSourceContainModuleBlockState(moduleType: string): SourceContainModuleBlockState | null {
  const kind = normalizeSourceContainModuleKind(moduleType);
  if (!kind) {
    return null;
  }

  if (kind === 'open' || kind === 'heal') {
    return { kind, open: createDefaultSourceOpenContainState() };
  }
  if (kind === 'transport' || kind === 'internetHack' || kind === 'railedTransport') {
    return { kind, transport: createDefaultSourceTransportContainState() };
  }
  if (kind === 'overlord') {
    return {
      kind,
      transport: createDefaultSourceTransportContainState(),
      redirectionActivated: false,
    };
  }
  if (kind === 'helix') {
    return {
      kind,
      helixPortableStructureId: 0,
      transport: createDefaultSourceTransportContainState(),
    };
  }
  if (kind === 'parachute') {
    const parachute = createDefaultSourceParachuteContainState();
    return { kind, parachute, open: parachute.open };
  }
  if (kind === 'garrison') {
    return {
      kind,
      open: createDefaultSourceOpenContainState(),
      originalTeamId: 0,
    };
  }
  if (kind === 'tunnel') {
    return {
      kind,
      open: createDefaultSourceOpenContainState(),
      needToRunOnBuildComplete: false,
      isCurrentlyRegistered: false,
    };
  }
  if (kind === 'cave') {
    return {
      kind,
      open: createDefaultSourceOpenContainState(),
      needToRunOnBuildComplete: false,
      caveIndex: 0,
      originalTeamId: 0,
    };
  }
  if (kind === 'prison') {
    const prison = createDefaultSourcePrisonBehaviorState();
    return { kind, prison, open: prison.open };
  }
  if (kind === 'propagandaCenter') {
    const propagandaCenter = createDefaultSourcePropagandaCenterBehaviorState();
    return {
      kind,
      propagandaCenter,
      prison: propagandaCenter.prison,
      open: propagandaCenter.prison.open,
    };
  }
  if (kind === 'riderChange') {
    return {
      kind,
      transport: createDefaultSourceTransportContainState(),
      riderChangePayloadCreated: false,
      riderChangeExtraSlotsInUse: 0,
      riderChangeFrameExitNotBusy: 0,
    };
  }
  return {
    kind,
    open: createDefaultSourceOpenContainState(),
    extraSlotsInUse: 0,
  };
}

function tryParseSourceContainModuleBlockData(
  data: Uint8Array,
  moduleType: string,
): SourceContainModuleBlockState | null {
  const kind = normalizeSourceContainModuleKind(moduleType);
  if (!kind) {
    return null;
  }
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-contain-module');
  try {
    let parsed: SourceContainModuleBlockState;
    if (kind === 'open') {
      parsed = { kind, open: xferSourceOpenContain(xferLoad, createDefaultSourceOpenContainState()) };
    } else if (kind === 'transport') {
      parsed = {
        kind,
        transport: xferSourceTransportContain(xferLoad, createDefaultSourceTransportContainState()),
      };
    } else if (kind === 'internetHack' || kind === 'railedTransport') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        transport: xferSourceTransportContain(xferLoad, createDefaultSourceTransportContainState()),
      };
    } else if (kind === 'overlord') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        transport: xferSourceTransportContain(xferLoad, createDefaultSourceTransportContainState()),
        redirectionActivated: xferLoad.xferBool(false),
      };
    } else if (kind === 'helix') {
      const version = xferLoad.xferVersion(2);
      if (version < 1 || version > 2) {
        return null;
      }
      const helixPortableStructureId = version >= 2 ? xferLoad.xferObjectID(0) : 0;
      parsed = {
        kind,
        helixPortableStructureId,
        transport: xferSourceTransportContain(xferLoad, createDefaultSourceTransportContainState()),
      };
    } else if (kind === 'parachute') {
      parsed = {
        kind,
        parachute: xferSourceParachuteContain(xferLoad, createDefaultSourceParachuteContainState()),
      };
    } else if (kind === 'garrison') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        open: xferSourceOpenContain(xferLoad, createDefaultSourceOpenContainState()),
        originalTeamId: xferLoad.xferUnsignedInt(0),
      };
    } else if (kind === 'tunnel') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        open: xferSourceOpenContain(xferLoad, createDefaultSourceOpenContainState()),
        needToRunOnBuildComplete: xferLoad.xferBool(false),
        isCurrentlyRegistered: xferLoad.xferBool(false),
      };
    } else if (kind === 'cave') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        open: xferSourceOpenContain(xferLoad, createDefaultSourceOpenContainState()),
        needToRunOnBuildComplete: xferLoad.xferBool(false),
        caveIndex: xferLoad.xferInt(0),
        originalTeamId: xferLoad.xferUnsignedInt(0),
      };
    } else if (kind === 'heal') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = { kind, open: xferSourceOpenContain(xferLoad, createDefaultSourceOpenContainState()) };
    } else if (kind === 'prison') {
      const prison = xferSourcePrisonBehavior(xferLoad, createDefaultSourcePrisonBehaviorState());
      parsed = { kind, prison, open: prison.open };
    } else if (kind === 'propagandaCenter') {
      const propagandaCenter = xferSourcePropagandaCenterBehavior(
        xferLoad,
        createDefaultSourcePropagandaCenterBehaviorState(),
      );
      parsed = {
        kind,
        propagandaCenter,
        prison: propagandaCenter.prison,
        open: propagandaCenter.prison.open,
      };
    } else if (kind === 'riderChange') {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        transport: xferSourceTransportContain(xferLoad, createDefaultSourceTransportContainState()),
        riderChangePayloadCreated: xferLoad.xferBool(false),
        riderChangeExtraSlotsInUse: xferLoad.xferInt(0),
        riderChangeFrameExitNotBusy: xferLoad.xferUnsignedInt(0),
      };
    } else {
      const version = xferLoad.xferVersion(1);
      if (version !== 1) {
        return null;
      }
      parsed = {
        kind,
        open: xferSourceOpenContain(xferLoad, createDefaultSourceOpenContainState()),
        extraSlotsInUse: xferLoad.xferInt(0),
      };
    }
    return xferLoad.getRemaining() === 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function collectSourceContainPassengerIds(
  container: MapEntity,
  moduleType: string,
  liveEntities: readonly MapEntity[],
): number[] {
  const kind = normalizeSourceContainModuleKind(moduleType);
  if (!kind) {
    return [];
  }
  const passengerIds: number[] = [];
  for (const passenger of liveEntities) {
    if (!passenger || passenger.id === container.id || passenger.destroyed) {
      continue;
    }
    if ((kind === 'garrison' && passenger.garrisonContainerId === container.id)
      || ((kind === 'tunnel' || kind === 'cave') && passenger.tunnelContainerId === container.id)
      || (kind !== 'garrison'
        && kind !== 'tunnel'
        && kind !== 'cave'
        && passenger.transportContainerId === container.id)) {
      passengerIds.push(Math.max(0, Math.trunc(passenger.id)));
    }
  }
  return passengerIds.sort((a, b) => a - b);
}

function overlaySourceOpenContainStateFromLiveEntity(
  entity: MapEntity,
  moduleType: string,
  liveEntities: readonly MapEntity[],
  preservedState: SourceOpenContainBlockState,
): SourceOpenContainBlockState {
  return {
    ...preservedState,
    passengerIds: collectSourceContainPassengerIds(entity, moduleType, liveEntities),
    passengerAllowedToFire: typeof entity.containProfile?.passengersAllowedToFire === 'boolean'
      ? entity.containProfile.passengersAllowedToFire
      : preservedState.passengerAllowedToFire,
  };
}

function overlaySourceTransportContainStateFromLiveEntity(
  entity: MapEntity,
  moduleType: string,
  liveEntities: readonly MapEntity[],
  preservedState: SourceTransportContainBlockState,
): SourceTransportContainBlockState {
  return {
    ...preservedState,
    open: overlaySourceOpenContainStateFromLiveEntity(entity, moduleType, liveEntities, preservedState.open),
    payloadCreated: typeof entity.initialPayloadCreated === 'boolean'
      ? entity.initialPayloadCreated
      : preservedState.payloadCreated,
  };
}

function sourcePrisonVisualsFromLiveEntity(
  entity: MapEntity,
  preservedVisuals: readonly SourcePrisonVisualBlockState[],
): SourcePrisonVisualBlockState[] {
  const liveVisuals = (entity as unknown as {
    prisonVisuals?: Array<{ objectId?: number; drawableId?: number }>;
  }).prisonVisuals;
  const sourceVisuals = Array.isArray(liveVisuals) ? liveVisuals : preservedVisuals;
  return sourceVisuals.map((visual) => ({
    objectId: normalizeSourceObjectId(visual.objectId ?? 0),
    drawableId: Math.max(0, Math.trunc(visual.drawableId ?? 0)),
  }));
}

function overlaySourcePrisonBehaviorStateFromLiveEntity(
  entity: MapEntity,
  moduleType: string,
  liveEntities: readonly MapEntity[],
  preservedState: SourcePrisonBehaviorBlockState,
): SourcePrisonBehaviorBlockState {
  return {
    open: overlaySourceOpenContainStateFromLiveEntity(entity, moduleType, liveEntities, preservedState.open),
    visuals: sourcePrisonVisualsFromLiveEntity(entity, preservedState.visuals),
  };
}

function overlaySourcePropagandaCenterBehaviorStateFromLiveEntity(
  entity: MapEntity,
  moduleType: string,
  liveEntities: readonly MapEntity[],
  preservedState: SourcePropagandaCenterBehaviorBlockState,
): SourcePropagandaCenterBehaviorBlockState {
  const liveState = entity as unknown as {
    propagandaBrainwashingSubjectId?: number;
    propagandaBrainwashingSubjectStartFrame?: number;
    propagandaBrainwashedIds?: number[];
  };
  return {
    prison: overlaySourcePrisonBehaviorStateFromLiveEntity(
      entity,
      moduleType,
      liveEntities,
      preservedState.prison,
    ),
    brainwashingSubjectId: Number.isFinite(liveState.propagandaBrainwashingSubjectId)
      ? normalizeSourceObjectId(liveState.propagandaBrainwashingSubjectId ?? 0)
      : preservedState.brainwashingSubjectId,
    brainwashingSubjectStartFrame: Number.isFinite(liveState.propagandaBrainwashingSubjectStartFrame)
      ? Math.max(0, Math.trunc(liveState.propagandaBrainwashingSubjectStartFrame ?? 0))
      : preservedState.brainwashingSubjectStartFrame,
    brainwashedIds: Array.isArray(liveState.propagandaBrainwashedIds)
      ? liveState.propagandaBrainwashedIds.map((objectId) => normalizeSourceObjectId(objectId))
      : preservedState.brainwashedIds,
  };
}

function buildSourceContainModuleBlockData(
  entity: MapEntity,
  moduleType: string,
  liveEntities: readonly MapEntity[],
  preservedState: SourceContainModuleBlockState,
): Uint8Array {
  const kind = normalizeSourceContainModuleKind(moduleType);
  if (!kind || kind !== preservedState.kind) {
    return new Uint8Array();
  }
  const saver = new XferSave();
  saver.open('build-source-contain-module');
  try {
    if (kind === 'open') {
      xferSourceOpenContain(
        saver,
        overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.open ?? createDefaultSourceOpenContainState(),
        ),
      );
    } else if (kind === 'transport') {
      xferSourceTransportContain(
        saver,
        overlaySourceTransportContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.transport ?? createDefaultSourceTransportContainState(),
        ),
      );
    } else if (kind === 'internetHack' || kind === 'railedTransport') {
      saver.xferVersion(1);
      xferSourceTransportContain(
        saver,
        overlaySourceTransportContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.transport ?? createDefaultSourceTransportContainState(),
        ),
      );
    } else if (kind === 'overlord') {
      saver.xferVersion(1);
      xferSourceTransportContain(
        saver,
        overlaySourceTransportContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.transport ?? createDefaultSourceTransportContainState(),
        ),
      );
      saver.xferBool(preservedState.redirectionActivated ?? false);
    } else if (kind === 'helix') {
      saver.xferVersion(2);
      saver.xferObjectID(normalizeSourceObjectId(
        entity.helixPortableRiderId ?? preservedState.helixPortableStructureId ?? 0,
      ));
      xferSourceTransportContain(
        saver,
        overlaySourceTransportContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.transport ?? createDefaultSourceTransportContainState(),
        ),
      );
    } else if (kind === 'parachute') {
      const parachute = preservedState.parachute ?? createDefaultSourceParachuteContainState();
      xferSourceParachuteContain(saver, {
        ...parachute,
        open: overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          parachute.open,
        ),
      });
    } else if (kind === 'garrison') {
      saver.xferVersion(1);
      xferSourceOpenContain(
        saver,
        overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.open ?? createDefaultSourceOpenContainState(),
        ),
      );
      saver.xferUnsignedInt(Math.max(0, Math.trunc(preservedState.originalTeamId ?? 0)));
    } else if (kind === 'tunnel') {
      saver.xferVersion(1);
      xferSourceOpenContain(
        saver,
        overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.open ?? createDefaultSourceOpenContainState(),
        ),
      );
      saver.xferBool(preservedState.needToRunOnBuildComplete ?? false);
      saver.xferBool(preservedState.isCurrentlyRegistered ?? false);
    } else if (kind === 'cave') {
      saver.xferVersion(1);
      xferSourceOpenContain(
        saver,
        overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.open ?? createDefaultSourceOpenContainState(),
        ),
      );
      saver.xferBool(preservedState.needToRunOnBuildComplete ?? false);
      saver.xferInt(Math.trunc(sourcePhysicsFinite(
        entity.containProfile?.caveIndex,
        preservedState.caveIndex ?? 0,
      )));
      saver.xferUnsignedInt(Math.max(0, Math.trunc(preservedState.originalTeamId ?? 0)));
    } else if (kind === 'heal') {
      saver.xferVersion(1);
      xferSourceOpenContain(
        saver,
        overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.open ?? createDefaultSourceOpenContainState(),
        ),
      );
    } else if (kind === 'prison') {
      xferSourcePrisonBehavior(
        saver,
        overlaySourcePrisonBehaviorStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.prison ?? createDefaultSourcePrisonBehaviorState(),
        ),
      );
    } else if (kind === 'propagandaCenter') {
      xferSourcePropagandaCenterBehavior(
        saver,
        overlaySourcePropagandaCenterBehaviorStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.propagandaCenter ?? createDefaultSourcePropagandaCenterBehaviorState(),
        ),
      );
    } else if (kind === 'riderChange') {
      saver.xferVersion(1);
      xferSourceTransportContain(
        saver,
        overlaySourceTransportContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.transport ?? createDefaultSourceTransportContainState(),
        ),
      );
      saver.xferBool(typeof entity.initialPayloadCreated === 'boolean'
        ? entity.initialPayloadCreated
        : preservedState.riderChangePayloadCreated ?? false);
      saver.xferInt(preservedState.riderChangeExtraSlotsInUse ?? 0);
      saver.xferUnsignedInt(preservedState.riderChangeFrameExitNotBusy ?? 0);
    } else {
      saver.xferVersion(1);
      xferSourceOpenContain(
        saver,
        overlaySourceOpenContainStateFromLiveEntity(
          entity,
          moduleType,
          liveEntities,
          preservedState.open ?? createDefaultSourceOpenContainState(),
        ),
      );
      saver.xferInt(preservedState.extraSlotsInUse ?? 0);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceProductionQueueEntryBlockState {
  type: number;
  name: string;
  productionId: number;
  percentComplete: number;
  framesUnderConstruction: number;
  productionQuantityTotal: number;
  productionQuantityProduced: number;
  exitDoor: number;
}

interface SourceProductionUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  queue: SourceProductionQueueEntryBlockState[];
  uniqueId: number;
  productionCount: number;
  constructionCompleteFrame: number;
  doorInfoBytes: Uint8Array;
  clearFlags: string[];
  setFlags: string[];
  flagsDirty: boolean;
}

type LiveProductionQueueEntry = MapEntity['productionQueue'][number];

function sourceProductionEntryType(entry: LiveProductionQueueEntry): number {
  switch (entry.type) {
    case 'UNIT': return SOURCE_PRODUCTION_UNIT;
    case 'UPGRADE': return SOURCE_PRODUCTION_UPGRADE;
    default: return SOURCE_PRODUCTION_INVALID;
  }
}

function sourceProductionEntryName(entry: LiveProductionQueueEntry): string {
  return entry.type === 'UNIT' ? entry.templateName : entry.upgradeName;
}

function sourceProductionEntryQuantityTotal(entry: LiveProductionQueueEntry): number {
  return entry.type === 'UNIT' ? entry.productionQuantityTotal : 0;
}

function sourceProductionEntryQuantityProduced(entry: LiveProductionQueueEntry): number {
  return entry.type === 'UNIT' ? entry.productionQuantityProduced : 0;
}

function sourceProductionEntryProductionId(entry: LiveProductionQueueEntry): number {
  return entry.type === 'UPGRADE'
    ? SOURCE_PRODUCTIONID_INVALID
    : Math.max(0, Math.trunc(entry.productionId));
}

function sourceProductionEntryPreservedName(
  entry: LiveProductionQueueEntry,
  type: number,
  preservedState: SourceProductionUpdateBlockState,
): string {
  const liveName = sourceProductionEntryName(entry).trim();
  const liveNameUpper = liveName.toUpperCase();
  const liveProductionId = sourceProductionEntryProductionId(entry);
  const matched = preservedState.queue.find((candidate) =>
    candidate.type === type
    && candidate.productionId === liveProductionId
    && candidate.name.trim().toUpperCase() === liveNameUpper,
  );
  return matched?.name ?? liveName;
}

function buildSourceProductionQueueEntries(
  entity: MapEntity,
  preservedState: SourceProductionUpdateBlockState,
): SourceProductionQueueEntryBlockState[] {
  return entity.productionQueue.map((entry) => {
    const type = sourceProductionEntryType(entry);
    return {
      type,
      name: sourceProductionEntryPreservedName(entry, type, preservedState),
      productionId: sourceProductionEntryProductionId(entry),
      percentComplete: sourcePhysicsFinite(entry.percentComplete, 0),
      framesUnderConstruction: Math.trunc(sourcePhysicsFinite(entry.framesUnderConstruction, 0)),
      productionQuantityTotal: Math.trunc(sourcePhysicsFinite(sourceProductionEntryQuantityTotal(entry), 0)),
      productionQuantityProduced: Math.trunc(sourcePhysicsFinite(sourceProductionEntryQuantityProduced(entry), 0)),
      exitDoor: preservedState.queue.find((candidate) =>
        candidate.type === type
        && candidate.productionId === sourceProductionEntryProductionId(entry)
        && candidate.name.trim().toUpperCase() === sourceProductionEntryName(entry).trim().toUpperCase(),
      )?.exitDoor ?? -1,
    };
  });
}

function tryParseSourceProductionUpdateBlockData(
  data: Uint8Array,
): SourceProductionUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-production-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const queueCount = xferLoad.xferUnsignedShort(0);
    const queue: SourceProductionQueueEntryBlockState[] = [];
    for (let index = 0; index < queueCount; index += 1) {
      queue.push({
        type: parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
        name: xferLoad.xferAsciiString(''),
        productionId: parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4))),
        percentComplete: xferLoad.xferReal(0),
        framesUnderConstruction: xferLoad.xferInt(0),
        productionQuantityTotal: xferLoad.xferInt(0),
        productionQuantityProduced: xferLoad.xferInt(0),
        exitDoor: xferLoad.xferInt(0),
      });
    }
    const uniqueId = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const productionCount = xferLoad.xferUnsignedInt(0);
    const constructionCompleteFrame = xferLoad.xferUnsignedInt(0);
    const doorInfoBytes = xferLoad.xferUser(new Uint8Array(SOURCE_PRODUCTION_DOOR_INFO_BYTE_LENGTH));
    const clearFlags = xferSourceStringBitFlags(xferLoad, []);
    const setFlags = xferSourceStringBitFlags(xferLoad, []);
    const flagsDirty = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        queue,
        uniqueId,
        productionCount,
        constructionCompleteFrame,
        doorInfoBytes,
        clearFlags,
        setFlags,
        flagsDirty,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function createDefaultSourceProductionUpdateBlockState(): SourceProductionUpdateBlockState {
  return {
    version: 1,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    queue: [],
    uniqueId: 1,
    productionCount: 0,
    constructionCompleteFrame: 0,
    doorInfoBytes: new Uint8Array(SOURCE_PRODUCTION_DOOR_INFO_BYTE_LENGTH),
    clearFlags: [],
    setFlags: [],
    flagsDirty: false,
  };
}

function buildSourceProductionUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceProductionUpdateBlockState,
): Uint8Array {
  const queue = buildSourceProductionQueueEntries(entity, preservedState);
  const uniqueId = Math.max(1, Math.trunc(sourcePhysicsFinite(entity.productionNextId, preservedState.uniqueId)));
  const saver = new XferSave();
  saver.open('build-source-production-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUnsignedShort(queue.length);
    for (const entry of queue) {
      saver.xferUser(buildSourceRawInt32Bytes(entry.type));
      saver.xferAsciiString(entry.name);
      saver.xferUser(buildSourceRawInt32Bytes(entry.productionId));
      saver.xferReal(entry.percentComplete);
      saver.xferInt(entry.framesUnderConstruction);
      saver.xferInt(entry.productionQuantityTotal);
      saver.xferInt(entry.productionQuantityProduced);
      saver.xferInt(entry.exitDoor);
    }
    saver.xferUser(buildSourceRawInt32Bytes(uniqueId));
    saver.xferUnsignedInt(queue.length);
    saver.xferUnsignedInt(sourceFlammableUnsignedFrame(preservedState.constructionCompleteFrame));
    saver.xferUser(preservedState.doorInfoBytes);
    xferSourceStringBitFlags(saver, preservedState.clearFlags);
    xferSourceStringBitFlags(saver, preservedState.setFlags);
    saver.xferBool(preservedState.flagsDirty);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceBattlePlanUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  currentPlan: number;
  desiredPlan: number;
  planAffectingArmy: number;
  status: number;
  nextReadyFrame: number;
  invalidSettings: boolean;
  centeringTurret: boolean;
  armorScalar: number;
  bombardment: number;
  searchAndDestroy: number;
  holdTheLine: number;
  sightRangeScalar: number;
  validKindOf: string[];
  invalidKindOf: string[];
  visionObjectId: number;
}

function sourceBattlePlanTypeToIntOrNull(value: unknown): number | null {
  switch (value) {
    case 'NONE': return SOURCE_BATTLE_PLAN_NONE;
    case 'BOMBARDMENT': return SOURCE_BATTLE_PLAN_BOMBARDMENT;
    case 'HOLDTHELINE': return SOURCE_BATTLE_PLAN_HOLD_THE_LINE;
    case 'SEARCHANDDESTROY': return SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY;
    default: return null;
  }
}

function sourceBattlePlanTypeToInt(value: unknown, fallback: number): number {
  return sourceBattlePlanTypeToIntOrNull(value) ?? fallback;
}

function sourceBattlePlanStatusToInt(value: unknown, fallback: number): number {
  switch (value) {
    case 'IDLE': return SOURCE_BATTLE_PLAN_STATUS_IDLE;
    case 'UNPACKING': return SOURCE_BATTLE_PLAN_STATUS_UNPACKING;
    case 'ACTIVE': return SOURCE_BATTLE_PLAN_STATUS_ACTIVE;
    case 'PACKING': return SOURCE_BATTLE_PLAN_STATUS_PACKING;
    default: return fallback;
  }
}

function sourceBattlePlanCurrentPlan(
  entity: MapEntity,
  status: number,
  desiredPlan: number,
  planAffectingArmy: number,
  preservedState: SourceBattlePlanUpdateBlockState,
): number {
  const state = entity.battlePlanState;
  if (!state) {
    return preservedState.currentPlan;
  }
  const currentPlan = sourceBattlePlanTypeToIntOrNull(state.currentPlan);
  switch (status) {
    case SOURCE_BATTLE_PLAN_STATUS_IDLE:
      return SOURCE_BATTLE_PLAN_NONE;
    case SOURCE_BATTLE_PLAN_STATUS_UNPACKING:
      return desiredPlan;
    case SOURCE_BATTLE_PLAN_STATUS_ACTIVE:
      return currentPlan ?? sourceBattlePlanTypeToInt(state.activePlan, planAffectingArmy);
    case SOURCE_BATTLE_PLAN_STATUS_PACKING:
      return currentPlan
        ?? (preservedState.currentPlan !== SOURCE_BATTLE_PLAN_NONE
          ? preservedState.currentPlan
          : sourceBattlePlanTypeToInt(state.activePlan, preservedState.currentPlan));
    default:
      return preservedState.currentPlan;
  }
}

function sourceBattlePlanAffectingArmy(
  entity: MapEntity,
  status: number,
  preservedState: SourceBattlePlanUpdateBlockState,
): number {
  const state = entity.battlePlanState;
  if (!state) {
    return preservedState.planAffectingArmy;
  }
  if (status !== SOURCE_BATTLE_PLAN_STATUS_ACTIVE) {
    return SOURCE_BATTLE_PLAN_NONE;
  }
  return sourceBattlePlanTypeToInt(state.activePlan, preservedState.planAffectingArmy);
}

function sourceBattlePlanNextReadyFrame(
  entity: MapEntity,
  status: number,
  preservedState: SourceBattlePlanUpdateBlockState,
): number {
  const state = entity.battlePlanState;
  if (!state) {
    return sourceFlammableUnsignedFrame(preservedState.nextReadyFrame);
  }
  switch (status) {
    case SOURCE_BATTLE_PLAN_STATUS_IDLE:
      return sourceFlammableUnsignedFrame(state.idleCooldownFinishFrame, preservedState.nextReadyFrame);
    case SOURCE_BATTLE_PLAN_STATUS_UNPACKING:
    case SOURCE_BATTLE_PLAN_STATUS_ACTIVE:
    case SOURCE_BATTLE_PLAN_STATUS_PACKING:
      return sourceFlammableUnsignedFrame(state.transitionFinishFrame, preservedState.nextReadyFrame);
    default:
      return sourceFlammableUnsignedFrame(preservedState.nextReadyFrame);
  }
}

function sourceBattlePlanKindOfMaskNames(
  names: ReadonlySet<string> | null | undefined,
  fallback: string[],
): string[] {
  if (!names) {
    return fallback;
  }
  const remaining = new Set(
    [...names].map((name) => name.trim().toUpperCase()).filter((name) => name.length > 0),
  );
  const ordered = SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT.filter((name) => {
    if (!remaining.has(name)) {
      return false;
    }
    remaining.delete(name);
    return true;
  });
  return [...ordered, ...remaining];
}

function tryParseSourceBattlePlanUpdateBlockData(
  data: Uint8Array,
): SourceBattlePlanUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-battle-plan-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const currentPlan = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const desiredPlan = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const planAffectingArmy = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const status = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const nextReadyFrame = xferLoad.xferUnsignedInt(0);
    const invalidSettings = xferLoad.xferBool(false);
    const centeringTurret = xferLoad.xferBool(false);
    const armorScalar = xferLoad.xferReal(1);
    const bombardment = xferLoad.xferInt(0);
    const searchAndDestroy = xferLoad.xferInt(0);
    const holdTheLine = xferLoad.xferInt(0);
    const sightRangeScalar = xferLoad.xferReal(1);
    const validKindOf = xferSourceKindOfNames(xferLoad, []);
    const invalidKindOf = xferSourceKindOfNames(xferLoad, []);
    const visionObjectId = xferLoad.xferObjectID(0);
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        currentPlan,
        desiredPlan,
        planAffectingArmy,
        status,
        nextReadyFrame,
        invalidSettings,
        centeringTurret,
        armorScalar,
        bombardment,
        searchAndDestroy,
        holdTheLine,
        sightRangeScalar,
        validKindOf,
        invalidKindOf,
        visionObjectId,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceBattlePlanUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceBattlePlanUpdateBlockState,
): Uint8Array {
  const state = entity.battlePlanState;
  const profile = entity.battlePlanProfile;
  const status = state
    ? sourceBattlePlanStatusToInt(state.transitionStatus, preservedState.status)
    : preservedState.status;
  const desiredPlan = state
    ? sourceBattlePlanTypeToInt(state.desiredPlan, preservedState.desiredPlan)
    : preservedState.desiredPlan;
  const planAffectingArmy = sourceBattlePlanAffectingArmy(entity, status, preservedState);
  const currentPlan = sourceBattlePlanCurrentPlan(
    entity,
    status,
    desiredPlan,
    planAffectingArmy,
    preservedState,
  );
  const hasLiveProfile = profile !== null && profile !== undefined;
  const armorScalar = hasLiveProfile
    ? (planAffectingArmy === SOURCE_BATTLE_PLAN_HOLD_THE_LINE
      ? sourcePhysicsFinite(profile.holdTheLineArmorDamageScalar, 1)
      : 1)
    : preservedState.armorScalar;
  const sightRangeScalar = hasLiveProfile
    ? (planAffectingArmy === SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY
      ? sourcePhysicsFinite(profile.searchAndDestroySightRangeScalar, 1)
      : 1)
    : preservedState.sightRangeScalar;
  const validKindOf = sourceBattlePlanKindOfMaskNames(profile?.validMemberKindOf, preservedState.validKindOf);
  const invalidKindOf = sourceBattlePlanKindOfMaskNames(profile?.invalidMemberKindOf, preservedState.invalidKindOf);
  const invalidSettings = preservedState.invalidSettings
    || (hasLiveProfile && profile.specialPowerTemplateName.trim().length === 0);
  const saver = new XferSave();
  saver.open('build-source-battle-plan-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferUser(buildSourceRawInt32Bytes(currentPlan));
    saver.xferUser(buildSourceRawInt32Bytes(desiredPlan));
    saver.xferUser(buildSourceRawInt32Bytes(planAffectingArmy));
    saver.xferUser(buildSourceRawInt32Bytes(status));
    saver.xferUnsignedInt(sourceBattlePlanNextReadyFrame(entity, status, preservedState));
    saver.xferBool(invalidSettings);
    saver.xferBool(preservedState.centeringTurret);
    saver.xferReal(armorScalar);
    saver.xferInt(planAffectingArmy === SOURCE_BATTLE_PLAN_BOMBARDMENT ? 1 : 0);
    saver.xferInt(planAffectingArmy === SOURCE_BATTLE_PLAN_SEARCH_AND_DESTROY ? 1 : 0);
    saver.xferInt(planAffectingArmy === SOURCE_BATTLE_PLAN_HOLD_THE_LINE ? 1 : 0);
    saver.xferReal(sightRangeScalar);
    xferSourceKindOfNames(saver, validKindOf);
    xferSourceKindOfNames(saver, invalidKindOf);
    saver.xferObjectID(normalizeSourceObjectId(preservedState.visionObjectId));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceBattlePlanUpdateBlockState(
  entity: MapEntity,
): SourceBattlePlanUpdateBlockState {
  const profile = entity.battlePlanProfile;
  return {
    version: 1,
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    currentPlan: SOURCE_BATTLE_PLAN_NONE,
    desiredPlan: SOURCE_BATTLE_PLAN_NONE,
    planAffectingArmy: SOURCE_BATTLE_PLAN_NONE,
    status: SOURCE_BATTLE_PLAN_STATUS_IDLE,
    nextReadyFrame: 0,
    invalidSettings: false,
    centeringTurret: false,
    armorScalar: 1,
    bombardment: 0,
    searchAndDestroy: 0,
    holdTheLine: 0,
    sightRangeScalar: 1,
    validKindOf: sourceBattlePlanKindOfMaskNames(profile?.validMemberKindOf, []),
    invalidKindOf: sourceBattlePlanKindOfMaskNames(profile?.invalidMemberKindOf, []),
    visionObjectId: 0,
  };
}

interface SourceRgbColorState {
  red: number;
  green: number;
  blue: number;
}

interface SourceMobMemberSlavedUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  slaver: number;
  framesToWait: number;
  mobState: number;
  personalColor: SourceRgbColorState;
  primaryVictimId: number;
  squirrellinessRatio: number;
  isSelfTasking: boolean;
  catchUpCrisisTimer: number;
}

interface SourceSlavedUpdateBlockState {
  version: number;
  nextCallFrameAndPhase: number;
  slaver: number;
  guardPointOffset: Coord3D;
  framesToWait: number;
  repairState: number;
  repairing: boolean;
}

function xferSourceRgbColor(xfer: Xfer, color: SourceRgbColorState): SourceRgbColorState {
  return {
    red: xfer.xferReal(color.red),
    green: xfer.xferReal(color.green),
    blue: xfer.xferReal(color.blue),
  };
}

function sourceMobMemberVictimId(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && Math.trunc(value) >= 0
    ? Math.trunc(value) >>> 0
    : 0;
}

function tryParseSourceMobMemberSlavedUpdateBlockData(
  data: Uint8Array,
): SourceMobMemberSlavedUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-mob-member-slaved-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const slaver = xferLoad.xferObjectID(0);
    const framesToWait = xferLoad.xferInt(0);
    const mobState = xferLoad.xferInt(0);
    const personalColor = xferSourceRgbColor(xferLoad, { red: 0, green: 0, blue: 0 });
    const primaryVictimId = xferLoad.xferObjectID(0);
    const squirrellinessRatio = xferLoad.xferReal(0);
    const isSelfTasking = xferLoad.xferBool(false);
    const catchUpCrisisTimer = xferLoad.xferUnsignedInt(0);
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        slaver,
        framesToWait,
        mobState,
        personalColor,
        primaryVictimId,
        squirrellinessRatio,
        isSelfTasking,
        catchUpCrisisTimer,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function tryParseSourceSlavedUpdateBlockData(
  data: Uint8Array,
): SourceSlavedUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-slaved-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const slaver = xferLoad.xferObjectID(0);
    const guardPointOffset = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const framesToWait = xferLoad.xferInt(0);
    const repairState = xferLoad.xferInt(0);
    const repairing = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        slaver,
        guardPointOffset,
        framesToWait,
        repairState,
        repairing,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSlavedUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceSlavedUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-slaved-update');
  try {
    const framesToWait = Number.isFinite(entity.slavedNextUpdateFrame)
      ? Math.max(0, Math.trunc(entity.slavedNextUpdateFrame - currentFrame))
      : preservedState.framesToWait;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferObjectID(normalizeSourceObjectId(entity.slaverEntityId ?? preservedState.slaver));
    saver.xferCoord3D({
      x: sourcePhysicsFinite(entity.slaveGuardOffsetX, preservedState.guardPointOffset.x),
      y: sourcePhysicsFinite(entity.slaveGuardOffsetZ, preservedState.guardPointOffset.y),
      z: preservedState.guardPointOffset.z,
    });
    saver.xferInt(Math.trunc(framesToWait));
    saver.xferInt(Math.trunc(sourcePhysicsFinite(preservedState.repairState, 0)));
    saver.xferBool(preservedState.repairing);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceSlavedUpdateBlockState(): SourceSlavedUpdateBlockState {
  return {
    version: 1,
    nextCallFrameAndPhase: 0,
    slaver: 0,
    guardPointOffset: { x: 0, y: 0, z: 0 },
    framesToWait: 0,
    repairState: 0,
    repairing: false,
  };
}

function buildSourceMobMemberSlavedUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceMobMemberSlavedUpdateBlockState,
): Uint8Array {
  const state = entity.mobMemberState;
  const profile = entity.mobMemberProfile;
  const saver = new XferSave();
  saver.open('build-source-mob-member-slaved-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferObjectID(normalizeSourceObjectId(entity.slaverEntityId ?? preservedState.slaver));
    saver.xferInt(Math.trunc(sourcePhysicsFinite(state?.framesToWait, preservedState.framesToWait)));
    saver.xferInt(Math.trunc(sourcePhysicsFinite(state?.mobState, preservedState.mobState)));
    xferSourceRgbColor(saver, preservedState.personalColor);
    saver.xferObjectID(sourceMobMemberVictimId(state?.primaryVictimId ?? preservedState.primaryVictimId));
    saver.xferReal(sourcePhysicsFinite(profile?.squirrellinessRatio, preservedState.squirrellinessRatio));
    saver.xferBool(typeof state?.isSelfTasking === 'boolean' ? state.isSelfTasking : preservedState.isSelfTasking);
    saver.xferUnsignedInt(
      Math.max(0, Math.trunc(sourcePhysicsFinite(state?.catchUpCrisisTimer, preservedState.catchUpCrisisTimer))) >>> 0,
    );
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceFloatUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-float-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferBool(entity.floatUpdateProfile?.enabled === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

interface SourceTensileFormationUpdateBlockState {
  nextCallFrameAndPhase: number;
  enabled: boolean;
}

function tryParseSourceTensileFormationUpdateBlockData(
  data: Uint8Array,
): SourceTensileFormationUpdateBlockState | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-tensile-formation-update');
  try {
    const version = xferLoad.xferVersion(1);
    if (version !== 1) {
      return null;
    }
    const nextCallFrameAndPhase = xferSourceUpdateModuleBase(
      xferLoad,
      buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    );
    const enabled = xferLoad.xferBool(false);
    return xferLoad.getRemaining() === 0 ? { nextCallFrameAndPhase, enabled } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceTensileFormationUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: SourceTensileFormationUpdateBlockState,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-tensile-formation-update');
  try {
    const state = entity.tensileFormationState;
    const enabled = typeof state?.enabled === 'boolean' ? state.enabled : preservedState.enabled;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(
        enabled
          ? currentFrame + 1
          : sourceNonNegativeInt(state?.nextWakeFrame, preservedState.nextCallFrameAndPhase >>> 2),
      ),
    ));
    saver.xferBool(enabled);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourceTensileFormationUpdateBlockState(entity: MapEntity):
  SourceTensileFormationUpdateBlockState {
  return {
    nextCallFrameAndPhase: buildSourceUpdateModuleWakeFrame(SOURCE_FRAME_FOREVER),
    enabled: entity.tensileFormationProfile?.enabled === true,
  };
}

function buildSourcePilotFindVehicleUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-pilot-find-vehicle-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferBool(entity.pilotFindVehicleDidMoveToBase === true);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceSpectreGunshipStatusToInt(
  status: 'INSERTING' | 'ORBITING' | 'DEPARTING' | 'IDLE',
): number {
  switch (status) {
    case 'INSERTING': return 0;
    case 'ORBITING': return 1;
    case 'DEPARTING': return 2;
    case 'IDLE': return 3;
  }
}

function sourceSpectreGunshipIntToStatus(value: number): 'INSERTING' | 'ORBITING' | 'DEPARTING' | 'IDLE' {
  switch (value) {
    case 0: return 'INSERTING';
    case 1: return 'ORBITING';
    case 2: return 'DEPARTING';
    case 3: return 'IDLE';
    default: return 'IDLE';
  }
}

function buildSourceSpectreGunshipStatusBytes(
  status: 'INSERTING' | 'ORBITING' | 'DEPARTING' | 'IDLE',
): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, sourceSpectreGunshipStatusToInt(status), true);
  return new Uint8Array(buffer);
}

function parseSourceSpectreGunshipStatusBytes(bytes: Uint8Array): 'INSERTING' | 'ORBITING' | 'DEPARTING' | 'IDLE' {
  if (bytes.byteLength < 4) {
    return 'IDLE';
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return sourceSpectreGunshipIntToStatus(view.getInt32(0, true));
}

function tryParseSourceSpectreGunshipDeploymentUpdateBlockData(
  data: Uint8Array,
): { gunshipId: number } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-spectre-gunship-deployment-update');
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
    const gunshipId = xferLoad.xferObjectID(0);
    return xferLoad.getRemaining() === 0 ? { gunshipId } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpectreGunshipDeploymentUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-spectre-gunship-deployment-update');
  try {
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferObjectID(Math.max(0, Math.trunc(entity.spectreGunshipDeploymentGunshipId ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourceSpectreGunshipUpdateBlockData(
  data: Uint8Array,
): {
  initialTargetPosition: { x: number; y: number; z: number };
  overrideTargetDestination: { x: number; y: number; z: number };
  satellitePosition: { x: number; y: number; z: number };
  status: 'INSERTING' | 'ORBITING' | 'DEPARTING' | 'IDLE';
  orbitEscapeFrame: number;
  gattlingTargetPosition: { x: number; y: number; z: number };
  positionToShootAt: { x: number; y: number; z: number };
  okToFireHowitzerCounter: number;
  gattlingId: number;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-spectre-gunship-update');
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
    const initialTargetPosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const overrideTargetDestination = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const satellitePosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const status = parseSourceSpectreGunshipStatusBytes(xferLoad.xferUser(new Uint8Array(4)));
    const orbitEscapeFrame = xferLoad.xferUnsignedInt(0);
    if (version < 2) {
      return null;
    }
    const gattlingTargetPosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const positionToShootAt = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const okToFireHowitzerCounter = xferLoad.xferUnsignedInt(0);
    const gattlingId = xferLoad.xferObjectID(0);
    return xferLoad.getRemaining() === 0
      ? {
        initialTargetPosition,
        overrideTargetDestination,
        satellitePosition,
        status,
        orbitEscapeFrame,
        gattlingTargetPosition,
        positionToShootAt,
        okToFireHowitzerCounter,
        gattlingId,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourceSpectreGunshipUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState?: {
    initialTargetPosition: { x: number; y: number; z: number };
    overrideTargetDestination: { x: number; y: number; z: number };
    satellitePosition: { x: number; y: number; z: number };
    status: 'INSERTING' | 'ORBITING' | 'DEPARTING' | 'IDLE';
    orbitEscapeFrame: number;
    gattlingTargetPosition: { x: number; y: number; z: number };
    positionToShootAt: { x: number; y: number; z: number };
    okToFireHowitzerCounter: number;
    gattlingId: number;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-spectre-gunship-update');
  try {
    const state = entity.spectreGunshipState;
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferCoord3D({
      x: state?.initialTargetX ?? preservedState?.initialTargetPosition.x ?? 0,
      y: state?.initialTargetZ ?? preservedState?.initialTargetPosition.y ?? 0,
      z: state?.initialTargetY ?? preservedState?.initialTargetPosition.z ?? 0,
    });
    saver.xferCoord3D({
      x: state?.overrideTargetX ?? preservedState?.overrideTargetDestination.x ?? 0,
      y: state?.overrideTargetZ ?? preservedState?.overrideTargetDestination.y ?? 0,
      z: state?.overrideTargetY ?? preservedState?.overrideTargetDestination.z ?? 0,
    });
    saver.xferCoord3D({
      x: state?.satelliteX ?? preservedState?.satellitePosition.x ?? 0,
      y: state?.satelliteZ ?? preservedState?.satellitePosition.y ?? 0,
      z: state?.satelliteY ?? preservedState?.satellitePosition.z ?? entity.y ?? 0,
    });
    saver.xferUser(buildSourceSpectreGunshipStatusBytes(state?.status ?? preservedState?.status ?? 'IDLE'));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.orbitEscapeFrame ?? preservedState?.orbitEscapeFrame ?? 0)));
    saver.xferCoord3D({
      x: state?.gattlingTargetX ?? preservedState?.gattlingTargetPosition.x ?? 0,
      y: state?.gattlingTargetZ ?? preservedState?.gattlingTargetPosition.y ?? 0,
      z: state?.gattlingTargetY ?? preservedState?.gattlingTargetPosition.z ?? 0,
    });
    saver.xferCoord3D({
      x: state?.positionToShootAtX ?? preservedState?.positionToShootAt.x ?? 0,
      y: state?.positionToShootAtZ ?? preservedState?.positionToShootAt.y ?? 0,
      z: state?.positionToShootAtY ?? preservedState?.positionToShootAt.z ?? 0,
    });
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.okToFireHowitzerCounter ?? preservedState?.okToFireHowitzerCounter ?? 0)));
    saver.xferObjectID(Math.max(0, Math.trunc(state?.gattlingEntityId ?? preservedState?.gattlingId ?? 0)));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function tryParseSourcePointDefenseLaserUpdateBlockData(
  data: Uint8Array,
): { bestTargetId: number; inRange: boolean } | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-point-defense-laser-update');
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
    const bestTargetId = xferLoad.xferObjectID(0);
    const inRange = xferLoad.xferBool(false);
    xferLoad.xferInt(0);
    xferLoad.xferInt(0);
    return xferLoad.getRemaining() === 0 ? { bestTargetId, inRange } : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function buildSourcePointDefenseLaserUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: { bestTargetId: number; inRange: boolean },
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-point-defense-laser-update');
  try {
    const nextScanFrames = entity.pdlNextScanFrame > currentFrame
      ? Math.trunc(entity.pdlNextScanFrame - currentFrame)
      : 0;
    const nextShotAvailableInFrames = entity.pdlNextShotFrame > currentFrame
      ? Math.trunc(entity.pdlNextShotFrame - currentFrame)
      : 0;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(currentFrame + 1),
    ));
    saver.xferObjectID(normalizeSourceObjectId(entity.pdlBestTargetId ?? preservedState.bestTargetId));
    saver.xferBool(typeof entity.pdlInRange === 'boolean' ? entity.pdlInRange : preservedState.inRange);
    saver.xferInt(nextScanFrames);
    saver.xferInt(nextShotAvailableInFrames);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function createDefaultSourcePointDefenseLaserUpdateBlockState(): { bestTargetId: number; inRange: boolean } {
  return {
    bestTargetId: 0,
    inRange: false,
  };
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

function parseSourceRawInt32Bytes(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(0, true);
}

function tryParseSourceNeutronMissileUpdateBlockData(
  data: Uint8Array,
): {
  attachWeaponSlot: number;
  attachSpecificBarrelToUse: number;
  accel: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  stateTimestamp: number;
  exhaustSystemTemplateName: string;
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
    const attachWeaponSlot = parseSourceRawInt32Bytes(xferLoad.xferUser(new Uint8Array(4)));
    const attachSpecificBarrelToUse = xferLoad.xferInt(0);
    const accel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const vel = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const stateTimestamp = xferLoad.xferUnsignedInt(0);
    xferLoad.xferBool(false);
    xferLoad.xferBool(false);
    xferLoad.xferReal(0);
    xferLoad.xferBool(false);
    xferLoad.xferUnsignedInt(0);
    xferLoad.xferReal(0);
    const exhaustSystemTemplateName = xferLoad.xferAsciiString('');
    return xferLoad.getRemaining() === 0
      ? {
        attachWeaponSlot,
        attachSpecificBarrelToUse,
        accel,
        vel,
        stateTimestamp,
        exhaustSystemTemplateName,
      }
      : null;
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
    attachWeaponSlot: number;
    attachSpecificBarrelToUse: number;
    accel: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    stateTimestamp: number;
    exhaustSystemTemplateName: string;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-neutron-missile-update');
  try {
    const state = entity.neutronMissileUpdateState;
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame((state?.state ?? 'PRELAUNCH') !== 'DEAD' ? currentFrame + 1 : SOURCE_FRAME_FOREVER),
    ));
    saver.xferUser(
      sourceNeutronMissileStateToInt(state?.state ?? 'PRELAUNCH'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferCoord3D({
      x: state?.targetX ?? 0,
      y: state?.targetZ ?? 0,
      z: state?.targetY ?? 0,
    });
    saver.xferCoord3D({
      x: state?.intermedX ?? 0,
      y: state?.intermedZ ?? 0,
      z: state?.intermedY ?? 0,
    });
    saver.xferObjectID(Math.max(0, Math.trunc(state?.launcherId ?? 0)));
    saver.xferUser(buildSourceRawInt32Bytes(
      Math.trunc(state?.attachWeaponSlot ?? preservedState?.attachWeaponSlot ?? 0),
    ));
    saver.xferInt(Math.trunc(state?.attachSpecificBarrelToUse ?? preservedState?.attachSpecificBarrelToUse ?? 0));
    saver.xferCoord3D({
      x: state?.accelX ?? preservedState?.accel.x ?? 0,
      y: state?.accelZ ?? preservedState?.accel.y ?? 0,
      z: state?.accelY ?? preservedState?.accel.z ?? 0,
    });
    saver.xferCoord3D({
      x: state?.velX ?? preservedState?.vel.x ?? 0,
      y: state?.velZ ?? preservedState?.vel.y ?? 0,
      z: state?.velY ?? preservedState?.vel.z ?? 0,
    });
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.stateTimestamp ?? preservedState?.stateTimestamp ?? 0)));
    saver.xferBool(state?.isLaunched === true);
    saver.xferBool(state?.isArmed === true);
    saver.xferReal(state?.noTurnDistLeft ?? 0);
    saver.xferBool(state?.reachedIntermediatePos === true);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.frameAtLaunch ?? 0)));
    saver.xferReal(state?.heightAtLaunch ?? 0);
    // Source parity: RadiusDecal::xferRadiusDecal is currently a no-op, then
    // NeutronMissileUpdate::xfer writes m_exhaustSysTmpl's template name.
    saver.xferAsciiString(preservedState?.exhaustSystemTemplateName ?? '');
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
  currentFrame: number,
  deactivateFrame: number,
  liveState?: {
    currentlyActive?: boolean;
    resetTimersNextUpdate?: boolean;
    disabledUntilFrame?: number;
  } | null,
  preservedState?: {
    currentlyActive: boolean;
    resetTimersNextUpdate: boolean;
    disabledUntilFrame: number;
  } | null,
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-spy-vision-update');
  try {
    const currentlyActive = liveState?.currentlyActive ?? preservedState?.currentlyActive ?? false;
    const resetTimersNextUpdate = liveState?.resetTimersNextUpdate ?? preservedState?.resetTimersNextUpdate ?? false;
    const disabledUntilFrame = Math.max(
      0,
      Math.trunc(liveState?.disabledUntilFrame ?? preservedState?.disabledUntilFrame ?? 0),
    );
    const nextCallFrame = resetTimersNextUpdate
      ? (disabledUntilFrame > currentFrame ? disabledUntilFrame : currentFrame + 1)
      : (currentlyActive && deactivateFrame > currentFrame ? deactivateFrame : SOURCE_FRAME_FOREVER);
    saver.xferVersion(2);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(deactivateFrame)));
    saver.xferBool(currentlyActive);
    saver.xferBool(resetTimersNextUpdate);
    saver.xferUnsignedInt(disabledUntilFrame);
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
    const ownsSpecialObjects = typeof profile?.specialObject === 'string'
      && profile.specialObject.trim().length > 0;
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
    saver.xferInt(Math.trunc(ownsSpecialObjects ? (preservedState?.locationCount ?? 0) : 0));
    saver.xferObjectIDList(ownsSpecialObjects ? (preservedState?.specialObjectIdList ?? []) : []);
    saver.xferUnsignedInt(Math.max(0, Math.trunc(ownsSpecialObjects ? (preservedState?.specialObjectEntries ?? 0) : 0)));
    saver.xferBool(state?.noTargetCommand === true);
    saver.xferUser(
      sourceSpecialAbilityPackingStateToInt(state?.packingState ?? 'NONE'),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferBool(state?.facingInitiated ?? preservedState?.facingInitiated ?? false);
    saver.xferBool(state?.facingComplete ?? preservedState?.facingComplete ?? false);
    saver.xferBool(state?.withinStartAbilityRange === true);
    saver.xferBool(state?.doDisableFxParticles ?? preservedState?.doDisableFxParticles ?? true);
    saver.xferReal(
      Number.isFinite(state?.captureFlashPhase)
        ? state!.captureFlashPhase
        : (preservedState?.captureFlashPhase ?? 0),
    );
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
  angularVelocity: number;
  angularAcceleration: number;
  toppleDirection: { x: number; y: number; z: number };
  toppleState: number;
  angularAccumulation: number;
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
    const angularVelocity = xferLoad.xferReal(0);
    const angularAcceleration = xferLoad.xferReal(0);
    const toppleDirection = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const toppleState = xferLoad.xferInt(0);
    const angularAccumulation = xferLoad.xferReal(0);
    const angleDeltaX = xferLoad.xferReal(0);
    const numAngleDeltaX = xferLoad.xferInt(0);
    const doBounceFx = xferLoad.xferBool(false);
    const options = xferLoad.xferUnsignedInt(0);
    const stumpId = xferLoad.xferObjectID(0);
    return xferLoad.getRemaining() === 0
      ? {
          angularVelocity,
          angularAcceleration,
          toppleDirection,
          toppleState,
          angularAccumulation,
          angleDeltaX,
          numAngleDeltaX,
          doBounceFx,
          options,
          stumpId,
        }
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
    angularVelocity: number;
    angularAcceleration: number;
    toppleDirection: { x: number; y: number; z: number };
    toppleState: number;
    angularAccumulation: number;
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
    saver.xferReal(sourcePhysicsFinite(entity.toppleAngularVelocity, preservedState?.angularVelocity ?? 0));
    saver.xferReal(sourcePhysicsFinite(
      entity.toppleAngularAcceleration,
      preservedState?.angularAcceleration ?? ((profile?.initialAccelPercent ?? 0) * entity.toppleSpeed),
    ));
    saver.xferCoord3D({
      x: sourcePhysicsFinite(entity.toppleDirX, preservedState?.toppleDirection.x ?? 0),
      y: sourcePhysicsFinite(entity.toppleDirZ, preservedState?.toppleDirection.y ?? 0),
      z: sourcePhysicsFinite(entity.toppleDirectionSourceZ, preservedState?.toppleDirection.z ?? 0),
    });
    saver.xferUser(
      sourceToppleStateToInt(entity.toppleState),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferReal(sourcePhysicsFinite(entity.toppleAngularAccumulation, preservedState?.angularAccumulation ?? 0));
    saver.xferReal(sourcePhysicsFinite(entity.toppleAngleDeltaX, preservedState?.angleDeltaX ?? 0));
    saver.xferInt(Math.trunc(sourcePhysicsFinite(entity.toppleNumAngleDeltaX, preservedState?.numAngleDeltaX ?? 0)));
    saver.xferBool(typeof entity.toppleDoBounceFx === 'boolean'
      ? entity.toppleDoBounceFx
      : (preservedState?.doBounceFx ?? false));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(sourcePhysicsFinite(
      entity.toppleOptions,
      preservedState?.options ?? 0,
    ))));
    saver.xferObjectID(normalizeSourceObjectId(entity.toppleStumpId ?? preservedState?.stumpId ?? 0));
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
  toppleFrame: number;
  toppleDirX: number;
  toppleDirZ: number;
  toppleState: number;
  toppleVelocity: number;
  accumulatedAngle: number;
  structuralIntegrity: number;
  lastCrushedLocation: number;
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
    const toppleFrame = xferLoad.xferUnsignedInt(0);
    const toppleDirX = xferLoad.xferReal(0);
    const toppleDirZ = xferLoad.xferReal(0);
    const toppleState = xferLoad.xferInt(0);
    const toppleVelocity = xferLoad.xferReal(0);
    const accumulatedAngle = xferLoad.xferReal(0);
    const structuralIntegrity = xferLoad.xferReal(0);
    const lastCrushedLocation = xferLoad.xferReal(0);
    const nextBurstFrame = xferLoad.xferInt(0);
    const delayBurstLocation = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    return xferLoad.getRemaining() === 0
      ? {
          toppleFrame,
          toppleDirX,
          toppleDirZ,
          toppleState,
          toppleVelocity,
          accumulatedAngle,
          structuralIntegrity,
          lastCrushedLocation,
          nextBurstFrame,
          delayBurstLocation,
        }
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
    toppleFrame: number;
    toppleDirX: number;
    toppleDirZ: number;
    toppleState: number;
    toppleVelocity: number;
    accumulatedAngle: number;
    structuralIntegrity: number;
    lastCrushedLocation: number;
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
        ? {
            x: state.delayBurstLocation.x,
            y: state.delayBurstLocation.z,
            z: state.delayBurstLocation.y,
          }
        : (preservedState?.delayBurstLocation ?? { x: 0, y: 0, z: 0 });
    saver.xferVersion(1);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(
      buildSourceUpdateModuleWakeFrame(nextCallFrame),
    ));
    saver.xferUnsignedInt(Math.max(0, Math.trunc(state?.toppleFrame ?? preservedState?.toppleFrame ?? 0)));
    saver.xferReal(sourcePhysicsFinite(state?.toppleDirX, preservedState?.toppleDirX ?? 0));
    saver.xferReal(sourcePhysicsFinite(state?.toppleDirZ, preservedState?.toppleDirZ ?? 0));
    saver.xferUser(
      state
        ? sourceStructureToppleStateToInt(state.state)
        : Math.max(0, Math.trunc(preservedState?.toppleState ?? 0)),
      (xfer, value) => { xfer.xferInt(value); },
      (xfer) => xfer.xferInt(0),
    );
    saver.xferReal(sourcePhysicsFinite(state?.toppleVelocity, preservedState?.toppleVelocity ?? 0));
    saver.xferReal(sourcePhysicsFinite(state?.accumulatedAngle, preservedState?.accumulatedAngle ?? 0.001));
    saver.xferReal(sourcePhysicsFinite(state?.structuralIntegrity, preservedState?.structuralIntegrity ?? 0));
    saver.xferReal(sourcePhysicsFinite(state?.lastCrushedLocation, preservedState?.lastCrushedLocation ?? 0));
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

const SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES = 16;

interface SourceParticleUplinkVisualState {
  outerSystemIds: number[];
  laserBeamIds: number[];
  groundToOrbitBeamId: number;
  orbitToTargetBeamId: number;
  connectorSystemId: number;
  laserBaseSystemId: number;
  outerNodePositions: Coord3D[];
  outerNodeOrientations: number[][];
  connectorNodePosition: Coord3D;
  laserOriginPosition: Coord3D;
  overrideTargetDestination: Coord3D;
  upBonesCached: boolean;
  defaultInfoCached: boolean;
  invalidSettings: boolean;
}

function xferSourceParticleUplinkIdArray(xfer: Xfer, values: readonly number[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES; index += 1) {
    result.push(xfer.xferUnsignedInt(Math.max(0, Math.trunc(values[index] ?? 0))));
  }
  return result;
}

function xferSourceParticleUplinkCoordArray(xfer: Xfer, values: readonly Coord3D[]): Coord3D[] {
  const result: Coord3D[] = [];
  for (let index = 0; index < SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES; index += 1) {
    result.push(xfer.xferCoord3D(values[index] ?? { x: 0, y: 0, z: 0 }));
  }
  return result;
}

function xferSourceRawMatrix3D(xfer: Xfer, values: readonly number[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    result.push(xfer.xferReal(values[index] ?? (index === 0 || index === 5 || index === 10 ? 1 : 0)));
  }
  return result;
}

function xferSourceParticleUplinkMatrixArray(xfer: Xfer, values: readonly number[][]): number[][] {
  const result: number[][] = [];
  for (let index = 0; index < SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES; index += 1) {
    result.push(xferSourceRawMatrix3D(xfer, values[index] ?? []));
  }
  return result;
}

function xferSourceParticleUplinkVisualState(
  xfer: Xfer,
  state: SourceParticleUplinkVisualState,
): SourceParticleUplinkVisualState {
  const outerSystemIds = xferSourceParticleUplinkIdArray(xfer, state.outerSystemIds);
  const laserBeamIds = xferSourceParticleUplinkIdArray(xfer, state.laserBeamIds);
  const groundToOrbitBeamId = xfer.xferUnsignedInt(Math.max(0, Math.trunc(state.groundToOrbitBeamId)));
  const orbitToTargetBeamId = xfer.xferUnsignedInt(Math.max(0, Math.trunc(state.orbitToTargetBeamId)));
  const connectorSystemId = xfer.xferUnsignedInt(Math.max(0, Math.trunc(state.connectorSystemId)));
  const laserBaseSystemId = xfer.xferUnsignedInt(Math.max(0, Math.trunc(state.laserBaseSystemId)));
  const outerNodePositions = xferSourceParticleUplinkCoordArray(xfer, state.outerNodePositions);
  const outerNodeOrientations = xferSourceParticleUplinkMatrixArray(xfer, state.outerNodeOrientations);
  return {
    outerSystemIds,
    laserBeamIds,
    groundToOrbitBeamId,
    orbitToTargetBeamId,
    connectorSystemId,
    laserBaseSystemId,
    outerNodePositions,
    outerNodeOrientations,
    connectorNodePosition: xfer.xferCoord3D(state.connectorNodePosition),
    laserOriginPosition: xfer.xferCoord3D(state.laserOriginPosition),
    overrideTargetDestination: xfer.xferCoord3D(state.overrideTargetDestination),
    upBonesCached: xfer.xferBool(state.upBonesCached),
    defaultInfoCached: xfer.xferBool(state.defaultInfoCached),
    invalidSettings: xfer.xferBool(state.invalidSettings),
  };
}

function createDefaultSourceParticleUplinkVisualState(): SourceParticleUplinkVisualState {
  return {
    outerSystemIds: new Array<number>(SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES).fill(0),
    laserBeamIds: new Array<number>(SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES).fill(0),
    groundToOrbitBeamId: 0,
    orbitToTargetBeamId: 0,
    connectorSystemId: 0,
    laserBaseSystemId: 0,
    outerNodePositions: Array.from(
      { length: SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES },
      () => ({ x: 0, y: 0, z: 0 }),
    ),
    outerNodeOrientations: Array.from(
      { length: SOURCE_PARTICLE_UPLINK_MAX_OUTER_NODES },
      () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    ),
    connectorNodePosition: { x: 0, y: 0, z: 0 },
    laserOriginPosition: { x: 0, y: 0, z: 0 },
    overrideTargetDestination: { x: 0, y: 0, z: 0 },
    upBonesCached: false,
    defaultInfoCached: false,
    invalidSettings: false,
  };
}

function buildSourceRawInt32Bytes(value: number): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-raw-int32-bytes');
  try {
    saver.xferInt(Math.trunc(value));
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function sourceParticleUplinkStatusToInt(
  status: 'IDLE' | 'CHARGING' | 'PREPARING' | 'ALMOST_READY' | 'READY' | 'PREFIRE' | 'FIRING' | 'POSTFIRE' | 'PACKING',
): number {
  switch (status) {
    case 'IDLE': return 0;
    case 'CHARGING': return 1;
    case 'PREPARING': return 2;
    case 'ALMOST_READY': return 3;
    case 'READY': return 4;
    case 'PREFIRE': return 5;
    case 'FIRING': return 6;
    case 'POSTFIRE': return 7;
    case 'PACKING': return 8;
  }
}

function sourceParticleUplinkLaserStatusToInt(
  status: 'NONE' | 'BORN' | 'DECAYING' | 'DEAD',
): number {
  switch (status) {
    case 'NONE': return 0;
    case 'BORN': return 1;
    case 'DECAYING': return 2;
    case 'DEAD': return 3;
  }
}

function tryParseSourceParticleUplinkCannonUpdateBlockData(
  data: Uint8Array,
): {
  version: number;
  nextCallFrameAndPhase: number;
  statusBytes: Uint8Array;
  laserStatusBytes: Uint8Array;
  frames: number;
  visualState: SourceParticleUplinkVisualState;
  initialTargetPosition: { x: number; y: number; z: number };
  currentTargetPosition: { x: number; y: number; z: number };
  scorchMarksMade: number;
  nextScorchMarkFrame: number;
  nextLaunchFXFrame: number;
  damagePulsesMade: number;
  nextDamagePulseFrame: number;
  startAttackFrame: number;
  startDecayFrame: number;
  lastDrivingClickFrame: number;
  secondLastDrivingClickFrame: number;
  manualTargetMode: boolean;
  scriptedWaypointMode: boolean;
  nextDestWaypointID: number;
} | null {
  const xferLoad = new XferLoad(copyBytesToArrayBuffer(data));
  xferLoad.open('parse-source-particle-uplink-cannon-update');
  try {
    const version = xferLoad.xferVersion(3);
    if (version < 1 || version > 3) {
      return null;
    }
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    xferLoad.xferVersion(1);
    const nextCallFrameAndPhase = xferLoad.xferUnsignedInt(0);
    const statusBytes = xferLoad.xferUser(new Uint8Array(4));
    const laserStatusBytes = xferLoad.xferUser(new Uint8Array(4));
    const frames = xferLoad.xferUnsignedInt(0);
    const visualState = xferSourceParticleUplinkVisualState(
      xferLoad,
      createDefaultSourceParticleUplinkVisualState(),
    );
    const initialTargetPosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const currentTargetPosition = xferLoad.xferCoord3D({ x: 0, y: 0, z: 0 });
    const scorchMarksMade = xferLoad.xferUnsignedInt(0);
    const nextScorchMarkFrame = xferLoad.xferUnsignedInt(0);
    const nextLaunchFXFrame = xferLoad.xferUnsignedInt(0);
    const damagePulsesMade = xferLoad.xferUnsignedInt(0);
    const nextDamagePulseFrame = xferLoad.xferUnsignedInt(0);
    const startAttackFrame = xferLoad.xferUnsignedInt(0);
    const startDecayFrame = version >= 2 ? xferLoad.xferUnsignedInt(0) : 0;
    const lastDrivingClickFrame = xferLoad.xferUnsignedInt(0);
    const secondLastDrivingClickFrame = xferLoad.xferUnsignedInt(0);
    const manualTargetMode = version >= 3 ? xferLoad.xferBool(false) : false;
    const scriptedWaypointMode = version >= 3 ? xferLoad.xferBool(false) : false;
    const nextDestWaypointID = version >= 3 ? xferLoad.xferUnsignedInt(0) : 0;
    return xferLoad.getRemaining() === 0
      ? {
        version,
        nextCallFrameAndPhase,
        statusBytes,
        laserStatusBytes,
        frames,
        visualState,
        initialTargetPosition,
        currentTargetPosition,
        scorchMarksMade,
        nextScorchMarkFrame,
        nextLaunchFXFrame,
        damagePulsesMade,
        nextDamagePulseFrame,
        startAttackFrame,
        startDecayFrame,
        lastDrivingClickFrame,
        secondLastDrivingClickFrame,
        manualTargetMode,
        scriptedWaypointMode,
        nextDestWaypointID,
      }
      : null;
  } catch {
    return null;
  } finally {
    xferLoad.close();
  }
}

function createDefaultSourceParticleUplinkCannonUpdateBlockState(): {
  version: number;
  nextCallFrameAndPhase: number;
  statusBytes: Uint8Array;
  laserStatusBytes: Uint8Array;
  frames: number;
  visualState: SourceParticleUplinkVisualState;
  initialTargetPosition: { x: number; y: number; z: number };
  currentTargetPosition: { x: number; y: number; z: number };
  scorchMarksMade: number;
  nextScorchMarkFrame: number;
  nextLaunchFXFrame: number;
  damagePulsesMade: number;
  nextDamagePulseFrame: number;
  startAttackFrame: number;
  startDecayFrame: number;
  lastDrivingClickFrame: number;
  secondLastDrivingClickFrame: number;
  manualTargetMode: boolean;
  scriptedWaypointMode: boolean;
  nextDestWaypointID: number;
} {
  return {
    version: 3,
    nextCallFrameAndPhase: 0,
    statusBytes: buildSourceRawInt32Bytes(sourceParticleUplinkStatusToInt('IDLE')),
    laserStatusBytes: buildSourceRawInt32Bytes(sourceParticleUplinkLaserStatusToInt('NONE')),
    frames: 0,
    visualState: createDefaultSourceParticleUplinkVisualState(),
    initialTargetPosition: { x: 0, y: 0, z: 0 },
    currentTargetPosition: { x: 0, y: 0, z: 0 },
    scorchMarksMade: 0,
    nextScorchMarkFrame: 0,
    nextLaunchFXFrame: 0,
    damagePulsesMade: 0,
    nextDamagePulseFrame: 0,
    startAttackFrame: 0,
    startDecayFrame: 0,
    lastDrivingClickFrame: 0,
    secondLastDrivingClickFrame: 0,
    manualTargetMode: false,
    scriptedWaypointMode: false,
    nextDestWaypointID: 0,
  };
}

function buildSourceParticleUplinkCannonUpdateBlockData(
  entity: MapEntity,
  currentFrame: number,
  preservedState: {
    version: number;
    nextCallFrameAndPhase: number;
    statusBytes: Uint8Array;
    laserStatusBytes: Uint8Array;
    frames: number;
    visualState: SourceParticleUplinkVisualState;
    initialTargetPosition: { x: number; y: number; z: number };
    currentTargetPosition: { x: number; y: number; z: number };
    scorchMarksMade: number;
    nextScorchMarkFrame: number;
    nextLaunchFXFrame: number;
    damagePulsesMade: number;
    nextDamagePulseFrame: number;
    startAttackFrame: number;
    startDecayFrame: number;
    lastDrivingClickFrame: number;
    secondLastDrivingClickFrame: number;
    manualTargetMode: boolean;
    scriptedWaypointMode: boolean;
    nextDestWaypointID: number;
  },
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-particle-uplink-cannon-update');
  try {
    const state = entity.particleUplinkCannonState;
    const isActivelyOwnedStatus = state
      && state.status !== 'IDLE';
    const version = Math.max(1, Math.min(3, Math.trunc(preservedState.version || 3)));
    const nextCallFrameAndPhase = isActivelyOwnedStatus
      ? buildSourceUpdateModuleWakeFrame(currentFrame + 1)
      : preservedState.nextCallFrameAndPhase;
    const statusBytes = isActivelyOwnedStatus
      ? buildSourceRawInt32Bytes(sourceParticleUplinkStatusToInt(state!.status))
      : preservedState.statusBytes;
    const laserStatusBytes = isActivelyOwnedStatus
      ? buildSourceRawInt32Bytes(sourceParticleUplinkLaserStatusToInt(state?.laserStatus ?? 'NONE'))
      : preservedState.laserStatusBytes;
    const frames = isActivelyOwnedStatus
      ? Math.max(0, Math.trunc(state?.framesInState ?? 0))
      : preservedState.frames;
    const initialTargetPosition = Number.isFinite(state?.targetX) || Number.isFinite(state?.targetZ)
      ? {
        x: Number.isFinite(state?.targetX) ? state!.targetX : preservedState.initialTargetPosition.x,
        y: Number.isFinite(state?.targetZ) ? state!.targetZ : preservedState.initialTargetPosition.y,
        z: Number.isFinite(state?.targetY) ? state!.targetY! : preservedState.initialTargetPosition.z,
      }
      : preservedState.initialTargetPosition;
    const currentTargetPosition = Number.isFinite(state?.currentTargetX) || Number.isFinite(state?.currentTargetZ)
      ? {
        x: Number.isFinite(state?.currentTargetX) ? state!.currentTargetX : preservedState.currentTargetPosition.x,
        y: Number.isFinite(state?.currentTargetZ) ? state!.currentTargetZ : preservedState.currentTargetPosition.y,
        z: Number.isFinite(state?.currentTargetY) ? state!.currentTargetY! : preservedState.currentTargetPosition.z,
      }
      : preservedState.currentTargetPosition;
    const damagePulsesMade = Number.isFinite(state?.damagePulsesMade)
      ? Math.max(0, Math.trunc(state!.damagePulsesMade))
      : preservedState.damagePulsesMade;
    const nextDamagePulseFrame = Number.isFinite(state?.nextDamagePulseFrame)
      ? Math.max(0, Math.trunc(state!.nextDamagePulseFrame))
      : preservedState.nextDamagePulseFrame;
    const scorchMarksMade = Number.isFinite(state?.scorchMarksMade)
      ? Math.max(0, Math.trunc(state!.scorchMarksMade))
      : preservedState.scorchMarksMade;
    const nextScorchMarkFrame = Number.isFinite(state?.nextScorchMarkFrame)
      ? Math.max(0, Math.trunc(state!.nextScorchMarkFrame))
      : preservedState.nextScorchMarkFrame;
    const nextLaunchFXFrame = Number.isFinite(state?.nextLaunchFXFrame)
      ? Math.max(0, Math.trunc(state!.nextLaunchFXFrame))
      : preservedState.nextLaunchFXFrame;
    const startAttackFrame = Number.isFinite(state?.startAttackFrame)
      ? Math.max(0, Math.trunc(state!.startAttackFrame))
      : preservedState.startAttackFrame;
    const startDecayFrame = Number.isFinite(state?.startDecayFrame)
      ? Math.max(0, Math.trunc(state!.startDecayFrame))
      : preservedState.startDecayFrame;
    const lastDrivingClickFrame = Number.isFinite(state?.lastDrivingClickFrame)
      ? Math.max(0, Math.trunc(state!.lastDrivingClickFrame))
      : preservedState.lastDrivingClickFrame;
    const secondLastDrivingClickFrame = Number.isFinite(state?.secondLastDrivingClickFrame)
      ? Math.max(0, Math.trunc(state!.secondLastDrivingClickFrame))
      : preservedState.secondLastDrivingClickFrame;
    const manualTargetMode = typeof state?.manualTargetMode === 'boolean'
      ? state.manualTargetMode
      : preservedState.manualTargetMode;
    const scriptedWaypointMode = typeof state?.scriptedWaypointMode === 'boolean'
      ? state.scriptedWaypointMode
      : preservedState.scriptedWaypointMode;
    const nextDestWaypointID = Number.isFinite(state?.nextDestWaypointID)
      ? Math.max(0, Math.trunc(state!.nextDestWaypointID))
      : preservedState.nextDestWaypointID;

    saver.xferVersion(version);
    saver.xferUser(buildSourceUpdateModuleBaseBlockData(nextCallFrameAndPhase));
    saver.xferUser(statusBytes);
    saver.xferUser(laserStatusBytes);
    saver.xferUnsignedInt(frames);
    xferSourceParticleUplinkVisualState(saver, preservedState.visualState);
    saver.xferCoord3D(initialTargetPosition);
    saver.xferCoord3D(currentTargetPosition);
    saver.xferUnsignedInt(scorchMarksMade);
    saver.xferUnsignedInt(nextScorchMarkFrame);
    saver.xferUnsignedInt(nextLaunchFXFrame);
    saver.xferUnsignedInt(damagePulsesMade);
    saver.xferUnsignedInt(nextDamagePulseFrame);
    saver.xferUnsignedInt(startAttackFrame);
    if (version >= 2) {
      saver.xferUnsignedInt(startDecayFrame);
    }
    saver.xferUnsignedInt(lastDrivingClickFrame);
    saver.xferUnsignedInt(secondLastDrivingClickFrame);
    if (version >= 3) {
      saver.xferBool(manualTargetMode);
      saver.xferBool(scriptedWaypointMode);
      saver.xferUnsignedInt(nextDestWaypointID);
    }
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
      y: state?.ejectZ ?? 0,
      z: state?.ejectY ?? 0,
    });
    saver.xferBool(typeof state?.update === 'boolean' ? state.update : state !== null);
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
  liveEntities: readonly MapEntity[],
  currentFrame: number,
  coreState?: GameLogicCoreSaveState | null,
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
          const parsedCreateModuleState = tryParseSourceCreateModuleBlockData(module.blockData, moduleType);
          if (parsedCreateModuleState) {
            const liveCreateModuleState = findLiveSourceCreateModuleState(entity, moduleType, module.identifier);
            return {
              identifier: module.identifier,
              blockData: buildSourceCreateModuleBlockData(
                liveCreateModuleState?.needToRunOnBuildComplete
                  ?? parsedCreateModuleState.needToRunOnBuildComplete,
              ),
            };
          }
          const parsedBodyState = tryParseSourceBodyModuleBlockData(module.blockData, moduleType);
          if (parsedBodyState) {
            return {
              identifier: module.identifier,
              blockData: buildSourceBodyModuleBlockData(entity, moduleType, parsedBodyState),
            };
          }
          const parsedSpecialPowerState = tryParseSourceSpecialPowerModuleBlockData(module.blockData, moduleType);
          if (parsedSpecialPowerState) {
            const liveSpecialPowerModule = findLiveSourceSpecialPowerModule(
              entity,
              moduleType,
              module.identifier,
            );
            if (liveSpecialPowerModule) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSpecialPowerModuleBlockData(
                  moduleType,
                  parsedSpecialPowerState,
                  liveSpecialPowerModule,
                ),
              };
            }
          }
          const parsedContainState = tryParseSourceContainModuleBlockData(module.blockData, moduleType);
          if (parsedContainState) {
            return {
              identifier: module.identifier,
              blockData: buildSourceContainModuleBlockData(
                entity,
                moduleType,
                liveEntities,
                parsedContainState,
              ),
            };
          }
          const parsedUpgradeModuleState = tryParseSourceUpgradeModuleBlockData(module.blockData, moduleType);
          if (parsedUpgradeModuleState) {
            const liveUpgradeModule = findLiveSourceUpgradeModule(entity, moduleType, module.identifier);
            if (liveUpgradeModule) {
              const upgradeExecuted = entity.executedUpgradeModules instanceof Set
                ? entity.executedUpgradeModules.has(liveUpgradeModule.id)
                : parsedUpgradeModuleState.upgradeExecuted;
              return {
                identifier: module.identifier,
                blockData: buildSourceUpgradeModuleBlockData(upgradeExecuted),
              };
            }
          }
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
            const hasFlag = typeof entity.hordeHasFlag === 'boolean'
              ? entity.hordeHasFlag
              : (parsedSourceState?.hasFlag ?? false);
            return {
              identifier: module.identifier,
              blockData: buildSourceHordeUpdateBlockData(
                entity,
                currentFrame,
                hasFlag,
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
                const upgradeExecuted = typeof state.upgradeExecuted === 'boolean'
                  ? state.upgradeExecuted
                  : parsedSourceState.upgradeExecuted;
                return {
                  identifier: module.identifier,
                  blockData: buildSourceFireOclAfterCooldownUpdateBlockData(
                    currentFrame,
                    upgradeExecuted,
                    state,
                  ),
                };
              }
            }
          }
          if (moduleType === 'FIREWEAPONWHENDEADBEHAVIOR' && entity.fireWeaponWhenDeadProfiles.length > 0) {
            const moduleTag = module.identifier.trim().toUpperCase();
            const moduleIndex = entity.fireWeaponWhenDeadProfiles.findIndex(
              (profile) => (profile.moduleTag ?? '') === moduleTag,
            );
            if (moduleIndex >= 0) {
              const parsedSourceState = tryParseSourceFireWeaponWhenDeadBehaviorBlockData(module.blockData);
              if (parsedSourceState) {
                return {
                  identifier: module.identifier,
                  blockData: buildSourceFireWeaponWhenDeadBehaviorBlockData(
                    sourceFireWeaponWhenDeadUpgradeExecuted(
                      entity,
                      moduleIndex,
                      parsedSourceState.upgradeExecuted,
                    ),
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
            const moduleTag = module.identifier.trim().toUpperCase();
            const liveModuleState = entity.radiusDecalModuleStates?.find(
              (state) => state.moduleTag === moduleTag,
            );
            const liveKillWhenNoLongerAttacking = entity.radiusDecalStates.some(
              (state) => state.killWhenNoLongerAttacking,
            );
            const killWhenNoLongerAttacking = liveModuleState
              ? liveModuleState.killWhenNoLongerAttacking
              : liveKillWhenNoLongerAttacking || (parsedSourceState?.killWhenNoLongerAttacking ?? false);
            return {
              identifier: module.identifier,
              blockData: buildSourceRadiusDecalUpdateBlockData(
                entity,
                currentFrame,
                killWhenNoLongerAttacking,
              ),
            };
          }
          if (moduleType === 'BASEREGENERATEUPDATE') {
            return {
              identifier: module.identifier,
              blockData: buildSourceBaseRegenerateUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'LIFETIMEUPDATE' && entity.lifetimeDieFrame !== null) {
            return {
              identifier: module.identifier,
              blockData: buildSourceLifetimeUpdateBlockData(entity),
            };
          }
          if (moduleType === 'DELETIONUPDATE' && entity.deletionDieFrame !== null) {
            return {
              identifier: module.identifier,
              blockData: buildSourceDeletionUpdateBlockData(entity),
            };
          }
          if (moduleType === 'HEIGHTDIEUPDATE' && entity.heightDieProfile) {
            const parsedSourceState = tryParseSourceHeightDieUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceHeightDieUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'STICKYBOMBUPDATE' && entity.stickyBombProfile) {
            const parsedSourceState = tryParseSourceStickyBombUpdateBlockData(module.blockData);
            return {
              identifier: module.identifier,
              blockData: buildSourceStickyBombUpdateBlockData(
                entity,
                currentFrame,
                parsedSourceState ?? createDefaultSourceStickyBombUpdateBlockState(),
              ),
            };
          }
          if (moduleType === 'CLEANUPHAZARDUPDATE' && entity.cleanupHazardProfile) {
            const parsedSourceState = tryParseSourceCleanupHazardUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceCleanupHazardUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'DEMOTRAPUPDATE' && entity.demoTrapProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceDemoTrapUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'COMMANDBUTTONHUNTUPDATE' && entity.commandButtonHuntProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceCommandButtonHuntUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'AUTODEPOSITUPDATE' && entity.autoDepositProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceAutoDepositUpdateBlockData(entity, currentFrame),
            };
          }
          if ((moduleType === 'DYNAMICSHROUDCLEARINGRANGEUPDATE' || moduleType === 'DYNAMICSHROUDCLEARINGRANGE')
            && entity.dynamicShroudProfile) {
            const parsedSourceState = tryParseSourceDynamicShroudClearingRangeUpdateBlockData(
              module.blockData,
            );
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDynamicShroudClearingRangeUpdateBlockData(entity, currentFrame),
              };
            }
          }
          if (moduleType === 'STEALTHUPDATE' && entity.stealthProfile) {
            const parsedSourceState = tryParseSourceStealthUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceStealthUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'STEALTHDETECTORUPDATE' && entity.detectorProfile) {
            const parsedSourceState = tryParseSourceStealthDetectorUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceStealthDetectorUpdateBlockData(entity, currentFrame),
              };
            }
          }
          if (moduleType === 'PHYSICSBEHAVIOR' && entity.physicsBehaviorState) {
            const parsedSourceState = tryParseSourcePhysicsBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourcePhysicsBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'RAILROADBEHAVIOR') {
            const parsedSourceState = tryParseSourceRailroadBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceRailroadBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'WAVEGUIDEUPDATE') {
            const parsedSourceState = tryParseSourceWaveGuideUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceWaveGuideUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'PROJECTILESTREAMUPDATE' && entity.projectileStreamState) {
            const parsedSourceState = tryParseSourceProjectileStreamUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceProjectileStreamUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'BONEFXUPDATE' && entity.boneFXState) {
            const parsedSourceState = tryParseSourceBoneFxUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBoneFxUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'FLAMMABLEUPDATE' && entity.flammableProfile) {
            const parsedSourceState = tryParseSourceFlammableUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceFlammableUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'FIRESPREADUPDATE' && entity.fireSpreadProfile) {
            const parsedSourceState = tryParseSourceFireSpreadUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceFireSpreadUpdateBlockData(entity),
              };
            }
          }
          if (moduleType === 'FIREWEAPONWHENDAMAGEDBEHAVIOR' && entity.fireWhenDamagedProfiles.length > 0) {
            const parsedSourceState = tryParseSourceFireWhenDamagedBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceFireWhenDamagedBlockData(
                entity,
                currentFrame,
                module.identifier,
                parsedSourceState,
              );
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'FIREWEAPONCOLLIDE' && entity.fireWeaponCollideProfiles.length > 0) {
            const parsedSourceState = tryParseSourceFireWeaponCollideBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceFireWeaponCollideBlockData(
                entity,
                module.identifier,
                parsedSourceState,
              );
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'FIREWEAPONUPDATE' && entity.fireWeaponUpdateProfiles.length > 0) {
            const parsedSourceState = tryParseSourceFireWeaponUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceFireWeaponUpdateBlockData(
                entity,
                currentFrame,
                module.identifier,
                parsedSourceState,
              );
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'POISONEDBEHAVIOR' && entity.poisonedBehaviorProfile) {
            const parsedSourceState = tryParseSourcePoisonedBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourcePoisonedBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'MINEFIELDBEHAVIOR' && entity.minefieldProfile) {
            const parsedSourceState = tryParseSourceMinefieldBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceMinefieldBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'GENERATEMINEFIELDBEHAVIOR' && entity.generateMinefieldProfile) {
            const parsedSourceState = tryParseSourceGenerateMinefieldBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceGenerateMinefieldBehaviorBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'SPAWNBEHAVIOR' && entity.spawnBehaviorState) {
            const parsedSourceState = tryParseSourceSpawnBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceSpawnBehaviorBlockData(entity, parsedSourceState);
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'SMARTBOMBTARGETHOMINGUPDATE' && entity.smartBombProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceSmartBombTargetHomingUpdateBlockData(currentFrame),
            };
          }
          if (moduleType === 'ANIMATIONSTEERINGUPDATE' && entity.animationSteeringProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceAnimationSteeringUpdateBlockData(currentFrame),
            };
          }
          if (moduleType === 'HACKINTERNETAIUPDATE') {
            const parsedSourceState = tryParseSourceHackInternetAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceHackInternetAIUpdateBlockData(entity, currentFrame, parsedSourceState);
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'JETAIUPDATE' && entity.jetAIState) {
            const parsedSourceState = tryParseSourceJetAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceJetAIUpdateBlockData(entity, parsedSourceState);
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'MISSILEAIUPDATE') {
            const parsedSourceState = tryParseSourceMissileAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceMissileAIUpdateBlockData(entity, parsedSourceState);
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'DELIVERPAYLOADAIUPDATE') {
            const parsedSourceState = tryParseSourceDeliverPayloadAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              const blockData = buildSourceDeliverPayloadAIUpdateBlockData(entity, parsedSourceState);
              if (blockData) {
                return {
                  identifier: module.identifier,
                  blockData,
                };
              }
            }
          }
          if (moduleType === 'DUMBPROJECTILEBEHAVIOR') {
            const parsedSourceState = tryParseSourceDumbProjectileBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDumbProjectileBehaviorBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'DEPLOYSTYLEAIUPDATE' && entity.deployStyleProfile) {
            const parsedSourceState = tryParseSourceDeployStyleAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDeployStyleAIUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'ASSAULTTRANSPORTAIUPDATE' && entity.assaultTransportProfile) {
            const parsedSourceState = tryParseSourceAssaultTransportAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceAssaultTransportAIUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'SUPPLYTRUCKAIUPDATE' && entity.supplyTruckProfile) {
            const parsedSourceState = tryParseSourceSupplyTruckAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSupplyTruckAIUpdateBlockData(entity, parsedSourceState, coreState),
              };
            }
          }
          if (moduleType === 'WORKERAIUPDATE' && entity.workerAIProfile) {
            const parsedSourceState = tryParseSourceWorkerAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceWorkerAIUpdateBlockData(entity, parsedSourceState, coreState),
              };
            }
          }
          if (moduleType === 'CHINOOKAIUPDATE' && entity.chinookAIProfile) {
            const parsedSourceState = tryParseSourceChinookAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceChinookAIUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'POWTRUCKAIUPDATE' && entity.powTruckAIProfile) {
            const parsedSourceState = tryParseSourcePOWTruckAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourcePOWTruckAIUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'DOZERAIUPDATE' && entity.dozerAIProfile) {
            const parsedSourceState = tryParseSourceDozerAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDozerAIUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'PARKINGPLACEBEHAVIOR' && entity.parkingPlaceProfile) {
            const parsedSourceState = tryParseSourceParkingPlaceBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceParkingPlaceBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'FLIGHTDECKBEHAVIOR' && entity.flightDeckProfile && entity.flightDeckState) {
            const parsedSourceState = tryParseSourceFlightDeckBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceFlightDeckBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'REBUILDHOLEBEHAVIOR' && entity.rebuildHoleProfile) {
            const parsedSourceState = tryParseSourceRebuildHoleBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceRebuildHoleBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'PROPAGANDATOWERBEHAVIOR' && entity.propagandaTowerProfile) {
            const parsedSourceState = tryParseSourcePropagandaTowerBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourcePropagandaTowerBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'BRIDGEBEHAVIOR' && entity.bridgeBehaviorProfile) {
            const parsedSourceState = tryParseSourceBridgeBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBridgeBehaviorBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'BRIDGETOWERBEHAVIOR' && entity.bridgeTowerProfile) {
            const parsedSourceState = tryParseSourceBridgeTowerBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBridgeTowerBehaviorBlockData(entity, parsedSourceState),
              };
            }
          }
          if (
            moduleType === 'SPECIALPOWERCOMPLETIONDIE'
            && entity.specialPowerCompletionDieProfiles.length > 0
          ) {
            const parsedSourceState = tryParseSourceSpecialPowerCompletionDieBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSpecialPowerCompletionDieBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'BRIDGESCAFFOLDBEHAVIOR' && entity.bridgeScaffoldState) {
            const parsedSourceState = tryParseSourceBridgeScaffoldBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBridgeScaffoldBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'TECHBUILDINGBEHAVIOR' && entity.techBuildingProfile) {
            const parsedSourceState = tryParseSourceBaseOnlyUpdateModuleBlockData(
              module.blockData,
              'tech-building-behavior',
            );
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBaseOnlyUpdateModuleBlockData(
                  'tech-building-behavior',
                  sourceTechBuildingNextWakeFrame(entity, currentFrame),
                ),
              };
            }
          }
          if (moduleType === 'BUNKERBUSTERBEHAVIOR' && entity.bunkerBusterProfile) {
            const parsedSourceState = tryParseSourceBaseOnlyUpdateModuleBlockData(
              module.blockData,
              'bunker-buster-behavior',
            );
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBaseOnlyUpdateModuleBlockData(
                  'bunker-buster-behavior',
                  currentFrame + 1,
                ),
              };
            }
          }
          if (moduleType === 'NEUTRONBLASTBEHAVIOR' && entity.neutronBlastProfile) {
            const parsedSourceState = tryParseSourceBaseOnlyUpdateModuleBlockData(
              module.blockData,
              'neutron-blast-behavior',
            );
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBaseOnlyUpdateModuleBlockData(
                  'neutron-blast-behavior',
                  SOURCE_FRAME_FOREVER,
                ),
              };
            }
          }
          if (moduleType === 'SLOWDEATHBEHAVIOR' && (entity.slowDeathProfiles?.length ?? 0) > 0) {
            const parsedSourceState = tryParseSourceSlowDeathBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSlowDeathBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'BATTLEBUSSLOWDEATHBEHAVIOR' && entity.battleBusSlowDeathProfile) {
            const parsedSourceState = tryParseSourceBattleBusSlowDeathBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBattleBusSlowDeathBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'HELICOPTERSLOWDEATHBEHAVIOR'
            && (entity.helicopterSlowDeathProfiles?.length ?? 0) > 0) {
            const parsedSourceState = tryParseSourceHelicopterSlowDeathBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceHelicopterSlowDeathBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'JETSLOWDEATHBEHAVIOR' && (entity.jetSlowDeathProfiles?.length ?? 0) > 0) {
            const parsedSourceState = tryParseSourceJetSlowDeathBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceJetSlowDeathBehaviorBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'NEUTRONMISSILESLOWDEATHBEHAVIOR' && entity.neutronMissileSlowDeathProfile) {
            const parsedSourceState = tryParseSourceNeutronMissileSlowDeathBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceNeutronMissileSlowDeathBehaviorBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'SUPPLYCENTERDOCKUPDATE' && entity.isSupplyCenter) {
            const parsedSourceState = tryParseSourceDockOnlyUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDockOnlyUpdateBlockData(currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'SUPPLYWAREHOUSEDOCKUPDATE' && entity.supplyWarehouseProfile) {
            const parsedSourceState = tryParseSourceSupplyWarehouseDockUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSupplyWarehouseDockUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                  coreState,
                ),
              };
            }
          }
          if (moduleType === 'SUPPLYWAREHOUSECRIPPLINGBEHAVIOR' && entity.supplyWarehouseCripplingProfile) {
            const parsedSourceState = tryParseSourceSupplyWarehouseCripplingBehaviorBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSupplyWarehouseCripplingBehaviorBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'REPAIRDOCKUPDATE' && entity.repairDockProfile) {
            const parsedSourceState = tryParseSourceRepairDockUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceRepairDockUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'PRISONDOCKUPDATE') {
            const parsedSourceState = tryParseSourceDockOnlyUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDockOnlyUpdateBlockData(currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'RAILEDTRANSPORTAIUPDATE' && entity.railedTransportState) {
            const parsedSourceState = tryParseSourceRailedTransportAIUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceRailedTransportAIUpdateBlockData(entity, parsedSourceState),
              };
            }
          }
          if (moduleType === 'RAILEDTRANSPORTDOCKUPDATE') {
            const parsedSourceState = tryParseSourceRailedTransportDockUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceRailedTransportDockUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'DEFAULTPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
            const parsedSourceState = tryParseSourceProductionExitRallyBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceProductionExitRallyBlockData(entity, currentFrame, parsedSourceState, false),
              };
            }
          }
          if (moduleType === 'SUPPLYCENTERPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
            const parsedSourceState = tryParseSourceProductionExitRallyBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceProductionExitRallyBlockData(entity, currentFrame, parsedSourceState, false),
              };
            }
          }
          if (moduleType === 'QUEUEPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
            const parsedSourceState = tryParseSourceQueueProductionExitBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceQueueProductionExitBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'SPAWNPOINTPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
            const parsedSourceState = tryParseSourceSpawnPointProductionExitBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSpawnPointProductionExitBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'FIRESTORMDYNAMICGEOMETRYINFOUPDATE' && entity.dynamicGeometryProfile) {
            const parsedSourceState = tryParseSourceFirestormDynamicGeometryInfoUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceFirestormDynamicGeometryInfoUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'DYNAMICGEOMETRYINFOUPDATE' && entity.dynamicGeometryProfile) {
            const parsedSourceState = tryParseSourceDynamicGeometryInfoUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceDynamicGeometryInfoUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'PRODUCTIONUPDATE' && entity.productionProfile) {
            const parsedSourceState = tryParseSourceProductionUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceProductionUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'BATTLEPLANUPDATE' && entity.battlePlanProfile) {
            const parsedSourceState = tryParseSourceBattlePlanUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceBattlePlanUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'SLAVEDUPDATE' && entity.slavedUpdateProfile) {
            const parsedSourceState = tryParseSourceSlavedUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSlavedUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'MOBMEMBERSLAVEDUPDATE' && entity.mobMemberState) {
            const parsedSourceState = tryParseSourceMobMemberSlavedUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceMobMemberSlavedUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'FLOATUPDATE' && entity.floatUpdateProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourceFloatUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'TENSILEFORMATIONUPDATE' && entity.tensileFormationState) {
            const parsedSourceState = tryParseSourceTensileFormationUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceTensileFormationUpdateBlockData(entity, currentFrame, parsedSourceState),
              };
            }
          }
          if (moduleType === 'SPECTREGUNSHIPDEPLOYMENTUPDATE' && entity.spectreGunshipDeploymentProfile) {
            const parsedSourceState = tryParseSourceSpectreGunshipDeploymentUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSpectreGunshipDeploymentUpdateBlockData(entity, currentFrame),
              };
            }
          }
          if (moduleType === 'SPECTREGUNSHIPUPDATE' && entity.spectreGunshipProfile && entity.spectreGunshipState) {
            const parsedSourceState = tryParseSourceSpectreGunshipUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceSpectreGunshipUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
          }
          if (moduleType === 'PILOTFINDVEHICLEUPDATE' && entity.pilotFindVehicleProfile) {
            return {
              identifier: module.identifier,
              blockData: buildSourcePilotFindVehicleUpdateBlockData(entity, currentFrame),
            };
          }
          if (moduleType === 'POINTDEFENSELASERUPDATE' && entity.pointDefenseLaserProfile) {
            const parsedSourceState = tryParseSourcePointDefenseLaserUpdateBlockData(module.blockData);
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourcePointDefenseLaserUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
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
                  currentFrame,
                  liveSpyVisionModule.spyVisionDeactivateFrame,
                  {
                    currentlyActive: liveSpyVisionModule.spyVisionCurrentlyActive,
                    resetTimersNextUpdate: liveSpyVisionModule.spyVisionResetTimersNextUpdate,
                    disabledUntilFrame: liveSpyVisionModule.spyVisionDisabledUntilFrame,
                  },
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
          if (moduleType === 'PARTICLEUPLINKCANNONUPDATE'
            && entity.particleUplinkCannonProfile
            && entity.particleUplinkCannonState) {
            const parsedSourceState = tryParseSourceParticleUplinkCannonUpdateBlockData(
              module.blockData,
            );
            if (parsedSourceState) {
              return {
                identifier: module.identifier,
                blockData: buildSourceParticleUplinkCannonUpdateBlockData(
                  entity,
                  currentFrame,
                  parsedSourceState,
                ),
              };
            }
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
  liveEntities: readonly MapEntity[],
  currentFrame: number,
  coreState?: GameLogicCoreSaveState | null,
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
    producerId: Number.isFinite(entity.producerEntityId)
      ? normalizeSourceObjectId(entity.producerEntityId)
      : sourceState.producerId,
    visionRange: Number.isFinite(entity.visionRange) ? entity.visionRange : sourceState.visionRange,
    shroudClearingRange: Number.isFinite(entity.shroudClearingRange)
      ? entity.shroudClearingRange
      : sourceState.shroudClearingRange,
    shroudRange: Number.isFinite(entity.shroudRange) ? entity.shroudRange : sourceState.shroudRange,
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
      liveEntities,
      currentFrame,
      coreState,
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

function formatMissingSourceObjectXferEntity(entity: MapEntity): string {
  const templateName = typeof entity.templateName === 'string' && entity.templateName.trim().length > 0
    ? entity.templateName.trim()
    : '<unknown-template>';
  const scriptName = typeof entity.scriptName === 'string' && entity.scriptName.trim().length > 0
    ? ` script="${entity.scriptName.trim()}"`
    : '';
  return `${Math.trunc(entity.id)} ${templateName}${scriptName}`;
}

function buildSourceGeometryInfoFromLiveEntity(
  entity: MapEntity,
  fallback: SourceMapEntitySaveState['geometryInfo'],
): SourceMapEntitySaveState['geometryInfo'] {
  const entityGeometry = entity as unknown as {
    geometryInfo?: { shape?: string; majorRadius?: number; minorRadius?: number; height?: number } | null;
    obstacleGeometry?: { shape?: string; majorRadius?: number; minorRadius?: number; height?: number } | null;
  };
  const geometry = entityGeometry.geometryInfo ?? entityGeometry.obstacleGeometry ?? null;
  if (!geometry) {
    return fallback;
  }

  const majorRadius = Number.isFinite(geometry.majorRadius)
    ? Math.max(0, geometry.majorRadius ?? 0)
    : fallback.majorRadius;
  const minorRadius = Number.isFinite(geometry.minorRadius)
    ? Math.max(0, geometry.minorRadius ?? 0)
    : majorRadius;
  const height = Number.isFinite(geometry.height)
    ? Math.max(0, geometry.height ?? 0)
    : fallback.height;
  const isBox = geometry.shape === 'box';
  const halfHeight = height * 0.5;
  return {
    ...fallback,
    type: isBox ? 2 : 1,
    height,
    majorRadius,
    minorRadius,
    boundingCircleRadius: isBox ? Math.hypot(majorRadius, minorRadius) : majorRadius,
    boundingSphereRadius: isBox
      ? Math.hypot(majorRadius, minorRadius, halfHeight)
      : Math.max(majorRadius, halfHeight),
  };
}

function resolveGeneratedSourceObjectTeamId(
  entity: MapEntity,
  sourceTeamIdByName: ReadonlyMap<string, number>,
  fallbackTeamId: number,
): number {
  const sourceTeamName = entity.sourceTeamNameUpper?.trim().toUpperCase() ?? '';
  if (sourceTeamName.length > 0) {
    const teamId = sourceTeamIdByName.get(sourceTeamName);
    if (teamId !== undefined) {
      return teamId;
    }
  }
  return fallbackTeamId;
}

function buildGeneratedSourceObjectModuleBlockData(
  descriptor: GameLogicSourceObjectModuleDescriptor,
  entity: MapEntity,
  liveEntities: readonly MapEntity[],
  currentFrame: number,
  coreState?: GameLogicCoreSaveState | null,
): Uint8Array | null {
  const moduleType = descriptor.moduleType.trim();
  const moduleTag = descriptor.moduleTag.trim();
  if (!moduleType || !moduleTag) {
    return null;
  }
  const normalizedModuleType = moduleType.toUpperCase();
  const normalizedModuleTag = moduleTag.toUpperCase();

  const defaultBodyState = createDefaultSourceBodyModuleBlockState(moduleType);
  if (defaultBodyState) {
    return buildSourceBodyModuleBlockData(entity, moduleType, defaultBodyState);
  }

  if (isSourceCreateModuleType(moduleType)) {
    const liveCreateModuleState = findLiveSourceCreateModuleState(entity, moduleType, moduleTag);
    return buildSourceCreateModuleBlockData(liveCreateModuleState?.needToRunOnBuildComplete ?? true);
  }

  if (isSourceUpgradeModuleType(moduleType)) {
    const liveUpgradeModule = findLiveSourceUpgradeModule(entity, moduleType, moduleTag);
    const upgradeExecuted = liveUpgradeModule && entity.executedUpgradeModules instanceof Set
      ? entity.executedUpgradeModules.has(liveUpgradeModule.id)
      : false;
    return buildSourceUpgradeModuleBlockData(upgradeExecuted);
  }

  if (isSourceSpecialPowerModuleType(moduleType)) {
    const liveSpecialPowerModule = findLiveSourceSpecialPowerModule(entity, moduleType, moduleTag);
    return liveSpecialPowerModule
      ? buildSourceSpecialPowerModuleBlockData(
          moduleType,
          createDefaultSourceSpecialPowerModuleState(),
          liveSpecialPowerModule,
        )
      : buildDefaultSourceSpecialPowerModuleBlockData(moduleType);
  }

  const defaultContainState = createDefaultSourceContainModuleBlockState(moduleType);
  if (defaultContainState) {
    return buildSourceContainModuleBlockData(entity, moduleType, liveEntities, defaultContainState);
  }

  if (normalizedModuleType === 'OVERCHARGEBEHAVIOR') {
    return buildSourceOverchargeBehaviorBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'AUTOHEALBEHAVIOR' && entity.autoHealProfile) {
    return buildSourceAutoHealBehaviorBlockData(entity, currentFrame, false, 0);
  }

  if (normalizedModuleType === 'GRANTSTEALTHBEHAVIOR' && entity.grantStealthProfile) {
    return buildSourceGrantStealthBehaviorBlockData(entity, currentFrame, 0);
  }

  if (normalizedModuleType === 'COUNTERMEASURESBEHAVIOR'
    && (entity.countermeasuresProfile || entity.countermeasuresState)) {
    return buildSourceCountermeasuresBehaviorBlockData(entity, currentFrame, false);
  }

  if (normalizedModuleType === 'WEAPONBONUSUPDATE' && (entity.weaponBonusUpdateProfiles?.length ?? 0) > 0) {
    const moduleIndex = entity.weaponBonusUpdateProfiles.findIndex(
      (profile) => (profile.moduleTag ?? '').trim().toUpperCase() === normalizedModuleTag,
    );
    if (moduleIndex >= 0) {
      const nextPulseFrame = entity.weaponBonusUpdateNextPulseFrames[moduleIndex] ?? 0;
      return buildSourceWeaponBonusUpdateBlockData(
        nextPulseFrame > currentFrame ? nextPulseFrame : currentFrame + 1,
      );
    }
  }

  if (normalizedModuleType === 'OCLUPDATE' && (entity.oclUpdateProfiles?.length ?? 0) > 0) {
    const moduleIndex = entity.oclUpdateProfiles.findIndex(
      (profile) => (profile.moduleTag ?? '').trim().toUpperCase() === normalizedModuleTag,
    );
    if (moduleIndex >= 0) {
      return buildSourceOclUpdateBlockData(entity, currentFrame, moduleIndex);
    }
  }

  if (normalizedModuleType === 'POWERPLANTUPDATE' && (entity.powerPlantUpdateProfile || entity.powerPlantUpdateState)) {
    return buildSourcePowerPlantUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'ENEMYNEARUPDATE' && entity.enemyNearScanDelayFrames > 0) {
    return buildSourceEnemyNearUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'HORDEUPDATE' && entity.hordeProfile) {
    return buildSourceHordeUpdateBlockData(
      entity,
      currentFrame,
      entity.hordeHasFlag === true,
    );
  }

  if (normalizedModuleType === 'PRONEUPDATE' && entity.proneDamageToFramesRatio != null) {
    return buildSourceProneUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'FIREOCLAFTERWEAPONCOOLDOWNUPDATE'
    && (entity.fireOCLAfterCooldownProfiles?.length ?? 0) > 0) {
    const moduleIndex = entity.fireOCLAfterCooldownProfiles.findIndex(
      (profile) => (profile.moduleTag ?? '').trim().toUpperCase() === normalizedModuleTag,
    );
    const state = moduleIndex >= 0 ? entity.fireOCLAfterCooldownStates[moduleIndex] : undefined;
    if (moduleIndex >= 0 && state) {
      return buildSourceFireOclAfterCooldownUpdateBlockData(
        currentFrame,
        false,
        state,
      );
    }
  }

  if (normalizedModuleType === 'FIREWEAPONUPDATE' && (entity.fireWeaponUpdateProfiles?.length ?? 0) > 0) {
    return buildGeneratedSourceFireWeaponUpdateBlockData(entity, currentFrame, moduleTag);
  }

  if (normalizedModuleType === 'FIREWEAPONCOLLIDE' && (entity.fireWeaponCollideProfiles?.length ?? 0) > 0) {
    return buildGeneratedSourceFireWeaponCollideBlockData(entity, currentFrame, moduleTag);
  }

  if (normalizedModuleType === 'FIREWEAPONWHENDAMAGEDBEHAVIOR'
    && (entity.fireWhenDamagedProfiles?.length ?? 0) > 0) {
    return buildGeneratedSourceFireWhenDamagedBlockData(entity, currentFrame, moduleTag);
  }

  if (normalizedModuleType === 'FIREWEAPONWHENDEADBEHAVIOR'
    && (entity.fireWeaponWhenDeadProfiles?.length ?? 0) > 0) {
    const moduleIndex = entity.fireWeaponWhenDeadProfiles.findIndex(
      (profile) => (profile.moduleTag ?? '').trim().toUpperCase() === normalizedModuleTag,
    );
    if (moduleIndex >= 0) {
      return buildSourceFireWeaponWhenDeadBehaviorBlockData(
        sourceFireWeaponWhenDeadUpgradeExecuted(entity, moduleIndex, false),
      );
    }
  }

  if (normalizedModuleType === 'AUTOFINDHEALINGUPDATE' && entity.autoFindHealingProfile) {
    return buildSourceAutoFindHealingUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'RADIUSDECALUPDATE') {
    const liveModuleState = (entity.radiusDecalModuleStates ?? []).find(
      (state) => state.moduleTag === normalizedModuleTag,
    );
    const liveKillWhenNoLongerAttacking = (entity.radiusDecalStates ?? []).some(
      (state) => state.killWhenNoLongerAttacking,
    );
    return buildSourceRadiusDecalUpdateBlockData(
      entity,
      currentFrame,
      liveModuleState
        ? liveModuleState.killWhenNoLongerAttacking
        : liveKillWhenNoLongerAttacking,
    );
  }

  if (normalizedModuleType === 'FIRESTORMDYNAMICGEOMETRYINFOUPDATE' && entity.dynamicGeometryProfile) {
    return buildSourceFirestormDynamicGeometryInfoUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceFirestormDynamicGeometryInfoUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'BASEREGENERATEUPDATE') {
    return buildSourceBaseRegenerateUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'LIFETIMEUPDATE' && typeof entity.lifetimeDieFrame === 'number') {
    return buildSourceLifetimeUpdateBlockData(entity);
  }

  if (normalizedModuleType === 'DELETIONUPDATE' && typeof entity.deletionDieFrame === 'number') {
    return buildSourceDeletionUpdateBlockData(entity);
  }

  if (normalizedModuleType === 'HEIGHTDIEUPDATE' && entity.heightDieProfile) {
    return buildSourceHeightDieUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceHeightDieUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'STICKYBOMBUPDATE' && entity.stickyBombProfile) {
    return buildSourceStickyBombUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceStickyBombUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'CLEANUPHAZARDUPDATE' && entity.cleanupHazardProfile) {
    return buildSourceCleanupHazardUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceCleanupHazardUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'DEMOTRAPUPDATE' && entity.demoTrapProfile) {
    return buildSourceDemoTrapUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'COMMANDBUTTONHUNTUPDATE' && entity.commandButtonHuntProfile) {
    return buildSourceCommandButtonHuntUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'AUTODEPOSITUPDATE' && entity.autoDepositProfile) {
    return buildSourceAutoDepositUpdateBlockData(entity, currentFrame);
  }

  if ((normalizedModuleType === 'DYNAMICSHROUDCLEARINGRANGEUPDATE'
    || normalizedModuleType === 'DYNAMICSHROUDCLEARINGRANGE')
    && entity.dynamicShroudProfile) {
    return buildSourceDynamicShroudClearingRangeUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'STEALTHUPDATE' && entity.stealthProfile) {
    return buildSourceStealthUpdateBlockData(entity, currentFrame, null);
  }

  if (normalizedModuleType === 'STEALTHDETECTORUPDATE' && entity.detectorProfile) {
    return buildSourceStealthDetectorUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'PHYSICSBEHAVIOR' && entity.physicsBehaviorProfile) {
    return buildSourcePhysicsBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourcePhysicsBehaviorBlockState(entity),
    );
  }

  if (normalizedModuleType === 'RAILROADBEHAVIOR') {
    return buildSourceRailroadBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceRailroadBehaviorBlockState(entity),
    );
  }

  if (normalizedModuleType === 'WAVEGUIDEUPDATE') {
    return buildSourceWaveGuideUpdateBlockData(
      entity,
      createDefaultSourceWaveGuideUpdateBlockState(currentFrame),
    );
  }

  if (normalizedModuleType === 'PROJECTILESTREAMUPDATE') {
    return buildSourceProjectileStreamUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceProjectileStreamUpdateBlockState(currentFrame),
    );
  }

  if (normalizedModuleType === 'BONEFXUPDATE') {
    return buildSourceBoneFxUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceBoneFxUpdateBlockState(currentFrame),
    );
  }

  if (normalizedModuleType === 'SMARTBOMBTARGETHOMINGUPDATE' && entity.smartBombProfile) {
    return buildSourceSmartBombTargetHomingUpdateBlockData(currentFrame);
  }

  if (normalizedModuleType === 'ANIMATIONSTEERINGUPDATE' && entity.animationSteeringProfile) {
    return buildSourceAnimationSteeringUpdateBlockData(currentFrame);
  }

  if (normalizedModuleType === 'DEPLOYSTYLEAIUPDATE' && entity.deployStyleProfile) {
    return buildGeneratedSourceDeployStyleAIUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'FLOATUPDATE' && entity.floatUpdateProfile) {
    return buildSourceFloatUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'PILOTFINDVEHICLEUPDATE' && entity.pilotFindVehicleProfile) {
    return buildSourcePilotFindVehicleUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'LEAFLETDROPBEHAVIOR' && (entity.leafletDropProfile || entity.leafletDropState)) {
    return buildSourceLeafletDropBehaviorBlockData(entity);
  }

  if (normalizedModuleType === 'EMPUPDATE' && entity.empUpdateProfile) {
    return buildSourceEmpUpdateBlockData();
  }

  if (normalizedModuleType === 'RADARUPDATE' && entity.radarUpdateProfile) {
    return buildSourceRadarUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'STRUCTURECOLLAPSEUPDATE' && entity.structureCollapseProfile) {
    return buildSourceStructureCollapseUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'MISSILELAUNCHERBUILDINGUPDATE' && entity.missileLauncherBuildingProfile) {
    return buildSourceMissileLauncherBuildingUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'PARTICLEUPLINKCANNONUPDATE' && entity.particleUplinkCannonProfile) {
    return buildSourceParticleUplinkCannonUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceParticleUplinkCannonUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'CHECKPOINTUPDATE' && entity.checkpointProfile) {
    return buildSourceCheckpointUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'HIJACKERUPDATE' && (entity.hijackerUpdateProfile || entity.hijackerState)) {
    return buildSourceHijackerUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'FLAMMABLEUPDATE' && entity.flammableProfile) {
    return buildSourceFlammableUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceFlammableUpdateBlockState(entity),
    );
  }

  if (normalizedModuleType === 'FIRESPREADUPDATE' && entity.fireSpreadProfile) {
    return buildSourceFireSpreadUpdateBlockData(entity);
  }

  if (normalizedModuleType === 'POISONEDBEHAVIOR' && entity.poisonedBehaviorProfile) {
    return buildSourcePoisonedBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourcePoisonedBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'MINEFIELDBEHAVIOR' && entity.minefieldProfile) {
    return buildSourceMinefieldBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceMinefieldBehaviorBlockState(entity),
    );
  }

  if (normalizedModuleType === 'GENERATEMINEFIELDBEHAVIOR' && entity.generateMinefieldProfile) {
    return buildSourceGenerateMinefieldBehaviorBlockData(
      entity,
      createDefaultSourceGenerateMinefieldBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'DUMBPROJECTILEBEHAVIOR') {
    return buildSourceDumbProjectileBehaviorBlockData(
      entity,
      createDefaultSourceDumbProjectileBehaviorBlockState(currentFrame),
    );
  }

  if (normalizedModuleType === 'TECHBUILDINGBEHAVIOR') {
    return buildSourceBaseOnlyUpdateModuleBlockData(
      'tech-building-behavior',
      sourceTechBuildingNextWakeFrame(entity, currentFrame),
    );
  }

  if (normalizedModuleType === 'BUNKERBUSTERBEHAVIOR') {
    return buildSourceBaseOnlyUpdateModuleBlockData(
      'bunker-buster-behavior',
      currentFrame + 1,
    );
  }

  if (normalizedModuleType === 'NEUTRONBLASTBEHAVIOR') {
    return buildSourceBaseOnlyUpdateModuleBlockData(
      'neutron-blast-behavior',
      SOURCE_FRAME_FOREVER,
    );
  }

  if (normalizedModuleType === 'BATTLEBUSSLOWDEATHBEHAVIOR' && entity.battleBusSlowDeathProfile) {
    return buildSourceBattleBusSlowDeathBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceBattleBusSlowDeathBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'HELICOPTERSLOWDEATHBEHAVIOR'
    && (entity.helicopterSlowDeathProfiles?.length ?? 0) > 0) {
    return buildSourceHelicopterSlowDeathBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceHelicopterSlowDeathBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'JETSLOWDEATHBEHAVIOR' && (entity.jetSlowDeathProfiles?.length ?? 0) > 0) {
    return buildSourceJetSlowDeathBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceJetSlowDeathBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'NEUTRONMISSILESLOWDEATHBEHAVIOR' && entity.neutronMissileSlowDeathProfile) {
    return buildSourceNeutronMissileSlowDeathBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceNeutronMissileSlowDeathBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'SLOWDEATHBEHAVIOR') {
    return buildSourceSlowDeathBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceSlowDeathBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'SUPPLYCENTERDOCKUPDATE' && entity.isSupplyCenter) {
    return buildSourceDockOnlyUpdateBlockData(
      currentFrame,
      createDefaultSourceDockUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'SUPPLYWAREHOUSEDOCKUPDATE' && entity.supplyWarehouseProfile) {
    return buildSourceSupplyWarehouseDockUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceSupplyWarehouseDockUpdateBlockState(entity),
      coreState,
    );
  }

  if (normalizedModuleType === 'SUPPLYWAREHOUSECRIPPLINGBEHAVIOR' && entity.supplyWarehouseCripplingProfile) {
    return buildSourceSupplyWarehouseCripplingBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceSupplyWarehouseCripplingBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'REPAIRDOCKUPDATE' && entity.repairDockProfile) {
    return buildSourceRepairDockUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceRepairDockUpdateBlockState(entity),
    );
  }

  if (normalizedModuleType === 'PRISONDOCKUPDATE') {
    return buildSourceDockOnlyUpdateBlockData(
      currentFrame,
      createDefaultSourceDockUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'RAILEDTRANSPORTDOCKUPDATE') {
    return buildSourceRailedTransportDockUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceRailedTransportDockUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'PRODUCTIONUPDATE' && entity.productionProfile) {
    return buildSourceProductionUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceProductionUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'BATTLEPLANUPDATE' && entity.battlePlanProfile) {
    return buildSourceBattlePlanUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceBattlePlanUpdateBlockState(entity),
    );
  }

  if (normalizedModuleType === 'SLAVEDUPDATE' && entity.slavedUpdateProfile) {
    return buildSourceSlavedUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceSlavedUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'DEFAULTPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
    return buildSourceProductionExitRallyBlockData(
      entity,
      currentFrame,
      createDefaultSourceProductionExitRallyState(),
      false,
    );
  }

  if (normalizedModuleType === 'SUPPLYCENTERPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
    return buildSourceProductionExitRallyBlockData(
      entity,
      currentFrame,
      createDefaultSourceProductionExitRallyState(),
      false,
    );
  }

  if (normalizedModuleType === 'QUEUEPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
    return buildSourceQueueProductionExitBlockData(
      entity,
      currentFrame,
      createDefaultSourceQueueProductionExitBlockState(entity),
    );
  }

  if (normalizedModuleType === 'SPAWNPOINTPRODUCTIONEXITUPDATE' && entity.queueProductionExitProfile) {
    return buildSourceSpawnPointProductionExitBlockData(
      entity,
      currentFrame,
      createDefaultSourceSpawnPointProductionExitBlockState(),
    );
  }

  if (normalizedModuleType === 'REBUILDHOLEBEHAVIOR' && entity.rebuildHoleProfile) {
    return buildSourceRebuildHoleBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceRebuildHoleBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'PROPAGANDATOWERBEHAVIOR' && entity.propagandaTowerProfile) {
    return buildSourcePropagandaTowerBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourcePropagandaTowerBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'BRIDGEBEHAVIOR' && entity.bridgeBehaviorProfile) {
    return buildSourceBridgeBehaviorBlockData(
      entity,
      createDefaultSourceBridgeBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'BRIDGETOWERBEHAVIOR' && entity.bridgeTowerProfile) {
    return buildSourceBridgeTowerBehaviorBlockData(
      entity,
      createDefaultSourceBridgeTowerBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'BRIDGESCAFFOLDBEHAVIOR' && entity.bridgeScaffoldState) {
    return buildSourceBridgeScaffoldBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceBridgeScaffoldBehaviorBlockState(),
    );
  }

  if (normalizedModuleType === 'PARKINGPLACEBEHAVIOR' && entity.parkingPlaceProfile) {
    return buildSourceParkingPlaceBehaviorBlockData(
      entity,
      currentFrame,
      createDefaultSourceParkingPlaceBehaviorBlockState(currentFrame),
    );
  }

  if (normalizedModuleType === 'SPECIALPOWERCOMPLETIONDIE') {
    return buildSourceSpecialPowerCompletionDieBlockData(
      entity,
      createDefaultSourceSpecialPowerCompletionDieBlockState(),
    );
  }

  if (normalizedModuleType === 'SPAWNBEHAVIOR') {
    return buildSourceSpawnBehaviorBlockData(
      entity,
      createDefaultSourceSpawnBehaviorBlockState(),
    ) ?? buildDefaultSourceSpawnBehaviorBlockData();
  }

  if (normalizedModuleType === 'TENSILEFORMATIONUPDATE' && entity.tensileFormationProfile) {
    return buildSourceTensileFormationUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceTensileFormationUpdateBlockState(entity),
    );
  }

  if (normalizedModuleType === 'SPECTREGUNSHIPDEPLOYMENTUPDATE' && entity.spectreGunshipDeploymentProfile) {
    return buildSourceSpectreGunshipDeploymentUpdateBlockData(entity, currentFrame);
  }

  if (normalizedModuleType === 'SPECTREGUNSHIPUPDATE' && entity.spectreGunshipProfile) {
    return buildSourceSpectreGunshipUpdateBlockData(entity, currentFrame, null);
  }

  if (normalizedModuleType === 'POINTDEFENSELASERUPDATE' && entity.pointDefenseLaserProfile) {
    return buildSourcePointDefenseLaserUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourcePointDefenseLaserUpdateBlockState(),
    );
  }

  if (normalizedModuleType === 'NEUTRONMISSILEUPDATE' && entity.neutronMissileUpdateProfile) {
    return buildSourceNeutronMissileUpdateBlockData(entity, currentFrame, null);
  }

  if (normalizedModuleType === 'SPYVISIONUPDATE') {
    const liveSpyVisionModule = Array.from(entity.specialPowerModules.values()).find(
      (specialPowerModule) => specialPowerModule.moduleType === 'SPYVISIONSPECIALPOWER',
    );
    if (liveSpyVisionModule) {
      return buildSourceSpyVisionUpdateBlockData(
        currentFrame,
        liveSpyVisionModule.spyVisionDeactivateFrame,
        {
          currentlyActive: liveSpyVisionModule.spyVisionCurrentlyActive,
          resetTimersNextUpdate: liveSpyVisionModule.spyVisionResetTimersNextUpdate,
          disabledUntilFrame: liveSpyVisionModule.spyVisionDisabledUntilFrame,
        },
        null,
      );
    }
    return buildSourceSpyVisionUpdateBlockData(currentFrame, 0, null, null);
  }

  if (normalizedModuleType === 'SPECIALABILITYUPDATE' && entity.specialAbilityProfile) {
    return buildSourceSpecialAbilityUpdateBlockData(entity, currentFrame, null);
  }

  if (normalizedModuleType === 'TOPPLEUPDATE' && entity.toppleProfile) {
    return buildSourceToppleUpdateBlockData(entity, currentFrame, null);
  }

  if (normalizedModuleType === 'STRUCTURETOPPLEUPDATE' && entity.structureToppleProfile) {
    return buildSourceStructureToppleUpdateBlockData(entity, currentFrame, null);
  }

  if (normalizedModuleType === 'DYNAMICGEOMETRYINFOUPDATE') {
    return buildSourceDynamicGeometryInfoUpdateBlockData(
      entity,
      currentFrame,
      createDefaultSourceDynamicGeometryInfoUpdateState(),
    );
  }

  return null;
}

function buildGeneratedSourceObjectModulesFromDescriptors(
  descriptors: readonly GameLogicSourceObjectModuleDescriptor[],
  entity: MapEntity,
  liveEntities: readonly MapEntity[],
  currentFrame: number,
  coreState?: GameLogicCoreSaveState | null,
): SourceMapEntitySaveState['modules'] {
  const modules: SourceMapEntitySaveState['modules'] = [];
  const seenTags = new Set<string>();
  for (const descriptor of descriptors) {
    const moduleTag = descriptor.moduleTag.trim();
    const normalizedModuleTag = normalizeSourceObjectModuleTag(moduleTag);
    if (!moduleTag || !normalizedModuleTag || seenTags.has(normalizedModuleTag)) {
      continue;
    }
    seenTags.add(normalizedModuleTag);
    const blockData = buildGeneratedSourceObjectModuleBlockData(
      descriptor,
      entity,
      liveEntities,
      currentFrame,
      coreState,
    );
    if (!blockData || blockData.byteLength === 0) {
      continue;
    }
    modules.push({
      identifier: moduleTag,
      blockData,
    });
  }
  return modules;
}

function createGeneratedSourceObjectStateFromLiveEntity(
  entity: MapEntity,
  liveEntities: readonly MapEntity[],
  currentFrame: number,
  coreState: GameLogicCoreSaveState | null,
  triggerAreaState: GameLogicObjectTriggerAreaSaveState | null | undefined,
  objectXferOverlayState: GameLogicObjectXferOverlayState | null | undefined,
  sourceTeamIdByName: ReadonlyMap<string, number>,
  fallbackTeamId: number,
  sourceObjectModuleDescriptors: readonly GameLogicSourceObjectModuleDescriptor[],
  resolveSourceObjectModuleTypeByTag?: ((templateName: string, moduleTag: string) => string | null) | null,
): SourceMapEntitySaveState {
  const templateName = typeof entity.templateName === 'string' ? entity.templateName.trim() : '';
  if (!templateName) {
    throw new Error(
      `Cannot synthesize source Object::xfer for live entity ${Math.trunc(entity.id)} without a template name.`,
    );
  }

  const sourceState = createEmptySourceMapEntitySaveState();
  sourceState.objectId = Math.trunc(entity.id);
  sourceState.teamId = resolveGeneratedSourceObjectTeamId(entity, sourceTeamIdByName, fallbackTeamId);
  const drawableId = (entity as unknown as { drawableId?: number }).drawableId;
  sourceState.drawableId = Number.isFinite(drawableId) && (drawableId ?? 0) > 0
    ? Math.trunc(drawableId ?? 0)
    : sourceState.objectId;
  sourceState.originalTeamName = entity.sourceTeamNameUpper?.trim().toUpperCase() ?? '';
  sourceState.geometryInfo = buildSourceGeometryInfoFromLiveEntity(entity, sourceState.geometryInfo);
  sourceState.modulesReady = true;
  sourceState.modules = buildGeneratedSourceObjectModulesFromDescriptors(
    sourceObjectModuleDescriptors,
    entity,
    liveEntities,
    currentFrame,
    coreState,
  );
  return overlaySourceObjectStateFromLiveEntity(
    sourceState,
    entity,
    liveEntities,
    currentFrame,
    coreState,
    triggerAreaState,
    objectXferOverlayState,
    templateName,
    resolveSourceObjectModuleTypeByTag,
  );
}

function buildSourceGameLogicChunk(
  sourceState: ParsedSourceGameLogicChunkState,
  options: {
    campaignState?: RuntimeSaveCampaignState | null;
    coreState?: GameLogicCoreSaveState | null;
    objectXferOverlayStates?: readonly GameLogicObjectXferOverlayState[] | null;
    resolveSourceObjectModuleTypeByTag?: ((templateName: string, moduleTag: string) => string | null) | null;
    listSourceObjectModuleDescriptors?: ((templateName: string) =>
      readonly GameLogicSourceObjectModuleDescriptor[] | null) | null;
    sourceTeamIdByName?: ReadonlyMap<string, number> | null;
  } = {},
): Uint8Array {
  const saver = new XferSave();
  saver.open('build-source-game-logic');
  try {
    const coreState = options.coreState ?? null;
    const campaignState = options.campaignState ?? sourceState.campaignState;
    const liveEntities = coreState?.spawnedEntities ?? [];
    const liveEntityById = new Map(
      liveEntities.map((entity) => [entity.id, entity]),
    );
    const sourceObjectIds = new Set(sourceState.objects.map((object) => object.state.objectId));
    const liveTriggerAreaStateByEntityId = new Map(
      (coreState?.objectTriggerAreaStates ?? []).map((state) => [state.entityId, state]),
    );
    const objectXferOverlayStateByEntityId = new Map(
      (options.objectXferOverlayStates ?? []).map((state) => [state.entityId, state]),
    );
    const sourceTeamIdByName = new Map<string, number>();
    for (const object of sourceState.objects) {
      const originalTeamName = object.state.originalTeamName.trim().toUpperCase();
      if (originalTeamName.length > 0 && !sourceTeamIdByName.has(originalTeamName)) {
        sourceTeamIdByName.set(originalTeamName, object.state.teamId);
      }
    }
    for (const [teamName, teamId] of options.sourceTeamIdByName ?? []) {
      const normalizedTeamName = teamName.trim().toUpperCase();
      if (normalizedTeamName.length > 0 && !sourceTeamIdByName.has(normalizedTeamName)) {
        sourceTeamIdByName.set(normalizedTeamName, Math.max(0, Math.trunc(teamId)));
      }
    }
    const fallbackTeamId = sourceState.objects[0]?.state.teamId ?? 0;
    const objectTocEntries = sourceState.objectTocEntries.map((entry) => ({ ...entry }));
    const tocIdByTemplateName = new Map(objectTocEntries.map((entry) => [entry.templateName, entry.tocId]));
    const getOrCreateObjectTocId = (templateName: string): number => {
      const existing = tocIdByTemplateName.get(templateName);
      if (existing !== undefined) {
        return existing;
      }
      const nextTocId = objectTocEntries.reduce((max, entry) => Math.max(max, entry.tocId), 0) + 1;
      objectTocEntries.push({ templateName, tocId: nextTocId });
      tocIdByTemplateName.set(templateName, nextTocId);
      return nextTocId;
    };
    const generatedObjects: ParsedSourceGameLogicObjectState[] = [];
    const missingSourceObjectXferEntities = [...liveEntityById.values()].filter((entity) =>
      Number.isFinite(entity.id)
      && Math.trunc(entity.id) > 0
      && !sourceObjectIds.has(Math.trunc(entity.id)));
    for (const entity of missingSourceObjectXferEntities) {
      const templateName = typeof entity.templateName === 'string' ? entity.templateName.trim() : '';
      if (!templateName) {
        throw new Error(
          'Cannot rewrite source CHUNK_GameLogic because live entities have no source Object::xfer state '
          + `and cannot be synthesized: ${formatMissingSourceObjectXferEntity(entity)}.`,
        );
      }
      const sourceObjectModuleDescriptors = typeof options.listSourceObjectModuleDescriptors === 'function'
        ? options.listSourceObjectModuleDescriptors(templateName) ?? []
        : [];
      const generatedState = createGeneratedSourceObjectStateFromLiveEntity(
        entity,
        liveEntities,
        coreState?.frameCounter ?? sourceState.frameCounter,
        coreState,
        liveTriggerAreaStateByEntityId.get(entity.id),
        objectXferOverlayStateByEntityId.get(entity.id),
        sourceTeamIdByName,
        fallbackTeamId,
        sourceObjectModuleDescriptors,
        options.resolveSourceObjectModuleTypeByTag,
      );
      const blockData = buildSourceMapEntityChunk(generatedState);
      generatedObjects.push({
        tocId: getOrCreateObjectTocId(templateName),
        templateName,
        blockData,
        state: generatedState,
      });
    }
    saver.xferVersion(sourceState.version);
    saver.xferUnsignedInt(coreState?.frameCounter ?? sourceState.frameCounter);
    saver.xferVersion(1);
    saver.xferUnsignedInt(objectTocEntries.length);
    for (const tocEntry of objectTocEntries) {
      saver.xferAsciiString(tocEntry.templateName);
      saver.xferUnsignedShort(tocEntry.tocId);
    }

    saver.xferUnsignedInt(sourceState.objects.length + generatedObjects.length);
    for (const object of [...sourceState.objects, ...generatedObjects]) {
      saver.xferUnsignedShort(object.tocId);
      saver.beginBlock();
      const liveEntity = liveEntityById.get(object.state.objectId);
      saver.xferUser(
        liveEntity
          ? new Uint8Array(buildSourceMapEntityChunk(
              overlaySourceObjectStateFromLiveEntity(
                object.state,
                liveEntity,
                liveEntities,
                coreState?.frameCounter ?? sourceState.frameCounter,
                coreState,
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
      xferSourceControlBarOverrideMapEntries(
        saver,
        coreState
          ? buildSourceControlBarOverrideMapEntries(coreState.controlBarOverrides)
          : sourceState.controlBarOverrideEntries,
      );
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
      polygonTriggerCount: null,
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
    polygonTriggerCount: null,
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
  > & Partial<Pick<
    GameLogicSubsystem,
    'captureSourceObjectXferOverlayState'
    | 'resolveSourceObjectModuleTypeByTag'
    | 'listSourceObjectModuleDescriptors'
  >>);
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
  const resolveSourceObjectModuleTypeByTag =
    typeof params.gameLogic.resolveSourceObjectModuleTypeByTag === 'function'
      ? params.gameLogic.resolveSourceObjectModuleTypeByTag.bind(params.gameLogic)
      : null;
  const listSourceObjectModuleDescriptors =
    typeof params.gameLogic.listSourceObjectModuleDescriptors === 'function'
      ? params.gameLogic.listSourceObjectModuleDescriptors.bind(params.gameLogic)
      : null;
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
  const hasSourceGameLogicPassthrough = hasPassthroughBlock(orderedPassthroughBlocks, SOURCE_GAME_LOGIC_BLOCK);
  const runtimePayload: BrowserRuntimeSavePayload = {
    version: BROWSER_RUNTIME_STATE_VERSION,
    cameraState: buildBrowserRuntimeCameraSaveState(params.cameraState),
    gameLogicState: browserGameLogicState,
    gameLogicCoreState: hasSourceGameLogicPassthrough ? null : gameLogicPayload,
  };
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
  const sourceTeamIdByName = buildSourceTeamIdByNameMap(teamFactoryPayload);
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
  if (hasSourceGameLogicPassthrough) {
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
              resolveSourceObjectModuleTypeByTag,
              listSourceObjectModuleDescriptors,
              sourceTeamIdByName,
            })
          : passthroughBlock.blockData,
      ),
    );
  } else {
    state.addSnapshotBlock(
      SOURCE_GAME_LOGIC_BLOCK,
      new RawPassthroughSnapshot(buildSourceGameLogicChunk(
        createFreshSourceGameLogicChunkState(campaignState, params.mapData, terrainLogicPayload),
        {
          campaignState,
          coreState: gameLogicPayload,
          objectXferOverlayStates: objectXferOverlayPayload,
          resolveSourceObjectModuleTypeByTag,
          listSourceObjectModuleDescriptors,
          sourceTeamIdByName,
        },
      )),
    );
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
  if (
    shouldWriteBrowserRuntimeStateBlock(browserGameLogicState)
    || runtimePayload.gameLogicCoreState !== null
  ) {
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
  const sourceGameLogicImportState = buildSourceGameLogicImportSaveState(
    sourceGameLogicState,
    mapInfo.objectIdCounter,
  );
  const sourceGameLogicCoreState = gameLogicChunk
    ? tryParseSourceGameLogicChunk(gameLogicChunk)
    : null;
  const legacyGameLogicCoreState = sourceGameLogicCoreState === null && gameLogicChunk
    ? tryParseLegacyGameLogicChunk(gameLogicChunk)
    : null;
  const browserRuntimeCoreState = payload?.gameLogicCoreState ?? null;
  const gameLogicCoreState = sourceGameLogicCoreState ?? legacyGameLogicCoreState ?? browserRuntimeCoreState;
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
    sourceGameLogicImportState,
    gameLogicState: payload && shouldWriteBrowserRuntimeStateBlock(payload.gameLogicState)
      ? payload.gameLogicState
      : null,
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
