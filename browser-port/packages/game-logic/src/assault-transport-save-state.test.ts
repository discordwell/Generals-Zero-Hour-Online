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
  makeWeaponDef,
} from './test-helpers.js';

function makeAssaultTransportBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('TroopCrawler', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
          PassengersAllowedToFire: 'No',
          ContainMax: 8,
        }),
        makeBlock('Behavior', 'AssaultTransportAIUpdate ModuleTag_AssaultAI', {
          MembersGetHealedAtLifeRatio: 0.3,
        }),
      ], {
        Geometry: 'CYLINDER',
        GeometryMajorRadius: 10,
        GeometryMinorRadius: 10,
      }),
      makeObjectDef('RedGuard', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RedGuardGun'] }),
      ], {
        TransportSlotCount: 1,
      }),
    ],
    weapons: [
      makeWeaponDef('RedGuardGun', {
        PrimaryDamage: 5,
        AttackRange: 80,
        DelayBetweenShots: 100,
        DamageType: 'SMALL_ARMS',
      }),
    ],
  });
}

describe('assault transport save-state', () => {
  it('stores AssaultTransportAIUpdate runtime on entities instead of the browser runtime blob', () => {
    const bundle = makeAssaultTransportBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('TroopCrawler', 20, 20),
      makeMapObject('RedGuard', 24, 20),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const privateLogic = logic as unknown as {
      assaultTransportStateByEntityId: Map<number, unknown>;
      spawnedEntities: Map<number, {
        assaultTransportState: unknown;
      }>;
    };
    const transport = privateLogic.spawnedEntities.get(1);
    if (!transport) {
      throw new Error('Expected assault transport entity');
    }

    const state = {
      members: [{ entityId: 2, isHealing: true, isNew: true }],
      designatedTargetId: 9,
      attackMoveGoalX: 80,
      attackMoveGoalY: 6,
      attackMoveGoalZ: 96,
      assaultState: 2,
      framesRemaining: 45,
      isAttackMove: true,
      isAttackObject: false,
      newOccupantsAreNewMembers: true,
    };
    transport.assaultTransportState = state;
    privateLogic.assaultTransportStateByEntityId.set(1, state);

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('assaultTransportStateByEntityId');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(64, 64));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredTransport = (restored as unknown as typeof privateLogic).spawnedEntities.get(1);
    expect(restoredTransport?.assaultTransportState).toEqual(state);
    expect((restored as unknown as typeof privateLogic).assaultTransportStateByEntityId.get(1)).toBe(
      restoredTransport?.assaultTransportState,
    );
  });

  it('hydrates legacy browser assault-transport maps into entity-owned state', () => {
    const bundle = makeAssaultTransportBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('TroopCrawler', 20, 20),
      makeMapObject('RedGuard', 24, 20),
    ], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      assaultTransportStateByEntityId: new Map([[1, {
        members: [{ entityId: 2, isHealing: true, isNew: true }],
        designatedTargetId: 3,
        attackMoveGoalX: 40,
        attackMoveGoalZ: 52,
        isAttackMove: false,
        isAttackObject: true,
        newOccupantsAreNewMembers: true,
      }]]),
    });

    const privateLogic = logic as unknown as {
      assaultTransportStateByEntityId: Map<number, unknown>;
      spawnedEntities: Map<number, {
        assaultTransportState: {
          members: Array<{ entityId: number; isHealing: boolean; isNew: boolean }>;
          designatedTargetId: number | null;
          attackMoveGoalX: number;
          attackMoveGoalY: number;
          attackMoveGoalZ: number;
          assaultState: number;
          framesRemaining: number;
          isAttackMove: boolean;
          isAttackObject: boolean;
          newOccupantsAreNewMembers: boolean;
        } | null;
      }>;
    };

    const restoredTransport = privateLogic.spawnedEntities.get(1);
    expect(restoredTransport?.assaultTransportState).toEqual({
      members: [{ entityId: 2, isHealing: true, isNew: true }],
      designatedTargetId: 3,
      attackMoveGoalX: 40,
      attackMoveGoalY: 0,
      attackMoveGoalZ: 52,
      assaultState: 0,
      framesRemaining: 0,
      isAttackMove: false,
      isAttackObject: true,
      newOccupantsAreNewMembers: true,
    });
    expect(privateLogic.assaultTransportStateByEntityId.get(1)).toBe(
      restoredTransport?.assaultTransportState,
    );
  });
});
