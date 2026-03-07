#!/usr/bin/env node
/**
 * Texture converter CLI.
 *
 * Converts .tga and .dds files to a raw RGBA binary format with a simple header:
 *   - Bytes 0-3: width  (uint32 LE)
 *   - Bytes 4-7: height (uint32 LE)
 *   - Bytes 8+:  RGBA pixel data (row-major, top-to-bottom)
 *
 * Usage:
 *   texture-converter --input <file|dir> --output <dir> [--format rgba]
 */

import fs from 'node:fs';
import path from 'node:path';
import { TgaDecoder } from './TgaDecoder.js';
import { DdsDecoder } from './DdsDecoder.js';
import { BmpDecoder } from './BmpDecoder.js';
import type { DecodedImage } from './TgaDecoder.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  input: string;
  output: string;
  format: string;
}

function parseArgs(argv: string[]): CliArgs {
  let input: string | undefined;
  let output: string | undefined;
  let format = 'rgba';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next) {
      input = next;
      i++;
    } else if (arg === '--output' && next) {
      output = next;
      i++;
    } else if (arg === '--format' && next) {
      format = next;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!input || !output) {
    printUsage();
    process.exit(1);
  }

  return { input, output, format };
}

function printUsage(): void {
  console.log(`Usage: texture-converter --input <file|dir> --output <dir> [--format rgba]

Options:
  --input   Path to a .tga/.dds file or directory containing them
  --output  Output directory for converted files
  --format  Output format (default: rgba)
  --help    Show this help message`);
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set(['.tga', '.dds', '.bmp']);

function discoverFiles(inputPath: string): string[] {
  const stat = fs.statSync(inputPath);

  if (stat.isFile()) {
    const ext = path.extname(inputPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.warn(`Warning: ${inputPath} is not a supported texture file`);
      return [];
    }
    return [inputPath];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(inputPath, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? inputPath;
      files.push(path.join(parentPath, entry.name));
    }
    return files.sort();
  }

  throw new Error(`Input path does not exist: ${inputPath}`);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function decodeFile(filePath: string): DecodedImage {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );

  switch (ext) {
    case '.tga':
      return TgaDecoder.decode(arrayBuffer);
    case '.dds':
      return DdsDecoder.decode(arrayBuffer);
    case '.bmp':
      return BmpDecoder.decode(arrayBuffer);
    default:
      throw new Error(`Unsupported extension: ${ext}`);
  }
}

function writeRgba(image: DecodedImage, outputPath: string): void {
  // Header: 8 bytes (width u32 LE + height u32 LE) + pixel data
  const headerSize = 8;
  const outBuf = Buffer.alloc(headerSize + image.data.length);
  outBuf.writeUInt32LE(image.width, 0);
  outBuf.writeUInt32LE(image.height, 4);
  outBuf.set(image.data, headerSize);

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, outBuf);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);
  const files = discoverFiles(args.input);

  if (files.length === 0) {
    console.log('No supported texture files found.');
    return;
  }

  console.log(`Found ${files.length} texture file(s) to convert.`);

  let success = 0;
  let failed = 0;

  for (const filePath of files) {
    const rel = path.relative(
      fs.statSync(args.input).isDirectory() ? args.input : path.dirname(args.input),
      filePath,
    );
    const outputPath = path.join(args.output, rel.replace(/\.(tga|dds|bmp)$/i, '.rgba'));

    try {
      const image = decodeFile(filePath);
      writeRgba(image, outputPath);
      console.log(`  OK: ${rel} (${image.width}x${image.height})`);
      success++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL: ${rel} — ${message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} converted, ${failed} failed.`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
