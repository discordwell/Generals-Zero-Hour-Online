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
 *   - AI.cpp: MaxRetaliationDistance, RetaliationFriendsRadius
 *   - PlayerTemplate.cpp: BaseSide, OldFaction, ScoreScreenMusic, GeneralImage,
 *       ArmyTooltip, Features, MedallionRegular, MedallionHilite, MedallionSelect
 *   - SpecialPower.cpp: ShortcutPower, AcademyClassify
 *   - Upgrade.cpp: AcademyClassify
 */
import { describe, expect, it } from 'vitest';
import {
  GameLogicSubsystem,
  SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT,
  SCRIPT_KIND_OF_NAME_TO_BIT,
  SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT_ALLOW_SURRENDER,
  SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER,
  SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME,
} from './index.js';
import { IniDataRegistry, DEFAULT_AI_CONFIG } from '@generals/ini-data';
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

// ---------------------------------------------------------------------------
// AIData: MaxRetaliationDistance, RetaliationFriendsRadius
// ---------------------------------------------------------------------------
describe('AIData ZH fields', () => {
  it('uses C++ default values for MaxRetaliationDistance and RetaliationFriendsRadius', () => {
    // Source parity: TAiData constructor defaults in GeneralsMD AI.cpp.
    expect(DEFAULT_AI_CONFIG.maxRetaliationDistance).toBe(210);
    expect(DEFAULT_AI_CONFIG.retaliationFriendsRadius).toBe(120);
  });

  it('extracts MaxRetaliationDistance from AIData INI block', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('AIData', '', {
        MaxRetaliationDistance: '200.0',
      }),
    ]);
    const config = registry.getAiConfig();
    expect(config).not.toBeUndefined();
    expect(config!.maxRetaliationDistance).toBe(200.0);
  });

  it('extracts RetaliationFriendsRadius from AIData INI block', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('AIData', '', {
        RetaliationFriendsRadius: '150.0',
      }),
    ]);
    const config = registry.getAiConfig();
    expect(config).not.toBeUndefined();
    expect(config!.retaliationFriendsRadius).toBe(150.0);
  });

  it('resolves MaxRetaliationDistance and RetaliationFriendsRadius at runtime', () => {
    const bundle = makeBundle({
      objects: [],
      ai: {
        maxRetaliationDistance: 200,
        retaliationFriendsRadius: 150,
      },
    });
    const gl = makeSelf();
    gl.loadMapObjects(makeMap([]), makeRegistry(bundle), makeHeightmap());
    expect(gl.resolveMaxRetaliationDistance()).toBe(200);
    expect(gl.resolveRetaliationFriendsRadius()).toBe(150);
    gl.dispose();
  });

  it('falls back to defaults when not specified in bundle', () => {
    const bundle = makeBundle({ objects: [] });
    const gl = makeSelf();
    gl.loadMapObjects(makeMap([]), makeRegistry(bundle), makeHeightmap());
    expect(gl.resolveMaxRetaliationDistance()).toBe(210);
    expect(gl.resolveRetaliationFriendsRadius()).toBe(120);
    gl.dispose();
  });
});

// ---------------------------------------------------------------------------
// PlayerTemplate: BaseSide, OldFaction, ScoreScreenMusic, GeneralImage,
//   ArmyTooltip, Features, MedallionRegular, MedallionHilite, MedallionSelect
// ---------------------------------------------------------------------------
describe('PlayerTemplate ZH fields', () => {
  it('extracts all ZH-only PlayerTemplate fields from registry', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('PlayerTemplate', 'FactionAmericaSuperWeapon', {
        Side: 'America',
        BaseSide: 'USA',
        OldFaction: 'No',
        ScoreScreenMusic: 'Score_USA',
        GeneralImage: 'USA_Superweapon',
        ArmyTooltip: 'TOOLTIP:BioStrategyLong_Pos3',
        Features: 'GUI:BioFeatures_Pos3',
        MedallionRegular: 'SuperWGeneral_slvr',
        MedallionHilite: 'SuperWGeneral_blue',
        MedallionSelect: 'SuperWGeneral_orng',
      }),
    ]);
    const faction = registry.getFaction('FactionAmericaSuperWeapon');
    expect(faction).not.toBeUndefined();
    expect(faction!.side).toBe('America');
    expect(faction!.baseSide).toBe('USA');
    expect(faction!.oldFaction).toBe(false);
    expect(faction!.scoreScreenMusic).toBe('Score_USA');
    expect(faction!.generalImage).toBe('USA_Superweapon');
    expect(faction!.armyTooltip).toBe('TOOLTIP:BioStrategyLong_Pos3');
    expect(faction!.features).toBe('GUI:BioFeatures_Pos3');
    expect(faction!.medallionRegular).toBe('SuperWGeneral_slvr');
    expect(faction!.medallionHilite).toBe('SuperWGeneral_blue');
    expect(faction!.medallionSelect).toBe('SuperWGeneral_orng');
  });

  it('defaults ZH-only fields to undefined when absent (Generals-style template)', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('PlayerTemplate', 'FactionAmerica', {
        Side: 'America',
        PlayableSide: 'Yes',
      }),
    ]);
    const faction = registry.getFaction('FactionAmerica');
    expect(faction).not.toBeUndefined();
    expect(faction!.side).toBe('America');
    expect(faction!.baseSide).toBeUndefined();
    expect(faction!.oldFaction).toBeUndefined();
    expect(faction!.scoreScreenMusic).toBeUndefined();
    expect(faction!.generalImage).toBeUndefined();
    expect(faction!.armyTooltip).toBeUndefined();
    expect(faction!.features).toBeUndefined();
    expect(faction!.medallionRegular).toBeUndefined();
    expect(faction!.medallionHilite).toBeUndefined();
    expect(faction!.medallionSelect).toBeUndefined();
  });

  it('extracts OldFaction = Yes correctly', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('PlayerTemplate', 'FactionAmerica', {
        Side: 'America',
        OldFaction: 'Yes',
      }),
    ]);
    const faction = registry.getFaction('FactionAmerica');
    expect(faction!.oldFaction).toBe(true);
  });

  it('preserves ZH fields through bundle round-trip', () => {
    const bundle = makeBundle({
      objects: [],
      factions: [
        {
          name: 'FactionChinaTank',
          side: 'China',
          fields: {},
          baseSide: 'China',
          oldFaction: false,
          scoreScreenMusic: 'Score_China',
          generalImage: 'China_Tank',
          armyTooltip: 'TOOLTIP:BioStrategyLong_Pos7',
          features: 'GUI:BioFeatures_Pos7',
          medallionRegular: 'TankGeneral_slvr',
          medallionHilite: 'TankGeneral_blue',
          medallionSelect: 'TankGeneral_orng',
        },
      ],
    });
    const registry = makeRegistry(bundle);
    const faction = registry.getFaction('FactionChinaTank');
    expect(faction).not.toBeUndefined();
    expect(faction!.baseSide).toBe('China');
    expect(faction!.oldFaction).toBe(false);
    expect(faction!.scoreScreenMusic).toBe('Score_China');
    expect(faction!.generalImage).toBe('China_Tank');
    expect(faction!.armyTooltip).toBe('TOOLTIP:BioStrategyLong_Pos7');
    expect(faction!.features).toBe('GUI:BioFeatures_Pos7');
    expect(faction!.medallionRegular).toBe('TankGeneral_slvr');
    expect(faction!.medallionHilite).toBe('TankGeneral_blue');
    expect(faction!.medallionSelect).toBe('TankGeneral_orng');
  });
});

// ---------------------------------------------------------------------------
// SpecialPower: ShortcutPower, AcademyClassify
// ---------------------------------------------------------------------------
describe('SpecialPower ZH fields', () => {
  it('defaults ShortcutPower to undefined and AcademyClassify to undefined', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('SpecialPower', 'SuperweaponNukeCannon', {
        ReloadTime: 1000,
        Enum: 'SPECIAL_NEUTRON_MISSILE',
      }),
    ]);
    const sp = registry.getSpecialPower('SuperweaponNukeCannon');
    expect(sp).not.toBeUndefined();
    expect(sp!.shortcutPower).toBeUndefined();
    expect(sp!.academyClassify).toBeUndefined();
  });

  it('extracts ShortcutPower = true', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('SpecialPower', 'SuperweaponParticleCannon', {
        ReloadTime: 240000,
        Enum: 'SPECIAL_PARTICLE_UPLINK_CANNON',
        ShortcutPower: 'Yes',
      }),
    ]);
    const sp = registry.getSpecialPower('SuperweaponParticleCannon');
    expect(sp).not.toBeUndefined();
    expect(sp!.shortcutPower).toBe(true);
  });

  it('extracts AcademyClassify enum value', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('SpecialPower', 'SuperweaponNukeCannon', {
        ReloadTime: 360000,
        Enum: 'SPECIAL_NEUTRON_MISSILE',
        AcademyClassify: 'ACT_SUPERPOWER',
      }),
    ]);
    const sp = registry.getSpecialPower('SuperweaponNukeCannon');
    expect(sp).not.toBeUndefined();
    expect(sp!.academyClassify).toBe('ACT_SUPERPOWER');
  });

  it('preserves ShortcutPower and AcademyClassify through bundle round-trip', () => {
    const bundle = makeBundle({
      objects: [],
      specialPowers: [
        {
          name: 'SUPERWEAPONPARTICLECANNON',
          fields: {},
          blocks: [],
          resolved: true,
          shortcutPower: true,
          academyClassify: 'ACT_SUPERPOWER',
        },
      ],
    });
    const registry = makeRegistry(bundle);
    const sp = registry.getSpecialPower('SuperweaponParticleCannon');
    expect(sp).not.toBeUndefined();
    expect(sp!.shortcutPower).toBe(true);
    expect(sp!.academyClassify).toBe('ACT_SUPERPOWER');
  });
});

// ---------------------------------------------------------------------------
// Upgrade: AcademyClassify
// ---------------------------------------------------------------------------
describe('Upgrade ZH fields', () => {
  it('defaults AcademyClassify to undefined', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('Upgrade', 'Upgrade_AmericaDrone', {
        Type: 'PLAYER',
      }),
    ]);
    const upgrade = registry.getUpgrade('Upgrade_AmericaDrone');
    expect(upgrade).not.toBeUndefined();
    expect(upgrade!.academyClassify).toBeUndefined();
  });

  it('extracts AcademyClassify enum value', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('Upgrade', 'Upgrade_AmericaRadar', {
        Type: 'PLAYER',
        AcademyClassify: 'ACT_UPGRADE_RADAR',
      }),
    ]);
    const upgrade = registry.getUpgrade('Upgrade_AmericaRadar');
    expect(upgrade).not.toBeUndefined();
    expect(upgrade!.academyClassify).toBe('ACT_UPGRADE_RADAR');
  });

  it('preserves AcademyClassify through bundle round-trip', () => {
    const bundle = makeBundle({
      objects: [],
      upgrades: [
        {
          name: 'Upgrade_AmericaRadar',
          fields: {},
          kindOf: [],
          academyClassify: 'ACT_UPGRADE_RADAR',
        },
      ],
    });
    const registry = makeRegistry(bundle);
    const upgrade = registry.getUpgrade('Upgrade_AmericaRadar');
    expect(upgrade).not.toBeUndefined();
    expect(upgrade!.academyClassify).toBe('ACT_UPGRADE_RADAR');
  });
});

// ---------------------------------------------------------------------------
// ZH-only KindOf bitfield values
// ---------------------------------------------------------------------------
describe('ZH KindOf enum additions', () => {
  // Source parity: GeneralsMD/Code/GameEngine/Source/Common/System/KindOf.cpp
  // KindOfMaskType::s_bitNameList — 28 values added after DONT_AUTO_CRUSH_INFANTRY.

  const ZH_ONLY_KINDOF_VALUES = [
    'CLIFF_JUMPER',
    'FS_SUPPLY_DROPZONE',
    'FS_SUPERWEAPON',
    'FS_BLACK_MARKET',
    'FS_SUPPLY_CENTER',
    'FS_STRATEGY_CENTER',
    'MONEY_HACKER',
    'ARMOR_SALVAGER',
    'REVEALS_ENEMY_PATHS',
    'BOOBY_TRAP',
    'FS_FAKE',
    'FS_INTERNET_CENTER',
    'BLAST_CRATER',
    'PROP',
    'OPTIMIZED_TREE',
    'FS_ADVANCED_TECH',
    'FS_BARRACKS',
    'FS_WARFACTORY',
    'FS_AIRFIELD',
    'AIRCRAFT_CARRIER',
    'NO_SELECT',
    'REJECT_UNMANNED',
    'CANNOT_RETALIATE',
    'TECH_BASE_DEFENSE',
    'EMP_HARDENED',
    'DEMOTRAP',
    'CONSERVATIVE_BUILDING',
    'IGNORE_DOCKING_BONES',
  ] as const;

  it('includes all 28 ZH-only KindOf values in the script name array', () => {
    for (const name of ZH_ONLY_KINDOF_VALUES) {
      expect(
        SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT.includes(name),
        `SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT should contain '${name}'`,
      ).toBe(true);
    }
  });

  it('maps all ZH-only KindOf values to valid bit indices', () => {
    for (const name of ZH_ONLY_KINDOF_VALUES) {
      const index = SCRIPT_KIND_OF_NAME_TO_BIT.get(name);
      expect(index, `'${name}' should have a bit index`).not.toBeUndefined();
      expect(index! >= 0).toBe(true);
    }
  });

  it('does not include Generals-only AIRFIELD value (replaced by FS_AIRFIELD)', () => {
    // Source parity: ZH removed KINDOF_AIRFIELD from the enum; FS_AIRFIELD replaces it.
    const airfieldIndex = SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT.indexOf('AIRFIELD' as any);
    expect(airfieldIndex).toBe(-1);
    expect(SCRIPT_KIND_OF_NAME_TO_BIT.has('FS_AIRFIELD')).toBe(true);
  });

  it('maintains correct ZH bit ordering (DONT_AUTO_CRUSH_INFANTRY before ZH additions)', () => {
    const lastGenerals = SCRIPT_KIND_OF_NAME_TO_BIT.get('DONT_AUTO_CRUSH_INFANTRY')!;
    const firstZH = SCRIPT_KIND_OF_NAME_TO_BIT.get('CLIFF_JUMPER')!;
    expect(firstZH).toBe(lastGenerals + 1);
  });

  it('ALLOW_SURRENDER variant also includes all ZH-only values', () => {
    for (const name of ZH_ONLY_KINDOF_VALUES) {
      expect(
        SCRIPT_KIND_OF_NAMES_BY_SOURCE_BIT_ALLOW_SURRENDER.includes(name),
        `ALLOW_SURRENDER array should contain '${name}'`,
      ).toBe(true);
    }
  });

  it('ALLOW_SURRENDER variant inserts PRISON/POW_TRUCK and CAN_SURRENDER at correct offsets', () => {
    expect(SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.has('PRISON')).toBe(true);
    expect(SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.has('COLLECTS_PRISON_BOUNTY')).toBe(true);
    expect(SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.has('POW_TRUCK')).toBe(true);
    expect(SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.has('CAN_SURRENDER')).toBe(true);

    // PRISON should come right after COMMANDCENTER
    const commandCenterIdx = SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.get('COMMANDCENTER')!;
    const prisonIdx = SCRIPT_KIND_OF_NAME_TO_BIT_ALLOW_SURRENDER.get('PRISON')!;
    expect(prisonIdx).toBe(commandCenterIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// ZH-only ObjectStatus bitfield values
// ---------------------------------------------------------------------------
describe('ZH ObjectStatus enum additions', () => {
  // Source parity: GeneralsMD/Code/GameEngine/Source/Common/System/ObjectStatusTypes.cpp
  // ObjectStatusMaskType::s_bitNameList — 14 values added after IS_CARBOMB.

  const ZH_ONLY_STATUS_VALUES = [
    'DECK_HEIGHT_OFFSET',
    'STATUS_RIDER1',
    'STATUS_RIDER2',
    'STATUS_RIDER3',
    'STATUS_RIDER4',
    'STATUS_RIDER5',
    'STATUS_RIDER6',
    'STATUS_RIDER7',
    'STATUS_RIDER8',
    'FAERIE_FIRE',
    'KILLING_SELF',
    'REASSIGN_PARKING',
    'BOOBY_TRAPPED',
    'IMMOBILE',
    'DISGUISED',
    'DEPLOYED',
  ] as const;

  it('includes all 14 ZH-only ObjectStatus values in the script name map', () => {
    for (const name of ZH_ONLY_STATUS_VALUES) {
      expect(
        SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.has(name),
        `SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME should contain '${name}'`,
      ).toBe(true);
    }
  });

  it('maps ZH ObjectStatus values to indices after IS_CARBOMB', () => {
    const carbombIdx = SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get('IS_CARBOMB')!;
    expect(carbombIdx).toBeDefined();

    for (const name of ZH_ONLY_STATUS_VALUES) {
      const idx = SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get(name)!;
      expect(idx, `'${name}' should have index > IS_CARBOMB (${carbombIdx})`).toBeGreaterThan(carbombIdx);
    }
  });

  it('preserves Generals-era ObjectStatus indices unchanged', () => {
    // First and last Generals-era values should maintain their positions.
    expect(SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get('DESTROYED')).toBe(0);
    expect(SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get('IS_CARBOMB')).toBe(27);
  });

  it('DECK_HEIGHT_OFFSET is immediately after IS_CARBOMB', () => {
    expect(SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get('DECK_HEIGHT_OFFSET')).toBe(28);
  });

  it('DEPLOYED is the last ZH ObjectStatus value', () => {
    expect(SCRIPT_OBJECT_STATUS_BIT_INDEX_BY_NAME.get('DEPLOYED')).toBe(43);
  });
});
