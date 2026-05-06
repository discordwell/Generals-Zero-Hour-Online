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
  /** Inner core opacity from W3DLaserDraw InnerColor alpha. Default 1.0. */
  innerOpacity?: number;
  /** Outer glow opacity from W3DLaserDraw OuterColor alpha. Default 0.5. */
  outerOpacity?: number;
  /** Duration the beam stays at full intensity (ms). Default 100. */
  fullIntensityMs?: number;
  /** Duration the beam fades out (ms). Default 300. */
  fadeMs?: number;
  /** Number of concentric beam layers (W3DLaserDraw NumBeams). Default 2. */
  numBeams?: number;
  /** Number of segments to tessellate the beam into (W3DLaserDraw Segments). Default 1. */
  segments?: number;
  /** Arc height for segmented beams (W3DLaserDraw ArcHeight). Default 0. */
  arcHeight?: number;
  /** Segment endpoint overlap ratio for arced beams (W3DLaserDraw SegmentOverlapRatio). Default 0. */
  segmentOverlapRatio?: number;
}

interface ActiveBeam {
  meshes: THREE.Mesh[];
  createdAt: number;
  fullIntensityMs: number;
  fadeMs: number;
  /** Original opacity for each mesh, used as base during fade. */
  baseOpacities: number[];
}

const DEFAULT_INNER_WIDTH = 0.15;
const DEFAULT_OUTER_WIDTH = 0.6;
const DEFAULT_INNER_COLOR = 0xff4444;
const DEFAULT_OUTER_COLOR = 0xff0000;
const DEFAULT_INNER_OPACITY = 1.0;
const DEFAULT_OUTER_OPACITY = 0.5;
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

/** Linearly interpolate between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/** Linearly interpolate between two hex colors (component-wise). */
function lerpColor(colorA: number, colorB: number, t: number): number {
  const rA = (colorA >> 16) & 0xff;
  const gA = (colorA >> 8) & 0xff;
  const bA = colorA & 0xff;
  const rB = (colorB >> 16) & 0xff;
  const gB = (colorB >> 8) & 0xff;
  const bB = colorB & 0xff;
  const r = Math.round(lerp(rA, rB, t));
  const g = Math.round(lerp(gA, gB, t));
  const b = Math.round(lerp(bA, bB, t));
  return (r << 16) | (g << 8) | b;
}

/**
 * Compute segment endpoints along the beam path, optionally with arc offset.
 * Returns (segments + 1) points from start to end.
 */
function computeSegmentPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segments: number,
  arcHeight: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const point = new THREE.Vector3().lerpVectors(start, end, t);
    if (arcHeight !== 0) {
      // sin(π * t) peaks at 0.5, giving smooth upward arc
      point.y += arcHeight * Math.sin(Math.PI * t);
    }
    points.push(point);
  }
  return points;
}

interface BeamSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

function computeSourceBeamSegments(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segments: number,
  arcHeight: number,
  segmentOverlapRatio: number,
): BeamSegment[] {
  const segmentCount = Math.max(1, Math.trunc(segments));
  if (arcHeight <= 0 || segmentCount <= 1) {
    return Array.from({ length: segmentCount }, () => ({
      start: start.clone(),
      end: end.clone(),
    }));
  }
  if (segmentOverlapRatio === 0) {
    const points = computeSegmentPoints(start, end, segmentCount, arcHeight);
    return points.slice(0, -1).map((point, index) => ({
      start: point,
      end: points[index + 1]!,
    }));
  }

  const lineVector = new THREE.Vector3().subVectors(end, start);
  const halfLength = lineVector.length() * 0.5;
  const lineMiddle = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const pointAtRatio = (ratio: number): THREE.Vector3 => {
    const point = start.clone().add(lineVector.clone().multiplyScalar(ratio));
    if (halfLength > 0) {
      const dist = point.distanceTo(lineMiddle);
      const scaledRadians = (dist / halfLength) * Math.PI * 0.5;
      point.y += Math.cos(scaledRadians) * arcHeight;
    }
    return point;
  };

  const result: BeamSegment[] = [];
  for (let segment = 0; segment < segmentCount; segment++) {
    let startRatio = segment / segmentCount;
    let endRatio = (segment + 1) / segmentCount;
    if (segment > 0) {
      startRatio -= segmentOverlapRatio;
    }
    if (segment < segmentCount - 1) {
      endRatio += segmentOverlapRatio;
    }
    result.push({
      start: pointAtRatio(startRatio),
      end: pointAtRatio(endRatio),
    });
  }
  return result;
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
    const innerOpacity = clamp01(config.innerOpacity ?? DEFAULT_INNER_OPACITY);
    const outerOpacity = clamp01(config.outerOpacity ?? DEFAULT_OUTER_OPACITY);
    const fullIntensityMs = config.fullIntensityMs ?? DEFAULT_FULL_INTENSITY_MS;
    const fadeMs = config.fadeMs ?? DEFAULT_FADE_MS;
    const numBeams = Math.max(1, Math.trunc(config.numBeams ?? 2));
    const segments = Math.max(1, Math.trunc(config.segments ?? 1));
    const arcHeight = config.arcHeight ?? 0;
    const segmentOverlapRatio = Number.isFinite(config.segmentOverlapRatio ?? 0)
      ? config.segmentOverlapRatio ?? 0
      : 0;

    const start = new THREE.Vector3(startX, startY, startZ);
    const end = new THREE.Vector3(endX, endY, endZ);

    const beamSegments = computeSourceBeamSegments(start, end, segments, arcHeight, segmentOverlapRatio);

    const meshes: THREE.Mesh[] = [];
    const baseOpacities: number[] = [];

    // Create N concentric beam layers, interpolated from inner to outer.
    for (let layer = 0; layer < numBeams; layer++) {
      const t = numBeams > 1 ? layer / (numBeams - 1) : 0;
      const width = lerp(innerWidth, outerWidth, t);
      const color = lerpColor(innerColor, outerColor, t);
      const opacity = lerp(innerOpacity, outerOpacity, t);

      for (let s = 0; s < beamSegments.length; s++) {
        const mesh = createBeamMesh(color, opacity);
        const segment = beamSegments[s]!;
        positionBeamMesh(mesh, segment.start, segment.end, width);
        mesh.name = `laser-beam-layer-${layer}`;
        this.scene.add(mesh);
        meshes.push(mesh);
        baseOpacities.push(opacity);
      }
    }

    this.activeBeams.push({
      meshes,
      createdAt: performance.now(),
      fullIntensityMs,
      fadeMs,
      baseOpacities,
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
        for (const mesh of beam.meshes) {
          this.scene.remove(mesh);
          this.disposeMesh(mesh);
        }
        continue;
      }

      if (elapsed > beam.fullIntensityMs) {
        // Fading phase.
        const fadeProgress = (elapsed - beam.fullIntensityMs) / Math.max(1, beam.fadeMs);
        const fadeMul = 1 - fadeProgress;
        for (let m = 0; m < beam.meshes.length; m++) {
          (beam.meshes[m]!.material as THREE.MeshBasicMaterial).opacity =
            beam.baseOpacities[m]! * fadeMul;
        }
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
      for (const mesh of beam.meshes) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
      }
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
