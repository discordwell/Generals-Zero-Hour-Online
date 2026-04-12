import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SOURCE_GAME_STATE_BLOCK,
  SOURCE_SAVE_FILE_EOF,
  listSaveGameChunks,
} from '@generals/engine';

const BROWSER_RUNTIME_STATE_BLOCK = 'CHUNK_TS_RuntimeState';
const DEFAULT_SCAN_CHUNK_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CARVE_BYTES = 256 * 1024 * 1024;
const MAX_SOURCE_SAVE_BLOCKS = 128;
const SKIPPED_SCAN_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.vite', 'test-results']);

const SOURCE_SAVE_MAGIC = Buffer.concat([
  Buffer.from([SOURCE_GAME_STATE_BLOCK.length]),
  Buffer.from(SOURCE_GAME_STATE_BLOCK, 'ascii'),
]);

export interface SourceSaveCarveCandidate {
  sourcePath: string;
  offset: number;
  length: number;
  chunkNames: string[];
  data: Buffer;
}

export interface CarvedSourceSaveFixture {
  sourcePath: string;
  fixturePath: string;
  offset: number;
  length: number;
  status: 'imported' | 'unchanged';
  chunkNames: string[];
}

export interface CarveSourceSaveFixturesReport {
  outputDir: string;
  summary: {
    scannedPaths: number;
    scannedFiles: number;
    sourceSaveCandidates: number;
    imported: number;
    unchanged: number;
  };
  fixtures: CarvedSourceSaveFixture[];
}

function copyBufferSlice(data: Uint8Array, start: number, end: number): Buffer {
  return Buffer.from(data.subarray(start, end));
}

function readAsciiToken(data: Uint8Array, offset: number): { token: string; nextOffset: number } | null {
  if (offset < 0 || offset >= data.byteLength) {
    return null;
  }
  const length = data[offset];
  if (length === undefined || offset + 1 + length > data.byteLength) {
    return null;
  }
  let token = '';
  for (let index = 0; index < length; index += 1) {
    const code = data[offset + 1 + index];
    if (code === undefined) {
      return null;
    }
    token += String.fromCharCode(code);
  }
  return { token, nextOffset: offset + 1 + length };
}

function readInt32LE(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > data.byteLength) {
    return null;
  }
  const byte0 = data[offset];
  const byte1 = data[offset + 1];
  const byte2 = data[offset + 2];
  const byte3 = data[offset + 3];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    return null;
  }
  return (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) | 0;
}

function arrayBufferFromBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function parseEmbeddedSourceSaveCandidate(data: Uint8Array, offset: number): {
  length: number;
  chunkNames: string[];
} | null {
  let cursor = offset;
  const chunkNames: string[] = [];

  for (let blockIndex = 0; blockIndex < MAX_SOURCE_SAVE_BLOCKS; blockIndex += 1) {
    const tokenResult = readAsciiToken(data, cursor);
    if (tokenResult === null) {
      return null;
    }
    cursor = tokenResult.nextOffset;

    if (tokenResult.token.toLowerCase() === SOURCE_SAVE_FILE_EOF.toLowerCase()) {
      if (chunkNames[0]?.toLowerCase() !== SOURCE_GAME_STATE_BLOCK.toLowerCase()) {
        return null;
      }
      return {
        length: cursor - offset,
        chunkNames,
      };
    }

    if (blockIndex === 0 && tokenResult.token.toLowerCase() !== SOURCE_GAME_STATE_BLOCK.toLowerCase()) {
      return null;
    }

    const blockSize = readInt32LE(data, cursor);
    if (blockSize === null || blockSize < 0) {
      return null;
    }
    const blockDataOffset = cursor + 4;
    const blockEndOffset = blockDataOffset + blockSize;
    if (blockEndOffset > data.byteLength) {
      return null;
    }

    chunkNames.push(tokenResult.token);
    cursor = blockEndOffset;
  }

  return null;
}

function validateCarvedSourceSave(data: Buffer): string[] | null {
  try {
    const chunks = listSaveGameChunks(arrayBufferFromBuffer(data));
    if (chunks.length === 0) {
      return null;
    }
    if (chunks[0]?.blockName.toLowerCase() !== SOURCE_GAME_STATE_BLOCK.toLowerCase()) {
      return null;
    }
    if (chunks.some((chunk) => chunk.blockName.toLowerCase() === BROWSER_RUNTIME_STATE_BLOCK.toLowerCase())) {
      return null;
    }
    return chunks.map((chunk) => chunk.blockName);
  } catch {
    return null;
  }
}

function readFileWindow(filePath: string, offset: number, byteLength: number): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const data = Buffer.allocUnsafe(byteLength);
    let bytesRead = 0;
    while (bytesRead < byteLength) {
      const read = readSync(fd, data, bytesRead, byteLength - bytesRead, offset + bytesRead);
      if (read === 0) {
        break;
      }
      bytesRead += read;
    }
    return bytesRead === byteLength ? data : data.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function tryReadSourceSaveCandidateFromFile(filePath: string, offset: number, maxCarveBytes: number): SourceSaveCarveCandidate | null {
  const stats = statSync(filePath);
  if (!stats.isFile() || offset < 0 || offset >= stats.size) {
    return null;
  }
  const windowLength = Math.min(maxCarveBytes, stats.size - offset);
  const window = readFileWindow(filePath, offset, windowLength);
  const parsed = parseEmbeddedSourceSaveCandidate(window, 0);
  if (parsed === null) {
    return null;
  }
  const carved = copyBufferSlice(window, 0, parsed.length);
  const chunkNames = validateCarvedSourceSave(carved);
  if (chunkNames === null) {
    return null;
  }
  return {
    sourcePath: filePath,
    offset,
    length: parsed.length,
    chunkNames,
    data: carved,
  };
}

export function findSourceSaveCandidatesInFile(filePath: string, options: {
  scanChunkBytes?: number;
  maxCarveBytes?: number;
} = {}): SourceSaveCarveCandidate[] {
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return [];
  }

  const scanChunkBytes = options.scanChunkBytes ?? DEFAULT_SCAN_CHUNK_BYTES;
  const maxCarveBytes = options.maxCarveBytes ?? DEFAULT_MAX_CARVE_BYTES;
  if (!Number.isInteger(scanChunkBytes) || scanChunkBytes < SOURCE_SAVE_MAGIC.byteLength) {
    throw new Error(`scanChunkBytes must be at least ${SOURCE_SAVE_MAGIC.byteLength}`);
  }
  if (!Number.isInteger(maxCarveBytes) || maxCarveBytes <= SOURCE_SAVE_MAGIC.byteLength) {
    throw new Error(`maxCarveBytes must be greater than ${SOURCE_SAVE_MAGIC.byteLength}`);
  }

  const fd = openSync(filePath, 'r');
  const candidates: SourceSaveCarveCandidate[] = [];
  const seenOffsets = new Set<number>();
  let previousTail = Buffer.alloc(0);
  let absoluteReadOffset = 0;
  try {
    const chunk = Buffer.allocUnsafe(scanChunkBytes);
    while (absoluteReadOffset < stats.size) {
      const bytesRead = readSync(fd, chunk, 0, Math.min(scanChunkBytes, stats.size - absoluteReadOffset), absoluteReadOffset);
      if (bytesRead <= 0) {
        break;
      }
      const chunkView = chunk.subarray(0, bytesRead);
      const searchable = previousTail.byteLength > 0
        ? Buffer.concat([previousTail, chunkView])
        : chunkView;
      const searchableBaseOffset = absoluteReadOffset - previousTail.byteLength;

      let searchOffset = 0;
      while (searchOffset < searchable.byteLength) {
        const localOffset = searchable.indexOf(SOURCE_SAVE_MAGIC, searchOffset);
        if (localOffset < 0) {
          break;
        }
        const candidateOffset = searchableBaseOffset + localOffset;
        if (candidateOffset >= 0 && !seenOffsets.has(candidateOffset)) {
          seenOffsets.add(candidateOffset);
          const candidate = tryReadSourceSaveCandidateFromFile(filePath, candidateOffset, maxCarveBytes);
          if (candidate !== null) {
            candidates.push(candidate);
          }
        }
        searchOffset = localOffset + 1;
      }

      const tailLength = Math.min(SOURCE_SAVE_MAGIC.byteLength - 1, searchable.byteLength);
      previousTail = Buffer.from(searchable.subarray(searchable.byteLength - tailLength));
      absoluteReadOffset += bytesRead;
    }
  } finally {
    closeSync(fd);
  }

  return candidates;
}

function sanitizeFixtureBaseName(filePath: string): string {
  const parsedExtension = extname(filePath);
  const rawBaseName = parsedExtension
    ? basename(filePath, parsedExtension)
    : basename(filePath);
  const sanitized = rawBaseName
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'source-save';
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function resolveUniqueCarvedFixturePath(outputDir: string, candidate: SourceSaveCarveCandidate): {
  fixturePath: string;
  unchanged: boolean;
} {
  const baseName = sanitizeFixtureBaseName(candidate.sourcePath);
  const offsetSuffix = candidate.offset.toString(16).padStart(8, '0');
  for (let suffix = 0; ; suffix += 1) {
    const candidateName = suffix === 0
      ? `${baseName}-${offsetSuffix}.sav`
      : `${baseName}-${offsetSuffix}-${suffix}.sav`;
    const candidatePath = join(outputDir, candidateName);
    if (!existsSync(candidatePath)) {
      return { fixturePath: candidatePath, unchanged: false };
    }
    if (buffersEqual(readFileSync(candidatePath), candidate.data)) {
      return { fixturePath: candidatePath, unchanged: true };
    }
  }
}

function collectScanFilePaths(inputPaths: readonly string[]): string[] {
  const discovered = new Set<string>();
  const visit = (inputPath: string): void => {
    if (!existsSync(inputPath)) {
      return;
    }
    const stats = statSync(inputPath);
    if (stats.isFile()) {
      discovered.add(inputPath);
      return;
    }
    if (!stats.isDirectory()) {
      return;
    }
    for (const entry of readdirSync(inputPath, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_SCAN_DIRS.has(entry.name)) {
        continue;
      }
      visit(join(inputPath, entry.name));
    }
  };

  for (const inputPath of inputPaths) {
    visit(resolve(process.cwd(), inputPath));
  }

  return [...discovered].sort((left, right) => left.localeCompare(right));
}

export function carveSourceSaveFixtures(params: {
  inputPaths: readonly string[];
  outputDir: string;
  scanChunkBytes?: number;
  maxCarveBytes?: number;
}): CarveSourceSaveFixturesReport {
  const outputDir = resolve(process.cwd(), params.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const scanFiles = collectScanFilePaths(params.inputPaths);
  const candidates = scanFiles.flatMap((scanPath) =>
    findSourceSaveCandidatesInFile(scanPath, {
      scanChunkBytes: params.scanChunkBytes,
      maxCarveBytes: params.maxCarveBytes,
    }));
  const fixtures = candidates.map((candidate) => {
    const resolved = resolveUniqueCarvedFixturePath(outputDir, candidate);
    if (!resolved.unchanged) {
      writeFileSync(resolved.fixturePath, candidate.data);
    }
    return {
      sourcePath: candidate.sourcePath,
      fixturePath: resolved.fixturePath,
      offset: candidate.offset,
      length: candidate.length,
      status: resolved.unchanged ? 'unchanged' as const : 'imported' as const,
      chunkNames: candidate.chunkNames,
    };
  });

  return {
    outputDir,
    summary: {
      scannedPaths: params.inputPaths.length,
      scannedFiles: scanFiles.length,
      sourceSaveCandidates: candidates.length,
      imported: fixtures.filter((fixture) => fixture.status === 'imported').length,
      unchanged: fixtures.filter((fixture) => fixture.status === 'unchanged').length,
    },
    fixtures,
  };
}

function usage(): void {
  console.error('Usage: tsx tools/source-save-carver.ts [--out fixtures/source-saves] [--scan-chunk-bytes 67108864] [--max-carve-bytes 268435456] <file-or-directory> [...]');
}

function readPositiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function main(): void {
  const args = process.argv.slice(2);
  let outputDir = 'fixtures/source-saves';
  let scanChunkBytes: number | undefined;
  let maxCarveBytes: number | undefined;
  const inputPaths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      outputDir = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--scan-chunk-bytes') {
      scanChunkBytes = readPositiveInteger(args[index + 1], '--scan-chunk-bytes');
      index += 1;
      continue;
    }
    if (arg === '--max-carve-bytes') {
      maxCarveBytes = readPositiveInteger(args[index + 1], '--max-carve-bytes');
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      inputPaths.push(arg);
    }
  }

  if (!outputDir || inputPaths.length === 0) {
    usage();
    process.exitCode = 1;
    return;
  }

  const report = carveSourceSaveFixtures({
    inputPaths,
    outputDir,
    scanChunkBytes,
    maxCarveBytes,
  });
  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write('\n');
  if (report.summary.sourceSaveCandidates === 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
