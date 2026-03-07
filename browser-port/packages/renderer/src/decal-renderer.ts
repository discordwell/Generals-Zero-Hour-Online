/**
 * DecalRenderer — terrain-projected texture quads for scorch marks,
 * selection circles, and other ground-level effects.
 *
 * Uses PlaneGeometry meshes with polygonOffset to avoid z-fighting.
 * Much cheaper than Three.js DecalGeometry for RTS-scale use.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type DecalBlendMode = 'ALPHA' | 'ADDITIVE' | 'MULTIPLY';

export interface DecalConfig {
  position: [number, number, number];
  sizeX: number;
  sizeY: number;
  rotation: number;
  blendMode: DecalBlendMode;
  opacity: number;
  color: number;
  lifetime?: number;
  terrainConform: boolean;
}

export interface DecalHandle {
  id: number;
}

// ---------------------------------------------------------------------------
// Internal decal state
// ---------------------------------------------------------------------------

interface LiveDecal {
  id: number;
  mesh: THREE.Mesh;
  spawnTime: number;
  lifetime: number; // 0 = permanent
  initialOpacity: number;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const DECAL_Y_OFFSET = 0.08;

export class DecalRenderer {
  private readonly scene: THREE.Scene;
  private readonly decals = new Map<number, LiveDecal>();
  private nextId = 1;
  private maxDecals = 256;

  // Shared geometry
  private static geometry: THREE.PlaneGeometry | null = null;

  constructor(scene: THREE.Scene, maxDecals = 256) {
    this.scene = scene;
    this.maxDecals = maxDecals;
  }

  private static getGeometry(): THREE.PlaneGeometry {
    if (!DecalRenderer.geometry) {
      DecalRenderer.geometry = new THREE.PlaneGeometry(1, 1);
    }
    return DecalRenderer.geometry;
  }

  addDecal(config: DecalConfig): DecalHandle {
    // Enforce cap by removing oldest
    if (this.decals.size >= this.maxDecals) {
      const oldest = this.decals.values().next().value;
      if (oldest) {
        this.removeDecal({ id: oldest.id });
      }
    }

    const id = this.nextId++;
    const material = this.createMaterial(config);

    const mesh = new THREE.Mesh(DecalRenderer.getGeometry(), material);
    mesh.name = `decal-${id}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = config.rotation;
    mesh.scale.set(config.sizeX, config.sizeY, 1);
    mesh.position.set(config.position[0], config.position[1] + DECAL_Y_OFFSET, config.position[2]);
    mesh.renderOrder = 2;
    mesh.receiveShadow = false;
    mesh.castShadow = false;

    // Polygon offset to prevent z-fighting with terrain
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;

    this.scene.add(mesh);

    const decal: LiveDecal = {
      id,
      mesh,
      spawnTime: performance.now() / 1000,
      lifetime: config.lifetime ?? 0,
      initialOpacity: config.opacity,
    };

    this.decals.set(id, decal);
    return { id };
  }

  removeDecal(handle: DecalHandle): void {
    const decal = this.decals.get(handle.id);
    if (!decal) return;
    this.scene.remove(decal.mesh);
    (decal.mesh.material as THREE.Material).dispose();
    this.decals.delete(handle.id);
  }

  update(_dt: number): void {
    const now = performance.now() / 1000;

    for (const [id, decal] of this.decals) {
      if (decal.lifetime <= 0) continue; // Permanent

      const age = now - decal.spawnTime;
      if (age > decal.lifetime) {
        this.removeDecal({ id });
        continue;
      }

      // Fade out in last 20% of lifetime
      const fadeStart = decal.lifetime * 0.8;
      if (age > fadeStart) {
        const fadeRatio = 1 - (age - fadeStart) / (decal.lifetime - fadeStart);
        const mat = decal.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = decal.initialOpacity * Math.max(0, fadeRatio);
      }
    }
  }

  getActiveDecalCount(): number {
    return this.decals.size;
  }

  setMaxDecals(max: number): void {
    this.maxDecals = max;
  }

  dispose(): void {
    for (const [, decal] of this.decals) {
      this.scene.remove(decal.mesh);
      (decal.mesh.material as THREE.Material).dispose();
    }
    this.decals.clear();
  }

  private createMaterial(config: DecalConfig): THREE.MeshBasicMaterial {
    let blending: THREE.Blending = THREE.NormalBlending;
    switch (config.blendMode) {
      case 'ADDITIVE':
        blending = THREE.AdditiveBlending;
        break;
      case 'MULTIPLY':
        blending = THREE.MultiplyBlending;
        break;
    }

    return new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: config.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending,
    });
  }
}
