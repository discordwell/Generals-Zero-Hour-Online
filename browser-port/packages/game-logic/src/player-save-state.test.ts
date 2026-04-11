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

  it('projects live AI build-list entries into source Player::m_pBuildList snapshots', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      sideSourceBuildListInfos: Map<string, unknown>;
      scriptAiBuildListEntriesBySide: Map<string, Array<{
        templateNameUpper: string;
        locationX: number;
        locationZ: number;
      }>>;
    };

    privateLogic.sideSourceBuildListInfos.set('America', [{
      buildingName: 'ForwardSupply',
      templateName: 'AmericaSupplyCenter',
      location: { x: 11, y: 5, z: 22 },
      rallyPointOffset: { x: 4, y: 6 },
      angle: 1.25,
      isInitiallyBuilt: true,
      numRebuilds: 3,
      script: 'BuildSupply',
      health: 87,
      whiner: true,
      unsellable: true,
      repairable: false,
      automaticallyBuild: false,
      objectId: 9001,
      objectTimestamp: 4321,
      underConstruction: true,
      resourceGatherers: [44, 55],
      isSupplyBuilding: true,
      desiredGatherers: 6,
      priorityBuild: true,
      currentGatherers: 2,
    }]);
    privateLogic.scriptAiBuildListEntriesBySide.set('america', [{
      templateNameUpper: 'AMERICAPOWERPLANT',
      locationX: 42,
      locationZ: 84,
    }]);
    privateLogic.scriptAiBuildListEntriesBySide.set('china', [{
      templateNameUpper: 'CHINABARRACKS',
      locationX: 12,
      locationZ: 34,
    }]);

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const buildListInfosBySide = playerState.state.sideSourceBuildListInfos as Map<string, unknown[]>;

    expect(buildListInfosBySide.get('America')).toEqual([{
      buildingName: 'ForwardSupply',
      templateName: 'AMERICAPOWERPLANT',
      location: { x: 42, y: 5, z: 84 },
      rallyPointOffset: { x: 4, y: 6 },
      angle: 1.25,
      isInitiallyBuilt: true,
      numRebuilds: 3,
      script: 'BuildSupply',
      health: 87,
      whiner: true,
      unsellable: true,
      repairable: false,
      automaticallyBuild: false,
      objectId: 9001,
      objectTimestamp: 4321,
      underConstruction: true,
      resourceGatherers: [44, 55],
      isSupplyBuilding: true,
      desiredGatherers: 6,
      priorityBuild: true,
      currentGatherers: 2,
    }]);
    expect(buildListInfosBySide.get('china')).toEqual([{
      buildingName: 'china_BUILD_0',
      templateName: 'CHINABARRACKS',
      location: { x: 12, y: 0, z: 34 },
      rallyPointOffset: { x: 0, y: 0 },
      angle: 0,
      isInitiallyBuilt: false,
      numRebuilds: 0,
      script: '',
      health: 100,
      whiner: false,
      unsellable: false,
      repairable: true,
      automaticallyBuild: true,
      objectId: 0,
      objectTimestamp: 0,
      underConstruction: false,
      resourceGatherers: [],
      isSupplyBuilding: false,
      desiredGatherers: 0,
      priorityBuild: false,
      currentGatherers: 0,
    }]);
  });

  it('projects live Player::xfer collection and core fields into source snapshots', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      sideSourcePlayerTeamPrototypeIds: Map<string, number[]>;
      sideSourcePlayerCoreState: Map<string, unknown>;
      sideSourceResourceGatheringManager: Map<string, {
        supplyWarehouses: number[];
        supplyCenters: number[];
      } | null>;
      sideSourcePlayerRelations: Map<string, Array<{ id: number; relationship: number }>>;
      sideSourceTeamRelations: Map<string, Array<{ id: number; relationship: number }>>;
      scriptTeamsByName: Map<string, Record<string, unknown>>;
      scriptDefaultTeamNameBySide: Map<string, string>;
      sidePowerBonus: Map<string, {
        powerBonus: number;
        energyProduction: number;
        energyConsumption: number;
        brownedOut: boolean;
        powerSabotagedUntilFrame: number;
      }>;
      defeatedSides: Set<string>;
      scriptCurrentSupplyWarehouseBySide: Map<string, number>;
      sidePlayerIndex: Map<string, number>;
      playerSideByIndex: Map<number, string>;
      playerRelationshipOverrides: Map<string, number>;
      teamRelationshipOverrides: Map<string, number>;
    };

    privateLogic.sideSourcePlayerTeamPrototypeIds.set('America', [99, 10]);
    privateLogic.sideSourcePlayerCoreState.set('America', {
      isPlayerDead: false,
      powerSabotagedTillFrame: 0,
      defaultTeamId: 5,
      levelUp: 7,
      levelDown: 3,
      generalName: 'General Townes',
      observer: false,
    });
    privateLogic.sideSourceResourceGatheringManager.set('America', {
      supplyWarehouses: [3],
      supplyCenters: [4],
    });
    privateLogic.sideSourcePlayerRelations.set('America', [{ id: 1, relationship: 0 }]);
    privateLogic.sideSourceTeamRelations.set('America', [{ id: 88, relationship: 0 }]);
    privateLogic.scriptTeamsByName.set('AMERICAAITEMPLATE', {
      nameUpper: 'AMERICAAITEMPLATE',
      prototypeNameUpper: 'AMERICAAITEMPLATE',
      sourcePrototypeId: 10,
      sourceTeamId: null,
      controllingSide: 'america',
      memberEntityIds: new Set<number>(),
      created: false,
    });
    privateLogic.scriptTeamsByName.set('TEAMTHEPLAYER', {
      nameUpper: 'TEAMTHEPLAYER',
      prototypeNameUpper: 'TEAMTHEPLAYER',
      sourcePrototypeId: 20,
      sourceTeamId: 77,
      controllingSide: 'america',
      memberEntityIds: new Set<number>(),
      created: false,
    });
    privateLogic.scriptTeamsByName.set('TEAMCHINA', {
      nameUpper: 'TEAMCHINA',
      prototypeNameUpper: 'TEAMCHINA',
      sourcePrototypeId: 30,
      sourceTeamId: 88,
      controllingSide: 'china',
      memberEntityIds: new Set<number>(),
      created: false,
    });
    privateLogic.scriptDefaultTeamNameBySide.set('america', 'TEAMTHEPLAYER');
    privateLogic.scriptDefaultTeamNameBySide.set('china', 'TEAMCHINA');
    privateLogic.sidePowerBonus.set('america', {
      powerBonus: 0,
      energyProduction: 0,
      energyConsumption: 0,
      brownedOut: false,
      powerSabotagedUntilFrame: 240,
    });
    privateLogic.defeatedSides.add('america');
    privateLogic.scriptCurrentSupplyWarehouseBySide.set('america', 8);
    privateLogic.sidePlayerIndex.set('America', 0);
    privateLogic.sidePlayerIndex.set('China', 1);
    privateLogic.playerSideByIndex.set(0, 'America');
    privateLogic.playerSideByIndex.set(1, 'China');
    privateLogic.playerRelationshipOverrides.set('america\u0000china', 2);
    privateLogic.teamRelationshipOverrides.set('america\u0000china', 1);

    const playerState = logic.captureSourcePlayerRuntimeSaveState();

    expect((playerState.state.sideSourcePlayerTeamPrototypeIds as Map<string, number[]>).get('America'))
      .toEqual([10, 20]);
    expect((playerState.state.sideSourcePlayerCoreState as Map<string, Record<string, unknown>>).get('America'))
      .toEqual({
        isPlayerDead: true,
        powerSabotagedTillFrame: 240,
        defaultTeamId: 77,
        levelUp: 7,
        levelDown: 3,
        generalName: 'General Townes',
        observer: false,
      });
    expect((playerState.state.sideSourceResourceGatheringManager as Map<string, {
      supplyWarehouses: number[];
      supplyCenters: number[];
    }>).get('America')).toEqual({
      supplyWarehouses: [8, 3],
      supplyCenters: [4],
    });
    expect((playerState.state.sideSourcePlayerRelations as Map<string, Array<{ id: number; relationship: number }>>)
      .get('America')).toEqual([{ id: 1, relationship: 2 }]);
    expect((playerState.state.sideSourceTeamRelations as Map<string, Array<{ id: number; relationship: number }>>)
      .get('America')).toEqual([{ id: 88, relationship: 1 }]);
  });

  it('removes source-backed Player::xfer relationship entries when live relationships are removed', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const privateLogic = logic as unknown as {
      sideSourcePlayerRelations: Map<string, Array<{ id: number; relationship: number }>>;
      sideSourceTeamRelations: Map<string, Array<{ id: number; relationship: number }>>;
      sidePlayerIndex: Map<string, number>;
      playerSideByIndex: Map<number, string>;
      scriptTeamsByName: Map<string, Record<string, unknown>>;
      scriptDefaultTeamNameBySide: Map<string, string>;
    };

    privateLogic.sideSourcePlayerRelations.set('America', [{ id: 1, relationship: 0 }]);
    privateLogic.sideSourceTeamRelations.set('America', [{ id: 88, relationship: 0 }]);
    privateLogic.sidePlayerIndex.set('America', 0);
    privateLogic.sidePlayerIndex.set('China', 1);
    privateLogic.playerSideByIndex.set(0, 'America');
    privateLogic.playerSideByIndex.set(1, 'China');
    privateLogic.scriptTeamsByName.set('TEAMCHINA', {
      nameUpper: 'TEAMCHINA',
      prototypeNameUpper: 'TEAMCHINA',
      sourcePrototypeId: 30,
      sourceTeamId: 88,
      controllingSide: 'china',
      memberEntityIds: new Set<number>(),
      created: false,
    });
    privateLogic.scriptDefaultTeamNameBySide.set('china', 'TEAMCHINA');

    logic.removePlayerRelationship('America', 'China');
    logic.removeTeamRelationship('America', 'China');

    const playerState = logic.captureSourcePlayerRuntimeSaveState();

    expect((playerState.state.sideSourcePlayerRelations as Map<string, Array<{ id: number; relationship: number }>>)
      .get('America')).toEqual([]);
    expect((playerState.state.sideSourceTeamRelations as Map<string, Array<{ id: number; relationship: number }>>)
      .get('America')).toEqual([]);
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

  it('captures live control groups into source Player::m_squads', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ranger', 'America', ['INFANTRY', 'SELECTABLE'], []),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Ranger', 10, 10),
        makeMapObject('Ranger', 20, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.restoreSourcePlayerRuntimeSaveState({
      version: 1,
      state: {
        playerSideByIndex: new Map([[0, 'America']]),
        sidePlayerIndex: new Map([['America', 0]]),
        localPlayerIndex: 0,
        sideSourcePlayerSquads: new Map([
          ['America', [[], [], [2], [], [], [], [], [], [], []]],
        ]),
      },
    });
    const selectionApi = logic as unknown as {
      selectedEntityId: number | null;
      selectedEntityIds: readonly number[];
    };
    selectionApi.selectedEntityIds = [1, 2, 999, 1];
    selectionApi.selectedEntityId = 1;

    expect(logic.setLocalPlayerControlGroupFromCurrentSelection(4)).toBe(true);

    const playerState = logic.captureSourcePlayerRuntimeSaveState();
    const squadsBySide = playerState.state.sideSourcePlayerSquads as Map<string, number[][]>;
    expect(squadsBySide.get('America')?.[2]).toEqual([]);
    expect(squadsBySide.get('America')?.[4]).toEqual([1, 2]);
  });

  it('restores source Player::m_squads into live control group selection', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ranger', 'America', ['INFANTRY', 'SELECTABLE'], []),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Ranger', 10, 10),
        makeMapObject('Ranger', 20, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.restoreSourcePlayerRuntimeSaveState({
      version: 1,
      state: {
        playerSideByIndex: new Map([[0, 'america']]),
        sidePlayerIndex: new Map([['america', 0]]),
        localPlayerIndex: 0,
        sideSourcePlayerSquads: new Map([
          ['america', [[2, 999, 2], [1], [], [], [], [], [], [], [], []]],
        ]),
      },
    });

    expect(logic.getLocalPlayerControlGroupIds(0)).toEqual([2]);
    expect(logic.selectLocalPlayerControlGroup(1)).toEqual([1]);
    expect(logic.getLocalPlayerSelectionIds()).toEqual([1]);
  });
});
