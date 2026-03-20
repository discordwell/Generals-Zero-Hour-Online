import { describe, it, expect, beforeEach } from 'vitest';
import { IniDataRegistry } from './registry.js';
import type { IniBlock } from '@generals/core';

function makeBlock(type: string, name: string, fields: Record<string, unknown> = {}, extra: Partial<IniBlock> = {}): IniBlock {
  return {
    type,
    name,
    fields: fields as Record<string, import('@generals/core').IniValue>,
    blocks: [],
    ...extra,
  };
}

describe('IniDataRegistry', () => {
  let registry: IniDataRegistry;

  beforeEach(() => {
    registry = new IniDataRegistry();
  });

  describe('loadBlocks', () => {
    it('indexes objects by name', () => {
      registry.loadBlocks([
        makeBlock('Object', 'TankA', { Side: 'America', MaxHealth: 300 }),
        makeBlock('Object', 'TankB', { Side: 'China', MaxHealth: 200 }),
      ]);

      expect(registry.objects.size).toBe(2);
      expect(registry.objects.get('TankA')!.side).toBe('America');
      expect(registry.objects.get('TankB')!.side).toBe('China');
    });

    it('indexes weapons', () => {
      registry.loadBlocks([
        makeBlock('Weapon', 'TankGun', { Damage: 50, Range: 200 }),
      ]);

      expect(registry.weapons.size).toBe(1);
      expect(registry.weapons.get('TankGun')!.fields['Damage']).toBe(50);
    });

    it('indexes armors', () => {
      registry.loadBlocks([
        makeBlock('Armor', 'TankArmor', { Default: 1, SMALL_ARMS: 0.1 }),
      ]);

      expect(registry.armors.size).toBe(1);
    });

    it('indexes upgrades', () => {
      registry.loadBlocks([
        makeBlock('Upgrade', 'ArmorUpgrade', { BuildCost: 500 }),
      ]);

      expect(registry.upgrades.size).toBe(1);
    });

    it('indexes sciences', () => {
      registry.loadBlocks([
        makeBlock('Science', 'SCIENCE_Pathfinder', { SciencePurchasePointCost: 1 }),
      ]);

      expect(registry.sciences.size).toBe(1);
    });

    it('indexes PlayerTemplate as factions', () => {
      registry.loadBlocks([
        makeBlock('PlayerTemplate', 'FactionAmerica', { Side: 'America' }),
        makeBlock('PlayerTemplate', 'FactionChina', { Side: 'China' }),
      ]);

      expect(registry.factions.size).toBe(2);
      expect(registry.factions.get('FactionAmerica')!.side).toBe('America');
    });

    it('tracks KindOf arrays', () => {
      registry.loadBlocks([
        makeBlock('Object', 'Tank', { KindOf: ['VEHICLE', 'SELECTABLE', 'CAN_ATTACK'] }),
      ]);

      expect(registry.objects.get('Tank')!.kindOf).toEqual(['VEHICLE', 'SELECTABLE', 'CAN_ATTACK']);
    });

    it('handles ChildObject type', () => {
      registry.loadBlocks([
        makeBlock('ChildObject', 'AdvTank', { MaxHealth: 500 }, { parent: 'BaseTank' }),
      ]);

      expect(registry.objects.size).toBe(1);
      expect(registry.objects.get('AdvTank')!.parent).toBe('BaseTank');
    });

    it('handles ObjectReskin type', () => {
      registry.loadBlocks([
        makeBlock('ObjectReskin', 'ChemTank', { BuildCost: 600 }, { parent: 'BaseTank' }),
      ]);

      expect(registry.objects.size).toBe(1);
      expect(registry.objects.get('ChemTank')!.parent).toBe('BaseTank');
      expect(registry.objects.get('ChemTank')!.fields['BuildCost']).toBe(600);
    });

    it('indexes SpecialPower and ObjectCreationList definitions', () => {
      registry.loadBlocks([
        makeBlock('SpecialPower', 'SP_Tactical_Ability', {
          Type: 'Instant',
          SpecialPowerTemplate: 'OCL_Fx',
        }, { parent: 'BaseSpecialPower' }),
        makeBlock('ObjectCreationList', 'OCL_Fx', {
          CreateAtEdge: 'No',
        }),
      ]);

      const sp = registry.getSpecialPower('SP_Tactical_Ability');
      const ocl = registry.getObjectCreationList('OCL_Fx');

      expect(sp).toBeDefined();
      expect(sp?.name).toBe('SP_Tactical_Ability');
      expect(sp?.parent).toBe('BaseSpecialPower');
      expect(sp?.fields).toMatchObject({ Type: 'Instant' });
      expect(ocl).toBeDefined();
      expect(ocl?.name).toBe('OCL_Fx');
      expect(ocl?.fields).toMatchObject({ CreateAtEdge: 'No' });
    });

    it('tracks unsupported block types', () => {
      registry.loadBlocks([
        makeBlock('CustomThing', 'Foo', {}),
      ]);

      expect(registry.getUnsupportedBlockTypes()).toEqual(['CustomThing']);
    });

    it('indexes CommandButton/CommandSet/AudioEvent families and skips other known non-indexed types', () => {
      registry.loadBlocks([
        makeBlock('CommandButton', 'Btn1', {
          Command: 'ATTACK_MOVE',
          Options: 'NEED_TARGET_POS OK_FOR_MULTI_SELECT',
          UnitSpecificSound: 'UnitSound_AttackMove',
        }),
        makeBlock('CommandSet', 'Set1', {
          1: 'Btn1',
          2: 'BtnMissing',
        }),
        makeBlock('CommandButton', 'BtnNoSound', {
          Command: 'STOP',
          UnitSpecificSound: 'NoSound',
        }),
        makeBlock('FXList', 'FX1', {}),
        makeBlock('AudioEvent', 'Sound1', {
          Priority: 'HIGH',
          Type: 'WORLD PLAYER',
          Control: 'RANDOM',
          Volume: '75%',
          MinVolume: '10%',
          Limit: '2',
          MinRange: '10',
          MaxRange: '250',
        }),
        makeBlock('MusicTrack', 'Track1', {
          Filename: 'music/track1.mp3',
          Type: 'UI',
        }),
        makeBlock('DialogEvent', 'Dialog1', {
          Type: 'VOICE PLAYER',
        }),
        makeBlock('MiscAudio', '', {
          GUIClickSound: 'ClickFX',
          NoCanDoSound: 'ErrorFX',
          RadarNotifyOnlineSound: 'RadarOnline',
        }),
        makeBlock('AI', 'AI', { AttackUsesLineOfSight: '0' }),
      ]);

      expect(registry.objects.size).toBe(0);
      expect(registry.commandButtons.get('Btn1')?.commandTypeName).toBe('ATTACK_MOVE');
      expect(registry.commandButtons.get('Btn1')?.options).toEqual([
        'NEED_TARGET_POS',
        'OK_FOR_MULTI_SELECT',
      ]);
      expect(registry.commandButtons.get('Btn1')?.unitSpecificSoundName).toBe('UnitSound_AttackMove');
      expect(registry.commandButtons.get('BtnNoSound')?.unitSpecificSoundName).toBeUndefined();
      expect(registry.commandSets.get('Set1')?.buttons).toEqual(['Btn1', 'BtnMissing']);
      expect(registry.commandSets.get('Set1')?.slottedButtons).toEqual([
        { slot: 1, commandButtonName: 'Btn1' },
        { slot: 2, commandButtonName: 'BtnMissing' },
      ]);
      expect(registry.getAudioEvent('Sound1')?.soundType).toBe('sound');
      expect(registry.getAudioEvent('Sound1')?.priorityName).toBe('HIGH');
      expect(registry.getAudioEvent('Sound1')?.typeNames).toEqual(['WORLD', 'PLAYER']);
      expect(registry.getAudioEvent('Sound1')?.controlNames).toEqual(['RANDOM']);
      expect(registry.getAudioEvent('Sound1')?.volume).toBeCloseTo(0.75);
      expect(registry.getAudioEvent('Sound1')?.minVolume).toBeCloseTo(0.1);
      expect(registry.getAudioEvent('Sound1')?.limit).toBe(2);
      expect(registry.getAudioEvent('Sound1')?.minRange).toBe(10);
      expect(registry.getAudioEvent('Sound1')?.maxRange).toBe(250);
      expect(registry.getAudioEvent('Track1')?.soundType).toBe('music');
      expect(registry.getAudioEvent('Track1')?.filename).toBe('music/track1.mp3');
      expect(registry.getAudioEvent('Dialog1')?.soundType).toBe('streaming');
      expect(registry.getMiscAudio()?.guiClickSoundName).toBe('ClickFX');
      expect(registry.getMiscAudio()?.noCanDoSoundName).toBe('ErrorFX');
      expect(registry.getMiscAudio()?.entries['RadarNotifyOnlineSound']).toBe('RadarOnline');
      expect(registry.getUnsupportedBlockTypes()).toEqual([]);
    });

    it('keeps sparse CommandSet slots and ignores out-of-range slots', () => {
      registry.loadBlocks([
        makeBlock('CommandSet', 'SparseSet', {
          1: 'BtnA',
          3: 'BtnC',
          13: 'BtnOutOfRange',
        }),
      ]);

      expect(registry.commandSets.get('SparseSet')?.buttons).toEqual(['BtnA', 'BtnC']);
      expect(registry.commandSets.get('SparseSet')?.slottedButtons).toEqual([
        { slot: 1, commandButtonName: 'BtnA' },
        { slot: 3, commandButtonName: 'BtnC' },
      ]);
    });

    it('indexes AIData block config values and normalizes durations to frames', () => {
      registry.loadBlocks([
        makeBlock('AIData', '', {
          AttackUsesLineOfSight: 'no',
          SkirmishBaseDefenseExtraDistance: '25.5',
          Wealthy: '7000',
          Poor: '2000',
          GuardInnerModifierAI: '1.1',
          GuardOuterModifierAI: '1.333',
          GuardInnerModifierHuman: '1.8',
          GuardOuterModifierHuman: '2.2',
          GuardChaseUnitsDuration: '10000',
          GuardEnemyScanRate: '500',
          GuardEnemyReturnScanRate: '1000',
        }),
      ]);

      expect(registry.getAiConfig()).toMatchObject({
        attackUsesLineOfSight: false,
        skirmishBaseDefenseExtraDistance: 25.5,
        resourcesWealthy: 7000,
        resourcesPoor: 2000,
        guardInnerModifierAI: 1.1,
        guardOuterModifierAI: 1.333,
        guardInnerModifierHuman: 1.8,
        guardOuterModifierHuman: 2.2,
        guardChaseUnitFrames: 300,
        guardEnemyScanRateFrames: 15,
        guardEnemyReturnScanRateFrames: 30,
      });
    });

    it('indexes AudioSettings runtime fields', () => {
      registry.loadBlocks([
        makeBlock('AudioSettings', '', {
          SampleCount2D: '10',
          SampleCount3D: '28',
          StreamCount: '3',
          MinSampleVolume: '12%',
          GlobalMinRange: '35',
          GlobalMaxRange: '275',
          Relative2DVolume: '-25%',
          DefaultSoundVolume: '80%',
          Default3DSoundVolume: '70%',
          DefaultSpeechVolume: '60%',
          DefaultMusicVolume: '55%',
        }),
      ]);

      expect(registry.getAudioSettings()).toEqual({
        sampleCount2D: 10,
        sampleCount3D: 28,
        streamCount: 3,
        minSampleVolume: 0.12,
        globalMinRange: 35,
        globalMaxRange: 275,
        relative2DVolume: -0.25,
        defaultSoundVolume: 0.8,
        default3DSoundVolume: 0.7,
        defaultSpeechVolume: 0.6,
        defaultMusicVolume: 0.55,
      });
    });

    it('parses Locomotor Speed from INI data', () => {
      registry.loadBlocks([
        makeBlock('Locomotor', 'TestGroundLocomotor', { Surfaces: ['GROUND'], Speed: '42' }),
      ]);

      const locomotor = registry.getLocomotor('TestGroundLocomotor');

      expect(locomotor?.name).toBe('TestGroundLocomotor');
      expect(locomotor?.speed).toBe(42);
    });
  });

  describe('getObjectsByKind', () => {
    it('filters by KindOf flag', () => {
      registry.loadBlocks([
        makeBlock('Object', 'Tank', { KindOf: ['VEHICLE', 'CAN_ATTACK'] }),
        makeBlock('Object', 'Infantry', { KindOf: ['INFANTRY', 'CAN_ATTACK'] }),
        makeBlock('Object', 'Building', { KindOf: ['STRUCTURE'] }),
      ]);

      expect(registry.getObjectsByKind('CAN_ATTACK')).toHaveLength(2);
      expect(registry.getObjectsByKind('STRUCTURE')).toHaveLength(1);
      expect(registry.getObjectsByKind('AIRCRAFT')).toHaveLength(0);
    });
  });

  describe('getObjectsBySide', () => {
    it('filters by side', () => {
      registry.loadBlocks([
        makeBlock('Object', 'USATank', { Side: 'America' }),
        makeBlock('Object', 'ChinaTank', { Side: 'China' }),
        makeBlock('Object', 'GLATank', { Side: 'GLA' }),
      ]);

      expect(registry.getObjectsBySide('America')).toHaveLength(1);
      expect(registry.getObjectsBySide('China')).toHaveLength(1);
    });
  });

  describe('lookup helpers', () => {
    it('gets object by name', () => {
      registry.loadBlocks([
        makeBlock('Object', 'TankA', { Side: 'America' }),
      ]);

      expect(registry.getObject('TankA')?.name).toBe('TankA');
      expect(registry.getWeapon('Missing Weapon')).toBeUndefined();
    });

    it('tracks duplicate definitions as warnings', () => {
      registry.loadBlocks([makeBlock('Object', 'TankA', { Side: 'America' })]);
      registry.loadBlocks([makeBlock('Object', 'TankA', { Side: 'China' })]);

      expect(registry.errors).toHaveLength(1);
      expect(registry.errors[0]!.type).toBe('duplicate');
      expect(registry.objects.get('TankA')?.side).toBe('China');
    });
  });

  describe('resolveInheritance', () => {
    it('merges parent fields into child', () => {
      registry.loadBlocks([
        makeBlock('Object', 'BaseTank', { Side: 'America', MaxHealth: 100, Armor: 'Light' }),
        makeBlock('Object', 'AdvTank', { MaxHealth: 500 }, { parent: 'BaseTank' }),
      ]);

      registry.resolveInheritance();

      const adv = registry.objects.get('AdvTank')!;
      expect(adv.resolved).toBe(true);
      expect(adv.fields['MaxHealth']).toBe(500); // overridden
      expect(adv.fields['Armor']).toBe('Light'); // inherited
      expect(adv.side).toBe('America'); // inherited
    });

    it('handles multi-level inheritance', () => {
      registry.loadBlocks([
        makeBlock('Object', 'Base', { Level: 1, A: 'a' }),
        makeBlock('Object', 'Mid', { Level: 2, B: 'b' }, { parent: 'Base' }),
        makeBlock('Object', 'Top', { Level: 3, C: 'c' }, { parent: 'Mid' }),
      ]);

      registry.resolveInheritance();

      const top = registry.objects.get('Top')!;
      expect(top.fields['Level']).toBe(3);
      expect(top.fields['A']).toBe('a');
      expect(top.fields['B']).toBe('b');
      expect(top.fields['C']).toBe('c');
    });

    it('reports unresolved parent', () => {
      registry.loadBlocks([
        makeBlock('Object', 'Orphan', { MaxHealth: 100 }, { parent: 'NonExistent' }),
      ]);

      registry.resolveInheritance();

      expect(registry.errors).toHaveLength(1);
      expect(registry.errors[0]!.type).toBe('unresolved_parent');
      expect(registry.errors[0]!.detail).toContain('NonExistent');
    });

    it('handles circular inheritance', () => {
      registry.loadBlocks([
        makeBlock('Object', 'A', {}, { parent: 'B' }),
        makeBlock('Object', 'B', {}, { parent: 'A' }),
      ]);

      registry.resolveInheritance();

      expect(registry.errors.some((e) => e.detail.includes('Circular'))).toBe(true);
    });

    it('inherits KindOf from parent', () => {
      registry.loadBlocks([
        makeBlock('Object', 'BaseVehicle', { KindOf: ['VEHICLE', 'SELECTABLE'] }),
        makeBlock('Object', 'Tank', { MaxHealth: 300 }, { parent: 'BaseVehicle' }),
      ]);

      registry.resolveInheritance();

      expect(registry.objects.get('Tank')!.kindOf).toEqual(['VEHICLE', 'SELECTABLE']);
    });

    it('resolves parent links case-insensitively', () => {
      registry.loadBlocks([
        makeBlock('Object', 'BaseVehicle', { Side: 'America', KindOf: ['VEHICLE'] }),
        makeBlock('Object', 'Tank', { MaxHealth: 300 }, { parent: 'basevehicle' }),
      ]);

      registry.resolveInheritance();

      const tank = registry.objects.get('Tank')!;
      expect(tank.fields['MaxHealth']).toBe(300);
      expect(tank.side).toBe('America');
      expect(tank.kindOf).toEqual(['VEHICLE']);
      expect(registry.errors).toHaveLength(0);
    });

    it('resolves weapon, special-power, and object-creation-list inheritance', () => {
      registry.loadBlocks([
        makeBlock('Weapon', 'BaseGun', { Damage: 30, AttackRange: 120 }),
        makeBlock('Weapon', 'FastGun', { Damage: 45 }, { parent: 'basegun' }),
        makeBlock('SpecialPower', 'BasePower', { ReloadTime: 15, RadiusCursorRadius: 50 }),
        makeBlock('SpecialPower', 'ChildPower', { Type: 'INSTANT' }, { parent: 'BasePower' }),
        makeBlock('ObjectCreationList', 'OCL_Base', { CreateAtEdge: 'No', Count: 1 }),
        makeBlock('ObjectCreationList', 'OCL_Child', { ObjectNames: 'TankA' }, { parent: 'ocl_base' }),
      ]);

      registry.resolveInheritance();

      const fastGun = registry.getWeapon('FastGun')!;
      expect(fastGun.fields['Damage']).toBe(45);
      expect(fastGun.fields['AttackRange']).toBe(120);
      expect(fastGun.resolved).toBe(true);

      const childPower = registry.getSpecialPower('ChildPower')!;
      expect(childPower.fields['Type']).toBe('INSTANT');
      expect(childPower.fields['ReloadTime']).toBe(15);
      expect(childPower.resolved).toBe(true);

      const childOcl = registry.getObjectCreationList('OCL_Child')!;
      expect(childOcl.fields['ObjectNames']).toBe('TankA');
      expect(childOcl.fields['CreateAtEdge']).toBe('No');
      expect(childOcl.resolved).toBe(true);
    });

    it('counts unresolved inheritance across all inheriting block types', () => {
      registry.loadBlocks([
        makeBlock('Object', 'Object_Orphan', { MaxHealth: 100 }, { parent: 'MissingObjectParent' }),
        makeBlock('Weapon', 'Weapon_Orphan', { Damage: 25 }, { parent: 'MissingWeaponParent' }),
        makeBlock('SpecialPower', 'Power_Orphan', { Type: 'INSTANT' }, { parent: 'MissingPowerParent' }),
        makeBlock('ObjectCreationList', 'OCL_Orphan', { Count: 1 }, { parent: 'MissingOclParent' }),
      ]);

      registry.resolveInheritance();

      expect(registry.getStats().unresolvedInheritance).toBe(4);
      expect(registry.errors.filter((error) => error.type === 'unresolved_parent')).toHaveLength(4);
    });
  });

  describe('getStats', () => {
    it('returns correct counts', () => {
      registry.loadBlocks([
        makeBlock('Object', 'Tank1', {}),
        makeBlock('Object', 'Tank2', {}),
        makeBlock('Weapon', 'Gun1', {}),
        makeBlock('Armor', 'Armor1', {}),
        makeBlock('Upgrade', 'Upgrade1', {}),
        makeBlock('Science', 'Science1', {}),
        makeBlock('PlayerTemplate', 'Faction1', {}),
      ]);

      const stats = registry.getStats();
      expect(stats.objects).toBe(2);
      expect(stats.weapons).toBe(1);
      expect(stats.armors).toBe(1);
      expect(stats.upgrades).toBe(1);
      expect(stats.sciences).toBe(1);
      expect(stats.factions).toBe(1);
      expect(stats.audioEvents).toBe(0);
      expect(stats.commandButtons).toBe(0);
      expect(stats.commandSets).toBe(0);
      expect(stats.particleSystems).toBe(0);
      expect(stats.fxLists).toBe(0);
      expect(stats.staticGameLODs).toBe(0);
      expect(stats.dynamicGameLODs).toBe(0);
      expect(stats.totalBlocks).toBe(7);
    });
  });

  describe('toBundle', () => {
    it('returns deterministic sorted arrays', () => {
      registry.loadBlocks([
        makeBlock('Object', 'TankZ', { Side: 'America' }),
        makeBlock('Object', 'TankA', { Side: 'China' }),
        makeBlock('Weapon', 'GunC', {}),
        makeBlock('Weapon', 'GunA', {}),
        makeBlock('SpecialPower', 'Power_Z', {
          Type: 'Instant',
          SpecialPowerTemplate: 'OCL_01',
        }),
        makeBlock('SpecialPower', 'Power_A', {
          Type: 'Instant',
          SpecialPowerTemplate: 'OCL_02',
        }),
        makeBlock('ObjectCreationList', 'Spawn_Z', {
          CreateAtEdge: 'No',
        }),
        makeBlock('ObjectCreationList', 'Spawn_A', {
          CreateAtEdge: 'No',
        }),
      ]);

      const bundle = registry.toBundle();

      expect(bundle.objects[0]!.name).toBe('TankA');
      expect(bundle.objects[1]!.name).toBe('TankZ');
      expect(bundle.weapons[0]!.name).toBe('GunA');
      expect(bundle.weapons[1]!.name).toBe('GunC');
      expect(bundle.specialPowers?.[0]!.name).toBe('Power_A');
      expect(bundle.specialPowers?.[1]!.name).toBe('Power_Z');
      expect(bundle.objectCreationLists?.[0]!.name).toBe('Spawn_A');
      expect(bundle.objectCreationLists?.[1]!.name).toBe('Spawn_Z');
      expect(bundle.stats.objects).toBe(2);
      expect(bundle.stats.weapons).toBe(2);
    });
  });

  describe('loadBundle', () => {
    it('restores registry state from a deterministic bundle', () => {
      const bundle = {
        objects: [
          {
            name: 'TankA',
            side: 'America',
            fields: { Side: 'America', MaxHealth: 100 },
            blocks: [],
            resolved: true,
          },
        ],
        weapons: [
          { name: 'Gun', fields: { Damage: 50 }, blocks: [] },
        ],
        armors: [
          { name: 'HeavyArmor', fields: { MAX_DAMAGE: 10 } },
        ],
        upgrades: [
          { name: 'UpgradeA', fields: { BuildTime: 10 } },
        ],
        sciences: [
          { name: 'ScienceA', fields: { SciencePurchasePointCost: 1 } },
        ],
        factions: [
          { name: 'FactionUSA', side: 'America', fields: { Name: 'USA' } },
        ],
        stats: {
          objects: 1,
          weapons: 1,
          armors: 1,
          upgrades: 1,
          sciences: 1,
          factions: 1,
          audioEvents: 0,
          commandButtons: 0,
          commandSets: 0,
          particleSystems: 0,
          fxLists: 0,
          staticGameLODs: 0,
          dynamicGameLODs: 0,
          unresolvedInheritance: 0,
          totalBlocks: 5,
        },
        errors: [
          {
            type: 'duplicate',
            blockType: 'Weapon',
            name: 'Gun',
            detail: 'existing weapon kept',
          },
        ],
        ai: {
          attackUsesLineOfSight: false,
          skirmishBaseDefenseExtraDistance: 12.25,
          resourcesWealthy: 7000,
          resourcesPoor: 2000,
          guardInnerModifierAI: 1.1,
          guardOuterModifierAI: 1.333,
          guardInnerModifierHuman: 1.8,
          guardOuterModifierHuman: 2.2,
          guardChaseUnitFrames: 300,
          guardEnemyScanRateFrames: 15,
          guardEnemyReturnScanRateFrames: 30,
        },
        audioSettings: {
          sampleCount2D: 12,
          sampleCount3D: 36,
          streamCount: 4,
          minSampleVolume: 0.1,
          globalMinRange: 40,
          globalMaxRange: 320,
          relative2DVolume: -0.2,
          defaultSoundVolume: 0.8,
          default3DSoundVolume: 0.7,
          defaultSpeechVolume: 0.6,
          defaultMusicVolume: 0.5,
        },
        unsupportedBlockTypes: ['CommandButton'],
        specialPowers: [
          {
            name: 'SP_A',
            fields: { Type: 'Instant', SpecialPowerTemplate: 'OCL_01' },
            blocks: [{ type: 'ModuleTag', name: 'Power', fields: {}, blocks: [] }],
          },
        ],
        objectCreationLists: [
          {
            name: 'OCL_A',
            fields: { CreateAtEdge: 'No' },
            blocks: [{ type: 'Create', name: 'Create1', fields: {}, blocks: [] }],
          },
        ],
      };

      registry.loadBundle(bundle);

      expect(registry.objects.get('TankA')?.side).toBe('America');
      expect(registry.weapons.get('Gun')?.fields['Damage']).toBe(50);
      expect(registry.getAiConfig()).toMatchObject({
        attackUsesLineOfSight: false,
        skirmishBaseDefenseExtraDistance: 12.25,
        resourcesWealthy: 7000,
        resourcesPoor: 2000,
        guardInnerModifierAI: 1.1,
        guardOuterModifierAI: 1.333,
        guardInnerModifierHuman: 1.8,
        guardOuterModifierHuman: 2.2,
        guardChaseUnitFrames: 300,
        guardEnemyScanRateFrames: 15,
        guardEnemyReturnScanRateFrames: 30,
      });
      expect(registry.getAudioSettings()).toEqual({
        sampleCount2D: 12,
        sampleCount3D: 36,
        streamCount: 4,
        minSampleVolume: 0.1,
        globalMinRange: 40,
        globalMaxRange: 320,
        relative2DVolume: -0.2,
        defaultSoundVolume: 0.8,
        default3DSoundVolume: 0.7,
        defaultSpeechVolume: 0.6,
        defaultMusicVolume: 0.5,
      });
      expect(registry.getMiscAudio()).toBeUndefined();
      expect(registry.getUnsupportedBlockTypes()).toEqual(['CommandButton']);
      expect(registry.errors).toHaveLength(1);
      expect(registry.errors[0]!.type).toBe('duplicate');
      expect(registry.getSpecialPower('SP_A')?.fields).toMatchObject({ Type: 'Instant' });
      expect(registry.getObjectCreationList('OCL_A')?.fields).toMatchObject({ CreateAtEdge: 'No' });
    });

    it('normalizes legacy CommandSet bundles that do not include slot metadata', () => {
      registry.loadBundle({
        objects: [],
        weapons: [],
        armors: [],
        upgrades: [],
        sciences: [],
        factions: [],
        commandButtons: [],
        commandSets: [
          {
            name: 'LegacySet',
            fields: {},
            buttons: ['BtnOne', 'BtnTwo'],
          },
        ],
        stats: {
          objects: 0,
          weapons: 0,
          armors: 0,
          upgrades: 0,
          sciences: 0,
          factions: 0,
          audioEvents: 0,
          commandButtons: 0,
          commandSets: 1,
          particleSystems: 0,
          fxLists: 0,
          staticGameLODs: 0,
          dynamicGameLODs: 0,
          unresolvedInheritance: 0,
          totalBlocks: 0,
        },
        errors: [],
        unsupportedBlockTypes: [],
      });

      expect(registry.commandSets.get('LegacySet')?.slottedButtons).toEqual([
        { slot: 1, commandButtonName: 'BtnOne' },
        { slot: 2, commandButtonName: 'BtnTwo' },
      ]);
    });
  });

  describe('MiscAudio merging', () => {
    it('merges repeated MiscAudio blocks with later overrides', () => {
      registry.loadBlocks([
        makeBlock('MiscAudio', '', {
          GUIClickSound: 'Click_A',
          NoCanDoSound: 'NoCanDo_A',
        }),
      ]);
      registry.loadBlocks([
        makeBlock('MiscAudio', '', {
          GUIClickSound: 'Click_B',
        }),
      ]);

      expect(registry.getMiscAudio()?.guiClickSoundName).toBe('Click_B');
      expect(registry.getMiscAudio()?.noCanDoSoundName).toBe('NoCanDo_A');
    });
  });

  describe('multiple loadBlocks calls', () => {
    it('accumulates across multiple loads', () => {
      registry.loadBlocks([makeBlock('Object', 'A', {})]);
      registry.loadBlocks([makeBlock('Object', 'B', {})]);
      registry.loadBlocks([makeBlock('Weapon', 'Gun', {})]);

      expect(registry.objects.size).toBe(2);
      expect(registry.weapons.size).toBe(1);
    });
  });

  describe('ParticleSystem and FXList indexing', () => {
    it('indexes ParticleSystem blocks by name', () => {
      registry.loadBlocks([
        makeBlock('ParticleSystem', 'SmokePuff', {
          Priority: 'WEAPON_EXPLOSION',
          IsOneShot: 'Yes',
          Lifetime: '30',
          Size: '5 10',
        }),
        makeBlock('ParticleSystem', 'MuzzleFlash', {
          Priority: 'WEAPON_TRAIL',
          IsOneShot: 'Yes',
        }),
      ]);

      expect(registry.particleSystems.size).toBe(2);
      expect(registry.getParticleSystem('SmokePuff')?.fields['Priority']).toBe('WEAPON_EXPLOSION');
      expect(registry.getParticleSystem('MuzzleFlash')?.fields['IsOneShot']).toBe('Yes');
      expect(registry.getUnsupportedBlockTypes()).toEqual([]);
    });

    it('indexes FXList blocks by name', () => {
      registry.loadBlocks([
        makeBlock('FXList', 'FX_TankExplosion', {}, {
          blocks: [
            makeBlock('ParticleSystem', 'SmokePuff', { Name: 'SmokePuff' }),
            makeBlock('Sound', 'ExplosionSound', { Name: 'Explosion_Large' }),
          ],
        }),
      ]);

      expect(registry.fxLists.size).toBe(1);
      const fx = registry.getFXList('FX_TankExplosion');
      expect(fx).toBeDefined();
      expect(fx?.blocks).toHaveLength(2);
    });

    it('includes ParticleSystem and FXList in stats', () => {
      registry.loadBlocks([
        makeBlock('ParticleSystem', 'PS1', {}),
        makeBlock('ParticleSystem', 'PS2', {}),
        makeBlock('FXList', 'FX1', {}),
      ]);

      const stats = registry.getStats();
      expect(stats.particleSystems).toBe(2);
      expect(stats.fxLists).toBe(1);
      expect(stats.totalBlocks).toBe(3);
    });
  });

  describe('StaticGameLOD and DynamicGameLOD indexing', () => {
    it('indexes StaticGameLOD blocks', () => {
      registry.loadBlocks([
        makeBlock('StaticGameLOD', 'Low', {
          MaxParticleCount: '500',
          UseShadowVolumes: 'No',
          TextureReductionFactor: '2',
        }),
        makeBlock('StaticGameLOD', 'Medium', {
          MaxParticleCount: '1500',
          UseShadowVolumes: 'Yes',
        }),
        makeBlock('StaticGameLOD', 'High', {
          MaxParticleCount: '3000',
          UseShadowVolumes: 'Yes',
        }),
      ]);

      expect(registry.staticGameLODs.size).toBe(3);
      expect(registry.getStaticGameLOD('Low')?.fields['MaxParticleCount']).toBe('500');
      expect(registry.getStaticGameLOD('High')?.fields['MaxParticleCount']).toBe('3000');
    });

    it('indexes DynamicGameLOD blocks', () => {
      registry.loadBlocks([
        makeBlock('DynamicGameLOD', 'Low', {
          MinimumFPS: '10',
          ParticleSkipMask: '3',
          DebrisSkipMask: '1',
          MinParticlePriority: 'AREA_EFFECT',
        }),
      ]);

      expect(registry.dynamicGameLODs.size).toBe(1);
      expect(registry.getDynamicGameLOD('Low')?.fields['MinimumFPS']).toBe('10');
    });

    it('includes LOD types in stats and totalBlocks', () => {
      registry.loadBlocks([
        makeBlock('StaticGameLOD', 'Low', {}),
        makeBlock('StaticGameLOD', 'High', {}),
        makeBlock('DynamicGameLOD', 'Low', {}),
      ]);

      const stats = registry.getStats();
      expect(stats.staticGameLODs).toBe(2);
      expect(stats.dynamicGameLODs).toBe(1);
      expect(stats.totalBlocks).toBe(3);
    });
  });

  describe('new block types round-trip through bundle', () => {
    it('round-trips ParticleSystem, FXList, StaticGameLOD, DynamicGameLOD through toBundle/loadBundle', () => {
      registry.loadBlocks([
        makeBlock('ParticleSystem', 'PS_Smoke', { Priority: 'MEDIUM_EMITTER', Lifetime: '45' }),
        makeBlock('FXList', 'FX_Hit', {}, {
          blocks: [makeBlock('ParticleSystem', 'PS_Spark', { Name: 'PS_Spark' })],
        }),
        makeBlock('StaticGameLOD', 'High', { MaxParticleCount: '3000' }),
        makeBlock('DynamicGameLOD', 'Medium', { MinimumFPS: '20', ParticleSkipMask: '1' }),
      ]);

      const bundle = registry.toBundle();

      expect(bundle.particleSystems).toHaveLength(1);
      expect(bundle.fxLists).toHaveLength(1);
      expect(bundle.staticGameLODs).toHaveLength(1);
      expect(bundle.dynamicGameLODs).toHaveLength(1);

      const restored = new IniDataRegistry();
      restored.loadBundle(bundle);

      expect(restored.getParticleSystem('PS_Smoke')?.fields['Priority']).toBe('MEDIUM_EMITTER');
      expect(restored.getFXList('FX_Hit')?.blocks).toHaveLength(1);
      expect(restored.getStaticGameLOD('High')?.fields['MaxParticleCount']).toBe('3000');
      expect(restored.getDynamicGameLOD('Medium')?.fields['MinimumFPS']).toBe('20');

      const stats = restored.getStats();
      expect(stats.particleSystems).toBe(1);
      expect(stats.fxLists).toBe(1);
      expect(stats.staticGameLODs).toBe(1);
      expect(stats.dynamicGameLODs).toBe(1);
    });

    it('round-trips SpecialPower and ObjectCreationList through toBundle/loadBundle', () => {
      // Source parity: SpecialPower and ObjectCreationList are defined
      // in SpecialPower.ini and are referenced by CommandButton entries.
      // The bundle must include them so the runtime can resolve
      // special-power-based command buttons.
      registry.loadBlocks([
        makeBlock('SpecialPower', 'SuperweaponDaisyCutter', {
          ReloadTime: '360000',
          PublicTimer: 'Yes',
          Type: 'SPECIAL_DAISY_CUTTER',
        }),
        makeBlock('ObjectCreationList', 'OCL_AmericaParadrop', {}, {
          blocks: [
            makeBlock('DeliverPayload', '', { Payload: 'AmericaInfantryRanger', FormationSize: '1 1' }),
          ],
        }),
      ]);

      const bundle = registry.toBundle();
      expect(bundle.specialPowers).toHaveLength(1);
      expect(bundle.specialPowers[0]!.name).toBe('SuperweaponDaisyCutter');
      expect(bundle.objectCreationLists).toHaveLength(1);

      const restored = new IniDataRegistry();
      restored.loadBundle(bundle);

      const sp = restored.getSpecialPower('SuperweaponDaisyCutter');
      expect(sp).toBeDefined();
      expect(sp!.fields['ReloadTime']).toBe('360000');
      expect(sp!.fields['Type']).toBe('SPECIAL_DAISY_CUTTER');

      const ocl = restored.getObjectCreationList('OCL_AmericaParadrop');
      expect(ocl).toBeDefined();
      expect(ocl!.blocks).toHaveLength(1);
    });
  });

  describe('remaining raw blocker block families', () => {
    it('indexes source-faithful raw blocks and keeps them supported', () => {
      registry.loadBlocks([
        makeBlock('CommandMap', 'MOVE', {
          Key: 'M',
          Transition: 'DOWN',
          UseableIn: 'COMMANDUSABLE_INGAME',
        }),
        makeBlock('Credits', '', {
          ScrollRate: 2,
          Text: ['CREDIT:ONE', 'CREDIT:TWO'],
        }),
        makeBlock('Mouse', '', {
          TooltipFontName: 'Arial',
          TooltipWidth: 0.6,
        }),
        makeBlock('MouseCursor', 'Move', {
          Image: 'SCMove',
          HotSpot: [5, 6],
        }),
        makeBlock('MultiplayerColor', 'PlayerColor01', {
          TooltipName: 'CONTROLBAR:ColorRed',
          RGBColor: [255, 0, 0],
        }),
        makeBlock('MultiplayerStartingMoneyChoice', '', {
          Value: 10000,
          Default: true,
        }),
        makeBlock('OnlineChatColors', '', {
          ChatNormal: [255, 255, 255],
          MOTDHeading: [255, 255, 0],
        }),
        makeBlock('WaterTransparency', '', {
          TransparentWaterDepth: 2.5,
          SkyboxTextureN: 'Sky_N',
        }),
        makeBlock('ChallengeGenerals', '', {}, {
          blocks: [
            makeBlock('GeneralPersona0', '', {
              StartsEnabled: true,
              BioNameString: 'NAME:General0',
              PlayerTemplate: 'FactionAmerica',
            }),
          ],
        }),
      ]);

      expect(registry.getCommandMap('MOVE')?.fields['Key']).toBe('M');
      expect(registry.getCreditsBlocks()).toHaveLength(1);
      expect(registry.getCreditsBlocks()[0]?.fields['Text']).toEqual(['CREDIT:ONE', 'CREDIT:TWO']);
      expect(registry.getMouseBlocks()[0]?.fields['TooltipFontName']).toBe('Arial');
      expect(registry.getMouseCursor('Move')?.fields['HotSpot']).toEqual([5, 6]);
      expect(registry.getMultiplayerColor('PlayerColor01')?.fields['RGBColor']).toEqual([255, 0, 0]);
      expect(registry.getMultiplayerStartingMoneyChoices()[0]?.fields['Value']).toBe(10000);
      expect(registry.getOnlineChatColorBlocks()[0]?.fields['MOTDHeading']).toEqual([255, 255, 0]);
      expect(registry.getWaterTransparencyBlocks()[0]?.fields['TransparentWaterDepth']).toBe(2.5);
      expect(registry.getChallengeGeneralsBlocks()[0]?.blocks[0]?.type).toBe('GeneralPersona0');
      expect(registry.getUnsupportedBlockTypes()).toEqual([]);

      const stats = registry.getStats();
      expect(stats.totalBlocks).toBe(9);
    });

    it('round-trips remaining raw blocker block families through toBundle/loadBundle', () => {
      registry.loadBlocks([
        makeBlock('CommandMap', 'SELL', { Key: 'Backspace' }),
        makeBlock('Credits', '', { ScrollDown: false }),
        makeBlock('Mouse', '', { TooltipDelayTime: 250 }),
        makeBlock('MouseCursor', 'Attack', { Image: 'SCAttack' }),
        makeBlock('MultiplayerColor', 'PlayerColor02', { TooltipName: 'CONTROLBAR:ColorBlue' }),
        makeBlock('MultiplayerStartingMoneyChoice', '', { Value: 5000 }),
        makeBlock('OnlineChatColors', '', { ChatOwner: [255, 255, 0] }),
        makeBlock('WaterTransparency', '', { AdditiveBlending: true }),
        makeBlock('ChallengeGenerals', '', {}, {
          blocks: [
            makeBlock('GeneralPersona1', '', { BioNameString: 'NAME:General1' }),
          ],
        }),
      ]);

      const bundle = registry.toBundle();

      expect(bundle.commandMaps).toHaveLength(1);
      expect(bundle.creditsBlocks).toHaveLength(1);
      expect(bundle.mouseBlocks).toHaveLength(1);
      expect(bundle.mouseCursors).toHaveLength(1);
      expect(bundle.multiplayerColors).toHaveLength(1);
      expect(bundle.multiplayerStartingMoneyChoices).toHaveLength(1);
      expect(bundle.onlineChatColorBlocks).toHaveLength(1);
      expect(bundle.waterTransparencyBlocks).toHaveLength(1);
      expect(bundle.challengeGeneralsBlocks).toHaveLength(1);

      const restored = new IniDataRegistry();
      restored.loadBundle(bundle);

      expect(restored.getCommandMap('SELL')?.fields['Key']).toBe('Backspace');
      expect(restored.getCreditsBlocks()[0]?.fields['ScrollDown']).toBe(false);
      expect(restored.getMouseBlocks()[0]?.fields['TooltipDelayTime']).toBe(250);
      expect(restored.getMouseCursor('Attack')?.fields['Image']).toBe('SCAttack');
      expect(restored.getMultiplayerColor('PlayerColor02')?.fields['TooltipName']).toBe('CONTROLBAR:ColorBlue');
      expect(restored.getMultiplayerStartingMoneyChoices()[0]?.fields['Value']).toBe(5000);
      expect(restored.getOnlineChatColorBlocks()[0]?.fields['ChatOwner']).toEqual([255, 255, 0]);
      expect(restored.getWaterTransparencyBlocks()[0]?.fields['AdditiveBlending']).toBe(true);
      expect(restored.getChallengeGeneralsBlocks()[0]?.blocks[0]?.type).toBe('GeneralPersona1');
      expect(restored.getStats().totalBlocks).toBe(9);
    });
  });
});
