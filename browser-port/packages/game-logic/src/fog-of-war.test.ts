import { describe, expect, it } from 'vitest';

import { FogOfWarGrid } from './fog-of-war.js';

describe('FogOfWarGrid source partition sizing', () => {
  it('matches Zero Hour PartitionManager float inverse ceil for exact-looking boundaries', () => {
    const grid = new FogOfWarGrid(2520, 2530, 40);

    expect(grid.cellsWide).toBe(64);
    expect(grid.cellsDeep).toBe(64);
    expect(grid.getTotalCellCount()).toBe(4096);
  });

  it('matches vanilla Generals direct ceil partition counts', () => {
    const grid = new FogOfWarGrid(2640, 2460, 40, 'generals-direct-ceil');

    expect(grid.cellsWide).toBe(66);
    expect(grid.cellsDeep).toBe(62);
    expect(grid.getTotalCellCount()).toBe(4092);
  });
});
