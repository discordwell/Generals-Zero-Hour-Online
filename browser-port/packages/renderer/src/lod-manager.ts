/**
 * LODManager — runtime LOD switching for multi-LOD GLB models.
 *
 * Source parity: GameLOD.cpp + W3D LOD system.
 *
 * When a GLB contains multiple scenes (exported by GltfBuilder from W3D HLOD data),
 * wraps them in THREE.LOD with distance thresholds derived from maxScreenSize.
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LODSceneInfo {
  sceneIndex: number;
  maxScreenSize: number;
  group: THREE.Group;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class LODManager implements Subsystem {
  readonly name = 'LODManager';

  private readonly lods: THREE.LOD[] = [];
  private camera: THREE.Camera | null = null;

  init(): void {
    // no-op
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  update(_dt: number): void {
    if (!this.camera) return;
    for (const lod of this.lods) {
      lod.update(this.camera);
    }
  }

  reset(): void {
    this.lods.length = 0;
  }

  dispose(): void {
    this.reset();
  }

  /**
   * Check if a loaded GLTF has multiple scenes with LOD extras.
   * Returns true if the model should use LOD switching.
   */
  static hasMultipleLODs(gltf: { scenes?: THREE.Group[]; userData?: Record<string, unknown> }): boolean {
    const scenes = gltf.scenes;
    return !!scenes && scenes.length > 1;
  }

  /**
   * Create a THREE.LOD from a multi-scene GLTF.
   *
   * Scene 0 = highest detail (distance 0).
   * Each subsequent scene uses maxScreenSize from extras to compute distance.
   *
   * @param gltf - Loaded GLTF with multiple scenes
   * @param boundingRadius - Approximate bounding radius of the object
   * @param viewportHeight - Viewport height in pixels
   * @param fov - Camera vertical field of view in radians
   * @returns THREE.LOD object, or null if only one scene
   */
  createLOD(
    gltf: { scenes: THREE.Group[]; parser?: { json?: { scenes?: Array<{ extras?: { maxScreenSize?: number } }> } } },
    boundingRadius: number,
    viewportHeight: number,
    fov: number,
  ): THREE.LOD | null {
    const scenes = gltf.scenes;
    if (!scenes || scenes.length <= 1) return null;

    const lod = new THREE.LOD();

    // Extract maxScreenSize from glTF JSON extras per scene
    const jsonScenes = gltf.parser?.json?.scenes;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene) continue;

      const maxScreenSize = jsonScenes?.[i]?.extras?.maxScreenSize ?? 0;
      const distance = maxScreenSizeToDistance(maxScreenSize, boundingRadius, viewportHeight, fov);

      lod.addLevel(scene, distance);
    }

    this.lods.push(lod);
    return lod;
  }

  /**
   * Register an externally created THREE.LOD for update management.
   */
  registerLOD(lod: THREE.LOD): void {
    this.lods.push(lod);
  }

  getLODCount(): number {
    return this.lods.length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert W3D maxScreenSize to a world-space distance for THREE.LOD.
 *
 * maxScreenSize is the maximum number of screen pixels the object should
 * occupy at this LOD level. We invert:
 *   screenSize = (objectRadius * viewportHeight) / (distance * tan(fov/2))
 *   distance = (objectRadius * viewportHeight) / (screenSize * tan(fov/2))
 *
 * A maxScreenSize of 0 means "highest detail" → distance 0.
 */
function maxScreenSizeToDistance(
  maxScreenSize: number,
  objectRadius: number,
  viewportHeight: number,
  fov: number,
): number {
  if (maxScreenSize <= 0) return 0;
  const tanHalfFov = Math.tan(fov / 2);
  if (tanHalfFov <= 0) return 0;
  return (objectRadius * viewportHeight) / (maxScreenSize * tanHalfFov);
}
