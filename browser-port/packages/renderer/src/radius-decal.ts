/**
 * RadiusDecal — terrain-projected selection/targeting circles.
 *
 * Source parity: RadiusDecal.h/cpp
 * Replaces the floating RingGeometry approach with terrain-conforming circles.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RadiusDecalConfig {
  radius: number;
  color: number;
  opacity: number;
  lineWidth: number;
  segments: number;
}

const DEFAULT_CONFIG: RadiusDecalConfig = {
  radius: 1.2,
  color: 0x00ff00,
  opacity: 0.6,
  lineWidth: 0.06,
  segments: 48,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let sharedSelectionGeometry: THREE.RingGeometry | null = null;

function getSharedSelectionGeometry(config: RadiusDecalConfig): THREE.RingGeometry {
  if (!sharedSelectionGeometry) {
    sharedSelectionGeometry = new THREE.RingGeometry(
      config.radius - config.lineWidth,
      config.radius,
      config.segments,
    );
  }
  return sharedSelectionGeometry;
}

/**
 * Create a selection circle decal mesh for terrain projection.
 */
export function createSelectionDecal(config?: Partial<RadiusDecalConfig>): THREE.Mesh {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const geometry = getSharedSelectionGeometry(cfg);

  const material = new THREE.MeshBasicMaterial({
    color: cfg.color,
    transparent: true,
    opacity: cfg.opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'selection-decal';
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 998;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return mesh;
}

/**
 * Create an attack/ability radius indicator decal.
 */
export function createRadiusIndicatorDecal(
  radius: number,
  color = 0xff0000,
  opacity = 0.4,
): THREE.Mesh {
  const geometry = new THREE.RingGeometry(radius - 0.1, radius, 48);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'radius-indicator';
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 997;
  mesh.castShadow = false;

  return mesh;
}

/**
 * Update a decal's opacity for throbbing animation.
 */
export function updateDecalThrob(mesh: THREE.Mesh, time: number, minOpacity: number, maxOpacity: number, period: number): void {
  const t = (Math.sin(time * (2 * Math.PI / period)) + 1) / 2;
  const opacity = minOpacity + t * (maxOpacity - minOpacity);
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = opacity;
}
