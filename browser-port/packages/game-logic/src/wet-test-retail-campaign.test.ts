/**
 * Retail Campaign Wet Test — loads actual retail campaign maps (MD_USA01, MD_CHI01, MD_GLA01)
 * and exercises map loading, entity spawning, script execution, and victory condition behavior.
 *
 * Campaign maps differ from skirmish maps:
 *   - Pre-placed armies, base structures, and scripted units (not just CC + dozer)
 *   - Rich sidesList with script-based victory/defeat triggers (not "all buildings destroyed")
 *   - Multiple AI-controlled sides with complex scripted behavior
 *
 * Each test skipIf the required map file does not exist (requires retail data).
 * Hard-fail on crashes, NaN positions, and critical invariant violations.
 */
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

const ASSETS_DIR = resolve(import.meta.dirname ?? __dirname, '../../app/public/assets');
const MAPS_DIR = resolve(ASSETS_DIR, 'maps/_extracted/MapsZH/Maps');

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let iniRegistry: IniDataRegistry;

function loadIniData(): boolean {
  try {
    const bundlePath = resolve(ASSETS_DIR, 'data/ini-bundle.json');
    const bundleJson = JSON.parse(readFileSync(bundlePath, 'utf-8'));
    iniRegistry = new IniDataRegistry();
    iniRegistry.loadBundle(bundleJson);
    return true;
  } catch {
    return false;
  }
}

const hasIniData = loadIniData();

function loadCampaignMap(mapName: string): MapDataJSON | null {
  const mapPath = resolve(MAPS_DIR, `${mapName}/${mapName}.json`);
  if (!existsSync(mapPath)) return null;
  try {
    return JSON.parse(readFileSync(mapPath, 'utf-8'));
  } catch {
    return null;
  }
}

// Preload campaign maps
const usaMap = hasIniData ? loadCampaignMap('MD_USA01') : null;
const chinaMap = hasIniData ? loadCampaignMap('MD_CHI01') : null;
const glaMap = hasIniData ? loadCampaignMap('MD_GLA01') : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Assert no NaN/CRASH anomalies (hard failures). Log others. */
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

/** Load a campaign map into the game engine. No skirmish spawn — campaign maps have pre-placed entities. */
function loadCampaignGame(mapData: MapDataJSON): GameLogicSubsystem {
  // Source parity: VictoryConditions::update() exits early for non-multiplayer.
  // Campaign missions use script-based victory/defeat exclusively.
  const logic = new GameLogicSubsystem(new THREE.Scene(), { isCampaignMode: true });
  const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
  logic.loadMapObjects(mapData, iniRegistry, heightmap);
  // Campaign maps define their own player sides via sidesList; do NOT call spawnSkirmishStartingEntities.
  // Set player side 0 to the FACTION side (e.g. "america"), not the player name (e.g. "The_Player").
  // Source parity: C++ Player objects resolve entities by ownership, not by name matching.
  // loadMapScripts populates scriptPlayerSideByName mapping player names to faction sides.
  if (mapData.sidesList) {
    const priv = logic as unknown as { scriptPlayerSideByName: Map<string, string> };
    for (let i = 0; i < mapData.sidesList.sides.length; i++) {
      const side = mapData.sidesList.sides[i];
      if (side?.dict?.playerIsHuman && side.dict.playerName) {
        const resolvedSide = priv.scriptPlayerSideByName.get(side.dict.playerName.trim().toUpperCase());
        logic.setPlayerSide(0, resolvedSide ?? side.dict.playerName);
        break;
      }
    }
  }
  // Initial update to process map objects
  logic.update(0);
  logic.update(1 / 30);
  return logic;
}

/** Access private mapScriptLists to count loaded scripts. */
function getScriptCounts(logic: GameLogicSubsystem): { totalSides: number; totalScripts: number; namedScripts: number } {
  const priv = logic as unknown as {
    mapScriptLists: Array<{ scripts: unknown[]; groups: Array<{ scripts: unknown[] }> }>;
    mapScriptsByNameUpper: Map<string, unknown>;
  };

  let totalScripts = 0;
  const totalSides = priv.mapScriptLists.length;
  for (const sl of priv.mapScriptLists) {
    totalScripts += sl.scripts.length;
    for (const g of sl.groups) {
      totalScripts += g.scripts.length;
    }
  }

  return {
    totalSides,
    totalScripts,
    namedScripts: priv.mapScriptsByNameUpper.size,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('retail campaign wet tests', () => {

  // =========================================================================
  // 1. USA Mission 1 (MD_USA01) — Load and simulate
  // =========================================================================
  it.skipIf(!usaMap)('USA Mission 1 (MD_USA01): load campaign map, verify data, run 500 frames', () => {
    const anomalies: string[] = [];
    const logic = loadCampaignGame(usaMap!);

    // Verify heightmap
    const heightmap = HeightmapGrid.fromJSON(usaMap!.heightmap);
    console.log(`USA01: Terrain dimensions: ${heightmap.width}x${heightmap.height}, spacing=${heightmap.spacing}`);
    expect(heightmap.width).toBeGreaterThan(50);
    expect(heightmap.height).toBeGreaterThan(50);

    // Verify entities loaded
    const entities = logic.getRenderableEntityStates();
    console.log(`USA01: ${entities.length} entities after load`);
    expect(entities.length).toBeGreaterThan(0);

    // Verify triggers exist
    expect(usaMap!.triggers.length).toBeGreaterThan(0);
    console.log(`USA01: ${usaMap!.triggers.length} polygon triggers`);

    // Check initial NaN
    checkNaN(logic, anomalies, 'usa01-after-load');

    // Run 500 frames
    const ok = runFrames(logic, 500, anomalies, 'usa01-simulation');
    checkNaN(logic, anomalies, 'usa01-after-500-frames');

    const entitiesAfter = logic.getRenderableEntityStates();
    console.log(`USA01: ${entitiesAfter.length} entities after 500 frames (started with ${entities.length})`);
    console.log(`USA01: Simulation completed: ${ok}`);

    assertNoCriticalAnomalies(anomalies, 'USA MISSION 1');
  }, 120_000);

  // =========================================================================
  // 2. China Mission 1 (MD_CHI01) — Load and simulate
  // =========================================================================
  it.skipIf(!chinaMap)('China Mission 1 (MD_CHI01): load campaign map, verify data, run 500 frames', () => {
    const anomalies: string[] = [];
    const logic = loadCampaignGame(chinaMap!);

    // Verify heightmap
    const heightmap = HeightmapGrid.fromJSON(chinaMap!.heightmap);
    console.log(`CHI01: Terrain dimensions: ${heightmap.width}x${heightmap.height}, spacing=${heightmap.spacing}`);
    expect(heightmap.width).toBeGreaterThan(50);
    expect(heightmap.height).toBeGreaterThan(50);

    // Verify entities loaded
    const entities = logic.getRenderableEntityStates();
    console.log(`CHI01: ${entities.length} entities after load`);
    expect(entities.length).toBeGreaterThan(0);

    // Verify triggers exist
    expect(chinaMap!.triggers.length).toBeGreaterThan(0);
    console.log(`CHI01: ${chinaMap!.triggers.length} polygon triggers`);

    // Check initial NaN
    checkNaN(logic, anomalies, 'chi01-after-load');

    // Run 500 frames
    const ok = runFrames(logic, 500, anomalies, 'chi01-simulation');
    checkNaN(logic, anomalies, 'chi01-after-500-frames');

    const entitiesAfter = logic.getRenderableEntityStates();
    console.log(`CHI01: ${entitiesAfter.length} entities after 500 frames (started with ${entities.length})`);
    console.log(`CHI01: Simulation completed: ${ok}`);

    assertNoCriticalAnomalies(anomalies, 'CHINA MISSION 1');
  }, 120_000);

  // =========================================================================
  // 3. GLA Mission 1 (MD_GLA01) — Load and simulate
  // =========================================================================
  it.skipIf(!glaMap)('GLA Mission 1 (MD_GLA01): load campaign map, verify data, run 500 frames', () => {
    const anomalies: string[] = [];
    const logic = loadCampaignGame(glaMap!);

    // Verify heightmap
    const heightmap = HeightmapGrid.fromJSON(glaMap!.heightmap);
    console.log(`GLA01: Terrain dimensions: ${heightmap.width}x${heightmap.height}, spacing=${heightmap.spacing}`);
    expect(heightmap.width).toBeGreaterThan(50);
    expect(heightmap.height).toBeGreaterThan(50);

    // Verify entities loaded
    const entities = logic.getRenderableEntityStates();
    console.log(`GLA01: ${entities.length} entities after load`);
    expect(entities.length).toBeGreaterThan(0);

    // Verify triggers exist
    expect(glaMap!.triggers.length).toBeGreaterThan(0);
    console.log(`GLA01: ${glaMap!.triggers.length} polygon triggers`);

    // Check initial NaN
    checkNaN(logic, anomalies, 'gla01-after-load');

    // Run 500 frames
    const ok = runFrames(logic, 500, anomalies, 'gla01-simulation');
    checkNaN(logic, anomalies, 'gla01-after-500-frames');

    const entitiesAfter = logic.getRenderableEntityStates();
    console.log(`GLA01: ${entitiesAfter.length} entities after 500 frames (started with ${entities.length})`);
    console.log(`GLA01: Simulation completed: ${ok}`);

    assertNoCriticalAnomalies(anomalies, 'GLA MISSION 1');
  }, 120_000);

  // =========================================================================
  // 4. Campaign script execution — USA Mission 1 scripts loaded and processed
  // =========================================================================
  it.skipIf(!usaMap)('Campaign script execution: USA01 scripts load and process 1000 frames without crash', () => {
    const anomalies: string[] = [];
    const logic = loadCampaignGame(usaMap!);

    // Verify scripts loaded
    const scriptCounts = getScriptCounts(logic);
    console.log(`SCRIPTS: ${scriptCounts.totalSides} sides with script lists`);
    console.log(`SCRIPTS: ${scriptCounts.totalScripts} total scripts across all sides`);
    console.log(`SCRIPTS: ${scriptCounts.namedScripts} uniquely named scripts`);

    expect(scriptCounts.totalScripts).toBeGreaterThan(0);

    // Run 1000 frames — scripts execute every frame via executeMapScripts
    const ok = runFrames(logic, 1000, anomalies, 'scripts-1000-frames');
    checkNaN(logic, anomalies, 'scripts-after-1000-frames');

    const entities = logic.getRenderableEntityStates();
    console.log(`SCRIPTS: ${entities.length} entities after 1000 frames`);
    console.log(`SCRIPTS: Script engine completed 1000 frames: ${ok}`);

    // Verify game is still running (not crashed/halted)
    expect(entities.length).toBeGreaterThan(0);

    // Check script counters are being tracked (campaign scripts use counters like MissionStage)
    const priv = logic as unknown as {
      scriptCountersByName: Map<string, { value: number; isCountdownTimer: boolean }>;
      scriptFlagsByName: Map<string, boolean>;
    };
    console.log(`SCRIPTS: ${priv.scriptCountersByName.size} script counters active`);
    console.log(`SCRIPTS: ${priv.scriptFlagsByName.size} script flags active`);
    for (const [name, counter] of priv.scriptCountersByName) {
      console.log(`SCRIPTS:   counter "${name}" = ${counter.value} (countdown=${counter.isCountdownTimer})`);
    }
    for (const [name, value] of priv.scriptFlagsByName) {
      console.log(`SCRIPTS:   flag "${name}" = ${value}`);
    }

    assertNoCriticalAnomalies(anomalies, 'CAMPAIGN SCRIPT EXECUTION');
  }, 120_000);

  // =========================================================================
  // 5. Campaign entity spawning — pre-placed armies far exceed CC + dozer
  // =========================================================================
  it.skipIf(!usaMap)('Campaign entity spawning: pre-placed armies exceed minimal skirmish spawn', () => {
    const logic = loadCampaignGame(usaMap!);
    const entities = logic.getRenderableEntityStates();

    // A skirmish map starts with ~2 entities per side (CC + dozer) = ~4 total.
    // Campaign maps have pre-placed armies, base structures, terrain objects, etc.
    // MD_USA01 has ~3134 objects in the JSON; many spawn as entities.
    console.log(`SPAWN: Total entities: ${entities.length}`);

    // Count resolved (known INI template) vs unresolved entities
    const resolved = entities.filter(e => e.resolved);
    const unresolved = entities.filter(e => !e.resolved);
    console.log(`SPAWN: ${resolved.length} resolved, ${unresolved.length} unresolved`);

    // Count military entities by looking for known faction prefixes
    const militaryPrefixes = ['America', 'China', 'GLA', 'CINE_'];
    const militaryEntities = entities.filter(e =>
      militaryPrefixes.some(p => e.templateName.startsWith(p)),
    );
    console.log(`SPAWN: ${militaryEntities.length} military/faction entities`);

    // Campaign-specific: count distinct template names to show variety
    const uniqueTemplates = new Set(entities.map(e => e.templateName));
    console.log(`SPAWN: ${uniqueTemplates.size} unique template names`);

    // Count entities by side
    const sideMap = new Map<string, number>();
    for (const e of entities) {
      const side = e.side?.toUpperCase() ?? '(neutral)';
      sideMap.set(side, (sideMap.get(side) ?? 0) + 1);
    }
    for (const [side, count] of sideMap) {
      console.log(`SPAWN:   ${side}: ${count} entities`);
    }

    // The campaign map MUST have significantly more entities than a bare skirmish spawn.
    // Even after filtering out props/sound/terrain objects, there should be dozens of military units.
    expect(entities.length).toBeGreaterThan(10);
    // Must have more than just 4 entities (CC + dozer x 2 sides)
    expect(militaryEntities.length).toBeGreaterThan(4);
  }, 120_000);

  // =========================================================================
  // 6. Campaign victory conditions — game does NOT end immediately
  // =========================================================================
  it.skipIf(!usaMap)('Campaign victory conditions: getGameEndState does not trigger immediately', () => {
    const anomalies: string[] = [];
    const logic = loadCampaignGame(usaMap!);

    // Immediately after load, game should NOT be over
    const endStateImmediate = logic.getGameEndState();
    console.log(`VICTORY: Immediate end state: ${endStateImmediate ? JSON.stringify(endStateImmediate) : 'null (game active)'}`);
    expect(endStateImmediate).toBeNull();

    // Run 100 frames — still should not trigger victory/defeat
    runFrames(logic, 100, anomalies, 'victory-100-frames');
    const endState100 = logic.getGameEndState();
    console.log(`VICTORY: End state after 100 frames: ${endState100 ? JSON.stringify(endState100) : 'null (game active)'}`);
    expect(endState100).toBeNull();

    // Run 500 more frames — campaign victory is script-based, should NOT trigger from
    // the default "all buildings destroyed" check because isCampaignMode suppresses it.
    // Source parity: VictoryConditions::update() exits early for non-multiplayer.
    runFrames(logic, 500, anomalies, 'victory-600-frames');
    const endState600 = logic.getGameEndState();
    console.log(`VICTORY: End state after 600 frames: ${endState600 ? JSON.stringify(endState600) : 'null (game active)'}`);

    // Campaign mode must suppress default victory checking — game should still be active.
    // Only script-triggered victory/defeat (LOCAL_VICTORY/LOCAL_DEFEAT actions) can end
    // the game in campaign mode, and those require specific scripted conditions to be met.
    expect(endState600).toBeNull();

    // Verify the game is still functional (entities exist, no crashes)
    const entities = logic.getRenderableEntityStates();
    expect(entities.length).toBeGreaterThan(0);

    checkNaN(logic, anomalies, 'victory-conditions');
    assertNoCriticalAnomalies(anomalies, 'CAMPAIGN VICTORY CONDITIONS');
  }, 120_000);
});
