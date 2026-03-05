import { describe, expect, it } from 'vitest';

import {
  createScriptEvaRuntimeBridge,
  type ScriptEvaRuntimeGameLogic,
} from './script-eva-runtime.js';

class RecordingUiRuntime {
  readonly shownMessages: Array<{ message: string; durationMs: number | undefined }> = [];

  showMessage(message: string, durationMs?: number): void {
    this.shownMessages.push({ message, durationMs });
  }
}

class RecordingAudioManager {
  readonly playedEvents: string[] = [];

  addAudioEvent(eventName: string): number {
    this.playedEvents.push(eventName);
    return 1;
  }
}

class RecordingGameLogic implements ScriptEvaRuntimeGameLogic {
  private queuedEvents: Array<{
    type: import('@generals/game-logic').EvaEventType;
    side: string;
    relationship: 'own' | 'ally' | 'enemy';
    entityId: number | null;
    detail: string | null;
  }> = [];

  queueEvent(event: {
    type: import('@generals/game-logic').EvaEventType;
    side: string;
    relationship: 'own' | 'ally' | 'enemy';
    entityId: number | null;
    detail: string | null;
  }): void {
    this.queuedEvents.push({ ...event });
  }

  drainEvaEvents(): Array<{
    type: import('@generals/game-logic').EvaEventType;
    side: string;
    relationship: 'own' | 'ally' | 'enemy';
    entityId: number | null;
    detail: string | null;
  }> {
    const drained = this.queuedEvents.map((event) => ({ ...event }));
    this.queuedEvents.length = 0;
    return drained;
  }
}

describe('script EVA runtime bridge', () => {
  it('filters EVA events by local side and emits highest-priority notification', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();
    const audioManager = new RecordingAudioManager();

    const bridge = createScriptEvaRuntimeBridge({
      gameLogic,
      uiRuntime,
      audioManager,
      resolveLocalPlayerSide: () => 'America',
      logger: { debug: () => {} },
    });

    gameLogic.queueEvent({
      type: 'UNIT_READY',
      side: 'America',
      relationship: 'own',
      entityId: 10,
      detail: 'Ranger',
    });
    gameLogic.queueEvent({
      type: 'BASE_UNDER_ATTACK',
      side: 'America',
      relationship: 'own',
      entityId: 11,
      detail: null,
    });
    gameLogic.queueEvent({
      type: 'LOW_POWER',
      side: 'China',
      relationship: 'enemy',
      entityId: null,
      detail: null,
    });

    bridge.syncAfterSimulationStep();

    expect(uiRuntime.shownMessages).toEqual([
      { message: 'Base under attack.', durationMs: 3500 },
    ]);
    expect(audioManager.playedEvents).toEqual(['EVA_BASE_UNDER_ATTACK']);
  });

  it('formats detail-aware EVA messages for superweapon/unit/completion events', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();
    const audioManager = new RecordingAudioManager();

    const bridge = createScriptEvaRuntimeBridge({
      gameLogic,
      uiRuntime,
      audioManager,
      resolveLocalPlayerSide: () => 'America',
      logger: { debug: () => {} },
    });

    gameLogic.queueEvent({
      type: 'SUPERWEAPON_DETECTED',
      side: 'America',
      relationship: 'enemy',
      entityId: 7,
      detail: 'Particle Cannon',
    });
    bridge.syncAfterSimulationStep();

    gameLogic.queueEvent({
      type: 'CONSTRUCTION_COMPLETE',
      side: 'America',
      relationship: 'own',
      entityId: 12,
      detail: 'War Factory',
    });
    bridge.syncAfterSimulationStep();

    gameLogic.queueEvent({
      type: 'UNIT_READY',
      side: 'America',
      relationship: 'own',
      entityId: 22,
      detail: 'Paladin Tank',
    });
    bridge.syncAfterSimulationStep();

    expect(uiRuntime.shownMessages).toEqual([
      { message: 'Enemy superweapon detected: Particle Cannon.', durationMs: 3500 },
      { message: 'War Factory construction complete.', durationMs: 3500 },
      { message: 'Paladin Tank ready.', durationMs: 3500 },
    ]);
    expect(audioManager.playedEvents).toEqual([
      'EVA_SUPERWEAPON_DETECTED',
      'EVA_CONSTRUCTION_COMPLETE',
      'EVA_UNIT_READY',
    ]);
  });

  it('ignores EVA updates when no local player side is available', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();
    const audioManager = new RecordingAudioManager();

    const bridge = createScriptEvaRuntimeBridge({
      gameLogic,
      uiRuntime,
      audioManager,
      resolveLocalPlayerSide: () => null,
      logger: { debug: () => {} },
    });

    gameLogic.queueEvent({
      type: 'LOW_POWER',
      side: 'America',
      relationship: 'own',
      entityId: null,
      detail: null,
    });

    bridge.syncAfterSimulationStep();

    expect(uiRuntime.shownMessages).toEqual([]);
    expect(audioManager.playedEvents).toEqual([]);
  });
});
