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

function makeOverchargeBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('OverchargePlant', 'China', ['STRUCTURE'], [
        makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'OverchargeBehavior ModuleTag_Overcharge', {
          HealthPercentToDrainPerSecond: '5%',
          NotAllowedWhenHealthBelowPercent: '20%',
        }),
      ], {
        EnergyBonus: 50,
      }),
    ],
  });
}

describe('overcharge save-state', () => {
  it('stores OverchargeBehavior runtime on entities instead of the browser runtime blob', () => {
    const bundle = makeOverchargeBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('OverchargePlant', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        overchargeBehaviorProfile: {
          healthPercentToDrainPerSecond: number;
          notAllowedWhenHealthBelowPercent: number;
        } | null;
        overchargeActive: boolean;
      }>;
    };
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected overcharge entity');
    }

    entity.overchargeBehaviorProfile = {
      healthPercentToDrainPerSecond: 0.05,
      notAllowedWhenHealthBelowPercent: 0.2,
    };
    entity.overchargeActive = true;

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('overchargeStateByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredEntity = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredEntity?.overchargeBehaviorProfile).toEqual({
      healthPercentToDrainPerSecond: 0.05,
      notAllowedWhenHealthBelowPercent: 0.2,
    });
    expect(restoredEntity?.overchargeActive).toBe(true);
  });

  it('hydrates legacy browser overcharge maps into entity-owned save state', () => {
    const bundle = makeOverchargeBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('OverchargePlant', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      overchargeStateByEntityId: new Map([[1, {
        healthPercentToDrainPerSecond: 0.1,
        notAllowedWhenHealthBelowPercent: 0.3,
      }]]),
    });

    const entity = (logic as unknown as {
      spawnedEntities: Map<number, {
        overchargeBehaviorProfile: {
          healthPercentToDrainPerSecond: number;
          notAllowedWhenHealthBelowPercent: number;
        } | null;
        overchargeActive: boolean;
      }>;
    }).spawnedEntities.get(1);

    expect(entity?.overchargeBehaviorProfile).toEqual({
      healthPercentToDrainPerSecond: 0.1,
      notAllowedWhenHealthBelowPercent: 0.3,
    });
    expect(entity?.overchargeActive).toBe(true);
  });
});
