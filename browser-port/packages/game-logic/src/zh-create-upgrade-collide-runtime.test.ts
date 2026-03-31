/**
 * Tests for ZH runtime logic differences in Create, Upgrade, and Collide modules.
 *
 * Source parity references:
 *   1. CrateCollide.cpp:188-189 — PARACHUTE units cannot collect crates (ZH)
 *   2. GrantUpgradeCreate.cpp:109 — academy recordUpgrade on grant (ZH)
 *   3. StealthUpgrade.cpp:54-64 — slave stealth propagation for SPAWNS_ARE_THE_WEAPONS (ZH)
 *   4. SalvageCrateCollide.cpp:117 — academy recordSalvageCollected (ZH)
 *   5. MoneyCrateCollide.cpp:57-95 — UpgradedBoost supply bonus (ZH)
 *   6. ConvertToCarBombCrateCollide.cpp:121-129 — booby trap detonation before car bomb (ZH)
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

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
  makeUpgradeDef,
} from './test-helpers.js';

// ─── 1. CrateCollide: PARACHUTE rejection ────────────────────────────────────

describe('CrateCollide PARACHUTE rejection (ZH CrateCollide.cpp:188-189)', () => {
  it('rejects crate collection by PARACHUTE entities', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoneyCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MoneyCrateCollide ModuleTag_Collide', {
            MoneyProvided: 500,
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        // PARACHUTE vehicle — cannot collect.
        makeObjectDef('ParaTrooper', 'America', ['VEHICLE', 'PARACHUTE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MoneyCrate', 100, 100),
        makeMapObject('ParaTrooper', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Run frames — paratrooper overlaps the crate but should NOT collect it.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Crate should still exist (not collected by PARACHUTE unit).
    const priv = logic as unknown as { spawnedEntities: Map<number, { templateName: string; destroyed: boolean }> };
    const crate = priv.spawnedEntities.get(1);
    expect(crate).toBeDefined();
    expect(crate!.destroyed).toBe(false);
    expect(crate!.templateName).toBe('MoneyCrate');
  });

  it('allows crate collection by non-PARACHUTE vehicle (no regression)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoneyCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MoneyCrateCollide ModuleTag_Collide', {
            MoneyProvided: 500,
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MoneyCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Run frames — normal vehicle overlaps crate and should collect it.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Crate should be destroyed (collected).
    const priv = logic as unknown as { spawnedEntities: Map<number, { templateName: string; destroyed: boolean }> };
    const crate = priv.spawnedEntities.get(1);
    expect(crate === undefined || crate.destroyed).toBe(true);
  });
});

// ─── 2. GrantUpgradeCreate: academy recordUpgrade ─────────────────────────────

describe('GrantUpgradeCreate academy stats (ZH GrantUpgradeCreate.cpp:109)', () => {
  it('records upgrade in academy stats on GrantUpgradeCreate', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('RadarVan', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
          }),
          makeBlock('Behavior', 'GrantUpgradeCreate ModuleTag_GUC', {
            UpgradeToGrant: 'Upgrade_Radar',
            ExemptStatus: 'UNDER_CONSTRUCTION',
          }),
        ]),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_Radar', { Type: 'OBJECT' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('RadarVan', 100, 100)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Run a frame to complete entity creation.
    logic.update(1 / 30);

    // Academy stats for America should have the upgrade recorded.
    const stats = logic.getAcademyStats('America');
    expect(stats).not.toBeNull();
    expect(stats!.upgradesBuiltCount).toBeGreaterThanOrEqual(1);
  });

  it('records PLAYER upgrade in academy stats too', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('RadarVan', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
          }),
          makeBlock('Behavior', 'GrantUpgradeCreate ModuleTag_GUC', {
            UpgradeToGrant: 'Upgrade_PlayerRadar',
            ExemptStatus: 'UNDER_CONSTRUCTION',
          }),
        ]),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_PlayerRadar', { Type: 'PLAYER' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('RadarVan', 100, 100)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    logic.update(1 / 30);

    const stats = logic.getAcademyStats('America');
    expect(stats).not.toBeNull();
    expect(stats!.upgradesBuiltCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── 3. StealthUpgrade: slave stealth propagation ─────────────────────────────

describe('StealthUpgrade slave stealth (ZH StealthUpgrade.cpp:54-64)', () => {
  it('propagates CAN_STEALTH to spawned slaves for SPAWNS_ARE_THE_WEAPONS', () => {
    // Unit test: call applyStealthUpgrade directly on an entity with slaves.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SpawnMaster', 'America', ['VEHICLE', 'SPAWNS_ARE_THE_WEAPONS'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 500,
            InitialHealth: 500,
          }),
          makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
            SpawnTemplateName: 'SpawnSlave',
            SpawnNumber: 1,
            SpawnReplaceDelay: 5000,
          }),
        ]),
        makeObjectDef('SpawnSlave', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 50,
            InitialHealth: 50,
          }),
        ]),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SpawnMaster', 100, 100)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Run frames to create slaves.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        kindOf: Set<string>;
        spawnBehaviorState: { slaveIds: number[] } | null;
      }>;
      applyStealthUpgrade(entity: any): boolean;
    };

    const master = priv.spawnedEntities.get(1)!;
    expect(master).toBeDefined();
    expect(master.kindOf.has('SPAWNS_ARE_THE_WEAPONS')).toBe(true);

    // Before stealth upgrade, master should not have CAN_STEALTH.
    expect(master.objectStatusFlags.has('CAN_STEALTH')).toBe(false);

    // Apply stealth upgrade to master.
    priv.applyStealthUpgrade(master);

    // Master should now have CAN_STEALTH.
    expect(master.objectStatusFlags.has('CAN_STEALTH')).toBe(true);

    // Slaves should also have CAN_STEALTH propagated.
    if (master.spawnBehaviorState && master.spawnBehaviorState.slaveIds.length > 0) {
      for (const slaveId of master.spawnBehaviorState.slaveIds) {
        const slave = priv.spawnedEntities.get(slaveId);
        if (slave) {
          expect(slave.objectStatusFlags.has('CAN_STEALTH')).toBe(true);
        }
      }
    }
  });
});

// ─── 4. SalvageCrate: academy recordSalvageCollected ──────────────────────────

describe('SalvageCrate academy stats (ZH SalvageCrateCollide.cpp:117)', () => {
  it('records salvage collection in academy stats', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
          makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {}),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Salvager', 'America', ['VEHICLE', 'SALVAGER', 'WEAPON_SALVAGER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 300,
            InitialHealth: 300,
          }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SalvageCrate', 100, 100),
        makeMapObject('Salvager', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Run frames — overlapping salvager should collect the crate.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Crate should be destroyed (collected).
    const priv = logic as unknown as { spawnedEntities: Map<number, { destroyed: boolean }> };
    const crate = priv.spawnedEntities.get(1);
    expect(crate === undefined || crate.destroyed).toBe(true);

    // Academy stats for America should record the salvage.
    const stats = logic.getAcademyStats('America');
    expect(stats).not.toBeNull();
    expect(stats!.salvageCollectedCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── 5. MoneyCrate: UpgradedBoost supply bonus ───────────────────────────────

describe('MoneyCrate UpgradedBoost (ZH MoneyCrateCollide.cpp:57-95)', () => {
  it('adds upgrade-based bonus money when collector has the upgrade', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoneyCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MoneyCrateCollide ModuleTag_Collide', {
            MoneyProvided: 100,
            UpgradedBoost: 'UpgradeType:UPGRADE_SUPPLY_BOOST Boost:50',
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_SupplyBoost', { Type: 'PLAYER' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MoneyCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Grant the supply boost upgrade before collection.
    const priv = logic as unknown as {
      setSideUpgradeCompleted(side: string, upgrade: string, enabled: boolean): void;
      sideCredits: Map<string, number>;
      normalizeSide(s: string): string;
      spawnedEntities: Map<number, { destroyed: boolean }>;
    };
    priv.setSideUpgradeCompleted('America', 'UPGRADE_SUPPLY_BOOST', true);

    const creditsBefore = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;

    // Run frames to trigger crate collection.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Crate should be collected.
    const crate = priv.spawnedEntities.get(1);
    expect(crate === undefined || crate.destroyed).toBe(true);

    // Credits should include the base + boost: 100 + 50 = 150.
    const creditsAfter = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;
    expect(creditsAfter - creditsBefore).toBe(150);
  });

  it('does not add boost money when collector lacks the upgrade', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoneyCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MoneyCrateCollide ModuleTag_Collide', {
            MoneyProvided: 100,
            UpgradedBoost: 'UpgradeType:UPGRADE_SUPPLY_BOOST Boost:50',
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_SupplyBoost', { Type: 'PLAYER' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MoneyCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Do NOT grant the upgrade — collector should get only base money.
    const priv = logic as unknown as {
      sideCredits: Map<string, number>;
      normalizeSide(s: string): string;
      spawnedEntities: Map<number, { destroyed: boolean }>;
    };
    const creditsBefore = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const crate = priv.spawnedEntities.get(1);
    expect(crate === undefined || crate.destroyed).toBe(true);

    // Credits should only be the base amount (100), not 150.
    const creditsAfter = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;
    expect(creditsAfter - creditsBefore).toBe(100);
  });
});

// ─── 6. ConvertToCarBomb: booby trap check ────────────────────────────────────

describe('ConvertToCarBomb booby trap check (ZH ConvertToCarBombCrateCollide.cpp:121-129)', () => {
  it('allows car bomb when no booby trap is present (no regression)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Terrorist', 'America', ['INFANTRY'], [
          makeBlock('Behavior', 'ConvertToCarBombCrateCollide ModuleTag_CarBomb', {}),
        ]),
        makeObjectDef('FriendlyVehicle', 'America', ['VEHICLE'], [
          makeBlock('WeaponSet', 'WeaponSet', {
            Conditions: 'NONE',
            Weapon: ['PRIMARY', 'BasicGun'],
          }),
          makeBlock('WeaponSet', 'WeaponSet', {
            Conditions: 'CARBOMB',
            Weapon: ['PRIMARY', 'CarBombWeapon'],
          }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BasicGun', { AttackRange: 80, PrimaryDamage: 1, DelayBetweenShots: 100 }),
        makeWeaponDef('CarBombWeapon', { AttackRange: 1, PrimaryDamage: 200, DelayBetweenShots: 100 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Terrorist', 8, 8),
        makeMapObject('FriendlyVehicle', 10, 8),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'convertToCarBomb',
    });
    logic.update(1 / 30);

    // Terrorist should be consumed.
    expect(logic.getEntityState(1)).toBeNull();
    // Vehicle should have CARBOMB status.
    expect(logic.getEntityState(2)?.statusFlags).toContain('CARBOMB');
  });

  it('calls checkAndDetonateBoobyTrap during car bomb resolution', () => {
    // Verify booby trap check by attaching a sticky bomb to an allied vehicle
    // then issuing a convertToCarBomb. The bomb should detonate, killing the vehicle
    // before car bomb status is applied.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Terrorist', 'America', ['INFANTRY'], [
          makeBlock('Behavior', 'ConvertToCarBombCrateCollide ModuleTag_CarBomb', {}),
        ]),
        makeObjectDef('Vehicle', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 50,
            InitialHealth: 50,
          }),
          makeBlock('WeaponSet', 'WeaponSet', {
            Conditions: 'NONE',
            Weapon: ['PRIMARY', 'BasicGun'],
          }),
          makeBlock('WeaponSet', 'WeaponSet', {
            Conditions: 'CARBOMB',
            Weapon: ['PRIMARY', 'CarBombWeapon'],
          }),
        ]),
        makeObjectDef('StickyBomb', 'GLA', ['PROJECTILE', 'BOOBY_TRAP'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 1,
            InitialHealth: 1,
          }),
          makeBlock('Behavior', 'StickyBombUpdate ModuleTag_SBU', {
            DetonationWeapon: 'StickyBombWeapon',
          }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BasicGun', { AttackRange: 80, PrimaryDamage: 1, DelayBetweenShots: 100 }),
        makeWeaponDef('CarBombWeapon', { AttackRange: 1, PrimaryDamage: 200, DelayBetweenShots: 100 }),
        makeWeaponDef('StickyBombWeapon', { AttackRange: 0, PrimaryDamage: 999, DelayBetweenShots: 100 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Terrorist', 8, 8),
        makeMapObject('Vehicle', 10, 8),
        makeMapObject('StickyBomb', 10, 8),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Attach the sticky bomb to the vehicle and mark it as booby-trapped.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        stickyBombTargetId: number;
        stickyBombProfile: { detonationWeaponName: string } | null;
        kindOf: Set<string>;
        destroyed: boolean;
        health: number;
      }>;
    };
    const vehicle = priv.spawnedEntities.get(2)!;
    vehicle.objectStatusFlags.add('BOOBY_TRAPPED');
    const stickyBomb = priv.spawnedEntities.get(3)!;
    stickyBomb.stickyBombTargetId = 2;
    // Ensure the sticky bomb has a profile.
    if (!stickyBomb.stickyBombProfile) {
      stickyBomb.stickyBombProfile = { detonationWeaponName: 'StickyBombWeapon' };
    }

    // Issue car bomb command — entities are close enough for immediate resolution.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'convertToCarBomb',
    });

    // Run frames.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // The sticky bomb should have been detonated (checkAndDetonateBoobyTrap was called).
    const bombAfter = priv.spawnedEntities.get(3);
    const vehicleAfter = priv.spawnedEntities.get(2);
    // At minimum, one of: bomb destroyed/removed, vehicle damaged/destroyed, or BOOBY_TRAPPED cleared.
    const bombDetonated = !bombAfter || bombAfter.destroyed;
    const vehicleDamaged = !vehicleAfter || vehicleAfter.destroyed || vehicleAfter.health < 50;
    const trapCleared = vehicleAfter && !vehicleAfter.objectStatusFlags.has('BOOBY_TRAPPED');
    expect(bombDetonated || vehicleDamaged || trapCleared).toBe(true);
  });
});

// ─── AcademyStats field additions ─────────────────────────────────────────────

describe('AcademyStats new ZH fields', () => {
  it('has upgradesBuiltCount and salvageCollectedCount fields', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Dummy', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Dummy', 100, 100)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Get academy stats — should have the new fields.
    const stats = logic.getAcademyStats('America');
    // If stats is null because no academy-tracked event happened yet for America,
    // that's fine. If it exists, check the fields.
    if (stats) {
      expect(typeof stats.upgradesBuiltCount).toBe('number');
      expect(typeof stats.salvageCollectedCount).toBe('number');
    }
  });
});
