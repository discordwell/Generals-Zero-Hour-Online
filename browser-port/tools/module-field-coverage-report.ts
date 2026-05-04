import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseSourceModuleRegistrations,
  type SourceModuleRegistration,
  type RuntimeSourceFile,
} from './module-runtime-coverage-report.js';

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

interface SourceCppFile {
  relativePath: string;
  source: string;
}

interface ClassFieldParseEntry {
  className: string;
  directFieldNames: string[];
  dependencies: string[];
  parentClassName: string | null;
  sourceFiles: string[];
}

export interface SourceModuleFieldParseIndex {
  classFieldParses: ClassFieldParseEntry[];
  moduleDataByModuleClass: Array<{ moduleClassName: string; dataClassName: string; sourceFiles: string[] }>;
  classParents: Array<{ className: string; parentClassName: string | null }>;
}

export interface SourceModuleFieldDescriptor {
  moduleType: string;
  sourceNames: string[];
  dataClasses: string[];
  fieldNames: string[];
  directFieldNames: string[];
  inheritedFieldNames: string[];
  sourceFiles: string[];
  unresolvedDataClasses: string[];
}

export interface IniModuleFieldUsage {
  moduleType: string;
  fieldName: string;
  count: number;
  blockTypes: string[];
  moduleTags: string[];
  exampleObjectNames: string[];
}

export interface RuntimeFieldSignal {
  fieldName: string;
  files: string[];
}

export interface ModuleFieldCoverageRow {
  moduleType: string;
  fieldName: string;
  normalizedFieldName: string;
  iniUsageCount: number;
  iniBlockTypes: string[];
  moduleTags: string[];
  exampleObjectNames: string[];
  sourceDeclared: boolean;
  sourceKnown: boolean;
  sourceDataClasses: string[];
  sourceFiles: string[];
  gameplayReferenced: boolean;
  gameplayReferenceFiles: string[];
  testReferenced: boolean;
  testReferenceFiles: string[];
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

export interface ModuleFieldCoverageReport {
  generatedAt: string;
  status: 'clear' | 'attention';
  inputs: {
    iniBundlePath: string;
    sourceFactoryPaths: string[];
    sourceCodeRoots: string[];
    gameplaySourceRoots: string[];
    testSourceRoots: string[];
  };
  summary: {
    sourceModuleTypes: number;
    sourceModuleTypesWithParsedFields: number;
    iniUsedModuleFields: number;
    sourceDeclaredIniModuleFields: number;
    sourceKnownIniModuleFields: number;
    sourceKnownGameplayReferencedIniModuleFields: number;
    sourceKnownFieldGaps: number;
    sourceUnknownIniModuleFields: number;
    sourceKnownUntestedRuntimeFields: number;
  };
  sourceKnownFieldGaps: ModuleFieldCoverageRow[];
  sourceUnknownIniModuleFields: ModuleFieldCoverageRow[];
  untestedRuntimeFieldSignals: ModuleFieldCoverageRow[];
  rows: ModuleFieldCoverageRow[];
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

function normalizeFieldName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    : '';
}

function normalizeBlockType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function addNormalizedDisplay(
  target: Map<string, string>,
  value: unknown,
): void {
  if (typeof value !== 'string') {
    return;
  }
  const trimmed = value.trim();
  const normalized = normalizeFieldName(trimmed);
  if (!normalized || normalized === 'NULL') {
    return;
  }
  if (!target.has(normalized)) {
    target.set(normalized, trimmed);
  }
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  let inString: '"' | "'" | null = null;
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
    if (char === '"' || char === "'") {
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

function nearestClassName(source: string, index: number): string | null {
  const prefix = source.slice(0, index);
  const classRegex = /\b(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  let lastClassName: string | null = null;
  while ((match = classRegex.exec(prefix)) !== null) {
    lastClassName = match[1] ?? null;
  }
  return lastClassName;
}

function extractFieldParseEntries(body: string): string[] {
  const fields = new Map<string, string>();
  const fieldRegex = /\{\s*"([^"]+)"\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(body)) !== null) {
    addNormalizedDisplay(fields, match[1]);
  }
  return [...fields.values()].sort((left, right) => left.localeCompare(right));
}

function extractFieldParseDependencies(body: string, className: string): string[] {
  const dependencies = new Set<string>();
  const buildRegex = /\b([A-Za-z_][A-Za-z0-9_]*)::buildFieldParse\s*\(\s*p\s*\)/g;
  const getRegex = /\b([A-Za-z_][A-Za-z0-9_]*)::getFieldParse\s*\(/g;
  for (const regex of [buildRegex, getRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      const dependency = match[1] ?? '';
      if (dependency && dependency !== className) {
        dependencies.add(dependency);
      }
    }
  }
  return [...dependencies].sort((left, right) => left.localeCompare(right));
}

function parseClassParents(source: string): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  const classRegex = /\b(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*public\s+([A-Za-z_][A-Za-z0-9_]*))?/g;
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(source)) !== null) {
    const className = match[1]!;
    const parentClassName = match[2] ?? null;
    if (!parents.has(className) || parentClassName) {
      parents.set(className, parentClassName);
    }
  }
  return parents;
}

function parseModuleDataMacroMappings(source: string, sourceFile: string): Array<{
  moduleClassName: string;
  dataClassName: string;
  sourceFile: string;
}> {
  const mappings: Array<{ moduleClassName: string; dataClassName: string; sourceFile: string }> = [];
  const explicitRegex = /\b(?:MAKE_STANDARD_MODULE_MACRO_WITH_MODULE_DATA|MAKE_STANDARD_MODULE_DATA_MACRO_ABC)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = explicitRegex.exec(source)) !== null) {
    mappings.push({
      moduleClassName: match[1]!,
      dataClassName: match[2]!,
      sourceFile,
    });
  }

  return mappings;
}

function parseFieldParseMethods(source: string, sourceFile: string): ClassFieldParseEntry[] {
  const entries = new Map<string, {
    className: string;
    directFieldNames: Map<string, string>;
    dependencies: Set<string>;
    parentClassName: string | null;
    sourceFiles: Set<string>;
  }>();
  const parentByClass = parseClassParents(source);
  const cleanSource = stripComments(source);

  const methodRegex = /(?:^|\n)\s*(?:(?:static)\s+)?(?:void|const\s+FieldParse\s*\*)\s+(?:(?:([A-Za-z_][A-Za-z0-9_]*)::)?(buildFieldParse|getFieldParse))\s*\([^)]*\)\s*(?:const\s*)?\{/g;
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(cleanSource)) !== null) {
    const className = match[1] ?? nearestClassName(cleanSource, match.index);
    if (!className) {
      continue;
    }
    const bodyStart = cleanSource.indexOf('{', match.index);
    const bodyEnd = bodyStart >= 0 ? findMatchingBrace(cleanSource, bodyStart) : -1;
    if (bodyStart < 0 || bodyEnd < 0) {
      continue;
    }
    const body = cleanSource.slice(bodyStart + 1, bodyEnd);
    const entry = entries.get(className) ?? {
      className,
      directFieldNames: new Map<string, string>(),
      dependencies: new Set<string>(),
      parentClassName: parentByClass.get(className) ?? null,
      sourceFiles: new Set<string>(),
    };
    for (const fieldName of extractFieldParseEntries(body)) {
      addNormalizedDisplay(entry.directFieldNames, fieldName);
    }
    for (const dependency of extractFieldParseDependencies(body, className)) {
      entry.dependencies.add(dependency);
    }
    entry.sourceFiles.add(sourceFile);
    entries.set(className, entry);
    methodRegex.lastIndex = bodyEnd + 1;
  }

  return [...entries.values()].map((entry) => ({
    className: entry.className,
    directFieldNames: [...entry.directFieldNames.values()].sort((left, right) => left.localeCompare(right)),
    dependencies: [...entry.dependencies].sort((left, right) => left.localeCompare(right)),
    parentClassName: entry.parentClassName,
    sourceFiles: [...entry.sourceFiles].sort((left, right) => left.localeCompare(right)),
  }));
}

export function parseSourceModuleFieldParses(files: SourceCppFile[]): SourceModuleFieldParseIndex {
  const classEntries = new Map<string, {
    className: string;
    directFieldNames: Map<string, string>;
    dependencies: Set<string>;
    parentClassName: string | null;
    sourceFiles: Set<string>;
  }>();
  const moduleMappings = new Map<string, {
    moduleClassName: string;
    dataClassName: string;
    sourceFiles: Set<string>;
  }>();
  const parentByClass = new Map<string, string | null>();

  for (const file of files) {
    for (const [className, parentClassName] of parseClassParents(file.source)) {
      if (!parentByClass.has(className) || parentClassName) {
        parentByClass.set(className, parentClassName);
      }
    }
  }

  for (const file of files) {
    for (const entry of parseFieldParseMethods(file.source, file.relativePath)) {
      const existing = classEntries.get(entry.className) ?? {
        className: entry.className,
        directFieldNames: new Map<string, string>(),
        dependencies: new Set<string>(),
        parentClassName: parentByClass.get(entry.className) ?? entry.parentClassName,
        sourceFiles: new Set<string>(),
      };
      for (const fieldName of entry.directFieldNames) {
        addNormalizedDisplay(existing.directFieldNames, fieldName);
      }
      for (const dependency of entry.dependencies) {
        existing.dependencies.add(dependency);
      }
      existing.parentClassName = parentByClass.get(entry.className) ?? existing.parentClassName;
      for (const sourceFile of entry.sourceFiles) {
        existing.sourceFiles.add(sourceFile);
      }
      classEntries.set(entry.className, existing);
    }

    for (const mapping of parseModuleDataMacroMappings(file.source, file.relativePath)) {
      const existing = moduleMappings.get(mapping.moduleClassName) ?? {
        moduleClassName: mapping.moduleClassName,
        dataClassName: mapping.dataClassName,
        sourceFiles: new Set<string>(),
      };
      existing.dataClassName = mapping.dataClassName;
      existing.sourceFiles.add(mapping.sourceFile);
      moduleMappings.set(mapping.moduleClassName, existing);
    }
  }

  for (const [className, parentClassName] of parentByClass) {
    if (classEntries.has(className)) {
      continue;
    }
    classEntries.set(className, {
      className,
      directFieldNames: new Map<string, string>(),
      dependencies: new Set<string>(),
      parentClassName,
      sourceFiles: new Set<string>(),
    });
  }

  return {
    classFieldParses: [...classEntries.values()]
      .map((entry) => ({
        className: entry.className,
        directFieldNames: [...entry.directFieldNames.values()].sort((left, right) => left.localeCompare(right)),
        dependencies: [...entry.dependencies].sort((left, right) => left.localeCompare(right)),
        parentClassName: entry.parentClassName,
        sourceFiles: [...entry.sourceFiles].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.className.localeCompare(right.className)),
    moduleDataByModuleClass: [...moduleMappings.values()]
      .map((mapping) => ({
        moduleClassName: mapping.moduleClassName,
        dataClassName: mapping.dataClassName,
        sourceFiles: [...mapping.sourceFiles].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.moduleClassName.localeCompare(right.moduleClassName)),
    classParents: [...parentByClass.entries()]
      .map(([className, parentClassName]) => ({ className, parentClassName }))
      .sort((left, right) => left.className.localeCompare(right.className)),
  };
}

function collectFieldsForClass(
  entryByClass: Map<string, ClassFieldParseEntry>,
  className: string,
  visiting: Set<string> = new Set(),
): {
  fieldNames: Map<string, string>;
  directFieldNames: Map<string, string>;
  sourceFiles: Set<string>;
  resolved: boolean;
} {
  const result = {
    fieldNames: new Map<string, string>(),
    directFieldNames: new Map<string, string>(),
    sourceFiles: new Set<string>(),
    resolved: false,
  };
  if (visiting.has(className)) {
    return result;
  }
  const entry = entryByClass.get(className);
  if (!entry) {
    return result;
  }
  result.resolved = true;
  visiting.add(className);
  for (const sourceFile of entry.sourceFiles) {
    result.sourceFiles.add(sourceFile);
  }
  for (const fieldName of entry.directFieldNames) {
    addNormalizedDisplay(result.fieldNames, fieldName);
    addNormalizedDisplay(result.directFieldNames, fieldName);
  }
  const dependencies = uniqueSorted([
    ...(entry.parentClassName ? [entry.parentClassName] : []),
    ...entry.dependencies,
  ]);
  for (const dependency of dependencies) {
    const dependencyFields = collectFieldsForClass(entryByClass, dependency, visiting);
    for (const fieldName of dependencyFields.fieldNames.values()) {
      addNormalizedDisplay(result.fieldNames, fieldName);
    }
    for (const sourceFile of dependencyFields.sourceFiles) {
      result.sourceFiles.add(sourceFile);
    }
  }
  visiting.delete(className);
  return result;
}

export function buildSourceModuleFieldDescriptors(
  registrations: SourceModuleRegistration[],
  index: SourceModuleFieldParseIndex,
): SourceModuleFieldDescriptor[] {
  const entryByClass = new Map(index.classFieldParses.map((entry) => [entry.className, entry]));
  const dataClassByModuleClass = new Map(index.moduleDataByModuleClass.map((mapping) => [mapping.moduleClassName, mapping]));
  const parentByClass = new Map(index.classParents.map((entry) => [entry.className, entry.parentClassName]));

  const resolveDataClassMapping = (moduleClassName: string): { dataClassName: string; sourceFiles: string[] } | null => {
    const visited = new Set<string>();
    let currentClassName: string | null = moduleClassName;
    while (currentClassName && !visited.has(currentClassName)) {
      visited.add(currentClassName);
      const mapping = dataClassByModuleClass.get(currentClassName);
      if (mapping) {
        return {
          dataClassName: mapping.dataClassName,
          sourceFiles: mapping.sourceFiles,
        };
      }
      currentClassName = parentByClass.get(currentClassName) ?? null;
    }
    return null;
  };

  return registrations
    .map((registration) => {
      const dataClasses = new Map<string, string>();
      const fieldNames = new Map<string, string>();
      const directFieldNames = new Map<string, string>();
      const sourceFiles = new Set<string>();
      const unresolvedDataClasses = new Set<string>();

      for (const sourceName of registration.sourceNames) {
        const mapping = resolveDataClassMapping(sourceName);
        const dataClassName = mapping?.dataClassName ?? `${sourceName}ModuleData`;
        dataClasses.set(dataClassName, dataClassName);
        for (const sourceFile of mapping?.sourceFiles ?? []) {
          sourceFiles.add(sourceFile);
        }
        const fields = collectFieldsForClass(entryByClass, dataClassName);
        if (!fields.resolved) {
          unresolvedDataClasses.add(dataClassName);
          continue;
        }
        for (const sourceFile of fields.sourceFiles) {
          sourceFiles.add(sourceFile);
        }
        for (const fieldName of fields.fieldNames.values()) {
          addNormalizedDisplay(fieldNames, fieldName);
        }
        for (const fieldName of fields.directFieldNames.values()) {
          addNormalizedDisplay(directFieldNames, fieldName);
        }
      }

      const inheritedFieldNames = new Map<string, string>();
      for (const fieldName of fieldNames.values()) {
        if (!directFieldNames.has(normalizeFieldName(fieldName))) {
          addNormalizedDisplay(inheritedFieldNames, fieldName);
        }
      }

      return {
        moduleType: registration.moduleType,
        sourceNames: registration.sourceNames,
        dataClasses: [...dataClasses.values()].sort((left, right) => left.localeCompare(right)),
        fieldNames: [...fieldNames.values()].sort((left, right) => left.localeCompare(right)),
        directFieldNames: [...directFieldNames.values()].sort((left, right) => left.localeCompare(right)),
        inheritedFieldNames: [...inheritedFieldNames.values()].sort((left, right) => left.localeCompare(right)),
        sourceFiles: [...sourceFiles].sort((left, right) => left.localeCompare(right)),
        unresolvedDataClasses: [...unresolvedDataClasses].sort((left, right) => left.localeCompare(right)),
      } satisfies SourceModuleFieldDescriptor;
    })
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType));
}

function visitIniBlockFields(
  block: IniBlockShape,
  objectName: string | null,
  usageByKey: Map<string, {
    moduleType: string;
    fieldName: string;
    count: number;
    blockTypes: Set<string>;
    moduleTags: Set<string>;
    exampleObjectNames: Set<string>;
  }>,
): void {
  for (const child of block.blocks ?? []) {
    visitIniBlockFields(child, objectName, usageByKey);
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
  const moduleTag = tokens.find((token) => token.toUpperCase().startsWith('MODULETAG_')) ?? '';

  for (const fieldName of Object.keys(block.fields ?? {})) {
    const normalizedFieldName = normalizeFieldName(fieldName);
    if (!normalizedFieldName) {
      continue;
    }
    const key = `${moduleType}:${normalizedFieldName}`;
    const existing = usageByKey.get(key) ?? {
      moduleType,
      fieldName,
      count: 0,
      blockTypes: new Set<string>(),
      moduleTags: new Set<string>(),
      exampleObjectNames: new Set<string>(),
    };
    existing.count += 1;
    existing.blockTypes.add(blockType);
    if (moduleTag) {
      existing.moduleTags.add(moduleTag);
    }
    if (objectName && existing.exampleObjectNames.size < 5) {
      existing.exampleObjectNames.add(objectName);
    }
    usageByKey.set(key, existing);
  }
}

export function collectIniModuleFieldUsage(iniBundle: IniBundleShape): IniModuleFieldUsage[] {
  const usageByKey = new Map<string, {
    moduleType: string;
    fieldName: string;
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
      visitIniBlockFields(block, objectName, usageByKey);
    }
  }

  return [...usageByKey.values()]
    .map((usage) => ({
      moduleType: usage.moduleType,
      fieldName: usage.fieldName,
      count: usage.count,
      blockTypes: [...usage.blockTypes].sort((left, right) => left.localeCompare(right)),
      moduleTags: [...usage.moduleTags].sort((left, right) => left.localeCompare(right)),
      exampleObjectNames: [...usage.exampleObjectNames],
    }))
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType)
      || left.fieldName.localeCompare(right.fieldName));
}

interface RuntimeFieldTokens {
  literal: Set<string>;
  templated: Array<{ prefix: string; suffix: string }>;
}

function extractRuntimeFieldTokens(source: string): RuntimeFieldTokens {
  const cleanSource = stripComments(source);
  const literal = new Set<string>();
  const stringRegex = /(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(cleanSource)) !== null) {
    const value = match[2] ?? '';
    const normalized = normalizeFieldName(value);
    if (normalized) {
      literal.add(normalized);
    }
  }
  const fieldPropertyRegex = /\bfields\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((match = fieldPropertyRegex.exec(cleanSource)) !== null) {
    const normalized = normalizeFieldName(match[1] ?? '');
    if (normalized) {
      literal.add(normalized);
    }
  }
  const objectKeyRegex = /(?:^|[,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  while ((match = objectKeyRegex.exec(cleanSource)) !== null) {
    const normalized = normalizeFieldName(match[1] ?? '');
    if (normalized) {
      literal.add(normalized);
    }
  }
  // Template literals like `Runway${rn}Spaces` — capture the literal prefix and
  // suffix so we can match dynamically-built field names.
  const templateLiteralRegex = /`([^`$]*)\$\{[^}]*\}([^`$]*)`/g;
  const templated: Array<{ prefix: string; suffix: string }> = [];
  while ((match = templateLiteralRegex.exec(cleanSource)) !== null) {
    const prefix = normalizeFieldName(match[1] ?? '');
    const suffix = normalizeFieldName(match[2] ?? '');
    if (prefix.length > 0 || suffix.length > 0) {
      templated.push({ prefix, suffix });
    }
  }
  // Also capture single-quoted strings that look like full field names — already
  // handled above. Pure-literal template strings (no ${...}) are caught by the
  // string regex via the backtick branch.
  const pureBacktickRegex = /`([^`$\\]+)`/g;
  while ((match = pureBacktickRegex.exec(cleanSource)) !== null) {
    const normalized = normalizeFieldName(match[1] ?? '');
    if (normalized) {
      literal.add(normalized);
    }
  }
  return { literal, templated };
}

function fieldMatchesTemplate(
  normalizedFieldName: string,
  templated: ReadonlyArray<{ prefix: string; suffix: string }>,
): boolean {
  for (const { prefix, suffix } of templated) {
    if (normalizedFieldName.length <= prefix.length + suffix.length) {
      continue;
    }
    if (prefix.length > 0 && !normalizedFieldName.startsWith(prefix)) {
      continue;
    }
    if (suffix.length > 0 && !normalizedFieldName.endsWith(suffix)) {
      continue;
    }
    return true;
  }
  return false;
}

export function collectRuntimeFieldSignals(
  files: RuntimeSourceFile[],
  fieldNames: string[],
): RuntimeFieldSignal[] {
  const normalizedFiles = files.map((file) => ({
    relativePath: file.relativePath.replace(/\\/g, '/'),
    tokens: extractRuntimeFieldTokens(file.source),
  }));

  const signals = new Map<string, { fieldName: string; files: string[] }>();
  for (const fieldName of fieldNames) {
    const normalizedFieldName = normalizeFieldName(fieldName);
    if (!normalizedFieldName || signals.has(normalizedFieldName)) {
      continue;
    }
    const filesWithToken = normalizedFiles
      .filter((file) => file.tokens.literal.has(normalizedFieldName)
        || fieldMatchesTemplate(normalizedFieldName, file.tokens.templated))
      .map((file) => file.relativePath)
      .sort((left, right) => left.localeCompare(right));
    if (filesWithToken.length > 0) {
      signals.set(normalizedFieldName, {
        fieldName,
        files: filesWithToken,
      });
    }
  }

  return [...signals.values()].sort((left, right) => left.fieldName.localeCompare(right.fieldName));
}

function priorityForUsage(count: number): 'P0' | 'P1' | 'P2' | 'P3' {
  if (count >= 100) return 'P0';
  if (count >= 25) return 'P1';
  if (count > 0) return 'P2';
  return 'P3';
}

function rowSort(left: ModuleFieldCoverageRow, right: ModuleFieldCoverageRow): number {
  return right.iniUsageCount - left.iniUsageCount
    || left.moduleType.localeCompare(right.moduleType)
    || left.fieldName.localeCompare(right.fieldName);
}

export function buildModuleFieldCoverageReport(params: {
  sourceDescriptors: SourceModuleFieldDescriptor[];
  iniFieldUsage: IniModuleFieldUsage[];
  gameplaySignals: RuntimeFieldSignal[];
  testSignals: RuntimeFieldSignal[];
  iniBundlePath: string;
  sourceFactoryPaths: string[];
  sourceCodeRoots: string[];
  gameplaySourceRoots: string[];
  testSourceRoots: string[];
  generatedAt?: string;
}): ModuleFieldCoverageReport {
  const descriptorByType = new Map(params.sourceDescriptors.map((descriptor) => [descriptor.moduleType, descriptor]));
  const gameplayByField = new Map(params.gameplaySignals.map((signal) => [normalizeFieldName(signal.fieldName), signal]));
  const testByField = new Map(params.testSignals.map((signal) => [normalizeFieldName(signal.fieldName), signal]));

  const rows = params.iniFieldUsage.map((usage) => {
    const descriptor = descriptorByType.get(usage.moduleType);
    const normalizedFieldName = normalizeFieldName(usage.fieldName);
    const sourceFieldNames = new Set((descriptor?.fieldNames ?? []).map(normalizeFieldName));
    const gameplaySignal = gameplayByField.get(normalizedFieldName);
    const testSignal = testByField.get(normalizedFieldName);
    return {
      moduleType: usage.moduleType,
      fieldName: usage.fieldName,
      normalizedFieldName,
      iniUsageCount: usage.count,
      iniBlockTypes: usage.blockTypes,
      moduleTags: usage.moduleTags,
      exampleObjectNames: usage.exampleObjectNames,
      sourceDeclared: descriptor !== undefined,
      sourceKnown: descriptor !== undefined && sourceFieldNames.has(normalizedFieldName),
      sourceDataClasses: descriptor?.dataClasses ?? [],
      sourceFiles: descriptor?.sourceFiles ?? [],
      gameplayReferenced: (gameplaySignal?.files.length ?? 0) > 0,
      gameplayReferenceFiles: gameplaySignal?.files ?? [],
      testReferenced: (testSignal?.files.length ?? 0) > 0,
      testReferenceFiles: testSignal?.files ?? [],
      priority: priorityForUsage(usage.count),
    } satisfies ModuleFieldCoverageRow;
  }).sort(rowSort);

  const sourceDeclaredRows = rows.filter((row) => row.sourceDeclared);
  const sourceKnownRows = sourceDeclaredRows.filter((row) => row.sourceKnown);
  const sourceKnownFieldGaps = sourceKnownRows
    .filter((row) => !row.gameplayReferenced)
    .sort(rowSort);
  const sourceUnknownIniModuleFields = sourceDeclaredRows
    .filter((row) => !row.sourceKnown)
    .sort(rowSort);
  const untestedRuntimeFieldSignals = sourceKnownRows
    .filter((row) => row.gameplayReferenced && !row.testReferenced)
    .sort(rowSort);

  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    status: sourceKnownFieldGaps.length > 0 ? 'attention' : 'clear',
    inputs: {
      iniBundlePath: params.iniBundlePath,
      sourceFactoryPaths: params.sourceFactoryPaths,
      sourceCodeRoots: params.sourceCodeRoots,
      gameplaySourceRoots: params.gameplaySourceRoots,
      testSourceRoots: params.testSourceRoots,
    },
    summary: {
      sourceModuleTypes: params.sourceDescriptors.length,
      sourceModuleTypesWithParsedFields: params.sourceDescriptors.filter((descriptor) => descriptor.fieldNames.length > 0).length,
      iniUsedModuleFields: rows.length,
      sourceDeclaredIniModuleFields: sourceDeclaredRows.length,
      sourceKnownIniModuleFields: sourceKnownRows.length,
      sourceKnownGameplayReferencedIniModuleFields: sourceKnownRows.length - sourceKnownFieldGaps.length,
      sourceKnownFieldGaps: sourceKnownFieldGaps.length,
      sourceUnknownIniModuleFields: sourceUnknownIniModuleFields.length,
      sourceKnownUntestedRuntimeFields: untestedRuntimeFieldSignals.length,
    },
    sourceKnownFieldGaps,
    sourceUnknownIniModuleFields,
    untestedRuntimeFieldSignals,
    rows,
  };
}

async function listFiles(root: string, extensions: Set<string>): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, extensions));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function readRuntimeSourceFiles(
  rootDir: string,
  roots: string[],
  filter: (relativePath: string) => boolean,
): Promise<RuntimeSourceFile[]> {
  const files: RuntimeSourceFile[] = [];
  for (const relativeRoot of roots) {
    const absoluteRoot = path.join(rootDir, relativeRoot);
    const discovered = await listFiles(absoluteRoot, new Set(['.ts']));
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

async function readCppSourceFiles(
  rootDir: string,
  sourceRoots: string[],
): Promise<SourceCppFile[]> {
  const files: SourceCppFile[] = [];
  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.resolve(rootDir, sourceRoot);
    const discovered = await listFiles(absoluteRoot, new Set(['.h', '.cpp']));
    for (const absolutePath of discovered) {
      files.push({
        relativePath: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
        source: await fs.readFile(absolutePath, 'utf8'),
      });
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
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

const scriptPath = fileURLToPath(import.meta.url);

export async function runModuleFieldCoverageReport(): Promise<void> {
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const iniBundlePath = path.join(rootDir, 'packages/app/public/assets/data/ini-bundle.json');
  const sourceFactoryPaths = [
    path.resolve(rootDir, '..', 'Generals', 'Code/GameEngine/Source/Common/Thing/ModuleFactory.cpp'),
    path.resolve(rootDir, '..', 'GeneralsMD', 'Code/GameEngine/Source/Common/Thing/ModuleFactory.cpp'),
  ];
  const sourceCodeRoots = [
    '../Generals/Code/GameEngine',
    '../GeneralsMD/Code/GameEngine',
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
  const outputPath = path.join(rootDir, 'module-field-coverage-report.json');

  const iniBundle = JSON.parse(await fs.readFile(iniBundlePath, 'utf8')) as IniBundleShape;
  const sourceRegistrations = (await Promise.all(sourceFactoryPaths.map(async (sourcePath) => (
    parseSourceModuleRegistrations(await fs.readFile(sourcePath, 'utf8'), path.relative(rootDir, sourcePath).replace(/\\/g, '/'))
  )))).flat();
  const mergedRegistrations = mergeSourceModuleRegistrations(sourceRegistrations);
  const sourceFiles = await readCppSourceFiles(rootDir, sourceCodeRoots);
  const sourceIndex = parseSourceModuleFieldParses(sourceFiles);
  const sourceDescriptors = buildSourceModuleFieldDescriptors(mergedRegistrations, sourceIndex);
  const iniFieldUsage = collectIniModuleFieldUsage(iniBundle);
  const iniFieldNames = uniqueSorted(iniFieldUsage.map((usage) => usage.fieldName));

  const gameplayFiles = await readRuntimeSourceFiles(rootDir, gameplaySourceRoots, (relativePath) => (
    relativePath.endsWith('.ts')
    && !relativePath.endsWith('.test.ts')
    && !relativePath.endsWith('.spec.ts')
    && !relativePath.endsWith('runtime-save-game.ts')
    && !relativePath.endsWith('runtime-particle-system-save.ts')
    && !relativePath.endsWith('entity-xfer.ts')
  ));
  const testFiles = await readRuntimeSourceFiles(rootDir, testSourceRoots, (relativePath) => (
    relativePath.endsWith('.test.ts') || relativePath.endsWith('.spec.ts')
  ));

  const report = buildModuleFieldCoverageReport({
    sourceDescriptors,
    iniFieldUsage,
    gameplaySignals: collectRuntimeFieldSignals(gameplayFiles, iniFieldNames),
    testSignals: collectRuntimeFieldSignals(testFiles, iniFieldNames),
    iniBundlePath: path.relative(rootDir, iniBundlePath).replace(/\\/g, '/'),
    sourceFactoryPaths: sourceFactoryPaths.map((sourcePath) => path.relative(rootDir, sourcePath).replace(/\\/g, '/')),
    sourceCodeRoots,
    gameplaySourceRoots,
    testSourceRoots,
  });

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Module field coverage: ${report.summary.sourceKnownGameplayReferencedIniModuleFields}/${report.summary.sourceKnownIniModuleFields} source-known shipped module fields have TS runtime signals`,
  );
  if (report.sourceKnownFieldGaps.length > 0) {
    console.log(
      'Top source-known field gaps:',
      report.sourceKnownFieldGaps
        .slice(0, 10)
        .map((row) => `${row.moduleType}.${row.fieldName} (${row.iniUsageCount})`)
        .join(', '),
    );
  }
  if (report.sourceUnknownIniModuleFields.length > 0) {
    console.log(
      'Top source-unknown shipped fields:',
      report.sourceUnknownIniModuleFields
        .slice(0, 10)
        .map((row) => `${row.moduleType}.${row.fieldName} (${row.iniUsageCount})`)
        .join(', '),
    );
  }

  if (process.argv.includes('--strict') && report.sourceKnownFieldGaps.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runModuleFieldCoverageReport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
