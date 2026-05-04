import { describe, expect, it } from 'vitest';

import { parseSourceModuleRegistrations } from './module-runtime-coverage-report.js';
import {
  buildModuleFieldCoverageReport,
  buildSourceModuleFieldDescriptors,
  collectIniModuleFieldUsage,
  collectRuntimeFieldSignals,
  parseSourceModuleFieldParses,
} from './module-field-coverage-report.js';

describe('module field coverage report', () => {
  it('parses C++ module field tables with inherited and helper parse data', () => {
    const registrations = parseSourceModuleRegistrations(`
      // update modules
      addModule( FooUpdate );
      addModule( DestroyDie );
    `, 'ModuleFactory.cpp');
    const sourceIndex = parseSourceModuleFieldParses([{
      relativePath: 'FooUpdate.h',
      source: `
        class ModuleData
        {
        public:
          static void buildFieldParse(MultiIniFieldParse& p)
          {
            static const FieldParse dataFieldParse[] =
            {
              { "StartsActive", INI::parseBool, NULL, 0 },
              { 0, 0, 0, 0 }
            };
            p.add(dataFieldParse);
          }
        };
        class UpdateModuleData : public ModuleData
        {
        public:
          static void buildFieldParse(MultiIniFieldParse& p)
          {
            ModuleData::buildFieldParse(p);
            static const FieldParse dataFieldParse[] =
            {
              { "MinFrameTime", INI::parseDurationUnsignedInt, NULL, 0 },
              { 0, 0, 0, 0 }
            };
            p.add(dataFieldParse);
          }
        };
        class UpgradeMuxData
        {
        public:
          static const FieldParse* getFieldParse()
          {
            static const FieldParse dataFieldParse[] =
            {
              { "TriggeredBy", INI::parseAsciiStringVector, NULL, 0 },
              { 0, 0, 0, 0 }
            };
            return dataFieldParse;
          }
        };
        struct FooUpdateModuleData : public UpdateModuleData
        {
        public:
          static void buildFieldParse(MultiIniFieldParse& p)
          {
            UpdateModuleData::buildFieldParse(p);
            static const FieldParse dataFieldParse[] =
            {
              { "FooRadius", INI::parseReal, NULL, 0 },
              { 0, 0, 0, 0 }
            };
            p.add(dataFieldParse);
            p.add(UpgradeMuxData::getFieldParse(), offsetof(FooUpdateModuleData, m_upgradeMuxData));
          }
        };
        class FooUpdate
        {
          MAKE_STANDARD_MODULE_MACRO_WITH_MODULE_DATA( FooUpdate, FooUpdateModuleData )
        };
        class DieModuleData : public ModuleData
        {
        public:
          static void buildFieldParse(MultiIniFieldParse& p)
          {
            ModuleData::buildFieldParse(p);
            static const FieldParse dataFieldParse[] =
            {
              { "DeathTypes", INI::parseDeathTypeFlags, NULL, 0 },
              { 0, 0, 0, 0 }
            };
            p.add(dataFieldParse);
          }
        };
        class DieModule
        {
          MAKE_STANDARD_MODULE_DATA_MACRO_ABC( DieModule, DieModuleData )
        };
        class DestroyDie : public DieModule
        {
          MAKE_STANDARD_MODULE_MACRO( DestroyDie )
        };
      `,
    }]);

    const descriptors = buildSourceModuleFieldDescriptors(registrations, sourceIndex);

    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        moduleType: 'DESTROYDIE',
        dataClasses: ['DieModuleData'],
        fieldNames: ['DeathTypes', 'StartsActive'],
      }),
      expect.objectContaining({
        moduleType: 'FOOUPDATE',
        dataClasses: ['FooUpdateModuleData'],
        directFieldNames: ['FooRadius'],
        fieldNames: ['FooRadius', 'MinFrameTime', 'StartsActive', 'TriggeredBy'],
      }),
    ]));
  });

  it('counts shipped INI fields recursively by module type', () => {
    const usage = collectIniModuleFieldUsage({
      objects: [{
        name: 'TestObject',
        blocks: [{
          type: 'Draw',
          name: 'W3DModelDraw ModuleTag_Draw',
          fields: { OkToChangeModelColor: true },
          blocks: [{
            type: 'Behavior',
            name: 'FooUpdate ModuleTag_Foo',
            fields: { FooRadius: 10, StartsActive: true },
          }],
        }],
      }],
    });

    expect(usage).toEqual([
      expect.objectContaining({
        moduleType: 'FOOUPDATE',
        fieldName: 'FooRadius',
        count: 1,
        blockTypes: ['BEHAVIOR'],
        moduleTags: ['ModuleTag_Foo'],
        exampleObjectNames: ['TestObject'],
      }),
      expect.objectContaining({
        moduleType: 'FOOUPDATE',
        fieldName: 'StartsActive',
      }),
      expect.objectContaining({
        moduleType: 'W3DMODELDRAW',
        fieldName: 'OkToChangeModelColor',
      }),
    ]);
  });

  it('ranks source-known shipped fields missing TS gameplay reads', () => {
    const registrations = parseSourceModuleRegistrations(`
      // behavior modules
      addModule( FooUpdate );
    `, 'ModuleFactory.cpp');
    const sourceIndex = parseSourceModuleFieldParses([{
      relativePath: 'FooUpdate.h',
      source: `
        class FooUpdateModuleData
        {
        public:
          static void buildFieldParse(MultiIniFieldParse& p)
          {
            static const FieldParse dataFieldParse[] =
            {
              { "FooRadius", INI::parseReal, NULL, 0 },
              { "BarMode", INI::parseAsciiString, NULL, 0 },
              { 0, 0, 0, 0 }
            };
            p.add(dataFieldParse);
          }
        };
        class FooUpdate
        {
          MAKE_STANDARD_MODULE_MACRO_WITH_MODULE_DATA( FooUpdate, FooUpdateModuleData )
        };
      `,
    }]);
    const sourceDescriptors = buildSourceModuleFieldDescriptors(registrations, sourceIndex);
    const iniFieldUsage = collectIniModuleFieldUsage({
      objects: [{
        name: 'FooObject',
        blocks: [{
          type: 'Behavior',
          name: 'FooUpdate ModuleTag_Foo',
          fields: { FooRadius: 10, BarMode: 'LOUD' },
        }],
      }],
    });
    const report = buildModuleFieldCoverageReport({
      sourceDescriptors,
      iniFieldUsage,
      gameplaySignals: collectRuntimeFieldSignals([{
        relativePath: 'packages/game-logic/src/foo.ts',
        source: "readNumericField(block.fields, ['FooRadius']);",
      }], ['FooRadius', 'BarMode']),
      testSignals: collectRuntimeFieldSignals([{
        relativePath: 'packages/game-logic/src/foo.test.ts',
        source: "makeBlock('Behavior', 'FooUpdate ModuleTag_Foo', { FooRadius: 1 });",
      }], ['FooRadius', 'BarMode']),
      iniBundlePath: 'ini-bundle.json',
      sourceFactoryPaths: ['ModuleFactory.cpp'],
      sourceCodeRoots: ['../GeneralsMD/Code/GameEngine'],
      gameplaySourceRoots: ['packages/game-logic/src'],
      testSourceRoots: ['packages/game-logic/src'],
      generatedAt: '2026-04-28T00:00:00.000Z',
    });

    expect(report.status).toBe('attention');
    expect(report.sourceKnownFieldGaps.map((row) => `${row.moduleType}.${row.fieldName}`)).toEqual([
      'FOOUPDATE.BarMode',
    ]);
    expect(report.untestedRuntimeFieldSignals).toHaveLength(0);
  });
});
