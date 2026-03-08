/**
 * Dynamic lighting — short-lived point lights for explosions and muzzle flashes.
 *
 * Source parity: W3DDevice rendering pipeline creates brief point lights for
 * weapon fire, projectile impacts, and building fires. These provide visual
 * depth that flat ambient lighting misses.
 */

import * as THREE from 'three';

export interface DynamicLightConfig {
  /** Light color (hex). Default 0xffaa44 (warm orange). */
  color?: number;
  /** Peak light intensity. Default 2.0. */
  intensity?: number;
  /** Light falloff distance (world units). Default 15. */
  distance?: number;
  /** Duration at full intensity (ms). Default 50. */
  fullIntensityMs?: number;
  /** Fade-out duration (ms). Default 200. */
  fadeMs?: number;
}

interface ActiveLight {
  light: THREE.PointLight;
  createdAt: number;
  peakIntensity: number;
  fullIntensityMs: number;
  fadeMs: number;
}

const MAX_ACTIVE_LIGHTS = 16;

export class DynamicLightManager {
  private readonly scene: THREE.Scene;
  private readonly activeLights: ActiveLight[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn a short-lived point light at a world position.
   */
  addLight(
    x: number,
    y: number,
    z: number,
    config: DynamicLightConfig = {},
  ): void {
    // Cap active lights to avoid GPU overload.
    if (this.activeLights.length >= MAX_ACTIVE_LIGHTS) {
      // Remove oldest light to make room.
      const oldest = this.activeLights.shift();
      if (oldest) {
        this.scene.remove(oldest.light);
        oldest.light.dispose();
      }
    }

    const color = config.color ?? 0xffaa44;
    const intensity = config.intensity ?? 2.0;
    const distance = config.distance ?? 15;
    const fullIntensityMs = config.fullIntensityMs ?? 50;
    const fadeMs = config.fadeMs ?? 200;

    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(x, y + 1, z);
    light.name = 'dynamic-light';
    this.scene.add(light);

    this.activeLights.push({
      light,
      createdAt: performance.now(),
      peakIntensity: intensity,
      fullIntensityMs,
      fadeMs,
    });
  }

  /**
   * Spawn an explosion light (bright, wide, quick flash).
   */
  addExplosionLight(x: number, y: number, z: number, radius: number): void {
    this.addLight(x, y, z, {
      color: 0xff8822,
      intensity: Math.min(5, 1.5 + radius * 0.5),
      distance: Math.max(10, radius * 3),
      fullIntensityMs: 60,
      fadeMs: 250,
    });
  }

  /**
   * Spawn a muzzle flash light (brief, small).
   */
  addMuzzleFlashLight(x: number, y: number, z: number): void {
    this.addLight(x, y, z, {
      color: 0xffdd66,
      intensity: 1.5,
      distance: 8,
      fullIntensityMs: 30,
      fadeMs: 80,
    });
  }

  /**
   * Update all active lights — fade and remove expired ones.
   */
  update(): void {
    const now = performance.now();
    let writeIdx = 0;

    for (let i = 0; i < this.activeLights.length; i++) {
      const entry = this.activeLights[i]!;
      const elapsed = now - entry.createdAt;
      const totalLifetime = entry.fullIntensityMs + entry.fadeMs;

      if (elapsed >= totalLifetime) {
        this.scene.remove(entry.light);
        entry.light.dispose();
        continue;
      }

      if (elapsed > entry.fullIntensityMs) {
        const fadeProgress = (elapsed - entry.fullIntensityMs) / Math.max(1, entry.fadeMs);
        entry.light.intensity = entry.peakIntensity * (1 - fadeProgress);
      }

      this.activeLights[writeIdx++] = entry;
    }

    this.activeLights.length = writeIdx;
  }

  getActiveLightCount(): number {
    return this.activeLights.length;
  }

  dispose(): void {
    for (const entry of this.activeLights) {
      this.scene.remove(entry.light);
      entry.light.dispose();
    }
    this.activeLights.length = 0;
  }
}
