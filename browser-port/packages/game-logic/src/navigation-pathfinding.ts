import {
  MAP_HEIGHT_SCALE,
  MAP_XY_FACTOR,
  type HeightmapGrid,
} from '@generals/terrain';
import { clamp } from './ini-readers.js';
import { BinaryHeap } from './pathfinding.js';

export interface NavigationVectorXZ {
  x: number;
  z: number;
}

interface PathfindingProfile {
  acceptableSurfaces: number;
  downhillOnly: boolean;
  canPassObstacle: boolean;
  canUseBridge: boolean;
  avoidPinched: boolean;
  pathDiameter: number;
  /** Source parity: ZH KINDOF_CLIFF_JUMPER — can traverse cliff cells as ground. */
  isCliffJumper: boolean;
  /** Source parity: ZH KINDOF_DOZER — can path through non-enemy obstacle cells. */
  isDozer: boolean;
}

interface PathingOccupationResult {
  enemyFixed: boolean;
  allyMoving: boolean;
  allyFixedCount: number;
  allyGoal: boolean;
}

interface MovementOccupancyGrid {
  width: number;
  height: number;
  flags: Uint8Array;
  unitIds: Int32Array;
  goalUnitIds: Int32Array;
}

interface GridCell {
  x: number;
  z: number;
}

export interface NavigationGridLike {
  width: number;
  height: number;
  terrainType: Uint8Array;
  blocked: Uint8Array;
  pinched: Uint8Array;
  bridge: Uint8Array;
  bridgePassable: Uint8Array;
  bridgeTransitions: Uint8Array;
  bridgeSegmentByCell: Int32Array;
  zonePassable: Uint8Array;
  zoneBlockWidth: number;
  zoneBlockHeight: number;
  logicalMinX: number;
  logicalMinZ: number;
  logicalMaxX: number;
  logicalMaxZ: number;
}

export interface NavigationEntityLike {
  id: number;
  x: number;
  z: number;
  category: string;
  canMove: boolean;
  moving: boolean;
  blocksPath: boolean;
  obstacleFootprint: number;
  pathDiameter: number;
  pathfindCenterInCell: boolean;
  pathfindPosCell: GridCell | null;
  pathfindGoalCell: GridCell | null;
  ignoredMovementObstacleId: number | null;
  locomotorSurfaceMask?: number;
  locomotorDownhillOnly?: boolean;
  attackNeedsLineOfSight: boolean;
  isImmobile: boolean;
  noCollisions: boolean;
  /** Source parity: KindOf flags for pathfinding decisions (CLIFF_JUMPER, DOZER, etc.). */
  kindOf?: Set<string>;
  /** Source parity: Patch 1.01 — OBJECT_STATUS_IS_USING_ABILITY blocks ally shove. */
  isUsingAbility?: boolean;
  /** Source parity: Patch 1.01 — AIUpdate::isBusy() blocks ally shove. */
  isBusy?: boolean;
  /** Source parity: AIUpdate::isAttacking() blocks ally shove. */
  isAttacking?: boolean;
}

export interface NavigationPathfindingContext<TEntity extends NavigationEntityLike> {
  config: {
    attackUsesLineOfSight: boolean;
  };
  mapHeightmap: HeightmapGrid | null;
  navigationGrid: NavigationGridLike | null;
  spawnedEntities: Map<number, TEntity>;
  worldToGrid(worldX: number, worldZ: number): [number | null, number | null];
  gridFromIndex(index: number): [number, number];
  gridToWorld(cellX: number, cellZ: number): NavigationVectorXZ;
  isCellInBounds(cellX: number, cellZ: number, nav?: NavigationGridLike | null): boolean;
  getTeamRelationship(sourceEntity: TEntity, targetEntity: TEntity): number;
  canCrushOrSquish(mover: TEntity, target: TEntity): boolean;
  relationshipAllies: number;
}

const PATHFIND_CELL_SIZE = MAP_XY_FACTOR;
const COST_ORTHOGONAL = 10;
const COST_DIAGONAL = 14;
const MAX_PATH_COST = 1e9;
const MAX_SEARCH_NODES = 500_000;
const MAX_RECONSTRUCT_STEPS = 2_000;
const NO_ATTACK_DISTANCE = 0;
const ATTACK_RANGE_CELL_EDGE_FUDGE = PATHFIND_CELL_SIZE * 0.25;
const ATTACK_LOS_TERRAIN_FUDGE = 0.5;
const PATHFIND_ZONE_BLOCK_SIZE = 10;

const NAV_CLEAR = 0;
const NAV_WATER = 1;
const NAV_CLIFF = 2;
const NAV_RUBBLE = 3;
const NAV_OBSTACLE = 4;
const NAV_BRIDGE = 5;
const NAV_IMPASSABLE = 6;
const NAV_BRIDGE_IMPASSABLE = 7;

const LOCOMOTORSURFACE_GROUND = 1 << 0;
const LOCOMOTORSURFACE_WATER = 1 << 1;
const LOCOMOTORSURFACE_CLIFF = 1 << 2;
const LOCOMOTORSURFACE_AIR = 1 << 3;
const LOCOMOTORSURFACE_RUBBLE = 1 << 4;
const NO_SURFACES = 0;
const SOURCE_DEFAULT_PASSABLE_SURFACES = NO_SURFACES;

// PathfindCell::CellFlags values mirrored from GeneralsMD AIPathfind.h.
const UNIT_NO_UNITS = 0x00;
const UNIT_GOAL = 0x01;
const UNIT_PRESENT_MOVING = 0x02;
const UNIT_PRESENT_FIXED = 0x03;
const UNIT_GOAL_OTHER_MOVING = 0x05;

export function updatePathfindGoalCellFromPath<TEntity extends {
  movePath: NavigationVectorXZ[];
  pathfindGoalCell: GridCell | null;
}>(
  entity: TEntity,
  worldToGrid: (worldX: number, worldZ: number) => [number | null, number | null],
): void {
  const destination = entity.movePath[entity.movePath.length - 1];
  if (!destination) {
    entity.pathfindGoalCell = null;
    return;
  }
  const [goalCellX, goalCellZ] = worldToGrid(destination.x, destination.z);
  if (goalCellX === null || goalCellZ === null) {
    entity.pathfindGoalCell = null;
    return;
  }
  entity.pathfindGoalCell = { x: goalCellX, z: goalCellZ };
}

export function updatePathfindPosCell<TEntity extends {
  x: number;
  z: number;
  pathfindPosCell: GridCell | null;
}>(
  entity: TEntity,
  worldToGrid: (worldX: number, worldZ: number) => [number | null, number | null],
): void {
  const [cellX, cellZ] = worldToGrid(entity.x, entity.z);
  if (cellX === null || cellZ === null) {
    entity.pathfindPosCell = null;
    return;
  }
  entity.pathfindPosCell = { x: cellX, z: cellZ };
}

export function findPath<TEntity extends NavigationEntityLike>(
  context: NavigationPathfindingContext<TEntity>,
  startX: number,
  startZ: number,
  targetX: number,
  targetZ: number,
  mover?: TEntity,
  attackDistance = NO_ATTACK_DISTANCE,
): NavigationVectorXZ[] {
  if (!context.navigationGrid) {
    return [{ x: targetX, z: targetZ }];
  }

  const grid = context.navigationGrid;
  const movementProfile = getMovementProfile(mover);
  if (movementProfile.acceptableSurfaces === NO_SURFACES) {
    return [];
  }
  const start = context.worldToGrid(startX, startZ);
  const goal = context.worldToGrid(targetX, targetZ);

  const startCellX = start[0];
  const startCellZ = start[1];
  const goalCellX = goal[0];
  const goalCellZ = goal[1];

  if (startCellX === null || startCellZ === null || goalCellX === null || goalCellZ === null) {
    return [];
  }

  const startCandidate = canOccupyCell(context, startCellX, startCellZ, movementProfile, grid, true)
    ? { x: startCellX, z: startCellZ }
    : findNearestPassableCell(context, startCellX, startCellZ, grid, movementProfile, true);
  if (!startCandidate) {
    return [];
  }

  const effectiveStart = startCandidate;

  const effectiveGoal = findNearestPassableCell(context, goalCellX, goalCellZ, grid, movementProfile, true);
  if (!effectiveGoal) {
    return [];
  }

  const startIndex = effectiveStart.z * grid.width + effectiveStart.x;
  const goalIndex = effectiveGoal.z * grid.width + effectiveGoal.x;
  const total = grid.width * grid.height;
  const isHuman = true;

  const parent = new Int32Array(total);
  const gCost = new Float64Array(total);
  const fCost = new Float64Array(total);
  const inClosed = new Uint8Array(total);
  parent.fill(-1);

  for (let i = 0; i < total; i++) {
    gCost[i] = Number.POSITIVE_INFINITY;
    fCost[i] = Number.POSITIVE_INFINITY;
  }

  // For attack-distance pathfinding, use the original target cell for the heuristic
  // so the A* expands toward the actual target rather than the shifted effectiveGoal.
  const attackTargetCellX = goalCellX ?? effectiveGoal.x;
  const attackTargetCellZ = goalCellZ ?? effectiveGoal.z;

  const estimateToGoal = (cellX: number, cellZ: number): number => {
    if (attackDistance === NO_ATTACK_DISTANCE) {
      return pathHeuristic(cellX, cellZ, effectiveGoal.x, effectiveGoal.z);
    }

    const heuristic = COST_ORTHOGONAL * Math.hypot(cellX - attackTargetCellX, cellZ - attackTargetCellZ);
    return Math.max(0, heuristic - attackDistance / 2);
  };

  // Source parity: attack distance is measured from the mover to the actual
  // target position, not to the effectiveGoal (nearest passable cell). This
  // ensures units stop at proper weapon range from the target, not from a
  // shifted cell that may be far from the target when the target is a large
  // building with a blocked center cell.
  const isWithinAttackDistance = (cellX: number, cellZ: number): boolean => {
    if (attackDistance === NO_ATTACK_DISTANCE) {
      return false;
    }
    const worldPos = context.gridToWorld(cellX, cellZ);
    const deltaX = worldPos.x - targetX;
    const deltaZ = worldPos.z - targetZ;
    const effectiveRange = Math.max(0, attackDistance - ATTACK_RANGE_CELL_EDGE_FUDGE);
    return deltaX * deltaX + deltaZ * deltaZ <= effectiveRange * effectiveRange;
  };

  const needsAttackLineOfSight = context.config.attackUsesLineOfSight && !!mover?.attackNeedsLineOfSight;
  const shouldCheckAttackTerrain = needsAttackLineOfSight && !mover?.isImmobile;

  const isAttackLineBlockedByObstacle = (fromX: number, fromZ: number, toX: number, toZ: number): boolean => {
    const skipObstacleChecks = mover?.category === 'air' ? 3 : 0;

    const fromCell = context.worldToGrid(fromX, fromZ);
    const toCell = context.worldToGrid(toX, toZ);
    if (fromCell[0] === null || fromCell[1] === null || toCell[0] === null || toCell[1] === null) {
      return true;
    }

    const startCellX = fromCell[0];
    const startCellZ = fromCell[1];
    const endCellX = toCell[0];
    const endCellZ = toCell[1];

    if (startCellX === endCellX && startCellZ === endCellZ) {
      return false;
    }

    const deltaX = Math.abs(endCellX - startCellX);
    const deltaZ = Math.abs(endCellZ - startCellZ);

    let xinc1 = 1;
    let xinc2 = 1;
    if (endCellX < startCellX) {
      xinc1 = -1;
      xinc2 = -1;
    }

    let zinc1 = 1;
    let zinc2 = 1;
    if (endCellZ < startCellZ) {
      zinc1 = -1;
      zinc2 = -1;
    }

    let den: number;
    let num: number;
    let numadd: number;
    const numpixels = deltaX >= deltaZ ? deltaX : deltaZ;
    if (deltaX >= deltaZ) {
      xinc1 = 0;
      zinc2 = 0;
      den = deltaX;
      num = Math.floor(deltaX / 2);
      numadd = deltaZ;
    } else {
      xinc2 = 0;
      zinc1 = 0;
      den = deltaZ;
      num = Math.floor(deltaZ / 2);
      numadd = deltaX;
    }

    const skipObstacleChecksRef = { current: skipObstacleChecks };
    const checkCell = (cellX: number, cellZ: number): boolean => {
      if (skipObstacleChecksRef.current > 0) {
        skipObstacleChecksRef.current -= 1;
        return false;
      }
      if (!context.isCellInBounds(cellX, cellZ, grid)) {
        return true;
      }
      const cellIndex = cellZ * grid.width + cellX;
      if (grid.terrainType[cellIndex] === NAV_OBSTACLE) {
        return true;
      }
      return false;
    };

    let x = startCellX;
    let z = startCellZ;

    for (let curpixel = 0; curpixel <= numpixels; curpixel++) {
      if (checkCell(x, z)) {
        return true;
      }

      num += numadd;
      if (num >= den) {
        num -= den;
        x += xinc1;
        z += zinc1;
        if (checkCell(x, z)) {
          return true;
        }
      }
      x += xinc2;
      z += zinc2;
    }

    return false;
  };

  const isAttackLineBlockedByTerrain = (fromX: number, fromZ: number, toX: number, toZ: number): boolean => {
    const heightmap = context.mapHeightmap;
    if (!heightmap || !shouldCheckAttackTerrain) {
      return false;
    }

    const [fromCellX, fromCellZ] = context.worldToGrid(fromX, fromZ);
    const [toCellX, toCellZ] = context.worldToGrid(toX, toZ);
    if (fromCellX === null || fromCellZ === null || toCellX === null || toCellZ === null) {
      return false;
    }

    const maxWorldX = Math.max(0, heightmap.worldWidth - 0.0001);
    const maxWorldZ = Math.max(0, heightmap.worldDepth - 0.0001);
    const fromHeight = heightmap.getInterpolatedHeight(clamp(fromX, 0, maxWorldX), clamp(fromZ, 0, maxWorldZ));
    const toHeight = heightmap.getInterpolatedHeight(clamp(toX, 0, maxWorldX), clamp(toZ, 0, maxWorldZ));
    const rayDeltaHeight = toHeight - fromHeight;

    const getCellTopHeight = (cellX: number, cellZ: number): number => {
      const x0 = clamp(cellX, 0, heightmap.width - 2);
      const z0 = clamp(cellZ, 0, heightmap.height - 2);
      const x1 = x0 + 1;
      const z1 = z0 + 1;
      return Math.max(
        heightmap.getRawHeight(x0, z0),
        heightmap.getRawHeight(x1, z0),
        heightmap.getRawHeight(x0, z1),
        heightmap.getRawHeight(x1, z1),
      ) * MAP_HEIGHT_SCALE;
    };

    const deltaX = Math.abs(toCellX - fromCellX);
    const deltaZ = Math.abs(toCellZ - fromCellZ);
    if (deltaX === 0 && deltaZ === 0) {
      return false;
    }

    let xinc1 = 1;
    let xinc2 = 1;
    if (toCellX < fromCellX) {
      xinc1 = -1;
      xinc2 = -1;
    }

    let zinc1 = 1;
    let zinc2 = 1;
    if (toCellZ < fromCellZ) {
      zinc1 = -1;
      zinc2 = -1;
    }

    let den: number;
    let num: number;
    let numadd: number;
    const numpixels = deltaX >= deltaZ ? deltaX : deltaZ;
    if (deltaX >= deltaZ) {
      xinc1 = 0;
      zinc2 = 0;
      den = deltaX;
      num = Math.floor(deltaX / 2);
      numadd = deltaZ;
    } else {
      xinc2 = 0;
      zinc1 = 0;
      den = deltaZ;
      num = Math.floor(deltaZ / 2);
      numadd = deltaX;
    }

    const isCellBlockedByTerrain = (cellX: number, cellZ: number, step: number): boolean => {
      const terrainHeight = getCellTopHeight(cellX, cellZ);
      const t = numpixels <= 0 ? 0 : step / numpixels;
      const rayHeight = fromHeight + rayDeltaHeight * t;
      return terrainHeight > rayHeight + ATTACK_LOS_TERRAIN_FUDGE;
    };

    let x = fromCellX;
    let z = fromCellZ;
    for (let curpixel = 0; curpixel <= numpixels; curpixel++) {
      if (isCellBlockedByTerrain(x, z, curpixel)) {
        return true;
      }

      num += numadd;
      if (num >= den) {
        num -= den;
        x += xinc1;
        z += zinc1;
        if (isCellBlockedByTerrain(x, z, curpixel)) {
          return true;
        }
      }
      x += xinc2;
      z += zinc2;
    }

    return false;
  };

  const isNearSelfForAttackMove = (cellX: number, cellZ: number): boolean => {
    const threshold = PATHFIND_CELL_SIZE * 0.5;
    const selfToCellX = context.gridToWorld(cellX, cellZ).x - startX;
    const selfToCellZ = context.gridToWorld(cellX, cellZ).z - startZ;
    return selfToCellX * selfToCellX + selfToCellZ * selfToCellZ < threshold * threshold;
  };

  // Retained for future attack-move LOS integration; currently unused because
  // Source parity: C++ attack pathfinding doesn't check LOS at pathfind time.
  const _isAttackLineBlocked = (fromX: number, fromZ: number, toX: number, toZ: number): boolean => {
    if (!needsAttackLineOfSight) {
      return false;
    }
    if (isAttackLineBlockedByTerrain(fromX, fromZ, toX, toZ)) {
      return true;
    }
    if (isAttackLineBlockedByObstacle(fromX, fromZ, toX, toZ)) {
      return true;
    }
    return false;
  };
  void _isAttackLineBlocked;

  if (attackDistance !== NO_ATTACK_DISTANCE) {
    const toTargetDeltaX = targetX - startX;
    const toTargetDeltaZ = targetZ - startZ;
    const targetDistance = Math.hypot(toTargetDeltaX, toTargetDeltaZ);
    if (targetDistance > 0) {
      const stepX = (toTargetDeltaX / targetDistance) * PATHFIND_CELL_SIZE;
      const stepZ = (toTargetDeltaZ / targetDistance) * PATHFIND_CELL_SIZE;
      for (let i = 1; i < 10; i++) {
        const testX = startX + stepX * i * 0.5;
        const testZ = startZ + stepZ * i * 0.5;
        const [testCellX, testCellZ] = context.worldToGrid(testX, testZ);
        if (testCellX === null || testCellZ === null) {
          break;
        }
        if (!canOccupyCell(context, testCellX, testCellZ, movementProfile, grid)) {
          break;
        }
        const dx = testX - targetX;
        const dz = testZ - targetZ;
        const testDistSqr = dx * dx + dz * dz;
        if (testDistSqr > attackDistance * attackDistance) {
          continue;
        }
        if (isNearSelfForAttackMove(testCellX, testCellZ)) {
          continue;
        }
        // Source parity: C++ attack pathfinding doesn't check LOS — just finds
        // a cell within weapon range. LOS verified at fire time.
        return [{ x: startX, z: startZ }, { x: testX, z: testZ }];
      }
    }
  }

  const movementOccupancy = buildMovementOccupancyGrid(context, grid);

  const buildPathFromGoal = (resolvedGoalIndex: number): NavigationVectorXZ[] => {
    const pathCells = reconstructPath(context, parent, startIndex, resolvedGoalIndex);
    if (grid.pinched[resolvedGoalIndex] === 1) {
      const resolvedGoalParentIndex = parent[resolvedGoalIndex];
      if (
        resolvedGoalParentIndex !== undefined
        && resolvedGoalParentIndex >= 0
        && grid.pinched[resolvedGoalParentIndex] === 0
      ) {
        pathCells.pop();
      }
    }
    const smoothed = smoothCellPath(
      context,
      pathCells,
      movementProfile,
      mover,
      movementOccupancy,
      attackDistance === NO_ATTACK_DISTANCE,
    );
    const pathWorld = smoothed.map((cell) => context.gridToWorld(cell.x, cell.z));
    if (pathWorld.length === 0) {
      return [{ x: startX, z: startZ }];
    }

    const first = pathWorld[0];
    if (first && (Math.abs(first.x - startX) > 0.0001 || Math.abs(first.z - startZ) > 0.0001)) {
      pathWorld.unshift({ x: startX, z: startZ });
    }
    return pathWorld;
  };

  gCost[startIndex] = 0;
  fCost[startIndex] = estimateToGoal(effectiveStart.x, effectiveStart.z);
  // Binary min-heap open set: O(log n) insert/extract-min instead of O(n) linear scan.
  const openHeap = new BinaryHeap(total, fCost);
  openHeap.push(startIndex);

  const deltaX = [1, 0, -1, 0, 1, -1, -1, 1];
  const deltaZ = [0, 1, 0, -1, 1, 1, -1, -1];
  const adjacent = [0, 1, 2, 3, 0];
  const neighborFlags = [false, false, false, false, false, false, false, false];
  let searched = 0;

  while (openHeap.length > 0) {
    searched += 1;
    if (searched > MAX_SEARCH_NODES) {
      break;
    }

    const currentIndex = openHeap.pop();
    if (currentIndex < 0) {
      break;
    }
    inClosed[currentIndex] = 1;

    const [currentCellX, currentCellZ] = context.gridFromIndex(currentIndex);
    if (
      attackDistance !== NO_ATTACK_DISTANCE
      && currentIndex !== startIndex
      && isWithinAttackDistance(currentCellX, currentCellZ)
      && !isNearSelfForAttackMove(currentCellX, currentCellZ)
    ) {
      // Source parity: C++ AIPathfind.cpp — pathfinding to within weapon range
      // does NOT check line of sight. LOS is verified at weapon fire time by
      // the combat update system. Checking LOS during pathfinding causes false
      // negatives when the target is a building (its own footprint blocks LOS)
      // or when terrain/obstacle checks are too conservative.
      return buildPathFromGoal(currentIndex);
    }

    if (currentIndex === goalIndex && attackDistance === NO_ATTACK_DISTANCE) {
      return buildPathFromGoal(goalIndex);
    }

    const parentCellIndex = parent[currentIndex];
    let parentCellX: number | undefined;
    let parentCellZ: number | undefined;
    if (parentCellIndex !== undefined && parentCellIndex >= 0) {
      [parentCellX, parentCellZ] = context.gridFromIndex(parentCellIndex);
    }

    for (let i = 0; i < deltaX.length; i++) {
      neighborFlags[i] = false;
      const dirX = deltaX[i];
      const dirZ = deltaZ[i];
      if (dirX === undefined || dirZ === undefined) {
        continue;
      }
      const neighborX = currentCellX + dirX;
      const neighborZ = currentCellZ + dirZ;
      if (!context.isCellInBounds(neighborX, neighborZ, grid)) {
        continue;
      }
      if (isHuman && !isInsideLogicalBounds(neighborX, neighborZ, grid)) {
        continue;
      }
      const neighborIndex = neighborZ * grid.width + neighborX;
      const notZonePassable = ((movementProfile.acceptableSurfaces & LOCOMOTORSURFACE_GROUND) !== 0)
        && !isZonePassable(neighborX, neighborZ, grid);

      if (!canTraverseBridgeTransition(context, currentCellX, currentCellZ, neighborX, neighborZ, movementProfile, grid)) {
        continue;
      }
      if (!canMoveToCell(context.mapHeightmap, currentCellX, currentCellZ, neighborX, neighborZ, movementProfile)) {
        continue;
      }
      if (i >= 4) {
        const side1Index = adjacent[i - 4];
        const side2Index = adjacent[i - 3];
        const side1Passable = side1Index === undefined ? false : neighborFlags[side1Index];
        const side2Passable = side2Index === undefined ? false : neighborFlags[side2Index];
        if (!side1Passable && !side2Passable) {
          continue;
        }
      }

      const clearDiameter = clearCellForDiameter(context, neighborX, neighborZ, movementProfile.pathDiameter, movementProfile, grid);
      if (clearDiameter === 0) {
        continue;
      }
      if (!canOccupyCell(context, neighborX, neighborZ, movementProfile, grid)) {
        continue;
      }

      neighborFlags[i] = true;

      let stepCost = pathCost(context, currentCellX, currentCellZ, neighborX, neighborZ, grid, movementProfile);
      const occupation = checkForMovement(
        context,
        neighborX,
        neighborZ,
        mover,
        grid,
        effectiveStart,
        i,
        false,
        movementOccupancy,
      );
      if (occupation.enemyFixed) {
        continue;
      }
      if (notZonePassable) {
        stepCost += 100 * COST_ORTHOGONAL;
      }
      if (grid.blocked[neighborIndex] === 1) {
        stepCost += 100 * COST_ORTHOGONAL;
      }
      if (occupation.allyMoving && Math.abs(neighborX - effectiveStart.x) < 10 && Math.abs(neighborZ - effectiveStart.z) < 10) {
        stepCost += 3 * COST_DIAGONAL;
      }
      if (occupation.allyFixedCount > 0) {
        stepCost += 3 * COST_DIAGONAL;
      }

      const costRemaining = estimateToGoal(neighborX, neighborZ);
      if (attackDistance !== NO_ATTACK_DISTANCE && occupation.allyGoal) {
        if (mover?.category === 'vehicle') {
          stepCost += 3 * COST_ORTHOGONAL;
        } else {
          stepCost += COST_ORTHOGONAL;
        }
      }

      if (neighborIndex !== goalIndex && movementProfile.pathDiameter > 0 && clearDiameter < movementProfile.pathDiameter) {
        const delta = movementProfile.pathDiameter - clearDiameter;
        stepCost += 0.6 * (delta * COST_ORTHOGONAL);
      }

      if (
        parentCellIndex !== undefined
        && parentCellIndex >= 0
        && parentCellX !== undefined
        && parentCellZ !== undefined
      ) {
        // Turn penalty: compare direction into current cell (parent→current)
        // with direction out to neighbor (current→neighbor), matching pathfinding.ts
        const prevDirX = currentCellX - parentCellX;
        const prevDirZ = currentCellZ - parentCellZ;
        const nextDirX = neighborX - currentCellX;
        const nextDirZ = neighborZ - currentCellZ;

        if (prevDirX !== nextDirX || prevDirZ !== nextDirZ) {
          const dot = prevDirX * nextDirX + prevDirZ * nextDirZ;
          if (dot > 0) {
            stepCost += 4;
          } else if (dot === 0) {
            stepCost += 8;
          } else {
            stepCost += 16;
          }
        }
      }

      const currentG = gCost[currentIndex];
      const neighborG = gCost[neighborIndex];
      if (currentG === undefined || neighborG === undefined) {
        continue;
      }
      const tentativeG = currentG + stepCost;
      if (tentativeG >= neighborG) {
        continue;
      }

      parent[neighborIndex] = currentIndex;
      gCost[neighborIndex] = tentativeG;
      fCost[neighborIndex] = tentativeG + costRemaining;
      if (openHeap.contains(neighborIndex)) {
        // Already in open set — decrease-key to re-sort in O(log n).
        openHeap.decreaseKey(neighborIndex);
      } else {
        if (inClosed[neighborIndex] === 1) {
          inClosed[neighborIndex] = 0;
        }
        openHeap.push(neighborIndex);
      }
    }
  }

  return [];
}

function getMovementProfile(entity?: Pick<
  NavigationEntityLike,
  'locomotorSurfaceMask' | 'locomotorDownhillOnly' | 'pathDiameter' | 'kindOf'
>): PathfindingProfile {
  const rawMask = entity?.locomotorSurfaceMask;
  const rawDownhillOnly = entity?.locomotorDownhillOnly;
  const rawDiameter = entity?.pathDiameter;
  const mask = typeof rawMask === 'number' ? rawMask : SOURCE_DEFAULT_PASSABLE_SURFACES;
  const downhillOnly = rawDownhillOnly === true;
  const pathDiameter = typeof rawDiameter === 'number' && rawDiameter >= 0 && Number.isFinite(rawDiameter)
    ? Math.max(0, Math.trunc(rawDiameter))
    : 0;
  const kindOf = entity?.kindOf;

  return {
    acceptableSurfaces: mask,
    downhillOnly,
    canPassObstacle: (mask & LOCOMOTORSURFACE_AIR) !== 0,
    canUseBridge: true,
    avoidPinched: false,
    pathDiameter,
    // Source parity: ZH AIGroup.cpp:1664-1674 — CLIFF_JUMPER vehicles bypass cliff terrain.
    isCliffJumper: kindOf?.has('CLIFF_JUMPER') === true,
    // Source parity: ZH AIPathfind.cpp:6236-6243 — dozers can path through non-enemy obstacle cells.
    isDozer: kindOf?.has('DOZER') === true,
  };
}

function getPathfindRadiusAndCenter(
  entity?: Pick<NavigationEntityLike, 'pathDiameter' | 'pathfindCenterInCell'>,
): { pathRadius: number; centerInCell: boolean } {
  const pathRadius = Math.max(0, Math.trunc(entity?.pathDiameter ?? 0));
  const centerInCell = entity?.pathfindCenterInCell ?? ((pathRadius & 1) === 1);
  return { pathRadius, centerInCell };
}

function canMoveToCell(
  heightmap: HeightmapGrid | null,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  movementProfile: PathfindingProfile,
): boolean {
  if (movementProfile.downhillOnly && heightmap) {
    const fromHeight = heightmap.getWorldHeight(fromX * MAP_XY_FACTOR, fromZ * MAP_XY_FACTOR);
    const toHeight = heightmap.getWorldHeight(toX * MAP_XY_FACTOR, toZ * MAP_XY_FACTOR);
    return toHeight <= fromHeight;
  }

  return true;
}

function isInsideLogicalBounds(cellX: number, cellZ: number, grid: NavigationGridLike): boolean {
  const hasLogicalBounds = (
    Number.isFinite(grid.logicalMinX)
    && Number.isFinite(grid.logicalMaxX)
    && Number.isFinite(grid.logicalMinZ)
    && Number.isFinite(grid.logicalMaxZ)
  );
  if (!hasLogicalBounds || grid.logicalMinX > grid.logicalMaxX || grid.logicalMinZ > grid.logicalMaxZ) {
    return true;
  }

  return (
    cellX >= grid.logicalMinX
    && cellX <= grid.logicalMaxX
    && cellZ >= grid.logicalMinZ
    && cellZ <= grid.logicalMaxZ
  );
}

function checkForMovement<TEntity extends NavigationEntityLike>(
  context: NavigationPathfindingContext<TEntity>,
  cellX: number,
  cellZ: number,
  mover: TEntity | undefined,
  grid: NavigationGridLike | null,
  effectiveStart: GridCell,
  directionIndex: number,
  considerTransient = false,
  movementOccupancy?: MovementOccupancyGrid,
): PathingOccupationResult {
  void effectiveStart;
  void directionIndex;
  const result: PathingOccupationResult = {
    enemyFixed: false,
    allyMoving: false,
    allyFixedCount: 0,
    allyGoal: false,
  };

  if (!mover || !grid) {
    return result;
  }
  const occupancy = movementOccupancy ?? buildMovementOccupancyGrid(context, grid);

  const { pathRadius: movementRadius, centerInCell } = getPathfindRadiusAndCenter(mover);
  const numCellsAbove = movementRadius === 0
    ? 1
    : movementRadius + (centerInCell ? 1 : 0);
  const maxAlly = 5;
  const maxCellX = cellX + numCellsAbove;
  const maxCellZ = cellZ + numCellsAbove;
  const ignoredObstacleId = mover.ignoredMovementObstacleId;

  const allies: number[] = [];
  for (let i = cellX - movementRadius; i < maxCellX; i++) {
    for (let j = cellZ - movementRadius; j < maxCellZ; j++) {
      if (!context.isCellInBounds(i, j, grid)) {
        result.enemyFixed = true;
        return result;
      }

      const cellIndex = j * occupancy.width + i;
      if (cellIndex < 0 || cellIndex >= occupancy.flags.length) {
        result.enemyFixed = true;
        return result;
      }

      const flags = occupancy.flags[cellIndex] ?? UNIT_NO_UNITS;
      const posUnit = occupancy.unitIds[cellIndex] ?? -1;
      if (flags === UNIT_GOAL || flags === UNIT_GOAL_OTHER_MOVING) {
        result.allyGoal = true;
      }
      if (flags === UNIT_NO_UNITS) {
        continue;
      }
      if (posUnit === mover.id) {
        continue;
      }
      if (ignoredObstacleId !== null && posUnit === ignoredObstacleId) {
        continue;
      }

      const unit = context.spawnedEntities.get(posUnit);
      if (!unit) {
        continue;
      }

      let check = false;
      if (flags === UNIT_PRESENT_MOVING || flags === UNIT_GOAL_OTHER_MOVING) {
        const isAlly = context.getTeamRelationship(mover, unit) === context.relationshipAllies;
        if (isAlly) {
          result.allyMoving = true;
        }
        if (considerTransient) {
          check = true;
        }
      }

      if (flags === UNIT_PRESENT_FIXED) {
        check = true;
      }

      if (check && mover.ignoredMovementObstacleId !== null && mover.ignoredMovementObstacleId === unit.id) {
        check = false;
      }

      if (!check) {
        continue;
      }

      if (mover.category === 'infantry' && unit.category === 'infantry') {
        continue;
      }

      if (context.getTeamRelationship(mover, unit) === context.relationshipAllies) {
        if (!unit.canMove || (considerTransient && unit.moving)) {
          result.enemyFixed = true;
          return result;
        }
        if (!allies.includes(unit.id)) {
          result.allyFixedCount += 1;
          if (allies.length < maxAlly) {
            allies.push(unit.id);
          }
        }
        continue;
      }

      if (!context.canCrushOrSquish(mover, unit)) {
        result.enemyFixed = true;
      }
    }
  }

  return result;
}

function buildMovementOccupancyGrid<TEntity extends NavigationEntityLike>(
  context: NavigationPathfindingContext<TEntity>,
  grid: NavigationGridLike,
): MovementOccupancyGrid {
  const total = grid.width * grid.height;
  const flags = new Uint8Array(total);
  const unitIds = new Int32Array(total);
  const goalUnitIds = new Int32Array(total);
  unitIds.fill(-1);
  goalUnitIds.fill(-1);

  for (const entity of context.spawnedEntities.values()) {
    if (!entity.blocksPath && entity.pathDiameter <= 0 && entity.obstacleFootprint <= 0) {
      continue;
    }
    // Source parity: NO_COLLISIONS status disables pathfinding obstacle presence.
    if (entity.noCollisions) {
      continue;
    }

    const entityPosCell = entity.pathfindPosCell;
    if (!entityPosCell) {
      continue;
    }

    const { pathRadius: entityRadius, centerInCell } = getPathfindRadiusAndCenter(entity);
    const numCellsAbove = entityRadius === 0 ? 1 : entityRadius + (centerInCell ? 1 : 0);

    const flag = entity.moving ? UNIT_PRESENT_MOVING : UNIT_PRESENT_FIXED;
    for (let i = entityPosCell.x - entityRadius; i < entityPosCell.x + numCellsAbove; i++) {
      for (let j = entityPosCell.z - entityRadius; j < entityPosCell.z + numCellsAbove; j++) {
        if (!context.isCellInBounds(i, j, grid)) {
          continue;
        }
        const index = j * grid.width + i;
        const posUnit = unitIds[index] ?? -1;
        if (posUnit === entity.id) {
          continue;
        }

        const goalUnit = goalUnitIds[index] ?? -1;
        if (goalUnit === entity.id) {
          flags[index] = UNIT_PRESENT_FIXED;
        } else if (goalUnit === -1) {
          flags[index] = flag;
        } else {
          flags[index] = UNIT_GOAL_OTHER_MOVING;
        }

        unitIds[index] = entity.id;
      }
    }
  }

  for (const entity of context.spawnedEntities.values()) {
    const goal = getEntityGoalCell(entity);
    if (!goal) {
      continue;
    }
    const { pathRadius: movementRadius, centerInCell } = getPathfindRadiusAndCenter(entity);
    const numCellsAbove = movementRadius === 0
      ? 1
      : movementRadius + (centerInCell ? 1 : 0);
    const maxCellX = goal.x + numCellsAbove;
    const maxCellZ = goal.z + numCellsAbove;

    for (let i = goal.x - movementRadius; i < maxCellX; i++) {
      for (let j = goal.z - movementRadius; j < maxCellZ; j++) {
        if (!context.isCellInBounds(i, j, grid)) {
          continue;
        }
        const index = j * grid.width + i;
        goalUnitIds[index] = entity.id;

        const posUnit = unitIds[index] ?? -1;
        if (posUnit === entity.id) {
          if (entity.pathfindGoalCell) {
            flags[index] = UNIT_GOAL_OTHER_MOVING;
          } else {
            flags[index] = UNIT_PRESENT_FIXED;
          }
          goalUnitIds[index] = entity.id;
          continue;
        }

        flags[index] = posUnit === -1 ? UNIT_GOAL : UNIT_GOAL_OTHER_MOVING;
        goalUnitIds[index] = entity.id;
      }
    }
  }

  return {
    width: grid.width,
    height: grid.height,
    flags,
    unitIds,
    goalUnitIds,
  };
}

function getEntityGoalCell<TEntity extends Pick<NavigationEntityLike, 'pathfindGoalCell'>>(
  entity: TEntity,
): GridCell | null {
  return entity.pathfindGoalCell;
}

function pathCost(
  context: NavigationPathfindingContext<NavigationEntityLike>,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  grid: NavigationGridLike,
  profile: PathfindingProfile,
): number {
  const index = toZ * grid.width + toX;
  if (index < 0 || index >= grid.terrainType.length) {
    return MAX_PATH_COST;
  }
  const type = grid.terrainType[index];
  if (type === undefined) {
    return MAX_PATH_COST;
  }
  const isDiagonal = Math.abs(toX - fromX) === 1 && Math.abs(toZ - fromZ) === 1;
  let cost = isDiagonal ? COST_DIAGONAL : COST_ORTHOGONAL;

  let toSurfaces = validLocomotorSurfacesForCellType(type, grid, index);
  // Source parity: ZH CLIFF_JUMPER treats cliff as ground in cost evaluation.
  if (profile.isCliffJumper && type === NAV_CLIFF) {
    toSurfaces |= LOCOMOTORSURFACE_GROUND;
  }
  if ((profile.acceptableSurfaces & toSurfaces) === 0) {
    return MAX_PATH_COST;
  }
  if (!canMoveToCell(context.mapHeightmap, fromX, fromZ, toX, toZ, profile)) {
    return MAX_PATH_COST;
  }

  const blocked = grid.blocked[index];
  // Source parity: ZH dozers can path through obstacle cells.
  if (blocked === undefined || (blocked === 1 && !profile.canPassObstacle && !profile.isDozer)) {
    return MAX_PATH_COST;
  }

  const pinched = grid.pinched[index] ?? 0;
  if (type === NAV_CLIFF && pinched === 0) {
    const fromWorldX = fromX * MAP_XY_FACTOR;
    const fromWorldZ = fromZ * MAP_XY_FACTOR;
    const toWorldX = toX * MAP_XY_FACTOR;
    const toWorldZ = toZ * MAP_XY_FACTOR;
    if (context.mapHeightmap && Math.abs(
      context.mapHeightmap.getWorldHeight(fromWorldX, fromWorldZ)
      - context.mapHeightmap.getWorldHeight(toWorldX, toWorldZ),
    ) < MAP_XY_FACTOR) {
      cost += 7 * COST_DIAGONAL;
    }
  }
  if (pinched === 1) {
    cost += COST_DIAGONAL;
  }

  return cost;
}

function pathHeuristic(cellX: number, cellZ: number, targetX: number, targetZ: number): number {
  const dx = Math.abs(cellX - targetX);
  const dz = Math.abs(cellZ - targetZ);
  if (dx > dz) {
    return COST_ORTHOGONAL * dx + ((COST_ORTHOGONAL * dz) >> 1);
  }
  return COST_ORTHOGONAL * dz + ((COST_ORTHOGONAL * dx) >> 1);
}

function reconstructPath(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'gridFromIndex'>,
  parent: Int32Array,
  startIndex: number,
  goalIndex: number,
): GridCell[] {
  const cells: GridCell[] = [];
  let current = goalIndex;
  let steps = 0;
  while (current !== startIndex && current >= 0 && steps < MAX_RECONSTRUCT_STEPS) {
    const [x, z] = context.gridFromIndex(current);
    cells.push({ x, z });
    const next = parent[current];
    if (next === undefined || next < 0) {
      break;
    }
    current = next;
    steps += 1;
  }

  cells.reverse();
  const [startX, startZ] = context.gridFromIndex(startIndex);
  cells.unshift({ x: startX, z: startZ });
  return cells;
}

function smoothCellPath<TEntity extends NavigationEntityLike>(
  context: NavigationPathfindingContext<TEntity>,
  cells: GridCell[],
  profile: PathfindingProfile,
  mover?: TEntity,
  movementOccupancy?: MovementOccupancyGrid,
  preserveAllyGoalCells = false,
): GridCell[] {
  if (cells.length <= 2) {
    return cells;
  }

  const smoothed: GridCell[] = [];
  let anchor = 0;
  let candidate = 2;
  smoothed.push(cells[0]!);
  const optimizeProfile: PathfindingProfile = {
    ...profile,
    // Match source Path::optimize() behavior for LOS: allow pinched cells while
    // line-of-sight evaluating and defer pinched handling to movement checks.
    avoidPinched: false,
  };

  while (anchor < cells.length - 1) {
    if (candidate >= cells.length) {
      const last = smoothed[smoothed.length - 1];
      const goal = cells[cells.length - 1];
      if (!last || !goal || last.x !== goal.x || last.z !== goal.z) {
        if (goal) {
          smoothed.push(goal);
        }
      }
      break;
    }

    if (gridLineClear(
      context,
      cells[anchor]!,
      cells[candidate]!,
      context.navigationGrid,
      optimizeProfile,
      mover,
      movementOccupancy,
    )) {
      if (
        preserveAllyGoalCells
        && pathSegmentContainsAllyGoal(context, cells, anchor, candidate, movementOccupancy, context.navigationGrid)
      ) {
        if (candidate - anchor > 1) {
          smoothed.push(cells[candidate - 1]!);
          anchor = candidate - 1;
          candidate = anchor + 2;
        } else {
          candidate += 1;
        }
        continue;
      }
      candidate += 1;
    } else if (canBypassClearanceFailureAsMonotonicSegment(cells, anchor, candidate)) {
      candidate += 1;
    } else {
      smoothed.push(cells[candidate - 1]!);
      anchor = candidate - 1;
      candidate = anchor + 2;
    }
  }

  return smoothed;
}

function pathSegmentContainsAllyGoal(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds'>,
  cells: GridCell[],
  startIndex: number,
  endIndex: number,
  movementOccupancy?: MovementOccupancyGrid,
  grid?: NavigationGridLike | null,
): boolean {
  if (!movementOccupancy || endIndex - startIndex <= 1) {
    return false;
  }

  for (let i = startIndex + 1; i < endIndex; i++) {
    const cell = cells[i];
    if (!cell) {
      continue;
    }
    if (!context.isCellInBounds(cell.x, cell.z, grid)) {
      return true;
    }
    const index = cell.z * movementOccupancy.width + cell.x;
    if (index < 0 || index >= movementOccupancy.flags.length) {
      return true;
    }
    const flags = movementOccupancy.flags[index];
    if (flags === UNIT_GOAL || flags === UNIT_GOAL_OTHER_MOVING) {
      return true;
    }
  }

  return false;
}

function canBypassClearanceFailureAsMonotonicSegment(
  cells: GridCell[],
  anchorIndex: number,
  candidateIndex: number,
): boolean {
  if (anchorIndex < 0 || candidateIndex <= anchorIndex || candidateIndex >= cells.length) {
    return false;
  }

  const anchor = cells[anchorIndex];
  const candidate = cells[candidateIndex];
  if (!anchor || !candidate) {
    return false;
  }

  const deltaX = candidate.x - anchor.x;
  const deltaZ = candidate.z - anchor.z;
  if (deltaX === 0) {
    for (let i = anchorIndex + 1; i <= candidateIndex; i++) {
      const prev = cells[i - 1];
      const cur = cells[i];
      if (!prev || !cur || cur.x - prev.x !== 0) {
        return false;
      }
    }
    return true;
  }

  if (deltaZ === 0) {
    for (let i = anchorIndex + 1; i <= candidateIndex; i++) {
      const prev = cells[i - 1];
      const cur = cells[i];
      if (!prev || !cur || cur.z - prev.z !== 0) {
        return false;
      }
    }
    return true;
  }

  if (deltaX === deltaZ) {
    for (let i = anchorIndex + 1; i <= candidateIndex; i++) {
      const prev = cells[i - 1];
      const cur = cells[i];
      if (!prev || !cur || cur.z - prev.z !== cur.x - prev.x) {
        return false;
      }
    }
    return true;
  }

  if (deltaX === -deltaZ) {
    for (let i = anchorIndex + 1; i <= candidateIndex; i++) {
      const prev = cells[i - 1];
      const cur = cells[i];
      if (!prev || !cur || cur.z - prev.z !== - (cur.x - prev.x)) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function gridLineClear<TEntity extends NavigationEntityLike>(
  context: NavigationPathfindingContext<TEntity>,
  start: GridCell,
  end: GridCell,
  grid: NavigationGridLike | null,
  profile: PathfindingProfile,
  mover?: TEntity,
  movementOccupancy?: MovementOccupancyGrid,
): boolean {
  if (!grid) return false;
  const effectiveStart = start;
  if (start.x === end.x && start.z === end.z) {
    if (mover) {
      const occupation = checkForMovement(
        context,
        start.x,
        start.z,
        mover,
        grid,
        effectiveStart,
        0,
        false,
        movementOccupancy,
      );
      if (occupation.enemyFixed || occupation.allyFixedCount > 0) {
        return false;
      }
    }
    if (profile.avoidPinched && grid.pinched[start.z * grid.width + start.x] === 1) {
      return false;
    }
    if (!canLineOfSightOccupyCell(context, start.x, start.z, profile, grid)) {
      return false;
    }
    return true;
  }

  const deltaX = Math.abs(end.x - start.x);
  const deltaZ = Math.abs(end.z - start.z);

  let xinc1: number;
  let xinc2: number;
  if (end.x >= start.x) {
    xinc1 = 1;
    xinc2 = 1;
  } else {
    xinc1 = -1;
    xinc2 = -1;
  }

  let zinc1: number;
  let zinc2: number;
  if (end.z >= start.z) {
    zinc1 = 1;
    zinc2 = 1;
  } else {
    zinc1 = -1;
    zinc2 = -1;
  }

  let den: number;
  let num: number;
  let numadd: number;
  const numpixels = deltaX >= deltaZ ? deltaX : deltaZ;
  if (deltaX >= deltaZ) {
    xinc1 = 0;
    zinc2 = 0;
    den = deltaX;
    num = Math.floor(deltaX / 2);
    numadd = deltaZ;
  } else {
    xinc2 = 0;
    zinc1 = 0;
    den = deltaZ;
    num = Math.floor(deltaZ / 2);
    numadd = deltaX;
  }

  const checkCell = (
    cellX: number,
    cellZ: number,
  ): boolean => {
    if (mover) {
      const occupation = checkForMovement(
        context,
        cellX,
        cellZ,
        mover,
        grid,
        effectiveStart,
        0,
        false,
        movementOccupancy,
      );
      if (occupation.enemyFixed || occupation.allyFixedCount > 0) {
        return false;
      }
    }
    if (profile.avoidPinched && grid.pinched[cellZ * grid.width + cellX] === 1) {
      return false;
    }
    if (!canLineOfSightOccupyCell(context, cellX, cellZ, profile, grid)) {
      return false;
    }
    return true;
  };

  let x = start.x;
  let z = start.z;

  for (let curpixel = 0; curpixel <= numpixels; curpixel++) {
    if (!checkCell(x, z)) {
      return false;
    }

    num += numadd;
    if (num >= den) {
      num -= den;
      x += xinc1;
      z += zinc1;
      if (!checkCell(x, z)) {
        return false;
      }
    }
    x += xinc2;
    z += zinc2;
  }

  return true;
}

function canOccupyCell(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds' | 'navigationGrid'>,
  cellX: number,
  cellZ: number,
  profile: PathfindingProfile,
  nav: NavigationGridLike | null = context.navigationGrid,
  exact = false,
): boolean {
  if (!nav || !context.isCellInBounds(cellX, cellZ, nav)) {
    return false;
  }
  const exactDiameter = profile.pathDiameter ?? 0;
  const clearDiameter = clearCellForDiameter(context, cellX, cellZ, exactDiameter, profile, nav);
  if (clearDiameter < 1) {
    return false;
  }

  if (exactDiameter > 0 && exact && clearDiameter !== exactDiameter) {
    return false;
  }
  return true;
}

function canLineOfSightOccupyCell(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds' | 'navigationGrid'>,
  cellX: number,
  cellZ: number,
  profile: PathfindingProfile,
  nav: NavigationGridLike | null = context.navigationGrid,
): boolean {
  // Mirrors source Pathfinder::validMovementPosition flow used by line-of-sight checks:
  // occupancy and bridge checks already happened in gridLineClear; this checks
  // terrain/surface compatibility only.
  if (!nav || !context.isCellInBounds(cellX, cellZ, nav)) {
    return false;
  }
  return canOccupyCellCenter(cellX, cellZ, profile, nav);
}

function clearCellForDiameter(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds' | 'navigationGrid'>,
  cellX: number,
  cellZ: number,
  pathDiameter: number,
  profile: PathfindingProfile,
  nav: NavigationGridLike,
): number {
  const normalizedPathDiameter = Number.isFinite(pathDiameter) ? Math.max(0, Math.trunc(pathDiameter)) : 0;
  const clearDiameter = clearCellForExactDiameter(context, cellX, cellZ, normalizedPathDiameter, profile, nav);
  if (clearDiameter === 0) {
    if (normalizedPathDiameter < 2) {
      return 0;
    }
    return clearCellForDiameter(context, cellX, cellZ, normalizedPathDiameter - 2, profile, nav);
  }
  return clearDiameter;
}

function clearCellForExactDiameter(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds' | 'navigationGrid'>,
  cellX: number,
  cellZ: number,
  pathDiameter: number,
  profile: PathfindingProfile,
  nav: NavigationGridLike,
): number {
  if (!canOccupyCellCenter(cellX, cellZ, profile, nav)) {
    return 0;
  }

  const radius = Math.max(0, Math.trunc(pathDiameter / 2));
  const numCellsAbove = radius + 1;
  const cutCorners = radius > 1;

  for (let i = cellX - radius; i < cellX + numCellsAbove; i++) {
    const isMinOrMaxX = i === cellX - radius;
    const isMaxX = i === cellX + numCellsAbove - 1;
    const xMinOrMax = isMinOrMaxX || isMaxX;
    for (let j = cellZ - radius; j < cellZ + numCellsAbove; j++) {
      const isMinOrMaxZ = j === cellZ - radius;
      const isMaxZ = j === cellZ + numCellsAbove - 1;
      const zMinOrMax = isMinOrMaxZ || isMaxZ;
      if (xMinOrMax && zMinOrMax && cutCorners) {
        continue;
      }
      if (!context.isCellInBounds(i, j, nav)) {
        return 0;
      }
      if (!canOccupyCellCenter(i, j, profile, nav)) {
        return 0;
      }
    }
  }

  if (Math.floor(radius) === 0) {
    return 1;
  }
  return radius * 2;
}

function canOccupyCellCenter(
  cellX: number,
  cellZ: number,
  profile: PathfindingProfile,
  nav: NavigationGridLike,
): boolean {
  const index = cellZ * nav.width + cellX;
  const terrain = nav.terrainType[index];
  if (terrain === undefined) {
    return false;
  }
  if (nav.bridgePassable[index] === 1) {
    const bridgeSurfaces = LOCOMOTORSURFACE_GROUND | LOCOMOTORSURFACE_AIR;
    if (!profile.canUseBridge || (profile.acceptableSurfaces & bridgeSurfaces) === 0) {
      return false;
    }
    return true;
  }
  // Source parity: ZH AIPathfind.cpp:6236-6243 — dozers can path through non-enemy obstacle cells.
  if (nav.blocked[index] === 1 && !profile.canPassObstacle && !profile.isDozer) {
    return false;
  }
  let cellSurfaces = validLocomotorSurfacesForCellType(terrain, nav, index);
  // Source parity: ZH AIGroup.cpp:1664-1674 — CLIFF_JUMPER vehicles treat cliff terrain as ground.
  if (profile.isCliffJumper && terrain === NAV_CLIFF) {
    cellSurfaces |= LOCOMOTORSURFACE_GROUND;
  }
  if ((profile.acceptableSurfaces & cellSurfaces) === 0) {
    return false;
  }
  if (profile.avoidPinched && nav.pinched[index] === 1) {
    return false;
  }
  return true;
}

function isZoneBlockIndex(cellX: number, cellZ: number, grid: NavigationGridLike): number {
  const blockX = Math.floor(cellX / PATHFIND_ZONE_BLOCK_SIZE);
  const blockY = Math.floor(cellZ / PATHFIND_ZONE_BLOCK_SIZE);
  if (blockX < 0 || blockX >= grid.zoneBlockWidth) {
    return -1;
  }
  if (blockY < 0 || blockY >= grid.zoneBlockHeight) {
    return -1;
  }
  return blockY * grid.zoneBlockWidth + blockX;
}

function isZonePassable(cellX: number, cellZ: number, grid: NavigationGridLike): boolean {
  const blockIndex = isZoneBlockIndex(cellX, cellZ, grid);
  if (blockIndex < 0) {
    return false;
  }
  if (!grid.zonePassable || blockIndex >= grid.zonePassable.length) {
    return true;
  }
  return grid.zonePassable[blockIndex] === 1;
}

function validLocomotorSurfacesForCellType(
  terrainType: number,
  nav: NavigationGridLike,
  cellIndex: number,
): number {
  if (nav.bridgePassable[cellIndex] === 1) {
    return LOCOMOTORSURFACE_GROUND | LOCOMOTORSURFACE_AIR;
  }
  switch (terrainType) {
    case NAV_OBSTACLE:
    case NAV_IMPASSABLE:
    case NAV_BRIDGE_IMPASSABLE:
      return LOCOMOTORSURFACE_AIR;
    case NAV_CLEAR:
      return LOCOMOTORSURFACE_GROUND | LOCOMOTORSURFACE_AIR;
    case NAV_WATER:
      return LOCOMOTORSURFACE_WATER | LOCOMOTORSURFACE_AIR;
    case NAV_RUBBLE:
      return LOCOMOTORSURFACE_RUBBLE | LOCOMOTORSURFACE_AIR;
    case NAV_CLIFF:
      return LOCOMOTORSURFACE_CLIFF | LOCOMOTORSURFACE_AIR;
    case NAV_BRIDGE:
      return nav.bridgePassable[cellIndex] === 1
        ? LOCOMOTORSURFACE_GROUND | LOCOMOTORSURFACE_AIR
        : LOCOMOTORSURFACE_AIR;
    default:
      return NO_SURFACES;
  }
}

function canTraverseBridgeTransition(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds' | 'navigationGrid'>,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  profile: PathfindingProfile,
  nav: NavigationGridLike | null = context.navigationGrid,
): boolean {
  if (!nav) {
    return false;
  }
  if (!context.isCellInBounds(fromX, fromZ, nav) || !context.isCellInBounds(toX, toZ, nav)) {
    return false;
  }
  const fromIndex = fromZ * nav.width + fromX;
  const toIndex = toZ * nav.width + toX;
  const fromBridge = nav.bridgePassable[fromIndex] === 1;
  const toBridge = nav.bridgePassable[toIndex] === 1;

  if (!fromBridge && !toBridge) {
    return true;
  }
  if (fromBridge && toBridge) {
    return true;
  }
  if (!profile.canUseBridge) {
    return false;
  }
  return nav.bridgeTransitions[fromIndex] === 1 || nav.bridgeTransitions[toIndex] === 1;
}

function findNearestPassableCell(
  context: Pick<NavigationPathfindingContext<NavigationEntityLike>, 'isCellInBounds' | 'navigationGrid'>,
  cellX: number,
  cellZ: number,
  grid: NavigationGridLike,
  profile: PathfindingProfile,
  exact = false,
  maxOffset = 400,
): GridCell | null {
  if (canOccupyCell(context, cellX, cellZ, profile, grid, exact)) {
    return { x: cellX, z: cellZ };
  }

  let delta = 1;
  let i = cellX;
  let j = cellZ;
  let remaining = maxOffset;
  let count: number;

  while (remaining > 0) {
    for (count = delta; count > 0 && remaining > 0; count--) {
      i += 1;
      if (context.isCellInBounds(i, j, grid) && canOccupyCell(context, i, j, profile, grid, exact)) {
        return { x: i, z: j };
      }
      remaining--;
    }

    for (count = delta; count > 0 && remaining > 0; count--) {
      j += 1;
      if (context.isCellInBounds(i, j, grid) && canOccupyCell(context, i, j, profile, grid, exact)) {
        return { x: i, z: j };
      }
      remaining--;
    }

    delta += 1;

    for (count = delta; count > 0 && remaining > 0; count--) {
      i -= 1;
      if (context.isCellInBounds(i, j, grid) && canOccupyCell(context, i, j, profile, grid, exact)) {
        return { x: i, z: j };
      }
      remaining--;
    }

    for (count = delta; count > 0 && remaining > 0; count--) {
      j -= 1;
      if (context.isCellInBounds(i, j, grid) && canOccupyCell(context, i, j, profile, grid, exact)) {
        return { x: i, z: j };
      }
      remaining--;
    }

    delta += 1;
  }

  return null;
}

// ---------------------------------------------------------------------------
// moveAlliesAlongPath — post-pathfind ally shove
// Source parity: ZH AIPathfind.cpp Pathfinder::moveAllies (lines 10112-10188)
// ---------------------------------------------------------------------------

/**
 * Result describing which allies should be moved out of the way.
 * Callers use this to issue move-away commands to the identified entities.
 */
export interface MoveAllyResult {
  entityId: number;
}

/**
 * Source parity: Pathfinder::moveAllies — after a path is computed, identify
 * allied units sitting on the path that should move out of the way.
 *
 * ZH differences from Generals:
 *   - Fix 2: Dozers and harvesters always request clear paths (line 10120-10122).
 *   - Fix 3 (Patch 1.01): Don't tell busy or ability-using units to move (lines 10173-10178).
 */
export function moveAlliesAlongPath<TEntity extends NavigationEntityLike>(
  context: NavigationPathfindingContext<TEntity>,
  mover: TEntity,
  pathCells: GridCell[],
  movementOccupancy?: MovementOccupancyGrid,
  blockedByAlly = false,
): MoveAllyResult[] {
  const grid = context.navigationGrid;
  if (!grid) {
    return [];
  }

  const kindOf = mover.kindOf;
  const isDozerOrHarvester = kindOf?.has('DOZER') === true || kindOf?.has('HARVESTER') === true;

  // Source parity: AIPathfind.cpp:10120-10122 — dozers/harvesters always want a clear path;
  // other units only shove allies when their path is actually blocked by one.
  if (!isDozerOrHarvester && !blockedByAlly) {
    return [];
  }

  const occupancy = movementOccupancy ?? buildMovementOccupancyGrid(context, grid);
  const { pathRadius: movementRadius, centerInCell } = getPathfindRadiusAndCenter(mover);
  const numCellsAbove = movementRadius === 0 ? 1 : movementRadius + (centerInCell ? 1 : 0);
  const ignoreId = mover.ignoredMovementObstacleId;

  const results: MoveAllyResult[] = [];
  const seenIds = new Set<number>();

  for (const cell of pathCells) {
    for (let ci = cell.x - movementRadius; ci < cell.x + numCellsAbove; ci++) {
      for (let cj = cell.z - movementRadius; cj < cell.z + numCellsAbove; cj++) {
        if (!context.isCellInBounds(ci, cj, grid)) {
          continue;
        }
        const cellIndex = cj * occupancy.width + ci;
        if (cellIndex < 0 || cellIndex >= occupancy.flags.length) {
          continue;
        }
        const posUnit = occupancy.unitIds[cellIndex] ?? -1;
        if (posUnit <= 0 || posUnit === mover.id) {
          continue;
        }
        if (ignoreId !== null && posUnit === ignoreId) {
          continue;
        }
        if (seenIds.has(posUnit)) {
          continue;
        }

        const otherObj = context.spawnedEntities.get(posUnit);
        if (!otherObj) {
          continue;
        }

        // Source parity: only move allies.
        if (context.getTeamRelationship(mover, otherObj) !== context.relationshipAllies) {
          continue;
        }

        // Source parity: infantry can walk through other infantry.
        if (mover.kindOf?.has('INFANTRY') && otherObj.kindOf?.has('INFANTRY')) {
          continue;
        }

        // Source parity: infantry don't push vehicles (unless directly blocked).
        if (mover.kindOf?.has('INFANTRY') && !otherObj.kindOf?.has('INFANTRY')) {
          if (!blockedByAlly) {
            continue;
          }
        }

        // Only shove non-moving units.
        if (!otherObj.moving) {
          // Source parity: don't move units that are attacking.
          if (otherObj.isAttacking) {
            continue;
          }

          // Source parity: ZH Patch 1.01 — don't tell busy/using-ability units to move.
          // AIPathfind.cpp:10173-10178 — Black Lotus exploit fix.
          if (otherObj.isUsingAbility || otherObj.isBusy) {
            continue;
          }

          seenIds.add(posUnit);
          results.push({ entityId: posUnit });
        }
      }
    }
  }

  return results;
}
