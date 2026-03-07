/**
 * TerrainScorch — persistent scorch marks at explosion sites.
 *
 * Source parity: W3DTerrainLogic.cpp scorch mark system.
 * Creates dark circular decals at explosion locations that fade over time.
 */

import type { DecalRenderer, DecalHandle } from './decal-renderer.js';

// ---------------------------------------------------------------------------
// Scorch mark config
// ---------------------------------------------------------------------------

export interface TerrainScorchConfig {
  scorchType: string;
  radius: number;
  position: [number, number, number];
  lifetime: number;
}

const DEFAULT_SCORCH_LIFETIME = 30; // seconds
const SCORCH_COLORS: Record<string, number> = {
  RANDOM: 0x111111,
  SCORCH_1: 0x1a1a1a,
  SCORCH_2: 0x0d0d0d,
  SCORCH_3: 0x151515,
  SCORCH_4: 0x101010,
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TerrainScorchManager {
  private readonly decalRenderer: DecalRenderer;
  private readonly handles: DecalHandle[] = [];
  private maxScorchMarks = 128;

  constructor(decalRenderer: DecalRenderer, maxScorchMarks = 128) {
    this.decalRenderer = decalRenderer;
    this.maxScorchMarks = maxScorchMarks;
  }

  addScorch(config: TerrainScorchConfig): void {
    // Enforce cap
    while (this.handles.length >= this.maxScorchMarks) {
      const oldest = this.handles.shift();
      if (oldest) {
        this.decalRenderer.removeDecal(oldest);
      }
    }

    const color = SCORCH_COLORS[config.scorchType] ?? SCORCH_COLORS['RANDOM']!;
    const handle = this.decalRenderer.addDecal({
      position: config.position,
      sizeX: config.radius * 2,
      sizeY: config.radius * 2,
      rotation: Math.random() * Math.PI * 2,
      blendMode: 'MULTIPLY',
      opacity: 0.7,
      color,
      lifetime: config.lifetime || DEFAULT_SCORCH_LIFETIME,
      terrainConform: true,
    });

    this.handles.push(handle);
  }

  getActiveCount(): number {
    return this.handles.length;
  }

  setMaxScorchMarks(max: number): void {
    this.maxScorchMarks = max;
  }

  dispose(): void {
    for (const handle of this.handles) {
      this.decalRenderer.removeDecal(handle);
    }
    this.handles.length = 0;
  }
}
