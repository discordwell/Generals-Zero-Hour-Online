import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';

describe('bridge runtime index save-state', () => {
  it('rebuilds bridge segment indexes from saved bridge segments instead of the browser runtime blob', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      bridgeSegments: Map<number, {
        passable: boolean;
        cellIndices: number[];
        transitionIndices: number[];
        controlEntityIds?: number[];
      }>;
      bridgeSegmentByControlEntity: Map<number, number>;
      bridgeSegmentIdsByCell: Map<number, number[]>;
    };

    privateLogic.bridgeSegments.set(4, {
      passable: true,
      cellIndices: [10, 11],
      transitionIndices: [22],
      controlEntityIds: [101, 102],
    });
    privateLogic.bridgeSegmentByControlEntity.set(101, 4);
    privateLogic.bridgeSegmentIdsByCell.set(10, [4]);

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();
    expect(browserState).not.toHaveProperty('bridgeSegments');
    expect(browserState).not.toHaveProperty('bridgeSegmentByControlEntity');
    expect(browserState).not.toHaveProperty('bridgeSegmentIdsByCell');
    expect(browserState).not.toHaveProperty('bridgeDamageStatesChangedFrame');
    expect(browserState).not.toHaveProperty('bridgeDamageStateByControlEntity');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.bridgeSegments.get(4)).toEqual({
      passable: true,
      cellIndices: [10, 11],
      transitionIndices: [22],
      controlEntityIds: [101, 102],
    });
    expect(restoredPrivate.bridgeSegmentByControlEntity).toEqual(
      new Map([[101, 4], [102, 4]]),
    );
    expect(restoredPrivate.bridgeSegmentIdsByCell).toEqual(
      new Map([[10, [4]], [11, [4]]]),
    );
  });

  it('hydrates legacy browser bridge indexes when older saves still carry them', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      bridgeSegments: new Map([[4, {
        passable: true,
        cellIndices: [10, 11],
        transitionIndices: [22],
      }]]),
      bridgeSegmentByControlEntity: new Map([[201, 4], [202, 4]]),
      bridgeSegmentIdsByCell: new Map([[10, [4]], [11, [4]]]),
      bridgeDamageStatesChangedFrame: 99,
      bridgeDamageStateByControlEntity: new Map([[201, false]]),
    });

    const privateLogic = logic as unknown as {
      bridgeSegmentByControlEntity: Map<number, number>;
      bridgeSegmentIdsByCell: Map<number, number[]>;
      bridgeDamageStatesChangedFrame: number;
      bridgeDamageStateByControlEntity: Map<number, boolean>;
    };

    expect(privateLogic.bridgeSegmentByControlEntity).toEqual(
      new Map([[201, 4], [202, 4]]),
    );
    expect(privateLogic.bridgeSegmentIdsByCell).toEqual(
      new Map([[10, [4]], [11, [4]]]),
    );
    expect(privateLogic.bridgeDamageStatesChangedFrame).toBe(-1);
    expect(privateLogic.bridgeDamageStateByControlEntity).toEqual(new Map());
  });
});
