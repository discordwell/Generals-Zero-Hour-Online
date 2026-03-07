#!/usr/bin/env node
/**
 * Audio converter CLI.
 *
 * Converts game audio files for browser playback:
 *   - IMA ADPCM WAV → PCM WAV (browsers need PCM for decodeAudioData)
 *   - PCM WAV → copy through (already browser-compatible)
 *   - MP3 → copy through (already browser-compatible)
 *
 * Usage:
 *   audio-converter --input <dir> --output <dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseWavHeader, decodeAdpcmToPcm } from './AdpcmDecoder.js';

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
  console.log(`Usage: audio-converter --input <dir> --output <dir>

Options:
  --input   Directory containing .wav/.mp3 files
  --output  Output directory for converted audio files
  --help    Show this help message`);
}

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3']);

function discoverFiles(inputPath: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(inputPath)) return files;

  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    const ext = path.extname(inputPath).toLowerCase();
    return AUDIO_EXTENSIONS.has(ext) ? [inputPath] : [];
  }

  const entries = fs.readdirSync(inputPath, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? inputPath;
    files.push(path.join(parentPath, entry.name));
  }
  return files.sort();
}

function main(): void {
  const args = parseArgs(process.argv);
  const files = discoverFiles(args.input);

  if (files.length === 0) {
    console.log('No audio files found.');
    return;
  }

  const wavFiles = files.filter((f) => f.toLowerCase().endsWith('.wav'));
  const mp3Files = files.filter((f) => f.toLowerCase().endsWith('.mp3'));
  console.log(`Found ${wavFiles.length} .wav + ${mp3Files.length} .mp3 file(s) to convert.`);

  let success = 0;
  let failed = 0;
  let copied = 0;
  let decoded = 0;

  for (const filePath of files) {
    const rel = path.relative(args.input, filePath);
    const outputPath = path.join(args.output, rel);

    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      if (filePath.toLowerCase().endsWith('.mp3')) {
        fs.copyFileSync(filePath, outputPath);
        copied++;
        success++;
        continue;
      }

      // WAV: check format tag
      const data = fs.readFileSync(filePath);
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const info = parseWavHeader(buf);

      if (info.formatTag === 0x0001) {
        // PCM — copy through
        fs.copyFileSync(filePath, outputPath);
        copied++;
        success++;
      } else if (info.formatTag === 0x0011) {
        // IMA ADPCM — decode to PCM
        const pcmBuf = decodeAdpcmToPcm(buf);
        fs.writeFileSync(outputPath, Buffer.from(pcmBuf));
        decoded++;
        success++;
      } else {
        console.error(`  SKIP: ${rel} — unsupported format tag 0x${info.formatTag.toString(16)}`);
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL: ${rel} — ${message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} processed (${decoded} decoded, ${copied} copied), ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
