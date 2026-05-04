import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectGeneratedSourceModuleCoverage } from './save-generated-module-coverage-report.js';

interface IniBlockShape {
  type?: unknown;
  name?: unknown;
  fields?: Record<string, unknown>;
  blocks?: IniBlockShape[];
}

interface IniObjectShape {
  name?: unknown;
  blocks?: IniBlockShape[];
}

interface IniBundleShape {
  objects?: IniObjectShape[];
}

export interface SourceModuleRegistration {
  moduleType: string;
  sourceNames: string[];
  categories: string[];
  sourceFiles: string[];
}

export interface IniModuleUsage {
  moduleType: string;
  count: number;
  blockTypes: string[];
  moduleTags: string[];
  exampleObjectNames: string[];
}

export interface RuntimeModuleSignal {
  moduleType: string;
  files: string[];
}

export interface ModuleRuntimeCoverageRow {
  moduleType: string;
  sourceDeclared: boolean;
  sourceCategories: string[];
  iniUsageCount: number;
  iniBlockTypes: string[];
  exampleObjectNames: string[];
  gameplayReferenced: boolean;
  gameplayReferenceFiles: string[];
  broadRuntimeReferenced: boolean;
  broadRuntimeReferenceFiles: string[];
  testReferenced: boolean;
  testReferenceFiles: string[];
  saveCovered: boolean;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

export interface ModuleRuntimeCoverageReport {
  generatedAt: string;
  status: 'clear' | 'attention';
  inputs: {
    iniBundlePath: string;
    sourceFactoryPaths: string[];
    gameplaySourceRoots: string[];
    testSourceRoots: string[];
    runtimeSaveGamePath: string;
  };
  summary: {
    sourceDeclaredModuleTypes: number;
    iniUsedModuleTypes: number;
    sourceDeclaredAndIniUsedModuleTypes: number;
    gameplayReferencedSourceIniModuleTypes: number;
    sourceIniGameplayGaps: number;
    sourceIniSaveOnlyOrImportOnlySignals: number;
    sourceIniUntestedRuntimeSignals: number;
    iniOnlyModuleTypes: number;
  };
  gameplayGaps: ModuleRuntimeCoverageRow[];
  saveOnlyOrImportOnlySignals: ModuleRuntimeCoverageRow[];
  untestedRuntimeSignals: ModuleRuntimeCoverageRow[];
  iniOnlyModuleTypes: ModuleRuntimeCoverageRow[];
  rows: ModuleRuntimeCoverageRow[];
}

export interface RuntimeSourceFile {
  relativePath: string;
  source: string;
}

const MODULE_BLOCK_TYPES = new Set([
  'BODY',
  'BEHAVIOR',
  'UPDATE',
  'DIE',
  'DRAW',
  'CLIENTUPDATE',
  'COLLIDE',
  'CREATE',
  'DAMAGE',
  'UPGRADE',
  'SPECIALPOWER',
]);

function normalizeModuleType(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    : '';
}

function normalizeBlockType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeComparableSource(source: string): string {
  return stripComments(source).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function classifySourceModuleCategory(comment: string, currentCategory: string): string {
  const normalized = comment.trim().toLowerCase();
  if (normalized.includes('behavior modules')) return 'behavior';
  if (normalized.includes('die modules')) return 'die';
  if (normalized.includes('update modules')) return 'update';
  if (normalized.includes('upgrade modules')) return 'upgrade';
  if (normalized.includes('create modules')) return 'create';
  if (normalized.includes('damage modules')) return 'damage';
  if (normalized.includes('collide modules')) return 'collide';
  if (normalized.includes('body modules')) return 'body';
  if (normalized.includes('contain modules')) return 'contain';
  if (normalized.includes('special power modules')) return 'specialpower';
  if (normalized.includes('client update modules')) return 'clientupdate';
  if (normalized.includes('destroy modules')) return 'destroy';
  return currentCategory;
}

export function parseSourceModuleRegistrations(
  source: string,
  sourceFile: string,
): SourceModuleRegistration[] {
  const registrations = new Map<string, {
    moduleType: string;
    sourceNames: Set<string>;
    categories: Set<string>;
    sourceFiles: Set<string>;
  }>();
  let currentCategory = 'unknown';

  for (const line of source.split(/\r?\n/)) {
    const commentMatch = line.match(/^\s*\/\/\s*(.*?)\s*$/);
    if (commentMatch) {
      currentCategory = classifySourceModuleCategory(commentMatch[1] ?? '', currentCategory);
      continue;
    }

    const addModuleMatch = line.match(/\baddModule\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/);
    if (!addModuleMatch) {
      continue;
    }

    const sourceName = addModuleMatch[1]!;
    const moduleType = normalizeModuleType(sourceName);
    if (!moduleType) {
      continue;
    }

    const existing = registrations.get(moduleType) ?? {
      moduleType,
      sourceNames: new Set<string>(),
      categories: new Set<string>(),
      sourceFiles: new Set<string>(),
    };
    existing.sourceNames.add(sourceName);
    existing.categories.add(currentCategory);
    existing.sourceFiles.add(sourceFile);
    registrations.set(moduleType, existing);
  }

  return [...registrations.values()]
    .map((registration) => ({
      moduleType: registration.moduleType,
      sourceNames: [...registration.sourceNames].sort((left, right) => left.localeCompare(right)),
      categories: [...registration.categories].sort((left, right) => left.localeCompare(right)),
      sourceFiles: [...registration.sourceFiles].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType));
}

function visitIniBlock(
  block: IniBlockShape,
  objectName: string | null,
  usageByType: Map<string, {
    moduleType: string;
    count: number;
    blockTypes: Set<string>;
    moduleTags: Set<string>;
    exampleObjectNames: Set<string>;
  }>,
): void {
  for (const child of block.blocks ?? []) {
    visitIniBlock(child, objectName, usageByType);
  }

  const blockType = normalizeBlockType(block.type);
  if (!MODULE_BLOCK_TYPES.has(blockType)) {
    return;
  }

  const tokens = typeof block.name === 'string'
    ? block.name.split(/\s+/).map((token) => token.trim()).filter(Boolean)
    : [];
  const moduleType = normalizeModuleType(tokens[0] ?? '');
  if (!moduleType) {
    return;
  }

  const existing = usageByType.get(moduleType) ?? {
    moduleType,
    count: 0,
    blockTypes: new Set<string>(),
    moduleTags: new Set<string>(),
    exampleObjectNames: new Set<string>(),
  };

  existing.count += 1;
  existing.blockTypes.add(blockType);
  const moduleTag = tokens.find((token) => token.toUpperCase().startsWith('MODULETAG_'));
  if (moduleTag) {
    existing.moduleTags.add(moduleTag);
  }
  if (objectName && existing.exampleObjectNames.size < 5) {
    existing.exampleObjectNames.add(objectName);
  }
  usageByType.set(moduleType, existing);
}

export function collectIniModuleUsage(iniBundle: IniBundleShape): IniModuleUsage[] {
  const usageByType = new Map<string, {
    moduleType: string;
    count: number;
    blockTypes: Set<string>;
    moduleTags: Set<string>;
    exampleObjectNames: Set<string>;
  }>();

  for (const objectDef of iniBundle.objects ?? []) {
    const objectName = typeof objectDef.name === 'string' && objectDef.name.trim().length > 0
      ? objectDef.name.trim()
      : null;
    for (const block of objectDef.blocks ?? []) {
      visitIniBlock(block, objectName, usageByType);
    }
  }

  return [...usageByType.values()]
    .map((usage) => ({
      moduleType: usage.moduleType,
      count: usage.count,
      blockTypes: [...usage.blockTypes].sort((left, right) => left.localeCompare(right)),
      moduleTags: [...usage.moduleTags].sort((left, right) => left.localeCompare(right)),
      exampleObjectNames: [...usage.exampleObjectNames],
    }))
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType));
}

function stripIndexSourceSaveAdapterSignals(relativePath: string, source: string): string {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (!normalizedPath.endsWith('packages/game-logic/src/index.ts')) {
    return source;
  }

  let stripped = source;
  stripped = stripped.replace(/const SOURCE_[A-Z0-9_]*MODULE_TYPES\s*=\s*new Set\(\[[\s\S]*?\]\);/g, '');
  stripped = stripped.replace(/interface Source[A-Za-z0-9_]*ImportState\s*\{[\s\S]*?\n\}/g, '');

  return stripMethodBodiesMatching(stripped, (methodName) => (
    methodName.startsWith('tryParseSource')
    || methodName.startsWith('applySource')
    || methodName.startsWith('resolveSource')
    || methodName.startsWith('findSource')
    || methodName.startsWith('listSource')
    || methodName.startsWith('xferSourceImport')
    || methodName.startsWith('importSource')
    || methodName.startsWith('restoreSource')
  ));
}

function stripMethodBodiesMatching(source: string, shouldStrip: (methodName: string) => boolean): string {
  const methodRegex = /(?:^|\n)(?:\s*(?:public|private|protected)\s+|\s*\/\*\s*@internal\s*\*\/\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?::[^{;]+)?\{/g;
  const ranges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = methodRegex.exec(source)) !== null) {
    const methodName = match[1] ?? '';
    if (!shouldStrip(methodName)) {
      continue;
    }
    const bodyStart = source.indexOf('{', match.index);
    if (bodyStart < 0) {
      continue;
    }
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd < 0) {
      continue;
    }
    ranges.push({ start: match.index, end: bodyEnd + 1 });
    methodRegex.lastIndex = bodyEnd + 1;
  }

  if (ranges.length === 0) {
    return source;
  }

  let output = '';
  let cursor = 0;
  for (const range of ranges) {
    output += source.slice(cursor, range.start);
    output += '\n';
    cursor = range.end;
  }
  output += source.slice(cursor);
  return output;
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escaping = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function collectRuntimeModuleSignals(
  files: RuntimeSourceFile[],
  moduleTypes: string[],
  options: { stripSourceSaveAdapters?: boolean } = {},
): RuntimeModuleSignal[] {
  const normalizedFiles = files.map((file) => {
    const source = options.stripSourceSaveAdapters
      ? stripIndexSourceSaveAdapterSignals(file.relativePath, file.source)
      : file.source;
    return {
      relativePath: file.relativePath.replace(/\\/g, '/'),
      comparableSource: normalizeComparableSource(source),
    };
  });

  return moduleTypes
    .map((moduleType) => ({
      moduleType,
      files: normalizedFiles
        .filter((file) => file.comparableSource.includes(moduleType))
        .map((file) => file.relativePath)
        .sort((left, right) => left.localeCompare(right)),
    }))
    .filter((signal) => signal.files.length > 0)
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType));
}

function priorityForUsage(count: number): 'P0' | 'P1' | 'P2' | 'P3' {
  if (count >= 100) return 'P0';
  if (count >= 25) return 'P1';
  if (count > 0) return 'P2';
  return 'P3';
}

function rowSort(left: ModuleRuntimeCoverageRow, right: ModuleRuntimeCoverageRow): number {
  return right.iniUsageCount - left.iniUsageCount || left.moduleType.localeCompare(right.moduleType);
}

export function buildModuleRuntimeCoverageReport(params: {
  sourceRegistrations: SourceModuleRegistration[];
  iniUsage: IniModuleUsage[];
  gameplaySignals: RuntimeModuleSignal[];
  broadRuntimeSignals: RuntimeModuleSignal[];
  testSignals: RuntimeModuleSignal[];
  saveCoveredModuleTypes: Set<string>;
  iniBundlePath: string;
  sourceFactoryPaths: string[];
  gameplaySourceRoots: string[];
  testSourceRoots: string[];
  runtimeSaveGamePath: string;
  generatedAt?: string;
}): ModuleRuntimeCoverageReport {
  const sourceByType = new Map(params.sourceRegistrations.map((registration) => [registration.moduleType, registration]));
  const usageByType = new Map(params.iniUsage.map((usage) => [usage.moduleType, usage]));
  const gameplayByType = new Map(params.gameplaySignals.map((signal) => [signal.moduleType, signal]));
  const broadByType = new Map(params.broadRuntimeSignals.map((signal) => [signal.moduleType, signal]));
  const testByType = new Map(params.testSignals.map((signal) => [signal.moduleType, signal]));
  const allModuleTypes = new Set<string>([
    ...sourceByType.keys(),
    ...usageByType.keys(),
  ]);

  const rows = [...allModuleTypes]
    .sort((left, right) => left.localeCompare(right))
    .map((moduleType) => {
      const source = sourceByType.get(moduleType);
      const usage = usageByType.get(moduleType);
      const gameplay = gameplayByType.get(moduleType);
      const broad = broadByType.get(moduleType);
      const test = testByType.get(moduleType);
      return {
        moduleType,
        sourceDeclared: source !== undefined,
        sourceCategories: source?.categories ?? [],
        iniUsageCount: usage?.count ?? 0,
        iniBlockTypes: usage?.blockTypes ?? [],
        exampleObjectNames: usage?.exampleObjectNames ?? [],
        gameplayReferenced: (gameplay?.files.length ?? 0) > 0,
        gameplayReferenceFiles: gameplay?.files ?? [],
        broadRuntimeReferenced: (broad?.files.length ?? 0) > 0,
        broadRuntimeReferenceFiles: broad?.files ?? [],
        testReferenced: (test?.files.length ?? 0) > 0,
        testReferenceFiles: test?.files ?? [],
        saveCovered: params.saveCoveredModuleTypes.has(moduleType),
        priority: priorityForUsage(usage?.count ?? 0),
      } satisfies ModuleRuntimeCoverageRow;
    });

  const sourceIniRows = rows.filter((row) => row.sourceDeclared && row.iniUsageCount > 0);
  const gameplayGaps = sourceIniRows
    .filter((row) => !row.gameplayReferenced)
    .sort(rowSort);
  const saveOnlyOrImportOnlySignals = sourceIniRows
    .filter((row) => !row.gameplayReferenced && (row.saveCovered || row.broadRuntimeReferenced))
    .sort(rowSort);
  const untestedRuntimeSignals = sourceIniRows
    .filter((row) => row.gameplayReferenced && !row.testReferenced)
    .sort(rowSort);
  const iniOnlyModuleTypes = rows
    .filter((row) => !row.sourceDeclared && row.iniUsageCount > 0)
    .sort(rowSort);

  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    status: gameplayGaps.length > 0 ? 'attention' : 'clear',
    inputs: {
      iniBundlePath: params.iniBundlePath,
      sourceFactoryPaths: params.sourceFactoryPaths,
      gameplaySourceRoots: params.gameplaySourceRoots,
      testSourceRoots: params.testSourceRoots,
      runtimeSaveGamePath: params.runtimeSaveGamePath,
    },
    summary: {
      sourceDeclaredModuleTypes: sourceByType.size,
      iniUsedModuleTypes: usageByType.size,
      sourceDeclaredAndIniUsedModuleTypes: sourceIniRows.length,
      gameplayReferencedSourceIniModuleTypes: sourceIniRows.length - gameplayGaps.length,
      sourceIniGameplayGaps: gameplayGaps.length,
      sourceIniSaveOnlyOrImportOnlySignals: saveOnlyOrImportOnlySignals.length,
      sourceIniUntestedRuntimeSignals: untestedRuntimeSignals.length,
      iniOnlyModuleTypes: iniOnlyModuleTypes.length,
    },
    gameplayGaps,
    saveOnlyOrImportOnlySignals,
    untestedRuntimeSignals,
    iniOnlyModuleTypes,
    rows: rows.sort(rowSort),
  };
}

async function readRuntimeSourceFiles(rootDir: string, roots: string[], filter: (relativePath: string) => boolean): Promise<RuntimeSourceFile[]> {
  const files: RuntimeSourceFile[] = [];
  for (const relativeRoot of roots) {
    const absoluteRoot = path.join(rootDir, relativeRoot);
    const discovered = await listFiles(absoluteRoot);
    for (const absolutePath of discovered) {
      const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/');
      if (!filter(relativePath)) {
        continue;
      }
      files.push({
        relativePath,
        source: await fs.readFile(absolutePath, 'utf8'),
      });
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }
  return files;
}

const scriptPath = fileURLToPath(import.meta.url);

export async function runModuleRuntimeCoverageReport(): Promise<void> {
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const iniBundlePath = path.join(rootDir, 'packages/app/public/assets/data/ini-bundle.json');
  const sourceFactoryPaths = [
    path.resolve(rootDir, '..', 'Generals', 'Code/GameEngine/Source/Common/Thing/ModuleFactory.cpp'),
    path.resolve(rootDir, '..', 'GeneralsMD', 'Code/GameEngine/Source/Common/Thing/ModuleFactory.cpp'),
  ];
  const gameplaySourceRoots = [
    'packages/game-logic/src',
    'packages/app/src',
  ];
  const testSourceRoots = [
    'packages/game-logic/src',
    'packages/app/src',
    'tools',
  ];
  const runtimeSaveGamePath = path.join(rootDir, 'packages/app/src/runtime-save-game.ts');
  const outputPath = path.join(rootDir, 'module-runtime-coverage-report.json');

  const iniBundle = JSON.parse(await fs.readFile(iniBundlePath, 'utf8')) as IniBundleShape;
  const sourceRegistrations = (await Promise.all(sourceFactoryPaths.map(async (sourcePath) => (
    parseSourceModuleRegistrations(await fs.readFile(sourcePath, 'utf8'), path.relative(rootDir, sourcePath).replace(/\\/g, '/'))
  )))).flat();
  const mergedRegistrations = mergeSourceModuleRegistrations(sourceRegistrations);
  const iniUsage = collectIniModuleUsage(iniBundle);
  const moduleTypes = [...new Set<string>([
    ...mergedRegistrations.map((registration) => registration.moduleType),
    ...iniUsage.map((usage) => usage.moduleType),
  ])].sort((left, right) => left.localeCompare(right));
  const gameplayFiles = await readRuntimeSourceFiles(rootDir, gameplaySourceRoots, (relativePath) => (
    relativePath.endsWith('.ts')
    && !relativePath.endsWith('.test.ts')
    && !relativePath.endsWith('.spec.ts')
    && !relativePath.endsWith('runtime-save-game.ts')
    && !relativePath.endsWith('runtime-particle-system-save.ts')
    && !relativePath.endsWith('entity-xfer.ts')
  ));
  const broadRuntimeFiles = await readRuntimeSourceFiles(rootDir, gameplaySourceRoots, (relativePath) => (
    relativePath.endsWith('.ts')
    && !relativePath.endsWith('.test.ts')
    && !relativePath.endsWith('.spec.ts')
  ));
  const testFiles = await readRuntimeSourceFiles(rootDir, testSourceRoots, (relativePath) => (
    relativePath.endsWith('.test.ts') || relativePath.endsWith('.spec.ts')
  ));
  const runtimeSaveGameSource = await fs.readFile(runtimeSaveGamePath, 'utf8');

  const report = buildModuleRuntimeCoverageReport({
    sourceRegistrations: mergedRegistrations,
    iniUsage,
    gameplaySignals: collectRuntimeModuleSignals(gameplayFiles, moduleTypes, { stripSourceSaveAdapters: true }),
    broadRuntimeSignals: collectRuntimeModuleSignals(broadRuntimeFiles, moduleTypes),
    testSignals: collectRuntimeModuleSignals(testFiles, moduleTypes),
    saveCoveredModuleTypes: collectGeneratedSourceModuleCoverage(runtimeSaveGameSource),
    iniBundlePath: path.relative(rootDir, iniBundlePath).replace(/\\/g, '/'),
    sourceFactoryPaths: sourceFactoryPaths.map((sourcePath) => path.relative(rootDir, sourcePath).replace(/\\/g, '/')),
    gameplaySourceRoots,
    testSourceRoots,
    runtimeSaveGamePath: path.relative(rootDir, runtimeSaveGamePath).replace(/\\/g, '/'),
  });

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Module runtime coverage: ${report.summary.gameplayReferencedSourceIniModuleTypes}/${report.summary.sourceDeclaredAndIniUsedModuleTypes} source+INI modules have gameplay signals`,
  );
  if (report.gameplayGaps.length > 0) {
    console.log(
      'Top gameplay gaps:',
      report.gameplayGaps.slice(0, 10).map((row) => `${row.moduleType} (${row.iniUsageCount})`).join(', '),
    );
  }

  if (process.argv.includes('--strict') && report.gameplayGaps.length > 0) {
    process.exitCode = 1;
  }
}

function mergeSourceModuleRegistrations(registrations: SourceModuleRegistration[]): SourceModuleRegistration[] {
  const merged = new Map<string, {
    moduleType: string;
    sourceNames: Set<string>;
    categories: Set<string>;
    sourceFiles: Set<string>;
  }>();

  for (const registration of registrations) {
    const existing = merged.get(registration.moduleType) ?? {
      moduleType: registration.moduleType,
      sourceNames: new Set<string>(),
      categories: new Set<string>(),
      sourceFiles: new Set<string>(),
    };
    for (const sourceName of registration.sourceNames) existing.sourceNames.add(sourceName);
    for (const category of registration.categories) existing.categories.add(category);
    for (const sourceFile of registration.sourceFiles) existing.sourceFiles.add(sourceFile);
    merged.set(registration.moduleType, existing);
  }

  return [...merged.values()]
    .map((registration) => ({
      moduleType: registration.moduleType,
      sourceNames: [...registration.sourceNames].sort((left, right) => left.localeCompare(right)),
      categories: [...registration.categories].sort((left, right) => left.localeCompare(right)),
      sourceFiles: [...registration.sourceFiles].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runModuleRuntimeCoverageReport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
