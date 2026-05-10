import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DecalManager } from './decal-manager.js';

describe('DecalManager', () => {
  let scene: THREE.Scene;
  let manager: DecalManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new DecalManager(scene, 100, 50);
    manager.init();
  });

  it('adds scorch marks through terrain scorch subsystem', () => {
    manager.addScorchMark('RANDOM', 5, new THREE.Vector3(10, 0, 20));
    expect(manager.terrainScorch.getActiveCount()).toBe(1);
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(1);
  });

  it('respects scorch mark cap', () => {
    // Max is 50
    for (let i = 0; i < 60; i++) {
      manager.addScorchMark('RANDOM', 3, new THREE.Vector3(i, 0, 0));
    }

    expect(manager.terrainScorch.getActiveCount()).toBeLessThanOrEqual(50);
  });

  it('resets all state', () => {
    manager.addScorchMark('RANDOM', 5, new THREE.Vector3(0, 0, 0));
    manager.addScorchMark('SCORCH_1', 3, new THREE.Vector3(5, 0, 5));

    manager.reset();
    expect(manager.terrainScorch.getActiveCount()).toBe(0);
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(0);
  });

  it('updates decal renderer each frame', () => {
    manager.addScorchMark('RANDOM', 5, new THREE.Vector3(0, 0, 0));
    // Should not throw
    manager.update(0.016);
    manager.update(0.016);
    expect(manager.decalRenderer.getActiveDecalCount()).toBeGreaterThanOrEqual(0);
  });

  it('syncs source RadiusDecalUpdate render states into projected decals', () => {
    manager.syncRadiusDecals([{
      id: 7,
      isOwnedByLocalPlayer: true,
      radiusDecals: [{
        positionX: 10,
        positionY: 2,
        positionZ: 20,
        radius: 35,
        visible: true,
        textureName: 'SCCScudStorm_GLA',
        shadowType: 'SHADOW_ALPHA_DECAL',
        minOpacity: 0.25,
        maxOpacity: 0.5,
        opacityThrobFrames: 30,
        color: ((255 << 24) | (33 << 16) | (255 << 8) | 67) | 0,
        onlyVisibleToOwningPlayer: true,
      }],
    }]);

    expect(manager.decalRenderer.getActiveDecalCount()).toBe(1);
    const mesh = scene.children.find((child) => child.name.startsWith('decal-')) as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(mesh.position.toArray()).toEqual([10, 2.08, 20]);
    expect(mesh.scale.toArray()).toEqual([70, 70, 1]);
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0x21ff43);
    expect(material.opacity).toBe(0.5);

    manager.update(0.75);
    expect(material.opacity).toBeCloseTo(0.25, 5);
  });

  it('removes radius decals when source state disappears', () => {
    manager.syncRadiusDecals([{
      id: 1,
      isOwnedByLocalPlayer: true,
      radiusDecals: [{
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        radius: 10,
        visible: true,
        textureName: 'Radius',
      }],
    }]);
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(1);

    manager.syncRadiusDecals([]);
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(0);
  });

  it('recreates a radius decal if the shared decal cap evicted it', () => {
    const cappedManager = new DecalManager(scene, 1, 50);
    const state = {
      id: 1,
      isOwnedByLocalPlayer: true,
      radiusDecals: [{
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        radius: 10,
        visible: true,
        textureName: 'Radius',
      }],
    };

    cappedManager.syncRadiusDecals([state]);
    expect(cappedManager.decalRenderer.getActiveDecalCount()).toBe(1);
    cappedManager.addScorchMark('RANDOM', 2, new THREE.Vector3(4, 0, 4));
    expect(cappedManager.decalRenderer.getActiveDecalCount()).toBe(1);

    cappedManager.syncRadiusDecals([state]);
    expect(cappedManager.decalRenderer.getActiveDecalCount()).toBe(1);
    const mesh = scene.children.find((child) => child.name.startsWith('decal-')) as THREE.Mesh;
    expect(mesh.position.x).toBe(0);
    cappedManager.dispose();
  });

  it('honors owning-player visibility for source radius decals', () => {
    manager.syncRadiusDecals([{
      id: 2,
      isOwnedByLocalPlayer: false,
      radiusDecals: [{
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        radius: 10,
        visible: true,
        textureName: 'Radius',
        onlyVisibleToOwningPlayer: true,
      }],
    }]);

    expect(manager.decalRenderer.getActiveDecalCount()).toBe(0);
  });

  it('uses source owning player color when RadiusDecalTemplate color is 0', () => {
    manager.syncRadiusDecals([{
      id: 3,
      isOwnedByLocalPlayer: true,
      radiusDecals: [{
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        radius: 10,
        visible: true,
        textureName: 'Radius',
        color: 0,
        ownerColor: 0xff123456 | 0,
      }],
    }]);

    const mesh = scene.children.find((child) => child.name.startsWith('decal-')) as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x123456);
  });

  it('preserves permanent scorch lifetimes for pre-placed map decals', async () => {
    manager.addScorchMark('SCORCH_4', 12, new THREE.Vector3(0, 0, 0), 0);

    await new Promise((resolve) => setTimeout(resolve, 10));
    manager.update(0.016);

    expect(manager.terrainScorch.getActiveCount()).toBe(1);
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(1);
  });

  it('disposes cleanly', () => {
    manager.addScorchMark('RANDOM', 5, new THREE.Vector3(0, 0, 0));
    manager.dispose();
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(0);
  });
});
