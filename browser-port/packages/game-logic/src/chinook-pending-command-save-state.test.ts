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

function makeChinookBundle() {
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
    ],
    locomotors: [
      makeLocomotorDef('ChinookLocomotor', 120),
    ],
  });
}

describe('chinook pending-command save-state', () => {
  it('stores ChinookAIUpdate pending commands on entities instead of the browser runtime blob', () => {
    const bundle = makeChinookBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('SupplyChinook', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        chinookPendingCommand: {
          type: string;
          entityId: number;
          targetX: number;
          targetZ: number;
        } | null;
      }>;
    };
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected chinook entity');
    }

    entity.chinookPendingCommand = {
      type: 'moveTo',
      entityId: 1,
      targetX: 48,
      targetZ: 64,
    };

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingChinookCommandByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredEntity = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredEntity?.chinookPendingCommand).toEqual({
      type: 'moveTo',
      entityId: 1,
      targetX: 48,
      targetZ: 64,
    });
  });

  it('hydrates legacy browser chinook pending-command maps into entity-owned state', () => {
    const bundle = makeChinookBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('SupplyChinook', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingChinookCommandByEntityId: new Map([[1, {
        type: 'moveTo',
        entityId: 1,
        targetX: 24,
        targetZ: 36,
      }]]),
    });

    const entity = (logic as unknown as {
      spawnedEntities: Map<number, {
        chinookPendingCommand: {
          type: string;
          entityId: number;
          targetX: number;
          targetZ: number;
        } | null;
      }>;
    }).spawnedEntities.get(1);

    expect(entity?.chinookPendingCommand).toEqual({
      type: 'moveTo',
      entityId: 1,
      targetX: 24,
      targetZ: 36,
    });
  });
});
