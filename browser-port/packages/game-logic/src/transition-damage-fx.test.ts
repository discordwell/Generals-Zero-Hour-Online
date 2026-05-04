import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ObjectCreationListDef, ObjectDef } from '@generals/ini-data';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectCreationListDef,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

function makeTransitionDamageFXLogic(
  fields: Record<string, unknown>,
  extraObjects: ObjectDef[] = [],
  objectCreationLists: ObjectCreationListDef[] = [],
) {
  const victimDef = makeObjectDef('VictimBuilding', 'America', ['STRUCTURE'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    makeBlock('Behavior', 'TransitionDamageFX ModuleTag_TDFX', fields),
  ]);
  const bundle = makeBundle({
    objects: [victimDef, ...extraObjects],
    objectCreationLists,
  });
  const logic = new GameLogicSubsystem(new THREE.Scene());
  logic.loadMapObjects(
    makeMap([makeMapObject('VictimBuilding', 10, 10)], 32, 32),
    makeRegistry(bundle),
    makeHeightmap(32, 32),
  );
  return logic;
}

describe('TransitionDamageFX', () => {
  it('fires named FX and particle events when damage state worsens', () => {
    const logic = makeTransitionDamageFXLogic({
      DamagedFXList1: ['Loc:', 'X:1', 'Y:2', 'Z:3', 'FXList:FX_Damaged'],
      DamagedParticleSystem1: ['Bone:Smoke', 'RandomBone:Yes', 'PSys:SmokeSmallContinuousDown'],
    });

    const internals = logic as unknown as {
      spawnedEntities: Map<number, { id: number; health: number; transitionDamageFXProfile: unknown }>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: unknown, amount: number, damageType: string): void;
    };
    const victim = internals.spawnedEntities.get(1)!;

    expect(victim.transitionDamageFXProfile).not.toBeNull();
    internals.applyWeaponDamageAmount(null, victim, 60, 'SMALL_ARMS');

    const events = logic.drainVisualEvents();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'NAMED_FX',
      effectName: 'FX_Damaged',
      sourceEntityId: victim.id,
      x: 11,
      z: 12,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'NAMED_PARTICLE_SYSTEM',
      effectName: 'SmokeSmallContinuousDown',
      sourceEntityId: victim.id,
    }));
  });

  it('honors TransitionDamageFX damage type filters', () => {
    const logic = makeTransitionDamageFXLogic({
      DamageFXTypes: ['FLAME'],
      DamagedFXList1: ['Loc:', 'X:0', 'Y:0', 'Z:0', 'FXList:FX_FlameOnly'],
    });

    const internals = logic as unknown as {
      spawnedEntities: Map<number, unknown>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: unknown, amount: number, damageType: string): void;
    };
    const victim = internals.spawnedEntities.get(1)!;

    internals.applyWeaponDamageAmount(null, victim, 60, 'SMALL_ARMS');

    expect(logic.drainVisualEvents()).not.toContainEqual(expect.objectContaining({
      type: 'NAMED_FX',
      effectName: 'FX_FlameOnly',
    }));
  });

  it('indexes all source damage states and slots case-insensitively', () => {
    const logic = makeTransitionDamageFXLogic({
      ReallyDamagedParticleSystem12: ['Loc:', 'X:0', 'Y:0', 'Z:0', 'PSys:SmokeReallyDamaged'],
      rubblefxlist12: ['Loc:', 'X:1', 'Y:0', 'Z:0', 'FXList:FX_Rubble'],
    });

    const internals = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        transitionDamageFXProfile: {
          fxLists: Array<Array<{ effectName: string }>>;
          particleSystems: Array<Array<{ effectName: string }>>;
        };
      }>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: unknown, amount: number, damageType: string): void;
    };
    const victim = internals.spawnedEntities.get(1)!;

    expect(victim.transitionDamageFXProfile.particleSystems[2]).toContainEqual(expect.objectContaining({
      effectName: 'SmokeReallyDamaged',
    }));
    expect(victim.transitionDamageFXProfile.fxLists[3]).toContainEqual(expect.objectContaining({
      effectName: 'FX_Rubble',
    }));

    internals.applyWeaponDamageAmount(null, victim, 95, 'SMALL_ARMS');

    expect(logic.drainVisualEvents()).toContainEqual(expect.objectContaining({
      type: 'NAMED_PARTICLE_SYSTEM',
      effectName: 'SmokeReallyDamaged',
    }));
  });

  it('executes OCL entries at the transition effect position', () => {
    const debrisDef = makeObjectDef('SpawnedDebris', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
    ]);
    const logic = makeTransitionDamageFXLogic(
      {
        DamagedOCL1: ['Loc:', 'X:5', 'Y:0', 'Z:0', 'OCL:OCL_DamagedDebris'],
      },
      [debrisDef],
      [
        makeObjectCreationListDef('OCL_DamagedDebris', [
          makeBlock('CreateObject', 'CreateObject', { ObjectNames: 'SpawnedDebris' }),
        ]),
      ],
    );

    const internals = logic as unknown as {
      spawnedEntities: Map<number, { templateName: string; x: number }>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: unknown, amount: number, damageType: string): void;
    };
    const victim = internals.spawnedEntities.get(1)!;

    internals.applyWeaponDamageAmount(null, victim, 60, 'SMALL_ARMS');

    const spawned = [...internals.spawnedEntities.values()]
      .find((entity) => entity.templateName === 'SpawnedDebris');
    expect(spawned).toBeDefined();
    expect(spawned!.x).toBe(15);
  });
});
