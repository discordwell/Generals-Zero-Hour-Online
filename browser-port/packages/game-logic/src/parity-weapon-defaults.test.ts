/**
 * Parity tests for 5 weapon profile default value mismatches between C++ and browser port.
 *
 * 1. WeaponSpeed/MinWeaponSpeed — INI values must be divided by LOGICFRAMES_PER_SECOND (30)
 * 2. AllowAttackGarrisonedBldgs — C++ default is FALSE (Weapon.cpp line 322)
 * 3. AutoReloadsClip — C++ default is AUTO_RELOAD (true) (Weapon.cpp line 298)
 * 4. MinTargetPitch/MaxTargetPitch — C++ default is -PI/+PI (Weapon.cpp lines 279-280)
 * 5. AcceptableAimDelta — C++ default is 0.0 radians (Weapon.cpp line 267)
 *
 * Source parity: GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Weapon.cpp lines 255-330
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

// ---------------------------------------------------------------------------
// Helper: create a minimal agent with one unit carrying the given weapon
// ---------------------------------------------------------------------------
function createAgentWithWeapon(weaponFields: Record<string, unknown>) {
  return createParityAgent({
    bundles: {
      objects: [
        makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeWeaponBlock('TestWeapon'),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestWeapon', {
          PrimaryDamage: 10,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 150,
          DelayBetweenShots: 200,
          ...weaponFields,
        }),
      ],
    },
    sides: { America: {} },
    mapObjects: [place('TestUnit', 10, 10)],
  });
}

function getWeaponProfile(agent: ReturnType<typeof createAgentWithWeapon>) {
  const entity = agent.gameLogic.spawnedEntities.values().next().value;
  expect(entity).toBeDefined();
  expect(entity.attackWeapon).toBeDefined();
  return entity.attackWeapon;
}

// ---------------------------------------------------------------------------
// 1. WeaponSpeed/MinWeaponSpeed unit conversion (INI dist/sec -> dist/frame)
// ---------------------------------------------------------------------------
describe('WeaponSpeed/MinWeaponSpeed unit conversion (÷30)', () => {
  it('converts explicit WeaponSpeed from dist/sec to dist/frame', () => {
    const agent = createAgentWithWeapon({ WeaponSpeed: 300 });
    const weapon = getWeaponProfile(agent);
    // 300 dist/sec ÷ 30 frames/sec = 10 dist/frame
    expect(weapon.weaponSpeed).toBeCloseTo(10, 6);
  });

  it('converts explicit MinWeaponSpeed from dist/sec to dist/frame', () => {
    const agent = createAgentWithWeapon({ MinWeaponSpeed: 600 });
    const weapon = getWeaponProfile(agent);
    // 600 dist/sec ÷ 30 = 20 dist/frame
    expect(weapon.minWeaponSpeed).toBeCloseTo(20, 6);
  });

  it('defaults WeaponSpeed to 999999 (effectively instant) when not specified', () => {
    const agent = createAgentWithWeapon({});
    const weapon = getWeaponProfile(agent);
    expect(weapon.weaponSpeed).toBe(999999);
  });

  it('defaults MinWeaponSpeed to 999999 (effectively instant) when not specified', () => {
    const agent = createAgentWithWeapon({});
    const weapon = getWeaponProfile(agent);
    expect(weapon.minWeaponSpeed).toBe(999999);
  });

  it('both speeds are converted together', () => {
    const agent = createAgentWithWeapon({ WeaponSpeed: 900, MinWeaponSpeed: 300 });
    const weapon = getWeaponProfile(agent);
    expect(weapon.weaponSpeed).toBeCloseTo(30, 6);
    expect(weapon.minWeaponSpeed).toBeCloseTo(10, 6);
  });
});

// ---------------------------------------------------------------------------
// 2. AllowAttackGarrisonedBldgs default (C++ = FALSE)
// ---------------------------------------------------------------------------
describe('AllowAttackGarrisonedBldgs default', () => {
  it('defaults to false (C++ parity: Weapon.cpp line 322)', () => {
    const agent = createAgentWithWeapon({});
    const weapon = getWeaponProfile(agent);
    expect(weapon.allowAttackGarrisonedBldgs).toBe(false);
  });

  it('respects explicit AllowAttackGarrisonedBldgs = Yes', () => {
    const agent = createAgentWithWeapon({ AllowAttackGarrisonedBldgs: 'Yes' });
    const weapon = getWeaponProfile(agent);
    expect(weapon.allowAttackGarrisonedBldgs).toBe(true);
  });

  it('respects explicit AllowAttackGarrisonedBldgs = No', () => {
    const agent = createAgentWithWeapon({ AllowAttackGarrisonedBldgs: 'No' });
    const weapon = getWeaponProfile(agent);
    expect(weapon.allowAttackGarrisonedBldgs).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. AutoReloadsClip default (C++ = AUTO_RELOAD = true)
// ---------------------------------------------------------------------------
describe('AutoReloadsClip default and parsing', () => {
  it('defaults to true (C++ parity: m_reloadType = AUTO_RELOAD, Weapon.cpp line 298)', () => {
    const agent = createAgentWithWeapon({});
    const weapon = getWeaponProfile(agent);
    expect(weapon.autoReloadsClip).toBe(true);
  });

  it('parses AutoReloadsClip = NO as false', () => {
    const agent = createAgentWithWeapon({ AutoReloadsClip: 'NO' });
    const weapon = getWeaponProfile(agent);
    expect(weapon.autoReloadsClip).toBe(false);
  });

  it('parses AutoReloadsClip = YES as true', () => {
    const agent = createAgentWithWeapon({ AutoReloadsClip: 'YES' });
    const weapon = getWeaponProfile(agent);
    expect(weapon.autoReloadsClip).toBe(true);
  });

  it('parses AutoReloadsClip = RETURN_TO_BASE as false (not AUTO_RELOAD)', () => {
    const agent = createAgentWithWeapon({ AutoReloadsClip: 'RETURN_TO_BASE' });
    const weapon = getWeaponProfile(agent);
    expect(weapon.autoReloadsClip).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. MinTargetPitch/MaxTargetPitch default (C++ = -PI/+PI = ±180°)
// ---------------------------------------------------------------------------
describe('MinTargetPitch/MaxTargetPitch defaults', () => {
  it('defaults to ±PI (full sphere, C++ parity: Weapon.cpp lines 279-280)', () => {
    const agent = createAgentWithWeapon({});
    const weapon = getWeaponProfile(agent);
    expect(weapon.minTargetPitch).toBeCloseTo(-Math.PI, 6);
    expect(weapon.maxTargetPitch).toBeCloseTo(Math.PI, 6);
  });

  it('parses explicit pitch limits in degrees and converts to radians', () => {
    const agent = createAgentWithWeapon({ MinTargetPitch: -45, MaxTargetPitch: 60 });
    const weapon = getWeaponProfile(agent);
    expect(weapon.minTargetPitch).toBeCloseTo(-45 * Math.PI / 180, 6);
    expect(weapon.maxTargetPitch).toBeCloseTo(60 * Math.PI / 180, 6);
  });
});

// ---------------------------------------------------------------------------
// 5. AcceptableAimDelta default (C++ = 0.0 radians)
// ---------------------------------------------------------------------------
describe('AcceptableAimDelta default', () => {
  it('defaults to 0.0 radians (C++ parity: Weapon.cpp line 267)', () => {
    const agent = createAgentWithWeapon({});
    const weapon = getWeaponProfile(agent);
    expect(weapon.acceptableAimDelta).toBe(0);
  });

  it('parses explicit value in degrees and converts to radians', () => {
    const agent = createAgentWithWeapon({ AcceptableAimDelta: 15 });
    const weapon = getWeaponProfile(agent);
    expect(weapon.acceptableAimDelta).toBeCloseTo(15 * Math.PI / 180, 6);
  });
});
