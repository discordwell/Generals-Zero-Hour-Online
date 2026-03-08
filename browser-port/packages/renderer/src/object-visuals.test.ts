import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LoadedModelAsset } from './object-visuals.js';
import { ObjectVisualManager, type RenderableEntityState } from './object-visuals.js';

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
});
