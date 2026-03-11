#!/usr/bin/env tsx
/**
 * Master asset conversion pipeline for C&C Generals: Zero Hour Browser Port.
 *
 * Reads the original game directory and converts all assets into
 * browser-friendly formats under the app public assets directory.
 *
 * Usage:
 *   npm run convert:all -- --game-dir /path/to/generals
 *
 * Steps:
 *   1. Extract all .big archives → raw files
 *   2. Convert .tga/.dds textures → .rgba (raw RGBA)
 *   3. Convert .w3d models → .glb (glTF binary)
 *   4. Convert .map files → .json (heightmap + objects)
 *   5. Parse .ini files → .json (game data)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addManifestEntry,
  createManifest,
  parseManifest,
  serializeManifest,
  type ConversionManifest,
  type ManifestEntry,
} from '@generals/core';
import { RUNTIME_ASSET_BASE_URL, RUNTIME_MANIFEST_FILE } from '@generals/assets';
import type { IniDataBundle, RegistryStats } from '@generals/ini-data';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PUBLIC_DIR = path.join(PROJECT_ROOT, 'packages', 'app', 'public');
const APP_PUBLIC_ASSETS_DIR = path.join(APP_PUBLIC_DIR, RUNTIME_ASSET_BASE_URL);
const APP_PUBLIC_ASSETS_DISPLAY_PATH = `${path.relative(path.dirname(PROJECT_ROOT), APP_PUBLIC_ASSETS_DIR).replace(/\\/g, '/')}/`;
const TOOLS_DIR = path.join(PROJECT_ROOT, 'tools');
const TOOL_VERSION = '1.0.0';
const RUNTIME_MANIFEST_FILENAME = RUNTIME_MANIFEST_FILE;
const VALID_STEPS = new Set(['big', 'texture', 'w3d', 'map', 'ini', 'csf', 'str', 'audio', 'wnd', 'cursor', 'wak', 'video']);
const DEFAULT_OUTPUT_DIR = APP_PUBLIC_ASSETS_DIR;
const MAP_MAGIC = Buffer.from('CkMp', 'ascii');
const EAR_WRAPPER_MAGIC = Buffer.from('EAR\0', 'ascii');
const MAP_HEADER_SCAN_BYTES = 1024;

// ---------------------------------------------------------------------------
// Path/hash helpers
// ---------------------------------------------------------------------------

function normalizeManifestPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

function sanitizeManifestPathValue(pathValue: string, key: 'sourcePath' | 'outputPath'): string {
  let normalized = normalizeManifestPath(pathValue).replace(/^\/+/, '');
  if (key === 'outputPath') {
    const runtimeBaseLower = RUNTIME_ASSET_BASE_URL.toLowerCase();
    const runtimePrefix = `${runtimeBaseLower}/`;
    const normalizedLower = normalized.toLowerCase();
    if (normalizedLower === runtimeBaseLower) {
      return '';
    }
    if (normalizedLower.startsWith(runtimePrefix)) {
      normalized = normalized.slice(runtimePrefix.length);
    }
  }
  return normalized;
}

function validateManifestPathValue(pathValue: string, key: 'sourcePath' | 'outputPath'): string | null {
  if (pathValue.length === 0) {
    return 'path cannot be empty';
  }

  if (/^[a-z]+:\/\//i.test(pathValue)) {
    return 'path must be relative';
  }

  if (/^[A-Za-z]:($|\/)/.test(pathValue)) {
    return 'path must be relative';
  }

  if (pathValue.includes('\\')) {
    return 'path must use forward slashes';
  }

  if (pathValue.startsWith('/')) {
    return 'path must be relative';
  }

  const segments = pathValue.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return 'path must not contain empty segments';
  }
  if (segments.includes('.')) {
    return 'path must not contain "." segments';
  }
  if (segments.includes('..')) {
    return 'path must not contain ".." segments';
  }

  if (key === 'outputPath') {
    const runtimeBaseLower = RUNTIME_ASSET_BASE_URL.toLowerCase();
    const runtimePrefix = `${runtimeBaseLower}/`;
    const pathValueLower = pathValue.toLowerCase();
    if (pathValueLower === runtimeBaseLower || pathValueLower.startsWith(runtimePrefix)) {
      return `path must be relative to runtime base and must not include "${runtimePrefix}"`;
    }
  }

  return null;
}

function sanitizeLoadedManifest(manifest: ConversionManifest, manifestPath: string): ConversionManifest {
  let rewritten = 0;
  let dropped = 0;
  let deduped = 0;
  const byOutputPath = new Map<string, ManifestEntry>();

  for (const entry of manifest.entries) {
    const sourcePath = sanitizeManifestPathValue(entry.sourcePath, 'sourcePath');
    const outputPath = sanitizeManifestPathValue(entry.outputPath, 'outputPath');

    if (sourcePath !== entry.sourcePath || outputPath !== entry.outputPath) {
      rewritten += 1;
    }

    const sourcePathIssue = validateManifestPathValue(sourcePath, 'sourcePath');
    const outputPathIssue = validateManifestPathValue(outputPath, 'outputPath');
    if (sourcePathIssue || outputPathIssue) {
      dropped += 1;
      continue;
    }

    if (byOutputPath.has(outputPath)) {
      deduped += 1;
    }

    byOutputPath.set(outputPath, {
      ...entry,
      sourcePath,
      outputPath,
    });
  }

  const entries = [...byOutputPath.values()];
  if (rewritten > 0 || dropped > 0 || deduped > 0) {
    console.warn(
      `Normalized existing manifest "${manifestPath}" ` +
      `(rewritten: ${rewritten}, dropped: ${dropped}, deduped: ${deduped}).`,
    );
  }

  return {
    ...manifest,
    entries,
    entryCount: entries.length,
  };
}

function assertManifestPathSafety(manifest: ConversionManifest, manifestPath: string): void {
  for (const entry of manifest.entries) {
    const outputPathIssue = validateManifestPathValue(entry.outputPath, 'outputPath');
    if (outputPathIssue) {
      throw new Error(
        `Refusing to write invalid manifest entry to ${manifestPath}: ` +
        `outputPath "${entry.outputPath}" (${outputPathIssue})`,
      );
    }
    const sourcePathIssue = validateManifestPathValue(entry.sourcePath, 'sourcePath');
    if (sourcePathIssue) {
      throw new Error(
        `Refusing to write invalid manifest entry to ${manifestPath}: ` +
        `sourcePath "${entry.sourcePath}" (${sourcePathIssue})`,
      );
    }
  }
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const rel = path.relative(parentDir, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function removeFilesMatching(dir: string, pattern: RegExp): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!pattern.test(entry.name)) continue;
    fs.rmSync(path.join(dir, entry.name), { force: true });
  }
}

function fileHashHex(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function sourcePathForManifest(sourcePath: string, gameDir: string, outputDir: string): string {
  const absoluteSourcePath = path.resolve(sourcePath);
  const extractedDir = path.join(outputDir, '_extracted');

  if (isPathInside(extractedDir, absoluteSourcePath)) {
    return normalizeManifestPath(path.relative(outputDir, absoluteSourcePath));
  }

  if (isPathInside(gameDir, absoluteSourcePath)) {
    return normalizeManifestPath(path.join('game', path.relative(gameDir, absoluteSourcePath)));
  }

  return normalizeManifestPath(path.relative(PROJECT_ROOT, absoluteSourcePath));
}

function outputPathForManifest(outputPath: string, outputDir: string): string | null {
  const absoluteOutputPath = path.resolve(outputPath);
  if (!isPathInside(outputDir, absoluteOutputPath)) {
    return null;
  }
  return normalizeManifestPath(path.relative(outputDir, absoluteOutputPath));
}

function upsertManifestEntryByOutputPath(manifest: ConversionManifest, entry: ManifestEntry): void {
  // Runtime loading indexes by outputPath, so keep output paths unique in the manifest.
  manifest.entries = manifest.entries.filter((existing) => existing.outputPath !== entry.outputPath);
  addManifestEntry(manifest, entry);
}

function addConvertedFileToManifest(
  manifest: ConversionManifest,
  options: {
    sourcePath: string;
    outputPath: string;
    gameDir: string;
    outputDir: string;
    converter: string;
    timestamp: string;
  },
): void {
  const outputPath = outputPathForManifest(options.outputPath, options.outputDir);
  if (!outputPath) {
    console.warn(`Skipping manifest entry outside output dir: ${options.outputPath}`);
    return;
  }

  if (!fs.existsSync(options.sourcePath) || !fs.existsSync(options.outputPath)) {
    console.warn(`Skipping manifest entry with missing file(s): ${options.sourcePath} -> ${options.outputPath}`);
    return;
  }

  upsertManifestEntryByOutputPath(manifest, {
    sourcePath: sourcePathForManifest(options.sourcePath, options.gameDir, options.outputDir),
    sourceHash: fileHashHex(options.sourcePath),
    outputPath,
    outputHash: fileHashHex(options.outputPath),
    converter: options.converter,
    converterVersion: TOOL_VERSION,
    timestamp: options.timestamp,
  });
}

function loadOrCreateManifest(manifestPath: string): ConversionManifest {
  if (!fs.existsSync(manifestPath)) {
    return createManifest();
  }

  const parsed = parseManifest(fs.readFileSync(manifestPath, 'utf-8'));
  if (!parsed) {
    console.warn(`Existing manifest is invalid JSON/schema, recreating: ${manifestPath}`);
    return createManifest();
  }

  return sanitizeLoadedManifest(parsed, manifestPath);
}

function writeManifest(manifest: ConversionManifest, manifestPath: string): void {
  assertManifestPathSafety(manifest, manifestPath);
  manifest.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, serializeManifest(manifest));
}

function mergeIniManifest(
  target: ConversionManifest,
  manifestPath: string,
  gameDir: string,
  outputDir: string,
): void {
  if (!fs.existsSync(manifestPath)) return;

  const parsed = parseManifest(fs.readFileSync(manifestPath, 'utf-8'));
  if (!parsed) {
    console.warn(`Skipping invalid INI manifest: ${manifestPath}`);
    return;
  }

  for (const entry of parsed.entries) {
    const absoluteOutputPath = path.resolve(PROJECT_ROOT, entry.outputPath);
    const runtimeOutputPath = outputPathForManifest(absoluteOutputPath, outputDir);
    if (!runtimeOutputPath) {
      continue;
    }

    const absoluteSourcePath = path.resolve(PROJECT_ROOT, entry.sourcePath);
    upsertManifestEntryByOutputPath(target, {
      sourcePath: sourcePathForManifest(absoluteSourcePath, gameDir, outputDir),
      sourceHash: entry.sourceHash,
      outputPath: runtimeOutputPath,
      outputHash: entry.outputHash,
      converter: entry.converter,
      converterVersion: entry.converterVersion,
      timestamp: entry.timestamp,
    });
  }
}

function removeManifestEntries(
  manifest: ConversionManifest,
  outputDir: string,
  predicate: (entry: ManifestEntry) => boolean,
): number {
  const removedEntries = manifest.entries.filter(predicate);
  const previousCount = manifest.entries.length;
  manifest.entries = manifest.entries.filter((entry) => !predicate(entry));
  manifest.entryCount = manifest.entries.length;

  for (const entry of removedEntries) {
    const absoluteOutputPath = path.resolve(outputDir, entry.outputPath);
    if (!isPathInside(outputDir, absoluteOutputPath)) {
      continue;
    }
    fs.rmSync(absoluteOutputPath, { force: true });
  }

  return previousCount - manifest.entries.length;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { gameDir: string; outputDir: string; steps: Set<string> } {
  const args = process.argv.slice(2);
  let gameDir = '';
  let outputDir = '';
  const steps = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--game-dir':
        gameDir = args[++i] ?? '';
        break;
      case '--output':
        outputDir = args[++i] ?? '';
        break;
      case '--only':
        for (const s of (args[++i] ?? '').split(',')) {
          steps.add(s.trim());
        }
        break;
      case '--help':
        printUsage();
        process.exit(0);
        break;
    }
  }

  if (!gameDir) {
    console.error('Error: --game-dir is required.\n');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(gameDir)) {
    console.error(`Error: Game directory not found: ${gameDir}`);
    process.exit(1);
  }

  if (!outputDir) {
    outputDir = DEFAULT_OUTPUT_DIR;
  }

  // Default: run all steps
  if (steps.size === 0) {
    for (const step of VALID_STEPS) {
      steps.add(step);
    }
  }

  const unknownSteps = [...steps].filter((step) => !VALID_STEPS.has(step));
  if (unknownSteps.length > 0) {
    console.error(`Error: Unknown step(s) in --only: ${unknownSteps.join(', ')}`);
    console.error(`Valid steps: ${[...VALID_STEPS].join(', ')}`);
    process.exit(1);
  }

  return { gameDir: path.resolve(gameDir), outputDir: path.resolve(outputDir), steps };
}

function printUsage(): void {
  console.log(`
Usage: npm run convert:all -- --game-dir <path> [options]

Options:
  --game-dir <path>   Path to C&C Generals: Zero Hour install directory (required)
  --output <path>     Output directory (default: ${APP_PUBLIC_ASSETS_DISPLAY_PATH})
  --only <steps>      Comma-separated list of steps to run: big,texture,w3d,map,ini,csf,str,audio,wnd,cursor,wak,video
  --help              Show this help message

Examples:
  npm run convert:all -- --game-dir "C:\\Games\\Command and Conquer Generals Zero Hour"
  npm run convert:all -- --game-dir ~/Games/Generals --only big,texture
`.trim());
}

// ---------------------------------------------------------------------------
// File discovery helpers
// ---------------------------------------------------------------------------

interface FindFilesOptions {
  excludeDirNames?: ReadonlySet<string>;
}

function findFiles(dir: string, ext: string, options?: FindFilesOptions): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const excluded = options?.excludeDirNames;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryNameLower = entry.name.toLowerCase();
    if (entry.isDirectory() && excluded?.has(entryNameLower)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext, options));
    } else if (entryNameLower.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function stripLeadingSegment(relPath: string, segment: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const prefix = `${segment.toLowerCase()}/`;
  return normalized.toLowerCase().startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
}

function mapOutputRelativePath(file: string, gameDir: string, extractedDir: string): string {
  const absoluteFilePath = path.resolve(file);

  if (isPathInside(gameDir, absoluteFilePath)) {
    const relativeFromGame = path.relative(gameDir, absoluteFilePath);
    return stripLeadingSegment(relativeFromGame, 'maps');
  }

  if (isPathInside(extractedDir, absoluteFilePath)) {
    // Keep extracted maps namespaced to avoid collisions with game-dir maps.
    return path.join('_extracted', path.relative(extractedDir, absoluteFilePath));
  }

  return path.basename(absoluteFilePath);
}

function hasMapMagic(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.allocUnsafe(4);
      const bytesRead = fs.readSync(fd, header, 0, 4, 0);
      if (bytesRead < 4) {
        return false;
      }

      if (header.equals(MAP_MAGIC)) {
        return true;
      }

      if (!header.equals(EAR_WRAPPER_MAGIC)) {
        return false;
      }

      // Retail map archives can contain EAR-wrapped map payloads where CkMp starts
      // after a short wrapper header.
      const probe = Buffer.allocUnsafe(MAP_HEADER_SCAN_BYTES);
      const probeBytesRead = fs.readSync(fd, probe, 0, MAP_HEADER_SCAN_BYTES, 0);
      if (probeBytesRead < MAP_MAGIC.length) {
        return false;
      }
      return probe.subarray(0, probeBytesRead).indexOf(MAP_MAGIC, EAR_WRAPPER_MAGIC.length) !== -1;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function listGameMapRootCandidates(gameDir: string): string[] {
  const candidates: string[] = [
    path.join(gameDir, 'Maps'),
    path.join(gameDir, 'Data', 'Maps'),
    path.join(gameDir, 'Run', 'Data', 'Maps'),
  ];

  if (hasSourceTreeMarker(gameDir, 'GeneralsMD')) {
    candidates.push(path.join(gameDir, 'GeneralsMD', 'Run', 'Data', 'Maps'));
  }

  if (hasSourceTreeMarker(gameDir, 'Generals')) {
    candidates.push(path.join(gameDir, 'Generals', 'Run', 'Data', 'Maps'));
  }

  return candidates;
}

interface GameIniParseConfig {
  readonly parseDir: string;
  readonly baseDir: string;
}

function hasSourceTreeMarker(gameDir: string, variantDir: 'Generals' | 'GeneralsMD'): boolean {
  return fs.existsSync(path.join(gameDir, variantDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp'));
}

function listRuntimeIniRootCandidates(
  gameDir: string,
  options?: {
    includeLegacyDataRoot?: boolean;
  },
): GameIniParseConfig[] {
  const rootDataIni = path.join(gameDir, 'Data', 'INI');
  const runDataIni = path.join(gameDir, 'Run', 'Data', 'INI');
  const zhSourceRunDataIni = path.join(gameDir, 'GeneralsMD', 'Run', 'Data', 'INI');
  const generalsSourceRunDataIni = path.join(gameDir, 'Generals', 'Run', 'Data', 'INI');
  const legacyDataRoot = path.join(gameDir, 'data');
  const includeLegacyDataRoot = options?.includeLegacyDataRoot ?? true;

  // Source-derived precedence from GameEngine.cpp:
  // - Runtime loads are rooted under Data\\INI\\... (Default + override + Object dir).
  // - Zero Hour source checkouts commonly live under GeneralsMD/Run.
  // - Legacy lower-case data trees are kept as the final fallback for older dumps.
  const candidates: GameIniParseConfig[] = [
    {
      parseDir: rootDataIni,
      baseDir: gameDir,
    },
    {
      parseDir: runDataIni,
      baseDir: path.join(gameDir, 'Run'),
    },
  ];

  if (hasSourceTreeMarker(gameDir, 'GeneralsMD')) {
    candidates.push({
      parseDir: zhSourceRunDataIni,
      baseDir: path.join(gameDir, 'GeneralsMD', 'Run'),
    });
  }

  if (hasSourceTreeMarker(gameDir, 'Generals')) {
    candidates.push({
      parseDir: generalsSourceRunDataIni,
      baseDir: path.join(gameDir, 'Generals', 'Run'),
    });
  }

  if (includeLegacyDataRoot) {
    candidates.push({
      parseDir: legacyDataRoot,
      baseDir: gameDir,
    });
  }

  return candidates;
}

function resolveGameIniParseConfig(gameDir: string): GameIniParseConfig | null {
  const runtimeCandidates = listRuntimeIniRootCandidates(gameDir, { includeLegacyDataRoot: true });
  for (const candidate of runtimeCandidates) {
    if (fs.existsSync(candidate.parseDir)) {
      return candidate;
    }
  }
  return null;
}

function listExtractedIniParseConfigs(extractedDir: string): GameIniParseConfig[] {
  if (!fs.existsSync(extractedDir)) {
    return [];
  }

  const roots = [extractedDir];
  const extractedEntries = fs.readdirSync(extractedDir, { withFileTypes: true });
  for (const entry of extractedEntries) {
    if (entry.isDirectory()) {
      roots.push(path.join(extractedDir, entry.name));
    }
  }

  const configs: GameIniParseConfig[] = [];
  const seenParseDirs = new Set<string>();
  for (const root of roots) {
    const candidates = listRuntimeIniRootCandidates(root, { includeLegacyDataRoot: false });
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate.parseDir)) {
        continue;
      }
      const parseDir = path.resolve(candidate.parseDir);
      if (seenParseDirs.has(parseDir)) {
        continue;
      }
      seenParseDirs.add(parseDir);
      configs.push(candidate);
      break;
    }
  }

  return configs.sort((left, right) => left.parseDir.localeCompare(right.parseDir));
}

// ---------------------------------------------------------------------------
// Step runners
// ---------------------------------------------------------------------------

function runTool(tool: string, args: string[]): boolean {
  const toolPath = path.join(TOOLS_DIR, tool, 'src', 'cli.ts');
  try {
    execFileSync('npx', ['tsx', toolPath, ...args], {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
    });
    return true;
  } catch {
    console.error(`  ⚠ Tool ${tool} failed for args: ${args.join(' ')}`);
    return false;
  }
}

function ensureBundle(value: unknown): value is IniDataBundle {
  if (typeof value !== 'object' || value === null) return false;

  const bundle = value as Partial<IniDataBundle>;
  return (
    Array.isArray(bundle.objects)
    && Array.isArray(bundle.weapons)
    && Array.isArray(bundle.armors)
    && Array.isArray(bundle.upgrades)
    && Array.isArray(bundle.sciences)
    && Array.isArray(bundle.factions)
    && Array.isArray(bundle.errors)
    && Array.isArray(bundle.unsupportedBlockTypes)
    && typeof bundle.stats === 'object'
    && bundle.stats !== null
  );
}

function readBundle(pathToFile: string): IniDataBundle | null {
  if (!fs.existsSync(pathToFile)) return null;

  const text = fs.readFileSync(pathToFile, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return ensureBundle(parsed) ? parsed : null;
}

function mergeByName<T extends { name: string }>(left: T[], right: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of left) {
    byName.set(item.name, item);
  }
  for (const item of right) {
    byName.set(item.name, item);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function combineLists(left: string[], right: string[]): string[] {
  return [...left, ...right].sort();
}

function mergeStats(bundle: IniDataBundle): RegistryStats {
  const locomotorCount = bundle.locomotors?.length ?? 0;
  const commandButtonCount = bundle.commandButtons?.length ?? 0;
  const commandSetCount = bundle.commandSets?.length ?? 0;
  return {
    objects: bundle.objects.length,
    weapons: bundle.weapons.length,
    armors: bundle.armors.length,
    upgrades: bundle.upgrades.length,
    sciences: bundle.sciences.length,
    factions: bundle.factions.length,
    unresolvedInheritance: bundle.errors.filter((entry) => entry.type === 'unresolved_parent').length,
    totalBlocks:
      bundle.objects.length
      + bundle.weapons.length
      + bundle.armors.length
      + bundle.upgrades.length
      + commandButtonCount
      + commandSetCount
      + bundle.sciences.length
      + bundle.factions.length
      + locomotorCount,
  };
}

function mergeBundles(baseBundle: IniDataBundle, patchBundle: IniDataBundle): IniDataBundle {
  const mergedAi = mergeAiConfig(baseBundle.ai, patchBundle.ai);
  const merged: IniDataBundle = {
    objects: mergeByName(baseBundle.objects, patchBundle.objects),
    weapons: mergeByName(baseBundle.weapons, patchBundle.weapons),
    armors: mergeByName(baseBundle.armors, patchBundle.armors),
    upgrades: mergeByName(baseBundle.upgrades, patchBundle.upgrades),
    commandButtons: mergeByName(baseBundle.commandButtons ?? [], patchBundle.commandButtons ?? []),
    commandSets: mergeByName(baseBundle.commandSets ?? [], patchBundle.commandSets ?? []),
    sciences: mergeByName(baseBundle.sciences, patchBundle.sciences),
    factions: mergeByName(baseBundle.factions, patchBundle.factions),
    locomotors: mergeByName(baseBundle.locomotors ?? [], patchBundle.locomotors ?? []),
    errors: [...baseBundle.errors, ...patchBundle.errors],
    unsupportedBlockTypes: combineLists(
      baseBundle.unsupportedBlockTypes,
      patchBundle.unsupportedBlockTypes,
    ),
    ...(mergedAi ? { ai: mergedAi } : {}),
    stats: {
      objects: 0,
      weapons: 0,
      armors: 0,
      upgrades: 0,
      sciences: 0,
      factions: 0,
      unresolvedInheritance: 0,
      totalBlocks: 0,
    },
  };
  merged.stats = mergeStats(merged);
  return merged;
}

function mergeAiConfig(
  baseConfig: IniDataBundle['ai'],
  patchConfig: IniDataBundle['ai'],
): IniDataBundle['ai'] {
  if (!baseConfig && !patchConfig) return undefined;
  return {
    ...(baseConfig ?? {}),
    ...(patchConfig ?? {}),
  };
}

function stepExtractBig(gameDir: string, outputDir: string): void {
  console.log('\n═══ Step 1/5: Extracting .big archives ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const bigFiles = findFiles(gameDir, '.big');
  console.log(`Found ${bigFiles.length} .big archive(s)`);

  let failures = 0;
  for (const bigFile of bigFiles) {
    const baseName = path.basename(bigFile, '.big');
    const outDir = path.join(extractedDir, baseName);
    console.log(`  Extracting: ${path.basename(bigFile)} → ${path.relative(outputDir, outDir)}`);
    const converted = runTool('big-extractor', ['--input', bigFile, '--output', outDir]);
    if (!converted) {
      failures += 1;
    }
  }

  if (failures > 0) {
    throw new Error(`BIG extraction failed for ${failures} archive(s).`);
  }
}

function stepConvertTextures(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Step 2/5: Converting textures ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const textureDir = path.join(outputDir, 'textures');

  const tgaFiles = findFiles(extractedDir, '.tga');
  const ddsFiles = findFiles(extractedDir, '.dds');
  const textureFiles = [...tgaFiles, ...ddsFiles].sort((left, right) => left.localeCompare(right));
  console.log(`Found ${tgaFiles.length} .tga + ${ddsFiles.length} .dds texture(s)`);

  const batchConverted = runTool('texture-converter', ['--input', extractedDir, '--output', textureDir]);

  let failures = 0;
  for (const file of textureFiles) {
    const relPath = path.relative(extractedDir, file);
    const batchOutPath = path.join(textureDir, relPath.replace(/\.(tga|dds)$/i, '.rgba'));
    const normalizedRelPath = stripLeadingSegment(relPath, 'textures');
    const outPath = path.join(textureDir, normalizedRelPath.replace(/\.(tga|dds)$/i, '.rgba'));

    if (!fs.existsSync(outPath) && fs.existsSync(batchOutPath) && batchOutPath !== outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.renameSync(batchOutPath, outPath);
    }

    if (!fs.existsSync(outPath)) {
      failures += 1;
      continue;
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file,
      outputPath: outPath,
      gameDir,
      outputDir,
      converter: 'texture-converter',
      timestamp,
    });
  }

  if (!batchConverted && failures === 0) {
    failures = 1;
  }

  if (failures > 0 || !batchConverted) {
    throw new Error(`Texture conversion failed for ${failures} file(s).`);
  }
}

function stepConvertW3d(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Step 3/5: Converting W3D models ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const modelDir = path.join(outputDir, 'models');

  const w3dFiles = findFiles(extractedDir, '.w3d');
  console.log(`Found ${w3dFiles.length} .w3d model(s)`);

  // Pass --texture-dir so the converter can embed textures in GLBs.
  const textureDir = path.join(outputDir, 'textures');
  const converterArgs = ['--input', extractedDir, '--output', modelDir, '--quiet'];
  if (fs.existsSync(textureDir)) {
    converterArgs.push('--texture-dir', textureDir);
  }
  const batchConverted = runTool('w3d-converter', converterArgs);

  let failures = 0;
  for (const file of w3dFiles) {
    const relPath = path.relative(extractedDir, file);
    const batchOutPath = path.join(modelDir, relPath.replace(/\.w3d$/i, '.glb'));
    const normalizedRelPath = stripLeadingSegment(relPath, 'models');
    const outPath = path.join(modelDir, normalizedRelPath.replace(/\.w3d$/i, '.glb'));

    if (!fs.existsSync(outPath) && fs.existsSync(batchOutPath) && batchOutPath !== outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.renameSync(batchOutPath, outPath);
    }

    if (!fs.existsSync(outPath)) {
      failures += 1;
      continue;
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file,
      outputPath: outPath,
      gameDir,
      outputDir,
      converter: 'w3d-converter',
      timestamp,
    });
  }

  if (!batchConverted && failures === 0) {
    failures = 1;
  }

  if (failures > 0 || !batchConverted) {
    throw new Error(`W3D conversion failed for ${failures} file(s).`);
  }
}

function stepConvertMaps(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Step 4/5: Converting map files ═══\n');
  const mapDir = path.join(outputDir, 'maps');
  const extractedDir = path.join(outputDir, '_extracted');

  // Maps can be in runtime map roots or extracted from .big archives.
  const mapRootCandidates = listGameMapRootCandidates(gameDir);
  const gameMapsFromRoots = mapRootCandidates.flatMap((candidate) => findFiles(candidate, '.map'));
  const extractedMaps = findFiles(extractedDir, '.map');

  // Fallback for unusual layouts: scan gameDir recursively but skip obvious non-game folders.
  const fallbackMapScanExcludes = new Set([
    '.git',
    'browser-port',
    'node_modules',
    'dist',
    'build',
    'out',
    'tmp',
    'temp',
    'temp_downloads',
    'support',
    'miles sound tools',
    'openal',
  ]);
  const gameMaps = gameMapsFromRoots.length > 0
    ? gameMapsFromRoots
    : findFiles(gameDir, '.map', { excludeDirNames: fallbackMapScanExcludes });

  const candidateMaps = [...new Set([...gameMaps, ...extractedMaps])].sort((left, right) => left.localeCompare(right));
  const allMaps = candidateMaps.filter((filePath) => hasMapMagic(filePath));
  const skippedNonMapFiles = candidateMaps.length - allMaps.length;
  console.log(`Found ${allMaps.length} map file(s) with valid CkMp magic`);
  if (skippedNonMapFiles > 0) {
    console.log(`Skipped ${skippedNonMapFiles} non-map *.map files (e.g., source maps).`);
  }

  let failures = 0;
  for (const file of allMaps) {
    const relativeMapPath = mapOutputRelativePath(file, gameDir, extractedDir);
    const outPath = path.join(mapDir, relativeMapPath.replace(/\.map$/i, '.json'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const converted = runTool('map-converter', ['--input', file, '--output', outPath]);
    if (!converted || !fs.existsSync(outPath)) {
      failures += 1;
      continue;
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file,
      outputPath: outPath,
      gameDir,
      outputDir,
      converter: 'map-converter',
      timestamp,
    });
  }

  if (failures > 0) {
    throw new Error(`Map conversion failed for ${failures} file(s).`);
  }
}

function stepParseIni(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Step 5/5: Parsing INI game data ═══\n');
  const iniDir = path.join(outputDir, 'data');
  const extractedDir = path.join(outputDir, '_extracted');
  const manifestDir = path.join(outputDir, 'manifests');
  const iniManifestPath = path.join(manifestDir, 'ini.json');
  const gameManifestPath = path.join(manifestDir, 'ini-game.json');
  const gameBundlePath = path.join(iniDir, 'bundle-game.json');
  const mergedBundlePath = path.join(iniDir, 'ini-bundle.json');
  const extractedBundleDir = path.join(iniDir, '_extracted');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(extractedBundleDir, { recursive: true });
  const iniOnlyManifest = createManifest();
  const staleIniArtifacts = [iniManifestPath, gameManifestPath, gameBundlePath, mergedBundlePath];
  for (const artifactPath of staleIniArtifacts) {
    fs.rmSync(artifactPath, { force: true });
  }
  removeFilesMatching(manifestDir, /^ini-extracted.*\.json$/i);
  removeFilesMatching(extractedBundleDir, /^bundle(?:-.+)?\.json$/i);

  // INI files from game dir and extracted .big
  const gameIniParseConfig = resolveGameIniParseConfig(gameDir);
  const extractedIniParseConfigs = listExtractedIniParseConfigs(extractedDir);
  if (!gameIniParseConfig) {
    console.log('No runtime INI roots detected (Data/INI, Run/Data/INI, GeneralsMD/Run/Data/INI, Generals/Run/Data/INI, data); skipping game-dir INI parse.');
  } else if (gameIniParseConfig.parseDir !== gameDir) {
    console.log(`Using runtime INI root: ${path.relative(gameDir, gameIniParseConfig.parseDir)}`);
  }
  if (extractedIniParseConfigs.length > 0) {
    console.log(
      `Using ${extractedIniParseConfigs.length} extracted runtime INI root(s): ${extractedIniParseConfigs
        .map((config) => path.relative(extractedDir, config.parseDir))
        .join(', ')}`,
    );
  }

  const gameInis = gameIniParseConfig ? findFiles(gameIniParseConfig.parseDir, '.ini') : [];
  const extractedInis = [
    ...new Set(
      extractedIniParseConfigs.flatMap((config) => findFiles(config.parseDir, '.ini')),
    ),
  ];
  const allInis = [...new Set([...gameInis, ...extractedInis])];
  console.log(`Found ${allInis.length} .ini file(s)`);

  if (gameInis.length > 0 && gameIniParseConfig) {
    const converted = runTool('ini-parser', [
      '--dir',
      gameIniParseConfig.parseDir,
      '--output',
      iniDir,
      '--base-dir',
      gameIniParseConfig.baseDir,
      '--allow-parse-errors',
      '--manifest',
      gameManifestPath,
      '--bundle',
      gameBundlePath,
    ]);
    if (!converted) {
      throw new Error('INI parser failed for game directory input.');
    }
  }

  const extractedManifestPaths: string[] = [];
  const extractedBundlePaths: string[] = [];
  if (extractedInis.length > 0) {
    for (const extractedConfig of extractedIniParseConfigs) {
      const relativeParseDir = normalizeManifestPath(path.relative(extractedDir, extractedConfig.parseDir));
      const parseSuffix = relativeParseDir.length > 0 ? relativeParseDir : 'root';
      const parseSlug = parseSuffix.replace(/[^A-Za-z0-9/_-]/g, '_').replace(/[\\/]/g, '-');
      const extractedManifestPath = path.join(manifestDir, `ini-extracted-${parseSlug}.json`);
      const extractedBundlePath = path.join(extractedBundleDir, `bundle-${parseSlug}.json`);
      const extractedOutputDir = path.join(iniDir, '_extracted', parseSuffix);
      const converted = runTool('ini-parser', [
        '--dir',
        extractedConfig.parseDir,
        '--output',
        extractedOutputDir,
        '--base-dir',
        extractedConfig.baseDir,
        '--allow-parse-errors',
        '--manifest',
        extractedManifestPath,
        '--bundle',
        extractedBundlePath,
      ]);
      if (!converted) {
        throw new Error(`INI parser failed for extracted asset input: ${relativeParseDir}`);
      }
      extractedManifestPaths.push(extractedManifestPath);
      extractedBundlePaths.push(extractedBundlePath);
    }
  }

  mergeIniManifest(runtimeManifest, gameManifestPath, gameDir, outputDir);
  mergeIniManifest(iniOnlyManifest, gameManifestPath, gameDir, outputDir);
  for (const extractedManifestPath of extractedManifestPaths) {
    mergeIniManifest(runtimeManifest, extractedManifestPath, gameDir, outputDir);
    mergeIniManifest(iniOnlyManifest, extractedManifestPath, gameDir, outputDir);
  }

  if (allInis.length > 0) {
    const gameBundle = gameInis.length > 0 ? readBundle(gameBundlePath) : null;
    const extractedBundles = extractedBundlePaths
      .map((bundlePath) => readBundle(bundlePath))
      .filter((bundle): bundle is IniDataBundle => bundle !== null);
    let mergedBundle: IniDataBundle | null = null;

    if (gameBundle) {
      mergedBundle = gameBundle;
    }

    for (const extractedBundle of extractedBundles) {
      if (mergedBundle) {
        mergedBundle = mergeBundles(mergedBundle, extractedBundle);
      } else {
        mergedBundle = extractedBundle;
      }
    }

    if (mergedBundle) {
      mergedBundle.stats = mergeStats(mergedBundle);
      const serialized = JSON.stringify(mergedBundle, null, 2) + '\n';
      fs.writeFileSync(mergedBundlePath, serialized);
      const outputHash = sha256Hex(serialized);
      const bundleEntry: ManifestEntry = {
        sourcePath: 'data/ini-bundle.json',
        sourceHash: outputHash,
        outputPath: 'data/ini-bundle.json',
        outputHash,
        converter: 'convert-all',
        converterVersion: TOOL_VERSION,
        timestamp,
      };
      upsertManifestEntryByOutputPath(runtimeManifest, bundleEntry);
      upsertManifestEntryByOutputPath(iniOnlyManifest, bundleEntry);
      console.log(`INI data bundle written to ${mergedBundlePath}`);
    }
  }

  if (allInis.length > 0) {
    writeManifest(iniOnlyManifest, iniManifestPath);
    console.log(`Conversion manifest written to ${iniManifestPath}`);
  }
}

// ---------------------------------------------------------------------------
// New asset converter steps
// ---------------------------------------------------------------------------

function stepConvertCsf(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting CSF localization files ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const locDir = path.join(outputDir, 'localization');

  const csfFiles = findFiles(extractedDir, '.csf');
  console.log(`Found ${csfFiles.length} .csf file(s)`);

  if (csfFiles.length === 0) return;

  const batchConverted = runTool('csf-converter', ['--input', extractedDir, '--output', locDir]);

  let failures = 0;
  for (const file of csfFiles) {
    const relPath = path.relative(extractedDir, file);
    const outPath = path.join(locDir, relPath.replace(/\.csf$/i, '.json'));
    if (!fs.existsSync(outPath)) {
      failures += 1;
      continue;
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file, outputPath: outPath, gameDir, outputDir,
      converter: 'csf-converter', timestamp,
    });
  }

  if (!batchConverted || failures > 0) {
    throw new Error(`CSF conversion failed for ${failures} file(s).`);
  }
}

function stepConvertStr(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting STR localization files ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const locDir = path.join(outputDir, 'localization');

  const strFiles = findFiles(extractedDir, '.str');
  console.log(`Found ${strFiles.length} .str file(s)`);

  if (strFiles.length === 0) return;

  const batchConverted = runTool('str-converter', ['--input', extractedDir, '--output', locDir]);

  let registered = 0;
  for (const file of strFiles) {
    const relPath = path.relative(extractedDir, file);
    const outPath = path.join(locDir, relPath.replace(/\.str$/i, '.str.json'));
    if (!fs.existsSync(outPath)) {
      continue; // empty .str files are skipped, not failures
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file, outputPath: outPath, gameDir, outputDir,
      converter: 'str-converter', timestamp,
    });
    registered += 1;
  }

  if (!batchConverted) {
    throw new Error('STR conversion failed.');
  }
  console.log(`Registered ${registered} non-empty .str conversion(s).`);
}

function stepConvertAudio(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting audio files ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const audioDir = path.join(outputDir, 'audio');

  const wavFiles = findFiles(extractedDir, '.wav');
  const mp3Files = findFiles(extractedDir, '.mp3');
  const audioFiles = [...wavFiles, ...mp3Files].sort();
  console.log(`Found ${wavFiles.length} .wav + ${mp3Files.length} .mp3 file(s)`);

  if (audioFiles.length === 0) return;

  const batchConverted = runTool('audio-converter', ['--input', extractedDir, '--output', audioDir]);

  let registered = 0;
  for (const file of audioFiles) {
    const relPath = path.relative(extractedDir, file);
    const outPath = path.join(audioDir, relPath);
    if (!fs.existsSync(outPath)) continue;
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file, outputPath: outPath, gameDir, outputDir,
      converter: 'audio-converter', timestamp,
    });
    registered += 1;
  }

  if (!batchConverted) {
    throw new Error('Audio conversion failed.');
  }
  console.log(`Registered ${registered} audio file(s).`);
}

function stepConvertWnd(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting WND UI layout files ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const windowsDir = path.join(outputDir, 'windows');

  const wndFiles = findFiles(extractedDir, '.wnd');
  console.log(`Found ${wndFiles.length} .wnd file(s)`);

  if (wndFiles.length === 0) return;

  const batchConverted = runTool('wnd-converter', ['--input', extractedDir, '--output', windowsDir]);

  let failures = 0;
  for (const file of wndFiles) {
    const relPath = path.relative(extractedDir, file);
    const outPath = path.join(windowsDir, relPath.replace(/\.wnd$/i, '.json'));
    if (!fs.existsSync(outPath)) {
      failures += 1;
      continue;
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file, outputPath: outPath, gameDir, outputDir,
      converter: 'wnd-converter', timestamp,
    });
  }

  if (!batchConverted || failures > 0) {
    throw new Error(`WND conversion failed for ${failures} file(s).`);
  }
}

function stepConvertCursors(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting ANI cursor files ═══\n');
  const cursorDir = path.join(outputDir, 'cursors');

  // ANI files are in the retail install dir, not in .big archives
  const aniFiles = findFiles(gameDir, '.ani');
  console.log(`Found ${aniFiles.length} .ani file(s)`);

  if (aniFiles.length === 0) return;

  const batchConverted = runTool('cursor-converter', ['--input', gameDir, '--output', cursorDir]);

  let registered = 0;
  for (const file of aniFiles) {
    const relPath = path.relative(gameDir, file);
    const baseName = relPath.replace(/\.ani$/i, '');
    const jsonPath = path.join(cursorDir, baseName + '.json');
    const rgbaPath = path.join(cursorDir, baseName + '_frames.rgba');
    if (fs.existsSync(jsonPath)) {
      addConvertedFileToManifest(runtimeManifest, {
        sourcePath: file, outputPath: jsonPath, gameDir, outputDir,
        converter: 'cursor-converter', timestamp,
      });
      registered += 1;
    }
    if (fs.existsSync(rgbaPath)) {
      addConvertedFileToManifest(runtimeManifest, {
        sourcePath: file, outputPath: rgbaPath, gameDir, outputDir,
        converter: 'cursor-converter', timestamp,
      });
    }
  }

  if (!batchConverted) {
    throw new Error('Cursor conversion failed.');
  }
  console.log(`Registered ${registered} cursor(s).`);
}

function stepConvertWak(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting WAK water track files ═══\n');
  const extractedDir = path.join(outputDir, '_extracted');
  const wakOutputDir = path.join(outputDir, 'watertracks');

  const wakFiles = findFiles(extractedDir, '.wak');
  console.log(`Found ${wakFiles.length} .wak file(s)`);

  if (wakFiles.length === 0) return;

  const batchConverted = runTool('wak-converter', ['--input', extractedDir, '--output', wakOutputDir]);

  let failures = 0;
  for (const file of wakFiles) {
    const relPath = path.relative(extractedDir, file);
    const outPath = path.join(wakOutputDir, relPath.replace(/\.wak$/i, '.wak.json'));
    if (!fs.existsSync(outPath)) {
      failures += 1;
      continue;
    }
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file, outputPath: outPath, gameDir, outputDir,
      converter: 'wak-converter', timestamp,
    });
  }

  if (!batchConverted || failures > 0) {
    throw new Error(`WAK conversion failed for ${failures} file(s).`);
  }
}

function stepConvertVideo(
  gameDir: string,
  outputDir: string,
  runtimeManifest: ConversionManifest,
  timestamp: string,
): void {
  console.log('\n═══ Converting BIK video files ═══\n');
  const videoDir = path.join(outputDir, 'videos');

  // BIK files are in the retail install dir, not in .big archives
  const bikFiles = findFiles(gameDir, '.bik');
  console.log(`Found ${bikFiles.length} .bik file(s)`);

  if (bikFiles.length === 0) return;

  // Video converter gracefully skips if FFmpeg is not installed
  const batchConverted = runTool('video-converter', ['--input', gameDir, '--output', videoDir]);

  let registered = 0;
  for (const file of bikFiles) {
    const relPath = path.relative(gameDir, file);
    const outPath = path.join(videoDir, relPath.replace(/\.bik$/i, '.mp4'));
    if (!fs.existsSync(outPath)) continue;
    addConvertedFileToManifest(runtimeManifest, {
      sourcePath: file, outputPath: outPath, gameDir, outputDir,
      converter: 'video-converter', timestamp,
    });
    registered += 1;
  }

  if (!batchConverted) {
    console.warn('Video conversion incomplete (FFmpeg may not be installed). Continuing.');
  }
  console.log(`Registered ${registered} video(s).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { gameDir, outputDir, steps } = parseArgs();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  C&C Generals: Zero Hour — Asset Conversion Pipeline ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\nGame directory: ${gameDir}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Steps: ${[...steps].join(', ')}\n`);

  fs.mkdirSync(outputDir, { recursive: true });
  const runtimeManifestPath = path.join(outputDir, RUNTIME_MANIFEST_FILENAME);
  const runtimeManifest = loadOrCreateManifest(runtimeManifestPath);
  const timestamp = new Date().toISOString();

  const startTime = Date.now();

  if (steps.has('big'))     stepExtractBig(gameDir, outputDir);
  if (steps.has('texture')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'texture-converter');
    stepConvertTextures(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('w3d')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'w3d-converter');
    stepConvertW3d(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('map')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'map-converter');
    stepConvertMaps(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('ini')) {
    removeManifestEntries(
      runtimeManifest,
      outputDir,
      (entry) =>
        entry.converter === 'ini-parser'
        || (entry.converter === 'convert-all' && entry.outputPath === 'data/ini-bundle.json'),
    );
    stepParseIni(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('csf')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'csf-converter');
    stepConvertCsf(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('str')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'str-converter');
    stepConvertStr(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('audio')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'audio-converter');
    stepConvertAudio(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('wnd')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'wnd-converter');
    stepConvertWnd(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('cursor')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'cursor-converter');
    stepConvertCursors(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('wak')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'wak-converter');
    stepConvertWak(gameDir, outputDir, runtimeManifest, timestamp);
  }
  if (steps.has('video')) {
    removeManifestEntries(runtimeManifest, outputDir, (entry) => entry.converter === 'video-converter');
    stepConvertVideo(gameDir, outputDir, runtimeManifest, timestamp);
  }

  writeManifest(runtimeManifest, runtimeManifestPath);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Conversion complete in ${elapsed}s`);
  console.log(`  Output: ${outputDir}`);
  console.log(`  Runtime manifest: ${runtimeManifestPath}`);
}

main();
