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
  makeSpecialPowerDef,
} from './test-helpers.js';

function makeSpecialPowerSaveBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('NonSharedPowerStructure', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
        makeBlock('Behavior', 'OCLSpecialPower ModuleTag_NonShared', {
          SpecialPowerTemplate: 'SPECIAL_CARGO_DROP',
        }),
      ]),
      makeObjectDef('SharedPowerStructure', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
        makeBlock('Behavior', 'OCLSpecialPower ModuleTag_Shared', {
          SpecialPowerTemplate: 'SPECIAL_PARTICLE_UPLINK_CANNON',
        }),
      ]),
    ],
    specialPowers: [
      makeSpecialPowerDef('SPECIAL_CARGO_DROP', {
        ReloadTime: 6000,
      }),
      makeSpecialPowerDef('SPECIAL_PARTICLE_UPLINK_CANNON', {
        ReloadTime: 6000,
        SharedSyncedTimer: true,
      }),
    ],
  });
}

describe('special-power save-state', () => {
  it('tracks source special-power bit names on entities for Object::xfer rewrites', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PowerStructure', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_NonShared', {
            SpecialPowerTemplate: 'SPECIAL_CARGO_DROP',
          }),
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_Shared', {
            SpecialPowerTemplate: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_CARGO_DROP', {
          Enum: 'SPECIAL_CASH_HACK',
          ReloadTime: 6000,
        }),
        makeSpecialPowerDef('SPECIAL_PARTICLE_UPLINK_CANNON', {
          Enum: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          ReloadTime: 6000,
        }),
      ],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('PowerStructure', 10, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, { sourceSpecialPowerBitNames?: readonly string[] }>;
    };
    expect(privateLogic.spawnedEntities.get(1)?.sourceSpecialPowerBitNames).toEqual([
      'SPECIAL_CASH_HACK',
      'SPECIAL_PARTICLE_UPLINK_CANNON',
    ]);
  });

  it('stores source-owned special-power state outside the browser runtime blob', () => {
    const bundle = makeSpecialPowerSaveBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('NonSharedPowerStructure', 10, 10),
      makeMapObject('SharedPowerStructure', 20, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, {
        id: number;
        specialPowerModules: Map<string, {
          availableOnFrame: number;
          pausedCount: number;
          pausedOnFrame: number;
          pausedPercent: number;
        }>;
      }>;
      sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      shortcutSpecialPowerNamesByEntityId: Map<number, Set<string>>;
      pausedShortcutSpecialPowerByName: Map<string, Map<number, { pausedCount: number; pausedOnFrame: number }>>;
    };

    privateLogic.frameCounter = 150;
    const nonSharedModule = privateLogic.spawnedEntities.get(1)?.specialPowerModules.get('SPECIAL_CARGO_DROP');
    if (!nonSharedModule) {
      throw new Error('Expected non-shared special power module');
    }
    nonSharedModule.availableOnFrame = 200;
    nonSharedModule.pausedCount = 1;
    nonSharedModule.pausedOnFrame = 140;
    nonSharedModule.pausedPercent = 0.5;
    privateLogic.sharedShortcutSpecialPowerReadyFrames.set('SPECIAL_PARTICLE_UPLINK_CANNON', 240);
    logic.finalizeSourceSpecialPowerRuntimeSaveState();

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(playerState.state.sharedShortcutSpecialPowerReadyFrames).toEqual(
      new Map([['SPECIAL_PARTICLE_UPLINK_CANNON', 240]]),
    );
    expect(browserState).not.toHaveProperty('sharedShortcutSpecialPowerReadyFrames');
    expect(browserState).not.toHaveProperty('shortcutSpecialPowerSourceByName');
    expect(browserState).not.toHaveProperty('shortcutSpecialPowerNamesByEntityId');
    expect(browserState).not.toHaveProperty('pausedShortcutSpecialPowerByName');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourcePlayerRuntimeSaveState(playerState);
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.finalizeSourceSpecialPowerRuntimeSaveState();

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.sharedShortcutSpecialPowerReadyFrames).toEqual(
      new Map([['SPECIAL_PARTICLE_UPLINK_CANNON', 240]]),
    );
    expect(restoredPrivate.shortcutSpecialPowerSourceByName).toEqual(
      new Map([['SPECIAL_CARGO_DROP', new Map([[1, 200]])]]),
    );
    expect(restoredPrivate.shortcutSpecialPowerNamesByEntityId).toEqual(
      new Map([[1, new Set(['SPECIAL_CARGO_DROP'])]]),
    );
    expect(restoredPrivate.pausedShortcutSpecialPowerByName).toEqual(
      new Map([['SPECIAL_CARGO_DROP', new Map([[1, { pausedCount: 1, pausedOnFrame: 140 }]])]]),
    );
    expect(restored.resolveShortcutSpecialPowerReadyFrameForSourceEntity('SPECIAL_CARGO_DROP', 1))
      .toBe(210);
    expect(restored.getSpecialPowerPercentReady('SPECIAL_CARGO_DROP', 1)).toBe(0.5);
  });

  it('restores legacy browser special-power helper state into source-owned runtime', () => {
    const bundle = makeSpecialPowerSaveBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('NonSharedPowerStructure', 10, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      pausedShortcutSpecialPowerByName: Map<string, Map<number, { pausedCount: number; pausedOnFrame: number }>>;
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, {
          availableOnFrame: number;
          pausedCount: number;
          pausedOnFrame: number;
          pausedPercent: number;
        }>;
      }>;
    };

    privateLogic.frameCounter = 150;
    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      sharedShortcutSpecialPowerReadyFrames: new Map([['SPECIAL_PARTICLE_UPLINK_CANNON', 333]]),
      shortcutSpecialPowerSourceByName: new Map([[
        'SPECIAL_CARGO_DROP',
        new Map([[1, 210]]),
      ]]),
      pausedShortcutSpecialPowerByName: new Map([[
        'SPECIAL_CARGO_DROP',
        new Map([[1, { pausedCount: 1, pausedOnFrame: 145, pausedPercent: 0.75 }]]),
      ]]),
    });
    logic.finalizeSourceSpecialPowerRuntimeSaveState();

    expect(privateLogic.sharedShortcutSpecialPowerReadyFrames).toEqual(
      new Map([['SPECIAL_PARTICLE_UPLINK_CANNON', 333]]),
    );
    expect(privateLogic.shortcutSpecialPowerSourceByName).toEqual(
      new Map([['SPECIAL_CARGO_DROP', new Map([[1, 210]])]]),
    );
    expect(privateLogic.pausedShortcutSpecialPowerByName).toEqual(
      new Map([['SPECIAL_CARGO_DROP', new Map([[1, { pausedCount: 1, pausedOnFrame: 145 }]])]]),
    );
    const module = privateLogic.spawnedEntities.get(1)?.specialPowerModules.get('SPECIAL_CARGO_DROP');
    expect(module).toMatchObject({
      availableOnFrame: 210,
      pausedCount: 1,
      pausedOnFrame: 145,
      pausedPercent: 0.75,
    });
  });
});
