import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
} from './test-helpers.js';

describe('player save-state', () => {
  it('captures player-owned AI/script state in the player chunk and omits source-unsaved caches', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      sideCredits: Map<string, number>;
      sideScienceAvailability: Map<string, Map<string, 'enabled' | 'disabled' | 'hidden'>>;
      sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
      sideVisionSpiedBy: Map<string, number[]>;
      sideVisionSpiedMask: Map<string, number>;
      controllingPlayerScriptSciences: Map<string, Set<string>>;
      controllingPlayerScriptAcquiredSciences: Map<string, Set<string>>;
      controllingPlayerScriptSciencePurchasePoints: Map<string, number>;
      controllingPlayerScriptCredits: Map<string, number>;
      sideMissionAttempts: Map<string, number>;
      controllingPlayerMissionAttempts: Map<string, number>;
      controllingPlayerAttackedByPlayer: Map<string, Set<string>>;
      controllingPlayerAttackedBySide: Map<string, Set<string>>;
      sideDestroyedBuildingsByAttacker: Map<string, Map<string, number>>;
      controllingPlayerDestroyedBuildingsByAttacker: Map<string, Map<string, number>>;
      scriptCurrentSupplyWarehouseBySide: Map<string, number>;
      scriptSkirmishBaseDefenseStateBySide: Map<string, {
        curFrontBaseDefense: number;
        curFlankBaseDefense: number;
        curFrontLeftDefenseAngle: number;
        curFrontRightDefenseAngle: number;
        curLeftFlankLeftDefenseAngle: number;
        curLeftFlankRightDefenseAngle: number;
        curRightFlankLeftDefenseAngle: number;
        curRightFlankRightDefenseAngle: number;
      }>;
      scriptSkirmishBaseCenterAndRadiusBySide: Map<string, {
        centerX: number;
        centerZ: number;
        radius: number;
      }>;
      scriptSidesUnitsShouldHunt: Set<string>;
      sideSupplySourceAttackCheckFrame: Map<string, number>;
      sideAttackedSupplySource: Map<string, number>;
      sideSkirmishStartIndex: Map<string, number>;
      skirmishStartIndexByPlayerToken: Map<string, number>;
    };

    privateLogic.sideCredits.set('america', 2500);
    logic.setPlayerSide(0, 'america');
    privateLogic.sideScienceAvailability.set(
      'america',
      new Map([['SCIENCE_PARTICLE_UPLINK_CANNON', 'disabled']]),
    );
    privateLogic.sharedShortcutSpecialPowerReadyFrames.set('SPECIAL_PARTICLE_UPLINK_CANNON', 240);
    privateLogic.sideVisionSpiedBy.set('china', [1]);
    privateLogic.sideVisionSpiedMask.set('china', 1);
    privateLogic.controllingPlayerScriptSciences.set(
      'the_player',
      new Set(['SCIENCE_PARTICLE_UPLINK_CANNON']),
    );
    privateLogic.controllingPlayerScriptAcquiredSciences.set(
      'the_player',
      new Set(['SCIENCE_PARTICLE_UPLINK_CANNON']),
    );
    privateLogic.controllingPlayerScriptSciencePurchasePoints.set('the_player', 3);
    privateLogic.controllingPlayerScriptCredits.set('the_player', 1750);
    privateLogic.sideMissionAttempts.set('america', 2);
    privateLogic.controllingPlayerMissionAttempts.set('the_player', 1);
    privateLogic.controllingPlayerAttackedByPlayer.set('the_player', new Set(['china_player']));
    privateLogic.controllingPlayerAttackedBySide.set('the_player', new Set(['china']));
    privateLogic.sideDestroyedBuildingsByAttacker.set('america', new Map([['china', 4]]));
    privateLogic.controllingPlayerDestroyedBuildingsByAttacker.set(
      'the_player',
      new Map([['china_player', 2]]),
    );
    privateLogic.scriptCurrentSupplyWarehouseBySide.set('america', 17);
    privateLogic.scriptSkirmishBaseDefenseStateBySide.set('china', {
      curFrontBaseDefense: 2,
      curFlankBaseDefense: 1,
      curFrontLeftDefenseAngle: 0.1,
      curFrontRightDefenseAngle: 0.2,
      curLeftFlankLeftDefenseAngle: 0.3,
      curLeftFlankRightDefenseAngle: 0.4,
      curRightFlankLeftDefenseAngle: 0.5,
      curRightFlankRightDefenseAngle: 0.6,
    });
    privateLogic.scriptSkirmishBaseCenterAndRadiusBySide.set('gla', {
      centerX: 120,
      centerZ: 260,
      radius: 90,
    });
    privateLogic.scriptSidesUnitsShouldHunt.add('america');
    privateLogic.sideSupplySourceAttackCheckFrame.set('america', 120);
    privateLogic.sideAttackedSupplySource.set('america', 33);
    privateLogic.sideSkirmishStartIndex.set('america', 2);
    privateLogic.skirmishStartIndexByPlayerToken.set('the_player', 2);

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const scriptState = logic.captureSourceScriptEngineRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(playerState.state.sideCredits).toEqual(new Map([['america', 2500]]));
    expect(playerState.state.sharedShortcutSpecialPowerReadyFrames).toEqual(
      new Map([['SPECIAL_PARTICLE_UPLINK_CANNON', 240]]),
    );
    expect(playerState.state.sideVisionSpiedBy).toEqual(new Map([['china', [1]]]));
    expect(playerState.state.sideVisionSpiedMask).toEqual(new Map([['china', 1]]));
    expect(playerState.state.controllingPlayerScriptSciences).toEqual(
      new Map([['the_player', new Set(['SCIENCE_PARTICLE_UPLINK_CANNON'])]]),
    );
    expect(playerState.state.controllingPlayerScriptAcquiredSciences).toEqual(
      new Map([['the_player', new Set(['SCIENCE_PARTICLE_UPLINK_CANNON'])]]),
    );
    expect(playerState.state.controllingPlayerScriptSciencePurchasePoints).toEqual(
      new Map([['the_player', 3]]),
    );
    expect(playerState.state.controllingPlayerScriptCredits).toEqual(
      new Map([['the_player', 1750]]),
    );
    expect(playerState.state.sideMissionAttempts).toEqual(new Map([['america', 2]]));
    expect(playerState.state.controllingPlayerMissionAttempts).toEqual(new Map([['the_player', 1]]));
    expect(playerState.state.controllingPlayerAttackedByPlayer).toEqual(
      new Map([['the_player', new Set(['china_player'])]]),
    );
    expect(playerState.state.controllingPlayerAttackedBySide).toEqual(
      new Map([['the_player', new Set(['china'])]]),
    );
    expect(playerState.state.sideDestroyedBuildingsByAttacker).toEqual(
      new Map([['america', new Map([['china', 4]])]]),
    );
    expect(playerState.state.controllingPlayerDestroyedBuildingsByAttacker).toEqual(
      new Map([['the_player', new Map([['china_player', 2]])]]),
    );
    expect(playerState.state.scriptCurrentSupplyWarehouseBySide).toEqual(
      new Map([['america', 17]]),
    );
    expect(playerState.state.scriptSidesUnitsShouldHunt).toEqual(new Set(['america']));
    expect(playerState.state.scriptSkirmishBaseCenterAndRadiusBySide).toEqual(
      new Map([['gla', {
        centerX: 120,
        centerZ: 260,
        radius: 90,
      }]]),
    );
    expect(playerState.state.scriptSkirmishBaseDefenseStateBySide).toEqual(
      new Map([['china', {
        curFrontBaseDefense: 2,
        curFlankBaseDefense: 1,
        curFrontLeftDefenseAngle: 0.1,
        curFrontRightDefenseAngle: 0.2,
        curLeftFlankLeftDefenseAngle: 0.3,
        curLeftFlankRightDefenseAngle: 0.4,
        curRightFlankLeftDefenseAngle: 0.5,
        curRightFlankRightDefenseAngle: 0.6,
      }]]),
    );

    expect(scriptState.state).not.toHaveProperty('scriptCurrentSupplyWarehouseBySide');
    expect(scriptState.state).not.toHaveProperty('scriptSidesUnitsShouldHunt');
    expect(scriptState.state).not.toHaveProperty('scriptSkirmishBaseCenterAndRadiusBySide');
    expect(scriptState.state).not.toHaveProperty('scriptSkirmishBaseDefenseStateBySide');

    expect(browserState).not.toHaveProperty('scriptCurrentSupplyWarehouseBySide');
    expect(browserState).not.toHaveProperty('sharedShortcutSpecialPowerReadyFrames');
    expect(browserState).not.toHaveProperty('sideVisionSpiedBy');
    expect(browserState).not.toHaveProperty('sideVisionSpiedMask');
    expect(browserState).not.toHaveProperty('controllingPlayerScriptSciences');
    expect(browserState).not.toHaveProperty('controllingPlayerScriptAcquiredSciences');
    expect(browserState).not.toHaveProperty('controllingPlayerScriptSciencePurchasePoints');
    expect(browserState).not.toHaveProperty('controllingPlayerScriptCredits');
    expect(browserState).not.toHaveProperty('sideMissionAttempts');
    expect(browserState).not.toHaveProperty('controllingPlayerMissionAttempts');
    expect(browserState).not.toHaveProperty('controllingPlayerAttackedByPlayer');
    expect(browserState).not.toHaveProperty('controllingPlayerAttackedBySide');
    expect(browserState).not.toHaveProperty('sideDestroyedBuildingsByAttacker');
    expect(browserState).not.toHaveProperty('controllingPlayerDestroyedBuildingsByAttacker');
    expect(browserState).not.toHaveProperty('scriptSidesUnitsShouldHunt');
    expect(browserState).not.toHaveProperty('scriptSkirmishBaseCenterAndRadiusBySide');
    expect(browserState).not.toHaveProperty('scriptSkirmishBaseDefenseStateBySide');
    expect(browserState).not.toHaveProperty('localPlayerScienceAvailability');
    expect(browserState).not.toHaveProperty('sideSupplySourceAttackCheckFrame');
    expect(browserState).not.toHaveProperty('sideAttackedSupplySource');
    expect(browserState).not.toHaveProperty('sideSkirmishStartIndex');
    expect(browserState).not.toHaveProperty('skirmishStartIndexByPlayerToken');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.restoreSourcePlayerRuntimeSaveState(playerState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.sideCredits).toEqual(new Map([['america', 2500]]));
    expect(restoredPrivate.sharedShortcutSpecialPowerReadyFrames).toEqual(
      new Map([['SPECIAL_PARTICLE_UPLINK_CANNON', 240]]),
    );
    expect(restoredPrivate.sideVisionSpiedBy).toEqual(new Map([['china', [1]]]));
    expect(restoredPrivate.sideVisionSpiedMask).toEqual(new Map([['china', 1]]));
    expect(restoredPrivate.controllingPlayerScriptSciences).toEqual(
      new Map([['the_player', new Set(['SCIENCE_PARTICLE_UPLINK_CANNON'])]]),
    );
    expect(restoredPrivate.controllingPlayerScriptAcquiredSciences).toEqual(
      new Map([['the_player', new Set(['SCIENCE_PARTICLE_UPLINK_CANNON'])]]),
    );
    expect(restoredPrivate.controllingPlayerScriptSciencePurchasePoints).toEqual(
      new Map([['the_player', 3]]),
    );
    expect(restoredPrivate.controllingPlayerScriptCredits).toEqual(
      new Map([['the_player', 1750]]),
    );
    expect(restoredPrivate.sideMissionAttempts).toEqual(new Map([['america', 2]]));
    expect(restoredPrivate.controllingPlayerMissionAttempts).toEqual(
      new Map([['the_player', 1]]),
    );
    expect(restoredPrivate.controllingPlayerAttackedByPlayer).toEqual(
      new Map([['the_player', new Set(['china_player'])]]),
    );
    expect(restoredPrivate.controllingPlayerAttackedBySide).toEqual(
      new Map([['the_player', new Set(['china'])]]),
    );
    expect(restoredPrivate.sideDestroyedBuildingsByAttacker).toEqual(
      new Map([['america', new Map([['china', 4]])]]),
    );
    expect(restoredPrivate.controllingPlayerDestroyedBuildingsByAttacker).toEqual(
      new Map([['the_player', new Map([['china_player', 2]])]]),
    );
    expect(restoredPrivate.scriptCurrentSupplyWarehouseBySide).toEqual(new Map([['america', 17]]));
    expect(restoredPrivate.scriptSidesUnitsShouldHunt).toEqual(new Set(['america']));
    expect(restoredPrivate.scriptSkirmishBaseCenterAndRadiusBySide).toEqual(
      new Map([['gla', {
        centerX: 120,
        centerZ: 260,
        radius: 90,
      }]]),
    );
    expect(restoredPrivate.scriptSkirmishBaseDefenseStateBySide).toEqual(
      new Map([['china', {
        curFrontBaseDefense: 2,
        curFlankBaseDefense: 1,
        curFrontLeftDefenseAngle: 0.1,
        curFrontRightDefenseAngle: 0.2,
        curLeftFlankLeftDefenseAngle: 0.3,
        curLeftFlankRightDefenseAngle: 0.4,
        curRightFlankLeftDefenseAngle: 0.5,
        curRightFlankRightDefenseAngle: 0.6,
      }]]),
    );
    expect(restored.getLocalPlayerDisabledScienceNames()).toEqual([
      'SCIENCE_PARTICLE_UPLINK_CANNON',
    ]);
  });

  it('restores player-owned fields from older script-engine save payloads', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());

    logic.restoreSourceScriptEngineRuntimeSaveState({
      version: 1,
      state: {
        scriptCurrentSupplyWarehouseBySide: new Map([['america', 55]]),
        scriptSidesUnitsShouldHunt: new Set(['america']),
        scriptSkirmishBaseCenterAndRadiusBySide: new Map([['china', {
          centerX: 400,
          centerZ: 220,
          radius: 150,
        }]]),
        scriptSkirmishBaseDefenseStateBySide: new Map([['china', {
          curFrontBaseDefense: 4,
          curFlankBaseDefense: 3,
          curFrontLeftDefenseAngle: 1.1,
          curFrontRightDefenseAngle: 1.2,
          curLeftFlankLeftDefenseAngle: 1.3,
          curLeftFlankRightDefenseAngle: 1.4,
          curRightFlankLeftDefenseAngle: 1.5,
          curRightFlankRightDefenseAngle: 1.6,
        }]]),
      },
    });

    const privateLogic = logic as unknown as {
      scriptCurrentSupplyWarehouseBySide: Map<string, number>;
      scriptSidesUnitsShouldHunt: Set<string>;
      scriptSkirmishBaseCenterAndRadiusBySide: Map<string, {
        centerX: number;
        centerZ: number;
        radius: number;
      }>;
      scriptSkirmishBaseDefenseStateBySide: Map<string, {
        curFrontBaseDefense: number;
        curFlankBaseDefense: number;
        curFrontLeftDefenseAngle: number;
        curFrontRightDefenseAngle: number;
        curLeftFlankLeftDefenseAngle: number;
        curLeftFlankRightDefenseAngle: number;
        curRightFlankLeftDefenseAngle: number;
        curRightFlankRightDefenseAngle: number;
      }>;
    };

    expect(privateLogic.scriptCurrentSupplyWarehouseBySide).toEqual(new Map([['america', 55]]));
    expect(privateLogic.scriptSidesUnitsShouldHunt).toEqual(new Set(['america']));
    expect(privateLogic.scriptSkirmishBaseCenterAndRadiusBySide).toEqual(
      new Map([['china', {
        centerX: 400,
        centerZ: 220,
        radius: 150,
      }]]),
    );
    expect(privateLogic.scriptSkirmishBaseDefenseStateBySide).toEqual(
      new Map([['china', {
        curFrontBaseDefense: 4,
        curFlankBaseDefense: 3,
        curFrontLeftDefenseAngle: 1.1,
        curFrontRightDefenseAngle: 1.2,
        curLeftFlankLeftDefenseAngle: 1.3,
        curLeftFlankRightDefenseAngle: 1.4,
        curRightFlankLeftDefenseAngle: 1.5,
        curRightFlankRightDefenseAngle: 1.6,
      }]]),
    );
  });

  it('captures live local selection into source Player::m_currentSelection', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ranger', 'America', ['INFANTRY', 'SELECTABLE'], []),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Ranger', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'america');

    const selectionApi = logic as unknown as {
      selectedEntityId: number | null;
      selectedEntityIds: readonly number[];
    };
    selectionApi.selectedEntityId = 1;
    selectionApi.selectedEntityIds = [1, 999, 1];

    const playerState = logic.captureSourcePlayerRuntimeSaveState();

    expect(playerState.state.sideSourcePlayerCurrentSelection).toEqual(
      new Map([['america', [1]]]),
    );
    expect(playerState.state.sideSourcePlayerCurrentSelectionPresent).toEqual(
      new Map([['america', true]]),
    );
  });

  it('restores source Player::m_currentSelection into live local selection', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ranger', 'America', ['INFANTRY', 'SELECTABLE'], []),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Ranger', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.restoreSourcePlayerRuntimeSaveState({
      version: 1,
      state: {
        playerSideByIndex: new Map([[0, 'america']]),
        sidePlayerIndex: new Map([['america', 0]]),
        localPlayerIndex: 0,
        sideSourcePlayerCurrentSelection: new Map([['america', [1, 999, 1]]]),
        sideSourcePlayerCurrentSelectionPresent: new Map([['america', true]]),
      },
    });

    logic.finalizeSourcePlayerRuntimeSaveState();

    expect(logic.getLocalPlayerSelectionIds()).toEqual([1]);
  });
});
