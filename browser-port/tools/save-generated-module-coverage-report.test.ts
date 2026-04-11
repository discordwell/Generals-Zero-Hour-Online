import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildSaveGeneratedModuleCoverageReport,
  collectGeneratedSourceModuleCoverage,
  collectSourceObjectModuleTypeUsage,
} from './save-generated-module-coverage-report.js';

describe('save generated module coverage report', () => {
  it('collects generated save module descriptors with source ModuleTag tokens', () => {
    const usage = collectSourceObjectModuleTypeUsage({
      objects: [{
        name: 'RuntimeTestObject',
        blocks: [
          { type: 'Body', name: 'ActiveBody ModuleTag_Body' },
          { type: 'Draw', name: 'W3DModelDraw ModuleTag_Draw' },
          { type: 'ClientUpdate', name: 'SwayClientUpdate ModuleTag_Sway' },
          {
            type: 'Behavior',
            name: 'ParentBehavior ModuleTag_Parent',
            blocks: [{ type: 'Behavior', name: 'ChildBehavior ModuleTag_Child' }],
          },
          { type: 'Behavior', name: 'IgnoredBehavior MissingTag' },
        ],
      }],
    });

    expect(usage).toEqual([
      { moduleType: 'ACTIVEBODY', count: 1, exampleObjectName: 'RuntimeTestObject' },
      { moduleType: 'CHILDBEHAVIOR', count: 1, exampleObjectName: 'RuntimeTestObject' },
      { moduleType: 'PARENTBEHAVIOR', count: 1, exampleObjectName: 'RuntimeTestObject' },
      { moduleType: 'SWAYCLIENTUPDATE', count: 1, exampleObjectName: 'RuntimeTestObject' },
      { moduleType: 'W3DMODELDRAW', count: 1, exampleObjectName: 'RuntimeTestObject' },
    ]);
  });

  it('detects generated serializer coverage from explicit branches, sets, and body/contain switches', () => {
    const covered = collectGeneratedSourceModuleCoverage(`
      const SOURCE_EXAMPLE_MODULE_TYPES = new Set([
        'SETMODULE',
      ]);
      function normalizeSourceBodyModuleKind(moduleType: string) {
        switch (moduleType) {
          case 'BODYMODULE': return 'active';
        }
      }

      interface SourceSpecialPowerModuleBlockState {}
      function normalizeSourceContainModuleKind(moduleType: string) {
        switch (moduleType) {
          case 'CONTAINMODULE': return 'open';
        }
      }

      function xferSourceOpenContain() {}
      if (normalizedModuleType === 'EXPLICITMODULE') {
        return new Uint8Array();
      }
    `);

    expect([...covered].sort()).toEqual([
      'BODYMODULE',
      'CONTAINMODULE',
      'EXPLICITMODULE',
      'SETMODULE',
    ]);
  });

  it('reports missing module types with counts and examples', () => {
    const report = buildSaveGeneratedModuleCoverageReport({
      iniBundle: {
        objects: [
          { name: 'CoveredObject', blocks: [{ type: 'Behavior', name: 'CoveredModule ModuleTag_Covered' }] },
          { name: 'MissingObject', blocks: [{ type: 'Behavior', name: 'MissingModule ModuleTag_Missing' }] },
          { name: 'MissingObject2', blocks: [{ type: 'Behavior', name: 'MissingModule ModuleTag_Missing2' }] },
        ],
      },
      iniBundlePath: '/tmp/ini-bundle.json',
      runtimeSaveGamePath: '/tmp/runtime-save-game.ts',
      runtimeSaveGameSource: "if (normalizedModuleType === 'COVEREDMODULE') {}",
      generatedAt: 'fixed',
    });

    expect(report).toMatchObject({
      generatedAt: 'fixed',
      totalSourceModuleTypes: 2,
      coveredSourceModuleTypes: 1,
      missingSourceModuleTypes: [{
        moduleType: 'MISSINGMODULE',
        count: 2,
        exampleObjectName: 'MissingObject',
      }],
    });
  });

  it('live source parity scan covers every real generated save module type', () => {
    const iniBundlePath = new URL('../packages/app/public/assets/data/ini-bundle.json', import.meta.url);
    const runtimeSaveGamePath = new URL('../packages/app/src/runtime-save-game.ts', import.meta.url);
    const report = buildSaveGeneratedModuleCoverageReport({
      iniBundle: JSON.parse(readFileSync(iniBundlePath, 'utf8')) as Record<string, unknown>,
      iniBundlePath: iniBundlePath.pathname,
      runtimeSaveGamePath: runtimeSaveGamePath.pathname,
      runtimeSaveGameSource: readFileSync(runtimeSaveGamePath, 'utf8'),
      generatedAt: 'fixed',
    });

    expect(report.totalSourceModuleTypes).toBe(195);
    expect(report.coveredSourceModuleTypes).toBe(195);
    expect(report.missingSourceModuleTypes).toEqual([]);
  });
});
