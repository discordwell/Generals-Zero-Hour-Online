import { describe, expect, it } from 'vitest';

import {
  buildModuleRuntimeCoverageReport,
  collectIniModuleUsage,
  collectRuntimeModuleSignals,
  parseSourceModuleRegistrations,
} from './module-runtime-coverage-report.js';

describe('module runtime coverage report', () => {
  it('parses source module registrations with factory categories', () => {
    const registrations = parseSourceModuleRegistrations(`
      // behavior modules
      addModule( FooBehavior );
      // update modules
      addModule( BarUpdate );
    `, 'ModuleFactory.cpp');

    expect(registrations).toEqual([
      expect.objectContaining({
        moduleType: 'BARUPDATE',
        categories: ['update'],
        sourceNames: ['BarUpdate'],
      }),
      expect.objectContaining({
        moduleType: 'FOOBEHAVIOR',
        categories: ['behavior'],
        sourceNames: ['FooBehavior'],
      }),
    ]);
  });

  it('counts shipped INI usage recursively by module type', () => {
    const usage = collectIniModuleUsage({
      objects: [{
        name: 'TestObject',
        blocks: [{
          type: 'Draw',
          name: 'W3DModelDraw ModuleTag_Draw',
          blocks: [{
            type: 'Behavior',
            name: 'FooBehavior ModuleTag_Foo',
          }],
        }],
      }],
    });

    expect(usage).toEqual([
      expect.objectContaining({
        moduleType: 'FOOBEHAVIOR',
        count: 1,
        blockTypes: ['BEHAVIOR'],
        moduleTags: ['ModuleTag_Foo'],
        exampleObjectNames: ['TestObject'],
      }),
      expect.objectContaining({
        moduleType: 'W3DMODELDRAW',
        count: 1,
        blockTypes: ['DRAW'],
      }),
    ]);
  });

  it('separates gameplay gaps from save-only or import-only signals', () => {
    const sourceRegistrations = parseSourceModuleRegistrations(`
      // behavior modules
      addModule( FooBehavior );
      addModule( BarUpdate );
    `, 'ModuleFactory.cpp');
    const iniUsage = collectIniModuleUsage({
      objects: [{
        name: 'FooObject',
        blocks: [
          { type: 'Behavior', name: 'FooBehavior ModuleTag_Foo' },
          { type: 'Behavior', name: 'BarUpdate ModuleTag_Bar' },
          { type: 'Draw', name: 'W3DModelDraw ModuleTag_Draw' },
        ],
      }],
    });
    const moduleTypes = ['FOOBEHAVIOR', 'BARUPDATE', 'W3DMODELDRAW'];
    const gameplaySignals = collectRuntimeModuleSignals([
      { relativePath: 'packages/game-logic/src/foo.ts', source: "if (moduleType === 'FOOBEHAVIOR') return true;" },
    ], moduleTypes);
    const broadSignals = collectRuntimeModuleSignals([
      { relativePath: 'packages/app/src/runtime-save-game.ts', source: "const covered = ['BARUPDATE'];" },
    ], moduleTypes);
    const testSignals = collectRuntimeModuleSignals([
      { relativePath: 'packages/game-logic/src/foo.test.ts', source: "makeBlock('Behavior', 'FooBehavior ModuleTag_Foo', {})" },
    ], moduleTypes);

    const report = buildModuleRuntimeCoverageReport({
      sourceRegistrations,
      iniUsage,
      gameplaySignals,
      broadRuntimeSignals: broadSignals,
      testSignals,
      saveCoveredModuleTypes: new Set(['BARUPDATE']),
      iniBundlePath: 'ini-bundle.json',
      sourceFactoryPaths: ['ModuleFactory.cpp'],
      gameplaySourceRoots: ['packages/game-logic/src'],
      testSourceRoots: ['packages/game-logic/src'],
      runtimeSaveGamePath: 'runtime-save-game.ts',
      generatedAt: '2026-04-27T00:00:00.000Z',
    });

    expect(report.status).toBe('attention');
    expect(report.gameplayGaps.map((row) => row.moduleType)).toEqual(['BARUPDATE']);
    expect(report.saveOnlyOrImportOnlySignals.map((row) => row.moduleType)).toEqual(['BARUPDATE']);
    expect(report.untestedRuntimeSignals).toHaveLength(0);
    expect(report.iniOnlyModuleTypes.map((row) => row.moduleType)).toEqual(['W3DMODELDRAW']);
  });
});
