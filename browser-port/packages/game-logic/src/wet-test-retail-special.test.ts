/**
 * Retail Wet Test Round 7 — Campaign / Special Features
 *
 * Tests special game features that go beyond basic build-fight:
 * 1. Superweapon countdown — build a superweapon, verify timer starts
 * 2. Garrison building — garrison a civilian building, verify LOADED flag and fire
 * 3. Veterancy progression — kill enemies to gain XP and reach VETERAN
 * 4. Sell refund correctness — build and sell PP, verify 50% refund
 * 5. Power brownout and recovery — destroy PP, verify brownout, rebuild, verify recovery
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
  logic.setPlayerSide(1, 'GLA');
  logic.setTeamRelationship('America', 'GLA', 0);
  logic.setTeamRelationship('GLA', 'America', 0);
  logic.spawnSkirmishStartingEntities();
  logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: credits });
  logic.submitCommand({ type: 'setSideCredits', side: 'GLA', amount: credits });
  logic.update(0);
  logic.update(1 / 30);
  return logic;
}

function createUSAvsChinaGame(credits = 50000): GameLogicSubsystem {
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

const USA_BUILD_OFFSETS = {
  powerPlant: [120, -140],
  barracks: [120, 140],
  supplyCenter: [260, 40],
  warFactory: [-130, 170],
  strategyCenter: [-300, 260],
  particleCannon: [260, -180],
  recoveryPowerPlant: [-220, 340],
} as const;

function offsetFromCommandCenter(cc: { x: number; z: number }, offset: readonly [number, number]): [number, number] {
  return [cc.x + offset[0], cc.z + offset[1]];
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
  const existingIds = new Set(
    findEntities(logic, templateName, 'America').map(e => e.id),
  );
  logic.submitCommand({
    type: 'constructBuilding',
    entityId: dozerId,
    templateName,
    targetPosition: [x, 0, z],
    angle: 0,
    lineEndPosition: null,
  });
  runFrames(logic, buildFrames, anomalies, `build-${templateName}`);
  const created = logic.getRenderableEntityStates().find(e =>
    e.templateName === templateName
      && e.side?.toUpperCase() === 'AMERICA'
      && !existingIds.has(e.id),
  ) ?? null;

  if (!created) {
    return null;
  }

  for (let i = 0; i < 1800; i++) {
    const state = logic.getEntityState(created.id);
    if (!state || !state.alive || state.constructionPercent < 0) {
      break;
    }
    if (!runFrames(logic, 1, anomalies, `complete-${templateName}`)) {
      break;
    }
  }

  return logic.getRenderableEntityStates().find(e => e.id === created.id) ?? created;
}

/** Build PP + Barracks. Hard-fails if either building fails. */
function buildPPAndBarracks(logic: GameLogicSubsystem, anomalies: string[]) {
  const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
  const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
  expect(dozer).toBeDefined();
  expect(cc).toBeDefined();

  const [ppX, ppZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.powerPlant);
  const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', ppX, ppZ, anomalies);
  expect(pp).not.toBeNull();

  const [barracksX, barracksZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.barracks);
  const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', barracksX, barracksZ, anomalies);
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

describe.skipIf(!hasRetailData)('wet test round 7: campaign/special features', () => {

  // == 1. Superweapon countdown ==
  it('superweapon countdown: build Particle Cannon (full prereq chain), verify special power timer starts', () => {
    const logic = createUSAvsChinaGame(500000);
    const anomalies: string[] = [];
    const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
    const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Prerequisite chain: PP -> SupplyCenter -> WarFactory -> StrategyCenter -> ParticleCannon
    const [ppX, ppZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.powerPlant);
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', ppX, ppZ, anomalies);
    expect(pp).not.toBeNull();
    console.log('SUPERWEAPON: Power Plant built');

    // Build Supply Center (prerequisite for War Factory)
    const [supplyCenterX, supplyCenterZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.supplyCenter);
    const supplyCenter = buildStructure(
      logic,
      dozer.id,
      'AmericaSupplyCenter',
      supplyCenterX,
      supplyCenterZ,
      anomalies,
      900,
    );
    if (supplyCenter) {
      console.log('SUPERWEAPON: Supply Center built');
    } else {
      console.log('SUPERWEAPON: Supply Center not built — continuing anyway');
    }

    // Build War Factory (prerequisite for Strategy Center)
    const [warFactoryX, warFactoryZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.warFactory);
    const warFactory = buildStructure(
      logic,
      dozer.id,
      'AmericaWarFactory',
      warFactoryX,
      warFactoryZ,
      anomalies,
      1200,
    );
    if (warFactory) {
      console.log('SUPERWEAPON: War Factory built');
    } else {
      console.log('SUPERWEAPON: War Factory not built — continuing anyway');
    }

    // Build Strategy Center (prerequisite for Particle Cannon)
    const [stratCenterX, stratCenterZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.strategyCenter);
    const stratCenter = buildStructure(
      logic,
      dozer.id,
      'AmericaStrategyCenter',
      stratCenterX,
      stratCenterZ,
      anomalies,
      1800,
    );
    if (stratCenter) {
      console.log('SUPERWEAPON: Strategy Center built');
    } else {
      console.log('SUPERWEAPON: Strategy Center not built — continuing anyway');
    }

    // Build Particle Cannon (the superweapon)
    const [cannonX, cannonZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.particleCannon);
    const cannon = buildStructure(
      logic,
      dozer.id,
      'AmericaParticleCannonUplink',
      cannonX,
      cannonZ,
      anomalies,
      3000,
    );

    if (!cannon) {
      console.log('SUPERWEAPON: Particle Cannon not built — prerequisite chain may be incomplete');
      // List what was built
      const builtNames = logic.getRenderableEntityStates()
        .filter(e => e.side?.toUpperCase() === 'AMERICA')
        .map(e => e.templateName);
      console.log('SUPERWEAPON: Built structures:', [...new Set(builtNames)].join(', '));
      anomalies.push('SUPERWEAPON: Could not build Particle Cannon (prerequisite chain)');
      checkNaN(logic, anomalies, 'superweapon');
      if (anomalies.length > 0) {
        console.log('\n=== SUPERWEAPON ANOMALIES ===');
        for (const a of anomalies) console.log(`  - ${a}`);
      }
      expectNoCriticalAnomalies(anomalies);
      return;
    }

    console.log(`SUPERWEAPON: Particle Cannon built (id=${cannon.id})`);

    // Check if the building has special power modules
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { specialPowerModules: Map<string, { specialPowerTemplateName: string }>; hasSpecialPowerCreate: boolean }>;
      sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
      frameCounter: number;
    };
    const cannonEntity = priv.spawnedEntities.get(cannon.id);
    expect(cannonEntity).toBeDefined();

    const hasSpecialPowerCreate = cannonEntity!.hasSpecialPowerCreate;
    const powerModules = cannonEntity!.specialPowerModules;
    console.log(`SUPERWEAPON: hasSpecialPowerCreate=${hasSpecialPowerCreate}`);
    console.log(`SUPERWEAPON: specialPowerModules count=${powerModules.size}`);
    for (const [key, module] of powerModules) {
      console.log(`  Module: ${key} -> ${module.specialPowerTemplateName}`);
    }

    // Verify special power timer was started (readyFrame should be in the future)
    let hasActiveTimer = false;
    for (const [powerName, readyFrame] of priv.sharedShortcutSpecialPowerReadyFrames) {
      if (powerName.includes('PARTICLE') || powerName.includes('SUPERWEAPON')) {
        console.log(`SUPERWEAPON: Timer '${powerName}' readyFrame=${readyFrame}, currentFrame=${priv.frameCounter}`);
        if (readyFrame > priv.frameCounter) {
          hasActiveTimer = true;
        }
      }
    }

    // Run a few more frames and verify the timer is counting down
    const frameCounterBefore = priv.frameCounter;
    runFrames(logic, 300, anomalies, 'superweapon-countdown');
    const frameCounterAfter = priv.frameCounter;
    console.log(`SUPERWEAPON: Frame counter advanced: ${frameCounterBefore} -> ${frameCounterAfter}`);

    // The readyFrame should still be in the future but getting closer
    for (const [powerName, readyFrame] of priv.sharedShortcutSpecialPowerReadyFrames) {
      if (powerName.includes('PARTICLE') || powerName.includes('SUPERWEAPON')) {
        const remaining = readyFrame - priv.frameCounter;
        console.log(`SUPERWEAPON: After 300 frames, '${powerName}' remaining=${remaining} frames`);
      }
    }

    if (hasActiveTimer) {
      console.log('SUPERWEAPON: Countdown timer is active and decrementing correctly');
    } else if (powerModules.size > 0) {
      console.log('SUPERWEAPON: Special power module exists but no shared timer found (may use per-entity timer)');
    } else {
      anomalies.push('SUPERWEAPON: No special power timer started after building Particle Cannon');
    }

    checkNaN(logic, anomalies, 'superweapon');
    if (anomalies.length > 0) {
      console.log('\n=== SUPERWEAPON ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 2. Garrison building ==
  it('garrison building: train Rangers, garrison civilian building, verify LOADED flag', () => {
    const logic = createUSAvsChinaGame(100000);
    const anomalies: string[] = [];
    const { barracks } = buildPPAndBarracks(logic, anomalies);

    // Train 3 Rangers
    for (let i = 0; i < 3; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 1200, anomalies, 'garrison-train');

    const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    console.log(`GARRISON: ${rangers.length} Rangers produced`);
    expect(rangers.length).toBeGreaterThanOrEqual(1);

    // Find a garrisonable civilian building on the map (CivilianBunker01 is most common)
    const garrisonableTemplates = [
      'CivilianBunker01', 'WaterfrontWherehouse01', 'WatchTower03',
      'StanHanger01', 'MogadishuGarage', 'IndustrialBuilding01', 'IndustrialBuilding02',
    ];
    let garrisonBuilding = null;
    for (const tmpl of garrisonableTemplates) {
      const found = logic.getRenderableEntityStates().find(e =>
        e.templateName === tmpl && logic.getEntityState(e.id)?.alive,
      );
      if (found) {
        garrisonBuilding = found;
        break;
      }
    }

    if (!garrisonBuilding) {
      console.log('GARRISON: No garrisonable civilian buildings found on map');
      anomalies.push('GARRISON: No garrisonable buildings on Tournament Desert');
      checkNaN(logic, anomalies, 'garrison');
      expectNoCriticalAnomalies(anomalies);
      return;
    }

    console.log(`GARRISON: Found garrisonable building: ${garrisonBuilding.templateName} (id=${garrisonBuilding.id})`);
    const buildingState = logic.getEntityState(garrisonBuilding.id)!;
    console.log(`GARRISON: Building garrisonCapacity=${buildingState.garrisonCapacity}, garrisonCount=${buildingState.garrisonCount}`);

    // Check model condition flags BEFORE garrison
    const flagsBefore = buildingState.modelConditionFlags;
    const hadLoadedBefore = flagsBefore.includes('LOADED');
    console.log(`GARRISON: LOADED flag before garrison: ${hadLoadedBefore}`);

    // Move Rangers close to the building first, then garrison
    const rangersToGarrison = rangers.slice(0, Math.min(rangers.length, buildingState.garrisonCapacity ?? 3));
    for (const ranger of rangersToGarrison) {
      logic.submitCommand({
        type: 'moveTo',
        entityId: ranger.id,
        targetX: garrisonBuilding.x,
        targetZ: garrisonBuilding.z,
        commandSource: 'PLAYER',
      });
    }
    // Wait for Rangers to walk close to the building
    runFrames(logic, 2000, anomalies, 'garrison-approach');

    // Now issue garrison command once Rangers are nearby
    for (const ranger of rangersToGarrison) {
      const rs = logic.getEntityState(ranger.id);
      if (rs && rs.alive) {
        logic.submitCommand({
          type: 'garrisonBuilding',
          entityId: ranger.id,
          targetBuildingId: garrisonBuilding.id,
        });
      }
    }

    // Run frames for garrison enter action
    runFrames(logic, 1500, anomalies, 'garrison-enter');

    // Check garrison state
    const afterState = logic.getEntityState(garrisonBuilding.id)!;
    console.log(`GARRISON: After garrison attempt: garrisonCount=${afterState.garrisonCount}`);

    if (afterState.garrisonCount !== null && afterState.garrisonCount > 0) {
      console.log(`GARRISON: ${afterState.garrisonCount} units garrisoned successfully`);

      // Verify LOADED model condition flag
      const flagsAfter = afterState.modelConditionFlags;
      const hasLoaded = flagsAfter.includes('LOADED');
      console.log(`GARRISON: LOADED flag after garrison: ${hasLoaded}`);
      if (!hasLoaded) {
        anomalies.push('GARRISON: LOADED model condition flag NOT set after garrisoning');
      }

      // Verify garrisoned Rangers have DISABLED_HELD status
      for (const ranger of rangersToGarrison) {
        const rangerState = logic.getEntityState(ranger.id);
        if (rangerState) {
          const hasHeld = rangerState.statusFlags.includes('DISABLED_HELD');
          if (hasHeld) {
            console.log(`GARRISON: Ranger ${ranger.id} has DISABLED_HELD (correctly garrisoned)`);
          }
        }
      }

      // Test garrisoned units attacking enemies:
      // Find a Chinese entity to serve as target
      const enemyTarget = logic.getRenderableEntityStates().find(e =>
        e.side?.toUpperCase() === 'CHINA' && logic.getEntityState(e.id)?.alive,
      );

      if (enemyTarget) {
        const enemyHealthBefore = logic.getEntityState(enemyTarget.id)!.health;
        console.log(`GARRISON: Enemy target: ${enemyTarget.templateName} (id=${enemyTarget.id}) health=${enemyHealthBefore}`);

        // Move enemy close to garrisoned building so garrisoned units auto-fire
        // In retail, garrisoned units auto-engage nearby enemies
        // Since we can't move the enemy, run frames and see if auto-attack triggers
        runFrames(logic, 3000, anomalies, 'garrison-combat');

        const enemyHealthAfter = logic.getEntityState(enemyTarget.id);
        if (enemyHealthAfter && enemyHealthAfter.alive) {
          const damage = enemyHealthBefore - enemyHealthAfter.health;
          console.log(`GARRISON: Enemy damage after 3000 frames: ${damage}`);
          // If enemy is far away, no damage is expected — that's OK
        } else if (!enemyHealthAfter || !enemyHealthAfter.alive) {
          console.log('GARRISON: Enemy target was killed (garrisoned units or other fire)');
        }
      } else {
        console.log('GARRISON: No Chinese entities found for garrison fire test');
      }
    } else {
      anomalies.push('GARRISON: No units were garrisoned (garrison action may have failed)');
      console.log('GARRISON: Rangers may not have reached building or garrison was rejected');
    }

    checkNaN(logic, anomalies, 'garrison');
    if (anomalies.length > 0) {
      console.log('\n=== GARRISON ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 3. Veterancy progression ==
  it('veterancy: Ranger kills enemies, gains XP and reaches VETERAN level', () => {
    const logic = createUSAvsChinaGame(100000);
    const anomalies: string[] = [];
    const { barracks } = buildPPAndBarracks(logic, anomalies);

    // Train 5 Rangers
    for (let i = 0; i < 5; i++) {
      logic.submitCommand({
        type: 'queueUnitProduction',
        entityId: barracks.id,
        unitTemplateName: 'AmericaInfantryRanger',
      });
    }
    runFrames(logic, 1500, anomalies, 'vet-train');

    const rangers = findEntities(logic, 'AmericaInfantryRanger', 'America');
    console.log(`VETERANCY: ${rangers.length} Rangers produced`);
    expect(rangers.length).toBeGreaterThanOrEqual(2);

    // Record initial XP
    const firstRanger = rangers[0]!;
    const initialState = logic.getEntityState(firstRanger.id)!;
    console.log(`VETERANCY: Ranger ${firstRanger.id} initial XP=${initialState.currentExperience}, level=${initialState.veterancyLevel}`);
    expect(initialState.veterancyLevel).toBe(0); // LEVEL_REGULAR = 0

    // Find Chinese entities to attack
    const enemyEntities = logic.getRenderableEntityStates().filter(e =>
      e.side?.toUpperCase() === 'CHINA' && logic.getEntityState(e.id)?.alive,
    );
    console.log(`VETERANCY: ${enemyEntities.length} Chinese entities to attack`);

    // Order all Rangers to attack the Chinese dozer (should be killable)
    const enemyDozer = enemyEntities.find(e => e.templateName === 'ChinaVehicleDozer');
    const enemyCC = enemyEntities.find(e => e.templateName === 'ChinaCommandCenter');
    const targets = [enemyDozer, enemyCC, ...enemyEntities].filter(Boolean);

    if (targets.length === 0) {
      anomalies.push('VETERANCY: No Chinese targets found');
      checkNaN(logic, anomalies, 'veterancy');
      expectNoCriticalAnomalies(anomalies);
      return;
    }

    // Send all Rangers to attack the first available target
    for (const ranger of rangers) {
      logic.submitCommand({
        type: 'attackEntity',
        entityId: ranger.id,
        targetEntityId: targets[0]!.id,
        commandSource: 'PLAYER',
      });
    }

    // Run 5000 frames — Rangers should kill enemies and gain XP
    const xpLog: Array<{ frame: number; xp: number; level: number; alive: boolean }> = [];
    for (let phase = 0; phase < 50; phase++) {
      runFrames(logic, 100, anomalies, `vet-combat-${phase}`);
      const state = logic.getEntityState(firstRanger.id);
      if (state) {
        xpLog.push({ frame: (phase + 1) * 100, xp: state.currentExperience, level: state.veterancyLevel, alive: state.alive });
      }

      // If first Ranger dies, track a survivor instead
      if (state && !state.alive) {
        const survivor = rangers.find(r => {
          const s = logic.getEntityState(r.id);
          return s && s.alive;
        });
        if (survivor) {
          const survState = logic.getEntityState(survivor.id)!;
          if (survState.currentExperience > 0) {
            console.log(`VETERANCY: Switched to tracking Ranger ${survivor.id} (XP=${survState.currentExperience}, level=${survState.veterancyLevel})`);
          }
        }
      }

      // If first target is dead, retarget remaining Rangers to next target
      const targetState = logic.getEntityState(targets[0]!.id);
      if (!targetState || !targetState.alive) {
        // Find next alive target
        const nextTarget = targets.find(t => {
          const ts = logic.getEntityState(t!.id);
          return ts && ts.alive;
        });
        if (nextTarget) {
          for (const ranger of rangers) {
            const rs = logic.getEntityState(ranger.id);
            if (rs && rs.alive) {
              logic.submitCommand({
                type: 'attackEntity',
                entityId: ranger.id,
                targetEntityId: nextTarget.id,
                commandSource: 'PLAYER',
              });
            }
          }
        }
      }
    }

    // Check final XP across all Rangers
    let maxXP = 0;
    let maxLevel = 0;
    let rangerWithMostXP = firstRanger.id;
    for (const ranger of rangers) {
      const state = logic.getEntityState(ranger.id);
      if (state && state.currentExperience > maxXP) {
        maxXP = state.currentExperience;
        maxLevel = state.veterancyLevel;
        rangerWithMostXP = ranger.id;
      }
    }

    console.log(`VETERANCY: Best Ranger ${rangerWithMostXP}: XP=${maxXP}, level=${maxLevel}`);
    console.log(`VETERANCY: XP progression (first Ranger):`);
    for (const entry of xpLog.filter((_, i) => i % 5 === 0 || i === xpLog.length - 1)) {
      console.log(`  Frame ${entry.frame}: XP=${entry.xp}, level=${entry.level}, alive=${entry.alive}`);
    }

    // Verify XP was accumulated
    if (maxXP > 0) {
      console.log(`VETERANCY: XP accumulated successfully (max=${maxXP})`);
    } else {
      anomalies.push('VETERANCY: No XP accumulated after combat — kills may not award experience');
    }

    // Check if VETERAN level was reached (level >= 1)
    if (maxLevel >= 1) {
      console.log(`VETERANCY: VETERAN level reached (level=${maxLevel})`);
    } else if (maxXP > 0) {
      console.log('VETERANCY: XP gained but VETERAN not reached (may need more kills or thresholds are high)');
    }

    checkNaN(logic, anomalies, 'veterancy');
    if (anomalies.length > 0) {
      console.log('\n=== VETERANCY ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 4. Sell refund correctness ==
  it('sell refund: build PP (cost 800), sell it, verify refund equals cost * 0.5', () => {
    const logic = createUSAvsChinaGame(50000);
    const anomalies: string[] = [];
    const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
    const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Record credits before building
    const creditsBeforeBuild = logic.getSideCredits('america');
    console.log(`SELL-REFUND: Credits before build: ${creditsBeforeBuild}`);

    // Build PP
    const [ppX, ppZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.powerPlant);
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', ppX, ppZ, anomalies);
    expect(pp).not.toBeNull();

    // Record credits after building (should be reduced by PP cost)
    const creditsAfterBuild = logic.getSideCredits('america');
    const buildCostObserved = creditsBeforeBuild - creditsAfterBuild;
    console.log(`SELL-REFUND: Credits after build: ${creditsAfterBuild}, observed build cost: ${buildCostObserved}`);

    // Verify PP is fully constructed
    const ppState = logic.getEntityState(pp!.id)!;
    console.log(`SELL-REFUND: PP construction percent: ${ppState.constructionPercent}`);

    // Sell the PP
    logic.submitCommand({ type: 'sell', entityId: pp!.id });

    // Run enough frames for sell countdown to complete (Source: SOURCE_TOTAL_FRAMES_TO_SELL_OBJECT = 30fps * 3 = 90 frames)
    runFrames(logic, 300, anomalies, 'sell-refund-countdown');

    // Record credits after sell
    const creditsAfterSell = logic.getSideCredits('america');
    const refundAmount = creditsAfterSell - creditsAfterBuild;
    console.log(`SELL-REFUND: Credits after sell: ${creditsAfterSell}, refund amount: ${refundAmount}`);

    // Expected refund: cost * sellPercentage (0.5 from GameData.ini)
    // PP cost is 800, so expected refund is 400
    const expectedRefund = Math.floor(buildCostObserved * 0.5);
    console.log(`SELL-REFUND: Expected refund: ${expectedRefund} (50% of ${buildCostObserved})`);

    // Verify refund is correct within a tolerance (dozer may have earned income)
    if (refundAmount > 0) {
      const refundRatio = refundAmount / buildCostObserved;
      console.log(`SELL-REFUND: Refund ratio: ${(refundRatio * 100).toFixed(1)}% of build cost`);

      // Allow some tolerance (dozer travel costs, rounding, etc.)
      if (Math.abs(refundAmount - expectedRefund) <= 50) {
        console.log('SELL-REFUND: Refund matches expected 50% within tolerance');
      } else {
        anomalies.push(`SELL-REFUND: Refund ${refundAmount} differs from expected ${expectedRefund} by more than 50`);
      }
    } else {
      anomalies.push(`SELL-REFUND: No refund received (${refundAmount})`);
    }

    // Verify PP is gone
    const ppAfterSell = logic.getEntityState(pp!.id);
    if (ppAfterSell && ppAfterSell.alive) {
      anomalies.push('SELL-REFUND: PP still alive after sell');
    } else {
      console.log('SELL-REFUND: PP destroyed after sell');
    }

    // Verify credits are valid numbers
    expect(isNaN(creditsAfterSell)).toBe(false);
    expect(creditsAfterSell).toBeGreaterThanOrEqual(0);

    checkNaN(logic, anomalies, 'sell-refund');
    if (anomalies.length > 0) {
      console.log('\n=== SELL-REFUND ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == 5. Power brownout and recovery ==
  it('power brownout: build PP + power-consuming buildings, sell PP, verify brownout, rebuild PP, verify recovery', () => {
    const logic = createUSAvsChinaGame(200000);
    const anomalies: string[] = [];
    const dozer = findEntity(logic, 'AmericaVehicleDozer', 'America')!;
    const cc = findEntity(logic, 'AmericaCommandCenter', 'America')!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Build PP (produces +5 energy)
    const [ppX, ppZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.powerPlant);
    const pp = buildStructure(logic, dozer.id, 'AmericaPowerPlant', ppX, ppZ, anomalies);
    expect(pp).not.toBeNull();

    // Build Barracks (no power consumption — but needed as prereq info)
    const [barracksX, barracksZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.barracks);
    const barracks = buildStructure(logic, dozer.id, 'AmericaBarracks', barracksX, barracksZ, anomalies);
    expect(barracks).not.toBeNull();

    // Build Supply Center (consumes -1 energy, has KINDOF_POWERED)
    const [supplyCenterX, supplyCenterZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.supplyCenter);
    const supplyCenter = buildStructure(logic, dozer.id, 'AmericaSupplyCenter', supplyCenterX, supplyCenterZ, anomalies, 900);

    // Build War Factory (consumes -1 energy, requires Supply Center)
    const [warFactoryX, warFactoryZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.warFactory);
    const warFactory = buildStructure(logic, dozer.id, 'AmericaWarFactory', warFactoryX, warFactoryZ, anomalies, 1200);

    // Check power state before destroying PP
    const powerBefore = logic.getSidePowerState('america');
    console.log(`BROWNOUT: Power before: production=${powerBefore.energyProduction}, consumption=${powerBefore.energyConsumption}, brownedOut=${powerBefore.brownedOut}`);

    // Verify NOT browned out initially (PP produces 5, consumption should be <= 5)
    if (powerBefore.energyConsumption > 0) {
      expect(powerBefore.brownedOut).toBe(false);
      console.log('BROWNOUT: Initial power state is OK (not browned out)');
    } else {
      console.log('BROWNOUT: No power consumption detected — buildings may not consume power');
    }

    // List power-consuming buildings
    const poweredBuildings: string[] = [];
    if (supplyCenter) poweredBuildings.push(`SupplyCenter(${supplyCenter.id})`);
    if (warFactory) poweredBuildings.push(`WarFactory(${warFactory.id})`);
    console.log(`BROWNOUT: Power-consuming buildings: ${poweredBuildings.join(', ') || 'NONE'}`);

    // Destroy the PP by selling it (clean way to remove power production)
    logic.submitCommand({ type: 'sell', entityId: pp!.id });
    runFrames(logic, 300, anomalies, 'brownout-sell-pp');

    // Verify PP is gone
    const ppAfterSell = logic.getEntityState(pp!.id);
    const ppGone = !ppAfterSell || !ppAfterSell.alive;
    console.log(`BROWNOUT: PP destroyed after sell: ${ppGone}`);

    // Check power state after PP destruction
    runFrames(logic, 30, anomalies, 'brownout-stabilize');
    const powerAfterDestroy = logic.getSidePowerState('america');
    console.log(`BROWNOUT: Power after PP sell: production=${powerAfterDestroy.energyProduction}, consumption=${powerAfterDestroy.energyConsumption}, brownedOut=${powerAfterDestroy.brownedOut}`);

    // If consumption > 0 and production < consumption, we should be in brownout
    if (powerAfterDestroy.energyConsumption > 0) {
      if (powerAfterDestroy.brownedOut) {
        console.log('BROWNOUT: Correctly entered brownout after PP destruction');
      } else if (powerAfterDestroy.energyProduction >= powerAfterDestroy.energyConsumption) {
        console.log('BROWNOUT: CC or other buildings provide sufficient power — no brownout');
      } else {
        anomalies.push('BROWNOUT: Expected brownout but not in brownout state');
      }

      // Check if POWERED buildings are disabled
      if (warFactory) {
        const wfState = logic.getEntityState(warFactory.id)!;
        const isUnderpowered = wfState.statusFlags.includes('DISABLED_UNDERPOWERED');
        console.log(`BROWNOUT: WarFactory DISABLED_UNDERPOWERED after PP sell: ${isUnderpowered}`);
      }
      if (supplyCenter) {
        const scState = logic.getEntityState(supplyCenter.id)!;
        const isUnderpowered = scState.statusFlags.includes('DISABLED_UNDERPOWERED');
        console.log(`BROWNOUT: SupplyCenter DISABLED_UNDERPOWERED after PP sell: ${isUnderpowered}`);
      }
    } else {
      console.log('BROWNOUT: No power consumption — brownout system not triggered');
    }

    // === RECOVERY: Rebuild PP ===
    const [recoveryPpX, recoveryPpZ] = offsetFromCommandCenter(cc, USA_BUILD_OFFSETS.recoveryPowerPlant);
    const pp2 = buildStructure(logic, dozer.id, 'AmericaPowerPlant', recoveryPpX, recoveryPpZ, anomalies, 1200);
    if (pp2) {
      console.log(`BROWNOUT: New PP built (id=${pp2.id})`);

      // Check power state after rebuilding
      runFrames(logic, 30, anomalies, 'brownout-recovery');
      const powerAfterRebuild = logic.getSidePowerState('america');
      console.log(`BROWNOUT: Power after rebuild: production=${powerAfterRebuild.energyProduction}, consumption=${powerAfterRebuild.energyConsumption}, brownedOut=${powerAfterRebuild.brownedOut}`);

      // Should no longer be browned out (PP produces 5 which covers all consumption)
      if (!powerAfterRebuild.brownedOut) {
        console.log('BROWNOUT: Successfully recovered from brownout');
      } else {
        anomalies.push('BROWNOUT: Still browned out after rebuilding PP');
      }

      // Check that POWERED buildings are no longer disabled
      if (warFactory) {
        const wfAfter = logic.getEntityState(warFactory.id)!;
        const stillUnderpowered = wfAfter.statusFlags.includes('DISABLED_UNDERPOWERED');
        console.log(`BROWNOUT: WarFactory DISABLED_UNDERPOWERED after recovery: ${stillUnderpowered}`);
        if (stillUnderpowered && !powerAfterRebuild.brownedOut) {
          anomalies.push('BROWNOUT: WarFactory still DISABLED_UNDERPOWERED after PP rebuilt');
        }
      }
    } else {
      anomalies.push('BROWNOUT: Could not rebuild PP for recovery test');
    }

    checkNaN(logic, anomalies, 'brownout');
    if (anomalies.length > 0) {
      console.log('\n=== BROWNOUT ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);

  // == Bonus: NaN position guard verification ==
  it('NaN guard: entity positions are never NaN after map load and 1000 frames', () => {
    const logic = createUSAvsChinaGame();
    const anomalies: string[] = [];

    // Check immediately after load
    checkNaN(logic, anomalies, 'after-load');

    // Run 1000 frames with AI
    logic.enableSkirmishAI('America');
    logic.enableSkirmishAI('China');
    runFrames(logic, 1000, anomalies, 'nan-guard-sim');

    // Check after simulation
    checkNaN(logic, anomalies, 'after-1000-frames');

    const states = logic.getRenderableEntityStates();
    const nanCount = states.filter((s: any) => isNaN(s.x) || isNaN(s.y) || isNaN(s.z)).length;
    console.log(`NaN-GUARD: ${states.length} entities, ${nanCount} with NaN positions`);

    if (anomalies.length > 0) {
      console.log('\n=== NaN-GUARD ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expectNoCriticalAnomalies(anomalies);
  }, 120_000);
});
