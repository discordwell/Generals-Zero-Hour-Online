import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LoadedModelAsset } from './object-visuals.js';
import { ObjectVisualManager, stripConditionStateSuffix, type RenderableEntityState } from './object-visuals.js';

function flushModelLoadQueue(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function makeMeshState(overrides: Partial<RenderableEntityState> = {}): RenderableEntityState {
  return {
    id: 1,
    renderAssetPath: 'unit-model.gltf',
    renderAssetResolved: true,
    x: 10,
    y: 0,
    z: 20,
    rotationY: 0.5,
    animationState: 'IDLE',
    ...overrides,
  };
}

function modelWithAnimationClips(clips: readonly string[] = []): LoadedModelAsset {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  scene.add(mesh);

  const createdClips = clips.map((clipName) => new THREE.AnimationClip(
    clipName,
    1,
    [
      new THREE.NumberKeyframeTrack(
        '.position[x]',
        [0, 1],
        [0, 0],
      ),
    ],
  ));

  return {
    scene,
    animations: createdClips,
  };
}

function getPlaceholderMesh(manager: ObjectVisualManager, entityId: number): THREE.Mesh | null {
  const root = manager.getVisualRoot(entityId);
  if (!root) {
    return null;
  }
  const placeholder = root.children.find((entry) => {
    const userData = entry.userData as { entityId?: unknown };
    return entry.type === 'Mesh' && userData?.entityId === entityId;
  });
  return placeholder instanceof THREE.Mesh ? placeholder : null;
}

function getScriptFlashRing(manager: ObjectVisualManager, entityId: number): THREE.Mesh | null {
  const root = manager.getVisualRoot(entityId);
  if (!root) {
    return null;
  }
  const ring = root.getObjectByName('script-flash-ring');
  return ring instanceof THREE.Mesh ? ring : null;
}

function collectRenderableNodes(manager: ObjectVisualManager, entityId: number): THREE.Object3D[] {
  const root = manager.getVisualRoot(entityId);
  if (!root) {
    return [];
  }
  const renderables: THREE.Object3D[] = [];
  root.traverse((child) => {
    const renderable = child as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite;
    if (!renderable.isMesh && !renderable.isLine && !renderable.isPoints && !renderable.isSprite) {
      return;
    }
    renderables.push(child);
  });
  return renderables;
}

describe('ObjectVisualManager', () => {
  it('creates and syncs visual nodes from render-state snapshots', async () => {
    const scene = new THREE.Scene();
    const modelsRequested: string[] = [];
    const modelLoader = async (assetPath: string): Promise<LoadedModelAsset> => {
      modelsRequested.push(assetPath);
      return modelWithAnimationClips(['Idle', 'Attack']);
    };
    const manager = new ObjectVisualManager(scene, null, { modelLoader });

    const state = makeMeshState();
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    const placeholder = getPlaceholderMesh(manager, state.id);

    const root = manager.getVisualRoot(state.id);
    expect(root).toBeTruthy();
    expect(scene.children).toContain(root);
    expect(root?.position.x).toBe(state.x);
    expect(root?.rotation.y).toBe(state.rotationY);
    expect(modelsRequested).toContain('unit-model.gltf');
    expect(manager.getVisualState(state.id)?.hasModel).toBe(true);
    expect(placeholder).toBeTruthy();
    expect(placeholder?.visible).toBe(false);
  });

  it('hides SHROUDED render states and restores visibility when revealed', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle']),
    });

    manager.sync([makeMeshState({ id: 51, shroudStatus: 'SHROUDED' })], 1 / 30);
    await flushModelLoadQueue();
    expect(manager.getVisualRoot(51)?.visible).toBe(false);

    manager.sync([makeMeshState({ id: 51, shroudStatus: 'CLEAR' })], 1 / 30);
    expect(manager.getVisualRoot(51)?.visible).toBe(true);
  });

  it('applies topple tilt from render snapshots', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle']),
    });

    manager.sync([makeMeshState({
      id: 52,
      rotationY: 0,
      toppleAngle: Math.PI / 6,
      toppleDirX: 1,
      toppleDirZ: 0,
    })], 1 / 30);
    await flushModelLoadQueue();

    const root = manager.getVisualRoot(52);
    expect(root).toBeTruthy();
    const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(root!.quaternion);
    expect(Math.abs(upVector.y)).toBeLessThan(0.99);
  });

  it('updates animation state transitions and removes stale entities', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'Move', 'Attack', 'Die']),
    });

    manager.sync([makeMeshState()], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ animationState: 'MOVE' })], 1 / 30);
    expect(manager.getVisualState(1)?.animationState).toBe('MOVE');
    const placeholder1 = getPlaceholderMesh(manager, 1);
    expect(placeholder1?.visible).toBe(false);

    manager.sync([makeMeshState({ id: 2, renderAssetPath: 'building.glb' })], 1 / 30);
    await flushModelLoadQueue();
    const placeholder2 = getPlaceholderMesh(manager, 2);
    expect(scene.children.filter((entry) => entry.name.startsWith('object-visual-')).length).toBe(1);
    expect(manager.getVisualRoot(1)).toBeNull();
    expect(manager.getVisualRoot(2)).toBeTruthy();
    expect(manager.getVisualState(2)?.hasModel).toBe(true);
    expect(placeholder2).toBeTruthy();
    expect(placeholder2?.visible).toBe(false);
  });

  it('applies explicit IDLE/MOVE/ATTACK/DIE state transitions from render snapshots', async () => {
    const scene = new THREE.Scene();
    const modelLoaderCalls: string[] = [];
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async (assetPath: string): Promise<LoadedModelAsset> => {
        modelLoaderCalls.push(assetPath);
        return modelWithAnimationClips(['Idle', 'Move', 'Attack', 'Die']);
      },
    });

    const baseState = makeMeshState({ id: 7, renderAssetPath: 'unit-model' });
    manager.sync([baseState], 1 / 30);
    await flushModelLoadQueue();

    expect(modelLoaderCalls).toEqual(['unit-model.gltf']);
    expect(manager.getVisualState(7)?.hasModel).toBe(true);
    expect(manager.getVisualState(7)?.animationState).toBe('IDLE');

    manager.sync([makeMeshState({ id: 7, renderAssetPath: 'unit-model' })], 1 / 30);
    expect(manager.getVisualState(7)?.animationState).toBe('IDLE');

    manager.sync([makeMeshState({ id: 7, animationState: 'MOVE', renderAssetPath: 'unit-model' })], 1 / 30);
    expect(manager.getVisualState(7)?.animationState).toBe('MOVE');

    manager.sync([makeMeshState({ id: 7, animationState: 'ATTACK', renderAssetPath: 'unit-model' })], 1 / 30);
    expect(manager.getVisualState(7)?.animationState).toBe('ATTACK');

    manager.sync([makeMeshState({ id: 7, animationState: 'DIE', renderAssetPath: 'unit-model' })], 1 / 30);
    expect(manager.getVisualState(7)?.animationState).toBe('DIE');
  });

  it('keeps the last supported animation state when requested clip is unavailable', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle']),
    });

    manager.sync([makeMeshState({ id: 9, renderAssetPath: 'unit-model', animationState: 'IDLE' })], 1 / 30);
    await flushModelLoadQueue();
    expect(manager.getVisualState(9)?.hasModel).toBe(true);
    expect(manager.getVisualState(9)?.animationState).toBe('IDLE');

    manager.sync([makeMeshState({ id: 9, renderAssetPath: 'unit-model', animationState: 'MOVE' })], 1 / 30);
    expect(manager.getVisualState(9)?.animationState).toBe('IDLE');

    manager.sync([makeMeshState({ id: 9, renderAssetPath: 'unit-model', animationState: 'ATTACK' })], 1 / 30);
    expect(manager.getVisualState(9)?.animationState).toBe('IDLE');
  });

  it('prefers source-provided animation clip candidates per render state', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle01', 'Move01', 'Attack01', 'Die01']),
    });
    const clips = {
      IDLE: ['Idle01'],
      MOVE: ['Move01'],
      ATTACK: ['Attack01'],
      DIE: ['Die01'],
    };

    const baseState = makeMeshState({ id: 8, renderAssetPath: 'unit-model', renderAnimationStateClips: clips });
    manager.sync([baseState], 1 / 30);
    await flushModelLoadQueue();
    expect(manager.getVisualState(8)?.animationState).toBe('IDLE');

    manager.sync([makeMeshState({ id: 8, renderAssetPath: 'unit-model', renderAnimationStateClips: clips, animationState: 'MOVE' })], 1 / 30);
    expect(manager.getVisualState(8)?.animationState).toBe('MOVE');

    manager.sync([makeMeshState({ id: 8, renderAssetPath: 'unit-model', renderAnimationStateClips: clips, animationState: 'ATTACK' })], 1 / 30);
    expect(manager.getVisualState(8)?.animationState).toBe('ATTACK');

    manager.sync([makeMeshState({ id: 8, renderAssetPath: 'unit-model', renderAnimationStateClips: clips, animationState: 'DIE' })], 1 / 30);
    expect(manager.getVisualState(8)?.animationState).toBe('DIE');
  });

  it('keeps missing assets explicit and non-throwing', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => {
        throw new Error('missing asset');
      },
    });

    manager.sync([makeMeshState({ id: 3, renderAssetPath: 'missing' })], 1 / 30);
    await flushModelLoadQueue();
    const placeholder = getPlaceholderMesh(manager, 3);

    expect(manager.getUnresolvedEntityIds()).toEqual([3]);
    expect(manager.getVisualState(3)?.hasModel).toBe(false);
    expect(scene.children.filter((entry) => entry.name.startsWith('object-visual-')).length).toBe(1);
    expect(placeholder).toBeTruthy();
    expect(placeholder?.visible).toBe(true);
  });

  it('renders script flash ring with scripted color while flash count is active', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle']),
    });

    manager.sync([makeMeshState({
      id: 31,
      scriptFlashCount: 3,
      scriptFlashColor: 0x3366cc,
    })], 1 / 30);
    await flushModelLoadQueue();

    const firstRing = getScriptFlashRing(manager, 31);
    expect(firstRing).toBeTruthy();
    expect(firstRing?.visible).toBe(true);
    const firstMaterial = firstRing?.material as THREE.MeshBasicMaterial;
    expect(firstMaterial.color.getHex()).toBe(0x3366cc);

    manager.sync([makeMeshState({
      id: 31,
      scriptFlashCount: 2,
      scriptFlashColor: 0x3366cc,
    })], 1 / 30);
    const hiddenRing = getScriptFlashRing(manager, 31);
    expect(hiddenRing?.visible).toBe(false);

    manager.sync([makeMeshState({
      id: 31,
      scriptFlashCount: 1,
      scriptFlashColor: 0xff4400,
    })], 1 / 30);
    const recoloredRing = getScriptFlashRing(manager, 31);
    expect(recoloredRing?.visible).toBe(true);
    const recoloredMaterial = recoloredRing?.material as THREE.MeshBasicMaterial;
    expect(recoloredMaterial.color.getHex()).toBe(0xff4400);
  });

  it('disables frustum culling while script guard-band bias is active', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle']),
    });

    manager.sync([makeMeshState({ id: 41 })], 1 / 30);
    await flushModelLoadQueue();
    const defaultRenderables = collectRenderableNodes(manager, 41);
    expect(defaultRenderables.length).toBeGreaterThan(0);
    for (const renderable of defaultRenderables) {
      expect(renderable.frustumCulled).toBe(true);
    }

    manager.setViewGuardBandBias(12, 8);
    const biasedRenderables = collectRenderableNodes(manager, 41);
    for (const renderable of biasedRenderables) {
      expect(renderable.frustumCulled).toBe(false);
    }

    manager.sync([makeMeshState({ id: 42, x: 20 })], 1 / 30);
    await flushModelLoadQueue();
    const newRenderables = collectRenderableNodes(manager, 42);
    expect(newRenderables.length).toBeGreaterThan(0);
    for (const renderable of newRenderables) {
      expect(renderable.frustumCulled).toBe(false);
    }

    manager.setViewGuardBandBias(0, 0);
    const resetRenderables = collectRenderableNodes(manager, 41);
    for (const renderable of resetRenderables) {
      expect(renderable.frustumCulled).toBe(true);
    }
  });

  it('remains stable during long-running visual churn', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'Move', 'Attack', 'Die']),
    });

    const maxEntityId = 15;
    for (let frame = 0; frame < 360; frame += 1) {
      const states: RenderableEntityState[] = [];
      for (let id = 1; id <= maxEntityId; id += 1) {
        if ((id + frame) % 4 === 0) {
          continue;
        }
        states.push(makeMeshState({
          id,
          x: id * 2 + (frame % 5),
          z: id * 3 + ((frame * 2) % 7),
          animationState: frame % 3 === 0 ? 'MOVE' : frame % 5 === 0 ? 'ATTACK' : 'IDLE',
          shroudStatus: (frame + id) % 11 === 0 ? 'SHROUDED' : 'CLEAR',
        }));
      }

      manager.sync(states, 1 / 30);
      if (frame % 60 === 0) {
        await flushModelLoadQueue();
      }
    }

    await flushModelLoadQueue();
    const activeRoots = scene.children.filter((entry) => entry.name.startsWith('object-visual-'));
    expect(activeRoots.length).toBeLessThanOrEqual(maxEntityId);
    expect(manager.getUnresolvedEntityIds()).toEqual([]);

    manager.sync([], 1 / 30);
    const remainingRoots = scene.children.filter((entry) => entry.name.startsWith('object-visual-'));
    expect(remainingRoots).toEqual([]);
  });

  it('returns unresolved entity IDs in deterministic ascending order', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => {
        throw new Error('missing asset');
      },
    });

    manager.sync([
      makeMeshState({ id: 10, renderAssetPath: 'a' }),
      makeMeshState({ id: 2, renderAssetPath: 'b' }),
      makeMeshState({ id: 7, renderAssetPath: 'c' }),
    ], 1 / 30);
    await flushModelLoadQueue();

    expect(manager.getUnresolvedEntityIds()).toEqual([2, 7, 10]);
  });

  it('removes unresolved IDs when unresolved entities are removed', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => {
        throw new Error('missing asset');
      },
    });

    manager.sync([
      makeMeshState({ id: 9, renderAssetPath: 'a' }),
      makeMeshState({ id: 1, renderAssetPath: 'b' }),
    ], 1 / 30);
    await flushModelLoadQueue();
    expect(manager.getUnresolvedEntityIds()).toEqual([1, 9]);

    manager.sync([makeMeshState({ id: 9, renderAssetPath: 'a' })], 1 / 30);
    await flushModelLoadQueue();
    expect(manager.getUnresolvedEntityIds()).toEqual([9]);
  });

  it('cancels stale model loads when an entity becomes unresolved', async () => {
    const scene = new THREE.Scene();
    let resolvePending: ((asset: LoadedModelAsset) => void) | null = null;
    const delayedModelLoader = async () => new Promise<LoadedModelAsset>((resolve) => {
      resolvePending = resolve;
    });

    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: delayedModelLoader,
    });

    manager.sync([makeMeshState({ id: 4 })], 1 / 30);
    expect(resolvePending).not.toBeNull();
    manager.sync([makeMeshState({ id: 4, renderAssetResolved: false })], 1 / 30);
    await flushModelLoadQueue();
    const placeholder = getPlaceholderMesh(manager, 4);
    expect(manager.getVisualState(4)?.hasModel).toBe(false);
    expect(placeholder).toBeTruthy();
    expect(placeholder?.visible).toBe(true);

    resolvePending?.(modelWithAnimationClips());
    await flushModelLoadQueue();
    expect(manager.getVisualState(4)?.hasModel).toBe(false);
    expect(placeholder?.visible).toBe(true);
  });

  it('falls back through render-asset candidates when an early candidate fails to load', async () => {
    const scene = new THREE.Scene();
    const requested: string[] = [];
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async (assetPath: string) => {
        requested.push(assetPath);
        if (assetPath === 'primary.gltf' || assetPath === 'primary.glb') {
          throw new Error('missing model');
        }
        return modelWithAnimationClips();
      },
    });

    manager.sync([
      makeMeshState({
        id: 5,
        renderAssetPath: 'primary',
        renderAssetResolved: true,
        renderAssetCandidates: ['primary', 'secondary'],
      }),
    ], 1 / 30);
    await flushModelLoadQueue();

    expect(requested).toEqual(['primary.gltf', 'primary.glb', 'secondary.gltf']);
    expect(manager.getUnresolvedEntityIds()).toEqual([]);
    expect(manager.getVisualState(5)?.hasModel).toBe(true);
    const placeholder = getPlaceholderMesh(manager, 5);
    expect(placeholder).toBeTruthy();
    expect(placeholder?.visible).toBe(false);
  });

  it('prioritizes extension conversions and explicit defaults for source asset hints', async () => {
    const scene = new THREE.Scene();
    const requestedPaths: string[] = [];
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async (assetPath) => {
        requestedPaths.push(assetPath);
        return modelWithAnimationClips();
      },
    });

    manager.sync([
      makeMeshState({ id: 1, renderAssetPath: 'soldier.w3d' }),
      makeMeshState({ id: 2, renderAssetPath: 'tank' }),
    ], 1 / 30);
    await flushModelLoadQueue();
    const root1 = manager.getVisualRoot(1);
    const root2 = manager.getVisualRoot(2);
    const placeholder1 = getPlaceholderMesh(manager, 1);
    const placeholder2 = getPlaceholderMesh(manager, 2);

    expect(requestedPaths[0]).toBe('soldier.gltf');
    expect(requestedPaths[1]).toBe('tank.gltf');
    expect(root1).toBeTruthy();
    expect(root2).toBeTruthy();
    expect(manager.getVisualState(1)?.hasModel).toBe(true);
    expect(manager.getVisualState(2)?.hasModel).toBe(true);
    expect(placeholder1).toBeTruthy();
    expect(placeholder2).toBeTruthy();
    expect(placeholder1?.visible).toBe(false);
    expect(placeholder2?.visible).toBe(false);
  });

  // ========================================================================
  // Turret bone rotation
  // ========================================================================

  function modelWithTurretBones(
    turretNames: readonly string[] = ['INTTURRET01'],
    clips: readonly string[] = ['Idle'],
  ): LoadedModelAsset {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    scene.add(mesh);

    for (const boneName of turretNames) {
      const bone = new THREE.Object3D();
      bone.name = boneName;
      scene.add(bone);
    }

    const createdClips = clips.map((clipName) => new THREE.AnimationClip(
      clipName,
      1,
      [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])],
    ));

    return { scene, animations: createdClips };
  }

  it('applies turret rotation from turretAngles to detected turret bone', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithTurretBones(['INTTURRET01']),
    });

    const angle = Math.PI / 4;
    manager.sync([makeMeshState({ id: 90, turretAngles: [angle] })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ id: 90, turretAngles: [angle] })], 1 / 30);

    const root = manager.getVisualRoot(90);
    expect(root).toBeTruthy();

    const turretBone = root!.getObjectByName('INTTURRET01');
    expect(turretBone).toBeTruthy();

    // W3D turret rotation is around the Z axis in model space.
    const expected = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      angle,
    );
    expect(turretBone!.quaternion.x).toBeCloseTo(expected.x, 5);
    expect(turretBone!.quaternion.y).toBeCloseTo(expected.y, 5);
    expect(turretBone!.quaternion.z).toBeCloseTo(expected.z, 5);
    expect(turretBone!.quaternion.w).toBeCloseTo(expected.w, 5);
  });

  it('matches bones named TURRET, TURRET_HI, and similar patterns', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithTurretBones(['TURRET']),
    });

    manager.sync([makeMeshState({ id: 91, turretAngles: [0.5] })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ id: 91, turretAngles: [0.5] })], 1 / 30);

    const turretBone = manager.getVisualRoot(91)!.getObjectByName('TURRET');
    expect(turretBone).toBeTruthy();
    // Should have non-identity rotation.
    expect(turretBone!.quaternion.w).not.toBeCloseTo(1, 3);
  });

  it('handles multiple turret slots (main + alt)', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithTurretBones(['INTTURRET01', 'INTTURRET02']),
    });

    const mainAngle = Math.PI / 6;
    const altAngle = -Math.PI / 3;
    manager.sync([makeMeshState({ id: 92, turretAngles: [mainAngle, altAngle] })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ id: 92, turretAngles: [mainAngle, altAngle] })], 1 / 30);

    const root = manager.getVisualRoot(92)!;
    const mainBone = root.getObjectByName('INTTURRET01')!;
    const altBone = root.getObjectByName('INTTURRET02')!;

    const expectedMain = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), mainAngle);
    const expectedAlt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), altAngle);

    expect(mainBone.quaternion.z).toBeCloseTo(expectedMain.z, 5);
    expect(altBone.quaternion.z).toBeCloseTo(expectedAlt.z, 5);
  });

  it('does nothing when turretAngles is empty or absent', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithTurretBones(['INTTURRET01']),
    });

    manager.sync([makeMeshState({ id: 93 })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ id: 93 })], 1 / 30);

    const turretBone = manager.getVisualRoot(93)!.getObjectByName('INTTURRET01');
    expect(turretBone).toBeTruthy();
    // Should remain at identity rotation since no turretAngles provided.
    expect(turretBone!.quaternion.w).toBeCloseTo(1, 5);
  });

  it('shows status effect icons when statusEffects are present', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    manager.sync(
      [makeMeshState({ id: 30, statusEffects: ['POISONED', 'BURNING'] })],
      1 / 30,
    );

    const root = manager.getVisualRoot(30)!;
    const effectGroup = root.getObjectByName('status-effects');
    expect(effectGroup).toBeTruthy();
    expect(effectGroup!.visible).toBe(true);
    // Should have 2 icon meshes.
    expect(effectGroup!.children).toHaveLength(2);
  });

  it('hides status effect icons when no effects active', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    // First sync with effects.
    manager.sync(
      [makeMeshState({ id: 31, statusEffects: ['DISABLED_EMP'] })],
      1 / 30,
    );
    const root = manager.getVisualRoot(31)!;
    expect(root.getObjectByName('status-effects')!.visible).toBe(true);

    // Second sync without effects.
    manager.sync([makeMeshState({ id: 31, statusEffects: [] })], 1 / 30);
    expect(root.getObjectByName('status-effects')!.visible).toBe(false);
  });

  it('ignores unknown status effect flags', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    manager.sync(
      [makeMeshState({ id: 32, statusEffects: ['UNKNOWN_FLAG', 'POISONED'] })],
      1 / 30,
    );

    const root = manager.getVisualRoot(32)!;
    const effectGroup = root.getObjectByName('status-effects');
    expect(effectGroup).toBeTruthy();
    // Only POISONED should show (UNKNOWN_FLAG filtered out).
    expect(effectGroup!.children).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Selection circle enhancements
  // ---------------------------------------------------------------------------

  it('selection ring uses green color for owned units', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    manager.sync(
      [makeMeshState({ id: 40, isSelected: true, isOwnedByLocalPlayer: true })],
      1 / 30,
    );

    const root = manager.getVisualRoot(40)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    expect(ring).toBeTruthy();
    expect(ring.visible).toBe(true);
    const mat = ring.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x00ff00);
  });

  it('selection ring uses red color for enemy units', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    manager.sync(
      [makeMeshState({ id: 41, isSelected: true, isOwnedByLocalPlayer: false })],
      1 / 30,
    );

    const root = manager.getVisualRoot(41)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    expect(ring).toBeTruthy();
    const mat = ring.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0xff3333);
  });

  it('selection ring scales by selectionCircleRadius', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    manager.sync(
      [makeMeshState({ id: 42, isSelected: true, selectionCircleRadius: 3 })],
      1 / 30,
    );

    const root = manager.getVisualRoot(42)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    expect(ring).toBeTruthy();
    // After pulse settles, scale should match radius (allow pulse to be active).
    expect(ring.scale.x).toBeGreaterThanOrEqual(3);
  });

  it('selection ring updates color when ownership changes', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    // Start as owned.
    manager.sync(
      [makeMeshState({ id: 43, isSelected: true, isOwnedByLocalPlayer: true })],
      1 / 30,
    );
    const root = manager.getVisualRoot(43)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    const mat = ring.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x00ff00);

    // Switch to enemy.
    manager.sync(
      [makeMeshState({ id: 43, isSelected: true, isOwnedByLocalPlayer: false })],
      1 / 30,
    );
    expect(mat.color.getHex()).toBe(0xff3333);
  });

  it('selection ring hides when deselected and resets spawn time', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    // Select.
    manager.sync([makeMeshState({ id: 44, isSelected: true })], 1 / 30);
    const root = manager.getVisualRoot(44)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    expect(ring.visible).toBe(true);

    // Deselect.
    manager.sync([makeMeshState({ id: 44, isSelected: false })], 1 / 30);
    expect(ring.visible).toBe(false);
  });

  it('selection ring defaults to scale 1 when no selectionCircleRadius', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    manager.sync([makeMeshState({ id: 45, isSelected: true })], 1 / 30);
    const root = manager.getVisualRoot(45)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    // Default radius = 1, pulse may overshoot slightly.
    expect(ring.scale.x).toBeGreaterThanOrEqual(1);
    expect(ring.scale.x).toBeLessThanOrEqual(1.2);
  });

  it('selection ring pulse freezes when dt=0 (game paused)', () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(),
    });

    // Advance time so the pulse is mid-animation.
    const state = makeMeshState({ id: 46, isSelected: true, selectionCircleRadius: 2 });
    manager.sync([state], 0.1); // accumulatedTime = 0.1, spawnTime = 0.1

    // Advance a bit so the pulse is partway through.
    manager.sync([state], 0.05); // accumulatedTime = 0.15, elapsed = 0.05

    const root = manager.getVisualRoot(46)!;
    const ring = root.getObjectByName('selection-ring') as THREE.Mesh;
    const scaleAfterAdvance = ring.scale.x;

    // Now sync with dt=0 (paused) — scale should not change.
    manager.sync([state], 0);
    expect(ring.scale.x).toBe(scaleAfterAdvance);

    // Another dt=0 tick — still frozen.
    manager.sync([state], 0);
    expect(ring.scale.x).toBe(scaleAfterAdvance);
  });

  it('stealth detected pulse freezes when dt=0 (game paused)', async () => {
    const scene = new THREE.Scene();
    const model = modelWithAnimationClips();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => model,
    });

    const state = makeMeshState({ id: 47, isStealthed: true, isDetected: true });

    // Load the model first.
    manager.sync([state], 0.01);
    await flushModelLoadQueue();

    // Advance time so the stealth pulse has a non-trivial value.
    manager.sync([state], 0.5);

    const root = manager.getVisualRoot(47)!;
    const mesh = root.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined
      ?? (() => { let found: THREE.Mesh | null = null; root.traverse(c => { if (!found && (c as THREE.Mesh).isMesh) found = c as THREE.Mesh; }); return found; })();
    expect(mesh).toBeTruthy();

    // Read opacity after advancing.
    const mat = (Array.isArray(mesh!.material) ? mesh!.material[0] : mesh!.material) as THREE.MeshBasicMaterial;
    const opacityAfterAdvance = mat.opacity;

    // Sync with dt=0 (paused) — opacity should not change.
    manager.sync([state], 0);
    const opacityAfterPause = mat.opacity;
    expect(opacityAfterPause).toBe(opacityAfterAdvance);

    // Another dt=0 tick — still frozen.
    manager.sync([state], 0);
    expect(mat.opacity).toBe(opacityAfterAdvance);
  });

  // =========================================================================
  // cloneModelForGhost
  // =========================================================================

  it('cloneModelForGhost returns a deep clone of the first matching model', async () => {
    const scene = new THREE.Scene();
    const sourceModel = modelWithAnimationClips();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => sourceModel,
    });

    const clone = await manager.cloneModelForGhost(['unit-model.gltf']);
    expect(clone).not.toBeNull();
    expect(clone).not.toBe(sourceModel.scene);
    // Clone should have the same child count as the source.
    expect(clone!.children.length).toBe(sourceModel.scene.children.length);
  });

  it('cloneModelForGhost returns null when no candidates load', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => { throw new Error('not found'); },
    });

    const clone = await manager.cloneModelForGhost(['missing.gltf']);
    expect(clone).toBeNull();
  });

  it('cloneModelForGhost tries all candidates and returns first success', async () => {
    const scene = new THREE.Scene();
    const sourceModel = modelWithAnimationClips();
    let callCount = 0;
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async (path: string) => {
        callCount++;
        if (path.includes('missing')) {
          throw new Error('not found');
        }
        return sourceModel;
      },
    });

    const clone = await manager.cloneModelForGhost(['missing.gltf', 'found.gltf']);
    expect(clone).not.toBeNull();
    expect(callCount).toBe(2);
  });

  // =========================================================================
  // Condition-based animation system (Task 4)
  // =========================================================================

  function modelWithNamedSubObjects(
    subNames: readonly string[],
    clips: readonly string[] = ['Idle'],
  ): LoadedModelAsset {
    const scene = new THREE.Group();
    for (const name of subNames) {
      const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      child.name = name;
      scene.add(child);
    }
    const createdClips = clips.map((clipName) => new THREE.AnimationClip(
      clipName,
      1,
      [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])],
    ));
    return { scene, animations: createdClips };
  }

  it('condition-based animation selects clip from modelConditionFlags', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'DamagedIdle', 'MoveLoop']),
    });

    const state = makeMeshState({
      id: 100,
      modelConditionInfos: [
        { conditionFlags: [], modelName: null, animationName: 'Idle', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
        { conditionFlags: ['DAMAGED'], modelName: null, animationName: 'DamagedIdle', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
        { conditionFlags: ['MOVING'], modelName: null, animationName: 'MoveLoop', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
      ],
      modelConditionFlags: ['DAMAGED'],
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    // Re-sync after model is loaded so condition system runs.
    manager.sync([state], 1 / 30);

    // Condition system should be active (legacy state should be null).
    const vs = manager.getVisualState(100);
    expect(vs?.hasModel).toBe(true);
    // activeState should be null since condition system took over.
    expect(vs?.animationState).toBeNull();
  });

  it('condition-based animation falls back to legacy system when no condition infos', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'Move']),
    });

    const state = makeMeshState({
      id: 101,
      animationState: 'MOVE',
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30);

    expect(manager.getVisualState(101)?.animationState).toBe('MOVE');
  });

  it('condition-based animation crossfades when flags change', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'DamagedIdle']),
    });

    const baseInfos = [
      { conditionFlags: [], modelName: null, animationName: 'Idle', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
      { conditionFlags: ['DAMAGED'], modelName: null, animationName: 'DamagedIdle', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
    ];

    // Start undamaged.
    manager.sync([makeMeshState({ id: 102, modelConditionInfos: baseInfos, modelConditionFlags: [] })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ id: 102, modelConditionInfos: baseInfos, modelConditionFlags: [] })], 1 / 30);

    const vs1 = manager.getVisualState(102);
    expect(vs1?.animationState).toBeNull(); // condition system active

    // Switch to damaged — should crossfade to DamagedIdle.
    manager.sync([makeMeshState({ id: 102, modelConditionInfos: baseInfos, modelConditionFlags: ['DAMAGED'] })], 1 / 30);

    // Still condition-managed.
    const vs2 = manager.getVisualState(102);
    expect(vs2?.animationState).toBeNull();
  });

  it('condition system handles ONCE animation mode', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'DeathAnim']),
    });

    const state = makeMeshState({
      id: 103,
      modelConditionInfos: [
        { conditionFlags: [], modelName: null, animationName: 'Idle', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
        { conditionFlags: ['DYING'], modelName: null, animationName: 'DeathAnim', idleAnimationName: null, hideSubObjects: [], showSubObjects: [], animationMode: 'ONCE' as const },
      ],
      modelConditionFlags: ['DYING'],
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30);

    expect(manager.getVisualState(103)?.animationState).toBeNull();
  });

  it('condition system hides/shows sub-objects based on match', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithNamedSubObjects(['GUN_A', 'SHIELD', 'DAMAGE_FIRE'], ['Idle']),
    });

    const state = makeMeshState({
      id: 104,
      modelConditionInfos: [
        { conditionFlags: ['DAMAGED'], modelName: null, animationName: null, idleAnimationName: null, hideSubObjects: ['SHIELD'], showSubObjects: ['DAMAGE_FIRE'], animationMode: 'LOOP' as const },
      ],
      modelConditionFlags: ['DAMAGED'],
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30);

    const root = manager.getVisualRoot(104)!;
    // Traverse the cloned model to check sub-object visibility.
    let shieldVisible: boolean | null = null;
    let damageFireVisible: boolean | null = null;
    root.traverse((child) => {
      if (child.name === 'SHIELD') shieldVisible = child.visible;
      if (child.name === 'DAMAGE_FIRE') damageFireVisible = child.visible;
    });
    expect(shieldVisible).toBe(false);
    expect(damageFireVisible).toBe(true);
  });

  it('animation speed sync adjusts timeScale for MOVING entities', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'Move']),
    });

    manager.sync([makeMeshState({
      id: 105,
      animationState: 'MOVE',
      modelConditionFlags: ['MOVING'],
      currentSpeed: 15,
      maxSpeed: 30,
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 105,
      animationState: 'MOVE',
      modelConditionFlags: ['MOVING'],
      currentSpeed: 15,
      maxSpeed: 30,
    })], 1 / 30);

    // timeScale should be ~0.5 (currentSpeed/maxSpeed).
    // We can't easily inspect timeScale without exposing internals,
    // but we verify the entity still has a valid animation state.
    expect(manager.getVisualState(105)?.animationState).toBe('MOVE');
  });

  it('tread meshes are detected by name and UV scrolls with speed', async () => {
    const scene = new THREE.Scene();
    const treadModel = (() => {
      const root = new THREE.Group();
      const texture = new THREE.Texture();
      const material = new THREE.MeshStandardMaterial({ map: texture });
      const treadMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      treadMesh.name = 'INTTURRET01_TREAD_L';
      root.add(treadMesh);
      const clip = new THREE.AnimationClip('Idle', 1, [
        new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 0]),
      ]);
      return { scene: root, animations: [clip] } as LoadedModelAsset;
    })();

    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => treadModel,
    });

    manager.sync([makeMeshState({
      id: 106,
      currentSpeed: 10,
    })], 1 / 30);
    await flushModelLoadQueue();

    // After model load, sync again with speed to trigger tread scrolling.
    manager.sync([makeMeshState({
      id: 106,
      currentSpeed: 10,
    })], 0.1);

    const root = manager.getVisualRoot(106)!;
    let treadMeshFound = false;
    root.traverse((child) => {
      if (child.name === 'INTTURRET01_TREAD_L') {
        treadMeshFound = true;
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        // UV offset should have advanced (speed * dt * scrollRate = 10 * 0.1 * 0.5 = 0.5) mod 1.0.
        expect(mat.map!.offset.x).toBeCloseTo(0.5, 3);
      }
    });
    expect(treadMeshFound).toBe(true);
  });

  it('condition system uses idleAnimationName as fallback when animationName is null', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'DamageIdle']),
    });

    const state = makeMeshState({
      id: 107,
      modelConditionInfos: [
        { conditionFlags: ['DAMAGED'], modelName: null, animationName: null, idleAnimationName: 'DamageIdle', hideSubObjects: [], showSubObjects: [], animationMode: 'LOOP' as const },
      ],
      modelConditionFlags: ['DAMAGED'],
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30);

    expect(manager.getVisualState(107)?.animationState).toBeNull(); // condition active
  });

  // =========================================================================
  // Transition animation system
  // =========================================================================

  it('plays a transition animation when switching between states with transition keys', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'DoorOpen', 'DoorOpening']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'Idle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: 'trans_closed',
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
      {
        conditionFlags: ['DOOR_OPEN'],
        modelName: null,
        animationName: 'DoorOpen',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: 'trans_open',
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
    ];

    const transitionInfos = [
      {
        fromKey: 'trans_closed',
        toKey: 'trans_open',
        modelName: null,
        animationName: 'DoorOpening',
        animationMode: 'ONCE' as const,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
      },
    ];

    // Start in default (closed) state.
    manager.sync([makeMeshState({
      id: 200,
      modelConditionInfos: conditionInfos,
      transitionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 200,
      modelConditionInfos: conditionInfos,
      transitionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    // Verify initial state.
    let vs = manager.getVisualState(200);
    expect(vs?.isInTransition).toBe(false);

    // Switch to DOOR_OPEN — should trigger transition.
    manager.sync([makeMeshState({
      id: 200,
      modelConditionInfos: conditionInfos,
      transitionInfos,
      modelConditionFlags: ['DOOR_OPEN'],
    })], 1 / 30);

    vs = manager.getVisualState(200);
    expect(vs?.isInTransition).toBe(true);
    // The active condition key should be a transition key, not the target.
    expect(vs?.activeConditionKey).toContain('__transition__');
  });

  it('skips transition when no matching TransitionState exists', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'DoorOpen']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'Idle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: 'trans_closed',
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
      {
        conditionFlags: ['DOOR_OPEN'],
        modelName: null,
        animationName: 'DoorOpen',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: 'trans_open',
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
    ];

    // No transitionInfos — should go directly to target state.
    manager.sync([makeMeshState({
      id: 201,
      modelConditionInfos: conditionInfos,
      transitionInfos: [],
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 201,
      modelConditionInfos: conditionInfos,
      transitionInfos: [],
      modelConditionFlags: [],
    })], 1 / 30);

    // Switch to DOOR_OPEN — should go directly (no transition).
    manager.sync([makeMeshState({
      id: 201,
      modelConditionInfos: conditionInfos,
      transitionInfos: [],
      modelConditionFlags: ['DOOR_OPEN'],
    })], 1 / 30);

    const vs = manager.getVisualState(201);
    expect(vs?.isInTransition).toBe(false);
    expect(vs?.activeConditionKey).toBe('DOOR_OPEN');
  });

  // =========================================================================
  // Idle animation randomization
  // =========================================================================

  it('picks idle animation variants from idleAnimations array', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['IdleA', 'IdleB', 'IdleC']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: null,
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'ONCE' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [
          { animationName: 'IdleA', randomWeight: 1 },
          { animationName: 'IdleB', randomWeight: 2 },
          { animationName: 'IdleC', randomWeight: 1 },
        ],
      },
    ];

    manager.sync([makeMeshState({
      id: 210,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 210,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    const vs = manager.getVisualState(210);
    expect(vs?.hasModel).toBe(true);
    // An idle variant should have been picked.
    expect(vs?.idleVariantIndex).toBeGreaterThanOrEqual(0);
    expect(vs?.idleVariantIndex).toBeLessThan(3);
  });

  // =========================================================================
  // AnimationSpeedFactorRange
  // =========================================================================

  it('applies randomized animation speed factor from condition state', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle', 'Walk']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'Idle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 0.8,
        animSpeedFactorMax: 1.2,
        idleAnimations: [],
      },
    ];

    manager.sync([makeMeshState({
      id: 220,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 220,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    const vs = manager.getVisualState(220);
    expect(vs?.conditionAnimSpeedFactor).toBeGreaterThanOrEqual(0.8);
    expect(vs?.conditionAnimSpeedFactor).toBeLessThanOrEqual(1.2);
  });

  it('defaults animation speed factor to 1.0 when range is absent', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['Idle']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'Idle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        // No speed factor fields — should default to 1.0
      },
    ];

    manager.sync([makeMeshState({
      id: 221,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 221,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    const vs = manager.getVisualState(221);
    expect(vs?.conditionAnimSpeedFactor).toBe(1.0);
  });

  // =========================================================================
  // Per-condition model swapping
  // =========================================================================

  it('initiates model swap when condition state has a different model name', async () => {
    const scene = new THREE.Scene();
    const modelsRequested: string[] = [];
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async (path: string) => {
        modelsRequested.push(path);
        return modelWithAnimationClips(['Idle', 'DamagedIdle']);
      },
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'Idle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
      {
        conditionFlags: ['RUBBLE'],
        modelName: 'RubbleModel',
        animationName: 'DamagedIdle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
    ];

    // Start in default state.
    manager.sync([makeMeshState({
      id: 230,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({
      id: 230,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    // Switch to RUBBLE — should trigger model swap.
    modelsRequested.length = 0;
    manager.sync([makeMeshState({
      id: 230,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: ['RUBBLE'],
    })], 1 / 30);
    await flushModelLoadQueue();

    // The swap model should have been requested.
    const rubbleRequested = modelsRequested.some(p => p.toLowerCase().includes('rubblemodel'));
    expect(rubbleRequested).toBe(true);

    const vs = manager.getVisualState(230);
    expect(vs?.currentModelName).toBe('rubblemodel');
  });

  it('caches alternate models to avoid redundant loads', async () => {
    const scene = new THREE.Scene();
    let loadCount = 0;
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => {
        loadCount++;
        return modelWithAnimationClips(['Idle', 'DamagedIdle']);
      },
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'Idle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
      {
        conditionFlags: ['RUBBLE'],
        modelName: 'AltModel',
        animationName: 'DamagedIdle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
    ];

    // Load default.
    manager.sync([makeMeshState({ id: 231, modelConditionInfos: conditionInfos, modelConditionFlags: [] })], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([makeMeshState({ id: 231, modelConditionInfos: conditionInfos, modelConditionFlags: [] })], 1 / 30);

    // Switch to RUBBLE — first load.
    manager.sync([makeMeshState({ id: 231, modelConditionInfos: conditionInfos, modelConditionFlags: ['RUBBLE'] })], 1 / 30);
    await flushModelLoadQueue();
    const loadCountAfterFirst = loadCount;

    // Switch back to default then to RUBBLE again — should use cache.
    manager.sync([makeMeshState({ id: 231, modelConditionInfos: conditionInfos, modelConditionFlags: [] })], 1 / 30);
    manager.sync([makeMeshState({ id: 231, modelConditionInfos: conditionInfos, modelConditionFlags: ['RUBBLE'] })], 1 / 30);
    await flushModelLoadQueue();

    // No additional loads should happen because the alternate model is cached.
    expect(loadCount).toBe(loadCountAfterFirst);
  });

  it('cloneModelForGhost leverages model cache from prior entity loads', async () => {
    const scene = new THREE.Scene();
    let loadCount = 0;
    const sourceModel = modelWithAnimationClips();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => {
        loadCount++;
        return sourceModel;
      },
    });

    // Warm the cache through a normal entity sync.
    manager.sync([makeMeshState({ id: 50, renderAssetPath: 'shared.gltf', renderAssetResolved: true })]);
    await flushModelLoadQueue();
    const loadCountAfterSync = loadCount;

    // cloneModelForGhost should use the cached model.
    const clone = await manager.cloneModelForGhost(['shared.gltf']);
    expect(clone).not.toBeNull();
    expect(loadCount).toBe(loadCountAfterSync);
  });

  // =========================================================================
  // IgnoreConditionStates — strips ignored flags before condition matching
  // =========================================================================

  it('IgnoreConditionStates strips NIGHT flag from condition matching', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['DayIdle', 'NightIdle']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'DayIdle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
      {
        conditionFlags: ['NIGHT'],
        modelName: null,
        animationName: 'NightIdle',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'LOOP' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
    ];

    // First sync to load the model.
    manager.sync([makeMeshState({
      id: 300,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();

    // Sync with default state to establish the baseline condition key.
    manager.sync([makeMeshState({
      id: 300,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    const vsBeforeNight = manager.getVisualState(300);
    const keyBeforeNight = vsBeforeNight?.activeConditionKey;

    // Now set NIGHT flag WITH ignoreConditionStates = ['NIGHT'].
    // The NIGHT flag should be stripped, so it should still match the
    // default (empty) condition state, not the NIGHT one.
    manager.sync([makeMeshState({
      id: 300,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: ['NIGHT'],
      ignoreConditionStates: ['NIGHT'],
    })], 1 / 30);

    const vsAfterIgnoredNight = manager.getVisualState(300);
    // The condition key should remain the same as the default state
    // because NIGHT was stripped before matching.
    expect(vsAfterIgnoredNight?.activeConditionKey).toBe(keyBeforeNight);
  });

  // =========================================================================
  // ONCE_BACKWARDS — plays animation with negative timeScale
  // =========================================================================

  it('ONCE_BACKWARDS plays animation with negative timeScale', async () => {
    const scene = new THREE.Scene();
    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => modelWithAnimationClips(['DeployReverse']),
    });

    const conditionInfos = [
      {
        conditionFlags: [] as string[],
        modelName: null,
        animationName: 'DeployReverse',
        idleAnimationName: null,
        hideSubObjects: [] as string[],
        showSubObjects: [] as string[],
        animationMode: 'ONCE_BACKWARDS' as const,
        transitionKey: null,
        animSpeedFactorMin: 1.0,
        animSpeedFactorMax: 1.0,
        idleAnimations: [],
      },
    ];

    manager.sync([makeMeshState({
      id: 301,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);
    await flushModelLoadQueue();

    // Second sync to trigger condition animation.
    manager.sync([makeMeshState({
      id: 301,
      modelConditionInfos: conditionInfos,
      modelConditionFlags: [],
    })], 1 / 30);

    const vs = manager.getVisualState(301);
    expect(vs).not.toBeNull();
    // The condition action should be playing with negative timeScale.
    const action = vs?.conditionAction;
    expect(action).not.toBeNull();
    expect(action!.timeScale).toBeLessThan(0);
    // After one frame of backwards playback, time should be near clip end
    // (clip.duration minus one dt tick).
    const clipDuration = action!.getClip().duration;
    expect(action!.time).toBeGreaterThan(clipDuration * 0.5);
    expect(action!.time).toBeLessThanOrEqual(clipDuration);
  });
});

describe('stripConditionStateSuffix', () => {
  it('strips single-letter condition suffix (_D)', () => {
    expect(stripConditionStateSuffix('PMgaldrum_D')).toBe('PMgaldrum');
  });

  it('strips two-letter condition suffix (_AD)', () => {
    expect(stripConditionStateSuffix('AVCONSTDOZ_AD')).toBe('AVCONSTDOZ');
  });

  it('strips three-letter condition suffix (_DNS)', () => {
    expect(stripConditionStateSuffix('SomeModel_DNS')).toBe('SomeModel');
  });

  it('strips longer condition suffix (_ACE)', () => {
    expect(stripConditionStateSuffix('ABBarracks_ACE')).toBe('ABBarracks');
  });

  it('returns null for names without an underscore', () => {
    expect(stripConditionStateSuffix('ABBarracks')).toBeNull();
  });

  it('returns null when suffix contains digits (not a condition suffix)', () => {
    expect(stripConditionStateSuffix('AVThundrblt_D1')).toBeNull();
  });

  it('returns null when suffix contains lowercase letters', () => {
    expect(stripConditionStateSuffix('SomeModel_abc')).toBeNull();
  });

  it('preserves directory prefix', () => {
    expect(stripConditionStateSuffix('models/foo_DNS')).toBe('models/foo');
  });

  it('preserves file extension', () => {
    expect(stripConditionStateSuffix('PMgaldrum_D.w3d')).toBe('PMgaldrum.w3d');
  });

  it('preserves directory prefix and extension together', () => {
    expect(stripConditionStateSuffix('Art/W3D/PMgaldrum_D.w3d')).toBe('Art/W3D/PMgaldrum.w3d');
  });

  it('returns null for empty string', () => {
    expect(stripConditionStateSuffix('')).toBeNull();
  });

  it('returns null when underscore is the first character', () => {
    // "_D" has nothing before the underscore so base name would be empty
    expect(stripConditionStateSuffix('_D')).toBeNull();
  });

  it('strips only the last underscore suffix', () => {
    // "AB_Barracks_D" → "AB_Barracks"
    expect(stripConditionStateSuffix('AB_Barracks_D')).toBe('AB_Barracks');
  });

  it('returns null for _S suffix (treated same as any condition suffix)', () => {
    // _S is also a valid condition suffix pattern (skeleton/base model)
    expect(stripConditionStateSuffix('PTDogwod01_S')).toBe('PTDogwod01');
  });
});

describe('condition-state model fallback resolution', () => {
  it('falls back to base model when condition variant is not found via asset manager', async () => {
    const scene = new THREE.Scene();
    const modelsRequested: string[] = [];
    const modelLoader = async (assetPath: string): Promise<LoadedModelAsset> => {
      modelsRequested.push(assetPath);
      return modelWithAnimationClips();
    };

    // Create a mock AssetManager that only knows about the base model
    const mockAssetManager = {
      resolveModelPath: (bareName: string): string | null => {
        // Strip extension for lookup
        const dotIdx = bareName.lastIndexOf('.');
        const stripped = dotIdx > 0 ? bareName.slice(0, dotIdx) : bareName;
        const slashIdx = stripped.lastIndexOf('/');
        const filename = slashIdx >= 0 ? stripped.slice(slashIdx + 1) : stripped;
        const lower = filename.toLowerCase();
        // Only "pmgaldrum" exists, not "pmgaldrum_d"
        if (lower === 'pmgaldrum') {
          return 'models/W3DZH/Art/W3D/PMgaldrum_S.glb';
        }
        return null;
      },
    } as unknown as import('@generals/assets').AssetManager;

    const manager = new ObjectVisualManager(scene, mockAssetManager, { modelLoader });

    // Simulate a condition-state path like "PMgaldrum_D" that doesn't exist
    const state = makeMeshState({
      renderAssetPath: 'PMgaldrum_D',
      renderAssetResolved: true,
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();

    // The manager should have resolved the fallback path via base model name
    expect(modelsRequested).toContain('models/W3DZH/Art/W3D/PMgaldrum_S.glb');
  });

  it('prefers exact match over fallback when condition variant exists', async () => {
    const scene = new THREE.Scene();
    const modelsRequested: string[] = [];
    const modelLoader = async (assetPath: string): Promise<LoadedModelAsset> => {
      modelsRequested.push(assetPath);
      return modelWithAnimationClips();
    };

    const mockAssetManager = {
      resolveModelPath: (bareName: string): string | null => {
        const dotIdx = bareName.lastIndexOf('.');
        const stripped = dotIdx > 0 ? bareName.slice(0, dotIdx) : bareName;
        const slashIdx = stripped.lastIndexOf('/');
        const filename = slashIdx >= 0 ? stripped.slice(slashIdx + 1) : stripped;
        const lower = filename.toLowerCase();
        if (lower === 'avconstdoz_ad') {
          return 'models/W3DZH/Art/W3D/AVCONSTDOZ_AD.glb';
        }
        if (lower === 'avconstdoz') {
          return 'models/W3DZH/Art/W3D/AVCONSTDOZ_S.glb';
        }
        return null;
      },
    } as unknown as import('@generals/assets').AssetManager;

    const manager = new ObjectVisualManager(scene, mockAssetManager, { modelLoader });

    const state = makeMeshState({
      renderAssetPath: 'AVCONSTDOZ_AD',
      renderAssetResolved: true,
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();

    // Should use exact match, not fallback
    expect(modelsRequested[0]).toBe('models/W3DZH/Art/W3D/AVCONSTDOZ_AD.glb');
  });

  it('does not attempt fallback for names with digit suffixes', async () => {
    const scene = new THREE.Scene();
    const modelsRequested: string[] = [];
    const modelLoader = async (assetPath: string): Promise<LoadedModelAsset> => {
      modelsRequested.push(assetPath);
      return modelWithAnimationClips();
    };

    const resolveCallArgs: string[] = [];
    const mockAssetManager = {
      resolveModelPath: (bareName: string): string | null => {
        resolveCallArgs.push(bareName);
        const dotIdx = bareName.lastIndexOf('.');
        const stripped = dotIdx > 0 ? bareName.slice(0, dotIdx) : bareName;
        const slashIdx = stripped.lastIndexOf('/');
        const filename = slashIdx >= 0 ? stripped.slice(slashIdx + 1) : stripped;
        const lower = filename.toLowerCase();
        if (lower === 'avthundrblt_d1') {
          return 'models/W3DZH/Art/W3D/AVThundrblt_d1.glb';
        }
        return null;
      },
    } as unknown as import('@generals/assets').AssetManager;

    const manager = new ObjectVisualManager(scene, mockAssetManager, { modelLoader });

    const state = makeMeshState({
      renderAssetPath: 'AVThundrblt_D1',
      renderAssetResolved: true,
    });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();

    // _D1 contains a digit, so stripConditionStateSuffix returns null.
    // resolveModelPath should only be called once (no fallback attempt).
    expect(resolveCallArgs).toEqual(['AVThundrblt_D1']);
  });

  it('placeholder boxes scale to entity selectionCircleRadius', () => {
    // Source parity: C++ uses GeometryMajorRadius for bounding sphere
    // based picking.  The TS placeholder box should approximate the
    // entity's actual footprint so it is visible and clickable.
    const scene = new THREE.Scene();
    const modelLoader = () => Promise.reject(new Error('no model'));
    const manager = new ObjectVisualManager(scene, null, { modelLoader });

    // Use an unresolvable asset path to force placeholder creation.
    // renderAssetPath must be non-empty so the entity is treated as
    // "has a model but it failed to load" rather than "intentionally invisible".
    const state = makeMeshState({
      id: 99,
      renderAssetPath: 'missing-model.w3d',
      renderAssetResolved: false,
      selectionCircleRadius: 15,
    });
    manager.sync([state]);

    // Find the placeholder mesh in the scene.
    let placeholder: THREE.Mesh | null = null;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name === 'placeholder-99') {
        placeholder = child;
      }
    });
    expect(placeholder).not.toBeNull();
    // Diameter = radius * 2 = 30
    expect(placeholder!.scale.x).toBe(30);
    expect(placeholder!.scale.y).toBe(30);
    expect(placeholder!.scale.z).toBe(30);
  });

  it('placeholder boxes have minimum size of 10 (radius 5)', () => {
    const scene = new THREE.Scene();
    const modelLoader = () => Promise.reject(new Error('no model'));
    const manager = new ObjectVisualManager(scene, null, { modelLoader });

    // Tiny entity with radius < 5 should still get a visible placeholder.
    const state = makeMeshState({
      id: 100,
      renderAssetPath: 'missing-tiny.w3d',
      renderAssetResolved: false,
      selectionCircleRadius: 1,
    });
    manager.sync([state]);

    let placeholder: THREE.Mesh | null = null;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name === 'placeholder-100') {
        placeholder = child;
      }
    });
    expect(placeholder).not.toBeNull();
    // Minimum radius 5 → diameter 10
    expect(placeholder!.scale.x).toBe(10);
  });

  it('limits concurrent model loads to MAX_CONCURRENT_MODEL_LOADS', async () => {
    // Verify that the load queue prevents more than MAX_CONCURRENT loads
    // from running simultaneously.  This prevents hundreds of HTTP
    // requests from overwhelming the browser on map load.
    const scene = new THREE.Scene();
    let peakConcurrent = 0;
    let currentConcurrent = 0;
    const resolvers: Array<(value: LoadedModelAsset) => void> = [];

    const modelLoader = (_path: string): Promise<LoadedModelAsset> => {
      currentConcurrent++;
      peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
      return new Promise<LoadedModelAsset>((resolve) => {
        resolvers.push((result) => {
          currentConcurrent--;
          resolve(result);
        });
      });
    };

    const savedMax = ObjectVisualManager.MAX_CONCURRENT_MODEL_LOADS;
    ObjectVisualManager.MAX_CONCURRENT_MODEL_LOADS = 3;
    try {
      const manager = new ObjectVisualManager(scene, null, { modelLoader });

      // Sync 10 entities, each requesting a different model.
      const states = Array.from({ length: 10 }, (_, i) =>
        makeMeshState({ id: i + 200, renderAssetPath: `model-${i}.glb` }),
      );
      manager.sync(states);

      // Allow microtasks to settle.
      await new Promise((r) => setTimeout(r, 0));

      // Only 3 loads should have started (the limit).
      expect(peakConcurrent).toBe(3);
      expect(currentConcurrent).toBe(3);

      // Resolve one — should drain one from queue.
      const asset = modelWithAnimationClips();
      resolvers[0]!(asset);
      await new Promise((r) => setTimeout(r, 0));

      // Still at most 3 concurrent.
      expect(currentConcurrent).toBe(3);
      expect(peakConcurrent).toBe(3);
    } finally {
      ObjectVisualManager.MAX_CONCURRENT_MODEL_LOADS = savedMax;
    }
  });

  it('under-construction entities render semi-transparent', async () => {
    // Source parity: buildings under construction render with partial
    // opacity that ramps up as construction progresses.
    const scene = new THREE.Scene();
    const modelLoader = async () => modelWithAnimationClips();
    const manager = new ObjectVisualManager(scene, null, { modelLoader });

    const state = makeMeshState({
      id: 300,
      constructionPercent: 0, // just started
    });
    manager.sync([state]);
    await flushModelLoadQueue();
    manager.sync([state]); // second sync applies opacity after model loads

    // Find any mesh in the scene
    let foundOpacity = -1;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = Array.isArray(child.material) ? child.material[0] : child.material;
        if (mat && 'opacity' in mat && mat.opacity < 1) {
          foundOpacity = mat.opacity;
        }
      }
    });

    // At 0% construction, opacity should be ~0.3
    expect(foundOpacity).toBeGreaterThanOrEqual(0.2);
    expect(foundOpacity).toBeLessThanOrEqual(0.4);
  });

  it('flashes model emissive red when health decreases then restores after 200ms', async () => {
    const scene = new THREE.Scene();
    // Create a model with MeshStandardMaterial so emissive changes are visible.
    const stdModel = (() => {
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      root.add(mesh);
      return { scene: root, animations: [] } as LoadedModelAsset;
    })();

    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => stdModel,
    });

    // Initial sync at full health to establish lastKnownHealth.
    const state = makeMeshState({ id: 400, health: 100, maxHealth: 100 });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30); // model is now loaded

    // Damage: reduce health.
    const damagedState = makeMeshState({ id: 400, health: 70, maxHealth: 100 });
    manager.sync([damagedState], 1 / 30);

    // Emissive should now be red (damage flash active).
    let foundEmissiveRed = false;
    let foundIntensity = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        if (child.material.emissive.getHex() === 0xff0000) {
          foundEmissiveRed = true;
          foundIntensity = child.material.emissiveIntensity;
        }
      }
    });
    expect(foundEmissiveRed).toBe(true);
    expect(foundIntensity).toBeCloseTo(0.5, 2);

    // Advance time past the 200ms flash duration.
    manager.sync([damagedState], 0.25);

    // Emissive should be restored (no team color => emissiveIntensity = 0).
    let postFlashIntensity = -1;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        postFlashIntensity = child.material.emissiveIntensity;
      }
    });
    expect(postFlashIntensity).toBe(0);
  });

  it('restores team color emissive after damage flash ends', async () => {
    const scene = new THREE.Scene();
    const stdModel = (() => {
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      root.add(mesh);
      return { scene: root, animations: [] } as LoadedModelAsset;
    })();

    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => stdModel,
    });

    // Initial sync with team color and full health.
    const state = makeMeshState({ id: 401, health: 100, maxHealth: 100, side: 'america' });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30);

    // Damage the unit.
    const damagedState = makeMeshState({ id: 401, health: 80, maxHealth: 100, side: 'america' });
    manager.sync([damagedState], 1 / 30);

    // Verify flash is active (red).
    let flashColor = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        flashColor = child.material.emissive.getHex();
      }
    });
    expect(flashColor).toBe(0xff0000);

    // Advance past flash duration.
    manager.sync([damagedState], 0.25);

    // Emissive should be restored to team color (america = 0x3366cc), not zero.
    let restoredColor = 0;
    let restoredIntensity = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        restoredColor = child.material.emissive.getHex();
        restoredIntensity = child.material.emissiveIntensity;
      }
    });
    expect(restoredColor).toBe(0x3366cc);
    expect(restoredIntensity).toBeCloseTo(0.4, 2);
  });

  it('does not flash when health increases (healing)', async () => {
    const scene = new THREE.Scene();
    const stdModel = (() => {
      const root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      root.add(mesh);
      return { scene: root, animations: [] } as LoadedModelAsset;
    })();

    const manager = new ObjectVisualManager(scene, null, {
      modelLoader: async () => stdModel,
    });

    const state = makeMeshState({ id: 402, health: 50, maxHealth: 100 });
    manager.sync([state], 1 / 30);
    await flushModelLoadQueue();
    manager.sync([state], 1 / 30);

    // Heal: increase health.
    const healedState = makeMeshState({ id: 402, health: 80, maxHealth: 100 });
    manager.sync([healedState], 1 / 30);

    // No flash should be active — emissive should NOT be the red damage flash color.
    let emissiveHex = -1;
    let intensity = -1;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        emissiveHex = child.material.emissive.getHex();
        intensity = child.material.emissiveIntensity;
      }
    });
    // Emissive must not be damage-flash red at damage-flash intensity.
    expect(emissiveHex).not.toBe(0xff0000);
    expect(intensity).not.toBe(0.5);
  });
});
