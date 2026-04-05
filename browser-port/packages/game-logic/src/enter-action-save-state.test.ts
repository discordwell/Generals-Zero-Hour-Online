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

function makeEnterActionBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('Ranger', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
      makeObjectDef('Dozer', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
      makeObjectDef('Bunker', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      ]),
      makeObjectDef('TransportTruck', 'America', ['VEHICLE', 'TRANSPORT'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      ]),
      makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1200, InitialHealth: 1200 }),
      ]),
    ],
  });
}

describe('enter action save-state', () => {
  it('stores pending enter actions on entities instead of the browser runtime blob', () => {
    const registry = makeRegistry(makeEnterActionBundle());
    const map = makeMap([
      makeMapObject('Ranger', 10, 10),
      makeMapObject('Ranger', 12, 10),
      makeMapObject('Ranger', 14, 10),
      makeMapObject('Ranger', 16, 10),
      makeMapObject('Dozer', 30, 30),
      makeMapObject('Bunker', 32, 30),
      makeMapObject('TransportTruck', 34, 30),
      makeMapObject('TunnelNetwork', 36, 30),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      setEntityPendingEnterState: (
        entityId: number,
        state: {
          targetObjectId: number;
          action: 'repairVehicle' | 'garrisonBuilding' | 'enterTransport' | 'enterTunnel';
          commandSource: 'PLAYER' | 'AI' | 'SCRIPT';
        } | null,
      ) => void;
      spawnedEntities: Map<number, {
        pendingEnterState: unknown;
      }>;
      pendingEnterObjectActions: Map<number, unknown>;
      pendingGarrisonActions: Map<number, number>;
      pendingTransportActions: Map<number, number>;
      pendingTunnelActions: Map<number, number>;
    };

    privateLogic.setEntityPendingEnterState(1, {
      targetObjectId: 5,
      action: 'repairVehicle',
      commandSource: 'PLAYER',
    });
    privateLogic.setEntityPendingEnterState(2, {
      targetObjectId: 6,
      action: 'garrisonBuilding',
      commandSource: 'SCRIPT',
    });
    privateLogic.setEntityPendingEnterState(3, {
      targetObjectId: 7,
      action: 'enterTransport',
      commandSource: 'AI',
    });
    privateLogic.setEntityPendingEnterState(4, {
      targetObjectId: 8,
      action: 'enterTunnel',
      commandSource: 'PLAYER',
    });

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingEnterObjectActions');
    expect(browserState).not.toHaveProperty('pendingGarrisonActions');
    expect(browserState).not.toHaveProperty('pendingTransportActions');
    expect(browserState).not.toHaveProperty('pendingTunnelActions');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.spawnedEntities.get(1)?.pendingEnterState).toEqual({
      targetObjectId: 5,
      action: 'repairVehicle',
      commandSource: 'PLAYER',
    });
    expect(restoredPrivate.spawnedEntities.get(2)?.pendingEnterState).toEqual({
      targetObjectId: 6,
      action: 'garrisonBuilding',
      commandSource: 'SCRIPT',
    });
    expect(restoredPrivate.spawnedEntities.get(3)?.pendingEnterState).toEqual({
      targetObjectId: 7,
      action: 'enterTransport',
      commandSource: 'AI',
    });
    expect(restoredPrivate.spawnedEntities.get(4)?.pendingEnterState).toEqual({
      targetObjectId: 8,
      action: 'enterTunnel',
      commandSource: 'PLAYER',
    });
    expect(restoredPrivate.pendingEnterObjectActions.get(1)).toEqual({
      targetObjectId: 5,
      action: 'repairVehicle',
      commandSource: 'PLAYER',
    });
    expect(restoredPrivate.pendingGarrisonActions.get(2)).toBe(6);
    expect(restoredPrivate.pendingTransportActions.get(3)).toBe(7);
    expect(restoredPrivate.pendingTunnelActions.get(4)).toBe(8);
  });

  it('hydrates legacy browser enter-action maps into entity-owned state', () => {
    const registry = makeRegistry(makeEnterActionBundle());
    const map = makeMap([
      makeMapObject('Ranger', 10, 10),
      makeMapObject('Ranger', 12, 10),
      makeMapObject('Ranger', 14, 10),
      makeMapObject('Ranger', 16, 10),
      makeMapObject('Dozer', 30, 30),
      makeMapObject('Bunker', 32, 30),
      makeMapObject('TransportTruck', 34, 30),
      makeMapObject('TunnelNetwork', 36, 30),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingEnterObjectActions: new Map([[1, {
        targetObjectId: 5,
        action: 'repairVehicle',
        commandSource: 'AI',
      }]]),
      pendingGarrisonActions: new Map([[2, 6]]),
      pendingTransportActions: new Map([[3, 7]]),
      pendingTunnelActions: new Map([[4, 8]]),
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        pendingEnterState: unknown;
      }>;
      pendingEnterObjectActions: Map<number, unknown>;
      pendingGarrisonActions: Map<number, number>;
      pendingTransportActions: Map<number, number>;
      pendingTunnelActions: Map<number, number>;
    };

    expect(privateLogic.spawnedEntities.get(1)?.pendingEnterState).toEqual({
      targetObjectId: 5,
      action: 'repairVehicle',
      commandSource: 'AI',
    });
    expect(privateLogic.spawnedEntities.get(2)?.pendingEnterState).toEqual({
      targetObjectId: 6,
      action: 'garrisonBuilding',
      commandSource: 'SCRIPT',
    });
    expect(privateLogic.spawnedEntities.get(3)?.pendingEnterState).toEqual({
      targetObjectId: 7,
      action: 'enterTransport',
      commandSource: 'PLAYER',
    });
    expect(privateLogic.spawnedEntities.get(4)?.pendingEnterState).toEqual({
      targetObjectId: 8,
      action: 'enterTunnel',
      commandSource: 'PLAYER',
    });
    expect(privateLogic.pendingEnterObjectActions.get(1)).toEqual({
      targetObjectId: 5,
      action: 'repairVehicle',
      commandSource: 'AI',
    });
    expect(privateLogic.pendingGarrisonActions.get(2)).toBe(6);
    expect(privateLogic.pendingTransportActions.get(3)).toBe(7);
    expect(privateLogic.pendingTunnelActions.get(4)).toBe(8);
  });
});
