/**
 * Retail Data Advanced Wet Test — dozer movement and construction interaction.
 *
 * Tests that the AmericaVehicleDozer responds to player moveTo commands
 * and does not get stuck at its spawn position.
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem } from './index.js';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

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

    const mapPath = resolve(ASSETS_DIR, 'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json');
    mapData = JSON.parse(readFileSync(mapPath, 'utf-8'));
    return true;
  } catch {
    return false;
  }
}

const hasRetailData = loadRetailData();

/**
 * Create a fresh game instance for each test to avoid state leaks.
 */
function createFreshGame(): {
  logic: GameLogicSubsystem;
  heightmap: HeightmapGrid;
} {
  const logic = new GameLogicSubsystem(new THREE.Scene());
  const heightmap = HeightmapGrid.fromJSON(mapData.heightmap);
  logic.loadMapObjects(mapData, iniRegistry, heightmap);
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'China');
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
  logic.spawnSkirmishStartingEntities();
  logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
  logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: 10000 });
  // Initial update to process commands
  logic.update(0);
  logic.update(1 / 30);
  return { logic, heightmap };
}

describe.skipIf(!hasRetailData)('dozer movement: retail Tournament Desert', () => {

  it('dozer has valid locomotor set and speed', () => {
    const { logic } = createFreshGame();
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(dozer).toBeDefined();

    const state = logic.getEntityState(dozer!.id)!;
    expect(state).not.toBeNull();
    expect(state.speed).toBeGreaterThan(0);
    expect(state.activeLocomotorSet).toBe('SET_NORMAL');
  });

  it('dozer moves when given a player moveTo command', () => {
    const { logic } = createFreshGame();
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(dozer).toBeDefined();

    const startX = dozer!.x;
    const startZ = dozer!.z;

    // Issue a moveTo command 100 units away
    const targetX = startX + 100;
    const targetZ = startZ;
    logic.submitCommand({
      type: 'moveTo',
      entityId: dozer!.id,
      targetX,
      targetZ,
      commandSource: 'PLAYER',
    });

    // Run for 60 frames (~2 seconds at 30fps) -- enough for the dozer to start moving
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const afterState = logic.getEntityState(dozer!.id)!;
    expect(afterState).not.toBeNull();

    // Dozer should have moved from its starting position
    const distanceMoved = Math.hypot(afterState.x - startX, afterState.z - startZ);
    expect(distanceMoved).toBeGreaterThan(5);
  });

  it('dozer moves after completing a construction task', () => {
    const { logic } = createFreshGame();
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(dozer).toBeDefined();

    // Build a power plant
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: dozer!.id,
      templateName: 'AmericaPowerPlant',
      targetPosition: [dozer!.x + 50, 0, dozer!.z],
      angle: 0,
      lineEndPosition: null,
    });

    // Run to complete construction
    for (let i = 0; i < 600; i++) logic.update(1 / 30);

    // Verify construction completed
    const pps = logic.getRenderableEntityStates().filter(e => e.templateName === 'AmericaPowerPlant');
    expect(pps.length).toBeGreaterThanOrEqual(1);

    // Now issue a moveTo command
    const dozerAfterBuild = logic.getEntityState(dozer!.id)!;
    const startX = dozerAfterBuild.x;
    const startZ = dozerAfterBuild.z;
    const targetX = startX - 100;
    const targetZ = startZ;

    logic.submitCommand({
      type: 'moveTo',
      entityId: dozer!.id,
      targetX,
      targetZ,
      commandSource: 'PLAYER',
    });

    // Run for 120 frames -- enough for braking + 180-degree turn + acceleration
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    const afterMoveState = logic.getEntityState(dozer!.id)!;
    const distanceMoved = Math.hypot(afterMoveState.x - startX, afterMoveState.z - startZ);
    expect(distanceMoved).toBeGreaterThan(5);
  });

  it('dozer obeys player moveTo even while heading to construction site', () => {
    const { logic } = createFreshGame();
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(dozer).toBeDefined();

    const spawnX = dozer!.x;
    const spawnZ = dozer!.z;

    // Build a power plant far away
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: dozer!.id,
      templateName: 'AmericaPowerPlant',
      targetPosition: [spawnX + 200, 0, spawnZ + 200],
      angle: 0,
      lineEndPosition: null,
    });
    // Let it start moving for a few frames
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Now the player cancels by sending a moveTo in the opposite direction
    const dozerMidway = logic.getEntityState(dozer!.id)!;
    const midX = dozerMidway.x;

    const targetX = midX - 100;
    const targetZ = dozerMidway.z;

    logic.submitCommand({
      type: 'moveTo',
      entityId: dozer!.id,
      targetX,
      targetZ,
      commandSource: 'PLAYER',
    });

    // Source parity: dozer TurnRate=90 deg/sec. A 180-degree turn takes 60 frames
    // at 30fps, plus braking and re-acceleration. Allow 150 frames total.
    for (let i = 0; i < 150; i++) logic.update(1 / 30);

    const afterState = logic.getEntityState(dozer!.id)!;
    // Dozer should have moved toward the moveTo target (negative-x direction)
    expect(afterState.x).toBeLessThan(midX);
  });

  it('dozer does not get stuck at spawn for 2000 frames', () => {
    const { logic } = createFreshGame();
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    );
    expect(dozer).toBeDefined();

    const startX = dozer!.x;
    const startZ = dozer!.z;

    // Issue moveTo command
    logic.submitCommand({
      type: 'moveTo',
      entityId: dozer!.id,
      targetX: startX + 150,
      targetZ: startZ,
      commandSource: 'PLAYER',
    });

    // Run for 2000 frames -- the bug scenario
    for (let i = 0; i < 2000; i++) {
      logic.update(1 / 30);
    }

    const finalState = logic.getEntityState(dozer!.id)!;
    const totalDistance = Math.hypot(finalState.x - startX, finalState.z - startZ);
    // Dozer should have moved significantly -- at minimum ~100 units in 2000 frames
    expect(totalDistance).toBeGreaterThan(50);
  });
});

describe.skipIf(!hasRetailData)('sequential player construction: retail Tournament Desert', () => {

  it('player can build Power Plant then Barracks sequentially', () => {
    const { logic } = createFreshGame();
    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    )!;
    const cc = entities.find(e =>
      e.templateName === 'AmericaCommandCenter' && e.side?.toUpperCase() === 'AMERICA',
    )!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    const creditsBefore = logic.getSideCredits('america');
    expect(creditsBefore).toBe(10000);

    // Build power plant well away from CC
    const ppX = cc.x + 150;
    const ppZ = cc.z;
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: dozer.id,
      templateName: 'AmericaPowerPlant',
      targetPosition: [ppX, 0, ppZ],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    const creditsAfterPP = logic.getSideCredits('america');
    expect(creditsAfterPP).toBeLessThan(creditsBefore);

    // Complete construction
    for (let i = 0; i < 600; i++) logic.update(1 / 30);

    const pps = logic.getRenderableEntityStates().filter(e => e.templateName === 'AmericaPowerPlant');
    expect(pps.length).toBeGreaterThanOrEqual(1);

    // Now build Barracks well away from both CC and PP
    const barracksX = cc.x + 150;
    const barracksZ = cc.z + 150;
    const creditsBeforeBarracks = logic.getSideCredits('america');

    logic.submitCommand({
      type: 'constructBuilding',
      entityId: dozer.id,
      templateName: 'AmericaBarracks',
      targetPosition: [barracksX, 0, barracksZ],
      angle: 0,
      lineEndPosition: null,
    });
    logic.update(1 / 30);

    const creditsAfterBarracks = logic.getSideCredits('america');
    // Credits should decrease for the Barracks
    expect(creditsAfterBarracks).toBeLessThan(creditsBeforeBarracks);
  });

  it('player can build three structures in sequence', () => {
    const { logic } = createFreshGame();
    // Give extra credits for three buildings
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 50000 });
    logic.update(1 / 30);

    const entities = logic.getRenderableEntityStates();
    const dozer = entities.find(e =>
      e.templateName === 'AmericaVehicleDozer' && e.side?.toUpperCase() === 'AMERICA',
    )!;
    const cc = entities.find(e =>
      e.templateName === 'AmericaCommandCenter' && e.side?.toUpperCase() === 'AMERICA',
    )!;
    expect(dozer).toBeDefined();
    expect(cc).toBeDefined();

    // Place buildings well away from CC and each other
    const buildings = [
      { name: 'AmericaPowerPlant', dx: 150, dz: 0 },
      { name: 'AmericaBarracks', dx: 150, dz: 150 },
      { name: 'AmericaSupplyCenter', dx: 300, dz: 0 },
    ];

    for (const bld of buildings) {
      const creditsBefore = logic.getSideCredits('america');
      logic.submitCommand({
        type: 'constructBuilding',
        entityId: dozer.id,
        templateName: bld.name,
        targetPosition: [cc.x + bld.dx, 0, cc.z + bld.dz],
        angle: 0,
        lineEndPosition: null,
      });
      logic.update(1 / 30);

      const creditsAfter = logic.getSideCredits('america');
      expect(creditsAfter).toBeLessThan(creditsBefore);

      // Complete construction before building next
      for (let i = 0; i < 600; i++) logic.update(1 / 30);
    }

    // Verify all three buildings exist
    const finalEntities = logic.getRenderableEntityStates();
    for (const bld of buildings) {
      expect(finalEntities.filter(e => e.templateName === bld.name).length).toBeGreaterThanOrEqual(1);
    }
  });
});
