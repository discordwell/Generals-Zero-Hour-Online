/**
 * Tests for missing fields added to extraction functions:
 *   - ToppleProfile: StumpName, KillStumpWhenToppled, ReorientToppledRubble
 *   - StructureCollapseProfile: MaxShudder
 *   - BattlePlanProfile: SpecialPowerTemplate, StrategyCenterHoldTheLineMaxHealthScalar
 *   - NeutronMissileUpdateProfile: DeliveryDecalRadius, SpecialJitterDistance
 *   - NeutronMissileSlowDeathProfile: PushForce (per-blast), ScorchMarkSize
 *
 * Source parity references:
 *   ToppleUpdate.cpp:62-69 — constructor defaults
 *   StructureCollapseUpdate.h:84 — m_maxShudder = 0
 *   BattlePlanUpdate.cpp:74 — m_specialPowerTemplate = NULL
 *   NeutronMissileUpdate.cpp:70-71 — m_specialJitterDistance = 0, m_deliveryDecalRadius = 0
 *   NeutronMissileSlowDeathUpdate.cpp:68 — m_blastInfo[i].pushForceMag = 0.0f
 *   NeutronMissileSlowDeathUpdate.cpp:71 — m_scorchSize = 0.0f
 */

import { describe, expect, it } from 'vitest';

import {
  extractToppleProfile,
  extractStructureCollapseProfile,
  extractBattlePlanProfile,
  extractNeutronMissileUpdateProfile,
  extractNeutronMissileSlowDeathProfile,
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

// ── NeutronMissileSlowDeathProfile: PushForce + ScorchMarkSize ───────────────

describe('NeutronMissileSlowDeathProfile missing fields', () => {
  it('defaults pushForce to 0 for each blast and scorchSize to 0', () => {
    // Source parity: NeutronMissileSlowDeathUpdate.cpp:68 — m_blastInfo[i].pushForceMag = 0.0f
    // Source parity: NeutronMissileSlowDeathUpdate.cpp:71 — m_scorchSize = 0.0f
    const objectDef = makeObjectDef('NukeDetonation', 'China', [], [
      makeBlock('Behavior', 'NeutronMissileSlowDeathBehavior ModuleTag_08', {
        Blast1Enabled: true,
      }),
    ]);
    const profile = extractNeutronMissileSlowDeathProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.blasts[0]!.pushForce).toBe(0);
    expect(profile!.scorchSize).toBe(0);
  });

  it('parses Blast1PushForce from INI', () => {
    // Source parity: FieldParse "Blast1PushForce" -> m_blastInfo[NEUTRON_BLAST_1].pushForceMag
    const objectDef = makeObjectDef('NukeDetonation', 'China', [], [
      makeBlock('Behavior', 'NeutronMissileSlowDeathBehavior ModuleTag_08', {
        Blast1Enabled: true,
        Blast1PushForce: 6,
      }),
    ]);
    const profile = extractNeutronMissileSlowDeathProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.blasts[0]!.pushForce).toBe(6);
  });

  it('parses PushForce for multiple blasts independently', () => {
    // Source parity: each blast index has its own PushForce field
    const objectDef = makeObjectDef('NukeDetonation', 'China', [], [
      makeBlock('Behavior', 'NeutronMissileSlowDeathBehavior ModuleTag_08', {
        Blast1Enabled: true,
        Blast1PushForce: 10,
        Blast4Enabled: true,
        Blast4PushForce: 6,
        Blast6Enabled: true,
        Blast6PushForce: 4,
      }),
    ]);
    const profile = extractNeutronMissileSlowDeathProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.blasts[0]!.pushForce).toBe(10); // Blast1
    expect(profile!.blasts[1]!.pushForce).toBe(0);  // Blast2 — not set
    expect(profile!.blasts[3]!.pushForce).toBe(6);  // Blast4
    expect(profile!.blasts[5]!.pushForce).toBe(4);  // Blast6
  });

  it('parses ScorchMarkSize from INI', () => {
    // Source parity: FieldParse "ScorchMarkSize" -> m_scorchSize
    const objectDef = makeObjectDef('NukeDetonation', 'China', [], [
      makeBlock('Behavior', 'NeutronMissileSlowDeathBehavior ModuleTag_08', {
        ScorchMarkSize: 320,
      }),
    ]);
    const profile = extractNeutronMissileSlowDeathProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scorchSize).toBe(320);
  });
});
