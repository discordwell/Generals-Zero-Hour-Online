import { describe, expect, it } from 'vitest';

import type { IniValue } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';

import { areEquivalentTemplateNames } from './production-templates.js';

function extractIniValueTokens(value: IniValue | undefined): string[][] {
  if (typeof value === 'undefined') {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) =>
      entry
        .split(/[\s,;|]+/)
        .map((token) => token.trim())
        .filter(Boolean),
    );
}

function makeObjectDef(name: string, options: { parent?: string; fields?: Record<string, IniValue> } = {}): ObjectDef {
  return {
    name,
    parent: options.parent,
    fields: options.fields ?? {},
    blocks: [],
    resolved: true,
  };
}

function createObjectResolver(definitions: readonly ObjectDef[]): (name: string) => ObjectDef | undefined {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return (name: string): ObjectDef | undefined => {
    const direct = byName.get(name);
    if (direct) {
      return direct;
    }
    const normalizedName = name.trim().toUpperCase();
    for (const [definitionName, definition] of byName) {
      if (definitionName.trim().toUpperCase() === normalizedName) {
        return definition;
      }
    }
    return undefined;
  };
}

describe('production template equivalence', () => {
  it('treats parent/child template ancestry as equivalent', () => {
    const definitions = [
      makeObjectDef('BaseTank'),
      makeObjectDef('DesertTank', { parent: 'BaseTank' }),
    ];
    const findObjectDefByName = createObjectResolver(definitions);

    expect(
      areEquivalentTemplateNames('DesertTank', 'BaseTank', findObjectDefByName, extractIniValueTokens),
    ).toBe(true);
    expect(
      areEquivalentTemplateNames('basetank', 'DESERTTANK', findObjectDefByName, extractIniValueTokens),
    ).toBe(true);
  });

  it('treats ancestor BuildVariations links as equivalent', () => {
    const definitions = [
      makeObjectDef('BaseTank', { fields: { BuildVariations: ['TankVariant'] } }),
      makeObjectDef('BattleTank', { parent: 'BaseTank' }),
      makeObjectDef('TankVariant'),
    ];
    const findObjectDefByName = createObjectResolver(definitions);

    expect(
      areEquivalentTemplateNames('BattleTank', 'TankVariant', findObjectDefByName, extractIniValueTokens),
    ).toBe(true);
  });

  it('returns false for unrelated templates', () => {
    const definitions = [
      makeObjectDef('BaseTank'),
      makeObjectDef('Artillery'),
    ];
    const findObjectDefByName = createObjectResolver(definitions);

    expect(
      areEquivalentTemplateNames('BaseTank', 'Artillery', findObjectDefByName, extractIniValueTokens),
    ).toBe(false);
  });
});
