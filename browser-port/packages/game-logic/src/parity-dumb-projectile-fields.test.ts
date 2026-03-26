/**
 * Parity tests for DumbProjectileBehavior FieldParse fields.
 *
 * Validates all 13 DumbProjectileBehaviorModuleData fields from the C++ FieldParse table
 * (DumbProjectileBehavior.cpp:82-103) are correctly parsed from INI and applied to the
 * DumbProjectileBehaviorProfile on MapEntity.
 *
 * C++ source: GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Behavior/DumbProjectileBehavior.cpp
 */

import { describe, expect, it } from 'vitest';

import {
  GameLogicSubsystem,
  LOGIC_FRAME_RATE,
  PROJECTILE_DEFAULT_DETONATE_CALLS_KILL,
  PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH,
  type DumbProjectileBehaviorProfile,
} from './index.js';
import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  place,
} from './parity-agent.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a projectile object definition with DumbProjectileBehavior fields. */
function makeDumbProjectileDef(name: string, dpbFields: Record<string, string | number>) {
  return makeObjectDef(name, 'America', ['PROJECTILE'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
    makeBlock('Behavior', 'DumbProjectileBehavior ModuleTag_DPB', {
      ...dpbFields,
    }),
  ]);
}

/** Boot a minimal agent with a projectile entity placed on the map. */
function bootWithProjectile(dpbFields: Record<string, string | number>) {
  const mapSize = 64;
  const agent = createParityAgent({
    bundles: {
      objects: [
        makeDumbProjectileDef('TestProjectile', dpbFields),
      ],
    },
    mapObjects: [
      place('TestProjectile', mapSize / 2, mapSize / 2),
    ],
    mapSize,
    sides: { America: {} },
  });
  const gl = agent.gameLogic as any;
  const entities = Array.from(gl.spawnedEntities.values()) as any[];
  const projectile = entities.find((e: any) => e.templateName === 'TestProjectile');
  return { agent, gl, projectile };
}

// ── Test 1: Default values ──────────────────────────────────────────────────

describe('DumbProjectileBehaviorProfile defaults (C++ constructor parity)', () => {
  it('uses C++ constructor defaults when no INI fields are specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile).not.toBeNull();

    // m_maxLifespan = 0
    expect(profile.maxLifespan).toBe(0);
    // m_tumbleRandomly = FALSE
    expect(profile.tumbleRandomly).toBe(false);
    // m_detonateCallsKill = FALSE
    expect(profile.detonateCallsKill).toBe(PROJECTILE_DEFAULT_DETONATE_CALLS_KILL);
    expect(profile.detonateCallsKill).toBe(false);
    // m_orientToFlightPath = TRUE
    expect(profile.orientToFlightPath).toBe(PROJECTILE_DEFAULT_ORIENT_TO_FLIGHT_PATH);
    expect(profile.orientToFlightPath).toBe(true);
    // m_firstHeight = 0
    expect(profile.firstHeight).toBe(0);
    // m_secondHeight = 0
    expect(profile.secondHeight).toBe(0);
    // m_firstPercentIndent = 0.30 (30%)
    expect(profile.firstPercentIndent).toBeCloseTo(0.30, 5);
    // m_secondPercentIndent = 0.70 (70%)
    expect(profile.secondPercentIndent).toBeCloseTo(0.70, 5);
    // m_garrisonHitKillCount = 0
    expect(profile.garrisonHitKillCount).toBe(0);
    // m_garrisonHitKillFX = NULL
    expect(profile.garrisonHitKillFX).toBeNull();
    // m_flightPathAdjustDistPerFrame = 0
    expect(profile.flightPathAdjustDistPerFrame).toBe(0);
    // KindOf sets should be empty by default
    expect(profile.garrisonHitKillRequiredKindOf.size).toBe(0);
    expect(profile.garrisonHitKillForbiddenKindOf.size).toBe(0);
  });
});

// ── Test 2: MaxLifespan (parseDurationUnsignedInt) ──────────────────────────

describe('Parity: DumbProjectileBehavior MaxLifespan (DumbProjectileBehavior.cpp:83)', () => {
  it('converts milliseconds to logic frames via parseDurationUnsignedInt', () => {
    // 5000ms = 5s = 150 frames at 30fps
    const { projectile } = bootWithProjectile({ MaxLifespan: 5000 });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.maxLifespan).toBe(150);
  });

  it('defaults to 0 when not specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.maxLifespan).toBe(0);
  });
});

// ── Test 3: TumbleRandomly (bool) ───────────────────────────────────────────

describe('Parity: DumbProjectileBehavior TumbleRandomly (DumbProjectileBehavior.cpp:84)', () => {
  it('parses TumbleRandomly = Yes as true', () => {
    const { projectile } = bootWithProjectile({ TumbleRandomly: 'Yes' });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.tumbleRandomly).toBe(true);
  });

  it('defaults to false when not specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.tumbleRandomly).toBe(false);
  });
});

// ── Test 4: DetonateCallsKill (bool) ────────────────────────────────────────

describe('Parity: DumbProjectileBehavior DetonateCallsKill (DumbProjectileBehavior.cpp:85)', () => {
  it('parses DetonateCallsKill = Yes as true', () => {
    const { projectile } = bootWithProjectile({ DetonateCallsKill: 'Yes' });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.detonateCallsKill).toBe(true);
  });

  it('defaults to FALSE (C++ constructor parity)', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.detonateCallsKill).toBe(false);
  });
});

// ── Test 5: OrientToFlightPath (bool) ───────────────────────────────────────

describe('Parity: DumbProjectileBehavior OrientToFlightPath (DumbProjectileBehavior.cpp:86)', () => {
  it('parses OrientToFlightPath = No as false', () => {
    const { projectile } = bootWithProjectile({ OrientToFlightPath: 'No' });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.orientToFlightPath).toBe(false);
  });

  it('defaults to TRUE (C++ constructor parity)', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.orientToFlightPath).toBe(true);
  });
});

// ── Test 6: Bezier arc fields (FirstHeight, SecondHeight, FirstPercentIndent, SecondPercentIndent) ──

describe('Parity: DumbProjectileBehavior Bezier arc fields (DumbProjectileBehavior.cpp:87-90)', () => {
  it('parses FirstHeight and SecondHeight as numeric values', () => {
    const { projectile } = bootWithProjectile({
      FirstHeight: 80,
      SecondHeight: 60,
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.firstHeight).toBe(80);
    expect(profile.secondHeight).toBe(60);
  });

  it('parses FirstPercentIndent and SecondPercentIndent as 0..1 fractions', () => {
    const { projectile } = bootWithProjectile({
      FirstPercentIndent: 0.33,
      SecondPercentIndent: 0.66,
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.firstPercentIndent).toBeCloseTo(0.33, 5);
    expect(profile.secondPercentIndent).toBeCloseTo(0.66, 5);
  });

  it('defaults FirstPercentIndent to 0.30 and SecondPercentIndent to 0.70', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.firstPercentIndent).toBeCloseTo(0.30, 5);
    expect(profile.secondPercentIndent).toBeCloseTo(0.70, 5);
  });
});

// ── Test 7: GarrisonHitKillRequiredKindOf / ForbiddenKindOf (KindOfMask) ────

describe('Parity: DumbProjectileBehavior GarrisonHitKill KindOf fields (DumbProjectileBehavior.cpp:91-92)', () => {
  it('parses GarrisonHitKillRequiredKindOf as a Set of uppercase strings', () => {
    const { projectile } = bootWithProjectile({
      GarrisonHitKillRequiredKindOf: 'INFANTRY',
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillRequiredKindOf).toEqual(new Set(['INFANTRY']));
  });

  it('parses GarrisonHitKillForbiddenKindOf as a Set of uppercase strings', () => {
    const { projectile } = bootWithProjectile({
      GarrisonHitKillForbiddenKindOf: 'HERO',
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillForbiddenKindOf).toEqual(new Set(['HERO']));
  });

  it('handles multiple space-separated KindOf tokens', () => {
    const { projectile } = bootWithProjectile({
      GarrisonHitKillRequiredKindOf: 'INFANTRY VEHICLE',
      GarrisonHitKillForbiddenKindOf: 'HERO STRUCTURE',
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillRequiredKindOf).toEqual(new Set(['INFANTRY', 'VEHICLE']));
    expect(profile.garrisonHitKillForbiddenKindOf).toEqual(new Set(['HERO', 'STRUCTURE']));
  });

  it('defaults to empty sets when not specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillRequiredKindOf.size).toBe(0);
    expect(profile.garrisonHitKillForbiddenKindOf.size).toBe(0);
  });
});

// ── Test 8: GarrisonHitKillCount (uint) ─────────────────────────────────────

describe('Parity: DumbProjectileBehavior GarrisonHitKillCount (DumbProjectileBehavior.cpp:93)', () => {
  it('parses GarrisonHitKillCount as an unsigned integer', () => {
    const { projectile } = bootWithProjectile({ GarrisonHitKillCount: 3 });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillCount).toBe(3);
  });

  it('defaults to 0 when not specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillCount).toBe(0);
  });

  it('truncates fractional values and clamps to non-negative', () => {
    const { projectile } = bootWithProjectile({ GarrisonHitKillCount: 2.7 });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillCount).toBe(2);
  });
});

// ── Test 9: GarrisonHitKillFX (FXList) ──────────────────────────────────────

describe('Parity: DumbProjectileBehavior GarrisonHitKillFX (DumbProjectileBehavior.cpp:94)', () => {
  it('parses GarrisonHitKillFX as a string', () => {
    const { projectile } = bootWithProjectile({
      GarrisonHitKillFX: 'FX_GarrisonKill',
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillFX).toBe('FX_GarrisonKill');
  });

  it('defaults to null when not specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.garrisonHitKillFX).toBeNull();
  });
});

// ── Test 10: FlightPathAdjustDistPerSecond (parseVelocityReal) ──────────────

describe('Parity: DumbProjectileBehavior FlightPathAdjustDistPerSecond (DumbProjectileBehavior.cpp:95)', () => {
  it('converts velocity from per-second to per-frame by dividing by LOGIC_FRAME_RATE', () => {
    // 60 units/second / 30 fps = 2 units/frame
    const { projectile } = bootWithProjectile({ FlightPathAdjustDistPerSecond: 60 });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.flightPathAdjustDistPerFrame).toBeCloseTo(60 / LOGIC_FRAME_RATE, 5);
    expect(profile.flightPathAdjustDistPerFrame).toBeCloseTo(2.0, 5);
  });

  it('defaults to 0 when not specified', () => {
    const { projectile } = bootWithProjectile({});
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile.flightPathAdjustDistPerFrame).toBe(0);
  });
});

// ── Test 11: No DumbProjectileBehavior module → null profile ────────────────

describe('DumbProjectileBehaviorProfile: null when module absent', () => {
  it('returns null for objects without DumbProjectileBehavior', () => {
    const mapSize = 64;
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('PlainUnit', 'America', ['INFANTRY'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
      },
      mapObjects: [
        place('PlainUnit', mapSize / 2, mapSize / 2),
      ],
      mapSize,
      sides: { America: {} },
    });
    const gl = agent.gameLogic as any;
    const entities = Array.from(gl.spawnedEntities.values()) as any[];
    const unit = entities.find((e: any) => e.templateName === 'PlainUnit');
    expect(unit.dumbProjectileProfile).toBeNull();
  });
});

// ── Test 12: Full field parse — all 13 fields at once ───────────────────────

describe('DumbProjectileBehaviorProfile: all 13 fields parsed together', () => {
  it('correctly parses a fully-specified DumbProjectileBehavior module', () => {
    const { projectile } = bootWithProjectile({
      MaxLifespan: 10000,        // 10s = 300 frames
      TumbleRandomly: 'Yes',
      DetonateCallsKill: 'Yes',
      OrientToFlightPath: 'No',
      FirstHeight: 100,
      SecondHeight: 80,
      FirstPercentIndent: 0.25,
      SecondPercentIndent: 0.75,
      GarrisonHitKillRequiredKindOf: 'INFANTRY',
      GarrisonHitKillForbiddenKindOf: 'HERO',
      GarrisonHitKillCount: 5,
      GarrisonHitKillFX: 'FX_GarrisonHit',
      FlightPathAdjustDistPerSecond: 90,
    });
    const profile = projectile.dumbProjectileProfile as DumbProjectileBehaviorProfile;
    expect(profile).not.toBeNull();

    // Field 1: MaxLifespan (10000ms / 1000 * 30fps = 300 frames)
    expect(profile.maxLifespan).toBe(300);
    // Field 2: TumbleRandomly
    expect(profile.tumbleRandomly).toBe(true);
    // Field 3: DetonateCallsKill
    expect(profile.detonateCallsKill).toBe(true);
    // Field 4: OrientToFlightPath
    expect(profile.orientToFlightPath).toBe(false);
    // Field 5: FirstHeight
    expect(profile.firstHeight).toBe(100);
    // Field 6: SecondHeight
    expect(profile.secondHeight).toBe(80);
    // Field 7: FirstPercentIndent
    expect(profile.firstPercentIndent).toBeCloseTo(0.25, 5);
    // Field 8: SecondPercentIndent
    expect(profile.secondPercentIndent).toBeCloseTo(0.75, 5);
    // Field 9: GarrisonHitKillRequiredKindOf
    expect(profile.garrisonHitKillRequiredKindOf).toEqual(new Set(['INFANTRY']));
    // Field 10: GarrisonHitKillForbiddenKindOf
    expect(profile.garrisonHitKillForbiddenKindOf).toEqual(new Set(['HERO']));
    // Field 11: GarrisonHitKillCount
    expect(profile.garrisonHitKillCount).toBe(5);
    // Field 12: GarrisonHitKillFX
    expect(profile.garrisonHitKillFX).toBe('FX_GarrisonHit');
    // Field 13: FlightPathAdjustDistPerSecond (90 / 30 = 3.0 per frame)
    expect(profile.flightPathAdjustDistPerFrame).toBeCloseTo(3.0, 5);
  });
});
