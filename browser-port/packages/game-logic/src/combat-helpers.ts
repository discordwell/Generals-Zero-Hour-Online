interface CombatWeaponLike {
  minAttackRange: number;
  unmodifiedAttackRange: number;
  weaponSpeed: number;
  minWeaponSpeed: number;
  scaleWeaponSpeed: boolean;
  scatterRadius: number;
  scatterRadiusVsInfantry: number;
  preAttackDelayFrames: number;
  preAttackType: 'PER_SHOT' | 'PER_ATTACK' | 'PER_CLIP';
  clipSize: number;
  minDelayFrames: number;
  maxDelayFrames: number;
}

interface CombatEntityStatusLike {
  objectStatusFlags: Set<string>;
}

interface CombatEntityPrefireStateLike {
  consecutiveShotsTargetEntityId: number | null;
  consecutiveShotsAtTarget: number;
  attackAmmoInClip: number;
}

interface CombatDamageTargetLike {
  canTakeDamage: boolean;
  destroyed: boolean;
  armorDamageCoefficients: ReadonlyMap<string, number> | null;
}

interface VectorXZLike {
  x: number;
  z: number;
}

interface CombatSneakyWindowEntityLike extends CombatEntityStatusLike {
  attackersMissPersistFrames: number;
  attackersMissExpireFrame: number;
  sneakyOffsetWhenAttacking: number;
}

interface CombatWeaponScatterLike {
  clipSize: number;
  scatterTargets: readonly unknown[];
  autoReloadWhenIdleFrames: number;
}

interface CombatWeaponTimingEntityLike {
  destroyed: boolean;
  attackWeapon: CombatWeaponScatterLike | null;
  attackAmmoInClip: number;
  attackReloadFinishFrame: number;
  attackForceReloadFrame: number;
  attackScatterTargetsUnused: number[];
  preAttackFinishFrame: number;
  consecutiveShotsTargetEntityId: number | null;
  consecutiveShotsAtTarget: number;
  nextAttackFrame: number;
}

export function setEntityAttackStatus(entity: CombatEntityStatusLike, isAttacking: boolean): void {
  if (isAttacking) {
    entity.objectStatusFlags.add('IS_ATTACKING');
  } else {
    entity.objectStatusFlags.delete('IS_ATTACKING');
  }
}

export function setEntityAimingWeaponStatus(entity: CombatEntityStatusLike, isAiming: boolean): void {
  if (isAiming) {
    entity.objectStatusFlags.add('IS_AIMING_WEAPON');
  } else {
    entity.objectStatusFlags.delete('IS_AIMING_WEAPON');
  }
}

export function setEntityFiringWeaponStatus(entity: CombatEntityStatusLike, isFiring: boolean): void {
  if (isFiring) {
    entity.objectStatusFlags.add('IS_FIRING_WEAPON');
  } else {
    entity.objectStatusFlags.delete('IS_FIRING_WEAPON');
  }
}

export function setEntityIgnoringStealthStatus(entity: CombatEntityStatusLike, isIgnoringStealth: boolean): void {
  if (isIgnoringStealth) {
    entity.objectStatusFlags.add('IGNORING_STEALTH');
  } else {
    entity.objectStatusFlags.delete('IGNORING_STEALTH');
  }
}

export function resolveScaledProjectileTravelSpeed(
  weapon: CombatWeaponLike,
  sourceToAimDistance: number,
  attackRangeCellEdgeFudge: number,
): number {
  if (!weapon.scaleWeaponSpeed) {
    return weapon.weaponSpeed;
  }

  const minRange = Math.max(0, weapon.minAttackRange - attackRangeCellEdgeFudge);
  const maxRange = Math.max(minRange, weapon.unmodifiedAttackRange);
  const rangeRatio = (sourceToAimDistance - minRange) / (maxRange - minRange);
  return (rangeRatio * (weapon.weaponSpeed - weapon.minWeaponSpeed)) + weapon.minWeaponSpeed;
}

export function resolveProjectileScatterRadiusForCategory(
  weapon: CombatWeaponLike,
  targetCategory: string,
): number {
  let scatter = Math.max(0, weapon.scatterRadius);
  if (targetCategory === 'infantry') {
    scatter += Math.max(0, weapon.scatterRadiusVsInfantry);
  }
  return scatter;
}

export function computeAttackRetreatTarget(
  attackerX: number,
  attackerZ: number,
  targetX: number,
  targetZ: number,
  weapon: Pick<CombatWeaponLike, 'minAttackRange'> & { attackRange: number },
): { x: number; z: number } | null {
  let awayX = attackerX - targetX;
  let awayZ = attackerZ - targetZ;
  const length = Math.hypot(awayX, awayZ);
  if (length <= 1e-6) {
    awayX = 1;
    awayZ = 0;
  } else {
    awayX /= length;
    awayZ /= length;
  }

  const minAttackRange = Math.max(0, weapon.minAttackRange);
  const attackRange = Math.max(minAttackRange, weapon.attackRange);
  const desiredDistance = (attackRange + minAttackRange) * 0.5;
  if (!Number.isFinite(desiredDistance) || desiredDistance <= 0) {
    return null;
  }

  return {
    x: targetX + awayX * desiredDistance,
    z: targetZ + awayZ * desiredDistance,
  };
}

export function getConsecutiveShotsFiredAtTarget(
  entity: Pick<CombatEntityPrefireStateLike, 'consecutiveShotsTargetEntityId' | 'consecutiveShotsAtTarget'>,
  targetEntityId: number,
): number {
  if (entity.consecutiveShotsTargetEntityId !== targetEntityId) {
    return 0;
  }
  return entity.consecutiveShotsAtTarget;
}

export function resolveWeaponPreAttackDelayFrames(
  attacker: CombatEntityPrefireStateLike,
  targetEntityId: number,
  weapon: Pick<CombatWeaponLike, 'preAttackDelayFrames' | 'preAttackType' | 'clipSize'>,
): number {
  const delay = Math.max(0, Math.trunc(weapon.preAttackDelayFrames));
  if (delay <= 0) {
    return 0;
  }

  if (weapon.preAttackType === 'PER_ATTACK') {
    if (getConsecutiveShotsFiredAtTarget(attacker, targetEntityId) > 0) {
      return 0;
    }
    return delay;
  }

  if (weapon.preAttackType === 'PER_CLIP') {
    if (weapon.clipSize > 0 && attacker.attackAmmoInClip < weapon.clipSize) {
      return 0;
    }
    return delay;
  }

  return delay;
}

export function recordConsecutiveAttackShot(
  attacker: Pick<CombatEntityPrefireStateLike, 'consecutiveShotsTargetEntityId' | 'consecutiveShotsAtTarget'>,
  targetEntityId: number,
): void {
  if (attacker.consecutiveShotsTargetEntityId === targetEntityId) {
    attacker.consecutiveShotsAtTarget += 1;
    return;
  }
  attacker.consecutiveShotsTargetEntityId = targetEntityId;
  attacker.consecutiveShotsAtTarget = 1;
}

export function resolveWeaponDelayFrames(
  weapon: Pick<CombatWeaponLike, 'minDelayFrames' | 'maxDelayFrames'>,
  randomRange: (min: number, max: number) => number,
): number {
  const minDelay = Math.max(0, Math.trunc(weapon.minDelayFrames));
  const maxDelay = Math.max(minDelay, Math.trunc(weapon.maxDelayFrames));
  if (minDelay === maxDelay) {
    return minDelay;
  }
  return randomRange(minDelay, maxDelay);
}

/**
 * Callers must pass pre-normalized (uppercase, trimmed) damage type strings.
 * Armor coefficient map keys are uppercase (built from SOURCE_DAMAGE_TYPE_NAMES).
 */
export function adjustDamageByArmorSet(
  target: CombatDamageTargetLike,
  amount: number,
  damageType: string,
): number {
  // Source parity: Armor.cpp:69-72 — UNRESISTABLE and SUBDUAL_UNRESISTABLE bypass armor.
  if (damageType === 'UNRESISTABLE' || damageType === 'SUBDUAL_UNRESISTABLE') {
    return amount;
  }

  const coefficients = target.armorDamageCoefficients;
  if (!coefficients) {
    return amount;
  }

  const coefficient = coefficients.get(damageType);
  if (coefficient === undefined) {
    return amount;
  }

  return Math.max(0, amount * coefficient);
}

/**
 * Source parity: Weapon.cpp:601-606 — DAMAGE_SNIPER vs empty garrisonable structure.
 * If the weapon's damageType is SNIPER and the target is a STRUCTURE with a contain
 * module that has 0 occupants, damage is zeroed (snipers can't hurt empty structures).
 */
export function resolveSniperDamageVsEmptyStructure(
  amount: number,
  damageType: string,
  targetKindOf: ReadonlySet<string>,
  targetContainCount: number | null,
): number {
  if (damageType !== 'SNIPER') {
    return amount;
  }
  if (!targetKindOf.has('STRUCTURE')) {
    return amount;
  }
  // null means no contain module — sniper damage proceeds normally.
  if (targetContainCount === null) {
    return amount;
  }
  if (targetContainCount === 0) {
    return 0;
  }
  return amount;
}

/**
 * Source parity: Weapon.cpp:622-628 — DAMAGE_DISARM only damages mines/traps.
 * Returns 1.0 for MINE, BOOBY_TRAP, or DEMOTRAP targets; 0.0 for everything else.
 * The returned value replaces the original damage amount.
 */
export function resolveDisarmDamage(
  amount: number,
  damageType: string,
  targetKindOf: ReadonlySet<string>,
): number {
  if (damageType !== 'DISARM') {
    return amount;
  }
  if (
    targetKindOf.has('MINE')
    || targetKindOf.has('BOOBY_TRAP')
    || targetKindOf.has('DEMOTRAP')
  ) {
    return 1.0;
  }
  return 0;
}

export function refreshEntitySneakyMissWindow(
  entity: CombatSneakyWindowEntityLike,
  frameCounter: number,
): void {
  if (entity.attackersMissPersistFrames <= 0) {
    return;
  }
  if (entity.objectStatusFlags.has('IS_ATTACKING')) {
    entity.attackersMissExpireFrame = frameCounter + entity.attackersMissPersistFrames;
    return;
  }
  if (entity.attackersMissExpireFrame !== 0 && frameCounter >= entity.attackersMissExpireFrame) {
    entity.attackersMissExpireFrame = 0;
  }
}

export function entityHasSneakyTargetingOffset(
  entity: Pick<CombatSneakyWindowEntityLike, 'attackersMissExpireFrame'>,
  frameCounter: number,
): boolean {
  return entity.attackersMissExpireFrame !== 0 && frameCounter < entity.attackersMissExpireFrame;
}

export function resolveEntitySneakyTargetingOffset(
  entity: CombatSneakyWindowEntityLike,
  frameCounter: number,
  forward: VectorXZLike,
): VectorXZLike | null {
  if (!entityHasSneakyTargetingOffset(entity, frameCounter)) {
    return null;
  }
  const length = Math.hypot(forward.x, forward.z);
  if (!Number.isFinite(length) || length <= 0) {
    return { x: 0, z: 0 };
  }
  const scale = entity.sneakyOffsetWhenAttacking / length;
  return {
    x: forward.x * scale,
    z: forward.z * scale,
  };
}

export function rebuildEntityScatterTargets(
  entity: Pick<CombatWeaponTimingEntityLike, 'attackWeapon' | 'attackScatterTargetsUnused'>,
): void {
  const scatterTargetsCount = entity.attackWeapon?.scatterTargets.length ?? 0;
  entity.attackScatterTargetsUnused = Array.from({ length: scatterTargetsCount }, (_entry, index) => index);
}

export function resetEntityWeaponTimingState(
  entity: Pick<
    CombatWeaponTimingEntityLike,
    | 'attackWeapon'
    | 'attackAmmoInClip'
    | 'attackReloadFinishFrame'
    | 'attackForceReloadFrame'
    | 'attackScatterTargetsUnused'
    | 'preAttackFinishFrame'
    | 'consecutiveShotsTargetEntityId'
    | 'consecutiveShotsAtTarget'
  >,
): void {
  const clipSize = entity.attackWeapon?.clipSize ?? 0;
  entity.attackAmmoInClip = clipSize > 0 ? clipSize : 0;
  entity.attackReloadFinishFrame = 0;
  entity.attackForceReloadFrame = 0;
  rebuildEntityScatterTargets(entity);
  entity.preAttackFinishFrame = 0;
  entity.consecutiveShotsTargetEntityId = null;
  entity.consecutiveShotsAtTarget = 0;
}

export function updateWeaponIdleAutoReload(
  entities: Iterable<CombatWeaponTimingEntityLike>,
  frameCounter: number,
): void {
  for (const entity of entities) {
    if (entity.destroyed) {
      continue;
    }
    const weapon = entity.attackWeapon;
    if (!weapon || weapon.autoReloadWhenIdleFrames <= 0) {
      continue;
    }
    const forceReloadFrame = entity.attackForceReloadFrame;
    if (forceReloadFrame <= 0 || frameCounter < forceReloadFrame) {
      continue;
    }
    entity.attackForceReloadFrame = 0;
    if (weapon.clipSize <= 0 || entity.attackAmmoInClip >= weapon.clipSize) {
      continue;
    }
    entity.attackAmmoInClip = weapon.clipSize;
    rebuildEntityScatterTargets(entity);
    entity.attackReloadFinishFrame = 0;
    if (entity.nextAttackFrame > frameCounter) {
      entity.nextAttackFrame = frameCounter;
    }
  }
}
