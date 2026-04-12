import { describe, expect, it } from 'vitest';

import { buildRuntimeSaveFile } from '../packages/app/src/runtime-save-game.js';
import {
  buildSaveCoreChunkReport,
  getSaveCoreChunkBlockers,
  isSaveFixturePath,
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

  it('passes strict status when every core chunk is parsed or legacy-readable', () => {
    const chunks = [
      { blockName: 'CHUNK_GameState', mode: 'parsed' },
      { blockName: 'CHUNK_GameClient', mode: 'legacy' },
      { blockName: 'CHUNK_GameLogic', mode: 'parsed' },
    ] as const;

    expect(summarizeSaveCoreChunkStatus(chunks)).toEqual({
      status: 'pass',
      totalCoreChunks: 3,
      parsedCoreChunks: 2,
      legacyCoreChunks: 1,
      rawPassthroughCoreChunks: 0,
      missingCoreChunks: 0,
      rawUnsupportedGameClientDrawables: 0,
    });
    expect(getSaveCoreChunkBlockers(chunks)).toEqual([]);
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
      gameLogic: {
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
          nextId: 4,
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
        getObjectIdCounter: () => 4,
      },
    });

    const report = buildSaveCoreChunkReport(saveFile.data, '/fixtures/round-trip.sav');

    expect(report.summary.status).toBe('pass');
    expect(report.roundTrip.status).toBe('pass');
    expect(report.roundTrip.summary?.status).toBe('pass');
  });
});
