import * as THREE from 'three';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { TracerRenderer } from './tracer-renderer.js';

describe('TracerRenderer', () => {
  let scene: THREE.Scene;
  let renderer: TracerRenderer;

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new TracerRenderer(scene);
  });

  afterEach(() => {
    renderer.dispose();
    vi.restoreAllMocks();
  });

  it('adds a tracer mesh to the scene', () => {
    renderer.addTracer(0, 1, 0, 50, 1, 0);
    expect(renderer.getActiveTracerCount()).toBe(1);
    const tracer = scene.getObjectByName('tracer');
    expect(tracer).toBeTruthy();
    expect(tracer).toBeInstanceOf(THREE.Mesh);
  });

  it('positions tracer at source position', () => {
    renderer.addTracer(5, 2, 10, 50, 2, 10);
    const tracer = scene.getObjectByName('tracer') as THREE.Mesh;
    expect(tracer.position.x).toBe(5);
    expect(tracer.position.y).toBe(2);
    expect(tracer.position.z).toBe(10);
  });

  it('uses additive blending for glow effect', () => {
    renderer.addTracer(0, 0, 0, 10, 0, 0);
    const tracer = scene.getObjectByName('tracer') as THREE.Mesh;
    const material = tracer.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it('removes expired tracers after lifetime', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    // Short distance = short lifetime.
    renderer.addTracer(0, 0, 0, 10, 0, 0, { speed: 120 });
    expect(renderer.getActiveTracerCount()).toBe(1);

    // Advance well past lifetime.
    vi.spyOn(performance, 'now').mockReturnValue(now + 5000);
    renderer.update();
    expect(renderer.getActiveTracerCount()).toBe(0);
    expect(scene.getObjectByName('tracer')).toBeUndefined();
  });

  it('fades tracer opacity over lifetime', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    // 48 units distance, speed=120 → lifetime ≈ (48-2)/120*1000 = 383ms
    renderer.addTracer(0, 0, 0, 50, 0, 0, { speed: 120, opacity: 1.0 });

    // Halfway through lifetime.
    vi.spyOn(performance, 'now').mockReturnValue(now + 192);
    renderer.update();
    const tracer = scene.getObjectByName('tracer') as THREE.Mesh;
    const material = tracer.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(0.5, 1);
  });

  it('supports custom colors', () => {
    renderer.addTracer(0, 0, 0, 10, 0, 0, { color: 0xff0000 });
    const tracer = scene.getObjectByName('tracer') as THREE.Mesh;
    const material = tracer.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0xff0000);
  });

  it('scales mesh to configured length and width', () => {
    renderer.addTracer(0, 0, 0, 50, 0, 0, { length: 3.0, width: 0.1 });
    const tracer = scene.getObjectByName('tracer') as THREE.Mesh;
    expect(tracer.scale.x).toBe(3.0);
    expect(tracer.scale.y).toBe(0.1);
    expect(tracer.scale.z).toBe(0.1);
  });

  it('caps active tracers at 64 by removing oldest', () => {
    for (let i = 0; i < 70; i++) {
      renderer.addTracer(i, 0, 0, i + 50, 0, 0);
    }
    expect(renderer.getActiveTracerCount()).toBe(64);
  });

  it('disposes all tracers and cleans scene', () => {
    renderer.addTracer(0, 0, 0, 10, 0, 0);
    renderer.addTracer(0, 0, 0, 0, 10, 0);
    renderer.addTracer(0, 0, 0, 0, 0, 10);
    expect(renderer.getActiveTracerCount()).toBe(3);

    renderer.dispose();
    expect(renderer.getActiveTracerCount()).toBe(0);
    const tracers = scene.children.filter((c) => c.name === 'tracer');
    expect(tracers.length).toBe(0);
  });

  it('moves tracer forward along direction each update', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    renderer.addTracer(0, 0, 0, 100, 0, 0, { speed: 120 });
    const tracer = scene.getObjectByName('tracer') as THREE.Mesh;
    const initialX = tracer.position.x;

    // One update tick.
    vi.spyOn(performance, 'now').mockReturnValue(now + 16);
    renderer.update();

    // Should have moved forward (positive X direction).
    expect(tracer.position.x).toBeGreaterThan(initialX);
  });
});
