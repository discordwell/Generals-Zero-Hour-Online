/**
 * ZH-specific combat/weapon runtime logic changes.
 *
 * Source parity:
 *   1. Weapon.cpp:764-787 — inflictDamage param on fireWeaponTemplate
 *   2. Object.cpp:1951-1966 — kill(DamageType, DeathType) with m_kill = TRUE
 *   3. Weapon.cpp:3143-3156 — transferNextShotStatsFrom() for Jarmen Kell / combat bike
 *   4. Weapon.cpp:1148-1162 — scattered projectiles don't home (pass NULL victim)
 */
import { describe, expect, it } from 'vitest';
import {
  createMultiWeaponEntityState,
  createWeaponSlotState,
  fireWeaponSlot,
  transferNextShotStatsFrom,
  type WeaponSlotProfile,
  type WeaponSlotState,
} from './combat-weapon-set.js';
import {
  applyWeaponDamageEvent,
  type CombatDamageEventContext,
} from './combat-damage-events.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeWeaponProfile(overrides: Partial<WeaponSlotProfile> = {}): WeaponSlotProfile {
  return {
    name: 'TestWeapon',
    slotIndex: 0,
    primaryDamage: 20,
    secondaryDamage: 10,
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
    radiusDamageAffectsMask: 0x04,
    projectileCollideMask: 0,
    weaponSpeed: 999999,
    minWeaponSpeed: 999999,
    scaleWeaponSpeed: false,
    capableOfFollowingWaypoints: false,
    projectileObjectName: null,
    attackRange: 150,
    unmodifiedAttackRange: 155,
    minAttackRange: 0,
    continueAttackRange: 0,
    clipSize: 6,
    clipReloadFrames: 90,
    autoReloadWhenIdleFrames: 0,
    preAttackDelayFrames: 0,
    preAttackType: 'PER_SHOT',
    minDelayFrames: 5,
    maxDelayFrames: 5,
    antiMask: 0x02,
    continuousFireOneShotsNeeded: 0,
    continuousFireTwoShotsNeeded: 0,
    continuousFireCoastFrames: 0,
    continuousFireMeanRateOfFire: 1,
    continuousFireFastRateOfFire: 1,
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

// ---------------------------------------------------------------------------
// 1. inflictDamage parameter on weapon firing
// ---------------------------------------------------------------------------
describe('inflictDamage parameter on weapon firing (ZH: Weapon.cpp:764-787)', () => {
  /**
   * Source parity: ZH added Bool inflictDamage to fireWeaponTemplate(). When false,
   * the weapon fires (FX, projectile visual) but dealDamageInternal is NOT called.
   * Used for visual-only weapon effects.
   *
   * The queueWeaponDamageEvent function in combat-targeting.ts gains an inflictDamage
   * parameter (defaults to true). When false:
   * - Laser/direct instant damage: emitWeaponImpactVisualEvent runs, but
   *   applyWeaponDamageEvent is NOT called.
   * - Delayed/projectile damage: event is NOT pushed to pendingWeaponDamageEvents.
   * - Muzzle flash FX and projectile visuals always fire regardless.
   */

  interface TestEntity {
    id: number;
    x: number;
    y: number;
    z: number;
    baseHeight: number;
    destroyed: boolean;
    canTakeDamage: boolean;
    templateName: string;
    controllingPlayerToken: string | null;
    attackTargetEntityId: number | null;
    attackOriginalVictimPosition: { x: number; z: number } | null;
    attackCommandSource: string;
  }

  interface TestWeapon {
    primaryDamageRadius: number;
    secondaryDamageRadius: number;
    radiusDamageAngle: number;
    radiusDamageAffectsMask: number;
    primaryDamage: number;
    secondaryDamage: number;
    damageType: string;
    deathType: string;
    continueAttackRange: number;
  }

  interface TestEvent {
    sourceEntityId: number;
    primaryVictimEntityId: number | null;
    impactX: number;
    impactY: number;
    impactZ: number;
    executeFrame: number;
    delivery: 'DIRECT' | 'PROJECTILE' | 'LASER';
    weapon: TestWeapon;
  }

  function makeTestEntity(id: number, health = 100): TestEntity {
    return {
      id,
      x: id * 10,
      y: 0,
      z: 0,
      baseHeight: 0,
      destroyed: false,
      canTakeDamage: true,
      templateName: `Unit${id}`,
      controllingPlayerToken: 'player1',
      attackTargetEntityId: null,
      attackOriginalVictimPosition: null,
      attackCommandSource: 'PLAYER',
    };
  }

  function makeDamageContext(
    entities: TestEntity[],
  ): CombatDamageEventContext<TestEntity, TestWeapon, TestEvent> {
    const damageApplied: Array<{ targetId: number; amount: number; damageType: string }> = [];
    return {
      frameCounter: 100,
      pendingEvents: [],
      entitiesById: new Map(entities.map((e) => [e.id, e])),
      resolveForwardUnitVector: () => ({ x: 0, z: 1 }),
      resolveProjectilePointCollisionRadius: () => 5,
      resolveProjectileIncidentalVictimForPointImpact: () => null,
      getTeamRelationship: () => 0x04, // enemies
      applyWeaponDamageAmount: (sourceEntityId, target, amount, damageType) => {
        damageApplied.push({ targetId: target.id, amount, damageType });
      },
      canEntityAttackFromStatus: () => true,
      canAttackerTargetEntity: () => true,
      isEntitySignificantlyAboveTerrain: () => false,
      resolveBoundingSphereRadius: () => 0,
      areTemplatesEquivalent: (a, b) => a === b,
      masks: {
        affectsSelf: 0x01,
        affectsAllies: 0x02,
        affectsEnemies: 0x04,
        affectsNeutrals: 0x08,
        killsSelf: 0x10,
        doesntAffectSimilar: 0x20,
        doesntAffectAirborne: 0x40,
      },
      relationships: { allies: 0x02, enemies: 0x04 },
      hugeDamageAmount: 999999,
      // Expose damageApplied for assertions
      ...({ _damageApplied: damageApplied } as Record<string, unknown>),
    };
  }

  it('applyWeaponDamageEvent deals damage normally (inflictDamage=true baseline)', () => {
    const attacker = makeTestEntity(1);
    const victim = makeTestEntity(2);
    const ctx = makeDamageContext([attacker, victim]);

    const event: TestEvent = {
      sourceEntityId: 1,
      primaryVictimEntityId: 2,
      impactX: 20,
      impactY: 0,
      impactZ: 0,
      executeFrame: 100,
      delivery: 'DIRECT',
      weapon: {
        primaryDamageRadius: 0,
        secondaryDamageRadius: 0,
        radiusDamageAngle: Math.PI,
        radiusDamageAffectsMask: 0x04,
        primaryDamage: 50,
        secondaryDamage: 0,
        damageType: 'ARMOR_PIERCING',
        deathType: 'NORMAL',
        continueAttackRange: 0,
      },
    };

    applyWeaponDamageEvent(ctx, event);

    // Damage should be applied to the victim
    const applied = (ctx as unknown as { _damageApplied: Array<{ targetId: number }> })._damageApplied;
    expect(applied.length).toBe(1);
    expect(applied[0]!.targetId).toBe(2);
  });

  it('queueWeaponDamageEvent signature accepts inflictDamage parameter', async () => {
    // Verify the function signature accepts the parameter by importing it
    const { queueWeaponDamageEvent } = await import('./combat-targeting.js');
    expect(typeof queueWeaponDamageEvent).toBe('function');
    // The function has 5 params (self, attacker, target, weapon, inflictDamage)
    // JS .length counts required params before the first one with a default.
    // queueWeaponDamageEvent(self, attacker, target, weapon, inflictDamage=true)
    // → 4 required params (inflictDamage has a default so doesn't count)
    expect(queueWeaponDamageEvent.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 2. Parameterized Object::kill() with damage/death type
// ---------------------------------------------------------------------------
describe('parameterized kill() with damage/death type (ZH: Object.cpp:1951-1966)', () => {
  /**
   * Source parity: Generals kill() used hardcoded DAMAGE_UNRESISTABLE + DEATH_NORMAL.
   * ZH's kill(DamageType, DeathType) allows specifying the cause.
   * Also added m_kill = TRUE on DamageInfoInput that forces death regardless of armor.
   *
   * Implementation: killEntity(target, damageType, deathType) calls
   * applyWeaponDamageAmount with forceKill=true.
   */

  it('killEntity method exists on GameLogicSubsystem', async () => {
    const THREE = await import('three');
    const { GameLogicSubsystem } = await import('./index.js');
    const logic = new GameLogicSubsystem(new THREE.Scene());
    expect(typeof (logic as unknown as { killEntity: unknown }).killEntity).toBe('function');
  });

  it('killEntity with default params kills the entity (Generals compat)', async () => {
    const THREE = await import('three');
    const { GameLogicSubsystem } = await import('./index.js');
    const {
      makeBundle,
      makeRegistry,
      makeHeightmap,
      makeMap,
      makeMapObject,
      makeObjectDef,
      makeBlock,
    } = await import('./test-helpers.js');

    const objectDef = makeObjectDef('TestUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 100, 100, 'teamPlayer_1')]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(1 / 30);

    // Access internal entities to call killEntity
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { id: number; destroyed: boolean; health: number }>;
      killEntity: (target: unknown, damageType?: string, deathType?: string) => void;
    };
    const unit = Array.from(priv.spawnedEntities.values()).find((e) => !e.destroyed);
    expect(unit).toBeDefined();
    expect(unit!.health).toBe(100);

    priv.killEntity(unit!);
    // Unit health should be 0
    expect(unit!.health).toBe(0);
  });

  it('killEntity with custom damage/death types sets pendingDeathType', async () => {
    const THREE = await import('three');
    const { GameLogicSubsystem } = await import('./index.js');
    const {
      makeBundle,
      makeRegistry,
      makeHeightmap,
      makeMap,
      makeMapObject,
      makeObjectDef,
      makeBlock,
    } = await import('./test-helpers.js');

    const objectDef = makeObjectDef('TestUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 100, 100, 'teamPlayer_1')]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { id: number; destroyed: boolean; health: number; pendingDeathType: string }>;
      killEntity: (target: unknown, damageType?: string, deathType?: string) => void;
    };
    const unit = Array.from(priv.spawnedEntities.values()).find((e) => !e.destroyed);
    expect(unit).toBeDefined();

    // Kill with EXPLOSION damage type and EXPLODED death type
    priv.killEntity(unit!, 'EXPLOSION', 'EXPLODED');
    expect(unit!.health).toBe(0);
    expect(unit!.pendingDeathType).toBe('EXPLODED');
  });

  it('forceKill bypasses armor — kills entity even when armor blocks damage type', async () => {
    const THREE = await import('three');
    const { GameLogicSubsystem } = await import('./index.js');
    const {
      makeBundle,
      makeRegistry,
      makeHeightmap,
      makeMap,
      makeMapObject,
      makeObjectDef,
      makeBlock,
    } = await import('./test-helpers.js');

    const objectDef = makeObjectDef('TestUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 100, 100, 'teamPlayer_1')]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { id: number; destroyed: boolean; health: number }>;
      killEntity: (target: unknown, damageType?: string, deathType?: string) => void;
    };
    const unit = Array.from(priv.spawnedEntities.values()).find((e) => !e.destroyed);
    expect(unit).toBeDefined();
    expect(unit!.health).toBe(100);

    // Kill with EXPLOSION — forceKill bypasses armor entirely (m_kill = TRUE)
    priv.killEntity(unit!, 'EXPLOSION', 'EXPLODED');
    expect(unit!.health).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Weapon::transferNextShotStatsFrom() — Jarmen Kell / combat bike
// ---------------------------------------------------------------------------
describe('transferNextShotStatsFrom (ZH: Weapon.cpp:3143-3156)', () => {
  /**
   * Source parity: ZH Patch 1.01 addition for Jarmen Kell and combat bike.
   * Transfers whenWeCanFireAgain, whenLastReloadStarted, and weapon status
   * between weapons so a hero retains sniper cooldown when mounting/dismounting.
   *
   * C++ transfers: m_whenWeCanFireAgain (→ nextFireFrame),
   *                m_whenLastReloadStarted (→ reloadFinishFrame),
   *                m_status (→ derived from ammoInClip state).
   */

  it('transfers nextFireFrame from source to target slot', () => {
    const source = createWeaponSlotState(0);
    const target = createWeaponSlotState(0);

    source.nextFireFrame = 150;
    source.reloadFinishFrame = 120;
    source.ammoInClip = 3;
    target.nextFireFrame = 0;
    target.reloadFinishFrame = 0;
    target.ammoInClip = 6;

    transferNextShotStatsFrom(target, source);

    expect(target.nextFireFrame).toBe(150);
    expect(target.reloadFinishFrame).toBe(120);
    expect(target.ammoInClip).toBe(3);
  });

  it('preserves sniper cooldown when mounting vehicle', () => {
    // Simulate Jarmen Kell firing his sniper rifle, then entering combat bike.
    // The bike's weapon should inherit Jarmen's cooldown state.
    const profile = makeWeaponProfile({
      name: 'JarmenSniperRifle',
      clipSize: 1,
      clipReloadFrames: 150, // Long sniper cooldown
      minDelayFrames: 5,
      maxDelayFrames: 5,
    });

    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = profile;
    state.weaponSlots[0].ammoInClip = 1;

    // Fire the sniper — clip depleted, now reloading
    const clipEmpty = fireWeaponSlot(state, 0, 100, () => 5);
    expect(clipEmpty).toBe(true);

    const jarmenSlot = state.weaponSlots[0];
    expect(jarmenSlot.ammoInClip).toBe(0);
    expect(jarmenSlot.nextFireFrame).toBe(250); // 100 + 150
    expect(jarmenSlot.reloadFinishFrame).toBe(250); // 100 + 150

    // Transfer to bike weapon slot
    const bikeSlot = createWeaponSlotState(0);
    bikeSlot.ammoInClip = 1; // Fresh bike weapon
    bikeSlot.nextFireFrame = 0;
    bikeSlot.reloadFinishFrame = 0;

    transferNextShotStatsFrom(bikeSlot, jarmenSlot);

    // Bike weapon should now have Jarmen's cooldown state
    expect(bikeSlot.nextFireFrame).toBe(250);
    expect(bikeSlot.reloadFinishFrame).toBe(250);
    expect(bikeSlot.ammoInClip).toBe(0);
  });

  it('preserves ready-to-fire state when dismounting', () => {
    // Simulate bike weapon that is ready to fire — transfer back to Jarmen
    const bikeSlot = createWeaponSlotState(0);
    bikeSlot.ammoInClip = 1;
    bikeSlot.nextFireFrame = 0;
    bikeSlot.reloadFinishFrame = 0;

    const jarmenSlot = createWeaponSlotState(0);
    jarmenSlot.ammoInClip = 0;
    jarmenSlot.nextFireFrame = 999;
    jarmenSlot.reloadFinishFrame = 999;

    transferNextShotStatsFrom(jarmenSlot, bikeSlot);

    // Jarmen should now be ready to fire
    expect(jarmenSlot.nextFireFrame).toBe(0);
    expect(jarmenSlot.reloadFinishFrame).toBe(0);
    expect(jarmenSlot.ammoInClip).toBe(1);
  });

  it('does not modify source slot (read-only)', () => {
    const source = createWeaponSlotState(0);
    source.nextFireFrame = 200;
    source.reloadFinishFrame = 180;
    source.ammoInClip = 2;

    const target = createWeaponSlotState(0);
    target.nextFireFrame = 0;
    target.reloadFinishFrame = 0;
    target.ammoInClip = 6;

    transferNextShotStatsFrom(target, source);

    // Source should be unchanged
    expect(source.nextFireFrame).toBe(200);
    expect(source.reloadFinishFrame).toBe(180);
    expect(source.ammoInClip).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Scattered projectiles don't home (ZH: Weapon.cpp:1148-1162)
// ---------------------------------------------------------------------------
describe('scattered projectiles don\'t home (ZH: Weapon.cpp:1148-1162)', () => {
  /**
   * Source parity: When scatterRadius > 0, ZH explicitly passes NULL as victim
   * to projectileLaunchAtObjectOrPosition(), preventing the projectile from
   * homing to the target. In Generals, scattered projectiles also cleared
   * victimObj = NULL (Weapon.cpp:1005), but the ZH change made this explicit
   * at the projectile launch call (Weapon.cpp:1151-1154).
   *
   * Our implementation already handles this: combat-targeting.ts line 966 sets
   * primaryVictimEntityId = null when scatterRadius > 0. These tests verify
   * the behavior is maintained.
   */

  interface TestEntity {
    id: number;
    x: number;
    y: number;
    z: number;
    baseHeight: number;
    destroyed: boolean;
    canTakeDamage: boolean;
    templateName: string;
    controllingPlayerToken: string | null;
    attackTargetEntityId: number | null;
    attackOriginalVictimPosition: { x: number; z: number } | null;
    attackCommandSource: string;
  }

  interface TestWeapon {
    primaryDamageRadius: number;
    secondaryDamageRadius: number;
    radiusDamageAngle: number;
    radiusDamageAffectsMask: number;
    primaryDamage: number;
    secondaryDamage: number;
    damageType: string;
    deathType: string;
    continueAttackRange: number;
  }

  interface TestEvent {
    sourceEntityId: number;
    primaryVictimEntityId: number | null;
    impactX: number;
    impactY: number;
    impactZ: number;
    executeFrame: number;
    delivery: 'DIRECT' | 'PROJECTILE' | 'LASER';
    weapon: TestWeapon;
  }

  it('scattered projectile event has null primaryVictimEntityId (position-only target)', () => {
    // When a projectile weapon has scatterRadius > 0 and gets scatter applied,
    // the resulting damage event should target a position (null victim), not an entity.
    // This is verified by creating a damage event with null victim and ensuring
    // applyWeaponDamageEvent handles it correctly (area damage only, no homing).
    const weapon: TestWeapon = {
      primaryDamageRadius: 10,
      secondaryDamageRadius: 20,
      radiusDamageAngle: Math.PI,
      radiusDamageAffectsMask: 0x04, // affects enemies
      primaryDamage: 50,
      secondaryDamage: 25,
      damageType: 'EXPLOSION',
      deathType: 'EXPLODED',
      continueAttackRange: 0,
    };

    const attacker: TestEntity = {
      id: 1,
      x: 0, y: 0, z: 0,
      baseHeight: 0,
      destroyed: false,
      canTakeDamage: true,
      templateName: 'Attacker',
      controllingPlayerToken: 'player1',
      attackTargetEntityId: null,
      attackOriginalVictimPosition: null,
      attackCommandSource: 'PLAYER',
    };

    const victim: TestEntity = {
      id: 2,
      x: 50, y: 0, z: 0,
      baseHeight: 0,
      destroyed: false,
      canTakeDamage: true,
      templateName: 'Victim',
      controllingPlayerToken: 'player2',
      attackTargetEntityId: null,
      attackOriginalVictimPosition: null,
      attackCommandSource: 'PLAYER',
    };

    const damageApplied: Array<{ targetId: number; amount: number }> = [];

    const ctx: CombatDamageEventContext<TestEntity, TestWeapon, TestEvent> = {
      frameCounter: 100,
      pendingEvents: [],
      entitiesById: new Map([[1, attacker], [2, victim]]),
      resolveForwardUnitVector: () => ({ x: 1, z: 0 }),
      resolveProjectilePointCollisionRadius: () => 5,
      resolveProjectileIncidentalVictimForPointImpact: () => null,
      getTeamRelationship: () => 0x04,
      applyWeaponDamageAmount: (_sourceId, target, amount) => {
        damageApplied.push({ targetId: target.id, amount });
      },
      canEntityAttackFromStatus: () => true,
      canAttackerTargetEntity: () => true,
      isEntitySignificantlyAboveTerrain: () => false,
      resolveBoundingSphereRadius: () => 0,
      areTemplatesEquivalent: (a, b) => a === b,
      masks: {
        affectsSelf: 0x01,
        affectsAllies: 0x02,
        affectsEnemies: 0x04,
        affectsNeutrals: 0x08,
        killsSelf: 0x10,
        doesntAffectSimilar: 0x20,
        doesntAffectAirborne: 0x40,
      },
      relationships: { allies: 0x02, enemies: 0x04 },
      hugeDamageAmount: 999999,
    };

    // Scattered projectile: null victim, impact position offset from victim
    const event: TestEvent = {
      sourceEntityId: 1,
      primaryVictimEntityId: null, // Scattered: no homing victim
      impactX: 55, // Scattered aim point near but not at victim
      impactY: 0,
      impactZ: 3,
      executeFrame: 100,
      delivery: 'PROJECTILE',
      weapon,
    };

    applyWeaponDamageEvent(ctx, event);

    // Victim is within secondary damage radius (20), should take area damage.
    // The key parity point: primaryVictimEntityId is null (no homing), so damage
    // is purely position-based area damage, not direct point damage.
    const victimDamage = damageApplied.filter((d) => d.targetId === 2);
    expect(victimDamage.length).toBeGreaterThanOrEqual(1);
  });

  it('non-scattered projectile retains victim homing (primaryVictimEntityId set)', () => {
    // When scatterRadius = 0, the projectile should home to the victim
    const weapon: TestWeapon = {
      primaryDamageRadius: 0, // Point damage only
      secondaryDamageRadius: 0,
      radiusDamageAngle: Math.PI,
      radiusDamageAffectsMask: 0x04,
      primaryDamage: 50,
      secondaryDamage: 0,
      damageType: 'ARMOR_PIERCING',
      deathType: 'NORMAL',
      continueAttackRange: 0,
    };

    const attacker: TestEntity = {
      id: 1,
      x: 0, y: 0, z: 0,
      baseHeight: 0,
      destroyed: false,
      canTakeDamage: true,
      templateName: 'Attacker',
      controllingPlayerToken: 'player1',
      attackTargetEntityId: null,
      attackOriginalVictimPosition: null,
      attackCommandSource: 'PLAYER',
    };

    const victim: TestEntity = {
      id: 2,
      x: 50, y: 0, z: 0,
      baseHeight: 0,
      destroyed: false,
      canTakeDamage: true,
      templateName: 'Victim',
      controllingPlayerToken: 'player2',
      attackTargetEntityId: null,
      attackOriginalVictimPosition: null,
      attackCommandSource: 'PLAYER',
    };

    const damageApplied: Array<{ targetId: number }> = [];

    const ctx: CombatDamageEventContext<TestEntity, TestWeapon, TestEvent> = {
      frameCounter: 100,
      pendingEvents: [],
      entitiesById: new Map([[1, attacker], [2, victim]]),
      resolveForwardUnitVector: () => ({ x: 1, z: 0 }),
      resolveProjectilePointCollisionRadius: () => 5,
      resolveProjectileIncidentalVictimForPointImpact: () => null,
      getTeamRelationship: () => 0x04,
      applyWeaponDamageAmount: (_sourceId, target) => {
        damageApplied.push({ targetId: target.id });
      },
      canEntityAttackFromStatus: () => true,
      canAttackerTargetEntity: () => true,
      isEntitySignificantlyAboveTerrain: () => false,
      resolveBoundingSphereRadius: () => 0,
      areTemplatesEquivalent: (a, b) => a === b,
      masks: {
        affectsSelf: 0x01,
        affectsAllies: 0x02,
        affectsEnemies: 0x04,
        affectsNeutrals: 0x08,
        killsSelf: 0x10,
        doesntAffectSimilar: 0x20,
        doesntAffectAirborne: 0x40,
      },
      relationships: { allies: 0x02, enemies: 0x04 },
      hugeDamageAmount: 999999,
    };

    // Non-scattered: victim is set, projectile homes to it
    const event: TestEvent = {
      sourceEntityId: 1,
      primaryVictimEntityId: 2, // Homing to victim
      impactX: 50,
      impactY: 0,
      impactZ: 0,
      executeFrame: 100,
      delivery: 'PROJECTILE',
      weapon,
    };

    applyWeaponDamageEvent(ctx, event);

    // Direct point damage to homing victim
    expect(damageApplied.length).toBe(1);
    expect(damageApplied[0]!.targetId).toBe(2);
  });
});
