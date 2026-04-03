import { describe, expect, it } from 'vitest';
import { listSaveGameChunks } from '@generals/engine';

import {
  buildRuntimeSaveFile,
  parseRuntimeSaveFile,
  SOURCE_GAME_MODE_SINGLE_PLAYER,
} from './runtime-save-game.js';

describe('runtime-save-game', () => {
  it('round-trips embedded map data and browser runtime payloads', () => {
    const mapData = {
      heightmap: {
        width: 4,
        height: 4,
        borderSize: 0,
        data: 'AAAAAAAAAAAAAAAAAAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Runtime Save Smoke Test',
      mapPath: 'assets/maps/ScenarioSkirmish.json',
      mapData,
      cameraState: {
        targetX: 18,
        targetZ: 24,
        angle: 0.25,
        zoom: 140,
        pitch: 1,
      },
      gameLogic: {
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: {
            playerSideByIndex: new Map([[0, 'USA']]),
            sideCredits: new Map([['USA', 1337]]),
          },
        }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 41,
          nextProjectileVisualId: 3,
          animationTime: 12.5,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 19,
          frameCounter: 21,
          controlBarDirtyFrame: 21,
          scriptObjectTopologyVersion: 4,
          scriptObjectCountChangedFrame: 20,
          defeatedSides: new Set<string>(['Observer']),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({
          version: 1,
          spawnedEntities: new Map([
            [7, {
              id: 7,
              templateName: 'RuntimeTank',
              kindOf: new Set(['VEHICLE', 'SELECTABLE']),
            }],
          ]),
        }),
        getObjectIdCounter: () => 41,
      },
    });

    expect(listSaveGameChunks(saveFile.data).map((chunk) => chunk.blockName)).toEqual([
      'CHUNK_GameState',
      'CHUNK_Campaign',
      'CHUNK_GameStateMap',
      'CHUNK_Players',
      'CHUNK_GameLogic',
      'CHUNK_TS_RuntimeState',
    ]);

    const parsed = parseRuntimeSaveFile(saveFile.data);
    const playerState = parsed.gameLogicPlayersState;
    const coreState = parsed.gameLogicCoreState;
    const logicState = parsed.gameLogicState as {
      version: number;
      spawnedEntities: Map<number, { id: number; templateName: string; kindOf: Set<string> }>;
    };

    expect(parsed.metadata.description).toBe('Runtime Save Smoke Test');
    expect(parsed.mapPath).toBe('assets/maps/ScenarioSkirmish.json');
    expect(parsed.mapData).toEqual(mapData);
    expect(parsed.cameraState).toEqual({
      targetX: 18,
      targetZ: 24,
      angle: 0.25,
      zoom: 140,
      pitch: 1,
    });
    expect(playerState?.state.playerSideByIndex).toEqual(new Map([[0, 'USA']]));
    expect(coreState?.spawnedEntities).toEqual([]);
    expect(coreState?.selectedEntityId).toBeNull();
    expect(logicState.version).toBe(1);
    expect(logicState.spawnedEntities.get(7)?.templateName).toBe('RuntimeTank');
    expect(logicState.spawnedEntities.get(7)?.kindOf.has('VEHICLE')).toBe(true);
    expect(parsed.campaign).toBeNull();
  });

  it('treats embedded retail map bytes as non-JSON payloads and falls back to map path reload', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
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
      description: 'Retail Map Bytes',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 10,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1, spawnedEntities: [] }),
        getObjectIdCounter: () => 10,
      },
      embeddedMapBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      sourceGameMode: SOURCE_GAME_MODE_SINGLE_PLAYER,
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.mapPath).toBe('maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json');
    expect(parsed.mapData).toBeNull();
    expect(parsed.campaign).toBeNull();
  });

  it('round-trips non-challenge campaign metadata through CHUNK_Campaign', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
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
      description: 'USA Campaign Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA02/MD_USA02.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 22,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1, entities: [] }),
        getObjectIdCounter: () => 22,
      },
      campaign: {
        campaignName: 'usa',
        missionName: 'mission02',
        missionNumber: 1,
        difficulty: 'HARD',
        rankPoints: 0,
        isChallengeCampaign: false,
        playerTemplateNum: -1,
      },
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.metadata.campaignSide).toBe('usa');
    expect(parsed.metadata.missionNumber).toBe(1);
    expect(parsed.campaign).toEqual({
      campaignName: 'usa',
      missionName: 'mission02',
      missionNumber: 1,
      difficulty: 'HARD',
      rankPoints: 0,
      isChallengeCampaign: false,
      playerTemplateNum: -1,
    });
  });

  it('fails loudly when asked to save unsupported challenge campaign state', () => {
    const mapData = {
      heightmap: {
        width: 2,
        height: 2,
        borderSize: 0,
        data: 'AAAAAA==',
      },
      objects: [],
      triggers: [],
      waypoints: { nodes: [], links: [] },
      textureClasses: [],
      blendTileCount: 0,
    };

    expect(() => buildRuntimeSaveFile({
      description: 'Challenge Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_CHALLENGE/MD_CHALLENGE.json',
      mapData,
      cameraState: null,
      gameLogic: {
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          nextId: 5,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: -1,
          frameCounter: 0,
          controlBarDirtyFrame: -1,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set<string>(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 5,
      },
      campaign: {
        campaignName: 'challenge_0',
        missionName: 'mission01',
        missionNumber: 0,
        difficulty: 'NORMAL',
        rankPoints: 0,
        isChallengeCampaign: true,
        playerTemplateNum: 3,
      },
    })).toThrow(/Challenge campaign save-state interoperability is not wired yet/);
  });
});
