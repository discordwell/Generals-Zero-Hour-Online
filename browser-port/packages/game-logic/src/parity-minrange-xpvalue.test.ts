/**
 * Parity Tests — weapon minimum attack range enforcement & experience value scaling.
 *
 * Source parity references:
 *   - Weapon.cpp:176,465-475 — MinimumAttackRange prevents firing at targets closer than this distance
 *   - combat-update.ts:161-175 — TS minAttackRange check, retreat logic
 *   - weapon-profiles.ts:66 — parses MinimumAttackRange from INI
 *   - ExperienceTracker.cpp:61-68 — getExperienceValue returns experienceValue[currentLevel]
 *   - experience.ts:65-70 — TS getExperienceValue function
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
  LEVEL_VETERAN,
  LEVEL_ELITE,
} from './experience.js';

// ── Test 1: Weapon Minimum Attack Range Enforcement ──────────────────────────

describe('parity: weapon minimum attack range enforcement', () => {
  /**
   * C++ source: Weapon.cpp:176,465-475
   *
   * When a weapon has MinimumAttackRange set, the attacker must not fire at
   * targets closer than that distance. In C++:
   *   if (distanceSqr < minAttackRangeSqr) { don't fire; retreat if mobile }
   *
   * TS source: combat-update.ts:161-175
   *   Checks distanceSqr < minAttackRangeSqr (with fudge factor), skips firing,
   *   and issues a retreat move for mobile units.
   */

  it('does NOT fire at a target within minimum attack range (stationary attacker)', () => {
    // Attacker is a STRUCTURE (no locomotor, cannot move).
    // MinimumAttackRange=100, AttackRange=200.
    // Target at distance ~20 (well within min range).
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('MinRangeArtillery', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LongRangeCannon'),
          ]),
          makeObjectDef('CloseEnemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('LongRangeCannon', {
            PrimaryDamage: 50,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            MinimumAttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      // Place attacker at (10,10) and enemy at (30,10) — distance = 20 units, well within min range of 100
      mapObjects: [place('MinRangeArtillery', 10, 10), place('CloseEnemy', 30, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Issue attack command
    agent.attack(1, 2);

    // Step 15 frames — plenty of time for shots if range were OK
    agent.step(15);

    // Target should NOT have taken any damage — it's inside minimum range
    const target = agent.entity(2);
    expect(target).not.toBeNull();
    expect(target!.health).toBe(200);
  });

  it('fires at a target between minimum and maximum attack range', () => {
    // MinimumAttackRange=40, AttackRange=200.
    // Target at distance ~100 (between min and max range).
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('MinRangeArtillery', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LongRangeCannon'),
          ]),
          makeObjectDef('FarEnemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('LongRangeCannon', {
            PrimaryDamage: 50,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            MinimumAttackRange: 40,
            DelayBetweenShots: 100,
          }),
        ],
      },
      // Place attacker at (10,10) and enemy at (110,10) — distance = 100 units,
      // safely between min range (40) and max range (200)
      mapObjects: [place('MinRangeArtillery', 10, 10), place('FarEnemy', 110, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);
    const before = agent.snapshot();
    agent.step(10);
    const d = agent.diff(before);

    // Target SHOULD have taken damage — it's within valid attack range
    const targetDamage = d.damaged.find((e) => e.id === 2);
    expect(targetDamage).toBeDefined();
    const actualDamage = targetDamage!.hpBefore - targetDamage!.hpAfter;
    expect(actualDamage).toBeGreaterThanOrEqual(50);
  });

  it('target at exactly min range boundary is blocked, but beyond boundary is allowed', () => {
    // Verify the boundary behavior: distance < minAttackRange → blocked,
    // distance > minAttackRange → allowed. This tests the fudge factor logic.
    //
    // Two separate runs with the same weapon but different distances.

    // Run A: target at distance 39 (< MinimumAttackRange 40) → should NOT fire
    const agentClose = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('MinRangeGun'),
          ]),
          makeObjectDef('Enemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('MinRangeGun', {
            PrimaryDamage: 50,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            MinimumAttackRange: 40,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 100, 100), place('Enemy', 139, 100)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agentClose.attack(1, 2);
    agentClose.step(15);
    const closeTarget = agentClose.entity(2);
    expect(closeTarget).not.toBeNull();
    expect(closeTarget!.health).toBe(200); // No damage — within min range

    // Run B: target at distance 60 (> MinimumAttackRange 40) → SHOULD fire
    const agentFar = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('MinRangeGun'),
          ]),
          makeObjectDef('Enemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('MinRangeGun', {
            PrimaryDamage: 50,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            MinimumAttackRange: 40,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 100, 100), place('Enemy', 160, 100)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agentFar.attack(1, 2);
    const farBefore = agentFar.snapshot();
    agentFar.step(15);
    const farDiff = agentFar.diff(farBefore);

    // Target SHOULD have taken damage — outside min range
    const farDamage = farDiff.damaged.find((e) => e.id === 2);
    expect(farDamage).toBeDefined();
    expect(farDamage!.hpBefore - farDamage!.hpAfter).toBeGreaterThanOrEqual(50);
  });
});

// ── Test 2: Experience Value Scales with Victim Veterancy Level ──────────────

describe('parity: experience value scales with victim veterancy level', () => {
  /**
   * C++ source: ExperienceTracker.cpp:61-68
   *
   *   Int ExperienceTracker::getExperienceValue(const Object *killer) const
   *   {
   *       return m_experienceValue[m_currentLevel];
   *   }
   *
   * The XP awarded is indexed by the VICTIM's current level, not the killer's.
   * Higher-level victims grant more XP.
   *
   * TS source: experience.ts:65-70
   *   return Math.max(0, Math.trunc(profile.experienceValue[victimLevel] ?? 0));
   */

  it('REGULAR victim awards ExperienceValue[0] XP', () => {
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
          makeObjectDef('RegularVictim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            // REGULAR=10, VETERAN=20, ELITE=30, HEROIC=40
            ExperienceValue: [10, 20, 30, 40],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('BigGun', {
            PrimaryDamage: 200,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Killer', 10, 10), place('RegularVictim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify victim starts at REGULAR
    const victimBefore = agent.gameLogic.getEntityState(2);
    expect(victimBefore).not.toBeNull();
    expect(victimBefore!.veterancyLevel).toBe(LEVEL_REGULAR);

    // Kill the REGULAR victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victimAfter = agent.entity(2);
    expect(victimAfter === null || !victimAfter.alive).toBe(true);

    // Killer should have received ExperienceValue[REGULAR] = 10 XP
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(10);
  });

  it('VETERAN victim awards ExperienceValue[1] XP (more than REGULAR)', () => {
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
          makeObjectDef('VeteranVictim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            // REGULAR=10, VETERAN=20, ELITE=30, HEROIC=40
            ExperienceValue: [10, 20, 30, 40],
            ExperienceRequired: [0, 100, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('BigGun', {
            PrimaryDamage: 200,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Killer', 10, 10), place('VeteranVictim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Manually promote victim to VETERAN before combat
    const victimEntity = (agent.gameLogic as any).spawnedEntities.get(2);
    expect(victimEntity).toBeDefined();
    victimEntity.experienceState.currentLevel = LEVEL_VETERAN;
    victimEntity.experienceState.currentExperience = 100;

    // Verify victim is VETERAN
    const victimState = agent.gameLogic.getEntityState(2);
    expect(victimState).not.toBeNull();
    expect(victimState!.veterancyLevel).toBe(LEVEL_VETERAN);

    // Kill the VETERAN victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victimAfter = agent.entity(2);
    expect(victimAfter === null || !victimAfter.alive).toBe(true);

    // Killer should have received ExperienceValue[VETERAN] = 20 XP
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(20);
  });

  it('ELITE victim awards ExperienceValue[2] XP (more than VETERAN)', () => {
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
          makeObjectDef('EliteVictim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [10, 20, 30, 40],
            ExperienceRequired: [0, 100, 200, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('BigGun', {
            PrimaryDamage: 200,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Killer', 10, 10), place('EliteVictim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Manually promote victim to ELITE
    const victimEntity = (agent.gameLogic as any).spawnedEntities.get(2);
    expect(victimEntity).toBeDefined();
    victimEntity.experienceState.currentLevel = LEVEL_ELITE;
    victimEntity.experienceState.currentExperience = 200;

    // Verify victim is ELITE
    const victimState = agent.gameLogic.getEntityState(2);
    expect(victimState).not.toBeNull();
    expect(victimState!.veterancyLevel).toBe(LEVEL_ELITE);

    // Kill the ELITE victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victimAfter = agent.entity(2);
    expect(victimAfter === null || !victimAfter.alive).toBe(true);

    // Killer should have received ExperienceValue[ELITE] = 30 XP
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(30);
  });

  it('XP from multiple kills accumulates correctly with different victim levels', () => {
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
          makeObjectDef('Victim1', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [10, 20, 30, 40],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
          makeObjectDef('Victim2', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [10, 20, 30, 40],
            ExperienceRequired: [0, 100, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('BigGun', {
            PrimaryDamage: 200,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [
        place('Killer', 10, 10),
        place('Victim1', 30, 10),   // REGULAR — will award 10 XP
        place('Victim2', 50, 10),   // Will be promoted to VETERAN — will award 20 XP
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Promote Victim2 to VETERAN
    const victim2Entity = (agent.gameLogic as any).spawnedEntities.get(3);
    expect(victim2Entity).toBeDefined();
    victim2Entity.experienceState.currentLevel = LEVEL_VETERAN;
    victim2Entity.experienceState.currentExperience = 100;

    // Kill Victim1 (REGULAR, awards 10 XP)
    agent.attack(1, 2);
    agent.step(30);

    const victim1After = agent.entity(2);
    expect(victim1After === null || !victim1After.alive).toBe(true);

    const killerAfterFirst = agent.gameLogic.getEntityState(1);
    expect(killerAfterFirst).not.toBeNull();
    expect(killerAfterFirst!.currentExperience).toBe(10);

    // Kill Victim2 (VETERAN, awards 20 XP)
    agent.attack(1, 3);
    agent.step(30);

    const victim2After = agent.entity(3);
    expect(victim2After === null || !victim2After.alive).toBe(true);

    // Total XP: 10 (REGULAR) + 20 (VETERAN) = 30
    const killerAfterSecond = agent.gameLogic.getEntityState(1);
    expect(killerAfterSecond).not.toBeNull();
    expect(killerAfterSecond!.currentExperience).toBe(30);
  });
});
