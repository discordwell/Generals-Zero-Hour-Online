// @ts-nocheck — self is typed as any; real safety comes from the test suite.
/**
 * Bridge mechanics — bridge damage/healing/death, scaffolds, tower behaviors, navigation grid overlay.
 *
 * Source parity: Object/BridgeBehavior.cpp, Object/BridgeTowerBehavior.cpp
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAP_XY_FACTOR } from '@generals/terrain';
import { readNumericField, readStringField } from './ini-readers.js';
import { clamp } from './ini-readers.js';
import {
  OBJECT_FLAG_BRIDGE_POINT1,
  OBJECT_FLAG_BRIDGE_POINT2,
  STM_BUILD_ACROSS,
  STM_RISE,
  STM_SINK,
  STM_STILL,
  STM_TEAR_DOWN_ACROSS,
} from './index.js';
type GL = any;

// ---- Bridge mechanics implementations ----

export function resetBridgeDamageStateChanges(self: GL): void {
  self.bridgeDamageStatesChangedFrame = -1;
  self.bridgeDamageStateByControlEntity.clear();
}

export function noteBridgeDamageStateChange(self: GL, segmentId: number, passable: boolean): void {
  self.bridgeDamageStatesChangedFrame = self.frameCounter;
  for (const [entityId, mappedSegmentId] of self.bridgeSegmentByControlEntity.entries()) {
    if (mappedSegmentId !== segmentId) {
      continue;
    }
    self.bridgeDamageStateByControlEntity.set(entityId, passable);
  }
}

export function extractBridgeBehaviorProfile(self: GL, objectDef: ObjectDef | undefined): BridgeBehaviorProfile | null {
  if (!objectDef?.blocks) return null;
  let profile: BridgeBehaviorProfile | null = null;
  const visitBlock = (block: IniBlock): void => {
    if (profile !== null) return;
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'BRIDGEBEHAVIOR') {
        profile = {
          scaffoldLateralSpeed: readNumericField(block.fields, ['LateralScaffoldSpeed']) ?? 1.0,
          scaffoldVerticalSpeed: readNumericField(block.fields, ['VerticalScaffoldSpeed']) ?? 1.0,
          scaffoldObjectName: (readStringField(block.fields, ['ScaffoldObjectName']) ?? '').toUpperCase(),
        };
      }
    }
    for (const child of block.blocks) {
      visitBlock(child);
    }
  };

  for (const block of objectDef.blocks) {
    visitBlock(block);
  }
  return profile;
}

export function extractBridgeTowerProfile(self: GL, objectDef: ObjectDef | undefined): BridgeTowerProfile | null {
  if (!objectDef?.blocks) return null;
  for (const block of objectDef.blocks) {
    if (block.type.toUpperCase() === 'BEHAVIOR') {
      const moduleType = block.name.split(/\s+/)[0]?.toUpperCase() ?? '';
      if (moduleType === 'BRIDGETOWERBEHAVIOR') {
        return { _marker: true };
      }
    }
  }
  return null;
}

export function resolveHighestBridgeLayerForDestination(self: GL, 
  worldX: number,
  worldZ: number,
  worldY: number,
): { segmentId: number; layerHeight: number } | null {
  const grid = self.navigationGrid;
  if (!grid) {
    return null;
  }
  const [cellX, cellZ] = self.worldToGrid(worldX, worldZ);
  if (cellX === null || cellZ === null) {
    return null;
  }
  const index = cellZ * grid.width + cellX;
  if (index < 0 || index >= grid.bridgeSegmentByCell.length) {
    return null;
  }
  const segmentIds = self.bridgeSegmentIdsByCell.get(index)
    ?? (() => {
      const segmentId = grid.bridgeSegmentByCell[index];
      return (segmentId === undefined || segmentId < 0) ? [] : [segmentId];
    })();
  if (segmentIds.length === 0) {
    return null;
  }

  let bestSegmentId = -1;
  let bestLayerHeight: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const segmentId of segmentIds) {
    const segment = self.bridgeSegments.get(segmentId);
    if (!segment) {
      continue;
    }
    const layerHeight = resolveBridgeLayerHeightAt(self, segment, worldX, worldZ);
    if (!Number.isFinite(layerHeight)) {
      continue;
    }
    const delta = worldY - layerHeight;
    // Source parity: TerrainLogic::getHighestLayerForDestination only considers
    // layers that are at-or-below the destination height and picks the closest.
    if (delta < 0) {
      continue;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      bestSegmentId = segmentId;
      bestLayerHeight = layerHeight;
    }
  }

  if (bestSegmentId < 0 || bestLayerHeight === null) {
    return null;
  }

  return {
    segmentId: bestSegmentId,
    layerHeight: bestLayerHeight,
  };
}

export function resolveBridgeLayerHeightAt(self: GL, segment: BridgeSegmentState, worldX: number, worldZ: number): number {
  const startX = segment.startWorldX;
  const startZ = segment.startWorldZ;
  const endX = segment.endWorldX;
  const endZ = segment.endWorldZ;
  const startY = segment.startSurfaceY;
  const endY = segment.endSurfaceY;
  if (
    startX === undefined || startZ === undefined || endX === undefined || endZ === undefined
    || startY === undefined || endY === undefined
  ) {
    return self.resolveGroundHeight(worldX, worldZ);
  }

  const dx = endX - startX;
  const dz = endZ - startZ;
  const denom = dx * dx + dz * dz;
  if (denom <= 1e-6) {
    return Math.max(startY, endY);
  }
  const t = clamp((((worldX - startX) * dx) + ((worldZ - startZ) * dz)) / denom, 0, 1);
  return startY + ((endY - startY) * t);
}

export function applyBridgeOverlay(self: GL, mapData: MapDataJSON, grid: NavigationGrid): void {
  const starts: Array<{
    x: number;
    z: number;
    worldX: number;
    worldZ: number;
    worldY: number;
    properties: Record<string, string>;
    entityId: number | null;
  }> = [];
  const ends: Array<{
    x: number;
    z: number;
    worldX: number;
    worldZ: number;
    worldY: number;
    properties: Record<string, string>;
    entityId: number | null;
  }> = [];

  for (const mapObject of mapData.objects) {
    const flags = mapObject.flags;
    if ((flags & (OBJECT_FLAG_BRIDGE_POINT1 | OBJECT_FLAG_BRIDGE_POINT2)) === 0) {
      continue;
    }

    const cellX = Math.floor(mapObject.position.x / MAP_XY_FACTOR);
    const cellZ = Math.floor(mapObject.position.y / MAP_XY_FACTOR);
    if (!self.isCellInBounds(cellX, cellZ, grid)) {
      continue;
    }
    const worldX = mapObject.position.x;
    const worldZ = mapObject.position.y;
    const worldY = self.resolveGroundHeight(worldX, worldZ) + mapObject.position.z;

    if ((flags & OBJECT_FLAG_BRIDGE_POINT1) !== 0) {
      starts.push({
        x: cellX,
        z: cellZ,
        worldX,
        worldZ,
        worldY,
        properties: mapObject.properties,
        entityId: findBridgeControlEntityId(self, cellX, cellZ, OBJECT_FLAG_BRIDGE_POINT1),
      });
    }
    if ((flags & OBJECT_FLAG_BRIDGE_POINT2) !== 0) {
      ends.push({
        x: cellX,
        z: cellZ,
        worldX,
        worldZ,
        worldY,
        properties: mapObject.properties,
        entityId: findBridgeControlEntityId(self, cellX, cellZ, OBJECT_FLAG_BRIDGE_POINT2),
      });
    }
  }

  if (starts.length === 0 || ends.length === 0) {
    return;
  }

  const usedEnds = new Uint8Array(ends.length);
  for (const start of starts) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ends.length; i++) {
      if (usedEnds[i] === 1) {
        continue;
      }
      const end = ends[i]!;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < bestDistance) {
        bestDistance = dist2;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      continue;
    }
    const end = ends[bestIndex]!;
    usedEnds[bestIndex] = 1;
    const segmentId = self.bridgeSegments.size;
    const passable = resolveInitialBridgePassable(self, start.properties, end.properties);
    markBridgeSegment(self, start, end, segmentId, passable, grid);
  }
}

export function findBridgeControlEntityId(self: GL, cellX: number, cellZ: number, requiredFlag: number): number | null {
  for (const entity of self.spawnedEntities.values()) {
    if (((entity.bridgeFlags ?? 0) & requiredFlag) === 0) {
      continue;
    }
    if (entity.mapCellX === cellX && entity.mapCellZ === cellZ) {
      return entity.id;
    }
  }
  return null;
}

export function resolveInitialBridgePassable(self: GL, ...propertySets: Array<Record<string, string>>): boolean {
  for (const properties of propertySets) {
    for (const [rawKey, rawValue] of Object.entries(properties)) {
      const key = rawKey.trim().toLowerCase();
      const value = rawValue.trim().toLowerCase();
      if (key.length === 0 || value.length === 0) {
        continue;
      }
      if (!/(bridge|destroy|broken|pass|state|repair|open|close|down|up)/.test(key)) {
        continue;
      }

      if (
        value.includes('down')
        || value.includes('destroyed')
        || value.includes('broken')
        || value.includes('closed')
        || value.includes('disabled')
        || value === '0'
        || value === 'false'
        || value === 'no'
      ) {
        return false;
      }
    }
  }

  return true;
}

export function markBridgeSegment(self: GL, 
  start: {
    x: number;
    z: number;
    worldX: number;
    worldZ: number;
    worldY: number;
    properties: Record<string, string>;
    entityId: number | null;
  },
  end: {
    x: number;
    z: number;
    worldX: number;
    worldZ: number;
    worldY: number;
    properties: Record<string, string>;
    entityId: number | null;
  },
  segmentId: number,
  passable: boolean,
  grid: NavigationGrid,
): void {
  const cellIndices = new Set<number>();
  const transitionIndices = new Set<number>();
  let x = start.x;
  let z = start.z;
  const dx = Math.abs(end.x - start.x);
  const dz = Math.abs(end.z - start.z);
  const stepX = start.x < end.x ? 1 : -1;
  const stepZ = start.z < end.z ? 1 : -1;
  let err = dx - dz;

  while (true) {
    markBridgeCellRadius(self, x, z, 0, segmentId, passable, grid, cellIndices);
    if (x === end.x && z === end.z) {
      break;
    }
    const twoErr = 2 * err;
    if (twoErr > -dz) {
      err -= dz;
      x += stepX;
    }
    if (twoErr < dx) {
      err += dx;
      z += stepZ;
    }
  }

  markBridgeTransitionRadius(self, start.x, start.z, 0, segmentId, passable, grid, transitionIndices);
  markBridgeTransitionRadius(self, end.x, end.z, 0, segmentId, passable, grid, transitionIndices);

  self.bridgeSegments.set(segmentId, {
    passable,
    cellIndices: Array.from(cellIndices),
    transitionIndices: Array.from(transitionIndices),
    controlEntityIds: [start.entityId, end.entityId].filter((entityId): entityId is number => entityId !== null),
    startWorldX: start.worldX,
    startWorldZ: start.worldZ,
    endWorldX: end.worldX,
    endWorldZ: end.worldZ,
    startSurfaceY: start.worldY,
    endSurfaceY: end.worldY,
  });
  if (start.entityId !== null) {
    self.bridgeSegmentByControlEntity.set(start.entityId, segmentId);
  }
  if (end.entityId !== null) {
    self.bridgeSegmentByControlEntity.set(end.entityId, segmentId);
  }
}

export function markBridgeCellRadius(self: GL, 
  cellX: number,
  cellZ: number,
  radius: number,
  segmentId: number,
  passable: boolean,
  grid: NavigationGrid,
  cellIndices: Set<number>,
): void {
  for (let x = cellX - radius; x <= cellX + radius; x++) {
    for (let z = cellZ - radius; z <= cellZ + radius; z++) {
      if (!self.isCellInBounds(x, z, grid)) {
        continue;
      }
      const index = z * grid.width + x;
      const currentSegmentId = grid.bridgeSegmentByCell[index];
      if (currentSegmentId === undefined || currentSegmentId < 0) {
        grid.bridgeSegmentByCell[index] = segmentId;
      }
      const segmentIdsAtCell = self.bridgeSegmentIdsByCell.get(index);
      if (!segmentIdsAtCell) {
        self.bridgeSegmentIdsByCell.set(index, [segmentId]);
      } else if (!segmentIdsAtCell.includes(segmentId)) {
        segmentIdsAtCell.push(segmentId);
      }
      grid.bridge[index] = 1;
      if (passable) {
        grid.bridgePassable[index] = 1;
      }
      cellIndices.add(index);
    }
  }
}

export function markBridgeTransitionRadius(self: GL, 
  cellX: number,
  cellZ: number,
  radius: number,
  segmentId: number,
  passable: boolean,
  grid: NavigationGrid,
  transitionIndices: Set<number>,
): void {
  for (let x = cellX - radius; x <= cellX + radius; x++) {
    for (let z = cellZ - radius; z <= cellZ + radius; z++) {
      if (!self.isCellInBounds(x, z, grid)) {
        continue;
      }
      const index = z * grid.width + x;
      if (grid.bridge[index] === 1 && grid.bridgeSegmentByCell[index] === segmentId) {
        if (passable) {
          grid.bridgeTransitions[index] = 1;
        }
        transitionIndices.add(index);
      }
    }
  }
}

export function updateBridgeScaffolds(self: GL): void {
  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    const st = entity.bridgeScaffoldState;
    if (!st) continue;

    // Do nothing if we're not in motion.
    if (st.targetMotion === STM_STILL) continue;

    // Compute direction vector from our position to the target position.
    const dirX = st.targetPos.x - entity.x;
    const dirY = st.targetPos.y - entity.y;
    const dirZ = st.targetPos.z - entity.z;

    // Normalize direction vector.
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    if (dirLen < 0.0001) {
      // Already at target — advance state machine.
      advanceScaffoldMotion(self, entity, st);
      continue;
    }
    const vx = dirX / dirLen;
    const vy = dirY / dirLen;
    const vz = dirZ / dirLen;

    // Depending on motion type, compute top speed and start/end positions.
    let topSpeed = 1.0;
    let startX: number, startY: number, startZ: number;
    let endX: number, endY: number, endZ: number;

    switch (st.targetMotion) {
      case STM_RISE:
        topSpeed = st.verticalSpeed;
        startX = st.createPos.x; startY = st.createPos.y; startZ = st.createPos.z;
        endX = st.riseToPos.x; endY = st.riseToPos.y; endZ = st.riseToPos.z;
        break;
      case STM_SINK:
        topSpeed = st.verticalSpeed;
        startX = st.riseToPos.x; startY = st.riseToPos.y; startZ = st.riseToPos.z;
        endX = st.createPos.x; endY = st.createPos.y; endZ = st.createPos.z;
        break;
      case STM_BUILD_ACROSS:
        topSpeed = st.lateralSpeed;
        startX = st.riseToPos.x; startY = st.riseToPos.y; startZ = st.riseToPos.z;
        endX = st.buildPos.x; endY = st.buildPos.y; endZ = st.buildPos.z;
        break;
      case STM_TEAR_DOWN_ACROSS:
        topSpeed = st.lateralSpeed;
        startX = st.buildPos.x; startY = st.buildPos.y; startZ = st.buildPos.z;
        endX = st.riseToPos.x; endY = st.riseToPos.y; endZ = st.riseToPos.z;
        break;
      default:
        continue;
    }

    // Adjust speed so it's slower at the end of motion.
    // Source parity: totalDistance = length(end - start) * 0.25
    const svx = endX - startX;
    const svy = endY - startY;
    const svz = endZ - startZ;
    const totalDistance = Math.sqrt(svx * svx + svy * svy + svz * svz) * 0.25;

    const odx = endX - entity.x;
    const ody = endY - entity.y;
    const odz = endZ - entity.z;
    const ourDistance = Math.sqrt(odx * odx + ody * ody + odz * odz);

    let speed = (ourDistance / (totalDistance || 1)) * topSpeed;
    const minSpeed = topSpeed * 0.08;
    if (speed < minSpeed) speed = minSpeed;
    if (speed > topSpeed) speed = topSpeed;

    // Source parity: min speed floor of 0.001 to prevent infinite approach.
    if (speed < 0.001) speed = 0.001;

    // Compute new position.
    let newX = vx * speed + entity.x;
    let newY = vy * speed + entity.y;
    let newZ = vz * speed + entity.z;

    // Overshoot check via dot product.
    const tfx = st.targetPos.x - newX;
    const tfy = st.targetPos.y - newY;
    const tfz = st.targetPos.z - newZ;
    if (tfx * dirX + tfy * dirY + tfz * dirZ <= 0.0) {
      // Use destination position directly.
      newX = st.targetPos.x;
      newY = st.targetPos.y;
      newZ = st.targetPos.z;

      // Advance to next motion in the chain.
      advanceScaffoldMotion(self, entity, st);
    }

    // Set the new position.
    entity.x = newX;
    entity.y = newY;
    entity.z = newZ;
  }
}

export function advanceScaffoldMotion(self: GL, entity: MapEntity, st: BridgeScaffoldState): void {
  switch (st.targetMotion) {
    case STM_RISE:
      setScaffoldMotion(self, st, STM_BUILD_ACROSS);
      break;
    case STM_BUILD_ACROSS:
      setScaffoldMotion(self, st, STM_STILL);
      break;
    case STM_TEAR_DOWN_ACROSS:
      setScaffoldMotion(self, st, STM_SINK);
      break;
    case STM_SINK:
      // Source parity: destroy the scaffold object when sink motion completes.
      self.markEntityDestroyed(entity.id, -1);
      break;
    default:
      break;
  }
}

export function setScaffoldMotion(self: GL, st: BridgeScaffoldState, targetMotion: ScaffoldTargetMotion): void {
  st.targetMotion = targetMotion;
  switch (targetMotion) {
    case STM_RISE:
    case STM_TEAR_DOWN_ACROSS:
      st.targetPos = { ...st.riseToPos };
      break;
    case STM_BUILD_ACROSS:
      st.targetPos = { ...st.buildPos };
      break;
    case STM_SINK:
      st.targetPos = { ...st.createPos };
      break;
    default:
      break;
  }
}

export function bridgeBehaviorOnDamage(self: GL, 
  bridge: MapEntity,
  sourceEntityId: number | null,
  amount: number,
  damageType: string,
): void {
  const state = bridge.bridgeBehaviorState;
  if (!state) return;

  // Skip propagation if source is a bridge tower (already propagated from there).
  if (sourceEntityId !== null) {
    const source = self.spawnedEntities.get(sourceEntityId);
    if (source && source.kindOf.has('BRIDGE_TOWER')) return;
  }

  // Calculate damage as percentage of bridge max health.
  const damagePercentage = bridge.maxHealth > 0 ? amount / bridge.maxHealth : 0;
  if (damagePercentage <= 0) return;

  // Propagate proportional damage to all towers.
  for (const towerId of state.towerIds) {
    const tower = self.spawnedEntities.get(towerId);
    if (!tower || tower.destroyed) continue;
    const towerDamageAmount = damagePercentage * tower.maxHealth;
    // Source parity: use bridge entity as source to prevent recursion.
    self.applyWeaponDamageAmount(bridge.id, tower, towerDamageAmount, damageType);
  }
}

export function bridgeBehaviorOnHealing(self: GL, 
  bridge: MapEntity,
  healAmount: number,
  sourceEntityId: number | null,
): void {
  const state = bridge.bridgeBehaviorState;
  if (!state) return;

  // Skip propagation if source is a bridge tower.
  if (sourceEntityId !== null) {
    const source = self.spawnedEntities.get(sourceEntityId);
    if (source && source.kindOf.has('BRIDGE_TOWER')) return;
  }

  // Calculate healing as percentage of bridge max health.
  const healPercentage = bridge.maxHealth > 0 ? healAmount / bridge.maxHealth : 0;
  if (healPercentage <= 0) return;

  // Propagate proportional healing to all towers.
  for (const towerId of state.towerIds) {
    const tower = self.spawnedEntities.get(towerId);
    if (!tower || tower.destroyed) continue;
    const towerHealAmount = healPercentage * tower.maxHealth;
    tower.health = Math.min(tower.maxHealth, tower.health + towerHealAmount);
  }
}

export function bridgeBehaviorOnDie(self: GL, bridge: MapEntity): void {
  const state = bridge.bridgeBehaviorState;
  if (!state) return;

  // Kill all towers.
  for (const towerId of state.towerIds) {
    const tower = self.spawnedEntities.get(towerId);
    if (tower && !tower.destroyed) {
      self.markEntityDestroyed(tower.id, bridge.id);
    }
  }

  // Handle objects standing on bridge — kill entities that can't fly.
  handleObjectsOnBridgeDeath(self, bridge);

  // Mark bridge cells as impassable in nav grid.
  if (self.navigationGrid) {
    for (const cell of state.bridgeCells) {
      const index = cell.z * self.navigationGrid.width + cell.x;
      if (index >= 0 && index < self.navigationGrid.bridgePassable.length) {
        self.navigationGrid.bridgePassable[index] = 0;
      }
    }
  }

  // Record death frame for timed FX.
  state.isBridgeDestroyed = true;
  state.deathFrame = self.frameCounter;
}

export function handleObjectsOnBridgeDeath(self: GL, bridge: MapEntity): void {
  // Simple implementation: kill non-bridge, non-aircraft entities near the bridge.
  const scanRadius = 50; // Bridge scan radius
  const bx = bridge.x;
  const bz = bridge.z;

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) continue;
    if (entity.id === bridge.id) continue;
    if (entity.kindOf.has('BRIDGE') || entity.kindOf.has('BRIDGE_TOWER')) continue;
    if (entity.kindOf.has('AIRCRAFT')) continue;

    const dx = entity.x - bx;
    const dz = entity.z - bz;
    if (dx * dx + dz * dz > scanRadius * scanRadius) continue;

    // Source parity: if they have physics, let them fall; otherwise kill them.
    if (entity.physicsBehaviorProfile) {
      // They have physics — they will fall.
    } else {
      self.markEntityDestroyed(entity.id, bridge.id);
    }
  }
}

export function bridgeTowerOnDamage(self: GL, 
  tower: MapEntity,
  sourceEntityId: number | null,
  amount: number,
  damageType: string,
): void {
  const state = tower.bridgeTowerState;
  if (!state) return;

  const bridge = self.spawnedEntities.get(state.bridgeEntityId);
  if (!bridge || bridge.destroyed) return;

  const bridgeState = bridge.bridgeBehaviorState;
  if (!bridgeState) return;

  // Skip propagation if source is a bridge or bridge tower (prevents recursion).
  if (sourceEntityId !== null) {
    const source = self.spawnedEntities.get(sourceEntityId);
    if (source && (source.kindOf.has('BRIDGE') || source.kindOf.has('BRIDGE_TOWER'))) return;
  }

  // Calculate damage as percentage of this tower's max health.
  const damagePercentage = tower.maxHealth > 0 ? amount / tower.maxHealth : 0;
  if (damagePercentage <= 0) return;

  // Propagate damage to other towers (not self).
  for (const otherTowerId of bridgeState.towerIds) {
    const otherTower = self.spawnedEntities.get(otherTowerId);
    if (!otherTower || otherTower.destroyed || otherTower.id === tower.id) continue;
    const otherDamageAmount = damagePercentage * otherTower.maxHealth;
    // Source parity: use this tower as source to prevent recursion.
    self.applyWeaponDamageAmount(tower.id, otherTower, otherDamageAmount, damageType);
  }

  // Propagate damage to bridge.
  const bridgeDamageAmount = damagePercentage * bridge.maxHealth;
  self.applyWeaponDamageAmount(tower.id, bridge, bridgeDamageAmount, damageType);
}

export function bridgeTowerOnHealing(self: GL, 
  tower: MapEntity,
  healAmount: number,
  sourceEntityId: number | null,
): void {
  const state = tower.bridgeTowerState;
  if (!state) return;

  const bridge = self.spawnedEntities.get(state.bridgeEntityId);
  if (!bridge || bridge.destroyed) return;

  const bridgeState = bridge.bridgeBehaviorState;
  if (!bridgeState) return;

  // Skip propagation if source is a bridge or bridge tower.
  if (sourceEntityId !== null) {
    const source = self.spawnedEntities.get(sourceEntityId);
    if (source && (source.kindOf.has('BRIDGE') || source.kindOf.has('BRIDGE_TOWER'))) return;
  }

  // Calculate healing as percentage of this tower's max health.
  const healPercentage = tower.maxHealth > 0 ? healAmount / tower.maxHealth : 0;
  if (healPercentage <= 0) return;

  // Propagate healing to other towers.
  for (const otherTowerId of bridgeState.towerIds) {
    const otherTower = self.spawnedEntities.get(otherTowerId);
    if (!otherTower || otherTower.destroyed || otherTower.id === tower.id) continue;
    const otherHealAmount = healPercentage * otherTower.maxHealth;
    otherTower.health = Math.min(otherTower.maxHealth, otherTower.health + otherHealAmount);
  }

  // Propagate healing to bridge.
  const bridgeHealAmount = healPercentage * bridge.maxHealth;
  bridge.health = Math.min(bridge.maxHealth, bridge.health + bridgeHealAmount);

  // Source parity: if bridge was destroyed and has been healed back, restore passability.
  if (bridgeState.isBridgeDestroyed && bridge.health > 0) {
    bridgeRestorePassability(self, bridge);
  }
}

export function bridgeTowerOnDie(self: GL, tower: MapEntity): void {
  const state = tower.bridgeTowerState;
  if (!state) return;

  const bridge = self.spawnedEntities.get(state.bridgeEntityId);
  if (bridge && !bridge.destroyed) {
    // Source parity: tower death kills the bridge.
    bridge.health = 0;
    if (!bridge.slowDeathState && !bridge.structureCollapseState) {
      self.markEntityDestroyed(bridge.id, tower.id);
    }
  }
}

export function bridgeRestorePassability(self: GL, bridge: MapEntity): void {
  const state = bridge.bridgeBehaviorState;
  if (!state) return;

  if (self.navigationGrid) {
    for (const cell of state.bridgeCells) {
      const index = cell.z * self.navigationGrid.width + cell.x;
      if (index >= 0 && index < self.navigationGrid.bridgePassable.length) {
        self.navigationGrid.bridgePassable[index] = 1;
      }
    }
  }

  state.isBridgeDestroyed = false;
  state.deathFrame = 0;
}
