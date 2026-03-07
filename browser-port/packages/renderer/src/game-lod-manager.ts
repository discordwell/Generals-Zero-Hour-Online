/**
 * GameLODManager — static hardware presets + dynamic FPS-responsive quality scaling.
 *
 * Source parity: GameLOD.h / GameLOD.cpp
 *
 * StaticGameLOD: Read from INI bundle (Low/Medium/High) presets controlling caps.
 * DynamicGameLOD: Monitors rolling-average FPS and adjusts quality thresholds.
 */

import type { Subsystem } from '@generals/engine';
import type { IniDataRegistry, RawBlockDef } from '@generals/ini-data';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type StaticLODLevel = 'Low' | 'Medium' | 'High' | 'Custom';

export type DynamicLODLevel = 'Low' | 'Medium' | 'High' | 'VeryHigh';

/**
 * Source parity: ParticleSystemManager particle priorities.
 * Ordered from lowest to highest importance.
 */
export const PARTICLE_PRIORITY_ORDER = [
  'NONE',
  'WEAPON_EXPLOSION',
  'SCORCHMARK',
  'DUST_TRAIL',
  'BUILDUP',
  'DEBRIS_TRAIL',
  'UNIT_DAMAGE_FX',
  'DEATH_EXPLOSION',
  'SEMI_CONSTANT',
  'CONSTANT',
  'WEAPON_TRAIL',
  'AREA_EFFECT',
  'CRITICAL',
  'ALWAYS_RENDER',
] as const;

export type ParticlePriority = (typeof PARTICLE_PRIORITY_ORDER)[number];

// ---------------------------------------------------------------------------
// Static LOD preset
// ---------------------------------------------------------------------------

export interface StaticGameLODPreset {
  maxParticleCount: number;
  useShadowVolumes: boolean;
  useShadowDecals: boolean;
  useCloudMap: boolean;
  useLightMap: boolean;
  showSoftWaterEdge: boolean;
  maxTankTrackEdges: number;
  maxTankTrackOpaqueEdges: number;
  maxTankTrackFadeDelay: number;
  useBuildupScaffolds: boolean;
  useTreeSway: boolean;
  useEmissiveNightMaterials: boolean;
  textureReductionFactor: number;
}

const DEFAULT_PRESETS: Record<string, StaticGameLODPreset> = {
  Low: {
    maxParticleCount: 500,
    useShadowVolumes: false,
    useShadowDecals: false,
    useCloudMap: false,
    useLightMap: false,
    showSoftWaterEdge: false,
    maxTankTrackEdges: 30,
    maxTankTrackOpaqueEdges: 15,
    maxTankTrackFadeDelay: 5000,
    useBuildupScaffolds: false,
    useTreeSway: false,
    useEmissiveNightMaterials: false,
    textureReductionFactor: 1,
  },
  Medium: {
    maxParticleCount: 1500,
    useShadowVolumes: false,
    useShadowDecals: true,
    useCloudMap: true,
    useLightMap: true,
    showSoftWaterEdge: true,
    maxTankTrackEdges: 100,
    maxTankTrackOpaqueEdges: 25,
    maxTankTrackFadeDelay: 30000,
    useBuildupScaffolds: true,
    useTreeSway: true,
    useEmissiveNightMaterials: true,
    textureReductionFactor: 0,
  },
  High: {
    maxParticleCount: 3000,
    useShadowVolumes: true,
    useShadowDecals: true,
    useCloudMap: true,
    useLightMap: true,
    showSoftWaterEdge: true,
    maxTankTrackEdges: 100,
    maxTankTrackOpaqueEdges: 25,
    maxTankTrackFadeDelay: 60000,
    useBuildupScaffolds: true,
    useTreeSway: true,
    useEmissiveNightMaterials: true,
    textureReductionFactor: 0,
  },
};

// ---------------------------------------------------------------------------
// Dynamic LOD preset
// ---------------------------------------------------------------------------

export interface DynamicGameLODPreset {
  minimumFPS: number;
  particleSkipMask: number;
  debrisSkipMask: number;
  slowDeathScale: number;
  minParticlePriority: ParticlePriority;
  minParticleSkipPriority: ParticlePriority;
}

const DEFAULT_DYNAMIC_PRESETS: Record<string, DynamicGameLODPreset> = {
  VeryHigh: {
    minimumFPS: 25,
    particleSkipMask: 0,
    debrisSkipMask: 0,
    slowDeathScale: 1.0,
    minParticlePriority: 'WEAPON_EXPLOSION',
    minParticleSkipPriority: 'CRITICAL',
  },
  High: {
    minimumFPS: 20,
    particleSkipMask: 0,
    debrisSkipMask: 0,
    slowDeathScale: 1.0,
    minParticlePriority: 'UNIT_DAMAGE_FX',
    minParticleSkipPriority: 'CRITICAL',
  },
  Medium: {
    minimumFPS: 10,
    particleSkipMask: 1,
    debrisSkipMask: 0,
    slowDeathScale: 1.0,
    minParticlePriority: 'WEAPON_TRAIL',
    minParticleSkipPriority: 'CRITICAL',
  },
  Low: {
    minimumFPS: 0,
    particleSkipMask: 3,
    debrisSkipMask: 0,
    slowDeathScale: 1.0,
    minParticlePriority: 'AREA_EFFECT',
    minParticleSkipPriority: 'CRITICAL',
  },
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const FPS_SAMPLE_COUNT = 30;

export class GameLODManager implements Subsystem {
  readonly name = 'GameLODManager';

  private staticLevel: StaticLODLevel = 'High';
  private staticPresets = new Map<string, StaticGameLODPreset>();
  private dynamicPresets = new Map<string, DynamicGameLODPreset>();
  private activeDynamicLevel: DynamicLODLevel = 'VeryHigh';

  // FPS rolling average
  private fpsSamples: number[] = [];
  private fpsIndex = 0;
  private particleGenerationCounter = 0;

  private registry: IniDataRegistry | null = null;

  constructor(registry?: IniDataRegistry) {
    this.registry = registry ?? null;
    // Load hardcoded defaults
    for (const [name, preset] of Object.entries(DEFAULT_PRESETS)) {
      this.staticPresets.set(name, { ...preset });
    }
    for (const [name, preset] of Object.entries(DEFAULT_DYNAMIC_PRESETS)) {
      this.dynamicPresets.set(name, { ...preset });
    }
  }

  init(): void {
    if (this.registry) {
      this.loadFromRegistry(this.registry);
    }
  }

  postProcessLoad(): void {
    // no-op
  }

  update(dt: number): void {
    if (dt > 0) {
      const fps = 1 / dt;
      if (this.fpsSamples.length < FPS_SAMPLE_COUNT) {
        this.fpsSamples.push(fps);
      } else {
        this.fpsSamples[this.fpsIndex % FPS_SAMPLE_COUNT] = fps;
      }
      this.fpsIndex++;
      this.updateDynamicLevel();
    }
    this.particleGenerationCounter++;
  }

  reset(): void {
    this.fpsSamples = [];
    this.fpsIndex = 0;
    this.particleGenerationCounter = 0;
    this.activeDynamicLevel = 'VeryHigh';
  }

  dispose(): void {
    this.staticPresets.clear();
    this.dynamicPresets.clear();
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  loadFromRegistry(registry: IniDataRegistry): void {
    for (const [, block] of registry.staticGameLODs) {
      const preset = this.parseStaticPreset(block);
      this.staticPresets.set(block.name, preset);
    }
    for (const [, block] of registry.dynamicGameLODs) {
      const preset = this.parseDynamicPreset(block);
      this.dynamicPresets.set(block.name, preset);
    }
  }

  setStaticLevel(level: StaticLODLevel): void {
    this.staticLevel = level;
  }

  getStaticLevel(): StaticLODLevel {
    return this.staticLevel;
  }

  getDynamicLevel(): DynamicLODLevel {
    return this.activeDynamicLevel;
  }

  // -------------------------------------------------------------------------
  // Query methods — used by particle system, shadows, decals
  // -------------------------------------------------------------------------

  getParticleCap(): number {
    return this.getActiveStaticPreset().maxParticleCount;
  }

  shouldUseShadowVolumes(): boolean {
    return this.getActiveStaticPreset().useShadowVolumes;
  }

  shouldUseShadowDecals(): boolean {
    return this.getActiveStaticPreset().useShadowDecals;
  }

  getTextureReductionFactor(): number {
    return this.getActiveStaticPreset().textureReductionFactor;
  }

  getMaxTankTrackEdges(): number {
    return this.getActiveStaticPreset().maxTankTrackEdges;
  }

  /**
   * Source parity: should this particle be skipped based on the dynamic LOD
   * skip mask and the generation counter?
   */
  shouldSkipParticle(priority: ParticlePriority): boolean {
    const dynamic = this.getActiveDynamicPreset();

    // Never skip high-priority particles
    const skipPriorityIndex = priorityIndex(dynamic.minParticleSkipPriority);
    if (priorityIndex(priority) >= skipPriorityIndex) {
      return false;
    }

    // Skip particles below the minimum priority threshold
    const minIndex = priorityIndex(dynamic.minParticlePriority);
    if (priorityIndex(priority) < minIndex) {
      return true;
    }

    // Apply skip mask: only generate when (counter & mask) === 0
    if (dynamic.particleSkipMask > 0) {
      return (this.particleGenerationCounter & dynamic.particleSkipMask) !== 0;
    }

    return false;
  }

  shouldSkipDebris(): boolean {
    const dynamic = this.getActiveDynamicPreset();
    if (dynamic.debrisSkipMask > 0) {
      return (this.particleGenerationCounter & dynamic.debrisSkipMask) !== 0;
    }
    return false;
  }

  getSlowDeathScale(): number {
    return this.getActiveDynamicPreset().slowDeathScale;
  }

  getAverageFPS(): number {
    if (this.fpsSamples.length === 0) return 60;
    let sum = 0;
    for (const sample of this.fpsSamples) {
      sum += sample;
    }
    return sum / this.fpsSamples.length;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getActiveStaticPreset(): StaticGameLODPreset {
    return this.staticPresets.get(this.staticLevel) ?? DEFAULT_PRESETS['High']!;
  }

  private getActiveDynamicPreset(): DynamicGameLODPreset {
    return this.dynamicPresets.get(this.activeDynamicLevel) ?? DEFAULT_DYNAMIC_PRESETS['VeryHigh']!;
  }

  private updateDynamicLevel(): void {
    const avgFps = this.getAverageFPS();

    // Source parity: check levels from highest to lowest, pick highest that meets FPS threshold
    const levels: DynamicLODLevel[] = ['VeryHigh', 'High', 'Medium', 'Low'];
    for (const level of levels) {
      const preset = this.dynamicPresets.get(level);
      if (preset && avgFps >= preset.minimumFPS) {
        this.activeDynamicLevel = level;
        return;
      }
    }
    this.activeDynamicLevel = 'Low';
  }

  private parseStaticPreset(block: RawBlockDef): StaticGameLODPreset {
    const defaults = DEFAULT_PRESETS[block.name] ?? DEFAULT_PRESETS['High']!;
    return {
      maxParticleCount: readInt(block.fields['MaxParticleCount']) ?? defaults.maxParticleCount,
      useShadowVolumes: readBool(block.fields['UseShadowVolumes']) ?? defaults.useShadowVolumes,
      useShadowDecals: readBool(block.fields['UseShadowDecals']) ?? defaults.useShadowDecals,
      useCloudMap: readBool(block.fields['UseCloudMap']) ?? defaults.useCloudMap,
      useLightMap: readBool(block.fields['UseLightMap']) ?? defaults.useLightMap,
      showSoftWaterEdge: readBool(block.fields['ShowSoftWaterEdge']) ?? defaults.showSoftWaterEdge,
      maxTankTrackEdges: readInt(block.fields['MaxTankTrackEdges']) ?? defaults.maxTankTrackEdges,
      maxTankTrackOpaqueEdges: readInt(block.fields['MaxTankTrackOpaqueEdges']) ?? defaults.maxTankTrackOpaqueEdges,
      maxTankTrackFadeDelay: readInt(block.fields['MaxTankTrackFadeDelay']) ?? defaults.maxTankTrackFadeDelay,
      useBuildupScaffolds: readBool(block.fields['UseBuildupScaffolds']) ?? defaults.useBuildupScaffolds,
      useTreeSway: readBool(block.fields['UseTreeSway']) ?? defaults.useTreeSway,
      useEmissiveNightMaterials: readBool(block.fields['UseEmissiveNightMaterials']) ?? defaults.useEmissiveNightMaterials,
      textureReductionFactor: readInt(block.fields['TextureReductionFactor']) ?? defaults.textureReductionFactor,
    };
  }

  private parseDynamicPreset(block: RawBlockDef): DynamicGameLODPreset {
    const defaults = DEFAULT_DYNAMIC_PRESETS[block.name] ?? DEFAULT_DYNAMIC_PRESETS['VeryHigh']!;
    return {
      minimumFPS: readInt(block.fields['MinimumFPS']) ?? defaults.minimumFPS,
      particleSkipMask: readInt(block.fields['ParticleSkipMask']) ?? defaults.particleSkipMask,
      debrisSkipMask: readInt(block.fields['DebrisSkipMask']) ?? defaults.debrisSkipMask,
      slowDeathScale: readFloat(block.fields['SlowDeathScale']) ?? defaults.slowDeathScale,
      minParticlePriority: readPriority(block.fields['MinParticlePriority']) ?? defaults.minParticlePriority,
      minParticleSkipPriority: readPriority(block.fields['MinParticleSkipPriority']) ?? defaults.minParticleSkipPriority,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function priorityIndex(priority: ParticlePriority): number {
  const idx = PARTICLE_PRIORITY_ORDER.indexOf(priority);
  return idx >= 0 ? idx : 0;
}

type IniValue = string | number | boolean | unknown[] | undefined;

function readInt(value: IniValue): number | undefined {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readFloat(value: IniValue): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readBool(value: IniValue): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'yes' || lower === 'true' || lower === '1') return true;
    if (lower === 'no' || lower === 'false' || lower === '0') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
}

function readPriority(value: IniValue): ParticlePriority | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase() as ParticlePriority;
  if (PARTICLE_PRIORITY_ORDER.includes(upper)) return upper;
  return undefined;
}
