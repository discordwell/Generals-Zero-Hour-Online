import { describe, expect, it } from 'vitest';

import {
  createScriptCinematicRuntimeBridge,
  type ScriptCinematicRuntimeGameLogic,
} from './script-cinematic-runtime.js';

interface MutableCinematicState {
  letterboxEnabled: boolean;
  cinematicTextState: {
    text: string;
    fontType: string;
    timeSeconds: number;
    durationFrames: number;
    frame: number;
  } | null;
}

class RecordingGameLogic implements ScriptCinematicRuntimeGameLogic {
  readonly state: MutableCinematicState = {
    letterboxEnabled: false,
    cinematicTextState: null,
  };

  isScriptLetterboxEnabled(): boolean {
    return this.state.letterboxEnabled;
  }

  getScriptCinematicTextState(): MutableCinematicState['cinematicTextState'] {
    return this.state.cinematicTextState ? { ...this.state.cinematicTextState } : null;
  }
}

class RecordingView {
  readonly letterboxStates: boolean[] = [];
  readonly shownTexts: Array<{ text: string; fontType: string }> = [];
  clearCount = 0;

  setLetterboxEnabled(enabled: boolean): void {
    this.letterboxStates.push(enabled);
  }

  showCinematicText(text: string, fontType: string): void {
    this.shownTexts.push({ text, fontType });
  }

  clearCinematicText(): void {
    this.clearCount += 1;
  }
}

describe('script cinematic runtime bridge', () => {
  it('syncs letterbox state transitions', () => {
    const gameLogic = new RecordingGameLogic();
    const view = new RecordingView();
    const bridge = createScriptCinematicRuntimeBridge({ gameLogic, view });

    bridge.syncAfterSimulationStep(0);
    gameLogic.state.letterboxEnabled = true;
    bridge.syncAfterSimulationStep(1);
    gameLogic.state.letterboxEnabled = true;
    bridge.syncAfterSimulationStep(2);
    gameLogic.state.letterboxEnabled = false;
    bridge.syncAfterSimulationStep(3);

    expect(view.letterboxStates).toEqual([false, true, false]);
  });

  it('shows and clears cinematic text based on duration frames', () => {
    const gameLogic = new RecordingGameLogic();
    const view = new RecordingView();
    const bridge = createScriptCinematicRuntimeBridge({ gameLogic, view });

    gameLogic.state.cinematicTextState = {
      text: 'Incoming transmission',
      fontType: 'Narrator',
      timeSeconds: 2,
      durationFrames: 60,
      frame: 10,
    };

    bridge.syncAfterSimulationStep(10);
    expect(view.shownTexts).toEqual([
      { text: 'Incoming transmission', fontType: 'Narrator' },
    ]);
    expect(view.clearCount).toBe(0);

    bridge.syncAfterSimulationStep(69);
    expect(view.clearCount).toBe(0);

    bridge.syncAfterSimulationStep(70);
    expect(view.clearCount).toBe(1);
  });

  it('clears cinematic text immediately when script cinematic state is reset', () => {
    const gameLogic = new RecordingGameLogic();
    const view = new RecordingView();
    const bridge = createScriptCinematicRuntimeBridge({ gameLogic, view });

    gameLogic.state.cinematicTextState = {
      text: 'Temporary text',
      fontType: 'Narrator',
      timeSeconds: 4,
      durationFrames: 120,
      frame: 10,
    };

    bridge.syncAfterSimulationStep(10);
    expect(view.shownTexts).toEqual([
      { text: 'Temporary text', fontType: 'Narrator' },
    ]);
    expect(view.clearCount).toBe(0);

    gameLogic.state.cinematicTextState = null;
    bridge.syncAfterSimulationStep(11);
    expect(view.clearCount).toBe(1);
  });
});
