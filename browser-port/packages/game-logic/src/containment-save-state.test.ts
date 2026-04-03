import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('containment save-state', () => {
  it('captures and restores source tunnel and cave tracker runtime state', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      tunnelTrackers: Map<string, { tunnelIds: Set<number>; passengerIds: Set<number> }>;
      caveTrackers: Map<number, { tunnelIds: Set<number>; passengerIds: Set<number> }>;
      caveTrackerIndexByEntityId: Map<number, number>;
      spawnedEntities: Map<number, {
        id: number;
        destroyed?: boolean;
        containProfile?: { moduleType: 'TUNNEL' | 'CAVE'; caveIndex?: number };
      }>;
    };

    privateLogic.tunnelTrackers.set('america', {
      tunnelIds: new Set([10, 11]),
      passengerIds: new Set([40, 999]),
    });
    privateLogic.caveTrackers.set(3, {
      tunnelIds: new Set([30]),
      passengerIds: new Set([50]),
    });
    privateLogic.caveTrackerIndexByEntityId.set(30, 3);
    privateLogic.spawnedEntities = new Map([
      [10, { id: 10, containProfile: { moduleType: 'TUNNEL' } }],
      [11, { id: 11, containProfile: { moduleType: 'TUNNEL' } }],
      [30, { id: 30, containProfile: { moduleType: 'CAVE', caveIndex: 3 } }],
      [40, { id: 40 }],
      [50, { id: 50 }],
    ]);

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const gameLogicState = logic.captureSourceGameLogicRuntimeSaveState();

    expect(playerState.tunnelTrackers).toEqual([{
      side: 'america',
      tracker: {
        tunnelIds: [10, 11],
        passengerIds: [40, 999],
        tunnelCount: 2,
      },
    }]);
    expect(gameLogicState.caveTrackers).toEqual([{
      caveIndex: 3,
      tracker: {
        tunnelIds: [30],
        passengerIds: [50],
        tunnelCount: 1,
      },
    }]);

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourcePlayerRuntimeSaveState(playerState);
    restored.restoreSourceGameLogicRuntimeSaveState(gameLogicState);
    restored.finalizeSourceContainmentRuntimeSaveState();

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.tunnelTrackers).toEqual(new Map([[
      'america',
      {
        tunnelIds: new Set([10, 11]),
        passengerIds: new Set([40]),
      },
    ]]));
    expect(restoredPrivate.caveTrackers).toEqual(new Map([[
      3,
      {
        tunnelIds: new Set([30]),
        passengerIds: new Set([50]),
      },
    ]]));
    expect(restoredPrivate.caveTrackerIndexByEntityId).toEqual(new Map([[30, 3]]));
  });

  it('restores legacy browser containment state when source chunks are absent', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        containProfile?: { moduleType: 'TUNNEL' | 'CAVE'; caveIndex?: number };
      }>;
      tunnelTrackers: Map<string, { tunnelIds: Set<number>; passengerIds: Set<number> }>;
      caveTrackers: Map<number, { tunnelIds: Set<number>; passengerIds: Set<number> }>;
      caveTrackerIndexByEntityId: Map<number, number>;
    };
    privateLogic.spawnedEntities = new Map([
      [10, { id: 10, containProfile: { moduleType: 'TUNNEL' } }],
      [30, { id: 30, containProfile: { moduleType: 'CAVE', caveIndex: 3 } }],
      [40, { id: 40 }],
      [50, { id: 50 }],
    ]);

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      tunnelTrackers: new Map([[
        'america',
        {
          tunnelIds: new Set([10]),
          passengerIds: new Set([40]),
        },
      ]]),
      caveTrackers: new Map([[
        3,
        {
          tunnelIds: new Set([30]),
          passengerIds: new Set([50]),
        },
      ]]),
      caveTrackerIndexByEntityId: new Map([[30, 3]]),
    });
    logic.finalizeSourceContainmentRuntimeSaveState();

    expect(privateLogic.tunnelTrackers).toEqual(new Map([[
      'america',
      {
        tunnelIds: new Set([10]),
        passengerIds: new Set([40]),
      },
    ]]));
    expect(privateLogic.caveTrackers).toEqual(new Map([[
      3,
      {
        tunnelIds: new Set([30]),
        passengerIds: new Set([50]),
      },
    ]]));
    expect(privateLogic.caveTrackerIndexByEntityId).toEqual(new Map([[30, 3]]));
  });
});
