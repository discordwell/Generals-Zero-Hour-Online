/**
 * Parity tests for garrisoned stealth detection, per-weapon stealth firing check,
 * and topple direction from attacker position.
 *
 * These tests document behavioral differences between the C++ original and the
 * TypeScript browser port for three specific subsystems.
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
} from './test-helpers.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

function createLogic(): GameLogicSubsystem {
  return new GameLogicSubsystem(new THREE.Scene());
}

function setupEnemyRelationships(logic: GameLogicSubsystem): void {
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
}

// ── Test 1: Garrisoned Stealth Unit Detection ───────────────────────────────

describe('Parity: garrisoned stealth unit detection', () => {
  /**
   * C++ StealthDetectorUpdate.cpp:317-341 — after the main detection loop over
   * entities that have StealthUpdate, a second pass checks non-stealthed buildings
   * for stealthed units inside (via getStealthUnitsContained()). Each stealthed
   * rider is detected with rate+2 duration.
   *
   * TS stealth-detection.ts updateDetection — only iterates entities with the
   * STEALTHED flag. It does not look inside containers for stealthed passengers.
   *
   * Outcome: The TS port DOES detect garrisoned stealthed units, but through a
   * different mechanism than C++:
   * - C++: The main detection scan uses a partition filter and does NOT find
   *   contained entities. A separate code path (lines 336-358) explicitly iterates
   *   container contents via getStealthUnitsContained() and detects with rate+2.
   * - TS:  The detection scan iterates all spawnedEntities. Garrisoned units
   *   remain in spawnedEntities with STEALTHED flag active and position snapped
   *   to the building, so the standard range check finds them. No special
   *   container scan is needed.
   *
   * Both reach the same result (garrisoned stealthed units are detected), but the
   * detection duration differs: C++ uses rate+2 for container occupants vs rate+1
   * for direct targets. TS uses rate+1 for all.
   */
  it('documents that detector finds stealthed unit garrisoned inside a building', () => {
    const bundle = makeBundle({
      objects: [
        // A garrisonable building (not stealthed itself).
        makeObjectDef('CivBuilding', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 5,
          }),
        ]),
        // A stealthed infantry unit (innate stealth, short delay).
        makeObjectDef('StealthInfantry', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            StealthForbiddenConditions: '',
          }),
        ], { TransportSlotCount: 1 }),
        // A detector unit from the enemy side.
        makeObjectDef('DetectorUnit', 'America', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
            DetectionRange: 200,
            DetectionRate: 33,
          }),
        ], { VisionRange: 200 }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 50, 50),
        makeMapObject('StealthInfantry', 52, 50),
        makeMapObject('DetectorUnit', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic);
    // Also set GLA as enemy of America.
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    // Let stealth activate on the infantry unit.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const stealthFlags = logic.getEntityState(2)?.statusFlags ?? [];
    expect(stealthFlags).toContain('STEALTHED');

    // Now garrison the stealth unit inside the building.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Verify the unit is garrisoned.
    const garrisonedFlags = logic.getEntityState(2)?.statusFlags ?? [];
    expect(garrisonedFlags).toContain('DISABLED_HELD');

    // Run more frames to give the detector time to scan.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Check if the garrisoned stealthed unit is detected.
    const finalFlags = logic.getEntityState(2)?.statusFlags ?? [];
    const isDetected = finalFlags.includes('DETECTED');

    // TS detects garrisoned stealthed units through the standard entity scan
    // (garrisoned units remain in spawnedEntities with STEALTHED flag at building position).
    // C++ uses a dedicated container scan (getStealthUnitsContained) with rate+2 duration.
    // Both detect the unit, but through different mechanisms and with slightly
    // different detection durations (rate+1 vs rate+2).
    expect(isDetected).toBe(true);
  });

  it('detector does detect a free-standing stealthed unit (baseline)', () => {
    // Baseline test to confirm detection works at all for non-garrisoned units.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
          }),
        ]),
        makeObjectDef('DetectorUnit', 'America', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
            DetectionRange: 200,
            DetectionRate: 33,
          }),
        ], { VisionRange: 200 }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 50, 50),
        makeMapObject('DetectorUnit', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).toContain('DETECTED');
  });
});

// ── Test 2: Per-Weapon Slot Stealth Firing Check ────────────────────────────

describe('Parity: per-weapon slot stealth firing check', () => {
  /**
   * C++ StealthUpdate.cpp:348-386 — STEALTH_NOT_WHILE_FIRING_PRIMARY only breaks
   * stealth when the primary weapon fires (checks per-slot lastShotFrame against
   * current frame). STEALTH_NOT_WHILE_FIRING_SECONDARY only checks secondary, etc.
   *
   * TS stealth-detection.ts — uses per-slot lastShotFrameBySlot checks matching C++.
   * IS_FIRING_WEAPON is used as a quick gate (same as C++), then per-slot
   * lastShotFrameBySlot is checked for each forbidden firing condition.
   */
  it('FIRING_PRIMARY breaks stealth when primary weapon fires', () => {
    const bundle = makeBundle({
      objects: [
        // Stealthed unit with FIRING_PRIMARY forbidden condition.
        makeObjectDef('StealthUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            StealthForbiddenConditions: 'FIRING_PRIMARY',
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        // Enemy target.
        makeObjectDef('TargetDummy', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 9999, InitialHealth: 9999 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 1,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 50, 50),
        makeMapObject('TargetDummy', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic);

    // Wait for stealth to activate.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Issue attack command with primary weapon.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Stealth should be broken by primary fire.
    // Both C++ and TS check per-slot lastShotFrame for the primary weapon slot.
    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).not.toContain('STEALTHED');
  });

  it('FIRING_SECONDARY condition does not break stealth when only primary weapon fires', () => {
    // Source parity: StealthUpdate.cpp:369-376 — FIRING_SECONDARY only checks
    // the secondary weapon slot's lastShotFrame. Firing primary does not trigger it.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            StealthForbiddenConditions: 'FIRING_SECONDARY',
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('TargetDummy', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 9999, InitialHealth: 9999 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 1,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 50, 50),
        makeMapObject('TargetDummy', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic);

    // Wait for stealth.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Fire with primary weapon, but forbidden condition is only FIRING_SECONDARY.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Source parity: stealth remains active because only secondary fire would
    // break it, and we are firing the primary weapon. The per-slot check sees
    // lastShotFrameBySlot[1] (secondary) was never updated, so stealth holds.
    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
  });

  it('FIRING_PRIMARY does NOT break stealth when unit fires secondary weapon', () => {
    // Source parity: StealthUpdate.cpp:360-367 — FIRING_PRIMARY only checks
    // primary weapon slot. A unit firing its secondary weapon should remain stealthed.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            StealthForbiddenConditions: 'FIRING_PRIMARY',
          }),
          // Only has a secondary weapon, no primary.
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['SECONDARY', 'SecondaryGun'] }),
        ]),
        makeObjectDef('TargetDummy', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 9999, InitialHealth: 9999 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SecondaryGun', {
          PrimaryDamage: 1,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 50, 50),
        makeMapObject('TargetDummy', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic);

    // Wait for stealth to activate.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Issue attack — the unit only has a secondary weapon so it fires that.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Source parity: FIRING_PRIMARY only checks primary slot (index 0).
    // Since the weapon is in the secondary slot (index 1), lastShotFrameBySlot[0]
    // is never updated, so stealth should NOT be broken.
    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
  });

  it('IS_FIRING_WEAPON global flag is set when any weapon fires, with per-slot tracking', () => {
    // IS_FIRING_WEAPON is still a global flag set during any weapon fire.
    // Per-slot tracking via lastShotFrameBySlot is used for stealth checks.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 9999, InitialHealth: 9999 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 1,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Attacker', 50, 50),
        makeMapObject('Target', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic);

    // Before attack, IS_FIRING_WEAPON should not be set.
    logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).not.toContain('IS_FIRING_WEAPON');

    // Issue attack.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run frames to get into firing state.
    let isFiringObserved = false;
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
      const flags = logic.getEntityState(1)?.statusFlags ?? [];
      if (flags.includes('IS_FIRING_WEAPON')) {
        isFiringObserved = true;
      }
    }

    // IS_FIRING_WEAPON should have been set at some point during combat.
    // Per-slot lastShotFrameBySlot is also updated alongside this global flag.
    expect(isFiringObserved).toBe(true);
  });
});

// ── Test 3: Topple Direction from Attacker Position ─────────────────────────

describe('Parity: topple direction from attacker position', () => {
  /**
   * C++ StructureToppleUpdate.cpp:143-187 — topple direction is:
   *   angle = atan2(building.y - attacker.y, building.x - attacker.x) + random(±PI/8)
   *   dir = (cos(angle), sin(angle))
   *
   * The building falls AWAY from the attacker (plus small random jitter of ±22.5 degrees).
   *
   * TS index.ts beginStructureTopple — same formula:
   *   dx = entity.x - attackerEntity.x
   *   dz = entity.z - attackerEntity.z
   *   toppleAngle = atan2(dz, dx) + random(±PI/4) (using (nextFloat()-0.5)*PI/4)
   *   toppleDirX = cos(toppleAngle), toppleDirZ = sin(toppleAngle)
   */
  it('building topples away from the attacker with jitter tolerance', () => {
    const bundle = makeBundle({
      objects: [
        // Building with StructureToppleUpdate.
        makeObjectDef('ToppleBuilding', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
            MinToppleDelay: 33,
            MaxToppleDelay: 33,
            MinToppleBurstDelay: 200,
            MaxToppleBurstDelay: 600,
            StructuralIntegrity: 0.0,
            StructuralDecay: 0.0,
          }),
        ]),
      ],
    });
    const logic = createLogic();
    // Building at (60, 60).
    logic.loadMapObjects(
      makeMap([makeMapObject('ToppleBuilding', 60, 60)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(1 / 30);

    // Directly call beginStructureTopple with a mock attacker to the north (lower Z).
    // This is the same approach used in entity-lifecycle.test.ts for topple tests,
    // since beginStructureTopple is a private method not wired into the death pipeline yet.
    const priv = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, {
        structureToppleState: {
          state: string;
          toppleDirX: number;
          toppleDirZ: number;
        } | null;
      }>;
    };
    const building = priv.spawnedEntities.get(1)!;

    // Mock attacker at (60, 30) — north of building at (60, 60).
    const mockAttacker = { x: 60, z: 30 };
    priv.beginStructureTopple(building, mockAttacker);

    const toppleState = (building as any).structureToppleState;
    expect(toppleState).not.toBeNull();

    // The attacker is at (60,30), building at (60,60).
    // direction = building - attacker = (0, 30) -> angle = atan2(30, 0) = PI/2
    // So the building should topple southward (positive Z direction).
    // With ±PI/8 jitter (TS uses (nextFloat()-0.5)*PI/4), toppleDirZ should
    // remain positive since sin(PI/2 ± PI/8) > 0.

    const toppleDirX = toppleState.toppleDirX;
    const toppleDirZ = toppleState.toppleDirZ;

    // The topple direction should point away from the attacker (southward = +Z).
    expect(toppleDirZ).toBeGreaterThan(0); // Falls southward, away from north attacker.

    // The magnitude should be approximately 1 (normalized direction).
    const magnitude = Math.sqrt(toppleDirX * toppleDirX + toppleDirZ * toppleDirZ);
    expect(magnitude).toBeCloseTo(1.0, 3);
  });

  it('building topples in random direction when no attacker', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToppleBuilding', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
            MinToppleDelay: 33,
            MaxToppleDelay: 33,
            StructuralIntegrity: 0.0,
            StructuralDecay: 0.0,
          }),
        ]),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('ToppleBuilding', 60, 60)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(1 / 30);

    // Directly call beginStructureTopple with no attacker.
    const priv = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, {
        structureToppleState: {
          state: string;
          toppleDirX: number;
          toppleDirZ: number;
        } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    priv.beginStructureTopple(entity, null);

    const toppleState = (entity as any).structureToppleState;
    expect(toppleState).not.toBeNull();

    // With no attacker, direction should be random (any angle from 0 to 2*PI).
    // Just verify it's a valid normalized direction.
    const mag = Math.sqrt(toppleState.toppleDirX ** 2 + toppleState.toppleDirZ ** 2);
    expect(mag).toBeCloseTo(1.0, 3);

    // State should be WAITING (not yet toppling).
    expect(toppleState.state).toBe('WAITING');
  });

  it('topple direction has correct angle relative to attacker position', () => {
    // Attacker to the east (higher X), building should topple westward (negative X).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToppleBuilding', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
            MinToppleDelay: 33,
            MaxToppleDelay: 33,
            StructuralIntegrity: 0.0,
            StructuralDecay: 0.0,
          }),
        ]),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('ToppleBuilding', 60, 60)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(1 / 30);

    const priv = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, {
        structureToppleState: {
          state: string;
          toppleDirX: number;
          toppleDirZ: number;
        } | null;
      }>;
    };
    const building = priv.spawnedEntities.get(1)!;

    // Create a mock attacker entity to the east of the building.
    const mockAttacker = { x: 100, z: 60 };
    priv.beginStructureTopple(building, mockAttacker);

    const toppleState = (building as any).structureToppleState;
    expect(toppleState).not.toBeNull();

    // Building at (60,60), attacker at (100,60).
    // direction = (60-100, 60-60) = (-40, 0) -> angle = atan2(0, -40) = PI
    // With jitter of ±PI/8, the direction should point roughly westward (negative X).
    // toppleDirX should be negative (or close to -1).
    expect(toppleState.toppleDirX).toBeLessThan(0);

    // toppleDirZ should be close to 0 (with jitter tolerance up to sin(PI/8) ≈ 0.38).
    expect(Math.abs(toppleState.toppleDirZ)).toBeLessThan(0.5);

    const mag = Math.sqrt(toppleState.toppleDirX ** 2 + toppleState.toppleDirZ ** 2);
    expect(mag).toBeCloseTo(1.0, 3);
  });

  it('topple state stores direction in structureToppleState (matching C++ m_toppleDirection)', () => {
    // Verify the TS structureToppleState fields correspond to C++ m_toppleDirection.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToppleBuilding', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
            MinToppleDelay: 33,
            MaxToppleDelay: 33,
            StructuralIntegrity: 0.5,
            StructuralDecay: 0.98,
          }),
        ]),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('ToppleBuilding', 60, 60)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(1 / 30);

    const priv = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, {
        structureToppleState: {
          state: string;
          toppleDirX: number;
          toppleDirZ: number;
          toppleVelocity: number;
          accumulatedAngle: number;
          structuralIntegrity: number;
        } | null;
      }>;
    };
    const building = priv.spawnedEntities.get(1)!;
    const mockAttacker = { x: 60, z: 30 }; // North of building.
    priv.beginStructureTopple(building, mockAttacker);

    const st = (building as any).structureToppleState;
    expect(st).not.toBeNull();

    // Verify all expected fields are present (matching StructureToppleRuntimeState).
    expect(st).toHaveProperty('state');
    expect(st).toHaveProperty('toppleDirX');
    expect(st).toHaveProperty('toppleDirZ');
    expect(st).toHaveProperty('toppleVelocity');
    expect(st).toHaveProperty('accumulatedAngle');
    expect(st).toHaveProperty('structuralIntegrity');

    // State starts as WAITING.
    expect(st.state).toBe('WAITING');
    // Initial velocity is 0.
    expect(st.toppleVelocity).toBe(0);
    // Accumulated angle starts with small nudge.
    expect(st.accumulatedAngle).toBeCloseTo(0.001, 5);
    // Structural integrity matches profile.
    expect(st.structuralIntegrity).toBe(0.5);
  });
});
