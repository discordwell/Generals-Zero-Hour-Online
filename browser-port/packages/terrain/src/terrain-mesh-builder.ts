/**
 * TerrainMeshBuilder — converts a HeightmapGrid into chunked Three.js geometry.
 *
 * Splits the heightmap into CHUNK_SIZE × CHUNK_SIZE cell chunks. Each chunk
 * becomes a separate BufferGeometry with position, normal, uv, and color
 * attributes. Separate meshes enable frustum culling.
 */

import * as THREE from 'three';
import { HeightmapGrid } from './heightmap.js';
import { MAP_XY_FACTOR, CHUNK_SIZE } from './types.js';

/** A terrain chunk with its geometry and grid-space bounds. */
export interface TerrainChunk {
  /** BufferGeometry with position, normal, uv, and color attributes. */
  geometry: THREE.BufferGeometry;
  /** Chunk grid column start (in cells). */
  chunkCol: number;
  /** Chunk grid row start (in cells). */
  chunkRow: number;
  /** Number of cells wide this chunk covers. */
  cellsWide: number;
  /** Number of cells tall this chunk covers. */
  cellsTall: number;
}

/**
 * Height-based color gradient for vertex coloring.
 * Approximates the Generals desert terrain palette — sandy tans,
 * dry earth browns, and rocky greys for elevation.
 */
const COLOR_STOPS: Array<{ height: number; color: [number, number, number] }> = [
  { height: 0, color: [0.55, 0.45, 0.30] },     // dark sand (low/valleys)
  { height: 0.2, color: [0.68, 0.58, 0.38] },    // warm sand
  { height: 0.4, color: [0.72, 0.62, 0.42] },    // light sand
  { height: 0.6, color: [0.62, 0.52, 0.35] },    // dry earth
  { height: 0.8, color: [0.55, 0.50, 0.42] },    // rocky brown
  { height: 1.0, color: [0.68, 0.65, 0.58] },    // light rock (peaks)
];

/** Rocky/cliff colors for steep slopes. */
const SLOPE_ROCK_COLOR: [number, number, number] = [0.48, 0.44, 0.38];

function getHeightColor(normalizedHeight: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, normalizedHeight));

  // Find the two stops to interpolate between
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const prev = COLOR_STOPS[i - 1]!;
    const curr = COLOR_STOPS[i]!;
    if (t <= curr.height) {
      const f = (t - prev.height) / (curr.height - prev.height);
      return [
        prev.color[0] + (curr.color[0] - prev.color[0]) * f,
        prev.color[1] + (curr.color[1] - prev.color[1]) * f,
        prev.color[2] + (curr.color[2] - prev.color[2]) * f,
      ];
    }
  }

  const last = COLOR_STOPS[COLOR_STOPS.length - 1]!;
  return [...last.color];
}

/**
 * Blend height color with rocky color based on slope steepness.
 * Steep slopes (normal.y < 0.85) transition to rock color.
 */
function blendSlopeColor(
  heightColor: [number, number, number],
  normalY: number,
): [number, number, number] {
  // normalY = 1.0 for flat, 0.0 for vertical
  // Start blending at normalY = 0.7 (steep slope), full rock at normalY = 0.3
  const slopeFactor = Math.max(0, Math.min(1, (0.7 - normalY) / 0.4));
  if (slopeFactor <= 0) return heightColor;
  return [
    heightColor[0] + (SLOPE_ROCK_COLOR[0] - heightColor[0]) * slopeFactor,
    heightColor[1] + (SLOPE_ROCK_COLOR[1] - heightColor[1]) * slopeFactor,
    heightColor[2] + (SLOPE_ROCK_COLOR[2] - heightColor[2]) * slopeFactor,
  ];
}

export class TerrainMeshBuilder {
  /**
   * Build all terrain chunks from a HeightmapGrid.
   * Returns an array of TerrainChunk objects.
   */
  static build(heightmap: HeightmapGrid): TerrainChunk[] {
    const chunks: TerrainChunk[] = [];

    // The heightmap has (width) vertices per row and (height) vertices per col.
    // Number of cells = (width-1) × (height-1).
    const cellsX = heightmap.width - 1;
    const cellsZ = heightmap.height - 1;

    // Find height range for color normalization
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < heightmap.worldHeights.length; i++) {
      const h = heightmap.worldHeights[i]!;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    const heightRange = maxH - minH || 1;

    for (let startRow = 0; startRow < cellsZ; startRow += CHUNK_SIZE) {
      for (let startCol = 0; startCol < cellsX; startCol += CHUNK_SIZE) {
        const cellsWide = Math.min(CHUNK_SIZE, cellsX - startCol);
        const cellsTall = Math.min(CHUNK_SIZE, cellsZ - startRow);

        const geometry = TerrainMeshBuilder.buildChunkGeometry(
          heightmap,
          startCol,
          startRow,
          cellsWide,
          cellsTall,
          minH,
          heightRange,
        );

        chunks.push({
          geometry,
          chunkCol: startCol,
          chunkRow: startRow,
          cellsWide,
          cellsTall,
        });
      }
    }

    return chunks;
  }

  /**
   * Build geometry for a single chunk.
   */
  static buildChunkGeometry(
    heightmap: HeightmapGrid,
    startCol: number,
    startRow: number,
    cellsWide: number,
    cellsTall: number,
    minHeight: number,
    heightRange: number,
  ): THREE.BufferGeometry {
    const vertsWide = cellsWide + 1;
    const vertsTall = cellsTall + 1;
    const vertexCount = vertsWide * vertsTall;
    const indexCount = cellsWide * cellsTall * 6; // 2 triangles per cell, 3 indices each

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    // Fill vertex data
    for (let localRow = 0; localRow < vertsTall; localRow++) {
      for (let localCol = 0; localCol < vertsWide; localCol++) {
        const globalCol = startCol + localCol;
        const globalRow = startRow + localRow;
        const vi = localRow * vertsWide + localCol;

        // Position (Y-up convention)
        const worldX = globalCol * MAP_XY_FACTOR;
        const worldY = heightmap.getWorldHeight(globalCol, globalRow);
        const worldZ = globalRow * MAP_XY_FACTOR;

        positions[vi * 3] = worldX;
        positions[vi * 3 + 1] = worldY;
        positions[vi * 3 + 2] = worldZ;

        // Normal
        const [nx, ny, nz] = heightmap.getNormal(globalCol, globalRow);
        normals[vi * 3] = nx;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz;

        // UV — tile across entire map [0,1]
        uvs[vi * 2] = globalCol / (heightmap.width - 1);
        uvs[vi * 2 + 1] = globalRow / (heightmap.height - 1);

        // Vertex color — height-based gradient blended with slope rock color
        const normalizedHeight = (worldY - minHeight) / heightRange;
        const heightColor = getHeightColor(normalizedHeight);
        const [r, g, b] = blendSlopeColor(heightColor, ny);
        colors[vi * 3] = r;
        colors[vi * 3 + 1] = g;
        colors[vi * 3 + 2] = b;
      }
    }

    // Fill index buffer (two triangles per cell)
    let idx = 0;
    for (let localRow = 0; localRow < cellsTall; localRow++) {
      for (let localCol = 0; localCol < cellsWide; localCol++) {
        const topLeft = localRow * vertsWide + localCol;
        const topRight = topLeft + 1;
        const bottomLeft = (localRow + 1) * vertsWide + localCol;
        const bottomRight = bottomLeft + 1;

        // Triangle 1: top-left, bottom-left, top-right
        indices[idx++] = topLeft;
        indices[idx++] = bottomLeft;
        indices[idx++] = topRight;

        // Triangle 2: top-right, bottom-left, bottom-right
        indices[idx++] = topRight;
        indices[idx++] = bottomLeft;
        indices[idx++] = bottomRight;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }
}
