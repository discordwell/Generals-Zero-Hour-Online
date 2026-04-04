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

function makeDisabledStatusBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('DisabledStatusUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
    ],
  });
}

describe('disabled status save-state', () => {
  it('stores hacked and EMP disable timers on entities instead of the browser runtime blob', () => {
    const bundle = makeDisabledStatusBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('DisabledStatusUnit', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        disabledHackedUntilFrame: number;
        disabledEmpUntilFrame: number;
      }>;
    };
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected disabled-status entity');
    }

    entity.objectStatusFlags.add('DISABLED_HACKED');
    entity.disabledHackedUntilFrame = 120;
    entity.objectStatusFlags.add('DISABLED_EMP');
    entity.disabledEmpUntilFrame = 180;

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('disabledHackedStatusByEntityId');
    expect(browserState).not.toHaveProperty('disabledEmpStatusByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredEntity = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredEntity).toMatchObject({
      disabledHackedUntilFrame: 120,
      disabledEmpUntilFrame: 180,
    });
    expect(restoredEntity?.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);
    expect(restoredEntity?.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('hydrates legacy browser disable maps into source-owned entity timers', () => {
    const bundle = makeDisabledStatusBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('DisabledStatusUnit', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      disabledHackedStatusByEntityId: new Map([[1, 45]]),
      disabledEmpStatusByEntityId: new Map([[1, 60]]),
    });

    const entity = (logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        disabledHackedUntilFrame: number;
        disabledEmpUntilFrame: number;
      }>;
    }).spawnedEntities.get(1);

    expect(entity).toMatchObject({
      disabledHackedUntilFrame: 45,
      disabledEmpUntilFrame: 60,
    });
    expect(entity?.objectStatusFlags.has('DISABLED_HACKED')).toBe(true);
    expect(entity?.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });
});
