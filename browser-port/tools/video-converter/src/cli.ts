#!/usr/bin/env node
/**
 * Video converter CLI.
 *
 * Converts .bik (Bink Video) files to .mp4 using FFmpeg.
 * Gracefully skips if FFmpeg is not installed.
 *
 * Usage:
 *   video-converter --input <file|dir> --output <dir>
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv: string[]): { input: string; output: string } {
  let input: string | undefined;
  let output: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next) { input = next; i++; }
    else if (arg === '--output' && next) { output = next; i++; }
    else if (arg === '--help' || arg === '-h') { printUsage(); process.exit(0); }
  }

  if (!input || !output) { printUsage(); process.exit(1); }
  return { input, output };
}

function printUsage(): void {
  console.log(`Usage: video-converter --input <file|dir> --output <dir>

Options:
  --input   Path to a .bik file or directory containing them
  --output  Output directory for converted .mp4 files
  --help    Show this help message`);
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function discoverFiles(inputPath: string): string[] {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    return inputPath.toLowerCase().endsWith('.bik') ? [inputPath] : [];
  }
  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(inputPath, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.bik')) continue;
      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? inputPath;
      files.push(path.join(parentPath, entry.name));
    }
    return files.sort();
  }
  return [];
}

function main(): void {
  const args = parseArgs(process.argv);

  if (!hasFfmpeg()) {
    console.log('FFmpeg not found. Skipping video conversion.');
    console.log('Install FFmpeg to convert .bik videos to .mp4.');
    return;
  }

  const files = discoverFiles(args.input);

  if (files.length === 0) {
    console.log('No .bik files found.');
    return;
  }

  console.log(`Found ${files.length} .bik file(s) to convert.`);
  let success = 0;
  let failed = 0;

  for (const filePath of files) {
    const rel = path.relative(
      fs.statSync(args.input).isDirectory() ? args.input : path.dirname(args.input),
      filePath,
    );
    const outputPath = path.join(args.output, rel.replace(/\.bik$/i, '.mp4'));

    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      execFileSync('ffmpeg', [
        '-y',             // overwrite
        '-i', filePath,
        '-c:v', 'libx264',
        '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        outputPath,
      ], { stdio: 'pipe', timeout: 120000 });

      if (fs.existsSync(outputPath)) {
        const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);
        console.log(`  OK: ${rel} (${sizeKB} KB)`);
        success++;
      } else {
        console.error(`  FAIL: ${rel} — output not created`);
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL: ${rel} — ${message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} converted, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
