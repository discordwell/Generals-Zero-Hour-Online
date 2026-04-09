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

function makeTriggerAreaSaveBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('TriggerDozer', 'America', ['VEHICLE', 'DOZER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
    ],
  });
}

function makeTriggerAreaSaveMap() {
  const map = makeMap([
    makeMapObject('TriggerDozer', 20, 20),
  ], 64, 64);
  map.triggers = [
    {
      name: 'Trigger_A',
      id: 1,
      isWaterArea: false,
      isRiver: false,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    {
      name: 'Trigger_B',
      id: 2,
      isWaterArea: false,
      isRiver: false,
      points: [
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 100, y: 100 },
      ],
    },
  ];
  return map;
}

describe('trigger area save-state', () => {
  it('stores source trigger-area runtime in the core chunk instead of the browser runtime blob', () => {
    const bundle = makeTriggerAreaSaveBundle();
    const registry = makeRegistry(bundle);
    const map = makeTriggerAreaSaveMap();

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      scriptTriggerMembershipByEntityId: Map<number, Set<number>>;
      scriptTriggerEnteredByEntityId: Map<number, Set<number>>;
      scriptTriggerExitedByEntityId: Map<number, Set<number>>;
      scriptTriggerEnterExitFrameByEntityId: Map<number, number>;
    };

    privateLogic.frameCounter = 123;
    privateLogic.scriptTriggerMembershipByEntityId.set(1, new Set([0]));
    privateLogic.scriptTriggerEnteredByEntityId.set(1, new Set([0]));
    privateLogic.scriptTriggerExitedByEntityId.set(1, new Set([1]));
    privateLogic.scriptTriggerEnterExitFrameByEntityId.set(1, 123);

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(coreState.objectTriggerAreaStates).toEqual([{
      entityId: 1,
      enteredOrExitedFrame: 123,
      triggerAreas: [
        { triggerName: 'Trigger_A', entered: 1, exited: 0, isInside: 1 },
        { triggerName: 'Trigger_B', entered: 0, exited: 1, isInside: 0 },
      ],
    }]);
    expect(browserState).not.toHaveProperty('scriptTriggerMembershipByEntityId');
    expect(browserState).not.toHaveProperty('scriptTriggerEnteredByEntityId');
    expect(browserState).not.toHaveProperty('scriptTriggerExitedByEntityId');
    expect(browserState).not.toHaveProperty('scriptTriggerEnterExitFrameByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.scriptTriggerMembershipByEntityId.get(1)).toEqual(new Set([0]));
    expect(restoredPrivate.scriptTriggerEnteredByEntityId.get(1)).toEqual(new Set([0]));
    expect(restoredPrivate.scriptTriggerExitedByEntityId.get(1)).toEqual(new Set([1]));
    expect(restoredPrivate.scriptTriggerEnterExitFrameByEntityId.get(1)).toBe(123);
    expect(restored.evaluateScriptNamedEnteredArea({ entityId: 1, triggerName: 'Trigger_A' })).toBe(true);
    expect(restored.evaluateScriptNamedExitedArea({ entityId: 1, triggerName: 'Trigger_B' })).toBe(true);
  });

  it('hydrates legacy browser trigger-area helper maps into source-owned runtime', () => {
    const bundle = makeTriggerAreaSaveBundle();
    const registry = makeRegistry(bundle);
    const map = makeTriggerAreaSaveMap();

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      scriptTriggerMembershipByEntityId: new Map([[1, new Set([0])]]),
      scriptTriggerEnteredByEntityId: new Map([[1, new Set([0])]]),
      scriptTriggerExitedByEntityId: new Map([[1, new Set([1])]]),
      scriptTriggerEnterExitFrameByEntityId: new Map([[1, 77]]),
    });

    const privateLogic = logic as unknown as {
      scriptTriggerMembershipByEntityId: Map<number, Set<number>>;
      scriptTriggerEnteredByEntityId: Map<number, Set<number>>;
      scriptTriggerExitedByEntityId: Map<number, Set<number>>;
      scriptTriggerEnterExitFrameByEntityId: Map<number, number>;
    };

    expect(privateLogic.scriptTriggerMembershipByEntityId.get(1)).toEqual(new Set([0]));
    expect(privateLogic.scriptTriggerEnteredByEntityId.get(1)).toEqual(new Set([0]));
    expect(privateLogic.scriptTriggerExitedByEntityId.get(1)).toEqual(new Set([1]));
    expect(privateLogic.scriptTriggerEnterExitFrameByEntityId.get(1)).toBe(77);
  });
});
