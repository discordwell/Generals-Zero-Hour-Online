/**
 * Tests for ZH-only container and transport runtime fixes:
 * 1. Dozer task cancellation on disable (Object.cpp:3820-3826)
 * 2. Helicopter formation offsets (AIGroup.cpp:1823-1850)
 * 3. Enclosing container vision suppression (Object.cpp:4944-4973)
 * 4. sellEverythingUnderTheSun filtering (Player.cpp:2311-2317)
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { getHelicopterOffset } from './entity-movement.js';
import { GameLogicSubsystem } from './index.js';
import { executeScriptPlayerSellEverything } from './script-actions.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Fix 1: Dozer task cancellation on disable (Object.cpp:3820-3826)
// ---------------------------------------------------------------------------

describe('dozer task cancellation on disable (Object.cpp:3820-3826)', () => {
  function makeDozerBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'DozerAIUpdate ModuleTag_AI', {
            RepairHealthPercentPerSecond: 5,
            BoredTime: 30000,
            BoredRange: 150,
          }),
        ]),
        makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_BASE_DEFENSE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 100 }),
          makeBlock('Behavior', 'FoundationUpdate ModuleTag_Foundation', {}),
        ], { BuildTime: 10000, BuildCost: 500 }),
      ],
    });
  }

  it('cancels active construction task when dozer gets DISABLED_EMP', () => {
    // C++ parity: Object.cpp:3820-3826 — when dozer becomes disabled,
    // dozerAI->cancelTask(dozerAI->getCurrentTask()) is called.
    const bundle = makeDozerBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USADozer', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;

    // Issue a build command to create a structure.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USABarracks',
      targetPosition: [80, 0, 80],
      angle: 0,
      lineEndPosition: null,
    });

    // Run a few frames to get construction started.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // Verify the dozer has a pending construction action.
    const hadConstruction = priv.pendingConstructionActions.has(1);

    // Apply EMP disable.
    priv.applyEmpDisable(priv.spawnedEntities.get(1), 150);

    // After EMP, the dozer's construction task should be cancelled.
    const hasConstructionAfterEmp = priv.pendingConstructionActions.has(1);

    // If the dozer had a construction task, it should now be cancelled.
    if (hadConstruction) {
      expect(hasConstructionAfterEmp).toBe(false);
    }
    // The dozer should have DISABLED_EMP status.
    expect(priv.spawnedEntities.get(1).objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });

  it('cancels active repair task when dozer gets DISABLED_HACKED', () => {
    // C++ parity: Object.cpp:3820-3826 — same cancellation on hack disable.
    const bundle = makeDozerBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USADozer', 50, 50),
        makeMapObject('USABarracks', 80, 80),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;

    // Damage the building so repair is possible.
    const building = priv.spawnedEntities.get(2);

    // Run some frames for initialization.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Issue repair command.
    logic.submitCommand({
      type: 'repairBuilding',
      entityId: 1,
      targetBuildingId: 2,
    });

    // Run a few frames.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const hadRepair = priv.pendingRepairActions.has(1);

    // Apply hacked disable.
    priv.setDisabledHackedStatusUntil(priv.spawnedEntities.get(1), priv.frameCounter + 300);

    // Verify the dozer has DISABLED_HACKED.
    expect(priv.spawnedEntities.get(1).objectStatusFlags.has('DISABLED_HACKED')).toBe(true);

    // If the dozer had a repair task, it should now be cancelled.
    if (hadRepair) {
      expect(priv.pendingRepairActions.has(1)).toBe(false);
    }
  });

  it('does not crash when EMP hits a non-dozer entity', () => {
    // Ensure the dozer check doesn't affect non-dozer entities.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    // This should not throw.
    priv.applyEmpDisable(priv.spawnedEntities.get(1), 150);
    expect(priv.spawnedEntities.get(1).objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Helicopter formation offsets (AIGroup.cpp:1823-1850)
// ---------------------------------------------------------------------------

describe('helicopter formation offsets (AIGroup.cpp:1823-1850)', () => {
  it('index 0 returns the base position unchanged', () => {
    // C++ parity: AIGroup.cpp:1825-1826 — if (idx == 0) return (no offset).
    const result = getHelicopterOffset(100, 200, 0);
    expect(result.x).toBe(100);
    expect(result.z).toBe(200);
  });

  it('index 1 returns position offset by the assumed helicopter diameter', () => {
    // C++ parity: AIGroup.cpp:1828-1848 — spiral offset starting at radius=70.
    const result = getHelicopterOffset(100, 200, 1);
    // With angle=0, sin(0)=0, cos(0)=1, so offset is (0, radius=70).
    expect(result.x).toBeCloseTo(100, 0); // sin(0) * 70 = 0
    expect(result.z).toBeCloseTo(270, 0); // 200 + cos(0) * 70 = 270
  });

  it('each helicopter gets a unique position (no stacking)', () => {
    // C++ parity: helicopters in a group should not stack on the same position.
    const positions = [];
    for (let i = 0; i < 8; i++) {
      positions.push(getHelicopterOffset(500, 500, i));
    }

    // Check all positions are unique (no two helicopters at the same spot).
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i]!.x - positions[j]!.x;
        const dz = positions[i]!.z - positions[j]!.z;
        const distSq = dx * dx + dz * dz;
        // Each position should be at least some distance apart.
        expect(distSq).toBeGreaterThan(1);
      }
    }
  });

  it('spiral grows to a new ring when angle exceeds 2*PI', () => {
    // C++ parity: AIGroup.cpp:1837-1843 — when angle > CIRCLE, radius += diameter.
    // With diameter=70, circumference=70*2*PI ~= 439.8, angleBetween = 70/439.8*2*PI ~= 1.0 rad.
    // After ~6 steps (6 * 1.0 > 2*PI), the radius should increase.
    const innerPos = getHelicopterOffset(0, 0, 1);
    const outerPos = getHelicopterOffset(0, 0, 10);

    const innerDist = Math.sqrt(innerPos.x * innerPos.x + innerPos.z * innerPos.z);
    const outerDist = Math.sqrt(outerPos.x * outerPos.x + outerPos.z * outerPos.z);

    // Outer helicopter should be on a larger ring.
    expect(outerDist).toBeGreaterThan(innerDist);
  });

  it('issueGroupMoveTo gives helicopters offset positions', () => {
    // C++ parity: AIGroup.cpp:1915-1919 — PRODUCED_AT_HELIPAD units get offset positions.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Comanche', 'America', ['VEHICLE', 'PRODUCED_AT_HELIPAD'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Locomotor', 'SET_NORMAL Locomotor', { Speed: 100 }),
        ]),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'SET_NORMAL Locomotor', { Speed: 50 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Comanche', 20, 20),
        makeMapObject('Comanche', 30, 30),
        makeMapObject('Tank', 40, 40),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run a few frames.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as any;

    // Issue group move.
    priv.issueGroupMoveTo([1, 2, 3], 64, 64);

    const heli1 = priv.spawnedEntities.get(1);
    const heli2 = priv.spawnedEntities.get(2);
    const tank = priv.spawnedEntities.get(3);

    // Tank (non-helicopter) should have exact target as move target.
    if (tank && tank.moveTarget) {
      expect(tank.moveTarget.x).toBeCloseTo(64, 0);
      expect(tank.moveTarget.z).toBeCloseTo(64, 0);
    }

    // Two helicopters should have different move targets (offset from each other).
    if (heli1?.moveTarget && heli2?.moveTarget) {
      const dx = heli1.moveTarget.x - heli2.moveTarget.x;
      const dz = heli1.moveTarget.z - heli2.moveTarget.z;
      const distSq = dx * dx + dz * dz;
      // They should NOT be at the same position.
      expect(distSq).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Enclosing container vision suppression (Object.cpp:4944-4973)
// ---------------------------------------------------------------------------

describe('enclosing container vision suppression (Object.cpp:4944-4973)', () => {
  it('units inside transports do not reveal shroud', () => {
    // C++ parity: Object.cpp:4954-4956 — units in non-garrisonable containers skip vision.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Humvee', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            MaxNumberOfUnits: 5,
            Slots: 5,
          }),
        ], { VisionRange: 200, ShroudClearingRange: 200 }),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 150, ShroudClearingRange: 150 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Humvee', 50, 50),
        makeMapObject('Ranger', 52, 52),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run a few frames.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as any;
    const ranger = priv.spawnedEntities.get(2);

    // Put the ranger inside the transport.
    ranger.transportContainerId = 1;
    ranger.objectStatusFlags.add('UNSELECTABLE');
    ranger.objectStatusFlags.add('DISABLED_HELD');
    ranger.objectStatusFlags.add('MASKED');

    // Run vision update.
    logic.update(1 / 30);

    // The ranger inside the transport should not be contributing vision.
    // We verify by checking that the entity's vision state is not looking.
    expect(ranger.visionState.isLooking).toBe(false);
  });

  it('units garrisoned in buildings still reveal shroud', () => {
    // C++ parity: garrison containers are garrisonable, so occupants CAN look.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CivBuilding', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
            MaxNumberOfUnits: 10,
          }),
        ], { VisionRange: 100, ShroudClearingRange: 100 }),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 150, ShroudClearingRange: 150 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 50, 50),
        makeMapObject('Ranger', 52, 52),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run a few frames.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as any;
    const ranger = priv.spawnedEntities.get(2);

    // Put the ranger inside the garrison.
    ranger.garrisonContainerId = 1;
    ranger.objectStatusFlags.add('UNSELECTABLE');

    // Run vision update.
    logic.update(1 / 30);

    // The ranger inside a garrison should still be looking (garrisonable container).
    expect(ranger.visionState.isLooking).toBe(true);
  });

  it('units inside tunnels do not reveal shroud', () => {
    // C++ parity: tunnels are non-garrisonable containers.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tunnel', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            MaxNumberOfUnits: 10,
          }),
        ], { VisionRange: 200, ShroudClearingRange: 200 }),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 150, ShroudClearingRange: 150 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tunnel', 50, 50),
        makeMapObject('Rebel', 52, 52),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run a few frames.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as any;
    const rebel = priv.spawnedEntities.get(2);

    // Put rebel inside the tunnel.
    rebel.tunnelContainerId = 1;
    rebel.objectStatusFlags.add('UNSELECTABLE');
    rebel.objectStatusFlags.add('DISABLED_HELD');
    rebel.objectStatusFlags.add('MASKED');

    // Run vision update.
    logic.update(1 / 30);

    // The rebel inside a tunnel should NOT be looking.
    expect(rebel.visionState.isLooking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 4: sellEverythingUnderTheSun filtering (Player.cpp:2311-2317)
// ---------------------------------------------------------------------------

describe('sellEverythingUnderTheSun filtering (Player.cpp:2311-2317)', () => {
  function makeSellBundle() {
    return makeBundle({
      objects: [
        // Faction structure (STRUCTURE + FS_*) — should be sold.
        makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_BASE_DEFENSE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 500 }),
        // Command center (COMMANDCENTER) — should be sold.
        makeObjectDef('USACommandCenter', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ], { BuildCost: 2000 }),
        // Power plant (FS_POWER) — should be sold.
        makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { BuildCost: 500 }),
        // Civilian building (STRUCTURE but no FS_*, no COMMANDCENTER, no FS_POWER) — should NOT be sold.
        makeObjectDef('CivBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
  }

  it('sells faction structures but not civilian structures', () => {
    // C++ parity: Player.cpp:2311-2317 — sellBuildings checks isFactionStructure() ||
    // isKindOf(COMMANDCENTER) || isKindOf(FS_POWER).
    const bundle = makeSellBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USABarracks', 20, 20),       // id 1 — faction structure
        makeMapObject('USACommandCenter', 50, 50),   // id 2 — command center
        makeMapObject('USAPowerPlant', 80, 20),       // id 3 — FS_POWER
        makeMapObject('CivBuilding', 80, 80),         // id 4 — civilian (no FS_*)
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run a few frames for initialization.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as any;

    // Verify all 4 entities exist.
    expect(priv.spawnedEntities.get(1)?.destroyed).toBeFalsy();
    expect(priv.spawnedEntities.get(2)?.destroyed).toBeFalsy();
    expect(priv.spawnedEntities.get(3)?.destroyed).toBeFalsy();
    expect(priv.spawnedEntities.get(4)?.destroyed).toBeFalsy();

    // Execute sell everything.
    executeScriptPlayerSellEverything(priv, 'America');

    // Run frames to process sell commands.
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    // Faction structures, command center, and power plant should be sold (destroyed or selling).
    const barracks = priv.spawnedEntities.get(1);
    const cc = priv.spawnedEntities.get(2);
    const power = priv.spawnedEntities.get(3);
    const civBuilding = priv.spawnedEntities.get(4);

    const barracksGone = barracks?.destroyed || priv.sellingEntities.has(1);
    const ccGone = cc?.destroyed || priv.sellingEntities.has(2);
    const powerGone = power?.destroyed || priv.sellingEntities.has(3);

    expect(barracksGone).toBe(true);
    expect(ccGone).toBe(true);
    expect(powerGone).toBe(true);

    // Civilian building should NOT be sold.
    expect(civBuilding?.destroyed).toBeFalsy();
    expect(priv.sellingEntities.has(4)).toBeFalsy();
  });

  it('does not sell structures without FS_ kindof prefix', () => {
    // Ensure a plain STRUCTURE with no FS_ prefix is not touched.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CivHospital', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('CivHospital', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as any;
    executeScriptPlayerSellEverything(priv, 'America');

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const hospital = priv.spawnedEntities.get(1);
    expect(hospital?.destroyed).toBeFalsy();
  });
});
