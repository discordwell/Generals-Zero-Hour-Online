/**
 * ZH-specific field additions to existing Generals modules.
 *
 * Verifies that Zero Hour fields added to FieldParse tables of existing
 * Generals modules are correctly extracted from INI data.
 *
 * Source parity:
 *   - OverlordContain.cpp: ExperienceSinkForRider
 *   - PhysicsUpdate.cpp: ShockResistance, ShockMaxYaw/Pitch/Roll
 *   - PropagandaTowerBehavior.cpp: AffectsSelf
 *   - GenerateMinefieldBehavior.cpp: Upgradable, UpgradedMineName, UpgradedTriggeredBy
 *   - OCLUpdate.cpp: FactionTriggered, FactionOCL
 *   - Weapon.cpp: LaserBoneName, MissileCallsOnDie
 *   - ChinookAIUpdate.cpp: RotorWashParticleSystem, UpgradedSupplyBoost
 *   - SpecialPowerModule.cpp: ScriptedSpecialPowerOnly
 *   - OCLSpecialPower.cpp: OCLAdjustPositionToPassable, ReferenceObject
 *   - CreateObjectDie.cpp: TransferPreviousHealth
 *   - RailedTransportDockUpdate.cpp: ToleranceDistance
 *   - SupplyCenterDockUpdate.cpp: GrantTemporaryStealth
 */
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';
import {
  extractContainProfile,
  extractPhysicsBehaviorProfile,
  extractPropagandaTowerProfile,
  extractGenerateMinefieldProfile,
  extractOCLUpdateProfiles,
  extractSpecialPowerModules,
} from './entity-factory.js';
import { extractChinookAIProfile } from './aircraft-ai.js';
import { resolveWeaponProfileFromDef } from './weapon-profiles.js';
import { extractDeathOCLEntries } from './entity-lifecycle.js';
import { extractRailedTransportProfile } from './railed-transport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSelf() {
  return new GameLogicSubsystem();
}

function makeSimpleObjectDef(name: string, blocks: ReturnType<typeof makeBlock>[]) {
  return makeObjectDef(name, 'America', ['STRUCTURE'], blocks);
}

// ---------------------------------------------------------------------------
// OverlordContain: ExperienceSinkForRider
// ---------------------------------------------------------------------------
describe('OverlordContain ZH fields', () => {
  it('extracts ExperienceSinkForRider = true (default)', () => {
    const objectDef = makeSimpleObjectDef('TestOverlord', [
      makeBlock('Behavior', 'OverlordContain ModuleTag_OC', {
        ContainMax: 5,
        Slots: 5,
      }),
    ]);
    const profile = extractContainProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('OVERLORD');
    expect(profile!.experienceSinkForRider).toBe(true);
  });

  it('extracts ExperienceSinkForRider = false when set', () => {
    const objectDef = makeSimpleObjectDef('TestOverlord', [
      makeBlock('Behavior', 'OverlordContain ModuleTag_OC', {
        ContainMax: 5,
        Slots: 5,
        ExperienceSinkForRider: false,
      }),
    ]);
    const profile = extractContainProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.experienceSinkForRider).toBe(false);
  });

  it('defaults ExperienceSinkForRider to true for OpenContain', () => {
    const objectDef = makeSimpleObjectDef('TestOpen', [
      makeBlock('Behavior', 'OpenContain ModuleTag_OC', {
        ContainMax: 3,
      }),
    ]);
    const profile = extractContainProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('OPEN');
    expect(profile!.experienceSinkForRider).toBe(true);
  });

  it('defaults ExperienceSinkForRider to true for TransportContain', () => {
    const objectDef = makeSimpleObjectDef('TestTransport', [
      makeBlock('Behavior', 'TransportContain ModuleTag_TC', {
        ContainMax: 8,
        Slots: 8,
      }),
    ]);
    const profile = extractContainProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('TRANSPORT');
    expect(profile!.experienceSinkForRider).toBe(true);
  });

  it('HelixContain parses ExperienceSinkForRider from INI', () => {
    const objectDef = makeSimpleObjectDef('TestHelix', [
      makeBlock('Behavior', 'HelixContain ModuleTag_HC', {
        ContainMax: 5,
        Slots: 5,
        ExperienceSinkForRider: true,
      }),
    ]);
    const profile = extractContainProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('HELIX');
    expect(profile!.experienceSinkForRider).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PhysicsBehavior: ShockResistance, ShockMaxYaw/Pitch/Roll
// ---------------------------------------------------------------------------
describe('PhysicsBehavior ZH shockwave fields', () => {
  it('uses default shockwave values when fields are absent', () => {
    const objectDef = makeSimpleObjectDef('TestPhysics', [
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_PB', { Mass: 10 }),
    ]);
    const profile = extractPhysicsBehaviorProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.shockResistance).toBe(0.0);
    expect(profile!.shockMaxYaw).toBe(0.05);
    expect(profile!.shockMaxPitch).toBe(0.025);
    expect(profile!.shockMaxRoll).toBe(0.025);
  });

  it('extracts custom shockwave values from INI', () => {
    const objectDef = makeSimpleObjectDef('TestPhysics', [
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_PB', {
        Mass: 50,
        ShockResistance: 0.8,
        ShockMaxYaw: 0.1,
        ShockMaxPitch: 0.05,
        ShockMaxRoll: 0.03,
      }),
    ]);
    const profile = extractPhysicsBehaviorProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.shockResistance).toBeCloseTo(0.8);
    expect(profile!.shockMaxYaw).toBeCloseTo(0.1);
    expect(profile!.shockMaxPitch).toBeCloseTo(0.05);
    expect(profile!.shockMaxRoll).toBeCloseTo(0.03);
  });
});

// ---------------------------------------------------------------------------
// PropagandaTowerBehavior: AffectsSelf
// ---------------------------------------------------------------------------
describe('PropagandaTowerBehavior ZH fields', () => {
  it('defaults AffectsSelf to false', () => {
    const objectDef = makeSimpleObjectDef('TestPropTower', [
      makeBlock('Behavior', 'PropagandaTowerBehavior ModuleTag_PT', {
        Radius: 200,
      }),
    ]);
    const profile = extractPropagandaTowerProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.affectsSelf).toBe(false);
  });

  it('extracts AffectsSelf = true', () => {
    const objectDef = makeSimpleObjectDef('TestPropTower', [
      makeBlock('Behavior', 'PropagandaTowerBehavior ModuleTag_PT', {
        Radius: 200,
        AffectsSelf: true,
      }),
    ]);
    const profile = extractPropagandaTowerProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.affectsSelf).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GenerateMinefieldBehavior: Upgradable, UpgradedMineName, UpgradedTriggeredBy
// ---------------------------------------------------------------------------
describe('GenerateMinefieldBehavior ZH fields', () => {
  it('defaults upgrade fields to empty/false', () => {
    const objectDef = makeSimpleObjectDef('TestMineGen', [
      makeBlock('Behavior', 'GenerateMinefieldBehavior ModuleTag_MF', {
        MineName: 'TestMine',
      }),
    ]);
    const profile = extractGenerateMinefieldProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.upgradable).toBe(false);
    expect(profile!.upgradedMineName).toBe('');
    expect(profile!.upgradedTriggeredBy).toBe('');
  });

  it('extracts upgrade fields when set', () => {
    const objectDef = makeSimpleObjectDef('TestMineGen', [
      makeBlock('Behavior', 'GenerateMinefieldBehavior ModuleTag_MF', {
        MineName: 'LandMine',
        Upgradable: true,
        UpgradedMineName: 'ImprovedMine',
        UpgradedTriggeredBy: 'Upgrade_LandMines',
      }),
    ]);
    const profile = extractGenerateMinefieldProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.upgradable).toBe(true);
    expect(profile!.upgradedMineName).toBe('ImprovedMine');
    expect(profile!.upgradedTriggeredBy).toBe('Upgrade_LandMines');
  });
});

// ---------------------------------------------------------------------------
// OCLUpdate: FactionTriggered, FactionOCL
// ---------------------------------------------------------------------------
describe('OCLUpdate ZH fields', () => {
  it('defaults FactionTriggered to false with empty map', () => {
    const objectDef = makeSimpleObjectDef('TestOCL', [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        OCL: 'OCL_TestSpawn',
        MinDelay: 1000,
        MaxDelay: 2000,
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.factionTriggered).toBe(false);
    expect(profiles[0]!.factionOCLMap.size).toBe(0);
  });

  it('extracts FactionTriggered and FactionOCL entries', () => {
    const objectDef = makeSimpleObjectDef('TestReinforcementPad', [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        MinDelay: 120000,
        MaxDelay: 120000,
        CreateAtEdge: true,
        FactionTriggered: true,
        FactionOCL: [
          'Faction:America OCL:OCL_ReinforcementUSA',
          'Faction:China OCL:OCL_ReinforcementCHI',
          'Faction:GLA OCL:OCL_ReinforcementGLA',
        ],
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;
    expect(p.factionTriggered).toBe(true);
    expect(p.factionOCLMap.size).toBe(3);
    expect(p.factionOCLMap.get('AMERICA')).toBe('OCL_ReinforcementUSA');
    expect(p.factionOCLMap.get('CHINA')).toBe('OCL_ReinforcementCHI');
    expect(p.factionOCLMap.get('GLA')).toBe('OCL_ReinforcementGLA');
  });

  it('allows faction-only OCLUpdate with no base OCL', () => {
    const objectDef = makeSimpleObjectDef('TestReinforcementPad', [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        MinDelay: 60000,
        MaxDelay: 60000,
        FactionTriggered: true,
        FactionOCL: 'Faction:America OCL:OCL_AmericaOnly',
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.oclName).toBe('');
    expect(profiles[0]!.factionOCLMap.get('AMERICA')).toBe('OCL_AmericaOnly');
  });
});

// ---------------------------------------------------------------------------
// Weapon: LaserBoneName, MissileCallsOnDie
// ---------------------------------------------------------------------------
describe('Weapon ZH fields', () => {
  it('defaults LaserBoneName to null and MissileCallsOnDie to false', () => {
    const weaponDef = makeWeaponDef('TestGun', {
      PrimaryDamage: 10,
      AttackRange: 100,
    });
    const profile = resolveWeaponProfileFromDef(makeSelf(), weaponDef);
    expect(profile).not.toBeNull();
    expect(profile!.laserBoneName).toBeNull();
    expect(profile!.missileCallsOnDie).toBe(false);
  });

  it('extracts LaserBoneName when set', () => {
    const weaponDef = makeWeaponDef('TestLaser', {
      PrimaryDamage: 25,
      AttackRange: 200,
      LaserName: 'TestLaserBeam',
      LaserBoneName: 'YOURBONE02',
    });
    const profile = resolveWeaponProfileFromDef(makeSelf(), weaponDef);
    expect(profile).not.toBeNull();
    expect(profile!.laserBoneName).toBe('YOURBONE02');
  });

  it('extracts MissileCallsOnDie = true', () => {
    const weaponDef = makeWeaponDef('TestMissile', {
      PrimaryDamage: 50,
      AttackRange: 300,
      ProjectileObject: 'MissileProjectile',
      MissileCallsOnDie: true,
    });
    const profile = resolveWeaponProfileFromDef(makeSelf(), weaponDef);
    expect(profile).not.toBeNull();
    expect(profile!.missileCallsOnDie).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ChinookAIUpdate: RotorWashParticleSystem, UpgradedSupplyBoost
// ---------------------------------------------------------------------------
describe('ChinookAIUpdate ZH fields', () => {
  it('defaults RotorWashParticleSystem to empty and UpgradedSupplyBoost to 0', () => {
    const objectDef = makeSimpleObjectDef('TestChinook', [
      makeBlock('Behavior', 'ChinookAIUpdate ModuleTag_AI', {}),
    ]);
    const profile = extractChinookAIProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.rotorWashParticleSystem).toBe('');
    expect(profile!.upgradedSupplyBoost).toBe(0);
  });

  it('extracts RotorWashParticleSystem and UpgradedSupplyBoost', () => {
    const objectDef = makeSimpleObjectDef('TestChinook', [
      makeBlock('Behavior', 'ChinookAIUpdate ModuleTag_AI', {
        RotorWashParticleSystem: 'HelixDustEffect',
        UpgradedSupplyBoost: 100,
      }),
    ]);
    const profile = extractChinookAIProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.rotorWashParticleSystem).toBe('HelixDustEffect');
    expect(profile!.upgradedSupplyBoost).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// SpecialPowerModule: ScriptedSpecialPowerOnly, OCLAdjustPositionToPassable, ReferenceObject
// ---------------------------------------------------------------------------
describe('SpecialPowerModule ZH fields', () => {
  it('defaults ScriptedSpecialPowerOnly to false', () => {
    const objectDef = makeSimpleObjectDef('TestPower', [
      makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
        SpecialPowerTemplate: 'SuperweaponNukeCannonMissile',
        OCL: 'OCL_TestPower',
      }),
    ]);
    const modules = extractSpecialPowerModules(makeSelf(), objectDef);
    expect(modules.size).toBe(1);
    const entry = modules.values().next().value;
    expect(entry.scriptedSpecialPowerOnly).toBe(false);
    expect(entry.oclAdjustPositionToPassable).toBe(false);
    expect(entry.referenceObject).toBe('');
  });

  it('extracts ScriptedSpecialPowerOnly = true', () => {
    const objectDef = makeSimpleObjectDef('TestPower', [
      makeBlock('Behavior', 'SpecialPowerModule ModuleTag_SP', {
        SpecialPowerTemplate: 'ScriptedOnlyPower',
        ScriptedSpecialPowerOnly: true,
      }),
    ]);
    const modules = extractSpecialPowerModules(makeSelf(), objectDef);
    expect(modules.size).toBe(1);
    const entry = modules.values().next().value;
    expect(entry.scriptedSpecialPowerOnly).toBe(true);
  });

  it('extracts OCLAdjustPositionToPassable and ReferenceObject', () => {
    const objectDef = makeSimpleObjectDef('TestPower', [
      makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
        SpecialPowerTemplate: 'SupplyDropPower',
        OCL: 'OCL_SupplyDrop',
        OCLAdjustPositionToPassable: true,
        ReferenceObject: 'SupplyDropZone',
      }),
    ]);
    const modules = extractSpecialPowerModules(makeSelf(), objectDef);
    expect(modules.size).toBe(1);
    const entry = modules.values().next().value;
    expect(entry.oclAdjustPositionToPassable).toBe(true);
    expect(entry.referenceObject).toBe('SupplyDropZone');
  });
});

// ---------------------------------------------------------------------------
// CreateObjectDie: TransferPreviousHealth
// ---------------------------------------------------------------------------
describe('CreateObjectDie ZH fields', () => {
  it('defaults TransferPreviousHealth to false', () => {
    const objectDef = makeSimpleObjectDef('TestDie', [
      makeBlock('Die', 'CreateObjectDie ModuleTag_Die', {
        CreationList: 'OCL_DestroyDebris',
      }),
    ]);
    const entries = extractDeathOCLEntries(makeSelf(), objectDef);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.transferPreviousHealth).toBe(false);
  });

  it('extracts TransferPreviousHealth = true', () => {
    const objectDef = makeSimpleObjectDef('TestDie', [
      makeBlock('Die', 'CreateObjectDie ModuleTag_Die', {
        CreationList: 'OCL_SpawnHusk',
        TransferPreviousHealth: true,
      }),
    ]);
    const entries = extractDeathOCLEntries(makeSelf(), objectDef);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.transferPreviousHealth).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RailedTransportDockUpdate: ToleranceDistance
// ---------------------------------------------------------------------------
describe('RailedTransportDockUpdate ZH fields', () => {
  it('defaults ToleranceDistance to 50.0', () => {
    const objectDef = makeSimpleObjectDef('TestRail', [
      makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_AI', {
        PathPrefixName: 'TestPath',
      }),
      makeBlock('Behavior', 'RailedTransportDockUpdate ModuleTag_Dock', {}),
    ]);
    const profile = extractRailedTransportProfile(objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.toleranceDistance).toBe(50.0);
  });

  it('extracts custom ToleranceDistance', () => {
    const objectDef = makeSimpleObjectDef('TestRail', [
      makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_AI', {
        PathPrefixName: 'TestPath',
      }),
      makeBlock('Behavior', 'RailedTransportDockUpdate ModuleTag_Dock', {
        ToleranceDistance: 25.0,
      }),
    ]);
    const profile = extractRailedTransportProfile(objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.toleranceDistance).toBe(25.0);
  });
});

// ---------------------------------------------------------------------------
// SupplyCenterDockUpdate: GrantTemporaryStealth
// ---------------------------------------------------------------------------
describe('SupplyCenterDockUpdate ZH fields', () => {
  it('defaults GrantTemporaryStealth to 0', () => {
    const gl = makeSelf();
    const result = gl.extractGrantTemporaryStealthFrames(
      makeSimpleObjectDef('TestSupplyCenter', [
        makeBlock('Behavior', 'SupplyCenterDockUpdate ModuleTag_Dock', {}),
      ]),
    );
    expect(result).toBe(0);
  });

  it('extracts GrantTemporaryStealth duration as frames', () => {
    const gl = makeSelf();
    const result = gl.extractGrantTemporaryStealthFrames(
      makeSimpleObjectDef('TestSupplyCenter', [
        makeBlock('Behavior', 'SupplyCenterDockUpdate ModuleTag_Dock', {
          GrantTemporaryStealth: 3000, // 3 seconds = 90 frames at 30fps
        }),
      ]),
    );
    expect(result).toBe(90);
  });
});
