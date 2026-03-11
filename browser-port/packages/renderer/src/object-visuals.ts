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
  /** Active status effects for overlay icons (poisoned, burning, EMP'd, etc.). */
  statusEffects?: readonly string[];
  /** Source parity: Geometry MajorRadius — used for selection circle sizing. */
  selectionCircleRadius?: number;
  /** True when this entity belongs to the local player's side. */
  isOwnedByLocalPlayer?: boolean;
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
  /** Previous stealth opacity to skip redundant traversals. */
  lastStealthOpacity: number;
  /** Shadow decal mesh (for SHADOW_DECAL type). */
  shadowDecal: THREE.Mesh | null;
  /** Parsed shadow type for this entity. */
  shadowType: string | null;
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

export class ObjectVisualManager {
  private readonly scene: THREE.Scene;
  private readonly assetManager: AssetManager | null;
  private readonly config: Required<ObjectVisualManagerConfig>;
  private readonly modelLoader: (assetPath: string) => Promise<LoadedModelAsset>;
  private readonly gltfLoader = new GLTFLoader();
  private readonly raycaster = new THREE.Raycaster();
  private readonly visuals = new Map<number, VisualAssetState>();
  private readonly modelCache = new Map<string, LoadedModelAsset>();
  private readonly modelLoadPromises = new Map<string, Promise<LoadedModelAsset>>();
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

      this.syncVisualTransform(visual, state);
      this.syncShroudVisibility(visual, state);
      this.syncVisualAsset(visual, state);
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
      if (visual.mixer) {
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
      lastStealthOpacity: 1.0,
      shadowDecal: null,
      shadowType: null,
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
    const hit = this.raycaster.intersectObjects(this.scene.children, true).at(0);
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
    const candidateAssetPaths = this.collectCandidateAssetPaths(state);
    const entityId = visual.root.userData.entityId as number;

    if (candidateAssetPaths.length === 0) {
      if (visual.currentModel !== null) {
        this.removeModel(visual);
      }
      if (visual.assetPath !== null) {
        visual.loadToken += 1;
      }
      visual.assetPath = null;
      this.unresolvedEntityIds.add(entityId);
      this.updatePlaceholderVisibility(entityId, true);
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
    this.updatePlaceholderVisibility(entityId, true);
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

          // Per-object shadow configuration
          const shadowType = parseObjectShadowType(state.shadowType);
          const castShadow = shouldCastShadowMap(shadowType);
          clone.traverse((child) => {
            child.castShadow = castShadow;
            child.receiveShadow = true;
          });
          currentVisual.shadowType = state.shadowType ?? null;

          // Create shadow decal for SHADOW_DECAL types
          if (shouldCreateShadowDecal(shadowType) && !currentVisual.shadowDecal) {
            const decal = createShadowDecalMesh({
              sizeX: state.shadowSizeX,
              sizeY: state.shadowSizeY,
            });
            currentVisual.shadowDecal = decal;
            currentVisual.root.add(decal);
          }

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
        } catch (err) {
          console.warn(`ObjectVisualManager: failed to load model "${candidate}"`, err);
        }
      }

      const currentVisual = this.visuals.get(entityId);
      if (currentVisual && currentVisual === visual && currentVisual.loadToken === loadToken) {
        this.unresolvedEntityIds.add(entityId);
      }
    })();
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

    const promise = this.modelLoader(assetPath).then((result) => {
      const loaded: LoadedModelAsset = {
        scene: result.scene,
        animations: result.animations,
      };
      this.modelCache.set(assetPath, loaded);
      this.modelLoadPromises.delete(assetPath);
      return loaded;
    }).catch((error) => {
      this.modelLoadPromises.delete(assetPath);
      throw error;
    });

    this.modelLoadPromises.set(assetPath, promise);
    return promise;
  }

  private createDefaultModelLoader(assetPath: string): Promise<LoadedModelAsset> {
    if (!this.assetManager) {
      throw new Error('ObjectVisualManager model loader requires an AssetManager.');
    }
    // Try manifest basename resolution as a fallback if the literal path fails.
    const resolvedPath = this.assetManager.resolveModelPath(assetPath) ?? assetPath;
    return this.assetManager.loadArrayBuffer(resolvedPath).then((handle) => {
      return this.parseGltfAsset(handle.data, resolvedPath);
    });
  }

  private parseGltfAsset(data: ArrayBuffer, path: string): Promise<LoadedModelAsset> {
    return new Promise<LoadedModelAsset>((resolve, reject) => {
      this.gltfLoader.parse(
        data,
        path,
        (gltf) => {
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
      const resolved = this.assetManager.resolveModelPath(normalized);
      if (resolved) {
        push(resolved);
      }
    }

    if (!extension) {
      for (const ext of this.config.modelExtensions) {
        push(`${normalized}${ext}`);
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
    const showBar = maxHealth > 0 && health > 0 && health < maxHealth;

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

    const ratio = Math.max(0, Math.min(1, health / maxHealth));
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
      mat.color.setHex(ObjectVisualManager.healthColorForRatio(ratio));
    }
  }

  /** Selection circle color: own units. Source parity: green circle in retail. */
  private static readonly SEL_COLOR_OWN = 0x00ff00;
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

    // Determine desired color from ownership.
    const isOwn = state.isOwnedByLocalPlayer ?? false;
    const desiredColor = isOwn
      ? ObjectVisualManager.SEL_COLOR_OWN
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

  /**
   * Apply stealth opacity: stealthed = semi-transparent, detected = pulsing.
   */
  private syncStealthOpacity(visual: VisualAssetState, state: RenderableEntityState): void {
    const isStealthed = state.isStealthed === true;
    const isDetected = state.isDetected === true;
    let targetOpacity = 1.0;
    if (isStealthed && !isDetected) {
      targetOpacity = 0.35;
    } else if (isStealthed && isDetected) {
      // Pulse between 0.4 and 0.8.
      targetOpacity = 0.6 + 0.2 * Math.sin(this.accumulatedTime * 6.0);
    }

    // Skip traversal when opacity hasn't changed (within tolerance for pulsing).
    if (Math.abs(targetOpacity - visual.lastStealthOpacity) < 0.01) return;
    visual.lastStealthOpacity = targetOpacity;

    visual.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      // Clone materials on first stealth mutation to avoid mutating shared GLTF cache.
      if (!visual.stealthMaterialClones.has(mesh)) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
        visual.stealthMaterialClones.set(mesh, mesh.material);
      }

      const clonedMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of clonedMaterials) {
        if ('opacity' in mat) {
          const wantTransparent = targetOpacity < 1.0;
          if (mat.transparent !== wantTransparent) {
            mat.transparent = wantTransparent;
            mat.needsUpdate = true;
          }
          mat.opacity = targetOpacity;
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

    // Rebuild the cached Set only when the serialised key changes.
    const flagsKey = flags.slice().sort().join('|');
    if (flagsKey !== visual.cachedActiveFlagsKey) {
      visual.cachedActiveFlags.clear();
      for (const f of flags) visual.cachedActiveFlags.add(f);
      visual.cachedActiveFlagsKey = flagsKey;
    }

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
      opacity: 0.95,
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

  private syncPlaceholder(visual: VisualAssetState, entityId: number, visible: boolean): void {
    if (visible) {
      this.ensurePlaceholderMesh(entityId);
      visual.placeholder?.updateMatrixWorld();
    }
    if (visual.placeholder) {
      visual.placeholder.visible = visible;
    }
  }
}
