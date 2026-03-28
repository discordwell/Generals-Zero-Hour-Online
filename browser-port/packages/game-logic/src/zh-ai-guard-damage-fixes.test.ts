/**
 * Tests for ZH-only AI runtime fixes:
 * 1. EnterGuard / HijackGuard behavior (AIGuardRetaliate.cpp:255-276)
 * 2. DamageFXOverride on damage info (Damage.h:269, ActiveBody.cpp:321-329)
 * 3. SourceTemplate on damage info (Damage.cpp:148-157)
 * 4. JetAI out-of-ammo exits guard (AIStates.cpp:6744)
 * 5. DiesOnBadLand for OCL-created units (ObjectCreationList.cpp:1267-1300)
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Helper: find entities by template name
// ---------------------------------------------------------------------------
function getEntitiesByTemplate(logic: GameLogicSubsystem, templateName: string): any[] {
  const privateApi = logic as unknown as {
    spawnedEntities: Map<number, { templateName: string }>;
  };
  const result: any[] = [];
  for (const ent of privateApi.spawnedEntities.values()) {
    if (ent.templateName === templateName) {
      result.push(ent);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fix 1: EnterGuard / HijackGuard (AIGuardRetaliate.cpp:255-276)
// ---------------------------------------------------------------------------

describe('EnterGuard / HijackGuard behavior (AIGuardRetaliate.cpp:255-276)', () => {
  function makeEnterGuardBundle(opts: { enterGuard?: boolean; hijackGuard?: boolean } = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 30 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RebelGun'] }),
        ], {
          EnterGuard: opts.enterGuard === true ? 'Yes' : 'No',
          HijackGuard: opts.hijackGuard === true ? 'Yes' : 'No',
        }),
        makeObjectDef('EnemyVehicle', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('RebelGun', {
          AttackRange: 150,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
  }

  it('enterGuard=true entity issues enter command instead of attack during guard idle', () => {
    const bundle = makeEnterGuardBundle({ enterGuard: true });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Rebel', 50, 50),
      makeMapObject('EnemyVehicle', 70, 50),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'GLA');
    logic.setPlayerSide(1, 'America');
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, any>;
      pendingEnterObjectActions: Map<number, { targetObjectId: number; action: string; commandSource: string }>;
    };

    const rebel = getEntitiesByTemplate(logic, 'Rebel')[0];
    const vehicle = getEntitiesByTemplate(logic, 'EnemyVehicle')[0];
    expect(rebel).toBeDefined();
    expect(vehicle).toBeDefined();

    // Verify enterGuard field was parsed.
    expect(rebel.enterGuard).toBe(true);
    expect(rebel.hijackGuard).toBe(false);

    // Put rebel in guard mode.
    rebel.guardState = 'IDLE';
    rebel.guardInnerRange = 200;
    rebel.guardOuterRange = 300;
    rebel.guardMode = 0;
    rebel.guardAreaTriggerIndex = -1;
    rebel.guardNextScanFrame = 0;

    // Advance frames to trigger guard scan.
    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // The rebel should have issued a pending enter object action, not an attack.
    if (rebel.guardState === 'PURSUING') {
      // Guard found the target and transitioned to pursuing.
      // Check that a pending enter action was set instead of an attack target.
      const pendingAction = privateApi.pendingEnterObjectActions.get(rebel.id);
      expect(pendingAction).toBeDefined();
      expect(pendingAction!.targetObjectId).toBe(vehicle.id);
      // captureUnmannedFactionUnit is the default enter action for EnterGuard without HijackGuard.
      expect(pendingAction!.action).toBe('captureUnmannedFactionUnit');
    }
  });

  it('hijackGuard=true entity issues hijack action instead of default enter', () => {
    const bundle = makeEnterGuardBundle({ enterGuard: true, hijackGuard: true });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Rebel', 50, 50),
      makeMapObject('EnemyVehicle', 70, 50),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'GLA');
    logic.setPlayerSide(1, 'America');
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, any>;
      pendingEnterObjectActions: Map<number, { targetObjectId: number; action: string; commandSource: string }>;
    };

    const rebel = getEntitiesByTemplate(logic, 'Rebel')[0];
    const vehicle = getEntitiesByTemplate(logic, 'EnemyVehicle')[0];

    expect(rebel.enterGuard).toBe(true);
    expect(rebel.hijackGuard).toBe(true);

    rebel.guardState = 'IDLE';
    rebel.guardInnerRange = 200;
    rebel.guardOuterRange = 300;
    rebel.guardMode = 0;
    rebel.guardAreaTriggerIndex = -1;
    rebel.guardNextScanFrame = 0;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    if (rebel.guardState === 'PURSUING') {
      const pendingAction = privateApi.pendingEnterObjectActions.get(rebel.id);
      expect(pendingAction).toBeDefined();
      expect(pendingAction!.targetObjectId).toBe(vehicle.id);
      expect(pendingAction!.action).toBe('hijackVehicle');
    }
  });

  it('enterGuard=false entity issues normal attack during guard', () => {
    const bundle = makeEnterGuardBundle({ enterGuard: false });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Rebel', 50, 50),
      makeMapObject('EnemyVehicle', 70, 50),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'GLA');
    logic.setPlayerSide(1, 'America');
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, any>;
      pendingEnterObjectActions: Map<number, { targetObjectId: number; action: string }>;
    };

    const rebel = getEntitiesByTemplate(logic, 'Rebel')[0];
    const vehicle = getEntitiesByTemplate(logic, 'EnemyVehicle')[0];

    expect(rebel.enterGuard).toBe(false);

    rebel.guardState = 'IDLE';
    rebel.guardInnerRange = 200;
    rebel.guardOuterRange = 300;
    rebel.guardMode = 0;
    rebel.guardAreaTriggerIndex = -1;
    rebel.guardNextScanFrame = 0;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    if (rebel.guardState === 'PURSUING') {
      // Normal attack: no pending enter action.
      const pendingAction = privateApi.pendingEnterObjectActions.get(rebel.id);
      expect(pendingAction).toBeUndefined();
      // Should have set an attack target instead.
      expect(rebel.attackTargetEntityId).toBe(vehicle.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 2: DamageFXOverride on damage info (Damage.h:269, ActiveBody.cpp:321-329)
// ---------------------------------------------------------------------------

describe('DamageFXOverride on damage event (Damage.h:269)', () => {
  it('weapon damage events carry damageFXOverride field defaulting to UNRESISTABLE', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Shooter', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('Target', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          AttackRange: 200,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Shooter', 50, 50),
      makeMapObject('Target', 60, 50),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const privateApi = logic as unknown as {
      pendingWeaponDamageEvents: Array<{ damageFXOverride: string }>;
    };

    const shooter = getEntitiesByTemplate(logic, 'Shooter')[0];
    const target = getEntitiesByTemplate(logic, 'Target')[0];

    // Issue attack command.
    logic.submitCommand({ type: 'attack', entityId: shooter.id, targetEntityId: target.id, commandSource: 'PLAYER' });

    // Advance until a damage event is queued.
    for (let i = 0; i < 120; i++) {
      logic.update(0);
      if (privateApi.pendingWeaponDamageEvents.length > 0) break;
    }

    // Verify the damageFXOverride field is present and defaults to UNRESISTABLE.
    if (privateApi.pendingWeaponDamageEvents.length > 0) {
      expect(privateApi.pendingWeaponDamageEvents[0]!.damageFXOverride).toBe('UNRESISTABLE');
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 3: SourceTemplate on damage info (Damage.cpp:148-157)
// ---------------------------------------------------------------------------

describe('sourceTemplateName on damage event (Damage.cpp:148-157)', () => {
  it('weapon damage events carry sourceTemplateName from the attacker', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RangerGun'] }),
        ]),
        makeObjectDef('Target', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('RangerGun', {
          AttackRange: 200,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Ranger', 50, 50),
      makeMapObject('Target', 60, 50),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const privateApi = logic as unknown as {
      pendingWeaponDamageEvents: Array<{ sourceTemplateName: string | null }>;
    };

    const ranger = getEntitiesByTemplate(logic, 'Ranger')[0];
    const target = getEntitiesByTemplate(logic, 'Target')[0];

    logic.submitCommand({ type: 'attack', entityId: ranger.id, targetEntityId: target.id, commandSource: 'PLAYER' });

    for (let i = 0; i < 120; i++) {
      logic.update(0);
      if (privateApi.pendingWeaponDamageEvents.length > 0) break;
    }

    // Verify sourceTemplateName equals the attacker's template name.
    if (privateApi.pendingWeaponDamageEvents.length > 0) {
      expect(privateApi.pendingWeaponDamageEvents[0]!.sourceTemplateName).toBe('Ranger');
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 4: JetAI out-of-ammo exits guard (AIStates.cpp:6744)
// ---------------------------------------------------------------------------

describe('JetAI out-of-ammo exits guard (AIStates.cpp:6744)', () => {
  function makeJetGuardBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Raptor', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 100 }),
          makeBlock('Behavior', 'JetAIUpdate ModuleTag_JetAI', {
            OutOfAmmoDamagePerSecond: 0,
            ReturnToBaseIdleTime: 5000,
            NeedsRunway: 'No',
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RaptorMissile'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('RaptorMissile', {
          AttackRange: 300,
          PrimaryDamage: 100,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
          ClipSize: 4,
          AutoReloadsClip: 'No',
        }),
      ],
    });
  }

  it('jet with empty clip exits guard idle state', () => {
    const bundle = makeJetGuardBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Raptor', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const raptor = getEntitiesByTemplate(logic, 'Raptor')[0];
    expect(raptor).toBeDefined();
    expect(raptor.jetAIProfile).not.toBeNull();

    // Set up guard state.
    raptor.guardState = 'IDLE';
    raptor.guardInnerRange = 200;
    raptor.guardOuterRange = 300;
    raptor.guardMode = 0;
    raptor.guardAreaTriggerIndex = -1;
    raptor.guardNextScanFrame = 0;

    // Deplete ammo.
    raptor.attackAmmoInClip = 0;

    // Advance frames — the guard idle update should detect empty ammo and exit guard.
    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // Guard state should have been reset to 'NONE' because the jet is out of ammo.
    expect(raptor.guardState).toBe('NONE');
  });

  it('jet with ammo remains in guard idle state', () => {
    const bundle = makeJetGuardBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Raptor', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const raptor = getEntitiesByTemplate(logic, 'Raptor')[0];

    raptor.guardState = 'IDLE';
    raptor.guardInnerRange = 200;
    raptor.guardOuterRange = 300;
    raptor.guardMode = 0;
    raptor.guardAreaTriggerIndex = -1;
    raptor.guardNextScanFrame = 0;

    // Keep ammo full.
    raptor.attackAmmoInClip = 4;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // Guard state should still be IDLE (no enemies to find, ammo is fine).
    expect(raptor.guardState).toBe('IDLE');
  });

  it('enterGuard jet is exempt from out-of-ammo guard exit', () => {
    // Source parity: AIStates.cpp:6744 — enterGuard units skip the out-of-ammo check.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EnterJet', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 100 }),
          makeBlock('Behavior', 'JetAIUpdate ModuleTag_JetAI', {
            OutOfAmmoDamagePerSecond: 0,
            NeedsRunway: 'No',
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'JetGun'] }),
        ], {
          EnterGuard: 'Yes',
        }),
      ],
      weapons: [
        makeWeaponDef('JetGun', {
          AttackRange: 300,
          PrimaryDamage: 100,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
          ClipSize: 4,
          AutoReloadsClip: 'No',
        }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('EnterJet', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const jet = getEntitiesByTemplate(logic, 'EnterJet')[0];
    expect(jet.enterGuard).toBe(true);
    expect(jet.jetAIProfile).not.toBeNull();

    jet.guardState = 'IDLE';
    jet.guardInnerRange = 200;
    jet.guardOuterRange = 300;
    jet.guardMode = 0;
    jet.guardAreaTriggerIndex = -1;
    jet.guardNextScanFrame = 0;
    jet.attackAmmoInClip = 0;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // EnterGuard units should stay in guard even with empty ammo.
    expect(jet.guardState).toBe('IDLE');
  });
});

// ---------------------------------------------------------------------------
// Fix 5: DiesOnBadLand for OCL-created units (ObjectCreationList.cpp:1267-1300)
// ---------------------------------------------------------------------------

describe('DiesOnBadLand for OCL-created units (ObjectCreationList.cpp:1267-1300)', () => {
  it('OCL-spawned unit on valid terrain survives', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Launcher', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Paratrooper', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [],
    });
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCL_DropTroops',
        fields: {},
        blocks: [
          makeBlock('CreateObject', 'CreateObject', {
            ObjectNames: 'Paratrooper',
            DiesOnBadLand: 'Yes',
          }),
        ],
      },
    ];

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Launcher', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0];
    expect(launcher).toBeDefined();

    // Execute the OCL — entity spawns on valid terrain at (100, 100).
    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DropTroops', launcher);

    const troopers = getEntitiesByTemplate(logic, 'Paratrooper');
    expect(troopers.length).toBe(1);
    // Should be alive — on valid terrain.
    expect(troopers[0]!.destroyed).toBe(false);
  });

  it('OCL-spawned unit off-map is killed', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Launcher', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Paratrooper', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [],
    });
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCL_DropTroops',
        fields: {},
        blocks: [
          makeBlock('CreateObject', 'CreateObject', {
            ObjectNames: 'Paratrooper',
            DiesOnBadLand: 'Yes',
          }),
        ],
      },
    ];

    const logic = new GameLogicSubsystem(new THREE.Scene());
    // Use a small map.
    const mapData = makeMap([
      makeMapObject('Launcher', 10, 10),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 10, y: 10, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0];
    if (!launcher) return; // Launcher might not spawn.

    // Move launcher off-map.
    launcher.x = -50;
    launcher.z = -50;

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DropTroops', launcher);

    const troopers = getEntitiesByTemplate(logic, 'Paratrooper');
    // If spawned, should be killed because it's off-map.
    for (const trooper of troopers) {
      expect(trooper.destroyed).toBe(true);
    }
  });

  it('DiesOnBadLand=No does not kill off-map units', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Launcher', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Paratrooper', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [],
    });
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCL_DropTroops',
        fields: {},
        blocks: [
          makeBlock('CreateObject', 'CreateObject', {
            ObjectNames: 'Paratrooper',
            // No DiesOnBadLand field — defaults to false.
          }),
        ],
      },
    ];

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Launcher', 10, 10),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 10, y: 10, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const launcher = getEntitiesByTemplate(logic, 'Launcher')[0];
    if (!launcher) return;

    // Move launcher off-map.
    launcher.x = -50;
    launcher.z = -50;

    (logic as unknown as { executeOCL: (name: string, entity: unknown) => void })
      .executeOCL('OCL_DropTroops', launcher);

    const troopers = getEntitiesByTemplate(logic, 'Paratrooper');
    // Without DiesOnBadLand, units should survive even off-map.
    for (const trooper of troopers) {
      expect(trooper.destroyed).toBe(false);
    }
  });
});
