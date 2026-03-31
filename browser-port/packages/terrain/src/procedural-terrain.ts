/**
 * Procedural terrain generator for demo/testing.
 *
 * Generates a MapDataJSON with layered sine-noise heightmap,
 * suitable for testing the renderer without real game assets.
 */

import { MAP_XY_FACTOR } from './types.js';
import type { MapDataJSON, PolygonTriggerJSON } from './types.js';

export interface ProceduralTerrainOptions {
  /** Grid width in cells (default 128). */
  width?: number;
  /** Grid height in cells (default 128). */
  height?: number;
  /** Random seed for reproducibility (default 42). */
  seed?: number;
  /** Include a water area trigger (default true). */
  includeWater?: boolean;
}

/**
 * Generate a procedural MapDataJSON for demo/testing purposes.
 * Uses layered sine waves with a seedable offset for deterministic output.
 */
export function generateProceduralTerrain(
  options: ProceduralTerrainOptions = {},
): MapDataJSON {
  const {
    width = 128,
    height = 128,
    seed = 42,
    includeWater = true,
  } = options;

  // Seed-based pseudo-random offset
  const offsetX = ((seed * 214013 + 2531011) >>> 0) / 0xffffffff * 100;
  const offsetZ = ((seed * 17 + 12345) >>> 0) / 0xffffffff * 100;

  const data = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = col + offsetX;
      const z = row + offsetZ;

      // Layer 1: large rolling hills
      let h = Math.sin(x * 0.04) * 40 + Math.cos(z * 0.05) * 35;

      // Layer 2: medium features
      h += Math.sin(x * 0.12 + z * 0.08) * 15;

      // Layer 3: small detail
      h += Math.sin(x * 0.25 + 1.7) * 5 + Math.cos(z * 0.3 + 2.3) * 5;

      // Layer 4: ridge
      h += Math.abs(Math.sin((x + z) * 0.06)) * 20;

      // Normalize to 0–255 range
      // Theoretical range roughly: -100 to +120, center around 128
      const normalized = Math.floor(Math.max(0, Math.min(255, h + 128)));
      data[row * width + col] = normalized;
    }
  }

  // Encode to base64
  const base64 = uint8ArrayToBase64(data);

  // Build triggers
  const triggers: PolygonTriggerJSON[] = [];
  if (includeWater) {
    // Place a water area in the lower-left quadrant
    const waterSize = Math.floor(Math.min(width, height) * 0.2);
    const waterStartCol = Math.floor(width * 0.1);
    const waterStartRow = Math.floor(height * 0.6);
    const wx0 = waterStartCol * MAP_XY_FACTOR;
    const wz0 = waterStartRow * MAP_XY_FACTOR;
    const wx1 = (waterStartCol + waterSize) * MAP_XY_FACTOR;
    const wz1 = (waterStartRow + waterSize) * MAP_XY_FACTOR;
    // Water height — average height of the area, slightly below
    const waterHeight = 70 * 0.625; // ~43.75 world units

    // Store in original engine coordinate convention:
    //   x = horizontal X, y = horizontal Y (Three.js Z), z = height (Three.js Y)
    triggers.push({
      name: 'WaterArea_Demo',
      id: 1,
      isWaterArea: true,
      isRiver: false,
      points: [
        { x: wx0, y: wz0, z: waterHeight },
        { x: wx1, y: wz0, z: waterHeight },
        { x: wx1, y: wz1, z: waterHeight },
        { x: wx0, y: wz1, z: waterHeight },
      ],
    });
  }

  return {
    heightmap: {
      width,
      height,
      borderSize: 0,
      data: base64,
    },
    objects: [],
    triggers,
    textureClasses: ['GrassLight', 'Dirt', 'Rock'],
    blendTileCount: 0,
  };
}

// ============================================================================
// Base64 encoding (browser-compatible)
// ============================================================================

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ArrayToBase64(data: Uint8Array): string {
  let result = '';
  const len = data.length;

  for (let i = 0; i < len; i += 3) {
    const a = data[i]!;
    const b = i + 1 < len ? data[i + 1]! : 0;
    const c = i + 2 < len ? data[i + 2]! : 0;
    const remaining = len - i;

    result += B64_CHARS[(a >> 2) & 0x3f];
    result += B64_CHARS[((a << 4) | (b >> 4)) & 0x3f];
    result += remaining > 1 ? B64_CHARS[((b << 2) | (c >> 6)) & 0x3f] : '=';
    result += remaining > 2 ? B64_CHARS[c & 0x3f] : '=';
  }

  return result;
}

export { uint8ArrayToBase64 };
