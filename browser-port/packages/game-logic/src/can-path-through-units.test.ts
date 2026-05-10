import { describe, expect, it } from 'vitest';
import { RELATIONSHIP_ALLIES } from './index.js';
import { updateUnitCollisionSeparation } from './entity-movement.js';

function makeCollisionEntity(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    x: 0,
    z: 0,
    destroyed: false,
    canMove: true,
    category: 'vehicle',
    noCollisions: false,
    objectStatusFlags: new Set<string>(),
    locomotorSets: new Map([['NORMAL', {}]]),
    transportContainerId: null,
    helixCarrierId: null,
    garrisonContainerId: null,
    tunnelContainerId: null,
    ignoredMovementObstacleId: null,
    canPathThroughUnits: false,
    obstacleGeometry: { majorRadius: 8, minorRadius: 8, shape: 'circle' },
    moving: true,
    attackTargetEntityId: null,
    attackTargetPosition: null,
    guardState: 'NONE',
    isImmobile: false,
    moveTarget: null,
    ...overrides,
  };
}

describe('AIUpdateInterface::m_canPathThroughUnits collision parity', () => {
  it('skips allied unit separation while canPathThroughUnits is active', () => {
    const source = makeCollisionEntity({ id: 1, x: 0, z: 0, canPathThroughUnits: true });
    const blocker = makeCollisionEntity({ id: 2, x: 1, z: 0, moving: false });
    const self: any = {
      spawnedEntities: new Map<number, any>([
        [1, source],
        [2, blocker],
      ]),
      getTeamRelationship: () => RELATIONSHIP_ALLIES,
    };

    updateUnitCollisionSeparation(self);

    expect(source.x).toBe(0);
    expect(source.z).toBe(0);
    expect(blocker.x).toBe(1);
    expect(blocker.z).toBe(0);
  });

  it('separates the same overlapped pair when canPathThroughUnits is inactive', () => {
    const source = makeCollisionEntity({ id: 1, x: 0, z: 0, canPathThroughUnits: false });
    const blocker = makeCollisionEntity({ id: 2, x: 1, z: 0, moving: false });
    const self: any = {
      spawnedEntities: new Map<number, any>([
        [1, source],
        [2, blocker],
      ]),
      getTeamRelationship: () => RELATIONSHIP_ALLIES,
    };

    updateUnitCollisionSeparation(self);

    expect(source.x).toBeLessThan(0);
    expect(blocker.x).toBeGreaterThan(1);
  });
});
