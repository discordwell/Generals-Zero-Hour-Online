/**
 * Parity Tests — Locomotor profile fields (36 new gameplay + visual/suspension fields).
 *
 * Verifies that resolveLocomotorProfiles correctly reads all locomotor INI fields
 * with C++ source-parity defaults (Locomotor.cpp constructor, lines 281-357).
 *
 * Source references:
 *   Locomotor.cpp:281-357  — LocomotorTemplate constructor (defaults)
 *   Locomotor.cpp:441-512  — LocomotorTemplate::getFieldParse() (INI field names)
 *   Locomotor.cpp:943-949  — transferLocomotorPhysicsToPhysicsBehavior
 */

import { describe, expect, it } from 'vitest';
import { resolveLocomotorProfiles } from './entity-movement.js';
import {
  makeBlock,
  makeObjectDef,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
} from './test-helpers.js';

function makeLocoObjectDef(locomotorName: string) {
  return makeObjectDef(
    'TestUnit',
    'America',
    ['CAN_ATTACK', 'SELECTABLE'],
    [makeBlock('LocomotorSet', 'SET_NORMAL ' + locomotorName, {})],
  );
}

describe('locomotor profile field defaults (Locomotor.cpp constructor parity)', () => {
  it('produces correct C++ defaults when no INI fields are overridden', () => {
    const loco = makeLocomotorDef('DefaultLoco', 30);
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('DefaultLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const objectDef = bundle.objects[0]!;
    const profiles = resolveLocomotorProfiles({}, objectDef, registry);
    const profile = profiles.get('SET_NORMAL');
    expect(profile).toBeDefined();

    // Gameplay defaults
    expect(profile!.stickToGround).toBe(false);
    expect(profile!.allowAirborneMotiveForce).toBe(false);
    expect(profile!.locomotorWorksWhenDead).toBe(false);
    expect(profile!.apply2DFrictionWhenAirborne).toBe(false);
    expect(profile!.airborneTargetingHeight).toBe(2147483647); // INT_MAX
    expect(profile!.extra2DFriction).toBe(0);
    expect(profile!.slideIntoPlaceTime).toBe(0);
    expect(profile!.closeEnoughDist3D).toBe(false);

    // Visual/suspension defaults
    expect(profile!.pitchStiffness).toBeCloseTo(0.1, 5);
    expect(profile!.rollStiffness).toBeCloseTo(0.1, 5);
    expect(profile!.pitchDamping).toBeCloseTo(0.9, 5);
    expect(profile!.rollDamping).toBeCloseTo(0.9, 5);
    expect(profile!.forwardVelCoef).toBe(0);
    expect(profile!.lateralVelCoef).toBe(0);
    expect(profile!.pitchByZVelCoef).toBe(0);
    expect(profile!.forwardAccelCoef).toBe(0);
    expect(profile!.lateralAccelCoef).toBe(0);
    expect(profile!.uniformAxialDamping).toBeCloseTo(1.0, 5);
    expect(profile!.turnPivotOffset).toBe(0);
    expect(profile!.thrustRoll).toBe(0);
    expect(profile!.wobbleRate).toBe(0);
    expect(profile!.minWobble).toBe(0);
    expect(profile!.maxWobble).toBe(0);
    expect(profile!.accelPitchLimit).toBe(0);
    expect(profile!.decelPitchLimit).toBe(0);
    expect(profile!.bounceKick).toBe(0);
    expect(profile!.hasSuspension).toBe(false);
    expect(profile!.wheelTurnAngle).toBe(0);
    expect(profile!.maximumWheelExtension).toBe(0);
    expect(profile!.maximumWheelCompression).toBe(0);
    expect(profile!.wanderWidthFactor).toBe(0);
    expect(profile!.wanderLengthFactor).toBeCloseTo(1.0, 5);
    expect(profile!.rudderCorrectionDegree).toBe(0);
    expect(profile!.rudderCorrectionRate).toBe(0);
    expect(profile!.elevatorCorrectionDegree).toBe(0);
    expect(profile!.elevatorCorrectionRate).toBe(0);
  });
});

describe('locomotor profile gameplay fields read from INI', () => {
  it('reads StickToGround from INI', () => {
    const loco = makeLocomotorDef('GroundLoco', 30, { StickToGround: true });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('GroundLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.stickToGround).toBe(true);
  });

  it('reads AllowAirborneMotiveForce from INI', () => {
    const loco = makeLocomotorDef('AirLoco', 50, { AllowAirborneMotiveForce: true });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('AirLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.allowAirborneMotiveForce).toBe(true);
  });

  it('reads LocomotorWorksWhenDead from INI', () => {
    const loco = makeLocomotorDef('DeadLoco', 20, { LocomotorWorksWhenDead: true });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('DeadLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.locomotorWorksWhenDead).toBe(true);
  });

  it('reads Apply2DFrictionWhenAirborne from INI', () => {
    const loco = makeLocomotorDef('FricLoco', 40, { Apply2DFrictionWhenAirborne: true });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('FricLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.apply2DFrictionWhenAirborne).toBe(true);
  });

  it('reads AirborneTargetingHeight from INI', () => {
    const loco = makeLocomotorDef('HeightLoco', 60, { AirborneTargetingHeight: 500 });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('HeightLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.airborneTargetingHeight).toBe(500);
  });

  it('reads Extra2DFriction from INI', () => {
    const loco = makeLocomotorDef('ExtraFricLoco', 30, { Extra2DFriction: 0.5 });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('ExtraFricLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.extra2DFriction).toBeCloseTo(0.5, 5);
  });

  it('reads SlideIntoPlaceTime from INI', () => {
    const loco = makeLocomotorDef('SlideLoco', 30, { SlideIntoPlaceTime: 100 });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('SlideLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.slideIntoPlaceTime).toBe(100);
  });

  it('reads CloseEnoughDist3D from INI', () => {
    const loco = makeLocomotorDef('Dist3DLoco', 30, { CloseEnoughDist3D: true });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('Dist3DLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    expect(profiles.get('SET_NORMAL')!.closeEnoughDist3D).toBe(true);
  });
});

describe('locomotor profile visual/suspension fields read from INI', () => {
  it('reads pitch/roll stiffness and damping', () => {
    const loco = makeLocomotorDef('SuspLoco', 30, {
      PitchStiffness: 0.5,
      RollStiffness: 0.3,
      PitchDamping: 0.7,
      RollDamping: 0.6,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('SuspLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.pitchStiffness).toBeCloseTo(0.5, 5);
    expect(p.rollStiffness).toBeCloseTo(0.3, 5);
    expect(p.pitchDamping).toBeCloseTo(0.7, 5);
    expect(p.rollDamping).toBeCloseTo(0.6, 5);
  });

  it('reads velocity and acceleration coefficients', () => {
    const loco = makeLocomotorDef('CoefLoco', 30, {
      ForwardVelocityPitchFactor: 0.15,
      LateralVelocityRollFactor: 0.25,
      PitchInDirectionOfZVelFactor: 0.05,
      ForwardAccelerationPitchFactor: 0.1,
      LateralAccelerationRollFactor: 0.2,
      UniformAxialDamping: 0.8,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('CoefLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.forwardVelCoef).toBeCloseTo(0.15, 5);
    expect(p.lateralVelCoef).toBeCloseTo(0.25, 5);
    expect(p.pitchByZVelCoef).toBeCloseTo(0.05, 5);
    expect(p.forwardAccelCoef).toBeCloseTo(0.1, 5);
    expect(p.lateralAccelCoef).toBeCloseTo(0.2, 5);
    expect(p.uniformAxialDamping).toBeCloseTo(0.8, 5);
  });

  it('reads thrust and wobble fields', () => {
    const loco = makeLocomotorDef('ThrustLoco', 30, {
      TurnPivotOffset: 5.0,
      ThrustRoll: 0.3,
      ThrustWobbleRate: 1.5,
      ThrustMinWobble: 0.1,
      ThrustMaxWobble: 0.8,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('ThrustLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.turnPivotOffset).toBeCloseTo(5.0, 5);
    expect(p.thrustRoll).toBeCloseTo(0.3, 5);
    expect(p.wobbleRate).toBeCloseTo(1.5, 5);
    expect(p.minWobble).toBeCloseTo(0.1, 5);
    expect(p.maxWobble).toBeCloseTo(0.8, 5);
  });

  it('reads angle fields with degrees-to-radians conversion', () => {
    // C++ uses parseAngleReal for AccelerationPitchLimit, DecelerationPitchLimit, FrontWheelTurnAngle
    // and parseAngularVelocityReal for BounceAmount — all degrees→radians in INI.
    const loco = makeLocomotorDef('AngleLoco', 30, {
      AccelerationPitchLimit: 45,  // 45 degrees
      DecelerationPitchLimit: 30,  // 30 degrees
      BounceAmount: 90,            // 90 degrees/sec
      FrontWheelTurnAngle: 60,     // 60 degrees
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('AngleLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.accelPitchLimit).toBeCloseTo(Math.PI / 4, 5);     // 45 deg
    expect(p.decelPitchLimit).toBeCloseTo(Math.PI / 6, 5);     // 30 deg
    expect(p.bounceKick).toBeCloseTo(Math.PI / 2, 5);          // 90 deg/sec
    expect(p.wheelTurnAngle).toBeCloseTo(Math.PI / 3, 5);      // 60 deg
  });

  it('reads suspension boolean and extension fields', () => {
    const loco = makeLocomotorDef('WheelLoco', 30, {
      HasSuspension: true,
      MaximumWheelExtension: 2.5,
      MaximumWheelCompression: 1.5,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('WheelLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.hasSuspension).toBe(true);
    expect(p.maximumWheelExtension).toBeCloseTo(2.5, 5);
    expect(p.maximumWheelCompression).toBeCloseTo(1.5, 5);
  });

  it('reads wander factor fields', () => {
    const loco = makeLocomotorDef('WanderLoco', 30, {
      WanderWidthFactor: 0.4,
      WanderLengthFactor: 0.6,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('WanderLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.wanderWidthFactor).toBeCloseTo(0.4, 5);
    expect(p.wanderLengthFactor).toBeCloseTo(0.6, 5);
  });

  it('reads rudder and elevator correction fields', () => {
    const loco = makeLocomotorDef('FlightLoco', 30, {
      RudderCorrectionDegree: 10.0,
      RudderCorrectionRate: 0.05,
      ElevatorCorrectionDegree: 15.0,
      ElevatorCorrectionRate: 0.08,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('FlightLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;
    expect(p.rudderCorrectionDegree).toBeCloseTo(10.0, 5);
    expect(p.rudderCorrectionRate).toBeCloseTo(0.05, 5);
    expect(p.elevatorCorrectionDegree).toBeCloseTo(15.0, 5);
    expect(p.elevatorCorrectionRate).toBeCloseTo(0.08, 5);
  });
});

describe('locomotor profile combined scenario', () => {
  it('reads all 36 fields together from a fully-specified locomotor', () => {
    const loco = makeLocomotorDef('FullLoco', 100, {
      StickToGround: true,
      AllowAirborneMotiveForce: true,
      LocomotorWorksWhenDead: true,
      Apply2DFrictionWhenAirborne: true,
      AirborneTargetingHeight: 300,
      Extra2DFriction: 0.75,
      SlideIntoPlaceTime: 200,
      CloseEnoughDist3D: true,
      PitchStiffness: 0.5,
      RollStiffness: 0.4,
      PitchDamping: 0.8,
      RollDamping: 0.7,
      ForwardVelocityPitchFactor: 0.12,
      LateralVelocityRollFactor: 0.18,
      PitchInDirectionOfZVelFactor: 0.03,
      ForwardAccelerationPitchFactor: 0.06,
      LateralAccelerationRollFactor: 0.09,
      UniformAxialDamping: 0.95,
      TurnPivotOffset: 3.0,
      ThrustRoll: 0.2,
      ThrustWobbleRate: 2.0,
      ThrustMinWobble: 0.05,
      ThrustMaxWobble: 0.5,
      AccelerationPitchLimit: 15,
      DecelerationPitchLimit: 10,
      BounceAmount: 45,
      HasSuspension: true,
      FrontWheelTurnAngle: 30,
      MaximumWheelExtension: 4.0,
      MaximumWheelCompression: 2.0,
      WanderWidthFactor: 0.3,
      WanderLengthFactor: 0.8,
      RudderCorrectionDegree: 5.0,
      RudderCorrectionRate: 0.02,
      ElevatorCorrectionDegree: 8.0,
      ElevatorCorrectionRate: 0.04,
    });
    const bundle = makeBundle({
      objects: [makeLocoObjectDef('FullLoco')],
      locomotors: [loco],
    });
    const registry = makeRegistry(bundle);
    const profiles = resolveLocomotorProfiles({}, bundle.objects[0]!, registry);
    const p = profiles.get('SET_NORMAL')!;

    // Gameplay fields
    expect(p.stickToGround).toBe(true);
    expect(p.allowAirborneMotiveForce).toBe(true);
    expect(p.locomotorWorksWhenDead).toBe(true);
    expect(p.apply2DFrictionWhenAirborne).toBe(true);
    expect(p.airborneTargetingHeight).toBe(300);
    expect(p.extra2DFriction).toBeCloseTo(0.75, 5);
    expect(p.slideIntoPlaceTime).toBe(200);
    expect(p.closeEnoughDist3D).toBe(true);

    // Visual/suspension fields
    expect(p.pitchStiffness).toBeCloseTo(0.5, 5);
    expect(p.rollStiffness).toBeCloseTo(0.4, 5);
    expect(p.pitchDamping).toBeCloseTo(0.8, 5);
    expect(p.rollDamping).toBeCloseTo(0.7, 5);
    expect(p.forwardVelCoef).toBeCloseTo(0.12, 5);
    expect(p.lateralVelCoef).toBeCloseTo(0.18, 5);
    expect(p.pitchByZVelCoef).toBeCloseTo(0.03, 5);
    expect(p.forwardAccelCoef).toBeCloseTo(0.06, 5);
    expect(p.lateralAccelCoef).toBeCloseTo(0.09, 5);
    expect(p.uniformAxialDamping).toBeCloseTo(0.95, 5);
    expect(p.turnPivotOffset).toBeCloseTo(3.0, 5);
    expect(p.thrustRoll).toBeCloseTo(0.2, 5);
    expect(p.wobbleRate).toBeCloseTo(2.0, 5);
    expect(p.minWobble).toBeCloseTo(0.05, 5);
    expect(p.maxWobble).toBeCloseTo(0.5, 5);
    // Angle fields: degrees→radians
    expect(p.accelPitchLimit).toBeCloseTo(15 * Math.PI / 180, 5);
    expect(p.decelPitchLimit).toBeCloseTo(10 * Math.PI / 180, 5);
    expect(p.bounceKick).toBeCloseTo(45 * Math.PI / 180, 5);
    expect(p.hasSuspension).toBe(true);
    expect(p.wheelTurnAngle).toBeCloseTo(30 * Math.PI / 180, 5);
    expect(p.maximumWheelExtension).toBeCloseTo(4.0, 5);
    expect(p.maximumWheelCompression).toBeCloseTo(2.0, 5);
    expect(p.wanderWidthFactor).toBeCloseTo(0.3, 5);
    expect(p.wanderLengthFactor).toBeCloseTo(0.8, 5);
    expect(p.rudderCorrectionDegree).toBeCloseTo(5.0, 5);
    expect(p.rudderCorrectionRate).toBeCloseTo(0.02, 5);
    expect(p.elevatorCorrectionDegree).toBeCloseTo(8.0, 5);
    expect(p.elevatorCorrectionRate).toBeCloseTo(0.04, 5);
  });
});
