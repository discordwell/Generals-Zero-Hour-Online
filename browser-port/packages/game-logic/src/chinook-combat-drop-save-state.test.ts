import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeLocomotorDef,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

function makeChinookCombatDropBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('SupplyChinook', 'America', ['AIRCRAFT', 'TRANSPORT'], [
        makeBlock('Behavior', 'ChinookAIUpdate ModuleTag_ChinookAI', {
          NumRopes: 1,
          PerRopeDelayMin: 0,
          PerRopeDelayMax: 0,
          WaitForRopesToDrop: false,
          MinDropHeight: 30,
          RappelSpeed: 30,
        }),
        makeBlock('LocomotorSet', 'SET_NORMAL ChinookLocomotor', {}),
      ]),
      makeObjectDef('Ranger', 'America', ['INFANTRY', 'CAN_RAPPEL'], []),
    ],
    locomotors: [
      makeLocomotorDef('ChinookLocomotor', 120),
    ],
  });
}

describe('chinook combat-drop save-state', () => {
  it('stores combat-drop and rappel runtime on entities instead of the browser runtime blob', () => {
    const bundle = makeChinookCombatDropBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('SupplyChinook', 20, 20),
      makeMapObject('Ranger', 24, 24),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        chinookCombatDropState: {
          targetObjectId: number | null;
          targetX: number;
          targetZ: number;
          nextDropFrame: number;
        } | null;
        chinookRappelState: {
          sourceEntityId: number;
          targetObjectId: number | null;
          targetX: number;
          targetZ: number;
          descentSpeedPerFrame: number;
        } | null;
      }>;
      pendingCombatDropActions: Map<number, unknown>;
      pendingChinookRappels: Map<number, unknown>;
    };

    const chinook = privateLogic.spawnedEntities.get(1);
    const passenger = privateLogic.spawnedEntities.get(2);
    if (!chinook || !passenger) {
      throw new Error('Expected combat-drop test entities');
    }

    chinook.chinookCombatDropState = {
      targetObjectId: 2,
      targetX: 48,
      targetZ: 56,
      nextDropFrame: 120,
    };
    passenger.chinookRappelState = {
      sourceEntityId: 1,
      targetObjectId: 2,
      targetX: 48,
      targetZ: 56,
      descentSpeedPerFrame: 0.75,
    };
    privateLogic.pendingCombatDropActions.set(1, chinook.chinookCombatDropState);
    privateLogic.pendingChinookRappels.set(2, passenger.chinookRappelState);

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingCombatDropActions');
    expect(browserState).not.toHaveProperty('pendingChinookRappels');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.spawnedEntities.get(1)?.chinookCombatDropState).toEqual({
      targetObjectId: 2,
      targetX: 48,
      targetZ: 56,
      nextDropFrame: 120,
    });
    expect(restoredPrivate.spawnedEntities.get(2)?.chinookRappelState).toEqual({
      sourceEntityId: 1,
      targetObjectId: 2,
      targetX: 48,
      targetZ: 56,
      descentSpeedPerFrame: 0.75,
    });
    expect(restoredPrivate.pendingCombatDropActions.get(1)).toEqual({
      targetObjectId: 2,
      targetX: 48,
      targetZ: 56,
      nextDropFrame: 120,
    });
    expect(restoredPrivate.pendingChinookRappels.get(2)).toEqual({
      sourceEntityId: 1,
      targetObjectId: 2,
      targetX: 48,
      targetZ: 56,
      descentSpeedPerFrame: 0.75,
    });
  });

  it('hydrates legacy browser combat-drop and rappel maps into entity-owned state', () => {
    const bundle = makeChinookCombatDropBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('SupplyChinook', 20, 20),
      makeMapObject('Ranger', 24, 24),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingCombatDropActions: new Map([[1, {
        targetObjectId: 2,
        targetX: 42,
        targetZ: 58,
        nextDropFrame: 90,
      }]]),
      pendingChinookRappels: new Map([[2, {
        sourceEntityId: 1,
        targetObjectId: 2,
        targetX: 42,
        targetZ: 58,
        descentSpeedPerFrame: 0.5,
      }]]),
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        chinookCombatDropState: unknown;
        chinookRappelState: unknown;
      }>;
      pendingCombatDropActions: Map<number, unknown>;
      pendingChinookRappels: Map<number, unknown>;
    };

    expect(privateLogic.spawnedEntities.get(1)?.chinookCombatDropState).toEqual({
      targetObjectId: 2,
      targetX: 42,
      targetZ: 58,
      nextDropFrame: 90,
    });
    expect(privateLogic.spawnedEntities.get(2)?.chinookRappelState).toEqual({
      sourceEntityId: 1,
      targetObjectId: 2,
      targetX: 42,
      targetZ: 58,
      descentSpeedPerFrame: 0.5,
    });
    expect(privateLogic.pendingCombatDropActions.get(1)).toEqual({
      targetObjectId: 2,
      targetX: 42,
      targetZ: 58,
      nextDropFrame: 90,
    });
    expect(privateLogic.pendingChinookRappels.get(2)).toEqual({
      sourceEntityId: 1,
      targetObjectId: 2,
      targetX: 42,
      targetZ: 58,
      descentSpeedPerFrame: 0.5,
    });
  });
});
