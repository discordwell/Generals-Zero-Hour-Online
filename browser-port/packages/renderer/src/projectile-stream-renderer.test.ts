import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  computeProjectileStreamSegments,
  disposeProjectileStreamGroup,
  syncProjectileStreamGroup,
} from './projectile-stream-renderer.js';

describe('projectile stream renderer', () => {
  it('splits stream runs at source zero-vector holes', () => {
    const segments = computeProjectileStreamSegments([
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ], 0);

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => [segment.start.x, segment.end.x])).toEqual([
      [1, 2],
      [3, 4],
      [4, 5],
    ]);
  });

  it('applies W3DProjectileStreamDraw MaxSegments to the newest points', () => {
    const segments = computeProjectileStreamSegments([
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ], 3);

    expect(segments.map((segment) => [segment.start.x, segment.end.x])).toEqual([
      [3, 4],
      [4, 5],
    ]);
  });

  it('syncs additive segment meshes with source draw metadata', () => {
    const group = new THREE.Group();
    syncProjectileStreamGroup(
      group,
      [
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 4 },
        { x: 1, y: 3, z: 4 },
      ],
      {
        textureName: 'EXToxinStream.tga',
        width: 1.5,
        tileFactor: 2,
        scrollRate: 6,
        maxSegments: 0,
      },
      0.25,
    );

    expect(group.children).toHaveLength(2);
    const first = group.children[0] as THREE.Mesh;
    expect(first.name).toBe('projectile-stream-segment-0');
    expect(first.scale.x).toBeCloseTo(1.5);
    expect(first.scale.y).toBeCloseTo(4);
    expect(first.position.x).toBeCloseTo(1);
    expect(first.position.z).toBeCloseTo(2);
    const material = first.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.userData).toMatchObject({
      textureName: 'EXToxinStream.tga',
      tileFactor: 2,
      scrollRate: 6,
      uvOffset: 1.5,
    });
    expect(group.userData.segmentCount).toBe(2);

    syncProjectileStreamGroup(
      group,
      [
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 4 },
      ],
      {
        textureName: 'EXToxinStream.tga',
        width: 1.5,
        tileFactor: 2,
        scrollRate: 6,
        maxSegments: 0,
      },
      0.5,
    );
    expect(group.children).toHaveLength(1);
    expect(group.userData.segmentCount).toBe(1);

    disposeProjectileStreamGroup(group);
  });
});
