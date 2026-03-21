/**
 * Parity Tests — CashBounty kill credits and Supply warehouse box depletion.
 *
 * Source references:
 *   Player.cpp:2069-2089 — doBountyForKill(): awards ceil(costToBuild * m_cashBountyPercent)
 *   CashBountyPower.cpp:169-179 — onSpecialPowerCreation(): sets player m_cashBountyPercent
 *   SupplyWarehouseDockUpdate.cpp:93-140 — action(): decrements m_boxesStored, returns FALSE at 0
 *   entity-lifecycle.ts:1806-1845 — awardCashBountyOnKill(): TS implementation
 *   supply-chain.ts:519-536 — tickGathering(): 1 box per action cycle, stops when warehouse empty
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeLocomotorDef,
  place,
} from './parity-agent.js';
import {
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';
import { GameLogicSubsystem } from './index.js';
import * as THREE from 'three';

// ── Test 1: CashBounty on Kill ────────────────────────────────────────────

describe('CashBounty kill credits', () => {
  /**
   * C++ parity: Player::doBountyForKill (Player.cpp:2069-2089)
   *
   *   void Player::doBountyForKill(const Object* killer, const Object* victim) {
   *     if (!killer || !victim) return;
   *     if (victim->testStatus(OBJECT_STATUS_UNDER_CONSTRUCTION)) return;
   *     Int costToBuild = victim->getTemplate()->calcCostToBuild(victim->getControllingPlayer());
   *     Int bounty = REAL_TO_INT_CEIL(costToBuild * m_cashBountyPercent);
   *     if (bounty) {
   *       getMoney()->deposit(bounty);
   *       m_scoreKeeper.addMoneyEarned(bounty);
   *     }
   *   }
   *
   * The bounty is ceil(buildCost * bountyPercent). The percent is set via
   * CashBountyPower::onSpecialPowerCreation(), which stores it on the player.
   * Only enemy kills award bounty (same-side kills do not).
   *
   * TS parity: entity-lifecycle.ts awardCashBountyOnKill() implements the
   * same formula using sideCashBountyPercent map.
   */

  it('awards ceil(buildCost * bountyPercent) credits when killing an enemy unit', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BountyGun'),
          ]),
          makeObjectDef('Victim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 20, InitialHealth: 20 }),
          ], { BuildCost: 800 }),
        ],
        weapons: [
          makeWeaponDef('BountyGun', {
            PrimaryDamage: 200,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Victim', 30, 10)],
      mapSize: 64,
      sides: { America: { credits: 0 }, China: { credits: 0 } },
      enemies: [['America', 'China']],
    });

    // Activate cash bounty via private field (same pattern as update-behaviors.test.ts).
    // Source parity: CashBountyPower::onSpecialPowerCreation sets m_cashBountyPercent.
    const priv = agent.gameLogic as unknown as {
      sideCashBountyPercent: Map<string, number>;
    };
    priv.sideCashBountyPercent.set('america', 0.25); // 25% bounty

    agent.setCredits('America', 0);
    const before = agent.snapshot();

    // Order the attack.
    agent.attack(1, 2);
    // Run enough frames for the one-shot kill.
    agent.step(10);

    // Victim should be dead.
    const victim = agent.entity(2);
    expect(victim === null || !victim.alive).toBe(true);

    // Bounty = ceil(800 * 0.25) = 200.
    const d = agent.diff(before);
    expect(d.creditChanges['America']).toBe(200);
  });

  it('awards correct bounty with non-integer multiplication (ceil rounding)', () => {
    // Test REAL_TO_INT_CEIL rounding: ceil(750 * 0.20) = ceil(150) = 150
    // Test REAL_TO_INT_CEIL rounding: ceil(750 * 0.15) = ceil(112.5) = 113
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Shooter', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('KillGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          ], { BuildCost: 750 }),
        ],
        weapons: [
          makeWeaponDef('KillGun', {
            PrimaryDamage: 500,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Shooter', 10, 10), place('Target', 30, 10)],
      mapSize: 64,
      sides: { America: { credits: 0 }, China: {} },
      enemies: [['America', 'China']],
    });

    const priv = agent.gameLogic as unknown as {
      sideCashBountyPercent: Map<string, number>;
    };
    priv.sideCashBountyPercent.set('america', 0.15); // 15% bounty

    agent.setCredits('America', 0);
    agent.attack(1, 2);
    agent.step(10);

    // Victim should be dead.
    const target = agent.entity(2);
    expect(target === null || !target.alive).toBe(true);

    // ceil(750 * 0.15) = ceil(112.5) = 113
    const credits = agent.gameLogic.getSideCredits('America');
    expect(credits).toBe(113);
  });

  it('does NOT award bounty when killing own units (same side)', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('FriendlyShooter', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('FriendlyGun'),
          ]),
          makeObjectDef('FriendlyTarget', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          ], { BuildCost: 1000 }),
        ],
        weapons: [
          makeWeaponDef('FriendlyGun', {
            PrimaryDamage: 500,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('FriendlyShooter', 10, 10), place('FriendlyTarget', 30, 10)],
      mapSize: 64,
      sides: { America: { credits: 0 } },
    });

    const priv = agent.gameLogic as unknown as {
      sideCashBountyPercent: Map<string, number>;
    };
    priv.sideCashBountyPercent.set('america', 0.5); // 50% bounty

    agent.setCredits('America', 0);

    // Force-attack own unit.
    agent.attack(1, 2);
    agent.step(10);

    // Source parity: Player::doBountyForKill checks victim != same side.
    // No bounty for friendly kills.
    const credits = agent.gameLogic.getSideCredits('America');
    expect(credits).toBe(0);
  });

  it('does NOT award bounty when bountyPercent is 0 (power not activated)', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('NoBountyAttacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('NoBountyGun'),
          ]),
          makeObjectDef('NoBountyVictim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          ], { BuildCost: 1000 }),
        ],
        weapons: [
          makeWeaponDef('NoBountyGun', {
            PrimaryDamage: 500,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('NoBountyAttacker', 10, 10), place('NoBountyVictim', 30, 10)],
      mapSize: 64,
      sides: { America: { credits: 0 }, China: {} },
      enemies: [['America', 'China']],
    });

    // Do NOT set cashBountyPercent — defaults to 0.
    agent.setCredits('America', 0);

    agent.attack(1, 2);
    agent.step(10);

    // No bounty when percent is 0.
    const credits = agent.gameLogic.getSideCredits('America');
    expect(credits).toBe(0);
  });
});

// ── Test 2: Supply Warehouse Box Depletion ────────────────────────────────

describe('supply warehouse box depletion', () => {
  /**
   * C++ parity: SupplyWarehouseDockUpdate::action() (SupplyWarehouseDockUpdate.cpp:93-140)
   *
   *   Bool SupplyWarehouseDockUpdate::action(Object* docker, Object* drone) {
   *     if (m_boxesStored == 0) return FALSE;  // no boxes left → reject dock
   *     --m_boxesStored;
   *     SupplyTruckAIInterface* ai = docker->getAIUpdateInterface()->getSupplyTruckAIInterface();
   *     if (ai && ai->gainOneBox(m_boxesStored)) {
   *       if (m_boxesStored == 0 && m_deleteWhenEmpty) {
   *         TheGameLogic->destroyObject(getObject());
   *         return FALSE;
   *       }
   *       ...
   *       return TRUE;
   *     } else
   *       ++m_boxesStored;  // take back — no one to receive
   *     return FALSE;
   *   }
   *
   * The warehouse has a finite box count (StartingBoxes). Each dock action
   * removes one box. When 0, the warehouse rejects all truck docking.
   *
   * TS parity: supply-chain.ts tickGathering() lines 519-536 implements:
   *   if (warehouseState.currentBoxes > 0 && state.currentBoxes < truckProfile.maxBoxes) {
   *     warehouseState.currentBoxes--;
   *     state.currentBoxes++;
   *   }
   */

  function makeDepletionBundle(startingBoxes: number, deleteWhenEmpty: boolean = false) {
    return makeBundle({
      objects: [
        makeObjectDef('FiniteWarehouse', 'Neutral', ['STRUCTURE', 'SUPPLY_SOURCE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
            StartingBoxes: startingBoxes,
            DeleteWhenEmpty: deleteWhenEmpty ? 'Yes' : 'No',
          }),
        ]),
        makeObjectDef('SupplyDepot', 'America', ['STRUCTURE', 'SUPPLY_CENTER', 'CAN_PERSIST_AND_CHANGE_OWNER'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'SupplyCenterDockUpdate ModuleTag_Dock', {
            ValueMultiplier: 1,
          }),
        ]),
        makeObjectDef('SupplyTruck', 'America', ['VEHICLE', 'HARVESTER'], [
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

  it('warehouse depletes to 0 boxes after repeated supply truck gathering', () => {
    // StartingBoxes = 6, MaxBoxes per truck = 3.
    // Truck should gather 3 boxes (trip 1), then 3 boxes (trip 2) = 6 total = warehouse empty.
    const bundle = makeDepletionBundle(6);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Place all entities close together for fast cycling.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FiniteWarehouse', 20, 20),
        makeMapObject('SupplyDepot', 40, 20),
        makeMapObject('SupplyTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'Neutral');
    logic.setSideCredits('America', 0);
    logic.update(0);

    expect(logic.getSideCredits('america')).toBe(0);

    // Access warehouse state to verify depletion.
    const priv = logic as unknown as {
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
    };

    // Verify warehouse starts with 6 boxes.
    const warehouseId = 1; // first entity placed
    const initialState = priv.supplyWarehouseStates.get(warehouseId);
    expect(initialState).toBeDefined();
    expect(initialState!.currentBoxes).toBe(6);

    // Run enough frames for the truck to fully deplete the warehouse.
    // With 0 action delay and close proximity, each gather-deposit cycle is fast.
    for (let i = 0; i < 600; i++) {
      logic.update(1 / 30);
    }

    // Warehouse should be depleted.
    const finalState = priv.supplyWarehouseStates.get(warehouseId);
    expect(finalState).toBeDefined();
    expect(finalState!.currentBoxes).toBe(0);

    // Credits should reflect exactly 6 boxes * 100 per box = 600.
    const credits = logic.getSideCredits('america');
    expect(credits).toBe(600);
  });

  it('truck cannot gather from empty warehouse', () => {
    // Start with 3 boxes (1 full truck load). After the first trip,
    // warehouse should be empty and truck should not gather more.
    const bundle = makeDepletionBundle(3);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    logic.loadMapObjects(
      makeMap([
        makeMapObject('FiniteWarehouse', 20, 20),
        makeMapObject('SupplyDepot', 40, 20),
        makeMapObject('SupplyTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'Neutral');
    logic.setSideCredits('America', 0);
    logic.update(0);

    const priv = logic as unknown as {
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
    };

    // Run enough for one full cycle (gather 3 boxes, deposit).
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
    }

    // Warehouse should be empty.
    const warehouseState = priv.supplyWarehouseStates.get(1);
    expect(warehouseState!.currentBoxes).toBe(0);

    // Record credits at this point.
    const creditsAfterFirstCycle = logic.getSideCredits('america');
    expect(creditsAfterFirstCycle).toBe(300); // 3 boxes * 100

    // Run more frames — no additional credits should be earned.
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
    }

    const creditsAfterSecondCycle = logic.getSideCredits('america');
    // Credits should not increase — warehouse is empty, truck can't gather.
    // Source parity: SupplyWarehouseDockUpdate::action returns FALSE when m_boxesStored == 0.
    expect(creditsAfterSecondCycle).toBe(creditsAfterFirstCycle);
  });

  it('warehouse with DeleteWhenEmpty is destroyed after last box is taken', () => {
    const bundle = makeDepletionBundle(3, true); // DeleteWhenEmpty = Yes
    const logic = new GameLogicSubsystem(new THREE.Scene());

    logic.loadMapObjects(
      makeMap([
        makeMapObject('FiniteWarehouse', 20, 20),
        makeMapObject('SupplyDepot', 40, 20),
        makeMapObject('SupplyTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'Neutral');
    logic.setSideCredits('America', 0);
    logic.update(0);

    // Verify warehouse exists initially.
    expect(logic.getEntityState(1)).toBeDefined();
    expect(logic.getEntityState(1)!.alive).toBe(true);

    // Run enough frames for depletion.
    for (let i = 0; i < 600; i++) {
      logic.update(1 / 30);
    }

    // Source parity: SupplyWarehouseDockUpdate::action() at line 118-121:
    //   if (m_boxesStored == 0 && m_deleteWhenEmpty) {
    //     TheGameLogic->destroyObject(getObject());
    //   }
    // Warehouse should be destroyed after the last box is taken.
    const warehouseState = logic.getEntityState(1);
    expect(warehouseState === null || !warehouseState.alive).toBe(true);

    // Credits should still reflect the 3 boxes gathered.
    const credits = logic.getSideCredits('america');
    expect(credits).toBe(300);
  });

  it('partial truck load when warehouse has fewer boxes than MaxBoxes', () => {
    // Warehouse has 2 boxes but truck MaxBoxes = 3.
    // Truck should gather only 2 boxes, deposit 200 credits, then stop.
    const bundle = makeDepletionBundle(2);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    logic.loadMapObjects(
      makeMap([
        makeMapObject('FiniteWarehouse', 20, 20),
        makeMapObject('SupplyDepot', 40, 20),
        makeMapObject('SupplyTruck', 30, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'Neutral');
    logic.setSideCredits('America', 0);
    logic.update(0);

    const priv = logic as unknown as {
      supplyWarehouseStates: Map<number, { currentBoxes: number }>;
    };

    // Run enough for the truck to complete a full gather-deposit cycle.
    for (let i = 0; i < 600; i++) {
      logic.update(1 / 30);
    }

    // Warehouse should be empty.
    expect(priv.supplyWarehouseStates.get(1)!.currentBoxes).toBe(0);

    // Credits = 2 boxes * 100 per box = 200.
    const credits = logic.getSideCredits('america');
    expect(credits).toBe(200);
  });
});
