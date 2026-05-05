import { describe, expect, it } from 'vitest';

import type { IniBlock } from '@generals/core';
import type { IniDataBundle } from '@generals/ini-data';

import {
  buildPrerequisiteChainReport,
  collectPrerequisiteBlocks,
  parsePrerequisiteBlockReferences,
} from './prerequisite-chain-report.js';

function block(type: string, name: string, fields: Record<string, unknown> = {}, blocks: IniBlock[] = []): IniBlock {
  return { type, name, fields: fields as never, blocks };
}

describe('prerequisite chain report', () => {
  it('collects plural Prerequisites blocks used by retail object templates', () => {
    const objectDef = {
      name: 'TestUnit',
      fields: {},
      blocks: [
        block('Prerequisites', '', { Object: 'TestFactory' }),
        block('Behavior', 'Dummy ModuleTag_01', {}, [
          block('Prerequisite', 'SCIENCE SCIENCE_Test'),
        ]),
      ],
    };

    const collected = collectPrerequisiteBlocks(objectDef as never);
    expect(collected.map((entry) => entry.type)).toEqual(['Prerequisites', 'Prerequisite']);
  });

  it('parses Object and Science field entries from a plural Prerequisites block', () => {
    const refs = parsePrerequisiteBlockReferences(block('Prerequisites', '', {
      Object: ['TestFactoryA', 'TestFactoryB'],
      Science: 'SCIENCE_Test',
    }));

    expect(refs).toEqual([
      { type: 'Object', names: ['TESTFACTORYA', 'TESTFACTORYB'] },
      { type: 'Science', names: ['SCIENCE_TEST'] },
    ]);
  });

  it('reports object prerequisite edges from retail-shaped Prerequisites field blocks', () => {
    const bundle = {
      objects: [
        {
          name: 'TestFactoryA',
          fields: {},
          blocks: [],
        },
        {
          name: 'TestFactoryB',
          fields: {},
          blocks: [],
        },
        {
          name: 'TestUnit',
          fields: {},
          blocks: [
            block('Prerequisites', '', {
              Object: ['TestFactoryA', 'TestFactoryB'],
              Science: 'SCIENCE_Test',
            }),
          ],
        },
      ],
      sciences: [
        { name: 'SCIENCE_Test', fields: {} },
      ],
      upgrades: [],
      commandButtons: [],
    } as unknown as IniDataBundle;

    const report = buildPrerequisiteChainReport(bundle, 'synthetic/ini-bundle.json');
    expect(report.summary.objectPrerequisiteEdges).toBe(2);
    expect(report.summary.sciencePrerequisiteEdges).toBe(1);
    expect(report.summary.missingReferences).toBe(0);
  });
});
