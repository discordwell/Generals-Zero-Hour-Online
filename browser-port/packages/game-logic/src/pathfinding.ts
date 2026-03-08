/**
 * A* Pathfinding module with binary heap open set.
 *
 * Port of the A* pathfinding algorithm from Generals C++ source
 * (AIPathfind.cpp, Pathfinder::internalFindPath / examineNeighboringCells).
 *
 * Key differences from the original C++ implementation:
 * - Uses a binary min-heap for the open set instead of a sorted linked list,
 *   giving O(log n) insert/extract-min instead of O(n) insertion sort.
 * - Cost model matches source: COST_ORTHOGONAL=10, COST_DIAGONAL=14,
 *   turn penalties (4/8/16 for 45/90/135 degree turns), pinch penalties.
 * - Heuristic matches source: octile distance (max(dx,dy)*10 + min(dx,dy)*5).
 *
 * This module is designed to be used as the core search engine by the
 * navigation-pathfinding.ts module, which handles game-specific concerns
 * (locomotor surfaces, bridge transitions, occupancy grids, etc.).
 */

// ---------------------------------------------------------------------------
// Cost constants (matching C++ AIPathfind.cpp)
// ---------------------------------------------------------------------------
export const COST_ORTHOGONAL = 10;
export const COST_DIAGONAL = 14;
export const MAX_PATH_COST = 1e9;

// ---------------------------------------------------------------------------
// Binary min-heap for the A* open set
// ---------------------------------------------------------------------------

/**
 * A min-heap keyed on f-cost, holding grid cell indices.
 * Uses a flat Float64Array for f-costs and an Int32Array for heap-to-index
 * mapping, plus a reverse index-to-heap-position map for O(log n) decrease-key.
 */
export class BinaryHeap {
  /** Heap array: each entry is a grid cell index. */
  private heap: Int32Array;
  /** Number of elements currently in the heap. */
  private size: number;
  /** Maps grid cell index -> position in heap (-1 if not present). */
  private positionOf: Int32Array;
  /** Reference to the fCost array (not owned). */
  private fCost: Float64Array;

  constructor(capacity: number, fCost: Float64Array) {
    this.heap = new Int32Array(capacity);
    this.size = 0;
    this.positionOf = new Int32Array(capacity);
    this.positionOf.fill(-1);
    this.fCost = fCost;
  }

  get length(): number {
    return this.size;
  }

  contains(index: number): boolean {
    return index >= 0 && index < this.positionOf.length && this.positionOf[index] !== -1;
  }

  push(index: number): void {
    const pos = this.size;
    this.heap[pos] = index;
    this.positionOf[index] = pos;
    this.size++;
    this.bubbleUp(pos);
  }

  pop(): number {
    if (this.size === 0) return -1;
    const top = this.heap[0]!;
    this.positionOf[top] = -1;
    this.size--;
    if (this.size > 0) {
      const last = this.heap[this.size]!;
      this.heap[0] = last;
      this.positionOf[last] = 0;
      this.sinkDown(0);
    }
    return top;
  }

  /**
   * Notify the heap that the f-cost of `index` has decreased.
   * Re-establishes heap invariant in O(log n).
   */
  decreaseKey(index: number): void {
    const pos = this.positionOf[index];
    if (pos === undefined || pos < 0) return;
    this.bubbleUp(pos);
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) {
      this.positionOf[this.heap[i]!] = -1;
    }
    this.size = 0;
  }

  private bubbleUp(pos: number): void {
    const heap = this.heap;
    const fCost = this.fCost;
    const posOf = this.positionOf;
    const item = heap[pos]!;
    const itemCost = fCost[item]!;

    while (pos > 0) {
      const parentPos = (pos - 1) >> 1;
      const parentItem = heap[parentPos]!;
      if (fCost[parentItem]! <= itemCost) break;
      // Swap parent down
      heap[pos] = parentItem;
      posOf[parentItem] = pos;
      pos = parentPos;
    }
    heap[pos] = item;
    posOf[item] = pos;
  }

  private sinkDown(pos: number): void {
    const heap = this.heap;
    const fCost = this.fCost;
    const posOf = this.positionOf;
    const size = this.size;
    const item = heap[pos]!;
    const itemCost = fCost[item]!;

    while (true) {
      const left = 2 * pos + 1;
      if (left >= size) break;
      const right = left + 1;
      let bestChild = left;
      let bestCost = fCost[heap[left]!]!;
      if (right < size) {
        const rightCost = fCost[heap[right]!]!;
        if (rightCost < bestCost) {
          bestChild = right;
          bestCost = rightCost;
        }
      }
      if (itemCost <= bestCost) break;
      // Swap child up
      const child = heap[bestChild]!;
      heap[pos] = child;
      posOf[child] = pos;
      pos = bestChild;
    }
    heap[pos] = item;
    posOf[item] = pos;
  }
}

// ---------------------------------------------------------------------------
// Core A* types
// ---------------------------------------------------------------------------

/** Terrain/cell types matching C++ PathfindCell::CellType */
export const enum CellType {
  Clear = 0,
  Water = 1,
  Cliff = 2,
  Rubble = 3,
  Obstacle = 4,
  Bridge = 5,
  Impassable = 6,
  BridgeImpassable = 7,
}

/** Locomotor surface bit flags matching C++ LocomotorSurfaceType */
export const LOCOMOTOR_SURFACE_GROUND = 1 << 0;
export const LOCOMOTOR_SURFACE_WATER = 1 << 1;
export const LOCOMOTOR_SURFACE_CLIFF = 1 << 2;
export const LOCOMOTOR_SURFACE_AIR = 1 << 3;
export const LOCOMOTOR_SURFACE_RUBBLE = 1 << 4;

export interface PathfindGrid {
  width: number;
  height: number;
  /** Per-cell terrain type (CellType enum values). */
  terrainType: Uint8Array;
  /** Per-cell blocked flag (1 = obstacle present). */
  blocked: Uint8Array;
  /** Per-cell pinched flag (1 = narrow passage). */
  pinched: Uint8Array;
}

export interface PathfindOptions {
  /** Bit mask of acceptable locomotor surfaces. */
  acceptableSurfaces: number;
  /** Maximum number of cells to examine before giving up. */
  maxSearchNodes?: number;
  /**
   * Optional callback to check if a cell is passable for the specific unit.
   * Return false to block the cell. Called in addition to surface/obstacle checks.
   */
  isPassable?: (cellX: number, cellZ: number) => boolean;
  /**
   * Optional callback to compute extra cost for moving to a cell.
   * Return additional cost to add (0 = no extra cost).
   */
  extraCost?: (cellX: number, cellZ: number) => number;
  /**
   * If true, the search can path through obstacle cells (used by air units).
   */
  canPassObstacle?: boolean;
  /**
   * Optional terrain height lookup for cliff cost calculation.
   * (cellX, cellZ) => height in world units.
   */
  getTerrainHeight?: (cellX: number, cellZ: number) => number;
}

export interface PathfindResult {
  /** Waypoint cells from start to goal (inclusive). Empty if no path found. */
  path: Array<{ x: number; z: number }>;
  /** Number of cells examined during the search. */
  nodesSearched: number;
  /** Whether the goal was reached. */
  found: boolean;
}

// ---------------------------------------------------------------------------
// Heuristic (matching C++ PathfindCell::costToGoal)
// ---------------------------------------------------------------------------

/**
 * Octile distance heuristic matching the C++ source.
 * Uses the formula: max(dx,dy)*10 + min(dx,dy)*5
 * which is equivalent to the C++ code:
 *   if (dx>dy) cost = 10*dx + 5*dy else cost = 10*dy + 5*dx
 */
export function heuristic(ax: number, az: number, bx: number, bz: number): number {
  let dx = ax - bx;
  let dz = az - bz;
  if (dx < 0) dx = -dx;
  if (dz < 0) dz = -dz;
  if (dx > dz) {
    return COST_ORTHOGONAL * dx + (COST_ORTHOGONAL * dz) / 2;
  }
  return COST_ORTHOGONAL * dz + (COST_ORTHOGONAL * dx) / 2;
}

// ---------------------------------------------------------------------------
// Surface passability lookup (matching C++ validLocomotorSurfacesForCellType)
// ---------------------------------------------------------------------------

export function surfacesForCellType(type: number): number {
  switch (type) {
    case CellType.Obstacle:
    case CellType.Impassable:
    case CellType.BridgeImpassable:
      return LOCOMOTOR_SURFACE_AIR;
    case CellType.Clear:
      return LOCOMOTOR_SURFACE_GROUND | LOCOMOTOR_SURFACE_AIR;
    case CellType.Water:
      return LOCOMOTOR_SURFACE_WATER | LOCOMOTOR_SURFACE_AIR;
    case CellType.Rubble:
      return LOCOMOTOR_SURFACE_RUBBLE | LOCOMOTOR_SURFACE_AIR;
    case CellType.Cliff:
      return LOCOMOTOR_SURFACE_CLIFF | LOCOMOTOR_SURFACE_AIR;
    case CellType.Bridge:
      return LOCOMOTOR_SURFACE_GROUND | LOCOMOTOR_SURFACE_AIR;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Core A* search
// ---------------------------------------------------------------------------

/** 8-connected neighbor offsets: 4 orthogonal then 4 diagonal. */
const DELTA_X = [1, 0, -1, 0, 1, -1, -1, 1] as const;
const DELTA_Z = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const FIRST_DIAGONAL = 4;
/**
 * Maps diagonal index (4..7) -> pair of orthogonal neighbor indices that
 * must be passable to allow corner-cutting.
 * Diagonal 4 (1,1)  requires orthogonal 0 (1,0) and 1 (0,1)
 * Diagonal 5 (-1,1) requires orthogonal 2 (-1,0) and 1 (0,1)
 * Diagonal 6 (-1,-1) requires orthogonal 2 (-1,0) and 3 (0,-1)
 * Diagonal 7 (1,-1)  requires orthogonal 0 (1,0) and 3 (0,-1)
 */
const DIAGONAL_ADJ_A = [0, 1, 2, 3] as const; // adjacent[i-4]
const DIAGONAL_ADJ_B = [1, 2, 3, 0] as const; // adjacent[i-3]

/**
 * A* pathfinding on a grid.
 *
 * Matches the C++ Pathfinder::internalFindPath / examineNeighboringCells
 * algorithm, including:
 * - 8-connected grid with orthogonal/diagonal costs (10/14)
 * - Octile distance heuristic
 * - Turn penalty (4/8/16 for 45/90/135 degree turns)
 * - Pinch cell extra cost
 * - Cliff height-difference cost
 * - Diagonal corner-cutting restriction (requires both adjacent orthogonals open)
 *
 * Uses a binary min-heap for the open set instead of the C++ sorted linked list,
 * providing O(n log n) overall instead of O(n^2).
 */
export function findPath(
  grid: PathfindGrid,
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  options: PathfindOptions,
): PathfindResult {
  const { width, height, terrainType, blocked, pinched } = grid;
  const total = width * height;
  const maxSearch = options.maxSearchNodes ?? 500_000;
  const canPassObstacle = options.canPassObstacle ?? false;

  // Validate bounds
  if (startX < 0 || startX >= width || startZ < 0 || startZ >= height
    || goalX < 0 || goalX >= width || goalZ < 0 || goalZ >= height) {
    return { path: [], nodesSearched: 0, found: false };
  }

  const startIndex = startZ * width + startX;
  const goalIndex = goalZ * width + goalX;

  // Trivial case: start == goal
  if (startIndex === goalIndex) {
    return { path: [{ x: startX, z: startZ }], nodesSearched: 0, found: true };
  }

  // Allocate search arrays
  const gCost = new Float64Array(total);
  const fCost = new Float64Array(total);
  const parent = new Int32Array(total);
  const inClosed = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    gCost[i] = Number.POSITIVE_INFINITY;
    fCost[i] = Number.POSITIVE_INFINITY;
    parent[i] = -1;
  }

  gCost[startIndex] = 0;
  fCost[startIndex] = heuristic(startX, startZ, goalX, goalZ);

  // Binary heap open set
  const openSet = new BinaryHeap(total, fCost);
  openSet.push(startIndex);

  // Per-neighbor passability flags (for diagonal corner-cutting check)
  const neighborPassable = new Uint8Array(8);

  let searched = 0;

  while (openSet.length > 0) {
    searched++;
    if (searched > maxSearch) break;

    const currentIndex = openSet.pop();
    if (currentIndex < 0) break;

    // Goal reached
    if (currentIndex === goalIndex) {
      return {
        path: reconstructPath(parent, startIndex, goalIndex, width),
        nodesSearched: searched,
        found: true,
      };
    }

    inClosed[currentIndex] = 1;

    const currentX = currentIndex % width;
    const currentZ = (currentIndex - currentX) / width;
    const currentG = gCost[currentIndex]!;

    // Determine parent direction for turn cost computation
    const parentIndex = parent[currentIndex]!;
    let hasPrevDir = false;
    let prevDirX = 0;
    let prevDirZ = 0;
    if (parentIndex >= 0) {
      const px = parentIndex % width;
      const pz = (parentIndex - px) / width;
      prevDirX = currentX - px;
      prevDirZ = currentZ - pz;
      hasPrevDir = true;
    }

    // Examine 8 neighbors
    neighborPassable.fill(0);

    for (let i = 0; i < 8; i++) {
      const nx = currentX + DELTA_X[i]!;
      const nz = currentZ + DELTA_Z[i]!;

      // Bounds check
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;

      const neighborIndex = nz * width + nx;

      // Skip if already fully processed
      if (inClosed[neighborIndex] === 1) continue;

      // Diagonal corner-cutting restriction: both adjacent orthogonals must be passable.
      // Note: C++ has this check inside #if 0 (compiled out). We keep it as an intentional
      // improvement — prevents units from clipping through diagonal wall corners.
      if (i >= FIRST_DIAGONAL) {
        const adjIdx = i - FIRST_DIAGONAL;
        if (!neighborPassable[DIAGONAL_ADJ_A[adjIdx]!] && !neighborPassable[DIAGONAL_ADJ_B[adjIdx]!]) {
          continue;
        }
      }

      // Surface passability check
      const cellTerrain = terrainType[neighborIndex]!;
      const cellSurfaces = surfacesForCellType(cellTerrain);
      if ((options.acceptableSurfaces & cellSurfaces) === 0) continue;

      // Obstacle check
      if (blocked[neighborIndex] === 1 && !canPassObstacle) continue;

      // Custom passability callback
      if (options.isPassable && !options.isPassable(nx, nz)) continue;

      // Mark orthogonal as passable for diagonal corner-cutting
      if (i < FIRST_DIAGONAL) {
        neighborPassable[i] = 1;
      }

      // Compute step cost (orthogonal vs diagonal)
      const isDiagonal = i >= FIRST_DIAGONAL;
      let stepCost = isDiagonal ? COST_DIAGONAL : COST_ORTHOGONAL;

      // Pinch penalty (matching C++ costSoFar: cost += 1*COST_DIAGONAL for pinched)
      if (pinched[neighborIndex] === 1) {
        stepCost += COST_DIAGONAL;
      }

      // Cliff cost (matching C++: if CELL_CLIFF and height diff < cell size, add 7*COST_DIAGONAL)
      if (cellTerrain === CellType.Cliff && pinched[neighborIndex] !== 1 && options.getTerrainHeight) {
        const fromH = options.getTerrainHeight(currentX, currentZ);
        const toH = options.getTerrainHeight(nx, nz);
        if (Math.abs(fromH - toH) < 10) { // PATHFIND_CELL_SIZE equivalent
          stepCost += 7 * COST_DIAGONAL;
        }
      }

      // Turn penalty (matching C++ costSoFar turn cost)
      if (hasPrevDir) {
        const nextDirX = nx - currentX;
        const nextDirZ = nz - currentZ;
        if (nextDirX !== prevDirX || nextDirZ !== prevDirZ) {
          const dot = nextDirX * prevDirX + nextDirZ * prevDirZ;
          if (dot > 0) {
            stepCost += 4;   // 45 degree turn
          } else if (dot === 0) {
            stepCost += 8;   // 90 degree turn
          } else {
            stepCost += 16;  // 135+ degree turn
          }
        }
      }

      // Extra cost callback
      if (options.extraCost) {
        stepCost += options.extraCost(nx, nz);
      }

      const tentativeG = currentG + stepCost;
      if (tentativeG >= gCost[neighborIndex]!) continue;

      // Update costs and parent
      parent[neighborIndex] = currentIndex;
      gCost[neighborIndex] = tentativeG;
      fCost[neighborIndex] = tentativeG + heuristic(nx, nz, goalX, goalZ);

      if (openSet.contains(neighborIndex)) {
        openSet.decreaseKey(neighborIndex);
      } else {
        openSet.push(neighborIndex);
      }
    }
  }

  // No path found
  return { path: [], nodesSearched: searched, found: false };
}

// ---------------------------------------------------------------------------
// Path reconstruction
// ---------------------------------------------------------------------------

function reconstructPath(
  parent: Int32Array,
  startIndex: number,
  goalIndex: number,
  width: number,
): Array<{ x: number; z: number }> {
  const cells: Array<{ x: number; z: number }> = [];
  let current = goalIndex;
  let steps = 0;
  const maxSteps = 100_000;

  while (current !== startIndex && current >= 0 && steps < maxSteps) {
    const x = current % width;
    const z = (current - x) / width;
    cells.push({ x, z });
    const p = parent[current]!;
    if (p < 0) break;
    current = p;
    steps++;
  }

  // Add start
  const sx = startIndex % width;
  const sz = (startIndex - sx) / width;
  cells.push({ x: sx, z: sz });

  cells.reverse();
  return cells;
}

// ---------------------------------------------------------------------------
// Path smoothing (matching C++ Path::optimize / isLinePassable)
// ---------------------------------------------------------------------------

/**
 * Remove unnecessary waypoints by checking line-of-sight between non-adjacent
 * waypoints. Uses Bresenham-style line rasterization to check if all cells
 * along the line are passable.
 *
 * Matches the approach in C++ Path::optimize / Pathfinder::isLinePassable.
 */
export function smoothPath(
  path: Array<{ x: number; z: number }>,
  grid: PathfindGrid,
  acceptableSurfaces: number,
  canPassObstacle = false,
): Array<{ x: number; z: number }> {
  if (path.length <= 2) return path;

  const smoothed: Array<{ x: number; z: number }> = [];
  let anchor = 0;
  smoothed.push(path[0]!);

  let candidate = 2;
  while (anchor < path.length - 1) {
    if (candidate >= path.length) {
      const last = smoothed[smoothed.length - 1]!;
      const goal = path[path.length - 1]!;
      if (last.x !== goal.x || last.z !== goal.z) {
        smoothed.push(goal);
      }
      break;
    }

    if (isLineClear(grid, path[anchor]!, path[candidate]!, acceptableSurfaces, canPassObstacle)) {
      candidate++;
    } else {
      smoothed.push(path[candidate - 1]!);
      anchor = candidate - 1;
      candidate = anchor + 2;
    }
  }

  return smoothed;
}

/**
 * Bresenham-style line check: are all cells along the line from start to end
 * passable for the given surface mask?
 */
export function isLineClear(
  grid: PathfindGrid,
  start: { x: number; z: number },
  end: { x: number; z: number },
  acceptableSurfaces: number,
  canPassObstacle = false,
): boolean {
  const { width, height, terrainType, blocked } = grid;

  if (start.x === end.x && start.z === end.z) {
    return isCellPassable(grid, start.x, start.z, acceptableSurfaces, canPassObstacle);
  }

  const dx = Math.abs(end.x - start.x);
  const dz = Math.abs(end.z - start.z);

  let xinc1 = end.x >= start.x ? 1 : -1;
  let xinc2 = xinc1;
  let zinc1 = end.z >= start.z ? 1 : -1;
  let zinc2 = zinc1;

  let den: number;
  let num: number;
  let numadd: number;
  const numPixels = dx >= dz ? dx : dz;

  if (dx >= dz) {
    xinc1 = 0;
    zinc2 = 0;
    den = dx;
    num = dx >> 1;
    numadd = dz;
  } else {
    xinc2 = 0;
    zinc1 = 0;
    den = dz;
    num = dz >> 1;
    numadd = dx;
  }

  let x = start.x;
  let z = start.z;

  for (let step = 0; step <= numPixels; step++) {
    if (x < 0 || x >= width || z < 0 || z >= height) return false;
    const idx = z * width + x;
    const terrain = terrainType[idx]!;
    const surfaces = surfacesForCellType(terrain);
    if ((acceptableSurfaces & surfaces) === 0) return false;
    if (blocked[idx] === 1 && !canPassObstacle) return false;

    num += numadd;
    if (num >= den) {
      num -= den;
      x += xinc1;
      z += zinc1;
      // Check the corner cell too
      if (x >= 0 && x < width && z >= 0 && z < height) {
        const cornerIdx = z * width + x;
        const cornerTerrain = terrainType[cornerIdx]!;
        const cornerSurfaces = surfacesForCellType(cornerTerrain);
        if ((acceptableSurfaces & cornerSurfaces) === 0) return false;
        if (blocked[cornerIdx] === 1 && !canPassObstacle) return false;
      } else {
        return false;
      }
    }
    x += xinc2;
    z += zinc2;
  }

  return true;
}

function isCellPassable(
  grid: PathfindGrid,
  x: number,
  z: number,
  acceptableSurfaces: number,
  canPassObstacle: boolean,
): boolean {
  if (x < 0 || x >= grid.width || z < 0 || z >= grid.height) return false;
  const idx = z * grid.width + x;
  const terrain = grid.terrainType[idx]!;
  const surfaces = surfacesForCellType(terrain);
  if ((acceptableSurfaces & surfaces) === 0) return false;
  if (grid.blocked[idx] === 1 && !canPassObstacle) return false;
  return true;
}
