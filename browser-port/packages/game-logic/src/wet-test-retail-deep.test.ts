/**
 * Deep Retail Wet Test — exercises high-risk gameplay flows with real retail data.
 *
 * These tests are designed to FIND bugs, not just pass. Each test exercises
 * a specific gameplay flow end-to-end with retail INI data on Tournament Desert.
 *
 * Anomalies are logged for analysis. Critical issues (crashes, NaN positions)
 * cause test failure. Non-critical deviations are logged but don't fail the test.
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

/** Create a fresh game instance with generous credits and retail GameData config. */
function createFreshGame(config?: { credits?: number }): GameLogicSubsystem {
  const logic = new GameLogicSubsystem(new THREE.Scene());
  const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
  logic.loadMapObjects(mapData, iniRegistry, heightmap);
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'China');
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
  logic.spawnSkirmishStartingEntities();
  const credits = config?.credits ?? 50000;
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

/** Check all entity states for NaN positions — a critical invariant. */
function checkNaN(logic: GameLogicSubsystem, anomalies: string[], label: string): void {
  const states = logic.getRenderableEntityStates();
  for (const s of states) {
    if (isNaN(s.x) || isNaN(s.y) || isNaN(s.z)) {
      anomalies.push(`NaN position at ${label}: entity ${s.id} (${s.templateName}) pos=(${s.x},${s.y},${s.z})`);
    }
  }
}

/** Find the USA dozer entity. */
function findUSADozer(logic: GameLogicSubsystem) {
  return logic.getRenderableEntityStates().find(e =>
    e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
  );
}

/** Find the USA Command Center. */
function findUSACC(logic: GameLogicSubsystem) {
  return logic.getRenderableEntityStates().find(e =>
    e.templateName === 'AmericaCommandCenter' && e.side?.toUpperCase() === 'AMERICA',
  );
}

/** Build a structure and return it once complete. */
function buildStructure(
  logic: GameLogicSubsystem,
  dozerId: number,
  templateName: string,
  x: number,
  z: number,
  anomalies: string[],
  buildFrames = 900,
): ReturnType<GameLogicSubsystem['getRenderableEntityStates']>[0] | null {
  logic.submitCommand({
    type: 'constructBuilding',
    entityId: dozerId,
    templateName,
    targetPosition: [x, 0, z],
    angle: 0,
    lineEndPosition: null,
  });
  runFrames(logic, buildFrames, anomalies, `build-${templateName}`);

  const built = logic.getRenderableEntityStates().find(e =>
    e.templateName === templateName && e.side?.toUpperCase() === 'AMERICA',
  );
  if (!built) {
    anomalies.push(`BUILD FAILED: ${templateName} not found after ${buildFrames} frames`);
  }
  return built ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasRetailData)('deep retail wet test: gameplay flows', () => {

  // ── 1. Full USA build-and-fight cycle ──────────────────────────────────
  it('full USA build-and-fight cycle: PP -> Barracks -> 5 Rangers -> attack enemy CC', () => {
    const logic = createFreshGame();
    const anomalies: string[] = [];
    const dozer = findUSADozer(logic);
    const cc = findUSACC(logic);
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build Power Plant
    const pp = buildStructure(logic, dozer!.id, 'AmericaPowerPlant', cc!.x + 120, cc!.z, anomalies);
    if (!pp) {
      console.log('=== BUILD-AND-FIGHT: Power Plant construction failed ===');
      console.log(anomalies.join('\n'));
      return; // Cannot proceed without PP
    }

    // Build Barracks
    const barracks = buildStructure(logic, dozer!.id, 'AmericaBarracks', cc!.x + 120, cc!.z + 120, anomalies);
    if (!barracks) {
      console.log('=== BUILD-AND-FIGHT: Barracks construction failed ===');
      console.log(anomalies.join('\n'));
      return;
    }

    // Train 5 Rangers
    for (let i = 0; i < 5; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 1500, anomalies, 'ranger-training'); // ~50 seconds game time

    const rangers = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaInfantryRanger' && e.side?.toUpperCase() === 'AMERICA',
    );
    if (rangers.length < 5) {
      anomalies.push(`PRODUCTION: Only ${rangers.length}/5 Rangers produced after 1500 frames`);
    }
    if (rangers.length === 0) {
      console.log('=== BUILD-AND-FIGHT: No Rangers produced ===');
      console.log(anomalies.join('\n'));
      expect(rangers.length).toBeGreaterThan(0);
      return;
    }

    // Find enemy CC
    const enemyCC = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'ChinaCommandCenter' && e.side?.toUpperCase() === 'CHINA',
    );
    expect(enemyCC).toBeDefined();
    const enemyCCHealthBefore = logic.getEntityState(enemyCC!.id)?.health ?? 0;

    // Record initial Ranger positions relative to enemy CC
    const initialDistances = rangers.map(r => {
      const state = logic.getEntityState(r.id)!;
      return Math.hypot(state.x - enemyCC!.x, state.z - enemyCC!.z);
    });
    console.log(`BUILD-AND-FIGHT: Initial distances to CC: ${initialDistances.map(d => d.toFixed(0)).join(', ')}`);

    // Attack enemy CC with all Rangers
    for (const ranger of rangers) {
      logic.submitCommand({
        type: 'attackEntity',
        entityId: ranger.id,
        targetEntityId: enemyCC!.id,
        commandSource: 'PLAYER',
      });
    }

    // Critical: Rangers must start moving toward the target after attack command
    logic.update(1 / 30);
    let anyMoving = false;
    for (const ranger of rangers) {
      const rState = logic.getEntityState(ranger.id);
      if (rState && rState.alive && rState.moving) {
        anyMoving = true;
      }
    }
    expect(anyMoving).toBe(true); // At least one Ranger must be moving

    // Run combat for ~60 seconds game time (Rangers need to walk across the map and attack)
    runFrames(logic, 1800, anomalies, 'ranger-attack');
    checkNaN(logic, anomalies, 'post-combat');

    // Diagnose: did Rangers actually reach the enemy CC?
    const enemyCCPos = logic.getEntityState(enemyCC!.id);
    let anyCloser = false;
    for (let ri = 0; ri < rangers.length; ri++) {
      const ranger = rangers[ri]!;
      const rState = logic.getEntityState(ranger.id);
      if (rState && rState.alive && enemyCCPos) {
        const dist = Math.hypot(rState.x - enemyCCPos.x, rState.z - enemyCCPos.z);
        const isAttacking = rState.attackTargetEntityId === enemyCC!.id;
        console.log(`BUILD-AND-FIGHT: Ranger ${ranger.id} dist-to-CC=${dist.toFixed(0)}, attacking=${isAttacking}, moving=${rState.moving}`);
        if (dist < initialDistances[ri]! - 100) {
          anyCloser = true;
        }
      }
    }
    // Critical: at least one Ranger must have moved significantly closer
    expect(anyCloser).toBe(true);

    // Check if Rangers dealt damage to enemy CC
    const enemyCCAfter = logic.getEntityState(enemyCC!.id);
    if (enemyCCAfter && enemyCCAfter.alive) {
      if (enemyCCAfter.health >= enemyCCHealthBefore) {
        anomalies.push(`COMBAT: Enemy CC took no damage (health ${enemyCCAfter.health}/${enemyCCHealthBefore})`);
      } else {
        const damagePct = ((enemyCCHealthBefore - enemyCCAfter.health) / enemyCCHealthBefore * 100).toFixed(1);
        console.log(`BUILD-AND-FIGHT: Enemy CC took ${damagePct}% damage from ${rangers.length} Rangers`);
      }
    } else if (enemyCCAfter && !enemyCCAfter.alive) {
      console.log('BUILD-AND-FIGHT: Enemy CC destroyed by Rangers');
    }

    // Check Ranger casualties
    const rangersAlive = rangers.filter(r => {
      const state = logic.getEntityState(r.id);
      return state && state.alive;
    });
    console.log(`BUILD-AND-FIGHT: ${rangersAlive.length}/${rangers.length} Rangers survived`);

    if (anomalies.length > 0) {
      console.log('\n=== BUILD-AND-FIGHT ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    // Critical: no NaN positions
    const nanAnomalies = anomalies.filter(a => a.includes('NaN'));
    expect(nanAnomalies.length).toBe(0);
    // Critical: no crashes
    const crashAnomalies = anomalies.filter(a => a.includes('CRASH'));
    expect(crashAnomalies.length).toBe(0);
  }, 120_000);

  // ── 2. Upgrade application: FlashBang for Rangers ──────────────────────
  it('upgrade application: purchase FlashBang upgrade at Barracks', () => {
    const logic = createFreshGame();
    const anomalies: string[] = [];
    const dozer = findUSADozer(logic)!;
    const cc = findUSACC(logic)!;

    // Build PP + Barracks
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    if (!pp) { console.log('UPGRADE: PP build failed'); return; }

    const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
    if (!barracks) { console.log('UPGRADE: Barracks build failed'); return; }

    // Train a Ranger first (upgrade should apply to existing units)
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: barracks.id,
      unitTemplateName: 'AmericaInfantryRanger',
    });
    runFrames(logic, 450, anomalies, 'ranger-pre-upgrade');

    const rangerBefore = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'AmericaInfantryRanger' && e.side?.toUpperCase() === 'AMERICA',
    );

    // Check credits before upgrade
    const creditsBefore = logic.getSideCredits('america');

    // Purchase FlashBang upgrade at Barracks
    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: barracks.id,
      upgradeName: 'Upgrade_AmericaRangerFlashBangGrenade',
    });
    logic.update(1 / 30);

    // Credits should decrease (upgrade has a cost)
    const creditsAfterQueue = logic.getSideCredits('america');
    if (creditsAfterQueue >= creditsBefore) {
      anomalies.push(`UPGRADE COST: Credits did not decrease after queueing upgrade (${creditsBefore} -> ${creditsAfterQueue})`);
    } else {
      console.log(`UPGRADE: FlashBang cost ${creditsBefore - creditsAfterQueue} credits`);
    }

    // Check production queue progress midway
    runFrames(logic, 150, anomalies, 'upgrade-production-early');
    const prodMid = logic.getProductionState(barracks.id);
    if (prodMid.queue.length > 0) {
      const entry = prodMid.queue[0]!;
      console.log(`UPGRADE: Queue entry type=${entry.type}, progress=${entry.percentComplete}%`);
    } else {
      console.log('UPGRADE: Queue empty at 150 frames (may have completed instantly or failed)');
    }

    // Wait for upgrade to complete
    runFrames(logic, 750, anomalies, 'upgrade-production');

    // Check if upgrade completed on the barracks
    const barracksInfo = logic.getSelectedEntityInfoById(barracks.id);
    if (barracksInfo) {
      const hasFlashBang = barracksInfo.appliedUpgradeNames.some(u =>
        u.toUpperCase().includes('FLASHBANG') || u.toUpperCase().includes('FLASH_BANG'),
      );
      if (!hasFlashBang) {
        anomalies.push(`UPGRADE NOT APPLIED to barracks: upgrades = [${barracksInfo.appliedUpgradeNames.join(', ')}]`);
      } else {
        console.log('UPGRADE: FlashBang successfully applied to Barracks');
      }
    }

    // Check if the Ranger received the upgrade (side-wide upgrade application)
    if (rangerBefore) {
      const rangerInfo = logic.getSelectedEntityInfoById(rangerBefore.id);
      if (rangerInfo) {
        const rangerHasUpgrade = rangerInfo.appliedUpgradeNames.some(u =>
          u.toUpperCase().includes('FLASHBANG') || u.toUpperCase().includes('FLASH_BANG'),
        );
        if (rangerHasUpgrade) {
          console.log('UPGRADE: FlashBang applied to existing Ranger');
        } else {
          anomalies.push(`UPGRADE NOT PROPAGATED to Ranger: upgrades = [${rangerInfo.appliedUpgradeNames.join(', ')}]`);
        }
      }
    }

    // Train a new Ranger after upgrade — should have the upgrade
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: barracks.id,
      unitTemplateName: 'AmericaInfantryRanger',
    });
    runFrames(logic, 450, anomalies, 'ranger-post-upgrade');
    checkNaN(logic, anomalies, 'post-upgrade');

    if (anomalies.length > 0) {
      console.log('\n=== UPGRADE ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const nanAnomalies = anomalies.filter(a => a.includes('NaN'));
    expect(nanAnomalies.length).toBe(0);
    const crashAnomalies = anomalies.filter(a => a.includes('CRASH'));
    expect(crashAnomalies.length).toBe(0);
  }, 120_000);

  // ── 3. Multiple factory production coverage ────────────────────────────
  it('multiple factory production: 2 Barracks produce concurrently with retail GameData', () => {
    const anomalies: string[] = [];

    // Game WITH retail GameData.ini MultipleFactory=1.0.
    const logic = createFreshGame();
    const dozer = findUSADozer(logic)!;
    const cc = findUSACC(logic)!;

    // Build PP
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    if (!pp) { console.log('MULTI-FACTORY: PP build failed'); return; }

    // Build first Barracks
    const barracks1 = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
    if (!barracks1) { console.log('MULTI-FACTORY: Barracks 1 build failed'); return; }

    // Build second Barracks (place near the first to minimize dozer travel)
    const barracks2 = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z - 120, anomalies, 1500);
    if (!barracks2) {
      anomalies.push('MULTI-FACTORY: Second Barracks build failed (may indicate placement issue or build limit)');
      // Check if there's a max-simultaneous limit
      const allBarracksNow = logic.getRenderableEntityStates().filter(e =>
        e.templateName === 'AmericaBarracks' && e.side?.toUpperCase() === 'AMERICA',
      );
      console.log(`MULTI-FACTORY: Found ${allBarracksNow.length} barracks, credits=${logic.getSideCredits('america')}`);
    }

    // Count how many Barracks we actually have
    const allBarracks = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaBarracks' && e.side?.toUpperCase() === 'AMERICA',
    );
    console.log(`MULTI-FACTORY: ${allBarracks.length} Barracks built`);

    if (allBarracks.length >= 2) {
      // Queue a Ranger from each Barracks
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: allBarracks[0]!.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: allBarracks[1]!.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });

      // Track production progress
      let rangerCount = 0;
      let framesToFirst = -1;
      for (let frame = 0; frame < 600; frame++) {
        logic.update(1 / 30);
        const currentRangers = logic.getRenderableEntityStates().filter(e =>
          e.templateName === 'AmericaInfantryRanger' && e.side?.toUpperCase() === 'AMERICA',
        ).length;
        if (currentRangers > rangerCount) {
          rangerCount = currentRangers;
          if (framesToFirst === -1) framesToFirst = frame;
        }
      }

      console.log(`MULTI-FACTORY: First Ranger produced at frame ${framesToFirst}, total ${rangerCount} Rangers`);

      // Retail GameData.ini sets MultipleFactory=1.0, so this is a
      // coverage/wiring check for multiple factory production rather than a
      // speedup assertion.
      if (framesToFirst > 0) {
        const productionState = logic.getProductionState(allBarracks[0]!.id);
        console.log(`MULTI-FACTORY: Barracks 1 queue has ${productionState.queueEntryCount} entries`);
      }
    }

    checkNaN(logic, anomalies, 'multi-factory');
    if (anomalies.length > 0) {
      console.log('\n=== MULTI-FACTORY ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const criticalAnomalies = anomalies.filter(a => a.includes('NaN') || a.includes('CRASH'));
    expect(criticalAnomalies.length).toBe(0);
  }, 120_000);

  // ── 4. Sell and rebuild cycle ──────────────────────────────────────────
  it('sell and rebuild cycle: build PP, sell it, verify refund, build another', () => {
    const logic = createFreshGame({ credits: 10000 });
    const anomalies: string[] = [];
    const dozer = findUSADozer(logic)!;
    const cc = findUSACC(logic)!;

    const creditsStart = logic.getSideCredits('america');
    console.log(`SELL-REBUILD: Starting credits: ${creditsStart}`);

    // Build Power Plant
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    if (!pp) { console.log('SELL-REBUILD: PP build failed'); return; }

    const creditsAfterBuild = logic.getSideCredits('america');
    const buildCost = creditsStart - creditsAfterBuild;
    console.log(`SELL-REBUILD: Credits after build: ${creditsAfterBuild} (cost: ${buildCost})`);

    if (buildCost <= 0) {
      anomalies.push(`SELL-REBUILD: PP cost was ${buildCost} (expected positive)`);
    }

    // Sell the Power Plant
    logic.submitCommand({ type: 'sell', entityId: pp.id });
    // Sell countdown takes ~3 seconds = 90 frames, but allow more
    runFrames(logic, 300, anomalies, 'sell-pp');

    const creditsAfterSell = logic.getSideCredits('america');
    const refund = creditsAfterSell - creditsAfterBuild;
    console.log(`SELL-REBUILD: Credits after sell: ${creditsAfterSell} (refund: ${refund})`);

    if (refund <= 0) {
      anomalies.push(`SELL-REBUILD: No refund received (credits: ${creditsAfterBuild} -> ${creditsAfterSell})`);
    }

    // Refund should be roughly 50% of build cost (retail SellPercentage = 50%)
    if (buildCost > 0 && refund > 0) {
      const refundPct = refund / buildCost;
      console.log(`SELL-REBUILD: Refund percentage: ${(refundPct * 100).toFixed(1)}%`);
      if (refund > buildCost) {
        anomalies.push(`SELL-REBUILD: Refund (${refund}) exceeds build cost (${buildCost}) - money exploit!`);
      }
      // Critical: refund must be ~50%, not 100%
      expect(refundPct).toBeCloseTo(0.5, 1);
    }

    // Verify PP is gone
    const ppAfterSell = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaPowerPlant' && e.side?.toUpperCase() === 'AMERICA',
    );
    if (ppAfterSell.length > 0) {
      // Check if it's actually destroyed
      for (const p of ppAfterSell) {
        const state = logic.getEntityState(p.id);
        if (state && state.alive) {
          anomalies.push(`SELL-REBUILD: PP still alive after sell (id=${p.id})`);
        }
      }
    }

    // Build another PP at a different location
    const pp2 = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x - 120, cc.z, anomalies);
    if (!pp2) {
      anomalies.push('SELL-REBUILD: Second PP build failed after selling first');
    } else {
      console.log('SELL-REBUILD: Second PP built successfully');
    }

    const creditsEnd = logic.getSideCredits('america');
    console.log(`SELL-REBUILD: Final credits: ${creditsEnd}`);

    checkNaN(logic, anomalies, 'sell-rebuild');
    if (anomalies.length > 0) {
      console.log('\n=== SELL-REBUILD ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const criticalAnomalies = anomalies.filter(a => a.includes('NaN') || a.includes('CRASH'));
    expect(criticalAnomalies.length).toBe(0);
  }, 120_000);

  // ── 5. Guard behavior with real units ──────────────────────────────────
  it('guard behavior: Rangers on guard auto-engage nearby enemies', () => {
    const logic = createFreshGame();
    const anomalies: string[] = [];
    const dozer = findUSADozer(logic)!;
    const cc = findUSACC(logic)!;

    // Build PP + Barracks
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    if (!pp) { console.log('GUARD: PP build failed'); return; }

    const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
    if (!barracks) { console.log('GUARD: Barracks build failed'); return; }

    // Train 3 Rangers
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 900, anomalies, 'guard-train-rangers');

    const rangers = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaInfantryRanger' && e.side?.toUpperCase() === 'AMERICA',
    );
    if (rangers.length === 0) {
      anomalies.push('GUARD: No Rangers produced');
      console.log(anomalies.join('\n'));
      return;
    }

    // Place Rangers on guard near the China CC so they have targets within scan range.
    // Guard inner range = VisionRange(100) * guardInnerModifierHuman(1.8) = 180 world units.
    const chinaCC = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'ChinaCommandCenter' && e.side?.toUpperCase() === 'CHINA',
    );
    // Guard position: 100 world units from the China CC (well within inner range of 180).
    const guardX = chinaCC ? chinaCC.x - 100 : cc.x + 400;
    const guardZ = chinaCC?.z ?? cc.z;

    // Set Rangers to guard (they will walk to the guard position and scan for enemies).
    for (const ranger of rangers) {
      logic.submitCommand({
        type: 'guardPosition',
        entityId: ranger.id,
        targetX: guardX,
        targetZ: guardZ,
        guardMode: 0, // GUARDMODE_NORMAL (with pursuit)
        commandSource: 'PLAYER',
      });
    }
    runFrames(logic, 30, anomalies, 'guard-set');

    // Record Ranger guard states right after command.
    const rangerGuardStates: string[] = [];
    for (const ranger of rangers) {
      const state = logic.getEntityState(ranger.id);
      if (state) {
        rangerGuardStates.push(state.guardState);
      }
    }
    console.log(`GUARD: Ranger guard states after command: [${rangerGuardStates.join(', ')}]`);

    // Run enough frames for Rangers to walk to guard position and scan for enemies.
    // Ranger speed = 20 units/sec, distance to China base ~1500 units.
    // Time to arrive: 1500/20 = 75 sec = ~2250 frames. Add margin for pathfinding.
    // Guard scan runs every 15 frames (IDLE) or 30 frames (RETURNING).
    runFrames(logic, 2700, anomalies, 'guard-walk-and-engage');

    // Diagnostic: Ranger positions, guard states, and distance to China CC
    for (const ranger of rangers) {
      const state = logic.getEntityState(ranger.id);
      if (state && state.alive) {
        const dist = chinaCC ? Math.hypot(state.x - chinaCC.x, state.z - chinaCC.z) : -1;
        console.log(`GUARD: Ranger ${ranger.id} pos=(${state.x.toFixed(0)},${state.z.toFixed(0)}) guardState=${state.guardState} dist-to-CC=${dist.toFixed(0)} attacking=${state.attackTargetEntityId}`);
      }
    }

    // Check if Rangers engaged anything
    let anyEngaged = false;
    for (const ranger of rangers) {
      const state = logic.getEntityState(ranger.id);
      if (state && state.alive) {
        if (state.attackTargetEntityId !== null) {
          anyEngaged = true;
          console.log(`GUARD: Ranger ${ranger.id} engaging target ${state.attackTargetEntityId}`);
        }
      }
    }
    if (!anyEngaged) {
      anomalies.push('GUARD: No Rangers auto-engaged enemies (may need longer sim or enemies not in range)');
    }

    checkNaN(logic, anomalies, 'guard-behavior');
    if (anomalies.length > 0) {
      console.log('\n=== GUARD BEHAVIOR ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const criticalAnomalies = anomalies.filter(a => a.includes('NaN') || a.includes('CRASH'));
    expect(criticalAnomalies.length).toBe(0);
  }, 120_000);

  // ── 6. Unit veterancy from combat ──────────────────────────────────────
  it('unit veterancy from combat: Ranger kills enemies and gains XP', () => {
    const logic = createFreshGame();
    const anomalies: string[] = [];
    const dozer = findUSADozer(logic)!;
    const cc = findUSACC(logic)!;

    // Build PP + Barracks
    buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
    if (!barracks) { console.log('VETERANCY: Barracks build failed'); return; }

    // Train a single Ranger (hero unit for this test)
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: barracks.id,
      unitTemplateName: 'AmericaInfantryRanger',
    });
    runFrames(logic, 450, anomalies, 'veterancy-train');

    const ranger = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'AmericaInfantryRanger' && e.side?.toUpperCase() === 'AMERICA',
    );
    if (!ranger) {
      anomalies.push('VETERANCY: No Ranger produced');
      console.log(anomalies.join('\n'));
      return;
    }

    const rangerState0 = logic.getEntityState(ranger.id)!;
    const initialXP = rangerState0.currentExperience;
    const initialLevel = rangerState0.veterancyLevel;
    console.log(`VETERANCY: Ranger starts at level ${initialLevel} with ${initialXP} XP`);

    // Attack the China dozer (easier target than CC)
    const chinaDozer = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'ChinaVehicleDozer' && e.side?.toUpperCase() === 'CHINA',
    );
    if (chinaDozer) {
      logic.submitCommand({
        type: 'attackEntity',
        entityId: ranger.id,
        targetEntityId: chinaDozer.id,
        commandSource: 'PLAYER',
      });
      runFrames(logic, 1800, anomalies, 'veterancy-combat-dozer');

      const rangerAfterDozer = logic.getEntityState(ranger.id);
      if (rangerAfterDozer && rangerAfterDozer.alive) {
        console.log(`VETERANCY: After attacking dozer - level ${rangerAfterDozer.veterancyLevel}, XP ${rangerAfterDozer.currentExperience}`);
        if (rangerAfterDozer.currentExperience > initialXP) {
          console.log(`VETERANCY: XP gained: ${rangerAfterDozer.currentExperience - initialXP}`);
        } else {
          anomalies.push('VETERANCY: No XP gained after combat');
        }
        if (rangerAfterDozer.veterancyLevel > initialLevel) {
          console.log(`VETERANCY: Level up! ${initialLevel} -> ${rangerAfterDozer.veterancyLevel}`);
        }
      } else {
        anomalies.push('VETERANCY: Ranger died or disappeared during dozer fight');
      }
    }

    // Also try attacking the enemy CC
    const enemyCC = logic.getRenderableEntityStates().find(e =>
      e.templateName === 'ChinaCommandCenter' && e.side?.toUpperCase() === 'CHINA',
    );
    if (enemyCC) {
      const rangerNow = logic.getEntityState(ranger.id);
      if (rangerNow && rangerNow.alive) {
        logic.submitCommand({
          type: 'attackEntity',
          entityId: ranger.id,
          targetEntityId: enemyCC.id,
          commandSource: 'PLAYER',
        });
        runFrames(logic, 1800, anomalies, 'veterancy-combat-cc');

        const rangerFinal = logic.getEntityState(ranger.id);
        if (rangerFinal && rangerFinal.alive) {
          console.log(`VETERANCY: Final - level ${rangerFinal.veterancyLevel}, XP ${rangerFinal.currentExperience}`);
        }
      }
    }

    checkNaN(logic, anomalies, 'veterancy');
    if (anomalies.length > 0) {
      console.log('\n=== VETERANCY ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const criticalAnomalies = anomalies.filter(a => a.includes('NaN') || a.includes('CRASH'));
    expect(criticalAnomalies.length).toBe(0);
  }, 120_000);

  // ── 7. Power brownout recovery ─────────────────────────────────────────
  it('power brownout recovery: destroy PP, verify brownout, rebuild PP, verify recovery', () => {
    const logic = createFreshGame({ credits: 20000 });
    const anomalies: string[] = [];
    const dozer = findUSADozer(logic)!;
    const cc = findUSACC(logic)!;

    // Build Power Plant
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x + 120, cc.z, anomalies);
    if (!pp) { console.log('BROWNOUT: PP build failed'); return; }

    // Build Barracks (does not consume power in retail) + War Factory (consumes 1 power)
    const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', cc.x + 120, cc.z + 120, anomalies);
    if (!barracks) { console.log('BROWNOUT: Barracks build failed'); return; }

    // Build a Patriot Battery which consumes 3 power (EnergyProduction: -3 in retail INI).
    const patriot = buildStructure(logic, dozer.id, 'AmericaPatriotBattery', cc.x - 120, cc.z + 120, anomalies, 1200);
    if (!patriot) {
      anomalies.push('BROWNOUT: Patriot Battery build failed (needed for power consumption test)');
    }

    // Check power state — should be fine with 1 PP (production=5) and consumption from Patriot (-3)
    const powerBefore = logic.getSidePowerState('america');
    console.log(`BROWNOUT: Before sell - production=${powerBefore.energyProduction}, consumption=${powerBefore.energyConsumption}, brownedOut=${powerBefore.brownedOut}`);

    const hasSufficientBefore = logic.hasSufficientPower('america');
    console.log(`BROWNOUT: Has sufficient power before sell: ${hasSufficientBefore}`);

    // Queue a Ranger for production (to test production behavior during brownout)
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: barracks.id,
      unitTemplateName: 'AmericaInfantryRanger',
    });

    // Record production state before selling PP
    const prodBefore = logic.getProductionState(barracks.id);
    const prodProgressBefore = prodBefore.queue.length > 0
      ? (prodBefore.queue[0]! as any).framesUnderConstruction ?? 0
      : 0;

    // Sell the PP to cause brownout
    logic.submitCommand({ type: 'sell', entityId: pp.id });
    runFrames(logic, 300, anomalies, 'brownout-sell-pp');

    // Check power state — should be in brownout
    const powerAfterSell = logic.getSidePowerState('america');
    console.log(`BROWNOUT: After sell - production=${powerAfterSell.energyProduction}, consumption=${powerAfterSell.energyConsumption}, brownedOut=${powerAfterSell.brownedOut}`);

    if (powerAfterSell.energyProduction > 0 && powerAfterSell.energyConsumption > 0) {
      // If production < consumption, should be browned out
      if (powerAfterSell.energyProduction < powerAfterSell.energyConsumption && !powerAfterSell.brownedOut) {
        anomalies.push('BROWNOUT: Should be browned out but brownedOut=false');
      }
    }
    // If no consumption, brownout may not trigger (depends on implementation)
    if (powerAfterSell.energyConsumption === 0) {
      anomalies.push('BROWNOUT: Barracks not consuming power (energyConsumption=0)');
    }

    // Let some time pass to see production behavior during brownout
    runFrames(logic, 300, anomalies, 'brownout-production-slowdown');

    // Now rebuild PP to recover
    const pp2 = buildStructure(logic, dozer.id, 'AmericaPowerPlant', cc.x - 120, cc.z, anomalies);
    if (!pp2) {
      anomalies.push('BROWNOUT: Recovery PP build failed');
    }

    // Check power state — should be recovered
    const powerAfterRebuild = logic.getSidePowerState('america');
    console.log(`BROWNOUT: After rebuild - production=${powerAfterRebuild.energyProduction}, consumption=${powerAfterRebuild.energyConsumption}, brownedOut=${powerAfterRebuild.brownedOut}`);

    if (powerAfterRebuild.brownedOut && powerAfterRebuild.energyProduction >= powerAfterRebuild.energyConsumption) {
      anomalies.push('BROWNOUT: Still browned out despite sufficient power');
    }

    // Let production finish
    runFrames(logic, 600, anomalies, 'brownout-post-recovery-production');

    // Check if the Ranger was eventually produced
    const rangersProduced = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaInfantryRanger' && e.side?.toUpperCase() === 'AMERICA',
    );
    console.log(`BROWNOUT: Rangers produced after brownout recovery: ${rangersProduced.length}`);

    checkNaN(logic, anomalies, 'brownout');
    if (anomalies.length > 0) {
      console.log('\n=== BROWNOUT ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    const criticalAnomalies = anomalies.filter(a => a.includes('NaN') || a.includes('CRASH'));
    expect(criticalAnomalies.length).toBe(0);
  }, 120_000);

  // ── 8. 10000-frame stability test ─────────────────────────────────────
  it('10000-frame stability test: both AIs running, no crashes or NaN', () => {
    const logic = createFreshGame({ credits: 100000 });
    const anomalies: string[] = [];

    logic.enableSkirmishAI('America');
    logic.enableSkirmishAI('China');

    const entityCountLog: Array<{ frame: number; total: number; america: number; china: number }> = [];
    let maxEntities = 0;
    let prevEntityCount = 0;

    for (let frame = 0; frame < 10000; frame++) {
      try {
        logic.update(1 / 30);
      } catch (err) {
        anomalies.push(`CRASH at frame ${frame}: ${err instanceof Error ? err.message : String(err)}`);
        // This is critical — test must fail
        console.log('\n=== 10K STABILITY: CRASH ===');
        console.log(`  Frame ${frame}: ${err instanceof Error ? err.stack : String(err)}`);
        expect.fail(`Simulation crashed at frame ${frame}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      // Log entity counts every 1000 frames
      if (frame % 1000 === 0) {
        const states = logic.getRenderableEntityStates();
        const americaCount = states.filter(e => e.side?.toUpperCase() === 'AMERICA').length;
        const chinaCount = states.filter(e => e.side?.toUpperCase() === 'CHINA').length;
        entityCountLog.push({ frame, total: states.length, america: americaCount, china: chinaCount });
        maxEntities = Math.max(maxEntities, states.length);

        // Check for runaway entity counts (> 5x initial count suggests a leak)
        if (prevEntityCount > 0 && states.length > prevEntityCount * 5) {
          anomalies.push(`RUNAWAY ENTITIES at frame ${frame}: ${states.length} entities (prev checkpoint: ${prevEntityCount})`);
        }
        prevEntityCount = states.length;

        // NaN check
        const nanEntities = states.filter(s => isNaN(s.x) || isNaN(s.y) || isNaN(s.z));
        if (nanEntities.length > 0) {
          anomalies.push(`NaN positions at frame ${frame}: ${nanEntities.length} entities`);
          for (const ne of nanEntities.slice(0, 5)) {
            anomalies.push(`  NaN entity: ${ne.id} (${ne.templateName}) pos=(${ne.x},${ne.y},${ne.z})`);
          }
        }

        // Negative health check
        const negHealthEntities = states.filter(s => s.health < 0);
        if (negHealthEntities.length > 0) {
          anomalies.push(`Negative health at frame ${frame}: ${negHealthEntities.length} entities`);
        }
      }
    }

    // Print entity count progression
    console.log('\n=== 10K STABILITY: Entity Count Progression ===');
    for (const entry of entityCountLog) {
      console.log(`  Frame ${entry.frame.toString().padStart(5)}: total=${entry.total.toString().padStart(4)}, USA=${entry.america.toString().padStart(3)}, China=${entry.china.toString().padStart(3)}`);
    }
    console.log(`  Peak entities: ${maxEntities}`);

    // Final sanity check
    const finalStates = logic.getRenderableEntityStates();
    expect(finalStates.length).toBeGreaterThan(0);

    // Final credits check
    const usaCredits = logic.getSideCredits('america');
    const chinaCredits = logic.getSideCredits('china');
    console.log(`  Final credits: USA=${usaCredits}, China=${chinaCredits}`);
    if (isNaN(usaCredits) || isNaN(chinaCredits)) {
      anomalies.push(`NaN credits: USA=${usaCredits}, China=${chinaCredits}`);
    }

    // Final power state check
    const usaPower = logic.getSidePowerState('america');
    const chinaPower = logic.getSidePowerState('china');
    console.log(`  USA power: prod=${usaPower.energyProduction}, cons=${usaPower.energyConsumption}, browned=${usaPower.brownedOut}`);
    console.log(`  China power: prod=${chinaPower.energyProduction}, cons=${chinaPower.energyConsumption}, browned=${chinaPower.brownedOut}`);

    if (anomalies.length > 0) {
      console.log('\n=== 10K STABILITY ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }

    // NaN and crashes are critical failures
    const nanAnomalies = anomalies.filter(a => a.includes('NaN'));
    const crashAnomalies = anomalies.filter(a => a.includes('CRASH'));
    const runawayAnomalies = anomalies.filter(a => a.includes('RUNAWAY'));
    expect(nanAnomalies.length).toBe(0);
    expect(crashAnomalies.length).toBe(0);
    expect(runawayAnomalies.length).toBe(0);
  }, 120_000);
});
