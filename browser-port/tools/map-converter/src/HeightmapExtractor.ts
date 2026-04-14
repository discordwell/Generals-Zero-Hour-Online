/**
 * Extracts heightmap data from a HeightMapData chunk.
 *
 * HeightMapData chunk versions 1-4:
 *   int32   width
 *   int32   height
 *   int32   borderSize      (v3+)
 *   // v4+ has additional boundary size pairs
 *   int32   numBoundaries   (v4+)
 *   repeat numBoundaries:
 *     int32 boundaryWidth
 *     int32 boundaryHeight
 *   int32   dataSize        (should equal width * height)
 *   uint8[] heightData      (width * height values, 0-255)
 *
 * Constants:
 *   MAP_XY_FACTOR    = 10.0    (world units per grid cell)
 *   MAP_HEIGHT_SCALE = 0.625   (MAP_XY_FACTOR / 16.0)
 */

import type { DataChunkReader } from './DataChunkReader.js';

/** World units per heightmap grid cell. */
export const MAP_XY_FACTOR = 10.0;

/** Multiplier to convert raw 0-255 height values to world-space height. */
export const MAP_HEIGHT_SCALE = MAP_XY_FACTOR / 16.0; // 0.625

/** Raw heightmap data extracted from a .map file. */
export interface HeightmapData {
  /** Number of columns in the height grid. */
  width: number;
  /** Number of rows in the height grid. */
  height: number;
  /** Border/margin size in cells (v3+). */
  borderSize: number;
  /**
   * Source parity: WorldHeightMap::getAllBoundaries returns active map extents
   * in heightmap grid cells. W3DTerrainLogic::getExtent multiplies the active
   * pair by MAP_XY_FACTOR before PartitionManager sizes its cells.
   */
  boundaries: Array<{ x: number; y: number }>;
  /** Raw height values, one byte per cell, row-major order. */
  data: Uint8Array;
}

export class HeightmapExtractor {
  /**
   * Extract heightmap data from a HeightMapData chunk.
   * The reader must be positioned at the start of the chunk's data payload.
   */
  static extract(reader: DataChunkReader, version: number): HeightmapData {
    const width = reader.readInt32();
    const height = reader.readInt32();

    let borderSize = 0;
    if (version >= 3) {
      borderSize = reader.readInt32();
    }

    const boundaries: Array<{ x: number; y: number }> = [];
    if (version >= 4) {
      const numBoundaries = reader.readInt32();
      if (numBoundaries < 0) {
        throw new Error(`HeightMapData has invalid boundary count: ${numBoundaries}`);
      }
      // Source parity: WorldHeightMap::ParseHeightMapData reads boundary (x,y) pairs.
      for (let index = 0; index < numBoundaries; index++) {
        boundaries.push({
          x: reader.readInt32(),
          y: reader.readInt32(),
        });
      }
    }

    const dataSize = reader.readInt32();
    if (dataSize !== width * height) {
      throw new Error(
        `HeightMapData size mismatch: expected ${width * height}, got ${dataSize}`,
      );
    }

    const data = reader.readBytes(dataSize);

    return { width, height, borderSize, boundaries, data };
  }

  /**
   * Convert raw height values (0-255) to world-space heights.
   * Returns a Float32Array of the same length as hm.data.
   */
  static toWorldCoordinates(hm: HeightmapData): Float32Array {
    const result = new Float32Array(hm.data.length);
    for (let i = 0; i < hm.data.length; i++) {
      const rawValue = hm.data[i];
      if (rawValue !== undefined) {
        result[i] = rawValue * MAP_HEIGHT_SCALE;
      }
    }
    return result;
  }
}
