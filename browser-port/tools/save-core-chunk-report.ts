import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listSaveGameChunks, parseSaveGameInfo, parseSaveGameMapInfo } from '@generals/engine';
import {
  buildRuntimeSaveFile,
  inspectGameLogicChunkLayout,
  inspectRuntimeSaveGameClientDrawableHydrationStatus,
  inspectRuntimeSaveCoreChunkStatus,
  parseRuntimeSaveFile,
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
  roundTrip: SaveCoreChunkRoundTripReport;
}

export interface SaveCoreChunkRoundTripReport {
  status: 'pass' | 'blocked' | 'skipped';
  reason: string | null;
  summary?: SaveCoreChunkReportSummary;
  sourceChunkNames?: string[];
  rebuiltChunkNames?: string[];
  chunkNamesPreserved?: boolean;
  metadataPreserved?: boolean;
  embeddedMapBytesPreserved?: boolean;
  gameStateMapTrailingBytesPreserved?: boolean;
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
  blockedRoundTrips: number;
}

export interface SaveCoreChunkCollectionReport {
  rootPath: string;
  summary: SaveCoreChunkCollectionReportSummary;
  saves: SaveCoreChunkReport[];
}

const SAVE_FIXTURE_EXTENSIONS = new Set(['.sav', '.save']);
const SKIPPED_FIXTURE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build']);
const SOURCE_SAVE_FIRST_BLOCK = 'CHUNK_GameState';

export function isSaveFixturePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const extension = extname(normalized);
  if (SAVE_FIXTURE_EXTENSIONS.has(extension)) {
    return true;
  }
  return extension === '.bin' && basename(normalized).includes('save');
}

function readFirstSaveBlockName(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const header = Buffer.alloc(256);
    const bytesRead = readSync(fd, header, 0, header.byteLength, 0);
    if (bytesRead < 1) {
      return null;
    }
    const length = header.readUInt8(0);
    if (length <= 0 || bytesRead < 1 + length) {
      return null;
    }
    return header.subarray(1, 1 + length).toString('ascii');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

export function isSourceSaveFixtureFile(filePath: string): boolean {
  return readFirstSaveBlockName(filePath)?.toLowerCase() === SOURCE_SAVE_FIRST_BLOCK.toLowerCase();
}

export function listSaveFixturePaths(inputPath: string): string[] {
  const stats = statSync(inputPath);
  if (stats.isFile()) {
    return isSourceSaveFixtureFile(inputPath) ? [inputPath] : [];
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
      if (entry.isFile() && isSaveFixturePath(entryPath) && isSourceSaveFixtureFile(entryPath)) {
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
    blockedRoundTrips: reports.filter((report) => report.roundTrip.status === 'blocked').length,
  };
}

function createEmptyRadarEventState() {
  return {
    type: 0,
    active: false,
    createFrame: 0,
    dieFrame: 0,
    fadeFrame: 0,
    color1: { red: 0, green: 0, blue: 0, alpha: 0 },
    color2: { red: 0, green: 0, blue: 0, alpha: 0 },
    worldLoc: { x: 0, y: 0, z: 0 },
    radarLoc: { x: 0, y: 0 },
    soundPlayed: false,
    sourceEntityId: null,
    sourceTeamName: null,
  };
}

function createFallbackGameLogicCoreState(nextId: number) {
  return {
    version: 1,
    nextId: Math.max(1, Math.trunc(nextId) || 1),
    nextProjectileVisualId: 1,
    animationTime: 0,
    selectedEntityId: null,
    selectedEntityIds: [],
    scriptSelectionChangedFrame: 0,
    frameCounter: 0,
    controlBarDirtyFrame: 0,
    scriptObjectTopologyVersion: 0,
    scriptObjectCountChangedFrame: 0,
    defeatedSides: new Set<string>(),
    gameEndFrame: null,
    scriptEndGameTimerActive: false,
    spawnedEntities: [],
  };
}

function buildRoundTripSaveData(data: ArrayBuffer): ArrayBuffer | null {
  const parsed = parseRuntimeSaveFile(data);
  const fallbackCoreState = createFallbackGameLogicCoreState(parsed.mapObjectIdCounter);
  return buildRuntimeSaveFile({
    description: parsed.metadata.description,
    mapPath: parsed.mapPath,
    mapData: parsed.mapData,
    embeddedMapBytes: new Uint8Array(parsed.embeddedMapBytes),
    gameStateMapTrailingBytes: new Uint8Array(parsed.gameStateMapTrailingBytes),
    sourceMetadata: parsed.metadata,
    cameraState: parsed.cameraState,
    tacticalViewState: parsed.tacticalViewState,
    gameClientState: parsed.gameClientState,
    inGameUiState: parsed.inGameUiState,
    scriptEngineFadeState: parsed.scriptEngineFadeState,
    particleSystemState: parsed.particleSystemState,
    ghostObjectState: parsed.ghostObjectState,
    passthroughBlocks: parsed.passthroughBlocks,
    campaign: parsed.campaign,
    browserRuntimeState: parsed.gameLogicState ?? { version: 1 },
    includeBrowserRuntimeCoreState: parsed.gameLogicCoreState !== null,
    mapDrawableIdCounter: parsed.mapDrawableIdCounter,
    gameLogic: {
      captureSourceTerrainLogicRuntimeSaveState: () => parsed.gameLogicTerrainLogicState ?? {
        version: 2,
        activeBoundary: 0,
        waterUpdates: [],
      },
      captureSourcePartitionRuntimeSaveState: () => parsed.gameLogicPartitionState ?? {
        version: 2,
        cellSize: 10,
        totalCellCount: 0,
        cells: [],
        pendingUndoShroudReveals: [],
      },
      captureSourcePlayerRuntimeSaveState: () => parsed.gameLogicPlayersState ?? { version: 1, state: {} },
      captureSourceRadarRuntimeSaveState: () => parsed.gameLogicRadarState ?? {
        version: 2,
        radarHidden: false,
        radarForced: false,
        localObjectList: [],
        objectList: [],
        events: Array.from({ length: 64 }, () => createEmptyRadarEventState()),
        nextFreeRadarEvent: 0,
        lastRadarEvent: -1,
      },
      captureSourceSidesListRuntimeSaveState: () => parsed.gameLogicSidesListState ?? {
        version: 2,
        state: {},
        scriptLists: [],
      },
      captureSourceTeamFactoryRuntimeSaveState: () => parsed.gameLogicTeamFactoryState ?? { version: 1, state: {} },
      captureSourceScriptEngineRuntimeSaveState: () => parsed.gameLogicScriptEngineState ?? { version: 1, state: {} },
      captureSourceInGameUiRuntimeSaveState: () => parsed.gameLogicInGameUiState ?? { version: 1, state: {} },
      captureSourceGameLogicRuntimeSaveState: () => parsed.gameLogicCoreState ?? fallbackCoreState,
      captureBrowserRuntimeSaveState: () => parsed.gameLogicState ?? { version: 1 },
      getObjectIdCounter: () => parsed.gameLogicCoreState?.nextId ?? parsed.mapObjectIdCounter,
    },
  }).data;
}

function arrayBuffersEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return false;
    }
  }
  return true;
}

function arrayValuesEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildSaveMetadataIdentity(data: ArrayBuffer): Record<string, unknown> {
  const metadata = parseSaveGameInfo(data);
  return {
    saveFileType: metadata.saveFileType,
    missionMapName: metadata.missionMapName,
    description: metadata.description,
    mapLabel: metadata.mapLabel,
    campaignSide: metadata.campaignSide,
    missionNumber: metadata.missionNumber,
  };
}

function buildSaveCoreChunkRoundTripReport(
  data: ArrayBuffer,
  savePath: string,
): SaveCoreChunkRoundTripReport {
  try {
    const rebuiltData = buildRoundTripSaveData(data);
    if (rebuiltData === null) {
      return {
        status: 'blocked',
        reason: 'missing-map-payload',
      };
    }
    const rebuiltReport = buildSaveCoreChunkReport(rebuiltData, `${savePath}#roundtrip`, {
      includeRoundTrip: false,
    });
    const sourceChunkNames = listSaveGameChunks(data).map((chunk) => chunk.blockName);
    const rebuiltChunkNames = listSaveGameChunks(rebuiltData).map((chunk) => chunk.blockName);
    const chunkNamesPreserved = arrayValuesEqual(sourceChunkNames, rebuiltChunkNames);
    const metadataPreserved = JSON.stringify(buildSaveMetadataIdentity(data))
      === JSON.stringify(buildSaveMetadataIdentity(rebuiltData));
    const sourceMapInfo = parseSaveGameMapInfo(data);
    const rebuiltMapInfo = parseSaveGameMapInfo(rebuiltData);
    const embeddedMapBytesPreserved = arrayBuffersEqual(
      sourceMapInfo.embeddedMapData,
      rebuiltMapInfo.embeddedMapData,
    );
    const gameStateMapTrailingBytesPreserved = arrayBuffersEqual(
      sourceMapInfo.trailingBytes,
      rebuiltMapInfo.trailingBytes,
    );
    const preservationBlockReason = !chunkNamesPreserved
      ? 'roundtrip-chunk-names-changed'
      : !metadataPreserved
        ? 'roundtrip-metadata-changed'
        : !embeddedMapBytesPreserved
          ? 'roundtrip-map-payload-changed'
          : !gameStateMapTrailingBytesPreserved
            ? 'roundtrip-gamestate-map-trailing-bytes-changed'
            : null;
    const status = preservationBlockReason === null
      ? rebuiltReport.summary.status
      : 'blocked';
    return {
      status,
      reason: preservationBlockReason
        ?? (rebuiltReport.summary.status === 'pass' ? null : 'roundtrip-core-summary-blocked'),
      summary: rebuiltReport.summary,
      sourceChunkNames,
      rebuiltChunkNames,
      chunkNamesPreserved,
      metadataPreserved,
      embeddedMapBytesPreserved,
      gameStateMapTrailingBytesPreserved,
    };
  } catch (error) {
    return {
      status: 'blocked',
      reason: error instanceof Error ? error.message : 'roundtrip-build-failed',
    };
  }
}

export function buildSaveCoreChunkReport(
  data: ArrayBuffer,
  savePath: string,
  options: { includeRoundTrip?: boolean } = {},
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
    roundTrip: options.includeRoundTrip === false
      ? { status: 'skipped', reason: 'disabled' }
      : buildSaveCoreChunkRoundTripReport(data, savePath),
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
