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

function makeRepairDockSaveBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('RepairDock', 'America', ['STRUCTURE', 'REPAIR_PAD'], [
        makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Repair', {
          TimeForFullHeal: 3000,
        }),
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      ]),
      makeObjectDef('DamagedVehicle', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
      ]),
    ],
  });
}

describe('repair-dock save-state', () => {
  it('stores repair-dock runtime on entities instead of the browser runtime blob', () => {
    const registry = makeRegistry(makeRepairDockSaveBundle());
    const map = makeMap([
      makeMapObject('RepairDock', 55, 55),
      makeMapObject('DamagedVehicle', 55, 55),
    ], 128, 128);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingRepairDockActions');

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(128, 128));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const privateRestored = restored as unknown as {
      spawnedEntities: Map<number, {
        repairDockState: unknown;
        repairDockLastRepairEntityId: number;
        repairDockHealthToAddPerFrame: number;
      }>;
      pendingRepairDockActions: Map<number, {
        dockObjectId: number;
        commandSource: 'PLAYER' | 'AI' | 'SCRIPT';
        lastRepairDockObjectId: number;
        healthToAddPerFrame: number;
      }>;
    };

    expect(privateRestored.spawnedEntities.get(2)?.repairDockState).toEqual({
      dockObjectId: 1,
      commandSource: 'PLAYER',
    });
    expect(privateRestored.spawnedEntities.get(1)?.repairDockLastRepairEntityId).toBe(2);
    expect(privateRestored.spawnedEntities.get(1)?.repairDockHealthToAddPerFrame ?? 0).toBeGreaterThan(0);
    expect(privateRestored.pendingRepairDockActions.get(2)?.dockObjectId).toBe(1);
    expect(privateRestored.pendingRepairDockActions.get(2)?.lastRepairDockObjectId).toBe(1);
    expect(privateRestored.pendingRepairDockActions.get(2)?.healthToAddPerFrame ?? 0).toBeGreaterThan(0);
  });

  it('hydrates legacy browser repair-dock maps into entity-owned state', () => {
    const registry = makeRegistry(makeRepairDockSaveBundle());
    const map = makeMap([
      makeMapObject('RepairDock', 55, 55),
      makeMapObject('DamagedVehicle', 55, 55),
    ], 128, 128);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingRepairDockActions: new Map([[2, {
        dockObjectId: 1,
        commandSource: 'SCRIPT',
        lastRepairDockObjectId: 1,
        healthToAddPerFrame: 3.25,
      }]]),
    });

    const privateLogic = logic as unknown as {
      spawnedEntities: Map<number, {
        repairDockState: unknown;
        repairDockLastRepairEntityId: number;
        repairDockHealthToAddPerFrame: number;
      }>;
      pendingRepairDockActions: Map<number, {
        dockObjectId: number;
        commandSource: 'PLAYER' | 'AI' | 'SCRIPT';
        lastRepairDockObjectId: number;
        healthToAddPerFrame: number;
      }>;
    };

    expect(privateLogic.spawnedEntities.get(2)?.repairDockState).toEqual({
      dockObjectId: 1,
      commandSource: 'SCRIPT',
    });
    expect(privateLogic.spawnedEntities.get(1)?.repairDockLastRepairEntityId).toBe(2);
    expect(privateLogic.spawnedEntities.get(1)?.repairDockHealthToAddPerFrame).toBeCloseTo(3.25, 6);
    expect(privateLogic.pendingRepairDockActions.get(2)).toEqual({
      dockObjectId: 1,
      commandSource: 'SCRIPT',
      lastRepairDockObjectId: 1,
      healthToAddPerFrame: 3.25,
    });
  });
});
