import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildRuntimeSaveFile } from '../packages/app/src/runtime-save-game.js';
import { importSourceSaveFixtures } from './import-source-save-fixtures.js';
import { carveSourceSaveFixtures, findSourceSaveCandidatesInFile } from './source-save-carver.js';

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

function createRoundTripGameLogic(nextId = 4) {
  return {
    captureSourceTerrainLogicRuntimeSaveState: () => ({
      version: 2,
      activeBoundary: 0,
      waterUpdates: [],
    }),
    captureSourcePartitionRuntimeSaveState: () => ({
      version: 2,
      cellSize: 10,
      totalCellCount: 0,
      cells: [],
      pendingUndoShroudReveals: [],
    }),
    captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
    captureSourceRadarRuntimeSaveState: () => ({
      version: 2,
      radarHidden: false,
      radarForced: false,
      localObjectList: [],
      objectList: [],
      events: Array.from({ length: 64 }, () => createEmptyRadarEventState()),
      nextFreeRadarEvent: 0,
      lastRadarEvent: -1,
    }),
    captureSourceSidesListRuntimeSaveState: () => ({ version: 2, state: {}, scriptLists: [] }),
    captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
    captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
    captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
    captureSourceGameLogicRuntimeSaveState: () => ({
      version: 1,
      nextId,
      nextProjectileVisualId: 1,
      animationTime: 0,
      selectedEntityId: null,
      selectedEntityIds: [],
      scriptSelectionChangedFrame: 0,
      controlBarDirtyFrame: 0,
      scriptObjectTopologyVersion: 0,
      scriptObjectCountChangedFrame: 0,
      frameCounter: 0,
      defeatedSides: new Set<string>(),
      gameEndFrame: null,
      scriptEndGameTimerActive: false,
      spawnedEntities: [],
    }),
    captureBrowserRuntimeSaveState: () => ({ version: 1 }),
    getObjectIdCounter: () => nextId,
  };
}

function buildSourceLikeSave(): Buffer {
  const mapData = {
    heightmap: {
      width: 1,
      height: 1,
      borderSize: 0,
      data: 'AAAAAA==',
    },
    objects: [],
    triggers: [],
    waypoints: { nodes: [], links: [] },
    textureClasses: [],
    blendTileCount: 0,
  };
  const saveFile = buildRuntimeSaveFile({
    description: 'Import Fixture',
    mapPath: 'assets/maps/ImportFixture.json',
    mapData,
    cameraState: null,
    gameLogic: createRoundTripGameLogic(5),
  });
  return Buffer.from(saveFile.data);
}

describe('import source save fixtures', () => {
  it('copies only files with source save headers into the wet fixture directory', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'generals-source-save-import-'));
    try {
      const inputDir = join(tempDir, 'input');
      const outputDir = join(tempDir, 'fixtures');
      mkdirSync(inputDir);
      const validSavePath = join(inputDir, 'Mission 01.sav');
      const bogusSavePath = join(inputDir, 'not-a-save.sav');
      const saveData = buildSourceLikeSave();
      writeFileSync(validSavePath, saveData);
      writeFileSync(bogusSavePath, Buffer.from([0x04, 0x49, 0x44, 0x4c, 0x00]));

      const report = importSourceSaveFixtures({
        inputPaths: [inputDir],
        outputDir,
      });

      expect(report.summary).toEqual({
        scannedPaths: 1,
        validSourceSaves: 1,
        imported: 1,
        unchanged: 0,
      });
      expect(report.fixtures).toHaveLength(1);
      expect(report.fixtures[0]?.fixturePath.endsWith('Mission-01.sav')).toBe(true);
      expect(readFileSync(report.fixtures[0]!.fixturePath)).toEqual(saveData);

      const secondReport = importSourceSaveFixtures({
        inputPaths: [inputDir],
        outputDir,
      });
      expect(secondReport.summary.imported).toBe(0);
      expect(secondReport.summary.unchanged).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns a failing report shape when no source saves are found', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'generals-source-save-import-empty-'));
    try {
      const bogusSavePath = join(tempDir, 'not-a-save.sav');
      writeFileSync(bogusSavePath, Buffer.from([0x04, 0x49, 0x44, 0x4c, 0x00]));

      const report = importSourceSaveFixtures({
        inputPaths: [bogusSavePath],
        outputDir: join(tempDir, 'fixtures'),
      });

      expect(report.summary).toEqual({
        scannedPaths: 1,
        validSourceSaves: 0,
        imported: 0,
        unchanged: 0,
      });
      expect(report.fixtures).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('carves embedded source saves from opaque capture files without accepting browser saves', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'generals-source-save-carve-'));
    try {
      const outputDir = join(tempDir, 'fixtures');
      const capturePath = join(tempDir, 'disk-capture.bin');
      const sourceSave = buildSourceLikeSave();
      const browserSave = Buffer.from(buildRuntimeSaveFile({
        description: 'Browser Save',
        mapPath: 'assets/maps/BrowserFixture.json',
        mapData: {
          heightmap: {
            width: 1,
            height: 1,
            borderSize: 0,
            data: 'AAAAAA==',
          },
          objects: [],
          triggers: [],
          waypoints: { nodes: [], links: [] },
          textureClasses: [],
          blendTileCount: 0,
        },
        cameraState: null,
        includeBrowserRuntimeCoreState: true,
        gameLogic: createRoundTripGameLogic(6),
      }).data);
      const prefix = Buffer.from([
        0x00,
        ...Buffer.from('CHUNK_GameState', 'ascii'),
        0x41,
        0x42,
        0x43,
      ]);
      writeFileSync(capturePath, Buffer.concat([
        prefix,
        sourceSave,
        Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        browserSave,
      ]));

      const candidates = findSourceSaveCandidatesInFile(capturePath, {
        scanChunkBytes: 32,
        maxCarveBytes: sourceSave.byteLength + browserSave.byteLength + 32,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.offset).toBe(prefix.byteLength);
      expect(candidates[0]?.data).toEqual(sourceSave);

      const report = carveSourceSaveFixtures({
        inputPaths: [capturePath],
        outputDir,
        scanChunkBytes: 32,
        maxCarveBytes: sourceSave.byteLength + browserSave.byteLength + 32,
      });

      expect(report.summary).toEqual({
        scannedPaths: 1,
        scannedFiles: 1,
        sourceSaveCandidates: 1,
        imported: 1,
        unchanged: 0,
      });
      expect(report.fixtures).toHaveLength(1);
      expect(readFileSync(report.fixtures[0]!.fixturePath)).toEqual(sourceSave);

      const secondReport = carveSourceSaveFixtures({
        inputPaths: [capturePath],
        outputDir,
        scanChunkBytes: 32,
        maxCarveBytes: sourceSave.byteLength + browserSave.byteLength + 32,
      });
      expect(secondReport.summary.imported).toBe(0);
      expect(secondReport.summary.unchanged).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
