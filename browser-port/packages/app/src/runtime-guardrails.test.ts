import { describe, expect, it } from 'vitest';

import type { CommandButtonDef, CommandSetDef, IniDataBundle, ObjectDef, RegistryError } from '@generals/ini-data';

import { assertIniBundleConsistency, assertRequiredManifestEntries } from './runtime-guardrails.js';

function makeObject(name: string, commandSetName?: string): ObjectDef {
  return {
    name,
    fields: commandSetName ? { CommandSet: commandSetName } : {},
    blocks: [],
    resolved: true,
  };
}

function makeCommandButton(name: string, fields: Record<string, unknown> = { Command: 'STOP' }): CommandButtonDef {
  return {
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks: [],
    options: [],
  };
}

function makeCommandSet(name: string, buttonName: string): CommandSetDef {
  return {
    name,
    fields: { 1: buttonName },
    buttons: [buttonName],
    slottedButtons: [{ slot: 1, commandButtonName: buttonName }],
  };
}

function makeBundle(params: {
  objects?: ObjectDef[];
  commandButtons?: CommandButtonDef[];
  commandSets?: CommandSetDef[];
  errors?: RegistryError[];
} = {}): IniDataBundle {
  const objects = params.objects ?? [];
  const commandButtons = params.commandButtons ?? [];
  const commandSets = params.commandSets ?? [];
  const errors = params.errors ?? [];

  return {
    objects,
    weapons: [],
    armors: [],
    upgrades: [],
    sciences: [],
    factions: [],
    specialPowers: [],
    objectCreationLists: [],
    locomotors: [],
    audioEvents: [],
    commandButtons,
    commandSets,
    stats: {
      objects: objects.length,
      weapons: 0,
      armors: 0,
      upgrades: 0,
      sciences: 0,
      factions: 0,
      audioEvents: 0,
      commandButtons: commandButtons.length,
      commandSets: commandSets.length,
      unresolvedInheritance: errors.filter((error) => error.type === 'unresolved_parent').length,
      totalBlocks: objects.length + commandButtons.length + commandSets.length,
    },
    errors,
    unsupportedBlockTypes: [],
  };
}

describe('runtime guardrails', () => {
  it('fails when required manifest entries are missing', () => {
    const manifest = {
      hasOutputPath: (outputPath: string) => outputPath === 'data/ini-bundle.json',
    };

    expect(() => assertRequiredManifestEntries(null, ['data/ini-bundle.json'])).toThrow(
      'Required runtime manifest is unavailable',
    );
    expect(() => assertRequiredManifestEntries(manifest, ['data/ini-bundle.json'])).not.toThrow();
    expect(() => assertRequiredManifestEntries(manifest, ['maps/SmokeTest.json'])).toThrow(
      'missing required assets',
    );
  });

  it('fails when bundle stats drift from payload arrays', () => {
    const bundle = makeBundle({
      objects: [makeObject('RuntimeTank')],
    });
    bundle.stats.objects = 99;

    expect(() => assertIniBundleConsistency(bundle)).toThrow('stats mismatch');
  });

  it('fails when unresolved inheritance errors are present', () => {
    const bundle = makeBundle({
      errors: [{
        type: 'unresolved_parent',
        blockType: 'Object',
        name: 'RuntimeTank',
        detail: 'Parent "MissingParent" not found',
      }],
    });

    expect(() => assertIniBundleConsistency(bundle)).toThrow('unresolved inheritance');
  });

  it('fails when object command sets are missing', () => {
    const bundle = makeBundle({
      objects: [makeObject('RuntimeTank', 'MissingCommandSet')],
      commandButtons: [makeCommandButton('Command_BuildRuntimeTank', { Command: 'UNIT_BUILD', Object: 'RuntimeTank' })],
      commandSets: [makeCommandSet('CommandSet_Valid', 'Command_BuildRuntimeTank')],
    });

    expect(() => assertIniBundleConsistency(bundle)).toThrow('missing CommandSet references');
  });

  it('fails when command sets reference missing command buttons', () => {
    const bundle = makeBundle({
      objects: [makeObject('RuntimeFactory', 'CommandSet_RuntimeFactory')],
      commandButtons: [],
      commandSets: [makeCommandSet('CommandSet_RuntimeFactory', 'Command_BuildRuntimeTank')],
    });

    expect(() => assertIniBundleConsistency(bundle)).toThrow('missing CommandButton references');
  });

  it('warns when command buttons miss required payload fields', () => {
    const bundle = makeBundle({
      objects: [makeObject('RuntimeFactory', 'CommandSet_RuntimeFactory')],
      commandButtons: [makeCommandButton('Command_BuildRuntimeTank', { Command: 'UNIT_BUILD' })],
      commandSets: [makeCommandSet('CommandSet_RuntimeFactory', 'Command_BuildRuntimeTank')],
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertIniBundleConsistency(bundle)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CommandButton warnings'));
    warnSpy.mockRestore();
  });

  it('accepts a consistent bundle', () => {
    const bundle = makeBundle({
      objects: [makeObject('RuntimeFactory', 'CommandSet_RuntimeFactory')],
      commandButtons: [makeCommandButton('Command_BuildRuntimeTank', {
        Command: 'UNIT_BUILD',
        Object: 'RuntimeFactory',
      })],
      commandSets: [makeCommandSet('CommandSet_RuntimeFactory', 'Command_BuildRuntimeTank')],
    });

    expect(() => assertIniBundleConsistency(bundle)).not.toThrow();
  });
});
