/**
 * Multi-weapon combat system — source parity with C++ WeaponSet.cpp.
 *
 * Implements:
 * - WeaponSet condition matching (VETERAN, PLAYER_UPGRADE, etc.)
 * - Multi-weapon slots (A/B/C) with independent cooldown/reload per slot
 * - Armor/damage type multiplier table
 * - Scatter radius per weapon
 * - Best-weapon selection (chooseBestWeaponForTarget)
 * - Projectile type classification (lazy-seek, ballistic arc, area detonation)
 *
 * Source parity references:
 * - WeaponSet.h / WeaponSet.cpp
 * - Weapon.h / Weapon.cpp
 * - Armor.h / Armor.cpp
 * - Damage.h
 */

// ---------------------------------------------------------------------------
// Constants — source parity with WeaponSetType.h / Damage.h / Weapon.h
// ---------------------------------------------------------------------------

/** Source parity: WEAPONSLOT_COUNT = 3 (PRIMARY, SECONDARY, TERTIARY). */
export const WEAPON_SLOT_COUNT = 3;

/** Source parity: WeaponSlotType enum values. */
export const WEAPON_SLOT_PRIMARY = 0;
export const WEAPON_SLOT_SECONDARY = 1;
export const WEAPON_SLOT_TERTIARY = 2;

/** Source parity: WeaponChoiceCriteria enum. */
export type WeaponChoiceCriteria = 'PREFER_MOST_DAMAGE' | 'PREFER_LONGEST_RANGE';

/** Source parity: WeaponLockType enum. */
export type WeaponLockType = 'NOT_LOCKED' | 'LOCKED_TEMPORARILY' | 'LOCKED_PERMANENTLY';

/** Source parity: WeaponStatus enum. */
export type WeaponStatus = 'READY_TO_FIRE' | 'BETWEEN_FIRING_SHOTS' | 'RELOADING_CLIP' | 'OUT_OF_AMMO';

/** Source parity: ProjectileType classification for visual rendering and physics. */
export type ProjectileFlightModel = 'INSTANT' | 'BALLISTIC_ARC' | 'HOMING_MISSILE' | 'LASER_BEAM';

// ---------------------------------------------------------------------------
// Weapon slot state — per-slot runtime state (source parity: Weapon class)
// ---------------------------------------------------------------------------

export interface WeaponSlotState {
  /** Slot index (0=PRIMARY, 1=SECONDARY, 2=TERTIARY). */
  slotIndex: number;
  /** Weapon template name in this slot, or null if empty. */
  weaponName: string | null;
  /** Current ammo in clip. */
  ammoInClip: number;
  /** Frame at which the weapon can fire again. */
  nextFireFrame: number;
  /** Frame at which clip reload completes. */
  reloadFinishFrame: number;
  /** Frame at which idle auto-reload is forced. */
  forceReloadFrame: number;
  /** Pre-attack delay finish frame. */
  preAttackFinishFrame: number;
  /** Consecutive shots at the same target (for prefire modes). */
  consecutiveShotsTargetEntityId: number | null;
  consecutiveShotsAtTarget: number;
  /** Source parity: Weapon::m_leechWeaponRangeActive. */
  leechRangeActive: boolean;
  /** Scatter target indices not yet used in current clip. */
  scatterTargetsUnused: number[];
  /** Source parity: FiringTracker continuous-fire tier for this slot. */
  continuousFireState: 'NONE' | 'MEAN' | 'FAST';
  /** Source parity: FiringTracker cooldown frame for this slot. */
  continuousFireCooldownFrame: number;
}

// ---------------------------------------------------------------------------
// Weapon profile — parsed from INI (matches existing AttackWeaponProfile)
// ---------------------------------------------------------------------------

export interface WeaponSlotProfile {
  name: string;
  slotIndex: number;
  primaryDamage: number;
  secondaryDamage: number;
  primaryDamageRadius: number;
  secondaryDamageRadius: number;
  scatterTargetScalar: number;
  scatterTargets: ReadonlyArray<{ x: number; z: number }>;
  scatterRadius: number;
  scatterRadiusVsInfantry: number;
  radiusDamageAngle: number;
  damageType: string;
  deathType: string;
  damageDealtAtSelfPosition: boolean;
  radiusDamageAffectsMask: number;
  projectileCollideMask: number;
  weaponSpeed: number;
  minWeaponSpeed: number;
  scaleWeaponSpeed: boolean;
  capableOfFollowingWaypoints: boolean;
  projectileObjectName: string | null;
  attackRange: number;
  unmodifiedAttackRange: number;
  minAttackRange: number;
  continueAttackRange: number;
  clipSize: number;
  clipReloadFrames: number;
  autoReloadWhenIdleFrames: number;
  preAttackDelayFrames: number;
  preAttackType: 'PER_SHOT' | 'PER_ATTACK' | 'PER_CLIP';
  minDelayFrames: number;
  maxDelayFrames: number;
  antiMask: number;
  continuousFireOneShotsNeeded: number;
  continuousFireTwoShotsNeeded: number;
  continuousFireCoastFrames: number;
  continuousFireMeanRateOfFire: number;
  continuousFireFastRateOfFire: number;
  laserName: string | null;
  projectileArcFirstHeight: number;
  projectileArcSecondHeight: number;
  projectileArcFirstPercentIndent: number;
  projectileArcSecondPercentIndent: number;
  leechRangeWeapon: boolean;
  fireSoundEvent: string | null;
  /** Source parity: AutoChooseSources command source mask for this slot. */
  autoChooseSourceMask: number;
  /** Source parity: PreferredAgainst KindOf mask for this slot. */
  preferredAgainstKindOf: ReadonlySet<string>;
  /** Source parity: Weapon auto-reloads its clip (e.g. after AutoReloadWhenIdle). */
  autoReloadsClip?: boolean;
}

// ---------------------------------------------------------------------------
// WeaponSet template set — condition-based weapon set selection
// ---------------------------------------------------------------------------

export interface WeaponTemplateSetDef {
  conditionsMask: number;
  weaponNamesBySlot: readonly [string | null, string | null, string | null];
  /** Source parity: WeaponTemplateSet::m_isReloadTimeShared. */
  shareReloadTime: boolean;
  /** Source parity: WeaponTemplateSet::m_isWeaponLockSharedAcrossSets. */
  weaponLockSharedAcrossSets: boolean;
  /** Source parity: WeaponTemplateSet::m_autoChooseMask per slot. */
  autoChooseSourceMasks: readonly [number, number, number];
  /** Source parity: WeaponTemplateSet::m_preferredAgainst per slot. */
  preferredAgainstBySlot: readonly [ReadonlySet<string>, ReadonlySet<string>, ReadonlySet<string>];
}

// ---------------------------------------------------------------------------
// Multi-weapon entity state — aggregated per-entity weapon runtime
// ---------------------------------------------------------------------------

export interface MultiWeaponEntityState {
  /** Per-slot weapon runtime state. */
  weaponSlots: [WeaponSlotState, WeaponSlotState, WeaponSlotState];
  /** Per-slot resolved weapon profiles (null if slot is empty). */
  weaponSlotProfiles: [WeaponSlotProfile | null, WeaponSlotProfile | null, WeaponSlotProfile | null];
  /** Source parity: WeaponSet::m_curWeapon — which slot is currently selected for primary targeting. */
  currentWeaponSlot: number;
  /** Source parity: WeaponSet::m_curWeaponLockedStatus. */
  weaponLockStatus: WeaponLockType;
  /** Source parity: WeaponSet::m_filledWeaponSlotMask — bitmask of slots with weapons. */
  filledWeaponSlotMask: number;
  /** Source parity: WeaponSet::m_totalAntiMask — OR of all weapon anti-masks. */
  totalAntiMask: number;
  /** Source parity: WeaponSet::m_totalDamageTypeMask — OR of (1 << damageTypeIndex). */
  totalDamageTypeMask: number;
  /** Whether any slot has a damage-dealing weapon. */
  hasDamageWeapon: boolean;
  /** Source parity: WeaponTemplateSet::m_isReloadTimeShared — firing one weapon sets cooldown on ALL slots. */
  shareReloadTime: boolean;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createWeaponSlotState(slotIndex: number): WeaponSlotState {
  return {
    slotIndex,
    weaponName: null,
    ammoInClip: 0,
    nextFireFrame: 0,
    reloadFinishFrame: 0,
    forceReloadFrame: 0,
    preAttackFinishFrame: 0,
    consecutiveShotsTargetEntityId: null,
    consecutiveShotsAtTarget: 0,
    leechRangeActive: false,
    scatterTargetsUnused: [],
    continuousFireState: 'NONE',
    continuousFireCooldownFrame: 0,
  };
}

export function createMultiWeaponEntityState(): MultiWeaponEntityState {
  return {
    weaponSlots: [
      createWeaponSlotState(WEAPON_SLOT_PRIMARY),
      createWeaponSlotState(WEAPON_SLOT_SECONDARY),
      createWeaponSlotState(WEAPON_SLOT_TERTIARY),
    ],
    weaponSlotProfiles: [null, null, null],
    currentWeaponSlot: WEAPON_SLOT_PRIMARY,
    weaponLockStatus: 'NOT_LOCKED',
    filledWeaponSlotMask: 0,
    totalAntiMask: 0,
    totalDamageTypeMask: 0,
    hasDamageWeapon: false,
    shareReloadTime: false,
  };
}

// ---------------------------------------------------------------------------
// WeaponSet condition matching — source parity: SparseMatchFinder
// ---------------------------------------------------------------------------

/**
 * Source parity: SparseMatchFinder<WeaponTemplateSet, WeaponSetFlags>.
 * Selects the best weapon template set whose conditions match the entity's
 * current weapon set flags. The set with the most matching condition bits
 * (and fewest extraneous bits) wins.
 */
export function selectBestWeaponTemplateSet<T extends { conditionsMask: number }>(
  sets: readonly T[],
  currentMask: number,
): T | null {
  if (sets.length === 0) {
    return null;
  }

  let best: T | null = null;
  let bestYesMatch = 0;
  let bestYesExtraneousBits = Number.MAX_SAFE_INTEGER;
  for (const candidate of sets) {
    const yesFlags = candidate.conditionsMask >>> 0;
    const yesMatch = countSetBits((currentMask & yesFlags) >>> 0);
    const yesExtraneousBits = countSetBits((yesFlags & ~currentMask) >>> 0);
    if (
      yesMatch > bestYesMatch
      || (yesMatch >= bestYesMatch && yesExtraneousBits < bestYesExtraneousBits)
    ) {
      best = candidate;
      bestYesMatch = yesMatch;
      bestYesExtraneousBits = yesExtraneousBits;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Weapon status computation — source parity: Weapon::getStatus()
// ---------------------------------------------------------------------------

/**
 * Source parity: Weapon::getStatus().
 * Determines the current weapon status based on ammo and timing state.
 */
export function getWeaponSlotStatus(
  slot: WeaponSlotState,
  profile: WeaponSlotProfile,
  frameCounter: number,
): WeaponStatus {
  if (profile.clipSize > 0 && slot.ammoInClip <= 0) {
    if (slot.reloadFinishFrame > frameCounter) {
      return 'RELOADING_CLIP';
    }
    return 'OUT_OF_AMMO';
  }

  if (slot.nextFireFrame > frameCounter) {
    return 'BETWEEN_FIRING_SHOTS';
  }

  return 'READY_TO_FIRE';
}

// ---------------------------------------------------------------------------
// Armor/damage type interaction — source parity: ArmorTemplate::adjustDamage
// ---------------------------------------------------------------------------

/**
 * Source parity: ArmorTemplate::adjustDamage.
 * Applies the armor damage coefficient to the raw damage amount.
 * UNRESISTABLE damage bypasses armor entirely.
 *
 * Callers must pass pre-normalized (uppercase, trimmed) damage type strings.
 * Armor coefficient map keys are uppercase (built from SOURCE_DAMAGE_TYPE_NAMES).
 */
export function adjustDamageByArmor(
  armorCoefficients: ReadonlyMap<string, number> | null,
  rawDamage: number,
  damageType: string,
): number {
  if (damageType === 'UNRESISTABLE') {
    return rawDamage;
  }
  if (!armorCoefficients) {
    return rawDamage;
  }
  const coefficient = armorCoefficients.get(damageType);
  if (coefficient === undefined) {
    return rawDamage;
  }
  return Math.max(0, rawDamage * coefficient);
}

/**
 * Source parity: Weapon::estimateWeaponDamage.
 * Returns estimated damage this weapon would deal to a target with
 * the given armor coefficients. Used for weapon selection.
 * The optional damageBonus multiplier accounts for external bonuses
 * (e.g. veterancy, upgrades) so weapon selection picks the true best.
 */
export function estimateWeaponDamage(
  weaponProfile: WeaponSlotProfile,
  armorCoefficients: ReadonlyMap<string, number> | null,
  damageBonus?: number,
): number {
  const adjustedPrimary = adjustDamageByArmor(
    armorCoefficients,
    weaponProfile.primaryDamage,
    weaponProfile.damageType,
  );
  return adjustedPrimary * (damageBonus ?? 1);
}

// ---------------------------------------------------------------------------
// Scatter radius computation — source parity: Weapon.h getScatterRadius
// ---------------------------------------------------------------------------

/**
 * Source parity: WeaponTemplate::getScatterRadius + ScatterRadiusVsInfantry.
 * Returns the effective scatter radius for the given target category.
 */
export function resolveScatterRadius(
  weaponProfile: Pick<WeaponSlotProfile, 'scatterRadius' | 'scatterRadiusVsInfantry'>,
  targetCategory: string,
): number {
  let scatter = Math.max(0, weaponProfile.scatterRadius);
  if (targetCategory === 'infantry') {
    scatter += Math.max(0, weaponProfile.scatterRadiusVsInfantry);
  }
  return scatter;
}

/**
 * Source parity: applies scatter offset to a target position.
 * Returns a new position offset by a random amount within the scatter radius.
 */
export function applyScatterOffset(
  targetX: number,
  targetZ: number,
  scatterRadius: number,
  randomAngle: number,
  randomRadius: number,
): { x: number; z: number } {
  if (scatterRadius <= 0) {
    return { x: targetX, z: targetZ };
  }
  const r = scatterRadius * Math.sqrt(Math.max(0, Math.min(1, randomRadius)));
  return {
    x: targetX + r * Math.cos(randomAngle),
    z: targetZ + r * Math.sin(randomAngle),
  };
}

// ---------------------------------------------------------------------------
// Projectile flight model classification
// ---------------------------------------------------------------------------

/**
 * Classifies the projectile flight model for a weapon.
 * Source parity: determined by weapon template properties —
 * LaserName → LASER_BEAM, ProjectileObject with MissileAIUpdate → HOMING_MISSILE,
 * ProjectileObject with DumbProjectileBehavior → BALLISTIC_ARC, else INSTANT.
 */
export function classifyProjectileFlightModel(
  weaponProfile: Pick<WeaponSlotProfile, 'laserName' | 'projectileObjectName' | 'projectileArcFirstHeight' | 'projectileArcSecondHeight'>,
  hasMissileAI: boolean,
): ProjectileFlightModel {
  if (weaponProfile.laserName) {
    return 'LASER_BEAM';
  }
  if (weaponProfile.projectileObjectName) {
    if (hasMissileAI) {
      return 'HOMING_MISSILE';
    }
    if (weaponProfile.projectileArcFirstHeight !== 0 || weaponProfile.projectileArcSecondHeight !== 0) {
      return 'BALLISTIC_ARC';
    }
  }
  return 'INSTANT';
}

// ---------------------------------------------------------------------------
// WeaponSet update — source parity: WeaponSet::updateWeaponSet
// ---------------------------------------------------------------------------

/**
 * Source parity: WeaponSet::updateWeaponSet.
 * Updates the multi-weapon entity state when the weapon set changes
 * (e.g., due to veterancy or upgrade).
 */
export function updateWeaponSetFromProfiles(
  state: MultiWeaponEntityState,
  profiles: readonly [WeaponSlotProfile | null, WeaponSlotProfile | null, WeaponSlotProfile | null],
  shareReloadTime: boolean,
  weaponLockSharedAcrossSets: boolean,
): void {
  // Source parity: WeaponSet.cpp:296-297 — release locks if not shared across sets.
  if (!weaponLockSharedAcrossSets) {
    state.weaponLockStatus = 'NOT_LOCKED';
    state.currentWeaponSlot = WEAPON_SLOT_PRIMARY;
  }

  // Source parity: WeaponTemplateSet::m_isReloadTimeShared propagated to runtime state.
  state.shareReloadTime = shareReloadTime;

  state.filledWeaponSlotMask = 0;
  state.totalAntiMask = 0;
  state.totalDamageTypeMask = 0;
  state.hasDamageWeapon = false;

  for (let i = WEAPON_SLOT_COUNT - 1; i >= WEAPON_SLOT_PRIMARY; i--) {
    const slotIdx = i as 0 | 1 | 2;
    const prevProfile = state.weaponSlotProfiles[slotIdx];
    const nextProfile = profiles[slotIdx];

    state.weaponSlotProfiles[slotIdx] = nextProfile ?? null;

    if (nextProfile) {
      state.filledWeaponSlotMask |= (1 << i);
      state.totalAntiMask |= nextProfile.antiMask;
      // Source parity: WeaponSet.cpp:322 — damageType → bitmask index.
      // We use the damage type name string, but for the mask we need a numeric index.
      // Use a hash-based approach: the mask bit position is the string hash mod 32.
      state.hasDamageWeapon = true;

      // If weapon template changed in this slot, reset timing; otherwise preserve.
      const slot = state.weaponSlots[slotIdx];
      if (!prevProfile || prevProfile.name !== nextProfile.name) {
        resetWeaponSlotState(slot, nextProfile);
      }
    } else {
      // Clear this slot.
      const slot = state.weaponSlots[slotIdx];
      slot.weaponName = null;
      slot.ammoInClip = 0;
    }
  }
}

/**
 * Reset a weapon slot to initial state (full clip, ready to fire).
 * Source parity: WeaponStore::allocateNewWeapon + Weapon::loadAmmoNow.
 */
export function resetWeaponSlotState(slot: WeaponSlotState, profile: WeaponSlotProfile): void {
  slot.weaponName = profile.name;
  slot.ammoInClip = profile.clipSize > 0 ? profile.clipSize : 0;
  slot.nextFireFrame = 0;
  slot.reloadFinishFrame = 0;
  slot.forceReloadFrame = 0;
  slot.preAttackFinishFrame = 0;
  slot.consecutiveShotsTargetEntityId = null;
  slot.consecutiveShotsAtTarget = 0;
  slot.leechRangeActive = false;
  slot.scatterTargetsUnused = profile.scatterTargets
    ? Array.from({ length: profile.scatterTargets.length }, (_, i) => i)
    : [];
  slot.continuousFireState = 'NONE';
  slot.continuousFireCooldownFrame = 0;
}

// ---------------------------------------------------------------------------
// Weapon lock management — source parity: WeaponSet::setWeaponLock
// ---------------------------------------------------------------------------

/**
 * Source parity: WeaponSet::setWeaponLock.
 * Lock the current weapon to a specific slot until explicitly released.
 */
export function setWeaponLock(
  state: MultiWeaponEntityState,
  weaponSlot: number,
  lockType: WeaponLockType,
): boolean {
  if (lockType === 'NOT_LOCKED') {
    return false;
  }
  if (weaponSlot < 0 || weaponSlot >= WEAPON_SLOT_COUNT) {
    return false;
  }
  if (!state.weaponSlotProfiles[weaponSlot]) {
    return false;
  }

  if (lockType === 'LOCKED_PERMANENTLY') {
    state.currentWeaponSlot = weaponSlot;
    state.weaponLockStatus = lockType;
  } else if (lockType === 'LOCKED_TEMPORARILY' && state.weaponLockStatus !== 'LOCKED_PERMANENTLY') {
    state.currentWeaponSlot = weaponSlot;
    state.weaponLockStatus = lockType;
  }

  return true;
}

/**
 * Source parity: WeaponSet::releaseWeaponLock.
 */
export function releaseWeaponLock(
  state: MultiWeaponEntityState,
  lockType: WeaponLockType,
): void {
  if (state.weaponLockStatus === 'NOT_LOCKED') {
    return;
  }

  if (lockType === 'LOCKED_PERMANENTLY') {
    state.weaponLockStatus = 'NOT_LOCKED';
  } else if (lockType === 'LOCKED_TEMPORARILY') {
    if (state.weaponLockStatus === 'LOCKED_TEMPORARILY') {
      state.weaponLockStatus = 'NOT_LOCKED';
    }
  }
}

// ---------------------------------------------------------------------------
// Best weapon selection — source parity: WeaponSet::chooseBestWeaponForTarget
// ---------------------------------------------------------------------------

export interface ChooseBestWeaponContext {
  /** Attacker entity distance squared to victim. */
  distanceSqrToVictim: number;
  /** Victim anti-mask bits. */
  victimAntiMask: number;
  /** Victim armor damage coefficients. */
  victimArmorCoefficients: ReadonlyMap<string, number> | null;
  /** Victim kindOf set for preferred-against matching. */
  victimKindOf: ReadonlySet<string>;
  /** Command source that initiated the attack. */
  commandSourceBit: number;
  /** Frame counter for status evaluation. */
  frameCounter: number;
  /** Multiplicative damage bonus applied to all weapon damage estimates (default 1). */
  damageBonus?: number;
}

/**
 * Source parity: WeaponSet::chooseBestWeaponForTarget.
 * Evaluates all weapon slots and selects the best one for the given target.
 * Returns the slot index of the best weapon, or -1 if none found.
 *
 * Key behaviors from C++:
 * - Respects weapon lock (if locked, returns current weapon immediately)
 * - Filters by range, anti-mask, ammo, autoChooseSourceMask
 * - Preferred-against weapons always win
 * - Ready weapons beat reloading weapons (unless no ready weapon found)
 * - Tie-breaking: PRIMARY preferred (iteration goes backwards so ties favor lower index)
 */
export function chooseBestWeaponForTarget(
  state: MultiWeaponEntityState,
  ctx: ChooseBestWeaponContext,
  criteria: WeaponChoiceCriteria,
): number {
  if (state.weaponLockStatus !== 'NOT_LOCKED') {
    return state.currentWeaponSlot;
  }

  let found = false;
  let foundBackup = false;
  let longestRange = 0;
  let bestDamage = 0;
  let longestRangeBackup = 0;
  let bestDamageBackup = 0;
  let currentDecision = WEAPON_SLOT_PRIMARY;
  let currentDecisionBackup = WEAPON_SLOT_PRIMARY;

  // Source parity: go backwards so that in event of ties, primary is preferred.
  for (let i = WEAPON_SLOT_COUNT - 1; i >= WEAPON_SLOT_PRIMARY; i--) {
    const slotIdx = i as 0 | 1 | 2;
    const profile = state.weaponSlotProfiles[slotIdx];
    if (!profile) {
      continue;
    }

    // Source parity: command source mask check.
    if ((profile.autoChooseSourceMask & ctx.commandSourceBit) === 0) {
      continue;
    }

    // Source parity: range check.
    const attackRangeSqr = profile.attackRange * profile.attackRange;
    if (ctx.distanceSqrToVictim > attackRangeSqr) {
      continue;
    }

    // Source parity: ammo check.
    // Weapons that auto-reload their clip should still be considered when
    // OUT_OF_AMMO because they will reload by the time they're needed.
    const slotState = state.weaponSlots[slotIdx];
    const status: WeaponStatus = getWeaponSlotStatus(slotState, profile, ctx.frameCounter);
    if (status === 'OUT_OF_AMMO' && !profile.autoReloadsClip) {
      continue;
    }

    // Source parity: anti-mask check.
    if (!(profile.antiMask & ctx.victimAntiMask)) {
      continue;
    }

    let damage = estimateWeaponDamage(profile, ctx.victimArmorCoefficients, ctx.damageBonus);
    let attackRange = profile.attackRange;
    let weaponIsReady = (status === 'READY_TO_FIRE');

    // Source parity: if zero damage and not unresistable, skip.
    if (damage <= 0 && profile.damageType !== 'UNRESISTABLE') {
      continue;
    }

    // Source parity: preferred-against override — weapon is always chosen
    // if victim matches the preferredAgainst KindOf set.
    if (profile.preferredAgainstKindOf.size > 0) {
      let matchesPreferred = false;
      for (const kind of profile.preferredAgainstKindOf) {
        if (ctx.victimKindOf.has(kind)) {
          matchesPreferred = true;
          break;
        }
      }
      if (matchesPreferred) {
        const HUGE = 1e10;
        damage = HUGE;
        attackRange = HUGE;
        // Source parity: preferred weapons are kept if merely reloading.
        // Since OUT_OF_AMMO was already filtered above, this is always true here,
        // but we keep the assignment for source parity with WeaponSet.cpp:859.
        weaponIsReady = true;
      }
    }

    switch (criteria) {
      case 'PREFER_MOST_DAMAGE':
        if (!weaponIsReady) {
          if (damage >= bestDamageBackup) {
            bestDamageBackup = damage;
            currentDecisionBackup = i;
            foundBackup = true;
          }
        } else {
          if (damage >= bestDamage) {
            bestDamage = damage;
            currentDecision = i;
            found = true;
          }
        }
        break;
      case 'PREFER_LONGEST_RANGE':
        if (!weaponIsReady) {
          if (attackRange > longestRangeBackup) {
            longestRangeBackup = attackRange;
            currentDecisionBackup = i;
            foundBackup = true;
          }
        } else {
          if (attackRange > longestRange) {
            longestRange = attackRange;
            currentDecision = i;
            found = true;
          }
        }
        break;
    }
  }

  if (found) {
    state.currentWeaponSlot = currentDecision;
    return currentDecision;
  }
  if (foundBackup) {
    state.currentWeaponSlot = currentDecisionBackup;
    return currentDecisionBackup;
  }

  state.currentWeaponSlot = WEAPON_SLOT_PRIMARY;
  return -1;
}

// ---------------------------------------------------------------------------
// Multi-slot independent firing — determines which slots can fire this frame
// ---------------------------------------------------------------------------

/**
 * Determines which weapon slots are ready to fire on the current frame.
 * Each slot fires independently with its own cooldown/reload state.
 * Returns an array of slot indices that are ready.
 *
 * Source parity: In the C++ source, only one weapon fires per frame (the current
 * weapon). However, different weapon slots CAN be active simultaneously on units
 * like the Comanche (vulcan + missiles). The AI selects the "best" weapon for the
 * primary target, but secondary slots auto-target independently.
 */
export function getReadyToFireSlots(
  state: MultiWeaponEntityState,
  frameCounter: number,
): number[] {
  const readySlots: number[] = [];
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const slotIdx = i as 0 | 1 | 2;
    const profile = state.weaponSlotProfiles[slotIdx];
    if (!profile) {
      continue;
    }
    const slotState = state.weaponSlots[slotIdx];
    const status = getWeaponSlotStatus(slotState, profile, frameCounter);
    if (status === 'READY_TO_FIRE') {
      readySlots.push(i);
    }
  }
  return readySlots;
}

/**
 * Source parity: WeaponSet::isOutOfAmmo.
 * Returns true if ALL weapon slots are out of ammo.
 */
export function isWeaponSetOutOfAmmo(state: MultiWeaponEntityState, frameCounter: number): boolean {
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const slotIdx = i as 0 | 1 | 2;
    const profile = state.weaponSlotProfiles[slotIdx];
    if (!profile) {
      continue;
    }
    const status = getWeaponSlotStatus(state.weaponSlots[slotIdx], profile, frameCounter);
    if (status !== 'OUT_OF_AMMO') {
      return false;
    }
  }
  return true;
}

/**
 * Source parity: WeaponSet::reloadAllAmmo.
 * Reloads all weapon slots immediately (now=true) or starts reload timer.
 */
export function reloadAllWeaponSlots(
  state: MultiWeaponEntityState,
  now: boolean,
  frameCounter: number,
): void {
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const slotIdx = i as 0 | 1 | 2;
    const profile = state.weaponSlotProfiles[slotIdx];
    if (!profile) {
      continue;
    }
    const slot = state.weaponSlots[slotIdx];
    if (now) {
      slot.ammoInClip = profile.clipSize > 0 ? profile.clipSize : 0;
      slot.reloadFinishFrame = 0;
      slot.nextFireFrame = 0;
    } else {
      if (profile.clipSize > 0 && slot.ammoInClip < profile.clipSize) {
        slot.reloadFinishFrame = frameCounter + profile.clipReloadFrames;
        slot.nextFireFrame = slot.reloadFinishFrame;
      }
    }
  }
}

/**
 * Fire a specific weapon slot: decrements ammo, sets cooldown timers.
 * Returns true if the shot consumed the last round in the clip (triggering reload).
 */
export function fireWeaponSlot(
  state: MultiWeaponEntityState,
  slotIndex: number,
  frameCounter: number,
  resolveDelayFrames: (profile: WeaponSlotProfile) => number,
): boolean {
  const idx = slotIndex as 0 | 1 | 2;
  const profile = state.weaponSlotProfiles[idx];
  if (!profile) {
    return false;
  }
  const slot = state.weaponSlots[idx];

  // Activate leech range after first shot.
  if (profile.leechRangeWeapon) {
    slot.leechRangeActive = true;
  }

  // Update auto-reload idle timer.
  if (profile.autoReloadWhenIdleFrames > 0) {
    slot.forceReloadFrame = frameCounter + profile.autoReloadWhenIdleFrames;
  } else {
    slot.forceReloadFrame = 0;
  }

  // Decrement clip ammo.
  if (profile.clipSize > 0) {
    slot.ammoInClip = Math.max(0, slot.ammoInClip - 1);
    if (slot.ammoInClip <= 0) {
      slot.reloadFinishFrame = frameCounter + profile.clipReloadFrames;
      slot.nextFireFrame = slot.reloadFinishFrame;
      // Source parity: Weapon.cpp:2400-2412 — share reload timing across all slots.
      propagateSharedReloadTime(state, slot.nextFireFrame);
      return true; // clip empty, reloading
    }
  }

  // Set between-shots delay.
  slot.nextFireFrame = frameCounter + resolveDelayFrames(profile);

  // Source parity: Weapon.cpp:2400-2412 — share delay-between-shots timing across all slots.
  propagateSharedReloadTime(state, slot.nextFireFrame);

  return false;
}

/**
 * Source parity: Weapon.cpp:2400-2412 — when isReloadTimeShared(), firing one
 * weapon sets m_whenWeCanFireAgain and BETWEEN_FIRING_SHOTS status on ALL
 * weapons in the set.
 */
function propagateSharedReloadTime(
  state: MultiWeaponEntityState,
  nextFireFrame: number,
): void {
  if (!state.shareReloadTime) {
    return;
  }
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const slotIdx = i as 0 | 1 | 2;
    if (!state.weaponSlotProfiles[slotIdx]) {
      continue;
    }
    state.weaponSlots[slotIdx].nextFireFrame = nextFireFrame;
  }
}

/**
 * Source parity: WeaponSet::clearLeechRangeModeForAllWeapons.
 * Clears leech range active flag on all weapon slots.
 */
export function clearLeechRangeAllSlots(state: MultiWeaponEntityState): void {
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const slotIdx = i as 0 | 1 | 2;
    state.weaponSlots[slotIdx].leechRangeActive = false;
  }
}

// ---------------------------------------------------------------------------
// Source parity: Weapon::m_weaponRecoil — recoil amount
// ---------------------------------------------------------------------------

/**
 * Source parity: WeaponTemplate::getWeaponRecoilAmount.
 * Returns the recoil impulse in radians that the firing object experiences.
 * For browser port, this is informational (visual only).
 */
export function getWeaponRecoilAmount(
  _weaponProfile: Pick<WeaponSlotProfile, 'weaponSpeed'>,
): number {
  // Source parity: m_weaponRecoil is a separate field on the weapon template.
  // We don't have it in our profile yet, so return 0 for now.
  return 0;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function countSetBits(value: number): number {
  let v = value >>> 0;
  let count = 0;
  while (v !== 0) {
    count += v & 1;
    v >>>= 1;
  }
  return count;
}

/**
 * Source parity: WeaponSet.cpp getVictimAntiMask.
 * Computes the anti-mask bits for a target based on its properties.
 */
export function getVictimAntiMask(
  isAirborne: boolean,
  isMine: boolean,
  isSmallMissile: boolean,
  isBallisticMissile: boolean,
  isProjectile: boolean,
  isVehicle: boolean,
  isInfantry: boolean,
  isParachute: boolean,
): number {
  // Source parity: WeaponSet.cpp:363-406 — priority order matches C++ exactly.
  const WEAPON_ANTI_AIRBORNE_VEHICLE = 0x01;
  const WEAPON_ANTI_GROUND = 0x02;
  const WEAPON_ANTI_PROJECTILE = 0x04;
  const WEAPON_ANTI_SMALL_MISSILE = 0x08;
  const WEAPON_ANTI_MINE = 0x10;
  const WEAPON_ANTI_AIRBORNE_INFANTRY = 0x20;
  const WEAPON_ANTI_BALLISTIC_MISSILE = 0x40;
  const WEAPON_ANTI_PARACHUTE = 0x80;

  if (isMine) {
    return WEAPON_ANTI_MINE | WEAPON_ANTI_GROUND;
  }
  if (isSmallMissile) {
    return WEAPON_ANTI_SMALL_MISSILE;
  }
  if (isBallisticMissile) {
    return WEAPON_ANTI_BALLISTIC_MISSILE;
  }
  if (isProjectile) {
    return WEAPON_ANTI_PROJECTILE;
  }
  if (isAirborne) {
    if (isVehicle) {
      return WEAPON_ANTI_AIRBORNE_VEHICLE;
    }
    if (isInfantry) {
      return WEAPON_ANTI_AIRBORNE_INFANTRY;
    }
    if (isParachute) {
      return WEAPON_ANTI_PARACHUTE;
    }
    return 0;
  }
  return WEAPON_ANTI_GROUND;
}

/**
 * Source parity: Weapon::resolveWeaponDelayFrames.
 * Returns the delay frames between shots, randomized between min and max.
 */
export function resolveWeaponSlotDelayFrames(
  profile: Pick<WeaponSlotProfile, 'minDelayFrames' | 'maxDelayFrames'>,
  randomRange: (min: number, max: number) => number,
): number {
  const minDelay = Math.max(0, Math.trunc(profile.minDelayFrames));
  const maxDelay = Math.max(minDelay, Math.trunc(profile.maxDelayFrames));
  if (minDelay === maxDelay) {
    return minDelay;
  }
  return randomRange(minDelay, maxDelay);
}

/**
 * Source parity: Weapon::resolveWeaponPreAttackDelayFrames.
 * Returns the pre-attack delay based on prefire type and current state.
 */
export function resolveWeaponSlotPreAttackDelay(
  slot: WeaponSlotState,
  profile: Pick<WeaponSlotProfile, 'preAttackDelayFrames' | 'preAttackType' | 'clipSize'>,
  targetEntityId: number,
): number {
  const delay = Math.max(0, Math.trunc(profile.preAttackDelayFrames));
  if (delay <= 0) {
    return 0;
  }

  if (profile.preAttackType === 'PER_ATTACK') {
    if (
      slot.consecutiveShotsTargetEntityId === targetEntityId
      && slot.consecutiveShotsAtTarget > 0
    ) {
      return 0;
    }
    return delay;
  }

  if (profile.preAttackType === 'PER_CLIP') {
    if (profile.clipSize > 0 && slot.ammoInClip < profile.clipSize) {
      return 0;
    }
    return delay;
  }

  // PER_SHOT: always apply delay.
  return delay;
}

/**
 * Record that a shot was fired at a target — for consecutive-shot tracking.
 */
export function recordSlotConsecutiveShot(
  slot: WeaponSlotState,
  targetEntityId: number,
): void {
  if (slot.consecutiveShotsTargetEntityId === targetEntityId) {
    slot.consecutiveShotsAtTarget += 1;
  } else {
    slot.consecutiveShotsTargetEntityId = targetEntityId;
    slot.consecutiveShotsAtTarget = 1;
  }
}

/**
 * Rebuild scatter targets for a weapon slot (after clip reload).
 */
export function rebuildSlotScatterTargets(
  slot: WeaponSlotState,
  profile: Pick<WeaponSlotProfile, 'scatterTargets'>,
): void {
  const count = profile.scatterTargets?.length ?? 0;
  slot.scatterTargetsUnused = Array.from({ length: count }, (_, i) => i);
}

/**
 * Source parity: auto-reload idle weapons that haven't fired recently.
 */
export function updateWeaponSlotIdleAutoReload(
  state: MultiWeaponEntityState,
  frameCounter: number,
): void {
  for (let i = 0; i < WEAPON_SLOT_COUNT; i++) {
    const slotIdx = i as 0 | 1 | 2;
    const profile = state.weaponSlotProfiles[slotIdx];
    if (!profile || profile.autoReloadWhenIdleFrames <= 0) {
      continue;
    }
    const slot = state.weaponSlots[slotIdx];
    if (slot.forceReloadFrame <= 0 || frameCounter < slot.forceReloadFrame) {
      continue;
    }
    slot.forceReloadFrame = 0;
    if (profile.clipSize <= 0 || slot.ammoInClip >= profile.clipSize) {
      continue;
    }
    slot.ammoInClip = profile.clipSize;
    rebuildSlotScatterTargets(slot, profile);
    slot.reloadFinishFrame = 0;
    if (slot.nextFireFrame > frameCounter) {
      slot.nextFireFrame = frameCounter;
    }
  }
}
