/**
 * Specialized unit AI update modules — standalone, testable state machines.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/DozerAIUpdate.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/SupplyTruckAIUpdate.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/HackInternetAIUpdate.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/ChinookAIUpdate.cpp
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/WorkerAIUpdate.cpp
 *
 * Each module exports pure functions that run per-frame for entities with the matching
 * AI module, checking entity state and issuing appropriate commands.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────────────────────────────────────

export interface AIUpdateEntity {
  id: number;
  templateName: string;
  side?: string;
  x: number;
  z: number;
  destroyed: boolean;
  health: number;
  maxHealth: number;
  moving: boolean;
  kindOfFlags: ReadonlySet<string>;
  objectStatusFlags: ReadonlySet<string>;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. DozerAIUpdate — Construction worker AI
// ──────────────────────────────────────────────────────────────────────────────
//
// Source parity: DozerAIUpdate.cpp — state machine that manages build, repair,
// and idle auto-seek behaviors for USA dozers and GLA workers.

/** Source parity: DozerAIUpdateModuleData fields consumed by the AI. */
export interface DozerAIProfile {
  /** Health restored per second as a fraction of max health (0..1). */
  repairHealthPercentPerSecond: number;
  /** Frames the dozer must be idle before auto-seeking repair targets. */
  boredTimeFrames: number;
  /** World-unit radius for auto-repair/mine-clearing scan. */
  boredRange: number;
}

/** Source parity: DozerTask enum from DozerAIUpdate.h. */
export const enum DozerTask {
  INVALID = 0,
  BUILD = 1,
  REPAIR = 2,
}

/** Source parity: DOZER_SELECT_BUILD_DOCK_LOCATION etc. */
export const enum DozerBuildSubTask {
  SELECT_DOCK_LOCATION = 0,
  MOVING_TO_DOCK = 1,
  DO_BUILD_AT_DOCK = 2,
}

/** Per-dozer runtime state managed by the dozer AI module. */
export interface DozerAIState {
  currentTask: DozerTask;
  buildSubTask: DozerBuildSubTask;
  targetBuildingId: number | null;
  /** Frame when the dozer became idle (used for bored-time checks). */
  idleSinceFrame: number;
  /** Build task order frame (for priority). */
  taskOrderFrame: number;
}

/** Building info needed for dozer construction/repair logic. */
export interface DozerBuildingInfo {
  id: number;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  destroyed: boolean;
  constructionPercent: number;
  buildTotalFrames: number;
  builderId: number;
  boundingRadius: number;
  isStructure: boolean;
  isSold: boolean;
  isUnderConstruction: boolean;
  soleHealingBenefactorId: number | null;
  soleHealingBenefactorExpirationFrame: number;
}

/** Sentinel value for completed construction. */
export const CONSTRUCTION_COMPLETE = -1;

export interface DozerAIContext {
  readonly frameCounter: number;
  /** Logic frames per second. */
  readonly logicFrameRate: number;

  /** Resolve the dozer's current task target building info. */
  getBuildingInfo(buildingId: number): DozerBuildingInfo | null;

  /** Find the nearest damaged structure within range that the dozer can repair. */
  findAutoRepairTarget(dozerId: number, dozerX: number, dozerZ: number, range: number): DozerBuildingInfo | null;

  /** Find the nearest mine within range that the dozer can attack. */
  findAutoMineTarget(dozerId: number, dozerX: number, dozerZ: number, range: number): { id: number } | null;

  /** Issue a repair command for the dozer. */
  issueRepairCommand(dozerId: number, buildingId: number): void;

  /** Issue an attack command for mine clearing. */
  issueAttackCommand(dozerId: number, targetId: number): void;

  /** Set the construction progress percentage of a building. */
  setConstructionPercent(buildingId: number, percent: number): void;

  /** Complete construction of a building. */
  completeConstruction(buildingId: number): void;

  /** Attempt healing from sole benefactor (returns false if another healer owns the target). */
  attemptHealingFromSoleBenefactor(buildingId: number, healAmount: number, healerId: number, lockFrames: number): boolean;

  /** Notify that a building repair is complete. */
  onRepairComplete(buildingId: number): void;

  /** Cancel the dozer's construction task. */
  cancelConstructionTask(dozerId: number): void;
}

/** Create initial dozer AI state. */
export function createDozerAIState(frameCounter: number): DozerAIState {
  return {
    currentTask: DozerTask.INVALID,
    buildSubTask: DozerBuildSubTask.SELECT_DOCK_LOCATION,
    targetBuildingId: null,
    idleSinceFrame: frameCounter,
    taskOrderFrame: 0,
  };
}

/**
 * Source parity: DozerActionDoActionState::update — DOZER_TASK_BUILD.
 * Increments construction progress per frame while dozer is within build radius.
 */
export function updateDozerConstruction(
  dozerEntity: AIUpdateEntity,
  state: DozerAIState,
  context: DozerAIContext,
): void {
  if (state.currentTask !== DozerTask.BUILD || state.targetBuildingId === null) {
    return;
  }

  const building = context.getBuildingInfo(state.targetBuildingId);
  if (!building || building.destroyed || building.isSold) {
    context.cancelConstructionTask(dozerEntity.id);
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  // Source parity: builder exclusivity — only the assigned builder may progress.
  if (building.builderId !== dozerEntity.id) {
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  // Already complete.
  if (building.constructionPercent === CONSTRUCTION_COMPLETE) {
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  // Source parity: must be within bounding radius + margin to build.
  const dx = building.x - dozerEntity.x;
  const dz = building.z - dozerEntity.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const buildRadius = building.boundingRadius + 10;
  if (distance > buildRadius) {
    return; // Still moving to site.
  }

  // Source parity: percentProgressThisFrame = 100.0 / framesToBuild.
  const totalFrames = building.buildTotalFrames;
  if (totalFrames <= 0) {
    context.completeConstruction(building.id);
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  const percentPerFrame = 100.0 / totalFrames;
  const newPercent = building.constructionPercent + percentPerFrame;

  if (newPercent >= 100.0) {
    context.setConstructionPercent(building.id, 100.0);
    context.completeConstruction(building.id);
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
  } else {
    context.setConstructionPercent(building.id, newPercent);
  }
}

/**
 * Source parity: DozerActionDoActionState::update — DOZER_TASK_REPAIR.
 * Applies per-frame healing to the target structure.
 */
export function updateDozerRepair(
  dozerEntity: AIUpdateEntity,
  state: DozerAIState,
  profile: DozerAIProfile,
  context: DozerAIContext,
): void {
  if (state.currentTask !== DozerTask.REPAIR || state.targetBuildingId === null) {
    return;
  }

  const building = context.getBuildingInfo(state.targetBuildingId);
  if (!building || building.destroyed) {
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  // Source parity: repair complete.
  if (building.health >= building.maxHealth) {
    context.onRepairComplete(building.id);
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  // Source parity: health = maxHealth * repairHealthPercentPerSecond / LOGICFRAMES_PER_SECOND.
  const healAmount = (profile.repairHealthPercentPerSecond / context.logicFrameRate) * building.maxHealth;
  if (healAmount <= 0) {
    return;
  }

  // Source parity: attemptHealingFromSoleBenefactor rejects competing dozers.
  const healed = context.attemptHealingFromSoleBenefactor(building.id, healAmount, dozerEntity.id, 2);
  if (!healed) {
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
    return;
  }

  // Re-check after healing.
  const updatedBuilding = context.getBuildingInfo(state.targetBuildingId);
  if (updatedBuilding && updatedBuilding.health >= updatedBuilding.maxHealth) {
    context.onRepairComplete(updatedBuilding.id);
    state.currentTask = DozerTask.INVALID;
    state.targetBuildingId = null;
  }
}

/**
 * Source parity: DozerPrimaryIdleState::update — bored dozer auto-seeks repairs/mines.
 */
export function updateDozerIdleBehavior(
  dozerEntity: AIUpdateEntity,
  state: DozerAIState,
  profile: DozerAIProfile,
  context: DozerAIContext,
): void {
  if (profile.boredTimeFrames <= 0 || profile.boredRange <= 0) {
    return;
  }

  if (state.currentTask !== DozerTask.INVALID) {
    state.idleSinceFrame = context.frameCounter;
    return;
  }

  if (dozerEntity.moving) {
    state.idleSinceFrame = context.frameCounter;
    return;
  }

  // Source parity: must be idle for boredTimeFrames before scanning.
  if ((context.frameCounter - state.idleSinceFrame) <= profile.boredTimeFrames) {
    return;
  }

  // Reset idle timestamp to throttle expensive scans.
  state.idleSinceFrame = context.frameCounter;

  // Source parity: find nearest damaged structure to auto-repair.
  const repairTarget = context.findAutoRepairTarget(
    dozerEntity.id, dozerEntity.x, dozerEntity.z, profile.boredRange,
  );
  if (repairTarget) {
    context.issueRepairCommand(dozerEntity.id, repairTarget.id);
    return;
  }

  // Source parity: if no repair target, look for mines to clear.
  const mineTarget = context.findAutoMineTarget(
    dozerEntity.id, dozerEntity.x, dozerEntity.z, profile.boredRange,
  );
  if (mineTarget) {
    context.issueAttackCommand(dozerEntity.id, mineTarget.id);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. HackInternetAIUpdate — GLA hacker passive income
// ──────────────────────────────────────────────────────────────────────────────
//
// Source parity: HackInternetAIUpdate.cpp — 3-state machine:
//   IDLE → UNPACKING → HACKING → (PACKING → IDLE on move command)
//
// The hacker sits, sets up a laptop, and generates periodic cash until moved.

/** Source parity: HackInternetAIUpdateModuleData. */
export interface HackInternetProfile {
  unpackTimeFrames: number;
  packTimeFrames: number;
  cashUpdateDelayFrames: number;
  /** Source parity: cash amount varies by veterancy level. */
  regularCashAmount: number;
  veteranCashAmount: number;
  eliteCashAmount: number;
  heroicCashAmount: number;
  /** Source parity: experience points granted per cash cycle. */
  xpPerCashUpdate: number;
  /** Source parity: PackUnpackVariationFactor randomization. */
  packUnpackVariationFactor: number;
}

/** Source parity: HackInternetStateMachine state IDs. */
export const enum HackInternetState {
  IDLE = 0,
  UNPACKING = 1,
  HACKING = 2,
  PACKING = 3,
}

/** Source parity: veterancy levels from ExperienceTracker.h. */
export const enum VeterancyLevel {
  REGULAR = 0,
  VETERAN = 1,
  ELITE = 2,
  HEROIC = 3,
}

/** Per-hacker runtime state. */
export interface HackInternetRuntimeState {
  state: HackInternetState;
  /** Frames remaining in the current sub-state (unpack/pack/cash-delay). */
  framesRemaining: number;
  /** Accumulated cash to deposit on next cycle. */
  totalCashEarned: number;
}

export interface HackInternetContext {
  readonly frameCounter: number;

  /** Deposit cash to the hacker's owning side. */
  depositCash(side: string, amount: number): void;

  /** Get the hacker's current veterancy level. */
  getVeterancyLevel(entityId: number): VeterancyLevel;

  /** Grant XP to the hacker. */
  grantExperience(entityId: number, amount: number): void;

  /** Generate a random float in [min, max] (deterministic for replay parity). */
  randomFloat(min: number, max: number): number;
}

/** Create initial hacker state. */
export function createHackInternetState(): HackInternetRuntimeState {
  return {
    state: HackInternetState.IDLE,
    framesRemaining: 0,
    totalCashEarned: 0,
  };
}

/**
 * Resolve the cash amount per cycle based on veterancy level.
 * Source parity: HackInternetState::update switch(xp->getVeterancyLevel()).
 */
export function resolveHackInternetCashAmount(
  profile: HackInternetProfile,
  veterancyLevel: VeterancyLevel,
): number {
  // Source parity: fall-through logic — higher levels fall through if their amount is 0.
  switch (veterancyLevel) {
    case VeterancyLevel.HEROIC:
      if (profile.heroicCashAmount > 0) return profile.heroicCashAmount;
      // fall through
    case VeterancyLevel.ELITE:
      if (profile.eliteCashAmount > 0) return profile.eliteCashAmount;
      // fall through
    case VeterancyLevel.VETERAN:
      if (profile.veteranCashAmount > 0) return profile.veteranCashAmount;
      // fall through
    case VeterancyLevel.REGULAR:
      if (profile.regularCashAmount > 0) return profile.regularCashAmount;
      // fall through
    default:
      return 1; // Source parity: default fallback is $1.
  }
}

/**
 * Source parity: HackInternetAIUpdate::hackInternet() — begin hacking.
 * Transitions from IDLE to UNPACKING.
 */
export function beginHackInternet(
  state: HackInternetRuntimeState,
  profile: HackInternetProfile,
  context: HackInternetContext,
): void {
  if (state.state !== HackInternetState.IDLE) {
    return;
  }

  const variationFactor = profile.packUnpackVariationFactor;
  const variation = context.randomFloat(1.0 - variationFactor, 1.0 + variationFactor);
  state.framesRemaining = Math.round(profile.unpackTimeFrames * variation);
  state.state = HackInternetState.UNPACKING;
}

/**
 * Source parity: HackInternetAIUpdate::aiDoCommand — interrupt hacking.
 * If hacking, transition to PACKING. If packing, wait for pack to finish.
 * Returns the delay in frames before the pending command should execute,
 * or 0 if no delay is needed (hacker was idle).
 */
export function interruptHackInternet(
  state: HackInternetRuntimeState,
  profile: HackInternetProfile,
  context: HackInternetContext,
): number {
  if (state.state === HackInternetState.HACKING) {
    // Transition to PACKING.
    const variationFactor = profile.packUnpackVariationFactor;
    const variation = context.randomFloat(1.0 - variationFactor, 1.0 + variationFactor);
    state.framesRemaining = Math.round(profile.packTimeFrames * variation);
    state.state = HackInternetState.PACKING;
    return state.framesRemaining;
  }

  if (state.state === HackInternetState.PACKING) {
    // Already packing — return remaining frames.
    return state.framesRemaining;
  }

  if (state.state === HackInternetState.UNPACKING) {
    // Was still unpacking — go directly to idle.
    state.state = HackInternetState.IDLE;
    state.framesRemaining = 0;
    return 0;
  }

  return 0;
}

/**
 * Source parity: per-frame update of the hack internet state machine.
 */
export function updateHackInternet(
  entity: AIUpdateEntity,
  state: HackInternetRuntimeState,
  profile: HackInternetProfile,
  context: HackInternetContext,
): void {
  if (entity.destroyed) {
    return;
  }

  switch (state.state) {
    case HackInternetState.IDLE:
      // Nothing to do — hacker is not hacking.
      break;

    case HackInternetState.UNPACKING:
      if (state.framesRemaining > 0) {
        state.framesRemaining--;
      } else {
        // Source parity: UnpackingState::update SUCCESS → transitions to HACK_INTERNET.
        state.state = HackInternetState.HACKING;
        state.framesRemaining = profile.cashUpdateDelayFrames;
      }
      break;

    case HackInternetState.HACKING: {
      if (state.framesRemaining > 0) {
        state.framesRemaining--;
      } else {
        // Source parity: HackInternetState::update — deposit cash and reset timer.
        const side = entity.side;
        if (side) {
          const veterancyLevel = context.getVeterancyLevel(entity.id);
          const cashAmount = resolveHackInternetCashAmount(profile, veterancyLevel);
          context.depositCash(side, cashAmount);
          state.totalCashEarned += cashAmount;

          // Source parity: grant XP per cash cycle.
          if (profile.xpPerCashUpdate > 0) {
            context.grantExperience(entity.id, profile.xpPerCashUpdate);
          }
        }

        // Source parity: reset timer for next cycle.
        state.framesRemaining = profile.cashUpdateDelayFrames;
      }
      break;
    }

    case HackInternetState.PACKING:
      if (state.framesRemaining > 0) {
        state.framesRemaining--;
      } else {
        // Source parity: PackingState::update SUCCESS → transitions to AI_IDLE.
        state.state = HackInternetState.IDLE;
      }
      break;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. TransportAIUpdate — Load/unload passenger management
// ──────────────────────────────────────────────────────────────────────────────
//
// Source parity: ChinookAIUpdate.cpp — transport helicopter AI that manages
// takeoff/landing, passenger loading/unloading, and combat drops.

/** Source parity: ChinookFlightStatus enum. */
export const enum TransportFlightStatus {
  FLYING = 0,
  TAKING_OFF = 1,
  LANDING = 2,
  LANDED = 3,
  DOING_COMBAT_DROP = 4,
}

/** Source parity: ChinookAIUpdateModuleData transport-relevant fields. */
export interface TransportAIProfile {
  /** Max passengers this transport can carry. */
  maxPassengers: number;
  /** Whether this is an air transport (helicopter). */
  isAirTransport: boolean;
  /** Combat drop configuration (null = no combat drop capability). */
  combatDrop: {
    numRopes: number;
    perRopeDelayMinFrames: number;
    perRopeDelayMaxFrames: number;
    rappelSpeed: number;
  } | null;
}

/** Per-transport runtime state. */
export interface TransportAIState {
  flightStatus: TransportFlightStatus;
  passengerIds: number[];
  /** Entity IDs of passengers currently being unloaded (rappelling or exiting). */
  unloadingPassengerIds: number[];
  /** Frame at which the next passenger can begin unloading. */
  nextUnloadFrame: number;
  /** Whether a return-to-base is pending after unload. */
  returnAfterUnload: boolean;
  /** Takeoff/landing transition frame (0 = not in transition). */
  transitionFinishFrame: number;
}

export interface TransportAIContext {
  readonly frameCounter: number;

  /** Check if a passenger entity is still alive and valid. */
  isPassengerAlive(passengerId: number): boolean;

  /** Remove a passenger from the transport and place on the ground. */
  ejectPassenger(transportId: number, passengerId: number): void;

  /** Issue a move-to command for the transport. */
  moveTransportTo(transportId: number, x: number, z: number): void;

  /** Generate a random integer in [min, max] (deterministic). */
  randomInt(min: number, max: number): number;
}

/** Create initial transport AI state. */
export function createTransportAIState(): TransportAIState {
  return {
    flightStatus: TransportFlightStatus.LANDED,
    passengerIds: [],
    unloadingPassengerIds: [],
    nextUnloadFrame: 0,
    returnAfterUnload: false,
    transitionFinishFrame: 0,
  };
}

/**
 * Load a passenger into the transport.
 * Source parity: ContainModule::addContained.
 * Returns true if passenger was loaded, false if transport is full.
 */
export function loadPassenger(
  state: TransportAIState,
  profile: TransportAIProfile,
  passengerId: number,
): boolean {
  if (state.passengerIds.length >= profile.maxPassengers) {
    return false;
  }
  if (state.passengerIds.includes(passengerId)) {
    return false; // Already loaded.
  }
  state.passengerIds.push(passengerId);
  return true;
}

/**
 * Begin sequential passenger unload.
 * Source parity: ChinookEvacuateState — removeAllContained, sequential drop.
 */
export function beginUnload(
  state: TransportAIState,
  _profile: TransportAIProfile,
  context: TransportAIContext,
  returnAfterUnload: boolean,
): void {
  if (state.passengerIds.length === 0) {
    return;
  }

  state.returnAfterUnload = returnAfterUnload;
  state.nextUnloadFrame = context.frameCounter;
}

/**
 * Per-frame update for the transport unload sequence.
 * Returns true when all passengers have been unloaded.
 */
export function updateTransportUnload(
  transportEntity: AIUpdateEntity,
  state: TransportAIState,
  profile: TransportAIProfile,
  context: TransportAIContext,
): boolean {
  // Clean up dead passengers from the unloading list.
  state.unloadingPassengerIds = state.unloadingPassengerIds.filter(
    (id) => context.isPassengerAlive(id),
  );

  // Clean up dead passengers from loaded list.
  state.passengerIds = state.passengerIds.filter(
    (id) => context.isPassengerAlive(id),
  );

  if (state.passengerIds.length === 0 && state.unloadingPassengerIds.length === 0) {
    return true; // All done.
  }

  if (context.frameCounter < state.nextUnloadFrame) {
    return false;
  }

  // Eject the next passenger.
  if (state.passengerIds.length > 0) {
    const passengerId = state.passengerIds.shift()!;
    context.ejectPassenger(transportEntity.id, passengerId);
    state.unloadingPassengerIds.push(passengerId);

    // Source parity: per-rope delay between sequential drops.
    if (profile.combatDrop) {
      const delay = context.randomInt(
        profile.combatDrop.perRopeDelayMinFrames,
        profile.combatDrop.perRopeDelayMaxFrames,
      );
      state.nextUnloadFrame = context.frameCounter + delay;
    } else {
      // Ground transports: 1-frame delay between passenger exits.
      state.nextUnloadFrame = context.frameCounter + 1;
    }
  }

  return false;
}

/**
 * Source parity: ChinookTakeoffOrLandingState — flight status transitions.
 * Updates the transport's flight status based on transition timing.
 */
export function updateTransportFlightTransition(
  state: TransportAIState,
  context: TransportAIContext,
): void {
  if (state.transitionFinishFrame === 0) {
    return;
  }

  if (context.frameCounter >= state.transitionFinishFrame) {
    state.transitionFinishFrame = 0;
    if (state.flightStatus === TransportFlightStatus.TAKING_OFF) {
      state.flightStatus = TransportFlightStatus.FLYING;
    } else if (state.flightStatus === TransportFlightStatus.LANDING) {
      state.flightStatus = TransportFlightStatus.LANDED;
    }
  }
}

/**
 * Begin a takeoff transition.
 */
export function beginTakeoff(
  state: TransportAIState,
  context: TransportAIContext,
  transitionFrames: number,
): void {
  if (state.flightStatus !== TransportFlightStatus.LANDED) {
    return;
  }
  state.flightStatus = TransportFlightStatus.TAKING_OFF;
  state.transitionFinishFrame = context.frameCounter + transitionFrames;
}

/**
 * Begin a landing transition.
 */
export function beginLanding(
  state: TransportAIState,
  context: TransportAIContext,
  transitionFrames: number,
): void {
  if (state.flightStatus !== TransportFlightStatus.FLYING) {
    return;
  }
  state.flightStatus = TransportFlightStatus.LANDING;
  state.transitionFinishFrame = context.frameCounter + transitionFrames;
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. WorkerAIUpdate — Dual dozer/supply-truck AI (GLA Worker)
// ──────────────────────────────────────────────────────────────────────────────
//
// Source parity: WorkerAIUpdate.cpp — "A Worker is a unit that is both a
// Dozer and a Supply Truck." Manages switching between the two roles.

/** Source parity: WorkerAIUpdate AS_DOZER / AS_SUPPLY_TRUCK. */
export const enum WorkerRole {
  DOZER = 0,
  SUPPLY_TRUCK = 1,
}

/** Per-worker runtime state that manages dual role. */
export interface WorkerAIState {
  currentRole: WorkerRole;
  dozerState: DozerAIState;
}

/**
 * Source parity: WorkerAIUpdate — determine which role the worker should be in.
 *
 * Rules (from C++):
 * - If explicitly told to gather supplies (dock command from player/AI), switch to SUPPLY_TRUCK.
 * - If explicitly told to build/repair (from player/AI), switch to DOZER.
 * - Default is DOZER when idle.
 */
export function resolveWorkerRole(
  hasActiveDozerTask: boolean,
  hasActiveSupplyTask: boolean,
): WorkerRole {
  if (hasActiveDozerTask) {
    return WorkerRole.DOZER;
  }
  if (hasActiveSupplyTask) {
    return WorkerRole.SUPPLY_TRUCK;
  }
  return WorkerRole.DOZER; // Source parity: default is AS_DOZER.
}

/** Create initial worker AI state. */
export function createWorkerAIState(frameCounter: number): WorkerAIState {
  return {
    currentRole: WorkerRole.DOZER,
    dozerState: createDozerAIState(frameCounter),
  };
}
