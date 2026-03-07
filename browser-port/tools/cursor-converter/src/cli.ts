#!/usr/bin/env node
/**
 * Cursor converter CLI.
 *
 * Converts .ani (animated cursor) files to JSON metadata + RGBA sprite sheet.
 *
 * Usage:
 *   cursor-converter --input <file|dir> --output <dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAni } from './AniParser.js';

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
  console.log(`Usage: cursor-converter --input <file|dir> --output <dir>

Options:
  --input   Path to a .ani file or directory containing them
  --output  Output directory for converted cursor files
  --help    Show this help message`);
}

function discoverFiles(inputPath: string): string[] {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    return inputPath.toLowerCase().endsWith('.ani') ? [inputPath] : [];
  }
  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(inputPath, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.ani')) continue;
      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? inputPath;
      files.push(path.join(parentPath, entry.name));
    }
    return files.sort();
  }
  return [];
}

function main(): void {
  const args = parseArgs(process.argv);
  const files = discoverFiles(args.input);

  if (files.length === 0) {
    console.log('No .ani files found.');
    return;
  }

  console.log(`Found ${files.length} .ani file(s) to convert.`);
  let success = 0;
  let failed = 0;

  for (const filePath of files) {
    const rel = path.relative(
      fs.statSync(args.input).isDirectory() ? args.input : path.dirname(args.input),
      filePath,
    );
    const baseName = rel.replace(/\.ani$/i, '');
    const jsonPath = path.join(args.output, baseName + '.json');
    const rgbaPath = path.join(args.output, baseName + '_frames.rgba');

    try {
      const data = fs.readFileSync(filePath);
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const result = parseAni(buf);

      // Build sprite sheet: all frames stacked vertically
      const frameWidth = result.frames[0]?.width ?? 32;
      const frameHeight = result.frames[0]?.height ?? 32;
      const sheetHeight = frameHeight * result.frames.length;
      const sheetBytes = frameWidth * sheetHeight * 4;

      // Header: width(u32 LE) + height(u32 LE) + pixel data
      const headerSize = 8;
      const outBuf = Buffer.alloc(headerSize + sheetBytes);
      outBuf.writeUInt32LE(frameWidth, 0);
      outBuf.writeUInt32LE(sheetHeight, 4);

      for (let i = 0; i < result.frames.length; i++) {
        const frame = result.frames[i]!;
        outBuf.set(frame.rgba, headerSize + i * frameWidth * frameHeight * 4);
      }

      // Metadata JSON
      const metadata = {
        numFrames: result.header.numFrames,
        frameWidth,
        frameHeight,
        displayRate: result.header.displayRate,
        sequence: result.sequence,
        rates: result.rates,
        hotspots: result.frames.map((f) => ({ x: f.hotspotX, y: f.hotspotY })),
      };

      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2) + '\n');
      fs.writeFileSync(rgbaPath, outBuf);
      console.log(`  OK: ${rel} (${result.header.numFrames} frames, ${frameWidth}x${frameHeight})`);
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
