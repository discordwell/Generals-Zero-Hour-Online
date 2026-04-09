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

function makeSpawnHealthBoxBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('MobMaster', 'GLA', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: 2,
          SpawnTemplateName: 'MobSlave',
          InitialBurst: 2,
          AggregateHealth: 'Yes',
        }),
      ]),
      makeObjectDef('MobSlave', 'GLA', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
      ]),
    ],
  });
}

describe('SpawnBehavior health-box offset', () => {
  it('tracks the source average slave position on the master object', () => {
    const bundle = makeSpawnHealthBoxBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('MobMaster', 10, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      updateSpawnBehaviors: () => void;
      spawnedEntities: Map<number, any>;
    };

    privateLogic.updateSpawnBehaviors();

    const master = privateLogic.spawnedEntities.get(1);
    const slaveA = privateLogic.spawnedEntities.get(2);
    const slaveB = privateLogic.spawnedEntities.get(3);
    if (!master || !slaveA || !slaveB) {
      throw new Error('Expected SpawnBehavior master and slave entities');
    }

    slaveA.x = master.x + 10;
    slaveA.y = master.y + 2;
    slaveA.z = master.z - 4;
    slaveB.x = master.x - 4;
    slaveB.y = master.y + 6;
    slaveB.z = master.z + 8;

    privateLogic.updateSpawnBehaviors();

    expect(master.healthBoxOffset).toEqual({ x: 3, y: 4, z: 2 });
  });
});
