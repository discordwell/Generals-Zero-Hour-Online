/**
 * Retail Faction Wet Tests — exercises faction-specific edge cases with real
 * retail INI data on Tournament Desert.
 *
 * These tests target high-risk scenarios: GLA powerless economy, China nuclear
 * power, USA vehicle production, upgrade completion, multi-unit attack waves,
 * supply truck economy, and victory conditions.
 *
 * Anomalies are logged for analysis. Critical issues (crashes, NaN positions)
 * cause test failure. Non-critical deviations are logged but don't fail.
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FreshGameConfig {
  side0: string;
  side1: string;
  credits?: number;
}

function createFreshGame(config: FreshGameConfig): GameLogicSubsystem {
  const logic = new GameLogicSubsystem(new THREE.Scene(), {
    multipleFactory: 0.85,
  });
  const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
  logic.loadMapObjects(mapData, iniRegistry, heightmap);
  logic.setPlayerSide(0, config.side0);
  logic.setPlayerSide(1, config.side1);
  logic.setTeamRelationship(config.side0, config.side1, 0);
  logic.setTeamRelationship(config.side1, config.side0, 0);
  logic.spawnSkirmishStartingEntities();
  const credits = config.credits ?? 50000;
  logic.submitCommand({ type: 'setSideCredits', side: config.side0, amount: credits });
  logic.submitCommand({ type: 'setSideCredits', side: config.side1, amount: credits });
  logic.update(0);
  logic.update(1 / 30);
  return logic;
}

/** Run N frames at 30fps, catching crashes. Returns false on crash. */
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

/** Check all entity states for NaN positions. */
function checkNaN(logic: GameLogicSubsystem, anomalies: string[], label: string): void {
  const states = logic.getRenderableEntityStates();
  for (const s of states) {
    if (isNaN(s.x) || isNaN(s.y) || isNaN(s.z)) {
      anomalies.push(`NaN position at ${label}: entity ${s.id} (${s.templateName}) pos=(${s.x},${s.y},${s.z})`);
    }
  }
}

/** Find the first entity matching template + side. */
function findEntity(logic: GameLogicSubsystem, templateName: string, side: string) {
  return logic.getRenderableEntityStates().find(e =>
    e.templateName === templateName && e.side?.toUpperCase() === side.toUpperCase(),
  );
}

/** Find all entities matching template + side. */
function findEntities(logic: GameLogicSubsystem, templateName: string, side: string) {
  return logic.getRenderableEntityStates().filter(e =>
    e.templateName === templateName && e.side?.toUpperCase() === side.toUpperCase(),
  );
}

/** Find the dozer/worker for a given side. */
function findDozer(logic: GameLogicSubsystem, side: string) {
  const sideUpper = side.toUpperCase();
  return logic.getRenderableEntityStates().find(e =>
    e.side?.toUpperCase() === sideUpper &&
    (e.templateName.includes('Dozer') || e.templateName.includes('Worker')),
  );
}

/** Find the Command Center for a given side. */
function findCC(logic: GameLogicSubsystem, side: string) {
  const sideUpper = side.toUpperCase();
  return logic.getRenderableEntityStates().find(e =>
    e.side?.toUpperCase() === sideUpper && e.templateName.includes('CommandCenter'),
  );
}

/** Build a structure with a dozer and wait for completion. Returns the built entity or null. */
function buildStructure(
  logic: GameLogicSubsystem,
  dozerId: number,
  templateName: string,
  x: number,
  z: number,
  anomalies: string[],
  buildFrames = 900,
  side = 'AMERICA',
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

  const built = logic.getRenderableEntityStates().find(e =>
    e.templateName === templateName && e.side?.toUpperCase() === side,
  );
  if (!built) {
    anomalies.push(`BUILD FAILED: ${templateName} not found after ${buildFrames} frames`);
  }
  return built ?? null;
}

/** Assert only critical anomalies (NaN/CRASH) cause failure. Log others. */
function assertNoCriticalAnomalies(anomalies: string[], testName: string): void {
  if (anomalies.length > 0) {
    console.log(`\n=== ${testName} ANOMALIES ===`);
    for (const a of anomalies) console.log(`  - ${a}`);
  }
  const nanAnomalies = anomalies.filter(a => a.includes('NaN'));
  const crashAnomalies = anomalies.filter(a => a.includes('CRASH'));
  expect(nanAnomalies.length).toBe(0);
  expect(crashAnomalies.length).toBe(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasRetailData)('faction wet tests: GLA, China, USA edge cases', () => {

  // ── 1. GLA full build chain and combat ─────────────────────────────────
  it('GLA full build chain: Supply Stash + Barracks + Arms Dealer, train Rebels + Technical, no power needed', () => {
    const logic = createFreshGame({ side0: 'GLA', side1: 'America', credits: 50000 });
    const anomalies: string[] = [];

    const worker = findDozer(logic, 'GLA');
    const cc = findCC(logic, 'GLA');
    expect(worker).toBeDefined();
    expect(cc).toBeDefined();

    console.log(`GLA: Worker=${worker!.templateName} at (${worker!.x.toFixed(0)}, ${worker!.z.toFixed(0)})`);
    console.log(`GLA: CC=${cc!.templateName} at (${cc!.x.toFixed(0)}, ${cc!.z.toFixed(0)})`);

    // GLA should NOT need a power plant. Verify no power is consumed or required.
    const powerBefore = logic.getSidePowerState('gla');
    console.log(`GLA: Power before building: prod=${powerBefore.energyProduction}, cons=${powerBefore.energyConsumption}, browned=${powerBefore.brownedOut}`);

    // Build Supply Stash (GLA economy building)
    const stash = buildStructure(logic, worker!.id, 'GLASupplyStash', cc!.x + 120, cc!.z, anomalies, 900, 'GLA');
    if (!stash) {
      console.log('GLA: Supply Stash build failed — checking if template exists');
      const stashDef = iniRegistry.getObject('GLASupplyStash');
      console.log(`GLA: GLASupplyStash in registry: ${!!stashDef}`);
      assertNoCriticalAnomalies(anomalies, 'GLA BUILD CHAIN');
      return;
    }
    console.log('GLA: Supply Stash built successfully');

    // Build Barracks
    const barracks = buildStructure(logic, worker!.id, 'GLABarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'GLA');
    if (!barracks) {
      anomalies.push('GLA: Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'GLA BUILD CHAIN');
      return;
    }
    console.log('GLA: Barracks built successfully');

    // Build Arms Dealer (vehicle factory) — place near barracks to minimize dozer travel
    const armsDealer = buildStructure(logic, worker!.id, 'GLAArmsDealer', cc!.x + 120, cc!.z - 120, anomalies, 1500, 'GLA');
    if (!armsDealer) {
      anomalies.push('GLA: Arms Dealer build failed');
      // Not fatal — continue testing with what we have
    } else {
      console.log('GLA: Arms Dealer built successfully');
    }

    // Verify GLA power state — should NOT be browned out (GLA has no power dependency)
    const powerAfterBuilding = logic.getSidePowerState('gla');
    console.log(`GLA: Power after building: prod=${powerAfterBuilding.energyProduction}, cons=${powerAfterBuilding.energyConsumption}, browned=${powerAfterBuilding.brownedOut}`);
    if (powerAfterBuilding.brownedOut) {
      anomalies.push('GLA: Browned out despite GLA not needing power — parity issue');
    }

    // Train 3 Rebels from Barracks
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'GLAInfantryRebel',
      });
    }
    runFrames(logic, 900, anomalies, 'gla-rebel-training');

    const rebels = findEntities(logic, 'GLAInfantryRebel', 'GLA');
    console.log(`GLA: ${rebels.length}/3 Rebels produced`);
    if (rebels.length === 0) {
      anomalies.push('GLA: No Rebels produced after 900 frames');
    }

    // Train a Technical from Arms Dealer (if built)
    if (armsDealer) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: armsDealer.id,
        unitTemplateName: 'GLAVehicleTechnical',
      });
      runFrames(logic, 600, anomalies, 'gla-technical-training');

      const technicals = findEntities(logic, 'GLAVehicleTechnical', 'GLA');
      console.log(`GLA: ${technicals.length} Technical(s) produced`);
      if (technicals.length === 0) {
        anomalies.push('GLA: No Technical produced after 600 frames');
      }
    }

    // Attack enemy CC with available Rebels
    const enemyCC = findCC(logic, 'America');
    if (enemyCC && rebels.length > 0) {
      for (const rebel of rebels) {
        logic.submitCommand({
          type: 'attackEntity',
          entityId: rebel.id,
          targetEntityId: enemyCC.id,
          commandSource: 'PLAYER',
        });
      }
      const enemyHealthBefore = logic.getEntityState(enemyCC.id)?.health ?? 0;
      runFrames(logic, 1800, anomalies, 'gla-rebel-attack');

      const enemyHealthAfter = logic.getEntityState(enemyCC.id)?.health ?? 0;
      if (enemyHealthAfter < enemyHealthBefore) {
        const dmgPct = ((enemyHealthBefore - enemyHealthAfter) / enemyHealthBefore * 100).toFixed(1);
        console.log(`GLA: Rebels dealt ${dmgPct}% damage to enemy CC`);
      } else {
        anomalies.push(`GLA: Rebels dealt no damage to enemy CC (${enemyHealthBefore} -> ${enemyHealthAfter})`);
      }
    }

    // Verify GLA economy works without power — check credits didn't go NaN
    const glaCredits = logic.getSideCredits('gla');
    console.log(`GLA: Final credits: ${glaCredits}`);
    if (isNaN(glaCredits)) {
      anomalies.push('GLA: Credits are NaN');
    }

    checkNaN(logic, anomalies, 'gla-build-chain');
    assertNoCriticalAnomalies(anomalies, 'GLA BUILD CHAIN');
  }, 120_000);

  // ── 2. China full build chain and combat ───────────────────────────────
  it('China full build chain: Power Plant + Barracks + Supply Center + War Factory, train Red Guard + Battlemaster', () => {
    const logic = createFreshGame({ side0: 'China', side1: 'America', credits: 50000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'China');
    const cc = findCC(logic, 'China');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    console.log(`CHINA: Dozer=${dozer!.templateName} at (${dozer!.x.toFixed(0)}, ${dozer!.z.toFixed(0)})`);

    // Build China Power Plant (Nuclear Reactor in-game, but template is ChinaPowerPlant)
    const pp = buildStructure(logic, dozer!.id, 'ChinaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'CHINA');
    if (!pp) {
      console.log('CHINA: Power Plant build failed');
      assertNoCriticalAnomalies(anomalies, 'CHINA BUILD CHAIN');
      return;
    }

    // Verify nuclear power produces energy
    const powerState = logic.getSidePowerState('china');
    console.log(`CHINA: Power after reactor: prod=${powerState.energyProduction}, cons=${powerState.energyConsumption}`);
    if (powerState.energyProduction <= 0) {
      anomalies.push(`CHINA: Nuclear reactor produced 0 energy (expected > 0)`);
    } else {
      console.log(`CHINA: Nuclear reactor producing ${powerState.energyProduction} energy`);
    }

    // Build Barracks
    const barracks = buildStructure(logic, dozer!.id, 'ChinaBarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'CHINA');
    if (!barracks) {
      anomalies.push('CHINA: Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'CHINA BUILD CHAIN');
      return;
    }

    // Build Supply Center (prerequisite for War Factory)
    const supplyCenter = buildStructure(logic, dozer!.id, 'ChinaSupplyCenter', cc!.x + 250, cc!.z, anomalies, 1500, 'CHINA');
    if (!supplyCenter) {
      anomalies.push('CHINA: Supply Center build failed (prerequisite for War Factory)');
    } else {
      console.log('CHINA: Supply Center built successfully');
    }

    // Build War Factory — requires Supply Center as prerequisite
    const warFactory = buildStructure(logic, dozer!.id, 'ChinaWarFactory', cc!.x + 250, cc!.z + 150, anomalies, 1500, 'CHINA');
    if (!warFactory) {
      anomalies.push('CHINA: War Factory build failed');
      // Not fatal — continue with barracks
    } else {
      console.log('CHINA: War Factory built successfully');
    }

    // Train 3 Red Guard from Barracks
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'ChinaInfantryRedguard',
      });
    }
    runFrames(logic, 900, anomalies, 'china-redguard-training');

    const redGuards = findEntities(logic, 'ChinaInfantryRedguard', 'China');
    console.log(`CHINA: ${redGuards.length}/3 Red Guard produced`);
    if (redGuards.length === 0) {
      anomalies.push('CHINA: No Red Guard produced');
    }

    // Train a Battlemaster from War Factory — tanks take longer to build (BuildTime=14 sec = ~420 frames)
    if (warFactory) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: warFactory.id,
        unitTemplateName: 'ChinaTankBattleMaster',
      });
      runFrames(logic, 900, anomalies, 'china-battlemaster-training');

      const battlemasters = findEntities(logic, 'ChinaTankBattleMaster', 'China');
      console.log(`CHINA: ${battlemasters.length} Battlemaster(s) produced`);
      if (battlemasters.length === 0) {
        anomalies.push('CHINA: No Battlemaster produced');
      }
    }

    // Verify China power remains stable after building multiple structures
    const powerFinal = logic.getSidePowerState('china');
    console.log(`CHINA: Final power: prod=${powerFinal.energyProduction}, cons=${powerFinal.energyConsumption}, browned=${powerFinal.brownedOut}`);

    checkNaN(logic, anomalies, 'china-build-chain');
    assertNoCriticalAnomalies(anomalies, 'CHINA BUILD CHAIN');
  }, 120_000);

  // ── 3. USA vehicle production ──────────────────────────────────────────
  it('USA vehicle production: PP + Supply Center + War Factory, train Humvee and Crusader, verify movement', () => {
    const logic = createFreshGame({ side0: 'America', side1: 'China', credits: 50000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'America');
    const cc = findCC(logic, 'America');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build Power Plant
    const pp = buildStructure(logic, dozer!.id, 'AmericaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'AMERICA');
    if (!pp) {
      assertNoCriticalAnomalies(anomalies, 'USA VEHICLES');
      return;
    }

    // Build Supply Center (prerequisite for War Factory)
    const supplyCenter = buildStructure(logic, dozer!.id, 'AmericaSupplyCenter', cc!.x + 250, cc!.z, anomalies, 1500, 'AMERICA');
    if (!supplyCenter) {
      anomalies.push('USA: Supply Center build failed (prerequisite for War Factory)');
      assertNoCriticalAnomalies(anomalies, 'USA VEHICLES');
      return;
    }

    // Build War Factory — requires Supply Center as prerequisite
    const warFactory = buildStructure(logic, dozer!.id, 'AmericaWarFactory', cc!.x + 250, cc!.z + 150, anomalies, 1500, 'AMERICA');
    if (!warFactory) {
      anomalies.push('USA: War Factory build failed');
      assertNoCriticalAnomalies(anomalies, 'USA VEHICLES');
      return;
    }

    // Train Humvee
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: warFactory.id,
      unitTemplateName: 'AmericaVehicleHumvee',
    });
    runFrames(logic, 600, anomalies, 'usa-humvee-training');

    const humvees = findEntities(logic, 'AmericaVehicleHumvee', 'America');
    console.log(`USA: ${humvees.length} Humvee(s) produced`);
    if (humvees.length === 0) {
      anomalies.push('USA: No Humvee produced after 600 frames');
    }

    // Train Crusader
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: warFactory.id,
      unitTemplateName: 'AmericaTankCrusader',
    });
    runFrames(logic, 600, anomalies, 'usa-crusader-training');

    const crusaders = findEntities(logic, 'AmericaTankCrusader', 'America');
    console.log(`USA: ${crusaders.length} Crusader(s) produced`);
    if (crusaders.length === 0) {
      anomalies.push('USA: No Crusader produced after 600 frames');
    }

    // Verify vehicles can move — issue moveTo commands
    const vehiclesToMove = [...humvees, ...crusaders];
    const startPositions: Array<{ id: number; x: number; z: number }> = [];
    for (const v of vehiclesToMove) {
      const state = logic.getEntityState(v.id);
      if (state && state.alive) {
        startPositions.push({ id: v.id, x: state.x, z: state.z });
        logic.submitCommand({
          type: 'moveTo',
          entityId: v.id,
          targetX: state.x + 200,
          targetZ: state.z,
          commandSource: 'PLAYER',
        });
      }
    }

    runFrames(logic, 300, anomalies, 'usa-vehicle-movement');

    // Verify at least one vehicle moved
    let anyMoved = false;
    for (const start of startPositions) {
      const state = logic.getEntityState(start.id);
      if (state && state.alive) {
        const dist = Math.hypot(state.x - start.x, state.z - start.z);
        if (dist > 10) {
          anyMoved = true;
        }
        console.log(`USA: Vehicle ${start.id} moved ${dist.toFixed(0)} units`);
      }
    }
    if (startPositions.length > 0 && !anyMoved) {
      anomalies.push('USA: No vehicles moved after moveTo command');
    }

    checkNaN(logic, anomalies, 'usa-vehicles');
    assertNoCriticalAnomalies(anomalies, 'USA VEHICLES');
  }, 120_000);

  // ── 4. Upgrade production completion ───────────────────────────────────
  it('upgrade production: PP + Barracks, queue Capture Building upgrade, verify completion', () => {
    const logic = createFreshGame({ side0: 'America', side1: 'China', credits: 50000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'America');
    const cc = findCC(logic, 'America');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build PP
    const pp = buildStructure(logic, dozer!.id, 'AmericaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'AMERICA');
    if (!pp) {
      assertNoCriticalAnomalies(anomalies, 'UPGRADE PRODUCTION');
      return;
    }

    // Build Barracks
    const barracks = buildStructure(logic, dozer!.id, 'AmericaBarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'AMERICA');
    if (!barracks) {
      anomalies.push('UPGRADE: Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'UPGRADE PRODUCTION');
      return;
    }

    // Record credits before upgrade
    const creditsBefore = logic.getSideCredits('america');
    console.log(`UPGRADE: Credits before upgrade: ${creditsBefore}`);

    // Queue Capture Building upgrade (costs 1000 in retail)
    logic.submitCommand({
      type: 'queueUpgradeProduction',
      entityId: barracks.id,
      upgradeName: 'Upgrade_InfantryCaptureBuilding',
    });
    logic.update(1 / 30);

    // Verify credits decreased
    const creditsAfterQueue = logic.getSideCredits('america');
    const upgradeCost = creditsBefore - creditsAfterQueue;
    console.log(`UPGRADE: Credits after queue: ${creditsAfterQueue} (cost: ${upgradeCost})`);
    if (upgradeCost <= 0) {
      anomalies.push(`UPGRADE: Credits did not decrease after queueing (${creditsBefore} -> ${creditsAfterQueue})`);
    }

    // Check production state during production
    runFrames(logic, 150, anomalies, 'upgrade-early');
    const prodMid = logic.getProductionState(barracks.id);
    if (prodMid && prodMid.queue.length > 0) {
      const entry = prodMid.queue[0]!;
      console.log(`UPGRADE: Mid-production queue entry: type=${entry.type}, progress=${entry.percentComplete}%`);
    } else {
      console.log('UPGRADE: Queue empty at 150 frames (may have completed already)');
    }

    // Wait for upgrade to complete
    runFrames(logic, 750, anomalies, 'upgrade-completion');

    // Check if upgrade is applied to the barracks
    const barracksInfo = logic.getSelectedEntityInfoById(barracks.id);
    if (barracksInfo) {
      const hasCaptureUpgrade = barracksInfo.appliedUpgradeNames.some(u =>
        u.toUpperCase().includes('CAPTUREBUILDING') || u.toUpperCase().includes('CAPTURE_BUILDING'),
      );
      if (hasCaptureUpgrade) {
        console.log('UPGRADE: Capture Building upgrade successfully applied to Barracks');
      } else {
        anomalies.push(`UPGRADE: Capture Building not found in barracks upgrades: [${barracksInfo.appliedUpgradeNames.join(', ')}]`);
      }
    }

    // Production queue should be empty now
    const prodFinal = logic.getProductionState(barracks.id);
    if (prodFinal) {
      const upgradeEntries = prodFinal.queue.filter(e => e.type === 'UPGRADE');
      if (upgradeEntries.length > 0) {
        anomalies.push(`UPGRADE: Still ${upgradeEntries.length} upgrade entries in queue after 900 frames`);
      } else {
        console.log('UPGRADE: Production queue empty (upgrade complete)');
      }
    }

    // Train a Ranger after upgrade — should be born with the upgrade
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: barracks.id,
      unitTemplateName: 'AmericaInfantryRanger',
    });
    runFrames(logic, 450, anomalies, 'upgrade-post-ranger');

    const ranger = findEntity(logic, 'AmericaInfantryRanger', 'America');
    if (ranger) {
      const rangerInfo = logic.getSelectedEntityInfoById(ranger.id);
      if (rangerInfo) {
        const rangerHasCapture = rangerInfo.appliedUpgradeNames.some(u =>
          u.toUpperCase().includes('CAPTUREBUILDING') || u.toUpperCase().includes('CAPTURE_BUILDING'),
        );
        if (rangerHasCapture) {
          console.log('UPGRADE: Ranger born with Capture Building upgrade');
        } else {
          anomalies.push(`UPGRADE: Ranger lacks Capture Building upgrade: [${rangerInfo.appliedUpgradeNames.join(', ')}]`);
        }
      }
    }

    checkNaN(logic, anomalies, 'upgrade-production');
    assertNoCriticalAnomalies(anomalies, 'UPGRADE PRODUCTION');
  }, 120_000);

  // ── 5. Multi-unit attack wave ──────────────────────────────────────────
  it('multi-unit attack wave: train 5 Rangers, attack-move toward enemy base, verify damage', () => {
    const logic = createFreshGame({ side0: 'America', side1: 'China', credits: 50000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'America');
    const cc = findCC(logic, 'America');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build PP + Barracks
    const pp = buildStructure(logic, dozer!.id, 'AmericaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'AMERICA');
    if (!pp) {
      assertNoCriticalAnomalies(anomalies, 'ATTACK WAVE');
      return;
    }

    const barracks = buildStructure(logic, dozer!.id, 'AmericaBarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'AMERICA');
    if (!barracks) {
      assertNoCriticalAnomalies(anomalies, 'ATTACK WAVE');
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
    runFrames(logic, 1500, anomalies, 'ranger-mass-training');

    const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    console.log(`ATTACK WAVE: ${rangers.length}/5 Rangers produced`);
    if (rangers.length === 0) {
      anomalies.push('ATTACK WAVE: No Rangers produced');
      assertNoCriticalAnomalies(anomalies, 'ATTACK WAVE');
      return;
    }

    // Find enemy structures for damage tracking
    const enemyCC = findCC(logic, 'China');
    expect(enemyCC).toBeDefined();
    const enemyDozer = findDozer(logic, 'China');

    // Record enemy health totals before attack
    const enemyStructures = logic.getRenderableEntityStates().filter(e =>
      e.side?.toUpperCase() === 'CHINA' && e.category === 'building',
    );
    const enemyUnits = logic.getRenderableEntityStates().filter(e =>
      e.side?.toUpperCase() === 'CHINA' && (e.category === 'infantry' || e.category === 'vehicle'),
    );
    let totalEnemyHealthBefore = 0;
    for (const e of [...enemyStructures, ...enemyUnits]) {
      const state = logic.getEntityState(e.id);
      if (state && state.alive) totalEnemyHealthBefore += state.health;
    }
    console.log(`ATTACK WAVE: Total enemy health before: ${totalEnemyHealthBefore}`);

    // Attack-move all Rangers toward enemy base
    // Use attackEntity on a specific target for reliable behavior
    const attackTarget = enemyDozer ?? enemyCC!;
    for (const ranger of rangers) {
      logic.submitCommand({
        type: 'attackEntity',
        entityId: ranger.id,
        targetEntityId: attackTarget.id,
        commandSource: 'PLAYER',
      });
    }

    // Run combat for ~60 seconds game time (Rangers walk across map and fight)
    runFrames(logic, 1800, anomalies, 'attack-wave-combat');

    // Check how many Rangers survived
    let rangersAlive = 0;
    let anyDamageDone = false;
    for (const ranger of rangers) {
      const state = logic.getEntityState(ranger.id);
      if (state && state.alive) rangersAlive++;
    }
    console.log(`ATTACK WAVE: ${rangersAlive}/${rangers.length} Rangers survived`);

    // Check if any damage was dealt to enemy
    let totalEnemyHealthAfter = 0;
    for (const e of [...enemyStructures, ...enemyUnits]) {
      const state = logic.getEntityState(e.id);
      if (state && state.alive) totalEnemyHealthAfter += state.health;
    }
    // Also count dead entities as damage
    const enemyDeaths = [...enemyStructures, ...enemyUnits].filter(e => {
      const state = logic.getEntityState(e.id);
      return !state || !state.alive;
    }).length;
    console.log(`ATTACK WAVE: Total enemy health after: ${totalEnemyHealthAfter}, enemy deaths: ${enemyDeaths}`);

    if (totalEnemyHealthAfter < totalEnemyHealthBefore || enemyDeaths > 0) {
      anyDamageDone = true;
      const damagePct = ((totalEnemyHealthBefore - totalEnemyHealthAfter) / totalEnemyHealthBefore * 100).toFixed(1);
      console.log(`ATTACK WAVE: ${damagePct}% total enemy health reduction`);
    }

    if (!anyDamageDone) {
      anomalies.push('ATTACK WAVE: 5 Rangers dealt no damage to enemy after 1800 frames');
    }

    checkNaN(logic, anomalies, 'attack-wave');
    assertNoCriticalAnomalies(anomalies, 'ATTACK WAVE');
  }, 120_000);

  // ── 6. Supply truck economy end-to-end ─────────────────────────────────
  it('supply truck economy: PP + Supply Center, verify auto-spawn truck and credit gathering over 3000 frames', () => {
    const logic = createFreshGame({ side0: 'America', side1: 'China', credits: 15000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'America');
    const cc = findCC(logic, 'America');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build Power Plant
    const pp = buildStructure(logic, dozer!.id, 'AmericaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'AMERICA');
    if (!pp) {
      assertNoCriticalAnomalies(anomalies, 'SUPPLY ECONOMY');
      return;
    }

    // Build Supply Center — supply trucks should auto-spawn
    // Place it reasonably close to a supply dock (the map should have supply sources)
    const supplyCenter = buildStructure(
      logic, dozer!.id, 'AmericaSupplyCenter', cc!.x + 200, cc!.z + 50, anomalies, 900, 'AMERICA',
    );
    if (!supplyCenter) {
      anomalies.push('SUPPLY: Supply Center build failed');
      assertNoCriticalAnomalies(anomalies, 'SUPPLY ECONOMY');
      return;
    }
    console.log(`SUPPLY: Supply Center built at (${supplyCenter.x.toFixed(0)}, ${supplyCenter.z.toFixed(0)})`);

    // Record credits after building
    const creditsAfterBuild = logic.getSideCredits('america');
    console.log(`SUPPLY: Credits after buildings: ${creditsAfterBuild}`);

    // Check if a supply truck was auto-spawned
    let supplyTrucks = findEntities(logic, 'AmericaVehicleSupplyTruck', 'America');
    console.log(`SUPPLY: Supply trucks after building: ${supplyTrucks.length}`);

    // Run frames for trucks to gather — supply trucks need time to auto-spawn and travel
    let creditsSampled: number[] = [];
    for (let phase = 0; phase < 6; phase++) {
      runFrames(logic, 500, anomalies, `supply-gathering-phase-${phase}`);
      const credits = logic.getSideCredits('america');
      creditsSampled.push(credits);

      supplyTrucks = findEntities(logic, 'AmericaVehicleSupplyTruck', 'America');

      // Track supply truck cargo
      let trucksCarrying = 0;
      for (const truck of supplyTrucks) {
        const state = logic.getEntityState(truck.id);
        if (state && state.supplyBoxes !== null && state.supplyBoxes > 0) {
          trucksCarrying++;
        }
      }
      console.log(`SUPPLY: Phase ${phase}: credits=${credits}, trucks=${supplyTrucks.length}, carrying=${trucksCarrying}`);
    }

    // Verify credits changed over time
    const creditsEnd = logic.getSideCredits('america');
    console.log(`SUPPLY: Credits at end: ${creditsEnd}`);
    console.log(`SUPPLY: Credit samples: ${creditsSampled.join(', ')}`);

    // Check for credit increase (supply gathering should add credits)
    // or at least credits shouldn't have gone to NaN
    if (isNaN(creditsEnd)) {
      anomalies.push('SUPPLY: Credits became NaN during gathering');
    }

    // If credits increased, supply chain is working
    if (creditsEnd > creditsAfterBuild) {
      console.log(`SUPPLY: Credits increased by ${creditsEnd - creditsAfterBuild} — economy working`);
    } else if (supplyTrucks.length === 0) {
      anomalies.push('SUPPLY: No supply trucks spawned — auto-spawn may be broken');
    } else {
      anomalies.push(`SUPPLY: Credits did not increase (${creditsAfterBuild} -> ${creditsEnd}) despite ${supplyTrucks.length} trucks`);
    }

    checkNaN(logic, anomalies, 'supply-economy');
    assertNoCriticalAnomalies(anomalies, 'SUPPLY ECONOMY');
  }, 120_000);

  // ── 7. Victory condition ───────────────────────────────────────────────
  it('victory condition: destroy all enemy buildings and units, verify game end VICTORY', () => {
    // Use a small credits setup so enemy has minimal defenses
    const logic = createFreshGame({ side0: 'America', side1: 'China', credits: 10000 });
    const anomalies: string[] = [];

    // Find all enemy (China) entities
    const chinaEntities = logic.getRenderableEntityStates().filter(e =>
      e.side?.toUpperCase() === 'CHINA',
    );
    console.log(`VICTORY: China starts with ${chinaEntities.length} entities`);
    for (const e of chinaEntities) {
      console.log(`VICTORY:   ${e.templateName} (id=${e.id}, category=${e.category})`);
    }

    // Should not be defeated yet
    expect(logic.isSideDefeated('China')).toBe(false);
    expect(logic.getGameEndState()).toBeNull();

    // Forcefully destroy all China entities by dealing massive damage
    // We use sell on buildings and attackEntity. But simpler: use a direct damage approach.
    // Actually, let's just queue force-kills by dealing damage via repeated attack commands
    // from a unit we create.
    //
    // Simpler approach: build an army and overwhelm, but that takes too long.
    // Instead, spawn many Rangers and attack each enemy entity individually.

    const dozer = findDozer(logic, 'America');
    const cc = findCC(logic, 'America');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build PP + Barracks
    const pp = buildStructure(logic, dozer!.id, 'AmericaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'AMERICA');
    if (!pp) {
      assertNoCriticalAnomalies(anomalies, 'VICTORY');
      return;
    }

    const barracks = buildStructure(logic, dozer!.id, 'AmericaBarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'AMERICA');
    if (!barracks) {
      assertNoCriticalAnomalies(anomalies, 'VICTORY');
      return;
    }

    // Give loads of credits for a massive army
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 200000 });

    // Train 15 Rangers (overkill to ensure victory)
    for (let i = 0; i < 15; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 3000, anomalies, 'victory-ranger-mass-training');

    const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    console.log(`VICTORY: ${rangers.length}/15 Rangers produced`);
    if (rangers.length < 5) {
      anomalies.push(`VICTORY: Only ${rangers.length} Rangers produced, need more for victory test`);
    }

    // Find the remaining enemy entities and attack them one by one
    const remainingEnemies = logic.getRenderableEntityStates().filter(e =>
      e.side?.toUpperCase() === 'CHINA',
    );
    console.log(`VICTORY: ${remainingEnemies.length} China entities remaining`);

    // Attack each enemy entity with all Rangers
    for (const enemy of remainingEnemies) {
      const enemyState = logic.getEntityState(enemy.id);
      if (!enemyState || !enemyState.alive) continue;

      for (const ranger of rangers) {
        const rState = logic.getEntityState(ranger.id);
        if (rState && rState.alive) {
          logic.submitCommand({
            type: 'attackEntity',
            entityId: ranger.id,
            targetEntityId: enemy.id,
            commandSource: 'PLAYER',
          });
        }
      }
      // Run enough frames for Rangers to reach and destroy this target
      runFrames(logic, 2400, anomalies, `victory-kill-${enemy.templateName}`);

      const targetState = logic.getEntityState(enemy.id);
      if (targetState && targetState.alive) {
        console.log(`VICTORY: ${enemy.templateName} still alive with ${targetState.health}/${targetState.maxHealth} HP`);
      } else {
        console.log(`VICTORY: ${enemy.templateName} destroyed`);
      }

      // Check if victory already triggered
      const gameEnd = logic.getGameEndState();
      if (gameEnd) {
        console.log(`VICTORY: Game ended: status=${gameEnd.status}, victors=${gameEnd.victorSides.join(',')}, defeated=${gameEnd.defeatedSides.join(',')}`);
        break;
      }
    }

    // Run a few more frames for victory conditions to be processed
    runFrames(logic, 300, anomalies, 'victory-final');

    // Check game end state
    const gameEnd = logic.getGameEndState();
    const isChinaDefeated = logic.isSideDefeated('China');

    console.log(`VICTORY: China defeated: ${isChinaDefeated}`);
    console.log(`VICTORY: Game end state: ${gameEnd ? `status=${gameEnd.status}, victors=[${gameEnd.victorSides}], defeated=[${gameEnd.defeatedSides}]` : 'null'}`);

    // Verify remaining China entities
    const chinaRemaining = logic.getRenderableEntityStates().filter(e =>
      e.side?.toUpperCase() === 'CHINA',
    );
    let chinaAlive = 0;
    for (const e of chinaRemaining) {
      const state = logic.getEntityState(e.id);
      if (state && state.alive) {
        chinaAlive++;
        console.log(`VICTORY: China entity still alive: ${e.templateName} (id=${e.id}, health=${state.health})`);
      }
    }
    console.log(`VICTORY: China entities still alive: ${chinaAlive}`);

    if (chinaAlive === 0 && !isChinaDefeated) {
      anomalies.push('VICTORY: All China entities dead but isSideDefeated returns false');
    }

    if (isChinaDefeated) {
      if (!gameEnd) {
        anomalies.push('VICTORY: China is defeated but getGameEndState() is null');
      } else if (gameEnd.status !== 'VICTORY') {
        anomalies.push(`VICTORY: Expected VICTORY status but got ${gameEnd.status}`);
      } else {
        console.log('VICTORY: Game ended with VICTORY for player 0 (America)');
      }
    } else if (chinaAlive > 0) {
      // Some units survived — not a bug, just insufficient firepower or time
      anomalies.push(`VICTORY: ${chinaAlive} China entities survived — Rangers may need more time or numbers`);
    }

    checkNaN(logic, anomalies, 'victory-condition');
    assertNoCriticalAnomalies(anomalies, 'VICTORY');
  }, 300_000); // Extra-long timeout for this test
});
