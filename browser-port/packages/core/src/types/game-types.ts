/**
 * Core game type definitions — ported from GameType.h, KindOf.h, ObjectStatusTypes.h.
 *
 * These enums and types form the vocabulary of the entire game simulation.
 */

// ============================================================================
// Opaque IDs
// ============================================================================

/** Unique identifier for a game object instance. */
export type ObjectID = number & { readonly __brand: unique symbol };

/** Unique identifier for a drawable (visual representation). */
export type DrawableID = number & { readonly __brand: unique symbol };

/** Unique identifier for a team. */
export type TeamID = number & { readonly __brand: unique symbol };

/** Unique identifier for a player. */
export type PlayerID = number & { readonly __brand: unique symbol };

export const INVALID_OBJECT_ID = 0 as ObjectID;
export const INVALID_DRAWABLE_ID = 0 as DrawableID;

// ============================================================================
// KindOf flags — what kind of thing an object is
// ============================================================================

export enum KindOf {
  NONE = 0,
  OBSTACLE = 1 << 0,
  SELECTABLE = 1 << 1,
  IMMOBILE = 1 << 2,
  CAN_ATTACK = 1 << 3,
  STICK_TO_TERRAIN_SLOPE = 1 << 4,
  CAN_CAST_REFLECTIONS = 1 << 5,
  SHRUBBERY = 1 << 6,
  STRUCTURE = 1 << 7,
  INFANTRY = 1 << 8,
  VEHICLE = 1 << 9,
  AIRCRAFT = 1 << 10,
  HUGE_VEHICLE = 1 << 11,
  DOZER = 1 << 12,
  HARVESTER = 1 << 13,
  COMMANDCENTER = 1 << 14,
  TECH_BUILDING = 1 << 15,
  SUPPLY_SOURCE = 1 << 16,
  SUPPLY_CENTER = 1 << 17,
  HERO = 1 << 18,
  TRANSPORT = 1 << 19,
  BRIDGE = 1 << 20,
  BRIDGE_TOWER = 1 << 21,
  PROJECTILE = 1 << 22,
  CRATE = 1 << 23,
  MINE = 1 << 24,
  DRONE = 1 << 25,
  GARRISON = 1 << 26,
  SPAWNS_ARE_THE_WEAPONS = 1 << 27,
  PARACHUTABLE = 1 << 28,
  REBUILD_HOLE = 1 << 29,
  STEALTH_GARRISON = 1 << 30,
}

// ============================================================================
// Object status flags — current state of an object
// ============================================================================

export enum ObjectStatus {
  NONE = 0,
  DESTROYED = 1 << 0,
  UNDER_CONSTRUCTION = 1 << 1,
  STEALTHED = 1 << 2,
  DETECTED = 1 << 3,
  POWERED = 1 << 4,
  SOLD = 1 << 5,
  DAMAGED = 1 << 6,
  REALLYDAMAGED = 1 << 7,
  DISABLED = 1 << 8,
  CAPTURED = 1 << 9,
  IS_FIRING_WEAPON = 1 << 10,
  IS_BRAKING = 1 << 11,
  AIRBORNE_TARGET = 1 << 12,
  PARACHUTING = 1 << 13,
  GARRISONED = 1 << 14,
  TOPPLED = 1 << 15,
  BOOBY_TRAPPED = 1 << 16,
  HIJACKED = 1 << 17,
  RIDER1 = 1 << 18,
  RIDER2 = 1 << 19,
  RIDER3 = 1 << 20,
  RIDER4 = 1 << 21,
  RIDER5 = 1 << 22,
  RIDER6 = 1 << 23,
  RIDER7 = 1 << 24,
  RIDER8 = 1 << 25,
}

// ============================================================================
// Damage types
// ============================================================================

export enum DamageType {
  UNRESISTABLE = 'UNRESISTABLE',
  DEFAULT = 'DEFAULT',
  EXPLOSION = 'EXPLOSION',
  CRUSH = 'CRUSH',
  ARMOR_PIERCING = 'ARMOR_PIERCING',
  SMALL_ARMS = 'SMALL_ARMS',
  GATTLING = 'GATTLING',
  RADIATION = 'RADIATION',
  FLAME = 'FLAME',
  LASER = 'LASER',
  SNIPER = 'SNIPER',
  POISON = 'POISON',
  HEALING = 'HEALING',
  WATER = 'WATER',
  DEPLOY = 'DEPLOY',
  SURRENDER = 'SURRENDER',
  HACK = 'HACK',
  KILL_PILOT = 'KILL_PILOT',
  PENALTY = 'PENALTY',
  FALLING = 'FALLING',
  MELEE = 'MELEE',
  DISARM = 'DISARM',
  HAZARD_CLEANUP = 'HAZARD_CLEANUP',
  PARTICLE_BEAM = 'PARTICLE_BEAM',
  TOPPLING = 'TOPPLING',
  INFANTRY_MISSILE = 'INFANTRY_MISSILE',
  AURORA_BOMB = 'AURORA_BOMB',
  LAND_MINE = 'LAND_MINE',
  JET_MISSILES = 'JET_MISSILES',
  STEALTHJET_MISSILES = 'STEALTHJET_MISSILES',
  MOLOTOV_COCKTAIL = 'MOLOTOV_COCKTAIL',
  COMANCHE_VULCAN = 'COMANCHE_VULCAN',
  SUBDUAL_MISSILE = 'SUBDUAL_MISSILE',
  SUBDUAL_VEHICLE = 'SUBDUAL_VEHICLE',
  SUBDUAL_BUILDING = 'SUBDUAL_BUILDING',
  SUBDUAL_UNRESISTABLE = 'SUBDUAL_UNRESISTABLE',
  MICROWAVE = 'MICROWAVE',
  KILL_GARRISONED = 'KILL_GARRISONED',
  STATUS = 'STATUS',
  DETONATION = 'DETONATION',
}

// ============================================================================
// Armor types
// ============================================================================

export enum ArmorType {
  NoArmor = 'NoArmor',
  InvulnerableAllArmor = 'InvulnerableAllArmor',
  TankArmor = 'TankArmor',
  TruckArmor = 'TruckArmor',
  HumveeArmor = 'HumveeArmor',
  AirplaneArmor = 'AirplaneArmor',
  HelicopterArmor = 'HelicopterArmor',
  InfantryArmor = 'InfantryArmor',
  StructureArmor = 'StructureArmor',
  DefaultArmor = 'DefaultArmor',
}

// ============================================================================
// Weapon slot
// ============================================================================

export enum WeaponSlot {
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
  TERTIARY = 'TERTIARY',
}

// ============================================================================
// Locomotor types
// ============================================================================

export enum LocomotorType {
  GROUND = 'GROUND',
  HOVER = 'HOVER',
  AMPHIBIOUS = 'AMPHIBIOUS',
  AIR = 'AIR',
  THRUST = 'THRUST',
  WINGS = 'WINGS',
  CLIMB = 'CLIMB',
}

// ============================================================================
// Player relationships
// ============================================================================

export enum Relationship {
  ENEMIES = 'ENEMIES',
  NEUTRAL = 'NEUTRAL',
  ALLIES = 'ALLIES',
}

// ============================================================================
// Sides (factions)
// ============================================================================

export enum Side {
  AMERICA = 'America',
  CHINA = 'China',
  GLA = 'GLA',
  CIVILIAN = 'Civilian',
  OBSERVER = 'Observer',
}

// ============================================================================
// Game difficulty
// ============================================================================

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
  BRUTAL = 'BRUTAL',
}

// ============================================================================
// Command types (player orders that flow through the command system)
// ============================================================================

export enum CommandType {
  // Movement
  MOVE_TO = 'MOVE_TO',
  ATTACK_MOVE = 'ATTACK_MOVE',
  FORCE_MOVE = 'FORCE_MOVE',
  STOP = 'STOP',
  GUARD = 'GUARD',
  PATROL = 'PATROL',

  // Combat
  ATTACK_OBJECT = 'ATTACK_OBJECT',
  ATTACK_GROUND = 'ATTACK_GROUND',
  FORCE_ATTACK_OBJECT = 'FORCE_ATTACK_OBJECT',
  FORCE_ATTACK_GROUND = 'FORCE_ATTACK_GROUND',

  // Production
  BUILD_UNIT = 'BUILD_UNIT',
  CANCEL_BUILD = 'CANCEL_BUILD',
  BUILD_BUILDING = 'BUILD_BUILDING',
  SELL = 'SELL',
  RESEARCH_UPGRADE = 'RESEARCH_UPGRADE',
  CANCEL_UPGRADE = 'CANCEL_UPGRADE',

  // Abilities
  USE_SPECIAL_POWER = 'USE_SPECIAL_POWER',
  USE_SPECIAL_POWER_AT_OBJECT = 'USE_SPECIAL_POWER_AT_OBJECT',
  USE_SPECIAL_POWER_AT_LOCATION = 'USE_SPECIAL_POWER_AT_LOCATION',

  // Transport / garrison
  ENTER = 'ENTER',
  EXIT = 'EXIT',
  EVACUATE = 'EVACUATE',

  // Misc
  SET_RALLY_POINT = 'SET_RALLY_POINT',
  TOGGLE_OVERCHARGE = 'TOGGLE_OVERCHARGE',
  SET_STANCE = 'SET_STANCE',
  HACK_INTERNET = 'HACK_INTERNET',
  CAPTURE_BUILDING = 'CAPTURE_BUILDING',
  REPAIR = 'REPAIR',
  POWER_TOGGLE = 'POWER_TOGGLE',
  PICK_UP_CRATE = 'PICK_UP_CRATE',
  SELECT_SCIENCE = 'SELECT_SCIENCE',
}

// ============================================================================
// Veterancy levels
// ============================================================================

export enum VeterancyLevel {
  REGULAR = 0,
  VETERAN = 1,
  ELITE = 2,
  HEROIC = 3,
}
