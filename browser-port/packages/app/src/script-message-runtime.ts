interface ScriptDisplayMessageState {
  messageType: 'DISPLAY_TEXT' | 'MILITARY_CAPTION';
  text: string;
  duration: number | null;
  frame: number;
}

interface ScriptPopupMessageState {
  message: string;
  x: number;
  y: number;
  width: number;
  pause: boolean;
  frame: number;
}

interface ScriptDebugMessageRequestState {
  message: string;
  crashRequested: boolean;
  pauseRequested: boolean;
  frame: number;
}

export interface ScriptMessageRuntimeGameLogic {
  drainScriptDisplayMessages(): ScriptDisplayMessageState[];
  drainScriptPopupMessages(): ScriptPopupMessageState[];
  drainScriptDebugMessageRequests(): ScriptDebugMessageRequestState[];
}

export interface ScriptMessageRuntimeUi {
  showMessage(message: string, durationMs?: number): void;
}

export interface ScriptMessageRuntimeLogger {
  debug(message: string): void;
  warn(message: string): void;
}

export interface ScriptMessageRuntimeBridge {
  syncAfterSimulationStep(): void;
  getBriefingHistory(): readonly string[];
}

export interface CreateScriptMessageRuntimeBridgeOptions {
  gameLogic: ScriptMessageRuntimeGameLogic;
  uiRuntime: ScriptMessageRuntimeUi;
  setSimulationPaused: (paused: boolean) => void;
  logger?: ScriptMessageRuntimeLogger;
}

const DEFAULT_MILITARY_CAPTION_MS = 4000;

function toMessageDurationMs(seconds: number | null): number {
  if (seconds === null || !Number.isFinite(seconds)) {
    return DEFAULT_MILITARY_CAPTION_MS;
  }
  const durationMs = Math.trunc(seconds * 1000);
  return durationMs > 0 ? durationMs : DEFAULT_MILITARY_CAPTION_MS;
}

export function createScriptMessageRuntimeBridge(
  options: CreateScriptMessageRuntimeBridgeOptions,
): ScriptMessageRuntimeBridge {
  const {
    gameLogic,
    uiRuntime,
    setSimulationPaused,
    logger = console,
  } = options;
  const briefingHistory: string[] = [];

  const noteBriefingEntry = (entry: string): void => {
    if (!entry || briefingHistory.includes(entry)) {
      return;
    }
    briefingHistory.push(entry);
  };

  const processScriptDebugMessages = (): void => {
    const requests = gameLogic.drainScriptDebugMessageRequests();
    for (const request of requests) {
      logger.debug(`[ScriptDebug frame=${request.frame}] ${request.message}`);
      if (request.crashRequested) {
        logger.warn(
          `[ScriptDebugCrashBox frame=${request.frame}] ${request.message}`,
        );
        // Source-parity bridge: DEBUG_CRASH_BOX halts progression until user intervention.
        setSimulationPaused(true);
      }
      uiRuntime.showMessage(request.message);
      if (request.pauseRequested) {
        setSimulationPaused(true);
      }
    }
  };

  const processScriptPopupMessages = (): void => {
    const requests = gameLogic.drainScriptPopupMessages();
    for (const request of requests) {
      logger.debug(
        `[ScriptPopup frame=${request.frame} x=${request.x} y=${request.y} width=${request.width}] ${request.message}`,
      );
      noteBriefingEntry(request.message);
      uiRuntime.showMessage(request.message);
      if (request.pause) {
        setSimulationPaused(true);
      }
    }
  };

  const processScriptDisplayMessages = (): void => {
    const messages = gameLogic.drainScriptDisplayMessages();
    for (const message of messages) {
      if (message.messageType === 'MILITARY_CAPTION') {
        noteBriefingEntry(message.text);
        uiRuntime.showMessage(message.text, toMessageDurationMs(message.duration));
      } else {
        uiRuntime.showMessage(message.text);
      }
    }
  };

  return {
    syncAfterSimulationStep(): void {
      processScriptDebugMessages();
      processScriptPopupMessages();
      processScriptDisplayMessages();
    },
    getBriefingHistory(): readonly string[] {
      return briefingHistory.slice();
    },
  };
}
