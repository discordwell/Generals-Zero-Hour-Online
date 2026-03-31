#!/usr/bin/env tsx
/**
 * Patch MappedImage entries into the existing ini-bundle.json.
 *
 * This script reads MappedImage .INI files from the _extracted directory,
 * parses them using the existing INI parser + registry, and patches the
 * resulting MappedImageDef[] into the live ini-bundle.json without needing
 * the full convert-all pipeline.
 *
 * Usage (from browser-port/):
 *   npx tsx tools/patch-mapped-images.ts [--extracted-dir <dir>]
 *
 * Default extracted dir:
 *   packages/app/public/assets/_extracted/INIZH/Data/INI/MappedImages
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseIni } from '@generals/core';
import { IniDataRegistry } from '@generals/ini-data';
import type { IniDataBundle, MappedImageDef } from '@generals/ini-data';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { extractedDir: string } {
  let extractedDir: string | undefined;

  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--extracted-dir') {
      extractedDir = process.argv[++i];
      if (!extractedDir) {
        console.error('Error: --extracted-dir requires a value');
        process.exit(1);
      }
    }
  }

  if (!extractedDir) {
    // Try local worktree first, then fall back to main worktree
    const localPath = path.join(
      PROJECT_ROOT,
      'packages/app/public/assets/_extracted/INIZH/Data/INI/MappedImages',
    );
    if (fs.existsSync(localPath)) {
      extractedDir = localPath;
    } else {
      // Fall back to main worktree (for agent worktrees where _extracted is gitignored)
      const mainWorktree = findMainWorktree();
      if (mainWorktree) {
        const mainPath = path.join(
          mainWorktree,
          'browser-port/packages/app/public/assets/_extracted/INIZH/Data/INI/MappedImages',
        );
        if (fs.existsSync(mainPath)) {
          extractedDir = mainPath;
        }
      }
    }
  }

  if (!extractedDir || !fs.existsSync(extractedDir)) {
    console.error(
      `Error: MappedImages directory not found. Provide --extracted-dir or ensure _extracted exists.`,
    );
    process.exit(1);
  }

  return { extractedDir };
}

function findMainWorktree(): string | null {
  // Walk up from PROJECT_ROOT looking for a .claude/worktrees pattern
  let dir = PROJECT_ROOT;
  while (true) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // root
    if (path.basename(parent) === 'worktrees' && path.basename(path.dirname(parent)) === '.claude') {
      // We're in .claude/worktrees/<id>/browser-port -> main is .claude/../
      return path.dirname(path.dirname(parent));
    }
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// INI file discovery
// ---------------------------------------------------------------------------

function findIniFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findIniFiles(fullPath));
    } else if (entry.name.toLowerCase().endsWith('.ini')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { extractedDir } = parseArgs();

  console.log(`Reading MappedImage INI files from: ${extractedDir}`);

  const iniFiles = findIniFiles(extractedDir);
  console.log(`Found ${iniFiles.length} .INI file(s)`);

  if (iniFiles.length === 0) {
    console.error('No .INI files found — nothing to do.');
    process.exit(1);
  }

  // Parse all INI files and ingest into registry
  const registry = new IniDataRegistry();
  let totalBlocks = 0;
  let totalErrors = 0;

  for (const file of iniFiles) {
    const source = fs.readFileSync(file, 'utf-8');
    const result = parseIni(source, { filePath: file });

    totalBlocks += result.blocks.length;
    totalErrors += result.errors.length;

    for (const err of result.errors) {
      const loc = err.file ? `${err.file}:${err.line}` : `line ${err.line}`;
      console.warn(`  [WARN] ${path.basename(file)} ${loc}: ${err.message}`);
    }

    registry.loadBlocks(result.blocks, file);
  }

  registry.resolveInheritance();

  // Extract MappedImage defs from the registry
  const mappedImages: MappedImageDef[] = registry.getAllMappedImages();
  mappedImages.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\nParsed ${totalBlocks} block(s) with ${totalErrors} warning(s)`);
  console.log(`Extracted ${mappedImages.length} MappedImage definition(s)`);

  if (mappedImages.length === 0) {
    console.error('No MappedImage definitions extracted — something went wrong.');
    process.exit(1);
  }

  // Read existing ini-bundle.json
  const bundlePath = path.join(
    PROJECT_ROOT,
    'packages/app/public/assets/data/ini-bundle.json',
  );

  if (!fs.existsSync(bundlePath)) {
    console.error(`Error: ini-bundle.json not found at ${bundlePath}`);
    process.exit(1);
  }

  console.log(`\nReading existing bundle: ${bundlePath}`);
  const bundle: IniDataBundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

  const previousCount = (bundle.mappedImages ?? []).length;
  console.log(`Previous mappedImages count: ${previousCount}`);

  // Patch the mappedImages array
  bundle.mappedImages = mappedImages;

  // Update stats if present
  if (bundle.stats) {
    const oldMappedImagesCount = (bundle.stats as Record<string, number>).mappedImages ?? 0;
    const oldTotal = bundle.stats.totalBlocks ?? 0;
    (bundle.stats as Record<string, number>).mappedImages = mappedImages.length;
    bundle.stats.totalBlocks = oldTotal - oldMappedImagesCount + mappedImages.length;
  }

  // Write the updated bundle
  const serialized = JSON.stringify(bundle, null, 2) + '\n';
  fs.writeFileSync(bundlePath, serialized);
  console.log(`\nUpdated ini-bundle.json with ${mappedImages.length} MappedImage entries`);

  // Update manifest hash
  const manifestPath = path.join(
    PROJECT_ROOT,
    'packages/app/public/assets/manifest.json',
  );

  if (fs.existsSync(manifestPath)) {
    const newHash = createHash('sha256').update(serialized).digest('hex');
    const manifestText = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestText);

    let updated = false;
    for (const entry of manifest.entries ?? []) {
      if (
        entry.outputPath === 'data/ini-bundle.json' ||
        entry.sourcePath === 'data/ini-bundle.json'
      ) {
        console.log(`Updating manifest hash: ${entry.outputHash} -> ${newHash}`);
        entry.sourceHash = newHash;
        entry.outputHash = newHash;
        entry.timestamp = new Date().toISOString();
        updated = true;
        break;
      }
    }

    if (updated) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
      console.log('Manifest updated.');
    } else {
      console.warn('Could not find ini-bundle.json entry in manifest — skipping hash update.');
    }
  }

  // Verify
  const verifyBundle: IniDataBundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
  const verifyCount = (verifyBundle.mappedImages ?? []).length;
  console.log(`\nVerification: ini-bundle.json now has ${verifyCount} MappedImage entries`);

  if (verifyCount !== mappedImages.length) {
    console.error('VERIFICATION FAILED — count mismatch!');
    process.exit(1);
  }

  // Print a few sample entries
  console.log('\nSample entries:');
  for (const mi of mappedImages.slice(0, 5)) {
    console.log(
      `  ${mi.name}: texture=${mi.texture}, ${mi.textureWidth}x${mi.textureHeight}, ` +
      `coords=[${mi.left},${mi.top},${mi.right},${mi.bottom}], rotated=${mi.rotated}`,
    );
  }
  if (mappedImages.length > 5) {
    console.log(`  ... and ${mappedImages.length - 5} more`);
  }

  console.log('\nDone.');
}

main();
