// @ts-nocheck - containment entity shape is shared with the main game logic module.

/* eslint-disable @typescript-eslint/no-explicit-any */

type GL = any;

function addContainedEntityId(
  containedByContainerId: Map<number, Set<number>>,
  containerId: number | null,
  entityId: number,
): void {
  if (containerId === null) {
    return;
  }
  let containedIds = containedByContainerId.get(containerId);
  if (!containedIds) {
    containedIds = new Set<number>();
    containedByContainerId.set(containerId, containedIds);
  }
  containedIds.add(entityId);
}

export function buildContainedEntityIdsByContainerId(self: GL): Map<number, number[]> {
  const containedByContainerId = new Map<number, Set<number>>();

  for (const container of self.spawnedEntities.values()) {
    if (!container.parkingPlaceProfile) {
      continue;
    }
    for (const entityId of container.parkingPlaceProfile.occupiedSpaceEntityIds.values()) {
      addContainedEntityId(containedByContainerId, container.id, entityId);
    }
  }

  for (const entity of self.spawnedEntities.values()) {
    if (entity.destroyed) {
      continue;
    }
    addContainedEntityId(containedByContainerId, entity.parkingSpaceProducerId, entity.id);
    addContainedEntityId(containedByContainerId, entity.helixCarrierId, entity.id);
    addContainedEntityId(containedByContainerId, entity.garrisonContainerId, entity.id);
    addContainedEntityId(containedByContainerId, entity.transportContainerId, entity.id);
    addContainedEntityId(containedByContainerId, entity.tunnelContainerId, entity.id);
  }

  const result = new Map<number, number[]>();
  for (const [containerId, entityIds] of containedByContainerId) {
    result.set(containerId, Array.from(entityIds.values()).sort((left, right) => left - right));
  }
  return result;
}
