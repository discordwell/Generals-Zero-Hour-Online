/**
 * Parity Tests -- death XP last-hit attribution and weapon auto-target prioritization.
 *
 * Source parity references:
 *   - ActiveBody.cpp:664-674 -- damager->scoreTheKill(obj); the damager (last hitter)
 *     is the ONLY entity that receives XP. No proportional split among all attackers.
 *   - Object.cpp:2956-2965 -- scoreTheKill calls getExperienceTracker()->addExperiencePoints(experienceValue)
 *     on the killer entity (this), passing the victim's experience value.
 *   - ExperienceTracker.cpp:61-68 -- getExperienceValue returns m_experienceValue[m_currentLevel]
 *     indexed by the VICTIM's level.
 *   - AIUpdate.cpp:4643 -- getNextMoodTarget calls TheAI->findClosestEnemy(obj, range, flags, attackInfo)
 *   - AI.cpp:587-679 -- findClosestEnemy: when no AttackPriorityInfo is set, calls
 *     getClosestObject (pure distance-based closest enemy). When AttackPriorityInfo is present,
 *     iterates NEAR_TO_FAR and picks the highest-priority-weighted target.
 *   - combat-targeting.ts:719-753 -- TS updateIdleAutoTargeting scans all enemies within
 *     scan range and picks the closest one (bestDistanceSqr comparison).
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  place,
} from './parity-agent.js';

import {
  LEVEL_REGULAR,
} from './experience.js';

// ---- Test 1: Death XP Goes to Last Hitter ----

describe('parity: death XP goes to last hitter (no proportional split)', () => {
  /**
   * C++ source: ActiveBody.cpp:664-674
   *
   * When an entity's health drops to 0, C++ calls:
   *   if (damager)
   *       damager->scoreTheKill(obj);
   *
   * scoreTheKill (Object.cpp:2914-2966) awards ALL the victim's ExperienceValue
   * to `this` (the damager / last hitter). There is no tracking of prior damage
   * sources and no proportional XP distribution.
   *
   * In the TS port: applyWeaponDamageAmount (index.ts:26871-26881) passes
   * sourceEntityId (the entity that dealt the killing blow) to markEntityDestroyed,
   * which flows to awardExperienceOnKill (entity-lifecycle.ts:1749-1804).
   * Only the attacker (last hitter) receives XP.
   *
   * Test: Two attackers (A and B) attack a target with 100 HP and ExperienceValue=[50,50,50,50].
   * Attacker A deals 80 damage (not fatal). Attacker B deals the killing blow (20 damage).
   * Verify B gets all 50 XP, A gets 0 XP.
   */

  it('last hitter gets all XP, first attacker gets none', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          // Attacker A: high damage weapon, will deal first hit but NOT kill
          makeObjectDef('AttackerA', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('WeakGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 40, 100, 200],
          }),
          // Attacker B: lower damage weapon, will deliver killing blow
          makeObjectDef('AttackerB', 'GLA', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('StrongGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 40, 100, 200],
          }),
          // Target: 100 HP, awards 50 XP at all levels
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], {
            ExperienceValue: [50, 50, 50, 50],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
        ],
        weapons: [
          // WeakGun: exactly 80 damage, should wound but not kill
          makeWeaponDef('WeakGun', {
            PrimaryDamage: 80,
            AttackRange: 200,
            DelayBetweenShots: 1000,
          }),
          // StrongGun: 100 damage, overkill on a 20 HP target (delivers killing blow)
          makeWeaponDef('StrongGun', {
            PrimaryDamage: 100,
            AttackRange: 200,
            DelayBetweenShots: 1000,
          }),
        ],
      },
      mapObjects: [
        place('AttackerA', 10, 10),   // id=1
        place('AttackerB', 10, 30),   // id=2
        place('Target', 50, 20),      // id=3
      ],
      mapSize: 64,
      sides: { America: {}, GLA: {}, China: {} },
      enemies: [['America', 'China'], ['GLA', 'China']],
    });

    // Verify initial state: both attackers at 0 XP
    const aBefore = agent.gameLogic.getEntityState(1);
    const bBefore = agent.gameLogic.getEntityState(2);
    expect(aBefore!.currentExperience).toBe(0);
    expect(bBefore!.currentExperience).toBe(0);

    // Attacker A attacks target first (80 damage, target goes to 20 HP)
    agent.attack(1, 3);
    agent.step(30);

    // Verify target is still alive with reduced health
    const targetAfterA = agent.entity(3);
    expect(targetAfterA).not.toBeNull();
    expect(targetAfterA!.alive).toBe(true);
    expect(targetAfterA!.health).toBeLessThanOrEqual(20);

    // Attacker A should have 0 XP (target not yet dead)
    const aAfterFirst = agent.gameLogic.getEntityState(1);
    expect(aAfterFirst!.currentExperience).toBe(0);

    // Stop attacker A so it doesn't also deal the killing blow
    agent.stop(1);

    // Attacker B now delivers the killing blow
    agent.attack(2, 3);
    agent.step(30);

    // Target should be dead
    const targetAfterB = agent.entity(3);
    expect(targetAfterB === null || !targetAfterB.alive).toBe(true);

    // Source parity: ONLY the last hitter (B) gets XP. A gets nothing.
    const aFinal = agent.gameLogic.getEntityState(1);
    const bFinal = agent.gameLogic.getEntityState(2);
    expect(aFinal!.currentExperience).toBe(0);  // A dealt 80% of damage, gets 0 XP
    expect(bFinal!.currentExperience).toBe(50); // B dealt killing blow, gets all 50 XP
  });

  it('sole attacker gets full XP (baseline: single attacker scenario)', () => {
    // Baseline test: verify that a single attacker that deals ALL damage gets the full XP.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
          makeObjectDef('Victim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], {
            ExperienceValue: [50, 50, 50, 50],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('BigGun', {
            PrimaryDamage: 200,
            AttackRange: 200,
            DelayBetweenShots: 1000,
          }),
        ],
      },
      mapObjects: [place('Killer', 10, 10), place('Victim', 50, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);
    agent.step(30);

    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    const killer = agent.gameLogic.getEntityState(1);
    expect(killer!.currentExperience).toBe(50);
  });

  it('multiple units attacking same target: only killer gets XP', () => {
    // Both A and B attack target simultaneously. Whichever deals the killing blow
    // gets ALL the XP. The other gets 0. This verifies the "no split" rule even
    // when both units are actively shooting.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('AttackerA', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('Gun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
          makeObjectDef('AttackerB', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('Gun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], {
            ExperienceValue: [50, 50, 50, 50],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('Gun', {
            PrimaryDamage: 30,
            AttackRange: 200,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [
        place('AttackerA', 10, 10),
        place('AttackerB', 10, 30),
        place('Target', 50, 20),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Both attack simultaneously
    agent.attack(1, 3);
    agent.attack(2, 3);
    agent.step(60);

    // Target should be dead
    const target = agent.entity(3);
    expect(target === null || !target.alive).toBe(true);

    // Source parity: exactly ONE attacker gets all 50 XP, the other gets 0.
    // We don't know which one fires the killing shot, but the total must be 50,
    // and one of them must have 0.
    const aXp = agent.gameLogic.getEntityState(1)!.currentExperience;
    const bXp = agent.gameLogic.getEntityState(2)!.currentExperience;

    // Total XP awarded must equal ExperienceValue (50), not doubled
    expect(aXp + bXp).toBe(50);
    // Exactly one got all the XP
    expect(aXp === 50 || bXp === 50).toBe(true);
    expect(aXp === 0 || bXp === 0).toBe(true);
  });
});

// ---- Test 2: Auto-Target Closest Enemy ----

describe('parity: auto-target closest enemy', () => {
  /**
   * C++ source: AI.cpp:587-679 -- findClosestEnemy
   *
   * When no AttackPriorityInfo is set (the common case for idle auto-targeting),
   * C++ calls:
   *   Object* o = ThePartitionManager->getClosestObject(me, range, FROM_BOUNDINGSPHERE_2D, filters);
   *   return o;
   *
   * This picks the spatially closest enemy that passes all filter checks.
   * There is no priority weighting beyond distance when AttackPriorityInfo is NULL.
   *
   * When AttackPriorityInfo IS set, C++ iterates NEAR_TO_FAR and picks the
   * highest priority target (see lines 682-700), but this is a scripting/team
   * configuration -- the default auto-acquire path uses pure distance.
   *
   * TS source: combat-targeting.ts:719-753 -- updateIdleAutoTargeting
   *   Iterates all enemies within scan range and picks the one with
   *   the smallest distanceSqr (bestDistanceSqr comparison). This matches
   *   the C++ default (no priority info) behavior exactly.
   */

  it('idle unit targets the closer of two enemies', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          // Armed unit that will auto-target
          makeObjectDef('Scout', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('ScoutGun'),
          ], { VisionRange: 200 }),
          // Close enemy at ~50 units distance
          makeObjectDef('CloseEnemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
          // Far enemy at ~80 units distance
          makeObjectDef('FarEnemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('ScoutGun', {
            PrimaryDamage: 10,
            AttackRange: 150,
            DelayBetweenShots: 500,
          }),
        ],
      },
      // Scout at (100,100), CloseEnemy at (150,100) = 50 units, FarEnemy at (180,100) = 80 units.
      // Both within weapon range (150) and vision range (200).
      mapObjects: [
        place('Scout', 100, 100),       // id=1
        place('CloseEnemy', 150, 100),   // id=2, distance=50
        place('FarEnemy', 180, 100),     // id=3, distance=80
      ],
      mapSize: 256,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // NO explicit attack command -- rely on idle auto-targeting.
    // Step enough frames for auto-target scan (default interval ~60 frames)
    // plus time for at least one shot.
    agent.step(120);

    // Check which enemy took damage.
    // Source parity: the closest enemy (CloseEnemy at distance=50) should be targeted first.
    const closeEnemy = agent.entity(2);
    const farEnemy = agent.entity(3);

    expect(closeEnemy).not.toBeNull();
    expect(farEnemy).not.toBeNull();

    // Close enemy should have taken damage (auto-targeted first)
    expect(closeEnemy!.health).toBeLessThan(500);

    // Far enemy should NOT have taken damage yet (not the auto-target)
    // NOTE: This may fail if close enemy is killed first and unit retargets.
    // With 500 HP and 10 damage per shot, close enemy survives 120 frames easily.
    expect(farEnemy!.health).toBe(500);
  });

  it('auto-targeting selects the closer enemy even when placed on the opposite side', () => {
    // Verify that direction doesn't matter -- only distance.
    // Scout in center, enemies on opposite sides, closer one should be targeted.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Scout', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('ScoutGun'),
          ], { VisionRange: 200 }),
          // Enemy A at distance ~30 (to the left)
          makeObjectDef('EnemyA', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
          // Enemy B at distance ~70 (to the right)
          makeObjectDef('EnemyB', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('ScoutGun', {
            PrimaryDamage: 10,
            AttackRange: 150,
            DelayBetweenShots: 500,
          }),
        ],
      },
      // Scout at (100,100), EnemyA at (70,100) = 30 units left, EnemyB at (170,100) = 70 units right
      mapObjects: [
        place('Scout', 100, 100),    // id=1
        place('EnemyA', 70, 100),    // id=2, distance=30 (closer)
        place('EnemyB', 170, 100),   // id=3, distance=70 (farther)
      ],
      mapSize: 256,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Let idle auto-targeting kick in
    agent.step(120);

    const enemyA = agent.entity(2);
    const enemyB = agent.entity(3);

    expect(enemyA).not.toBeNull();
    expect(enemyB).not.toBeNull();

    // Enemy A (closer at distance=30) should be targeted
    expect(enemyA!.health).toBeLessThan(500);

    // Enemy B (farther at distance=70) should be untouched
    expect(enemyB!.health).toBe(500);
  });

  it('documents: auto-targeting uses pure distance with no priority weighting by default', () => {
    /**
     * C++ source: AI.cpp:675-679
     *
     * When AttackPriorityInfo is NULL (the default for idle auto-acquire):
     *   if (info == NULL || info == TheScriptEngine->getDefaultAttackInfo())
     *   {
     *       Object* o = ThePartitionManager->getClosestObject(me, range, ...);
     *       return o;
     *   }
     *
     * The TS port (combat-targeting.ts:719-753) mirrors this: it iterates all
     * enemies and picks the one with smallest distanceSqr. There is no type-based
     * priority, threat level, or damage-dealt weighting.
     *
     * Priority weighting only activates when:
     *   1. A team has AttackPriorityInfo set via script (AI.cpp:682-700)
     *   2. The target has non-zero priority in the AttackPriorityInfo table
     *
     * This test verifies the default behavior by placing a "high value" target
     * (building with lots of HP) farther away and a "low value" target (infantry
     * with little HP) closer. The unit should target the closer one regardless
     * of perceived value.
     */
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Scout', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('ScoutGun'),
          ], { VisionRange: 200 }),
          // Low-value close target (infantry, 50 HP)
          makeObjectDef('CloseInfantry', 'China', ['INFANTRY'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ]),
          // High-value far target (structure, 5000 HP)
          makeObjectDef('FarBuilding', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('ScoutGun', {
            PrimaryDamage: 10,
            AttackRange: 150,
            DelayBetweenShots: 500,
          }),
        ],
      },
      mapObjects: [
        place('Scout', 100, 100),          // id=1
        place('CloseInfantry', 130, 100),   // id=2, distance=30 (closer, low value)
        place('FarBuilding', 180, 100),     // id=3, distance=80 (farther, high value)
      ],
      mapSize: 256,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.step(120);

    const closeTarget = agent.entity(2);
    const farTarget = agent.entity(3);

    expect(closeTarget).not.toBeNull();
    expect(farTarget).not.toBeNull();

    // Source parity: distance-only targeting means closer infantry is targeted,
    // not the farther building, despite the building being a "bigger" target.
    expect(closeTarget!.health).toBeLessThan(50);
    expect(farTarget!.health).toBe(5000);
  });
});
