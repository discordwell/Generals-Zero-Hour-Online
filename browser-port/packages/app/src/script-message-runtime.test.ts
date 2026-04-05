import { describe, expect, it } from 'vitest';

import {
  createScriptMessageRuntimeBridge,
  type ScriptMessageRuntimeGameLogic,
} from './script-message-runtime.js';

class RecordingUiRuntime {
  readonly shownMessages: Array<{ message: string; durationMs: number | undefined }> = [];

  showMessage(message: string, durationMs?: number): void {
    this.shownMessages.push({ message, durationMs });
  }
}

class RecordingLogger {
  readonly debugMessages: string[] = [];
  readonly warnMessages: string[] = [];

  debug(message: string): void {
    this.debugMessages.push(message);
  }

  warn(message: string): void {
    this.warnMessages.push(message);
  }
}

interface MutableScriptMessageState {
  debugRequests: Array<{
    message: string;
    crashRequested: boolean;
    pauseRequested: boolean;
    frame: number;
  }>;
  popupRequests: Array<{
    message: string;
    x: number;
    y: number;
    width: number;
    pause: boolean;
    frame: number;
  }>;
  displayMessages: Array<{
    messageType: 'DISPLAY_TEXT' | 'MILITARY_CAPTION';
    text: string;
    duration: number | null;
    frame: number;
  }>;
}

class RecordingGameLogic implements ScriptMessageRuntimeGameLogic {
  readonly state: MutableScriptMessageState = {
    debugRequests: [],
    popupRequests: [],
    displayMessages: [],
  };

  drainScriptDisplayMessages(): MutableScriptMessageState['displayMessages'] {
    const drained = this.state.displayMessages.map((message) => ({ ...message }));
    this.state.displayMessages.length = 0;
    return drained;
  }

  drainScriptPopupMessages(): MutableScriptMessageState['popupRequests'] {
    const drained = this.state.popupRequests.map((request) => ({ ...request }));
    this.state.popupRequests.length = 0;
    return drained;
  }

  drainScriptDebugMessageRequests(): MutableScriptMessageState['debugRequests'] {
    const drained = this.state.debugRequests.map((request) => ({ ...request }));
    this.state.debugRequests.length = 0;
    return drained;
  }
}

describe('script message runtime bridge', () => {
  it('routes debug and popup messages to UI and applies pause requests', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();
    const logger = new RecordingLogger();
    const pauseCalls: boolean[] = [];

    const bridge = createScriptMessageRuntimeBridge({
      gameLogic,
      uiRuntime,
      setSimulationPaused: (paused) => pauseCalls.push(paused),
      logger,
    });

    gameLogic.state.debugRequests.push({
      message: 'Debug message',
      crashRequested: true,
      pauseRequested: true,
      frame: 11,
    });
    gameLogic.state.popupRequests.push({
      message: 'Popup message',
      x: 100,
      y: 200,
      width: 280,
      pause: true,
      frame: 11,
    });

    bridge.syncAfterSimulationStep();

    expect(uiRuntime.shownMessages).toEqual([
      { message: 'Debug message', durationMs: undefined },
      { message: 'Popup message', durationMs: undefined },
    ]);
    expect(logger.debugMessages).toEqual([
      '[ScriptDebug frame=11] Debug message',
      '[ScriptPopup frame=11 x=100 y=200 width=280] Popup message',
    ]);
    expect(logger.warnMessages).toEqual([
      '[ScriptDebugCrashBox frame=11] Debug message',
    ]);
    expect(pauseCalls).toEqual([true, true, true]);
    expect(bridge.getBriefingHistory()).toEqual(['Popup message']);
  });

  it('maps display message durations for military captions', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();

    const bridge = createScriptMessageRuntimeBridge({
      gameLogic,
      uiRuntime,
      setSimulationPaused: () => {},
    });

    gameLogic.state.displayMessages.push(
      {
        messageType: 'DISPLAY_TEXT',
        text: 'Mission text',
        duration: null,
        frame: 7,
      },
      {
        messageType: 'MILITARY_CAPTION',
        text: 'Military subtitle',
        duration: 3,
        frame: 7,
      },
      {
        messageType: 'MILITARY_CAPTION',
        text: 'Default duration subtitle',
        duration: 0,
        frame: 7,
      },
    );

    bridge.syncAfterSimulationStep();

    expect(uiRuntime.shownMessages).toEqual([
      { message: 'Mission text', durationMs: undefined },
      { message: 'Military subtitle', durationMs: 3000 },
      { message: 'Default duration subtitle', durationMs: 4000 },
    ]);
    expect(bridge.getBriefingHistory()).toEqual([
      'Military subtitle',
      'Default duration subtitle',
    ]);
  });

  it('pauses simulation on debug crash-box requests even without explicit pause flag', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();
    const logger = new RecordingLogger();
    const pauseCalls: boolean[] = [];

    const bridge = createScriptMessageRuntimeBridge({
      gameLogic,
      uiRuntime,
      setSimulationPaused: (paused) => pauseCalls.push(paused),
      logger,
    });

    gameLogic.state.debugRequests.push({
      message: 'Crash-box debug',
      crashRequested: true,
      pauseRequested: false,
      frame: 42,
    });

    bridge.syncAfterSimulationStep();

    expect(pauseCalls).toEqual([true]);
    expect(logger.warnMessages).toEqual([
      '[ScriptDebugCrashBox frame=42] Crash-box debug',
    ]);
    expect(uiRuntime.shownMessages).toEqual([
      { message: 'Crash-box debug', durationMs: undefined },
    ]);
    expect(bridge.getBriefingHistory()).toEqual([]);
  });

  it('dedupes retained briefing history across popup and military caption updates', () => {
    const gameLogic = new RecordingGameLogic();
    const uiRuntime = new RecordingUiRuntime();

    const bridge = createScriptMessageRuntimeBridge({
      gameLogic,
      uiRuntime,
      setSimulationPaused: () => {},
    });

    gameLogic.state.popupRequests.push({
      message: 'MISSION_POPUP_ALPHA',
      x: 5,
      y: 10,
      width: 40,
      pause: false,
      frame: 1,
    });
    gameLogic.state.displayMessages.push({
      messageType: 'MILITARY_CAPTION',
      text: 'MISSION_POPUP_ALPHA',
      duration: 2,
      frame: 1,
    });
    gameLogic.state.displayMessages.push({
      messageType: 'MILITARY_CAPTION',
      text: 'MISSION_CAPTION_BETA',
      duration: 2,
      frame: 1,
    });

    bridge.syncAfterSimulationStep();

    expect(bridge.getBriefingHistory()).toEqual([
      'MISSION_POPUP_ALPHA',
      'MISSION_CAPTION_BETA',
    ]);
  });
});
