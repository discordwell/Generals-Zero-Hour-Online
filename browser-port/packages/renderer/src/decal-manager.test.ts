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

  it('disposes cleanly', () => {
    manager.addScorchMark('RANDOM', 5, new THREE.Vector3(0, 0, 0));
    manager.dispose();
    expect(manager.decalRenderer.getActiveDecalCount()).toBe(0);
  });
});
