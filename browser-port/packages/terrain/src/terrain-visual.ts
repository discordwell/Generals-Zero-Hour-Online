/**
 * TerrainVisual — owns Three.js terrain meshes and manages map loading.
 *
 * Implements the Subsystem interface for integration with the engine.
 * Creates terrain chunks from a HeightmapGrid and adds them to the scene.
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import { HeightmapGrid } from './heightmap.js';
import { TerrainMeshBuilder } from './terrain-mesh-builder.js';
import type { TerrainChunk, BlendTileColorData } from './terrain-mesh-builder.js';
import type { MapDataJSON, TerrainConfig, BlendTileTextureClass } from './types.js';
import { DEFAULT_TERRAIN_CONFIG } from './types.js';
import { generateProceduralTerrain } from './procedural-terrain.js';
import { base64ToUint8Array } from './heightmap.js';
import { createTerrainMaterial } from './terrain-shader.js';
import type { TerrainShaderOptions } from './terrain-shader.js';

export class TerrainVisual implements Subsystem {
  readonly name = 'TerrainVisual';

  private readonly scene: THREE.Scene;
  private readonly config: TerrainConfig;

  /** The active heightmap grid (null until a map is loaded). */
  private heightmap: HeightmapGrid | null = null;

  /** Active terrain chunk meshes. */
  private meshes: THREE.Mesh[] = [];

  /** Shared material for all terrain chunks. */
  private material: THREE.ShaderMaterial;

  /** Terrain chunks data (for reference). */
  private chunks: TerrainChunk[] = [];
  /** Source parity bridge: ScriptActions::doOversizeTheTerrain amount. */
  private scriptTerrainOversizeAmount = 0;

  constructor(scene: THREE.Scene, config?: Partial<TerrainConfig>, shaderOptions?: TerrainShaderOptions) {
    this.scene = scene;
    this.config = { ...DEFAULT_TERRAIN_CONFIG, ...config };

    this.material = createTerrainMaterial({
      wireframe: this.config.wireframe,
      ...shaderOptions,
    });
  }

  init(): void {
    // Nothing async needed
  }

  /**
   * Load terrain from a converted map JSON.
   */
  loadMap(mapData: MapDataJSON): HeightmapGrid {
    this.clearTerrain();

    const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
    this.heightmap = heightmap;

    // Extract blend tile data for texture-class-based vertex coloring
    const blendTileData = TerrainVisual.extractBlendTileData(mapData, heightmap.width);
    this.buildMeshes(heightmap, blendTileData);

    return heightmap;
  }

  /**
   * Load a procedural demo terrain.
   */
  loadDemoTerrain(width = 128, height = 128, seed = 42): { heightmap: HeightmapGrid; mapData: MapDataJSON } {
    const mapData = generateProceduralTerrain({ width, height, seed });
    const heightmap = this.loadMap(mapData);
    return { heightmap, mapData };
  }

  /**
   * Get the active heightmap (for camera terrain following, etc.).
   */
  getHeightmap(): HeightmapGrid | null {
    return this.heightmap;
  }

  /**
   * Toggle wireframe rendering (F1).
   */
  toggleWireframe(): void {
    this.config.wireframe = !this.config.wireframe;
    this.material.wireframe = this.config.wireframe;
    this.material.needsUpdate = true;
  }

  /**
   * Check if wireframe mode is active.
   */
  isWireframe(): boolean {
    return this.config.wireframe;
  }

  update(_dt: number): void {
    // Terrain is static — no per-frame updates needed
  }

  /**
   * Source parity bridge: HeightMapRenderObjClass::oversizeTerrain.
   * Source supports values 1..4; other values restore normal culling behavior.
   */
  setScriptTerrainOversizeAmount(amount: number): void {
    const normalizedAmount = Number.isFinite(amount) ? Math.trunc(amount) : 0;
    if (normalizedAmount === this.scriptTerrainOversizeAmount) {
      return;
    }
    this.scriptTerrainOversizeAmount = normalizedAmount;
    this.applyTerrainOversizeFrustumPolicy();
  }

  reset(): void {
    this.clearTerrain();
  }

  dispose(): void {
    this.clearTerrain();
    this.material.dispose();
  }

  // ========================================================================
  // Internal
  // ========================================================================

  private buildMeshes(heightmap: HeightmapGrid, blendTileData?: BlendTileColorData): void {
    this.chunks = TerrainMeshBuilder.build(heightmap, blendTileData);

    for (const chunk of this.chunks) {
      const mesh = new THREE.Mesh(chunk.geometry, this.material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.applyTerrainOversizeFrustumPolicy();
  }

  private clearTerrain(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.length = 0;
    this.chunks.length = 0;
    this.heightmap = null;
  }

  /**
   * Extract blend tile color data from a map JSON if available.
   * Returns undefined if the map has no blend tile texture data.
   */
  private static extractBlendTileData(
    mapData: MapDataJSON,
    mapWidth: number,
  ): BlendTileColorData | undefined {
    if (!mapData.tileIndices || !mapData.textureClasses || mapData.textureClasses.length === 0) {
      return undefined;
    }

    // Normalize textureClasses: support both string[] (legacy) and BlendTileTextureClass[]
    const textureClasses: BlendTileTextureClass[] = [];
    let hasStructuredClasses = false;
    for (const tc of mapData.textureClasses) {
      if (typeof tc === 'string') {
        // Legacy string-only format — cannot resolve tile indices without firstTile/numTiles
        continue;
      }
      textureClasses.push(tc);
      hasStructuredClasses = true;
    }

    if (!hasStructuredClasses || textureClasses.length === 0) {
      return undefined;
    }

    // Decode base64-encoded Int16Array
    const bytes = base64ToUint8Array(mapData.tileIndices);
    const tileIndices = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2,
    );

    return {
      tileIndices,
      textureClasses,
      mapWidth,
    };
  }

  private applyTerrainOversizeFrustumPolicy(): void {
    const oversizeActive = this.scriptTerrainOversizeAmount > 0 && this.scriptTerrainOversizeAmount < 5;
    for (const mesh of this.meshes) {
      mesh.frustumCulled = !oversizeActive;
    }
  }
}
