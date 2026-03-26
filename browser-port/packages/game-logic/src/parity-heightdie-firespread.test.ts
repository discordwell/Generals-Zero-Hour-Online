/**
 * Parity tests for HeightDieUpdate and FireSpreadUpdate.
 *
 * Test 1: HeightDieUpdate — Unit Dies When Exceeding Max Height
 *   C++ HeightDieUpdate.cpp:116-200 — units die when height above terrain exceeds configured max.
 *   Only triggers when moving downward if OnlyWhenMovingDown is set.
 *   TS: entity-lifecycle.ts:622 updateHeightDieEntities() implements the check.
 *   entity-factory.ts:432 extractHeightDieProfile() parses HeightDieUpdate behavior blocks.
 *
 * Test 2: FireSpreadUpdate — Fire Spreads to Nearby Flammable Objects
 *   C++ FireSpreadUpdate.cpp:117-159 — burning units ignite nearby flammable targets
 *   within SpreadTryRange via getClosestObject + FlammableUpdate::tryToIgnite().
 *   TS: status-effects.ts:208 updateFireSpread() finds closest flammable entity in range
 *   and calls igniteEntity() on it.
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

// ---------------------------------------------------------------------------
// Test 1: HeightDieUpdate — Unit Dies When Below Target Height
// ---------------------------------------------------------------------------
// C++ source: HeightDieUpdate.cpp:116 — update() checks entity height vs terrain + targetHeight.
// Line 144: OnlyWhenMovingDown — if set, death only triggers when pos->z < m_lastPosition.z.
// Line 224: if (pos->z < targetHeight && directionOK) → kill().
// Line 266: m_lastPosition is always updated at end of update regardless of death.
//
// TS: entity-lifecycle.ts:622 — updateHeightDieEntities iterates spawnedEntities.
// Line 646: OnlyWhenMovingDown check compares currentY >= heightDieLastY → skip.
// Line 701: if (entity.y < targetHeight) → applyWeaponDamageAmount(UNRESISTABLE).
// Line 713: heightDieLastY = currentY always updated.
//
// Expected behavior:
// - Entity at ground level with TargetHeight=50 should die (ground=0, target=50, entity.y < 50).
// - Entity elevated above TargetHeight should survive.
// - OnlyWhenMovingDown: entity at height 2 moving upward should survive, but moving downward dies.

describe('HeightDieUpdate — unit dies when below target height (C++ parity)', () => {
  /** Typed entity shape for accessing internal fields. */
  type HeightDieEntity = {
    id: number;
    x: number;
    y: number;
    z: number;
    health: number;
    maxHealth: number;
    destroyed: boolean;
    slowDeathState: unknown;
    heightDieProfile: {
      targetHeight: number;
      onlyWhenMovingDown: boolean;
      snapToGroundOnDeath: boolean;
      initialDelayFrames: number;
      targetHeightIncludesStructures: boolean;
      destroyAttachedParticlesAtHeight: number;
    } | null;
    heightDieActiveFrame: number;
    heightDieLastY: number;
    baseHeight: number;
  };

  function isDead(entity: { destroyed: boolean; slowDeathState: unknown; health: number }): boolean {
    return entity.destroyed || entity.slowDeathState !== null || entity.health <= 0;
  }

  function makeHeightDieLogic(opts: {
    targetHeight?: number;
    onlyWhenMovingDown?: boolean;
    snapToGroundOnDeath?: boolean;
    initialDelayMs?: number;
  } = {}) {
    const objectDef = makeObjectDef('TestAircraft', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: opts.targetHeight ?? 50,
        ...(opts.onlyWhenMovingDown ? { OnlyWhenMovingDown: 'Yes' } : {}),
        ...(opts.snapToGroundOnDeath ? { SnapToGroundOnDeath: 'Yes' } : {}),
        ...(opts.initialDelayMs != null ? { InitialDelay: opts.initialDelayMs } : {}),
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestAircraft', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Grab entity reference BEFORE any update — loadMapObjects creates it immediately.
    const priv = logic as unknown as { spawnedEntities: Map<number, HeightDieEntity> };
    const entity = priv.spawnedEntities.get(1)!;

    return { logic, entity };
  }

  it('entity at ground level dies when below TargetHeight (C++ line 224)', () => {
    // C++ source: HeightDieUpdate.cpp:224 — if (pos->z < targetHeight && directionOK) → kill().
    // TS: entity-lifecycle.ts:701 — if (entity.y < targetHeight) → applyWeaponDamageAmount().
    //
    // Entity spawns at ground level (y ~ 0). TargetHeight=50 → targetHeight = terrain(0) + 50 = 50.
    // entity.y (0) < 50 → should die.
    const { logic, entity } = makeHeightDieLogic({ targetHeight: 50 });

    expect(entity).toBeDefined();
    expect(entity.heightDieProfile).not.toBeNull();
    expect(entity.heightDieProfile!.targetHeight).toBe(50);

    // First update runs HeightDie check — entity at ground level should die.
    logic.update(0);
    expect(isDead(entity)).toBe(true);
  });

  it('entity above TargetHeight survives (C++ line 224 not triggered)', () => {
    // C++ source: HeightDieUpdate.cpp:224 — condition (pos->z < targetHeight) is false when
    // entity.y > targetHeight, so the entity lives.
    // TS: entity-lifecycle.ts:701 — entity.y (60) >= targetHeight (50) → no death.
    const { logic, entity } = makeHeightDieLogic({ targetHeight: 5 });

    // Elevate entity BEFORE first update — otherwise it dies at ground level.
    entity.y += 50;

    logic.update(0);

    // Above target height → should survive.
    expect(entity.destroyed).toBe(false);
    expect(entity.health).toBe(200);

    // Additional frames — still alive (keep re-setting y to prevent drift).
    for (let i = 0; i < 10; i++) {
      entity.y = 50;
      logic.update(1 / 30);
    }
    expect(entity.destroyed).toBe(false);
    expect(entity.health).toBe(200);
  });

  it('OnlyWhenMovingDown: entity below target but moving upward survives (C++ line 148-152)', () => {
    // C++ source: HeightDieUpdate.cpp:148-152 — if (m_onlyWhenMovingDown) {
    //   if (pos->z >= m_lastPosition.z) directionOK = FALSE; }
    // Line 224: directionOK is FALSE → skip death check.
    //
    // TS: entity-lifecycle.ts:646 — if (prof.onlyWhenMovingDown && currentY >= heightDieLastY)
    //   directionOK = false → skip death.
    const { logic, entity } = makeHeightDieLogic({
      targetHeight: 50,
      onlyWhenMovingDown: true,
      snapToGroundOnDeath: true,
    });

    // Start at height 2 (below target=50). First update initializes lastY.
    entity.y = 2 + entity.baseHeight;
    logic.update(1 / 30);
    expect(entity.destroyed).toBe(false); // First frame initializes heightDieLastY.

    // Now move upward — still below target but ascending. Should survive.
    entity.y = 3 + entity.baseHeight;
    logic.update(1 / 30);
    expect(entity.destroyed).toBe(false);

    // Move further upward — still alive.
    entity.y = 4 + entity.baseHeight;
    logic.update(1 / 30);
    expect(entity.destroyed).toBe(false);
  });

  it('OnlyWhenMovingDown: entity below target and moving downward dies (C++ line 148-154,224)', () => {
    // C++ source: HeightDieUpdate.cpp:148-152 — pos->z < m_lastPosition.z → directionOK stays TRUE.
    // Line 224: pos->z < targetHeight AND directionOK → kill().
    //
    // TS: entity-lifecycle.ts:646 — currentY < heightDieLastY → directionOK remains true.
    // Line 701: entity.y < targetHeight → death.
    const { logic, entity } = makeHeightDieLogic({
      targetHeight: 50,
      onlyWhenMovingDown: true,
      snapToGroundOnDeath: true,
    });

    // Start at height 2 (below target=50). First update initializes lastY.
    entity.y = 2 + entity.baseHeight;
    logic.update(1 / 30);
    expect(entity.destroyed).toBe(false); // First frame initializes lastY.

    // Move upward first to set up the ascending state.
    entity.y = 3 + entity.baseHeight;
    logic.update(1 / 30);
    expect(entity.destroyed).toBe(false); // Still ascending — safe.

    // Now move downward — below target AND descending → should die.
    entity.y = 2 + entity.baseHeight;
    logic.update(1 / 30);
    expect(entity.destroyed).toBe(true);
  });

  it('heightDieLastY tracks entity position after each update (C++ line 266)', () => {
    // C++ source: HeightDieUpdate.cpp:249-266 — m_lastPosition = *pos at end of update,
    // regardless of whether directionOK was true or death occurred.
    //
    // TS: entity-lifecycle.ts:713 — entity.heightDieLastY = currentY always executed.
    //
    // Note: The entity's y may be modified by other game systems (locomotion, gravity).
    // We verify that heightDieLastY reflects the entity's actual y at the time of the
    // HeightDie update, not necessarily the value we set before the frame.
    const { logic, entity } = makeHeightDieLogic({
      targetHeight: 5,
      onlyWhenMovingDown: true,
    });

    // Elevate well above target to avoid death.
    entity.y = 100;
    logic.update(1 / 30); // First update: initializes lastY.

    // After update, heightDieLastY should match whatever y the entity has now.
    // (Other systems may have modified y, so compare against entity.y, not our set value.)
    expect(entity.heightDieLastY).toBe(entity.y);

    // Record the y and set a new one.
    const prevY = entity.y;
    entity.y = prevY + 20; // Move upward.
    logic.update(1 / 30);

    // heightDieLastY should match entity.y after update.
    expect(entity.heightDieLastY).toBe(entity.y);
    expect(entity.destroyed).toBe(false);
  });

  it('extracts DestroyAttachedParticlesAtHeight from INI (C++ line 77)', () => {
    // C++ source: HeightDieUpdate.cpp:77 — DestroyAttachedParticlesAtHeight parsed via INI::parseReal.
    // Default is -1.0f (effectively disabled since positions are rarely below -1).
    // C++ line 254: if (pos->z < m_destroyAttachedParticlesAtHeight) → destroy attached particles.
    const { entity } = makeHeightDieLogic({ targetHeight: 50 });
    expect(entity.heightDieProfile).not.toBeNull();
    // Default value when not specified in INI: -1 (C++ m_destroyAttachedParticlesAtHeight = -1.0f).
    expect(entity.heightDieProfile!.destroyAttachedParticlesAtHeight).toBe(-1);
  });

  it('extracts explicit DestroyAttachedParticlesAtHeight value from INI (C++ line 77)', () => {
    // C++ source: HeightDieUpdate.cpp:77 — { "DestroyAttachedParticlesAtHeight", INI::parseReal, ... }.
    // When specified, the value is stored as a height threshold for particle cleanup.
    const objectDef = makeObjectDef('TestAircraft2', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 50,
        DestroyAttachedParticlesAtHeight: 25,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestAircraft2', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as { spawnedEntities: Map<number, HeightDieEntity> };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.heightDieProfile).not.toBeNull();
    expect(entity.heightDieProfile!.destroyAttachedParticlesAtHeight).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Test 2: FireSpreadUpdate — Fire Spreads to Nearby Flammable Objects
// ---------------------------------------------------------------------------
// C++ source: FireSpreadUpdate.cpp:117-159 — update():
//   - If not AFLAME, sleep forever (line 122).
//   - If spreadTryRange != 0, get closest flammable object in range (line 147).
//   - If found, call FlammableUpdate::tryToIgnite() on it (line 153).
//   - Return UPDATE_SLEEP(calcNextSpreadDelay()) (line 157).
//
// TS: status-effects.ts:208 — updateFireSpread():
//   - Skip if not AFLAME (line 215).
//   - Schedule next spread timer on first ignition (line 221).
//   - Find closest flammable candidate within spreadTryRange (line 234-253).
//   - Call self.igniteEntity(closestTarget) if found (line 257).
//
// Expected behavior:
// - Building A catches fire. Nearby flammable Building B should ignite after spread delay.
// - Building C outside SpreadTryRange should NOT ignite.
// - Fire only spreads from AFLAME entities; NORMAL entities don't spread.

describe('FireSpreadUpdate — fire spreads to nearby flammable objects (C++ parity)', () => {
  /** Typed entity shape for fire-related fields. */
  type FireEntity = {
    id: number;
    destroyed: boolean;
    health: number;
    flameStatus: 'NORMAL' | 'AFLAME' | 'BURNED';
    flammableProfile: object | null;
    fireSpreadProfile: {
      minSpreadDelayFrames: number;
      maxSpreadDelayFrames: number;
      spreadTryRange: number;
    } | null;
    fireSpreadNextFrame: number;
    objectStatusFlags: Set<string>;
  };

  function makeFireSpreadSetup(opts: {
    spreadTryRange?: number;
    minSpreadDelayMs?: number;
    maxSpreadDelayMs?: number;
    targetDistance?: number;
  } = {}) {
    const spreaderDef = makeObjectDef('BurningBuilding', 'America', ['STRUCTURE'], [
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

    const targetDef = makeObjectDef('NearbyBuilding', 'America', ['STRUCTURE'], [
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

    // Target distance in map cells: default 2 cells apart (close enough for spread).
    const td = opts.targetDistance ?? 2;
    const mapObjects = [
      makeMapObject('BurningBuilding', 5, 5),
      makeMapObject('NearbyBuilding', 5 + td, 5),
      makeMapObject('Flamer', 5, 5),
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
      spawnedEntities: Map<number, FireEntity>;
      frameCounter: number;
      igniteEntity: (e: FireEntity) => void;
    };

    return { logic, priv };
  }

  it('fire spreads from burning building to adjacent flammable building (C++ line 147-153)', () => {
    // C++ source: FireSpreadUpdate.cpp:147 — getClosestObject(spreadTryRange, FROM_CENTER_3D).
    // Line 153: fu->tryToIgnite() ignites the target.
    //
    // TS: status-effects.ts:234-257 — find closest flammable in range, igniteEntity().
    const { logic, priv } = makeFireSpreadSetup({
      spreadTryRange: 50,
      minSpreadDelayMs: 100,
      maxSpreadDelayMs: 100,
    });

    const spreader = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    expect(spreader.flameStatus).toBe('NORMAL');
    expect(target.flameStatus).toBe('NORMAL');
    expect(spreader.fireSpreadProfile).not.toBeNull();
    expect(target.flammableProfile).not.toBeNull();

    // Command attacker (entity 3) to attack spreader (entity 1) with flame weapon.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    // Run frames until spreader catches fire.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(spreader.flameStatus).toBe('AFLAME');

    // Now run enough frames for fire to spread to target.
    // MinSpreadDelay=100ms = ceil(100/33.33)=3 frames. Run 30 to be safe.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(target.flameStatus).toBe('AFLAME');
  });

  it('fire does not spread to entities outside SpreadTryRange (C++ line 127-155)', () => {
    // C++ source: FireSpreadUpdate.cpp:127 — if (spreadTryRange != 0), search in range.
    // Line 147: getClosestObject only returns entities WITHIN the range.
    //
    // TS: status-effects.ts:234 — rangeSqr = spreadTryRange^2.
    // Line 249: distSqr < rangeSqr check — entities outside range are excluded.
    //
    // Use igniteEntity() directly to avoid the attacker auto-acquiring the far target.
    const spreaderDef = makeObjectDef('BurningBldg', 'America', ['STRUCTURE'], [
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
        SpreadTryRange: 1, // Very short range (~1 world unit).
      }),
    ]);
    const farTargetDef = makeObjectDef('FarBuilding', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FlammableUpdate ModuleTag_Flammable', {
        FlameDamageLimit: 1,
        AflameDuration: 10000,
        AflameDamageDelay: 500,
        AflameDamageAmount: 5,
      }),
    ]);

    const bundle = makeBundle({
      objects: [spreaderDef, farTargetDef],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BurningBldg', 5, 5),
        makeMapObject('FarBuilding', 60, 60), // Far away — outside range.
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, FireEntity>;
      igniteEntity: (e: FireEntity) => void;
    };

    const spreader = priv.spawnedEntities.get(1)!;
    const farTarget = priv.spawnedEntities.get(2)!;

    // Directly ignite the spreader (bypass attacker to avoid collateral damage).
    priv.igniteEntity(spreader);
    expect(spreader.flameStatus).toBe('AFLAME');

    // Run many frames — fire should NOT spread to far-away target.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    expect(farTarget.flameStatus).toBe('NORMAL');
  });

  it('fire only spreads when source entity is AFLAME (C++ line 122)', () => {
    // C++ source: FireSpreadUpdate.cpp:122 — if (!AFLAME) return SLEEP_FOREVER.
    // Fire cannot spread from a NORMAL entity.
    //
    // TS: status-effects.ts:215 — if (entity.flameStatus !== 'AFLAME') → skip.
    const { logic, priv } = makeFireSpreadSetup();

    const spreader = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    // Without setting the spreader on fire, run many frames.
    expect(spreader.flameStatus).toBe('NORMAL');

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Fire spread should never trigger from a NORMAL entity — target stays NORMAL.
    expect(target.flameStatus).toBe('NORMAL');
  });

  it('only NORMAL targets are eligible for ignition (C++ PartitionFilterFlammable::wouldIgnite)', () => {
    // C++ source: FireSpreadUpdate.cpp:130 — PartitionFilterFlammable filters to entities
    // that wouldIgnite, which requires NORMAL flame status.
    //
    // TS: status-effects.ts:242 — if (candidate.flameStatus !== 'NORMAL') continue.
    // Already-AFLAME or BURNED entities are skipped.
    const { logic, priv } = makeFireSpreadSetup();

    const spreader = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    // Manually force both on fire.
    priv.igniteEntity(spreader);
    priv.igniteEntity(target);

    expect(spreader.flameStatus).toBe('AFLAME');
    expect(target.flameStatus).toBe('AFLAME');

    // Run frames — target is already AFLAME, so spread should not error or change status.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Target should still be AFLAME (not re-ignited or errored).
    expect(target.flameStatus).toBe('AFLAME');
  });
});
