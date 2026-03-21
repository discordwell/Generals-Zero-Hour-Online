/**
 * Parity Tests — AI supply truck double scan distance, garrison fire positions,
 * and garrison entry rejection at REALLYDAMAGED.
 *
 * Source references:
 *   SupplyTruckAIUpdate.cpp:237-244 — getWarehouseScanDistance() returns 2x for AI (PLAYER_COMPUTER)
 *   GarrisonContain.cpp:629-705 — trackTargets() uses named FIREPOINT bones for firing positions
 *   GarrisonContain.cpp:518-547 — isValidContainerFor() rejects entry at BODY_REALLYDAMAGED
 *   GarrisonContain.cpp:1416-1424 — onBodyDamageStateChange() auto-ejects at REALLYDAMAGED
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeLocomotorDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ── Test 1: AI Supply Truck Double Scan Distance ──────────────────────────

describe('AI supply truck double scan distance', () => {
  /**
   * C++ parity: SupplyTruckAIUpdate::getWarehouseScanDistance() (line 237-244)
   *
   *   Real SupplyTruckAIUpdate::getWarehouseScanDistance() const {
   *     if (getObject()->getControllingPlayer()->getPlayerType() == PLAYER_COMPUTER) {
   *       return 2 * getSupplyTruckAIUpdateModuleData()->m_warehouseScanDistance;
   *     }
   *     return getSupplyTruckAIUpdateModuleData()->m_warehouseScanDistance;
   *   }
   *
   * AI players get 2x the configured SupplyWarehouseScanDistance so their
   * supply trucks can locate warehouses further away without manual player
   * intervention. Human players use the base 1x distance.
   */

  function makeSupplyScanBundle(scanDistance: number) {
    return makeBundle({
      objects: [
        // Supply warehouse — placed far from the truck
        makeObjectDef('TestWarehouse', 'Neutral', ['STRUCTURE', 'SUPPLY_SOURCE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
            StartingBoxes: 50,
            DeleteWhenEmpty: 'No',
          }),
        ]),
        // Supply center (depot)
        makeObjectDef('TestDepot', 'America', ['STRUCTURE', 'SUPPLY_CENTER', 'CAN_PERSIST_AND_CHANGE_OWNER'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'SupplyCenterDockUpdate ModuleTag_Dock', {
            ValueMultiplier: 1,
          }),
        ]),
        // Supply truck with a small scan distance
        makeObjectDef('TestTruck', 'America', ['VEHICLE', 'HARVESTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 150, InitialHealth: 150 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TruckLoco', {}),
          makeBlock('Behavior', 'SupplyTruckAIUpdate ModuleTag_AI', {
            MaxBoxes: 3,
            SupplyCenterActionDelay: 0,
            SupplyWarehouseActionDelay: 0,
            SupplyWarehouseScanDistance: scanDistance,
          }),
        ], { VisionRange: 200, ShroudClearingRange: 200 }),
      ],
      locomotors: [
        makeLocomotorDef('TruckLoco', 60),
      ],
    });
  }

  it('AI (COMPUTER) player truck finds warehouse beyond 1x scan distance (within 2x)', () => {
    // Scan distance = 200. Warehouse is ~350 units away from truck.
    // 1x range = 200 (too far), 2x range = 400 (within range).
    // AI player should find the warehouse.
    const scanDistance = 200;
    const bundle = makeSupplyScanBundle(scanDistance);
    const logic = createLogic();

    // Place truck at (10,20), depot at (15,20), warehouse far away at (360,20).
    // Distance from truck to warehouse = 350, which is > 200 but < 400.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestWarehouse', 360, 20),
        makeMapObject('TestDepot', 15, 20),
        makeMapObject('TestTruck', 10, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'Neutral');

    // Set America as AI (COMPUTER) player — this gives 2x scan distance.
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.setSideCredits('America', 0);
    logic.update(0);

    expect(logic.getSideCredits('america')).toBe(0);

    // Run enough frames for the truck to gather and deposit.
    for (let i = 0; i < 600; i++) {
      logic.update(1 / 30);
    }

    const aiCredits = logic.getSideCredits('america');
    // AI truck should have found the warehouse (within 2x scan distance = 400)
    // and earned credits.
    expect(aiCredits).toBeGreaterThan(0);
  });

  it('HUMAN player truck does NOT find warehouse beyond 1x scan distance', () => {
    // Same setup: scan distance = 200, warehouse at ~350 units away.
    // Human player uses 1x range = 200 — warehouse is out of range.
    const scanDistance = 200;
    const bundle = makeSupplyScanBundle(scanDistance);
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestWarehouse', 360, 20),
        makeMapObject('TestDepot', 15, 20),
        makeMapObject('TestTruck', 10, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'Neutral');

    // Set America as HUMAN player — uses 1x scan distance.
    logic.setSidePlayerType('America', 'HUMAN');
    logic.setSideCredits('America', 0);
    logic.update(0);

    expect(logic.getSideCredits('america')).toBe(0);

    // Run the same number of frames.
    for (let i = 0; i < 600; i++) {
      logic.update(1 / 30);
    }

    const humanCredits = logic.getSideCredits('america');
    // Human truck should NOT have found the warehouse (beyond 1x scan distance = 200).
    // Credits should remain 0.
    expect(humanCredits).toBe(0);
  });

  it('both AI and HUMAN find warehouse within 1x scan distance', () => {
    // Sanity check: warehouse within 1x scan distance (both should find it).
    const scanDistance = 500;
    const bundle = makeSupplyScanBundle(scanDistance);

    // Run with COMPUTER player type.
    const logicAi = createLogic();
    logicAi.loadMapObjects(
      makeMap([
        makeMapObject('TestWarehouse', 20, 20),
        makeMapObject('TestDepot', 40, 20),
        makeMapObject('TestTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logicAi.setPlayerSide(0, 'America');
    logicAi.setPlayerSide(1, 'Neutral');
    logicAi.setSidePlayerType('America', 'COMPUTER');
    logicAi.setSideCredits('America', 0);
    logicAi.update(0);

    for (let i = 0; i < 600; i++) logicAi.update(1 / 30);
    const aiCredits = logicAi.getSideCredits('america');

    // Run with HUMAN player type.
    const logicHuman = createLogic();
    logicHuman.loadMapObjects(
      makeMap([
        makeMapObject('TestWarehouse', 20, 20),
        makeMapObject('TestDepot', 40, 20),
        makeMapObject('TestTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logicHuman.setPlayerSide(0, 'America');
    logicHuman.setPlayerSide(1, 'Neutral');
    logicHuman.setSidePlayerType('America', 'HUMAN');
    logicHuman.setSideCredits('America', 0);
    logicHuman.update(0);

    for (let i = 0; i < 600; i++) logicHuman.update(1 / 30);
    const humanCredits = logicHuman.getSideCredits('america');

    // Both should earn credits when warehouse is within base scan distance.
    expect(aiCredits).toBeGreaterThan(0);
    expect(humanCredits).toBeGreaterThan(0);
  });
});

// ── Test 2: Garrison Fire Position (Center vs Bone) ──────────────────────

describe('garrison fire position — center vs FIREPOINT bones', () => {
  /**
   * C++ parity: GarrisonContain.cpp — trackTargets() (line 629-705)
   *
   * In C++, garrisoned units fire from named FIREPOINT bones on the building
   * model. These bones are positioned at the building edges (windows, ports),
   * allowing garrisoned units to fire from the building perimeter rather than
   * the geometric center. The garrison module actively shuffles units between
   * fire points to track their targets optimally.
   *
   * TS behavior: Garrisoned units are placed at the building's center position
   * (enterGarrisonBuilding sets source.x = building.x, source.z = building.z).
   * Range checks use this center position, not edge fire points. This means a
   * target that is barely within weapon range from the building edge but outside
   * range from center will be unreachable in TS but reachable in C++.
   *
   * Parity gap: TS fires from building center; C++ fires from FIREPOINT bones
   * at the building edge. This is a known simplification — implementing per-bone
   * fire positions requires the W3D model bone system.
   */

  it('garrisoned infantry fire from building center position (not edge fire points)', () => {
    // Setup: Building at (30,30) with geometry radius ~15.
    // Enemy target at (30 + weaponRange - 5, 30) — within weapon range from edge
    // but we test that garrisoned units DO fire from center (their actual position).
    const weaponRange = 100;
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Barracks', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeWeaponBlock('RangerGun'),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('RangerGun', {
          PrimaryDamage: 10,
          DamageType: 'SMALL_ARMS',
          AttackRange: weaponRange,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();

    // Place building at (30,30), ranger starts adjacent, target within range from center.
    // Distance from building center (30,30) to target (30 + 80, 30) = 80 < 100 = in range.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Barracks', 30, 30),
        makeMapObject('Ranger', 32, 30),   // starts near building
        makeMapObject('Target', 110, 30),   // 80 units from building center
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Garrison the ranger in the building.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Verify garrison succeeded.
    const buildingState = logic.getEntityState(1);
    expect(buildingState!.modelConditionFlags ?? []).toContain('LOADED');

    // The garrisoned ranger's position should now be at the building center.
    // Source parity gap: In C++, the ranger would be at a FIREPOINT bone position
    // at the building edge. In TS, the ranger is at building center.
    const rangerState = logic.getEntityState(2);
    expect(rangerState).toBeDefined();
    // Ranger position should match building position (center-based firing).
    expect(rangerState!.x).toBeCloseTo(buildingState!.x, 0);
    expect(rangerState!.z).toBeCloseTo(buildingState!.z, 0);

    // Issue attack against the target (within weapon range from center).
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 2,
      targetEntityId: 3,
      commandSource: 'PLAYER',
    });

    const targetBefore = logic.getEntityState(3)!.health;
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const targetAfter = logic.getEntityState(3)!.health;

    // TS behavior: garrisoned unit fires from center (30,30) at target (110,30).
    // Distance = 80, weapon range = 100. Target IS in range from center.
    // Target should take damage.
    expect(targetAfter).toBeLessThan(targetBefore);
  });

  it('documents parity gap: target at edge-range is reachable from center in both C++ and TS when close enough', () => {
    // In C++, FIREPOINT bones at building edges could extend effective range by
    // the building's radius. A target at exactly (center + weaponRange) distance
    // would be reachable from edge fire points in C++ but also from center in TS
    // if within weaponRange. The gap only manifests when the target is between
    // (center + weaponRange) and (edge + weaponRange) — i.e., beyond center range
    // but within edge range.
    //
    // This test documents that TS uses center-based range, which is the expected
    // behavior in the current implementation.

    const weaponRange = 50;
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Bunker', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeWeaponBlock('ShortGun'),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('ShortGun', {
          PrimaryDamage: 10,
          DamageType: 'SMALL_ARMS',
          AttackRange: weaponRange,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();

    // Building at (30,30). Target at (30 + weaponRange + 20, 30) = (100, 30).
    // Distance from center = 70, weapon range = 50 => OUT OF RANGE from center.
    // In C++, with a FIREPOINT bone at (30+15, 30) = (45, 30), distance = 55, still > 50.
    // But with a bone at (30+20, 30) = (50, 30), distance = 50, exactly at range.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Bunker', 30, 30),
        makeMapObject('Soldier', 32, 30),
        makeMapObject('EnemyVehicle', 100, 30),   // 70 units from building center
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Garrison soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Issue attack from garrisoned soldier.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 2,
      targetEntityId: 3,
      commandSource: 'PLAYER',
    });

    const targetBefore = logic.getEntityState(3)!.health;
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const targetAfter = logic.getEntityState(3)!.health;

    // TS behavior: Distance from center (30,30) to target (100,30) = 70.
    // Weapon range = 50. Target is OUT OF RANGE.
    // In C++, a FIREPOINT bone near the edge could bring this target into range.
    // Document: target should NOT take damage in TS (center-based range).
    expect(targetAfter).toBe(targetBefore);
  });
});

// ── Test 3: Garrison Entry Rejection at REALLYDAMAGED ────────────────────

describe('garrison entry rejection at REALLYDAMAGED', () => {
  /**
   * C++ parity: GarrisonContain.cpp:518-547 — isValidContainerFor()
   *
   *   Bool GarrisonContain::isValidContainerFor(const Object* obj, Bool checkCapacity) const {
   *     ...
   *     // ReallyDamaged buildings are not garrisonable as well.
   *     if (getObject()->getBodyModule()->getDamageState() == BODY_REALLYDAMAGED
   *         && !getObject()->isKindOf(KINDOF_GARRISONABLE_UNTIL_DESTROYED))
   *       return false;
   *     ...
   *   }
   *
   * In C++, buildings at BODY_REALLYDAMAGED (health <= 10% of max) reject new
   * garrison entries unless the building has KINDOF_GARRISONABLE_UNTIL_DESTROYED.
   *
   * TS parity: canExecuteGarrisonBuildingEnterAction() in containment-system.ts
   * now checks the building's body damage state. Buildings at REALLYDAMAGED or
   * RUBBLE reject garrison entry unless they have GARRISONABLE_UNTIL_DESTROYED.
   */

  it('rejects garrisoning a REALLYDAMAGED building (C++ parity)', () => {
    // REALLYDAMAGED threshold: health/maxHealth <= 0.1 (10%).
    // For MaxHealth=1000, health <= 100 = REALLYDAMAGED.
    // Weapon does 10 damage/shot every ~3 frames. 280 frames ≈ 93 shots = 930 damage.
    // Building health: 1000 - 930 = 70 HP (REALLYDAMAGED, still alive).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GarrisonBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 5,
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('DamageDealer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('DamageGun'),
        ]),
      ],
      weapons: [
        makeWeaponDef('DamageGun', {
          PrimaryDamage: 10,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 120,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('GarrisonBuilding', 30, 30),    // id 1
        makeMapObject('Infantry', 32, 30),              // id 2
        makeMapObject('DamageDealer', 60, 30),          // id 3
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Verify building starts at full health.
    expect(logic.getEntityState(1)!.health).toBe(1000);

    // Damage building to REALLYDAMAGED (10% = 100 HP).
    // 280 frames with 10 dmg/shot ≈ 93 shots = 930 dmg → health = 70.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 3,
      targetEntityId: 1,
      commandSource: 'PLAYER',
    });
    for (let i = 0; i < 280; i++) logic.update(1 / 30);

    // Stop the attacker.
    logic.submitCommand({ type: 'stop', entityId: 3, commandSource: 'PLAYER' });
    logic.update(1 / 30);

    // Verify building is in REALLYDAMAGED state (health <= 10% of 1000 = 100 HP).
    const buildingHealth = logic.getEntityState(1)!.health;
    expect(buildingHealth).toBeGreaterThan(0);
    expect(buildingHealth).toBeLessThanOrEqual(100);

    // Now try to garrison infantry into the REALLYDAMAGED building.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // C++ parity: GarrisonContain::isValidContainerFor() rejects entry at REALLYDAMAGED.
    // TS now matches — garrison entry should be rejected.
    const buildingState = logic.getEntityState(1);
    const infantryState = logic.getEntityState(2);

    // Building should NOT have LOADED condition (no one garrisoned).
    expect(buildingState!.modelConditionFlags ?? []).not.toContain('LOADED');
    // Infantry should NOT be held (garrison rejected).
    expect(infantryState!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });

  it('GARRISONABLE_UNTIL_DESTROYED building accepts garrison at REALLYDAMAGED (matches C++)', () => {
    // In C++, buildings with KINDOF_GARRISONABLE_UNTIL_DESTROYED bypass the
    // REALLYDAMAGED rejection. This should work in both C++ and TS.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToughBuilding', 'America', ['STRUCTURE', 'GARRISONABLE_UNTIL_DESTROYED'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 5,
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('DamageDealer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('DamageGun'),
        ]),
      ],
      weapons: [
        makeWeaponDef('DamageGun', {
          PrimaryDamage: 10,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 120,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToughBuilding', 30, 30),    // id 1
        makeMapObject('Infantry', 32, 30),           // id 2
        makeMapObject('DamageDealer', 60, 30),       // id 3
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Damage building to REALLYDAMAGED (10% of 1000 = 100 HP).
    // 280 frames with 10 dmg/shot ≈ 93 shots = 930 dmg → health = 70.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 3,
      targetEntityId: 1,
      commandSource: 'PLAYER',
    });
    for (let i = 0; i < 280; i++) logic.update(1 / 30);

    logic.submitCommand({ type: 'stop', entityId: 3, commandSource: 'PLAYER' });
    logic.update(1 / 30);

    const buildingHealth = logic.getEntityState(1)!.health;
    expect(buildingHealth).toBeGreaterThan(0);
    expect(buildingHealth).toBeLessThanOrEqual(100);

    // Garrison should succeed — GARRISONABLE_UNTIL_DESTROYED allows it even in C++.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const buildingState = logic.getEntityState(1);
    const infantryState = logic.getEntityState(2);

    // Both C++ and TS should allow this entry.
    expect(buildingState!.modelConditionFlags ?? []).toContain('LOADED');
    expect(infantryState!.statusFlags ?? []).toContain('DISABLED_HELD');
  });

  it('healthy building accepts garrison normally (baseline sanity check)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HealthyBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 5,
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealthyBuilding', 30, 30),
        makeMapObject('Infantry', 32, 30),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    // Healthy building at full HP — garrison should work in both C++ and TS.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const buildingState = logic.getEntityState(1);
    expect(buildingState!.modelConditionFlags ?? []).toContain('LOADED');

    const infantryState = logic.getEntityState(2);
    expect(infantryState!.statusFlags ?? []).toContain('DISABLED_HELD');
  });
});
