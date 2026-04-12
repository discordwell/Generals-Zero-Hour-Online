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

function makeExitActionBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('Ranger', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
      makeObjectDef('TransportTruck', 'America', ['VEHICLE', 'TRANSPORT'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      ]),
    ],
  });
}

describe('exit action save-state', () => {
  it('stores pending exit actions on entities instead of the browser runtime blob', () => {
    const registry = makeRegistry(makeExitActionBundle());
    const map = makeMap([
      makeMapObject('Ranger', 10, 10),
      makeMapObject('TransportTruck', 12, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      setEntityPendingExitState: (
        entityId: number,
        state: {
          containerObjectId: number;
          instantly: boolean;
          commandSource: 'PLAYER' | 'AI' | 'SCRIPT';
        } | null,
      ) => void;
      spawnedEntities: Map<number, {
        pendingExitState: unknown;
      }>;
      pendingExitActions: Map<number, unknown>;
    };

    privateLogic.setEntityPendingExitState(1, {
      containerObjectId: 2,
      instantly: true,
      commandSource: 'SCRIPT',
    });

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingExitActions');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.spawnedEntities.get(1)?.pendingExitState).toEqual({
      containerObjectId: 2,
      instantly: true,
      commandSource: 'SCRIPT',
    });
    expect(restoredPrivate.pendingExitActions.get(1)).toEqual({
      containerObjectId: 2,
      instantly: true,
      commandSource: 'SCRIPT',
    });
  });

  it('hydrates legacy browser exit-action maps into entity-owned state', () => {
    const registry = makeRegistry(makeExitActionBundle());
    const map = makeMap([
      makeMapObject('Ranger', 10, 10),
      makeMapObject('TransportTruck', 12, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingExitActions: new Map([[1, {
        containerObjectId: 2,
        instantly: false,
        commandSource: 'AI',
      }]]),
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        pendingExitState: unknown;
      }>;
      pendingExitActions: Map<number, unknown>;
    };

    expect(privateLogic.spawnedEntities.get(1)?.pendingExitState).toEqual({
      containerObjectId: 2,
      instantly: false,
      commandSource: 'AI',
    });
    expect(privateLogic.pendingExitActions.get(1)).toEqual({
      containerObjectId: 2,
      instantly: false,
      commandSource: 'AI',
    });
  });
});
