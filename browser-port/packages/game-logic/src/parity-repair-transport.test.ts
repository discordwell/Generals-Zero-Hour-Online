/**
 * Parity tests for dozer repair rate and transport container max capacity.
 *
 * Source references:
 *   DozerAIUpdate.cpp — m_repairHealthPercentPerSecond heals buildings per frame
 *   TransportContain.cpp:123-222 — isValidContainerFor() enforces slot capacity, rejects when full
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
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

// ---------------------------------------------------------------------------
// Test 1: Dozer Repair Rate
// ---------------------------------------------------------------------------
// C++ source: DozerAIUpdate.cpp — getRepairHealthPerSecond() returns
// DozerAIUpdateModuleData::m_repairHealthPercentPerSecond. The per-frame
// heal amount is:
//   healAmount = repairHealthPercentPerSecond * maxHealth / LOGICFRAMES_PER_SECOND
//
// TS: command-dispatch.ts:2599-2603 — uses the same formula:
//   const healAmount = (repairHealthPercentPerSecond / LOGIC_FRAME_RATE) * building.maxHealth;
//
// With repairHealthPercentPerSecond = 0.10 (10% per second), maxHealth = 1000,
// and LOGIC_FRAME_RATE = 30:
//   per-frame heal = 0.10 / 30 * 1000 = 3.333... HP/frame
//   30 frames = 1 second => total heal = 0.10 * 1000 = 100 HP
//
// The dozer must be within 20 world units to begin repairing (command-dispatch.ts:2590).

describe('Dozer repair rate (C++ parity)', () => {
  function makeDozerRepairSetup(repairRate = 0.10) {
    // Note: the INI bundle stores RepairHealthPercentPerSecond as a real fraction
    // (e.g. 0.02 = 2% per second). The C++ parser uses INI::parsePercentToReal which
    // divides the INI text value by 100, but the bundled JSON already stores the
    // converted fraction. So we pass the fraction directly here.
    const dozerDef = makeObjectDef('Dozer', 'America', ['VEHICLE', 'DOZER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 300,
        InitialHealth: 300,
      }),
      makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
        RepairHealthPercentPerSecond: repairRate,
        BoredTime: 99999,
        BoredRange: 0,
      }),
    ]);

    const buildingDef = makeObjectDef('DamagedBuilding', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 1000,
        InitialHealth: 1000,
      }),
      makeBlock('Behavior', 'BaseRegenerateUpdate ModuleTag_BaseRegen', {}),
    ]);

    const bundle = makeBundle({
      objects: [dozerDef, buildingDef],
    });

    const logic = createLogic();
    // Place dozer close to building (within 20 units for immediate repair).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('DamagedBuilding', 20, 20), // id 1
        makeMapObject('Dozer', 22, 20),             // id 2
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    return { logic };
  }

  it('dozer heals building at repairHealthPercentPerSecond * maxHealth per second', () => {
    // C++ source: DozerAIUpdate.cpp:2319-2321 — getRepairHealthPerSecond()
    // returns m_repairHealthPercentPerSecond, used per-frame as:
    //   maxHealth * repairHealthPercentPerSecond / LOGICFRAMES_PER_SECOND
    //
    // With repairRate=0.10, maxHealth=1000, 30fps:
    //   per-second heal = 0.10 * 1000 = 100 HP
    //   after 30 frames (1 second) => ~100 HP healed
    const { logic } = makeDozerRepairSetup(0.10);

    // Damage building to 500 HP (50% health).
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
      }>;
    };
    const building = priv.spawnedEntities.get(1)!;
    building.health = 500;
    expect(logic.getEntityState(1)!.health).toBe(500);

    // Issue repair command.
    logic.submitCommand({
      type: 'repairBuilding',
      entityId: 2,
      targetBuildingId: 1,
    });

    // Step 30 frames (1 second at 30fps).
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const healthAfter = logic.getEntityState(1)!.health;
    // Dozer repair: repairHealthPercentPerSecond(0.10) * maxHealth(1000) = 100 HP/sec
    //   Per-frame heal = 0.10 / 30 * 1000 = 3.333 HP/frame, 30 frames = ~100 HP.
    //
    // Base regen is gated by GameData::m_baseRegenHealthPercentPerSecond. The C++
    // default is 0.0; this test does not configure a non-zero GameData value, so
    // BaseRegenerateUpdate is disabled (matches BaseRenerateUpdate.cpp:76).
    const healedAmount = healthAfter - 500;
    expect(healedAmount).toBeGreaterThan(0);
    expect(healedAmount).toBeGreaterThanOrEqual(99);
    expect(healedAmount).toBeLessThanOrEqual(101);
  });

  it('dozer does not repair a building at full health', () => {
    const { logic } = makeDozerRepairSetup(0.10);

    // Building starts at full health (1000/1000).
    expect(logic.getEntityState(1)!.health).toBe(1000);

    // Try to issue repair command on full-health building.
    logic.submitCommand({
      type: 'repairBuilding',
      entityId: 2,
      targetBuildingId: 1,
    });

    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Health should remain at 1000 — canDozerRepairTarget rejects full-health buildings.
    expect(logic.getEntityState(1)!.health).toBe(1000);
  });

  it('dozer stops repairing when building reaches full health', () => {
    const { logic } = makeDozerRepairSetup(0.10);

    // Damage building slightly — only 50 HP missing.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
      }>;
    };
    const building = priv.spawnedEntities.get(1)!;
    building.health = 950;

    logic.submitCommand({
      type: 'repairBuilding',
      entityId: 2,
      targetBuildingId: 1,
    });

    // Run 60 frames (2 seconds). At 100 HP/sec, building should reach 1000 HP
    // and stop — health should be capped at maxHealth.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const finalHealth = logic.getEntityState(1)!.health;
    // Health must be capped at maxHealth (1000), not exceed it.
    expect(finalHealth).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Transport Container Max Capacity
// ---------------------------------------------------------------------------
// C++ source: TransportContain.cpp:160-217 — isValidContainerFor()
//
//   Int transportSlotCount = rider->getTransportSlotCount();
//   if (transportSlotCount == 0) return false;
//   if (checkCapacity) {
//     Int containMax = getContainMax();
//     Int containCount = getContainCount();
//     return (m_extraSlotsInUse + containCount + transportSlotCount <= containMax);
//   }
//
// The Slots (or ContainMax) field on the transport defines how many total
// transport slot units it can hold. Each rider has a TransportSlotCount
// defining how many slots it consumes. When the sum of used slots plus the
// new rider's slots exceeds the capacity, the entry is rejected.
//
// TS: index.ts:11657-11689 — canScriptContainerFitEntity() checks:
//   const entitySlots = this.resolveScriptEntityTransportSlotCount(entity);
//   const usedSlots = this.resolveScriptContainerUsedTransportSlots(container);
//   return usedSlots + entitySlots <= containProfile.transportCapacity;

describe('Transport container max capacity (C++ parity)', () => {
  function makeTransportCapacitySetup(transportSlots = 3) {
    const transportDef = makeObjectDef('Humvee', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 300,
        InitialHealth: 300,
      }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        Slots: transportSlots,
        AllowInsideKindOf: 'INFANTRY',
      }),
    ]);

    const infantryDef = makeObjectDef('Ranger', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
    ], { TransportSlotCount: 1 });

    const bundle = makeBundle({
      objects: [transportDef, infantryDef],
    });

    const logic = createLogic();
    // Place transport and 4 infantry nearby. Transport has 3 slots.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Humvee', 20, 20),   // id 1 (transport)
        makeMapObject('Ranger', 22, 20),   // id 2
        makeMapObject('Ranger', 24, 20),   // id 3
        makeMapObject('Ranger', 26, 20),   // id 4
        makeMapObject('Ranger', 28, 20),   // id 5
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    return { logic };
  }

  it('loads 3 infantry into a transport with Slots=3 and rejects the 4th', () => {
    // C++ source: TransportContain.cpp:199-210 — each rider has TransportSlotCount=1,
    // capacity is 3. After loading 3, the 4th is rejected because
    // (usedSlots + transportSlotCount > containMax).
    const { logic } = makeTransportCapacitySetup(3);

    // Load 3 infantry.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // All 3 should be inside.
    const state2 = logic.getEntityState(2)!;
    const state3 = logic.getEntityState(3)!;
    const state4 = logic.getEntityState(4)!;
    expect(state2.statusFlags).toContain('DISABLED_HELD');
    expect(state3.statusFlags).toContain('DISABLED_HELD');
    expect(state4.statusFlags).toContain('DISABLED_HELD');

    // Transport should show LOADED.
    const transportState = logic.getEntityState(1)!;
    expect(transportState.modelConditionFlags).toContain('LOADED');

    // Now try to load the 4th infantry.
    logic.submitCommand({ type: 'enterTransport', entityId: 5, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // 4th infantry should NOT be inside — capacity exhausted.
    const state5 = logic.getEntityState(5)!;
    expect(state5.statusFlags).not.toContain('DISABLED_HELD');

    // Verify the 3 original passengers are still correctly contained.
    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags).toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags).toContain('DISABLED_HELD');
  });

  it('correctly tracks slot usage with multi-slot riders', () => {
    // C++ source: TransportContain.cpp:199-210 — transportSlotCount per rider
    // is checked against remaining capacity. A 2-slot rider in a 3-slot
    // transport leaves room for one more 1-slot rider, but not another 2-slot.
    const transportDef = makeObjectDef('Chinook', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        Slots: 3,
        AllowInsideKindOf: 'INFANTRY VEHICLE',
      }),
    ]);

    const smallRider = makeObjectDef('Rifleman', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 80,
        InitialHealth: 80,
      }),
    ], { TransportSlotCount: 1 });

    const bigRider = makeObjectDef('MiniTank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 200,
        InitialHealth: 200,
      }),
    ], { TransportSlotCount: 2 });

    const bundle = makeBundle({
      objects: [transportDef, smallRider, bigRider],
    });

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Chinook', 20, 20),   // id 1
        makeMapObject('MiniTank', 22, 20),  // id 2 (2 slots)
        makeMapObject('Rifleman', 24, 20),  // id 3 (1 slot)
        makeMapObject('Rifleman', 26, 20),  // id 4 (1 slot — should be rejected)
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    // Load the 2-slot vehicle first.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_HELD');

    // Load the 1-slot infantry (2+1=3, exactly at capacity).
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(logic.getEntityState(3)!.statusFlags).toContain('DISABLED_HELD');

    // Try to load a second 1-slot infantry (2+1+1=4 > 3 capacity — rejected).
    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(4)!.statusFlags).not.toContain('DISABLED_HELD');
  });

  it('passengers are correctly contained with proper status flags', () => {
    // C++ source: TransportContain::onContaining — sets DISABLED_HELD on rider,
    // Object::onContainedBy — sets UNSELECTABLE, MASKED for enclosed containers.
    const { logic } = makeTransportCapacitySetup(3);

    // Load one infantry.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const passengerState = logic.getEntityState(2)!;
    // Passengers inside enclosed transport should have all containment flags.
    expect(passengerState.statusFlags).toContain('DISABLED_HELD');
    expect(passengerState.statusFlags).toContain('UNSELECTABLE');
    expect(passengerState.statusFlags).toContain('MASKED');

    // Passenger position should match transport position.
    const transportState = logic.getEntityState(1)!;
    expect(passengerState.x).toBeCloseTo(transportState.x, 0);
    expect(passengerState.z).toBeCloseTo(transportState.z, 0);
  });
});
