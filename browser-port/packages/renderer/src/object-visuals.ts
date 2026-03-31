/**
 * ObjectVisualManager — loads and updates converted model assets for map entities.
 *
 * This manager receives render-ready snapshots from game-logic and renders
 * them as asset-backed visual nodes.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetManager } from '@generals/assets';
import {
  computeConditionKey,
  findBestConditionMatch,
} from '@generals/game-logic';
import type {
  IdleAnimationVariant,
  ModelConditionInfo,
  TransitionInfo,
} from '@generals/game-logic';
import {
  parseObjectShadowType,
  shouldCastShadowMap,
  shouldCreateShadowDecal,
  createShadowDecalMesh,
  createShadowDecalTexture,
  applyShadowDecalMaterialMode,
} from './shadow-decal.js';

// Re-export types and computeConditionKey so existing consumers of
// @generals/renderer that import these from object-visuals keep working.
export { computeConditionKey };
export type { IdleAnimationVariant, ModelConditionInfo, TransitionInfo };

export type RenderableAnimationState = 'IDLE' | 'MOVE' | 'ATTACK' | 'DIE' | 'PRONE';

export interface RenderableEntityState {
  id: number;
  renderAssetPath: string | null;
  renderAssetResolved: boolean;
  renderAssetCandidates?: readonly string[];
  renderAnimationStateClips?: Partial<Record<RenderableAnimationState, string[]>>;
  modelConditionInfos?: ModelConditionInfo[];
  transitionInfos?: TransitionInfo[];
  /**
   * Source parity: IgnoreConditionStates — condition flags to strip before
   * matching ModelConditionStates.
   */
  ignoreConditionStates?: readonly string[];
  modelConditionFlags?: readonly string[];
  category?: string;
  currentSpeed?: number;
  maxSpeed?: number;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  animationState: RenderableAnimationState;
  health?: number;
  maxHealth?: number;
  isSelected?: boolean;
  side?: string;
  veterancyLevel?: number;
  isStealthed?: boolean;
  isDetected?: boolean;
  /** Source parity: StealthUpdate.h:86 — per-module friendly opacity for stealthed ally rendering. */
  stealthFriendlyOpacity?: number;
  /** Source parity: StealthUpdate disguise — template name the unit is visually disguised as.
   *  null/undefined when not disguised. Used to swap the visual model. */
  disguiseTemplateName?: string | null;
  scriptFlashCount?: number;
  scriptFlashColor?: number;
  shroudStatus?: 'CLEAR' | 'FOGGED' | 'SHROUDED';
  constructionPercent?: number;
  toppleAngle?: number;
  toppleDirX?: number;
  toppleDirZ?: number;
  turretAngles?: readonly number[];
  shadowType?: string;
  shadowSizeX?: number;
  shadowSizeY?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowTextureName?: string;
  /** Active status effects for overlay icons (poisoned, burning, EMP'd, etc.). */
  statusEffects?: readonly string[];
  /** Source parity: Geometry MajorRadius — used for selection circle sizing. */
  selectionCircleRadius?: number;
  /** True when this entity belongs to the local player's side. */
  isOwnedByLocalPlayer?: boolean;
  /** True when the entity is in guard mode (guardState !== 'NONE'). */
  isGuarding?: boolean;
  /** Tunnel enter/exit transition opacity override (0..1). Undefined = no transition active. */
  tunnelTransitionOpacity?: number;
}

export interface LoadedModelAsset {
  readonly scene: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
}

interface VisualAssetState {
  root: THREE.Group;
  placeholder: THREE.Mesh | null;
  assetPath: string | null;
  loadToken: number;
  currentModel: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  actions: Map<RenderableAnimationState, THREE.AnimationAction>;
  activeState: RenderableAnimationState | null;
  requestedAnimationState: RenderableAnimationState;
  healthBarGroup: THREE.Group | null;
  healthBarFill: THREE.Mesh | null;
  selectionRing: THREE.Mesh | null;
  /** Accumulated game time (seconds) when selection ring was first shown, for pulse animation. */
  selectionRingSpawnTime: number;
  /** Last applied selection ring scale (to avoid redundant updates). */
  selectionRingScale: number;
  /** Last applied selection ring color hex (to avoid redundant material updates). */
  selectionRingColorHex: number;
  scriptFlashRing: THREE.Mesh | null;
  veterancyBadge: THREE.Group | null;
  currentVeterancyLevel: number;
  /** Cloned materials for stealth opacity mutation (avoids mutating shared GLTF materials). */
  stealthMaterialClones: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>;
  /** Original material transparency state before stealth/transition opacity overrides.
   *  Saved per-material so materials that are inherently transparent (tree foliage,
   *  glass, fences with alphaMode BLEND/MASK) are correctly restored when stealth ends. */
  originalMaterialAlpha: WeakMap<THREE.Material, { transparent: boolean; depthWrite: boolean; opacity: number }>;
  /** Previous stealth opacity to skip redundant traversals. */
  lastStealthOpacity: number;
  /** Shadow decal mesh (for SHADOW_DECAL type). */
  shadowDecal: THREE.Mesh | null;
  /** Parsed shadow type for this entity. */
  shadowType: string | null;
  /** Current shadow texture cache key (used to discard stale async loads). */
  shadowTextureKey: string | null;
  /** Token for pending shadow texture loads. */
  shadowTextureLoadToken: number;
  /**
   * Cached turret bone references found in the loaded model hierarchy.
   * Index 0 = main turret (INI "Turret" field), index 1 = alt turret ("AltTurret").
   * Source parity: W3DModelDraw::handleClientTurretRotation.
   */
  turretBones: THREE.Object3D[];
  /** Status effect icon group (poisoned, burning, EMP'd). */
  statusEffectGroup: THREE.Group | null;
  /** Tracks which effects are currently shown (for diffing). */
  activeStatusEffects: readonly string[];
  /** Active condition key (serialised flags of best-matching ModelConditionInfo). */
  activeConditionKey: string | null;
  /** Currently playing condition-based animation action. */
  conditionAction: THREE.AnimationAction | null;
  /** Cached condition-clip actions keyed by clip name. */
  conditionClipActions: Map<string, THREE.AnimationAction>;
  /** Source animation clips from the loaded GLB (for condition-based clip lookup). */
  sourceAnimations: readonly THREE.AnimationClip[];
  /** Cached tread sub-meshes for UV scrolling. */
  treadMeshes: THREE.Mesh[];
  /** Accumulated tread UV offset. */
  treadUVOffset: number;
  /** Cached active flags Set (avoids per-frame allocation). */
  cachedActiveFlags: Set<string>;
  /** Serialised key of cached flags (for change detection). */
  cachedActiveFlagsKey: string;
  /** Cached filtered flags with IgnoreConditionStates applied (avoids per-frame allocation). */
  cachedFilteredFlags: Set<string>;
  cachedFilteredFlagsKey: string;
  // --- Transition state system (source parity: W3DModelDraw::setModelState) ---
  /** True when a transition animation is currently playing. */
  isInTransition: boolean;
  /** The condition key we are transitioning *to* (applied after transition completes). */
  transitionTargetConditionKey: string | null;
  /** The TransitionKey of the condition state we are transitioning *from*. */
  transitionFromKey: string | null;
  /** Matched ModelConditionInfo pending application after transition finishes. */
  transitionTargetMatch: ModelConditionInfo | null;
  // --- Idle animation randomization ---
  /** Index of the currently playing idle variant (-1 = none). */
  idleVariantIndex: number;
  /** Accumulated time in seconds since the current idle variant started. */
  idleVariantElapsed: number;
  // --- Per-condition model swapping ---
  /** Cache of alternate condition-triggered models (keyed by model name). */
  alternateModelCache: Map<string, { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] }>;
  /** Model name currently loaded (to detect when a swap is needed). */
  currentModelName: string | null;
  /** Token for pending model swap loads (to discard stale loads). */
  modelSwapLoadToken: number;
  // --- Animation speed factor ---
  /** Per-entity randomised speed factor applied on condition change. */
  conditionAnimSpeedFactor: number;
  // --- Team color ---
  /** Side string last applied for team color tinting (null = never applied). */
  appliedTeamColorSide: string | null;
  // --- Disguise model swap ---
  /** Template name of the current disguise (null = not disguised). */
  disguiseTemplateName: string | null;
  /** The model asset path loaded for the disguise (null = no disguise model loaded). */
  disguiseAssetPath: string | null;
  /** Saved real model when disguise is active (so we can restore on undisguise). */
  realModel: THREE.Object3D | null;
  /** Saved real model asset path. */
  realAssetPath: string | null;
  /** Disguise transition opacity progress (0..1, where 0.5 is the swap point). */
  disguiseTransitionProgress: number;
  /** Whether a disguise fade transition is currently in progress. */
  disguiseTransitioning: boolean;
  /** Direction of disguise transition: true = applying disguise, false = removing. */
  disguiseTransitionApplying: boolean;
  // --- Damage flash ---
  /** Accumulated time (seconds) when the red damage flash should end. -1 = no flash. */
  damageFlashEndTime: number;
  /** Last known health value for detecting health decreases between frames. */
  lastKnownHealth: number;
  // --- Veterancy promotion flash ---
  /** Accumulated time (seconds) when the gold veterancy flash should end. -1 = no flash. */
  veterancyFlashEndTime: number;
}

export interface ObjectVisualManagerConfig {
  /** Candidate suffixes when a model path has no extension. */
  modelExtensions?: readonly string[];
  /** Optional custom model loader (for tests or alternate formats). */
  modelLoader?: (assetPath: string) => Promise<LoadedModelAsset>;
}

const DEFAULT_MODEL_EXTENSIONS: readonly string[] = ['.gltf', '.glb'];

/**
 * Resolve animation states to clip name candidates from converted assets.
 */
const CLIP_HINTS_BY_STATE: Record<RenderableAnimationState, string[]> = {
  IDLE: ['Idle', 'IdleLoop', 'Idle2', 'Stand', 'Neutral'],
  MOVE: ['Move', 'MoveLoop', 'Run', 'Walk'],
  ATTACK: ['Attack', 'Firing', 'Fire', 'AttackLoop', 'GunAttack'],
  DIE: ['Die', 'Death', 'DeathLoop', 'Dead'],
  PRONE: ['Prone', 'ProneIdle', 'Crawl', 'CrawlLoop'],
};

/**
 * Random float in [min, max].
 * Source parity: GameClientRandomValueReal.
 */
function randomInRange(min: number, max: number): number {
  if (min >= max) return min;
  return min + Math.random() * (max - min);
}

/**
 * W3D condition-state suffix pattern: one or more uppercase letters after the
 * last underscore in the model name (e.g. _D, _S, _AD, _DNS, _ACE).
 * Matches against the filename portion only (no directory, no extension).
 */
const CONDITION_SUFFIX_RE = /^(.+)_[A-Z]+$/;

/**
 * Strip a W3D condition-state suffix from a model path/name.
 * Returns the base name (with directory/extension preserved) if a suffix was
 * found, or null if the name doesn't end with a condition suffix.
 *
 * Examples:
 *   "PMgaldrum_D"       → "PMgaldrum"
 *   "AVCONSTDOZ_AD"     → "AVCONSTDOZ"
 *   "models/foo_DNS"    → "models/foo"
 *   "ABBarracks"        → null  (no suffix)
 *   "AVThundrblt_d1"    → null  (suffix contains digit, not a condition suffix)
 */
export function stripConditionStateSuffix(modelPath: string): string | null {
  // Separate extension if present.
  const dotIdx = modelPath.lastIndexOf('.');
  const slashIdx = modelPath.lastIndexOf('/');
  const hasExtension = dotIdx > 0 && dotIdx > slashIdx;
  const pathWithoutExt = hasExtension ? modelPath.slice(0, dotIdx) : modelPath;
  const extension = hasExtension ? modelPath.slice(dotIdx) : '';

  // Work on just the filename portion to avoid matching directory separators.
  const lastSlash = pathWithoutExt.lastIndexOf('/');
  const dirPrefix = lastSlash >= 0 ? pathWithoutExt.slice(0, lastSlash + 1) : '';
  const filename = lastSlash >= 0 ? pathWithoutExt.slice(lastSlash + 1) : pathWithoutExt;

  const match = CONDITION_SUFFIX_RE.exec(filename);
  if (!match) {
    return null;
  }

  return `${dirPrefix}${match[1]}${extension}`;
}

export class ObjectVisualManager {
  private static readonly DEFAULT_SOURCE_SHADOW_DECAL_SIZE = 20;
  private readonly scene: THREE.Scene;
  private readonly assetManager: AssetManager | null;
  private readonly config: Required<ObjectVisualManagerConfig>;
  private readonly modelLoader: (assetPath: string) => Promise<LoadedModelAsset>;
  private readonly gltfLoader = new GLTFLoader();
  private readonly raycaster = new THREE.Raycaster();
  private readonly visuals = new Map<number, VisualAssetState>();
  private readonly modelCache = new Map<string, LoadedModelAsset>();
  private readonly modelLoadPromises = new Map<string, Promise<LoadedModelAsset>>();
  private readonly shadowTexturePromises = new Map<string, Promise<THREE.Texture | null>>();
  /** Pending model loads waiting for a concurrency slot. */
  private readonly modelLoadQueue: Array<{
    assetPath: string;
    resolve: (result: LoadedModelAsset) => void;
    reject: (error: unknown) => void;
  }> = [];
  /** Number of model loads currently in flight. */
  private activeModelLoads = 0;
  /**
   * Maximum concurrent model load requests.  Limits HTTP connection
   * pressure so the render loop remains responsive while models load
   * progressively in the background.
   */
  static MAX_CONCURRENT_MODEL_LOADS = Math.min(
    typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 8) : 8,
    24,
  );
  private readonly unresolvedEntityIds = new Set<number>();
  private readonly tempYawQuaternion = new THREE.Quaternion();
  private readonly tempToppleQuaternion = new THREE.Quaternion();
  private readonly tempToppleDirection = new THREE.Vector3();
  private readonly tempToppleAxis = new THREE.Vector3();
  private viewGuardBandBiasX = 0;
  private viewGuardBandBiasY = 0;
  /** Accumulated game time in seconds — advances by dt each sync(), freezes when paused (dt=0). */
  private accumulatedTime = 0;

  constructor(
    scene: THREE.Scene,
    assetManager: AssetManager | null,
    config: ObjectVisualManagerConfig = {},
  ) {
    this.scene = scene;
    this.assetManager = assetManager;
    if (!assetManager && !config.modelLoader) {
      throw new Error('ObjectVisualManager requires either an AssetManager or a custom modelLoader.');
    }

    this.config = {
      modelExtensions: [...DEFAULT_MODEL_EXTENSIONS],
      modelLoader: config.modelLoader ?? this.createDefaultModelLoader.bind(this),
    };
    this.modelLoader = config.modelLoader ?? this.config.modelLoader;
  }

  /**
   * Set camera position for distance-based sync throttling.
   * Call once per frame before sync().
   */
  setCameraPosition(x: number, z: number): void {
    this.cameraX = x;
    this.cameraZ = z;
  }

  private cameraX = 0;
  private cameraZ = 0;
  /** Distance beyond which entities only get position updates, not full sync. */
  private static readonly FAR_SYNC_DISTANCE_SQR = 600 * 600;

  /**
   * Nominal height by category — mirrors game-logic nominalHeightForCategory.
   * Used to compute shadow decal Y offset (terrain level relative to entity root).
   */
  static nominalHeightForCategory(category?: string): number {
    switch (category) {
      case 'air': return 2.4;
      case 'building': return 8;
      case 'infantry': return 2;
      case 'vehicle': return 3;
      default: return 2;
    }
  }

  /**
   * Sync rendered object visuals with latest render-state snapshots.
   */
  sync(states: readonly RenderableEntityState[], dt = 0): void {
    this.accumulatedTime += dt;
    const activeIds = new Set<number>();
    for (const state of states) {
      activeIds.add(state.id);
      let visual = this.visuals.get(state.id);
      if (!visual) {
        visual = this.createVisual(state.id);
        this.visuals.set(state.id, visual);
      }
      visual.requestedAnimationState = state.animationState;

      // Always update position and shroud visibility.
      this.syncVisualTransform(visual, state);
      this.syncShroudVisibility(visual, state);

      // Skip expensive visual updates for hidden (shrouded) entities.
      // This saves ~10 sync operations per hidden entity per frame.
      if (!visual.root.visible) {
        continue;
      }

      // Keep model loads source-facing: a fast scripted camera move should not
      // wait until an entity is inside the full-sync radius before requesting
      // its asset. Expensive per-frame visual updates still stay throttled.
      this.syncVisualAsset(visual, state);

      // Skip expensive sync for entities far from camera.
      // Position + shroud are already updated above; full visual sync
      // (animations, health bars, effects) only needed for nearby entities.
      const dx = state.x - this.cameraX;
      const dz = state.z - this.cameraZ;
      if (dx * dx + dz * dz > ObjectVisualManager.FAR_SYNC_DISTANCE_SQR
        && !state.isSelected) {
        continue;
      }

      this.syncDisguise(visual, state, dt);
      this.syncTeamColor(visual, state);
      this.syncDamageFlash(visual, state);
      this.syncHealthBar(visual, state);
      this.syncSelectionRing(visual, state);
      this.syncScriptFlashRing(visual, state);
      this.syncVeterancyBadge(visual, state);
      this.syncStatusEffects(visual, state);
      this.syncStealthOpacity(visual, state);
      this.syncTurretBones(visual, state);
      this.syncConditionAnimation(visual, state, dt);
      // Only use legacy 5-state system if condition system isn't managing animation.
      if (visual.conditionAction === null) {
        this.applyAnimationState(visual, state.animationState);
      }
      this.syncAnimationSpeed(visual, state);
      this.syncTreadScrolling(visual, state, dt);
      // Only tick animation mixer when there are active animation actions.
      // Static entities (trees, props) have mixers but no playing clips.
      if (visual.mixer && visual.actions.size > 0) {
        visual.mixer.update(dt);
      }
    }

    for (const [entityId, visual] of this.visuals) {
      if (!activeIds.has(entityId)) {
        this.removeVisual(entityId, visual);
      }
    }
  }

  /**
   * Return the live rendered root for debug/tests.
   */
  getVisualRoot(entityId: number): THREE.Object3D | null {
    return this.visuals.get(entityId)?.root ?? null;
  }

  getVisualState(entityId: number): {
    animationState: RenderableAnimationState | null;
    hasModel: boolean;
    assetPath: string | null;
    isInTransition: boolean;
    activeConditionKey: string | null;
    conditionAnimSpeedFactor: number;
    idleVariantIndex: number;
    currentModelName: string | null;
    conditionAction: THREE.AnimationAction | null;
  } | null {
    const visual = this.visuals.get(entityId);
    if (!visual) {
      return null;
    }
    return {
      animationState: visual.activeState,
      hasModel: visual.currentModel !== null,
      assetPath: visual.assetPath,
      isInTransition: visual.isInTransition,
      activeConditionKey: visual.activeConditionKey,
      conditionAnimSpeedFactor: visual.conditionAnimSpeedFactor,
      idleVariantIndex: visual.idleVariantIndex,
      currentModelName: visual.currentModelName,
      conditionAction: visual.conditionAction,
    };
  }

  /**
   * Return entity ids that are currently marked unresolved because model load failed.
   */
  getUnresolvedEntityIds(): number[] {
    return Array.from(this.unresolvedEntityIds.values()).sort((left, right) => left - right);
  }

  /** Fast count without allocating a sorted array — use in per-frame paths. */
  getUnresolvedEntityCount(): number {
    return this.unresolvedEntityIds.size;
  }

  /**
   * Source parity bridge: TacticalView::setGuardBandBias.
   * Positive values expand drawable culling margins; this renderer bridge disables
   * frustum culling while script guard-band bias is active.
   */
  setViewGuardBandBias(guardBandX: number, guardBandY: number): void {
    const normalizedX = Number.isFinite(guardBandX) ? guardBandX : 0;
    const normalizedY = Number.isFinite(guardBandY) ? guardBandY : 0;
    if (normalizedX === this.viewGuardBandBiasX && normalizedY === this.viewGuardBandBiasY) {
      return;
    }
    this.viewGuardBandBiasX = normalizedX;
    this.viewGuardBandBiasY = normalizedY;
    for (const visual of this.visuals.values()) {
      this.applyGuardBandFrustumPolicy(visual.root);
    }
  }

  /**
   * Load and clone a model for the given render-asset candidates.
   * Used for building placement ghost previews — returns a deep clone of
   * the first successfully loaded model, or null if none could be loaded.
   */
  async cloneModelForGhost(assetCandidates: readonly string[]): Promise<THREE.Object3D | null> {
    for (const rawCandidate of assetCandidates) {
      const resolved = this.resolveCandidateAssetPaths(rawCandidate);
      for (const candidate of resolved) {
        try {
          const source = await this.loadModelAsset(candidate);
          return source.scene.clone(true);
        } catch {
          // Try next candidate.
        }
      }
    }
    return null;
  }

  dispose(): void {
    for (const [entityId, visual] of this.visuals) {
      this.removeVisual(entityId, visual);
    }
    this.visuals.clear();
    this.unresolvedEntityIds.clear();
    this.modelLoadPromises.clear();
    this.modelCache.clear();
    this.shadowTexturePromises.clear();
  }

  // ==========================================================================
  // Visual lifecycle
  // ==========================================================================

  private createVisual(entityId: number): VisualAssetState {
    const root = new THREE.Group();
    root.name = `object-visual-${entityId}`;
    root.userData = { entityId };
    this.scene.add(root);

    return {
      root,
      placeholder: null,
      assetPath: null,
      loadToken: 0,
      currentModel: null,
      mixer: null,
      actions: new Map(),
      activeState: null,
      requestedAnimationState: 'IDLE',
      healthBarGroup: null,
      healthBarFill: null,
      selectionRing: null,
      selectionRingSpawnTime: -1,
      selectionRingScale: 0,
      selectionRingColorHex: 0,
      scriptFlashRing: null,
      veterancyBadge: null,
      currentVeterancyLevel: 0,
      stealthMaterialClones: new WeakMap(),
      originalMaterialAlpha: new WeakMap(),
      lastStealthOpacity: 1.0,
      shadowDecal: null,
      shadowType: null,
      shadowTextureKey: null,
      shadowTextureLoadToken: 0,
      turretBones: [],
      statusEffectGroup: null,
      activeStatusEffects: [],
      activeConditionKey: null,
      conditionAction: null,
      conditionClipActions: new Map(),
      sourceAnimations: [],
      treadMeshes: [],
      treadUVOffset: 0,
      cachedActiveFlags: new Set(),
      cachedActiveFlagsKey: '',
      cachedFilteredFlags: new Set(),
      cachedFilteredFlagsKey: '',
      isInTransition: false,
      transitionTargetConditionKey: null,
      transitionFromKey: null,
      transitionTargetMatch: null,
      idleVariantIndex: -1,
      idleVariantElapsed: 0,
      alternateModelCache: new Map(),
      currentModelName: null,
      modelSwapLoadToken: 0,
      conditionAnimSpeedFactor: 1.0,
      appliedTeamColorSide: null,
      disguiseTemplateName: null,
      disguiseAssetPath: null,
      realModel: null,
      realAssetPath: null,
      disguiseTransitionProgress: 0,
      disguiseTransitioning: false,
      disguiseTransitionApplying: false,
      damageFlashEndTime: -1,
      lastKnownHealth: -1,
      veterancyFlashEndTime: -1,
    };
  }

  private syncVisualTransform(visual: VisualAssetState, state: RenderableEntityState): void {
    visual.root.position.set(state.x, state.y, state.z);
    const yaw = Number.isFinite(state.rotationY) ? state.rotationY : 0;
    this.tempYawQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);

    const toppleAngle = Number.isFinite(state.toppleAngle) ? Math.max(0, state.toppleAngle ?? 0) : 0;
    if (toppleAngle > 0.0001) {
      const toppleDirX = Number.isFinite(state.toppleDirX) ? state.toppleDirX ?? 0 : 0;
      const toppleDirZ = Number.isFinite(state.toppleDirZ) ? state.toppleDirZ ?? 0 : 0;
      this.tempToppleDirection.set(toppleDirX, 0, toppleDirZ);
      if (this.tempToppleDirection.lengthSq() < 1e-8) {
        this.tempToppleDirection.set(0, 0, 1);
      } else {
        this.tempToppleDirection.normalize();
      }
      // Topple axis is orthogonal to fall direction and world up.
      this.tempToppleAxis.set(this.tempToppleDirection.z, 0, -this.tempToppleDirection.x).normalize();
      this.tempToppleQuaternion.setFromAxisAngle(this.tempToppleAxis, toppleAngle);
      visual.root.quaternion.copy(this.tempYawQuaternion).multiply(this.tempToppleQuaternion);
      return;
    }

    visual.root.quaternion.copy(this.tempYawQuaternion);
  }

  private syncShroudVisibility(visual: VisualAssetState, state: RenderableEntityState): void {
    const shroudStatus = state.shroudStatus ?? 'CLEAR';
    visual.root.visible = shroudStatus !== 'SHROUDED';
  }

  pickObjectByInput(
    input: { mouseX: number; mouseY: number; viewportWidth: number; viewportHeight: number },
    camera: THREE.Camera,
  ): number | null {
    const ndc = this.pixelToNDC(
      input.mouseX,
      input.mouseY,
      input.viewportWidth,
      input.viewportHeight,
    );
    if (ndc === null) {
      return null;
    }

    this.raycaster.setFromCamera(ndc, camera);
    // Only raycast against entity visual roots (not terrain, water,
    // particles, etc.) to avoid checking all 11K+ scene meshes.
    const entityRoots: THREE.Object3D[] = [];
    for (const visual of this.visuals.values()) {
      if (visual.root.visible) entityRoots.push(visual.root);
    }
    const hit = this.raycaster.intersectObjects(entityRoots, true).at(0);
    if (!hit) {
      return null;
    }

    let current: THREE.Object3D | null = hit.object;
    while (current !== null) {
      const candidate = current.userData as { entityId?: unknown };
      const entityId = typeof candidate?.entityId === 'number'
        ? candidate.entityId
        : undefined;
      if (entityId !== undefined) {
        return entityId;
      }
      current = current.parent;
    }

    return null;
  }

  private syncVisualAsset(visual: VisualAssetState, state: RenderableEntityState): void {
    const entityId = visual.root.userData.entityId as number;

    // Fast path: if the model is already loaded and the primary asset path
    // hasn't changed, skip the full candidate collection.
    const primaryPath = this.selectAssetPath(state.renderAssetPath, state.renderAssetResolved);
    if (visual.currentModel !== null && visual.assetPath !== null && visual.assetPath === primaryPath) {
      this.syncShadowConfiguration(visual, visual.currentModel, state);
      this.unresolvedEntityIds.delete(entityId);
      this.updatePlaceholderVisibility(entityId, false);
      return;
    }

    // A matching asset is already loading or has already failed all candidates
    // for the current requested path. Avoid restarting the async load chain
    // every frame while the request is in flight.
    if (visual.currentModel === null && visual.assetPath !== null && visual.assetPath === primaryPath) {
      const isUnresolved = this.unresolvedEntityIds.has(entityId);
      this.updatePlaceholderVisibility(entityId, isUnresolved);
      if (isUnresolved) {
        this.scalePlaceholder(visual, state);
      }
      return;
    }

    const candidateAssetPaths = this.collectCandidateAssetPaths(state);

    if (candidateAssetPaths.length === 0) {
      if (visual.currentModel !== null) {
        this.removeModel(visual);
      }
      if (visual.assetPath !== null) {
        visual.loadToken += 1;
      }
      visual.assetPath = null;
      // Only show placeholder for entities that have a render asset path
      // but it hasn't loaded yet.  Entities without any render asset
      // (ambient sounds, waypoints, roads) are intentionally invisible
      // in the C++ source — don't clutter the scene with magenta boxes.
      if (state.renderAssetPath) {
        this.unresolvedEntityIds.add(entityId);
        this.updatePlaceholderVisibility(entityId, true);
        this.scalePlaceholder(visual, state);
      } else {
        this.unresolvedEntityIds.delete(entityId);
        this.updatePlaceholderVisibility(entityId, false);
      }
      return;
    }

    if (visual.currentModel !== null && visual.assetPath !== null && candidateAssetPaths.includes(visual.assetPath)) {
      this.unresolvedEntityIds.delete(entityId);
      this.updatePlaceholderVisibility(entityId, false);
      return;
    }

    visual.loadToken += 1;
    const loadToken = visual.loadToken;
    visual.assetPath = candidateAssetPaths[0] ?? null;
    const normalizedCandidates = candidateAssetPaths;
    this.ensurePlaceholderMesh(entityId);
    this.updatePlaceholderVisibility(entityId, false);
    this.scalePlaceholder(visual, state);
    this.removeModel(visual);

    void (async () => {
      for (const candidate of normalizedCandidates) {
        try {
          const source = await this.loadModelAsset(candidate);
          const currentVisual = this.visuals.get(entityId);
          if (!currentVisual || currentVisual.loadToken !== loadToken || currentVisual !== visual) {
            return;
          }

          this.removeModel(currentVisual);
          const clone = source.scene.clone(true);
          const mixer = source.animations.length > 0
            ? new THREE.AnimationMixer(clone)
            : null;
          const actions = new Map<RenderableAnimationState, THREE.AnimationAction>();
          const clipCandidatesByState = this.resolveAnimationClipCandidates(state.renderAnimationStateClips);

          for (const stateKey of Object.keys(CLIP_HINTS_BY_STATE) as RenderableAnimationState[]) {
            const clipCandidates = clipCandidatesByState[stateKey];
            const clip = this.findMatchingClip(source.animations, clipCandidates);
            if (clip) {
              const action = mixer?.clipAction(clip);
              if (action) {
                action.enabled = false;
                actions.set(stateKey, action);
              }
            }
          }

          this.syncShadowConfiguration(currentVisual, clone, state);

          this.applyGuardBandFrustumPolicy(clone);
          currentVisual.currentModel = clone;
          currentVisual.mixer = mixer;
          currentVisual.actions = actions;
          currentVisual.turretBones = this.findTurretBones(clone);
          currentVisual.sourceAnimations = source.animations;
          // Detect tread sub-meshes for UV scrolling (C++ pattern: mesh name contains "TREAD").
          const treadMeshes: THREE.Mesh[] = [];
          clone.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && child.name.toUpperCase().includes('TREAD')) {
              treadMeshes.push(child as THREE.Mesh);
            }
          });
          currentVisual.treadMeshes = treadMeshes;
          currentVisual.root.add(clone);
          this.applyAnimationState(currentVisual, currentVisual.requestedAnimationState);
          this.unresolvedEntityIds.delete(entityId);
          this.updatePlaceholderVisibility(entityId, false);
          return;
        } catch (error) {
          // Model load failed for this candidate — try next.
          // Log the first failure per entity to aid debugging (e.g. stale
          // manifest hashes, missing files, GLTF parse errors).
          if (candidate === normalizedCandidates[0]) {
            console.warn(
              `[ObjectVisualManager] Model load failed for entity ${entityId} candidate "${candidate}":`,
              error instanceof Error ? error.message : error,
            );
          }
        }
      }

      const currentVisual = this.visuals.get(entityId);
      if (currentVisual && currentVisual === visual && currentVisual.loadToken === loadToken) {
        this.unresolvedEntityIds.add(entityId);
        this.updatePlaceholderVisibility(entityId, true);
        this.scalePlaceholder(currentVisual, state);
      }
    })();
  }

  // ==========================================================================
  // Disguise model swap (source parity: StealthUpdate::changeVisualDisguise)
  // ==========================================================================

  /** Transition speed: progress per second. ~15 frames at 30fps = 0.5s total, so 2.0/s. */
  private static readonly DISGUISE_TRANSITION_SPEED = 2.0;

  /**
   * Sync disguise visual model swap. When an entity's disguiseTemplateName changes,
   * initiate a fade transition: opacity 1 -> 0 at the midpoint, swap the model,
   * then 0 -> 1. This mirrors C++ StealthUpdate::changeVisualDisguise behaviour
   * where the drawable is swapped at the transition midpoint.
   */
  private syncDisguise(visual: VisualAssetState, state: RenderableEntityState, dt: number): void {
    const wantDisguise = state.disguiseTemplateName ?? null;

    // Detect disguise state change.
    if (wantDisguise !== visual.disguiseTemplateName) {
      if (wantDisguise && !visual.disguiseTemplateName) {
        // Applying disguise: start fade-out transition.
        visual.disguiseTemplateName = wantDisguise;
        visual.disguiseTransitioning = true;
        visual.disguiseTransitionProgress = 0;
        visual.disguiseTransitionApplying = true;
      } else if (!wantDisguise && visual.disguiseTemplateName) {
        // Removing disguise: start fade-out transition to reveal real model.
        visual.disguiseTemplateName = null;
        visual.disguiseTransitioning = true;
        visual.disguiseTransitionProgress = 0;
        visual.disguiseTransitionApplying = false;
      } else if (wantDisguise && visual.disguiseTemplateName && wantDisguise !== visual.disguiseTemplateName) {
        // Changing disguise target: restart transition.
        visual.disguiseTemplateName = wantDisguise;
        visual.disguiseTransitioning = true;
        visual.disguiseTransitionProgress = 0;
        visual.disguiseTransitionApplying = true;
        // If currently showing a disguise model, remove it first.
        if (visual.realModel && visual.currentModel !== visual.realModel) {
          this.removeModel(visual);
          visual.currentModel = visual.realModel;
          visual.root.add(visual.realModel);
        }
        visual.disguiseAssetPath = null;
      }
    }

    if (!visual.disguiseTransitioning) return;

    // Advance transition.
    visual.disguiseTransitionProgress += dt * ObjectVisualManager.DISGUISE_TRANSITION_SPEED;

    // Source parity: opacity = |1 - progress * 2|. At progress=0.5, opacity=0 (swap point).
    const clampedProgress = Math.min(visual.disguiseTransitionProgress, 1.0);
    const opacity = Math.abs(1.0 - clampedProgress * 2.0);

    // At the midpoint (progress >= 0.5), perform the model swap.
    if (clampedProgress >= 0.5 && visual.currentModel) {
      if (visual.disguiseTransitionApplying && visual.disguiseAssetPath === null) {
        // Save the real model and load the disguise model.
        visual.realModel = visual.currentModel;
        visual.realAssetPath = visual.assetPath;
        visual.currentModel.visible = false;

        // Construct disguise asset path from the template name.
        const disguisePath = this.buildDisguiseAssetPath(visual.disguiseTemplateName!);
        if (disguisePath) {
          visual.disguiseAssetPath = disguisePath;
          this.loadDisguiseModel(visual, disguisePath);
        }
      } else if (!visual.disguiseTransitionApplying && visual.realModel) {
        // Restore the real model.
        if (visual.currentModel !== visual.realModel) {
          visual.currentModel.visible = false;
          if (visual.currentModel.parent) {
            visual.currentModel.parent.remove(visual.currentModel);
          }
        }
        visual.realModel.visible = true;
        visual.currentModel = visual.realModel;
        visual.assetPath = visual.realAssetPath;
        visual.realModel = null;
        visual.realAssetPath = null;
        visual.disguiseAssetPath = null;
      }
    }

    // Apply opacity to the visible model.
    this.setModelOpacity(visual, opacity);

    // Complete transition.
    if (clampedProgress >= 1.0) {
      visual.disguiseTransitioning = false;
      visual.disguiseTransitionProgress = 0;
      this.setModelOpacity(visual, 1.0);
    }
  }

  /**
   * Build a disguise asset path from a template name.
   * Uses the same naming convention as real assets: lowercase template name.
   */
  private buildDisguiseAssetPath(templateName: string): string | null {
    if (!templateName) return null;
    // Try the same asset resolution as normal entities — look for GLB/GLTF
    // using the template name as the base path.
    const baseName = templateName.toLowerCase();
    const ext = this.config.modelExtensions?.[0] ?? '.glb';
    return `${baseName}${ext}`;
  }

  /**
   * Load a disguise model and swap it into the visual once loaded.
   */
  private loadDisguiseModel(visual: VisualAssetState, assetPath: string): void {
    const loadToken = ++visual.modelSwapLoadToken;
    void (async () => {
      for (const candidate of this.resolveCandidateAssetPaths(assetPath)) {
        try {
          const source = await this.loadModelAsset(candidate);
          // Verify this visual still wants this disguise.
          if (visual.modelSwapLoadToken !== loadToken) return;
          if (visual.disguiseAssetPath !== assetPath) return;

          const clone = source.scene.clone(true);
          this.applyGuardBandFrustumPolicy(clone);
          clone.traverse((child) => {
            child.castShadow = true;
            child.receiveShadow = true;
          });

          // Show the disguise model, hide the real model.
          if (visual.realModel) {
            visual.realModel.visible = false;
          }
          visual.root.add(clone);
          visual.currentModel = clone;

          // Apply current transition opacity.
          const clampedProgress = Math.min(visual.disguiseTransitionProgress, 1.0);
          const opacity = Math.abs(1.0 - clampedProgress * 2.0);
          this.setModelOpacity(visual, opacity);
          return;
        } catch {
          // Try next candidate.
        }
      }
      // If all candidates fail, just keep the real model visible.
      if (visual.realModel) {
        visual.realModel.visible = true;
        visual.currentModel = visual.realModel;
      }
    })();
  }

  /**
   * Set opacity on the current visible model during disguise transitions.
   */
  private setModelOpacity(visual: VisualAssetState, opacity: number): void {
    if (!visual.currentModel) return;
    visual.currentModel.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      // Clone materials if needed (same pattern as stealth opacity).
      // Save original transparency state so inherently transparent materials
      // (alphaMode BLEND/MASK) are correctly restored when the transition ends.
      if (!visual.stealthMaterialClones.has(mesh)) {
        const cloneAndSaveAlpha = (m: THREE.Material): THREE.Material => {
          const clonedMat = m.clone();
          visual.originalMaterialAlpha.set(clonedMat, {
            transparent: m.transparent,
            depthWrite: m.depthWrite,
            opacity: 'opacity' in m ? (m as THREE.MeshStandardMaterial).opacity : 1.0,
          });
          return clonedMat;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => cloneAndSaveAlpha(m));
        } else {
          mesh.material = cloneAndSaveAlpha(mesh.material);
        }
        visual.stealthMaterialClones.set(mesh, mesh.material);
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if ('opacity' in mat) {
          const orig = visual.originalMaterialAlpha.get(mat);
          const wantTransparent = opacity < 0.99 || (orig?.transparent ?? false);
          if (mat.transparent !== wantTransparent) {
            mat.transparent = wantTransparent;
            mat.needsUpdate = true;
          }
          mat.depthWrite = opacity < 0.99 ? false : (orig?.depthWrite ?? true);
          mat.opacity = opacity < 0.99 ? opacity : (orig?.opacity ?? 1.0);
        }
      }
    });
  }

  private collectCandidateAssetPaths(state: RenderableEntityState): string[] {
    const primaryPath = this.selectAssetPath(state.renderAssetPath, state.renderAssetResolved);
    if (!primaryPath) {
      return [];
    }

    const requested: string[] = [];
    const seen = new Set<string>();
    const pushCandidates = (rawCandidate: string): void => {
      for (const candidate of this.resolveCandidateAssetPaths(rawCandidate)) {
        if (!candidate || seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        requested.push(candidate);
      }
    };

    pushCandidates(primaryPath);
    for (const candidate of state.renderAssetCandidates ?? []) {
      const token = candidate.trim();
      if (!token || token.toUpperCase() === 'NONE') {
        continue;
      }
      if (token.toUpperCase() === primaryPath.toUpperCase()) {
        continue;
      }
      pushCandidates(token);
    }

    return requested;
  }

  private resolveAnimationClipCandidates(
    renderAnimationStateClips?: Partial<Record<RenderableAnimationState, string[]>>,
  ): Record<RenderableAnimationState, string[]> {
    const next: Record<RenderableAnimationState, string[]> = {
      IDLE: [...CLIP_HINTS_BY_STATE.IDLE],
      MOVE: [...CLIP_HINTS_BY_STATE.MOVE],
      ATTACK: [...CLIP_HINTS_BY_STATE.ATTACK],
      DIE: [...CLIP_HINTS_BY_STATE.DIE],
      PRONE: [...CLIP_HINTS_BY_STATE.PRONE],
    };

    if (!renderAnimationStateClips) {
      return next;
    }

    for (const stateKey of Object.keys(next) as RenderableAnimationState[]) {
      const sourceCandidates = renderAnimationStateClips[stateKey];
      if (!sourceCandidates || sourceCandidates.length === 0) {
        continue;
      }
      const dedupedCandidates: string[] = [];
      const seen = new Set<string>();
      for (const rawCandidate of sourceCandidates) {
        const trimmed = rawCandidate.trim();
        if (!trimmed || seen.has(trimmed.toUpperCase())) {
          continue;
        }
        seen.add(trimmed.toUpperCase());
        dedupedCandidates.push(trimmed);
      }
      if (dedupedCandidates.length > 0) {
        const fallback = CLIP_HINTS_BY_STATE[stateKey];
        const merged = [...dedupedCandidates];
        const seen = new Set(dedupedCandidates.map((candidate) => candidate.toUpperCase()));
        for (const fallbackCandidate of fallback) {
          if (!seen.has(fallbackCandidate.toUpperCase())) {
            merged.push(fallbackCandidate);
            seen.add(fallbackCandidate.toUpperCase());
          }
        }
        next[stateKey] = merged;
      }
    }

    return next;
  }

  private updatePlaceholderVisibility(entityId: number, visible: boolean): void {
    const visual = this.visuals.get(entityId);
    if (!visual) {
      return;
    }
    this.syncPlaceholder(visual, entityId, visible);
  }

  private removeVisual(entityId: number, visual: VisualAssetState): void {
    this.removeModel(visual);
    visual.healthBarGroup = null;
    visual.healthBarFill = null;
    visual.selectionRing = null;
    visual.scriptFlashRing = null;
    if (visual.veterancyBadge) {
      this.disposeObject3D(visual.veterancyBadge);
    }
    visual.veterancyBadge = null;
    visual.currentVeterancyLevel = 0;
    if (visual.statusEffectGroup) {
      this.disposeObject3D(visual.statusEffectGroup);
      visual.statusEffectGroup = null;
      visual.activeStatusEffects = [];
    }
    if (visual.shadowDecal) {
      this.disposeObject3D(visual.shadowDecal);
      visual.shadowDecal = null;
    }
    visual.shadowType = null;
    this.scene.remove(visual.root);
    visual.root.clear();
    visual.activeState = null;
    visual.assetPath = null;
    visual.loadToken += 1;
    this.visuals.delete(entityId);
    this.unresolvedEntityIds.delete(entityId);
  }

  private removeModel(visual: VisualAssetState): void {
    if (visual.mixer) {
      visual.mixer.stopAllAction();
      if (visual.currentModel) {
        visual.mixer.uncacheRoot(visual.currentModel);
      }
      visual.mixer = null;
    }
    visual.actions.clear();
    visual.activeState = null;
    visual.turretBones = [];
    visual.conditionAction = null;
    visual.conditionClipActions.clear();
    visual.activeConditionKey = null;
    visual.sourceAnimations = [];
    visual.treadMeshes = [];
    visual.treadUVOffset = 0;
    visual.cachedActiveFlags.clear();
    visual.cachedActiveFlagsKey = '';
    visual.cachedFilteredFlags.clear();
    visual.cachedFilteredFlagsKey = '';
    visual.isInTransition = false;
    visual.transitionTargetConditionKey = null;
    visual.transitionFromKey = null;
    visual.transitionTargetMatch = null;
    visual.idleVariantIndex = -1;
    visual.idleVariantElapsed = 0;
    visual.alternateModelCache.clear();
    visual.currentModelName = null;
    visual.modelSwapLoadToken = 0;
    visual.conditionAnimSpeedFactor = 1.0;

    if (visual.currentModel !== null) {
      visual.root.remove(visual.currentModel);
      this.disposeObject3D(visual.currentModel);
      visual.currentModel = null;
      visual.appliedTeamColorSide = null;
    }
  }

  private applyAnimationState(visual: VisualAssetState, animationState: RenderableAnimationState): void {
    if (!visual.mixer || visual.actions.size === 0) {
      return;
    }

    if (visual.activeState === animationState) {
      return;
    }

    const nextAction = visual.actions.get(animationState);
    if (!nextAction) {
      return;
    }

    const previousAction = visual.activeState === null
      ? null
      : visual.actions.get(visual.activeState) ?? null;

    if (previousAction) {
      previousAction.fadeOut(0.1);
      previousAction.enabled = false;
    }

    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setLoop(THREE.LoopRepeat, Infinity);
    nextAction.play();
    if (previousAction) {
      nextAction.crossFadeFrom(previousAction, 0.1, true);
    }
    visual.activeState = animationState;
  }

  // ==========================================================================
  // Asset loading and parsing
  // ==========================================================================

  private async loadModelAsset(assetPath: string): Promise<LoadedModelAsset> {
    const cached = this.modelCache.get(assetPath);
    if (cached) {
      return cached;
    }

    const existingPromise = this.modelLoadPromises.get(assetPath);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.enqueueModelLoad(assetPath);
    this.modelLoadPromises.set(assetPath, promise);
    return promise;
  }

  /**
   * Queue a model load request, respecting the concurrent load limit.
   * When a slot is available the request proceeds immediately; otherwise
   * it waits in the queue until a running load completes.
   */
  private enqueueModelLoad(assetPath: string): Promise<LoadedModelAsset> {
    if (this.activeModelLoads < ObjectVisualManager.MAX_CONCURRENT_MODEL_LOADS) {
      return this.executeModelLoad(assetPath);
    }
    return new Promise<LoadedModelAsset>((resolve, reject) => {
      this.modelLoadQueue.push({ assetPath, resolve, reject });
    });
  }

  private async executeModelLoad(assetPath: string): Promise<LoadedModelAsset> {
    this.activeModelLoads++;
    try {
      const result = await this.modelLoader(assetPath);
      const loaded: LoadedModelAsset = {
        scene: result.scene,
        animations: result.animations,
      };
      this.modelCache.set(assetPath, loaded);
      this.modelLoadPromises.delete(assetPath);
      return loaded;
    } catch (error) {
      this.modelLoadPromises.delete(assetPath);
      throw error;
    } finally {
      this.activeModelLoads--;
      this.drainModelLoadQueue();
    }
  }

  private drainModelLoadQueue(): void {
    while (
      this.modelLoadQueue.length > 0 &&
      this.activeModelLoads < ObjectVisualManager.MAX_CONCURRENT_MODEL_LOADS
    ) {
      const next = this.modelLoadQueue.shift()!;
      this.executeModelLoad(next.assetPath).then(next.resolve, next.reject);
    }
  }

  private createDefaultModelLoader(assetPath: string): Promise<LoadedModelAsset> {
    if (!this.assetManager) {
      throw new Error('ObjectVisualManager model loader requires an AssetManager.');
    }
    // Try manifest basename resolution as a fallback if the literal path fails.
    const resolvedPath = this.assetManager.resolveModelPath?.(assetPath) ?? assetPath;
    return this.assetManager.loadArrayBuffer(resolvedPath).then((handle) => {
      return this.parseGltfAsset(handle.data, resolvedPath);
    });
  }

  private resolveShadowTextureOutputPaths(textureName: string): string[] {
    const normalized = textureName.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const fallbackPaths = [
      `textures/Art/Textures/${normalized}.rgba`,
      `textures/TexturesZH/Art/Textures/${normalized}.rgba`,
    ];

    const manifest = this.assetManager?.getManifest();
    if (!manifest) {
      return fallbackPaths;
    }

    const matches = manifest.raw.entries
      .map((entry) => entry.outputPath)
      .filter((outputPath) => outputPath.toLowerCase().endsWith(`/${normalized}.rgba`));

    return matches.length > 0 ? matches : fallbackPaths;
  }

  private loadShadowTexture(textureName: string): Promise<THREE.Texture | null> {
    const normalized = textureName.trim().toLowerCase();
    if (!this.assetManager || !normalized) {
      return Promise.resolve(null);
    }

    const cached = this.shadowTexturePromises.get(normalized);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      for (const outputPath of this.resolveShadowTextureOutputPaths(normalized)) {
        try {
          const handle = await this.assetManager!.loadArrayBuffer(outputPath);
          return createShadowDecalTexture(handle.data);
        } catch {
          // Try the next source-truth candidate.
        }
      }
      return null;
    })().catch(() => null);

    this.shadowTexturePromises.set(normalized, promise);
    return promise;
  }

  private syncShadowTexture(
    visual: VisualAssetState,
    state: RenderableEntityState,
    shadowType: ReturnType<typeof parseObjectShadowType>,
  ): void {
    if (!visual.shadowDecal) {
      return;
    }

    const requestedTextureKey = (state.shadowTextureName?.trim() || 'shadow').toLowerCase();
    const material = visual.shadowDecal.material as THREE.MeshBasicMaterial;
    applyShadowDecalMaterialMode(material, shadowType);

    if (visual.shadowTextureKey === requestedTextureKey) {
      return;
    }

    visual.shadowTextureKey = requestedTextureKey;
    visual.shadowTextureLoadToken += 1;
    const loadToken = visual.shadowTextureLoadToken;
    material.map = null;
    material.needsUpdate = true;
    visual.shadowDecal.visible = false;

    void this.loadShadowTexture(requestedTextureKey).then((texture) => {
      if (!visual.shadowDecal || visual.shadowTextureLoadToken !== loadToken) {
        return;
      }

      const currentMaterial = visual.shadowDecal.material as THREE.MeshBasicMaterial;
      currentMaterial.map = texture;
      applyShadowDecalMaterialMode(currentMaterial, shadowType);
      visual.shadowDecal.visible = texture !== null;
    });
  }

  private parseGltfAsset(data: ArrayBuffer, path: string): Promise<LoadedModelAsset> {
    return new Promise<LoadedModelAsset>((resolve, reject) => {
      this.gltfLoader.parse(
        data,
        path,
        (gltf) => {
          // Convert MeshStandardMaterial → MeshLambertMaterial.
          // PBR materials appear very dark without an environment map because
          // MeshStandardMaterial relies on image-based lighting for correct
          // brightness. MeshLambertMaterial uses simple diffuse shading that
          // works well with our directional + ambient light setup.
          gltf.scene.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const convertMat = (mat: THREE.Material): THREE.Material => {
              const std = mat as THREE.MeshStandardMaterial;
              if (!std.isMeshStandardMaterial) return mat;
              const lambert = new THREE.MeshLambertMaterial();
              lambert.name = std.name;
              lambert.map = std.map;
              lambert.color.copy(std.color);
              lambert.emissive.copy(std.emissive);
              lambert.emissiveMap = std.emissiveMap;
              lambert.emissiveIntensity = std.emissiveIntensity;
              lambert.alphaMap = std.alphaMap;
              lambert.alphaTest = std.alphaTest;
              lambert.opacity = std.opacity;
              lambert.transparent = std.transparent;
              lambert.side = std.side;
              lambert.depthWrite = std.depthWrite;
              lambert.visible = std.visible;
              std.dispose();
              return lambert;
            };
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map(convertMat);
            } else {
              mesh.material = convertMat(mesh.material);
            }
          });
          resolve({
            scene: gltf.scene,
            animations: gltf.animations,
          });
        },
        reject,
      );
    });
  }

  private findMatchingClip(
    clips: readonly THREE.AnimationClip[],
    candidates: readonly string[],
  ): THREE.AnimationClip | null {
    for (const candidate of candidates) {
      const found = clips.find((clip) => clip.name.toLowerCase() === candidate.toLowerCase())
        || clips.find((clip) => clip.name.toLowerCase().includes(candidate.toLowerCase()));
      if (found) {
        return found;
      }
    }
    return null;
  }

  private resolveCandidateAssetPaths(rawPath: string): string[] {
    const normalized = rawPath
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/{2,}/g, '/');
    if (!normalized) {
      return [];
    }

    const segments = normalized.split('/');
    const filename = segments[segments.length - 1] ?? '';
    const extensionMatch = filename.match(/\.([A-Za-z0-9]+)$/);
    const extension = extensionMatch?.[1]?.toLowerCase();

    const candidates: string[] = [];
    const pushed = new Set<string>();
    const push = (candidate: string): void => {
      const cleaned = candidate.trim();
      if (!cleaned || pushed.has(cleaned)) return;
      pushed.add(cleaned);
      candidates.push(cleaned);
    };

    // Try manifest-based basename resolution first (handles bare names like "AVThundrblt_D1").
    if (this.assetManager) {
      const resolved = this.assetManager.resolveModelPath?.(normalized) ?? null;
      if (resolved) {
        push(resolved);
      }

      // Condition-state suffix fallback: when the exact name (e.g. "PMgaldrum_D")
      // is not in the manifest, strip the W3D condition suffix (uppercase letters
      // after the last underscore, e.g. _D, _AD, _DNS, _ACE) and try the base
      // model name. This mirrors the original C++ engine behaviour which falls
      // back to the base model when a specific condition variant doesn't exist.
      if (candidates.length === 0) {
        const baseName = stripConditionStateSuffix(normalized);
        if (baseName !== null) {
          const fallback = this.assetManager.resolveModelPath?.(baseName) ?? null;
          if (fallback) {
            push(fallback);
          }
        }
      }
    }

    if (!extension) {
      for (const ext of this.config.modelExtensions) {
        push(`${normalized}${ext}`);
      }
      // Condition-state suffix fallback for extension-based candidates.
      const baseName = stripConditionStateSuffix(normalized);
      if (baseName !== null) {
        for (const ext of this.config.modelExtensions) {
          push(`${baseName}${ext}`);
        }
      }
      return candidates;
    }

    if (extension === 'w3d') {
      push(normalized.replace(/\.w3d$/i, '.gltf'));
      push(normalized.replace(/\.w3d$/i, '.glb'));
    } else {
      push(normalized);
    }

    return candidates;
  }

  private selectAssetPath(renderAssetPath: string | null, renderAssetResolved: boolean): string | null {
    if (!renderAssetResolved) {
      return null;
    }
    const trimmed = renderAssetPath?.trim() ?? '';
    if (!trimmed || trimmed.toUpperCase() === 'NONE') {
      return null;
    }
    return trimmed;
  }

  // ==========================================================================
  // Health bars and selection rings
  // ==========================================================================

  private static readonly HEALTH_BAR_WIDTH = 2.0;
  private static readonly HEALTH_BAR_HEIGHT = 0.15;
  private static readonly HEALTH_BAR_Y_OFFSET = 2.5;
  private static readonly SELECTION_RING_RADIUS = 1.2;
  private static readonly SCRIPT_FLASH_RING_RADIUS = 1.38;
  private static readonly SELECTION_RING_SEGMENTS = 48;

  private static healthBarBgGeometry: THREE.PlaneGeometry | null = null;
  private static healthBarFillGeometry: THREE.PlaneGeometry | null = null;
  private static selectionRingGeometry: THREE.RingGeometry | null = null;
  private static scriptFlashRingGeometry: THREE.RingGeometry | null = null;

  private static getHealthBarBgGeometry(): THREE.PlaneGeometry {
    if (!ObjectVisualManager.healthBarBgGeometry) {
      ObjectVisualManager.healthBarBgGeometry = new THREE.PlaneGeometry(
        ObjectVisualManager.HEALTH_BAR_WIDTH,
        ObjectVisualManager.HEALTH_BAR_HEIGHT,
      );
    }
    return ObjectVisualManager.healthBarBgGeometry;
  }

  private static getHealthBarFillGeometry(): THREE.PlaneGeometry {
    if (!ObjectVisualManager.healthBarFillGeometry) {
      ObjectVisualManager.healthBarFillGeometry = new THREE.PlaneGeometry(1, 1);
    }
    return ObjectVisualManager.healthBarFillGeometry;
  }

  private static getSelectionRingGeometry(): THREE.RingGeometry {
    if (!ObjectVisualManager.selectionRingGeometry) {
      ObjectVisualManager.selectionRingGeometry = new THREE.RingGeometry(
        ObjectVisualManager.SELECTION_RING_RADIUS - 0.06,
        ObjectVisualManager.SELECTION_RING_RADIUS,
        ObjectVisualManager.SELECTION_RING_SEGMENTS,
      );
    }
    return ObjectVisualManager.selectionRingGeometry;
  }

  private static getScriptFlashRingGeometry(): THREE.RingGeometry {
    if (!ObjectVisualManager.scriptFlashRingGeometry) {
      ObjectVisualManager.scriptFlashRingGeometry = new THREE.RingGeometry(
        ObjectVisualManager.SCRIPT_FLASH_RING_RADIUS - 0.08,
        ObjectVisualManager.SCRIPT_FLASH_RING_RADIUS,
        ObjectVisualManager.SELECTION_RING_SEGMENTS,
      );
    }
    return ObjectVisualManager.scriptFlashRingGeometry;
  }

  private static healthColorForRatio(ratio: number): number {
    if (ratio > 0.5) return 0x00cc00; // green
    if (ratio > 0.25) return 0xcccc00; // yellow
    return 0xcc0000; // red
  }

  private syncHealthBar(visual: VisualAssetState, state: RenderableEntityState): void {
    const maxHealth = state.maxHealth ?? 0;
    const health = state.health ?? 0;
    const constructionPct = state.constructionPercent ?? -1;
    const isUnderConstruction = constructionPct >= 0 && constructionPct < 100;
    const showBar = isUnderConstruction
      ? maxHealth > 0
      : maxHealth > 0 && health > 0 && health < maxHealth;

    if (!showBar) {
      if (visual.healthBarGroup) {
        visual.healthBarGroup.visible = false;
      }
      return;
    }

    if (!visual.healthBarGroup) {
      const group = new THREE.Group();
      group.name = 'health-bar';

      // Background (dark)
      const bgMaterial = new THREE.MeshBasicMaterial({
        color: 0x111111,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const bgMesh = new THREE.Mesh(ObjectVisualManager.getHealthBarBgGeometry(), bgMaterial);
      bgMesh.renderOrder = 999;
      group.add(bgMesh);

      // Fill (colored)
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: 0x00cc00,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const fillMesh = new THREE.Mesh(ObjectVisualManager.getHealthBarFillGeometry(), fillMaterial);
      fillMesh.renderOrder = 1000;
      group.add(fillMesh);

      visual.healthBarGroup = group;
      visual.healthBarFill = fillMesh;
      visual.root.add(group);
      this.applyGuardBandFrustumPolicy(group);
    }

    const ratio = isUnderConstruction
      ? Math.max(0, Math.min(1, constructionPct / 100))
      : Math.max(0, Math.min(1, health / maxHealth));
    const barWidth = ObjectVisualManager.HEALTH_BAR_WIDTH;
    const barHeight = ObjectVisualManager.HEALTH_BAR_HEIGHT;
    const fillWidth = barWidth * ratio;

    visual.healthBarGroup.visible = true;
    visual.healthBarGroup.position.set(0, ObjectVisualManager.HEALTH_BAR_Y_OFFSET, 0);

    // Billboard: cancel parent rotation so bar always faces camera.
    visual.healthBarGroup.rotation.y = -state.rotationY;

    if (visual.healthBarFill) {
      visual.healthBarFill.scale.set(fillWidth, barHeight, 1);
      visual.healthBarFill.position.set((fillWidth - barWidth) / 2, 0, 0.001);
      const mat = visual.healthBarFill.material as THREE.MeshBasicMaterial;
      mat.color.setHex(isUnderConstruction ? 0xffcc00 : ObjectVisualManager.healthColorForRatio(ratio));
    }
  }

  /** Selection circle color: own units. Source parity: green circle in retail. */
  private static readonly SEL_COLOR_OWN = 0x00ff00;
  /** Selection circle color: own units in guard mode — blue-tinted green. */
  private static readonly SEL_COLOR_OWN_GUARDING = 0x3399ff;
  /** Selection circle color: enemy/neutral units. Source parity: red circle. */
  private static readonly SEL_COLOR_ENEMY = 0xff3333;
  /** Default radius when INI MajorRadius is not available. */
  private static readonly SEL_DEFAULT_RADIUS = 1;
  /** Duration (seconds) of the initial pulse animation on selection. */
  private static readonly SEL_PULSE_DURATION = 0.25;
  /** Scale overshoot factor during pulse. */
  private static readonly SEL_PULSE_OVERSHOOT = 1.15;

  private syncSelectionRing(visual: VisualAssetState, state: RenderableEntityState): void {
    const isSelected = state.isSelected ?? false;

    if (!isSelected) {
      if (visual.selectionRing) {
        visual.selectionRing.visible = false;
        visual.selectionRingSpawnTime = -1;
      }
      return;
    }

    // Determine desired color from ownership (blue-tinted when guarding).
    const isOwn = state.isOwnedByLocalPlayer ?? false;
    const isGuarding = state.isGuarding ?? false;
    const desiredColor = isOwn
      ? (isGuarding ? ObjectVisualManager.SEL_COLOR_OWN_GUARDING : ObjectVisualManager.SEL_COLOR_OWN)
      : ObjectVisualManager.SEL_COLOR_ENEMY;

    // Determine desired scale from INI MajorRadius.
    const radius = state.selectionCircleRadius ?? ObjectVisualManager.SEL_DEFAULT_RADIUS;
    const desiredScale = radius;

    if (!visual.selectionRing) {
      const material = new THREE.MeshBasicMaterial({
        color: desiredColor,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ObjectVisualManager.getSelectionRingGeometry(), material);
      ring.renderOrder = 998;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.name = 'selection-ring';
      visual.selectionRing = ring;
      visual.selectionRingColorHex = desiredColor;
      visual.selectionRingScale = desiredScale;
      visual.selectionRingSpawnTime = this.accumulatedTime;
      ring.scale.setScalar(desiredScale);
      visual.root.add(ring);
      this.applyGuardBandFrustumPolicy(ring);
    }

    // Update color if ownership changed.
    if (visual.selectionRingColorHex !== desiredColor) {
      (visual.selectionRing.material as THREE.MeshBasicMaterial).color.setHex(desiredColor);
      visual.selectionRingColorHex = desiredColor;
    }

    // Update scale if radius changed.
    if (visual.selectionRingScale !== desiredScale) {
      visual.selectionRing.scale.setScalar(desiredScale);
      visual.selectionRingScale = desiredScale;
    }

    // Pulse animation on fresh selection.
    if (visual.selectionRingSpawnTime >= 0) {
      const elapsed = this.accumulatedTime - visual.selectionRingSpawnTime;
      if (elapsed < ObjectVisualManager.SEL_PULSE_DURATION) {
        const t = elapsed / ObjectVisualManager.SEL_PULSE_DURATION;
        // Ease-out overshoot: peaks at SEL_PULSE_OVERSHOOT then settles to 1.0.
        const overshoot = 1 + (ObjectVisualManager.SEL_PULSE_OVERSHOOT - 1) * Math.sin(t * Math.PI);
        visual.selectionRing.scale.setScalar(desiredScale * overshoot);
      } else {
        visual.selectionRing.scale.setScalar(desiredScale);
        visual.selectionRingSpawnTime = -1;
      }
    }

    visual.selectionRing.visible = true;
  }

  private syncScriptFlashRing(visual: VisualAssetState, state: RenderableEntityState): void {
    const flashCount = state.scriptFlashCount ?? 0;
    const shouldShow = flashCount > 0 && flashCount % 2 === 1;
    if (!shouldShow) {
      if (visual.scriptFlashRing) {
        visual.scriptFlashRing.visible = false;
      }
      return;
    }

    const flashColor = (state.scriptFlashColor ?? 0xffffff) & 0xffffff;
    if (!visual.scriptFlashRing) {
      const material = new THREE.MeshBasicMaterial({
        color: flashColor,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ObjectVisualManager.getScriptFlashRingGeometry(), material);
      ring.renderOrder = 997;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      ring.name = 'script-flash-ring';
      visual.scriptFlashRing = ring;
      visual.root.add(ring);
      this.applyGuardBandFrustumPolicy(ring);
    }

    const material = visual.scriptFlashRing.material as THREE.MeshBasicMaterial;
    material.color.setHex(flashColor);
    visual.scriptFlashRing.visible = true;
  }

  // Shared geometry for veterancy chevrons.
  private static veterancyChevronGeometry: THREE.BufferGeometry | null = null;
  private static getVeterancyChevronGeometry(): THREE.BufferGeometry {
    if (!ObjectVisualManager.veterancyChevronGeometry) {
      // Small diamond/chevron shape.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.12);
      shape.lineTo(0.08, 0);
      shape.lineTo(0, -0.12);
      shape.lineTo(-0.08, 0);
      shape.closePath();
      ObjectVisualManager.veterancyChevronGeometry = new THREE.ShapeGeometry(shape);
    }
    return ObjectVisualManager.veterancyChevronGeometry;
  }

  private static readonly VETERANCY_COLORS = [
    0x000000, // level 0: none
    0x44cc44, // level 1: Veteran (green)
    0x4488ff, // level 2: Elite (blue)
    0xffcc00, // level 3: Heroic (gold)
  ];

  private syncVeterancyBadge(visual: VisualAssetState, state: RenderableEntityState): void {
    const level = state.veterancyLevel ?? 0;

    if (level <= 0) {
      if (visual.veterancyBadge) {
        visual.veterancyBadge.visible = false;
      }
      return;
    }

    // Rebuild badge if level changed.
    if (visual.currentVeterancyLevel !== level) {
      // Trigger gold promotion flash when veterancy increases (not on initial spawn).
      if (level > visual.currentVeterancyLevel && visual.currentVeterancyLevel > 0) {
        visual.veterancyFlashEndTime = this.accumulatedTime + 0.3;
      }
      if (visual.veterancyBadge) {
        this.disposeObject3D(visual.veterancyBadge);
        visual.root.remove(visual.veterancyBadge);
        visual.veterancyBadge = null;
      }
      visual.currentVeterancyLevel = level;
    }

    if (!visual.veterancyBadge) {
      const group = new THREE.Group();
      group.name = 'veterancy-badge';
      const chevronGeo = ObjectVisualManager.getVeterancyChevronGeometry();
      const color = ObjectVisualManager.VETERANCY_COLORS[Math.min(level, 3)] ?? 0xffcc00;

      // Place 1-3 chevrons based on level.
      const count = Math.min(level, 3);
      const spacing = 0.2;
      const startX = -(count - 1) * spacing * 0.5;

      for (let i = 0; i < count; i++) {
        const material = new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          depthTest: false,
        });
        const chevron = new THREE.Mesh(chevronGeo, material);
        chevron.position.x = startX + i * spacing;
        group.add(chevron);
      }

      group.position.y = 4.2; // Above the health bar.
      group.renderOrder = 1001;
      visual.veterancyBadge = group;
      visual.root.add(group);
      this.applyGuardBandFrustumPolicy(group);
    }

    visual.veterancyBadge.visible = true;

    // Billboard effect: face camera.
    if (visual.veterancyBadge) {
      visual.veterancyBadge.rotation.y = -visual.root.rotation.y;
    }
  }

  /**
   * Status effect icon color mapping.
   * Source parity: InGameUI draws small colored diamonds above affected units.
   */
  private static readonly STATUS_EFFECT_COLORS: Record<string, number> = {
    POISONED: 0x44ff44,
    POISONED_BETA: 0x88ff00,
    BURNING: 0xff4400,
    DISABLED_EMP: 0x4488ff,
    DISABLED_UNDERPOWERED: 0xffcc00,
    DISABLED_HELD: 0xcc44cc,
  };

  /** Known status effects that get visual indicators. */
  private static readonly VISIBLE_STATUS_EFFECTS = new Set(
    Object.keys(ObjectVisualManager.STATUS_EFFECT_COLORS),
  );

  private static statusEffectIconGeometry: THREE.BufferGeometry | null = null;
  private static getStatusEffectIconGeometry(): THREE.BufferGeometry {
    if (!ObjectVisualManager.statusEffectIconGeometry) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.08);
      shape.lineTo(0.06, 0);
      shape.lineTo(0, -0.08);
      shape.lineTo(-0.06, 0);
      shape.closePath();
      ObjectVisualManager.statusEffectIconGeometry = new THREE.ShapeGeometry(shape);
    }
    return ObjectVisualManager.statusEffectIconGeometry;
  }

  private syncStatusEffects(visual: VisualAssetState, state: RenderableEntityState): void {
    const effects = state.statusEffects ?? [];
    const visible = effects.filter(e => ObjectVisualManager.VISIBLE_STATUS_EFFECTS.has(e));

    if (visible.length === 0) {
      if (visual.statusEffectGroup) {
        visual.statusEffectGroup.visible = false;
      }
      return;
    }

    // Rebuild if the set of active effects changed.
    const changed =
      visual.activeStatusEffects.length !== visible.length ||
      visual.activeStatusEffects.some((e, i) => e !== visible[i]);

    if (changed) {
      if (visual.statusEffectGroup) {
        this.disposeObject3D(visual.statusEffectGroup);
        visual.root.remove(visual.statusEffectGroup);
        visual.statusEffectGroup = null;
      }
      visual.activeStatusEffects = visible;
    }

    if (!visual.statusEffectGroup) {
      const group = new THREE.Group();
      group.name = 'status-effects';
      const geo = ObjectVisualManager.getStatusEffectIconGeometry();
      const spacing = 0.16;
      const startX = -(visible.length - 1) * spacing * 0.5;

      for (let i = 0; i < visible.length; i++) {
        const color =
          ObjectVisualManager.STATUS_EFFECT_COLORS[visible[i]!] ?? 0xffffff;
        const material = new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          depthTest: false,
        });
        const icon = new THREE.Mesh(geo, material);
        icon.position.x = startX + i * spacing;
        group.add(icon);
      }

      // Position above health bar / veterancy.
      group.position.y = 2.2;
      group.renderOrder = 1002;
      visual.statusEffectGroup = group;
      visual.root.add(group);
      this.applyGuardBandFrustumPolicy(group);
    }

    visual.statusEffectGroup.visible = true;
    // Billboard effect.
    visual.statusEffectGroup.rotation.y = -visual.root.rotation.y;
  }

  // ---- Team color mapping ----
  // Source parity: C++ W3DAssetManager checks mesh names starting with
  // "HOUSECOLOR" (case-insensitive, after the '.' separator in HLOD names
  // like "MODEL.HOUSECOLOR01") and recolors only those meshes with the
  // player's team color.  Non-house-color meshes retain their original
  // textures.  For models that lack any HOUSECOLOR meshes we fall back to
  // a subtle emissive tint so players can still distinguish sides.
  private static readonly TEAM_COLORS: Record<string, number> = {
    america: 0x3366cc,   // Blue (USA)
    china: 0xcc3333,     // Red (China)
    gla: 0x33aa33,       // Green (GLA)
  };

  /**
   * Check whether a mesh/node name designates a house-color region.
   * Source parity: C++ uses `_strnicmp(meshName,"HOUSECOLOR", 10) == 0`
   * where meshName is the portion after the '.' in HLOD compound names,
   * or the full name for standalone meshes.
   */
  private static isHouseColorMesh(name: string): boolean {
    if (!name) return false;
    // HLOD sub-object names use "MODELNAME.MESHNAME" format.
    const dotIdx = name.lastIndexOf('.');
    const localName = dotIdx >= 0 ? name.substring(dotIdx + 1) : name;
    return localName.toUpperCase().startsWith('HOUSECOLOR');
  }

  /**
   * Check whether a model has any house-color meshes.
   */
  private static modelHasHouseColorMeshes(model: THREE.Object3D): boolean {
    let found = false;
    model.traverse((child) => {
      if (found) return;
      if ((child as THREE.Mesh).isMesh && ObjectVisualManager.isHouseColorMesh(child.name)) {
        found = true;
      }
    });
    return found;
  }

  /**
   * Apply team color to model meshes based on entity side.
   *
   * Source parity: only meshes whose names start with "HOUSECOLOR" get
   * recolored.  For those meshes the material base color is replaced
   * entirely with the team color (strong, opaque recolor).  All other
   * meshes are left untouched.
   *
   * Fallback: if the model contains no HOUSECOLOR meshes, a subtle
   * emissive tint is applied to all meshes so players can still
   * distinguish sides during gameplay.
   */
  private syncTeamColor(visual: VisualAssetState, state: RenderableEntityState): void {
    const side = state.side?.toLowerCase() ?? null;
    if (!visual.currentModel || side === visual.appliedTeamColorSide) {
      return;
    }
    visual.appliedTeamColorSide = side;

    const colorHex = side ? (ObjectVisualManager.TEAM_COLORS[side] ?? null) : null;
    if (colorHex === null) {
      // Clear any previously applied tint for neutral/civilian/unknown sides.
      this.clearTeamColor(visual);
      return;
    }

    const tintColor = new THREE.Color(colorHex);
    const hasHouseColor = ObjectVisualManager.modelHasHouseColorMeshes(visual.currentModel);

    if (hasHouseColor) {
      // Source-accurate path: recolor only HOUSECOLOR meshes.
      visual.currentModel.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!ObjectVisualManager.isHouseColorMesh(mesh.name)) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if ((stdMat.isMeshStandardMaterial || (stdMat as any).isMeshLambertMaterial)) {
            // Replace base color entirely with team color (strong recolor).
            stdMat.color.copy(tintColor);
            stdMat.emissive.copy(tintColor);
            stdMat.emissiveIntensity = 0.3;
          }
        }
      });
    } else {
      // Fallback: no HOUSECOLOR meshes — apply subtle emissive tint
      // to all meshes for gameplay visibility.
      const fallbackIntensity = 0.4;
      visual.currentModel.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if ((stdMat.isMeshStandardMaterial || (stdMat as any).isMeshLambertMaterial)) {
            stdMat.emissive.copy(tintColor);
            stdMat.emissiveIntensity = fallbackIntensity;
          }
        }
      });
    }
  }

  /**
   * Clear team color from all meshes (both house-color and fallback emissive).
   */
  private clearTeamColor(visual: VisualAssetState): void {
    if (!visual.currentModel) return;
    visual.currentModel.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of materials) {
        const stdMat = mat as THREE.MeshStandardMaterial;
        if ((stdMat.isMeshStandardMaterial || (stdMat as any).isMeshLambertMaterial)) {
          stdMat.emissiveIntensity = 0;
          // Reset house-color meshes back to white base color.
          if (ObjectVisualManager.isHouseColorMesh(mesh.name)) {
            stdMat.color.setHex(0xffffff);
          }
        }
      }
    });
  }

  /** Duration of the red damage flash in seconds. */
  private static readonly DAMAGE_FLASH_DURATION = 0.2;
  /** Red tint color for the damage flash. */
  private static readonly DAMAGE_FLASH_COLOR = new THREE.Color(0xff0000);
  /** Emissive intensity during damage flash. */
  private static readonly DAMAGE_FLASH_INTENSITY = 0.5;
  /** Gold tint color for the veterancy promotion flash. */
  private static readonly VETERANCY_FLASH_COLOR = new THREE.Color(0xffdd44);
  /** Emissive intensity for veterancy promotion flash. */
  private static readonly VETERANCY_FLASH_INTENSITY = 0.8;

  /**
   * Flash the model red briefly when health decreases.
   * Tracks lastKnownHealth to detect damage between frames.
   */
  private syncDamageFlash(visual: VisualAssetState, state: RenderableEntityState): void {
    if (!visual.currentModel) return;

    const currentHealth = state.health ?? -1;

    // Detect health decrease — trigger flash.
    if (visual.lastKnownHealth >= 0 && currentHealth >= 0 && currentHealth < visual.lastKnownHealth) {
      visual.damageFlashEndTime = this.accumulatedTime + ObjectVisualManager.DAMAGE_FLASH_DURATION;
    }
    visual.lastKnownHealth = currentHealth;

    const isDamageFlash = visual.damageFlashEndTime > 0 && this.accumulatedTime < visual.damageFlashEndTime;
    const isVetFlash = visual.veterancyFlashEndTime > 0 && this.accumulatedTime < visual.veterancyFlashEndTime;
    const isFlashing = isDamageFlash || isVetFlash;
    // Veterancy flash takes priority over damage flash.
    const flashColor = isVetFlash ? ObjectVisualManager.VETERANCY_FLASH_COLOR : ObjectVisualManager.DAMAGE_FLASH_COLOR;
    const flashIntensity = isVetFlash ? ObjectVisualManager.VETERANCY_FLASH_INTENSITY : ObjectVisualManager.DAMAGE_FLASH_INTENSITY;

    if (isFlashing) {
      visual.currentModel.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if ((stdMat.isMeshStandardMaterial || (stdMat as any).isMeshLambertMaterial)) {
            stdMat.emissive.copy(flashColor);
            stdMat.emissiveIntensity = flashIntensity;
          }
        }
      });
    } else if ((visual.damageFlashEndTime > 0 && this.accumulatedTime >= visual.damageFlashEndTime) ||
               (visual.veterancyFlashEndTime > 0 && this.accumulatedTime >= visual.veterancyFlashEndTime)) {
      // Flash just ended — restore original emissive (team color or zero).
      visual.damageFlashEndTime = -1;
      visual.veterancyFlashEndTime = -1;
      this.restoreEmissiveAfterFlash(visual, state);
    }
  }

  /**
   * Restore the emissive color after a damage flash ends.
   * Re-applies team color tint if applicable, otherwise clears emissive.
   * House-color-aware: only HOUSECOLOR meshes get the strong recolor;
   * other meshes get fallback emissive or nothing.
   */
  private restoreEmissiveAfterFlash(visual: VisualAssetState, state: RenderableEntityState): void {
    const side = state.side?.toLowerCase() ?? null;
    const colorHex = side ? (ObjectVisualManager.TEAM_COLORS[side] ?? null) : null;

    if (colorHex !== null && visual.currentModel) {
      const tintColor = new THREE.Color(colorHex);
      const hasHouseColor = ObjectVisualManager.modelHasHouseColorMeshes(visual.currentModel);

      visual.currentModel.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const isHC = ObjectVisualManager.isHouseColorMesh(mesh.name);
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if ((stdMat.isMeshStandardMaterial || (stdMat as any).isMeshLambertMaterial)) {
            if (hasHouseColor && isHC) {
              // Restore strong house-color recolor.
              stdMat.emissive.copy(tintColor);
              stdMat.emissiveIntensity = 0.3;
            } else if (hasHouseColor && !isHC) {
              // Non-house-color mesh on a model that has HC — no tint.
              stdMat.emissiveIntensity = 0;
            } else {
              // Fallback model (no HC meshes) — restore subtle emissive.
              stdMat.emissive.copy(tintColor);
              stdMat.emissiveIntensity = 0.4;
            }
          }
        }
      });
    } else {
      this.clearTeamColor(visual);
    }
  }

  /**
   * Apply stealth opacity: stealthed = semi-transparent, detected = pulsing.
   */
  private syncStealthOpacity(visual: VisualAssetState, state: RenderableEntityState): void {
    const isStealthed = state.isStealthed === true;
    const isDetected = state.isDetected === true;
    // Source parity: under-construction buildings render semi-transparent
    // and ramp up to full opacity as construction progresses.
    const constructionPct = state.constructionPercent ?? -1;
    const isUnderConstruction = constructionPct >= 0 && constructionPct < 100;
    // Source parity: selling buildings (SOLD flag) count down to demolition.
    // constructionPercent goes from 100 → -50 during sell. Show fade-out.
    const isSelling = state.modelConditionFlags?.includes('SOLD') ?? false;

    // Source parity: RUBBLE model condition — destroyed buildings render as faded rubble remnants.
    const isRubble = state.modelConditionFlags?.includes('RUBBLE') ?? false;

    let targetOpacity = 1.0;
    if (isRubble) {
      // Destroyed building rubble: semi-transparent to distinguish from live structures.
      targetOpacity = 0.5;
    } else if (isSelling) {
      // Fade out as sell countdown progresses (100 → 0 → -50)
      targetOpacity = Math.max(0.1, Math.min(0.9, constructionPct / 100));
    } else if (isUnderConstruction) {
      // Ramp from 0.3 (start) to 0.9 (near complete)
      targetOpacity = 0.3 + (constructionPct / 100) * 0.6;
    } else if (isStealthed && !isDetected && state.stealthFriendlyOpacity != null && state.stealthFriendlyOpacity < 1.0) {
      // Source parity: friendly stealthed units render at per-module friendlyOpacityMin
      targetOpacity = state.stealthFriendlyOpacity;
    } else if (isStealthed && !isDetected) {
      targetOpacity = 0.35;
    } else if (isStealthed && isDetected) {
      // Pulse between 0.4 and 0.8.
      targetOpacity = 0.6 + 0.2 * Math.sin(this.accumulatedTime * 6.0);
    }

    // Tunnel enter/exit visual transition: override opacity during fade.
    if (state.tunnelTransitionOpacity != null) {
      targetOpacity = Math.min(targetOpacity, state.tunnelTransitionOpacity);
    }

    // Skip traversal when opacity hasn't changed (within tolerance for pulsing).
    if (Math.abs(targetOpacity - visual.lastStealthOpacity) < 0.01) return;
    visual.lastStealthOpacity = targetOpacity;

    visual.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      // Clone materials on first stealth mutation to avoid mutating shared GLTF cache.
      // Save the original transparency state so we can restore it when opacity returns to 1.0
      // (materials with alphaMode BLEND/MASK, e.g. tree foliage, glass, fences, must stay transparent).
      if (!visual.stealthMaterialClones.has(mesh)) {
        const cloneAndSaveAlpha = (m: THREE.Material): THREE.Material => {
          const clonedMat = m.clone();
          visual.originalMaterialAlpha.set(clonedMat, {
            transparent: m.transparent,
            depthWrite: m.depthWrite,
            opacity: 'opacity' in m ? (m as THREE.MeshStandardMaterial).opacity : 1.0,
          });
          return clonedMat;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => cloneAndSaveAlpha(m));
        } else {
          mesh.material = cloneAndSaveAlpha(mesh.material);
        }
        visual.stealthMaterialClones.set(mesh, mesh.material);
      }

      const clonedMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of clonedMaterials) {
        if ('opacity' in mat) {
          const orig = visual.originalMaterialAlpha.get(mat);
          const wantTransparent = targetOpacity < 0.99 || (orig?.transparent ?? false);
          if (mat.transparent !== wantTransparent) {
            mat.transparent = wantTransparent;
            mat.needsUpdate = true;
          }
          // Restore original depthWrite when returning to full opacity;
          // override to false when semi-transparent to avoid sorting artifacts.
          mat.depthWrite = targetOpacity < 0.99 ? false : (orig?.depthWrite ?? true);
          mat.opacity = targetOpacity < 0.99 ? targetOpacity : (orig?.opacity ?? 1.0);
        }
      }
    });
  }

  // ==========================================================================
  // Turret bone rotation
  // ==========================================================================

  /**
   * Common turret bone name patterns in W3D models.
   * Index 0 patterns = main turret, index 1 patterns = alt turret.
   * Source parity: ModelConditionInfo "Turret" / "AltTurret" fields in W3DModelDraw.
   */
  private static readonly TURRET_BONE_PATTERNS: readonly (readonly RegExp[])[] = [
    [/^turret$/i, /turret01$/i, /intturret01$/i, /turret_hi$/i, /\bturret\b/i],
    [/^altturret$/i, /turret02$/i, /intturret02$/i, /\baltturret\b/i],
  ];

  /**
   * Find turret bones in a loaded model hierarchy by matching common naming
   * conventions.  Returns an array where index 0 = main turret bone and
   * index 1 = alt turret bone (either may be undefined if not found).
   */
  private findTurretBones(model: THREE.Object3D): THREE.Object3D[] {
    const bones: THREE.Object3D[] = [];
    for (let slot = 0; slot < ObjectVisualManager.TURRET_BONE_PATTERNS.length; slot++) {
      const patterns = ObjectVisualManager.TURRET_BONE_PATTERNS[slot]!;
      let found: THREE.Object3D | null = null;
      // Try patterns in priority order — more specific first.
      for (const pattern of patterns) {
        model.traverse((child) => {
          if (!found && pattern.test(child.name)) {
            found = child;
          }
        });
        if (found) break;
      }
      bones[slot] = found!;
    }
    return bones;
  }

  /** Quaternion re-used each frame to avoid allocations. */
  private readonly tempTurretQuaternion = new THREE.Quaternion();

  /**
   * Apply turret rotation angles from game-logic to the corresponding bones.
   * Source parity: W3DModelDraw::handleClientTurretRotation — rotates the
   * turret bone around the Z axis in W3D model-space (Z-up preserved by the
   * converter, so Z is the yaw axis inside the GLB skeleton).
   */
  private syncTurretBones(visual: VisualAssetState, state: RenderableEntityState): void {
    const angles = state.turretAngles;
    if (!angles || angles.length === 0 || visual.turretBones.length === 0) {
      return;
    }
    for (let i = 0; i < angles.length && i < visual.turretBones.length; i++) {
      const bone = visual.turretBones[i];
      if (!bone) continue;
      const angle = angles[i]!;
      if (!Number.isFinite(angle)) continue;
      // W3D Rotate_Z: rotation around Z axis (yaw in Z-up model space).
      this.tempTurretQuaternion.setFromAxisAngle(ObjectVisualManager.Z_AXIS, angle);
      bone.quaternion.copy(this.tempTurretQuaternion);
    }
  }

  private static readonly Z_AXIS = new THREE.Vector3(0, 0, 1);

  // ==========================================================================
  // Condition-based animation & sub-object visibility (Task 4)
  // ==========================================================================

  /**
   * Select animation and sub-object visibility based on ModelConditionFlags.
   * Source parity: W3DModelDraw uses SparseMatchFinder to select the
   * best-fitting ModelConditionState each frame.
   *
   * Extended with:
   * - Transition animations between named states (TransitionState system)
   * - Idle animation randomization (IdleAnimation variants)
   * - Per-condition model swapping (ModelConditionInfo.modelName)
   * - AnimationSpeedFactorRange
   */
  private syncConditionAnimation(visual: VisualAssetState, state: RenderableEntityState, dt: number): void {
    const infos = state.modelConditionInfos;
    const flags = state.modelConditionFlags;
    if (!infos || infos.length === 0 || !flags) {
      return;
    }

    // Rebuild the cached Set only when the flag count or contents change.
    // Fast check avoids per-frame slice+sort+join allocation for the common case
    // where flags haven't changed between frames.
    let flagsChanged = flags.length !== visual.cachedActiveFlags.size;
    if (!flagsChanged) {
      for (const f of flags) {
        if (!visual.cachedActiveFlags.has(f)) { flagsChanged = true; break; }
      }
    }
    if (flagsChanged) {
      visual.cachedActiveFlagsKey = flags.slice().sort().join('|');
      visual.cachedActiveFlags.clear();
      for (const f of flags) visual.cachedActiveFlags.add(f);
    }
    const flagsKey = visual.cachedActiveFlagsKey;

    // Source parity: strip IgnoreConditionStates before matching.
    // Cached to avoid per-frame Set allocation.
    let activeFlags: ReadonlySet<string> = visual.cachedActiveFlags;
    const ignored = state.ignoreConditionStates;
    if (ignored && ignored.length > 0) {
      if (flagsKey !== visual.cachedFilteredFlagsKey) {
        visual.cachedFilteredFlags.clear();
        for (const f of flags) visual.cachedFilteredFlags.add(f);
        for (const ig of ignored) visual.cachedFilteredFlags.delete(ig);
        visual.cachedFilteredFlagsKey = flagsKey;
      }
      activeFlags = visual.cachedFilteredFlags;
    }

    const match = findBestConditionMatch(infos, activeFlags);
    if (!match) {
      return;
    }

    const conditionKey = match.conditionKey ?? computeConditionKey(match.conditionFlags);

    // --- Check if a transition animation is currently playing ---
    if (visual.isInTransition) {
      // Check if the transition animation has finished
      if (visual.conditionAction && this.isActionFinished(visual.conditionAction)) {
        // Transition complete — apply the target state
        visual.isInTransition = false;
        const targetMatch = visual.transitionTargetMatch;
        visual.transitionTargetMatch = null;
        visual.transitionFromKey = null;
        visual.transitionTargetConditionKey = null;
        if (targetMatch) {
          this.applyConditionState(visual, state, targetMatch, targetMatch.conditionKey ?? computeConditionKey(targetMatch.conditionFlags));
        }
      }
      // While in transition, don't process further condition changes
      return;
    }

    // --- Idle animation randomization: cycle idle variants on completion ---
    const matchIdleAnims = match.idleAnimations ?? [];
    if (conditionKey === visual.activeConditionKey && matchIdleAnims.length > 1) {
      visual.idleVariantElapsed += dt;
      if (visual.conditionAction && this.isActionFinished(visual.conditionAction)) {
        // Pick a new idle variant (different from current if possible)
        const newIndex = this.pickIdleVariant(matchIdleAnims, visual.idleVariantIndex);
        if (newIndex !== visual.idleVariantIndex) {
          visual.idleVariantIndex = newIndex;
          visual.idleVariantElapsed = 0;
          const variant = matchIdleAnims[newIndex]!;
          this.playConditionClip(visual, variant.animationName, 'ONCE');
        }
      }
    }

    if (conditionKey === visual.activeConditionKey) {
      return;
    }

    // --- Transition check ---
    const prevMatch = visual.activeConditionKey !== null
      ? this.findMatchByKey(infos, visual.activeConditionKey)
      : null;
    const transitions = state.transitionInfos;

    if (prevMatch && transitions && transitions.length > 0) {
      const prevTransKey = prevMatch.transitionKey ?? null;
      const newTransKey = match.transitionKey ?? null;
      if (prevTransKey && newTransKey && prevTransKey !== newTransKey) {
        const transInfo = transitions.find(
          t => t.fromKey === prevTransKey && t.toKey === newTransKey,
        );
        if (transInfo && transInfo.animationName) {
          // Play transition animation, then apply target state
          visual.isInTransition = true;
          visual.transitionTargetConditionKey = conditionKey;
          visual.transitionFromKey = prevTransKey;
          visual.transitionTargetMatch = match;
          visual.activeConditionKey = `__transition__${prevTransKey}__${newTransKey}`;

          // Apply transition sub-object visibility if specified
          this.applySubObjectVisibility(visual, transInfo);

          this.playConditionClip(visual, transInfo.animationName, 'ONCE');
          return;
        }
      }
    }

    // --- Direct state application (no transition) ---
    this.applyConditionState(visual, state, match, conditionKey);
  }

  /**
   * Apply a matched condition state: sub-object visibility, animation clip,
   * model swap, and speed factor.
   */
  private applyConditionState(
    visual: VisualAssetState,
    state: RenderableEntityState,
    match: ModelConditionInfo,
    conditionKey: string,
  ): void {
    visual.activeConditionKey = conditionKey;
    visual.idleVariantIndex = -1;
    visual.idleVariantElapsed = 0;

    // --- Sub-object visibility ---
    this.applySubObjectVisibility(visual, match);

    // --- Per-condition model swapping ---
    if (match.modelName) {
      this.syncConditionModelSwap(visual, state, match.modelName);
    }

    // --- Animation speed factor (randomised per state change) ---
    const speedMin = match.animSpeedFactorMin ?? 1.0;
    const speedMax = match.animSpeedFactorMax ?? 1.0;
    visual.conditionAnimSpeedFactor = randomInRange(speedMin, speedMax);

    // --- Animation clip selection ---
    if (!visual.mixer) return;

    // If there are idle animations, pick one randomly and use ONCE mode.
    const idleAnims = match.idleAnimations ?? [];
    if (idleAnims.length > 0) {
      const index = this.pickIdleVariant(idleAnims, -1);
      visual.idleVariantIndex = index;
      visual.idleVariantElapsed = 0;
      const variant = idleAnims[index]!;
      this.playConditionClip(visual, variant.animationName, 'ONCE');
      return;
    }

    const clipName = match.animationName ?? match.idleAnimationName;
    if (!clipName) return;

    this.playConditionClip(visual, clipName, match.animationMode);
  }

  /**
   * Apply sub-object hide/show lists from a condition-like info.
   */
  private applySubObjectVisibility(
    visual: VisualAssetState,
    info: { hideSubObjects: string[]; showSubObjects: string[] },
  ): void {
    if (visual.currentModel && (info.hideSubObjects.length > 0 || info.showSubObjects.length > 0)) {
      const hideSet = new Set(info.hideSubObjects.map(s => s.toUpperCase()));
      const showSet = new Set(info.showSubObjects.map(s => s.toUpperCase()));
      visual.currentModel.traverse((child) => {
        const nameUpper = child.name.toUpperCase();
        if (hideSet.has(nameUpper)) {
          child.visible = false;
        } else if (showSet.has(nameUpper)) {
          child.visible = true;
        }
      });
    }
  }

  /**
   * Play a condition-based animation clip by name, replacing the current one.
   */
  private playConditionClip(
    visual: VisualAssetState,
    clipName: string,
    mode: 'LOOP' | 'ONCE' | 'MANUAL' | 'ONCE_BACKWARDS' | 'LOOP_BACKWARDS',
  ): void {
    if (!visual.mixer) return;

    let action = visual.conditionClipActions.get(clipName);
    if (!action) {
      const clip = visual.sourceAnimations.find(
        c => c.name.toLowerCase() === clipName.toLowerCase(),
      ) ?? visual.sourceAnimations.find(
        c => c.name.toLowerCase().includes(clipName.toLowerCase()),
      );
      if (!clip) return;
      action = visual.mixer.clipAction(clip);
      action.enabled = false;
      visual.conditionClipActions.set(clipName, action);
    }

    // Crossfade from previous condition action.
    const prev = visual.conditionAction;
    if (prev && prev !== action) {
      prev.fadeOut(0.15);
    }

    // Fade out any legacy 5-state action.
    if (visual.activeState !== null) {
      const legacyAction = visual.actions.get(visual.activeState);
      if (legacyAction) {
        legacyAction.fadeOut(0.15);
      }
      visual.activeState = null;
    }

    // Source parity: resolve backwards modes to their base loop type.
    const isBackwards = mode === 'ONCE_BACKWARDS' || mode === 'LOOP_BACKWARDS';
    const baseMode = isBackwards
      ? (mode === 'ONCE_BACKWARDS' ? 'ONCE' : 'LOOP')
      : mode;

    action.reset();
    action.enabled = true;
    const loop = baseMode === 'ONCE' ? THREE.LoopOnce : THREE.LoopRepeat;
    action.setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity);
    if (baseMode === 'ONCE') {
      action.clampWhenFinished = true;
    }
    // Apply per-entity randomised speed factor.
    action.timeScale = visual.conditionAnimSpeedFactor;

    // Source parity: backwards playback — negate timeScale and start at clip end.
    if (isBackwards) {
      action.timeScale = -Math.abs(action.timeScale);
      action.time = action.getClip().duration;
    }

    action.play();
    if (prev && prev !== action) {
      action.crossFadeFrom(prev, 0.15, true);
    }
    visual.conditionAction = action;
  }

  /**
   * Check if an animation action has finished playing (for ONCE mode).
   * Source parity: isAnimationComplete() — checks if the animation reached
   * its final frame and is not looping.
   */
  private isActionFinished(action: THREE.AnimationAction): boolean {
    if (!action.enabled) return true;
    const clip = action.getClip();
    if (!clip || clip.duration <= 0) return true;
    // For LoopOnce actions, THREE.js sets paused=true when clampWhenFinished and done.
    if (action.loop === THREE.LoopOnce && action.clampWhenFinished && action.paused) {
      return true;
    }
    // Fallback: check if time has passed the clip duration.
    if (action.loop === THREE.LoopOnce && action.time >= clip.duration - 0.001) {
      return true;
    }
    return false;
  }

  /**
   * Pick an idle animation variant using weighted random selection.
   * Avoids picking the same variant as `currentIndex` when multiple exist.
   */
  private pickIdleVariant(variants: readonly IdleAnimationVariant[], currentIndex: number): number {
    if (variants.length === 0) return -1;
    if (variants.length === 1) return 0;

    const totalWeight = variants.reduce((sum, v) => sum + v.randomWeight, 0);
    if (totalWeight <= 0) return 0;

    // Try up to 10 times to pick a different variant.
    for (let attempt = 0; attempt < 10; attempt++) {
      let roll = Math.random() * totalWeight;
      for (let i = 0; i < variants.length; i++) {
        roll -= variants[i]!.randomWeight;
        if (roll <= 0) {
          if (i !== currentIndex || variants.length === 1) {
            return i;
          }
          break; // Try again
        }
      }
    }

    // Fallback: just pick the next one cyclically.
    return (currentIndex + 1) % variants.length;
  }

  /**
   * Find the ModelConditionInfo that was previously matched by its serialised key.
   */
  private findMatchByKey(infos: readonly ModelConditionInfo[], key: string): ModelConditionInfo | null {
    for (const info of infos) {
      if ((info.conditionKey ?? computeConditionKey(info.conditionFlags)) === key) {
        return info;
      }
    }
    return null;
  }

  /**
   * Per-condition model swapping.
   * Source parity: W3DModelDraw::setModelState — when the new state's model
   * name differs from the current one, replace the render object.
   * Uses a per-entity cache to avoid re-loading on frequent condition changes.
   */
  private syncConditionModelSwap(
    visual: VisualAssetState,
    _state: RenderableEntityState,
    targetModelName: string,
  ): void {
    const normalizedTarget = targetModelName.trim().toLowerCase();
    if (!normalizedTarget || normalizedTarget === 'none') {
      return;
    }

    // Already on the correct model?
    if (visual.currentModelName && visual.currentModelName.toLowerCase() === normalizedTarget) {
      return;
    }

    // If the base asset path already matches the target model name, no swap needed.
    // This avoids re-loading the same model that was loaded as the primary asset.
    if (visual.assetPath) {
      const baseName = visual.assetPath.replace(/\.[^.]+$/, '').split('/').pop()?.toLowerCase() ?? '';
      if (baseName === normalizedTarget) {
        visual.currentModelName = normalizedTarget;
        return;
      }
    }

    // Check the alternate model cache.
    const cached = visual.alternateModelCache.get(normalizedTarget);
    if (cached) {
      this.swapModel(visual, cached.scene, cached.animations);
      visual.currentModelName = normalizedTarget;
      return;
    }

    // Initiate async load.
    visual.modelSwapLoadToken += 1;
    const swapToken = visual.modelSwapLoadToken;

    const candidates = this.resolveCandidateAssetPaths(targetModelName);
    void (async () => {
      for (const candidate of candidates) {
        try {
          const source = await this.loadModelAsset(candidate);
          // Check stale load.
          if (visual.modelSwapLoadToken !== swapToken) {
            return;
          }
          // Cache and swap.
          visual.alternateModelCache.set(normalizedTarget, {
            scene: source.scene,
            animations: source.animations,
          });
          this.swapModel(visual, source.scene, source.animations);
          visual.currentModelName = normalizedTarget;
          return;
        } catch {
          // Try next candidate.
        }
      }
    })();
  }

  /**
   * Swap the current model scene graph with a new one, preserving the mixer/actions.
   */
  private swapModel(
    visual: VisualAssetState,
    sourceScene: THREE.Object3D,
    sourceAnimations: readonly THREE.AnimationClip[],
  ): void {
    // Remove old model.
    if (visual.currentModel) {
      if (visual.mixer) {
        visual.mixer.stopAllAction();
        visual.mixer.uncacheRoot(visual.currentModel);
      }
      visual.root.remove(visual.currentModel);
      this.disposeObject3D(visual.currentModel);
    }

    // Clone and install new model.
    const clone = sourceScene.clone(true);
    const mixer = sourceAnimations.length > 0
      ? new THREE.AnimationMixer(clone)
      : null;

    visual.currentModel = clone;
    visual.mixer = mixer;
    visual.actions.clear();
    visual.conditionClipActions.clear();
    visual.conditionAction = null;
    visual.activeState = null;
    visual.sourceAnimations = sourceAnimations;
    visual.turretBones = this.findTurretBones(clone);

    // Detect tread sub-meshes.
    const treadMeshes: THREE.Mesh[] = [];
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.name.toUpperCase().includes('TREAD')) {
        treadMeshes.push(child as THREE.Mesh);
      }
    });
    visual.treadMeshes = treadMeshes;

    this.applyGuardBandFrustumPolicy(clone);
    visual.root.add(clone);
  }

  /**
   * Adjust animation playback speed to match entity movement speed.
   * Source parity: W3DModelDraw scales walk/move animation speed by
   * currentSpeed / maxSpeed so units don't slide.
   */
  private syncAnimationSpeed(visual: VisualAssetState, state: RenderableEntityState): void {
    const action = visual.conditionAction
      ?? (visual.activeState ? visual.actions.get(visual.activeState) ?? null : null);
    if (!action) return;

    const currentSpeed = state.currentSpeed ?? 0;
    const maxSpeed = state.maxSpeed ?? 0;
    const isMoving = state.modelConditionFlags?.includes('MOVING') ?? false;

    // Base speed factor from AnimationSpeedFactorRange (set per condition change).
    const baseFactor = visual.conditionAnimSpeedFactor;

    // Preserve backwards playback direction (negative timeScale from ONCE_BACKWARDS / LOOP_BACKWARDS).
    const sign = action.timeScale < 0 ? -1 : 1;

    if (isMoving && maxSpeed > 0) {
      action.timeScale = sign * Math.max(0.3, Math.min(2.0, currentSpeed / maxSpeed)) * baseFactor;
    } else {
      action.timeScale = sign * baseFactor;
    }
  }

  /** UV scroll rate for tank treads (world units per second). */
  private static readonly TREAD_SCROLL_RATE = 0.5;

  /**
   * Scroll tread sub-mesh UV offsets proportional to movement speed.
   * Source parity: W3DTankDraw scrolls tread textures based on locomotor speed.
   */
  private syncTreadScrolling(visual: VisualAssetState, state: RenderableEntityState, dt: number): void {
    if (visual.treadMeshes.length === 0) return;
    const currentSpeed = state.currentSpeed ?? 0;
    if (Math.abs(currentSpeed) < 0.001) return;

    visual.treadUVOffset = (visual.treadUVOffset + currentSpeed * dt * ObjectVisualManager.TREAD_SCROLL_RATE) % 1.0;

    for (const mesh of visual.treadMeshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.map) {
        material.map.offset.x = visual.treadUVOffset;
      }
    }
  }

  private disposeObject3D(object3D: THREE.Object3D): void {
    object3D.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose?.();
        }
      } else {
        material?.dispose?.();
      }
    });
  }

  private createPlaceholderMesh(entityId: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff33ff,
      transparent: true,
      opacity: 0.4,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `placeholder-${entityId}`;
    mesh.userData = { entityId };
    this.applyGuardBandFrustumPolicy(mesh);
    return mesh;
  }

  private isGuardBandBiasActive(): boolean {
    return this.viewGuardBandBiasX > 0 || this.viewGuardBandBiasY > 0;
  }

  private applyGuardBandFrustumPolicy(root: THREE.Object3D): void {
    const disableFrustumCulling = this.isGuardBandBiasActive();
    root.traverse((child) => {
      if (
        !(child instanceof THREE.Mesh)
        && !(child instanceof THREE.Line)
        && !(child instanceof THREE.Points)
        && !(child instanceof THREE.Sprite)
      ) {
        return;
      }
      child.frustumCulled = !disableFrustumCulling;
    });
  }

  private ensurePlaceholderMesh(entityId: number): THREE.Mesh {
    const visual = this.visuals.get(entityId);
    if (!visual) {
      throw new Error(`Unknown visual state for entity ${entityId}`);
    }

    if (visual.placeholder) {
      return visual.placeholder;
    }

    const placeholder = this.createPlaceholderMesh(entityId);
    visual.placeholder = placeholder;
    visual.root.add(placeholder);
    return placeholder;
  }

  private pixelToNDC(
    mouseX: number,
    mouseY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): THREE.Vector2 | null {
    if (viewportWidth <= 0 || viewportHeight <= 0 || !Number.isFinite(mouseX) || !Number.isFinite(mouseY)) {
      return null;
    }
    return new THREE.Vector2(
      (mouseX / viewportWidth) * 2 - 1,
      -(mouseY / viewportHeight) * 2 + 1,
    );
  }

  /**
   * Scale the placeholder box to a small, fixed-ish marker so that
   * entities with unloaded models are still visible and clickable
   * without obscuring the scene.  Capped at MAX_PLACEHOLDER_SIZE to
   * prevent large structures from spawning screen-filling pink boxes.
   */
  private static readonly MAX_PLACEHOLDER_SIZE = 5;

  private scalePlaceholder(visual: VisualAssetState, state: RenderableEntityState): void {
    if (!visual.placeholder) return;
    const radius = Math.min(
      Math.max(state.selectionCircleRadius ?? 1, 1),
      ObjectVisualManager.MAX_PLACEHOLDER_SIZE / 2,
    );
    const diameter = radius * 2;
    visual.placeholder.scale.set(diameter, diameter, diameter);
  }

  private syncPlaceholder(visual: VisualAssetState, entityId: number, visible: boolean): void {
    if (visible) {
      this.ensurePlaceholderMesh(entityId);
      visual.placeholder?.updateMatrixWorld();
    }
    if (visual.placeholder) {
      visual.placeholder.visible = visible;
    }
  }

  private syncShadowConfiguration(
    visual: VisualAssetState,
    modelRoot: THREE.Object3D,
    state: RenderableEntityState,
  ): void {
    const shadowType = parseObjectShadowType(state.shadowType);
    const castShadow = shouldCastShadowMap(shadowType);
    modelRoot.traverse((child) => {
      child.castShadow = castShadow;
      child.receiveShadow = true;
    });
    visual.shadowType = state.shadowType ?? null;

    // Source parity: SHADOW_DECAL/ALPHA_DECAL/ADDITIVE_DECAL use projected
    // textures. SHADOW_VOLUME/SHADOW_PROJECTION are separate systems in the
    // original renderer; do not approximate them with solid quads here.
    const isAirUnit = state.category === 'air';
    const wantsDecalShadow = !isAirUnit && shouldCreateShadowDecal(shadowType);
    if (wantsDecalShadow && !visual.shadowDecal) {
      const decal = createShadowDecalMesh({
        sizeX: state.shadowSizeX ?? ObjectVisualManager.DEFAULT_SOURCE_SHADOW_DECAL_SIZE,
        sizeY: state.shadowSizeY ?? state.shadowSizeX ?? ObjectVisualManager.DEFAULT_SOURCE_SHADOW_DECAL_SIZE,
        offsetX: state.shadowOffsetX ?? 0,
        offsetY: state.shadowOffsetY ?? 0,
      });
      const baseHeight = ObjectVisualManager.nominalHeightForCategory(state.category) / 2;
      decal.position.y = -baseHeight + 0.1;
      this.applyGuardBandFrustumPolicy(decal);
      visual.shadowDecal = decal;
      visual.root.add(decal);
    }

    if (!wantsDecalShadow && visual.shadowDecal) {
      this.disposeObject3D(visual.shadowDecal);
      visual.root.remove(visual.shadowDecal);
      visual.shadowDecal = null;
      visual.shadowTextureKey = null;
      return;
    }

    if (visual.shadowDecal) {
      visual.shadowDecal.scale.set(
        state.shadowSizeX ?? ObjectVisualManager.DEFAULT_SOURCE_SHADOW_DECAL_SIZE,
        state.shadowSizeY ?? state.shadowSizeX ?? ObjectVisualManager.DEFAULT_SOURCE_SHADOW_DECAL_SIZE,
        1,
      );
      visual.shadowDecal.position.x = state.shadowOffsetX ?? 0;
      visual.shadowDecal.position.z = state.shadowOffsetY ?? 0;
      this.syncShadowTexture(visual, state, shadowType);
    }
  }
}
