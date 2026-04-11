import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface IniBlockShape {
  type?: unknown;
  name?: unknown;
  blocks?: IniBlockShape[];
}

interface IniObjectShape {
  name?: unknown;
  blocks?: IniBlockShape[];
}

interface IniBundleShape {
  objects?: IniObjectShape[];
}

export interface SourceObjectModuleTypeUsage {
  moduleType: string;
  count: number;
  exampleObjectName: string | null;
}

export interface SaveGeneratedModuleCoverageReport {
  generatedAt: string;
  iniBundlePath: string;
  runtimeSaveGamePath: string;
  totalSourceModuleTypes: number;
  coveredSourceModuleTypes: number;
  missingSourceModuleTypes: SourceObjectModuleTypeUsage[];
}

const GENERATED_SAVE_MODULE_BLOCK_TYPES = new Set(['BODY', 'BEHAVIOR', 'DRAW', 'CLIENTUPDATE']);

function normalizeModuleType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function visitIniBlock(
  block: IniBlockShape,
  objectName: string | null,
  usageByType: Map<string, SourceObjectModuleTypeUsage>,
): void {
  for (const child of block.blocks ?? []) {
    visitIniBlock(child, objectName, usageByType);
  }

  const blockType = normalizeModuleType(block.type);
  if (!GENERATED_SAVE_MODULE_BLOCK_TYPES.has(blockType)) {
    return;
  }

  const tokens = typeof block.name === 'string'
    ? block.name.split(/\s+/).map((token) => token.trim()).filter(Boolean)
    : [];
  const moduleType = normalizeModuleType(tokens[0] ?? '');
  const moduleTag = tokens.find((token) => token.toUpperCase().startsWith('MODULETAG_')) ?? '';
  if (!moduleType || !moduleTag) {
    return;
  }

  const existing = usageByType.get(moduleType);
  if (existing) {
    existing.count += 1;
    return;
  }

  usageByType.set(moduleType, {
    moduleType,
    count: 1,
    exampleObjectName: objectName,
  });
}

export function collectSourceObjectModuleTypeUsage(iniBundle: IniBundleShape): SourceObjectModuleTypeUsage[] {
  const usageByType = new Map<string, SourceObjectModuleTypeUsage>();
  for (const objectDef of iniBundle.objects ?? []) {
    const objectName = typeof objectDef.name === 'string' && objectDef.name.trim().length > 0
      ? objectDef.name.trim()
      : null;
    for (const block of objectDef.blocks ?? []) {
      visitIniBlock(block, objectName, usageByType);
    }
  }
  return [...usageByType.values()].sort((left, right) => left.moduleType.localeCompare(right.moduleType));
}

export function collectGeneratedSourceModuleCoverage(runtimeSaveGameSource: string): Set<string> {
  const covered = new Set<string>();

  for (const match of runtimeSaveGameSource.matchAll(/normalizedModuleType === '([^']+)'/g)) {
    covered.add(match[1]!.trim().toUpperCase());
  }

  for (const setMatch of runtimeSaveGameSource.matchAll(
    /const SOURCE_[A-Z0-9_]*MODULE_TYPES = new Set\(\[([\s\S]*?)\]\);/g,
  )) {
    for (const moduleMatch of setMatch[1]!.matchAll(/'([^']+)'/g)) {
      covered.add(moduleMatch[1]!.trim().toUpperCase());
    }
  }

  for (const range of [
    /function normalizeSourceBodyModuleKind[\s\S]*?\n\s*}\n\s*\n\s*interface SourceSpecialPowerModuleBlockState/,
    /function normalizeSourceContainModuleKind[\s\S]*?\n\s*}\n\s*\n\s*function xferSourceOpenContain/,
  ]) {
    const match = runtimeSaveGameSource.match(range);
    if (!match) {
      continue;
    }
    for (const caseMatch of match[0].matchAll(/case '([^']+)'/g)) {
      covered.add(caseMatch[1]!.trim().toUpperCase());
    }
  }

  return covered;
}

export function buildSaveGeneratedModuleCoverageReport(params: {
  iniBundle: IniBundleShape;
  iniBundlePath: string;
  runtimeSaveGameSource: string;
  runtimeSaveGamePath: string;
  generatedAt?: string;
}): SaveGeneratedModuleCoverageReport {
  const sourceModuleTypes = collectSourceObjectModuleTypeUsage(params.iniBundle);
  const covered = collectGeneratedSourceModuleCoverage(params.runtimeSaveGameSource);
  const missingSourceModuleTypes = sourceModuleTypes
    .filter((usage) => !covered.has(usage.moduleType))
    .sort((left, right) => right.count - left.count || left.moduleType.localeCompare(right.moduleType));

  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    iniBundlePath: params.iniBundlePath,
    runtimeSaveGamePath: params.runtimeSaveGamePath,
    totalSourceModuleTypes: sourceModuleTypes.length,
    coveredSourceModuleTypes: sourceModuleTypes.length - missingSourceModuleTypes.length,
    missingSourceModuleTypes,
  };
}

const scriptPath = fileURLToPath(import.meta.url);

export async function runSaveGeneratedModuleCoverageReport(): Promise<void> {
  const rootDir = path.resolve(path.dirname(scriptPath), '..');
  const iniBundlePath = path.join(rootDir, 'packages/app/public/assets/data/ini-bundle.json');
  const runtimeSaveGamePath = path.join(rootDir, 'packages/app/src/runtime-save-game.ts');
  const outputPath = path.join(rootDir, 'save-generated-module-coverage-report.json');

  const iniBundle = JSON.parse(await fs.readFile(iniBundlePath, 'utf8')) as IniBundleShape;
  const runtimeSaveGameSource = await fs.readFile(runtimeSaveGamePath, 'utf8');
  const report = buildSaveGeneratedModuleCoverageReport({
    iniBundle,
    iniBundlePath,
    runtimeSaveGameSource,
    runtimeSaveGamePath,
  });

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Save generated module coverage: ${report.coveredSourceModuleTypes}/${report.totalSourceModuleTypes} covered`,
  );
  if (report.missingSourceModuleTypes.length > 0) {
    console.log(
      'Missing module types:',
      report.missingSourceModuleTypes.map((usage) => usage.moduleType).join(', '),
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runSaveGeneratedModuleCoverageReport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
