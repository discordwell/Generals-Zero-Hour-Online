import { describe, expect, it } from 'vitest';

import { countMarkers, shouldCountParityDebtFile } from './parity-debt-report.js';

describe('parity debt report', () => {
  it('counts TODO and FIXME markers', () => {
    const markers = countMarkers(`
// TODO: close source gap
const x = 1; // FIXME align with source
`);

    expect(markers).toEqual({
      todoMarkers: 2,
      subsetMarkers: 0,
    });
  });

  it('counts source parity subset markers separately', () => {
    const markers = countMarkers(`
// Source parity subset: retail-only branch is still missing.
`);

    expect(markers).toEqual({
      todoMarkers: 0,
      subsetMarkers: 1,
    });
  });

  it('does not treat literal data tokens like B:XXX as debt markers', () => {
    const markers = countMarkers(`
// Frame is the last token after B:XXX
`);

    expect(markers).toEqual({
      todoMarkers: 0,
      subsetMarkers: 0,
    });
  });

  it('excludes test files from debt scanning', () => {
    expect(shouldCountParityDebtFile('/tmp/foo.ts')).toBe(true);
    expect(shouldCountParityDebtFile('/tmp/foo.test.ts')).toBe(false);
    expect(shouldCountParityDebtFile('/tmp/foo.spec.ts')).toBe(false);
  });
});
