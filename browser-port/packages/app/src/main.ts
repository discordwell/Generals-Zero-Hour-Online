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
import { GameLoop, SubsystemRegistry } from '@generals/engine';
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
import { GameLogicSubsystem, resolveRenderAssetProfile } from '@generals/game-logic';
import {
  UiRuntime,
  initializeUiOverlay,
  GUICommandType,
} from '@generals/ui';
import {
  playUiFeedbackAudio,
} from './control-bar-audio.js';
import { buildControlBarButtonsForSelections } from './control-bar-buttons.js';
import { dispatchIssuedControlBarCommands } from './control-bar-dispatch.js';
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
import { createScriptAudioRuntimeBridge } from './script-audio-runtime.js';
import { createScriptCameraEffectsRuntimeBridge } from './script-camera-effects-runtime.js';
import { createScriptCameraRuntimeBridge } from './script-camera-runtime.js';
import { createScriptCinematicRuntimeBridge } from './script-cinematic-runtime.js';
import { createScriptEmoticonRuntimeBridge } from './script-emoticon-runtime.js';
import { createScriptEvaRuntimeBridge } from './script-eva-runtime.js';
import { createScriptMessageRuntimeBridge } from './script-message-runtime.js';
import { createScriptObjectAmbientAudioRuntimeBridge } from './script-object-ambient-audio-runtime.js';
import { createScriptUiEffectsRuntimeBridge } from './script-ui-effects-runtime.js';
import { syncScriptViewRuntimeBridge } from './script-view-runtime.js';
import { assertIniBundleConsistency, assertRequiredManifestEntries } from './runtime-guardrails.js';
import { GameShell, type SkirmishSettings, type CampaignStartSettings } from './game-shell.js';
import { CampaignManager } from '@generals/game-logic';
import { VideoPlayer } from './video-player.js';
import {
  OptionsScreen,
  saveOptionsToStorage,
  loadOptionsState,
  type OptionsState,
} from './options-screen.js';
import { DiplomacyScreen, type DiplomacyPlayerInfo } from './diplomacy-screen.js';
import { PostgameStatsScreen, type SideScoreDisplay } from './postgame-stats-screen.js';
import { createAudioBufferLoader } from './audio-buffer-loader.js';
import { CursorManager, resolveGameCursor, detectEdgeScrollDir } from './cursor-manager.js';

// ============================================================================
// Loading screen
// ============================================================================

const loadingBar = document.getElementById('loading-bar') as HTMLDivElement;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;

function setLoadingProgress(percent: number, status: string): void {
  loadingBar.style.width = `${percent}%`;
  loadingStatus.textContent = status;
}

function showLoadingScreen(): void {
  loadingScreen.style.display = 'flex';
  loadingScreen.style.opacity = '1';
}

async function hideLoadingScreen(): Promise<void> {
  setLoadingProgress(100, 'Ready!');
  await new Promise((resolve) => setTimeout(resolve, 300));
  loadingScreen.style.opacity = '0';
  await new Promise((resolve) => setTimeout(resolve, 500));
  loadingScreen.style.display = 'none';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    typeNames: audioEvent.typeNames.length > 0 ? [...audioEvent.typeNames] : [...defaults.typeNames],
    controlNames: audioEvent.controlNames.length > 0 ? [...audioEvent.controlNames] : [...defaults.controlNames],
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
}

// ============================================================================
// Phase 1: Pre-initialization (assets, renderer, INI data, audio)
// ============================================================================

async function preInit(): Promise<PreInitContext> {
  initializeAudioContext();
  const networkManager = initializeNetworkClient({ forceSinglePlayer: true });
  initializeUiOverlay();

  setLoadingProgress(10, 'Creating renderer...');

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
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
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
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
  const assets = new AssetManager({
    baseUrl: RUNTIME_ASSET_BASE_URL,
    manifestUrl: RUNTIME_MANIFEST_FILE,
    requireManifest: true,
  });
  subsystems.register(assets);

  // Input
  const inputManager = new InputManager(canvas);
  subsystems.register(inputManager);

  // RTS Camera
  const rtsCamera = new RTSCamera(camera);
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
  const uiRuntime = new UiRuntime({ enableDebugOverlay: true });
  subsystems.register(uiRuntime);

  // Initialize registered runtime subsystems before any asset fetches so
  // AssetManager has the manifest and cache ready.
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
      setLoadingProgress(pct, 'Loading INI bundle...');
    });
    assertIniBundleConsistency(bundleHandle.data);
    iniDataRegistry.loadBundle(bundleHandle.data);
    iniDataInfo = `INI bundle loaded from ${bundleHandle.cached ? 'cache' : 'network'} ` +
      `(${bundleHandle.data.stats.objects} objects, ${bundleHandle.data.stats.weapons} weapons)`;
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
): Promise<void> {
  const {
    renderer, scene, camera, sunLight, subsystems, assets, inputManager, rtsCamera,
    terrainVisual, waterVisual, audioManager, cursorManager, networkManager, uiRuntime,
    iniDataRegistry, iniDataInfo,
  } = ctx;
  const canvas = renderer.domElement as HTMLCanvasElement;

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
  let scriptCameraMovementFinished = true;
  let scriptCameraTimeFrozen = false;
  let scriptCameraTimeMultiplier = 1;
  const gameLogic = new GameLogicSubsystem(scene, {
    attackUsesLineOfSight,
    pickObjectByInput: (input, cam) => objectVisualManager.pickObjectByInput(input, cam),
    isCameraMovementFinished: () => scriptCameraMovementFinished,
    isCameraTimeFrozen: () => scriptCameraTimeFrozen,
    getCameraTimeMultiplier: () => scriptCameraTimeMultiplier,
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
  subsystems.register(gameLogic);
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
  // Apply skirmish settings (player side, AI, credits)
  // ========================================================================

  if (skirmishSettings) {
    // Set local player side
    gameLogic.setPlayerSide(0, skirmishSettings.playerSide);

    // Set AI player side and enable AI
    if (skirmishSettings.aiEnabled) {
      gameLogic.setPlayerSide(1, skirmishSettings.aiSide);
    }
  }

  // ========================================================================
  // Load terrain (map JSON or procedural demo)
  // ========================================================================

  let mapData: MapDataJSON;
  let loadedFromJSON = false;

  if (mapPath) {
    assertRequiredManifestEntries(assets.getManifest(), [mapPath]);
    try {
      const handle = await assets.loadJSON<MapDataJSON>(mapPath, (loaded, total) => {
        const pct = total > 0 ? Math.round(50 + (loaded / total) * 20) : 60;
        setLoadingProgress(pct, 'Loading map data...');
      });
      mapData = handle.data;
      loadedFromJSON = true;
      console.log(`Map loaded via AssetManager (cached: ${handle.cached}, hash: ${handle.hash ?? 'n/a'})`);
    } catch (err) {
      throw new Error(
        `Requested map "${mapPath}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  // Build terrain roads from map objects with road flags.
  const terrainRoadRenderer = new TerrainRoadRenderer(scene);
  terrainRoadRenderer.buildFromMapObjects(
    mapData.objects,
    (wx, wz) => heightmap.getInterpolatedHeight(wx, wz),
  );

  const objectPlacement = gameLogic.loadMapObjects(mapData, iniDataRegistry, heightmap);
  if (objectPlacement.unresolvedObjects > 0) {
    console.warn(
      `Object resolve summary: ${objectPlacement.resolvedObjects}/${objectPlacement.spawnedObjects} objects resolved`,
    );
  }
  objectVisualManager.sync(gameLogic.getRenderableEntityStates());
  const objectStatus = ` | Objects: ${objectPlacement.spawnedObjects}/${objectPlacement.totalObjects} ` +
    `(unresolved: ${objectPlacement.unresolvedObjects})`;

  setLoadingProgress(70, 'Configuring camera...');

  // ========================================================================
  // Apply post-load skirmish settings (credits, AI)
  // ========================================================================

  if (skirmishSettings) {
    // Source parity: SkirmishScripts.scb — spawn command center + dozer at Player_N_Start waypoints.
    gameLogic.spawnSkirmishStartingEntities();

    // Set starting credits
    gameLogic.submitCommand({
      type: 'setSideCredits',
      side: skirmishSettings.playerSide,
      amount: skirmishSettings.startingCredits,
    });

    if (skirmishSettings.aiEnabled) {
      gameLogic.submitCommand({
        type: 'setSideCredits',
        side: skirmishSettings.aiSide,
        amount: skirmishSettings.startingCredits,
      });
      gameLogic.enableSkirmishAI(skirmishSettings.aiSide);
    }
  }

  // ========================================================================
  // Camera setup
  // ========================================================================

  // Set camera height query for terrain following
  rtsCamera.setHeightQuery((x, z) => heightmap.getInterpolatedHeight(x, z));

  // Set map bounds
  rtsCamera.setMapBounds(0, heightmap.worldWidth, 0, heightmap.worldDepth);

  // Center camera on map
  rtsCamera.lookAt(heightmap.worldWidth / 2, heightmap.worldDepth / 2);

  setLoadingProgress(90, 'Starting game loop...');

  // ========================================================================
  // Fog of war overlay
  // ========================================================================

  const shroudRenderer = new ShroudRenderer(scene, {
    worldWidth: heightmap.worldWidth,
    worldDepth: heightmap.worldDepth,
  });

  // ========================================================================
  // Debug info & keyboard shortcuts
  // ========================================================================

  const debugInfo = document.getElementById('debug-info') as HTMLDivElement;
  const creditsHud = document.getElementById('credits-hud') as HTMLDivElement;
  creditsHud.style.display = 'block';

  // Power HUD indicator (below credits) — reuse existing element on restart.
  let powerHud = document.getElementById('power-hud') as HTMLDivElement | null;
  if (!powerHud) {
    powerHud = document.createElement('div');
    powerHud.id = 'power-hud';
    Object.assign(powerHud.style, {
      position: 'absolute',
      top: '40px',
      right: '10px',
      color: '#66cc66',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: '13px',
      fontWeight: '600',
      textShadow: '0 0 4px rgba(0,0,0,0.8)',
      zIndex: '100',
      pointerEvents: 'none',
    });
    document.getElementById('ui-overlay')!.appendChild(powerHud);
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
    });
    document.getElementById('ui-overlay')!.appendChild(superweaponHud);
  }

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

    if (state.attackTargetEntityId !== null) {
      lines.push('Status: Attacking');
    } else if (state.animationState === 'MOVE') {
      lines.push('Status: Moving');
    } else {
      lines.push('Status: Idle');
    }

    entityInfoDetails.textContent = lines.join(' | ');
  };

  // Post-game stats screen (replaces simple endgame overlay)
  const postgameScreen = new PostgameStatsScreen(gameContainer, {
    onReturnToMenu: () => {
      if (campaignContext) {
        campaignContext.onReturnToShell();
      } else {
        window.location.reload();
      }
    },
    onPlayAgain: () => {
      if (campaignContext) {
        // Retry same mission — restart with the same campaign context
        disposeGame();
        void startGame(ctx, mapPath, null, campaignContext);
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
        const faction = sideToFactionLabel(side);
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
      // Map height to green-brown terrain color.
      const t = Math.max(0, Math.min(1, h / 30));
      const r = Math.round(40 + t * 80);
      const g = Math.round(60 + t * 100);
      const b = Math.round(30 + t * 40);
      const idx = (py * MINIMAP_SIZE + px) * 4;
      terrainImgData.data[idx] = r;
      terrainImgData.data[idx + 1] = g;
      terrainImgData.data[idx + 2] = b;
      terrainImgData.data[idx + 3] = 255;
    }
  }
  minimapTerrainCtx.putImageData(terrainImgData, 0, 0);

  // Click on minimap to move camera.
  let radarInteractionEnabled = true;
  minimapCanvas.addEventListener('mousedown', (e) => {
    if (!radarInteractionEnabled) {
      return;
    }
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const worldX = mx * heightmap.worldWidth;
    const worldZ = my * heightmap.worldDepth;
    rtsCamera.lookAt(worldX, worldZ);
  });

  let minimapDragging = false;
  minimapCanvas.addEventListener('mousedown', () => {
    minimapDragging = radarInteractionEnabled;
  });
  window.addEventListener('mouseup', () => { minimapDragging = false; });
  minimapCanvas.addEventListener('mousemove', (e) => {
    if (!minimapDragging || !radarInteractionEnabled) return;
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    rtsCamera.lookAt(mx * heightmap.worldWidth, my * heightmap.worldDepth);
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
      const renderStates = gameLogic.getRenderableEntityStates();
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

        minimapCtx.fillStyle = isAlly ? '#00cc00' : '#cc3333';
        minimapCtx.fillRect(px - 1, py - 1, 3, 3);
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

  const resolveControlBarSlotFromKey = (key: string): number | null => {
    if (/^[1-9]$/.test(key)) {
      return Number.parseInt(key, 10);
    }
    if (key === '0') {
      return 10;
    }
    if (key === '-') {
      return 11;
    }
    if (key === '=') {
      return 12;
    }
    return null;
  };

  // F1 toggle wireframe
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      terrainVisual.toggleWireframe();
      return;
    }

    // Only activate control bar slots via number keys when Ctrl is NOT held
    // (Ctrl+1-9 is reserved for control group assignment).
    // Skip plain digit keys 1-9 as they recall control groups.
    if (!e.ctrlKey && !e.metaKey) {
      const resolvedSlot = resolveControlBarSlotFromKey(e.key);
      if (resolvedSlot !== null && !/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        activateControlBarSlot(resolvedSlot - 1);
      }
    }
  });

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

  // Rally flag marker (small cone at target).
  const rallyMarkerGeometry = new THREE.ConeGeometry(0.3, 1.5, 6);
  const rallyMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
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
  // Data-driven particle & FX system (replaces inline particle effects)
  // ========================================================================

  const gameLODManager = new GameLODManager(iniDataRegistry);
  gameLODManager.init();
  const particleSystemManager = new ParticleSystemManager(scene, gameLODManager);
  particleSystemManager.loadFromRegistry(iniDataRegistry);
  particleSystemManager.init();
  const decalManager = new DecalManager(scene, 256, 128);
  decalManager.init();

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
      if (event.type === 'WEAPON_IMPACT' || event.type === 'ENTITY_DESTROYED') {
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

  const controlGroups = new Map<number, number[]>();
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
  // Building placement ghost
  // ========================================================================

  const ghostValidMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Red material for invalid placement positions (reserved for future
  // buildability validation).
  const _ghostInvalidMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  void _ghostInvalidMaterial;

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
      // Clean up when exiting placement mode.
      if (buildingGhostTemplateName !== null) {
        if (buildingGhostModel) {
          buildingGhostGroup.remove(buildingGhostModel);
          buildingGhostModel = null;
        }
        buildingGhostTemplateName = null;
        buildingGhostLoadingTemplate = null;
      }
      return;
    }

    // Determine which building template is being placed.
    const templateName = resolveGhostTemplateName(pending.sourceButtonId);
    if (!templateName) {
      buildingGhostGroup.visible = false;
      return;
    }

    // When the template changes, load the new model.
    if (templateName !== buildingGhostTemplateName && templateName !== buildingGhostLoadingTemplate) {
      // Remove old model and show fallback while loading.
      if (buildingGhostModel) {
        buildingGhostGroup.remove(buildingGhostModel);
        buildingGhostModel = null;
      }
      buildingGhostTemplateName = null;
      buildingGhostGroup.add(ghostFallbackMesh);
      loadGhostModelForTemplate(templateName);
    }

    // Resolve cursor world position.
    const worldTarget = gameLogic.resolveMoveTargetFromInput(inputState, camera);
    if (!worldTarget) {
      buildingGhostGroup.visible = false;
      return;
    }

    const y = heightmap.getInterpolatedHeight(worldTarget.x, worldTarget.z);
    buildingGhostGroup.position.set(worldTarget.x, y + 1, worldTarget.z);

    // Apply valid/invalid placement tint (green = valid placement).
    const ghostMaterial = ghostValidMaterial;
    if (buildingGhostModel) {
      applyGhostMaterial(buildingGhostModel, ghostMaterial);
    }

    buildingGhostGroup.visible = true;
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
    const states = gameLogic.getRenderableEntityStates();
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
    resolveLocalPlayerSide: () => gameLogic.getPlayerSide(networkManager.getLocalPlayerID()),
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
  });
  scriptCameraMovementFinished = scriptCameraRuntimeBridge.isCameraMovementFinished();
  scriptCameraTimeFrozen = scriptCameraRuntimeBridge.isCameraTimeFrozen();
  scriptCameraTimeMultiplier = scriptCameraRuntimeBridge.getCameraTimeMultiplier();
  const trackedShortcutSpecialPowerSourceEntityIds = new Set<number>();
  let currentLogicFrame = 0;
  let missionInputLocked = false;

  gameLoop.start({
    onSimulationStep(_frameNumber: number, dt: number) {
      currentLogicFrame = _frameNumber + 1;
      const inputState = inputManager.getState();
      const scriptInputDisabled = gameLogic.isScriptInputDisabled();
      missionInputLocked = scriptInputDisabled || gameEnded;
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
      if (missionInputLocked && pendingControlBarCommand) {
        uiRuntime.cancelPendingControlBarCommand();
      }
      if (!missionInputLocked && pendingControlBarCommand && inputState.rightMouseClick) {
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
      if (!missionInputLocked) {
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

      if (!missionInputLocked) {
        updateBuildingGhost(inputState);
      } else {
        buildingGhostGroup.visible = false;
      }

      // Spawn move indicator and play voice on right-click command.
      if (inputStateForGameLogic.rightMouseClick && gameLogic.getLocalPlayerSelectionIds().length > 0) {
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

      gameLogic.handlePointerInput(inputStateForGameLogic, camera);

      // Detect selection changes and play select voice.
      const currentSelectionIds = gameLogic.getLocalPlayerSelectionIds();
      if (currentSelectionIds.length > 0) {
        const changed = currentSelectionIds.length !== previousSelectionSnapshot.length
          || currentSelectionIds.some((id, i) => previousSelectionSnapshot[i] !== id);
        if (changed) {
          voiceBridge.playGroupVoice(currentSelectionIds, 'select');
        }
      }
      previousSelectionSnapshot = currentSelectionIds;

      if (!missionInputLocked) {
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
      if (!missionInputLocked && inputState.keysPressed.has(' ')) {
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
      if (!missionInputLocked && inputState.keysPressed.has('s')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        if (selIds.length > 0) {
          for (const id of selIds) {
            gameLogic.submitCommand({ type: 'stop', entityId: id, commandSource: 'PLAYER' });
          }
        }
      }

      // Delete — sell selected building.
      if (!missionInputLocked && inputState.keysPressed.has('delete')) {
        const selIds = gameLogic.getLocalPlayerSelectionIds();
        for (const id of selIds) {
          gameLogic.submitCommand({ type: 'sell', entityId: id });
        }
      }

      // F9 — toggle diplomacy overlay.
      if (inputState.keysPressed.has('f9') && !gameEnded) {
        diplomacyScreen.toggle();
      }

      // Escape — close overlays, cancel pending command, or open options.
      if (!missionInputLocked && inputState.keysPressed.has('escape')) {
        if (diplomacyScreen.isVisible) {
          diplomacyScreen.hide();
        } else if (ingameOptionsScreen.isVisible) {
          ingameOptionsScreen.hide();
        } else if (uiRuntime.getPendingControlBarCommand()) {
          uiRuntime.cancelPendingControlBarCommand();
        } else if (!gameEnded) {
          ingameOptionsScreen.show();
        }
      }

      // Feed input to camera
      rtsCamera.setInputState(inputStateForGameLogic);

      // Update all subsystems (InputManager resets accumulators,
      // RTSCamera processes input, WaterVisual animates UVs)
      subsystems.updateAll(dt);
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

      syncScriptViewRuntimeBridge(gameLogic, objectVisualManager, terrainVisual);
      objectVisualManager.sync(gameLogic.getRenderableEntityStates(), dt);

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
        let hoverTarget: 'none' | 'own-unit' | 'enemy' | 'ground' = 'none';
        if (inputState.pointerInCanvas) {
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
        }
        const pendingAbility = uiRuntime.getPendingControlBarCommand() !== null;
        const cursorName = resolveGameCursor({ hasSelection, hoverTarget, edgeScrollDir, pendingAbility });
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
      if (radarVisible) {
        updateMinimap(radarEntityBlipsVisible);
      }
      updateProductionPanel();
      updateRallyPointVisual();
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

      // Update credits HUD
      const localPlayerId = networkManager.getLocalPlayerID();
      const localPlayerSide = gameLogic.getPlayerSide(localPlayerId);
      if (localPlayerSide) {
        const credits = gameLogic.getSideCredits(localPlayerSide);
        creditsHud.textContent = `$${credits.toLocaleString()}`;

        // Update power HUD
        const powerState = gameLogic.getSidePowerState(localPlayerSide);
        const totalProd = powerState.energyProduction + powerState.powerBonus;
        const surplus = totalProd - powerState.energyConsumption;
        if (totalProd > 0 || powerState.energyConsumption > 0) {
          powerHud.style.display = 'block';
          powerHud.textContent = `\u26A1 ${totalProd}/${powerState.energyConsumption}`;
          powerHud.style.color = surplus >= 0 ? '#66cc66' : '#ff4444';
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

      // Update superweapon countdown timers.
      const countdowns = gameLogic.getSuperweaponCountdowns();
      if (countdowns.length > 0) {
        const normalizedLocal = localPlayerSide?.toUpperCase() ?? '';
        const lines: string[] = [];
        for (const cd of countdowns) {
          const isPlayer = cd.side.toUpperCase() === normalizedLocal;
          const prefix = isPlayer ? '\u2622' : '\u26A0'; // ☢ for player, ⚠ for enemy
          if (cd.isReady) {
            lines.push(`${prefix} ${cd.powerName}: READY`);
          } else if (cd.readyFrame > 0) {
            const remainingFrames = cd.readyFrame - cd.currentFrame;
            const remainingSec = Math.max(0, Math.ceil(remainingFrames / 30));
            const min = Math.floor(remainingSec / 60);
            const sec = remainingSec % 60;
            lines.push(`${prefix} ${cd.powerName}: ${min}:${sec.toString().padStart(2, '0')}`);
          }
        }
        superweaponHud.textContent = lines.join(' | ');
        superweaponHud.style.display = lines.length > 0 ? 'block' : 'none';
      } else {
        superweaponHud.style.display = 'none';
      }

      // Check for game end
      if (!gameEnded) {
        const endState = gameLogic.getGameEndState();
        if (endState) {
          gameEnded = true;

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
              const finalMovie = cm.getCurrentCampaign()?.finalMovieName;
              if (finalMovie && vp) {
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
              faction: sideToFactionLabel(side),
              isVictor: endState.victorSides.includes(side),
              isLocal: side === localSide,
              ...score,
            };
          });
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

      const unresolvedVisualIds = objectVisualManager.getUnresolvedEntityIds();
      const unresolvedVisualStatus = unresolvedVisualIds.length > 0
        ? ` | Unresolved visuals: ${unresolvedVisualIds.length} (${unresolvedVisualIds.join(', ')})`
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
  }, { signal: gameAbort.signal });

  const disposeGame = (): void => {
    gameAbort.abort();
    gameLoop.stop();
    subsystems.disposeAll();
    objectVisualManager.dispose();
    laserBeamRenderer.dispose();
    dynamicLightManager.dispose();
    tracerRenderer.dispose();
    debrisRenderer.dispose();
    terrainRoadRenderer.dispose();
    voiceBridge.dispose();
    musicManager.dispose();
    cursorManager.dispose();
    shroudRenderer.dispose();
    delete (globalThis as Record<string, unknown>)['__GENERALS_E2E__'];
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
      gameLogic.getRenderableEntityStates(),
    getGameEndState: (): ReturnType<GameLogicSubsystem['getGameEndState']> =>
      gameLogic.getGameEndState(),
    setScriptTeamMembers: (teamName: string, entityIds: readonly number[]): boolean =>
      gameLogic.setScriptTeamMembers(teamName, entityIds),
    setScriptTeamControllingSide: (teamName: string, side: string): boolean =>
      gameLogic.setScriptTeamControllingSide(teamName, side),
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
  };

  // Hide loading screen
  await hideLoadingScreen();

  console.log(
    '%c C&C Generals: Zero Hour — Browser Edition ',
    'background: #1a1a2e; color: #c9a84c; font-size: 16px; padding: 8px;',
  );
  console.log('Stage 3: Terrain + map entities bootstrapped.');
  console.log(`Terrain: ${heightmap.width}x${heightmap.height} (${mapPath ?? 'procedural demo'})`);
  console.log(`Placed ${objectPlacement.spawnedObjects}/${objectPlacement.totalObjects} objects from map data.`);
  console.log('Controls: LMB=select, RMB=move/confirm target, 1-12=ControlBar slot, WASD=scroll, Q/E=rotate, Wheel=zoom, Middle-drag=pan, F1=wireframe');
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

  // Load Campaign.ini
  try {
    const campaignIniHandle = await ctx.assets.loadArrayBuffer(
      '_extracted/INIZH/Data/INI/Campaign.ini',
    );
    const campaignIniText = new TextDecoder().decode(campaignIniHandle.data);
    campaignManager.init(campaignIniText);
    console.log(`Campaign data loaded: ${campaignManager.getCampaigns().length} campaigns`);
  } catch (err) {
    console.warn('Campaign.ini not available, campaign mode disabled:', err);
  }

  // Load Video.ini and create VideoPlayer
  try {
    const videoIniHandle = await ctx.assets.loadArrayBuffer(
      '_extracted/INIZH/Data/INI/Video.ini',
    );
    const videoIniText = new TextDecoder().decode(videoIniHandle.data);
    videoPlayer = new VideoPlayer({
      root: gameContainer,
      videoBaseUrl: 'assets/_extracted/video',
      onVideoCompleted: (_movieName) => {
        // Script video completion is handled in the bridge
      },
    });
    videoPlayer.init(videoIniText);
    console.log('Video.ini loaded for movie playback');
  } catch (err) {
    console.warn('Video.ini not available, movie playback disabled:', err);
  }

  const shell = new GameShell(gameContainer, {
    onStartGame: async (settings: SkirmishSettings) => {
      shell.hide();
      await startGame(ctx, settings.mapPath, settings);
    },
    onStartCampaign: async (settings: CampaignStartSettings) => {
      shell.hide();
      campaignManager.setCampaign(settings.campaignName);
      campaignManager.difficulty = settings.difficulty;
      await startGame(ctx, settings.mapPath, null, {
        campaignManager,
        videoPlayer,
        settings,
        onReturnToShell: () => {
          window.location.reload();
        },
      });
    },
    onOpenOptions: () => {
      optionsScreen.show();
    },
  });

  // Populate available maps and campaigns
  const manifest = ctx.assets.getManifest();
  if (manifest) {
    shell.setAvailableMaps(manifest.getOutputPaths());
  }
  shell.setCampaigns(campaignManager.getCampaigns());

  shell.show();
}

init().catch((err) => {
  console.error('Failed to initialize engine:', err);
  setLoadingProgress(0, `Error: ${err instanceof Error ? err.message : String(err)}`);
});
