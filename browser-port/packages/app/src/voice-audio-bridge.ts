/**
 * Unit voice response bridge — plays voice lines when units are selected,
 * given move/attack/guard commands, etc.
 *
 * Source parity: CommandXlat.cpp selects the appropriate AudioEventRTS from
 * the ThingTemplate's audio array (VoiceSelect, VoiceMove, VoiceAttack, etc.)
 * and plays it through TheAudio. Only one voice plays at a time for the
 * primary selected unit; group selection plays one voice for the whole group.
 */

import type { IniDataRegistry, ObjectDef } from '@generals/ini-data';

/** Minimal AudioManager interface for voice playback. */
export interface VoiceAudioManager {
  addAudioEvent(eventName: string, position?: readonly [number, number, number]): number;
  removeAudioEvent(handle: number): void;
}

/** Minimal game-logic interface for entity lookup. */
export interface VoiceGameLogic {
  getEntityState(id: number): { x: number; y: number; z: number; templateName: string } | null;
}

export type VoiceEventType =
  | 'select'
  | 'selectElite'
  | 'move'
  | 'attack'
  | 'attackSpecial'
  | 'attackAir'
  | 'guard'
  | 'fear'
  | 'enter'
  | 'garrison'
  | 'created'
  | 'taskComplete'
  | 'taskUnable';

/** Maps VoiceEventType to the INI field name on Object definitions. */
const VOICE_FIELD_MAP: Record<VoiceEventType, string> = {
  select: 'VoiceSelect',
  selectElite: 'VoiceSelectElite',
  move: 'VoiceMove',
  attack: 'VoiceAttack',
  attackSpecial: 'VoiceAttackSpecial',
  attackAir: 'VoiceAttackAir',
  guard: 'VoiceGuard',
  fear: 'VoiceFear',
  enter: 'VoiceEnter',
  garrison: 'VoiceGarrison',
  created: 'VoiceCreated',
  taskComplete: 'VoiceTaskComplete',
  taskUnable: 'VoiceTaskUnable',
};

/** Minimum interval (ms) between voice lines to avoid spam. */
const VOICE_COOLDOWN_MS = 400;

export class VoiceAudioBridge {
  private readonly registry: IniDataRegistry;
  private readonly audioManager: VoiceAudioManager;
  private readonly gameLogic: VoiceGameLogic;

  /** Cache of template name → voice event name lookups. */
  private readonly voiceCache = new Map<string, string | null>();
  /** Handle of the currently playing voice, if any. */
  private currentVoiceHandle = 0;
  /** Timestamp of last voice play to enforce cooldown. */
  private lastVoiceTime = -VOICE_COOLDOWN_MS;

  constructor(
    registry: IniDataRegistry,
    audioManager: VoiceAudioManager,
    gameLogic: VoiceGameLogic,
  ) {
    this.registry = registry;
    this.audioManager = audioManager;
    this.gameLogic = gameLogic;
  }

  /**
   * Play a voice line for the given entity on the given voice event.
   * If a voice is already playing, it will be replaced.
   * Returns true if a voice was played.
   */
  playVoice(entityId: number, voiceType: VoiceEventType): boolean {
    const now = performance.now();
    if (now - this.lastVoiceTime < VOICE_COOLDOWN_MS) {
      return false;
    }

    const state = this.gameLogic.getEntityState(entityId);
    if (!state) return false;

    const eventName = this.resolveVoiceEventName(state.templateName, voiceType);
    if (!eventName) return false;

    // Stop current voice if playing.
    if (this.currentVoiceHandle > 0) {
      this.audioManager.removeAudioEvent(this.currentVoiceHandle);
    }

    this.currentVoiceHandle = this.audioManager.addAudioEvent(
      eventName,
      [state.x, state.y, state.z],
    );
    this.lastVoiceTime = now;
    return this.currentVoiceHandle > 0;
  }

  /**
   * Play a voice for a group command or selection.
   * Source parity: InGameUI.cpp plays one voice for group select, not N voices.
   * For selection, uses the first entity (deterministic, matching C++).
   * For command voices (move, attack, guard, etc.), picks a random entity from
   * the group for variety — the C++ list order effectively varies because of
   * selection-order differences, so randomization is the faithful approximation.
   */
  playGroupVoice(entityIds: readonly number[], voiceType: VoiceEventType): boolean {
    if (entityIds.length === 0) return false;
    if (voiceType === 'select' || voiceType === 'selectElite' || entityIds.length === 1) {
      return this.playVoice(entityIds[0]!, voiceType);
    }
    const randomIndex = Math.floor(Math.random() * entityIds.length);
    return this.playVoice(entityIds[randomIndex]!, voiceType);
  }

  /**
   * Resolve the AudioEvent name for a template + voice type.
   * Caches lookups for performance.
   */
  private resolveVoiceEventName(
    templateName: string,
    voiceType: VoiceEventType,
  ): string | null {
    const cacheKey = `${templateName}:${voiceType}`;
    const cached = this.voiceCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const fieldName = VOICE_FIELD_MAP[voiceType];
    const objectDef = this.registry.getObject(templateName);
    const eventName = resolveVoiceField(objectDef, fieldName, this.registry);

    this.voiceCache.set(cacheKey, eventName);
    return eventName;
  }

  dispose(): void {
    this.voiceCache.clear();
    if (this.currentVoiceHandle > 0) {
      this.audioManager.removeAudioEvent(this.currentVoiceHandle);
      this.currentVoiceHandle = 0;
    }
  }
}

/**
 * Look up a voice field on an ObjectDef, walking parent chain if needed.
 */
function resolveVoiceField(
  objectDef: ObjectDef | undefined,
  fieldName: string,
  registry: IniDataRegistry,
): string | null {
  let current = objectDef;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.name)) break; // Cycle guard.
    visited.add(current.name);
    const value = current.fields[fieldName];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (current.parent) {
      current = registry.getObject(current.parent);
    } else {
      break;
    }
  }
  return null;
}
