import { describe, it, expect } from 'vitest';
import { parseIni } from './ini-parser.js';

describe('INI Parser', () => {
  it('parses a simple object block', () => {
    const source = `
Object TestTank
  Side = America
  TransportSlotCount = 3
  MaxHealth = 300.0
End
`;
    const result = parseIni(source);
    expect(result.errors).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);

    const obj = result.blocks[0]!;
    expect(obj.type).toBe('Object');
    expect(obj.name).toBe('TestTank');
    expect(obj.fields['Side']).toBe('America');
    expect(obj.fields['TransportSlotCount']).toBe(3);
    expect(obj.fields['MaxHealth']).toBe(300.0);
  });

  it('parses boolean fields', () => {
    const source = `
Object TestUnit
  IsSelectable = Yes
  IsPrerequisite = No
End
`;
    const result = parseIni(source);
    expect(result.blocks[0]!.fields['IsSelectable']).toBe(true);
    expect(result.blocks[0]!.fields['IsPrerequisite']).toBe(false);
  });

  it('parses multi-value fields as arrays', () => {
    const source = `
Object TestUnit
  KindOf = VEHICLE SELECTABLE CAN_ATTACK
End
`;
    const result = parseIni(source);
    expect(result.blocks[0]!.fields['KindOf']).toEqual([
      'VEHICLE',
      'SELECTABLE',
      'CAN_ATTACK',
    ]);
  });

  it('parses coordinate-like numeric arrays', () => {
    const source = `
Object TestUnit
  GeometryOffset = 0.0 5.0 10.0
End
`;
    const result = parseIni(source);
    expect(result.blocks[0]!.fields['GeometryOffset']).toEqual([0.0, 5.0, 10.0]);
  });

  it('parses inheritance syntax', () => {
    const source = `
Object CrusaderTank : BaseTank
  MaxHealth = 500.0
End
`;
    const result = parseIni(source);
    const obj = result.blocks[0]!;
    expect(obj.name).toBe('CrusaderTank');
    expect(obj.parent).toBe('BaseTank');
    expect(obj.fields['MaxHealth']).toBe(500.0);
  });

  it('parses ObjectReskin headers as parent-linked object definitions', () => {
    const source = `
ObjectReskin Chem_GLAVehicleTechnical GLAVehicleTechnical
  BuildCost = 550
End
`;
    const result = parseIni(source);
    expect(result.errors).toHaveLength(0);
    const obj = result.blocks[0]!;
    expect(obj.type).toBe('ObjectReskin');
    expect(obj.name).toBe('Chem_GLAVehicleTechnical');
    expect(obj.parent).toBe('GLAVehicleTechnical');
    expect(obj.fields['BuildCost']).toBe(550);
  });

  it('strips comments', () => {
    const source = `
Object TestUnit ; this is a comment
  ; full line comment
  MaxHealth = 100.0 ; inline comment
  // C-style comment
End
`;
    const result = parseIni(source);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.fields['MaxHealth']).toBe(100.0);
  });

  it('parses multiple top-level blocks', () => {
    const source = `
Weapon TankGun
  Damage = 50
  Range = 200.0
End

Object TestTank
  Side = China
End
`;
    const result = parseIni(source);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.type).toBe('Weapon');
    expect(result.blocks[0]!.name).toBe('TankGun');
    expect(result.blocks[1]!.type).toBe('Object');
    expect(result.blocks[1]!.name).toBe('TestTank');
  });

  it('parses percentage values', () => {
    const source = `
Object TestUnit
  DamagePercent = 50%
End
`;
    const result = parseIni(source);
    expect(result.blocks[0]!.fields['DamagePercent']).toBe(0.5);
  });

  // ==================== New Phase 1 tests ====================

  describe('#define macro substitution', () => {
    it('substitutes a simple define', () => {
      const source = `
#define TANK_HEALTH 300.0
Object TestTank
  MaxHealth = TANK_HEALTH
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks[0]!.fields['MaxHealth']).toBe(300.0);
    });

    it('substitutes multiple defines', () => {
      const source = `
#define HP 500
#define SIDE America
Object TestTank
  MaxHealth = HP
  Side = SIDE
End
`;
      const result = parseIni(source);
      expect(result.blocks[0]!.fields['MaxHealth']).toBe(500);
      expect(result.blocks[0]!.fields['Side']).toBe('America');
    });

    it('returns defines in result', () => {
      const source = `
#define MY_VAL 42
Object Foo
  X = 1
End
`;
      const result = parseIni(source);
      expect(result.defines.get('MY_VAL')).toBe('42');
    });

    it('accepts pre-existing defines from options', () => {
      const source = `
Object TestTank
  MaxHealth = EXTERNAL_HP
End
`;
      const result = parseIni(source, {
        defines: new Map([['EXTERNAL_HP', '999']]),
      });
      expect(result.blocks[0]!.fields['MaxHealth']).toBe(999);
    });
  });

  describe('#include directive', () => {
    it('records include paths without resolver', () => {
      const source = `
#include "weapons.ini"
Object TestTank
  Side = America
End
`;
      const result = parseIni(source);
      expect(result.includes).toContain('weapons.ini');
      expect(result.blocks).toHaveLength(1);
    });

    it('resolves includes with callback', () => {
      const weaponsIni = `
Weapon TankGun
  Damage = 50
End
`;
      const source = `
#include "weapons.ini"
Object TestTank
  Side = America
End
`;
      const result = parseIni(source, {
        resolveInclude: (path) => path === 'weapons.ini' ? weaponsIni : null,
      });
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0]!.type).toBe('Weapon');
      expect(result.blocks[1]!.type).toBe('Object');
    });

    it('reports error for missing include', () => {
      const source = `
#include "missing.ini"
Object Foo
  X = 1
End
`;
      const result = parseIni(source, {
        resolveInclude: () => null,
      });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain('not found');
    });

    it('detects circular includes', () => {
      const source = `
#include "self.ini"
Object Foo
  X = 1
End
`;
      const result = parseIni(source, {
        filePath: 'self.ini',
        resolveInclude: () => source,
      });
      expect(result.errors.some((e) => e.message.includes('Circular'))).toBe(true);
    });

    it('propagates defines across includes', () => {
      const base = `
#define BASE_HP 100
`;
      const main = `
#include "base.ini"
Object TestTank
  MaxHealth = BASE_HP
End
`;
      const result = parseIni(main, {
        filePath: 'main.ini',
        resolveInclude: (path) => path === 'base.ini' ? base : null,
      });
      expect(result.errors).toHaveLength(0);
      expect(result.blocks[0]!.fields['MaxHealth']).toBe(100);
    });
  });

  describe('singleton blocks', () => {
    it('parses GameData without name', () => {
      const source = `
GameData
  MaxCameraHeight = 800.0
  MinCameraHeight = 120.0
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.type).toBe('GameData');
      expect(result.blocks[0]!.name).toBe('');
      expect(result.blocks[0]!.fields['MaxCameraHeight']).toBe(800.0);
    });

    it('parses AI block without name', () => {
      const source = `
AI
  AttackUsesLineOfSight = no
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.type).toBe('AI');
      expect(result.blocks[0]!.name).toBe('');
      expect(result.blocks[0]!.fields['AttackUsesLineOfSight']).toBe(false);
    });

    it('parses AudioSettings block without name', () => {
      const source = `
AudioSettings
  SampleCount2D = 8
  SampleCount3D = 28
  StreamCount = 3
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.type).toBe('AudioSettings');
      expect(result.blocks[0]!.name).toBe('');
      expect(result.blocks[0]!.fields['SampleCount2D']).toBe(8);
      expect(result.blocks[0]!.fields['SampleCount3D']).toBe(28);
      expect(result.blocks[0]!.fields['StreamCount']).toBe(3);
    });
  });

  describe('+= additive fields', () => {
    it('appends to existing array field', () => {
      const source = `
Object TestUnit
  KindOf = VEHICLE SELECTABLE
  KindOf += CAN_ATTACK
End
`;
      const result = parseIni(source);
      expect(result.blocks[0]!.fields['KindOf']).toEqual([
        'VEHICLE', 'SELECTABLE', 'CAN_ATTACK',
      ]);
    });

    it('creates new array from += on undefined field', () => {
      const source = `
Object TestUnit
  KindOf += VEHICLE
End
`;
      const result = parseIni(source);
      expect(result.blocks[0]!.fields['KindOf']).toBe('VEHICLE');
    });
  });

  describe('AddModule / RemoveModule / ReplaceModule', () => {
    it('parses AddModule as sub-block', () => {
      const source = `
ChildObject AdvancedTank : BaseTank
  AddModule ModuleTag_New
    MaxHealth = 999
  End
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      const child = result.blocks[0]!;
      expect(child.blocks).toHaveLength(1);
      expect(child.blocks[0]!.type).toBe('AddModule');
      expect(child.blocks[0]!.name).toBe('ModuleTag_New');
      expect(child.blocks[0]!.fields['MaxHealth']).toBe(999);
    });

    it('parses RemoveModule as directive', () => {
      const source = `
ChildObject AdvancedTank : BaseTank
  RemoveModule ModuleTag_Old
End
`;
      const result = parseIni(source);
      const child = result.blocks[0]!;
      expect(child.blocks).toHaveLength(1);
      expect(child.blocks[0]!.type).toBe('RemoveModule');
      expect(child.blocks[0]!.name).toBe('ModuleTag_Old');
    });

    it('parses ReplaceModule as sub-block', () => {
      const source = `
ChildObject AdvancedTank : BaseTank
  ReplaceModule ModuleTag_02
    MaxHealth = 500
  End
End
`;
      const result = parseIni(source);
      const child = result.blocks[0]!;
      expect(child.blocks).toHaveLength(1);
      expect(child.blocks[0]!.type).toBe('ReplaceModule');
      expect(child.blocks[0]!.name).toBe('ModuleTag_02');
      expect(child.blocks[0]!.fields['MaxHealth']).toBe(500);
    });
  });

  describe('ConditionState-style sub-blocks', () => {
    it('parses DefaultConditionState and ConditionState blocks nested in Draw', () => {
      const source = `
Object TestBuilding
  Draw = W3DModelDraw ModuleTag_Draw
    DefaultConditionState
      Model = TBld_A
    End
    ConditionState = NIGHT
      Model = TBld_A_N
    End
    ConditionState = SNOW NIGHT
      Model = TBld_A_SN
    End
  End
End
`;

      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      const object = result.blocks[0]!;
      const draw = object.blocks[0]!;
      expect(draw.type).toBe('Draw');
      expect(draw.name).toBe('W3DModelDraw ModuleTag_Draw');
      expect(draw.blocks).toHaveLength(3);
      expect(draw.blocks[0]!.type).toBe('DefaultConditionState');
      expect(draw.blocks[0]!.name).toBe('');
      expect(draw.blocks[1]!.type).toBe('ConditionState');
      expect(draw.blocks[1]!.name).toBe('NIGHT');
      expect(draw.blocks[2]!.type).toBe('ConditionState');
      expect(draw.blocks[2]!.name).toBe('SNOW NIGHT');
    });

    it('parses AliasConditionState blocks with equals syntax', () => {
      const source = `
Object TestBuilding
  Draw = W3DModelDraw ModuleTag_Draw
    AliasConditionState = REALLYDAMAGED NIGHT
      Model = TBld_A_DN
    End
  End
End
`;

      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      const alias = result.blocks[0]!.blocks[0]!.blocks[0]!;
      expect(alias.type).toBe('AliasConditionState');
      expect(alias.name).toBe('REALLYDAMAGED NIGHT');
      expect(alias.fields['Model']).toBe('TBld_A_DN');
    });

    it('treats inline AliasConditionState directives as fields (not nested blocks)', () => {
      const source = `
Object TestBuilding
  Draw = W3DModelDraw ModuleTag_Draw
    ConditionState = NONE
      Model = TBld_A
    End
    AliasConditionState = NIGHT
    AliasConditionState = SNOW NIGHT
  End
End
`;

      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      const draw = result.blocks[0]!.blocks[0]!;
      expect(draw.blocks).toHaveLength(1);
      expect(draw.blocks[0]!.type).toBe('ConditionState');
      expect(draw.blocks[0]!.name).toBe('NONE');
      expect(draw.fields['AliasConditionState']).toEqual(['SNOW', 'NIGHT']);
    });

    it('parses empty sub-block bodies that only contain comments', () => {
      const source = `
Object TestBuilding
  ClientUpdate = LaserUpdate ModuleTag_01
    ; intentionally empty body
  End
  Behavior = DeletionUpdate ModuleTag_02
    MinLifetime = 600
  End
End
`;

      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      const object = result.blocks[0]!;
      expect(object.blocks).toHaveLength(2);
      expect(object.blocks[0]!.type).toBe('ClientUpdate');
      expect(object.blocks[0]!.name).toBe('LaserUpdate ModuleTag_01');
      expect(object.blocks[1]!.type).toBe('Behavior');
      expect(object.blocks[1]!.name).toBe('DeletionUpdate ModuleTag_02');
    });

    it('closes block on first unmatched End (C++ nesting parity)', () => {
      // C++ parser matches End by nesting depth, not indentation.
      // All real block types in retail INI files are registered, so unrecognized
      // keywords are treated as fields and their End tokens close the parent block.
      const source = `
Object TestBuilding
  Draw = W3DModelDraw ModuleTag_Draw
    ConditionState = NONE
      Model = TBld_A
    End
  End
  CommandSet = TestBuildingCommandSet
End
`;

      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      const object = result.blocks[0]!;
      expect(object.fields['CommandSet']).toBe('TestBuildingCommandSet');
      const draw = object.blocks[0]!;
      expect(draw.type).toBe('Draw');
      expect(draw.blocks[0]!.type).toBe('ConditionState');
    });

    it('handles inconsistent indentation in sub-blocks', () => {
      // Real INI files (e.g. ChemicalGeneral.ini) have indent inconsistencies
      const source = `
Object TestUnit
 WeaponSet
    Conditions = None
    Weapon = PRIMARY TestGun
  End
  Geometry = BOX
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      const object = result.blocks[0]!;
      expect(object.blocks[0]!.type).toBe('WeaponSet');
      expect(object.fields['Geometry']).toBe('BOX');
    });
  });

  describe('file context in errors', () => {
    it('includes file path in error', () => {
      const source = `
UnknownDirective Foo
`;
      const result = parseIni(source, { filePath: 'test.ini' });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.file).toBe('test.ini');
    });
  });

  describe('sub-block indentation handling', () => {
    it('does not swallow next object when sub-block-type keyword is used as inline field', () => {
      // VeterancyLevels is a SUB_BLOCK_TYPE but here used as an inline field.
      // The End at indent 2 belongs to the parent Behavior, not to VeterancyLevels.
      const source = `
Object TankA
  Behavior = EjectPilotDie ModuleTag_17
    GroundCreationList = OCL_EjectPilotOnGround
    VeterancyLevels = ALL -REGULAR
  End
  Geometry = BOX
End

Object TankB
  Side = America
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0]!.name).toBe('TankA');
      expect(result.blocks[1]!.name).toBe('TankB');
      // VeterancyLevels should be a field of EjectPilotDie, not a sub-block
      const ejectDie = result.blocks[0]!.blocks.find(b => b.name.includes('EjectPilotDie'));
      expect(ejectDie).toBeDefined();
      expect(ejectDie!.fields['VeterancyLevels']).toEqual(['ALL', '-REGULAR']);
      // Geometry should be a field of TankA, not consumed by the behavior
      expect(result.blocks[0]!.fields['Geometry']).toBe('BOX');
    });

    it('recovers Object with deep-indent closing End via nesting-based matching', () => {
      // Retail case (CivilianBuilding.ini): Object's closing End at indent 4
      // instead of indent 0. Nesting-based End matching handles this correctly
      // because all sub-blocks are detected and their End tokens consumed.
      const source = `
Object BuildingA
  Draw = W3DModelDraw ModuleTag_01
    ConditionState = NONE
      Model = Bld_A
    End
  End
  Geometry = BOX
  Shadow = SHADOW_VOLUME
    End

Object BuildingB
  Side = America
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0]!.name).toBe('BuildingA');
      expect(result.blocks[0]!.fields['Geometry']).toBe('BOX');
      expect(result.blocks[1]!.name).toBe('BuildingB');
    });

    it('treats Object keyword as field inside sub-blocks (not safety break)', () => {
      // Inside Prerequisites, "Object = Foo" is a field, not a block declaration.
      const source = `
Object TestUnit
  Prerequisites
    Object = TestBarracks
  End
  ArmorSet
    Conditions = None
    Armor = InfantryArmor
  End
  Geometry = BOX
End
`;
      const result = parseIni(source);
      expect(result.errors).toHaveLength(0);
      expect(result.blocks).toHaveLength(1);
      const obj = result.blocks[0]!;
      const prereq = obj.blocks.find(b => b.type === 'Prerequisites');
      expect(prereq).toBeDefined();
      expect(prereq!.fields['Object']).toBe('TestBarracks');
      expect(obj.fields['Geometry']).toBe('BOX');
    });
  });
});
