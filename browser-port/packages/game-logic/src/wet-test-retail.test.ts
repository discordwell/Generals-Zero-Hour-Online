/**
 * Retail Data Wet Test — loads actual retail INI bundle and Tournament Desert map.
 * Plays through a full skirmish game with real unit definitions.
 *
 * This catches parity issues that synthetic tests miss because it uses
 * the exact same data the player sees in the browser.
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON, base64ToUint8Array } from '@generals/terrain';

const ASSETS_DIR = resolve(
  import.meta.dirname ?? __dirname,
  '../../app/public/assets',
);

let iniRegistry: IniDataRegistry;
let mapData: MapDataJSON;

function loadRetailData(): boolean {
  try {
    const bundlePath = resolve(ASSETS_DIR, 'data/ini-bundle.json');
    const bundleJson = JSON.parse(readFileSync(bundlePath, 'utf-8'));
    iniRegistry = new IniDataRegistry();
    iniRegistry.loadBundle(bundleJson);

    // Find Tournament Desert map
    const mapPath = resolve(ASSETS_DIR, 'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json');
    mapData = JSON.parse(readFileSync(mapPath, 'utf-8'));
    return true;
  } catch {
    return false;
  }
}

const hasRetailData = loadRetailData();

describe.skipIf(!hasRetailData)('retail wet test: Tournament Desert USA vs China', () => {
  let logic: GameLogicSubsystem;
  let heightmap: HeightmapGrid;

  beforeAll(() => {
    logic = new GameLogicSubsystem(new THREE.Scene());
    heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
    logic.loadMapObjects(mapData, iniRegistry, heightmap);
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    // Spawn starting entities (CC + dozer per side) from FactionDef/PlayerTemplate
    logic.spawnSkirmishStartingEntities(iniRegistry);
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: 10000 });
    // Initial update to process commands and establish fog of war
    logic.update(0);
    logic.update(1 / 30);
  });

  it('spawns starting entities for both sides', () => {
    const states = logic.getRenderableEntityStates();
    const americaEntities = states.filter(e => e.side?.toUpperCase() === 'AMERICA');
    const chinaEntities = states.filter(e => e.side?.toUpperCase() === 'CHINA');

    // Each side should have at least CC + dozer
    expect(americaEntities.length).toBeGreaterThanOrEqual(2);
    expect(chinaEntities.length).toBeGreaterThanOrEqual(2);

    // Verify CC exists
    const usaCC = americaEntities.find(e => e.templateName.includes('CommandCenter'));
    const chinaCC = chinaEntities.find(e => e.templateName.includes('CommandCenter'));
    expect(usaCC).toBeDefined();
    expect(chinaCC).toBeDefined();
  });

  it('map has correct dimensions and terrain', () => {
    expect(heightmap.width).toBeGreaterThan(100);
    expect(heightmap.height).toBeGreaterThan(100);

    // Height should vary
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < heightmap.worldHeights.length; i++) {
      const h = heightmap.worldHeights[i]!;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    expect(maxH - minH).toBeGreaterThan(1);
  });

  it('INI data loaded with all object types', () => {
    const stats = iniRegistry.getStats();
    expect(stats.objects).toBeGreaterThan(500);
    expect(stats.weapons).toBeGreaterThan(100);
    expect(stats.armors).toBeGreaterThan(10);

    // Verify key templates exist
    expect(iniRegistry.getObject('AmericaCommandCenter')).toBeDefined();
    expect(iniRegistry.getObject('AmericaVehicleDozer')).toBeDefined();
    expect(iniRegistry.getObject('ChinaCommandCenter')).toBeDefined();
    expect(iniRegistry.getObject('ChinaVehicleDozer')).toBeDefined();
    expect(iniRegistry.getObject('AmericaInfantryRanger')).toBeDefined();
    expect(iniRegistry.getObject('ChinaInfantryRedguard')).toBeDefined();
  });

  it('dozer can build USA power plant with retail data', () => {
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(dozer).toBeDefined();

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: dozer!.id,
      templateName: 'AmericaPowerPlant',
      targetPosition: [dozer!.x + 50, 0, dozer!.z],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    // Credits should decrease by PP cost
    const credits = logic.getSideCredits('america');
    expect(credits).toBeLessThan(10000);

    // Advance to complete construction
    for (let i = 0; i < 600; i++) logic.update(1 / 30);

    const pps = logic.getRenderableEntityStates().filter(e => e.templateName === 'AmericaPowerPlant');
    expect(pps.length).toBeGreaterThanOrEqual(1);
  });

  it('CC can train a dozer with retail data', () => {
    const entities = logic.getRenderableEntityStates();
    const cc = entities.find(e =>
      e.templateName === 'AmericaCommandCenter' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(cc).toBeDefined();

    const dozersBefore = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    ).length;

    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: cc!.id,
      unitTemplateName: 'AmericaVehicleDozer',
    });

    // Advance to complete production
    for (let i = 0; i < 600; i++) logic.update(1 / 30);

    const dozersAfter = logic.getRenderableEntityStates().filter(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    ).length;
    expect(dozersAfter).toBeGreaterThan(dozersBefore);
  });

  it('entities have valid renderable states', () => {
    const states = logic.getRenderableEntityStates();
    const anomalies: string[] = [];

    for (const state of states) {
      if (isNaN(state.x) || isNaN(state.y) || isNaN(state.z)) {
        anomalies.push(`Entity ${state.id} (${state.templateName}): NaN position`);
      }
      if (state.health < 0) {
        anomalies.push(`Entity ${state.id} (${state.templateName}): negative health ${state.health}`);
      }
      // Unresolved entities (props, ambient sounds) naturally have zero maxHealth
      if (state.maxHealth <= 0 && state.resolved && !state.templateName.startsWith('Amb_')
        && state.category !== 'unknown') {
        anomalies.push(`Entity ${state.id} (${state.templateName}): zero maxHealth`);
      }
    }

    if (anomalies.length > 0) {
      console.log('\n=== RETAIL WET TEST ANOMALIES ===');
      for (const a of anomalies) console.log(`  - ${a}`);
    }
    expect(anomalies.length).toBe(0);
  });

  it('fog of war is functional', () => {
    const fogData = logic.getFogOfWarTextureData('america');
    expect(fogData).not.toBeNull();
    expect(fogData!.cellsWide).toBeGreaterThan(0);
    expect(fogData!.cellsDeep).toBeGreaterThan(0);

    // Should have a mix of clear and shrouded cells
    let clearCount = 0;
    let shroudedCount = 0;
    for (let i = 0; i < fogData!.data.length; i++) {
      if (fogData!.data[i] === 2) clearCount++;
      if (fogData!.data[i] === 0) shroudedCount++;
    }
    expect(clearCount).toBeGreaterThan(0);
    expect(shroudedCount).toBeGreaterThan(0);
  });

  it('game runs 1000 frames without crashing', () => {
    // Run a sustained simulation to catch runtime errors
    for (let i = 0; i < 1000; i++) {
      logic.update(1 / 30);
    }

    // Game should still be running
    const states = logic.getRenderableEntityStates();
    expect(states.length).toBeGreaterThan(0);

    // No NaN positions after extended simulation
    const nanEntities = states.filter(s => isNaN(s.x) || isNaN(s.y) || isNaN(s.z));
    expect(nanEntities.length).toBe(0);
  });
});
