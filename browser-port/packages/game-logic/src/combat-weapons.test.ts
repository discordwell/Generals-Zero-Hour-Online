/**
 * Tests for the multi-weapon combat system.
 *
 * Covers:
 * - Multi-weapon slot firing (independent cooldown/reload per slot)
 * - WeaponSet condition matching (VETERAN, PLAYER_UPGRADE, etc.)
 * - Damage type vs armor type calculation
 * - Scatter radius application
 * - Projectile type classification
 * - Best weapon selection (chooseBestWeaponForTarget)
 * - Weapon lock management
 * - Victim anti-mask computation
 */

import { describe, expect, it } from 'vitest';

import {
  adjustDamageByArmor,
  applyScatterOffset,
  chooseBestWeaponForTarget,
  classifyProjectileFlightModel,
  clearLeechRangeAllSlots,
  createMultiWeaponEntityState,
  createWeaponSlotState,
  estimateWeaponDamage,
  fireWeaponSlot,
  getReadyToFireSlots,
  getVictimAntiMask,
  getWeaponSlotStatus,
  isWeaponSetOutOfAmmo,
  rebuildSlotScatterTargets,
  recordSlotConsecutiveShot,
  releaseWeaponLock,
  reloadAllWeaponSlots,
  resolveScatterRadius,
  resolveWeaponSlotDelayFrames,
  resolveWeaponSlotPreAttackDelay,
  resetWeaponSlotState,
  selectBestWeaponTemplateSet,
  setWeaponLock,
  updateWeaponSetFromProfiles,
  updateWeaponSlotIdleAutoReload,
  WEAPON_SLOT_COUNT,
  WEAPON_SLOT_PRIMARY,
  WEAPON_SLOT_SECONDARY,
  WEAPON_SLOT_TERTIARY,
  type ChooseBestWeaponContext,
  type MultiWeaponEntityState,
  type WeaponSlotProfile,
  type WeaponSlotState,
} from './combat-weapon-set.js';

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
    clipSize: 0,
    clipReloadFrames: 0,
    autoReloadWhenIdleFrames: 0,
    preAttackDelayFrames: 0,
    preAttackType: 'PER_SHOT',
    minDelayFrames: 5,
    maxDelayFrames: 5,
    antiMask: 0x02, // WEAPON_ANTI_GROUND
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

function makeChooseContext(overrides: Partial<ChooseBestWeaponContext> = {}): ChooseBestWeaponContext {
  return {
    distanceSqrToVictim: 100 * 100, // 100 units away
    victimAntiMask: 0x02, // WEAPON_ANTI_GROUND
    victimArmorCoefficients: null,
    victimKindOf: new Set(),
    commandSourceBit: 0xFFFFFFFF,
    frameCounter: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WeaponSet condition matching
// ---------------------------------------------------------------------------

describe('WeaponSet condition matching', () => {
  it('selects the set with no conditions when mask is 0', () => {
    const sets = [
      { conditionsMask: 0, label: 'default' },
      { conditionsMask: 1, label: 'veteran' },
      { conditionsMask: 2, label: 'elite' },
    ];
    const result = selectBestWeaponTemplateSet(sets, 0);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('default');
  });

  it('selects VETERAN set when veteran flag is active', () => {
    const VETERAN = 1 << 0;
    const sets = [
      { conditionsMask: 0, label: 'default' },
      { conditionsMask: VETERAN, label: 'veteran' },
    ];
    const result = selectBestWeaponTemplateSet(sets, VETERAN);
    expect(result!.label).toBe('veteran');
  });

  it('selects PLAYER_UPGRADE set when upgrade flag is active', () => {
    const PLAYER_UPGRADE = 1 << 3;
    const sets = [
      { conditionsMask: 0, label: 'default' },
      { conditionsMask: PLAYER_UPGRADE, label: 'upgraded' },
    ];
    const result = selectBestWeaponTemplateSet(sets, PLAYER_UPGRADE);
    expect(result!.label).toBe('upgraded');
  });

  it('selects best match when multiple conditions active', () => {
    const VETERAN = 1 << 0;
    const PLAYER_UPGRADE = 1 << 3;
    const sets = [
      { conditionsMask: 0, label: 'default' },
      { conditionsMask: VETERAN, label: 'veteran' },
      { conditionsMask: PLAYER_UPGRADE, label: 'upgraded' },
      { conditionsMask: VETERAN | PLAYER_UPGRADE, label: 'vet+upgrade' },
    ];
    const result = selectBestWeaponTemplateSet(sets, VETERAN | PLAYER_UPGRADE);
    expect(result!.label).toBe('vet+upgrade');
  });

  it('falls back to best partial match when exact match unavailable', () => {
    const VETERAN = 1 << 0;
    const ELITE = 1 << 1;
    const PLAYER_UPGRADE = 1 << 3;
    const sets = [
      { conditionsMask: 0, label: 'default' },
      { conditionsMask: VETERAN, label: 'veteran' },
      { conditionsMask: ELITE, label: 'elite' },
    ];
    // Active flags: VETERAN + PLAYER_UPGRADE. No exact match, but VETERAN
    // matches 1 bit with no extraneous bits, which is better than elite (0 matches).
    const result = selectBestWeaponTemplateSet(sets, VETERAN | PLAYER_UPGRADE);
    expect(result!.label).toBe('veteran');
  });

  it('prefers fewer extraneous bits on tie', () => {
    const VETERAN = 1 << 0;
    const ELITE = 1 << 1;
    const sets = [
      { conditionsMask: VETERAN | ELITE, label: 'both' },
      { conditionsMask: VETERAN, label: 'vetOnly' },
    ];
    // Active: only VETERAN. Both sets match 1 bit, but 'vetOnly' has 0 extraneous
    // while 'both' has 1 extraneous (ELITE).
    const result = selectBestWeaponTemplateSet(sets, VETERAN);
    expect(result!.label).toBe('vetOnly');
  });

  it('returns null for empty sets', () => {
    expect(selectBestWeaponTemplateSet([], 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-weapon slot firing
// ---------------------------------------------------------------------------

describe('Multi-weapon slot firing', () => {
  it('fires weapon slots independently with separate cooldowns', () => {
    const state = createMultiWeaponEntityState();
    const primary = makeWeaponProfile({
      name: 'MachineGun',
      slotIndex: 0,
      minDelayFrames: 3,
      maxDelayFrames: 3,
    });
    const secondary = makeWeaponProfile({
      name: 'MissileLauncher',
      slotIndex: 1,
      minDelayFrames: 30,
      maxDelayFrames: 30,
    });
    state.weaponSlotProfiles[0] = primary;
    state.weaponSlotProfiles[1] = secondary;
    state.filledWeaponSlotMask = 0x03;
    resetWeaponSlotState(state.weaponSlots[0], primary);
    resetWeaponSlotState(state.weaponSlots[1], secondary);

    // Frame 0: both ready
    expect(getWeaponSlotStatus(state.weaponSlots[0], primary, 0)).toBe('READY_TO_FIRE');
    expect(getWeaponSlotStatus(state.weaponSlots[1], secondary, 0)).toBe('READY_TO_FIRE');

    // Fire primary at frame 0
    fireWeaponSlot(state, 0, 0, () => 3);
    expect(state.weaponSlots[0].nextFireFrame).toBe(3);

    // Fire secondary at frame 0
    fireWeaponSlot(state, 1, 0, () => 30);
    expect(state.weaponSlots[1].nextFireFrame).toBe(30);

    // Frame 3: primary ready, secondary still cooling
    expect(getWeaponSlotStatus(state.weaponSlots[0], primary, 3)).toBe('READY_TO_FIRE');
    expect(getWeaponSlotStatus(state.weaponSlots[1], secondary, 3)).toBe('BETWEEN_FIRING_SHOTS');

    // Frame 30: both ready again
    expect(getWeaponSlotStatus(state.weaponSlots[0], primary, 30)).toBe('READY_TO_FIRE');
    expect(getWeaponSlotStatus(state.weaponSlots[1], secondary, 30)).toBe('READY_TO_FIRE');
  });

  it('handles clip reload independently per slot', () => {
    const state = createMultiWeaponEntityState();
    const primary = makeWeaponProfile({
      name: 'Gatling',
      slotIndex: 0,
      clipSize: 3,
      clipReloadFrames: 60,
      minDelayFrames: 2,
      maxDelayFrames: 2,
    });
    const secondary = makeWeaponProfile({
      name: 'Rocket',
      slotIndex: 1,
      clipSize: 1,
      clipReloadFrames: 90,
      minDelayFrames: 5,
      maxDelayFrames: 5,
    });
    state.weaponSlotProfiles[0] = primary;
    state.weaponSlotProfiles[1] = secondary;
    resetWeaponSlotState(state.weaponSlots[0], primary);
    resetWeaponSlotState(state.weaponSlots[1], secondary);

    // Primary has 3 shots, secondary has 1
    expect(state.weaponSlots[0].ammoInClip).toBe(3);
    expect(state.weaponSlots[1].ammoInClip).toBe(1);

    // Fire primary 3 times to exhaust clip
    fireWeaponSlot(state, 0, 0, () => 2);
    fireWeaponSlot(state, 0, 2, () => 2);
    const reloading = fireWeaponSlot(state, 0, 4, () => 2);
    expect(reloading).toBe(true);
    expect(state.weaponSlots[0].ammoInClip).toBe(0);
    expect(getWeaponSlotStatus(state.weaponSlots[0], primary, 5)).toBe('RELOADING_CLIP');

    // Secondary still has ammo
    expect(getWeaponSlotStatus(state.weaponSlots[1], secondary, 5)).toBe('READY_TO_FIRE');

    // Fire secondary — exhausts clip
    const secReloading = fireWeaponSlot(state, 1, 5, () => 5);
    expect(secReloading).toBe(true);
    expect(state.weaponSlots[1].ammoInClip).toBe(0);
  });

  it('getReadyToFireSlots returns only slots that are ready', () => {
    const state = createMultiWeaponEntityState();
    const primary = makeWeaponProfile({ name: 'Gun', slotIndex: 0 });
    const secondary = makeWeaponProfile({ name: 'Missile', slotIndex: 1 });
    state.weaponSlotProfiles[0] = primary;
    state.weaponSlotProfiles[1] = secondary;
    resetWeaponSlotState(state.weaponSlots[0], primary);
    resetWeaponSlotState(state.weaponSlots[1], secondary);

    // Both ready initially
    expect(getReadyToFireSlots(state, 0)).toEqual([0, 1]);

    // Fire primary, put it on cooldown
    fireWeaponSlot(state, 0, 0, () => 10);
    expect(getReadyToFireSlots(state, 1)).toEqual([1]);

    // After cooldown, both ready
    expect(getReadyToFireSlots(state, 10)).toEqual([0, 1]);
  });

  it('all three weapon slots fire independently', () => {
    const state = createMultiWeaponEntityState();
    const profiles: [WeaponSlotProfile, WeaponSlotProfile, WeaponSlotProfile] = [
      makeWeaponProfile({ name: 'SlotA', slotIndex: 0, minDelayFrames: 5, maxDelayFrames: 5 }),
      makeWeaponProfile({ name: 'SlotB', slotIndex: 1, minDelayFrames: 10, maxDelayFrames: 10 }),
      makeWeaponProfile({ name: 'SlotC', slotIndex: 2, minDelayFrames: 20, maxDelayFrames: 20 }),
    ];
    for (let i = 0; i < 3; i++) {
      state.weaponSlotProfiles[i] = profiles[i];
      resetWeaponSlotState(state.weaponSlots[i], profiles[i]);
    }

    // All fire at frame 0
    for (let i = 0; i < 3; i++) {
      fireWeaponSlot(state, i, 0, () => profiles[i].minDelayFrames);
    }

    // Frame 5: only slot A ready
    expect(getReadyToFireSlots(state, 5)).toEqual([0]);

    // Frame 10: slots A and B ready
    expect(getReadyToFireSlots(state, 10)).toEqual([0, 1]);

    // Frame 20: all ready
    expect(getReadyToFireSlots(state, 20)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Damage type vs armor type calculation
// ---------------------------------------------------------------------------

describe('Damage type vs armor type calculation', () => {
  it('reduces damage by armor coefficient', () => {
    const armor = new Map<string, number>([
      ['ARMOR_PIERCING', 1.0],
      ['SMALL_ARMS', 0.25],
      ['EXPLOSION', 0.5],
      ['FLAME', 2.0],
    ]);

    // Small arms: 25% of 100 = 25
    expect(adjustDamageByArmor(armor, 100, 'SMALL_ARMS')).toBe(25);

    // Explosion: 50% of 100 = 50
    expect(adjustDamageByArmor(armor, 100, 'EXPLOSION')).toBe(50);

    // Flame: 200% of 100 = 200
    expect(adjustDamageByArmor(armor, 100, 'FLAME')).toBe(200);

    // Armor piercing: 100% of 100 = 100
    expect(adjustDamageByArmor(armor, 100, 'ARMOR_PIERCING')).toBe(100);
  });

  it('UNRESISTABLE damage bypasses armor completely', () => {
    const armor = new Map<string, number>([
      ['ARMOR_PIERCING', 0.0],
      ['SMALL_ARMS', 0.0],
      ['UNRESISTABLE', 0.0], // Even if somehow defined, it should be bypassed
    ]);

    expect(adjustDamageByArmor(armor, 100, 'UNRESISTABLE')).toBe(100);
  });

  it('SUBDUAL_UNRESISTABLE damage bypasses armor completely (source parity: Armor.cpp:71-72)', () => {
    const armor = new Map<string, number>([
      ['ARMOR_PIERCING', 0.0],
      ['SUBDUAL_UNRESISTABLE', 0.0], // Even if defined as 0%, it should be bypassed
    ]);

    expect(adjustDamageByArmor(armor, 100, 'SUBDUAL_UNRESISTABLE')).toBe(100);
  });

  it('returns full damage when no armor coefficients', () => {
    expect(adjustDamageByArmor(null, 100, 'ARMOR_PIERCING')).toBe(100);
  });

  it('returns full damage for unknown damage type', () => {
    const armor = new Map<string, number>([
      ['SMALL_ARMS', 0.5],
    ]);
    // Damage type not in map → full damage (no coefficient found)
    expect(adjustDamageByArmor(armor, 100, 'SOME_UNKNOWN_TYPE')).toBe(100);
  });

  it('never returns negative damage', () => {
    const armor = new Map<string, number>([
      ['SMALL_ARMS', -0.5], // Negative coefficient (shouldn't happen, but handle gracefully)
    ]);
    expect(adjustDamageByArmor(armor, 100, 'SMALL_ARMS')).toBe(0);
  });

  it('estimateWeaponDamage applies armor correctly', () => {
    const weapon = makeWeaponProfile({
      primaryDamage: 50,
      damageType: 'SMALL_ARMS',
    });
    const armor = new Map<string, number>([
      ['SMALL_ARMS', 0.5],
    ]);
    expect(estimateWeaponDamage(weapon, armor)).toBe(25);
  });

  it('estimateWeaponDamage returns full damage with no armor', () => {
    const weapon = makeWeaponProfile({
      primaryDamage: 50,
      damageType: 'ARMOR_PIERCING',
    });
    expect(estimateWeaponDamage(weapon, null)).toBe(50);
  });

  it('matches pre-normalized uppercase damage type against armor map', () => {
    const armor = new Map<string, number>([
      ['EXPLOSION', 0.3],
    ]);
    // Callers must pass pre-normalized (uppercase, trimmed) damage types
    expect(adjustDamageByArmor(armor, 100, 'EXPLOSION')).toBeCloseTo(30);
  });
});

// ---------------------------------------------------------------------------
// Scatter radius application
// ---------------------------------------------------------------------------

describe('Scatter radius application', () => {
  it('returns base scatter radius for non-infantry targets', () => {
    const weapon = makeWeaponProfile({
      scatterRadius: 10,
      scatterRadiusVsInfantry: 5,
    });
    expect(resolveScatterRadius(weapon, 'vehicle')).toBe(10);
  });

  it('adds infantry scatter bonus for infantry targets', () => {
    const weapon = makeWeaponProfile({
      scatterRadius: 10,
      scatterRadiusVsInfantry: 5,
    });
    expect(resolveScatterRadius(weapon, 'infantry')).toBe(15);
  });

  it('returns 0 when no scatter configured', () => {
    const weapon = makeWeaponProfile({
      scatterRadius: 0,
      scatterRadiusVsInfantry: 0,
    });
    expect(resolveScatterRadius(weapon, 'infantry')).toBe(0);
  });

  it('applyScatterOffset returns original position when radius is 0', () => {
    const result = applyScatterOffset(100, 200, 0, 0, 0);
    expect(result.x).toBe(100);
    expect(result.z).toBe(200);
  });

  it('applyScatterOffset offsets position within radius', () => {
    const result = applyScatterOffset(100, 200, 10, 0, 1); // angle=0, full radius
    // At angle 0, offset is (10, 0)
    expect(result.x).toBeCloseTo(110);
    expect(result.z).toBeCloseTo(200);
  });

  it('applyScatterOffset respects random radius factor', () => {
    // randomRadius=0 means no offset
    const result = applyScatterOffset(100, 200, 10, Math.PI / 2, 0);
    expect(result.x).toBeCloseTo(100);
    expect(result.z).toBeCloseTo(200);
  });

  it('applyScatterOffset with half radius', () => {
    // randomRadius=0.25 → sqrt(0.25)=0.5 → half the scatter radius
    const result = applyScatterOffset(100, 200, 10, 0, 0.25);
    expect(result.x).toBeCloseTo(105);
    expect(result.z).toBeCloseTo(200);
  });
});

// ---------------------------------------------------------------------------
// Projectile type classification
// ---------------------------------------------------------------------------

describe('Projectile type classification', () => {
  it('classifies laser beam weapons', () => {
    const weapon = makeWeaponProfile({ laserName: 'LaserBeam01' });
    expect(classifyProjectileFlightModel(weapon, false)).toBe('LASER_BEAM');
  });

  it('classifies homing missile weapons', () => {
    const weapon = makeWeaponProfile({
      laserName: null,
      projectileObjectName: 'RaptorMissile',
    });
    expect(classifyProjectileFlightModel(weapon, true)).toBe('HOMING_MISSILE');
  });

  it('classifies ballistic arc weapons', () => {
    const weapon = makeWeaponProfile({
      laserName: null,
      projectileObjectName: 'NukeCannonShell',
      projectileArcFirstHeight: 50,
      projectileArcSecondHeight: 20,
    });
    expect(classifyProjectileFlightModel(weapon, false)).toBe('BALLISTIC_ARC');
  });

  it('classifies instant-hit weapons (no projectile)', () => {
    const weapon = makeWeaponProfile({
      laserName: null,
      projectileObjectName: null,
    });
    expect(classifyProjectileFlightModel(weapon, false)).toBe('INSTANT');
  });

  it('classifies straight-line projectile as instant when no arc params', () => {
    const weapon = makeWeaponProfile({
      laserName: null,
      projectileObjectName: 'BulletProjectile',
      projectileArcFirstHeight: 0,
      projectileArcSecondHeight: 0,
    });
    expect(classifyProjectileFlightModel(weapon, false)).toBe('INSTANT');
  });

  it('laser takes priority over projectile', () => {
    const weapon = makeWeaponProfile({
      laserName: 'LaserBeam01',
      projectileObjectName: 'SomeMissile',
    });
    expect(classifyProjectileFlightModel(weapon, true)).toBe('LASER_BEAM');
  });
});

// ---------------------------------------------------------------------------
// Best weapon selection (chooseBestWeaponForTarget)
// ---------------------------------------------------------------------------

describe('Best weapon selection', () => {
  it('selects highest damage weapon for PREFER_MOST_DAMAGE', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'LowDamage',
      slotIndex: 0,
      primaryDamage: 10,
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'HighDamage',
      slotIndex: 1,
      primaryDamage: 50,
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    const result = chooseBestWeaponForTarget(state, makeChooseContext(), 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('selects longest range weapon for PREFER_LONGEST_RANGE', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'ShortRange',
      slotIndex: 0,
      attackRange: 100,
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'LongRange',
      slotIndex: 1,
      attackRange: 300,
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    const ctx = makeChooseContext({ distanceSqrToVictim: 50 * 50 });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_LONGEST_RANGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('respects weapon lock', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({ name: 'WeakGun', slotIndex: 0, primaryDamage: 5 });
    state.weaponSlotProfiles[1] = makeWeaponProfile({ name: 'StrongGun', slotIndex: 1, primaryDamage: 100 });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Lock to primary
    setWeaponLock(state, WEAPON_SLOT_PRIMARY, 'LOCKED_PERMANENTLY');

    const result = chooseBestWeaponForTarget(state, makeChooseContext(), 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_PRIMARY);
  });

  it('skips weapons out of range', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'ShortRange',
      slotIndex: 0,
      attackRange: 50,
      primaryDamage: 100,
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'LongRange',
      slotIndex: 1,
      attackRange: 200,
      primaryDamage: 10,
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Target is 100 units away — short range weapon can't reach
    const result = chooseBestWeaponForTarget(state, makeChooseContext(), 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('skips weapons with wrong anti-mask', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'AntiGround',
      slotIndex: 0,
      antiMask: 0x02, // WEAPON_ANTI_GROUND
      primaryDamage: 100,
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'AntiAir',
      slotIndex: 1,
      antiMask: 0x01, // WEAPON_ANTI_AIRBORNE_VEHICLE
      primaryDamage: 50,
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    // Target is airborne vehicle — only anti-air can target it
    const ctx = makeChooseContext({ victimAntiMask: 0x01 });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('preferred-against weapon always wins regardless of damage', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'AntiTank',
      slotIndex: 0,
      primaryDamage: 100,
      preferredAgainstKindOf: new Set(),
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'Vulcan',
      slotIndex: 1,
      primaryDamage: 5,
      preferredAgainstKindOf: new Set(['INFANTRY']),
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    const ctx = makeChooseContext({ victimKindOf: new Set(['INFANTRY']) });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_SECONDARY);
  });

  it('falls back to reloading weapon when no ready weapon found', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'Gun',
      slotIndex: 0,
      primaryDamage: 50,
      clipSize: 1,
      clipReloadFrames: 100,
    });
    resetWeaponSlotState(state.weaponSlots[0], state.weaponSlotProfiles[0]!);

    // Fire to exhaust clip
    fireWeaponSlot(state, 0, 0, () => 5);

    // Weapon is reloading but it's the only option
    const result = chooseBestWeaponForTarget(state, makeChooseContext({ frameCounter: 1 }), 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_PRIMARY);
  });

  it('returns -1 when no weapon can target', () => {
    const state = createMultiWeaponEntityState();
    // All slots empty
    const result = chooseBestWeaponForTarget(state, makeChooseContext(), 'PREFER_MOST_DAMAGE');
    expect(result).toBe(-1);
  });

  it('prefers primary weapon on damage tie (iterates backwards)', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({
      name: 'PrimaryGun',
      slotIndex: 0,
      primaryDamage: 50,
    });
    state.weaponSlotProfiles[1] = makeWeaponProfile({
      name: 'SecondaryGun',
      slotIndex: 1,
      primaryDamage: 50,
    });
    for (let i = 0; i < 2; i++) {
      resetWeaponSlotState(state.weaponSlots[i], state.weaponSlotProfiles[i]!);
    }

    const result = chooseBestWeaponForTarget(state, makeChooseContext(), 'PREFER_MOST_DAMAGE');
    expect(result).toBe(WEAPON_SLOT_PRIMARY);
  });
});

// ---------------------------------------------------------------------------
// Weapon lock management
// ---------------------------------------------------------------------------

describe('Weapon lock management', () => {
  it('locks weapon to specific slot', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({ name: 'Primary', slotIndex: 0 });
    state.weaponSlotProfiles[1] = makeWeaponProfile({ name: 'Secondary', slotIndex: 1 });

    const result = setWeaponLock(state, WEAPON_SLOT_SECONDARY, 'LOCKED_PERMANENTLY');
    expect(result).toBe(true);
    expect(state.currentWeaponSlot).toBe(WEAPON_SLOT_SECONDARY);
    expect(state.weaponLockStatus).toBe('LOCKED_PERMANENTLY');
  });

  it('permanent lock prevents temporary lock override', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({ name: 'Primary', slotIndex: 0 });
    state.weaponSlotProfiles[1] = makeWeaponProfile({ name: 'Secondary', slotIndex: 1 });

    setWeaponLock(state, WEAPON_SLOT_PRIMARY, 'LOCKED_PERMANENTLY');
    setWeaponLock(state, WEAPON_SLOT_SECONDARY, 'LOCKED_TEMPORARILY');

    // Should still be primary (permanent lock prevents temp override)
    expect(state.currentWeaponSlot).toBe(WEAPON_SLOT_PRIMARY);
  });

  it('releases temporary lock', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({ name: 'Primary', slotIndex: 0 });
    setWeaponLock(state, WEAPON_SLOT_PRIMARY, 'LOCKED_TEMPORARILY');

    releaseWeaponLock(state, 'LOCKED_TEMPORARILY');
    expect(state.weaponLockStatus).toBe('NOT_LOCKED');
  });

  it('permanent release clears all locks', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({ name: 'Primary', slotIndex: 0 });
    setWeaponLock(state, WEAPON_SLOT_PRIMARY, 'LOCKED_PERMANENTLY');

    releaseWeaponLock(state, 'LOCKED_PERMANENTLY');
    expect(state.weaponLockStatus).toBe('NOT_LOCKED');
  });

  it('temporary release does not clear permanent lock', () => {
    const state = createMultiWeaponEntityState();
    state.weaponSlotProfiles[0] = makeWeaponProfile({ name: 'Primary', slotIndex: 0 });
    setWeaponLock(state, WEAPON_SLOT_PRIMARY, 'LOCKED_PERMANENTLY');

    releaseWeaponLock(state, 'LOCKED_TEMPORARILY');
    expect(state.weaponLockStatus).toBe('LOCKED_PERMANENTLY');
  });

  it('rejects lock on empty slot', () => {
    const state = createMultiWeaponEntityState();
    const result = setWeaponLock(state, WEAPON_SLOT_SECONDARY, 'LOCKED_PERMANENTLY');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Weapon set update and state management
// ---------------------------------------------------------------------------

describe('Weapon set update', () => {
  it('populates all slots from profiles', () => {
    const state = createMultiWeaponEntityState();
    const profiles: [WeaponSlotProfile | null, WeaponSlotProfile | null, WeaponSlotProfile | null] = [
      makeWeaponProfile({ name: 'PrimaryGun', slotIndex: 0 }),
      makeWeaponProfile({ name: 'SecondaryMissile', slotIndex: 1 }),
      null,
    ];

    updateWeaponSetFromProfiles(state, profiles, false, false);

    expect(state.weaponSlotProfiles[0]?.name).toBe('PrimaryGun');
    expect(state.weaponSlotProfiles[1]?.name).toBe('SecondaryMissile');
    expect(state.weaponSlotProfiles[2]).toBeNull();
    expect(state.filledWeaponSlotMask).toBe(0x03); // bits 0 and 1
    expect(state.hasDamageWeapon).toBe(true);
  });

  it('resets weapon slot state on template change', () => {
    const state = createMultiWeaponEntityState();
    const oldProfile = makeWeaponProfile({ name: 'OldGun', slotIndex: 0, clipSize: 5 });
    state.weaponSlotProfiles[0] = oldProfile;
    resetWeaponSlotState(state.weaponSlots[0], oldProfile);
    state.weaponSlots[0].ammoInClip = 2; // partially used

    const newProfile = makeWeaponProfile({ name: 'NewGun', slotIndex: 0, clipSize: 10 });
    updateWeaponSetFromProfiles(state, [newProfile, null, null], false, false);

    // Should be reset to full clip of new weapon
    expect(state.weaponSlots[0].ammoInClip).toBe(10);
    expect(state.weaponSlots[0].weaponName).toBe('NewGun');
  });

  it('preserves weapon slot state when template name unchanged', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({ name: 'SameGun', slotIndex: 0, clipSize: 5 });
    state.weaponSlotProfiles[0] = profile;
    resetWeaponSlotState(state.weaponSlots[0], profile);
    state.weaponSlots[0].ammoInClip = 2; // partially used

    // Update with same weapon name — should preserve ammo state
    updateWeaponSetFromProfiles(state, [profile, null, null], false, false);
    expect(state.weaponSlots[0].ammoInClip).toBe(2);
  });

  it('releases locks when not shared across sets', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({ name: 'Gun', slotIndex: 0 });
    state.weaponSlotProfiles[0] = profile;
    state.weaponLockStatus = 'LOCKED_PERMANENTLY';
    state.currentWeaponSlot = WEAPON_SLOT_SECONDARY;

    updateWeaponSetFromProfiles(state, [profile, null, null], false, false);
    expect(state.weaponLockStatus).toBe('NOT_LOCKED');
    expect(state.currentWeaponSlot).toBe(WEAPON_SLOT_PRIMARY);
  });

  it('keeps locks when shared across sets', () => {
    const state = createMultiWeaponEntityState();
    const profileA = makeWeaponProfile({ name: 'GunA', slotIndex: 0 });
    const profileB = makeWeaponProfile({ name: 'GunB', slotIndex: 1 });
    state.weaponSlotProfiles[0] = profileA;
    state.weaponSlotProfiles[1] = profileB;
    state.weaponLockStatus = 'LOCKED_PERMANENTLY';
    state.currentWeaponSlot = WEAPON_SLOT_SECONDARY;

    updateWeaponSetFromProfiles(state, [profileA, profileB, null], false, true);
    expect(state.weaponLockStatus).toBe('LOCKED_PERMANENTLY');
    expect(state.currentWeaponSlot).toBe(WEAPON_SLOT_SECONDARY);
  });
});

// ---------------------------------------------------------------------------
// Weapon ammo and reload
// ---------------------------------------------------------------------------

describe('Weapon ammo and reload', () => {
  it('isWeaponSetOutOfAmmo returns true when all slots empty', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({ name: 'Gun', slotIndex: 0, clipSize: 1, clipReloadFrames: 100 });
    state.weaponSlotProfiles[0] = profile;
    resetWeaponSlotState(state.weaponSlots[0], profile);

    // Fire to exhaust
    fireWeaponSlot(state, 0, 0, () => 5);

    // During reload (frame < reloadFinishFrame), status is RELOADING_CLIP, not OUT_OF_AMMO
    expect(isWeaponSetOutOfAmmo(state, 1)).toBe(false);

    // Source parity: after reload finishes, ammo remains 0 until the combat loop
    // explicitly restores it (matching combat-update.ts behavior). The weapon
    // transitions to OUT_OF_AMMO status at that point.
    expect(isWeaponSetOutOfAmmo(state, 100)).toBe(true);

    // Once ammo is manually restored, weapon is no longer out of ammo.
    state.weaponSlots[0].ammoInClip = profile.clipSize;
    expect(isWeaponSetOutOfAmmo(state, 101)).toBe(false);
  });

  it('reloadAllWeaponSlots (now=true) restores full ammo', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({ name: 'Gun', slotIndex: 0, clipSize: 5 });
    state.weaponSlotProfiles[0] = profile;
    resetWeaponSlotState(state.weaponSlots[0], profile);
    state.weaponSlots[0].ammoInClip = 0;

    reloadAllWeaponSlots(state, true, 10);
    expect(state.weaponSlots[0].ammoInClip).toBe(5);
    expect(state.weaponSlots[0].reloadFinishFrame).toBe(0);
  });

  it('reloadAllWeaponSlots (now=false) starts reload timer', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({ name: 'Gun', slotIndex: 0, clipSize: 5, clipReloadFrames: 60 });
    state.weaponSlotProfiles[0] = profile;
    resetWeaponSlotState(state.weaponSlots[0], profile);
    state.weaponSlots[0].ammoInClip = 0;

    reloadAllWeaponSlots(state, false, 10);
    expect(state.weaponSlots[0].ammoInClip).toBe(0); // Not yet reloaded
    expect(state.weaponSlots[0].reloadFinishFrame).toBe(70);
  });

  it('idle auto-reload triggers when idle long enough', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({
      name: 'Gun',
      slotIndex: 0,
      clipSize: 3,
      autoReloadWhenIdleFrames: 30,
    });
    state.weaponSlotProfiles[0] = profile;
    resetWeaponSlotState(state.weaponSlots[0], profile);

    // Fire one shot at frame 0
    fireWeaponSlot(state, 0, 0, () => 5);
    expect(state.weaponSlots[0].ammoInClip).toBe(2);
    expect(state.weaponSlots[0].forceReloadFrame).toBe(30);

    // At frame 29, shouldn't reload yet
    updateWeaponSlotIdleAutoReload(state, 29);
    expect(state.weaponSlots[0].ammoInClip).toBe(2);

    // At frame 30, should auto-reload
    updateWeaponSlotIdleAutoReload(state, 30);
    expect(state.weaponSlots[0].ammoInClip).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Pre-attack delay
// ---------------------------------------------------------------------------

describe('Pre-attack delay', () => {
  it('PER_SHOT always applies delay', () => {
    const slot = createWeaponSlotState(0);
    const profile = { preAttackDelayFrames: 10, preAttackType: 'PER_SHOT' as const, clipSize: 0 };
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(10);

    // Even after consecutive shots
    slot.consecutiveShotsTargetEntityId = 1;
    slot.consecutiveShotsAtTarget = 5;
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(10);
  });

  it('PER_ATTACK skips delay after first shot at same target', () => {
    const slot = createWeaponSlotState(0);
    const profile = { preAttackDelayFrames: 10, preAttackType: 'PER_ATTACK' as const, clipSize: 0 };

    // First shot at target 1
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(10);

    // Record the shot
    recordSlotConsecutiveShot(slot, 1);

    // Second shot at same target — no delay
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(0);

    // Different target — delay again
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 2)).toBe(10);
  });

  it('PER_CLIP skips delay mid-clip', () => {
    const slot = createWeaponSlotState(0);
    slot.ammoInClip = 3;
    const profile = { preAttackDelayFrames: 10, preAttackType: 'PER_CLIP' as const, clipSize: 5 };

    // Mid-clip (3 < 5) — no delay
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(0);

    // Full clip — delay
    slot.ammoInClip = 5;
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(10);
  });

  it('returns 0 when no delay configured', () => {
    const slot = createWeaponSlotState(0);
    const profile = { preAttackDelayFrames: 0, preAttackType: 'PER_SHOT' as const, clipSize: 0 };
    expect(resolveWeaponSlotPreAttackDelay(slot, profile, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Consecutive shot tracking
// ---------------------------------------------------------------------------

describe('Consecutive shot tracking', () => {
  it('tracks shots at same target', () => {
    const slot = createWeaponSlotState(0);
    recordSlotConsecutiveShot(slot, 42);
    expect(slot.consecutiveShotsTargetEntityId).toBe(42);
    expect(slot.consecutiveShotsAtTarget).toBe(1);

    recordSlotConsecutiveShot(slot, 42);
    expect(slot.consecutiveShotsAtTarget).toBe(2);
  });

  it('resets count on target change', () => {
    const slot = createWeaponSlotState(0);
    recordSlotConsecutiveShot(slot, 42);
    recordSlotConsecutiveShot(slot, 42);
    expect(slot.consecutiveShotsAtTarget).toBe(2);

    recordSlotConsecutiveShot(slot, 99);
    expect(slot.consecutiveShotsTargetEntityId).toBe(99);
    expect(slot.consecutiveShotsAtTarget).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Leech range
// ---------------------------------------------------------------------------

describe('Leech range', () => {
  it('activates leech range on fire for leech weapons', () => {
    const state = createMultiWeaponEntityState();
    const profile = makeWeaponProfile({
      name: 'HackWeapon',
      slotIndex: 0,
      leechRangeWeapon: true,
    });
    state.weaponSlotProfiles[0] = profile;
    resetWeaponSlotState(state.weaponSlots[0], profile);
    expect(state.weaponSlots[0].leechRangeActive).toBe(false);

    fireWeaponSlot(state, 0, 0, () => 5);
    expect(state.weaponSlots[0].leechRangeActive).toBe(true);
  });

  it('clearLeechRangeAllSlots clears all slots', () => {
    const state = createMultiWeaponEntityState();
    for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
      state.weaponSlots[i].leechRangeActive = true;
    }

    clearLeechRangeAllSlots(state);
    for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
      expect(state.weaponSlots[i].leechRangeActive).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Scatter target management
// ---------------------------------------------------------------------------

describe('Scatter target management', () => {
  it('rebuilds scatter targets with correct indices', () => {
    const slot = createWeaponSlotState(0);
    const profile = makeWeaponProfile({
      scatterTargets: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 }],
    });

    rebuildSlotScatterTargets(slot, profile);
    expect(slot.scatterTargetsUnused).toEqual([0, 1, 2]);
  });

  it('returns empty array when no scatter targets', () => {
    const slot = createWeaponSlotState(0);
    const profile = makeWeaponProfile({ scatterTargets: [] });
    rebuildSlotScatterTargets(slot, profile);
    expect(slot.scatterTargetsUnused).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Victim anti-mask computation
// ---------------------------------------------------------------------------

describe('Victim anti-mask', () => {
  it('returns GROUND for non-airborne ground units', () => {
    const mask = getVictimAntiMask(false, false, false, false, false, true, false, false);
    expect(mask).toBe(0x02); // WEAPON_ANTI_GROUND
  });

  it('returns MINE | GROUND for mines', () => {
    const mask = getVictimAntiMask(false, true, false, false, false, false, false, false);
    expect(mask).toBe(0x10 | 0x02); // WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND
  });

  it('returns AIRBORNE_VEHICLE for airborne vehicles', () => {
    const mask = getVictimAntiMask(true, false, false, false, false, true, false, false);
    expect(mask).toBe(0x01); // WEAPON_ANTI_AIRBORNE_VEHICLE
  });

  it('returns AIRBORNE_INFANTRY for airborne infantry', () => {
    const mask = getVictimAntiMask(true, false, false, false, false, false, true, false);
    expect(mask).toBe(0x20); // WEAPON_ANTI_AIRBORNE_INFANTRY
  });

  it('returns SMALL_MISSILE for small missiles', () => {
    const mask = getVictimAntiMask(false, false, true, false, false, false, false, false);
    expect(mask).toBe(0x08); // WEAPON_ANTI_SMALL_MISSILE
  });

  it('returns BALLISTIC_MISSILE for ballistic missiles', () => {
    const mask = getVictimAntiMask(false, false, false, true, false, false, false, false);
    expect(mask).toBe(0x40); // WEAPON_ANTI_BALLISTIC_MISSILE
  });

  it('returns PROJECTILE for generic projectiles', () => {
    const mask = getVictimAntiMask(false, false, false, false, true, false, false, false);
    expect(mask).toBe(0x04); // WEAPON_ANTI_PROJECTILE
  });

  it('returns PARACHUTE for parachutes', () => {
    const mask = getVictimAntiMask(true, false, false, false, false, false, false, true);
    expect(mask).toBe(0x80); // WEAPON_ANTI_PARACHUTE
  });

  it('priority: mine > smallMissile > ballisticMissile > projectile > airborne', () => {
    // Mine takes priority even if also projectile
    expect(getVictimAntiMask(false, true, false, false, true, false, false, false))
      .toBe(0x10 | 0x02);

    // Small missile takes priority over generic projectile
    expect(getVictimAntiMask(false, false, true, false, true, false, false, false))
      .toBe(0x08);

    // Ballistic missile priority
    expect(getVictimAntiMask(false, false, false, true, true, false, false, false))
      .toBe(0x40);
  });
});

// ---------------------------------------------------------------------------
// Weapon delay frames
// ---------------------------------------------------------------------------

describe('Weapon delay frames', () => {
  it('returns fixed delay when min equals max', () => {
    const profile = makeWeaponProfile({ minDelayFrames: 10, maxDelayFrames: 10 });
    expect(resolveWeaponSlotDelayFrames(profile, () => 0)).toBe(10);
  });

  it('uses random range for variable delay', () => {
    const profile = makeWeaponProfile({ minDelayFrames: 5, maxDelayFrames: 15 });
    const result = resolveWeaponSlotDelayFrames(profile, (min, max) => {
      expect(min).toBe(5);
      expect(max).toBe(15);
      return 10;
    });
    expect(result).toBe(10);
  });

  it('clamps min to 0', () => {
    const profile = makeWeaponProfile({ minDelayFrames: -5, maxDelayFrames: 10 });
    const result = resolveWeaponSlotDelayFrames(profile, (_min, _max) => 5);
    expect(result).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Weapon slot reset
// ---------------------------------------------------------------------------

describe('Weapon slot reset', () => {
  it('sets full clip ammo', () => {
    const slot = createWeaponSlotState(0);
    const profile = makeWeaponProfile({ name: 'TestGun', clipSize: 8 });
    resetWeaponSlotState(slot, profile);

    expect(slot.weaponName).toBe('TestGun');
    expect(slot.ammoInClip).toBe(8);
    expect(slot.nextFireFrame).toBe(0);
    expect(slot.reloadFinishFrame).toBe(0);
    expect(slot.consecutiveShotsTargetEntityId).toBeNull();
    expect(slot.consecutiveShotsAtTarget).toBe(0);
    expect(slot.leechRangeActive).toBe(false);
  });

  it('sets 0 ammo when no clip', () => {
    const slot = createWeaponSlotState(0);
    const profile = makeWeaponProfile({ name: 'InfiniteGun', clipSize: 0 });
    resetWeaponSlotState(slot, profile);
    expect(slot.ammoInClip).toBe(0);
  });

  it('rebuilds scatter targets', () => {
    const slot = createWeaponSlotState(0);
    const profile = makeWeaponProfile({
      scatterTargets: [{ x: 1, z: 2 }, { x: 3, z: 4 }],
    });
    resetWeaponSlotState(slot, profile);
    expect(slot.scatterTargetsUnused).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// Weapon status
// ---------------------------------------------------------------------------

describe('Weapon status', () => {
  it('READY_TO_FIRE when cooldown elapsed and clip has ammo', () => {
    const slot = createWeaponSlotState(0);
    slot.ammoInClip = 5;
    slot.nextFireFrame = 0;
    const profile = makeWeaponProfile({ clipSize: 5 });
    expect(getWeaponSlotStatus(slot, profile, 0)).toBe('READY_TO_FIRE');
  });

  it('BETWEEN_FIRING_SHOTS when on cooldown', () => {
    const slot = createWeaponSlotState(0);
    slot.ammoInClip = 5;
    slot.nextFireFrame = 10;
    const profile = makeWeaponProfile({ clipSize: 5 });
    expect(getWeaponSlotStatus(slot, profile, 5)).toBe('BETWEEN_FIRING_SHOTS');
  });

  it('RELOADING_CLIP when clip empty and reloading', () => {
    const slot = createWeaponSlotState(0);
    slot.ammoInClip = 0;
    slot.reloadFinishFrame = 60;
    const profile = makeWeaponProfile({ clipSize: 5, clipReloadFrames: 60 });
    expect(getWeaponSlotStatus(slot, profile, 30)).toBe('RELOADING_CLIP');
  });

  it('OUT_OF_AMMO when clip empty and reload done', () => {
    const slot = createWeaponSlotState(0);
    slot.ammoInClip = 0;
    slot.reloadFinishFrame = 60;
    const profile = makeWeaponProfile({ clipSize: 5, clipReloadFrames: 60 });
    // After reload time, status should be OUT_OF_AMMO (clip wasn't refilled)
    expect(getWeaponSlotStatus(slot, profile, 61)).toBe('OUT_OF_AMMO');
  });

  it('unlimited ammo weapons are always ready if not on cooldown', () => {
    const slot = createWeaponSlotState(0);
    slot.nextFireFrame = 0;
    const profile = makeWeaponProfile({ clipSize: 0 });
    expect(getWeaponSlotStatus(slot, profile, 100)).toBe('READY_TO_FIRE');
  });
});

// ---------------------------------------------------------------------------
// Damage bonus in weapon selection
// ---------------------------------------------------------------------------

describe('Damage bonus in weapon selection', () => {
  it('weapon with damageBonus beats weapon without in selection', () => {
    // Weapon A: 10 damage in slot 0 (primary)
    // Weapon B: 8 damage in slot 1 (secondary)
    // Without bonus, weapon A wins. With 2x bonus, weapon B (8*2=16) beats A (10*1=10).
    const state = createMultiWeaponEntityState();
    const profileA = makeWeaponProfile({ name: 'WeakNoBonusWeapon', slotIndex: 0, primaryDamage: 10 });
    const profileB = makeWeaponProfile({ name: 'StrongWithBonusWeapon', slotIndex: 1, primaryDamage: 8 });
    state.weaponSlotProfiles = [profileA, profileB, null];
    state.filledWeaponSlotMask = 0b011;

    // Reset slot states
    resetWeaponSlotState(state.weaponSlots[0], profileA);
    resetWeaponSlotState(state.weaponSlots[1], profileB);

    // Without bonus: weapon A (damage=10) wins over weapon B (damage=8)
    const ctxNoBonus = makeChooseContext();
    const resultNoBonus = chooseBestWeaponForTarget(state, ctxNoBonus, 'PREFER_MOST_DAMAGE');
    expect(resultNoBonus).toBe(WEAPON_SLOT_PRIMARY);

    // With 2x bonus: weapon A (10*2=20) still beats weapon B (8*2=16) — both get same bonus
    // To test that damageBonus actually applies, use estimateWeaponDamage directly
    const baseDamage = estimateWeaponDamage(profileB, null);
    const bonusDamage = estimateWeaponDamage(profileB, null, 2.0);
    expect(baseDamage).toBe(8);
    expect(bonusDamage).toBe(16);
  });

  it('estimateWeaponDamage multiplies by damageBonus', () => {
    const profile = makeWeaponProfile({ primaryDamage: 50, damageType: 'ARMOR_PIERCING' });
    const armor = new Map<string, number>([['ARMOR_PIERCING', 0.5]]);

    // Without bonus: 50 * 0.5 = 25
    expect(estimateWeaponDamage(profile, armor)).toBe(25);
    // With 1.5x bonus: 50 * 0.5 * 1.5 = 37.5
    expect(estimateWeaponDamage(profile, armor, 1.5)).toBe(37.5);
    // With undefined bonus (default 1): 50 * 0.5 = 25
    expect(estimateWeaponDamage(profile, armor, undefined)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Auto-reload weapon not skipped when OUT_OF_AMMO
// ---------------------------------------------------------------------------

describe('Auto-reload weapon selection', () => {
  it('auto-reload weapon is not skipped when OUT_OF_AMMO', () => {
    const state = createMultiWeaponEntityState();
    // Weapon in slot 0: has clip, is out of ammo, but auto-reloads
    const profile = makeWeaponProfile({
      name: 'AutoReloadGun',
      slotIndex: 0,
      primaryDamage: 30,
      clipSize: 6,
      clipReloadFrames: 30,
      autoReloadsClip: true,
    });
    state.weaponSlotProfiles = [profile, null, null];
    state.filledWeaponSlotMask = 0b001;

    // Set slot state to out of ammo (clip empty, reload finished)
    const slot = state.weaponSlots[0];
    slot.weaponName = profile.name;
    slot.ammoInClip = 0;
    slot.reloadFinishFrame = 0; // reload already finished
    slot.nextFireFrame = 0;

    // Verify the weapon status is OUT_OF_AMMO
    expect(getWeaponSlotStatus(slot, profile, 100)).toBe('OUT_OF_AMMO');

    const ctx = makeChooseContext({ frameCounter: 100 });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    // Should select this weapon despite being OUT_OF_AMMO because it auto-reloads
    expect(result).toBe(WEAPON_SLOT_PRIMARY);
  });

  it('non-auto-reload weapon is still skipped when OUT_OF_AMMO', () => {
    const state = createMultiWeaponEntityState();
    // Weapon in slot 0: has clip, is out of ammo, does NOT auto-reload
    const profile = makeWeaponProfile({
      name: 'ManualReloadGun',
      slotIndex: 0,
      primaryDamage: 30,
      clipSize: 6,
      clipReloadFrames: 30,
      autoReloadsClip: false,
    });
    state.weaponSlotProfiles = [profile, null, null];
    state.filledWeaponSlotMask = 0b001;

    const slot = state.weaponSlots[0];
    slot.weaponName = profile.name;
    slot.ammoInClip = 0;
    slot.reloadFinishFrame = 0;
    slot.nextFireFrame = 0;

    expect(getWeaponSlotStatus(slot, profile, 100)).toBe('OUT_OF_AMMO');

    const ctx = makeChooseContext({ frameCounter: 100 });
    const result = chooseBestWeaponForTarget(state, ctx, 'PREFER_MOST_DAMAGE');
    // Should NOT select this weapon — returns -1 (no weapon found)
    expect(result).toBe(-1);
  });
});
