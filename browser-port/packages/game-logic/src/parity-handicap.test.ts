/**
 * Handicap Build Time Parity Tests — verify that the Handicap::BUILDTIME multiplier
 * scales production build times correctly, matching C++ source behavior.
 *
 * C++ ref: ThingTemplate.cpp:1382
 *   buildTime *= player->getHandicap()->getHandicap(Handicap::BUILDTIME, this);
 *
 * Tests verify:
 * - Handicap 0.5 (50% build time) makes units build twice as fast
 * - Handicap 2.0 (200% build time) makes units build half as fast
 * - Default handicap (1.0) does not alter build time
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

function makeHandicapBundle(unitBuildTimeSec: number) {
  const objects = [
    makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_FACTORY'], [
      makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
      makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
      makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
        UnitCreatePoint: [20, 0, 0],
        NaturalRallyPoint: [40, 0, 0],
      }),
    ], {
      CommandSet: 'USABarracksCommandSet',
      EnergyBonus: 0,
    }),
    makeObjectDef('USARanger', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], { BuildCost: 225, BuildTime: unitBuildTimeSec }),
  ];

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

function setupLogic(handicap?: number) {
  const bundle = makeHandicapBundle(5); // 5 seconds = 150 frames at 30 FPS
  const logic = new GameLogicSubsystem(new THREE.Scene());
  const mapData = makeMap([makeMapObject('USABarracks', 50, 50)], 128, 128);
  logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
  logic.setPlayerSide(0, 'America');
  logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
  if (handicap !== undefined) {
    logic.setHandicap('America', handicap);
  }
  logic.update(1 / 30);

  const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
  return { logic, factoryId };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parity handicap: Handicap::BUILDTIME build time scaling', () => {
  /**
   * C++ source: ThingTemplate.cpp:1382
   *   buildTime *= player->getHandicap()->getHandicap(Handicap::BUILDTIME, this);
   *
   * The handicap multiplier is applied to build time frames before the faction
   * production time modifier. A multiplier of 0.5 halves the build time (units
   * build twice as fast). A multiplier of 2.0 doubles the build time (units
   * build half as fast).
   */

  it('default handicap (1.0) does not alter build time', () => {
    const { logic, factoryId } = setupLogic(); // no handicap set
    const frames = measureProductionFrames(logic, factoryId);

    // BuildTime=5 seconds at 30 FPS = 150 frames.
    expect(frames).toBeGreaterThanOrEqual(148);
    expect(frames).toBeLessThanOrEqual(155);
  });

  it('with handicap 0.5, units build twice as fast (half the frames)', () => {
    /**
     * Handicap 0.5 → buildTime *= 0.5 → 150 * 0.5 = 75 frames.
     */
    const { logic, factoryId } = setupLogic(0.5);
    const frames = measureProductionFrames(logic, factoryId);

    // Expect ~75 frames (half of 150).
    expect(frames).toBeGreaterThanOrEqual(73);
    expect(frames).toBeLessThanOrEqual(80);
  });

  it('with handicap 2.0, units build half as fast (double the frames)', () => {
    /**
     * Handicap 2.0 → buildTime *= 2.0 → 150 * 2.0 = 300 frames.
     */
    const { logic, factoryId } = setupLogic(2.0);
    const frames = measureProductionFrames(logic, factoryId);

    // Expect ~300 frames (double of 150).
    expect(frames).toBeGreaterThanOrEqual(298);
    expect(frames).toBeLessThanOrEqual(305);
  });

  it('handicap only affects the side it is set on', () => {
    /**
     * Setting a handicap for 'America' should not affect a hypothetical other
     * side. Verify by checking that the base build time is unaltered when no
     * handicap is set for the producing side.
     */
    const bundle = makeHandicapBundle(5);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([makeMapObject('USABarracks', 50, 50)], 128, 128);
    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    // Set handicap for a DIFFERENT side — should not affect America.
    logic.setHandicap('GLA', 0.5);
    logic.update(1 / 30);

    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    const frames = measureProductionFrames(logic, factoryId);

    // America has no handicap set, so ~150 frames as normal.
    expect(frames).toBeGreaterThanOrEqual(148);
    expect(frames).toBeLessThanOrEqual(155);
  });
});
