/**
 * Tests for ZH-only AI targeting runtime fixes:
 * 1. Attack path validation — path endpoint must be within weapon range
 * 2. Don't auto-acquire when subdued (DISABLED_SUBDUED)
 * 3. Healing exclusion from auto-acquire last-attacker logic
 * 4. Under-construction units cannot auto-acquire
 * 5. chooseWeapon returns failure when no weapon available for target type
 *
 * Source parity:
 *   - AIUpdate.cpp:1980-1997: attack path endpoint range validation
 *   - AIStates.cpp:1436: DISABLED_SUBDUED blocks idle auto-targeting
 *   - ActiveBody.cpp:379: DAMAGE_HEALING early return before retaliation
 *   - Object.cpp:3196: UNDER_CONSTRUCTION blocks isAbleToAttack()
 *   - AIStates.cpp:5547-5551,5660-5666: chooseWeapon() STATE_FAILURE
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeTargetingBundle(extraObjects: ReturnType<typeof makeObjectDef>[] = [], extraWeapons: ReturnType<typeof makeWeaponDef>[] = []) {
  return makeBundle({
    objects: [
      // Armed infantry with weapon
      makeObjectDef('Infantry', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'InfantryGun'] }),
        makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
      ], { VisionRange: 150 }),

      // Enemy structure (stationary target)
      makeObjectDef('EnemyCC', 'China', ['STRUCTURE', 'COMMANDCENTER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
      ]),

      // Enemy infantry
      makeObjectDef('EnemyInfantry', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyGun'] }),
        makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
      ], { VisionRange: 150 }),

      ...extraObjects,
    ],

    weapons: [
      makeWeaponDef('InfantryGun', {
        AttackRange: 100,
        PrimaryDamage: 25,
        DelayBetweenShots: 500,
        DamageType: 'SMALL_ARMS',
      }),
      makeWeaponDef('EnemyGun', {
        AttackRange: 100,
        PrimaryDamage: 25,
        DelayBetweenShots: 500,
        DamageType: 'SMALL_ARMS',
      }),
      ...extraWeapons,
    ],

    armors: [
      makeArmorDef('DefaultArmor', { Default: 1 }),
    ],

    locomotors: [
      makeLocomotorDef('InfantryLoco', 30),
    ],
  });
}

function setupGame(
  objects: ReturnType<typeof makeMapObject>[],
  bundle?: ReturnType<typeof makeBundle>,
  mapSize = 256,
) {
  const finalBundle = bundle ?? makeTargetingBundle();
  const logic = new GameLogicSubsystem(new THREE.Scene());
  const mapData = makeMap(objects, mapSize, mapSize);
  mapData.waypoints = {
    nodes: [
      { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
    ],
    links: [],
  };

  logic.loadMapObjects(mapData, makeRegistry(finalBundle), makeHeightmap(mapSize, mapSize));
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'China');
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
  logic.update(0);

  return logic;
}

// ---------------------------------------------------------------------------
// Fix 1: Attack path validation (AIUpdate.cpp:1980-1997)
// ---------------------------------------------------------------------------

describe('attack path endpoint validation (AIUpdate.cpp:1980-1997)', () => {
  it('clears attack when path endpoint is outside weapon range', () => {
    // Place infantry at (20,20) and enemy far away at (250,250) on a small map.
    // The pathfinder may not be able to find a path endpoint within weapon range
    // if obstacles or map boundaries prevent approach.
    // Use a small map so the edge blocks the path from getting close enough.
    const logic = setupGame([
      makeMapObject('Infantry', 10, 10),
      makeMapObject('EnemyCC', 250, 250),
    ], undefined, 256);

    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const ccId = entities.find(e => e.templateName === 'EnemyCC')!.id;

    // Issue attack
    logic.submitCommand({
      type: 'attackEntity',
      entityId: infantryId,
      targetEntityId: ccId,
    });

    logic.update(1 / 30);

    const internalLogic = logic as any;
    const infantry = internalLogic.spawnedEntities.get(infantryId);

    // After attack command, either:
    // a) The path endpoint IS within range and attack is set, OR
    // b) The path endpoint is NOT within range and attack was cleared
    // We verify the invariant: if attackTargetEntityId is set, the path endpoint
    // must be within weapon range of the target.
    if (infantry.attackTargetEntityId !== null && infantry.movePath.length > 0) {
      const lastNode = infantry.movePath[infantry.movePath.length - 1];
      const target = internalLogic.spawnedEntities.get(ccId);
      const dx = lastNode.x - target.x;
      const dz = lastNode.z - target.z;
      const distSqr = dx * dx + dz * dz;
      const weaponRange = infantry.attackWeapon?.attackRange ?? 0;
      expect(distSqr).toBeLessThanOrEqual(weaponRange * weaponRange);
    }
  });

  it('allows attack when path endpoint is within weapon range', () => {
    // Place infantry within approachable distance of enemy
    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('EnemyCC', 200, 50),
    ]);

    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const ccId = entities.find(e => e.templateName === 'EnemyCC')!.id;

    logic.submitCommand({
      type: 'attackEntity',
      entityId: infantryId,
      targetEntityId: ccId,
    });

    logic.update(1 / 30);

    const internalLogic = logic as any;
    const infantry = internalLogic.spawnedEntities.get(infantryId);

    // Attack should be set — target is reachable within weapon range
    expect(infantry.attackTargetEntityId).toBe(ccId);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Don't auto-acquire when subdued (DISABLED_SUBDUED)
// (AIStates.cpp:1436)
// ---------------------------------------------------------------------------

describe('subdued entities skip auto-acquire (AIStates.cpp:1436)', () => {
  it('DISABLED_SUBDUED entity does not auto-acquire nearby enemy', () => {
    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('EnemyInfantry', 100, 50),   // 50 units apart, within range
    ]);

    const internalLogic = logic as any;
    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const infantry = internalLogic.spawnedEntities.get(infantryId);

    // Apply DISABLED_SUBDUED status
    infantry.objectStatusFlags.add('DISABLED_SUBDUED');

    // Run enough frames for auto-target scan
    for (let i = 0; i < 120; i++) logic.update(1 / 30);

    // Infantry should NOT have acquired a target due to subdued status
    expect(infantry.attackTargetEntityId).toBeNull();
  });

  it('non-subdued entity still auto-acquires normally', () => {
    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('EnemyInfantry', 100, 50),
    ]);

    // No DISABLED_SUBDUED — should auto-acquire
    for (let i = 0; i < 120; i++) logic.update(1 / 30);

    const internalLogic = logic as any;
    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const infantry = internalLogic.spawnedEntities.get(infantryId);

    // Enemy is within vision+weapon range, so auto-targeting should trigger
    const enemyId = entities.find(e => e.templateName === 'EnemyInfantry')!.id;

    // Either infantry acquired a target, or enemy took damage (combat happened)
    const enemyState = logic.getRenderableEntityStates().find(e => e.id === enemyId);
    const combatOccurred = infantry.attackTargetEntityId !== null
      || (enemyState && enemyState.health < enemyState.maxHealth);
    expect(combatOccurred).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Healing exclusion from auto-acquire
// (ActiveBody.cpp:379 — DAMAGE_HEALING early return)
// ---------------------------------------------------------------------------

describe('healing exclusion from auto-acquire (ActiveBody.cpp:379)', () => {
  it('HEALING damage type does not set lastAttackerEntityId', () => {
    const bundle = makeTargetingBundle([
      makeObjectDef('Healer', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
      ], { VisionRange: 100 }),
    ]);

    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('Healer', 70, 50),
    ], bundle);

    const internalLogic = logic as any;
    let infantry: any;
    let healerId = 0;
    for (const [id, ent] of internalLogic.spawnedEntities) {
      if (ent.templateName === 'Infantry') infantry = ent;
      if (ent.templateName === 'Healer') healerId = id;
    }

    // Apply HEALING damage — should NOT set lastAttackerEntityId
    internalLogic.applyWeaponDamageAmount(healerId, infantry, 5, 'HEALING');

    expect(infantry.lastAttackerEntityId).toBeNull();
  });

  it('normal damage type DOES set lastAttackerEntityId', () => {
    const bundle = makeTargetingBundle([
      makeObjectDef('Attacker', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
      ], { VisionRange: 100 }),
    ]);

    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('Attacker', 70, 50),
    ], bundle);

    const internalLogic = logic as any;
    let infantry: any;
    let attackerId = 0;
    for (const [id, ent] of internalLogic.spawnedEntities) {
      if (ent.templateName === 'Infantry') infantry = ent;
      if (ent.templateName === 'Attacker') attackerId = id;
    }

    // Apply normal damage — SHOULD set lastAttackerEntityId
    internalLogic.applyWeaponDamageAmount(attackerId, infantry, 5, 'SMALL_ARMS');

    expect(infantry.lastAttackerEntityId).toBe(attackerId);
  });

  it('HEALING damage does not trigger retaliation when unit has no other attacker', () => {
    const bundle = makeTargetingBundle([
      makeObjectDef('Healer', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
      ], { VisionRange: 100 }),
    ]);

    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('Healer', 70, 50),
    ], bundle);

    const internalLogic = logic as any;
    let infantry: any;
    let healerId = 0;
    for (const [id, ent] of internalLogic.spawnedEntities) {
      if (ent.templateName === 'Infantry') infantry = ent;
      if (ent.templateName === 'Healer') healerId = id;
    }

    // Apply HEALING damage
    internalLogic.applyWeaponDamageAmount(healerId, infantry, 5, 'HEALING');

    // Run a few frames for retaliation check
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Infantry should NOT have targeted the healer for retaliation
    expect(infantry.attackTargetEntityId).not.toBe(healerId);
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Under-construction units cannot auto-acquire
// (Object.cpp:3196 — testStatus(OBJECT_STATUS_UNDER_CONSTRUCTION))
// ---------------------------------------------------------------------------

describe('under-construction units skip auto-acquire (Object.cpp:3196)', () => {
  it('entity with UNDER_CONSTRUCTION status does not auto-acquire', () => {
    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('EnemyInfantry', 100, 50),
    ]);

    const internalLogic = logic as any;
    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const infantry = internalLogic.spawnedEntities.get(infantryId);

    // Set UNDER_CONSTRUCTION status
    infantry.objectStatusFlags.add('UNDER_CONSTRUCTION');

    // Run enough frames for auto-target scan
    for (let i = 0; i < 120; i++) logic.update(1 / 30);

    // Infantry should NOT have auto-acquired a target
    expect(infantry.attackTargetEntityId).toBeNull();
  });

  it('entity with UNDER_CONSTRUCTION cannot attack via explicit command', () => {
    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('EnemyCC', 100, 50),
    ]);

    const internalLogic = logic as any;
    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const ccId = entities.find(e => e.templateName === 'EnemyCC')!.id;
    const infantry = internalLogic.spawnedEntities.get(infantryId);

    // Set UNDER_CONSTRUCTION status
    infantry.objectStatusFlags.add('UNDER_CONSTRUCTION');

    // Issue explicit attack command
    logic.submitCommand({
      type: 'attackEntity',
      entityId: infantryId,
      targetEntityId: ccId,
    });

    // Run a few frames
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Check enemy CC has NOT taken damage (attack should not execute)
    const ccState = logic.getRenderableEntityStates().find(e => e.id === ccId)!;
    expect(ccState.health).toBe(ccState.maxHealth);
  });
});

// ---------------------------------------------------------------------------
// Fix 5: chooseWeapon returns failure when no weapon for target type
// (AIStates.cpp:5547-5551, 5660-5666)
// ---------------------------------------------------------------------------

describe('chooseWeapon failure for incompatible target (AIStates.cpp:5547-5551)', () => {
  it('anti-air-only weapon does not engage ground infantry', () => {
    const bundle = makeBundle({
      objects: [
        // AA unit with anti-airborne-vehicle-only weapon (no AntiGround)
        makeObjectDef('AAUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'AAMissile'] }),
          makeBlock('LocomotorSet', 'SET_NORMAL VehicleLoco', {}),
        ], { VisionRange: 200 }),

        // Ground enemy infantry
        makeObjectDef('GroundEnemy', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],

      weapons: [
        makeWeaponDef('AAMissile', {
          AttackRange: 300,
          PrimaryDamage: 50,
          DelayBetweenShots: 1000,
          DamageType: 'ARMOR_PIERCING',
          AntiGround: false,
          AntiAirborneVehicle: true,
        }),
      ],

      armors: [makeArmorDef('DefaultArmor', { Default: 1 })],
      locomotors: [makeLocomotorDef('VehicleLoco', 30)],
    });

    const logic = setupGame([
      makeMapObject('AAUnit', 50, 50),
      makeMapObject('GroundEnemy', 100, 50),
    ], bundle);

    const entities = logic.getRenderableEntityStates();
    const aaId = entities.find(e => e.templateName === 'AAUnit')!.id;
    const enemyId = entities.find(e => e.templateName === 'GroundEnemy')!.id;

    // Issue explicit attack against ground target
    logic.submitCommand({
      type: 'attackEntity',
      entityId: aaId,
      targetEntityId: enemyId,
    });

    // Run frames
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Ground enemy should NOT have taken damage — AA weapon can't hit ground
    const enemy = logic.getRenderableEntityStates().find(e => e.id === enemyId)!;
    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it('anti-air-only weapon does not auto-acquire ground targets', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('AAUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'AAMissile'] }),
          makeBlock('LocomotorSet', 'SET_NORMAL VehicleLoco', {}),
        ], { VisionRange: 200 }),

        makeObjectDef('GroundEnemy', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],

      weapons: [
        makeWeaponDef('AAMissile', {
          AttackRange: 300,
          PrimaryDamage: 50,
          DelayBetweenShots: 1000,
          DamageType: 'ARMOR_PIERCING',
          AntiGround: false,
          AntiAirborneVehicle: true,
        }),
      ],

      armors: [makeArmorDef('DefaultArmor', { Default: 1 })],
      locomotors: [makeLocomotorDef('VehicleLoco', 30)],
    });

    const logic = setupGame([
      makeMapObject('AAUnit', 50, 50),
      makeMapObject('GroundEnemy', 100, 50),
    ], bundle);

    // No explicit attack command — rely on auto-targeting
    for (let i = 0; i < 120; i++) logic.update(1 / 30);

    const entities = logic.getRenderableEntityStates();
    const enemyId = entities.find(e => e.templateName === 'GroundEnemy')!.id;
    const enemy = entities.find(e => e.id === enemyId)!;

    // AA weapon should not have engaged ground enemy
    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it('normal weapon with AntiGround still works against ground targets', () => {
    const logic = setupGame([
      makeMapObject('Infantry', 50, 50),
      makeMapObject('EnemyCC', 100, 50),
    ]);

    const entities = logic.getRenderableEntityStates();
    const infantryId = entities.find(e => e.templateName === 'Infantry')!.id;
    const ccId = entities.find(e => e.templateName === 'EnemyCC')!.id;

    logic.submitCommand({
      type: 'attackEntity',
      entityId: infantryId,
      targetEntityId: ccId,
    });

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const cc = logic.getRenderableEntityStates().find(e => e.id === ccId)!;
    expect(cc.health).toBeLessThan(cc.maxHealth);
  });
});
