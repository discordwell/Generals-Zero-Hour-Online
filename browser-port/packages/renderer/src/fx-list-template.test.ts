import { describe, it, expect } from 'vitest';
import { parseFXListTemplate } from './fx-list-template.js';
import type { RawBlockDef } from '@generals/ini-data';
import type { IniBlock, IniValue } from '@generals/core';

function makeSubBlock(type: string, name: string, fields: Record<string, unknown> = {}): IniBlock {
  return { type, name, fields: fields as Record<string, IniValue>, blocks: [] };
}

function makeRawBlock(name: string, subBlocks: IniBlock[]): RawBlockDef {
  return { name, fields: {} as Record<string, IniValue>, blocks: subBlocks };
}

describe('parseFXListTemplate', () => {
  it('parses ParticleSystem nuggets', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Explode', [
      makeSubBlock('ParticleSystem', 'SmokePuff', { Name: 'SmokePuff', OrientToObject: 'Yes' }),
      makeSubBlock('ParticleSystem', 'Flame', { Name: 'FlameSystem' }),
    ]));

    expect(template.name).toBe('FX_Explode');
    expect(template.nuggets).toHaveLength(2);
    expect(template.nuggets[0]).toEqual({
      type: 'ParticleSystem',
      name: 'SmokePuff',
      orientToObject: true,
      offset: undefined,
    });
    expect(template.nuggets[1]).toEqual({
      type: 'ParticleSystem',
      name: 'FlameSystem',
      orientToObject: false,
      offset: undefined,
    });
  });

  it('parses ParticleSystem with offset', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Wave', [
      makeSubBlock('ParticleSystem', '', {
        Name: 'WaveSystem',
        Offset: 'X:0.0 Y:0.0 Z:-20.0',
        OrientToObject: 'Yes',
      }),
    ]));

    const nugget = template.nuggets[0]!;
    expect(nugget.type).toBe('ParticleSystem');
    if (nugget.type === 'ParticleSystem') {
      expect(nugget.offset).toEqual({ x: 0, y: 0, z: -20 });
    }
  });

  it('parses Sound nuggets', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Die', [
      makeSubBlock('Sound', 'DeathSound', { Name: 'UnitDeath01' }),
    ]));

    expect(template.nuggets).toHaveLength(1);
    expect(template.nuggets[0]).toEqual({
      type: 'Sound',
      name: 'UnitDeath01',
    });
  });

  it('parses ViewShake nuggets', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Boom', [
      makeSubBlock('ViewShake', '', { Type: 'SEVERE' }),
    ]));

    expect(template.nuggets[0]).toEqual({
      type: 'ViewShake',
      shakeType: 'SEVERE',
    });
  });

  it('parses LightPulse nuggets', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Flash', [
      makeSubBlock('LightPulse', '', {
        Color: 'R:255 G:128 B:51',
        Radius: '30',
        IncreaseTime: '0',
        DecreaseTime: '2333',
      }),
    ]));

    expect(template.nuggets[0]).toEqual({
      type: 'LightPulse',
      color: { r: 255, g: 128, b: 51 },
      radius: 30,
      increaseTime: 0,
      decreaseTime: 2333,
    });
  });

  it('parses TerrainScorch nuggets', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Scorch', [
      makeSubBlock('TerrainScorch', '', { Type: 'RANDOM', Radius: '15' }),
    ]));

    expect(template.nuggets[0]).toEqual({
      type: 'TerrainScorch',
      scorchType: 'RANDOM',
      radius: 15,
    });
  });

  it('parses a complex FXList with mixed nugget types', () => {
    const template = parseFXListTemplate(makeRawBlock('WeaponFX_BattleshipTargetExplode', [
      makeSubBlock('ViewShake', '', { Type: 'SUBTLE' }),
      makeSubBlock('TerrainScorch', '', { Type: 'RANDOM', Radius: '15' }),
      makeSubBlock('LightPulse', '', { Color: 'R:255 G:128 B:51', Radius: '30', IncreaseTime: '0', DecreaseTime: '2333' }),
      makeSubBlock('ParticleSystem', '', { Name: 'MortarDebris' }),
      makeSubBlock('ParticleSystem', '', { Name: 'MortarDust' }),
      makeSubBlock('Sound', '', { Name: 'ExplosionBattleshipTarget' }),
    ]));

    expect(template.nuggets).toHaveLength(6);
    expect(template.nuggets.map((n) => n.type)).toEqual([
      'ViewShake', 'TerrainScorch', 'LightPulse', 'ParticleSystem', 'ParticleSystem', 'Sound',
    ]);
  });

  it('returns empty nuggets for an empty FXList', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Empty', []));
    expect(template.nuggets).toHaveLength(0);
  });

  it('skips unknown nugget types gracefully', () => {
    const template = parseFXListTemplate(makeRawBlock('FX_Unknown', [
      makeSubBlock('UnknownNuggetType', '', {}),
      makeSubBlock('Sound', '', { Name: 'TestSound' }),
    ]));

    expect(template.nuggets).toHaveLength(1);
    expect(template.nuggets[0]!.type).toBe('Sound');
  });
});
