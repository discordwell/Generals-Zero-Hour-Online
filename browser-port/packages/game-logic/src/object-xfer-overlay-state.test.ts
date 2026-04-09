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
      frameCounter: number;
      spawnedEntities: Map<number, any>;
      captureSourceObjectXferOverlayState: () => Array<{
        entityId: number;
        privateStatus: number;
        specialModelConditionUntil: number;
        lastWeaponCondition: number[];
        modulesReady: boolean;
      }>;
    };

    privateLogic.frameCounter = 120;
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected overlay test entity');
    }
    entity.x = -5;
    entity.cheerTimerFrames = 3;
    entity.destroyed = true;
    entity.capturedFromOriginalOwner = true;
    entity.objectStatusFlags.add('IS_ATTACKING');
    entity.attackWeapon = { name: 'OverlayCannon', clipSize: 1 };
    entity.attackWeaponSlotIndex = 0;
    entity.lastShotFrameBySlot = [120, 0, 0];

    expect(privateLogic.captureSourceObjectXferOverlayState()).toEqual([{
      entityId: 1,
      privateStatus: 0x0d,
      specialModelConditionUntil: 123,
      lastWeaponCondition: [1, 0, 0],
      modulesReady: true,
    }]);
  });

  it('captures source weapon-condition overlays for preattack, burst hold, between-shots, and reload', () => {
    const bundle = makeObjectXferOverlayBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('OverlayTank', 10, 10),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, any>;
      captureSourceObjectXferOverlayState: () => Array<{
        entityId: number;
        privateStatus: number;
        specialModelConditionUntil: number;
        lastWeaponCondition: number[];
        modulesReady: boolean;
      }>;
    };

    privateLogic.frameCounter = 50;
    const entity = privateLogic.spawnedEntities.get(1);
    if (!entity) {
      throw new Error('Expected overlay test entity');
    }
    entity.attackWeapon = { name: 'OverlayCannon', clipSize: 5 };
    entity.attackWeaponSlotIndex = 1;
    entity.attackAmmoInClip = 5;
    entity.attackReloadFinishFrame = 0;
    entity.attackForceReloadFrame = 0;
    entity.nextAttackFrame = 50;
    entity.preAttackFinishFrame = 55;
    entity.lastShotFrameBySlot = [0, 0, 0];
    entity.objectStatusFlags.add('IS_ATTACKING');
    entity.objectStatusFlags.add('IS_AIMING_WEAPON');

    expect(privateLogic.captureSourceObjectXferOverlayState()[0]?.lastWeaponCondition).toEqual([0, 4, 0]);

    entity.preAttackFinishFrame = 0;
    expect(privateLogic.captureSourceObjectXferOverlayState()[0]?.lastWeaponCondition).toEqual([0, 2, 0]);

    entity.objectStatusFlags.delete('IS_AIMING_WEAPON');
    entity.nextAttackFrame = 60;
    expect(privateLogic.captureSourceObjectXferOverlayState()[0]?.lastWeaponCondition).toEqual([0, 2, 0]);

    entity.attackAmmoInClip = 0;
    entity.attackReloadFinishFrame = 60;
    entity.nextAttackFrame = 50;
    expect(privateLogic.captureSourceObjectXferOverlayState()[0]?.lastWeaponCondition).toEqual([0, 3, 0]);
  });
});
