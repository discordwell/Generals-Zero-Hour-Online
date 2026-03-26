/**
 * Tests for missing fields added to extraction functions:
 *   - ToppleProfile: StumpName, KillStumpWhenToppled, ReorientToppledRubble
 *   - StructureCollapseProfile: MaxShudder
 *   - BattlePlanProfile: SpecialPowerTemplate, StrategyCenterHoldTheLineMaxHealthScalar
 *   - NeutronMissileUpdateProfile: DeliveryDecalRadius, SpecialJitterDistance
 *   - ParticleUplinkCannonProfile: BeginChargeTime, RaiseAntennaTime, ReadyDelayTime,
 *       WidthGrowTime, BeamTravelTime, ManualDrivingSpeed, ManualFastDrivingSpeed
 *   - NeutronMissileSlowDeathProfile: PushForce (per-blast), ScorchMarkSize
 *
 * Source parity references:
 *   ToppleUpdate.cpp:62-69 — constructor defaults
 *   StructureCollapseUpdate.h:84 — m_maxShudder = 0
 *   BattlePlanUpdate.cpp:74 — m_specialPowerTemplate = NULL
 *   NeutronMissileUpdate.cpp:70-71 — m_specialJitterDistance = 0, m_deliveryDecalRadius = 0
 *   ParticleUplinkCannonUpdate.cpp:74-93 — timing/driving field defaults
 *   NeutronMissileSlowDeathUpdate.cpp:68 — m_blastInfo[i].pushForceMag = 0.0f
 *   NeutronMissileSlowDeathUpdate.cpp:71 — m_scorchSize = 0.0f
 */

import { describe, expect, it } from 'vitest';

import {
  extractToppleProfile,
  extractStructureCollapseProfile,
  extractBattlePlanProfile,
  extractNeutronMissileUpdateProfile,
  extractParticleUplinkCannonProfile,
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

// ── ParticleUplinkCannonProfile: timing + driving fields ─────────────────────

describe('ParticleUplinkCannonProfile missing fields', () => {
  it('defaults all timing fields to 0 frames and driving speeds to 0', () => {
    // Source parity: ParticleUplinkCannonUpdate.cpp:74-93 — all default to 0
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {}),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.beginChargeFrames).toBe(0);
    expect(profile!.raiseAntennaFrames).toBe(0);
    expect(profile!.readyDelayFrames).toBe(0);
    expect(profile!.widthGrowFrames).toBe(0);
    expect(profile!.beamTravelFrames).toBe(0);
    expect(profile!.manualDrivingSpeed).toBe(0);
    expect(profile!.manualFastDrivingSpeed).toBe(0);
  });

  it('converts BeginChargeTime from ms to frames', () => {
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        BeginChargeTime: 5000,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    // 5000ms * 30 / 1000 = 150 frames
    expect(profile!.beginChargeFrames).toBe(150);
  });

  it('converts RaiseAntennaTime from ms to frames', () => {
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        RaiseAntennaTime: 4667,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    // ceil(4667 * 30 / 1000) = ceil(140.01) = 141 frames
    expect(profile!.raiseAntennaFrames).toBe(141);
  });

  it('converts ReadyDelayTime from ms to frames', () => {
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        ReadyDelayTime: 2000,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    // 2000ms * 30 / 1000 = 60 frames
    expect(profile!.readyDelayFrames).toBe(60);
  });

  it('converts WidthGrowTime from ms to frames', () => {
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        WidthGrowTime: 2000,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.widthGrowFrames).toBe(60);
  });

  it('converts BeamTravelTime from ms to frames', () => {
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        BeamTravelTime: 2500,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    // 2500ms * 30 / 1000 = 75 frames
    expect(profile!.beamTravelFrames).toBe(75);
  });

  it('converts ManualDrivingSpeed from units/sec to units/frame', () => {
    // Source parity: ParticleUplinkCannonUpdate.cpp:518 — speed /= LOGICFRAMES_PER_SECOND
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        ManualDrivingSpeed: 20,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    // 20 / 30 = 0.6667
    expect(profile!.manualDrivingSpeed).toBeCloseTo(20 / 30, 10);
  });

  it('converts ManualFastDrivingSpeed from units/sec to units/frame', () => {
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        ManualFastDrivingSpeed: 40,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    // 40 / 30 = 1.3333
    expect(profile!.manualFastDrivingSpeed).toBeCloseTo(40 / 30, 10);
  });

  it('parses all 7 new fields together with retail-like values', () => {
    // Values from retail ChinaParticleCannon INI
    const objectDef = makeObjectDef('ParticleCannon', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        BeginChargeTime: 5000,
        RaiseAntennaTime: 4667,
        ReadyDelayTime: 2000,
        WidthGrowTime: 2000,
        BeamTravelTime: 2500,
        ManualDrivingSpeed: 20,
        ManualFastDrivingSpeed: 40,
      }),
    ]);
    const profile = extractParticleUplinkCannonProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.beginChargeFrames).toBe(150);
    expect(profile!.raiseAntennaFrames).toBe(141);
    expect(profile!.readyDelayFrames).toBe(60);
    expect(profile!.widthGrowFrames).toBe(60);
    expect(profile!.beamTravelFrames).toBe(75);
    expect(profile!.manualDrivingSpeed).toBeCloseTo(20 / 30, 10);
    expect(profile!.manualFastDrivingSpeed).toBeCloseTo(40 / 30, 10);
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
