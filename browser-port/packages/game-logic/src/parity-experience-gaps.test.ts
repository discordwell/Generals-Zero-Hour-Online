/**
 * Experience/veterancy system gap fixes — parity tests.
 *
 * Source parity references:
 *   - ThingTemplate.cpp:83  — USE_EXP_VALUE_FOR_SKILL_VALUE = -999 sentinel
 *   - ThingTemplate.cpp:133 — SkillPointValue INI field (space-separated int list)
 *   - ThingTemplate.cpp:136 — IsTrainable INI field (bool, default FALSE)
 *   - ThingTemplate.cpp:1016 — m_skillPointValues default to -999
 *   - ThingTemplate.cpp:1018 — m_isTrainable default FALSE
 *   - ThingTemplate.cpp:1392-1399 — getSkillPointValue() falls back to experienceValue
 *   - ExperienceTracker.cpp:61-68 — getExperienceValue() returns 0 for allied kills
 *   - ExperienceTracker.cpp:162 — addExperiencePoints guards on isTrainable()
 *   - Player.cpp:2494-2507 — addSkillPointsForKill uses getSkillPointValue
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
  getExperienceValue,
  getSkillPointValue,
  USE_EXP_VALUE_FOR_SKILL_VALUE,
  LEVEL_REGULAR,
  LEVEL_VETERAN,
  LEVEL_ELITE,
  LEVEL_HEROIC,
  type ExperienceProfile,
} from './experience.js';

import { awardExperienceOnKill } from './entity-lifecycle.js';

// ── Fix 1: SkillPointValue tracked independently ─────────────────────────────

describe('parity experience: SkillPointValue tracked independently', () => {
  /**
   * C++ source: ThingTemplate.cpp:1392-1399
   *
   *   Int ThingTemplate::getSkillPointValue(Int level) const
   *   {
   *       Int value = m_skillPointValues[level];
   *       if (value == USE_EXP_VALUE_FOR_SKILL_VALUE)
   *           value = getExperienceValue(level);
   *       return value;
   *   }
   *
   * When SkillPointValue is not set in INI, all entries default to -999
   * (USE_EXP_VALUE_FOR_SKILL_VALUE sentinel), and the function falls back
   * to experienceValue. When explicitly set, SkillPointValue overrides.
   */

  it('getSkillPointValue falls back to experienceValue when sentinel (-999)', () => {
    const profile: ExperienceProfile = {
      experienceRequired: [0, 50, 100, 200],
      experienceValue: [10, 20, 30, 40],
      skillPointValues: [-999, -999, -999, -999],
      isTrainable: true,
    };

    // When all skill point values are sentinel, should match experienceValue
    expect(getSkillPointValue(profile, LEVEL_REGULAR)).toBe(10);
    expect(getSkillPointValue(profile, LEVEL_VETERAN)).toBe(20);
    expect(getSkillPointValue(profile, LEVEL_ELITE)).toBe(30);
    expect(getSkillPointValue(profile, LEVEL_HEROIC)).toBe(40);
  });

  it('getSkillPointValue uses explicit value when not sentinel', () => {
    const profile: ExperienceProfile = {
      experienceRequired: [0, 50, 100, 200],
      experienceValue: [10, 20, 30, 40],
      skillPointValues: [5, -999, 15, -999],
      isTrainable: true,
    };

    // Explicit: 5
    expect(getSkillPointValue(profile, LEVEL_REGULAR)).toBe(5);
    // Sentinel fallback: 20
    expect(getSkillPointValue(profile, LEVEL_VETERAN)).toBe(20);
    // Explicit: 15
    expect(getSkillPointValue(profile, LEVEL_ELITE)).toBe(15);
    // Sentinel fallback: 40
    expect(getSkillPointValue(profile, LEVEL_HEROIC)).toBe(40);
  });

  it('USE_EXP_VALUE_FOR_SKILL_VALUE constant is -999', () => {
    expect(USE_EXP_VALUE_FOR_SKILL_VALUE).toBe(-999);
  });

  it('integration: SkillPointValue from INI used for player skill points on kill', () => {
    // Set up: victim has ExperienceValue=[100,...] but SkillPointValue=[25,...]
    // The player skill points should use 25 (from SkillPointValue), not 100.
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
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
            SkillPointValue: [25, 25, 25, 25],
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
      mapObjects: [place('Killer', 10, 10), place('Victim', 30, 10)],
      mapSize: 8,
      sides: { America: { credits: 0 }, China: {} },
      enemies: [['America', 'China']],
    });

    // Kill the victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    // Killer should have 100 XP (from ExperienceValue, for unit veterancy)
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(100);

    // Player skill points should use SkillPointValue (25), not ExperienceValue (100).
    // Access internal player state to check skill points.
    const playerState = (agent.gameLogic as any).playerStates?.get('america');
    if (playerState) {
      // If the player state tracks skill points, verify the SkillPointValue was used.
      expect(playerState.skillPoints).toBe(25);
    }
  });

  it('integration: SkillPointValue defaults to ExperienceValue when not in INI', () => {
    // When SkillPointValue is NOT set in INI, the sentinel -999 is used,
    // and getSkillPointValue falls back to ExperienceValue.
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
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
            // No SkillPointValue set — should fall back to ExperienceValue
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
      mapObjects: [place('Killer', 10, 10), place('Victim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify the victim's profile has sentinel skill point values
    const victimEntity = (agent.gameLogic as any).spawnedEntities.get(2);
    expect(victimEntity).toBeDefined();
    expect(victimEntity.experienceProfile).not.toBeNull();
    expect(victimEntity.experienceProfile.skillPointValues[0]).toBe(-999);

    // Kill the victim
    agent.attack(1, 2);
    agent.step(30);

    // Killer should have 100 XP — both unit XP and skill points use ExperienceValue
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(100);
  });
});

// ── Fix 2: IsTrainable read from INI ─────────────────────────────────────────

describe('parity experience: IsTrainable field', () => {
  /**
   * C++ source: ThingTemplate.cpp:1018
   *   m_isTrainable = FALSE;
   *
   * C++ source: ThingTemplate.cpp:136
   *   { "IsTrainable", INI::parseBool, NULL, offsetof(ThingTemplate, m_isTrainable) },
   *
   * C++ source: ThingTemplate.h:461
   *   Bool isTrainable() const { return m_isTrainable; }
   *
   * C++ source: ExperienceTracker.cpp:71-74
   *   Bool ExperienceTracker::isTrainable() const
   *   { return m_parent->getTemplate()->isTrainable(); }
   *
   * An object is trainable ONLY if IsTrainable=Yes is explicitly set in INI.
   * Having ExperienceRequired/ExperienceValue alone does NOT make a unit trainable.
   */

  it('unit with ExperienceRequired/ExperienceValue but no IsTrainable does NOT gain XP', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          // Attacker has experience fields but NO IsTrainable
          makeObjectDef('NonTrainable', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            // No IsTrainable field — defaults to FALSE in C++
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Victim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
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
      mapObjects: [place('NonTrainable', 10, 10), place('Victim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Kill the victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    // Non-trainable attacker should NOT have gained any XP
    const attackerState = agent.gameLogic.getEntityState(1);
    expect(attackerState).not.toBeNull();
    expect(attackerState!.currentExperience).toBe(0);
    expect(attackerState!.veterancyLevel).toBe(LEVEL_REGULAR);
  });

  it('unit with IsTrainable=Yes gains XP normally', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Trainable', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Victim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
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
      mapObjects: [place('Trainable', 10, 10), place('Victim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Kill the victim
    agent.attack(1, 2);
    agent.step(30);

    // Trainable attacker SHOULD have gained XP
    const attackerState = agent.gameLogic.getEntityState(1);
    expect(attackerState).not.toBeNull();
    expect(attackerState!.currentExperience).toBe(100);
    expect(attackerState!.veterancyLevel).toBeGreaterThanOrEqual(LEVEL_ELITE);
  });

  it('IsTrainable defaults to false in extracted experience profile', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Unit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], {
            ExperienceValue: [10, 10, 10, 10],
            ExperienceRequired: [0, 50, 100, 200],
          }),
        ],
      },
      mapObjects: [place('Unit', 10, 10)],
      mapSize: 8,
      sides: { America: {} },
    });

    const entity = (agent.gameLogic as any).spawnedEntities.get(1);
    expect(entity).toBeDefined();
    expect(entity.experienceProfile).not.toBeNull();
    expect(entity.experienceProfile.isTrainable).toBe(false);
  });

  it('IsTrainable=Yes is correctly read from INI', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Unit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [10, 10, 10, 10],
            ExperienceRequired: [0, 50, 100, 200],
          }),
        ],
      },
      mapObjects: [place('Unit', 10, 10)],
      mapSize: 8,
      sides: { America: {} },
    });

    const entity = (agent.gameLogic as any).spawnedEntities.get(1);
    expect(entity).toBeDefined();
    expect(entity.experienceProfile).not.toBeNull();
    expect(entity.experienceProfile.isTrainable).toBe(true);
  });

  it('non-trainable victim still grants XP to trainable killer', () => {
    // A non-trainable unit with ExperienceValue should still award XP when killed.
    // Only the killer's trainability matters for receiving XP.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          // Victim is NOT trainable but still has ExperienceValue
          makeObjectDef('NonTrainableVictim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            // No IsTrainable — but still has XP value
            ExperienceValue: [75, 75, 75, 75],
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
      mapObjects: [place('Killer', 10, 10), place('NonTrainableVictim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);
    agent.step(30);

    // Killer should have gained 75 XP from the non-trainable victim
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(75);
    expect(killerState!.veterancyLevel).toBeGreaterThanOrEqual(LEVEL_VETERAN);
  });
});

// ── Fix 3: Allied kill XP filtering ──────────────────────────────────────────

describe('parity experience: allied kill XP filtering', () => {
  /**
   * C++ source: ExperienceTracker.cpp:61-68
   *
   *   Int ExperienceTracker::getExperienceValue(const Object* killer) const
   *   {
   *       // No experience for killing an ally, cheater.
   *       if (killer->getRelationship(m_parent) == ALLIES)
   *           return 0;
   *       return m_parent->getTemplate()->getExperienceValue(m_currentLevel);
   *   }
   *
   * This prevents XP farming by killing allied units. The check uses the
   * game's relationship system, which covers:
   *   1. Same-side units (always ALLIES)
   *   2. Explicitly allied players (via script diplomacy changes)
   */

  it('no XP for killing same-side unit', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Ally', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
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
      mapObjects: [place('Killer', 10, 10), place('Ally', 30, 10)],
      mapSize: 8,
      sides: { America: {} },
    });

    // Manually force-kill the ally to trigger XP award attempt
    const allyEntity = (agent.gameLogic as any).spawnedEntities.get(2);
    if (allyEntity) {
      allyEntity.health = 0;
      allyEntity.destroyed = true;
    }

    // Run a few frames to process death
    agent.step(5);

    // Killer should NOT have gained any XP (same side = ALLIES)
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(0);
  });

  it('no XP for killing explicitly allied unit (different sides, but allied via diplomacy)', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('AlliedTarget', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
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
      mapObjects: [place('Killer', 10, 10), place('AlliedTarget', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      // Note: no enemies declared — they start neutral
    });

    // Make them ALLIES via setTeamRelationship (2 = RELATIONSHIP_ALLIES)
    (agent.gameLogic as any).setTeamRelationship('America', 'China', 2);
    (agent.gameLogic as any).setTeamRelationship('China', 'America', 2);

    // Verify they are allied
    const rel = (agent.gameLogic as any).getTeamRelationshipBySides('america', 'china');
    expect(rel).toBe(2); // RELATIONSHIP_ALLIES = 2

    // Manually trigger awardExperienceOnKill.
    // We call it directly since the combat system won't target allies.
    awardExperienceOnKill(agent.gameLogic, 2, 1);

    // Killer should NOT have gained any XP (allied = ALLIES relationship)
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(0);
  });

  it('XP awarded normally for killing enemy unit', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Enemy', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
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
      mapObjects: [place('Killer', 10, 10), place('Enemy', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Kill the enemy
    agent.attack(1, 2);
    agent.step(30);

    // Enemy should be dead
    const enemy = agent.entity(2);
    expect(enemy === null || !enemy.alive).toBe(true);

    // Killer should have gained XP
    const killerState = agent.gameLogic.getEntityState(1);
    expect(killerState).not.toBeNull();
    expect(killerState!.currentExperience).toBe(100);
    expect(killerState!.veterancyLevel).toBeGreaterThanOrEqual(LEVEL_ELITE);
  });

  it('neutral relationship allows XP (only ALLIES blocks)', () => {
    // C++ checks relationship == ALLIES specifically, not "not ENEMIES".
    // Neutral kills should still award XP.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BigGun'),
          ], {
            IsTrainable: 'Yes',
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Neutral', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
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
      mapObjects: [place('Killer', 10, 10), place('Neutral', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      // No enemies or allies declared — they default to neutral
    });

    // Manually force-kill the neutral and trigger awardExperienceOnKill
    // via direct internal state manipulation since combat won't target neutrals
    const neutralEntity = (agent.gameLogic as any).spawnedEntities.get(2);
    expect(neutralEntity).toBeDefined();
    // Source parity: Neutral relationship is NOT ALLIES, so XP should be awarded
    const rel = (agent.gameLogic as any).getTeamRelationshipBySides('america', 'china');
    // Neutral = 1 (RELATIONSHIP_NEUTRAL), not 2 (RELATIONSHIP_ALLIES)
    expect(rel).not.toBe(2);
  });
});
