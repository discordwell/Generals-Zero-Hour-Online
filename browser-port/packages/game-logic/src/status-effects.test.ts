import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeScienceDef,
  makeAudioEventDef,
  makeSpecialPowerDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeInputState,
} from './test-helpers.js';

describe('FlammableUpdate', () => {
  function makeFlammableSetup(opts: {
    flameDamageLimit?: number;
    aflameDurationMs?: number;
    aflameDamageDelayMs?: number;
    aflameDamageAmount?: number;
    burnedDelayMs?: number;
    attackDamage?: number;
  } = {}) {
    const flammableDef = makeObjectDef('FlammableUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
        FlameDamageLimit: opts.flameDamageLimit ?? 10,
        AflameDuration: opts.aflameDurationMs ?? 2000,
        AflameDamageDelay: opts.aflameDamageDelayMs ?? 500,
        AflameDamageAmount: opts.aflameDamageAmount ?? 5,
        BurnedDelay: opts.burnedDelayMs ?? 0,
      }),
    ]);

    const attackerDef = makeObjectDef('Flamer', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'FlameGun'] }),
    ]);
    const flameWeapon = makeWeaponDef('FlameGun', {
      AttackRange: 200,
      PrimaryDamage: opts.attackDamage ?? 20,
      PrimaryDamageRadius: 0,
      DamageType: 'FLAME',
      DelayBetweenShots: 500,
      WeaponSpeed: 999999,
    });

    const bundle = makeBundle({
      objects: [flammableDef, attackerDef],
      weapons: [flameWeapon],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FlammableUnit', 5, 5),
        makeMapObject('Flamer', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);
    return { logic };
  }

  it('extracts FlammableProfile from INI', () => {
    const { logic } = makeFlammableSetup();
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { flammableProfile: { flameDamageLimit: number; aflameDurationFrames: number; burnedDelayFrames: number } | null }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.flammableProfile).not.toBeNull();
    expect(entity.flammableProfile!.flameDamageLimit).toBe(10);
    // 2000ms at 30fps = 60 frames
    expect(entity.flammableProfile!.aflameDurationFrames).toBe(60);
    expect(entity.flammableProfile!.burnedDelayFrames).toBe(0);
  });

  it('ignites entity after exceeding fire damage threshold', () => {
    const { logic } = makeFlammableSetup({ flameDamageLimit: 10, attackDamage: 20 });

    // Attack with flame weapon to trigger ignition.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { flameStatus: string; objectStatusFlags: Set<string> }>;
    };
    const target = priv.spawnedEntities.get(1)!;
    expect(target.flameStatus).toBe('AFLAME');
    expect(target.objectStatusFlags.has('AFLAME')).toBe(true);
  });

  it('applies periodic fire damage while AFLAME', () => {
    const { logic } = makeFlammableSetup({
      flameDamageLimit: 1, // Low threshold for instant ignition
      aflameDurationMs: 5000,
      aflameDamageDelayMs: 200, // ~6 frames between damage ticks
      aflameDamageAmount: 10,
      attackDamage: 5,
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    // Initial attack + ignition.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const healthAfterIgnition = logic.getEntityState(1)!.health;

    // Run more frames for fire DoT to tick.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const healthAfterBurning = logic.getEntityState(1)!.health;
    expect(healthAfterBurning).toBeLessThan(healthAfterIgnition);
  });

  it('transitions to NORMAL (not BURNED) when burnedDelay is 0', () => {
    const { logic } = makeFlammableSetup({
      flameDamageLimit: 1,
      aflameDurationMs: 500, // ~15 frames
      burnedDelayMs: 0, // No burned state
      attackDamage: 5,
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { flameStatus: string; objectStatusFlags: Set<string> }>;
    };
    const target = priv.spawnedEntities.get(1)!;
    expect(target.flameStatus).toBe('AFLAME');

    // Run past aflameDuration (~15 frames).
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Should transition to NORMAL (can burn again), NOT BURNED.
    expect(target.flameStatus).toBe('NORMAL');
    expect(target.objectStatusFlags.has('AFLAME')).toBe(false);
    expect(target.objectStatusFlags.has('BURNED')).toBe(false);
  });

  it('transitions to BURNED when burnedDelay < aflameDuration', () => {
    const { logic } = makeFlammableSetup({
      flameDamageLimit: 1,
      aflameDurationMs: 2000, // ~60 frames
      burnedDelayMs: 500, // ~15 frames — BURNED set before flame ends
      attackDamage: 5,
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { flameStatus: string; objectStatusFlags: Set<string> }>;
    };
    const target = priv.spawnedEntities.get(1)!;
    expect(target.flameStatus).toBe('AFLAME');

    // Run 20 frames — past burnedDelay but before aflameDuration.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    expect(target.objectStatusFlags.has('BURNED')).toBe(true);
    expect(target.flameStatus).toBe('AFLAME'); // Still burning.

    // Run past aflameDuration.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    expect(target.flameStatus).toBe('BURNED');
    expect(target.objectStatusFlags.has('AFLAME')).toBe(false);
  });

  it('transitions to NORMAL when burnedDelay > aflameDuration (burned timer never fires)', () => {
    const { logic } = makeFlammableSetup({
      flameDamageLimit: 1,
      aflameDurationMs: 1000, // ~30 frames
      burnedDelayMs: 5000, // ~150 frames — burned timer fires AFTER flame ends
      attackDamage: 5,
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { flameStatus: string; objectStatusFlags: Set<string> }>;
    };
    const target = priv.spawnedEntities.get(1)!;
    expect(target.flameStatus).toBe('AFLAME');

    // Run past aflameDuration (~30 frames) but well before burnedDelay (~150 frames).
    for (let i = 0; i < 40; i++) logic.update(1 / 30);
    // BURNED status flag was never set because burnedDelay hasn't elapsed.
    expect(target.objectStatusFlags.has('BURNED')).toBe(false);
    // So entity transitions to NORMAL, not BURNED.
    expect(target.flameStatus).toBe('NORMAL');
  });
});

describe('FireSpreadUpdate', () => {
  function makeFireSpreadSetup(opts: {
    spreadTryRange?: number;
    minSpreadDelayMs?: number;
    maxSpreadDelayMs?: number;
  } = {}) {
    // Entity that can catch fire AND spread fire to others.
    const spreaderDef = makeObjectDef('Spreader', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
        FlameDamageLimit: 1,
        AflameDuration: 10000,
        AflameDamageDelay: 500,
        AflameDamageAmount: 5,
      }),
      makeBlock('Behavior', 'FireSpreadUpdate ModuleTag_FireSpread', {
        MinSpreadDelay: opts.minSpreadDelayMs ?? 100,
        MaxSpreadDelay: opts.maxSpreadDelayMs ?? 100,
        SpreadTryRange: opts.spreadTryRange ?? 50,
      }),
    ]);

    // Nearby target that can catch fire but does NOT spread it.
    const targetDef = makeObjectDef('Target', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
        FlameDamageLimit: 1,
        AflameDuration: 10000,
        AflameDamageDelay: 500,
        AflameDamageAmount: 5,
      }),
    ]);

    // Attacker with flame weapon — co-located with spreader for instant attack.
    const attackerDef = makeObjectDef('Flamer', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'FlameGun'] }),
    ]);
    const flameWeapon = makeWeaponDef('FlameGun', {
      AttackRange: 200,
      PrimaryDamage: 20,
      PrimaryDamageRadius: 0,
      DamageType: 'FLAME',
      DeliveryType: 'DIRECT',
    });

    const mapObjects = [
      makeMapObject('Spreader', 5, 5),   // Entity that will burn and spread fire
      makeMapObject('Target', 7, 7),      // Nearby entity that should catch fire
      makeMapObject('Flamer', 5, 5),      // Enemy attacker co-located with spreader
    ];

    const bundle = makeBundle({
      objects: [spreaderDef, targetDef, attackerDef],
      weapons: [flameWeapon],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects), makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, MapEntity>;
      frameCounter: number;
    };

    return { logic, priv };
  }

  it('spreads fire from burning entity to nearby flammable entity', () => {
    const { logic, priv } = makeFireSpreadSetup();

    const spreader = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    expect(spreader.flameStatus).toBe('NORMAL');
    expect(target.flameStatus).toBe('NORMAL');

    // Command attacker to fire at the spreader.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    // Run enough frames for the attack to fire and ignite the spreader.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(spreader.flameStatus).toBe('AFLAME');

    // After enough frames, fire should spread to nearby target.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(target.flameStatus).toBe('AFLAME');
  });

  it('does not spread fire to entities outside range', () => {
    // Place target far from spreader. Use custom setup with far-away target.
    const spreaderDef = makeObjectDef('Spreader', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
        FlameDamageLimit: 1,
        AflameDuration: 10000,
        AflameDamageDelay: 500,
        AflameDamageAmount: 5,
      }),
      makeBlock('Behavior', 'FireSpreadUpdate ModuleTag_FireSpread', {
        MinSpreadDelay: 100,
        MaxSpreadDelay: 100,
        SpreadTryRange: 1, // Very short range (10 world units).
      }),
    ]);
    const targetDef = makeObjectDef('Target', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
        FlameDamageLimit: 1,
        AflameDuration: 10000,
        AflameDamageDelay: 500,
        AflameDamageAmount: 5,
      }),
    ]);
    const attackerDef = makeObjectDef('Flamer', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'FlameGun'] }),
    ]);
    const flameWeapon = makeWeaponDef('FlameGun', {
      AttackRange: 200,
      PrimaryDamage: 20,
      PrimaryDamageRadius: 0,
      DamageType: 'FLAME',
      DeliveryType: 'DIRECT',
    });

    const bundle = makeBundle({
      objects: [spreaderDef, targetDef, attackerDef],
      weapons: [flameWeapon],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Spreader', 5, 5),
        makeMapObject('Target', 60, 60), // Far away from spreader.
        makeMapObject('Flamer', 5, 5),   // Co-located with spreader.
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    // GLA neutral to China — attacker won't auto-target the far target.
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('GLA', 'China', 1);
    logic.setTeamRelationship('China', 'GLA', 1);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const spreader = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    // Ignite the spreader.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    expect(spreader.flameStatus).toBe('AFLAME');
    // Target should NOT have caught fire — out of fire spread range.
    expect(target.flameStatus).toBe('NORMAL');
  });

  it('does not spread fire to already burning or burned entities', () => {
    const { logic, priv } = makeFireSpreadSetup();

    const spreader = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    // Manually set target to BURNED so it can't ignite.
    target.flameStatus = 'BURNED';
    target.objectStatusFlags.add('BURNED');

    // Ignite the spreader.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    expect(spreader.flameStatus).toBe('AFLAME');
    // Target remains BURNED — not re-ignited.
    expect(target.flameStatus).toBe('BURNED');
  });
});

describe('PoisonedBehavior', () => {
  function makePoisonSetup(opts: {
    poisonDamageIntervalMs?: number;
    poisonDurationMs?: number;
    attackDamage?: number;
    includeAutoHeal?: boolean;
  } = {}) {
    const targetBlocks = [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'PoisonedBehavior ModuleTag_Poison', {
        PoisonDamageInterval: opts.poisonDamageIntervalMs ?? 333,
        PoisonDuration: opts.poisonDurationMs ?? 3000,
      }),
    ];
    if (opts.includeAutoHeal) {
      targetBlocks.push(
        makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AutoHeal', {
          HealingAmount: 50,
          HealingDelay: 0,
          StartHealingDelay: 0,
          StartsActive: 'Yes',
        }),
      );
    }
    const targetDef = makeObjectDef('PoisonTarget', 'America', ['INFANTRY'], targetBlocks);

    const attackerDef = makeObjectDef('PoisonAttacker', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ToxinGun'] }),
    ]);
    const toxinWeapon = makeWeaponDef('ToxinGun', {
      AttackRange: 200,
      PrimaryDamage: opts.attackDamage ?? 10,
      PrimaryDamageRadius: 0,
      DamageType: 'POISON',
      DelayBetweenShots: 500,
      WeaponSpeed: 999999,
    });

    const bundle = makeBundle({
      objects: [targetDef, attackerDef],
      weapons: [toxinWeapon],
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

  it('extracts PoisonedBehaviorProfile from INI', () => {
    const { logic } = makePoisonSetup({ poisonDamageIntervalMs: 500, poisonDurationMs: 5000 });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { poisonedBehaviorProfile: { poisonDamageIntervalFrames: number; poisonDurationFrames: number } | null }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.poisonedBehaviorProfile).not.toBeNull();
    // 500ms at 30fps = 15 frames
    expect(entity.poisonedBehaviorProfile!.poisonDamageIntervalFrames).toBe(15);
    // 5000ms at 30fps = 150 frames
    expect(entity.poisonedBehaviorProfile!.poisonDurationFrames).toBe(150);
  });

  it('applies poison DoT after POISON damage and clears on expiry', () => {
    const { logic } = makePoisonSetup({ poisonDamageIntervalMs: 333, poisonDurationMs: 1000, attackDamage: 10 });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; poisonDamageAmount: number; objectStatusFlags: Set<string> }>;
    };

    // Attack with poison weapon to trigger poison.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const target = priv.spawnedEntities.get(1)!;
    expect(target.objectStatusFlags.has('POISONED')).toBe(true);
    expect(target.poisonDamageAmount).toBeGreaterThan(0);
    const healthAfterPoison = target.health;
    expect(healthAfterPoison).toBeLessThan(500); // took initial + some tick damage

    // Stop the attacker so it doesn't keep re-poisoning.
    logic.submitCommand({ type: 'stop', entityId: 2 });

    // Run past poison duration (1000ms = 30 frames). Run extra to be safe.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Poison should have expired.
    expect(target.objectStatusFlags.has('POISONED')).toBe(false);
    expect(target.poisonDamageAmount).toBe(0);
  });

  it('healing clears poison state', () => {
    // C++ parity: PoisonedBehavior::onHealing clears poison when entity receives healing.
    // Directly set poison state on entity, then reduce health and run a frame so
    // the ambulance healer triggers clearPoisonFromEntity.
    const targetDef = makeObjectDef('PoisonHealTarget', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'PoisonedBehavior ModuleTag_Poison', {
        PoisonDamageInterval: 333,
        PoisonDuration: 10000,
      }),
    ]);
    // External healer with radius-mode AutoHeal.
    const healerDef = makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AutoHeal', {
        HealingAmount: 100,
        HealingDelay: 1,
        StartHealingDelay: 0,
        Radius: 200,
        StartsActive: 'Yes',
      }),
    ]);
    const bundle = makeBundle({ objects: [targetDef, healerDef], weapons: [] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PoisonHealTarget', 5, 5),
        makeMapObject('Ambulance', 5, 5),
      ]),
      makeRegistry(bundle), makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number; maxHealth: number; poisonDamageAmount: number;
        poisonNextDamageFrame: number; poisonExpireFrame: number;
        objectStatusFlags: Set<string>;
      }>;
    };
    const target = priv.spawnedEntities.get(1)!;

    // Manually inject poison state (simulating a POISON damage hit).
    target.poisonDamageAmount = 10;
    target.poisonNextDamageFrame = 9999; // Far future — no tick during test
    target.poisonExpireFrame = 9999;
    target.objectStatusFlags.add('POISONED');
    target.health = 400; // Below max so the ambulance will heal
    expect(target.objectStatusFlags.has('POISONED')).toBe(true);

    // Run a few frames. The ambulance should heal and clear poison.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    expect(target.objectStatusFlags.has('POISONED')).toBe(false);
    expect(target.poisonDamageAmount).toBe(0);
    expect(target.health).toBe(500); // Healed back to full
  });

  it('entities without PoisonedBehavior module cannot be poisoned', () => {
    // Create a target WITHOUT PoisonedBehavior module.
    const targetDef = makeObjectDef('NoPoisonTarget', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const attackerDef = makeObjectDef('PoisonAttacker2', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ToxinGun2'] }),
    ]);
    const toxinWeapon = makeWeaponDef('ToxinGun2', {
      AttackRange: 200,
      PrimaryDamage: 10,
      PrimaryDamageRadius: 0,
      DamageType: 'POISON',
      DelayBetweenShots: 500,
      WeaponSpeed: 999999,
    });

    const bundle = makeBundle({
      objects: [targetDef, attackerDef],
      weapons: [toxinWeapon],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NoPoisonTarget', 5, 5),
        makeMapObject('PoisonAttacker2', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Attack with poison weapon.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { poisonDamageAmount: number; objectStatusFlags: Set<string> }>;
    };
    const target = priv.spawnedEntities.get(1)!;
    // Entity takes POISON damage but should NOT become poisoned (no PoisonedBehavior module).
    expect(target.objectStatusFlags.has('POISONED')).toBe(false);
    expect(target.poisonDamageAmount).toBe(0);
  });
});

describe('StickyBombUpdate', () => {
  it('extracts StickyBombUpdateProfile from INI', () => {
    const bombDef = makeObjectDef('StickyBomb', 'America', ['VEHICLE', 'BOOBY_TRAP'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      {
        type: 'Behavior',
        name: 'StickyBombUpdate ModuleTag_StickyBomb',
        fields: {
          GeometryBasedDamageWeapon: 'StickyBombDetonation',
          OffsetZ: 15.0,
        },
        blocks: [],
      },
    ]);
    const bundle = makeBundle({ objects: [bombDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StickyBomb', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        stickyBombProfile: { offsetZ: number; geometryBasedDamageWeaponName: string | null } | null;
      }>;
    };
    const bomb = priv.spawnedEntities.get(1)!;
    expect(bomb.stickyBombProfile).not.toBeNull();
    expect(bomb.stickyBombProfile!.offsetZ).toBe(15.0);
    expect(bomb.stickyBombProfile!.geometryBasedDamageWeaponName).toBe('StickyBombDetonation');
  });

  it('tracks mobile target position each frame', () => {
    // Create a bomb and a mobile target.
    const targetDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const bombDef = makeObjectDef('StickyBomb', 'America', ['VEHICLE', 'BOOBY_TRAP'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      {
        type: 'Behavior',
        name: 'StickyBombUpdate ModuleTag_SB',
        fields: { OffsetZ: 10 },
        blocks: [],
      },
    ]);
    const bundle = makeBundle({ objects: [targetDef, bombDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),
        makeMapObject('StickyBomb', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; z: number;
        stickyBombTargetId: number;
        objectStatusFlags: Set<string>;
      }>;
    };
    const bomb = priv.spawnedEntities.get(2)!;
    const target = priv.spawnedEntities.get(1)!;

    // Manually attach bomb to target (simulates OCL onCreatePost).
    bomb.stickyBombTargetId = 1;
    target.objectStatusFlags.add('BOOBY_TRAPPED');

    // Move target.
    target.x = 50;
    target.z = 60;
    logic.update(1 / 30);

    // Bomb should follow target position.
    expect(bomb.x).toBe(50);
    expect(bomb.z).toBe(60);
  });

  it('detonates bomb with geometry-scaled damage when LifetimeUpdate timer expires', () => {
    // Bomb with LifetimeUpdate (30 frames = 1 second).
    const targetDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ], {
      GeometryMajorRadius: 20,
    });
    const bombDef = makeObjectDef('StickyBomb', 'America', ['VEHICLE', 'BOOBY_TRAP'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      {
        type: 'Behavior',
        name: 'StickyBombUpdate ModuleTag_SB',
        fields: {
          GeometryBasedDamageWeapon: 'StickyBombWeapon',
          OffsetZ: 10,
        },
        blocks: [],
      },
      {
        type: 'Behavior',
        name: 'LifetimeUpdate ModuleTag_Lifetime',
        fields: {
          MinLifetime: 1000, // 30 frames
          MaxLifetime: 1000,
        },
        blocks: [],
      },
    ]);
    // Nearby enemy unit to take splash damage (500 HP so it survives the 200 damage detonation).
    const bystander = makeObjectDef('Infantry', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const detonationWeapon = makeWeaponDef('StickyBombWeapon', {
      PrimaryDamage: 200,
      PrimaryDamageRadius: 30,
      DamageType: 'EXPLOSION',
    });
    const bundle = makeBundle({
      objects: [targetDef, bombDef, bystander],
      weapons: [detonationWeapon],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),        // id 1
        makeMapObject('StickyBomb', 10, 10),   // id 2
        makeMapObject('Infantry', 10, 10),     // id 3 (within blast radius)
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; z: number;
        health: number;
        destroyed: boolean;
        stickyBombTargetId: number;
        objectStatusFlags: Set<string>;
      }>;
    };
    const bomb = priv.spawnedEntities.get(2)!;
    const target = priv.spawnedEntities.get(1)!;

    // Attach bomb to target.
    bomb.stickyBombTargetId = 1;
    target.objectStatusFlags.add('BOOBY_TRAPPED');

    const targetInitialHealth = target.health;
    const bystanderInitialHealth = priv.spawnedEntities.get(3)!.health;

    // Advance past LifetimeUpdate timer (30 frames).
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    // Bomb should be destroyed.
    expect(bomb.destroyed).toBe(true);

    // Target should have taken geometry-scaled damage (radius = 30 + 20 majorRadius = 50).
    expect(target.health).toBeLessThan(targetInitialHealth);

    // Bystander at same position should also have taken damage.
    const bystander3 = priv.spawnedEntities.get(3)!;
    expect(bystander3.health).toBeLessThan(bystanderInitialHealth);

    // BOOBY_TRAPPED status should be cleared.
    expect(target.objectStatusFlags.has('BOOBY_TRAPPED')).toBe(false);
  });

  it('detonates bomb via checkAndDetonateBoobyTrap when target dies', () => {
    const targetDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], {
      GeometryMajorRadius: 10,
    });
    const bombDef = makeObjectDef('StickyBomb', 'America', ['VEHICLE', 'BOOBY_TRAP'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      {
        type: 'Behavior',
        name: 'StickyBombUpdate ModuleTag_SB',
        fields: {
          GeometryBasedDamageWeapon: 'StickyBombWeapon2',
          OffsetZ: 10,
        },
        blocks: [],
      },
    ]);
    // Attacker to kill the target.
    const attackerDef = makeObjectDef('Attacker', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
    ]);
    const attackerWeapon = makeWeaponDef('BigGun', {
      AttackRange: 200,
      PrimaryDamage: 200,
      PrimaryDamageRadius: 0,
      DamageType: 'ARMOR_PIERCING',
      DelayBetweenShots: 100,
      WeaponSpeed: 999999,
    });
    const detonationWeapon = makeWeaponDef('StickyBombWeapon2', {
      PrimaryDamage: 150,
      PrimaryDamageRadius: 25,
      DamageType: 'EXPLOSION',
    });
    // Nearby enemy bystander to verify splash damage from detonation.
    const bystanderDef = makeObjectDef('Bystander', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const bundle = makeBundle({
      objects: [targetDef, bombDef, attackerDef, bystanderDef],
      weapons: [attackerWeapon, detonationWeapon],
      commandSets: [makeCommandSetDef('AttackerCS', { '1': 'AttackButton' })],
      commandButtons: [makeCommandButtonDef('AttackButton', {
        Command: 'ATTACK_MOVE',
        Options: 'NEED_TARGET_ENEMY_OBJECT',
      })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),       // id 1 — target
        makeMapObject('StickyBomb', 10, 10),  // id 2 — bomb
        makeMapObject('Attacker', 10, 10),    // id 3 — attacker
        makeMapObject('Bystander', 10, 10),   // id 4 — splash damage recipient
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        stickyBombTargetId: number;
        objectStatusFlags: Set<string>;
      }>;
    };
    const bomb = priv.spawnedEntities.get(2)!;
    const target = priv.spawnedEntities.get(1)!;

    // Attach bomb to target.
    bomb.stickyBombTargetId = 1;
    target.objectStatusFlags.add('BOOBY_TRAPPED');

    const bystanderInitialHealth = priv.spawnedEntities.get(4)!.health;

    // Order attacker to kill the target.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Target should be destroyed (200 damage > 100 HP).
    expect(target.destroyed).toBe(true);

    // Bomb should also be destroyed (via checkAndDetonateBoobyTrap → detonateStickyBomb → markEntityDestroyed,
    // or via updateStickyBombs → silentDestroyEntity when target is dead).
    expect(bomb.destroyed).toBe(true);

    // Bystander should have taken splash damage from the bomb detonation.
    const bystander4 = priv.spawnedEntities.get(4)!;
    expect(bystander4.health).toBeLessThan(bystanderInitialHealth);
  });

  it('silently destroys bomb when target is already dead and bomb has no lifetime', () => {
    const targetDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bombDef = makeObjectDef('StickyBomb', 'America', ['VEHICLE', 'BOOBY_TRAP'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      {
        type: 'Behavior',
        name: 'StickyBombUpdate ModuleTag_SB',
        fields: { OffsetZ: 10 },
        blocks: [],
      },
    ]);
    const bundle = makeBundle({ objects: [targetDef, bombDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),
        makeMapObject('StickyBomb', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        destroyed: boolean;
        stickyBombTargetId: number;
        objectStatusFlags: Set<string>;
      }>;
    };
    const bomb = priv.spawnedEntities.get(2)!;
    const target = priv.spawnedEntities.get(1)!;

    // Attach bomb.
    bomb.stickyBombTargetId = 1;
    target.objectStatusFlags.add('BOOBY_TRAPPED');

    // Destroy target directly (simulate external death without booby trap check).
    (target as unknown as { destroyed: boolean }).destroyed = true;

    // Next update: bomb's updateStickyBombs sees target is dead, silently destroys bomb.
    logic.update(1 / 30);

    expect(bomb.destroyed).toBe(true);
  });
});

describe('EMPUpdate', () => {
  it('parses and updates EMP visual scale and tint fields', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 100,
            DisabledDuration: 3000,
            EffectRadius: 200,
            StartScale: 0.25,
            TargetScaleMin: 3,
            TargetScaleMax: 3,
            StartColor: ['R:10', 'G:20', 'B:30'],
            EndColor: ['R:40', 'G:50', 'B:60'],
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('EMPPulse', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const emp = (logic as any).spawnedEntities.get(1)!;
    expect(emp.empUpdateProfile.startScale).toBe(0.25);
    expect(emp.empUpdateProfile.targetScaleMin).toBe(3);
    expect(emp.empUpdateProfile.targetScaleMax).toBe(3);
    expect(emp.empUpdateProfile.startColor).toEqual([10, 20, 30]);
    expect(emp.empUpdateProfile.endColor).toEqual([40, 50, 60]);

    logic.update(1 / 30);
    expect(emp.empUpdateState.targetScale).toBe(3);
    expect(emp.empUpdateState.currentScale).toBeCloseTo(0.25 + (3 - 0.25) * 0.05, 10);
    expect(emp.empUpdateState.currentTintColor).toEqual([20, 40, 60]);

    for (let i = 0; i < 4; i++) logic.update(1 / 30);
    expect(emp.empUpdateState.currentTintColor).toEqual([200, 250, 255]);
    expect(emp.empUpdateState.tintFadeFrames).toBe(6);
  });

  it('disables nearby vehicles after fade frame and self-destructs at lifetime end', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,          // 9 frames
            StartFadeTime: 100,     // 3 frames — disable attack fires here
            DisabledDuration: 3000, // 90 frames
            EffectRadius: 200,
          }),
        ]),
        makeObjectDef('Tank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Tank', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Frame 0-2: before fade frame — tank should not be disabled.
    for (let i = 0; i < 2; i++) logic.update(1 / 30);
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);

    // Frame 3+: after fade frame — tank should become disabled.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);

    // After lifetime (9 frames total), EMP pulse entity should be destroyed.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)).toBeNull();

    // Tank should still exist (was disabled, not killed).
    expect(logic.getEntityState(2)).not.toBeNull();
    expect(logic.getEntityState(2)!.health).toBe(500);
  });

  it('emits DisableFXParticleSystem sparks on disabled victims', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
            DisableFXParticleSystem: 'EMPSparks',
          }),
        ]),
        makeObjectDef('Tank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 5,
          GeometryMinorRadius: 5,
          GeometryHeight: 10,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Tank', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.drainVisualEvents();

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const sparkEvents = logic.drainVisualEvents().filter((event) =>
      event.type === 'NAMED_PARTICLE_SYSTEM' && event.effectName === 'EMPSparks');
    expect(sparkEvents).toHaveLength(15);
    for (const event of sparkEvents) {
      expect(event.sourceEntityId).toBe(2);
      expect(event.lifetimeFrames).toBe(60);
      expect(Number.isFinite(event.x)).toBe(true);
      expect(Number.isFinite(event.y)).toBe(true);
      expect(Number.isFinite(event.z)).toBe(true);
    }
  });

  it('skips infantry targets (unless SPAWNS_ARE_THE_WEAPONS)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
          }),
        ]),
        makeObjectDef('Soldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], {
          TransportSlotCount: 1,
        }),
        makeObjectDef('SpawnMaster', 'China', ['VEHICLE', 'SPAWNS_ARE_THE_WEAPONS'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Soldier', 55, 50),
        makeMapObject('SpawnMaster', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Run past StartFadeTime (0 = immediate).
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    // Infantry should NOT be disabled.
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    // SPAWNS_ARE_THE_WEAPONS vehicle should be disabled (it's a vehicle, not filtered).
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('kills airborne aircraft instead of disabling them', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
          }),
        ]),
        makeObjectDef('Jet', 'China', ['AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Jet', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Set the jet as airborne.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    priv.spawnedEntities.get(2)!.objectStatusFlags.add('AIRBORNE_TARGET');

    // Run past StartFadeTime.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Airborne aircraft should be killed, not just disabled.
    expect(logic.getEntityState(2)).toBeNull();
  });

  it('limits EMP blast to airborne victims when producer targeted airborne aircraft', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
          }),
        ]),
        makeObjectDef('Producer', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('GroundTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Jet', 'China', ['AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Producer', 48, 50),
        makeMapObject('GroundTank', 55, 50),
        makeMapObject('Jet', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        producerEntityId: number;
        attackTargetEntityId: number | null;
        objectStatusFlags: Set<string>;
      }>;
    };
    priv.spawnedEntities.get(1)!.producerEntityId = 2;
    priv.spawnedEntities.get(2)!.attackTargetEntityId = 4;
    priv.spawnedEntities.get(4)!.objectStatusFlags.add('AIRBORNE_TARGET');

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    expect(logic.getEntityState(4)).toBeNull();
  });

  it('disables intended airborne aircraft on EMP near-miss edge case', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 5,
          }),
        ]),
        makeObjectDef('Producer', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Jet', 'China', ['AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Producer', 48, 50),
        makeMapObject('Jet', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        producerEntityId: number;
        attackTargetEntityId: number | null;
        objectStatusFlags: Set<string>;
      }>;
    };
    priv.spawnedEntities.get(1)!.producerEntityId = 2;
    priv.spawnedEntities.get(2)!.attackTargetEntityId = 3;
    priv.spawnedEntities.get(3)!.objectStatusFlags.add('AIRBORNE_TARGET');

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    expect(logic.getEntityState(3)).not.toBeNull();
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('EMP_HARDENED ground vehicles are still disabled but airborne EMP_HARDENED aircraft survive', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
          }),
        ]),
        makeObjectDef('HardenedTank', 'China', ['VEHICLE', 'EMP_HARDENED'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('HardenedJet', 'China', ['VEHICLE', 'AIRCRAFT', 'EMP_HARDENED'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('HardenedTank', 55, 50),
        makeMapObject('HardenedJet', 52, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string>; health: number }>;
    };
    // Make the jet airborne.
    priv.spawnedEntities.get(3)!.objectStatusFlags.add('AIRBORNE_TARGET');

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Ground EMP_HARDENED vehicle SHOULD still be disabled (C++ parity: EMP_HARDENED only protects airborne aircraft).
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    // Airborne EMP_HARDENED aircraft should NOT be killed.
    expect(priv.spawnedEntities.get(3)!.health).toBe(300);
  });

  it('doesNotAffectMyOwnBuildings skips friendly structures', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
            DoesNotAffectMyOwnBuildings: 'Yes',
          }),
        ]),
        makeObjectDef('FriendlyPower', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('EnemyPower', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('FriendlyPower', 55, 50),
        makeMapObject('EnemyPower', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    // Friendly structure should NOT be disabled (DoesNotAffectMyOwnBuildings).
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    // Enemy structure should be disabled.
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('DoesNotAffect ALLIES skips allied non-structures in source order', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 3000,
            EffectRadius: 200,
            DoesNotAffect: ['ALLIES'],
          }),
        ]),
        makeObjectDef('FriendlyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('FriendlyPower', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('FriendlyTank', 55, 50),
        makeMapObject('EnemyTank', 60, 50),
        makeMapObject('FriendlyPower', 65, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    // Source EMPUpdate.cpp checks m_rejectMask after the structure/airborne else-if branches.
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(priv.spawnedEntities.get(4)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('DISABLED_EMP expires after configured duration', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EMPPulse', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'EMPUpdate ModuleTag_EMP', {
            Lifetime: 300,
            StartFadeTime: 0,
            DisabledDuration: 500,  // 15 frames
            EffectRadius: 200,
          }),
        ]),
        makeObjectDef('Tank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EMPPulse', 50, 50),
        makeMapObject('Tank', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Trigger the EMP (StartFadeTime = 0 → immediate).
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);

    // Run past the 15-frame disable duration + some buffer.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // DISABLED_EMP should have expired.
    const tank = priv.spawnedEntities.get(2);
    if (tank) {
      expect(tank.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    }
  });
});

describe('LeafletDropBehavior', () => {
  it('emits LeafletFXParticleSystem on first update before delayed disable', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LeafletContainer', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'LeafletDropBehavior ModuleTag_Leaflet', {
            Delay: 2500,
            DisabledDuration: 20000,
            AffectRadius: 110,
            LeafletFXParticleSystem: 'LeafletParticles1',
          }),
        ]),
        makeObjectDef('EnemyInfantry', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('LeafletContainer', 50, 50),
        makeMapObject('EnemyInfantry', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.drainVisualEvents();

    logic.update(1 / 30);
    expect(logic.drainVisualEvents()).toContainEqual(expect.objectContaining({
      type: 'NAMED_PARTICLE_SYSTEM',
      effectName: 'LeafletParticles1',
      sourceEntityId: 1,
      x: 50,
      z: 50,
    }));

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);

    const preDelayEvents: ReturnType<typeof logic.drainVisualEvents> = [];
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      preDelayEvents.push(...logic.drainVisualEvents());
    }
    expect(preDelayEvents).not.toContainEqual(expect.objectContaining({
      type: 'NAMED_PARTICLE_SYSTEM',
      effectName: 'LeafletParticles1',
    }));
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);

    for (let i = 0; i < 80; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('fires the disable attack from onDie even before the delay expires', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LeafletContainer', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'LeafletDropBehavior ModuleTag_Leaflet', {
            Delay: 10000,
            DisabledDuration: 20000,
            AffectRadius: 110,
            LeafletFXParticleSystem: 'LeafletParticles1',
          }),
        ]),
        makeObjectDef('EnemyInfantry', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('LeafletContainer', 50, 50),
        makeMapObject('EnemyInfantry', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string>; health: number }>;
      markEntityDestroyed(entityId: number, attackerId: number): void;
    };
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);

    priv.spawnedEntities.get(1)!.health = 0;
    priv.markEntityDestroyed(1, -1);

    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });
});

describe('NeutronBlastBehavior', () => {
  it('kills infantry and makes vehicles unmanned on death', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NeutronShell', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'NeutronBlastBehavior ModuleTag_NB', {
            BlastRadius: 200,
            AffectAirborne: 'Yes',
            AffectAllies: 'Yes',
          }),
        ]),
        makeObjectDef('Infantry1', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('Vehicle1', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronShell', 50, 50),
        makeMapObject('Infantry1', 51, 50),
        makeMapObject('Vehicle1', 52, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Run one frame to initialize.
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        side: string;
        objectStatusFlags: Set<string>;
      }>;
    };

    const shell = priv.spawnedEntities.get(1)!;
    const infantry = priv.spawnedEntities.get(2)!;
    const vehicle = priv.spawnedEntities.get(3)!;

    // Verify all alive before blast.
    expect(infantry.destroyed).toBe(false);
    expect(vehicle.destroyed).toBe(false);

    // Kill the neutron shell to trigger the blast.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 1 });
    // Apply direct damage to kill the shell.
    const privLogic = logic as unknown as {
      applyWeaponDamageAmount(attackerId: number | null, target: { id: number }, amount: number, damageType: string): void;
      spawnedEntities: Map<number, unknown>;
    };
    // Use a direct kill via unresistable damage.
    const shellEntity = privLogic.spawnedEntities.get(1) as { maxHealth: number; id: number };
    (logic as unknown as { applyWeaponDamageAmount(a: null, t: unknown, amount: number, dt: string): void })
      .applyWeaponDamageAmount(null, shellEntity, 1000, 'UNRESISTABLE');

    // Run a frame to process death.
    logic.update(1 / 30);

    // Infantry should be dead (killed by neutron blast).
    expect(infantry.destroyed).toBe(true);
    // Vehicle should be alive but unmanned.
    expect(vehicle.destroyed).toBe(false);
    expect(vehicle.objectStatusFlags.has('DISABLED_UNMANNED')).toBe(true);
    // Vehicle should be transferred to neutral (empty side).
    expect(vehicle.side).toBe('');
  });

  it('respects AffectAllies=No by sparing allied units', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NeutronShell', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'NeutronBlastBehavior ModuleTag_NB', {
            BlastRadius: 200,
            AffectAllies: 'No',
          }),
        ]),
        makeObjectDef('FriendlyInf', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('EnemyInf', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronShell', 50, 50),
        makeMapObject('FriendlyInf', 51, 50),
        makeMapObject('EnemyInf', 52, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { destroyed: boolean; health: number }>;
    };

    // Capture references BEFORE the kill (finalizeDestroyedEntities removes dead entities from the map).
    const friendly = priv.spawnedEntities.get(2)!;
    const enemy = priv.spawnedEntities.get(3)!;

    // Kill the shell to trigger the blast.
    const shellEntity = priv.spawnedEntities.get(1) as { id: number; maxHealth: number };
    (logic as unknown as { applyWeaponDamageAmount(a: null, t: unknown, amount: number, dt: string): void })
      .applyWeaponDamageAmount(null, shellEntity, 1000, 'UNRESISTABLE');

    logic.update(1 / 30);

    // Allied infantry should be spared.
    expect(friendly.destroyed).toBe(false);

    // Enemy infantry should be killed.
    expect(enemy.destroyed).toBe(true);
  });

  it('respects AffectAirborne=No by skipping aircraft and airborne targets', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NeutronShell', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'NeutronBlastBehavior ModuleTag_NB', {
            BlastRadius: 200,
            AffectAirborne: 'No',
          }),
        ]),
        makeObjectDef('EnemyJet', 'China', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('AirborneTargetVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('GroundVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronShell', 50, 50),
        makeMapObject('EnemyJet', 51, 50),
        makeMapObject('AirborneTargetVehicle', 52, 50),
        makeMapObject('GroundVehicle', 53, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        destroyed: boolean;
        objectStatusFlags: Set<string>;
      }>;
    };

    const jet = priv.spawnedEntities.get(2)!;
    const airborneVehicle = priv.spawnedEntities.get(3)!;
    const groundVehicle = priv.spawnedEntities.get(4)!;
    airborneVehicle.objectStatusFlags.add('AIRBORNE_TARGET');

    const shellEntity = priv.spawnedEntities.get(1) as { id: number; maxHealth: number };
    (logic as unknown as { applyWeaponDamageAmount(a: null, t: unknown, amount: number, dt: string): void })
      .applyWeaponDamageAmount(null, shellEntity, 1000, 'UNRESISTABLE');

    logic.update(1 / 30);

    expect(jet.destroyed).toBe(false);
    expect(jet.objectStatusFlags.has('DISABLED_UNMANNED')).toBe(false);
    expect(airborneVehicle.destroyed).toBe(false);
    expect(airborneVehicle.objectStatusFlags.has('DISABLED_UNMANNED')).toBe(false);
    expect(groundVehicle.destroyed).toBe(false);
    expect(groundVehicle.objectStatusFlags.has('DISABLED_UNMANNED')).toBe(true);
  });

  it('kills CLIFF_JUMPER vehicles outright instead of making them unmanned', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NeutronShell', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'NeutronBlastBehavior ModuleTag_NB', {
            BlastRadius: 200,
          }),
        ]),
        makeObjectDef('CombatBike', 'China', ['VEHICLE', 'CLIFF_JUMPER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('NormalVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronShell', 50, 50),
        makeMapObject('CombatBike', 51, 50),
        makeMapObject('NormalVehicle', 52, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        destroyed: boolean;
        objectStatusFlags: Set<string>;
      }>;
    };

    // Capture references BEFORE the kill (entities are removed from map on finalize).
    const bike = priv.spawnedEntities.get(2)!;
    const normal = priv.spawnedEntities.get(3)!;

    // Kill the shell.
    const shellEntity = priv.spawnedEntities.get(1) as { id: number; maxHealth: number };
    (logic as unknown as { applyWeaponDamageAmount(a: null, t: unknown, amount: number, dt: string): void })
      .applyWeaponDamageAmount(null, shellEntity, 1000, 'UNRESISTABLE');

    logic.update(1 / 30);

    // CLIFF_JUMPER should be killed outright.
    expect(bike.destroyed).toBe(true);

    // Normal vehicle should be alive but unmanned.
    expect(normal.destroyed).toBe(false);
    expect(normal.objectStatusFlags.has('DISABLED_UNMANNED')).toBe(true);
  });

  it('kills contained passengers inside vehicles', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NeutronShell', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'NeutronBlastBehavior ModuleTag_NB', {
            BlastRadius: 200,
          }),
        ]),
        makeObjectDef('GarrisonHouse', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_GC', {
            MaxOccupants: 10,
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
        makeObjectDef('Soldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], {
          TransportSlotCount: 1,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronShell', 50, 50),
        makeMapObject('GarrisonHouse', 51, 50),
        makeMapObject('Soldier', 51, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Put the soldier inside the garrison.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 2 });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { destroyed: boolean; garrisonContainerId: number | null }>;
    };

    // Capture references BEFORE the kill.
    const soldier = priv.spawnedEntities.get(3)!;
    const building = priv.spawnedEntities.get(2)!;

    // Verify soldier is garrisoned.
    expect(soldier.garrisonContainerId).toBe(2);

    // Kill the shell.
    const shellEntity = priv.spawnedEntities.get(1) as { id: number; maxHealth: number };
    (logic as unknown as { applyWeaponDamageAmount(a: null, t: unknown, amount: number, dt: string): void })
      .applyWeaponDamageAmount(null, shellEntity, 1000, 'UNRESISTABLE');

    logic.update(1 / 30);

    // Garrisoned soldier should be killed by neutron blast.
    expect(soldier.destroyed).toBe(true);

    // Building itself should survive (not infantry or vehicle).
    expect(building.destroyed).toBe(false);
  });
});

describe('CleanupHazardUpdate', () => {
  function makeCleanupBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Worker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'CleanupGun'] }),
          makeBlock('Behavior', 'CleanupHazardUpdate ModuleTag_CHU', {
            WeaponSlot: 'PRIMARY',
            ScanRate: 200,   // 200ms → 6 frames
            ScanRange: 100,
          }),
        ]),
        makeObjectDef('ToxinPuddle', 'Neutral', ['CLEANUP_HAZARD'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('CleanupGun', {
          AttackRange: 80,
          PrimaryDamage: 100,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
      ],
    });
  }

  it('extracts cleanup hazard profile from INI', () => {
    const bundle = makeCleanupBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Worker', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        cleanupHazardProfile: { weaponSlot: string; scanFrames: number; scanRange: number } | null;
      }>;
    };

    const worker = [...priv.spawnedEntities.values()][0]!;
    expect(worker.cleanupHazardProfile).not.toBeNull();
    expect(worker.cleanupHazardProfile!.scanRange).toBe(100);
    expect(worker.cleanupHazardProfile!.scanFrames).toBe(6); // 200ms → 6 frames
  });

  it('auto-attacks nearby CLEANUP_HAZARD entities', () => {
    const bundle = makeCleanupBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Worker', 10, 10),
        makeMapObject('ToxinPuddle', 25, 10), // 15 units away — well within scan range of 100
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Worker and ToxinPuddle are both neutral/enemy? Worker is America, puddle is Neutral.
    // CleanupHazard doesn't need enemy relationship — it targets CLEANUP_HAZARD by kindOf.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
        cleanupHazardState: { bestTargetId: number } | null;
      }>;
    };

    const puddle = [...priv.spawnedEntities.values()].find(e => e.health === 50)!;
    expect(puddle).toBeDefined();

    // Run frames for the worker to scan and attack.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
      if (puddle.health < 50) break;
    }

    // The puddle should have taken damage or be destroyed.
    expect(puddle.health).toBeLessThan(50);
  });

  it('ignores hazards outside scan range', () => {
    const bundle = makeCleanupBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Worker', 10, 10),
        makeMapObject('ToxinPuddle', 200, 200), // ~270 units away — beyond scan range of 100
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
      }>;
    };

    const puddle = [...priv.spawnedEntities.values()].find(e => e.health === 50)!;

    // Run many frames.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Puddle should be unharmed.
    expect(puddle.health).toBe(50);
  });
});

describe('SubdualDamageHelper', () => {
  it('accumulates subdual damage instead of reducing health', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SubdualTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            SubdualDamageCap: 200,
            SubdualDamageHealRate: 1000,
            SubdualDamageHealAmount: 5,
          }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SubdualTarget', 10, 10),
        makeMapObject('Attacker', 20, 20),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { health: number; currentSubdualDamage: number; objectStatusFlags: Set<string> }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;
    expect(target.health).toBe(100);
    expect(target.currentSubdualDamage).toBe(0);

    // Apply subdual damage — health should NOT change, subdual damage should accumulate.
    privateApi.applyWeaponDamageAmount(2, target, 50, 'SUBDUAL_MISSILE');
    expect(target.health).toBe(100);
    expect(target.currentSubdualDamage).toBe(50);

    // Not yet subdued (50 < 100 maxHealth).
    expect(target.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(false);
  });

  it('sets DISABLED_SUBDUED when subdual damage reaches maxHealth', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SubdualTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            SubdualDamageCap: 200,
            SubdualDamageHealRate: 1000,
            SubdualDamageHealAmount: 5,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SubdualTarget', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { health: number; maxHealth: number; currentSubdualDamage: number; objectStatusFlags: Set<string> }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;

    // Apply enough subdual damage to subdue (>= maxHealth = 100).
    privateApi.applyWeaponDamageAmount(null, target, 100, 'SUBDUAL_VEHICLE');
    expect(target.health).toBe(100);
    expect(target.currentSubdualDamage).toBe(100);
    expect(target.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);
  });

  it('caps subdual damage at SubdualDamageCap', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SubdualTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            SubdualDamageCap: 150,
            SubdualDamageHealRate: 1000,
            SubdualDamageHealAmount: 5,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SubdualTarget', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { currentSubdualDamage: number }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;

    // Apply 300 subdual damage — should cap at 150.
    privateApi.applyWeaponDamageAmount(null, target, 300, 'SUBDUAL_BUILDING');
    expect(target.currentSubdualDamage).toBe(150);
  });

  it('heals subdual damage over time via SubdualDamageHelper', () => {
    // SubdualDamageHealRate = 100ms = 3 frames, SubdualDamageHealAmount = 20.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SubdualTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            SubdualDamageCap: 200,
            SubdualDamageHealRate: 100,
            SubdualDamageHealAmount: 20,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SubdualTarget', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { health: number; currentSubdualDamage: number; subdualHealingCountdown: number; objectStatusFlags: Set<string> }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;

    // Apply 120 subdual damage (subdued: 120 >= 100 maxHealth).
    privateApi.applyWeaponDamageAmount(null, target, 120, 'SUBDUAL_UNRESISTABLE');
    expect(target.currentSubdualDamage).toBe(120);
    expect(target.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);

    // Tick 3 frames (healRate = 100ms = 3 frames). After countdown expires, heals 20.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);
    expect(target.currentSubdualDamage).toBe(100);
    expect(target.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);

    // Another 3 frames → heals 20 → currentSubdualDamage = 80 (< maxHealth).
    for (let i = 0; i < 3; i++) logic.update(1 / 30);
    expect(target.currentSubdualDamage).toBe(80);
    expect(target.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(false);

    // Health should never have been reduced.
    expect(target.health).toBe(100);
  });

  it('ignores subdual damage on entities with SubdualDamageCap = 0', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NoSubdual', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            // No SubdualDamageCap — defaults to 0.
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('NoSubdual', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { health: number; currentSubdualDamage: number }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;

    // Subdual damage should be silently ignored.
    privateApi.applyWeaponDamageAmount(null, target, 500, 'SUBDUAL_MISSILE');
    expect(target.health).toBe(100);
    expect(target.currentSubdualDamage).toBe(0);
  });

  it('prefers vehicle/infantry/faction-structure attackers for same-frame subdual retaliation source', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SubdualTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            SubdualDamageCap: 200,
          }),
        ]),
        makeObjectDef('LowPriorityAttacker', 'China', ['AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('VehicleAttacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SubdualTarget', 10, 10),
        makeMapObject('LowPriorityAttacker', 20, 10),
        makeMapObject('VehicleAttacker', 30, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { lastAttackerEntityId: number | null }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;

    privateApi.applyWeaponDamageAmount(2, target, 10, 'SUBDUAL_MISSILE');
    expect(target.lastAttackerEntityId).toBe(2);

    // Same-frame vehicle hit should override low-priority aircraft source.
    privateApi.applyWeaponDamageAmount(3, target, 10, 'SUBDUAL_MISSILE');
    expect(target.lastAttackerEntityId).toBe(3);

    // Same-frame low-priority hit should not override preferred source.
    privateApi.applyWeaponDamageAmount(2, target, 10, 'SUBDUAL_MISSILE');
    expect(target.lastAttackerEntityId).toBe(3);
  });

  it('does not prioritize non-faction structures for same-frame subdual retaliation source', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SubdualTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 100,
            InitialHealth: 100,
            SubdualDamageCap: 200,
          }),
        ]),
        makeObjectDef('LowPriorityAttacker', 'China', ['AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('CivilianStructureAttacker', 'Civilian', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('FactionStructureAttacker', 'China', ['STRUCTURE', 'FS_BASE_DEFENSE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SubdualTarget', 10, 10),
        makeMapObject('LowPriorityAttacker', 20, 10),
        makeMapObject('CivilianStructureAttacker', 30, 10),
        makeMapObject('FactionStructureAttacker', 40, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { lastAttackerEntityId: number | null }>;
    };
    const target = privateApi.spawnedEntities.get(1)!;

    privateApi.applyWeaponDamageAmount(2, target, 10, 'SUBDUAL_MISSILE');
    expect(target.lastAttackerEntityId).toBe(2);

    // Non-faction structure should NOT override a previously recorded source.
    privateApi.applyWeaponDamageAmount(3, target, 10, 'SUBDUAL_MISSILE');
    expect(target.lastAttackerEntityId).toBe(2);

    // Faction structure should override in the same frame window.
    privateApi.applyWeaponDamageAmount(4, target, 10, 'SUBDUAL_MISSILE');
    expect(target.lastAttackerEntityId).toBe(4);
  });

  it('emits BASE_UNDER_ATTACK EVA for subdual-only damage on victory structures', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 1000,
            InitialHealth: 1000,
            SubdualDamageCap: 2000,
          }),
        ]),
        makeObjectDef('Microwave', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 40, 40),
        makeMapObject('Microwave', 50, 40),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const target = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, target, 50, 'SUBDUAL_MISSILE');

    const evaEvents = logic.drainEvaEvents();
    expect(evaEvents.some((event) => event.type === 'BASE_UNDER_ATTACK' && event.entityId === 1)).toBe(true);
  });

  it('records side attacked-by notifications for subdual-only damage', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TargetStructure', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', {
            MaxHealth: 1000,
            InitialHealth: 1000,
            SubdualDamageCap: 2000,
          }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TargetStructure', 40, 40),
        makeMapObject('Attacker', 50, 40),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const target = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, target, 50, 'SUBDUAL_MISSILE');

    const attacked = logic.getSideAttackedByState('America');
    expect(attacked.attackedBySides).toEqual(['china']);
    expect(attacked.attackedFrame).toBe(0);
  });
});
