/**
 * Parity tests for 6 remaining INI field gaps from coverage audit.
 *
 * 1. AcceptableAimDelta — per-weapon turret alignment tolerance
 * 2. MinTargetPitch / MaxTargetPitch — vertical targeting limits
 * 3. RequestAssistRange — nearby allies auto-engage same target
 * 4. ShroudRevealToAllRange — fog reveal for all sides
 * 5. FireOCL — OCL spawned on weapon fire (already handled via entity module)
 * 6. FactoryExitWidth — lateral offset for spawned units
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

describe('INI field gap: AcceptableAimDelta', () => {
  it('parses AcceptableAimDelta from weapon INI and stores in radians', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('TurretUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TurretGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('TurretGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 150,
            DelayBetweenShots: 200,
            AcceptableAimDelta: 5, // 5 degrees
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('TurretUnit', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // 5 degrees in radians ≈ 0.0873
    expect(entity.attackWeapon.acceptableAimDelta).toBeCloseTo(5 * Math.PI / 180, 4);
  });

  it('defaults AcceptableAimDelta to 0 radians when not specified (C++ parity)', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('BasicUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BasicGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('BasicGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 200,
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('BasicUnit', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp line 267 — m_aimDelta = 0.0f
    expect(entity.attackWeapon.acceptableAimDelta).toBe(0);
  });
});

describe('INI field gap: MinTargetPitch / MaxTargetPitch', () => {
  it('parses pitch limits from weapon INI and stores in radians', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('AAGun', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('AAWeapon'),
          ]),
        ],
        weapons: [
          makeWeaponDef('AAWeapon', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 200,
            DelayBetweenShots: 200,
            MinTargetPitch: 10,
            MaxTargetPitch: 80,
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('AAGun', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    expect(entity.attackWeapon.minTargetPitch).toBeCloseTo(10 * Math.PI / 180, 4);
    expect(entity.attackWeapon.maxTargetPitch).toBeCloseTo(80 * Math.PI / 180, 4);
  });

  it('defaults to -180/+180 degrees (full sphere, C++ parity)', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('BasicUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BasicGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('BasicGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 200,
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('BasicUnit', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    // Source parity: Weapon.cpp lines 279-280 — m_minTargetPitch = -PI, m_maxTargetPitch = PI
    expect(entity.attackWeapon.minTargetPitch).toBeCloseTo(-Math.PI, 4);
    expect(entity.attackWeapon.maxTargetPitch).toBeCloseTo(Math.PI, 4);
  });
});

describe('INI field gap: RequestAssistRange', () => {
  it('parses RequestAssistRange from weapon INI', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('LeaderUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('AssistGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('AssistGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 200,
            RequestAssistRange: 200,
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('LeaderUnit', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    expect(entity.attackWeapon.requestAssistRange).toBe(200);
  });

  it('defaults RequestAssistRange to 0', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('BasicUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BasicGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('BasicGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 200,
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('BasicUnit', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    expect(entity.attackWeapon.requestAssistRange).toBe(0);
  });
});

describe('INI field gap: ShroudRevealToAllRange', () => {
  it('parses ShroudRevealToAllRange from object INI', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Beacon', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ], { ShroudRevealToAllRange: 150 }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('Beacon', 20, 20)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.shroudRevealToAllRange).toBe(150);
  });

  it('defaults ShroudRevealToAllRange to 0', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('BasicUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('BasicUnit', 20, 20)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.shroudRevealToAllRange).toBe(0);
  });
});

describe('INI field gap: FireOCL on weapon', () => {
  it('parses FireOCL from weapon INI and stores on weapon profile', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Shooter', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('OCLGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('OCLGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 200,
            FireOCL: 'OCL_MuzzleFlash',
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('Shooter', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    expect(entity.attackWeapon.fireOCLName).toBe('OCL_MuzzleFlash');
  });

  it('defaults fireOCLName to null', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('BasicUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('BasicGun'),
          ]),
        ],
        weapons: [
          makeWeaponDef('BasicGun', {
            PrimaryDamage: 10,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 100,
            DelayBetweenShots: 200,
          }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('BasicUnit', 10, 10)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.attackWeapon).toBeDefined();
    expect(entity.attackWeapon.fireOCLName).toBeNull();
  });
});

describe('INI field gap: FactoryExitWidth', () => {
  it('parses FactoryExitWidth from object INI', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('WarFactory', 'America', ['STRUCTURE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ], { FactoryExitWidth: 40 }),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('WarFactory', 30, 30)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.factoryExitWidth).toBe(40);
  });

  it('defaults FactoryExitWidth to 0', () => {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('BasicUnit', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          ]),
        ],
      },
      sides: { America: {} },
      mapObjects: [place('BasicUnit', 20, 20)],
    });

    const entity = agent.gameLogic.spawnedEntities.values().next().value;
    expect(entity.factoryExitWidth).toBe(0);
  });
});
