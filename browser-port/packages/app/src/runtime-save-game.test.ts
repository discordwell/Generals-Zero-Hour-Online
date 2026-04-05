import { describe, expect, it } from 'vitest';
import { XferLoad, XferSave, listSaveGameChunks } from '@generals/engine';

import {
  buildRuntimeSaveFile,
  parseRuntimeSaveFile,
  SOURCE_GAME_MODE_SINGLE_PLAYER,
} from './runtime-save-game.js';
import { applySourceTeamFactoryChunkToState } from './runtime-team-factory-save.js';

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

function createEmptyPartitionState() {
  return {
    version: 2 as const,
    cellSize: 10,
    totalCellCount: 0,
    cells: [],
    pendingUndoShroudReveals: [],
  };
}

type TeamFactoryPrototypeSkeleton = {
  nameUpper: string;
  prototypeNameUpper: string;
  sourcePrototypeId: number | undefined;
  sourceTeamId: number | null;
  memberEntityIds: Set<number>;
  created: boolean;
  stateName: string;
  attackPrioritySetName: string;
  recruitableOverride: boolean | null;
  isAIRecruitable: boolean;
  homeWaypointName: string;
  controllingSide: string | null;
  controllingPlayerToken: string | null;
  isSingleton: boolean;
  maxInstances: number;
  productionPriority: number;
  productionPrioritySuccessIncrease: number;
  productionPriorityFailureDecrease: number;
  reinforcementUnitEntries: Array<{ templateName: string; minUnits: number; maxUnits: number }>;
  reinforcementTransportTemplateName: string;
  reinforcementStartWaypointName: string;
  reinforcementTeamStartsFull: boolean;
  reinforcementTransportsExit: boolean;
};

function createTeamFactoryPrototypeSkeleton(
  prototypeNameUpper: string,
  overrides: Partial<TeamFactoryPrototypeSkeleton> = {},
) {
  return {
    nameUpper: prototypeNameUpper,
    prototypeNameUpper,
    sourcePrototypeId: undefined,
    sourceTeamId: null,
    memberEntityIds: new Set<number>(),
    created: false,
    stateName: '',
    attackPrioritySetName: '',
    recruitableOverride: null,
    isAIRecruitable: false,
    homeWaypointName: '',
    controllingSide: null,
    controllingPlayerToken: null,
    isSingleton: true,
    maxInstances: 0,
    productionPriority: 0,
    productionPrioritySuccessIncrease: 0,
    productionPriorityFailureDecrease: 0,
    reinforcementUnitEntries: [],
    reinforcementTransportTemplateName: '',
    reinforcementStartWaypointName: '',
    reinforcementTeamStartsFull: false,
    reinforcementTransportsExit: false,
    ...overrides,
  };
}

function createEmptyTeamFactoryState(
  prototypeNameUpper: string | null = null,
  prototypeOverrides: Partial<ReturnType<typeof createTeamFactoryPrototypeSkeleton>> = {},
) {
  if (prototypeNameUpper === null) {
    return {
      version: 1 as const,
      state: {
        scriptTeamsByName: new Map(),
        scriptTeamInstanceNamesByPrototypeName: new Map(),
        scriptNextSourceTeamId: 1,
        scriptNextSourceTeamPrototypeId: 1,
      },
    };
  }

  return {
    version: 1 as const,
    state: {
      scriptTeamsByName: new Map([
        [prototypeNameUpper, createTeamFactoryPrototypeSkeleton(prototypeNameUpper, prototypeOverrides)],
      ]),
      scriptTeamInstanceNamesByPrototypeName: new Map([[prototypeNameUpper, [prototypeNameUpper]]]),
      scriptNextSourceTeamId: 1,
      scriptNextSourceTeamPrototypeId: 1,
    },
  };
}

function readSaveChunkData(data: ArrayBuffer, blockName: string): Uint8Array | null {
  const chunk = listSaveGameChunks(data).find(
    (candidate) => candidate.blockName.toLowerCase() === blockName.toLowerCase(),
  );
  if (!chunk) {
    return null;
  }
  return new Uint8Array(data, chunk.blockDataOffset, chunk.blockSize).slice();
}

function createRawGameClientDrawableBlockData(objectId: number, drawableId: number): ArrayBuffer {
  const xferSave = new XferSave();
  xferSave.open('create-raw-game-client-drawable-block-data');
  try {
    xferSave.xferObjectID(objectId);
    xferSave.xferVersion(5);
    xferSave.xferUnsignedInt(drawableId);
    xferSave.xferUser(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
    return xferSave.getBuffer();
  } finally {
    xferSave.close();
  }
}

function readGameClientChunk(data: ArrayBuffer): {
  version: number;
  frame: number;
  tocVersion: number;
  tocCount: number;
  tocEntries: string[];
  drawableCount: number;
  drawableObjectIds: number[];
  drawableIds: number[];
  briefingLines: string[];
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_GameClient');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-game-client-chunk');
  try {
    const version = xferLoad.xferVersion(3);
    const frame = xferLoad.xferUnsignedInt(0);
    const tocVersion = xferLoad.xferVersion(1);
    const tocCount = xferLoad.xferUnsignedInt(0);
    const tocEntries: string[] = [];
    for (let index = 0; index < tocCount; index += 1) {
      tocEntries.push(xferLoad.xferAsciiString(''));
      xferLoad.xferUnsignedShort(0);
    }
    const drawableCount = xferLoad.xferUnsignedShort(0);
    const drawableObjectIds: number[] = [];
    const drawableIds: number[] = [];
    for (let index = 0; index < drawableCount; index += 1) {
      xferLoad.xferUnsignedShort(0);
      const blockSize = xferLoad.beginBlock();
      const blockStart = xferLoad.getOffset();
      drawableObjectIds.push(xferLoad.xferObjectID(0));
      xferLoad.xferVersion(5);
      drawableIds.push(xferLoad.xferUnsignedInt(0));
      const bytesConsumed = xferLoad.getOffset() - blockStart;
      xferLoad.skip(blockSize - bytesConsumed);
      xferLoad.endBlock();
    }
    const briefingCount = xferLoad.xferInt(0);
    const briefingLines: string[] = [];
    for (let index = 0; index < briefingCount; index += 1) {
      briefingLines.push(xferLoad.xferAsciiString(''));
    }
    return {
      version,
      frame,
      tocVersion,
      tocCount,
      tocEntries,
      drawableCount,
      drawableObjectIds,
      drawableIds,
      briefingLines,
    };
  } finally {
    xferLoad.close();
  }
}

function readTerrainVisualChunk(data: ArrayBuffer): {
  version: number;
  baseVersion: number;
  waterGridEnabled: boolean;
  heightmapBytes: Uint8Array;
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_TerrainVisual');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-terrain-visual-chunk');
  try {
    const version = xferLoad.xferVersion(2);
    const baseVersion = xferLoad.xferVersion(1);
    const waterGridEnabled = xferLoad.xferBool(false);
    const byteCount = xferLoad.xferInt(0);
    const heightmapBytes = chunkData.slice(xferLoad.getOffset(), xferLoad.getOffset() + byteCount);
    xferLoad.skip(byteCount);
    return {
      version,
      baseVersion,
      waterGridEnabled,
      heightmapBytes,
    };
  } finally {
    xferLoad.close();
  }
}

function readGhostObjectChunk(data: ArrayBuffer): {
  version: number;
  baseVersion: number;
  localPlayerIndex: number;
  count: number;
} | null {
  const chunkData = readSaveChunkData(data, 'CHUNK_GhostObject');
  if (!chunkData) {
    return null;
  }
  const xferLoad = new XferLoad(chunkData.buffer);
  xferLoad.open('read-ghost-object-chunk');
  try {
    const version = xferLoad.xferVersion(1);
    const baseVersion = xferLoad.xferVersion(1);
    const localPlayerIndex = xferLoad.xferInt(0);
    const count = xferLoad.xferUnsignedShort(0);
    return {
      version,
      baseVersion,
      localPlayerIndex,
      count,
    };
  } finally {
    xferLoad.close();
  }
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
      gameClientBriefingLines: ['MISSION_BRIEFING_ALPHA', 'MISSION_BRIEFING_BETA'],
      cameraState: {
        targetX: 18,
        targetZ: 24,
        angle: 0.25,
        zoom: 140,
        pitch: 1,
      },
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 3,
          waterUpdates: [{
            triggerId: 9,
            changePerFrame: 0.5,
            targetHeight: 10,
            damageAmount: 25,
            currentHeight: 4,
          }],
        }),
        captureSourcePartitionRuntimeSaveState: () => ({
          version: 2,
          cellSize: 10,
          totalCellCount: 2,
          cells: [
            {
              shroudLevels: Array.from({ length: 8 }, (_, index) => ({
                currentShroud: index === 0 ? 0 : 1,
                activeShroudLevel: 0,
              })),
            },
            {
              shroudLevels: Array.from({ length: 8 }, (_, index) => ({
                currentShroud: index === 0 ? -1 : 1,
                activeShroudLevel: index === 1 ? 1 : 0,
              })),
            },
          ],
          pendingUndoShroudReveals: [],
        }),
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: {
            playerSideByIndex: new Map([[0, 'USA']]),
            sideCredits: new Map([['USA', 1337]]),
            controllingPlayerScriptCredits: new Map([['the_player', 900]]),
            controllingPlayerScriptSciences: new Map([['the_player', new Set(['SCIENCE_ANTHRAX_BOMB'])]]),
            sideMissionAttempts: new Map([['USA', 2]]),
          },
          tunnelTrackers: [{
            side: 'america',
            tracker: {
              tunnelIds: [21, 22],
              passengerIds: [77],
              tunnelCount: 2,
            },
          }],
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
        captureSourceSidesListRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptPlayerSideByName: new Map([['THE_PLAYER', 'america']]),
            scriptDefaultTeamNameBySide: new Map([['america', 'TEAMTHEPLAYER']]),
            mapScriptSideByIndex: ['america'],
            mapScriptDifficultyByIndex: [1],
            mapScriptDifficultyByPlayerToken: new Map([['THE_PLAYER', 1]]),
            scriptAiBuildListEntriesBySide: new Map([['america', [{
              buildingName: 'AmericaBarracks',
              templateName: 'AmericaBarracks',
              x: 12,
              z: 18,
              rebuilds: 0,
              angle: 0,
              initiallyBuilt: true,
              automaticallyBuild: true,
              priorityBuild: false,
            }]]]),
            mapScriptLists: [{
              scripts: [{
                name: 'IntroScript',
                nameUpper: 'INTROSCRIPT',
                active: true,
                oneShot: false,
                easy: true,
                normal: true,
                hard: true,
                subroutine: false,
                delayEvaluationSeconds: 0,
                frameToEvaluateAt: 0,
                conditionTeamNameUpper: null,
                sourceSideIndex: 0,
                conditions: [],
                actions: [],
                falseActions: [],
              }],
              groups: [],
            }],
            mapScriptsByNameUpper: new Map([['INTROSCRIPT', {
              name: 'IntroScript',
              nameUpper: 'INTROSCRIPT',
              active: true,
              oneShot: false,
              easy: true,
              normal: true,
              hard: true,
              subroutine: false,
              delayEvaluationSeconds: 0,
              frameToEvaluateAt: 0,
              conditionTeamNameUpper: null,
              sourceSideIndex: 0,
              conditions: [],
              actions: [],
              falseActions: [],
            }]]),
            mapScriptGroupsByNameUpper: new Map(),
          },
        }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({
          version: 1,
          state: {
            scriptTeamsByName: new Map([['TEAMTHEPLAYER', {
              nameUpper: 'TEAMTHEPLAYER',
              prototypeNameUpper: 'TEAMTHEPLAYER',
              memberEntityIds: new Set([7]),
              created: true,
              stateName: 'ATTACKING',
              attackPrioritySetName: 'ANTIVEHICLESET',
              recruitableOverride: null,
              isAIRecruitable: true,
              homeWaypointName: 'HOME',
              controllingSide: 'america',
              controllingPlayerToken: 'the_player',
              isSingleton: true,
              maxInstances: 1,
              productionPriority: 3,
              productionPrioritySuccessIncrease: 0,
              productionPriorityFailureDecrease: 0,
              reinforcementUnitEntries: [],
              reinforcementTransportTemplateName: '',
              reinforcementStartWaypointName: '',
              reinforcementTeamStartsFull: false,
              reinforcementTransportsExit: false,
            }]]),
            scriptTeamInstanceNamesByPrototypeName: new Map([['TEAMTHEPLAYER', ['TEAMTHEPLAYER']]]),
          },
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
          gameRandomSeed: 123456789,
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
          rankLevelLimit: 7,
          difficultyBonusesInitialized: true,
          scriptScoringEnabled: false,
          spawnedEntities: [],
          caveTrackers: [{
            caveIndex: 4,
            tracker: {
              tunnelIds: [91],
              passengerIds: [92, 93],
              tunnelCount: 1,
            },
          }],
          sellingEntities: [{ entityId: 7, sellFrame: 11 }],
          buildableOverrides: [{
            templateName: 'AmericaBarracks',
            buildableStatus: 'NO',
          }],
          controlBarOverrides: [{
            commandSetName: 'AMERICABARRACKSCOMMANDSET',
            slot: 1,
            commandButtonName: 'COMMAND_AMERICA_BARRACKS',
          }],
          bridgeSegments: [{
            segmentId: 4,
            passable: true,
            cellIndices: [10, 11],
            transitionIndices: [22],
            controlEntityIds: [101, 102],
            startWorldX: 1,
            startWorldZ: 2,
            endWorldX: 3,
            endWorldZ: 4,
            startSurfaceY: 5,
            endSurfaceY: 6,
          }],
          pendingWeaponDamageEvents: [{
            sourceEntityId: 7,
            primaryVictimEntityId: null,
            impactX: 18,
            impactY: 0,
            impactZ: 24,
            executeFrame: 55,
            projectilePlannedImpactFrame: 55,
            delivery: 'PROJECTILE',
            weaponName: 'TestMissile',
            launchFrame: 21,
            sourceX: 10,
            sourceY: 0,
            sourceZ: 10,
            projectileVisualId: 3,
            bezierP1Y: 0,
            bezierP2Y: 0,
            bezierFirstPercentIndent: 0,
            bezierSecondPercentIndent: 0,
            hasBezierArc: false,
            countermeasureDivertFrame: 0,
            countermeasureNoDamage: false,
            suppressImpactVisual: false,
            missileAIState: null,
            scriptWaypointPath: [{ x: 14, z: 16 }],
            damageFXOverride: 'SMALL_ARMS',
            sourceTemplateName: 'RuntimeTank',
          }],
          historicDamageLog: [{
            weaponName: 'TestMissile',
            hits: [{ frame: 20, x: 14, z: 16 }],
          }],
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
      'CHUNK_TerrainLogic',
      'CHUNK_TeamFactory',
      'CHUNK_Players',
      'CHUNK_GameLogic',
      'CHUNK_Radar',
      'CHUNK_ScriptEngine',
      'CHUNK_SidesList',
      'CHUNK_TacticalView',
      'CHUNK_GameClient',
      'CHUNK_InGameUI',
      'CHUNK_Partition',
      'CHUNK_ParticleSystem',
      'CHUNK_TerrainVisual',
      'CHUNK_GhostObject',
      'CHUNK_TS_RuntimeState',
    ]);

    const parsed = parseRuntimeSaveFile(saveFile.data);
    const playerState = parsed.gameLogicPlayersState;
    const partitionState = parsed.gameLogicPartitionState;
    const radarState = parsed.gameLogicRadarState;
    const sidesListState = parsed.gameLogicSidesListState;
    const teamFactoryState = parsed.gameLogicTeamFactoryState
      ?? (
        parsed.sourceTeamFactoryChunkData
          ? applySourceTeamFactoryChunkToState(
              parsed.sourceTeamFactoryChunkData,
              createEmptyTeamFactoryState('TEAMTHEPLAYER', {
                attackPrioritySetName: 'ANTIVEHICLESET',
                isAIRecruitable: true,
                homeWaypointName: 'HOME',
                controllingSide: 'america',
                controllingPlayerToken: 'the_player',
                isSingleton: true,
                maxInstances: 1,
                productionPriority: 3,
              }),
              parsed.gameLogicPlayersState,
              parsed.gameLogicSidesListState,
            )
          : null
      );
    const scriptEngineState = parsed.gameLogicScriptEngineState;
    const inGameUiState = parsed.gameLogicInGameUiState;
    const terrainLogicState = parsed.gameLogicTerrainLogicState;
    const coreState = parsed.gameLogicCoreState;
    const logicState = parsed.gameLogicState as {
      version: number;
      spawnedEntities: Map<number, { id: number; templateName: string; kindOf: Set<string> }>;
    };
    const gameClientChunk = readGameClientChunk(saveFile.data);
    const terrainVisualChunk = readTerrainVisualChunk(saveFile.data);
    const ghostObjectChunk = readGhostObjectChunk(saveFile.data);

    expect(parsed.metadata.description).toBe('Runtime Save Smoke Test');
    expect(gameClientChunk).toEqual({
      version: 3,
      frame: 21,
      tocVersion: 1,
      tocCount: 0,
      tocEntries: [],
      drawableCount: 0,
      drawableObjectIds: [],
      drawableIds: [],
      briefingLines: ['MISSION_BRIEFING_ALPHA', 'MISSION_BRIEFING_BETA'],
    });
    expect(parsed.gameClientState).toEqual({
      version: 3,
      prefixBytes: expect.any(ArrayBuffer),
      briefingLines: ['MISSION_BRIEFING_ALPHA', 'MISSION_BRIEFING_BETA'],
      drawables: [],
    });
    expect(terrainVisualChunk).toEqual({
      version: 2,
      baseVersion: 1,
      waterGridEnabled: false,
      heightmapBytes: new Uint8Array(16),
    });
    expect(ghostObjectChunk).toEqual({
      version: 1,
      baseVersion: 1,
      localPlayerIndex: 0,
      count: 0,
    });
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
    expect(terrainLogicState).toEqual({
      version: 2,
      activeBoundary: 3,
      waterUpdates: [{
        triggerId: 9,
        changePerFrame: 0.5,
        targetHeight: 10,
        damageAmount: 25,
        currentHeight: 4,
      }],
    });
    expect(partitionState).toEqual({
      version: 2,
      cellSize: 10,
      totalCellCount: 2,
      cells: [
        {
          shroudLevels: Array.from({ length: 8 }, (_, index) => ({
            currentShroud: index === 0 ? 0 : 1,
            activeShroudLevel: 0,
          })),
        },
        {
          shroudLevels: Array.from({ length: 8 }, (_, index) => ({
            currentShroud: index === 0 ? -1 : 1,
            activeShroudLevel: index === 1 ? 1 : 0,
          })),
        },
      ],
      pendingUndoShroudReveals: [],
    });
    expect(playerState?.state.playerSideByIndex).toEqual(new Map([[0, 'USA']]));
    expect(playerState?.state.controllingPlayerScriptCredits).toEqual(new Map([['the_player', 900]]));
    expect(playerState?.state.controllingPlayerScriptSciences).toEqual(
      new Map([['the_player', new Set(['SCIENCE_ANTHRAX_BOMB'])]]),
    );
    expect(playerState?.state.sideMissionAttempts).toEqual(new Map([['USA', 2]]));
    expect(playerState?.tunnelTrackers).toEqual([{
      side: 'america',
      tracker: {
        tunnelIds: [21, 22],
        passengerIds: [77],
        tunnelCount: 2,
      },
    }]);
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
    expect(sidesListState?.state.scriptPlayerSideByName).toEqual(new Map([['THE_PLAYER', 'america']]));
    expect(sidesListState?.state.scriptDefaultTeamNameBySide).toEqual(new Map([['america', 'TEAMTHEPLAYER']]));
    expect(sidesListState?.state.mapScriptSideByIndex).toEqual(['america']);
    expect(sidesListState?.state.mapScriptDifficultyByIndex).toEqual([1]);
    expect(sidesListState?.state.mapScriptDifficultyByPlayerToken).toEqual(new Map([['THE_PLAYER', 1]]));
    expect(sidesListState?.state.scriptAiBuildListEntriesBySide).toEqual(new Map([['america', [{
      buildingName: 'AmericaBarracks',
      templateName: 'AmericaBarracks',
      x: 12,
      z: 18,
      rebuilds: 0,
      angle: 0,
      initiallyBuilt: true,
      automaticallyBuild: true,
      priorityBuild: false,
    }]]]));
    expect(sidesListState?.state.mapScriptLists).toHaveLength(1);
    expect(sidesListState?.state.mapScriptsByNameUpper).toEqual(new Map([['INTROSCRIPT', {
      name: 'IntroScript',
      nameUpper: 'INTROSCRIPT',
      active: true,
      oneShot: false,
      easy: true,
      normal: true,
      hard: true,
      subroutine: false,
      delayEvaluationSeconds: 0,
      frameToEvaluateAt: 0,
      conditionTeamNameUpper: null,
      sourceSideIndex: 0,
      conditions: [],
      actions: [],
      falseActions: [],
    }]]));
    expect(teamFactoryState?.state.scriptTeamsByName).toEqual(new Map([['TEAMTHEPLAYER', {
      nameUpper: 'TEAMTHEPLAYER',
      prototypeNameUpper: 'TEAMTHEPLAYER',
      sourcePrototypeId: 1,
      sourceTeamId: 1,
      memberEntityIds: new Set([7]),
      created: true,
      stateName: 'ATTACKING',
      attackPrioritySetName: 'ANTIVEHICLESET',
      recruitableOverride: null,
      isAIRecruitable: true,
      homeWaypointName: 'HOME',
      controllingSide: 'USA',
      controllingPlayerToken: 'the_player',
      isSingleton: true,
      maxInstances: 1,
      productionPriority: 3,
      productionPrioritySuccessIncrease: 0,
      productionPriorityFailureDecrease: 0,
      reinforcementUnitEntries: [],
      reinforcementTransportTemplateName: '',
      reinforcementStartWaypointName: '',
      reinforcementTeamStartsFull: false,
      reinforcementTransportsExit: false,
    }]]));
    expect(teamFactoryState?.state.scriptTeamInstanceNamesByPrototypeName).toEqual(
      new Map([['TEAMTHEPLAYER', ['TEAMTHEPLAYER']]]),
    );
    expect(teamFactoryState?.state.scriptNextSourceTeamId).toBe(2);
    expect(teamFactoryState?.state.scriptNextSourceTeamPrototypeId).toBe(2);
    expect(scriptEngineState?.state.scriptCountersByName).toEqual(
      new Map([['missiontimer', { value: 90, isCountdownTimer: true }]]),
    );
    expect(scriptEngineState?.state.scriptFlagsByName).toEqual(new Map([['intro_complete', true]]));
    expect(scriptEngineState?.state.scriptCompletedVideos).toEqual(['USA_BNN_INTRO']);
    expect(inGameUiState?.state.scriptNamedTimerDisplayEnabled).toBe(false);
    expect(inGameUiState?.state.scriptHiddenSpecialPowerDisplayEntityIds).toEqual(new Set([7]));
    expect(coreState?.spawnedEntities).toEqual([]);
    expect(coreState?.selectedEntityId).toBeNull();
    expect(coreState?.gameRandomSeed).toBe(123456789);
    expect(coreState?.rankLevelLimit).toBe(7);
    expect(coreState?.difficultyBonusesInitialized).toBe(true);
    expect(coreState?.scriptScoringEnabled).toBe(false);
    expect(coreState?.caveTrackers).toEqual([{
      caveIndex: 4,
      tracker: {
        tunnelIds: [91],
        passengerIds: [92, 93],
        tunnelCount: 1,
      },
    }]);
    expect(coreState?.controlBarOverrides).toEqual([{
      commandSetName: 'AMERICABARRACKSCOMMANDSET',
      slot: 1,
      commandButtonName: 'COMMAND_AMERICA_BARRACKS',
    }]);
    expect(coreState?.bridgeSegments).toEqual([{
      segmentId: 4,
      passable: true,
      cellIndices: [10, 11],
      transitionIndices: [22],
      controlEntityIds: [101, 102],
      startWorldX: 1,
      startWorldZ: 2,
      endWorldX: 3,
      endWorldZ: 4,
      startSurfaceY: 5,
      endSurfaceY: 6,
    }]);
    expect(coreState?.pendingWeaponDamageEvents).toEqual([{
      sourceEntityId: 7,
      primaryVictimEntityId: null,
      impactX: 18,
      impactY: 0,
      impactZ: 24,
      executeFrame: 55,
      projectilePlannedImpactFrame: 55,
      delivery: 'PROJECTILE',
      weaponName: 'TestMissile',
      launchFrame: 21,
      sourceX: 10,
      sourceY: 0,
      sourceZ: 10,
      projectileVisualId: 3,
      bezierP1Y: 0,
      bezierP2Y: 0,
      bezierFirstPercentIndent: 0,
      bezierSecondPercentIndent: 0,
      hasBezierArc: false,
      countermeasureDivertFrame: 0,
      countermeasureNoDamage: false,
      suppressImpactVisual: false,
      missileAIState: null,
      scriptWaypointPath: [{ x: 14, z: 16 }],
      damageFXOverride: 'SMALL_ARMS',
      sourceTemplateName: 'RuntimeTank',
    }]);
    expect(coreState?.historicDamageLog).toEqual([{
      weaponName: 'TestMissile',
      hits: [{ frame: 20, x: 14, z: 16 }],
    }]);
    expect(coreState?.sellingEntities).toEqual([{ entityId: 7, sellFrame: 11 }]);
    expect(coreState?.buildableOverrides).toEqual([{
      templateName: 'AmericaBarracks',
      buildableStatus: 'NO',
    }]);
    expect(logicState.version).toBe(1);
    expect(logicState.spawnedEntities.get(7)?.templateName).toBe('RuntimeTank');
    expect(logicState.spawnedEntities.get(7)?.kindOf.has('VEHICLE')).toBe(true);
    expect(parsed.campaign).toBeNull();
  });

  it('writes live attached-object drawables into fresh CHUNK_GameClient saves', () => {
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
      description: 'GameClient Drawable Save',
      mapPath: 'assets/maps/TestMap.json',
      mapData,
      cameraState: null,
      gameClientLiveEntityIds: [7],
      renderableEntityStates: [
        {
          id: 7,
          templateName: 'AmericaTankCrusader',
          resolved: true,
          renderAssetCandidates: ['AmericaTankCrusader'],
          renderAssetPath: 'AmericaTankCrusader.glb',
          renderAssetResolved: true,
          category: 'vehicle',
          x: 10,
          y: 0,
          z: 20,
          rotationY: 0,
          animationState: 'MOVE',
          health: 100,
          maxHealth: 100,
          isSelected: false,
          veterancyLevel: 0,
          isStealthed: false,
          isDetected: false,
          stealthFriendlyOpacity: 1,
          disguiseTemplateName: null,
          shroudStatus: 'CLEAR',
          constructionPercent: -1,
          capturePercent: -1,
          toppleAngle: 0,
          toppleDirX: 0,
          toppleDirZ: 0,
          turretAngles: [],
          modelConditionFlags: ['MOVING', 'WEAPONSET_VETERAN'],
          scriptFlashCount: 2,
          scriptFlashColor: 0x123456,
          shadowType: 'SHADOW_VOLUME',
        },
        {
          id: 99,
          templateName: 'PendingDeathVisualOnly',
          resolved: true,
          renderAssetCandidates: ['PendingDeathVisualOnly'],
          renderAssetPath: 'PendingDeathVisualOnly.glb',
          renderAssetResolved: true,
          category: 'ground',
          x: 0,
          y: 0,
          z: 0,
          rotationY: 0,
          animationState: 'DIE',
          health: 0,
          maxHealth: 100,
          isSelected: false,
          veterancyLevel: 0,
          isStealthed: false,
          isDetected: false,
          stealthFriendlyOpacity: 1,
          disguiseTemplateName: null,
          shroudStatus: 'CLEAR',
          constructionPercent: -1,
          capturePercent: -1,
          toppleAngle: 0,
          toppleDirX: 0,
          toppleDirZ: 0,
          turretAngles: [],
        },
      ],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: { localPlayerIndex: 0 },
        }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 7,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 42,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    expect(readGameClientChunk(saveFile.data)).toEqual({
      version: 3,
      frame: 42,
      tocVersion: 1,
      tocCount: 1,
      tocEntries: ['AmericaTankCrusader'],
      drawableCount: 1,
      drawableObjectIds: [7],
      drawableIds: [7],
      briefingLines: [],
    });
  });

  it('replaces parsed attached-object GameClient drawables while preserving unattached raw drawables', () => {
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

    const incomingSave = buildRuntimeSaveFile({
      description: 'Parsed GameClient Drawable Save',
      mapPath: 'assets/maps/TestMap.json',
      mapData,
      cameraState: null,
      gameClientState: {
        version: 3,
        prefixBytes: new ArrayBuffer(0),
        briefingLines: ['MISSION_ALPHA'],
        drawables: [
          {
            templateName: 'LegacyAttachedTank',
            objectId: 7,
            blockData: createRawGameClientDrawableBlockData(7, 700),
          },
          {
            templateName: 'LegacyScorchMark',
            objectId: 0,
            blockData: createRawGameClientDrawableBlockData(0, 900),
          },
        ],
      },
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: createEmptyPartitionState,
        captureSourcePlayerRuntimeSaveState: () => ({
          version: 1,
          state: { localPlayerIndex: 0 },
        }),
        captureSourceRadarRuntimeSaveState: createEmptyRadarState,
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => createEmptyTeamFactoryState(),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 7,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 10,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 8,
      },
    });

    const parsed = parseRuntimeSaveFile(incomingSave.data);
    expect(parsed.gameClientState?.drawables).toEqual([
      expect.objectContaining({
        templateName: 'LegacyAttachedTank',
        objectId: 7,
        blockData: expect.any(ArrayBuffer),
      }),
      expect.objectContaining({
        templateName: 'LegacyScorchMark',
        objectId: 0,
        blockData: expect.any(ArrayBuffer),
      }),
    ]);

    const rebuilt = buildRuntimeSaveFile({
      description: parsed.metadata.description,
      mapPath: parsed.mapPath,
      mapData: parsed.mapData ?? mapData,
      cameraState: parsed.cameraState,
      tacticalViewState: parsed.tacticalViewState,
      gameClientState: parsed.gameClientState,
      gameClientLiveEntityIds: [7],
      renderableEntityStates: [
        {
          id: 7,
          templateName: 'AmericaTankCrusader',
          resolved: true,
          renderAssetCandidates: ['AmericaTankCrusader'],
          renderAssetPath: 'AmericaTankCrusader.glb',
          renderAssetResolved: true,
          category: 'vehicle',
          x: 10,
          y: 0,
          z: 20,
          rotationY: 0,
          animationState: 'MOVE',
          health: 100,
          maxHealth: 100,
          isSelected: false,
          veterancyLevel: 0,
          isStealthed: false,
          isDetected: false,
          stealthFriendlyOpacity: 1,
          disguiseTemplateName: null,
          shroudStatus: 'CLEAR',
          constructionPercent: -1,
          capturePercent: -1,
          toppleAngle: 0,
          toppleDirX: 0,
          toppleDirZ: 0,
          turretAngles: [],
          modelConditionFlags: ['MOVING'],
          shadowType: 'SHADOW_VOLUME',
        },
      ],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => parsed.gameLogicTerrainLogicState ?? {
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        },
        captureSourcePartitionRuntimeSaveState: () => parsed.gameLogicPartitionState ?? createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => parsed.gameLogicPlayersState ?? {
          version: 1,
          state: { localPlayerIndex: 0 },
        },
        captureSourceRadarRuntimeSaveState: () => parsed.gameLogicRadarState ?? createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => parsed.gameLogicSidesListState ?? { version: 1, state: {} },
        captureSourceTeamFactoryRuntimeSaveState: () => (
          parsed.gameLogicTeamFactoryState
          ?? (
            parsed.sourceTeamFactoryChunkData
              ? applySourceTeamFactoryChunkToState(
                  parsed.sourceTeamFactoryChunkData,
                  createEmptyTeamFactoryState(),
                  parsed.gameLogicPlayersState,
                  parsed.gameLogicSidesListState,
                )
              : createEmptyTeamFactoryState()
          )
        ),
        captureSourceScriptEngineRuntimeSaveState: () => parsed.gameLogicScriptEngineState ?? { version: 1, state: {} },
        captureSourceInGameUiRuntimeSaveState: () => parsed.gameLogicInGameUiState ?? { version: 1, state: {} },
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 7,
          nextId: 8,
          nextProjectileVisualId: 1,
          animationTime: 0,
          selectedEntityId: null,
          selectedEntityIds: [],
          scriptSelectionChangedFrame: 0,
          frameCounter: 20,
          controlBarDirtyFrame: 0,
          scriptObjectTopologyVersion: 0,
          scriptObjectCountChangedFrame: 0,
          defeatedSides: new Set(),
          gameEndFrame: null,
          scriptEndGameTimerActive: false,
          spawnedEntities: [],
        }),
        captureBrowserRuntimeSaveState: () => parsed.gameLogicState ?? { version: 1 },
        getObjectIdCounter: () => 8,
      },
    });

    expect(readGameClientChunk(rebuilt.data)).toEqual({
      version: 3,
      frame: 20,
      tocVersion: 1,
      tocCount: 2,
      tocEntries: ['AmericaTankCrusader', 'LegacyScorchMark'],
      drawableCount: 2,
      drawableObjectIds: [7, 0],
      drawableIds: [7, 900],
      briefingLines: ['MISSION_ALPHA'],
    });
  });

  it('omits CHUNK_TS_RuntimeState when the browser runtime payload is empty', () => {
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
      description: 'Retail-Like Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData,
      cameraState: {
        targetX: 64,
        targetZ: 96,
        angle: 0.5,
        zoom: 180,
        pitch: 1,
      },
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceScriptEngineRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceInGameUiRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceGameLogicRuntimeSaveState: () => ({
          version: 1,
          gameRandomSeed: 99,
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
        captureBrowserRuntimeSaveState: () => ({ version: 1 }),
        getObjectIdCounter: () => 10,
      },
    });

    expect(listSaveGameChunks(saveFile.data).map((chunk) => chunk.blockName)).toEqual([
      'CHUNK_GameState',
      'CHUNK_Campaign',
      'CHUNK_GameStateMap',
      'CHUNK_TerrainLogic',
      'CHUNK_TeamFactory',
      'CHUNK_Players',
      'CHUNK_GameLogic',
      'CHUNK_Radar',
      'CHUNK_ScriptEngine',
      'CHUNK_SidesList',
      'CHUNK_TacticalView',
      'CHUNK_GameClient',
      'CHUNK_InGameUI',
      'CHUNK_Partition',
      'CHUNK_ParticleSystem',
      'CHUNK_TerrainVisual',
      'CHUNK_GhostObject',
    ]);

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.mapPath).toBe('maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json');
    expect(parsed.mapData).toEqual(mapData);
    expect(parsed.cameraState).toBeNull();
    expect(parsed.tacticalViewState).toEqual({
      version: 1,
      angle: 0.5,
      position: {
        x: 64,
        y: 0,
        z: 96,
      },
    });
    expect(parsed.gameLogicState).toBeNull();
    expect(parsed.gameLogicCoreState?.gameRandomSeed).toBe(99);
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
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
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
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
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
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
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

  it('preserves raw unimplemented source chunks when rebuilding a loaded save', () => {
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
      description: 'Passthrough Save',
      mapPath: 'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
      mapData,
      cameraState: null,
      passthroughBlocks: [{
        blockName: 'CHUNK_TerrainVisual',
        blockData: new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer,
      }],
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
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
    });
    const terrainVisualBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

    const parsed = parseRuntimeSaveFile(saveFile.data);

    expect(parsed.gameClientState?.briefingLines).toEqual([]);
    expect(parsed.passthroughBlocks.map((block) => block.blockName).sort()).toEqual([
      'CHUNK_GhostObject',
      'CHUNK_ParticleSystem',
      'CHUNK_TerrainVisual',
    ].sort());
    const terrainVisualBlock = parsed.passthroughBlocks.find((block) => block.blockName === 'CHUNK_TerrainVisual');
    expect(terrainVisualBlock).toBeDefined();
    expect(new Uint8Array(terrainVisualBlock!.blockData)).toEqual(terrainVisualBytes);

    const rebuilt = buildRuntimeSaveFile({
      description: parsed.metadata.description,
      mapPath: parsed.mapPath,
      mapData: parsed.mapData ?? mapData,
      cameraState: parsed.cameraState,
      tacticalViewState: parsed.tacticalViewState,
      gameClientBriefingLines: ['MISSION_GAMMA'],
      gameClientState: parsed.gameClientState,
      passthroughBlocks: parsed.passthroughBlocks,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => parsed.gameLogicTerrainLogicState ?? {
          version: 2,
          activeBoundary: 0,
          waterUpdates: [],
        },
        captureSourcePartitionRuntimeSaveState: () => parsed.gameLogicPartitionState ?? createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => parsed.gameLogicPlayersState ?? { version: 1, state: {} },
        captureSourceRadarRuntimeSaveState: () => parsed.gameLogicRadarState ?? createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => parsed.gameLogicSidesListState ?? { version: 1, state: {} },
        captureSourceTeamFactoryRuntimeSaveState: () => (
          parsed.gameLogicTeamFactoryState
          ?? (
            parsed.sourceTeamFactoryChunkData
              ? applySourceTeamFactoryChunkToState(
                  parsed.sourceTeamFactoryChunkData,
                  createEmptyTeamFactoryState(),
                  parsed.gameLogicPlayersState,
                  parsed.gameLogicSidesListState,
                )
              : createEmptyTeamFactoryState()
          )
        ),
        captureSourceScriptEngineRuntimeSaveState: () => parsed.gameLogicScriptEngineState ?? { version: 1, state: {} },
        captureSourceInGameUiRuntimeSaveState: () => parsed.gameLogicInGameUiState ?? { version: 1, state: {} },
        captureSourceGameLogicRuntimeSaveState: () => parsed.gameLogicCoreState ?? {
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
        },
        captureBrowserRuntimeSaveState: () => parsed.gameLogicState ?? { version: 1, spawnedEntities: [] },
        getObjectIdCounter: () => parsed.gameLogicCoreState?.nextId ?? 10,
      },
    });

    expect(readSaveChunkData(rebuilt.data, 'CHUNK_TerrainVisual')).toEqual(terrainVisualBytes);
    expect(readGameClientChunk(rebuilt.data)?.briefingLines).toEqual(['MISSION_GAMMA']);
  });

  it('round-trips live particle-system save state through CHUNK_ParticleSystem', () => {
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

    const particleSystemState = {
      version: 1 as const,
      nextId: 4,
      systems: [{
        id: 3,
        template: {
          name: 'SmokePuff',
          priority: 'WEAPON_EXPLOSION' as const,
          isOneShot: true,
          shader: 'ALPHA' as const,
          type: 'PARTICLE' as const,
          particleName: 'EXSmokNew1.tga',
          angleZ: { min: 0, max: 0.2 },
          angularRateZ: { min: 0, max: 0.05 },
          angularDamping: { min: 1, max: 1 },
          velocityDamping: { min: 0.98, max: 0.98 },
          gravity: 0.01,
          lifetime: { min: 30, max: 30 },
          systemLifetime: 60,
          size: { min: 1, max: 1.5 },
          startSizeRate: { min: 0, max: 0 },
          sizeRate: { min: 0.01, max: 0.01 },
          sizeRateDamping: { min: 1, max: 1 },
          alphaKeyframes: [
            { alphaMin: 0, alphaMax: 0, frame: 0 },
            { alphaMin: 1, alphaMax: 1, frame: 15 },
            { alphaMin: 0, alphaMax: 0, frame: 30 },
          ],
          colorKeyframes: [
            { r: 255, g: 255, b: 255, frame: 0 },
          ],
          colorScale: { min: 1, max: 1 },
          burstDelay: { min: 1, max: 1 },
          burstCount: { min: 1, max: 1 },
          initialDelay: { min: 0, max: 0 },
          driftVelocity: { x: 0, y: 0.01, z: 0 },
          velocityType: 'SPHERICAL' as const,
          velOrtho: {
            x: { min: 0, max: 0 },
            y: { min: 0, max: 0 },
            z: { min: 0, max: 0 },
          },
          velOutward: { min: 0, max: 0 },
          velOutwardOther: { min: 0, max: 0 },
          velSpherical: { min: 0.5, max: 0.5 },
          velHemispherical: { min: 0, max: 0 },
          velCylindrical: {
            radial: { min: 0, max: 0 },
            normal: { min: 0, max: 0 },
          },
          volumeType: 'POINT' as const,
          volLineStart: { x: 0, y: 0, z: 0 },
          volLineEnd: { x: 0, y: 0, z: 0 },
          volBoxHalfSize: { x: 0, y: 0, z: 0 },
          volSphereRadius: 0,
          volCylinderRadius: 0,
          volCylinderLength: 0,
          isHollow: false,
          isGroundAligned: false,
          isEmitAboveGroundOnly: false,
          isParticleUpTowardsEmitter: false,
          windMotion: 'Unused' as const,
          windAngleChangeMin: 0.15,
          windAngleChangeMax: 0.45,
          windPingPongStartAngleMin: 0,
          windPingPongStartAngleMax: Math.PI / 4,
          windPingPongEndAngleMin: 5.5,
          windPingPongEndAngleMax: Math.PI * 2,
        },
        position: { x: 12, y: 3, z: 18 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        particleCount: 1,
        particles: [
          12, 3, 18,
          0.2, 0.1, -0.05,
          0.75,
          1, 1, 1,
          1.4,
          8,
          30,
          0.1,
          0.02,
          0.01,
          1,
          0.98,
          1,
          0.5,
        ],
        burstTimer: 1,
        systemAge: 9,
        initialDelayRemaining: 0,
        alive: true,
        windAngle: 0,
        windAngleChange: 0.15,
        windMotionMovingToEnd: true,
        windPingPongTargetAngle: Math.PI * 2,
        slaveSystemId: null,
        masterSystemId: null,
        attachedParticleSystems: [],
        prevPositions: [11.8, 2.9, 18.1],
      }],
    };

    const saveFile = buildRuntimeSaveFile({
      description: 'Particle Runtime Save',
      mapPath: 'assets/maps/ScenarioSkirmish.json',
      mapData,
      cameraState: {
        targetX: 12,
        targetZ: 18,
        angle: 0,
        zoom: 120,
        pitch: 1,
      },
      particleSystemState,
      gameLogic: {
        captureSourceTerrainLogicRuntimeSaveState: () => ({ version: 2, activeBoundary: 0, waterUpdates: [] }),
        captureSourcePartitionRuntimeSaveState: () => createEmptyPartitionState(),
        captureSourcePlayerRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceRadarRuntimeSaveState: () => createEmptyRadarState(),
        captureSourceSidesListRuntimeSaveState: () => ({ version: 1, state: {} }),
        captureSourceTeamFactoryRuntimeSaveState: () => ({ version: 1, state: {} }),
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
          controlBarDirtyFrame: -1,
          frameCounter: 0,
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
    });

    const parsed = parseRuntimeSaveFile(saveFile.data);
    expect(parsed.particleSystemState).not.toBeNull();
    expect(parsed.particleSystemState?.nextId).toBe(4);
    expect(parsed.particleSystemState?.systems).toHaveLength(1);
    expect(parsed.particleSystemState?.systems[0]?.template.name).toBe('SmokePuff');
    expect(parsed.particleSystemState?.systems[0]?.particleCount).toBe(1);
    expect(parsed.particleSystemState?.systems[0]?.particles.slice(0, 3)).toEqual([12, 3, 18]);
    expect(parsed.particleSystemState?.systems[0]?.prevPositions?.[0]).toBeCloseTo(11.8, 5);
    expect(parsed.particleSystemState?.systems[0]?.prevPositions?.[1]).toBeCloseTo(2.9, 5);
    expect(parsed.particleSystemState?.systems[0]?.prevPositions?.[2]).toBeCloseTo(18.1, 5);
  });
});
