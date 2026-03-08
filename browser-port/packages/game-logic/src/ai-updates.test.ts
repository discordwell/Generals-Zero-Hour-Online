import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  // Dozer AI
  type DozerAIProfile,
  type DozerAIState,
  type DozerAIContext,
  type DozerBuildingInfo,
  DozerTask,
  DozerBuildSubTask,
  CONSTRUCTION_COMPLETE,
  createDozerAIState,
  updateDozerConstruction,
  updateDozerRepair,
  updateDozerIdleBehavior,
  // HackInternet AI
  type HackInternetProfile,
  type HackInternetRuntimeState,
  type HackInternetContext,
  HackInternetState,
  VeterancyLevel,
  createHackInternetState,
  resolveHackInternetCashAmount,
  beginHackInternet,
  interruptHackInternet,
  updateHackInternet,
  // Transport AI
  type TransportAIProfile,
  type TransportAIState,
  type TransportAIContext,
  TransportFlightStatus,
  createTransportAIState,
  loadPassenger,
  beginUnload,
  updateTransportUnload,
  updateTransportFlightTransition,
  beginTakeoff,
  beginLanding,
  // Worker AI
  WorkerRole,
  resolveWorkerRole,
  createWorkerAIState,
} from './ai-updates.js';

import type { AIUpdateEntity } from './ai-updates.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<AIUpdateEntity> = {}): AIUpdateEntity {
  return {
    id: 1,
    templateName: 'TestUnit',
    side: 'America',
    x: 100,
    z: 100,
    destroyed: false,
    health: 100,
    maxHealth: 100,
    moving: false,
    kindOfFlags: new Set<string>(),
    objectStatusFlags: new Set<string>(),
    ...overrides,
  };
}

function makeBuildingInfo(overrides: Partial<DozerBuildingInfo> = {}): DozerBuildingInfo {
  return {
    id: 10,
    x: 100,
    z: 100,
    health: 50,
    maxHealth: 500,
    destroyed: false,
    constructionPercent: 0,
    buildTotalFrames: 300,
    builderId: 1,
    boundingRadius: 30,
    isStructure: true,
    isSold: false,
    isUnderConstruction: true,
    soleHealingBenefactorId: null,
    soleHealingBenefactorExpirationFrame: 0,
    ...overrides,
  };
}

function makeDozerContext(overrides: Partial<DozerAIContext> = {}): DozerAIContext {
  return {
    frameCounter: 100,
    logicFrameRate: 15,
    getBuildingInfo: vi.fn().mockReturnValue(null),
    findAutoRepairTarget: vi.fn().mockReturnValue(null),
    findAutoMineTarget: vi.fn().mockReturnValue(null),
    issueRepairCommand: vi.fn(),
    issueAttackCommand: vi.fn(),
    setConstructionPercent: vi.fn(),
    completeConstruction: vi.fn(),
    attemptHealingFromSoleBenefactor: vi.fn().mockReturnValue(true),
    onRepairComplete: vi.fn(),
    cancelConstructionTask: vi.fn(),
    ...overrides,
  };
}

function makeDozerProfile(overrides: Partial<DozerAIProfile> = {}): DozerAIProfile {
  return {
    repairHealthPercentPerSecond: 0.02,
    boredTimeFrames: 90,
    boredRange: 200,
    ...overrides,
  };
}

function makeHackInternetProfile(overrides: Partial<HackInternetProfile> = {}): HackInternetProfile {
  return {
    unpackTimeFrames: 30,
    packTimeFrames: 15,
    cashUpdateDelayFrames: 45,
    regularCashAmount: 5,
    veteranCashAmount: 7,
    eliteCashAmount: 10,
    heroicCashAmount: 15,
    xpPerCashUpdate: 2,
    packUnpackVariationFactor: 0,
    ...overrides,
  };
}

function makeHackInternetContext(overrides: Partial<HackInternetContext> = {}): HackInternetContext {
  return {
    frameCounter: 100,
    depositCash: vi.fn(),
    getVeterancyLevel: vi.fn().mockReturnValue(VeterancyLevel.REGULAR),
    grantExperience: vi.fn(),
    randomFloat: vi.fn().mockImplementation((min: number, _max: number) => min + (_max - min) * 0.5),
    ...overrides,
  };
}

function makeTransportProfile(overrides: Partial<TransportAIProfile> = {}): TransportAIProfile {
  return {
    maxPassengers: 8,
    isAirTransport: true,
    combatDrop: {
      numRopes: 2,
      perRopeDelayMinFrames: 5,
      perRopeDelayMaxFrames: 10,
      rappelSpeed: 2,
    },
    ...overrides,
  };
}

function makeTransportContext(overrides: Partial<TransportAIContext> = {}): TransportAIContext {
  return {
    frameCounter: 100,
    isPassengerAlive: vi.fn().mockReturnValue(true),
    ejectPassenger: vi.fn(),
    moveTransportTo: vi.fn(),
    randomInt: vi.fn().mockImplementation((min: number, _max: number) => min),
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. DozerAIUpdate tests
// ──────────────────────────────────────────────────────────────────────────────

describe('DozerAIUpdate', () => {
  describe('createDozerAIState', () => {
    it('creates a valid initial state', () => {
      const state = createDozerAIState(50);
      expect(state.currentTask).toBe(DozerTask.INVALID);
      expect(state.buildSubTask).toBe(DozerBuildSubTask.SELECT_DOCK_LOCATION);
      expect(state.targetBuildingId).toBeNull();
      expect(state.idleSinceFrame).toBe(50);
      expect(state.taskOrderFrame).toBe(0);
    });
  });

  describe('updateDozerConstruction', () => {
    it('does nothing when task is not BUILD', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.REPAIR;
      const context = makeDozerContext();

      updateDozerConstruction(entity, state, context);

      expect(context.completeConstruction).not.toHaveBeenCalled();
    });

    it('cancels task when building is destroyed', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({ destroyed: true })),
      });

      updateDozerConstruction(entity, state, context);

      expect(context.cancelConstructionTask).toHaveBeenCalledWith(1);
      expect(state.currentTask).toBe(DozerTask.INVALID);
      expect(state.targetBuildingId).toBeNull();
    });

    it('cancels task when building is sold', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({ isSold: true })),
      });

      updateDozerConstruction(entity, state, context);

      expect(context.cancelConstructionTask).toHaveBeenCalledWith(1);
      expect(state.currentTask).toBe(DozerTask.INVALID);
    });

    it('cancels task when builder exclusivity check fails', () => {
      const entity = makeEntity({ id: 1 });
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({ builderId: 999 })),
      });

      updateDozerConstruction(entity, state, context);

      expect(state.currentTask).toBe(DozerTask.INVALID);
      expect(state.targetBuildingId).toBeNull();
    });

    it('does nothing while dozer is out of build radius', () => {
      const entity = makeEntity({ x: 200, z: 200 });
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({
          x: 100, z: 100, boundingRadius: 30,
        })),
      });

      updateDozerConstruction(entity, state, context);

      // Still in BUILD task — waiting for dozer to arrive.
      expect(state.currentTask).toBe(DozerTask.BUILD);
      expect(context.completeConstruction).not.toHaveBeenCalled();
    });

    it('completes construction when already at CONSTRUCTION_COMPLETE', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({
          constructionPercent: CONSTRUCTION_COMPLETE,
        })),
      });

      updateDozerConstruction(entity, state, context);

      expect(state.currentTask).toBe(DozerTask.INVALID);
      expect(state.targetBuildingId).toBeNull();
    });

    it('completes construction instantly when buildTotalFrames is 0', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({
          buildTotalFrames: 0, constructionPercent: 50,
        })),
      });

      updateDozerConstruction(entity, state, context);

      expect(context.completeConstruction).toHaveBeenCalledWith(10);
      expect(state.currentTask).toBe(DozerTask.INVALID);
    });

    it('calls completeConstruction when percent reaches 100', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      // 99.9% done, 300 total frames → 100/300 = 0.33% per frame → will exceed 100%.
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({
          constructionPercent: 99.9, buildTotalFrames: 300,
        })),
      });

      updateDozerConstruction(entity, state, context);

      expect(context.completeConstruction).toHaveBeenCalledWith(10);
      expect(state.currentTask).toBe(DozerTask.INVALID);
    });

    it('writes back construction progress incrementally across frames', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      let currentPercent = 0;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockImplementation(() => makeBuildingInfo({
          constructionPercent: currentPercent, buildTotalFrames: 10,
        })),
        setConstructionPercent: vi.fn().mockImplementation((_id: number, pct: number) => {
          currentPercent = pct;
        }),
      });

      // Run 5 frames: should advance to 50%
      for (let i = 0; i < 5; i++) {
        updateDozerConstruction(entity, state, context);
      }
      expect(currentPercent).toBeCloseTo(50.0);
      expect(context.completeConstruction).not.toHaveBeenCalled();

      // Run 5 more frames: should complete at 100%
      for (let i = 0; i < 5; i++) {
        updateDozerConstruction(entity, state, context);
      }
      expect(context.completeConstruction).toHaveBeenCalledWith(10);
    });

    it('cancels task when building info is null', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      state.targetBuildingId = 10;
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(null),
      });

      updateDozerConstruction(entity, state, context);

      expect(context.cancelConstructionTask).toHaveBeenCalledWith(1);
      expect(state.currentTask).toBe(DozerTask.INVALID);
    });
  });

  describe('updateDozerRepair', () => {
    it('does nothing when task is not REPAIR', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      const profile = makeDozerProfile();
      const context = makeDozerContext();

      updateDozerRepair(entity, state, profile, context);

      expect(context.attemptHealingFromSoleBenefactor).not.toHaveBeenCalled();
    });

    it('completes repair when building is at full health', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.REPAIR;
      state.targetBuildingId = 10;
      const profile = makeDozerProfile();
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({
          health: 500, maxHealth: 500,
        })),
      });

      updateDozerRepair(entity, state, profile, context);

      expect(context.onRepairComplete).toHaveBeenCalledWith(10);
      expect(state.currentTask).toBe(DozerTask.INVALID);
    });

    it('cancels repair when building is destroyed', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.REPAIR;
      state.targetBuildingId = 10;
      const profile = makeDozerProfile();
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo({ destroyed: true })),
      });

      updateDozerRepair(entity, state, profile, context);

      expect(state.currentTask).toBe(DozerTask.INVALID);
      expect(state.targetBuildingId).toBeNull();
    });

    it('applies healing per frame', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.REPAIR;
      state.targetBuildingId = 10;
      const profile = makeDozerProfile({ repairHealthPercentPerSecond: 0.1 });
      const building = makeBuildingInfo({ health: 100, maxHealth: 500 });
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(building),
        logicFrameRate: 15,
      });

      updateDozerRepair(entity, state, profile, context);

      // healAmount = (0.1 / 15) * 500 = 3.33
      expect(context.attemptHealingFromSoleBenefactor).toHaveBeenCalledWith(
        10, expect.closeTo(3.33, 1), 1, 2,
      );
    });

    it('cancels repair when sole benefactor check fails', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.REPAIR;
      state.targetBuildingId = 10;
      const profile = makeDozerProfile();
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo()),
        attemptHealingFromSoleBenefactor: vi.fn().mockReturnValue(false),
      });

      updateDozerRepair(entity, state, profile, context);

      expect(state.currentTask).toBe(DozerTask.INVALID);
    });

    it('does not heal when repairHealthPercentPerSecond is 0', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.REPAIR;
      state.targetBuildingId = 10;
      const profile = makeDozerProfile({ repairHealthPercentPerSecond: 0 });
      const context = makeDozerContext({
        getBuildingInfo: vi.fn().mockReturnValue(makeBuildingInfo()),
      });

      updateDozerRepair(entity, state, profile, context);

      expect(context.attemptHealingFromSoleBenefactor).not.toHaveBeenCalled();
    });
  });

  describe('updateDozerIdleBehavior', () => {
    it('does nothing when bored time is 0', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      const profile = makeDozerProfile({ boredTimeFrames: 0 });
      const context = makeDozerContext({ frameCounter: 1000 });

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(context.findAutoRepairTarget).not.toHaveBeenCalled();
    });

    it('resets idle timestamp when dozer has active task', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      state.currentTask = DozerTask.BUILD;
      const profile = makeDozerProfile();
      const context = makeDozerContext({ frameCounter: 200 });

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(state.idleSinceFrame).toBe(200);
      expect(context.findAutoRepairTarget).not.toHaveBeenCalled();
    });

    it('resets idle timestamp when dozer is moving', () => {
      const entity = makeEntity({ moving: true });
      const state = createDozerAIState(0);
      const profile = makeDozerProfile();
      const context = makeDozerContext({ frameCounter: 200 });

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(state.idleSinceFrame).toBe(200);
    });

    it('does not scan before bored time elapses', () => {
      const entity = makeEntity();
      const state = createDozerAIState(50);
      const profile = makeDozerProfile({ boredTimeFrames: 90 });
      const context = makeDozerContext({ frameCounter: 100 }); // 50 frames idle, needs 90

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(context.findAutoRepairTarget).not.toHaveBeenCalled();
    });

    it('issues repair command when repair target found after bored time', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      const profile = makeDozerProfile({ boredTimeFrames: 90, boredRange: 200 });
      const building = makeBuildingInfo({ id: 42 });
      const context = makeDozerContext({
        frameCounter: 200,
        findAutoRepairTarget: vi.fn().mockReturnValue(building),
      });

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(context.issueRepairCommand).toHaveBeenCalledWith(1, 42);
    });

    it('issues attack command when mine target found and no repair target', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      const profile = makeDozerProfile({ boredTimeFrames: 90, boredRange: 200 });
      const context = makeDozerContext({
        frameCounter: 200,
        findAutoRepairTarget: vi.fn().mockReturnValue(null),
        findAutoMineTarget: vi.fn().mockReturnValue({ id: 55 }),
      });

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(context.issueAttackCommand).toHaveBeenCalledWith(1, 55);
    });

    it('resets idle timestamp after scan even when no target found', () => {
      const entity = makeEntity();
      const state = createDozerAIState(0);
      const profile = makeDozerProfile({ boredTimeFrames: 90 });
      const context = makeDozerContext({ frameCounter: 200 });

      updateDozerIdleBehavior(entity, state, profile, context);

      expect(state.idleSinceFrame).toBe(200);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. HackInternetAIUpdate tests
// ──────────────────────────────────────────────────────────────────────────────

describe('HackInternetAIUpdate', () => {
  describe('createHackInternetState', () => {
    it('creates a valid initial state', () => {
      const state = createHackInternetState();
      expect(state.state).toBe(HackInternetState.IDLE);
      expect(state.framesRemaining).toBe(0);
      expect(state.totalCashEarned).toBe(0);
    });
  });

  describe('resolveHackInternetCashAmount', () => {
    const profile = makeHackInternetProfile();

    it('returns regular amount for REGULAR veterancy', () => {
      expect(resolveHackInternetCashAmount(profile, VeterancyLevel.REGULAR)).toBe(5);
    });

    it('returns veteran amount for VETERAN veterancy', () => {
      expect(resolveHackInternetCashAmount(profile, VeterancyLevel.VETERAN)).toBe(7);
    });

    it('returns elite amount for ELITE veterancy', () => {
      expect(resolveHackInternetCashAmount(profile, VeterancyLevel.ELITE)).toBe(10);
    });

    it('returns heroic amount for HEROIC veterancy', () => {
      expect(resolveHackInternetCashAmount(profile, VeterancyLevel.HEROIC)).toBe(15);
    });

    it('falls through when higher level amount is 0', () => {
      const profileWithZero = makeHackInternetProfile({
        heroicCashAmount: 0,
        eliteCashAmount: 0,
        veteranCashAmount: 7,
      });
      expect(resolveHackInternetCashAmount(profileWithZero, VeterancyLevel.HEROIC)).toBe(7);
    });

    it('returns 1 when all amounts are 0', () => {
      const zeroProfile = makeHackInternetProfile({
        regularCashAmount: 0,
        veteranCashAmount: 0,
        eliteCashAmount: 0,
        heroicCashAmount: 0,
      });
      expect(resolveHackInternetCashAmount(zeroProfile, VeterancyLevel.REGULAR)).toBe(1);
    });
  });

  describe('beginHackInternet', () => {
    it('transitions from IDLE to UNPACKING', () => {
      const state = createHackInternetState();
      const profile = makeHackInternetProfile({ unpackTimeFrames: 30, packUnpackVariationFactor: 0 });
      const context = makeHackInternetContext({
        randomFloat: vi.fn().mockReturnValue(1.0),
      });

      beginHackInternet(state, profile, context);

      expect(state.state).toBe(HackInternetState.UNPACKING);
      expect(state.framesRemaining).toBe(30);
    });

    it('does nothing if already hacking', () => {
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      beginHackInternet(state, profile, context);

      expect(state.state).toBe(HackInternetState.HACKING);
    });

    it('applies variation factor to unpack time', () => {
      const state = createHackInternetState();
      const profile = makeHackInternetProfile({
        unpackTimeFrames: 100,
        packUnpackVariationFactor: 0.2,
      });
      const context = makeHackInternetContext({
        randomFloat: vi.fn().mockReturnValue(1.15), // between 0.8 and 1.2
      });

      beginHackInternet(state, profile, context);

      expect(state.framesRemaining).toBe(115); // 100 * 1.15
    });
  });

  describe('interruptHackInternet', () => {
    it('transitions from HACKING to PACKING and returns delay', () => {
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      const profile = makeHackInternetProfile({ packTimeFrames: 20, packUnpackVariationFactor: 0 });
      const context = makeHackInternetContext({
        randomFloat: vi.fn().mockReturnValue(1.0),
      });

      const delay = interruptHackInternet(state, profile, context);

      expect(state.state).toBe(HackInternetState.PACKING);
      expect(state.framesRemaining).toBe(20);
      expect(delay).toBe(20);
    });

    it('returns remaining frames when already PACKING', () => {
      const state = createHackInternetState();
      state.state = HackInternetState.PACKING;
      state.framesRemaining = 8;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      const delay = interruptHackInternet(state, profile, context);

      expect(delay).toBe(8);
      expect(state.state).toBe(HackInternetState.PACKING);
    });

    it('goes directly to IDLE when UNPACKING', () => {
      const state = createHackInternetState();
      state.state = HackInternetState.UNPACKING;
      state.framesRemaining = 15;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      const delay = interruptHackInternet(state, profile, context);

      expect(delay).toBe(0);
      expect(state.state).toBe(HackInternetState.IDLE);
      expect(state.framesRemaining).toBe(0);
    });

    it('returns 0 delay when already IDLE', () => {
      const state = createHackInternetState();
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      const delay = interruptHackInternet(state, profile, context);

      expect(delay).toBe(0);
    });
  });

  describe('updateHackInternet', () => {
    it('does nothing when IDLE', () => {
      const entity = makeEntity();
      const state = createHackInternetState();
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(state.state).toBe(HackInternetState.IDLE);
      expect(context.depositCash).not.toHaveBeenCalled();
    });

    it('does nothing when entity is destroyed', () => {
      const entity = makeEntity({ destroyed: true });
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      state.framesRemaining = 0;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(context.depositCash).not.toHaveBeenCalled();
    });

    it('decrements UNPACKING frames', () => {
      const entity = makeEntity();
      const state = createHackInternetState();
      state.state = HackInternetState.UNPACKING;
      state.framesRemaining = 5;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(state.framesRemaining).toBe(4);
      expect(state.state).toBe(HackInternetState.UNPACKING);
    });

    it('transitions from UNPACKING to HACKING when timer reaches 0', () => {
      const entity = makeEntity();
      const state = createHackInternetState();
      state.state = HackInternetState.UNPACKING;
      state.framesRemaining = 0;
      const profile = makeHackInternetProfile({ cashUpdateDelayFrames: 45 });
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(state.state).toBe(HackInternetState.HACKING);
      expect(state.framesRemaining).toBe(45);
    });

    it('decrements HACKING frames while waiting for cash cycle', () => {
      const entity = makeEntity();
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      state.framesRemaining = 10;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(state.framesRemaining).toBe(9);
      expect(context.depositCash).not.toHaveBeenCalled();
    });

    it('deposits cash and resets timer when HACKING cycle completes', () => {
      const entity = makeEntity({ side: 'GLA' });
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      state.framesRemaining = 0;
      const profile = makeHackInternetProfile({
        cashUpdateDelayFrames: 45,
        regularCashAmount: 5,
        xpPerCashUpdate: 2,
      });
      const context = makeHackInternetContext({
        getVeterancyLevel: vi.fn().mockReturnValue(VeterancyLevel.REGULAR),
      });

      updateHackInternet(entity, state, profile, context);

      expect(context.depositCash).toHaveBeenCalledWith('GLA', 5);
      expect(context.grantExperience).toHaveBeenCalledWith(1, 2);
      expect(state.framesRemaining).toBe(45);
      expect(state.totalCashEarned).toBe(5);
    });

    it('uses veterancy-based cash amount', () => {
      const entity = makeEntity({ side: 'GLA' });
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      state.framesRemaining = 0;
      const profile = makeHackInternetProfile({ eliteCashAmount: 10 });
      const context = makeHackInternetContext({
        getVeterancyLevel: vi.fn().mockReturnValue(VeterancyLevel.ELITE),
      });

      updateHackInternet(entity, state, profile, context);

      expect(context.depositCash).toHaveBeenCalledWith('GLA', 10);
    });

    it('does not deposit when entity has no side', () => {
      const entity = makeEntity({ side: undefined });
      const state = createHackInternetState();
      state.state = HackInternetState.HACKING;
      state.framesRemaining = 0;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(context.depositCash).not.toHaveBeenCalled();
      // Timer still resets.
      expect(state.framesRemaining).toBe(profile.cashUpdateDelayFrames);
    });

    it('decrements PACKING frames', () => {
      const entity = makeEntity();
      const state = createHackInternetState();
      state.state = HackInternetState.PACKING;
      state.framesRemaining = 3;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(state.framesRemaining).toBe(2);
      expect(state.state).toBe(HackInternetState.PACKING);
    });

    it('transitions from PACKING to IDLE when timer reaches 0', () => {
      const entity = makeEntity();
      const state = createHackInternetState();
      state.state = HackInternetState.PACKING;
      state.framesRemaining = 0;
      const profile = makeHackInternetProfile();
      const context = makeHackInternetContext();

      updateHackInternet(entity, state, profile, context);

      expect(state.state).toBe(HackInternetState.IDLE);
    });

    it('runs a complete IDLE -> UNPACKING -> HACKING -> cash cycle', () => {
      const entity = makeEntity({ side: 'GLA' });
      const profile = makeHackInternetProfile({
        unpackTimeFrames: 3,
        cashUpdateDelayFrames: 2,
        regularCashAmount: 5,
        packUnpackVariationFactor: 0,
      });
      const context = makeHackInternetContext({
        randomFloat: vi.fn().mockReturnValue(1.0),
      });

      const state = createHackInternetState();

      // Begin hacking.
      beginHackInternet(state, profile, context);
      expect(state.state).toBe(HackInternetState.UNPACKING);
      expect(state.framesRemaining).toBe(3);

      // Tick through unpacking: 3 frames.
      updateHackInternet(entity, state, profile, context); // 3 -> 2
      expect(state.framesRemaining).toBe(2);
      updateHackInternet(entity, state, profile, context); // 2 -> 1
      expect(state.framesRemaining).toBe(1);
      updateHackInternet(entity, state, profile, context); // 1 -> 0
      expect(state.framesRemaining).toBe(0);
      // Next tick transitions to HACKING.
      updateHackInternet(entity, state, profile, context);
      expect(state.state).toBe(HackInternetState.HACKING);
      expect(state.framesRemaining).toBe(2);

      // Tick through hacking delay: 2 frames.
      updateHackInternet(entity, state, profile, context); // 2 -> 1
      expect(state.framesRemaining).toBe(1);
      updateHackInternet(entity, state, profile, context); // 1 -> 0
      expect(state.framesRemaining).toBe(0);

      // Cash deposit happens on next tick.
      updateHackInternet(entity, state, profile, context);
      expect(context.depositCash).toHaveBeenCalledWith('GLA', 5);
      expect(state.totalCashEarned).toBe(5);
      expect(state.framesRemaining).toBe(2); // Reset for next cycle.
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. TransportAIUpdate tests
// ──────────────────────────────────────────────────────────────────────────────

describe('TransportAIUpdate', () => {
  describe('createTransportAIState', () => {
    it('creates a valid initial state', () => {
      const state = createTransportAIState();
      expect(state.flightStatus).toBe(TransportFlightStatus.LANDED);
      expect(state.passengerIds).toEqual([]);
      expect(state.unloadingPassengerIds).toEqual([]);
      expect(state.returnAfterUnload).toBe(false);
    });
  });

  describe('loadPassenger', () => {
    it('adds passenger to the transport', () => {
      const state = createTransportAIState();
      const profile = makeTransportProfile({ maxPassengers: 8 });

      const result = loadPassenger(state, profile, 42);

      expect(result).toBe(true);
      expect(state.passengerIds).toEqual([42]);
    });

    it('rejects when transport is full', () => {
      const state = createTransportAIState();
      state.passengerIds = [1, 2, 3];
      const profile = makeTransportProfile({ maxPassengers: 3 });

      const result = loadPassenger(state, profile, 42);

      expect(result).toBe(false);
      expect(state.passengerIds).toEqual([1, 2, 3]);
    });

    it('rejects duplicate passenger', () => {
      const state = createTransportAIState();
      state.passengerIds = [42];
      const profile = makeTransportProfile({ maxPassengers: 8 });

      const result = loadPassenger(state, profile, 42);

      expect(result).toBe(false);
      expect(state.passengerIds).toEqual([42]);
    });

    it('loads multiple passengers up to capacity', () => {
      const state = createTransportAIState();
      const profile = makeTransportProfile({ maxPassengers: 3 });

      expect(loadPassenger(state, profile, 1)).toBe(true);
      expect(loadPassenger(state, profile, 2)).toBe(true);
      expect(loadPassenger(state, profile, 3)).toBe(true);
      expect(loadPassenger(state, profile, 4)).toBe(false);
      expect(state.passengerIds).toEqual([1, 2, 3]);
    });
  });

  describe('updateTransportUnload', () => {
    it('ejects passengers sequentially with delay', () => {
      const entity = makeEntity();
      const state = createTransportAIState();
      state.passengerIds = [10, 20, 30];
      state.nextUnloadFrame = 100;
      const profile = makeTransportProfile({
        combatDrop: {
          numRopes: 2,
          perRopeDelayMinFrames: 5,
          perRopeDelayMaxFrames: 10,
          rappelSpeed: 2,
        },
      });
      const ejectPassenger = vi.fn();
      const context = makeTransportContext({
        frameCounter: 100,
        ejectPassenger,
        randomInt: vi.fn().mockReturnValue(5),
      });

      const done = updateTransportUnload(entity, state, profile, context);

      expect(done).toBe(false);
      expect(ejectPassenger).toHaveBeenCalledWith(1, 10);
      expect(state.passengerIds).toEqual([20, 30]);
      expect(state.unloadingPassengerIds).toEqual([10]);
      expect(state.nextUnloadFrame).toBe(105); // 100 + 5
    });

    it('returns true when all passengers are unloaded', () => {
      const entity = makeEntity();
      const state = createTransportAIState();
      state.passengerIds = [];
      state.unloadingPassengerIds = [];
      const profile = makeTransportProfile();
      const context = makeTransportContext();

      const done = updateTransportUnload(entity, state, profile, context);

      expect(done).toBe(true);
    });

    it('cleans up dead passengers from unloading list', () => {
      const entity = makeEntity();
      const state = createTransportAIState();
      state.passengerIds = [];
      state.unloadingPassengerIds = [10, 20];
      const profile = makeTransportProfile();
      const isPassengerAlive = vi.fn().mockImplementation(
        (id: number) => id !== 10, // 10 is dead
      );
      const context = makeTransportContext({ isPassengerAlive });

      const done = updateTransportUnload(entity, state, profile, context);

      // 10 was removed from unloading, 20 still alive.
      expect(state.unloadingPassengerIds).toEqual([20]);
      expect(done).toBe(false);
    });

    it('waits when not at nextUnloadFrame', () => {
      const entity = makeEntity();
      const state = createTransportAIState();
      state.passengerIds = [10];
      state.nextUnloadFrame = 200;
      const profile = makeTransportProfile();
      const context = makeTransportContext({ frameCounter: 150 });

      const done = updateTransportUnload(entity, state, profile, context);

      expect(done).toBe(false);
      expect(context.ejectPassenger).not.toHaveBeenCalled();
    });

    it('uses 1-frame delay for ground transports', () => {
      const entity = makeEntity();
      const state = createTransportAIState();
      state.passengerIds = [10, 20];
      state.nextUnloadFrame = 100;
      const profile = makeTransportProfile({ combatDrop: null });
      const context = makeTransportContext({ frameCounter: 100 });

      updateTransportUnload(entity, state, profile, context);

      expect(state.nextUnloadFrame).toBe(101);
    });
  });

  describe('updateTransportFlightTransition', () => {
    it('completes takeoff transition', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.TAKING_OFF;
      state.transitionFinishFrame = 100;
      const context = makeTransportContext({ frameCounter: 100 });

      updateTransportFlightTransition(state, context);

      expect(state.flightStatus).toBe(TransportFlightStatus.FLYING);
      expect(state.transitionFinishFrame).toBe(0);
    });

    it('completes landing transition', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.LANDING;
      state.transitionFinishFrame = 50;
      const context = makeTransportContext({ frameCounter: 50 });

      updateTransportFlightTransition(state, context);

      expect(state.flightStatus).toBe(TransportFlightStatus.LANDED);
    });

    it('does nothing when no transition is pending', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.FLYING;
      state.transitionFinishFrame = 0;
      const context = makeTransportContext();

      updateTransportFlightTransition(state, context);

      expect(state.flightStatus).toBe(TransportFlightStatus.FLYING);
    });

    it('does nothing before transition frame', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.TAKING_OFF;
      state.transitionFinishFrame = 200;
      const context = makeTransportContext({ frameCounter: 100 });

      updateTransportFlightTransition(state, context);

      expect(state.flightStatus).toBe(TransportFlightStatus.TAKING_OFF);
    });
  });

  describe('beginTakeoff', () => {
    it('starts takeoff from landed state', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.LANDED;
      const context = makeTransportContext({ frameCounter: 100 });

      beginTakeoff(state, context, 30);

      expect(state.flightStatus).toBe(TransportFlightStatus.TAKING_OFF);
      expect(state.transitionFinishFrame).toBe(130);
    });

    it('does nothing when already flying', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.FLYING;
      const context = makeTransportContext({ frameCounter: 100 });

      beginTakeoff(state, context, 30);

      expect(state.flightStatus).toBe(TransportFlightStatus.FLYING);
      expect(state.transitionFinishFrame).toBe(0);
    });
  });

  describe('beginLanding', () => {
    it('starts landing from flying state', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.FLYING;
      const context = makeTransportContext({ frameCounter: 100 });

      beginLanding(state, context, 20);

      expect(state.flightStatus).toBe(TransportFlightStatus.LANDING);
      expect(state.transitionFinishFrame).toBe(120);
    });

    it('does nothing when already landed', () => {
      const state = createTransportAIState();
      state.flightStatus = TransportFlightStatus.LANDED;
      const context = makeTransportContext({ frameCounter: 100 });

      beginLanding(state, context, 20);

      expect(state.flightStatus).toBe(TransportFlightStatus.LANDED);
    });
  });

  describe('full transport lifecycle', () => {
    it('load, takeoff, fly, land, unload', () => {
      const entity = makeEntity();
      const profile = makeTransportProfile({
        maxPassengers: 3,
        combatDrop: null,
      });
      const state = createTransportAIState();
      const isPassengerAlive = vi.fn().mockReturnValue(true);
      const ejectPassenger = vi.fn();

      // Use a mutable ref for frameCounter so the context always reads the latest value.
      const ref = { frameCounter: 0 };
      const context: TransportAIContext = {
        get frameCounter() { return ref.frameCounter; },
        isPassengerAlive,
        ejectPassenger,
        moveTransportTo: vi.fn(),
        randomInt: vi.fn().mockReturnValue(0),
      };

      // Load passengers.
      expect(loadPassenger(state, profile, 10)).toBe(true);
      expect(loadPassenger(state, profile, 20)).toBe(true);
      expect(loadPassenger(state, profile, 30)).toBe(true);
      expect(state.passengerIds).toEqual([10, 20, 30]);

      // Takeoff.
      beginTakeoff(state, context, 5);
      expect(state.flightStatus).toBe(TransportFlightStatus.TAKING_OFF);

      // Wait for takeoff to complete.
      ref.frameCounter = 5;
      updateTransportFlightTransition(state, context);
      expect(state.flightStatus).toBe(TransportFlightStatus.FLYING);

      // Landing.
      beginLanding(state, context, 5);
      expect(state.flightStatus).toBe(TransportFlightStatus.LANDING);
      ref.frameCounter = 10;
      updateTransportFlightTransition(state, context);
      expect(state.flightStatus).toBe(TransportFlightStatus.LANDED);

      // Unload passengers.
      beginUnload(state, profile, context, false);
      let done = updateTransportUnload(entity, state, profile, context);
      expect(done).toBe(false);
      expect(ejectPassenger).toHaveBeenCalledWith(1, 10);

      ref.frameCounter = 11;
      done = updateTransportUnload(entity, state, profile, context);
      expect(done).toBe(false);
      expect(ejectPassenger).toHaveBeenCalledWith(1, 20);

      ref.frameCounter = 12;
      done = updateTransportUnload(entity, state, profile, context);
      expect(done).toBe(false);
      expect(ejectPassenger).toHaveBeenCalledWith(1, 30);

      // All passengers ejected; now in unloading state.
      // Mark all as no longer alive (they exited).
      isPassengerAlive.mockReturnValue(false);
      ref.frameCounter = 13;
      done = updateTransportUnload(entity, state, profile, context);
      expect(done).toBe(true);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. WorkerAIUpdate tests
// ──────────────────────────────────────────────────────────────────────────────

describe('WorkerAIUpdate', () => {
  describe('resolveWorkerRole', () => {
    it('returns DOZER when dozer task is active', () => {
      expect(resolveWorkerRole(true, false)).toBe(WorkerRole.DOZER);
    });

    it('returns SUPPLY_TRUCK when supply task is active', () => {
      expect(resolveWorkerRole(false, true)).toBe(WorkerRole.SUPPLY_TRUCK);
    });

    it('returns DOZER when no tasks are active (default)', () => {
      expect(resolveWorkerRole(false, false)).toBe(WorkerRole.DOZER);
    });

    it('prefers DOZER when both tasks are active', () => {
      expect(resolveWorkerRole(true, true)).toBe(WorkerRole.DOZER);
    });
  });

  describe('createWorkerAIState', () => {
    it('creates a valid initial state', () => {
      const state = createWorkerAIState(50);
      expect(state.currentRole).toBe(WorkerRole.DOZER);
      expect(state.dozerState.currentTask).toBe(DozerTask.INVALID);
      expect(state.dozerState.idleSinceFrame).toBe(50);
    });
  });
});
