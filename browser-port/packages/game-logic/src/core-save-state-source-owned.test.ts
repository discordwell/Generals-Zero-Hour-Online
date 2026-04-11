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
