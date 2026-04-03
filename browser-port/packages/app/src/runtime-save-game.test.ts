import { describe, expect, it } from 'vitest';
import { listSaveGameChunks } from '@generals/engine';

import {
  buildRuntimeSaveFile,
  parseRuntimeSaveFile,
  SOURCE_GAME_MODE_SINGLE_PLAYER,
} from './runtime-save-game.js';

function createEmptyRadarEvent() {
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

function createEmptyRadarState() {
  return {
    version: 2 as const,
    radarHidden: false,
    radarForced: false,
    localObjectList: [],
    objectList: [],
    events: Array.from({ length: 64 }, () => createEmptyRadarEvent()),
    nextFreeRadarEvent: 0,
    lastRadarEvent: -1,
  };
}

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
        captureSourceRadarRuntimeSaveState: () => ({
          ...createEmptyRadarState(),
          radarHidden: true,
          localObjectList: [{ objectId: 7, color: -16711936 }],
          events: Array.from({ length: 64 }, (_, index) => index === 0
            ? {
                type: 4,
                active: true,
                createFrame: 31,
                dieFrame: 151,
                fadeFrame: 136,
                color1: { red: 255, green: 255, blue: 0, alpha: 255 },
                color2: { red: 255, green: 255, blue: 128, alpha: 255 },
                worldLoc: { x: 18, y: 24, z: 0 },
                radarLoc: { x: 9, y: 12 },
                soundPlayed: false,
                sourceEntityId: 7,
                sourceTeamName: 'TEAMTHEPLAYER',
              }
            : createEmptyRadarEvent()),
          nextFreeRadarEvent: 1,
          lastRadarEvent: 0,
        }),
        captureSourceScriptEngineRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptCountersByName: new Map([['missiontimer', { value: 90, isCountdownTimer: true }]]),
            scriptFlagsByName: new Map([['intro_complete', true]]),
            scriptCompletedVideos: ['USA_BNN_INTRO'],
          },
        }),
        captureSourceInGameUiRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptDisplayedCounters: new Map([['SupplyDrop', { value: 3, visible: true }]]),
            scriptNamedTimerDisplayEnabled: false,
            scriptSpecialPowerDisplayEnabled: true,
            scriptHiddenSpecialPowerDisplayEntityIds: new Set<number>([7]),
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
      'CHUNK_Radar',
      'CHUNK_ScriptEngine',
      'CHUNK_TacticalView',
      'CHUNK_InGameUI',
      'CHUNK_TS_RuntimeState',
    ]);

    const parsed = parseRuntimeSaveFile(saveFile.data);
    const playerState = parsed.gameLogicPlayersState;
    const radarState = parsed.gameLogicRadarState;
    const scriptEngineState = parsed.gameLogicScriptEngineState;
    const inGameUiState = parsed.gameLogicInGameUiState;
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
    expect(parsed.tacticalViewState).toEqual({
      version: 1,
      angle: 0.25,
      position: {
        x: 18,
        y: 0,
        z: 24,
      },
    });
    expect(playerState?.state.playerSideByIndex).toEqual(new Map([[0, 'USA']]));
    expect(radarState?.version).toBe(2);
    if (!radarState || radarState.version !== 2) {
      throw new Error('Expected structured radar payload');
    }
    expect(radarState.radarHidden).toBe(true);
    expect(radarState.localObjectList).toEqual([{ objectId: 7, color: -16711936 }]);
    expect(radarState.events[0]).toEqual({
      type: 4,
      active: true,
      createFrame: 31,
      dieFrame: 151,
      fadeFrame: 136,
      color1: { red: 255, green: 255, blue: 0, alpha: 255 },
      color2: { red: 255, green: 255, blue: 128, alpha: 255 },
      worldLoc: { x: 18, y: 24, z: 0 },
      radarLoc: { x: 9, y: 12 },
      soundPlayed: false,
      sourceEntityId: 7,
      sourceTeamName: 'TEAMTHEPLAYER',
    });
    expect(radarState.nextFreeRadarEvent).toBe(1);
    expect(radarState.lastRadarEvent).toBe(0);
    expect(scriptEngineState?.state.scriptCountersByName).toEqual(
      new Map([['missiontimer', { value: 90, isCountdownTimer: true }]]),
    );
    expect(scriptEngineState?.state.scriptFlagsByName).toEqual(new Map([['intro_complete', true]]));
    expect(scriptEngineState?.state.scriptCompletedVideos).toEqual(['USA_BNN_INTRO']);
    expect(inGameUiState?.state.scriptNamedTimerDisplayEnabled).toBe(false);
    expect(inGameUiState?.state.scriptHiddenSpecialPowerDisplayEntityIds).toEqual(new Set([7]));
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
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
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
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
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
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
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
