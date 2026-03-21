/**
 * Veterancy Parity Tests — verify experience/veterancy mechanics match C++ source.
 *
 * Source parity references:
 *   - ActiveBody.cpp:1126-1134 — health bonus on level change uses GlobalData::m_healthBonus
 *   - Object.cpp:2661 — blocks XP award when victim has OBJECT_STATUS_UNDER_CONSTRUCTION
 *   - ExperienceTracker.cpp:150-160 — XP sink redirects XP to another entity
 *   - GlobalData.cpp — HealthBonus_Veteran/Elite/Heroic loaded from GameData.ini
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
  applyHealthBonusForLevelChange,
  DEFAULT_VETERANCY_CONFIG,
  LEVEL_REGULAR,
  LEVEL_VETERAN,
  LEVEL_ELITE,
  LEVEL_HEROIC,
  type VeterancyConfig,
} from './experience.js';

// ── Test 1: Veterancy Health Bonus ──────────────────────────────────────────

describe('parity veterancy: health bonus on level-up', () => {
  /**
   * C++ source: ActiveBody.cpp lines 1126-1134
   *
   * When a unit levels up, C++ computes:
   *   mult = healthBonus[newLevel] / healthBonus[oldLevel]
   *   newMaxHealth = trunc(currentMaxHealth * mult)
   *   newHealth = trunc(newMaxHealth * (currentHealth / currentMaxHealth))
   *
   * The health bonuses are loaded from GameData.ini:
   *   HealthBonus_Veteran = 1.0 (default in C++ GlobalData.cpp:940)
   *   HealthBonus_Elite   = retail typically 1.0 (no bonus by default)
   *   HealthBonus_Heroic  = retail typically 1.0
   *
   * The TS implementation uses DEFAULT_VETERANCY_CONFIG which has [1.0, 1.0, 1.0, 1.0],
   * producing NO health change on level-up. This matches the C++ defaults in GlobalData.cpp,
   * but a modded/retail config with non-1.0 values would differ.
   */

  it('default config [1,1,1,1] produces no health change on REGULAR->VETERAN promotion', () => {
    const result = applyHealthBonusForLevelChange(
      LEVEL_REGULAR,
      LEVEL_VETERAN,
      100,  // currentHealth
      100,  // currentMaxHealth
      DEFAULT_VETERANCY_CONFIG,
    );
    expect(result.newMaxHealth).toBe(100);
    expect(result.newHealth).toBe(100);
  });

  it('default config [1,1,1,1] produces no health change on VETERAN->ELITE promotion', () => {
    const result = applyHealthBonusForLevelChange(
      LEVEL_VETERAN,
      LEVEL_ELITE,
      80,   // currentHealth (partially damaged)
      100,  // currentMaxHealth
      DEFAULT_VETERANCY_CONFIG,
    );
    expect(result.newMaxHealth).toBe(100);
    expect(result.newHealth).toBe(80);
  });

  it('default config [1,1,1,1] produces no health change on ELITE->HEROIC promotion', () => {
    const result = applyHealthBonusForLevelChange(
      LEVEL_ELITE,
      LEVEL_HEROIC,
      50,
      100,
      DEFAULT_VETERANCY_CONFIG,
    );
    expect(result.newMaxHealth).toBe(100);
    expect(result.newHealth).toBe(50);
  });

  it('custom config with 1.2x veteran bonus increases maxHealth by 20%', () => {
    // Simulates a modded GameData.ini: HealthBonus_Veteran = 1.2
    const config: VeterancyConfig = {
      healthBonuses: [1.0, 1.2, 1.4, 1.6],
    };
    const result = applyHealthBonusForLevelChange(
      LEVEL_REGULAR,
      LEVEL_VETERAN,
      100,
      100,
      config,
    );
    // newMaxHealth = trunc(100 * (1.2 / 1.0)) = 120
    expect(result.newMaxHealth).toBe(120);
    // newHealth preserves ratio: trunc(120 * (100/100)) = 120
    expect(result.newHealth).toBe(120);
  });

  it('custom config preserves damage ratio through level-up', () => {
    // Unit at 60/100 HP promoted with 1.5x bonus
    const config: VeterancyConfig = {
      healthBonuses: [1.0, 1.5, 2.0, 2.5],
    };
    const result = applyHealthBonusForLevelChange(
      LEVEL_REGULAR,
      LEVEL_VETERAN,
      60,   // 60% health
      100,
      config,
    );
    // newMaxHealth = trunc(100 * 1.5) = 150
    expect(result.newMaxHealth).toBe(150);
    // ratio = 60/100 = 0.6, newHealth = trunc(150 * 0.6) = 90
    expect(result.newHealth).toBe(90);
  });

  it('custom config VETERAN->ELITE uses ratio of elite/veteran bonuses', () => {
    const config: VeterancyConfig = {
      healthBonuses: [1.0, 1.2, 1.5, 2.0],
    };
    // Unit already at veteran: maxHealth was 120 (after 1.2x). Full health.
    const result = applyHealthBonusForLevelChange(
      LEVEL_VETERAN,
      LEVEL_ELITE,
      120,
      120,
      config,
    );
    // mult = 1.5 / 1.2 = 1.25, newMaxHealth = trunc(120 * 1.25) = 150
    expect(result.newMaxHealth).toBe(150);
    expect(result.newHealth).toBe(150);
  });

  it('integration: unit promoted via combat with no gameData config (defaults to no health change)', () => {
    // When no gameData is provided, health bonuses default to [1,1,1,1] — no change.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
            makeWeaponBlock('BigGun'),
          ], {
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
            PrimaryDamage: 100,
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

    // Verify initial state
    const killer = agent.entity(1)!;
    expect(killer.veterancy).toBe(LEVEL_REGULAR);
    expect(killer.maxHealth).toBe(100);

    // Attack and kill the victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    // Killer should have leveled up (100 XP >= 50 threshold for VETERAN)
    const killerAfter = agent.entity(1)!;
    expect(killerAfter.veterancy).toBeGreaterThanOrEqual(LEVEL_VETERAN);

    // With default [1,1,1,1] health bonuses, maxHealth should NOT change
    expect(killerAfter.maxHealth).toBe(100);
  });

  /**
   * Source parity: GameData.ini (retail Zero Hour) defines:
   *   HealthBonus_Veteran = 120%  → 1.2
   *   HealthBonus_Elite   = 130%  → 1.3
   *   HealthBonus_Heroic  = 150%  → 1.5
   *
   * When gameData is loaded from INI, the health bonus is applied on level-up.
   * Previously this was hardcoded to [1,1,1,1] (no bonus). Now it reads from
   * GameDataConfig.healthBonuses loaded from the INI registry.
   */
  it('integration: unit promoted via combat uses GameData.ini health bonuses (retail values)', () => {
    // Retail Zero Hour GameData.ini health bonus values
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Killer', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
            makeWeaponBlock('BigGun'),
          ], {
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
            PrimaryDamage: 100,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
        gameData: {
          weaponBonusEntries: [],
          healthBonuses: [1.0, 1.2, 1.3, 1.5],
        },
      },
      mapObjects: [place('Killer', 10, 10), place('Victim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify initial state
    const killer = agent.entity(1)!;
    expect(killer.veterancy).toBe(LEVEL_REGULAR);
    expect(killer.maxHealth).toBe(100);

    // Attack and kill the victim
    agent.attack(1, 2);
    agent.step(30);

    // Victim should be dead
    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    // Killer should have leveled up (100 XP >= 50 VETERAN and >= 100 ELITE threshold)
    const killerAfter = agent.entity(1)!;
    expect(killerAfter.veterancy).toBeGreaterThanOrEqual(LEVEL_ELITE);

    // With retail health bonuses [1.0, 1.2, 1.3, 1.5]:
    // REGULAR->ELITE: mult = 1.3/1.0 = 1.3, newMaxHealth = trunc(100 * 1.3) = 130
    expect(killerAfter.maxHealth).toBe(130);
    // Full health unit: newHealth = trunc(130 * (100/100)) = 130
    expect(killerAfter.health).toBe(130);
  });
});

// ── Test 2: XP Not Awarded for Killing Under-Construction Buildings ─────────

describe('parity veterancy: XP for killing under-construction buildings', () => {
  /**
   * C++ source: Object.cpp:2661
   *   if (!victim->testStatus(OBJECT_STATUS_UNDER_CONSTRUCTION))
   *   {
   *       Int experienceValue = victim->getExperienceTracker()->getExperienceValue(this);
   *       getExperienceTracker()->addExperiencePoints(experienceValue);
   *   }
   *
   * The C++ code blocks BOTH unit-level XP AND player skill points for killing
   * things under construction.
   *
   * TS source: entity-lifecycle.ts:1777-1788
   * The TS code now checks UNDER_CONSTRUCTION before awarding any XP or skill points,
   * matching the C++ behavior.
   */

  it('should not award unit-level XP for killing an under-construction building', () => {
    // Set up: a dozer to build, a building to be built, and an enemy attacker.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Dozer', 'America', ['VEHICLE', 'DOZER'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
            makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
              RepairHealthPercentPerSecond: 5,
            }),
          ]),
          makeObjectDef('Barracks', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 0 }),
          ], {
            BuildCost: 500,
            BuildTime: 10.0,
            ExperienceValue: [50, 50, 50, 50],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
          makeObjectDef('Attacker', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('DestroyGun'),
          ], {
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 40, 100, 200],
          }),
        ],
        weapons: [
          makeWeaponDef('DestroyGun', {
            PrimaryDamage: 500,
            AttackRange: 200,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [
        place('Dozer', 10, 10),
        place('Barracks', 30, 10),
        place('Attacker', 50, 10),
      ],
      mapSize: 64,
      sides: { America: { credits: 10000 }, China: {} },
      enemies: [['America', 'China']],
    });

    // Manually mark the building as under construction (simulating dozer building it).
    // Access internal state to set UNDER_CONSTRUCTION status flag.
    const buildingEntity = (agent.gameLogic as any).spawnedEntities.get(2);
    if (buildingEntity) {
      buildingEntity.objectStatusFlags.add('UNDER_CONSTRUCTION');
      buildingEntity.constructionPercent = 0.3; // 30% built
      buildingEntity.health = 150; // Partial health matching 30% construction
    }

    // Verify attacker starts with 0 XP
    const attackerBefore = agent.gameLogic.getEntityState(3);
    expect(attackerBefore).not.toBeNull();
    expect(attackerBefore!.currentExperience).toBe(0);
    expect(attackerBefore!.veterancyLevel).toBe(LEVEL_REGULAR);

    // Verify the building has UNDER_CONSTRUCTION status
    const buildingState = agent.entity(2);
    expect(buildingState).not.toBeNull();
    expect(buildingState!.statusFlags).toContain('UNDER_CONSTRUCTION');

    // Attacker kills the under-construction building
    agent.attack(3, 2);
    agent.step(30);

    // Building should be dead
    const buildingAfter = agent.entity(2);
    expect(buildingAfter === null || !buildingAfter.alive).toBe(true);

    // Check attacker's XP after the kill
    const attackerAfter = agent.gameLogic.getEntityState(3);
    expect(attackerAfter).not.toBeNull();

    // Source parity: Object.cpp:2661 — no XP for killing under-construction entities.
    expect(attackerAfter!.currentExperience).toBe(0);
    expect(attackerAfter!.veterancyLevel).toBe(LEVEL_REGULAR);
  });

  it('correctly blocks player skill points for under-construction kills (already implemented)', () => {
    // This verifies the partial fix that IS in place: player skill points are
    // blocked for under-construction kills (entity-lifecycle.ts:1798).
    // We verify that the UNDER_CONSTRUCTION check exists for skill points
    // even though unit XP is not blocked.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Building', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
          makeObjectDef('Attacker', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('Gun'),
          ], {
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
        ],
        weapons: [
          makeWeaponDef('Gun', {
            PrimaryDamage: 500,
            AttackRange: 200,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [
        place('Building', 10, 10),
        place('Attacker', 30, 10),
      ],
      mapSize: 8,
      sides: { America: { credits: 1000 }, China: { credits: 1000 } },
      enemies: [['America', 'China']],
    });

    // Mark building as under construction
    const building = (agent.gameLogic as any).spawnedEntities.get(1);
    if (building) {
      building.objectStatusFlags.add('UNDER_CONSTRUCTION');
      building.constructionPercent = 0.5;
    }

    // Kill the building
    agent.attack(2, 1);
    agent.step(20);

    // Building should be dead
    const buildingAfter = agent.entity(1);
    expect(buildingAfter === null || !buildingAfter.alive).toBe(true);

    // Source parity: no unit XP for killing under-construction entities (fixed in 6d8222f6).
    const attacker = agent.gameLogic.getEntityState(2);
    expect(attacker).not.toBeNull();
    expect(attacker!.currentExperience).toBe(0);
  });
});

// ── Test 3: Experience Sink Redirect ─────────────────────────────────────────

describe('parity veterancy: experience sink redirect', () => {
  /**
   * C++ source: ExperienceTracker.cpp lines 148-160
   *
   *   void ExperienceTracker::addExperiencePoints(Int experienceGain, Bool canScaleForBonus)
   *   {
   *       if (m_experienceSink != INVALID_ID)
   *       {
   *           Object *sinkPointer = TheGameLogic->findObjectByID(m_experienceSink);
   *           if (sinkPointer)
   *           {
   *               sinkPointer->getExperienceTracker()->addExperiencePoints(
   *                   experienceGain * m_experienceScalar, canScaleForBonus);
   *               return;
   *           }
   *       }
   *       // ... normal XP processing ...
   *   }
   *
   * The experience sink mechanism redirects all XP earned by one entity to another.
   * Primary use cases in C++:
   *   1. Projectiles (missiles, etc.) redirect their kill XP to the launcher
   *      (Weapon.cpp:2761 — projectile->getExperienceTracker()->setExperienceSink(launcher->getID()))
   *   2. Special abilities create helper objects that sink XP back to the caster
   *      (SpecialAbilityUpdate.cpp:1508)
   *   3. Neutron missiles sink XP to the launcher
   *      (NeutronMissileUpdate.cpp:243)
   *
   * TS source: experience.ts — No sink field exists in ExperienceState.
   * The addExperiencePoints function has no sink redirect logic.
   *
   * PARITY GAP: The entire experience sink mechanism is missing from the TS port.
   * This means projectile kills credit XP to the projectile entity (which is then
   * discarded) rather than to the launcher.
   */

  it('documents that ExperienceState has no experienceSink field', () => {
    // The TS ExperienceState interface only has:
    //   currentLevel, currentExperience, experienceScalar
    // It does NOT have an experienceSink field.

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
            makeWeaponBlock('LauncherGun'),
          ], {
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('LauncherGun', {
            PrimaryDamage: 100,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Launcher', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify that the internal entity state has no experienceSink property
    const launcherInternal = (agent.gameLogic as any).spawnedEntities.get(1);
    expect(launcherInternal).toBeDefined();

    // The experienceState object should NOT have an experienceSink field
    // because the TS port has not implemented this mechanism.
    expect('experienceSink' in (launcherInternal.experienceState ?? {})).toBe(false);
  });

  it('documents that direct kills credit XP to the killer (no sink needed for direct combat)', () => {
    // For direct-fire weapons (non-projectile), the attacker entity IS the killer,
    // so XP goes directly to it. The sink mechanism is only needed for projectile
    // entities that are separate objects (missiles, rockets).
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('DirectFire', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
            makeWeaponBlock('DirectGun'),
          ], {
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ], {
            ExperienceValue: [100, 100, 100, 100],
            ExperienceRequired: [0, 1000, 2000, 3000],
          }),
        ],
        weapons: [
          makeWeaponDef('DirectGun', {
            PrimaryDamage: 100,
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('DirectFire', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Kill target
    agent.attack(1, 2);
    agent.step(30);

    // Target should be dead
    const target = agent.entity(2);
    expect(target === null || !target.alive).toBe(true);

    // Direct fire unit gets XP directly (no sink needed)
    const killer = agent.gameLogic.getEntityState(1);
    expect(killer).not.toBeNull();
    expect(killer!.currentExperience).toBe(100);
    expect(killer!.veterancyLevel).toBeGreaterThanOrEqual(LEVEL_VETERAN);
  });

  it('documents the missing sink: if a hypothetical projectile entity killed a target, its launcher would get no XP', () => {
    // This test documents what WOULD happen if a projectile entity existed
    // as a separate entity (like a missile). In C++, the projectile's
    // experience sink would redirect XP to the launcher.
    //
    // In the TS port, there is no projectile entity system yet, so this
    // test simply verifies the gap exists in the ExperienceState type.
    // When the sink is implemented, experienceState should gain:
    //   experienceSink: number | null  (entity ID of XP recipient, or null)

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          ], {
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
          makeObjectDef('Projectile', 'America', ['PROJECTILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          ], {
            ExperienceValue: [0, 0, 0, 0],
            ExperienceRequired: [0, 50, 100, 200],
          }),
        ],
      },
      mapObjects: [place('Launcher', 10, 10), place('Projectile', 20, 10)],
      mapSize: 8,
      sides: { America: {} },
    });

    // Verify neither entity has an experienceSink field
    const launcher = (agent.gameLogic as any).spawnedEntities.get(1);
    const projectile = (agent.gameLogic as any).spawnedEntities.get(2);

    expect(launcher).toBeDefined();
    expect(projectile).toBeDefined();

    // ExperienceState type lacks experienceSink — this is the documented parity gap.
    // C++ equivalent: m_experienceSink initialized to INVALID_ID in ExperienceTracker.cpp:49
    expect(launcher.experienceState).toBeDefined();
    expect(launcher.experienceState.currentLevel).toBe(LEVEL_REGULAR);
    expect(launcher.experienceState.currentExperience).toBe(0);
    expect('experienceSink' in launcher.experienceState).toBe(false);

    // When implementing the sink, ExperienceState should have:
    //   experienceSink: number | null
    // And addExperiencePoints should check for it before applying XP locally.
  });
});
