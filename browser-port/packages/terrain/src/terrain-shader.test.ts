import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createTerrainMaterial } from './terrain-shader.js';

describe('createTerrainMaterial', () => {
  it('returns a ShaderMaterial with vertexColors enabled', () => {
    const mat = createTerrainMaterial();
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.vertexColors).toBe(true);
  });

  it('has all required uniforms', () => {
    const mat = createTerrainMaterial();
    expect(mat.uniforms.uSunDir).toBeDefined();
    expect(mat.uniforms.uSunColor).toBeDefined();
    expect(mat.uniforms.uAmbientColor).toBeDefined();
    expect(mat.uniforms.uFogDensity).toBeDefined();
    expect(mat.uniforms.uFogColor).toBeDefined();
  });

  it('uses default fog density of 0.0008', () => {
    const mat = createTerrainMaterial();
    expect(mat.uniforms.uFogDensity.value).toBeCloseTo(0.0008, 6);
  });

  it('respects wireframe option', () => {
    const mat = createTerrainMaterial({ wireframe: true });
    expect(mat.wireframe).toBe(true);

    const mat2 = createTerrainMaterial({ wireframe: false });
    expect(mat2.wireframe).toBe(false);
  });

  it('uses FrontSide rendering', () => {
    const mat = createTerrainMaterial();
    expect(mat.side).toBe(THREE.FrontSide);
  });

  it('applies custom sun direction normalized', () => {
    const dir = new THREE.Vector3(1, 0, 0);
    const mat = createTerrainMaterial({ sunDir: dir });
    const uDir = mat.uniforms.uSunDir.value as THREE.Vector3;
    expect(uDir.length()).toBeCloseTo(1.0, 5);
    expect(uDir.x).toBeCloseTo(1.0, 5);
  });

  it('applies custom fog color', () => {
    const mat = createTerrainMaterial({ fogColorHex: 0xff0000 });
    const fogColor = mat.uniforms.uFogColor.value as THREE.Color;
    expect(fogColor.r).toBeCloseTo(1.0, 5);
    expect(fogColor.g).toBeCloseTo(0.0, 5);
    expect(fogColor.b).toBeCloseTo(0.0, 5);
  });

  it('computes sun color as color * intensity', () => {
    // Pure white sun at intensity 1.0 should give (1,1,1)
    const mat = createTerrainMaterial({ sunColorHex: 0xffffff, sunIntensity: 1.0 });
    const sunColor = mat.uniforms.uSunColor.value as THREE.Vector3;
    expect(sunColor.x).toBeCloseTo(1.0, 5);
    expect(sunColor.y).toBeCloseTo(1.0, 5);
    expect(sunColor.z).toBeCloseTo(1.0, 5);
  });

  it('computes ambient color as color * intensity', () => {
    const mat = createTerrainMaterial({ ambientColorHex: 0xffffff, ambientIntensity: 0.5 });
    const ambient = mat.uniforms.uAmbientColor.value as THREE.Vector3;
    expect(ambient.x).toBeCloseTo(0.5, 5);
    expect(ambient.y).toBeCloseTo(0.5, 5);
    expect(ambient.z).toBeCloseTo(0.5, 5);
  });

  it('has vertex and fragment shader strings', () => {
    const mat = createTerrainMaterial();
    expect(mat.vertexShader).toContain('vWorldPos');
    expect(mat.fragmentShader).toContain('uSunDir');
    expect(mat.fragmentShader).toContain('uFogDensity');
    expect(mat.fragmentShader).toContain('fbm');
  });

  it('does not mutate the passed-in sunDir vector', () => {
    const dir = new THREE.Vector3(3, 6, 3);
    const originalLength = dir.length();
    createTerrainMaterial({ sunDir: dir });
    // The original vector should not have been normalized in-place
    expect(dir.length()).toBeCloseTo(originalLength, 5);
  });
});
