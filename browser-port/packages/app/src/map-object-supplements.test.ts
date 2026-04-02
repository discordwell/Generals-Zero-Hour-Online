import { describe, expect, it } from 'vitest';

import { collectSourceMapObjectSupplements } from './map-object-supplements.js';

describe('collectSourceMapObjectSupplements', () => {
  it('includes the current source-backed campaign alias and prop mappings', () => {
    expect(collectSourceMapObjectSupplements()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateName: 'Fountain01',
          objectDefName: 'Fountain1',
        }),
        expect.objectContaining({
          templateName: 'Fountain02',
          objectDefName: 'Fountain2',
        }),
        expect.objectContaining({
          templateName: 'Fountain04',
          modelName: 'PMFountain4',
        }),
        expect.objectContaining({
          templateName: 'GC_Demo_GLAVehicleCombatBike',
          objectDefName: 'Demo_GLAVehicleCombatBike',
        }),
        expect.objectContaining({
          templateName: 'AmericaDetentionCamp',
          modelName: 'ABDetCamp',
        }),
        expect.objectContaining({
          templateName: 'Frosty',
          modelName: 'PMSnowman',
        }),
      ]),
    );
  });
});
