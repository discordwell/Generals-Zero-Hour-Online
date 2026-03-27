/**
 * Supply chain economy — harvester/warehouse/supply-center gather–deposit cycle.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/DockUpdate/SupplyWarehouseDockUpdate.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/SupplyTruckAIUpdate.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/DockUpdate/SupplyCenterDockUpdate.cpp
 *   Generals/Code/GameEngine/Source/Common/RTS/Player.cpp — getSupplyBoxValue()
 *   Generals/Code/GameEngine/Source/Common/GlobalData.cpp — m_baseValuePerSupplyBox = 100
 */

// Source parity: default from GlobalData.cpp:747
export const DEFAULT_SUPPLY_BOX_VALUE = 100;

// ──── Supply truck AI state machine ────────────────────────────────────────
export const enum SupplyTruckAIState {
  /** No orders — look for nearest warehouse with boxes. */
  IDLE = 0,
  /** Moving towards a supply warehouse to pick up boxes. */
  APPROACHING_WAREHOUSE = 1,
  /** Docked at warehouse, picking up boxes (1 per action delay). */
  GATHERING = 2,
  /** Moving towards supply center to deposit boxes. */
  APPROACHING_DEPOT = 3,
  /** Docked at supply center, depositing boxes → money. */
  DEPOSITING = 4,
  /** Waiting because no warehouse or depot is available. */
  WAITING = 5,
}

type SupplyChainRelationship = 'enemies' | 'neutral' | 'allies';
type SupplyChainShroudStatus = 'CLEAR' | 'FOGGED' | 'SHROUDED';

// ──── Profile interfaces (extracted from INI Behavior blocks) ──────────────
export interface SupplyWarehouseProfile {
  startingBoxes: number;
  deleteWhenEmpty: boolean;
  /** Source parity: DockUpdate base — number of docking slots. -1 = unlimited. C++ default: -1. */
  numberApproachPositions: number;
  /** Source parity: DockUpdate base — can entities pass through while docking. C++ default: FALSE. */
  allowsPassthrough: boolean;
}

export interface SupplyTruckProfile {
  maxBoxes: number;
  supplyCenterActionDelayFrames: number;
  supplyWarehouseActionDelayFrames: number;
  supplyWarehouseScanDistance: number;
  /** Source parity: ChinookAIUpdate::m_upgradedSupplyBoost. */
  upgradedSupplyBoost: number;
}

// Source parity: DockUpdate::isClearToApproach — maximum concurrent approach slots.
// C++ ResourceGatheringManager::computeRelativeCost checks DockUpdate::isClearToApproach.
export const DEFAULT_MAX_APPROACH_SLOTS = 3;

// ──── Per-entity runtime state ─────────────────────────────────────────────
export interface SupplyWarehouseState {
  currentBoxes: number;
}

/** Tracks how many trucks are currently approaching/docking at a supply entity. */
export interface DockApproachState {
  currentDockerCount: number;
  maxDockers: number;
}

export interface SupplyTruckState {
  aiState: SupplyTruckAIState;
  currentBoxes: number;
  targetWarehouseId: number | null;
  targetDepotId: number | null;
  actionDelayFinishFrame: number;
  /** Source parity: SupplyTruckAIUpdate::m_preferredDock. */
  preferredDockId: number | null;
  /** Source parity: SupplyTruckAIUpdate::m_forcePending (busy latch from player stop). */
  forceBusy: boolean;
}

// ──── Entity abstraction for supply chain logic ────────────────────────────
export interface SupplyChainEntity {
  id: number;
  side?: string;
  x: number;
  z: number;
  destroyed: boolean;
  moving: boolean;
  moveTarget: { x: number; z: number } | null;
  /** Optional object status flags from the simulation layer. */
  objectStatusFlags?: ReadonlySet<string>;
}

// ──── Context interface (provided by GameLogicSubsystem) ───────────────────
export interface SupplyChainContext<TEntity extends SupplyChainEntity> {
  readonly frameCounter: number;
  readonly spawnedEntities: ReadonlyMap<number, TEntity>;

  /** Resolve the INI-based warehouse profile for an entity. Null → not a warehouse. */
  getWarehouseProfile(entity: TEntity): SupplyWarehouseProfile | null;
  /** Resolve the INI-based truck profile for an entity. Null → not a truck. */
  getTruckProfile(entity: TEntity): SupplyTruckProfile | null;
  /** Check if an entity is a supply center (has SupplyCenterDockUpdate). */
  isSupplyCenter(entity: TEntity): boolean;
  /** Source parity: DockUpdateInterface::isDockCrippled — warehouse disabled at REALLYDAMAGED. */
  isWarehouseDockCrippled(entity: TEntity): boolean;

  /** Get/set warehouse runtime state. */
  getWarehouseState(entityId: number): SupplyWarehouseState | undefined;
  setWarehouseState(entityId: number, state: SupplyWarehouseState): void;

  /** Get/set truck runtime state. */
  getTruckState(entityId: number): SupplyTruckState | undefined;
  setTruckState(entityId: number, state: SupplyTruckState): void;

  /** Deposit credits to a side. */
  depositCredits(side: string, amount: number): void;
  /** Source parity: SupplyCenterDockUpdate adds truck-specific boost on deposit. */
  getSupplyTruckDepositBoost(truck: TEntity, profile: SupplyTruckProfile): number;
  /** Source parity: SupplyTruckAIUpdate::getWarehouseScanDistance (AI uses larger scan range). */
  getSupplyTruckScanDistance?: (truck: TEntity, profile: SupplyTruckProfile) => number;
  /** Source parity: ActionManager::canTransferSuppliesAt uses relationship checks. */
  getRelationship: (sideA: string, sideB: string) => SupplyChainRelationship;
  /** Source parity: ActionManager::canTransferSuppliesAt shroud gating for human players. */
  getSidePlayerType: (side: string) => 'HUMAN' | 'COMPUTER';
  /** Source parity: ActionManager::canTransferSuppliesAt shroud gating. */
  getEntityShroudStatus: (entity: TEntity, side: string) => SupplyChainShroudStatus;
  /** Optional availability check (ex: Chinook supply availability). */
  isSupplyTruckAvailable?: (truck: TEntity) => boolean;

  /** Issue a move-to command for an entity. */
  moveEntityTo(entityId: number, targetX: number, targetZ: number): void;

  /**
   * Source parity: SupplyTruckAIUpdate::RegroupingState::onEnter.
   * Optional fallback regroup location when no legal supply dock can be found.
   */
  findRegroupPosition?: (
    truck: TEntity,
    carryingBoxes: boolean,
  ) => { x: number; z: number } | null;

  /** Source parity: DockUpdate::isClearToApproach — per-dock approach slot tracking. */
  getDockApproachState(entityId: number): DockApproachState | undefined;
  setDockApproachState(entityId: number, state: DockApproachState): void;

  /** Mark an entity for destruction. */
  destroyEntity(entityId: number): void;

  /** Normalize side string. */
  normalizeSide(side: string | undefined): string;

  /** Value per supply box for this context (from INI GlobalData or default). */
  readonly supplyBoxValue: number;

  /**
   * Source parity: SupplyCenterDockUpdate::action() — after deposit, grant temporary stealth
   * to the supply truck if the supply center has grantTemporaryStealthFrames > 0 AND the
   * supply center itself is currently stealthed. ZH-only feature.
   */
  grantTemporaryStealth?: (entityId: number, frames: number) => void;

  /** Check if an entity is currently stealthed. */
  isEntityStealthed?: (entity: TEntity) => boolean;

  /** Get grantTemporaryStealthFrames for a supply center entity. 0 = no stealth grant. */
  getGrantTemporaryStealthFrames?: (entity: TEntity) => number;
}

// ──── Distance helpers ─────────────────────────────────────────────────────
function distSquared(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

const DOCK_PROXIMITY_THRESHOLD_SQ = 25 * 25; // 25 world-units arrival radius

function hasObjectStatus(entity: SupplyChainEntity, flag: string): boolean {
  return entity.objectStatusFlags ? entity.objectStatusFlags.has(flag) : false;
}

function ensureDockApproachState<TEntity extends SupplyChainEntity>(
  dock: TEntity,
  context: SupplyChainContext<TEntity>,
): DockApproachState {
  let approachState = context.getDockApproachState(dock.id);
  if (!approachState) {
    approachState = { currentDockerCount: 0, maxDockers: DEFAULT_MAX_APPROACH_SLOTS };
    context.setDockApproachState(dock.id, approachState);
  }
  return approachState;
}

function isDockFull<TEntity extends SupplyChainEntity>(
  dock: TEntity,
  context: SupplyChainContext<TEntity>,
): boolean {
  const approachState = context.getDockApproachState(dock.id);
  if (!approachState) {
    return false; // No state yet → no dockers → not full.
  }
  return approachState.currentDockerCount >= approachState.maxDockers;
}

function incrementDockerCount<TEntity extends SupplyChainEntity>(
  dock: TEntity,
  context: SupplyChainContext<TEntity>,
): void {
  const approachState = ensureDockApproachState(dock, context);
  approachState.currentDockerCount++;
  context.setDockApproachState(dock.id, approachState);
}

function decrementDockerCount<TEntity extends SupplyChainEntity>(
  dock: TEntity,
  context: SupplyChainContext<TEntity>,
): void {
  const approachState = context.getDockApproachState(dock.id);
  if (approachState && approachState.currentDockerCount > 0) {
    approachState.currentDockerCount--;
    context.setDockApproachState(dock.id, approachState);
  }
}

function isSupplyTransferShrouded<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  dock: TEntity,
  context: SupplyChainContext<TEntity>,
): boolean {
  const truckSide = context.normalizeSide(truck.side);
  if (!truckSide) {
    return false;
  }
  if (context.getSidePlayerType(truckSide) !== 'HUMAN') {
    return false;
  }
  return context.getEntityShroudStatus(dock, truckSide) === 'SHROUDED';
}

/**
 * Source parity: ActionManager::canTransferSuppliesAt.
 */
function canTransferSuppliesAt<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  dock: TEntity,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): boolean {
  if (truck.destroyed || dock.destroyed) return false;
  if (hasObjectStatus(truck, 'UNDER_CONSTRUCTION') || hasObjectStatus(dock, 'UNDER_CONSTRUCTION')) {
    return false;
  }
  if (hasObjectStatus(dock, 'SOLD')) {
    return false;
  }

  const isWarehouse = context.getWarehouseProfile(dock) !== null;
  const isCenter = context.isSupplyCenter(dock);
  if (!isWarehouse && !isCenter) {
    return false;
  }

  if (context.isSupplyTruckAvailable && !context.isSupplyTruckAvailable(truck)) {
    return false;
  }

  if (isWarehouse) {
    const warehouseState = context.getWarehouseState(dock.id);
    if (!warehouseState || warehouseState.currentBoxes <= 0) {
      return false;
    }
    const truckSide = context.normalizeSide(truck.side);
    const dockSide = context.normalizeSide(dock.side);
    if (truckSide && dockSide) {
      if (context.getRelationship(truckSide, dockSide) === 'enemies') {
        return false;
      }
    }
  }

  if (isCenter) {
    if (state.currentBoxes <= 0) {
      return false;
    }
    const truckSide = context.normalizeSide(truck.side);
    const dockSide = context.normalizeSide(dock.side);
    if (!truckSide || !dockSide || dockSide !== truckSide) {
      return false;
    }
  }

  if (isSupplyTransferShrouded(truck, dock, context)) {
    return false;
  }

  return true;
}

function computeRelativeCost<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  dock: TEntity,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): { cost: number; distanceSq: number } | null {
  if (!canTransferSuppliesAt(truck, dock, state, context)) {
    return null;
  }
  // Source parity: ResourceGatheringManager::computeRelativeCost checks
  // DockUpdate::isClearToApproach — skip docks that are full.
  if (isDockFull(dock, context)) {
    return null;
  }
  const distanceSq = distSquared(truck.x, truck.z, dock.x, dock.z);
  return { cost: distanceSq, distanceSq };
}

// ──── Find nearest warehouse with boxes within scan distance ───────────────
export function findNearestWarehouseWithBoxes<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  scanDistance: number,
  context: SupplyChainContext<TEntity>,
  state?: SupplyTruckState,
): TEntity | null {
  const truckState = state ?? context.getTruckState(truck.id);
  if (!truckState) {
    return null;
  }

  if (truckState.preferredDockId !== null) {
    const preferred = context.spawnedEntities.get(truckState.preferredDockId);
    if (preferred && !preferred.destroyed && context.getWarehouseProfile(preferred)) {
      if (canTransferSuppliesAt(truck, preferred, truckState, context) && !isDockFull(preferred, context)) {
        return preferred;
      }
    }
  }

  const scanDistSq = scanDistance * scanDistance;
  let bestEntity: TEntity | null = null;
  let bestCost = Infinity;

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }

    const profile = context.getWarehouseProfile(entity);
    if (!profile) {
      continue;
    }
    // Source parity: DockUpdateInterface::isDockCrippled — skip heavily damaged warehouses.
    if (context.isWarehouseDockCrippled(entity)) {
      continue;
    }

    const cost = computeRelativeCost(truck, entity, truckState, context);
    if (!cost) {
      continue;
    }
    if (cost.distanceSq > scanDistSq) {
      continue;
    }
    if (cost.cost < bestCost) {
      bestCost = cost.cost;
      bestEntity = entity;
    }
  }

  return bestEntity;
}

// ──── Find nearest supply center ───────────────────────────────────────────
export function findNearestSupplyCenter<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  context: SupplyChainContext<TEntity>,
  state?: SupplyTruckState,
): TEntity | null {
  const truckState = state ?? context.getTruckState(truck.id);
  if (!truckState) {
    return null;
  }

  if (truckState.preferredDockId !== null) {
    const preferred = context.spawnedEntities.get(truckState.preferredDockId);
    if (preferred && !preferred.destroyed && context.isSupplyCenter(preferred)) {
      if (canTransferSuppliesAt(truck, preferred, truckState, context) && !isDockFull(preferred, context)) {
        return preferred;
      }
    }
  }

  let bestEntity: TEntity | null = null;
  let bestCost = Infinity;

  for (const entity of context.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    if (!context.isSupplyCenter(entity)) {
      continue;
    }

    const cost = computeRelativeCost(truck, entity, truckState, context);
    if (!cost) {
      continue;
    }
    if (cost.cost < bestCost) {
      bestCost = cost.cost;
      bestEntity = entity;
    }
  }

  return bestEntity;
}

// ──── Check if entity has arrived near target ──────────────────────────────
function isNearTarget(entity: SupplyChainEntity, targetEntity: SupplyChainEntity): boolean {
  return distSquared(entity.x, entity.z, targetEntity.x, targetEntity.z) <= DOCK_PROXIMITY_THRESHOLD_SQ;
}

// ──── Main per-frame update for a single supply truck ──────────────────────
export function updateSupplyTruck<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  truckProfile: SupplyTruckProfile,
  context: SupplyChainContext<TEntity>,
): void {
  let state = context.getTruckState(truck.id);
  if (!state) {
    state = {
      aiState: SupplyTruckAIState.IDLE,
      currentBoxes: 0,
      targetWarehouseId: null,
      targetDepotId: null,
      actionDelayFinishFrame: 0,
      preferredDockId: null,
      forceBusy: false,
    };
    context.setTruckState(truck.id, state);
  }

  if (state.forceBusy) {
    return;
  }

  switch (state.aiState) {
    case SupplyTruckAIState.IDLE:
      tickIdle(truck, truckProfile, state, context);
      break;
    case SupplyTruckAIState.APPROACHING_WAREHOUSE:
      tickApproachingWarehouse(truck, truckProfile, state, context);
      break;
    case SupplyTruckAIState.GATHERING:
      tickGathering(truck, truckProfile, state, context);
      break;
    case SupplyTruckAIState.APPROACHING_DEPOT:
      tickApproachingDepot(truck, state, context);
      break;
    case SupplyTruckAIState.DEPOSITING:
      tickDepositing(truck, truckProfile, state, context);
      break;
    case SupplyTruckAIState.WAITING:
      tickWaiting(truck, truckProfile, state, context);
      break;
  }
}

// ──── State machine ticks ──────────────────────────────────────────────────

function tickIdle<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  truckProfile: SupplyTruckProfile,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  // If we have boxes, go deposit them.
  if (state.currentBoxes > 0) {
    const depot = findNearestSupplyCenter(truck, context, state);
    if (depot) {
      state.targetDepotId = depot.id;
      state.aiState = SupplyTruckAIState.APPROACHING_DEPOT;
      incrementDockerCount(depot, context);
      context.moveEntityTo(truck.id, depot.x, depot.z);
      return;
    }
    // No depot available — regroup and wait.
    enterWaiting(truck, state, context, 30);
    return;
  }

  // Otherwise find a warehouse to gather from.
  const scanDistance = context.getSupplyTruckScanDistance
    ? context.getSupplyTruckScanDistance(truck, truckProfile)
    : truckProfile.supplyWarehouseScanDistance;
  const warehouse = findNearestWarehouseWithBoxes(truck, scanDistance, context, state);
  if (warehouse) {
    state.targetWarehouseId = warehouse.id;
    state.aiState = SupplyTruckAIState.APPROACHING_WAREHOUSE;
    incrementDockerCount(warehouse, context);
    context.moveEntityTo(truck.id, warehouse.x, warehouse.z);
    return;
  }

  // No warehouse with boxes — regroup and retry.
  enterWaiting(truck, state, context, 60);
}

function releaseWarehouseDock<TEntity extends SupplyChainEntity>(
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (state.targetWarehouseId !== null) {
    const dock = context.spawnedEntities.get(state.targetWarehouseId);
    if (dock) {
      decrementDockerCount(dock, context);
    }
    state.targetWarehouseId = null;
  }
}

function releaseDepotDock<TEntity extends SupplyChainEntity>(
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (state.targetDepotId !== null) {
    const dock = context.spawnedEntities.get(state.targetDepotId);
    if (dock) {
      decrementDockerCount(dock, context);
    }
    state.targetDepotId = null;
  }
}

function tickApproachingWarehouse<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  truckProfile: SupplyTruckProfile,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (state.targetWarehouseId === null) {
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  const warehouse = context.spawnedEntities.get(state.targetWarehouseId);
  if (!warehouse || warehouse.destroyed) {
    releaseWarehouseDock(state, context);
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  if (context.isWarehouseDockCrippled(warehouse)) {
    releaseWarehouseDock(state, context);
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  if (!canTransferSuppliesAt(truck, warehouse, state, context)) {
    releaseWarehouseDock(state, context);
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  if (isNearTarget(truck, warehouse)) {
    // Arrived at warehouse — release the approach slot.
    decrementDockerCount(warehouse, context);
    state.aiState = SupplyTruckAIState.GATHERING;
    state.actionDelayFinishFrame = context.frameCounter + truckProfile.supplyWarehouseActionDelayFrames;
  }
}

function tickGathering<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  truckProfile: SupplyTruckProfile,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (context.frameCounter < state.actionDelayFinishFrame) {
    return;
  }

  if (state.targetWarehouseId === null) {
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  const warehouse = context.spawnedEntities.get(state.targetWarehouseId);
  if (!warehouse || warehouse.destroyed) {
    state.targetWarehouseId = null;
    // Go deposit whatever we have.
    if (state.currentBoxes > 0) {
      transitionToDeposit(truck, state, context);
    } else {
      state.aiState = SupplyTruckAIState.IDLE;
    }
    return;
  }

  if (context.isWarehouseDockCrippled(warehouse)) {
    state.targetWarehouseId = null;
    if (state.currentBoxes > 0) {
      transitionToDeposit(truck, state, context);
    } else {
      state.aiState = SupplyTruckAIState.IDLE;
    }
    return;
  }

  if (!canTransferSuppliesAt(truck, warehouse, state, context)) {
    state.targetWarehouseId = null;
    if (state.currentBoxes > 0) {
      transitionToDeposit(truck, state, context);
    } else {
      state.aiState = SupplyTruckAIState.IDLE;
    }
    return;
  }

  const warehouseProfile = context.getWarehouseProfile(warehouse);
  const warehouseState = context.getWarehouseState(warehouse.id);
  if (!warehouseState || !warehouseProfile) {
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  // Source parity: transfer 1 box per action cycle.
  if (warehouseState.currentBoxes > 0 && state.currentBoxes < truckProfile.maxBoxes) {
    warehouseState.currentBoxes--;
    state.currentBoxes++;
    context.setWarehouseState(warehouse.id, warehouseState);

    // If warehouse empty and flagged, destroy it.
    if (warehouseState.currentBoxes <= 0 && warehouseProfile.deleteWhenEmpty) {
      context.destroyEntity(warehouse.id);
    }

    // If truck not full and warehouse not empty, schedule next pick-up.
    if (state.currentBoxes < truckProfile.maxBoxes && warehouseState.currentBoxes > 0) {
      state.actionDelayFinishFrame = context.frameCounter + truckProfile.supplyWarehouseActionDelayFrames;
      return;
    }
  }

  // Truck is full or warehouse is empty — go deposit.
  state.targetWarehouseId = null;
  if (state.currentBoxes > 0) {
    transitionToDeposit(truck, state, context);
  } else {
    state.aiState = SupplyTruckAIState.IDLE;
  }
}

function transitionToDeposit<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  const depot = findNearestSupplyCenter(truck, context, state);
  if (depot) {
    state.targetDepotId = depot.id;
    state.aiState = SupplyTruckAIState.APPROACHING_DEPOT;
    incrementDockerCount(depot, context);
    context.moveEntityTo(truck.id, depot.x, depot.z);
  } else {
    enterWaiting(truck, state, context, 30);
  }
}

function enterWaiting<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
  delayFrames: number,
): void {
  state.aiState = SupplyTruckAIState.WAITING;
  state.actionDelayFinishFrame = context.frameCounter + delayFrames;

  const regroupPosition = context.findRegroupPosition?.(truck, state.currentBoxes > 0);
  if (!regroupPosition) {
    return;
  }
  context.moveEntityTo(truck.id, regroupPosition.x, regroupPosition.z);
}

function tickApproachingDepot<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (state.targetDepotId === null) {
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  const depot = context.spawnedEntities.get(state.targetDepotId);
  if (!depot || depot.destroyed) {
    releaseDepotDock(state, context);
    // Try another depot.
    transitionToDeposit(truck, state, context);
    return;
  }

  if (!canTransferSuppliesAt(truck, depot, state, context)) {
    releaseDepotDock(state, context);
    if (state.currentBoxes > 0) {
      transitionToDeposit(truck, state, context);
    } else {
      state.aiState = SupplyTruckAIState.IDLE;
    }
    return;
  }

  if (isNearTarget(truck, depot)) {
    // Arrived at depot — release the approach slot.
    decrementDockerCount(depot, context);
    state.aiState = SupplyTruckAIState.DEPOSITING;
    state.actionDelayFinishFrame = context.frameCounter;
  }
}

function tickDepositing<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  truckProfile: SupplyTruckProfile,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (context.frameCounter < state.actionDelayFinishFrame) {
    return;
  }

  if (state.targetDepotId === null) {
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  const depot = context.spawnedEntities.get(state.targetDepotId);
  if (!depot || depot.destroyed) {
    state.targetDepotId = null;
    state.aiState = SupplyTruckAIState.IDLE;
    return;
  }

  if (!canTransferSuppliesAt(truck, depot, state, context)) {
    state.targetDepotId = null;
    if (state.currentBoxes > 0) {
      transitionToDeposit(truck, state, context);
    } else {
      state.aiState = SupplyTruckAIState.IDLE;
    }
    return;
  }

  // Source parity: deposit all boxes at once.
  // SupplyCenterDockUpdate::action() loops loseOneBox() and accumulates value.
  if (state.currentBoxes > 0) {
    const side = context.normalizeSide(truck.side);
    const baseValue = state.currentBoxes * context.supplyBoxValue;
    const boostValue = context.getSupplyTruckDepositBoost(truck, truckProfile);
    const totalValue = baseValue + boostValue;
    state.currentBoxes = 0;
    context.depositCredits(side, totalValue);

    // Source parity: SupplyCenterDockUpdate::action() — after deposit, grant temporary
    // stealth to the supply truck if the supply center has grantTemporaryStealthFrames > 0
    // AND the supply center itself is stealthed. ZH-only.
    if (context.grantTemporaryStealth && context.isEntityStealthed && context.getGrantTemporaryStealthFrames) {
      const stealthFrames = context.getGrantTemporaryStealthFrames(depot);
      if (stealthFrames > 0 && context.isEntityStealthed(depot)) {
        context.grantTemporaryStealth(truck.id, stealthFrames);
      }
    }
  }

  // Done depositing — schedule action delay then go back for more.
  state.targetDepotId = null;
  state.actionDelayFinishFrame = context.frameCounter + truckProfile.supplyCenterActionDelayFrames;
  state.aiState = SupplyTruckAIState.IDLE;
}

function tickWaiting<TEntity extends SupplyChainEntity>(
  truck: TEntity,
  truckProfile: SupplyTruckProfile,
  state: SupplyTruckState,
  context: SupplyChainContext<TEntity>,
): void {
  if (context.frameCounter < state.actionDelayFinishFrame) {
    return;
  }

  // Retry — transition back to IDLE to re-evaluate.
  state.aiState = SupplyTruckAIState.IDLE;
  tickIdle(truck, truckProfile, state, context);
}

// ──── Initialize warehouse state from profile ──────────────────────────────
export function initializeWarehouseState(profile: SupplyWarehouseProfile): SupplyWarehouseState {
  return {
    currentBoxes: Math.max(0, Math.trunc(profile.startingBoxes)),
  };
}
