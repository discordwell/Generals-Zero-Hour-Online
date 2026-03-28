/**
 * ZH-only pathfinding and movement runtime fixes.
 *
 * Source parity:
 *   1. AIGroup.cpp:1664-1674 — CLIFF_JUMPER bypasses cliff/obstacle terrain in pathfinding
 *   2. AIPathfind.cpp:10120-10122 — Dozers always get clear paths (priority in path conflicts)
 *   3. AIPathfind.cpp:10173-10178 — Patch 1.01: Don't shove busy/using-ability units
 *   4. Locomotor.cpp:1080-1092 — LOCO_MOTORCYCLE uses wheel-based movement mechanics
 *   5. AIGroup.cpp:1518-1612 — Aircraft get STD_AIRCRAFT_EXTRA_MARGIN in waypoint clamping
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  findPath,
  moveAlliesAlongPath,
  type NavigationPathfindingContext,
  type NavigationEntityLike,
  type NavigationGridLike,
} from './navigation-pathfinding.js';
import {
  isWheelBasedLocomotor,
  computeWaypointClampMargin,
  clampWaypointPosition,
  STD_WAYPOINT_CLAMP_MARGIN,
  STD_AIRCRAFT_EXTRA_MARGIN,
} from './entity-movement.js';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './parity-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MAP_XY_FACTOR = 10;
const NAV_CLEAR = 0;
const NAV_CLIFF = 2;
const NAV_OBSTACLE = 4;

function makeNavGrid(width: number, height: number): NavigationGridLike {
  const total = width * height;
  const zoneBlockWidth = Math.ceil(width / 10);
  const zoneBlockHeight = Math.ceil(height / 10);
  const zoneTotal = zoneBlockWidth * zoneBlockHeight;
  return {
    width,
    height,
    terrainType: new Uint8Array(total),
    blocked: new Uint8Array(total),
    pinched: new Uint8Array(total),
    bridge: new Uint8Array(total),
    bridgePassable: new Uint8Array(total),
    bridgeTransitions: new Uint8Array(total),
    bridgeSegmentByCell: new Int32Array(total).fill(-1),
    zonePassable: new Uint8Array(zoneTotal).fill(1),
    zoneBlockWidth,
    zoneBlockHeight,
    logicalMinX: 0,
    logicalMinZ: 0,
    logicalMaxX: width - 1,
    logicalMaxZ: height - 1,
  };
}

function setCliff(grid: NavigationGridLike, x: number, z: number): void {
  const idx = z * grid.width + x;
  grid.terrainType[idx] = NAV_CLIFF;
}

function setObstacle(grid: NavigationGridLike, x: number, z: number): void {
  const idx = z * grid.width + x;
  grid.terrainType[idx] = NAV_OBSTACLE;
  grid.blocked[idx] = 1;
}

function makeContext(
  grid: NavigationGridLike,
  entities?: Map<number, NavigationEntityLike>,
): NavigationPathfindingContext<NavigationEntityLike> {
  return {
    config: { attackUsesLineOfSight: false },
    mapHeightmap: null,
    navigationGrid: grid,
    spawnedEntities: entities ?? new Map(),
    worldToGrid(worldX: number, worldZ: number): [number | null, number | null] {
      const cellX = Math.round(worldX / MAP_XY_FACTOR);
      const cellZ = Math.round(worldZ / MAP_XY_FACTOR);
      if (cellX < 0 || cellX >= grid.width || cellZ < 0 || cellZ >= grid.height) {
        return [null, null];
      }
      return [cellX, cellZ];
    },
    gridFromIndex(index: number): [number, number] {
      const x = index % grid.width;
      const z = (index - x) / grid.width;
      return [x, z];
    },
    gridToWorld(cellX: number, cellZ: number) {
      return { x: cellX * MAP_XY_FACTOR, z: cellZ * MAP_XY_FACTOR };
    },
    isCellInBounds(cellX: number, cellZ: number): boolean {
      return cellX >= 0 && cellX < grid.width && cellZ >= 0 && cellZ < grid.height;
    },
    getTeamRelationship(): number {
      return 1; // allies by default
    },
    canCrushOrSquish(): boolean {
      return false;
    },
    relationshipAllies: 1,
  };
}

function makeMover(overrides: Partial<NavigationEntityLike> = {}): NavigationEntityLike {
  return {
    id: 1,
    x: 0,
    z: 0,
    category: 'vehicle',
    canMove: true,
    moving: false,
    blocksPath: false,
    obstacleFootprint: 0,
    pathDiameter: 0,
    pathfindCenterInCell: false,
    pathfindPosCell: null,
    pathfindGoalCell: null,
    ignoredMovementObstacleId: null,
    locomotorSurfaceMask: 1, // LOCOMOTORSURFACE_GROUND
    locomotorDownhillOnly: false,
    attackNeedsLineOfSight: false,
    isImmobile: false,
    noCollisions: false,
    ...overrides,
  };
}

// ===========================================================================
// 1. CLIFF_JUMPER exception in vehicle pathfinding
// ===========================================================================
describe('CLIFF_JUMPER pathfinding exception', () => {
  it('normal vehicle cannot path through cliff cells', () => {
    // Grid: 10x5, row of cliffs at z=2
    const grid = makeNavGrid(10, 5);
    for (let x = 0; x < 10; x++) {
      setCliff(grid, x, 2);
    }
    const context = makeContext(grid);
    const normalVehicle = makeMover({
      x: 0,
      z: 0,
      locomotorSurfaceMask: 1, // GROUND only
      kindOf: new Set(['VEHICLE']),
    });

    const path = findPath(context, 0, 0, 90, 40, normalVehicle);

    // Normal vehicle cannot traverse cliff cells with only GROUND surface
    expect(path.length).toBe(0);
  });

  it('CLIFF_JUMPER vehicle can path through cliff cells', () => {
    // Grid: 10x5, entire row of cliffs at z=2 with no way around
    // Rows z=0,1 are clear (start side), z=3,4 are clear (goal side), z=2 is all cliff
    const grid = makeNavGrid(10, 5);
    for (let x = 0; x < 10; x++) {
      setCliff(grid, x, 2);
    }
    const context = makeContext(grid);
    const cliffJumper = makeMover({
      x: 0,
      z: 0,
      locomotorSurfaceMask: 1, // GROUND only — no CLIFF surface
      kindOf: new Set(['VEHICLE', 'CLIFF_JUMPER']),
    });

    // Start at (0,0) grid cells, goal at (5,4) grid cells (world: 0,0 -> 50,40)
    const path = findPath(context, 0, 0, 50, 40, cliffJumper);

    // CLIFF_JUMPER treats cliff terrain as ground — path should exist
    // even though the unit only has GROUND surface and cliffs normally require CLIFF surface
    expect(path.length).toBeGreaterThan(0);
    // Path must cross the cliff row to reach the goal side
    const hasGoalSide = path.some(p => p.z >= 30); // z >= 3 grid cells (world z=30+)
    expect(hasGoalSide).toBe(true);
  });
});

// ===========================================================================
// 2. Dozer priority in pathfinding conflicts
// ===========================================================================
describe('Dozer priority in path conflicts', () => {
  it('dozer can path through obstacle cells', () => {
    // Grid: 10x5, obstacle at (5,2)
    const grid = makeNavGrid(10, 5);
    setObstacle(grid, 5, 2);
    const context = makeContext(grid);
    const dozer = makeMover({
      x: 0,
      z: 20,
      locomotorSurfaceMask: 1,
      kindOf: new Set(['VEHICLE', 'DOZER']),
    });

    const path = findPath(context, 0, 20, 90, 20, dozer);

    // Dozer can path through obstacle cells
    expect(path.length).toBeGreaterThan(0);
  });

  it('normal vehicle cannot path through obstacle cells', () => {
    // Grid: 10x1 — entire middle blocked except one obstacle
    const grid = makeNavGrid(10, 3);
    // Block entire row z=1
    for (let x = 0; x < 10; x++) {
      setObstacle(grid, x, 1);
    }
    const context = makeContext(grid);
    const normalVehicle = makeMover({
      x: 0,
      z: 0,
      locomotorSurfaceMask: 1,
      kindOf: new Set(['VEHICLE']),
    });

    const path = findPath(context, 0, 0, 90, 20, normalVehicle);

    // Normal vehicle cannot path through obstacle row
    expect(path.length).toBe(0);
  });

  it('dozer always triggers moveAllies even without blockedByAlly', () => {
    const grid = makeNavGrid(10, 10);
    const entities = new Map<number, NavigationEntityLike>();

    const dozer = makeMover({
      id: 1,
      x: 10,
      z: 10,
      kindOf: new Set(['VEHICLE', 'DOZER']),
      pathfindPosCell: { x: 1, z: 1 },
    });
    entities.set(1, dozer);

    // Ally sitting on the path
    const ally = makeMover({
      id: 2,
      x: 30,
      z: 10,
      canMove: true,
      moving: false,
      blocksPath: true,
      pathfindPosCell: { x: 3, z: 1 },
      pathDiameter: 0,
      kindOf: new Set(['VEHICLE']),
    });
    entities.set(2, ally);

    const context = makeContext(grid, entities);
    const pathCells = [{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 3, z: 1 }, { x: 4, z: 1 }];

    // Dozer always wants clear path (blockedByAlly=false still triggers for dozers)
    const results = moveAlliesAlongPath(context, dozer, pathCells, undefined, false);

    expect(results.length).toBe(1);
    expect(results[0]!.entityId).toBe(2);
  });

  it('non-dozer does NOT trigger moveAllies when blockedByAlly is false', () => {
    const grid = makeNavGrid(10, 10);
    const entities = new Map<number, NavigationEntityLike>();

    const tank = makeMover({
      id: 1,
      x: 10,
      z: 10,
      kindOf: new Set(['VEHICLE']),
      pathfindPosCell: { x: 1, z: 1 },
    });
    entities.set(1, tank);

    const ally = makeMover({
      id: 2,
      x: 30,
      z: 10,
      canMove: true,
      moving: false,
      blocksPath: true,
      pathfindPosCell: { x: 3, z: 1 },
      pathDiameter: 0,
      kindOf: new Set(['VEHICLE']),
    });
    entities.set(2, ally);

    const context = makeContext(grid, entities);
    const pathCells = [{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 3, z: 1 }];

    // Non-dozer with no blockedByAlly flag: should NOT shove allies
    const results = moveAlliesAlongPath(context, tank, pathCells, undefined, false);

    expect(results.length).toBe(0);
  });
});

// ===========================================================================
// 3. Busy unit check for path priority (Patch 1.01)
// ===========================================================================
describe('Busy unit check in moveAllies (Patch 1.01)', () => {
  function makeMoveAlliesSetup(allyOverrides: Partial<NavigationEntityLike> = {}) {
    const grid = makeNavGrid(10, 10);
    const entities = new Map<number, NavigationEntityLike>();

    const dozer = makeMover({
      id: 1,
      x: 10,
      z: 10,
      kindOf: new Set(['VEHICLE', 'DOZER']),
      pathfindPosCell: { x: 1, z: 1 },
    });
    entities.set(1, dozer);

    const ally = makeMover({
      id: 2,
      x: 30,
      z: 10,
      canMove: true,
      moving: false,
      blocksPath: true,
      pathfindPosCell: { x: 3, z: 1 },
      pathDiameter: 0,
      kindOf: new Set(['VEHICLE']),
      ...allyOverrides,
    });
    entities.set(2, ally);

    const context = makeContext(grid, entities);
    const pathCells = [{ x: 1, z: 1 }, { x: 2, z: 1 }, { x: 3, z: 1 }];

    return { context, dozer, pathCells };
  }

  it('normal ally gets shoved by dozer', () => {
    const { context, dozer, pathCells } = makeMoveAlliesSetup();
    const results = moveAlliesAlongPath(context, dozer, pathCells, undefined, true);

    expect(results.length).toBe(1);
    expect(results[0]!.entityId).toBe(2);
  });

  it('ally using ability is NOT shoved (Patch 1.01 fix)', () => {
    const { context, dozer, pathCells } = makeMoveAlliesSetup({
      isUsingAbility: true,
    });
    const results = moveAlliesAlongPath(context, dozer, pathCells, undefined, true);

    expect(results.length).toBe(0);
  });

  it('busy ally is NOT shoved (Patch 1.01 fix)', () => {
    const { context, dozer, pathCells } = makeMoveAlliesSetup({
      isBusy: true,
    });
    const results = moveAlliesAlongPath(context, dozer, pathCells, undefined, true);

    expect(results.length).toBe(0);
  });

  it('attacking ally is NOT shoved', () => {
    const { context, dozer, pathCells } = makeMoveAlliesSetup({
      isAttacking: true,
    });
    const results = moveAlliesAlongPath(context, dozer, pathCells, undefined, true);

    expect(results.length).toBe(0);
  });

  it('moving ally is NOT shoved (already moving)', () => {
    const { context, dozer, pathCells } = makeMoveAlliesSetup({
      moving: true,
    });
    const results = moveAlliesAlongPath(context, dozer, pathCells, undefined, true);

    // Moving units are not shoved — they're already in motion.
    expect(results.length).toBe(0);
  });
});

// ===========================================================================
// 4. LOCO_MOTORCYCLE type handling
// ===========================================================================
describe('LOCO_MOTORCYCLE type handling', () => {
  it('FOUR_WHEELS is classified as wheel-based', () => {
    expect(isWheelBasedLocomotor('FOUR_WHEELS')).toBe(true);
  });

  it('MOTORCYCLE is classified as wheel-based (ZH addition)', () => {
    expect(isWheelBasedLocomotor('MOTORCYCLE')).toBe(true);
  });

  it('case-insensitive matching works', () => {
    expect(isWheelBasedLocomotor('four_wheels')).toBe(true);
    expect(isWheelBasedLocomotor('motorcycle')).toBe(true);
    expect(isWheelBasedLocomotor('Motorcycle')).toBe(true);
  });

  it('TREADS is not wheel-based', () => {
    expect(isWheelBasedLocomotor('TREADS')).toBe(false);
  });

  it('HOVER is not wheel-based', () => {
    expect(isWheelBasedLocomotor('HOVER')).toBe(false);
  });

  it('TWO_LEGS is not wheel-based', () => {
    expect(isWheelBasedLocomotor('TWO_LEGS')).toBe(false);
  });

  it('WINGS is not wheel-based', () => {
    expect(isWheelBasedLocomotor('WINGS')).toBe(false);
  });

  it('OTHER is not wheel-based', () => {
    expect(isWheelBasedLocomotor('OTHER')).toBe(false);
  });
});

// ===========================================================================
// 5. Aircraft extra margin in waypoint clamping
// ===========================================================================
describe('Aircraft extra margin in waypoint clamping', () => {
  it('STD_AIRCRAFT_EXTRA_MARGIN equals PATHFIND_CELL_SIZE * 10', () => {
    // Source parity: AIGroup.cpp:1519
    expect(STD_AIRCRAFT_EXTRA_MARGIN).toBe(100); // PATHFIND_CELL_SIZE=10 * 10
  });

  it('STD_WAYPOINT_CLAMP_MARGIN equals PATHFIND_CELL_SIZE * 4', () => {
    // Source parity: AIGroup.cpp:1518
    expect(STD_WAYPOINT_CLAMP_MARGIN).toBe(40); // PATHFIND_CELL_SIZE=10 * 4
  });

  it('aircraft gets wider margin than ground vehicle', () => {
    const aircraftMargin = computeWaypointClampMargin({ kindOf: new Set(['AIRCRAFT']), category: 'air' });
    const vehicleMargin = computeWaypointClampMargin({ kindOf: new Set(['VEHICLE']), category: 'vehicle' });

    // Aircraft: STD_WAYPOINT_CLAMP_MARGIN + STD_AIRCRAFT_EXTRA_MARGIN = 40 + 100 = 140
    expect(aircraftMargin).toBe(140);
    // Vehicle: STD_WAYPOINT_CLAMP_MARGIN only = 40
    expect(vehicleMargin).toBe(40);
    expect(aircraftMargin).toBeGreaterThan(vehicleMargin);
  });

  it('clampWaypointPosition clamps near-edge positions with aircraft margin', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const bundle = makeBundle({
      objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 50, 50)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const self = logic as any;
    const aircraftMargin = 140; // STD_WAYPOINT_CLAMP_MARGIN + STD_AIRCRAFT_EXTRA_MARGIN

    // Clamp position at origin with aircraft margin
    const result = clampWaypointPosition(self, 0, 0, aircraftMargin);
    expect(result[0]).toBe(140);
    expect(result[1]).toBe(140);
  });

  it('clampWaypointPosition clamps far-edge positions with aircraft margin', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const bundle = makeBundle({
      objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 50, 50)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const self = logic as any;
    const mapWidth = self.mapHeightmap.worldWidth;
    const mapDepth = self.mapHeightmap.worldDepth;
    const aircraftMargin = 140;

    const result = clampWaypointPosition(self, mapWidth + 500, mapDepth + 500, aircraftMargin);
    expect(result[0]).toBe(mapWidth - aircraftMargin);
    expect(result[1]).toBe(mapDepth - aircraftMargin);
  });

  it('ground vehicle uses standard margin without extra', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const bundle = makeBundle({
      objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 50, 50)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const self = logic as any;
    const vehicleMargin = 40; // STD_WAYPOINT_CLAMP_MARGIN only

    const result = clampWaypointPosition(self, 0, 0, vehicleMargin);
    expect(result[0]).toBe(40);
    expect(result[1]).toBe(40);
  });

  it('in-bounds positions pass through unchanged', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const bundle = makeBundle({
      objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 50, 50)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const self = logic as any;
    const margin = 140;

    // Position well within bounds
    const result = clampWaypointPosition(self, 500, 500, margin);
    expect(result[0]).toBe(500);
    expect(result[1]).toBe(500);
  });
});
