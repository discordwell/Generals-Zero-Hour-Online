interface ScriptCinematicTextState {
  text: string;
  fontType: string;
  timeSeconds: number;
  durationFrames: number;
  frame: number;
}

export interface ScriptCinematicRuntimeGameLogic {
  isScriptLetterboxEnabled(): boolean;
  getScriptCinematicTextState(): ScriptCinematicTextState | null;
}

export interface ScriptCinematicRuntimeView {
  setLetterboxEnabled(enabled: boolean): void;
  showCinematicText(text: string, fontType: string): void;
  clearCinematicText(): void;
}

export interface ScriptCinematicRuntimeBridge {
  syncAfterSimulationStep(currentLogicFrame: number): void;
}

export interface CreateScriptCinematicRuntimeBridgeOptions {
  gameLogic: ScriptCinematicRuntimeGameLogic;
  view: ScriptCinematicRuntimeView;
}

export function createScriptCinematicRuntimeBridge(
  options: CreateScriptCinematicRuntimeBridgeOptions,
): ScriptCinematicRuntimeBridge {
  const { gameLogic, view } = options;

  let lastLetterboxState: boolean | null = null;
  let lastCinematicStateFrame = -1;
  let cinematicClearOnFrame: number | null = null;
  let cinematicTextVisible = false;

  return {
    syncAfterSimulationStep(currentLogicFrame: number): void {
      const letterboxEnabled = gameLogic.isScriptLetterboxEnabled();
      if (letterboxEnabled !== lastLetterboxState) {
        lastLetterboxState = letterboxEnabled;
        view.setLetterboxEnabled(letterboxEnabled);
      }

      const cinematicState = gameLogic.getScriptCinematicTextState();
      if (
        cinematicState
        && cinematicState.frame !== lastCinematicStateFrame
      ) {
        lastCinematicStateFrame = cinematicState.frame;
        view.showCinematicText(cinematicState.text, cinematicState.fontType);
        cinematicTextVisible = true;
        cinematicClearOnFrame = cinematicState.durationFrames > 0
          ? cinematicState.frame + cinematicState.durationFrames
          : cinematicState.frame;
      }

      if (!cinematicState && cinematicTextVisible) {
        view.clearCinematicText();
        cinematicTextVisible = false;
        cinematicClearOnFrame = null;
      }

      if (
        cinematicTextVisible &&
        cinematicClearOnFrame !== null
        && currentLogicFrame >= cinematicClearOnFrame
      ) {
        view.clearCinematicText();
        cinematicTextVisible = false;
        cinematicClearOnFrame = null;
      }
    },
  };
}
