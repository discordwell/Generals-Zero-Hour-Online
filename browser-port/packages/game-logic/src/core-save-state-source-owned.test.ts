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

function makeSourceOwnedCoreBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('AmericaBarracks', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      ]),
    ],
  });
}

describe('source-owned game-logic core save-state', () => {
  it('stores buildable overrides and sell-list state in the source game-logic chunk', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('AmericaBarracks', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      sellingEntities: Map<number, { sellFrame: number; constructionPercent: number }>;
      thingTemplateBuildableOverrides: Map<string, string>;
    };
    privateLogic.frameCounter = 20;
    privateLogic.sellingEntities.set(1, { sellFrame: 20, constructionPercent: 99.9 });
    privateLogic.thingTemplateBuildableOverrides.set('AMERICABARRACKS', 'NO');

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('sellingEntities');
    expect(browserState).not.toHaveProperty('thingTemplateBuildableOverrides');
    expect(browserState).not.toHaveProperty('bridgeDamageStatesChangedFrame');
    expect(browserState).not.toHaveProperty('bridgeDamageStateByControlEntity');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.thingTemplateBuildableOverrides).toEqual(
      new Map([['AMERICABARRACKS', 'NO']]),
    );
    expect(restoredPrivate.sellingEntities.get(1)).toEqual({
      sellFrame: 20,
      constructionPercent: 99.9,
    });
  });

  it('hydrates legacy browser buildable overrides and sell-list maps', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('AmericaBarracks', 20, 20)], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      sellingEntities: new Map([[1, {
        sellFrame: 12,
        constructionPercent: 88.5,
      }]]),
      thingTemplateBuildableOverrides: new Map([['AmericaBarracks', 'ONLY_BY_AI']]),
      bridgeDamageStatesChangedFrame: 77,
      bridgeDamageStateByControlEntity: new Map([[1, false]]),
    });

    const privateLogic = logic as unknown as {
      sellingEntities: Map<number, { sellFrame: number; constructionPercent: number }>;
      thingTemplateBuildableOverrides: Map<string, string>;
    };

    expect(privateLogic.sellingEntities.get(1)).toEqual({
      sellFrame: 12,
      constructionPercent: 88.5,
    });
    expect(privateLogic.thingTemplateBuildableOverrides).toEqual(
      new Map([['AMERICABARRACKS', 'ONLY_BY_AI']]),
    );
  });
});
