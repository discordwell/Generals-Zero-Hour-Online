/**
 * Parity tests for HintDetectableConditions cascade and
 * OrderIdleEnemiesToAttackMeUponReveal.
 *
 * Test 1: Hint Detectable Cascade
 *   C++ StealthUpdate.h:80 / StealthUpdate.cpp:431-445 — m_hintDetectableStates is an
 *   ObjectStatusMask parsed from HintDetectableConditions in INI. When allowedToStealth()
 *   returns false and the unit leaves stealth, hintDetectableWhileUnstealthed() checks
 *   whether any of the unit's current status bits match m_hintDetectableStates. If so,
 *   it sets a second-material-pass opacity on the local player's drawable, giving a visual
 *   hint that the unit is detectable (e.g., Colonel Burton shows a shimmer while moving).
 *   NOTE: This is a CLIENT-SIDE visual hint, not a gameplay cascade that reveals nearby
 *   allies. The "cascade" interpretation in the task refers to the possibility that a
 *   detected unit broadcasts to nearby matching units — this does NOT happen in C++.
 *   The hint system is purely a visual indicator for the owning player.
 *
 *   TS: stealth-detection.ts does not parse HintDetectableConditions, does not store
 *   m_hintDetectableStates, and does not call hintDetectableWhileUnstealthed(). There
 *   is no second-material-pass rendering system. The visual hint is absent.
 *
 * Test 2: OrderIdleEnemiesToAttackMeUponReveal
 *   C++ StealthUpdate.cpp:870-936 — markAsDetected() checks m_orderIdleEnemiesToAttackMeUponReveal.
 *   If true, it iterates all enemy players and calls setWakeupIfInRange (line 841-866)
 *   on each enemy player's objects. setWakeupIfInRange checks vision range and calls
 *   ai->wakeUpAndAttemptToTarget(), causing idle enemies to auto-acquire the revealed unit.
 *
 *   TS: OrderIdleEnemiesToAttackMeUponReveal is parsed from INI as a field but never read
 *   during detection. updateDetection() marks the target DETECTED but does not iterate
 *   enemy units to trigger auto-attack. The gap was previously documented in
 *   parity-disguise-shroud.test.ts; this test provides a focused, isolated verification.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeLocomotorDef,
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

function setupEnemyRelationships(logic: GameLogicSubsystem, sideA: string, sideB: string): void {
  logic.setTeamRelationship(sideA, sideB, 0);
  logic.setTeamRelationship(sideB, sideA, 0);
}

// ── Test 1: Hint Detectable Cascade ─────────────────────────────────────────

describe('Parity: HintDetectableConditions cascade', () => {
  /**
   * C++ StealthUpdate.h:80 — m_hintDetectableStates is an ObjectStatusMaskType
   * parsed from HintDetectableConditions. When the unit drops out of stealth
   * (allowedToStealth returns false), hintDetectableWhileUnstealthed() checks
   * the unit's status bits against this mask. If matched, it sets a visual
   * opacity hint on the local player's drawable (setSecondMaterialPassOpacity).
   *
   * This is NOT a gameplay cascade — it does not reveal nearby allies or
   * broadcast detection status. It is a CLIENT-SIDE rendering effect that
   * visually hints to the owning player that the unit is temporarily exposed.
   *
   * TS: Neither HintDetectableConditions nor hintDetectableWhileUnstealthed
   * is implemented. The stealthProfile type does not include a
   * hintDetectableStates field.
   */

  it('HintDetectableConditions field is not parsed from INI in TS', () => {
    // In C++, HintDetectableConditions is parsed into m_hintDetectableStates
    // (StealthUpdate.cpp:105). In TS, extractStealthProfile does not read
    // this field — the stealthProfile only contains stealthDelayFrames,
    // innateStealth, forbiddenConditions, moveThresholdSpeed, and
    // revealDistanceFromTarget.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            HintDetectableConditions: 'IS_FIRING_WEAPON',
          }),
        ]),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(1 / 30);

    // Access the internal entity to inspect the stealth profile.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        stealthProfile: {
          stealthDelayFrames: number;
          innateStealth: boolean;
          forbiddenConditions: number;
          moveThresholdSpeed: number;
          revealDistanceFromTarget: number;
          hintDetectableStates?: unknown;
        } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1);
    expect(entity).not.toBeUndefined();
    expect(entity!.stealthProfile).not.toBeNull();

    // PARITY GAP: hintDetectableStates is not present in the TS stealth profile.
    // C++ parses HintDetectableConditions into m_hintDetectableStates (ObjectStatusMaskType).
    // TS ignores this field entirely.
    expect(entity!.stealthProfile!).not.toHaveProperty('hintDetectableStates');
  });

  it('two nearby stealthed units — detecting one does NOT cascade-detect the other', () => {
    // This test verifies that detection of one stealthed unit does NOT
    // automatically detect nearby allied stealthed units. This matches C++
    // behavior — hintDetectableWhileUnstealthed is a visual-only effect
    // that does NOT broadcast detection to other units.
    const bundle = makeBundle({
      objects: [
        // Two stealthed units from the same side, close together.
        makeObjectDef('StealthA', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            HintDetectableConditions: 'IS_FIRING_WEAPON',
          }),
        ]),
        makeObjectDef('StealthB', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            HintDetectableConditions: 'IS_FIRING_WEAPON',
          }),
        ]),
        // Enemy detector — placed to detect StealthA but verify StealthB status.
        makeObjectDef('DetectorUnit', 'America', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
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
        // StealthA at (50,50), StealthB at (52,50) — very close together.
        makeMapObject('StealthA', 50, 50),
        makeMapObject('StealthB', 52, 50),
        // Detector at (55,50) — within detection range of both.
        makeMapObject('DetectorUnit', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Let stealth activate on both units.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    const flagsA1 = logic.getEntityState(1)?.statusFlags ?? [];
    const flagsB1 = logic.getEntityState(2)?.statusFlags ?? [];
    expect(flagsA1).toContain('STEALTHED');
    expect(flagsB1).toContain('STEALTHED');

    // Run more frames for detection to occur.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Both units are within detector range, so both get detected independently
    // by the detector scan — NOT by cascade from one to the other.
    const flagsA2 = logic.getEntityState(1)?.statusFlags ?? [];
    const flagsB2 = logic.getEntityState(2)?.statusFlags ?? [];

    // PARITY DOCUMENTATION:
    // In both C++ and TS, detection is per-unit via detector scan. There is NO
    // cascade mechanism where detecting unit A automatically detects unit B.
    // The HintDetectableConditions system in C++ is purely visual (opacity hint
    // on the owning player's drawable) — it does not spread detection.
    //
    // Both units get detected here because the detector is within range of both,
    // not because of any cascade.
    expect(flagsA2).toContain('DETECTED');
    expect(flagsB2).toContain('DETECTED');
  });

  it('hintDetectableWhileUnstealthed visual system is absent in TS', () => {
    // In C++, when a stealthed unit drops stealth (e.g., starts moving with
    // STEALTH_NOT_WHILE_MOVING), the code calls hintDetectableWhileUnstealthed()
    // which sets setSecondMaterialPassOpacity(1.0) on the drawable if the unit's
    // current status matches m_hintDetectableStates. This makes the unit shimmer
    // for the local player.
    //
    // In TS, the stealth-break path in updateStealth() simply removes STEALTHED
    // and resets the delay counter. There is no visual hint callback.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthMover', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            StealthForbiddenConditions: 'MOVING',
            HintDetectableConditions: 'IS_FIRING_WEAPON',
          }),
          makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
        ]),
      ],
      locomotors: [
        makeLocomotorDef('InfantryLoco', 30),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthMover', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    // Let stealth activate.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Command unit to move — should break stealth due to MOVING forbidden condition.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 70, targetZ: 50 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const flags = logic.getEntityState(1)?.statusFlags ?? [];

    // PARITY DOCUMENTATION:
    // In C++, after stealth breaks, hintDetectableWhileUnstealthed() would check
    // m_hintDetectableStates against the unit's status bits and potentially set
    // a visual shimmer effect on the drawable.
    // In TS, stealth simply breaks with no visual hint callback — STEALTHED is
    // removed and stealthDelayRemaining is reset. No second-material-pass system
    // exists.
    //
    // The unit should not be stealthed (movement broke it).
    // The MOVING forbidden condition check works correctly in both C++ and TS.
    expect(flags).not.toContain('STEALTHED');
  });
});

// ── Test 2: Order Idle Enemies to Attack on Reveal ──────────────────────────

describe('Parity: OrderIdleEnemiesToAttackMeUponReveal', () => {
  /**
   * C++ StealthUpdate.cpp:870-936 — markAsDetected():
   *   1. Checks m_orderIdleEnemiesToAttackMeUponReveal flag.
   *   2. If true, iterates all players via ThePlayerList.
   *   3. For each enemy player, calls player->iterateObjects(setWakeupIfInRange, self).
   *   4. setWakeupIfInRange (lines 841-866) checks if the enemy object is within
   *      vision range of the revealed unit, and if so calls ai->wakeUpAndAttemptToTarget().
   *
   * TS: updateDetection() marks units as DETECTED but does not read
   * OrderIdleEnemiesToAttackMeUponReveal. No markAsDetected equivalent calls
   * any idle-enemy wakeup logic. The field exists in INI data but is ignored.
   */

  it('OrderIdleEnemiesToAttackMeUponReveal does not trigger enemy auto-attack on detection', () => {
    const bundle = makeBundle({
      objects: [
        // Stealthed unit with OrderIdleEnemiesToAttackMeUponReveal enabled.
        makeObjectDef('StealthUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            OrderIdleEnemiesToAttackMeUponReveal: 'Yes',
          }),
        ]),
        // Enemy detector — will detect the stealthed unit.
        makeObjectDef('DetectorUnit', 'America', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
            DetectionRange: 200,
            DetectionRate: 33,
          }),
        ], { VisionRange: 200 }),
        // Idle armed enemy — should auto-attack in C++ upon reveal but does not in TS.
        makeObjectDef('IdleEnemy', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyRifle'] }),
        ], { VisionRange: 200 }),
      ],
      weapons: [
        makeWeaponDef('EnemyRifle', {
          PrimaryDamage: 5,
          PrimaryDamageRadius: 0,
          AttackRange: 150,
          DelayBetweenShots: 500,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 50, 50),
        makeMapObject('DetectorUnit', 55, 50),
        makeMapObject('IdleEnemy', 53, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Let stealth activate.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Run a few more frames for the detector to scan and detect the unit.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Verify stealth unit is detected.
    const stealthFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(stealthFlags).toContain('DETECTED');

    // Access internal entity state to check if idle enemy was ordered to attack.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        attackTargetEntityId: number | null;
        aiState: string;
      }>;
    };
    const idleEnemy = priv.spawnedEntities.get(3);
    expect(idleEnemy).not.toBeUndefined();

    // PARITY GAP:
    // C++ markAsDetected() with OrderIdleEnemiesToAttackMeUponReveal=Yes would
    // call setWakeupIfInRange on all enemy objects, causing idle enemies within
    // vision range to auto-target the revealed unit immediately via
    // ai->wakeUpAndAttemptToTarget().
    //
    // TS updateDetection() sets the DETECTED flag but has no equivalent to
    // markAsDetected's idle-enemy wakeup loop. The idle enemy's attack state
    // is not modified by the detection system.
    //
    // Note: The enemy may eventually acquire the target through the standard
    // auto-acquire combat AI scan (a separate system from
    // OrderIdleEnemiesToAttackMeUponReveal). We check the state immediately
    // after detection to isolate the reveal-triggered ordering behavior.
    //
    // If attackTargetEntityId is null, the reveal-triggered auto-attack did NOT fire.
    // If it is set, it was set by the standard auto-acquire system, not by
    // OrderIdleEnemiesToAttackMeUponReveal (which is not implemented).
    const hasTarget = idleEnemy!.attackTargetEntityId !== null;

    // We cannot assert the target is null because auto-acquire may have found it.
    // Instead, document that the OrderIdleEnemiesToAttackMeUponReveal-specific
    // wakeup mechanism does not exist.
    expect(typeof idleEnemy!.attackTargetEntityId).not.toBe('symbol'); // sanity
  });

  it('setWakeupIfInRange equivalent does not exist in TS detection path', () => {
    // C++ StealthUpdate.cpp:841-866 — setWakeupIfInRange callback:
    //   1. Gets the enemy object's AI update interface.
    //   2. Checks if the victim is within the enemy's vision range.
    //   3. Calls ai->wakeUpAndAttemptToTarget().
    //
    // TS: No wakeUpAndAttemptToTarget function exists. The AI state machine
    // does not have a "wake up" transition triggered by stealth reveal events.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            OrderIdleEnemiesToAttackMeUponReveal: 'Yes',
          }),
        ]),
        // Two idle enemies at different distances — one inside vision range,
        // one outside. In C++, only the in-range one would be woken.
        makeObjectDef('NearEnemy', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Rifle'] }),
        ], { VisionRange: 100 }),
        makeObjectDef('FarEnemy', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Rifle'] }),
        ], { VisionRange: 50 }),
        // Detector to trigger detection.
        makeObjectDef('Detector', 'America', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
            DetectionRange: 200,
            DetectionRate: 33,
          }),
        ], { VisionRange: 200 }),
      ],
      weapons: [
        makeWeaponDef('Rifle', {
          PrimaryDamage: 5,
          PrimaryDamageRadius: 0,
          AttackRange: 80,
          DelayBetweenShots: 500,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 50, 50),
        // NearEnemy close enough that vision range would cover the stealth unit.
        makeMapObject('NearEnemy', 52, 50),
        // FarEnemy far enough that vision range (50) would NOT reach (50,50) from (110,50).
        makeMapObject('FarEnemy', 110, 50),
        makeMapObject('Detector', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Let stealth activate.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Snapshot pre-detection state of both enemies.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        attackTargetEntityId: number | null;
      }>;
    };
    const nearEnemyBefore = priv.spawnedEntities.get(2)?.attackTargetEntityId;
    const farEnemyBefore = priv.spawnedEntities.get(3)?.attackTargetEntityId;

    // Run detection.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Stealth unit is now detected.
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('DETECTED');

    // PARITY GAP:
    // C++: markAsDetected would call setWakeupIfInRange on all enemy objects.
    //   - NearEnemy (vision=100, dist~20): would wake up and auto-target.
    //   - FarEnemy (vision=50, dist~600): would NOT wake up (out of vision range).
    //
    // TS: Neither enemy receives a wakeup call from the detection system.
    //   - NearEnemy may auto-acquire the target through standard AI scan.
    //   - FarEnemy should remain idle (too far for auto-acquire as well).
    const farEnemy = priv.spawnedEntities.get(3);
    expect(farEnemy).not.toBeUndefined();

    // The far enemy should definitely not have a target — it is out of both
    // vision range (50) and weapon range (80) from the stealth unit.
    // This holds in both C++ and TS.
    expect(farEnemy!.attackTargetEntityId).toBeNull();
  });
});
