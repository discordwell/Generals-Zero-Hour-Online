/**
 * @generals/audio
 *
 * Source-aligned audio runtime structure based on GameAudio interfaces:
 * - AudioAffect category routing
 * - AudioEventInfo registry lookup
 * - Audio request queue (play/pause/stop)
 *
 * Web Audio API playback backend replaces Miles Sound System.
 */
import type { Subsystem } from '@generals/engine';

type BrowserAudioContext = AudioContext;

export enum AudioHandleSpecialValues {
  AHSV_Error = 0,
  AHSV_NoSound,
  AHSV_Muted,
  AHSV_NotForLocal,
  AHSV_StopTheMusic,
  AHSV_StopTheMusicFade,
  AHSV_FirstHandle,
}

export enum AudioAffect {
  AudioAffect_Music = 0x01,
  AudioAffect_Sound = 0x02,
  AudioAffect_Sound3D = 0x04,
  AudioAffect_Speech = 0x08,
  AudioAffect_All =
    AudioAffect_Music |
    AudioAffect_Sound |
    AudioAffect_Sound3D |
    AudioAffect_Speech,
  AudioAffect_SystemSetting = 0x10,
}

export enum AudioType {
  AT_Music,
  AT_Streaming,
  AT_SoundEffect,
}

export enum AudioPriority {
  AP_LOWEST,
  AP_LOW,
  AP_NORMAL,
  AP_HIGH,
  AP_CRITICAL,
}

export enum SoundType {
  ST_UI = 0x0001,
  ST_WORLD = 0x0002,
  ST_SHROUDED = 0x0004,
  ST_GLOBAL = 0x0008,
  ST_VOICE = 0x0010,
  ST_PLAYER = 0x0020,
  ST_ALLIES = 0x0040,
  ST_ENEMIES = 0x0080,
  ST_EVERYONE = 0x0100,
}

export enum AudioControl {
  AC_LOOP = 0x0001,
  AC_RANDOM = 0x0002,
  AC_ALL = 0x0004,
  AC_POSTDELAY = 0x0008,
  AC_INTERRUPT = 0x0010,
}

export enum RequestType {
  AR_Play,
  AR_Pause,
  AR_Stop,
}

export type AudioPlayerRelationship = 'allies' | 'enemies' | 'neutral';

export type AudioPlayerRelationshipResolver = (
  owningPlayerIndex: number,
  localPlayerIndex: number,
) => AudioPlayerRelationship;

export type AudioObjectPositionResolver = (
  objectId: number,
) => readonly [number, number, number] | null;

export type AudioDrawablePositionResolver = (
  drawableId: number,
) => readonly [number, number, number] | null;

export type AudioPlayerPositionResolver = (
  playerIndex: number,
) => readonly [number, number, number] | null;

export type AudioShroudVisibilityResolver = (
  localPlayerIndex: number,
  position: readonly [number, number, number],
) => boolean;

const AUDIO_AFFECT_CHANNELS = [
  AudioAffect.AudioAffect_Music,
  AudioAffect.AudioAffect_Sound,
  AudioAffect.AudioAffect_Sound3D,
  AudioAffect.AudioAffect_Speech,
] as const;

type AudioAffectChannel = (typeof AUDIO_AFFECT_CHANNELS)[number];

type AudioAffectVolumeTable = Record<AudioAffectChannel, number>;
type AudioAffectStateTable = Record<AudioAffectChannel, boolean>;

interface ResolvedAudioEvent {
  event: AudioEventRTS;
  info: AudioEventInfo;
  affectMask: AudioAffect;
  resolvedVolume: number;
}

interface AudioRequest {
  request: RequestType;
  pendingEvent?: ResolvedAudioEvent;
  handleToInteractOn?: AudioHandle;
  usePendingEvent: boolean;
  requiresCheckForSample: boolean;
}

interface ActiveAudioEvent {
  handle: AudioHandle;
  event: AudioEventRTS;
  info: AudioEventInfo;
  affectMask: AudioAffect;
  resolvedVolume: number;
  paused: boolean;
}

type AudioLimitBucket = 'music' | 'speech' | 'sound2d' | 'sound3d';

interface AudioLimitDecision {
  allow: boolean;
  handleToKill?: AudioHandle;
}

const DEFAULT_MUSIC_VOLUME = 0.6;
const DEFAULT_SOUND_VOLUME = 0.75;
const DEFAULT_SOUND3D_VOLUME = 0.75;
const DEFAULT_SPEECH_VOLUME = 0.6;
// Source defaults from StaticGameLODInfo::StaticGameLODInfo.
const DEFAULT_SAMPLE_COUNT_2D = 6;
const DEFAULT_SAMPLE_COUNT_3D = 24;
const DEFAULT_STREAM_COUNT = Number.POSITIVE_INFINITY;
const DEFAULT_MIN_SAMPLE_VOLUME = 0;
const DEFAULT_GLOBAL_MIN_RANGE: number | undefined = undefined;
const DEFAULT_GLOBAL_MAX_RANGE: number | undefined = undefined;
const PLAYER_RESTRICTED_SOUND_MASK =
  SoundType.ST_PLAYER |
  SoundType.ST_ALLIES |
  SoundType.ST_ENEMIES |
  SoundType.ST_EVERYONE;

let sharedAudioContext: BrowserAudioContext | null = null;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalizeOptionalAudioPreference(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : fallback;
}

function normalizeStreamCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_STREAM_COUNT;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : DEFAULT_STREAM_COUNT;
}

function getOrCreateAudioContext(): BrowserAudioContext | null {
  if (sharedAudioContext) {
    return sharedAudioContext;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const ctor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctor) {
    return null;
  }

  sharedAudioContext = new ctor();
  return sharedAudioContext;
}

function normalizeAudioEvent(
  eventOrName: AudioEventRTS | string,
  position?: readonly [number, number, number],
): AudioEventRTS {
  if (typeof eventOrName === 'string') {
    if (position) {
      return {
        eventName: eventOrName,
        position,
      };
    }
    return {
      eventName: eventOrName,
    };
  }

  if (position) {
    return {
      ...eventOrName,
      position: eventOrName.position ?? position,
    };
  }

  return {
    ...eventOrName,
  };
}

/**
 * Tracks an active Web Audio playback node chain for a playing audio event.
 * Source parity: Miles' PlayingAudio struct with HSAMPLE/H3DSAMPLE/HSTREAM handles.
 */
interface PlaybackNode {
  sourceNode: AudioBufferSourceNode;
  gainNode: GainNode;
  pannerNode: PannerNode | null;
  started: boolean;
}

export class AudioManager implements Subsystem {
  readonly name = '@generals/audio';

  private isInitialized = false;
  private context: BrowserAudioContext | null = null;
  private nextAudioHandle = AudioHandleSpecialValues.AHSV_FirstHandle;
  private activeAudioEvents = new Map<AudioHandle, ActiveAudioEvent>();
  private audioRequests: AudioRequest[] = [];
  private allAudioEventInfo = new Map<string, AudioEventInfo>();
  private adjustedVolumes = new Map<string, number>();

  /** Cached decoded audio buffers by event name. */
  private readonly audioBufferCache = new Map<string, AudioBuffer>();
  /** Active playback nodes by audio handle. */
  private readonly playbackNodes = new Map<AudioHandle, PlaybackNode>();
  /** Master gain node for all output. */
  private masterGainNode: GainNode | null = null;
  /** Per-affect gain nodes. */
  private readonly affectGainNodes = new Map<AudioAffect, GainNode>();
  /** Optional callback to load audio data by event name. */
  private audioBufferLoader: AudioBufferLoader | null = null;
  /** Set of event names currently being loaded. */
  private readonly loadingBuffers = new Set<string>();

  private musicNames: string[] = [];
  private disallowSpeech = false;
  private savedSystemVolumes: AudioAffectVolumeTable | null = null;

  private readonly audioEnabled: AudioAffectStateTable = {
    [AudioAffect.AudioAffect_Music]: true,
    [AudioAffect.AudioAffect_Sound]: true,
    [AudioAffect.AudioAffect_Sound3D]: true,
    [AudioAffect.AudioAffect_Speech]: true,
  };

  private readonly scriptVolumes: AudioAffectVolumeTable = {
    [AudioAffect.AudioAffect_Music]: 1,
    [AudioAffect.AudioAffect_Sound]: 1,
    [AudioAffect.AudioAffect_Sound3D]: 1,
    [AudioAffect.AudioAffect_Speech]: 1,
  };

  private readonly systemVolumes: AudioAffectVolumeTable = {
    [AudioAffect.AudioAffect_Music]: DEFAULT_MUSIC_VOLUME,
    [AudioAffect.AudioAffect_Sound]: DEFAULT_SOUND_VOLUME,
    [AudioAffect.AudioAffect_Sound3D]: DEFAULT_SOUND3D_VOLUME,
    [AudioAffect.AudioAffect_Speech]: DEFAULT_SPEECH_VOLUME,
  };

  private listenerPosition: readonly [number, number, number] = [0, 0, 0];
  private listenerForward: readonly [number, number, number] = [0, 0, 1];
  private listenerUp: readonly [number, number, number] = [0, 1, 0];
  private localPlayerIndex: number | null = null;
  private max2DSamples = DEFAULT_SAMPLE_COUNT_2D;
  private max3DSamples = DEFAULT_SAMPLE_COUNT_3D;
  private maxStreams = DEFAULT_STREAM_COUNT;
  private minSampleVolume = DEFAULT_MIN_SAMPLE_VOLUME;
  private globalMinRange = DEFAULT_GLOBAL_MIN_RANGE;
  private globalMaxRange = DEFAULT_GLOBAL_MAX_RANGE;
  private relationshipResolver: AudioPlayerRelationshipResolver | null = null;
  private readonly playerRelationshipOverrides = new Map<string, AudioPlayerRelationship>();
  private objectPositionResolver: AudioObjectPositionResolver | null = null;
  private drawablePositionResolver: AudioDrawablePositionResolver | null = null;
  private playerPositionResolver: AudioPlayerPositionResolver | null = null;
  private shroudVisibilityResolver: AudioShroudVisibilityResolver | null = null;
  private preferred3DProvider: string | null = null;
  private preferredSpeakerType: string | null = null;

  constructor(options: AudioManagerOptions = {}) {
    this.context = options.context ?? null;
    this.audioBufferLoader = options.audioBufferLoader ?? null;
    this.musicNames = options.musicTracks?.length ? [...options.musicTracks] : [];
    this.localPlayerIndex = options.localPlayerIndex ?? null;
    this.max2DSamples = normalizeNonNegativeInteger(
      options.sampleCount2D,
      DEFAULT_SAMPLE_COUNT_2D,
    );
    this.max3DSamples = normalizeNonNegativeInteger(
      options.sampleCount3D,
      DEFAULT_SAMPLE_COUNT_3D,
    );
    this.maxStreams = normalizeStreamCount(options.streamCount);
    this.minSampleVolume = clamp01(options.minSampleVolume ?? DEFAULT_MIN_SAMPLE_VOLUME);
    this.globalMinRange = this.normalizeNonNegativeReal(
      options.globalMinRange,
    ) ?? DEFAULT_GLOBAL_MIN_RANGE;
    this.globalMaxRange = this.normalizeNonNegativeReal(
      options.globalMaxRange,
    ) ?? DEFAULT_GLOBAL_MAX_RANGE;
    this.relationshipResolver = options.resolvePlayerRelationship ?? null;
    this.objectPositionResolver = options.resolveObjectPosition ?? null;
    this.drawablePositionResolver = options.resolveDrawablePosition ?? null;
    this.playerPositionResolver = options.resolvePlayerPosition ?? null;
    this.shroudVisibilityResolver = options.resolveShroudVisibility ?? null;
    this.preferred3DProvider = normalizeOptionalAudioPreference(options.preferred3DProvider);
    this.preferredSpeakerType = normalizeOptionalAudioPreference(options.preferredSpeakerType);

    if (options.eventInfos?.length) {
      for (const eventInfo of options.eventInfos) {
        this.addAudioEventInfo(eventInfo);
      }
    }

    for (const trackName of this.musicNames) {
      if (this.findAudioEventInfo(trackName)) {
        continue;
      }
      this.addAudioEventInfo({
        audioName: trackName,
        soundType: AudioType.AT_Music,
        type: SoundType.ST_UI,
        volume: 1,
        minVolume: 0,
      });
    }
  }

  init(): void {
    this.context = this.context ?? getOrCreateAudioContext();
    this.isInitialized = true;

    if (this.context?.state === 'suspended') {
      void this.context.resume();
    }

    // Set up master gain node chain.
    if (this.context) {
      this.masterGainNode = this.context.createGain();
      this.masterGainNode.connect(this.context.destination);

      // Create per-affect gain nodes.
      for (const affect of AUDIO_AFFECT_CHANNELS) {
        const gainNode = this.context.createGain();
        gainNode.connect(this.masterGainNode);
        this.affectGainNodes.set(affect, gainNode);
      }

      this.syncAffectGainNodes();
    }
  }

  reset(): void {
    this.stopAllAudioImmediately();
    this.removeAllAudioRequests();
    this.disallowSpeech = false;
    this.savedSystemVolumes = null;
    this.playerRelationshipOverrides.clear();
    this.isInitialized = true;
  }

  update(_deltaMs = 16): void {
    void _deltaMs;
    if (!this.isInitialized) {
      return;
    }

    this.syncAffectGainNodes();
    this.processRequestList();
    this.refreshActivePositionalAudio();
  }

  dispose(): void {
    this.stopAllAudioImmediately();
    this.removeAllAudioRequests();
    this.stopAllPlaybackNodes();
    this.isInitialized = false;

    this.masterGainNode = null;
    this.affectGainNodes.clear();

    if (this.context && this.context.state !== 'closed') {
      void this.context.close();
    }
    this.context = null;
    sharedAudioContext = null;
  }

  allocateAudioRequest(useAudioEvent: boolean): AudioRequest {
    return {
      request: RequestType.AR_Play,
      usePendingEvent: useAudioEvent,
      requiresCheckForSample: false,
    };
  }

  releaseAudioRequest(_requestToRelease: AudioRequest): void {
    void _requestToRelease;
  }

  appendAudioRequest(request: AudioRequest): void {
    this.audioRequests.push(request);
  }

  removeAllAudioRequests(): void {
    this.audioRequests.length = 0;
  }

  processRequestList(): void {
    if (this.audioRequests.length === 0) {
      return;
    }

    const requests = this.audioRequests;
    this.audioRequests = [];

    for (const request of requests) {
      switch (request.request) {
        case RequestType.AR_Play: {
          if (!request.pendingEvent || request.handleToInteractOn === undefined) {
            break;
          }

          if (!this.canAllocateSampleForPlay(request.pendingEvent)) {
            break;
          }

          this.activeAudioEvents.set(request.handleToInteractOn, {
            handle: request.handleToInteractOn,
            event: request.pendingEvent.event,
            info: request.pendingEvent.info,
            affectMask: request.pendingEvent.affectMask,
            resolvedVolume: request.pendingEvent.resolvedVolume,
            paused: false,
          });

          // Web Audio playback: create source node and connect to gain chain.
          this.startPlayback(
            request.handleToInteractOn,
            request.pendingEvent,
          );
          break;
        }

        case RequestType.AR_Pause: {
          if (request.handleToInteractOn === undefined) {
            break;
          }

          const active = this.activeAudioEvents.get(request.handleToInteractOn);
          if (active) {
            active.paused = true;
          }
          break;
        }

        case RequestType.AR_Stop: {
          if (request.handleToInteractOn === undefined) {
            break;
          }

          this.stopPlaybackNode(request.handleToInteractOn);
          this.activeAudioEvents.delete(request.handleToInteractOn);
          break;
        }
      }
    }
  }

  private refreshActivePositionalAudio(): void {
    for (const active of [...this.activeAudioEvents.values()]) {
      if (
        active.info.soundType !== AudioType.AT_SoundEffect
        || !this.isPositionalSoundEffectEvent(active.event, active.info)
      ) {
        continue;
      }

      if (!this.resolveEventPosition(active.event)) {
        // Source behavior from MilesAudioManager::processPlayingList:
        // positional sounds stop when no current world position can be resolved.
        this.stopPlaybackNode(active.handle);
        continue;
      }

      const resolvedVolume = this.resolveEventVolume(active.event, active.info);
      const distanceVolumeScale = this.resolveDistanceVolumeScale(active.event, active.info);
      const resolvedEffectiveVolume = clamp01(resolvedVolume * distanceVolumeScale);
      const isGlobal = ((active.info.type ?? 0) & SoundType.ST_GLOBAL) !== 0;
      const isCritical =
        (active.info.priority ?? AudioPriority.AP_NORMAL) === AudioPriority.AP_CRITICAL;

      // Source behavior from MilesAudioManager::processPlayingList:
      // non-global/non-critical 3D sounds are culled when effective volume
      // falls below AudioSettings MinVolume.
      if (
        resolvedEffectiveVolume < this.minSampleVolume
        && !isGlobal
        && !isCritical
      ) {
        this.stopPlaybackNode(active.handle);
        continue;
      }

      // Source parity: keep active event volume synchronized with current
      // listener/object positions and runtime volume overrides.
      active.resolvedVolume = resolvedEffectiveVolume;
      this.activeAudioEvents.set(active.handle, active);
    }

    // Update Web Audio panner positions for active 3D playback nodes.
    this.updatePlaybackNodePositions();
  }

  newAudioEventInfo(audioName: string): AudioEventInfo {
    const existing = this.findAudioEventInfo(audioName);
    if (existing) {
      return existing;
    }

    const info: AudioEventInfo = {
      audioName,
      soundType: AudioType.AT_SoundEffect,
      priority: AudioPriority.AP_NORMAL,
      type: SoundType.ST_WORLD,
      control: 0,
      loopCount: 1,
      volume: 1,
      minVolume: 0,
    };
    this.allAudioEventInfo.set(audioName, info);
    return info;
  }

  addAudioEventInfo(newEventInfo: AudioEventInfo): void {
    this.allAudioEventInfo.set(newEventInfo.audioName, {
      ...newEventInfo,
      volume: newEventInfo.volume ?? 1,
      minVolume: newEventInfo.minVolume ?? 0,
      limit: this.normalizePositiveInteger(newEventInfo.limit),
      minRange: this.normalizeNonNegativeReal(newEventInfo.minRange),
      maxRange: this.normalizeNonNegativeReal(newEventInfo.maxRange),
      type: newEventInfo.type ?? SoundType.ST_WORLD,
      control: newEventInfo.control ?? 0,
      loopCount: normalizeNonNegativeInteger(newEventInfo.loopCount, 1),
      priority: newEventInfo.priority ?? AudioPriority.AP_NORMAL,
      soundType: newEventInfo.soundType ?? AudioType.AT_SoundEffect,
    });
  }

  findAudioEventInfo(eventName: string): AudioEventInfo | null {
    return this.allAudioEventInfo.get(eventName) ?? null;
  }

  isValidAudioEvent(eventToCheck: AudioEventRTS | string): boolean {
    const event =
      typeof eventToCheck === 'string'
        ? {
            eventName: eventToCheck,
          }
        : eventToCheck;

    if (!event.eventName) {
      return false;
    }

    return this.findAudioEventInfo(event.eventName) !== null;
  }

  addTrackName(trackName: string): void {
    this.musicNames.push(trackName);
  }

  nextTrackName(currentTrack: string): string {
    let index = this.musicNames.findIndex((track) => track === currentTrack);
    if (index >= 0) {
      index += 1;
    }

    if (index < 0 || index >= this.musicNames.length) {
      return this.musicNames[0] ?? '';
    }

    return this.musicNames[index] ?? '';
  }

  prevTrackName(currentTrack: string): string {
    let index = this.musicNames.findIndex((track) => track === currentTrack);
    if (index >= 0) {
      index -= 1;
    }

    if (index < 0) {
      return this.musicNames[this.musicNames.length - 1] ?? '';
    }

    return this.musicNames[index] ?? '';
  }

  addAudioEvent(eventToAdd: AudioEventRTS): AudioHandle;
  addAudioEvent(
    eventName: string,
    position?: readonly [number, number, number],
  ): AudioHandle;
  addAudioEvent(
    eventOrName: AudioEventRTS | string,
    position?: readonly [number, number, number],
  ): AudioHandle {
    if (!this.isInitialized) {
      return AudioHandleSpecialValues.AHSV_Error;
    }

    const event = normalizeAudioEvent(eventOrName, position);
    if (!event.eventName || event.eventName === 'NoSound') {
      return AudioHandleSpecialValues.AHSV_NoSound;
    }

    const info = this.findAudioEventInfo(event.eventName);
    if (!info) {
      return AudioHandleSpecialValues.AHSV_Error;
    }

    if (this.disallowSpeech && info.soundType === AudioType.AT_Streaming) {
      return AudioHandleSpecialValues.AHSV_NoSound;
    }

    if (!event.uninterruptable && !this.shouldPlayLocally(event, info)) {
      return AudioHandleSpecialValues.AHSV_NotForLocal;
    }

    const affectMask = this.resolveAffectMask(event, info);
    // Source behavior from GameAudio::isOn/getAudioAffectFromEventInfo:
    // channel muting is evaluated against the resolved affect mask, not the
    // broader sound type.
    if (!this.areAffectsEnabled(affectMask)) {
      return AudioHandleSpecialValues.AHSV_NoSound;
    }

    const resolvedVolume = this.resolveEventVolume(event, info);
    const minVolume = info.minVolume ?? 0;
    if (resolvedVolume < Math.max(minVolume, this.minSampleVolume)) {
      return AudioHandleSpecialValues.AHSV_Muted;
    }

    if (this.shouldCullByDistance(event, info)) {
      return AudioHandleSpecialValues.AHSV_NoSound;
    }
    const distanceVolumeScale = this.resolveDistanceVolumeScale(event, info);
    const resolvedEffectiveVolume = clamp01(resolvedVolume * distanceVolumeScale);

    const isInterrupting = this.isInterruptingEvent(info);
    if (this.violatesVoice(event, info) && !isInterrupting) {
      return AudioHandleSpecialValues.AHSV_NoSound;
    }

    const limitDecision = this.evaluateLimitDecision(event, info);
    if (!limitDecision.allow) {
      return AudioHandleSpecialValues.AHSV_NoSound;
    }
    if (limitDecision.handleToKill !== undefined) {
      this.removeAudioEvent(limitDecision.handleToKill);
    }

    const handle = this.allocateNewHandle();
    const request = this.allocateAudioRequest(true);
    request.request = RequestType.AR_Play;
    request.pendingEvent = {
      event,
      info,
      affectMask,
      resolvedVolume: resolvedEffectiveVolume,
    };
    request.handleToInteractOn = handle;
    this.appendAudioRequest(request);

    return handle;
  }

  removeAudioEvent(audioEvent: AudioHandle | string): void {
    if (typeof audioEvent === 'string') {
      this.removePlayingAudio(audioEvent);
      return;
    }

    if (
      audioEvent === AudioHandleSpecialValues.AHSV_StopTheMusic
      || audioEvent === AudioHandleSpecialValues.AHSV_StopTheMusicFade
    ) {
      this.stopMusicTrack();
      return;
    }

    if (audioEvent < AudioHandleSpecialValues.AHSV_FirstHandle) {
      return;
    }

    const request = this.allocateAudioRequest(false);
    request.request = RequestType.AR_Stop;
    request.handleToInteractOn = audioEvent;
    this.appendAudioRequest(request);
  }

  stopAudio(whichToAffect: AudioAffect): void {
    this.stopByAffect(whichToAffect);
  }

  pauseAudio(whichToAffect: AudioAffect): void {
    this.pauseByAffect(whichToAffect);
    this.audioRequests = this.audioRequests.filter(
      (request) => request.request !== RequestType.AR_Play,
    );
  }

  resumeAudio(whichToAffect: AudioAffect): void {
    for (const [handle, active] of this.activeAudioEvents) {
      if ((active.affectMask & whichToAffect) !== 0) {
        active.paused = false;
        this.activeAudioEvents.set(handle, active);
      }
    }
  }

  pauseAmbient(shouldPause: boolean): void {
    if (shouldPause) {
      this.pauseAudio(AudioAffect.AudioAffect_Music);
    } else {
      this.resumeAudio(AudioAffect.AudioAffect_Music);
    }
  }

  loseFocus(): void {
    if (this.savedSystemVolumes) {
      return;
    }

    this.savedSystemVolumes = {
      [AudioAffect.AudioAffect_Music]: this.systemVolumes[AudioAffect.AudioAffect_Music],
      [AudioAffect.AudioAffect_Sound]: this.systemVolumes[AudioAffect.AudioAffect_Sound],
      [AudioAffect.AudioAffect_Sound3D]: this.systemVolumes[AudioAffect.AudioAffect_Sound3D],
      [AudioAffect.AudioAffect_Speech]: this.systemVolumes[AudioAffect.AudioAffect_Speech],
    };

    this.setVolume(
      0,
      AudioAffect.AudioAffect_All | AudioAffect.AudioAffect_SystemSetting,
    );
  }

  regainFocus(): void {
    if (!this.savedSystemVolumes) {
      return;
    }

    this.setVolume(
      this.savedSystemVolumes[AudioAffect.AudioAffect_Music],
      AudioAffect.AudioAffect_Music | AudioAffect.AudioAffect_SystemSetting,
    );
    this.setVolume(
      this.savedSystemVolumes[AudioAffect.AudioAffect_Sound],
      AudioAffect.AudioAffect_Sound | AudioAffect.AudioAffect_SystemSetting,
    );
    this.setVolume(
      this.savedSystemVolumes[AudioAffect.AudioAffect_Sound3D],
      AudioAffect.AudioAffect_Sound3D | AudioAffect.AudioAffect_SystemSetting,
    );
    this.setVolume(
      this.savedSystemVolumes[AudioAffect.AudioAffect_Speech],
      AudioAffect.AudioAffect_Speech | AudioAffect.AudioAffect_SystemSetting,
    );
    this.savedSystemVolumes = null;
  }

  setAudioEventEnabled(eventToAffect: string, enable: boolean): void {
    this.setAudioEventVolumeOverride(eventToAffect, enable ? -1 : 0);
  }

  setAudioEventVolumeOverride(eventToAffect: string, newVolume: number): void {
    if (!eventToAffect) {
      this.adjustedVolumes.clear();
      return;
    }

    if (newVolume === -1) {
      this.adjustedVolumes.delete(eventToAffect);
      return;
    }

    const clamped = clamp01(newVolume);
    this.adjustedVolumes.set(eventToAffect, clamped);
    this.adjustVolumeOfPlayingAudio(eventToAffect, clamped);
  }

  removeDisabledEvents(): void {
    this.removeAllDisabledAudio();
  }

  removeAllDisabledAudio(): void {
    for (const active of [...this.activeAudioEvents.values()]) {
      const adjusted = this.adjustedVolumes.get(active.event.eventName);
      if (adjusted === 0) {
        this.removeAudioEvent(active.handle);
      }
    }
  }

  adjustVolumeOfPlayingAudio(eventName: string, newVolume: number): void {
    for (const [handle, active] of this.activeAudioEvents) {
      if (active.event.eventName !== eventName) {
        continue;
      }

      active.resolvedVolume = clamp01(newVolume);
      this.activeAudioEvents.set(handle, active);
    }
  }

  removePlayingAudio(eventName: string): void {
    for (const active of [...this.activeAudioEvents.values()]) {
      if (active.event.eventName === eventName) {
        this.removeAudioEvent(active.handle);
      }
    }
  }

  isCurrentlyPlaying(handle: AudioHandle): boolean {
    if (this.activeAudioEvents.has(handle)) {
      return true;
    }

    for (const request of this.audioRequests) {
      if (request.request !== RequestType.AR_Play) {
        continue;
      }
      if (request.handleToInteractOn !== handle) {
        continue;
      }
      if (request.pendingEvent) {
        return true;
      }
    }

    return false;
  }

  isOn(whichToGet: AudioAffect): boolean {
    const affect = this.resolvePrimaryAffect(whichToGet);
    return this.audioEnabled[affect];
  }

  setOn(turnOn: boolean, whichToAffect: AudioAffect): void {
    this.forEachAffectInMask(whichToAffect, (affect) => {
      this.audioEnabled[affect] = turnOn;
    });
  }

  setVolume(volume: number, whichToAffect: AudioAffect): void {
    const normalized = clamp01(volume);
    const useSystemSetting =
      (whichToAffect & AudioAffect.AudioAffect_SystemSetting) !== 0;

    this.forEachAffectInMask(whichToAffect, (affect) => {
      if (useSystemSetting) {
        this.systemVolumes[affect] = normalized;
      } else {
        this.scriptVolumes[affect] = normalized;
      }
    });
  }

  getVolume(whichToGet: AudioAffect): number {
    const affect = this.resolvePrimaryAffect(whichToGet);
    return this.scriptVolumes[affect] * this.systemVolumes[affect];
  }

  setMusicVolume(volume: number): void {
    this.setVolume(
      clamp01(volume),
      AudioAffect.AudioAffect_Music | AudioAffect.AudioAffect_SystemSetting,
    );
  }

  setSfxVolume(volume: number): void {
    const normalized = clamp01(volume);
    this.setVolume(
      normalized,
      AudioAffect.AudioAffect_Sound | AudioAffect.AudioAffect_SystemSetting,
    );
    this.setVolume(
      normalized,
      AudioAffect.AudioAffect_Sound3D | AudioAffect.AudioAffect_SystemSetting,
    );
  }

  nextMusicTrack(): void {
    const trackName = this.nextTrackName(this.getMusicTrackName());
    if (!trackName) {
      return;
    }

    this.startMusicTrack(trackName);
  }

  prevMusicTrack(): void {
    const trackName = this.prevTrackName(this.getMusicTrackName());
    if (!trackName) {
      return;
    }

    this.startMusicTrack(trackName);
  }

  isMusicPlaying(): boolean {
    for (const active of this.activeAudioEvents.values()) {
      if (
        (active.affectMask & AudioAffect.AudioAffect_Music) !== 0
        && !active.paused
      ) {
        return true;
      }
    }

    return false;
  }

  getMusicTrackName(): string {
    for (const request of this.audioRequests) {
      if (request.request !== RequestType.AR_Play) {
        continue;
      }
      const pendingEvent = request.pendingEvent;
      if (!pendingEvent) {
        continue;
      }
      if (pendingEvent.info.soundType === AudioType.AT_Music) {
        return pendingEvent.event.eventName;
      }
    }

    for (const active of this.activeAudioEvents.values()) {
      if (active.info.soundType === AudioType.AT_Music) {
        return active.event.eventName;
      }
    }

    return '';
  }

  setListenerPosition(position: readonly [number, number, number]): void {
    this.listenerPosition = position;

    if (!this.context) {
      return;
    }

    const listener = this.context.listener as AudioListener & {
      positionX?: AudioParam;
      positionY?: AudioParam;
      positionZ?: AudioParam;
      setPosition?: (x: number, y: number, z: number) => void;
    };

    if (listener.positionX && listener.positionY && listener.positionZ) {
      listener.positionX.value = position[0];
      listener.positionY.value = position[1];
      listener.positionZ.value = position[2];
      return;
    }

    listener.setPosition?.(position[0], position[1], position[2]);
  }

  getListenerPosition(): readonly [number, number, number] {
    return this.listenerPosition;
  }

  getListenerOrientation(): {
    forward: readonly [number, number, number];
    up: readonly [number, number, number];
  } {
    return {
      forward: this.listenerForward,
      up: this.listenerUp,
    };
  }

  setListenerOrientation(
    forward: readonly [number, number, number],
    up: readonly [number, number, number],
  ): void {
    this.listenerForward = forward;
    this.listenerUp = up;

    if (!this.context) {
      return;
    }

    const listener = this.context.listener as AudioListener & {
      forwardX?: AudioParam;
      forwardY?: AudioParam;
      forwardZ?: AudioParam;
      upX?: AudioParam;
      upY?: AudioParam;
      upZ?: AudioParam;
      setOrientation?: (
        x: number,
        y: number,
        z: number,
        xUp: number,
        yUp: number,
        zUp: number,
      ) => void;
    };

    if (
      listener.forwardX
      && listener.forwardY
      && listener.forwardZ
      && listener.upX
      && listener.upY
      && listener.upZ
    ) {
      listener.forwardX.value = forward[0];
      listener.forwardY.value = forward[1];
      listener.forwardZ.value = forward[2];
      listener.upX.value = up[0];
      listener.upY.value = up[1];
      listener.upZ.value = up[2];
      return;
    }

    listener.setOrientation?.(
      forward[0],
      forward[1],
      forward[2],
      up[0],
      up[1],
      up[2],
    );
  }

  setLocalPlayerIndex(playerIndex: number | null): void {
    if (playerIndex === null || !Number.isFinite(playerIndex)) {
      this.localPlayerIndex = null;
      return;
    }

    this.localPlayerIndex = Math.trunc(playerIndex);
  }

  setPlayerRelationship(
    owningPlayerIndex: number,
    localPlayerIndex: number,
    relationship: AudioPlayerRelationship,
  ): void {
    if (!Number.isFinite(owningPlayerIndex) || !Number.isFinite(localPlayerIndex)) {
      return;
    }

    const key = this.playerRelationshipKey(
      Math.trunc(owningPlayerIndex),
      Math.trunc(localPlayerIndex),
    );
    this.playerRelationshipOverrides.set(key, relationship);
  }

  setPlayerRelationshipResolver(
    resolver: AudioPlayerRelationshipResolver | null,
  ): void {
    this.relationshipResolver = resolver;
  }

  setObjectPositionResolver(resolver: AudioObjectPositionResolver | null): void {
    this.objectPositionResolver = resolver;
  }

  setDrawablePositionResolver(resolver: AudioDrawablePositionResolver | null): void {
    this.drawablePositionResolver = resolver;
  }

  setPlayerPositionResolver(resolver: AudioPlayerPositionResolver | null): void {
    this.playerPositionResolver = resolver;
  }

  setSampleCounts(sampleCount2D: number, sampleCount3D: number): void {
    this.max2DSamples = normalizeNonNegativeInteger(
      sampleCount2D,
      DEFAULT_SAMPLE_COUNT_2D,
    );
    this.max3DSamples = normalizeNonNegativeInteger(
      sampleCount3D,
      DEFAULT_SAMPLE_COUNT_3D,
    );
  }

  setStreamCount(streamCount: number): void {
    this.maxStreams = normalizeStreamCount(streamCount);
  }

  setGlobalMinVolume(minSampleVolume: number): void {
    this.minSampleVolume = clamp01(minSampleVolume);
  }

  setGlobalRanges(globalMinRange: number | undefined, globalMaxRange: number | undefined): void {
    this.globalMinRange = this.normalizeNonNegativeReal(globalMinRange);
    this.globalMaxRange = this.normalizeNonNegativeReal(globalMaxRange);
  }

  setPreferredProvider(providerName: string | null | undefined): void {
    this.preferred3DProvider = normalizeOptionalAudioPreference(providerName);
  }

  getPreferredProvider(): string | null {
    return this.preferred3DProvider;
  }

  setPreferredSpeaker(speakerType: string | null | undefined): void {
    this.preferredSpeakerType = normalizeOptionalAudioPreference(speakerType);
  }

  getPreferredSpeaker(): string | null {
    return this.preferredSpeakerType;
  }

  setShroudVisibilityResolver(resolver: AudioShroudVisibilityResolver | null): void {
    this.shroudVisibilityResolver = resolver;
  }

  clearPlayerRelationships(): void {
    this.playerRelationshipOverrides.clear();
  }

  stopAllAudioImmediately(): void {
    this.removeAllAudioRequests();
    this.activeAudioEvents.clear();
    this.disallowSpeech = false;
  }

  getActiveAudioEventCount(): number {
    return this.activeAudioEvents.size;
  }

  getQueuedRequestCount(): number {
    return this.audioRequests.length;
  }

  getActiveResolvedVolume(handle: AudioHandle): number | null {
    const active = this.activeAudioEvents.get(handle);
    return active?.resolvedVolume ?? null;
  }

  private resolvePrimaryAffect(whichToGet: AudioAffect): AudioAffectChannel {
    if ((whichToGet & AudioAffect.AudioAffect_Music) !== 0) {
      return AudioAffect.AudioAffect_Music;
    }

    if ((whichToGet & AudioAffect.AudioAffect_Sound) !== 0) {
      return AudioAffect.AudioAffect_Sound;
    }

    if ((whichToGet & AudioAffect.AudioAffect_Sound3D) !== 0) {
      return AudioAffect.AudioAffect_Sound3D;
    }

    return AudioAffect.AudioAffect_Speech;
  }

  private forEachAffectInMask(
    whichToAffect: AudioAffect,
    callback: (affect: AudioAffectChannel) => void,
  ): void {
    for (const affect of AUDIO_AFFECT_CHANNELS) {
      if ((whichToAffect & affect) !== 0) {
        callback(affect);
      }
    }
  }

  private allocateNewHandle(): AudioHandle {
    const handle = this.nextAudioHandle;
    this.nextAudioHandle += 1;
    return handle;
  }

  private normalizePositiveInteger(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : undefined;
  }

  private normalizeNonNegativeReal(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return value >= 0 ? value : undefined;
  }

  private resolveAffectMask(event: AudioEventRTS, info: AudioEventInfo): AudioAffect {
    if (event.audioAffect !== undefined) {
      return event.audioAffect;
    }

    switch (info.soundType) {
      case AudioType.AT_Music:
        return AudioAffect.AudioAffect_Music;
      case AudioType.AT_Streaming:
        return AudioAffect.AudioAffect_Speech;
      case AudioType.AT_SoundEffect:
        return this.isPositionalSoundEffectEvent(event, info)
          ? AudioAffect.AudioAffect_Sound3D
          : AudioAffect.AudioAffect_Sound;
      default:
        return AudioAffect.AudioAffect_Sound;
    }
  }

  private isPositionalSoundEffectEvent(
    event: AudioEventRTS,
    info: AudioEventInfo,
  ): boolean {
    if (((info.type ?? 0) & SoundType.ST_WORLD) === 0) {
      return false;
    }

    // Source behavior from AudioEventRTS::isPositionalAudio:
    // ST_WORLD events are positional when bound to world coordinates, object IDs,
    // or drawable IDs.
    return (
      Array.isArray(event.position)
      || event.objectId !== undefined
      || event.drawableId !== undefined
    );
  }

  private shouldCullByDistance(event: AudioEventRTS, info: AudioEventInfo): boolean {
    if (info.soundType !== AudioType.AT_SoundEffect) {
      return false;
    }
    if (!this.isPositionalSoundEffectEvent(event, info)) {
      return false;
    }
    if (((info.type ?? 0) & SoundType.ST_GLOBAL) !== 0) {
      // Source behavior from SoundManager::canPlayNow:
      // positional ST_GLOBAL events skip distance/shroud culling gates.
      return false;
    }
    if ((info.priority ?? AudioPriority.AP_NORMAL) === AudioPriority.AP_CRITICAL) {
      return false;
    }

    const distanceContext = this.resolveDistanceCullContext(event, info);
    if (!distanceContext) {
      // Source behavior from SoundManager::canPlayNow:
      // if no world position can be resolved, skip distance/shroud culling.
      return false;
    }

    const { eventPosition, distance, maxRange } = distanceContext;
    if (typeof maxRange !== 'number' || !Number.isFinite(maxRange) || maxRange <= 0) {
      return false;
    }

    // Source behavior from SoundManager::canPlayNow:
    // positional, non-critical sounds are muted at MaxRange.
    if (distance >= maxRange) {
      return true;
    }

    if (((info.type ?? 0) & SoundType.ST_SHROUDED) === 0) {
      return false;
    }
    if (this.localPlayerIndex === null || !this.shroudVisibilityResolver) {
      // Without local shroud visibility state, do not cull by shroud.
      return false;
    }

    // Source behavior from SoundManager::canPlayNow:
    // ST_SHROUDED positional sounds are culled when local shroud is not clear.
    return !this.shroudVisibilityResolver(this.localPlayerIndex, eventPosition);
  }

  private resolveDistanceVolumeScale(event: AudioEventRTS, info: AudioEventInfo): number {
    if (info.soundType !== AudioType.AT_SoundEffect) {
      return 1;
    }
    if (!this.isPositionalSoundEffectEvent(event, info)) {
      return 1;
    }

    const distanceContext = this.resolveDistanceCullContext(event, info);
    if (!distanceContext) {
      return 1;
    }

    const { distance, minRange, maxRange } = distanceContext;
    if (typeof maxRange === 'number' && Number.isFinite(maxRange) && maxRange > 0 && distance >= maxRange) {
      return 0;
    }
    if (typeof minRange !== 'number' || !Number.isFinite(minRange) || minRange <= 0) {
      return 1;
    }
    if (distance <= minRange) {
      return 1;
    }

    // Source behavior from MilesAudioManager::getEffectiveVolume:
    // for positional sounds beyond min distance, volume scales by minRange / distance.
    return minRange / distance;
  }

  private resolveDistanceCullContext(
    event: AudioEventRTS,
    info: AudioEventInfo,
  ): {
    eventPosition: readonly [number, number, number];
    distance: number;
    minRange: number | undefined;
    maxRange: number | undefined;
  } | null {
    const eventPosition = this.resolveEventPosition(event);
    if (!eventPosition) {
      return null;
    }

    const [listenerX, listenerY, listenerZ] = this.listenerPosition;
    const [eventX, eventY, eventZ] = eventPosition;
    const dx = listenerX - eventX;
    const dy = listenerY - eventY;
    const dz = listenerZ - eventZ;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const { minRange, maxRange } = this.resolveDistanceCullRanges(info);
    return {
      eventPosition,
      distance,
      minRange,
      maxRange,
    };
  }

  private resolveDistanceCullRanges(
    info: AudioEventInfo,
  ): { minRange: number | undefined; maxRange: number | undefined } {
    if (((info.type ?? 0) & SoundType.ST_GLOBAL) !== 0) {
      // Source behavior from MilesAudioManager::playSample3D/getEffectiveVolume:
      // ST_GLOBAL events use AudioSettings global ranges instead of event ranges.
      return {
        minRange: this.globalMinRange,
        maxRange: this.globalMaxRange,
      };
    }
    return {
      minRange: info.minRange,
      maxRange: info.maxRange,
    };
  }

  private resolveEventPosition(
    event: AudioEventRTS,
  ): readonly [number, number, number] | null {
    if (Array.isArray(event.position)) {
      return event.position;
    }

    if (event.objectId !== undefined && this.objectPositionResolver) {
      const objectPosition = this.objectPositionResolver(event.objectId);
      if (objectPosition) {
        return objectPosition;
      }
    }

    if (event.drawableId !== undefined && this.drawablePositionResolver) {
      const drawablePosition = this.drawablePositionResolver(event.drawableId);
      if (drawablePosition) {
        return drawablePosition;
      }
    }

    if (event.playerIndex !== undefined && this.playerPositionResolver) {
      return this.playerPositionResolver(event.playerIndex);
    }

    return null;
  }

  private isInterruptingEvent(info: AudioEventInfo): boolean {
    return ((info.control ?? 0) & AudioControl.AC_INTERRUPT) !== 0;
  }

  private violatesVoice(event: AudioEventRTS, info: AudioEventInfo): boolean {
    if (((info.type ?? 0) & SoundType.ST_VOICE) === 0) {
      return false;
    }

    const objectId = event.objectId;
    // Source behavior from SoundManager::violatesVoice:
    // voice gating requires a non-zero object owner.
    if (objectId === undefined || objectId === 0) {
      return false;
    }

    return this.isObjectPlayingVoice(objectId);
  }

  private isObjectPlayingVoice(objectId: number): boolean {
    for (const active of this.activeAudioEvents.values()) {
      if (active.event.objectId !== objectId) {
        continue;
      }
      if (((active.info.type ?? 0) & SoundType.ST_VOICE) !== 0) {
        return true;
      }
    }

    return false;
  }

  private resolveLimitBucket(
    event: AudioEventRTS,
    info: AudioEventInfo,
  ): AudioLimitBucket {
    switch (info.soundType) {
      case AudioType.AT_Music:
        return 'music';
      case AudioType.AT_Streaming:
        return 'speech';
      case AudioType.AT_SoundEffect:
      default:
        return this.isPositionalSoundEffectEvent(event, info)
          ? 'sound3d'
          : 'sound2d';
    }
  }

  private canAllocateSampleForPlay(pendingEvent: ResolvedAudioEvent): boolean {
    const { event, info } = pendingEvent;
    if (info.soundType === AudioType.AT_Music) {
      return true;
    }

    const bucket = this.resolveLimitBucket(event, info);
    const sampleLimit =
      bucket === 'sound3d'
        ? this.max3DSamples
        : bucket === 'sound2d'
          ? this.max2DSamples
          : bucket === 'speech'
            ? this.maxStreams
          : 0;
    if (bucket !== 'sound2d' && bucket !== 'sound3d' && bucket !== 'speech') {
      return true;
    }
    if (sampleLimit <= 0) {
      return false;
    }

    if (this.countActiveByBucket(bucket) < sampleLimit) {
      return true;
    }

    // Source behavior from MilesAudioManager::killLowestPrioritySoundImmediately:
    // when sample pools are saturated, lower-priority active audio in the same
    // dimensional bucket can be replaced.
    const handleToKill = this.findLowestPriorityHandleForBucket(
      bucket,
      info.priority ?? AudioPriority.AP_NORMAL,
    );
    if (handleToKill !== null) {
      this.stopPlaybackNode(handleToKill);
      this.activeAudioEvents.delete(handleToKill);
      return true;
    }

    if (this.isInterruptingEvent(info)) {
      const matchingHandle = this.findOldestActiveHandle(event.eventName, bucket);
      if (matchingHandle !== null) {
        // Source behavior: interrupt-capable sounds can replace oldest active
        // matching sample in the same dimensional bucket.
        this.stopPlaybackNode(matchingHandle);
        this.activeAudioEvents.delete(matchingHandle);
        return true;
      }
    }

    return false;
  }

  private countActiveByBucket(bucket: AudioLimitBucket): number {
    let count = 0;
    for (const active of this.activeAudioEvents.values()) {
      if (this.resolveLimitBucket(active.event, active.info) !== bucket) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  private findLowestPriorityHandleForBucket(
    bucket: AudioLimitBucket,
    incomingPriority: AudioPriority,
  ): AudioHandle | null {
    if (incomingPriority === AudioPriority.AP_LOWEST) {
      return null;
    }

    let lowestPriorityHandle: AudioHandle | null = null;
    let lowestPriority: AudioPriority = incomingPriority;
    for (const active of this.activeAudioEvents.values()) {
      if (this.resolveLimitBucket(active.event, active.info) !== bucket) {
        continue;
      }
      const activePriority = active.info.priority ?? AudioPriority.AP_NORMAL;
      if (activePriority >= incomingPriority) {
        continue;
      }
      if (
        lowestPriorityHandle === null
        || activePriority < lowestPriority
      ) {
        lowestPriorityHandle = active.handle;
        lowestPriority = activePriority;
        if (lowestPriority === AudioPriority.AP_LOWEST) {
          return lowestPriorityHandle;
        }
      }
    }

    return lowestPriorityHandle;
  }

  private evaluateLimitDecision(
    event: AudioEventRTS,
    info: AudioEventInfo,
  ): AudioLimitDecision {
    const limit = info.limit ?? 0;
    if (limit <= 0) {
      return { allow: true };
    }

    const bucket = this.resolveLimitBucket(event, info);
    const queuedCount = this.countQueuedPlayRequests(event.eventName, bucket);
    const activeCount = this.countActiveEvents(event.eventName, bucket);
    const totalCount = queuedCount + activeCount;
    const isInterrupting = this.isInterruptingEvent(info);

    // Source behavior from MilesAudioManager::doesViolateLimit:
    // interrupting sounds can replace the oldest active match when current-frame
    // queued requests have not already consumed the full limit.
    if (isInterrupting && queuedCount < limit) {
      if (totalCount < limit) {
        return { allow: true };
      }

      const oldestActiveHandle = this.findOldestActiveHandle(event.eventName, bucket);
      if (oldestActiveHandle !== null) {
        return {
          allow: true,
          handleToKill: oldestActiveHandle,
        };
      }
    }

    return {
      allow: totalCount < limit,
    };
  }

  private countQueuedPlayRequests(
    eventName: string,
    bucket: AudioLimitBucket,
  ): number {
    let count = 0;
    for (const request of this.audioRequests) {
      if (request.request !== RequestType.AR_Play || !request.pendingEvent) {
        continue;
      }
      if (request.pendingEvent.event.eventName !== eventName) {
        continue;
      }
      if (this.resolveLimitBucket(request.pendingEvent.event, request.pendingEvent.info) !== bucket) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  private countActiveEvents(eventName: string, bucket: AudioLimitBucket): number {
    let count = 0;
    for (const active of this.activeAudioEvents.values()) {
      if (active.event.eventName !== eventName) {
        continue;
      }
      if (this.resolveLimitBucket(active.event, active.info) !== bucket) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  private findOldestActiveHandle(
    eventName: string,
    bucket: AudioLimitBucket,
  ): AudioHandle | null {
    for (const active of this.activeAudioEvents.values()) {
      if (active.event.eventName !== eventName) {
        continue;
      }
      if (this.resolveLimitBucket(active.event, active.info) !== bucket) {
        continue;
      }
      return active.handle;
    }
    return null;
  }

  private shouldPlayLocally(event: AudioEventRTS, info: AudioEventInfo): boolean {
    if (info.soundType === AudioType.AT_Music) {
      return true;
    }

    const soundTypeMask = info.type ?? 0;
    if ((soundTypeMask & PLAYER_RESTRICTED_SOUND_MASK) === 0) {
      // Source fallback: unspecified player filters are treated as globally audible.
      return true;
    }

    if ((soundTypeMask & SoundType.ST_EVERYONE) !== 0) {
      return true;
    }

    if (
      (soundTypeMask & SoundType.ST_PLAYER) !== 0 &&
      (soundTypeMask & SoundType.ST_UI) !== 0 &&
      event.playerIndex === undefined
    ) {
      // Source behavior: UI sounds scoped to player can still play when no owner
      // player is provided.
      return true;
    }

    if (event.playerIndex === undefined || this.localPlayerIndex === null) {
      return false;
    }

    const relationship = this.resolvePlayerRelationship(
      event.playerIndex,
      this.localPlayerIndex,
    );

    // Source behavior: player ownership filters are OR'ed; composite bitmasks can
    // target multiple audiences (for example, PLAYER|ENEMIES).
    let hasScopedAudience = false;
    if ((soundTypeMask & SoundType.ST_PLAYER) !== 0) {
      hasScopedAudience = true;
      if (event.playerIndex === this.localPlayerIndex) {
        return true;
      }
    }

    if ((soundTypeMask & SoundType.ST_ALLIES) !== 0) {
      hasScopedAudience = true;
      // Source behavior: ALLIES does not include the local player themselves.
      if (event.playerIndex !== this.localPlayerIndex && relationship === 'allies') {
        return true;
      }
    }

    if ((soundTypeMask & SoundType.ST_ENEMIES) !== 0) {
      hasScopedAudience = true;
      if (relationship === 'enemies') {
        return true;
      }
    }

    return hasScopedAudience ? false : true;
  }

  private resolvePlayerRelationship(
    owningPlayerIndex: number,
    localPlayerIndex: number,
  ): AudioPlayerRelationship {
    if (this.relationshipResolver) {
      return this.relationshipResolver(owningPlayerIndex, localPlayerIndex);
    }

    const relationshipOverride = this.playerRelationshipOverrides.get(
      this.playerRelationshipKey(owningPlayerIndex, localPlayerIndex),
    );
    if (relationshipOverride) {
      return relationshipOverride;
    }

    const reverseOverride = this.playerRelationshipOverrides.get(
      this.playerRelationshipKey(localPlayerIndex, owningPlayerIndex),
    );
    if (reverseOverride) {
      return reverseOverride;
    }

    if (owningPlayerIndex === localPlayerIndex) {
      return 'allies';
    }

    // Fallback when no runtime relationship graph is wired.
    return 'enemies';
  }

  private playerRelationshipKey(
    owningPlayerIndex: number,
    localPlayerIndex: number,
  ): string {
    return `${owningPlayerIndex}\u0000${localPlayerIndex}`;
  }

  private areAffectsEnabled(affectMask: AudioAffect): boolean {
    for (const affect of AUDIO_AFFECT_CHANNELS) {
      if ((affectMask & affect) !== 0 && !this.audioEnabled[affect]) {
        return false;
      }
    }

    return true;
  }

  private resolveEventVolume(event: AudioEventRTS, info: AudioEventInfo): number {
    const adjusted = this.adjustedVolumes.get(event.eventName);
    if (adjusted !== undefined) {
      return adjusted;
    }

    if (event.volume !== undefined) {
      return clamp01(event.volume);
    }

    return clamp01(info.volume ?? 1);
  }

  private stopByAffect(whichToAffect: AudioAffect): void {
    for (const active of [...this.activeAudioEvents.values()]) {
      if ((active.affectMask & whichToAffect) !== 0) {
        this.removeAudioEvent(active.handle);
      }
    }
  }

  private pauseByAffect(whichToAffect: AudioAffect): void {
    for (const active of [...this.activeAudioEvents.values()]) {
      if ((active.affectMask & whichToAffect) !== 0) {
        const request = this.allocateAudioRequest(false);
        request.request = RequestType.AR_Pause;
        request.handleToInteractOn = active.handle;
        this.appendAudioRequest(request);
      }
    }
  }

  private startMusicTrack(trackName: string): void {
    this.stopMusicTrack();
    this.addAudioEvent({
      eventName: trackName,
      audioAffect: AudioAffect.AudioAffect_Music,
    });
  }

  private stopMusicTrack(): void {
    this.stopByAffect(AudioAffect.AudioAffect_Music);
  }

  private refreshDisallowSpeechFromActiveStreams(): void {
    if (!this.disallowSpeech) {
      return;
    }

    for (const active of this.activeAudioEvents.values()) {
      if (active.info.soundType !== AudioType.AT_Streaming) {
        continue;
      }
      if (active.event.uninterruptable) {
        return;
      }
    }

    this.disallowSpeech = false;
  }

  // ──── Web Audio playback implementation ──────────────────────────────────

  /**
   * Synchronize per-affect GainNode values with current volume settings.
   */
  private syncAffectGainNodes(): void {
    for (const affect of AUDIO_AFFECT_CHANNELS) {
      const gainNode = this.affectGainNodes.get(affect);
      if (!gainNode) {
        continue;
      }

      const enabled = this.audioEnabled[affect];
      const systemVol = this.systemVolumes[affect];
      const scriptVol = this.scriptVolumes[affect];
      gainNode.gain.value = enabled ? clamp01(systemVol * scriptVol) : 0;
    }
  }

  /**
   * Resolve the affect GainNode that an event should route through.
   */
  private resolveAffectGainNode(affectMask: AudioAffect): GainNode | null {
    // Prefer 3D sound node, then regular sound, then music, then speech.
    if ((affectMask & AudioAffect.AudioAffect_Sound3D) !== 0) {
      return this.affectGainNodes.get(AudioAffect.AudioAffect_Sound3D) ?? null;
    }
    if ((affectMask & AudioAffect.AudioAffect_Sound) !== 0) {
      return this.affectGainNodes.get(AudioAffect.AudioAffect_Sound) ?? null;
    }
    if ((affectMask & AudioAffect.AudioAffect_Music) !== 0) {
      return this.affectGainNodes.get(AudioAffect.AudioAffect_Music) ?? null;
    }
    if ((affectMask & AudioAffect.AudioAffect_Speech) !== 0) {
      return this.affectGainNodes.get(AudioAffect.AudioAffect_Speech) ?? null;
    }
    return null;
  }

  /**
   * Start Web Audio playback for an audio event.
   * Source parity: MilesAudioManager::playAudioEvent
   */
  private startPlayback(handle: AudioHandle, resolved: ResolvedAudioEvent): void {
    const ctx = this.context;
    if (!ctx) {
      return;
    }

    const eventName = resolved.event.eventName;
    const buffer = this.audioBufferCache.get(eventName);

    if (!buffer) {
      // Trigger async load if a loader is available.
      if (this.audioBufferLoader && !this.loadingBuffers.has(eventName)) {
        this.loadingBuffers.add(eventName);
        const filename = resolved.info.filename ?? eventName;
        void this.loadAndCacheBuffer(ctx, eventName, filename);
      }
      return;
    }

    this.createAndStartPlaybackNode(ctx, handle, buffer, resolved);
  }

  /**
   * Load audio data asynchronously, decode it, and cache the AudioBuffer.
   */
  private async loadAndCacheBuffer(
    ctx: BrowserAudioContext,
    eventName: string,
    filename: string,
  ): Promise<void> {
    try {
      const data = await this.audioBufferLoader!(filename);
      if (!data) {
        return;
      }
      const audioBuffer = await ctx.decodeAudioData(data);
      this.audioBufferCache.set(eventName, audioBuffer);
    } finally {
      this.loadingBuffers.delete(eventName);
    }
  }

  /**
   * Pre-load an AudioBuffer for a specific event name.
   * Useful for preloading UI sounds or critical game audio.
   */
  preloadAudioBuffer(eventName: string, buffer: AudioBuffer): void {
    this.audioBufferCache.set(eventName, buffer);
  }

  /**
   * Create the Web Audio node chain and start playback.
   */
  private createAndStartPlaybackNode(
    ctx: BrowserAudioContext,
    handle: AudioHandle,
    buffer: AudioBuffer,
    resolved: ResolvedAudioEvent,
  ): void {
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;

    // Loop control.
    const hasLoopControl = ((resolved.info.control ?? 0) & AudioControl.AC_LOOP) !== 0;
    const loopCount = normalizeNonNegativeInteger(resolved.info.loopCount, 1);
    const isInfiniteLoop = hasLoopControl && loopCount === 0;
    // Source parity: AudioEventRTS loopCount semantics are total play count (0 = forever).
    sourceNode.loop = hasLoopControl && (isInfiniteLoop || loopCount > 1);
    if (hasLoopControl && loopCount > 1 && Number.isFinite(buffer.duration) && buffer.duration > 0) {
      sourceNode.stop(ctx.currentTime + (buffer.duration * loopCount));
    }

    // Per-event gain node.
    const gainNode = ctx.createGain();
    gainNode.gain.value = clamp01(resolved.resolvedVolume);

    // 3D positional audio setup.
    let pannerNode: PannerNode | null = null;
    const is3D = (resolved.affectMask & AudioAffect.AudioAffect_Sound3D) !== 0;
    const pos = this.resolveEventPosition(resolved.event);

    if (is3D && pos) {
      pannerNode = ctx.createPanner();
      pannerNode.panningModel = 'HRTF';
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = resolved.info.minRange ?? 10;
      pannerNode.maxDistance = resolved.info.maxRange ?? 1000;
      pannerNode.rolloffFactor = 1;
      pannerNode.setPosition(pos[0], pos[1], pos[2]);

      // Chain: source → gain → panner → affect gain.
      sourceNode.connect(gainNode);
      gainNode.connect(pannerNode);
      const affectGain = this.resolveAffectGainNode(resolved.affectMask);
      if (affectGain) {
        pannerNode.connect(affectGain);
      }
    } else {
      // 2D audio: source → gain → affect gain.
      sourceNode.connect(gainNode);
      const affectGain = this.resolveAffectGainNode(resolved.affectMask);
      if (affectGain) {
        gainNode.connect(affectGain);
      }
    }

    // Auto-remove when playback ends.
    sourceNode.onended = () => {
      this.playbackNodes.delete(handle);
      this.activeAudioEvents.delete(handle);
      this.refreshDisallowSpeechFromActiveStreams();
    };

    if (
      resolved.info.soundType === AudioType.AT_Streaming
      && resolved.event.uninterruptable
    ) {
      this.disallowSpeech = true;
    }

    sourceNode.start();

    this.playbackNodes.set(handle, {
      sourceNode,
      gainNode,
      pannerNode,
      started: true,
    });
  }

  /**
   * Stop a specific playback node.
   */
  private stopPlaybackNode(handle: AudioHandle): void {
    const node = this.playbackNodes.get(handle);
    if (node?.started) {
      try {
        node.sourceNode.stop();
      } catch {
        // Already stopped.
      }
      node.sourceNode.disconnect();
      node.gainNode.disconnect();
      if (node.pannerNode) {
        node.pannerNode.disconnect();
      }
    }
    this.playbackNodes.delete(handle);
    this.activeAudioEvents.delete(handle);
    this.refreshDisallowSpeechFromActiveStreams();
  }

  /**
   * Stop all active playback nodes.
   */
  private stopAllPlaybackNodes(): void {
    for (const [handle] of this.playbackNodes) {
      this.stopPlaybackNode(handle);
    }
  }

  /**
   * Update positional audio for active 3D playback nodes.
   * Called from refreshActivePositionalAudio to keep panner positions in sync.
   */
  private updatePlaybackNodePositions(): void {
    for (const [handle, node] of this.playbackNodes) {
      if (!node.pannerNode) {
        continue;
      }

      const active = this.activeAudioEvents.get(handle);
      if (!active) {
        continue;
      }

      // Resolve current position from event's object/drawable.
      const pos = this.resolveEventPosition(active.event);
      if (pos) {
        node.pannerNode.setPosition(pos[0], pos[1], pos[2]);
      }

      // Sync volume.
      node.gainNode.gain.value = clamp01(active.resolvedVolume);
    }
  }
}

export function initializeAudioContext(): void {
  if (!sharedAudioContext) {
    getOrCreateAudioContext();
  }
}

export type AudioHandle = number;

export interface AudioEventInfo {
  audioName: string;
  filename?: string;
  soundType?: AudioType;
  priority?: AudioPriority;
  type?: number;
  control?: number;
  /** Source parity: AudioEventInfo::m_loopCount (0 = loop forever, >0 = total play count). */
  loopCount?: number;
  volume?: number;
  minVolume?: number;
  limit?: number;
  minRange?: number;
  maxRange?: number;
}

export interface AudioEventRTS {
  eventName: string;
  position?: readonly [number, number, number];
  objectId?: number;
  drawableId?: number;
  volume?: number;
  audioAffect?: AudioAffect;
  playerIndex?: number;
  uninterruptable?: boolean;
}

/**
 * Callback to load raw audio file data by filename/event name.
 * Returns an ArrayBuffer suitable for Web Audio decodeAudioData(),
 * or null if the audio file isn't available.
 */
export type AudioBufferLoader = (filename: string) => Promise<ArrayBuffer | null>;

export interface AudioManagerOptions {
  debugLabel?: string;
  musicTracks?: string[];
  context?: BrowserAudioContext | null;
  eventInfos?: readonly AudioEventInfo[];
  localPlayerIndex?: number | null;
  sampleCount2D?: number;
  sampleCount3D?: number;
  streamCount?: number;
  minSampleVolume?: number;
  globalMinRange?: number;
  globalMaxRange?: number;
  resolvePlayerRelationship?: AudioPlayerRelationshipResolver;
  resolveObjectPosition?: AudioObjectPositionResolver;
  resolveDrawablePosition?: AudioDrawablePositionResolver;
  resolvePlayerPosition?: AudioPlayerPositionResolver;
  resolveShroudVisibility?: AudioShroudVisibilityResolver;
  preferred3DProvider?: string | null;
  preferredSpeakerType?: string | null;
  /** Optional callback to load raw audio file data for playback. */
  audioBufferLoader?: AudioBufferLoader;
}
