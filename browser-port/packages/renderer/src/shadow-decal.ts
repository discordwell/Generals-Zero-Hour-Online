/**
 * ShadowDecal — flat circular blob shadow projected on the ground.
 *
 * Source parity: W3DShadow.cpp
 * Most units in Generals use SHADOW_DECAL — a flat circular texture
 * positioned at terrain height under the object. Much cheaper than
 * shadow maps for small units.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shadow type enum (from Object INI "Shadow" field)
// ---------------------------------------------------------------------------

export type ObjectShadowType =
  | 'SHADOW_NONE'
  | 'SHADOW_DECAL'
  | 'SHADOW_VOLUME'
  | 'SHADOW_PROJECTION'
  | 'SHADOW_ALPHA_DECAL'
  | 'SHADOW_ADDITIVE_DECAL';

export function parseObjectShadowType(value: unknown): ObjectShadowType {
  if (typeof value !== 'string') return 'SHADOW_VOLUME';
  const upper = value.trim().toUpperCase();
  switch (upper) {
    case 'SHADOW_NONE': return 'SHADOW_NONE';
    case 'SHADOW_DECAL': return 'SHADOW_DECAL';
    case 'SHADOW_VOLUME': return 'SHADOW_VOLUME';
    case 'SHADOW_PROJECTION': return 'SHADOW_PROJECTION';
    case 'SHADOW_ALPHA_DECAL': return 'SHADOW_ALPHA_DECAL';
    case 'SHADOW_ADDITIVE_DECAL': return 'SHADOW_ADDITIVE_DECAL';
    default: return 'SHADOW_VOLUME';
  }
}

// ---------------------------------------------------------------------------
// Shadow decal mesh
// ---------------------------------------------------------------------------

const DEFAULT_SHADOW_SIZE = 3.0;
const SHADOW_Y_OFFSET = 0.05;

let sharedShadowGeometry: THREE.PlaneGeometry | null = null;
let sharedShadowMaterial: THREE.MeshBasicMaterial | null = null;

function getSharedShadowGeometry(): THREE.PlaneGeometry {
  if (!sharedShadowGeometry) {
    sharedShadowGeometry = new THREE.PlaneGeometry(1, 1);
  }
  return sharedShadowGeometry;
}

function getSharedShadowMaterial(): THREE.MeshBasicMaterial {
  if (!sharedShadowMaterial) {
    sharedShadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.MultiplyBlending,
    });
  }
  return sharedShadowMaterial;
}

export interface ShadowDecalConfig {
  sizeX: number;
  sizeY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Create a shadow decal mesh to be parented under an object's root group.
 */
export function createShadowDecalMesh(config?: Partial<ShadowDecalConfig>): THREE.Mesh {
  const sizeX = config?.sizeX ?? DEFAULT_SHADOW_SIZE;
  const sizeY = config?.sizeY ?? DEFAULT_SHADOW_SIZE;

  const mesh = new THREE.Mesh(getSharedShadowGeometry(), getSharedShadowMaterial());
  mesh.name = 'shadow-decal';
  mesh.rotation.x = -Math.PI / 2; // Lay flat on ground
  mesh.scale.set(sizeX, sizeY, 1);
  mesh.renderOrder = 1;
  mesh.receiveShadow = false;
  mesh.castShadow = false;

  return mesh;
}

/**
 * Update shadow decal position to terrain height.
 * Call each frame with the parent entity's world position and a heightmap.
 */
export function updateShadowDecalPosition(
  mesh: THREE.Mesh,
  worldX: number,
  worldZ: number,
  getTerrainHeight: (x: number, z: number) => number,
): void {
  const terrainY = getTerrainHeight(worldX, worldZ);
  // Position relative to parent: only Y offset needed since the mesh is
  // parented to the entity root which is already at (worldX, entityY, worldZ)
  mesh.position.y = terrainY + SHADOW_Y_OFFSET - (mesh.parent?.position.y ?? 0);
}

/**
 * Determine whether a shadow type should use the Three.js shadow map (castShadow=true)
 * or a shadow decal mesh.
 */
export function shouldCastShadowMap(shadowType: ObjectShadowType): boolean {
  return shadowType === 'SHADOW_VOLUME' || shadowType === 'SHADOW_PROJECTION';
}

export function shouldCreateShadowDecal(shadowType: ObjectShadowType): boolean {
  return shadowType === 'SHADOW_DECAL' ||
    shadowType === 'SHADOW_ALPHA_DECAL' ||
    shadowType === 'SHADOW_ADDITIVE_DECAL';
}
