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

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ── TransportContain tests ──

describe('TransportContain', () => {
  it('enters infantry into a transport and hides them from the world', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Humvee', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Humvee', 20, 20),
      makeMapObject('Ranger', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Passenger should be hidden (UNSELECTABLE + MASKED + DISABLED_HELD).
    const rangerState = logic.getEntityState(2);
    expect(rangerState).toBeDefined();
    const statusFlags = rangerState!.statusFlags ?? [];
    expect(statusFlags).toContain('UNSELECTABLE');
    expect(statusFlags).toContain('MASKED');
    expect(statusFlags).toContain('DISABLED_HELD');
  });

  it('evacuates all passengers when evacuate command is issued', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Transport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
      locomotors: [makeLocomotorDef('SoldierLoco', 20)],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Transport', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Soldier', 24, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter both soldiers.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Verify LOADED is set before evacuate.
    const loadedState = logic.getEntityState(1);
    expect(loadedState!.modelConditionFlags ?? []).toContain('LOADED');

    // Evacuate all.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Both soldiers should be out — LOADED cleared on transport.
    const transportState = logic.getEntityState(1);
    expect(transportState!.modelConditionFlags ?? []).not.toContain('LOADED');

    // Soldiers should no longer have containment status flags.
    const s1 = logic.getEntityState(2);
    const s2 = logic.getEntityState(3);
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s1!.statusFlags ?? []).not.toContain('DISABLED_HELD');
    expect(s2!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });

  it('respects Slots capacity limit for TransportContain', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SmallTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            Slots: 2,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('SmallTransport', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Soldier', 24, 20),
      makeMapObject('Soldier', 26, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Try to enter all three soldiers into a 2-slot transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Verify transport has LOADED (some soldiers entered).
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');

    // The third soldier should NOT have containment flags (rejected).
    // At most 2 soldiers should have DISABLED_HELD (inside transport).
    let insideCount = 0;
    for (const id of [2, 3, 4]) {
      const state = logic.getEntityState(id);
      expect(state).toBeDefined();
      if ((state!.statusFlags ?? []).includes('DISABLED_HELD')) {
        insideCount++;
      }
    }
    expect(insideCount).toBe(2);
  });

  it('applies damage to passengers when transport is destroyed (DamagePercentToUnits)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FragileTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
            DamagePercentToUnits: 100,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 120,
          PrimaryDamage: 100,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('FragileTransport', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Soldier enters transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Attacker kills transport.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Soldier should have been damaged (100% of maxHealth).
    const soldierState = logic.getEntityState(2);
    // With 100% damage to units, soldier (100 HP) takes 100 damage = should be dead or near-dead.
    expect(soldierState).toBeDefined();
    if (soldierState) {
      expect(soldierState.health).toBeLessThanOrEqual(0);
    }
  });

  it('applies HealthRegen%PerSec to passengers inside transport', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HealingTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
            'HealthRegen%PerSec': 50,
          }),
        ]),
        makeObjectDef('WoundedSoldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 50 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('HealingTransport', 20, 20),
      makeMapObject('WoundedSoldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Verify initial health is low.
    const initialState = logic.getEntityState(2);
    expect(initialState).toBeDefined();
    expect(initialState!.health).toBe(50);

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Run 60 frames (2 seconds) of heal at 50% per sec = 100% total health regen.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Evacuate to check health.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const healedState = logic.getEntityState(2);
    expect(healedState).toBeDefined();
    // Should be fully healed or very close to it.
    expect(healedState!.health).toBeGreaterThanOrEqual(95);
  });

  it('sets LOADED model condition when transport has passengers', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Humvee', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Humvee', 20, 20),
      makeMapObject('Ranger', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Before entering — no LOADED flag.
    logic.update(1 / 30);
    const emptyState = logic.getEntityState(1);
    expect(emptyState).toBeDefined();
    const emptyFlags = emptyState!.modelConditionFlags ?? [];
    expect(emptyFlags).not.toContain('LOADED');

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After entering — LOADED flag should be set.
    const loadedState = logic.getEntityState(1);
    expect(loadedState).toBeDefined();
    const loadedFlags = loadedState!.modelConditionFlags ?? [];
    expect(loadedFlags).toContain('LOADED');

    // Evacuate.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After evacuating — LOADED flag should be cleared.
    const evacuatedState = logic.getEntityState(1);
    expect(evacuatedState).toBeDefined();
    const evacuatedFlags = evacuatedState!.modelConditionFlags ?? [];
    expect(evacuatedFlags).not.toContain('LOADED');
  });

  it('forbids entry by ForbidInsideKindOf', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('InfantryOnly', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            ForbidInsideKindOf: 'VEHICLE',
          }),
        ]),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('InfantryOnly', 20, 20),
      makeMapObject('Tank', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Try to enter vehicle into transport that forbids vehicles.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Tank should not be inside (no LOADED condition on transport).
    const transportState = logic.getEntityState(1);
    expect(transportState).toBeDefined();
    const flags = transportState!.modelConditionFlags ?? [];
    expect(flags).not.toContain('LOADED');
  });

  it('spawns initial payload on first update', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PreloadedTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 3,
            AllowInsideKindOf: 'INFANTRY',
            InitialPayload: 'Ranger 2',
          }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('PreloadedTransport', 20, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Run one frame to trigger initial payload creation.
    logic.update(1 / 30);

    // Transport should have LOADED condition (has passengers inside).
    const state = logic.getEntityState(1);
    expect(state).toBeDefined();
    const flags = state!.modelConditionFlags ?? [];
    expect(flags).toContain('LOADED');

    // Evacuate to see the spawned units.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Check that the transport is now empty (LOADED cleared).
    const emptyState = logic.getEntityState(1);
    expect(emptyState).toBeDefined();
    const emptyFlags = emptyState!.modelConditionFlags ?? [];
    expect(emptyFlags).not.toContain('LOADED');
  });

  it('passengers get DISABLED_HELD while inside transport', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('APC', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('APC', 20, 20),
      makeMapObject('Soldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Verify no DISABLED_HELD before entering.
    logic.update(1 / 30);
    const before = logic.getEntityState(2);
    expect(before!.statusFlags ?? []).not.toContain('DISABLED_HELD');

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // DISABLED_HELD should be set while inside.
    const inside = logic.getEntityState(2);
    expect(inside!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Exit.
    logic.submitCommand({ type: 'exitContainer', entityId: 2 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // DISABLED_HELD should be cleared after release.
    const after = logic.getEntityState(2);
    expect(after!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });

  it('container death applies DamagePercentToUnits then releases survivors', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToughTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
            DamagePercentToUnits: 50,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 120,
          PrimaryDamage: 100,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('ToughTransport', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Enter soldier.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Kill transport.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Soldier should survive with ~50 HP (took 50% of 100 maxHP = 50 damage).
    const soldierState = logic.getEntityState(2);
    expect(soldierState).toBeDefined();
    expect(soldierState!.health).toBeGreaterThan(0);
    expect(soldierState!.health).toBeLessThanOrEqual(50);
    // Should be released from the container (no longer held).
    expect(soldierState!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });

  it('passenger position inherits container position while inside', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('APC', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('APC', 20, 20),
      makeMapObject('Soldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter transport — soldier starts near transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After entering, passenger position should match container position.
    const apcState = logic.getEntityState(1);
    const soldierState = logic.getEntityState(2);
    expect(soldierState!.x).toBe(apcState!.x);
    expect(soldierState!.z).toBe(apcState!.z);
  });

  it('exitContainer command releases single passenger', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Transport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Transport', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Soldier', 24, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter both soldiers.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Exit only soldier 2.
    logic.submitCommand({ type: 'exitContainer', entityId: 2 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Soldier 2 should be free, soldier 3 should still be inside.
    expect(logic.getEntityState(2)!.statusFlags ?? []).not.toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Transport should still have LOADED (soldier 3 remains).
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');
  });
});

// ── TunnelContain tests ──

describe('TunnelContain', () => {
  it('shares a passenger list across all tunnels of the same side', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('TunnelNetwork', 10, 10),
      makeMapObject('TunnelNetwork', 50, 50),
      makeMapObject('Rebel', 12, 10),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Run a few frames so tunnel registration completes.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Enter rebel into first tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Verify rebel is inside (has containment flags).
    const insideState = logic.getEntityState(3);
    expect(insideState!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Exit from second tunnel.
    logic.submitCommand({ type: 'evacuate', entityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Rebel should have exited — no longer held.
    const rebelState = logic.getEntityState(3);
    expect(rebelState).toBeDefined();
    expect(rebelState!.statusFlags ?? []).not.toContain('DISABLED_HELD');
    // Position should be near the second tunnel (50,50), not the first (10,10).
    const tunnel2State = logic.getEntityState(2);
    const dx = rebelState!.x - tunnel2State!.x;
    const dz = rebelState!.z - tunnel2State!.z;
    const distToTunnel2 = Math.sqrt(dx * dx + dz * dz);
    expect(distToTunnel2).toBeLessThan(30); // Should be near tunnel 2
  });

  it('kills all passengers on cave-in (last tunnel destroyed)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 120,
          PrimaryDamage: 200,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('TunnelNetwork', 20, 20),
      makeMapObject('Rebel', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Enter rebel into tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Attacker destroys the (only) tunnel.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Tunnel should be destroyed.
    const tunnelState = logic.getEntityState(1);
    if (tunnelState) {
      expect(tunnelState.health).toBeLessThanOrEqual(0);
    }

    // Rebel should be dead (cave-in kills all passengers when last tunnel is destroyed).
    const rebelState = logic.getEntityState(2);
    if (rebelState) {
      expect(rebelState.health).toBeLessThanOrEqual(0);
    }
  });

  it('heals passengers inside the tunnel network over time', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HealingTunnel', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 2000,
          }),
        ]),
        makeObjectDef('WoundedRebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 30 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('HealingTunnel', 20, 20),
      makeMapObject('WoundedRebel', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Enter wounded rebel into tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Run 90 frames (~3 seconds) of healing. TimeForFullHeal=2000ms=60 frames.
    // After 3s the rebel should be fully healed.
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    // Exit.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After 3s with TimeForFullHeal=2s, rebel should be at 100 HP.
    const rebelState = logic.getEntityState(2);
    expect(rebelState).toBeDefined();
    expect(rebelState!.health).toBe(100);
  });

  it('passengers get DISABLED_HELD, MASKED, UNSELECTABLE in tunnel', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('TunnelNetwork', 20, 20),
      makeMapObject('Rebel', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Enter tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // All three status flags should be set.
    const rebelState = logic.getEntityState(2);
    expect(rebelState).toBeDefined();
    const flags = rebelState!.statusFlags ?? [];
    expect(flags).toContain('DISABLED_HELD');
    expect(flags).toContain('MASKED');
    expect(flags).toContain('UNSELECTABLE');
  });

  it('tunnel healing uses TimeForFullHeal correctly', () => {
    // TimeForFullHeal = 1000ms = 30 frames. Linear heal: maxHealth / 30 per frame.
    // InitialHealth=1 means 1% of 100 = 1 HP — alive but nearly dead.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FastHealTunnel', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 1000,
          }),
        ]),
        makeObjectDef('WoundedRebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 1 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('FastHealTunnel', 20, 20),
      makeMapObject('WoundedRebel', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Verify rebel starts at low health.
    expect(logic.getEntityState(2)!.health).toBeLessThanOrEqual(1);

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Run enough frames for full heal (30 frames = 1000ms, plus buffer).
    for (let i = 0; i < 40; i++) logic.update(1 / 30);

    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const rebelState = logic.getEntityState(2);
    expect(rebelState).toBeDefined();
    expect(rebelState!.health).toBe(100);
  });
});

// ── OverlordContain tests ──

describe('OverlordContain', () => {
  it('accepts portable structure riders and sets RIDER model conditions', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('PropagandaTower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('PropagandaTower', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter structure into overlord.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Overlord should have LOADED and RIDER1 model conditions.
    const overlordState = logic.getEntityState(1);
    expect(overlordState).toBeDefined();
    const flags = overlordState!.modelConditionFlags ?? [];
    expect(flags).toContain('LOADED');
    expect(flags).toContain('RIDER1');
  });

  it('sub-unit inherits parent position each frame', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('GatlingCannon', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
      ],
      locomotors: [makeLocomotorDef('OverlordLoco', 30)],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('GatlingCannon', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter gatling cannon into overlord.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Move overlord.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 40, targetZ: 20 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Gatling cannon should have followed the overlord.
    const overlordState = logic.getEntityState(1);
    const gatlingState = logic.getEntityState(2);
    expect(overlordState).toBeDefined();
    expect(gatlingState).toBeDefined();
    // The rider should be at the same position as the overlord.
    expect(gatlingState!.x).toBe(overlordState!.x);
    expect(gatlingState!.z).toBe(overlordState!.z);
  });

  it('multiple riders set RIDER1, RIDER2 conditions', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 2,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('Tower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('Tower', 22, 20),
      makeMapObject('Tower', 24, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const flags = logic.getEntityState(1)!.modelConditionFlags ?? [];
    expect(flags).toContain('RIDER1');
    expect(flags).toContain('RIDER2');
    expect(flags).not.toContain('RIDER3');
  });

  it('rider position follows overlord during movement', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('Tower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
      ],
      locomotors: [makeLocomotorDef('OverlordLoco', 30)],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('Tower', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Move overlord — check rider tracks continuously.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 50, targetZ: 50 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Mid-movement: check positions match.
    const overlordMid = logic.getEntityState(1);
    const towerMid = logic.getEntityState(2);
    expect(towerMid!.x).toBe(overlordMid!.x);
    expect(towerMid!.z).toBe(overlordMid!.z);

    // Continue movement.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const overlordEnd = logic.getEntityState(1);
    const towerEnd = logic.getEntityState(2);
    expect(towerEnd!.x).toBe(overlordEnd!.x);
    expect(towerEnd!.z).toBe(overlordEnd!.z);
  });

  it('overlord death releases riders', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('Tower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 120,
          PrimaryDamage: 100,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('Tower', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Kill overlord.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Tower should survive (released from dead overlord).
    const towerState = logic.getEntityState(2);
    expect(towerState).toBeDefined();
    expect(towerState!.health).toBeGreaterThan(0);
    expect(towerState!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });

  it('damage state propagates to single rider', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('PropagandaTower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 1,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('PropagandaTower', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);

    // Load rider into overlord.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Rider starts at full health.
    expect(logic.getEntityState(2)!.health).toBe(200);

    // Damage overlord below 50% (DAMAGED threshold). 10 dmg/frame × ~80 frames ≈ 600+ damage.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 80; i++) logic.update(1 / 30);

    // Overlord should be DAMAGED (health <= 500) but alive.
    const overlordState = logic.getEntityState(1);
    expect(overlordState).toBeDefined();
    expect(overlordState!.health).toBeLessThanOrEqual(500);
    expect(overlordState!.health).toBeGreaterThan(0);

    // Rider should have DAMAGED model condition and reduced health.
    const towerState = logic.getEntityState(2);
    expect(towerState).toBeDefined();
    expect(towerState!.modelConditionFlags ?? []).toContain('DAMAGED');
    // setEntityBodyDamageState sets health to maxHealth * 0.5 - 1 = 99 for DAMAGED state.
    expect(towerState!.health).toBeLessThan(200);
  });

  it('damage state does NOT propagate with 2+ riders', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 2,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('Tower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 1,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('Tower', 22, 20),
      makeMapObject('Tower', 24, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);

    // Load both riders.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Damage overlord below 50%.
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    for (let i = 0; i < 80; i++) logic.update(1 / 30);

    // Overlord should be DAMAGED but alive.
    expect(logic.getEntityState(1)!.health).toBeLessThanOrEqual(500);
    expect(logic.getEntityState(1)!.health).toBeGreaterThan(0);

    // Neither rider should have their health changed.
    expect(logic.getEntityState(2)!.health).toBe(200);
    expect(logic.getEntityState(3)!.health).toBe(200);
  });
});

// ── HealContain tests ──

describe('HealContain', () => {
  it('heals passengers and auto-ejects them when fully healed', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
            ContainMax: 3,
            TimeForFullHeal: 1000,
          }),
        ]),
        makeObjectDef('WoundedSoldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 30 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Ambulance', 20, 20),
      makeMapObject('WoundedSoldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Verify initial health.
    let soldierState = logic.getEntityState(2);
    expect(soldierState).toBeDefined();
    expect(soldierState!.health).toBe(30);

    // Enter ambulance.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Run enough frames for full heal (TimeForFullHeal = 1000ms = 30 frames).
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Soldier should be auto-ejected and fully healed.
    soldierState = logic.getEntityState(2);
    expect(soldierState).toBeDefined();
    expect(soldierState!.health).toBeGreaterThanOrEqual(99);
  });

  it('healthy unit enters but is auto-ejected immediately (C++ parity)', () => {
    // C++ HealContain inherits TransportContain::isValidContainerFor which does NOT check health.
    // The unit enters, then updateHealContainHealing auto-ejects when health >= maxHealth.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
            ContainMax: 3,
            TimeForFullHeal: 1000,
          }),
        ]),
        makeObjectDef('HealthySoldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Ambulance', 20, 20),
      makeMapObject('HealthySoldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter heal container.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // After auto-eject, ambulance should NOT have LOADED (unit was ejected).
    const ambulanceState = logic.getEntityState(1);
    expect(ambulanceState).toBeDefined();
    const flags = ambulanceState!.modelConditionFlags ?? [];
    expect(flags).not.toContain('LOADED');

    // Soldier should not have containment flags.
    const soldierState = logic.getEntityState(2);
    expect(soldierState!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });

  it('auto-ejects passenger when healing is complete', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
            ContainMax: 3,
            TimeForFullHeal: 1000,
          }),
        ]),
        makeObjectDef('WoundedSoldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 10 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Ambulance', 20, 20),
      makeMapObject('WoundedSoldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Verify soldier is inside.
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');

    // Run enough frames for full heal (30 frames = 1s).
    for (let i = 0; i < 40; i++) logic.update(1 / 30);

    // Should be auto-ejected — no explicit evacuate command needed.
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).not.toContain('LOADED');
    expect(logic.getEntityState(2)!.health).toBe(100);
    expect(logic.getEntityState(2)!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });
});

// ── GarrisonContain tests ──

describe('GarrisonContain', () => {
  it('sets LOADED on garrison containers when occupied', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Barracks', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Barracks', 20, 20),
      makeMapObject('Soldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Before entering — no LOADED flag.
    logic.update(1 / 30);
    const emptyState = logic.getEntityState(1);
    expect(emptyState).toBeDefined();
    expect(emptyState!.modelConditionFlags ?? []).not.toContain('LOADED');

    // Enter garrison.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const barracksState = logic.getEntityState(1);
    expect(barracksState).toBeDefined();
    const flags = barracksState!.modelConditionFlags ?? [];
    expect(flags).toContain('LOADED');
  });

  it('sets GARRISONED model condition on building when occupied', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Building', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Building', 20, 20),
      makeMapObject('Soldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    logic.update(1 / 30);
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).not.toContain('GARRISONED');

    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('GARRISONED');

    // Evacuate — GARRISONED should be cleared.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).not.toContain('GARRISONED');
  });

  it('auto-ejects infantry when garrison reaches REALLY_DAMAGED', () => {
    // REALLY_DAMAGED threshold = health/maxHealth <= 0.1 (10%).
    // For 1000 HP building, need health <= 100.
    // Weapon does 10 dmg/shot every 3 frames (~100ms). 280 frames ≈ 93 shots = 930 dmg.
    // Building health = 1000 - 930 = 70 HP (REALLY_DAMAGED, still alive).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FragileBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('FragileBuilding', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Garrison soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');

    // Damage building past REALLY_DAMAGED threshold (10% = 100 HP).
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 280; i++) logic.update(1 / 30);

    // Building should still exist but severely damaged.
    const buildingState = logic.getEntityState(1);
    expect(buildingState).toBeDefined();
    expect(buildingState!.health).toBeGreaterThan(0);
    expect(buildingState!.health).toBeLessThanOrEqual(100);

    // Soldiers should have been auto-ejected when building hit REALLY_DAMAGED.
    expect(buildingState!.modelConditionFlags ?? []).not.toContain('LOADED');
    const soldierState = logic.getEntityState(2);
    expect(soldierState).toBeDefined();
    expect(soldierState!.statusFlags ?? []).not.toContain('UNSELECTABLE');
  });

  it('GARRISONABLE_UNTIL_DESTROYED buildings do NOT eject on REALLY_DAMAGED', () => {
    // REALLY_DAMAGED threshold = health/maxHealth <= 0.1 (10%).
    // For 1000 HP building: health <= 100 = REALLY_DAMAGED.
    // 30 dmg/shot every 3 frames, 90 frames ≈ 30 shots = 900 dmg. Health = 100 (REALLY_DAMAGED).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToughBuilding', 'America', ['STRUCTURE', 'GARRISONABLE_UNTIL_DESTROYED'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('ToughBuilding', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Garrison soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');

    // Damage building past REALLY_DAMAGED threshold (10% = 100 HP).
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 280; i++) logic.update(1 / 30);

    // Building should still be alive and heavily damaged.
    const buildingState = logic.getEntityState(1);
    expect(buildingState).toBeDefined();
    expect(buildingState!.health).toBeGreaterThan(0);
    expect(buildingState!.health).toBeLessThanOrEqual(100);

    // Even past REALLY_DAMAGED, GARRISONABLE_UNTIL_DESTROYED keeps soldiers inside.
    expect(buildingState!.modelConditionFlags ?? []).toContain('LOADED');
  });

  it('subdued garrison blocks fire permission', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Building', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 500, InitialHealth: 500,
            SubdualDamageCap: 1000, SubdualDamageHealRate: 500000,
          }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Rifle'] }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Subduer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SubdualGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('Rifle', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 100,
        }),
        makeWeaponDef('SubdualGun', {
          AttackRange: 120,
          PrimaryDamage: 600,
          DamageType: 'SUBDUAL_BUILDING',
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Building', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Target', 40, 20),
      makeMapObject('Subduer', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Garrison soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Subdue the building using subdual weapon.
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Verify building is subdued.
    const buildingState = logic.getEntityState(1);
    expect(buildingState!.statusFlags ?? []).toContain('DISABLED_SUBDUED');

    // Record target health before attack attempt.
    const targetBefore = logic.getEntityState(3)!.health;

    // Order soldier to attack — should do nothing (building is subdued).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 3 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Target should still have same health (garrison fire was blocked).
    const targetState = logic.getEntityState(3);
    expect(targetState).toBeDefined();
    expect(targetState!.health).toBe(targetBefore);
  });
});

// ── OpenContain tests ──

describe('OpenContain', () => {
  it('allows passengers to fire from an open container when PassengersAllowedToFire is set', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BattleBus', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
            ContainMax: 5,
            PassengersAllowedToFire: true,
          }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Rifle'] }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('Rifle', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('BattleBus', 20, 20),
      makeMapObject('Ranger', 22, 20),
      makeMapObject('Target', 40, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Enter ranger into battle bus.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Verify LOADED.
    const busState = logic.getEntityState(1);
    expect(busState).toBeDefined();
    const flags = busState!.modelConditionFlags ?? [];
    expect(flags).toContain('LOADED');

    // Order ranger to attack from inside the bus.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 3 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Target should have taken damage (fire from open container works).
    const targetState = logic.getEntityState(3);
    expect(targetState).toBeDefined();
    expect(targetState!.health).toBeLessThan(500);
  });
});

// ── Cross-container integration tests ──

describe('Containment system integration', () => {
  it('prevents entering a container when already contained', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Transport1', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Transport2', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Transport1', 20, 20),
      makeMapObject('Transport2', 25, 20),
      makeMapObject('Soldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter first transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Try to enter second transport while already in first.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // First transport should still have LOADED.
    const t1State = logic.getEntityState(1);
    expect(t1State).toBeDefined();
    const t1Flags = t1State!.modelConditionFlags ?? [];
    expect(t1Flags).toContain('LOADED');

    // Second transport should not have LOADED.
    const t2State = logic.getEntityState(2);
    expect(t2State).toBeDefined();
    const t2Flags = t2State!.modelConditionFlags ?? [];
    expect(t2Flags).not.toContain('LOADED');
  });

  it('exit container command releases passenger from transport', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Transport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Transport', 20, 20),
      makeMapObject('Soldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Verify LOADED.
    const loadedState = logic.getEntityState(1);
    expect(loadedState!.modelConditionFlags ?? []).toContain('LOADED');

    // Exit container.
    logic.submitCommand({ type: 'exitContainer', entityId: 2 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // LOADED should be cleared.
    const exitedState = logic.getEntityState(1);
    expect(exitedState!.modelConditionFlags ?? []).not.toContain('LOADED');
  });

  it('multi-slot riders consume the correct number of slots', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Chinook', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            Slots: 8,
            AllowInsideKindOf: ['INFANTRY', 'VEHICLE'],
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Humvee', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 3 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Chinook', 20, 20),
      makeMapObject('Infantry', 22, 20),
      makeMapObject('Infantry', 24, 20),
      makeMapObject('Humvee', 26, 20),
      makeMapObject('Humvee', 28, 20),
      // 5th entity: another Humvee (3 slots) — should be rejected (2+6=8 full).
      makeMapObject('Humvee', 30, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Enter 2 infantry (2 slots) + 2 humvees (6 slots) = 8 total slots.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 5, targetTransportId: 1 });
    // Try to add a 5th unit (3 slots) — should be rejected since 8/8 occupied.
    logic.submitCommand({ type: 'enterTransport', entityId: 6, targetTransportId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // 5th unit (Humvee #3) should NOT be inside (not held).
    const fifthState = logic.getEntityState(6);
    expect(fifthState).toBeDefined();
    expect(fifthState!.statusFlags ?? []).not.toContain('DISABLED_HELD');

    // First 4 units should be inside.
    let insideCount = 0;
    for (const id of [2, 3, 4, 5]) {
      if ((logic.getEntityState(id)!.statusFlags ?? []).includes('DISABLED_HELD')) {
        insideCount++;
      }
    }
    expect(insideCount).toBe(4);

    // Evacuate — all should come out.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).not.toContain('LOADED');
  });

  it('blocks enemy units from entering own-side transport', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
          }),
        ]),
        makeObjectDef('ChinaSoldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('USTransport', 20, 20),
      makeMapObject('ChinaSoldier', 22, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Try to enter enemy transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Transport should NOT have LOADED (enemy entry blocked).
    const transportState = logic.getEntityState(1);
    expect(transportState).toBeDefined();
    const flags = transportState!.modelConditionFlags ?? [];
    expect(flags).not.toContain('LOADED');
  });

  it('subdued container blocks evacuation', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Building', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 500, InitialHealth: 500,
            SubdualDamageCap: 1000, SubdualDamageHealRate: 500000,
          }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Subduer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SubdualGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SubdualGun', {
          AttackRange: 120,
          PrimaryDamage: 600,
          DamageType: 'SUBDUAL_BUILDING',
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Building', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Subduer', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Garrison soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');

    // Subdue the building.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.statusFlags ?? []).toContain('DISABLED_SUBDUED');

    // Try to evacuate — should be blocked.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Soldier should still be inside (LOADED still set).
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');
  });

  it('subdued container blocks individual exit', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Transport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 200, InitialHealth: 200,
            SubdualDamageCap: 1000, SubdualDamageHealRate: 500000,
          }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Subduer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SubdualGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SubdualGun', {
          AttackRange: 120,
          PrimaryDamage: 600,
          DamageType: 'SUBDUAL_VEHICLE',
          DelayBetweenShots: 100,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Transport', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Subduer', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');

    // Subdue the transport.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.statusFlags ?? []).toContain('DISABLED_SUBDUED');

    // Try to exit — should be blocked.
    logic.submitCommand({ type: 'exitContainer', entityId: 2 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Soldier should still be inside.
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');
  });
});

// ── Garrison occupancy count in getEntityState ──

describe('getEntityState garrison occupancy', () => {
  it('exposes garrisonCount and garrisonCapacity for garrison buildings', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Building', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Building', 20, 20),
      makeMapObject('Soldier', 22, 20),
      makeMapObject('Soldier', 24, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.update(1 / 30);

    // Empty building should show 0/10.
    const emptyState = logic.getEntityState(1)!;
    expect(emptyState.garrisonCount).toBe(0);
    expect(emptyState.garrisonCapacity).toBe(10);

    // Garrison one soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const oneState = logic.getEntityState(1)!;
    expect(oneState.garrisonCount).toBe(1);
    expect(oneState.garrisonCapacity).toBe(10);

    // Garrison a second soldier.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const twoState = logic.getEntityState(1)!;
    expect(twoState.garrisonCount).toBe(2);
    expect(twoState.garrisonCapacity).toBe(10);

    // Evacuate — count should drop to 0.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const evacuatedState = logic.getEntityState(1)!;
    expect(evacuatedState.garrisonCount).toBe(0);
    expect(evacuatedState.garrisonCapacity).toBe(10);
  });

  it('returns null garrisonCount/garrisonCapacity for non-garrison entities', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = createLogic();
    const map = makeMap([makeMapObject('Ranger', 20, 20)]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    expect(state.garrisonCount).toBeNull();
    expect(state.garrisonCapacity).toBeNull();
  });
});
