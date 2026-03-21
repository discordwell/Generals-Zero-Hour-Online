/**
 * Parity tests for missile lock distance detonation and newly spawned unit shroud status.
 *
 * Test 1: Missile Lock Distance Detonation
 *   C++ MissileAIUpdate.cpp:79 — m_lockDistance defaults to 75.0f.
 *   C++ MissileAIUpdate.cpp:530-553 — when distanceToTarget < lockDistance^2 (squared comparison),
 *   the missile switches to KILL state and detonates. Non-tracking missiles use lockDistance * 0.5.
 *   TS: index.ts updateMissileAIEvents() implements the same logic at line 25979-26000:
 *   lockDistance from profile.distanceToTargetForLock, halved for non-tracking, compared to 2D distance.
 *
 * Test 2: Newly Spawned Unit Starts in Correct Shroud State
 *   C++ — newly spawned units are SHROUDED from all other players' perspectives until the
 *   fog-of-war update loop runs and clears cells within their vision radius.
 *   TS: fog-of-war.ts FogOfWarGrid — all cells start at CELL_SHROUDED (lookerCount=0, everSeen=0).
 *   updateFogOfWar() in index.ts iterates spawnedEntities and calls updateEntityVision, which
 *   adds lookers for the entity's side. Until that loop runs, positions default to SHROUDED.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import { CELL_CLEAR, CELL_SHROUDED } from './fog-of-war.js';
import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeLocomotorDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  place,
} from './parity-agent.js';

// ── Test 1: Missile Lock Distance Detonation ────────────────────────────────

describe('Parity: missile lock distance detonation (MissileAIUpdate.cpp:530-553)', () => {
  /**
   * C++ MissileAIUpdate.cpp:530-553:
   *
   *   if (d->m_lockDistance > 0) {
   *     Real lockDistanceSquared = d->m_lockDistance;
   *     ...
   *     if (!m_isTrackingTarget) {
   *       lockDistanceSquared *= 0.5f;  // halve for non-tracking
   *     }
   *     lockDistanceSquared *= lockDistanceSquared;
   *     if (distanceToTargetSquared < lockDistanceSquared) {
   *       switchToState(KILL);
   *       return;
   *     }
   *   }
   *
   * TS index.ts:25979-26000 implements the same logic using 2D distance (not squared):
   *   let lockDistance = profile.distanceToTargetForLock;
   *   if (lockDistance > 0 && !state.trackingTarget) { lockDistance *= 0.5; }
   *   if (lockDistance > 0 && distanceToTarget2D <= lockDistance && state.state !== 'KILL') {
   *     state.state = 'KILL';
   *   }
   */

  it('tracking missile detonates when within lockDistance of target (not at exact position)', () => {
    // Missile with DistanceToTargetForLock=30, speed=15 units/frame.
    // Target is 40 units away. The missile should reach within ~30 units of
    // the target and detonate, applying damage. The detonation happens
    // at proximity, not at the exact target position.
    //
    // Parameters match the proven pattern from parity-tunnel-missile.test.ts:
    // speed=15, lockDistance=30 (>= speed), distance=40 units.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LockMissile'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
          makeObjectDef('LockProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'MissileAIUpdate ModuleTag_AI', {
              TryToFollowTarget: 'Yes',
              FuelLifetime: 10000,
              IgnitionDelay: 0,
              InitialVelocity: 15,
              DistanceToTravelBeforeTurning: 0,
              DistanceToTargetForLock: 30,
              DetonateOnNoFuel: 'Yes',
            }),
            makeBlock('LocomotorSet', 'SET_NORMAL MissileLoco', {}),
          ]),
        ],
        weapons: [
          makeWeaponDef('LockMissile', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 2000,
            ProjectileObject: 'LockProjectile',
            WeaponSpeed: 15,
          }),
        ],
        locomotors: [
          makeLocomotorDef('MissileLoco', 15),
        ],
      },
      mapObjects: [place('Launcher', 10, 10), place('Target', 50, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Fire at the target.
    agent.attack(1, 2);

    // Step enough frames for the missile to fly ~40 units at 15 speed per frame.
    // It should reach within lockDistance=30 of the target and detonate.
    agent.step(30);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();

    // Verify damage was applied — the missile detonated at proximity, not at exact position.
    // C++ parity: lockDistance=30 means the missile detonates when within 30 units (2D) of target.
    expect(targetAfter!.health).toBeLessThan(500);

    // Verify the damage matches the weapon's PrimaryDamage (no armor defined).
    const damageDealt = 500 - targetAfter!.health;
    expect(damageDealt).toBeGreaterThanOrEqual(100);
  });

  it('non-tracking missile uses halved lockDistance (lockDistance * 0.5)', () => {
    // C++ MissileAIUpdate.cpp:541-542: non-tracking missiles halve the lock distance.
    // TS index.ts:25981-25982: same halving for !state.trackingTarget.
    //
    // With DistanceToTargetForLock=40 and TryToFollowTarget=No:
    // effective lock distance = 40 * 0.5 = 20 units.
    // The missile should still detonate (target is stationary, missile aims at original pos).
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('DumbLockMissile'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
          makeObjectDef('DumbLockProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'MissileAIUpdate ModuleTag_AI', {
              TryToFollowTarget: 'No',
              FuelLifetime: 10000,
              IgnitionDelay: 0,
              InitialVelocity: 15,
              DistanceToTravelBeforeTurning: 0,
              DistanceToTargetForLock: 40,
              DetonateOnNoFuel: 'Yes',
            }),
            makeBlock('LocomotorSet', 'SET_NORMAL MissileLoco', {}),
          ]),
        ],
        weapons: [
          makeWeaponDef('DumbLockMissile', {
            PrimaryDamage: 80,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 1000,
            ProjectileObject: 'DumbLockProjectile',
            WeaponSpeed: 15,
          }),
        ],
        locomotors: [
          makeLocomotorDef('MissileLoco', 15),
        ],
      },
      mapObjects: [place('Launcher', 10, 10), place('Target', 50, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Run enough frames for the missile to reach the halved lock zone.
    // Distance = 40, speed = 15/frame, effective lock = 20.
    // Missile enters lock zone when ~20 units from target, which is at ~20 units of travel.
    agent.step(30);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();

    // The non-tracking missile should still detonate and deal damage.
    // C++ parity: effective lockDistance = 40 * 0.5 = 20, which is >= speed (15).
    expect(targetAfter!.health).toBeLessThan(500);
  });

  it('missile enters KILL state at lock distance and then detonates at target', () => {
    // This test verifies the two-step detonation process:
    // 1. Missile enters KILL state when within lockDistance (2D check).
    // 2. Missile then flies toward target and detonates when within speed distance (3D check).
    //
    // C++ MissileAIUpdate.cpp:550: switchToState(KILL) sets the state but does NOT
    // immediately detonate. The KILL state's update logic then handles final approach.
    // TS index.ts:25991-25998: state.state = 'KILL' is set, and then on subsequent frames,
    // line 26002-26008 checks if distanceToTarget3D <= speed to actually detonate.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('KillStateMissile'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          ]),
          makeObjectDef('KillStateProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'MissileAIUpdate ModuleTag_AI', {
              TryToFollowTarget: 'Yes',
              FuelLifetime: 10000,
              IgnitionDelay: 0,
              InitialVelocity: 10,
              DistanceToTravelBeforeTurning: 0,
              DistanceToTargetForLock: 30,
              DetonateOnNoFuel: 'Yes',
            }),
            makeBlock('LocomotorSet', 'SET_NORMAL MissileLoco', {}),
          ]),
        ],
        weapons: [
          makeWeaponDef('KillStateMissile', {
            PrimaryDamage: 150,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 2000,
            ProjectileObject: 'KillStateProjectile',
            WeaponSpeed: 10,
          }),
        ],
        locomotors: [
          makeLocomotorDef('MissileLoco', 10),
        ],
      },
      mapObjects: [place('Launcher', 10, 10), place('Target', 80, 10)],
      mapSize: 128,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const before = agent.snapshot();
    agent.attack(1, 2);

    // Step frames — missile should travel 70 units at 10/frame.
    // Enters lock zone at ~40 units (30 from target). Then detonates.
    agent.step(30);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();

    // Damage should have been applied from the missile detonation.
    expect(targetAfter!.health).toBeLessThan(300);

    // The diff should show damage on the target.
    const d = agent.diff(before);
    expect(d.damaged.length).toBeGreaterThan(0);
    expect(d.damaged.some((e) => e.id === 2)).toBe(true);
  });
});

// ── Test 2: Newly Spawned Unit Starts in Correct Shroud State ───────────────

describe('Parity: newly spawned unit starts in correct shroud state', () => {
  /**
   * C++ — all fog-of-war cells start as SHROUDED (ObjectShroudStatus::SHROUDED).
   * When a unit is created, it is shrouded from the perspective of all players
   * who do not have vision in that area. The fog-of-war update loop
   * (PartitionManager::doShroudReveal) runs during the frame update and
   * clears cells within each unit's shroud-clearing radius for the owning player.
   *
   * TS: FogOfWarGrid initializes all cells to lookerCount=0 and everSeen=0
   * (CELL_SHROUDED). updateFogOfWar() calls updateEntityVision for each entity,
   * which calls addLooker on the grid for the entity's player index.
   *
   * Key insight: Before the first frame update, all positions are SHROUDED for
   * all players. After one frame, positions near a player's units become CLEAR
   * for that player but remain SHROUDED for other players without units nearby.
   */

  it('unit position is SHROUDED for opponent before fog-of-war update runs', () => {
    // Create player 1's unit at (30,30). Before any frame update,
    // the position should be SHROUDED for both players because
    // updateFogOfWar has not yet run.
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { VisionRange: 100 }),
      ],
    });

    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Before any update frame, the unit's position is SHROUDED for the opponent.
    // The fog-of-war grid exists but no lookers have been added yet.
    expect(logic.getCellVisibility('China', 30, 30)).toBe(CELL_SHROUDED);

    // Even the owning side hasn't had its vision applied yet.
    // (getCellVisibility for an unregistered side returns SHROUDED.)
    expect(logic.getCellVisibility('America', 30, 30)).toBe(CELL_SHROUDED);
  });

  it('after fog-of-war update, owning player sees CLEAR but opponent sees SHROUDED', () => {
    // Create player 1's unit with vision range.
    // After one frame, player 1 should see the area as CLEAR.
    // Player 2 (no units) should still see everything as SHROUDED.
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const bundle = makeBundle({
      objects: [
        makeObjectDef('Scout', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 100 }),
      ],
    });

    logic.loadMapObjects(
      makeMap([makeMapObject('Scout', 30, 30)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run one frame to trigger fog-of-war update.
    logic.update(1 / 30);

    // Player 1 (America) should see the area around their scout as CLEAR.
    expect(logic.getCellVisibility('America', 30, 30)).toBe(CELL_CLEAR);

    // Player 2 (China) has no units — the scout's position remains SHROUDED.
    expect(logic.getCellVisibility('China', 30, 30)).toBe(CELL_SHROUDED);

    // A distant position remains SHROUDED even for the owning player.
    expect(logic.getCellVisibility('America', 1200, 1200)).toBe(CELL_SHROUDED);
  });

  it('two-player setup: each player sees own units as CLEAR, opponent units as SHROUDED', () => {
    // Place units for both players far apart. Each player should see
    // their own unit's area as CLEAR and the opponent's area as SHROUDED.
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const bundle = makeBundle({
      objects: [
        makeObjectDef('AmericanScout', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 50 }),
        makeObjectDef('ChineseScout', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 50 }),
      ],
    });

    logic.loadMapObjects(
      makeMap([
        makeMapObject('AmericanScout', 20, 20),
        makeMapObject('ChineseScout', 200, 200),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');

    // Run frames to apply fog-of-war.
    logic.update(1 / 30);

    // America sees their own scout's area as CLEAR.
    expect(logic.getCellVisibility('America', 20, 20)).toBe(CELL_CLEAR);
    // America cannot see China's scout — it is SHROUDED.
    expect(logic.getCellVisibility('America', 200, 200)).toBe(CELL_SHROUDED);

    // China sees their own scout's area as CLEAR.
    expect(logic.getCellVisibility('China', 200, 200)).toBe(CELL_CLEAR);
    // China cannot see America's scout — it is SHROUDED.
    expect(logic.getCellVisibility('China', 20, 20)).toBe(CELL_SHROUDED);
  });

  it('unit with zero VisionRange does not clear shroud', () => {
    // A unit with VisionRange=0 should not reveal any fog of war cells.
    // C++ parity: Object::getShroudClearingRange returns 0 when ShroudClearingRange
    // defaults to VisionRange and VisionRange is 0.
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const bundle = makeBundle({
      objects: [
        makeObjectDef('BlindUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { VisionRange: 0 }),
      ],
    });

    logic.loadMapObjects(
      makeMap([makeMapObject('BlindUnit', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Run several frames.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // The unit's position should remain SHROUDED for its own side
    // because it has no vision range to clear the fog.
    expect(logic.getCellVisibility('America', 30, 30)).toBe(CELL_SHROUDED);
  });
});
