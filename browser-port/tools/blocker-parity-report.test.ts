import { describe, expect, it } from 'vitest';

import { buildBlockerParityReport } from './blocker-parity-report.js';

describe('blocker parity report', () => {
  it('returns clear status when all blocker inputs are clean', () => {
    const report = buildBlockerParityReport({
      conversionParity: {
        unsupportedBlockTypes: [],
        unresolvedRegistryErrors: [],
        missingReferences: [],
      },
      commandCoverage: {
        summary: {
          unsupportedBundleCommandTypes: 0,
          unknownBundleCommandTypes: 0,
        },
        bundleCommandTypeCoverage: [],
      },
      scriptCoverage: {
        summary: {
          missingActionTypesUsed: 0,
          missingConditionTypesUsed: 0,
          unknownActionTypeIdsUsed: 0,
          unknownConditionTypeIdsUsed: 0,
          knownActionTypeIdsMissingImplementation: 0,
          knownConditionTypeIdsMissingImplementation: 0,
        },
      },
      prerequisiteCoverage: {
        missingReferences: [],
        objectCycles: [],
        scienceCycles: [],
      },
      visualSceneParity: {
        summary: {
          blockedScenarios: 0,
        },
        scenarios: [],
      },
      uiLayoutParity: {
        summary: {
          blockedScenarios: 0,
        },
        scenarios: [],
      },
    });

    expect(report.status).toBe('clear');
    expect(report.summary.blockerGroups).toBe(0);
    expect(report.summary.blockerItems).toBe(0);
    expect(report.blockers).toEqual([]);
  });

  it('surfaces blocker findings from each report family', () => {
    const report = buildBlockerParityReport({
      conversionParity: {
        unsupportedBlockTypes: ['Thing'],
        unresolvedRegistryErrors: [{ type: 'unresolved_parent' }],
        missingReferences: [{ from: 'A', to: 'B' }],
      },
      commandCoverage: {
        summary: {
          unsupportedBundleCommandTypes: 1,
          unknownBundleCommandTypes: 1,
        },
        bundleCommandTypeCoverage: [
          { sourceCommandName: 'UNSUPPORTED_ONE', status: 'unsupported' },
          { sourceCommandName: 'UNKNOWN_TWO', status: 'unknown_command_name' },
        ],
      },
      scriptCoverage: {
        summary: {
          missingActionTypesUsed: 2,
          missingConditionTypesUsed: 1,
          unknownActionTypeIdsUsed: 0,
          unknownConditionTypeIdsUsed: 2,
          knownActionTypeIdsMissingImplementation: 3,
          knownConditionTypeIdsMissingImplementation: 0,
        },
      },
      prerequisiteCoverage: {
        missingReferences: [{ from: 'ObjA', to: 'ObjB' }],
        objectCycles: [['A', 'B', 'A']],
        scienceCycles: [['SCI_A', 'SCI_B', 'SCI_A']],
      },
      visualSceneParity: {
        summary: {
          blockedScenarios: 2,
        },
        scenarios: [
          {
            name: 'MD_USA01',
            status: 'blocked',
            blockingIssues: ['skybox missing'],
          },
          {
            name: 'Tournament Desert',
            status: 'blocked',
            blockingIssues: ['unresolved entities'],
          },
        ],
      },
      uiLayoutParity: {
        summary: {
          blockedScenarios: 1,
        },
        scenarios: [
          {
            name: 'Main Menu',
            status: 'blocked',
            blockingIssues: ['button order mismatch'],
          },
        ],
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.summary.blockerGroups).toBeGreaterThan(0);
    expect(report.summary.blockerItems).toBeGreaterThan(0);
    expect(report.blockers.map((blocker) => blocker.id)).toEqual(expect.arrayContaining([
      'conversion-unsupported-block-types',
      'conversion-unresolved-registry-errors',
      'conversion-missing-references',
      'command-coverage-unsupported-types',
      'script-coverage-missing-used-types',
      'script-coverage-unknown-used-type-ids',
      'script-engine-known-missing-implementations',
      'prerequisite-missing-references',
      'prerequisite-object-cycles',
      'prerequisite-science-cycles',
      'visual-scene-blocked-scenarios',
      'ui-layout-blocked-scenarios',
    ]));
  });
});
