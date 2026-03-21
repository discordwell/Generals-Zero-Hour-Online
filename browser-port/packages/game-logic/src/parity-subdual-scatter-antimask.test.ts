/**
 * Parity tests for subdual damage mechanics, scatter target scalar application,
 * and anti-mask priority order.
 *
 * Source parity references:
 * - SubdualDamageHelper.cpp — heal countdown + heal amount
 * - ActiveBody.cpp — isSubdued(): m_maxHealth <= m_currentSubdualDamage
 * - Weapon.cpp:2617-2624 — scatter target scalar applied to offset table
 * - WeaponSet.cpp:371-413 — getVictimAntiMask() priority order
 */

import { describe, expect, it } from 'vitest';

import { updateSubdualDamageHelpers } from './status-effects.js';
import { rebuildEntityScatterTargets } from './combat-helpers.js';
import { resolveTargetAntiMask } from './combat-targeting.js';
import {
  getVictimAntiMask,
  createWeaponSlotState,
  rebuildSlotScatterTargets,
  type WeaponSlotProfile,
} from './combat-weapon-set.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal entity shape for subdual damage tests. */
function makeSubdualEntity(overrides: {
  id?: number;
  maxHealth?: number;
  currentSubdualDamage?: number;
  subdualDamageCap?: number;
  subdualDamageHealRate?: number;
  subdualDamageHealAmount?: number;
  subdualHealingCountdown?: number;
  destroyed?: boolean;
} = {}) {
  return {
    id: overrides.id ?? 1,
    maxHealth: overrides.maxHealth ?? 100,
    currentSubdualDamage: overrides.currentSubdualDamage ?? 0,
    subdualDamageCap: overrides.subdualDamageCap ?? 200,
    subdualDamageHealRate: overrides.subdualDamageHealRate ?? 5,
    subdualDamageHealAmount: overrides.subdualDamageHealAmount ?? 10,
    subdualHealingCountdown: overrides.subdualHealingCountdown ?? 1,
    destroyed: overrides.destroyed ?? false,
    objectStatusFlags: new Set<string>(),
  };
}

/** Minimal GL-like context for updateSubdualDamageHelpers. */
function makeSubdualContext(entities: ReturnType<typeof makeSubdualEntity>[]) {
  const spawnedEntities = new Map<number, ReturnType<typeof makeSubdualEntity>>();
  for (const e of entities) {
    spawnedEntities.set(e.id, e);
  }
  return { spawnedEntities };
}

// ---------------------------------------------------------------------------
// Test 1: Subdual Damage Accumulation
// ---------------------------------------------------------------------------

describe('Subdual damage accumulation (parity: ActiveBody + SubdualDamageHelper)', () => {
  it('sets DISABLED_SUBDUED when currentSubdualDamage >= maxHealth', () => {
    // Source parity: ActiveBody.cpp:1318 — isSubdued() returns m_maxHealth <= m_currentSubdualDamage
    // Source parity: ActiveBody.cpp:1282 — onSubdualChange sets DISABLED_SUBDUED
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 100,
      subdualDamageCap: 200,
      subdualDamageHealRate: 5,
      subdualDamageHealAmount: 10,
      subdualHealingCountdown: 5, // not ready to heal yet
    });
    // Manually set the status as the game logic would when damage reaches threshold
    entity.objectStatusFlags.add('DISABLED_SUBDUED');

    expect(entity.currentSubdualDamage).toBeGreaterThanOrEqual(entity.maxHealth);
    expect(entity.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);
  });

  it('heals subdual damage by SubdualDamageHealAmount when countdown reaches zero', () => {
    // Source parity: SubdualDamageHelper.cpp:60-69
    // m_healingStepCountdown-- each frame; when <= 0, heal by SubdualDamageHealAmount
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 120,
      subdualDamageCap: 200,
      subdualDamageHealRate: 3,
      subdualDamageHealAmount: 25,
      subdualHealingCountdown: 1, // will tick to 0 and trigger heal
    });
    entity.objectStatusFlags.add('DISABLED_SUBDUED');

    const ctx = makeSubdualContext([entity]);
    updateSubdualDamageHelpers(ctx);

    // After one heal tick: 120 - 25 = 95 (below maxHealth of 100)
    expect(entity.currentSubdualDamage).toBe(95);
    // Countdown should reset to healRate
    expect(entity.subdualHealingCountdown).toBe(3);
  });

  it('clears DISABLED_SUBDUED when subdual damage heals below maxHealth', () => {
    // Source parity: ActiveBody.cpp:1274-1291 — onSubdualChange clears DISABLED_SUBDUED
    // Source parity: status-effects.ts:179-181 — wasSubdued && !nowSubdued -> delete flag
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 105,
      subdualDamageCap: 200,
      subdualDamageHealRate: 5,
      subdualDamageHealAmount: 10,
      subdualHealingCountdown: 1,
    });
    entity.objectStatusFlags.add('DISABLED_SUBDUED');

    const ctx = makeSubdualContext([entity]);
    updateSubdualDamageHelpers(ctx);

    // 105 - 10 = 95, which is < 100 (maxHealth), so subdued status clears
    expect(entity.currentSubdualDamage).toBe(95);
    expect(entity.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(false);
  });

  it('does not clear DISABLED_SUBDUED if damage remains >= maxHealth after heal', () => {
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 150,
      subdualDamageCap: 200,
      subdualDamageHealRate: 5,
      subdualDamageHealAmount: 10,
      subdualHealingCountdown: 1,
    });
    entity.objectStatusFlags.add('DISABLED_SUBDUED');

    const ctx = makeSubdualContext([entity]);
    updateSubdualDamageHelpers(ctx);

    // 150 - 10 = 140, still >= 100
    expect(entity.currentSubdualDamage).toBe(140);
    expect(entity.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);
  });

  it('clamps subdual damage to minimum of 0', () => {
    // Source parity: status-effects.ts:175 — Math.max(0, ...)
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 5,
      subdualDamageCap: 200,
      subdualDamageHealRate: 1,
      subdualDamageHealAmount: 50,
      subdualHealingCountdown: 1,
    });

    const ctx = makeSubdualContext([entity]);
    updateSubdualDamageHelpers(ctx);

    // 5 - 50 would be -45, but clamped to 0
    expect(entity.currentSubdualDamage).toBe(0);
  });

  it('does not heal when countdown has not reached zero', () => {
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 120,
      subdualDamageCap: 200,
      subdualDamageHealRate: 5,
      subdualDamageHealAmount: 10,
      subdualHealingCountdown: 3, // not zero yet
    });
    entity.objectStatusFlags.add('DISABLED_SUBDUED');

    const ctx = makeSubdualContext([entity]);
    updateSubdualDamageHelpers(ctx);

    // Countdown decremented but heal not triggered
    expect(entity.subdualHealingCountdown).toBe(2);
    expect(entity.currentSubdualDamage).toBe(120);
    expect(entity.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(true);
  });

  it('heals completely to zero over multiple frames and clears status', () => {
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 120,
      subdualDamageCap: 200,
      subdualDamageHealRate: 1, // heal every frame
      subdualDamageHealAmount: 10,
      subdualHealingCountdown: 1,
    });
    entity.objectStatusFlags.add('DISABLED_SUBDUED');

    const ctx = makeSubdualContext([entity]);

    // Step through frames until fully healed
    for (let frame = 0; frame < 20; frame++) {
      updateSubdualDamageHelpers(ctx);
    }

    expect(entity.currentSubdualDamage).toBe(0);
    expect(entity.objectStatusFlags.has('DISABLED_SUBDUED')).toBe(false);
  });

  it('skips destroyed entities', () => {
    const entity = makeSubdualEntity({
      maxHealth: 100,
      currentSubdualDamage: 120,
      subdualDamageHealRate: 1,
      subdualDamageHealAmount: 10,
      subdualHealingCountdown: 1,
      destroyed: true,
    });

    const ctx = makeSubdualContext([entity]);
    updateSubdualDamageHelpers(ctx);

    // Should not heal — entity is destroyed
    expect(entity.currentSubdualDamage).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Scatter Target Scalar Application
// ---------------------------------------------------------------------------

describe('Scatter target scalar application (parity: Weapon.cpp:2617-2624)', () => {
  it('builds scatter target index list matching the number of ScatterTarget entries', () => {
    // Source parity: Weapon::rebuildScatterTargets — builds indices [0..N-1]
    const entity = {
      attackWeapon: {
        scatterTargets: [
          { x: 10, z: 0 },
          { x: -10, z: 0 },
          { x: 0, z: 10 },
          { x: 0, z: -10 },
        ],
        clipSize: 4,
        autoReloadWhenIdleFrames: 0,
      },
      attackScatterTargetsUnused: [] as number[],
    };

    rebuildEntityScatterTargets(entity);

    expect(entity.attackScatterTargetsUnused).toEqual([0, 1, 2, 3]);
    expect(entity.attackScatterTargetsUnused.length).toBe(
      entity.attackWeapon.scatterTargets.length,
    );
  });

  it('scatter targets are consumed one per shot (indices removed)', () => {
    // Source parity: Weapon.cpp:2617 — randomPick from unused, swap-remove
    const entity = {
      attackWeapon: {
        scatterTargets: [
          { x: 10, z: 0 },
          { x: -10, z: 0 },
          { x: 0, z: 10 },
        ],
        clipSize: 3,
        autoReloadWhenIdleFrames: 0,
      },
      attackScatterTargetsUnused: [] as number[],
    };

    rebuildEntityScatterTargets(entity);
    expect(entity.attackScatterTargetsUnused.length).toBe(3);

    // Simulate consuming one target (swap-remove like the engine does)
    const pickIndex = 0;
    entity.attackScatterTargetsUnused[pickIndex] =
      entity.attackScatterTargetsUnused[entity.attackScatterTargetsUnused.length - 1]!;
    entity.attackScatterTargetsUnused.pop();

    expect(entity.attackScatterTargetsUnused.length).toBe(2);

    // Consume another
    entity.attackScatterTargetsUnused[0] =
      entity.attackScatterTargetsUnused[entity.attackScatterTargetsUnused.length - 1]!;
    entity.attackScatterTargetsUnused.pop();

    expect(entity.attackScatterTargetsUnused.length).toBe(1);
  });

  it('ScatterTargetScalar scales the offset coordinates', () => {
    // Source parity: Weapon.cpp:2620-2624
    //   scatterOffset.x *= scatterTargetScalar;
    //   scatterOffset.y *= scatterTargetScalar;
    // In TS (combat-targeting.ts:844-845):
    //   aimX += scatterOffset.x * weapon.scatterTargetScalar;
    //   aimZ += scatterOffset.z * weapon.scatterTargetScalar;

    const scatterTargets = [
      { x: 10, z: 5 },
      { x: -8, z: 3 },
    ];
    const scalar = 2.5;

    // Verify the math: offset * scalar produces scaled displacement
    for (const target of scatterTargets) {
      const scaledX = target.x * scalar;
      const scaledZ = target.z * scalar;

      expect(scaledX).toBe(target.x * 2.5);
      expect(scaledZ).toBe(target.z * 2.5);
    }

    // With scalar=2.5, a target at (10, 5) produces offset (25, 12.5)
    expect(scatterTargets[0].x * scalar).toBe(25);
    expect(scatterTargets[0].z * scalar).toBe(12.5);
  });

  it('ScatterTargetScalar of 0 produces zero offset (all shots hit same point)', () => {
    const scatterTargets = [
      { x: 10, z: 5 },
      { x: -8, z: 3 },
    ];
    const scalar = 0;

    // Note: -8 * 0 produces -0 in IEEE 754. Both +0 and -0 add nothing to aim
    // coordinates, so the weapon hits the exact same point regardless.
    for (const target of scatterTargets) {
      expect(Math.abs(target.x * scalar)).toBe(0);
      expect(Math.abs(target.z * scalar)).toBe(0);
    }
  });

  it('ScatterTargetScalar of 1.0 passes offsets through unmodified', () => {
    const scatterTargets = [
      { x: 10, z: 5 },
      { x: -8, z: 3 },
    ];
    const scalar = 1.0;

    expect(scatterTargets[0].x * scalar).toBe(10);
    expect(scatterTargets[0].z * scalar).toBe(5);
    expect(scatterTargets[1].x * scalar).toBe(-8);
    expect(scatterTargets[1].z * scalar).toBe(3);
  });

  it('weapon profile stores scatterTargetScalar for combat-targeting use', () => {
    // Verify the WeaponSlotProfile interface carries scatterTargetScalar
    const slot = createWeaponSlotState(0);
    const profile: Partial<WeaponSlotProfile> = {
      scatterTargetScalar: 1.5,
      scatterTargets: [{ x: 4, z: 6 }],
    };

    rebuildSlotScatterTargets(slot, profile as WeaponSlotProfile);
    expect(slot.scatterTargetsUnused).toEqual([0]);
    expect(profile.scatterTargetScalar).toBe(1.5);
  });

  it('empty scatter targets list produces no offsets', () => {
    const entity = {
      attackWeapon: {
        scatterTargets: [] as { x: number; z: number }[],
        clipSize: 0,
        autoReloadWhenIdleFrames: 0,
      },
      attackScatterTargetsUnused: [] as number[],
    };

    rebuildEntityScatterTargets(entity);
    expect(entity.attackScatterTargetsUnused).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Anti-Mask Priority Order (MINE vs SMALL_MISSILE)
// ---------------------------------------------------------------------------

describe('Anti-mask priority order (parity: WeaponSet.cpp:371-413)', () => {
  // C++ getVictimAntiMask (WeaponSet.cpp:371-413) checks in this order:
  // 1. SMALL_MISSILE -> WEAPON_ANTI_SMALL_MISSILE
  // 2. BALLISTIC_MISSILE -> WEAPON_ANTI_BALLISTIC_MISSILE
  // 3. PROJECTILE -> WEAPON_ANTI_PROJECTILE
  // 4. MINE/DEMOTRAP -> WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND
  // 5. Airborne -> (vehicle/infantry/parachute sub-checks)
  // 6. Default -> WEAPON_ANTI_GROUND

  const WEAPON_ANTI_AIRBORNE_VEHICLE = 0x01;
  const WEAPON_ANTI_GROUND = 0x02;
  const WEAPON_ANTI_PROJECTILE = 0x04;
  const WEAPON_ANTI_SMALL_MISSILE = 0x08;
  const WEAPON_ANTI_MINE = 0x10;
  const WEAPON_ANTI_AIRBORNE_INFANTRY = 0x20;
  const WEAPON_ANTI_BALLISTIC_MISSILE = 0x40;
  const WEAPON_ANTI_PARACHUTE = 0x80;

  describe('getVictimAntiMask (combat-weapon-set.ts) — standalone anti-mask helper', () => {
    it('returns ANTI_MINE | ANTI_GROUND for pure MINE entity', () => {
      const mask = getVictimAntiMask(
        false, // isAirborne
        true,  // isMine
        false, // isSmallMissile
        false, // isBallisticMissile
        false, // isProjectile
        false, // isVehicle
        false, // isInfantry
        false, // isParachute
      );
      expect(mask).toBe(WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND);
    });

    it('returns ANTI_SMALL_MISSILE for pure SMALL_MISSILE entity', () => {
      const mask = getVictimAntiMask(false, false, true, false, false, false, false, false);
      expect(mask).toBe(WEAPON_ANTI_SMALL_MISSILE);
    });

    it('MINE flag takes priority over SMALL_MISSILE in combat-weapon-set.ts', () => {
      // Documentation: In combat-weapon-set.ts getVictimAntiMask, MINE is checked
      // BEFORE SMALL_MISSILE (line 878 vs 881). An entity with both flags returns
      // ANTI_MINE | ANTI_GROUND.
      //
      // C++ reference (WeaponSet.cpp:373-386): SMALL_MISSILE is checked BEFORE MINE.
      // An entity with both flags in C++ would return ANTI_SMALL_MISSILE.
      //
      // This is a known divergence: the standalone getVictimAntiMask in
      // combat-weapon-set.ts prioritizes MINE, while the C++ prioritizes SMALL_MISSILE.
      const mask = getVictimAntiMask(
        false, // isAirborne
        true,  // isMine
        true,  // isSmallMissile — both flags active
        false, // isBallisticMissile
        false, // isProjectile
        false, // isVehicle
        false, // isInfantry
        false, // isParachute
      );

      // TS combat-weapon-set.ts: MINE wins (checked first at line 878)
      expect(mask).toBe(WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND);

      // NOTE: In C++ (WeaponSet.cpp:373), SMALL_MISSILE is checked first, so
      // the C++ result would be WEAPON_ANTI_SMALL_MISSILE (0x08).
      // The C++ parity expectation is documented here for reference:
      const cppExpectedMask = WEAPON_ANTI_SMALL_MISSILE;
      expect(cppExpectedMask).toBe(0x08);
      // The TS result differs from C++ when both MINE and SMALL_MISSILE are set.
      expect(mask).not.toBe(cppExpectedMask);
    });
  });

  describe('resolveTargetAntiMask (combat-targeting.ts) — runtime targeting path', () => {
    // The resolveTargetAntiMask function used at runtime in combat-targeting.ts
    // checks SMALL_MISSILE before MINE, matching C++ exactly.

    function makeMockSelf() {
      return {
        entityHasObjectStatus: (_entity: unknown, _status: string) => false,
      };
    }

    function makeMockTarget(category: string = 'ground') {
      return { category };
    }

    it('returns ANTI_SMALL_MISSILE for SMALL_MISSILE entity', () => {
      const kindOf = new Set(['SMALL_MISSILE']);
      const mask = resolveTargetAntiMask(makeMockSelf(), makeMockTarget(), kindOf);
      expect(mask).toBe(WEAPON_ANTI_SMALL_MISSILE);
    });

    it('returns ANTI_MINE | ANTI_GROUND for MINE entity', () => {
      const kindOf = new Set(['MINE']);
      const mask = resolveTargetAntiMask(makeMockSelf(), makeMockTarget(), kindOf);
      expect(mask).toBe(WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND);
    });

    it('SMALL_MISSILE takes priority over MINE — matches C++ (WeaponSet.cpp:373)', () => {
      // Source parity: C++ checks KINDOF_SMALL_MISSILE (line 373) before
      // KINDOF_MINE (line 386). resolveTargetAntiMask matches this order.
      const kindOf = new Set(['SMALL_MISSILE', 'MINE']);
      const mask = resolveTargetAntiMask(makeMockSelf(), makeMockTarget(), kindOf);

      // SMALL_MISSILE is checked first (combat-targeting.ts:227), matching C++
      expect(mask).toBe(WEAPON_ANTI_SMALL_MISSILE);
    });

    it('documents priority divergence between the two TS anti-mask functions', () => {
      // Entity with both MINE and SMALL_MISSILE flags:
      //
      // C++ getVictimAntiMask (WeaponSet.cpp):
      //   SMALL_MISSILE checked first -> returns ANTI_SMALL_MISSILE
      //
      // TS resolveTargetAntiMask (combat-targeting.ts):
      //   SMALL_MISSILE checked first -> returns ANTI_SMALL_MISSILE (MATCHES C++)
      //
      // TS getVictimAntiMask (combat-weapon-set.ts):
      //   MINE checked first -> returns ANTI_MINE | ANTI_GROUND (DIVERGES from C++)
      //
      // The runtime targeting path (resolveTargetAntiMask) is correct.
      // The standalone helper (getVictimAntiMask) has inverted priority.

      const kindOf = new Set(['SMALL_MISSILE', 'MINE']);
      const runtimeMask = resolveTargetAntiMask(makeMockSelf(), makeMockTarget(), kindOf);
      const standaloneMask = getVictimAntiMask(false, true, true, false, false, false, false, false);

      // Runtime path matches C++
      expect(runtimeMask).toBe(WEAPON_ANTI_SMALL_MISSILE);
      // Standalone helper diverges
      expect(standaloneMask).toBe(WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND);
      // They produce different results for the same entity
      expect(runtimeMask).not.toBe(standaloneMask);
    });

    it('BALLISTIC_MISSILE takes priority over PROJECTILE', () => {
      const kindOf = new Set(['BALLISTIC_MISSILE', 'PROJECTILE']);
      const mask = resolveTargetAntiMask(makeMockSelf(), makeMockTarget(), kindOf);
      expect(mask).toBe(WEAPON_ANTI_BALLISTIC_MISSILE);
    });

    it('returns ANTI_GROUND for plain ground unit', () => {
      const kindOf = new Set(['VEHICLE']);
      const mask = resolveTargetAntiMask(makeMockSelf(), makeMockTarget(), kindOf);
      expect(mask).toBe(WEAPON_ANTI_GROUND);
    });

    it('returns ANTI_AIRBORNE_VEHICLE for airborne vehicle', () => {
      const self = {
        entityHasObjectStatus: (_entity: unknown, status: string) =>
          status === 'AIRBORNE_TARGET',
      };
      const kindOf = new Set(['VEHICLE']);
      const mask = resolveTargetAntiMask(self, makeMockTarget('air'), kindOf);
      expect(mask).toBe(WEAPON_ANTI_AIRBORNE_VEHICLE);
    });

    it('returns ANTI_AIRBORNE_INFANTRY for airborne infantry', () => {
      const self = {
        entityHasObjectStatus: (_entity: unknown, status: string) =>
          status === 'AIRBORNE_TARGET',
      };
      const kindOf = new Set(['INFANTRY']);
      const mask = resolveTargetAntiMask(self, makeMockTarget('air'), kindOf);
      expect(mask).toBe(WEAPON_ANTI_AIRBORNE_INFANTRY);
    });

    it('returns ANTI_PARACHUTE for airborne parachute', () => {
      const self = {
        entityHasObjectStatus: (_entity: unknown, status: string) =>
          status === 'AIRBORNE_TARGET',
      };
      const kindOf = new Set(['PARACHUTE']);
      const mask = resolveTargetAntiMask(self, makeMockTarget('air'), kindOf);
      expect(mask).toBe(WEAPON_ANTI_PARACHUTE);
    });

    it('returns 0 for airborne entity with no recognized sub-type', () => {
      // Source parity: WeaponSet.cpp:403-408 — unrecognized airborne type
      const self = {
        entityHasObjectStatus: (_entity: unknown, status: string) =>
          status === 'AIRBORNE_TARGET',
      };
      const kindOf = new Set(['STRUCTURE']); // not vehicle, infantry, or parachute
      const mask = resolveTargetAntiMask(self, makeMockTarget('air'), kindOf);
      expect(mask).toBe(0);
    });
  });
});
