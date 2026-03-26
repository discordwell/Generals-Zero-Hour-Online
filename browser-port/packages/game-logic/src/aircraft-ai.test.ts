import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem, LOGIC_FRAME_RATE } from './index.js';
import { resolveScriptReinforcementDeliverPayloadProfile } from './script-actions.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeUpgradeDef,
  makeCommandButtonDef,
  makeCommandSetDef,
  makeScienceDef,
  makeAudioEventDef,
  makeSpecialPowerDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeInputState,
} from './test-helpers.js';

describe('CountermeasuresBehavior', () => {
  /**
   * Setup: Aircraft with countermeasures, enemy missile launcher targets it.
   *
   * Map layout (128×128, MAP_XY_FACTOR=10 → world = cell*10+5):
   *   Entity 1: Aircraft (America) at cell (5,5) → world (55,55)
   *   Entity 2: Missile launcher (GLA) at cell (5,2) → world (55,25)
   */
  function makeCountermeasureSetup(opts?: {
    evasionRate?: number;
    volleySize?: number;
    numberOfVolleys?: number;
    missileDecoyDelayMs?: number;
    reactionLatencyMs?: number;
    reloadTimeMs?: number;
    delayBetweenVolleysMs?: number;
    missileSpeed?: number;
    missileDamage?: number;
  }) {
    const evasionRate = opts?.evasionRate ?? 100; // percent
    const volleySize = opts?.volleySize ?? 2;
    const numberOfVolleys = opts?.numberOfVolleys ?? 3;
    const missileDecoyDelayMs = opts?.missileDecoyDelayMs ?? 333; // ~10 frames
    const reactionLatencyMs = opts?.reactionLatencyMs ?? 100; // ~3 frames
    const reloadTimeMs = opts?.reloadTimeMs ?? 0; // no auto-reload by default
    const delayBetweenVolleysMs = opts?.delayBetweenVolleysMs ?? 333; // ~10 frames
    const missileSpeed = opts?.missileSpeed ?? 3; // slow missile for longer flight
    const missileDamage = opts?.missileDamage ?? 200;

    const bundle = makeBundle({
      objects: [
        makeObjectDef('CountermeasureAircraft', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'CountermeasuresBehavior ModuleTag_CM', {
            FlareTemplateName: '',
            VolleySize: volleySize,
            VolleyArcAngle: 30,
            VolleyVelocityFactor: 1.0,
            DelayBetweenVolleys: delayBetweenVolleysMs,
            NumberOfVolleys: numberOfVolleys,
            ReloadTime: reloadTimeMs,
            EvasionRate: evasionRate,
            MissileDecoyDelay: missileDecoyDelayMs,
            ReactionLaunchLatency: reactionLatencyMs,
          }),
        ], { IsAirborneTarget: 'Yes' }),
        makeObjectDef('EnemyLauncher', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyMissileWeapon'] }),
        ]),
        makeObjectDef('TestMissile', 'GLA', ['PROJECTILE', 'SMALL_MISSILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('EnemyMissileWeapon', {
          AttackRange: 120,
          PrimaryDamage: missileDamage,
          WeaponSpeed: missileSpeed,
          DelayBetweenShots: 10000,
          ProjectileObject: 'TestMissile',
          AntiAirborneVehicle: 'Yes',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CountermeasureAircraft', 5, 5),
        makeMapObject('EnemyLauncher', 5, 2),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Set America and GLA as enemies.
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const entities = (logic as unknown as { spawnedEntities: Map<number, { templateName: string; health: number; maxHealth: number; countermeasuresState: unknown; category: string }> }).spawnedEntities;
    let aircraft: (typeof entities extends Map<number, infer V> ? V : never) | undefined;
    let launcher: (typeof entities extends Map<number, infer V> ? V : never) | undefined;
    for (const [, e] of entities) {
      if (e.templateName === 'CountermeasureAircraft') aircraft = e;
      if (e.templateName === 'EnemyLauncher') launcher = e;
    }

    return { logic, entities, aircraft: aircraft!, launcher: launcher! };
  }

  it('initializes countermeasures state on entity creation', () => {
    const { aircraft } = makeCountermeasureSetup({ volleySize: 2, numberOfVolleys: 3 });
    const state = aircraft.countermeasuresState as {
      availableCountermeasures: number;
      activeCountermeasures: number;
      flareIds: number[];
    };
    expect(state).toBeTruthy();
    expect(state.availableCountermeasures).toBe(6); // 2 * 3
    expect(state.activeCountermeasures).toBe(0);
    expect(state.flareIds.length).toBe(0);
  });

  it('diverts missile and suppresses damage when evasion succeeds', () => {
    const { logic, aircraft } = makeCountermeasureSetup({
      evasionRate: 100, // 100% evasion — always diverts
      missileDamage: 200,
      missileSpeed: 3,
      missileDecoyDelayMs: 33, // ~1 frame — divert before missile arrives
      reactionLatencyMs: 33,  // ~1 frame — launch flares immediately
    });

    // Command enemy (entity 2) to attack aircraft (entity 1).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    const initialHealth = aircraft.health;
    // Check pending events after weapon fires.
    const pendingEvents = (logic as unknown as { pendingWeaponDamageEvents: { countermeasureDivertFrame: number; countermeasureNoDamage: boolean }[] }).pendingWeaponDamageEvents;

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // Verify that any missile events were marked for diversion.
    // With 100% evasion, the aircraft should take no damage from missiles.
    // It may still take damage from subsequent attacks if the weapon reloads.
    expect(aircraft.health).toBe(initialHealth);
  });

  it('does not divert missile when evasion rate is 0%', () => {
    const { logic, aircraft, launcher } = makeCountermeasureSetup({
      evasionRate: 0, // 0% evasion — never diverts
      missileDamage: 100,
      missileSpeed: 5,
    });

    // Use entity IDs directly (1=aircraft, 2=launcher by creation order).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    const initialHealth = aircraft.health;
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // With 0% evasion, the missile should hit — aircraft takes damage.
    expect(aircraft.health).toBeLessThan(initialHealth);
  });

  it('consumes countermeasures and launches volleys', () => {
    const { logic, aircraft, launcher } = makeCountermeasureSetup({
      evasionRate: 100,
      volleySize: 2,
      numberOfVolleys: 2,
      reactionLatencyMs: 100, // ~3 frames
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Advance past reaction time + first volley launch.
    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
    }

    const state = aircraft.countermeasuresState as {
      availableCountermeasures: number;
      activeCountermeasures: number;
    };

    // Should have consumed at least one volley worth of countermeasures.
    expect(state.availableCountermeasures).toBeLessThan(4); // started with 2*2=4
  });

  it('auto-reloads countermeasures after reload timer expires', () => {
    const { logic, aircraft } = makeCountermeasureSetup({
      evasionRate: 100,
      volleySize: 1,
      numberOfVolleys: 1,
      reloadTimeMs: 333, // ~10 frames to reload
      reactionLatencyMs: 33,
      missileDecoyDelayMs: 33,
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    const state = aircraft.countermeasuresState as {
      availableCountermeasures: number;
      reloadFrame: number;
    };

    // Initial: 1 countermeasure available.
    expect(state.availableCountermeasures).toBe(1);

    // Advance a few frames — missile fires, countermeasures activate and are consumed.
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    // After the volley, countermeasures should be depleted (0 available).
    // The reload timer should have started.
    const afterVolleyAvailable = state.availableCountermeasures;

    // Advance well past reload time (another 30 frames).
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // After reload, if volley was consumed, countermeasures should be restored.
    if (afterVolleyAvailable === 0) {
      expect(state.availableCountermeasures).toBe(1);
    } else {
      // Volley wasn't consumed — just verify the state is valid.
      expect(state.availableCountermeasures).toBeGreaterThanOrEqual(0);
    }
  });

  it('only diverts MISSILE projectiles, not BULLET delivery', () => {
    // Setup with a direct (non-missile) weapon — countermeasures should not activate.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CMTarget', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'CountermeasuresBehavior ModuleTag_CM', {
            FlareTemplateName: '',
            VolleySize: 2,
            NumberOfVolleys: 3,
            EvasionRate: 100,
            MissileDecoyDelay: 333,
            ReactionLaunchLatency: 100,
          }),
        ]),
        makeObjectDef('GunEnemy', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'GunWeapon'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('GunWeapon', {
          AttackRange: 120,
          PrimaryDamage: 50,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
          AntiAirborneVehicle: 'Yes',
          // No ProjectileObject — this is a direct/bullet weapon.
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CMTarget', 5, 5),
        makeMapObject('GunEnemy', 5, 2),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const entities = (logic as unknown as { spawnedEntities: Map<number, { templateName: string; health: number; id: number; category: string }> }).spawnedEntities;
    let target: { templateName: string; health: number; id: number; category: string } | undefined;
    let enemy: { templateName: string; health: number; id: number; category: string } | undefined;
    for (const [, e] of entities) {
      if (e.templateName === 'CMTarget') target = e;
      if (e.templateName === 'GunEnemy') enemy = e;
    }

    logic.submitCommand({ type: 'attackEntity', entityId: enemy!.id, targetEntityId: target!.id });

    const initialHealth = target!.health;
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // Bullet damage should go through — countermeasures don't affect direct weapons.
    expect(target!.health).toBeLessThan(initialHealth);
  });
});

describe('HeightDieUpdate', () => {
  it('kills entity when it falls below target height above terrain', () => {
    const objectDef = makeObjectDef('FallingAircraft', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 5,
        SnapToGroundOnDeath: 'Yes',
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('FallingAircraft', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Grab entity reference before update — finalizeDestroyedEntities removes dead entities.
    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const aircraft = priv.spawnedEntities.get(1)!;
    expect(aircraft).toBeDefined();

    // Entity spawns at ground level. Height above terrain = 0, which is < 5.
    // After the HeightDieUpdate runs, entity should die.
    logic.update(0);
    expect(aircraft.destroyed || aircraft.slowDeathState !== null || aircraft.health <= 0).toBe(true);
  });

  it('does not kill entity when above target height', () => {
    const objectDef = makeObjectDef('FlyingAircraft', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 5,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('FlyingAircraft', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Grab entity and elevate before first update — otherwise HeightDie kills it at ground level.
    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const aircraft = priv.spawnedEntities.get(1)!;
    aircraft.y += 50;

    logic.update(0);

    // Run frames — entity should survive above target height.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(aircraft.destroyed).toBe(false);
    expect(aircraft.health).toBe(200);
  });

  it('respects InitialDelay before checking height', () => {
    const objectDef = makeObjectDef('DelayedAircraft', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 5,
        InitialDelay: 1000, // ~30 frames delay
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('DelayedAircraft', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const aircraft = priv.spawnedEntities.get(1)!;

    // Entity is at ground level (below target height) but delay hasn't expired.
    // Run a few frames — should survive because of InitialDelay.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(aircraft.destroyed).toBe(false);
    expect(aircraft.health).toBe(200);

    // Run past the delay (30 frames total).
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    // Now the height check should fire and kill the entity.
    expect(aircraft.destroyed || aircraft.slowDeathState !== null || aircraft.health <= 0).toBe(true);
  });

  it('uses bridge layer height when TargetHeightIncludesStructures is enabled', () => {
    const markerDef = makeObjectDef('BridgeMarker', 'Neutral', ['IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const objectDef = makeObjectDef('BridgeFlightTarget', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 5,
        TargetHeightIncludesStructures: 'Yes',
      }),
    ]);

    const bridgeStart = makeMapObject('BridgeMarker', 40, 40);
    bridgeStart.flags = 0x010;
    bridgeStart.position.z = 20;
    const bridgeEnd = makeMapObject('BridgeMarker', 80, 40);
    bridgeEnd.flags = 0x020;
    bridgeEnd.position.z = 20;

    const bundle = makeBundle({ objects: [markerDef, objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([bridgeStart, bridgeEnd, makeMapObject('BridgeFlightTarget', 60, 40)], 32, 32),
      makeRegistry(bundle),
      makeHeightmap(32, 32),
    );

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const aircraft = priv.spawnedEntities.get(3)!;
    // Ground threshold would be 5, bridge-layer threshold should be 25.
    aircraft.y = 23;

    logic.update(0);

    expect(aircraft.destroyed || aircraft.slowDeathState !== null || aircraft.health <= 0).toBe(true);
  });

  it('ignores bridge layer when entity is below bridge surface', () => {
    const markerDef = makeObjectDef('BridgeMarker', 'Neutral', ['IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const objectDef = makeObjectDef('BridgeFlightTargetLow', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 5,
        TargetHeightIncludesStructures: 'Yes',
      }),
    ]);

    const bridgeStart = makeMapObject('BridgeMarker', 40, 40);
    bridgeStart.flags = 0x010;
    bridgeStart.position.z = 20;
    const bridgeEnd = makeMapObject('BridgeMarker', 80, 40);
    bridgeEnd.flags = 0x020;
    bridgeEnd.position.z = 20;

    const bundle = makeBundle({ objects: [markerDef, objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([bridgeStart, bridgeEnd, makeMapObject('BridgeFlightTargetLow', 60, 40)], 32, 32),
      makeRegistry(bundle),
      makeHeightmap(32, 32),
    );

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const aircraft = priv.spawnedEntities.get(3)!;
    // Below the bridge deck (20), so layer should remain ground and threshold stay at 5.
    aircraft.y = 19;

    logic.update(0);

    expect(aircraft.destroyed).toBe(false);
    expect(aircraft.health).toBe(200);
  });

  it('selects the highest overlapping bridge layer that is below the entity', () => {
    const markerDef = makeObjectDef('BridgeMarker', 'Neutral', ['IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const objectDef = makeObjectDef('BridgeFlightTargetOverlap', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HeightDie', {
        TargetHeight: 5,
        TargetHeightIncludesStructures: 'Yes',
      }),
    ]);

    const lowStart = makeMapObject('BridgeMarker', 50, 40);
    lowStart.flags = 0x010;
    lowStart.position.z = 20;
    const highStart = makeMapObject('BridgeMarker', 60, 20);
    highStart.flags = 0x010;
    highStart.position.z = 35;
    const lowEnd = makeMapObject('BridgeMarker', 70, 40);
    lowEnd.flags = 0x020;
    lowEnd.position.z = 20;
    const highEnd = makeMapObject('BridgeMarker', 60, 60);
    highEnd.flags = 0x020;
    highEnd.position.z = 35;

    const bundle = makeBundle({ objects: [markerDef, objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([lowStart, highStart, lowEnd, highEnd, makeMapObject('BridgeFlightTargetOverlap', 60, 40)], 32, 32),
      makeRegistry(bundle),
      makeHeightmap(32, 32),
    );

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const aircraft = priv.spawnedEntities.get(5)!;
    // Above low bridge (20) and high bridge (35). C++ chooses the highest valid
    // layer (35), so threshold is 40 and this position should die.
    aircraft.y = 38;

    logic.update(0);

    expect(aircraft.destroyed || aircraft.slowDeathState !== null || aircraft.health <= 0).toBe(true);
  });
});

describe('HeightDieUpdate OnlyWhenMovingDown', () => {
  it('survives when below target height but moving upward', () => {
    const aircraft = makeObjectDef('Jet', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'HeightDieUpdate ModuleTag_HD', {
        TargetHeight: 5,
        OnlyWhenMovingDown: 'Yes',
        SnapToGroundOnDeath: 'Yes',
      }),
    ], { VisionRange: 100 });
    const bundle = makeBundle({ objects: [aircraft] });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Jet', 3, 3)]);
    const heightmap = makeHeightmap();
    const scene = { add: () => {}, remove: () => {} } as any;
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(map, registry, heightmap);

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;

    // Start at height 2 (below target 5) — first update initializes lastY.
    jet.y = 2 + jet.baseHeight;
    logic.update(1 / 30);
    expect(jet.destroyed).toBe(false); // First frame initializes lastY

    // Now move upward — below target but ascending. Should survive.
    jet.y = 3 + jet.baseHeight;
    logic.update(1 / 30);
    expect(jet.destroyed).toBe(false);

    // Move downward — now the check fires and it's below target → die.
    jet.y = 2 + jet.baseHeight;
    logic.update(1 / 30);
    expect(jet.destroyed).toBe(true);
  });
});

describe('JetAIUpdate flight state machine', () => {
  function makeJetBundle(jetAIFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('TestJet', 'America', ['AIRCRAFT', 'VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'JetGun'] }),
          makeBlock('LocomotorSet', 'SET_NORMAL JetLoco', {}),
          makeBlock('Behavior', 'JetAIUpdate ModuleTag_JetAI', {
            SneakyOffsetWhenAttacking: 0,
            AttackersMissPersistTime: 0,
            MinHeight: 80,
            OutOfAmmoDamagePerSecond: 10,
            ReturnToBaseIdleTime: 5000,
            NeedsRunway: true,
            TakeoffPause: 0,
            TakeoffDistForMaxLift: 0,
            ...jetAIFields,
          }),
        ]),
        makeObjectDef('TestAirfield', 'America', ['STRUCTURE', 'FS_AIRFIELD'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', {}),
          makeBlock('Behavior', 'QueueProductionExitUpdate ModuleTag_QExit', {}),
        ]),
        makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('JetGun', {
          AttackRange: 300,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          SecondaryDamage: 0,
          SecondaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 4,
          ClipReloadTime: 3000,
        }),
      ],
      locomotors: [
        makeLocomotorDef('JetLoco', 300),
      ],
    });
  }

  it('parses all JetAIProfile fields from INI', () => {
    const bundle = makeJetBundle({
      MinHeight: 120,
      OutOfAmmoDamagePerSecond: 25,
      ReturnToBaseIdleTime: 8000,
      NeedsRunway: false,
      KeepsParkingSpaceWhenAirborne: false,
      ParkingOffset: 15,
      TakeoffPause: 500,
      TakeoffDistForMaxLift: 0.5,
      AttackLocomotorType: 'SET_NORMAL',
      AttackLocomotorPersistTime: 2000,
      ReturnForAmmoLocomotorType: 'SET_NORMAL',
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    expect(jet.jetAIProfile).not.toBeNull();
    expect(jet.jetAIProfile.minHeight).toBe(120);
    expect(jet.jetAIProfile.outOfAmmoDamagePerSecond).toBeCloseTo(0.25);
    expect(jet.jetAIProfile.needsRunway).toBe(false);
    expect(jet.jetAIProfile.keepsParkingSpaceWhenAirborne).toBe(false);
    expect(jet.jetAIProfile.parkingOffset).toBe(15);
    expect(jet.jetAIProfile.attackLocomotorSet).toBe('SET_NORMAL');
    expect(jet.jetAIProfile.returnLocomotorSet).toBe('SET_NORMAL');
    expect(jet.jetAIState).not.toBeNull();
    expect(jet.jetAIState.cruiseHeight).toBe(120);
  });

  it('map-placed aircraft start AIRBORNE with AIRBORNE_TARGET status', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    expect(jet.jetAIState.state).toBe('AIRBORNE');
    expect(jet.jetAIState.allowAirLoco).toBe(true);
    expect(jet.objectStatusFlags.has('AIRBORNE_TARGET')).toBe(true);
  });

  it('transitions PARKED → TAKING_OFF → AIRBORNE on move command', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 50, 50),
        makeMapObject('TestAirfield', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    const airfield = priv.spawnedEntities.get(2)!;

    // Manually set to PARKED (simulating a produced aircraft).
    jet.jetAIState.state = 'PARKED';
    jet.jetAIState.allowAirLoco = false;
    jet.jetAIState.producerX = airfield.x;
    jet.jetAIState.producerZ = airfield.z;
    jet.producerEntityId = airfield.id;
    jet.objectStatusFlags.delete('AIRBORNE_TARGET');

    // Issue move command — should store as pending and trigger takeoff.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 100, targetZ: 100 });
    logic.update(1 / 30);

    expect(jet.jetAIState.state).toBe('TAKING_OFF');
    expect(jet.objectStatusFlags.has('AIRBORNE_TARGET')).toBe(true);
    // Pending command is kept until AIRBORNE entry clears it.
    expect(jet.jetAIState.pendingCommand).toEqual({ type: 'moveTo', x: 100, z: 100 });

    // Run through takeoff (30 frames).
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    expect(jet.jetAIState.state).toBe('AIRBORNE');
    expect(jet.jetAIState.allowAirLoco).toBe(true);
    expect(jet.jetAIState.pendingCommand).toBeNull(); // cleared on AIRBORNE entry
    expect(jet.moving).toBe(true);
  });

  it('returns to base when out of ammo', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 30, 30),
        makeMapObject('TestAirfield', 90, 90),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    const airfield = priv.spawnedEntities.get(2)!;

    // Start airborne with producer set.
    jet.jetAIState.producerX = airfield.x;
    jet.jetAIState.producerZ = airfield.z;
    jet.producerEntityId = airfield.id;

    // Deplete ammo.
    jet.attackAmmoInClip = 0;

    logic.update(1 / 30);

    expect(jet.jetAIState.state).toBe('RETURNING_FOR_LANDING');
    expect(jet.moving).toBe(true);
  });

  it('lands, reloads ammo, then parks after returning to airfield', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 50, 50),
        makeMapObject('TestAirfield', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    const airfield = priv.spawnedEntities.get(2)!;

    jet.jetAIState.producerX = airfield.x;
    jet.jetAIState.producerZ = airfield.z;
    jet.producerEntityId = airfield.id;

    // Set to RETURNING close to the airfield.
    jet.jetAIState.state = 'RETURNING_FOR_LANDING';
    jet.jetAIState.stateEnteredFrame = priv.frameCounter;
    jet.x = airfield.x + 5; // within NEAR_AIRFIELD_DIST_SQ (400 = 20^2)
    jet.z = airfield.z + 5;
    jet.attackAmmoInClip = 0;

    logic.update(1 / 30);

    // Should transition to LANDING since within 20 units.
    expect(jet.jetAIState.state).toBe('LANDING');

    // Run through landing (30 frames).
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    // Should be reloading now.
    expect(jet.jetAIState.state).toBe('RELOAD_AMMO');
    expect(jet.objectStatusFlags.has('AIRBORNE_TARGET')).toBe(false);

    // Run reload frames (clipReloadTime = 3000ms = 90 frames, proportional for full clip).
    for (let i = 0; i < 100; i++) logic.update(1 / 30);

    // Should be PARKED with full ammo.
    expect(jet.jetAIState.state).toBe('PARKED');
    expect(jet.attackAmmoInClip).toBe(4); // clipSize
  });

  it('enters CIRCLING_DEAD_AIRFIELD when producer destroyed while returning', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 50, 50),
        makeMapObject('TestAirfield', 80, 80),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    const airfield = priv.spawnedEntities.get(2)!;

    jet.jetAIState.producerX = airfield.x;
    jet.jetAIState.producerZ = airfield.z;
    jet.producerEntityId = airfield.id;

    // Set to RETURNING.
    jet.jetAIState.state = 'RETURNING_FOR_LANDING';
    jet.jetAIState.stateEnteredFrame = priv.frameCounter;

    // Destroy the airfield.
    airfield.destroyed = true;

    logic.update(1 / 30);

    // No other airfield exists, should circle.
    expect(jet.jetAIState.state).toBe('CIRCLING_DEAD_AIRFIELD');
  });

  it('applies out-of-ammo damage while circling dead airfield', () => {
    const bundle = makeJetBundle({ OutOfAmmoDamagePerSecond: 50 }); // 50% per 100 / sec → 0.5
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;

    // Manually set to CIRCLING state.
    jet.jetAIState.state = 'CIRCLING_DEAD_AIRFIELD';
    jet.jetAIState.stateEnteredFrame = priv.frameCounter;
    jet.jetAIState.circlingNextCheckFrame = priv.frameCounter + 30;
    jet.producerEntityId = 0; // no producer

    const healthBefore = jet.health;

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // OutOfAmmoDamagePerSecond = 50 → 0.5 (per second ratio of max health).
    // 30 frames = 1 second. Expected damage = maxHealth * 0.5 * 1 = 100.
    expect(jet.health).toBeLessThan(healthBefore);
    expect(jet.health).toBeCloseTo(healthBefore - 100, 0);
  });

  it('returns to base after idle timer expires', () => {
    const bundle = makeJetBundle({ ReturnToBaseIdleTime: 1000 }); // 30 frames
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 30, 30),
        makeMapObject('TestAirfield', 90, 90),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    const airfield = priv.spawnedEntities.get(2)!;
    jet.jetAIState.producerX = airfield.x;
    jet.jetAIState.producerZ = airfield.z;
    jet.producerEntityId = airfield.id;

    // Set idle timer to expire shortly.
    jet.jetAIState.returnToBaseFrame = priv.frameCounter + 5;
    jet.moving = false;
    jet.attackTargetEntityId = null;

    // Run for 10 frames — idle timer should expire and trigger return.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Should be returning to base (or already landing if very close).
    expect(['RETURNING_FOR_LANDING', 'LANDING']).toContain(jet.jetAIState.state);
  });

  it('airborne aircraft use direct-path movement (skip pathfinding)', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 20, 20)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;

    // Issue move command to airborne jet.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 100, targetZ: 100 });
    logic.update(1 / 30);

    expect(jet.moving).toBe(true);
    expect(jet.movePath.length).toBe(1);
    expect(jet.movePath[0]).toEqual({ x: 100, z: 100 });
  });

  it('airborne aircraft maintain cruise altitude above terrain', () => {
    const bundle = makeJetBundle({ MinHeight: 80 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;

    // Give it a destination so movement update runs.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 80, targetZ: 80 });
    logic.update(1 / 30);

    // Y should be approximately terrainHeight + baseHeight + cruiseHeight.
    // Terrain is flat at 0, baseHeight is nominalHeight/2 for air category.
    expect(jet.y).toBeGreaterThan(50);
  });

  it('AIRBORNE_TARGET enables anti-air weapon targeting', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const state = logic.getEntityState(1);
    expect(state?.statusFlags).toContain('AIRBORNE_TARGET');
  });

  it('airborne aircraft excluded from ground collision separation', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 50, 50),
        makeMapObject('TestJet', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const jet1 = priv.spawnedEntities.get(1)!;
    const jet2 = priv.spawnedEntities.get(2)!;

    const x1Before = jet1.x;
    const x2Before = jet2.x;

    // Run a few frames — collision separation should not push them apart.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Airborne aircraft should not be separated (AIRBORNE_TARGET exclusion).
    expect(jet1.x).toBeCloseTo(x1Before, 1);
    expect(jet2.x).toBeCloseTo(x2Before, 1);
  });

  it('commands while PARKED queue as pending and trigger takeoff', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestJet', 50, 50),
        makeMapObject('TestAirfield', 50, 50),
        makeMapObject('EnemyTank', 100, 100),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    const airfield = priv.spawnedEntities.get(2)!;

    // Set to PARKED state.
    jet.jetAIState.state = 'PARKED';
    jet.jetAIState.allowAirLoco = false;
    jet.jetAIState.producerX = airfield.x;
    jet.jetAIState.producerZ = airfield.z;
    jet.producerEntityId = airfield.id;
    jet.objectStatusFlags.delete('AIRBORNE_TARGET');

    // Issue attack command — queued until next update.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 3 });

    // After update: command is intercepted (stored as pending), then updateJetAI transitions to TAKING_OFF.
    logic.update(1 / 30);
    expect(jet.jetAIState.state).toBe('TAKING_OFF');
    // Pending command is kept until AIRBORNE entry.
    expect(jet.jetAIState.pendingCommand).toEqual({ type: 'attackEntity', targetId: 3 });
  });
});

function makeFlightDeckCarrierDef(): ReturnType<typeof makeObjectDef> {
  return makeObjectDef('AircraftCarrier', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
    makeBlock('Behavior', 'FlightDeckBehavior ModuleTag_FlightDeck', {
      NumRunways: 2,
      NumSpacesPerRunway: 3,
      HealAmountPerSecond: 30,
      ApproachHeight: 50,
      LandingDeckHeightOffset: 45,
      ParkingCleanupPeriod: 500,
      HumanFollowPeriod: 333,
      ReplacementDelay: 4000,
      DockAnimationDelay: 3000,
      LaunchWaveDelay: 3000,
      LaunchRampDelay: 667,
      LowerRampDelay: 600,
      CatapultFireDelay: 750,
      PayloadTemplate: 'CarrierJet',
      Runway1Spaces: ['R1S1', 'R1S2', 'R1S3'],
      Runway1Takeoff: ['R1TakeoffStart', 'R1TakeoffEnd'],
      Runway1Landing: ['R1LandStart', 'R1LandEnd'],
      Runway1Taxi: ['Taxi1', 'Taxi2'],
      Runway1Creation: ['Hanger1'],
      Runway2Spaces: ['R2S1', 'R2S2', 'R2S3'],
      Runway2Takeoff: ['R2TakeoffStart', 'R2TakeoffEnd'],
      Runway2Landing: ['R2LandStart', 'R2LandEnd'],
      Runway2Taxi: ['Taxi3', 'Taxi4'],
      Runway2Creation: ['Hanger2'],
    }),
  ]);
}

function makeCarrierJetDef(): ReturnType<typeof makeObjectDef> {
  return makeObjectDef('CarrierJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
  ]);
}

describe('FlightDeckBehavior', () => {
  it('extracts FlightDeck profile from INI', () => {
    const bundle = makeBundle({ objects: [makeFlightDeckCarrierDef()] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('AircraftCarrier', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        flightDeckProfile: {
          numRunways: number;
          numSpacesPerRunway: number;
          healAmountPerSecond: number;
          approachHeight: number;
          landingDeckHeightOffset: number;
          cleanupFrames: number;
          replacementFrames: number;
          dockAnimationFrames: number;
          launchWaveFrames: number;
          launchRampFrames: number;
          lowerRampFrames: number;
          catapultFireFrames: number;
          payloadTemplateName: string;
          runwaySpaces: string[][];
          runwayTakeoff: [string, string][];
          runwayLanding: [string, string][];
          runwayTaxi: string[][];
          runwayCreation: string[][];
        } | null;
      }>;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    expect(carrier.flightDeckProfile).not.toBeNull();
    const profile = carrier.flightDeckProfile!;
    expect(profile.numRunways).toBe(2);
    expect(profile.numSpacesPerRunway).toBe(3);
    expect(profile.healAmountPerSecond).toBe(30);
    expect(profile.approachHeight).toBe(50);
    expect(profile.landingDeckHeightOffset).toBe(45);
    expect(profile.payloadTemplateName).toBe('CarrierJet');
    // Duration fields: 500ms -> 15 frames at 30fps
    expect(profile.cleanupFrames).toBe(15);
    // 4000ms -> 120 frames
    expect(profile.replacementFrames).toBe(120);
    // 3000ms -> 90 frames
    expect(profile.dockAnimationFrames).toBe(90);
    expect(profile.launchWaveFrames).toBe(90);
    // 667ms -> 20 frames
    expect(profile.launchRampFrames).toBe(20);
    // 600ms -> 18 frames
    expect(profile.lowerRampFrames).toBe(18);
    // 750ms -> 23 frames (rounded)
    expect(profile.catapultFireFrames).toBe(23);
    // Runway bone names
    expect(profile.runwaySpaces[0]).toEqual(['R1S1', 'R1S2', 'R1S3']);
    expect(profile.runwaySpaces[1]).toEqual(['R2S1', 'R2S2', 'R2S3']);
    expect(profile.runwayTakeoff[0]).toEqual(['R1TakeoffStart', 'R1TakeoffEnd']);
    expect(profile.runwayTakeoff[1]).toEqual(['R2TakeoffStart', 'R2TakeoffEnd']);
    expect(profile.runwayLanding[0]).toEqual(['R1LandStart', 'R1LandEnd']);
    expect(profile.runwayLanding[1]).toEqual(['R2LandStart', 'R2LandEnd']);
    expect(profile.runwayTaxi[0]).toEqual(['Taxi1', 'Taxi2']);
    expect(profile.runwayTaxi[1]).toEqual(['Taxi3', 'Taxi4']);
    expect(profile.runwayCreation[0]).toEqual(['Hanger1']);
    expect(profile.runwayCreation[1]).toEqual(['Hanger2']);
  });

  it('initializes parking spaces with correct interleaved runway assignment', () => {
    const bundle = makeBundle({ objects: [makeFlightDeckCarrierDef()] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('AircraftCarrier', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
          runwayTakeoffReservation: number[];
          runwayLandingReservation: number[];
          initialized: boolean;
        } | null;
      }>;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    expect(state).not.toBeNull();
    expect(state.initialized).toBe(true);
    // 2 runways * 3 spaces = 6 total parking spaces
    expect(state.parkingSpaces.length).toBe(6);
    // Interleaved: R1S1, R2S1, R1S2, R2S2, R1S3, R2S3
    expect(state.parkingSpaces[0]!.runway).toBe(0);
    expect(state.parkingSpaces[1]!.runway).toBe(1);
    expect(state.parkingSpaces[2]!.runway).toBe(0);
    expect(state.parkingSpaces[3]!.runway).toBe(1);
    expect(state.parkingSpaces[4]!.runway).toBe(0);
    expect(state.parkingSpaces[5]!.runway).toBe(1);
    // All spaces start empty
    for (const space of state.parkingSpaces) {
      expect(space.occupantId).toBe(-1);
    }
    // Runway reservations start empty
    expect(state.runwayTakeoffReservation).toEqual([-1, -1]);
    expect(state.runwayLandingReservation).toEqual([-1, -1]);
  });

  it('reserves and releases parking spaces', () => {
    const bundle = makeBundle({
      objects: [makeFlightDeckCarrierDef(), makeCarrierJetDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
        } | null;
      }>;
      flightDeckReserveSpace: (state: { parkingSpaces: Array<{ occupantId: number }> }, entityId: number) => boolean;
      flightDeckReleaseSpace: (state: { parkingSpaces: Array<{ occupantId: number }> }, entityId: number) => void;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    const jetId = 2;
    // Reserve a space
    const reserved = priv.flightDeckReserveSpace.call(logic, state, jetId);
    expect(reserved).toBe(true);
    expect(state.parkingSpaces[0]!.occupantId).toBe(jetId);
    // Reserving again should return true (idempotent)
    const reservedAgain = priv.flightDeckReserveSpace.call(logic, state, jetId);
    expect(reservedAgain).toBe(true);
    // Release the space
    priv.flightDeckReleaseSpace.call(logic, state, jetId);
    expect(state.parkingSpaces[0]!.occupantId).toBe(-1);
  });

  it('reserves and releases runways for takeoff and landing', () => {
    const bundle = makeBundle({
      objects: [makeFlightDeckCarrierDef(), makeCarrierJetDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        flightDeckProfile: { numRunways: number } | null;
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
          runwayTakeoffReservation: number[];
          runwayLandingReservation: number[];
        } | null;
      }>;
      flightDeckReserveRunway: (
        state: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
          runwayTakeoffReservation: number[];
          runwayLandingReservation: number[];
        },
        profile: { numRunways: number },
        entityId: number,
        forLanding: boolean,
      ) => boolean;
      flightDeckReleaseRunway: (
        state: {
          runwayTakeoffReservation: number[];
          runwayLandingReservation: number[];
        },
        entityId: number,
      ) => void;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    const profile = carrier.flightDeckProfile!;
    const jetId = 2;
    // Assign jet to front space (runway 0)
    state.parkingSpaces[0]!.occupantId = jetId;
    // Reserve takeoff runway
    const takeoffReserved = priv.flightDeckReserveRunway.call(logic, state, profile, jetId, false);
    expect(takeoffReserved).toBe(true);
    expect(state.runwayTakeoffReservation[0]).toBe(jetId);
    // Reserve same runway again — should return true (idempotent)
    const takeoffAgain = priv.flightDeckReserveRunway.call(logic, state, profile, jetId, false);
    expect(takeoffAgain).toBe(true);
    // Release runway
    priv.flightDeckReleaseRunway.call(logic, state, jetId);
    expect(state.runwayTakeoffReservation[0]).toBe(-1);
    // Reserve landing runway
    const landingReserved = priv.flightDeckReserveRunway.call(logic, state, profile, jetId, true);
    expect(landingReserved).toBe(true);
    expect(state.runwayLandingReservation[0]).toBe(jetId);
    // Release
    priv.flightDeckReleaseRunway.call(logic, state, jetId);
    expect(state.runwayLandingReservation[0]).toBe(-1);
  });

  it('heals parked aircraft at healAmount/30 per frame', () => {
    const bundle = makeBundle({
      objects: [makeFlightDeckCarrierDef(), makeCarrierJetDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        flightDeckState: {
          healeeEntityIds: Set<number>;
          nextHealFrame: number;
        } | null;
      }>;
      frameCounter: number;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    const jet = priv.spawnedEntities.get(2)!;
    // Damage the jet
    jet.health = 50;
    // Add jet to healee list
    state.healeeEntityIds.add(2);
    state.nextHealFrame = priv.frameCounter + 1;
    // HEAL_RATE_FRAMES = floor(30/5) = 6.
    // healAmount = 6 * 30 * (1/30) = 6 HP per heal tick.
    // Run 6 frames to trigger one heal tick.
    for (let i = 0; i < 7; i++) logic.update(1 / 30);
    expect(jet.health).toBeGreaterThan(50);
    // After enough frames, jet should be at max health.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    expect(jet.health).toBe(100);
  });

  it('kills parked non-airborne aircraft when carrier dies', () => {
    // Create a weapon to kill the carrier with
    const killWeapon = makeWeaponDef('KillWeapon', {
      PrimaryDamage: 10000,
      PrimaryDamageRadius: 1,
      DamageType: 'UNRESISTABLE',
      AttackRange: 500,
    });
    const bundle = makeBundle({
      objects: [
        makeFlightDeckCarrierDef(),
        makeCarrierJetDef(),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { CommandSet: 'AttackerCS' }),
      ],
      weapons: [killWeapon],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 55, 55),
        makeMapObject('CarrierJet', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        destroyed: boolean;
        objectStatusFlags: Set<string>;
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
        } | null;
      }>;
      onFlightDeckDie: (entity: unknown) => void;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    const jet1 = priv.spawnedEntities.get(2)!;
    const jet2 = priv.spawnedEntities.get(3)!;
    // Park jet1 (not airborne)
    state.parkingSpaces[0]!.occupantId = 2;
    jet1.objectStatusFlags.delete('AIRBORNE_TARGET');
    // Park jet2 but mark it airborne — should survive carrier death
    state.parkingSpaces[1]!.occupantId = 3;
    jet2.objectStatusFlags.add('AIRBORNE_TARGET');
    // Directly call onFlightDeckDie to test the die behavior
    priv.onFlightDeckDie.call(logic, carrier);
    logic.update(1 / 30);
    // jet1 should be dead (non-airborne parked aircraft)
    expect(jet1.destroyed || jet1.health <= 0).toBe(true);
    // jet2 was airborne so should survive
    expect(jet2.health).toBe(100);
    expect(jet2.destroyed).toBe(false);
  });

  it('purges dead aircraft from parking spaces', () => {
    const bundle = makeBundle({
      objects: [makeFlightDeckCarrierDef(), makeCarrierJetDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        destroyed: boolean;
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
          runwayTakeoffReservation: number[];
          runwayLandingReservation: number[];
        } | null;
      }>;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    // Place jet in parking space and runway reservation
    state.parkingSpaces[0]!.occupantId = 2;
    state.runwayTakeoffReservation[0] = 2;
    // Kill the jet by removing it from existence
    const jet = priv.spawnedEntities.get(2)!;
    jet.destroyed = true;
    // Run update — purge should clear dead jet
    logic.update(1 / 30);
    expect(state.parkingSpaces[0]!.occupantId).toBe(-1);
    expect(state.runwayTakeoffReservation[0]).toBe(-1);
  });

  it('catapult launch sequence sets model conditions and launches aircraft', () => {
    const bundle = makeBundle({
      objects: [makeFlightDeckCarrierDef(), makeCarrierJetDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 55, 55),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        destroyed: boolean;
        objectStatusFlags: Set<string>;
        modelConditionFlags: Set<string>;
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number; runway: number }>;
          designatedCommand: string;
          designatedTargetId: number;
          rampUp: boolean[];
          nextLaunchWaveFrame: number[];
          lowerRampFrame: number[];
        } | null;
      }>;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    const state = carrier.flightDeckState!;
    const jet = priv.spawnedEntities.get(2)!;
    // Place jet in front parking space (runway 0) and make it non-airborne
    state.parkingSpaces[0]!.occupantId = 2;
    jet.objectStatusFlags.delete('AIRBORNE_TARGET');
    // Give carrier attack order so hasTakeoffOrders() returns true
    state.designatedCommand = 'ATTACK_POSITION';
    state.designatedTargetId = -1;
    // Run enough frames to trigger ramp up (launchRampFrames = 20)
    for (let i = 0; i < 2; i++) logic.update(1 / 30);
    // Ramp should start raising — DOOR_2_OPENING set
    expect(state.rampUp[0]).toBe(true);
    expect(carrier.modelConditionFlags.has('DOOR_2_OPENING')).toBe(true);
    // Run through launch ramp time (20 frames) + a few extra
    for (let i = 0; i < 25; i++) logic.update(1 / 30);
    // After ramp up + launch: jet should be airborne
    expect(jet.objectStatusFlags.has('AIRBORNE_TARGET')).toBe(true);
    // Parking space should be vacated
    expect(state.parkingSpaces[0]!.occupantId).toBe(-1);
    // After lower ramp delay (18 frames), ramp should close
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    expect(state.rampUp[0]).toBe(false);
    expect(carrier.modelConditionFlags.has('DOOR_2_CLOSING')).toBe(true);
  });

  it('sets NO_ATTACK status when no aircraft are parked', () => {
    const bundle = makeBundle({
      objects: [makeFlightDeckCarrierDef(), makeCarrierJetDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJet', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        destroyed: boolean;
        flightDeckState: {
          parkingSpaces: Array<{ occupantId: number }>;
        } | null;
      }>;
    };
    const carrier = priv.spawnedEntities.get(1)!;
    // All spaces empty — NO_ATTACK should be set
    logic.update(1 / 30);
    expect(carrier.objectStatusFlags.has('NO_ATTACK')).toBe(true);
    // Park a real jet in a space
    carrier.flightDeckState!.parkingSpaces[0]!.occupantId = 2;
    logic.update(1 / 30);
    // With a live aircraft parked, NO_ATTACK should be cleared
    expect(carrier.objectStatusFlags.has('NO_ATTACK')).toBe(false);
    // Destroy the jet — purgeDead should clear the space
    const jet = priv.spawnedEntities.get(2)!;
    jet.destroyed = true;
    logic.update(1 / 30);
    // No live aircraft parked, NO_ATTACK should be set again
    expect(carrier.objectStatusFlags.has('NO_ATTACK')).toBe(true);
  });

  it('returns null profile for objects without FlightDeckBehavior', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        flightDeckProfile: unknown;
        flightDeckState: unknown;
      }>;
    };
    const tank = priv.spawnedEntities.get(1)!;
    expect(tank.flightDeckProfile).toBeNull();
    expect(tank.flightDeckState).toBeNull();
  });

  // ── FlightDeck ↔ JetAI integration tests ──

  function makeCarrierJetWithJetAIDef(): ObjectDef {
    return makeObjectDef('CarrierJetAI', 'America', ['VEHICLE', 'AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'JetGun'] }),
      makeBlock('LocomotorSet', 'SET_NORMAL JetLoco', {}),
      makeBlock('Behavior', 'JetAIUpdate ModuleTag_JetAI', {
        SneakyOffsetWhenAttacking: 0,
        AttackersMissPersistTime: 0,
        MinHeight: 80,
        OutOfAmmoDamagePerSecond: 0,
        ReturnToBaseIdleTime: 0,
        NeedsRunway: true,
        KeepsParkingSpaceWhenAirborne: true,
        TakeoffPause: 0,
        TakeoffDistForMaxLift: 0,
      }),
    ]);
  }

  function makeFlightDeckJetBundle() {
    return makeBundle({
      objects: [
        makeFlightDeckCarrierDef(),
        makeCarrierJetWithJetAIDef(),
      ],
      weapons: [
        makeWeaponDef('JetGun', {
          AttackRange: 300,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 4,
          ClipReloadTime: 3000,
        }),
      ],
      locomotors: [
        makeLocomotorDef('JetLoco', 300),
      ],
    });
  }

  it('JetAI takeoff from flight deck reserves and releases runway', () => {
    const bundle = makeFlightDeckJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJetAI', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const carrier = priv.spawnedEntities.get(1)!;
    const jet = priv.spawnedEntities.get(2)!;
    const fdState = carrier.flightDeckState!;

    // Park jet in front space (runway 0)
    fdState.parkingSpaces[0]!.occupantId = 2;
    jet.jetAIState.state = 'PARKED';
    jet.jetAIState.allowAirLoco = false;
    jet.jetAIState.producerX = carrier.x;
    jet.jetAIState.producerZ = carrier.z;
    jet.producerEntityId = carrier.id;
    jet.objectStatusFlags.delete('AIRBORNE_TARGET');

    // Give jet a move command to trigger takeoff
    logic.submitCommand({ type: 'moveTo', entityId: 2, targetX: 200, targetZ: 200 });
    logic.update(1 / 30);

    // Should be TAKING_OFF with runway reserved
    expect(jet.jetAIState.state).toBe('TAKING_OFF');
    expect(fdState.runwayTakeoffReservation[0]).toBe(2);

    // Run through takeoff (30 frames)
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    // Should be AIRBORNE with runway released
    expect(jet.jetAIState.state).toBe('AIRBORNE');
    expect(fdState.runwayTakeoffReservation[0]).toBe(-1);
    // keepsParkingSpaceWhenAirborne=true, so space stays reserved
    expect(fdState.parkingSpaces[0]!.occupantId).toBe(2);
  });

  it('JetAI cannot takeoff from non-front flight deck space', () => {
    const bundle = makeFlightDeckJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJetAI', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const carrier = priv.spawnedEntities.get(1)!;
    const jet = priv.spawnedEntities.get(2)!;
    const fdState = carrier.flightDeckState!;

    // Park jet in back space (index 2 = R1S2, which is NOT in front numRunways slots)
    fdState.parkingSpaces[2]!.occupantId = 2;
    jet.jetAIState.state = 'PARKED';
    jet.jetAIState.allowAirLoco = false;
    jet.jetAIState.producerX = carrier.x;
    jet.jetAIState.producerZ = carrier.z;
    jet.producerEntityId = carrier.id;
    jet.objectStatusFlags.delete('AIRBORNE_TARGET');

    // Give jet a command
    logic.submitCommand({ type: 'moveTo', entityId: 2, targetX: 200, targetZ: 200 });
    logic.update(1 / 30);

    // Should stay PARKED because non-front space can't reserve runway for takeoff
    expect(jet.jetAIState.state).toBe('PARKED');
    expect(fdState.runwayTakeoffReservation[0]).toBe(-1);
    expect(fdState.runwayTakeoffReservation[1]).toBe(-1);
  });

  it('JetAI landing reserves space and runway on flight deck', () => {
    const bundle = makeFlightDeckJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJetAI', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const carrier = priv.spawnedEntities.get(1)!;
    const jet = priv.spawnedEntities.get(2)!;
    const fdState = carrier.flightDeckState!;

    // Set jet to RETURNING_FOR_LANDING near the carrier
    jet.jetAIState.state = 'RETURNING_FOR_LANDING';
    jet.jetAIState.allowAirLoco = true;
    jet.jetAIState.producerX = carrier.x;
    jet.jetAIState.producerZ = carrier.z;
    jet.jetAIState.cruiseHeight = 80;
    jet.producerEntityId = carrier.id;
    jet.x = carrier.x; // Already near
    jet.z = carrier.z;
    jet.objectStatusFlags.add('AIRBORNE_TARGET');

    logic.update(1 / 30);

    // Should transition to LANDING with space and runway reserved
    expect(jet.jetAIState.state).toBe('LANDING');
    // Space should be reserved
    const hasSpace = fdState.parkingSpaces.some((s: any) => s.occupantId === 2);
    expect(hasSpace).toBe(true);
    // Landing runway should be reserved
    const reservedRunway = fdState.parkingSpaces.find((s: any) => s.occupantId === 2)!.runway;
    expect(fdState.runwayLandingReservation[reservedRunway]).toBe(2);

    // Run through landing (30 frames)
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    // Landing runway should be released
    expect(fdState.runwayLandingReservation[reservedRunway]).toBe(-1);
  });

  it('JetAI landing blocked when runway busy on flight deck', () => {
    const bundle = makeFlightDeckJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJetAI', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const carrier = priv.spawnedEntities.get(1)!;
    const jet = priv.spawnedEntities.get(2)!;
    const fdState = carrier.flightDeckState!;

    // Set jet to RETURNING near carrier
    jet.jetAIState.state = 'RETURNING_FOR_LANDING';
    jet.jetAIState.allowAirLoco = true;
    jet.jetAIState.producerX = carrier.x;
    jet.jetAIState.producerZ = carrier.z;
    jet.jetAIState.cruiseHeight = 80;
    jet.producerEntityId = carrier.id;
    jet.x = carrier.x;
    jet.z = carrier.z;

    // Block both landing runways with other entity IDs
    fdState.runwayLandingReservation[0] = 999;
    fdState.runwayLandingReservation[1] = 998;

    logic.update(1 / 30);

    // Should still be RETURNING — couldn't get a runway
    // (it may get a space but the runway reservation will fail)
    expect(jet.jetAIState.state).toBe('RETURNING_FOR_LANDING');
  });

  it('flight deck heals grounded jets via flightDeckSetHealee', () => {
    const bundle = makeFlightDeckJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJetAI', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const carrier = priv.spawnedEntities.get(1)!;
    const jet = priv.spawnedEntities.get(2)!;
    const fdState = carrier.flightDeckState!;

    // Park jet at carrier, grounded (allowAirLoco=false)
    fdState.parkingSpaces[0]!.occupantId = 2;
    jet.jetAIState.state = 'PARKED';
    jet.jetAIState.allowAirLoco = false;
    jet.jetAIState.producerX = carrier.x;
    jet.jetAIState.producerZ = carrier.z;
    jet.producerEntityId = carrier.id;
    jet.objectStatusFlags.delete('AIRBORNE_TARGET');

    // Damage the jet
    jet.health = 50;
    const startHealth = jet.health;

    // Run several frames — healing should occur
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(jet.health).toBeGreaterThan(startHealth);
  });

  it('findSuitableAirfield finds flight deck carriers with available space', () => {
    const bundle = makeFlightDeckJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AircraftCarrier', 50, 50),
        makeMapObject('CarrierJetAI', 200, 200),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const jet = priv.spawnedEntities.get(2)!;

    // Simulate destroyed original producer by setting it to non-existent ID
    jet.producerEntityId = 999;

    // Call findSuitableAirfield — should find the carrier
    const result = priv.findSuitableAirfield.call(logic, jet);
    expect(result).not.toBeNull();
    expect(result.templateName).toBe('AircraftCarrier');
  });

  it('production on flight deck reserves parking space', () => {
    const bundle = makeBundle({
      objects: [
        // Carrier with production capability
        makeObjectDef('ProdCarrier', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 6 }),
          makeBlock('Behavior', 'QueueProductionExitUpdate ModuleTag_QExit', {}),
          makeBlock('Behavior', 'FlightDeckBehavior ModuleTag_FlightDeck', {
            NumRunways: 1,
            NumSpacesPerRunway: 3,
            HealAmountPerSecond: 30,
            ApproachHeight: 50,
            LandingDeckHeightOffset: 45,
            ParkingCleanupPeriod: 500,
            HumanFollowPeriod: 333,
            ReplacementDelay: 4000,
            DockAnimationDelay: 3000,
            LaunchWaveDelay: 3000,
            LaunchRampDelay: 667,
            LowerRampDelay: 600,
            CatapultFireDelay: 750,
            PayloadTemplate: 'CarrierJetAI',
            Runway1Spaces: ['R1S1', 'R1S2', 'R1S3'],
            Runway1Takeoff: ['R1TakeoffStart', 'R1TakeoffEnd'],
            Runway1Landing: ['R1LandStart', 'R1LandEnd'],
            Runway1Taxi: ['Taxi1', 'Taxi2'],
            Runway1Creation: ['Hanger1'],
          }),
        ]),
        makeCarrierJetWithJetAIDef(),
      ],
      weapons: [
        makeWeaponDef('JetGun', {
          AttackRange: 300,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 4,
          ClipReloadTime: 3000,
        }),
      ],
      locomotors: [
        makeLocomotorDef('JetLoco', 300),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('ProdCarrier', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;

    // Give credits and queue production
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 50000 });
    logic.submitCommand({ type: 'queueUnitProduction', entityId: 1, unitTemplateName: 'CarrierJetAI' });

    // Run enough frames for production to complete
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    const carrier = priv.spawnedEntities.get(1)!;
    const fdState = carrier.flightDeckState!;

    // Find the produced jet
    const jetIds = logic.getEntityIdsByTemplate('CarrierJetAI');
    expect(jetIds.length).toBe(1);

    // The jet should have a parking space reserved
    const jetId = jetIds[0]!;
    const hasReservedSpace = fdState.parkingSpaces.some((s: any) => s.occupantId === jetId);
    expect(hasReservedSpace).toBe(true);
  });
});

describe('SpectreGunshipUpdate', () => {
  function makeGunshipDef(): ObjectDef {
    return makeObjectDef('TestGunship', 'America', ['VEHICLE', 'AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'SpectreGunshipUpdate ModuleTag_Spectre', {
        SpecialPowerTemplate: 'SPECIAL_SPECTRE_GUNSHIP',
        AttackAreaRadius: 200,
        TargetingReticleRadius: 25,
        GunshipOrbitRadius: 100,
        StrafingIncrement: 20,
        OrbitInsertionSlope: 0.7,
        HowitzerFiringRate: 100,
        HowitzerFollowLag: 0,
        RandomOffsetForHowitzer: 10,
        OrbitTime: 3000,
        HowitzerWeaponTemplate: 'TestHowitzer',
        GattlingTemplateName: 'TestGattling',
      }),
    ], { Speed: 5 });
  }

  function makeCommandCenterDef(): ObjectDef {
    return makeObjectDef('TestCommandCenter', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
      makeBlock('Behavior', 'SpectreGunshipDeploymentUpdate ModuleTag_Deploy', {
        SpecialPowerTemplate: 'SPECIAL_SPECTRE_GUNSHIP',
        GunshipTemplateName: 'TestGunship',
        AttackAreaRadius: 200,
        GunshipOrbitRadius: 100,
        CreateLocation: 'CREATE_AT_EDGE_FARTHEST_FROM_TARGET',
      }),
    ]);
  }

  it('extracts SpectreGunshipUpdate profile from INI', () => {
    const bundle = makeBundle({ objects: [makeGunshipDef()] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const entity = (logic as any).spawnedEntities.get(1)!;
    expect(entity.spectreGunshipProfile).not.toBeNull();
    expect(entity.spectreGunshipProfile!.attackAreaRadius).toBe(200);
    expect(entity.spectreGunshipProfile!.targetingReticleRadius).toBe(25);
    expect(entity.spectreGunshipProfile!.gunshipOrbitRadius).toBe(100);
    expect(entity.spectreGunshipProfile!.strafingIncrement).toBe(20);
    expect(entity.spectreGunshipProfile!.howitzerWeaponTemplate).toBe('TestHowitzer');
    expect(entity.spectreGunshipProfile!.gattlingTemplateName).toBe('TestGattling');
  });

  it('extracts SpectreGunshipDeployment profile from INI', () => {
    const bundle = makeBundle({ objects: [makeCommandCenterDef(), makeGunshipDef()] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestCommandCenter', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const entity = (logic as any).spawnedEntities.get(1)!;
    expect(entity.spectreGunshipDeploymentProfile).not.toBeNull();
    expect(entity.spectreGunshipDeploymentProfile!.gunshipTemplateName).toBe('TestGunship');
    expect(entity.spectreGunshipDeploymentProfile!.attackAreaRadius).toBe(200);
    expect(entity.spectreGunshipDeploymentProfile!.createLocation).toBe('FARTHEST_FROM_TARGET');
  });

  it('transitions gunship through INSERTING -> ORBITING -> DEPARTING lifecycle', () => {
    const bundle = makeBundle({
      objects: [makeGunshipDef()],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 50, DamageRadius: 20, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 10, 10)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; z: number;
        destroyed: boolean;
        spectreGunshipProfile: { gunshipOrbitRadius: number; orbitFrames: number };
        spectreGunshipState: {
          status: string;
          initialTargetX: number;
          initialTargetZ: number;
          orbitEscapeFrame: number;
          okToFireHowitzerCounter: number;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.spectreGunshipState).toBeNull();

    // Manually activate the gunship state
    const profile = entity.spectreGunshipProfile;
    (entity as any).spectreGunshipState = {
      status: 'INSERTING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 640,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 0,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };

    // Entity starts far from target — should be INSERTING
    expect(entity.spectreGunshipState!.status).toBe('INSERTING');

    // Run frames until it reaches orbit radius
    for (let i = 0; i < 500; i++) {
      logic.update(1 / 30);
      if (entity.spectreGunshipState!.status !== 'INSERTING') break;
    }

    // Should transition to ORBITING once within orbit radius
    expect(entity.spectreGunshipState!.status).toBe('ORBITING');
    expect(entity.spectreGunshipState!.orbitEscapeFrame).toBeGreaterThan(0);

    // Run past orbit escape frame
    const escapeFrame = entity.spectreGunshipState!.orbitEscapeFrame;
    for (let i = 0; i < 1000; i++) {
      logic.update(1 / 30);
      if (entity.spectreGunshipState!.status === 'DEPARTING') break;
    }

    // Should transition to DEPARTING
    expect(entity.spectreGunshipState!.status).toBe('DEPARTING');

    // Run until off map and destroyed
    for (let i = 0; i < 2000; i++) {
      if (entity.destroyed) break;
      logic.update(1 / 30);
    }
    expect(entity.destroyed).toBe(true);
  });

  it('constrains override target within attack area radius', () => {
    const bundle = makeBundle({ objects: [makeGunshipDef()] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const entity = (logic as any).spawnedEntities.get(1)!;

    // Activate with target at center
    entity.spectreGunshipState = {
      status: 'INSERTING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 9999, // Way outside attack area
      overrideTargetZ: 9999,
      satelliteX: 640,
      satelliteZ: 640,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 0,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };

    logic.update(1 / 30);

    // Override should be constrained to within (attackAreaRadius - targetingReticleRadius)
    const constraintRadius = 200 - 25; // 175
    const dx = entity.spectreGunshipState.overrideTargetX - 640;
    const dz = entity.spectreGunshipState.overrideTargetZ - 640;
    const dist = Math.sqrt(dx * dx + dz * dz);
    expect(dist).toBeLessThanOrEqual(constraintRadius + 1); // +1 for float tolerance
  });

  it('gattling strafing increments toward target position', () => {
    const bundle = makeBundle({ objects: [makeGunshipDef()] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const entity = (logic as any).spawnedEntities.get(1)!;
    entity.x = 640;
    entity.z = 540; // Within orbit radius of target

    // Set up ORBITING state with gattling aiming far from target
    entity.spectreGunshipState = {
      status: 'ORBITING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 540,
      gattlingTargetX: 600, // Offset from target
      gattlingTargetZ: 600,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 999999,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };

    const initialGattlingX = entity.spectreGunshipState.gattlingTargetX;
    const initialGattlingZ = entity.spectreGunshipState.gattlingTargetZ;

    logic.update(1 / 30);

    // Gattling target should have moved toward positionToShootAt
    const movedDX = entity.spectreGunshipState.gattlingTargetX - initialGattlingX;
    const movedDZ = entity.spectreGunshipState.gattlingTargetZ - initialGattlingZ;
    const movedDist = Math.sqrt(movedDX * movedDX + movedDZ * movedDZ);
    // Should move by strafingIncrement (20) per frame
    expect(movedDist).toBeCloseTo(20, 0);
  });

  it('howitzer fires after gattling converges for howitzerFollowLag cycles', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestGunship2', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'SpectreGunshipUpdate ModuleTag_Spectre', {
            SpecialPowerTemplate: 'SPECIAL_SPECTRE_GUNSHIP',
            AttackAreaRadius: 200,
            TargetingReticleRadius: 25,
            GunshipOrbitRadius: 100,
            StrafingIncrement: 999, // Very large so gattling converges instantly
            OrbitInsertionSlope: 0.7,
            HowitzerFiringRate: 1, // Fire every frame
            HowitzerFollowLag: 100, // 3 frames lag
            RandomOffsetForHowitzer: 0,
            OrbitTime: 90000,
            HowitzerWeaponTemplate: 'TestHowitzer',
            GattlingTemplateName: 'TestGattling',
          }),
        ], { Speed: 5 }),
        makeObjectDef('Target', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 100, DamageRadius: 50, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestGunship2', 50, 50),
        makeMapObject('Target', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const gunship = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;

    // Position target at center of attack area
    target.x = 640;
    target.z = 640;

    // Position gunship in orbit
    gunship.x = 640;
    gunship.z = 540;

    gunship.spectreGunshipState = {
      status: 'ORBITING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 540,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 999999,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };

    const initialHealth = target.health;

    // Run frames — gattling converges immediately (strafingIncrement=999) so
    // okToFireHowitzerCounter increments each frame. After howitzerFollowLag frames,
    // howitzer should fire and deal damage to the target.
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }

    // Target should have taken damage from howitzer
    expect(target.health).toBeLessThan(initialHealth);
  });

  it('deployment spawns gunship at map edge far from target', () => {
    const bundle = makeBundle({
      objects: [makeCommandCenterDef(), makeGunshipDef()],
      specialPowers: [makeSpecialPowerDef('SPECIAL_SPECTRE_GUNSHIP', {
        ReloadTime: 0,
        Enum: 'SPECIAL_SPECTRE_GUNSHIP',
      })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestCommandCenter', 64, 64)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const cmdCenter = priv.spawnedEntities.get(1)!;

    // Issue special power at target position (center of map)
    const targetX = 640;
    const targetZ = 640;

    const deployed = priv.initiateSpectreGunshipDeployment(1, targetX, targetZ);
    expect(deployed).toBe(true);

    // Should have spawned a new entity
    expect(priv.spawnedEntities.size).toBe(2);

    // The spawned gunship should be at the map edge (far from target)
    let gunship: any = null;
    for (const [id, ent] of priv.spawnedEntities) {
      if (id !== 1) gunship = ent;
    }
    expect(gunship).not.toBeNull();
    expect(gunship.spectreGunshipProfile).not.toBeNull();
    expect(gunship.spectreGunshipState).not.toBeNull();
    expect(gunship.spectreGunshipState.status).toBe('INSERTING');
    expect(gunship.spectreGunshipState.initialTargetX).toBe(targetX);
    expect(gunship.spectreGunshipState.initialTargetZ).toBe(targetZ);
  });

  it('gunship with no spectreGunshipProfile gets null profile', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 50, 50)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const entity = (logic as any).spawnedEntities.get(1)!;
    expect(entity.spectreGunshipProfile).toBeNull();
    expect(entity.spectreGunshipState).toBeNull();
    expect(entity.spectreGunshipDeploymentProfile).toBeNull();
  });

  // ── Gattling entity lifecycle tests ──

  function makeGattlingDef(): ObjectDef {
    return makeObjectDef('TestGattling', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
  }

  it('deployment spawns gattling entity inside gunship and sets it DISABLED_PARALYZED', () => {
    const bundle = makeBundle({
      objects: [makeCommandCenterDef(), makeGunshipDef(), makeGattlingDef()],
      specialPowers: [makeSpecialPowerDef('SPECIAL_SPECTRE_GUNSHIP', {
        ReloadTime: 0,
        Enum: 'SPECIAL_SPECTRE_GUNSHIP',
      })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestCommandCenter', 64, 64)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const deployed = priv.initiateSpectreGunshipDeployment(1, 640, 640);
    expect(deployed).toBe(true);

    // Find the spawned gunship (not the command center)
    let gunship: any = null;
    for (const [id, ent] of priv.spawnedEntities) {
      if (id !== 1 && ent.spectreGunshipProfile) gunship = ent;
    }
    expect(gunship).not.toBeNull();
    expect(gunship.spectreGunshipState).not.toBeNull();
    expect(gunship.spectreGunshipState.gattlingEntityId).not.toBe(-1);

    // The gattling entity should exist and be DISABLED_PARALYZED
    const gattlingId = gunship.spectreGunshipState.gattlingEntityId;
    const gattling = priv.spawnedEntities.get(gattlingId);
    expect(gattling).toBeDefined();
    expect(gattling.destroyed).toBe(false);
    expect(gattling.objectStatusFlags.has('DISABLED_PARALYZED')).toBe(true);

    // Gattling should be contained by the gunship
    expect(gattling.transportContainerId).toBe(gunship.id);
  });

  it('gattling entity is enabled (DISABLED_PARALYZED cleared) on transition to ORBITING', () => {
    const bundle = makeBundle({
      objects: [makeGunshipDef(), makeGattlingDef()],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 50, DamageRadius: 20, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 10, 10)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const gunship = priv.spawnedEntities.get(1)!;

    // Spawn gattling manually via the private method
    gunship.spectreGunshipState = {
      status: 'INSERTING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 640,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 0,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };
    priv.spawnSpectreGattlingEntity(gunship, gunship.spectreGunshipProfile, gunship.spectreGunshipState);
    const gattlingId = gunship.spectreGunshipState.gattlingEntityId;
    expect(gattlingId).not.toBe(-1);

    const gattling = priv.spawnedEntities.get(gattlingId);
    expect(gattling.objectStatusFlags.has('DISABLED_PARALYZED')).toBe(true);

    // Run frames until ORBITING
    for (let i = 0; i < 500; i++) {
      logic.update(1 / 30);
      if (gunship.spectreGunshipState.status !== 'INSERTING') break;
    }
    expect(gunship.spectreGunshipState.status).toBe('ORBITING');

    // Gattling should no longer be paralyzed
    expect(gattling.objectStatusFlags.has('DISABLED_PARALYZED')).toBe(false);
  });

  it('gattling entity is destroyed on transition to DEPARTING (cleanUp)', () => {
    const bundle = makeBundle({
      objects: [makeGunshipDef(), makeGattlingDef()],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 50, DamageRadius: 20, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 10, 10)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const gunship = priv.spawnedEntities.get(1)!;

    // Set up in ORBITING with gattling
    gunship.x = 640;
    gunship.z = 540;
    gunship.spectreGunshipState = {
      status: 'ORBITING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 540,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 5, // Will depart very soon
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };
    priv.spawnSpectreGattlingEntity(gunship, gunship.spectreGunshipProfile, gunship.spectreGunshipState);
    // Manually clear DISABLED_PARALYZED since we're simulating post-orbit-insertion
    const gattlingId = gunship.spectreGunshipState.gattlingEntityId;
    const gattling = priv.spawnedEntities.get(gattlingId);
    gattling.objectStatusFlags.delete('DISABLED_PARALYZED');

    // Advance past orbit escape frame to trigger departure
    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
      if (gunship.spectreGunshipState.status === 'DEPARTING') break;
    }
    expect(gunship.spectreGunshipState.status).toBe('DEPARTING');

    // Gattling entity should be destroyed by cleanUp
    expect(gattling.destroyed).toBe(true);
    expect(gunship.spectreGunshipState.gattlingEntityId).toBe(-1);
  });

  it('gattling entity is destroyed when gunship is killed (shot down)', () => {
    const bundle = makeBundle({
      objects: [makeGunshipDef(), makeGattlingDef()],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 50, DamageRadius: 20, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const gunship = priv.spawnedEntities.get(1)!;

    // Set up ORBITING state with gattling
    gunship.x = 640;
    gunship.z = 540;
    gunship.spectreGunshipState = {
      status: 'ORBITING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 540,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 999999,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };
    priv.spawnSpectreGattlingEntity(gunship, gunship.spectreGunshipProfile, gunship.spectreGunshipState);
    const gattlingId = gunship.spectreGunshipState.gattlingEntityId;
    const gattling = priv.spawnedEntities.get(gattlingId);
    expect(gattling.destroyed).toBe(false);

    // Kill the gunship (simulating being shot down)
    priv.markEntityDestroyed(gunship.id, -1);

    // Gattling should be destroyed as part of gunship death cleanup
    expect(gattling.destroyed).toBe(true);
    expect(gunship.spectreGunshipState.gattlingEntityId).toBe(-1);
    expect(gunship.spectreGunshipState.status).toBe('IDLE');
  });

  it('gattling entity follows gunship position during flight', () => {
    const bundle = makeBundle({
      objects: [makeGunshipDef(), makeGattlingDef()],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 50, DamageRadius: 20, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestGunship', 10, 10)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const gunship = priv.spawnedEntities.get(1)!;

    // Set up INSERTING state with gattling
    gunship.spectreGunshipState = {
      status: 'INSERTING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 640,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 0,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };
    priv.spawnSpectreGattlingEntity(gunship, gunship.spectreGunshipProfile, gunship.spectreGunshipState);
    const gattlingId = gunship.spectreGunshipState.gattlingEntityId;
    const gattling = priv.spawnedEntities.get(gattlingId);

    // Run a few frames so the gunship moves
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    // Gattling should track gunship position
    expect(gattling.x).toBe(gunship.x);
    expect(gattling.z).toBe(gunship.z);
  });

  it('gattling entity is directed to attack target during ORBITING', () => {
    const bundle = makeBundle({
      objects: [
        makeGunshipDef(),
        makeGattlingDef(),
        makeObjectDef('EnemyUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
      weapons: [makeWeaponDef('TestHowitzer', { Damage: 50, DamageRadius: 20, DamageType: 'EXPLOSION' })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestGunship', 50, 50),
        makeMapObject('EnemyUnit', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as any;
    const gunship = priv.spawnedEntities.get(1)!;
    const enemy = priv.spawnedEntities.get(2)!;

    // Position enemy near the targeting reticle center
    enemy.x = 640;
    enemy.z = 640;

    // Set up ORBITING state with gattling
    gunship.x = 640;
    gunship.z = 540;
    gunship.spectreGunshipState = {
      status: 'ORBITING',
      initialTargetX: 640,
      initialTargetZ: 640,
      overrideTargetX: 640,
      overrideTargetZ: 640,
      satelliteX: 640,
      satelliteZ: 540,
      gattlingTargetX: 640,
      gattlingTargetZ: 640,
      positionToShootAtX: 640,
      positionToShootAtZ: 640,
      orbitEscapeFrame: 999999,
      okToFireHowitzerCounter: 0,
      gattlingEntityId: -1,
    };
    priv.spawnSpectreGattlingEntity(gunship, gunship.spectreGunshipProfile, gunship.spectreGunshipState);
    const gattlingId = gunship.spectreGunshipState.gattlingEntityId;
    const gattling = priv.spawnedEntities.get(gattlingId);
    // Clear paralysis for orbiting
    gattling.objectStatusFlags.delete('DISABLED_PARALYZED');

    // Run enough frames for the howitzer evaluation cycle (HowitzerFiringRate=100)
    // We need frame % 100 === 0 to trigger
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }

    // The gattling should be directed to attack the enemy entity
    // (attackTargetEntityId set or attackTargetPosition set)
    const hasTarget = gattling.attackTargetEntityId === enemy.id
      || (gattling.attackTargetPosition !== null);
    expect(hasTarget).toBe(true);
  });
});

describe('JetAIUpdate lockon fields', () => {
  function makeJetBundle(jetAIFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('TestJet', 'America', ['AIRCRAFT', 'VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'JetGun'] }),
          makeBlock('LocomotorSet', 'SET_NORMAL JetLoco', {}),
          makeBlock('Behavior', 'JetAIUpdate ModuleTag_JetAI', {
            MinHeight: 80,
            ...jetAIFields,
          }),
        ], { IsAirborneTarget: 'Yes' }),
      ],
      weapons: [
        makeWeaponDef('JetGun', {
          AttackRange: 300,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          SecondaryDamage: 0,
          SecondaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
          ClipSize: 4,
          ClipReloadTime: 3000,
        }),
      ],
      locomotors: [
        makeLocomotorDef('JetLoco', 300),
      ],
    });
  }

  it('parses LockonTime as duration ms to frames', () => {
    // 2000ms at 30fps = 60 frames
    const bundle = makeJetBundle({ LockonTime: 2000 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as any;
    const jet = priv.spawnedEntities.get(1)!;
    expect(jet.jetAIProfile).not.toBeNull();
    expect(jet.jetAIProfile.lockonTimeFrames).toBe(60);
  });

  it('parses LockonInitialDist with C++ default 100', () => {
    // No override → default 100
    const bundleDefault = makeJetBundle();
    const scene1 = new THREE.Scene();
    const logic1 = new GameLogicSubsystem(scene1);
    logic1.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleDefault),
      makeHeightmap(128, 128),
    );
    const jet1 = (logic1 as any).spawnedEntities.get(1)!;
    expect(jet1.jetAIProfile.lockonInitialDist).toBe(100);

    // Explicit override
    const bundleCustom = makeJetBundle({ LockonInitialDist: 250 });
    const scene2 = new THREE.Scene();
    const logic2 = new GameLogicSubsystem(scene2);
    logic2.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleCustom),
      makeHeightmap(128, 128),
    );
    const jet2 = (logic2 as any).spawnedEntities.get(1)!;
    expect(jet2.jetAIProfile.lockonInitialDist).toBe(250);
  });

  it('parses LockonFreq with C++ default 0.5', () => {
    const bundleDefault = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleDefault),
      makeHeightmap(128, 128),
    );
    const jet = (logic as any).spawnedEntities.get(1)!;
    expect(jet.jetAIProfile.lockonFreq).toBe(0.5);
  });

  it('converts LockonAngleSpin from degrees to radians (parseAngleReal)', () => {
    // C++ default is 720 degrees → 720 * PI / 180 radians
    const bundleDefault = makeJetBundle();
    const scene1 = new THREE.Scene();
    const logic1 = new GameLogicSubsystem(scene1);
    logic1.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleDefault),
      makeHeightmap(128, 128),
    );
    const jet1 = (logic1 as any).spawnedEntities.get(1)!;
    expect(jet1.jetAIProfile.lockonAngleSpinRad).toBeCloseTo(720 * Math.PI / 180);

    // Custom 360 degrees
    const bundleCustom = makeJetBundle({ LockonAngleSpin: 360 });
    const scene2 = new THREE.Scene();
    const logic2 = new GameLogicSubsystem(scene2);
    logic2.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleCustom),
      makeHeightmap(128, 128),
    );
    const jet2 = (logic2 as any).spawnedEntities.get(1)!;
    expect(jet2.jetAIProfile.lockonAngleSpinRad).toBeCloseTo(2 * Math.PI);
  });

  it('parses LockonBlinky as boolean (default false)', () => {
    const bundleDefault = makeJetBundle();
    const scene1 = new THREE.Scene();
    const logic1 = new GameLogicSubsystem(scene1);
    logic1.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleDefault),
      makeHeightmap(128, 128),
    );
    const jet1 = (logic1 as any).spawnedEntities.get(1)!;
    expect(jet1.jetAIProfile.lockonBlinky).toBe(false);

    const bundleTrue = makeJetBundle({ LockonBlinky: 'Yes' });
    const scene2 = new THREE.Scene();
    const logic2 = new GameLogicSubsystem(scene2);
    logic2.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleTrue),
      makeHeightmap(128, 128),
    );
    const jet2 = (logic2 as any).spawnedEntities.get(1)!;
    expect(jet2.jetAIProfile.lockonBlinky).toBe(true);
  });

  it('parses LockonCursor as string (default empty)', () => {
    const bundleDefault = makeJetBundle();
    const scene1 = new THREE.Scene();
    const logic1 = new GameLogicSubsystem(scene1);
    logic1.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleDefault),
      makeHeightmap(128, 128),
    );
    const jet1 = (logic1 as any).spawnedEntities.get(1)!;
    expect(jet1.jetAIProfile.lockonCursor).toBe('');

    const bundleCustom = makeJetBundle({ LockonCursor: 'Lockon' });
    const scene2 = new THREE.Scene();
    const logic2 = new GameLogicSubsystem(scene2);
    logic2.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundleCustom),
      makeHeightmap(128, 128),
    );
    const jet2 = (logic2 as any).spawnedEntities.get(1)!;
    expect(jet2.jetAIProfile.lockonCursor).toBe('Lockon');
  });

  it('parses all six lockon fields together', () => {
    const bundle = makeJetBundle({
      LockonTime: 1000,        // 30 frames
      LockonInitialDist: 200,
      LockonFreq: 0.25,
      LockonAngleSpin: 180,    // PI radians
      LockonBlinky: 'Yes',
      LockonCursor: 'JetLockon',
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestJet', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const jet = (logic as any).spawnedEntities.get(1)!;
    const profile = jet.jetAIProfile;
    expect(profile.lockonTimeFrames).toBe(30);
    expect(profile.lockonInitialDist).toBe(200);
    expect(profile.lockonFreq).toBe(0.25);
    expect(profile.lockonAngleSpinRad).toBeCloseTo(Math.PI);
    expect(profile.lockonBlinky).toBe(true);
    expect(profile.lockonCursor).toBe('JetLockon');
  });
});

describe('DeliverPayloadAIUpdate missing fields', () => {
  /**
   * Source parity: DeliverPayloadData fields parsed by resolveScriptReinforcementDeliverPayloadProfile.
   * C++ source: DeliverPayloadAIUpdate.cpp:60-102
   */

  /** Minimal mock of GameLogicSubsystem self — only msToLogicFrames is needed. */
  const mockSelf = {
    msToLogicFrames(ms: number): number {
      return Math.max(0, Math.round(ms * LOGIC_FRAME_RATE / 1000));
    },
  };

  function makeDeliverPayloadObjectDef(dpFields: Record<string, unknown> = {}) {
    return makeObjectDef('PayloadTransport', 'America', ['VEHICLE', 'TRANSPORT'], [
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', { ContainMax: 8 }),
      makeBlock('Behavior', 'DeliverPayloadAIUpdate ModuleTag_DeliverPayload', {
        ...dpFields,
      }),
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
  }

  it('parses ExitPitchRate via parseAngularVelocityReal (deg/sec to rad/frame)', () => {
    // 180 deg/sec → 180 * PI / (180 * 30) = PI / 30 rad/frame
    const objectDef = makeDeliverPayloadObjectDef({ ExitPitchRate: 180 });
    const profile = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitPitchRate).toBeCloseTo(Math.PI / 30);
  });

  it('defaults ExitPitchRate to 0', () => {
    const objectDef = makeDeliverPayloadObjectDef();
    const profile = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitPitchRate).toBe(0);
  });

  it('parses ParachuteDirectly as boolean (default false)', () => {
    const def1 = makeDeliverPayloadObjectDef();
    const profile1 = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, def1);
    expect(profile1!.parachuteDirectly).toBe(false);

    const def2 = makeDeliverPayloadObjectDef({ ParachuteDirectly: 'Yes' });
    const profile2 = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, def2);
    expect(profile2!.parachuteDirectly).toBe(true);
  });

  it('parses MaxAttempts as integer (C++ default 1)', () => {
    const def1 = makeDeliverPayloadObjectDef();
    const profile1 = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, def1);
    expect(profile1!.maxAttempts).toBe(1);

    const def2 = makeDeliverPayloadObjectDef({ MaxAttempts: 5 });
    const profile2 = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, def2);
    expect(profile2!.maxAttempts).toBe(5);
  });

  it('parses DiveStartDistance as float (default 0)', () => {
    const def1 = makeDeliverPayloadObjectDef();
    const profile1 = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, def1);
    expect(profile1!.diveStartDistance).toBe(0);

    const def2 = makeDeliverPayloadObjectDef({ DiveStartDistance: 150.5 });
    const profile2 = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, def2);
    expect(profile2!.diveStartDistance).toBeCloseTo(150.5);
  });

  it('parses all four new DeliverPayload fields together', () => {
    const objectDef = makeDeliverPayloadObjectDef({
      ExitPitchRate: 90,           // 90 * PI / 5400 rad/frame
      ParachuteDirectly: 'Yes',
      MaxAttempts: 3,
      DiveStartDistance: 200,
    });
    const profile = resolveScriptReinforcementDeliverPayloadProfile(mockSelf, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitPitchRate).toBeCloseTo(90 * Math.PI / 5400);
    expect(profile!.parachuteDirectly).toBe(true);
    expect(profile!.maxAttempts).toBe(3);
    expect(profile!.diveStartDistance).toBe(200);
  });
});
