/**
 * Bullet tracer rendering — short-lived moving line segments for weapon fire.
 *
 * Source parity: W3DTracerDraw creates Line3D geometry (elongated box) that
 * travels from muzzle toward target, fading out over a calculated lifetime
 * based on distance/speed. TracerFXNugget in FXList.cpp handles creation.
 */

import * as THREE from 'three';

export interface TracerConfig {
  /** Tracer color (hex). Default 0xffee44 (bright yellow). */
  color?: number;
  /** Tracer length in world units. Default 2.0. */
  length?: number;
  /** Tracer width in world units. Default 0.08. */
  width?: number;
  /** Speed in world units per second. Default 120. */
  speed?: number;
  /** Initial opacity. Default 1.0. */
  opacity?: number;
}

interface ActiveTracer {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  speed: number;
  createdAt: number;
  lifetimeMs: number;
  initialOpacity: number;
  material: THREE.MeshBasicMaterial;
}

const MAX_ACTIVE_TRACERS = 64;

// Shared geometry — box oriented along X axis, scaled per tracer config.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export class TracerRenderer {
  private readonly scene: THREE.Scene;
  private readonly activeTracers: ActiveTracer[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn a bullet tracer from source position toward target position.
   * The tracer travels along the direction vector at the configured speed,
   * fading out over its calculated lifetime.
   */
  addTracer(
    sx: number, sy: number, sz: number,
    tx: number, ty: number, tz: number,
    config: TracerConfig = {},
  ): void {
    // Evict oldest if at capacity.
    if (this.activeTracers.length >= MAX_ACTIVE_TRACERS) {
      const oldest = this.activeTracers.shift();
      if (oldest) {
        this.scene.remove(oldest.mesh);
        oldest.material.dispose();
      }
    }

    const color = config.color ?? 0xffee44;
    const length = config.length ?? 2.0;
    const width = config.width ?? 0.08;
    const speed = config.speed ?? 120;
    const opacity = config.opacity ?? 1.0;

    // Direction from source to target.
    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const direction = new THREE.Vector3(
      dist > 0 ? dx / dist : 1,
      dist > 0 ? dy / dist : 0,
      dist > 0 ? dz / dist : 0,
    );

    // Lifetime: time for tracer to traverse the distance.
    // Match C++: frames = (dist - length) / speed, then scaled by decayAt.
    const travelDist = Math.max(0, dist - length);
    const lifetimeMs = speed > 0 ? (travelDist / speed) * 1000 : 200;

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(UNIT_BOX, material);
    mesh.scale.set(length, width, width);
    mesh.name = 'tracer';

    // Position at source and orient along direction.
    mesh.position.set(sx, sy, sz);
    const target = new THREE.Vector3(sx + direction.x, sy + direction.y, sz + direction.z);
    mesh.lookAt(target);
    // lookAt orients -Z toward target; we need +X along direction.
    // Rotate 90° around Y to align box X-axis with travel direction.
    mesh.rotateY(Math.PI / 2);

    this.scene.add(mesh);

    this.activeTracers.push({
      mesh,
      direction,
      speed,
      createdAt: performance.now(),
      lifetimeMs: Math.max(lifetimeMs, 50), // minimum 50ms
      initialOpacity: opacity,
      material,
    });
  }

  private lastUpdateTime = 0;

  /**
   * Update all active tracers — move forward, fade, and remove expired.
   */
  update(): void {
    const now = performance.now();
    const dtSec = this.lastUpdateTime > 0
      ? Math.min((now - this.lastUpdateTime) / 1000, 0.05)
      : 0.016;
    this.lastUpdateTime = now;
    let writeIdx = 0;

    for (let i = 0; i < this.activeTracers.length; i++) {
      const entry = this.activeTracers[i]!;
      const elapsed = now - entry.createdAt;

      if (elapsed >= entry.lifetimeMs) {
        this.scene.remove(entry.mesh);
        entry.material.dispose();
        continue;
      }

      // Move forward along direction using actual frame delta.
      const moveStep = entry.speed * dtSec;
      entry.mesh.position.x += entry.direction.x * moveStep;
      entry.mesh.position.y += entry.direction.y * moveStep;
      entry.mesh.position.z += entry.direction.z * moveStep;

      // Fade opacity linearly. C++ formula: decay = opacity / framesRemaining.
      const progress = elapsed / entry.lifetimeMs;
      entry.material.opacity = entry.initialOpacity * (1 - progress);

      this.activeTracers[writeIdx++] = entry;
    }

    this.activeTracers.length = writeIdx;
  }

  getActiveTracerCount(): number {
    return this.activeTracers.length;
  }

  dispose(): void {
    for (const entry of this.activeTracers) {
      this.scene.remove(entry.mesh);
      entry.material.dispose();
    }
    this.activeTracers.length = 0;
  }
}
