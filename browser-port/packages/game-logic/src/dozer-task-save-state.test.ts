import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

function makeDozerTaskBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
          RepairHealthPercentPerSecond: 5,
          BoredTime: 30000,
          BoredRange: 150,
        }),
      ]),
      makeObjectDef('USABarracks', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      ]),
    ],
  });
}

describe('dozer task save-state', () => {
  it('stores dozer build and repair targets on entities instead of the browser runtime blob', () => {
    const bundle = makeDozerTaskBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('USADozer', 20, 20),
      makeMapObject('USABarracks', 40, 40),
      makeMapObject('USABarracks', 60, 60),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      setDozerTaskTarget: (entityId: number, task: 'BUILD' | 'REPAIR', targetEntityId: number | null) => void;
      spawnedEntities: Map<number, {
        dozerBuildTargetEntityId: number;
        dozerBuildTaskOrderFrame: number;
        dozerRepairTargetEntityId: number;
        dozerRepairTaskOrderFrame: number;
      }>;
      pendingConstructionActions: Map<number, number>;
      pendingRepairActions: Map<number, number>;
      frameCounter: number;
    };

    privateLogic.frameCounter = 250;
    privateLogic.setDozerTaskTarget(1, 'BUILD', 2);
    privateLogic.setDozerTaskTarget(1, 'REPAIR', 3);
    const dozer = privateLogic.spawnedEntities.get(1);
    if (!dozer) {
      throw new Error('Expected dozer entity');
    }
    dozer.dozerBuildTaskOrderFrame = 200;
    dozer.dozerRepairTaskOrderFrame = 250;

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingConstructionActions');
    expect(browserState).not.toHaveProperty('pendingRepairActions');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    const restoredDozer = restoredPrivate.spawnedEntities.get(1);
    expect(restoredDozer?.dozerBuildTargetEntityId).toBe(2);
    expect(restoredDozer?.dozerBuildTaskOrderFrame).toBe(200);
    expect(restoredDozer?.dozerRepairTargetEntityId).toBe(3);
    expect(restoredDozer?.dozerRepairTaskOrderFrame).toBe(250);
    expect(restoredPrivate.pendingConstructionActions.get(1)).toBe(2);
    expect(restoredPrivate.pendingRepairActions.get(1)).toBe(3);
  });

  it('hydrates legacy browser dozer task maps into entity-owned state', () => {
    const bundle = makeDozerTaskBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('USADozer', 20, 20),
      makeMapObject('USABarracks', 40, 40),
      makeMapObject('USABarracks', 60, 60),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingConstructionActions: new Map([[1, 2]]),
      pendingRepairActions: new Map([[1, 3]]),
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        dozerBuildTargetEntityId: number;
        dozerRepairTargetEntityId: number;
      }>;
      pendingConstructionActions: Map<number, number>;
      pendingRepairActions: Map<number, number>;
    };

    const restoredDozer = privateLogic.spawnedEntities.get(1);
    expect(restoredDozer?.dozerBuildTargetEntityId).toBe(2);
    expect(restoredDozer?.dozerRepairTargetEntityId).toBe(3);
    expect(privateLogic.pendingConstructionActions.get(1)).toBe(2);
    expect(privateLogic.pendingRepairActions.get(1)).toBe(3);
  });
});
