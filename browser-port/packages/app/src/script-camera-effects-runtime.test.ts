import { describe, expect, it } from 'vitest';

import {
  createScriptCameraEffectsRuntimeBridge,
  type ScriptCameraEffectsRuntimeGameLogic,
} from './script-camera-effects-runtime.js';

interface MutableScriptCameraEffectsState {
  blackWhiteRequests: Array<{
    enabled: boolean;
    fadeFrames: number;
    frame: number;
  }>;
  fadeRequests: Array<{
    fadeType: 'ADD' | 'SUBTRACT' | 'SATURATE' | 'MULTIPLY';
    minFade: number;
    maxFade: number;
    increaseFrames: number;
    holdFrames: number;
    decreaseFrames: number;
    frame: number;
  }>;
  filterRequests: Array<{
    requestType: 'MOTION_BLUR' | 'MOTION_BLUR_JUMP' | 'MOTION_BLUR_FOLLOW' | 'MOTION_BLUR_END_FOLLOW';
    zoomIn: boolean | null;
    saturate: boolean | null;
    waypointName: string | null;
    x: number | null;
    z: number | null;
    followMode: number | null;
    frame: number;
  }>;
  shakerRequests: Array<{
    waypointName: string;
    x: number;
    z: number;
    amplitude: number;
    durationSeconds: number;
    radius: number;
    frame: number;
  }>;
  screenShakeState: {
    intensity: number;
    frame: number;
  } | null;
}

class RecordingGameLogic implements ScriptCameraEffectsRuntimeGameLogic {
  readonly state: MutableScriptCameraEffectsState = {
    blackWhiteRequests: [],
    fadeRequests: [],
    filterRequests: [],
    shakerRequests: [],
    screenShakeState: null,
  };

  drainScriptCameraBlackWhiteRequests(): MutableScriptCameraEffectsState['blackWhiteRequests'] {
    const drained = this.state.blackWhiteRequests.map((request) => ({ ...request }));
    this.state.blackWhiteRequests.length = 0;
    return drained;
  }

  drainScriptCameraFadeRequests(): MutableScriptCameraEffectsState['fadeRequests'] {
    const drained = this.state.fadeRequests.map((request) => ({ ...request }));
    this.state.fadeRequests.length = 0;
    return drained;
  }

  drainScriptCameraFilterRequests(): MutableScriptCameraEffectsState['filterRequests'] {
    const drained = this.state.filterRequests.map((request) => ({ ...request }));
    this.state.filterRequests.length = 0;
    return drained;
  }

  drainScriptCameraShakerRequests(): MutableScriptCameraEffectsState['shakerRequests'] {
    const drained = this.state.shakerRequests.map((request) => ({ ...request }));
    this.state.shakerRequests.length = 0;
    return drained;
  }

  getScriptScreenShakeState(): MutableScriptCameraEffectsState['screenShakeState'] {
    return this.state.screenShakeState ? { ...this.state.screenShakeState } : null;
  }
}

describe('script camera effects runtime bridge', () => {
  it('interpolates black-white transitions based on fadeFrames', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.blackWhiteRequests.push({
      enabled: true,
      fadeFrames: 30,
      frame: 1,
    });

    const early = bridge.syncAfterSimulationStep(1);
    expect(early.grayscale).toBeCloseTo(0, 3);

    const middle = bridge.syncAfterSimulationStep(16);
    expect(middle.grayscale).toBeGreaterThan(0.45);
    expect(middle.grayscale).toBeLessThan(0.6);

    const final = bridge.syncAfterSimulationStep(31);
    expect(final.grayscale).toBeCloseTo(1, 5);
  });

  it('evaluates fade envelopes with increase/hold/decrease frame windows', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.fadeRequests.push({
      fadeType: 'ADD',
      minFade: 0.1,
      maxFade: 0.9,
      increaseFrames: 10,
      holdFrames: 5,
      decreaseFrames: 10,
      frame: 3,
    });

    const start = bridge.syncAfterSimulationStep(3);
    expect(start.fadeType).toBe('ADD');
    expect(start.fadeAmount).toBeCloseTo(0.1, 4);

    const peak = bridge.syncAfterSimulationStep(14);
    expect(peak.fadeAmount).toBeCloseTo(0.9, 3);

    const tail = bridge.syncAfterSimulationStep(23);
    expect(tail.fadeAmount).toBeLessThanOrEqual(0.5);
    expect(tail.fadeAmount).toBeGreaterThan(0.1);

    const settled = bridge.syncAfterSimulationStep(30);
    expect(settled.fadeType).toBeNull();
    expect(settled.fadeAmount).toBe(0);
  });

  it('clears expired multiply fades instead of holding minFade forever', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.fadeRequests.push({
      fadeType: 'MULTIPLY',
      minFade: 1,
      maxFade: 0,
      increaseFrames: 0,
      holdFrames: 10,
      decreaseFrames: 0,
      frame: 1,
    });

    const active = bridge.syncAfterSimulationStep(5);
    expect(active.fadeType).toBe('MULTIPLY');
    expect(active.fadeAmount).toBeCloseTo(0, 6);

    const expired = bridge.syncAfterSimulationStep(16);
    expect(expired.fadeType).toBeNull();
    expect(expired.fadeAmount).toBe(0);
  });

  it('captures and restores in-progress fade state at the saved phase', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.fadeRequests.push({
      fadeType: 'SUBTRACT',
      minFade: 0.2,
      maxFade: 0.8,
      increaseFrames: 12,
      holdFrames: 4,
      decreaseFrames: 6,
      frame: 5,
    });

    const original = bridge.syncAfterSimulationStep(16);
    expect(original.fadeType).toBe('SUBTRACT');

    const saved = bridge.captureActiveFadeSaveState();
    expect(saved).not.toBeNull();
    expect(saved?.currentFadeFrame).toBe(11);
    expect(saved?.currentFadeValue).toBeCloseTo(original.fadeAmount, 6);

    const restoredBridge = createScriptCameraEffectsRuntimeBridge({
      gameLogic: new RecordingGameLogic(),
      initialFadeState: saved,
    });
    const restored = restoredBridge.syncAfterSimulationStep(0);
    expect(restored.fadeType).toBe(original.fadeType);
    expect(restored.fadeAmount).toBeCloseTo(original.fadeAmount, 6);
  });

  it('enables and clears motion blur filter states from camera filter requests', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.filterRequests.push({
      requestType: 'MOTION_BLUR',
      zoomIn: true,
      saturate: true,
      waypointName: null,
      x: null,
      z: null,
      followMode: null,
      frame: 4,
    });

    const active = bridge.syncAfterSimulationStep(4);
    expect(active.blurPixels).toBeGreaterThan(0);
    expect(active.saturation).toBeGreaterThan(1);

    let expired = active;
    for (let frame = 5; frame <= 40; frame++) {
      expired = bridge.syncAfterSimulationStep(frame);
    }
    expect(expired.blurPixels).toBe(0);
    expect(expired.saturation).toBeCloseTo(1, 6);

    gameLogic.state.filterRequests.push({
      requestType: 'MOTION_BLUR_END_FOLLOW',
      zoomIn: null,
      saturate: null,
      waypointName: null,
      x: null,
      z: null,
      followMode: null,
      frame: 41,
    });
    const ended = bridge.syncAfterSimulationStep(41);
    expect(ended.blurPixels).toBe(0);
  });

  it('keeps motion blur follow active until end-follow request', () => {
    const gameLogic = new RecordingGameLogic();
    let cameraTarget = { x: 200, z: 300 };
    const bridge = createScriptCameraEffectsRuntimeBridge({
      gameLogic,
      getCameraTargetPosition: () => cameraTarget,
    });

    gameLogic.state.filterRequests.push({
      requestType: 'MOTION_BLUR_FOLLOW',
      zoomIn: null,
      saturate: null,
      waypointName: null,
      x: null,
      z: null,
      followMode: 12,
      frame: 1,
    });

    const started = bridge.syncAfterSimulationStep(1);
    expect(started.blurPixels).toBeGreaterThan(0);

    cameraTarget = { x: 200, z: 300 };
    const stillFollowing = bridge.syncAfterSimulationStep(200);
    expect(stillFollowing.blurPixels).toBeGreaterThan(0);

    gameLogic.state.filterRequests.push({
      requestType: 'MOTION_BLUR_END_FOLLOW',
      zoomIn: null,
      saturate: null,
      waypointName: null,
      x: null,
      z: null,
      followMode: null,
      frame: 201,
    });
    const ending = bridge.syncAfterSimulationStep(201);
    expect(ending.blurPixels).toBeGreaterThan(0);

    let finished = ending;
    for (let frame = 202; frame <= 220; frame++) {
      finished = bridge.syncAfterSimulationStep(frame);
    }
    expect(finished.blurPixels).toBe(0);
  });

  it('runs zoom-out motion blur as a decay from high initial strength', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.filterRequests.push({
      requestType: 'MOTION_BLUR',
      zoomIn: false,
      saturate: false,
      waypointName: null,
      x: null,
      z: null,
      followMode: null,
      frame: 1,
    });

    const initial = bridge.syncAfterSimulationStep(1);
    expect(initial.blurPixels).toBeGreaterThan(1);

    const later = bridge.syncAfterSimulationStep(6);
    expect(later.blurPixels).toBeLessThan(initial.blurPixels);

    let settled = later;
    for (let frame = 7; frame <= 20; frame++) {
      settled = bridge.syncAfterSimulationStep(frame);
    }
    expect(settled.blurPixels).toBe(0);
  });

  it('triggers midpoint camera look-at for motion blur jump requests', () => {
    const gameLogic = new RecordingGameLogic();
    const jumpTargets: Array<{ x: number; z: number }> = [];
    const bridge = createScriptCameraEffectsRuntimeBridge({
      gameLogic,
      onMotionBlurJumpToPosition: (x, z) => {
        jumpTargets.push({ x, z });
      },
    });

    gameLogic.state.filterRequests.push({
      requestType: 'MOTION_BLUR_JUMP',
      zoomIn: null,
      saturate: false,
      waypointName: 'JumpPoint',
      x: 320,
      z: 480,
      followMode: null,
      frame: 1,
    });

    for (let frame = 1; frame <= 11; frame++) {
      bridge.syncAfterSimulationStep(frame);
    }
    expect(jumpTargets).toHaveLength(0);

    bridge.syncAfterSimulationStep(12);
    expect(jumpTargets).toEqual([{ x: 320, z: 480 }]);

    bridge.syncAfterSimulationStep(13);
    expect(jumpTargets).toHaveLength(1);
  });

  it('accumulates shaker and screen-shake requests into transient camera offsets', () => {
    const gameLogic = new RecordingGameLogic();
    const bridge = createScriptCameraEffectsRuntimeBridge({ gameLogic });

    gameLogic.state.shakerRequests.push({
      waypointName: 'ShakePoint',
      x: 30,
      z: 45,
      amplitude: 3,
      durationSeconds: 1,
      radius: 80,
      frame: 1,
    });
    gameLogic.state.screenShakeState = {
      intensity: 4,
      frame: 1,
    };

    const active = bridge.syncAfterSimulationStep(1);
    expect(Math.abs(active.shakeOffsetX) + Math.abs(active.shakeOffsetY)).toBeGreaterThan(0);

    const settled = bridge.syncAfterSimulationStep(80);
    expect(Math.abs(settled.shakeOffsetX)).toBeLessThan(0.001);
    expect(Math.abs(settled.shakeOffsetY)).toBeLessThan(0.001);
  });

  it('attenuates shaker contribution by distance from camera target', () => {
    const measureShakeStrength = (cameraTargetX: number, cameraTargetZ: number): number => {
      const gameLogic = new RecordingGameLogic();
      const bridge = createScriptCameraEffectsRuntimeBridge({
        gameLogic,
        getCameraTargetPosition: () => ({
          x: cameraTargetX,
          z: cameraTargetZ,
        }),
      });

      gameLogic.state.shakerRequests.push({
        waypointName: 'DistanceShakePoint',
        x: 30,
        z: 45,
        amplitude: 3,
        durationSeconds: 1,
        radius: 80,
        frame: 1,
      });

      const state = bridge.syncAfterSimulationStep(1);
      return Math.abs(state.shakeOffsetX) + Math.abs(state.shakeOffsetY);
    };

    const near = measureShakeStrength(30, 45);
    const mid = measureShakeStrength(70, 45);
    const outside = measureShakeStrength(200, 200);

    expect(near).toBeGreaterThan(0.1);
    expect(mid).toBeCloseTo(near * 0.5, 6);
    expect(outside).toBeLessThan(0.001);
  });
});
