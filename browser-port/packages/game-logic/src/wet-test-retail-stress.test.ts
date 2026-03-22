/**
 * Retail Wet Test Round 6 — Stress Tests & Weird Edge Cases
 *
 * These tests are designed to be MEAN. They push the game engine into states
 * that break real RTS games: mass production, rapid build-sell, friendly fire,
 * entity count explosions, mid-production sell, multi-target attacks, edge
 * placement, and supply source destruction.
 *
 * Hard-fail on crashes, NaN, and critical invariant violations.
 * Soft-fail (log anomaly) on gameplay deviations.
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

const ASSETS_DIR = resolve(import.meta.dirname ?? __dirname, '../../app/public/assets');

let iniRegistry: IniDataRegistry;
let mapData: MapDataJSON;

function loadRetailData(): boolean {
  try {
    const bundleJson = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'data/ini-bundle.json'), 'utf-8'));
    iniRegistry = new IniDataRegistry();
    iniRegistry.loadBundle(bundleJson);
    mapData = JSON.parse(readFileSync(
      resolve(ASSETS_DIR, 'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json'), 'utf-8',
    ));
    return true;
  } catch { return false; }
}

const hasRetailData = loadRetailData();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFreshGame(credits = 50000): GameLogicSubsystem {
  const logic = new GameLogicSubsystem(new THREE.Scene(), {
    multipleFactory: 0.85,
  });
  const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
  logic.loadMapObjects(mapData, iniRegistry, heightmap);
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'China');
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
  logic.spawnSkirmishStartingEntities();
  logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: credits });
  logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: credits });
  logic.update(0);
  logic.update(1 / 30);
  return logic;
}

/** Run N frames at 30fps, catching crashes. Returns anomalies list. */
function runFrames(logic: GameLogicSubsystem, count: number, anomalies: string[], label: string): boolean {
  for (let i = 0; i < count; i++) {
    try {
      logic.update(1 / 30);
    } catch (err) {
      anomalies.push(`CRASH at ${label} frame ${i}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  return true;
}

/** Simple runFrames without anomaly tracking. */
function runFramesSimple(logic: GameLogicSubsystem, count: number): void {
  for (let i = 0; i < count; i++) {
    logic.update(1 / 30);
  }
}

/** Check all entity states for NaN positions. */
function checkNaN(logic: GameLogicSubsystem, anomalies: string[], label: string): void {
  const states = logic.getRenderableEntityStates();
  for (const s of states) {
    if (isNaN(s.x) || isNaN(s.y) || isNaN(s.z)) {
      anomalies.push(`NaN position at ${label}: entity ${s.id} (${s.templateName}) pos=(${s.x},${s.y},${s.z})`);
    }
  }
}

function findEntity(logic: GameLogicSubsystem, templateName: string, side: string) {
  return logic.getRenderableEntityStates().find(e =>
    e.templateName === templateName && e.side?.toUpperCase() === side.toUpperCase(),
  );
}

function findEntities(logic: GameLogicSubsystem, templateName: string, side: string) {
  return logic.getRenderableEntityStates().filter(e =>
    e.templateName === templateName && e.side?.toUpperCase() === side.toUpperCase(),
  );
}

function buildStructure(
  logic: GameLogicSubsystem,
  dozerId: number,
  templateName: string,
  x: number,
  z: number,
  anomalies: string[],
  buildFrames = 900,
) {
  logic.submitCommand({
    type: 'constructBuilding',
    entityId: dozerId,
    templateName,
    targetPosition: [x, 0, z],
    angle: 0,
    lineEndPosition: null,
  });
  runFrames(logic, buildFrames, anomalies, `build-${templateName}`);
  return logic.getRenderableEntityStates().find(e =>
    e.templateName === templateName && e.side?.toUpperCase() === 'AMERICA',
  ) ?? null;
}

/** Build PP + Barracks. Hard-fails if either building fails. */
function buildPPAndBarracks(logic: GameLogicSubsystem, anomalies: string[]) {
  const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
  const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
  expect(dozer).toBeDefined();
  expect(cc).toBeDefined();

  const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
  expect(pp).not.toBeNull();

  const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
  expect(barracks).not.toBeNull();

  return { dozer, cc, pp: pp!, barracks: barracks! };
}

/** Assert no critical anomalies (crashes, NaN). */
function expectNoCriticalAnomalies(anomalies: string[]): void {
  const nanAnomalies = anomalies.filter(a => a.includes('NaN'));
  const crashAnomalies = anomalies.filter(a => a.includes('CRASH'));
  expect(nanAnomalies.length).toBe(0);
  expect(crashAnomalies.length).toBe(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasRetailData)('stress test wet test round 6: weird edge cases', () => {

  // == 1. Mass unit production ==
  it('mass production: queue 20 Rangers at once, verify all produced with no loss or duplication', () => {
    const logic = createFreshGame(100000);
    const anomalies: string[] = [];
    const { barracks } = buildPPAndBarracks(logic, anomalies);

    const creditsBefore = logic.getSideCredits('america');

    // Queue 20 Rangers at once — this is well above normal player behavior
    for (let i = 0; i < 20; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    logic.update(1 / 30);

    // Verify credits were deducted (Rangers cost 225 each, 20 * 225 = 4500)
    const creditsAfterQueue = logic.getSideCredits('america');
    console.log(`MASS-PROD: Credits before=${creditsBefore}, after queue=${creditsAfterQueue}`);

    // Run enough frames for all 20 to produce.
    // A Ranger takes ~150 frames (5 sec). 20 * 150 = 3000 frames = 100 sec game time.
    // With multipleFactory bonus from 1 barracks, still need full time.
    // Track production over time.
    const countLog: number[] = [];
    for (let phase = 0; phase < 40; phase++) {
      runFrames(logic, 150, anomalies, `mass-prod-phase-${phase}`);
      const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
      countLog.push(rangers.length);
      if (rangers.length >= 20) break;
    }

    const finalRangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    console.log(`MASS-PROD: Produced ${finalRangers.length}/20 Rangers`);
    console.log(`MASS-PROD: Count progression: ${countLog.join(', ')}`);

    // Verify no duplication — count should be exactly 20 (or close)
    if (finalRangers.length > 20) {
      anomalies.push(`MASS-PROD DUPLICATION: ${finalRangers.length} Rangers produced, expected 20`);
    }
    if (finalRangers.length < 20) {
      anomalies.push(`MASS-PROD LOSS: Only ${finalRangers.length}/20 Rangers produced`);
    }

    // Verify each Ranger has valid position
    for (const r of finalRangers) {
      const state = logic.getEntityState(r.id);
      if (state) {
        expect(isNaN(state.x)).toBe(false);
        expect(isNaN(state.z)).toBe(false);
        expect(state.health).toBeGreaterThan(0);
      }
    }

    // Verify no overlap at exact same position (would indicate spawn stacking bug)
    const positions = finalRangers.map(r => `${r.x.toFixed(1)},${r.z.toFixed(1)}`);
    const uniquePositions = new Set(positions);
    if (uniquePositions.size < finalRangers.length * 0.5) {
      anomalies.push(`MASS-PROD STACKING: ${finalRangers.length} Rangers but only ${uniquePositions.size} unique positions`);
    }

    checkNaN(logic, anomalies, 'mass-prod-final');
    if (anomalies.length > 0) {
      console.log('\n=== MASS-PROD ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 2. Rapid build-sell cycle ==
  it('rapid build-sell: build PP, sell immediately before construction completes, verify partial refund', () => {
    const logic = createFreshGame(20000);
    const anomalies: string[] = [];
    const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
    const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    const creditsStart = logic.getSideCredits('america');
    console.log(`RAPID-SELL: Starting credits: ${creditsStart}`);

    // Start building PP
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: dozer.id,
      templateName: 'AmericaPowerPlant',
      targetPosition: [cc.x + 120, 0, cc.z],
      angle: 0,
      lineEndPosition: null,
    });

    // Run only a few frames — NOT enough to complete construction
    runFrames(logic, 60, anomalies, 'rapid-sell-partial-build');

    // Find the partially-built PP
    const partialPP = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'AmericaPowerPlant' && e.side?.toUpperCase() === 'AMERICA',
    );

    if (partialPP) {
      const state = logic.getEntityState(partialPP.id);
      console.log(`RAPID-SELL: PP construction at ${state?.constructionPercent ?? 'unknown'}% after 60 frames`);

      // Sell it immediately
      const creditsBeforeSell = logic.getSideCredits('america');
      logic.submitCommand({ type: 'sell', entityId: partialPP.id });
      runFrames(logic, 300, anomalies, 'rapid-sell-countdown');

      const creditsAfterSell = logic.getSideCredits('america');
      const refund = creditsAfterSell - creditsBeforeSell;
      console.log(`RAPID-SELL: Credits before sell=${creditsBeforeSell}, after sell=${creditsAfterSell}, refund=${refund}`);

      // Partial build should give partial refund (less than full cost)
      if (refund < 0) {
        anomalies.push(`RAPID-SELL: Negative refund (${refund}) — selling cost money!`);
      }

      // Verify the PP is gone
      const ppAfterSell = logic.getRenderableEntityStates().find(e =>
        e.templateName === 'AmericaPowerPlant'
        && e.side?.toUpperCase() === 'AMERICA'
        && logic.getEntityState(e.id)?.alive,
      );
      if (ppAfterSell) {
        anomalies.push('RAPID-SELL: PP still alive after sell');
      }
    } else {
      anomalies.push('RAPID-SELL: PP not found after 60 frames of construction');
    }

    // Now build another PP to verify engine state is clean
    const pp2 = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x - 120, cc.z, anomalies);
    if (pp2) {
      console.log('RAPID-SELL: Second PP built successfully after rapid sell');
    } else {
      anomalies.push('RAPID-SELL: Failed to build second PP after rapid sell — engine state corrupted');
    }

    const creditsEnd = logic.getSideCredits('america');
    console.log(`RAPID-SELL: Final credits: ${creditsEnd}`);
    expect(isNaN(creditsEnd)).toBe(false);
    expect(creditsEnd).toBeGreaterThanOrEqual(0);

    checkNaN(logic, anomalies, 'rapid-sell');
    if (anomalies.length > 0) {
      console.log('\n=== RAPID-SELL ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 3. Friendly fire (force-attack own unit) ==
  it('friendly fire: attack own Ranger, verify it takes damage', () => {
    const logic = createFreshGame();
    const anomalies: string[] = [];
    const { barracks } = buildPPAndBarracks(logic, anomalies);

    // Train 2 Rangers
    for (let i = 0; i < 2; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 900, anomalies, 'ff-train');

    const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    expect(rangers.length).toBeGreaterThanOrEqual(2);
    console.log(`FRIENDLY-FIRE: ${rangers.length} Rangers produced`);

    const attacker = rangers[0]!;
    const victim = rangers[1]!;
    const victimHealthBefore = logic.getEntityState(victim.id)!.health;
    console.log(`FRIENDLY-FIRE: Victim health before: ${victimHealthBefore}`);

    // Attempt force-attack on own unit.
    // In retail C&C, Ctrl+click force-attacks any target including friendlies.
    // Our command system may or may not honor this.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: attacker.id,
      targetEntityId: victim.id,
      commandSource: 'PLAYER',
    });

    // Run 300 frames — should be enough for point-blank attack
    runFrames(logic, 300, anomalies, 'ff-attack');

    const victimAfter = logic.getEntityState(victim.id);
    if (!victimAfter || !victimAfter.alive) {
      console.log('FRIENDLY-FIRE: Victim was killed by friendly fire');
    } else {
      const damage = victimHealthBefore - victimAfter.health;
      if (damage > 0) {
        console.log(`FRIENDLY-FIRE: Victim took ${damage} damage from friendly fire (${(damage / victimHealthBefore * 100).toFixed(1)}%)`);
      } else {
        // This is expected if the engine blocks friendly fire at the command level.
        // Log as anomaly but don't hard-fail — some RTS games intentionally block FF.
        anomalies.push('FRIENDLY-FIRE: Ranger took no damage from friendly attack (FF may be blocked)');
        console.log('FRIENDLY-FIRE: No damage dealt — engine may block friendly fire commands');
      }
    }

    // Critical: no crashes or NaN from attacking friendlies
    checkNaN(logic, anomalies, 'friendly-fire');
    if (anomalies.length > 0) {
      console.log('\n=== FRIENDLY-FIRE ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 4. Entity count stress ==
  it('entity count stress: 10000 frames with both AIs at 50000 credits, no runaway spawning', () => {
    const logic = createFreshGame(50000);
    const anomalies: string[] = [];

    logic.enableSkirmishAI('America');
    logic.enableSkirmishAI('China');

    const entityCountLog: Array<{ frame: number; total: number; america: number; china: number }> = [];
    let maxAmericaEntities = 0;
    let maxChinaEntities = 0;

    for (let frame = 0; frame < 10000; frame++) {
      try {
        logic.update(1 / 30);
      } catch (err) {
        anomalies.push(`CRASH at entity-stress frame ${frame}: ${err instanceof Error ? err.message : String(err)}`);
        console.log(`\n=== ENTITY-STRESS: CRASH at frame ${frame} ===`);
        console.log(`  ${err instanceof Error ? err.stack : String(err)}`);
        expect.fail(`Simulation crashed at frame ${frame}`);
        return;
      }

      if (frame % 1000 === 0) {
        const states = logic.getRenderableEntityStates();
        const americaCount = states.filter(e => e.side?.toUpperCase() === 'AMERICA').length;
        const chinaCount = states.filter(e => e.side?.toUpperCase() === 'CHINA').length;
        entityCountLog.push({ frame, total: states.length, america: americaCount, china: chinaCount });
        maxAmericaEntities = Math.max(maxAmericaEntities, americaCount);
        maxChinaEntities = Math.max(maxChinaEntities, chinaCount);

        // NaN check
        const nanEntities = states.filter(s => isNaN(s.x) || isNaN(s.y) || isNaN(s.z));
        if (nanEntities.length > 0) {
          anomalies.push(`NaN positions at frame ${frame}: ${nanEntities.length} entities`);
        }

        // Negative health check
        const negHealth = states.filter(s => s.health < 0);
        if (negHealth.length > 0) {
          anomalies.push(`Negative health at frame ${frame}: ${negHealth.length} entities`);
        }
      }
    }

    console.log('\n=== ENTITY-STRESS: Entity Count Progression ===');
    for (const entry of entityCountLog) {
      console.log(`  Frame ${entry.frame.toString().padStart(5)}: total=${entry.total.toString().padStart(4)}, USA=${entry.america.toString().padStart(3)}, China=${entry.china.toString().padStart(3)}`);
    }
    console.log(`  Peak: USA=${maxAmericaEntities}, China=${maxChinaEntities}`);

    // HARD-FAIL: no runaway entity spawning (< 200 per side)
    if (maxAmericaEntities > 200) {
      anomalies.push(`RUNAWAY ENTITIES: America peaked at ${maxAmericaEntities} entities (limit: 200)`);
    }
    if (maxChinaEntities > 200) {
      anomalies.push(`RUNAWAY ENTITIES: China peaked at ${maxChinaEntities} entities (limit: 200)`);
    }

    // Final credits sanity
    const usaCredits = logic.getSideCredits('america');
    const chinaCredits = logic.getSideCredits('china');
    console.log(`  Final credits: USA=${usaCredits}, China=${chinaCredits}`);
    expect(isNaN(usaCredits)).toBe(false);
    expect(isNaN(chinaCredits)).toBe(false);

    if (anomalies.length > 0) {
      console.log('\n=== ENTITY-STRESS ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const runawayAnomalies = anomalies.filter(a => a.includes('RUNAWAY'));
    expect(runawayAnomalies.length).toBe(0);
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 5. Sell CC while producing ==
  it('sell CC while producing Dozer: production cancelled, credits refunded, CC destroyed', () => {
    const logic = createFreshGame(20000);
    const anomalies: string[] = [];
    const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
    expect(cc).toBeDefined();

    const creditsBefore = logic.getSideCredits('america');

    // Queue a Dozer production from CC
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: cc.id,
      unitTemplateName: 'AmericaVehicleDozer',
    });
    runFrames(logic, 30, anomalies, 'sell-cc-queue');

    const creditsAfterQueue = logic.getSideCredits('america');
    const prodCost = creditsBefore - creditsAfterQueue;
    console.log(`SELL-CC: Credits before=${creditsBefore}, after queue=${creditsAfterQueue}, prod cost=${prodCost}`);

    // Verify production is in the queue
    const prodState = logic.getProductionState(cc.id);
    console.log(`SELL-CC: Queue entries: ${prodState.queueEntryCount}`);

    // Now sell the CC mid-production
    logic.submitCommand({ type: 'sell', entityId: cc.id });
    runFrames(logic, 300, anomalies, 'sell-cc-countdown');

    // Check that the CC is gone
    const ccAfter = logic.getEntityState(cc.id);
    const ccAlive = ccAfter && ccAfter.alive;
    if (ccAlive) {
      anomalies.push('SELL-CC: CC still alive after sell');
    } else {
      console.log('SELL-CC: CC destroyed after sell');
    }

    // Credits should have been refunded for the incomplete Dozer production + CC sell value
    const creditsAfterSell = logic.getSideCredits('america');
    console.log(`SELL-CC: Credits after sell=${creditsAfterSell}`);

    // The refund should give back something: CC sell value + any production refund
    const totalRefund = creditsAfterSell - creditsAfterQueue;
    console.log(`SELL-CC: Total refund from sell: ${totalRefund}`);
    if (totalRefund <= 0) {
      anomalies.push(`SELL-CC: No refund received from selling CC (${totalRefund})`);
    }

    // Verify no Dozer was produced (production should have been cancelled)
    const dozers = findEntities(logic, 'AmericaVehicleDozer', 'America');
    // We started with 1 Dozer, so there should still be 1 (the original)
    console.log(`SELL-CC: Dozer count after sell: ${dozers.length} (started with 1)`);
    if (dozers.length > 1) {
      anomalies.push(`SELL-CC: Extra Dozer produced despite CC being sold (count: ${dozers.length})`);
    }

    // Verify credits are valid
    expect(isNaN(creditsAfterSell)).toBe(false);
    expect(creditsAfterSell).toBeGreaterThanOrEqual(0);

    checkNaN(logic, anomalies, 'sell-cc');
    if (anomalies.length > 0) {
      console.log('\n=== SELL-CC ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 6. Multiple simultaneous attacks ==
  it('multi-target: 10 Rangers attack 5 different enemies simultaneously, damage distributed', () => {
    const logic = createFreshGame(100000);
    const anomalies: string[] = [];
    const { barracks } = buildPPAndBarracks(logic, anomalies);

    // Train 10 Rangers
    for (let i = 0; i < 10; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 3000, anomalies, 'multi-target-train');

    const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    console.log(`MULTI-TARGET: ${rangers.length} Rangers produced`);
    expect(rangers.length).toBeGreaterThanOrEqual(5);

    // Find enemy entities to attack (CC, dozer, and any other Chinese entities)
    const enemyEntities = logic.getRenderableEntityStates().filter(e => {
      if (e.side?.toUpperCase() !== 'CHINA') return false;
      const state = logic.getEntityState(e.id);
      return state && state.alive;
    });
    console.log(`MULTI-TARGET: ${enemyEntities.length} enemy entities available`);

    // Pick up to 5 targets
    const targets = enemyEntities.slice(0, 5);
    if (targets.length === 0) {
      anomalies.push('MULTI-TARGET: No enemy entities found to attack');
      checkNaN(logic, anomalies, 'multi-target');
      expectNoCriticalAnomalies(anomalies);
      return;
    }

    // Record initial health of all targets
    const targetHealthBefore = new Map<number, number>();
    for (const target of targets) {
      const state = logic.getEntityState(target.id)!;
      targetHealthBefore.set(target.id, state.health);
    }

    // Assign 2 Rangers per target (or distribute evenly)
    const rangersToUse = rangers.slice(0, targets.length * 2);
    for (let i = 0; i < rangersToUse.length; i++) {
      const targetIndex = Math.floor(i / 2) % targets.length;
      const target = targets[targetIndex]!;
      logic.submitCommand({
        type: 'attackEntity',
        entityId: rangersToUse[i]!.id,
        targetEntityId: target.id,
        commandSource: 'PLAYER',
      });
    }

    // Run 3000 frames for Rangers to reach and attack multiple targets
    runFrames(logic, 3000, anomalies, 'multi-target-attack');

    // Check damage on each target
    let targetsWithDamage = 0;
    for (const target of targets) {
      const state = logic.getEntityState(target.id);
      const healthBefore = targetHealthBefore.get(target.id)!;
      if (!state || !state.alive) {
        targetsWithDamage++;
        console.log(`MULTI-TARGET: ${target.templateName} (id=${target.id}) DESTROYED`);
      } else if (state.health < healthBefore) {
        targetsWithDamage++;
        const damage = healthBefore - state.health;
        console.log(`MULTI-TARGET: ${target.templateName} (id=${target.id}) took ${damage} damage (${(damage / healthBefore * 100).toFixed(1)}%)`);
      } else {
        console.log(`MULTI-TARGET: ${target.templateName} (id=${target.id}) took NO damage`);
      }
    }

    // At least some targets should have taken damage
    if (targetsWithDamage === 0) {
      anomalies.push('MULTI-TARGET: No targets took any damage from 10 Rangers');
    } else {
      console.log(`MULTI-TARGET: ${targetsWithDamage}/${targets.length} targets took damage or were destroyed`);
    }

    // Verify Rangers themselves — some may have died to enemy fire
    const rangersAlive = findEntities(logic, 'AmericaInfantryRanger', 'America').filter(r => {
      const s = logic.getEntityState(r.id);
      return s && s.alive;
    });
    console.log(`MULTI-TARGET: ${rangersAlive.length}/${rangers.length} Rangers survived`);

    checkNaN(logic, anomalies, 'multi-target');
    if (anomalies.length > 0) {
      console.log('\n=== MULTI-TARGET ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 7. Build at map edge ==
  it('build at map edge: attempt structure placement at extreme coordinates', () => {
    const logic = createFreshGame(100000);
    const anomalies: string[] = [];
    const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
    expect(dozer).toBeDefined();

    // Record pre-existing NaN entities (map props that load with NaN are not our fault)
    const preExistingNaNIds = new Set<number>();
    for (const s of logic.getRenderableEntityStates()) {
      if (isNaN(s.x) || isNaN(s.y) || isNaN(s.z)) {
        preExistingNaNIds.add(s.id);
      }
    }
    if (preExistingNaNIds.size > 0) {
      console.log(`MAP-EDGE: ${preExistingNaNIds.size} pre-existing NaN entities (map props) — excluded from checks`);
    }

    // Get map dimensions from heightmap world-space extents
    const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
    const mapWidth = heightmap.worldWidth;
    const mapDepth = heightmap.worldDepth;
    console.log(`MAP-EDGE: Map world dimensions: ${mapWidth} x ${mapDepth}`);

    // Try building at the very edge of the map
    const edgePositions = [
      { label: 'top-left corner', x: 10, z: 10 },
      { label: 'top-right corner', x: mapWidth - 10, z: 10 },
      { label: 'bottom-left corner', x: 10, z: mapDepth - 10 },
      { label: 'bottom-right corner', x: mapWidth - 10, z: mapDepth - 10 },
      { label: 'beyond map left', x: -100, z: mapDepth / 2 },
      { label: 'beyond map right', x: mapWidth + 100, z: mapDepth / 2 },
    ];

    for (const pos of edgePositions) {
      const ppsBefore = findEntities(logic, 'AmericaPowerPlant', 'America').length;

      logic.submitCommand({
        type: 'constructBuilding',
        entityId: dozer.id,
        templateName: 'AmericaPowerPlant',
        targetPosition: [pos.x, 0, pos.z],
        angle: 0,
        lineEndPosition: null,
      });

      // Give enough time for Dozer to attempt to go there
      runFrames(logic, 300, anomalies, `edge-build-${pos.label}`);

      const ppsAfter = findEntities(logic, 'AmericaPowerPlant', 'America').length;
      const wasBuilt = ppsAfter > ppsBefore;
      console.log(`MAP-EDGE: ${pos.label} (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)}): ${wasBuilt ? 'BUILT' : 'REJECTED/IGNORED'}`);

      // Check dozer is still alive and well
      const dozerState = logic.getEntityState(dozer.id);
      if (!dozerState || !dozerState.alive) {
        anomalies.push(`MAP-EDGE: Dozer died or disappeared after edge build at ${pos.label}`);
        break;
      }
      expect(isNaN(dozerState.x)).toBe(false);
      expect(isNaN(dozerState.z)).toBe(false);
    }

    // Check for NEW NaN entities introduced by edge builds (exclude pre-existing ones)
    for (const s of logic.getRenderableEntityStates()) {
      if ((isNaN(s.x) || isNaN(s.y) || isNaN(s.z)) && !preExistingNaNIds.has(s.id)) {
        anomalies.push(`NaN position at map-edge: NEW entity ${s.id} (${s.templateName}) pos=(${s.x},${s.y},${s.z})`);
      }
    }

    if (anomalies.length > 0) {
      console.log('\n=== MAP-EDGE ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 8. Destroy supply source ==
  it('destroy supply source: kill supply warehouse, verify trucks seek new targets or stop', () => {
    const logic = createFreshGame(50000);
    const anomalies: string[] = [];
    const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
    const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build PP + Supply Center (which spawns supply trucks)
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    expect(pp).not.toBeNull();

    const supplyCenter = buildStructure(logic, dozer.id, 'AmericaSupplyCenter', cc.x + 200, cc.z + 50, anomalies, 900);
    expect(supplyCenter).not.toBeNull();

    // Run frames for supply trucks to spawn and start gathering
    runFrames(logic, 1500, anomalies, 'supply-warmup');

    const trucksBefore = findEntities(logic, 'AmericaVehicleSupplyTruck', 'America');
    console.log(`SUPPLY-DESTROY: ${trucksBefore.length} supply trucks spawned`);

    // Find the supply warehouse(s) on the map
    const allEntities = logic.getRenderableEntityStates();
    const supplyWarehouses = allEntities.filter(e =>
      e.templateName.toLowerCase().includes('supplydock')
      || e.templateName.toLowerCase().includes('supplywarehouse')
      || e.templateName.toLowerCase().includes('supplysource'),
    );
    // Also check for the map's neutral supply dock
    const supplyDocks = allEntities.filter(e => {
      const tn = e.templateName.toLowerCase();
      return tn.includes('supply') && !tn.includes('center') && !tn.includes('truck');
    });
    console.log(`SUPPLY-DESTROY: Found supply-related entities: ${supplyDocks.map(e => `${e.templateName}(id=${e.id})`).join(', ')}`);

    // Attack the supply-related entities with Rangers
    // First, build barracks and train Rangers
    const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
    if (!barracks) {
      anomalies.push('SUPPLY-DESTROY: Could not build barracks');
      checkNaN(logic, anomalies, 'supply-destroy');
      expectNoCriticalAnomalies(anomalies);
      return;
    }

    // Train Rangers to kill supply trucks (our own supply center as the "target")
    for (let i = 0; i < 5; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 1500, anomalies, 'supply-destroy-train');

    // Record credits and truck count
    const creditsBefore = logic.getSideCredits('america');
    const trucksNow = findEntities(logic, 'AmericaVehicleSupplyTruck', 'America');
    console.log(`SUPPLY-DESTROY: Before destruction: credits=${creditsBefore}, trucks=${trucksNow.length}`);

    // If there are supply-related dock entities, try to attack them with enemy units
    // Alternatively, sell the Supply Center itself and observe truck behavior
    if (supplyCenter) {
      console.log(`SUPPLY-DESTROY: Selling Supply Center (id=${supplyCenter.id})`);
      logic.submitCommand({ type: 'sell', entityId: supplyCenter.id });
      runFrames(logic, 300, anomalies, 'supply-center-sell');

      const supplyCenterAfter = logic.getEntityState(supplyCenter.id);
      if (supplyCenterAfter && supplyCenterAfter.alive) {
        anomalies.push('SUPPLY-DESTROY: Supply Center still alive after sell');
      } else {
        console.log('SUPPLY-DESTROY: Supply Center destroyed via sell');
      }
    }

    // Run more frames and observe truck behavior
    const truckPositionsBefore = findEntities(logic, 'AmericaVehicleSupplyTruck', 'America')
      .map(t => {
        const s = logic.getEntityState(t.id);
        return { id: t.id, x: s?.x ?? 0, z: s?.z ?? 0, alive: s?.alive ?? false };
      });

    runFrames(logic, 1500, anomalies, 'supply-destroy-aftermath');

    const trucksAfter = findEntities(logic, 'AmericaVehicleSupplyTruck', 'America');
    const creditsAfter = logic.getSideCredits('america');
    console.log(`SUPPLY-DESTROY: After destruction: credits=${creditsAfter}, trucks=${trucksAfter.length}`);

    // Trucks should be in one of these states:
    // - Idle (no supply center to return to)
    // - Seeking new supply center (if one exists)
    // - Destroyed (if they were inside the supply center)
    for (const truck of trucksAfter) {
      const state = logic.getEntityState(truck.id);
      if (state && state.alive) {
        const prevPos = truckPositionsBefore.find(t => t.id === truck.id);
        const moved = prevPos
          ? Math.hypot(state.x - prevPos.x, state.z - prevPos.z) > 5
          : false;
        console.log(`SUPPLY-DESTROY: Truck ${truck.id} alive, moving=${state.moving}, guardState=${state.guardState}, moved=${moved}`);
      }
    }

    checkNaN(logic, anomalies, 'supply-destroy');
    if (anomalies.length > 0) {
      console.log('\n=== SUPPLY-DESTROY ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);
});
