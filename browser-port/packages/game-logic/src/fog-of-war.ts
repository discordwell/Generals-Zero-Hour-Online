/**
 * Fog of War & Shroud system.
 *
 * Source parity:
 *   Generals/Code/GameEngine/Source/GameLogic/Object/Object.cpp — look(), unlook(), shroud(), unshroud()
 *   Generals/Code/GameEngine/Source/GameLogic/Partition/PartitionManager.cpp — doShroudReveal, doShroudCover
 *   Generals/Code/GameEngine/Include/Common/GameCommon.h — ObjectShroudStatus, CellShroudStatus
 *
 * Implementation: A 2D grid where each cell tracks a per-player "looker count".
 * When a unit with vision is present, it increments all cells within its sight radius.
 * A cell is CLEAR if lookerCount > 0, FOGGED if it was ever seen before, else SHROUDED.
 */

// ──── Cell visibility state ────────────────────────────────────────────────
export const CELL_SHROUDED = 0;
export const CELL_FOGGED = 1;
export const CELL_CLEAR = 2;
export type CellVisibility = typeof CELL_SHROUDED | typeof CELL_FOGGED | typeof CELL_CLEAR;

// ──── Object shroud status (per entity, from player perspective) ───────────
export const OBJECTSHROUD_CLEAR = 0;
export const OBJECTSHROUD_FOGGED = 1;
export const OBJECTSHROUD_SHROUDED = 2;

// ──── Maximum supported players ────────────────────────────────────────────
export const MAX_FOW_PLAYERS = 8;

export interface PartitionCellShroudLevelSnapshot {
  currentShroud: number;
  activeShroudLevel: number;
}

// ──── Fog of War grid ──────────────────────────────────────────────────────
export class FogOfWarGrid {
  readonly cellsWide: number;
  readonly cellsDeep: number;
  readonly cellSize: number;

  /** Per-player looker count per cell. lookerCounts[player][cellIndex] */
  private readonly lookerCounts: Int16Array[];
  /** Per-player active shroud count per cell. */
  private readonly activeShroudCounts: Int16Array[];
  /** Per-player "ever seen" flag per cell. */
  private readonly everSeen: Uint8Array[];

  constructor(worldWidth: number, worldDepth: number, cellSize: number) {
    this.cellSize = Math.max(1, cellSize);
    this.cellsWide = Math.max(1, Math.ceil(worldWidth / this.cellSize));
    this.cellsDeep = Math.max(1, Math.ceil(worldDepth / this.cellSize));

    const totalCells = this.cellsWide * this.cellsDeep;
    this.lookerCounts = [];
    this.activeShroudCounts = [];
    this.everSeen = [];
    for (let p = 0; p < MAX_FOW_PLAYERS; p++) {
      this.lookerCounts.push(new Int16Array(totalCells));
      this.activeShroudCounts.push(new Int16Array(totalCells));
      this.everSeen.push(new Uint8Array(totalCells));
    }
  }

  private cellIndex(cx: number, cz: number): number {
    return cz * this.cellsWide + cx;
  }

  private worldToCell(wx: number, wz: number): [number, number] {
    const cx = Math.max(0, Math.min(this.cellsWide - 1, Math.floor(wx / this.cellSize)));
    const cz = Math.max(0, Math.min(this.cellsDeep - 1, Math.floor(wz / this.cellSize)));
    return [cx, cz];
  }

  /**
   * Reveal shroud in a circle for a player (increments looker count).
   * Source parity: PartitionManager::doShroudReveal
   */
  addLooker(playerIndex: number, worldX: number, worldZ: number, radius: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS || radius <= 0) {
      return;
    }

    const [cx, cz] = this.worldToCell(worldX, worldZ);
    const cellRadius = Math.ceil(radius / this.cellSize);
    const lookers = this.lookerCounts[playerIndex];
    const seen = this.everSeen[playerIndex];
    if (!lookers || !seen) return;
    const radiusSq = cellRadius * cellRadius;

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.cellsDeep) {
        continue;
      }
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.cellsWide) {
          continue;
        }
        if (dx * dx + dz * dz <= radiusSq) {
          const idx = this.cellIndex(gx, gz);
          lookers[idx] = (lookers[idx] ?? 0) + 1;
          seen[idx] = 1;
        }
      }
    }
  }

  /**
   * Source parity: PartitionManager::revealMapForPlayer.
   * Marks the entire map as explored without adding permanent lookers.
   */
  revealMapForPlayer(playerIndex: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS) {
      return;
    }
    const seen = this.everSeen[playerIndex];
    if (!seen) {
      return;
    }
    const lookers = this.lookerCounts[playerIndex];
    if (!lookers) {
      return;
    }
    for (let idx = 0; idx < seen.length; idx += 1) {
      if ((lookers[idx] ?? 0) <= 0) {
        seen[idx] = 1;
      }
    }
  }

  /**
   * Source parity: PartitionManager::shroudMapForPlayer.
   * Re-applies full shroud over explored terrain.
   */
  shroudMapForPlayer(playerIndex: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS) {
      return;
    }
    const seen = this.everSeen[playerIndex];
    const lookers = this.lookerCounts[playerIndex];
    if (!seen || !lookers) {
      return;
    }
    for (let idx = 0; idx < seen.length; idx += 1) {
      if ((lookers[idx] ?? 0) <= 0) {
        seen[idx] = 0;
      }
    }
  }

  /**
   * Source parity: PartitionManager::doShroudCover.
   * Applies an active shrouder in a circle without erasing explored history.
   */
  shroudAt(playerIndex: number, worldX: number, worldZ: number, radius: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS || radius <= 0) {
      return;
    }

    const [cx, cz] = this.worldToCell(worldX, worldZ);
    const cellRadius = Math.ceil(radius / this.cellSize);
    const activeShrouders = this.activeShroudCounts[playerIndex];
    if (!activeShrouders) {
      return;
    }
    const radiusSq = cellRadius * cellRadius;

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.cellsDeep) {
        continue;
      }
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.cellsWide) {
          continue;
        }
        if (dx * dx + dz * dz <= radiusSq) {
          const idx = this.cellIndex(gx, gz);
          activeShrouders[idx] = (activeShrouders[idx] ?? 0) + 1;
        }
      }
    }
  }

  removeShrouder(playerIndex: number, worldX: number, worldZ: number, radius: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS || radius <= 0) {
      return;
    }

    const [cx, cz] = this.worldToCell(worldX, worldZ);
    const cellRadius = Math.ceil(radius / this.cellSize);
    const activeShrouders = this.activeShroudCounts[playerIndex];
    if (!activeShrouders) {
      return;
    }
    const radiusSq = cellRadius * cellRadius;

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.cellsDeep) {
        continue;
      }
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.cellsWide) {
          continue;
        }
        if (dx * dx + dz * dz <= radiusSq) {
          const idx = this.cellIndex(gx, gz);
          activeShrouders[idx] = Math.max(0, (activeShrouders[idx] ?? 0) - 1);
        }
      }
    }
  }

  /**
   * Source parity: PartitionManager::revealMapForPlayerPermanently.
   * Adds a persistent looker to every cell so shroud generation no longer covers the map.
   */
  revealMapForPlayerPermanently(playerIndex: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS) {
      return;
    }

    const lookers = this.lookerCounts[playerIndex];
    const seen = this.everSeen[playerIndex];
    if (!lookers || !seen) {
      return;
    }

    for (let idx = 0; idx < lookers.length; idx++) {
      lookers[idx] = (lookers[idx] ?? 0) + 1;
      seen[idx] = 1;
    }
  }

  /**
   * Source parity: PartitionManager::undoRevealMapForPlayerPermanently.
   * Removes one persistent reveal layer from every cell.
   */
  undoRevealMapForPlayerPermanently(playerIndex: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS) {
      return;
    }

    const lookers = this.lookerCounts[playerIndex];
    if (!lookers) {
      return;
    }

    for (let idx = 0; idx < lookers.length; idx++) {
      lookers[idx] = Math.max(0, (lookers[idx] ?? 0) - 1);
    }
  }

  /**
   * Remove a looker (decrements looker count). Call when a unit moves or dies.
   * Source parity: PartitionManager::queueUndoShroudReveal
   */
  removeLooker(playerIndex: number, worldX: number, worldZ: number, radius: number): void {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS || radius <= 0) {
      return;
    }

    const [cx, cz] = this.worldToCell(worldX, worldZ);
    const cellRadius = Math.ceil(radius / this.cellSize);
    const lookers = this.lookerCounts[playerIndex];
    if (!lookers) return;
    const radiusSq = cellRadius * cellRadius;

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.cellsDeep) {
        continue;
      }
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.cellsWide) {
          continue;
        }
        if (dx * dx + dz * dz <= radiusSq) {
          const idx = this.cellIndex(gx, gz);
          lookers[idx] = Math.max(0, (lookers[idx] ?? 0) - 1);
        }
      }
    }
  }

  /**
   * Get visibility of a cell for a specific player.
   */
  getCellVisibility(playerIndex: number, worldX: number, worldZ: number): CellVisibility {
    if (playerIndex < 0 || playerIndex >= MAX_FOW_PLAYERS) {
      return CELL_SHROUDED;
    }

    const [cx, cz] = this.worldToCell(worldX, worldZ);
    const idx = this.cellIndex(cx, cz);

    if ((this.lookerCounts[playerIndex]?.[idx] ?? 0) > 0) {
      return CELL_CLEAR;
    }
    if ((this.activeShroudCounts[playerIndex]?.[idx] ?? 0) > 0) {
      return CELL_SHROUDED;
    }
    if (this.everSeen[playerIndex]?.[idx]) {
      return CELL_FOGGED;
    }
    return CELL_SHROUDED;
  }

  getTotalCellCount(): number {
    return this.cellsWide * this.cellsDeep;
  }

  capturePartitionCellShroudLevels(): PartitionCellShroudLevelSnapshot[][] {
    const totalCells = this.getTotalCellCount();
    const cells: PartitionCellShroudLevelSnapshot[][] = [];
    for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
      const cell: PartitionCellShroudLevelSnapshot[] = [];
      for (let playerIndex = 0; playerIndex < MAX_FOW_PLAYERS; playerIndex += 1) {
        const lookers = this.lookerCounts[playerIndex]?.[cellIndex] ?? 0;
        const activeShroudLevel = this.activeShroudCounts[playerIndex]?.[cellIndex] ?? 0;
        const seen = this.everSeen[playerIndex]?.[cellIndex] ?? 0;
        let currentShroud = 1;
        if (lookers > 0) {
          currentShroud = -lookers;
        } else if (activeShroudLevel <= 0 && seen > 0) {
          currentShroud = 0;
        }
        cell.push({
          currentShroud,
          activeShroudLevel,
        });
      }
      cells.push(cell);
    }
    return cells;
  }

  restorePartitionCellShroudLevels(
    cells: readonly (readonly PartitionCellShroudLevelSnapshot[])[],
  ): void {
    this.reset();
    const totalCells = this.getTotalCellCount();
    for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
      const savedCell = cells[cellIndex];
      if (!savedCell) {
        continue;
      }
      for (let playerIndex = 0; playerIndex < MAX_FOW_PLAYERS; playerIndex += 1) {
        const savedLevel = savedCell[playerIndex];
        if (!savedLevel) {
          continue;
        }
        const currentShroud = Math.trunc(savedLevel.currentShroud);
        const activeShroudLevel = Math.max(0, Math.trunc(savedLevel.activeShroudLevel));
        if (currentShroud < 0) {
          this.lookerCounts[playerIndex]![cellIndex] = Math.min(-currentShroud, 0x7fff);
          this.everSeen[playerIndex]![cellIndex] = 1;
        } else {
          this.lookerCounts[playerIndex]![cellIndex] = 0;
          if (currentShroud === 0) {
            this.everSeen[playerIndex]![cellIndex] = 1;
          }
        }
        this.activeShroudCounts[playerIndex]![cellIndex] = Math.min(activeShroudLevel, 0x7fff);
      }
    }
  }

  /**
   * Get visibility of an entity position for a specific player.
   */
  getObjectVisibility(playerIndex: number, worldX: number, worldZ: number): number {
    return this.getCellVisibility(playerIndex, worldX, worldZ);
  }

  /**
   * Check if a position is visible (CLEAR) for a player.
   */
  isVisible(playerIndex: number, worldX: number, worldZ: number): boolean {
    return this.getCellVisibility(playerIndex, worldX, worldZ) === CELL_CLEAR;
  }

  /**
   * Check if a position has ever been revealed for a player.
   */
  isExplored(playerIndex: number, worldX: number, worldZ: number): boolean {
    return this.getCellVisibility(playerIndex, worldX, worldZ) !== CELL_SHROUDED;
  }

  /**
   * Reset all fog of war state.
   */
  reset(): void {
    for (let p = 0; p < MAX_FOW_PLAYERS; p++) {
      this.lookerCounts[p]!.fill(0);
      this.activeShroudCounts[p]!.fill(0);
      this.everSeen[p]!.fill(0);
    }
  }
}

// ──── Per-entity vision tracking state ─────────────────────────────────────
export interface EntityVisionState {
  lastLookX: number;
  lastLookZ: number;
  lastLookRadius: number;
  isLooking: boolean;
}

export function createEntityVisionState(): EntityVisionState {
  return {
    lastLookX: 0,
    lastLookZ: 0,
    lastLookRadius: 0,
    isLooking: false,
  };
}

/**
 * Update entity's vision contribution to the fog of war grid.
 * Handles the look/unlook cycle when entities move.
 */
export function updateEntityVision(
  grid: FogOfWarGrid,
  visionState: EntityVisionState,
  playerIndex: number,
  worldX: number,
  worldZ: number,
  visionRange: number,
  isAlive: boolean,
): void {
  // If entity is dead or has no vision, remove previous look.
  if (!isAlive || visionRange <= 0) {
    if (visionState.isLooking) {
      grid.removeLooker(playerIndex, visionState.lastLookX, visionState.lastLookZ, visionState.lastLookRadius);
      visionState.isLooking = false;
    }
    return;
  }

  // If entity has moved, remove old looker and add new one.
  if (visionState.isLooking) {
    // Only update if position changed significantly.
    const dx = worldX - visionState.lastLookX;
    const dz = worldZ - visionState.lastLookZ;
    const movedDistSq = dx * dx + dz * dz;
    const cellSizeSq = grid.cellSize * grid.cellSize;

    if (movedDistSq < cellSizeSq * 0.25) {
      // Haven't moved a significant amount — skip update for performance.
      return;
    }

    grid.removeLooker(playerIndex, visionState.lastLookX, visionState.lastLookZ, visionState.lastLookRadius);
  }

  // Add new looker at current position.
  grid.addLooker(playerIndex, worldX, worldZ, visionRange);
  visionState.lastLookX = worldX;
  visionState.lastLookZ = worldZ;
  visionState.lastLookRadius = visionRange;
  visionState.isLooking = true;
}
