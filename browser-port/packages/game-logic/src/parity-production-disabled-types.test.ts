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

function addTestProductionEntry(entity: {
  productionQueue: unknown[];
}): void {
  entity.productionQueue.push({
    type: 'UNIT',
    templateName: 'TestUnit',
    productionId: 1,
    buildCost: 0,
    totalProductionFrames: 100,
    framesUnderConstruction: 0,
    percentComplete: 0,
    productionQuantityTotal: 1,
    productionQuantityProduced: 0,
  });
}

describe('ProductionUpdate DisabledTypesToProcess parity', () => {
  it('uses the source disabled mask instead of a hard-coded underpowered block', () => {
    const defaultFactory = makeObjectDef('DefaultFactory', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
        MaxQueueEntries: 2,
      }),
    ]);
    const underpoweredFactory = makeObjectDef('UnderpoweredFactory', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
        MaxQueueEntries: 2,
        DisabledTypesToProcess: ['DISABLED_HELD', 'DISABLED_UNDERPOWERED'],
      }),
    ]);
    const testUnit = makeObjectDef('TestUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('DefaultFactory', 5, 5),
        makeMapObject('UnderpoweredFactory', 12, 5),
      ]),
      makeRegistry(makeBundle({ objects: [defaultFactory, underpoweredFactory, testUnit] })),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        productionProfile: { disabledTypesToProcess: Set<string> } | null;
        productionQueue: Array<{ framesUnderConstruction: number }>;
      }>;
    };
    const defaultProducer = priv.spawnedEntities.get(1)!;
    const allowedProducer = priv.spawnedEntities.get(2)!;

    expect(defaultProducer.productionProfile!.disabledTypesToProcess).toEqual(new Set(['DISABLED_HELD']));
    expect(allowedProducer.productionProfile!.disabledTypesToProcess)
      .toEqual(new Set(['DISABLED_HELD', 'DISABLED_UNDERPOWERED']));

    addTestProductionEntry(defaultProducer);
    addTestProductionEntry(allowedProducer);
    defaultProducer.objectStatusFlags.add('DISABLED_UNDERPOWERED');
    allowedProducer.objectStatusFlags.add('DISABLED_UNDERPOWERED');

    logic.update(1 / 30);

    expect(defaultProducer.productionQueue[0]!.framesUnderConstruction).toBe(0);
    expect(allowedProducer.productionQueue[0]!.framesUnderConstruction).toBeGreaterThan(0);
  });
});
