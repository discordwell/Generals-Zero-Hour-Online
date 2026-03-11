/**
 * Runtime manifest loader — fetches and indexes the conversion manifest
 * for fast asset lookups at runtime.
 */

import type { ConversionManifest, ManifestEntry } from '@generals/core';
import { parseManifest } from '@generals/core';
import { ManifestLoadError } from './errors.js';
import { RUNTIME_ASSET_BASE_URL } from './types.js';

/**
 * Indexed wrapper around ConversionManifest for efficient runtime lookups.
 */
export class RuntimeManifest {
  private readonly byOutputPath = new Map<string, ManifestEntry>();
  private readonly bySourcePath = new Map<string, ManifestEntry>();
  private readonly byBasenameLower = new Map<string, ManifestEntry>();

  constructor(public readonly raw: ConversionManifest) {
    for (const entry of raw.entries) {
      this.byOutputPath.set(entry.outputPath, entry);
      this.bySourcePath.set(entry.sourcePath, entry);

      // Index .glb entries by lowercase basename (without extension) for
      // case-insensitive bare-name lookups (e.g. "AVThundrblt_D1" → entry).
      if (entry.outputPath.toLowerCase().endsWith('.glb')) {
        const lastSlash = entry.outputPath.lastIndexOf('/');
        const filename = lastSlash >= 0 ? entry.outputPath.slice(lastSlash + 1) : entry.outputPath;
        const dotIdx = filename.lastIndexOf('.');
        const basename = (dotIdx > 0 ? filename.slice(0, dotIdx) : filename).toLowerCase();
        if (basename && !this.byBasenameLower.has(basename)) {
          this.byBasenameLower.set(basename, entry);
        }
      }
    }
  }

  /** Look up a manifest entry by its output path. */
  getByOutputPath(outputPath: string): ManifestEntry | undefined {
    return this.byOutputPath.get(outputPath);
  }

  /** Look up a manifest entry by its source path. */
  getBySourcePath(sourcePath: string): ManifestEntry | undefined {
    return this.bySourcePath.get(sourcePath);
  }

  /** Look up a .glb manifest entry by bare model name (case-insensitive, no extension). */
  getByBasenameLower(name: string): ManifestEntry | undefined {
    return this.byBasenameLower.get(name.toLowerCase());
  }

  /** Check if an output path exists in the manifest. */
  hasOutputPath(outputPath: string): boolean {
    return this.byOutputPath.has(outputPath);
  }

  /** Get all output paths. */
  getOutputPaths(): string[] {
    return [...this.byOutputPath.keys()];
  }

  /** Total number of entries. */
  get size(): number {
    return this.raw.entries.length;
  }
}

function findDuplicatePath(
  manifest: ConversionManifest,
  key: 'sourcePath' | 'outputPath',
): string | null {
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    const value = entry[key];
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

function validateManifestPath(pathValue: string, key: 'sourcePath' | 'outputPath'): string | null {
  if (pathValue.length === 0) {
    return 'Path cannot be empty';
  }

  if (/^[a-z]+:\/\//i.test(pathValue)) {
    return 'Path must be relative';
  }

  if (/^[A-Za-z]:($|\/)/.test(pathValue)) {
    return 'Path must be relative';
  }

  if (pathValue.includes('\\')) {
    return 'Path must use forward slashes';
  }

  if (pathValue.startsWith('/')) {
    return 'Path must be relative';
  }

  const segments = pathValue.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return 'Path must not contain empty segments';
  }
  if (segments.includes('.')) {
    return 'Path must not contain "." segments';
  }
  if (segments.includes('..')) {
    return 'Path must not contain ".." segments';
  }

  if (key === 'outputPath') {
    const runtimeBaseLower = RUNTIME_ASSET_BASE_URL.toLowerCase();
    const runtimePrefix = `${runtimeBaseLower}/`;
    const pathValueLower = pathValue.toLowerCase();
    if (pathValueLower === runtimeBaseLower || pathValueLower.startsWith(runtimePrefix)) {
      return `Path must be relative to runtime base and must not include "${runtimePrefix}"`;
    }
  }

  return null;
}

function findInvalidPath(
  manifest: ConversionManifest,
  key: 'sourcePath' | 'outputPath',
): { path: string; reason: string } | null {
  for (const entry of manifest.entries) {
    const value = entry[key];
    const reason = validateManifestPath(value, key);
    if (reason) {
      return { path: value, reason };
    }
  }
  return null;
}

/**
 * Fetch and parse the conversion manifest.
 * Returns null on 404 (manifest-optional design).
 * Throws ManifestLoadError on other failures.
 */
export async function loadManifest(url: string): Promise<RuntimeManifest | null> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new ManifestLoadError(url, err instanceof Error ? err.message : String(err));
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new ManifestLoadError(url, `HTTP ${response.status}`);
  }

  const text = await response.text();
  const manifest = parseManifest(text);

  if (!manifest) {
    throw new ManifestLoadError(url, 'Invalid manifest JSON');
  }

  const duplicateOutputPath = findDuplicatePath(manifest, 'outputPath');
  if (duplicateOutputPath) {
    throw new ManifestLoadError(url, `Duplicate outputPath: ${duplicateOutputPath}`);
  }

  const duplicateSourcePath = findDuplicatePath(manifest, 'sourcePath');
  if (duplicateSourcePath) {
    throw new ManifestLoadError(url, `Duplicate sourcePath: ${duplicateSourcePath}`);
  }

  const invalidOutputPath = findInvalidPath(manifest, 'outputPath');
  if (invalidOutputPath) {
    throw new ManifestLoadError(
      url,
      `Invalid outputPath: ${invalidOutputPath.path} (${invalidOutputPath.reason})`,
    );
  }

  const invalidSourcePath = findInvalidPath(manifest, 'sourcePath');
  if (invalidSourcePath) {
    throw new ManifestLoadError(
      url,
      `Invalid sourcePath: ${invalidSourcePath.path} (${invalidSourcePath.reason})`,
    );
  }

  return new RuntimeManifest(manifest);
}
