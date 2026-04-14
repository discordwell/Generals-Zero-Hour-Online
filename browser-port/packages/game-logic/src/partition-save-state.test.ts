import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { GameDataConfig } from '@generals/ini-data';

import { CELL_CLEAR, CELL_FOGGED, CELL_SHROUDED } from './fog-of-war.js';
import { GameLogicSubsystem } from './index.js';
import { makeBundle, makeHeightmap, makeMap, makeObjectDef, makeRegistry } from './test-helpers.js';

function makePartitionRegistry(gameData?: GameDataConfig) {
  return makeRegistry(makeBundle({
    objects: [
      makeObjectDef('Ranger', 'America', ['INFANTRY'], []),
    ],
    gameData,
  }));
}

function makeSourceGameData(partitionCellSize: number): GameDataConfig {
  return {
    weaponBonusEntries: [],
    partitionCellSize,
    healthBonuses: [1.0, 1.0, 1.0, 1.0],
    soloPlayerHealthBonuses: [[1.0, 1.0, 1.0], [1.0, 1.0, 1.0]],
  };
}

describe('source partition save-state', () => {
  it('stores fog/shroud cell state in CHUNK_Partition instead of the browser runtime blob', () => {
    const map = makeMap([], 64, 64);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, makePartitionRegistry(), makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      fogOfWarGrid: {
        cellSize: number;
        getTotalCellCount(): number;
        revealMapForPlayer(playerIndex: number): void;
        addLooker(playerIndex: number, worldX: number, worldZ: number, radius: number): void;
        shroudAt(playerIndex: number, worldX: number, worldZ: number, radius: number): void;
        getCellVisibility(playerIndex: number, worldX: number, worldZ: number): number;
      } | null;
    };
    const grid = privateLogic.fogOfWarGrid;
    expect(grid).not.toBeNull();
    grid!.revealMapForPlayer(0);
    grid!.addLooker(0, 5, 5, 5);
    grid!.shroudAt(0, 35, 5, 5);

    const partitionState = logic.captureSourcePartitionRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('fogOfWarGrid');
    expect(partitionState.cellSize).toBe(grid!.cellSize);
    expect(partitionState.totalCellCount).toBe(grid!.getTotalCellCount());
    expect(partitionState.pendingUndoShroudReveals).toEqual([]);
    expect(partitionState.cells[0]?.shroudLevels[0]).toEqual({
      currentShroud: -1,
      activeShroudLevel: 0,
    });
    expect(partitionState.cells[3]?.shroudLevels[0]).toEqual({
      currentShroud: 1,
      activeShroudLevel: 1,
    });

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, makePartitionRegistry(), makeHeightmap(64, 64));
    restored.restoreSourcePartitionRuntimeSaveState(partitionState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredGrid = (restored as unknown as typeof privateLogic).fogOfWarGrid;
    expect(restoredGrid).not.toBeNull();
    expect(restoredGrid!.getCellVisibility(0, 5, 5)).toBe(CELL_CLEAR);
    expect(restoredGrid!.getCellVisibility(0, 15, 5)).toBe(CELL_CLEAR);
    expect(restoredGrid!.getCellVisibility(0, 25, 5)).toBe(CELL_SHROUDED);
    expect(restoredGrid!.getCellVisibility(0, 35, 5)).toBe(CELL_SHROUDED);
    expect(restoredGrid!.getCellVisibility(0, 35, 35)).toBe(CELL_FOGGED);
  });

  it('uses GameData PartitionCellSize when restoring source partition state', () => {
    const map = makeMap([], 64, 64);
    map.heightmap.boundaries = [{ x: 15, y: 7 }];
    const gameData = makeSourceGameData(40);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, makePartitionRegistry(gameData), makeHeightmap(64, 64));

    const partitionState = logic.captureSourcePartitionRuntimeSaveState();
    expect(partitionState.cellSize).toBe(40);
    expect(partitionState.totalCellCount).toBe(8);

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, makePartitionRegistry(gameData), makeHeightmap(64, 64));
    expect(() => restored.restoreSourcePartitionRuntimeSaveState(partitionState)).not.toThrow();
  });
});
