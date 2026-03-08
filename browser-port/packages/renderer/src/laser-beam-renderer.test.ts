import * as THREE from 'three';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { LaserBeamRenderer } from './laser-beam-renderer.js';

describe('LaserBeamRenderer', () => {
  let scene: THREE.Scene;
  let renderer: LaserBeamRenderer;

  beforeEach(() => {
    scene = new THREE.Scene();
    renderer = new LaserBeamRenderer(scene);
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('adds a beam with inner and outer meshes to the scene', () => {
    renderer.addBeam(0, 1, 0, 10, 1, 0);
    expect(renderer.getActiveBeamCount()).toBe(1);

    const beamMeshes = scene.children.filter(
      (c) => c.name === 'laser-beam-inner' || c.name === 'laser-beam-outer',
    );
    expect(beamMeshes.length).toBe(2);
  });

  it('positions beam meshes at midpoint between start and end', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0);
    const inner = scene.getObjectByName('laser-beam-inner') as THREE.Mesh;
    expect(inner).toBeTruthy();
    expect(inner.position.x).toBeCloseTo(5, 1);
    expect(inner.position.y).toBeCloseTo(0, 1);
    expect(inner.position.z).toBeCloseTo(0, 1);
  });

  it('uses additive blending for glow effect', () => {
    renderer.addBeam(0, 0, 0, 5, 0, 0);
    const inner = scene.getObjectByName('laser-beam-inner') as THREE.Mesh;
    const material = inner.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.transparent).toBe(true);
  });

  it('removes expired beams after full lifetime', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    renderer.addBeam(0, 0, 0, 5, 0, 0, {
      fullIntensityMs: 50,
      fadeMs: 50,
    });
    expect(renderer.getActiveBeamCount()).toBe(1);

    // Advance past lifetime.
    vi.spyOn(performance, 'now').mockReturnValue(now + 101);
    renderer.update();
    expect(renderer.getActiveBeamCount()).toBe(0);

    // Meshes removed from scene.
    const beamMeshes = scene.children.filter(
      (c) => c.name === 'laser-beam-inner' || c.name === 'laser-beam-outer',
    );
    expect(beamMeshes.length).toBe(0);

    vi.restoreAllMocks();
  });

  it('fades beam opacity during fade phase', () => {
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);

    renderer.addBeam(0, 0, 0, 5, 0, 0, {
      fullIntensityMs: 100,
      fadeMs: 100,
    });

    // During full intensity phase — opacity should be 1.
    vi.spyOn(performance, 'now').mockReturnValue(now + 50);
    renderer.update();
    const inner = scene.getObjectByName('laser-beam-inner') as THREE.Mesh;
    expect((inner.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1.0, 1);

    // Halfway through fade phase — opacity ~0.5.
    vi.spyOn(performance, 'now').mockReturnValue(now + 150);
    renderer.update();
    expect((inner.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.5, 1);

    vi.restoreAllMocks();
  });

  it('supports custom colors', () => {
    renderer.addBeam(0, 0, 0, 5, 0, 0, {
      innerColor: 0x00ff00,
      outerColor: 0x0000ff,
    });
    const inner = scene.getObjectByName('laser-beam-inner') as THREE.Mesh;
    const outer = scene.getObjectByName('laser-beam-outer') as THREE.Mesh;
    expect((inner.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x00ff00);
    expect((outer.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x0000ff);
  });

  it('disposes all beams and cleans scene', () => {
    renderer.addBeam(0, 0, 0, 5, 0, 0);
    renderer.addBeam(0, 0, 0, 0, 5, 0);
    expect(renderer.getActiveBeamCount()).toBe(2);

    renderer.dispose();
    expect(renderer.getActiveBeamCount()).toBe(0);
    const beamMeshes = scene.children.filter(
      (c) => c.name === 'laser-beam-inner' || c.name === 'laser-beam-outer',
    );
    expect(beamMeshes.length).toBe(0);
  });

  it('handles multiple simultaneous beams', () => {
    renderer.addBeam(0, 0, 0, 5, 0, 0);
    renderer.addBeam(0, 0, 0, 0, 5, 0);
    renderer.addBeam(0, 0, 0, 0, 0, 5);
    expect(renderer.getActiveBeamCount()).toBe(3);
    expect(scene.children.length).toBe(6); // 3 beams × 2 meshes
  });
});
