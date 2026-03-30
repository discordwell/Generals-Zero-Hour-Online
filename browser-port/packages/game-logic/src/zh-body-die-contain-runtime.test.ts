/**
 * Tests for ZH-only runtime logic differences in Body, Die, and Contain modules.
 *
 * Source parity files audited:
 *   Body:    ActiveBody.cpp, HighlanderBody.cpp, ImmortalBody.cpp, InactiveBody.cpp,
 *            UndeadBody.cpp, HiveStructureBody.cpp, StructureBody.cpp
 *   Die:     CreateObjectDie.cpp, FXListDie.cpp, DestroyDie.cpp, DieModule.cpp
 *   Contain: TransportContain.cpp, GarrisonContain.cpp, TunnelContain.cpp,
 *            OpenContain.cpp, OverlordContain.cpp, ParachuteContain.cpp,
 *            HelixContain.cpp, InternetHackContain.cpp, RiderChangeContain.cpp
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  resolveSniperDamageVsEmptyStructure,
} from './combat-helpers.js';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

function createGL() { return new GameLogicSubsystem(new THREE.Scene()); }

function setupGame(objects: ReturnType<typeof makeMapObject>[], bundle: ReturnType<typeof makeBundle>, mapSize = 256) {
  const logic = createGL();
  const mapData = makeMap(objects, mapSize, mapSize);
  (mapData as any).waypoints = {
    nodes: [
      { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
    ],
    links: [],
  };
  logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(mapSize, mapSize));
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'GLA');
  logic.setTeamRelationship('America', 'GLA', 0);
  logic.setTeamRelationship('GLA', 'America', 0);
  return logic;
}

// ═══════════════════════════════════════════════════════════════════════
// ActiveBody — DAMAGE_SNIPER vs UNDER_CONSTRUCTION structure
// Source parity (ZH): ActiveBody.cpp:305-311
// ═══════════════════════════════════════════════════════════════════════

describe('ActiveBody: SNIPER damage vs UNDER_CONSTRUCTION structure (ZH ActiveBody.cpp:305-311)', () => {
  it('returns 0 when SNIPER targets a STRUCTURE that is UNDER_CONSTRUCTION', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, null, true)).toBe(0);
  });

  it('returns 0 when SNIPER targets an occupied STRUCTURE that is UNDER_CONSTRUCTION', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, 3, true)).toBe(0);
  });

  it('returns full damage when SNIPER targets a completed STRUCTURE with occupants', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, 3, false)).toBe(50);
  });

  it('returns full damage for non-SNIPER damage vs UNDER_CONSTRUCTION structure', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'EXPLOSION', kindOf, null, true)).toBe(50);
  });

  it('returns full damage when SNIPER targets a non-STRUCTURE under construction', () => {
    const kindOf = new Set(['VEHICLE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, null, true)).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ActiveBody — DAMAGE_KILL_GARRISONED
// Source parity (ZH): ActiveBody.cpp:455-491
// ═══════════════════════════════════════════════════════════════════════

describe('ActiveBody: DAMAGE_KILL_GARRISONED handler (ZH ActiveBody.cpp:455-491)', () => {
  function makeGarrisonBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Barracks', 'America', ['STRUCTURE', 'GARRISONABLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Garrison', { Slots: 8, DamagePercentToUnits: 100 }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY', 'CAN_ATTACK'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      locomotors: [makeLocomotorDef('InfantryLoco', 30)],
    });
  }

  it('kills N garrisoned infantry where N = floor(amount)', () => {
    const bundle = makeGarrisonBundle();
    const logic = setupGame([
      makeMapObject('Barracks', 50, 50),
      makeMapObject('Ranger', 50, 50),
      makeMapObject('Ranger', 50, 50),
      makeMapObject('Ranger', 50, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const building = entities.find((e: any) => e.templateName === 'Barracks');
    const rangers = entities.filter((e: any) => e.templateName === 'Ranger');
    for (const r of rangers) r.garrisonContainerId = building.id;

    priv.applyWeaponDamageAmount(null, building, 2, 'KILL_GARRISONED');

    const aliveRangers = rangers.filter((r: any) => !r.destroyed);
    expect(aliveRangers).toHaveLength(1);
    expect(building.health).toBe(building.maxHealth);
  });

  it('does not kill garrisoned units if building is immuneToClearBuildingAttacks', () => {
    const bundle = makeGarrisonBundle();
    const logic = setupGame([
      makeMapObject('Barracks', 50, 50),
      makeMapObject('Ranger', 50, 50),
      makeMapObject('Ranger', 50, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const building = entities.find((e: any) => e.templateName === 'Barracks');
    const rangers = entities.filter((e: any) => e.templateName === 'Ranger');
    for (const r of rangers) r.garrisonContainerId = building.id;
    building.containProfile.immuneToClearBuildingAttacks = true;

    priv.applyWeaponDamageAmount(null, building, 3, 'KILL_GARRISONED');

    const aliveRangers = rangers.filter((r: any) => !r.destroyed);
    expect(aliveRangers).toHaveLength(2);
  });

  it('does not affect building health even without garrisoned units', () => {
    const bundle = makeGarrisonBundle();
    const logic = setupGame([
      makeMapObject('Barracks', 50, 50),
    ], bundle);

    const priv = logic as any;
    const building = [...priv.spawnedEntities.values()].find((e: any) => e.templateName === 'Barracks');
    const healthBefore = building.health;

    priv.applyWeaponDamageAmount(null, building, 5, 'KILL_GARRISONED');

    expect(building.health).toBe(healthBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ActiveBody — DAMAGE_STATUS
// Source parity (ZH): ActiveBody.cpp:444-451
// ═══════════════════════════════════════════════════════════════════════

describe('ActiveBody: DAMAGE_STATUS does not reduce health (ZH ActiveBody.cpp:444-451)', () => {
  it('STATUS damage is recognized as non-health-damaging and returns early', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Vehicle', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const logic = setupGame([makeMapObject('Vehicle', 50, 50)], bundle);
    const priv = logic as any;
    const entity = [...priv.spawnedEntities.values()].find((e: any) => e.templateName === 'Vehicle');
    const healthBefore = entity.health;

    priv.applyWeaponDamageAmount(null, entity, 100, 'STATUS');

    expect(entity.health).toBe(healthBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ActiveBody — DAMAGE_KILL_PILOT
// Source parity: ActiveBody.cpp:366-442
// ═══════════════════════════════════════════════════════════════════════

describe('ActiveBody: DAMAGE_KILL_PILOT handler (ZH ActiveBody.cpp:366-442)', () => {
  it('KILL_PILOT sets DISABLED_UNMANNED on standard vehicles and clears side', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Humvee', 'America', ['VEHICLE', 'CAN_ATTACK'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    });
    const logic = setupGame([makeMapObject('Humvee', 50, 50)], bundle);
    const priv = logic as any;
    const entity = [...priv.spawnedEntities.values()].find((e: any) => e.templateName === 'Humvee');

    priv.applyWeaponDamageAmount(null, entity, 1, 'KILL_PILOT');

    expect(entity.objectStatusFlags.has('DISABLED_UNMANNED')).toBe(true);
    expect(entity.health).toBe(300);
    expect(entity.side).toBe('');
  });

  it('KILL_PILOT does not reduce vehicle health', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Humvee', 'America', ['VEHICLE', 'CAN_ATTACK'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    });
    const logic = setupGame([makeMapObject('Humvee', 50, 50)], bundle);
    const priv = logic as any;
    const entity = [...priv.spawnedEntities.values()].find((e: any) => e.templateName === 'Humvee');
    const healthBefore = entity.health;

    priv.applyWeaponDamageAmount(null, entity, 100, 'KILL_PILOT');

    expect(entity.health).toBe(healthBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ActiveBody — Retaliation filtering
// Source parity (ZH): ActiveBody.cpp:730-795
// ═══════════════════════════════════════════════════════════════════════

describe('ActiveBody: Retaliation filtering (ZH ActiveBody.cpp:730-795)', () => {
  function makeRetaliateBundle(allyKindOf: string[] = ['INFANTRY', 'CAN_ATTACK']) {
    return makeBundle({
      objects: [
        makeObjectDef('Target', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
        ]),
        makeObjectDef('Ally', 'America', allyKindOf, [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('Enemy', 'GLA', ['INFANTRY', 'CAN_ATTACK'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      armors: [makeArmorDef('DefaultArmor', { Default: 1 })],
      locomotors: [makeLocomotorDef('InfantryLoco', 30)],
    });
  }

  it('CANNOT_RETALIATE allies do not get recruited to retaliate', () => {
    const bundle = makeRetaliateBundle(['INFANTRY', 'CAN_ATTACK', 'CANNOT_RETALIATE']);
    const logic = setupGame([
      makeMapObject('Target', 50, 50),
      makeMapObject('Ally', 52, 50),
      makeMapObject('Enemy', 55, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const targetEntity = entities.find((e: any) => e.templateName === 'Target');
    const allyEntity = entities.find((e: any) => e.templateName === 'Ally');
    const enemyEntity = entities.find((e: any) => e.templateName === 'Enemy');

    priv.applyWeaponDamageAmount(enemyEntity.id, targetEntity, 10, 'SMALL_ARMS');

    expect(allyEntity.lastAttackerEntityId).not.toBe(enemyEntity.id);
  });

  it('DRONE allies do not get recruited to retaliate', () => {
    const bundle = makeRetaliateBundle(['INFANTRY', 'CAN_ATTACK', 'DRONE']);
    const logic = setupGame([
      makeMapObject('Target', 50, 50),
      makeMapObject('Ally', 52, 50),
      makeMapObject('Enemy', 55, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const allyEntity = entities.find((e: any) => e.templateName === 'Ally');
    const targetEntity = entities.find((e: any) => e.templateName === 'Target');
    const enemyEntity = entities.find((e: any) => e.templateName === 'Enemy');

    priv.applyWeaponDamageAmount(enemyEntity.id, targetEntity, 10, 'SMALL_ARMS');

    expect(allyEntity.lastAttackerEntityId).not.toBe(enemyEntity.id);
  });

  it('stealthed but not detected allies do not get recruited to retaliate', () => {
    const bundle = makeRetaliateBundle();
    const logic = setupGame([
      makeMapObject('Target', 50, 50),
      makeMapObject('Ally', 52, 50),
      makeMapObject('Enemy', 55, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const allyEntity = entities.find((e: any) => e.templateName === 'Ally');
    const targetEntity = entities.find((e: any) => e.templateName === 'Target');
    const enemyEntity = entities.find((e: any) => e.templateName === 'Enemy');

    allyEntity.objectStatusFlags.add('STEALTHED');

    priv.applyWeaponDamageAmount(enemyEntity.id, targetEntity, 10, 'SMALL_ARMS');

    expect(allyEntity.lastAttackerEntityId).not.toBe(enemyEntity.id);
  });

  it('allies using abilities (USING_ABILITY status) do not get recruited', () => {
    const bundle = makeRetaliateBundle();
    const logic = setupGame([
      makeMapObject('Target', 50, 50),
      makeMapObject('Ally', 52, 50),
      makeMapObject('Enemy', 55, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const allyEntity = entities.find((e: any) => e.templateName === 'Ally');
    const targetEntity = entities.find((e: any) => e.templateName === 'Target');
    const enemyEntity = entities.find((e: any) => e.templateName === 'Enemy');

    allyEntity.objectStatusFlags.add('USING_ABILITY');

    priv.applyWeaponDamageAmount(enemyEntity.id, targetEntity, 10, 'SMALL_ARMS');

    expect(allyEntity.lastAttackerEntityId).not.toBe(enemyEntity.id);
  });

  it('DRONE targets do not trigger retaliation recruitment', () => {
    const bundle = makeRetaliateBundle();
    const logic = setupGame([
      makeMapObject('Target', 50, 50),
      makeMapObject('Ally', 52, 50),
      makeMapObject('Enemy', 55, 50),
    ], bundle);

    const priv = logic as any;
    const entities: any[] = [...priv.spawnedEntities.values()];
    const allyEntity = entities.find((e: any) => e.templateName === 'Ally');
    const targetEntity = entities.find((e: any) => e.templateName === 'Target');
    const enemyEntity = entities.find((e: any) => e.templateName === 'Enemy');

    targetEntity.kindOf.add('DRONE');

    priv.applyWeaponDamageAmount(enemyEntity.id, targetEntity, 10, 'SMALL_ARMS');

    expect(allyEntity.lastAttackerEntityId).not.toBe(enemyEntity.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ActiveBody — FULLY_HEAL in setMaxHealth
// Source parity (ZH): ActiveBody.cpp:925-932
// ═══════════════════════════════════════════════════════════════════════

describe('ActiveBody: FULLY_HEAL maxHealth change type (ZH ActiveBody.cpp:925-932)', () => {
  it('FULLY_HEAL sets health to new max regardless of previous health', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Unit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const logic = setupGame([makeMapObject('Unit', 50, 50)], bundle);
    const priv = logic as any;
    const entity = [...priv.spawnedEntities.values()].find((e: any) => e.templateName === 'Unit');

    entity.health = 200;

    priv.applyMaxHealthUpgrade(entity, 100, 'FULLY_HEAL');

    expect(entity.maxHealth).toBe(600);
    expect(entity.health).toBe(600);
  });

  it('FULLY_HEAL with negative delta also heals to new (lower) max', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Unit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const logic = setupGame([makeMapObject('Unit', 50, 50)], bundle);
    const priv = logic as any;
    const entity = [...priv.spawnedEntities.values()].find((e: any) => e.templateName === 'Unit');

    priv.applyMaxHealthUpgrade(entity, -100, 'FULLY_HEAL');

    expect(entity.maxHealth).toBe(400);
    expect(entity.health).toBe(400);
  });
});
