import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
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

export interface SaveCoreChunkCollectionReportSummary {
  status: 'pass' | 'blocked';
  totalSaveFiles: number;
  passedSaveFiles: number;
  blockedSaveFiles: number;
  totalCoreChunks: number;
  rawPassthroughCoreChunks: number;
  missingCoreChunks: number;
  rawUnsupportedGameClientDrawables: number;
}

export interface SaveCoreChunkCollectionReport {
  rootPath: string;
  summary: SaveCoreChunkCollectionReportSummary;
  saves: SaveCoreChunkReport[];
}

const SAVE_FIXTURE_EXTENSIONS = new Set(['.sav', '.save']);
const SKIPPED_FIXTURE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build']);

export function isSaveFixturePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const extension = extname(normalized);
  if (SAVE_FIXTURE_EXTENSIONS.has(extension)) {
    return true;
  }
  return extension === '.bin' && basename(normalized).includes('save');
}

export function listSaveFixturePaths(inputPath: string): string[] {
  const stats = statSync(inputPath);
  if (stats.isFile()) {
    return [inputPath];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const results: string[] = [];
  const visit = (dirPath: string): void => {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FIXTURE_DIRS.has(entry.name)) {
          visit(entryPath);
        }
        continue;
      }
      if (entry.isFile() && isSaveFixturePath(entryPath)) {
        results.push(entryPath);
      }
    }
  };
  visit(inputPath);
  return results.sort((left, right) => left.localeCompare(right));
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

export function summarizeSaveCoreChunkReports(
  reports: readonly SaveCoreChunkReport[],
): SaveCoreChunkCollectionReportSummary {
  const passedSaveFiles = reports.filter((report) => report.summary.status === 'pass').length;
  const blockedSaveFiles = reports.length - passedSaveFiles;
  return {
    status: reports.length === 0 || blockedSaveFiles > 0 ? 'blocked' : 'pass',
    totalSaveFiles: reports.length,
    passedSaveFiles,
    blockedSaveFiles,
    totalCoreChunks: reports.reduce((sum, report) => sum + report.summary.totalCoreChunks, 0),
    rawPassthroughCoreChunks: reports.reduce(
      (sum, report) => sum + report.summary.rawPassthroughCoreChunks,
      0,
    ),
    missingCoreChunks: reports.reduce((sum, report) => sum + report.summary.missingCoreChunks, 0),
    rawUnsupportedGameClientDrawables: reports.reduce(
      (sum, report) => sum + report.summary.rawUnsupportedGameClientDrawables,
      0,
    ),
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

export function buildSaveCoreChunkReportFromPath(savePath: string): SaveCoreChunkReport {
  const fileData = readFileSync(savePath);
  const data = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
  return buildSaveCoreChunkReport(data, savePath);
}

export function buildSaveCoreChunkCollectionReport(inputPath: string): SaveCoreChunkCollectionReport {
  const savePaths = listSaveFixturePaths(inputPath);
  const reports = savePaths.map((savePath) => buildSaveCoreChunkReportFromPath(savePath));
  return {
    rootPath: inputPath,
    summary: summarizeSaveCoreChunkReports(reports),
    saves: reports,
  };
}

function usage(): void {
  console.error('Usage: tsx tools/save-core-chunk-report.ts [--strict] <save-file-or-directory>');
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
  const report = statSync(absolutePath).isDirectory()
    ? buildSaveCoreChunkCollectionReport(absolutePath)
    : buildSaveCoreChunkReportFromPath(absolutePath);

  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write('\n');

  const reports = 'saves' in report ? report.saves : [report];
  const blockers = reports.flatMap((saveReport) =>
    getSaveCoreChunkBlockers(saveReport.coreChunks).map((blocker) => ({
      savePath: saveReport.savePath,
      blocker,
    })));
  const rawUnsupportedDrawables = reports.flatMap((saveReport) =>
    saveReport.gameClientDrawables
      .filter((drawable) => drawable.mode === 'raw_unsupported')
      .map((drawable) => ({ savePath: saveReport.savePath, drawable })));
  if (strict && report.summary.status === 'blocked') {
    if ('saves' in report && report.saves.length === 0) {
      console.error('Save core chunk strict parity failed: no save fixture files found.');
    }
    console.error(
      `Save core chunk strict parity failed: ${blockers.length} raw/missing core chunk(s), `
      + `${rawUnsupportedDrawables.length} unsupported GameClient drawable(s).`,
    );
    for (const { savePath, blocker } of blockers) {
      console.error(`- ${savePath}: ${blocker.blockName}: ${blocker.mode}`);
    }
    for (const { savePath, drawable } of rawUnsupportedDrawables) {
      console.error(
        `- ${savePath}: CHUNK_GameClient drawable #${drawable.index} `
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
