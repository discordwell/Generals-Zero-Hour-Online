import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

function makeHackInternetBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('HackInternetUnit', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'HackInternetAIUpdate ModuleTag_Hack', {
          UnpackTime: 1000,
          PackTime: 1500,
          CashUpdateDelay: 2000,
          CashUpdateDelayFast: 1000,
          RegularCashAmount: 5,
        }),
      ]),
    ],
  });
}

describe('hack internet save-state', () => {
  it('stores HackInternetAIUpdate runtime on entities instead of the browser runtime blob', () => {
    const bundle = makeHackInternetBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('HackInternetUnit', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        hackInternetRuntimeState: {
          cashUpdateDelayFrames: number;
          cashAmountPerCycle: number;
          nextCashFrame: number;
        } | null;
        hackInternetPendingCommand: {
          command: {
            type: string;
            entityId: number;
            targetX: number;
            targetZ: number;
            commandSource?: string;
          };
          executeFrame: number;
        } | null;
      }>;
    };
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected hack-internet entity');
    }

    entity.hackInternetRuntimeState = {
      cashUpdateDelayFrames: 90,
      cashAmountPerCycle: 5,
      nextCashFrame: 120,
    };
    entity.hackInternetPendingCommand = {
      command: {
        type: 'moveTo',
        entityId: 1,
        targetX: 45,
        targetZ: 60,
        commandSource: 'AI',
      },
      executeFrame: 80,
    };

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('hackInternetStateByEntityId');
    expect(browserState).not.toHaveProperty('hackInternetPendingCommandByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredEntity = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredEntity?.hackInternetRuntimeState).toEqual({
      cashUpdateDelayFrames: 90,
      cashAmountPerCycle: 5,
      nextCashFrame: 120,
    });
    expect(restoredEntity?.hackInternetPendingCommand).toEqual({
      command: {
        type: 'moveTo',
        entityId: 1,
        targetX: 45,
        targetZ: 60,
        commandSource: 'AI',
      },
      executeFrame: 80,
    });
  });

  it('hydrates legacy browser hack-internet maps into entity-owned save state', () => {
    const bundle = makeHackInternetBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('HackInternetUnit', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      hackInternetStateByEntityId: new Map([[1, {
        cashUpdateDelayFrames: 60,
        cashAmountPerCycle: 8,
        nextCashFrame: 140,
      }]]),
      hackInternetPendingCommandByEntityId: new Map([[1, {
        command: {
          type: 'moveTo',
          entityId: 1,
          targetX: 32,
          targetZ: 48,
          commandSource: 'AI',
        },
        executeFrame: 75,
      }]]),
    });

    const entity = (logic as unknown as {
      spawnedEntities: Map<number, {
        hackInternetRuntimeState: {
          cashUpdateDelayFrames: number;
          cashAmountPerCycle: number;
          nextCashFrame: number;
        } | null;
        hackInternetPendingCommand: {
          command: {
            type: string;
            entityId: number;
            targetX: number;
            targetZ: number;
            commandSource?: string;
          };
          executeFrame: number;
        } | null;
      }>;
    }).spawnedEntities.get(1);

    expect(entity?.hackInternetRuntimeState).toEqual({
      cashUpdateDelayFrames: 60,
      cashAmountPerCycle: 8,
      nextCashFrame: 140,
    });
    expect(entity?.hackInternetPendingCommand).toEqual({
      command: {
        type: 'moveTo',
        entityId: 1,
        targetX: 32,
        targetZ: 48,
        commandSource: 'AI',
      },
      executeFrame: 75,
    });
  });
});
