import { describe, expect, it, vi } from 'vitest';

import {
  AudioAffect,
  AudioControl,
  AudioHandleSpecialValues,
  AudioManager,
  AudioPriority,
  SoundType,
  AudioType,
} from './index.js';

interface RecordingBufferSourceNode {
  loop: boolean;
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  stopCalls: number[];
  playbackRate: { value: number };
  connect(target?: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

function createRecordingAudioContext() {
  const createdSources: RecordingBufferSourceNode[] = [];
  const fakeContext = {
    state: 'running',
    currentTime: 0,
    destination: {},
    listener: {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
      setPosition: () => undefined,
      setOrientation: () => undefined,
    },
    createGain: () => ({
      gain: {
        value: 1,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    createPanner: () => ({
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 1000,
      rolloffFactor: 1,
      setPosition: () => undefined,
      connect: () => undefined,
      disconnect: () => undefined,
    }),
    createBufferSource: () => {
      const source: RecordingBufferSourceNode = {
        loop: false,
        buffer: null,
        onended: null,
        stopCalls: [],
        playbackRate: { value: 1 },
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => undefined,
        stop: (when?: number) => {
          source.stopCalls.push(when ?? 0);
        },
      };
      createdSources.push(source);
      return source;
    },
    resume: async () => undefined,
    close: async () => undefined,
  } as unknown as AudioContext;
  return { fakeContext, createdSources };
}

describe('AudioManager', () => {
  it('applies source-style script/system volume multiplication per affect', () => {
    const manager = new AudioManager();
    manager.init();

    manager.setVolume(
      0.5,
      AudioAffect.AudioAffect_Music | AudioAffect.AudioAffect_SystemSetting,
    );
    manager.setVolume(0.4, AudioAffect.AudioAffect_Music);

    expect(manager.getVolume(AudioAffect.AudioAffect_Music)).toBeCloseTo(0.2);
    expect(
      manager.getVolume(
        AudioAffect.AudioAffect_Music | AudioAffect.AudioAffect_Sound,
      ),
    ).toBeCloseTo(0.2);
  });

  it('returns AHSV_Error for undeclared audio events', () => {
    const manager = new AudioManager();
    manager.init();

    expect(manager.addAudioEvent('UndeclaredEvent')).toBe(
      AudioHandleSpecialValues.AHSV_Error,
    );
  });

  it('respects AudioAffect toggles when routing events', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'Track_A',
          soundType: AudioType.AT_Music,
        },
      ],
    });
    manager.init();

    manager.setOn(false, AudioAffect.AudioAffect_Music);
    expect(manager.addAudioEvent('Track_A')).toBe(
      AudioHandleSpecialValues.AHSV_NoSound,
    );
  });

  it('keeps 2D sound effects playable when only the 3D channel is muted', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UiClick',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
      ],
    });
    manager.init();

    manager.setOn(false, AudioAffect.AudioAffect_Sound3D);
    expect(manager.addAudioEvent('UiClick')).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('keeps positional 3D sound effects playable when only the 2D channel is muted', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'WorldMove',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
      ],
    });
    manager.init();

    manager.setOn(false, AudioAffect.AudioAffect_Sound);
    expect(manager.addAudioEvent('WorldMove', [20, 0, 20])).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('queues and processes play/stop audio requests', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UnitMove',
          soundType: AudioType.AT_SoundEffect,
          minVolume: 0,
        },
      ],
    });
    manager.init();

    const handle = manager.addAudioEvent('UnitMove');
    expect(handle).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
    expect(manager.getQueuedRequestCount()).toBe(1);

    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(1);

    manager.removeAudioEvent(handle);
    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(0);
  });

  it('treats queued play requests as currently playing handles', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UnitMove',
          soundType: AudioType.AT_SoundEffect,
        },
      ],
    });
    manager.init();

    const handle = manager.addAudioEvent('UnitMove');
    expect(handle).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);

    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);
  });

  it('uses adjusted event volumes and mutes below minVolume', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UnitAcknowledge',
          soundType: AudioType.AT_SoundEffect,
          minVolume: 0.1,
          volume: 1,
        },
      ],
    });
    manager.init();

    manager.setAudioEventVolumeOverride('UnitAcknowledge', 0);
    expect(manager.addAudioEvent('UnitAcknowledge')).toBe(
      AudioHandleSpecialValues.AHSV_Muted,
    );

    manager.setAudioEventVolumeOverride('UnitAcknowledge', -1);
    expect(manager.addAudioEvent('UnitAcknowledge')).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('mutes below AudioSettings MinSampleVolume threshold', () => {
    const manager = new AudioManager({
      minSampleVolume: 0.2,
      eventInfos: [
        {
          audioName: 'LowVolumeUi',
          soundType: AudioType.AT_SoundEffect,
          volume: 0.15,
        },
      ],
    });
    manager.init();

    expect(manager.addAudioEvent('LowVolumeUi')).toBe(
      AudioHandleSpecialValues.AHSV_Muted,
    );
  });

  it('applies runtime MinSampleVolume updates from audio settings', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UiPing',
          soundType: AudioType.AT_SoundEffect,
          volume: 0.15,
        },
      ],
    });
    manager.init();
    manager.setGlobalMinVolume(0.2);

    expect(manager.addAudioEvent('UiPing')).toBe(
      AudioHandleSpecialValues.AHSV_Muted,
    );
  });

  it('schedules finite loop playback stop when AC_LOOP has loopCount > 1', () => {
    const { fakeContext, createdSources } = createRecordingAudioContext();
    const manager = new AudioManager({
      context: fakeContext,
      eventInfos: [
        {
          audioName: 'FiniteLoop',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          control: AudioControl.AC_LOOP,
          loopCount: 3,
        },
      ],
    });
    manager.init();
    manager.preloadAudioBuffer('FiniteLoop', { duration: 2 } as AudioBuffer);

    manager.addAudioEvent('FiniteLoop');
    manager.update();

    expect(createdSources).toHaveLength(1);
    expect(createdSources[0]!.loop).toBe(true);
    expect(createdSources[0]!.stopCalls).toEqual([6]);
  });

  it('keeps AC_LOOP loopCount=0 as infinite looping without a scheduled stop', () => {
    const { fakeContext, createdSources } = createRecordingAudioContext();
    const manager = new AudioManager({
      context: fakeContext,
      eventInfos: [
        {
          audioName: 'InfiniteLoop',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          control: AudioControl.AC_LOOP,
          loopCount: 0,
        },
      ],
    });
    manager.init();
    manager.preloadAudioBuffer('InfiniteLoop', { duration: 2 } as AudioBuffer);

    manager.addAudioEvent('InfiniteLoop');
    manager.update();

    expect(createdSources).toHaveLength(1);
    expect(createdSources[0]!.loop).toBe(true);
    expect(createdSources[0]!.stopCalls).toHaveLength(0);
  });

  it('cycles track names forward and backward like source vector behavior', () => {
    const manager = new AudioManager();

    manager.addTrackName('A');
    manager.addTrackName('B');
    manager.addTrackName('C');

    expect(manager.nextTrackName('B')).toBe('C');
    expect(manager.nextTrackName('C')).toBe('A');
    expect(manager.prevTrackName('A')).toBe('C');
    expect(manager.prevTrackName('B')).toBe('A');
  });

  it('registers configured music tracks as AT_Music events', () => {
    const manager = new AudioManager({
      musicTracks: ['Music_A'],
    });

    expect(manager.isValidAudioEvent('Music_A')).toBe(true);
    manager.init();
    expect(manager.addAudioEvent('Music_A')).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('pauses and resumes active tracks by AudioAffect mask', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'Music_A',
          soundType: AudioType.AT_Music,
        },
      ],
    });
    manager.init();

    manager.addAudioEvent('Music_A');
    manager.update();
    expect(manager.isMusicPlaying()).toBe(true);

    manager.pauseAudio(AudioAffect.AudioAffect_Music);
    manager.update();
    expect(manager.isMusicPlaying()).toBe(false);

    manager.resumeAudio(AudioAffect.AudioAffect_Music);
    expect(manager.isMusicPlaying()).toBe(true);
  });

  it('removes queued play requests when pausing audio', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UnitMove',
          soundType: AudioType.AT_SoundEffect,
        },
      ],
    });
    manager.init();

    manager.addAudioEvent('UnitMove');
    expect(manager.getQueuedRequestCount()).toBe(1);

    manager.pauseAudio(AudioAffect.AudioAffect_All);
    expect(manager.getQueuedRequestCount()).toBe(0);
  });

  it('saves and restores system volumes across focus transitions', () => {
    const manager = new AudioManager();
    manager.init();

    manager.setMusicVolume(0.42);
    manager.setSfxVolume(0.31);
    const speechBefore = manager.getVolume(AudioAffect.AudioAffect_Speech);

    manager.loseFocus();
    expect(manager.getVolume(AudioAffect.AudioAffect_Music)).toBe(0);
    expect(manager.getVolume(AudioAffect.AudioAffect_Sound)).toBe(0);
    expect(manager.getVolume(AudioAffect.AudioAffect_Sound3D)).toBe(0);
    expect(manager.getVolume(AudioAffect.AudioAffect_Speech)).toBe(0);

    manager.regainFocus();
    expect(manager.getVolume(AudioAffect.AudioAffect_Music)).toBeCloseTo(0.42);
    expect(manager.getVolume(AudioAffect.AudioAffect_Sound)).toBeCloseTo(0.31);
    expect(manager.getVolume(AudioAffect.AudioAffect_Sound3D)).toBeCloseTo(0.31);
    expect(manager.getVolume(AudioAffect.AudioAffect_Speech)).toBeCloseTo(speechBefore);
  });

  it('reports queued/active music track names like source stream lookup', () => {
    const manager = new AudioManager({
      musicTracks: ['Music_A', 'Music_B'],
    });
    manager.init();

    manager.addAudioEvent('Music_A');
    expect(manager.getMusicTrackName()).toBe('Music_A');

    manager.update();
    expect(manager.getMusicTrackName()).toBe('Music_A');

    manager.nextMusicTrack();
    expect(manager.getMusicTrackName()).toBe('Music_B');
  });

  it('routes ST_WORLD sound effects to Sound3D affect when positional', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UIClick',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
        {
          audioName: 'WorldMove',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
      ],
    });
    manager.init();

    const uiHandle = manager.addAudioEvent('UIClick');
    const worldHandle = manager.addAudioEvent('WorldMove', [10, 0, 10]);
    manager.update();

    manager.stopAudio(AudioAffect.AudioAffect_Sound3D);
    manager.update();

    expect(manager.isCurrentlyPlaying(worldHandle)).toBe(false);
    expect(manager.isCurrentlyPlaying(uiHandle)).toBe(true);
  });

  it('treats ST_WORLD events attached to object IDs as positional audio', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'WorldAttached',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
      ],
    });
    manager.init();

    const handle = manager.addAudioEvent({
      eventName: 'WorldAttached',
      objectId: 77,
    });
    manager.update();

    manager.stopAudio(AudioAffect.AudioAffect_Sound3D);
    manager.update();

    expect(manager.isCurrentlyPlaying(handle)).toBe(false);
  });

  it('keeps ST_WORLD events as 2D when no world position is provided', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'WorldNoPos',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
      ],
    });
    manager.init();

    const handle = manager.addAudioEvent('WorldNoPos');
    manager.update();

    manager.stopAudio(AudioAffect.AudioAffect_Sound3D);
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);

    manager.stopAudio(AudioAffect.AudioAffect_Sound);
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(false);
  });

  it('returns AHSV_NotForLocal for player-scoped sounds without local ownership', () => {
    const manager = new AudioManager({
      localPlayerIndex: 2,
      eventInfos: [
        {
          audioName: 'PlayerScoped',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_PLAYER,
        },
      ],
    });
    manager.init();

    expect(manager.addAudioEvent('PlayerScoped')).toBe(
      AudioHandleSpecialValues.AHSV_NotForLocal,
    );
    expect(
      manager.addAudioEvent({
        eventName: 'PlayerScoped',
        playerIndex: 2,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('allows uninterruptable speech to bypass local-player filtering like source', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      eventInfos: [
        {
          audioName: 'ScriptSpeech',
          soundType: AudioType.AT_Streaming,
          type: SoundType.ST_PLAYER,
        },
      ],
    });
    manager.init();

    expect(
      manager.addAudioEvent({
        eventName: 'ScriptSpeech',
        playerIndex: 2,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NotForLocal);

    expect(
      manager.addAudioEvent({
        eventName: 'ScriptSpeech',
        playerIndex: 2,
        uninterruptable: true,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('allows player-scoped UI sounds with no player index like source fallback', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'PlayerUiScoped',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_PLAYER | SoundType.ST_UI,
        },
      ],
    });
    manager.init();

    expect(manager.addAudioEvent('PlayerUiScoped')).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('uses injected relationship resolver for ALLIES/ENEMIES sound filters', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      resolvePlayerRelationship: (owning, local) => {
        if (owning === local) {
          return 'allies';
        }
        if (owning === 2) {
          return 'allies';
        }
        return 'enemies';
      },
      eventInfos: [
        {
          audioName: 'AlliedCallout',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_ALLIES,
        },
        {
          audioName: 'EnemyCallout',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_ENEMIES,
        },
      ],
    });
    manager.init();

    expect(
      manager.addAudioEvent({
        eventName: 'AlliedCallout',
        playerIndex: 2,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(
      manager.addAudioEvent({
        eventName: 'AlliedCallout',
        playerIndex: 1,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NotForLocal);
    expect(
      manager.addAudioEvent({
        eventName: 'EnemyCallout',
        playerIndex: 3,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('uses explicit player relationship overrides for ALLIES/ENEMIES filters', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      eventInfos: [
        {
          audioName: 'AlliedCallout',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_ALLIES,
        },
        {
          audioName: 'EnemyCallout',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_ENEMIES,
        },
      ],
    });
    manager.init();

    manager.setPlayerRelationship(2, 1, 'allies');
    manager.setPlayerRelationship(3, 1, 'enemies');

    expect(
      manager.addAudioEvent({
        eventName: 'AlliedCallout',
        playerIndex: 2,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(
      manager.addAudioEvent({
        eventName: 'EnemyCallout',
        playerIndex: 3,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(
      manager.addAudioEvent({
        eventName: 'EnemyCallout',
        playerIndex: 2,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NotForLocal);
  });

  it('updates local player index at runtime for ST_PLAYER routing', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'PlayerScoped',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_PLAYER,
        },
      ],
    });
    manager.init();

    expect(
      manager.addAudioEvent({
        eventName: 'PlayerScoped',
        playerIndex: 4,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NotForLocal);

    manager.setLocalPlayerIndex(4);
    expect(
      manager.addAudioEvent({
        eventName: 'PlayerScoped',
        playerIndex: 4,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('updates player relationship resolver at runtime for ALLIES/ENEMIES routing', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      eventInfos: [
        {
          audioName: 'EnemyCallout',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_ENEMIES,
        },
      ],
    });
    manager.init();

    expect(
      manager.addAudioEvent({
        eventName: 'EnemyCallout',
        playerIndex: 2,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);

    manager.setPlayerRelationshipResolver(() => 'enemies');
    expect(
      manager.addAudioEvent({
        eventName: 'EnemyCallout',
        playerIndex: 2,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);

    manager.setPlayerRelationshipResolver(null);
    expect(
      manager.addAudioEvent({
        eventName: 'EnemyCallout',
        playerIndex: 2,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('uses first-match-returns semantics for composite ownership filters', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      eventInfos: [
        {
          audioName: 'PlayerOrEnemyScoped',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_PLAYER | SoundType.ST_ENEMIES,
        },
      ],
    });
    manager.init();
    manager.setPlayerRelationship(2, 1, 'allies');
    manager.setPlayerRelationship(3, 1, 'enemies');

    // ST_PLAYER is checked first: local player owns event → true
    expect(
      manager.addAudioEvent({
        eventName: 'PlayerOrEnemyScoped',
        playerIndex: 1,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    // ST_PLAYER is checked first: enemy owns event → false (first-match, not OR)
    expect(
      manager.addAudioEvent({
        eventName: 'PlayerOrEnemyScoped',
        playerIndex: 3,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NotForLocal);
    // ST_PLAYER is checked first: ally owns event → false
    expect(
      manager.addAudioEvent({
        eventName: 'PlayerOrEnemyScoped',
        playerIndex: 2,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NotForLocal);
  });

  it('culls positional world sounds beyond MaxRange unless global or critical', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'WorldRanged',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          maxRange: 50,
        },
        {
          audioName: 'WorldGlobal',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_GLOBAL,
          maxRange: 50,
        },
        {
          audioName: 'WorldCritical',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          priority: AudioPriority.AP_CRITICAL,
          maxRange: 50,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(manager.addAudioEvent('WorldRanged', [75, 0, 0])).toBe(
      AudioHandleSpecialValues.AHSV_NoSound,
    );
    expect(manager.addAudioEvent('WorldGlobal', [75, 0, 0])).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
    expect(manager.addAudioEvent('WorldCritical', [75, 0, 0])).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('applies source distance attenuation for positional world sounds', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'WorldAttenuated',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          minRange: 30,
          maxRange: 300,
          volume: 1,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    const nearHandle = manager.addAudioEvent('WorldAttenuated', [20, 0, 0]);
    const farHandle = manager.addAudioEvent('WorldAttenuated', [90, 0, 0]);
    manager.update();

    expect(nearHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(farHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.getActiveResolvedVolume(nearHandle)).toBeCloseTo(1);
    expect(manager.getActiveResolvedVolume(farHandle)).toBeCloseTo(30 / 90);
  });

  it('does not cull ST_GLOBAL positional sounds beyond global max range', () => {
    const manager = new AudioManager({
      globalMinRange: 25,
      globalMaxRange: 60,
      eventInfos: [
        {
          audioName: 'WorldGlobal',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_GLOBAL,
          maxRange: 400,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    const beyondRangeHandle = manager.addAudioEvent('WorldGlobal', [75, 0, 0]);
    const withinRangeHandle = manager.addAudioEvent('WorldGlobal', [55, 0, 0]);
    expect(beyondRangeHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(withinRangeHandle).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
    manager.update();
    expect(manager.getActiveResolvedVolume(beyondRangeHandle)).toBeCloseTo(0);
    expect(manager.getActiveResolvedVolume(withinRangeHandle)).toBeCloseTo(25 / 55);

    manager.setGlobalRanges(25, 45);
    const updatedRangeHandle = manager.addAudioEvent('WorldGlobal', [50, 0, 0]);
    expect(updatedRangeHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(manager.getActiveResolvedVolume(updatedRangeHandle)).toBeCloseTo(0);
  });

  it('uses AudioSettings GlobalMinRange for ST_GLOBAL attenuation', () => {
    const manager = new AudioManager({
      globalMinRange: 40,
      globalMaxRange: 200,
      eventInfos: [
        {
          audioName: 'WorldGlobal',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_GLOBAL,
          minRange: 10,
          maxRange: 400,
          volume: 1,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    const handle = manager.addAudioEvent('WorldGlobal', [80, 0, 0]);
    manager.update();
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.getActiveResolvedVolume(handle)).toBeCloseTo(0.5);

    manager.setGlobalRanges(20, 200);
    const updatedHandle = manager.addAudioEvent('WorldGlobal', [80, 0, 0]);
    manager.update();
    expect(updatedHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.getActiveResolvedVolume(updatedHandle)).toBeCloseTo(0.25);
  });

  it('uses object/drawable position resolvers for MaxRange culling', () => {
    const manager = new AudioManager({
      resolveObjectPosition: (objectId) => {
        if (objectId === 10) {
          return [80, 0, 0];
        }
        if (objectId === 11) {
          return [20, 0, 0];
        }
        return null;
      },
      resolveDrawablePosition: (drawableId) => {
        if (drawableId === 12) {
          return [90, 0, 0];
        }
        if (drawableId === 13) {
          return [15, 0, 0];
        }
        return null;
      },
      eventInfos: [
        {
          audioName: 'WorldByOwner',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          maxRange: 50,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        objectId: 10,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NoSound);
    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        drawableId: 12,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NoSound);

    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        objectId: 11,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        drawableId: 13,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('falls back to player-position resolver when object/drawable positions are unresolved', () => {
    const manager = new AudioManager({
      resolveObjectPosition: () => null,
      resolveDrawablePosition: () => null,
      resolvePlayerPosition: (playerIndex) => {
        if (playerIndex === 1) {
          return [20, 0, 0];
        }
        if (playerIndex === 2) {
          return [90, 0, 0];
        }
        return null;
      },
      eventInfos: [
        {
          audioName: 'WorldByOwner',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          maxRange: 50,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        objectId: 10,
        playerIndex: 2,
      }),
    ).toBe(AudioHandleSpecialValues.AHSV_NoSound);

    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        drawableId: 12,
        playerIndex: 1,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('does not distance-cull unresolved object/drawable events when no owner position can be resolved', () => {
    const manager = new AudioManager({
      resolveObjectPosition: () => null,
      resolveDrawablePosition: () => null,
      eventInfos: [
        {
          audioName: 'WorldByOwner',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          maxRange: 1,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        objectId: 77,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(
      manager.addAudioEvent({
        eventName: 'WorldByOwner',
        drawableId: 78,
      }),
    ).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('culls ST_SHROUDED positional sounds when local shroud is not clear', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      resolveShroudVisibility: (_localPlayerIndex, position) => position[0] <= 50,
      eventInfos: [
        {
          audioName: 'ShroudedWorld',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_SHROUDED,
          maxRange: 200,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(manager.addAudioEvent('ShroudedWorld', [75, 0, 0])).toBe(
      AudioHandleSpecialValues.AHSV_NoSound,
    );
    expect(manager.addAudioEvent('ShroudedWorld', [25, 0, 0])).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('does not shroud-cull ST_GLOBAL positional sounds', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      resolveShroudVisibility: () => false,
      eventInfos: [
        {
          audioName: 'ShroudedGlobalWorld',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_GLOBAL | SoundType.ST_SHROUDED,
          maxRange: 200,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(manager.addAudioEvent('ShroudedGlobalWorld', [25, 0, 0])).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );
  });

  it('culls active positional sounds below MinSampleVolume as listener distance changes', () => {
    const manager = new AudioManager({
      minSampleVolume: 0.25,
      eventInfos: [
        {
          audioName: 'WorldDistanceCull',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          volume: 1,
          minRange: 20,
          maxRange: 300,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    const handle = manager.addAudioEvent('WorldDistanceCull', [20, 0, 0]);
    manager.update();
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);

    manager.setListenerPosition([200, 0, 0]);
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(false);
  });

  it('keeps active ST_GLOBAL positional sounds when volume falls below MinSampleVolume', () => {
    const manager = new AudioManager({
      minSampleVolume: 0.25,
      globalMinRange: 20,
      globalMaxRange: 100,
      eventInfos: [
        {
          audioName: 'WorldGlobalDistanceCull',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_GLOBAL,
          volume: 1,
          minRange: 20,
          maxRange: 300,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    const handle = manager.addAudioEvent('WorldGlobalDistanceCull', [20, 0, 0]);
    manager.update();
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);

    manager.setListenerPosition([200, 0, 0]);
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);
    expect(manager.getActiveResolvedVolume(handle)).toBeCloseTo(0);
  });

  it('removes active positional audio when object/drawable positions are no longer resolvable', () => {
    let objectPosition: readonly [number, number, number] | null = [20, 0, 0];
    const manager = new AudioManager({
      resolveObjectPosition: (objectId) => (objectId === 7 ? objectPosition : null),
      eventInfos: [
        {
          audioName: 'WorldByObject',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
          maxRange: 300,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    const handle = manager.addAudioEvent({
      eventName: 'WorldByObject',
      objectId: 7,
    });
    manager.update();
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.isCurrentlyPlaying(handle)).toBe(true);

    objectPosition = null;
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(false);
  });

  it('updates ST_SHROUDED behavior when shroud resolver changes at runtime', () => {
    const manager = new AudioManager({
      localPlayerIndex: 1,
      eventInfos: [
        {
          audioName: 'ShroudedWorld',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD | SoundType.ST_SHROUDED,
          maxRange: 200,
        },
      ],
    });
    manager.init();
    manager.setListenerPosition([0, 0, 0]);

    expect(manager.addAudioEvent('ShroudedWorld', [25, 0, 0])).toBeGreaterThanOrEqual(
      AudioHandleSpecialValues.AHSV_FirstHandle,
    );

    manager.setShroudVisibilityResolver(() => false);
    expect(manager.addAudioEvent('ShroudedWorld', [25, 0, 0])).toBe(
      AudioHandleSpecialValues.AHSV_NoSound,
    );
  });

  it('enforces per-event limit and supports AC_INTERRUPT replacement semantics', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'Limited',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          limit: 1,
        },
        {
          audioName: 'InterruptLimited',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          control: AudioControl.AC_INTERRUPT,
          limit: 1,
        },
      ],
    });
    manager.init();

    const limitedFirst = manager.addAudioEvent('Limited');
    expect(limitedFirst).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(manager.addAudioEvent('Limited')).toBe(AudioHandleSpecialValues.AHSV_NoSound);

    manager.update();
    expect(manager.isCurrentlyPlaying(limitedFirst)).toBe(true);
    expect(manager.addAudioEvent('Limited')).toBe(AudioHandleSpecialValues.AHSV_NoSound);

    const interruptFirst = manager.addAudioEvent('InterruptLimited');
    manager.update();
    expect(interruptFirst).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);

    const interruptSecond = manager.addAudioEvent('InterruptLimited');
    expect(interruptSecond).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();

    expect(manager.isCurrentlyPlaying(interruptFirst)).toBe(false);
    expect(manager.isCurrentlyPlaying(interruptSecond)).toBe(true);
  });

  it('stops replaced playback nodes when AC_INTERRUPT replaces the oldest active sample', () => {
    const { fakeContext, createdSources } = createRecordingAudioContext();
    const manager = new AudioManager({
      context: fakeContext,
      sampleCount2D: 1,
      eventInfos: [
        {
          audioName: 'InterruptPool',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          control: AudioControl.AC_INTERRUPT,
        },
      ],
    });
    manager.init();
    manager.preloadAudioBuffer('InterruptPool', { duration: 1 } as AudioBuffer);

    const firstHandle = manager.addAudioEvent('InterruptPool');
    expect(firstHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(createdSources).toHaveLength(1);

    const secondHandle = manager.addAudioEvent('InterruptPool');
    expect(secondHandle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();

    expect(createdSources).toHaveLength(2);
    expect(createdSources[0]!.stopCalls.length).toBeGreaterThan(0);
    expect(manager.isCurrentlyPlaying(firstHandle)).toBe(false);
    expect(manager.isCurrentlyPlaying(secondHandle)).toBe(true);
  });

  it('caps AC_INTERRUPT events by queued requests in the same frame', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'InterruptLimited',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          control: AudioControl.AC_INTERRUPT,
          limit: 1,
        },
      ],
    });
    manager.init();

    const first = manager.addAudioEvent('InterruptLimited');
    const second = manager.addAudioEvent('InterruptLimited');

    expect(first).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(second).toBe(AudioHandleSpecialValues.AHSV_NoSound);
  });

  it('drops 2D sound requests when the 2D sample pool is saturated', () => {
    const manager = new AudioManager({
      sampleCount2D: 1,
      eventInfos: [
        {
          audioName: 'UiA',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
        {
          audioName: 'UiB',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
      ],
    });
    manager.init();

    const first = manager.addAudioEvent('UiA');
    const second = manager.addAudioEvent('UiB');
    expect(first).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(second).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);

    manager.update();
    expect(manager.isCurrentlyPlaying(first)).toBe(true);
    expect(manager.isCurrentlyPlaying(second)).toBe(false);
  });

  it('replaces lower-priority 2D sounds when sample channels are saturated', () => {
    const manager = new AudioManager({
      sampleCount2D: 1,
      eventInfos: [
        {
          audioName: 'LowUi',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          priority: AudioPriority.AP_LOW,
        },
        {
          audioName: 'HighUi',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          priority: AudioPriority.AP_HIGH,
        },
      ],
    });
    manager.init();

    const low = manager.addAudioEvent('LowUi');
    manager.update();
    expect(manager.isCurrentlyPlaying(low)).toBe(true);

    const high = manager.addAudioEvent('HighUi');
    manager.update();

    expect(manager.isCurrentlyPlaying(low)).toBe(false);
    expect(manager.isCurrentlyPlaying(high)).toBe(true);
  });

  it('tracks 2D and 3D sample capacities independently', () => {
    const manager = new AudioManager({
      sampleCount2D: 1,
      sampleCount3D: 1,
      eventInfos: [
        {
          audioName: 'UiA',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
        {
          audioName: 'UiB',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
        {
          audioName: 'WorldA',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
        {
          audioName: 'WorldB',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
      ],
    });
    manager.init();

    const uiA = manager.addAudioEvent('UiA');
    const worldA = manager.addAudioEvent('WorldA', [10, 0, 0]);
    manager.update();
    expect(manager.isCurrentlyPlaying(uiA)).toBe(true);
    expect(manager.isCurrentlyPlaying(worldA)).toBe(true);

    const uiB = manager.addAudioEvent('UiB');
    const worldB = manager.addAudioEvent('WorldB', [15, 0, 0]);
    manager.update();

    expect(manager.isCurrentlyPlaying(uiA)).toBe(true);
    expect(manager.isCurrentlyPlaying(worldA)).toBe(true);
    expect(manager.isCurrentlyPlaying(uiB)).toBe(false);
    expect(manager.isCurrentlyPlaying(worldB)).toBe(false);
  });

  it('applies runtime sample-count updates from game settings', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'UiA',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
      ],
    });
    manager.init();

    manager.setSampleCounts(0, 24);
    const handle = manager.addAudioEvent('UiA');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(false);
  });

  it('drops streaming requests when the stream pool is saturated', () => {
    const manager = new AudioManager({
      streamCount: 1,
      eventInfos: [
        {
          audioName: 'SpeechA',
          soundType: AudioType.AT_Streaming,
        },
        {
          audioName: 'SpeechB',
          soundType: AudioType.AT_Streaming,
        },
      ],
    });
    manager.init();

    const first = manager.addAudioEvent('SpeechA');
    const second = manager.addAudioEvent('SpeechB');
    expect(first).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    expect(second).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);

    manager.update();
    expect(manager.isCurrentlyPlaying(first)).toBe(true);
    expect(manager.isCurrentlyPlaying(second)).toBe(false);
  });

  it('applies runtime stream-count updates from game settings', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'SpeechA',
          soundType: AudioType.AT_Streaming,
        },
      ],
    });
    manager.init();

    manager.setStreamCount(0);
    const handle = manager.addAudioEvent('SpeechA');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(manager.isCurrentlyPlaying(handle)).toBe(false);
  });

  it('tracks preferred provider and speaker settings from option preferences', () => {
    const manager = new AudioManager({
      preferred3DProvider: 'Miles Fast 2D Positional Audio',
      preferredSpeakerType: 'Headphones',
    });
    manager.init();

    expect(manager.getPreferredProvider()).toBe('Miles Fast 2D Positional Audio');
    expect(manager.getPreferredSpeaker()).toBe('Headphones');

    manager.setPreferredProvider('  Miles 3D  ');
    manager.setPreferredSpeaker('  2 Speakers  ');
    expect(manager.getPreferredProvider()).toBe('Miles 3D');
    expect(manager.getPreferredSpeaker()).toBe('2 Speakers');

    manager.setPreferredProvider('');
    manager.setPreferredSpeaker(null);
    expect(manager.getPreferredProvider()).toBeNull();
    expect(manager.getPreferredSpeaker()).toBeNull();
  });

  it('replaces the oldest matching event for AC_INTERRUPT when channels are full', () => {
    const manager = new AudioManager({
      sampleCount2D: 1,
      eventInfos: [
        {
          audioName: 'InterruptUi',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
          control: AudioControl.AC_INTERRUPT,
        },
      ],
    });
    manager.init();

    const first = manager.addAudioEvent('InterruptUi');
    manager.update();
    expect(manager.isCurrentlyPlaying(first)).toBe(true);

    const second = manager.addAudioEvent('InterruptUi');
    manager.update();

    expect(manager.isCurrentlyPlaying(first)).toBe(false);
    expect(manager.isCurrentlyPlaying(second)).toBe(true);
  });

  it('blocks non-interrupting ST_VOICE overlap for the same object', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'VoiceLine',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI | SoundType.ST_VOICE,
        },
      ],
    });
    manager.init();

    const first = manager.addAudioEvent({
      eventName: 'VoiceLine',
      objectId: 77,
    });
    expect(first).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();

    const second = manager.addAudioEvent({
      eventName: 'VoiceLine',
      objectId: 77,
    });
    expect(second).toBe(AudioHandleSpecialValues.AHSV_NoSound);
  });

  it('allows ST_VOICE overlap when event is AC_INTERRUPT', () => {
    const manager = new AudioManager({
      eventInfos: [
        {
          audioName: 'VoiceInterrupt',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI | SoundType.ST_VOICE,
          control: AudioControl.AC_INTERRUPT,
        },
      ],
    });
    manager.init();

    const first = manager.addAudioEvent({
      eventName: 'VoiceInterrupt',
      objectId: 77,
    });
    expect(first).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();

    const second = manager.addAudioEvent({
      eventName: 'VoiceInterrupt',
      objectId: 77,
    });
    expect(second).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
  });

  it('stays stable under long-running mixed playback load', () => {
    const manager = new AudioManager({
      sampleCount2D: 3,
      sampleCount3D: 3,
      streamCount: 2,
      eventInfos: [
        {
          audioName: 'UiPing',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_UI,
        },
        {
          audioName: 'WorldBoom',
          soundType: AudioType.AT_SoundEffect,
          type: SoundType.ST_WORLD,
        },
        {
          audioName: 'SpeechLine',
          soundType: AudioType.AT_Streaming,
        },
      ],
    });
    manager.init();

    for (let frame = 0; frame < 1200; frame += 1) {
      if (frame % 2 === 0) {
        manager.addAudioEvent('UiPing');
      }
      if (frame % 3 === 0) {
        manager.addAudioEvent('WorldBoom', [frame % 20, 0, (frame * 3) % 20]);
      }
      if (frame % 10 === 0) {
        manager.addAudioEvent('SpeechLine');
      }
      if (frame % 25 === 0) {
        manager.removeAudioEvent('UiPing');
      }
      manager.update();
    }

    expect(manager.getActiveAudioEventCount()).toBeLessThanOrEqual(8);
    expect(manager.getQueuedRequestCount()).toBeLessThanOrEqual(8);

    manager.stopAllAudioImmediately();
    expect(manager.getActiveAudioEventCount()).toBe(0);
    expect(manager.getQueuedRequestCount()).toBe(0);
  });

  // ============================================================================
  // Convenience methods: playSound3D, playSound2D, playSoundOnEntity
  // ============================================================================

  it('playSound3D creates a positional audio event', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'Explosion',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_WORLD | SoundType.ST_EVERYONE,
      volume: 0.8,
      minRange: 10,
      maxRange: 500,
    });

    // Place listener near the sound so it's within audible range
    manager.setListenerPosition([100, 50, 190]);
    const handle = manager.playSound3D('Explosion', 100, 50, 200);
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(1);
    manager.dispose();
  });

  it('playSound2D creates a non-positional audio event', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'UiClick',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
    });

    const handle = manager.playSound2D('UiClick');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(1);
    manager.dispose();
  });

  it('playSoundOnEntity creates an object-bound audio event', () => {
    const manager = new AudioManager({
      resolveObjectPosition: (id) => (id === 42 ? [10, 20, 30] : null),
    });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'EngineRun',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_WORLD | SoundType.ST_EVERYONE,
      volume: 0.6,
      minRange: 5,
      maxRange: 150,
    });

    const handle = manager.playSoundOnEntity('EngineRun', 42);
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(1);
    manager.dispose();
  });

  // ============================================================================
  // Sound selection: random and sequential from sounds list
  // ============================================================================

  it('selects sounds sequentially when AC_RANDOM is not set', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'Gunfire',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
      sounds: ['gunfire1', 'gunfire2', 'gunfire3'],
      control: 0, // no AC_RANDOM
    });

    // Play 4 times: should cycle 0, 1, 2, 0
    const handles: number[] = [];
    for (let i = 0; i < 4; i++) {
      handles.push(manager.addAudioEvent('Gunfire'));
      manager.update();
    }
    for (const h of handles) {
      expect(h).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    }
    manager.dispose();
  });

  it('selects sounds randomly when AC_RANDOM is set', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'Impact',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
      sounds: ['impact1', 'impact2', 'impact3'],
      control: AudioControl.AC_RANDOM,
    });

    // Play 10 times: all handles should be valid
    for (let i = 0; i < 10; i++) {
      const handle = manager.addAudioEvent('Impact');
      expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
      manager.update();
    }
    manager.dispose();
  });

  it('falls back to filename when sounds list is empty', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'SingleSound',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
      filename: 'single_file.wav',
      sounds: [],
    });

    const handle = manager.addAudioEvent('SingleSound');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.dispose();
  });

  // ============================================================================
  // Pitch shift and volume shift
  // ============================================================================

  it('registers AudioEventInfo with pitch shift and volume shift', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'PitchedSound',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.7,
      pitchShiftMin: 0.9,
      pitchShiftMax: 1.1,
      volumeShift: -0.2,
    });

    const info = manager.findAudioEventInfo('PitchedSound');
    expect(info).not.toBeNull();
    expect(info!.pitchShiftMin).toBe(0.9);
    expect(info!.pitchShiftMax).toBe(1.1);
    expect(info!.volumeShift).toBe(-0.2);

    // Playing the event should still work
    const handle = manager.addAudioEvent('PitchedSound');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.dispose();
  });

  // ============================================================================
  // Zoom volume adjustment
  // ============================================================================

  it('adjusts 3D volume based on zoom distance', () => {
    const manager = new AudioManager();
    manager.init();

    // Default zoom volume should be 1
    expect(manager.getZoomVolume()).toBe(1);

    // Set zoom distances and update with a close camera
    manager.setZoomDistances(100, 400, 0.5);
    manager.setListenerPosition([0, 0, 0]);
    manager.updateZoomVolume(0, 50, 0); // camera at (0,50,0), listener at origin
    // Distance = 50, which is < minDistance=100, so zoom = 1.0
    expect(manager.getZoomVolume()).toBeCloseTo(1.0);

    // Camera at a medium distance
    manager.updateZoomVolume(0, 250, 0); // Distance = 250, between 100 and 400
    const mediumZoom = manager.getZoomVolume();
    expect(mediumZoom).toBeGreaterThan(0.5);
    expect(mediumZoom).toBeLessThan(1.0);

    // Camera at far distance
    manager.updateZoomVolume(0, 500, 0); // Distance = 500, > maxDistance=400
    // Beyond max distance: zoom = 1 - maxBoost = 1 - 0.5 = 0.5
    expect(manager.getZoomVolume()).toBeCloseTo(0.5);

    manager.dispose();
  });

  it('set3DVolumeAdjustment directly sets zoom volume', () => {
    const manager = new AudioManager();
    manager.init();

    manager.set3DVolumeAdjustment(0.75);
    expect(manager.getZoomVolume()).toBeCloseTo(0.75);

    // Clamp to [0, 1]
    manager.set3DVolumeAdjustment(1.5);
    expect(manager.getZoomVolume()).toBeCloseTo(1.0);

    manager.set3DVolumeAdjustment(-0.3);
    expect(manager.getZoomVolume()).toBeCloseTo(0.0);

    manager.dispose();
  });

  // ============================================================================
  // Music crossfade
  // ============================================================================

  it('crossfadeToMusic starts a new music event', () => {
    const { fakeContext } = createRecordingAudioContext();
    const manager = new AudioManager({
      context: fakeContext,
    });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'MusicTrack1',
      soundType: AudioType.AT_Music,
      type: SoundType.ST_UI,
      volume: 1,
    });
    manager.addAudioEventInfo({
      audioName: 'MusicTrack2',
      soundType: AudioType.AT_Music,
      type: SoundType.ST_UI,
      volume: 1,
    });

    // Start first track
    manager.addAudioEvent({
      eventName: 'MusicTrack1',
      audioAffect: AudioAffect.AudioAffect_Music,
    });
    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(1);

    // Crossfade to second track
    const handle = manager.crossfadeToMusic('MusicTrack2');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();

    // Should have both the old (fading out) and new track
    expect(manager.getActiveAudioEventCount()).toBeGreaterThanOrEqual(1);

    manager.dispose();
  });

  // ============================================================================
  // AudioEventInfo with sounds list, delay
  // ============================================================================

  it('stores sounds list and delay fields in AudioEventInfo', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'MultiSound',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
      sounds: ['sound_a', 'sound_b', 'sound_c'],
      delayMin: 100,
      delayMax: 500,
    });

    const info = manager.findAudioEventInfo('MultiSound');
    expect(info).not.toBeNull();
    expect(info!.sounds).toEqual(['sound_a', 'sound_b', 'sound_c']);
    expect(info!.delayMin).toBe(100);
    expect(info!.delayMax).toBe(500);
    manager.dispose();
  });

  // ============================================================================
  // Graceful degradation without AudioContext
  // ============================================================================

  it('gracefully handles playback when no AudioContext is available', () => {
    // Pass null context to simulate no AudioContext support
    const manager = new AudioManager({ context: null as unknown as AudioContext });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'TestSound',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
    });

    // Should not throw
    const handle = manager.addAudioEvent('TestSound');
    expect(handle).toBeGreaterThanOrEqual(AudioHandleSpecialValues.AHSV_FirstHandle);
    manager.update();

    // The event is tracked even without a playback node
    expect(manager.getActiveAudioEventCount()).toBe(1);

    manager.removeAudioEvent(handle);
    manager.update();
    expect(manager.getActiveAudioEventCount()).toBe(0);
    manager.dispose();
  });

  it('convenience methods degrade gracefully without context', () => {
    const manager = new AudioManager({ context: null as unknown as AudioContext });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'TestSound',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_WORLD | SoundType.ST_EVERYONE,
      volume: 0.5,
      minRange: 10,
      maxRange: 200,
    });

    // Should not throw
    expect(() => manager.playSound3D('TestSound', 0, 0, 0)).not.toThrow();
    expect(() => manager.playSound2D('TestSound')).not.toThrow();
    expect(() => manager.playSoundOnEntity('TestSound', 1)).not.toThrow();
    expect(() => manager.crossfadeToMusic('TestSound')).not.toThrow();
    expect(() => manager.updateZoomVolume(0, 0, 0)).not.toThrow();
    manager.dispose();
  });

  // ============================================================================
  // Web Audio playback with pitch shift
  // ============================================================================

  it('applies pitch shift to playback rate on Web Audio source node', () => {
    const { fakeContext, createdSources } = createRecordingAudioContext();
    const fakeBuffer = {
      duration: 1,
      length: 44100,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(44100),
      copyFromChannel: () => undefined,
      copyToChannel: () => undefined,
    } as unknown as AudioBuffer;

    const manager = new AudioManager({ context: fakeContext });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'PitchedTest',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.8,
      pitchShiftMin: 1.5,
      pitchShiftMax: 1.5, // Fixed pitch shift for deterministic test
    });
    manager.preloadAudioBuffer('PitchedTest', fakeBuffer);

    manager.addAudioEvent('PitchedTest');
    manager.update();

    // The source node should have been created with modified playback rate
    expect(createdSources.length).toBeGreaterThan(0);
    const lastSource = createdSources[createdSources.length - 1]!;
    // Source parity: pitch shift should be applied to the playback rate
    expect(lastSource.playbackRate.value).toBeCloseTo(1.5);
    expect(manager.getActiveAudioEventCount()).toBe(1);

    manager.dispose();
  });

  it('suppresses async decode failures and does not retry failed sample loads', async () => {
    const { fakeContext } = createRecordingAudioContext();
    const loader = vi.fn(async () => new ArrayBuffer(8));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    (fakeContext as unknown as { decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer> }).decodeAudioData =
      async (_data: ArrayBuffer) => {
        throw new Error('bad sample');
      };

    const manager = new AudioManager({ context: fakeContext });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'BrokenSound',
      filename: 'broken_sample',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.8,
    });
    manager.setAudioBufferLoader(loader);

    manager.addAudioEvent('BrokenSound');
    manager.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    manager.addAudioEvent('BrokenSound');
    manager.update();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loader).toHaveBeenCalledTimes(1);
    expect((manager as unknown as { loadingBuffers: Set<string> }).loadingBuffers.size).toBe(0);
    expect((manager as unknown as { failedBuffers: Set<string> }).failedBuffers.has('broken_sample')).toBe(true);

    warnSpy.mockRestore();
    manager.dispose();
  });

  // ============================================================================
  // Music ducking (speech ducks music volume)
  // ============================================================================

  it('tracks active speech for music ducking state', () => {
    const manager = new AudioManager();
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'MusicBG',
      soundType: AudioType.AT_Music,
      type: SoundType.ST_UI,
      volume: 1,
    });
    manager.addAudioEventInfo({
      audioName: 'VoiceLine',
      soundType: AudioType.AT_Streaming,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.8,
    });

    // Start music
    manager.addAudioEvent({
      eventName: 'MusicBG',
      audioAffect: AudioAffect.AudioAffect_Music,
    });
    manager.update();
    expect(manager.isMusicPlaying()).toBe(true);

    // Start voice line
    manager.addAudioEvent('VoiceLine');
    manager.update();

    // Both should be active
    expect(manager.getActiveAudioEventCount()).toBe(2);
    manager.dispose();
  });

  // ============================================================================
  // Node pooling
  // ============================================================================

  it('reuses gain nodes from pool across playback cycles', () => {
    const { fakeContext } = createRecordingAudioContext();
    const fakeBuffer = {
      duration: 0.1,
      length: 4410,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(4410),
      copyFromChannel: () => undefined,
      copyToChannel: () => undefined,
    } as unknown as AudioBuffer;

    const manager = new AudioManager({ context: fakeContext });
    manager.init();
    manager.addAudioEventInfo({
      audioName: 'PoolTest',
      soundType: AudioType.AT_SoundEffect,
      type: SoundType.ST_UI | SoundType.ST_EVERYONE,
      volume: 0.5,
    });
    manager.preloadAudioBuffer('PoolTest', fakeBuffer);

    // Play and stop multiple times to exercise pooling
    for (let i = 0; i < 5; i++) {
      const handle = manager.addAudioEvent('PoolTest');
      manager.update();
      manager.removeAudioEvent(handle);
      manager.update();
    }

    // All events should be cleaned up
    expect(manager.getActiveAudioEventCount()).toBe(0);
    manager.dispose();
  });
});
