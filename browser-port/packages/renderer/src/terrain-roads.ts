/**
 * Terrain road rendering — textured quad strips along road paths.
 *
 * Source parity: W3DRoadBuffer generates column-by-column vertex buffers for
 * road segments, floating slightly above the terrain. Roads are defined by
 * pairs of map objects with ROAD_POINT1/ROAD_POINT2 flags.
 *
 * This implementation:
 * 1. Extracts road point pairs from map objects
 * 2. Builds connected road paths from paired points
 * 3. Generates tessellated quad strip meshes following the terrain
 * 4. Applies a road material with UV mapping
 */

import * as THREE from 'three';

/** A road point extracted from map object data. */
export interface RoadPoint {
  x: number;
  y: number;
  z: number;
  /** Object flags from map data. */
  flags: number;
  /** INI template name (road type identifier). */
  templateName: string;
}

/** A road segment connecting two points. */
export interface RoadSegment {
  start: RoadPoint;
  end: RoadPoint;
}

/** Configuration for road rendering. */
export interface RoadRenderConfig {
  /** Road width in world units. Default 5.0. */
  width?: number;
  /** Tessellation step size in world units. Default 2.0. */
  stepSize?: number;
  /** Height offset above terrain. Default 0.15. */
  heightOffset?: number;
  /** Road color (hex) when no texture is available. Default 0x666666. */
  color?: number;
}

// Map object flag constants.
const ROAD_POINT1 = 0x002;
const ROAD_POINT2 = 0x004;

/** Heightmap query function signature. */
export type HeightmapQuery = (worldX: number, worldZ: number) => number;

/**
 * Extract road segments from map objects.
 * Road objects with ROAD_POINT1 and ROAD_POINT2 flags are paired by
 * matching template names and proximity.
 */
export function extractRoadSegments(
  objects: ReadonlyArray<{ position: { x: number; y: number; z: number }; flags: number; templateName: string }>,
): RoadSegment[] {
  const point1s: RoadPoint[] = [];
  const point2s: RoadPoint[] = [];

  for (const obj of objects) {
    const isRoadPoint1 = (obj.flags & ROAD_POINT1) !== 0;
    const isRoadPoint2 = (obj.flags & ROAD_POINT2) !== 0;

    if (isRoadPoint1) {
      point1s.push({
        x: obj.position.x,
        y: obj.position.y,
        z: obj.position.z,
        flags: obj.flags,
        templateName: obj.templateName,
      });
    }
    if (isRoadPoint2) {
      point2s.push({
        x: obj.position.x,
        y: obj.position.y,
        z: obj.position.z,
        flags: obj.flags,
        templateName: obj.templateName,
      });
    }
  }

  // Pair point1s with nearest point2 of same template.
  const segments: RoadSegment[] = [];
  const usedPoint2s = new Set<number>();

  for (const p1 of point1s) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < point2s.length; i++) {
      if (usedPoint2s.has(i)) continue;
      const p2 = point2s[i]!;
      if (p2.templateName !== p1.templateName) continue;

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      usedPoint2s.add(bestIdx);
      segments.push({ start: p1, end: point2s[bestIdx]! });
    }
  }

  return segments;
}

/**
 * Build connected road paths by joining segments that share endpoints.
 * Returns arrays of ordered points forming continuous road paths.
 */
export function buildRoadPaths(segments: RoadSegment[]): RoadPoint[][] {
  if (segments.length === 0) return [];

  // Build adjacency from endpoints.
  const SNAP_DIST = 2.0; // World units — snap threshold for connecting segments.
  const paths: RoadPoint[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    const path = [segments[i]!.start, segments[i]!.end];

    // Extend forward from path end.
    let extended = true;
    while (extended) {
      extended = false;
      const tail = path[path.length - 1]!;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const seg = segments[j]!;
        if (pointsClose(tail, seg.start, SNAP_DIST)) {
          used.add(j);
          path.push(seg.end);
          extended = true;
          break;
        }
        if (pointsClose(tail, seg.end, SNAP_DIST)) {
          used.add(j);
          path.push(seg.start);
          extended = true;
          break;
        }
      }
    }

    // Extend backward from path start.
    extended = true;
    while (extended) {
      extended = false;
      const head = path[0]!;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const seg = segments[j]!;
        if (pointsClose(head, seg.end, SNAP_DIST)) {
          used.add(j);
          path.unshift(seg.start);
          extended = true;
          break;
        }
        if (pointsClose(head, seg.start, SNAP_DIST)) {
          used.add(j);
          path.unshift(seg.end);
          extended = true;
          break;
        }
      }
    }

    paths.push(path);
  }

  return paths;
}

function pointsClose(a: RoadPoint, b: RoadPoint, threshold: number): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz < threshold * threshold;
}

/**
 * Generate a road mesh for a path of points, tessellated along the terrain.
 */
export function buildRoadMesh(
  path: RoadPoint[],
  getHeight: HeightmapQuery,
  config: RoadRenderConfig = {},
): THREE.Mesh | null {
  if (path.length < 2) return null;

  const width = config.width ?? 5.0;
  const stepSize = config.stepSize ?? 2.0;
  const heightOffset = config.heightOffset ?? 0.15;
  const color = config.color ?? 0x666666;
  const halfWidth = width / 2;

  // Tessellate path into evenly-spaced points along the road.
  const tessellated = tessellatePath(path, stepSize);
  if (tessellated.length < 2) return null;

  // Generate vertices: two columns (left/right edge) per tessellated point.
  const vertexCount = tessellated.length * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let accumulatedDist = 0;

  for (let i = 0; i < tessellated.length; i++) {
    const pt = tessellated[i]!;

    // Compute road direction at this point.
    let dx: number, dz: number;
    if (i < tessellated.length - 1) {
      dx = tessellated[i + 1]!.x - pt.x;
      dz = tessellated[i + 1]!.z - pt.z;
    } else {
      dx = pt.x - tessellated[i - 1]!.x;
      dz = pt.z - tessellated[i - 1]!.z;
    }
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
    }

    // Perpendicular direction (left side of road).
    const perpX = -dz;
    const perpZ = dx;

    // Left vertex.
    const lx = pt.x + perpX * halfWidth;
    const lz = pt.z + perpZ * halfWidth;
    const ly = getHeight(lx, lz) + heightOffset;

    // Right vertex.
    const rx = pt.x - perpX * halfWidth;
    const rz = pt.z - perpZ * halfWidth;
    const ry = getHeight(rx, rz) + heightOffset;

    const baseIdx = i * 2;
    positions[baseIdx * 3] = lx;
    positions[baseIdx * 3 + 1] = ly;
    positions[baseIdx * 3 + 2] = lz;
    positions[(baseIdx + 1) * 3] = rx;
    positions[(baseIdx + 1) * 3 + 1] = ry;
    positions[(baseIdx + 1) * 3 + 2] = rz;

    // UV: V along road length, U across width.
    if (i > 0) {
      const prevPt = tessellated[i - 1]!;
      accumulatedDist += Math.sqrt(
        (pt.x - prevPt.x) ** 2 + (pt.z - prevPt.z) ** 2,
      );
    }
    const v = accumulatedDist / width; // Tile texture along road.
    uvs[baseIdx * 2] = 0;
    uvs[baseIdx * 2 + 1] = v;
    uvs[(baseIdx + 1) * 2] = 1;
    uvs[(baseIdx + 1) * 2 + 1] = v;
  }

  // Build triangle strip indices.
  const quadCount = tessellated.length - 1;
  const indices = new Uint32Array(quadCount * 6);
  for (let i = 0; i < quadCount; i++) {
    const bl = i * 2;
    const br = i * 2 + 1;
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    const idx = i * 6;
    indices[idx] = bl;
    indices[idx + 1] = br;
    indices[idx + 2] = tl;
    indices[idx + 3] = tl;
    indices[idx + 4] = br;
    indices[idx + 5] = tr;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain-road';
  mesh.renderOrder = 10;

  return mesh;
}

/**
 * Tessellate a path into evenly-spaced points.
 */
function tessellatePath(
  path: RoadPoint[],
  stepSize: number,
): Array<{ x: number; z: number }> {
  const result: Array<{ x: number; z: number }> = [];
  result.push({ x: path[0]!.x, z: path[0]!.z });

  let residual = 0;

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!;
    const curr = path[i]!;
    const dx = curr.x - prev.x;
    const dz = curr.z - prev.z;
    const segLength = Math.sqrt(dx * dx + dz * dz);
    if (segLength < 0.001) continue;

    const dirX = dx / segLength;
    const dirZ = dz / segLength;

    let distAlong = stepSize - residual;
    while (distAlong <= segLength) {
      result.push({
        x: prev.x + dirX * distAlong,
        z: prev.z + dirZ * distAlong,
      });
      distAlong += stepSize;
    }
    residual = segLength - (distAlong - stepSize);
  }

  // Always include the final point.
  const last = path[path.length - 1]!;
  const lastResult = result[result.length - 1]!;
  if (
    Math.abs(last.x - lastResult.x) > 0.01 ||
    Math.abs(last.z - lastResult.z) > 0.01
  ) {
    result.push({ x: last.x, z: last.z });
  }

  return result;
}

/**
 * TerrainRoadRenderer manages all road meshes for a map.
 */
export class TerrainRoadRenderer {
  private readonly scene: THREE.Scene;
  private readonly roadMeshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Build and add road meshes from map object data.
   */
  buildFromMapObjects(
    objects: ReadonlyArray<{ position: { x: number; y: number; z: number }; flags: number; templateName: string }>,
    getHeight: HeightmapQuery,
    config: RoadRenderConfig = {},
  ): void {
    this.dispose();

    const segments = extractRoadSegments(objects);
    const paths = buildRoadPaths(segments);

    for (const path of paths) {
      const mesh = buildRoadMesh(path, getHeight, config);
      if (mesh) {
        this.scene.add(mesh);
        this.roadMeshes.push(mesh);
      }
    }
  }

  getRoadCount(): number {
    return this.roadMeshes.length;
  }

  dispose(): void {
    for (const mesh of this.roadMeshes) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.geometry.dispose();
    }
    this.roadMeshes.length = 0;
  }
}
