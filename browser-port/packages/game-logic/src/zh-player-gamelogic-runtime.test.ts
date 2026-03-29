/**
 * ZH-only Player and GameLogic runtime fixes tests.
 *
 * Verifies five ZH-specific behaviors:
 *   1. findAnyShortcutSpecialPowerModule — find shortcut-capable power on entity
 *   2. findSpecialPowerWithOverridableDestination — query overridable-destination powers
 *   3. GUI_COMMAND_FIRE_WEAPON in doCommandButton — both object and position targets
 *   4. GUI_COMMAND_SELL in doCommandButton for scripts — sell from script dispatch
 *   5. playerIsPreorder flag — per-side preorder tracking
 *
 * Source parity:
 *   - Object.cpp:5892-5907: findAnyShortcutSpecialPowerModuleInterface
 *   - Object.cpp:5942-5975: findSpecialPowerWithOverridableDestination{Active}
 *   - Object.cpp:5453-5512,5581-5612,5702-5712: GUI_COMMAND_FIRE_WEAPON all 3 variants
 *   - Object.cpp:5510-5512: GUI_COMMAND_SELL in doCommandButton
 *   - Player.cpp:303,815-817,3590: m_isPreorder
 *   - GameLogic.cpp:1352,2773: playerIsPreorder in Dict
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
  makeSpecialPowerDef,
  makeWeaponDef,
  makeCommandButtonDef,
  makeCommandSetDef,
} from './test-helpers.js';

// ── Shared internals accessor ────────────────────────────────────────────────

interface MutableInternals {
  spawnedEntities: Map<number, any>;
  frameCounter: number;
}

function getInternals(logic: GameLogicSubsystem): MutableInternals {
  return logic as unknown as MutableInternals;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. findAnyShortcutSpecialPowerModule
// ═══════════════════════════════════════════════════════════════════════════════

describe('findAnyShortcutSpecialPowerModule', () => {
  function makeShortcutBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('ParticleCannon', 'America', ['STRUCTURE', 'FS_SUPERWEAPON'], [
          makeBlock('Behavior', 'SpecialPowerModule ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
        makeObjectDef('Barracks', 'America', ['STRUCTURE'], [
          makeBlock('Behavior', 'SpecialPowerModule ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_NON_SHORTCUT',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      specialPowers: [
        {
          ...makeSpecialPowerDef('SPECIAL_PARTICLE_UPLINK_CANNON', {
            ReloadTime: 240000,
            Enum: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          }),
          shortcutPower: true,
        } as any,
        makeSpecialPowerDef('SPECIAL_NON_SHORTCUT', {
          ReloadTime: 60000,
          Enum: 'SPECIAL_NON_SHORTCUT',
        }),
      ],
    });
  }

  it('returns the shortcut module when entity has one', () => {
    const bundle = makeShortcutBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('ParticleCannon', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const result = logic.findAnyShortcutSpecialPowerModule(1);
    expect(result).not.toBeNull();
    expect(result!.specialPowerTemplateName).toBe('SPECIAL_PARTICLE_UPLINK_CANNON');
  });

  it('returns null when entity has a power but not a shortcut power', () => {
    const bundle = makeShortcutBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Barracks', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const result = logic.findAnyShortcutSpecialPowerModule(1);
    expect(result).toBeNull();
  });

  it('returns null when entity has no special power modules', () => {
    const bundle = makeShortcutBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const result = logic.findAnyShortcutSpecialPowerModule(1);
    expect(result).toBeNull();
  });

  it('returns null for nonexistent entity', () => {
    const bundle = makeShortcutBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    expect(logic.findAnyShortcutSpecialPowerModule(999)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. findSpecialPowerWithOverridableDestination
// ═══════════════════════════════════════════════════════════════════════════════

describe('findSpecialPowerWithOverridableDestination', () => {
  function makeGunshipBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('SpectreGunship', 'America', ['AIRCRAFT'], [
          makeBlock('Behavior', 'SpectreGunshipUpdate ModuleTag_Spectre', {
            SpecialPowerTemplate: 'SPECIAL_SPECTRE_GUNSHIP',
            AttackAreaRadius: 200,
            TargetingReticleRadius: 25,
            GunshipOrbitRadius: 250,
            OrbitFrames: 1000,
            GattlingTemplateName: 'SpectreGattling',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('NormalUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_SPECTRE_GUNSHIP', {
          ReloadTime: 360000,
          Enum: 'SPECIAL_SPECTRE_GUNSHIP',
        }),
      ],
    });
  }

  it('returns power for entity with SpectreGunshipProfile (overridable destination)', () => {
    const bundle = makeGunshipBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SpectreGunship', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const result = logic.findSpecialPowerWithOverridableDestination(1);
    expect(result).not.toBeNull();
    expect(result!.specialPowerTemplateName).toBe('SPECIAL_SPECTRE_GUNSHIP');
  });

  it('returns null for entity without overridable destination', () => {
    const bundle = makeGunshipBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('NormalUnit', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const result = logic.findSpecialPowerWithOverridableDestination(1);
    expect(result).toBeNull();
  });

  it('returns null for nonexistent entity', () => {
    const bundle = makeGunshipBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    expect(logic.findSpecialPowerWithOverridableDestination(999)).toBeNull();
  });

  it('findSpecialPowerWithOverridableDestinationActive returns null when no active state', () => {
    const bundle = makeGunshipBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SpectreGunship', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Without spectreGunshipState being set, the active variant should return null.
    const result = logic.findSpecialPowerWithOverridableDestinationActive(1);
    expect(result).toBeNull();
  });

  it('findSpecialPowerWithOverridableDestinationActive returns power when status is ORBITING', () => {
    const bundle = makeGunshipBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SpectreGunship', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Manually set spectreGunshipState to simulate an active gunship.
    const priv = getInternals(logic);
    const entity = priv.spawnedEntities.get(1);
    entity.spectreGunshipState = {
      status: 'ORBITING',
      initialTargetX: 100,
      initialTargetZ: 100,
      overrideTargetX: 100,
      overrideTargetZ: 100,
      orbitAngle: 0,
      howitzerNextFireFrame: 0,
      gattlingEntityId: -1,
      gattlingStrikeCount: 0,
      departFrame: 999999,
    };

    const result = logic.findSpecialPowerWithOverridableDestinationActive(1);
    expect(result).not.toBeNull();
    expect(result!.specialPowerTemplateName).toBe('SPECIAL_SPECTRE_GUNSHIP');
  });

  it('findSpecialPowerWithOverridableDestinationActive returns null when status is DEPARTING', () => {
    const bundle = makeGunshipBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SpectreGunship', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const priv = getInternals(logic);
    const entity = priv.spawnedEntities.get(1);
    entity.spectreGunshipState = {
      status: 'DEPARTING',
      initialTargetX: 100,
      initialTargetZ: 100,
      overrideTargetX: 100,
      overrideTargetZ: 100,
      orbitAngle: 0,
      howitzerNextFireFrame: 0,
      gattlingEntityId: -1,
      gattlingStrikeCount: 0,
      departFrame: 0,
    };

    const result = logic.findSpecialPowerWithOverridableDestinationActive(1);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GUI_COMMAND_FIRE_WEAPON in doCommandButton — both target variants
// ═══════════════════════════════════════════════════════════════════════════════

describe('GUI_COMMAND_FIRE_WEAPON in doCommandButton', () => {
  function makeFireWeaponBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('GunUnit', 'America', ['VEHICLE', 'CAN_ATTACK'], [
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'GunWeapon'] }),
        ], { CommandSet: 'GunUnitCommandSet' }),
        makeObjectDef('TargetUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('GunWeapon', {
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          ClipSize: 3,
          AutoReloadsClip: 'Yes',
          AutoReloadWhenIdle: 3000,
        }),
      ],
      commandButtons: [
        makeCommandButtonDef('Command_FireWeapon', {
          Command: 'FIRE_WEAPON',
          Options: 'NEED_TARGET_ENEMY_OBJECT NEED_TARGET_POS',
          WeaponSlot: 'PRIMARY',
          MaxShotsToFire: 3,
        }),
        makeCommandButtonDef('Command_FireWeaponNoTarget', {
          Command: 'FIRE_WEAPON',
          WeaponSlot: 'PRIMARY',
          MaxShotsToFire: 1,
        }),
      ],
      commandSets: [
        makeCommandSetDef('GunUnitCommandSet', {
          1: 'Command_FireWeapon',
          2: 'Command_FireWeaponNoTarget',
        }),
      ],
    });
  }

  it('FIRE_WEAPON with NONE target (no required options) succeeds', () => {
    const bundle = makeFireWeaponBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('GunUnit', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Source parity: doCommandButton(FIRE_WEAPON) with no target — weapon lock only.
    const result = logic.executeScriptAction({
      actionType: 445, // NAMED_USE_COMMANDBUTTON_ABILITY
      params: [1, 'Command_FireWeaponNoTarget'],
    });
    expect(result).toBe(true);
  });

  it('FIRE_WEAPON with POSITION target dispatches fireWeapon command', () => {
    const bundle = makeFireWeaponBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const map = makeMap([makeMapObject('GunUnit', 10, 10)], 64, 64);
    map.waypoints = { nodes: [{ id: 1, name: 'TargetWP', position: { x: 30, y: 0, z: 30 } }], links: [] };
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap(64, 64));
    logic.update(1 / 30);

    // Source parity (ZH): doCommandButtonAtPosition handles FIRE_WEAPON with NEED_TARGET_POS.
    const result = logic.executeScriptAction({
      actionType: 404, // NAMED_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT
      params: [1, 'Command_FireWeapon', 'TargetWP'],
    });
    expect(result).toBe(true);
  });

  it('FIRE_WEAPON with OBJECT target dispatches fireWeapon with targetObjectId', () => {
    const bundle = makeFireWeaponBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GunUnit', 10, 10),    // id 1
        makeMapObject('TargetUnit', 30, 10),  // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Set America-GLA relationship to enemies (default is neutral=1, enemies=0).
    logic.setTeamRelationship('America', 'GLA', 0); // RELATIONSHIP_ENEMIES = 0

    // Source parity (ZH): doCommandButtonAtObject handles FIRE_WEAPON with NEED_TARGET_ENEMY_OBJECT.
    const result = logic.executeScriptAction({
      actionType: 403, // NAMED_USE_COMMANDBUTTON_ABILITY_ON_NAMED
      params: [1, 'Command_FireWeapon', 2],
    });
    expect(result).toBe(true);
  });

  it('FIRE_WEAPON with NONE target but requiring NEED_TARGET_POS returns false', () => {
    const bundle = makeFireWeaponBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('GunUnit', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Command_FireWeapon requires NEED_TARGET_POS, so NONE target should fail.
    const result = logic.executeScriptAction({
      actionType: 445, // NAMED_USE_COMMANDBUTTON_ABILITY
      params: [1, 'Command_FireWeapon'],
    });
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GUI_COMMAND_SELL in doCommandButton for scripts
// ═══════════════════════════════════════════════════════════════════════════════

describe('GUI_COMMAND_SELL in doCommandButton for scripts', () => {
  function makeSellBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('CommandCenter', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ], { CommandSet: 'CCCommandSet', BuildCost: 2000 }),
        makeObjectDef('TargetUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      commandButtons: [
        makeCommandButtonDef('Command_Sell', {
          Command: 'SELL',
        }),
      ],
      commandSets: [
        makeCommandSetDef('CCCommandSet', {
          1: 'Command_Sell',
        }),
      ],
    });
  }

  it('SELL with NONE target issues sell command (script dispatch)', () => {
    const bundle = makeSellBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('CommandCenter', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Source parity: C++ doCommandButton SELL calls TheBuildAssistant->sellObject(this).
    const result = logic.executeScriptAction({
      actionType: 445, // NAMED_USE_COMMANDBUTTON_ABILITY
      params: [1, 'Command_Sell'],
    });
    expect(result).toBe(true);
  });

  it('SELL with OBJECT target returns false (C++ not implemented)', () => {
    const bundle = makeSellBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CommandCenter', 10, 10),  // id 1
        makeMapObject('TargetUnit', 30, 10),      // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Source parity: C++ doCommandButtonAtObject does NOT implement SELL.
    const result = logic.executeScriptAction({
      actionType: 403, // NAMED_USE_COMMANDBUTTON_ABILITY_ON_NAMED
      params: [1, 'Command_Sell', 2],
    });
    expect(result).toBe(false);
  });

  it('SELL with POSITION target returns false (C++ not implemented)', () => {
    const bundle = makeSellBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const map = makeMap([makeMapObject('CommandCenter', 10, 10)], 64, 64);
    map.waypoints = { nodes: [{ id: 1, name: 'WP', position: { x: 20, y: 0, z: 20 } }], links: [] };
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap(64, 64));
    logic.update(1 / 30);

    // Source parity: C++ doCommandButtonAtPosition does NOT implement SELL.
    const result = logic.executeScriptAction({
      actionType: 404, // NAMED_USE_COMMANDBUTTON_ABILITY_AT_WAYPOINT
      params: [1, 'Command_Sell', 'WP'],
    });
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Preorder player flag
// ═══════════════════════════════════════════════════════════════════════════════

describe('playerIsPreorder flag', () => {
  function makePreorderBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
  }

  it('defaults to false for all sides', () => {
    const bundle = makePreorderBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    expect(logic.isSidePreorder('America')).toBe(false);
    expect(logic.isSidePreorder('GLA')).toBe(false);
  });

  it('can be set to true for a side', () => {
    const bundle = makePreorderBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    const result = logic.setSideIsPreorder('America', true);
    expect(result).toBe(true);
    expect(logic.isSidePreorder('America')).toBe(true);
  });

  it('can be set back to false', () => {
    const bundle = makePreorderBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    logic.setSideIsPreorder('America', true);
    expect(logic.isSidePreorder('America')).toBe(true);

    logic.setSideIsPreorder('America', false);
    expect(logic.isSidePreorder('America')).toBe(false);
  });

  it('is per-side (setting one side does not affect another)', () => {
    const bundle = makePreorderBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    logic.setSideIsPreorder('America', true);
    expect(logic.isSidePreorder('America')).toBe(true);
    expect(logic.isSidePreorder('GLA')).toBe(false);
  });

  it('returns false for empty/invalid side name', () => {
    const bundle = makePreorderBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    expect(logic.setSideIsPreorder('', true)).toBe(false);
    expect(logic.isSidePreorder('')).toBe(false);
  });

  it('is case-insensitive for side names', () => {
    const bundle = makePreorderBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    logic.setSideIsPreorder('america', true);
    expect(logic.isSidePreorder('AMERICA')).toBe(true);
    expect(logic.isSidePreorder('America')).toBe(true);
  });
});
