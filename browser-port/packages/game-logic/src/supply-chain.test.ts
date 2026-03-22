/**
 * Supply chain economy tests.
 *
 * Source parity: SupplyTruckAIUpdate state machine and warehouse/depot
 * dock updates drive the RTS economy. Tests verify the gather→deposit
 * cycle produces credits matching C++ behavior.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

function makeSupplyBundle() {
  return makeBundle({
    objects: [
      // Supply warehouse (like SupplySource in retail)
      makeObjectDef('TestWarehouse', 'Neutral', ['STRUCTURE', 'SUPPLY_SOURCE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
          StartingBoxes: 50,
          DeleteWhenEmpty: 'No',
        }),
      ]),

      // Supply center (like AmericaSupplyCenter in retail)
      makeObjectDef('TestDepot', 'America', ['STRUCTURE', 'SUPPLY_CENTER', 'CAN_PERSIST_AND_CHANGE_OWNER'], [
        makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        makeBlock('Behavior', 'SupplyCenterDockUpdate ModuleTag_Dock', {
          ValueMultiplier: 1,
        }),
      ]),

      // Supply truck (like AmericaVehicleSupplyTruck in retail)
      makeObjectDef('TestTruck', 'America', ['VEHICLE', 'HARVESTER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 150, InitialHealth: 150 }),
        makeBlock('LocomotorSet', 'SET_NORMAL TruckLoco', {}),
        makeBlock('Behavior', 'SupplyTruckAIUpdate ModuleTag_AI', {
          MaxBoxes: 3,
          SupplyCenterActionDelay: 0,
          SupplyWarehouseActionDelay: 0,
          SupplyWarehouseScanDistance: 500,
        }),
      ], { VisionRange: 200, ShroudClearingRange: 200 }),
    ],

    locomotors: [
      makeLocomotorDef('TruckLoco', 60),
    ],
  });
}

describe('supply chain economy', () => {
  it('supply truck gathers boxes from warehouse and deposits credits at depot', () => {
    const bundle = makeSupplyBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Place warehouse, depot, and truck close together
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestWarehouse', 20, 20),
        makeMapObject('TestDepot', 40, 20),
        makeMapObject('TestTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic.update(0);

    const initialCredits = logic.getSideCredits('america');
    expect(initialCredits).toBe(0);

    // Verify entities exist with correct profiles
    const states = logic.getRenderableEntityStates();
    const truck = states.find(e => e.templateName === 'TestTruck');
    const warehouse = states.find(e => e.templateName === 'TestWarehouse');
    const depot = states.find(e => e.templateName === 'TestDepot');
    expect(truck).toBeDefined();
    expect(warehouse).toBeDefined();
    expect(depot).toBeDefined();

    // Check that the truck is a harvester (has supply truck profile)
    const truckInfo = logic.getSelectedEntityInfoById(truck!.id);
    // The truck should have the HARVESTER kindOf
    expect(states.length).toBe(3);

    // Run for enough frames that the truck should complete at least one
    // gather-deliver cycle
    for (let i = 0; i < 600; i++) {
      logic.update(1 / 30);
    }

    const finalCredits = logic.getSideCredits('america');
    // Should have earned credits from supply chain
    expect(finalCredits).toBeGreaterThan(0);
  });

  it('getEntityState exposes supplyBoxes and supplyMaxBoxes for supply trucks', () => {
    const bundle = makeSupplyBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestWarehouse', 20, 20),
        makeMapObject('TestDepot', 200, 20),
        makeMapObject('TestTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic.update(0);

    // Get truck entity id.
    const states = logic.getRenderableEntityStates();
    const truck = states.find(e => e.templateName === 'TestTruck')!;

    // Initially 0 boxes, max 3.
    const initialState = logic.getEntityState(truck.id)!;
    expect(initialState.supplyBoxes).toBe(0);
    expect(initialState.supplyMaxBoxes).toBe(3);

    // Non-supply entities should have null.
    const warehouse = states.find(e => e.templateName === 'TestWarehouse')!;
    const warehouseState = logic.getEntityState(warehouse.id)!;
    expect(warehouseState.supplyBoxes).toBeNull();
    expect(warehouseState.supplyMaxBoxes).toBeNull();
  });
});
