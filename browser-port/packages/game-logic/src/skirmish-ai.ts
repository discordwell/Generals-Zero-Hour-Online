/**
 * Skirmish AI opponent.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameLogic/AI/AIPlayer.cpp
 *   Generals/Code/GameEngine/Include/GameLogic/AI/AIPlayer.h
 *   Generals/Code/GameEngine/Source/GameLogic/AI/AISkirmishPlayer.cpp
 *
 * Implementation: A frame-driven decision loop that evaluates economy, production,
 * and combat at staggered intervals. Issues commands through the same command API
 * used by human players.
 */

import type { GameLogicCommand } from './types.js';

// ──── Evaluation intervals (in logic frames, ~15 FPS) ────────────────────────
const ECONOMY_EVAL_INTERVAL = 30;  // ~2 seconds
const PRODUCTION_EVAL_INTERVAL = 45; // ~3 seconds
const COMBAT_EVAL_INTERVAL = 90;   // ~6 seconds
const STRUCTURE_EVAL_INTERVAL = 60; // ~4 seconds
const DEFENSE_EVAL_INTERVAL = 20;  // ~1.3 seconds
const SCOUT_EVAL_INTERVAL = 150;   // ~10 seconds
const POWER_EVAL_INTERVAL = 45;    // ~3 seconds
const UPGRADE_EVAL_INTERVAL = 120;  // ~8 seconds
const SCIENCE_EVAL_INTERVAL = 150;  // ~10 seconds
const DOZER_EVAL_INTERVAL = 60;     // ~4 seconds
const SPECIAL_POWER_EVAL_INTERVAL = 60; // ~4 seconds

const MIN_ATTACK_FORCE = 4;
const DESIRED_HARVESTERS = 2;
const RETREAT_HEALTH_RATIO = 0.25;
const DEFENSE_RADIUS = 80;

// ──── Entity abstraction ─────────────────────────────────────────────────────

export interface AIEntity {
  id: number;
  templateName: string;
  side?: string;
  x: number;
  z: number;
  destroyed: boolean;
  health: number;
  maxHealth: number;
  kindOf: ReadonlySet<string>;
  moving: boolean;
  attackTargetEntityId: number | null;
  canMove: boolean;
}

// ──── AI context (provided by GameLogicSubsystem) ────────────────────────────

export interface SkirmishAIContext<TEntity extends AIEntity> {
  readonly frameCounter: number;
  readonly spawnedEntities: ReadonlyMap<number, TEntity>;
  readonly aiConfig: {
    readonly resourcesPoor: number;
    readonly resourcesWealthy: number;
  };

  /** Get credits for a side. */
  getSideCredits(side: string): number;

  /** Submit a command. */
  submitCommand(command: GameLogicCommand): void;

  /** Get team relationship between sides: 0=enemies, 1=neutral, 2=allies. */
  getRelationship(sideA: string, sideB: string): number;

  /** Normalize a side string. */
  normalizeSide(side: string | undefined): string;

  /** Check if an entity has a production queue capability. */
  hasProductionQueue(entity: TEntity): boolean;

  /** Check if an entity is currently producing. */
  isProducing(entity: TEntity): boolean;

  /** Get producible unit template names for a factory entity. */
  getProducibleUnits(entity: TEntity): string[];

  /** Get the world map dimensions. */
  getWorldDimensions(): { width: number; depth: number } | null;

  /** Find dozers/workers owned by a side. */
  getDozers(side: string): TEntity[];

  /** Get buildable structure templates for a dozer entity. */
  getBuildableStructures(entity: TEntity): string[];

  /** Check if a dozer is currently constructing. */
  isDozerBusy(entity: TEntity): boolean;

  /** Get power balance (produced minus consumed) for a side. */
  getSidePowerBalance?(side: string): number;

  /** Get researchable upgrade names for a building entity. */
  getResearchableUpgrades?(entity: TEntity): string[];

  /** Check if a side has completed a specific upgrade. */
  hasUpgradeCompleted?(side: string, upgradeName: string): boolean;

  /** Get unspent science purchase (General's) points for a side. */
  getSciencePurchasePoints?(side: string): number;

  /** Get purchasable sciences for a side: {name, cost}[]. */
  getAvailableSciences?(side: string): Array<{ name: string; cost: number }>;

  /** Get ready special powers for a side: powers whose cooldown has expired. */
  getReadySpecialPowers?(side: string): ReadonlyArray<{
    specialPowerName: string;
    sourceEntityId: number;
    commandOption: number;
    commandButtonId: string;
    /** Effect category for targeting logic: AREA_DAMAGE, CASH_HACK, etc. */
    effectCategory: string;
  }>;
}

// ──── Per-AI state ──────────────────────────────────────────────────────────

export interface SkirmishAIState {
  side: string;
  enabled: boolean;
  lastEconomyFrame: number;
  lastProductionFrame: number;
  lastCombatFrame: number;
  lastStructureFrame: number;
  lastDefenseFrame: number;
  lastScoutFrame: number;
  lastPowerFrame: number;
  lastUpgradeFrame: number;
  lastScienceFrame: number;
  lastDozerFrame: number;
  /** Rally point for new units. */
  rallyX: number;
  rallyZ: number;
  /** Known enemy base position (first discovered enemy structure). */
  enemyBaseX: number;
  enemyBaseZ: number;
  enemyBaseKnown: boolean;
  /** Track attack waves sent. */
  attackWavesSent: number;
  /** Build order phase index. */
  buildOrderPhase: number;
  /** Entity ID of active scout (-1 if none). */
  scoutEntityId: number;
  /** Scout exploration waypoints. */
  scoutWaypoints: Array<{ x: number; z: number }>;
  scoutWaypointIndex: number;
  /** Last known base threat frame (for defense response). */
  lastBaseThreatFrame: number;
  /** Track which structure keywords we've built (for rebuild on destruction). */
  builtStructureKeywords: Set<string>;
  /** Track enemy army composition for counter-production. */
  lastEnemyVehicleRatio: number;
  /** Track last production template index for variety. */
  productionRotationIndex: number;
  /** Track which upgrades have been queued to avoid re-queueing. */
  queuedUpgrades: Set<string>;
  /** Track which sciences have been purchased. */
  purchasedSciences: Set<string>;
  /** Entity IDs that have had rally points set. */
  rallyPointEntities: Set<number>;
  /** Last frame special powers were evaluated. */
  lastSpecialPowerFrame: number;
}

function getResourcesPoorThreshold<TEntity extends AIEntity>(
  context: SkirmishAIContext<TEntity>,
): number {
  return context.aiConfig.resourcesPoor;
}

function getResourcesWealthyThreshold<TEntity extends AIEntity>(
  context: SkirmishAIContext<TEntity>,
): number {
  return context.aiConfig.resourcesWealthy;
}

export function createSkirmishAIState(side: string): SkirmishAIState {
  return {
    side,
    enabled: true,
    lastEconomyFrame: 0,
    lastProductionFrame: 0,
    lastCombatFrame: 0,
    lastStructureFrame: 0,
    lastDefenseFrame: 0,
    lastScoutFrame: 0,
    lastPowerFrame: 0,
    lastUpgradeFrame: 0,
    lastScienceFrame: 0,
    lastDozerFrame: 0,
    rallyX: 0,
    rallyZ: 0,
    enemyBaseX: 0,
    enemyBaseZ: 0,
    enemyBaseKnown: false,
    attackWavesSent: 0,
    buildOrderPhase: 0,
    scoutEntityId: -1,
    scoutWaypoints: [],
    scoutWaypointIndex: 0,
    lastBaseThreatFrame: 0,
    builtStructureKeywords: new Set(),
    lastEnemyVehicleRatio: 0.5,
    productionRotationIndex: 0,
    queuedUpgrades: new Set(),
    purchasedSciences: new Set(),
    rallyPointEntities: new Set(),
    lastSpecialPowerFrame: 0,
  };
}

/**
 * Source parity hook: AIPlayer::onStructureProduced callback.
 * Marks matching build-order keywords as produced so rebuild heuristics
 * are immediately aware of newly completed structures.
 */
export function notifyStructureProduced(
  state: SkirmishAIState,
  structureTemplateName: string,
): void {
  const upperTemplate = structureTemplateName.trim().toUpperCase();
  if (!upperTemplate) {
    return;
  }
  for (const keyword of BUILD_ORDER_KEYWORDS) {
    if (upperTemplate.includes(keyword)) {
      state.builtStructureKeywords.add(keyword);
    }
  }
}

// ──── Helper: collect entities by side and criteria ──────────────────────────

function collectEntitiesBySide<TEntity extends AIEntity>(
  entities: ReadonlyMap<number, TEntity>,
  side: string,
  normalizeSide: (s: string | undefined) => string,
  filter?: (entity: TEntity) => boolean,
): TEntity[] {
  const result: TEntity[] = [];
  const normalizedSide = normalizeSide(side);

  for (const entity of entities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (normalizeSide(entity.side) !== normalizedSide) {
      continue;
    }
    if (filter && !filter(entity)) {
      continue;
    }
    result.push(entity);
  }

  return result;
}

function hasKindOf(entity: AIEntity, kind: string): boolean {
  return entity.kindOf.has(kind);
}

function distSquared(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function isNonCombatUnit(entity: AIEntity): boolean {
  const upper = entity.templateName.toUpperCase();
  return hasKindOf(entity, 'HARVESTER')
    || upper.includes('SUPPLY')
    || upper.includes('DOZER')
    || upper.includes('WORKER');
}

function isCombatUnit(entity: AIEntity): boolean {
  return entity.canMove && !hasKindOf(entity, 'STRUCTURE') && !isNonCombatUnit(entity);
}

// ──── Main AI update ────────────────────────────────────────────────────────

export function updateSkirmishAI<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  if (!state.enabled) {
    return;
  }

  const frame = context.frameCounter;

  // Initialize rally point near our base.
  if (state.rallyX === 0 && state.rallyZ === 0) {
    initializeBasePosition(state, context);
  }

  // Discover enemy base position.
  if (!state.enemyBaseKnown) {
    discoverEnemyBase(state, context);
  }

  // Staggered evaluation loops.
  if (frame - state.lastDefenseFrame >= DEFENSE_EVAL_INTERVAL) {
    evaluateDefense(state, context);
    state.lastDefenseFrame = frame;
  }

  if (frame - state.lastPowerFrame >= POWER_EVAL_INTERVAL) {
    evaluatePower(state, context);
    state.lastPowerFrame = frame;
  }

  if (frame - state.lastEconomyFrame >= ECONOMY_EVAL_INTERVAL) {
    evaluateEconomy(state, context);
    state.lastEconomyFrame = frame;
  }

  if (frame - state.lastStructureFrame >= STRUCTURE_EVAL_INTERVAL) {
    evaluateStructures(state, context);
    state.lastStructureFrame = frame;
  }

  if (frame - state.lastProductionFrame >= PRODUCTION_EVAL_INTERVAL) {
    evaluateProduction(state, context);
    state.lastProductionFrame = frame;
  }

  if (frame - state.lastDozerFrame >= DOZER_EVAL_INTERVAL) {
    evaluateDozerReplacement(state, context);
    state.lastDozerFrame = frame;
  }

  if (frame - state.lastUpgradeFrame >= UPGRADE_EVAL_INTERVAL) {
    evaluateUpgrades(state, context);
    state.lastUpgradeFrame = frame;
  }

  if (frame - state.lastScienceFrame >= SCIENCE_EVAL_INTERVAL) {
    evaluateSciences(state, context);
    state.lastScienceFrame = frame;
  }

  if (frame - state.lastScoutFrame >= SCOUT_EVAL_INTERVAL) {
    evaluateScout(state, context);
    state.lastScoutFrame = frame;
  }

  if (frame - state.lastSpecialPowerFrame >= SPECIAL_POWER_EVAL_INTERVAL) {
    evaluateSpecialPowers(state, context);
    state.lastSpecialPowerFrame = frame;
  }

  if (frame - state.lastCombatFrame >= COMBAT_EVAL_INTERVAL) {
    evaluateCombat(state, context);
    state.lastCombatFrame = frame;
  }

  // Source parity: AIPlayer::update() — set rally points on new factories toward enemy.
  if (state.enemyBaseKnown) {
    setFactoryRallyPoints(state, context);
  }
}

// ──── Initialize base position ──────────────────────────────────────────────

function initializeBasePosition<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  // Find our structures to set rally point near base.
  const structures = collectEntitiesBySide(
    context.spawnedEntities,
    state.side,
    context.normalizeSide,
    (e) => hasKindOf(e, 'STRUCTURE'),
  );

  if (structures.length > 0) {
    // Average position of structures = base center.
    let sumX = 0;
    let sumZ = 0;
    for (const s of structures) {
      sumX += s.x;
      sumZ += s.z;
    }
    state.rallyX = sumX / structures.length;
    state.rallyZ = sumZ / structures.length;
  } else {
    // Use any owned unit position as fallback.
    const units = collectEntitiesBySide(
      context.spawnedEntities,
      state.side,
      context.normalizeSide,
    );
    const firstUnit = units[0];
    if (firstUnit) {
      state.rallyX = firstUnit.x;
      state.rallyZ = firstUnit.z;
    }
  }
}

// ──── Discover enemy base ───────────────────────────────────────────────────

function discoverEnemyBase<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const normalizedSide = context.normalizeSide(state.side);

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }

    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) {
      continue;
    }

    // Found an enemy entity — use first enemy structure as base, or any enemy unit.
    if (hasKindOf(entity, 'STRUCTURE')) {
      state.enemyBaseX = entity.x;
      state.enemyBaseZ = entity.z;
      state.enemyBaseKnown = true;
      return;
    }

    // Fallback: use first enemy unit found.
    if (!state.enemyBaseKnown) {
      state.enemyBaseX = entity.x;
      state.enemyBaseZ = entity.z;
      state.enemyBaseKnown = true;
    }
  }
}

// ──── Power management ──────────────────────────────────────────────────────

function evaluatePower<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  // If power balance API is available, check for low power and build power plants.
  if (!context.getSidePowerBalance) return;
  const powerBalance = context.getSidePowerBalance(state.side);
  if (powerBalance >= 0) return;

  // Low power — find an idle dozer and build a power plant.
  const credits = context.getSideCredits(state.side);
  if (credits < 300) return;

  const dozers = context.getDozers(state.side);
  const idleDozer = dozers.find((d) => !context.isDozerBusy(d));
  if (!idleDozer) return;

  const buildable = context.getBuildableStructures(idleDozer);
  const powerTemplate = buildable.find((name) => {
    const upper = name.toUpperCase();
    return upper.includes('POWERPLANT') || upper.includes('REACTOR') || upper.includes('COLDFU');
  });
  if (!powerTemplate) return;

  issueConstructCommand(state, context, idleDozer.id, powerTemplate);
}

// ──── Economy evaluation ────────────────────────────────────────────────────

function evaluateEconomy<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  // Count our harvesters (supply trucks).
  const harvesters = collectEntitiesBySide(
    context.spawnedEntities,
    state.side,
    context.normalizeSide,
    (e) => hasKindOf(e, 'HARVESTER') || e.templateName.toUpperCase().includes('SUPPLY'),
  );

  if (harvesters.length < DESIRED_HARVESTERS) {
    // Find a factory that can produce harvesters (exclude dozers).
    const factories = collectEntitiesBySide(
      context.spawnedEntities,
      state.side,
      context.normalizeSide,
      (e) => context.hasProductionQueue(e) && !context.isProducing(e) && !hasKindOf(e, 'DOZER'),
    );

    for (const factory of factories) {
      const producible = context.getProducibleUnits(factory);
      const harvesterTemplate = producible.find(
        name => name.toUpperCase().includes('SUPPLY') || name.toUpperCase().includes('WORKER'),
      );

      if (harvesterTemplate) {
        context.submitCommand({
          type: 'queueUnitProduction',
          entityId: factory.id,
          unitTemplateName: harvesterTemplate,
        });
        break;
      }
    }
  }

  // Analyze enemy composition for counter-production.
  updateEnemyCompositionAnalysis(state, context);
}

// ──── Enemy composition analysis ─────────────────────────────────────────────

function updateEnemyCompositionAnalysis<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const normalizedSide = context.normalizeSide(state.side);
  let enemyVehicles = 0;
  let enemyInfantry = 0;

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed || !entity.canMove) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;
    if (hasKindOf(entity, 'STRUCTURE') || isNonCombatUnit(entity)) continue;

    if (hasKindOf(entity, 'VEHICLE') || hasKindOf(entity, 'AIRCRAFT')) {
      enemyVehicles++;
    } else {
      enemyInfantry++;
    }
  }

  const total = enemyVehicles + enemyInfantry;
  if (total > 0) {
    state.lastEnemyVehicleRatio = enemyVehicles / total;
  }
}

// ──── Production evaluation ─────────────────────────────────────────────────

function evaluateProduction<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const credits = context.getSideCredits(state.side);
  if (credits < getResourcesPoorThreshold(context)) {
    return; // Save money.
  }

  // Count our combat units (non-structure, non-harvester units that can move).
  const combatUnits = collectEntitiesBySide(
    context.spawnedEntities,
    state.side,
    context.normalizeSide,
    (e) => isCombatUnit(e),
  );

  // Find idle factories (not currently producing). Exclude dozers — they build
  // via constructBuilding, not queueUnitProduction.
  const factories = collectEntitiesBySide(
    context.spawnedEntities,
    state.side,
    context.normalizeSide,
    (e) => context.hasProductionQueue(e) && !context.isProducing(e) && !hasKindOf(e, 'DOZER'),
  );

  if (factories.length === 0) {
    return;
  }

  // Source parity: AI builds more aggressively when wealthy.
  const desiredUnits = credits >= getResourcesWealthyThreshold(context) ? 12 : 8;

  if (combatUnits.length >= desiredUnits) {
    return; // Have enough.
  }

  // Queue units at idle factories.
  for (const factory of factories) {
    if (credits < getResourcesPoorThreshold(context)) {
      break;
    }

    const producible = context.getProducibleUnits(factory);
    // Filter out harvesters/workers.
    const combatTemplates = producible.filter(
      name => !isNonCombatByTemplateName(name),
    );

    if (combatTemplates.length === 0) {
      continue;
    }

    // Select unit based on enemy composition + rotation for variety.
    const selectedTemplate = selectCounterUnit(state, combatTemplates);

    context.submitCommand({
      type: 'queueUnitProduction',
      entityId: factory.id,
      unitTemplateName: selectedTemplate,
    });
  }
}

function isNonCombatByTemplateName(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.includes('SUPPLY') || upper.includes('WORKER') || upper.includes('DOZER');
}

/**
 * Select a unit template with bias toward counter-units based on enemy composition.
 * If enemy has many vehicles, prefer anti-vehicle (missile/rpg/tank) units.
 * If enemy has many infantry, prefer anti-infantry (MG, flame, vehicles) units.
 */
function selectCounterUnit(state: SkirmishAIState, templates: string[]): string {
  // Categorize templates into anti-vehicle and anti-infantry hints.
  const antiVehicle: string[] = [];
  const antiInfantry: string[] = [];
  const general: string[] = [];

  for (const name of templates) {
    const upper = name.toUpperCase();
    if (upper.includes('MISSILE') || upper.includes('RPG') || upper.includes('TANK')
        || upper.includes('HUMVEE') || upper.includes('CRUSADER') || upper.includes('OVERLORD')
        || upper.includes('BATTLEMASTER') || upper.includes('MARAUDER') || upper.includes('SCORPION')) {
      antiVehicle.push(name);
    } else if (upper.includes('RANGER') || upper.includes('MINIGUN')
        || upper.includes('FLASHBANG') || upper.includes('DRAGON')
        || upper.includes('GATLING') || upper.includes('QUAD')) {
      antiInfantry.push(name);
    } else {
      general.push(name);
    }
  }

  // Choose category based on enemy composition.
  let pool: string[];
  if (state.lastEnemyVehicleRatio > 0.6 && antiVehicle.length > 0) {
    pool = antiVehicle;
  } else if (state.lastEnemyVehicleRatio < 0.3 && antiInfantry.length > 0) {
    pool = antiInfantry;
  } else {
    pool = templates; // Balanced — use all.
  }

  // Rotate through pool for variety.
  state.productionRotationIndex++;
  return pool[state.productionRotationIndex % pool.length]!;
}

// ──── Combat evaluation ─────────────────────────────────────────────────────

function evaluateCombat<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  if (!state.enemyBaseKnown) {
    return;
  }

  // Collect idle combat units (not already attacking or moving).
  const idleCombat = collectEntitiesBySide(
    context.spawnedEntities,
    state.side,
    context.normalizeSide,
    (e) => isCombatUnit(e) && e.attackTargetEntityId === null && !e.moving,
  );

  // Only attack with minimum force.
  if (idleCombat.length < MIN_ATTACK_FORCE) {
    return;
  }

  // Find multiple targets for distributed attacks.
  const targets = findMultipleTargets(state, context, 3);
  if (targets.length === 0) {
    return;
  }

  // Distribute units across targets. Focus fire: most units on primary target.
  const primaryTarget = targets[0]!;
  const unitsPerTarget = Math.max(1, Math.floor(idleCombat.length / targets.length));

  let unitIndex = 0;
  for (let t = 0; t < targets.length; t++) {
    const target = targets[t]!;
    // Primary target gets remaining units; secondary targets get even split.
    const unitsForThisTarget = t === 0
      ? Math.max(1, idleCombat.length - unitsPerTarget * (targets.length - 1))
      : unitsPerTarget;

    for (let u = 0; u < unitsForThisTarget && unitIndex < idleCombat.length; u++) {
      const unit = idleCombat[unitIndex]!;
      context.submitCommand({
        type: 'attackEntity',
        entityId: unit.id,
        targetEntityId: target.id,
        commandSource: 'AI',
      });
      unitIndex++;
    }
  }

  // Also issue attack-move toward enemy base for any remaining idle units.
  for (let i = unitIndex; i < idleCombat.length; i++) {
    context.submitCommand({
      type: 'attackMoveTo',
      entityId: idleCombat[i]!.id,
      targetX: primaryTarget.x,
      targetZ: primaryTarget.z,
      attackDistance: 30,
    });
  }

  state.attackWavesSent++;
}

// ──── Find multiple priority attack targets ────────────────────────────────

function findMultipleTargets<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
  maxTargets: number,
): TEntity[] {
  const normalizedSide = context.normalizeSide(state.side);
  const scored: Array<{ entity: TEntity; score: number }> = [];

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;

    let score = 0;

    // Priority scoring: production > defense > economy > other structures > units
    const upper = entity.templateName.toUpperCase();
    if (hasKindOf(entity, 'STRUCTURE')) {
      if (upper.includes('WARFACTORY') || upper.includes('ARMSFACTORY') || upper.includes('BARRACKS')) {
        score += 150; // Production buildings are high priority
      } else if (upper.includes('POWER') || upper.includes('REACTOR')) {
        score += 120; // Power is critical
      } else if (upper.includes('SUPPLY') || upper.includes('COMMAND')) {
        score += 110; // Economy
      } else {
        score += 80;
      }
    } else if (hasKindOf(entity, 'VEHICLE') || hasKindOf(entity, 'AIRCRAFT')) {
      score += 50;
    } else {
      score += 25;
    }

    // Proximity bonus (prefer closer targets).
    const dist = Math.sqrt(distSquared(state.rallyX, state.rallyZ, entity.x, entity.z));
    score -= dist * 0.1;

    // Low health bonus (finish off weak targets).
    if (entity.maxHealth > 0) {
      const healthRatio = entity.health / entity.maxHealth;
      score += (1 - healthRatio) * 40;
    }

    scored.push({ entity, score });
  }

  // Sort by score descending and take top N.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxTargets).map(s => s.entity);
}

// ──── Structure build-order evaluation ────────────────────────────────────────

// Generic build order priorities by keyword match.
// Source parity: AISkirmishPlayer.cpp tracks build list templates.
// Source parity: AIPlayer::m_buildList / SkirmishGameInfo build priorities.
// Keywords match against the buildable template name (case-insensitive).
// Order matters — first unbuilt keyword is built first.
const BUILD_ORDER_KEYWORDS = [
  // Power (USA/China have power plants; GLA doesn't need power)
  'POWERPLANT', 'REACTOR', 'COLDFU',
  // Infantry production
  'BARRACKS', 'ARMSTRAINING',
  // Vehicle/heavy production
  'WARFACTORY', 'ARMSFACTORY', 'ARMSDEALER',
  // Economy
  'SUPPLYC', 'SUPPLYSTASH', 'BLACKMARKET',
  // Tech / advanced
  'AIRFIELD', 'STRATCENTER', 'STRATEGYCENTER', 'INTERNETCENTER',
  'PROPAGANDACENTER', 'PALACE', 'COMMANDCENTER',
  'RADAR',
  // Defense structures (built later).
  'PATRIOT', 'GATTLINGCANNON', 'GATTLING', 'BUNKER',
  'STINGERMISSILE', 'STINGERSITE', 'TUNNELNETWORK',
  'SPEAKERTOWER', 'FIREBASE',
];

const DEFENSE_KEYWORDS = new Set([
  'PATRIOT', 'GATTLINGCANNON', 'GATTLING', 'BUNKER',
  'STINGERMISSILE', 'STINGERSITE', 'TUNNELNETWORK',
  'SPEAKERTOWER', 'FIREBASE',
]);

function evaluateStructures<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const credits = context.getSideCredits(state.side);
  if (credits < getResourcesPoorThreshold(context)) return;

  const dozers = context.getDozers(state.side);
  if (dozers.length === 0) return;

  // Source parity: AIPlayer uses ALL idle dozers for parallel construction.
  const idleDozers = dozers.filter((d) => !context.isDozerBusy(d));
  if (idleDozers.length === 0) return;

  // Check existing structures to determine what we have.
  const ownedStructures = collectEntitiesBySide(
    context.spawnedEntities, state.side, context.normalizeSide,
    (e) => hasKindOf(e, 'STRUCTURE'),
  );
  const ownedNames = new Set(ownedStructures.map((s) => s.templateName.toUpperCase()));

  let dozerIndex = 0;

  // Walk the build order and find structures we don't have.
  for (const keyword of BUILD_ORDER_KEYWORDS) {
    if (dozerIndex >= idleDozers.length) break;

    // Check if we already own a structure matching this keyword.
    let alreadyHave = false;
    for (const name of ownedNames) {
      if (name.includes(keyword)) {
        alreadyHave = true;
        break;
      }
    }
    if (alreadyHave) {
      state.builtStructureKeywords.add(keyword);
      continue;
    }

    // If we already issued a build command for this keyword AND
    // either the structure exists or a dozer is busy building it,
    // skip it. Otherwise allow retry (construction may have failed).
    if (state.builtStructureKeywords.has(keyword)) {
      // Check if any dozer is actively constructing this type
      const anyDozerBuilding = dozers.some((d) => context.isDozerBusy(d));
      if (anyDozerBuilding) continue; // dozer still working on it
      // If the building doesn't exist yet, clear the keyword so we retry
      state.builtStructureKeywords.delete(keyword);
    }
    if (DEFENSE_KEYWORDS.has(keyword) && credits < 800) {
      continue; // Don't build defenses until we can afford them.
    }

    const dozer = idleDozers[dozerIndex]!;
    const buildable = context.getBuildableStructures(dozer);

    // Find a buildable template matching the keyword.
    const template = buildable.find(
      (name) => name.toUpperCase().includes(keyword),
    );
    if (!template) continue;

    issueConstructCommand(state, context, dozer.id, template);
    state.builtStructureKeywords.add(keyword);
    dozerIndex++;
  }

  // If we've built everything in the order, try to build additional defenses when wealthy.
  if (dozerIndex < idleDozers.length && credits >= getResourcesWealthyThreshold(context)) {
    const dozer = idleDozers[dozerIndex]!;
    const buildable = context.getBuildableStructures(dozer);
    const defenseTemplate = buildable.find((name) => {
      const upper = name.toUpperCase();
      return upper.includes('PATRIOT') || upper.includes('GATTLING')
        || upper.includes('BUNKER') || upper.includes('STINGER')
        || upper.includes('TUNNELNETWORK');
    });
    if (defenseTemplate) {
      issueConstructCommand(state, context, dozer.id, defenseTemplate);
    }
  }
}

/** Helper: issue a construct-building command with spiral placement offset. */
function issueConstructCommand<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
  dozerId: number,
  templateName: string,
): void {
  const offsetAngle = state.buildOrderPhase * 0.7;
  const offsetDist = 15 + state.buildOrderPhase * 5;
  const placeX = state.rallyX + Math.cos(offsetAngle) * offsetDist;
  const placeZ = state.rallyZ + Math.sin(offsetAngle) * offsetDist;

  context.submitCommand({
    type: 'constructBuilding',
    entityId: dozerId,
    templateName,
    targetPosition: [placeX, 0, placeZ],
    angle: 0,
    lineEndPosition: null,
  });
  state.buildOrderPhase = (state.buildOrderPhase + 1) % 20;
}

// ──── Defense evaluation (retreat damaged units, defend base) ─────────────────

function evaluateDefense<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const normalizedSide = context.normalizeSide(state.side);

  // Check for enemy units near our base.
  let baseThreat = false;
  let nearestThreatEntity: TEntity | null = null;
  let nearestThreatDistSq = Infinity;

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;

    const distSqToBase = distSquared(state.rallyX, state.rallyZ, entity.x, entity.z);
    if (distSqToBase < DEFENSE_RADIUS * DEFENSE_RADIUS) {
      baseThreat = true;
      if (distSqToBase < nearestThreatDistSq) {
        nearestThreatDistSq = distSqToBase;
        nearestThreatEntity = entity;
      }
    }
  }

  if (baseThreat && nearestThreatEntity) {
    state.lastBaseThreatFrame = context.frameCounter;

    // Rally idle combat units to attack the specific threat.
    const combatUnits = collectEntitiesBySide(
      context.spawnedEntities, state.side, context.normalizeSide,
      (e) => isCombatUnit(e) && e.attackTargetEntityId === null && !e.moving,
    );

    for (const unit of combatUnits) {
      // Direct attack on the nearest threat instead of generic attack-move.
      context.submitCommand({
        type: 'attackEntity',
        entityId: unit.id,
        targetEntityId: nearestThreatEntity.id,
        commandSource: 'AI',
      });
    }
  }

  // Retreat badly damaged units.
  const ownUnits = collectEntitiesBySide(
    context.spawnedEntities, state.side, context.normalizeSide,
    (e) => e.canMove && !hasKindOf(e, 'STRUCTURE'),
  );

  for (const unit of ownUnits) {
    if (unit.maxHealth <= 0) continue;
    const healthRatio = unit.health / unit.maxHealth;
    if (healthRatio < RETREAT_HEALTH_RATIO && unit.attackTargetEntityId !== null) {
      // Retreat to base.
      context.submitCommand({
        type: 'moveTo',
        entityId: unit.id,
        targetX: state.rallyX,
        targetZ: state.rallyZ,
      });
    }
  }
}

// ──── Scouting evaluation ───────────────────────────────────────────────────

function evaluateScout<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  // Initialize scout waypoints if not done.
  if (state.scoutWaypoints.length === 0) {
    const dims = context.getWorldDimensions();
    if (!dims) return;
    const w = dims.width;
    const d = dims.depth;
    // Generate exploration waypoints around the map.
    state.scoutWaypoints = [
      { x: w * 0.25, z: d * 0.25 },
      { x: w * 0.75, z: d * 0.25 },
      { x: w * 0.75, z: d * 0.75 },
      { x: w * 0.25, z: d * 0.75 },
      { x: w * 0.5, z: d * 0.5 },
      { x: w * 0.1, z: d * 0.5 },
      { x: w * 0.9, z: d * 0.5 },
      { x: w * 0.5, z: d * 0.1 },
      { x: w * 0.5, z: d * 0.9 },
    ];
  }

  // Check if current scout is still alive.
  if (state.scoutEntityId >= 0) {
    const scout = context.spawnedEntities.get(state.scoutEntityId);
    if (!scout || scout.destroyed) {
      state.scoutEntityId = -1;
    }
  }

  // Assign a new scout if needed.
  if (state.scoutEntityId < 0) {
    const candidates = collectEntitiesBySide(
      context.spawnedEntities, state.side, context.normalizeSide,
      (e) => isCombatUnit(e) && e.attackTargetEntityId === null && !e.moving,
    );

    if (candidates.length > 0) {
      state.scoutEntityId = candidates[0]!.id;
    }
  }

  // Send scout to next waypoint.
  if (state.scoutEntityId >= 0 && state.scoutWaypoints.length > 0) {
    const scout = context.spawnedEntities.get(state.scoutEntityId);
    if (scout && !scout.destroyed && !scout.moving) {
      const wp = state.scoutWaypoints[state.scoutWaypointIndex % state.scoutWaypoints.length]!;
      context.submitCommand({
        type: 'moveTo',
        entityId: state.scoutEntityId,
        targetX: wp.x,
        targetZ: wp.z,
      });
      state.scoutWaypointIndex++;
    }
  }
}

// ──── Dozer replacement (source parity: AIPlayer::queueDozer) ──────────────

function evaluateDozerReplacement<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const dozers = context.getDozers(state.side);
  if (dozers.length > 0) return;

  // No dozers — queue one from a factory (not a dozer) that can produce them.
  const factories = collectEntitiesBySide(
    context.spawnedEntities, state.side, context.normalizeSide,
    (e) => context.hasProductionQueue(e) && !context.isProducing(e) && !hasKindOf(e, 'DOZER'),
  );

  for (const factory of factories) {
    const producible = context.getProducibleUnits(factory);
    const dozerTemplate = producible.find((name) => {
      const upper = name.toUpperCase();
      return upper.includes('DOZER') || upper.includes('WORKER');
    });
    if (dozerTemplate) {
      context.submitCommand({
        type: 'queueUnitProduction',
        entityId: factory.id,
        unitTemplateName: dozerTemplate,
      });
      return;
    }
  }
}

// ──── Upgrade research (source parity: AIPlayer::doUpgradesAndSkills) ──────

/**
 * Source parity: C++ AIPlayer researches upgrades at buildings when affordable.
 * Prioritizes weapon/armor upgrades, then utility upgrades.
 */
const UPGRADE_PRIORITY_KEYWORDS = [
  'WEAPON', 'ARMOR', 'COMPOSITE', 'TOW', 'LASER', 'FLASHBANG',
  'CHEMICAL', 'ANTHRAX', 'STEALTH', 'CAMO', 'DRONE', 'MINE',
  'SUBLIM', 'PATRIOT', 'CAPTURE',
];

function evaluateUpgrades<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  if (!context.getResearchableUpgrades || !context.hasUpgradeCompleted) return;

  const credits = context.getSideCredits(state.side);
  if (credits < getResourcesPoorThreshold(context)) return;

  // Find buildings with idle production queues.
  const buildings = collectEntitiesBySide(
    context.spawnedEntities, state.side, context.normalizeSide,
    (e) => hasKindOf(e, 'STRUCTURE') && context.hasProductionQueue(e) && !context.isProducing(e),
  );

  for (const building of buildings) {
    const upgrades = context.getResearchableUpgrades(building);
    if (upgrades.length === 0) continue;

    // Filter out already-completed and already-queued upgrades.
    const available = upgrades.filter((name) =>
      !context.hasUpgradeCompleted!(state.side, name) && !state.queuedUpgrades.has(name.toUpperCase()),
    );
    if (available.length === 0) continue;

    // Pick highest-priority upgrade by keyword match.
    let bestUpgrade: string | null = null;
    let bestPriority = UPGRADE_PRIORITY_KEYWORDS.length;

    for (const name of available) {
      const upper = name.toUpperCase();
      let priority = UPGRADE_PRIORITY_KEYWORDS.length; // lowest
      for (let i = 0; i < UPGRADE_PRIORITY_KEYWORDS.length; i++) {
        if (upper.includes(UPGRADE_PRIORITY_KEYWORDS[i]!)) {
          priority = i;
          break;
        }
      }
      if (priority < bestPriority) {
        bestPriority = priority;
        bestUpgrade = name;
      }
    }

    // Fall back to first available if no keyword match.
    if (!bestUpgrade) {
      bestUpgrade = available[0]!;
    }

    context.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: building.id,
      upgradeName: bestUpgrade,
    });
    state.queuedUpgrades.add(bestUpgrade.toUpperCase());
    return; // One upgrade per evaluation cycle to pace spending.
  }
}

// ──── Science purchasing (source parity: AIPlayer::doUpgradesAndSkills) ─────

/**
 * Source parity: C++ AI spends General's points as they become available.
 * Prioritizes combat sciences over utility.
 */
const SCIENCE_PRIORITY_KEYWORDS = [
  'PALADIN', 'STEALTH', 'MOAB', 'LEAFLET', 'A10',
  'NUKE', 'CLUSTER', 'CARPET', 'ANTHRAX', 'CASH_HACK',
  'ARTILLERY', 'REBEL', 'HIJACK', 'BLACK_MARKET',
  'HACKER', 'EMPPULSE',
];

function evaluateSciences<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  if (!context.getSciencePurchasePoints || !context.getAvailableSciences) return;

  const points = context.getSciencePurchasePoints(state.side);
  if (points <= 0) return;

  const available = context.getAvailableSciences(state.side)
    .filter((s) => !state.purchasedSciences.has(s.name.toUpperCase()) && s.cost <= points);
  if (available.length === 0) return;

  // Pick highest-priority science by keyword match.
  let bestScience: { name: string; cost: number } | null = null;
  let bestPriority = SCIENCE_PRIORITY_KEYWORDS.length;

  for (const sci of available) {
    const upper = sci.name.toUpperCase();
    let priority = SCIENCE_PRIORITY_KEYWORDS.length;
    for (let i = 0; i < SCIENCE_PRIORITY_KEYWORDS.length; i++) {
      if (upper.includes(SCIENCE_PRIORITY_KEYWORDS[i]!)) {
        priority = i;
        break;
      }
    }
    if (priority < bestPriority) {
      bestPriority = priority;
      bestScience = sci;
    }
  }

  // Fall back to first available.
  if (!bestScience) {
    bestScience = available[0]!;
  }

  context.submitCommand({
    type: 'purchaseScience',
    scienceName: bestScience.name,
    scienceCost: bestScience.cost,
    side: state.side,
  });
  state.purchasedSciences.add(bestScience.name.toUpperCase());
}

// ──── Special power evaluation ─────────────────────────────────────────────

/**
 * Source parity: C++ AIPlayer uses special powers when available.
 * Area-damage powers target enemy base / concentrations; cash hack targets
 * enemy production buildings; spy vision targets unknown map areas.
 */
function evaluateSpecialPowers<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  if (!context.getReadySpecialPowers) return;
  if (!state.enemyBaseKnown) return;

  const readyPowers = context.getReadySpecialPowers(state.side);
  if (readyPowers.length === 0) return;

  for (const power of readyPowers) {
    const upper = power.effectCategory.toUpperCase();

    // Position-targeted area powers: fire at enemy base or unit concentration.
    if (upper === 'AREA_DAMAGE' || upper === 'EMP_PULSE' || upper === 'OCL_SPAWN') {
      // Find enemy concentration (most clustered group).
      const target = findBestAreaTarget(state, context);
      if (target) {
        context.submitCommand({
          type: 'issueSpecialPower',
          commandButtonId: power.commandButtonId,
          specialPowerName: power.specialPowerName,
          commandOption: power.commandOption,
          issuingEntityIds: [power.sourceEntityId],
          sourceEntityId: power.sourceEntityId,
          targetEntityId: null,
          targetX: target.x,
          targetZ: target.z,
        });
        return; // One power per evaluation cycle.
      }
    }

    // Cash hack: target enemy production buildings.
    if (upper === 'CASH_HACK') {
      const enemyTarget = findEnemyProductionBuilding(state, context);
      if (enemyTarget) {
        context.submitCommand({
          type: 'issueSpecialPower',
          commandButtonId: power.commandButtonId,
          specialPowerName: power.specialPowerName,
          commandOption: power.commandOption,
          issuingEntityIds: [power.sourceEntityId],
          sourceEntityId: power.sourceEntityId,
          targetEntityId: enemyTarget.id,
          targetX: null,
          targetZ: null,
        });
        return;
      }
    }

    // Defector: target highest-value enemy unit.
    if (upper === 'DEFECTOR') {
      const highValueTarget = findHighValueEnemyUnit(state, context);
      if (highValueTarget) {
        context.submitCommand({
          type: 'issueSpecialPower',
          commandButtonId: power.commandButtonId,
          specialPowerName: power.specialPowerName,
          commandOption: power.commandOption,
          issuingEntityIds: [power.sourceEntityId],
          sourceEntityId: power.sourceEntityId,
          targetEntityId: highValueTarget.id,
          targetX: null,
          targetZ: null,
        });
        return;
      }
    }

    // Spy vision: reveal enemy base area.
    if (upper === 'SPY_VISION') {
      context.submitCommand({
        type: 'issueSpecialPower',
        commandButtonId: power.commandButtonId,
        specialPowerName: power.specialPowerName,
        commandOption: power.commandOption,
        issuingEntityIds: [power.sourceEntityId],
        sourceEntityId: power.sourceEntityId,
        targetEntityId: null,
        targetX: state.enemyBaseX,
        targetZ: state.enemyBaseZ,
      });
      return;
    }

    // Area heal: target our own base.
    if (upper === 'AREA_HEAL') {
      context.submitCommand({
        type: 'issueSpecialPower',
        commandButtonId: power.commandButtonId,
        specialPowerName: power.specialPowerName,
        commandOption: power.commandOption,
        issuingEntityIds: [power.sourceEntityId],
        sourceEntityId: power.sourceEntityId,
        targetEntityId: null,
        targetX: state.rallyX,
        targetZ: state.rallyZ,
      });
      return;
    }

    // No-target powers (cash bounty, generic): just fire them.
    if (upper === 'CASH_BOUNTY' || upper === 'GENERIC') {
      context.submitCommand({
        type: 'issueSpecialPower',
        commandButtonId: power.commandButtonId,
        specialPowerName: power.specialPowerName,
        commandOption: power.commandOption,
        issuingEntityIds: [power.sourceEntityId],
        sourceEntityId: power.sourceEntityId,
        targetEntityId: null,
        targetX: null,
        targetZ: null,
      });
      return;
    }
  }
}

/** Find best area target: cluster of enemy entities near a central point. */
function findBestAreaTarget<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): { x: number; z: number } | null {
  const normalizedSide = context.normalizeSide(state.side);
  const enemies: Array<{ x: number; z: number }> = [];

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;
    enemies.push({ x: entity.x, z: entity.z });
  }

  if (enemies.length === 0) return null;

  // Find the centroid of the largest cluster (simplified: average position of
  // enemies near the enemy base, or overall centroid if no base known).
  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  const clusterRadiusSq = 100 * 100;

  for (const e of enemies) {
    const dSq = distSquared(e.x, e.z, state.enemyBaseX, state.enemyBaseZ);
    if (dSq <= clusterRadiusSq) {
      sumX += e.x;
      sumZ += e.z;
      count++;
    }
  }

  if (count >= 2) {
    return { x: sumX / count, z: sumZ / count };
  }

  // Fallback to enemy base position.
  return { x: state.enemyBaseX, z: state.enemyBaseZ };
}

/** Find an enemy production building for cash hack targeting. */
function findEnemyProductionBuilding<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): TEntity | null {
  const normalizedSide = context.normalizeSide(state.side);

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;
    if (!hasKindOf(entity, 'STRUCTURE')) continue;
    // Prefer supply/command centers for cash hack.
    const upper = entity.templateName.toUpperCase();
    if (upper.includes('SUPPLY') || upper.includes('COMMAND')) {
      return entity;
    }
  }

  // Fallback: any enemy structure.
  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;
    if (hasKindOf(entity, 'STRUCTURE')) return entity;
  }
  return null;
}

/** Find highest-value enemy unit for defector targeting. */
function findHighValueEnemyUnit<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): TEntity | null {
  const normalizedSide = context.normalizeSide(state.side);
  let best: TEntity | null = null;
  let bestHealth = 0;

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed || !entity.canMove) continue;
    const entitySide = context.normalizeSide(entity.side);
    if (context.getRelationship(normalizedSide, entitySide) !== 0) continue;
    if (hasKindOf(entity, 'STRUCTURE')) continue;
    // Prefer high-health (expensive) units.
    if (entity.maxHealth > bestHealth) {
      bestHealth = entity.maxHealth;
      best = entity;
    }
  }
  return best;
}

// ──── Rally point management ────────────────────────────────────────────────

/**
 * Source parity: AI sets rally points on production buildings toward the enemy base.
 * This ensures newly produced units automatically move toward the fight.
 */
function setFactoryRallyPoints<TEntity extends AIEntity>(
  state: SkirmishAIState,
  context: SkirmishAIContext<TEntity>,
): void {
  const factories = collectEntitiesBySide(
    context.spawnedEntities, state.side, context.normalizeSide,
    (e) => hasKindOf(e, 'STRUCTURE') && context.hasProductionQueue(e),
  );

  for (const factory of factories) {
    if (state.rallyPointEntities.has(factory.id)) continue;
    // Set rally point between our base and enemy base (30% toward enemy).
    const rallyX = factory.x + (state.enemyBaseX - factory.x) * 0.3;
    const rallyZ = factory.z + (state.enemyBaseZ - factory.z) * 0.3;
    context.submitCommand({
      type: 'setRallyPoint',
      entityId: factory.id,
      targetX: rallyX,
      targetZ: rallyZ,
    });
    state.rallyPointEntities.add(factory.id);
  }
}
