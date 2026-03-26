/**
 * Parity tests for DumbProjectileBehavior magic-number constants.
 *
 * Source reference:
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Behavior/DumbProjectileBehavior.cpp
 *
 * These constants are used by the projectile trajectory solver
 * (pitch convergence loop), lifespan timeout, and bridge-layer
 * detonation fudge.
 */

import { describe, expect, it } from 'vitest';

import {
  LOGIC_FRAME_RATE,
  PROJECTILE_DEFAULT_MAX_LIFESPAN,
  PROJECTILE_SHALLOW_ANGLE,
  PROJECTILE_MIN_ANGLE_DIFF,
  PROJECTILE_CLOSE_ENOUGH_RANGE,
  PROJECTILE_DISTANCE_FUDGE,
  PROJECTILE_DEFAULT_DETONATE_CALLS_KILL,
  PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH,
} from './index.js';

describe('DumbProjectileBehavior constants — C++ source parity', () => {
  it('PROJECTILE_DEFAULT_MAX_LIFESPAN equals 10 * LOGICFRAMES_PER_SECOND (300 frames)', () => {
    // DumbProjectileBehavior.cpp:60
    //   const Int DEFAULT_MAX_LIFESPAN = 10 * LOGICFRAMES_PER_SECOND;
    expect(LOGIC_FRAME_RATE).toBe(30);
    expect(PROJECTILE_DEFAULT_MAX_LIFESPAN).toBe(300);
    expect(PROJECTILE_DEFAULT_MAX_LIFESPAN).toBe(10 * LOGIC_FRAME_RATE);
  });

  it('PROJECTILE_SHALLOW_ANGLE equals 0.5 degrees in radians', () => {
    // DumbProjectileBehavior.cpp:196
    //   const Real SHALLOW_ANGLE = 0.5f * PI / 180.0f;
    const expected = 0.5 * Math.PI / 180;
    expect(PROJECTILE_SHALLOW_ANGLE).toBe(expected);
    // Verify the numeric value is approximately 0.008727 radians
    expect(PROJECTILE_SHALLOW_ANGLE).toBeCloseTo(0.008726646, 6);
  });

  it('PROJECTILE_MIN_ANGLE_DIFF equals 1/16th of a degree in radians', () => {
    // DumbProjectileBehavior.cpp:222
    //   const Real MIN_ANGLE_DIFF = (PI/(180.0f*16.0f));
    const expected = Math.PI / (180 * 16);
    expect(PROJECTILE_MIN_ANGLE_DIFF).toBe(expected);
    // Verify the numeric value is approximately 0.001091 radians
    expect(PROJECTILE_MIN_ANGLE_DIFF).toBeCloseTo(0.001090831, 6);
  });

  it('PROJECTILE_CLOSE_ENOUGH_RANGE equals 5.0 world units', () => {
    // DumbProjectileBehavior.cpp:299
    //   const Real CLOSE_ENOUGH_RANGE = 5.0f;
    expect(PROJECTILE_CLOSE_ENOUGH_RANGE).toBe(5.0);
  });

  it('PROJECTILE_DISTANCE_FUDGE equals 2.0 world units', () => {
    // DumbProjectileBehavior.cpp:687
    //   const Real FUDGE = 2.0f;
    expect(PROJECTILE_DISTANCE_FUDGE).toBe(2.0);
  });

  it('PROJECTILE_DEFAULT_DETONATE_CALLS_KILL defaults to false', () => {
    // DumbProjectileBehavior.cpp:65
    //   m_detonateCallsKill(FALSE),
    expect(PROJECTILE_DEFAULT_DETONATE_CALLS_KILL).toBe(false);
  });

  it('PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH defaults to true', () => {
    // DumbProjectileBehavior.cpp:66
    //   m_orientToFlightPath(TRUE),
    expect(PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH).toBe(true);
  });
});
