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

function makeSpyVisionBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('SpySource', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'SpyVisionSpecialPower ModuleTag_Spy', {
          SpecialPowerTemplate: 'SPECIAL_SPY_VISION',
        }),
      ], {
        VisionRange: 30,
      }),
      makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ], {
        VisionRange: 40,
      }),
    ],
    specialPowers: [
      makeSpecialPowerDef('SPECIAL_SPY_VISION', {
        ReloadTime: 0,
        Enum: 'SPECIAL_CHANGE_BATTLE_PLANS',
        BaseDuration: 30000,
      }),
    ],
  });
}

describe('spy vision save-state', () => {
  it('stores player-owned spy vision state in source chunks and rebuilds runtime lookers from source state', () => {
    const bundle = makeSpyVisionBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('SpySource', 20, 20),
      makeMapObject('EnemyTank', 60, 20),
    ], 128, 128);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_SPY',
      specialPowerName: 'SPECIAL_SPY_VISION',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const privateLogic = logic as unknown as {
      frameCounter: number;
      activeSpyVisions: Array<{ sourceEntityId?: number }>;
      spyVisionEntityStates: Map<string, unknown>;
    };
    expect(privateLogic.activeSpyVisions).toHaveLength(1);
    expect(privateLogic.spyVisionEntityStates.size).toBeGreaterThan(0);

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    const sideVisionSpiedBy = playerState.state.sideVisionSpiedBy as Map<string, number[]>;
    const sideVisionSpiedMask = playerState.state.sideVisionSpiedMask as Map<string, number>;
    expect(sideVisionSpiedBy.get('china')?.[0]).toBeGreaterThan(0);
    expect(sideVisionSpiedMask.get('china')).toBe(1);
    expect(browserState).not.toHaveProperty('activeSpyVisions');
    expect(browserState).not.toHaveProperty('spyVisionEntityStates');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(128, 128));
    restored.setTeamRelationship('America', 'China', 0);
    restored.restoreSourcePlayerRuntimeSaveState(playerState);
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);
    restored.finalizeSourceSpyVisionRuntimeSaveState();

    const restoredPrivate = restored as unknown as {
      activeSpyVisions: Array<{ sourceEntityId?: number }>;
      spyVisionEntityStates: Map<string, unknown>;
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, { spyVisionDeactivateFrame: number }>;
      }>;
    };
    expect(restoredPrivate.activeSpyVisions).toHaveLength(1);
    expect(restoredPrivate.activeSpyVisions[0]?.sourceEntityId).toBe(1);
    expect(
      restoredPrivate.spawnedEntities.get(1)?.specialPowerModules.get('SPECIAL_SPY_VISION')?.spyVisionDeactivateFrame,
    ).toBeGreaterThan(0);
    expect(restoredPrivate.spyVisionEntityStates.size).toBe(0);

    restored.update(0);
    expect(restoredPrivate.spyVisionEntityStates.size).toBeGreaterThan(0);
  });

  it('turns off source-backed spy vision when the source entity dies', () => {
    const bundle = makeSpyVisionBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([
      makeMapObject('SpySource', 20, 20),
      makeMapObject('EnemyTank', 60, 20),
    ], 128, 128);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_SPY',
      specialPowerName: 'SPECIAL_SPY_VISION',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const privateLogic = logic as unknown as {
      markEntityDestroyed: (entityId: number, attackerId: number) => void;
      activeSpyVisions: Array<unknown>;
      sideVisionSpiedMask: Map<string, number>;
      spyVisionEntityStates: Map<string, unknown>;
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, { spyVisionDeactivateFrame: number }>;
      }>;
    };

    privateLogic.markEntityDestroyed(1, -1);
    logic.update(0);

    expect(privateLogic.activeSpyVisions).toHaveLength(0);
    expect(privateLogic.sideVisionSpiedMask.get('china') ?? 0).toBe(0);
    expect(privateLogic.spyVisionEntityStates.size).toBe(0);
    expect(
      privateLogic.spawnedEntities.get(1)?.specialPowerModules.get('SPECIAL_SPY_VISION')?.spyVisionDeactivateFrame ?? 0,
    ).toBe(0);
  });
});
