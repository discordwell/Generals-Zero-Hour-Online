import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { WaterVisual } from './water-visual.js';
import { generateProceduralTerrain } from './procedural-terrain.js';
import type { MapDataJSON, PolygonTriggerJSON } from './types.js';

function getWaterMeshes(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
}

/**
 * Build a minimal MapDataJSON with the given triggers.
 */
function mapWithTriggers(triggers: PolygonTriggerJSON[]): MapDataJSON {
  return {
    heightmap: { width: 16, height: 16, borderSize: 0, data: '' },
    objects: [],
    triggers,
    textureClasses: [],
    blendTileCount: 0,
  };
}

describe('WaterVisual', () => {
  it('creates water mesh from procedural terrain water trigger', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);
    const mapData = generateProceduralTerrain({ includeWater: true });

    water.loadFromMapData(mapData);

    const meshes = getWaterMeshes(scene);
    expect(meshes.length).toBe(1);
    expect(meshes[0]!.renderOrder).toBe(1);
  });

  it('does not create water meshes when enableWater is false', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene, { enableWater: false });
    const mapData = generateProceduralTerrain({ includeWater: true });

    water.loadFromMapData(mapData);

    expect(getWaterMeshes(scene).length).toBe(0);
  });

  it('does not create water meshes when no water triggers exist', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);
    const mapData = generateProceduralTerrain({ includeWater: false });

    water.loadFromMapData(mapData);

    expect(getWaterMeshes(scene).length).toBe(0);
  });

  it('creates water plane at correct height from engine coordinates', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    // Engine coordinates: x=horizontal, y=horizontal, z=height
    const waterHeight = 15;
    const mapData = mapWithTriggers([{
      name: 'TestWater',
      id: 1,
      isWaterArea: true,
      isRiver: false,
      points: [
        { x: 0, y: 0, z: waterHeight },
        { x: 100, y: 0, z: waterHeight },
        { x: 100, y: 100, z: waterHeight },
        { x: 0, y: 100, z: waterHeight },
      ],
    }]);

    water.loadFromMapData(mapData);

    const meshes = getWaterMeshes(scene);
    expect(meshes.length).toBe(1);

    // The water plane geometry should be translated to the water height (Three.js Y)
    const mesh = meshes[0]!;
    mesh.geometry.computeBoundingBox();
    const bbox = mesh.geometry.boundingBox!;
    // After ShapeGeometry rotate + translate, Y should be at waterHeight
    expect(bbox.min.y).toBeCloseTo(waterHeight, 1);
    expect(bbox.max.y).toBeCloseTo(waterHeight, 1);
  });

  it('uses engine coordinate mapping for horizontal extents', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    // Engine coordinates: x → Three.js X, y → Three.js Z
    const mapData = mapWithTriggers([{
      name: 'TestWater',
      id: 1,
      isWaterArea: true,
      isRiver: false,
      points: [
        { x: -500, y: -400, z: 5 },
        { x: 500, y: -400, z: 5 },
        { x: 500, y: 600, z: 5 },
        { x: -500, y: 600, z: 5 },
      ],
    }]);

    water.loadFromMapData(mapData);

    const meshes = getWaterMeshes(scene);
    expect(meshes.length).toBe(1);

    const mesh = meshes[0]!;
    mesh.geometry.computeBoundingBox();
    const bbox = mesh.geometry.boundingBox!;

    // X extent should match engine x range: [-500, 500]
    expect(bbox.min.x).toBeCloseTo(-500, 0);
    expect(bbox.max.x).toBeCloseTo(500, 0);

    // Z extent (Three.js) should match engine y range: [-400, 600]
    // ShapeGeometry is created in XY then rotated -90 around X,
    // so original shape Y becomes Three.js -Z, but the full extent should cover the range.
    const zMin = Math.min(bbox.min.z, bbox.max.z);
    const zMax = Math.max(bbox.min.z, bbox.max.z);
    expect(zMax - zMin).toBeCloseTo(1000, 0); // 600 - (-400) = 1000
  });

  it('clears water meshes on reset', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);
    const mapData = generateProceduralTerrain({ includeWater: true });

    water.loadFromMapData(mapData);
    expect(getWaterMeshes(scene).length).toBe(1);

    water.reset();
    expect(getWaterMeshes(scene).length).toBe(0);
  });

  it('clears water meshes on dispose', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);
    const mapData = generateProceduralTerrain({ includeWater: true });

    water.loadFromMapData(mapData);
    expect(getWaterMeshes(scene).length).toBe(1);

    water.dispose();
    expect(getWaterMeshes(scene).length).toBe(0);
  });

  it('skips triggers with fewer than 3 points', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    const mapData = mapWithTriggers([{
      name: 'TooFew',
      id: 1,
      isWaterArea: true,
      isRiver: false,
      points: [
        { x: 0, y: 0, z: 5 },
        { x: 100, y: 0, z: 5 },
      ],
    }]);

    water.loadFromMapData(mapData);
    expect(getWaterMeshes(scene).length).toBe(0);
  });

  it('handles multiple water triggers', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    const mapData = mapWithTriggers([
      {
        name: 'Water1',
        id: 1,
        isWaterArea: true,
        isRiver: false,
        points: [
          { x: 0, y: 0, z: 5 },
          { x: 100, y: 0, z: 5 },
          { x: 100, y: 100, z: 5 },
          { x: 0, y: 100, z: 5 },
        ],
      },
      {
        name: 'Water2',
        id: 2,
        isWaterArea: true,
        isRiver: false,
        points: [
          { x: 200, y: 200, z: 10 },
          { x: 300, y: 200, z: 10 },
          { x: 300, y: 300, z: 10 },
          { x: 200, y: 300, z: 10 },
        ],
      },
    ]);

    water.loadFromMapData(mapData);
    expect(getWaterMeshes(scene).length).toBe(2);
  });

  it('ignores non-water triggers', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    const mapData = mapWithTriggers([{
      name: 'NonWater',
      id: 1,
      isWaterArea: false,
      isRiver: false,
      points: [
        { x: 0, y: 0, z: 5 },
        { x: 100, y: 0, z: 5 },
        { x: 100, y: 100, z: 5 },
        { x: 0, y: 100, z: 5 },
      ],
    }]);

    water.loadFromMapData(mapData);
    expect(getWaterMeshes(scene).length).toBe(0);
  });

  it('stores base UVs for animation', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    const mapData = mapWithTriggers([{
      name: 'AnimWater',
      id: 1,
      isWaterArea: true,
      isRiver: false,
      points: [
        { x: 0, y: 0, z: 5 },
        { x: 100, y: 0, z: 5 },
        { x: 100, y: 100, z: 5 },
        { x: 0, y: 100, z: 5 },
      ],
    }]);

    water.loadFromMapData(mapData);

    const meshes = getWaterMeshes(scene);
    expect(meshes.length).toBe(1);
    const mesh = meshes[0]!;
    expect((mesh.userData as { baseUVs?: Float32Array }).baseUVs).toBeInstanceOf(Float32Array);
  });

  it('UV animation modifies UV coordinates over time', () => {
    const scene = new THREE.Scene();
    const water = new WaterVisual(scene);

    const mapData = mapWithTriggers([{
      name: 'AnimTest',
      id: 1,
      isWaterArea: true,
      isRiver: false,
      points: [
        { x: 0, y: 0, z: 5 },
        { x: 100, y: 0, z: 5 },
        { x: 100, y: 100, z: 5 },
        { x: 0, y: 100, z: 5 },
      ],
    }]);

    water.loadFromMapData(mapData);

    const meshes = getWaterMeshes(scene);
    const mesh = meshes[0]!;
    const uvAttr = mesh.geometry.getAttribute('uv');
    const initialUVs = new Float32Array(uvAttr.array.length);
    initialUVs.set(uvAttr.array as Float32Array);

    // Advance time significantly
    water.update(10);

    const updatedUVs = uvAttr.array as Float32Array;
    // At least some UVs should have shifted
    let anyDifferent = false;
    for (let i = 0; i < initialUVs.length; i++) {
      if (Math.abs(initialUVs[i]! - updatedUVs[i]!) > 0.0001) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });
});
