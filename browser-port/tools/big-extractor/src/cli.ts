/**
 * BIG Archive Extractor CLI
 *
 * Usage:
 *   big-extractor --input <file.big> --output <dir> [--list] [--filter <ext>]
 *
 * Options:
 *   --input   Path to .big archive file
 *   --output  Output directory for extracted files
 *   --list    List files without extracting
 *   --filter  Only extract files matching extension (e.g., .tga, .w3d, .ini)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { BigFileReader } from './BigFileReader.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  input: string | undefined;
  output: string | undefined;
  list: boolean;
  filter: string | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: undefined,
    output: undefined,
    list: false,
    filter: undefined,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--input':
      case '-i':
        args.input = argv[++i];
        break;
      case '--output':
      case '-o':
        args.output = argv[++i];
        break;
      case '--list':
      case '-l':
        args.list = true;
        break;
      case '--filter':
      case '-f':
        args.filter = argv[++i];
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
BIG Archive Extractor — @generals/tool-big-extractor

Usage:
  big-extractor --input <file.big> --output <dir> [--list] [--filter <ext>]

Options:
  --input,  -i   Path to .big archive file (required)
  --output, -o   Output directory for extracted files (required unless --list)
  --list,   -l   List files without extracting
  --filter, -f   Only extract files matching extension (e.g., .tga, .w3d, .ini)
  --help,   -h   Show this help message
  `.trim());
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (!args.input) {
    console.error('Error: --input is required\n');
    printUsage();
    process.exit(1);
  }

  if (!args.list && !args.output) {
    console.error('Error: --output is required when not using --list\n');
    printUsage();
    process.exit(1);
  }

  // Read the archive
  console.log(`Reading archive: ${args.input}`);
  const fileBuffer = readFileSync(args.input);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength,
  );

  // Parse
  const archive = BigFileReader.parse(arrayBuffer);
  console.log(
    `Archive: ${archive.magic} | ${formatSize(archive.archiveSize)} | ${archive.fileCount} files`,
  );

  // Determine which entries to process
  let entries = archive.entries;
  if (args.filter) {
    const ext = args.filter.startsWith('.')
      ? args.filter
      : `.${args.filter}`;
    entries = BigFileReader.listByExtension(archive, ext);
    console.log(
      `Filter: *${ext} — ${entries.length} matching file(s)`,
    );
  }

  // List mode
  if (args.list) {
    console.log('');
    for (const entry of entries) {
      console.log(`  ${entry.path}  (${formatSize(entry.size)})`);
    }
    console.log(`\nTotal: ${entries.length} file(s)`);
    return;
  }

  // Extract mode
  const outputDir = args.output!;
  let extracted = 0;
  let skippedUnsafe = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    if (!BigFileReader.isExtractablePath(entry.path)) {
      console.warn(`Skipping unsafe BIG entry path: ${entry.path}`);
      skippedUnsafe++;
      continue;
    }
    const outPath = join(outputDir, entry.path);
    const outDir = dirname(outPath);

    // Create directory tree
    mkdirSync(outDir, { recursive: true });

    // Extract and write
    const data = BigFileReader.extractFile(arrayBuffer, entry);
    writeFileSync(outPath, data);

    extracted++;
    totalBytes += entry.size;
  }

  console.log(
    `\nExtracted ${extracted} file(s) (${formatSize(totalBytes)}) to ${outputDir}`,
  );
  if (skippedUnsafe > 0) {
    console.log(`Skipped ${skippedUnsafe} unsafe/tombstone entr${skippedUnsafe === 1 ? 'y' : 'ies'}`);
  }
}

main();
