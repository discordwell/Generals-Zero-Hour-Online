/**
 * Special power execution effects.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/OCLSpecialPower.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/CashHackSpecialPower.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/DefectorSpecialPower.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/SpyVisionSpecialPower.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/CashBountyPower.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/DemoralizeSpecialPower.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/SpecialPower/CleanupAreaPower.cpp
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/SpecialPower/FireWeaponPower.cpp
 *
 * In the original engine, most destructive powers use OCL (Object Creation List)
 * to spawn projectiles which deal damage via weapon templates. Since we don't have
 * a full OCL pipeline yet, area-damage powers apply damage directly in a radius.
 */

// ──── Effect context (provided by GameLogicSubsystem) ────────────────────────

export interface SpecialPowerEntity {
  id: number;
  side?: string;
  x: number;
  z: number;
  destroyed: boolean;
  health: number;
  maxHealth: number;
  canTakeDamage: boolean;
  kindOf: ReadonlySet<string>;
}

export interface SpecialPowerEffectContext<TEntity extends SpecialPowerEntity> {
  readonly spawnedEntities: ReadonlyMap<number, TEntity>;

  /** Apply raw damage to target (handles armor, death). */
  applyDamage(sourceEntityId: number | null, target: TEntity, amount: number, damageType: string): void;

  /** Heal target entity. */
  healEntity(target: TEntity, amount: number): void;

  /** Deposit credits to a side. */
  depositCredits(side: string, amount: number): void;

  /** Withdraw credits from a side. Returns amount actually withdrawn. */
  withdrawCredits(side: string, amount: number): number;

  /** Change an entity's side (defect). */
  changeEntitySide(entityId: number, newSide: string, undetectedDefectorFrames?: number): void;

  /** Destroy an entity. */
  destroyEntity(entityId: number, attackerId: number): void;

  /** Get team relationship: 0=enemies, 1=neutral, 2=allies. */
  getRelationship(sideA: string, sideB: string): number;

  /** Reveal fog of war at position for a side. durationMs=0 means default (~30s). */
  revealFogOfWar(side: string, worldX: number, worldZ: number, radius: number, durationMs?: number): void;

  /** Normalize a side string. */
  normalizeSide(side: string | undefined): string;
}

// ──── Distance helper ────────────────────────────────────────────────────────

function distSquared(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// ──── Effect: Area damage (A10 Strike, Carpet Bomb, Artillery Barrage, etc.) ─

export interface AreaDamageParams {
  sourceEntityId: number | null;
  sourceSide: string;
  targetX: number;
  targetZ: number;
  radius: number;
  damage: number;
  damageType: string;
}

/**
 * Apply damage to all enemy entities within a radius of a target position.
 * Source parity: OCLSpecialPower triggers weapon projectiles which call
 * DamageModule; we skip the projectile step and apply damage directly.
 */
export function executeAreaDamage<TEntity extends SpecialPowerEntity>(
  params: AreaDamageParams,
  context: SpecialPowerEffectContext<TEntity>,
): void {
  const radiusSq = params.radius * params.radius;
  const sourceSide = context.normalizeSide(params.sourceSide);

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed || !entity.canTakeDamage) {
      continue;
    }

    const entitySide = context.normalizeSide(entity.side);
    // Only damage enemies.
    if (context.getRelationship(sourceSide, entitySide) !== 0) {
      continue;
    }

    const dSq = distSquared(entity.x, entity.z, params.targetX, params.targetZ);
    if (dSq <= radiusSq) {
      context.applyDamage(params.sourceEntityId, entity, params.damage, params.damageType);
    }
  }
}

// ──── Effect: Cash Hack (steal credits from enemy) ───────────────────────────

export interface CashHackParams {
  sourceEntityId: number;
  sourceSide: string;
  targetEntityId: number;
  amountToSteal: number;
}

/**
 * Steal credits from an enemy entity's owning side.
 * Source parity: CashHackSpecialPower.cpp lines 130-179
 * Steals min(amountToSteal, target's available funds).
 */
export function executeCashHack<TEntity extends SpecialPowerEntity>(
  params: CashHackParams,
  context: SpecialPowerEffectContext<TEntity>,
): number {
  const target = context.spawnedEntities.get(params.targetEntityId);
  if (!target || target.destroyed) {
    return 0;
  }

  const targetSide = context.normalizeSide(target.side);
  const sourceSide = context.normalizeSide(params.sourceSide);

  // Must be enemy.
  if (context.getRelationship(sourceSide, targetSide) !== 0) {
    return 0;
  }

  const stolen = context.withdrawCredits(targetSide, params.amountToSteal);
  if (stolen > 0) {
    context.depositCredits(sourceSide, stolen);
  }
  return stolen;
}

// ──── Effect: Defector (convert enemy unit) ──────────────────────────────────

export interface DefectorParams {
  sourceEntityId: number;
  sourceSide: string;
  targetEntityId: number;
  detectionFrames: number;
}

/**
 * Convert an enemy unit to the attacker's side.
 * Source parity: DefectorSpecialPower.cpp lines 103-135
 */
export function executeDefector<TEntity extends SpecialPowerEntity>(
  params: DefectorParams,
  context: SpecialPowerEffectContext<TEntity>,
): boolean {
  const target = context.spawnedEntities.get(params.targetEntityId);
  if (!target || target.destroyed) {
    return false;
  }

  const targetSide = context.normalizeSide(target.side);
  const sourceSide = context.normalizeSide(params.sourceSide);

  // Must be enemy.
  if (context.getRelationship(sourceSide, targetSide) !== 0) {
    return false;
  }

  context.changeEntitySide(params.targetEntityId, sourceSide, params.detectionFrames);
  return true;
}

// ──── Effect: Spy Vision / CIA Intelligence (reveal fog of war) ──────────────

export interface SpyVisionParams {
  sourceSide: string;
  targetX: number;
  targetZ: number;
  revealRadius: number;
  /** Duration in milliseconds (0 = use default ~30s). */
  durationMs: number;
}

/**
 * Reveal fog of war around a target position for a side.
 * Source parity: SpyVisionSpecialPower.cpp — activates SpyVisionUpdate module
 * which reveals enemy positions. We simplify to direct fog reveal with duration.
 */
export function executeSpyVision<TEntity extends SpecialPowerEntity>(
  params: SpyVisionParams,
  context: SpecialPowerEffectContext<TEntity>,
): void {
  context.revealFogOfWar(params.sourceSide, params.targetX, params.targetZ, params.revealRadius, params.durationMs);
}

// ──── Effect: Area Heal (Repair vehicles, Emergency Repair, etc.) ────────────

export interface AreaHealParams {
  sourceSide: string;
  targetX: number;
  targetZ: number;
  radius: number;
  healAmount: number;
  /** Only heal entities with these KindOf flags (e.g., ['VEHICLE']). Empty = all allies. */
  kindOfFilter: string[];
}

/**
 * Heal allied entities within a radius.
 * Source parity: CleanupAreaPower / Emergency Repair patterns.
 */
export function executeAreaHeal<TEntity extends SpecialPowerEntity>(
  params: AreaHealParams,
  context: SpecialPowerEffectContext<TEntity>,
): void {
  const radiusSq = params.radius * params.radius;
  const sourceSide = context.normalizeSide(params.sourceSide);

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }

    const entitySide = context.normalizeSide(entity.side);
    // Only heal allies.
    if (context.getRelationship(sourceSide, entitySide) !== 2) {
      continue;
    }

    // Apply KindOf filter if specified.
    if (params.kindOfFilter.length > 0) {
      const hasKind = params.kindOfFilter.some(k => entity.kindOf.has(k));
      if (!hasKind) {
        continue;
      }
    }

    const dSq = distSquared(entity.x, entity.z, params.targetX, params.targetZ);
    if (dSq <= radiusSq) {
      context.healEntity(entity, params.healAmount);
    }
  }
}

// ──── Effect: EMP (disable vehicles in area) ─────────────────────────────────

export interface EmpPulseParams {
  sourceEntityId: number | null;
  sourceSide: string;
  targetX: number;
  targetZ: number;
  radius: number;
  /** Damage to apply (EMP also deals some damage). */
  damage: number;
}

/**
 * EMP: Damage enemy vehicles in an area.
 * Source parity: The EMP in the original uses an OCL to create an EMP object
 * which fires a weapon with EMP damage type. We apply DISARM damage directly.
 */
export function executeEmpPulse<TEntity extends SpecialPowerEntity>(
  params: EmpPulseParams,
  context: SpecialPowerEffectContext<TEntity>,
): void {
  executeAreaDamage({
    sourceEntityId: params.sourceEntityId,
    sourceSide: params.sourceSide,
    targetX: params.targetX,
    targetZ: params.targetZ,
    radius: params.radius,
    damage: params.damage,
    damageType: 'EMP',
  }, context);
}

// ──── Module type → effect routing ───────────────────────────────────────────

/**
 * Known special power module types and the effect categories they map to.
 * Source parity: The moduleType field from INI Behavior blocks tells us what
 * kind of special power this is. We route to the appropriate effect handler.
 */
export const MODULE_TYPE_EFFECTS: Record<string, string> = {
  // OCL-based powers — execute ObjectCreationList at source, FireWeapon at target.
  // Falls back to AREA_DAMAGE if no OCL name is available.
  OCLSPECIALPOWER: 'OCL_SPAWN',
  // Cash hack / steal
  CASHHACKSPECIALPOWER: 'CASH_HACK',
  // Defector
  DEFECTORSPECIALPOWER: 'DEFECTOR',
  // Spy vision
  SPYVISIONSPECIALPOWER: 'SPY_VISION',
  // Cash bounty (passive, handled at game level)
  CASHBOUNTYPOWER: 'CASH_BOUNTY',
  // Cleanup area
  CLEANUPAREAPOWER: 'AREA_HEAL',
  // Fire weapon power (Zero Hour) — issues attack using entity's existing weapon set
  FIREWEAPONPOWER: 'FIRE_WEAPON',
  // Demoralize
  DEMORALIZESPECIALPOWER: 'AREA_DAMAGE',
  // EMP pulse (China general)
  EMPSPECIALPOWER: 'EMP_PULSE',
  // Generic special ability
  SPECIALABILITY: 'GENERIC',
  // Generic special power module
  SPECIALPOWERMODULE: 'GENERIC',
};

/**
 * Resolve the effect category for a module type string.
 */
export function resolveEffectCategory(moduleType: string): string {
  const normalized = moduleType.toUpperCase().replace(/\s+/g, '');
  return MODULE_TYPE_EFFECTS[normalized] ?? 'GENERIC';
}

// ──── Default power parameters (from INI GlobalData/common values) ───────────
// These are reasonable defaults when INI doesn't specify exact values.

export const DEFAULT_AREA_DAMAGE_RADIUS = 100;
export const DEFAULT_AREA_DAMAGE_AMOUNT = 500;
export const DEFAULT_CASH_HACK_AMOUNT = 1000;
export const DEFAULT_SPY_VISION_RADIUS = 200;
export const DEFAULT_AREA_HEAL_AMOUNT = 200;
export const DEFAULT_AREA_HEAL_RADIUS = 100;
export const DEFAULT_EMP_RADIUS = 80;
export const DEFAULT_EMP_DAMAGE = 200;
