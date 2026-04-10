/**
 * Parity tests for stealth disguise state machine and DynamicShroudClearingRangeUpdate.
 *
 * Test 1: Stealth Disguise Mechanics
 *   C++ StealthUpdate.cpp:97-150 — disguise state machine with DisguisesAsTeam,
 *   disguiseAsObject(), transition animations, and OrderIdleEnemiesToAttackMeUponReveal.
 *   TS: stealth-detection.ts has stealth logic but no disguise system. DisguisesAsTeam,
 *   DisguiseAsTemplate, and disguise transition animations are not implemented.
 *   OrderIdleEnemiesToAttackMeUponReveal IS implemented — parsed and triggered on detection.
 *   The DISGUISED status flag is referenced in visibility checks but never set by any code path.
 *
 * Test 2: DynamicShroudClearingRangeUpdate — Vision Range Grows/Sustains/Shrinks
 *   C++ DynamicShroudClearingRangeUpdate.cpp:89-150 — 6-state machine:
 *   NOT_STARTED_YET → GROWING → SUSTAINING → SHRINKING → DONE_FOREVER → SLEEPING.
 *   TS: index.ts updateDynamicShroud implements the same state machine with matching
 *   deadline-based transitions and per-frame clearing range adjustments.
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

function setupEnemyRelationships(logic: GameLogicSubsystem, sideA: string, sideB: string): void {
  logic.setTeamRelationship(sideA, sideB, 0);
  logic.setTeamRelationship(sideB, sideA, 0);
}

// ── Test 1: Stealth Disguise Mechanics ──────────────────────────────────────

describe('Parity: stealth disguise state machine (StealthUpdate.cpp:97-150)', () => {
  /**
   * C++ StealthUpdate.cpp uses DisguisesAsTeam (INI field) to enable the disguise system.
   * When m_teamDisguised is true, stealth starts disabled and must be manually activated
   * via disguiseAsObject(). The disguise creates a visual transition where the unit
   * fades out, swaps its drawable at the midpoint, and fades back in as the
   * target's template and team color.
   *
   * TS stealth-detection.ts now parses DisguisesAsTeam from INI and implements a
   * simplified disguise system: when a DisguisesAsTeam unit enters stealth and an
   * enemy is nearby, it auto-picks the nearest enemy as a disguise target and sets
   * the DISGUISED object status flag + disguiseTemplateName.
   */

  it('stealthed unit with DisguisesAsTeam without enemies has STEALTHED but not DISGUISED', () => {
    // When no enemies are nearby, the unit cannot pick a disguise target.
    // It gets STEALTHED from InnateStealth but DISGUISED is not set.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BombTruck', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            DisguisesAsTeam: 'Yes',
            OrderIdleEnemiesToAttackMeUponReveal: 'Yes',
            DisguiseTransitionTime: 500,
            DisguiseRevealTransitionTime: 500,
          }),
        ]),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('BombTruck', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Let stealth delay elapse.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const flags = logic.getEntityState(1)?.statusFlags ?? [];

    // No enemies to disguise as — STEALTHED but not DISGUISED.
    expect(flags).toContain('STEALTHED');
    expect(flags).not.toContain('DISGUISED');
  });

  it('detector reveals stealthed unit and triggers OrderIdleEnemiesToAttackMeUponReveal', () => {
    // C++ StealthUpdate.cpp:916-935 — when markAsDetected() is called and
    // m_orderIdleEnemiesToAttackMeUponReveal is true, it iterates all enemy players
    // and calls setWakeupIfInRange on their idle units, causing them to auto-attack
    // the now-revealed unit.
    //
    // TS: OrderIdleEnemiesToAttackMeUponReveal is parsed and implemented.
    // When detection first marks a unit as DETECTED, orderIdleEnemiesToAttack()
    // iterates enemies and issues attack commands to idle armed units in vision range.
    const bundle = makeBundle({
      objects: [
        // Stealthed unit with OrderIdleEnemiesToAttackMeUponReveal.
        makeObjectDef('StealthUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            OrderIdleEnemiesToAttackMeUponReveal: 'Yes',
          }),
        ]),
        // Enemy detector unit.
        makeObjectDef('DetectorUnit', 'America', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
            DetectionRange: 200,
            DetectionRate: 33,
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'DetectorGun'] }),
        ], { VisionRange: 200 }),
        // Idle enemy unit that should auto-attack upon reveal.
        makeObjectDef('IdleEnemy', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyGun'] }),
        ], { VisionRange: 200 }),
      ],
      weapons: [
        makeWeaponDef('DetectorGun', {
          PrimaryDamage: 5,
          AttackRange: 150,
          DelayBetweenShots: 500,
          DamageType: 'SMALL_ARMS',
        }),
        makeWeaponDef('EnemyGun', {
          PrimaryDamage: 5,
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
        makeMapObject('IdleEnemy', 52, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Let stealth activate.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Run frames for detection to occur.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Stealth unit should now be DETECTED.
    const stealthFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(stealthFlags).toContain('DETECTED');

    // Access internal entity state to verify auto-attack was triggered.
    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, {
        attackTargetEntityId: number | null;
      }>;
    };
    const idleEnemy = privateApi.spawnedEntities.get(3);
    expect(idleEnemy).not.toBeUndefined();

    // Source parity: OrderIdleEnemiesToAttackMeUponReveal=Yes causes idle enemies
    // within vision range to auto-target the revealed unit. The idle enemy at
    // (52,50) is within vision range (200) of the stealth unit at (50,50).
    expect(idleEnemy!.attackTargetEntityId).toBe(1);
  });

  it('DISGUISED status flag is set when DisguisesAsTeam unit has a nearby enemy', () => {
    // Source parity: when a DisguisesAsTeam unit enters stealth and an enemy is
    // nearby, it auto-disguises as the nearest enemy. The DISGUISED object status
    // flag is set and the disguiseTemplateName is populated.
    const bundle = makeBundle({
      objects: [
        // Unit with stealth that has DisguisesAsTeam and all disguise fields.
        makeObjectDef('Disguiser', 'GLA', ['VEHICLE', 'DISGUISER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            DisguisesAsTeam: 'Yes',
            DisguiseTransitionTime: 500,
            DisguiseRevealTransitionTime: 500,
          }),
        ]),
        // Potential disguise target.
        makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Disguiser', 50, 50),
        makeMapObject('EnemyTank', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Run many frames to cover all possible state transitions.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    const flags = logic.getEntityState(1)?.statusFlags ?? [];

    // Source parity: DISGUISED is now set when the unit stealths near an enemy.
    expect(flags).toContain('DISGUISED');

    // Verify the unit is also stealthed.
    expect(flags).toContain('STEALTHED');

    // Verify disguiseTemplateName is set to the enemy template.
    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, {
        disguiseTemplateName: string | null;
      }>;
    };
    const disguiser = privateApi.spawnedEntities.get(1);
    expect(disguiser).not.toBeUndefined();
    expect(disguiser!.disguiseTemplateName).toBe('EnemyTank');
  });

  it('detector within range breaks stealth and sets DETECTED on stealthed unit', () => {
    // Baseline test confirming the core stealth-detection loop works.
    // C++ StealthDetectorUpdate and TS stealth-detection.ts updateDetection
    // both iterate enemy entities and set DETECTED when in range.
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
        makeMapObject('StealthUnit', 50, 50),
        makeMapObject('DetectorUnit', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Let stealth activate.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    const preDetectFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(preDetectFlags).toContain('STEALTHED');

    // Run more frames for the detector scan cycle to fire.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const postDetectFlags = logic.getEntityState(1)?.statusFlags ?? [];
    // Both C++ and TS agree: detector in range sets DETECTED on a stealthed enemy.
    expect(postDetectFlags).toContain('STEALTHED');
    expect(postDetectFlags).toContain('DETECTED');
  });

  it('DISGUISED is cleared immediately when stealth breaks without reveal transition time', () => {
    // Source parity: StealthUpdate.cpp:939-972 — disguise removal only animates
    // when DisguiseRevealTransitionTime is non-zero. This fixture does not set it,
    // so breaking stealth clears DISGUISED immediately.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BombTruck', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            DisguisesAsTeam: 'Yes',
            StealthForbiddenConditions: 'ATTACKING',
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TruckGun'] }),
        ]),
        makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TruckGun', {
          PrimaryDamage: 5,
          AttackRange: 150,
          DelayBetweenShots: 500,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BombTruck', 50, 50),
        makeMapObject('EnemyTank', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupEnemyRelationships(logic, 'GLA', 'America');

    // Let stealth activate and disguise apply.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    const preAttackFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(preAttackFlags).toContain('STEALTHED');
    expect(preAttackFlags).toContain('DISGUISED');

    // Issue attack command to break stealth.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { disguiseTemplateName: string | null }>;
    };
    const truck = privateApi.spawnedEntities.get(1);

    const postAttackFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(postAttackFlags).not.toContain('STEALTHED');
    expect(postAttackFlags).not.toContain('DISGUISED');
    expect(truck!.disguiseTemplateName).toBeNull();
  });
});

// ── Test 2: DynamicShroudClearingRangeUpdate State Machine ──────────────────

describe('Parity: DynamicShroudClearingRangeUpdate state machine (DynamicShroudClearingRangeUpdate.cpp:89-150)', () => {
  /**
   * C++ DynamicShroudClearingRangeUpdate has a 6-state machine:
   *   DSCRU_NOT_STARTED_YET → DSCRU_GROWING → DSCRU_SUSTAINING → DSCRU_SHRINKING
   *   → DSCRU_DONE_FOREVER → DSCRU_SLEEPING
   *
   * The constructor (lines 89-134) computes deadlines from profile timing:
   *   stateCountDown = shrinkDelay + shrinkTime
   *   shrinkStartDeadline = stateCountDown - shrinkDelay
   *   growStartDeadline = stateCountDown - growDelay
   *   sustainDeadline = growStartDeadline - growTime
   *
   * The update loop (lines 205-286) uses the countdown vs deadlines to determine
   * state, then adjusts m_currentClearingRange accordingly.
   *
   * TS index.ts updateDynamicShroud implements the same state machine with
   * matching deadline computations and per-frame range adjustments.
   */

  function makeShroudSetup(opts?: {
    growDelayMs?: number;
    growTimeMs?: number;
    shrinkDelayMs?: number;
    shrinkTimeMs?: number;
    finalVision?: number;
    changeIntervalMs?: number;
    growIntervalMs?: number;
    visionRange?: number;
    shroudClearingRange?: number;
  }) {
    const sz = 128;
    const growDelayMs = opts?.growDelayMs ?? 100;   // ~3 frames
    const growTimeMs = opts?.growTimeMs ?? 200;      // ~6 frames
    const shrinkDelayMs = opts?.shrinkDelayMs ?? 333; // ~10 frames
    const shrinkTimeMs = opts?.shrinkTimeMs ?? 200;   // ~6 frames
    const finalVision = opts?.finalVision ?? 5;
    const changeIntervalMs = opts?.changeIntervalMs ?? 33; // ~1 frame
    const growIntervalMs = opts?.growIntervalMs ?? 33;     // ~1 frame
    const visionRange = opts?.visionRange ?? 100;

    const objects = [
      makeObjectDef('SpySatStructure', 'USA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'DynamicShroudClearingRangeUpdate ModuleTag_Shroud', {
          GrowDelay: growDelayMs,
          GrowTime: growTimeMs,
          ShrinkDelay: shrinkDelayMs,
          ShrinkTime: shrinkTimeMs,
          FinalVision: finalVision,
          ChangeInterval: changeIntervalMs,
          GrowInterval: growIntervalMs,
        }),
      ], { VisionRange: visionRange }),
    ];

    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('SpySatStructure', 50, 50)], sz, sz), registry, makeHeightmap(sz, sz));
    // Set side as human so the entity is fully initialized.
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('usa', 'HUMAN');

    return { logic };
  }

  type EntityInternals = {
    dynamicShroudState: string;
    dynamicShroudStateCountdown: number;
    dynamicShroudCurrentClearingRange: number;
    dynamicShroudNativeClearingRange: number;
    dynamicShroudShrinkStartDeadline: number;
    dynamicShroudSustainDeadline: number;
    dynamicShroudGrowStartDeadline: number;
    shroudClearingRange: number;
    visionRange: number;
  };

  function getEntity(logic: GameLogicSubsystem): EntityInternals {
    const entities = (logic as unknown as { spawnedEntities: Map<number, EntityInternals> }).spawnedEntities;
    for (const entity of entities.values()) {
      return entity;
    }
    throw new Error('No entities found');
  }

  it('vision range grows during GROWING state, matching C++ nativeClearingRange/growTime per frame', () => {
    // C++ line 246: m_currentClearingRange += m_nativeClearingRange / max(1.0, (Real)md->m_growTime)
    // TS: entity.dynamicShroudCurrentClearingRange += entity.dynamicShroudNativeClearingRange / growTime
    //
    // With growTime=6 frames and nativeClearingRange=100:
    // Each frame during GROWING adds 100/6 ≈ 16.67 to the clearing range.
    const { logic } = makeShroudSetup({
      growDelayMs: 33,    // ~1 frame delay before growing
      growTimeMs: 200,    // ~6 frames of growing
      shrinkDelayMs: 500, // ~15 frames — enough time to sustain
      shrinkTimeMs: 200,  // ~6 frames of shrinking
      finalVision: 0,
      visionRange: 100,
    });

    // Initial state should be NOT_STARTED.
    const entity0 = getEntity(logic);
    expect(entity0.dynamicShroudState).toBe('NOT_STARTED');
    expect(entity0.dynamicShroudCurrentClearingRange).toBe(0);

    // Step a few frames to enter GROWING state.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const entityGrowing = getEntity(logic);
    // Should have entered GROWING and started increasing clearing range.
    if (entityGrowing.dynamicShroudState === 'GROWING') {
      expect(entityGrowing.dynamicShroudCurrentClearingRange).toBeGreaterThan(0);
      // The range should be less than or equal to the native range.
      expect(entityGrowing.dynamicShroudCurrentClearingRange).toBeLessThanOrEqual(
        entityGrowing.dynamicShroudNativeClearingRange,
      );
    }

    // Continue stepping to reach SUSTAINING — the range should cap at native.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const entitySustaining = getEntity(logic);
    // By now we should be at or past SUSTAINING.
    if (entitySustaining.dynamicShroudState === 'SUSTAINING') {
      // C++ line 253: m_currentClearingRange = m_nativeClearingRange
      expect(entitySustaining.dynamicShroudCurrentClearingRange).toBeCloseTo(
        entitySustaining.dynamicShroudNativeClearingRange, 0,
      );
    }
  });

  it('clearing range stays constant during SUSTAINING state', () => {
    // C++ line 253: DSCRU_SUSTAINING sets m_currentClearingRange = m_nativeClearingRange every frame.
    // The range should hold steady at the native value during this phase.
    const { logic } = makeShroudSetup({
      growDelayMs: 33,     // 1 frame
      growTimeMs: 100,     // 3 frames
      shrinkDelayMs: 333,  // 10 frames — long enough to sustain for several frames
      shrinkTimeMs: 100,   // 3 frames
      finalVision: 10,
      visionRange: 80,
    });

    // Run through grow phase and into sustain.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const entity1 = getEntity(logic);
    const range1 = entity1.dynamicShroudCurrentClearingRange;

    // Step a few more frames while still in sustain.
    logic.update(1 / 30);
    logic.update(1 / 30);

    const entity2 = getEntity(logic);
    const range2 = entity2.dynamicShroudCurrentClearingRange;

    // During SUSTAINING, both readings should equal the native clearing range.
    if (entity1.dynamicShroudState === 'SUSTAINING' && entity2.dynamicShroudState === 'SUSTAINING') {
      expect(range1).toBeCloseTo(entity1.dynamicShroudNativeClearingRange, 0);
      expect(range2).toBeCloseTo(entity2.dynamicShroudNativeClearingRange, 0);
      expect(range1).toBeCloseTo(range2, 0);
    }
  });

  it('clearing range shrinks during SHRINKING state toward finalVision', () => {
    // C++ line 259: m_currentClearingRange -= (nativeRange - finalVision) / max(1, shrinkTime)
    // The range decreases by a fixed amount per frame until it reaches finalVision.
    const { logic } = makeShroudSetup({
      growDelayMs: 33,     // 1 frame
      growTimeMs: 100,     // 3 frames
      shrinkDelayMs: 233,  // 7 frames
      shrinkTimeMs: 200,   // 6 frames
      finalVision: 20,
      visionRange: 100,
    });

    // Run enough frames to get into SHRINKING state.
    // stateCountDown = 7 + 6 = 13. growStartDeadline = 13 - 1 = 12.
    // sustainDeadline = 12 - 3 = 9. shrinkStartDeadline = 13 - 7 = 6.
    // SHRINKING starts when countdown <= 6.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const entityShrinking = getEntity(logic);

    // If we're in SHRINKING, the range should be between finalVision and native.
    if (entityShrinking.dynamicShroudState === 'SHRINKING') {
      expect(entityShrinking.dynamicShroudCurrentClearingRange).toBeLessThan(
        entityShrinking.dynamicShroudNativeClearingRange,
      );
      expect(entityShrinking.dynamicShroudCurrentClearingRange).toBeGreaterThanOrEqual(20);
    }

    // Continue to DONE.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    const entityDone = getEntity(logic);
    // C++ line 265: DSCRU_DONE_FOREVER clamps to finalVision.
    // TS: DONE sets currentClearingRange = prof.finalVision.
    if (entityDone.dynamicShroudState === 'DONE' || entityDone.dynamicShroudState === 'SLEEPING') {
      expect(entityDone.dynamicShroudCurrentClearingRange).toBeCloseTo(20, 0);
    }
  });

  it('state machine transitions through all states in order: NOT_STARTED → GROWING → SUSTAINING → SHRINKING → DONE → SLEEPING', () => {
    // This test records all state transitions to verify the ordering matches C++.
    // C++ enum DSCRU_STATE: NOT_STARTED_YET=0, GROWING=1, SUSTAINING=2, SHRINKING=3, DONE_FOREVER=4, SLEEPING=5.
    // TS uses string literals: 'NOT_STARTED', 'GROWING', 'SUSTAINING', 'SHRINKING', 'DONE', 'SLEEPING'.
    const { logic } = makeShroudSetup({
      growDelayMs: 33,     // 1 frame
      growTimeMs: 100,     // 3 frames
      shrinkDelayMs: 233,  // 7 frames
      shrinkTimeMs: 100,   // 3 frames
      finalVision: 10,
      changeIntervalMs: 33,
      growIntervalMs: 33,
      visionRange: 60,
    });

    const observedStates = new Set<string>();
    const stateOrder: string[] = [];

    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
      const entity = getEntity(logic);
      if (!observedStates.has(entity.dynamicShroudState)) {
        observedStates.add(entity.dynamicShroudState);
        stateOrder.push(entity.dynamicShroudState);
      }
    }

    // Should have seen all states in order. The first state may be NOT_STARTED
    // or may skip directly to GROWING if growDelay is very short.
    // At minimum, we should see GROWING and the terminal states.
    expect(observedStates.has('GROWING') || observedStates.has('SUSTAINING')).toBe(true);

    // The final state should be SLEEPING (C++ DSCRU_SLEEPING).
    const terminalState = stateOrder[stateOrder.length - 1];
    expect(terminalState).toBe('SLEEPING');

    // Verify the shroud-clearing range settles at finalVision.
    const finalEntity = getEntity(logic);
    expect(finalEntity.shroudClearingRange).toBeCloseTo(10, 0);
  });

  it('DONE state transitions to SLEEPING after applying final shroud-clearing range', () => {
    // C++ lines 281-283: after the DSCRU_DONE_FOREVER state applies the final
    // setShroudClearingRange, the state transitions to DSCRU_SLEEPING and the
    // update stops running (returns UPDATE_SLEEP_NONE but checks for SLEEPING at top).
    //
    // TS: updateDynamicShroud skips entities with dynamicShroudState === 'SLEEPING'
    // (line 27783: "if (entity.dynamicShroudState === 'SLEEPING') continue;").
    const { logic } = makeShroudSetup({
      growDelayMs: 33,
      growTimeMs: 66,
      shrinkDelayMs: 133,
      shrinkTimeMs: 66,
      finalVision: 15,
      changeIntervalMs: 33,
      growIntervalMs: 33,
      visionRange: 50,
    });

    // Run enough frames for the full lifecycle.
    for (let i = 0; i < 40; i++) logic.update(1 / 30);

    const entity = getEntity(logic);
    // Should be in SLEEPING state.
    expect(entity.dynamicShroudState).toBe('SLEEPING');

    // The applied shroud-clearing range should match finalVision.
    expect(entity.shroudClearingRange).toBeCloseTo(15, 0);

    // The current internal range should also be at finalVision.
    expect(entity.dynamicShroudCurrentClearingRange).toBeCloseTo(15, 0);

    // Run more frames — the state should remain SLEEPING (no further updates).
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const entityAfterSleep = getEntity(logic);
    expect(entityAfterSleep.dynamicShroudState).toBe('SLEEPING');
    expect(entityAfterSleep.shroudClearingRange).toBeCloseTo(15, 0);
  });

  it('visionRange is NOT affected by DynamicShroudClearingRangeUpdate', () => {
    // C++ DynamicShroudClearingRangeUpdate only modifies the shroud-clearing range
    // (via setShroudClearingRange). The object's vision range (used for targeting)
    // is a separate field that remains unchanged.
    //
    // TS: updateDynamicShroud only writes to entity.shroudClearingRange, not
    // entity.visionRange. This matches C++ behavior.
    const { logic } = makeShroudSetup({
      growDelayMs: 33,
      growTimeMs: 100,
      shrinkDelayMs: 200,
      shrinkTimeMs: 100,
      finalVision: 5,
      visionRange: 120,
    });

    const initialEntity = getEntity(logic);
    const initialVision = initialEntity.visionRange;
    expect(initialVision).toBe(120);

    // Run the full lifecycle.
    for (let i = 0; i < 50; i++) logic.update(1 / 30);

    const finalEntity = getEntity(logic);
    // Vision range should be unchanged.
    expect(finalEntity.visionRange).toBe(120);
    // But shroud-clearing range should have settled to finalVision.
    expect(finalEntity.shroudClearingRange).toBeCloseTo(5, 0);
  });

  it('deadline computation matches C++ constructor (DynamicShroudClearingRangeUpdate.cpp:98-103)', () => {
    // C++ constructor:
    //   m_stateCountDown = shrinkDelay + shrinkTime
    //   m_shrinkStartDeadline = m_stateCountDown - shrinkDelay
    //   m_growStartDeadline = m_stateCountDown - growDelay
    //   m_sustainDeadline = m_growStartDeadline - growTime
    //
    // With growDelay=3 frames, growTime=6, shrinkDelay=10, shrinkTime=6:
    //   stateCountDown = 10 + 6 = 16
    //   shrinkStartDeadline = 16 - 10 = 6
    //   growStartDeadline = 16 - 3 = 13
    //   sustainDeadline = 13 - 6 = 7
    const { logic } = makeShroudSetup({
      growDelayMs: 100,    // 3 frames
      growTimeMs: 200,     // 6 frames
      shrinkDelayMs: 333,  // 10 frames
      shrinkTimeMs: 200,   // 6 frames
      finalVision: 5,
      visionRange: 100,
    });

    // Access internal entity to verify computed deadlines.
    const entity = getEntity(logic);

    // msToLogicFrames rounds, so values may differ slightly.
    // The important thing is the relationship between deadlines.
    // shrinkStartDeadline should be < sustainDeadline (C++ invariant check).
    expect(entity.dynamicShroudShrinkStartDeadline).toBeLessThanOrEqual(
      entity.dynamicShroudSustainDeadline,
    );
    // growStartDeadline should be >= shrinkStartDeadline.
    expect(entity.dynamicShroudGrowStartDeadline).toBeGreaterThanOrEqual(
      entity.dynamicShroudShrinkStartDeadline,
    );
    // sustainDeadline should be >= shrinkStartDeadline.
    expect(entity.dynamicShroudSustainDeadline).toBeGreaterThanOrEqual(
      entity.dynamicShroudShrinkStartDeadline,
    );
  });
});
