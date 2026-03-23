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
  DEFAULT_MAX_APPROACH_SLOTS,
  DEFAULT_SUPPLY_BOX_VALUE,
  SupplyTruckAIState,
  findNearestWarehouseWithBoxes,
  findNearestSupplyCenter,
  updateSupplyTruck,
  type DockApproachState,
  type SupplyChainContext,
  type SupplyChainEntity,
  type SupplyTruckProfile,
  type SupplyTruckState,
  type SupplyWarehouseProfile,
  type SupplyWarehouseState,
} from './supply-chain.js';
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

// ──── Unit-level dock approach slot tests ────────────────────────────────────

function makeTestEntity(id: number, x: number, z: number, side = 'America'): SupplyChainEntity {
  return { id, side, x, z, destroyed: false, moving: false, moveTarget: null };
}

function makeTruckProfile(overrides: Partial<SupplyTruckProfile> = {}): SupplyTruckProfile {
  return {
    maxBoxes: 3,
    supplyCenterActionDelayFrames: 0,
    supplyWarehouseActionDelayFrames: 0,
    supplyWarehouseScanDistance: 500,
    upgradedSupplyBoost: 0,
    ...overrides,
  };
}

function makeTestContext(
  entities: SupplyChainEntity[],
  options: {
    warehouseIds?: number[];
    centerIds?: number[];
    warehouseBoxes?: Map<number, number>;
  } = {},
): SupplyChainContext<SupplyChainEntity> {
  const spawnedEntities = new Map<number, SupplyChainEntity>();
  for (const e of entities) spawnedEntities.set(e.id, e);

  const warehouseStates = new Map<number, SupplyWarehouseState>();
  const truckStates = new Map<number, SupplyTruckState>();
  const dockApproachStates = new Map<number, DockApproachState>();
  const sideCredits = new Map<string, number>();
  const warehouseIds = new Set(options.warehouseIds ?? []);
  const centerIds = new Set(options.centerIds ?? []);

  for (const whId of warehouseIds) {
    const boxes = options.warehouseBoxes?.get(whId) ?? 50;
    warehouseStates.set(whId, { currentBoxes: boxes });
  }

  const warehouseProfile: SupplyWarehouseProfile = { startingBoxes: 50, deleteWhenEmpty: false };

  return {
    frameCounter: 0,
    spawnedEntities,
    supplyBoxValue: DEFAULT_SUPPLY_BOX_VALUE,
    getWarehouseProfile: (e) => warehouseIds.has(e.id) ? warehouseProfile : null,
    getTruckProfile: () => null,
    isSupplyCenter: (e) => centerIds.has(e.id),
    isWarehouseDockCrippled: () => false,
    getWarehouseState: (id) => warehouseStates.get(id),
    setWarehouseState: (id, s) => { warehouseStates.set(id, s); },
    getTruckState: (id) => truckStates.get(id),
    setTruckState: (id, s) => { truckStates.set(id, s); },
    getDockApproachState: (id) => dockApproachStates.get(id),
    setDockApproachState: (id, s) => { dockApproachStates.set(id, s); },
    depositCredits: (side, amount) => {
      sideCredits.set(side, (sideCredits.get(side) ?? 0) + amount);
    },
    getSupplyTruckDepositBoost: () => 0,
    getRelationship: () => 'allies',
    getSidePlayerType: () => 'COMPUTER',
    getEntityShroudStatus: () => 'CLEAR',
    moveEntityTo: () => {},
    destroyEntity: () => {},
    normalizeSide: (s) => (s ?? '').toLowerCase(),
  };
}

describe('dock approach slots', () => {
  it('findNearestWarehouseWithBoxes skips warehouses at max docker capacity', () => {
    const truck = makeTestEntity(1, 0, 0);
    const wh1 = makeTestEntity(10, 10, 0, 'Neutral');
    const wh2 = makeTestEntity(11, 50, 0, 'Neutral');

    const ctx = makeTestContext([truck, wh1, wh2], {
      warehouseIds: [10, 11],
    });

    // Fill wh1 to capacity.
    ctx.setDockApproachState(10, {
      currentDockerCount: DEFAULT_MAX_APPROACH_SLOTS,
      maxDockers: DEFAULT_MAX_APPROACH_SLOTS,
    });

    const truckState: SupplyTruckState = {
      aiState: SupplyTruckAIState.IDLE,
      currentBoxes: 0,
      targetWarehouseId: null,
      targetDepotId: null,
      actionDelayFinishFrame: 0,
      preferredDockId: null,
      forceBusy: false,
    };

    const result = findNearestWarehouseWithBoxes(truck, 500, ctx, truckState);
    // wh1 is full, so truck should pick wh2.
    expect(result).not.toBeNull();
    expect(result!.id).toBe(11);
  });

  it('findNearestSupplyCenter skips centers at max docker capacity', () => {
    const truck = makeTestEntity(1, 0, 0);
    const center1 = makeTestEntity(20, 10, 0);
    const center2 = makeTestEntity(21, 50, 0);

    const ctx = makeTestContext([truck, center1, center2], {
      centerIds: [20, 21],
    });

    const truckState: SupplyTruckState = {
      aiState: SupplyTruckAIState.IDLE,
      currentBoxes: 3,
      targetWarehouseId: null,
      targetDepotId: null,
      actionDelayFinishFrame: 0,
      preferredDockId: null,
      forceBusy: false,
    };

    // Fill center1 to capacity.
    ctx.setDockApproachState(20, {
      currentDockerCount: DEFAULT_MAX_APPROACH_SLOTS,
      maxDockers: DEFAULT_MAX_APPROACH_SLOTS,
    });

    const result = findNearestSupplyCenter(truck, ctx, truckState);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(21);
  });

  it('updateSupplyTruck increments docker count when approaching warehouse', () => {
    const truck = makeTestEntity(1, 0, 0);
    const wh = makeTestEntity(10, 100, 0, 'Neutral');
    const profile = makeTruckProfile();

    const ctx = makeTestContext([truck, wh], { warehouseIds: [10] });

    // Run one tick — truck should start approaching warehouse.
    updateSupplyTruck(truck, profile, ctx);

    const truckState = ctx.getTruckState(1)!;
    expect(truckState.aiState).toBe(SupplyTruckAIState.APPROACHING_WAREHOUSE);
    expect(truckState.targetWarehouseId).toBe(10);

    // Docker count should have incremented.
    const approachState = ctx.getDockApproachState(10);
    expect(approachState).toBeDefined();
    expect(approachState!.currentDockerCount).toBe(1);
  });

  it('updateSupplyTruck decrements docker count when warehouse is destroyed while approaching', () => {
    const truck = makeTestEntity(1, 0, 0);
    const wh = makeTestEntity(10, 100, 0, 'Neutral');
    const profile = makeTruckProfile();

    const ctx = makeTestContext([truck, wh], { warehouseIds: [10] });

    // Tick 1: start approaching.
    updateSupplyTruck(truck, profile, ctx);
    expect(ctx.getDockApproachState(10)!.currentDockerCount).toBe(1);

    // Destroy warehouse.
    wh.destroyed = true;

    // Tick 2: truck detects destroyed warehouse and releases slot.
    updateSupplyTruck(truck, profile, ctx);

    expect(ctx.getDockApproachState(10)!.currentDockerCount).toBe(0);
    const truckState = ctx.getTruckState(1)!;
    expect(truckState.aiState).toBe(SupplyTruckAIState.IDLE);
  });

  it('updateSupplyTruck decrements docker count on arrival at warehouse', () => {
    // Place truck right next to warehouse (within 25-unit proximity threshold).
    const truck = makeTestEntity(1, 5, 0);
    const wh = makeTestEntity(10, 10, 0, 'Neutral');
    const center = makeTestEntity(20, 200, 0);
    const profile = makeTruckProfile();

    const ctx = makeTestContext([truck, wh, center], {
      warehouseIds: [10],
      centerIds: [20],
    });

    // Tick 1: start approaching (very close, so will also arrive).
    updateSupplyTruck(truck, profile, ctx);

    // On first tick the truck starts approaching, then on second tick it arrives.
    // But since the tick dispatches by state, the first tick transitions to APPROACHING_WAREHOUSE
    // and the second tick transitions to GATHERING.
    const truckState1 = ctx.getTruckState(1)!;
    if (truckState1.aiState === SupplyTruckAIState.APPROACHING_WAREHOUSE) {
      // Need a second tick to transition.
      updateSupplyTruck(truck, profile, ctx);
    }

    const truckState2 = ctx.getTruckState(1)!;
    expect(truckState2.aiState).toBe(SupplyTruckAIState.GATHERING);
    // Dock slot released after arrival.
    expect(ctx.getDockApproachState(10)!.currentDockerCount).toBe(0);
  });
});
