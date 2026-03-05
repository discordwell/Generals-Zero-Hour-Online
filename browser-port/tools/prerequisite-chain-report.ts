import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IniBlock } from '@generals/core';
import type { IniDataBundle, ObjectDef } from '@generals/ini-data';

type ReferenceType = 'Object' | 'Science' | 'Upgrade';

interface MissingReference {
  ownerType: 'Object' | 'Upgrade' | 'Science' | 'CommandButton';
  ownerName: string;
  referenceType: ReferenceType;
  referenceName: string;
  detail: string;
}

interface PrerequisiteChainReport {
  generatedAt: string;
  bundlePath: string;
  summary: {
    objectPrerequisiteEdges: number;
    sciencePrerequisiteEdges: number;
    upgradePrerequisiteEdges: number;
    commandButtonPrerequisiteEdges: number;
    missingReferences: number;
    objectCycles: number;
    scienceCycles: number;
  };
  missingReferences: MissingReference[];
  objectCycles: string[][];
  scienceCycles: string[][];
}

function normalizeToken(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

function extractTokens(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[\s,;|]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTokens(entry));
  }
  return [];
}

function addGraphEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  const normalizedFrom = normalizeToken(from);
  const normalizedTo = normalizeToken(to);
  if (!normalizedFrom || !normalizedTo) {
    return;
  }
  const targets = graph.get(normalizedFrom) ?? new Set<string>();
  targets.add(normalizedTo);
  graph.set(normalizedFrom, targets);
}

function canonicalizeCycle(nodes: string[]): string {
  if (nodes.length === 0) {
    return '';
  }
  let best = nodes;
  for (let offset = 1; offset < nodes.length; offset += 1) {
    const rotated = [...nodes.slice(offset), ...nodes.slice(0, offset)];
    if (rotated.join('>') < best.join('>')) {
      best = rotated;
    }
  }
  return best.join('>');
}

function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  const visit = (node: string): void => {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) {
        continue;
      }
      if (!visited.has(next)) {
        visit(next);
        continue;
      }
      if (!inStack.has(next)) {
        continue;
      }
      const startIndex = stack.indexOf(next);
      if (startIndex < 0) {
        continue;
      }
      const cycle = stack.slice(startIndex);
      const key = canonicalizeCycle(cycle);
      if (key && !cycleKeys.has(key)) {
        cycleKeys.add(key);
        cycles.push(cycle);
      }
    }

    stack.pop();
    inStack.delete(node);
  };

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  return cycles.sort((left, right) => left.join('>').localeCompare(right.join('>')));
}

function collectPrerequisiteBlocks(objectDef: ObjectDef): IniBlock[] {
  const collected: IniBlock[] = [];
  const visit = (block: IniBlock): void => {
    if (normalizeToken(block.type) === 'PREREQUISITE') {
      collected.push(block);
    }
    for (const child of block.blocks) {
      visit(child);
    }
  };
  for (const block of objectDef.blocks) {
    visit(block);
  }
  return collected;
}

function parsePrerequisiteBlock(block: IniBlock): { type: ReferenceType | null; names: string[] } {
  const tokens = extractTokens(block.name);
  if (tokens.length === 0) {
    return { type: null, names: [] };
  }
  const typeToken = normalizeToken(tokens[0]);
  let type: ReferenceType | null = null;
  if (typeToken === 'OBJECT') {
    type = 'Object';
  } else if (typeToken === 'SCIENCE') {
    type = 'Science';
  } else if (typeToken === 'UPGRADE') {
    type = 'Upgrade';
  }
  const names = tokens.slice(1).map((token) => normalizeToken(token)).filter(Boolean);
  return { type, names };
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(scriptPath), '..');
  const bundlePath = path.join(projectRoot, 'packages', 'app', 'public', 'assets', 'data', 'ini-bundle.json');
  const outputPath = path.join(projectRoot, 'prerequisite-chain-report.json');

  const bundleRaw = await fs.readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(bundleRaw) as IniDataBundle;

  const objectNames = new Set(bundle.objects.map((objectDef) => normalizeToken(objectDef.name)).filter(Boolean));
  const scienceNames = new Set(bundle.sciences.map((scienceDef) => normalizeToken(scienceDef.name)).filter(Boolean));
  const upgradeNames = new Set(bundle.upgrades.map((upgradeDef) => normalizeToken(upgradeDef.name)).filter(Boolean));

  const missingReferences: MissingReference[] = [];
  const objectGraph = new Map<string, Set<string>>();
  const scienceGraph = new Map<string, Set<string>>();

  let objectPrerequisiteEdges = 0;
  let sciencePrerequisiteEdges = 0;
  let upgradePrerequisiteEdges = 0;
  let commandButtonPrerequisiteEdges = 0;

  for (const objectDef of bundle.objects) {
    const ownerName = normalizeToken(objectDef.name);
    if (ownerName && !objectGraph.has(ownerName)) {
      objectGraph.set(ownerName, new Set());
    }
    for (const prerequisiteBlock of collectPrerequisiteBlocks(objectDef)) {
      const parsed = parsePrerequisiteBlock(prerequisiteBlock);
      if (!parsed.type) {
        continue;
      }
      for (const referenceName of parsed.names) {
        if (parsed.type === 'Object') {
          objectPrerequisiteEdges += 1;
          addGraphEdge(objectGraph, ownerName, referenceName);
          if (!objectNames.has(referenceName)) {
            missingReferences.push({
              ownerType: 'Object',
              ownerName: objectDef.name,
              referenceType: 'Object',
              referenceName,
              detail: 'Object Prerequisite references a missing object template.',
            });
          }
          continue;
        }
        if (parsed.type === 'Science') {
          sciencePrerequisiteEdges += 1;
          if (!scienceNames.has(referenceName)) {
            missingReferences.push({
              ownerType: 'Object',
              ownerName: objectDef.name,
              referenceType: 'Science',
              referenceName,
              detail: 'Object Prerequisite references a missing science.',
            });
          }
          continue;
        }
        if (parsed.type === 'Upgrade') {
          upgradePrerequisiteEdges += 1;
          if (!upgradeNames.has(referenceName)) {
            missingReferences.push({
              ownerType: 'Object',
              ownerName: objectDef.name,
              referenceType: 'Upgrade',
              referenceName,
              detail: 'Object Prerequisite references a missing upgrade.',
            });
          }
        }
      }
    }
  }

  for (const scienceDef of bundle.sciences) {
    const ownerName = normalizeToken(scienceDef.name);
    if (ownerName && !scienceGraph.has(ownerName)) {
      scienceGraph.set(ownerName, new Set());
    }
    const prerequisites = extractTokens(scienceDef.fields['PrerequisiteSciences'])
      .map((token) => normalizeToken(token))
      .filter(Boolean);
    for (const prerequisite of prerequisites) {
      sciencePrerequisiteEdges += 1;
      addGraphEdge(scienceGraph, ownerName, prerequisite);
      if (!scienceNames.has(prerequisite)) {
        missingReferences.push({
          ownerType: 'Science',
          ownerName: scienceDef.name,
          referenceType: 'Science',
          referenceName: prerequisite,
          detail: 'Science PrerequisiteSciences references a missing science.',
        });
      }
    }
  }

  for (const upgradeDef of bundle.upgrades) {
    const prerequisiteSciences = extractTokens(upgradeDef.fields['PrerequisiteSciences'])
      .map((token) => normalizeToken(token))
      .filter(Boolean);
    for (const prerequisite of prerequisiteSciences) {
      upgradePrerequisiteEdges += 1;
      if (!scienceNames.has(prerequisite)) {
        missingReferences.push({
          ownerType: 'Upgrade',
          ownerName: upgradeDef.name,
          referenceType: 'Science',
          referenceName: prerequisite,
          detail: 'Upgrade PrerequisiteSciences references a missing science.',
        });
      }
    }
  }

  for (const button of bundle.commandButtons ?? []) {
    const commandType = normalizeToken(extractTokens(button.fields['Command'])[0] ?? button.commandTypeName);
    if (commandType === 'UNIT_BUILD' || commandType === 'DOZER_CONSTRUCT' || commandType === 'SPECIAL_POWER_CONSTRUCT') {
      const objectName = normalizeToken(extractTokens(button.fields['Object'])[0]);
      if (objectName) {
        commandButtonPrerequisiteEdges += 1;
        if (!objectNames.has(objectName)) {
          missingReferences.push({
            ownerType: 'CommandButton',
            ownerName: button.name,
            referenceType: 'Object',
            referenceName: objectName,
            detail: `CommandButton ${commandType} references a missing object.`,
          });
        }
      }
    }
    if (commandType === 'PLAYER_UPGRADE' || commandType === 'OBJECT_UPGRADE') {
      const upgradeName = normalizeToken(extractTokens(button.fields['Upgrade'])[0]);
      if (upgradeName) {
        commandButtonPrerequisiteEdges += 1;
        if (!upgradeNames.has(upgradeName)) {
          missingReferences.push({
            ownerType: 'CommandButton',
            ownerName: button.name,
            referenceType: 'Upgrade',
            referenceName: upgradeName,
            detail: `CommandButton ${commandType} references a missing upgrade.`,
          });
        }
      }
    }
    if (commandType.startsWith('SPECIAL_POWER')) {
      const scienceName = normalizeToken(extractTokens(button.fields['Science'])[0]);
      if (scienceName) {
        commandButtonPrerequisiteEdges += 1;
        if (!scienceNames.has(scienceName)) {
          missingReferences.push({
            ownerType: 'CommandButton',
            ownerName: button.name,
            referenceType: 'Science',
            referenceName: scienceName,
            detail: `CommandButton ${commandType} references a missing science.`,
          });
        }
      }
    }
  }

  const objectCycles = detectCycles(objectGraph);
  const scienceCycles = detectCycles(scienceGraph);

  const report: PrerequisiteChainReport = {
    generatedAt: new Date().toISOString(),
    bundlePath,
    summary: {
      objectPrerequisiteEdges,
      sciencePrerequisiteEdges,
      upgradePrerequisiteEdges,
      commandButtonPrerequisiteEdges,
      missingReferences: missingReferences.length,
      objectCycles: objectCycles.length,
      scienceCycles: scienceCycles.length,
    },
    missingReferences: missingReferences.sort((left, right) =>
      `${left.ownerType}:${left.ownerName}:${left.referenceType}:${left.referenceName}`.localeCompare(
        `${right.ownerType}:${right.ownerName}:${right.referenceType}:${right.referenceName}`,
      ),
    ),
    objectCycles,
    scienceCycles,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Prerequisite chain report written: ${outputPath}`);
  console.table([
    {
      objectEdges: report.summary.objectPrerequisiteEdges,
      scienceEdges: report.summary.sciencePrerequisiteEdges,
      upgradeEdges: report.summary.upgradePrerequisiteEdges,
      commandButtonEdges: report.summary.commandButtonPrerequisiteEdges,
      missingReferences: report.summary.missingReferences,
      objectCycles: report.summary.objectCycles,
      scienceCycles: report.summary.scienceCycles,
    },
  ]);
}

await main();
