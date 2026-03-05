import {
  AudioControl,
  AudioPriority,
  AudioHandleSpecialValues,
  type AudioEventInfo,
  type AudioEventRTS,
  type AudioHandle,
} from '@generals/audio';

import type { ScriptObjectAmbientSoundState } from '@generals/game-logic';

interface AmbientPlaybackState {
  audioName: string;
  handle: AudioHandle | null;
  toggleRevision: number;
}

export interface ScriptObjectAmbientAudioRuntimeGameLogic {
  getScriptObjectAmbientSoundStates(): ScriptObjectAmbientSoundState[];
}

export interface ScriptObjectAmbientAudioRuntimeAudioManager {
  addAudioEvent(event: AudioEventRTS): AudioHandle;
  addAudioEventInfo(eventInfo: AudioEventInfo): void;
  findAudioEventInfo(eventName: string): AudioEventInfo | null;
  removeAudioEvent(audioEvent: AudioHandle | string): void;
  isCurrentlyPlaying(handle: AudioHandle): boolean;
}

export interface ScriptObjectAmbientAudioRuntimeBridge {
  syncAfterSimulationStep(): void;
}

export interface CreateScriptObjectAmbientAudioRuntimeBridgeOptions {
  gameLogic: ScriptObjectAmbientAudioRuntimeGameLogic;
  audioManager: ScriptObjectAmbientAudioRuntimeAudioManager;
}

function asPlayableHandle(handle: AudioHandle): AudioHandle | null {
  return handle >= AudioHandleSpecialValues.AHSV_FirstHandle ? handle : null;
}

function stopPlayback(
  audioManager: ScriptObjectAmbientAudioRuntimeAudioManager,
  state: AmbientPlaybackState,
): void {
  if (state.handle !== null) {
    audioManager.removeAudioEvent(state.handle);
    state.handle = null;
  }
}

function resolvePriorityByName(priorityName: string): AudioPriority | null {
  switch (priorityName.trim().toUpperCase()) {
    case 'LOWEST':
      return AudioPriority.AP_LOWEST;
    case 'LOW':
      return AudioPriority.AP_LOW;
    case 'NORMAL':
      return AudioPriority.AP_NORMAL;
    case 'HIGH':
      return AudioPriority.AP_HIGH;
    case 'CRITICAL':
      return AudioPriority.AP_CRITICAL;
    default:
      return null;
  }
}

function registerCustomAudioEventInfoIfNeeded(
  audioManager: ScriptObjectAmbientAudioRuntimeAudioManager,
  ambientState: ScriptObjectAmbientSoundState,
): void {
  const customAudioDefinition = ambientState.customAudioDefinition;
  if (!customAudioDefinition) {
    return;
  }
  const customAudioName = ambientState.audioName;
  if (!customAudioName.trim()) {
    return;
  }
  if (audioManager.findAudioEventInfo(customAudioName)) {
    return;
  }

  const sourceAudioName = customAudioDefinition.sourceAudioName.trim();
  if (!sourceAudioName) {
    return;
  }
  const sourceInfo = audioManager.findAudioEventInfo(sourceAudioName);
  if (!sourceInfo) {
    return;
  }

  let control = sourceInfo.control ?? 0;
  if (customAudioDefinition.loopingOverride === true) {
    control |= AudioControl.AC_LOOP;
  } else if (customAudioDefinition.loopingOverride === false) {
    control &= ~AudioControl.AC_LOOP;
  }

  const nextInfo: AudioEventInfo = {
    ...sourceInfo,
    audioName: customAudioName,
    control,
  };

  if (Number.isFinite(customAudioDefinition.volumeOverride)) {
    nextInfo.volume = customAudioDefinition.volumeOverride;
  }
  if (Number.isFinite(customAudioDefinition.minVolumeOverride)) {
    nextInfo.minVolume = customAudioDefinition.minVolumeOverride;
  }
  if (Number.isFinite(customAudioDefinition.minRangeOverride)) {
    nextInfo.minRange = customAudioDefinition.minRangeOverride;
  }
  if (Number.isFinite(customAudioDefinition.maxRangeOverride)) {
    nextInfo.maxRange = customAudioDefinition.maxRangeOverride;
  }
  if (customAudioDefinition.priorityNameOverride) {
    const mappedPriority = resolvePriorityByName(customAudioDefinition.priorityNameOverride);
    if (mappedPriority !== null) {
      nextInfo.priority = mappedPriority;
    }
  }
  const loopCountOverride = customAudioDefinition.loopCountOverride;
  if (typeof loopCountOverride === 'number' && Number.isFinite(loopCountOverride)) {
    nextInfo.loopCount = Math.max(0, Math.trunc(loopCountOverride));
  }
  audioManager.addAudioEventInfo(nextInfo);
}

export function createScriptObjectAmbientAudioRuntimeBridge(
  options: CreateScriptObjectAmbientAudioRuntimeBridgeOptions,
): ScriptObjectAmbientAudioRuntimeBridge {
  const { gameLogic, audioManager } = options;
  const playbackByEntityId = new Map<number, AmbientPlaybackState>();

  return {
    syncAfterSimulationStep(): void {
      const ambientStates = gameLogic.getScriptObjectAmbientSoundStates();
      const seenEntityIds = new Set<number>();

      for (const ambientState of ambientStates) {
        if (!Number.isFinite(ambientState.entityId)) {
          continue;
        }
        const entityId = Math.trunc(ambientState.entityId);
        if (entityId <= 0) {
          continue;
        }

        const audioName = ambientState.audioName;
        if (!audioName.trim()) {
          continue;
        }

        registerCustomAudioEventInfoIfNeeded(audioManager, ambientState);

        seenEntityIds.add(entityId);

        let playback = playbackByEntityId.get(entityId);
        let shouldStartPlayback = false;
        if (!playback) {
          playback = {
            audioName,
            handle: null,
            toggleRevision: Math.trunc(ambientState.toggleRevision),
          };
          playbackByEntityId.set(entityId, playback);
          shouldStartPlayback = ambientState.enabled;
        }

        if (playback.audioName !== audioName) {
          stopPlayback(audioManager, playback);
          playback.audioName = audioName;
          shouldStartPlayback = ambientState.enabled;
        }

        const nextRevision = Math.trunc(ambientState.toggleRevision);
        if (playback.toggleRevision !== nextRevision) {
          playback.toggleRevision = nextRevision;
          if (ambientState.enabled) {
            // Source parity: repeated enable requests can retrigger one-shot ambients.
            stopPlayback(audioManager, playback);
            shouldStartPlayback = true;
          } else {
            stopPlayback(audioManager, playback);
          }
        }

        if (!ambientState.enabled) {
          stopPlayback(audioManager, playback);
          continue;
        }

        if (playback.handle !== null && !audioManager.isCurrentlyPlaying(playback.handle)) {
          playback.handle = null;
        }

        if (shouldStartPlayback) {
          playback.handle = asPlayableHandle(audioManager.addAudioEvent({
            eventName: playback.audioName,
            objectId: entityId,
          }));
        }
      }

      for (const [entityId, playback] of playbackByEntityId) {
        if (seenEntityIds.has(entityId)) {
          continue;
        }
        stopPlayback(audioManager, playback);
        playbackByEntityId.delete(entityId);
      }
    },
  };
}
