/**
 * Tests for missing fields added to extraction functions:
 *   - ToppleProfile: StumpName, KillStumpWhenToppled, ReorientToppledRubble
 *   - StructureCollapseProfile: MaxShudder
 *   - BattlePlanProfile: SpecialPowerTemplate, StrategyCenterHoldTheLineMaxHealthScalar
 *   - NeutronMissileUpdateProfile: DeliveryDecalRadius, SpecialJitterDistance
 *
 * Source parity references:
 *   ToppleUpdate.cpp:62-69 — constructor defaults
 *   StructureCollapseUpdate.h:84 — m_maxShudder = 0
 *   BattlePlanUpdate.cpp:74 — m_specialPowerTemplate = NULL
 *   NeutronMissileUpdate.cpp:70-71 — m_specialJitterDistance = 0, m_deliveryDecalRadius = 0
 */

import { describe, expect, it } from 'vitest';

import {
  extractToppleProfile,
  extractStructureCollapseProfile,
  extractBattlePlanProfile,
  extractNeutronMissileUpdateProfile,
} from './entity-factory.js';
import { makeBlock, makeObjectDef } from './test-helpers.js';

const mockSelf = { msToLogicFrames: (ms: number) => Math.ceil(ms * 30 / 1000) } as any;

// ── ToppleProfile: new fields ────────────────────────────────────────────────

describe('ToppleProfile missing fields', () => {
  it('defaults StumpName to empty string, KillStumpWhenToppled and ReorientToppledRubble to false', () => {
    // Source parity: ToppleUpdate.cpp:64 m_stumpName.clear(), :67 m_killStumpWhenToppled = false, :69 m_reorientToppledRubble = false
    const objectDef = makeObjectDef('Tree', 'Neutral', ['STRUCTURE'], [
      makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {}),
    ]);
    const profile = extractToppleProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.stumpName).toBe('');
    expect(profile!.killStumpWhenToppled).toBe(false);
    expect(profile!.reorientToppledRubble).toBe(false);
  });

  it('parses StumpName from INI', () => {
    const objectDef = makeObjectDef('Tree', 'Neutral', ['STRUCTURE'], [
      makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {
        StumpName: 'TreeStump',
      }),
    ]);
    const profile = extractToppleProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.stumpName).toBe('TreeStump');
  });

  it('parses KillStumpWhenToppled = true', () => {
    const objectDef = makeObjectDef('Tree', 'Neutral', ['STRUCTURE'], [
      makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {
        KillStumpWhenToppled: true,
      }),
    ]);
    const profile = extractToppleProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.killStumpWhenToppled).toBe(true);
  });

  it('parses ReorientToppledRubble = true', () => {
    const objectDef = makeObjectDef('Tree', 'Neutral', ['STRUCTURE'], [
      makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {
        ReorientToppledRubble: true,
      }),
    ]);
    const profile = extractToppleProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.reorientToppledRubble).toBe(true);
  });
});

// ── StructureCollapseProfile: MaxShudder ─────────────────────────────────────

describe('StructureCollapseProfile missing fields', () => {
  it('defaults MaxShudder to 0', () => {
    // Source parity: StructureCollapseUpdate.h:84 — m_maxShudder = 0
    const objectDef = makeObjectDef('Building', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'StructureCollapseUpdate ModuleTag_Collapse', {}),
    ]);
    const profile = extractStructureCollapseProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.maxShudder).toBe(0);
  });

  it('parses MaxShudder from INI', () => {
    const objectDef = makeObjectDef('Building', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'StructureCollapseUpdate ModuleTag_Collapse', {
        MaxShudder: 3.5,
      }),
    ]);
    const profile = extractStructureCollapseProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.maxShudder).toBe(3.5);
  });
});

// ── BattlePlanProfile: SpecialPowerTemplate + StrategyCenterHoldTheLineMaxHealthScalar ──

describe('BattlePlanProfile missing fields', () => {
  it('defaults SpecialPowerTemplate to empty string', () => {
    // Source parity: BattlePlanUpdate.cpp:74 — m_specialPowerTemplate = NULL
    const objectDef = makeObjectDef('StrategyCenter', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'BattlePlanUpdate ModuleTag_BattlePlan', {}),
    ]);
    const profile = extractBattlePlanProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.specialPowerTemplateName).toBe('');
  });

  it('parses SpecialPowerTemplate from INI', () => {
    const objectDef = makeObjectDef('StrategyCenter', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'BattlePlanUpdate ModuleTag_BattlePlan', {
        SpecialPowerTemplate: 'SpecialPowerChangeBattlePlans',
      }),
    ]);
    const profile = extractBattlePlanProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.specialPowerTemplateName).toBe('SPECIALPOWERCHANGEBATTLEPLANS');
  });

  it('defaults StrategyCenterHoldTheLineMaxHealthScalar to 1.0', () => {
    const objectDef = makeObjectDef('StrategyCenter', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'BattlePlanUpdate ModuleTag_BattlePlan', {}),
    ]);
    const profile = extractBattlePlanProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.strategyCenterHoldTheLineMaxHealthScalar).toBe(1.0);
  });

  it('parses StrategyCenterHoldTheLineMaxHealthScalar from INI', () => {
    const objectDef = makeObjectDef('StrategyCenter', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'BattlePlanUpdate ModuleTag_BattlePlan', {
        StrategyCenterHoldTheLineMaxHealthScalar: 1.1,
      }),
    ]);
    const profile = extractBattlePlanProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.strategyCenterHoldTheLineMaxHealthScalar).toBe(1.1);
  });
});

// ── NeutronMissileUpdateProfile: DeliveryDecalRadius + SpecialJitterDistance ──

describe('NeutronMissileUpdateProfile missing fields', () => {
  it('defaults DeliveryDecalRadius and SpecialJitterDistance to 0', () => {
    // Source parity: NeutronMissileUpdate.cpp:70-71 — defaults are 0
    const objectDef = makeObjectDef('NukeMissile', 'China', ['PROJECTILE'], [
      makeBlock('Behavior', 'NeutronMissileUpdate ModuleTag_NeutronMissile', {}),
    ]);
    const profile = extractNeutronMissileUpdateProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.deliveryDecalRadius).toBe(0);
    expect(profile!.specialJitterDistance).toBe(0);
  });

  it('parses DeliveryDecalRadius from INI', () => {
    const objectDef = makeObjectDef('NukeMissile', 'China', ['PROJECTILE'], [
      makeBlock('Behavior', 'NeutronMissileUpdate ModuleTag_NeutronMissile', {
        DeliveryDecalRadius: 150.0,
      }),
    ]);
    const profile = extractNeutronMissileUpdateProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.deliveryDecalRadius).toBe(150.0);
  });

  it('parses SpecialJitterDistance from INI', () => {
    const objectDef = makeObjectDef('NukeMissile', 'China', ['PROJECTILE'], [
      makeBlock('Behavior', 'NeutronMissileUpdate ModuleTag_NeutronMissile', {
        SpecialJitterDistance: 25.0,
      }),
    ]);
    const profile = extractNeutronMissileUpdateProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.specialJitterDistance).toBe(25.0);
  });
});
