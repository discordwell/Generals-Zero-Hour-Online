/**
 * Laser beam renderer — visual beam effects for laser weapons.
 *
 * Source parity: W3DLaserDraw.cpp — renders a segmented, glowing beam
 * from source to target position using additive-blended cylinder geometry.
 *
 * Each beam is a short-lived visual that fades out over a configurable
 * number of frames (source default: ~10 frames / ~333ms at 30fps).
 */

import * as THREE from 'three';

export interface LaserBeamConfig {
  /** Inner core beam width (world units). Default 0.15. */
  innerWidth?: number;
  /** Outer glow beam width (world units). Default 0.6. */
  outerWidth?: number;
  /** Inner core color (hex). Default 0xff4444 (red). */
  innerColor?: number;
  /** Outer glow color (hex). Default 0xff0000 (dark red). */
  outerColor?: number;
  /** Duration the beam stays at full intensity (ms). Default 100. */
  fullIntensityMs?: number;
  /** Duration the beam fades out (ms). Default 300. */
  fadeMs?: number;
}

interface ActiveBeam {
  innerMesh: THREE.Mesh;
  outerMesh: THREE.Mesh;
  createdAt: number;
  fullIntensityMs: number;
  fadeMs: number;
}

const DEFAULT_INNER_WIDTH = 0.15;
const DEFAULT_OUTER_WIDTH = 0.6;
const DEFAULT_INNER_COLOR = 0xff4444;
const DEFAULT_OUTER_COLOR = 0xff0000;
const DEFAULT_FULL_INTENSITY_MS = 100;
const DEFAULT_FADE_MS = 300;

/** Shared unit-length cylinder geometry (scaled per beam instance). */
let sharedCylinderGeometry: THREE.CylinderGeometry | null = null;

function getCylinderGeometry(): THREE.CylinderGeometry {
  if (!sharedCylinderGeometry) {
    // Cylinder along Y axis, unit height, unit radius, 8 segments.
    sharedCylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
  }
  return sharedCylinderGeometry;
}

function createBeamMesh(color: number, opacity: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(getCylinderGeometry(), material);
  mesh.renderOrder = 800;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Positions a cylinder mesh so it spans from `start` to `end` with a given
 * diameter (radius = diameter / 2).
 */
function positionBeamMesh(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
  width: number,
): void {
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 0.001) {
    mesh.visible = false;
    return;
  }

  mesh.position.copy(midpoint);
  mesh.scale.set(width, length, width);
  // Align cylinder Y axis to the beam direction.
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  mesh.visible = true;
}

export class LaserBeamRenderer {
  private readonly scene: THREE.Scene;
  private readonly activeBeams: ActiveBeam[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn a new laser beam between two world-space positions.
   */
  addBeam(
    startX: number, startY: number, startZ: number,
    endX: number, endY: number, endZ: number,
    config: LaserBeamConfig = {},
  ): void {
    const innerWidth = config.innerWidth ?? DEFAULT_INNER_WIDTH;
    const outerWidth = config.outerWidth ?? DEFAULT_OUTER_WIDTH;
    const innerColor = config.innerColor ?? DEFAULT_INNER_COLOR;
    const outerColor = config.outerColor ?? DEFAULT_OUTER_COLOR;
    const fullIntensityMs = config.fullIntensityMs ?? DEFAULT_FULL_INTENSITY_MS;
    const fadeMs = config.fadeMs ?? DEFAULT_FADE_MS;

    const start = new THREE.Vector3(startX, startY, startZ);
    const end = new THREE.Vector3(endX, endY, endZ);

    const innerMesh = createBeamMesh(innerColor, 1.0);
    const outerMesh = createBeamMesh(outerColor, 0.5);

    positionBeamMesh(innerMesh, start, end, innerWidth);
    positionBeamMesh(outerMesh, start, end, outerWidth);

    innerMesh.name = 'laser-beam-inner';
    outerMesh.name = 'laser-beam-outer';

    this.scene.add(innerMesh);
    this.scene.add(outerMesh);

    this.activeBeams.push({
      innerMesh,
      outerMesh,
      createdAt: performance.now(),
      fullIntensityMs,
      fadeMs,
    });
  }

  /**
   * Update all active beams — fade out and remove expired ones.
   */
  update(): void {
    const now = performance.now();
    let writeIdx = 0;

    for (let i = 0; i < this.activeBeams.length; i++) {
      const beam = this.activeBeams[i]!;
      const elapsed = now - beam.createdAt;
      const totalLifetime = beam.fullIntensityMs + beam.fadeMs;

      if (elapsed >= totalLifetime) {
        // Remove expired beam.
        this.scene.remove(beam.innerMesh);
        this.scene.remove(beam.outerMesh);
        this.disposeMesh(beam.innerMesh);
        this.disposeMesh(beam.outerMesh);
        continue;
      }

      if (elapsed > beam.fullIntensityMs) {
        // Fading phase.
        const fadeProgress = (elapsed - beam.fullIntensityMs) / Math.max(1, beam.fadeMs);
        const opacity = 1 - fadeProgress;
        (beam.innerMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
        (beam.outerMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.5;
      }

      this.activeBeams[writeIdx++] = beam;
    }

    this.activeBeams.length = writeIdx;
  }

  /**
   * Return the number of currently active beams (for testing).
   */
  getActiveBeamCount(): number {
    return this.activeBeams.length;
  }

  dispose(): void {
    for (const beam of this.activeBeams) {
      this.scene.remove(beam.innerMesh);
      this.scene.remove(beam.outerMesh);
      this.disposeMesh(beam.innerMesh);
      this.disposeMesh(beam.outerMesh);
    }
    this.activeBeams.length = 0;
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else {
      material.dispose();
    }
  }
}
