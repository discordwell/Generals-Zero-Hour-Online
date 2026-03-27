/**
 * Tests for ZH-only combat runtime logic fixes:
 * 1. Sniper vs empty structure returns 0 damage (Weapon.cpp:601-606)
 * 2. DISARM returns 0 for non-mine/non-trap targets (Weapon.cpp:622-628)
 * 3. GLA rebuild-hole attack transfer on RECONSTRUCTING death (Object.cpp:4640-4667)
 * 4. Spawn-weapon slave disabling on EMP (Object.cpp:2149-2163)
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  resolveSniperDamageVsEmptyStructure,
  resolveDisarmDamage,
} from './combat-helpers.js';
import { tryTransferAttackersToRebuildHole } from './entity-lifecycle.js';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Fix 1: Sniper vs empty structure (Weapon.cpp:601-606)
// ---------------------------------------------------------------------------

describe('sniper damage vs empty structure (Weapon.cpp:601-606)', () => {
  it('returns 0 damage when SNIPER targets empty STRUCTURE with contain module', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, 0)).toBe(0);
  });

  it('returns full damage when SNIPER targets occupied STRUCTURE', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, 3)).toBe(50);
  });

  it('returns full damage when SNIPER targets STRUCTURE without contain module', () => {
    const kindOf = new Set(['STRUCTURE']);
    // null containCount means no contain module exists.
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, null)).toBe(50);
  });

  it('returns full damage for non-SNIPER damage types against empty STRUCTURE', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'ARMOR_PIERCING', kindOf, 0)).toBe(50);
  });

  it('returns full damage for SNIPER against non-STRUCTURE target', () => {
    const kindOf = new Set(['INFANTRY']);
    expect(resolveSniperDamageVsEmptyStructure(50, 'SNIPER', kindOf, 0)).toBe(50);
  });

  it('integrates with applyWeaponDamageAmount end-to-end', () => {
    // Build a scenario with a sniper shooting an empty garrisonable structure.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Sniper', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SniperRifle'] }),
        ]),
        makeObjectDef('EmptyBuilding', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            MaxNumberOfUnits: 10,
          }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SniperRifle', {
          AttackRange: 200,
          PrimaryDamage: 100,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 2000,
          DamageType: 'SNIPER',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Sniper', 20, 50),
        makeMapObject('EmptyBuilding', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run for a while — the building should take NO damage since it's empty.
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    const building = logic.getEntityState(2);
    expect(building).not.toBeNull();
    expect(building!.health).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: DISARM returns 0 for non-mine/non-trap targets (Weapon.cpp:622-628)
// ---------------------------------------------------------------------------

describe('DISARM damage type enforcement (Weapon.cpp:622-628)', () => {
  it('returns 1.0 for MINE targets', () => {
    const kindOf = new Set(['MINE']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(1.0);
  });

  it('returns 1.0 for BOOBY_TRAP targets', () => {
    const kindOf = new Set(['BOOBY_TRAP']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(1.0);
  });

  it('returns 1.0 for DEMOTRAP targets', () => {
    const kindOf = new Set(['DEMOTRAP']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(1.0);
  });

  it('returns 0 for DISARM against non-mine/trap target (e.g. VEHICLE)', () => {
    const kindOf = new Set(['VEHICLE']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(0);
  });

  it('returns 0 for DISARM against STRUCTURE', () => {
    const kindOf = new Set(['STRUCTURE']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(0);
  });

  it('returns 0 for DISARM against INFANTRY', () => {
    const kindOf = new Set(['INFANTRY']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(0);
  });

  it('does not affect non-DISARM damage types', () => {
    const kindOf = new Set(['VEHICLE']);
    expect(resolveDisarmDamage(50, 'ARMOR_PIERCING', kindOf)).toBe(50);
    expect(resolveDisarmDamage(50, 'EXPLOSION', kindOf)).toBe(50);
  });

  it('returns 1.0 when target has multiple kindOf including MINE', () => {
    const kindOf = new Set(['STRUCTURE', 'MINE']);
    expect(resolveDisarmDamage(50, 'DISARM', kindOf)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: GLA rebuild-hole attack transfer on RECONSTRUCTING death
// (Object.cpp:4640-4667)
// ---------------------------------------------------------------------------

describe('reconstruct attacker transfer to rebuild hole (Object.cpp:4640-4667)', () => {
  it('transfers attackers from RECONSTRUCTING building to hole on death', () => {
    // Minimal mock of GL (self) and MapEntity for direct function test.
    const hole = {
      id: 10,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
    };
    const reconstructing = {
      id: 20,
      destroyed: false,
      objectStatusFlags: new Set(['RECONSTRUCTING']),
      producerEntityId: 10,
    };
    const attacker1 = {
      id: 30,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      attackTargetEntityId: 20,
    };
    const attacker2 = {
      id: 31,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      attackTargetEntityId: 20,
    };
    const bystander = {
      id: 32,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      attackTargetEntityId: 99,
    };

    const entities = new Map<number, any>();
    entities.set(10, hole);
    entities.set(20, reconstructing);
    entities.set(30, attacker1);
    entities.set(31, attacker2);
    entities.set(32, bystander);

    const self = { spawnedEntities: entities };
    tryTransferAttackersToRebuildHole(self as any, reconstructing as any);

    expect(attacker1.attackTargetEntityId).toBe(10); // Transferred to hole.
    expect(attacker2.attackTargetEntityId).toBe(10); // Transferred to hole.
    expect(bystander.attackTargetEntityId).toBe(99); // Unchanged.
  });

  it('does nothing if entity is not RECONSTRUCTING', () => {
    const entity = {
      id: 20,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      producerEntityId: 10,
    };
    const attacker = {
      id: 30,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      attackTargetEntityId: 20,
    };
    const hole = {
      id: 10,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
    };

    const entities = new Map<number, any>();
    entities.set(10, hole);
    entities.set(20, entity);
    entities.set(30, attacker);

    const self = { spawnedEntities: entities };
    tryTransferAttackersToRebuildHole(self as any, entity as any);

    expect(attacker.attackTargetEntityId).toBe(20); // Unchanged.
  });

  it('does nothing if producer (hole) is destroyed', () => {
    const hole = {
      id: 10,
      destroyed: true,
      objectStatusFlags: new Set<string>(),
    };
    const reconstructing = {
      id: 20,
      destroyed: false,
      objectStatusFlags: new Set(['RECONSTRUCTING']),
      producerEntityId: 10,
    };
    const attacker = {
      id: 30,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      attackTargetEntityId: 20,
    };

    const entities = new Map<number, any>();
    entities.set(10, hole);
    entities.set(20, reconstructing);
    entities.set(30, attacker);

    const self = { spawnedEntities: entities };
    tryTransferAttackersToRebuildHole(self as any, reconstructing as any);

    expect(attacker.attackTargetEntityId).toBe(20); // Unchanged — hole is destroyed.
  });

  it('does nothing if producerEntityId is 0 (no hole)', () => {
    const reconstructing = {
      id: 20,
      destroyed: false,
      objectStatusFlags: new Set(['RECONSTRUCTING']),
      producerEntityId: 0,
    };
    const attacker = {
      id: 30,
      destroyed: false,
      objectStatusFlags: new Set<string>(),
      attackTargetEntityId: 20,
    };

    const entities = new Map<number, any>();
    entities.set(20, reconstructing);
    entities.set(30, attacker);

    const self = { spawnedEntities: entities };
    tryTransferAttackersToRebuildHole(self as any, reconstructing as any);

    expect(attacker.attackTargetEntityId).toBe(20); // Unchanged.
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Spawn-weapon slave disabling on EMP (Object.cpp:2149-2163)
// ---------------------------------------------------------------------------

describe('SPAWNS_ARE_THE_WEAPONS EMP slave disable (Object.cpp:2149-2163)', () => {
  function makeSpawnMasterBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('StingerSite', 'GLA', ['STRUCTURE', 'SPAWNS_ARE_THE_WEAPONS'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
            SpawnNumber: 3,
            SpawnTemplateName: 'StingerSoldier',
            SpawnReplaceDelay: 5000,
            SpawnedRequireSpawner: 'Yes',
          }),
        ]),
        makeObjectDef('StingerSoldier', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'SlavedUpdate ModuleTag_Slave', {
            GuardMaxRange: 50,
            GuardWanderRange: 10,
            AttackRange: 100,
            AttackWanderRange: 50,
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'StingerMissile'] }),
        ]),
        // EMP attacker (e.g., Microwave Tank or EMP pulse)
        makeObjectDef('EmpPulse', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            DisabledDuration: 10000,
            EffectRadius: 200,
            StartsPaused: 'No',
          }),
        ]),
      ],
      weapons: [
        makeWeaponDef('StingerMissile', {
          AttackRange: 150,
          PrimaryDamage: 25,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 500,
          DelayBetweenShots: 1500,
        }),
      ],
    });
  }

  it('disables slaves when master is EMP-disabled via applyEmpDisable', () => {
    const bundle = makeSpawnMasterBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StingerSite', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run a few frames so spawns are created.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const internalLogic = logic as any;
    // Find master and slaves via internal spawnedEntities map.
    let masterEntity: any = null;
    const slaveEntities: any[] = [];
    for (const entity of internalLogic.spawnedEntities.values()) {
      if (entity.templateName === 'StingerSite' && !entity.destroyed) {
        masterEntity = entity;
      }
      if (entity.templateName === 'StingerSoldier' && !entity.destroyed) {
        slaveEntities.push(entity);
      }
    }

    expect(masterEntity).not.toBeNull();
    expect(slaveEntities.length).toBeGreaterThan(0);
    expect(masterEntity.kindOf.has('SPAWNS_ARE_THE_WEAPONS')).toBe(true);

    // Verify slaves are not EMP disabled initially.
    for (const slave of slaveEntities) {
      expect(slave.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    }

    // Apply EMP disable to master — should propagate to slaves.
    internalLogic.applyEmpDisable(masterEntity, 300);

    // Verify master is DISABLED_EMP.
    expect(masterEntity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);

    // Verify slaves are also DISABLED_EMP.
    for (const slave of slaveEntities) {
      expect(slave.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    }
  });

  it('clears slave EMP disable when master EMP expires', () => {
    const bundle = makeSpawnMasterBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StingerSite', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run to spawn slaves.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const internalLogic = logic as any;
    let masterEntity: any = null;
    const slaveEntities: any[] = [];
    for (const entity of internalLogic.spawnedEntities.values()) {
      if (entity.templateName === 'StingerSite' && !entity.destroyed) {
        masterEntity = entity;
      }
      if (entity.templateName === 'StingerSoldier' && !entity.destroyed) {
        slaveEntities.push(entity);
      }
    }

    expect(masterEntity).not.toBeNull();
    expect(slaveEntities.length).toBeGreaterThan(0);

    // Apply EMP disable with 300-frame duration.
    internalLogic.applyEmpDisable(masterEntity, 300);

    // Verify all are disabled.
    expect(masterEntity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    for (const slave of slaveEntities) {
      expect(slave.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    }

    // Advance past the EMP duration (300 frames = 10 seconds at 30fps).
    for (let i = 0; i < 350; i++) {
      logic.update(1 / 30);
    }

    // Verify master EMP has cleared.
    expect(masterEntity.objectStatusFlags.has('DISABLED_EMP')).toBe(false);

    // Verify slaves EMP has also cleared.
    for (const slave of slaveEntities) {
      if (!slave.destroyed) {
        expect(slave.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
      }
    }
  });
});
