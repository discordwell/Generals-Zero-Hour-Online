#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseManifest, type ConversionManifest, type ManifestEntry } from '@generals/core';

import { parseRuntimeSaveFile } from '../packages/app/src/runtime-save-game.js';

export interface SourceSaveMapAssetCandidate {
  outputPath: string;
  manifestEntry: boolean;
  outputFileExists: boolean;
  sourceFileExists: boolean;
  sourcePath: string | null;
  sourceIsMap: boolean;
  sourceCompatible: boolean;
}

export interface SourceSaveMapAssetRequirement {
  sourceMapPath: string;
  candidateOutputPaths: string[];
  saveFiles: string[];
  status: 'available' | 'missing';
  availableOutputPath: string | null;
  candidates: SourceSaveMapAssetCandidate[];
}

export interface SourceSaveMapAssetParseFailure {
  fileName: string;
  error: string;
}

export interface SourceSaveMapAssetReport {
  generatedAt: string;
  fixturesDir: string;
  assetsDir: string;
  manifestPath: string;
  summary: {
    totalSaveFiles: number;
    parsedSaveFiles: number;
    parseFailedSaveFiles: number;
    embeddedMapSaveFiles: number;
    externalMapSaveFiles: number;
    requiredMapAssets: number;
    availableMapAssets: number;
    missingMapAssets: number;
    blockedSaveFiles: number;
  };
  requiredMaps: SourceSaveMapAssetRequirement[];
  parseFailures: SourceSaveMapAssetParseFailure[];
}

interface CliArgs {
  readonly fixturesDir: string;
  readonly assetsDir: string;
  readonly manifestPath: string;
  readonly outputPath: string;
}

interface SourceSaveMapInput {
  readonly fileName: string;
  readonly hasEmbeddedMapData: boolean;
  readonly sourceMapPath: string | null;
  readonly candidateOutputPaths: readonly string[];
}

interface ReportInput {
  readonly fixturesDir: string;
  readonly assetsDir: string;
  readonly manifestPath: string;
  readonly manifest: ConversionManifest | null;
  readonly saves: readonly SourceSaveMapInput[];
  readonly parseFailures: readonly SourceSaveMapAssetParseFailure[];
  readonly now?: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BROWSER_PORT_ROOT = resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = resolve(BROWSER_PORT_ROOT, '..');

function usage(): string {
  return [
    'Usage: tsx tools/source-save-map-asset-report.ts [options]',
    '',
    'Options:',
    '  --fixtures <dir>   Source save fixture directory. Default: fixtures/source-saves',
    '  --assets <dir>     Runtime assets directory. Default: dist/assets',
    '  --manifest <file>  Runtime manifest path. Default: <assets>/manifest.json',
    '  --out <file>       Report output path. Default: source-save-map-asset-report.json',
    '  --help            Show this help.',
  ].join('\n');
}

function resolvePath(pathValue: string): string {
  return resolve(process.cwd(), pathValue);
}

function parseArgs(argv: readonly string[]): CliArgs {
  let fixturesDir = 'fixtures/source-saves';
  let assetsDir = 'dist/assets';
  let manifestPath: string | null = null;
  let outputPath = 'source-save-map-asset-report.json';

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--fixtures':
        fixturesDir = argv[++index] ?? fixturesDir;
        break;
      case '--assets':
        assetsDir = argv[++index] ?? assetsDir;
        break;
      case '--manifest':
        manifestPath = argv[++index] ?? manifestPath;
        break;
      case '--out':
        outputPath = argv[++index] ?? outputPath;
        break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${String(arg)}\n${usage()}`);
    }
  }

  const resolvedAssetsDir = resolvePath(assetsDir);
  return {
    fixturesDir: resolvePath(fixturesDir),
    assetsDir: resolvedAssetsDir,
    manifestPath: resolvePath(manifestPath ?? join(resolvedAssetsDir, 'manifest.json')),
    outputPath: resolvePath(outputPath),
  };
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeManifestPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeSourceMapPath(pathValue: string | null | undefined): string | null {
  const normalized = pathValue?.trim().replace(/\\/g, '/').replace(/^\/+/, '') ?? '';
  return normalized && /\.map$/i.test(normalized) ? normalized : null;
}

function normalizeCandidateOutputPath(pathValue: string | null | undefined): string | null {
  const normalized = pathValue?.trim().replace(/\\/g, '/').replace(/^\/+/, '') ?? '';
  return normalized && /\.json$/i.test(normalized) ? normalized : null;
}

function resolveManifestSourcePath(sourcePath: string, assetsDir: string): string {
  const normalizedSourcePath = normalizeManifestPath(sourcePath);
  const assetRelativePath = resolve(assetsDir, normalizedSourcePath);
  if (existsSync(assetRelativePath)) {
    return assetRelativePath;
  }

  const workspaceRelativePath = resolve(WORKSPACE_ROOT, normalizedSourcePath);
  if (existsSync(workspaceRelativePath)) {
    return workspaceRelativePath;
  }

  return assetRelativePath;
}

function getManifestEntry(manifest: ConversionManifest | null, outputPath: string): ManifestEntry | null {
  if (!manifest) {
    return null;
  }
  const normalized = normalizeManifestPath(outputPath).toLowerCase();
  return manifest.entries.find((entry) => normalizeManifestPath(entry.outputPath).toLowerCase() === normalized) ?? null;
}

function buildCandidate(
  outputPath: string,
  manifest: ConversionManifest | null,
  assetsDir: string,
): SourceSaveMapAssetCandidate {
  const manifestEntry = getManifestEntry(manifest, outputPath);
  const normalizedOutputPath = normalizeManifestPath(manifestEntry?.outputPath ?? outputPath);
  const outputFileExists = existsSync(resolve(assetsDir, normalizedOutputPath));
  const sourcePath = manifestEntry?.sourcePath ?? null;
  const sourceIsMap = sourcePath !== null && /\.map$/i.test(sourcePath);
  const sourceFileExists = sourcePath !== null && existsSync(resolveManifestSourcePath(sourcePath, assetsDir));
  return {
    outputPath: normalizedOutputPath,
    manifestEntry: manifestEntry !== null,
    outputFileExists,
    sourceFileExists,
    sourcePath,
    sourceIsMap,
    sourceCompatible: manifestEntry !== null && outputFileExists && sourceIsMap,
  };
}

export function buildSourceSaveMapAssetReport(input: ReportInput): SourceSaveMapAssetReport {
  const requiredBySourcePath = new Map<string, {
    candidateOutputPaths: Set<string>;
    saveFiles: string[];
  }>();
  let embeddedMapSaveFiles = 0;
  let externalMapSaveFiles = 0;

  for (const save of input.saves) {
    if (save.hasEmbeddedMapData) {
      embeddedMapSaveFiles += 1;
      continue;
    }

    const sourceMapPath = normalizeSourceMapPath(save.sourceMapPath);
    const candidateOutputPaths = save.candidateOutputPaths
      .map((candidate) => normalizeCandidateOutputPath(candidate))
      .filter((candidate): candidate is string => candidate !== null);
    if (!sourceMapPath || candidateOutputPaths.length === 0) {
      continue;
    }

    externalMapSaveFiles += 1;
    const existing = requiredBySourcePath.get(sourceMapPath);
    if (existing) {
      existing.saveFiles.push(save.fileName);
      for (const candidate of candidateOutputPaths) {
        existing.candidateOutputPaths.add(candidate);
      }
      continue;
    }

    requiredBySourcePath.set(sourceMapPath, {
      candidateOutputPaths: new Set(candidateOutputPaths),
      saveFiles: [save.fileName],
    });
  }

  const requiredMaps: SourceSaveMapAssetRequirement[] = [...requiredBySourcePath.entries()]
    .map(([sourceMapPath, required]) => {
      const candidateOutputPaths = [...required.candidateOutputPaths].sort((left, right) => left.localeCompare(right));
      const candidates = candidateOutputPaths.map((candidate) =>
        buildCandidate(candidate, input.manifest, input.assetsDir));
      const availableCandidate = candidates.find((candidate) => candidate.sourceCompatible) ?? null;
      return {
        sourceMapPath,
        candidateOutputPaths,
        saveFiles: [...required.saveFiles].sort((left, right) => left.localeCompare(right)),
        status: availableCandidate ? 'available' as const : 'missing' as const,
        availableOutputPath: availableCandidate?.outputPath ?? null,
        candidates,
      };
    })
    .sort((left, right) => left.sourceMapPath.localeCompare(right.sourceMapPath));

  const missingMaps = requiredMaps.filter((requirement) => requirement.status === 'missing');
  const blockedSaveFiles = new Set<string>();
  for (const requirement of missingMaps) {
    for (const fileName of requirement.saveFiles) {
      blockedSaveFiles.add(fileName);
    }
  }
  for (const failure of input.parseFailures) {
    blockedSaveFiles.add(failure.fileName);
  }

  return {
    generatedAt: input.now ?? new Date().toISOString(),
    fixturesDir: input.fixturesDir,
    assetsDir: input.assetsDir,
    manifestPath: input.manifestPath,
    summary: {
      totalSaveFiles: input.saves.length + input.parseFailures.length,
      parsedSaveFiles: input.saves.length,
      parseFailedSaveFiles: input.parseFailures.length,
      embeddedMapSaveFiles,
      externalMapSaveFiles,
      requiredMapAssets: requiredMaps.length,
      availableMapAssets: requiredMaps.length - missingMaps.length,
      missingMapAssets: missingMaps.length,
      blockedSaveFiles: blockedSaveFiles.size,
    },
    requiredMaps,
    parseFailures: [...input.parseFailures],
  };
}

function loadManifestOrNull(manifestPath: string): ConversionManifest | null {
  if (!existsSync(manifestPath)) {
    return null;
  }
  return parseManifest(readFileSync(manifestPath, 'utf8'));
}

function collectSourceSaveInputs(fixturesDir: string): {
  saves: SourceSaveMapInput[];
  parseFailures: SourceSaveMapAssetParseFailure[];
} {
  if (!existsSync(fixturesDir)) {
    throw new Error(`Source save fixture directory does not exist: ${fixturesDir}`);
  }

  const saves: SourceSaveMapInput[] = [];
  const parseFailures: SourceSaveMapAssetParseFailure[] = [];
  const fixtureNames = readdirSync(fixturesDir)
    .filter((name) => /\.(?:sav|save)$/i.test(name))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of fixtureNames) {
    const fixturePath = join(fixturesDir, fileName);
    try {
      const bytes = readFileSync(fixturePath);
      const parsed = parseRuntimeSaveFile(copyBytesToArrayBuffer(bytes));
      saves.push({
        fileName,
        hasEmbeddedMapData: parsed.mapData !== null,
        sourceMapPath: normalizeSourceMapPath(
          parsed.metadata.missionMapName
          || parsed.sourcePristineMapPath
          || parsed.sourceSaveGameMapPath,
        ),
        candidateOutputPaths: parsed.mapPathCandidates,
      });
    } catch (error) {
      parseFailures.push({
        fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { saves, parseFailures };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const manifest = loadManifestOrNull(args.manifestPath);
  const { saves, parseFailures } = collectSourceSaveInputs(args.fixturesDir);
  const report = buildSourceSaveMapAssetReport({
    fixturesDir: args.fixturesDir,
    assetsDir: args.assetsDir,
    manifestPath: args.manifestPath,
    manifest,
    saves,
    parseFailures,
  });

  writeFileSync(args.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Source save map asset report written: ${relative(process.cwd(), args.outputPath)}`);
  console.table({
    totalSaveFiles: report.summary.totalSaveFiles,
    externalMapSaveFiles: report.summary.externalMapSaveFiles,
    requiredMapAssets: report.summary.requiredMapAssets,
    availableMapAssets: report.summary.availableMapAssets,
    missingMapAssets: report.summary.missingMapAssets,
    blockedSaveFiles: report.summary.blockedSaveFiles,
  });
  if (report.summary.missingMapAssets > 0) {
    console.log('Missing source-save map assets:');
    for (const missing of report.requiredMaps.filter((requirement) => requirement.status === 'missing')) {
      console.log(`  ${missing.sourceMapPath} (${missing.saveFiles.length} save fixtures)`);
    }
  }
}

const executedScriptPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);
if (executedScriptPath === currentScriptPath) {
  await main();
}
