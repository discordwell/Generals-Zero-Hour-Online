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

function makeRailedTransportBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('TrainCar', 'Civilian', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        makeBlock('Behavior', 'RailedTransportAIUpdate ModuleTag_Rail', {
          PathPrefixName: 'TrainPath',
        }),
      ], {
        Geometry: 'CYLINDER',
        GeometryMajorRadius: 10,
        GeometryMinorRadius: 10,
      }),
    ],
  });
}

describe('railed transport save-state', () => {
  it('stores RailedTransportAIUpdate runtime on entities instead of the browser runtime blob', () => {
    const bundle = makeRailedTransportBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TrainCar', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      railedTransportStateByEntityId: Map<number, unknown>;
      spawnedEntities: Map<number, {
        railedTransportState: unknown;
      }>;
    };
    const transport = privateLogic.spawnedEntities.get(1);
    if (!transport) {
      throw new Error('Expected railed transport entity');
    }

    const state = {
      inTransit: true,
      waypointDataLoaded: true,
      paths: [
        { startWaypointID: 10, endWaypointID: 20 },
        { startWaypointID: 30, endWaypointID: 40 },
      ],
      currentPath: 1,
      transitWaypointIds: [10, 15, 20],
      transitWaypointIndex: 2,
    };
    transport.railedTransportState = state;
    privateLogic.railedTransportStateByEntityId.set(1, state);

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('railedTransportStateByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredTransport = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredTransport?.railedTransportState).toEqual({
      inTransit: true,
      waypointDataLoaded: true,
      paths: [
        { startWaypointID: 10, endWaypointID: 20 },
        { startWaypointID: 30, endWaypointID: 40 },
      ],
      currentPath: 1,
      transitWaypointIds: [10, 15, 20],
      transitWaypointIndex: 2,
    });
    expect((restored as unknown as typeof privateLogic).railedTransportStateByEntityId.get(1)).toBe(
      restoredTransport?.railedTransportState,
    );
  });

  it('hydrates legacy browser railed-transport maps into entity-owned state', () => {
    const bundle = makeRailedTransportBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TrainCar', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      railedTransportStateByEntityId: new Map([[1, {
        inTransit: true,
        waypointDataLoaded: true,
        paths: [
          { startWaypointID: 100, endWaypointID: 200 },
        ],
        currentPath: 0,
        transitWaypointIds: [100, 150, 200],
        transitWaypointIndex: 2,
      }]]),
    });

    const privateLogic = logic as unknown as {
      railedTransportStateByEntityId: Map<number, unknown>;
      spawnedEntities: Map<number, {
        railedTransportState: {
          inTransit: boolean;
          waypointDataLoaded: boolean;
          paths: Array<{ startWaypointID: number; endWaypointID: number }>;
          currentPath: number;
          transitWaypointIds: number[];
          transitWaypointIndex: number;
        } | null;
      }>;
    };

    const restoredTransport = privateLogic.spawnedEntities.get(1);
    expect(restoredTransport?.railedTransportState).toEqual({
      inTransit: true,
      waypointDataLoaded: true,
      paths: [
        { startWaypointID: 100, endWaypointID: 200 },
      ],
      currentPath: 0,
      transitWaypointIds: [],
      transitWaypointIndex: 0,
    });
    expect(privateLogic.railedTransportStateByEntityId.get(1)).toBe(
      restoredTransport?.railedTransportState,
    );
  });
});
