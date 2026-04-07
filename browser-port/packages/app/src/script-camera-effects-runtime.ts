interface ScriptCameraBlackWhiteRequestState {
  enabled: boolean;
  fadeFrames: number;
  frame: number;
}

interface ScriptCameraFadeRequestState {
  fadeType: 'ADD' | 'SUBTRACT' | 'SATURATE' | 'MULTIPLY';
  minFade: number;
  maxFade: number;
  increaseFrames: number;
  holdFrames: number;
  decreaseFrames: number;
  frame: number;
}

interface ScriptCameraFilterRequestState {
  requestType: 'MOTION_BLUR' | 'MOTION_BLUR_JUMP' | 'MOTION_BLUR_FOLLOW' | 'MOTION_BLUR_END_FOLLOW';
  zoomIn: boolean | null;
  saturate: boolean | null;
  waypointName: string | null;
  x: number | null;
  z: number | null;
  followMode: number | null;
  frame: number;
}

interface ScriptCameraShakerRequestState {
  waypointName: string;
  x: number;
  z: number;
  amplitude: number;
  durationSeconds: number;
  radius: number;
  frame: number;
}

interface ScriptScreenShakeState {
  intensity: number;
  frame: number;
}

interface ScriptCameraEffectsState {
  grayscale: number;
  saturation: number;
  blurPixels: number;
  fadeType: ScriptCameraFadeRequestState['fadeType'] | null;
  fadeAmount: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
}

export interface ScriptCameraEffectsRuntimeGameLogic {
  drainScriptCameraBlackWhiteRequests(): ScriptCameraBlackWhiteRequestState[];
  drainScriptCameraFadeRequests(): ScriptCameraFadeRequestState[];
  drainScriptCameraFilterRequests(): ScriptCameraFilterRequestState[];
  drainScriptCameraShakerRequests(): ScriptCameraShakerRequestState[];
  getScriptScreenShakeState?(): ScriptScreenShakeState | null;
}

export interface ScriptCameraEffectsRuntimeBridge {
  syncAfterSimulationStep(currentLogicFrame: number): ScriptCameraEffectsState;
  captureActiveFadeSaveState(): ScriptCameraEffectFadeSaveState | null;
}

export interface CreateScriptCameraEffectsRuntimeBridgeOptions {
  gameLogic: ScriptCameraEffectsRuntimeGameLogic;
  getCameraTargetPosition?: () => { x: number; z: number } | null;
  onMotionBlurJumpToPosition?: (x: number, z: number) => void;
  initialFadeState?: ScriptCameraEffectFadeSaveState | null;
}

interface ScalarTransition {
  startFrame: number;
  durationFrames: number;
  from: number;
  to: number;
}

interface ActiveFadeState {
  fadeType: ScriptCameraFadeRequestState['fadeType'];
  minFade: number;
  maxFade: number;
  increaseFrames: number;
  holdFrames: number;
  decreaseFrames: number;
  startFrame: number;
}

interface ActiveShakeState {
  startFrame: number;
  durationFrames: number;
  amplitude: number;
  seed: number;
  x: number;
  z: number;
  radius: number;
}

interface ActiveMotionBlurFollowState {
  panFactor: number;
  maxCount: number;
  ending: boolean;
}

interface ActiveOneShotMotionBlurState {
  maxCount: number;
  decrement: boolean;
  saturationBoost: number;
  doZoomTo: boolean;
  jumpTarget: { x: number; z: number } | null;
}

export interface ScriptCameraEffectFadeSaveState {
  fadeType: ScriptCameraFadeRequestState['fadeType'];
  minFade: number;
  maxFade: number;
  currentFadeValue: number;
  currentFadeFrame: number;
  increaseFrames: number;
  holdFrames: number;
  decreaseFrames: number;
}

const LOGIC_FRAME_RATE = 30;
const SCREEN_SHAKE_DURATION_FRAMES = Math.max(1, Math.trunc(LOGIC_FRAME_RATE * 0.4));
const MOTION_BLUR_MAX_COUNT = 60;
const MOTION_BLUR_COUNT_STEP = 5;
const MOTION_BLUR_DEFAULT_PAN_FACTOR = 30;
const MOTION_BLUR_END_MIN_COUNT = 2;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function evaluateScalarTransition(
  transition: ScalarTransition | null,
  currentLogicFrame: number,
): number {
  if (!transition) {
    return 0;
  }
  if (transition.durationFrames <= 0 || currentLogicFrame >= transition.startFrame + transition.durationFrames) {
    return transition.to;
  }
  if (currentLogicFrame <= transition.startFrame) {
    return transition.from;
  }
  const elapsedFrames = currentLogicFrame - transition.startFrame;
  const progress = elapsedFrames / transition.durationFrames;
  return transition.from + (transition.to - transition.from) * progress;
}

function evaluateFadeAmount(
  fade: ActiveFadeState | null,
  currentLogicFrame: number,
): number {
  if (!fade) {
    return 0;
  }

  const minFade = clamp01(fade.minFade);
  const maxFade = clamp01(fade.maxFade);
  const increaseFrames = Math.max(0, Math.trunc(fade.increaseFrames));
  const holdFrames = Math.max(0, Math.trunc(fade.holdFrames));
  const decreaseFrames = Math.max(0, Math.trunc(fade.decreaseFrames));

  const elapsed = currentLogicFrame - fade.startFrame;
  if (elapsed < 0) {
    return minFade;
  }

  if (increaseFrames > 0 && elapsed < increaseFrames) {
    const t = elapsed / increaseFrames;
    return minFade + (maxFade - minFade) * t;
  }

  const holdStart = increaseFrames;
  const holdEnd = holdStart + holdFrames;
  if (elapsed < holdEnd) {
    return maxFade;
  }

  const decreaseStart = holdEnd;
  const decreaseEnd = decreaseStart + decreaseFrames;
  if (decreaseFrames > 0 && elapsed < decreaseEnd) {
    const t = (elapsed - decreaseStart) / decreaseFrames;
    return maxFade + (minFade - maxFade) * t;
  }

  return minFade;
}

function hasFadeExpired(
  fade: ActiveFadeState | null,
  currentLogicFrame: number,
): boolean {
  if (!fade) {
    return false;
  }
  const totalFrames =
    Math.max(0, Math.trunc(fade.increaseFrames))
    + Math.max(0, Math.trunc(fade.holdFrames))
    + Math.max(0, Math.trunc(fade.decreaseFrames));
  return (currentLogicFrame - fade.startFrame) > totalFrames;
}

export function createScriptCameraEffectsRuntimeBridge(
  options: CreateScriptCameraEffectsRuntimeBridgeOptions,
): ScriptCameraEffectsRuntimeBridge {
  const {
    gameLogic,
    getCameraTargetPosition,
    onMotionBlurJumpToPosition,
    initialFadeState = null,
  } = options;

  let grayscale = 0;
  let grayscaleTransition: ScalarTransition | null = null;
  let activeFade: ActiveFadeState | null = initialFadeState
    ? {
        fadeType: initialFadeState.fadeType,
        minFade: initialFadeState.minFade,
        maxFade: initialFadeState.maxFade,
        increaseFrames: initialFadeState.increaseFrames,
        holdFrames: initialFadeState.holdFrames,
        decreaseFrames: initialFadeState.decreaseFrames,
        startFrame: -Math.max(0, Math.trunc(initialFadeState.currentFadeFrame)),
      }
    : null;
  let activeOneShotMotionBlur: ActiveOneShotMotionBlurState | null = null;
  let activeMotionBlurFollow: ActiveMotionBlurFollowState | null = null;
  let previousCameraTarget: { x: number; z: number } | null = null;
  let lastLogicFrame = 0;
  let lastScreenShakeFrame = -1;
  const activeShakes: ActiveShakeState[] = [];

  return {
    syncAfterSimulationStep(currentLogicFrame: number): ScriptCameraEffectsState {
      lastLogicFrame = currentLogicFrame;
      const blackWhiteRequests = gameLogic.drainScriptCameraBlackWhiteRequests();
      for (const request of blackWhiteRequests) {
        const targetGrayscale = request.enabled ? 1 : 0;
        const durationFrames = Math.max(0, Math.trunc(request.fadeFrames));
        const requestFrame = Number.isFinite(request.frame)
          ? Math.trunc(request.frame)
          : currentLogicFrame;
        if (durationFrames <= 0) {
          grayscale = targetGrayscale;
          grayscaleTransition = null;
        } else {
          grayscaleTransition = {
            startFrame: requestFrame,
            durationFrames,
            from: grayscale,
            to: targetGrayscale,
          };
        }
      }

      if (grayscaleTransition) {
        grayscale = clamp01(evaluateScalarTransition(grayscaleTransition, currentLogicFrame));
        if (currentLogicFrame >= grayscaleTransition.startFrame + grayscaleTransition.durationFrames) {
          grayscale = clamp01(grayscaleTransition.to);
          grayscaleTransition = null;
        }
      }

      const fadeRequests = gameLogic.drainScriptCameraFadeRequests();
      for (const request of fadeRequests) {
        const requestFrame = Number.isFinite(request.frame)
          ? Math.trunc(request.frame)
          : currentLogicFrame;
        activeFade = {
          fadeType: request.fadeType,
          minFade: request.minFade,
          maxFade: request.maxFade,
          increaseFrames: request.increaseFrames,
          holdFrames: request.holdFrames,
          decreaseFrames: request.decreaseFrames,
          startFrame: requestFrame,
        };
      }

      const filterRequests = gameLogic.drainScriptCameraFilterRequests();
      for (const request of filterRequests) {
        switch (request.requestType) {
          case 'MOTION_BLUR': {
            const saturationBoost = request.saturate ? 0.35 : 0;
            const zoomIn = request.zoomIn !== false;
            activeOneShotMotionBlur = {
              maxCount: zoomIn ? 0 : MOTION_BLUR_MAX_COUNT,
              decrement: !zoomIn,
              saturationBoost,
              doZoomTo: false,
              jumpTarget: null,
            };
            break;
          }
          case 'MOTION_BLUR_JUMP': {
            const saturationBoost = request.saturate ? 0.35 : 0;
            const jumpTarget = (request.x !== null && request.z !== null
              && Number.isFinite(request.x) && Number.isFinite(request.z))
              ? { x: request.x, z: request.z }
              : null;
            activeOneShotMotionBlur = {
              maxCount: 0,
              decrement: false,
              saturationBoost,
              doZoomTo: true,
              jumpTarget,
            };
            break;
          }
          case 'MOTION_BLUR_FOLLOW': {
            const followMode = request.followMode !== null ? Math.trunc(request.followMode) : 0;
            const panFactor = followMode > 0 ? followMode : MOTION_BLUR_DEFAULT_PAN_FACTOR;
            activeMotionBlurFollow = {
              panFactor,
              maxCount: Math.max(1, panFactor / 2),
              ending: false,
            };
            break;
          }
          case 'MOTION_BLUR_END_FOLLOW':
            if (activeMotionBlurFollow) {
              activeMotionBlurFollow.ending = true;
            }
            break;
        }
      }

      const shakerRequests = gameLogic.drainScriptCameraShakerRequests();
      for (const request of shakerRequests) {
        const durationFrames = Math.max(1, Math.trunc(request.durationSeconds * LOGIC_FRAME_RATE));
        const requestFrame = Number.isFinite(request.frame)
          ? Math.trunc(request.frame)
          : currentLogicFrame;
        if (!Number.isFinite(request.amplitude) || request.amplitude <= 0) {
          continue;
        }
        activeShakes.push({
          startFrame: requestFrame,
          durationFrames,
          amplitude: request.amplitude,
          seed: request.frame + request.x * 0.17 + request.z * 0.29,
          x: request.x,
          z: request.z,
          radius: request.radius,
        });
      }

      const screenShake = gameLogic.getScriptScreenShakeState?.() ?? null;
      if (screenShake && screenShake.frame !== lastScreenShakeFrame) {
        lastScreenShakeFrame = screenShake.frame;
        const amplitude = Math.max(0, Math.trunc(screenShake.intensity));
        if (amplitude > 0) {
          activeShakes.push({
            startFrame: currentLogicFrame,
            durationFrames: SCREEN_SHAKE_DURATION_FRAMES,
            amplitude: amplitude * 0.75,
            seed: screenShake.frame,
            x: 0,
            z: 0,
            radius: 0,
          });
        }
      }

      const cameraTarget = getCameraTargetPosition?.() ?? null;
      const cameraTargetX = cameraTarget && Number.isFinite(cameraTarget.x) ? cameraTarget.x : null;
      const cameraTargetZ = cameraTarget && Number.isFinite(cameraTarget.z) ? cameraTarget.z : null;
      if (activeMotionBlurFollow) {
        if (activeMotionBlurFollow.ending) {
          activeMotionBlurFollow.maxCount -= 1;
          if (activeMotionBlurFollow.maxCount < MOTION_BLUR_END_MIN_COUNT) {
            activeMotionBlurFollow = null;
          }
        } else {
          const deltaX = cameraTargetX !== null && previousCameraTarget
            ? (cameraTargetX - previousCameraTarget.x)
            : 0;
          const deltaZ = cameraTargetZ !== null && previousCameraTarget
            ? (cameraTargetZ - previousCameraTarget.z)
            : 0;
          const deltaLength = Math.hypot(deltaX, deltaZ);
          const panFactor = activeMotionBlurFollow.panFactor;
          let maxCount = (deltaLength * 200 * panFactor) / MOTION_BLUR_DEFAULT_PAN_FACTOR;
          const minCount = panFactor / 2;
          if (maxCount < minCount) {
            maxCount = minCount;
          }
          if (maxCount > panFactor) {
            maxCount = panFactor;
          }
          activeMotionBlurFollow.maxCount = maxCount;
        }
      }
      if (cameraTargetX !== null && cameraTargetZ !== null) {
        previousCameraTarget = { x: cameraTargetX, z: cameraTargetZ };
      } else {
        previousCameraTarget = null;
      }
      let oneShotBlurPixels = 0;
      let oneShotSaturation = 1;
      if (activeOneShotMotionBlur) {
        let clearOneShotAfterFrame = false;
        if (activeOneShotMotionBlur.decrement) {
          activeOneShotMotionBlur.maxCount -= MOTION_BLUR_COUNT_STEP;
          if (activeOneShotMotionBlur.maxCount < 1) {
            activeOneShotMotionBlur.maxCount = 0;
            clearOneShotAfterFrame = true;
          }
        } else {
          activeOneShotMotionBlur.maxCount += MOTION_BLUR_COUNT_STEP;
          if (activeOneShotMotionBlur.maxCount >= MOTION_BLUR_MAX_COUNT) {
            activeOneShotMotionBlur.maxCount = MOTION_BLUR_MAX_COUNT;
            activeOneShotMotionBlur.decrement = true;
            if (activeOneShotMotionBlur.doZoomTo) {
              if (activeOneShotMotionBlur.jumpTarget) {
                onMotionBlurJumpToPosition?.(
                  activeOneShotMotionBlur.jumpTarget.x,
                  activeOneShotMotionBlur.jumpTarget.z,
                );
              }
            } else {
              clearOneShotAfterFrame = true;
            }
          }
        }

        oneShotBlurPixels = 2 * (activeOneShotMotionBlur.maxCount / MOTION_BLUR_MAX_COUNT);
        oneShotSaturation = 1 + activeOneShotMotionBlur.saturationBoost;

        if (clearOneShotAfterFrame) {
          activeOneShotMotionBlur = null;
        }
      }

      let shakeOffsetX = 0;
      let shakeOffsetY = 0;
      for (let i = activeShakes.length - 1; i >= 0; i--) {
        const shake = activeShakes[i]!;
        const ageFrames = currentLogicFrame - shake.startFrame;
        if (ageFrames >= shake.durationFrames) {
          activeShakes.splice(i, 1);
          continue;
        }
        const normalizedAge = ageFrames / shake.durationFrames;
        let frameAmplitude = shake.amplitude * (1 - normalizedAge);
        if (shake.radius > 0 && cameraTargetX !== null && cameraTargetZ !== null) {
          const dx = cameraTargetX - shake.x;
          const dz = cameraTargetZ - shake.z;
          const distance = Math.hypot(dx, dz);
          if (distance > shake.radius) {
            continue;
          }
          frameAmplitude *= (1 - distance / shake.radius);
        }
        if (frameAmplitude <= 0) {
          continue;
        }
        shakeOffsetX += Math.sin((ageFrames + shake.seed) * 0.73) * frameAmplitude;
        shakeOffsetY += Math.cos((ageFrames + shake.seed) * 0.91) * frameAmplitude;
      }

      const followBlurPixels = activeMotionBlurFollow
        ? 2 * (activeMotionBlurFollow.maxCount / Math.max(1, activeMotionBlurFollow.panFactor))
        : 0;
      const blurPixels = Math.max(
        oneShotBlurPixels,
        Number.isFinite(followBlurPixels) ? Math.max(0, followBlurPixels) : 0,
      );
      const saturation = oneShotBlurPixels > 0 ? oneShotSaturation : 1;
      if (hasFadeExpired(activeFade, currentLogicFrame)) {
        activeFade = null;
      }

      const fadeAmount = activeFade
        ? clamp01(evaluateFadeAmount(activeFade, currentLogicFrame))
        : 0;
      const fadeType = activeFade ? activeFade.fadeType : null;

      return {
        grayscale,
        saturation,
        blurPixels,
        fadeType,
        fadeAmount,
        shakeOffsetX,
        shakeOffsetY,
      };
    },
    captureActiveFadeSaveState(): ScriptCameraEffectFadeSaveState | null {
      if (!activeFade) {
        return null;
      }
      const currentFadeFrame = Math.max(0, Math.trunc(lastLogicFrame - activeFade.startFrame));
      return {
        fadeType: activeFade.fadeType,
        minFade: activeFade.minFade,
        maxFade: activeFade.maxFade,
        currentFadeValue: clamp01(evaluateFadeAmount(activeFade, lastLogicFrame)),
        currentFadeFrame,
        increaseFrames: activeFade.increaseFrames,
        holdFrames: activeFade.holdFrames,
        decreaseFrames: activeFade.decreaseFrames,
      };
    },
  };
}
