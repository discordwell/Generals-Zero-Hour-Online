import { describe, expect, it } from 'vitest';
import { readCoord3DField, readNumericList } from './ini-readers.js';

describe('INI numeric readers', () => {
  it('parses source-style Coord3D key/value tokens from one string', () => {
    expect(readCoord3DField({ DropOffset: 'X:0 Y:0 Z:-10' }, ['DropOffset'])).toEqual({
      x: 0,
      y: 0,
      z: -10,
    });
  });

  it('parses retail flat arrays with split Coord3D labels and values', () => {
    expect(readCoord3DField({
      UnitCreatePoint: ['X:', '-10.0', 'Y:-30.0', 'Z:0.0'],
    }, ['UnitCreatePoint'])).toEqual({
      x: -10,
      y: -30,
      z: 0,
    });
  });

  it('keeps bare numeric arrays unchanged', () => {
    expect(readNumericList([12, 0, 5])).toEqual([12, 0, 5]);
  });
});
