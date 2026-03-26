/**
 * Parity tests for RailedTransportAIUpdate + RailedTransportDockUpdate fields
 * and PrisonBehavior + PropagandaCenterBehavior fields.
 *
 * Source references:
 *   RailedTransportAIUpdate.cpp:52-64  — PathPrefixName
 *   RailedTransportDockUpdate.cpp:60-75 — PullInsideDuration, PushOutsideDuration
 *   PrisonBehavior.cpp:105-116          — ShowPrisoners, YardBonePrefix
 *   PropagandaCenterBehavior.cpp:62-72  — BrainwashDuration (extends PrisonBehavior)
 */

import { describe, expect, it } from 'vitest';

import { extractRailedTransportProfile } from './railed-transport.js';
import { extractPrisonBehaviorProfile } from './entity-factory.js';
import {
  makeBlock,
  makeObjectDef,
} from './test-helpers.js';

// Stub self with msToLogicFrames for extractPrisonBehaviorProfile.
const self = {
  msToLogicFrames: (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.max(1, Math.ceil(ms / (1000 / 30)));
  },
} as any;

// ---------------------------------------------------------------------------
// RailedTransportProfile: PathPrefixName + Dock PullInside/PushOutside
// ---------------------------------------------------------------------------

describe('RailedTransportProfile (C++ parity)', () => {
  it('extracts PathPrefixName from RailedTransportAIUpdate', () => {
    // Source parity: RailedTransportAIUpdate.cpp:52-64 — PathPrefixName parsed as AsciiString.
    const def = makeObjectDef('TrainEngine', '', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_AI', {
        PathPrefixName: 'TrainPath',
      }),
    ]);

    const profile = extractRailedTransportProfile(def);
    expect(profile).not.toBeNull();
    expect(profile!.pathPrefixName).toBe('TrainPath');
  });

  it('extracts PullInsideDuration and PushOutsideDuration from RailedTransportDockUpdate', () => {
    // Source parity: RailedTransportDockUpdate.cpp:60-75
    // parseDurationUnsignedInt converts ms → frames:
    //   PullInsideDuration = 1000ms → 30 frames (at 30fps)
    //   PushOutsideDuration = 2000ms → 60 frames (at 30fps)
    const def = makeObjectDef('TrainStation', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 1000,
        InitialHealth: 1000,
      }),
      makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_AI', {
        PathPrefixName: 'StationPath',
      }),
      makeBlock('Behavior', 'RailedTransportDockUpdate ModuleTag_Dock', {
        PullInsideDuration: 1000,
        PushOutsideDuration: 2000,
      }),
    ]);

    const profile = extractRailedTransportProfile(def);
    expect(profile).not.toBeNull();
    expect(profile!.pathPrefixName).toBe('StationPath');
    expect(profile!.pullInsideDurationFrames).toBe(30);
    expect(profile!.pushOutsideDurationFrames).toBe(60);
  });

  it('returns null when no RailedTransportAIUpdate module is present', () => {
    const def = makeObjectDef('RegularUnit', '', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 200,
        InitialHealth: 200,
      }),
    ]);

    const profile = extractRailedTransportProfile(def);
    expect(profile).toBeNull();
  });

  it('defaults dock durations to 0 when RailedTransportDockUpdate is absent', () => {
    // Source parity: only RailedTransportAIUpdate present, no dock module.
    const def = makeObjectDef('TrainOnly', '', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 300,
        InitialHealth: 300,
      }),
      makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_AI', {
        PathPrefixName: 'Rail',
      }),
    ]);

    const profile = extractRailedTransportProfile(def);
    expect(profile).not.toBeNull();
    expect(profile!.pullInsideDurationFrames).toBe(0);
    expect(profile!.pushOutsideDurationFrames).toBe(0);
  });

  it('returns null for undefined objectDef', () => {
    const profile = extractRailedTransportProfile(undefined);
    expect(profile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PrisonBehaviorProfile: ShowPrisoners, YardBonePrefix, BrainwashDuration
// ---------------------------------------------------------------------------

describe('PrisonBehaviorProfile (C++ parity)', () => {
  it('extracts ShowPrisoners and YardBonePrefix from PrisonBehavior', () => {
    // Source parity: PrisonBehavior.cpp:105-116
    const def = makeObjectDef('Prison', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 800,
        InitialHealth: 800,
      }),
      makeBlock('Behavior', 'PrisonBehavior ModuleTag_Prison', {
        ShowPrisoners: true,
        YardBonePrefix: 'YOURBONE',
      }),
    ]);

    const profile = extractPrisonBehaviorProfile(self, def);
    expect(profile).not.toBeNull();
    expect(profile!.showPrisoners).toBe(true);
    expect(profile!.yardBonePrefix).toBe('YOURBONE');
    // PrisonBehavior has no brainwash — duration should be 0
    expect(profile!.brainwashDurationFrames).toBe(0);
  });

  it('extracts BrainwashDuration from PropagandaCenterBehavior', () => {
    // Source parity: PropagandaCenterBehavior.cpp:62-72
    // BrainwashDuration = 3000ms → 90 frames (at 30fps)
    const def = makeObjectDef('PropCenter', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 1200,
        InitialHealth: 1200,
      }),
      makeBlock('Behavior', 'PropagandaCenterBehavior ModuleTag_Prop', {
        ShowPrisoners: false,
        YardBonePrefix: 'CAGE',
        BrainwashDuration: 3000,
      }),
    ]);

    const profile = extractPrisonBehaviorProfile(self, def);
    expect(profile).not.toBeNull();
    expect(profile!.showPrisoners).toBe(false);
    expect(profile!.yardBonePrefix).toBe('CAGE');
    expect(profile!.brainwashDurationFrames).toBe(90);
  });

  it('returns null when no PrisonBehavior or PropagandaCenterBehavior module is present', () => {
    const def = makeObjectDef('RegularBuilding', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    const profile = extractPrisonBehaviorProfile(self, def);
    expect(profile).toBeNull();
  });

  it('defaults ShowPrisoners to false and YardBonePrefix to empty when not specified', () => {
    // Source parity: C++ defaults — ShowPrisoners false, YardBonePrefix empty string.
    const def = makeObjectDef('MinimalPrison', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 600,
        InitialHealth: 600,
      }),
      makeBlock('Behavior', 'PrisonBehavior ModuleTag_Prison', {}),
    ]);

    const profile = extractPrisonBehaviorProfile(self, def);
    expect(profile).not.toBeNull();
    expect(profile!.showPrisoners).toBe(false);
    expect(profile!.yardBonePrefix).toBe('');
    expect(profile!.brainwashDurationFrames).toBe(0);
  });

  it('converts BrainwashDuration correctly for fractional frame values', () => {
    // 500ms → ceil(500 / 33.333) = ceil(15.0) = 15 frames
    const def = makeObjectDef('QuickProp', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 400,
        InitialHealth: 400,
      }),
      makeBlock('Behavior', 'PropagandaCenterBehavior ModuleTag_Prop', {
        BrainwashDuration: 500,
      }),
    ]);

    const profile = extractPrisonBehaviorProfile(self, def);
    expect(profile).not.toBeNull();
    expect(profile!.brainwashDurationFrames).toBe(15);
  });

  it('returns null for undefined objectDef', () => {
    const profile = extractPrisonBehaviorProfile(self, undefined);
    expect(profile).toBeNull();
  });
});
