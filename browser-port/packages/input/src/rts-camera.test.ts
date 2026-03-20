import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { RTSCamera } from './rts-camera.js';
import type { InputState } from './types.js';
import { DEFAULT_CAMERA_CONFIG } from './types.js';

// Helper: create a default input state (nothing pressed)
function idleInput(): InputState {
  return {
    keysDown: new Set<string>(),
    mouseX: 500,
    mouseY: 400,
    viewportWidth: 1920,
    viewportHeight: 1080,
    wheelDelta: 0,
    middleMouseDown: false,
    leftMouseDown: false,
    rightMouseDown: false,
    leftMouseClick: false,
    rightMouseClick: false,
    middleDragDx: 0,
    middleDragDy: 0,
    pointerInCanvas: true,
  };
}

describe('RTSCamera', () => {
  let camera: THREE.PerspectiveCamera;
  let rtsCamera: RTSCamera;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 5000);
    rtsCamera = new RTSCamera(camera);
    rtsCamera.init();
  });

  describe('initial state', () => {
    it('places camera at default position', () => {
      rtsCamera.setInputState(idleInput());
      rtsCamera.update(1 / 30);
      // Camera should be above and behind origin
      expect(camera.position.y).toBeGreaterThan(0);
    });

    it('starts with default zoom', () => {
      const state = rtsCamera.getState();
      expect(state.zoom).toBe(DEFAULT_CAMERA_CONFIG.defaultZoom);
    });

    it('starts with default scripted pitch multiplier', () => {
      const state = rtsCamera.getState();
      expect(state.pitch).toBe(1);
    });
  });

  describe('keyboard scrolling', () => {
    it('moves target forward with W key', () => {
      const before = rtsCamera.getState();
      const input = idleInput();
      (input.keysDown as Set<string>).add('w');
      rtsCamera.setInputState(input);

      // Run several frames to accumulate movement
      for (let i = 0; i < 10; i++) {
        rtsCamera.update(1 / 30);
      }

      const after = rtsCamera.getState();
      // With angle=0, W moves in -Z direction
      expect(after.targetZ).toBeLessThan(before.targetZ);
    });

    it('moves target backward with S key', () => {
      const before = rtsCamera.getState();
      const input = idleInput();
      (input.keysDown as Set<string>).add('s');
      rtsCamera.setInputState(input);

      for (let i = 0; i < 10; i++) {
        rtsCamera.update(1 / 30);
      }

      const after = rtsCamera.getState();
      expect(after.targetZ).toBeGreaterThan(before.targetZ);
    });

    it('moves target left with A key', () => {
      const before = rtsCamera.getState();
      const input = idleInput();
      (input.keysDown as Set<string>).add('a');
      rtsCamera.setInputState(input);

      for (let i = 0; i < 10; i++) {
        rtsCamera.update(1 / 30);
      }

      const after = rtsCamera.getState();
      expect(after.targetX).toBeLessThan(before.targetX);
    });
  });

  describe('rotation', () => {
    it('rotates with Q key', () => {
      const before = rtsCamera.getState();
      const input = idleInput();
      (input.keysDown as Set<string>).add('q');
      rtsCamera.setInputState(input);

      for (let i = 0; i < 10; i++) {
        rtsCamera.update(1 / 30);
      }

      const after = rtsCamera.getState();
      expect(after.angle).not.toBeCloseTo(before.angle);
    });

    it('rotates opposite direction with E key', () => {
      const inputQ = idleInput();
      (inputQ.keysDown as Set<string>).add('q');
      rtsCamera.setInputState(inputQ);
      rtsCamera.update(1 / 30);
      const afterQ = rtsCamera.getState().angle;

      // Reset
      rtsCamera.reset();

      const inputE = idleInput();
      (inputE.keysDown as Set<string>).add('e');
      rtsCamera.setInputState(inputE);
      rtsCamera.update(1 / 30);
      const afterE = rtsCamera.getState().angle;

      // Q rotates negative, E rotates positive
      expect(afterQ).toBeLessThan(0);
      expect(afterE).toBeGreaterThan(0);
    });
  });

  describe('zoom', () => {
    it('zooms in with negative wheel delta', () => {
      const input = idleInput();
      (input as { wheelDelta: number }).wheelDelta = -300;
      rtsCamera.setInputState(input);
      rtsCamera.update(1 / 30);

      const state = rtsCamera.getState();
      expect(state.zoom).toBeLessThan(DEFAULT_CAMERA_CONFIG.defaultZoom);
    });

    it('zooms out with positive wheel delta', () => {
      const input = idleInput();
      (input as { wheelDelta: number }).wheelDelta = 300;
      rtsCamera.setInputState(input);
      rtsCamera.update(1 / 30);

      const state = rtsCamera.getState();
      expect(state.zoom).toBeGreaterThan(DEFAULT_CAMERA_CONFIG.defaultZoom);
    });

    it('clamps zoom to min/max', () => {
      // Zoom way in
      const inputIn = idleInput();
      (inputIn as { wheelDelta: number }).wheelDelta = -100000;
      rtsCamera.setInputState(inputIn);
      rtsCamera.update(1 / 30);

      let state = rtsCamera.getState();
      expect(state.zoom).toBe(DEFAULT_CAMERA_CONFIG.minZoom);

      // Zoom way out
      rtsCamera.reset();
      const inputOut = idleInput();
      (inputOut as { wheelDelta: number }).wheelDelta = 100000;
      rtsCamera.setInputState(inputOut);
      rtsCamera.update(1 / 30);

      state = rtsCamera.getState();
      expect(state.zoom).toBe(DEFAULT_CAMERA_CONFIG.maxZoom);
    });
  });

  describe('bounds clamping', () => {
    it('clamps target position to map bounds', () => {
      rtsCamera.setMapBounds(0, 1000, 0, 1000);

      // Try to scroll way past bounds
      const input = idleInput();
      (input.keysDown as Set<string>).add('a');
      rtsCamera.setInputState(input);

      for (let i = 0; i < 100; i++) {
        rtsCamera.update(1 / 30);
      }

      const state = rtsCamera.getState();
      expect(state.targetX).toBeGreaterThanOrEqual(0);
    });
  });

  describe('lookAt', () => {
    it('snaps camera target to specified position', () => {
      rtsCamera.lookAt(500, 700);
      const state = rtsCamera.getState();
      expect(state.targetX).toBe(500);
      expect(state.targetZ).toBe(700);
    });
  });

  describe('state save/restore', () => {
    it('saves and restores camera state', () => {
      // Move camera to some position
      rtsCamera.lookAt(100, 200);
      const input = idleInput();
      (input as { wheelDelta: number }).wheelDelta = -100;
      rtsCamera.setInputState(input);
      rtsCamera.update(1 / 30);

      const saved = rtsCamera.getState();

      // Reset and restore
      rtsCamera.reset();
      expect(rtsCamera.getState().targetX).toBe(0);

      rtsCamera.setState(saved);
      const restored = rtsCamera.getState();
      expect(restored.targetX).toBe(saved.targetX);
      expect(restored.targetZ).toBe(saved.targetZ);
      expect(restored.zoom).toBe(saved.zoom);
      expect(restored.pitch).toBe(saved.pitch);
    });
  });

  describe('interpolation', () => {
    it('smoothly moves toward desired position', () => {
      // Set a target far away
      rtsCamera.lookAt(0, 0);

      // Manually set desired to a new position by moving
      const input = idleInput();
      (input.keysDown as Set<string>).add('d');
      rtsCamera.setInputState(input);
      rtsCamera.update(1 / 30);

      const afterOneFrame = { ...camera.position };

      // Run more frames
      for (let i = 0; i < 30; i++) {
        rtsCamera.setInputState(idleInput());
        rtsCamera.update(1 / 30);
      }

      // Camera should have continued moving toward desired (settling)
      // The x should be different as it settles
      expect(camera.position.x).not.toBeCloseTo(afterOneFrame.x, 0);
    });
  });

  describe('terrain following', () => {
    it('adjusts camera Y based on terrain height', () => {
      rtsCamera.setHeightQuery((_x, _z) => 50);
      rtsCamera.setInputState(idleInput());
      rtsCamera.update(1 / 30);

      // Camera Y should be terrain height + vertical distance
      expect(camera.position.y).toBeGreaterThan(50);
    });
  });

  describe('scripted pitch', () => {
    it('reduces downward tilt when scripted pitch is below 1', () => {
      rtsCamera.setState({ ...rtsCamera.getState(), pitch: 1 });
      const forwardDefault = new THREE.Vector3();
      camera.getWorldDirection(forwardDefault);

      rtsCamera.setState({ ...rtsCamera.getState(), pitch: 0.35 });
      const forwardPitched = new THREE.Vector3();
      camera.getWorldDirection(forwardPitched);

      expect(Math.abs(forwardPitched.y)).toBeLessThan(Math.abs(forwardDefault.y));
    });
  });

  describe('edge scroll suppression during click', () => {
    it('suppresses edge scroll when left mouse is down', () => {
      // Source parity: edge scroll should not drift the camera
      // while the user is clicking to select entities.
      rtsCamera.lookAt(100, 100);
      const stateBefore = rtsCamera.getState();

      // Mouse at right edge with left button down
      rtsCamera.setInputState({
        ...idleInput(),
        mouseX: 1910, // near right edge (viewportWidth=1920, edgeScrollSize=20)
        leftMouseDown: true,
        leftMouseClick: true,
      });
      rtsCamera.update(1 / 30);

      const stateAfter = rtsCamera.getState();
      expect(stateAfter.targetX).toBe(stateBefore.targetX);
      expect(stateAfter.targetZ).toBe(stateBefore.targetZ);
    });

    it('allows edge scroll when no mouse button is down', () => {
      rtsCamera.lookAt(100, 100);
      const stateBefore = rtsCamera.getState();

      // Mouse at right edge, no button down
      rtsCamera.setInputState({
        ...idleInput(),
        mouseX: 1910,
      });
      rtsCamera.update(1 / 30);

      const stateAfter = rtsCamera.getState();
      // Camera should have scrolled right (targetX increased)
      expect(stateAfter.targetX).toBeGreaterThan(stateBefore.targetX);
    });
  });
});
