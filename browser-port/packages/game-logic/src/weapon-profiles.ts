// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Weapon profiles — weapon profile resolution, scatter targets, historic bonus, fire rate.
 *
 * Source parity: Object/Weapon.cpp, WeaponSet.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readBooleanField, readNumericField, readNumericList, readStringField } from './ini-readers.js';
import { findObjectDefByName, findWeaponDefByName } from './registry-lookups.js';
import {
  ATTACK_RANGE_CELL_EDGE_FUDGE,
  EMPTY_KINDOF_SET,
  NO_ATTACK_DISTANCE,
  WEAPON_ANTI_AIRBORNE_INFANTRY,
  WEAPON_ANTI_AIRBORNE_VEHICLE,
  WEAPON_ANTI_BALLISTIC_MISSILE,
  WEAPON_ANTI_GROUND,
  WEAPON_ANTI_MINE,
  WEAPON_ANTI_PARACHUTE,
  WEAPON_ANTI_PROJECTILE,
  WEAPON_ANTI_SMALL_MISSILE,
} from './index.js';
type GL = any;

// ---- Weapon profiles implementations ----

export function resolveWeaponScatterTargets(self: GL, weaponDef: WeaponDef): Array<{ x: number; z: number }> {
  const scatterTargetValue = self.readIniFieldValue(weaponDef.fields, 'ScatterTarget');
  if (typeof scatterTargetValue === 'undefined') {
    return [];
  }

  const resolvedTargets: Array<{ x: number; z: number }> = [];
  for (const tokens of self.extractIniValueTokens(scatterTargetValue)) {
    const numericTokens = tokens
      .map((token) => Number(token))
      .filter((value) => Number.isFinite(value));
    if (numericTokens.length >= 2) {
      resolvedTargets.push({
        x: numericTokens[0] ?? 0,
        z: numericTokens[1] ?? 0,
      });
    }
  }

  if (resolvedTargets.length > 0) {
    return resolvedTargets;
  }

  const flattenedNumbers = readNumericList(scatterTargetValue);
  for (let index = 0; index + 1 < flattenedNumbers.length; index += 2) {
    resolvedTargets.push({
      x: flattenedNumbers[index] ?? 0,
      z: flattenedNumbers[index + 1] ?? 0,
    });
  }

  return resolvedTargets;
}

export function resolveWeaponProfileFromDef(self: GL, weaponDef: WeaponDef): AttackWeaponProfile | null {
  const attackRangeRaw = readNumericField(weaponDef.fields, ['AttackRange', 'Range']) ?? NO_ATTACK_DISTANCE;
  const unmodifiedAttackRange = Math.max(0, attackRangeRaw);
  const attackRange = Math.max(0, attackRangeRaw - ATTACK_RANGE_CELL_EDGE_FUDGE);
  const minAttackRange = Math.max(0, readNumericField(weaponDef.fields, ['MinimumAttackRange']) ?? 0);
  const continueAttackRange = Math.max(0, readNumericField(weaponDef.fields, ['ContinueAttackRange']) ?? 0);
  const primaryDamage = readNumericField(weaponDef.fields, ['PrimaryDamage']) ?? 0;
  const secondaryDamage = readNumericField(weaponDef.fields, ['SecondaryDamage']) ?? 0;
  const primaryDamageRadius = Math.max(0, readNumericField(weaponDef.fields, ['PrimaryDamageRadius']) ?? 0);
  const secondaryDamageRadius = Math.max(0, readNumericField(weaponDef.fields, ['SecondaryDamageRadius']) ?? 0);
  const scatterTargetScalar = Math.max(0, readNumericField(weaponDef.fields, ['ScatterTargetScalar']) ?? 0);
  const scatterTargets = resolveWeaponScatterTargets(self, weaponDef);
  const scatterRadius = Math.max(0, readNumericField(weaponDef.fields, ['ScatterRadius']) ?? 0);
  const scatterRadiusVsInfantry = Math.max(0, readNumericField(weaponDef.fields, ['ScatterRadiusVsInfantry']) ?? 0);
  const radiusDamageAngleDegrees = readNumericField(weaponDef.fields, ['RadiusDamageAngle']);
  const radiusDamageAngle = radiusDamageAngleDegrees === null
    ? Math.PI
    : Math.max(0, radiusDamageAngleDegrees * (Math.PI / 180));
  const projectileObjectRaw = readStringField(weaponDef.fields, ['ProjectileObject'])?.trim() ?? '';
  const projectileObjectName = projectileObjectRaw && projectileObjectRaw.toUpperCase() !== 'NONE'
    ? projectileObjectRaw
    : null;
  const damageDealtAtSelfPosition = readBooleanField(weaponDef.fields, ['DamageDealtAtSelfPosition']) ?? false;
  const radiusDamageAffectsMask = self.resolveWeaponRadiusAffectsMask(weaponDef);
  const projectileCollideMask = self.resolveWeaponProjectileCollideMask(weaponDef);
  const weaponSpeedRaw = readNumericField(weaponDef.fields, ['WeaponSpeed']) ?? 999999;
  const weaponSpeed = Number.isFinite(weaponSpeedRaw) && weaponSpeedRaw > 0 ? weaponSpeedRaw : 999999;
  const minWeaponSpeedRaw = readNumericField(weaponDef.fields, ['MinWeaponSpeed']) ?? 999999;
  const minWeaponSpeed = Number.isFinite(minWeaponSpeedRaw) && minWeaponSpeedRaw > 0 ? minWeaponSpeedRaw : 999999;
  const scaleWeaponSpeed = readBooleanField(weaponDef.fields, ['ScaleWeaponSpeed']) ?? false;
  const capableOfFollowingWaypoints = readBooleanField(
    weaponDef.fields,
    ['CapableOfFollowingWaypoints'],
  ) ?? false;
  const leechRangeWeapon = readBooleanField(weaponDef.fields, ['LeechRangeWeapon']) ?? false;
  const clipSizeRaw = readNumericField(weaponDef.fields, ['ClipSize']) ?? 0;
  const clipSize = Math.max(0, Math.trunc(clipSizeRaw));
  const clipReloadFrames = self.msToLogicFrames(readNumericField(weaponDef.fields, ['ClipReloadTime']) ?? 0);
  const autoReloadWhenIdleFrames = self.msToLogicFrames(readNumericField(weaponDef.fields, ['AutoReloadWhenIdle']) ?? 0);
  const preAttackDelayFrames = self.msToLogicFrames(readNumericField(weaponDef.fields, ['PreAttackDelay']) ?? 0);
  const preAttackTypeToken = readStringField(weaponDef.fields, ['PreAttackType'])?.trim().toUpperCase();
  const preAttackType: WeaponPrefireTypeName =
    preAttackTypeToken === 'PER_ATTACK' || preAttackTypeToken === 'PER_CLIP'
      ? preAttackTypeToken
      : 'PER_SHOT';
  const delayValues = readNumericList(weaponDef.fields['DelayBetweenShots']);
  const minDelayMs = delayValues[0] ?? 0;
  const maxDelayMs = delayValues[1] ?? minDelayMs;
  const minDelayFrames = self.msToLogicFrames(minDelayMs);
  const maxDelayFrames = self.msToLogicFrames(maxDelayMs);
  // Source parity: Weapon::m_antiMask — WeaponTemplate::clear() pre-seeds WEAPON_ANTI_GROUND
  // before INI parsing, so all weapons can target ground by default unless explicitly cleared.
  let antiMask = WEAPON_ANTI_GROUND;
  if (readBooleanField(weaponDef.fields, ['AntiAirborneVehicle'])) antiMask |= WEAPON_ANTI_AIRBORNE_VEHICLE;
  if (readBooleanField(weaponDef.fields, ['AntiGround']) === false) antiMask &= ~WEAPON_ANTI_GROUND;
  if (readBooleanField(weaponDef.fields, ['AntiProjectile'])) antiMask |= WEAPON_ANTI_PROJECTILE;
  if (readBooleanField(weaponDef.fields, ['AntiSmallMissile'])) antiMask |= WEAPON_ANTI_SMALL_MISSILE;
  if (readBooleanField(weaponDef.fields, ['AntiMine'])) antiMask |= WEAPON_ANTI_MINE;
  if (readBooleanField(weaponDef.fields, ['AntiAirborneInfantry'])) antiMask |= WEAPON_ANTI_AIRBORNE_INFANTRY;
  if (readBooleanField(weaponDef.fields, ['AntiBallisticMissile'])) antiMask |= WEAPON_ANTI_BALLISTIC_MISSILE;
  if (readBooleanField(weaponDef.fields, ['AntiParachute'])) antiMask |= WEAPON_ANTI_PARACHUTE;

  // Source parity: FiringTracker continuous-fire INI properties on WeaponTemplate.
  const continuousFireOneShotsNeeded = Math.max(0, Math.trunc(
    readNumericField(weaponDef.fields, ['ContinuousFireOne']) ?? 0,
  ));
  const continuousFireTwoShotsNeeded = Math.max(0, Math.trunc(
    readNumericField(weaponDef.fields, ['ContinuousFireTwo']) ?? 0,
  ));
  const continuousFireCoastFrames = self.msToLogicFrames(
    readNumericField(weaponDef.fields, ['ContinuousFireCoast']) ?? 0,
  );
  // Source parity: per-weapon WeaponBonus lines — parse RATE_OF_FIRE multipliers
  // for CONTINUOUS_FIRE_MEAN and CONTINUOUS_FIRE_FAST conditions.
  const { continuousFireMeanRateOfFire, continuousFireFastRateOfFire } =
    self.resolveWeaponContinuousFireBonuses(weaponDef);

  // Source parity: WeaponTemplate::m_deathType — per-weapon death type (Weapon.cpp line 186).
  // Default is DEATH_NORMAL. INI field: DeathType (parsed as index list into TheDeathNames).
  const deathTypeRaw = readStringField(weaponDef.fields, ['DeathType'])?.trim().toUpperCase() ?? '';
  const deathType = deathTypeRaw || 'NORMAL';

  // Source parity: Weapon::isLaser() — weapon is a laser if LaserName is non-empty.
  const laserNameRaw = readStringField(weaponDef.fields, ['LaserName'])?.trim() ?? '';
  const laserName = laserNameRaw && laserNameRaw.toUpperCase() !== 'NONE' ? laserNameRaw : null;

  // Source parity: DumbProjectileBehavior arc parameters — parsed from the projectile
  // object template referenced by ProjectileObject on this weapon.
  const bezierArc = projectileObjectName
    ? self.extractDumbProjectileArcParams(projectileObjectName)
    : null;

  if (attackRange <= 0 || primaryDamage <= 0) {
    return null;
  }

  return {
    name: weaponDef.name,
    primaryDamage,
    secondaryDamage,
    primaryDamageRadius,
    secondaryDamageRadius,
    scatterTargetScalar,
    scatterTargets,
    scatterRadius,
    scatterRadiusVsInfantry,
    radiusDamageAngle,
    damageType: self.resolveWeaponDamageTypeName(weaponDef),
    deathType,
    damageDealtAtSelfPosition,
    radiusDamageAffectsMask,
    projectileCollideMask,
    weaponSpeed,
    minWeaponSpeed,
    scaleWeaponSpeed,
    capableOfFollowingWaypoints,
    projectileObjectName,
    attackRange,
    unmodifiedAttackRange,
    minAttackRange,
    continueAttackRange,
    clipSize,
    clipReloadFrames,
    autoReloadWhenIdleFrames,
    preAttackDelayFrames,
    preAttackType,
    minDelayFrames: Math.max(0, Math.min(minDelayFrames, maxDelayFrames)),
    maxDelayFrames: Math.max(minDelayFrames, maxDelayFrames),
    antiMask,
    continuousFireOneShotsNeeded,
    continuousFireTwoShotsNeeded,
    continuousFireCoastFrames,
    continuousFireMeanRateOfFire,
    continuousFireFastRateOfFire,
    laserName,
    projectileArcFirstHeight: bezierArc?.firstHeight ?? 0,
    projectileArcSecondHeight: bezierArc?.secondHeight ?? 0,
    projectileArcFirstPercentIndent: bezierArc?.firstPercentIndent ?? 0,
    projectileArcSecondPercentIndent: bezierArc?.secondPercentIndent ?? 0,
    leechRangeWeapon,
    fireSoundEvent: readStringField(weaponDef.fields, ['FireSound'])?.trim() || null,
    historicBonusCount: readNumericField(weaponDef.fields, ['HistoricBonusCount']) ?? 0,
    historicBonusRadius: readNumericField(weaponDef.fields, ['HistoricBonusRadius']) ?? 0,
    historicBonusTime: readNumericField(weaponDef.fields, ['HistoricBonusTime']) ?? 0,
    historicBonusWeapon: readStringField(weaponDef.fields, ['HistoricBonusWeapon'])?.trim() || null,
  };
}

export function resolveAttackWeaponProfileForSetSelection(self: GL, 
  weaponTemplateSets: readonly WeaponTemplateSetProfile[],
  weaponSetFlagsMask: number,
  iniDataRegistry: IniDataRegistry,
  forcedWeaponSlot: number | null = null,
): AttackWeaponProfile | null {
  const selectedSet = self.selectBestSetByConditions(weaponTemplateSets, weaponSetFlagsMask);
  if (!selectedSet) {
    return null;
  }

  const normalizedForcedWeaponSlot = self.normalizeWeaponSlot(forcedWeaponSlot);
  if (normalizedForcedWeaponSlot !== null) {
    const weaponName = selectedSet.weaponNamesBySlot[normalizedForcedWeaponSlot];
    if (weaponName) {
      const forcedWeapon = findWeaponDefByName(iniDataRegistry, weaponName);
      if (forcedWeapon) {
        const profile = resolveWeaponProfileFromDef(self, forcedWeapon);
        if (profile) {
          return profile;
        }
      }
    }
  }

  for (const weaponName of selectedSet.weaponNamesBySlot) {
    if (!weaponName) {
      continue;
    }
    const weapon = findWeaponDefByName(iniDataRegistry, weaponName);
    if (!weapon) {
      continue;
    }
    const profile = resolveWeaponProfileFromDef(self, weapon);
    if (profile) {
      return profile;
    }
  }

  return null;
}

export function resolveAttackWeaponProfile(self: GL, 
  objectDef: ObjectDef | undefined,
  iniDataRegistry: IniDataRegistry,
): AttackWeaponProfile | null {
  if (!objectDef) {
    return null;
  }
  return resolveAttackWeaponProfileForSetSelection(self, 
    self.extractWeaponTemplateSets(objectDef),
    0,
    iniDataRegistry,
  );
}

export function checkHistoricBonus(self: GL, weapon: AttackWeaponProfile, targetX: number, targetZ: number, attackerId: number): void {
  if (weapon.historicBonusCount <= 0 || !weapon.historicBonusWeapon) return;

  // Source parity: keyed by weapon template name, shared across all units.
  const key = weapon.name;
  let log = self.historicDamageLog.get(key);
  if (!log) {
    log = [];
    self.historicDamageLog.set(key, log);
  }

  // Trim old entries (outside time window).
  // Source parity: C++ trimOldHistoricDamage uses GlobalData::m_historicDamageLimit;
  // we approximate with the per-weapon time window.
  const timeWindowFrames = Math.ceil(weapon.historicBonusTime * 30 / 1000);
  const oldestThatWillCount = self.frameCounter - timeWindowFrames;
  while (log.length > 0 && log[0]!.frame <= oldestThatWillCount) {
    log.shift();
  }

  // Count hits within radius and time window.
  const radiusSq = weapon.historicBonusRadius * weapon.historicBonusRadius;
  let hitsInRadius = 0;
  for (const entry of log) {
    if (entry.frame >= oldestThatWillCount) {
      const dx = entry.x - targetX;
      const dz = entry.z - targetZ;
      if (dx * dx + dz * dz <= radiusSq) {
        hitsInRadius++;
      }
    }
  }

  // Source parity: count >= m_historicBonusCount - 1 (includes current hit implicitly).
  if (hitsInRadius >= weapon.historicBonusCount - 1) {
    // Clear the log to prevent retriggering (C++ line 1119).
    log.length = 0;
    // Fire the bonus weapon at the target location.
    fireHistoricBonusWeapon(self, weapon.historicBonusWeapon, targetX, targetZ, attackerId);
  } else {
    // Source parity: add AFTER checking (C++ line 1126).
    log.push({ frame: self.frameCounter, x: targetX, z: targetZ });
  }
}

export function fireHistoricBonusWeapon(self: GL, weaponName: string, targetX: number, targetZ: number, attackerId: number): void {
  const weaponDef = self.iniDataRegistry?.getWeapon(weaponName);
  if (!weaponDef) return;
  const source = self.spawnedEntities.get(attackerId);
  if (!source || source.destroyed) return;
  self.fireTemporaryWeaponAtPosition(source, weaponDef, targetX, targetZ);
}

export function classifyWeaponVisualType(self: GL, weapon: AttackWeaponProfile): import('./types.js').ProjectileVisualType {
  // Source parity: weapon with LaserName is definitively a laser.
  if (weapon.laserName) return 'LASER';
  const name = weapon.name.toUpperCase();
  if (name.includes('MISSILE') || name.includes('ROCKET') || name.includes('PATRIOT')) return 'MISSILE';
  if (name.includes('ARTILLERY') || name.includes('CANNON') || name.includes('SHELL')
    || weapon.primaryDamageRadius > 10) return 'ARTILLERY';
  if (name.includes('LASER')) return 'LASER';
  return 'BULLET';
}

export function resolveContinuousFireRateOfFireBonus(self: GL, entity: MapEntity, weapon: AttackWeaponProfile): number {
  if (entity.continuousFireState === 'FAST') {
    return weapon.continuousFireFastRateOfFire;
  }
  if (entity.continuousFireState === 'MEAN') {
    return weapon.continuousFireMeanRateOfFire;
  }
  return 1.0;
}

export function resolveWeaponDelayFramesWithBonus(self: GL, attacker: MapEntity, weapon: AttackWeaponProfile): number {
  const baseDelay = self.resolveWeaponDelayFrames(weapon);
  // Source parity: combine per-weapon continuous-fire bonus with global table ROF bonus.
  const continuousFireBonus = resolveContinuousFireRateOfFireBonus(self, attacker, weapon);
  const globalRofBonus = self.resolveWeaponRateOfFireBonusMultiplier(attacker);
  // Additive accumulation: both bonuses contribute (globalRofBonus already includes 1.0 base).
  const totalRofBonus = continuousFireBonus + (globalRofBonus - 1.0);
  if (totalRofBonus <= 0 || totalRofBonus === 1.0) {
    return baseDelay;
  }
  // Source parity: REAL_TO_INT_FLOOR(delay / rofBonus).
  return Math.max(0, Math.floor(baseDelay / totalRofBonus));
}

/**
 * Source parity: Weapon.cpp getClipReloadTime(bonus) — divide m_clipReloadTime by ROF bonus.
 * Unlike delay-between-shots, clip reload is NOT affected by continuous-fire bonus — only by the
 * global weapon bonus table (veterancy, upgrades, etc.).
 */
export function resolveClipReloadFramesWithBonus(self: GL, attacker: MapEntity, weapon: AttackWeaponProfile): number {
  const baseReload = weapon.clipReloadFrames;
  const globalRofBonus = self.resolveWeaponRateOfFireBonusMultiplier(attacker);
  if (globalRofBonus <= 0 || globalRofBonus === 1.0) {
    return baseReload;
  }
  // Source parity: REAL_TO_INT_FLOOR(m_clipReloadTime / bonus.getField(WeaponBonus::RATE_OF_FIRE)).
  return Math.max(0, Math.floor(baseReload / globalRofBonus));
}

export function resolveProjectileTemplateKindOf(self: GL, weapon: AttackWeaponProfile): Set<string> {
  const templateName = weapon.projectileObjectName;
  if (!templateName) return EMPTY_KINDOF_SET;

  const cached = self.projectileKindOfCache.get(templateName);
  if (cached) return cached;

  const registry = self.iniDataRegistry;
  if (!registry) return EMPTY_KINDOF_SET;

  const objectDef = findObjectDefByName(registry, templateName);
  if (!objectDef) return EMPTY_KINDOF_SET;

  const kindOf = self.normalizeKindOf(objectDef.kindOf);
  self.projectileKindOfCache.set(templateName, kindOf);
  return kindOf;
}
