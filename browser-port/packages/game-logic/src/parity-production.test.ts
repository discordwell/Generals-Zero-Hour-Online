/**
 * Production Parity Tests — verify production speed, power penalties, and sell refund
 * mechanics match C++ source behavior.
 *
 * Tests verify:
 * - MultipleFactory build speed bonus (C++ ThingTemplate.cpp:1421)
 * - Low energy production penalty (C++ ThingTemplate.cpp:1396-1410)
 * - Sell refund percentage (C++ GlobalData.cpp:873, BuildAssistant.cpp:257-262)
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeCommandButtonDef,
  makeCommandSetDef,
} from './test-helpers.js';

// ── Shared factory/unit definitions ──────────────────────────────────────────

/**
 * Build a bundle with one or more factories and a producible unit.
 * Each factory has a ProductionUpdate and a DefaultProductionExitUpdate.
 * The unit has BuildTime in seconds (converted to frames at 30 FPS internally).
 */
function makeProductionBundle(opts: {
  factoryCount: number;
  unitBuildTimeSec: number;
  factoryEnergyBonus?: number;
  powerPlantEnergyBonus?: number;
  /** Extra structures that consume power (negative EnergyBonus). */
  powerConsumers?: Array<{ name: string; energyBonus: number }>;
}) {
  const objects = [];

  // Factories
  for (let i = 0; i < opts.factoryCount; i++) {
    objects.push(
      makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_FACTORY'], [
        makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
        makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
          UnitCreatePoint: [20, 0, 0],
          NaturalRallyPoint: [40, 0, 0],
        }),
      ], {
        CommandSet: 'USABarracksCommandSet',
        EnergyProduction: opts.factoryEnergyBonus ?? 0,
      }),
    );
  }

  // Producible unit
  objects.push(
    makeObjectDef('USARanger', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], { BuildCost: 225, BuildTime: opts.unitBuildTimeSec }),
  );

  // Optional power plant
  if (opts.powerPlantEnergyBonus !== undefined) {
    objects.push(
      makeObjectDef('USAPowerPlant', 'America', ['STRUCTURE', 'FS_POWER'], [
        makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      ], { EnergyProduction: opts.powerPlantEnergyBonus }),
    );
  }

  // Optional power consumers
  if (opts.powerConsumers) {
    for (const consumer of opts.powerConsumers) {
      objects.push(
        makeObjectDef(consumer.name, 'America', ['STRUCTURE'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { EnergyProduction: consumer.energyBonus }),
      );
    }
  }

  return makeBundle({
    objects,
    commandSets: [
      makeCommandSetDef('USABarracksCommandSet', { '1': 'Cmd_TrainRanger' }),
    ],
    commandButtons: [
      makeCommandButtonDef('Cmd_TrainRanger', { Command: 'UNIT_BUILD', Object: 'USARanger' }),
    ],
  });
}

/**
 * Count how many frames it takes for a unit production to complete.
 * Queues a unit on the given factory and advances until either the unit
 * spawns or the max frame count is reached.
 */
function measureProductionFrames(logic: GameLogicSubsystem, factoryId: number, maxFrames = 600): number {
  logic.submitCommand({
    type: 'queueUnitProduction',
    entityId: factoryId,
    unitTemplateName: 'USARanger',
  });
  logic.update(1 / 30); // process the queue command

  for (let frame = 1; frame <= maxFrames; frame++) {
    logic.update(1 / 30);
    const entities = logic.getRenderableEntityStates();
    const ranger = entities.find(e => e.templateName === 'USARanger');
    if (ranger) {
      return frame;
    }
  }
  return maxFrames;
}

const RETAIL_LOW_ENERGY_CONFIG = {
  minLowEnergyProductionSpeed: 0.5,
  maxLowEnergyProductionSpeed: 0.8,
  lowEnergyPenaltyModifier: 1.0,
};

// ── Test 1: Multiple Factory Build Speed ─────────────────────────────────────

describe('parity production: MultipleFactory build speed bonus', () => {
  /**
   * C++ source: ThingTemplate.cpp:1421
   *   Real factoryMult = TheGlobalData->m_MultipleFactory;
   *   if (factoryMult > 0.0f) {
   *     for(int i=0; i < count - 1; i++)
   *       buildTime *= factoryMult;
   *   }
   *
   * GlobalData.cpp:842 — m_MultipleFactory defaults to 0.0.
   * GameData.ini overrides it to 0.85 in retail.
   */

  it('with 1 factory, unit production takes the expected number of frames', () => {
    const bundle = makeProductionBundle({ factoryCount: 1, unitBuildTimeSec: 5 });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    // Place factory at map center
    const mapData = makeMap([makeMapObject('USABarracks', 50, 50)], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // BuildTime=5 seconds at 30 FPS = 150 frames.
    // Allow some tolerance for frame rounding.
    expect(frames).toBeGreaterThanOrEqual(148);
    expect(frames).toBeLessThanOrEqual(155);
  });

  it('with MultipleFactory=0 (C++ default), extra factories give NO bonus', () => {
    /**
     * C++ default: m_MultipleFactory = 0.0 (GlobalData.cpp:842).
     * The bonus guard checks factoryMult > 0.0f (ThingTemplate.cpp:1422).
     * With default 0, extra factories have zero effect on build time.
     */
    const bundle = makeProductionBundle({ factoryCount: 2, unitBuildTimeSec: 5 });
    // Default config has multipleFactory: 0
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USABarracks', 80, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    const factories = logic.getRenderableEntityStates().filter(e => e.templateName === 'USABarracks');
    expect(factories.length).toBe(2);

    const factoryId = factories[0]!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // No bonus: should still be ~150 frames, same as 1 factory.
    expect(frames).toBeGreaterThanOrEqual(148);
    expect(frames).toBeLessThanOrEqual(155);
  });

  it('with MultipleFactory=0.85 (retail INI), 2 factories speed up production', () => {
    /**
     * Retail GameData.ini: MultipleFactory = 0.85
     * With 1 extra factory: rate = 1/0.85 = ~1.176
     * BuildTime=5s = 150 frames; effective = 150 / 1.176 = ~127.5 frames.
     */
    const bundle = makeProductionBundle({ factoryCount: 2, unitBuildTimeSec: 5 });
    const logic = new GameLogicSubsystem(new THREE.Scene(), { multipleFactory: 0.85 });
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USABarracks', 80, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    const factories = logic.getRenderableEntityStates().filter(e => e.templateName === 'USABarracks');
    expect(factories.length).toBe(2);

    const factoryId = factories[0]!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // With multipleFactory=0.85 and 2 factories: ~128 frames.
    expect(frames).toBeGreaterThanOrEqual(125);
    expect(frames).toBeLessThanOrEqual(135);
  });

  it('verifies speedup ratio with MultipleFactory=0.85 matches 1/0.85', () => {
    /**
     * Measure 1-factory vs 2-factory delta with multipleFactory=0.85 to confirm
     * the speedup ratio is ~1/0.85 = ~1.176.
     */
    const bundle1 = makeProductionBundle({ factoryCount: 1, unitBuildTimeSec: 5 });
    const logic1 = new GameLogicSubsystem(new THREE.Scene(), { multipleFactory: 0.85 });
    const map1 = makeMap([makeMapObject('USABarracks', 50, 50)], 128, 128);
    logic1.loadMapObjects(map1, makeRegistry(bundle1), makeHeightmap(128, 128));
    logic1.setPlayerSide(0, 'America');
    logic1.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic1.update(1 / 30);
    const singleFactoryFrames = measureProductionFrames(
      logic1,
      logic1.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id,
    );

    const bundle2 = makeProductionBundle({ factoryCount: 2, unitBuildTimeSec: 5 });
    const logic2 = new GameLogicSubsystem(new THREE.Scene(), { multipleFactory: 0.85 });
    const map2 = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USABarracks', 80, 50),
    ], 128, 128);
    logic2.loadMapObjects(map2, makeRegistry(bundle2), makeHeightmap(128, 128));
    logic2.setPlayerSide(0, 'America');
    logic2.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic2.update(1 / 30);
    const dualFactoryFrames = measureProductionFrames(
      logic2,
      logic2.getRenderableEntityStates().filter(e => e.templateName === 'USABarracks')[0]!.id,
    );

    // Speedup ratio should be ~1/0.85 = ~1.176
    const speedupRatio = singleFactoryFrames / dualFactoryFrames;
    expect(speedupRatio).toBeGreaterThan(1.1);
    expect(speedupRatio).toBeLessThan(1.25);
  });
});

// ── Test 2: Low Energy Production Penalty ────────────────────────────────────

describe('parity production: low energy production penalty', () => {
  /**
   * C++ source: ThingTemplate.cpp:1396-1410
   *   Real EnergyPercent = player->getEnergy()->getEnergySupplyRatio();
   *   if (EnergyPercent > 1.0f) EnergyPercent = 1.0f;
   *   Real EnergyShort = 1.0f - EnergyPercent;
   *   EnergyShort *= TheGlobalData->m_LowEnergyPenaltyModifier;  // default 0.0, INI sets 0.4
   *   Real penaltyRate = 1.0f - EnergyShort;
   *   penaltyRate = max(penaltyRate, TheGlobalData->m_MinLowEnergyProductionSpeed);  // default 0.0
   *   if (EnergyPercent < 1.0f)
   *     penaltyRate = min(penaltyRate, TheGlobalData->m_MaxLowEnergyProductionSpeed);  // default 0.0
   *   if (penaltyRate <= 0.0f) penaltyRate = 0.01f;
   *   buildTime /= penaltyRate;
   *
   * TS source: index.ts:23887-23888
   *   productionRate = Math.max(0.2, 1 - energyShort * 0.4);
   *   - Hardcodes m_LowEnergyPenaltyModifier = 0.4
   *   - Hardcodes m_MinLowEnergyProductionSpeed = 0.2
   *   - Applies m_MaxLowEnergyProductionSpeed cap via config.maxLowEnergyProductionSpeed
   */

  it('with sufficient power, production runs at normal speed', () => {
    // Power plant provides 10, factory consumes 0 — full power.
    const bundle = makeProductionBundle({
      factoryCount: 1,
      unitBuildTimeSec: 5,
      powerPlantEnergyBonus: 10,
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USAPowerPlant', 80, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    // Verify power is sufficient
    const powerState = logic.getSidePowerState('America');
    expect(powerState.energyProduction).toBeGreaterThanOrEqual(powerState.energyConsumption);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // Full power: 5 seconds * 30 FPS = 150 frames.
    expect(frames).toBeGreaterThanOrEqual(148);
    expect(frames).toBeLessThanOrEqual(155);
  });

  it('with 50% power supply, production is penalized', () => {
    /**
     * Setup: Power plant produces 5, but structures consume 10.
     * energyPercent = 5/10 = 0.5
     * energyShort = 0.5
     * TS: productionRate = max(0.2, 1 - 0.5 * 0.4) = max(0.2, 0.8) = 0.8
     * So production takes 1/0.8 = 1.25x longer.
     * 150 frames * 1.25 = 187.5 frames.
     */
    const bundle = makeProductionBundle({
      factoryCount: 1,
      unitBuildTimeSec: 5,
      powerPlantEnergyBonus: 5,
      powerConsumers: [
        { name: 'PowerConsumer', energyBonus: -10 },
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene(), RETAIL_LOW_ENERGY_CONFIG);
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USAPowerPlant', 80, 50),
      makeMapObject('PowerConsumer', 110, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    // Verify power is insufficient
    const powerState = logic.getSidePowerState('America');
    expect(powerState.energyProduction).toBeLessThan(powerState.energyConsumption);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // At 50% power with retail low-energy config: rate = 0.5, time = 150/0.5 = 300 frames.
    expect(frames).toBeGreaterThan(155); // Definitely slower than normal
    expect(frames).toBeGreaterThanOrEqual(295);
    expect(frames).toBeLessThanOrEqual(305);
  });

  it('with 0% power supply, production rate clamps to the retail minimum', () => {
    /**
     * Setup: No power plant at all, but a structure consumes power.
     * energyPercent = 0/10 = 0.0
     * energyShort = 1.0
     * TS: productionRate = max(0.2, 1 - 1.0 * 0.4) = max(0.2, 0.6) = 0.6
     *
     * Note: At 0% power in TS, rate is 0.6 (not 0.2), because the penalty
     * modifier 0.4 means even total power loss only reduces rate by 40%.
     * The 0.2 minimum only activates when energyShort * modifier > 0.8,
     * which would require modifier > 0.8 — not possible with 0.4.
     *
     * C++ also clamps to MinLowEnergyProductionSpeed, and additionally
     * applies MaxLowEnergyProductionSpeed cap (now also implemented in TS).
     */
    const bundle = makeProductionBundle({
      factoryCount: 1,
      unitBuildTimeSec: 5,
      // No power plant
      powerConsumers: [
        { name: 'PowerConsumer', energyBonus: -10 },
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene(), RETAIL_LOW_ENERGY_CONFIG);
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('PowerConsumer', 80, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    // Verify zero production power
    const powerState = logic.getSidePowerState('America');
    expect(powerState.energyProduction).toBe(0);
    expect(powerState.energyConsumption).toBeGreaterThan(0);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // At 0% power with retail low-energy config: rate = 0.5, time = 150/0.5 = 300 frames.
    expect(frames).toBeGreaterThan(200);
    expect(frames).toBeGreaterThanOrEqual(295);
    expect(frames).toBeLessThanOrEqual(305);
  });

  it('with MaxLowEnergyProductionSpeed=0.5, production rate is capped at 50%', () => {
    /**
     * C++ applies MaxLowEnergyProductionSpeed to cap the production rate when
     * EnergyPercent < 1.0, ensuring even slightly low power causes a noticeable
     * slowdown.
     *
     * C++ (GameData.ini retail): MaxLowEnergyProductionSpeed = 0.5 (50%)
     * With 90% power:
     *   EnergyShort = 0.1, penalty = 0.1 * 0.4 = 0.04, rate = 0.96
     *   rate = min(0.96, 0.5) = 0.5 — capped!
     *   150 / 0.5 = 300 frames.
     */
    const bundle = makeProductionBundle({
      factoryCount: 1,
      unitBuildTimeSec: 5,
      powerPlantEnergyBonus: 9,
      powerConsumers: [
        { name: 'PowerConsumer', energyBonus: -10 },
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene(), {
      ...RETAIL_LOW_ENERGY_CONFIG,
      maxLowEnergyProductionSpeed: 0.5,
    });
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USAPowerPlant', 80, 50),
      makeMapObject('PowerConsumer', 110, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // At 90% power with MaxLowEnergyProductionSpeed=0.5: rate capped to 0.5
    // 150 / 0.5 = 300 frames.
    expect(frames).toBeGreaterThanOrEqual(295);
    expect(frames).toBeLessThanOrEqual(305);
  });

  it('with source default low-energy fields and no GameData, production uses the 1% floor', () => {
    /**
     * With all source default low-energy globals at 0, the max clamp drops
     * the rate to 0 and the source 0.01 floor keeps production alive.
     */
    const bundle = makeProductionBundle({
      factoryCount: 1,
      unitBuildTimeSec: 0.1,
      powerPlantEnergyBonus: 9,
      powerConsumers: [
        { name: 'PowerConsumer', energyBonus: -10 },
      ],
    });
    // Default config mirrors GlobalData.cpp defaults when GameData.ini is absent.
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('USABarracks', 50, 50),
      makeMapObject('USAPowerPlant', 80, 50),
      makeMapObject('PowerConsumer', 110, 50),
    ], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // 0.1 seconds = 3 build frames; 3 / 0.01 = 300 update frames.
    expect(frames).toBeGreaterThanOrEqual(295);
    expect(frames).toBeLessThanOrEqual(305);
  });
});

// ── Test 3: Sell Refund Percentage ───────────────────────────────────────────

describe('parity production: sell refund percentage', () => {
  /**
   * C++ source: GlobalData.cpp:873
   *   m_sellPercentage = 1.0f;  // Default: 100% refund
   *
   * C++ source: GlobalData.cpp:450
   *   { "SellPercentage", INI::parsePercentToReal, ... }
   *   GameData.ini overrides to ~50% in retail.
   *
   * C++ source: BuildAssistant.cpp:257-262
   *   if (obj->getTemplate()->getRefundValue() != 0)
   *     sellValue = obj->getTemplate()->getRefundValue();
   *   else
   *     sellValue = REAL_TO_UNSIGNEDINT(
   *       obj->getTemplate()->calcCostToBuild(player) * TheGlobalData->m_sellPercentage);
   *
   * TS source: index.ts:5390
   *   sellPercentage: SOURCE_DEFAULT_SELL_PERCENTAGE  // = 1.0
   */

  it('with default sellPercentage (1.0), selling refunds full build cost', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestStructure', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 1000 }),
      ],
    });

    const scene = new THREE.Scene();
    // Default config: sellPercentage = 1.0 (SOURCE_DEFAULT_SELL_PERCENTAGE)
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestStructure', 8, 8)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic.update(1 / 30);

    expect(logic.getSideCredits('America')).toBe(0);

    // Sell the structure
    logic.submitCommand({ type: 'sell', entityId: 1 });

    // Advance until sell completes (scaffold phase + deconstruction phase)
    // SOURCE_FRAMES_TO_ALLOW_SCAFFOLD = 30*1.5 = 45 frames
    // SOURCE_TOTAL_FRAMES_TO_SELL_OBJECT = 30*3 = 90 frames
    // Sell completes when constructionPercent drops to -50 from 100:
    // 150% drop at rate of 100/90 per frame = 135 frames + 45 scaffold = 180 frames
    for (let frame = 0; frame < 200; frame++) {
      logic.update(1 / 30);
    }

    // Structure should be gone and credits refunded
    expect(logic.getEntityState(1)).toBeNull();
    // 1000 * 1.0 = 1000 refund
    expect(logic.getSideCredits('America')).toBe(1000);
  });

  it('with sellPercentage=0.5, selling refunds 50% of build cost', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestStructure', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 1000 }),
      ],
    });

    const scene = new THREE.Scene();
    // Retail GameData.ini typically sets SellPercentage to 50%
    const logic = new GameLogicSubsystem(scene, { sellPercentage: 0.5 });
    logic.loadMapObjects(
      makeMap([makeMapObject('TestStructure', 8, 8)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic.update(1 / 30);

    logic.submitCommand({ type: 'sell', entityId: 1 });

    for (let frame = 0; frame < 200; frame++) {
      logic.update(1 / 30);
    }

    expect(logic.getEntityState(1)).toBeNull();
    // 1000 * 0.5 = 500 refund
    expect(logic.getSideCredits('America')).toBe(500);
  });

  it('RefundValue overrides sellPercentage when explicitly set', () => {
    /**
     * C++ source: BuildAssistant.cpp:258-259
     *   if (obj->getTemplate()->getRefundValue() != 0)
     *     sellValue = obj->getTemplate()->getRefundValue();
     *
     * When an object has an explicit RefundValue, the sell percentage
     * calculation is bypassed entirely.
     */
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestStructure', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 1000, RefundValue: 750 }),
      ],
    });

    const scene = new THREE.Scene();
    // Even with sellPercentage=0.1, RefundValue should take precedence
    const logic = new GameLogicSubsystem(scene, { sellPercentage: 0.1 });
    logic.loadMapObjects(
      makeMap([makeMapObject('TestStructure', 8, 8)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic.update(1 / 30);

    logic.submitCommand({ type: 'sell', entityId: 1 });

    for (let frame = 0; frame < 200; frame++) {
      logic.update(1 / 30);
    }

    expect(logic.getEntityState(1)).toBeNull();
    // RefundValue=750 overrides sellPercentage calculation (would be 1000*0.1=100)
    expect(logic.getSideCredits('America')).toBe(750);
  });

  it('documents C++ default vs retail: default is 100%, retail INI overrides to ~50%', () => {
    /**
     * C++ GlobalData.cpp:873 — m_sellPercentage defaults to 1.0 (100% refund).
     * GameData.ini (retail): SellPercentage = 50% (parsed by parsePercentToReal → 0.5).
     *
     * TS index.ts:1114 — SOURCE_DEFAULT_SELL_PERCENTAGE = 1.0 (matches C++ default).
     * TS index.ts:5390 — sellPercentage: SOURCE_DEFAULT_SELL_PERCENTAGE in default config.
     *
     * Without INI-driven GameData loading, the TS uses the C++ code default (1.0),
     * NOT the retail GameData.ini value (0.5). This means selling gives full refund
     * unless the app layer explicitly passes sellPercentage: 0.5 in the config.
     */
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestStructure', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], { BuildCost: 600 }),
      ],
    });

    // Test 1: Default config (C++ code default = 1.0)
    const logic1 = new GameLogicSubsystem(new THREE.Scene());
    logic1.loadMapObjects(
      makeMap([makeMapObject('TestStructure', 8, 8)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic1.setPlayerSide(0, 'America');
    logic1.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic1.update(1 / 30);
    logic1.submitCommand({ type: 'sell', entityId: 1 });
    for (let frame = 0; frame < 200; frame++) logic1.update(1 / 30);
    const defaultRefund = logic1.getSideCredits('America');

    // Test 2: Retail INI config (sellPercentage = 0.5)
    const logic2 = new GameLogicSubsystem(new THREE.Scene(), { sellPercentage: 0.5 });
    logic2.loadMapObjects(
      makeMap([makeMapObject('TestStructure', 8, 8)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic2.setPlayerSide(0, 'America');
    logic2.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    logic2.update(1 / 30);
    logic2.submitCommand({ type: 'sell', entityId: 1 });
    for (let frame = 0; frame < 200; frame++) logic2.update(1 / 30);
    const retailRefund = logic2.getSideCredits('America');

    // Default (C++ code default): 600 * 1.0 = 600
    expect(defaultRefund).toBe(600);
    // Retail INI override: 600 * 0.5 = 300
    expect(retailRefund).toBe(300);
    // Retail gives exactly half of default
    expect(retailRefund).toBe(defaultRefund / 2);
  });
});
