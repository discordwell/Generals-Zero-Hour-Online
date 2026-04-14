import { describe, expect, it } from 'vitest';

import { FogOfWarGrid } from './fog-of-war.js';

describe('FogOfWarGrid source partition sizing', () => {
  it('matches PartitionManager float inverse ceil for exact-looking boundaries', () => {
    const grid = new FogOfWarGrid(2520, 2530, 40);

    expect(grid.cellsWide).toBe(64);
    expect(grid.cellsDeep).toBe(64);
    expect(grid.getTotalCellCount()).toBe(4096);
  });
});
