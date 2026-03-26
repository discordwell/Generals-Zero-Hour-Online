import { describe, expect, it } from 'vitest';

import type { ObjectDef } from '@generals/ini-data';

import { findObjectDefByName } from './registry-lookups.js';
import { makeBlock, makeBundle, makeRegistry } from './test-helpers.js';

describe('registry object lookup normalization', () => {
  it('promotes misplaced root fields from draw blocks for retail child objects', () => {
    const objectDef = {
      name: 'PromotedAircraft',
      resolved: true,
      fields: {
        ButtonImage: 'SAChinook',
      },
      blocks: [
        makeBlock('Draw', 'W3DModelDraw ModuleTag_02', {
          KindOf: ['SELECTABLE', 'VEHICLE', 'AIRCRAFT', 'TRANSPORT'],
          Side: 'America',
          Locomotor: ['SET_NORMAL', 'BasicHelicopterLocomotor'],
          VisionRange: 300,
        }),
      ],
    } as ObjectDef;

    const registry = makeRegistry(makeBundle({
      objects: [objectDef],
    }));

    const resolved = findObjectDefByName(registry, 'PromotedAircraft');
    expect(resolved).toBeDefined();
    expect(resolved!.kindOf).toContain('AIRCRAFT');
    expect(resolved!.side).toBe('America');
    expect(resolved!.fields.KindOf).toEqual(['SELECTABLE', 'VEHICLE', 'AIRCRAFT', 'TRANSPORT']);
    expect(resolved!.fields.Side).toBe('America');
    expect(resolved!.fields.Locomotor).toEqual(['SET_NORMAL', 'BasicHelicopterLocomotor']);
    expect(resolved!.fields.VisionRange).toBe(300);
  });
});
