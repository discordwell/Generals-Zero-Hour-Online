import { describe, expect, it } from 'vitest';

import type { CameraState } from '@generals/input';

import {
  createScriptCameraRuntimeBridge,
  type ScriptCameraRuntimeGameLogic,
  type ScriptCameraActionRequestState,
  type ScriptCameraDefaultViewState,
  type ScriptCameraFollowState,
  type ScriptCameraLookTowardObjectState,
  type ScriptCameraLookTowardWaypointState,
  type ScriptCameraModifierRequestState,
  type ScriptCameraSlaveModeState,
  type ScriptCameraTetherState,
} from './script-camera-runtime.js';
import {
  resolveSourceAbsoluteZoomWorldDistance,
  resolveSourceHeightScaledZoomWorldDistance,
} from './source-camera.js';

interface MutableScriptCameraState {
  actionRequests: ScriptCameraActionRequestState[];
  modifierRequests: ScriptCameraModifierRequestState[];
  tetherState: ScriptCameraTetherState | null;
  followState: ScriptCameraFollowState | null;
  slaveModeState: ScriptCameraSlaveModeState | null;
  defaultViewState: ScriptCameraDefaultViewState | null;
  lookTowardObjectState: ScriptCameraLookTowardObjectState | null;
  lookTowardWaypointState: ScriptCameraLookTowardWaypointState | null;
  waypointPaths: Map<string, ReadonlyArray<{ x: number; z: number }>>;
  entityPositions: Map<number, readonly [number, number, number]>;
  renderableEntities: Array<{
    id: number;
    templateName: string;
    x: number;
    y: number;
    z: number;
  }>;
}

class RecordingGameLogic implements ScriptCameraRuntimeGameLogic {
  readonly state: MutableScriptCameraState = {
    actionRequests: [],
    modifierRequests: [],
    tetherState: null,
    followState: null,
    slaveModeState: null,
    defaultViewState: null,
    lookTowardObjectState: null,
    lookTowardWaypointState: null,
    waypointPaths: new Map<string, ReadonlyArray<{ x: number; z: number }>>(),
    entityPositions: new Map<number, readonly [number, number, number]>(),
    renderableEntities: [],
  };

  drainScriptCameraActionRequests(): ScriptCameraActionRequestState[] {
    const drained = this.state.actionRequests.map((request) => ({ ...request }));
    this.state.actionRequests.length = 0;
    return drained;
  }

  drainScriptCameraModifierRequests(): ScriptCameraModifierRequestState[] {
    const drained = this.state.modifierRequests.map((request) => ({ ...request }));
    this.state.modifierRequests.length = 0;
    return drained;
  }

  getScriptCameraTetherState(): ScriptCameraTetherState | null {
    return this.state.tetherState ? { ...this.state.tetherState } : null;
  }

  getScriptCameraFollowState(): ScriptCameraFollowState | null {
    return this.state.followState ? { ...this.state.followState } : null;
  }

  getScriptCameraSlaveModeState(): ScriptCameraSlaveModeState | null {
    return this.state.slaveModeState ? { ...this.state.slaveModeState } : null;
  }

  getScriptCameraDefaultViewState(): ScriptCameraDefaultViewState | null {
    return this.state.defaultViewState ? { ...this.state.defaultViewState } : null;
  }

  getScriptCameraLookTowardObjectState(): ScriptCameraLookTowardObjectState | null {
    return this.state.lookTowardObjectState ? { ...this.state.lookTowardObjectState } : null;
  }

  getScriptCameraLookTowardWaypointState(): ScriptCameraLookTowardWaypointState | null {
    return this.state.lookTowardWaypointState ? { ...this.state.lookTowardWaypointState } : null;
  }

  resolveScriptCameraWaypointPath(waypointName: string): ReadonlyArray<{ x: number; z: number }> | null {
    const key = waypointName.trim().toUpperCase();
    if (!key) {
      return null;
    }
    const path = this.state.waypointPaths.get(key);
    return path ? path.map((point) => ({ ...point })) : null;
  }

  getEntityWorldPosition(entityId: number): readonly [number, number, number] | null {
    return this.state.entityPositions.get(entityId) ?? null;
  }

  getRenderableEntityStates(): MutableScriptCameraState['renderableEntities'] {
    return this.state.renderableEntities.map((entity) => ({ ...entity }));
  }
}

class RecordingCameraController {
  private state: CameraState = {
    targetX: 0,
    targetZ: 0,
    angle: 0,
    zoom: 300,
    pitch: 1,
  };

  getState(): CameraState {
    return { ...this.state };
  }

  setState(state: CameraState): void {
    this.state = { ...state };
  }

  lookAt(worldX: number, worldZ: number): void {
    this.state = {
      ...this.state,
      targetX: worldX,
      targetZ: worldZ,
    };
  }

  panTo(worldX: number, worldZ: number): void {
    this.state = {
      ...this.state,
      targetX: worldX,
      targetZ: worldZ,
    };
  }
}

function makeActionRequest(
  overrides: Partial<ScriptCameraActionRequestState>,
): ScriptCameraActionRequestState {
  return {
    requestType: 'MOVE_TO',
    waypointName: null,
    lookAtWaypointName: null,
    x: null,
    z: null,
    lookAtX: null,
    lookAtZ: null,
    durationMs: 0,
    cameraStutterMs: 0,
    easeInMs: 0,
    easeOutMs: 0,
    rotations: null,
    zoom: null,
    pitch: null,
    frame: 0,
    ...overrides,
  };
}

function makeModifierRequest(
  overrides: Partial<ScriptCameraModifierRequestState>,
): ScriptCameraModifierRequestState {
  return {
    requestType: 'FREEZE_TIME',
    waypointName: null,
    x: null,
    z: null,
    zoom: null,
    pitch: null,
    easeIn: null,
    easeOut: null,
    speedMultiplier: null,
    rollingAverageFrames: null,
    frame: 0,
    ...overrides,
  };
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}

function angleDistance(from: number, to: number): number {
  return Math.abs(normalizeAngle(from - to));
}

function resolveLookTowardAngle(fromX: number, fromZ: number, toX: number, toZ: number): number | null {
  const dirX = toX - fromX;
  const dirZ = toZ - fromZ;
  const dirLength = Math.hypot(dirX, dirZ);
  if (dirLength < 0.1) {
    return null;
  }
  const clampedX = Math.max(-1, Math.min(1, dirX / dirLength));
  let angle = Math.acos(clampedX);
  if (dirZ < 0) {
    angle = -angle;
  }
  angle -= Math.PI / 2;
  return normalizeAngle(angle);
}

describe('script camera runtime bridge', () => {
  it('animates MOVE_TO requests and reports camera movement completion', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 90,
      z: 30,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    const earlyState = cameraController.getState();
    expect(earlyState.targetX).toBeGreaterThan(0);
    expect(earlyState.targetX).toBeLessThan(90);
    expect(bridge.isCameraMovementFinished()).toBe(false);

    bridge.syncAfterSimulationStep(29);
    expect(bridge.isCameraMovementFinished()).toBe(false);

    bridge.syncAfterSimulationStep(30);
    const finalState = cameraController.getState();
    expect(finalState.targetX).toBeCloseTo(90, 4);
    expect(finalState.targetZ).toBeCloseTo(30, 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('uses script ease-in for MOVE_TO transitions', () => {
    const linearLogic = new RecordingGameLogic();
    const linearCamera = new RecordingCameraController();
    const linearBridge = createScriptCameraRuntimeBridge({
      gameLogic: linearLogic,
      cameraController: linearCamera,
    });
    linearLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 90,
      z: 0,
      durationMs: 1000,
      easeInMs: 0,
      easeOutMs: 0,
    }));
    linearBridge.syncAfterSimulationStep(1);
    const linearX = linearCamera.getState().targetX;

    const easedLogic = new RecordingGameLogic();
    const easedCamera = new RecordingCameraController();
    const easedBridge = createScriptCameraRuntimeBridge({
      gameLogic: easedLogic,
      cameraController: easedCamera,
    });
    easedLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 90,
      z: 0,
      durationMs: 1000,
      easeInMs: 500,
      easeOutMs: 0,
    }));
    easedBridge.syncAfterSimulationStep(1);
    const easedX = easedCamera.getState().targetX;

    expect(easedX).toBeLessThan(linearX);
  });

  it('applies camera stutter cadence for MOVE_ALONG_WAYPOINT_PATH', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      x: 90,
      z: 0,
      durationMs: 1000,
      cameraStutterMs: 100,
    }));

    bridge.syncAfterSimulationStep(1);
    const frame1X = cameraController.getState().targetX;
    expect(frame1X).toBeCloseTo(0, 6);

    bridge.syncAfterSimulationStep(3);
    const frame3X = cameraController.getState().targetX;
    expect(frame3X).toBeGreaterThan(frame1X);

    bridge.syncAfterSimulationStep(4);
    const frame4X = cameraController.getState().targetX;
    expect(frame4X).toBeCloseTo(frame3X, 6);

    bridge.syncAfterSimulationStep(6);
    const frame6X = cameraController.getState().targetX;
    expect(frame6X).toBeGreaterThan(frame4X);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().targetX).toBeCloseTo(90, 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('follows linked waypoint path geometry for MOVE_ALONG_WAYPOINT_PATH', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.waypointPaths.set('CAM_PATH', [
      { x: 100, z: 0 },
      { x: 100, z: 100 },
    ]);
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_PATH',
      x: 100,
      z: 100,
      durationMs: 1000,
      cameraStutterMs: 0,
    }));

    bridge.syncAfterSimulationStep(1);
    bridge.syncAfterSimulationStep(15);
    const mid = cameraController.getState();
    expect(mid.targetX).toBeGreaterThan(80);
    expect(mid.targetX).toBeLessThan(100);
    expect(mid.targetZ).toBeGreaterThan(0);
    expect(mid.targetZ).toBeLessThan(30);

    bridge.syncAfterSimulationStep(30);
    const end = cameraController.getState();
    expect(end.targetX).toBeCloseTo(100, 4);
    expect(end.targetZ).toBeCloseTo(100, 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('keeps heading for single-segment waypoint paths', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.waypointPaths.set('CAM_SINGLE', [
      { x: 100, z: 0 },
    ]);
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_SINGLE',
      x: 100,
      z: 0,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    expect(cameraController.getState().angle).toBeCloseTo(0, 6);

    bridge.syncAfterSimulationStep(15);
    expect(cameraController.getState().angle).toBeCloseTo(0, 6);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().angle).toBeCloseTo(0, 6);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('ignores waypoint-path moves shorter than source MIN_DELTA', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.waypointPaths.set('CAM_TINY', [
      { x: 5, z: 0 },
    ]);
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_TINY',
      x: 5,
      z: 0,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    expect(cameraController.getState().targetX).toBeCloseTo(0, 6);
    expect(cameraController.getState().targetZ).toBeCloseTo(0, 6);
    expect(bridge.isCameraMovementFinished()).toBe(true);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().targetX).toBeCloseTo(0, 6);
    expect(cameraController.getState().targetZ).toBeCloseTo(0, 6);
  });

  it('orients camera along waypoint path direction and honors ROLLING_AVERAGE smoothing', () => {
    const baseLogic = new RecordingGameLogic();
    const baseCamera = new RecordingCameraController();
    const baseBridge = createScriptCameraRuntimeBridge({ gameLogic: baseLogic, cameraController: baseCamera });
    baseLogic.state.waypointPaths.set('CAM_TURN', [
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ]);
    baseLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_TURN',
      x: 100,
      z: 100,
      durationMs: 1000,
    }));
    baseBridge.syncAfterSimulationStep(1);
    baseBridge.syncAfterSimulationStep(20);
    const unsmoothedAngle = baseCamera.getState().angle;

    const smoothedLogic = new RecordingGameLogic();
    const smoothedCamera = new RecordingCameraController();
    const smoothedBridge = createScriptCameraRuntimeBridge({
      gameLogic: smoothedLogic,
      cameraController: smoothedCamera,
    });
    smoothedLogic.state.waypointPaths.set('CAM_TURN', [
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ]);
    smoothedLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_TURN',
      x: 100,
      z: 100,
      durationMs: 1000,
    }));
    smoothedLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'ROLLING_AVERAGE',
      rollingAverageFrames: 4,
    }));
    smoothedBridge.syncAfterSimulationStep(1);
    smoothedBridge.syncAfterSimulationStep(20);
    const smoothedAngle = smoothedCamera.getState().angle;

    expect(unsmoothedAngle).toBeGreaterThan(0);
    expect(unsmoothedAngle).toBeLessThan(Math.PI / 2);
    expect(smoothedAngle).toBeGreaterThanOrEqual(0);
    expect(smoothedAngle).toBeLessThan(unsmoothedAngle);
  });

  it('FREEZE_ANGLE holds waypoint-path camera heading for remaining movement', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.waypointPaths.set('CAM_FREEZE', [
      { x: 100, z: 0 },
      { x: 100, z: 100 },
    ]);
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_FREEZE',
      x: 100,
      z: 100,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    bridge.syncAfterSimulationStep(10);
    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FREEZE_ANGLE',
    }));
    bridge.syncAfterSimulationStep(11);
    const frozenAngle = cameraController.getState().angle;

    bridge.syncAfterSimulationStep(20);
    expect(cameraController.getState().angle).toBeCloseTo(frozenAngle, 6);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().angle).toBeCloseTo(frozenAngle, 6);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('FREEZE_ANGLE snaps waypoint-path heading to starting camera-angle profile', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.waypointPaths.set('CAM_FREEZE_RESET', [
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ]);
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_FREEZE_RESET',
      x: 0,
      z: 100,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    bridge.syncAfterSimulationStep(20);
    const turningAngle = cameraController.getState().angle;
    expect(turningAngle).toBeGreaterThan(0);

    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FREEZE_ANGLE',
    }));
    bridge.syncAfterSimulationStep(21);
    expect(cameraController.getState().angle).toBeLessThan(turningAngle);
    expect(cameraController.getState().angle).toBeCloseTo(0, 6);
  });

  it('applies LOOK_TOWARD and FINAL_LOOK_TOWARD heading modifiers on waypoint paths', () => {
    const runScenario = (modifierType: 'LOOK_TOWARD' | 'FINAL_LOOK_TOWARD' | null): {
      early: CameraState;
      late: CameraState;
    } => {
      const gameLogic = new RecordingGameLogic();
      const cameraController = new RecordingCameraController();
      const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

      gameLogic.state.waypointPaths.set('CAM_LOOK', [
        { x: 100, z: 0 },
        { x: 100, z: 100 },
      ]);
      gameLogic.state.actionRequests.push(makeActionRequest({
        requestType: 'MOVE_ALONG_WAYPOINT_PATH',
        waypointName: 'CAM_LOOK',
        x: 100,
        z: 100,
        durationMs: 1000,
      }));
      if (modifierType) {
        gameLogic.state.modifierRequests.push(makeModifierRequest({
          requestType: modifierType,
          x: 0,
          z: 100,
        }));
      }

      bridge.syncAfterSimulationStep(1);
      bridge.syncAfterSimulationStep(10);
      const early = cameraController.getState();
      bridge.syncAfterSimulationStep(27);
      const late = cameraController.getState();
      return { early, late };
    };

    const baseline = runScenario(null);
    const lookToward = runScenario('LOOK_TOWARD');
    const finalLookToward = runScenario('FINAL_LOOK_TOWARD');

    const earlyLookTowardAngle = resolveLookTowardAngle(
      lookToward.early.targetX,
      lookToward.early.targetZ,
      0,
      100,
    );
    const earlyFinalLookTowardAngle = resolveLookTowardAngle(
      finalLookToward.early.targetX,
      finalLookToward.early.targetZ,
      0,
      100,
    );
    const lateFinalLookTowardAngle = resolveLookTowardAngle(
      finalLookToward.late.targetX,
      finalLookToward.late.targetZ,
      0,
      100,
    );
    expect(earlyLookTowardAngle).not.toBeNull();
    expect(earlyFinalLookTowardAngle).not.toBeNull();
    expect(lateFinalLookTowardAngle).not.toBeNull();

    const baselineEarlyDelta = angleDistance(baseline.early.angle, earlyLookTowardAngle!);
    const lookEarlyDelta = angleDistance(lookToward.early.angle, earlyLookTowardAngle!);
    const finalEarlyDelta = angleDistance(finalLookToward.early.angle, earlyFinalLookTowardAngle!);
    expect(lookEarlyDelta).toBeLessThanOrEqual(baselineEarlyDelta);
    expect(finalEarlyDelta).toBeLessThanOrEqual(baselineEarlyDelta);

    const baselineLateDelta = angleDistance(baseline.late.angle, lateFinalLookTowardAngle!);
    const finalLateDelta = angleDistance(finalLookToward.late.angle, lateFinalLookTowardAngle!);
    expect(finalLateDelta).toBeLessThan(baselineLateDelta);
  });

  it('applies ROTATE requests over the scripted duration', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'ROTATE',
      rotations: 0.5,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    expect(bridge.isCameraMovementFinished()).toBe(false);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().angle).toBeCloseTo(Math.PI, 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('applies RESET defaults from script camera default view state', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const terrainHeightAt = () => 60;
    const bridge = createScriptCameraRuntimeBridge({
      gameLogic,
      cameraController,
      getTerrainHeightAt: terrainHeightAt,
    });

    gameLogic.state.defaultViewState = {
      pitch: 35,
      angle: 90,
      maxHeight: 480,
    };
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'RESET',
      x: 64,
      z: 96,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    bridge.syncAfterSimulationStep(30);

    const state = cameraController.getState();
    expect(state.targetX).toBeCloseTo(64, 4);
    expect(state.targetZ).toBeCloseTo(96, 4);
    expect(state.angle).toBeCloseTo(Math.PI / 2, 4);
    expect(state.zoom).toBeCloseTo(resolveSourceHeightScaledZoomWorldDistance({
      zoomMultiplier: 1,
      targetX: 64,
      targetZ: 96,
      getTerrainHeightAt: terrainHeightAt,
      settings: { maxCameraHeight: 480 },
    }), 4);
    expect(state.pitch).toBeCloseTo(1, 4);
  });

  it('applies SETUP requests immediately with look-at orientation and source height-scaled zoom', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const terrainHeightAt = (worldX: number, worldZ: number) => (
      worldX === 50 && worldZ === 60 ? 90 : 0
    );
    const bridge = createScriptCameraRuntimeBridge({
      gameLogic,
      cameraController,
      getTerrainHeightAt: terrainHeightAt,
    });
    gameLogic.state.defaultViewState = {
      pitch: 20,
      angle: 45,
      maxHeight: 400,
    };

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'SETUP',
      x: 50,
      z: 60,
      lookAtX: 50,
      lookAtZ: 90,
      zoom: 0.6,
      pitch: 35,
    }));

    bridge.syncAfterSimulationStep(1);
    const state = cameraController.getState();
    expect(state.targetX).toBe(50);
    expect(state.targetZ).toBe(60);
    expect(state.zoom).toBeCloseTo(resolveSourceHeightScaledZoomWorldDistance({
      zoomMultiplier: 0.6,
      targetX: 50,
      targetZ: 60,
      getTerrainHeightAt: terrainHeightAt,
      settings: { maxCameraHeight: 400 },
    }), 4);
    expect(state.pitch).toBe(35);
    expect(state.angle).toBeCloseTo(0, 6);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('animates ZOOM requests using source absolute zoom multipliers', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'ZOOM',
      zoom: 0.45,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    const earlyState = cameraController.getState();
    expect(bridge.isCameraMovementFinished()).toBe(false);
    expect(earlyState.zoom).toBeLessThan(300);
    expect(earlyState.zoom).toBeGreaterThan(resolveSourceAbsoluteZoomWorldDistance(0.45, undefined));

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().zoom).toBeCloseTo(
      resolveSourceAbsoluteZoomWorldDistance(0.45, undefined),
      4,
    );
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('animates PITCH requests over the scripted duration', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'PITCH',
      pitch: 0.4,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    const earlyState = cameraController.getState();
    expect(bridge.isCameraMovementFinished()).toBe(false);
    expect(earlyState.pitch).toBeLessThan(1);
    expect(earlyState.pitch).toBeGreaterThan(0.4);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().pitch).toBeCloseTo(0.4, 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('applies FINAL_PITCH over the remaining scripted movement duration', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 100,
      z: 100,
      durationMs: 1000,
    }));
    bridge.syncAfterSimulationStep(1);

    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FINAL_PITCH',
      pitch: 0.6,
    }));
    bridge.syncAfterSimulationStep(2);
    expect(bridge.isCameraMovementFinished()).toBe(false);
    expect(cameraController.getState().pitch).toBeLessThan(1);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().pitch).toBeCloseTo(0.6, 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('applies FINAL_ZOOM over the remaining scripted movement duration using source terrain-scaled zoom', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const terrainHeightAt = (worldX: number, worldZ: number) => (
      worldX === 100 && worldZ === 100 ? 60 : 0
    );
    const bridge = createScriptCameraRuntimeBridge({
      gameLogic,
      cameraController,
      getTerrainHeightAt: terrainHeightAt,
    });

    gameLogic.state.defaultViewState = {
      pitch: 35,
      angle: 90,
      maxHeight: 400,
    };
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 100,
      z: 100,
      durationMs: 1000,
    }));
    bridge.syncAfterSimulationStep(1);

    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FINAL_ZOOM',
      zoom: 0.5,
    }));
    bridge.syncAfterSimulationStep(2);
    expect(bridge.isCameraMovementFinished()).toBe(false);

    bridge.syncAfterSimulationStep(30);
    expect(cameraController.getState().zoom).toBeCloseTo(resolveSourceHeightScaledZoomWorldDistance({
      zoomMultiplier: 0.5,
      targetX: 100,
      targetZ: 100,
      getTerrainHeightAt: terrainHeightAt,
      settings: { maxCameraHeight: 400 },
    }), 4);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('freezes active scripted angle movement on FREEZE_ANGLE modifier', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'ROTATE',
      rotations: 1,
      durationMs: 1000,
    }));

    bridge.syncAfterSimulationStep(1);
    const angleBeforeFreeze = cameraController.getState().angle;
    expect(angleBeforeFreeze).toBeGreaterThan(0);

    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FREEZE_ANGLE',
    }));
    bridge.syncAfterSimulationStep(2);
    const frozenAngle = cameraController.getState().angle;

    bridge.syncAfterSimulationStep(20);
    expect(cameraController.getState().angle).toBeCloseTo(frozenAngle, 6);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('reports camera time frozen while FREEZE_TIME is active and movement is in progress', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FREEZE_TIME',
    }));
    bridge.syncAfterSimulationStep(1);
    expect(bridge.isCameraTimeFrozen()).toBe(false);

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 120,
      z: 20,
      durationMs: 1000,
    }));
    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FREEZE_TIME',
    }));

    bridge.syncAfterSimulationStep(2);
    expect(bridge.isCameraMovementFinished()).toBe(false);
    expect(bridge.isCameraTimeFrozen()).toBe(true);

    bridge.syncAfterSimulationStep(31);
    expect(bridge.isCameraMovementFinished()).toBe(true);
    expect(bridge.isCameraTimeFrozen()).toBe(false);
  });

  it('applies FINAL_SPEED_MULTIPLIER to camera time-multiplier state', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    expect(bridge.getCameraTimeMultiplier()).toBe(1);

    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FINAL_SPEED_MULTIPLIER',
      speedMultiplier: 3,
    }));
    bridge.syncAfterSimulationStep(1);
    expect(bridge.getCameraTimeMultiplier()).toBe(3);

    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_TO',
      x: 100,
      z: 20,
      durationMs: 1000,
    }));
    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FINAL_SPEED_MULTIPLIER',
      speedMultiplier: 5,
    }));
    bridge.syncAfterSimulationStep(2);
    expect(bridge.getCameraTimeMultiplier()).toBe(3);

    bridge.syncAfterSimulationStep(31);
    expect(bridge.getCameraTimeMultiplier()).toBeCloseTo(5, 6);
  });

  it('applies FINAL_SPEED_MULTIPLIER along waypoint-path distance profile', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.waypointPaths.set('CAM_SPEED', [
      { x: 100, z: 0 },
      { x: 100, z: 100 },
    ]);
    gameLogic.state.actionRequests.push(makeActionRequest({
      requestType: 'MOVE_ALONG_WAYPOINT_PATH',
      waypointName: 'CAM_SPEED',
      x: 100,
      z: 100,
      durationMs: 1000,
    }));
    gameLogic.state.modifierRequests.push(makeModifierRequest({
      requestType: 'FINAL_SPEED_MULTIPLIER',
      speedMultiplier: 4,
    }));

    bridge.syncAfterSimulationStep(1);
    expect(bridge.getCameraTimeMultiplier()).toBe(1);

    bridge.syncAfterSimulationStep(15);
    expect(bridge.getCameraTimeMultiplier()).toBe(3);

    bridge.syncAfterSimulationStep(30);
    expect(bridge.getCameraTimeMultiplier()).toBe(4);
  });

  it('applies persistent FOLLOW camera lock states each frame', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.followState = {
      entityId: 7,
      snapToUnit: false,
    };
    gameLogic.state.entityPositions.set(7, [100, 0, 200]);

    bridge.syncAfterSimulationStep(1);
    expect(cameraController.getState().targetX).toBe(100);
    expect(cameraController.getState().targetZ).toBe(200);

    gameLogic.state.entityPositions.set(7, [120, 0, 240]);
    bridge.syncAfterSimulationStep(2);
    expect(cameraController.getState().targetX).toBe(120);
    expect(cameraController.getState().targetZ).toBe(240);
  });

  it('triggers waypoint look-toward rotation once per new state signature', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.lookTowardWaypointState = {
      waypointName: 'LookAtA',
      x: 0,
      z: 100,
      durationMs: 1000,
      easeInMs: 0,
      easeOutMs: 0,
      reverseRotation: false,
    };

    bridge.syncAfterSimulationStep(1);
    expect(bridge.isCameraMovementFinished()).toBe(false);

    bridge.syncAfterSimulationStep(30);
    const firstAngle = cameraController.getState().angle;
    expect(firstAngle).toBeCloseTo(0, 5);
    expect(bridge.isCameraMovementFinished()).toBe(true);

    bridge.syncAfterSimulationStep(31);
    expect(cameraController.getState().angle).toBeCloseTo(firstAngle, 5);
    expect(bridge.isCameraMovementFinished()).toBe(true);
  });

  it('follows slave-mode template targets when no explicit follow/tether lock is active', () => {
    const gameLogic = new RecordingGameLogic();
    const cameraController = new RecordingCameraController();
    const bridge = createScriptCameraRuntimeBridge({ gameLogic, cameraController });

    gameLogic.state.slaveModeState = {
      thingTemplateName: 'CameraDrone',
      boneName: 'BONE01',
    };
    gameLogic.state.renderableEntities = [
      { id: 4, templateName: 'Ranger', x: 10, y: 0, z: 20 },
      { id: 9, templateName: 'CameraDrone', x: 120, y: 0, z: 240 },
    ];

    bridge.syncAfterSimulationStep(1);
    expect(cameraController.getState().targetX).toBe(120);
    expect(cameraController.getState().targetZ).toBe(240);

    gameLogic.state.renderableEntities = [
      { id: 9, templateName: 'CameraDrone', x: 150, y: 0, z: 260 },
    ];
    bridge.syncAfterSimulationStep(2);
    expect(cameraController.getState().targetX).toBe(150);
    expect(cameraController.getState().targetZ).toBe(260);
  });
});
