/**
 * Tests for module profile field extraction — verifying source parity for
 * SupplyWarehouseDockUpdate, ChinookAIUpdate, and HelicopterSlowDeathBehavior fields.
 *
 * Source parity:
 *   SupplyWarehouseDockUpdate.cpp — DeleteWhenEmpty, StartingBoxes
 *   ChinookAIUpdate.cpp — MinDropHeight, WaitForRopesToDrop, NumRopes, PerRopeDelayMin/Max
 *   HelicopterSlowDeathUpdate.cpp — MaxBraking, BladeObjectName, BladeBoneName,
 *     SelfSpinUpdateDelay, SelfSpinUpdateAmount, FallHowFast, DelayFromGroundToFinalDeath,
 *     FinalRubbleObject
 */

import { describe, expect, it } from 'vitest';

import { extractSupplyWarehouseProfile, extractHelicopterSlowDeathProfiles } from './entity-factory.js';
import { extractChinookAIProfile } from './aircraft-ai.js';
import { LOGIC_FRAME_RATE } from './index.js';
import { makeBlock, makeObjectDef } from './test-helpers.js';

// Minimal self mock for extraction functions that need msToLogicFrames.
const LOGIC_FRAME_MS = 1000 / LOGIC_FRAME_RATE;
function makeSelf() {
  return {
    msToLogicFrames(ms: number): number {
      if (!Number.isFinite(ms) || ms <= 0) return 0;
      return Math.max(1, Math.ceil(ms / LOGIC_FRAME_MS));
    },
    resolveObjectDefParent(): null {
      return null;
    },
  } as any;
}

// ── SupplyWarehouseDockUpdate ─────────────────────────────────────────────

describe('SupplyWarehouseDockUpdate profile extraction', () => {
  it('extracts DeleteWhenEmpty = true', () => {
    const objectDef = makeObjectDef('WarehouseA', 'GLA', [], [
      makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
        StartingBoxes: 50,
        DeleteWhenEmpty: 'Yes',
      }),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.startingBoxes).toBe(50);
    expect(profile!.deleteWhenEmpty).toBe(true);
  });

  it('extracts DeleteWhenEmpty = false (default)', () => {
    const objectDef = makeObjectDef('WarehouseB', 'GLA', [], [
      makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
        StartingBoxes: 10,
      }),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.deleteWhenEmpty).toBe(false);
  });

  it('defaults StartingBoxes to 1 when absent (C++ m_startingBoxesData = 1)', () => {
    const objectDef = makeObjectDef('WarehouseC', 'GLA', [], [
      makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {}),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.startingBoxes).toBe(1);
  });

  it('returns null for non-warehouse objects', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).toBeNull();
  });
});

// ── ChinookAIUpdate ───────────────────────────────────────────────────────

describe('ChinookAIUpdate profile extraction', () => {
  it('extracts all 5 gameplay fields from INI', () => {
    const objectDef = makeObjectDef('Chinook', 'America', ['AIRCRAFT', 'TRANSPORT'], [
      makeBlock('Behavior', 'ChinookAIUpdate ModuleTag_AI', {
        NumRopes: 3,
        PerRopeDelayMin: 200,
        PerRopeDelayMax: 500,
        MinDropHeight: 40,
        WaitForRopesToDrop: 'Yes',
      }),
    ]);
    const profile = extractChinookAIProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();

    // NumRopes: unsigned int, direct.
    expect(profile!.numRopes).toBe(3);

    // PerRopeDelayMin: 200ms → frames. msToLogicFrames(200) = ceil(200/33.333) = 6.
    expect(profile!.perRopeDelayMinFrames).toBe(makeSelf().msToLogicFrames(200));

    // PerRopeDelayMax: 500ms → frames. msToLogicFrames(500) = ceil(500/33.333) = 15.
    expect(profile!.perRopeDelayMaxFrames).toBe(makeSelf().msToLogicFrames(500));

    // MinDropHeight: raw float (no conversion).
    expect(profile!.minDropHeight).toBe(40);

    // WaitForRopesToDrop: boolean.
    expect(profile!.waitForRopesToDrop).toBe(true);
  });

  it('uses correct defaults when fields are absent', () => {
    const objectDef = makeObjectDef('ChinookDefault', 'America', ['AIRCRAFT'], [
      makeBlock('Behavior', 'ChinookAIUpdate ModuleTag_AI', {}),
    ]);
    const profile = extractChinookAIProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();

    // C++ default: m_numRopes = 0 but browser port defaults to max(1, trunc(4)) = 4.
    expect(profile!.numRopes).toBe(4);

    // C++ default: PerRopeDelayMin/Max = 0x7fffffff ms → large frame count.
    expect(profile!.perRopeDelayMinFrames).toBeGreaterThan(1000);
    expect(profile!.perRopeDelayMaxFrames).toBeGreaterThan(1000);

    // C++ default: MinDropHeight = 0 but browser port defaults to 30.
    expect(profile!.minDropHeight).toBe(30);

    // C++ default: WaitForRopesToDrop = FALSE but browser port defaults to true.
    expect(profile!.waitForRopesToDrop).toBe(true);
  });

  it('returns null for non-chinook objects', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profile = extractChinookAIProfile(makeSelf(), objectDef);
    expect(profile).toBeNull();
  });
});

// ── HelicopterSlowDeathBehavior ───────────────────────────────────────────

describe('HelicopterSlowDeathBehavior profile extraction', () => {
  it('extracts all 8 gameplay fields from INI', () => {
    const objectDef = makeObjectDef('Comanche', 'America', ['AIRCRAFT'], [
      makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_Death', {
        SelfSpinUpdateDelay: 100,
        SelfSpinUpdateAmount: 45,
        FallHowFast: 25,
        MaxBraking: 270,
        DelayFromGroundToFinalDeath: 1000,
        FinalRubbleObject: 'ComancheRubble',
        BladeObjectName: 'ComancheBlades',
        BladeBoneName: 'YOURBONE',
      }),
    ]);
    const profiles = extractHelicopterSlowDeathProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;

    // SelfSpinUpdateDelay: 100ms → frames. msToLogicFrames(100) = ceil(100/33.333) = 3.
    expect(p.selfSpinUpdateDelay).toBe(makeSelf().msToLogicFrames(100));

    // SelfSpinUpdateAmount: 45 degrees → radians. parseAngleReal: deg * PI/180.
    expect(p.selfSpinUpdateAmount).toBeCloseTo(45 * Math.PI / 180, 5);

    // FallHowFast: 25% → 0.25. parsePercentToReal: value / 100.
    expect(p.fallHowFast).toBeCloseTo(0.25, 5);

    // MaxBraking: 270 dist/sec² → dist/frame² = 270 / (30*30) = 0.3.
    expect(p.maxBraking).toBeCloseTo(270 / (LOGIC_FRAME_RATE * LOGIC_FRAME_RATE), 5);

    // DelayFromGroundToFinalDeath: 1000ms → frames = 30.
    expect(p.delayFromGroundToFinalDeath).toBe(makeSelf().msToLogicFrames(1000));

    // FinalRubbleObject: string.
    expect(p.finalRubbleObject).toBe('ComancheRubble');

    // BladeObjectName: string.
    expect(p.bladeObjectName).toBe('ComancheBlades');

    // BladeBoneName: string.
    expect(p.bladeBoneName).toBe('YOURBONE');
  });

  it('uses correct defaults when fields are absent', () => {
    const objectDef = makeObjectDef('ComancheDefault', 'America', ['AIRCRAFT'], [
      makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_Death', {}),
    ]);
    const profiles = extractHelicopterSlowDeathProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;

    // C++ defaults:
    // m_selfSpinUpdateDelay = 0 → 0 frames.
    expect(p.selfSpinUpdateDelay).toBe(0);

    // m_selfSpinUpdateAmount = 0 → 0 radians.
    expect(p.selfSpinUpdateAmount).toBeCloseTo(0, 5);

    // m_fallHowFast defaults to 50% (browser port default) → 0.5.
    expect(p.fallHowFast).toBeCloseTo(0.5, 5);

    // m_maxBraking = 99999.0f (C++ default, already in frame units).
    expect(p.maxBraking).toBeCloseTo(99999.0, 1);

    // m_delayFromGroundToFinalDeath = 0 → 0 frames.
    expect(p.delayFromGroundToFinalDeath).toBe(0);

    // m_finalRubbleObject defaults to empty string.
    expect(p.finalRubbleObject).toBe('');

    // m_bladeObjectName defaults to empty string.
    expect(p.bladeObjectName).toBe('');

    // m_bladeBone defaults to empty string.
    expect(p.bladeBoneName).toBe('');
  });

  it('parses MaxBraking with correct acceleration conversion (÷900)', () => {
    // C++ parseAccelerationReal divides by LOGICFRAMES_PER_SECOND^2 = 30^2 = 900.
    const objectDef = makeObjectDef('Apache', 'America', ['AIRCRAFT'], [
      makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_Death', {
        MaxBraking: 900,
      }),
    ]);
    const profiles = extractHelicopterSlowDeathProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    // 900 / 900 = 1.0 dist/frame².
    expect(profiles[0]!.maxBraking).toBeCloseTo(1.0, 5);
  });

  it('extracts BladeObjectName and BladeBoneName from real-world INI pattern', () => {
    // Matches Comanche from retail INI: BladeObjectName = ComancheBlades, BladeBoneName = RBlade01.
    const objectDef = makeObjectDef('AmericaVehicleComanche', 'America', ['AIRCRAFT'], [
      makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_SlowDeath', {
        DeathTypes: 'ALL',
        SpiralOrbitTurnRate: 180,
        SpiralOrbitForwardSpeed: 300,
        SelfSpinUpdateDelay: 100,
        SelfSpinUpdateAmount: 10,
        FallHowFast: 15,
        MaxBraking: 140,
        DelayFromGroundToFinalDeath: 3000,
        FinalRubbleObject: 'ComancheRubble',
        BladeObjectName: 'ComancheBlades',
        BladeBoneName: 'RBlade01',
      }),
    ]);
    const profiles = extractHelicopterSlowDeathProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;
    expect(p.bladeObjectName).toBe('ComancheBlades');
    expect(p.bladeBoneName).toBe('RBlade01');
    expect(p.finalRubbleObject).toBe('ComancheRubble');
    expect(p.maxBraking).toBeCloseTo(140 / 900, 5);
  });

  it('returns empty array for non-helicopter objects', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profiles = extractHelicopterSlowDeathProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(0);
  });
});
