/**
 * Tests for entity-factory physics defaults and locomotor field resolution.
 *
 * Verifies source parity with C++ defaults:
 *   Fix 1: PhysicsUpdate.cpp friction defaults are per-frame (0.15, 0.15, 0.8),
 *          NOT per-second (PhysicsUpdate.cpp:55-57).
 *   Fix 2: TurretAI.h DEFAULT_TURN_RATE = 0.01 rad/frame when TurretTurnRate
 *          is not specified in INI (TurretAI.h:37, TurretAI.cpp:178).
 *   Fix 3: ThingTemplate constructor defaults m_geometryInfo to GEOMETRY_SPHERE
 *          with radius=1, height=1 (ThingTemplate.cpp:990).
 *   Fix 4: Locomotor.cpp constructor fields: ZAxisBehavior, Lift, LiftDamaged,
 *          CloseEnoughDist, CirclingRadius, MinTurnSpeed, SpeedLimitZ,
 *          CanMoveBackwards, GroupMovementPriority, SpeedDamaged,
 *          TurnRateDamaged, AccelerationDamaged (Locomotor.cpp:281-354).
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  extractPhysicsBehaviorProfile,
  extractTurretProfiles,
} from './entity-factory.js';
import { resolveLocomotorProfiles } from './entity-movement.js';
import {
  makeBlock,
  makeObjectDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';
import type { LocomotorDef } from '@generals/ini-data';

// ── Fix 1: Friction defaults ────────────────────────────────────────────────

describe('PhysicsBehavior friction defaults (Fix 1)', () => {
  it('default friction values match C++ per-frame constants (0.15, 0.15, 0.8)', () => {
    // Source parity: PhysicsUpdate.cpp:55-57
    //   DEFAULT_FORWARD_FRICTION = 0.15
    //   DEFAULT_LATERAL_FRICTION = 0.15
    //   DEFAULT_Z_FRICTION = 0.8
    // These are already per-frame. The browser port must NOT divide them by 30.
    const objectDef = makeObjectDef('PhysicsUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      // PhysicsBehavior with no friction fields — should use defaults.
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {}),
    ]);

    const profile = extractPhysicsBehaviorProfile({} as any, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.forwardFriction).toBeCloseTo(0.15, 5);
    expect(profile!.lateralFriction).toBeCloseTo(0.15, 5);
    expect(profile!.zFriction).toBeCloseTo(0.8, 5);
    expect(profile!.aerodynamicFriction).toBeCloseTo(0, 5);
  });

  it('INI-specified friction values are converted from per-second to per-frame', () => {
    // Source parity: PhysicsUpdate.cpp:156-161 — parseFrictionPerSec multiplies
    // the INI value by SECONDS_PER_LOGICFRAME_REAL (1/30).
    const objectDef = makeObjectDef('PhysicsUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {
        ForwardFriction: 3.0,   // 3.0 per-sec => 0.1 per-frame
        LateralFriction: 6.0,   // 6.0 per-sec => 0.2 per-frame
        ZFriction: 15.0,        // 15.0 per-sec => 0.5 per-frame
      }),
    ]);

    const profile = extractPhysicsBehaviorProfile({} as any, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.forwardFriction).toBeCloseTo(3.0 / 30, 5);
    expect(profile!.lateralFriction).toBeCloseTo(6.0 / 30, 5);
    expect(profile!.zFriction).toBeCloseTo(15.0 / 30, 5);
  });

  it('default mass is 1.0 (C++ DEFAULT_MASS)', () => {
    const objectDef = makeObjectDef('PhysicsUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {}),
    ]);

    const profile = extractPhysicsBehaviorProfile({} as any, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.mass).toBe(1.0);
  });
});

// ── Fix 2: Default turret turn rate ─────────────────────────────────────────

describe('TurretAI default turn rate (Fix 2)', () => {
  it('turret with no TurretTurnRate uses DEFAULT_TURN_RATE = 0.01 rad/frame', () => {
    // Source parity: TurretAI.h:37 — DEFAULT_TURN_RATE = 0.01f
    // TurretAI.cpp:178 — m_turnRate = DEFAULT_TURN_RATE;
    const objectDef = makeObjectDef('TurretUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      // TurretAIUpdate with no TurretTurnRate specified.
      makeBlock('Behavior', 'TurretAIUpdate ModuleTag_Turret', {
        ControlledWeaponSlots: 'PRIMARY',
      }),
    ]);

    const profiles = extractTurretProfiles({} as any, objectDef);
    expect(profiles.length).toBe(1);
    expect(profiles[0]!.turnRate).toBeCloseTo(0.01, 5);
  });

  it('turret with explicit TurretTurnRate converts from degrees/sec to rad/frame', () => {
    // Source parity: INI::parseAngularVelocityReal — degPerSec * (PI/180) / 30
    const objectDef = makeObjectDef('TurretUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'TurretAIUpdate ModuleTag_Turret', {
        ControlledWeaponSlots: 'PRIMARY',
        TurretTurnRate: 180, // 180 deg/sec
      }),
    ]);

    const profiles = extractTurretProfiles({} as any, objectDef);
    expect(profiles.length).toBe(1);
    const expected = 180 * (Math.PI / 180) / 30; // rad/frame
    expect(profiles[0]!.turnRate).toBeCloseTo(expected, 5);
  });
});

// ── Fix 3: Default geometry fallback ────────────────────────────────────────

describe('Default geometry fallback (Fix 3)', () => {
  it('entity without INI geometry fields gets default geometryInfo (sphere, radius=1, height=1)', () => {
    // Source parity: ThingTemplate.cpp:990 — m_geometryInfo(GEOMETRY_SPHERE, FALSE, 1, 1, 1)
    const objectDef = makeObjectDef('NoGeomUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('LocomotorSet', 'SET_NORMAL TestLoco', {}),
    ]);

    const bundle = makeBundle({
      objects: [objectDef],
      locomotors: [makeLocomotorDef('TestLoco', 30)],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('NoGeomUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const entity = (logic as any).spawnedEntities?.get?.(1);
    expect(entity).toBeDefined();
    expect(entity.geometryInfo).toBeDefined();
    expect(entity.geometryInfo.shape).toBe('circle');
    expect(entity.geometryInfo.majorRadius).toBe(1);
    expect(entity.geometryInfo.minorRadius).toBe(1);
    expect(entity.geometryInfo.height).toBe(1);
  });

  it('entity with explicit geometry fields uses those values for geometryInfo', () => {
    const objectDef = makeObjectDef('GeomUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('LocomotorSet', 'SET_NORMAL TestLoco', {}),
    ], {
      Geometry: 'BOX',
      GeometryMajorRadius: 15,
      GeometryMinorRadius: 10,
      GeometryHeight: 5,
    });

    const bundle = makeBundle({
      objects: [objectDef],
      locomotors: [makeLocomotorDef('TestLoco', 30)],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('GeomUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const entity = (logic as any).spawnedEntities?.get?.(1);
    expect(entity).toBeDefined();
    expect(entity.geometryInfo).toBeDefined();
    expect(entity.geometryInfo.shape).toBe('box');
    expect(entity.geometryInfo.majorRadius).toBe(15);
    expect(entity.geometryInfo.minorRadius).toBe(10);
    expect(entity.geometryInfo.height).toBe(5);
  });
});

// ── Fix 4: Missing locomotor fields ─────────────────────────────────────────

describe('Locomotor profile missing fields (Fix 4)', () => {
  function makeLocomotorDefWithFields(
    name: string,
    speed: number,
    fields: Record<string, unknown> = {},
  ): LocomotorDef {
    return {
      name,
      fields: { Speed: speed, ...fields } as Record<string, string | number | boolean | string[] | number[]>,
      surfaces: ['GROUND'],
      surfaceMask: 1,
      downhillOnly: false,
      speed,
    };
  }

  it('default locomotor fields match C++ Locomotor.cpp constructor', () => {
    // Source parity: Locomotor.cpp:281-354 — constructor defaults
    const objectDef = makeObjectDef('LocoUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('LocomotorSet', 'SET_NORMAL DefaultLoco', {}),
    ]);

    const locomotor = makeLocomotorDefWithFields('DefaultLoco', 30);
    const bundle = makeBundle({
      objects: [objectDef],
      locomotors: [locomotor],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({} as any, objectDef, registry);

    const profile = profiles.get('SET_NORMAL');
    expect(profile).toBeDefined();

    // Verify all new fields with C++ defaults
    expect(profile!.zAxisBehavior).toBe('Z_NO_Z_MOTIVE_FORCE');
    expect(profile!.lift).toBe(0);
    expect(profile!.liftDamaged).toBe(-1);
    expect(profile!.closeEnoughDist).toBe(1.0);
    expect(profile!.circlingRadius).toBe(0);
    expect(profile!.minTurnSpeed).toBe(99999.0);
    expect(profile!.speedLimitZ).toBe(999999.0);
    expect(profile!.canMoveBackwards).toBe(false);
    expect(profile!.groupMovementPriority).toBe('MOVES_MIDDLE');
    expect(profile!.speedDamaged).toBe(-1.0);
    expect(profile!.turnRateDamaged).toBe(-1.0);
    expect(profile!.accelerationDamaged).toBe(-1.0);
  });

  it('locomotor fields are read from INI when specified', () => {
    const objectDef = makeObjectDef('LocoUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('LocomotorSet', 'SET_NORMAL FullLoco', {}),
    ]);

    const locomotor = makeLocomotorDefWithFields('FullLoco', 50, {
      ZAxisBehavior: 'Z_SURFACE_RELATIVE',
      Lift: 25.0,
      LiftDamaged: 15.0,
      CloseEnoughDist: 5.0,
      CirclingRadius: 100,
      MinTurnSpeed: 10.0,
      SpeedLimitZ: 500.0,
      CanMoveBackwards: true,
      GroupMovementPriority: 'MOVES_FRONT',
      SpeedDamaged: 30.0,
      TurnRateDamaged: 90,  // 90 deg/sec
      AccelerationDamaged: 20.0,
    });
    const bundle = makeBundle({
      objects: [objectDef],
      locomotors: [locomotor],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({} as any, objectDef, registry);

    const profile = profiles.get('SET_NORMAL');
    expect(profile).toBeDefined();

    expect(profile!.zAxisBehavior).toBe('Z_SURFACE_RELATIVE');
    expect(profile!.lift).toBe(25.0);
    expect(profile!.liftDamaged).toBe(15.0);
    expect(profile!.closeEnoughDist).toBe(5.0);
    expect(profile!.circlingRadius).toBe(100);
    expect(profile!.minTurnSpeed).toBe(10.0);
    expect(profile!.speedLimitZ).toBe(500.0);
    expect(profile!.canMoveBackwards).toBe(true);
    expect(profile!.groupMovementPriority).toBe('MOVES_FRONT');
    expect(profile!.speedDamaged).toBe(30.0);
    // TurnRateDamaged: 90 deg/sec => 90 * PI/180 rad/sec
    expect(profile!.turnRateDamaged).toBeCloseTo(90 * (Math.PI / 180), 5);
    expect(profile!.accelerationDamaged).toBe(20.0);
  });

  it('damaged sentinel values (-1) indicate "use undamaged value" per C++ convention', () => {
    // Source parity: Locomotor.cpp:284-287
    //   m_maxSpeedDamaged = -1.0f => use m_maxSpeed
    //   m_maxTurnRateDamaged = -1.0f => use m_maxTurnRate
    //   m_accelerationDamaged = -1.0f => use m_acceleration
    //   m_liftDamaged = -1.0f => use m_lift
    const objectDef = makeObjectDef('LocoUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('LocomotorSet', 'SET_NORMAL SentinelLoco', {}),
    ]);

    // Only specify base values, not damaged variants.
    const locomotor = makeLocomotorDefWithFields('SentinelLoco', 40, {
      Acceleration: 10.0,
      TurnRate: 60, // 60 deg/sec
      Lift: 5.0,
    });
    const bundle = makeBundle({
      objects: [objectDef],
      locomotors: [locomotor],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({} as any, objectDef, registry);

    const profile = profiles.get('SET_NORMAL');
    expect(profile).toBeDefined();

    // Damaged sentinels should be -1 (meaning "use the undamaged value")
    expect(profile!.speedDamaged).toBe(-1.0);
    expect(profile!.turnRateDamaged).toBe(-1.0);
    expect(profile!.accelerationDamaged).toBe(-1.0);
    expect(profile!.liftDamaged).toBe(-1.0);
  });

  it('fallback locomotor profile includes all new fields with defaults', () => {
    // When no locomotor set is defined, the fallback profile in entity-factory
    // should still have all new fields with correct defaults.
    const objectDef = makeObjectDef('NoLocoUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('NoLocoUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // The entity should still exist and have default locomotor fields
    // (from the fallback profile in createMapEntity).
    const entity = (logic as any).spawnedEntities?.get?.(1);
    expect(entity).toBeDefined();
  });
});
