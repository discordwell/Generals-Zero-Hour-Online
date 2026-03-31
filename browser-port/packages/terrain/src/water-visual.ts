/**
 * WaterVisual — renders translucent water planes from polygon triggers.
 *
 * Creates flat transparent meshes for each isWaterArea trigger in the map.
 * Animates UV offset for a subtle water movement effect.
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import type { MapDataJSON, PolygonTriggerJSON, TerrainConfig } from './types.js';
import { DEFAULT_TERRAIN_CONFIG } from './types.js';

export class WaterVisual implements Subsystem {
  readonly name = 'WaterVisual';

  private readonly scene: THREE.Scene;
  private readonly config: TerrainConfig;

  /** Active water meshes. */
  private meshes: THREE.Mesh[] = [];

  /** Shared water material. */
  private material: THREE.MeshLambertMaterial;

  /** UV animation time accumulator. */
  private time = 0;

  constructor(scene: THREE.Scene, config?: Partial<TerrainConfig>) {
    this.scene = scene;
    this.config = { ...DEFAULT_TERRAIN_CONFIG, ...config };

    this.material = new THREE.MeshLambertMaterial({
      color: this.config.waterColor,
      transparent: true,
      opacity: this.config.waterOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  init(): void {
    // Nothing async needed
  }

  /**
   * Create water surfaces from map triggers.
   * Call after loading terrain.
   */
  loadFromMapData(mapData: MapDataJSON): void {
    this.clearWater();

    if (!this.config.enableWater) return;

    for (const trigger of mapData.triggers) {
      if (trigger.isWaterArea) {
        this.createWaterPlane(trigger);
      }
    }
  }

  update(dt: number): void {
    // Animate UV offset for water movement effect
    this.time += dt;

    for (const mesh of this.meshes) {
      const uvAttr = mesh.geometry.getAttribute('uv');
      if (!uvAttr) continue;

      // Subtle UV shift
      const offsetX = Math.sin(this.time * 0.3) * 0.02;
      const offsetY = Math.cos(this.time * 0.2) * 0.015;

      // Modify UVs to create water movement
      const baseUVs = (mesh.userData as { baseUVs?: Float32Array }).baseUVs;
      if (baseUVs) {
        const array = uvAttr.array as Float32Array;
        for (let i = 0; i < baseUVs.length; i += 2) {
          array[i] = baseUVs[i]! + offsetX;
          array[i + 1] = baseUVs[i + 1]! + offsetY;
        }
        uvAttr.needsUpdate = true;
      }
    }
  }

  reset(): void {
    this.clearWater();
    this.time = 0;
  }

  dispose(): void {
    this.clearWater();
    this.material.dispose();
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private createWaterPlane(trigger: PolygonTriggerJSON): void {
    const points = trigger.points;
    if (points.length < 3) return;

    // Convert trigger points from original engine coordinates to Three.js:
    //   Original engine X -> Three.js X (horizontal)
    //   Original engine Y -> Three.js Z (horizontal)
    //   Original engine Z -> Three.js Y (height / elevation)
    const shape = new THREE.Shape();
    const waterHeight = points[0]!.z;

    shape.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i]!.x, points[i]!.y);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    // ShapeGeometry creates XY geometry, we need to rotate to XZ
    geometry.rotateX(-Math.PI / 2);
    // Shift to water height
    geometry.translate(0, waterHeight, 0);

    // Store base UVs for animation
    const uvAttr = geometry.getAttribute('uv');
    if (uvAttr) {
      const baseUVs = new Float32Array(uvAttr.array.length);
      baseUVs.set(uvAttr.array as Float32Array);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.userData = { baseUVs };
      mesh.renderOrder = 1; // Render after terrain
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private clearWater(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.length = 0;
  }
}
