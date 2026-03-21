/**
 * Score Tracking & Weapon PreferredAgainstKindOf Parity Tests
 *
 * Test 1: Score Tracking Counters
 *   C++ Player.cpp — Player tracks unitsBuilt, unitsLost, unitsDestroyed,
 *   structuresBuilt via ScoreKeeper hooks. Verified via getSideScoreState().
 *
 * Test 2: Weapon PreferredAgainstKindOf
 *   C++ WeaponSet.cpp — PreferredAgainst field on a WeaponSet slot causes
 *   that weapon to be auto-chosen for targets matching the KindOf set.
 *   The mechanism sets virtual damage/range to huge values during weapon
 *   selection, ensuring the preferred weapon always wins the auto-choose.
 *   Verified at the unit-test level via chooseBestWeaponForTarget.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeCommandButtonDef,
  makeCommandSetDef,
  place,
} from './parity-agent.js';
import { GameLogicSubsystem } from './index.js';
import {
  chooseBestWeaponForTarget,
  createMultiWeaponEntityState,
  resetWeaponSlotState,
  WEAPON_SLOT_PRIMARY,
  WEAPON_SLOT_SECONDARY,
  type ChooseBestWeaponContext,
  type WeaponSlotProfile,
} from './combat-weapon-set.js';

// ---------------------------------------------------------------------------
// Test 1: Score Tracking Counters
// ---------------------------------------------------------------------------

describe('parity score tracking counters', () => {
  /**
   * Source parity: Player.cpp ScoreKeeper integration
   *
   * Build a unit, build a structure, kill an enemy unit, lose a unit.
   * Check getSideScoreState() for each counter.
   */

  it('increments unitsBuilt when a unit is produced from a factory', () => {
    // Set up a factory that can produce a unit
    const bundle = makeBundle({
      objects: [
        // Factory (structure with production update)
        makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_FACTORY'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
          makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [20, 0, 0],
            NaturalRallyPoint: [40, 0, 0],
          }),
        ], {
          CommandSet: 'BarracksCS',
        }),
        // Producible unit (very short build time)
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { BuildCost: 200, BuildTime: 0.5 }),
      ],
      commandSets: [
        makeCommandSetDef('BarracksCS', { '1': 'Cmd_TrainRanger' }),
      ],
      commandButtons: [
        makeCommandButtonDef('Cmd_TrainRanger', { Command: 'UNIT_BUILD', Object: 'Ranger' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('USABarracks', 100, 100)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setSideCredits('America', 5000);

    // Before production: unitsBuilt should be 0
    expect(logic.getSideScoreState('America')).toMatchObject({ unitsBuilt: 0 });

    // Queue a unit production
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: 1,
      unitTemplateName: 'Ranger',
    });

    // Advance enough frames for production to complete (0.5s = 15 frames at 30 FPS, plus margin)
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // After production: unitsBuilt should be 1
    const score = logic.getSideScoreState('America');
    expect(score.unitsBuilt).toBe(1);
    expect(score.moneySpent).toBeGreaterThanOrEqual(200);
  });

  it('increments structuresBuilt when a dozer builds a structure', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Dozer', 'America', ['DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('PowerPlant', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 500, BuildTime: 0.5 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Dozer', 100, 100)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setSideCredits('America', 5000);

    expect(logic.getSideScoreState('America')).toMatchObject({ structuresBuilt: 0 });

    // Order the dozer to construct a building
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'PowerPlant',
      targetPosition: [100, 0, 100] as const,
      angle: 0,
      lineEndPosition: null,
    });

    // Advance enough frames for construction to complete
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const score = logic.getSideScoreState('America');
    expect(score.structuresBuilt).toBe(1);
    expect(score.moneySpent).toBe(500);
  });

  it('increments unitsDestroyed for attacker and unitsLost for victim when a unit is killed', () => {
    // Two opposing sides. America attacks China's unit.
    const agent = createParityAgent({
      bundles: {
        objects: [
          // Attacker — high damage, will kill the target quickly
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('HeavyGun'),
          ]),
          // Victim — low HP, will die quickly
          makeObjectDef('Victim', 'China', ['INFANTRY'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('HeavyGun', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Victim', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const logic = agent.gameLogic;

    // Before combat: all counters should be 0
    expect(logic.getSideScoreState('America')).toMatchObject({
      unitsDestroyed: 0,
      unitsLost: 0,
    });
    expect(logic.getSideScoreState('China')).toMatchObject({
      unitsDestroyed: 0,
      unitsLost: 0,
    });

    // Order the attacker to kill the victim
    agent.attack(1, 2);

    // Advance enough frames for the victim to die
    agent.step(30);

    // Victim should be dead
    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    // America destroyed an enemy unit
    const americaScore = logic.getSideScoreState('America');
    expect(americaScore.unitsDestroyed).toBe(1);

    // China lost a unit
    const chinaScore = logic.getSideScoreState('China');
    expect(chinaScore.unitsLost).toBe(1);
  });

  it('increments structuresDestroyed and structuresLost when a structure is destroyed', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('HeavyGun'),
          ]),
          makeObjectDef('EnemyBuilding', 'China', ['STRUCTURE'], [
            makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('HeavyGun', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('EnemyBuilding', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const logic = agent.gameLogic;

    agent.attack(1, 2);
    agent.step(30);

    // America destroyed an enemy structure
    expect(logic.getSideScoreState('America')).toMatchObject({
      structuresDestroyed: 1,
    });

    // China lost a structure
    expect(logic.getSideScoreState('China')).toMatchObject({
      structuresLost: 1,
    });
  });

  it('comprehensive game: build, kill, lose — all score counters correct', () => {
    // Set up a more complex scenario:
    // America has a factory, produces a unit, AND has an attacker that kills a China unit.
    // China has a unit that is killed.
    const bundle = makeBundle({
      objects: [
        // Factory for America
        makeObjectDef('Barracks', 'America', ['STRUCTURE', 'FS_FACTORY'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
          makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [20, 0, 0],
            NaturalRallyPoint: [40, 0, 0],
          }),
        ], { CommandSet: 'BarracksCS' }),
        // Producible infantry (short build time)
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { BuildCost: 200, BuildTime: 0.3 }),
        // America attacker — powerful weapon to kill enemy fast
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('TankGun'),
        ]),
        // China's target — weak, will die quickly
        makeObjectDef('ChinaUnit', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 30, InitialHealth: 30 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TankGun', {
          PrimaryDamage: 100,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 150,
          DelayBetweenShots: 100,
        }),
      ],
      commandSets: [
        makeCommandSetDef('BarracksCS', { '1': 'Cmd_Train' }),
      ],
      commandButtons: [
        makeCommandButtonDef('Cmd_Train', { Command: 'UNIT_BUILD', Object: 'Infantry' }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        // id=1: America barracks
        makeMapObject('Barracks', 100, 100),
        // id=2: America tank
        makeMapObject('Tank', 110, 100),
        // id=3: China unit — close enough to be attacked
        makeMapObject('ChinaUnit', 120, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setSideCredits('America', 5000);

    // Step 1: Queue unit production
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: 1,
      unitTemplateName: 'Infantry',
    });

    // Step 2: Order the tank to attack the China unit
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 2,
      targetEntityId: 3,
      commandSource: 'PLAYER',
    });

    // Advance enough frames for production to complete and combat to resolve
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const americaScore = logic.getSideScoreState('America');
    const chinaScore = logic.getSideScoreState('China');

    // America should have produced 1 unit
    expect(americaScore.unitsBuilt).toBe(1);

    // America should have destroyed 1 enemy unit
    expect(americaScore.unitsDestroyed).toBe(1);

    // China should have lost 1 unit
    expect(chinaScore.unitsLost).toBe(1);

    // Money spent should reflect the infantry build cost
    expect(americaScore.moneySpent).toBeGreaterThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Weapon PreferredAgainstKindOf
// ---------------------------------------------------------------------------

describe('parity weapon PreferredAgainstKindOf', () => {
  /**
   * Source parity: WeaponSet.cpp — PreferredAgainst KindOf
   *
   * C++ behavior: when a weapon slot has PreferredAgainst = X and the target
   * has KindOf X, that weapon is always chosen by the auto-choose algorithm
   * regardless of its raw damage value.
   *
   * This is NOT a damage bonus — the actual damage dealt is still the weapon's
   * PrimaryDamage. The mechanism works by inflating the virtual damage score
   * to 1e10 during weapon auto-selection in chooseBestWeaponForTarget().
   *
   * Source reference: WeaponSet.cpp line 855-862:
   *   if (w->getTemplate()->isPreferredAgainst(victim->getObjectType()))
   *     damage = HUGE; range = HUGE; isReady = true;
   */

  // Helper: create a multi-weapon entity state for unit-level testing
  function makeWeaponProfile(overrides: Partial<WeaponSlotProfile>): WeaponSlotProfile {
    return {
      name: 'Default',
      slotIndex: 0,
      primaryDamage: 10,
      secondaryDamage: 0,
      primaryDamageRadius: 0,
      secondaryDamageRadius: 0,
      scatterTargetScalar: 0,
      scatterTargets: [],
      scatterRadius: 0,
      scatterRadiusVsInfantry: 0,
      radiusDamageAngle: Math.PI,
      damageType: 'ARMOR_PIERCING',
      deathType: 'NORMAL',
      damageDealtAtSelfPosition: false,
      radiusDamageAffectsMask: 0xFFFFFFFF,
      projectileCollideMask: 0,
      weaponSpeed: 999999,
      minWeaponSpeed: 999999,
      scaleWeaponSpeed: false,
      capableOfFollowingWaypoints: false,
      projectileObjectName: null,
      attackRange: 120,
      unmodifiedAttackRange: 120,
      minAttackRange: 0,
      continueAttackRange: 0,
      clipSize: 0,
      clipReloadFrames: 0,
      autoReloadWhenIdleFrames: 0,
      preAttackDelayFrames: 0,
      preAttackType: 'PER_SHOT',
      minDelayFrames: 3,
      maxDelayFrames: 3,
      antiMask: 0xFFFF,
      continuousFireOneShotsNeeded: 0,
      continuousFireTwoShotsNeeded: 0,
      continuousFireCoastFrames: 0,
      continuousFireMeanRateOfFire: 1,
      continuousFireFastRateOfFire: 1,
      historicBonusCount: 0,
      historicBonusRadius: 0,
      historicBonusTime: 0,
      historicBonusWeapon: null,
      laserName: null,
      projectileArcFirstHeight: 0,
      projectileArcSecondHeight: 0,
      projectileArcFirstPercentIndent: 0,
      projectileArcSecondPercentIndent: 0,
      leechRangeWeapon: false,
      fireSoundEvent: null,
      autoChooseSourceMask: 0xFFFFFFFF,
      preferredAgainstKindOf: new Set(),
      autoReloadsClip: false,
      ...overrides,
    };
  }

  function makeChooseContext(overrides: Partial<ChooseBestWeaponContext> = {}): ChooseBestWeaponContext {
    return {
      distanceSqrToVictim: 100 * 100,
      victimAntiMask: 0x02, // WEAPON_ANTI_GROUND
      victimArmorCoefficients: null,
      victimKindOf: new Set(),
      commandSourceBit: 0xFFFFFFFF,
      frameCounter: 0,
      ...overrides,
    };
  }

  it('preferred weapon is chosen over higher-damage weapon when target matches KindOf', () => {
    // Set up: primary weapon has 100 damage, secondary has only 5 damage
    // but is preferred against AIRCRAFT.
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'MainGun',
      slotIndex: 0,
      primaryDamage: 100,
      preferredAgainstKindOf: new Set(),
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'AntiAirMissile',
      slotIndex: 1,
      primaryDamage: 5,
      preferredAgainstKindOf: new Set(['AIRCRAFT']),
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Target is an AIRCRAFT — secondary should win despite 5 damage vs 100
    const ctx = makeChooseContext({ victimKindOf: new Set(['AIRCRAFT']) });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('non-matching KindOf falls back to highest-damage weapon', () => {
    // Same setup, but target is VEHICLE, not AIRCRAFT
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'MainGun',
      slotIndex: 0,
      primaryDamage: 100,
      preferredAgainstKindOf: new Set(),
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'AntiAirMissile',
      slotIndex: 1,
      primaryDamage: 5,
      preferredAgainstKindOf: new Set(['AIRCRAFT']),
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Target is VEHICLE — primary should win on damage
    const ctx = makeChooseContext({ victimKindOf: new Set(['VEHICLE']) });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_PRIMARY);
  });

  it('preferred-against matches any KindOf in the set (partial match)', () => {
    // Target has multiple KindOf flags, weapon is preferred against one of them
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'MainGun',
      slotIndex: 0,
      primaryDamage: 200,
      preferredAgainstKindOf: new Set(),
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'AntiInfantry',
      slotIndex: 1,
      primaryDamage: 3,
      preferredAgainstKindOf: new Set(['INFANTRY']),
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Target has INFANTRY among its KindOf flags — preferred weapon should win
    const ctx = makeChooseContext({ victimKindOf: new Set(['INFANTRY', 'SELECTABLE']) });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('weaponSlotProfile exposes preferredAgainstKindOf field', () => {
    // Documentation test: verify the field exists on WeaponSlotProfile
    const profile = makeWeaponProfile({
      preferredAgainstKindOf: new Set(['AIRCRAFT', 'INFANTRY']),
    });
    expect(profile.preferredAgainstKindOf).toBeDefined();
    expect(profile.preferredAgainstKindOf).toBeInstanceOf(Set);
    expect(profile.preferredAgainstKindOf.size).toBe(2);
    expect(profile.preferredAgainstKindOf.has('AIRCRAFT')).toBe(true);
    expect(profile.preferredAgainstKindOf.has('INFANTRY')).toBe(true);
  });

  it('weapon with empty preferredAgainstKindOf does not trigger preferred-against logic', () => {
    // Both weapons have empty preferredAgainstKindOf — pure damage-based selection
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'LowDamage',
      slotIndex: 0,
      primaryDamage: 10,
      preferredAgainstKindOf: new Set(),
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'HighDamage',
      slotIndex: 1,
      primaryDamage: 50,
      preferredAgainstKindOf: new Set(),
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Even with AIRCRAFT target, the higher-damage weapon wins (no preferred-against)
    const ctx = makeChooseContext({ victimKindOf: new Set(['AIRCRAFT']) });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY); // 50 > 10
  });
});
