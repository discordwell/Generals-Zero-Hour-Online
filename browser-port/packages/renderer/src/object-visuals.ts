/**
 * ObjectVisualManager — loads and updates converted model assets for map entities.
 *
 * This manager receives render-ready snapshots from game-logic and renders
 * them as asset-backed visual nodes.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetManager } from '@generals/assets';

export type RenderableAnimationState = 'IDLE' | 'MOVE' | 'ATTACK' | 'DIE' | 'PRONE';

export interface RenderableEntityState {
  id: number;
  renderAssetPath: string | null;
  renderAssetResolved: boolean;
  renderAssetCandidates?: readonly string[];
  renderAnimationStateClips?: Partial<Record<RenderableAnimationState, string[]>>;
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
  scriptFlashRing: THREE.Mesh | null;
  veterancyBadge: THREE.Group | null;
  currentVeterancyLevel: number;
  /** Cloned materials for stealth opacity mutation (avoids mutating shared GLTF materials). */
  stealthMaterialClones: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>;
  /** Previous stealth opacity to skip redundant traversals. */
  lastStealthOpacity: number;
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
      this.syncStealthOpacity(visual, state);
      this.applyAnimationState(visual, state.animationState);
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
  } | null {
    const visual = this.visuals.get(entityId);
    if (!visual) {
      return null;
    }
    return {
      animationState: visual.activeState,
      hasModel: visual.currentModel !== null,
      assetPath: visual.assetPath,
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
      scriptFlashRing: null,
      veterancyBadge: null,
      currentVeterancyLevel: 0,
      stealthMaterialClones: new WeakMap(),
      lastStealthOpacity: 1.0,
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

          clone.traverse((child) => {
            child.castShadow = true;
            child.receiveShadow = true;
          });
          this.applyGuardBandFrustumPolicy(clone);
          currentVisual.currentModel = clone;
          currentVisual.mixer = mixer;
          currentVisual.actions = actions;
          currentVisual.root.add(clone);
          this.applyAnimationState(currentVisual, currentVisual.requestedAnimationState);
          this.unresolvedEntityIds.delete(entityId);
          this.updatePlaceholderVisibility(entityId, false);
          return;
        } catch {
          // Keep explicit unresolved state and allow retries on subsequent state updates.
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
    return this.assetManager.loadArrayBuffer(assetPath).then((handle) => {
      return this.parseGltfAsset(handle.data, assetPath);
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

    if (!extension) {
      for (const ext of this.config.modelExtensions) {
        push(`${normalized}${ext}`);
      }
      return candidates;
    }

    if (extension === 'w3d') {
      push(normalized.replace(/\.w3d$/i, '.gltf'));
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

  private syncSelectionRing(visual: VisualAssetState, state: RenderableEntityState): void {
    const isSelected = state.isSelected ?? false;

    if (!isSelected) {
      if (visual.selectionRing) {
        visual.selectionRing.visible = false;
      }
      return;
    }

    if (!visual.selectionRing) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ObjectVisualManager.getSelectionRingGeometry(), material);
      ring.renderOrder = 998;
      ring.rotation.x = -Math.PI / 2; // Lay flat on the ground plane.
      ring.position.y = 0.05; // Slight offset above ground to avoid z-fighting.
      ring.name = 'selection-ring';
      visual.selectionRing = ring;
      visual.root.add(ring);
      this.applyGuardBandFrustumPolicy(ring);
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
      targetOpacity = 0.6 + 0.2 * Math.sin(performance.now() * 0.006);
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
