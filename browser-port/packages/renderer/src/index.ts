/**
 * @generals/renderer
 *
 * This package currently re-exports the existing terrain rendering subsystems while
 * the dedicated renderer package is expanded.
 */
export { TerrainVisual, WaterVisual } from '@generals/terrain';
export type { MapDataJSON, TerrainConfig, PolygonTriggerJSON } from '@generals/terrain';
export type { TerrainChunk } from '@generals/terrain';
export { ObjectVisualManager } from './object-visuals.js';
export { GameLODManager } from './game-lod-manager.js';
export type {
  StaticLODLevel,
  DynamicLODLevel,
  ParticlePriority,
  StaticGameLODPreset,
  DynamicGameLODPreset,
} from './game-lod-manager.js';
export { PARTICLE_PRIORITY_ORDER } from './game-lod-manager.js';
export { parseParticleSystemTemplate } from './particle-system-template.js';
export type {
  ParticleSystemTemplate,
  ParticleShaderType,
  ParticleType,
  EmissionVolumeType,
  EmissionVelocityType,
  WindMotionType,
  RandomRange,
  AlphaKeyframe,
  ColorKeyframe,
} from './particle-system-template.js';
export { parseFXListTemplate } from './fx-list-template.js';
export type { FXListTemplate, FXNugget } from './fx-list-template.js';
export { ParticleSystemManager } from './particle-system-manager.js';
export type {
  ParticleSystemManagerSaveState,
  ParticleSystemInstanceSaveState,
} from './particle-system-manager.js';
export { FXListManager } from './fx-list-manager.js';
export type { FXEventCallbacks } from './fx-list-manager.js';
export {
  createShadowDecalMesh,
  updateShadowDecalPosition,
  parseObjectShadowType,
  shouldCastShadowMap,
  shouldCreateShadowDecal,
  shouldCreateBlobShadowFallback,
} from './shadow-decal.js';
export type { ObjectShadowType, ShadowDecalConfig } from './shadow-decal.js';
export { DecalRenderer } from './decal-renderer.js';
export type { DecalConfig, DecalHandle, DecalBlendMode } from './decal-renderer.js';
export { createSelectionDecal, createRadiusIndicatorDecal, updateDecalThrob } from './radius-decal.js';
export type { RadiusDecalConfig } from './radius-decal.js';
export { TerrainScorchManager } from './terrain-scorch.js';
export type { TerrainScorchConfig } from './terrain-scorch.js';
export { DecalManager } from './decal-manager.js';
export { LODManager } from './lod-manager.js';
export type { LODSceneInfo } from './lod-manager.js';
export type {
  ObjectVisualManagerConfig,
  RenderableAnimationState,
  RenderableEntityState,
} from './object-visuals.js';
export { LaserBeamRenderer } from './laser-beam-renderer.js';
export type { LaserBeamConfig } from './laser-beam-renderer.js';
export { DynamicLightManager } from './dynamic-lights.js';
export type { DynamicLightConfig } from './dynamic-lights.js';
export { TracerRenderer } from './tracer-renderer.js';
export type { TracerConfig } from './tracer-renderer.js';
export { DebrisRenderer } from './debris-renderer.js';
export type { DebrisConfig } from './debris-renderer.js';
export { TerrainRoadRenderer, extractRoadSegments, buildRoadPaths, buildRoadMesh } from './terrain-roads.js';
export type { RoadPoint, RoadSegment, RoadRenderConfig, HeightmapQuery } from './terrain-roads.js';
export { TerrainBridgeRenderer, extractBridgeSegments, calculateSectionalBridgeSpanCount } from './terrain-bridges.js';
export type { BridgePoint, BridgeSegment, TerrainBridgeDefinition, TerrainBridgeRendererConfig } from './terrain-bridges.js';
export { ShroudRenderer, CELL_SHROUDED, CELL_FOGGED, CELL_CLEAR } from './shroud-renderer.js';
export type { ShroudRendererConfig, FogOfWarData } from './shroud-renderer.js';
export { DisplayStringRenderer } from './display-strings.js';
export type { DisplayStringType } from './display-strings.js';
