/**
 * C&C Generals: Zero Hour — Browser Port
 *
 * Application entry point. Two-phase initialization:
 *   Phase 1 (preInit): Renderer, scene, assets, INI data, audio setup
 *   Phase 2 (startGame): Map load, game logic, game loop
 *
 * Between phases the game shell (main menu / skirmish setup) is shown.
 * If a ?map= URL parameter is present, the shell is skipped for backward
 * compatibility with direct-load workflows.
 */

import * as THREE from 'three';
import { GameRandom } from '@generals/core';
import {
  GameLoop,
  ReplayManager,
  ReplayStorage,
  SaveStorage,
  SubsystemRegistry,
  type ReplayFile,
  type ReplayPlayerInfo,
} from '@generals/engine';
import {
  AssetManager,
  RUNTIME_ASSET_BASE_URL,
  RUNTIME_MANIFEST_FILE,
} from '@generals/assets';
import {
  ObjectVisualManager,
  TerrainVisual,
  WaterVisual,
  GameLODManager,
  ParticleSystemManager,
  FXListManager,
  DecalManager,
  LaserBeamRenderer,
  DynamicLightManager,
  TracerRenderer,
  DebrisRenderer,
  TerrainRoadRenderer,
  TerrainBridgeRenderer,
  type TerrainBridgeDefinition,
} from '@generals/renderer';
import type { MapDataJSON } from '@generals/renderer';
import { ShroudRenderer } from '@generals/renderer';
import { InputManager, RTSCamera, type InputState } from '@generals/input';
import {
  AudioAffect,
  AudioControl,
  AudioManager,
  AudioPriority,
  AudioType,
  SoundType,
  initializeAudioContext,
} from '@generals/audio';
import { IniDataRegistry, type AudioEventDef, type IniDataBundle } from '@generals/ini-data';
import { initializeNetworkClient } from '@generals/network';
import {
  classifyCampaignReference,
  GameLogicSubsystem,
  isLiveCampaignLifecycle,
  resolveRenderAssetProfile,
} from '@generals/game-logic';
import {
  UiRuntime,
  initializeUiOverlay,
  GUICommandType,
  CommandCardRenderer,
  MappedImageResolver,
} from '@generals/ui';
import {
  playUiFeedbackAudio,
} from './control-bar-audio.js';
import { buildControlBarButtonsForSelections } from './control-bar-buttons.js';
import { cancelProductionForButton, dispatchIssuedControlBarCommands } from './control-bar-dispatch.js';
import {
  isObjectTargetAllowedForSelection,
  isObjectTargetRelationshipAllowed,
} from './control-bar-targeting.js';
import { planCombatVisualEffects } from './combat-visual-effects.js';
import { VoiceAudioBridge } from './voice-audio-bridge.js';
import { MusicManager } from './music-manager.js';
import { collectShortcutSpecialPowerReadyFrames } from './shortcut-special-power-sources.js';
import { resolveSfxVolumesFromAudioSettings } from './audio-settings.js';
import {
  extractAudioOptionPreferences,
  loadOptionPreferencesFromStorage,
} from './option-preferences.js';
import { applyScriptInputLock } from './script-input-lock.js';
import {
  resolveScriptRadarEntityBlipVisibility,
  resolveScriptRadarInteractionEnabled,
  resolveScriptRadarVisibility,
} from './script-radar-visibility.js';
import { syncPlayerSidesFromNetwork } from './player-side-sync.js';
import { createControlHarness } from './control-harness.js';
import { createScriptAudioRuntimeBridge } from './script-audio-runtime.js';
import { createScriptCameraEffectsRuntimeBridge } from './script-camera-effects-runtime.js';
import { createScriptCameraRuntimeBridge } from './script-camera-runtime.js';
import { createScriptCinematicRuntimeBridge } from './script-cinematic-runtime.js';
import { createScriptEmoticonRuntimeBridge } from './script-emoticon-runtime.js';
import { createScriptEvaRuntimeBridge } from './script-eva-runtime.js';
import { createScriptMessageRuntimeBridge } from './script-message-runtime.js';
import { createScriptObjectAmbientAudioRuntimeBridge } from './script-object-ambient-audio-runtime.js';
import { ScriptSkyboxController } from './script-skybox.js';
import { createScriptUiEffectsRuntimeBridge } from './script-ui-effects-runtime.js';
import { syncScriptViewRuntimeBridge } from './script-view-runtime.js';
import { assertIniBundleConsistency, assertRequiredManifestEntries } from './runtime-guardrails.js';
import {
  GameShell,
  type SkirmishSettings,
  type SkirmishSlotMode,
  type CampaignStartSettings,
} from './game-shell.js';
import { CampaignManager } from '@generals/game-logic';
import { createVideoUrlResolver, VideoPlayer } from './video-player.js';
import {
  buildChallengePersonasFromRegistry,
  getEnabledChallengePersonas,
} from './challenge-generals.js';
import { buildStartingCreditsOptionsFromRegistry } from './shell-runtime-data.js';
import { loadLocalizationStrings } from './localization.js';
import {
  OptionsScreen,
  saveOptionsToStorage,
  loadOptionsState,
  type OptionsState,
} from './options-screen.js';
import { LoadGameScreen } from './load-game-screen.js';
import { ReplayMenuScreen } from './replay-menu-screen.js';
import { DiplomacyScreen, type DiplomacyPlayerInfo } from './diplomacy-screen.js';
import { GeneralsPowersPanel } from './generals-powers-panel.js';
import { PostgameStatsScreen, type SideScoreDisplay } from './postgame-stats-screen.js';
import { createAudioBufferLoader } from './audio-buffer-loader.js';
import { CursorManager, resolveGameCursor, detectEdgeScrollDir } from './cursor-manager.js';
import { formatTemplateName } from './hover-tooltip.js';
import { collectSourceMapObjectSupplements } from './map-object-supplements.js';
import {
  getSourceCameraOrbitPitchAngle,
  resolveSourceHeightScaledZoomWorldDistance,
} from './source-camera.js';
import {
  buildRuntimeSaveInGameUiState,
  buildRuntimeSaveFile,
  createRuntimeSaveInGameUiSuperweaponKey,
  parseRuntimeSaveFile,
  SOURCE_GAME_MODE_SINGLE_PLAYER,
  SOURCE_GAME_MODE_SKIRMISH,
  type RuntimeSaveBootstrap,
  type RuntimeSaveTrackedInGameUiSuperweaponState,
} from './runtime-save-game.js';
import { applySourceTeamFactoryChunkToState } from './runtime-team-factory-save.js';

// ============================================================================
// Loading screen
// ============================================================================

const loadingBar = document.getElementById('loading-bar') as HTMLDivElement;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;
const loadingMinimap = document.getElementById('loading-minimap') as HTMLCanvasElement;

function setLoadingProgress(percent: number, status: string): void {
  loadingBar.style.width = `${percent}%`;
  loadingStatus.textContent = status;
}

function showLoadingScreen(): void {
  loadingScreen.style.display = 'flex';
  loadingScreen.style.opacity = '1';
}

interface RoadIniEntry {
  name?: string;
  type?: string;
  fields?: Record<string, unknown>;
}

const ROADS_INI_JSON_PATH = 'data/_extracted/INIZH/Data/INI/Roads.json';

function resolvePlayerTemplateNum(
  iniDataRegistry: IniDataRegistry,
  playerTemplateName: string | null | undefined,
): number {
  const normalized = playerTemplateName?.trim();
  if (!normalized) {
    return -1;
  }
  let index = 0;
  for (const factionName of iniDataRegistry.factions.keys()) {
    if (factionName === normalized) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function resolveChallengePlayerDisplayName(
  iniDataRegistry: IniDataRegistry,
  campaignName: string | null | undefined,
  playerTemplateName: string | null | undefined,
): string {
  const normalizedCampaignName = campaignName?.trim().toLowerCase() ?? '';
  const normalizedPlayerTemplateName = playerTemplateName?.trim() ?? '';
  const persona = buildChallengePersonasFromRegistry(iniDataRegistry).find((candidate) =>
    candidate.campaignName === normalizedCampaignName
      || candidate.playerTemplateName === normalizedPlayerTemplateName,
  );
  return persona?.name ?? normalizedPlayerTemplateName;
}

async function loadTerrainRoadEntries(assets: AssetManager): Promise<RoadIniEntry[]> {
  try {
    const handle = await assets.loadJSON<RoadIniEntry[]>(ROADS_INI_JSON_PATH);
    return Array.isArray(handle.data) ? handle.data : [];
  } catch (error) {
    console.warn('Failed to load Roads.ini JSON; road helper filtering will use fallback names only.', error);
    return [];
  }
}

function collectTerrainRoadTemplateNames(entries: readonly RoadIniEntry[]): Set<string> {
  return new Set(
    entries
      .filter((entry) => typeof entry.name === 'string')
      .map((entry) => entry.name!.trim().toUpperCase())
      .filter((name) => name.length > 0),
  );
}

function collectTerrainBridgeDefinitions(entries: readonly RoadIniEntry[]): Map<string, TerrainBridgeDefinition> {
  const definitions = new Map<string, TerrainBridgeDefinition>();
  for (const entry of entries) {
    if (entry.type !== 'Bridge' || typeof entry.name !== 'string') {
      continue;
    }
    const modelName = typeof entry.fields?.BridgeModelName === 'string'
      ? entry.fields.BridgeModelName
      : null;
    if (!modelName || modelName.trim().length === 0) {
      continue;
    }
    const bridgeScale = entry.fields?.BridgeScale;
    const scale = typeof bridgeScale === 'number' && Number.isFinite(bridgeScale)
      ? bridgeScale
      : 1;
    definitions.set(entry.name.trim().toUpperCase(), {
      name: entry.name.trim(),
      modelName: modelName.trim(),
      scale,
    });
  }
  return definitions;
}

function normalizeMapScorchType(rawValue: unknown): string {
  const normalized = String(rawValue ?? '').trim().toUpperCase();
  if (!normalized || normalized === '0' || normalized === 'RANDOM') {
    return 'RANDOM';
  }
  if (/^[1-4]$/.test(normalized)) {
    return `SCORCH_${normalized}`;
  }
  if (/^SCORCH_[1-4]$/.test(normalized)) {
    return normalized;
  }
  return 'RANDOM';
}

function addPreplacedMapScorchMarks(
  mapData: MapDataJSON,
  heightmap: { getInterpolatedHeight(x: number, z: number): number },
  decalManager: DecalManager,
): void {
  for (const mapObject of mapData.objects) {
    if (mapObject.templateName !== 'Scorch') {
      continue;
    }

    const properties = (mapObject.properties ?? {}) as Record<string, string | undefined>;
    const radius = Number.parseFloat(properties.objectRadius ?? '');
    if (!Number.isFinite(radius) || radius <= 0) {
      continue;
    }

    const worldX = Number.isFinite(mapObject.position.x) ? mapObject.position.x : 0;
    const worldZ = Number.isFinite(mapObject.position.y) ? mapObject.position.y : 0;
    const rawElevation = Number.isFinite(mapObject.position.z) ? mapObject.position.z : 0;
    const terrainHeight = heightmap.getInterpolatedHeight(worldX, worldZ);
    decalManager.addScorchMark(
      normalizeMapScorchType(properties.scorchType),
      radius,
      new THREE.Vector3(worldX, terrainHeight + rawElevation, worldZ),
      0,
    );
  }
}

async function hideLoadingScreen(): Promise<void> {
  setLoadingProgress(100, 'Ready!');
  await new Promise((resolve) => setTimeout(resolve, 300));
  loadingScreen.style.opacity = '0';
  await new Promise((resolve) => setTimeout(resolve, 500));
  loadingScreen.style.display = 'none';
  loadingMinimap.style.display = 'none';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTextureUrlMap(
  manifest: { getOutputPaths(): string[] } | null,
): ReadonlyMap<string, string> {
  const textureUrls = new Map<string, string>();
  if (!manifest) {
    return textureUrls;
  }

  for (const outputPath of manifest.getOutputPaths()) {
    if (!outputPath.toLowerCase().endsWith('.rgba')) {
      continue;
    }
    const fileName = outputPath.split('/').pop()?.toLowerCase();
    if (!fileName || textureUrls.has(fileName)) {
      continue;
    }
    textureUrls.set(fileName, `${RUNTIME_ASSET_BASE_URL}/${outputPath}`);
  }

  return textureUrls;
}

const runtimeAssetPrefixPattern = new RegExp(`^${escapeRegExp(RUNTIME_ASSET_BASE_URL)}/`, 'i');
const runtimeAssetBasePattern = new RegExp(`^${escapeRegExp(RUNTIME_ASSET_BASE_URL)}$`, 'i');

function normalizeRuntimeAssetPath(pathValue: string | null): string | null {
  if (!pathValue) return null;
  const normalized = pathValue
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/\.\//g, '/')
    .replace(/\/{2,}/g, '/');
  if (runtimeAssetBasePattern.test(normalized)) {
    return '';
  }
  return normalized.replace(runtimeAssetPrefixPattern, '');
}

function encodeRuntimeSaveJsonFallback(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function resolveRuntimeSaveEmbeddedMapBytes(
  assets: AssetManager,
  mapPath: string | null,
  mapData: MapDataJSON,
): Promise<Uint8Array> {
  if (!mapPath) {
    return encodeRuntimeSaveJsonFallback(mapData);
  }

  const manifest = assets.getManifest();
  const entry = manifest?.getByOutputPath(mapPath);
  if (!entry || !entry.sourcePath.toLowerCase().endsWith('.map')) {
    return encodeRuntimeSaveJsonFallback(mapData);
  }

  const response = await fetch(`${RUNTIME_ASSET_BASE_URL}/${entry.sourcePath}`, {
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(
      `Failed to load retail map bytes for "${mapPath}" from "${entry.sourcePath}" (HTTP ${response.status})`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

type ReplayRecordableCommand = Parameters<GameLogicSubsystem['submitCommand']>[0];

const REPLAY_RECORDABLE_COMMAND_TYPES = new Set<ReplayRecordableCommand['type']>([
  'moveTo',
  'attackMoveTo',
  'guardPosition',
  'guardObject',
  'setRallyPoint',
  'attackEntity',
  'stop',
  'queueUnitProduction',
  'cancelUnitProduction',
  'queueUpgradeProduction',
  'cancelUpgradeProduction',
  'purchaseScience',
  'issueSpecialPower',
  'switchWeapon',
  'sell',
  'exitContainer',
  'exitContainerInstantly',
  'evacuate',
  'hackInternet',
  'toggleOvercharge',
  'detonateDemoTrap',
  'toggleDemoTrapMode',
  'combatDrop',
  'placeBeacon',
  'enterObject',
  'constructBuilding',
  'cancelDozerConstruction',
  'garrisonBuilding',
  'repairBuilding',
  'enterTransport',
]);

interface ReplayPlaybackContext {
  replay: ReplayFile;
  settings: SkirmishSettings;
  onReturnToShell: () => void;
}

interface ResolvedSkirmishRuntimeSlot {
  slotIndex: number;
  playerName: string;
  mode: SkirmishSlotMode;
  factionSide: string;
  team: number;
  color: number;
  startPosition: number | null;
  runtimeSide: string;
  playerType: 'HUMAN' | 'COMPUTER';
  difficulty: number;
}

const SKIRMISH_RUNTIME_SIDE_PREFIX = 'Player_';
const SKIRMISH_PLAYABLE_FACTION_SIDES = ['America', 'China', 'GLA'] as const;
const SKIRMISH_MULTIPLAYER_COLORS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const SCRIPT_DIFFICULTY_EASY = 0;
const SCRIPT_DIFFICULTY_NORMAL = 1;
const SCRIPT_DIFFICULTY_HARD = 2;

function getSkirmishRuntimeSide(slotIndex: number): string {
  return `${SKIRMISH_RUNTIME_SIDE_PREFIX}${slotIndex + 1}`;
}

function normalizeFactionSideName(side: string): string {
  switch (side.trim().toLowerCase()) {
    case 'america':
      return 'America';
    case 'china':
      return 'China';
    case 'gla':
      return 'GLA';
    default:
      return side;
  }
}

function isRandomFactionSide(side: string): boolean {
  return side.trim().toLowerCase() === 'random';
}

function resolvePlayerFactionNameForSide(side: string): string {
  switch (side.trim().toLowerCase()) {
    case 'america':
      return 'FactionAmerica';
    case 'china':
      return 'FactionChina';
    case 'gla':
      return 'FactionGLA';
    default:
      return side;
  }
}

function resolveSkirmishPlayerType(mode: SkirmishSlotMode): 'HUMAN' | 'COMPUTER' {
  return mode === 'human' ? 'HUMAN' : 'COMPUTER';
}

function resolveSkirmishDifficulty(mode: SkirmishSlotMode): number {
  switch (mode) {
    case 'easy-ai':
      return SCRIPT_DIFFICULTY_EASY;
    case 'hard-ai':
      return SCRIPT_DIFFICULTY_HARD;
    case 'human':
    case 'medium-ai':
    default:
      return SCRIPT_DIFFICULTY_NORMAL;
  }
}

function resolveReplaySlotMode(player: ReplayPlayerInfo): 'human' | 'easy-ai' | 'medium-ai' | 'hard-ai' {
  if (player.slotMode === 'human'
    || player.slotMode === 'easy-ai'
    || player.slotMode === 'medium-ai'
    || player.slotMode === 'hard-ai') {
    return player.slotMode;
  }
  return player.playerType === 'COMPUTER' ? 'easy-ai' : 'human';
}

function resolveResolvedFactionSide(
  side: string,
  gameLogic?: Pick<GameLogicSubsystem, 'getResolvedFactionSide'>,
): string {
  const resolved = gameLogic?.getResolvedFactionSide(side);
  if (resolved) {
    return normalizeFactionSideName(resolved);
  }
  return normalizeFactionSideName(side);
}

function resolveSkirmishRuntimeSlots(
  settings: SkirmishSettings,
  gameLogic: Pick<GameLogicSubsystem, 'assignTeamClusteredStartPositions'>,
  startSpots: Array<{ x: number; z: number }>,
): ResolvedSkirmishRuntimeSlot[] {
  const rng = new GameRandom((Date.now() >>> 0) || 1);
  const occupiedSlots = settings.slots
    .filter((slot) => slot.mode === 'human' || slot.mode === 'easy-ai' || slot.mode === 'medium-ai' || slot.mode === 'hard-ai')
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex);
  const resolvedSlots: ResolvedSkirmishRuntimeSlot[] = [];
  const usedColors = new Set<number>();

  for (const slot of occupiedSlots) {
    const factionSide = isRandomFactionSide(slot.side)
      ? SKIRMISH_PLAYABLE_FACTION_SIDES[rng.nextRange(0, SKIRMISH_PLAYABLE_FACTION_SIDES.length - 1)]!
      : normalizeFactionSideName(slot.side);
    let color = Number.isFinite(slot.color) ? Math.trunc(slot.color) : -1;
    if (
      color < 0
      || color >= SKIRMISH_MULTIPLAYER_COLORS.length
      || usedColors.has(color)
    ) {
      const availableColors = SKIRMISH_MULTIPLAYER_COLORS.filter((candidate) => !usedColors.has(candidate));
      const colorPool = availableColors.length > 0 ? availableColors : [...SKIRMISH_MULTIPLAYER_COLORS];
      color = colorPool[rng.nextRange(0, colorPool.length - 1)]!;
    }
    usedColors.add(color);
    resolvedSlots.push({
      slotIndex: slot.slotIndex,
      playerName: slot.playerName,
      mode: slot.mode,
      factionSide,
      team: slot.team,
      color,
      startPosition: Number.isFinite(slot.startPosition) ? Math.trunc(slot.startPosition as number) : null,
      runtimeSide: getSkirmishRuntimeSide(slot.slotIndex),
      playerType: resolveSkirmishPlayerType(slot.mode),
      difficulty: resolveSkirmishDifficulty(slot.mode),
    });
  }

  if (startSpots.length > 0) {
    const takenStartPositions = new Set<number>();
    for (const slot of resolvedSlots) {
      if (
        slot.startPosition === null
        || slot.startPosition <= 0
        || slot.startPosition > startSpots.length
        || takenStartPositions.has(slot.startPosition)
      ) {
        slot.startPosition = null;
        continue;
      }
      takenStartPositions.add(slot.startPosition);
    }

    const slotsNeedingStartPositions = resolvedSlots.filter((slot) => slot.startPosition === null);
    if (slotsNeedingStartPositions.length > 0) {
      const remainingStartIndices = startSpots
        .map((_spot, index) => index)
        .filter((index) => !takenStartPositions.has(index + 1));
      const remainingStartSpots = remainingStartIndices.map((index) => startSpots[index]!);
      const assignedPositions = gameLogic.assignTeamClusteredStartPositions(
        slotsNeedingStartPositions.map((slot) => ({ side: slot.runtimeSide, team: slot.team })),
        remainingStartSpots,
        remainingStartSpots.length > 1 ? rng.nextRange(0, remainingStartSpots.length - 1) : 0,
      );
      slotsNeedingStartPositions.forEach((slot, index) => {
        const assignedIndex = assignedPositions[index];
        if (assignedIndex === undefined) {
          return;
        }
        const originalIndex = remainingStartIndices[assignedIndex - 1];
        if (originalIndex !== undefined) {
          slot.startPosition = originalIndex + 1;
          takenStartPositions.add(slot.startPosition);
        }
      });
    }
  }

  return resolvedSlots;
}

function mergeSkirmishSidesIntoMapData(
  mapData: MapDataJSON,
  resolvedSlots: readonly ResolvedSkirmishRuntimeSlot[],
): void {
  const existingSides = mapData.sidesList?.sides ?? [];
  const preservedSides = existingSides.filter((side) => {
    const playerName = typeof side.dict?.playerName === 'string' ? side.dict.playerName.trim().toUpperCase() : '';
    return !playerName.startsWith(SKIRMISH_RUNTIME_SIDE_PREFIX.toUpperCase());
  });
  mapData.sidesList = {
    sides: [
      ...preservedSides,
      ...resolvedSlots.map((slot) => ({
        dict: {
          playerName: slot.runtimeSide,
          playerFaction: resolvePlayerFactionNameForSide(slot.factionSide),
          playerIsHuman: slot.playerType === 'HUMAN',
          skirmishDifficulty: slot.difficulty,
        },
        buildList: [],
      })),
    ],
    teams: mapData.sidesList?.teams ? [...mapData.sidesList.teams] : [],
  };
}

function extractSkirmishStartSpots(mapData: MapDataJSON): Array<{ x: number; z: number }> {
  const startSpots: Array<{ x: number; z: number }> = [];
  for (let index = 1; index <= 8; index += 1) {
    const waypointName = `Player_${index}_Start`;
    const node = mapData.waypoints?.nodes.find((candidate) => candidate.name === waypointName);
    if (!node) {
      break;
    }
    startSpots.push({ x: node.position.x, z: node.position.y });
  }
  return startSpots;
}

function shouldRecordReplayCommand(command: ReplayRecordableCommand): boolean {
  if (!REPLAY_RECORDABLE_COMMAND_TYPES.has(command.type)) {
    return false;
  }

  const commandSource = 'commandSource' in command ? command.commandSource : undefined;
  return commandSource !== 'AI' && commandSource !== 'SCRIPT';
}

function cloneReplayCommand(command: ReplayRecordableCommand): Record<string, unknown> {
  return JSON.parse(JSON.stringify(command)) as Record<string, unknown>;
}

function buildReplayPlayers(settings: SkirmishSettings): ReplayPlayerInfo[] {
  return settings.slots
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((slot) => ({
      id: slot.slotIndex,
      name: slot.playerName,
      side: slot.side,
      team: slot.team,
      color: slot.color,
      slotIndex: slot.slotIndex,
      playerType: resolveSkirmishPlayerType(slot.mode),
      slotMode: slot.mode,
      startPosition: slot.startPosition,
    }));
}

function buildReplayId(mapPath: string, timestampMs: number): string {
  const mapLabel = (mapPath.replace(/\\/g, '/').split('/').pop() ?? 'replay')
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const isoStamp = new Date(timestampMs).toISOString().replace(/[:.]/g, '-');
  return `${mapLabel || 'replay'}-${isoStamp}`;
}

function buildReplayDescription(mapPath: string, timestampMs: number): string {
  const mapLabel = (mapPath.replace(/\\/g, '/').split('/').pop() ?? 'Replay').replace(/\.json$/i, '');
  return `${mapLabel} ${new Date(timestampMs).toLocaleString()}`;
}

function buildSkirmishSettingsFromReplay(replay: ReplayFile): SkirmishSettings {
  if (replay.players.length === 0) {
    throw new Error('Replay is missing its local player definition.');
  }
  return {
    mapPath: replay.mapPath,
    slots: replay.players
      .map((player) => {
        const slotIndex = Number.isFinite(player.slotIndex) ? Math.trunc(player.slotIndex as number) : player.id;
        return {
          slotIndex,
          playerName: player.name,
          mode: resolveReplaySlotMode(player),
          side: normalizeFactionSideName(player.side),
          team: Number.isFinite(player.team) ? Math.trunc(player.team) : -1,
          color: Number.isFinite(player.color) ? Math.trunc(player.color) : -1,
          startPosition: Number.isFinite(player.startPosition) ? Math.trunc(player.startPosition as number) : null,
        };
      })
      .sort((a, b) => a.slotIndex - b.slotIndex),
    startingCredits: replay.startingCredits,
    limitSuperweapons: replay.limitSuperweapons ?? false,
  };
}

const AUDIO_PRIORITY_BY_NAME = new Map<string, AudioPriority>([
  ['LOWEST', AudioPriority.AP_LOWEST],
  ['LOW', AudioPriority.AP_LOW],
  ['NORMAL', AudioPriority.AP_NORMAL],
  ['HIGH', AudioPriority.AP_HIGH],
  ['CRITICAL', AudioPriority.AP_CRITICAL],
]);

const SOUND_TYPE_MASK_BY_NAME = new Map<string, number>([
  ['UI', SoundType.ST_UI],
  ['WORLD', SoundType.ST_WORLD],
  ['SHROUDED', SoundType.ST_SHROUDED],
  ['GLOBAL', SoundType.ST_GLOBAL],
  ['VOICE', SoundType.ST_VOICE],
  ['PLAYER', SoundType.ST_PLAYER],
  ['ALLIES', SoundType.ST_ALLIES],
  ['ENEMIES', SoundType.ST_ENEMIES],
  ['EVERYONE', SoundType.ST_EVERYONE],
]);

const AUDIO_CONTROL_MASK_BY_NAME = new Map<string, number>([
  ['LOOP', AudioControl.AC_LOOP],
  ['RANDOM', AudioControl.AC_RANDOM],
  ['ALL', AudioControl.AC_ALL],
  ['POSTDELAY', AudioControl.AC_POSTDELAY],
  ['INTERRUPT', AudioControl.AC_INTERRUPT],
]);

function audioTypeFromIniSoundType(soundType: AudioEventDef['soundType']): AudioType {
  switch (soundType) {
    case 'music':
      return AudioType.AT_Music;
    case 'streaming':
      return AudioType.AT_Streaming;
    case 'sound':
    default:
      return AudioType.AT_SoundEffect;
  }
}

function defaultAudioEventNameForType(soundType: AudioEventDef['soundType']): string {
  switch (soundType) {
    case 'music':
      return 'DefaultMusicTrack';
    case 'streaming':
      return 'DefaultDialog';
    case 'sound':
    default:
      return 'DefaultSoundEffect';
  }
}

function applyBitMaskNames(
  names: readonly string[],
  maskByName: ReadonlyMap<string, number>,
): number | undefined {
  if (names.length === 0) {
    return undefined;
  }

  let mask = 0;
  for (const name of names) {
    const bit = maskByName.get(name);
    if (bit !== undefined) {
      mask |= bit;
    }
  }
  return mask;
}

function resolveAudioEventLoopCount(audioEvent: AudioEventDef): number | undefined {
  for (const [rawKey, rawValue] of Object.entries(audioEvent.fields)) {
    if (rawKey.trim().toLowerCase() !== 'loopcount') {
      continue;
    }
    const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const parsed = typeof candidate === 'number'
      ? candidate
      : (typeof candidate === 'string' ? Number(candidate.trim()) : Number.NaN);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(0, Math.trunc(parsed));
  }
  return undefined;
}

/**
 * Extract the Sounds list from an AudioEventDef's fields.
 * Source parity: AudioEventInfo::m_sounds — parsed via INI::parseSoundsList.
 * In the INI bundle, the Sounds field is stored as a space-separated string
 * or an array of strings.
 */
function resolveAudioEventSounds(audioEvent: AudioEventDef): string[] | undefined {
  for (const [rawKey, rawValue] of Object.entries(audioEvent.fields)) {
    if (rawKey.trim().toLowerCase() !== 'sounds') {
      continue;
    }
    if (Array.isArray(rawValue)) {
      const sounds: string[] = [];
      for (const item of rawValue) {
        if (typeof item === 'string' && item.trim().length > 0) {
          // Each item may itself be space-separated.
          for (const part of item.trim().split(/\s+/)) {
            if (part.length > 0) sounds.push(part);
          }
        }
      }
      return sounds.length > 0 ? sounds : undefined;
    }
    if (typeof rawValue === 'string') {
      const sounds = rawValue.trim().split(/\s+/).filter(s => s.length > 0);
      return sounds.length > 0 ? sounds : undefined;
    }
  }
  return undefined;
}

/**
 * Extract PitchShift min/max from an AudioEventDef's fields.
 * Source parity: parsePitchShift — "PitchShift = min max" where min/max are
 * percentages. Stored as 1.0 + (percentage / 100).
 */
function resolveAudioEventPitchShift(audioEvent: AudioEventDef): {
  pitchShiftMin?: number;
  pitchShiftMax?: number;
} {
  for (const [rawKey, rawValue] of Object.entries(audioEvent.fields)) {
    if (rawKey.trim().toLowerCase() !== 'pitchshift') {
      continue;
    }
    let values: string[];
    if (Array.isArray(rawValue)) {
      values = rawValue.map(v => String(v).trim()).filter(s => s.length > 0);
    } else if (typeof rawValue === 'string') {
      values = rawValue.trim().split(/\s+/).filter(s => s.length > 0);
    } else {
      continue;
    }
    if (values.length >= 2) {
      const minPct = Number(values[0]);
      const maxPct = Number(values[1]);
      if (Number.isFinite(minPct) && Number.isFinite(maxPct)) {
        return {
          pitchShiftMin: 1 + minPct / 100,
          pitchShiftMax: 1 + maxPct / 100,
        };
      }
    }
  }
  return {};
}

/**
 * Extract VolumeShift from an AudioEventDef's fields.
 * Source parity: AudioEventInfo::m_volumeShift — a percentage that represents
 * the random volume reduction range.
 */
function resolveAudioEventVolumeShift(audioEvent: AudioEventDef): number | undefined {
  for (const [rawKey, rawValue] of Object.entries(audioEvent.fields)) {
    if (rawKey.trim().toLowerCase() !== 'volumeshift') {
      continue;
    }
    const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const parsed = typeof candidate === 'number'
      ? candidate
      : (typeof candidate === 'string' ? Number(candidate.trim()) : Number.NaN);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    // VolumeShift is stored as a percentage (e.g., 10% means volume varies 0.9..1.0).
    // Convert to a negative fraction for the audio engine (-0.1).
    return -(Math.abs(parsed) / 100);
  }
  return undefined;
}

/**
 * Extract Delay min/max from an AudioEventDef's fields.
 * Source parity: parseDelay — "Delay = min max" in milliseconds.
 */
function resolveAudioEventDelay(audioEvent: AudioEventDef): {
  delayMin?: number;
  delayMax?: number;
} {
  for (const [rawKey, rawValue] of Object.entries(audioEvent.fields)) {
    if (rawKey.trim().toLowerCase() !== 'delay') {
      continue;
    }
    let values: string[];
    if (Array.isArray(rawValue)) {
      values = rawValue.map(v => String(v).trim()).filter(s => s.length > 0);
    } else if (typeof rawValue === 'string') {
      values = rawValue.trim().split(/\s+/).filter(s => s.length > 0);
    } else {
      continue;
    }
    if (values.length >= 2) {
      const min = Number(values[0]);
      const max = Number(values[1]);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        return { delayMin: Math.max(0, min), delayMax: Math.max(0, max) };
      }
    }
  }
  return {};
}

function resolveAudioEventDefaults(
  iniDataRegistry: IniDataRegistry,
  audioEvent: AudioEventDef,
): AudioEventDef {
  const defaultName = defaultAudioEventNameForType(audioEvent.soundType);
  if (audioEvent.name === defaultName) {
    return audioEvent;
  }

  const defaults = iniDataRegistry.getAudioEvent(defaultName);
  if (!defaults) {
    return audioEvent;
  }

  return {
    ...audioEvent,
    priorityName: audioEvent.priorityName ?? defaults.priorityName,
    typeNames: (audioEvent.typeNames?.length ?? 0) > 0 ? [...audioEvent.typeNames!] : [...(defaults.typeNames ?? [])],
    controlNames: (audioEvent.controlNames?.length ?? 0) > 0 ? [...audioEvent.controlNames!] : [...(defaults.controlNames ?? [])],
    volume: audioEvent.volume ?? defaults.volume,
    minVolume: audioEvent.minVolume ?? defaults.minVolume,
    limit: audioEvent.limit ?? defaults.limit,
    minRange: audioEvent.minRange ?? defaults.minRange,
    maxRange: audioEvent.maxRange ?? defaults.maxRange,
    filename: audioEvent.filename ?? defaults.filename,
  };
}

function registerIniAudioEvents(
  iniDataRegistry: IniDataRegistry,
  audioManager: AudioManager,
): number {
  let registeredCount = 0;

  for (const audioEvent of iniDataRegistry.audioEvents.values()) {
    const resolved = resolveAudioEventDefaults(iniDataRegistry, audioEvent);
    const soundType = audioTypeFromIniSoundType(resolved.soundType);
    const priority = resolved.priorityName
      ? AUDIO_PRIORITY_BY_NAME.get(resolved.priorityName)
      : undefined;
    const typeMask = applyBitMaskNames(resolved.typeNames, SOUND_TYPE_MASK_BY_NAME);
    const controlMask = applyBitMaskNames(resolved.controlNames, AUDIO_CONTROL_MASK_BY_NAME);
    const loopCount = resolveAudioEventLoopCount(resolved);
    const sounds = resolveAudioEventSounds(resolved);
    const { pitchShiftMin, pitchShiftMax } = resolveAudioEventPitchShift(resolved);
    const volumeShift = resolveAudioEventVolumeShift(resolved);
    const { delayMin, delayMax } = resolveAudioEventDelay(resolved);

    audioManager.addAudioEventInfo({
      audioName: resolved.name,
      filename: resolved.filename,
      soundType,
      priority,
      type: typeMask,
      control: controlMask,
      loopCount,
      volume: resolved.volume,
      volumeShift,
      minVolume: resolved.minVolume,
      limit: resolved.limit,
      minRange: resolved.minRange,
      maxRange: resolved.maxRange,
      sounds,
      pitchShiftMin,
      pitchShiftMax,
      delayMin,
      delayMax,
    });

    if (soundType === AudioType.AT_Music && resolved.name !== 'DefaultMusicTrack') {
      audioManager.addTrackName(resolved.name);
    }
    registeredCount += 1;
  }

  return registeredCount;
}

// ============================================================================
// Side-to-faction label mapping
// ============================================================================

function sideToFactionLabel(side: string): string {
  const lower = side.toLowerCase();
  if (lower === 'america') return 'USA';
  if (lower === 'china') return 'China';
  if (lower === 'gla') return 'GLA';
  if (lower === 'civilian') return 'Civilian';
  return side;
}

// ============================================================================
// Options state application
// ============================================================================

/**
 * Apply options state to audio manager and camera controller.
 * Source parity: OptionsMenu.cpp OptionsMenuAcceptSystem applies slider values
 * to AudioManager volumes and InGameUI scroll speed.
 */
function applyOptionsState(
  state: OptionsState,
  audioManager: AudioManager,
  rtsCamera: RTSCamera,
): void {
  audioManager.setMusicVolume(state.musicVolume / 100);
  audioManager.setSfxVolume(state.sfxVolume / 100);
  audioManager.setVolume(
    state.voiceVolume / 100,
    AudioAffect.AudioAffect_Speech | AudioAffect.AudioAffect_SystemSetting,
  );
  // Source parity: scroll speed 0–100 maps to 100–800 world units/s.
  rtsCamera.setScrollSpeed(100 + (state.scrollSpeed / 100) * 700);
}

// ============================================================================
// Pre-initialization context (shared between menu and game)
// ============================================================================

interface PreInitContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sunLight: THREE.DirectionalLight;
  canvas: HTMLCanvasElement;
  subsystems: SubsystemRegistry;
  assets: AssetManager;
  inputManager: InputManager;
  rtsCamera: RTSCamera;
  terrainVisual: TerrainVisual;
  waterVisual: WaterVisual;
  audioManager: AudioManager;
  cursorManager: CursorManager;
  networkManager: ReturnType<typeof initializeNetworkClient>;
  uiRuntime: UiRuntime;
  iniDataRegistry: IniDataRegistry;
  iniDataInfo: string;
  saveStorage: SaveStorage;
  replayStorage: ReplayStorage;
}

interface RuntimeSaveLoadContext {
  runtimeSave: RuntimeSaveBootstrap;
}

interface RuntimeSaveCampaignServices {
  campaignManager: CampaignManager;
  videoPlayer: VideoPlayer | null;
  onReturnToShell: () => void;
}

// ============================================================================
// Phase 1: Pre-initialization (assets, renderer, INI data, audio)
// ============================================================================

async function preInit(): Promise<PreInitContext> {
  initializeAudioContext();
  const networkManager = initializeNetworkClient({ forceSinglePlayer: true });
  const saveStorage = new SaveStorage();
  const replayStorage = new ReplayStorage();
  initializeUiOverlay();

  setLoadingProgress(10, 'Creating renderer...');

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Source parity: GLTF textures are authored in sRGB; without this setting
  // Three.js r150+ renders them in linear space, causing washed-out colours.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  // Shadow map disabled for performance — re-enable with sunLight.castShadow
  // once FPS is stable above 30.
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1a1a2e);

  setLoadingProgress(20, 'Setting up scene...');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x87a5b5, 0.0008);

  // Camera
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    5000,
  );

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x607080, 0.7);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.3);
  sunLight.position.set(200, 400, 200);
  // Shadows disabled for performance — shadow map rendering at 2048x2048
  // with 580+ entities doubles the per-frame GPU cost. Re-enable once FPS
  // is stable above 30 with other optimizations in place.
  sunLight.castShadow = false;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 1000;
  sunLight.shadow.camera.left = -300;
  sunLight.shadow.camera.right = 300;
  sunLight.shadow.camera.top = 300;
  sunLight.shadow.camera.bottom = -300;
  sunLight.shadow.bias = -0.001;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Hemisphere light for natural sky/ground coloring
  const hemiLight = new THREE.HemisphereLight(0x88aacc, 0x445533, 0.4);
  scene.add(hemiLight);

  setLoadingProgress(30, 'Initializing subsystems...');

  // ========================================================================
  // Subsystems
  // ========================================================================

  const subsystems = new SubsystemRegistry();

  // Asset Manager (first — must init before any asset loads)
  // Integrity checks disabled: manifest outputHash values are stale (computed
  // at initial conversion time) and no longer match the on-disk GLB files
  // after subsequent converter updates.  Re-enable once `convert-all` is run
  // again to regenerate fresh hashes.
  const assets = new AssetManager({
    baseUrl: RUNTIME_ASSET_BASE_URL,
    manifestUrl: RUNTIME_MANIFEST_FILE,
    requireManifest: true,
    integrityChecks: false,
  });
  subsystems.register(assets);

  // Input
  const inputManager = new InputManager(canvas);
  subsystems.register(inputManager);

  // RTS Camera
  const rtsCamera = new RTSCamera(camera, {
    pitchAngle: getSourceCameraOrbitPitchAngle(undefined),
  });
  subsystems.register(rtsCamera);

  // Terrain
  const terrainVisual = new TerrainVisual(scene);
  subsystems.register(terrainVisual);

  // Water
  const waterVisual = new WaterVisual(scene);
  subsystems.register(waterVisual);

  // Audio
  const audioManager = new AudioManager({ debugLabel: '@generals/audio' });
  subsystems.register(audioManager);

  // Network
  subsystems.register(networkManager);

  // UI
  const uiRuntime = new UiRuntime({ enableDebugOverlay: false });
  subsystems.register(uiRuntime);

  // Initialize registered runtime subsystems before any asset fetches so
  // AssetManager has the manifest and cache ready.
  setLoadingProgress(35, 'Connecting to asset cache...');
  await subsystems.initAll();
  assertRequiredManifestEntries(assets.getManifest(), ['data/ini-bundle.json']);

  // Wire audio buffer loader and cursor manager from manifest
  const manifest = assets.getManifest();
  if (manifest) {
    audioManager.setAudioBufferLoader(createAudioBufferLoader(manifest));
  }

  const cursorManager = new CursorManager();
  if (manifest) {
    cursorManager.buildCursorIndex(manifest);
  }

  // ========================================================================
  // Game data (INI bundle)
  // ========================================================================

  const iniDataRegistry = new IniDataRegistry();
  let iniDataInfo = 'INI data bundle not loaded';
  try {
    const bundleHandle = await assets.loadJSON<IniDataBundle>('data/ini-bundle.json', (loaded, total) => {
      const pct = total > 0 ? Math.round(40 + (loaded / total) * 8) : 48;
      const loadedMB = (loaded / 1024 / 1024).toFixed(1);
      const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
      setLoadingProgress(pct, `Loading game data... ${loadedMB}/${totalMB} MB`);
    });
    assertIniBundleConsistency(bundleHandle.data);
    iniDataRegistry.loadBundle(bundleHandle.data);
    iniDataInfo = `INI bundle loaded from ${bundleHandle.cached ? 'cache' : 'network'} ` +
      `(${bundleHandle.data.stats.objects} objects, ${bundleHandle.data.stats.weapons} weapons, ` +
      `${bundleHandle.data.stats.mappedImages ?? 0} mapped images)`;
  } catch (bundleErr) {
    throw new Error(
      `Required runtime asset "data/ini-bundle.json" failed to load: ${
        bundleErr instanceof Error ? bundleErr.message : String(bundleErr)
      }`,
    );
  }

  let browserStorage: Storage | null = null;
  if (typeof window !== 'undefined') {
    try {
      browserStorage = window.localStorage;
    } catch {
      browserStorage = null;
    }
  }
  const optionPreferenceEntries = loadOptionPreferencesFromStorage(
    browserStorage,
  );
  const audioOptionPreferences = extractAudioOptionPreferences(optionPreferenceEntries);
  if (optionPreferenceEntries.size > 0) {
    iniDataInfo += ` | OptionPreferences keys=${optionPreferenceEntries.size}`;
  }
  const audioSettings = iniDataRegistry.getAudioSettings();
  if (audioSettings) {
    if (audioSettings.sampleCount2D !== undefined || audioSettings.sampleCount3D !== undefined) {
      audioManager.setSampleCounts(
        audioSettings.sampleCount2D ?? Number.NaN,
        audioSettings.sampleCount3D ?? Number.NaN,
      );
      iniDataInfo +=
        ` | Audio sample pools 2D=${audioSettings.sampleCount2D ?? 'default'}` +
        ` 3D=${audioSettings.sampleCount3D ?? 'default'}`;
    }

    if (audioSettings.streamCount !== undefined) {
      audioManager.setStreamCount(audioSettings.streamCount);
      iniDataInfo += ` | Audio stream pool=${audioSettings.streamCount}`;
    }
    if (audioSettings.minSampleVolume !== undefined) {
      audioManager.setGlobalMinVolume(audioSettings.minSampleVolume);
      iniDataInfo += ` | Audio min sample volume=${audioSettings.minSampleVolume}`;
    }
    if (audioSettings.globalMinRange !== undefined || audioSettings.globalMaxRange !== undefined) {
      audioManager.setGlobalRanges(
        audioSettings.globalMinRange,
        audioSettings.globalMaxRange,
      );
      iniDataInfo +=
        ` | Audio global range=${audioSettings.globalMinRange ?? 'default'}-` +
        `${audioSettings.globalMaxRange ?? 'default'}`;
    }

    const resolvedSfxVolumes = resolveSfxVolumesFromAudioSettings(audioSettings, audioOptionPreferences);
    if (resolvedSfxVolumes.music !== undefined) {
      audioManager.setVolume(
        resolvedSfxVolumes.music,
        AudioAffect.AudioAffect_Music | AudioAffect.AudioAffect_SystemSetting,
      );
    }
    if (resolvedSfxVolumes.sound2D !== undefined) {
      audioManager.setVolume(
        resolvedSfxVolumes.sound2D,
        AudioAffect.AudioAffect_Sound | AudioAffect.AudioAffect_SystemSetting,
      );
    }
    if (resolvedSfxVolumes.sound3D !== undefined) {
      audioManager.setVolume(
        resolvedSfxVolumes.sound3D,
        AudioAffect.AudioAffect_Sound3D | AudioAffect.AudioAffect_SystemSetting,
      );
    }
    if (resolvedSfxVolumes.speech !== undefined) {
      audioManager.setVolume(
        resolvedSfxVolumes.speech,
        AudioAffect.AudioAffect_Speech | AudioAffect.AudioAffect_SystemSetting,
      );
    }

    if (resolvedSfxVolumes.usedOptionPreferenceOverrides) {
      iniDataInfo += ' | Audio OptionPreferences overrides';
    }
    if (audioOptionPreferences.preferred3DProvider || audioOptionPreferences.speakerType) {
      audioManager.setPreferredProvider(audioOptionPreferences.preferred3DProvider ?? null);
      audioManager.setPreferredSpeaker(audioOptionPreferences.speakerType ?? null);
      iniDataInfo +=
        ` | Audio prefs provider=${audioOptionPreferences.preferred3DProvider ?? 'default'}` +
        ` speaker=${audioOptionPreferences.speakerType ?? 'default'}`;
    }

    if (resolvedSfxVolumes.usedRelative2DVolume && audioSettings.relative2DVolume !== undefined) {
      iniDataInfo += ` | Audio Relative2DVolume=${audioSettings.relative2DVolume}`;
    }

    // Source parity: AudioSettings zoom volume parameters.
    if (
      audioSettings.zoomMinDistance !== undefined
      || audioSettings.zoomMaxDistance !== undefined
      || audioSettings.zoomSoundVolumePercent !== undefined
    ) {
      audioManager.setZoomDistances(
        audioSettings.zoomMinDistance ?? 100,
        audioSettings.zoomMaxDistance ?? 400,
        audioSettings.zoomSoundVolumePercent ?? 0.5,
      );
    }
  }
  const registeredAudioEvents = registerIniAudioEvents(iniDataRegistry, audioManager);
  iniDataInfo += ` | Audio events: ${registeredAudioEvents}`;
  setLoadingProgress(48, 'Game data ready');

  return {
    renderer,
    scene,
    camera,
    sunLight,
    canvas,
    subsystems,
    assets,
    inputManager,
    rtsCamera,
    terrainVisual,
    waterVisual,
    audioManager,
    cursorManager,
    networkManager,
    uiRuntime,
    iniDataRegistry,
    iniDataInfo,
    saveStorage,
    replayStorage,
  };
}

// ============================================================================
// Phase 2: Start game (map load, game logic, game loop)
// ============================================================================

async function startGame(
  ctx: PreInitContext,
  mapPath: string | null,
  skirmishSettings: SkirmishSettings | null,
  campaignContext?: {
    campaignManager: CampaignManager;
    videoPlayer: VideoPlayer | null;
    settings: CampaignStartSettings;
    onReturnToShell: () => void;
  },
  replayContext?: ReplayPlaybackContext,
  runtimeSaveLoadContext?: RuntimeSaveLoadContext,
): Promise<void> {
  const {
    renderer, scene, camera, sunLight, subsystems, assets, inputManager, rtsCamera,
    terrainVisual, waterVisual, audioManager, cursorManager, networkManager, uiRuntime,
    iniDataRegistry, iniDataInfo, replayStorage,
  } = ctx;
  const canvas = renderer.domElement as HTMLCanvasElement;
  const gameSubsystems = new SubsystemRegistry();
  const replayManager = new ReplayManager();
  const activeMapPath = runtimeSaveLoadContext?.runtimeSave.mapPath ?? mapPath;
  const restoredInGameUiState = runtimeSaveLoadContext?.runtimeSave.inGameUiState ?? null;
  let replayRecordFrame = 0;
  let replayRecordingPersisted = false;
  let replaySkirmishSettings = skirmishSettings;
  let resolvedSkirmishRuntimeSlots: ResolvedSkirmishRuntimeSlot[] = [];

  // Mission restarts and campaign transitions reuse the pre-init context, so
  // only reset the shared runtime subsystems here. Disposing them would tear
  // down the loaded manifest/cache and break the next mission load.
  subsystems.resetAll();

  // Attach cursor overlay and preload essential cursors
  cursorManager.attach(canvas);
  void Promise.all([
    cursorManager.preload('SCCPointer'),
    cursorManager.preload('SCCSelect'),
    cursorManager.preload('SCCMove'),
    cursorManager.preload('SCCAttack'),
    cursorManager.preload('SCCTarget'),
    cursorManager.preload('SCCScroll0'),
    cursorManager.preload('SCCScroll1'),
    cursorManager.preload('SCCScroll2'),
    cursorManager.preload('SCCScroll3'),
    cursorManager.preload('SCCScroll4'),
    cursorManager.preload('SCCScroll5'),
    cursorManager.preload('SCCScroll6'),
    cursorManager.preload('SCCScroll7'),
  ]);
  cursorManager.setCursor('SCCPointer');

  showLoadingScreen();
  setLoadingProgress(50, 'Loading terrain...');

  const iniDataStats = iniDataRegistry.getStats();
  const dataSuffix = ` | INI: ${iniDataStats.objects} objects, ${iniDataStats.weapons} weapons, ${iniDataStats.audioEvents} audio`;
  console.log(`Game data status: ${iniDataInfo}`);

  // Game logic + object visuals
  const attackUsesLineOfSight = iniDataRegistry.getAiConfig()?.attackUsesLineOfSight ?? true;
  const objectVisualManager = new ObjectVisualManager(scene, assets);
  const scriptSkyboxController = new ScriptSkyboxController(scene, assets);
  const scriptSkyboxPreloadPromise = scriptSkyboxController.preload();
  let scriptCameraMovementFinished = true;
  let scriptCameraTimeFrozen = false;
  let scriptCameraTimeMultiplier = 1;
  const gameLogic = new GameLogicSubsystem(scene, {
    attackUsesLineOfSight,
    pickObjectByInput: (input, cam) => objectVisualManager.pickObjectByInput(input, cam),
    isCameraMovementFinished: () => scriptCameraMovementFinished,
    isCameraTimeFrozen: () => scriptCameraTimeFrozen,
    getCameraTimeMultiplier: () => scriptCameraTimeMultiplier,
    superweaponRestriction: skirmishSettings?.limitSuperweapons ? 1 : 0,
    // Source parity: VictoryConditions::update() skips for non-multiplayer.
    // Campaign missions use script-based victory/defeat exclusively.
    isCampaignMode: !!campaignContext,
  });
  const maybeSetDeterministicGameLogicCrcSectionWriters = (
    networkManager as unknown as {
      setDeterministicGameLogicCrcSectionWriters?: (writers: unknown) => void;
    }
  ).setDeterministicGameLogicCrcSectionWriters;
  const maybeCreateDeterministicGameLogicCrcSectionWriters = (
    gameLogic as unknown as {
      createDeterministicGameLogicCrcSectionWriters?: () => unknown;
    }
  ).createDeterministicGameLogicCrcSectionWriters;
  if (
    typeof maybeSetDeterministicGameLogicCrcSectionWriters === 'function'
    && typeof maybeCreateDeterministicGameLogicCrcSectionWriters === 'function'
  ) {
    maybeSetDeterministicGameLogicCrcSectionWriters.call(
      networkManager,
      maybeCreateDeterministicGameLogicCrcSectionWriters.call(gameLogic),
    );
  }
  gameSubsystems.register(gameLogic);
  await gameLogic.init();
  audioManager.setObjectPositionResolver((objectId) => gameLogic.getEntityWorldPosition(objectId));
  audioManager.setDrawablePositionResolver((drawableId) => gameLogic.getEntityWorldPosition(drawableId));
  audioManager.setPlayerPositionResolver((playerIndex) => {
    const anchorEntityId = gameLogic.resolveCommandCenterEntityId(playerIndex);
    if (anchorEntityId === null) {
      return null;
    }
    return gameLogic.getEntityWorldPosition(anchorEntityId);
  });
  audioManager.setPlayerRelationshipResolver((owningPlayerIndex, localPlayerIndex) =>
    gameLogic.getPlayerRelationshipByIndex(owningPlayerIndex, localPlayerIndex),
  );
  audioManager.setShroudVisibilityResolver((localPlayerIndex, position) => {
    const localSide = gameLogic.getPlayerSide(localPlayerIndex);
    if (!localSide) {
      return true;
    }
    return gameLogic.isPositionVisible(localSide, position[0], position[2]);
  });
  uiRuntime.setControlBarObjectTargetValidator((validation) => {
    if (
      validation.commandType
      === GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER
    ) {
      const commandCenterEntityId = gameLogic.resolveCommandCenterEntityId(networkManager.getLocalPlayerID());
      if (commandCenterEntityId === null) {
        return false;
      }
      return isObjectTargetRelationshipAllowed(
        validation.commandOption,
        gameLogic.getEntityRelationship(commandCenterEntityId, validation.targetObjectId),
      );
    }

    const sourceObjectIds = validation.selectedObjectIds.length > 0
      ? validation.selectedObjectIds
      : (() => {
          const selectedEntityId = gameLogic.getSelectedEntityId();
          return selectedEntityId === null ? [] : [selectedEntityId];
        })();
    if (sourceObjectIds.length === 0) {
      return false;
    }
    if (sourceObjectIds.length === 1) {
      return isObjectTargetRelationshipAllowed(
        validation.commandOption,
        gameLogic.getEntityRelationship(sourceObjectIds[0]!, validation.targetObjectId),
      );
    }
    return isObjectTargetAllowedForSelection(
      validation.commandOption,
      sourceObjectIds,
      validation.targetObjectId,
      (sourceObjectId, targetObjectId) => gameLogic.getEntityRelationship(sourceObjectId, targetObjectId),
    );
  });

  // Register synthesized combat audio events (placeholder until real audio assets).
  const registerCombatAudio = (): void => {
    const ctx = new AudioContext();
    const sampleRate = ctx.sampleRate;

    const synthesize = (
      duration: number,
      generator: (t: number, i: number) => number,
    ): AudioBuffer => {
      const length = Math.ceil(sampleRate * duration);
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = generator(t, i) * Math.max(0, 1 - t / duration);
      }
      return buffer;
    };

    // Gunshot: white noise burst with fast decay.
    const gunshot = synthesize(0.15, (t) => {
      return (Math.random() * 2 - 1) * Math.exp(-t * 40);
    });

    // Missile launch: rising tone + noise.
    const missileLaunch = synthesize(0.4, (t) => {
      const freq = 200 + t * 800;
      return (Math.sin(2 * Math.PI * freq * t) * 0.5 + (Math.random() * 2 - 1) * 0.3)
        * Math.exp(-t * 3);
    });

    // Explosion: low rumble + noise burst.
    const explosion = synthesize(0.6, (t) => {
      const rumble = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 4);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 8);
      return (rumble * 0.6 + noise * 0.4);
    });

    // Large explosion (building destruction).
    const largeExplosion = synthesize(1.0, (t) => {
      const rumble = Math.sin(2 * Math.PI * 40 * t) * Math.exp(-t * 2);
      const crack = (Math.random() * 2 - 1) * Math.exp(-t * 5);
      return (rumble * 0.7 + crack * 0.3);
    });

    // Artillery fire: sharp crack.
    const artilleryFire = synthesize(0.25, (t) => {
      const crack = (Math.random() * 2 - 1) * Math.exp(-t * 25);
      const boom = Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 10);
      return crack * 0.5 + boom * 0.5;
    });

    const events: Array<{ name: string; buffer: AudioBuffer; volume: number }> = [
      { name: 'CombatGunshot', buffer: gunshot, volume: 0.3 },
      { name: 'CombatMissileLaunch', buffer: missileLaunch, volume: 0.4 },
      { name: 'CombatExplosionSmall', buffer: explosion, volume: 0.5 },
      { name: 'CombatExplosionLarge', buffer: largeExplosion, volume: 0.6 },
      { name: 'CombatArtilleryFire', buffer: artilleryFire, volume: 0.4 },
      { name: 'CombatEntityDestroyed', buffer: largeExplosion, volume: 0.7 },
    ];

    for (const { name, buffer, volume } of events) {
      audioManager.addAudioEventInfo({
        audioName: name,
        soundType: 1, // AT_SoundEffect
        type: 0x0002, // ST_WORLD
        volume,
        minVolume: 0,
        minRange: 10,
        maxRange: 300,
      });
      audioManager.preloadAudioBuffer(name, buffer);
    }

    ctx.close();
  };
  registerCombatAudio();
  syncPlayerSidesFromNetwork(networkManager, gameLogic);
  const scriptAudioRuntimeBridge = createScriptAudioRuntimeBridge({
    gameLogic,
    audioManager,
    getLocalPlayerIndex: () => networkManager.getLocalPlayerID(),
  });
  const scriptObjectAmbientAudioRuntimeBridge = createScriptObjectAmbientAudioRuntimeBridge({
    gameLogic,
    audioManager,
  });

  // ========================================================================
  // Load terrain (map JSON or procedural demo)
  // ========================================================================

  const terrainRoadEntries = await loadTerrainRoadEntries(assets);
  gameLogic.setRoadTemplateNames(collectTerrainRoadTemplateNames(terrainRoadEntries));
  gameLogic.setSupplementalMapObjectDefinitions(collectSourceMapObjectSupplements());

  let mapData: MapDataJSON;
  let loadedFromJSON = false;

  if (runtimeSaveLoadContext?.runtimeSave.mapData) {
    mapData = runtimeSaveLoadContext.runtimeSave.mapData;
    loadedFromJSON = true;
    console.log('Map loaded from embedded runtime save data.');
  } else if (activeMapPath) {
    assertRequiredManifestEntries(assets.getManifest(), [activeMapPath]);
    try {
      const handle = await assets.loadJSON<MapDataJSON>(activeMapPath, (loaded, total) => {
        const pct = total > 0 ? Math.round(50 + (loaded / total) * 20) : 60;
        setLoadingProgress(pct, 'Loading map data...');
      });
      mapData = handle.data;
      loadedFromJSON = true;
      console.log(`Map loaded via AssetManager (cached: ${handle.cached}, hash: ${handle.hash ?? 'n/a'})`);
    } catch (err) {
      throw new Error(
        `Requested map "${activeMapPath}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (runtimeSaveLoadContext) {
    throw new Error(
      'Runtime save did not contain embedded JSON map data and no runtime map path was available for reload.',
    );
  } else {
    const demo = terrainVisual.loadDemoTerrain();
    mapData = demo.mapData;
  }

  // If loaded from JSON, build terrain (demo path already builds it)
  if (loadedFromJSON) {
    terrainVisual.loadMap(mapData);
  }

  // Load water surfaces
  waterVisual.loadFromMapData(mapData);
  const heightmap = terrainVisual.getHeightmap();
  if (!heightmap) {
    throw new Error('Failed to initialize terrain heightmap');
  }

  if (skirmishSettings) {
    resolvedSkirmishRuntimeSlots = resolveSkirmishRuntimeSlots(
      skirmishSettings,
      gameLogic,
      extractSkirmishStartSpots(mapData),
    );
    replaySkirmishSettings = {
      ...skirmishSettings,
      slots: resolvedSkirmishRuntimeSlots.map((slot) => ({
        slotIndex: slot.slotIndex,
        playerName: slot.playerName,
        mode: slot.mode,
        side: slot.factionSide,
        team: slot.team,
        color: slot.color,
        startPosition: slot.startPosition,
      })),
    };
    mergeSkirmishSidesIntoMapData(mapData, resolvedSkirmishRuntimeSlots);
    for (const slot of resolvedSkirmishRuntimeSlots) {
      gameLogic.setPlayerSide(slot.slotIndex, slot.runtimeSide);
      gameLogic.setSidePlayerType(slot.runtimeSide, slot.playerType);
      if (slot.startPosition !== null) {
        gameLogic.setSkirmishPlayerStartPosition(slot.runtimeSide, slot.startPosition);
      }
    }
  }

  // Render minimap terrain preview on the loading screen.
  {
    const PREVIEW_SIZE = 200;
    const previewCtx = loadingMinimap.getContext('2d');
    if (previewCtx) {
      const imgData = previewCtx.createImageData(PREVIEW_SIZE, PREVIEW_SIZE);
      for (let py = 0; py < PREVIEW_SIZE; py++) {
        for (let px = 0; px < PREVIEW_SIZE; px++) {
          const worldX = (px / PREVIEW_SIZE) * heightmap.worldWidth;
          const worldZ = (py / PREVIEW_SIZE) * heightmap.worldDepth;
          const h = heightmap.getInterpolatedHeight(worldX, worldZ);
          // Desert color palette — same as in-game minimap terrain layer.
          const t = Math.max(0, Math.min(1, h / 30));
          const r = Math.round(140 + t * 40);
          const g = Math.round(115 + t * 40);
          const b = Math.round(75 + t * 50);
          const idx = (py * PREVIEW_SIZE + px) * 4;
          imgData.data[idx] = r;
          imgData.data[idx + 1] = g;
          imgData.data[idx + 2] = b;
          imgData.data[idx + 3] = 255;
        }
      }
      previewCtx.putImageData(imgData, 0, 0);
      loadingMinimap.style.display = 'block';
    }
  }

  // Build terrain roads from map objects with road flags.
  const terrainRoadRenderer = new TerrainRoadRenderer(scene);
  const terrainBridgeRenderer = new TerrainBridgeRenderer(scene, assets);
  terrainRoadRenderer.buildFromMapObjects(
    mapData.objects,
    (wx, wz) => heightmap.getInterpolatedHeight(wx, wz),
  );
  await terrainBridgeRenderer.buildFromMapObjects(
    mapData.objects,
    (wx, wz) => heightmap.getInterpolatedHeight(wx, wz),
    collectTerrainBridgeDefinitions(terrainRoadEntries),
  );

  const objectPlacement = gameLogic.loadMapObjects(mapData, iniDataRegistry, heightmap);
  if (runtimeSaveLoadContext) {
    if (runtimeSaveLoadContext.runtimeSave.gameLogicTerrainLogicState) {
      gameLogic.restoreSourceTerrainLogicRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicTerrainLogicState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicPlayersState) {
      gameLogic.restoreSourcePlayerRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicPlayersState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicPartitionState) {
      gameLogic.restoreSourcePartitionRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicPartitionState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicRadarState) {
      gameLogic.restoreSourceRadarRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicRadarState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicSidesListState) {
      gameLogic.restoreSourceSidesListRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicSidesListState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicTeamFactoryState) {
      gameLogic.restoreSourceTeamFactoryRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicTeamFactoryState,
      );
    } else if (runtimeSaveLoadContext.runtimeSave.sourceTeamFactoryChunkData) {
      const currentTeamFactoryState = gameLogic.captureSourceTeamFactoryRuntimeSaveState();
      const currentPlayerState = gameLogic.captureSourcePlayerRuntimeSaveState();
      const currentSidesListState = gameLogic.captureSourceSidesListRuntimeSaveState();
      gameLogic.restoreSourceTeamFactoryRuntimeSaveState(
        applySourceTeamFactoryChunkToState(
          runtimeSaveLoadContext.runtimeSave.sourceTeamFactoryChunkData,
          currentTeamFactoryState,
          currentPlayerState,
          currentSidesListState,
          runtimeSaveLoadContext.runtimeSave.gameLogicCoreState,
        ),
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicInGameUiState) {
      gameLogic.restoreSourceInGameUiRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicInGameUiState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicCoreState) {
      gameLogic.restoreSourceGameLogicRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicCoreState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicScriptEngineState) {
      gameLogic.restoreSourceScriptEngineRuntimeSaveState(
        runtimeSaveLoadContext.runtimeSave.gameLogicScriptEngineState,
      );
    }
    if (runtimeSaveLoadContext.runtimeSave.gameLogicState !== null) {
      gameLogic.restoreBrowserRuntimeSaveState(runtimeSaveLoadContext.runtimeSave.gameLogicState);
    }
    gameLogic.finalizeSourceSpyVisionRuntimeSaveState();
    gameLogic.finalizeSourceSpecialPowerRuntimeSaveState();
    gameLogic.finalizeSourceContainmentRuntimeSaveState();
    gameLogic.finalizeSourceSupplyChainRuntimeSaveState();
  }
  if (objectPlacement.unresolvedObjects > 0) {
    console.warn(
      `Object resolve summary: ${objectPlacement.resolvedObjects}/${objectPlacement.spawnedObjects} objects resolved`,
    );
  }
  const objectStatus = ` | Objects: ${objectPlacement.spawnedObjects}/${objectPlacement.totalObjects} ` +
    `(unresolved: ${objectPlacement.unresolvedObjects})`;

  setLoadingProgress(70, 'Configuring camera...');

  // ========================================================================
  // Apply post-load skirmish settings (credits, AI)
  // ========================================================================

  // Campaign mode: resolve local player side from sidesList human player's faction.
  // Source parity: C++ Player objects map player names to factions; entities belong
  // to the faction side, not the player name.  loadMapScripts populates
  // scriptPlayerSideByName (e.g. "THE_PLAYER" -> "america") which we use here.
  if (campaignContext && mapData.sidesList) {
    const priv = gameLogic as unknown as { scriptPlayerSideByName: Map<string, string> };
    for (const side of mapData.sidesList.sides) {
      const dict = side?.dict as Record<string, unknown> | undefined;
      const playerName = typeof dict?.playerName === 'string' ? dict.playerName : '';
      const isHuman = !!dict?.playerIsHuman;
      if (isHuman && playerName) {
        const resolved = priv.scriptPlayerSideByName.get(playerName.trim().toUpperCase());
        gameLogic.setPlayerSide(0, resolved ?? playerName);
        break;
      }
    }
  }

  if (skirmishSettings) {
    // Source parity: SkirmishScripts.scb — spawn command center + dozer at Player_N_Start waypoints.
    gameLogic.spawnSkirmishStartingEntities();

    for (const slot of resolvedSkirmishRuntimeSlots) {
      gameLogic.submitCommand({
        type: 'setSideCredits',
        side: slot.runtimeSide,
        amount: skirmishSettings.startingCredits,
      });
    }

    for (let i = 0; i < resolvedSkirmishRuntimeSlots.length; i += 1) {
      const source = resolvedSkirmishRuntimeSlots[i]!;
      if (source.playerType === 'COMPUTER') {
        gameLogic.enableSkirmishAI(source.runtimeSide);
      }
      for (let j = i + 1; j < resolvedSkirmishRuntimeSlots.length; j += 1) {
        const target = resolvedSkirmishRuntimeSlots[j]!;
        const areAllies = source.team >= 0 && source.team === target.team;
        const relationship = areAllies ? 2 : 0;
        gameLogic.setTeamRelationship(source.runtimeSide, target.runtimeSide, relationship);
        gameLogic.setTeamRelationship(target.runtimeSide, source.runtimeSide, relationship);
      }
    }
  }

  // Run one update cycle so fog-of-war registers entity lookers before
  // the initial visual sync.  Without this, every entity starts SHROUDED
  // because the fog grid has no lookers yet.
  gameLogic.update(0);

  const persistRecordedReplay = async (): Promise<void> => {
    if (replayRecordingPersisted || replayManager.getState() !== 'recording') {
      return;
    }

    const replay = replayManager.stopRecording();
    if (!replay) {
      return;
    }

    replayRecordingPersisted = true;
    const timestampMs = Date.parse(replay.recordedAt) || Date.now();
    const replayId = buildReplayId(replay.mapPath, timestampMs);
    await replayStorage.saveToDB(
      replayId,
      replay,
      buildReplayDescription(replay.mapPath, timestampMs),
    );
  };

  const originalSubmitCommand = gameLogic.submitCommand.bind(gameLogic);
  gameLogic.submitCommand = ((command: ReplayRecordableCommand): void => {
    if (replayManager.getState() === 'recording' && shouldRecordReplayCommand(command)) {
      replayManager.recordCommand(
        replayRecordFrame,
        networkManager.getLocalPlayerID(),
        cloneReplayCommand(command),
      );
    }
    originalSubmitCommand(command);
  }) as GameLogicSubsystem['submitCommand'];
  objectVisualManager.sync(gameLogic.getRenderableEntityStates());
  await scriptSkyboxPreloadPromise;

  // ========================================================================
  // Camera setup
  // ========================================================================

  // Set camera height query for terrain following
  rtsCamera.setHeightQuery((x, z) => heightmap.getInterpolatedHeight(x, z));

  // Set map bounds
  rtsCamera.setMapBounds(0, heightmap.worldWidth, 0, heightmap.worldDepth);

  // Source parity: GameLogic.cpp:1790 checks InitialCameraPosition first
  // (used by campaign maps), then Player_N_Start for skirmish, else map center.
  const cameraWaypoint = gameLogic.getWaypointPosition('InitialCameraPosition')
    ?? gameLogic.getWaypointPosition('Player_1_Start');
  if (cameraWaypoint) {
    rtsCamera.lookAt(cameraWaypoint.x, cameraWaypoint.z);
  } else {
    rtsCamera.lookAt(heightmap.worldWidth / 2, heightmap.worldDepth / 2);
  }
  {
    const initialCameraState = rtsCamera.getState();
    rtsCamera.setState({
      ...initialCameraState,
      zoom: resolveSourceHeightScaledZoomWorldDistance({
        zoomMultiplier: 1,
        targetX: initialCameraState.targetX,
        targetZ: initialCameraState.targetZ,
        getTerrainHeightAt: (worldX, worldZ) => heightmap.getInterpolatedHeight(worldX, worldZ),
      }),
      pitch: 1,
    });
  }
  if (runtimeSaveLoadContext?.runtimeSave.cameraState) {
    rtsCamera.setState(runtimeSaveLoadContext.runtimeSave.cameraState);
  } else if (runtimeSaveLoadContext?.runtimeSave.tacticalViewState) {
    const tacticalViewState = runtimeSaveLoadContext.runtimeSave.tacticalViewState;
    const currentCameraState = rtsCamera.getState();
    if (
      Number.isFinite(tacticalViewState.angle)
      && Number.isFinite(tacticalViewState.position.x)
      && Number.isFinite(tacticalViewState.position.z)
    ) {
      rtsCamera.setState({
        ...currentCameraState,
        angle: tacticalViewState.angle,
        targetX: tacticalViewState.position.x,
        targetZ: tacticalViewState.position.z,
      });
    }
  }
  syncScriptViewRuntimeBridge(gameLogic, objectVisualManager, terrainVisual, scriptSkyboxController);
  scriptSkyboxController.update(camera);

  setLoadingProgress(90, 'Starting game loop...');

  // ========================================================================
  // Fog of war overlay
  // ========================================================================

  const shroudRenderer = new ShroudRenderer(scene, {
    worldWidth: heightmap.worldWidth,
    worldDepth: heightmap.worldDepth,
  });

  // Initial shroud overlay update so the fog state matches the fog-of-war
  // grid (cleared around player's starting entities) even if the game loop
  // has not yet run.
  {
    const localSideForFogInit = gameLogic.getPlayerSide(networkManager.getLocalPlayerID());
    shroudRenderer.update(
      localSideForFogInit ? gameLogic.getFogOfWarTextureData(localSideForFogInit) : null,
    );
  }

  // ========================================================================
  // Debug info & keyboard shortcuts
  // ========================================================================

  const debugInfo = document.getElementById('debug-info') as HTMLDivElement;
  const creditsHud = document.getElementById('credits-hud') as HTMLDivElement;
  creditsHud.style.display = 'block';
  Object.assign(creditsHud.style, {
    boxSizing: 'border-box',
    padding: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  let displayedCredits = 0; // Animated credit counter (ticks toward actual value)
  let lastClickTime = 0; // For double-click detection
  const DOUBLE_CLICK_MS = 350;
  let lastGhostCellX = -1; // Cached ghost validity grid cell
  let lastGhostCellZ = -1;
  let lastTabEntityId = -1; // For Tab cycling by entity ID
  let buildingGhostAngle = 0; // Building placement rotation (radians)

  // Power HUD indicator (below credits) — graphical bar + text overlay. Reuse on restart.
  let powerHud = document.getElementById('power-hud') as HTMLDivElement | null;
  if (!powerHud) {
    powerHud = document.createElement('div');
    powerHud.id = 'power-hud';
    Object.assign(powerHud.style, {
      position: 'absolute', top: '38px', right: '10px', width: '120px', height: '16px',
      background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '3px', overflow: 'hidden', zIndex: '100', pointerEvents: 'none',
    });
    const powerBar = document.createElement('div');
    powerBar.id = 'power-bar-fill';
    Object.assign(powerBar.style, { height: '100%', width: '100%', transition: 'width 0.2s, background 0.2s' });
    powerHud.appendChild(powerBar);
    const powerLabel = document.createElement('span');
    powerLabel.id = 'power-bar-label';
    Object.assign(powerLabel.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: '11px',
      fontWeight: '600', textShadow: '0 0 3px rgba(0,0,0,0.9)', pointerEvents: 'none',
    });
    powerHud.appendChild(powerLabel);
    document.getElementById('ui-overlay')!.appendChild(powerHud);
  }

  // Game clock HUD (right of credits) — reuse on restart.
  let clockHud = document.getElementById('clock-hud') as HTMLDivElement | null;
  if (!clockHud) {
    clockHud = document.createElement('div');
    clockHud.id = 'clock-hud';
    Object.assign(clockHud.style, {
      position: 'absolute', top: '10px', right: '10px',
      color: '#aaccaa', fontFamily: 'monospace', fontSize: '12px',
      background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: '3px',
      zIndex: '100', pointerEvents: 'none',
    });
    document.getElementById('ui-overlay')!.appendChild(clockHud);
  }

  // Rank HUD indicator (below power HUD) — reuse on restart.
  let rankHud = document.getElementById('rank-hud') as HTMLDivElement | null;
  if (!rankHud) {
    rankHud = document.createElement('div');
    rankHud.id = 'rank-hud';
    Object.assign(rankHud.style, {
      position: 'absolute',
      top: '58px',
      right: '10px',
      color: '#c9a84c',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: '12px',
      fontWeight: '600',
      textShadow: '0 0 4px rgba(0,0,0,0.8)',
      zIndex: '100',
      pointerEvents: 'none',
    });
    document.getElementById('ui-overlay')!.appendChild(rankHud);
  }

  // Speed control HUD indicator (top-left) — reuse on restart.
  let speedHud = document.getElementById('speed-hud') as HTMLDivElement | null;
  if (!speedHud) {
    speedHud = document.createElement('div');
    speedHud.id = 'speed-hud';
    Object.assign(speedHud.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      color: '#ffcc00',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: '16px',
      fontWeight: '700',
      textShadow: '0 0 6px rgba(0,0,0,0.9)',
      zIndex: '200',
      pointerEvents: 'none',
      display: 'none',
    });
    document.getElementById('ui-overlay')!.appendChild(speedHud);
  }

  // Superweapon countdown HUD (top-center) — reuse on restart.
  let superweaponHud = document.getElementById('superweapon-hud') as HTMLDivElement | null;
  if (!superweaponHud) {
    superweaponHud = document.createElement('div');
    superweaponHud.id = 'superweapon-hud';
    Object.assign(superweaponHud.style, {
      position: 'absolute',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      color: '#ff6644',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: '13px',
      fontWeight: '700',
      textShadow: '0 0 6px rgba(0,0,0,0.9)',
      zIndex: '100',
      pointerEvents: 'none',
      display: 'none',
      gap: '4px',
    });
    document.getElementById('ui-overlay')!.appendChild(superweaponHud);
  }
  /** Track the frame at which each superweapon countdown started, keyed by `entityId:powerName`. */
  const superweaponStartFrames = new Map<string, number>();
  const trackedInGameUiSuperweaponStateByKey = new Map<string, RuntimeSaveTrackedInGameUiSuperweaponState>(
    (restoredInGameUiState?.superweapons ?? []).map((superweapon) => [
      createRuntimeSaveInGameUiSuperweaponKey({
        playerIndex: superweapon.playerIndex,
        objectId: superweapon.objectId,
        powerName: superweapon.powerName,
      }),
      {
        timestamp: superweapon.timestamp,
        evaReadyPlayed: superweapon.evaReadyPlayed,
      },
    ]),
  );
  let namedTimerLastFlashFrame = restoredInGameUiState?.namedTimerLastFlashFrame ?? 0;
  let namedTimerUsedFlashColor = restoredInGameUiState?.namedTimerUsedFlashColor ?? false;

  // Entity info panel (bottom-center, shows selected unit details) — reuse on restart.
  let entityInfoPanel = document.getElementById('entity-info-panel') as HTMLDivElement | null;
  if (!entityInfoPanel) {
    entityInfoPanel = document.createElement('div');
    entityInfoPanel.id = 'entity-info-panel';
    Object.assign(entityInfoPanel.style, {
      position: 'absolute',
      bottom: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(12, 16, 28, 0.85)',
      border: '1px solid rgba(201, 168, 76, 0.4)',
      borderRadius: '4px',
      padding: '8px 14px',
      color: '#e0d8c0',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: '13px',
      lineHeight: '1.5',
      zIndex: '50',
      display: 'none',
      minWidth: '220px',
      maxWidth: '350px',
      pointerEvents: 'none',
    });
    document.getElementById('ui-overlay')!.appendChild(entityInfoPanel);
  } else {
    entityInfoPanel.innerHTML = '';
    entityInfoPanel.style.display = 'none';
  }

  const entityInfoName = document.createElement('div');
  Object.assign(entityInfoName.style, {
    fontWeight: '700',
    fontSize: '14px',
    color: '#c9a84c',
    marginBottom: '4px',
  });
  entityInfoPanel.appendChild(entityInfoName);

  const entityInfoHealthRow = document.createElement('div');
  entityInfoPanel.appendChild(entityInfoHealthRow);

  const entityInfoHealthBar = document.createElement('div');
  Object.assign(entityInfoHealthBar.style, {
    width: '100%',
    height: '6px',
    background: '#333',
    borderRadius: '3px',
    overflow: 'hidden',
    marginTop: '2px',
    marginBottom: '4px',
  });
  entityInfoPanel.appendChild(entityInfoHealthBar);

  const entityInfoHealthFill = document.createElement('div');
  Object.assign(entityInfoHealthFill.style, {
    height: '100%',
    background: '#44cc44',
    transition: 'width 0.15s, background 0.15s',
  });
  entityInfoHealthBar.appendChild(entityInfoHealthFill);

  const entityInfoDetails = document.createElement('div');
  Object.assign(entityInfoDetails.style, {
    fontSize: '12px',
    color: '#a09880',
  });
  entityInfoPanel.appendChild(entityInfoDetails);

  // Hover tooltip — shows unit name, health, and faction when hovering over entities.
  let hoverTooltip = document.getElementById('hover-tooltip') as HTMLDivElement | null;
  if (!hoverTooltip) {
    hoverTooltip = document.createElement('div');
    hoverTooltip.id = 'hover-tooltip';
    Object.assign(hoverTooltip.style, {
      position: 'absolute',
      display: 'none',
      background: 'rgba(0, 0, 0, 0.75)',
      color: '#ffffff',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: '11px',
      lineHeight: '1.4',
      padding: '5px 8px',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '100',
      whiteSpace: 'nowrap',
      maxWidth: '250px',
    });
    document.getElementById('ui-overlay')!.appendChild(hoverTooltip);
  } else {
    hoverTooltip.innerHTML = '';
    hoverTooltip.style.display = 'none';
  }

  const hoverTooltipName = document.createElement('div');
  Object.assign(hoverTooltipName.style, {
    fontWeight: '600',
    marginBottom: '2px',
  });
  hoverTooltip.appendChild(hoverTooltipName);

  const hoverTooltipHealthBar = document.createElement('div');
  Object.assign(hoverTooltipHealthBar.style, {
    width: '100%',
    height: '4px',
    background: '#444',
    borderRadius: '2px',
    overflow: 'hidden',
    marginBottom: '2px',
  });
  hoverTooltip.appendChild(hoverTooltipHealthBar);

  const hoverTooltipHealthFill = document.createElement('div');
  Object.assign(hoverTooltipHealthFill.style, {
    height: '100%',
    background: '#44cc44',
    transition: 'width 0.1s, background 0.1s',
  });
  hoverTooltipHealthBar.appendChild(hoverTooltipHealthFill);

  const hoverTooltipSide = document.createElement('div');
  Object.assign(hoverTooltipSide.style, {
    fontSize: '10px',
    color: '#aaaaaa',
  });
  hoverTooltip.appendChild(hoverTooltipSide);

  // Script-driven cinematic overlays (letterbox + text).
  const cinematicLetterboxTop = document.createElement('div');
  const cinematicLetterboxBottom = document.createElement('div');
  const cinematicTextOverlay = document.createElement('div');
  const scriptCameraFadeOverlay = document.createElement('div');
  const emoticonOverlay = document.createElement('div');
  Object.assign(cinematicLetterboxTop.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '11%',
    background: 'rgba(0, 0, 0, 0.9)',
    zIndex: '250',
    display: 'none',
    pointerEvents: 'none',
  });
  Object.assign(cinematicLetterboxBottom.style, {
    position: 'absolute',
    bottom: '0',
    left: '0',
    width: '100%',
    height: '11%',
    background: 'rgba(0, 0, 0, 0.9)',
    zIndex: '250',
    display: 'none',
    pointerEvents: 'none',
  });
  Object.assign(cinematicTextOverlay.style, {
    position: 'absolute',
    left: '50%',
    bottom: '12%',
    transform: 'translateX(-50%)',
    maxWidth: '82vw',
    color: '#f4efe1',
    fontFamily: '"Times New Roman", Georgia, serif',
    fontSize: '28px',
    fontWeight: '700',
    letterSpacing: '0.03em',
    textAlign: 'center',
    textShadow: '0 0 10px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.95)',
    zIndex: '260',
    pointerEvents: 'none',
    display: 'none',
  });
  Object.assign(scriptCameraFadeOverlay.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    zIndex: '255',
    pointerEvents: 'none',
    display: 'none',
    opacity: '0',
  });
  Object.assign(emoticonOverlay.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    zIndex: '270',
    pointerEvents: 'none',
  });
  const gameContainer = document.getElementById('game-container')!;
  gameContainer.appendChild(cinematicLetterboxTop);
  gameContainer.appendChild(cinematicLetterboxBottom);
  gameContainer.appendChild(scriptCameraFadeOverlay);
  gameContainer.appendChild(cinematicTextOverlay);
  gameContainer.appendChild(emoticonOverlay);

  // Hoisted here so updateEntityInfoPanel can display control group badges.
  const controlGroups = new Map<number, number[]>();

  const updateEntityInfoPanel = (): void => {
    const selectedIds = gameLogic.getLocalPlayerSelectionIds();
    if (selectedIds.length === 0) {
      entityInfoPanel.style.display = 'none';
      return;
    }

    // Show info for primary selection.
    const primaryId = selectedIds[0]!;
    const state = gameLogic.getEntityState(primaryId);
    if (!state) {
      entityInfoPanel.style.display = 'none';
      return;
    }

    entityInfoPanel.style.display = 'block';

    // Name.
    const displayName = state.templateName.replace(/([A-Z])/g, ' $1').trim();
    entityInfoName.textContent = selectedIds.length > 1
      ? `${displayName} (+${selectedIds.length - 1} more)`
      : displayName;

    // Health.
    const healthPct = state.maxHealth > 0 ? state.health / state.maxHealth : 0;
    entityInfoHealthRow.textContent = `HP: ${Math.ceil(state.health)} / ${state.maxHealth}`;
    entityInfoHealthFill.style.width = `${Math.round(healthPct * 100)}%`;
    entityInfoHealthFill.style.background = healthPct > 0.6 ? '#44cc44'
      : healthPct > 0.3 ? '#cccc44' : '#cc4444';

    // Details.
    const lines: string[] = [];
    if (state.veterancyLevel > 0) {
      const vetNames = ['', 'Veteran', 'Elite', 'Heroic'];
      lines.push(`Rank: ${vetNames[state.veterancyLevel] ?? `Level ${state.veterancyLevel}`}`);
    }

    const selectionInfo = gameLogic.getSelectedEntityInfoById(primaryId);
    if (selectionInfo) {
      if (selectionInfo.side) {
        lines.push(`Side: ${selectionInfo.side}`);
      }
      if (selectionInfo.appliedUpgradeNames.length > 0) {
        lines.push(`Upgrades: ${selectionInfo.appliedUpgradeNames.join(', ')}`);
      }
      lines.push(`Category: ${selectionInfo.category}`);
    }

    // Garrison occupancy indicator.
    if (state.garrisonCount !== null && state.garrisonCapacity !== null) {
      lines.push(`Garrisoned: ${state.garrisonCount}/${state.garrisonCapacity}`);
    }

    // Supply truck cargo indicator.
    if (state.supplyBoxes !== null && state.supplyMaxBoxes !== null) {
      lines.push(`Cargo: ${state.supplyBoxes}/${state.supplyMaxBoxes} boxes`);
    }

    // Sell countdown timer display.
    if (state.sellPercent !== null) {
      const pct = Math.max(0, Math.round(state.sellPercent));
      lines.push(`Selling... ${pct}%`);
    } else if (state.attackTargetEntityId !== null) {
      lines.push('Status: Attacking');
    } else if (state.guardState !== 'NONE') {
      lines.push('Status: Guarding');
    } else if (state.animationState === 'MOVE') {
      lines.push('Status: Moving');
    } else {
      lines.push('Status: Idle');
    }

    // Show control group badge if the primary entity belongs to a numbered group.
    for (const [groupNum, ids] of controlGroups) {
      if (ids.includes(primaryId)) { lines.push(`Group ${groupNum}`); break; }
    }

    entityInfoDetails.textContent = lines.join(' | ');
  };

  // Post-game stats screen (replaces simple endgame overlay)
  const postgameScreen = new PostgameStatsScreen(gameContainer, {
    onReturnToMenu: () => {
      if (replayContext) {
        replayContext.onReturnToShell();
      } else if (campaignContext) {
        campaignContext.onReturnToShell();
      } else {
        window.location.reload();
      }
    },
    onPlayAgain: () => {
      if (replayContext) {
        disposeGame();
        void startGame(ctx, replayContext.replay.mapPath, replayContext.settings, undefined, replayContext);
      } else if (campaignContext) {
        // Retry same mission — restart with the same campaign context
        disposeGame();
        void startGame(ctx, activeMapPath, null, campaignContext);
      } else {
        window.location.reload();
      }
    },
  });

  // Diplomacy screen (in-game overlay)
  const diplomacyScreen = new DiplomacyScreen(gameContainer, {
    onClose: () => { /* no-op, screen hides itself */ },
    getPlayerInfos: (): DiplomacyPlayerInfo[] => {
      const sides = gameLogic.getActiveSideNames();
      const localSide = gameLogic.getPlayerSide(0);
      return sides.map(side => {
        const playerType = gameLogic.getSidePlayerType(side);
        const faction = sideToFactionLabel(resolveResolvedFactionSide(side, gameLogic));
        return {
          side,
          displayName: playerType === 'HUMAN' ? 'Player' : `AI (${faction})`,
          faction,
          isLocal: side === localSide,
          isDefeated: gameLogic.isSideDefeated(side),
          playerType,
        };
      });
    },
  });

  // General's Powers panel (F4 hotkey)
  const generalsPowersPanel = new GeneralsPowersPanel(gameContainer, {
    onClose: () => { /* no-op, panel hides itself */ },
    getRankLevel: () => gameLogic.getLocalPlayerRankLevel(),
    getPurchasePoints: () => gameLogic.getLocalPlayerSciencePurchasePoints(),
    getAllSciences: () => gameLogic.getLocalPlayerAllSciences(),
    onPurchase: (scienceName: string, cost: number) => {
      gameLogic.submitCommand({
        type: 'purchaseScience',
        scienceName,
        scienceCost: cost,
      });
    },
  });

  // In-game Options screen (ESC key)
  let browserStorageIngame: Storage | null = null;
  try { browserStorageIngame = window.localStorage; } catch { browserStorageIngame = null; }
  const ingamePrefs = loadOptionPreferencesFromStorage(browserStorageIngame);
  const ingameOptionsState = loadOptionsState(ingamePrefs);
  const ingameOptionsScreen = new OptionsScreen(gameContainer, {
    onApply: (state: OptionsState) => {
      applyOptionsState(state, audioManager, rtsCamera);
      saveOptionsToStorage(state, browserStorageIngame);
    },
    onClose: () => { /* no-op */ },
  }, ingameOptionsState);

  let gameEnded = false;

  // ========================================================================
  // Minimap
  // ========================================================================

  const MINIMAP_SIZE = 200;
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.id = 'minimap-canvas';
  minimapCanvas.width = MINIMAP_SIZE;
  minimapCanvas.height = MINIMAP_SIZE;
  Object.assign(minimapCanvas.style, {
    position: 'absolute',
    bottom: '8px',
    left: '8px',
    width: `${MINIMAP_SIZE}px`,
    height: `${MINIMAP_SIZE}px`,
    border: '2px solid rgba(201, 168, 76, 0.5)',
    background: '#111',
    zIndex: '100',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });
  gameContainer.appendChild(minimapCanvas);
  const minimapCtx = minimapCanvas.getContext('2d')!;

  // Pre-render terrain base image once.
  const minimapTerrainCanvas = document.createElement('canvas');
  minimapTerrainCanvas.width = MINIMAP_SIZE;
  minimapTerrainCanvas.height = MINIMAP_SIZE;
  const minimapTerrainCtx = minimapTerrainCanvas.getContext('2d')!;
  const terrainImgData = minimapTerrainCtx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
  for (let py = 0; py < MINIMAP_SIZE; py++) {
    for (let px = 0; px < MINIMAP_SIZE; px++) {
      const worldX = (px / MINIMAP_SIZE) * heightmap.worldWidth;
      const worldZ = (py / MINIMAP_SIZE) * heightmap.worldDepth;
      const h = heightmap.getInterpolatedHeight(worldX, worldZ);
      // Map height to desert terrain color (matches 3D terrain palette).
      const t = Math.max(0, Math.min(1, h / 30));
      const r = Math.round(140 + t * 40);
      const g = Math.round(115 + t * 40);
      const b = Math.round(75 + t * 50);
      const idx = (py * MINIMAP_SIZE + px) * 4;
      terrainImgData.data[idx] = r;
      terrainImgData.data[idx + 1] = g;
      terrainImgData.data[idx + 2] = b;
      terrainImgData.data[idx + 3] = 255;
    }
  }
  minimapTerrainCtx.putImageData(terrainImgData, 0, 0);

  // Minimap beacon pings — expanding circles that fade out when the player clicks on the minimap.
  const minimapPings: Array<{ x: number; y: number; startTime: number }> = [];
  const MINIMAP_PING_DURATION_MS = 1000;
  const MINIMAP_PING_RADIUS_MIN = 2;
  const MINIMAP_PING_RADIUS_MAX = 8;
  const MINIMAP_PING_INITIAL_OPACITY = 0.8;

  // Click on minimap to move camera (left-click) or issue move command (right-click).
  let radarInteractionEnabled = true;

  // Suppress browser context menu on minimap so right-click works as a game command.
  minimapCanvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

  minimapCanvas.addEventListener('mousedown', (e) => {
    if (!radarInteractionEnabled) {
      return;
    }
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const worldX = mx * heightmap.worldWidth;
    const worldZ = my * heightmap.worldDepth;

    if (e.button === 0) {
      // Left-click: pan camera to position.
      rtsCamera.lookAt(worldX, worldZ);
      // Spawn a beacon ping at the clicked minimap position.
      minimapPings.push({ x: mx * MINIMAP_SIZE, y: my * MINIMAP_SIZE, startTime: performance.now() });
    } else if (e.button === 2) {
      // Right-click: move selected units to position.
      const selIds = gameLogic.getLocalPlayerSelectionIds();
      if (selIds.length > 0) {
        for (const id of selIds) {
          gameLogic.submitCommand({
            type: 'moveTo',
            entityId: id,
            targetX: worldX,
            targetZ: worldZ,
            commandSource: 'PLAYER',
          });
        }
        spawnMoveIndicator(worldX, worldZ, false);
        voiceBridge.playGroupVoice(selIds, 'move');
      }
    }
  });

  let minimapDragging = false;
  let minimapRightDragging = false;
  let minimapRightDragMoveCount = 0;
  minimapCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      minimapDragging = radarInteractionEnabled;
    } else if (e.button === 2) {
      minimapRightDragging = radarInteractionEnabled;
      minimapRightDragMoveCount = 0;
    }
  });
  window.addEventListener('mouseup', () => { minimapDragging = false; minimapRightDragging = false; });
  minimapCanvas.addEventListener('mousemove', (e) => {
    if (!radarInteractionEnabled) return;
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    if (minimapDragging) {
      rtsCamera.lookAt(mx * heightmap.worldWidth, my * heightmap.worldDepth);
    }
    if (minimapRightDragging && ++minimapRightDragMoveCount % 5 === 0) {
      const selIds = gameLogic.getLocalPlayerSelectionIds();
      const wx = mx * heightmap.worldWidth, wz = my * heightmap.worldDepth;
      for (const id of selIds) {
        gameLogic.submitCommand({ type: 'moveTo', entityId: id, targetX: wx, targetZ: wz, commandSource: 'PLAYER' });
      }
    }
  });

  const updateMinimap = (showEntityBlips: boolean): void => {
    // Draw pre-rendered terrain.
    minimapCtx.drawImage(minimapTerrainCanvas, 0, 0);

    // Apply fog of war overlay on terrain.
    const localSide = gameLogic.getPlayerSide(networkManager.getLocalPlayerID());
    const fogData = localSide ? gameLogic.getFogOfWarTextureData(localSide) : null;
    if (fogData) {
      const fogImgData = minimapCtx.getImageData(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      for (let py = 0; py < MINIMAP_SIZE; py++) {
        for (let px = 0; px < MINIMAP_SIZE; px++) {
          // Map minimap pixel to fog grid cell.
          const fogCol = Math.floor((px / MINIMAP_SIZE) * fogData.cellsWide);
          const fogRow = Math.floor((py / MINIMAP_SIZE) * fogData.cellsDeep);
          const visibility = fogData.data[fogRow * fogData.cellsWide + fogCol] ?? 0;
          const idx = (py * MINIMAP_SIZE + px) * 4;
          if (visibility === 0) {
            // CELL_SHROUDED — darken completely.
            fogImgData.data[idx] = Math.round(fogImgData.data[idx]! * 0.15);
            fogImgData.data[idx + 1] = Math.round(fogImgData.data[idx + 1]! * 0.15);
            fogImgData.data[idx + 2] = Math.round(fogImgData.data[idx + 2]! * 0.15);
          } else if (visibility === 1) {
            // CELL_FOGGED — dim (previously seen).
            fogImgData.data[idx] = Math.round(fogImgData.data[idx]! * 0.5);
            fogImgData.data[idx + 1] = Math.round(fogImgData.data[idx + 1]! * 0.5);
            fogImgData.data[idx + 2] = Math.round(fogImgData.data[idx + 2]! * 0.5);
          }
          // CELL_CLEAR (2) — leave terrain colors as-is.
        }
      }
      minimapCtx.putImageData(fogImgData, 0, 0);
    }

    // Draw entity dots (respect fog of war — hide enemy entities in non-visible cells).
    if (showEntityBlips) {
      const renderStates = getCachedRenderStates();
      for (const entity of renderStates) {
        const px = (entity.x / heightmap.worldWidth) * MINIMAP_SIZE;
        const py = (entity.z / heightmap.worldDepth) * MINIMAP_SIZE;
        const normalizedEntitySide = entity.side?.toUpperCase() ?? '';
        const normalizedLocalSide = localSide?.toUpperCase() ?? '';
        const isAlly = normalizedEntitySide === normalizedLocalSide;

        // Non-ally entities are only visible in CELL_CLEAR fog cells.
        if (!isAlly && localSide) {
          const cellVis = gameLogic.getCellVisibility(localSide, entity.x, entity.z);
          if (cellVis !== 2) continue; // Not CELL_CLEAR — skip.
        }

        // Size the blip by entity category: buildings largest, vehicles mid, infantry smallest.
        let blipSize: number;
        switch (entity.category) {
          case 'building':
            blipSize = 6;
            break;
          case 'vehicle':
            blipSize = 4;
            break;
          case 'infantry':
            blipSize = 2;
            break;
          case 'air':
            blipSize = 3;
            break;
          default:
            blipSize = 3;
            break;
        }
        const half = Math.floor(blipSize / 2);
        minimapCtx.fillStyle = isAlly ? '#00cc00' : '#cc3333';
        minimapCtx.fillRect(px - half, py - half, blipSize, blipSize);

        // Draw a dark outline around buildings for extra visibility.
        if (entity.category === 'building') {
          minimapCtx.strokeStyle = isAlly ? '#005500' : '#660000';
          minimapCtx.lineWidth = 1;
          minimapCtx.strokeRect(px - half, py - half, blipSize, blipSize);
        }
      }
    }

    // Draw camera viewport frustum.
    const camState = rtsCamera.getState();
    const viewHalfW = camState.zoom * 0.8;
    const viewHalfH = camState.zoom * 0.5;
    const cos = Math.cos(camState.angle);
    const sin = Math.sin(camState.angle);

    // Corners of the camera view in world space.
    const corners: readonly [number, number][] = [
      [-viewHalfW, -viewHalfH],
      [viewHalfW, -viewHalfH],
      [viewHalfW, viewHalfH],
      [-viewHalfW, viewHalfH],
    ];

    minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    for (let i = 0; i < corners.length; i++) {
      const [lx, lz] = corners[i]!;
      const wx = camState.targetX + lx * cos - lz * sin;
      const wz = camState.targetZ + lx * sin + lz * cos;
      const px = (wx / heightmap.worldWidth) * MINIMAP_SIZE;
      const py = (wz / heightmap.worldDepth) * MINIMAP_SIZE;
      if (i === 0) minimapCtx.moveTo(px, py);
      else minimapCtx.lineTo(px, py);
    }
    minimapCtx.closePath();
    minimapCtx.stroke();

    // Draw minimap beacon pings — expanding circles that fade out over 1 second.
    const now = performance.now();
    for (let i = minimapPings.length - 1; i >= 0; i--) {
      const ping = minimapPings[i]!;
      const elapsed = now - ping.startTime;
      if (elapsed >= MINIMAP_PING_DURATION_MS) {
        minimapPings.splice(i, 1);
        continue;
      }
      const t = elapsed / MINIMAP_PING_DURATION_MS;
      const radius = MINIMAP_PING_RADIUS_MIN + t * (MINIMAP_PING_RADIUS_MAX - MINIMAP_PING_RADIUS_MIN);
      const opacity = MINIMAP_PING_INITIAL_OPACITY * (1 - t);
      minimapCtx.strokeStyle = `rgba(255, 255, 255, ${opacity.toFixed(3)})`;
      minimapCtx.lineWidth = 1.5;
      minimapCtx.beginPath();
      minimapCtx.arc(ping.x, ping.y, radius, 0, Math.PI * 2);
      minimapCtx.stroke();
    }
  };

  let frameCount = 0;
  let lastFpsUpdate = performance.now();
  let displayFps = 0;
  const cameraForward = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();

  const activateControlBarSlot = (slotIndex: number): void => {
    const sourceSlot = slotIndex + 1;
    const activation = uiRuntime.activateControlBarSlot(sourceSlot);
    const buttons = uiRuntime.getControlBarButtons();
    const button = buttons.find((candidate) => candidate.slot === sourceSlot) ?? null;
    if (!button && activation.status === 'missing') {
      return;
    }

    const buttonLabel = button?.label ?? `Slot ${sourceSlot}`;
    if (activation.status === 'needs-target') {
      uiRuntime.showMessage(`${buttonLabel}: select target with right-click.`);
      playUiFeedbackAudio(iniDataRegistry, audioManager, 'select');
      return;
    }
    if (activation.status === 'issued') {
      playUiFeedbackAudio(iniDataRegistry, audioManager, 'accept');
      return;
    }
    if (activation.status === 'disabled') {
      uiRuntime.showMessage(`${buttonLabel}: unavailable.`);
      playUiFeedbackAudio(iniDataRegistry, audioManager, 'invalid');
    }
  };

  /**
   * Resolve a control bar slot from a pressed key by matching against
   * current HUD slot hotkeys. In C++ Generals, letter hotkeys from '&'
   * markers in command labels are the primary activation mechanism.
   * Number keys 0, -, = activate slots 10-12 directly.
   */
  const resolveControlBarSlotFromHotkey = (key: string): number | null => {
    // 0, -, = always map to slots 10-12
    if (key === '0') return 10;
    if (key === '-') return 11;
    if (key === '=') return 12;

    // Match letter/digit keys against current button hotkeys
    const lowerKey = key.toLowerCase();
    const hudSlots = uiRuntime.getControlBarHudSlots();
    for (const slot of hudSlots) {
      if (slot.state !== 'empty' && slot.hotkey === lowerKey) {
        return slot.slot;
      }
    }
    return null;
  };

  // ========================================================================
  // Keyboard shortcut help overlay (F1 or ?)
  // ========================================================================

  const helpOverlay = document.createElement('div');
  helpOverlay.id = 'help-overlay';
  helpOverlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: none; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.7); z-index: 950;
    font-family: 'Segoe UI', Arial, sans-serif; color: #e0d8c0;
  `;

  const helpPanel = document.createElement('div');
  helpPanel.style.cssText = `
    background: rgba(12, 16, 28, 0.95); border: 1px solid rgba(201, 168, 76, 0.35);
    padding: 28px 36px; max-width: 720px; width: 90%;
    pointer-events: auto;
  `;

  const helpTitle = document.createElement('div');
  helpTitle.style.cssText = `
    font-size: 1.3rem; color: #c9a84c; text-transform: uppercase;
    letter-spacing: 0.25em; margin-bottom: 20px; text-align: center;
  `;
  helpTitle.textContent = 'Keyboard Shortcuts';

  const shortcutSections: { heading: string; entries: [string, string][] }[] = [
    {
      heading: 'Camera',
      entries: [
        ['Space', 'Center on selection'],
        ['Home', 'Center on Command Center'],
        ['Mouse Wheel', 'Zoom in/out'],
        ['Middle-drag', 'Rotate camera'],
      ],
    },
    {
      heading: 'Selection',
      entries: [
        ['Click', 'Select unit/building'],
        ['Ctrl+A', 'Select all own units'],
        ['Double-click', 'Select same type'],
        ['1\u20139', 'Recall control group'],
        ['Ctrl+1\u20139', 'Save control group'],
        ['Shift+1\u20139', 'Add to control group'],
        ['Tab', 'Cycle idle buildings'],
      ],
    },
    {
      heading: 'Commands',
      entries: [
        ['Right-click', 'Move / Attack'],
        ['A', 'Attack-move mode'],
        ['G', 'Guard'],
        ['S', 'Stop'],
        ['X', 'Scatter'],
        ['Delete', 'Sell structure'],
      ],
    },
    {
      heading: 'Building',
      entries: [
        ['Z / C', 'Rotate placement'],
        ['Shift+click', 'Queue waypoints'],
        ['Ctrl+click', 'Force-fire ground'],
      ],
    },
    {
      heading: 'Game',
      entries: [
        ['P', 'Pause'],
        ['+ / \u2212', 'Adjust speed'],
        ['Backspace', 'Reset speed'],
        ['Escape', 'Menu / Cancel'],
        ['F4', 'General\'s Powers'],
        ['F9', 'Diplomacy'],
        ['F11', 'Fullscreen'],
        ['F1 or ?', 'This help'],
      ],
    },
  ];

  const columnsWrap = document.createElement('div');
  columnsWrap.style.cssText = `
    display: grid; grid-template-columns: 1fr 1fr; gap: 20px 32px;
  `;

  for (const section of shortcutSections) {
    const sectionDiv = document.createElement('div');

    const heading = document.createElement('div');
    heading.style.cssText = `
      font-size: 0.8rem; color: #c9a84c; text-transform: uppercase;
      letter-spacing: 0.15em; margin-bottom: 8px; border-bottom: 1px solid rgba(201,168,76,0.25);
      padding-bottom: 4px;
    `;
    heading.textContent = section.heading;
    sectionDiv.appendChild(heading);

    for (const [key, desc] of section.entries) {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex; justify-content: space-between; align-items: baseline;
        padding: 3px 0; font-size: 0.85rem;
      `;

      const keySpan = document.createElement('span');
      keySpan.style.cssText = `
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
        border-radius: 3px; padding: 1px 7px; font-size: 0.75rem;
        font-family: 'Consolas', 'Courier New', monospace; color: #fff;
        margin-right: 12px; white-space: nowrap;
      `;
      keySpan.textContent = key;

      const descSpan = document.createElement('span');
      descSpan.style.cssText = 'color: #b0a890; flex: 1; text-align: right;';
      descSpan.textContent = desc;

      row.appendChild(keySpan);
      row.appendChild(descSpan);
      sectionDiv.appendChild(row);
    }

    columnsWrap.appendChild(sectionDiv);
  }

  const helpFooter = document.createElement('div');
  helpFooter.style.cssText = `
    text-align: center; margin-top: 20px; font-size: 0.7rem;
    color: #6a6258; letter-spacing: 0.1em;
  `;
  helpFooter.textContent = 'Press F1, ?, or Escape to close';

  helpPanel.appendChild(helpTitle);
  helpPanel.appendChild(columnsWrap);
  helpPanel.appendChild(helpFooter);
  helpOverlay.appendChild(helpPanel);
  document.body.appendChild(helpOverlay);

  // Click outside the panel closes the overlay
  helpOverlay.addEventListener('mousedown', (e) => {
    if (e.target === helpOverlay) {
      helpVisible = false;
      helpOverlay.style.display = 'none';
    }
  });

  let helpVisible = false;
  function toggleHelp(): void {
    helpVisible = !helpVisible;
    helpOverlay.style.display = helpVisible ? 'flex' : 'none';
  }
  function hideHelp(): void {
    helpVisible = false;
    helpOverlay.style.display = 'none';
  }

  // F1/? help overlay, F2 toggle debug overlay, F3 toggle wireframe
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1' || e.key === '?') {
      e.preventDefault();
      toggleHelp();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      uiRuntime.toggleDebugOverlay();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      terrainVisual.toggleWireframe();
      return;
    }
    if (e.key === 'F4') {
      e.preventDefault();
      generalsPowersPanel.toggle();
      return;
    }
    if (e.key === 'F11') {
      e.preventDefault();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
      return;
    }

    // Activate control bar slots via hotkeys when Ctrl is NOT held.
    // Digits 1-9 are reserved for control group recall (handled elsewhere).
    if (!e.ctrlKey && !e.metaKey && !/^[1-9]$/.test(e.key)) {
      const resolvedSlot = resolveControlBarSlotFromHotkey(e.key);
      if (resolvedSlot !== null) {
        e.preventDefault();
        activateControlBarSlot(resolvedSlot - 1);
      }
    }
  });

  // ========================================================================
  // Command card button grid (clickable 4x3 panel)
  // ========================================================================

  const commandCardContainer = document.createElement('div');
  commandCardContainer.id = 'command-card';
  Object.assign(commandCardContainer.style, {
    position: 'absolute',
    bottom: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '100',
    pointerEvents: 'auto',
  });
  document.getElementById('game-container')!.appendChild(commandCardContainer);

  // Source behavior from ControlBar: right-clicking a production command button
  // cancels the most recent queued instance of that item and refunds the cost.
  const cancelProductionAtSlot = (slotIndex: number): void => {
    const controlBarModel = uiRuntime.getControlBarModel();
    const slotEntries = controlBarModel.getButtonsBySlot();
    const entry = slotEntries.find((s) => s.slot === slotIndex);
    const button = entry?.button ?? null;
    if (!button) {
      return;
    }

    const selectedEntityIds = gameLogic.getLocalPlayerSelectionIds();
    if (selectedEntityIds.length !== 1) {
      return;
    }
    const selectedEntityId = selectedEntityIds[0]!;

    const cancelled = cancelProductionForButton(
      button,
      selectedEntityId,
      iniDataRegistry,
      gameLogic,
    );
    if (cancelled) {
      playUiFeedbackAudio(iniDataRegistry, audioManager, 'accept');
    }
  };

  const runtimeManifest = ctx.assets.getManifest();
  const textureUrlMap = buildTextureUrlMap(runtimeManifest);

  // Initialize MappedImage resolver for command card button icons
  const mappedImageResolver = new MappedImageResolver(
    `${RUNTIME_ASSET_BASE_URL}/textures/Art/Textures`,
    textureUrlMap,
  );
  mappedImageResolver.addEntries(iniDataRegistry.getAllMappedImages());

  const commandCardRenderer = new CommandCardRenderer(
    commandCardContainer,
    uiRuntime.getControlBarModel(),
    {
      onSlotActivated: (slot, count) => { for (let i = 0; i < count; i++) activateControlBarSlot(slot - 1); },
      onSlotRightClicked: (slot) => cancelProductionAtSlot(slot),
      mappedImageResolver,
    },
  );

  // ========================================================================
  // Production queue UI panel
  // ========================================================================

  const productionPanel = document.createElement('div');
  productionPanel.id = 'production-panel';
  Object.assign(productionPanel.style, {
    position: 'absolute',
    bottom: '8px',
    right: '8px',
    width: '220px',
    background: 'rgba(12, 16, 28, 0.85)',
    border: '1px solid rgba(201, 168, 76, 0.4)',
    color: '#e0d8c0',
    fontFamily: "'Segoe UI', Arial, sans-serif",
    fontSize: '12px',
    padding: '8px',
    zIndex: '100',
    display: 'none',
    pointerEvents: 'auto',
  });
  document.getElementById('game-container')!.appendChild(productionPanel);

  const SOURCE_UI_RESOLUTION = { width: 800, height: 600 } as const;
  const applySourceHudBox = (
    element: HTMLElement,
    left: number,
    top: number,
    width?: number,
    height?: number,
    scaleContent = false,
  ): void => {
    const scaleX = window.innerWidth / SOURCE_UI_RESOLUTION.width;
    const scaleY = window.innerHeight / SOURCE_UI_RESOLUTION.height;
    element.style.left = `${left * scaleX}px`;
    element.style.top = `${top * scaleY}px`;
    element.style.right = '';
    element.style.bottom = '';
    if (scaleContent) {
      if (width !== undefined) {
        element.style.width = `${width}px`;
      }
      if (height !== undefined) {
        element.style.height = `${height}px`;
      }
      element.style.transformOrigin = 'top left';
      element.style.transform = `scale(${scaleX}, ${scaleY})`;
      return;
    }
    if (width !== undefined) {
      element.style.width = `${width * scaleX}px`;
    }
    if (height !== undefined) {
      element.style.height = `${height * scaleY}px`;
    }
    element.style.transform = 'none';
  };

  const updateSourceHudLayout = (): void => {
    // Source parity: retail ControlBar.wnd anchors the radar inside LeftHUD and
    // the command grid in a 223..603 x 494..589 panel at 800x600.
    applySourceHudBox(minimapCanvas, 7, 443, 167, 152);
    applySourceHudBox(commandCardContainer, 223, 494, undefined, undefined, true);
    applySourceHudBox(creditsHud, 360, 437, 79, 19, true);
    applySourceHudBox(powerHud, 261, 470, 283, 16, true);
  };
  updateSourceHudLayout();

  const updateProductionPanel = (): void => {
    const selectedIds = gameLogic.getLocalPlayerSelectionIds();
    if (selectedIds.length !== 1) {
      productionPanel.style.display = 'none';
      return;
    }

    const entityId = selectedIds[0]!;
    const prodState = gameLogic.getProductionState(entityId);
    if (!prodState || prodState.queue.length === 0) {
      productionPanel.style.display = 'none';
      return;
    }

    productionPanel.style.display = 'block';
    productionPanel.textContent = '';

    const header = document.createElement('div');
    Object.assign(header.style, { color: '#c9a84c', fontWeight: '600', marginBottom: '6px' });
    header.textContent = 'Production Queue';
    productionPanel.appendChild(header);

    for (const entry of prodState.queue) {
      const name = entry.type === 'UNIT' ? entry.templateName : entry.upgradeName;
      const pct = Math.round(entry.percentComplete);
      const barColor = pct >= 100 ? '#00cc00' : '#c9a84c';

      const row = document.createElement('div');
      row.style.marginBottom = '4px';

      const labelRow = document.createElement('div');
      Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between' });
      const nameSpan = document.createElement('span');
      nameSpan.textContent = name;
      const pctSpan = document.createElement('span');
      pctSpan.textContent = `${pct}%`;
      labelRow.appendChild(nameSpan);
      labelRow.appendChild(pctSpan);

      const barBg = document.createElement('div');
      Object.assign(barBg.style, { height: '4px', background: '#222', borderRadius: '2px', overflow: 'hidden' });
      const barFill = document.createElement('div');
      Object.assign(barFill.style, { width: `${pct}%`, height: '100%', background: barColor });
      barBg.appendChild(barFill);

      row.appendChild(labelRow);
      row.appendChild(barBg);
      productionPanel.appendChild(row);
    }
  };

  // ========================================================================
  // Move order feedback indicators
  // ========================================================================

  interface MoveIndicator {
    mesh: THREE.Mesh;
    startTime: number;
  }

  const MOVE_INDICATOR_DURATION_MS = 600;
  const moveIndicators: MoveIndicator[] = [];
  const moveIndicatorGeometry = new THREE.RingGeometry(0.8, 1.2, 24);
  const moveIndicatorMaterialGreen = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const moveIndicatorMaterialRed = new THREE.MeshBasicMaterial({
    color: 0xff3333,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const spawnMoveIndicator = (worldX: number, worldZ: number, isAttack: boolean): void => {
    const y = heightmap.getInterpolatedHeight(worldX, worldZ) + 0.1;
    const material = (isAttack ? moveIndicatorMaterialRed : moveIndicatorMaterialGreen).clone();
    const mesh = new THREE.Mesh(moveIndicatorGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(worldX, y, worldZ);
    mesh.renderOrder = 800;
    scene.add(mesh);
    moveIndicators.push({ mesh, startTime: performance.now() });
  };

  const updateMoveIndicators = (): void => {
    const now = performance.now();
    for (let i = moveIndicators.length - 1; i >= 0; i--) {
      const indicator = moveIndicators[i]!;
      const elapsed = now - indicator.startTime;
      const t = elapsed / MOVE_INDICATOR_DURATION_MS;
      if (t >= 1) {
        scene.remove(indicator.mesh);
        (indicator.mesh.material as THREE.MeshBasicMaterial).dispose();
        moveIndicators.splice(i, 1);
        continue;
      }
      const scale = 1 + t * 1.5;
      indicator.mesh.scale.set(scale, scale, 1);
      (indicator.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    }
  };

  // ========================================================================
  // Rally point visualization
  // ========================================================================

  const rallyLineGeometry = new THREE.BufferGeometry();
  const rallyLineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
  const rallyLine = new THREE.Line(rallyLineGeometry, rallyLineMaterial);
  rallyLine.name = 'rally-line';
  rallyLine.visible = false;
  rallyLine.renderOrder = 700;
  scene.add(rallyLine);

  // Rally flag marker (cone at target — bright green with emissive glow).
  const rallyMarkerGeometry = new THREE.ConeGeometry(1.5, 3, 8);
  const rallyMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.6 });
  const rallyMarker = new THREE.Mesh(rallyMarkerGeometry, rallyMarkerMaterial);
  rallyMarker.name = 'rally-marker';
  rallyMarker.visible = false;
  rallyMarker.renderOrder = 700;
  scene.add(rallyMarker);

  const updateRallyPointVisual = (): void => {
    const selectedIds = gameLogic.getLocalPlayerSelectionIds();
    if (selectedIds.length !== 1) {
      rallyLine.visible = false;
      rallyMarker.visible = false;
      return;
    }

    const entityState = gameLogic.getEntityState(selectedIds[0]!);
    if (!entityState || !entityState.rallyPoint) {
      rallyLine.visible = false;
      rallyMarker.visible = false;
      return;
    }

    const rp = entityState.rallyPoint;
    const startY = entityState.y + 1;
    const endY = heightmap.getInterpolatedHeight(rp.x, rp.z) + 0.5;

    let posAttr = rallyLineGeometry.getAttribute('position') as THREE.BufferAttribute | null;
    if (!posAttr) {
      posAttr = new THREE.BufferAttribute(new Float32Array(6), 3);
      rallyLineGeometry.setAttribute('position', posAttr);
    }
    const arr = posAttr.array as Float32Array;
    arr[0] = entityState.x; arr[1] = startY; arr[2] = entityState.z;
    arr[3] = rp.x; arr[4] = endY; arr[5] = rp.z;
    posAttr.needsUpdate = true;
    rallyLineGeometry.computeBoundingSphere();
    rallyLine.visible = true;

    rallyMarker.position.set(rp.x, endY + 0.75, rp.z);
    rallyMarker.visible = true;
  };

  // ========================================================================
  // Waypoint path visualization (green lines showing selected unit's route)
  // ========================================================================

  const waypointPathMaterial = new THREE.LineBasicMaterial({
    color: 0x44ff44,
    linewidth: 1,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });
  // Source parity: attack-move waypoint lines shown in red instead of green
  const waypointPathMaterialRed = new THREE.LineBasicMaterial({
    color: 0xff4444,
    linewidth: 1,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });
  const waypointPathLine = new THREE.Line(
    new THREE.BufferGeometry(),
    waypointPathMaterial,
  );
  waypointPathLine.name = 'waypoint-path';
  waypointPathLine.visible = false;
  waypointPathLine.renderOrder = 699;
  scene.add(waypointPathLine);

  // Reusable Float32Array for waypoint line vertices (grows as needed).
  let waypointPathBuffer = new Float32Array(3 * 32); // Start with 32 vertices

  const updateWaypointPathVisual = (): void => {
    const selectedIds = gameLogic.getLocalPlayerSelectionIds();
    if (selectedIds.length !== 1) {
      waypointPathLine.visible = false;
      return;
    }

    const entityState = gameLogic.getEntityState(selectedIds[0]!);
    if (!entityState || !entityState.moving || !entityState.movePath || entityState.movePath.length === 0) {
      waypointPathLine.visible = false;
      return;
    }

    const pathIndex = entityState.pathIndex ?? 0;
    const remaining = entityState.movePath.length - pathIndex;
    if (remaining <= 0) {
      waypointPathLine.visible = false;
      return;
    }

    // Build vertex array: entity position + remaining waypoints
    const vertexCount = 1 + remaining;
    const floatCount = vertexCount * 3;
    if (waypointPathBuffer.length < floatCount) {
      waypointPathBuffer = new Float32Array(floatCount);
    }

    // First vertex: current entity position
    waypointPathBuffer[0] = entityState.x;
    waypointPathBuffer[1] = entityState.y + 0.5;
    waypointPathBuffer[2] = entityState.z;

    // Remaining vertices: waypoints from current path index onward
    for (let i = 0; i < remaining; i++) {
      const wp = entityState.movePath[pathIndex + i]!;
      const wpY = heightmap.getInterpolatedHeight(wp.x, wp.z) + 0.5;
      waypointPathBuffer[(i + 1) * 3] = wp.x;
      waypointPathBuffer[(i + 1) * 3 + 1] = wpY;
      waypointPathBuffer[(i + 1) * 3 + 2] = wp.z;
    }

    const geom = waypointPathLine.geometry;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | null;
    if (!posAttr || posAttr.count < vertexCount) {
      geom.setAttribute('position', new THREE.BufferAttribute(
        waypointPathBuffer.slice(0, floatCount), 3,
      ));
    } else {
      (posAttr.array as Float32Array).set(waypointPathBuffer.subarray(0, floatCount));
      posAttr.needsUpdate = true;
    }
    geom.setDrawRange(0, vertexCount);
    geom.computeBoundingSphere();
    // Red line when entity is actively attacking; green for normal movement
    waypointPathLine.material = entityState.attackTargetEntityId !== null
      ? waypointPathMaterialRed : waypointPathMaterial;
    waypointPathLine.visible = true;
  };

  // ========================================================================
  // Data-driven particle & FX system (replaces inline particle effects)
  // ========================================================================

  const gameLODManager = new GameLODManager(iniDataRegistry);
  gameLODManager.init();
  const particleSystemManager = new ParticleSystemManager(scene, gameLODManager);
  particleSystemManager.loadFromRegistry(iniDataRegistry);
  particleSystemManager.init();
  if (runtimeSaveLoadContext?.runtimeSave.particleSystemState) {
    particleSystemManager.restoreSaveState(runtimeSaveLoadContext.runtimeSave.particleSystemState);
  }
  const decalManager = new DecalManager(scene, 256, 128);
  decalManager.init();
  addPreplacedMapScorchMarks(mapData, heightmap, decalManager);

  const fxListManager = new FXListManager(particleSystemManager);
  const laserBeamRenderer = new LaserBeamRenderer(scene);
  const dynamicLightManager = new DynamicLightManager(scene);
  const tracerRenderer = new TracerRenderer(scene);
  const debrisRenderer = new DebrisRenderer(scene);
  fxListManager.loadFromRegistry(iniDataRegistry);
  fxListManager.setCallbacks({
    onSound: (name, position) => {
      audioManager.addAudioEvent(name, [position.x, position.y, position.z]);
    },
    onTerrainScorch: (scorchType, radius, position) => {
      decalManager.addScorchMark(scorchType, radius, position);
    },
  });
  fxListManager.init();

  // Voice and music bridges.
  const voiceBridge = new VoiceAudioBridge(iniDataRegistry, audioManager, gameLogic);
  const musicManager = new MusicManager(audioManager);
  musicManager.setAmbientMusic();

  const processVisualEvents = (): void => {
    const events = gameLogic.drainVisualEvents();
    for (const event of events) {
      const pos = new THREE.Vector3(event.x, event.y, event.z);

      // Combat events trigger battle music.
      if (event.type === 'WEAPON_FIRED' || event.type === 'WEAPON_IMPACT' || event.type === 'ENTITY_DESTROYED') {
        musicManager.notifyCombat();
      }

      // Spawn directed weapon visuals using target endpoint.
      if (
        event.targetX !== undefined &&
        event.targetY !== undefined &&
        event.targetZ !== undefined
      ) {
        if (event.projectileType === 'LASER') {
          laserBeamRenderer.addBeam(
            event.x, event.y, event.z,
            event.targetX, event.targetY, event.targetZ,
          );
        } else if (event.projectileType === 'BULLET') {
          tracerRenderer.addTracer(
            event.x, event.y, event.z,
            event.targetX, event.targetY, event.targetZ,
          );
        }
      }

      const plannedActions = planCombatVisualEffects(event);
      // Try to route each visual action through an FXList
      let fxHandled = false;
      for (const action of plannedActions) {
        if (action.type === 'playAudio') {
          audioManager.addAudioEvent(action.eventName, [event.x, event.y, event.z]);
          continue;
        }

        // Spawn dynamic lights for explosions and muzzle flashes.
        if (action.type === 'spawnExplosion') {
          dynamicLightManager.addExplosionLight(event.x, event.y, event.z, event.radius || 5);
        } else if (action.type === 'spawnMuzzleFlash') {
          dynamicLightManager.addMuzzleFlashLight(event.x, event.y, event.z);
        }

        // Spawn debris for destruction events.
        if (action.type === 'spawnDestruction') {
          debrisRenderer.spawnDebris(event.x, event.y, event.z, {
            radius: event.radius || 3,
            count: Math.min(12, Math.max(4, Math.round(event.radius * 2))),
          });
        }

        // Spawn ground scorch mark at explosion site.
        if (action.type === 'spawnScorch') {
          decalManager.addScorchMark('RANDOM', action.radius || 3, pos);
        }

        if (!fxHandled) {
          const fxName = resolveFallbackFXListName(event.type, action.type);
          if (fxName && fxListManager.hasFXList(fxName)) {
            fxListManager.triggerFXList(fxName, pos);
            fxHandled = true;
          }
        }
      }
    }
  };

  function resolveFallbackFXListName(_eventType: string, actionType: string): string | null {
    // Map event/action types to well-known FXList names from retail INI
    if (actionType === 'spawnExplosion') return 'FX_GenericExplosion';
    if (actionType === 'spawnMuzzleFlash') return 'FX_MuzzleFlash';
    if (actionType === 'spawnDestruction') return 'FX_GenericDestruction';
    return null;
  }

  // ========================================================================
  // Projectile visuals
  // ========================================================================

  const projectileMeshPool = new Map<number, THREE.Mesh>();

  // Shared geometries for projectile types.
  const bulletGeometry = new THREE.SphereGeometry(0.3, 6, 4);
  const missileGeometry = new THREE.ConeGeometry(0.25, 1.5, 6);
  const artilleryGeometry = new THREE.SphereGeometry(0.5, 8, 6);

  // Shared materials for projectile types.
  const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffee44 });
  const missileMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const artilleryMaterial = new THREE.MeshBasicMaterial({ color: 0x444444 });
  const laserMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });

  const _projectileActiveIds = new Set<number>();
  const updateProjectileVisuals = (): void => {
    const activeProjectiles = gameLogic.getActiveProjectiles();
    _projectileActiveIds.clear();
    const activeIds = _projectileActiveIds;

    for (const proj of activeProjectiles) {
      activeIds.add(proj.id);
      let mesh = projectileMeshPool.get(proj.id);
      if (!mesh) {
        // Create new mesh based on visual type.
        let geometry: THREE.BufferGeometry;
        let material: THREE.Material;
        switch (proj.visualType) {
          case 'MISSILE':
            geometry = missileGeometry;
            material = missileMaterial;
            break;
          case 'ARTILLERY':
            geometry = artilleryGeometry;
            material = artilleryMaterial;
            break;
          case 'LASER':
            geometry = bulletGeometry;
            material = laserMaterial;
            break;
          default:
            geometry = bulletGeometry;
            material = bulletMaterial;
            break;
        }
        mesh = new THREE.Mesh(geometry, material);
        mesh.name = `projectile-${proj.id}`;
        mesh.renderOrder = 600;
        scene.add(mesh);
        projectileMeshPool.set(proj.id, mesh);
      }

      mesh.position.set(proj.x, proj.y, proj.z);
      mesh.rotation.y = proj.heading;
      // Missiles and bullets point forward (tilt along flight path).
      if (proj.visualType === 'MISSILE') {
        const pitchAngle = -Math.PI / 2 + (1 - proj.progress) * Math.PI * 0.3;
        mesh.rotation.x = pitchAngle;
      }
      mesh.visible = true;
    }

    // Remove projectiles that are no longer in flight.
    for (const [id, mesh] of projectileMeshPool) {
      if (!activeIds.has(id)) {
        scene.remove(mesh);
        mesh.geometry !== bulletGeometry &&
          mesh.geometry !== missileGeometry &&
          mesh.geometry !== artilleryGeometry &&
          mesh.geometry.dispose();
        projectileMeshPool.delete(id);
      }
    }
  };

  // ========================================================================
  // Control groups (Ctrl+1-9 to save, 1-9 to recall, double-tap to center)
  // ========================================================================

  // controlGroups is hoisted above updateEntityInfoPanel for badge display.
  const lastGroupTapTime = new Map<number, number>();
  const DOUBLE_TAP_MS = 400;
  let previousSelectionSnapshot: readonly number[] = [];

  window.addEventListener('keydown', (e) => {
    const digit = parseInt(e.key, 10);
    if (isNaN(digit) || digit < 1 || digit > 9) return;

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+N: save current selection to group N.
      e.preventDefault();
      const selectedIds = gameLogic.getLocalPlayerSelectionIds();
      if (selectedIds.length > 0) {
        controlGroups.set(digit, [...selectedIds]);
      }
    } else if (e.shiftKey && !e.altKey && !(e.ctrlKey || e.metaKey)) {
      // Shift+N: append current selection to group N.
      // Source parity: C++ InGameUI adds to existing group without replacing.
      e.preventDefault();
      const selectedIds = gameLogic.getLocalPlayerSelectionIds();
      if (selectedIds.length > 0) {
        const existing = controlGroups.get(digit) ?? [];
        const merged = [...new Set([...existing, ...selectedIds])];
        controlGroups.set(digit, merged);
      }
    } else if (!e.altKey && !e.shiftKey) {
      // N: recall group N.
      const group = controlGroups.get(digit);
      if (!group || group.length === 0) return;
      e.preventDefault();

      // Filter out destroyed entities.
      const aliveIds = group.filter((id) => {
        const state = gameLogic.getEntityState(id);
        return state !== null;
      });
      if (aliveIds.length === 0) {
        controlGroups.delete(digit);
        return;
      }
      controlGroups.set(digit, aliveIds);
      gameLogic.submitCommand({ type: 'selectEntities', entityIds: aliveIds });

      // Double-tap: center camera on group.
      const now = performance.now();
      const lastTap = lastGroupTapTime.get(digit) ?? 0;
      lastGroupTapTime.set(digit, now);
      if (now - lastTap < DOUBLE_TAP_MS) {
        let sumX = 0;
        let sumZ = 0;
        let count = 0;
        for (const id of aliveIds) {
          const entityState = gameLogic.getEntityState(id);
          if (entityState) {
            sumX += entityState.x;
            sumZ += entityState.z;
            count++;
          }
        }
        if (count > 0) {
          rtsCamera.lookAt(sumX / count, sumZ / count);
        }
      }
    }
  });

  // ========================================================================
  // Game speed control (keyboard shortcuts)
  // ========================================================================

  const SPEED_STEPS = [0.5, 1, 2, 4];

  const updateSpeedHud = (): void => {
    if (gameLoop.paused) {
      speedHud!.textContent = '\u23F8 PAUSED';
      speedHud!.style.display = 'block';
      speedHud!.style.fontSize = '22px';
      speedHud!.style.color = '#ff4444';
    } else if (gameLoop.speed !== 1) {
      speedHud!.textContent = `\u25B6 ${gameLoop.speed}x`;
      speedHud!.style.display = 'block';
      speedHud!.style.fontSize = '16px';
      speedHud!.style.color = gameLoop.speed > 1 ? '#ffcc00' : '#66ccff';
    } else {
      speedHud!.style.display = 'none';
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
      // Toggle pause
      e.preventDefault();
      gameLoop.paused = !gameLoop.paused;
      updateSpeedHud();
      return;
    }
    if (e.key === '+' || e.key === '=') {
      // Increase speed
      e.preventDefault();
      if (gameLoop.paused) return;
      const idx = SPEED_STEPS.indexOf(gameLoop.speed);
      if (idx >= 0 && idx < SPEED_STEPS.length - 1) {
        gameLoop.speed = SPEED_STEPS[idx + 1]!;
      }
      updateSpeedHud();
      return;
    }
    if (e.key === '-') {
      // Decrease speed
      e.preventDefault();
      if (gameLoop.paused) return;
      const idx = SPEED_STEPS.indexOf(gameLoop.speed);
      if (idx > 0) {
        gameLoop.speed = SPEED_STEPS[idx - 1]!;
      }
      updateSpeedHud();
      return;
    }
    if (e.key === 'Backspace') {
      // Reset to 1x
      e.preventDefault();
      gameLoop.speed = 1;
      gameLoop.paused = false;
      updateSpeedHud();
      return;
    }
  });

  // ========================================================================
  // Building placement ghost
  // ========================================================================

  const ghostValidMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ghostInvalidMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  function applyGhostMaterial(obj: THREE.Object3D, material: THREE.Material): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = material;
      }
    });
  }

  const buildingGhostGroup = new THREE.Group();
  buildingGhostGroup.name = 'building-ghost';
  buildingGhostGroup.visible = false;
  buildingGhostGroup.renderOrder = 600;
  scene.add(buildingGhostGroup);

  let buildingGhostModel: THREE.Object3D | null = null;
  let buildingGhostTemplateName: string | null = null;
  let buildingGhostLoadingTemplate: string | null = null;

  // Ground footprint outline shown during building placement.
  const footprintOutlineGeometry = new THREE.BufferGeometry();
  // 5 vertices to close the rectangle (first == last for LineLoop visual parity with Line).
  footprintOutlineGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      -1, 0, -1,
       1, 0, -1,
       1, 0,  1,
      -1, 0,  1,
      -1, 0, -1,
    ], 3),
  );
  const footprintValidColor = new THREE.Color(0x00ff00);
  const footprintInvalidColor = new THREE.Color(0xff0000);
  const footprintOutlineMaterial = new THREE.LineBasicMaterial({
    color: footprintValidColor,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    opacity: 0.8,
  });
  const footprintOutline = new THREE.Line(footprintOutlineGeometry, footprintOutlineMaterial);
  footprintOutline.name = 'building-footprint-outline';
  footprintOutline.renderOrder = 601;
  footprintOutline.visible = false;
  scene.add(footprintOutline);
  let footprintHalfW = 10; // default half-width (world units)
  let footprintHalfH = 10; // default half-height (world units)

  // Fallback box shown while the real model is loading.
  const ghostFallbackGeometry = new THREE.BoxGeometry(4, 2, 4);
  const ghostFallbackMesh = new THREE.Mesh(ghostFallbackGeometry, ghostValidMaterial);
  ghostFallbackMesh.name = 'building-ghost-fallback';

  function resolveGhostTemplateName(sourceButtonId: string): string | null {
    const commandButton = iniDataRegistry.getCommandButton(sourceButtonId);
    if (!commandButton) {
      return null;
    }
    const objectToken = commandButton.fields['Object'];
    if (typeof objectToken === 'string' && objectToken.trim()) {
      return objectToken.trim().split(/[\s,;|]+/)[0] ?? null;
    }
    return null;
  }

  function loadGhostModelForTemplate(templateName: string): void {
    if (buildingGhostLoadingTemplate === templateName) {
      return;
    }
    buildingGhostLoadingTemplate = templateName;

    const objectDef = iniDataRegistry.getObject(templateName);
    const profile = resolveRenderAssetProfile(objectDef);
    if (!profile.renderAssetPath) {
      buildingGhostLoadingTemplate = null;
      return;
    }

    void objectVisualManager.cloneModelForGhost(profile.renderAssetCandidates).then((clone) => {
      // Stale load guard: template may have changed while loading.
      if (buildingGhostLoadingTemplate !== templateName) {
        return;
      }
      buildingGhostLoadingTemplate = null;

      if (!clone) {
        return;
      }

      // Swap old model for the new one.
      if (buildingGhostModel) {
        buildingGhostGroup.remove(buildingGhostModel);
      }
      buildingGhostGroup.remove(ghostFallbackMesh);

      applyGhostMaterial(clone, ghostValidMaterial);
      clone.renderOrder = 600;
      buildingGhostGroup.add(clone);
      buildingGhostModel = clone;
      buildingGhostTemplateName = templateName;
    });
  }

  const updateBuildingGhost = (inputState: InputState): void => {
    const pending = uiRuntime.getPendingControlBarCommand();
    const isPlacementMode = pending !== null
      && pending.commandType === GUICommandType.GUI_COMMAND_DOZER_CONSTRUCT
      && pending.targetKind === 'position';

    if (!isPlacementMode) {
      if (buildingGhostGroup.visible) {
        buildingGhostGroup.visible = false;
      }
      footprintOutline.visible = false;
      // Clean up when exiting placement mode.
      if (buildingGhostTemplateName !== null) {
        if (buildingGhostModel) {
          buildingGhostGroup.remove(buildingGhostModel);
          buildingGhostModel = null;
        }
        buildingGhostTemplateName = null;
        buildingGhostLoadingTemplate = null;
        buildingGhostAngle = 0;
      }
      return;
    }

    // Determine which building template is being placed.
    const templateName = resolveGhostTemplateName(pending.sourceButtonId);
    if (!templateName) {
      buildingGhostGroup.visible = false;
      footprintOutline.visible = false;
      return;
    }

    // When the template changes, load the new model and update footprint size.
    if (templateName !== buildingGhostTemplateName && templateName !== buildingGhostLoadingTemplate) {
      // Remove old model and show fallback while loading.
      if (buildingGhostModel) {
        buildingGhostGroup.remove(buildingGhostModel);
        buildingGhostModel = null;
      }
      buildingGhostTemplateName = null;
      buildingGhostGroup.add(ghostFallbackMesh);
      loadGhostModelForTemplate(templateName);

      // Derive footprint size from obstacle geometry radii.
      const objDef = iniDataRegistry.getObject(templateName);
      if (objDef) {
        const rawMajor = objDef.fields['GeometryMajorRadius'] ?? objDef.fields['MajorRadius'];
        const rawMinor = objDef.fields['GeometryMinorRadius'] ?? objDef.fields['MinorRadius'];
        const major = typeof rawMajor === 'number' ? Math.abs(rawMajor) : (typeof rawMajor === 'string' ? Math.abs(parseFloat(rawMajor)) : 0);
        const minor = typeof rawMinor === 'number' ? Math.abs(rawMinor) : (typeof rawMinor === 'string' ? Math.abs(parseFloat(rawMinor)) : 0);
        footprintHalfW = major > 0 ? major : 10;
        footprintHalfH = minor > 0 ? minor : footprintHalfW;
      } else {
        footprintHalfW = 10;
        footprintHalfH = 10;
      }
      // Update the footprint outline vertices to match the new size.
      const posAttr = footprintOutlineGeometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.setXYZ(0, -footprintHalfW, 0, -footprintHalfH);
      posAttr.setXYZ(1,  footprintHalfW, 0, -footprintHalfH);
      posAttr.setXYZ(2,  footprintHalfW, 0,  footprintHalfH);
      posAttr.setXYZ(3, -footprintHalfW, 0,  footprintHalfH);
      posAttr.setXYZ(4, -footprintHalfW, 0, -footprintHalfH);
      posAttr.needsUpdate = true;
      footprintOutlineGeometry.computeBoundingSphere();
    }

    // Resolve cursor world position.
    const worldTarget = gameLogic.resolveMoveTargetFromInput(inputState, camera);
    if (!worldTarget) {
      buildingGhostGroup.visible = false;
      footprintOutline.visible = false;
      return;
    }

    // Source parity: Z/C keys rotate building placement (15° per press).
    if (inputState.keysPressed.has('z')) {
      buildingGhostAngle += Math.PI / 12;
    }
    if (inputState.keysPressed.has('c')) {
      buildingGhostAngle -= Math.PI / 12;
    }

    const y = heightmap.getInterpolatedHeight(worldTarget.x, worldTarget.z);
    buildingGhostGroup.position.set(worldTarget.x, y + 1, worldTarget.z);
    buildingGhostGroup.rotation.y = buildingGhostAngle;

    // Position the footprint outline on the ground, slightly above terrain to avoid z-fighting.
    footprintOutline.position.set(worldTarget.x, y + 0.1, worldTarget.z);
    footprintOutline.rotation.y = buildingGhostAngle;

    // Source parity: ghost turns red when placement is invalid.
    // Only re-evaluate when cursor moves to a different grid cell.
    const cellX = Math.floor(worldTarget.x / 10);
    const cellZ = Math.floor(worldTarget.z / 10);
    if (cellX !== lastGhostCellX || cellZ !== lastGhostCellZ) {
      lastGhostCellX = cellX;
      lastGhostCellZ = cellZ;
      const isValid = buildingGhostTemplateName
        ? gameLogic.isBuildLocationValid(buildingGhostTemplateName, worldTarget.x, worldTarget.z)
        : true;
      const ghostMaterial = isValid ? ghostValidMaterial : ghostInvalidMaterial;
      if (buildingGhostModel) {
        applyGhostMaterial(buildingGhostModel, ghostMaterial);
      }
      // Sync footprint outline color with validity.
      footprintOutlineMaterial.color.copy(isValid ? footprintValidColor : footprintInvalidColor);
    }

    buildingGhostGroup.visible = true;
    footprintOutline.visible = true;
  };

  // ========================================================================
  // Drag-select (multi-unit selection)
  // ========================================================================

  const DRAG_SELECT_THRESHOLD = 8; // pixels before a drag is considered a box-select
  const selectionBox = document.createElement('div');
  selectionBox.id = 'selection-box';
  Object.assign(selectionBox.style, {
    position: 'absolute',
    border: '1px solid rgba(0, 255, 0, 0.8)',
    background: 'rgba(0, 255, 0, 0.1)',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '200',
  });
  document.getElementById('game-container')!.appendChild(selectionBox);

  let dragStartX = 0;
  let dragStartY = 0;
  let isDragSelecting = false;
  let wasLeftMouseDown = false;
  let lastHoverObjectId: number | null = null;

  const _projVec = new THREE.Vector3();
  const projectToScreen = (worldX: number, worldY: number, worldZ: number): { sx: number; sy: number } => {
    _projVec.set(worldX, worldY, worldZ);
    _projVec.project(camera);
    return {
      sx: (_projVec.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-_projVec.y * 0.5 + 0.5) * window.innerHeight,
    };
  };

  const performDragSelect = (x0: number, y0: number, x1: number, y1: number): void => {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);

    const localSide = gameLogic.getPlayerSide(networkManager.getLocalPlayerID());
    const states = getCachedRenderStates();
    const selectedIds: number[] = [];

    for (const entity of states) {
      // Only select own mobile units (not buildings, not enemies).
      if (entity.side?.toUpperCase() !== localSide?.toUpperCase()) continue;
      if (entity.animationState === 'DIE') continue;
      if (entity.category === 'building') continue;

      const screen = projectToScreen(entity.x, entity.y, entity.z);
      if (screen.sx >= minX && screen.sx <= maxX && screen.sy >= minY && screen.sy <= maxY) {
        selectedIds.push(entity.id);
      }
    }

    if (selectedIds.length > 0) {
      gameLogic.submitCommand({ type: 'selectEntities', entityIds: selectedIds });
    }
  };

  const emoticonNodeByEntityId = new Map<number, HTMLDivElement>();
  const updateScriptEmoticonOverlay = (currentLogicFrame: number): void => {
    const activeEmoticons = scriptEmoticonRuntimeBridge.getActiveEmoticons(currentLogicFrame);
    const activeEntityIds = new Set<number>();

    for (const emoticon of activeEmoticons) {
      const worldPosition = gameLogic.getEntityWorldPosition(emoticon.entityId);
      if (!worldPosition) {
        continue;
      }

      const screen = projectToScreen(
        worldPosition[0],
        worldPosition[1] + 8,
        worldPosition[2],
      );

      let node = emoticonNodeByEntityId.get(emoticon.entityId) ?? null;
      if (!node) {
        node = document.createElement('div');
        Object.assign(node.style, {
          position: 'absolute',
          transform: 'translate(-50%, -100%)',
          color: '#f4efe1',
          fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
          fontSize: '13px',
          fontWeight: '700',
          letterSpacing: '0.02em',
          textShadow: '0 0 6px rgba(0,0,0,0.95), 0 1px 4px rgba(0,0,0,0.95)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        });
        emoticonOverlay.appendChild(node);
        emoticonNodeByEntityId.set(emoticon.entityId, node);
      }

      node.textContent = emoticon.emoticonName;
      node.style.left = `${Math.round(screen.sx)}px`;
      node.style.top = `${Math.round(screen.sy)}px`;
      node.style.display = 'block';
      activeEntityIds.add(emoticon.entityId);
    }

    for (const [entityId, node] of emoticonNodeByEntityId) {
      if (activeEntityIds.has(entityId)) {
        continue;
      }
      node.remove();
      emoticonNodeByEntityId.delete(entityId);
    }
  };

  // ========================================================================
  // Game loop
  // ========================================================================

  const gameLoop = new GameLoop(30);
  if (replaySkirmishSettings && !campaignContext && !replayContext) {
    replayManager.startRecording(
      activeMapPath ?? replaySkirmishSettings.mapPath ?? '',
      buildReplayPlayers(replaySkirmishSettings),
      Math.round(1000 / gameLoop.simulationDt),
      replaySkirmishSettings.startingCredits,
      replaySkirmishSettings.limitSuperweapons,
    );
  } else if (replayContext) {
    replayManager.loadReplay(replayContext.replay);
    replayManager.play();
  }
  const scriptCinematicRuntimeBridge = createScriptCinematicRuntimeBridge({
    gameLogic,
    view: {
      setLetterboxEnabled(enabled): void {
        const display = enabled ? 'block' : 'none';
        cinematicLetterboxTop.style.display = display;
        cinematicLetterboxBottom.style.display = display;
      },
      showCinematicText(text, fontType): void {
        const normalizedFontType = fontType.trim().toUpperCase();
        if (normalizedFontType.includes('SMALL')) {
          cinematicTextOverlay.style.fontSize = '22px';
        } else if (normalizedFontType.includes('LARGE')) {
          cinematicTextOverlay.style.fontSize = '34px';
        } else {
          cinematicTextOverlay.style.fontSize = '28px';
        }
        cinematicTextOverlay.textContent = text;
        cinematicTextOverlay.style.display = 'block';
      },
      clearCinematicText(): void {
        cinematicTextOverlay.textContent = '';
        cinematicTextOverlay.style.display = 'none';
      },
    },
  });
  const scriptMessageRuntimeBridge = createScriptMessageRuntimeBridge({
    gameLogic,
    uiRuntime,
    setSimulationPaused: (paused) => {
      gameLoop.paused = paused;
    },
  });
  const scriptEvaRuntimeBridge = createScriptEvaRuntimeBridge({
    gameLogic,
    uiRuntime,
    audioManager,
    resolveLocalPlayerSide: () => {
      const localSide = gameLogic.getPlayerSide(networkManager.getLocalPlayerID());
      return localSide ? resolveResolvedFactionSide(localSide, gameLogic) : null;
    },
  });
  const scriptUiEffectsRuntimeBridge = createScriptUiEffectsRuntimeBridge({
    gameLogic,
    uiRuntime,
    videoPlayer: campaignContext?.videoPlayer ?? null,
    onScriptVideoCompleted: (movieName) => {
      gameLogic.notifyScriptVideoCompleted(movieName);
    },
  });
  const scriptEmoticonRuntimeBridge = createScriptEmoticonRuntimeBridge({
    gameLogic,
  });
  const scriptCameraEffectsRuntimeBridge = createScriptCameraEffectsRuntimeBridge({
    gameLogic,
    initialFadeState: runtimeSaveLoadContext?.runtimeSave.scriptEngineFadeState ?? null,
    getCameraTargetPosition: () => {
      const state = rtsCamera.getState();
      return {
        x: state.targetX,
        z: state.targetZ,
      };
    },
    onMotionBlurJumpToPosition: (x, z) => {
      rtsCamera.lookAt(x, z);
    },
  });
  let scriptCameraEffectsState = scriptCameraEffectsRuntimeBridge.syncAfterSimulationStep(0);
  const scriptCameraRuntimeBridge = createScriptCameraRuntimeBridge({
    gameLogic,
    cameraController: rtsCamera,
    getTerrainHeightAt: (worldX, worldZ) => heightmap.getInterpolatedHeight(worldX, worldZ),
  });
  scriptCameraMovementFinished = scriptCameraRuntimeBridge.isCameraMovementFinished();
  scriptCameraTimeFrozen = scriptCameraRuntimeBridge.isCameraTimeFrozen();
  scriptCameraTimeMultiplier = scriptCameraRuntimeBridge.getCameraTimeMultiplier();
  const trackedShortcutSpecialPowerSourceEntityIds = new Set<number>();
  let currentLogicFrame = 0;
  let missionInputLocked = false;

  // Cache getRenderableEntityStates() per frame to avoid 9+ calls allocating
  // 580+ objects each. Invalidated at the start of each simulation step.
  let cachedRenderStates: ReturnType<typeof gameLogic.getRenderableEntityStates> | null = null;
  let cachedRenderStatesFrame = -1;
  const getCachedRenderStates = () => {
    if (cachedRenderStatesFrame !== currentLogicFrame) {
      cachedRenderStates = gameLogic.getRenderableEntityStates();
      cachedRenderStatesFrame = currentLogicFrame;
    }
    return cachedRenderStates!;
  };

  // Control harness for automated play-testing via browser console.
  const localPlayerId = networkManager.getLocalPlayerID();
  (window as unknown as Record<string, unknown>).__harness = createControlHarness(
    gameLogic,
    rtsCamera,
    localPlayerId,
  );

  gameLoop.start({
    onSimulationStep(_frameNumber: number, dt: number) {
      currentLogicFrame = _frameNumber + 1;
      replayRecordFrame = _frameNumber;
      replayManager.recordFrame(_frameNumber);
      const inputState = inputManager.getState();
      const scriptInputDisabled = gameLogic.isScriptInputDisabled();
      missionInputLocked = scriptInputDisabled || gameEnded;
      const replayPlaybackActive = replayContext !== undefined;
      const gameplayInputLocked = missionInputLocked || replayPlaybackActive;
      let inputStateForGameLogic: InputState = applyScriptInputLock(
        inputState,
        missionInputLocked,
      );
      camera.getWorldDirection(cameraForward);
      cameraUp.copy(camera.up).normalize();
      audioManager.setLocalPlayerIndex(networkManager.getLocalPlayerID());
      syncPlayerSidesFromNetwork(networkManager, gameLogic);
      audioManager.setListenerPosition([
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ]);
      audioManager.setListenerOrientation(
        [cameraForward.x, cameraForward.y, cameraForward.z],
        [cameraUp.x, cameraUp.y, cameraUp.z],
      );
      // Source parity: GameAudio::update — compute zoom-based 3D volume from
      // camera-to-listener distance for a more immersive 3D audio experience.
      audioManager.updateZoomVolume(
        camera.position.x,
        camera.position.y,
        camera.position.z,
      );
      scriptAudioRuntimeBridge.syncBeforeSimulationStep();

      const pendingControlBarCommand = uiRuntime.getPendingControlBarCommand();
      if (gameplayInputLocked && pendingControlBarCommand) {
        uiRuntime.cancelPendingControlBarCommand();
      }
      if (!gameplayInputLocked && pendingControlBarCommand && inputState.rightMouseClick) {
        inputStateForGameLogic = {
          ...inputState,
          rightMouseClick: false,
        };

        if (pendingControlBarCommand.targetKind === 'position') {
          const worldTarget = gameLogic.resolveMoveTargetFromInput(inputState, camera);
          if (worldTarget) {
            uiRuntime.commitPendingControlBarTarget({
              kind: 'position',
              x: worldTarget.x,
              y: 0,
              z: worldTarget.z,
              angle: buildingGhostAngle,
            });
          } else {
            uiRuntime.showMessage('Select a valid ground target.');
          }
        } else if (pendingControlBarCommand.targetKind === 'object') {
          const targetObjectId = gameLogic.resolveObjectTargetFromInput(inputState, camera);
          if (targetObjectId !== null) {
            const localPlayerIndex = networkManager.getLocalPlayerID();
            let isValidTarget = false;
            if (
              pendingControlBarCommand.commandType
              === GUICommandType.GUI_COMMAND_SPECIAL_POWER_FROM_COMMAND_CENTER
            ) {
              const commandCenterEntityId = gameLogic.resolveCommandCenterEntityId(localPlayerIndex);
              if (commandCenterEntityId !== null) {
                isValidTarget = isObjectTargetRelationshipAllowed(
                  pendingControlBarCommand.commandOption,
                  gameLogic.getEntityRelationship(commandCenterEntityId, targetObjectId),
                );
              }
            } else {
              const selectedObjectIds = uiRuntime.getSelectionState().selectedObjectIds;
              const sourceObjectIds = selectedObjectIds.length > 0
                ? selectedObjectIds
                : (() => {
                    const selectedEntityId = gameLogic.getSelectedEntityId();
                    return selectedEntityId === null ? [] : [selectedEntityId];
                  })();
              isValidTarget = sourceObjectIds.length === 1
                ? isObjectTargetRelationshipAllowed(
                    pendingControlBarCommand.commandOption,
                    gameLogic.getEntityRelationship(sourceObjectIds[0]!, targetObjectId),
                  )
                : isObjectTargetAllowedForSelection(
                    pendingControlBarCommand.commandOption,
                    sourceObjectIds,
                    targetObjectId,
                    (sourceObjectId, objectTargetId) => gameLogic.getEntityRelationship(
                      sourceObjectId,
                      objectTargetId,
                    ),
                  );
            }
            if (!isValidTarget) {
              uiRuntime.showMessage('Target is not valid for this command.');
              playUiFeedbackAudio(iniDataRegistry, audioManager, 'invalid');
            } else {
              uiRuntime.commitPendingControlBarTarget({
                kind: 'object',
                objectId: targetObjectId,
              });
            }
          } else {
            uiRuntime.showMessage('Select a valid target object.');
          }
        } else {
          const contextTargetObjectId = gameLogic.resolveObjectTargetFromInput(inputState, camera);
          const contextWorldTarget = gameLogic.resolveMoveTargetFromInput(inputState, camera);
          if (contextTargetObjectId === null && !contextWorldTarget) {
            uiRuntime.showMessage('Select a valid command target.');
          } else {
            uiRuntime.commitPendingControlBarTarget({
              kind: 'context',
              payload: {
                targetObjectId: contextTargetObjectId,
                targetPosition: contextWorldTarget
                  ? [contextWorldTarget.x, 0, contextWorldTarget.z]
                  : null,
              },
            });
          }
        }
      }

      // Drag-select logic: track left mouse drag for box selection.
      if (!gameplayInputLocked) {
        if (inputState.leftMouseDown && !wasLeftMouseDown) {
          // Mouse just pressed — record start position.
          dragStartX = inputState.mouseX;
          dragStartY = inputState.mouseY;
          isDragSelecting = false;
        }

        if (inputState.leftMouseDown) {
          const dx = inputState.mouseX - dragStartX;
          const dy = inputState.mouseY - dragStartY;
          if (Math.abs(dx) > DRAG_SELECT_THRESHOLD || Math.abs(dy) > DRAG_SELECT_THRESHOLD) {
            isDragSelecting = true;
          }
          if (isDragSelecting) {
            const left = Math.min(dragStartX, inputState.mouseX);
            const top = Math.min(dragStartY, inputState.mouseY);
            const width = Math.abs(dx);
            const height = Math.abs(dy);
            selectionBox.style.display = 'block';
            selectionBox.style.left = `${left}px`;
            selectionBox.style.top = `${top}px`;
            selectionBox.style.width = `${width}px`;
            selectionBox.style.height = `${height}px`;
          }
        }

        if (!inputState.leftMouseDown && wasLeftMouseDown) {
          // Mouse just released.
          if (isDragSelecting) {
            performDragSelect(dragStartX, dragStartY, inputState.mouseX, inputState.mouseY);
            isDragSelecting = false;
          }
          selectionBox.style.display = 'none';
        }

        wasLeftMouseDown = inputState.leftMouseDown;
      } else {
        selectionBox.style.display = 'none';
        isDragSelecting = false;
        wasLeftMouseDown = false;
      }

      // Suppress normal click selection during drag-select.
      if (isDragSelecting) {
        inputStateForGameLogic = { ...inputStateForGameLogic, leftMouseClick: false };
      }

      if (!gameplayInputLocked) {
        updateBuildingGhost(inputState);
      } else {
        buildingGhostGroup.visible = false;
      }

      // Spawn move indicator and play voice on right-click command.
      if (!replayPlaybackActive && inputStateForGameLogic.rightMouseClick && gameLogic.getLocalPlayerSelectionIds().length > 0) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        const target = gameLogic.resolveMoveTargetFromInput(inputStateForGameLogic, camera);
        if (target) {
          const isAttackMode = inputState.keysDown.has('a');
          spawnMoveIndicator(target.x, target.z, isAttackMode);

          // Play voice for the command — attack voice if targeting enemy, move voice otherwise.
          const targetEntityId = gameLogic.resolveObjectTargetFromInput(inputStateForGameLogic, camera);
          const isAttackCommand = isAttackMode || (
            targetEntityId !== null &&
            gameLogic.getEntityRelationship(selIds[0]!, targetEntityId) === 'enemies'
          );
          voiceBridge.playGroupVoice(selIds, isAttackCommand ? 'attack' : 'move');
          // Notify music manager of combat.
          if (isAttackCommand) {
            musicManager.notifyCombat();
          }
        }
      }

      // Double-click to select all visible units of same type.
      // Source parity: C++ InGameUI double-click selects all on-screen units of same template.
      if (inputStateForGameLogic.leftMouseClick && !isDragSelecting && !gameplayInputLocked) {
        const now = performance.now();
        if (now - lastClickTime < DOUBLE_CLICK_MS) {
          const selIds = gameLogic.getLocalPlayerSelectionIds();
          if (selIds.length === 1) {
            const clickedState = getCachedRenderStates().find(e => e.id === selIds[0]);
            if (clickedState && clickedState.isOwnedByLocalPlayer) {
              const sameType = getCachedRenderStates().filter(e =>
                e.isOwnedByLocalPlayer
                && e.templateName === clickedState.templateName
                && e.category !== 'building',
              );
              if (sameType.length > 1) {
                gameLogic.submitCommand({
                  type: 'selectEntities',
                  entityIds: sameType.map(e => e.id),
                });
              }
            }
          }
          lastClickTime = 0; // Reset to prevent triple-click
        } else {
          lastClickTime = now;
        }
      }

      if (!replayPlaybackActive) {
        gameLogic.handlePointerInput(inputStateForGameLogic, camera);
      }

      // Detect selection changes and play select voice.
      const currentSelectionIds = gameLogic.getLocalPlayerSelectionIds();
      if (currentSelectionIds.length > 0) {
        const changed = currentSelectionIds.length !== previousSelectionSnapshot.length
          || currentSelectionIds.some((id, i) => previousSelectionSnapshot[i] !== id);
        if (changed) {
          voiceBridge.playGroupVoice(currentSelectionIds, 'select');
          playUiFeedbackAudio(iniDataRegistry, audioManager, 'select');
        }
      }
      previousSelectionSnapshot = currentSelectionIds;

      if (!gameplayInputLocked) {
        dispatchIssuedControlBarCommands(
          uiRuntime.consumeIssuedCommands(),
          iniDataRegistry,
          gameLogic,
          uiRuntime,
          audioManager,
          networkManager.getLocalPlayerID(),
        );
      } else {
        uiRuntime.consumeIssuedCommands();
      }

      // ----------------------------------------------------------------
      // Keyboard shortcuts (one-shot key presses)
      // ----------------------------------------------------------------

      // Space — center camera on selected unit(s).
      if (!gameplayInputLocked && inputState.keysPressed.has(' ')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        if (selIds.length > 0) {
          let cx = 0;
          let cz = 0;
          let count = 0;
          for (const id of selIds) {
            const pos = gameLogic.getEntityWorldPosition(id);
            if (pos) {
              cx += pos[0];
              cz += pos[2];
              count++;
            }
          }
          if (count > 0) {
            rtsCamera.panTo(cx / count, cz / count);
          }
        }
      }

      // S — stop all selected units (only on one-shot press with active selection).
      if (!gameplayInputLocked && inputState.keysPressed.has('s')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        if (selIds.length > 0) {
          for (const id of selIds) {
            gameLogic.submitCommand({ type: 'stop', entityId: id, commandSource: 'PLAYER' });
          }
        }
      }

      // Delete — sell selected building.
      if (!gameplayInputLocked && inputState.keysPressed.has('delete')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        for (const id of selIds) {
          gameLogic.submitCommand({ type: 'sell', entityId: id });
        }
      }

      // G — guard position (selected units hold position and defend area).
      if (!gameplayInputLocked && inputState.keysPressed.has('g')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        for (const id of selIds) {
          const pos = gameLogic.getEntityWorldPosition(id);
          if (pos) {
            gameLogic.submitCommand({
              type: 'guardPosition',
              entityId: id,
              targetX: pos[0],
              targetZ: pos[2],
              guardMode: 1, // GUARDMODE_GUARD_WITHOUT_PURSUIT
            });
          }
        }
      }

      // Home — center camera on player's Command Center.
      // Source parity: C++ InGameUI Home key snaps to the player's primary base.
      if (inputState.keysPressed.has('home')) {
        const ccId = gameLogic.resolveCommandCenterEntityId(
          networkManager.getLocalPlayerID(),
        );
        if (ccId !== null) {
          const pos = gameLogic.getEntityWorldPosition(ccId);
          if (pos) {
            rtsCamera.panTo(pos[0], pos[2]);
          }
        }
      }

      // X — scatter selected units in random directions.
      // Source parity: C++ InGameUI scatter moves each unit 30-60 units in a random direction.
      if (!missionInputLocked && inputState.keysPressed.has('x')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        for (const id of selIds) {
          const pos = gameLogic.getEntityWorldPosition(id);
          if (pos) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 30 + Math.random() * 30;
            gameLogic.submitCommand({
              type: 'moveTo',
              entityId: id,
              targetX: pos[0] + Math.cos(angle) * dist,
              targetZ: pos[2] + Math.sin(angle) * dist,
              commandSource: 'PLAYER',
            });
          }
        }
      }

      // F9 — toggle diplomacy overlay.
      if (inputState.keysPressed.has('f9') && !gameEnded) {
        diplomacyScreen.toggle();
      }

      // Escape — close overlays, cancel pending command, deselect, or open options.
      // Source parity: cascading priority matches C++ InGameUI::processEscape.
      if (!gameplayInputLocked && inputState.keysPressed.has('escape')) {
        if (helpVisible) {
          hideHelp();
        } else if (generalsPowersPanel.isVisible) {
          generalsPowersPanel.hide();
        } else if (diplomacyScreen.isVisible) {
          diplomacyScreen.hide();
        } else if (ingameOptionsScreen.isVisible) {
          ingameOptionsScreen.hide();
        } else if (uiRuntime.getPendingControlBarCommand()) {
          uiRuntime.cancelPendingControlBarCommand();
        } else if (gameLogic.getLocalPlayerSelectionIds().length > 0) {
          gameLogic.submitCommand({ type: 'clearSelection' });
        } else if (!gameEnded) {
          ingameOptionsScreen.show();
        }
      }

      // Tab — cycle through idle production structures and dozers.
      // Source parity: C++ InGameUI::selectNextIdleWorker / selectNextIdleFactory.
      if (!gameplayInputLocked && inputState.keysPressed.has('tab')) {
        const allStates = getCachedRenderStates();
        const localSide = gameLogic.getPlayerSide(networkManager.getLocalPlayerID());
        const idle = allStates.filter(e =>
          e.isOwnedByLocalPlayer
          && e.side?.toLowerCase() === localSide?.toLowerCase()
          && (e.templateName.includes('Dozer') || e.templateName.includes('CommandCenter')
            || e.templateName.includes('Barracks') || e.templateName.includes('WarFactory')
            || e.templateName.includes('ArmsDealer') || e.templateName.includes('AirField')),
        );
        if (idle.length > 0) {
          // Cycle by entity ID (robust to entity creation/destruction between presses).
          idle.sort((a, b) => a.id - b.id);
          let nextIdx = idle.findIndex(e => e.id > lastTabEntityId);
          if (nextIdx < 0) nextIdx = 0; // wrap around
          const target = idle[nextIdx]!;
          lastTabEntityId = target.id;
          gameLogic.submitCommand({ type: 'clearSelection' });
          gameLogic.submitCommand({ type: 'select', entityId: target.id });
          rtsCamera.panTo(target.x, target.z);
        }
      }

      // Ctrl+A / Cmd+A — select all own combat units on screen.
      if (!gameplayInputLocked && inputState.keysPressed.has('a')
        && (inputState.keysDown.has('control') || inputState.keysDown.has('meta'))) {
        const allStates = getCachedRenderStates();
        const ownUnits = allStates.filter(e =>
          e.isOwnedByLocalPlayer && e.category !== 'building' && e.category !== 'unknown',
        );
        if (ownUnits.length > 0) {
          gameLogic.submitCommand({
            type: 'selectEntities',
            entityIds: ownUnits.map(u => u.id),
          });
        }
      }

      // Feed input to camera
      rtsCamera.setInputState(inputStateForGameLogic);

      if (replayContext) {
        for (const replayCommand of replayManager.advanceFrame()) {
          gameLogic.submitCommand(replayCommand.command as unknown as ReplayRecordableCommand);
        }
      }

      // Update all subsystems (InputManager resets accumulators,
      // RTSCamera processes input, WaterVisual animates UVs)
      subsystems.updateAll(dt);
      gameSubsystems.updateAll(dt);
      scriptCameraRuntimeBridge.syncAfterSimulationStep(_frameNumber + 1);
      scriptCameraMovementFinished = scriptCameraRuntimeBridge.isCameraMovementFinished();
      scriptCameraTimeFrozen = scriptCameraRuntimeBridge.isCameraTimeFrozen();
      scriptCameraTimeMultiplier = scriptCameraRuntimeBridge.getCameraTimeMultiplier();
      scriptAudioRuntimeBridge.syncAfterSimulationStep();
      scriptObjectAmbientAudioRuntimeBridge.syncAfterSimulationStep();
      scriptMessageRuntimeBridge.syncAfterSimulationStep();
      scriptEvaRuntimeBridge.syncAfterSimulationStep();
      scriptUiEffectsRuntimeBridge.syncAfterSimulationStep(_frameNumber + 1);
      scriptEmoticonRuntimeBridge.syncAfterSimulationStep(_frameNumber + 1);
      scriptCameraEffectsState = scriptCameraEffectsRuntimeBridge.syncAfterSimulationStep(_frameNumber + 1);
      scriptCinematicRuntimeBridge.syncAfterSimulationStep(_frameNumber + 1);

      // Move sun light to follow camera target for consistent shadows.
      const camState = rtsCamera.getState();
      sunLight.position.set(camState.targetX + 200, 400, camState.targetZ + 200);
      sunLight.target.position.set(camState.targetX, 0, camState.targetZ);
      sunLight.target.updateMatrixWorld();

      syncScriptViewRuntimeBridge(gameLogic, objectVisualManager, terrainVisual, scriptSkyboxController);
      objectVisualManager.setCameraPosition(camState.targetX, camState.targetZ);
      scriptSkyboxController.update(camera);
      objectVisualManager.sync(getCachedRenderStates(), dt);

      // Process visual events (explosions, muzzle flashes, etc.) and update particles.
      processVisualEvents();
      gameLODManager.update(dt);
      particleSystemManager.update(dt);
      laserBeamRenderer.update();
      dynamicLightManager.update();
      tracerRenderer.update();
      debrisRenderer.update();
      decalManager.update(dt);
      musicManager.update();

      // Update fog of war overlay (internally throttled).
      const localSideForFog = gameLogic.getPlayerSide(networkManager.getLocalPlayerID());
      shroudRenderer.update(localSideForFog ? gameLogic.getFogOfWarTextureData(localSideForFog) : null);

      // Update cursor state
      if (cursorManager.isReady) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        const hasSelection = selIds.length > 0;
        const edgeScrollDir = inputState.pointerInCanvas
          ? detectEdgeScrollDir(
              inputState.mouseX, inputState.mouseY,
              inputState.viewportWidth, inputState.viewportHeight,
              20,
            )
          : null;
        let hoverTarget: 'none' | 'own-unit' | 'enemy' | 'ground' | 'garrisonable' | 'repair' = 'none';
        // Throttle hover raycast to every 3 frames — raycasting against
        // all scene meshes is expensive and cursor hover tolerates latency.
        if (inputState.pointerInCanvas && (currentLogicFrame % 3 === 0)) {
          const hoverObjectId = gameLogic.resolveObjectTargetFromInput(inputState, camera);
          if (hoverObjectId !== null) {
            const firstSelectedId = selIds[0] ?? null;
            if (firstSelectedId !== null) {
              const rel = gameLogic.getEntityRelationship(firstSelectedId, hoverObjectId);
              hoverTarget = rel === 'enemies' ? 'enemy' : 'own-unit';
            } else {
              hoverTarget = 'own-unit';
            }
          } else {
            hoverTarget = 'ground';
          }

          // Source parity: InGameUI — dozer hovering over a damaged friendly building
          // shows repair cursor context. Check if any selected entity is a dozer and the
          // hovered object is a friendly building with health < maxHealth.
          let isRepairHover = false;
          if (hoverObjectId !== null && hoverTarget === 'own-unit' && selIds.length > 0) {
            const hoverRenderState = getCachedRenderStates().find(e => e.id === hoverObjectId);
            if (hoverRenderState
              && hoverRenderState.category === 'building'
              && hoverRenderState.maxHealth > 0
              && hoverRenderState.health < hoverRenderState.maxHealth) {
              const selectedInfos = gameLogic.getSelectedEntityInfos(selIds);
              if (selectedInfos.some(info => info.isDozer)) {
                hoverTarget = 'repair';
                isRepairHover = true;
              }
            }
          }

          // Update hover tooltip content.
          if (hoverObjectId !== null) {
            const hoverState = gameLogic.getEntityState(hoverObjectId);
            if (hoverState) {
              // Clean template name: remove faction prefix (e.g. "AmericaTankCrusader" -> "Tank Crusader")
              const displayName = formatTemplateName(hoverState.templateName);
              hoverTooltipName.textContent = isRepairHover
                ? `${displayName} — Click to repair`
                : displayName;

              // Health bar.
              const healthPct = hoverState.maxHealth > 0 ? hoverState.health / hoverState.maxHealth : 0;
              hoverTooltipHealthFill.style.width = `${Math.round(healthPct * 100)}%`;
              hoverTooltipHealthFill.style.background = healthPct > 0.6 ? '#44cc44'
                : healthPct > 0.3 ? '#cccc44' : '#cc4444';

              // Side / faction.
              hoverTooltipSide.textContent = hoverState.side || '';

              hoverTooltip.style.display = 'block';
              hoverTooltip.style.left = `${inputState.mouseX + 20}px`;
              hoverTooltip.style.top = `${inputState.mouseY + 20}px`;
              lastHoverObjectId = hoverObjectId;
            } else {
              hoverTooltip.style.display = 'none';
              lastHoverObjectId = null;
            }
          } else {
            hoverTooltip.style.display = 'none';
            lastHoverObjectId = null;
          }
        }

        // Keep tooltip position updated every frame (even when raycast is throttled).
        if (lastHoverObjectId !== null && hoverTooltip.style.display !== 'none') {
          hoverTooltip.style.left = `${inputState.mouseX + 20}px`;
          hoverTooltip.style.top = `${inputState.mouseY + 20}px`;
        }

        // Hide tooltip when pointer leaves canvas.
        if (!inputState.pointerInCanvas) {
          hoverTooltip.style.display = 'none';
          lastHoverObjectId = null;
        }

        const pendingAbility = uiRuntime.getPendingControlBarCommand() !== null;
        const isAttackMode = inputState.keysDown.has('a');
        const cursorName = resolveGameCursor({ hasSelection, hoverTarget, edgeScrollDir, pendingAbility, isAttackMode });
        cursorManager.setCursor(cursorName);
        cursorManager.update(dt);
      }
    },

    onRender(_alpha: number) {
      const cameraFilterParts: string[] = [];
      if (scriptCameraEffectsState.grayscale > 0.001) {
        cameraFilterParts.push(`grayscale(${Math.round(scriptCameraEffectsState.grayscale * 100)}%)`);
      }
      if (Math.abs(scriptCameraEffectsState.saturation - 1) > 0.001) {
        cameraFilterParts.push(`saturate(${scriptCameraEffectsState.saturation.toFixed(2)})`);
      }
      if (scriptCameraEffectsState.blurPixels > 0.001) {
        cameraFilterParts.push(`blur(${scriptCameraEffectsState.blurPixels.toFixed(2)}px)`);
      }
      canvas.style.filter = cameraFilterParts.length > 0
        ? cameraFilterParts.join(' ')
        : 'none';

      if (
        Math.abs(scriptCameraEffectsState.shakeOffsetX) > 0.001
        || Math.abs(scriptCameraEffectsState.shakeOffsetY) > 0.001
      ) {
        canvas.style.transform =
          `translate(${scriptCameraEffectsState.shakeOffsetX.toFixed(2)}px, ${scriptCameraEffectsState.shakeOffsetY.toFixed(2)}px)`;
      } else {
        canvas.style.transform = 'none';
      }

      if (scriptCameraEffectsState.fadeAmount > 0.001) {
        scriptCameraFadeOverlay.style.display = 'block';
        scriptCameraFadeOverlay.style.opacity = scriptCameraEffectsState.fadeAmount.toFixed(3);
        switch (scriptCameraEffectsState.fadeType) {
          case 'ADD':
            scriptCameraFadeOverlay.style.background = '#ffffff';
            scriptCameraFadeOverlay.style.mixBlendMode = 'screen';
            break;
          case 'SATURATE':
            scriptCameraFadeOverlay.style.background = '#ffffff';
            scriptCameraFadeOverlay.style.mixBlendMode = 'saturation';
            break;
          case 'SUBTRACT':
            scriptCameraFadeOverlay.style.background = '#000000';
            scriptCameraFadeOverlay.style.mixBlendMode = 'multiply';
            break;
          case 'MULTIPLY':
          default:
            scriptCameraFadeOverlay.style.background = '#000000';
            scriptCameraFadeOverlay.style.mixBlendMode = 'multiply';
            break;
        }
      } else {
        scriptCameraFadeOverlay.style.display = 'none';
        scriptCameraFadeOverlay.style.opacity = '0';
      }

      renderer.render(scene, camera);
      const radarVisible = resolveScriptRadarVisibility(
        gameLogic.isScriptRadarHidden(),
        gameLogic.isScriptRadarForced(),
      );
      const radarInteractionAllowed = resolveScriptRadarInteractionEnabled(
        radarVisible,
        missionInputLocked,
      );
      const radarEntityBlipsVisible = resolveScriptRadarEntityBlipVisibility(
        radarVisible,
        gameLogic.isScriptDrawIconUIEnabled(),
      );
      radarInteractionEnabled = radarInteractionAllowed;
      minimapCanvas.style.display = radarVisible ? 'block' : 'none';
      minimapCanvas.style.pointerEvents = radarInteractionAllowed ? 'auto' : 'none';
      if (radarVisible && (currentLogicFrame % 3 === 0)) {
        updateMinimap(radarEntityBlipsVisible);
      }
      updateProductionPanel();
      // Show production progress and queue counts on command card buttons
      {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        if (selIds.length === 1) {
          const prodState = gameLogic.getProductionState(selIds[0]!);
          if (prodState && prodState.queue.length > 0) {
            const entry = prodState.queue[0]!;
            commandCardRenderer.setOverlayData(1, {
              productionProgress: entry.percentComplete / 100,
              queueCount: prodState.queueEntryCount,
            });
          } else {
            commandCardRenderer.setOverlayData(1, null);
          }
        } else {
          commandCardRenderer.setOverlayData(1, null);
        }
      }
      commandCardRenderer.sync();
      updateRallyPointVisual();
      updateWaypointPathVisual();
      updateMoveIndicators();
      updateProjectileVisuals();
      updateEntityInfoPanel();
      updateScriptEmoticonOverlay(currentLogicFrame);

      // FPS counter
      frameCount++;
      const now = performance.now();
      if (now - lastFpsUpdate > 1000) {
        displayFps = frameCount;
        frameCount = 0;
        lastFpsUpdate = now;
      }

      const hm = terrainVisual.getHeightmap();
      const mapInfo = hm
        ? `${hm.width}x${hm.height}`
        : 'none';
      const wireInfo = terrainVisual.isWireframe() ? ' [wireframe]' : '';
      const selectedEntityIdList = gameLogic.getLocalPlayerSelectionIds();
      const selectedInfo = selectedEntityIdList.length > 0
        ? gameLogic.getSelectedEntityInfoById(selectedEntityIdList[0] ?? null)
        : gameLogic.getSelectedEntityInfo();
      const selectedEntities = selectedEntityIdList.length > 0
        ? gameLogic.getSelectedEntityInfos(selectedEntityIdList)
        : selectedInfo
          ? [selectedInfo]
          : [];
      const selectedEntityId = selectedEntities[0]?.id ?? null;
      const selectedEntityIds = selectedEntities.map((selection) => selection.id);
      const selectedEntityIdSet = new Set(selectedEntityIds);

      const playerUpgradeNames = gameLogic.getLocalPlayerUpgradeNames();
      const playerScienceNames = gameLogic.getLocalPlayerScienceNames();
      const playerSciencePurchasePoints = gameLogic.getLocalPlayerSciencePurchasePoints();
      const disabledScienceNames = gameLogic.getLocalPlayerDisabledScienceNames();
      const hiddenScienceNames = gameLogic.getLocalPlayerHiddenScienceNames();
      const controlBarButtons = buildControlBarButtonsForSelections(
        iniDataRegistry,
        selectedEntities.map((selection) => {
          const productionState = gameLogic.getProductionState(selection.id);
          return {
            entityId: selection.id,
            templateName: selection.templateName,
            canMove: selection.canMove,
            hasAutoRallyPoint: selection.hasAutoRallyPoint,
            isUnmanned: selection.isUnmanned,
            isDozer: selection.isDozer,
            isMoving: selection.isMoving,
            objectStatusFlags: selection.objectStatusFlags,
            productionQueueEntryCount: productionState?.queueEntryCount,
            productionQueueMaxEntries: productionState?.maxQueueEntries,
            appliedUpgradeNames: selection.appliedUpgradeNames,
          };
        }),
        {
          playerUpgradeNames,
          playerScienceNames,
          playerSciencePurchasePoints,
          disabledScienceNames,
          hiddenScienceNames,
          logicFrame: currentLogicFrame,
          resolveSpecialPowerReadyFrame: (specialPowerName, sourceEntityId) => (
            gameLogic.resolveShortcutSpecialPowerReadyFrameForSourceEntity(
              specialPowerName,
              sourceEntityId,
            )
          ),
        },
      );

      const currentShortcutSpecialPowerReadyFrames = collectShortcutSpecialPowerReadyFrames(
        controlBarButtons,
        iniDataRegistry,
      );

      if (selectedEntityIds.length > 0) {
        for (const previousEntityId of trackedShortcutSpecialPowerSourceEntityIds) {
          if (!selectedEntityIdSet.has(previousEntityId)) {
            gameLogic.clearTrackedShortcutSpecialPowerSourceEntity(previousEntityId);
            trackedShortcutSpecialPowerSourceEntityIds.delete(previousEntityId);
          }
        }

        // Source behavior from Player::findMostReadyShortcutSpecialPowerOfType:
        // candidate source objects are tracked per special power and resolved by
        // lowest ready frame.
        for (const sourceEntityId of selectedEntityIds) {
          gameLogic.clearTrackedShortcutSpecialPowerSourceEntity(sourceEntityId);
          for (const [specialPowerName, readyFrame] of currentShortcutSpecialPowerReadyFrames) {
            const liveReadyFrame = gameLogic.resolveShortcutSpecialPowerReadyFrameForSourceEntity(
              specialPowerName,
              sourceEntityId,
            );
            gameLogic.trackShortcutSpecialPowerSourceEntity(
              specialPowerName,
              sourceEntityId,
              liveReadyFrame ?? readyFrame,
            );
          }
          trackedShortcutSpecialPowerSourceEntityIds.add(sourceEntityId);
        }
      } else {
        for (const previousEntityId of trackedShortcutSpecialPowerSourceEntityIds) {
          gameLogic.clearTrackedShortcutSpecialPowerSourceEntity(previousEntityId);
        }
        trackedShortcutSpecialPowerSourceEntityIds.clear();
      }

      uiRuntime.setSelectionState({
        selectedObjectIds: selectedEntities.map((selection) => selection.id),
        selectedObjectName: selectedEntityId === null
          ? selectedInfo?.templateName ?? ''
          : selectedEntities[0]?.templateName ?? '',
      });
      uiRuntime.setControlBarButtons(controlBarButtons);

      // Update credits HUD with animated counter
      const localPlayerId = networkManager.getLocalPlayerID();
      const localPlayerSide = gameLogic.getPlayerSide(localPlayerId);
      if (localPlayerSide) {
        const credits = gameLogic.getSideCredits(localPlayerSide);
        // Source parity: C++ ControlBar credit counter ticks toward target value.
        if (displayedCredits !== credits) {
          const diff = credits - displayedCredits;
          const step = Math.max(1, Math.abs(Math.floor(diff * 0.2)));
          if (Math.abs(diff) <= step) {
            displayedCredits = credits;
          } else {
            displayedCredits += diff > 0 ? step : -step;
          }
          creditsHud.textContent = `$${displayedCredits.toLocaleString()}`;
          // Flash color on credit change
          creditsHud.style.color = diff > 0 ? '#44ff44' : '#ff4444';
        } else {
          creditsHud.style.color = '#d4af37';
        }

        // Update power HUD (graphical bar)
        const powerState = gameLogic.getSidePowerState(localPlayerSide);
        const totalProd = powerState.energyProduction + powerState.powerBonus;
        const surplus = totalProd - powerState.energyConsumption;
        if (totalProd > 0 || powerState.energyConsumption > 0) {
          powerHud.style.display = 'block';
          const pct = totalProd > 0 ? Math.min(100, (powerState.energyConsumption / totalProd) * 100) : 100;
          const bar = document.getElementById('power-bar-fill')!;
          bar.style.width = `${pct}%`;
          bar.style.background = surplus >= 0 ? '#44aa44' : '#cc3333';
          document.getElementById('power-bar-label')!.textContent = `\u26A1 ${totalProd}/${powerState.energyConsumption}`;
        } else {
          powerHud.style.display = 'none';
        }

        // Update rank HUD
        const rankLevel = gameLogic.getLocalPlayerRankLevel();
        const purchasePoints = gameLogic.getLocalPlayerSciencePurchasePoints();
        const skillPoints = gameLogic.getLocalPlayerSkillPoints();
        const nextThreshold = gameLogic.getLocalPlayerNextRankThreshold();
        const rankStars = '\u2605'.repeat(Math.min(rankLevel, 5));
        rankHud.style.display = 'block';
        rankHud.textContent = `${rankStars} Rank ${rankLevel} | XP: ${skillPoints}/${nextThreshold} | GP: ${purchasePoints}`;
      }

      // Update game clock HUD (MM:SS from logic frames at 30fps)
      const elapsedSec = Math.floor(currentLogicFrame / 30);
      const clockMin = Math.floor(elapsedSec / 60);
      const clockSec = elapsedSec % 60;
      clockHud.textContent = `${clockMin.toString().padStart(2, '0')}:${clockSec.toString().padStart(2, '0')}`;

      // Update superweapon countdown timers with progress bars.
      const superweapons = gameLogic.getSourceInGameUiSuperweaponStates();
      if (superweapons.length > 0) {
        const normalizedLocal = localPlayerSide?.toUpperCase() ?? '';
        const superweaponDisplayEnabled = gameLogic.isScriptSpecialPowerDisplayEnabled();
        const activeKeys = new Set<string>();
        let childIdx = 0;
        for (const superweapon of superweapons) {
          const superweaponKey = createRuntimeSaveInGameUiSuperweaponKey({
            playerIndex: superweapon.playerIndex,
            objectId: superweapon.objectId,
            powerName: superweapon.powerName,
          });
          activeKeys.add(superweaponKey);

          const priorTrackedState = trackedInGameUiSuperweaponStateByKey.get(superweaponKey);
          if (
            !superweapon.underConstruction
            && !superweapon.hiddenByScript
            && !superweapon.hiddenByScience
          ) {
            let evaReadyPlayed = priorTrackedState?.evaReadyPlayed ?? false;
            if (superweapon.isReady && !evaReadyPlayed) {
              if (superweapon.currentFrame > 0) {
                evaReadyPlayed = true;
              }
            } else if (!superweapon.isReady) {
              evaReadyPlayed = false;
            }
            const timestamp = superweapon.readyFrame < superweapon.currentFrame
              ? 0
              : Math.max(0, Math.trunc((superweapon.readyFrame - superweapon.currentFrame) / 30));
            trackedInGameUiSuperweaponStateByKey.set(superweaponKey, {
              timestamp,
              evaReadyPlayed,
            });
          }

          if (
            !superweaponDisplayEnabled
            || superweapon.hiddenByScript
            || superweapon.hiddenByScience
            || superweapon.underConstruction
          ) {
            continue;
          }

          const isPlayer = superweapon.side.toUpperCase() === normalizedLocal;
          const prefix = isPlayer ? '\u2622' : '\u26A0'; // ☢ for player, ⚠ for enemy
          const color = isPlayer ? '#ff6644' : '#ffaa22';
          let label: string;
          let progressPct = 100;

          if (superweapon.isReady) {
            label = `${prefix} ${superweapon.powerName}: READY`;
            progressPct = 100;
            superweaponStartFrames.delete(superweaponKey);
          } else if (superweapon.readyFrame > 0) {
            // Track start frame for percentage calculation.
            if (!superweaponStartFrames.has(superweaponKey)) {
              superweaponStartFrames.set(superweaponKey, superweapon.currentFrame);
            }
            const startFrame = superweaponStartFrames.get(superweaponKey)!;
            const totalFrames = superweapon.readyFrame - startFrame;
            const elapsed = superweapon.currentFrame - startFrame;
            progressPct = totalFrames > 0 ? Math.min(100, (elapsed / totalFrames) * 100) : 0;

            const remainingFrames = superweapon.readyFrame - superweapon.currentFrame;
            const remainingSec = Math.max(0, Math.ceil(remainingFrames / 30));
            const min = Math.floor(remainingSec / 60);
            const sec = remainingSec % 60;
            label = `${prefix} ${superweapon.powerName}: ${min}:${sec.toString().padStart(2, '0')}`;
          } else {
            continue;
          }

          // Reuse or create a child bar element.
          let bar = superweaponHud.children[childIdx] as HTMLDivElement | undefined;
          if (!bar) {
            bar = document.createElement('div');
            Object.assign(bar.style, {
              position: 'relative',
              padding: '2px 8px',
              borderRadius: '3px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            });
            superweaponHud.appendChild(bar);
          }

          // Background progress fill.
          let fill = bar.firstElementChild as HTMLDivElement | null;
          if (!fill) {
            fill = document.createElement('div');
            Object.assign(fill.style, {
              position: 'absolute',
              top: '0',
              left: '0',
              height: '100%',
              borderRadius: '3px',
              transition: 'width 0.3s linear',
              pointerEvents: 'none',
            });
            bar.insertBefore(fill, bar.firstChild);
          }
          fill.style.width = `${progressPct}%`;
          fill.style.background = `linear-gradient(90deg, transparent, ${color}44)`;

          // Text span overlay.
          let span = bar.lastElementChild as HTMLSpanElement | null;
          if (!span || span === fill) {
            span = document.createElement('span');
            span.style.position = 'relative';
            bar.appendChild(span);
          }
          span.textContent = label;
          span.style.color = color;

          childIdx++;
        }

        // Remove stale start-frame entries.
        for (const key of superweaponStartFrames.keys()) {
          if (!activeKeys.has(key)) superweaponStartFrames.delete(key);
        }

        // Remove excess child elements.
        while (superweaponHud.children.length > childIdx) {
          superweaponHud.removeChild(superweaponHud.lastChild!);
        }

        for (const key of trackedInGameUiSuperweaponStateByKey.keys()) {
          if (!activeKeys.has(key)) {
            trackedInGameUiSuperweaponStateByKey.delete(key);
          }
        }

        superweaponHud.style.display = childIdx > 0 ? 'flex' : 'none';
      } else {
        superweaponHud.style.display = 'none';
        superweaponHud.innerHTML = '';
        superweaponStartFrames.clear();
        trackedInGameUiSuperweaponStateByKey.clear();
      }

      // Check for game end
      if (!gameEnded) {
        const endState = gameLogic.getGameEndState();
        if (endState) {
          gameEnded = true;
          void persistRecordedReplay();

          // Campaign mode: handle mission transitions
          if (campaignContext && endState.status === 'VICTORY') {
            const cm = campaignContext.campaignManager;
            const vp = campaignContext.videoPlayer;
            cm.victorious = true;

            // Advance to next mission
            const nextMission = cm.gotoNextMission();
            if (nextMission) {
              // Play transition movie if available, then load next mission
              const movieName = nextMission.movieLabel;
              const playMovie = movieName && vp
                ? vp.playFullscreen(movieName)
                : Promise.resolve();
              playMovie.then(() => {
                const nextMapPath = cm.resolveMapAssetPath(nextMission);
                if (nextMapPath) {
                  // Reload with the next mission map
                  disposeGame();
                  void startGame(ctx, nextMapPath, null, {
                    ...campaignContext,
                    settings: {
                      ...campaignContext.settings,
                      mapPath: nextMapPath,
                      mission: nextMission,
                    },
                  });
                } else {
                  campaignContext.onReturnToShell();
                }
              });
              return; // Skip postgame screen for mid-campaign victory
            } else {
              // Campaign complete — play final movie then show postgame
              const currentCampaign = cm.getCurrentCampaign();
              const finalMovie = currentCampaign?.finalMovieName;
              const liveFinalMovie = currentCampaign && finalMovie
                ? isLiveCampaignLifecycle(
                    classifyCampaignReference({
                      campaignName: currentCampaign.name,
                      assetKind: 'finalVictoryMovie',
                      assetName: finalMovie,
                    }).lifecycle,
                  )
                : false;
              if (finalMovie && liveFinalMovie && vp) {
                vp.playFullscreen(finalMovie).then(() => {
                  campaignContext.onReturnToShell();
                });
                return;
              }
            }
          }

          const localSide = gameLogic.getPlayerSide(0);
          const allSides = gameLogic.getActiveSideNames();
          const sideScores: SideScoreDisplay[] = allSides.map(side => {
            const score = gameLogic.getSideScoreState(side);
            return {
              side,
              faction: sideToFactionLabel(resolveResolvedFactionSide(side, gameLogic)),
              isVictor: endState.victorSides.includes(side),
              isLocal: side === localSide,
              ...score,
            };
          });
          // Play victory/defeat music stinger. Source parity: MusicManager plays
          // faction-specific end-of-match stinger in the retail game.
          const localFaction = sideToFactionLabel(resolveResolvedFactionSide(localSide ?? 'America', gameLogic));
          if (endState.status === 'VICTORY') {
            musicManager.playVictory(localFaction);
          } else {
            musicManager.playDefeat(localFaction);
          }

          postgameScreen.show(endState.status as 'VICTORY' | 'DEFEAT', sideScores);
          if (uiRuntime.getPendingControlBarCommand()) {
            uiRuntime.cancelPendingControlBarCommand();
          }
          uiRuntime.consumeIssuedCommands();
        }
      }

      // Draw cursor overlay
      if (cursorManager.isReady) {
        const cursorInputState = inputManager.getState();
        cursorManager.draw(cursorInputState.mouseX, cursorInputState.mouseY);
      }

      const unresolvedCount = objectVisualManager.getUnresolvedEntityCount();
      const unresolvedVisualStatus = unresolvedCount > 0
        ? ` | Unresolved: ${unresolvedCount}`
        : '';
      debugInfo.textContent =
        `FPS: ${displayFps} | Map: ${mapInfo}${wireInfo}${dataSuffix}${objectStatus} | Sel: ` +
        `${selectedEntityId === null ? 'none' : `#${selectedEntityId}`} | Frame: ` +
        `${gameLoop.getFrameNumber()}${unresolvedVisualStatus}`;
    },
  });

  // AbortController so all window listeners are cleaned up on dispose
  const gameAbort = new AbortController();

  // Handle resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    uiRuntime.resize(window.innerWidth, window.innerHeight);
    updateSourceHudLayout();
  }, { signal: gameAbort.signal });

  const disposeGame = (): void => {
    gameAbort.abort();
    gameLoop.stop();
    commandCardRenderer.dispose();
    gameSubsystems.disposeAll();
    objectVisualManager.dispose();
    laserBeamRenderer.dispose();
    dynamicLightManager.dispose();
    tracerRenderer.dispose();
    debrisRenderer.dispose();
    terrainBridgeRenderer.dispose();
    terrainRoadRenderer.dispose();
    scriptSkyboxController.dispose();
    voiceBridge.dispose();
    musicManager.dispose();
    cursorManager.dispose();
    shroudRenderer.dispose();
    delete (globalThis as Record<string, unknown>)['__GENERALS_E2E__'];
  };

  const saveCurrentGame = async (slotId: string, description: string): Promise<void> => {
    const embeddedMapBytes = await resolveRuntimeSaveEmbeddedMapBytes(ctx.assets, activeMapPath, mapData);
    const activeCampaign = campaignContext?.campaignManager.getCurrentCampaign()
      ?? campaignContext?.settings.campaign
      ?? null;
    const activeMission = campaignContext?.campaignManager.getCurrentMission()
      ?? campaignContext?.settings.mission
      ?? null;
    const currentCameraState = rtsCamera.getState();
    const saveFile = buildRuntimeSaveFile({
      description,
      mapPath: activeMapPath,
      mapData,
      cameraState: currentCameraState,
      tacticalViewState: {
        version: 1,
        angle: currentCameraState.angle,
        position: {
          x: currentCameraState.targetX,
          y: heightmap.getInterpolatedHeight(currentCameraState.targetX, currentCameraState.targetZ),
          z: currentCameraState.targetZ,
        },
      },
      inGameUiState: buildRuntimeSaveInGameUiState({
        gameLogicState: gameLogic.captureSourceInGameUiRuntimeSaveState(),
        superweapons: gameLogic.getSourceInGameUiSuperweaponStates(),
        trackedSuperweapons: trackedInGameUiSuperweaponStateByKey,
        namedTimerLastFlashFrame,
        namedTimerUsedFlashColor,
      }),
      scriptEngineFadeState: scriptCameraEffectsRuntimeBridge.captureActiveFadeSaveState(),
      renderableEntityStates: gameLogic.getRenderableEntityStates(),
      gameClientState: runtimeSaveLoadContext?.runtimeSave.gameClientState ?? null,
      particleSystemState: particleSystemManager.captureSaveState(),
      currentMusicTrackName: musicManager.getCurrentTrackName(),
      gameLogic,
      embeddedMapBytes,
      sourceGameMode: skirmishSettings ? SOURCE_GAME_MODE_SKIRMISH : SOURCE_GAME_MODE_SINGLE_PLAYER,
      gameClientBriefingLines: scriptMessageRuntimeBridge.getBriefingHistory(),
      passthroughBlocks: runtimeSaveLoadContext?.runtimeSave.passthroughBlocks ?? [],
      campaign: activeCampaign && activeMission
        ? {
            version: runtimeSaveLoadContext?.runtimeSave.campaign?.version,
            campaignName: activeCampaign.name,
            missionName: activeMission.name,
            missionNumber: campaignContext?.campaignManager.getCurrentMissionNumber() ?? -1,
            difficulty: campaignContext?.campaignManager.difficulty ?? campaignContext!.settings.difficulty,
            rankPoints: 0,
            isChallengeCampaign: activeCampaign.isChallengeCampaign,
            playerTemplateNum:
              runtimeSaveLoadContext?.runtimeSave.campaign?.playerTemplateNum
              ?? campaignContext?.settings.playerTemplateNum
              ?? -1,
            sourceMapName: activeMission.mapName,
            playerDisplayName: activeCampaign.isChallengeCampaign
              ? resolveChallengePlayerDisplayName(
                  ctx.iniDataRegistry,
                  activeCampaign.name,
                  activeCampaign.playerFactionName,
                )
              : undefined,
            challengeGameInfoState:
              runtimeSaveLoadContext?.runtimeSave.campaign?.challengeGameInfoState
              ?? null,
          }
        : null,
      sourceDifficulty: campaignContext?.settings.difficulty ?? null,
    });
    await ctx.saveStorage.saveToDB(slotId, saveFile.data, saveFile.metadata);
  };

  const loadSavedGameData = async (data: ArrayBuffer): Promise<void> => {
    disposeGame();
    await startGameFromRuntimeSave(
      ctx,
      data,
      campaignContext
        ? {
            campaignManager: campaignContext.campaignManager,
            videoPlayer: campaignContext.videoPlayer,
            onReturnToShell: campaignContext.onReturnToShell,
          }
        : undefined,
    );
  };

  const loadSavedGameSlot = async (slotId: string): Promise<void> => {
    const loadedSave = await ctx.saveStorage.loadFromDB(slotId);
    if (!loadedSave) {
      throw new Error(`Save "${slotId}" was not found.`);
    }
    await loadSavedGameData(loadedSave.data);
  };

  window.addEventListener('pagehide', disposeGame, { signal: gameAbort.signal });
  window.addEventListener('beforeunload', disposeGame, { signal: gameAbort.signal });

  // Browser e2e hook: exposed for Playwright gameplay scenario tests.
  (globalThis as Record<string, unknown>)['__GENERALS_E2E__'] = {
    gameLogic,
    uiRuntime,
    executeScriptAction: (action: unknown): boolean =>
      gameLogic.executeScriptAction(action as Parameters<GameLogicSubsystem['executeScriptAction']>[0]),
    submitCommand: (command: unknown): void =>
      gameLogic.submitCommand(command as Parameters<GameLogicSubsystem['submitCommand']>[0]),
    getRenderableEntityStates: (): ReturnType<GameLogicSubsystem['getRenderableEntityStates']> =>
      getCachedRenderStates(),
    getGameEndState: (): ReturnType<GameLogicSubsystem['getGameEndState']> =>
      gameLogic.getGameEndState(),
    setScriptTeamMembers: (teamName: string, entityIds: readonly number[]): boolean =>
      gameLogic.setScriptTeamMembers(teamName, entityIds),
    setScriptTeamControllingSide: (teamName: string, side: string): boolean =>
      gameLogic.setScriptTeamControllingSide(teamName, side),
    getVisualDebugState: () => {
      const skyboxRoot = scene.getObjectByName('script-skybox');
      return {
        frame: gameLoop.getFrameNumber(),
        mapPath: activeMapPath,
        placementResolvedObjects: objectPlacement.resolvedObjects,
        placementSpawnedObjects: objectPlacement.spawnedObjects,
        placementTotalObjects: objectPlacement.totalObjects,
        placementUnresolvedObjects: objectPlacement.unresolvedObjects,
        renderableCount: getCachedRenderStates().length,
        sceneObjectCount: scene.children.length,
        debugInfoText: debugInfo.textContent ?? '',
        skyboxLoaded: skyboxRoot !== undefined,
        skyboxVisible: Boolean(skyboxRoot?.visible),
        cameraPosition: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        cameraQuaternion: {
          x: camera.quaternion.x,
          y: camera.quaternion.y,
          z: camera.quaternion.z,
          w: camera.quaternion.w,
        },
        rtsCameraState: rtsCamera.getState(),
        scriptCameraEffectsState,
        objectVisuals: objectVisualManager.getDebugSnapshot(),
      };
    },
    getSidePowerState: (side: string): ReturnType<GameLogicSubsystem['getSidePowerState']> =>
      gameLogic.getSidePowerState(side),
    buildControlBarButtonsForEntity: (entityId: number) => {
      if (!Number.isFinite(entityId)) {
        return [];
      }
      const normalizedEntityId = Math.trunc(entityId);
      const selection = gameLogic.getSelectedEntityInfoById(normalizedEntityId);
      if (!selection) {
        return [];
      }
      const productionState = gameLogic.getProductionState(normalizedEntityId);
      return buildControlBarButtonsForSelections(
        iniDataRegistry,
        [
          {
            entityId: selection.id,
            templateName: selection.templateName,
            canMove: selection.canMove,
            hasAutoRallyPoint: selection.hasAutoRallyPoint,
            isUnmanned: selection.isUnmanned,
            isDozer: selection.isDozer,
            isMoving: selection.isMoving,
            objectStatusFlags: selection.objectStatusFlags,
            productionQueueEntryCount: productionState?.queueEntryCount,
            productionQueueMaxEntries: productionState?.maxQueueEntries,
            appliedUpgradeNames: selection.appliedUpgradeNames,
          },
        ],
        {
          playerUpgradeNames: gameLogic.getLocalPlayerUpgradeNames(),
          playerScienceNames: gameLogic.getLocalPlayerScienceNames(),
          playerSciencePurchasePoints: gameLogic.getLocalPlayerSciencePurchasePoints(),
          disabledScienceNames: gameLogic.getLocalPlayerDisabledScienceNames(),
          hiddenScienceNames: gameLogic.getLocalPlayerHiddenScienceNames(),
          logicFrame: gameLoop.getFrameNumber(),
          resolveSpecialPowerReadyFrame: (specialPowerName, sourceEntityId) => (
            gameLogic.resolveShortcutSpecialPowerReadyFrameForSourceEntity(
              specialPowerName,
              sourceEntityId,
            )
          ),
        },
      );
    },
    saveGame: (slotId: string, description: string) => saveCurrentGame(slotId, description),
    loadGameFromSlot: (slotId: string) => loadSavedGameSlot(slotId),
    listSaves: () => ctx.saveStorage.listSaves(),
    debugSpawnParticleSystem: (templateName: string, position: { x: number; y: number; z: number }) =>
      particleSystemManager.createSystem(
        templateName,
        new THREE.Vector3(position.x, position.y, position.z),
      ),
    getParticleSystemDebugState: () => ({
      activeSystemCount: particleSystemManager.getActiveSystemCount(),
      totalParticleCount: particleSystemManager.getTotalParticleCount(),
      saveState: particleSystemManager.captureSaveState(),
    }),
  };

  // Hide loading screen
  await hideLoadingScreen();

  console.log(
    '%c C&C Generals: Zero Hour — Browser Edition ',
    'background: #1a1a2e; color: #c9a84c; font-size: 16px; padding: 8px;',
  );
  console.log('Stage 3: Terrain + map entities bootstrapped.');
  console.log(`Terrain: ${heightmap.width}x${heightmap.height} (${activeMapPath ?? 'procedural demo'})`);
  console.log(`Placed ${objectPlacement.spawnedObjects}/${objectPlacement.totalObjects} objects from map data.`);
  console.log('Controls: LMB=select, RMB=move/confirm target, 1-12=ControlBar slot, WASD=scroll, Q/E=rotate, Wheel=zoom, Middle-drag=pan, F1=help, F3=wireframe');
}

async function startGameFromRuntimeSave(
  ctx: PreInitContext,
  data: ArrayBuffer,
  campaignServices?: RuntimeSaveCampaignServices,
): Promise<void> {
  const runtimeSave = parseRuntimeSaveFile(data);
  let restoredCampaignContext: Parameters<typeof startGame>[3];
  let resolvedMapPath = runtimeSave.mapPath;

  if (runtimeSave.campaign) {
    if (!campaignServices) {
      throw new Error(
        `Save "${runtimeSave.metadata.description}" contains CHUNK_Campaign data, ` +
        'but no CampaignManager services were provided for restore.',
      );
    }

    const { campaignManager, videoPlayer, onReturnToShell } = campaignServices;
    const restored = campaignManager.setCampaignAndMission(
      runtimeSave.campaign.campaignName,
      runtimeSave.campaign.missionName,
    );
    if (!restored) {
      throw new Error(
        `Unable to restore campaign save for ${runtimeSave.campaign.campaignName}/` +
        `${runtimeSave.campaign.missionName}.`,
      );
    }

    campaignManager.difficulty = runtimeSave.campaign.difficulty;

    const currentCampaign = campaignManager.getCurrentCampaign();
    const currentMission = campaignManager.getCurrentMission();
    resolvedMapPath = resolvedMapPath ?? campaignManager.resolveMapAssetPath(currentMission);
    if (!currentCampaign || !currentMission || !resolvedMapPath) {
      throw new Error(
        'Campaign save restore did not resolve a valid campaign, mission, and runtime map path.',
      );
    }

    restoredCampaignContext = {
      campaignManager,
      videoPlayer,
      settings: {
        gameMode: runtimeSave.campaign.isChallengeCampaign ? 'CHALLENGE' : 'CAMPAIGN',
        campaignName: currentCampaign.name,
        difficulty: runtimeSave.campaign.difficulty,
        playerTemplateNum: runtimeSave.campaign.playerTemplateNum,
        mapPath: resolvedMapPath,
        mission: currentMission,
        campaign: currentCampaign,
      },
      onReturnToShell,
    };
  }

  await startGame(ctx, resolvedMapPath, null, restoredCampaignContext, undefined, { runtimeSave });
}

// ============================================================================
// Application entry point
// ============================================================================

async function init(): Promise<void> {
  // Phase 1: Pre-initialize (renderer, assets, INI data, audio)
  const ctx = await preInit();

  // Check for direct map load via URL parameter (backward compat)
  const urlParams = new URLSearchParams(window.location.search);
  const mapPathParam = urlParams.get('map');
  const directMapPath = normalizeRuntimeAssetPath(mapPathParam);

  if (mapPathParam !== null) {
    // Direct load — skip menu
    if (!directMapPath) {
      throw new Error(
        `Requested map path "${mapPathParam}" is invalid after runtime normalization`,
      );
    }
    await startGame(ctx, directMapPath, null);
    return;
  }

  // Phase 1.5: Show game shell (main menu → skirmish setup)
  await hideLoadingScreen();

  const gameContainer = document.getElementById('game-container') as HTMLDivElement;

  // Load persisted option preferences for the Options screen
  let browserStorage: Storage | null = null;
  try { browserStorage = window.localStorage; } catch { browserStorage = null; }
  const shellPrefs = loadOptionPreferencesFromStorage(browserStorage);
  const optionsState = loadOptionsState(shellPrefs);

  // Options screen — shared between main menu and in-game ESC
  const optionsScreen = new OptionsScreen(gameContainer, {
    onApply: (state: OptionsState) => {
      applyOptionsState(state, ctx.audioManager, ctx.rtsCamera);
      saveOptionsToStorage(state, browserStorage);
    },
    onClose: () => { /* no-op, screen hides itself */ },
  }, optionsState);

  // ── Campaign system initialization ──
  const campaignManager = new CampaignManager();
  let videoPlayer: VideoPlayer | null = null;

  // Load Campaign.ini — fetch directly since raw INI isn't in the converted manifest
  try {
    const campaignResp = await fetch(
      `${RUNTIME_ASSET_BASE_URL}/_extracted/INIZH/Data/INI/Campaign.ini`,
    );
    if (!campaignResp.ok) throw new Error(`HTTP ${campaignResp.status}`);
    const campaignIniText = await campaignResp.text();
    campaignManager.init(campaignIniText);
    console.log(`Campaign data loaded: ${campaignManager.getCampaigns().length} campaigns`);
  } catch (err) {
    console.warn('Campaign.ini not available, campaign mode disabled:', err);
  }

  // Load Video.ini and create VideoPlayer — fetch directly since raw INI isn't in manifest
  try {
    const videoResp = await fetch(
      `${RUNTIME_ASSET_BASE_URL}/_extracted/INIZH/Data/INI/Video.ini`,
    );
    if (!videoResp.ok) throw new Error(`HTTP ${videoResp.status}`);
    const videoIniText = await videoResp.text();
    const manifest = ctx.assets.getManifest();
    videoPlayer = new VideoPlayer({
      root: gameContainer,
      resolveVideoAssetUrl: manifest ? createVideoUrlResolver(manifest) : undefined,
      onVideoCompleted: (_movieName) => {
        // Script video completion is handled in the bridge
      },
    });
    videoPlayer.init(videoIniText);
    console.log('Video.ini loaded for movie playback');
  } catch (err) {
    console.warn('Video.ini not available, movie playback disabled:', err);
  }

  const localizedStrings = await loadLocalizationStrings(ctx.assets, [
    'localization/EnglishZH/Data/English/generals.json',
    'localization/W3DEnglishZH/Data/English/generals.json',
  ]);

  const replayMenuScreen = new ReplayMenuScreen(gameContainer, {
    listReplays: () => ctx.replayStorage.listReplays(),
    onLoadReplay: async (replayId: string) => {
      const loadedReplay = await ctx.replayStorage.loadFromDB(replayId);
      if (!loadedReplay) {
        throw new Error(`Replay "${replayId}" was not found.`);
      }

      const replaySettings = buildSkirmishSettingsFromReplay(loadedReplay.replay);
      replayMenuScreen.hide();
      shell.hide();
      await startGame(
        ctx,
        loadedReplay.replay.mapPath,
        replaySettings,
        undefined,
        {
          replay: loadedReplay.replay,
          settings: replaySettings,
          onReturnToShell: () => {
            window.location.reload();
          },
        },
      );
    },
    onDeleteReplay: async (replayId: string) => {
      await ctx.replayStorage.deleteReplay(replayId);
    },
    onCopyReplay: async (replayId: string) => {
      await ctx.replayStorage.downloadReplayFile(replayId);
    },
    onClose: () => { /* no-op, screen hides itself */ },
  });
  const loadGameScreen = new LoadGameScreen(gameContainer, {
    listSaves: () => ctx.saveStorage.listSaves(),
    onLoadSave: async (slotId: string) => {
      const loadedSave = await ctx.saveStorage.loadFromDB(slotId);
      if (!loadedSave) {
        throw new Error(`Save "${slotId}" was not found.`);
      }
      loadGameScreen.hide();
      shell.hide();
      await startGameFromRuntimeSave(ctx, loadedSave.data, {
        campaignManager,
        videoPlayer,
        onReturnToShell: () => {
          window.location.reload();
        },
      });
    },
    onDeleteSave: async (slotId: string) => {
      await ctx.saveStorage.deleteSave(slotId);
    },
    onClose: () => { /* no-op, screen hides itself */ },
  });

  const shell = new GameShell(gameContainer, {
    onStartGame: async (settings: SkirmishSettings) => {
      shell.hide();
      await startGame(ctx, settings.mapPath, settings);
    },
    onStartCampaign: async (settings: CampaignStartSettings) => {
      const resolvedPlayerTemplateNum = settings.gameMode === 'CHALLENGE'
        ? resolvePlayerTemplateNum(ctx.iniDataRegistry, settings.campaign.playerFactionName)
        : -1;
      if (settings.gameMode !== 'CAMPAIGN') {
        shell.hide();
      }
      campaignManager.setCampaign(settings.campaignName);
      campaignManager.difficulty = settings.difficulty;
      await startGame(ctx, settings.mapPath, null, {
        campaignManager,
        videoPlayer,
        settings: {
          ...settings,
          playerTemplateNum: resolvedPlayerTemplateNum,
        },
        onReturnToShell: () => {
          window.location.reload();
        },
      });
      if (settings.gameMode === 'CAMPAIGN') {
        shell.hide();
      }
    },
    onOpenOptions: () => {
      optionsScreen.show();
    },
    onOpenLoadGame: () => {
      loadGameScreen.show();
    },
    onOpenReplayMenu: () => {
      replayMenuScreen.show();
    },
  });

  // Populate available maps and campaigns
  const shellManifest = ctx.assets.getManifest();
  if (shellManifest) {
    shell.setAvailableMaps(shellManifest.getOutputPaths());
  }
  shell.setCampaigns(campaignManager.getShellCampaigns());
  shell.setChallengePersonas(
    getEnabledChallengePersonas(buildChallengePersonasFromRegistry(ctx.iniDataRegistry)),
  );
  shell.setLocalizedStrings(localizedStrings);
  shell.setStartingCreditsOptions(
    buildStartingCreditsOptionsFromRegistry(ctx.iniDataRegistry),
  );
  const shellTextureUrlMap = buildTextureUrlMap(shellManifest);
  const shellMappedImageResolver = new MappedImageResolver(
    `${RUNTIME_ASSET_BASE_URL}/textures/Art/Textures`,
    shellTextureUrlMap,
  );
  shellMappedImageResolver.addEntries(ctx.iniDataRegistry.getAllMappedImages());
  shell.setMappedImageResolver(shellMappedImageResolver);
  loadGameScreen.setLocalizedStrings(localizedStrings);
  loadGameScreen.setMappedImageResolver(shellMappedImageResolver);
  replayMenuScreen.setLocalizedStrings(localizedStrings);
  replayMenuScreen.setMappedImageResolver(shellMappedImageResolver);

  shell.show();
}

init().catch((err) => {
  console.error('Failed to initialize engine:', err);
  setLoadingProgress(0, `Error: ${err instanceof Error ? err.message : String(err)}`);
});
