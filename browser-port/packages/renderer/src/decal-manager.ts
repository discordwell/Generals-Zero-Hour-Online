/**
 * DecalManager — subsystem coordinating all decal types:
 * selection circles, scorch marks, shadow decals.
 *
 * Source parity: W3DTerrainLogic.cpp decal management.
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import { DecalRenderer } from './decal-renderer.js';
import { TerrainScorchManager } from './terrain-scorch.js';

export class DecalManager implements Subsystem {
  readonly name = 'DecalManager';

  readonly decalRenderer: DecalRenderer;
  readonly terrainScorch: TerrainScorchManager;

  constructor(scene: THREE.Scene, maxDecals = 256, maxScorchMarks = 128) {
    this.decalRenderer = new DecalRenderer(scene, maxDecals);
    this.terrainScorch = new TerrainScorchManager(this.decalRenderer, maxScorchMarks);
  }

  init(): void {
    // no-op
  }

  update(dt: number): void {
    this.decalRenderer.update(dt);
  }

  reset(): void {
    this.terrainScorch.dispose();
    this.decalRenderer.dispose();
  }

  dispose(): void {
    this.reset();
  }

  /**
   * Add a scorch mark at the given position.
   * Called by FXListManager when a TerrainScorch nugget fires.
   */
  addScorchMark(scorchType: string, radius: number, position: THREE.Vector3): void {
    this.terrainScorch.addScorch({
      scorchType,
      radius,
      position: [position.x, position.y, position.z],
      lifetime: 30,
    });
  }
}
