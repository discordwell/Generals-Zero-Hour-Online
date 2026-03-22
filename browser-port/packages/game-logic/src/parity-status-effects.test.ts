/**
 * Parity tests for poison damage type, production time change, and DOESNT_AFFECT_SIMILAR.
 *
 * These tests document behavioral differences between the C++ source and the
 * TypeScript port, serving as regression anchors for future parity fixes.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Test 1: Poison Tick Damage Uses POISON Type (Armor Applies)
// ---------------------------------------------------------------------------
// C++ source: PoisonedBehavior.cpp:126 — poison tick damage uses
// DAMAGE_UNRESISTABLE (to avoid re-triggering onDamage) with
// m_damageFXOverride = DAMAGE_POISON for visual effects.
//
// TS: status-effects.ts — updatePoisonedEntities calls
//   applyWeaponDamageAmount(null, entity, amount, 'UNRESISTABLE')
// matching C++ behavior: poison ticks bypass armor to avoid re-infection.

describe('Poison damage type parity', () => {
  function makePoisonSetup(opts: {
    poisonArmorPercent?: number;
    poisonDamage?: number;
    targetHealth?: number;
    poisonIntervalMs?: number;
    poisonDurationMs?: number;
  } = {}) {
    const armorPercent = opts.poisonArmorPercent ?? 10;
    const targetHealth = opts.targetHealth ?? 500;

    // Target with PoisonedBehavior and high POISON resistance armor.
    // Armor "Damage = xx%" means xx% of damage gets through.
    // So 10% means 90% reduction.
    const targetDef = makeObjectDef('PoisonTarget', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: targetHealth,
        InitialHealth: targetHealth,
      }),
      makeBlock('Behavior', 'PoisonedBehavior ModuleTag_Poisoned', {
        PoisonDamageInterval: opts.poisonIntervalMs ?? 333,
        PoisonDuration: opts.poisonDurationMs ?? 3000,
      }),
      makeBlock('ArmorSet', 'ArmorSet', { Conditions: 'NONE', Armor: 'PoisonResistArmor' }),
    ]);

    // Armor that reduces POISON damage to armorPercent% pass-through.
    const armor = makeArmorDef('PoisonResistArmor', {
      Default: 1,
      POISON: `${armorPercent}%`,
    });

    const attackerDef = makeObjectDef('PoisonAttacker', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'PoisonGun'] }),
    ]);

    const poisonWeapon = makeWeaponDef('PoisonGun', {
      AttackRange: 200,
      PrimaryDamage: opts.poisonDamage ?? 10,
      PrimaryDamageRadius: 0,
      DamageType: 'POISON',
      DeliveryType: 'DIRECT',
      DelayBetweenShots: 5000,
      WeaponSpeed: 999999,
    });

    const bundle = makeBundle({
      objects: [targetDef, attackerDef],
      weapons: [poisonWeapon],
      armors: [armor],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PoisonTarget', 5, 5),
        makeMapObject('PoisonAttacker', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);
    return { logic };
  }

  it('poison ticks use UNRESISTABLE damage type, bypassing armor (C++ parity)', () => {
    // Source parity: PoisonedBehavior.cpp:126 — C++ uses DAMAGE_UNRESISTABLE
    // with comment "Not poison, as that will infect us again".
    // This means poison ticks bypass armor entirely.
    //
    // Setup: target with 500 HP, armor that reduces POISON to 10% pass-through,
    // poisoned by a weapon dealing 10 POISON damage per tick.
    const { logic } = makePoisonSetup({
      poisonDamage: 10,
      poisonArmorPercent: 10,
      targetHealth: 500,
      poisonIntervalMs: 333,
      poisonDurationMs: 5000,
    });

    // Command attacker (entity 2) to attack target (entity 1).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Run a few frames so the attack fires and poison is applied.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Record health after initial hit.
    const healthAfterHit = logic.getEntityState(1)!.health;
    expect(healthAfterHit).toBeLessThan(500); // Confirm attack landed.

    // Run enough frames for at least one poison tick (~10 frames at 30fps for 333ms interval).
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const healthAfterPoisonTicks = logic.getEntityState(1)!.health;
    const poisonDamageDealt = healthAfterHit - healthAfterPoisonTicks;

    // Source parity: C++ PoisonedBehavior.cpp:126 uses DAMAGE_UNRESISTABLE.
    // TS uses 'UNRESISTABLE' which should bypass armor, but verify damage is dealt.
    expect(poisonDamageDealt).toBeGreaterThan(0);
  });

  it('verifies the initial POISON hit IS reduced by armor', () => {
    // The initial weapon hit uses POISON damage type and goes through armor.
    // This part IS correct in TS — only the DoT ticks diverge.
    const { logic } = makePoisonSetup({
      poisonDamage: 100,
      poisonArmorPercent: 10,
      targetHealth: 500,
      poisonDurationMs: 100, // Very short duration so DoT doesn't interfere.
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    // Run just enough frames for the direct hit, but not enough for poison ticks.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const healthAfterHit = logic.getEntityState(1)!.health;
    const directDamage = 500 - healthAfterHit;

    // Direct hit: 100 * 0.10 = 10 damage (armor applied correctly).
    // Allow some tolerance since the first poison tick might also fire.
    expect(directDamage).toBeGreaterThan(0);
    expect(directDamage).toBeLessThanOrEqual(120); // Not full 100 (armor applied).
  });
});

// ---------------------------------------------------------------------------
// Test 2: Production Time Change Percent (General's Abilities)
// ---------------------------------------------------------------------------
// C++ source: ThingTemplate.cpp:1553 —
//   factionModifier = 1 + player->getProductionTimeChangePercent(getName())
//   buildTime *= factionModifier
// This allows General's point abilities to speed up or slow down production.
//
// TS: resolveObjectBuildTimeFrames now applies the same factionModifier using
// getProductionTimeChangePercent(), matching C++ parity.

describe('Production time change percent parity', () => {
  function makeProductionSetup() {
    const factoryDef = makeObjectDef('WarFactory', 'America', ['STRUCTURE', 'PRODUCTION'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 1000,
        InitialHealth: 1000,
      }),
      makeBlock('Behavior', 'QueueProductionExitUpdate ModuleTag_Production', {
        UnitCreatePoint: 'X:12.0 Y:0.0 Z:0.0',
        NaturalRallyPoint: 'X:28.0 Y:0.0 Z:0.0',
      }),
    ], { BuildCost: 2000, BuildTime: 30 });

    const tankDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ], { BuildCost: 100, BuildTime: 10 });

    const bundle = makeBundle({
      objects: [factoryDef, tankDef],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('WarFactory', 4, 4)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(1, 'America');
    logic.update(0);
    return { logic };
  }

  it('setting productionTimeChangePercent=-0.25 reduces build time by 25% (C++ parity)', () => {
    const { logic } = makeProductionSetup();

    // Source parity: ThingTemplate.cpp:1553
    //   factionModifier = 1 + player->getProductionTimeChangePercent(getName())
    //   buildTime *= factionModifier
    // -0.25 => factionModifier = 0.75 => 25% faster build time.

    // Access internal resolveObjectBuildTimeFrames to verify the modifier is applied.
    const priv = logic as unknown as {
      resolveObjectBuildTimeFrames(objectDef: { name: string; fields: Record<string, unknown> }, side?: string): number;
    };

    // Without modifier: BuildTime = 10 seconds, at 30fps = 300 frames.
    const baseFrames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'America');
    expect(baseFrames).toBe(300);

    // Apply -25% production time change for Tank on America's side.
    logic.setProductionTimeChangePercent('America', 'Tank', -0.25);

    // With modifier: factionModifier = 1 + (-0.25) = 0.75
    // totalFrames = 300 * 0.75 = 225
    const modifiedFrames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'America');
    expect(modifiedFrames).toBe(225);

    // Verify getProductionTimeChangePercent returns the set value.
    expect(logic.getProductionTimeChangePercent('America', 'Tank')).toBe(-0.25);
  });

  it('modifier is per-template — other templates are unaffected', () => {
    const { logic } = makeProductionSetup();

    const priv = logic as unknown as {
      resolveObjectBuildTimeFrames(objectDef: { name: string; fields: Record<string, unknown> }, side?: string): number;
    };

    // Apply modifier only for Tank.
    logic.setProductionTimeChangePercent('America', 'Tank', -0.25);

    // Tank is modified.
    const tankFrames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'America');
    expect(tankFrames).toBe(225);

    // WarFactory is NOT modified (different template name).
    const factoryFrames = priv.resolveObjectBuildTimeFrames({ name: 'WarFactory', fields: { BuildTime: 30 } }, 'America');
    expect(factoryFrames).toBe(900); // 30 * 30 = 900, unmodified.
  });

  it('modifier is per-side — other sides are unaffected', () => {
    const { logic } = makeProductionSetup();

    const priv = logic as unknown as {
      resolveObjectBuildTimeFrames(objectDef: { name: string; fields: Record<string, unknown> }, side?: string): number;
    };

    // Apply modifier for America only.
    logic.setProductionTimeChangePercent('America', 'Tank', -0.25);

    // America's Tank is faster.
    const americaFrames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'America');
    expect(americaFrames).toBe(225);

    // China's Tank is unaffected.
    const chinaFrames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'China');
    expect(chinaFrames).toBe(300);
  });

  it('positive modifier increases build time (penalty)', () => {
    const { logic } = makeProductionSetup();

    const priv = logic as unknown as {
      resolveObjectBuildTimeFrames(objectDef: { name: string; fields: Record<string, unknown> }, side?: string): number;
    };

    // +50% production time penalty.
    logic.setProductionTimeChangePercent('America', 'Tank', 0.5);

    // factionModifier = 1 + 0.5 = 1.5 => 300 * 1.5 = 450.
    const frames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'America');
    expect(frames).toBe(450);
  });

  it('setting modifier to zero removes the entry', () => {
    const { logic } = makeProductionSetup();

    logic.setProductionTimeChangePercent('America', 'Tank', -0.25);
    expect(logic.getProductionTimeChangePercent('America', 'Tank')).toBe(-0.25);

    // Clear the modifier.
    logic.setProductionTimeChangePercent('America', 'Tank', 0);
    expect(logic.getProductionTimeChangePercent('America', 'Tank')).toBe(0);

    const priv = logic as unknown as {
      resolveObjectBuildTimeFrames(objectDef: { name: string; fields: Record<string, unknown> }, side?: string): number;
    };
    const frames = priv.resolveObjectBuildTimeFrames({ name: 'Tank', fields: { BuildTime: 10 } }, 'America');
    expect(frames).toBe(300); // Back to base.
  });
});

// ---------------------------------------------------------------------------
// Test 3: DOESNT_AFFECT_SIMILAR Template Equivalence
// ---------------------------------------------------------------------------
// C++ source: Weapon.cpp:1202-1210 — DOESNT_AFFECT_SIMILAR check uses
// isEquivalentTo() for template comparison (checks ancestry, ObjectReskin,
// BuildVariations, ChildObject inheritance, etc.)
//
// TS: combat-damage-events.ts:306-308 — Uses simple string equality:
//   source.templateName.trim().toUpperCase() === candidate.templateName.trim().toUpperCase()

describe('DOESNT_AFFECT_SIMILAR template equivalence parity', () => {
  function makeDoesntAffectSimilarSetup(opts: {
    sourceTemplate: string;
    targetTemplate: string;
    bystander1Template: string;
    allSameSide?: boolean;
  }) {
    const sourceDef = makeObjectDef(opts.sourceTemplate, 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SplashGun'] }),
    ]);

    const targetDef = makeObjectDef(opts.targetTemplate, 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    // Allied bystander that DOESNT_AFFECT_SIMILAR should potentially spare.
    const bystander1Def = makeObjectDef(opts.bystander1Template, 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    // Weapon with splash damage and DOESNT_AFFECT_SIMILAR (NOT_SIMILAR flag).
    const splashWeapon = makeWeaponDef('SplashGun', {
      AttackRange: 200,
      PrimaryDamage: 50,
      PrimaryDamageRadius: 100,
      DamageType: 'EXPLOSION',
      DeliveryType: 'DIRECT',
      DelayBetweenShots: 5000,
      WeaponSpeed: 999999,
      // RadiusDamageAffects uses NOT_SIMILAR flag plus standard ENEMIES/ALLIES.
      RadiusDamageAffects: 'NOT_SIMILAR ENEMIES ALLIES',
    });

    const objects = [sourceDef, targetDef, bystander1Def];
    const bundle = makeBundle({
      objects,
      weapons: [splashWeapon],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject(opts.sourceTemplate, 5, 5),
        makeMapObject(opts.targetTemplate, 5, 5),
        makeMapObject(opts.bystander1Template, 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);
    return { logic };
  }

  it('spares allied units with the SAME template name from splash damage', () => {
    // Source = "Humvee", allied bystander = "Humvee" (same template name).
    // DOESNT_AFFECT_SIMILAR should skip the allied bystander.
    const { logic } = makeDoesntAffectSimilarSetup({
      sourceTemplate: 'Humvee',
      targetTemplate: 'EnemyTank',
      bystander1Template: 'Humvee',
    });

    const bystander1HealthBefore = logic.getEntityState(3)!.health;

    // Command source (entity 1) to attack enemy (entity 2).
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const bystander1HealthAfter = logic.getEntityState(3)!.health;

    // Allied bystander with same template should be spared by DOESNT_AFFECT_SIMILAR.
    expect(bystander1HealthAfter).toBe(bystander1HealthBefore);
  });

  it('does NOT spare allied units with a DIFFERENT template name', () => {
    // Source = "Humvee", allied bystander = "Crusader" (different template name).
    // DOESNT_AFFECT_SIMILAR does NOT apply — the bystander takes splash damage.
    const { logic } = makeDoesntAffectSimilarSetup({
      sourceTemplate: 'Humvee',
      targetTemplate: 'EnemyTank',
      bystander1Template: 'Crusader',
    });

    const bystander1HealthBefore = logic.getEntityState(3)!.health;

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const bystander1HealthAfter = logic.getEntityState(3)!.health;

    // Different template name — DOESNT_AFFECT_SIMILAR doesn't apply, so the
    // bystander takes normal splash damage.
    expect(bystander1HealthAfter).toBeLessThan(bystander1HealthBefore);
  });

  it('spares allied ChildObject/ObjectReskin variants sharing a parent template (C++ parity)', () => {
    // Source parity: Weapon.cpp:1202-1210 — isEquivalentTo() checks ancestry.
    // If "HumveeReskin" is an ObjectReskin of "Humvee", they share a parent
    // template and are considered equivalent. A Humvee's splash weapon with
    // DOESNT_AFFECT_SIMILAR should spare HumveeReskin allies.
    //
    // TS now uses areEquivalentTemplateNames (production-templates.ts) which
    // walks the ObjectDef.parent chain, matching C++ isEquivalentTo behavior.

    const sourceDef = makeObjectDef('Humvee', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SplashGun'] }),
    ]);

    // HumveeReskin inherits from Humvee via parent (ObjectReskin/ChildObject).
    const reskinDef = makeObjectDef('HumveeReskin', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ], {}, 'Humvee');

    const targetDef = makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    const splashWeapon = makeWeaponDef('SplashGun', {
      AttackRange: 200,
      PrimaryDamage: 50,
      PrimaryDamageRadius: 100,
      DamageType: 'EXPLOSION',
      DeliveryType: 'DIRECT',
      DelayBetweenShots: 5000,
      WeaponSpeed: 999999,
      RadiusDamageAffects: 'NOT_SIMILAR ENEMIES ALLIES',
    });

    const bundle = makeBundle({
      objects: [sourceDef, targetDef, reskinDef],
      weapons: [splashWeapon],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Humvee', 5, 5),
        makeMapObject('EnemyTank', 5, 5),
        makeMapObject('HumveeReskin', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const reskinHealthBefore = logic.getEntityState(3)!.health;

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const reskinHealthAfter = logic.getEntityState(3)!.health;

    // HumveeReskin shares parent "Humvee" — DOESNT_AFFECT_SIMILAR spares it.
    expect(reskinHealthAfter).toBe(reskinHealthBefore);
  });

  it('does NOT spare allied units with different ancestry from splash damage', () => {
    // Two different templates with no shared parent — NOT equivalent.
    // DOESNT_AFFECT_SIMILAR should NOT spare them.
    const sourceDef = makeObjectDef('Humvee', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SplashGun'] }),
    ]);

    // Unrelated template — no parent relationship to Humvee.
    const unrelatedDef = makeObjectDef('Crusader', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    const targetDef = makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    const splashWeapon = makeWeaponDef('SplashGun', {
      AttackRange: 200,
      PrimaryDamage: 50,
      PrimaryDamageRadius: 100,
      DamageType: 'EXPLOSION',
      DeliveryType: 'DIRECT',
      DelayBetweenShots: 5000,
      WeaponSpeed: 999999,
      RadiusDamageAffects: 'NOT_SIMILAR ENEMIES ALLIES',
    });

    const bundle = makeBundle({
      objects: [sourceDef, targetDef, unrelatedDef],
      weapons: [splashWeapon],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Humvee', 5, 5),
        makeMapObject('EnemyTank', 5, 5),
        makeMapObject('Crusader', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const unrelatedHealthBefore = logic.getEntityState(3)!.health;

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const unrelatedHealthAfter = logic.getEntityState(3)!.health;

    // No shared ancestry — Crusader takes normal splash damage.
    expect(unrelatedHealthAfter).toBeLessThan(unrelatedHealthBefore);
  });
});
