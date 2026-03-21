/**
 * Parity Tests: Upgrade Cost Deduction Timing & Construction Health Ramp
 *
 * Test 1: Upgrade cost is deducted when the upgrade enters the production queue,
 *   NOT when it finishes. Cancelling mid-production refunds the full cost.
 *   C++ source: ProductionUpdate.cpp — cost withdrawn via Player::getMoney()->withdraw()
 *   at queue time inside ProductionUpdate::queueUpgrade.
 *   TS source: index.ts:23564 — withdrawSideCredits called in queueUpgradeProduction.
 *
 * Test 2: Construction health ramps proportionally to construction percent.
 *   C++ source: Object.cpp — health = maxHealth * (constructionPercent / 100).
 *   TS source: index.ts:19884-19886 — health += maxHealth / totalFrames each frame.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ── Test 1: Upgrade Cost Deducted on Start, Not Completion ──────────────────

describe('parity: upgrade cost deducted on queue start, not completion', () => {
  /**
   * Build a factory with a ProductionUpdate that can queue upgrades.
   * The upgrade costs 500 credits and takes 2 seconds (60 frames at 30 FPS).
   */
  function makeUpgradeCostSetup() {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_FACTORY'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
        ], {
          CommandSet: 'BarracksCommandSet',
        }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_TestArmor', {
          Type: 'PLAYER',
          BuildTime: 2,
          BuildCost: 500,
        }),
      ],
      commandButtons: [
        makeCommandButtonDef('Cmd_UpgradeArmor', {
          Command: 'PLAYER_UPGRADE',
          Upgrade: 'Upgrade_TestArmor',
        }),
      ],
      commandSets: [
        makeCommandSetDef('BarracksCommandSet', { '1': 'Cmd_UpgradeArmor' }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('USABarracks', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 2000 });
    logic.update(1 / 30); // Process credits

    return { logic };
  }

  it('credits are deducted immediately when upgrade enters production queue', () => {
    const { logic } = makeUpgradeCostSetup();

    // Verify initial credits.
    expect(logic.getSideCredits('America')).toBe(2000);

    // Queue the upgrade (costs 500).
    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestArmor',
    });
    logic.update(1 / 30); // Process the queue command

    // Credits should be deducted immediately — on queue, NOT on completion.
    expect(logic.getSideCredits('America')).toBe(1500);

    // Upgrade should be in the production queue, not yet complete.
    const prodState = logic.getProductionState(1);
    expect(prodState).not.toBeNull();
    expect(prodState!.queueEntryCount).toBe(1);
    expect(prodState!.queue[0]!.type).toBe('UPGRADE');
    expect(prodState!.queue[0]!.percentComplete).toBeLessThan(100);
  });

  it('credits are NOT returned when upgrade completes', () => {
    const { logic } = makeUpgradeCostSetup();

    expect(logic.getSideCredits('America')).toBe(2000);

    // Queue the upgrade.
    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestArmor',
    });
    logic.update(1 / 30);

    // Credits deducted on queue.
    expect(logic.getSideCredits('America')).toBe(1500);

    // Run enough frames for the upgrade to complete (2 seconds = 60 frames + margin).
    for (let i = 0; i < 70; i++) {
      logic.update(1 / 30);
    }

    // Upgrade should be complete — queue should be empty.
    const prodState = logic.getProductionState(1);
    expect(prodState).not.toBeNull();
    expect(prodState!.queueEntryCount).toBe(0);

    // Credits should remain at 1500 — NOT refunded on completion.
    expect(logic.getSideCredits('America')).toBe(1500);
  });

  it('credits are refunded when upgrade is cancelled mid-production', () => {
    const { logic } = makeUpgradeCostSetup();

    expect(logic.getSideCredits('America')).toBe(2000);

    // Queue the upgrade.
    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestArmor',
    });
    logic.update(1 / 30);

    // Credits deducted on queue.
    expect(logic.getSideCredits('America')).toBe(1500);

    // Advance a few frames so upgrade is partially complete.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Verify upgrade is in progress (not yet complete).
    const prodState = logic.getProductionState(1);
    expect(prodState!.queueEntryCount).toBe(1);
    expect(prodState!.queue[0]!.percentComplete).toBeGreaterThan(0);
    expect(prodState!.queue[0]!.percentComplete).toBeLessThan(100);

    // Cancel the upgrade.
    logic.submitCommand({
      type: 'cancelUpgradeProduction',
      entityId: 1,
      upgradeName: 'Upgrade_TestArmor',
    });
    logic.update(1 / 30);

    // Full cost should be refunded — C++ refunds the entire build cost on cancel,
    // regardless of how far along production was.
    expect(logic.getSideCredits('America')).toBe(2000);

    // Queue should be empty.
    const afterCancel = logic.getProductionState(1);
    expect(afterCancel!.queueEntryCount).toBe(0);
  });
});

// ── Test 2: Construction Health Ramp is Proportional ────────────────────────

describe('parity: construction health ramps proportionally to percent', () => {
  /**
   * C++ source: Object.cpp — health during construction = maxHealth * (constructionPercent / 100).
   * TS source: index.ts:19884-19886 — each frame: health += maxHealth / totalFrames.
   *
   * Building starts at health=1 (source parity: DozerAIUpdate::construct, index.ts:22931).
   * Construction percent starts at 0 and increments by 100 / totalFrames per frame.
   * Health increments by maxHealth / totalFrames per frame.
   * Therefore health ~= maxHealth * (constructionPercent / 100) at any point, which is
   * proportional ramp — NOT fixed-increment jumps independent of max health.
   */

  function makeConstructionHealthSetup(buildTimeSeconds = 2, maxHealth = 1000) {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          GeometryMajorRadius: 5,
          GeometryMinorRadius: 5,
          Speed: 30,
        }),
        makeObjectDef('USABuilding', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: maxHealth, InitialHealth: maxHealth }),
        ], {
          BuildCost: 500,
          BuildTime: buildTimeSeconds,
          GeometryMajorRadius: 10,
          GeometryMinorRadius: 10,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('USADozer', 16, 16)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 5000 });
    logic.update(1 / 30);

    // Issue construct command — place building adjacent to dozer so construction starts immediately.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USABuilding',
      targetPosition: [18, 0, 18],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30); // Place building (entity id 2)

    return { logic };
  }

  it('at ~50% construction, health is approximately 50% of maxHealth', () => {
    // BuildTime = 2 seconds = 60 frames at 30 FPS.
    // At 50% = 30 frames of construction.
    const { logic } = makeConstructionHealthSetup(2, 1000);

    // Run ~30 frames of construction (first frame already ran in setup).
    // Building was placed on the first update; we need ~30 more frames to reach ~50%.
    for (let i = 0; i < 29; i++) {
      logic.update(1 / 30);
    }

    const building = logic.getEntityState(2);
    expect(building).not.toBeNull();
    expect(building!.statusFlags).toContain('UNDER_CONSTRUCTION');

    // Construction percent should be approximately 50%.
    expect(building!.constructionPercent).toBeGreaterThan(40);
    expect(building!.constructionPercent).toBeLessThan(60);

    // Health should be approximately 500 (50% of 1000).
    // Allow tolerance for off-by-one frame and the initial health=1 start.
    expect(building!.health).toBeGreaterThan(400);
    expect(building!.health).toBeLessThan(600);

    // Verify proportionality: health / maxHealth ~= constructionPercent / 100.
    const healthRatio = building!.health / building!.maxHealth;
    const percentRatio = building!.constructionPercent / 100;
    expect(healthRatio).toBeCloseTo(percentRatio, 1);
  });

  it('at 100% construction, health equals maxHealth', () => {
    const { logic } = makeConstructionHealthSetup(1, 1000);

    // BuildTime = 1 second = 30 frames. Run enough frames to complete.
    for (let i = 0; i < 31; i++) {
      logic.update(1 / 30);
    }

    const building = logic.getEntityState(2);
    expect(building).not.toBeNull();
    expect(building!.statusFlags).not.toContain('UNDER_CONSTRUCTION');
    expect(building!.constructionPercent).toBe(-1); // CONSTRUCTION_COMPLETE sentinel
    expect(building!.health).toBe(1000);
    expect(building!.health).toBe(building!.maxHealth);
  });

  it('health ramps proportionally, not in fixed increments', () => {
    // Use a building with maxHealth=1000 and BuildTime=2s (60 frames).
    // Sample health at multiple points and verify proportionality.
    const { logic } = makeConstructionHealthSetup(2, 1000);

    const samples: Array<{ percent: number; health: number }> = [];

    // Run construction frame-by-frame, sampling every 10 frames.
    for (let frame = 1; frame <= 59; frame++) {
      logic.update(1 / 30);

      if (frame % 10 === 0) {
        const building = logic.getEntityState(2);
        if (building && building.constructionPercent > 0 && building.constructionPercent < 100) {
          samples.push({
            percent: building.constructionPercent,
            health: building.health,
          });
        }
      }
    }

    // We should have at least 4 samples (at frames 10, 20, 30, 40, 50).
    expect(samples.length).toBeGreaterThanOrEqual(4);

    // Verify proportionality: for each sample, health / maxHealth ~= constructionPercent / 100.
    for (const sample of samples) {
      const healthRatio = sample.health / 1000;
      const percentRatio = sample.percent / 100;
      // Allow 5% tolerance due to initial health=1 offset.
      expect(Math.abs(healthRatio - percentRatio)).toBeLessThan(0.05);
    }

    // Verify that health increases are consistent (not in large fixed jumps).
    // Each frame adds maxHealth / totalFrames = 1000 / 60 ~= 16.67 health.
    // Between 10-frame samples, health should increase by ~166.7.
    for (let i = 1; i < samples.length; i++) {
      const delta = samples[i]!.health - samples[i - 1]!.health;
      const expectedDelta = (1000 / 60) * 10; // ~166.67
      // Allow 20% tolerance.
      expect(delta).toBeGreaterThan(expectedDelta * 0.8);
      expect(delta).toBeLessThan(expectedDelta * 1.2);
    }
  });

  it('health ramp scales with maxHealth (proportional, not fixed)', () => {
    // Test with two different maxHealth values to confirm proportionality.
    // Building A: maxHealth=500, BuildTime=2s
    // Building B: maxHealth=2000, BuildTime=2s
    // At the same construction percent, health should be different but
    // the ratio (health / maxHealth) should be the same.

    const setupA = makeConstructionHealthSetup(2, 500);
    const setupB = makeConstructionHealthSetup(2, 2000);

    // Advance both by 30 frames (~50%).
    for (let i = 0; i < 29; i++) {
      setupA.logic.update(1 / 30);
      setupB.logic.update(1 / 30);
    }

    const buildingA = setupA.logic.getEntityState(2);
    const buildingB = setupB.logic.getEntityState(2);

    expect(buildingA).not.toBeNull();
    expect(buildingB).not.toBeNull();

    // Both should be at approximately the same construction percent.
    expect(buildingA!.constructionPercent).toBeCloseTo(buildingB!.constructionPercent, 0);

    // Health values should be different (500 vs 2000 max).
    expect(buildingA!.health).toBeLessThan(buildingB!.health);

    // But health ratios should be approximately equal — proving proportional ramp.
    const ratioA = buildingA!.health / buildingA!.maxHealth;
    const ratioB = buildingB!.health / buildingB!.maxHealth;
    expect(ratioA).toBeCloseTo(ratioB, 1);
  });
});
