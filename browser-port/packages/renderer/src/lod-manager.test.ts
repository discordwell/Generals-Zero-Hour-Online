import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { LODManager } from './lod-manager.js';

describe('LODManager', () => {
  let manager: LODManager;

  beforeEach(() => {
    manager = new LODManager();
    manager.init();
  });

  it('detects multi-LOD GLTFs', () => {
    expect(LODManager.hasMultipleLODs({ scenes: [new THREE.Group()] })).toBe(false);
    expect(LODManager.hasMultipleLODs({ scenes: [new THREE.Group(), new THREE.Group()] })).toBe(true);
    expect(LODManager.hasMultipleLODs({})).toBe(false);
  });

  it('returns null for single-scene GLTFs', () => {
    const result = manager.createLOD(
      { scenes: [new THREE.Group()] },
      1.0, 768, Math.PI / 4,
    );
    expect(result).toBeNull();
  });

  it('creates THREE.LOD from multi-scene GLTF', () => {
    const scene0 = new THREE.Group();
    scene0.name = 'high';
    const scene1 = new THREE.Group();
    scene1.name = 'low';

    const gltf = {
      scenes: [scene0, scene1],
      parser: {
        json: {
          scenes: [
            { extras: undefined },          // LOD0: maxScreenSize=0
            { extras: { maxScreenSize: 50 } }, // LOD1: maxScreenSize=50
          ],
        },
      },
    };

    const lod = manager.createLOD(gltf, 2.0, 768, Math.PI / 4);
    expect(lod).toBeInstanceOf(THREE.LOD);
    expect(lod!.levels).toHaveLength(2);
    expect(lod!.levels[0]!.distance).toBe(0);
    expect(lod!.levels[1]!.distance).toBeGreaterThan(0);
    expect(manager.getLODCount()).toBe(1);
  });

  it('computes correct distance from maxScreenSize', () => {
    const scene0 = new THREE.Group();
    const scene1 = new THREE.Group();

    const gltf = {
      scenes: [scene0, scene1],
      parser: {
        json: {
          scenes: [
            {},
            { extras: { maxScreenSize: 100 } },
          ],
        },
      },
    };

    const fov = Math.PI / 4;
    const viewportHeight = 768;
    const objectRadius = 5;

    const lod = manager.createLOD(gltf, objectRadius, viewportHeight, fov);
    expect(lod).not.toBeNull();

    // Expected distance = (radius * viewportHeight) / (maxScreenSize * tan(fov/2))
    const expected = (objectRadius * viewportHeight) / (100 * Math.tan(fov / 2));
    expect(lod!.levels[1]!.distance).toBeCloseTo(expected, 2);
  });

  it('updates LODs with camera', () => {
    const scene0 = new THREE.Group();
    const scene1 = new THREE.Group();

    const lod = manager.createLOD(
      {
        scenes: [scene0, scene1],
        parser: { json: { scenes: [{}, { extras: { maxScreenSize: 50 } }] } },
      },
      2.0, 768, Math.PI / 4,
    );

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    manager.setCamera(camera);

    // Should not throw
    manager.update(0.016);
    expect(lod).not.toBeNull();
  });

  it('registers external LODs', () => {
    const lod = new THREE.LOD();
    manager.registerLOD(lod);
    expect(manager.getLODCount()).toBe(1);
  });

  it('resets and disposes cleanly', () => {
    const lod = new THREE.LOD();
    manager.registerLOD(lod);
    expect(manager.getLODCount()).toBe(1);

    manager.reset();
    expect(manager.getLODCount()).toBe(0);

    manager.registerLOD(lod);
    manager.dispose();
    expect(manager.getLODCount()).toBe(0);
  });
});
