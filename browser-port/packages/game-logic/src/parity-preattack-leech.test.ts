/**
 * Parity Tests — PreAttackDelay PER_ATTACK mode and Leech Range Weapon Activation.
 *
 * 1. Pre-Attack Delay PER_ATTACK Mode
 *    C++ Weapon.cpp:2565-2584 — PER_ATTACK mode applies pre-attack delay only on first shot
 *    against a new target. Continuing to fire the same target has no delay after the first.
 *    TS combat-update.ts — preAttackFinishFrame gated by resolveWeaponPreAttackDelayFrames,
 *    which checks consecutiveShotsAtTarget > 0 for PER_ATTACK.
 *
 * 2. Leech Range Weapon Activation
 *    C++ Weapon.cpp:2429-2432 — leech range weapons get unlimited range after first shot connects.
 *    Activated during pre-fire phase (Weapon::preFireWeapon sets m_leechWeaponRangeActive).
 *    TS combat-update.ts — leechRangeActive flag set on pre-attack and after first fire,
 *    bypasses range check: `distanceSqr > attackRangeSqr && !(weapon.leechRangeWeapon && attacker.leechRangeActive)`.
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  place,
} from './parity-agent.js';

describe('parity pre-attack delay PER_ATTACK mode', () => {
  it('first shot against a target has pre-attack delay, subsequent shots do not', () => {
    // PreAttackDelay=500ms = 15 frames at 30fps. DelayBetweenShots=100ms = 3 frames.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('PerAttackGun'),
          ]),
          makeObjectDef('TargetA', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('PerAttackGun', {
            PrimaryDamage: 20,
            AttackRange: 120,
            DelayBetweenShots: 100,   // 3 frames
            PreAttackDelay: 500,      // 15 frames
            PreAttackType: 'PER_ATTACK',
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('TargetA', 30, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Track health per frame to find when shots land
    const healthTimeline: number[] = [];
    for (let i = 0; i < 30; i++) {
      agent.step(1);
      const t = agent.entity(2);
      healthTimeline.push(t ? t.health : -1);
    }

    const damageFrames = healthTimeline
      .map((h, i) => i > 0 && h < healthTimeline[i - 1]! ? i : -1)
      .filter((f) => f >= 0);

    // Must have at least 3 shots to check pattern
    expect(damageFrames.length).toBeGreaterThanOrEqual(3);

    // First shot should be delayed by PreAttackDelay (~15 frames from frame 0).
    // The first damage frame should be around frame 15-17 (allowing for rounding/processing).
    const firstShotFrame = damageFrames[0]!;
    expect(firstShotFrame).toBeGreaterThanOrEqual(13);

    // Subsequent shots should come at DelayBetweenShots intervals (~3 frames),
    // NOT at PreAttackDelay + DelayBetweenShots (~18 frames).
    const gap1to2 = damageFrames[1]! - damageFrames[0]!;
    const gap2to3 = damageFrames[2]! - damageFrames[1]!;

    // Source parity: PER_ATTACK means only the first shot has pre-attack delay.
    // Subsequent shots should only have DelayBetweenShots (3 frames), not 15+3=18 frames.
    expect(gap1to2).toBeLessThanOrEqual(6);
    expect(gap2to3).toBeLessThanOrEqual(6);
  });

  it('switching targets re-triggers the pre-attack delay', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('PerAttackGun'),
          ]),
          makeObjectDef('TargetA', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
          makeObjectDef('TargetB', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('PerAttackGun', {
            PrimaryDamage: 20,
            AttackRange: 120,
            DelayBetweenShots: 100,   // 3 frames
            PreAttackDelay: 500,      // 15 frames
            PreAttackType: 'PER_ATTACK',
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 10, 10),
        place('TargetA', 30, 10),
        place('TargetB', 50, 10),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Attack target A and wait for first shot + one more
    agent.attack(1, 2);
    agent.step(25);

    const targetAHealth = agent.entity(2)!.health;
    expect(targetAHealth).toBeLessThan(2000); // Should have dealt damage to A

    // Switch to target B — PER_ATTACK should re-trigger delay for new target
    agent.attack(1, 3);
    const snapshotBeforeB = agent.snapshot();

    // Track damage to B per frame
    const healthTimelineB: number[] = [];
    for (let i = 0; i < 25; i++) {
      agent.step(1);
      const t = agent.entity(3);
      healthTimelineB.push(t ? t.health : -1);
    }

    const damageFramesB = healthTimelineB
      .map((h, i) => i > 0 && h < healthTimelineB[i - 1]! ? i : -1)
      .filter((f) => f >= 0);

    expect(damageFramesB.length).toBeGreaterThanOrEqual(1);

    // Source parity: switching to a new target resets consecutive shots,
    // so PER_ATTACK re-applies the pre-attack delay.
    // First shot on B should be delayed by ~15 frames, not immediate.
    const firstShotOnB = damageFramesB[0]!;
    expect(firstShotOnB).toBeGreaterThanOrEqual(13);
  });
});

describe('parity leech range weapon activation', () => {
  it('leech range weapon can fire beyond AttackRange after first shot connects', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LeechGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('LeechGun', {
            PrimaryDamage: 30,
            AttackRange: 100,
            DelayBetweenShots: 100,
            LeechRangeWeapon: true,
          }),
        ],
      },
      // Place target within AttackRange (distance = 80 < 100)
      mapObjects: [place('Attacker', 10, 10), place('Target', 90, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Wait for first shot to fire
    agent.step(10);
    const targetAfterFirstShot = agent.entity(2)!;
    expect(targetAfterFirstShot.health).toBeLessThan(2000);

    // Verify leech range is now active on the attacker entity
    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, { leechRangeActive: boolean; x: number; z: number }> };
    const attackerEntity = logic.spawnedEntities.get(1)!;
    expect(attackerEntity.leechRangeActive).toBe(true);

    // Move target far beyond AttackRange (distance = 200, well past range of 100)
    const targetEntity = logic.spawnedEntities.get(2)!;
    targetEntity.x = 210;
    targetEntity.z = 10;

    // Verify the target is now beyond normal attack range
    const dx = targetEntity.x - attackerEntity.x;
    const dz = targetEntity.z - attackerEntity.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    expect(distance).toBeGreaterThan(100);

    // Re-issue attack command at new position
    agent.attack(1, 2);
    const healthBeforeFarShot = agent.entity(2)!.health;

    // Step enough for shots to fire at the far target
    agent.step(15);

    // Source parity: leech range weapons bypass the range check once active.
    // The attacker should continue dealing damage even though target is at distance ~200.
    const healthAfterFarShot = agent.entity(2)!.health;
    expect(healthAfterFarShot).toBeLessThan(healthBeforeFarShot);
  });

  it('leech range weapon cannot fire at targets beyond range before first shot', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LeechGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('LeechGun', {
            PrimaryDamage: 30,
            AttackRange: 100,
            DelayBetweenShots: 100,
            LeechRangeWeapon: true,
          }),
        ],
      },
      // Place target beyond AttackRange from the start (distance = 200 > 100)
      mapObjects: [place('Attacker', 10, 10), place('Target', 210, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Verify leech range is NOT active yet
    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, { leechRangeActive: boolean }> };
    const attackerEntity = logic.spawnedEntities.get(1)!;
    expect(attackerEntity.leechRangeActive).toBe(false);

    // Try to attack — target is out of range and leech not active
    agent.attack(1, 2);
    agent.step(15);

    // Source parity: without leech range active, range check applies normally.
    // Target should not take damage because it's beyond AttackRange and the unit
    // hasn't fired its first shot yet (leechRangeActive is false).
    // Note: the unit may try to move toward the target, but since we're testing
    // a non-moving VEHICLE at distance 200, it won't reach in 15 frames.
    const target = agent.entity(2)!;
    expect(target.health).toBe(2000);
  });

  it('leech range is activated during pre-attack phase (preFireWeapon)', () => {
    // Source parity: Weapon.cpp:2708 — preFireWeapon activates leech range
    // at pre-attack start, not just after the shot fires.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LeechDelayGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('LeechDelayGun', {
            PrimaryDamage: 30,
            AttackRange: 100,
            DelayBetweenShots: 100,
            PreAttackDelay: 300,   // 9 frames — enough to observe pre-attack activation
            LeechRangeWeapon: true,
          }),
        ],
      },
      // Place target within range
      mapObjects: [place('Attacker', 10, 10), place('Target', 90, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const logic = agent.gameLogic as unknown as { spawnedEntities: Map<number, { leechRangeActive: boolean }> };
    const attackerEntity = logic.spawnedEntities.get(1)!;

    expect(attackerEntity.leechRangeActive).toBe(false);

    agent.attack(1, 2);

    // Step just enough to enter pre-attack phase but before shot fires (~3 frames in)
    agent.step(3);

    // Source parity: leech range should activate at pre-attack start (preFireWeapon),
    // even before the actual shot fires.
    expect(attackerEntity.leechRangeActive).toBe(true);

    // Target should NOT have taken damage yet (still in pre-attack delay)
    const target = agent.entity(2)!;
    expect(target.health).toBe(2000);
  });
});
