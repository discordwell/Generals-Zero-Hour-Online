/**
 * Parity Tests — missing fields for GenerateMinefieldBehavior, DemoTrapUpdate, and OCLUpdate.
 *
 * C++ source:
 *   GenerateMinefieldBehavior.cpp:69-95 — MinesPerSquareFoot, SmartBorder,
 *     SmartBorderSkipInterior, RandomJitter, SkipIfThisMuchUnderStructure
 *   DemoTrapUpdate.cpp:54-73 — DetonationWeaponSlot, ProximityModeWeaponSlot,
 *     ManualModeWeaponSlot (parseLookupList with TheWeaponSlotTypeNames)
 *   OCLUpdate.cpp:48-61 — CreateAtEdge (parseBool, default FALSE)
 */

import { describe, expect, it } from 'vitest';

import {
  extractGenerateMinefieldProfile,
  extractDemoTrapProfile,
  extractOCLUpdateProfiles,
} from './entity-factory.js';
import { LOGIC_FRAME_RATE } from './index.js';
import { makeBlock, makeObjectDef } from './test-helpers.js';

// Minimal self mock for extraction functions that need msToLogicFrames / parsePercent.
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

// ── GenerateMinefieldProfile ────────────────────────────────────────────────

describe('GenerateMinefieldProfile extraction — new fields', () => {
  it('extracts all 5 new fields when specified', () => {
    const objectDef = makeObjectDef('MineLayer', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'GenerateMinefieldBehavior ModuleTag_Mines', {
        MineName: 'TestMine',
        DistanceAroundObject: 30,
        MinesPerSquareFoot: 0.05,
        SmartBorder: 'Yes',
        SmartBorderSkipInterior: 'No',
        RandomJitter: 25,   // 25% → 0.25
        SkipIfThisMuchUnderStructure: 50, // 50% → 0.50
      }),
    ]);
    const profile = extractGenerateMinefieldProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.minesPerSquareFoot).toBe(0.05);
    expect(profile!.smartBorder).toBe(true);
    expect(profile!.smartBorderSkipInterior).toBe(false);
    expect(profile!.randomJitter).toBeCloseTo(0.25, 6);
    expect(profile!.skipIfThisMuchUnderStructure).toBeCloseTo(0.50, 6);
  });

  it('uses C++ defaults when fields are absent', () => {
    // C++ defaults: m_minesPerSquareFoot=0.01, m_smartBorder=false,
    // m_smartBorderSkipInterior=true, m_randomJitter=0.0, m_skipIfThisMuchUnderStructure=0.33
    const objectDef = makeObjectDef('MineLayerDefaults', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'GenerateMinefieldBehavior ModuleTag_Mines', {
        MineName: 'DefaultMine',
      }),
    ]);
    const profile = extractGenerateMinefieldProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.minesPerSquareFoot).toBe(0.01);
    expect(profile!.smartBorder).toBe(false);
    expect(profile!.smartBorderSkipInterior).toBe(true);
    expect(profile!.randomJitter).toBe(0);
    expect(profile!.skipIfThisMuchUnderStructure).toBeCloseTo(0.33, 6);
  });

  it('returns null for objects without GenerateMinefieldBehavior', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profile = extractGenerateMinefieldProfile(makeSelf(), objectDef);
    expect(profile).toBeNull();
  });
});

// ── DemoTrapProfile ─────────────────────────────────────────────────────────

describe('DemoTrapProfile extraction — weapon slot fields', () => {
  it('extracts weapon slot indices from named slots', () => {
    const objectDef = makeObjectDef('DemoTrap', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'DemoTrapUpdate ModuleTag_Demo', {
        DefaultProximityMode: 'Yes',
        TriggerDetonationRange: 50,
        DetonationWeaponSlot: 'TERTIARY',
        ProximityModeWeaponSlot: 'SECONDARY',
        ManualModeWeaponSlot: 'PRIMARY',
      }),
    ]);
    const profile = extractDemoTrapProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.detonationWeaponSlot).toBe(2);   // TERTIARY = 2
    expect(profile!.proximityModeWeaponSlot).toBe(1); // SECONDARY = 1
    expect(profile!.manualModeWeaponSlot).toBe(0);    // PRIMARY = 0
  });

  it('defaults all weapon slots to PRIMARY (0) when absent', () => {
    // C++ defaults: m_detonationWeaponSlot = PRIMARY_WEAPON (0),
    // m_proximityModeWeaponSlot = PRIMARY_WEAPON (0), m_manualModeWeaponSlot = PRIMARY_WEAPON (0)
    const objectDef = makeObjectDef('DemoTrapDefaults', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'DemoTrapUpdate ModuleTag_Demo', {
        TriggerDetonationRange: 30,
      }),
    ]);
    const profile = extractDemoTrapProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.detonationWeaponSlot).toBe(0);
    expect(profile!.proximityModeWeaponSlot).toBe(0);
    expect(profile!.manualModeWeaponSlot).toBe(0);
  });

  it('accepts SECONDARY_WEAPON and TERTIARY_WEAPON full names', () => {
    const objectDef = makeObjectDef('DemoTrapFull', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'DemoTrapUpdate ModuleTag_Demo', {
        TriggerDetonationRange: 40,
        DetonationWeaponSlot: 'SECONDARY_WEAPON',
        ProximityModeWeaponSlot: 'TERTIARY_WEAPON',
        ManualModeWeaponSlot: 'PRIMARY_WEAPON',
      }),
    ]);
    const profile = extractDemoTrapProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.detonationWeaponSlot).toBe(1);
    expect(profile!.proximityModeWeaponSlot).toBe(2);
    expect(profile!.manualModeWeaponSlot).toBe(0);
  });

  it('returns null for objects without DemoTrapUpdate', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profile = extractDemoTrapProfile(makeSelf(), objectDef);
    expect(profile).toBeNull();
  });
});

// ── OCLUpdateProfile ────────────────────────────────────────────────────────

describe('OCLUpdateProfile extraction — CreateAtEdge field', () => {
  it('extracts CreateAtEdge = true', () => {
    const objectDef = makeObjectDef('EdgeSpawner', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        OCL: 'OCL_TestSpawn',
        MinDelay: 1000,
        MaxDelay: 2000,
        CreateAtEdge: 'Yes',
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].createAtEdge).toBe(true);
  });

  it('defaults CreateAtEdge to false when absent (C++ m_isCreateAtEdge = FALSE)', () => {
    const objectDef = makeObjectDef('NormalSpawner', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        OCL: 'OCL_TestSpawn',
        MinDelay: 500,
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].createAtEdge).toBe(false);
  });

  it('handles multiple OCLUpdate blocks with mixed CreateAtEdge', () => {
    const objectDef = makeObjectDef('MultiSpawner', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL1', {
        OCL: 'OCL_SpawnA',
        MinDelay: 1000,
        CreateAtEdge: 'Yes',
      }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL2', {
        OCL: 'OCL_SpawnB',
        MinDelay: 2000,
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(2);
    expect(profiles[0].createAtEdge).toBe(true);
    expect(profiles[1].createAtEdge).toBe(false);
  });

  it('returns empty array for objects without OCLUpdate', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(0);
  });
});
