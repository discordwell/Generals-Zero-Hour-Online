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
export { FXListManager } from './fx-list-manager.js';
export type { FXEventCallbacks } from './fx-list-manager.js';
export {
  createShadowDecalMesh,
  updateShadowDecalPosition,
  parseObjectShadowType,
  shouldCastShadowMap,
  shouldCreateShadowDecal,
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
