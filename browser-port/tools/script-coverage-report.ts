import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ScriptCoverageStatus = 'implemented' | 'missing' | 'unknown_id';
type MapScriptCategory = 'campaign' | 'challenge' | 'skirmish' | 'unknown';

interface ScriptUsageEntry {
  count: number;
  maps: Set<string>;
  categories: Set<MapScriptCategory>;
  scripts: Set<string>;
}

interface ScriptCoverageRow {
  id: number;
  name: string | null;
  status: ScriptCoverageStatus;
  usageCount: number;
  mapCount: number;
  maps: string[];
  categories: MapScriptCategory[];
  scriptSamples: string[];
}

interface ScriptCoverageReport {
  generatedAt: string;
  gameLogicSourcePath: string;
  mapsRootPath: string;
  summary: {
    mapsScanned: number;
    mapsWithScripts: number;
    scriptsScanned: number;
    distinctActionTypesUsed: number;
    distinctConditionTypesUsed: number;
    implementedActionTypesUsed: number;
    missingActionTypesUsed: number;
    unknownActionTypeIdsUsed: number;
    implementedConditionTypesUsed: number;
    missingConditionTypesUsed: number;
    unknownConditionTypeIdsUsed: number;
    knownActionTypeIdsInEngine: number;
    knownConditionTypeIdsInEngine: number;
    knownActionTypeIdsMissingImplementation: number;
    knownConditionTypeIdsMissingImplementation: number;
    implementedActionNamesInEngine: number;
    implementedConditionNamesInEngine: number;
  };
  actionCoverage: ScriptCoverageRow[];
  conditionCoverage: ScriptCoverageRow[];
  missingActionTypeIds: number[];
  missingConditionTypeIds: number[];
  engineKnownMissingActionTypeIds: number[];
  engineKnownMissingConditionTypeIds: number[];
}

function parseArgs(argv: string[]): { mapsRoot: string | null; output: string | null; gameLogicSource: string | null } {
  let mapsRoot: string | null = null;
  let output: string | null = null;
  let gameLogicSource: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--maps-root' && next) {
      mapsRoot = next;
      i += 1;
      continue;
    }
    if (arg === '--output' && next) {
      output = next;
      i += 1;
      continue;
    }
    if (arg === '--game-logic-source' && next) {
      gameLogicSource = next;
      i += 1;
    }
  }

  return { mapsRoot, output, gameLogicSource };
}

function isIdentifierChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  return /[A-Za-z0-9_$]/.test(ch);
}

function readCaseExpression(source: string, startIndex: number): { expression: string; nextIndex: number } | null {
  let i = startIndex;
  let expression = '';
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let escapeNext = false;

  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      expression += ch;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        expression += '*/';
        i += 2;
        continue;
      }
      expression += ch;
      i += 1;
      continue;
    }
    if (inSingleQuote) {
      expression += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '\'') {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }
    if (inDoubleQuote) {
      expression += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      i += 1;
      continue;
    }
    if (inTemplate) {
      expression += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      expression += '//';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      expression += '/*';
      i += 2;
      continue;
    }
    if (ch === '\'') {
      inSingleQuote = true;
      expression += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      expression += ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      expression += ch;
      i += 1;
      continue;
    }
    if (ch === ':') {
      return { expression: expression.trim(), nextIndex: i + 1 };
    }

    expression += ch;
    i += 1;
  }

  return null;
}

function extractTopLevelSwitchCaseExpressions(source: string, switchMarker: string): string[] {
  const markerIndex = source.indexOf(switchMarker);
  if (markerIndex < 0) {
    return [];
  }
  const openBraceIndex = source.indexOf('{', markerIndex);
  if (openBraceIndex < 0) {
    return [];
  }

  const expressions: string[] = [];
  let i = openBraceIndex + 1;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let escapeNext = false;

  while (i < source.length && depth > 0) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingleQuote) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '\'') {
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }
    if (inDoubleQuote) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inDoubleQuote = false;
      }
      i += 1;
      continue;
    }
    if (inTemplate) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '\'') {
      inSingleQuote = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      i += 1;
      continue;
    }

    if (
      depth === 1
      && source.startsWith('case', i)
      && !isIdentifierChar(source[i - 1])
      && !isIdentifierChar(source[i + 4])
    ) {
      const read = readCaseExpression(source, i + 4);
      if (read) {
        expressions.push(read.expression);
        i = read.nextIndex;
        continue;
      }
    }

    i += 1;
  }

  return expressions;
}

function parseActionNameById(source: string): Map<number, string> {
  const map = new Map<number, string>();
  const blockMatch = source.match(/const SCRIPT_ACTION_TYPE_NUMERIC_TO_NAME = new Map<number, string>\(\[([\s\S]*?)\]\);/);
  if (!blockMatch) {
    return map;
  }

  const entryRegex = /\[\s*(-?\d+)\s*,\s*'([^']+)'\s*]/g;
  for (;;) {
    const match = entryRegex.exec(blockMatch[1]);
    if (!match) {
      break;
    }
    const rawId = Number(match[1]);
    const name = match[2]?.trim();
    if (!Number.isFinite(rawId) || !name) {
      continue;
    }
    map.set(rawId, name);
  }
  return map;
}

function parseConditionNameById(source: string): Map<number, string> {
  const map = new Map<number, string>();
  const blockMatch = source.match(/const SCRIPT_CONDITION_TYPE_NAMES_BY_INDEX = \[([\s\S]*?)\] as const;/);
  if (!blockMatch) {
    return map;
  }

  const nameRegex = /'([^']+)'/g;
  let index = 0;
  for (;;) {
    const match = nameRegex.exec(blockMatch[1]);
    if (!match) {
      break;
    }
    const name = match[1]?.trim();
    if (name) {
      map.set(index, name);
    }
    index += 1;
  }
  return map;
}

function extractCaseStringLiteral(caseExpression: string): string | null {
  const trimmed = caseExpression.trim();
  const single = trimmed.match(/^'([^']+)'$/);
  if (single?.[1]) {
    return single[1];
  }
  const double = trimmed.match(/^"([^"]+)"$/);
  if (double?.[1]) {
    return double[1];
  }
  return null;
}

async function collectJsonFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
}

function inferMapCategory(relativePath: string): MapScriptCategory {
  const lower = relativePath.toLowerCase();
  if (lower.includes('campaign')) {
    return 'campaign';
  }
  if (lower.includes('challenge')) {
    return 'challenge';
  }
  if (lower.includes('skirmish')) {
    return 'skirmish';
  }
  return 'unknown';
}

function normalizeScriptId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function addUsage(
  usage: Map<number, ScriptUsageEntry>,
  id: number,
  relativeMapPath: string,
  category: MapScriptCategory,
  scriptName: string,
): void {
  const existing = usage.get(id) ?? {
    count: 0,
    maps: new Set<string>(),
    categories: new Set<MapScriptCategory>(),
    scripts: new Set<string>(),
  };
  existing.count += 1;
  existing.maps.add(relativeMapPath);
  existing.categories.add(category);
  existing.scripts.add(scriptName);
  usage.set(id, existing);
}

function collectScriptUsageFromScriptList(
  scriptList: unknown,
  relativeMapPath: string,
  category: MapScriptCategory,
  actionUsage: Map<number, ScriptUsageEntry>,
  conditionUsage: Map<number, ScriptUsageEntry>,
): number {
  if (!scriptList || typeof scriptList !== 'object') {
    return 0;
  }
  let scriptCount = 0;
  const list = scriptList as {
    scripts?: Array<{
      name?: string;
      actions?: Array<{ actionType?: unknown }>;
      falseActions?: Array<{ actionType?: unknown }>;
      conditions?: Array<{ conditions?: Array<{ conditionType?: unknown }> }>;
    }>;
    groups?: Array<{ scripts?: Array<{
      name?: string;
      actions?: Array<{ actionType?: unknown }>;
      falseActions?: Array<{ actionType?: unknown }>;
      conditions?: Array<{ conditions?: Array<{ conditionType?: unknown }> }>;
    }> }>;
  };

  const visitScript = (script: {
    name?: string;
    actions?: Array<{ actionType?: unknown }>;
    falseActions?: Array<{ actionType?: unknown }>;
    conditions?: Array<{ conditions?: Array<{ conditionType?: unknown }> }>;
  }): void => {
    scriptCount += 1;
    const scriptName = typeof script.name === 'string' && script.name.trim().length > 0
      ? script.name
      : '(unnamed-script)';

    for (const action of script.actions ?? []) {
      const id = normalizeScriptId(action.actionType);
      if (id === null) continue;
      addUsage(actionUsage, id, relativeMapPath, category, scriptName);
    }
    for (const action of script.falseActions ?? []) {
      const id = normalizeScriptId(action.actionType);
      if (id === null) continue;
      addUsage(actionUsage, id, relativeMapPath, category, `${scriptName} (falseAction)`);
    }
    for (const orGroup of script.conditions ?? []) {
      for (const condition of orGroup.conditions ?? []) {
        const id = normalizeScriptId(condition.conditionType);
        if (id === null) continue;
        addUsage(conditionUsage, id, relativeMapPath, category, scriptName);
      }
    }
  };

  for (const script of list.scripts ?? []) {
    visitScript(script);
  }
  for (const group of list.groups ?? []) {
    for (const script of group.scripts ?? []) {
      visitScript(script);
    }
  }

  return scriptCount;
}

function toCoverageRows(
  usageById: Map<number, ScriptUsageEntry>,
  idToName: Map<number, string>,
  implementedNames: Set<string>,
): ScriptCoverageRow[] {
  return [...usageById.entries()]
    .map(([id, usage]) => {
      const name = idToName.get(id) ?? null;
      let status: ScriptCoverageStatus;
      if (!name) {
        status = 'unknown_id';
      } else if (implementedNames.has(name)) {
        status = 'implemented';
      } else {
        status = 'missing';
      }
      return {
        id,
        name,
        status,
        usageCount: usage.count,
        mapCount: usage.maps.size,
        maps: [...usage.maps].sort((left, right) => left.localeCompare(right)),
        categories: [...usage.categories].sort(),
        scriptSamples: [...usage.scripts].sort((left, right) => left.localeCompare(right)).slice(0, 10),
      };
    })
    .sort((left, right) => left.id - right.id);
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(scriptPath), '..');
  const args = parseArgs(process.argv.slice(2));

  const gameLogicSourcePath = path.resolve(
    projectRoot,
    args.gameLogicSource ?? path.join('packages', 'game-logic', 'src', 'index.ts'),
  );
  const mapsRootPath = path.resolve(
    projectRoot,
    args.mapsRoot ?? path.join('packages', 'app', 'public', 'assets', 'maps'),
  );
  const outputPath = path.resolve(
    projectRoot,
    args.output ?? 'script-coverage-report.json',
  );

  const source = await fs.readFile(gameLogicSourcePath, 'utf8');

  const actionNameById = parseActionNameById(source);
  const conditionNameById = parseConditionNameById(source);

  const implementedActionNames = new Set(
    extractTopLevelSwitchCaseExpressions(source, 'switch (actionType)')
      .map((expr) => extractCaseStringLiteral(expr))
      .filter((name): name is string => !!name),
  );
  const implementedConditionNames = new Set(
    extractTopLevelSwitchCaseExpressions(source, 'switch (conditionType)')
      .map((expr) => extractCaseStringLiteral(expr))
      .filter((name): name is string => !!name),
  );

  const actionUsage = new Map<number, ScriptUsageEntry>();
  const conditionUsage = new Map<number, ScriptUsageEntry>();
  let mapsScanned = 0;
  let mapsWithScripts = 0;
  let scriptsScanned = 0;

  const jsonFiles = await collectJsonFiles(mapsRootPath);
  for (const mapPath of jsonFiles) {
    mapsScanned += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(mapPath, 'utf8'));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const relativeMapPath = path.relative(projectRoot, mapPath);
    const category = inferMapCategory(relativeMapPath);
    const mapData = parsed as { sidesList?: { sides?: Array<{ scripts?: unknown }> } };
    const sides = mapData.sidesList?.sides ?? [];
    let mapScriptCount = 0;
    for (const side of sides) {
      mapScriptCount += collectScriptUsageFromScriptList(
        side.scripts,
        relativeMapPath,
        category,
        actionUsage,
        conditionUsage,
      );
    }
    if (mapScriptCount > 0) {
      mapsWithScripts += 1;
      scriptsScanned += mapScriptCount;
    }
  }

  const actionCoverage = toCoverageRows(actionUsage, actionNameById, implementedActionNames);
  const conditionCoverage = toCoverageRows(conditionUsage, conditionNameById, implementedConditionNames);

  const missingActionTypeIds = actionCoverage.filter((row) => row.status === 'missing').map((row) => row.id);
  const missingConditionTypeIds = conditionCoverage.filter((row) => row.status === 'missing').map((row) => row.id);
  const engineKnownMissingActionTypeIds = [...actionNameById.entries()]
    .filter(([, name]) => !implementedActionNames.has(name))
    .map(([id]) => id)
    .sort((left, right) => left - right);
  const engineKnownMissingConditionTypeIds = [...conditionNameById.entries()]
    .filter(([, name]) => name !== 'NUM_ITEMS' && !implementedConditionNames.has(name))
    .map(([id]) => id)
    .sort((left, right) => left - right);

  const report: ScriptCoverageReport = {
    generatedAt: new Date().toISOString(),
    gameLogicSourcePath,
    mapsRootPath,
    summary: {
      mapsScanned,
      mapsWithScripts,
      scriptsScanned,
      distinctActionTypesUsed: actionCoverage.length,
      distinctConditionTypesUsed: conditionCoverage.length,
      implementedActionTypesUsed: actionCoverage.filter((row) => row.status === 'implemented').length,
      missingActionTypesUsed: actionCoverage.filter((row) => row.status === 'missing').length,
      unknownActionTypeIdsUsed: actionCoverage.filter((row) => row.status === 'unknown_id').length,
      implementedConditionTypesUsed: conditionCoverage.filter((row) => row.status === 'implemented').length,
      missingConditionTypesUsed: conditionCoverage.filter((row) => row.status === 'missing').length,
      unknownConditionTypeIdsUsed: conditionCoverage.filter((row) => row.status === 'unknown_id').length,
      knownActionTypeIdsInEngine: actionNameById.size,
      knownConditionTypeIdsInEngine: [...conditionNameById.values()].filter((name) => name !== 'NUM_ITEMS').length,
      knownActionTypeIdsMissingImplementation: engineKnownMissingActionTypeIds.length,
      knownConditionTypeIdsMissingImplementation: engineKnownMissingConditionTypeIds.length,
      implementedActionNamesInEngine: implementedActionNames.size,
      implementedConditionNamesInEngine: implementedConditionNames.size,
    },
    actionCoverage,
    conditionCoverage,
    missingActionTypeIds,
    missingConditionTypeIds,
    engineKnownMissingActionTypeIds,
    engineKnownMissingConditionTypeIds,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Script coverage report written: ${outputPath}`);
  console.log('Summary:', report.summary);
  if (missingActionTypeIds.length > 0) {
    console.log('Missing action IDs:', missingActionTypeIds.join(', '));
  }
  if (missingConditionTypeIds.length > 0) {
    console.log('Missing condition IDs:', missingConditionTypeIds.join(', '));
  }
  if (engineKnownMissingActionTypeIds.length > 0) {
    console.log('Engine-known action IDs missing implementation:', engineKnownMissingActionTypeIds.join(', '));
  }
  if (engineKnownMissingConditionTypeIds.length > 0) {
    console.log('Engine-known condition IDs missing implementation:', engineKnownMissingConditionTypeIds.join(', '));
  }
}

await main();
