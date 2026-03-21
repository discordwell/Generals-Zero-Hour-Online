/**
 * Parity tests for dozer idle behavior after building destruction and weapon fire visual event timing.
 *
 * Source references:
 *   DozerAIUpdate.cpp — internalTaskComplete / internalTaskCancelled clear task when goal object destroyed
 *   DozerPrimaryIdleState::update — bored dozer auto-seeks repair targets after idle timeout
 *   Weapon.cpp — fireWeapon() emits FireFX/FireOCL/FireSound at the moment the shot fires
 *
 * TS references:
 *   command-dispatch.ts:2568-2573 — pendingRepairActions cleaned when building destroyed
 *   ai-updates.ts:222-268 — updateDozerRepair clears task on building.destroyed
 *   ai-updates.ts:273-317 — updateDozerIdleBehavior scans for auto-repair after bored timeout
 *   combat-targeting.ts:1109-1114 — emitWeaponFiredVisualEvent on shot fire
 *   index.ts:25485-25505 — emitWeaponFiredVisualEvent pushes WEAPON_FIRED to visualEventBuffer
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

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
  makeWeaponBlock,
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ---------------------------------------------------------------------------
// Test 1: Dozer Idle Behavior After Building Destruction
// ---------------------------------------------------------------------------
// C++ source: DozerAIUpdate.cpp — when the goal object (building being repaired
// or constructed) is destroyed, DozerActionDoActionState::update detects the
// invalid goal and calls internalTaskComplete(m_task), which clears the task
// via internalTaskCompleteOrCancelled. The dozer then returns to its primary
// idle state (DozerPrimaryIdleState), where after m_boredTimeFrames of
// inactivity it auto-scans for damaged buildings in boredRange to repair.
//
// TS source:
//   command-dispatch.ts:2568-2573 — per-frame repair update checks
//     if (!dozer || !building || dozer.destroyed || building.destroyed)
//       pendingRepairActions.delete(dozerId)
//   ai-updates.ts:232-236 — updateDozerRepair:
//     if (!building || building.destroyed) { state.currentTask = INVALID; }
//   ai-updates.ts:273-317 — updateDozerIdleBehavior:
//     after boredTimeFrames of idle, scans for damaged structures within boredRange

describe('Dozer idle behavior after building destruction (C++ parity)', () => {
  function makeDozerDestructionSetup() {
    const dozerDef = makeObjectDef('Dozer', 'America', ['VEHICLE', 'DOZER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 300,
        InitialHealth: 300,
      }),
      makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
        RepairHealthPercentPerSecond: 0.10,
        BoredTime: 99999,
        BoredRange: 0,
      }),
    ]);

    const buildingDef = makeObjectDef('RepairTarget', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 1000,
        InitialHealth: 1000,
      }),
    ]);

    const bundle = makeBundle({
      objects: [dozerDef, buildingDef],
    });

    const logic = createLogic();
    // Place dozer close to building (within 20 units for immediate repair).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairTarget', 20, 20), // id 1
        makeMapObject('Dozer', 22, 20),         // id 2
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    return { logic };
  }

  it('dozer returns to idle state when repaired building is destroyed', () => {
    // C++ source: DozerAIUpdate.cpp:308-316 — DozerActionDoActionState::onEnter
    // checks if goal object is NULL or dead and calls internalTaskComplete.
    //
    // C++ source: DozerAIUpdate.cpp:2094-2111 — internalTaskComplete clears
    // m_task[task].m_targetObjectID = INVALID_ID and m_taskOrderFrame = 0.
    //
    // TS source: command-dispatch.ts:2568-2573 — repair update loop:
    //   if (!dozer || !building || dozer.destroyed || building.destroyed) {
    //     self.pendingRepairActions.delete(dozerId);
    //     clearDozerTaskOrder(self, dozer ?? null, 'REPAIR');
    //   }
    const { logic } = makeDozerDestructionSetup();

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        health: number;
        maxHealth: number;
        destroyed: boolean;
        moving: boolean;
      }>;
      pendingRepairActions: Map<number, number>;
    };

    // Damage building to 500 HP (50% health).
    const building = priv.spawnedEntities.get(1)!;
    building.health = 500;
    expect(logic.getEntityState(1)!.health).toBe(500);

    // Issue repair command.
    logic.submitCommand({
      type: 'repairBuilding',
      entityId: 2,
      targetBuildingId: 1,
    });

    // Step a few frames to establish the repair task.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    // Verify dozer has an active repair task (pendingRepairActions has dozer→building).
    expect(priv.pendingRepairActions.has(2)).toBe(true);
    expect(priv.pendingRepairActions.get(2)).toBe(1);

    // Building health should have increased slightly from repair.
    const healthAfterRepair = logic.getEntityState(1)!.health;
    expect(healthAfterRepair).toBeGreaterThan(500);

    // Now destroy the building.
    building.health = 0;
    building.destroyed = true;

    // Step frames to allow the repair loop to detect the destroyed building.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    // Verify the dozer's repair task is cleared.
    // C++ parity: internalTaskComplete sets m_targetObjectID = INVALID_ID.
    // TS parity: pendingRepairActions.delete(dozerId) removes the entry.
    expect(priv.pendingRepairActions.has(2)).toBe(false);

    // Verify the dozer is still alive and not stuck.
    const dozerState = logic.getEntityState(2)!;
    expect(dozerState.alive).toBe(true);
    expect(dozerState.health).toBe(300);

    // Dozer should not be moving (no target to walk to after building dies).
    // This verifies it's in an idle state, not stuck trying to reach a dead building.
    expect(dozerState.moving).toBe(false);
  });

  it('dozer does not remain stuck after multiple repair-destroy cycles', () => {
    // C++ source: DozerAIUpdate.cpp — each task completion/cancellation fully
    // resets the task slot, allowing the dozer to accept new tasks cleanly.
    //
    // This test verifies the TS implementation also resets cleanly, allowing
    // a dozer to repair, have the building destroyed, get a new repair command,
    // and repeat without getting stuck.

    const dozerDef = makeObjectDef('Dozer', 'America', ['VEHICLE', 'DOZER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 300,
        InitialHealth: 300,
      }),
      makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
        RepairHealthPercentPerSecond: 0.10,
        BoredTime: 99999,
        BoredRange: 0,
      }),
    ]);

    const buildingDef = makeObjectDef('Building', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    const bundle = makeBundle({
      objects: [dozerDef, buildingDef],
    });

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Building', 20, 20),  // id 1 — first building
        makeMapObject('Building', 30, 20),  // id 2 — second building
        makeMapObject('Dozer', 22, 20),     // id 3 — dozer
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        health: number;
        maxHealth: number;
        destroyed: boolean;
      }>;
      pendingRepairActions: Map<number, number>;
    };

    // --- Cycle 1: Repair building 1, then destroy it ---
    const building1 = priv.spawnedEntities.get(1)!;
    building1.health = 200;

    logic.submitCommand({ type: 'repairBuilding', entityId: 3, targetBuildingId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    expect(priv.pendingRepairActions.has(3)).toBe(true);

    // Destroy building 1.
    building1.health = 0;
    building1.destroyed = true;
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Repair task should be cleared.
    expect(priv.pendingRepairActions.has(3)).toBe(false);

    // --- Cycle 2: Repair building 2 — dozer should accept new task ---
    const building2 = priv.spawnedEntities.get(2)!;
    building2.health = 200;

    logic.submitCommand({ type: 'repairBuilding', entityId: 3, targetBuildingId: 2 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Dozer should have accepted the new repair task.
    expect(priv.pendingRepairActions.has(3)).toBe(true);
    expect(priv.pendingRepairActions.get(3)).toBe(2);

    // Dozer should be alive and functional.
    const dozerState = logic.getEntityState(3)!;
    expect(dozerState.alive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Weapon Fire Visual Event Timing
// ---------------------------------------------------------------------------
// C++ source: Weapon.cpp — fireWeapon() is called at the moment the weapon
// fires (after preAttackDelay expires and delayBetweenShots timer is ready).
// At this point, the weapon:
//   1. Creates the projectile or applies instant damage
//   2. Plays FireFX (muzzle flash effects)
//   3. Plays FireSound (weapon firing sound)
//   4. Creates FireOCL (object creation list, e.g. shell casings)
//
// These all happen on the SAME frame as the damage event is queued.
//
// TS source:
//   combat-targeting.ts:1109-1114 — emitWeaponFiredVisualEvent is called
//     in the same function that queues the pending weapon damage event.
//   index.ts:25485-25505 — emitWeaponFiredVisualEvent pushes a WEAPON_FIRED
//     event with sourceEntityId, target position, and weapon visual type.
//   index.ts:8829-8834 — drainVisualEvents() returns accumulated events.

describe('Weapon fire visual event timing (C++ parity)', () => {
  function makeAttackSetup() {
    const attackerDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeWeaponBlock('TankGun'),
    ]);

    const targetDef = makeObjectDef('TargetDummy', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 5000,
        InitialHealth: 5000,
      }),
    ]);

    const weaponDef = makeWeaponDef('TankGun', {
      PrimaryDamage: 50,
      AttackRange: 120,
      DelayBetweenShots: 500, // 15 frames at 30 FPS
      DamageType: 'ARMOR_PIERCING',
    });

    const bundle = makeBundle({
      objects: [attackerDef, targetDef],
      weapons: [weaponDef],
    });

    const logic = createLogic();
    // Place attacker and target within weapon range.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),          // id 1
        makeMapObject('TargetDummy', 30, 10),   // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    return { logic };
  }

  it('emits WEAPON_FIRED visual event on the frame the first shot fires', () => {
    // C++ source: Weapon.cpp — fireWeapon() creates projectile AND plays
    // FireFX/FireSound on the same frame. The fire event is synchronous
    // with damage queuing.
    //
    // TS source: combat-targeting.ts:1109-1114 — emitWeaponFiredVisualEvent
    // is called in queueWeaponDamageEvent, which runs on the frame the
    // weapon's delay timer expires and the shot is dispatched.
    const { logic } = makeAttackSetup();

    // Drain any initial visual events.
    logic.drainVisualEvents();

    // Issue attack command.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 1,
      targetEntityId: 2,
    });

    // Step frame-by-frame and look for the first WEAPON_FIRED event.
    let firstFireFrame = -1;
    let firstFireEvent: { type: string; sourceEntityId: number | null; targetX?: number; targetZ?: number } | null = null;
    const targetInitialHealth = logic.getEntityState(2)!.health;
    let firstDamageFrame = -1;

    for (let frame = 1; frame <= 30; frame++) {
      logic.update(1 / 30);

      const events = logic.drainVisualEvents();
      const weaponFired = events.find(e => e.type === 'WEAPON_FIRED');

      if (weaponFired && firstFireFrame === -1) {
        firstFireFrame = frame;
        firstFireEvent = weaponFired;
      }

      // Also track when damage first appears.
      const targetHealth = logic.getEntityState(2)!.health;
      if (targetHealth < targetInitialHealth && firstDamageFrame === -1) {
        firstDamageFrame = frame;
      }
    }

    // A WEAPON_FIRED event should have been emitted within the first 30 frames.
    expect(firstFireFrame).toBeGreaterThan(0);
    expect(firstFireEvent).not.toBeNull();

    // The WEAPON_FIRED event should identify the attacker.
    // C++ parity: fireWeapon is called on the firing object.
    // TS parity: emitWeaponFiredVisualEvent sets sourceEntityId = attacker.id.
    expect(firstFireEvent!.sourceEntityId).toBe(1);

    // The WEAPON_FIRED event should contain target position info.
    // C++ parity: Weapon.cpp passes target position for projectile trajectory.
    // TS parity: emitWeaponFiredVisualEvent receives target { x, y, z }.
    expect(firstFireEvent!.targetX).toBeDefined();
    expect(firstFireEvent!.targetZ).toBeDefined();
  });

  it('WEAPON_FIRED event coincides with damage application on the same frame', () => {
    // C++ source: Weapon.cpp — fireWeapon() simultaneously:
    //   1. Queues the damage event (instant delivery or projectile)
    //   2. Emits FireFX/FireSound
    // For instant-delivery weapons (no projectile), damage and visual
    // fire event occur on the exact same frame.
    //
    // TS source: combat-targeting.ts — queueWeaponDamageEvent calls
    // emitWeaponFiredVisualEvent AND pushes to pendingWeaponDamageEvents
    // in the same function call.
    const { logic } = makeAttackSetup();

    logic.drainVisualEvents();

    logic.submitCommand({
      type: 'attackEntity',
      entityId: 1,
      targetEntityId: 2,
    });

    const targetInitialHealth = logic.getEntityState(2)!.health;
    let fireEventFrame = -1;
    let damageFrame = -1;

    for (let frame = 1; frame <= 30; frame++) {
      logic.update(1 / 30);

      const events = logic.drainVisualEvents();
      if (events.some(e => e.type === 'WEAPON_FIRED') && fireEventFrame === -1) {
        fireEventFrame = frame;
      }

      const currentHealth = logic.getEntityState(2)!.health;
      if (currentHealth < targetInitialHealth && damageFrame === -1) {
        damageFrame = frame;
      }
    }

    // Both events should have occurred.
    expect(fireEventFrame).toBeGreaterThan(0);
    expect(damageFrame).toBeGreaterThan(0);

    // C++ parity: fire event and damage happen on the same frame for
    // instant-delivery weapons. For projectile weapons, the fire event
    // precedes the impact. In either case, the fire event must occur
    // on or before the damage frame.
    //
    // With instant delivery (no ProjectileObject), both should be the same frame.
    // The weapon defined here has no ProjectileObject, so delivery is instant.
    expect(fireEventFrame).toBeLessThanOrEqual(damageFrame);

    // For instant weapons specifically, fire and damage should be the same frame.
    // C++ Weapon.cpp: fireWeapon calls dealDamage immediately for non-projectile weapons.
    expect(fireEventFrame).toBe(damageFrame);
  });

  it('emits WEAPON_FIRED for each shot in a multi-shot sequence', () => {
    // C++ source: Weapon.cpp — fireWeapon() is called for EACH shot.
    // Each call emits its own FireFX/FireSound. With ClipSize > 1,
    // multiple shots fire with DelayBetweenShots between each.
    //
    // TS source: Each call to queueWeaponDamageEvent triggers a
    // separate emitWeaponFiredVisualEvent. Multiple shots = multiple events.
    const { logic } = makeAttackSetup();

    logic.drainVisualEvents();

    logic.submitCommand({
      type: 'attackEntity',
      entityId: 1,
      targetEntityId: 2,
    });

    // Run enough frames for multiple shots to fire.
    // DelayBetweenShots = 500ms = 15 frames. Run 60 frames for ~3-4 shots.
    let weaponFiredCount = 0;
    for (let frame = 1; frame <= 60; frame++) {
      logic.update(1 / 30);

      const events = logic.drainVisualEvents();
      weaponFiredCount += events.filter(e => e.type === 'WEAPON_FIRED').length;
    }

    // Should have fired multiple shots over 60 frames with 15-frame intervals.
    // C++ parity: each fireWeapon call emits separate FX.
    // TS parity: each queueWeaponDamageEvent call emits separate visual event.
    expect(weaponFiredCount).toBeGreaterThanOrEqual(2);

    // All fire events came from the attacker (entity 1).
    // Verified implicitly — no other attacker exists.
  });

  it('WEAPON_FIRED event contains correct weapon visual info', () => {
    // C++ source: Weapon.cpp — fireWeapon passes weapon template info
    // for visual effect selection (FireFX index, projectile type).
    //
    // TS source: emitWeaponFiredVisualEvent (index.ts:25485-25505) includes:
    //   - type: 'WEAPON_FIRED'
    //   - x, y, z: attacker position (muzzle flash origin)
    //   - sourceEntityId: attacker.id
    //   - projectileType: classified weapon visual type
    //   - targetX, targetY, targetZ: target endpoint for beam/tracer rendering
    const { logic } = makeAttackSetup();

    logic.drainVisualEvents();

    logic.submitCommand({
      type: 'attackEntity',
      entityId: 1,
      targetEntityId: 2,
    });

    // Step until first shot fires.
    let fireEvent: {
      type: string;
      sourceEntityId: number | null;
      x: number;
      y: number;
      z: number;
      projectileType: string;
      targetX?: number;
      targetY?: number;
      targetZ?: number;
    } | null = null;

    for (let frame = 1; frame <= 30; frame++) {
      logic.update(1 / 30);
      const events = logic.drainVisualEvents();
      const found = events.find(e => e.type === 'WEAPON_FIRED');
      if (found) {
        fireEvent = found as typeof fireEvent;
        break;
      }
    }

    expect(fireEvent).not.toBeNull();

    // Verify event structure matches C++ fire event data.
    expect(fireEvent!.type).toBe('WEAPON_FIRED');
    expect(fireEvent!.sourceEntityId).toBe(1);

    // Position should be near the attacker's position (muzzle flash origin).
    const attackerState = logic.getEntityState(1)!;
    expect(fireEvent!.x).toBeCloseTo(attackerState.x, 0);
    expect(fireEvent!.z).toBeCloseTo(attackerState.z, 0);

    // Target position should be near the target entity's position.
    const targetState = logic.getEntityState(2)!;
    expect(fireEvent!.targetX).toBeDefined();
    expect(fireEvent!.targetZ).toBeDefined();
    expect(fireEvent!.targetX!).toBeCloseTo(targetState.x, 0);
    expect(fireEvent!.targetZ!).toBeCloseTo(targetState.z, 0);

    // projectileType should be a valid classification string.
    // C++ parity: weapon visual type is derived from template fields.
    expect(typeof fireEvent!.projectileType).toBe('string');
    expect(fireEvent!.projectileType.length).toBeGreaterThan(0);
  });
});
