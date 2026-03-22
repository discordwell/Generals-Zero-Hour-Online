/**
 * Veterancy & experience system.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Include/GameLogic/ExperienceTracker.h
 *   Generals/Code/GameEngine/Source/GameLogic/Object/ExperienceTracker.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Body/ActiveBody.cpp (lines 1126-1159)
 *   Generals/Code/GameEngine/Source/Common/GlobalData.cpp (HealthBonus_*, m_healthBonus)
 *   Generals/Code/GameEngine/Include/Common/GameCommon.h (VeterancyLevel enum)
 */

// ──── Veterancy levels ─────────────────────────────────────────────────────
export const LEVEL_REGULAR = 0;
export const LEVEL_VETERAN = 1;
export const LEVEL_ELITE = 2;
export const LEVEL_HEROIC = 3;
export const LEVEL_COUNT = 4;

export type VeterancyLevel = typeof LEVEL_REGULAR | typeof LEVEL_VETERAN | typeof LEVEL_ELITE | typeof LEVEL_HEROIC;

// ──── Armor set flags for veterancy ────────────────────────────────────────
// Source parity: ActiveBody.cpp lines 1139-1159
export const ARMORSET_VETERAN_FLAG = 0x01;
export const ARMORSET_ELITE_FLAG = 0x02;
export const ARMORSET_HERO_FLAG = 0x04;

// ──── Default health bonuses (overridden by INI GlobalData) ────────────────
// Source parity: GlobalData.cpp:940 — all default to 1.0
export const DEFAULT_HEALTH_BONUSES: readonly number[] = [1.0, 1.0, 1.0, 1.0];

// ──── Experience profile from INI (per object template) ────────────────────
export interface ExperienceProfile {
  /** XP thresholds to reach each level. Index 0 (REGULAR) is typically 0. */
  experienceRequired: readonly [number, number, number, number];
  /** XP value awarded to killer at each level of this unit. */
  experienceValue: readonly [number, number, number, number];
}

// ──── Per-entity experience state ──────────────────────────────────────────
export interface ExperienceState {
  currentLevel: VeterancyLevel;
  currentExperience: number;
  experienceScalar: number;
  /** Source parity: ExperienceTracker.h:74 — m_experienceSink.
   *  Entity ID to redirect all earned XP to, or -1 (INVALID_ID) for no redirect.
   *  Used by spawned slaves (aircraft → carrier, tunnel defenders). */
  experienceSinkEntityId: number;
}

// ──── Global veterancy config (from INI GlobalData) ────────────────────────
export interface VeterancyConfig {
  healthBonuses: readonly [number, number, number, number];
}

export const DEFAULT_VETERANCY_CONFIG: VeterancyConfig = {
  healthBonuses: [1.0, 1.0, 1.0, 1.0],
};

// ──── Create initial experience state ──────────────────────────────────────
export function createExperienceState(): ExperienceState {
  return {
    currentLevel: LEVEL_REGULAR,
    currentExperience: 0,
    experienceScalar: 1.0,
    experienceSinkEntityId: -1,  // Source parity: ExperienceTracker.cpp:49 — INVALID_ID
  };
}

// ──── Resolve the XP value a killed unit grants ────────────────────────────
export function getExperienceValue(
  profile: ExperienceProfile,
  victimLevel: VeterancyLevel,
): number {
  return Math.max(0, Math.trunc(profile.experienceValue[victimLevel] ?? 0));
}

// ──── Add XP and check for level-up ────────────────────────────────────────
export interface LevelUpResult {
  oldLevel: VeterancyLevel;
  newLevel: VeterancyLevel;
  didLevelUp: boolean;
}

export function addExperiencePoints(
  state: ExperienceState,
  profile: ExperienceProfile,
  xpGain: number,
  applyScalar: boolean,
): LevelUpResult {
  const oldLevel = state.currentLevel;

  if (xpGain <= 0) {
    return { oldLevel, newLevel: oldLevel, didLevelUp: false };
  }

  const scaledGain = applyScalar
    ? Math.trunc(xpGain * state.experienceScalar)
    : xpGain;

  state.currentExperience += scaledGain;

  // Source parity: check each level threshold from current+1 to HEROIC.
  let newLevel = oldLevel;
  for (let level = (oldLevel + 1) as VeterancyLevel; level <= LEVEL_HEROIC; level++) {
    const required = profile.experienceRequired[level];
    if (required > 0 && state.currentExperience >= required) {
      newLevel = level as VeterancyLevel;
    } else {
      break;
    }
  }

  state.currentLevel = newLevel;

  return {
    oldLevel,
    newLevel,
    didLevelUp: newLevel > oldLevel,
  };
}

// ──── Apply health bonus on level change ───────────────────────────────────
// Source parity: ActiveBody.cpp lines 1126-1134
export function applyHealthBonusForLevelChange(
  oldLevel: VeterancyLevel,
  newLevel: VeterancyLevel,
  currentHealth: number,
  currentMaxHealth: number,
  config: VeterancyConfig,
): { newHealth: number; newMaxHealth: number } {
  const oldBonus = config.healthBonuses[oldLevel];
  const newBonus = config.healthBonuses[newLevel];

  if (oldBonus <= 0 || newBonus <= 0) {
    return { newHealth: currentHealth, newMaxHealth: currentMaxHealth };
  }

  const mult = newBonus / oldBonus;
  const newMaxHealth = Math.max(1, Math.trunc(currentMaxHealth * mult));

  // Source parity: PRESERVE_RATIO — maintain the same health percentage.
  const ratio = currentMaxHealth > 0 ? currentHealth / currentMaxHealth : 1;
  const newHealth = Math.max(1, Math.trunc(newMaxHealth * ratio));

  return { newHealth, newMaxHealth };
}

// ──── Resolve armor set flags for a veterancy level ────────────────────────
// Source parity: ActiveBody.cpp lines 1139-1159
export function resolveArmorSetFlagsForLevel(level: VeterancyLevel): number {
  switch (level) {
    case LEVEL_REGULAR:
      return 0;
    case LEVEL_VETERAN:
      return ARMORSET_VETERAN_FLAG;
    case LEVEL_ELITE:
      return ARMORSET_ELITE_FLAG;
    case LEVEL_HEROIC:
      return ARMORSET_HERO_FLAG;
    default:
      return 0;
  }
}
