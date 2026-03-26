/**
 * WorkerAIProfile + POWTruckAIProfile field extraction tests.
 *
 * Verifies that the following C++ FieldParse fields are correctly extracted:
 *
 * WorkerAIUpdate (WorkerAIUpdate.h lines 96-108):
 *   1. RepairHealthPercentPerSecond (parsePercentToReal → 0..1)
 *   2. BoredTime (parseDurationReal → frames)
 *   3. BoredRange (parseReal)
 *   4. SuppliesDepletedVoice (parseAudioEventRTS → string)
 *
 * POWTruckAIUpdate (POWTruckAIUpdate.cpp lines 68-73):
 *   1. BoredTime (parseDurationUnsignedInt → frames)
 *   2. AtPrisonDistance (parseReal)
 *
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Include/GameLogic/Module/WorkerAIUpdate.h
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate/POWTruckAIUpdate.cpp
 */
import { describe, expect, it } from 'vitest';
import {
  extractWorkerAIProfile,
  extractPOWTruckAIProfile,
} from './entity-factory.js';
import {
  makeBlock,
  makeObjectDef,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Minimal GL stub for msToLogicFrames / msToLogicFramesReal
// ---------------------------------------------------------------------------

/** Stub matching the GL methods used by extract*Profile functions. */
const glStub = {
  /** parseDurationReal: ceil(ms / 1000 * 30) but as fractional real. */
  msToLogicFramesReal(ms: number): number {
    return (ms / 1000) * 30;
  },
  /** parseDurationUnsignedInt: truncated integer frames. */
  msToLogicFrames(ms: number): number {
    return Math.ceil((ms / 1000) * 30);
  },
};

// ===========================================================================
// 1. extractWorkerAIProfile
// ===========================================================================

describe('extractWorkerAIProfile', () => {
  it('returns null when objectDef is undefined', () => {
    expect(extractWorkerAIProfile(glStub, undefined)).toBeNull();
  });

  it('returns null when no WORKERAIUPDATE block is present', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
    ]);
    expect(extractWorkerAIProfile(glStub, objectDef)).toBeNull();
  });

  it('does not match DOZERAIUPDATE (Worker-specific only)', () => {
    const objectDef = makeObjectDef('Dozer', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
        RepairHealthPercentPerSecond: 5,
        BoredTime: 3000,
        BoredRange: 200,
      }),
    ]);
    expect(extractWorkerAIProfile(glStub, objectDef)).toBeNull();
  });

  it('extracts all 4 Worker-specific fields from WORKERAIUPDATE', () => {
    const objectDef = makeObjectDef('GLAWorker', 'GLA', ['INFANTRY'], [
      makeBlock('Behavior', 'WorkerAIUpdate ModuleTag_WorkerAI', {
        RepairHealthPercentPerSecond: 5,
        BoredTime: 3000,
        BoredRange: 200,
        SuppliesDepletedVoice: 'WorkerVoiceSuppliesDepleted',
      }),
    ]);

    const profile = extractWorkerAIProfile(glStub, objectDef);
    expect(profile).not.toBeNull();

    // RepairHealthPercentPerSecond: parsePercentToReal → 5 / 100 = 0.05
    expect(profile!.repairHealthPercentPerSecond).toBeCloseTo(0.05, 6);

    // BoredTime: parseDurationReal → 3000ms / 1000 * 30 = 90 frames
    expect(profile!.boredTimeFrames).toBeCloseTo(90, 6);

    // BoredRange: parseReal → 200
    expect(profile!.boredRange).toBe(200);

    // SuppliesDepletedVoice: parseAudioEventRTS → string
    expect(profile!.suppliesDepletedVoice).toBe('WorkerVoiceSuppliesDepleted');
  });

  it('handles default values when fields are omitted', () => {
    const objectDef = makeObjectDef('GLAWorker', 'GLA', ['INFANTRY'], [
      makeBlock('Behavior', 'WorkerAIUpdate ModuleTag_WorkerAI', {}),
    ]);

    const profile = extractWorkerAIProfile(glStub, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.repairHealthPercentPerSecond).toBe(0);
    expect(profile!.boredTimeFrames).toBe(0);
    expect(profile!.boredRange).toBe(0);
    expect(profile!.suppliesDepletedVoice).toBe('');
  });

  it('clamps negative RepairHealthPercentPerSecond to 0', () => {
    const objectDef = makeObjectDef('GLAWorker', 'GLA', ['INFANTRY'], [
      makeBlock('Behavior', 'WorkerAIUpdate ModuleTag_WorkerAI', {
        RepairHealthPercentPerSecond: -10,
      }),
    ]);

    const profile = extractWorkerAIProfile(glStub, objectDef);
    expect(profile!.repairHealthPercentPerSecond).toBe(0);
  });

  it('clamps negative BoredRange to 0', () => {
    const objectDef = makeObjectDef('GLAWorker', 'GLA', ['INFANTRY'], [
      makeBlock('Behavior', 'WorkerAIUpdate ModuleTag_WorkerAI', {
        BoredRange: -50,
      }),
    ]);

    const profile = extractWorkerAIProfile(glStub, objectDef);
    expect(profile!.boredRange).toBe(0);
  });

  it('finds WORKERAIUPDATE inside nested blocks', () => {
    const objectDef = makeObjectDef('GLAWorker', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
      makeBlock('Draw', 'W3DModelDraw ModuleTag_Draw', {}, [
        makeBlock('Behavior', 'WorkerAIUpdate ModuleTag_WorkerAI', {
          RepairHealthPercentPerSecond: 10,
          BoredTime: 5000,
          BoredRange: 300,
          SuppliesDepletedVoice: 'NestedVoice',
        }),
      ]),
    ]);

    const profile = extractWorkerAIProfile(glStub, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.repairHealthPercentPerSecond).toBeCloseTo(0.10, 6);
    expect(profile!.suppliesDepletedVoice).toBe('NestedVoice');
  });
});

// ===========================================================================
// 2. extractPOWTruckAIProfile
// ===========================================================================

describe('extractPOWTruckAIProfile', () => {
  it('returns null when objectDef is undefined', () => {
    expect(extractPOWTruckAIProfile(glStub, undefined)).toBeNull();
  });

  it('returns null when no POWTRUCKAIUPDATE block is present', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
    ]);
    expect(extractPOWTruckAIProfile(glStub, objectDef)).toBeNull();
  });

  it('does not match WORKERAIUPDATE (POWTruck-specific only)', () => {
    const objectDef = makeObjectDef('Worker', 'GLA', ['INFANTRY'], [
      makeBlock('Behavior', 'WorkerAIUpdate ModuleTag_AI', {
        BoredTime: 3000,
      }),
    ]);
    expect(extractPOWTruckAIProfile(glStub, objectDef)).toBeNull();
  });

  it('extracts both POWTruck fields from POWTRUCKAIUPDATE', () => {
    const objectDef = makeObjectDef('GLAPOWTruck', 'GLA', ['VEHICLE'], [
      makeBlock('Behavior', 'POWTruckAIUpdate ModuleTag_POWAI', {
        BoredTime: 5000,
        AtPrisonDistance: 100,
      }),
    ]);

    const profile = extractPOWTruckAIProfile(glStub, objectDef);
    expect(profile).not.toBeNull();

    // BoredTime: parseDurationUnsignedInt → ceil(5000ms / 1000 * 30) = 150 frames
    expect(profile!.boredTimeFrames).toBe(150);

    // AtPrisonDistance: parseReal → 100
    expect(profile!.atPrisonDistance).toBe(100);
  });

  it('handles default values when fields are omitted', () => {
    const objectDef = makeObjectDef('GLAPOWTruck', 'GLA', ['VEHICLE'], [
      makeBlock('Behavior', 'POWTruckAIUpdate ModuleTag_POWAI', {}),
    ]);

    const profile = extractPOWTruckAIProfile(glStub, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.boredTimeFrames).toBe(0);
    expect(profile!.atPrisonDistance).toBe(0);
  });

  it('clamps negative AtPrisonDistance to 0', () => {
    const objectDef = makeObjectDef('GLAPOWTruck', 'GLA', ['VEHICLE'], [
      makeBlock('Behavior', 'POWTruckAIUpdate ModuleTag_POWAI', {
        AtPrisonDistance: -25,
      }),
    ]);

    const profile = extractPOWTruckAIProfile(glStub, objectDef);
    expect(profile!.atPrisonDistance).toBe(0);
  });

  it('finds POWTRUCKAIUPDATE inside nested blocks', () => {
    const objectDef = makeObjectDef('GLAPOWTruck', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200 }),
      makeBlock('Draw', 'W3DModelDraw ModuleTag_Draw', {}, [
        makeBlock('Behavior', 'POWTruckAIUpdate ModuleTag_POWAI', {
          BoredTime: 2000,
          AtPrisonDistance: 75,
        }),
      ]),
    ]);

    const profile = extractPOWTruckAIProfile(glStub, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.boredTimeFrames).toBe(60); // ceil(2000/1000*30) = 60
    expect(profile!.atPrisonDistance).toBe(75);
  });
});
