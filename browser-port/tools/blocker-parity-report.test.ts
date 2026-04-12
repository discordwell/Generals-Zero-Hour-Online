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
      saveGeneratedModuleCoverage: {
        totalSourceModuleTypes: 195,
        coveredSourceModuleTypes: 195,
        missingSourceModuleTypes: [],
      },
      saveCoreChunks: {
        summary: {
          totalSaveFiles: 1,
          blockedSaveFiles: 0,
          rawPassthroughCoreChunks: 0,
          missingCoreChunks: 0,
          rawUnsupportedGameClientDrawables: 0,
          blockedRoundTrips: 0,
        },
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
      saveGeneratedModuleCoverage: {
        totalSourceModuleTypes: 195,
        coveredSourceModuleTypes: 194,
        missingSourceModuleTypes: [{
          moduleType: 'MISSINGMODULE',
          count: 2,
          exampleObjectName: 'MissingObject',
        }],
      },
      saveCoreChunks: {
        summary: {
          totalSaveFiles: 0,
          blockedSaveFiles: 0,
          rawPassthroughCoreChunks: 2,
          missingCoreChunks: 1,
          rawUnsupportedGameClientDrawables: 3,
          blockedRoundTrips: 4,
        },
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
      'save-generated-module-missing-serializers',
      'save-core-no-wet-fixtures',
      'save-core-raw-or-missing-chunks',
      'save-core-unsupported-gameclient-drawables',
      'save-core-roundtrip-blocked',
      'visual-scene-blocked-scenarios',
      'ui-layout-blocked-scenarios',
    ]));
    const wetFixtureBlocker = report.blockers.find((blocker) => blocker.id === 'save-core-no-wet-fixtures');
    expect(wetFixtureBlocker?.details).toEqual(expect.arrayContaining([
      'Import real retail/source saves with: npm run fixtures:import-source-saves -- <save-file-or-directory>',
      'Carve opaque disk captures with: npm run fixtures:carve-source-saves -- <capture-or-disk-image>',
    ]));
  });
});
