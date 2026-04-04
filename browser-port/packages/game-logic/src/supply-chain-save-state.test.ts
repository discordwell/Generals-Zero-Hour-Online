import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import { SupplyTruckAIState } from './supply-chain.js';

describe('supply-chain save-state', () => {
  it('captures and restores source supply runtime in the game-logic chunk', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed?: boolean;
        supplyWarehouseProfile?: object | null;
        supplyTruckProfile?: object | null;
        isSupplyCenter?: boolean;
      }>;
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
      supplyTruckStates: Map<number, {
        aiState: number;
        currentBoxes: number;
        targetWarehouseId: number | null;
        targetDepotId: number | null;
        actionDelayFinishFrame: number;
        preferredDockId: number | null;
        forceBusy: boolean;
      }>;
      dockApproachStates: Map<number, { currentDockerCount: number; maxDockers: number }>;
    };

    privateLogic.spawnedEntities = new Map([
      [1, {
        id: 1,
        supplyWarehouseProfile: {
          startingBoxes: 8,
          deleteWhenEmpty: false,
          numberApproachPositions: -1,
          allowsPassthrough: false,
        },
      }],
      [2, {
        id: 2,
        supplyTruckProfile: {
          maxBoxes: 5,
          supplyCenterActionDelayFrames: 15,
          supplyWarehouseActionDelayFrames: 15,
          supplyWarehouseScanDistance: 200,
          upgradedSupplyBoost: 0,
        },
      }],
      [3, { id: 3, isSupplyCenter: true }],
    ]);
    privateLogic.supplyWarehouseStates.set(1, { currentBoxes: 6 });
    privateLogic.supplyTruckStates.set(2, {
      aiState: SupplyTruckAIState.GATHERING,
      currentBoxes: 3,
      targetWarehouseId: 1,
      targetDepotId: 3,
      actionDelayFinishFrame: 200,
      preferredDockId: 1,
      forceBusy: true,
    });
    privateLogic.dockApproachStates.set(1, { currentDockerCount: 1, maxDockers: 3 });
    privateLogic.dockApproachStates.set(3, { currentDockerCount: 2, maxDockers: 4 });

    const captured = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(captured.supplyWarehouseStates).toEqual([{
      entityId: 1,
      state: { currentBoxes: 6 },
    }]);
    expect(captured.supplyTruckStates).toEqual([{
      entityId: 2,
      state: {
        aiState: SupplyTruckAIState.GATHERING,
        currentBoxes: 3,
        targetWarehouseId: 1,
        targetDepotId: 3,
        actionDelayFinishFrame: 200,
        preferredDockId: 1,
        forceBusy: true,
      },
    }]);
    expect(captured.dockApproachStates).toEqual([
      { entityId: 1, state: { currentDockerCount: 1, maxDockers: 3 } },
      { entityId: 3, state: { currentDockerCount: 2, maxDockers: 4 } },
    ]);
    expect(browserState).not.toHaveProperty('supplyWarehouseStates');
    expect(browserState).not.toHaveProperty('supplyTruckStates');
    expect(browserState).not.toHaveProperty('dockApproachStates');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourceGameLogicRuntimeSaveState(captured);
    restored.finalizeSourceSupplyChainRuntimeSaveState();

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.supplyWarehouseStates).toEqual(new Map([
      [1, { currentBoxes: 6 }],
    ]));
    expect(restoredPrivate.supplyTruckStates).toEqual(new Map([
      [2, {
        aiState: SupplyTruckAIState.GATHERING,
        currentBoxes: 3,
        targetWarehouseId: 1,
        targetDepotId: 3,
        actionDelayFinishFrame: 200,
        preferredDockId: 1,
        forceBusy: true,
      }],
    ]));
    expect(restoredPrivate.dockApproachStates).toEqual(new Map([
      [1, { currentDockerCount: 1, maxDockers: 3 }],
      [3, { currentDockerCount: 2, maxDockers: 4 }],
    ]));
  });

  it('restores legacy browser supply runtime when source chunk data is absent', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed?: boolean;
        supplyWarehouseProfile?: object | null;
        supplyTruckProfile?: object | null;
        isSupplyCenter?: boolean;
      }>;
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
      supplyTruckStates: Map<number, {
        aiState: number;
        currentBoxes: number;
        targetWarehouseId: number | null;
        targetDepotId: number | null;
        actionDelayFinishFrame: number;
        preferredDockId: number | null;
        forceBusy: boolean;
      }>;
      dockApproachStates: Map<number, { currentDockerCount: number; maxDockers: number }>;
    };

    privateLogic.spawnedEntities = new Map([
      [1, {
        id: 1,
        supplyWarehouseProfile: {
          startingBoxes: 8,
          deleteWhenEmpty: false,
          numberApproachPositions: -1,
          allowsPassthrough: false,
        },
      }],
      [2, {
        id: 2,
        supplyTruckProfile: {
          maxBoxes: 5,
          supplyCenterActionDelayFrames: 15,
          supplyWarehouseActionDelayFrames: 15,
          supplyWarehouseScanDistance: 200,
          upgradedSupplyBoost: 0,
        },
      }],
      [3, { id: 3, isSupplyCenter: true }],
      [4, { id: 4 }],
    ]);

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      supplyWarehouseStates: new Map([
        [1, { currentBoxes: 5 }],
        [4, { currentBoxes: 99 }],
      ]),
      supplyTruckStates: new Map([
        [2, {
          aiState: SupplyTruckAIState.APPROACHING_DEPOT,
          currentBoxes: 4,
          targetWarehouseId: 1,
          targetDepotId: 3,
          actionDelayFinishFrame: 90,
          preferredDockId: 3,
          forceBusy: false,
        }],
        [4, {
          aiState: SupplyTruckAIState.IDLE,
          currentBoxes: 1,
          targetWarehouseId: null,
          targetDepotId: null,
          actionDelayFinishFrame: 0,
          preferredDockId: null,
          forceBusy: false,
        }],
      ]),
      dockApproachStates: new Map([
        [1, { currentDockerCount: 1, maxDockers: 3 }],
        [3, { currentDockerCount: 2, maxDockers: 4 }],
        [4, { currentDockerCount: 9, maxDockers: 9 }],
      ]),
    });
    logic.finalizeSourceSupplyChainRuntimeSaveState();

    expect(privateLogic.supplyWarehouseStates).toEqual(new Map([
      [1, { currentBoxes: 5 }],
    ]));
    expect(privateLogic.supplyTruckStates).toEqual(new Map([
      [2, {
        aiState: SupplyTruckAIState.APPROACHING_DEPOT,
        currentBoxes: 4,
        targetWarehouseId: 1,
        targetDepotId: 3,
        actionDelayFinishFrame: 90,
        preferredDockId: 3,
        forceBusy: false,
      }],
    ]));
    expect(privateLogic.dockApproachStates).toEqual(new Map([
      [1, { currentDockerCount: 1, maxDockers: 3 }],
      [3, { currentDockerCount: 2, maxDockers: 4 }],
    ]));
  });
});
