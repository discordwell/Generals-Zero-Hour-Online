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

function makeBaseRegenLogic() {
  const regenStructure = makeObjectDef('RegenStructure', 'America', ['STRUCTURE'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    makeBlock('Behavior', 'BaseRegenerateUpdate ModuleTag_BaseRegen', {}),
  ]);
  const plainStructure = makeObjectDef('PlainStructure', 'America', ['STRUCTURE'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
  ]);
  const logic = new GameLogicSubsystem(new THREE.Scene());
  logic.loadMapObjects(
    makeMap([
      makeMapObject('RegenStructure', 8, 8),
      makeMapObject('PlainStructure', 16, 8),
    ], 32, 32),
    makeRegistry(makeBundle({ objects: [regenStructure, plainStructure] })),
    makeHeightmap(32, 32),
  );
  return logic;
}

describe('BaseRegenerateUpdate', () => {
  it('regenerates only structures with the BaseRegenerateUpdate module', () => {
    const logic = makeBaseRegenLogic();
    const internals = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        baseRegenerateUpdateProfile: unknown;
      }>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: unknown, amount: number, damageType: string): void;
    };
    const regen = internals.spawnedEntities.get(1)!;
    const plain = internals.spawnedEntities.get(2)!;

    expect(regen.baseRegenerateUpdateProfile).not.toBeNull();
    expect(plain.baseRegenerateUpdateProfile).toBeNull();

    internals.applyWeaponDamageAmount(null, regen, 30, 'EXPLOSION');
    internals.applyWeaponDamageAmount(null, plain, 30, 'EXPLOSION');
    expect(regen.health).toBe(70);
    expect(plain.health).toBe(70);

    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    expect(regen.health).toBeGreaterThan(70);
    expect(plain.health).toBe(70);
  });
});
