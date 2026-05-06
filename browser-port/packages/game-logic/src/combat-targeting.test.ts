import { describe, expect, it } from 'vitest';

import { canAttackerTargetEntity } from './combat-targeting.js';

function makeSelfStub() {
  return {
    entityHasObjectStatus: (entity: { objectStatusFlags?: Set<string> }, status: string) =>
      entity.objectStatusFlags?.has(status) ?? false,
    resolveEntityKindOfSet: (entity: { kindOf?: Set<string> }) => entity.kindOf ?? new Set<string>(),
    getTeamRelationship: () => 0,
    isEntityOffMap: () => false,
    isEntityStealthedAndUndetected: () => false,
    isEntityInEnclosingContainer: () => false,
    collectContainedEntityIds: () => [],
    fogOfWarGrid: null,
  } as never;
}

function makeEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    x: 0,
    y: 0,
    z: 0,
    side: 'America',
    canTakeDamage: true,
    destroyed: false,
    sourceAIUpdateIsDead: false,
    objectStatusFlags: new Set<string>(),
    kindOf: new Set<string>(),
    visionRange: 0,
    containProfile: null,
    totalWeaponAntiMask: 0,
    attackWeapon: null,
    ...overrides,
  } as never;
}

function makePitchLimitedWeapon(overrides: Record<string, unknown> = {}) {
  return {
    minTargetPitch: 45 * Math.PI / 180,
    maxTargetPitch: 80 * Math.PI / 180,
    allowAttackGarrisonedBldgs: true,
    ...overrides,
  };
}

describe('canAttackerTargetEntity pitch limits', () => {
  it('accepts small vertical deltas before applying weapon pitch limits', () => {
    const attacker = makeEntity({
      id: 1,
      attackWeapon: makePitchLimitedWeapon(),
    });
    const target = makeEntity({
      id: 2,
      y: 5,
    });

    expect(canAttackerTargetEntity(makeSelfStub(), attacker, target, 'PLAYER')).toBe(true);
  });

  it('rejects larger vertical deltas outside the weapon pitch range', () => {
    const attacker = makeEntity({
      id: 1,
      attackWeapon: makePitchLimitedWeapon(),
    });
    const target = makeEntity({
      id: 2,
      y: 20,
    });

    expect(canAttackerTargetEntity(makeSelfStub(), attacker, target, 'PLAYER')).toBe(false);
  });
});
