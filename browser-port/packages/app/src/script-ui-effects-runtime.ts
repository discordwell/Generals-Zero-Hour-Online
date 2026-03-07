interface ScriptMoviePlaybackRequestState {
  movieName: string;
  playbackType: 'FULLSCREEN' | 'RADAR';
  frame: number;
}

interface ScriptCameoFlashRequestState {
  commandButtonName: string;
  flashCount: number;
  frame: number;
}

export interface ScriptUiEffectsRuntimeGameLogic {
  drainScriptMoviePlaybackRequests(): ScriptMoviePlaybackRequestState[];
  drainScriptCameoFlashRequests(): ScriptCameoFlashRequestState[];
}

export interface ScriptUiEffectsRuntimeUi {
  showMessage(message: string, durationMs?: number): void;
  setFlashingControlBarButtons(buttonIds: readonly string[]): void;
}

export interface ScriptUiEffectsRuntimeLogger {
  debug(message: string): void;
}

export interface ScriptUiEffectsRuntimeBridge {
  syncAfterSimulationStep(currentLogicFrame: number): void;
}

export interface ScriptUiEffectsRuntimeVideoPlayer {
  playFullscreen(movieName: string): Promise<void>;
  playInRadar(movieName: string): Promise<void>;
  readonly isPlaying: boolean;
}

export interface CreateScriptUiEffectsRuntimeBridgeOptions {
  gameLogic: ScriptUiEffectsRuntimeGameLogic;
  uiRuntime: ScriptUiEffectsRuntimeUi;
  videoPlayer?: ScriptUiEffectsRuntimeVideoPlayer | null;
  /** Called when a script-triggered video finishes playing. */
  onScriptVideoCompleted?: (movieName: string) => void;
  logger?: ScriptUiEffectsRuntimeLogger;
}

interface ActiveCameoFlashState {
  remainingFlashes: number;
  nextToggleFrame: number;
  visible: boolean;
}

const FLASH_INTERVAL_FRAMES = Math.max(1, Math.trunc(30 / 2));
const MOVIE_MESSAGE_DURATION_MS = 4500;

export function createScriptUiEffectsRuntimeBridge(
  options: CreateScriptUiEffectsRuntimeBridgeOptions,
): ScriptUiEffectsRuntimeBridge {
  const {
    gameLogic,
    uiRuntime,
    videoPlayer = null,
    onScriptVideoCompleted,
    logger = console,
  } = options;

  const activeCameoFlashes = new Map<string, ActiveCameoFlashState>();

  const processMoviePlaybackRequests = (): void => {
    const requests = gameLogic.drainScriptMoviePlaybackRequests();
    for (const request of requests) {
      logger.debug(
        `[ScriptMovie frame=${request.frame} type=${request.playbackType}] ${request.movieName}`,
      );

      if (videoPlayer) {
        const play = request.playbackType === 'RADAR'
          ? videoPlayer.playInRadar(request.movieName)
          : videoPlayer.playFullscreen(request.movieName);
        play.then(() => {
          onScriptVideoCompleted?.(request.movieName);
        }).catch(() => {
          onScriptVideoCompleted?.(request.movieName);
        });
      } else {
        uiRuntime.showMessage(
          `[${request.playbackType} movie] ${request.movieName}`,
          MOVIE_MESSAGE_DURATION_MS,
        );
        // Auto-complete so script conditions still progress
        onScriptVideoCompleted?.(request.movieName);
      }
    }
  };

  const processCameoFlashRequests = (currentLogicFrame: number): void => {
    const requests = gameLogic.drainScriptCameoFlashRequests();
    for (const request of requests) {
      const commandButtonName = request.commandButtonName.trim();
      if (!commandButtonName) {
        continue;
      }

      logger.debug(
        `[ScriptCameoFlash frame=${request.frame} button=${commandButtonName}] flashes=${request.flashCount}`,
      );

      if (request.flashCount <= 0) {
        activeCameoFlashes.delete(commandButtonName);
        continue;
      }

      activeCameoFlashes.set(commandButtonName, {
        remainingFlashes: request.flashCount,
        nextToggleFrame: currentLogicFrame,
        visible: false,
      });
    }
  };

  const updateActiveCameoFlashes = (currentLogicFrame: number): void => {
    const visibleButtonIds: string[] = [];

    for (const [buttonId, state] of activeCameoFlashes) {
      while (state.remainingFlashes > 0 && currentLogicFrame >= state.nextToggleFrame) {
        state.visible = !state.visible;
        state.remainingFlashes -= 1;
        state.nextToggleFrame += FLASH_INTERVAL_FRAMES;
      }

      if (state.remainingFlashes <= 0) {
        activeCameoFlashes.delete(buttonId);
        continue;
      }

      if (state.visible) {
        visibleButtonIds.push(buttonId);
      }
    }

    visibleButtonIds.sort((left, right) => left.localeCompare(right));
    uiRuntime.setFlashingControlBarButtons(visibleButtonIds);
  };

  return {
    syncAfterSimulationStep(currentLogicFrame: number): void {
      processMoviePlaybackRequests();
      processCameoFlashRequests(currentLogicFrame);
      updateActiveCameoFlashes(currentLogicFrame);
    },
  };
}
