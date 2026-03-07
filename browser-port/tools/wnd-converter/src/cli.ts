#!/usr/bin/env node
/**
 * WND converter CLI.
 *
 * Converts .wnd (Window Definition) files to JSON.
 *
 * Usage:
 *   wnd-converter --input <file|dir> --output <dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseWnd } from './WndParser.js';

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
  console.log(`Usage: wnd-converter --input <file|dir> --output <dir>

Options:
  --input   Path to a .wnd file or directory containing them
  --output  Output directory for converted JSON files
  --help    Show this help message`);
}

function discoverFiles(inputPath: string): string[] {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    return inputPath.toLowerCase().endsWith('.wnd') ? [inputPath] : [];
  }
  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(inputPath, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.wnd')) continue;
      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? inputPath;
      files.push(path.join(parentPath, entry.name));
    }
    return files.sort();
  }
  return [];
}

function countWindows(windows: Array<{ children: unknown[] }>): number {
  let count = windows.length;
  for (const w of windows) {
    count += countWindows(w.children as Array<{ children: unknown[] }>);
  }
  return count;
}

function main(): void {
  const args = parseArgs(process.argv);
  const files = discoverFiles(args.input);

  if (files.length === 0) {
    console.log('No .wnd files found.');
    return;
  }

  console.log(`Found ${files.length} .wnd file(s) to convert.`);
  let success = 0;
  let failed = 0;

  for (const filePath of files) {
    const rel = path.relative(
      fs.statSync(args.input).isDirectory() ? args.input : path.dirname(args.input),
      filePath,
    );
    const outputPath = path.join(args.output, rel.replace(/\.wnd$/i, '.json'));

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const result = parseWnd(content);
      const windowCount = countWindows(result.windows);

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
      console.log(`  OK: ${rel} (${windowCount} windows)`);
      success++;
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
