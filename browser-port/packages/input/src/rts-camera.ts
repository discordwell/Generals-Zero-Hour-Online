/**
 * RTSCamera — orbital RTS camera with smooth interpolation.
 *
 * Controls:
 *   WASD / Arrow keys — scroll
 *   Q/E — rotate
 *   Mouse wheel — zoom
 *   Edge scroll — move cursor to viewport edges
 *   Middle mouse drag — pan
 *
 * Uses desired/current state interpolation for smooth movement.
 * The "desired" state updates instantly; the "current" state lerps
 * toward desired each frame at the configured smoothing rate.
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import type { InputState, CameraConfig, CameraState } from './types.js';
import { DEFAULT_CAMERA_CONFIG } from './types.js';

/** Height query callback — returns terrain Y at a given world XZ. */
export type HeightQueryFn = (worldX: number, worldZ: number) => number;

export class RTSCamera implements Subsystem {
  readonly name = 'RTSCamera';

  private readonly camera: THREE.PerspectiveCamera;
  private readonly config: CameraConfig;

  // Desired state (updates instantly from input)
  private desiredTargetX: number;
  private desiredTargetZ: number;
  private desiredAngle: number;
  private desiredZoom: number;
  private desiredPitch: number;

  // Current state (lerps toward desired)
  private currentTargetX: number;
  private currentTargetZ: number;
  private currentAngle: number;
  private currentZoom: number;
  private currentPitch: number;

  // Map bounds for clamping (set after map load)
  private mapMinX = -Infinity;
  private mapMaxX = Infinity;
  private mapMinZ = -Infinity;
  private mapMaxZ = Infinity;

  // Terrain height query (optional — if not set, assumes Y=0)
  private heightQuery: HeightQueryFn | null = null;

  // Input state reference (set each frame before update)
  private inputState: InputState | null = null;

  constructor(
    camera: THREE.PerspectiveCamera,
    config: Partial<CameraConfig> = {},
  ) {
    this.camera = camera;
    this.config = { ...DEFAULT_CAMERA_CONFIG, ...config };

    this.desiredTargetX = 0;
    this.desiredTargetZ = 0;
    this.desiredAngle = 0;
    this.desiredZoom = this.config.defaultZoom;
    this.desiredPitch = 1;

    this.currentTargetX = 0;
    this.currentTargetZ = 0;
    this.currentAngle = 0;
    this.currentZoom = this.config.defaultZoom;
    this.currentPitch = 1;
  }

  init(): void {
    // Nothing async needed
  }

  /**
   * Set the height query function (usually HeightmapGrid.getInterpolatedHeight).
   */
  setHeightQuery(fn: HeightQueryFn): void {
    this.heightQuery = fn;
  }

  /** Update the keyboard/edge scroll speed in world units per second. */
  setScrollSpeed(speed: number): void {
    (this.config as CameraConfig).scrollSpeed = speed;
  }

  /**
   * Set map bounds for camera clamping.
   */
  setMapBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.mapMinX = minX;
    this.mapMaxX = maxX;
    this.mapMinZ = minZ;
    this.mapMaxZ = maxZ;
  }

  /**
   * Provide current input state before calling update().
   */
  setInputState(state: InputState): void {
    this.inputState = state;
  }

  /**
   * Update camera: process input, update desired state, interpolate current.
   */
  update(dt: number): void {
    const input = this.inputState;
    if (!input) return;

    this.processKeyboard(input, dt);
    this.processEdgeScroll(input, dt);
    this.processWheel(input);
    this.processMiddleDrag(input);

    // Clamp desired state
    this.clampDesired();

    // Interpolate current toward desired
    this.interpolate(dt);

    // Apply to Three.js camera
    this.applyToCamera();
  }

  /**
   * Get/set camera state (for save/restore, replays).
   */
  getState(): CameraState {
    return {
      targetX: this.desiredTargetX,
      targetZ: this.desiredTargetZ,
      angle: this.desiredAngle,
      zoom: this.desiredZoom,
      pitch: this.desiredPitch,
    };
  }

  setState(state: CameraState): void {
    this.desiredTargetX = state.targetX;
    this.desiredTargetZ = state.targetZ;
    this.desiredAngle = state.angle;
    this.desiredZoom = state.zoom;
    this.desiredPitch = state.pitch;
    // Snap current to desired (no interpolation)
    this.currentTargetX = state.targetX;
    this.currentTargetZ = state.targetZ;
    this.currentAngle = state.angle;
    this.currentZoom = state.zoom;
    this.currentPitch = state.pitch;
    this.applyToCamera();
  }

  /**
   * Snap the camera to look at a world position.
   */
  lookAt(worldX: number, worldZ: number): void {
    this.desiredTargetX = worldX;
    this.desiredTargetZ = worldZ;
    this.currentTargetX = worldX;
    this.currentTargetZ = worldZ;
    this.applyToCamera();
  }

  /**
   * Smoothly pan the camera to a world position (interpolates via desired state).
   */
  panTo(worldX: number, worldZ: number): void {
    this.desiredTargetX = worldX;
    this.desiredTargetZ = worldZ;
  }

  reset(): void {
    this.desiredTargetX = 0;
    this.desiredTargetZ = 0;
    this.desiredAngle = 0;
    this.desiredZoom = this.config.defaultZoom;
    this.desiredPitch = 1;
    this.currentTargetX = 0;
    this.currentTargetZ = 0;
    this.currentAngle = 0;
    this.currentZoom = this.config.defaultZoom;
    this.currentPitch = 1;
    this.applyToCamera();
  }

  dispose(): void {
    this.inputState = null;
    this.heightQuery = null;
  }

  // ========================================================================
  // Input processing
  // ========================================================================

  private processKeyboard(input: InputState, dt: number): void {
    const speed = this.config.scrollSpeed * dt;
    const sin = Math.sin(this.desiredAngle);
    const cos = Math.cos(this.desiredAngle);

    let dx = 0;
    let dz = 0;

    // Forward/back (relative to camera facing)
    if (input.keysDown.has('w') || input.keysDown.has('arrowup')) {
      dx -= sin * speed;
      dz -= cos * speed;
    }
    if (input.keysDown.has('s') || input.keysDown.has('arrowdown')) {
      dx += sin * speed;
      dz += cos * speed;
    }

    // Left/right strafe (perpendicular to camera facing)
    if (input.keysDown.has('a') || input.keysDown.has('arrowleft')) {
      dx -= cos * speed;
      dz += sin * speed;
    }
    if (input.keysDown.has('d') || input.keysDown.has('arrowright')) {
      dx += cos * speed;
      dz -= sin * speed;
    }

    this.desiredTargetX += dx;
    this.desiredTargetZ += dz;

    // Rotation
    if (input.keysDown.has('q')) {
      this.desiredAngle -= this.config.rotateSpeed * dt;
    }
    if (input.keysDown.has('e')) {
      this.desiredAngle += this.config.rotateSpeed * dt;
    }
  }

  private processEdgeScroll(input: InputState, dt: number): void {
    if (!input.pointerInCanvas) return;

    const edge = this.config.edgeScrollSize;
    const speed = this.config.scrollSpeed * dt;
    const sin = Math.sin(this.desiredAngle);
    const cos = Math.cos(this.desiredAngle);

    let dx = 0;
    let dz = 0;

    // Horizontal edges → strafe
    if (input.mouseX < edge) {
      dx -= cos * speed;
      dz += sin * speed;
    } else if (input.mouseX > input.viewportWidth - edge) {
      dx += cos * speed;
      dz -= sin * speed;
    }

    // Vertical edges → forward/back
    if (input.mouseY < edge) {
      dx -= sin * speed;
      dz -= cos * speed;
    } else if (input.mouseY > input.viewportHeight - edge) {
      dx += sin * speed;
      dz += cos * speed;
    }

    this.desiredTargetX += dx;
    this.desiredTargetZ += dz;
  }

  private processWheel(input: InputState): void {
    if (input.wheelDelta === 0) return;
    // Positive deltaY = scroll down = zoom out
    this.desiredZoom += input.wheelDelta * (this.config.zoomSpeed / 100);
    this.desiredZoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, this.desiredZoom));
  }

  private processMiddleDrag(input: InputState): void {
    if (!input.middleMouseDown) return;
    if (input.middleDragDx === 0 && input.middleDragDy === 0) return;

    const speed = this.config.panSpeed * (this.currentZoom / this.config.defaultZoom);
    const sin = Math.sin(this.desiredAngle);
    const cos = Math.cos(this.desiredAngle);

    // Convert screen-space drag to world-space movement
    const dx = input.middleDragDx * speed;
    const dy = input.middleDragDy * speed;

    this.desiredTargetX -= dx * cos + dy * sin;
    this.desiredTargetZ += dx * sin - dy * cos;
  }

  // ========================================================================
  // State management
  // ========================================================================

  private clampDesired(): void {
    this.desiredTargetX = Math.max(this.mapMinX, Math.min(this.mapMaxX, this.desiredTargetX));
    this.desiredTargetZ = Math.max(this.mapMinZ, Math.min(this.mapMaxZ, this.desiredTargetZ));
    this.desiredZoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, this.desiredZoom));
  }

  private interpolate(dt: number): void {
    // Exponential smoothing: current += (desired - current) * factor
    // Factor per frame ≈ 1 - (1 - smoothing)^(dt * 60)
    // For simplicity, use a per-frame factor scaled by dt
    const factor = 1 - Math.pow(1 - this.config.smoothing, dt * 60);

    this.currentTargetX += (this.desiredTargetX - this.currentTargetX) * factor;
    this.currentTargetZ += (this.desiredTargetZ - this.currentTargetZ) * factor;
    this.currentZoom += (this.desiredZoom - this.currentZoom) * factor;
    this.currentPitch += (this.desiredPitch - this.currentPitch) * factor;

    // Angle interpolation (handle wrap-around)
    let angleDiff = this.desiredAngle - this.currentAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.currentAngle += angleDiff * factor;
  }

  private applyToCamera(): void {
    const orbitPitch = this.config.pitchAngle;

    // Camera orbits the target at the current angle and zoom
    const horizontalDist = this.currentZoom * Math.sin(orbitPitch);
    const verticalDist = this.currentZoom * Math.cos(orbitPitch);

    let camX = this.currentTargetX + Math.sin(this.currentAngle) * horizontalDist;
    let camZ = this.currentTargetZ + Math.cos(this.currentAngle) * horizontalDist;

    // Terrain height at the look-at target
    let targetY = 0;
    if (this.heightQuery) {
      targetY = this.heightQuery(this.currentTargetX, this.currentTargetZ);
    }

    const camY = targetY + verticalDist;
    let lookAtY = targetY;

    if (this.currentPitch <= 1) {
      const height = camY - targetY;
      lookAtY = camY - height * this.currentPitch;
    } else {
      camX = this.currentTargetX + ((camX - this.currentTargetX) / this.currentPitch);
      camZ = this.currentTargetZ + ((camZ - this.currentTargetZ) / this.currentPitch);
    }

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.currentTargetX, lookAtY, this.currentTargetZ);
  }
}
