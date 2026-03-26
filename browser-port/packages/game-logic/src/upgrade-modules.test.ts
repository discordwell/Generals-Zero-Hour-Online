/**
 * Tests for ZH-specific module field extraction:
 * - FireWeaponPower (MaxShotsToFire) — via SpecialPowerModuleProfile
 * - GrantScienceUpgrade (GrantScience) — via ParsedUpgradeModuleProfile
 * - ReplaceObjectUpgrade (ReplaceObject) — via ParsedUpgradeModuleProfile
 * - ModelConditionUpgrade (ConditionFlag) — via ParsedUpgradeModuleProfile
 *
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/SpecialPower/FireWeaponPower.cpp
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Upgrade/GrantScienceUpgrade.cpp
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Upgrade/ReplaceObjectUpgrade.cpp
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Upgrade/ModelConditionUpgrade.cpp
 */
import { describe, expect, it } from 'vitest';
import type { IniBlock, IniValue } from '@generals/core';

import {
  extractUpgradeModulesFromBlocks,
  type UpgradeModuleParsingHelpers,
} from './upgrade-modules.js';
import { extractSpecialPowerModules } from './entity-factory.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBlock(
  type: string,
  name: string,
  fields: Record<string, unknown>,
  blocks: IniBlock[] = [],
): IniBlock {
  return {
    type,
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
  };
}

/** Minimal helpers that match the UpgradeModuleParsingHelpers interface. */
const helpers: UpgradeModuleParsingHelpers = {
  parseUpgradeNames(value: IniValue | undefined): string[] {
    if (value === undefined) return [];
    return String(value).split(/\s+/).filter(Boolean).map((s) => s.toUpperCase());
  },
  parseObjectStatusNames(value: IniValue | undefined): string[] {
    if (value === undefined) return [];
    return String(value).split(/\s+/).filter(Boolean).map((s) => s.toUpperCase());
  },
  parseKindOf(value: IniValue | undefined): string[] {
    if (value === undefined) return [];
    return String(value).split(/\s+/).filter(Boolean).map((s) => s.toUpperCase());
  },
  parsePercent(value: IniValue | undefined): number | null {
    if (value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
};

// ── GrantScienceUpgrade ────────────────────────────────────────────────────

describe('GrantScienceUpgrade', () => {
  it('extracts GrantScience field from GrantScienceUpgrade behavior block', () => {
    const blocks = [
      makeBlock('Behavior', 'GrantScienceUpgrade ModuleTag_GSU', {
        TriggeredBy: 'Upgrade_GLAWorkerShoes',
        GrantScience: 'SCIENCE_Frenzy',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].moduleType).toBe('GRANTSCIENCEUPGRADE');
    expect(modules[0].grantScienceName).toBe('SCIENCE_FRENZY');
    expect(modules[0].triggeredBy).toContain('UPGRADE_GLAWORKERSHOES');
  });

  it('defaults GrantScience to empty string when field is absent', () => {
    const blocks = [
      makeBlock('Behavior', 'GrantScienceUpgrade ModuleTag_GSU', {
        TriggeredBy: 'Upgrade_SomeUpgrade',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].grantScienceName).toBe('');
  });

  it('does not populate GrantScience for non-GrantScienceUpgrade modules', () => {
    const blocks = [
      makeBlock('Behavior', 'ArmorUpgrade ModuleTag_AU', {
        TriggeredBy: 'Upgrade_SomeUpgrade',
        GrantScience: 'SCIENCE_Frenzy',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].moduleType).toBe('ARMORUPGRADE');
    expect(modules[0].grantScienceName).toBe('');
  });
});

// ── ReplaceObjectUpgrade ───────────────────────────────────────────────────

describe('ReplaceObjectUpgrade', () => {
  it('extracts ReplaceObject field from ReplaceObjectUpgrade behavior block', () => {
    const blocks = [
      makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
        TriggeredBy: 'Upgrade_ChinaTankHunter',
        ReplaceObject: 'ChinaTankHunterUpgraded',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].moduleType).toBe('REPLACEOBJECTUPGRADE');
    expect(modules[0].replaceObjectName).toBe('ChinaTankHunterUpgraded');
  });

  it('defaults ReplaceObject to empty string when field is absent', () => {
    const blocks = [
      makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
        TriggeredBy: 'Upgrade_SomeUpgrade',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].replaceObjectName).toBe('');
  });

  it('preserves case in ReplaceObject template name (template names are case-sensitive)', () => {
    const blocks = [
      makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU', {
        TriggeredBy: 'Upgrade_Test',
        ReplaceObject: 'AmericaVehiclePaladin',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules[0].replaceObjectName).toBe('AmericaVehiclePaladin');
  });
});

// ── ModelConditionUpgrade ──────────────────────────────────────────────────

describe('ModelConditionUpgrade', () => {
  it('extracts ConditionFlag field from ModelConditionUpgrade behavior block', () => {
    const blocks = [
      makeBlock('Behavior', 'ModelConditionUpgrade ModuleTag_MCU', {
        TriggeredBy: 'Upgrade_ChinaNuclearTanks',
        ConditionFlag: 'UPGRADED',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].moduleType).toBe('MODELCONDITIONUPGRADE');
    expect(modules[0].conditionFlag).toBe('UPGRADED');
  });

  it('defaults ConditionFlag to empty string when field is absent', () => {
    const blocks = [
      makeBlock('Behavior', 'ModelConditionUpgrade ModuleTag_MCU', {
        TriggeredBy: 'Upgrade_SomeUpgrade',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].conditionFlag).toBe('');
  });

  it('uppercases ConditionFlag value', () => {
    const blocks = [
      makeBlock('Behavior', 'ModelConditionUpgrade ModuleTag_MCU', {
        TriggeredBy: 'Upgrade_SomeUpgrade',
        ConditionFlag: 'user_1',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules[0].conditionFlag).toBe('USER_1');
  });
});

// ── FireWeaponPower (special power module extraction) ──────────────────────

describe('FireWeaponPower MaxShotsToFire field', () => {
  // FireWeaponPower is a SpecialPowerModule, not an UpgradeModule, so it is
  // extracted via extractSpecialPowerModules (entity-factory.ts), not
  // extractUpgradeModulesFromBlocks.

  it('FireWeaponPower is not extracted as an upgrade module', () => {
    const blocks = [
      makeBlock('Behavior', 'FireWeaponPower ModuleTag_FWP', {
        SpecialPowerTemplate: 'SuperweaponNeutronMissile',
        MaxShotsToFire: 1,
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(0);
  });

  it('extracts MaxShotsToFire from FireWeaponPower behavior block via extractSpecialPowerModules', () => {
    const objectDef = {
      name: 'TestUnit',
      side: 'America',
      kindOf: ['VEHICLE'],
      fields: {} as Record<string, string | number | boolean | string[] | number[]>,
      blocks: [
        makeBlock('Behavior', 'FireWeaponPower ModuleTag_FWP', {
          SpecialPowerTemplate: 'SuperweaponNeutronMissile',
          MaxShotsToFire: 3,
        }),
      ],
      resolved: true,
    };
    // extractSpecialPowerModules takes a GL self (unused for field reading) and an ObjectDef.
    const result = extractSpecialPowerModules(null as any, objectDef as any);
    expect(result.size).toBe(1);
    const module = result.get('SUPERWEAPONNEUTRONMISSILE');
    expect(module).toBeDefined();
    expect(module!.fireWeaponMaxShots).toBe(3);
    expect(module!.moduleType).toBe('FIREWEAPONPOWER');
  });

  it('defaults MaxShotsToFire to 1 when field is absent', () => {
    const objectDef = {
      name: 'TestUnit',
      side: 'America',
      kindOf: ['VEHICLE'],
      fields: {} as Record<string, string | number | boolean | string[] | number[]>,
      blocks: [
        makeBlock('Behavior', 'FireWeaponPower ModuleTag_FWP', {
          SpecialPowerTemplate: 'SuperweaponNeutronMissile',
        }),
      ],
      resolved: true,
    };
    const result = extractSpecialPowerModules(null as any, objectDef as any);
    const module = result.get('SUPERWEAPONNEUTRONMISSILE');
    expect(module).toBeDefined();
    expect(module!.fireWeaponMaxShots).toBe(1);
  });
});

// ── Common upgrade fields shared across all module types ───────────────────

describe('common upgrade module fields', () => {
  it('extracts TriggeredBy, ConflictsWith, RemovesUpgrades for GrantScienceUpgrade', () => {
    const blocks = [
      makeBlock('Behavior', 'GrantScienceUpgrade ModuleTag_GSU', {
        TriggeredBy: 'Upgrade_A Upgrade_B',
        ConflictsWith: 'Upgrade_C',
        RemovesUpgrades: 'Upgrade_D',
        RequiresAllTriggers: 'Yes',
        GrantScience: 'SCIENCE_Test',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].triggeredBy).toEqual(new Set(['UPGRADE_A', 'UPGRADE_B']));
    expect(modules[0].conflictsWith).toEqual(new Set(['UPGRADE_C']));
    expect(modules[0].removesUpgrades).toEqual(new Set(['UPGRADE_D']));
    expect(modules[0].requiresAllTriggers).toBe(true);
  });

  it('passes sourceUpgradeName through to module id', () => {
    const blocks = [
      makeBlock('Behavior', 'ModelConditionUpgrade ModuleTag_MCU', {
        TriggeredBy: 'Upgrade_Test',
        ConditionFlag: 'UPGRADED',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, 'UPGRADE_PARENT', helpers);
    expect(modules).toHaveLength(1);
    expect(modules[0].sourceUpgradeName).toBe('UPGRADE_PARENT');
    expect(modules[0].id).toContain('UPGRADE_PARENT');
  });

  it('extracts multiple upgrade modules from nested blocks', () => {
    const blocks = [
      makeBlock('Behavior', 'GrantScienceUpgrade ModuleTag_GSU1', {
        TriggeredBy: 'Upgrade_A',
        GrantScience: 'SCIENCE_Alpha',
      }),
      makeBlock('Behavior', 'ReplaceObjectUpgrade ModuleTag_ROU1', {
        TriggeredBy: 'Upgrade_B',
        ReplaceObject: 'ReplacementThing',
      }),
      makeBlock('Behavior', 'ModelConditionUpgrade ModuleTag_MCU1', {
        TriggeredBy: 'Upgrade_C',
        ConditionFlag: 'USER_2',
      }),
    ];
    const modules = extractUpgradeModulesFromBlocks(blocks, null, helpers);
    expect(modules).toHaveLength(3);
    expect(modules[0].moduleType).toBe('GRANTSCIENCEUPGRADE');
    expect(modules[0].grantScienceName).toBe('SCIENCE_ALPHA');
    expect(modules[1].moduleType).toBe('REPLACEOBJECTUPGRADE');
    expect(modules[1].replaceObjectName).toBe('ReplacementThing');
    expect(modules[2].moduleType).toBe('MODELCONDITIONUPGRADE');
    expect(modules[2].conditionFlag).toBe('USER_2');
  });
});
