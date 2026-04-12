import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listSaveGameChunks } from '@generals/engine';
import {
  inspectGameLogicChunkLayout,
  inspectRuntimeSaveGameClientDrawableHydrationStatus,
  inspectRuntimeSaveCoreChunkStatus,
  type RuntimeSaveGameClientDrawableHydrationStatus,
  type RuntimeSaveCoreChunkStatus,
} from '../packages/app/src/runtime-save-game.js';

export interface SaveCoreChunkReportSummary {
  status: 'pass' | 'blocked';
  totalCoreChunks: number;
  parsedCoreChunks: number;
  legacyCoreChunks: number;
  rawPassthroughCoreChunks: number;
  missingCoreChunks: number;
  rawUnsupportedGameClientDrawables: number;
}

export interface SaveCoreChunkReport {
  savePath: string;
  summary: SaveCoreChunkReportSummary;
  coreChunks: RuntimeSaveCoreChunkStatus[];
  gameClientDrawables: RuntimeSaveGameClientDrawableHydrationStatus[];
  gameLogicLayout: ReturnType<typeof inspectGameLogicChunkLayout> | null;
}

export function getSaveCoreChunkBlockers(
  chunkStatus: readonly RuntimeSaveCoreChunkStatus[],
): RuntimeSaveCoreChunkStatus[] {
  return chunkStatus.filter(
    (chunk) => chunk.mode === 'raw_passthrough' || chunk.mode === 'missing',
  );
}

export function summarizeSaveCoreChunkStatus(
  chunkStatus: readonly RuntimeSaveCoreChunkStatus[],
  gameClientDrawables: readonly RuntimeSaveGameClientDrawableHydrationStatus[] = [],
): SaveCoreChunkReportSummary {
  const rawPassthroughCoreChunks = chunkStatus.filter((chunk) => chunk.mode === 'raw_passthrough').length;
  const missingCoreChunks = chunkStatus.filter((chunk) => chunk.mode === 'missing').length;
  const rawUnsupportedGameClientDrawables = gameClientDrawables.filter(
    (drawable) => drawable.mode === 'raw_unsupported',
  ).length;
  return {
    status: rawPassthroughCoreChunks > 0 || missingCoreChunks > 0 || rawUnsupportedGameClientDrawables > 0
      ? 'blocked'
      : 'pass',
    totalCoreChunks: chunkStatus.length,
    parsedCoreChunks: chunkStatus.filter((chunk) => chunk.mode === 'parsed').length,
    legacyCoreChunks: chunkStatus.filter((chunk) => chunk.mode === 'legacy').length,
    rawPassthroughCoreChunks,
    missingCoreChunks,
    rawUnsupportedGameClientDrawables,
  };
}

export function buildSaveCoreChunkReport(
  data: ArrayBuffer,
  savePath: string,
): SaveCoreChunkReport {
  const chunkStatus = inspectRuntimeSaveCoreChunkStatus(data);
  const gameClientDrawables = inspectRuntimeSaveGameClientDrawableHydrationStatus(data);
  const chunkList = listSaveGameChunks(data);
  const gameLogicChunk = chunkList.find((chunk) => chunk.blockName === 'CHUNK_GameLogic');
  const gameLogicLayout = gameLogicChunk
    ? inspectGameLogicChunkLayout(
      new Uint8Array(
        data,
        gameLogicChunk.blockDataOffset,
        gameLogicChunk.blockSize,
      ).slice(),
    )
    : null;

  return {
    savePath,
    summary: summarizeSaveCoreChunkStatus(chunkStatus, gameClientDrawables),
    coreChunks: chunkStatus,
    gameClientDrawables,
    gameLogicLayout,
  };
}

function usage(): void {
  console.error('Usage: tsx tools/save-core-chunk-report.ts [--strict] <save-file-path>');
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const inputPath = args.find((arg) => arg !== '--strict');
  if (!inputPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const absolutePath = resolve(process.cwd(), inputPath);
  const fileData = readFileSync(absolutePath);
  const data = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
  const report = buildSaveCoreChunkReport(data, absolutePath);

  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write('\n');

  const blockers = getSaveCoreChunkBlockers(report.coreChunks);
  const rawUnsupportedDrawables = report.gameClientDrawables.filter(
    (drawable) => drawable.mode === 'raw_unsupported',
  );
  if (strict && (blockers.length > 0 || rawUnsupportedDrawables.length > 0)) {
    console.error(
      `Save core chunk strict parity failed: ${blockers.length} raw/missing core chunk(s), `
      + `${rawUnsupportedDrawables.length} unsupported GameClient drawable(s).`,
    );
    for (const blocker of blockers) {
      console.error(`- ${blocker.blockName}: ${blocker.mode}`);
    }
    for (const drawable of rawUnsupportedDrawables) {
      console.error(
        `- CHUNK_GameClient drawable #${drawable.index} `
        + `${drawable.templateName} object=${drawable.objectId} version=${drawable.version ?? 'unknown'}: `
        + drawable.mode,
      );
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
