import * as THREE from 'three';
import { XferSave } from '@generals/engine';
import { describe, expect, it } from 'vitest';

import {
  ARMOR_SET_FLAG_MASK_BY_NAME,
  createEmptySourceMapEntitySaveState,
  GameLogicSubsystem,
} from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
  makeSpecialPowerDef,
  makeUpgradeDef,
} from './test-helpers.js';

function makeSourceOwnedCoreBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('AmericaBarracks', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', { MaxQueueEntries: 9 }),
      ]),
      makeObjectDef('AmericaRanger', 'America', ['INFANTRY'], [], { BuildCost: 225, BuildTime: 5 }),
      makeObjectDef('SupplyPile', 'Neutral', ['STRUCTURE'], [
        makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
          StartingBoxes: 50,
          NumberApproachPositions: 3,
        }),
      ]),
      makeObjectDef('RepairBay', 'Neutral', ['STRUCTURE'], [
        makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Dock', {
          NumberApproachPositions: 2,
          TimeForFullHeal: 5000,
        }),
      ]),
      makeObjectDef('DroneSpawner', 'America', ['VEHICLE'], [
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: 3,
          SpawnTemplateName: 'DroneA DroneB',
          OneShot: true,
          InitialBurst: 2,
          AggregateHealth: true,
        }),
      ]),
      makeObjectDef('DroneA', 'America', ['DRONE'], []),
      makeObjectDef('DroneB', 'America', ['DRONE'], []),
      makeObjectDef('SpecialPowerBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'OCLSpecialPower ModuleTag_Bomb', {
          SpecialPowerTemplate: 'SuperweaponTest',
          OCL: 'OCL_TestBomb',
        }),
      ]),
      makeObjectDef('StealthUnit', 'GLA', ['VEHICLE'], [
        makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
          StealthDelay: 2000,
          StealthForbiddenConditions: 'ATTACKING MOVING',
        }),
      ]),
      makeObjectDef('TransportBox', 'America', ['VEHICLE', 'TRANSPORT'], [
        makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
          Slots: 2,
          PassengersAllowedToFire: false,
        }),
      ]),
      makeObjectDef('GarrisonBunker', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
          ContainMax: 2,
        }),
      ]),
      makeObjectDef('CaveNode', 'Neutral', ['STRUCTURE'], [
        makeBlock('Behavior', 'CaveContain ModuleTag_Contain', {
          ContainMax: 3,
          CaveIndex: 0,
        }),
      ]),
      makeObjectDef('SpyVisionBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Behavior', 'SpyVisionSpecialPower ModuleTag_SpyPower', {
          SpecialPowerTemplate: 'SpyVisionPower',
          BaseDuration: 30000,
        }),
        makeBlock('Behavior', 'SpyVisionUpdate ModuleTag_SpyUpdate', {
          SpecialPowerTemplate: 'SpyVisionPower',
        }),
      ]),
    ],
    specialPowers: [
      makeSpecialPowerDef('SuperweaponTest', { ReloadTime: 60000 }),
      makeSpecialPowerDef('SpyVisionPower', { ReloadTime: 60000 }),
    ],
    upgrades: [
      makeUpgradeDef('Upgrade_AmericaRangerCaptureBuilding', { Type: 'PLAYER', BuildCost: 1000, BuildTime: 30 }),
    ],
  });
}

function sourceRawInt32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, Math.trunc(value), true);
  return bytes;
}

function writeSourceOpenContain(
  saver: XferSave,
  options: {
    passengerIds: number[];
    passengerAllowedToFire?: boolean;
    rallyPointExists?: boolean;
    rallyPoint?: { x: number; y: number; z: number };
  },
): void {
  saver.xferVersion(2);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(options.passengerIds.length);
  for (const passengerId of options.passengerIds) {
    saver.xferObjectID(passengerId);
  }
  saver.xferUser(new Uint8Array(2));
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferUnsignedInt(0);
  saver.xferVersion(1);
  saver.xferInt(0);
  saver.xferUser(new Uint8Array(32 * 48));
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferInt(0);
  saver.xferBool(false);
  saver.xferCoord3D(options.rallyPoint ?? { x: 0, y: 0, z: 0 });
  saver.xferBool(options.rallyPointExists ?? false);
  saver.xferUnsignedShort(0);
  saver.xferInt(1);
  saver.xferBool(options.passengerAllowedToFire ?? false);
}

function writeSourceTransportContain(
  saver: XferSave,
  options: {
    passengerIds: number[];
    passengerAllowedToFire?: boolean;
    payloadCreated: boolean;
  },
): void {
  saver.xferVersion(1);
  writeSourceOpenContain(saver, options);
  saver.xferBool(options.payloadCreated);
  saver.xferInt(0);
  saver.xferUnsignedInt(0);
}

function buildSourceTransportContainModuleData(options: {
  passengerIds: number[];
  passengerAllowedToFire?: boolean;
  payloadCreated: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-transport-contain');
  try {
    writeSourceTransportContain(saver, options);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceGarrisonContainModuleData(options: {
  passengerIds: number[];
  passengerAllowedToFire?: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-garrison-contain');
  try {
    saver.xferVersion(1);
    writeSourceOpenContain(saver, options);
    saver.xferUnsignedInt(0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceCaveContainModuleData(options: {
  passengerIds: number[];
  caveIndex: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-cave-contain');
  try {
    saver.xferVersion(1);
    writeSourceOpenContain(saver, { passengerIds: options.passengerIds });
    saver.xferBool(false);
    saver.xferInt(options.caveIndex);
    saver.xferUnsignedInt(0);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceActiveBodyModuleData(options: {
  health: number;
  maxHealth: number;
  initialHealth: number;
  subdualDamage: number;
  damageScalar: number;
  frontCrushed: boolean;
  backCrushed: boolean;
  indestructible: boolean;
  armorSetFlags: string[];
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-active-body');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferReal(options.damageScalar);
    saver.xferReal(options.health);
    saver.xferReal(options.subdualDamage);
    saver.xferReal(options.health);
    saver.xferReal(options.maxHealth);
    saver.xferReal(options.initialHealth);
    saver.xferUser(sourceRawInt32(0));
    saver.xferUnsignedInt(0);
    saver.xferUser(sourceRawInt32(0));
    saver.xferVersion(1);
    saver.xferVersion(3);
    saver.xferObjectID(0);
    saver.xferUser(new Uint8Array(2));
    saver.xferUser(sourceRawInt32(0));
    saver.xferUser(sourceRawInt32(11));
    saver.xferUser(sourceRawInt32(0));
    saver.xferReal(0);
    saver.xferBool(false);
    saver.xferUser(sourceRawInt32(0));
    saver.xferCoord3D({ x: 0, y: 0, z: 0 });
    saver.xferReal(0);
    saver.xferReal(0);
    saver.xferReal(0);
    saver.xferAsciiString('');
    saver.xferVersion(1);
    saver.xferReal(0);
    saver.xferReal(0);
    saver.xferBool(false);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(0);
    saver.xferBool(options.frontCrushed);
    saver.xferBool(options.backCrushed);
    saver.xferBool(false);
    saver.xferBool(options.indestructible);
    saver.xferUnsignedShort(0);
    saver.xferVersion(1);
    saver.xferInt(options.armorSetFlags.length);
    for (const flag of options.armorSetFlags) {
      saver.xferAsciiString(flag);
    }
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceProductionUpdateModuleData(options: {
  uniqueId: number;
  queue: Array<{
    type: number;
    name: string;
    productionId: number;
    percentComplete: number;
    framesUnderConstruction: number;
    productionQuantityTotal: number;
    productionQuantityProduced: number;
    exitDoor: number;
  }>;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-production-update');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedShort(options.queue.length);
    for (const entry of options.queue) {
      saver.xferUser(sourceRawInt32(entry.type));
      saver.xferAsciiString(entry.name);
      saver.xferUser(sourceRawInt32(entry.productionId));
      saver.xferReal(entry.percentComplete);
      saver.xferInt(entry.framesUnderConstruction);
      saver.xferInt(entry.productionQuantityTotal);
      saver.xferInt(entry.productionQuantityProduced);
      saver.xferInt(entry.exitDoor);
    }
    saver.xferUser(sourceRawInt32(options.uniqueId));
    saver.xferUnsignedInt(options.queue.length);
    saver.xferUnsignedInt(0);
    saver.xferUser(new Uint8Array(64));
    saver.xferVersion(1);
    saver.xferInt(0);
    saver.xferVersion(1);
    saver.xferInt(0);
    saver.xferBool(false);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function writeSourceDockUpdate(
  saver: XferSave,
  options: {
    numberApproachPositions: number;
    approachPositionOwners: number[];
    approachPositionReached?: boolean[];
    activeDocker?: number;
    dockerInside?: boolean;
    dockCrippled?: boolean;
    dockOpen?: boolean;
  },
): void {
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferVersion(1);
  saver.xferUnsignedInt(0);
  saver.xferCoord3D({ x: 0, y: 0, z: 0 });
  saver.xferCoord3D({ x: 0, y: 0, z: 0 });
  saver.xferCoord3D({ x: 0, y: 0, z: 0 });
  saver.xferInt(options.numberApproachPositions);
  saver.xferBool(true);
  saver.xferInt(0);
  saver.xferInt(options.approachPositionOwners.length);
  for (const owner of options.approachPositionOwners) {
    saver.xferObjectID(owner);
  }
  const reached = options.approachPositionReached ?? [];
  saver.xferInt(reached.length);
  for (const value of reached) {
    saver.xferBool(value);
  }
  saver.xferObjectID(options.activeDocker ?? 0);
  saver.xferBool(options.dockerInside ?? false);
  saver.xferBool(options.dockCrippled ?? false);
  saver.xferBool(options.dockOpen ?? true);
}

function buildSourceSupplyWarehouseDockUpdateModuleData(options: {
  boxesStored: number;
  numberApproachPositions: number;
  approachPositionOwners: number[];
  dockCrippled: boolean;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-supply-warehouse-dock-update');
  try {
    saver.xferVersion(1);
    writeSourceDockUpdate(saver, options);
    saver.xferInt(options.boxesStored);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceRepairDockUpdateModuleData(options: {
  lastRepair: number;
  healthToAddPerFrame: number;
  numberApproachPositions: number;
  approachPositionOwners: number[];
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-repair-dock-update');
  try {
    saver.xferVersion(1);
    writeSourceDockUpdate(saver, options);
    saver.xferObjectID(options.lastRepair);
    saver.xferReal(options.healthToAddPerFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpawnBehaviorModuleData(options: {
  initialBurstTimesInited: boolean;
  spawnTemplateName: string;
  oneShotCountdown: number;
  replacementTimes: number[];
  spawnIds: number[];
  active: boolean;
  aggregateHealth: boolean;
  spawnCount: number;
  selfTaskingSpawnCount: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spawn-behavior');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferBool(options.initialBurstTimesInited);
    saver.xferAsciiString(options.spawnTemplateName);
    saver.xferInt(options.oneShotCountdown);
    saver.xferInt(0);
    saver.xferInt(0);
    saver.xferVersion(1);
    saver.xferUnsignedShort(options.replacementTimes.length);
    for (const frame of options.replacementTimes) {
      saver.xferInt(frame);
    }
    saver.xferVersion(1);
    saver.xferUnsignedShort(options.spawnIds.length);
    for (const objectId of options.spawnIds) {
      saver.xferObjectID(objectId);
    }
    saver.xferBool(options.active);
    saver.xferBool(options.aggregateHealth);
    saver.xferInt(options.spawnCount);
    saver.xferUnsignedInt(options.selfTaskingSpawnCount);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpecialPowerModuleData(options: {
  availableOnFrame: number;
  pausedCount: number;
  pausedOnFrame: number;
  pausedPercent: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-special-power-module');
  try {
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(options.availableOnFrame);
    saver.xferInt(options.pausedCount);
    saver.xferUnsignedInt(options.pausedOnFrame);
    saver.xferReal(options.pausedPercent);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceStealthUpdateModuleData(options: {
  stealthAllowedFrame: number;
  detectionExpiresFrame: number;
  enabled: boolean;
  pulsePhaseRate: number;
  pulsePhase: number;
  disguiseAsPlayerIndex: number;
  disguiseTemplateName: string;
  disguiseTransitionFrames: number;
  disguiseHalfpointReached: boolean;
  transitioningToDisguise: boolean;
  disguised: boolean;
  framesGranted: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-stealth-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(options.stealthAllowedFrame);
    saver.xferUnsignedInt(options.detectionExpiresFrame);
    saver.xferBool(options.enabled);
    saver.xferReal(options.pulsePhaseRate);
    saver.xferReal(options.pulsePhase);
    saver.xferInt(options.disguiseAsPlayerIndex);
    saver.xferAsciiString(options.disguiseTemplateName);
    saver.xferUnsignedInt(options.disguiseTransitionFrames);
    saver.xferBool(options.disguiseHalfpointReached);
    saver.xferBool(options.transitioningToDisguise);
    saver.xferBool(options.disguised);
    saver.xferUnsignedInt(options.framesGranted);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

function buildSourceSpyVisionUpdateModuleData(options: {
  deactivateFrame: number;
  currentlyActive: boolean;
  resetTimersNextUpdate: boolean;
  disabledUntilFrame: number;
}): Uint8Array {
  const saver = new XferSave();
  saver.open('test-source-spy-vision-update');
  try {
    saver.xferVersion(2);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferVersion(1);
    saver.xferUnsignedInt(0);
    saver.xferUnsignedInt(options.deactivateFrame);
    saver.xferBool(options.currentlyActive);
    saver.xferBool(options.resetTimersNextUpdate);
    saver.xferUnsignedInt(options.disabledUntilFrame);
    return new Uint8Array(saver.getBuffer());
  } finally {
    saver.close();
  }
}

describe('source-owned game-logic core save-state', () => {
  it('rebuilds live entities from source GameLogic Object::xfer import state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    const disabledTillFrame = Array.from({ length: 13 }, () => 0);
    disabledTillFrame[2] = 90;
    sourceState.objectId = 42;
    sourceState.position = { x: 24, y: 3, z: 28 };
    sourceState.orientation = 0.75;
    sourceState.internalName = 'SAVED_BARRACKS';
    sourceState.statusBits = ['CAN_ATTACK'];
    sourceState.scriptStatus = 0x04 | 0x10;
    sourceState.disabledMask = ['DISABLED_EMP'];
    sourceState.disabledTillFrame = disabledTillFrame;
    sourceState.completedUpgradeNames = ['Upgrade_A'];
    sourceState.commandSetStringOverride = 'CommandSet_Saved';
    sourceState.modules = [{
      identifier: 'ModuleTag_Body',
      blockData: buildSourceActiveBodyModuleData({
        health: 321,
        maxHealth: 500,
        initialHealth: 450,
        subdualDamage: 17,
        damageScalar: 0.75,
        frontCrushed: true,
        backCrushed: true,
        indestructible: true,
        armorSetFlags: ['VETERAN'],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'AmericaBarracks',
        state: sourceState,
      }],
      scriptScoringEnabled: false,
      rankLevelLimit: 3,
    });

    const privateLogic = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        scriptName: string | null;
        x: number;
        y: number;
        z: number;
        rotationY: number;
        objectStatusFlags: Set<string>;
        disabledEmpUntilFrame: number;
        completedUpgrades: Set<string>;
        commandSetStringOverride: string | null;
        health: number;
        maxHealth: number;
        initialHealth: number;
        currentSubdualDamage: number;
        battlePlanDamageScalar: number;
        frontCrushed: boolean;
        backCrushed: boolean;
        isIndestructible: boolean;
        armorSetFlagsMask: number;
      }>;
      scriptScoringEnabled: boolean;
      rankLevelLimit: number;
    };

    expect(privateLogic.frameCounter).toBe(77);
    expect(privateLogic.scriptScoringEnabled).toBe(false);
    expect(privateLogic.rankLevelLimit).toBe(3);
    expect(logic.getObjectIdCounter()).toBe(100);
    expect([...privateLogic.spawnedEntities.keys()]).toEqual([42]);

    const entity = privateLogic.spawnedEntities.get(42)!;
    expect(entity.templateName).toBe('AmericaBarracks');
    expect(entity.scriptName).toBe('SAVED_BARRACKS');
    expect(entity.x).toBe(24);
    expect(entity.y).toBe(3);
    expect(entity.z).toBe(28);
    expect(entity.rotationY).toBe(0.75);
    expect(entity.objectStatusFlags.has('CAN_ATTACK')).toBe(true);
    expect(entity.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(entity.objectStatusFlags.has('SCRIPT_UNSELLABLE')).toBe(true);
    expect(entity.objectStatusFlags.has('SCRIPT_TARGETABLE')).toBe(true);
    expect(entity.disabledEmpUntilFrame).toBe(90);
    expect(entity.completedUpgrades).toEqual(new Set(['Upgrade_A']));
    expect(entity.commandSetStringOverride).toBe('CommandSet_Saved');
    expect(entity.health).toBe(321);
    expect(entity.maxHealth).toBe(500);
    expect(entity.initialHealth).toBe(450);
    expect(entity.currentSubdualDamage).toBe(17);
    expect(entity.battlePlanDamageScalar).toBe(0.75);
    expect(entity.frontCrushed).toBe(true);
    expect(entity.backCrushed).toBe(true);
    expect(entity.isIndestructible).toBe(true);
    expect(entity.armorSetFlagsMask).toBe(ARMOR_SET_FLAG_MASK_BY_NAME.get('VETERAN'));
  });

  it('imports source ProductionUpdate queue state into live production entries', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 43;
    sourceState.position = { x: 20, y: 0, z: 20 };
    sourceState.orientation = 0;
    sourceState.modules = [{
      identifier: 'ModuleTag_Production',
      blockData: buildSourceProductionUpdateModuleData({
        uniqueId: 9,
        queue: [
          {
            type: 1,
            name: 'AmericaRanger',
            productionId: 7,
            percentComplete: 40,
            framesUnderConstruction: 60,
            productionQuantityTotal: 2,
            productionQuantityProduced: 1,
            exitDoor: -1,
          },
          {
            type: 2,
            name: 'Upgrade_AmericaRangerCaptureBuilding',
            productionId: 0,
            percentComplete: 25,
            framesUnderConstruction: 225,
            productionQuantityTotal: 0,
            productionQuantityProduced: 0,
            exitDoor: -1,
          },
        ],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'AmericaBarracks',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        productionNextId: number;
        productionQueue: Array<
          | {
            type: 'UNIT';
            templateName: string;
            productionId: number;
            buildCost: number;
            totalProductionFrames: number;
            framesUnderConstruction: number;
            percentComplete: number;
            productionQuantityTotal: number;
            productionQuantityProduced: number;
          }
          | {
            type: 'UPGRADE';
            upgradeName: string;
            productionId: number;
            buildCost: number;
            totalProductionFrames: number;
            framesUnderConstruction: number;
            percentComplete: number;
            upgradeType: 'PLAYER' | 'OBJECT';
          }
        >;
      }>;
      hasSideUpgradeInProduction(side: string, upgradeName: string): boolean;
    };

    const entity = privateLogic.spawnedEntities.get(43)!;
    expect(entity.productionNextId).toBe(9);
    expect(entity.productionQueue).toHaveLength(2);
    expect(entity.productionQueue[0]).toEqual({
      type: 'UNIT',
      templateName: 'AmericaRanger',
      productionId: 7,
      buildCost: 225,
      totalProductionFrames: 150,
      framesUnderConstruction: 60,
      percentComplete: 40,
      productionQuantityTotal: 2,
      productionQuantityProduced: 1,
    });
    expect(entity.productionQueue[1]).toEqual({
      type: 'UPGRADE',
      upgradeName: 'UPGRADE_AMERICARANGERCAPTUREBUILDING',
      productionId: 0,
      buildCost: 1000,
      totalProductionFrames: 900,
      framesUnderConstruction: 225,
      percentComplete: 25,
      upgradeType: 'PLAYER',
    });
    expect(privateLogic.hasSideUpgradeInProduction(
      'America',
      'Upgrade_AmericaRangerCaptureBuilding',
    )).toBe(true);
  });

  it('imports source DockUpdate-owned warehouse and repair dock state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const warehouseState = createEmptySourceMapEntitySaveState();
    warehouseState.objectId = 44;
    warehouseState.position = { x: 10, y: 0, z: 10 };
    warehouseState.modules = [{
      identifier: 'ModuleTag_Dock',
      blockData: buildSourceSupplyWarehouseDockUpdateModuleData({
        boxesStored: 13,
        numberApproachPositions: 3,
        approachPositionOwners: [101, 0, 102],
        dockCrippled: true,
      }),
    }];

    const repairState = createEmptySourceMapEntitySaveState();
    repairState.objectId = 45;
    repairState.position = { x: 12, y: 0, z: 12 };
    repairState.modules = [{
      identifier: 'ModuleTag_Dock',
      blockData: buildSourceRepairDockUpdateModuleData({
        lastRepair: 77,
        healthToAddPerFrame: 1.25,
        numberApproachPositions: 2,
        approachPositionOwners: [201],
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [
        { templateName: 'SupplyPile', state: warehouseState },
        { templateName: 'RepairBay', state: repairState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        swCripplingDockDisabled: boolean;
        repairDockLastRepairEntityId: number;
        repairDockHealthToAddPerFrame: number;
      }>;
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
      dockApproachStates: Map<number, { currentDockerCount: number; maxDockers: number }>;
    };

    expect(privateLogic.supplyWarehouseStates.get(44)).toEqual({ currentBoxes: 13 });
    expect(privateLogic.dockApproachStates.get(44)).toEqual({
      currentDockerCount: 2,
      maxDockers: 3,
    });
    expect(privateLogic.spawnedEntities.get(44)!.swCripplingDockDisabled).toBe(true);
    expect(privateLogic.dockApproachStates.get(45)).toEqual({
      currentDockerCount: 1,
      maxDockers: 2,
    });
    expect(privateLogic.spawnedEntities.get(45)!.repairDockLastRepairEntityId).toBe(77);
    expect(privateLogic.spawnedEntities.get(45)!.repairDockHealthToAddPerFrame).toBe(1.25);
  });

  it('imports source SpawnBehavior slave and replacement state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 46;
    sourceState.position = { x: 30, y: 0, z: 30 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Spawn',
      blockData: buildSourceSpawnBehaviorModuleData({
        initialBurstTimesInited: true,
        spawnTemplateName: 'DroneB',
        oneShotCountdown: 2,
        replacementTimes: [88, 99],
        spawnIds: [1001, 1002],
        active: false,
        aggregateHealth: true,
        spawnCount: 2,
        selfTaskingSpawnCount: 1,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'DroneSpawner',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        spawnBehaviorState: {
          slaveIds: number[];
          replacementFrames: number[];
          templateNameIndex: number;
          oneShotRemaining: number;
          oneShotCompleted: boolean;
          initialBurstApplied: boolean;
        } | null;
      }>;
    };

    const state = privateLogic.spawnedEntities.get(46)!.spawnBehaviorState!;
    expect(state.slaveIds).toEqual([1001, 1002]);
    expect(state.replacementFrames).toEqual([88, 99]);
    expect(state.templateNameIndex).toBe(1);
    expect(state.oneShotRemaining).toBe(2);
    expect(state.oneShotCompleted).toBe(true);
    expect(state.initialBurstApplied).toBe(true);
  });

  it('imports source SpecialPowerModule ready and pause state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 47;
    sourceState.position = { x: 34, y: 0, z: 34 };
    sourceState.modules = [{
      identifier: 'ModuleTag_Bomb',
      blockData: buildSourceSpecialPowerModuleData({
        availableOnFrame: 180,
        pausedCount: 2,
        pausedOnFrame: 91,
        pausedPercent: 0.375,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [{
        templateName: 'SpecialPowerBuilding',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, {
          availableOnFrame: number;
          pausedCount: number;
          pausedOnFrame: number;
          pausedPercent: number;
        }>;
      }>;
      shortcutSpecialPowerSourceByName: Map<string, Map<number, number>>;
      pausedShortcutSpecialPowerByName: Map<string, Map<number, { pausedCount: number; pausedOnFrame: number }>>;
    };

    const module = privateLogic.spawnedEntities.get(47)!.specialPowerModules.get('SUPERWEAPONTEST')!;
    expect(module.availableOnFrame).toBe(180);
    expect(module.pausedCount).toBe(2);
    expect(module.pausedOnFrame).toBe(91);
    expect(module.pausedPercent).toBe(0.375);
    expect(privateLogic.shortcutSpecialPowerSourceByName.get('SUPERWEAPONTEST')?.get(47)).toBe(180);
    expect(privateLogic.pausedShortcutSpecialPowerByName.get('SUPERWEAPONTEST')?.get(47)).toEqual({
      pausedCount: 2,
      pausedOnFrame: 91,
    });
    expect(logic.resolveShortcutSpecialPowerReadyFrameForSourceEntity('SuperweaponTest', 47)).toBe(209);
    expect(logic.getSpecialPowerPercentReady('SuperweaponTest', 47)).toBe(0.375);
  });

  it('imports source StealthUpdate timing and disguise state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 48;
    sourceState.position = { x: 38, y: 0, z: 38 };
    sourceState.statusBits = ['CAN_STEALTH', 'STEALTHED'];
    sourceState.modules = [{
      identifier: 'ModuleTag_Stealth',
      blockData: buildSourceStealthUpdateModuleData({
        stealthAllowedFrame: 150,
        detectionExpiresFrame: 240,
        enabled: true,
        pulsePhaseRate: 0.125,
        pulsePhase: 1.75,
        disguiseAsPlayerIndex: 2,
        disguiseTemplateName: 'AmericaRanger',
        disguiseTransitionFrames: 11,
        disguiseHalfpointReached: true,
        transitioningToDisguise: true,
        disguised: true,
        framesGranted: 45,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [{
        templateName: 'StealthUnit',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        stealthDelayRemaining: number;
        detectedUntilFrame: number;
        stealthEnabled: boolean;
        stealthPulsePhaseRate: number;
        stealthPulsePhase: number;
        stealthDisguisePlayerIndex: number;
        disguiseTemplateName: string | null;
        stealthDisguiseTransitionFrames: number;
        stealthDisguiseHalfpointReached: boolean;
        stealthTransitioningToDisguise: boolean;
        temporaryStealthGrant: boolean;
        temporaryStealthExpireFrame: number;
      }>;
    };

    const entity = privateLogic.spawnedEntities.get(48)!;
    expect(entity.stealthDelayRemaining).toBe(30);
    expect(entity.detectedUntilFrame).toBe(240);
    expect(entity.stealthEnabled).toBe(true);
    expect(entity.stealthPulsePhaseRate).toBe(0.125);
    expect(entity.stealthPulsePhase).toBe(1.75);
    expect(entity.stealthDisguisePlayerIndex).toBe(2);
    expect(entity.disguiseTemplateName).toBe('AmericaRanger');
    expect(entity.stealthDisguiseTransitionFrames).toBe(11);
    expect(entity.stealthDisguiseHalfpointReached).toBe(true);
    expect(entity.stealthTransitioningToDisguise).toBe(true);
    expect(entity.temporaryStealthGrant).toBe(true);
    expect(entity.temporaryStealthExpireFrame).toBe(165);
    expect(entity.objectStatusFlags.has('DISGUISED')).toBe(true);
  });

  it('imports source Contain passenger lists after all objects are created', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const transportState = createEmptySourceMapEntitySaveState();
    transportState.objectId = 50;
    transportState.position = { x: 40, y: 0, z: 40 };
    transportState.modules = [{
      identifier: 'ModuleTag_Contain',
      blockData: buildSourceTransportContainModuleData({
        passengerIds: [61],
        passengerAllowedToFire: true,
        payloadCreated: true,
      }),
    }];

    const garrisonState = createEmptySourceMapEntitySaveState();
    garrisonState.objectId = 51;
    garrisonState.position = { x: 44, y: 0, z: 40 };
    garrisonState.modules = [{
      identifier: 'ModuleTag_Contain',
      blockData: buildSourceGarrisonContainModuleData({
        passengerIds: [62],
        passengerAllowedToFire: true,
      }),
    }];

    const caveState = createEmptySourceMapEntitySaveState();
    caveState.objectId = 52;
    caveState.position = { x: 48, y: 0, z: 40 };
    caveState.modules = [{
      identifier: 'ModuleTag_Contain',
      blockData: buildSourceCaveContainModuleData({
        passengerIds: [63],
        caveIndex: 7,
      }),
    }];

    const transportPassengerState = createEmptySourceMapEntitySaveState();
    transportPassengerState.objectId = 61;
    transportPassengerState.position = { x: 60, y: 0, z: 40 };
    const garrisonPassengerState = createEmptySourceMapEntitySaveState();
    garrisonPassengerState.objectId = 62;
    garrisonPassengerState.position = { x: 64, y: 0, z: 40 };
    const cavePassengerState = createEmptySourceMapEntitySaveState();
    cavePassengerState.objectId = 63;
    cavePassengerState.position = { x: 68, y: 0, z: 40 };

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [
        { templateName: 'TransportBox', state: transportState },
        { templateName: 'GarrisonBunker', state: garrisonState },
        { templateName: 'CaveNode', state: caveState },
        { templateName: 'AmericaRanger', state: transportPassengerState },
        { templateName: 'AmericaRanger', state: garrisonPassengerState },
        { templateName: 'AmericaRanger', state: cavePassengerState },
      ],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        containProfile: { passengersAllowedToFire: boolean; caveIndex?: number } | null;
        initialPayloadCreated: boolean;
        transportContainerId: number | null;
        garrisonContainerId: number | null;
        tunnelContainerId: number | null;
        objectStatusFlags: Set<string>;
      }>;
      caveTrackerIndexByEntityId: Map<number, number>;
      caveTrackers: Map<number, { tunnelIds: Set<number>; passengerIds: Set<number> }>;
    };

    const transport = privateLogic.spawnedEntities.get(50)!;
    const garrison = privateLogic.spawnedEntities.get(51)!;
    const cave = privateLogic.spawnedEntities.get(52)!;
    const transportPassenger = privateLogic.spawnedEntities.get(61)!;
    const garrisonPassenger = privateLogic.spawnedEntities.get(62)!;
    const cavePassenger = privateLogic.spawnedEntities.get(63)!;

    expect(transport.initialPayloadCreated).toBe(true);
    expect(transport.containProfile?.passengersAllowedToFire).toBe(true);
    expect(transportPassenger.transportContainerId).toBe(50);
    expect(transportPassenger.objectStatusFlags.has('MASKED')).toBe(true);
    expect(garrison.containProfile?.passengersAllowedToFire).toBe(true);
    expect(garrisonPassenger.garrisonContainerId).toBe(51);
    expect(garrisonPassenger.objectStatusFlags.has('DISABLED_HELD')).toBe(true);
    expect(cave.containProfile?.caveIndex).toBe(7);
    expect(privateLogic.caveTrackerIndexByEntityId.get(52)).toBe(7);
    expect(cavePassenger.tunnelContainerId).toBe(52);
    expect(privateLogic.caveTrackers.get(7)?.tunnelIds.has(52)).toBe(true);
    expect(privateLogic.caveTrackers.get(7)?.passengerIds.has(63)).toBe(true);
  });

  it('imports source SpyVisionUpdate active and timer state', () => {
    const bundle = makeSourceOwnedCoreBundle();
    const registry = makeRegistry(bundle);
    const map = makeMap([], 64, 64);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 70;
    sourceState.position = { x: 70, y: 0, z: 40 };
    sourceState.modules = [{
      identifier: 'ModuleTag_SpyUpdate',
      blockData: buildSourceSpyVisionUpdateModuleData({
        deactivateFrame: 300,
        currentlyActive: true,
        resetTimersNextUpdate: true,
        disabledUntilFrame: 180,
      }),
    }];

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 120,
      objectIdCounter: 100,
      objects: [{
        templateName: 'SpyVisionBuilding',
        state: sourceState,
      }],
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        specialPowerModules: Map<string, {
          spyVisionDeactivateFrame: number;
          spyVisionCurrentlyActive?: boolean;
          spyVisionResetTimersNextUpdate?: boolean;
          spyVisionDisabledUntilFrame?: number;
        }>;
      }>;
    };

    const module = privateLogic.spawnedEntities.get(70)!.specialPowerModules.get('SPYVISIONPOWER')!;
    expect(module.spyVisionDeactivateFrame).toBe(300);
    expect(module.spyVisionCurrentlyActive).toBe(true);
    expect(module.spyVisionResetTimersNextUpdate).toBe(true);
    expect(module.spyVisionDisabledUntilFrame).toBe(180);
  });

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
      commandSetButtonSlotOverrides: Map<string, Map<number, string | null>>;
    };
    privateLogic.frameCounter = 20;
    privateLogic.sellingEntities.set(1, { sellFrame: 20, constructionPercent: 99.9 });
    privateLogic.thingTemplateBuildableOverrides.set('AMERICABARRACKS', 'NO');
    privateLogic.commandSetButtonSlotOverrides.set(
      'AMERICABARRACKSCOMMANDSET',
      new Map([[1, 'COMMAND_AMERICA_BARRACKS']],),
    );

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('sellingEntities');
    expect(browserState).not.toHaveProperty('thingTemplateBuildableOverrides');
    expect(browserState).not.toHaveProperty('commandSetButtonSlotOverrides');
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
    expect(restoredPrivate.commandSetButtonSlotOverrides).toEqual(
      new Map([['AMERICABARRACKSCOMMANDSET', new Map([[1, 'COMMAND_AMERICA_BARRACKS']])]]),
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
      commandSetButtonSlotOverrides: new Map([
        ['AmericaBarracksCommandSet', new Map([[1, 'Command_America_Barracks'], [2, null]])],
      ]),
      bridgeDamageStatesChangedFrame: 77,
      bridgeDamageStateByControlEntity: new Map([[1, false]]),
    });

    const privateLogic = logic as unknown as {
      sellingEntities: Map<number, { sellFrame: number; constructionPercent: number }>;
      thingTemplateBuildableOverrides: Map<string, string>;
      commandSetButtonSlotOverrides: Map<string, Map<number, string | null>>;
    };

    expect(privateLogic.sellingEntities.get(1)).toEqual({
      sellFrame: 12,
      constructionPercent: 88.5,
    });
    expect(privateLogic.thingTemplateBuildableOverrides).toEqual(
      new Map([['AMERICABARRACKS', 'ONLY_BY_AI']]),
    );
    expect(privateLogic.commandSetButtonSlotOverrides).toEqual(
      new Map([['AMERICABARRACKSCOMMANDSET', new Map([[1, 'COMMAND_AMERICA_BARRACKS'], [2, null]])]]),
    );
  });
});
