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

    // Default numBeams=2 creates layer-0 (inner) and layer-1 (outer), 1 segment each
    const layer0 = scene.children.filter((c) => c.name === 'laser-beam-layer-0');
    const layer1 = scene.children.filter((c) => c.name === 'laser-beam-layer-1');
    expect(layer0.length).toBe(1);
    expect(layer1.length).toBe(1);
  });

  it('positions beam meshes at midpoint between start and end', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0);
    const inner = scene.getObjectByName('laser-beam-layer-0') as THREE.Mesh;
    expect(inner).toBeTruthy();
    expect(inner.position.x).toBeCloseTo(5, 1);
    expect(inner.position.y).toBeCloseTo(0, 1);
    expect(inner.position.z).toBeCloseTo(0, 1);
  });

  it('uses additive blending for glow effect', () => {
    renderer.addBeam(0, 0, 0, 5, 0, 0);
    const inner = scene.getObjectByName('laser-beam-layer-0') as THREE.Mesh;
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
      (c) => c.name.startsWith('laser-beam-layer-'),
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
    const inner = scene.getObjectByName('laser-beam-layer-0') as THREE.Mesh;
    expect((inner.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1.0, 1);

    // Halfway through fade phase — inner base opacity is 1.0, so faded = 0.5.
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
    const inner = scene.getObjectByName('laser-beam-layer-0') as THREE.Mesh;
    const outer = scene.getObjectByName('laser-beam-layer-1') as THREE.Mesh;
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
      (c) => c.name.startsWith('laser-beam-layer-'),
    );
    expect(beamMeshes.length).toBe(0);
  });

  it('handles multiple simultaneous beams', () => {
    renderer.addBeam(0, 0, 0, 5, 0, 0);
    renderer.addBeam(0, 0, 0, 0, 5, 0);
    renderer.addBeam(0, 0, 0, 0, 0, 5);
    expect(renderer.getActiveBeamCount()).toBe(3);
    // 3 beams × 2 layers × 1 segment = 6 meshes
    expect(scene.children.length).toBe(6);
  });

  // --- Bug 1: NumBeams layering ---

  it('numBeams=3 creates 3 mesh layers per beam', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, { numBeams: 3 });
    expect(renderer.getActiveBeamCount()).toBe(1);

    const layer0 = scene.children.filter((c) => c.name === 'laser-beam-layer-0');
    const layer1 = scene.children.filter((c) => c.name === 'laser-beam-layer-1');
    const layer2 = scene.children.filter((c) => c.name === 'laser-beam-layer-2');
    expect(layer0.length).toBe(1);
    expect(layer1.length).toBe(1);
    expect(layer2.length).toBe(1);
    // Total meshes in scene = 3
    expect(scene.children.length).toBe(3);
  });

  it('numBeams layers interpolate width between inner and outer', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, {
      numBeams: 3,
      innerWidth: 0.1,
      outerWidth: 0.4,
    });

    // Layer 0 (inner): width = 0.1, layer 1 (mid): width = 0.25, layer 2 (outer): width = 0.4
    // Width is set via mesh.scale.x
    const meshes = scene.children.filter((c) => c.name.startsWith('laser-beam-layer-'));
    const widths = meshes.map((m) => (m as THREE.Mesh).scale.x);
    expect(widths[0]).toBeCloseTo(0.1, 3);
    expect(widths[1]).toBeCloseTo(0.25, 3);
    expect(widths[2]).toBeCloseTo(0.4, 3);
  });

  it('numBeams layers interpolate opacity from 1.0 (inner) to 0.5 (outer)', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, { numBeams: 3 });

    const meshes = scene.children.filter((c) => c.name.startsWith('laser-beam-layer-'));
    const opacities = meshes.map(
      (m) => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity,
    );
    // Layer 0 (inner): 1.0, Layer 1 (mid): 0.75, Layer 2 (outer): 0.5
    expect(opacities[0]).toBeCloseTo(1.0, 3);
    expect(opacities[1]).toBeCloseTo(0.75, 3);
    expect(opacities[2]).toBeCloseTo(0.5, 3);
  });

  it('numBeams layers interpolate W3DLaserDraw alpha opacity', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, {
      numBeams: 3,
      innerOpacity: 250 / 255,
      outerOpacity: 150 / 255,
    });

    const meshes = scene.children.filter((c) => c.name.startsWith('laser-beam-layer-'));
    const opacities = meshes.map(
      (m) => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity,
    );
    expect(opacities[0]).toBeCloseTo(250 / 255, 3);
    expect(opacities[1]).toBeCloseTo(200 / 255, 3);
    expect(opacities[2]).toBeCloseTo(150 / 255, 3);
  });

  // --- Bug 2: Segmented arcing ---

  it('segments=4 creates 4 cylinder segments per layer', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, { segments: 4 });
    expect(renderer.getActiveBeamCount()).toBe(1);
    // Default numBeams=2, 4 segments each = 8 meshes total
    expect(scene.children.length).toBe(8);
  });

  it('arcHeight > 0 produces non-straight beam path with Y offset', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, {
      numBeams: 1,
      segments: 4,
      arcHeight: 5,
    });

    // With 1 layer and 4 segments, we have 4 meshes (named laser-beam-layer-0).
    const meshes = scene.children.filter(
      (c) => c.name === 'laser-beam-layer-0',
    ) as THREE.Mesh[];
    expect(meshes.length).toBe(4);

    // Segments at the middle of the beam should have Y offset.
    // The segment midpoints are at t = 0.125, 0.375, 0.625, 0.875.
    // The mesh position.y for middle segments should be elevated.
    // Segment 1 (t=0.25 to t=0.5) midpoint is at t=0.375:
    //   arc offset at t=0.375 = 5 * sin(π * 0.375) ≈ 5 * 0.924 = 4.62
    // Start and endpoints have Y=0, so any non-zero Y in midpoint confirms arcing.
    const yPositions = meshes.map((m) => m.position.y);
    // At least one mesh should have a significant Y offset (the middle segments)
    const maxY = Math.max(...yPositions);
    expect(maxY).toBeGreaterThan(1);
  });

  it('segments and numBeams combine correctly', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, {
      numBeams: 3,
      segments: 4,
      arcHeight: 2,
    });

    // 3 layers × 4 segments = 12 meshes
    expect(scene.children.length).toBe(12);
    expect(renderer.getActiveBeamCount()).toBe(1);
  });

  it('applies source SegmentOverlapRatio to arced segment endpoints', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, {
      numBeams: 1,
      segments: 2,
      arcHeight: 4,
      segmentOverlapRatio: 0.1,
    });

    const meshes = scene.children.filter(
      (c) => c.name === 'laser-beam-layer-0',
    ) as THREE.Mesh[];
    expect(meshes.length).toBe(2);
    expect(meshes[0]!.position.x).toBeCloseTo(3, 3);
    expect(meshes[1]!.position.x).toBeCloseTo(7, 3);
  });

  it('segmented beam with arcHeight=0 has no Y offset', () => {
    renderer.addBeam(0, 0, 0, 10, 0, 0, {
      numBeams: 1,
      segments: 4,
      arcHeight: 0,
    });

    const meshes = scene.children as THREE.Mesh[];
    // All segment midpoints should have Y = 0 (straight beam along X axis)
    for (const mesh of meshes) {
      expect(mesh.position.y).toBeCloseTo(0, 3);
    }
  });
});
