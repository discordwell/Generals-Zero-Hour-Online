import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createShadowDecalMesh,
  updateShadowDecalPosition,
  parseObjectShadowType,
  shouldCastShadowMap,
  shouldCreateShadowDecal,
} from './shadow-decal.js';

describe('shadow-decal', () => {
  describe('parseObjectShadowType', () => {
    it('parses known shadow types', () => {
      expect(parseObjectShadowType('SHADOW_DECAL')).toBe('SHADOW_DECAL');
      expect(parseObjectShadowType('SHADOW_VOLUME')).toBe('SHADOW_VOLUME');
      expect(parseObjectShadowType('SHADOW_NONE')).toBe('SHADOW_NONE');
      expect(parseObjectShadowType('SHADOW_PROJECTION')).toBe('SHADOW_PROJECTION');
      expect(parseObjectShadowType('SHADOW_ALPHA_DECAL')).toBe('SHADOW_ALPHA_DECAL');
      expect(parseObjectShadowType('SHADOW_ADDITIVE_DECAL')).toBe('SHADOW_ADDITIVE_DECAL');
    });

    it('defaults to SHADOW_VOLUME for unknown values', () => {
      expect(parseObjectShadowType('garbage')).toBe('SHADOW_VOLUME');
      expect(parseObjectShadowType(undefined)).toBe('SHADOW_VOLUME');
      expect(parseObjectShadowType(42)).toBe('SHADOW_VOLUME');
    });

    it('is case-insensitive', () => {
      expect(parseObjectShadowType('shadow_decal')).toBe('SHADOW_DECAL');
      expect(parseObjectShadowType('Shadow_Volume')).toBe('SHADOW_VOLUME');
    });
  });

  describe('shouldCastShadowMap', () => {
    it('returns true for SHADOW_VOLUME and SHADOW_PROJECTION', () => {
      expect(shouldCastShadowMap('SHADOW_VOLUME')).toBe(true);
      expect(shouldCastShadowMap('SHADOW_PROJECTION')).toBe(true);
    });

    it('returns false for other types', () => {
      expect(shouldCastShadowMap('SHADOW_DECAL')).toBe(false);
      expect(shouldCastShadowMap('SHADOW_NONE')).toBe(false);
      expect(shouldCastShadowMap('SHADOW_ALPHA_DECAL')).toBe(false);
    });
  });

  describe('shouldCreateShadowDecal', () => {
    it('returns true for decal shadow types', () => {
      expect(shouldCreateShadowDecal('SHADOW_DECAL')).toBe(true);
      expect(shouldCreateShadowDecal('SHADOW_ALPHA_DECAL')).toBe(true);
      expect(shouldCreateShadowDecal('SHADOW_ADDITIVE_DECAL')).toBe(true);
    });

    it('returns false for non-decal types', () => {
      expect(shouldCreateShadowDecal('SHADOW_VOLUME')).toBe(false);
      expect(shouldCreateShadowDecal('SHADOW_NONE')).toBe(false);
    });
  });

  describe('createShadowDecalMesh', () => {
    it('creates a flat mesh with correct properties', () => {
      const mesh = createShadowDecalMesh();
      expect(mesh.name).toBe('shadow-decal');
      expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.renderOrder).toBe(1);
    });

    it('applies custom size', () => {
      const mesh = createShadowDecalMesh({ sizeX: 5, sizeY: 8 });
      expect(mesh.scale.x).toBe(5);
      expect(mesh.scale.y).toBe(8);
    });

    it('uses default size when not specified', () => {
      const mesh = createShadowDecalMesh();
      expect(mesh.scale.x).toBe(3);
      expect(mesh.scale.y).toBe(3);
    });
  });

  describe('updateShadowDecalPosition', () => {
    it('positions the decal at terrain height relative to parent', () => {
      const mesh = createShadowDecalMesh();
      const parent = new THREE.Group();
      parent.position.set(10, 5, 20);
      parent.add(mesh);

      const getTerrainHeight = (_x: number, _z: number) => 2;
      updateShadowDecalPosition(mesh, 10, 20, getTerrainHeight);

      // Terrain at 2, parent at 5, so offset = 2 + 0.05 - 5 = -2.95
      expect(mesh.position.y).toBeCloseTo(-2.95);
    });

    it('works when entity is on the ground', () => {
      const mesh = createShadowDecalMesh();
      const parent = new THREE.Group();
      parent.position.set(0, 0, 0);
      parent.add(mesh);

      const getTerrainHeight = () => 0;
      updateShadowDecalPosition(mesh, 0, 0, getTerrainHeight);

      expect(mesh.position.y).toBeCloseTo(0.05);
    });
  });
});
