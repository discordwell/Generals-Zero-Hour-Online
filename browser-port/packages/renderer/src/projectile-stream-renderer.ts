import * as THREE from 'three';

export interface ProjectileStreamPoint {
  x: number;
  y: number;
  z: number;
}

export interface ProjectileStreamRenderConfig {
  textureName: string | null;
  width: number;
  tileFactor: number;
  scrollRate: number;
  maxSegments: number;
}

export interface ProjectileStreamSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

const ZERO_EPSILON = 1e-6;

function isZeroPoint(point: ProjectileStreamPoint): boolean {
  return Math.abs(point.x) <= ZERO_EPSILON
    && Math.abs(point.y) <= ZERO_EPSILON
    && Math.abs(point.z) <= ZERO_EPSILON;
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
  } else {
    material.dispose();
  }
}

function createSegmentMesh(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'projectile-stream-segment';
  mesh.frustumCulled = false;
  mesh.renderOrder = 790;
  return mesh;
}

function positionSegmentMesh(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3, width: number): void {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length <= ZERO_EPSILON || width <= 0) {
    mesh.visible = false;
    return;
  }

  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(width, length, width);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.visible = true;
}

function applySegmentMaterialConfig(
  mesh: THREE.Mesh,
  config: ProjectileStreamRenderConfig,
  elapsedSeconds: number,
): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  const tileFactor = Number.isFinite(config.tileFactor) ? config.tileFactor : 0;
  const scrollRate = Number.isFinite(config.scrollRate) ? config.scrollRate : 0;
  const uvOffset = scrollRate * elapsedSeconds;
  material.userData = {
    textureName: config.textureName ?? null,
    tileFactor,
    scrollRate,
    uvOffset,
  };
  if (material.map) {
    material.map.wrapS = THREE.RepeatWrapping;
    material.map.wrapT = THREE.RepeatWrapping;
    material.map.repeat.set(tileFactor > 0 ? tileFactor : 1, 1);
    material.map.offset.y = uvOffset;
    material.map.needsUpdate = true;
  }
}

export function computeProjectileStreamSegments(
  points: readonly ProjectileStreamPoint[],
  maxSegments: number,
): ProjectileStreamSegment[] {
  const segmentCap = Number.isFinite(maxSegments) ? Math.trunc(maxSegments) : 0;
  const firstIndex = segmentCap > 0 ? Math.max(0, points.length - segmentCap) : 0;
  const segments: ProjectileStreamSegment[] = [];
  let previous: THREE.Vector3 | null = null;

  for (let index = firstIndex; index < points.length; index++) {
    const point = points[index]!;
    if (isZeroPoint(point)) {
      previous = null;
      continue;
    }

    const current = new THREE.Vector3(point.x, point.y, point.z);
    if (previous) {
      segments.push({
        start: previous.clone(),
        end: current.clone(),
      });
    }
    previous = current;
  }

  return segments;
}

export function syncProjectileStreamGroup(
  group: THREE.Group,
  points: readonly ProjectileStreamPoint[],
  config: ProjectileStreamRenderConfig,
  elapsedSeconds: number,
): void {
  syncProjectileStreamSegmentsGroup(
    group,
    computeProjectileStreamSegments(points, config.maxSegments),
    config,
    elapsedSeconds,
  );
}

export function syncProjectileStreamSegmentsGroup(
  group: THREE.Group,
  segments: readonly ProjectileStreamSegment[],
  config: ProjectileStreamRenderConfig,
  elapsedSeconds: number,
): void {
  const width = Number.isFinite(config.width) ? Math.max(0, config.width) : 0;
  const visibleSegments = width > 0 ? segments : [];

  while (group.children.length > visibleSegments.length) {
    const child = group.children.pop();
    if (child instanceof THREE.Mesh) {
      disposeMesh(child);
    }
    if (child) {
      child.parent = null;
    }
  }

  for (let index = 0; index < visibleSegments.length; index++) {
    const existing = group.children[index];
    const mesh = existing instanceof THREE.Mesh ? existing : createSegmentMesh();
    if (mesh.parent !== group) {
      group.add(mesh);
    }
    mesh.name = `projectile-stream-segment-${index}`;
    applySegmentMaterialConfig(mesh, config, elapsedSeconds);
    positionSegmentMesh(mesh, visibleSegments[index]!.start, visibleSegments[index]!.end, width);
  }

  group.visible = visibleSegments.length > 0;
  group.userData = {
    textureName: config.textureName ?? null,
    width,
    tileFactor: config.tileFactor,
    scrollRate: config.scrollRate,
    maxSegments: config.maxSegments,
    segmentCount: visibleSegments.length,
  };
}

export function disposeProjectileStreamGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      disposeMesh(child);
    }
  }
  group.clear();
}
