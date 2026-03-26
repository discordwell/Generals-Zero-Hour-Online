/**
 * Parity Tests — helicopter spiral death orbit, garrison auto-eject at
 * REALLYDAMAGED, and horde bonus offMap guard.
 *
 * Source references:
 *   HelicopterSlowDeathUpdate.cpp:183-501 — spiral orbit with forward angle,
 *     self-spin, blade fly-off, ground collision.
 *   GarrisonContain.cpp:1416-1425 — onBodyDamageStateChange() auto-ejects
 *     garrisoned infantry at BODY_REALLYDAMAGED unless GARRISONABLE_UNTIL_DESTROYED.
 *   HordeUpdate.cpp:106-107 — offMap units cannot form hordes with onMap units
 *     (PartitionFilterHordeMember checks isOffMap() parity between scanner and candidate).
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  return new GameLogicSubsystem(new THREE.Scene());
}

function setupEnemyRelationships(logic: GameLogicSubsystem, sideA: string, sideB: string): void {
  logic.setTeamRelationship(sideA, sideB, 0);
  logic.setTeamRelationship(sideB, sideA, 0);
}

// ── Test 1: Helicopter Slow Death Spiral ─────────────────────────────────────

describe('Parity: helicopter slow death spiral orbit', () => {
  /**
   * C++ parity: HelicopterSlowDeathUpdate.cpp:183-501
   *
   * When a helicopter is killed in C++, HelicopterSlowDeathBehavior::onDie()
   * initializes a spiral orbit state:
   *   - forwardAngle starts at the helicopter's current heading
   *   - forwardSpeed = SpiralOrbitForwardSpeed (per frame, converted from units/sec)
   *   - each frame: x += cos(forwardAngle) * forwardSpeed
   *                 z += sin(forwardAngle) * forwardSpeed
   *                 forwardAngle += SpiralOrbitTurnRate * orbitDirection
   *                 forwardSpeed *= SpiralOrbitForwardSpeedDamping
   *   - vertical descent via gravity: verticalVelocity += HELICOPTER_GRAVITY * FallHowFast
   *   - self-spin oscillates between MinSelfSpin and MaxSelfSpin (visual rotation)
   *   - on ground hit: freeze entity, execute OCLs, then final explosion after delay
   *
   * TS implementation: entity-lifecycle.ts updateHelicopterSlowDeath() — implements
   * the same spiral orbit physics with the same formula.
   *
   * This test verifies that the helicopter's position traces a spiral pattern
   * (x/z change in a circular pattern while y decreases), not a straight-line
   * fall or random fling.
   */

  function makeHeliBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('TestHeli', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SD', {
            DeathTypes: 'ALL',
            DestructionDelay: 5000,
            SinkRate: 0,
            ProbabilityModifier: 100,
          }),
          makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_HSD', {
            DeathTypes: 'ALL',
            DestructionDelay: 5000,
            SinkRate: 0,
            ProbabilityModifier: 1,
            SpiralOrbitTurnRate: 180,            // 180 deg/s
            SpiralOrbitForwardSpeed: 60,         // 60 units/s -> ~2 units/frame
            SpiralOrbitForwardSpeedDamping: 0.98,
            MinSelfSpin: 90,                     // 90 deg/s
            MaxSelfSpin: 360,                    // 360 deg/s
            SelfSpinUpdateDelay: 200,            // 200ms -> 6 frames
            SelfSpinUpdateAmount: 30,            // 30 deg
            FallHowFast: 50,                     // 50% gravity
            DelayFromGroundToFinalDeath: 500,    // 500ms -> 15 frames
          }),
        ]),
        makeObjectDef('Killer', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('BigGun'),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 300,
          PrimaryDamage: 9999,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
          AntiAirborneVehicle: true,
        }),
      ],
    });
  }

  it('helicopter position traces a spiral (x/z circular, y descending) during slow death', () => {
    const bundle = makeHeliBundle();
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestHeli', 128, 128),
        makeMapObject('Killer', 140, 128),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    setupEnemyRelationships(logic, 'America', 'GLA');

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
        x: number; y: number; z: number; rotationY: number;
        helicopterSlowDeathState: {
          forwardAngle: number; forwardSpeed: number;
          hitGroundFrame: number; verticalVelocity: number;
        } | null;
        helicopterSlowDeathProfiles: unknown[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(
      e => e.helicopterSlowDeathProfiles.length > 0,
    )!;
    expect(heli).toBeDefined();

    // Elevate helicopter so it has room to spiral.
    heli.y = 300;

    // Kill the helicopter.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    expect(heli.health).toBeLessThanOrEqual(0);
    expect(heli.helicopterSlowDeathState).not.toBeNull();
    const hs = heli.helicopterSlowDeathState!;

    // Record positions over many frames to verify spiral pattern.
    const positions: { x: number; y: number; z: number }[] = [];
    const initX = heli.x;
    const initZ = heli.z;
    const initY = heli.y;

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
      if (hs.hitGroundFrame > 0) break;
      positions.push({ x: heli.x, y: heli.y, z: heli.z });
    }

    // Verify enough frames were captured before ground hit.
    expect(positions.length).toBeGreaterThan(10);

    // 1) Y should consistently decrease (helicopter is falling).
    const lastPos = positions[positions.length - 1]!;
    expect(lastPos.y).toBeLessThan(initY);

    // Verify monotonic descent (each frame lower than previous, allowing small rounding).
    let descendCount = 0;
    for (let i = 1; i < positions.length; i++) {
      if (positions[i]!.y < positions[i - 1]!.y) descendCount++;
    }
    // At least 90% of frames should show descent.
    expect(descendCount / (positions.length - 1)).toBeGreaterThan(0.9);

    // 2) X and Z should show significant lateral displacement (not just sinking straight down).
    const totalLateralDisplacement = Math.sqrt(
      (lastPos.x - initX) ** 2 + (lastPos.z - initZ) ** 2,
    );
    expect(totalLateralDisplacement).toBeGreaterThan(5);

    // 3) Verify spiral pattern: the heading (forwardAngle) should have turned significantly.
    // With SpiralOrbitTurnRate = 180 deg/s = ~0.1047 rad/frame, over 30+ frames the angle
    // should have rotated at least PI radians (half turn).
    // Instead of checking angle directly, verify that the position path curves:
    // compute the cumulative turning by checking cross products of consecutive displacement vectors.
    let totalCrossProduct = 0;
    for (let i = 2; i < positions.length; i++) {
      const dx1 = positions[i - 1]!.x - positions[i - 2]!.x;
      const dz1 = positions[i - 1]!.z - positions[i - 2]!.z;
      const dx2 = positions[i]!.x - positions[i - 1]!.x;
      const dz2 = positions[i]!.z - positions[i - 1]!.z;
      // Cross product sign indicates turning direction (positive = left turn, negative = right).
      totalCrossProduct += dx1 * dz2 - dz1 * dx2;
    }
    // The helicopter should consistently turn in one direction (orbitDirection=1 = left).
    // totalCrossProduct should have a consistent sign over many frames.
    expect(Math.abs(totalCrossProduct)).toBeGreaterThan(0.1);

    // 4) Forward speed should be damped (0.98 per frame).
    expect(hs.forwardSpeed).toBeLessThan(2); // Started at ~2 units/frame, should be smaller now.

    // 5) Vertical velocity should be increasingly negative (gravity).
    expect(hs.verticalVelocity).toBeLessThan(0);
  });

  it('helicopter eventually hits ground and is destroyed after delay', () => {
    const bundle = makeHeliBundle();
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestHeli', 128, 128),
        makeMapObject('Killer', 140, 128),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    setupEnemyRelationships(logic, 'America', 'GLA');

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        helicopterSlowDeathState: { hitGroundFrame: number } | null;
        helicopterSlowDeathProfiles: unknown[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(
      e => e.helicopterSlowDeathProfiles.length > 0,
    )!;
    heli.y = 50; // Low enough to hit ground quickly.

    // Kill it.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    expect(heli.helicopterSlowDeathState).not.toBeNull();

    // Run frames until ground hit.
    let hitGround = false;
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
      if (heli.helicopterSlowDeathState?.hitGroundFrame && heli.helicopterSlowDeathState.hitGroundFrame > 0) {
        hitGround = true;
        break;
      }
      if (heli.destroyed) break;
    }
    expect(hitGround || heli.destroyed).toBe(true);

    // After ground hit, helicopter should be destroyed after DelayFromGroundToFinalDeath (15 frames).
    if (!heli.destroyed) {
      for (let i = 0; i < 30; i++) {
        logic.update(1 / 30);
        if (heli.destroyed) break;
      }
      expect(heli.destroyed).toBe(true);
    }
  });

  it('documents spiral orbit direction matches C++ (always left, orbitDirection=1)', () => {
    // C++ HelicopterSlowDeathUpdate.cpp:213 — orbitDirection is always 1 (left).
    // TS entity-lifecycle.ts:522 — orbitDirection: 1.
    const bundle = makeHeliBundle();
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestHeli', 128, 128),
        makeMapObject('Killer', 140, 128),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    setupEnemyRelationships(logic, 'America', 'GLA');

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        helicopterSlowDeathState: {
          orbitDirection: number; forwardAngle: number;
        } | null;
        helicopterSlowDeathProfiles: unknown[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(
      e => e.helicopterSlowDeathProfiles.length > 0,
    )!;
    heli.y = 500;

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    const hs = heli.helicopterSlowDeathState!;
    expect(hs).not.toBeNull();

    // C++ and TS both use orbitDirection=1 (always left).
    expect(hs.orbitDirection).toBe(1);

    // Track forwardAngle change: with positive orbitDirection and positive spiralOrbitTurnRate,
    // the angle should increase each frame.
    const initAngle = hs.forwardAngle;
    logic.update(1 / 30);
    expect(hs.forwardAngle).not.toBe(initAngle);
  });
});

// ── Test 2: Garrison Auto-Eject at REALLYDAMAGED ─────────────────────────────

describe('Parity: garrison auto-eject at REALLYDAMAGED', () => {
  /**
   * C++ parity: GarrisonContain.cpp:1416-1425 — onBodyDamageStateChange()
   *
   *   void GarrisonContain::onBodyDamageStateChange(
   *     BodyDamageType oldState, BodyDamageType newState)
   *   {
   *     if (newState == BODY_REALLYDAMAGED) {
   *       if (!getObject()->isKindOf(KINDOF_GARRISONABLE_UNTIL_DESTROYED)) {
   *         // remove all garrisoned units
   *         removeAllContained();
   *       }
   *     }
   *   }
   *
   * When a garrisonable building transitions to BODY_REALLYDAMAGED (health <= 10%
   * of max), all garrisoned infantry are automatically ejected. However, buildings
   * with KINDOF_GARRISONABLE_UNTIL_DESTROYED bypass this and keep infantry inside
   * until the building is actually destroyed.
   *
   * TS implementation: index.ts line 26755-26764 — same logic in the damage
   * processing path: if newDamageState >= REALLYDAMAGED and old < REALLYDAMAGED
   * and building lacks GARRISONABLE_UNTIL_DESTROYED, evacuate all contained entities.
   */

  function makeGarrisonBundle(garrisonableUntilDestroyed: boolean) {
    const kindOf = ['STRUCTURE'];
    if (garrisonableUntilDestroyed) {
      kindOf.push('GARRISONABLE_UNTIL_DESTROYED');
    }
    return makeBundle({
      objects: [
        makeObjectDef('CivBuilding', 'America', kindOf, [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            ContainMax: 10,
          }),
        ]),
        makeObjectDef('Infantry1', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Infantry2', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Infantry3', 'America', ['INFANTRY'], [
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
          AttackRange: 200,
          DelayBetweenShots: 100,
          AllowAttackGarrisonedBldgs: 'Yes',
        }),
      ],
    });
  }

  it('auto-ejects garrisoned infantry when building reaches REALLYDAMAGED', () => {
    // REALLYDAMAGED threshold: health/maxHealth <= 0.1 (10%).
    // For MaxHealth=1000, health <= 100 = REALLYDAMAGED.
    const bundle = makeGarrisonBundle(false);
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 30, 30),    // id 1
        makeMapObject('Infantry1', 32, 30),       // id 2
        makeMapObject('Infantry2', 33, 30),       // id 3
        makeMapObject('Infantry3', 34, 30),       // id 4
        makeMapObject('DamageDealer', 60, 30),    // id 5
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    setupEnemyRelationships(logic, 'America', 'China');
    logic.update(0);

    // Garrison all 3 infantry into the building.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 1 });
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 4, targetBuildingId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Verify all 3 infantry are garrisoned.
    const buildingState = logic.getEntityState(1);
    expect(buildingState!.modelConditionFlags ?? []).toContain('LOADED');
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Damage the building past REALLYDAMAGED threshold incrementally.
    // Weapon does 10 dmg/shot with ~3 frames between shots.
    // Stop as soon as we cross 10% HP (100 HP) but before the building is destroyed.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 5,
      targetEntityId: 1,
      commandSource: 'PLAYER',
    });

    let ejected = false;
    for (let i = 0; i < 400; i++) {
      logic.update(1 / 30);
      const bs = logic.getEntityState(1);
      if (!bs) break; // building destroyed — stop
      if (bs.health <= 100 && bs.health > 0) {
        // We've reached REALLYDAMAGED — stop the attacker and check ejection.
        logic.submitCommand({ type: 'stop', entityId: 5, commandSource: 'PLAYER' });
        logic.update(1 / 30);
        ejected = true;
        break;
      }
    }

    expect(ejected).toBe(true);

    // Verify building is still alive in REALLYDAMAGED state.
    const finalBuildingState = logic.getEntityState(1);
    expect(finalBuildingState).not.toBeNull();
    expect(finalBuildingState!.health).toBeGreaterThan(0);
    expect(finalBuildingState!.health).toBeLessThanOrEqual(100);

    // C++ parity: GarrisonContain::onBodyDamageStateChange auto-ejects at REALLYDAMAGED.
    // All infantry should have been ejected (DISABLED_HELD cleared).
    const inf1Flags = logic.getEntityState(2)!.statusFlags ?? [];
    const inf2Flags = logic.getEntityState(3)!.statusFlags ?? [];
    const inf3Flags = logic.getEntityState(4)!.statusFlags ?? [];

    expect(inf1Flags).not.toContain('DISABLED_HELD');
    expect(inf2Flags).not.toContain('DISABLED_HELD');
    expect(inf3Flags).not.toContain('DISABLED_HELD');

    // Building should no longer show LOADED.
    const postBuildingState = logic.getEntityState(1);
    expect(postBuildingState!.modelConditionFlags ?? []).not.toContain('LOADED');
  });

  it('GARRISONABLE_UNTIL_DESTROYED building does NOT auto-eject at REALLYDAMAGED', () => {
    const bundle = makeGarrisonBundle(true); // has GARRISONABLE_UNTIL_DESTROYED
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 30, 30),    // id 1
        makeMapObject('Infantry1', 32, 30),       // id 2
        makeMapObject('Infantry2', 33, 30),       // id 3
        makeMapObject('Infantry3', 34, 30),       // id 4
        makeMapObject('DamageDealer', 60, 30),    // id 5
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    setupEnemyRelationships(logic, 'America', 'China');
    logic.update(0);

    // Garrison all 3 infantry.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 1 });
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 4, targetBuildingId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Verify garrisoned.
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Damage building to REALLYDAMAGED incrementally.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 5,
      targetEntityId: 1,
      commandSource: 'PLAYER',
    });

    let reachedReallyDamaged = false;
    for (let i = 0; i < 400; i++) {
      logic.update(1 / 30);
      const bs = logic.getEntityState(1);
      if (!bs) break;
      if (bs.health <= 100 && bs.health > 0) {
        logic.submitCommand({ type: 'stop', entityId: 5, commandSource: 'PLAYER' });
        logic.update(1 / 30);
        reachedReallyDamaged = true;
        break;
      }
    }

    expect(reachedReallyDamaged).toBe(true);
    const buildingHealth = logic.getEntityState(1)!.health;
    expect(buildingHealth).toBeGreaterThan(0);
    expect(buildingHealth).toBeLessThanOrEqual(100);

    // C++ parity: GARRISONABLE_UNTIL_DESTROYED bypasses auto-eject.
    // Infantry should STILL be garrisoned.
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Building should still show LOADED.
    expect(logic.getEntityState(1)!.modelConditionFlags ?? []).toContain('LOADED');
  });

  it('building at DAMAGED (not REALLYDAMAGED) does NOT trigger auto-eject', () => {
    // Sanity check: DAMAGED (health 10-50%) should not trigger ejection.
    const bundle = makeGarrisonBundle(false);
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 30, 30),
        makeMapObject('Infantry1', 32, 30),
        makeMapObject('DamageDealer', 60, 30),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    setupEnemyRelationships(logic, 'America', 'China');
    logic.update(0);

    // Garrison infantry.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Damage building to DAMAGED but not REALLYDAMAGED.
    // DAMAGED threshold: health/maxHealth <= 0.5 but > 0.1.
    // Target: ~300 HP (30% of 1000) = DAMAGED state.
    // Need to deal ~700 damage: 70 shots at 10 dmg/shot -> ~210 frames.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 3,
      targetEntityId: 1,
      commandSource: 'PLAYER',
    });
    for (let i = 0; i < 210; i++) logic.update(1 / 30);

    logic.submitCommand({ type: 'stop', entityId: 3, commandSource: 'PLAYER' });
    logic.update(1 / 30);

    const health = logic.getEntityState(1)!.health;
    // Health should be between 100 and 500 (DAMAGED but not REALLYDAMAGED).
    expect(health).toBeGreaterThan(100);
    expect(health).toBeLessThanOrEqual(500);

    // Infantry should still be garrisoned — no auto-eject at DAMAGED.
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');
  });
});

// ── Test 3: Horde Bonus offMap Guard ─────────────────────────────────────────

describe('Parity: horde bonus offMap guard', () => {
  /**
   * C++ parity: HordeUpdate.cpp:106-107 — PartitionFilterHordeMember::allow()
   *
   *   // doh
   *   if (m_obj->isOffMap() != objOther->isOffMap())
   *     return false;
   *
   * In C++, the horde scan explicitly rejects candidates where the offMap status
   * differs between the scanning entity and the candidate. This prevents units
   * that are offscreen (e.g., being produced, or in transit via a special power)
   * from contributing to horde bonuses of on-map units.
   *
   * TS update-behaviors.ts:1041-1128 — updateHorde() iterates spawnedEntities
   * but does NOT check any offMap status. There is no isOffMap() concept in the
   * TS entity model. This means that if an entity were somehow flagged as offMap
   * (e.g., future implementation of off-map unit spawning), it could incorrectly
   * contribute to horde bonuses of on-map allies.
   *
   * This is a documentation test: the offMap filter is absent in TS because there
   * is no offMap concept yet. The primary test verifies horde scan works correctly
   * for on-map units (the normal case), and documents the missing filter.
   */

  const WEAPON_BONUS_HORDE = 1 << 1;

  function makeHordeBlock(overrides: Record<string, unknown> = {}) {
    return makeBlock('Behavior', 'HordeUpdate ModuleTag_Horde', {
      KindOf: 'INFANTRY',
      Count: 3,
      Radius: 80,
      RubOffRadius: 20,
      AlliesOnly: 'Yes',
      ExactMatch: 'No',
      UpdateRate: 100,        // 100ms -> 3 frames
      AllowedNationalism: 'No',
      ...overrides,
    });
  }

  it('horde scan counts nearby same-type allies and activates bonus with 3+ units', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HordeInf', 'China', ['INFANTRY'], [
          makeHordeBlock(),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = createLogic();

    // Place 4 infantry close together.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HordeInf', 5, 5),
        makeMapObject('HordeInf', 5, 6),
        makeMapObject('HordeInf', 6, 5),
        makeMapObject('HordeInf', 6, 6),
      ], 20, 20),
      makeRegistry(bundle),
      makeHeightmap(20, 20),
    );
    logic.setPlayerSide(0, 'China');
    logic.update(0);

    // Run enough frames for the staggered horde scan to trigger on all units.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // All 4 units should have HORDE weapon bonus active.
    for (let id = 1; id <= 4; id++) {
      const flags = logic.getEntityState(id)!.weaponBonusConditionFlags;
      expect(flags & WEAPON_BONUS_HORDE).toBe(
        WEAPON_BONUS_HORDE,
      );
    }
  });

  it('horde scan does NOT activate bonus with fewer than minCount units', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HordeInf', 'China', ['INFANTRY'], [
          makeHordeBlock({ Count: 3 }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = createLogic();

    // Place only 2 infantry (below minCount of 3).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HordeInf', 5, 5),
        makeMapObject('HordeInf', 5, 6),
      ], 20, 20),
      makeRegistry(bundle),
      makeHeightmap(20, 20),
    );
    logic.setPlayerSide(0, 'China');
    logic.update(0);

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Neither unit should have HORDE bonus.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });

  it('documents that TS horde scan has no offMap filter (C++ HordeUpdate.cpp:106-107)', () => {
    /**
     * PARITY GAP DOCUMENTATION:
     *
     * C++ HordeUpdate.cpp line 106-107:
     *   if (m_obj->isOffMap() != objOther->isOffMap())
     *     return false;
     *
     * This check ensures offMap units (e.g., units being paradropped, or units
     * waiting in a production queue that have been placed off-map) cannot form
     * hordes with on-map units. This prevents phantom horde bonuses from
     * invisible off-screen units.
     *
     * TS update-behaviors.ts updateHorde() (line 1060-1106) iterates all
     * spawnedEntities and checks:
     *   - candidate.destroyed / slowDeathState / structureCollapseState
     *   - candidate.hordeProfile (has HordeUpdate module)
     *   - exactMatch (same templateName)
     *   - kindOf filter
     *   - alliesOnly (relationship check)
     *   - distance check
     *
     * MISSING: There is no isOffMap() or equivalent status check. The TS entity
     * model does not track offMap status at all. This gap would only manifest if
     * a future feature places entities in an offMap state while they remain in
     * spawnedEntities (e.g., off-map reinforcements, paradrop staging).
     *
     * Current practical impact: LOW — all spawned entities in TS are on-map.
     * Units in containers are filtered by destroyed/slowDeathState checks, and
     * their positions are snapped to the container (effectively on-map at the
     * container's location), so they still pass the distance check.
     */

    // Verify the horde scan works correctly for normal on-map units.
    // This test exists to document the gap, not to demonstrate a behavioral failure.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HordeInf', 'China', ['INFANTRY'], [
          makeHordeBlock({ Count: 4 }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = createLogic();

    // Place exactly 4 infantry to meet the minCount=4 threshold.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HordeInf', 5, 5),
        makeMapObject('HordeInf', 5, 6),
        makeMapObject('HordeInf', 6, 5),
        makeMapObject('HordeInf', 6, 6),
      ], 20, 20),
      makeRegistry(bundle),
      makeHeightmap(20, 20),
    );
    logic.setPlayerSide(0, 'China');
    logic.update(0);

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // All units should have horde bonus (all are on-map, no offMap filtering needed).
    for (let id = 1; id <= 4; id++) {
      const flags = logic.getEntityState(id)!.weaponBonusConditionFlags;
      expect(flags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    }

    // Access internal state to verify no offMap check exists in the scan.
    // The TS entity model has no isOffMap field — confirm this by checking entity structure.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, Record<string, unknown>>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Document: entity has no isOffMap property (the C++ check cannot be replicated).
    expect('isOffMap' in entity).toBe(false);
    expect('offMap' in entity).toBe(false);
  });

  it('horde bonus is removed when units spread apart', () => {
    // Verifies the horde scan re-evaluates and removes bonus when units move away.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HordeInf', 'China', ['INFANTRY'], [
          makeHordeBlock({ Count: 3 }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('HordeInf', 5, 5),
        makeMapObject('HordeInf', 5, 6),
        makeMapObject('HordeInf', 6, 5),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'China');
    logic.update(0);

    // Wait for horde to activate.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);

    // Move entity 3 far away (beyond scan radius of 80).
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { x: number; z: number }>;
    };
    const farUnit = priv.spawnedEntities.get(3)!;
    farUnit.x = 500;
    farUnit.z = 500;

    // Run more frames for the scan to re-evaluate.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Entities 1 and 2 now only have 1 neighbor (each other) — below minCount=3.
    // Horde bonus should be removed.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });
});
