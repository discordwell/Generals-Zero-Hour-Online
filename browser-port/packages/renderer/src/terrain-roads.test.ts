import * as THREE from 'three';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import {
  extractRoadSegments,
  buildRoadPaths,
  buildRoadMesh,
  TerrainRoadRenderer,
  type RoadPoint,
} from './terrain-roads.js';

// Flat heightmap for testing.
const flatHeight = () => 0;

function makeRoadObj(
  x: number, z: number, flags: number, templateName = 'TwoLaneRoad',
) {
  return { position: { x, y: 0, z }, flags, templateName };
}

describe('extractRoadSegments', () => {
  it('pairs ROAD_POINT1 with nearest ROAD_POINT2 of same template', () => {
    const objects = [
      makeRoadObj(0, 0, 0x002),   // ROAD_POINT1
      makeRoadObj(10, 0, 0x004),  // ROAD_POINT2
    ];
    const segments = extractRoadSegments(objects);
    expect(segments.length).toBe(1);
    expect(segments[0]!.start.x).toBe(0);
    expect(segments[0]!.end.x).toBe(10);
  });

  it('ignores objects without road flags', () => {
    const objects = [
      makeRoadObj(0, 0, 0x001),   // DRAWS_IN_MIRROR only
      makeRoadObj(10, 0, 0x100),  // DONT_RENDER only
    ];
    const segments = extractRoadSegments(objects);
    expect(segments.length).toBe(0);
  });

  it('matches multiple segments by template name', () => {
    const objects = [
      makeRoadObj(0, 0, 0x002, 'RoadA'),
      makeRoadObj(10, 0, 0x004, 'RoadA'),
      makeRoadObj(20, 0, 0x002, 'RoadB'),
      makeRoadObj(30, 0, 0x004, 'RoadB'),
    ];
    const segments = extractRoadSegments(objects);
    expect(segments.length).toBe(2);
  });

  it('does not cross-match different template names', () => {
    const objects = [
      makeRoadObj(0, 0, 0x002, 'RoadA'),
      makeRoadObj(10, 0, 0x004, 'RoadB'),
    ];
    const segments = extractRoadSegments(objects);
    expect(segments.length).toBe(0);
  });
});

describe('buildRoadPaths', () => {
  it('joins connected segments into a single path', () => {
    const segments = [
      {
        start: { x: 0, y: 0, z: 0, flags: 0x002, templateName: 'R' },
        end: { x: 10, y: 0, z: 0, flags: 0x004, templateName: 'R' },
      },
      {
        start: { x: 10, y: 0, z: 0, flags: 0x002, templateName: 'R' },
        end: { x: 20, y: 0, z: 0, flags: 0x004, templateName: 'R' },
      },
    ];
    const paths = buildRoadPaths(segments);
    expect(paths.length).toBe(1);
    expect(paths[0]!.length).toBe(3);
  });

  it('creates separate paths for disconnected segments', () => {
    const segments = [
      {
        start: { x: 0, y: 0, z: 0, flags: 0x002, templateName: 'R' },
        end: { x: 10, y: 0, z: 0, flags: 0x004, templateName: 'R' },
      },
      {
        start: { x: 100, y: 0, z: 100, flags: 0x002, templateName: 'R' },
        end: { x: 110, y: 0, z: 100, flags: 0x004, templateName: 'R' },
      },
    ];
    const paths = buildRoadPaths(segments);
    expect(paths.length).toBe(2);
  });

  it('returns empty array for no segments', () => {
    expect(buildRoadPaths([])).toEqual([]);
  });
});

describe('buildRoadMesh', () => {
  const simplePath: RoadPoint[] = [
    { x: 0, y: 0, z: 0, flags: 0x002, templateName: 'R' },
    { x: 20, y: 0, z: 0, flags: 0x004, templateName: 'R' },
  ];

  it('creates a mesh with correct name', () => {
    const mesh = buildRoadMesh(simplePath, flatHeight);
    expect(mesh).toBeTruthy();
    expect(mesh!.name).toBe('terrain-road');
  });

  it('generates geometry with position and uv attributes', () => {
    const mesh = buildRoadMesh(simplePath, flatHeight)!;
    const geo = mesh.geometry;
    expect(geo.getAttribute('position')).toBeTruthy();
    expect(geo.getAttribute('uv')).toBeTruthy();
    expect(geo.index).toBeTruthy();
  });

  it('uses double-sided material for road visibility', () => {
    const mesh = buildRoadMesh(simplePath, flatHeight)!;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.side).toBe(THREE.DoubleSide);
  });

  it('returns null for path with fewer than 2 points', () => {
    const path: RoadPoint[] = [
      { x: 0, y: 0, z: 0, flags: 0x002, templateName: 'R' },
    ];
    expect(buildRoadMesh(path, flatHeight)).toBeNull();
  });

  it('samples terrain height for vertex Y positions', () => {
    const hillHeight = (x: number, _z: number) => x * 0.5;
    const mesh = buildRoadMesh(simplePath, hillHeight, { heightOffset: 0 })!;
    const positions = mesh.geometry.getAttribute('position');
    // Vertices at x>0 should have y>0 due to hill.
    let foundElevated = false;
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) > 0) {
        foundElevated = true;
        break;
      }
    }
    expect(foundElevated).toBe(true);
  });

  it('tessellates long segments into multiple vertices', () => {
    const longPath: RoadPoint[] = [
      { x: 0, y: 0, z: 0, flags: 0x002, templateName: 'R' },
      { x: 100, y: 0, z: 0, flags: 0x004, templateName: 'R' },
    ];
    const mesh = buildRoadMesh(longPath, flatHeight, { stepSize: 2.0 })!;
    const positions = mesh.geometry.getAttribute('position');
    // 100 units / 2.0 step = ~50 steps → ~51 points × 2 sides = ~102 vertices.
    expect(positions.count).toBeGreaterThan(80);
  });
});

describe('TerrainRoadRenderer', () => {
  let scene: THREE.Scene;
  let renderer: TerrainRoadRenderer;

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new TerrainRoadRenderer(scene);
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('builds road meshes from map objects', () => {
    const objects = [
      makeRoadObj(0, 0, 0x002),
      makeRoadObj(20, 0, 0x004),
    ];
    renderer.buildFromMapObjects(objects, flatHeight);
    expect(renderer.getRoadCount()).toBe(1);
    expect(scene.getObjectByName('terrain-road')).toBeTruthy();
  });

  it('does nothing when no road objects exist', () => {
    renderer.buildFromMapObjects([], flatHeight);
    expect(renderer.getRoadCount()).toBe(0);
  });

  it('disposes all road meshes', () => {
    const objects = [
      makeRoadObj(0, 0, 0x002),
      makeRoadObj(20, 0, 0x004),
      makeRoadObj(50, 50, 0x002),
      makeRoadObj(70, 50, 0x004),
    ];
    renderer.buildFromMapObjects(objects, flatHeight);
    expect(renderer.getRoadCount()).toBeGreaterThan(0);

    renderer.dispose();
    expect(renderer.getRoadCount()).toBe(0);
    expect(scene.children.filter((c) => c.name === 'terrain-road').length).toBe(0);
  });
});
