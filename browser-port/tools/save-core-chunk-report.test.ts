import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveFileType } from '@generals/engine';

import { buildRuntimeSaveFile, SOURCE_GAME_MODE_SKIRMISH } from '../packages/app/src/runtime-save-game.js';
import {
  buildSaveCoreChunkReport,
  getSaveCoreChunkBlockers,
  isSourceSaveFixtureFile,
  isSaveFixturePath,
  listSaveFixturePaths,
  summarizeSaveCoreChunkStatus,
  summarizeSaveCoreChunkReports,
} from './save-core-chunk-report.js';

describe('save core chunk report', () => {
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
        frameCounter: 0,
        controlBarDirtyFrame: 0,
        scriptObjectTopologyVersion: 0,
        scriptObjectCountChangedFrame: 0,
        defeatedSides: new Set<string>(),
        gameEndFrame: null,
        scriptEndGameTimerActive: false,
        spawnedEntities: [],
      }),
      captureBrowserRuntimeSaveState: () => ({ version: 1 }),
      getObjectIdCounter: () => nextId,
    };
  }

  it('blocks strict status on legacy-readable core chunks', () => {
    const chunks = [
      { blockName: 'CHUNK_GameState', mode: 'parsed' },
      { blockName: 'CHUNK_GameClient', mode: 'legacy' },
      { blockName: 'CHUNK_GameLogic', mode: 'parsed' },
    ] as const;

    expect(summarizeSaveCoreChunkStatus(chunks)).toEqual({
      status: 'blocked',
      totalCoreChunks: 3,
      parsedCoreChunks: 2,
      legacyCoreChunks: 1,
      rawPassthroughCoreChunks: 0,
      missingCoreChunks: 0,
      rawUnsupportedGameClientDrawables: 0,
    });
    expect(getSaveCoreChunkBlockers(chunks)).toEqual([
      { blockName: 'CHUNK_GameClient', mode: 'legacy' },
    ]);
  });

  it('surfaces raw passthrough and missing chunks as strict blockers', () => {
    const chunks = [
      { blockName: 'CHUNK_GameState', mode: 'parsed' },
      { blockName: 'CHUNK_Players', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_TerrainVisual', mode: 'missing' },
    ] as const;

    expect(summarizeSaveCoreChunkStatus(chunks)).toEqual({
      status: 'blocked',
      totalCoreChunks: 3,
      parsedCoreChunks: 1,
      legacyCoreChunks: 0,
      rawPassthroughCoreChunks: 1,
      missingCoreChunks: 1,
      rawUnsupportedGameClientDrawables: 0,
    });
    expect(getSaveCoreChunkBlockers(chunks)).toEqual([
      { blockName: 'CHUNK_Players', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_TerrainVisual', mode: 'missing' },
    ]);
  });

  it('blocks strict status on unsupported inner GameClient drawable records', () => {
    const chunks = [
      { blockName: 'CHUNK_GameClient', mode: 'parsed' },
    ] as const;
    const drawables = [{
      index: 0,
      templateName: 'LegacyScorchMark',
      objectId: 0,
      drawableId: 900,
      version: 5,
      mode: 'raw_unsupported' as const,
    }];

    expect(summarizeSaveCoreChunkStatus(chunks, drawables)).toEqual({
      status: 'blocked',
      totalCoreChunks: 1,
      parsedCoreChunks: 1,
      legacyCoreChunks: 0,
      rawPassthroughCoreChunks: 0,
      missingCoreChunks: 0,
      rawUnsupportedGameClientDrawables: 1,
    });
  });

  it('classifies save fixture file names without accepting arbitrary binaries', () => {
    expect(isSaveFixturePath('/fixtures/USA01.SAV')).toBe(true);
    expect(isSaveFixturePath('/fixtures/usa01.save')).toBe(true);
    expect(isSaveFixturePath('/fixtures/retail-save.bin')).toBe(true);
    expect(isSaveFixturePath('/fixtures/texture.bin')).toBe(false);
    expect(isSaveFixturePath('/fixtures/replay.rep')).toBe(false);
  });

  it('only lists candidate save files with a source save-game header', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'generals-save-fixtures-'));
    try {
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
        description: 'Header Fixture',
        mapPath: 'assets/maps/HeaderFixture.json',
        mapData,
        cameraState: null,
        gameLogic: createRoundTripGameLogic(5),
      });
      const validSavePath = join(tempDir, '00000000.sav');
      const bogusSavePath = join(tempDir, 'scipy-idl.sav');
      const browserSavePath = join(tempDir, 'browser-generated.sav');
      const nestedDir = join(tempDir, 'nested');
      const nestedSavePath = join(nestedDir, 'retail-save.bin');
      const browserSaveFile = buildRuntimeSaveFile({
        description: 'Browser Fixture',
        mapPath: 'assets/maps/BrowserFixture.json',
        mapData,
        cameraState: null,
        includeBrowserRuntimeCoreState: true,
        gameLogic: createRoundTripGameLogic(5),
      });
      mkdirSync(nestedDir);
      writeFileSync(validSavePath, Buffer.from(saveFile.data));
      writeFileSync(bogusSavePath, Buffer.from([0x04, 0x49, 0x44, 0x4c, 0x00]));
      writeFileSync(browserSavePath, Buffer.from(browserSaveFile.data));
      writeFileSync(nestedSavePath, Buffer.from(saveFile.data));

      expect(isSourceSaveFixtureFile(validSavePath)).toBe(true);
      expect(isSourceSaveFixtureFile(bogusSavePath)).toBe(false);
      expect(isSourceSaveFixtureFile(browserSavePath)).toBe(false);
      expect(listSaveFixturePaths(tempDir)).toEqual([validSavePath, nestedSavePath].sort());
      expect(listSaveFixturePaths(join(tempDir, 'missing'))).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('summarizes directory fixture reports and blocks empty wet-test sets', () => {
    expect(summarizeSaveCoreChunkReports([])).toEqual({
      status: 'blocked',
      totalSaveFiles: 0,
      passedSaveFiles: 0,
      blockedSaveFiles: 0,
      totalCoreChunks: 0,
      rawPassthroughCoreChunks: 0,
      missingCoreChunks: 0,
      rawUnsupportedGameClientDrawables: 0,
      blockedRoundTrips: 0,
    });

    expect(summarizeSaveCoreChunkReports([{
      savePath: '/fixtures/pass.sav',
      summary: {
        status: 'pass',
        totalCoreChunks: 17,
        parsedCoreChunks: 17,
        legacyCoreChunks: 0,
        rawPassthroughCoreChunks: 0,
        missingCoreChunks: 0,
        rawUnsupportedGameClientDrawables: 0,
      },
      coreChunks: [],
      gameClientDrawables: [],
      gameLogicLayout: null,
      roundTrip: {
        status: 'pass',
        reason: null,
      },
    }, {
      savePath: '/fixtures/blocked.sav',
      summary: {
        status: 'blocked',
        totalCoreChunks: 17,
        parsedCoreChunks: 15,
        legacyCoreChunks: 0,
        rawPassthroughCoreChunks: 1,
        missingCoreChunks: 1,
        rawUnsupportedGameClientDrawables: 2,
      },
      coreChunks: [],
      gameClientDrawables: [],
      gameLogicLayout: null,
      roundTrip: {
        status: 'blocked',
        reason: 'roundtrip-core-summary-blocked',
      },
    }])).toEqual({
      status: 'blocked',
      totalSaveFiles: 2,
      passedSaveFiles: 1,
      blockedSaveFiles: 1,
      totalCoreChunks: 34,
      rawPassthroughCoreChunks: 1,
      missingCoreChunks: 1,
      rawUnsupportedGameClientDrawables: 2,
      blockedRoundTrips: 1,
    });
  });

  it('round-trips a parsed runtime save back into parsed core chunks', () => {
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
      description: 'Round Trip Fixture',
      mapPath: 'assets/maps/RoundTrip.json',
      mapData,
      cameraState: null,
      sourceDifficulty: 'HARD',
      gameLogic: createRoundTripGameLogic(4),
    });

    const report = buildSaveCoreChunkReport(saveFile.data, '/fixtures/round-trip.sav');

    expect(report.summary.status).toBe('pass');
    expect(report.roundTrip.status).toBe('pass');
    expect(report.roundTrip.summary?.status).toBe('pass');
    expect(report.roundTrip.chunkNamesPreserved).toBe(true);
    expect(report.roundTrip.chunkPayloadBytesPreserved).toBe(true);
    expect(report.roundTrip.changedChunkPayloads).toEqual([]);
    expect(report.roundTrip.metadataPreserved).toBe(true);
    expect(report.roundTrip.gameStateMapHeaderPreserved).toBe(true);
    expect(report.roundTrip.embeddedMapBytesPreserved).toBe(true);
    expect(report.roundTrip.gameStateMapTrailingBytesPreserved).toBe(true);
  });

  it('round-trips parsed source saves with non-JSON embedded map payloads', () => {
    const saveFile = buildRuntimeSaveFile({
      description: 'Retail Map Payload Fixture',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData: null,
      embeddedMapBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      gameStateMapTrailingBytes: new Uint8Array([0xaa, 0xbb, 0xcc]),
      sourceSaveGameMapPath: 'Save\\MD_USA01.map',
      sourcePristineMapPath: 'Maps\\MD_USA01\\MD_USA01.map',
      sourceMetadata: {
        saveFileType: SaveFileType.SAVE_FILE_TYPE_NORMAL,
        missionMapName: '',
        mapLabel: 'GUI:MissionSave',
        campaignSide: 'usa',
        missionNumber: 0,
      },
      sourceGameMode: SOURCE_GAME_MODE_SKIRMISH,
      cameraState: null,
      gameLogic: createRoundTripGameLogic(8),
    });

    const report = buildSaveCoreChunkReport(saveFile.data, '/fixtures/retail-map-payload.sav');

    expect(report.summary.status).toBe('pass');
    expect(report.roundTrip.status).toBe('pass');
    expect(report.roundTrip.reason).toBeNull();
    expect(report.roundTrip.summary?.status).toBe('pass');
    expect(report.roundTrip.chunkNamesPreserved).toBe(true);
    expect(report.roundTrip.chunkPayloadBytesPreserved).toBe(true);
    expect(report.roundTrip.changedChunkPayloads).toEqual([]);
    expect(report.roundTrip.metadataPreserved).toBe(true);
    expect(report.roundTrip.gameStateMapHeaderPreserved).toBe(true);
    expect(report.roundTrip.embeddedMapBytesPreserved).toBe(true);
    expect(report.roundTrip.gameStateMapTrailingBytesPreserved).toBe(true);
  });

  it('round-trips source mission saves as GameState and Campaign only', () => {
    const saveFile = buildRuntimeSaveFile({
      description: 'Mission Save Fixture',
      mapPath: null,
      mapData: null,
      cameraState: null,
      sourceMetadata: {
        saveFileType: SaveFileType.SAVE_FILE_TYPE_MISSION,
        missionMapName: 'Maps\\MD_USA01\\MD_USA01.map',
        mapLabel: 'GUI:MissionSave',
        campaignSide: 'usa',
        missionNumber: 0,
      },
      campaign: {
        campaignName: 'CampaignUSA',
        missionName: 'Mission01',
        missionNumber: 0,
        difficulty: 'HARD',
        rankPoints: 5,
        isChallengeCampaign: false,
        playerTemplateNum: -1,
        sourceMapName: 'Maps\\MD_USA01\\MD_USA01.map',
      },
      gameLogic: createRoundTripGameLogic(8),
    });

    const report = buildSaveCoreChunkReport(saveFile.data, '/fixtures/mission-save.sav');

    expect(report.summary).toMatchObject({
      status: 'pass',
      totalCoreChunks: 2,
      parsedCoreChunks: 2,
    });
    expect(report.coreChunks).toEqual([
      { blockName: 'CHUNK_GameState', mode: 'parsed' },
      { blockName: 'CHUNK_Campaign', mode: 'parsed' },
    ]);
    expect(report.roundTrip.status).toBe('pass');
    expect(report.roundTrip.sourceChunkNames).toEqual(['CHUNK_GameState', 'CHUNK_Campaign']);
    expect(report.roundTrip.chunkNamesPreserved).toBe(true);
    expect(report.roundTrip.chunkPayloadBytesPreserved).toBe(true);
  });
});
