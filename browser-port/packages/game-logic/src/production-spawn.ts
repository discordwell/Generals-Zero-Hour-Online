import type { HeightmapGrid } from '@generals/terrain';

interface UnitCreatePoint {
  x: number;
  y: number;
  z: number;
}

interface NaturalRallyPoint {
  x: number;
  y: number;
  z: number;
}

interface QueueProductionExitProfileLike {
  moduleType: 'QUEUE' | 'SUPPLY_CENTER' | 'SPAWN_POINT';
  unitCreatePoint: UnitCreatePoint;
  naturalRallyPoint: NaturalRallyPoint | null;
  allowAirborneCreation: boolean;
  useSpawnRallyPoint?: boolean;
}

interface ProducerForSpawnResolution {
  x: number;
  z: number;
  y: number;
  rotationY: number;
  baseHeight: number;
  rallyPoint: { x: number; z: number } | null;
  queueProductionExitProfile: QueueProductionExitProfileLike | null;
}

interface ProducerForQueueExitGateTick {
  queueProductionExitProfile: QueueProductionExitProfileLike | null;
  queueProductionExitBurstRemaining: number;
  queueProductionExitDelayFramesRemaining: number;
}

export function tickQueueExitGate(producer: ProducerForQueueExitGateTick): void {
  if (!producer.queueProductionExitProfile) {
    return;
  }

  const isFreeToExit = producer.queueProductionExitBurstRemaining > 0
    || producer.queueProductionExitDelayFramesRemaining === 0;
  if (isFreeToExit) {
    producer.queueProductionExitDelayFramesRemaining = 0;
    return;
  }

  producer.queueProductionExitDelayFramesRemaining = Math.max(
    0,
    producer.queueProductionExitDelayFramesRemaining - 1,
  );
}

export function resolveQueueSpawnLocation(
  producer: ProducerForSpawnResolution,
  mapHeightmap: HeightmapGrid | null,
): {
  x: number;
  z: number;
  heightOffset: number;
} | null {
  const exitProfile = producer.queueProductionExitProfile;
  if (!exitProfile) {
    return null;
  }

  const yaw = producer.rotationY;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = exitProfile.unitCreatePoint;
  const x = producer.x + (local.x * cos - local.y * sin);
  const z = producer.z + (local.x * sin + local.y * cos);
  const terrainHeight = mapHeightmap ? mapHeightmap.getInterpolatedHeight(x, z) : 0;
  const producerBaseY = producer.y - producer.baseHeight;
  let worldY = producerBaseY + local.z;
  const creationInAir = Math.abs(worldY - terrainHeight) > 0.0001;
  if (creationInAir && !exitProfile.allowAirborneCreation) {
    worldY = terrainHeight;
  }

  return {
    x,
    z,
    heightOffset: worldY - terrainHeight,
  };
}

/**
 * Source parity: DefaultProductionExitUpdate::exitObjectViaDoor —
 * builds an exit path with the natural rally point first, then the
 * player-set rally point (if any).  The C++ code always pushes the
 * natural rally point, and conditionally appends the player rally point
 * for ground-movable units.
 *
 * QueueProductionExitUpdate variant (lines 153-156): when no player
 * rally point is set, it doubles the natural rally point to prevent
 * units from stacking.
 */
export function resolveQueueProductionExitPath(
  producer: ProducerForSpawnResolution,
  producedUnitCanMove: boolean,
  mapXyFactor: number,
  producedUnitIsGroundMover: boolean = true,
): { x: number; z: number }[] {
  if (!producedUnitCanMove) {
    return [];
  }

  const exitProfile = producer.queueProductionExitProfile;
  if (!exitProfile || !exitProfile.naturalRallyPoint) {
    // No exit profile — fall back to just the player rally point if set.
    if (producer.rallyPoint && producedUnitIsGroundMover) {
      return [{ x: producer.rallyPoint.x, z: producer.rallyPoint.z }];
    }
    return [];
  }

  // Compute the natural rally point in world space.
  // Source parity: getNaturalRallyPoint(offset=TRUE) adds 2*PATHFIND_CELL_SIZE
  // along the normalized rally vector for Default and Queue types.
  // SupplyCenter reads m_naturalRallyPoint directly (no offset).
  const rallyLocal = { ...exitProfile.naturalRallyPoint };
  if (exitProfile.moduleType !== 'SUPPLY_CENTER') {
    const magnitude = Math.hypot(rallyLocal.x, rallyLocal.y, rallyLocal.z);
    if (magnitude > 0) {
      const offsetScale = (2 * mapXyFactor) / magnitude;
      rallyLocal.x += rallyLocal.x * offsetScale;
      rallyLocal.y += rallyLocal.y * offsetScale;
      rallyLocal.z += rallyLocal.z * offsetScale;
    }
  }

  const yaw = producer.rotationY;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const naturalWorld = {
    x: producer.x + (rallyLocal.x * cos - rallyLocal.y * sin),
    z: producer.z + (rallyLocal.x * sin + rallyLocal.y * cos),
  };

  const path: { x: number; z: number }[] = [naturalWorld];

  // Source parity: player rally point is appended after the natural point.
  // Default/Queue: only for ground-moving units (C++ ai->isDoingGroundMovement()).
  // SupplyCenter: always appended (no ground movement check in C++).
  if (producer.rallyPoint) {
    const shouldAppendRally = exitProfile.moduleType === 'SUPPLY_CENTER'
      || producedUnitIsGroundMover;
    if (shouldAppendRally) {
      path.push({ x: producer.rallyPoint.x, z: producer.rallyPoint.z });
    }
  } else if (exitProfile.moduleType === 'QUEUE') {
    // Source parity: QueueProductionExitUpdate.cpp lines 153-156 —
    // "Double the destination to keep redguards from stacking."
    path.push({ ...naturalWorld });
  }

  return path;
}

/** @deprecated Use resolveQueueProductionExitPath instead. */
export function resolveQueueProductionNaturalRallyPoint(
  producer: ProducerForSpawnResolution,
  producedUnitCanMove: boolean,
  mapXyFactor: number,
  producedUnitIsGroundMover: boolean = true,
): { x: number; z: number } | null {
  const path = resolveQueueProductionExitPath(producer, producedUnitCanMove, mapXyFactor, producedUnitIsGroundMover);
  return path.length > 0 ? path[0]! : null;
}
