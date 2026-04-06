import {
  GameState,
  SaveCode,
  SaveFileType,
  XferLoad,
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
  type GameLogicPartitionSaveState,
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
  type RenderableEntityState as GameLogicRenderableEntityState,
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
  buildSourceTeamFactoryChunk,
} from './runtime-team-factory-save.js';

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
const PASSTHROUGH_BLOCK_ORDER = [
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
const SOURCE_PLAYER_SNAPSHOT_VERSION = 2;
const SOURCE_GAME_LOGIC_SNAPSHOT_VERSION = 7;
const SOURCE_GAME_CLIENT_SNAPSHOT_VERSION = 3;
const SOURCE_GAME_CLIENT_TOC_SNAPSHOT_VERSION = 1;
const SOURCE_TERRAIN_VISUAL_SNAPSHOT_VERSION = 1;
const SOURCE_GHOST_OBJECT_SNAPSHOT_VERSION = 1;
const SOURCE_RADAR_SNAPSHOT_VERSION = 2;
const SOURCE_RADAR_OBJECT_LIST_VERSION = 1;
const SOURCE_RADAR_EVENT_COUNT = 64;
const INVALID_MISSION_NUMBER = -1;
export const SOURCE_GAME_MODE_SINGLE_PLAYER = 0;
export const SOURCE_GAME_MODE_SKIRMISH = 2;
const SOURCE_DIFFICULTY_EASY = 0;
const SOURCE_DIFFICULTY_NORMAL = 1;
const SOURCE_DIFFICULTY_HARD = 2;
const DRAWABLE_STATUS_SHADOWS = 0x00000002;
const NUM_DRAWABLE_MODULE_TYPES = 2;
const TERRAIN_DECAL_NONE = 0;
const FADING_NONE = 0;
const STEALTHLOOK_NONE = 0;

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

interface RuntimeSaveDrawableSnapshotState {
  readonly drawableId: number;
  readonly objectId: number;
  readonly templateName: string;
  readonly modelConditionFlags: readonly string[];
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
  cameraState: CameraState | null;
  tacticalViewState: RuntimeSaveTacticalViewState | null;
  gameClientState: RuntimeSaveGameClientState | null;
  particleSystemState: ParticleSystemManagerSaveState | null;
  sourceTeamFactoryChunkData: Uint8Array | null;
  gameLogicTerrainLogicState: GameLogicTerrainLogicSaveState | null;
  gameLogicTeamFactoryState: GameLogicTeamFactorySaveState | null;
  gameLogicPlayersState: GameLogicPlayersSaveState | null;
  gameLogicPartitionState: GameLogicPartitionSaveState | null;
  gameLogicRadarState: GameLogicRadarSaveState | null;
  gameLogicSidesListState: GameLogicSidesListSaveState | null;
  gameLogicScriptEngineState: GameLogicScriptEngineSaveState | null;
  gameLogicInGameUiState: GameLogicInGameUiSaveState | null;
  gameLogicCoreState: GameLogicCoreSaveState | null;
  gameLogicState: unknown | null;
  campaign: RuntimeSaveCampaignBootstrap | null;
  passthroughBlocks: RuntimeSavePassthroughBlock[];
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
    state: 1,
    name: '',
    isAccepted: true,
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
  const values = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
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
    xfer.xferUser(this.identityMatrixBytes);
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
  renderableEntityStates?: readonly GameLogicRenderableEntityState[] | null;
  gameClientLiveEntityIds?: readonly number[] | null;
  particleSystemState?: ParticleSystemManagerSaveState | null;
  gameLogic: Pick<
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
  >;
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
  const inGameUiPayload = params.gameLogic.captureSourceInGameUiRuntimeSaveState();
  const playerPayload = params.gameLogic.captureSourcePlayerRuntimeSaveState();
  const gameLogicPayload = params.gameLogic.captureSourceGameLogicRuntimeSaveState();
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

  const metadataState = createMetadataState(params.description, params.mapPath);
  const campaignState: RuntimeSaveCampaignState = {
    version: params.campaign?.version ?? SOURCE_CAMPAIGN_SNAPSHOT_FRESH_VERSION,
    currentCampaign: params.campaign?.campaignName ?? '',
    currentMission: params.campaign?.missionName ?? '',
    currentRankPoints: params.campaign?.rankPoints ?? 0,
    difficulty: params.campaign?.difficulty ?? 'NORMAL',
    isChallengeCampaign: params.campaign?.isChallengeCampaign ?? false,
    playerTemplateNum: params.campaign?.playerTemplateNum ?? -1,
    challengeGameInfoState: params.campaign?.challengeGameInfoState ?? null,
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
  state.addSnapshotBlock(SOURCE_PLAYERS_BLOCK, new PlayersSnapshot(playerPayload));
  state.addSnapshotBlock(SOURCE_GAME_LOGIC_BLOCK, new GameLogicSnapshot(gameLogicPayload));
  state.addSnapshotBlock(SOURCE_RADAR_BLOCK, new RadarSnapshot(radarPayload));
  state.addSnapshotBlock(SOURCE_SCRIPT_ENGINE_BLOCK, new ScriptEngineSnapshot(scriptEnginePayload));
  state.addSnapshotBlock(SOURCE_SIDES_LIST_BLOCK, new SidesListSnapshot(sidesListPayload));
  state.addSnapshotBlock(SOURCE_TACTICAL_VIEW_BLOCK, new TacticalViewSnapshot(tacticalViewPayload));
  for (const passthroughBlock of orderedPassthroughBlocks) {
    if (passthroughBlock.blockName.toLowerCase() === SOURCE_IN_GAME_UI_BLOCK.toLowerCase()) {
      continue;
    }
    if (passthroughBlock.blockName.toLowerCase() === BROWSER_RUNTIME_STATE_BLOCK.toLowerCase()) {
      continue;
    }
    if (KNOWN_RUNTIME_SAVE_BLOCKS.has(passthroughBlock.blockName.toLowerCase())) {
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
  state.addSnapshotBlock(SOURCE_IN_GAME_UI_BLOCK, new InGameUiSnapshot(inGameUiPayload));
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
    if (normalizedName === SOURCE_IN_GAME_UI_BLOCK.toLowerCase()) {
      continue;
    }
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
  const playersSnapshot = new PlayersSnapshot();
  const partitionSnapshot = new PartitionSnapshot();
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
  state.addSnapshotBlock(SOURCE_PLAYERS_BLOCK, playersSnapshot);
  state.addSnapshotBlock(SOURCE_PARTITION_BLOCK, partitionSnapshot);
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
  const teamFactoryChunk = extractSaveChunkData(data, SOURCE_TEAM_FACTORY_BLOCK);
  const legacyTeamFactoryState = teamFactoryChunk
    ? tryParseLegacyTeamFactoryChunk(teamFactoryChunk)
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
    cameraState: resolveRestoredCameraState(tacticalViewSnapshot.payload, browserCameraState),
    tacticalViewState: tacticalViewSnapshot.payload,
    gameClientState: parseGameClientState(data),
    particleSystemState,
    sourceTeamFactoryChunkData: teamFactoryChunk ?? null,
    gameLogicTerrainLogicState: terrainLogicSnapshot?.payload ?? null,
    gameLogicTeamFactoryState: legacyTeamFactoryState,
    gameLogicPlayersState: playersSnapshot?.payload ?? null,
    gameLogicPartitionState: partitionSnapshot?.payload ?? null,
    gameLogicRadarState: radarSnapshot?.payload ?? null,
    gameLogicSidesListState: sidesListSnapshot?.payload ?? null,
    gameLogicScriptEngineState: scriptEngineSnapshot?.payload ?? null,
    gameLogicInGameUiState: inGameUiSnapshot?.payload ?? null,
    gameLogicCoreState: gameLogicSnapshot?.payload ?? null,
    gameLogicState: payload?.gameLogicState ?? null,
    campaign,
    passthroughBlocks: extractPassthroughBlocks(data).filter(
      (block) => block.blockName.toLowerCase() !== SOURCE_GAME_CLIENT_BLOCK.toLowerCase(),
    ),
  };
}
