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

function makeBattlePlanParalysisBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('BattlePlanTroop', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
    ],
  });
}

describe('battle plan paralysis save-state', () => {
  it('stores battle-plan paralysis timers on entities instead of the browser runtime blob', () => {
    const bundle = makeBattlePlanParalysisBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('BattlePlanTroop', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        disabledParalyzedUntilFrame: number;
      }>;
    };
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected battle-plan troop');
    }

    entity.objectStatusFlags.add('DISABLED_SUBDUED');
    entity.disabledParalyzedUntilFrame = 120;

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('battlePlanParalyzedUntilFrame');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredEntity = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredEntity?.disabledParalyzedUntilFrame).toBe(120);
    expect(restoredEntity?.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);
  });

  it('hydrates legacy browser battle-plan paralysis maps into entity-owned timers', () => {
    const bundle = makeBattlePlanParalysisBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('BattlePlanTroop', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      battlePlanParalyzedUntilFrame: new Map([[1, 90]]),
    });

    const entity = (logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        disabledParalyzedUntilFrame: number;
      }>;
    }).spawnedEntities.get(1);

    expect(entity?.disabledParalyzedUntilFrame).toBe(90);
    expect(entity?.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);
  });
});
