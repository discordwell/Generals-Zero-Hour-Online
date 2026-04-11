interface ParkingPlaceProfileLike {
  totalSpaces: number;
  occupiedSpaceEntityIds: Set<number>;
  reservedProductionIds: Set<number>;
  spaceOccupantIds?: number[];
  spaceReservedForExit?: boolean[];
  spaceReservedProductionIds?: Array<number | null>;
}

interface ProductionQueueEntryLike {
  type: string;
  productionId: number;
}

interface SpawnedEntityLike {
  destroyed: boolean;
}

function normalizeKindOf(kindOf: readonly string[] | undefined): Set<string> {
  const normalized = new Set<string>();
  if (!Array.isArray(kindOf)) {
    return normalized;
  }
  for (const token of kindOf) {
    const nextToken = token.trim().toUpperCase();
    if (nextToken) {
      normalized.add(nextToken);
    }
  }
  return normalized;
}

export function shouldReserveParkingDoorWhenQueued(kindOf: readonly string[] | undefined): boolean {
  // Source parity: ParkingPlaceBehavior::shouldReserveDoorWhenQueued() bypasses parking
  // reservation for KINDOF_PRODUCED_AT_HELIPAD units.
  return !normalizeKindOf(kindOf).has('PRODUCED_AT_HELIPAD');
}

export function releaseParkingDoorReservationForProduction(
  parkingProfile: ParkingPlaceProfileLike | null,
  productionId: number,
): void {
  if (!parkingProfile) {
    return;
  }
  parkingProfile.reservedProductionIds.delete(productionId);
  const reservedProductionIds = parkingProfile.spaceReservedProductionIds;
  if (!Array.isArray(reservedProductionIds)) {
    return;
  }
  const index = reservedProductionIds.findIndex((reservedProductionId) => reservedProductionId === productionId);
  if (index >= 0) {
    reservedProductionIds[index] = null;
    if (Array.isArray(parkingProfile.spaceReservedForExit)) {
      parkingProfile.spaceReservedForExit[index] = false;
    }
  }
}

export function pruneParkingReservations(
  parkingProfile: ParkingPlaceProfileLike | null,
  productionQueue: readonly ProductionQueueEntryLike[],
): void {
  if (!parkingProfile || parkingProfile.reservedProductionIds.size === 0) {
    return;
  }

  const activeUnitProductionIds = new Set<number>();
  for (const entry of productionQueue) {
    if (entry.type === 'UNIT') {
      activeUnitProductionIds.add(entry.productionId);
    }
  }

  for (const reservedProductionId of Array.from(parkingProfile.reservedProductionIds.values())) {
    if (!activeUnitProductionIds.has(reservedProductionId)) {
      parkingProfile.reservedProductionIds.delete(reservedProductionId);
      const reservedProductionIds = parkingProfile.spaceReservedProductionIds;
      if (Array.isArray(reservedProductionIds)) {
        const index = reservedProductionIds.findIndex((candidate) => candidate === reservedProductionId);
        if (index >= 0) {
          reservedProductionIds[index] = null;
          if (Array.isArray(parkingProfile.spaceReservedForExit)) {
            parkingProfile.spaceReservedForExit[index] = false;
          }
        }
      }
    }
  }
}

export function pruneParkingOccupancy(
  parkingProfile: ParkingPlaceProfileLike | null,
  spawnedEntities: ReadonlyMap<number, SpawnedEntityLike>,
): void {
  if (!parkingProfile) {
    return;
  }

  for (const occupiedEntityId of Array.from(parkingProfile.occupiedSpaceEntityIds.values())) {
    const occupiedEntity = spawnedEntities.get(occupiedEntityId);
    if (!occupiedEntity || occupiedEntity.destroyed) {
      parkingProfile.occupiedSpaceEntityIds.delete(occupiedEntityId);
      if (Array.isArray(parkingProfile.spaceOccupantIds)) {
        const index = parkingProfile.spaceOccupantIds.findIndex((candidate) => candidate === occupiedEntityId);
        if (index >= 0) {
          parkingProfile.spaceOccupantIds[index] = 0;
          if (Array.isArray(parkingProfile.spaceReservedForExit)) {
            parkingProfile.spaceReservedForExit[index] = false;
          }
          if (Array.isArray(parkingProfile.spaceReservedProductionIds)) {
            parkingProfile.spaceReservedProductionIds[index] = null;
          }
        }
      }
    }
  }
}

function syncParkingSpaceArraysFromOccupiedSet(parkingProfile: ParkingPlaceProfileLike): void {
  const occupantIds = parkingProfile.spaceOccupantIds;
  if (!Array.isArray(occupantIds) || occupantIds.length === 0) {
    return;
  }
  const reservedFlags = parkingProfile.spaceReservedForExit;
  for (const occupiedEntityId of parkingProfile.occupiedSpaceEntityIds.values()) {
    if (occupantIds.includes(occupiedEntityId)) {
      continue;
    }
    const freeIndex = occupantIds.findIndex((candidate, index) =>
      (candidate ?? 0) <= 0 && reservedFlags?.[index] !== true);
    if (freeIndex >= 0) {
      occupantIds[freeIndex] = occupiedEntityId;
    }
  }
}

function findFreeParkingSpaceIndex(parkingProfile: ParkingPlaceProfileLike): number {
  const occupantIds = parkingProfile.spaceOccupantIds;
  const reservedFlags = parkingProfile.spaceReservedForExit;
  if (!Array.isArray(occupantIds) || occupantIds.length === 0) {
    return -1;
  }
  for (let index = 0; index < Math.min(occupantIds.length, parkingProfile.totalSpaces); index += 1) {
    if ((occupantIds[index] ?? 0) <= 0 && reservedFlags?.[index] !== true) {
      return index;
    }
  }
  return -1;
}

function hasParkingSpaceArrays(parkingProfile: ParkingPlaceProfileLike): boolean {
  return Array.isArray(parkingProfile.spaceOccupantIds) && parkingProfile.spaceOccupantIds.length > 0;
}

function refreshParkingState(
  parkingProfile: ParkingPlaceProfileLike,
  productionQueue: readonly ProductionQueueEntryLike[],
  spawnedEntities: ReadonlyMap<number, SpawnedEntityLike>,
): void {
  pruneParkingOccupancy(parkingProfile, spawnedEntities);
  pruneParkingReservations(parkingProfile, productionQueue);
  syncParkingSpaceArraysFromOccupiedSet(parkingProfile);
}

export function hasAvailableParkingSpace(
  parkingProfile: ParkingPlaceProfileLike | null,
  productionQueue: readonly ProductionQueueEntryLike[],
  spawnedEntities: ReadonlyMap<number, SpawnedEntityLike>,
): boolean {
  if (!parkingProfile) {
    return true;
  }

  refreshParkingState(parkingProfile, productionQueue, spawnedEntities);
  if (hasParkingSpaceArrays(parkingProfile)) {
    return findFreeParkingSpaceIndex(parkingProfile) >= 0;
  }
  return (parkingProfile.occupiedSpaceEntityIds.size + parkingProfile.reservedProductionIds.size)
    < parkingProfile.totalSpaces;
}

export function reserveParkingDoorForQueuedUnit(
  parkingProfile: ParkingPlaceProfileLike | null,
  productionQueue: readonly ProductionQueueEntryLike[],
  spawnedEntities: ReadonlyMap<number, SpawnedEntityLike>,
  productionId: number,
): boolean {
  if (!parkingProfile) {
    return true;
  }

  refreshParkingState(parkingProfile, productionQueue, spawnedEntities);
  if (hasParkingSpaceArrays(parkingProfile)) {
    const freeIndex = findFreeParkingSpaceIndex(parkingProfile);
    if (freeIndex < 0) {
      return false;
    }
    parkingProfile.spaceReservedForExit![freeIndex] = true;
    if (Array.isArray(parkingProfile.spaceReservedProductionIds)) {
      parkingProfile.spaceReservedProductionIds[freeIndex] = productionId;
    }
    parkingProfile.reservedProductionIds.add(productionId);
    return true;
  }
  if ((parkingProfile.occupiedSpaceEntityIds.size + parkingProfile.reservedProductionIds.size) >= parkingProfile.totalSpaces) {
    return false;
  }

  // Source parity: ProductionUpdate::queueCreateUnit() reserves an exit door up front
  // via ParkingPlaceBehavior::reserveDoorForExit() for units that require hangar parking.
  parkingProfile.reservedProductionIds.add(productionId);
  return true;
}

export function canExitProducedUnitViaParking(
  parkingProfile: ParkingPlaceProfileLike | null,
  productionQueue: readonly ProductionQueueEntryLike[],
  spawnedEntities: ReadonlyMap<number, SpawnedEntityLike>,
  productionId: number,
): boolean {
  if (!parkingProfile) {
    return true;
  }

  refreshParkingState(parkingProfile, productionQueue, spawnedEntities);
  if (parkingProfile.reservedProductionIds.has(productionId)) {
    return true;
  }
  if (hasParkingSpaceArrays(parkingProfile)) {
    return findFreeParkingSpaceIndex(parkingProfile) >= 0;
  }

  return (parkingProfile.occupiedSpaceEntityIds.size + parkingProfile.reservedProductionIds.size)
    < parkingProfile.totalSpaces;
}

export function reserveParkingSpaceForProducedUnit(
  parkingProfile: ParkingPlaceProfileLike | null,
  productionQueue: readonly ProductionQueueEntryLike[],
  spawnedEntities: ReadonlyMap<number, SpawnedEntityLike>,
  productionId: number,
  producedUnitId: number,
): boolean {
  if (!parkingProfile) {
    return true;
  }

  refreshParkingState(parkingProfile, productionQueue, spawnedEntities);
  if (parkingProfile.reservedProductionIds.has(productionId)) {
    parkingProfile.reservedProductionIds.delete(productionId);
    const reservedProductionIds = parkingProfile.spaceReservedProductionIds;
    if (Array.isArray(parkingProfile.spaceOccupantIds) && Array.isArray(reservedProductionIds)) {
      const reservedIndex = reservedProductionIds.findIndex((candidate) => candidate === productionId);
      if (reservedIndex >= 0) {
        parkingProfile.spaceOccupantIds[reservedIndex] = producedUnitId;
        if (Array.isArray(parkingProfile.spaceReservedForExit)) {
          parkingProfile.spaceReservedForExit[reservedIndex] = false;
        }
        reservedProductionIds[reservedIndex] = null;
        parkingProfile.occupiedSpaceEntityIds.add(producedUnitId);
        return true;
      }
    }
  } else if ((parkingProfile.occupiedSpaceEntityIds.size + parkingProfile.reservedProductionIds.size) >= parkingProfile.totalSpaces) {
    if (!hasParkingSpaceArrays(parkingProfile) || findFreeParkingSpaceIndex(parkingProfile) < 0) {
      return false;
    }
  }

  if (Array.isArray(parkingProfile.spaceOccupantIds)) {
    const freeIndex = findFreeParkingSpaceIndex(parkingProfile);
    if (freeIndex >= 0) {
      parkingProfile.spaceOccupantIds[freeIndex] = producedUnitId;
    }
  }

  parkingProfile.occupiedSpaceEntityIds.add(producedUnitId);
  return true;
}
