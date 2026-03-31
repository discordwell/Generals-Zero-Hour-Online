/**
 * Custom terrain shader with procedural detail.
 *
 * Replaces the flat MeshLambertMaterial with a ShaderMaterial that adds:
 * - Noise-based color variation to break up flat vertex-color regions
 * - Slope-based rock blending for steep surfaces
 * - Height-based ambient occlusion (darkening in valleys, lightening on ridges)
 * - Lambert diffuse lighting with sun direction + ambient
 * - FogExp2 support matching the scene fog
 *
 * The vertex colors and chunk geometry system remain unchanged.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GLSL source
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
// Three.js built-in uniforms/attributes are injected automatically:
//   uniform mat4 modelViewMatrix, projectionMatrix, modelMatrix;
//   uniform mat3 normalMatrix;
//   attribute vec3 position, normal, color;
//   attribute vec2 uv;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vFogDepth;

void main() {
  vColor = color;
  vNormal = normalize(normalMatrix * normal);

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mvPos.z;

  gl_Position = projectionMatrix * mvPos;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uFogDensity;
uniform vec3 uFogColor;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vFogDepth;

// -------------------------------------------------------
// Simple 2D hash-based noise (no textures required)
// -------------------------------------------------------
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise — bilinear interpolation of hash values
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Hermite smoothing
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Multi-octave (fBm) noise for richer detail
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  // 3 octaves — enough detail without being expensive
  for (int i = 0; i < 3; i++) {
    value += amplitude * valueNoise(p);
    p *= 2.17;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  // ----- Base color from vertex colors -----
  vec3 baseColor = vColor;

  // ----- Noise-based detail variation -----
  // Use world XZ position at different scales for natural-looking breakup.
  // Scale 0.08: broad patches (~12 world-unit features)
  // Scale 0.3:  medium detail (~3 world-unit features)
  float broadNoise = fbm(vWorldPos.xz * 0.08);
  float fineNoise  = fbm(vWorldPos.xz * 0.3 + 50.0);
  // Combine: broad gives +-10%, fine gives +-5%
  float noiseMod = 0.85 + broadNoise * 0.20 + fineNoise * 0.10;
  baseColor *= noiseMod;

  // ----- Slope-based rock blending -----
  // vNormal.y = 1.0 for flat ground, 0.0 for vertical cliff.
  // Blend toward a neutral rock color on steep slopes.
  float slope = 1.0 - vNormal.y;
  vec3 rockColor = vec3(0.45, 0.42, 0.38);
  baseColor = mix(baseColor, rockColor, smoothstep(0.25, 0.65, slope));

  // ----- Height-based subtle shading -----
  // Darken valleys slightly, brighten ridges. Using world Y directly
  // (typical height range 0-160 in Generals maps).
  float heightFactor = smoothstep(0.0, 160.0, vWorldPos.y);
  baseColor *= 0.92 + heightFactor * 0.16; // 0.92 in valleys, 1.08 on peaks

  // ----- Lambert diffuse lighting -----
  vec3 N = normalize(vNormal);
  float NdotL = max(dot(N, uSunDir), 0.0);
  vec3 lit = baseColor * (uAmbientColor + uSunColor * NdotL);

  // ----- FogExp2 -----
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  fogFactor = clamp(fogFactor, 0.0, 1.0);
  lit = mix(lit, uFogColor, fogFactor);

  gl_FragColor = vec4(lit, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Uniform defaults (matching main.ts scene setup)
// ---------------------------------------------------------------------------

/**
 * Convert a hex color and intensity to a linear-space vec3 for the shader.
 * Three.js lights store color and intensity separately; the shader needs
 * the product as a single vec3.
 */
function hexIntensityToVec3(hex: number, intensity: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r * intensity, c.g * intensity, c.b * intensity);
}

/** Sun direction vector — normalized (200, 400, 200) from main.ts. */
const SUN_DIR = new THREE.Vector3(200, 400, 200).normalize();

export interface TerrainShaderOptions {
  wireframe?: boolean;
  /** Sun direction (normalized). Default: (200,400,200).normalize(). */
  sunDir?: THREE.Vector3;
  /** Sun color hex. Default: 0xfff4e0. */
  sunColorHex?: number;
  /** Sun intensity. Default: 1.3. */
  sunIntensity?: number;
  /** Ambient light color hex. Default: 0x607080. */
  ambientColorHex?: number;
  /** Ambient intensity. Default: 0.7. */
  ambientIntensity?: number;
  /** Fog density (FogExp2). Default: 0.0008. */
  fogDensity?: number;
  /** Fog color hex. Default: 0x87a5b5. */
  fogColorHex?: number;
}

/**
 * Create a custom ShaderMaterial for terrain rendering.
 *
 * Uses the existing vertex color attribute as base color and adds procedural
 * detail (noise variation, slope rock blending, height shading) with Lambert
 * lighting and FogExp2 fog.
 */
export function createTerrainMaterial(options: TerrainShaderOptions = {}): THREE.ShaderMaterial {
  const {
    wireframe = false,
    sunDir = SUN_DIR,
    sunColorHex = 0xfff4e0,
    sunIntensity = 1.3,
    ambientColorHex = 0x607080,
    ambientIntensity = 0.7,
    fogDensity = 0.0008,
    fogColorHex = 0x87a5b5,
  } = options;

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: hexIntensityToVec3(sunColorHex, sunIntensity) },
      uAmbientColor: { value: hexIntensityToVec3(ambientColorHex, ambientIntensity) },
      uFogDensity: { value: fogDensity },
      uFogColor: { value: new THREE.Color(fogColorHex) },
    },
    vertexColors: true,
    wireframe,
    side: THREE.FrontSide,
  });
}
