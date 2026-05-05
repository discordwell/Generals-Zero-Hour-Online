/**
 * Regression tests for extractIniValueTokens.
 *
 * The retail INI bundle emits multi-token field values as flat arrays of
 * strings (one token per element), e.g.:
 *   VeterancyFireFX = HEROIC WeaponFX_GenericMachineGunFireWithRedTracers
 *   →  ['HEROIC', 'WeaponFX_GenericMachineGunFireWithRedTracers']
 *
 * Consumers iterate the function's output expecting each entry to be a
 * complete tokens-of-one-line array. The function MUST treat a flat
 * primitive array as a single entry (one entry, multiple tokens), not
 * as N entries of one token each.
 *
 * Multi-line fields appear in the bundle as either:
 *   (a) multi-token strings inside an array — each string is its own entry
 *   (b) 2D arrays — each inner array is its own entry
 *
 * The function must distinguish these from the flat-primitive case.
 */

import { describe, expect, it } from 'vitest';

import { extractIniValueTokens } from './entity-factory.js';

// We only need a stub `self`; the function never calls into it for these
// shape-handling code paths.
const stubSelf = {} as unknown as Parameters<typeof extractIniValueTokens>[0];

describe('extractIniValueTokens shape semantics', () => {
  it('returns one entry whose tokens are the array elements for a flat primitive array', () => {
    // Retail bundle shape: VeterancyFireFX = ['HEROIC', 'WeaponFX_X']
    const result = extractIniValueTokens(stubSelf, ['HEROIC', 'WeaponFX_X']);
    expect(result).toEqual([['HEROIC', 'WeaponFX_X']]);
  });

  it('handles a 3-element flat primitive array as one entry', () => {
    // Retail bundle shape: WeaponBonus = ['PLAYER_UPGRADE', 'DAMAGE', '125%']
    const result = extractIniValueTokens(stubSelf, ['PLAYER_UPGRADE', 'DAMAGE', '125%']);
    expect(result).toEqual([['PLAYER_UPGRADE', 'DAMAGE', '125%']]);
  });

  it('returns one entry with split tokens for a single multi-token string', () => {
    const result = extractIniValueTokens(stubSelf, 'VETERAN OCL_VeteranEffect');
    expect(result).toEqual([['VETERAN', 'OCL_VeteranEffect']]);
  });

  it('returns N entries for a flat array where each element is itself a multi-token string', () => {
    // Test fixture shape: VeterancyFireOCL = ['VETERAN OCL_X', 'ELITE OCL_Y']
    const result = extractIniValueTokens(stubSelf, [
      'VETERAN OCL_VeteranEffect',
      'ELITE OCL_EliteEffect',
      'HEROIC OCL_HeroicEffect',
    ]);
    expect(result).toEqual([
      ['VETERAN', 'OCL_VeteranEffect'],
      ['ELITE', 'OCL_EliteEffect'],
      ['HEROIC', 'OCL_HeroicEffect'],
    ]);
  });

  it('returns N entries for a 2D array (recursive multi-line shape)', () => {
    const result = extractIniValueTokens(stubSelf, [
      ['VETERAN', 'OCL_VeteranEffect'],
      ['ELITE', 'OCL_EliteEffect'],
    ]);
    expect(result).toEqual([
      ['VETERAN', 'OCL_VeteranEffect'],
      ['ELITE', 'OCL_EliteEffect'],
    ]);
  });

  it('returns one entry for a single number value', () => {
    const result = extractIniValueTokens(stubSelf, 42 as never);
    expect(result).toEqual([['42']]);
  });

  it('returns empty for null / undefined', () => {
    expect(extractIniValueTokens(stubSelf, undefined)).toEqual([]);
    expect(extractIniValueTokens(stubSelf, null as never)).toEqual([]);
  });

  it('drops empty strings in flat arrays', () => {
    const result = extractIniValueTokens(stubSelf, ['HEROIC', '', 'WeaponFX_X']);
    expect(result).toEqual([['HEROIC', 'WeaponFX_X']]);
  });

  it('returns empty for an array of all empty strings', () => {
    const result = extractIniValueTokens(stubSelf, ['', '   ']);
    expect(result).toEqual([]);
  });
});
