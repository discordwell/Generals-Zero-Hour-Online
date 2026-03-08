import * as THREE from 'three';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { DynamicLightManager } from './dynamic-lights.js';

describe('DynamicLightManager', () => {
  let scene: THREE.Scene;
  let manager: DynamicLightManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new DynamicLightManager(scene);
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
  });

  it('adds a point light to the scene', () => {
    manager.addLight(5, 1, 10);
    expect(manager.getActiveLightCount()).toBe(1);
    const light = scene.getObjectByName('dynamic-light');
    expect(light).toBeTruthy();
    expect(light).toBeInstanceOf(THREE.PointLight);
  });

  it('positions light above the specified world position', () => {
    manager.addLight(5, 2, 10);
    const light = scene.getObjectByName('dynamic-light') as THREE.PointLight;
    expect(light.position.x).toBe(5);
    expect(light.position.y).toBe(3); // y + 1 offset
    expect(light.position.z).toBe(10);
  });

  it('removes expired lights after lifetime', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    manager.addLight(0, 0, 0, { fullIntensityMs: 50, fadeMs: 50 });
    expect(manager.getActiveLightCount()).toBe(1);

    vi.spyOn(performance, 'now').mockReturnValue(now + 101);
    manager.update();
    expect(manager.getActiveLightCount()).toBe(0);
    expect(scene.getObjectByName('dynamic-light')).toBeUndefined();
  });

  it('fades light intensity during fade phase', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    manager.addLight(0, 0, 0, {
      intensity: 4.0,
      fullIntensityMs: 100,
      fadeMs: 100,
    });

    // Halfway through fade.
    vi.spyOn(performance, 'now').mockReturnValue(now + 150);
    manager.update();
    const light = scene.getObjectByName('dynamic-light') as THREE.PointLight;
    expect(light.intensity).toBeCloseTo(2.0, 1);
  });

  it('caps active lights at 16 by removing oldest', () => {
    for (let i = 0; i < 20; i++) {
      manager.addLight(i, 0, 0);
    }
    expect(manager.getActiveLightCount()).toBe(16);
  });

  it('addExplosionLight creates a bright wide light', () => {
    manager.addExplosionLight(5, 0, 5, 10);
    expect(manager.getActiveLightCount()).toBe(1);
    const light = scene.getObjectByName('dynamic-light') as THREE.PointLight;
    expect(light.intensity).toBeGreaterThan(1);
    expect(light.distance).toBeGreaterThan(20);
  });

  it('addMuzzleFlashLight creates a brief small light', () => {
    manager.addMuzzleFlashLight(5, 0, 5);
    expect(manager.getActiveLightCount()).toBe(1);
    const light = scene.getObjectByName('dynamic-light') as THREE.PointLight;
    expect(light.intensity).toBe(1.5);
    expect(light.distance).toBe(8);
  });

  it('dispose cleans up all lights', () => {
    manager.addLight(0, 0, 0);
    manager.addLight(1, 0, 0);
    manager.addLight(2, 0, 0);
    manager.dispose();
    expect(manager.getActiveLightCount()).toBe(0);
    const lights = scene.children.filter((c) => c.name === 'dynamic-light');
    expect(lights.length).toBe(0);
  });
});
