/**
 * Parity tests for LifetimeUpdate destruction and PhysicsBehavior velocity/friction.
 *
 * Source references:
 *   LifetimeUpdate.cpp:47-98 — objects die after random frames between MinLifetime and MaxLifetime.
 *     Constructor calls calcSleepDelay(min, max) which picks GameLogicRandomValue(min, max),
 *     clamps to >= 1, stores dieFrame = currentFrame + delay. update() calls object->kill().
 *
 *   PhysicsUpdate.cpp:188-200 — per-frame velocity, friction per axis, gravity application.
 *     updatePhysicsBehavior applies gravity (GRAVITY = -1.0), ground/aero friction,
 *     integrates velocity into position, and handles bounce on ground collision.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ── Test 1: LifetimeUpdate — Object Self-Destructs After Random Frame Count ──

describe('LifetimeUpdate — timed self-destruction', () => {
  /**
   * Create a setup with a single entity that has LifetimeUpdate behavior.
   * MinLifetime and MaxLifetime are specified in milliseconds in INI.
   * At 30fps, 1000ms = 30 frames, 2000ms = 60 frames.
   */
  function makeLifetimeSetup() {
    const objectDef = makeObjectDef('TemporaryUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'LifetimeUpdate ModuleTag_Lifetime', {
        MinLifetime: 1000, // 1000ms = 30 frames
        MaxLifetime: 2000, // 2000ms = 60 frames
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TemporaryUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Initial tick so entity gets fully created.
    logic.update(0);

    return { logic };
  }

  it('entity is still alive after 20 frames (well before MinLifetime of 30 frames)', () => {
    // Source parity: LifetimeUpdate.cpp:83-88 — calcSleepDelay picks random
    // delay in [minFrames, maxFrames] and sets dieFrame = currentFrame + delay.
    // With MinLifetime=1000ms (30 frames), the entity cannot die before frame 30.
    const { logic } = makeLifetimeSetup();

    // Step 20 frames — entity should still be alive since the minimum lifetime
    // is 30 frames.
    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
    }

    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.alive).toBe(true);
    expect(state!.health).toBeGreaterThan(0);
  });

  it('entity is destroyed after 100 frames (well past MaxLifetime of 60 frames)', () => {
    // Source parity: LifetimeUpdate.cpp:93-97 — update() calls object->kill()
    // which applies UNRESISTABLE damage at maxHealth amount, triggering normal
    // death pipeline.
    const { logic } = makeLifetimeSetup();

    // Step 100 frames — entity must be destroyed since MaxLifetime is 60 frames.
    for (let i = 0; i < 100; i++) {
      logic.update(1 / 30);
    }

    const state = logic.getEntityState(1);
    // Entity should either be fully removed from the world (null) or marked dead.
    if (state !== null) {
      expect(state.alive).toBe(false);
    }
    // If getEntityState returns null, the entity was destroyed and cleaned up.
  });

  it('entity dies at a frame within the [MinLifetime, MaxLifetime] range', () => {
    // Source parity: LifetimeUpdate.cpp:85 — delay = GameLogicRandomValue(min, max).
    // We verify the death frame falls within the valid range [30, 60] frames
    // (plus the initial creation frame offset).
    const { logic } = makeLifetimeSetup();

    // Read the lifetimeDieFrame directly to verify it was set correctly.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        lifetimeDieFrame: number | null;
        destroyed: boolean;
      }>;
      frameCounter: number;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity).toBeDefined();
    expect(entity.lifetimeDieFrame).not.toBeNull();

    // The creation frame is 0 or 1 (depends on when the entity was spawned).
    // The die frame should be creation_frame + delay where delay is in [30, 60].
    // Since we called logic.update(0) once, frameCounter is at 1.
    const dieFrame = entity.lifetimeDieFrame!;
    // The die frame should be >= 30 (minFrames) and <= 61 (maxFrames + 1 for
    // the creation frame offset).
    expect(dieFrame).toBeGreaterThanOrEqual(30);
    expect(dieFrame).toBeLessThanOrEqual(62);

    // Now step frame by frame until entity dies or we exceed max.
    let deathFrame: number | null = null;
    for (let i = 0; i < 100; i++) {
      logic.update(1 / 30);
      if (entity.destroyed) {
        deathFrame = priv.frameCounter;
        break;
      }
    }

    expect(deathFrame).not.toBeNull();
    // The entity should have died at or after its lifetimeDieFrame.
    expect(deathFrame!).toBeGreaterThanOrEqual(dieFrame);
    // And no later than a few frames after (update runs once per frame).
    expect(deathFrame!).toBeLessThanOrEqual(dieFrame + 2);
  });
});

// ── Test 2: PhysicsBehavior — Friction and Gravity ──────────────────────────

describe('PhysicsBehavior — gravity, friction, and bouncing', () => {
  /**
   * Create an entity with PhysicsBehavior for rigid body physics testing.
   * AllowBouncing is enabled so we can test ground bounce behavior.
   */
  function makePhysicsSetup(overrides: Record<string, unknown> = {}) {
    // Note: ForwardFriction INI values are multiplied by SECONDS_PER_FRAME (1/30)
    // during parsing (extractPhysicsBehaviorProfile), so a value of 10.0 in INI
    // becomes 10/30 = 0.333 per-frame friction coefficient — strong enough to
    // visibly damp velocity within a handful of frames.
    const objectDef = makeObjectDef('Projectile', 'America', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {
        Mass: 1.0,
        ForwardFriction: 10.0,
        LateralFriction: 10.0,
        ZFriction: 10.0,
        AerodynamicFriction: 0.05,
        AllowBouncing: 'Yes',
        KillWhenRestingOnGround: 'No',
        ...overrides,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Projectile', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Initial tick.
    logic.update(0);

    return { logic };
  }

  it('gravity pulls entity downward when launched upward (y position rises then falls)', () => {
    // Source parity: PhysicsUpdate.cpp — updatePhysicsBehavior applies
    // GRAVITY = -1.0 per frame to accelY, then integrates into velocity.
    const { logic } = makePhysicsSetup();

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number;
        y: number;
        z: number;
        physicsBehaviorProfile: any;
        physicsBehaviorState: {
          velX: number; velY: number; velZ: number;
          accelX: number; accelY: number; accelZ: number;
          stickToGround: boolean; allowToFall: boolean;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity).toBeDefined();
    expect(entity.physicsBehaviorProfile).not.toBeNull();

    // Force-initialize the physics state and set an upward velocity.
    // Source parity: PhysicsBehavior lazy-inits state on first physics frame.
    logic.update(1 / 30); // Initialize physics state.

    const st = entity.physicsBehaviorState!;
    expect(st).not.toBeNull();

    // Set upward velocity and allow falling.
    st.velY = 10.0;
    st.stickToGround = false;
    st.allowToFall = true;

    const initialY = entity.y;

    // Step a few frames — entity should rise.
    logic.update(1 / 30);
    const yAfterRise = entity.y;
    expect(yAfterRise).toBeGreaterThan(initialY);

    // Track y positions to detect the arc (rises then falls).
    const yPositions: number[] = [yAfterRise];
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
      yPositions.push(entity.y);
    }

    // The entity should have reached a peak and started falling.
    // Find the maximum y position — it should not be the last position
    // (gravity should have pulled it back down).
    const maxY = Math.max(...yPositions);
    const maxYIndex = yPositions.indexOf(maxY);
    expect(maxYIndex).toBeGreaterThan(0); // Peak is not at the start.
    expect(maxYIndex).toBeLessThan(yPositions.length - 1); // Peak is not at the end.
  });

  it('friction dampens lateral velocity over time', () => {
    // Source parity: PhysicsUpdate.cpp — ground friction applies
    // mass * friction * velocity as a force, then applyForce() divides by mass.
    const { logic } = makePhysicsSetup();

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; y: number; z: number;
        physicsBehaviorState: {
          velX: number; velY: number; velZ: number;
          stickToGround: boolean; allowToFall: boolean;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Initialize physics state.
    logic.update(1 / 30);
    const st = entity.physicsBehaviorState!;

    // Set lateral velocity, keep on ground.
    st.velX = 5.0;
    st.velZ = 3.0;
    st.velY = 0;
    st.stickToGround = true;
    st.allowToFall = false;

    const initialSpeed = Math.hypot(st.velX, st.velZ);

    // Step several frames.
    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
    }

    const finalSpeed = Math.hypot(st.velX, st.velZ);

    // Source parity: friction decelerates the entity. Speed should decrease.
    expect(finalSpeed).toBeLessThan(initialSpeed);
    // After 20 frames of friction, speed should be significantly reduced.
    expect(finalSpeed).toBeLessThan(initialSpeed * 0.5);
  });

  it('high-mass hulk physics remains finite while bouncing to rest', () => {
    const { logic } = makePhysicsSetup({
      Mass: 100.0,
      KillWhenRestingOnGround: 'Yes',
      AllowBouncing: 'Yes',
    });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; y: number; z: number;
        baseHeight: number;
        destroyed: boolean;
        physicsBehaviorState: {
          velX: number; velY: number; velZ: number;
          accelX: number; accelY: number; accelZ: number;
          stickToGround: boolean; allowToFall: boolean;
        } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    logic.update(1 / 30);
    const st = entity.physicsBehaviorState!;
    entity.baseHeight = 0;
    entity.y = 40;
    st.velX = 0;
    st.velY = 0.5;
    st.velZ = 0;
    st.accelX = 0;
    st.accelY = 0;
    st.accelZ = 0;
    st.stickToGround = false;
    st.allowToFall = true;

    for (let i = 0; i < 300 && !entity.destroyed; i++) {
      logic.update(1 / 30);
      expect(Number.isFinite(entity.x)).toBe(true);
      expect(Number.isFinite(entity.y)).toBe(true);
      expect(Number.isFinite(entity.z)).toBe(true);
      expect(Number.isFinite(st.velY)).toBe(true);
    }

    expect(entity.destroyed).toBe(true);
  });

  it('entity bounces when hitting ground with AllowBouncing enabled', () => {
    // Source parity: PhysicsUpdate.cpp — handleBounce() reflects vertical
    // velocity with stiffness damping: velY = abs(velY) * stiffness.
    // GROUND_STIFFNESS = 0.5 by default.
    const { logic } = makePhysicsSetup({ AllowBouncing: 'Yes' });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; y: number; z: number;
        physicsBehaviorState: {
          velX: number; velY: number; velZ: number;
          stickToGround: boolean; allowToFall: boolean;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Initialize physics state.
    logic.update(1 / 30);
    const st = entity.physicsBehaviorState!;

    // Launch entity upward so it will fall and bounce.
    st.velY = 8.0;
    st.stickToGround = false;
    st.allowToFall = true;

    // Step until the entity falls back to ground level and bounces.
    // Track whether we see a positive velY after a negative velY (bounce).
    let sawNegativeVelY = false;
    let sawBounce = false;

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
      if (st.velY < -0.5) {
        sawNegativeVelY = true;
      }
      if (sawNegativeVelY && st.velY > 0.1) {
        sawBounce = true;
        break;
      }
    }

    // Source parity: with AllowBouncing, the entity should bounce off the ground.
    expect(sawBounce).toBe(true);
  });

  it('KillWhenRestingOnGround destroys entity once velocity reaches rest threshold', () => {
    // Source parity: PhysicsUpdate.cpp — killWhenRestingOnGround checks
    // abs(vel) < REST_THRESH (0.01) on all axes when on ground, then
    // calls markEntityDestroyed.
    const { logic } = makePhysicsSetup({
      KillWhenRestingOnGround: 'Yes',
      AllowBouncing: 'Yes',
    });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; y: number; z: number;
        baseHeight: number;
        canMove: boolean;
        destroyed: boolean;
        physicsBehaviorState: {
          velX: number; velY: number; velZ: number;
          stickToGround: boolean; allowToFall: boolean;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Initialize physics state.
    logic.update(1 / 30);
    const st = entity.physicsBehaviorState!;

    // Zero out baseHeight so that resolveGroundHeight + baseHeight = terrain height.
    // Without this, updateEntityVerticalPosition in updateEntityMovement snaps the
    // entity up to groundY + baseHeight after each physics frame, creating a
    // feedback loop where the entity never reaches REST_THRESH.
    entity.baseHeight = 0;
    entity.y = 0;

    // Give a small upward velocity so it bounces a few times and comes to rest.
    // No lateral velocity — keeps the test deterministic.
    st.velY = 3.0;
    st.velX = 0;
    st.velZ = 0;
    st.stickToGround = false;
    st.allowToFall = true;

    // Step many frames — entity should eventually come to rest and be destroyed.
    let destroyed = false;
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (entity.destroyed) {
        destroyed = true;
        break;
      }
    }

    expect(destroyed).toBe(true);
  });
});
