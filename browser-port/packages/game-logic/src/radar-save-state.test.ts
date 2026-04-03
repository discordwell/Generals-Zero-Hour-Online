import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeLocomotorDef,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

function makeRadarBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('OwnScout', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('LocomotorSet', 'SET_NORMAL ScoutLoco', {}),
      ], { RadarPriority: 'UNIT' }),
      makeObjectDef('EnemyBunker', 'China', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      ], { RadarPriority: 'STRUCTURE' }),
    ],
    locomotors: [
      makeLocomotorDef('ScoutLoco', 30),
    ],
  });
}

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

describe('radar save-state', () => {
  it('captures source-shaped radar object lists from live entities', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('OwnScout', 10, 10),
      makeMapObject('EnemyBunker', 40, 20),
    ], 64, 64);
    mapData.sidesList = {
      sides: [
        { dict: { playerName: 'America', playerColor: 0x0000ff }, buildList: [] },
        { dict: { playerName: 'China', playerColor: 0xff0000 }, buildList: [] },
      ],
      teams: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(makeRadarBundle()), makeHeightmap(64, 64));
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setScriptRadarHidden(true);
    logic.setScriptRadarForced(true);

    const captured = logic.captureSourceRadarRuntimeSaveState();

    expect(captured.version).toBe(2);
    if (captured.version !== 2) {
      throw new Error('Expected structured radar save-state payload');
    }
    expect(captured.radarHidden).toBe(true);
    expect(captured.radarForced).toBe(true);
    expect(captured.localObjectList).toEqual([
      { objectId: 1, color: -16776961 },
    ]);
    expect(captured.objectList).toEqual([
      { objectId: 2, color: -65536 },
    ]);
  });

  it('restores structured radar events into script runtime state', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const radarState = {
      version: 2 as const,
      radarHidden: true,
      radarForced: false,
      localObjectList: [],
      objectList: [],
      events: Array.from({ length: 64 }, (_, index) => index === 0
        ? {
            type: 4,
            active: true,
            createFrame: 30,
            dieFrame: 150,
            fadeFrame: 135,
            color1: { red: 255, green: 255, blue: 0, alpha: 255 },
            color2: { red: 255, green: 255, blue: 128, alpha: 255 },
            worldLoc: { x: 30, y: 50, z: 6 },
            radarLoc: { x: 60, y: 70 },
            soundPlayed: false,
            sourceEntityId: 9,
            sourceTeamName: 'TEAMTHEPLAYER',
          }
        : createEmptyRadarEvent()),
      nextFreeRadarEvent: 1,
      lastRadarEvent: 0,
    };

    logic.restoreSourceRadarRuntimeSaveState(radarState);

    expect(logic.isScriptRadarHidden()).toBe(true);
    expect(logic.isScriptRadarForced()).toBe(false);
    expect(logic.getScriptRadarEvents()).toEqual([
      {
        x: 30,
        y: 6,
        z: 50,
        eventType: 4,
        frame: 30,
        expireFrame: 150,
        sourceEntityId: 9,
        sourceTeamName: 'TEAMTHEPLAYER',
      },
    ]);
    expect(logic.getScriptLastRadarEventState()).toEqual({
      x: 30,
      y: 6,
      z: 50,
      eventType: 4,
      frame: 30,
      expireFrame: 150,
      sourceEntityId: 9,
      sourceTeamName: 'TEAMTHEPLAYER',
    });
  });
});
