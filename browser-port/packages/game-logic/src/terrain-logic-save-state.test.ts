import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import { makeBundle, makeHeightmap, makeMap, makeObjectDef, makeRegistry } from './test-helpers.js';

function makeTerrainLogicMap() {
  const map = makeMap([], 128, 128);
  map.triggers = [{
    id: 9,
    name: 'WaterAreaA',
    isWaterArea: true,
    isRiver: false,
    points: [
      { x: 40, y: 40, z: 0 },
      { x: 60, y: 40, z: 0 },
      { x: 60, y: 60, z: 0 },
      { x: 40, y: 60, z: 0 },
    ],
  }];
  map.sidesList = {
    sides: [
      {
        dict: { playerName: 'ReplayObserver', playerFaction: 'Observer' },
        buildList: [],
      },
    ],
    teams: [],
  };
  return map;
}

function makeTerrainLogicRegistry() {
  return makeRegistry(makeBundle({
    objects: [
      makeObjectDef('Ranger', 'America', ['INFANTRY'], []),
    ],
  }));
}

describe('source terrain-logic save-state', () => {
  it('stores active boundary and dynamic water state in the source terrain chunk', () => {
    const map = makeTerrainLogicMap();
    const registry = makeTerrainLogicRegistry();

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));
    expect(logic.executeScriptAction({
      actionType: 406,
      params: [2],
    })).toBe(true);
    expect(logic.executeScriptAction({
      actionType: 405,
      params: ['WaterAreaA', 6, 1, 0],
    })).toBe(true);
    logic.update(1 / 30);

    const privateLogic = logic as unknown as {
      scriptActiveBoundaryIndex: number | null;
      dynamicWaterUpdates: Array<{
        waterIndex: number;
        targetHeight: number;
        currentHeight: number;
      }>;
      waterPolygonData: Array<{ waterHeight: number }>;
    };
    const currentHeight = privateLogic.dynamicWaterUpdates[0]!.currentHeight;

    const terrainState = logic.captureSourceTerrainLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('scriptActiveBoundaryIndex');
    expect(browserState).not.toHaveProperty('dynamicWaterUpdates');
    expect(terrainState).toEqual({
      version: 2,
      activeBoundary: 2,
      waterUpdates: [{
        triggerId: 9,
        changePerFrame: 0.2,
        targetHeight: 6,
        damageAmount: 0,
        currentHeight,
      }],
    });

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(128, 128));
    restored.restoreSourceTerrainLogicRuntimeSaveState(terrainState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.scriptActiveBoundaryIndex).toBe(2);
    expect(restoredPrivate.dynamicWaterUpdates).toHaveLength(1);
    expect(restoredPrivate.dynamicWaterUpdates[0]).toMatchObject({
      waterIndex: 0,
      targetHeight: 6,
      currentHeight,
    });
    expect(restoredPrivate.waterPolygonData[0]?.waterHeight).toBeCloseTo(currentHeight, 6);
  });

  it('hydrates legacy browser terrain state from older TS saves', () => {
    const map = makeTerrainLogicMap();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, makeTerrainLogicRegistry(), makeHeightmap(128, 128));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      scriptActiveBoundaryIndex: 4,
      dynamicWaterUpdates: [{
        waterIndex: 0,
        targetHeight: 8,
        changePerFrame: 0.25,
        damageAmount: 11,
        currentHeight: 3,
      }],
    });

    const privateLogic = logic as unknown as {
      scriptActiveBoundaryIndex: number | null;
      dynamicWaterUpdates: Array<{
        waterIndex: number;
        targetHeight: number;
        changePerFrame: number;
        damageAmount: number;
        currentHeight: number;
      }>;
      waterPolygonData: Array<{ waterHeight: number }>;
    };

    expect(privateLogic.scriptActiveBoundaryIndex).toBe(4);
    expect(privateLogic.dynamicWaterUpdates).toEqual([{
      waterIndex: 0,
      targetHeight: 8,
      changePerFrame: 0.25,
      damageAmount: 11,
      currentHeight: 3,
    }]);
    expect(privateLogic.waterPolygonData[0]?.waterHeight).toBe(3);
  });
});
