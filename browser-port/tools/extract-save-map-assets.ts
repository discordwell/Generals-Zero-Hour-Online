#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createManifest,
  parseManifest,
  serializeManifest,
  type ConversionManifest,
  type ManifestEntry,
} from '@generals/core';

import { parseRuntimeSaveFile } from '../packages/app/src/runtime-save-game.js';
import { BigFileReader, type BigArchive, type BigFileEntry } from './big-extractor/src/BigFileReader.js';
import { parseMapDataJSON } from './map-converter/src/index.js';

interface CliArgs {
  readonly bigPath: string | null;
  readonly fixturesDir: string;
  readonly assetsDir: string;
  readonly manifestPath: string;
  readonly namespace: string;
  readonly dryRun: boolean;
}

interface RequiredMapAsset {
  readonly sourceMapPath: string;
  readonly outputPath: string;
  readonly files: string[];
}

interface ExtractedMapAsset {
  readonly sourceMapPath: string;
  readonly outputPath: string;
  readonly archiveEntryPath: string;
  readonly rawOutputPath: string;
  readonly jsonOutputPath: string;
}

const TOOL_NAME = 'save-map-asset-extractor';
const TOOL_VERSION = '1.0.0';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BROWSER_PORT_ROOT = resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = resolve(BROWSER_PORT_ROOT, '..');

function usage(): string {
  return [
    'Usage: tsx tools/extract-save-map-assets.ts [options]',
    '',
    'Options:',
    '  --big <path>       Classic Generals Maps.big archive. Defaults to retail/installed/Maps.big when present.',
    '  --fixtures <dir>   Source save fixture directory. Default: fixtures/source-saves',
    '  --assets <dir>     Runtime assets directory. Default: dist/assets',
    '  --manifest <file>  Runtime manifest path. Default: <assets>/manifest.json',
    '  --namespace <name> Extraction namespace. Default: Maps',
    '  --dry-run         Report required/missing maps without writing files.',
    '  --help            Show this help.',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliArgs {
  let bigPath: string | null = null;
  let fixturesDir = 'fixtures/source-saves';
  let assetsDir = 'dist/assets';
  let manifestPath: string | null = null;
  let namespace = 'Maps';
  let dryRun = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--big':
        bigPath = argv[++index] ?? null;
        break;
      case '--fixtures':
        fixturesDir = argv[++index] ?? fixturesDir;
        break;
      case '--assets':
        assetsDir = argv[++index] ?? assetsDir;
        break;
      case '--manifest':
        manifestPath = argv[++index] ?? manifestPath;
        break;
      case '--namespace':
        namespace = argv[++index] ?? namespace;
        break;
      case '--dry-run':
        dryRun = true;
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

  const resolvedAssetsDir = resolve(BROWSER_PORT_ROOT, assetsDir);
  return {
    bigPath: bigPath ? resolvePath(bigPath) : null,
    fixturesDir: resolvePath(fixturesDir),
    assetsDir: resolvedAssetsDir,
    manifestPath: resolvePath(manifestPath ?? join(resolvedAssetsDir, 'manifest.json')),
    namespace,
    dryRun,
  };
}

function resolvePath(pathValue: string): string {
  return resolve(process.cwd(), pathValue);
}

function normalizeManifestPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeSourceMapPath(pathValue: string | null | undefined): string | null {
  const normalized = pathValue?.trim().replace(/\\/g, '/').replace(/^\/+/, '') ?? '';
  if (!normalized || !/\.map$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function isClassicGeneralsMapPath(pathValue: string): boolean {
  const leafName = pathValue.split('/').pop()?.replace(/\.map$/i, '') ?? '';
  return /^(?:CHI|GLA|USA)\d{2}$/i.test(leafName) || /^Training\d{2}$/i.test(leafName);
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadManifest(manifestPath: string): ConversionManifest {
  if (!existsSync(manifestPath)) {
    return createManifest();
  }
  const parsed = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (!parsed) {
    throw new Error(`Runtime manifest is malformed: ${manifestPath}`);
  }
  return parsed;
}

function writeManifest(manifest: ConversionManifest, manifestPath: string): void {
  manifest.generatedAt = new Date().toISOString();
  manifest.entryCount = manifest.entries.length;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, serializeManifest(manifest));
}

function upsertManifestEntry(manifest: ConversionManifest, entry: ManifestEntry): void {
  manifest.entries = manifest.entries.filter((existing) => existing.outputPath !== entry.outputPath);
  manifest.entries.push(entry);
  manifest.entryCount = manifest.entries.length;
}

function sourcePathForManifest(filePath: string, assetsDir: string): string {
  const absolute = resolve(filePath);
  const relativeToAssets = normalizeManifestPath(relative(assetsDir, absolute));
  if (!relativeToAssets.startsWith('..')) {
    return relativeToAssets;
  }
  const relativeToWorkspace = normalizeManifestPath(relative(WORKSPACE_ROOT, absolute));
  return relativeToWorkspace.startsWith('..')
    ? normalizeManifestPath(absolute)
    : relativeToWorkspace;
}

function findDefaultBigPath(): string | null {
  const candidates = [
    join(WORKSPACE_ROOT, 'retail', 'installed', 'Maps.big'),
    join(BROWSER_PORT_ROOT, 'retail', 'installed', 'Maps.big'),
    join(process.cwd(), 'Maps.big'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectRequiredClassicMaps(fixturesDir: string): RequiredMapAsset[] {
  if (!existsSync(fixturesDir)) {
    throw new Error(`Source save fixture directory does not exist: ${fixturesDir}`);
  }

  const requiredBySourcePath = new Map<string, RequiredMapAsset>();
  const fixtureNames = readdirSync(fixturesDir)
    .filter((name) => /\.(?:sav|save)$/i.test(name))
    .sort((left, right) => left.localeCompare(right));

  for (const fixtureName of fixtureNames) {
    const fixturePath = join(fixturesDir, fixtureName);
    const fileBytes = readFileSync(fixturePath);
    const parsed = parseRuntimeSaveFile(copyBytesToArrayBuffer(fileBytes));
    if (parsed.mapData) {
      continue;
    }
    const sourceMapPath = normalizeSourceMapPath(
      parsed.metadata.missionMapName
      || parsed.sourcePristineMapPath
      || parsed.sourceSaveGameMapPath,
    );
    if (!sourceMapPath || !isClassicGeneralsMapPath(sourceMapPath)) {
      continue;
    }
    const outputPath = parsed.mapPathCandidates[0] ?? parsed.mapPath;
    if (!outputPath) {
      continue;
    }
    const existing = requiredBySourcePath.get(sourceMapPath);
    if (existing) {
      existing.files.push(fixtureName);
      continue;
    }
    requiredBySourcePath.set(sourceMapPath, {
      sourceMapPath,
      outputPath,
      files: [fixtureName],
    });
  }

  return [...requiredBySourcePath.values()].sort((left, right) =>
    left.sourceMapPath.localeCompare(right.sourceMapPath));
}

function findArchiveEntry(archive: BigArchive, sourceMapPath: string): BigFileEntry | null {
  const normalized = sourceMapPath.toLowerCase();
  return archive.entries.find((entry) => entry.path.toLowerCase() === normalized) ?? null;
}

function extractRequiredMaps(args: CliArgs, requiredMaps: readonly RequiredMapAsset[]): ExtractedMapAsset[] {
  const bigPath = args.bigPath ?? findDefaultBigPath();
  if (!bigPath) {
    throw new Error(
      'Classic Generals Maps.big was not found. Provide it with --big <path> or place it at retail/installed/Maps.big.',
    );
  }
  if (!existsSync(bigPath)) {
    throw new Error(`Classic Generals Maps.big does not exist: ${bigPath}`);
  }

  const bigBytes = readFileSync(bigPath);
  const archiveBuffer = copyBytesToArrayBuffer(bigBytes);
  const archive = BigFileReader.parse(archiveBuffer);
  const manifest = loadManifest(args.manifestPath);
  const timestamp = new Date().toISOString();
  const extracted: ExtractedMapAsset[] = [];
  const missing: RequiredMapAsset[] = [];

  for (const requiredMap of requiredMaps) {
    const entry = findArchiveEntry(archive, requiredMap.sourceMapPath);
    if (!entry) {
      missing.push(requiredMap);
      continue;
    }

    const rawBytes = BigFileReader.extractFile(archiveBuffer, entry);
    const mapData = parseMapDataJSON(copyBytesToArrayBuffer(rawBytes));
    const jsonBytes = new TextEncoder().encode(JSON.stringify(mapData, null, 2) + '\n');
    const rawOutputPath = join(args.assetsDir, '_extracted', args.namespace, entry.path);
    const jsonOutputPath = join(args.assetsDir, requiredMap.outputPath);

    if (!args.dryRun) {
      mkdirSync(dirname(rawOutputPath), { recursive: true });
      writeFileSync(rawOutputPath, rawBytes);
      mkdirSync(dirname(jsonOutputPath), { recursive: true });
      writeFileSync(jsonOutputPath, jsonBytes);
      upsertManifestEntry(manifest, {
        sourcePath: sourcePathForManifest(rawOutputPath, args.assetsDir),
        sourceHash: sha256(rawBytes),
        outputPath: normalizeManifestPath(relative(args.assetsDir, jsonOutputPath)),
        outputHash: sha256(jsonBytes),
        converter: TOOL_NAME,
        converterVersion: TOOL_VERSION,
        timestamp,
      });
    }

    extracted.push({
      sourceMapPath: requiredMap.sourceMapPath,
      outputPath: requiredMap.outputPath,
      archiveEntryPath: entry.path,
      rawOutputPath,
      jsonOutputPath,
    });
  }

  if (!args.dryRun) {
    writeManifest(manifest, args.manifestPath);
  }

  if (missing.length > 0) {
    throw new Error([
      `Maps.big is missing ${missing.length} required classic campaign map(s):`,
      ...missing.map((entry) => `  ${entry.sourceMapPath}`),
    ].join('\n'));
  }

  return extracted;
}

function main(): void {
  const args = parseArgs(process.argv);
  const requiredMaps = collectRequiredClassicMaps(args.fixturesDir);
  console.log(`Required classic campaign maps from source saves: ${requiredMaps.length}`);
  for (const requiredMap of requiredMaps) {
    console.log(`  ${requiredMap.sourceMapPath} -> ${requiredMap.outputPath} (${requiredMap.files.length} save fixtures)`);
  }

  const extracted = extractRequiredMaps(args, requiredMaps);
  console.log(args.dryRun ? 'Dry run completed.' : `Extracted and converted ${extracted.length} map asset(s).`);
  if (!args.dryRun) {
    console.log(`Manifest updated: ${args.manifestPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
