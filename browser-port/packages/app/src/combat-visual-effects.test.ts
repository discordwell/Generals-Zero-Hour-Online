import { describe, expect, it } from 'vitest';

import { planCombatVisualEffects } from './combat-visual-effects.js';

describe('planCombatVisualEffects', () => {
  it('maps missile impacts to explosion visuals and explosion audio', () => {
    const actions = planCombatVisualEffects({
      type: 'WEAPON_IMPACT',
      x: 0,
      y: 0,
      z: 0,
      radius: 7,
      sourceEntityId: 1,
      projectileType: 'MISSILE',
    });

    expect(actions).toEqual([
      { type: 'spawnExplosion', radius: 7 },
      { type: 'playAudio', eventName: 'CombatExplosionLarge' },
    ]);
  });

  it('maps laser impacts to spark-like flash without explosion audio', () => {
    const actions = planCombatVisualEffects({
      type: 'WEAPON_IMPACT',
      x: 0,
      y: 0,
      z: 0,
      radius: 1,
      sourceEntityId: 1,
      projectileType: 'LASER',
    });

    expect(actions).toEqual([
      { type: 'spawnMuzzleFlash' },
    ]);
  });

  it('maps bullet impacts to lightweight flash and gunshot audio', () => {
    const actions = planCombatVisualEffects({
      type: 'WEAPON_IMPACT',
      x: 0,
      y: 0,
      z: 0,
      radius: 1,
      sourceEntityId: 1,
      projectileType: 'BULLET',
    });

    expect(actions).toEqual([
      { type: 'spawnMuzzleFlash' },
      { type: 'playAudio', eventName: 'CombatGunshot' },
    ]);
  });

  it('maps fired events to muzzle flash and projectile-specific fire audio', () => {
    const artillery = planCombatVisualEffects({
      type: 'WEAPON_FIRED',
      x: 0,
      y: 0,
      z: 0,
      radius: 0,
      sourceEntityId: 2,
      projectileType: 'ARTILLERY',
    });

    expect(artillery).toEqual([
      { type: 'spawnMuzzleFlash' },
      { type: 'playAudio', eventName: 'CombatArtilleryFire' },
    ]);
  });

  it('suppresses rubble/smoke for small destruction events', () => {
    const actions = planCombatVisualEffects({
      type: 'ENTITY_DESTROYED',
      x: 0,
      y: 0,
      z: 0,
      radius: 1,
      sourceEntityId: null,
      projectileType: 'BULLET',
    });

    expect(actions).toEqual([
      { type: 'spawnDestruction', radius: 1 },
      { type: 'playAudio', eventName: 'CombatEntityDestroyed' },
    ]);
  });

  it('adds rubble/smoke for large destruction events', () => {
    const actions = planCombatVisualEffects({
      type: 'ENTITY_DESTROYED',
      x: 0,
      y: 0,
      z: 0,
      radius: 4,
      sourceEntityId: null,
      projectileType: 'BULLET',
    });

    expect(actions).toEqual([
      { type: 'spawnDestruction', radius: 4 },
      { type: 'playAudio', eventName: 'CombatEntityDestroyed' },
      { type: 'spawnRubble', radius: 4 },
      { type: 'spawnSmokeColumn' },
    ]);
  });
});

