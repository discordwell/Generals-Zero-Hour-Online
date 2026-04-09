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

function makeObjectXferOverlayBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('OverlayTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
    ],
  });
}

describe('object xfer overlay state', () => {
  it('captures source private-status and modules-ready overlay fields from live runtime', () => {
    const bundle = makeObjectXferOverlayBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('OverlayTank', 10, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number;
        destroyed: boolean;
        capturedFromOriginalOwner: boolean;
      }>;
      captureSourceObjectXferOverlayState: () => Array<{
        entityId: number;
        privateStatus: number;
        modulesReady: boolean;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected overlay test entity');
    }
    entity.x = -5;
    entity.destroyed = true;
    entity.capturedFromOriginalOwner = true;

    expect(privateLogic.captureSourceObjectXferOverlayState()).toEqual([{
      entityId: 1,
      privateStatus: 0x0d,
      modulesReady: true,
    }]);
  });
});
