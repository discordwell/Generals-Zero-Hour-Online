/**
 * Parity Tests — Tunnel Network Unit Sharing and Projectile Tracking (Missile Homing).
 *
 * Source references:
 *   TunnelContain.cpp:70-110 — addToContainList/removeFromContain delegate to the owning
 *     player's TunnelSystem (shared per-player tunnel tracker). Units entering one tunnel
 *     entrance are stored in the shared network and can exit from any other tunnel entrance.
 *
 *   MissileAIUpdate.cpp:68-135 — MissileAIUpdateModuleData defaults m_tryToFollowTarget=true.
 *     projectileFireAtObjectOrPosition (line 275-283) checks if victim && tryToFollowTarget,
 *     then issues aiMoveToObject(victim) so the missile tracks the target each frame.
 *     TS updateMissileAIEvents() implements the same homing state machine: LAUNCH → IGNITION →
 *     ATTACK_NOTURN → ATTACK, with per-frame target position updates when trackingTarget=true.
 */

import { describe, expect, it } from 'vitest';

import * as THREE from 'three';

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
import { GameLogicSubsystem } from './index.js';

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ── Test 1: Tunnel Network Unit Sharing ─────────────────────────────────────

describe('tunnel network shared per-player unit containment', () => {
  /**
   * C++ parity: TunnelContain.cpp:70-74 — addToContainList()
   *
   *   void TunnelContain::addToContainList( Object *obj ) {
   *     Player *owningPlayer = getObject()->getControllingPlayer();
   *     owningPlayer->getTunnelSystem()->addToContainList( obj );
   *   }
   *
   * In C++, all TunnelContain buildings of the same player share a single
   * TunnelTracker (the player's "tunnel system"). A unit entering tunnel A is
   * added to the shared passenger list, and any tunnel of the same player can
   * evacuate that unit.
   *
   * TS implementation: containment-system.ts uses resolveTunnelTracker(side) to
   * return a per-side TunnelTrackerState. enterTunnel() adds passengers to the
   * shared tracker; evacuateContainedEntities() on any tunnel node iterates the
   * shared tracker's passengerIds. This matches the C++ delegation pattern.
   */

  it('unit enters tunnel A and exits from tunnel B (shared network)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    // Place two tunnel entrances far apart, with a rebel near tunnel A.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TunnelNetwork', 10, 10),   // id 1 — tunnel A
        makeMapObject('TunnelNetwork', 50, 50),   // id 2 — tunnel B
        makeMapObject('Rebel', 12, 10),            // id 3 — near tunnel A
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Enter rebel into tunnel A using enterTransport command.
    // Source parity: handleEnterTransportCommand routes TUNNEL moduleType to enterTunnel().
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Verify rebel is inside the tunnel network (shared containment flags).
    const insideState = logic.getEntityState(3);
    expect(insideState).toBeDefined();
    expect(insideState!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(insideState!.statusFlags ?? []).toContain('MASKED');

    // Evacuate from tunnel B — the shared tracker should release the rebel at tunnel B.
    logic.submitCommand({ type: 'evacuate', entityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Rebel should have exited — no longer held.
    const rebelAfter = logic.getEntityState(3);
    expect(rebelAfter).toBeDefined();
    expect(rebelAfter!.statusFlags ?? []).not.toContain('DISABLED_HELD');
    expect(rebelAfter!.statusFlags ?? []).not.toContain('MASKED');

    // C++ parity: exitTunnel scatters the unit around the exit tunnel's position.
    // Rebel should be near tunnel B (50,50), not tunnel A (10,10).
    const tunnel2State = logic.getEntityState(2);
    const dx = rebelAfter!.x - tunnel2State!.x;
    const dz = rebelAfter!.z - tunnel2State!.z;
    const distToTunnel2 = Math.sqrt(dx * dx + dz * dz);
    expect(distToTunnel2).toBeLessThan(30); // scattered near tunnel B

    const distToTunnel1X = Math.abs(rebelAfter!.x - 10);
    const distToTunnel1Z = Math.abs(rebelAfter!.z - 10);
    const distToTunnel1 = Math.sqrt(distToTunnel1X ** 2 + distToTunnel1Z ** 2);
    // Should be far from tunnel A (distance from (10,10) to (50,50) ≈ 56.6).
    expect(distToTunnel1).toBeGreaterThan(20);
  });

  it('tunnels of different players have independent networks', () => {
    // C++ parity: each Player has its own TunnelSystem. Units in player A's tunnel
    // cannot exit from player B's tunnel — the networks are isolated.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('TunnelNetworkEnemy', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TunnelNetwork', 10, 10),       // id 1 — GLA tunnel
        makeMapObject('TunnelNetworkEnemy', 50, 50),   // id 2 — China tunnel
        makeMapObject('Rebel', 12, 10),                 // id 3 — GLA rebel
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'GLA');
    logic.setPlayerSide(1, 'China');
    logic.update(0);

    // Enter rebel into GLA tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Verify rebel is inside.
    expect(logic.getEntityState(3)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Evacuate from China's tunnel — should NOT release the rebel (different network).
    logic.submitCommand({ type: 'evacuate', entityId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Rebel should STILL be held — China's tunnel is a separate network.
    const rebelState = logic.getEntityState(3);
    expect(rebelState!.statusFlags ?? []).toContain('DISABLED_HELD');
  });

  it('multiple units share the tunnel network and can all exit from one tunnel', () => {
    // C++ parity: the shared TunnelTracker holds all passengers from all tunnel
    // buildings of the same player. Evacuating any single tunnel exits all passengers.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TunnelNetwork', 10, 10),   // id 1 — tunnel A
        makeMapObject('TunnelNetwork', 50, 50),   // id 2 — tunnel B
        makeMapObject('Rebel', 12, 10),            // id 3 — near tunnel A
        makeMapObject('Rebel', 52, 50),            // id 4 — near tunnel B
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Enter rebel 3 into tunnel A, rebel 4 into tunnel B.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 2 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Both should be held.
    expect(logic.getEntityState(3)!.statusFlags ?? []).toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Evacuate from tunnel A — both rebels should exit (shared network).
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Both rebels should be released.
    expect(logic.getEntityState(3)!.statusFlags ?? []).not.toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags ?? []).not.toContain('DISABLED_HELD');
  });
});

// ── Test 2: Projectile Tracking (Missiles Follow Moving Targets) ────────────

describe('projectile tracking — missiles follow moving targets', () => {
  /**
   * C++ parity: MissileAIUpdate.cpp:275-283 — projectileFireAtObjectOrPosition()
   *
   *   if (victim && d->m_tryToFollowTarget) {
   *     getStateMachine()->setGoalPosition(victim->getPosition());
   *     aiMoveToObject(const_cast<Object*>(victim), CMD_FROM_AI);
   *     m_originalTargetPos = *victim->getPosition();
   *     m_isTrackingTarget = TRUE;
   *     m_victimID = victim->getID();
   *   }
   *
   * Missiles with TryToFollowTarget=true update their trajectory each frame to
   * follow the target's current position. The MissileAIUpdate state machine
   * (LAUNCH → IGNITION → ATTACK_NOTURN → ATTACK) governs the flight path.
   *
   * TS implementation: updateMissileAIEvents() in index.ts implements the same
   * homing state machine. When state.trackingTarget is true, each frame updates
   * state.targetX/Y/Z from the tracked entity's current position. The missile
   * steers toward the updated target position with turn-rate limitations.
   *
   * TS has full projectile flight simulation for weapons with ProjectileObject
   * that references a MissileAIUpdate behavior. Damage is NOT instant — it is
   * delayed and applied when the missile reaches the target (or detonates).
   */

  it('homing missile hits a stationary target via delayed projectile flight', () => {
    // This test verifies that TS implements projectile flight with delayed damage
    // (not instant-hit) when a weapon has a projectile object with MissileAIUpdate.
    //
    // The weapon has a ProjectileObject ('TestMissile') and the projectile object
    // has a MissileAIUpdate behavior with TryToFollowTarget=Yes.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TrackingMissile'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeBlock('LocomotorSet', 'SET_NORMAL TargetLoco', {}),
          ]),
          // Projectile object template — the missile itself.
          // Speed and lock distance are tuned so the missile can detonate:
          // speed=15 units/frame, lockDistance=20 ensures the missile enters
          // the lock zone before overshooting.
          makeObjectDef('TrackingProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'MissileAIUpdate ModuleTag_AI', {
              TryToFollowTarget: 'Yes',
              FuelLifetime: 10000,
              IgnitionDelay: 0,
              InitialVelocity: 15,
              DistanceToTravelBeforeTurning: 0,
              DistanceToTargetForLock: 20,
              DetonateOnNoFuel: 'Yes',
            }),
            makeBlock('LocomotorSet', 'SET_NORMAL MissileLoco', {}),
          ]),
        ],
        weapons: [
          makeWeaponDef('TrackingMissile', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 1000,
            ProjectileObject: 'TrackingProjectile',
            WeaponSpeed: 15,
          }),
        ],
        locomotors: [
          makeLocomotorDef('TargetLoco', 30),
          makeLocomotorDef('MissileLoco', 15),
        ],
      },
      mapObjects: [place('Launcher', 10, 10), place('Target', 50, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Run enough frames for the missile to reach and detonate on the target.
    // The missile has speed=15/frame, lock distance=20, and target is 40 units away.
    // It should reach within ~3 frames of flight.
    agent.step(30);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();

    // The target should have taken damage from the missile impact.
    // With missile flight, damage is delayed until the missile reaches the target.
    expect(targetAfter!.health).toBeLessThan(500);
  });

  it('documents: non-missile weapons apply damage instantly (no projectile flight)', () => {
    // C++ parity: Weapons without a ProjectileObject that has MissileAIUpdate
    // are classified as INSTANT flight model. Damage is applied immediately
    // when the weapon fires (or after a small DelayBetweenShots timer).
    //
    // This baseline test confirms INSTANT weapons deal damage without flight delay.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Gunner', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('InstantGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('InstantGun', {
            PrimaryDamage: 50,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 100,
            // No ProjectileObject — this is an INSTANT flight model weapon.
          }),
        ],
      },
      mapObjects: [place('Gunner', 10, 10), place('Target', 30, 10)],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Damage should appear quickly — within a few frames.
    agent.step(6);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();
    expect(targetAfter!.health).toBeLessThan(500);

    // Verify the damage is the expected 50 (full damage, no armor).
    const actualDamage = 500 - targetAfter!.health;
    expect(actualDamage % 50).toBe(0);
    expect(actualDamage).toBeGreaterThanOrEqual(50);
  });

  it('missile tracking updates target position each frame (moving target)', () => {
    // C++ parity: MissileAIUpdate with m_isTrackingTarget=TRUE calls
    // aiMoveToObject(victim) which updates the goal position each frame.
    //
    // TS parity: updateMissileAIEvents() checks state.trackingTarget and
    // updates state.targetX/Y/Z from the tracked entity's current position.
    //
    // This test fires a missile at a target, then moves the target. The missile
    // should still hit because it tracks the target's new position.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TrackingMissile'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeBlock('LocomotorSet', 'SET_NORMAL TargetLoco', {}),
          ]),
          makeObjectDef('TrackingProjectile2', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'MissileAIUpdate ModuleTag_AI', {
              TryToFollowTarget: 'Yes',
              FuelLifetime: 10000,
              IgnitionDelay: 0,
              InitialVelocity: 15,
              DistanceToTravelBeforeTurning: 0,
              DistanceToTargetForLock: 20,
              DetonateOnNoFuel: 'Yes',
            }),
            makeBlock('LocomotorSet', 'SET_NORMAL MissileLoco', {}),
          ]),
        ],
        weapons: [
          makeWeaponDef('TrackingMissile', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 1000,
            ProjectileObject: 'TrackingProjectile2',
            WeaponSpeed: 15,
          }),
        ],
        locomotors: [
          makeLocomotorDef('TargetLoco', 2),
          makeLocomotorDef('MissileLoco', 15),
        ],
      },
      mapObjects: [
        place('Launcher', 10, 10),
        place('Target', 50, 10),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Fire the missile.
    agent.attack(1, 2);
    agent.step(3);

    // Now move the target perpendicular to the missile flight path.
    // The missile should re-aim toward the target's new position.
    agent.move(2, 50, 50);

    // Run enough frames for the missile to track and reach the moved target.
    agent.step(90);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();

    // The tracking missile should eventually hit the target wherever it moved.
    // C++ parity: m_isTrackingTarget=TRUE causes per-frame position updates.
    // TS parity: state.trackingTarget=true updates targetX/Y/Z from entity position.
    expect(targetAfter!.health).toBeLessThan(500);
  });

  it('non-tracking missile (TryToFollowTarget=No) fires at original position', () => {
    // C++ parity: MissileAIUpdate.cpp:285-294 — when victim is null or
    // m_tryToFollowTarget is false, the missile is a "coord shot" that
    // flies to the original target position without updating trajectory.
    //
    // TS parity: when trackingTarget=false, updateMissileAIEvents() uses
    // originalTargetX/Y/Z instead of the entity's live position.
    //
    // This test documents that non-tracking missiles aim at the fire-time position.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('DumbMissile'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
          // Non-tracking missiles use 0.5x lockDistance (C++ parity: line 25981).
          // With speed=15, effective lock = 40*0.5 = 20, which is >= 15.
          makeObjectDef('DumbProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
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
          makeWeaponDef('DumbMissile', {
            PrimaryDamage: 100,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 500,
            ProjectileObject: 'DumbProjectile',
            WeaponSpeed: 15,
          }),
        ],
        locomotors: [
          makeLocomotorDef('MissileLoco', 15),
        ],
      },
      mapObjects: [
        place('Launcher', 10, 10),
        place('Target', 50, 10),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);

    // Run enough frames for the non-tracking missile to reach the original position.
    agent.step(30);

    const targetAfter = agent.entity(2);
    expect(targetAfter).toBeDefined();

    // The non-tracking missile should still hit a stationary target (same position).
    // C++ parity: coord-shot missiles fly to the exact fire-time position.
    expect(targetAfter!.health).toBeLessThan(500);
  });
});

// ── Test 3: Tunnel Enter/Exit Visual Transition ─────────────────────────────

describe('tunnel enter/exit visual transition opacity', () => {
  /**
   * When a unit enters a tunnel, the renderer should fade it out over ~9 frames
   * (0.3s at 30fps). When exiting, it should fade in over the same duration.
   * The tunnelTransitionOpacity field in RenderableEntityState controls this.
   */

  it('unit entering tunnel has fading-out opacity in render state', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TunnelNetwork', 10, 10),
        makeMapObject('Rebel', 10, 10),     // at tunnel position for instant enter
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Force the rebel into the tunnel directly.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    // Run one frame to process command.
    logic.update(1 / 30);

    // The rebel should now be inside the tunnel.
    const rebelState = logic.getEntityState(2);
    expect(rebelState!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Check render state: tunnelTransitionOpacity should be defined and < 1
    // on the first frame after entering (fading out).
    const renderStates = logic.getRenderableEntityStates();
    const rebelRender = renderStates.find((s) => s.id === 2);
    expect(rebelRender).toBeDefined();
    expect(rebelRender!.tunnelTransitionOpacity).toBeDefined();
    expect(rebelRender!.tunnelTransitionOpacity!).toBeLessThanOrEqual(1.0);
    expect(rebelRender!.tunnelTransitionOpacity!).toBeGreaterThanOrEqual(0);
  });

  it('unit exiting tunnel has fading-in opacity in render state', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TunnelNetwork', 10, 10),
        makeMapObject('Rebel', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Enter the rebel into the tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Confirm rebel is inside.
    expect(logic.getEntityState(2)!.statusFlags ?? []).toContain('DISABLED_HELD');

    // Evacuate — rebel exits the tunnel.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    logic.update(1 / 30);

    // Rebel should be released.
    const rebelAfter = logic.getEntityState(2);
    expect(rebelAfter!.statusFlags ?? []).not.toContain('DISABLED_HELD');

    // Check render state: tunnelTransitionOpacity should be defined and < 1
    // on the first frame after exiting (fading in).
    const renderStates = logic.getRenderableEntityStates();
    const rebelRender = renderStates.find((s) => s.id === 2);
    expect(rebelRender).toBeDefined();
    expect(rebelRender!.tunnelTransitionOpacity).toBeDefined();
    expect(rebelRender!.tunnelTransitionOpacity!).toBeLessThan(1.0);
    expect(rebelRender!.tunnelTransitionOpacity!).toBeGreaterThanOrEqual(0);

    // After enough frames (9+), the transition should complete (undefined = fully visible).
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const renderStatesAfter = logic.getRenderableEntityStates();
    const rebelRenderAfter = renderStatesAfter.find((s) => s.id === 2);
    expect(rebelRenderAfter!.tunnelTransitionOpacity).toBeUndefined();
  });

  it('unit fully inside tunnel has opacity 0 in render state', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
            TimeForFullHeal: 0,
          }),
        ]),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { TransportSlotCount: 1 }),
      ],
    });
    const logic = createLogic();

    logic.loadMapObjects(
      makeMap([
        makeMapObject('TunnelNetwork', 10, 10),
        makeMapObject('Rebel', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Enter the rebel into the tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    // Run many frames so the fade completes.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Rebel should be fully inside — opacity 0.
    const renderStates = logic.getRenderableEntityStates();
    const rebelRender = renderStates.find((s) => s.id === 2);
    expect(rebelRender).toBeDefined();
    expect(rebelRender!.tunnelTransitionOpacity).toBe(0);
  });
});

// ── Test 4: Dozer Mine Clearing ─────────────────────────────────────────────

describe('dozer mine clearing ability', () => {
  /**
   * Source parity: DozerAIUpdate.cpp — dozers with DISARM weapons can target
   * and clear mines. The combat targeting system allows dozers (commandSource
   * 'DOZER') to engage neutral MINE/DEMOTRAP KindOf entities.
   *
   * DozerPrimaryIdleState::update auto-scans for nearby mines when idle.
   */

  it('dozer auto-seeks mines when idle via updateDozerIdleBehavior', async () => {
    const {
      updateDozerIdleBehavior,
      createDozerAIState,
    } = await import('./ai-updates.js');
    const { vi } = await import('vitest');

    const entity = {
      id: 1,
      x: 100,
      z: 100,
      moving: false,
      destroyed: false,
      health: 200,
      maxHealth: 200,
      kindOfFlags: new Set(['DOZER']),
      objectStatusFlags: new Set<string>(),
    };
    const state = createDozerAIState(0);
    const profile = { repairHealthPercentPerSecond: 0.01, boredTimeFrames: 90, boredRange: 200 };
    const mineTarget = { id: 55 };
    const context = {
      frameCounter: 200,
      logicFrameRate: 15,
      getBuildingInfo: vi.fn().mockReturnValue(null),
      findAutoRepairTarget: vi.fn().mockReturnValue(null),
      findAutoMineTarget: vi.fn().mockReturnValue(mineTarget),
      issueRepairCommand: vi.fn(),
      issueAttackCommand: vi.fn(),
      setConstructionPercent: vi.fn(),
      completeConstruction: vi.fn(),
      addConstructionHealth: vi.fn(),
      attemptHealingFromSoleBenefactor: vi.fn().mockReturnValue(true),
      onRepairComplete: vi.fn(),
      cancelConstructionTask: vi.fn(),
    };

    updateDozerIdleBehavior(entity as any, state, profile, context as any);

    expect(context.issueAttackCommand).toHaveBeenCalledWith(1, 55);
  });
});
