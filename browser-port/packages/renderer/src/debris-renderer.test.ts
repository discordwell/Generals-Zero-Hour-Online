import * as THREE from 'three';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { DebrisRenderer } from './debris-renderer.js';

describe('DebrisRenderer', () => {
  let scene: THREE.Scene;
  let renderer: DebrisRenderer;

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new DebrisRenderer(scene);
  });

  afterEach(() => {
    renderer.dispose();
    vi.restoreAllMocks();
  });

  it('spawns the configured number of debris chunks', () => {
    renderer.spawnDebris(0, 0, 0, { count: 4 });
    expect(renderer.getActiveChunkCount()).toBe(4);
    const debris = scene.children.filter((c) => c.name === 'debris');
    expect(debris.length).toBe(4);
  });

  it('spawns default 6 chunks when count not specified', () => {
    renderer.spawnDebris(0, 0, 0);
    expect(renderer.getActiveChunkCount()).toBe(6);
  });

  it('positions chunks near the spawn point', () => {
    renderer.spawnDebris(10, 5, 20, { count: 1, radius: 0.01 });
    const chunk = scene.getObjectByName('debris') as THREE.Mesh;
    expect(chunk.position.x).toBeCloseTo(10, 0);
    expect(chunk.position.y).toBeCloseTo(5.5, 0); // +0.5 offset
    expect(chunk.position.z).toBeCloseTo(20, 0);
  });

  it('removes expired chunks after lifetime', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    renderer.spawnDebris(0, 0, 0, { count: 3, lifetimeMs: 500 });
    expect(renderer.getActiveChunkCount()).toBe(3);

    vi.spyOn(performance, 'now').mockReturnValue(now + 501);
    renderer.update();
    expect(renderer.getActiveChunkCount()).toBe(0);
    expect(scene.children.filter((c) => c.name === 'debris').length).toBe(0);
  });

  it('fades chunk opacity in last 30% of lifetime', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    renderer.spawnDebris(0, 0, 0, { count: 1, lifetimeMs: 1000 });

    // At 50% lifetime (before fade starts at 70%).
    vi.spyOn(performance, 'now').mockReturnValue(now + 500);
    renderer.update();
    const chunk = scene.getObjectByName('debris') as THREE.Mesh;
    const material = chunk.material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBe(1.0);

    // At 85% lifetime (halfway through fade phase).
    vi.spyOn(performance, 'now').mockReturnValue(now + 850);
    renderer.update();
    expect(material.opacity).toBeCloseTo(0.5, 1);
  });

  it('applies gravity — chunks fall downward', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    // Start high up so we can see gravity effect.
    renderer.spawnDebris(0, 20, 0, {
      count: 1,
      upwardVelocity: [0, 0],
      horizontalVelocity: [0, 0],
    });
    const chunk = scene.getObjectByName('debris') as THREE.Mesh;
    const initialY = chunk.position.y;

    vi.spyOn(performance, 'now').mockReturnValue(now + 100);
    renderer.update();
    expect(chunk.position.y).toBeLessThan(initialY);
  });

  it('bounces chunks off the ground plane', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    renderer.spawnDebris(0, 0, 0, {
      count: 1,
      upwardVelocity: [0, 0],
      horizontalVelocity: [0, 0],
      lifetimeMs: 5000,
    });

    // Simulate multiple frames to let it fall and bounce.
    for (let i = 1; i <= 20; i++) {
      vi.spyOn(performance, 'now').mockReturnValue(now + i * 50);
      renderer.update();
    }

    const chunk = scene.getObjectByName('debris') as THREE.Mesh;
    // After bouncing, chunk should be at or above ground level.
    expect(chunk.position.y).toBeGreaterThanOrEqual(0);
  });

  it('caps active chunks at 256 by removing oldest', () => {
    for (let i = 0; i < 50; i++) {
      renderer.spawnDebris(i, 0, 0, { count: 6 });
    }
    // 50 * 6 = 300, but capped at 256.
    expect(renderer.getActiveChunkCount()).toBeLessThanOrEqual(256);
  });

  it('disposes all chunks and cleans scene', () => {
    renderer.spawnDebris(0, 0, 0, { count: 5 });
    renderer.spawnDebris(5, 0, 0, { count: 5 });
    expect(renderer.getActiveChunkCount()).toBe(10);

    renderer.dispose();
    expect(renderer.getActiveChunkCount()).toBe(0);
    expect(scene.children.filter((c) => c.name === 'debris').length).toBe(0);
  });

  it('supports custom color', () => {
    renderer.spawnDebris(0, 0, 0, { count: 1, color: 0xff0000 });
    const chunk = scene.getObjectByName('debris') as THREE.Mesh;
    const material = chunk.material as THREE.MeshStandardMaterial;
    // Red channel should be dominant (with variation).
    expect(material.color.r).toBeGreaterThan(0.5);
  });
});
