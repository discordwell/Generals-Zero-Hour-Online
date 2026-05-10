import { describe, expect, it } from 'vitest';

import {
  executeScriptWarehouseSetValue,
  findScriptSupplySourceForSide,
} from './script-actions.js';

describe('script supply value uses source GameData value', () => {
  function makeWarehouse() {
    return {
      id: 1,
      destroyed: false,
      side: 'Neutral',
      x: 10,
      z: 20,
      kindOf: new Set(['STRUCTURE', 'SUPPLY_SOURCE']),
      supplyWarehouseProfile: {
        startingBoxes: 10,
        deleteWhenEmpty: false,
        numberApproachPositions: -1,
        allowsPassthrough: false,
      },
    };
  }

  it('sets warehouse boxes using Player::getSupplyBoxValue semantics', () => {
    const warehouse = makeWarehouse();
    const supplyWarehouseStates = new Map<number, { currentBoxes: number }>();
    const self = {
      spawnedEntities: new Map([[warehouse.id, warehouse]]),
      supplyWarehouseStates,
      getSupplyBoxValue: () => 125,
    };

    expect(executeScriptWarehouseSetValue(self, warehouse.id, 375)).toBe(true);
    expect(supplyWarehouseStates.get(warehouse.id)?.currentBoxes).toBe(3);
  });

  it('filters script supply-source cash using Player::getSupplyBoxValue semantics', () => {
    const warehouse = makeWarehouse();
    const self = {
      spawnedEntities: new Map([[warehouse.id, warehouse]]),
      supplyWarehouseStates: new Map([[warehouse.id, { currentBoxes: 1 }]]),
      getSupplyBoxValue: () => 125,
      resolveAiBaseCenter: () => ({ x: 0, z: 0 }),
      resolveEntityMajorRadius: () => 0,
      normalizeSide: (side: string | null | undefined) => (side ?? '').toLowerCase(),
      getTeamRelationshipBySides: () => 'neutral',
      resolveEntityControllingPlayerTokenForAffiliation: () => null,
    };

    expect(findScriptSupplySourceForSide(self, 'america', 125)).toBe(warehouse);
    expect(findScriptSupplySourceForSide(self, 'america', 126)).toBeNull();
  });
});
