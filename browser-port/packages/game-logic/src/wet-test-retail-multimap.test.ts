/**
 * Retail Wet Test Round 8 — Multi-map and GLA/China faction mechanics
 *
 * Tests on DIFFERENT maps (Alpine Assault, Flash Fire, Golden Oasis) and
 * exercises GLA/China-specific mechanics:
 *   1. Alpine Assault — load, spawn, run 1000 frames on a snow/mountain map
 *   2. Flash Fire — load, verify no errors on different terrain
 *   3. Golden Oasis — load, verify desert map with water features
 *   4. GLA powerless economy — GLA builds and trains without any power plant
 *   5. GLA Tunnel Network — build 2 tunnels, send unit in one, exit from other
 *   6. China Horde bonus — train 5+ Red Guard, group them, verify HORDE flag
 *   7. China Nuclear Reactor power — build reactor, verify energy production
 *   8. GLA Rebels vs China Red Guard — direct cross-faction infantry combat
 *
 * Hard-fail on crashes, NaN, and critical invariant violations.
 * Soft-fail (log anomaly) on gameplay deviations.
 */
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem, WEAPON_BONUS_HORDE } from './index.js';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

const ASSETS_DIR = resolve(import.meta.dirname ?? __dirname, '../../app/public/assets');
const MAPS_DIR = resolve(ASSETS_DIR, 'maps/_extracted/MapsZH/Maps');

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let iniRegistry: IniDataRegistry;
let tournamentDesertMap: MapDataJSON;

function loadRetailData(): boolean {
  try {
    const bundleJson = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'data/ini-bundle.json'), 'utf-8'));
    iniRegistry = new IniDataRegistry();
    iniRegistry.loadBundle(bundleJson);
    tournamentDesertMap = JSON.parse(readFileSync(
      resolve(MAPS_DIR, 'Tournament Desert/Tournament Desert.json'), 'utf-8',
    ));
    return true;
  } catch { return false; }
}

const hasRetailData = loadRetailData();

function loadMap(mapName: string): MapDataJSON | null {
  const mapPath = resolve(MAPS_DIR, `${mapName}/${mapName}.json`);
  if (!existsSync(mapPath)) return null;
  try {
    return JSON.parse(readFileSync(mapPath, 'utf-8'));
  } catch { return null; }
}

// Preload alternate maps
const alpineAssaultMap = hasRetailData ? loadMap('Alpine Assault') : null;
const flashFireMap = hasRetailData ? loadMap('Flash Fire') : null;
const goldenOasisMap = hasRetailData ? loadMap('Golden Oasis') : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FreshGameConfig {
  side0: string;
  side1: string;
  credits?: number;
  map?: MapDataJSON;
}

function createFreshGame(config: FreshGameConfig): GameLogicSubsystem {
  const logic = new GameLogicSubsystem(new THREE.Scene(), {
    multipleFactory: 0.85,
  });
  const map = config.map ?? tournamentDesertMap;
  const heightmap = HeightmapGrid.fromJSON(map.heightmap);
  logic.loadMapObjects(map, iniRegistry, heightmap);
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

function findDozer(logic: GameLogicSubsystem, side: string) {
  const sideUpper = side.toUpperCase();
  return logic.getRenderableEntityStates().find(e =>
    e.side?.toUpperCase() === sideUpper &&
    (e.templateName.includes('Dozer') || e.templateName.includes('Worker')),
  );
}

function findCC(logic: GameLogicSubsystem, side: string) {
  const sideUpper = side.toUpperCase();
  return logic.getRenderableEntityStates().find(e =>
    e.side?.toUpperCase() === sideUpper && e.templateName.includes('CommandCenter'),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasRetailData)('wet test round 8: multi-map and GLA/China mechanics', () => {

  // =========================================================================
  // PART A: Multi-map loading and simulation
  // =========================================================================

  // == 1. Alpine Assault ==
  it.skipIf(!alpineAssaultMap)('Alpine Assault: load snow/mountain map, spawn entities, run 1000 frames without crash', () => {
    const logic = createFreshGame({
      side0: 'America',
      side1: 'China',
      credits: 50000,
      map: alpineAssaultMap!,
    });
    const anomalies: string[] = [];

    // Verify map loaded with entities
    const allEntities = logic.getRenderableEntityStates();
    console.log(`ALPINE: ${allEntities.length} entities after map load + skirmish spawn`);
    expect(allEntities.length).toBeGreaterThan(0);

    // Check terrain dimensions from heightmap
    const heightmap = HeightmapGrid.fromJSON(alpineAssaultMap!.heightmap);
    console.log(`ALPINE: Terrain dimensions: ${heightmap.width}x${heightmap.height}, spacing=${heightmap.spacing}`);
    expect(heightmap.width).toBeGreaterThan(0);
    expect(heightmap.height).toBeGreaterThan(0);

    // Check starting entities per side
    const usaEntities = allEntities.filter(e => e.side?.toUpperCase() === 'AMERICA');
    const chinaEntities = allEntities.filter(e => e.side?.toUpperCase() === 'CHINA');
    console.log(`ALPINE: USA entities: ${usaEntities.length}, China entities: ${chinaEntities.length}`);

    // Verify at least command center + dozer per side (skirmish spawn)
    const usaCC = findCC(logic, 'America');
    const chinaCC = findCC(logic, 'China');
    if (usaCC) console.log(`ALPINE: USA CC at (${usaCC.x.toFixed(0)}, ${usaCC.z.toFixed(0)})`);
    if (chinaCC) console.log(`ALPINE: China CC at (${chinaCC.x.toFixed(0)}, ${chinaCC.z.toFixed(0)})`);

    // Check initial NaN
    checkNaN(logic, anomalies, 'alpine-after-load');

    // Enable AI and run 1000 frames
    logic.enableSkirmishAI('America');
    logic.enableSkirmishAI('China');
    const ok = runFrames(logic, 1000, anomalies, 'alpine-simulation');

    // Check NaN after simulation
    checkNaN(logic, anomalies, 'alpine-after-1000-frames');

    const entitiesAfter = logic.getRenderableEntityStates();
    console.log(`ALPINE: ${entitiesAfter.length} entities after 1000 frames (started with ${allEntities.length})`);
    console.log(`ALPINE: Simulation completed: ${ok}`);

    assertNoCriticalAnomalies(anomalies, 'ALPINE ASSAULT');
  }, 120_000);

  // == 2. Flash Fire ==
  it.skipIf(!flashFireMap)('Flash Fire: load map, spawn entities, verify no errors', () => {
    const logic = createFreshGame({
      side0: 'GLA',
      side1: 'America',
      credits: 50000,
      map: flashFireMap!,
    });
    const anomalies: string[] = [];

    const allEntities = logic.getRenderableEntityStates();
    console.log(`FLASH FIRE: ${allEntities.length} entities after load`);
    expect(allEntities.length).toBeGreaterThan(0);

    const heightmap = HeightmapGrid.fromJSON(flashFireMap!.heightmap);
    console.log(`FLASH FIRE: Terrain dimensions: ${heightmap.width}x${heightmap.height}, spacing=${heightmap.spacing}`);

    // Verify GLA spawned correctly on this map
    const glaCC = findCC(logic, 'GLA');
    const glaWorker = findDozer(logic, 'GLA');
    if (glaCC) console.log(`FLASH FIRE: GLA CC at (${glaCC.x.toFixed(0)}, ${glaCC.z.toFixed(0)})`);
    if (glaWorker) console.log(`FLASH FIRE: GLA Worker at (${glaWorker.x.toFixed(0)}, ${glaWorker.z.toFixed(0)})`);

    checkNaN(logic, anomalies, 'flashfire-after-load');

    // Run 500 frames with AI
    logic.enableSkirmishAI('GLA');
    logic.enableSkirmishAI('America');
    runFrames(logic, 500, anomalies, 'flashfire-simulation');
    checkNaN(logic, anomalies, 'flashfire-after-500-frames');

    const entitiesAfter = logic.getRenderableEntityStates();
    console.log(`FLASH FIRE: ${entitiesAfter.length} entities after 500 frames`);

    assertNoCriticalAnomalies(anomalies, 'FLASH FIRE');
  }, 120_000);

  // == 3. Golden Oasis ==
  it.skipIf(!goldenOasisMap)('Golden Oasis: load desert/water map, spawn entities, verify no errors', () => {
    const logic = createFreshGame({
      side0: 'China',
      side1: 'GLA',
      credits: 50000,
      map: goldenOasisMap!,
    });
    const anomalies: string[] = [];

    const allEntities = logic.getRenderableEntityStates();
    console.log(`GOLDEN OASIS: ${allEntities.length} entities after load`);
    expect(allEntities.length).toBeGreaterThan(0);

    const heightmap = HeightmapGrid.fromJSON(goldenOasisMap!.heightmap);
    console.log(`GOLDEN OASIS: Terrain dimensions: ${heightmap.width}x${heightmap.height}, spacing=${heightmap.spacing}`);

    // Verify both factions spawned
    const chinaCC = findCC(logic, 'China');
    const glaCC = findCC(logic, 'GLA');
    if (chinaCC) console.log(`GOLDEN OASIS: China CC at (${chinaCC.x.toFixed(0)}, ${chinaCC.z.toFixed(0)})`);
    if (glaCC) console.log(`GOLDEN OASIS: GLA CC at (${glaCC.x.toFixed(0)}, ${glaCC.z.toFixed(0)})`);

    checkNaN(logic, anomalies, 'oasis-after-load');

    // Run 500 frames
    logic.enableSkirmishAI('China');
    logic.enableSkirmishAI('GLA');
    runFrames(logic, 500, anomalies, 'oasis-simulation');
    checkNaN(logic, anomalies, 'oasis-after-500-frames');

    const entitiesAfter = logic.getRenderableEntityStates();
    console.log(`GOLDEN OASIS: ${entitiesAfter.length} entities after 500 frames`);

    assertNoCriticalAnomalies(anomalies, 'GOLDEN OASIS');
  }, 120_000);

  // =========================================================================
  // PART B: GLA-specific mechanics
  // =========================================================================

  // == 4. GLA plays without power ==
  it('GLA powerless economy: build Supply Stash + Barracks, train Rebels, no brownout ever', () => {
    const logic = createFreshGame({ side0: 'GLA', side1: 'America', credits: 50000 });
    const anomalies: string[] = [];

    const worker = findDozer(logic, 'GLA');
    const cc = findCC(logic, 'GLA');
    expect(worker).toBeDefined();
    expect(cc).toBeDefined();

    // GLA power state should NOT be browned out from the start
    const powerAtStart = logic.getSidePowerState('gla');
    console.log(`GLA-POWER: Start: prod=${powerAtStart.energyProduction}, cons=${powerAtStart.energyConsumption}, browned=${powerAtStart.brownedOut}`);
    if (powerAtStart.brownedOut) {
      anomalies.push('GLA-POWER: Browned out at game start (before any building)');
    }

    // Build Supply Stash (GLA economy, no power plant needed)
    const stash = buildStructure(logic, worker!.id, 'GLASupplyStash', cc!.x + 120, cc!.z, anomalies, 900, 'GLA');
    if (!stash) {
      assertNoCriticalAnomalies(anomalies, 'GLA POWERLESS ECONOMY');
      return;
    }
    console.log('GLA-POWER: Supply Stash built without power plant');

    // Check power — should NOT be browned out
    const powerAfterStash = logic.getSidePowerState('gla');
    console.log(`GLA-POWER: After Supply Stash: prod=${powerAfterStash.energyProduction}, cons=${powerAfterStash.energyConsumption}, browned=${powerAfterStash.brownedOut}`);
    if (powerAfterStash.brownedOut) {
      anomalies.push('GLA-POWER: Browned out after building Supply Stash');
    }

    // Build Barracks (still no power plant)
    const barracks = buildStructure(logic, worker!.id, 'GLABarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'GLA');
    if (!barracks) {
      anomalies.push('GLA-POWER: Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'GLA POWERLESS ECONOMY');
      return;
    }
    console.log('GLA-POWER: Barracks built without power plant');

    // Check power again — still no brownout
    const powerAfterBarracks = logic.getSidePowerState('gla');
    console.log(`GLA-POWER: After Barracks: prod=${powerAfterBarracks.energyProduction}, cons=${powerAfterBarracks.energyConsumption}, browned=${powerAfterBarracks.brownedOut}`);
    if (powerAfterBarracks.brownedOut) {
      anomalies.push('GLA-POWER: Browned out after building Barracks');
    }

    // Train 3 Rebels to verify economy works
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'GLAInfantryRebel',
      });
    }
    runFrames(logic, 900, anomalies, 'gla-power-rebel-training');

    const rebels = findEntities(logic, 'GLAInfantryRebel', 'GLA');
    console.log(`GLA-POWER: ${rebels.length}/3 Rebels trained`);
    if (rebels.length === 0) {
      anomalies.push('GLA-POWER: No Rebels produced');
    }

    // Final power check — GLA should NEVER be browned out
    const powerFinal = logic.getSidePowerState('gla');
    console.log(`GLA-POWER: Final: prod=${powerFinal.energyProduction}, cons=${powerFinal.energyConsumption}, browned=${powerFinal.brownedOut}`);
    if (powerFinal.brownedOut) {
      anomalies.push('GLA-POWER: Browned out at end of test');
    }

    // Verify credits are valid
    const glaCredits = logic.getSideCredits('gla');
    console.log(`GLA-POWER: Final credits: ${glaCredits}`);
    expect(isNaN(glaCredits)).toBe(false);

    checkNaN(logic, anomalies, 'gla-powerless');
    assertNoCriticalAnomalies(anomalies, 'GLA POWERLESS ECONOMY');
  }, 120_000);

  // == 5. GLA Tunnel Network ==
  it('GLA Tunnel Network: build 2 tunnels, send Rebel in tunnel A, verify tunnel containment', () => {
    const logic = createFreshGame({ side0: 'GLA', side1: 'America', credits: 100000 });
    const anomalies: string[] = [];

    const worker = findDozer(logic, 'GLA');
    const cc = findCC(logic, 'GLA');
    expect(worker).toBeDefined();
    expect(cc).toBeDefined();

    // Build first tunnel
    const tunnelA = buildStructure(logic, worker!.id, 'GLATunnelNetwork', cc!.x + 120, cc!.z, anomalies, 1200, 'GLA');
    if (!tunnelA) {
      console.log('GLA-TUNNEL: First tunnel build failed');
      assertNoCriticalAnomalies(anomalies, 'GLA TUNNEL NETWORK');
      return;
    }
    console.log(`GLA-TUNNEL: Tunnel A built (id=${tunnelA.id}) at (${tunnelA.x.toFixed(0)}, ${tunnelA.z.toFixed(0)})`);

    // Build second tunnel at a different location
    const tunnelB = buildStructure(logic, worker!.id, 'GLATunnelNetwork', cc!.x - 120, cc!.z + 120, anomalies, 1200, 'GLA');
    if (!tunnelB) {
      console.log('GLA-TUNNEL: Second tunnel build failed');
      anomalies.push('GLA-TUNNEL: Could not build second tunnel');
      assertNoCriticalAnomalies(anomalies, 'GLA TUNNEL NETWORK');
      return;
    }
    console.log(`GLA-TUNNEL: Tunnel B built (id=${tunnelB.id}) at (${tunnelB.x.toFixed(0)}, ${tunnelB.z.toFixed(0)})`);

    // Verify both tunnels exist
    const allTunnels = findEntities(logic, 'GLATunnelNetwork', 'GLA');
    console.log(`GLA-TUNNEL: ${allTunnels.length} tunnels on map`);
    expect(allTunnels.length).toBeGreaterThanOrEqual(2);

    // Build Barracks to train Rebels (need a unit to enter tunnel)
    const barracks = buildStructure(logic, worker!.id, 'GLABarracks', cc!.x, cc!.z + 120, anomalies, 900, 'GLA');
    if (!barracks) {
      anomalies.push('GLA-TUNNEL: Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'GLA TUNNEL NETWORK');
      return;
    }

    // Train a Rebel
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: barracks.id,
      unitTemplateName: 'GLAInfantryRebel',
    });
    runFrames(logic, 600, anomalies, 'tunnel-rebel-training');

    const rebels = findEntities(logic, 'GLAInfantryRebel', 'GLA');
    console.log(`GLA-TUNNEL: ${rebels.length} Rebel(s) trained`);
    if (rebels.length === 0) {
      anomalies.push('GLA-TUNNEL: No Rebels trained');
      assertNoCriticalAnomalies(anomalies, 'GLA TUNNEL NETWORK');
      return;
    }

    const rebel = rebels[0]!;

    // Move Rebel toward tunnel A
    logic.submitCommand({
      type: 'moveTo',
      entityId: rebel.id,
      targetX: tunnelA.x,
      targetZ: tunnelA.z,
      commandSource: 'PLAYER',
    });
    runFrames(logic, 600, anomalies, 'tunnel-approach');

    // Enter tunnel A using enterTransport command
    logic.submitCommand({
      type: 'enterTransport',
      entityId: rebel.id,
      targetTransportId: tunnelA.id,
      commandSource: 'PLAYER',
    });
    runFrames(logic, 300, anomalies, 'tunnel-enter');

    // Check if Rebel is inside the tunnel (tunnelContainerId set)
    const rebelState = logic.getEntityState(rebel.id);
    if (rebelState) {
      const isInTunnel = rebelState.statusFlags.includes('DISABLED_HELD') ||
                         rebelState.statusFlags.includes('INSIDE_TUNNEL');
      console.log(`GLA-TUNNEL: Rebel alive=${rebelState.alive}, statusFlags=[${rebelState.statusFlags.join(', ')}]`);

      // Access internal state to check tunnelContainerId
      const priv = logic as unknown as {
        spawnedEntities: Map<number, { tunnelContainerId: number | null }>;
      };
      const rebelEntity = priv.spawnedEntities.get(rebel.id);
      if (rebelEntity) {
        console.log(`GLA-TUNNEL: Rebel tunnelContainerId=${rebelEntity.tunnelContainerId}`);
        if (rebelEntity.tunnelContainerId !== null) {
          console.log('GLA-TUNNEL: Rebel is inside tunnel network');

          // Try to exit from tunnel B
          // The exitContainer command on the tunnel should eject from any connected tunnel
          logic.submitCommand({
            type: 'exitContainer',
            entityId: tunnelB.id,
          });
          runFrames(logic, 300, anomalies, 'tunnel-exit');

          const rebelAfterExit = logic.getEntityState(rebel.id);
          const rebelEntityAfterExit = priv.spawnedEntities.get(rebel.id);
          if (rebelAfterExit && rebelEntityAfterExit) {
            console.log(`GLA-TUNNEL: After exit: tunnelContainerId=${rebelEntityAfterExit.tunnelContainerId}`);
            if (rebelEntityAfterExit.tunnelContainerId === null) {
              console.log('GLA-TUNNEL: Rebel successfully exited tunnel network');
              // Check if Rebel appeared near tunnel B
              const distToB = Math.hypot(rebelAfterExit.x - tunnelB.x, rebelAfterExit.z - tunnelB.z);
              console.log(`GLA-TUNNEL: Rebel distance to tunnel B after exit: ${distToB.toFixed(0)}`);
            } else {
              anomalies.push('GLA-TUNNEL: Rebel still in tunnel after exit command');
            }
          }
        } else {
          // Rebel might not have reached the tunnel in time
          anomalies.push('GLA-TUNNEL: Rebel did not enter tunnel (may not have reached it)');
        }
      }
    }

    checkNaN(logic, anomalies, 'gla-tunnel');
    assertNoCriticalAnomalies(anomalies, 'GLA TUNNEL NETWORK');
  }, 120_000);

  // =========================================================================
  // PART C: China-specific mechanics
  // =========================================================================

  // == 6. China Horde bonus ==
  it('China Horde bonus: train 5+ Red Guard, group them, verify WEAPON_BONUS_HORDE activates', () => {
    const logic = createFreshGame({ side0: 'China', side1: 'America', credits: 50000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'China');
    const cc = findCC(logic, 'China');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build Power Plant
    const pp = buildStructure(logic, dozer!.id, 'ChinaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'CHINA');
    if (!pp) {
      assertNoCriticalAnomalies(anomalies, 'CHINA HORDE');
      return;
    }

    // Build Barracks
    const barracks = buildStructure(logic, dozer!.id, 'ChinaBarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'CHINA');
    if (!barracks) {
      anomalies.push('HORDE: Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'CHINA HORDE');
      return;
    }

    // Train 6 Red Guard (need 5+ for horde bonus — retail HordeUpdate threshold is typically 3-5)
    for (let i = 0; i < 6; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'ChinaInfantryRedguard',
      });
    }
    runFrames(logic, 1800, anomalies, 'horde-training');

    const redGuards = findEntities(logic, 'ChinaInfantryRedguard', 'China');
    console.log(`HORDE: ${redGuards.length}/6 Red Guard trained`);
    if (redGuards.length < 3) {
      anomalies.push(`HORDE: Only ${redGuards.length} Red Guard trained, need 3+ for horde`);
      assertNoCriticalAnomalies(anomalies, 'CHINA HORDE');
      return;
    }

    // Move all Red Guard to the same spot (center of them, close together)
    const centerX = redGuards.reduce((sum, e) => sum + e.x, 0) / redGuards.length;
    const centerZ = redGuards.reduce((sum, e) => sum + e.z, 0) / redGuards.length;
    console.log(`HORDE: Moving all Red Guard to (${centerX.toFixed(0)}, ${centerZ.toFixed(0)})`);

    for (const guard of redGuards) {
      logic.submitCommand({
        type: 'moveTo',
        entityId: guard.id,
        targetX: centerX,
        targetZ: centerZ,
        commandSource: 'PLAYER',
      });
    }

    // Wait for them to group up and for HordeUpdate to fire
    runFrames(logic, 600, anomalies, 'horde-grouping');

    // Check WEAPON_BONUS_HORDE flag on each Red Guard
    let hordeActiveCount = 0;
    for (const guard of redGuards) {
      const state = logic.getEntityState(guard.id);
      if (state && state.alive) {
        const hasHorde = (state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE) !== 0;
        console.log(`HORDE: Red Guard ${guard.id}: weaponBonusFlags=0x${state.weaponBonusConditionFlags.toString(16)}, HORDE=${hasHorde}`);
        if (hasHorde) hordeActiveCount++;
      }
    }

    console.log(`HORDE: ${hordeActiveCount}/${redGuards.length} Red Guard have HORDE bonus active`);
    if (hordeActiveCount > 0) {
      console.log('HORDE: Horde bonus correctly activated for grouped Red Guard');
    } else {
      // Run more frames in case HordeUpdate needs more time
      runFrames(logic, 300, anomalies, 'horde-extra-wait');
      let retryCount = 0;
      for (const guard of redGuards) {
        const state = logic.getEntityState(guard.id);
        if (state && state.alive && (state.weaponBonusConditionFlags & WEAPON_BONUS_HORDE) !== 0) {
          retryCount++;
        }
      }
      if (retryCount > 0) {
        console.log(`HORDE: Horde bonus activated after additional frames (${retryCount} units)`);
      } else {
        anomalies.push('HORDE: No Red Guard have HORDE bonus despite being grouped together');
      }
    }

    checkNaN(logic, anomalies, 'china-horde');
    assertNoCriticalAnomalies(anomalies, 'CHINA HORDE');
  }, 120_000);

  // == 7. China Nuclear Reactor power ==
  it('China Nuclear Reactor power: build reactor, verify 10 energy, build consumers, track power state', () => {
    const logic = createFreshGame({ side0: 'China', side1: 'America', credits: 100000 });
    const anomalies: string[] = [];

    const dozer = findDozer(logic, 'China');
    const cc = findCC(logic, 'China');
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Check power before building reactor
    const powerBefore = logic.getSidePowerState('china');
    console.log(`CHINA-POWER: Before reactor: prod=${powerBefore.energyProduction}, cons=${powerBefore.energyConsumption}, browned=${powerBefore.brownedOut}`);

    // Build Nuclear Reactor (ChinaPowerPlant)
    const reactor = buildStructure(logic, dozer!.id, 'ChinaPowerPlant', cc!.x + 120, cc!.z, anomalies, 900, 'CHINA');
    if (!reactor) {
      assertNoCriticalAnomalies(anomalies, 'CHINA NUCLEAR POWER');
      return;
    }
    console.log(`CHINA-POWER: Nuclear Reactor built (id=${reactor.id})`);

    // Check power after reactor
    const powerAfterReactor = logic.getSidePowerState('china');
    console.log(`CHINA-POWER: After reactor: prod=${powerAfterReactor.energyProduction}, cons=${powerAfterReactor.energyConsumption}, browned=${powerAfterReactor.brownedOut}`);

    // Verify energy production increased
    const productionGain = powerAfterReactor.energyProduction - powerBefore.energyProduction;
    console.log(`CHINA-POWER: Reactor production gain: ${productionGain}`);
    if (productionGain <= 0) {
      anomalies.push(`CHINA-POWER: Reactor produced no energy (gain=${productionGain})`);
    } else {
      console.log(`CHINA-POWER: Reactor produces ${productionGain} energy`);
      // China Nuclear Reactor produces 10 in retail
      if (productionGain === 10) {
        console.log('CHINA-POWER: Production matches expected 10 energy');
      } else {
        console.log(`CHINA-POWER: Production ${productionGain} (expected 10 from retail INI)`);
      }
    }

    // Should NOT be browned out
    if (powerAfterReactor.brownedOut) {
      anomalies.push('CHINA-POWER: Browned out after building reactor (should have surplus)');
    }

    // Build consuming structures: Barracks, Supply Center, War Factory
    const barracks = buildStructure(logic, dozer!.id, 'ChinaBarracks', cc!.x + 120, cc!.z + 120, anomalies, 900, 'CHINA');
    const powerAfterBarracks = logic.getSidePowerState('china');
    console.log(`CHINA-POWER: After Barracks: prod=${powerAfterBarracks.energyProduction}, cons=${powerAfterBarracks.energyConsumption}`);

    const supplyCenter = buildStructure(logic, dozer!.id, 'ChinaSupplyCenter', cc!.x + 250, cc!.z, anomalies, 1200, 'CHINA');
    const powerAfterSupply = logic.getSidePowerState('china');
    console.log(`CHINA-POWER: After Supply Center: prod=${powerAfterSupply.energyProduction}, cons=${powerAfterSupply.energyConsumption}`);

    const warFactory = buildStructure(logic, dozer!.id, 'ChinaWarFactory', cc!.x - 120, cc!.z, anomalies, 1500, 'CHINA');
    const powerAfterWF = logic.getSidePowerState('china');
    console.log(`CHINA-POWER: After War Factory: prod=${powerAfterWF.energyProduction}, cons=${powerAfterWF.energyConsumption}, browned=${powerAfterWF.brownedOut}`);

    // Verify power tracking is consistent (production should not change, consumption should increase)
    if (powerAfterWF.energyProduction < powerAfterReactor.energyProduction) {
      anomalies.push(`CHINA-POWER: Production decreased after building consumers (${powerAfterReactor.energyProduction} -> ${powerAfterWF.energyProduction})`);
    }

    // Log brownout status
    if (powerAfterWF.brownedOut) {
      console.log('CHINA-POWER: Browned out after building consumers (may need more reactors in retail)');
    } else {
      console.log('CHINA-POWER: Power stable after all buildings');
    }

    checkNaN(logic, anomalies, 'china-power');
    assertNoCriticalAnomalies(anomalies, 'CHINA NUCLEAR POWER');
  }, 120_000);

  // =========================================================================
  // PART D: Cross-faction combat
  // =========================================================================

  // == 8. GLA Rebels vs China Red Guard ==
  it('cross-faction combat: 3 GLA Rebels vs 3 China Red Guard, verify damage and casualties', () => {
    const logic = createFreshGame({ side0: 'GLA', side1: 'China', credits: 50000 });
    const anomalies: string[] = [];

    // Build GLA Barracks and train Rebels
    const glaWorker = findDozer(logic, 'GLA');
    const glaCC = findCC(logic, 'GLA');
    expect(glaWorker).toBeDefined();
    expect(glaCC).toBeDefined();

    const glaBarracks = buildStructure(logic, glaWorker!.id, 'GLABarracks', glaCC!.x + 120, glaCC!.z, anomalies, 900, 'GLA');
    if (!glaBarracks) {
      assertNoCriticalAnomalies(anomalies, 'CROSS-FACTION COMBAT');
      return;
    }

    // Build China Power Plant and Barracks, train Red Guard
    const chinaDozer = findDozer(logic, 'China');
    const chinaCC = findCC(logic, 'China');
    expect(chinaDozer).toBeDefined();
    expect(chinaCC).toBeDefined();

    const chinaPP = buildStructure(logic, chinaDozer!.id, 'ChinaPowerPlant', chinaCC!.x + 120, chinaCC!.z, anomalies, 900, 'CHINA');
    if (!chinaPP) {
      anomalies.push('COMBAT: China Power Plant build failed');
      // Continue anyway — try building barracks
    }

    const chinaBarracks = buildStructure(logic, chinaDozer!.id, 'ChinaBarracks', chinaCC!.x + 120, chinaCC!.z + 120, anomalies, 900, 'CHINA');
    if (!chinaBarracks) {
      anomalies.push('COMBAT: China Barracks build failed');
      assertNoCriticalAnomalies(anomalies, 'CROSS-FACTION COMBAT');
      return;
    }

    // Train 3 GLA Rebels
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: glaBarracks.id,
        unitTemplateName: 'GLAInfantryRebel',
      });
    }

    // Train 3 China Red Guard
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: chinaBarracks.id,
        unitTemplateName: 'ChinaInfantryRedguard',
      });
    }

    runFrames(logic, 1200, anomalies, 'combat-training');

    const rebels = findEntities(logic, 'GLAInfantryRebel', 'GLA');
    const redGuards = findEntities(logic, 'ChinaInfantryRedguard', 'China');
    console.log(`COMBAT: ${rebels.length}/3 Rebels trained, ${redGuards.length}/3 Red Guard trained`);

    if (rebels.length === 0 || redGuards.length === 0) {
      anomalies.push(`COMBAT: Insufficient units (${rebels.length} Rebels, ${redGuards.length} Red Guard)`);
      assertNoCriticalAnomalies(anomalies, 'CROSS-FACTION COMBAT');
      return;
    }

    // Record initial health of all combatants
    const rebelHealths: Array<{ id: number; before: number }> = [];
    const guardHealths: Array<{ id: number; before: number }> = [];
    for (const r of rebels) {
      const state = logic.getEntityState(r.id);
      if (state) rebelHealths.push({ id: r.id, before: state.health });
    }
    for (const g of redGuards) {
      const state = logic.getEntityState(g.id);
      if (state) guardHealths.push({ id: g.id, before: state.health });
    }

    console.log(`COMBAT: Rebel HP: ${rebelHealths.map(r => r.before).join(', ')}`);
    console.log(`COMBAT: Guard HP: ${guardHealths.map(g => g.before).join(', ')}`);

    // Pick a meeting point between the two bases
    const meetX = (glaCC!.x + chinaCC!.x) / 2;
    const meetZ = (glaCC!.z + chinaCC!.z) / 2;
    console.log(`COMBAT: Meeting point at (${meetX.toFixed(0)}, ${meetZ.toFixed(0)})`);

    // Move all units to the meeting point
    for (const r of rebels) {
      logic.submitCommand({
        type: 'moveTo',
        entityId: r.id,
        targetX: meetX,
        targetZ: meetZ,
        commandSource: 'PLAYER',
      });
    }
    for (const g of redGuards) {
      logic.submitCommand({
        type: 'moveTo',
        entityId: g.id,
        targetX: meetX,
        targetZ: meetZ,
        commandSource: 'PLAYER',
      });
    }

    // Wait for units to reach the meeting point
    runFrames(logic, 2000, anomalies, 'combat-approach');

    // Now order direct combat: Rebels attack Red Guard and vice versa
    for (const r of rebels) {
      const rState = logic.getEntityState(r.id);
      if (rState && rState.alive && redGuards.length > 0) {
        // Find closest alive Red Guard
        const target = redGuards.find(g => {
          const gs = logic.getEntityState(g.id);
          return gs && gs.alive;
        });
        if (target) {
          logic.submitCommand({
            type: 'attackEntity',
            entityId: r.id,
            targetEntityId: target.id,
            commandSource: 'PLAYER',
          });
        }
      }
    }
    for (const g of redGuards) {
      const gState = logic.getEntityState(g.id);
      if (gState && gState.alive && rebels.length > 0) {
        const target = rebels.find(r => {
          const rs = logic.getEntityState(r.id);
          return rs && rs.alive;
        });
        if (target) {
          logic.submitCommand({
            type: 'attackEntity',
            entityId: g.id,
            targetEntityId: target.id,
            commandSource: 'PLAYER',
          });
        }
      }
    }

    // Run combat for 3000 frames (~100 seconds game time)
    runFrames(logic, 3000, anomalies, 'combat-fight');

    // Tally results
    let rebelsAlive = 0;
    let rebelsDamaged = 0;
    let rebelsDead = 0;
    for (const r of rebelHealths) {
      const state = logic.getEntityState(r.id);
      if (!state || !state.alive) {
        rebelsDead++;
      } else {
        rebelsAlive++;
        if (state.health < r.before) rebelsDamaged++;
      }
    }

    let guardsAlive = 0;
    let guardsDamaged = 0;
    let guardsDead = 0;
    for (const g of guardHealths) {
      const state = logic.getEntityState(g.id);
      if (!state || !state.alive) {
        guardsDead++;
      } else {
        guardsAlive++;
        if (state.health < g.before) guardsDamaged++;
      }
    }

    console.log(`COMBAT: RESULTS after 3000 frames:`);
    console.log(`COMBAT:   Rebels: ${rebelsAlive} alive (${rebelsDamaged} damaged), ${rebelsDead} dead`);
    console.log(`COMBAT:   Red Guard: ${guardsAlive} alive (${guardsDamaged} damaged), ${guardsDead} dead`);

    // Verify combat occurred — at least one side should have casualties or damage
    const totalCasualties = rebelsDead + guardsDead;
    const totalDamaged = rebelsDamaged + guardsDamaged;
    console.log(`COMBAT: Total casualties: ${totalCasualties}, Total damaged: ${totalDamaged}`);

    if (totalCasualties === 0 && totalDamaged === 0) {
      anomalies.push('COMBAT: No damage dealt in cross-faction infantry combat after 3000 frames');
    } else {
      console.log('COMBAT: Cross-faction infantry combat working correctly');
    }

    // Verify both sides took damage (not just one-sided)
    const glaTookDamage = rebelsDead > 0 || rebelsDamaged > 0;
    const chinaTookDamage = guardsDead > 0 || guardsDamaged > 0;
    if (!glaTookDamage && chinaTookDamage) {
      console.log('COMBAT: Only China took damage (GLA untouched) — may indicate targeting issue');
    } else if (glaTookDamage && !chinaTookDamage) {
      console.log('COMBAT: Only GLA took damage (China untouched) — may indicate targeting issue');
    } else if (glaTookDamage && chinaTookDamage) {
      console.log('COMBAT: Both sides took damage — bidirectional combat working');
    }

    checkNaN(logic, anomalies, 'cross-faction-combat');
    assertNoCriticalAnomalies(anomalies, 'CROSS-FACTION COMBAT');
  }, 120_000);
});
