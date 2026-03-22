/**
 * Parity Tests — Weapon attack range UNDERSIZE fudge and reload time sharing.
 *
 * Source references:
 *   Weapon.cpp:461-475 — getAttackRange(): subtracts PATHFIND_CELL_SIZE*0.25 before RANGE bonus
 *   Weapon.cpp:2400-2412 — privateFireWeapon(): when isReloadTimeShared(), propagates timing to all slots
 *   WeaponSet.h:132 — m_isReloadTimeShared flag on WeaponTemplateSet
 *   weapon-profiles.ts:65 — TS applies ATTACK_RANGE_CELL_EDGE_FUDGE
 *   combat-weapon-set.ts:141 — shareReloadTime flag in WeaponTemplateSetDef
 *   combat-weapon-set.ts:772-810 — fireWeaponSlot() per-slot cooldown
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
  ATTACK_RANGE_CELL_EDGE_FUDGE,
  PATHFIND_CELL_SIZE,
} from './index.js';
import {
  resolveWeaponProfileFromDef,
} from './weapon-profiles.js';
import {
  createMultiWeaponEntityState,
  createWeaponSlotState,
  fireWeaponSlot,
  getWeaponSlotStatus,
  type WeaponSlotProfile,
  type WeaponSlotState,
  WEAPON_SLOT_PRIMARY,
  WEAPON_SLOT_SECONDARY,
} from './combat-weapon-set.js';

// ── Test 1: Weapon Attack Range UNDERSIZE Fudge ──────────────────────────

describe('Weapon attack range UNDERSIZE fudge (PATHFIND_CELL_EDGE_FUDGE)', () => {
  /**
   * C++ parity: WeaponTemplate::getAttackRange (Weapon.cpp:461-475)
   *
   *   Real WeaponTemplate::getAttackRange(const WeaponBonus& bonus) const {
   *     #ifdef RATIONALIZE_ATTACK_RANGE
   *       const Real UNDERSIZE = PATHFIND_CELL_SIZE_F*0.25f;
   *       Real r = m_attackRange * bonus.getField(WeaponBonus::RANGE) - UNDERSIZE;
   *       if (r < 0.0f) r = 0.0f;
   *       return r;
   *     #endif
   *   }
   *
   * The fudge = PATHFIND_CELL_SIZE * 0.25 = 10 * 0.25 = 2.5.
   * A weapon with AttackRange=100 has effective range = 100 - 2.5 = 97.5.
   * This prevents units from teetering on the edge of a pathfind cell
   * while trying to fire.
   *
   * TS parity: weapon-profiles.ts line 65 applies the same fudge:
   *   const attackRange = Math.max(0, attackRangeRaw - ATTACK_RANGE_CELL_EDGE_FUDGE);
   */

  it('confirms ATTACK_RANGE_CELL_EDGE_FUDGE equals PATHFIND_CELL_SIZE * 0.25', () => {
    // Source parity: C++ UNDERSIZE = PATHFIND_CELL_SIZE_F * 0.25f
    expect(PATHFIND_CELL_SIZE).toBe(10);
    expect(ATTACK_RANGE_CELL_EDGE_FUDGE).toBe(PATHFIND_CELL_SIZE * 0.25);
    expect(ATTACK_RANGE_CELL_EDGE_FUDGE).toBe(2.5);
  });

  it('subtracts fudge from attack range — effective range is AttackRange - 2.5', () => {
    // Create a minimal self-like object for resolveWeaponProfileFromDef.
    // The function reads INI fields and applies fudge to attackRange.
    const mockSelf = {
      readIniFieldValue: (fields: Record<string, unknown>, key: string) => fields[key],
      extractIniValueTokens: () => [],
      resolveWeaponRadiusAffectsMask: () => 0,
      resolveWeaponProjectileCollideMask: () => 0,
      resolveWeaponDamageTypeName: () => 'ARMOR_PIERCING',
      resolveWeaponContinuousFireBonuses: () => ({
        continuousFireMeanRateOfFire: 1.0,
        continuousFireFastRateOfFire: 1.0,
      }),
      msToLogicFrames: (ms: number) => Math.ceil(ms * 30 / 1000),
      normalizeKindOf: (s: Set<string>) => s,
      extractDumbProjectileArcParams: () => null,
    };

    const weaponDef = {
      name: 'TestRangeGun',
      fields: {
        AttackRange: 100,
        PrimaryDamage: 50,
        DamageType: 'ARMOR_PIERCING',
        DelayBetweenShots: 500,
      } as Record<string, string | number | boolean | string[] | number[]>,
      blocks: [],
    };

    const profile = resolveWeaponProfileFromDef(mockSelf, weaponDef);
    expect(profile).not.toBeNull();
    if (!profile) return;

    // Source parity: effective range = max(0, raw - FUDGE) = max(0, 100 - 2.5) = 97.5
    expect(profile.attackRange).toBe(100 - ATTACK_RANGE_CELL_EDGE_FUDGE);
    expect(profile.attackRange).toBe(97.5);

    // The unmodified range should be preserved for UI display.
    expect(profile.unmodifiedAttackRange).toBe(100);
  });

  it('target within fudge-reduced effective range receives damage', () => {
    // Set up a combat scenario where attacker has AttackRange=100.
    // After fudge: effective range = 100 - 2.5 = 97.5.
    // Place target at distance ~20 — well within effective range.

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('RangeAttacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('RangeGun100'),
          ]),
          makeObjectDef('RangeVictim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('RangeGun100', {
            PrimaryDamage: 20,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      // Place target at distance ~20 — well within range of 97.5.
      mapObjects: [place('RangeAttacker', 10, 10), place('RangeVictim', 30, 10)],
      mapSize: 64,
      sides: { America: { credits: 0 }, China: { credits: 0 } },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);
    const snapBefore = agent.snapshot();
    agent.step(10);
    const d = agent.diff(snapBefore);

    // Target should take damage — attacker is well within effective range (97.5).
    expect(d.damaged.length).toBeGreaterThan(0);
    const victimDamaged = d.damaged.find((e) => e.id === 2);
    expect(victimDamaged).toBeDefined();
    expect(victimDamaged!.hpAfter).toBeLessThan(victimDamaged!.hpBefore);

    // Verify the resolved weapon has the fudge-reduced range.
    const attackerEntity = agent.gameLogic.getEntityState(1);
    expect(attackerEntity).not.toBeNull();
    const priv = agent.gameLogic as unknown as { spawnedEntities: Map<number, { attackWeapon: { attackRange: number; unmodifiedAttackRange: number } | null }> };
    const attackerInternal = priv.spawnedEntities.get(1);
    if (attackerInternal?.attackWeapon) {
      expect(attackerInternal.attackWeapon.attackRange).toBe(100 - ATTACK_RANGE_CELL_EDGE_FUDGE);
      expect(attackerInternal.attackWeapon.unmodifiedAttackRange).toBe(100);
    }
  });

  it('clamps effective range to 0 when AttackRange is smaller than fudge', () => {
    const mockSelf = {
      readIniFieldValue: (fields: Record<string, unknown>, key: string) => fields[key],
      extractIniValueTokens: () => [],
      resolveWeaponRadiusAffectsMask: () => 0,
      resolveWeaponProjectileCollideMask: () => 0,
      resolveWeaponDamageTypeName: () => 'ARMOR_PIERCING',
      resolveWeaponContinuousFireBonuses: () => ({
        continuousFireMeanRateOfFire: 1.0,
        continuousFireFastRateOfFire: 1.0,
      }),
      msToLogicFrames: (ms: number) => Math.ceil(ms * 30 / 1000),
      normalizeKindOf: (s: Set<string>) => s,
      extractDumbProjectileArcParams: () => null,
    };

    const tinyRangeWeapon = {
      name: 'TinyRangeGun',
      fields: {
        AttackRange: 1,  // less than fudge (2.5)
        PrimaryDamage: 50,
        DamageType: 'ARMOR_PIERCING',
      } as Record<string, string | number | boolean | string[] | number[]>,
      blocks: [],
    };

    // Source parity: max(0, 1 - 2.5) = 0 → weapon profile returns null because attackRange <= 0.
    const profile = resolveWeaponProfileFromDef(mockSelf, tinyRangeWeapon);
    expect(profile).toBeNull();
  });
});

// ── Test 2: Reload Time Sharing Across Weapon Slots ────────────────────

describe('Reload time sharing across weapon slots', () => {
  /**
   * C++ parity: Weapon.cpp:2400-2412 — privateFireWeapon()
   *
   *   When isReloadTimeShared():
   *     for (Int wt = 0; wt < WEAPONSLOT_COUNT; wt++) {
   *       Weapon *weapon = sourceObj->getWeaponInWeaponSlot((WeaponSlotType)wt);
   *       if (weapon) {
   *         weapon->setPossibleNextShotFrame(m_whenWeCanFireAgain);
   *         weapon->setStatus(BETWEEN_FIRING_SHOTS);
   *       }
   *     }
   *
   * When one weapon fires, ALL weapons in the set get their next-fire-frame
   * set to the same value, effectively preventing any weapon from firing until
   * the shared cooldown expires.
   *
   * TS implementation: fireWeaponSlot() calls propagateSharedReloadTime()
   * which sets nextFireFrame on all sibling slots when shareReloadTime is true.
   * Additionally, the main combat loop uses entity-level nextAttackFrame which
   * provides equivalent shared-cooldown behavior at the gameplay level.
   */

  function makeTestWeaponSlotProfile(overrides: Partial<WeaponSlotProfile> = {}): WeaponSlotProfile {
    return {
      name: 'TestWeapon',
      slotIndex: 0,
      primaryDamage: 50,
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
      radiusDamageAffectsMask: 0,
      projectileCollideMask: 0,
      weaponSpeed: 999999,
      minWeaponSpeed: 999999,
      scaleWeaponSpeed: false,
      capableOfFollowingWaypoints: false,
      projectileObjectName: null,
      attackRange: 100,
      unmodifiedAttackRange: 100,
      minAttackRange: 0,
      continueAttackRange: 0,
      clipSize: 0,
      clipReloadFrames: 0,
      autoReloadWhenIdleFrames: 0,
      preAttackDelayFrames: 0,
      preAttackType: 'PER_SHOT',
      minDelayFrames: 3,
      maxDelayFrames: 3,
      antiMask: 0x02,
      continuousFireOneShotsNeeded: 0,
      continuousFireTwoShotsNeeded: 0,
      continuousFireCoastFrames: 0,
      continuousFireMeanRateOfFire: 1.0,
      continuousFireFastRateOfFire: 1.0,
      laserName: null,
      projectileArcFirstHeight: 0,
      projectileArcSecondHeight: 0,
      projectileArcFirstPercentIndent: 0,
      projectileArcSecondPercentIndent: 0,
      leechRangeWeapon: false,
      fireSoundEvent: null,
      autoChooseSourceMask: 0xffffffff,
      preferredAgainstKindOf: new Set<string>(),
      ...overrides,
    };
  }

  it('firing primary weapon does NOT affect secondary nextFireFrame when reload is NOT shared', () => {
    // Set up multi-weapon state with two weapon slots, no shared reload.
    const state = createMultiWeaponEntityState();
    const primaryProfile = makeTestWeaponSlotProfile({ name: 'PrimaryGun', slotIndex: 0, minDelayFrames: 5, maxDelayFrames: 5 });
    const secondaryProfile = makeTestWeaponSlotProfile({ name: 'SecondaryGun', slotIndex: 1, minDelayFrames: 3, maxDelayFrames: 3 });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'PrimaryGun';
    state.weaponSlots[1].weaponName = 'SecondaryGun';
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 100;

    // Fire primary weapon.
    fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 5);

    // Primary should have nextFireFrame set.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 5);

    // Secondary should NOT be affected — its nextFireFrame stays at initial value.
    expect(state.weaponSlots[1].nextFireFrame).toBe(0);

    // Secondary should be READY_TO_FIRE.
    const secondaryStatus = getWeaponSlotStatus(state.weaponSlots[1], secondaryProfile, frameCounter);
    expect(secondaryStatus).toBe('READY_TO_FIRE');
  });

  it('shared reload propagates nextFireFrame to all sibling slots (Weapon.cpp:2400-2412)', () => {
    // Source parity: In C++, when isReloadTimeShared() is true, firing one weapon
    // sets m_whenWeCanFireAgain on ALL weapon slots (Weapon.cpp:2400-2412).
    //
    // The TS port propagates nextFireFrame to all sibling slots via
    // propagateSharedReloadTime() called from fireWeaponSlot().

    const state = createMultiWeaponEntityState();
    state.shareReloadTime = true;
    const primaryProfile = makeTestWeaponSlotProfile({ name: 'SharedPrimary', slotIndex: 0, minDelayFrames: 10, maxDelayFrames: 10 });
    const secondaryProfile = makeTestWeaponSlotProfile({ name: 'SharedSecondary', slotIndex: 1, minDelayFrames: 8, maxDelayFrames: 8 });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'SharedPrimary';
    state.weaponSlots[1].weaponName = 'SharedSecondary';
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 200;

    // Fire primary weapon.
    fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 10);

    // Primary nextFireFrame is set.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 10);

    // Source parity: secondary nextFireFrame is ALSO set to the same value.
    expect(state.weaponSlots[1].nextFireFrame).toBe(frameCounter + 10);

    // Secondary should be BETWEEN_FIRING_SHOTS (shared cooldown).
    const secondaryStatus = getWeaponSlotStatus(state.weaponSlots[1], secondaryProfile, frameCounter);
    expect(secondaryStatus).toBe('BETWEEN_FIRING_SHOTS');
  });

  it('per-entity nextAttackFrame provides implicit shared cooldown at combat level', () => {
    // The main combat loop (combat-update.ts) uses entity-level nextAttackFrame,
    // not per-slot nextFireFrame. This means all weapons on an entity implicitly
    // share a single cooldown at the gameplay level, equivalent to the C++
    // isReloadTimeShared() behavior. The per-slot propagation via fireWeaponSlot()
    // ensures parity at the slot API level as well.
    //
    // Verify with a real combat scenario: entity fires, then cannot fire again
    // until nextAttackFrame passes.

    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('DualGunUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('DualPrimaryGun'),
          ]),
          makeObjectDef('DualTarget', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('DualPrimaryGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 1000, // ~30 frames at 30fps
          }),
        ],
      },
      mapObjects: [place('DualGunUnit', 10, 10), place('DualTarget', 30, 10)],
      mapSize: 64,
      sides: { America: { credits: 0 }, China: { credits: 0 } },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Step enough frames for first shot, then check entity state.
    const snapBefore = agent.snapshot();
    agent.step(60); // ~2 seconds of game time

    const d = agent.diff(snapBefore);
    const victimDamaged = d.damaged.find((e) => e.id === 2);
    expect(victimDamaged).toBeDefined();

    // With 1000ms delay (30 frames) between shots and 60 frames elapsed,
    // the attacker should fire roughly 2-3 shots (10 damage each).
    // The entity-level nextAttackFrame prevents more shots from occurring.
    const totalDamage = victimDamaged!.hpBefore - victimDamaged!.hpAfter;
    expect(totalDamage).toBeGreaterThanOrEqual(10); // at least 1 shot
    expect(totalDamage).toBeLessThanOrEqual(40);    // at most 4 shots (timing imprecision)
  });

  it('fireWeaponSlot with clip depleted triggers reload on fired slot only (no sharing)', () => {
    // When shareReloadTime is false, only the fired slot gets cooldown.

    const state = createMultiWeaponEntityState();
    // shareReloadTime defaults to false
    const primaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipPrimary',
      slotIndex: 0,
      clipSize: 1,  // 1 shot per clip
      clipReloadFrames: 30,
      minDelayFrames: 5,
      maxDelayFrames: 5,
    });
    const secondaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipSecondary',
      slotIndex: 1,
      clipSize: 3,
      clipReloadFrames: 20,
      minDelayFrames: 3,
      maxDelayFrames: 3,
    });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'ClipPrimary';
    state.weaponSlots[0].ammoInClip = 1;
    state.weaponSlots[1].weaponName = 'ClipSecondary';
    state.weaponSlots[1].ammoInClip = 3;
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 300;

    // Fire primary — it has clipSize=1, so this depletes the clip.
    const clipEmpty = fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 5);

    // Clip should be empty (fireWeaponSlot returns true when clip empties).
    expect(clipEmpty).toBe(true);
    expect(state.weaponSlots[0].ammoInClip).toBe(0);
    expect(state.weaponSlots[0].reloadFinishFrame).toBe(frameCounter + 30);
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 30);

    // Primary should be RELOADING_CLIP.
    const primaryStatus = getWeaponSlotStatus(state.weaponSlots[0], primaryProfile, frameCounter);
    expect(primaryStatus).toBe('RELOADING_CLIP');

    // Secondary should be UNAFFECTED — still has ammo and no cooldown.
    expect(state.weaponSlots[1].ammoInClip).toBe(3);
    expect(state.weaponSlots[1].nextFireFrame).toBe(0);
    const secondaryStatus = getWeaponSlotStatus(state.weaponSlots[1], secondaryProfile, frameCounter);
    expect(secondaryStatus).toBe('READY_TO_FIRE');
  });

  it('fireWeaponSlot with clip depleted propagates nextFireFrame when shared', () => {
    // Source parity: When shareReloadTime is true AND clip depletes,
    // ALL slots get nextFireFrame set to the reload finish time.

    const state = createMultiWeaponEntityState();
    state.shareReloadTime = true;
    const primaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipPrimary',
      slotIndex: 0,
      clipSize: 1,
      clipReloadFrames: 30,
      minDelayFrames: 5,
      maxDelayFrames: 5,
    });
    const secondaryProfile = makeTestWeaponSlotProfile({
      name: 'ClipSecondary',
      slotIndex: 1,
      clipSize: 3,
      clipReloadFrames: 20,
      minDelayFrames: 3,
      maxDelayFrames: 3,
    });

    state.weaponSlotProfiles[0] = primaryProfile;
    state.weaponSlotProfiles[1] = secondaryProfile;
    state.weaponSlots[0].weaponName = 'ClipPrimary';
    state.weaponSlots[0].ammoInClip = 1;
    state.weaponSlots[1].weaponName = 'ClipSecondary';
    state.weaponSlots[1].ammoInClip = 3;
    state.filledWeaponSlotMask = 0b11;

    const frameCounter = 300;

    const clipEmpty = fireWeaponSlot(state, WEAPON_SLOT_PRIMARY, frameCounter, () => 5);
    expect(clipEmpty).toBe(true);

    // Primary is reloading.
    expect(state.weaponSlots[0].nextFireFrame).toBe(frameCounter + 30);

    // Source parity: secondary nextFireFrame is also set (shared cooldown).
    expect(state.weaponSlots[1].nextFireFrame).toBe(frameCounter + 30);

    // Secondary still has ammo, but its nextFireFrame blocks it.
    expect(state.weaponSlots[1].ammoInClip).toBe(3);
    const secondaryStatus = getWeaponSlotStatus(state.weaponSlots[1], secondaryProfile, frameCounter);
    expect(secondaryStatus).toBe('BETWEEN_FIRING_SHOTS');
  });
});
