/**
 * Parity tests for 4 weapon secondary fields added to browser port.
 *
 * 1. DamageStatusType — object status effect applied to damaged targets
 * 2. FireSoundLoopTime — duration (ms) for looping fire sounds
 * 3. ProjectileStreamName — visual projectile stream effect name
 * 4. Multi-level FireOCL — per-veterancy-level ObjectCreationList on fire
 *
 * Source parity: Weapon.cpp field parse table (lines 167-248), constructor (lines 255-330).
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

// ── Test 1: DamageStatusType ──────────────────────────────────────────────────

describe('Weapon secondary field: DamageStatusType', () => {
  it('parses DamageStatusType from weapon INI (e.g., AFLAME)', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('FlameGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('FlameGun', {
            PrimaryDamage: 10,
            DamageType: 'FLAME',
            AttackRange: 100,
            DelayBetweenShots: 100,
            DamageStatusType: 'AFLAME',
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:185 — DamageStatusType parsed via ObjectStatusMaskType::parseSingleBitFromINI.
    expect(entity.attackWeapon.damageStatusType).toBe('AFLAME');
  });

  it('defaults DamageStatusType to "NONE" when not specified', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('PlainGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('PlainGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:327 — m_damageStatusType = OBJECT_STATUS_NONE.
    expect(entity.attackWeapon.damageStatusType).toBe('NONE');
  });
});

// ── Test 2: FireSoundLoopTime ─────────────────────────────────────────────────

describe('Weapon secondary field: FireSoundLoopTime', () => {
  it('parses FireSoundLoopTime from weapon INI', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('LoopGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('LoopGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
            FireSoundLoopTime: 2000,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:196 — FireSoundLoopTime parsed via parseDurationUnsignedInt.
    expect(entity.attackWeapon.fireSoundLoopTime).toBe(2000);
  });

  it('defaults FireSoundLoopTime to 0 when not specified', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('NoLoopGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('NoLoopGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:308 — m_fireSoundLoopTime = 0.
    expect(entity.attackWeapon.fireSoundLoopTime).toBe(0);
  });
});

// ── Test 3: ProjectileStreamName ──────────────────────────────────────────────

describe('Weapon secondary field: ProjectileStreamName', () => {
  it('parses ProjectileStreamName from weapon INI', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('StreamGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('StreamGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
            ProjectileStreamName: 'ChemicalStream',
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:227 — ProjectileStreamName parsed via parseAsciiString.
    expect(entity.attackWeapon.projectileStreamName).toBe('ChemicalStream');
  });

  it('defaults ProjectileStreamName to null when not specified', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('NoStreamGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('NoStreamGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:312 — m_projectileStreamName.clear().
    expect(entity.attackWeapon.projectileStreamName).toBeNull();
  });
});

// ── Test 4: Multi-level FireOCL ───────────────────────────────────────────────

describe('Weapon secondary field: multi-level FireOCL', () => {
  it('FireOCL sets all 4 veterancy levels to the same OCL name', () => {
    // Source parity: Weapon.cpp:199 — "FireOCL" uses parseAllVetLevelsAsciiString,
    // which stores the same OCL name in m_fireOCLNames[0..3] (REGULAR through HEROIC).
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('OCLGunAll'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('OCLGunAll', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
            FireOCL: 'OCL_MuzzleFlash',
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // All 4 vet levels should have the same OCL name.
    expect(entity.attackWeapon.fireOCLNames).toEqual([
      'OCL_MuzzleFlash',  // REGULAR (index 0)
      'OCL_MuzzleFlash',  // VETERAN (index 1)
      'OCL_MuzzleFlash',  // ELITE (index 2)
      'OCL_MuzzleFlash',  // HEROIC (index 3)
    ]);
    // Backward compat: fireOCLName should still equal the REGULAR level.
    expect(entity.attackWeapon.fireOCLName).toBe('OCL_MuzzleFlash');
  });

  it('VeterancyFireOCL overrides individual vet level slots', () => {
    // Source parity: Weapon.cpp:204 — "VeterancyFireOCL" uses parsePerVetLevelAsciiString.
    // INI format: "VeterancyFireOCL = VETERAN OCL_VetEffect"
    // This overrides individual slots while leaving others unchanged.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('VetOCLGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('VetOCLGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
            FireOCL: 'OCL_RegularEffect',
            VeterancyFireOCL: [
              'VETERAN OCL_VeteranEffect',
              'ELITE OCL_EliteEffect',
              'HEROIC OCL_HeroicEffect',
            ],
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // REGULAR keeps the base FireOCL; VETERAN/ELITE/HEROIC are overridden.
    expect(entity.attackWeapon.fireOCLNames).toEqual([
      'OCL_RegularEffect',   // REGULAR (index 0) — from FireOCL
      'OCL_VeteranEffect',   // VETERAN (index 1) — from VeterancyFireOCL override
      'OCL_EliteEffect',     // ELITE (index 2) — from VeterancyFireOCL override
      'OCL_HeroicEffect',    // HEROIC (index 3) — from VeterancyFireOCL override
    ]);
    // Backward compat: fireOCLName = REGULAR level.
    expect(entity.attackWeapon.fireOCLName).toBe('OCL_RegularEffect');
  });

  it('fireOCLNames defaults to all null when no FireOCL specified', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('NoOCLGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('NoOCLGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp:286 — m_fireOCLNames[i].clear() for all levels.
    expect(entity.attackWeapon.fireOCLNames).toEqual([null, null, null, null]);
    expect(entity.attackWeapon.fireOCLName).toBeNull();
  });

  it('VeterancyFireOCL works without base FireOCL (per-level only)', () => {
    // Source parity: you can use VeterancyFireOCL without a base FireOCL,
    // which only sets the specified level slots.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('VetOnlyOCLGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('VetOnlyOCLGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 100,
            VeterancyFireOCL: ['ELITE OCL_EliteOnly'],
          }),
        ],
      },
      mapObjects: [place('Attacker', 10, 10), place('Target', 30, 10)],
      mapSize: 8,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Only ELITE slot is set; others remain null.
    expect(entity.attackWeapon.fireOCLNames).toEqual([
      null,              // REGULAR
      null,              // VETERAN
      'OCL_EliteOnly',   // ELITE
      null,              // HEROIC
    ]);
    expect(entity.attackWeapon.fireOCLName).toBeNull();
  });
});
