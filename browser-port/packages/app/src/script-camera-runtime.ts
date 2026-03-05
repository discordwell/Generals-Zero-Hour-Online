import type { CameraState } from '@generals/input';

const TWO_PI = Math.PI * 2;
const MIN_DIRECTION_LENGTH = 0.1;
const WAYPOINT_PATH_MIN_DELTA = 10;

export interface ScriptCameraActionRequestState {
  requestType: 'MOVE_TO' | 'MOVE_ALONG_WAYPOINT_PATH' | 'RESET' | 'ROTATE' | 'SETUP' | 'ZOOM' | 'PITCH';
  waypointName: string | null;
  lookAtWaypointName: string | null;
  x: number | null;
  z: number | null;
  lookAtX: number | null;
  lookAtZ: number | null;
  durationMs: number;
  cameraStutterMs: number;
  easeInMs: number;
  easeOutMs: number;
  rotations: number | null;
  zoom: number | null;
  pitch: number | null;
  frame: number;
}

export interface ScriptCameraModifierRequestState {
  requestType:
    | 'FREEZE_TIME'
    | 'FREEZE_ANGLE'
    | 'FINAL_ZOOM'
    | 'FINAL_PITCH'
    | 'FINAL_SPEED_MULTIPLIER'
    | 'ROLLING_AVERAGE'
    | 'FINAL_LOOK_TOWARD'
    | 'LOOK_TOWARD'
    | 'MOVE_TO_SELECTION';
  waypointName: string | null;
  x: number | null;
  z: number | null;
  zoom: number | null;
  pitch: number | null;
  easeIn: number | null;
  easeOut: number | null;
  speedMultiplier: number | null;
  rollingAverageFrames: number | null;
  frame: number;
}

export interface ScriptCameraTetherState {
  entityId: number;
  immediate: boolean;
  play: number;
}

export interface ScriptCameraFollowState {
  entityId: number;
  snapToUnit: boolean;
}

export interface ScriptCameraDefaultViewState {
  pitch: number;
  angle: number;
  maxHeight: number;
}

export interface ScriptCameraLookTowardObjectState {
  entityId: number;
  durationMs: number;
  holdMs: number;
  easeInMs: number;
  easeOutMs: number;
}

export interface ScriptCameraLookTowardWaypointState {
  waypointName: string;
  x: number;
  z: number;
  durationMs: number;
  easeInMs: number;
  easeOutMs: number;
  reverseRotation: boolean;
}

export interface ScriptCameraSlaveModeState {
  thingTemplateName: string;
  boneName: string;
}

export interface ScriptCameraRuntimeGameLogic {
  drainScriptCameraActionRequests(): ScriptCameraActionRequestState[];
  drainScriptCameraModifierRequests(): ScriptCameraModifierRequestState[];
  resolveScriptCameraWaypointPath?(waypointName: string): ReadonlyArray<{ x: number; z: number }> | null;
  getScriptCameraTetherState?(): ScriptCameraTetherState | null;
  getScriptCameraFollowState?(): ScriptCameraFollowState | null;
  getScriptCameraSlaveModeState?(): ScriptCameraSlaveModeState | null;
  getScriptCameraDefaultViewState?(): ScriptCameraDefaultViewState | null;
  getScriptCameraLookTowardObjectState?(): ScriptCameraLookTowardObjectState | null;
  getScriptCameraLookTowardWaypointState?(): ScriptCameraLookTowardWaypointState | null;
  getEntityWorldPosition?(entityId: number): readonly [number, number, number] | null;
  getRenderableEntityStates?(): ReadonlyArray<{
    id: number;
    templateName: string;
    x: number;
    y: number;
    z: number;
  }>;
}

export interface ScriptCameraRuntimeController {
  getState(): CameraState;
  setState(state: CameraState): void;
  lookAt(worldX: number, worldZ: number): void;
  panTo?(worldX: number, worldZ: number): void;
}

export interface ScriptCameraRuntimeBridge {
  syncAfterSimulationStep(currentLogicFrame: number): void;
  isCameraMovementFinished(): boolean;
  isCameraTimeFrozen(): boolean;
  getCameraTimeMultiplier(): number;
}

export interface CreateScriptCameraRuntimeBridgeOptions {
  gameLogic: ScriptCameraRuntimeGameLogic;
  cameraController: ScriptCameraRuntimeController;
}

interface ScalarTransition {
  startFrame: number;
  durationFrames: number;
  from: number;
  to: number;
  easeIn: number;
  easeOut: number;
}

interface TargetTransition {
  startFrame: number;
  durationFrames: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  easeIn: number;
  easeOut: number;
  shutterFrames: number;
}

interface WaypointPathTransition {
  startFrame: number;
  durationFrames: number;
  points: ReadonlyArray<{ x: number; z: number }>;
  cumulativeDistances: ReadonlyArray<number>;
  cameraAngles: ReadonlyArray<number>;
  timeMultipliers: ReadonlyArray<number>;
  totalDistance: number;
  easeIn: number;
  easeOut: number;
  shutterFrames: number;
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= TWO_PI;
  }
  while (normalized <= -Math.PI) {
    normalized += TWO_PI;
  }
  return normalized;
}

function toDurationFrames(durationMs: number): number {
  const normalizedMs = Number.isFinite(durationMs) ? Math.trunc(durationMs) : 0;
  if (normalizedMs < 1) {
    return 1;
  }
  return Math.max(1, Math.trunc((normalizedMs * 30) / 1000));
}

function toShutterFrames(cameraStutterMs: number): number {
  const normalizedMs = Number.isFinite(cameraStutterMs) ? Math.trunc(cameraStutterMs) : 0;
  if (normalizedMs < 1) {
    return 1;
  }
  return Math.max(1, Math.trunc((normalizedMs * 30) / 1000));
}

function getStutteredProgressState(
  currentLogicFrame: number,
  startFrame: number,
  durationFrames: number,
  shutterFrames: number,
): { linearProgress: number; advancedThisFrame: boolean } {
  const elapsedFrames = currentLogicFrame - startFrame + 1;
  if (elapsedFrames <= 0) {
    return { linearProgress: 0, advancedThisFrame: false };
  }
  if (elapsedFrames >= durationFrames) {
    return { linearProgress: 1, advancedThisFrame: true };
  }
  const normalizedShutterFrames = Math.max(1, shutterFrames);
  if (elapsedFrames < normalizedShutterFrames) {
    return { linearProgress: 0, advancedThisFrame: false };
  }
  const sampledElapsedFrames = Math.trunc(elapsedFrames / normalizedShutterFrames) * normalizedShutterFrames;
  return {
    linearProgress: sampledElapsedFrames / durationFrames,
    advancedThisFrame: elapsedFrames % normalizedShutterFrames === 0,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function toEaseRatioFromDuration(easeMs: number, durationMs: number): number {
  const normalizedDurationMs = Number.isFinite(durationMs)
    ? Math.max(1, Math.trunc(durationMs))
    : 1;
  return clamp01(easeMs / normalizedDurationMs);
}

function evaluateParabolicEase(progress: number, easeIn: number, easeOut: number): number {
  const normalizedProgress = clamp01(progress);
  let inTime = clamp01(easeIn);
  const outTime = clamp01(easeOut);
  const outStart = 1 - outTime;
  if (inTime > outStart) {
    inTime = outStart;
  }
  const v0 = 1 + outStart - inTime;
  if (normalizedProgress < inTime) {
    return (normalizedProgress * normalizedProgress) / (v0 * inTime);
  }
  if (normalizedProgress <= outStart) {
    return (inTime + 2 * (normalizedProgress - inTime)) / v0;
  }
  return (
    inTime
    + 2 * (outStart - inTime)
    + (
      2 * (normalizedProgress - outStart)
      + (outStart * outStart)
      - (normalizedProgress * normalizedProgress)
    ) / (1 - outStart)
  ) / v0;
}

function getTransitionProgress(currentLogicFrame: number, startFrame: number, durationFrames: number): number {
  const elapsedFrames = currentLogicFrame - startFrame + 1;
  if (elapsedFrames <= 0) {
    return 0;
  }
  if (elapsedFrames >= durationFrames) {
    return 1;
  }
  return elapsedFrames / durationFrames;
}

function evaluateScalarTransition(transition: ScalarTransition, currentLogicFrame: number): number {
  const linearProgress = getTransitionProgress(
    currentLogicFrame,
    transition.startFrame,
    transition.durationFrames,
  );
  const progress = evaluateParabolicEase(linearProgress, transition.easeIn, transition.easeOut);
  return transition.from + (transition.to - transition.from) * progress;
}

function evaluateTargetTransition(
  transition: TargetTransition,
  currentLogicFrame: number,
): { x: number; z: number } {
  const { linearProgress } = getStutteredProgressState(
    currentLogicFrame,
    transition.startFrame,
    transition.durationFrames,
    transition.shutterFrames,
  );
  const progress = evaluateParabolicEase(linearProgress, transition.easeIn, transition.easeOut);
  return {
    x: transition.fromX + (transition.toX - transition.fromX) * progress,
    z: transition.fromZ + (transition.toZ - transition.fromZ) * progress,
  };
}

function interpolateHeadingAngle(fromAngle: number, toAngle: number, factor: number): number {
  let from = fromAngle;
  const to = toAngle;
  if (to - from > Math.PI) {
    from += TWO_PI;
  } else if (to - from < -Math.PI) {
    from -= TWO_PI;
  }
  return normalizeAngle((from * (1 - factor)) + (to * factor));
}

function midpoint(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number } {
  return {
    x: (a.x + b.x) * 0.5,
    z: (a.z + b.z) * 0.5,
  };
}

function getWaypointPathPointWithPadding(
  points: ReadonlyArray<{ x: number; z: number }>,
  index: number,
): { x: number; z: number } {
  if (points.length === 0) {
    return { x: 0, z: 0 };
  }
  if (points.length === 1) {
    return { x: points[0]!.x, z: points[0]!.z };
  }

  const pointCount = points.length;
  if (index <= 0) {
    const first = points[0]!;
    const second = points[1]!;
    return {
      x: first.x - (second.x - first.x),
      z: first.z - (second.z - first.z),
    };
  }
  if (index >= pointCount + 1) {
    const last = points[pointCount - 1]!;
    const previous = points[pointCount - 2]!;
    return {
      x: last.x + (last.x - previous.x),
      z: last.z + (last.z - previous.z),
    };
  }
  return {
    x: points[index - 1]!.x,
    z: points[index - 1]!.z,
  };
}

function sampleWaypointPathCurve(
  points: ReadonlyArray<{ x: number; z: number }>,
  segmentIndex: number,
  segmentProgress: number,
): { x: number; z: number } {
  let factor = segmentProgress;
  let start: { x: number; z: number };
  let mid: { x: number; z: number };
  let end: { x: number; z: number };

  if (factor < 0.5) {
    const previous = getWaypointPathPointWithPadding(points, segmentIndex - 1);
    const current = getWaypointPathPointWithPadding(points, segmentIndex);
    const next = getWaypointPathPointWithPadding(points, segmentIndex + 1);
    start = midpoint(previous, current);
    mid = current;
    end = midpoint(current, next);
    factor += 0.5;
  } else {
    const current = getWaypointPathPointWithPadding(points, segmentIndex);
    const next = getWaypointPathPointWithPadding(points, segmentIndex + 1);
    const nextNext = getWaypointPathPointWithPadding(points, segmentIndex + 2);
    start = midpoint(current, next);
    mid = next;
    end = midpoint(next, nextNext);
    factor -= 0.5;
  }

  return {
    x: start.x
      + (factor * (end.x - start.x))
      + ((1 - factor) * factor * (mid.x - end.x + mid.x - start.x)),
    z: start.z
      + (factor * (end.z - start.z))
      + ((1 - factor) * factor * (mid.z - end.z + mid.z - start.z)),
  };
}

function evaluateWaypointPathTransition(
  transition: WaypointPathTransition,
  currentLogicFrame: number,
): {
  x: number;
  z: number;
  segmentIndex: number;
  segmentProgress: number;
  headingAngle: number | null;
  timeMultiplier: number;
  advancedThisFrame: boolean;
} {
  const { linearProgress, advancedThisFrame } = getStutteredProgressState(
    currentLogicFrame,
    transition.startFrame,
    transition.durationFrames,
    transition.shutterFrames,
  );
  const progress = evaluateParabolicEase(linearProgress, transition.easeIn, transition.easeOut);
  const travelledDistance = transition.totalDistance * progress;
  const points = transition.points;
  const cumulativeDistances = transition.cumulativeDistances;
  const cameraAngles = transition.cameraAngles;
  const timeMultipliers = transition.timeMultipliers;
  const lastPoint = points[points.length - 1]!;
  if (travelledDistance <= 0) {
    const headingAngle = cameraAngles[0] ?? null;
    const timeMultiplier = Math.floor(0.5 + (timeMultipliers[0] ?? 1));
    return {
      x: points[0]!.x,
      z: points[0]!.z,
      segmentIndex: 1,
      segmentProgress: 0,
      headingAngle,
      timeMultiplier,
      advancedThisFrame,
    };
  }
  if (travelledDistance >= transition.totalDistance) {
    const headingAngle = cameraAngles[cameraAngles.length - 1] ?? null;
    const timeMultiplier = Math.floor(0.5 + (timeMultipliers[timeMultipliers.length - 1] ?? 1));
    return {
      x: lastPoint.x,
      z: lastPoint.z,
      segmentIndex: Math.max(1, points.length - 1),
      segmentProgress: 1,
      headingAngle,
      timeMultiplier,
      advancedThisFrame,
    };
  }

  for (let i = 1; i < cumulativeDistances.length; i += 1) {
    const segmentEndDistance = cumulativeDistances[i]!;
    if (travelledDistance > segmentEndDistance) {
      continue;
    }
    const segmentStartDistance = cumulativeDistances[i - 1]!;
    const segmentLength = segmentEndDistance - segmentStartDistance;
    if (segmentLength <= 0) {
      const point = points[i]!;
      const headingAngle = cameraAngles[i] ?? cameraAngles[i - 1] ?? null;
      const timeMultiplier = Math.floor(0.5 + (timeMultipliers[i] ?? timeMultipliers[i - 1] ?? 1));
      return {
        x: point.x,
        z: point.z,
        segmentIndex: i,
        segmentProgress: 1,
        headingAngle,
        timeMultiplier,
        advancedThisFrame,
      };
    }
    const segmentProgress = (travelledDistance - segmentStartDistance) / segmentLength;
    const fromAngle = cameraAngles[i - 1] ?? 0;
    const toAngle = cameraAngles[i] ?? fromAngle;
    const headingAngle = interpolateHeadingAngle(fromAngle, toAngle, segmentProgress);
    const fromMultiplier = timeMultipliers[i - 1] ?? 1;
    const toMultiplier = timeMultipliers[i] ?? fromMultiplier;
    const timeMultiplier = Math.floor(
      0.5 + ((fromMultiplier * (1 - segmentProgress)) + (toMultiplier * segmentProgress)),
    );
    const curvedPoint = sampleWaypointPathCurve(points, i, segmentProgress);
    return {
      x: curvedPoint.x,
      z: curvedPoint.z,
      segmentIndex: i,
      segmentProgress,
      headingAngle,
      timeMultiplier,
      advancedThisFrame,
    };
  }

  const headingAngle = cameraAngles[cameraAngles.length - 1] ?? null;
  const timeMultiplier = Math.floor(0.5 + (timeMultipliers[timeMultipliers.length - 1] ?? 1));
  return {
    x: lastPoint.x,
    z: lastPoint.z,
    segmentIndex: Math.max(1, points.length - 1),
    segmentProgress: 1,
    headingAngle,
    timeMultiplier,
    advancedThisFrame,
  };
}

function isTransitionComplete(
  transition: ScalarTransition | TargetTransition | WaypointPathTransition,
  currentLogicFrame: number,
): boolean {
  return getTransitionProgress(
    currentLogicFrame,
    transition.startFrame,
    transition.durationFrames,
  ) >= 1;
}

function getRemainingFrames(
  transition: ScalarTransition | TargetTransition | WaypointPathTransition | null,
  currentLogicFrame: number,
): number {
  if (!transition) {
    return 0;
  }
  const elapsedFrames = currentLogicFrame - transition.startFrame + 1;
  return Math.max(0, transition.durationFrames - elapsedFrames);
}

function resolveLookTowardAngle(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  reverseRotation = false,
  currentAngle = 0,
): number | null {
  const dirX = toX - fromX;
  const dirZ = toZ - fromZ;
  const dirLength = Math.hypot(dirX, dirZ);
  if (dirLength < MIN_DIRECTION_LENGTH) {
    return null;
  }

  const clampedX = Math.max(-1, Math.min(1, dirX / dirLength));
  let angle = Math.acos(clampedX);
  if (dirZ < 0) {
    angle = -angle;
  }
  angle -= Math.PI / 2;
  const normalizedAngle = normalizeAngle(angle);
  if (!reverseRotation) {
    return normalizedAngle;
  }

  if (currentAngle < normalizedAngle) {
    return normalizedAngle - TWO_PI;
  }
  return normalizedAngle + TWO_PI;
}

export function createScriptCameraRuntimeBridge(
  options: CreateScriptCameraRuntimeBridgeOptions,
): ScriptCameraRuntimeBridge {
  const { gameLogic, cameraController } = options;

  const defaultCameraState = cameraController.getState();

  let targetTransition: TargetTransition | null = null;
  let waypointPathTransition: WaypointPathTransition | null = null;
  let angleTransition: ScalarTransition | null = null;
  let zoomTransition: ScalarTransition | null = null;
  let pitchTransition: ScalarTransition | null = null;
  let nonVisualMovementEndFrame = -1;
  let movementFinished = true;
  let freezeTimeForMovement = false;
  let cameraTimeMultiplier = 1;
  let timeMultiplierTransition: ScalarTransition | null = null;
  let waypointPathRollingAverageFrames = 1;
  let frozenWaypointPathAngle: number | null = null;
  let lastCameraLockSignature: string | null = null;
  let lastLookTowardObjectSignature: string | null = null;
  let lastLookTowardWaypointSignature: string | null = null;

  const beginTargetTransition = (
    currentLogicFrame: number,
    toX: number,
    toZ: number,
    durationFrames: number,
    easeIn = 0,
    easeOut = 0,
    shutterFrames = 1,
  ): void => {
    const state = cameraController.getState();
    frozenWaypointPathAngle = null;
    waypointPathTransition = null;
    targetTransition = {
      startFrame: currentLogicFrame,
      durationFrames,
      fromX: state.targetX,
      fromZ: state.targetZ,
      toX,
      toZ,
      easeIn: clamp01(easeIn),
      easeOut: clamp01(easeOut),
      shutterFrames: Math.max(1, Math.trunc(shutterFrames)),
    };
  };

  const beginWaypointPathTransition = (
    currentLogicFrame: number,
    pathPoints: ReadonlyArray<{ x: number; z: number }>,
    durationFrames: number,
    easeIn = 0,
    easeOut = 0,
    shutterFrames = 1,
    applyMinDeltaFilter = true,
  ): void => {
    const state = cameraController.getState();
    frozenWaypointPathAngle = null;
    waypointPathRollingAverageFrames = 1;
    const points: Array<{ x: number; z: number }> = [{ x: state.targetX, z: state.targetZ }];
    for (let i = 0; i < pathPoints.length; i += 1) {
      const point = pathPoints[i]!;
      points.push({ x: point.x, z: point.z });
      if (!applyMinDeltaFilter) {
        continue;
      }
      if (points.length < 2) {
        continue;
      }

      const previous = points[points.length - 2]!;
      const current = points[points.length - 1]!;
      const segmentLength = Math.hypot(current.x - previous.x, current.z - previous.z);
      if (segmentLength >= WAYPOINT_PATH_MIN_DELTA) {
        continue;
      }

      const hasMoreWaypoints = i < pathPoints.length - 1;
      if (hasMoreWaypoints) {
        points.pop();
        continue;
      }

      if (points.length >= 3) {
        points[points.length - 2] = { ...current };
        points.pop();
      } else {
        // Source parity: a final near-zero movement collapses to no waypoint path move.
        points.length = 1;
      }
    }
    if (points.length < 2) {
      return;
    }

    const cumulativeDistances: number[] = [0];
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1]!;
      const current = points[i]!;
      const segmentLength = Math.hypot(current.x - previous.x, current.z - previous.z);
      cumulativeDistances.push(cumulativeDistances[i - 1]! + segmentLength);
    }
    const cameraAngles: number[] = new Array(points.length).fill(state.angle);
    const timeMultipliers: number[] = new Array(points.length).fill(cameraTimeMultiplier);
    let segmentHeading = state.angle;
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1]!;
      const current = points[i]!;
      const headingAngle = resolveLookTowardAngle(previous.x, previous.z, current.x, current.z);
      if (headingAngle !== null) {
        segmentHeading = headingAngle;
      }
      cameraAngles[i - 1] = segmentHeading;
    }
    cameraAngles[0] = state.angle;
    if (points.length > 1) {
      cameraAngles[points.length - 1] = cameraAngles[points.length - 2] ?? state.angle;
      for (let i = points.length - 2; i > 0; i -= 1) {
        const previousAngle = cameraAngles[i - 1] ?? state.angle;
        const currentAngle = cameraAngles[i] ?? previousAngle;
        const deltaAngle = normalizeAngle(currentAngle - previousAngle);
        cameraAngles[i] = normalizeAngle(previousAngle + (deltaAngle * 0.5));
      }
    }
    const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
    if (totalDistance <= 0) {
      const finalPoint = points[points.length - 1]!;
      beginTargetTransition(currentLogicFrame, finalPoint.x, finalPoint.z, durationFrames, easeIn, easeOut);
      return;
    }

    targetTransition = null;
    waypointPathTransition = {
      startFrame: currentLogicFrame,
      durationFrames,
      points,
      cumulativeDistances,
      cameraAngles,
      timeMultipliers,
      totalDistance,
      easeIn: clamp01(easeIn),
      easeOut: clamp01(easeOut),
      shutterFrames: Math.max(1, Math.trunc(shutterFrames)),
    };
  };

  const beginAngleTransition = (
    currentLogicFrame: number,
    toAngle: number,
    durationFrames: number,
    easeIn = 0,
    easeOut = 0,
  ): void => {
    const state = cameraController.getState();
    angleTransition = {
      startFrame: currentLogicFrame,
      durationFrames,
      from: state.angle,
      to: toAngle,
      easeIn: clamp01(easeIn),
      easeOut: clamp01(easeOut),
    };
  };

  const beginZoomTransition = (
    currentLogicFrame: number,
    toZoom: number,
    durationFrames: number,
    easeIn = 0,
    easeOut = 0,
  ): void => {
    const state = cameraController.getState();
    zoomTransition = {
      startFrame: currentLogicFrame,
      durationFrames,
      from: state.zoom,
      to: toZoom,
      easeIn: clamp01(easeIn),
      easeOut: clamp01(easeOut),
    };
  };

  const beginPitchTransition = (
    currentLogicFrame: number,
    toPitch: number,
    durationFrames: number,
    easeIn = 0,
    easeOut = 0,
  ): void => {
    const state = cameraController.getState();
    pitchTransition = {
      startFrame: currentLogicFrame,
      durationFrames,
      from: state.pitch,
      to: toPitch,
      easeIn: clamp01(easeIn),
      easeOut: clamp01(easeOut),
    };
  };

  const applyActiveTransitions = (currentLogicFrame: number): void => {
    if (
      !targetTransition
      && !waypointPathTransition
      && !angleTransition
      && !zoomTransition
      && !pitchTransition
    ) {
      if (!timeMultiplierTransition) {
        return;
      }
    }

    if (timeMultiplierTransition) {
      cameraTimeMultiplier = evaluateScalarTransition(timeMultiplierTransition, currentLogicFrame);
      if (isTransitionComplete(timeMultiplierTransition, currentLogicFrame)) {
        cameraTimeMultiplier = timeMultiplierTransition.to;
        timeMultiplierTransition = null;
      }
    }

    const currentState = cameraController.getState();
    let nextTargetX = currentState.targetX;
    let nextTargetZ = currentState.targetZ;
    let nextAngle = currentState.angle;
    let nextZoom = currentState.zoom;
    let nextPitch = currentState.pitch;
    let stateChanged = false;

    if (targetTransition) {
      const interpolated = evaluateTargetTransition(targetTransition, currentLogicFrame);
      nextTargetX = interpolated.x;
      nextTargetZ = interpolated.z;
      stateChanged = true;
      if (isTransitionComplete(targetTransition, currentLogicFrame)) {
        targetTransition = null;
      }
    }

    if (waypointPathTransition) {
      const pathSample = evaluateWaypointPathTransition(waypointPathTransition, currentLogicFrame);
      nextTargetX = pathSample.x;
      nextTargetZ = pathSample.z;
      cameraTimeMultiplier = pathSample.timeMultiplier;
      stateChanged = true;
      if (!angleTransition && pathSample.advancedThisFrame && pathSample.headingAngle !== null) {
        if (frozenWaypointPathAngle !== null) {
          nextAngle = frozenWaypointPathAngle;
          stateChanged = true;
        } else {
          const desiredHeading = pathSample.headingAngle;
          const rollingAverageFrames = Math.max(1, waypointPathRollingAverageFrames);
          let avgFactor = 1 / rollingAverageFrames;
          if (pathSample.segmentIndex === waypointPathTransition.points.length - 1) {
            avgFactor = avgFactor + ((1 - avgFactor) * pathSample.segmentProgress);
          }
          let deltaAngle = desiredHeading - nextAngle;
          deltaAngle = normalizeAngle(deltaAngle);
          nextAngle = normalizeAngle(nextAngle + (avgFactor * deltaAngle));
          stateChanged = true;
        }
      } else if (!angleTransition && frozenWaypointPathAngle !== null) {
        nextAngle = frozenWaypointPathAngle;
        stateChanged = true;
      }
      if (isTransitionComplete(waypointPathTransition, currentLogicFrame)) {
        waypointPathTransition = null;
        frozenWaypointPathAngle = null;
      }
    }

    if (angleTransition) {
      nextAngle = evaluateScalarTransition(angleTransition, currentLogicFrame);
      stateChanged = true;
      if (isTransitionComplete(angleTransition, currentLogicFrame)) {
        angleTransition = null;
      }
    }

    if (zoomTransition) {
      nextZoom = evaluateScalarTransition(zoomTransition, currentLogicFrame);
      stateChanged = true;
      if (isTransitionComplete(zoomTransition, currentLogicFrame)) {
        zoomTransition = null;
      }
    }

    if (pitchTransition) {
      nextPitch = evaluateScalarTransition(pitchTransition, currentLogicFrame);
      stateChanged = true;
      if (isTransitionComplete(pitchTransition, currentLogicFrame)) {
        pitchTransition = null;
      }
    }

    if (stateChanged) {
      cameraController.setState({
        targetX: nextTargetX,
        targetZ: nextTargetZ,
        angle: nextAngle,
        zoom: nextZoom,
        pitch: nextPitch,
      });
    }
  };

  const getMaxVisualMovementRemainingFrames = (currentLogicFrame: number): number => {
    return Math.max(
      getRemainingFrames(targetTransition, currentLogicFrame),
      getRemainingFrames(waypointPathTransition, currentLogicFrame),
      getRemainingFrames(angleTransition, currentLogicFrame),
      getRemainingFrames(zoomTransition, currentLogicFrame),
      getRemainingFrames(pitchTransition, currentLogicFrame),
    );
  };

  const processActionRequests = (currentLogicFrame: number): void => {
    const requests = gameLogic.drainScriptCameraActionRequests();
    for (const request of requests) {
      switch (request.requestType) {
        case 'MOVE_TO': {
          if (request.x === null || request.z === null) {
            break;
          }
          beginWaypointPathTransition(
            currentLogicFrame,
            [{ x: request.x, z: request.z }],
            toDurationFrames(request.durationMs),
            toEaseRatioFromDuration(request.easeInMs, request.durationMs),
            toEaseRatioFromDuration(request.easeOutMs, request.durationMs),
            1,
            false,
          );
          break;
        }

        case 'MOVE_ALONG_WAYPOINT_PATH': {
          if (request.x === null || request.z === null) {
            break;
          }
          const durationFrames = toDurationFrames(request.durationMs);
          const easeIn = toEaseRatioFromDuration(request.easeInMs, request.durationMs);
          const easeOut = toEaseRatioFromDuration(request.easeOutMs, request.durationMs);
          const shutterFrames = toShutterFrames(request.cameraStutterMs);
          const waypointPath = request.waypointName
            ? (gameLogic.resolveScriptCameraWaypointPath?.(request.waypointName) ?? null)
            : null;
          if (waypointPath && waypointPath.length > 0) {
            beginWaypointPathTransition(
              currentLogicFrame,
              waypointPath,
              durationFrames,
              easeIn,
              easeOut,
              shutterFrames,
            );
            break;
          }
          beginTargetTransition(
            currentLogicFrame,
            request.x,
            request.z,
            durationFrames,
            easeIn,
            easeOut,
            shutterFrames,
          );
          break;
        }

        case 'RESET': {
          if (request.x === null || request.z === null) {
            break;
          }
          const scriptDefaultView = gameLogic.getScriptCameraDefaultViewState?.() ?? null;
          const durationFrames = toDurationFrames(request.durationMs);
          const resetAngle = scriptDefaultView && Number.isFinite(scriptDefaultView.angle)
            ? normalizeAngle((scriptDefaultView.angle * Math.PI) / 180)
            : 0;
          const resetZoom = scriptDefaultView
            && Number.isFinite(scriptDefaultView.maxHeight)
            && scriptDefaultView.maxHeight > 0
            ? scriptDefaultView.maxHeight
            : defaultCameraState.zoom;
          const easeIn = toEaseRatioFromDuration(request.easeInMs, request.durationMs);
          const easeOut = toEaseRatioFromDuration(request.easeOutMs, request.durationMs);

          beginTargetTransition(currentLogicFrame, request.x, request.z, durationFrames, easeIn, easeOut);
          beginAngleTransition(currentLogicFrame, resetAngle, durationFrames, easeIn, easeOut);
          beginZoomTransition(currentLogicFrame, resetZoom, durationFrames, easeIn, easeOut);
          beginPitchTransition(currentLogicFrame, 1, durationFrames, easeIn, easeOut);
          break;
        }

        case 'ROTATE': {
          if (request.rotations === null || !Number.isFinite(request.rotations)) {
            break;
          }
          const state = cameraController.getState();
          beginAngleTransition(
            currentLogicFrame,
            state.angle + TWO_PI * request.rotations,
            toDurationFrames(request.durationMs),
            toEaseRatioFromDuration(request.easeInMs, request.durationMs),
            toEaseRatioFromDuration(request.easeOutMs, request.durationMs),
          );
          break;
        }

        case 'SETUP': {
          if (request.x === null || request.z === null) {
            break;
          }
          cameraController.lookAt(request.x, request.z);
          const state = cameraController.getState();
          const nextState: CameraState = { ...state };

          if (request.lookAtX !== null && request.lookAtZ !== null) {
            const lookTowardAngle = resolveLookTowardAngle(
              request.x,
              request.z,
              request.lookAtX,
              request.lookAtZ,
            );
            if (lookTowardAngle !== null) {
              nextState.angle = lookTowardAngle;
            }
          }
          if (request.zoom !== null && Number.isFinite(request.zoom)) {
            nextState.zoom = request.zoom;
          }
          if (request.pitch !== null && Number.isFinite(request.pitch)) {
            nextState.pitch = request.pitch;
          }
          cameraController.setState(nextState);
          targetTransition = null;
          waypointPathTransition = null;
          frozenWaypointPathAngle = null;
          angleTransition = null;
          zoomTransition = null;
          pitchTransition = null;
          break;
        }

        case 'ZOOM': {
          if (request.zoom === null || !Number.isFinite(request.zoom)) {
            break;
          }
          beginZoomTransition(
            currentLogicFrame,
            request.zoom,
            toDurationFrames(request.durationMs),
            toEaseRatioFromDuration(request.easeInMs, request.durationMs),
            toEaseRatioFromDuration(request.easeOutMs, request.durationMs),
          );
          break;
        }

        case 'PITCH': {
          if (request.pitch === null || !Number.isFinite(request.pitch)) {
            break;
          }
          beginPitchTransition(
            currentLogicFrame,
            request.pitch,
            toDurationFrames(request.durationMs),
            toEaseRatioFromDuration(request.easeInMs, request.durationMs),
            toEaseRatioFromDuration(request.easeOutMs, request.durationMs),
          );
          break;
        }
      }
    }
  };

  const processModifierRequests = (currentLogicFrame: number): void => {
    const requests = gameLogic.drainScriptCameraModifierRequests();
    for (const request of requests) {
      switch (request.requestType) {
        case 'FREEZE_ANGLE': {
          if (!angleTransition && !waypointPathTransition) {
            break;
          }
          if (angleTransition) {
            const state = cameraController.getState();
            const frozenAngle = evaluateScalarTransition(angleTransition, currentLogicFrame);
            cameraController.setState({ ...state, angle: frozenAngle });
            angleTransition = null;
          }
          if (waypointPathTransition) {
            frozenWaypointPathAngle = waypointPathTransition.cameraAngles[0]
              ?? cameraController.getState().angle;
          }
          break;
        }

        case 'FINAL_ZOOM': {
          if (request.zoom === null || !Number.isFinite(request.zoom)) {
            break;
          }
          const remainingFrames = getMaxVisualMovementRemainingFrames(currentLogicFrame);
          if (remainingFrames < 1) {
            break;
          }
          beginZoomTransition(
            currentLogicFrame,
            request.zoom,
            remainingFrames,
            clamp01(request.easeIn ?? 0),
            clamp01(request.easeOut ?? 0),
          );
          break;
        }

        case 'MOVE_TO_SELECTION': {
          if (request.x === null || request.z === null) {
            break;
          }
          if (targetTransition) {
            targetTransition = {
              ...targetTransition,
              toX: request.x,
              toZ: request.z,
            };
            break;
          }
          if (!waypointPathTransition) {
            break;
          }
          const points = waypointPathTransition.points.map((point) => ({ ...point }));
          const finalPoint = points[points.length - 1]!;
          const deltaX = request.x - finalPoint.x;
          const deltaZ = request.z - finalPoint.z;
          for (let i = 1; i < points.length; i += 1) {
            points[i]!.x += deltaX;
            points[i]!.z += deltaZ;
          }
          const cumulativeDistances: number[] = [0];
          for (let i = 1; i < points.length; i += 1) {
            const previous = points[i - 1]!;
            const current = points[i]!;
            const segmentLength = Math.hypot(current.x - previous.x, current.z - previous.z);
            cumulativeDistances.push(cumulativeDistances[i - 1]! + segmentLength);
          }
          waypointPathTransition = {
            ...waypointPathTransition,
            points,
            cumulativeDistances,
            totalDistance: cumulativeDistances[cumulativeDistances.length - 1] ?? 0,
          };
          break;
        }

        case 'FINAL_LOOK_TOWARD':
        case 'LOOK_TOWARD': {
          if ((!targetTransition && !waypointPathTransition) || request.x === null || request.z === null) {
            break;
          }
          if (waypointPathTransition) {
            const lastPointIndex = waypointPathTransition.points.length - 1;
            const isFinalLookToward = request.requestType === 'FINAL_LOOK_TOWARD';
            const firstPointIndex = isFinalLookToward
              ? Math.max(1, lastPointIndex - 1)
              : 1;
            const cameraAngles = [...waypointPathTransition.cameraAngles];
            for (let pointIndex = firstPointIndex; pointIndex <= lastPointIndex; pointIndex += 1) {
              const lookSample = sampleWaypointPathCurve(waypointPathTransition.points, pointIndex, 0);
              const lookTowardHeading = resolveLookTowardAngle(
                lookSample.x,
                lookSample.z,
                request.x,
                request.z,
              );
              if (lookTowardHeading === null) {
                continue;
              }
              if (isFinalLookToward && pointIndex < lastPointIndex) {
                const currentAngle = cameraAngles[pointIndex] ?? lookTowardHeading;
                const deltaAngle = normalizeAngle(lookTowardHeading - currentAngle);
                cameraAngles[pointIndex] = normalizeAngle(currentAngle + (deltaAngle * 0.5));
              } else {
                cameraAngles[pointIndex] = lookTowardHeading;
              }
            }
            waypointPathTransition = {
              ...waypointPathTransition,
              cameraAngles,
            };
            // Keep request order semantics: later look-toward overrides earlier FREEZE_ANGLE.
            frozenWaypointPathAngle = null;
            break;
          }
          const lookFrom = targetTransition
            ? { x: targetTransition.toX, z: targetTransition.toZ }
            : null;
          if (!lookFrom) {
            break;
          }
          const lookTowardAngle = resolveLookTowardAngle(
            lookFrom.x,
            lookFrom.z,
            request.x,
            request.z,
          );
          if (lookTowardAngle === null) {
            break;
          }
          const remainingFrames = targetTransition
            ? getRemainingFrames(targetTransition, currentLogicFrame)
            : getRemainingFrames(waypointPathTransition, currentLogicFrame);
          if (remainingFrames < 1) {
            break;
          }
          beginAngleTransition(
            currentLogicFrame,
            lookTowardAngle,
            remainingFrames,
            0,
            0,
          );
          break;
        }

        case 'FINAL_PITCH': {
          if (request.pitch === null || !Number.isFinite(request.pitch)) {
            break;
          }
          const remainingFrames = getMaxVisualMovementRemainingFrames(currentLogicFrame);
          if (remainingFrames < 1) {
            break;
          }
          beginPitchTransition(
            currentLogicFrame,
            request.pitch,
            remainingFrames,
            clamp01(request.easeIn ?? 0),
            clamp01(request.easeOut ?? 0),
          );
          break;
        }

        case 'FREEZE_TIME':
          freezeTimeForMovement = true;
          break;
        case 'FINAL_SPEED_MULTIPLIER': {
          if (request.speedMultiplier === null || !Number.isFinite(request.speedMultiplier)) {
            break;
          }
          const finalMultiplier = request.speedMultiplier;
          if (waypointPathTransition) {
            const activeWaypointPathTransition = waypointPathTransition;
            const totalDistance = activeWaypointPathTransition.totalDistance;
            const nextMultipliers = activeWaypointPathTransition.timeMultipliers.map((currentMultiplier, index) => {
              if (totalDistance <= 0) {
                return Math.floor(0.5 + finalMultiplier);
              }
              const travelledDistance = activeWaypointPathTransition.cumulativeDistances[index] ?? totalDistance;
              const factor2 = clamp01(travelledDistance / totalDistance);
              const factor1 = 1 - factor2;
              return Math.floor(0.5 + ((currentMultiplier * factor1) + (finalMultiplier * factor2)));
            });
            waypointPathTransition = {
              ...activeWaypointPathTransition,
              timeMultipliers: nextMultipliers,
            };
            timeMultiplierTransition = null;
            break;
          }
          const remainingFrames = getMaxVisualMovementRemainingFrames(currentLogicFrame);
          if (remainingFrames < 1) {
            cameraTimeMultiplier = finalMultiplier;
            timeMultiplierTransition = null;
            break;
          }
          timeMultiplierTransition = {
            startFrame: currentLogicFrame,
            durationFrames: remainingFrames,
            from: cameraTimeMultiplier,
            to: finalMultiplier,
            easeIn: 0,
            easeOut: 0,
          };
          break;
        }
        case 'ROLLING_AVERAGE':
          waypointPathRollingAverageFrames = Math.max(
            1,
            Math.trunc(request.rollingAverageFrames ?? 1),
          );
          break;
      }
    }
  };

  const processLookTowardStates = (currentLogicFrame: number): void => {
    const lookTowardObjectState = gameLogic.getScriptCameraLookTowardObjectState?.() ?? null;
    if (!lookTowardObjectState) {
      lastLookTowardObjectSignature = null;
    } else {
      const signature = [
        lookTowardObjectState.entityId,
        lookTowardObjectState.durationMs,
        lookTowardObjectState.holdMs,
        lookTowardObjectState.easeInMs,
        lookTowardObjectState.easeOutMs,
      ].join(':');
      if (signature !== lastLookTowardObjectSignature) {
        const worldPosition = gameLogic.getEntityWorldPosition?.(lookTowardObjectState.entityId) ?? null;
        if (worldPosition) {
          const state = cameraController.getState();
          const lookTowardAngle = resolveLookTowardAngle(
            state.targetX,
            state.targetZ,
            worldPosition[0],
            worldPosition[2],
            false,
            state.angle,
          );
          if (lookTowardAngle !== null) {
            const durationFrames = toDurationFrames(lookTowardObjectState.durationMs);
            beginAngleTransition(
              currentLogicFrame,
              lookTowardAngle,
              durationFrames,
              toEaseRatioFromDuration(lookTowardObjectState.easeInMs, lookTowardObjectState.durationMs),
              toEaseRatioFromDuration(lookTowardObjectState.easeOutMs, lookTowardObjectState.durationMs),
            );
            const holdFrames = toDurationFrames(lookTowardObjectState.holdMs);
            nonVisualMovementEndFrame = Math.max(
              nonVisualMovementEndFrame,
              currentLogicFrame + durationFrames + holdFrames - 1,
            );
          }
        }
        lastLookTowardObjectSignature = signature;
      }
    }

    const lookTowardWaypointState = gameLogic.getScriptCameraLookTowardWaypointState?.() ?? null;
    if (!lookTowardWaypointState) {
      lastLookTowardWaypointSignature = null;
      return;
    }

    const signature = [
      lookTowardWaypointState.waypointName,
      lookTowardWaypointState.x,
      lookTowardWaypointState.z,
      lookTowardWaypointState.durationMs,
      lookTowardWaypointState.easeInMs,
      lookTowardWaypointState.easeOutMs,
      lookTowardWaypointState.reverseRotation ? 1 : 0,
    ].join(':');
    if (signature === lastLookTowardWaypointSignature) {
      return;
    }

    const state = cameraController.getState();
    const lookTowardAngle = resolveLookTowardAngle(
      state.targetX,
      state.targetZ,
      lookTowardWaypointState.x,
      lookTowardWaypointState.z,
      lookTowardWaypointState.reverseRotation,
      state.angle,
    );
    if (lookTowardAngle !== null) {
      beginAngleTransition(
        currentLogicFrame,
        lookTowardAngle,
        toDurationFrames(lookTowardWaypointState.durationMs),
        toEaseRatioFromDuration(lookTowardWaypointState.easeInMs, lookTowardWaypointState.durationMs),
        toEaseRatioFromDuration(lookTowardWaypointState.easeOutMs, lookTowardWaypointState.durationMs),
      );
    }
    lastLookTowardWaypointSignature = signature;
  };

  const processCameraLockStates = (): void => {
    const tetherState = gameLogic.getScriptCameraTetherState?.() ?? null;
    const followState = tetherState
      ? null
      : (gameLogic.getScriptCameraFollowState?.() ?? null);
    const slaveState = (!tetherState && !followState)
      ? (gameLogic.getScriptCameraSlaveModeState?.() ?? null)
      : null;

    if (!tetherState && !followState && !slaveState) {
      lastCameraLockSignature = null;
      return;
    }

    let lockSignature = '';
    let worldX = 0;
    let worldZ = 0;
    let shouldSnapOnAcquire = false;

    if (tetherState || followState) {
      const entityId = tetherState?.entityId ?? followState?.entityId ?? null;
      if (entityId === null) {
        return;
      }

      const worldPosition = gameLogic.getEntityWorldPosition?.(entityId) ?? null;
      if (!worldPosition) {
        return;
      }
      worldX = worldPosition[0];
      worldZ = worldPosition[2];

      lockSignature = tetherState
        ? `TETHER:${entityId}:${tetherState.immediate ? 1 : 0}:${tetherState.play}`
        : `FOLLOW:${entityId}:${followState?.snapToUnit ? 1 : 0}`;
      shouldSnapOnAcquire = tetherState?.immediate ?? followState?.snapToUnit ?? false;
    } else if (slaveState) {
      const normalizedTemplateName = slaveState.thingTemplateName.trim().toUpperCase();
      if (!normalizedTemplateName) {
        return;
      }
      const candidates = gameLogic.getRenderableEntityStates?.() ?? [];
      const matchedEntity = [...candidates]
        .sort((left, right) => left.id - right.id)
        .find((candidate) => candidate.templateName.trim().toUpperCase() === normalizedTemplateName);
      if (!matchedEntity) {
        return;
      }

      worldX = matchedEntity.x;
      worldZ = matchedEntity.z;
      lockSignature = `SLAVE:${normalizedTemplateName}:${slaveState.boneName.trim().toUpperCase()}`;
      shouldSnapOnAcquire = true;
    } else {
      return;
    }

    const shouldSnapNow = lastCameraLockSignature !== lockSignature
      && shouldSnapOnAcquire;

    if (shouldSnapNow) {
      cameraController.lookAt(worldX, worldZ);
    } else if (cameraController.panTo) {
      cameraController.panTo(worldX, worldZ);
    } else {
      cameraController.lookAt(worldX, worldZ);
    }

    // Source parity: object camera-lock mode cancels scripted camera-move tracks.
    targetTransition = null;
    waypointPathTransition = null;
    frozenWaypointPathAngle = null;
    angleTransition = null;
    zoomTransition = null;
    pitchTransition = null;
    lastCameraLockSignature = lockSignature;
  };

  const updateMovementFinished = (currentLogicFrame: number): void => {
    movementFinished = (
      !targetTransition
      && !waypointPathTransition
      && !angleTransition
      && !zoomTransition
      && !pitchTransition
      && currentLogicFrame >= nonVisualMovementEndFrame
    );
    if (movementFinished) {
      freezeTimeForMovement = false;
    }
  };

  return {
    syncAfterSimulationStep(currentLogicFrame: number): void {
      applyActiveTransitions(currentLogicFrame);
      processActionRequests(currentLogicFrame);
      processModifierRequests(currentLogicFrame);
      processLookTowardStates(currentLogicFrame);
      processCameraLockStates();
      applyActiveTransitions(currentLogicFrame);
      updateMovementFinished(currentLogicFrame);
    },

    isCameraMovementFinished(): boolean {
      return movementFinished;
    },

    isCameraTimeFrozen(): boolean {
      return freezeTimeForMovement && !movementFinished;
    },

    getCameraTimeMultiplier(): number {
      return cameraTimeMultiplier;
    },
  };
}
