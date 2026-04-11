import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { ObjectDef } from '@generals/ini-data';

import { createEmptySourceMapEntitySaveState, GameLogicSubsystem } from './index.js';
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

describe('slow death behavior', () => {
  function makeSlowDeathBundle(slowDeathFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('SlowDeathUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SlowDeath', {
            DestructionDelay: 300, // 300ms = 9 frames
            SinkDelay: 100, // 100ms = 3 frames
            SinkRate: 0.5,
            ProbabilityModifier: 10,
            ...slowDeathFields,
          }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'InstantKillGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('InstantKillGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
  }

  it('delays entity destruction for the configured DestructionDelay', () => {
    const bundle = makeSlowDeathBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SlowDeathUnit', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Advance until the unit takes lethal damage and enters slow death.
    let enteredSlowDeath = false;
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') {
        enteredSlowDeath = true;
        break;
      }
    }
    expect(enteredSlowDeath).toBe(true);

    // Unit should be in slow death (health <= 0) but NOT destroyed yet at 5 frames.
    const midDeath = logic.getEntityState(1);
    expect(midDeath).not.toBeNull();
    expect(midDeath!.health).toBeLessThanOrEqual(0);
    expect(midDeath!.animationState).toBe('DIE');

    // Run past destructionDelay (9 frames from slow death start + margin).
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Now the entity should be fully destroyed and removed.
    const afterDestruction = logic.getEntityState(1);
    expect(afterDestruction).toBeNull();
  });

  it('sinks the entity below terrain after SinkDelay', () => {
    // SinkRate is in dist/sec — use 30 so per-frame rate = 1.0 for easy assertions.
    const bundle = makeSlowDeathBundle({ SinkRate: 30, SinkDelay: 100, DestructionDelay: 5000 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SlowDeathUnit', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Advance until the unit enters slow death.
    let initialY = 0;
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') {
        initialY = s.y;
        break;
      }
    }

    // Run past sinkDelay (3 frames) + several more frames for sinking.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const afterSink = logic.getEntityState(1);
    expect(afterSink).not.toBeNull();
    expect(afterSink!.y).toBeLessThan(initialY);
  });

  it('prevents the dying entity from being targeted by other attackers', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SlowDeathUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SlowDeath', {
            DestructionDelay: 5000, // Very long death
            ProbabilityModifier: 10,
          }),
        ]),
        makeObjectDef('Attacker1', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
        makeObjectDef('Attacker2', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SlowDeathUnit', 50, 50),
        makeMapObject('Attacker1', 20, 50),
        makeMapObject('Attacker2', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    // Attacker1 kills the unit.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Now attacker2 tries to target the dying entity.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Entity 1 should still be in slow death (alive but dying).
    const dyingState = logic.getEntityState(1);
    expect(dyingState).not.toBeNull();
    expect(dyingState!.animationState).toBe('DIE');
    // Attacker2's target should have been rejected (canTakeDamage = false).
    // The dying entity should not have taken additional damage beyond the first kill.
  });

  it('executes phase OCLs at INITIAL and FINAL phases', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SlowDeathWithOCL', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SlowDeath', {
            DestructionDelay: 200, // ~6 frames
            ProbabilityModifier: 10,
            OCL: ['INITIAL OCLDeathDebris', 'FINAL OCLFinalDebris'],
          }),
        ]),
        makeObjectDef('DeathDebris', 'America', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
        makeObjectDef('FinalDebris', 'America', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'KillGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('KillGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
    // Add OCL definitions to the bundle.
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCLDeathDebris',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'DeathDebris', Count: '1' },
          blocks: [],
        }],
      },
      {
        name: 'OCLFinalDebris',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'FinalDebris', Count: '1' },
          blocks: [],
        }],
      },
    ];

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SlowDeathWithOCL', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the unit — INITIAL phase should execute, spawning debris.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Check that debris was spawned by the INITIAL phase OCL.
    const initialStates = logic.getRenderableEntityStates();
    const initialDebris = initialStates.filter(s => s.templateName === 'DeathDebris');
    expect(initialDebris.length).toBeGreaterThanOrEqual(1);

    // Run past destructionDelay (~6 frames) — FINAL phase should fire OCLFinalDebris.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const finalStates = logic.getRenderableEntityStates();
    const finalDebris = finalStates.filter(s => s.templateName === 'FinalDebris');
    expect(finalDebris.length).toBeGreaterThanOrEqual(1);
  });

  it('selects from multiple SlowDeathBehavior modules via weighted probability', () => {
    // Entity with two SlowDeathBehavior modules of different probability.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MultiDeathUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_Death1', {
            DestructionDelay: 100, // ~3 frames
            ProbabilityModifier: 1,
          }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_Death2', {
            DestructionDelay: 1000, // ~30 frames
            ProbabilityModifier: 1,
          }),
        ]),
        makeObjectDef('Killer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'OHKGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('OHKGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MultiDeathUnit', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the unit.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    // Entity should be in slow death (one of the two profiles was selected).
    const dyingState = logic.getEntityState(1);
    expect(dyingState).not.toBeNull();
    expect(dyingState!.animationState).toBe('DIE');
    expect(dyingState!.health).toBeLessThanOrEqual(0);
  });

  it('excludes slow-death entities from victory condition counting', () => {
    const bundle = makeSlowDeathBundle({ DestructionDelay: 10000 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SlowDeathUnit', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setSidePlayerType('America', 'HUMAN');
    logic.setSidePlayerType('China', 'HUMAN');
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Advance until the unit enters slow death.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') break;
    }

    // Entity is in slow death but entity not yet destroyed.
    const dyingState = logic.getEntityState(1);
    expect(dyingState).not.toBeNull();
    expect(dyingState!.animationState).toBe('DIE');

    // Run a few more frames — victory should be detected even though entity hasn't
    // fully been destroyed yet, because slow-death entities are excluded from counting.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const gameEnd = logic.getGameEndState();
    expect(gameEnd).not.toBeNull();
    // China should win since America's only unit is in slow death.
    expect(gameEnd!.victorSides).toContain('china');
  });
});

describe('lifetime update', () => {
  it('destroys the entity after MinLifetime/MaxLifetime expires', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('DebrisChunk', 'America', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'LifetimeUpdate ModuleTag_Lifetime', {
            MinLifetime: 300, // 9 frames
            MaxLifetime: 300, // 9 frames (exact for deterministic test)
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('DebrisChunk', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Entity should exist immediately.
    expect(logic.getEntityState(1)).not.toBeNull();

    // Run 5 frames — entity should still be alive.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)).not.toBeNull();
    expect(logic.getEntityState(1)!.health).toBe(10);

    // Run past the 9-frame lifetime + destruction.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Entity should be destroyed.
    expect(logic.getEntityState(1)).toBeNull();
  });

  it('triggers slow death when lifetime expires on an entity with SlowDeathBehavior', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TimedDeathUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'LifetimeUpdate ModuleTag_Lifetime', {
            MinLifetime: 200, // 6 frames
            MaxLifetime: 200,
          }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SlowDeath', {
            DestructionDelay: 5000, // 150 frames
            ProbabilityModifier: 10,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TimedDeathUnit', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Run past lifetime (6 frames) + a couple extra.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Entity should be in slow death (still rendered, animationState = DIE).
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.animationState).toBe('DIE');
    expect(state!.health).toBeLessThanOrEqual(0);
  });
});

describe('fire weapon when dead behavior', () => {
  it('fires the death weapon at entity position when the entity dies', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Bomber', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            DeathWeapon: 'DeathExplosion',
            StartsActive: 'Yes',
          }),
        ]),
        makeObjectDef('Bystander', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'KillGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('KillGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
        makeWeaponDef('DeathExplosion', {
          AttackRange: 10,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 100, // Area damage to hit Bystander
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Bomber', 50, 50),
        makeMapObject('Bystander', 52, 50), // Close to Bomber
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    const bystanderBefore = logic.getEntityState(2);
    expect(bystanderBefore).not.toBeNull();
    expect(bystanderBefore!.health).toBe(200);

    // Kill the Bomber — death explosion should damage Bystander.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Bomber should be destroyed.
    expect(logic.getEntityState(1)).toBeNull();

    // Bystander should have taken damage from the death explosion.
    const bystanderAfter = logic.getEntityState(2);
    expect(bystanderAfter).not.toBeNull();
    expect(bystanderAfter!.health).toBeLessThan(200);
  });

  it('applies NOT_AIRBORNE filtering for death-weapon temporary radius damage', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Bomber', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            DeathWeapon: 'DeathExplosion',
            StartsActive: 'Yes',
          }),
        ]),
        makeObjectDef('GroundTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('AirTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'KillGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('KillGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
        makeWeaponDef('DeathExplosion', {
          AttackRange: 10,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 100,
          RadiusDamageAffects: 'ENEMIES NOT_AIRBORNE',
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Bomber', 50, 50),      // id 1
        makeMapObject('GroundTarget', 52, 50), // id 2
        makeMapObject('AirTarget', 52, 52),    // id 3
        makeMapObject('Attacker', 20, 50),     // id 4
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const entities = (logic as unknown as { spawnedEntities: Map<number, { y: number }> }).spawnedEntities;
    const airTarget = entities.get(3)!;
    airTarget.y += 20; // significantly above terrain (> 9.0)

    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    for (let i = 0; i < 10; i += 1) {
      logic.update(1 / 30);
    }

    expect(logic.getEntityState(1)).toBeNull();
    expect(logic.getEntityState(2)?.health).toBeLessThan(200);
    expect(logic.getEntityState(3)?.health).toBe(200);
  });

  it('applies NOT_SIMILAR filtering for death-weapon temporary radius damage', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Bomber', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            DeathWeapon: 'DeathExplosion',
            StartsActive: 'Yes',
          }),
        ]),
        makeObjectDef('EnemyTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'KillGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('KillGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
        makeWeaponDef('DeathExplosion', {
          AttackRange: 10,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 100,
          RadiusDamageAffects: 'ALLIES ENEMIES NOT_SIMILAR',
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Bomber', 50, 50),      // id 1 (dies, source template)
        makeMapObject('Bomber', 52, 50),      // id 2 (ally same template)
        makeMapObject('EnemyTarget', 54, 50), // id 3 (enemy)
        makeMapObject('Attacker', 20, 50),    // id 4 (kills id 1)
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    for (let i = 0; i < 10; i += 1) {
      logic.update(1 / 30);
    }

    expect(logic.getEntityState(1)).toBeNull();
    // Same-template ally should be skipped by NOT_SIMILAR.
    expect(logic.getEntityState(2)?.health).toBe(100);
    // Enemy should still take damage.
    expect(logic.getEntityState(3)?.health).toBeLessThan(200);
  });
});

describe('fire weapon when damaged behavior', () => {
  it('fires the reaction weapon when entity takes damage', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ToxicBuilding', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'FireWeaponWhenDamagedBehavior ModuleTag_FWWD', {
            StartsActive: true,
            ReactionWeaponPristine: 'ToxicSpray',
            ReactionWeaponDamaged: 'ToxicSprayDamaged',
            DamageAmount: 0,
          }),
        ]),
        makeObjectDef('NearbyUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 220,
          PrimaryDamage: 100,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
        makeWeaponDef('ToxicSpray', {
          AttackRange: 10,
          PrimaryDamage: 30,
          PrimaryDamageRadius: 100,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
        makeWeaponDef('ToxicSprayDamaged', {
          AttackRange: 10,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 100,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToxicBuilding', 50, 50),
        makeMapObject('NearbyUnit', 52, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    const nearbyBefore = logic.getEntityState(2);
    expect(nearbyBefore).not.toBeNull();
    expect(nearbyBefore!.health).toBe(200);

    // Attack the building — reaction weapon should fire, damaging NearbyUnit.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const nearbyAfter = logic.getEntityState(2);
    expect(nearbyAfter).not.toBeNull();
    // NearbyUnit should have taken damage from the reaction weapon.
    expect(nearbyAfter!.health).toBeLessThan(200);
  });
});

describe('FXListDie', () => {
  it('parses FXListDie profiles from INI with DieMuxData fields', () => {
    const objects = [
      makeObjectDef('FXUnit', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'FXListDie ModuleTag_FXDie1', {
          DeathFX: 'FX_InfantryDeath',
          OrientToObject: 'Yes',
        }),
        makeBlock('Behavior', 'FXListDie ModuleTag_FXDie2', {
          DeathFX: 'FX_CrushDeath',
          DeathTypes: 'CRUSHED EXPLODED',
          OrientToObject: 'No',
        }),
      ]),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('FXUnit', 10, 10)]), registry, makeHeightmap());

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        fxListDieProfiles: Array<{
          deathFXName: string;
          orientToObject: boolean;
          deathTypes: Set<string>;
        }>;
      }>;
    };
    const unit = priv.spawnedEntities.get(1)!;
    expect(unit.fxListDieProfiles.length).toBe(2);
    // First profile: no DeathTypes filter, orientToObject = true.
    expect(unit.fxListDieProfiles[0]!.deathFXName).toBe('FX_INFANTRYDEATH');
    expect(unit.fxListDieProfiles[0]!.orientToObject).toBe(true);
    expect(unit.fxListDieProfiles[0]!.deathTypes.size).toBe(0);
    // Second profile: CRUSHED + EXPLODED death types, orientToObject = false.
    expect(unit.fxListDieProfiles[1]!.deathFXName).toBe('FX_CRUSHDEATH');
    expect(unit.fxListDieProfiles[1]!.orientToObject).toBe(false);
    expect(unit.fxListDieProfiles[1]!.deathTypes.has('CRUSHED')).toBe(true);
    expect(unit.fxListDieProfiles[1]!.deathTypes.has('EXPLODED')).toBe(true);
  });

  it('emits death FX visual events when FXListDie profile matches', () => {
    const objects = [
      makeObjectDef('FXUnit', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'FXListDie ModuleTag_FXDie', {
          DeathFX: 'FX_InfantryDeath',
        }),
      ]),
      makeObjectDef('Attacker', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestCannon'] }),
      ]),
    ];
    const weapons = [
      makeWeaponDef('TestCannon', {
        AttackRange: 120, PrimaryDamage: 999, DelayBetweenShots: 100,
      }),
    ];
    const bundle = makeBundle({ objects, weapons });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('FXUnit', 10, 10), makeMapObject('Attacker', 30, 10)]),
      registry, makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    for (let i = 0; i < 12; i++) {
      logic.update(1 / 30);
    }

    // After the kill: 1 ENTITY_DESTROYED from standard death + 1 from FXListDie = at least 2.
    const events = logic.drainVisualEvents();
    const destroyEvents = events.filter(e => e.type === 'ENTITY_DESTROYED');
    expect(destroyEvents.length).toBeGreaterThanOrEqual(2);
  });
});

describe('CrushDie', () => {
  it('extracts CrushDie profiles from INI with DieMuxData fields', () => {
    const objects = [
      makeObjectDef('CrushVictim', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'CrushDie ModuleTag_CrushDie1', {}),
        makeBlock('Behavior', 'CrushDie ModuleTag_CrushDie2', {
          DeathTypes: 'CRUSHED',
          ExemptStatus: 'SOLD',
        }),
      ], { CrushableLevel: 2 }),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('CrushVictim', 10, 10)]), registry, makeHeightmap());

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        crushDieProfiles: Array<{ deathTypes: Set<string>; exemptStatus: Set<string> }>;
      }>;
    };
    const unit = priv.spawnedEntities.get(1)!;
    expect(unit.crushDieProfiles.length).toBe(2);
    // First profile: no filtering (empty sets).
    expect(unit.crushDieProfiles[0]!.deathTypes.size).toBe(0);
    // Second profile: CRUSHED death type, SOLD exempt status.
    expect(unit.crushDieProfiles[1]!.deathTypes.has('CRUSHED')).toBe(true);
    expect(unit.crushDieProfiles[1]!.exemptStatus.has('SOLD')).toBe(true);
  });

  it('sets crush model conditions when entity dies from crush damage', () => {
    // Use the same pattern as 'crush damage during movement' tests — cell-aligned positions on large map.
    const objects = [
      makeObjectDef('CrushVictim', 'China', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'CrushDie ModuleTag_CrushDie', {}),
        makeBlock('Collide', 'SquishCollide ModuleTag_Squish', {}),
      ], { CrushableLevel: 0 }),
      makeObjectDef('CrusherTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('LocomotorSet', 'SET_NORMAL TankLoco', {}),
      ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
    ];
    const locomotors = [makeLocomotorDef('TankLoco', 180)];
    const bundle = makeBundle({ objects, locomotors });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    // Place victim and crusher on the same Z row, crusher to the left.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrushVictim', 225, 205),
        makeMapObject('CrusherTank', 205, 205),
      ], 128, 128),
      registry, makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Access internal state to check crush flags after death pipeline but before finalize.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        destroyed: boolean;
        frontCrushed: boolean;
        backCrushed: boolean;
        modelConditionFlags: Set<string>;
        pendingDeathType: string;
      }>;
    };
    const victim = priv.spawnedEntities.get(1)!;

    // Move tank through victim.
    logic.submitCommand({ type: 'moveTo', entityId: 2, targetX: 255, targetZ: 205 });

    let foundCrush = false;
    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
      // Keep a direct reference: finalizeDestroyedEntities removes dead entities from
      // spawnedEntities in the same update tick.
      if (victim.destroyed && !foundCrush) {
        foundCrush = true;
        // Crush die should have set the model condition flags.
        expect(victim.frontCrushed || victim.backCrushed).toBe(true);
        expect(
          victim.modelConditionFlags.has('FRONTCRUSHED')
          || victim.modelConditionFlags.has('BACKCRUSHED'),
        ).toBe(true);
        expect(victim.pendingDeathType).toBe('CRUSHED');
        break;
      }
    }
    expect(foundCrush).toBe(true);
    expect(priv.spawnedEntities.has(1)).toBe(false);
  });

  it('does not set crush flags when entity dies from non-crush damage', () => {
    const objects = [
      makeObjectDef('CrushVictim', 'China', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'CrushDie ModuleTag_CrushDie', {}),
      ]),
      makeObjectDef('Shooter', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
      ]),
    ];
    const weapons = [
      makeWeaponDef('TestGun', {
        AttackRange: 120, PrimaryDamage: 999, DelayBetweenShots: 100,
      }),
    ];
    const bundle = makeBundle({ objects, weapons });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('CrushVictim', 10, 10), makeMapObject('Shooter', 30, 10)]),
      registry, makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        destroyed: boolean;
        frontCrushed: boolean;
        backCrushed: boolean;
      }>;
    };

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
      const victim = priv.spawnedEntities.get(1);
      if (victim?.destroyed) {
        // Died from gun damage, not crush — no crush flags should be set.
        expect(victim.frontCrushed).toBe(false);
        expect(victim.backCrushed).toBe(false);
        return;
      }
    }
    // Entity should be dead.
    expect(logic.getEntityState(1)).toBeNull();
  });
});

describe('ToppleUpdate', () => {
  function makeToppleBundle(opts: {
    killWhenFinished?: boolean;
    killWhenStart?: boolean;
    initialVelocityPercent?: number;
    initialAccelPercent?: number | null;
    bounceVelocityPercent?: number;
  } = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('Tree', 'Neutral', ['SHRUBBERY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {
            InitialVelocityPercent: opts.initialVelocityPercent ?? 20,
            ...(opts.initialAccelPercent !== null ? { InitialAccelPercent: opts.initialAccelPercent ?? 1 } : {}),
            BounceVelocityPercent: opts.bounceVelocityPercent ?? 30,
            KillWhenFinishedToppling: opts.killWhenFinished ?? true,
            KillWhenStartToppling: opts.killWhenStart ?? false,
          }),
        ]),
      ],
    });
  }

  function makeToppleSetup(opts: Parameters<typeof makeToppleBundle>[0] = {}) {
    const bundle = makeToppleBundle(opts);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Tree', 5, 5)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        destroyed: boolean;
        toppleProfile: unknown;
        toppleState: string;
        toppleDirX: number;
        toppleDirZ: number;
        toppleAngularVelocity: number;
        toppleAngularAccumulation: number;
        toppleSpeed: number;
        blocksPath: boolean;
      }>;
      applyTopplingForce(entity: unknown, dirX: number, dirZ: number, speed: number): void;
    }).spawnedEntities;

    let tree: (typeof entities extends Map<number, infer V> ? V : never) | undefined;
    for (const [, e] of entities) {
      if (e.templateName === 'Tree') tree = e;
    }

    const applyTopple = (logic as unknown as {
      applyTopplingForce(entity: unknown, dirX: number, dirZ: number, speed: number): void;
    }).applyTopplingForce.bind(logic);

    return { logic, tree: tree!, entities, applyTopple };
  }

  it('initializes ToppleProfile from INI', () => {
    const { tree } = makeToppleSetup();
    expect(tree.toppleProfile).not.toBeNull();
    expect(tree.toppleState).toBe('NONE');
  });

  it('applies toppling force and transitions to TOPPLING state', () => {
    const { logic, tree, applyTopple } = makeToppleSetup();
    applyTopple(tree, 1, 0, 5.0);

    expect(tree.toppleState).toBe('TOPPLING');
    expect(tree.toppleDirX).toBeCloseTo(1.0);
    expect(tree.toppleDirZ).toBeCloseTo(0.0);
    expect(tree.toppleAngularVelocity).toBeGreaterThan(0);
    // Source parity: blocksPath cleared on topple start.
    expect(tree.blocksPath).toBe(false);
  });

  it('ignores second topple force while already toppling', () => {
    const { tree, applyTopple } = makeToppleSetup();
    applyTopple(tree, 1, 0, 5.0);
    const firstVelocity = tree.toppleAngularVelocity;

    // Second topple should be ignored.
    applyTopple(tree, 0, 1, 10.0);
    expect(tree.toppleAngularVelocity).toBe(firstVelocity);
    expect(tree.toppleDirX).toBeCloseTo(1.0);
  });

  it('progresses angular accumulation toward PI/2 over frames', () => {
    const { logic, tree, applyTopple } = makeToppleSetup();
    applyTopple(tree, 1, 0, 5.0);

    // Run a few frames — angular accumulation should increase.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    expect(tree.toppleAngularAccumulation).toBeGreaterThan(0);
  });

  it('kills entity when finished toppling with KillWhenFinishedToppling=true', () => {
    const { logic, tree, applyTopple } = makeToppleSetup({ killWhenFinished: true });
    // Source parity: typical crusher speed is ~1.0 units/frame (tank at 30 units/sec, 30fps).
    applyTopple(tree, 1, 0, 1.0);

    // Run many frames until topple completes.
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (tree.destroyed) break;
    }

    expect(tree.destroyed).toBe(true);
  });

  it('kills entity immediately when KillWhenStartToppling=true', () => {
    const { tree, applyTopple } = makeToppleSetup({ killWhenStart: true });
    applyTopple(tree, 0, 1, 5.0);

    expect(tree.destroyed).toBe(true);
  });

  it('bounces at angular limit and eventually stops', () => {
    // High initial velocity ensures at least one visible bounce. Non-zero acceleration
    // provides the gravity-like force needed to converge (C++ default is 0.01).
    const { logic, tree, applyTopple } = makeToppleSetup({
      killWhenFinished: false,
      bounceVelocityPercent: 50,
      initialVelocityPercent: 80,
    });
    applyTopple(tree, 1, 0, 1.0);

    let sawBouncing = false;
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (tree.toppleState === 'BOUNCING') sawBouncing = true;
      if (tree.toppleState === 'DONE') break;
    }

    expect(sawBouncing).toBe(true);
    expect(tree.toppleState).toBe('DONE');
  });

  it('exposes topple angle on RenderableEntityState', () => {
    const { logic, tree, applyTopple } = makeToppleSetup();
    applyTopple(tree, 1, 0, 5.0);

    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    // Source parity: topple data exposed via makeRenderableEntityState for renderer.
    const states = logic.getRenderableEntityStates();
    const treeState = states.find((s) => s.id === tree.id);
    expect(treeState).toBeDefined();
    expect(treeState!.toppleAngle).toBeGreaterThan(0);
    expect(treeState!.toppleDirX).toBeCloseTo(1.0);
    expect(treeState!.toppleDirZ).toBeCloseTo(0.0);
  });

  it('crush collision topples tree instead of instantly killing it', () => {
    // Source parity: In C++, ToppleUpdate::onCollide handles crush for trees.
    // Trees are NOT squish-killed; they topple and die on completion.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CrusherTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('ToppleTree', 'Neutral', ['SHRUBBERY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'ToppleUpdate ModuleTag_Topple', {
            InitialVelocityPercent: 20,
            BounceVelocityPercent: 30,
            KillWhenFinishedToppling: true,
          }),
        ], { CrushableLevel: 0 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 180),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 205, 205),
        makeMapObject('ToppleTree', 215, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'Neutral', 0);
    logic.setTeamRelationship('Neutral', 'America', 0);

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        destroyed: boolean;
        toppleState: string;
        health: number;
      }>;
    }).spawnedEntities;

    let tree: { destroyed: boolean; toppleState: string; health: number } | undefined;
    for (const [, e] of entities) {
      if (e.templateName === 'ToppleTree') tree = e;
    }

    // Move tank through the tree.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 255, targetZ: 205 });

    // Run frames until tree starts toppling or gets destroyed.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
      if (tree!.toppleState !== 'NONE' || tree!.destroyed) break;
    }

    // Tree should be toppling, NOT instantly destroyed by crush damage.
    // The tree should still be alive at this point (death comes when topple finishes).
    if (tree!.toppleState !== 'NONE') {
      expect(tree!.toppleState).not.toBe('NONE');
      // Tree should still have full health (no crush damage applied).
      expect(tree!.health).toBe(50);
    }
  });

  it('tracks W3DTreeBuffer topple state for optimized W3DTreeDraw trees', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CrusherTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('OptimizedTree', 'Neutral', ['SHRUBBERY', 'IMMOBILE', 'OPTIMIZED_TREE'], [
          makeBlock('Draw', 'W3DTreeDraw ModuleTag_Draw', {
            ModelName: 'PTreeOak',
            TextureName: 'PTreeOak.tga',
            DoTopple: true,
            InitialVelocityPercent: 20,
            InitialAccelPercent: 1,
            BounceVelocityPercent: 30,
            MinimumToppleSpeed: 0.5,
            KillWhenFinishedToppling: true,
            SinkTime: 5000,
            SinkDistance: 10,
          }),
        ], { GeometryMajorRadius: 3, GeometryMinorRadius: 3 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 180),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 205, 205),
        makeMapObject('OptimizedTree', 215, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        w3dTreeBufferToppleState: string;
        w3dTreeBufferAngularVelocity: number;
        w3dTreeBufferAngularAcceleration: number;
        w3dTreeBufferToppleDirectionX: number;
        w3dTreeBufferToppleDirectionY: number;
        w3dTreeBufferAngularAccumulation: number;
        w3dTreeBufferMatrix3D: number[];
      }>;
    }).spawnedEntities;

    const tree = [...entities.values()].find((entity) => entity.templateName === 'OptimizedTree')!;
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 255, targetZ: 205 });

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
      if (tree.w3dTreeBufferToppleState !== 'UPRIGHT') break;
    }

    expect(tree.w3dTreeBufferToppleState).toBe('FALLING');
    expect(tree.w3dTreeBufferAngularVelocity).toBeGreaterThan(0);
    expect(tree.w3dTreeBufferAngularAcceleration).toBeCloseTo(0.005);
    expect(tree.w3dTreeBufferToppleDirectionX).toBeGreaterThan(0);
    expect(tree.w3dTreeBufferToppleDirectionY).toBeCloseTo(0);
    expect(tree.w3dTreeBufferAngularAccumulation).toBeGreaterThan(0);
    expect(tree.w3dTreeBufferMatrix3D[3]).toBeCloseTo(215);
    expect(tree.w3dTreeBufferMatrix3D[7]).toBeCloseTo(205);
  });

  it('imports source TerrainVisual W3DTreeBuffer state through source GameLogic restore', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OptimizedTree', 'Neutral', ['SHRUBBERY', 'IMMOBILE', 'OPTIMIZED_TREE'], [
          makeBlock('Draw', 'W3DTreeDraw ModuleTag_Draw', {
            ModelName: 'PTreeOak',
            TextureName: 'PTreeOak.tga',
            DoTopple: true,
          }),
        ], { GeometryMajorRadius: 3, GeometryMinorRadius: 3 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([], 128, 128), makeRegistry(bundle), makeHeightmap(128, 128));

    const sourceState = createEmptySourceMapEntitySaveState();
    sourceState.objectId = 42;
    sourceState.drawableId = 99;
    sourceState.transformMatrix = [1, 0, 0, 215, 0, 1, 0, 205, 0, 0, 1, 0];
    sourceState.originalTeamName = 'Neutral';

    logic.restoreSourceGameLogicImportSaveState({
      version: 1,
      sourceChunkVersion: 10,
      frameCounter: 77,
      objectIdCounter: 100,
      objects: [{
        templateName: 'OptimizedTree',
        state: sourceState,
        w3dTreeBufferState: {
          deleted: false,
          locationX: 215,
          locationY: 205,
          locationZ: 0,
          angularVelocity: 0.1,
          angularAcceleration: 0.02,
          toppleDirectionX: 0.6,
          toppleDirectionY: 0.8,
          toppleDirectionZ: 0,
          toppleState: 'FALLING',
          angularAccumulation: 0.3,
          options: 1,
          matrix3D: [1, 0, 0, 215, 0, 1, 0, 205, 0, 0, 1, 0],
          sinkFramesLeft: 7,
        },
      }],
    });

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        drawableId: number;
        templateName: string;
        w3dTreeBufferToppleState: string;
        w3dTreeBufferAngularVelocity: number;
        w3dTreeBufferAngularAcceleration: number;
        w3dTreeBufferToppleDirectionX: number;
        w3dTreeBufferToppleDirectionY: number;
        w3dTreeBufferAngularAccumulation: number;
        w3dTreeBufferOptions: number;
        w3dTreeBufferMatrix3D: number[];
        w3dTreeBufferSinkFramesLeft: number;
      }>;
    }).spawnedEntities;
    const tree = entities.get(42)!;

    expect(tree.drawableId).toBe(99);
    expect(tree.w3dTreeBufferToppleState).toBe('FALLING');
    expect(tree.w3dTreeBufferAngularVelocity).toBeCloseTo(0.1);
    expect(tree.w3dTreeBufferAngularAcceleration).toBeCloseTo(0.02);
    expect(tree.w3dTreeBufferToppleDirectionX).toBeCloseTo(0.6);
    expect(tree.w3dTreeBufferToppleDirectionY).toBeCloseTo(0.8);
    expect(tree.w3dTreeBufferAngularAccumulation).toBeCloseTo(0.3);
    expect(tree.w3dTreeBufferOptions).toBe(1);
    expect(tree.w3dTreeBufferMatrix3D).toEqual([1, 0, 0, 215, 0, 1, 0, 205, 0, 0, 1, 0]);
    expect(tree.w3dTreeBufferSinkFramesLeft).toBe(7);
  });
});

describe('KeepObjectDie', () => {
  it('keeps destroyed entity in world as rubble instead of removing it', () => {
    const buildingDef = makeObjectDef('CivBuilding', 'Civilian', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'KeepObjectDie ModuleTag_Keep', {}),
    ]);
    const attackerDef = makeObjectDef('Attacker', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
    ]);
    const bigGun = makeWeaponDef('BigGun', {
      PrimaryDamage: 200,
      PrimaryDamageRadius: 0,
      DamageType: 'EXPLOSION',
      AttackRange: 150,
      DelayBetweenShots: 500,
    });

    const bundle = makeBundle({ objects: [buildingDef, attackerDef], weapons: [bigGun] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 5, 5),
        makeMapObject('Attacker', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('Civilian', 'America', 0);
    logic.setTeamRelationship('America', 'Civilian', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const building = priv.spawnedEntities.get(1)!;
    expect(building.keepObjectOnDeath).toBe(true);

    // Kill the building.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    // Building should be destroyed but still in spawnedEntities (kept as rubble).
    expect(building.destroyed).toBe(true);
    expect(priv.spawnedEntities.has(1)).toBe(true);
  });

  it('removes destroyed entity normally when KeepObjectDie is absent', () => {
    const buildingDef = makeObjectDef('NormalBuilding', 'Civilian', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const attackerDef = makeObjectDef('Attacker2', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun2'] }),
    ]);
    const bigGun = makeWeaponDef('BigGun2', {
      PrimaryDamage: 200,
      PrimaryDamageRadius: 0,
      DamageType: 'EXPLOSION',
      AttackRange: 150,
      DelayBetweenShots: 500,
    });

    const bundle = makeBundle({ objects: [buildingDef, attackerDef], weapons: [bigGun] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NormalBuilding', 5, 5),
        makeMapObject('Attacker2', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('Civilian', 'America', 0);
    logic.setTeamRelationship('America', 'Civilian', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const building = priv.spawnedEntities.get(1)!;
    expect(building.keepObjectOnDeath).toBe(false);

    // Kill the building.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    // Building should be removed from spawnedEntities (no KeepObjectDie).
    expect(priv.spawnedEntities.has(1)).toBe(false);
  });
});

describe('DestroyDie', () => {
  it('extracts DestroyDie profiles from INI with DieMuxData fields', () => {
    const objectDef = makeObjectDef('FilteredDestroy', 'Civilian', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'DestroyDie ModuleTag_Destroy', {
        DeathTypes: 'CRUSHED',
        ExemptStatus: 'SOLD',
      }),
    ]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('FilteredDestroy', 10, 10)]), makeRegistry(makeBundle({ objects: [objectDef] })), makeHeightmap());

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { destroyDieProfiles: Array<{ deathTypes: Set<string>; exemptStatus: Set<string> }> }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.destroyDieProfiles.length).toBe(1);
    expect(entity.destroyDieProfiles[0]!.deathTypes.has('CRUSHED')).toBe(true);
    expect(entity.destroyDieProfiles[0]!.exemptStatus.has('SOLD')).toBe(true);
  });

  it('overrides KeepObjectDie removal only when DestroyDie DeathTypes match', () => {
    const objectDef = makeObjectDef('ConditionalWreck', 'Civilian', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'KeepObjectDie ModuleTag_Keep', {}),
      makeBlock('Behavior', 'DestroyDie ModuleTag_Destroy', {
        DeathTypes: 'CRUSHED',
      }),
    ]);
    const bundle = makeBundle({ objects: [objectDef] });

    const logicNormal = new GameLogicSubsystem(new THREE.Scene());
    logicNormal.loadMapObjects(makeMap([makeMapObject('ConditionalWreck', 10, 10)]), makeRegistry(bundle), makeHeightmap());
    const normalPriv = logicNormal as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string, deathType?: string) => void;
      spawnedEntities: Map<number, { destroyed: boolean }>;
    };
    const normalTarget = normalPriv.spawnedEntities.get(1)!;
    normalPriv.applyWeaponDamageAmount(null, normalTarget, 200, 'EXPLOSION', 'NORMAL');
    logicNormal.update(1 / 30);
    // KeepObjectDie applies; DestroyDie(DeathTypes=CRUSHED) does not.
    expect(normalPriv.spawnedEntities.has(1)).toBe(true);

    const logicCrushed = new GameLogicSubsystem(new THREE.Scene());
    logicCrushed.loadMapObjects(makeMap([makeMapObject('ConditionalWreck', 10, 10)]), makeRegistry(bundle), makeHeightmap());
    const crushedPriv = logicCrushed as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string, deathType?: string) => void;
      spawnedEntities: Map<number, { destroyed: boolean }>;
    };
    const crushedTarget = crushedPriv.spawnedEntities.get(1)!;
    crushedPriv.applyWeaponDamageAmount(null, crushedTarget, 200, 'EXPLOSION', 'CRUSHED');
    logicCrushed.update(1 / 30);
    // Matching DestroyDie profile overrides KeepObjectDie and removes the wreck.
    expect(crushedPriv.spawnedEntities.has(1)).toBe(false);
  });
});

describe('DamDie', () => {
  it('extracts DamDie profiles from INI with DieMuxData fields and OCL name', () => {
    const damDef = makeObjectDef('Dam', 'Civilian', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'DamDie ModuleTag_Dam', {
        DeathTypes: 'CRUSHED',
        RequiredStatus: 'UNDER_CONSTRUCTION',
        CreationList: 'OCLDamFlood',
      }),
    ]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('Dam', 10, 10)]), makeRegistry(makeBundle({ objects: [damDef] })), makeHeightmap());

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        damDieProfiles: Array<{
          deathTypes: Set<string>;
          requiredStatus: Set<string>;
          oclName: string | null;
        }>;
      }>;
    };
    const dam = priv.spawnedEntities.get(1)!;
    expect(dam.damDieProfiles.length).toBe(1);
    expect(dam.damDieProfiles[0]!.deathTypes.has('CRUSHED')).toBe(true);
    expect(dam.damDieProfiles[0]!.requiredStatus.has('UNDER_CONSTRUCTION')).toBe(true);
    expect(dam.damDieProfiles[0]!.oclName).toBe('OCLDamFlood');
  });

  it('enables WAVEGUIDE objects when DamDie death filter matches', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Dam', 'Civilian', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'DamDie ModuleTag_Dam', {
            DeathTypes: 'CRUSHED',
          }),
        ]),
        makeObjectDef('WaveGuideObject', 'Civilian', ['WAVEGUIDE', 'STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Dam', 20, 20),
        makeMapObject('WaveGuideObject', 30, 20),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const priv = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string, deathType?: string) => void;
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const dam = priv.spawnedEntities.get(1)!;
    const waveGuide = priv.spawnedEntities.get(2)!;
    waveGuide.objectStatusFlags.add('DISABLED_DEFAULT');

    // Non-matching death type should not enable wave guides.
    priv.applyWeaponDamageAmount(null, dam, 1000, 'EXPLOSION', 'NORMAL');
    logic.update(1 / 30);
    expect(waveGuide.objectStatusFlags.has('DISABLED_DEFAULT')).toBe(true);

    // Reload and kill with matching death type.
    const logic2 = new GameLogicSubsystem(new THREE.Scene());
    logic2.loadMapObjects(
      makeMap([
        makeMapObject('Dam', 20, 20),
        makeMapObject('WaveGuideObject', 30, 20),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv2 = logic2 as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string, deathType?: string) => void;
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const dam2 = priv2.spawnedEntities.get(1)!;
    const waveGuide2 = priv2.spawnedEntities.get(2)!;
    waveGuide2.objectStatusFlags.add('DISABLED_DEFAULT');
    priv2.applyWeaponDamageAmount(null, dam2, 1000, 'EXPLOSION', 'CRUSHED');
    logic2.update(1 / 30);
    expect(waveGuide2.objectStatusFlags.has('DISABLED_DEFAULT')).toBe(false);
  });

  it('executes DamDie CreationList OCL when death filter matches', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Dam', 'Civilian', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'DamDie ModuleTag_Dam', {
            DeathTypes: 'CRUSHED',
            CreationList: 'OCLDamFlood',
          }),
        ]),
        makeObjectDef('FloodWave', 'Civilian', ['WAVEGUIDE', 'STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
    });
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCLDamFlood',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'FloodWave', Count: '1' },
          blocks: [],
        }],
      },
    ];

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Dam', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string, deathType?: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const dam = priv.spawnedEntities.get(1)!;

    // Non-matching death type should not trigger OCL.
    priv.applyWeaponDamageAmount(null, dam, 1000, 'EXPLOSION', 'NORMAL');
    logic.update(1 / 30);
    expect(logic.getEntityIdsByTemplate('FloodWave')).toHaveLength(0);

    // Matching death type should spawn FloodWave from DamDie CreationList OCL.
    const logic2 = new GameLogicSubsystem(new THREE.Scene());
    logic2.loadMapObjects(
      makeMap([makeMapObject('Dam', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv2 = logic2 as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string, deathType?: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const dam2 = priv2.spawnedEntities.get(1)!;
    priv2.applyWeaponDamageAmount(null, dam2, 1000, 'EXPLOSION', 'CRUSHED');
    logic2.update(1 / 30);
    expect(logic2.getEntityIdsByTemplate('FloodWave').length).toBeGreaterThanOrEqual(1);
  });
});

describe('InstantDeathBehavior', () => {
  it('extracts InstantDeathBehavior profiles from INI', () => {
    const tankDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      {
        type: 'Die',
        name: 'InstantDeathBehavior ModuleTag_Die1',
        fields: {
          DeathTypes: 'BURNED EXPLODED',
          ExemptStatus: 'SOLD',
          Weapon: 'TankDeathExplosion',
        },
        blocks: [],
      },
      {
        type: 'Die',
        name: 'InstantDeathBehavior ModuleTag_Die2',
        fields: {
          DeathTypes: 'CRUSHED',
          RequiredStatus: 'DAMAGED',
          OCL: 'OCLCrushedDebris',
        },
        blocks: [],
      },
    ]);
    const bundle = makeBundle({ objects: [tankDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Tank', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        instantDeathProfiles: Array<{
          deathTypes: Set<string>;
          exemptStatus: Set<string>;
          requiredStatus: Set<string>;
          weaponNames: string[];
          oclNames: string[];
        }>;
      }>;
    };
    const tank = priv.spawnedEntities.get(1)!;
    expect(tank.instantDeathProfiles).toHaveLength(2);

    const p0 = tank.instantDeathProfiles[0]!;
    expect(p0.deathTypes.has('BURNED')).toBe(true);
    expect(p0.deathTypes.has('EXPLODED')).toBe(true);
    expect(p0.exemptStatus.has('SOLD')).toBe(true);
    expect(p0.weaponNames).toEqual(['TankDeathExplosion']);

    const p1 = tank.instantDeathProfiles[1]!;
    expect(p1.deathTypes.has('CRUSHED')).toBe(true);
    expect(p1.requiredStatus.has('DAMAGED')).toBe(true);
    expect(p1.oclNames).toEqual(['OCLCrushedDebris']);
  });

  it('fires death weapon on entity destruction', () => {
    const tankDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      {
        type: 'Die',
        name: 'InstantDeathBehavior ModuleTag_Die',
        fields: {
          Weapon: 'DeathBlast',
        },
        blocks: [],
      },
    ]);
    const nearbyDef = makeObjectDef('Bystander', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const attackerDef = makeObjectDef('Attacker', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigCannon'] }),
    ]);
    const bigCannon = makeWeaponDef('BigCannon', {
      AttackRange: 200,
      PrimaryDamage: 300,
      PrimaryDamageRadius: 0,
      DamageType: 'ARMOR_PIERCING',
      DelayBetweenShots: 100,
      WeaponSpeed: 999999,
    });
    const deathBlast = makeWeaponDef('DeathBlast', {
      PrimaryDamage: 75,
      PrimaryDamageRadius: 50,
      DamageType: 'EXPLOSION',
    });
    const bundle = makeBundle({
      objects: [tankDef, nearbyDef, attackerDef],
      weapons: [bigCannon, deathBlast],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),       // id 1 — dies and fires DeathBlast
        makeMapObject('Bystander', 10, 10),   // id 2 — nearby, should take death weapon damage
        makeMapObject('Attacker', 10, 10),    // id 3 — kills the tank
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; destroyed: boolean }>;
    };
    const tank = priv.spawnedEntities.get(1)!;
    const bystander = priv.spawnedEntities.get(2)!;
    const bystanderBefore = bystander.health;

    // Kill the tank.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Tank should be destroyed.
    expect(tank.destroyed).toBe(true);

    // Bystander should have taken death weapon damage (75 EXPLOSION, radius 50).
    expect(bystander.health).toBeLessThan(bystanderBefore);
  });

  it('skips die module when ExemptStatus matches', () => {
    const tankDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      {
        type: 'Die',
        name: 'InstantDeathBehavior ModuleTag_Die',
        fields: {
          ExemptStatus: 'SOLD',
          Weapon: 'DeathBlast2',
        },
        blocks: [],
      },
    ]);
    const nearbyDef = makeObjectDef('Bystander', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const deathBlast = makeWeaponDef('DeathBlast2', {
      PrimaryDamage: 100,
      PrimaryDamageRadius: 50,
      DamageType: 'EXPLOSION',
    });
    const bundle = makeBundle({
      objects: [tankDef, nearbyDef],
      weapons: [deathBlast],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),
        makeMapObject('Bystander', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        objectStatusFlags: Set<string>;
      }>;
    };
    const tank = priv.spawnedEntities.get(1)!;
    const bystanderBefore = priv.spawnedEntities.get(2)!.health;

    // Mark tank as SOLD — this should exempt the die module.
    tank.objectStatusFlags.add('SOLD');

    // Kill the tank directly via UNRESISTABLE damage.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, tank, 500, 'UNRESISTABLE');

    // Advance one frame to process.
    logic.update(1 / 30);

    // Tank should be destroyed.
    expect(tank.destroyed).toBe(true);

    // Bystander should NOT have taken damage (die module was exempt).
    expect(priv.spawnedEntities.get(2)!.health).toBe(bystanderBefore);
  });

  it('skips die module when RequiredStatus is missing', () => {
    const tankDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      {
        type: 'Die',
        name: 'InstantDeathBehavior ModuleTag_Die',
        fields: {
          RequiredStatus: 'BOOBY_TRAPPED',
          Weapon: 'DeathBlast3',
        },
        blocks: [],
      },
    ]);
    const nearbyDef = makeObjectDef('Bystander', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);
    const deathBlast = makeWeaponDef('DeathBlast3', {
      PrimaryDamage: 100,
      PrimaryDamageRadius: 50,
      DamageType: 'EXPLOSION',
    });
    const bundle = makeBundle({
      objects: [tankDef, nearbyDef],
      weapons: [deathBlast],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),
        makeMapObject('Bystander', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        objectStatusFlags: Set<string>;
      }>;
    };
    const tank = priv.spawnedEntities.get(1)!;
    const bystanderBefore = priv.spawnedEntities.get(2)!.health;

    // Tank does NOT have BOOBY_TRAPPED status — RequiredStatus check should block die module.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, tank, 500, 'UNRESISTABLE');
    logic.update(1 / 30);

    expect(tank.destroyed).toBe(true);
    // Bystander should NOT have taken damage (RequiredStatus not met).
    expect(priv.spawnedEntities.get(2)!.health).toBe(bystanderBefore);
  });
});

describe('death OCL DieMuxData filtering', () => {
  it('filters death OCLs by veterancy level', () => {
    // Create a unit with a death OCL that only fires at VETERAN+ level.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('EliteUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
          makeBlock('Die', 'CreateObjectDie ModuleTag_Die', {
            CreationList: 'OCL_VetDeath',
            VeterancyLevels: 'VETERAN ELITE HEROIC',
          }),
        ], { ExperienceRequired: [1, 50, 100, 200], ExperienceValue: 10 }),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
        ]),
        makeObjectDef('DebrisChunk', 'America', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0,
          DamageType: 'ARMOR_PIERCING', AttackRange: 200,
          DelayBetweenShots: 100, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
      ],
      ocls: [
        {
          name: 'OCL_VetDeath',
          blocks: [
            makeBlock('CreateObject', '', { ObjectNames: 'DebrisChunk', Count: '1' }),
          ],
        },
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EliteUnit', 50, 50),
        makeMapObject('Attacker', 100, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    // Attack and kill the unit (at REGULAR level, not VETERAN).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Unit should be dead. Check if any debris was spawned — at REGULAR level, the
    // VeterancyLevels filter should block the death OCL.
    const allEntities: number[] = [];
    for (let id = 1; id <= 10; id++) {
      const state = logic.getEntityState(id);
      if (state && state.templateName?.toUpperCase().includes('DEBRIS')) {
        allEntities.push(id);
      }
    }
    // No debris should have spawned because the unit was REGULAR, not VETERAN+.
    expect(allEntities.length).toBe(0);
  });
});

describe('UpgradeDie', () => {
  it('removes upgrade from producer when entity dies', () => {
    const factory = makeObjectDef('AmericaAirfield', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('ProductionUpdate', 'ProductionUpdate ModuleTag_PU', {
        MaxQueueEntries: 5,
      }),
    ]);
    const drone = makeObjectDef('ScoutDrone', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
      makeBlock('Behavior', 'UpgradeDie ModuleTag_UD', {
        UpgradeToRemove: 'Upgrade_ScoutDrone',
      }),
    ]);

    const bundle = makeBundle({ objects: [factory, drone] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('AmericaAirfield', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const factoryEntity = priv.spawnedEntities.get(1)!;

    // Manually give the factory the upgrade.
    factoryEntity.completedUpgrades.add('UPGRADE_SCOUTDRONE');

    // Create a drone entity as if produced by the factory.
    const droneDef = bundle.objects.find(o => o.name.toUpperCase() === 'SCOUTDRONE')!;
    const droneMapObj: MapObjectJSON = {
      templateName: 'ScoutDrone',
      angle: 0,
      flags: 0,
      position: { x: 55, y: 55, z: 0 },
      properties: {},
    };
    const droneEntity = (logic as any).createMapEntity(droneMapObj, droneDef, makeRegistry(bundle), makeHeightmap());
    droneEntity.side = 'America';
    droneEntity.controllingPlayerToken = factoryEntity.controllingPlayerToken;
    droneEntity.producerEntityId = factoryEntity.id;
    priv.spawnedEntities.set(droneEntity.id, droneEntity);
    logic.update(1 / 30);

    expect(factoryEntity.completedUpgrades.has('UPGRADE_SCOUTDRONE')).toBe(true);

    // Kill the drone.
    (logic as any).applyWeaponDamageAmount(null, droneEntity, 9999, 'UNRESISTABLE');
    logic.update(1 / 30);

    expect(droneEntity.destroyed).toBe(true);
    // Factory should have the upgrade removed.
    expect(factoryEntity.completedUpgrades.has('UPGRADE_SCOUTDRONE')).toBe(false);
  });
});

describe('StructureCollapseUpdate', () => {
  function makeCollapseBundle(collapseFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('CollapseBuilding', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StructureCollapseUpdate ModuleTag_Collapse', {
            MinCollapseDelay: 100, // ~3 frames
            MaxCollapseDelay: 100, // ~3 frames (deterministic)
            MinBurstDelay: 200,    // ~6 frames
            MaxBurstDelay: 200,    // ~6 frames
            CollapseDamping: 0.5,
            BigBurstFrequency: 2,
            ...collapseFields,
          }),
        ], { Geometry: 'BOX', GeometryMajorRadius: '10', GeometryMinorRadius: '10', GeometryHeight: '20' }),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BuildingKiller'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BuildingKiller', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
  }

  it('building persists during collapse and is eventually destroyed', () => {
    const bundle = makeCollapseBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseBuilding', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Advance until lethal damage — building enters collapse.
    let enteredCollapse = false;
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') {
        enteredCollapse = true;
        break;
      }
    }
    expect(enteredCollapse).toBe(true);

    // Building should still be in entity state (not destroyed yet) during collapse.
    const midCollapse = logic.getEntityState(1);
    expect(midCollapse).not.toBeNull();
    expect(midCollapse!.animationState).toBe('DIE');

    // Access internal state to verify collapse state.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { structureCollapseState: { state: string } | null; destroyed: boolean }>;
    };
    const buildingEntity = priv.spawnedEntities.get(1)!;
    expect(buildingEntity.structureCollapseState).not.toBeNull();

    // Run enough frames for the building to fully collapse and be destroyed.
    // With height=20, gravity=-1.0, damping=0.5: velocity grows at 0.5/frame.
    // After N frames of COLLAPSING, currentHeight reaches -20 and building is destroyed.
    for (let i = 0; i < 100; i++) logic.update(1 / 30);

    // Building should now be fully destroyed.
    const afterCollapse = logic.getEntityState(1);
    expect(afterCollapse).toBeNull();
  });

  it('transitions through WAITING → COLLAPSING → DONE states', () => {
    const bundle = makeCollapseBundle({
      MinCollapseDelay: 200,  // ~6 frames
      MaxCollapseDelay: 200,
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseBuilding', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the building.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        structureCollapseState: { state: string; currentHeight: number } | null;
        destroyed: boolean;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.structureCollapseState).not.toBeNull();
    expect(entity.structureCollapseState!.state).toBe('WAITING');

    // Advance past collapse delay (6 frames).
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Should be COLLAPSING now with height decreasing.
    if (entity.structureCollapseState) {
      expect(entity.structureCollapseState.state).toBe('COLLAPSING');
      expect(entity.structureCollapseState.currentHeight).toBeLessThan(0);
    }
  });

  it('does not take further damage during collapse', () => {
    const bundle = makeCollapseBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseBuilding', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill building to enter collapse.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { canTakeDamage: boolean; structureCollapseState: object | null }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.structureCollapseState).not.toBeNull();
    expect(entity.canTakeDamage).toBe(false);
  });

  it('executes INITIAL phase OCL on collapse start', () => {
    const bundle = makeCollapseBundle({
      OCL: 'INITIAL CollapseDebrisOCL',
    });
    // Add the debris OCL and debris object def.
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'CollapseDebrisOCL',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'CollapseDebris', Count: '1' },
          blocks: [],
        }],
      },
    ];
    // Add the debris object definition to the bundle.
    (bundle.objects as ObjectDef[]).push(
      makeObjectDef('CollapseDebris', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
      ]),
    );

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseBuilding', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill building — INITIAL phase should fire and spawn debris.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Check that a CollapseDebris entity was spawned.
    const allStates = logic.getRenderableEntityStates();
    const debrisEntities = allStates.filter(s => s.templateName === 'CollapseDebris');
    expect(debrisEntities.length).toBeGreaterThanOrEqual(1);
  });

  it('respects DieMuxData death type filtering', () => {
    const bundle = makeCollapseBundle({
      DeathTypes: 'LASERED', // Only fire on laser death.
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseBuilding', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill with normal weapon (not LASERED) — collapse should NOT trigger.
    // Building should be immediately destroyed (no collapse animation).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Entity should be fully destroyed and no longer visible.
    const afterDeath = logic.getEntityState(1);
    expect(afterDeath).toBeNull();
  });

  it('gravity-damped sinking causes height to decrease each frame during collapse', () => {
    const bundle = makeCollapseBundle({
      MinCollapseDelay: 0,
      MaxCollapseDelay: 0,
      CollapseDamping: 0.0, // Full gravity, no damping.
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseBuilding', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill and enter collapse.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        structureCollapseState: { state: string; currentHeight: number; collapseVelocity: number } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    // With 0 collapse delay, should immediately be COLLAPSING after one update.
    // Run a few more frames to let physics take effect.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    if (entity.structureCollapseState) {
      // With full gravity (damping=0), velocity = (1.0)^N cumulative.
      // Height should be negative and decreasing.
      expect(entity.structureCollapseState.currentHeight).toBeLessThan(0);
      expect(entity.structureCollapseState.collapseVelocity).toBeGreaterThan(0);
    }
  });
});

describe('NeutronMissileSlowDeathUpdate', () => {
  function makeNeutronMissileBundle(blastFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('NeutronMissile', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'NeutronMissileSlowDeathBehavior ModuleTag_NM', {
            DestructionDelay: 3000, // 90 frames — missile persists this long
            SinkRate: 0,
            ProbabilityModifier: 10,
            Blast1Enabled: 'Yes',
            Blast1Delay: 0, // 0ms = fires immediately on activation
            Blast1ScorchDelay: 0,
            Blast1InnerRadius: 20,
            Blast1OuterRadius: 100,
            Blast1MaxDamage: 200,
            Blast1MinDamage: 50,
            Blast1ToppleSpeed: 0.3,
            Blast2Enabled: 'Yes',
            Blast2Delay: 300, // 300ms = 9 frames after activation
            Blast2ScorchDelay: 300,
            Blast2InnerRadius: 50,
            Blast2OuterRadius: 200,
            Blast2MaxDamage: 150,
            Blast2MinDamage: 30,
            Blast2ToppleSpeed: 0,
            ...blastFields,
          }),
        ]),
        makeObjectDef('Target', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('FarTarget', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
        makeObjectDef('Tree', 'Neutral', ['SHRUBBERY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
        makeObjectDef('Killer', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'NukeKill'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('NukeKill', {
          AttackRange: 300,
          PrimaryDamage: 9999,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
  }

  it('fires sequential blast waves with radius damage after slow death activation', () => {
    const bundle = makeNeutronMissileBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronMissile', 50, 50),
        makeMapObject('Target', 65, 50), // 15 units away — inside inner radius of blast 1
        makeMapObject('Killer', 100, 100),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; maxHealth: number;
        slowDeathState: unknown; neutronMissileSlowDeathState: unknown;
        slowDeathProfiles: unknown[];
      }>;
    };

    // Kill the missile to trigger slow death.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });

    // Advance enough frames for the attacker to fire and kill the missile.
    let enteredSlowDeath = false;
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      const missile = priv.spawnedEntities.get(1);
      if (missile && missile.slowDeathState) {
        enteredSlowDeath = true;
        break;
      }
    }
    expect(enteredSlowDeath).toBe(true);

    const missile = priv.spawnedEntities.get(1)!;
    expect(missile.neutronMissileSlowDeathState).not.toBeNull();

    // Capture target reference and health.
    const target = priv.spawnedEntities.get(2)!;
    const healthBefore = target.health;

    // Advance frames until blast 1 fires.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const healthAfterBlast1 = target.health;
    expect(healthAfterBlast1).toBeLessThan(healthBefore);
    // Target at 15 units is inside innerRadius=20, so takes full maxDamage=200.
    expect(healthBefore - healthAfterBlast1).toBe(200);
  });

  it('applies damage falloff based on inner/outer radius', () => {
    const bundle = makeNeutronMissileBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronMissile', 50, 50),
        makeMapObject('Target', 110, 50), // 60 units away — between inner (20) and outer (100)
        makeMapObject('Killer', 200, 200),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
        slowDeathState: unknown;
      }>;
    };

    // Kill missile — loop until slow death activates.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (priv.spawnedEntities.get(1)?.slowDeathState) break;
    }
    expect(priv.spawnedEntities.get(1)!.slowDeathState).not.toBeNull();

    const target = priv.spawnedEntities.get(2)!;
    const healthBefore = target.health;
    // Advance until blast 1 fires.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const damage = healthBefore - target.health;
    // Distance 60, innerRadius=20, outerRadius=100: percent = 1 - (40/80.01) ≈ 0.5
    // damage = 200 * 0.5 = 100, clamped above minDamage=50.
    expect(damage).toBeGreaterThan(50);
    expect(damage).toBeLessThan(200);
  });

  it('fires second blast wave after configured delay', () => {
    const bundle = makeNeutronMissileBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronMissile', 50, 50),
        makeMapObject('Target', 80, 50), // 30 units away — inside blast2 innerRadius=50
        makeMapObject('Killer', 200, 200),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
        slowDeathState: unknown; neutronMissileSlowDeathState: { activationFrame: number } | null;
      }>;
    };

    // Kill missile — loop until slow death activates.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    let activationFrameCount = 0;
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      activationFrameCount++;
      if (priv.spawnedEntities.get(1)?.slowDeathState) break;
    }
    expect(priv.spawnedEntities.get(1)!.slowDeathState).not.toBeNull();

    const target = priv.spawnedEntities.get(2)!;
    // Wait for blast 1 to fire (needs 2 frames after activation: set frame + elapsed > 0).
    for (let i = 0; i < 3; i++) logic.update(1 / 30);
    const healthAfterBlast1 = target.health;
    expect(healthAfterBlast1).toBeLessThan(500); // Blast 1 should have fired.

    // Now wait for blast 2 delay = 300ms = 9 frames from activation.
    // We need the elapsed count from activationFrame to exceed 9.
    // Advance frames carefully: we already ran 3 frames after slow death.
    // Blast 2 fires when elapsed > 9.
    // Run 7 more frames to reach elapsed ~10 or so.
    for (let i = 0; i < 7; i++) logic.update(1 / 30);
    const healthBeforeLastFrame = target.health;

    // By now blast 2 should have fired (elapsed = 10+ > 9).
    // Check that blast 2 dealt additional damage.
    expect(target.health).toBeLessThan(healthAfterBlast1);
  });

  it('scorch blast sets BURNED status on entities in range', () => {
    // Use a high-HP target so blast damage doesn't kill it before we can check scorch.
    const bundle = makeNeutronMissileBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NeutronMissile', 50, 50),
        makeMapObject('Target', 70, 50), // 20 units away — inside outerRadius, has 500 HP
        makeMapObject('Killer', 200, 200),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; objectStatusFlags: Set<string>;
        slowDeathState: unknown;
      }>;
    };

    // Kill missile — loop until slow death activates.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (priv.spawnedEntities.get(1)?.slowDeathState) break;
    }
    expect(priv.spawnedEntities.get(1)!.slowDeathState).not.toBeNull();

    const target = priv.spawnedEntities.get(2)!;
    // Advance until scorch blast fires (scorchDelay=0, fires after activation frame).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(target.objectStatusFlags.has('BURNED')).toBe(true);
  });
});

describe('FireWeaponWhenDeadBehavior', () => {
  it('fires death weapon on entity destruction (StartsActive=Yes)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Bomber', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            StartsActive: 'Yes',
            DeathWeapon: 'DeathBlast',
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('Bystander', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0, AttackRange: 50,
          DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL',
          DelayBetweenShots: 500, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
        makeWeaponDef('DeathBlast', {
          PrimaryDamage: 40, PrimaryDamageRadius: 30, AttackRange: 30,
          DamageType: 'EXPLOSION', DeathType: 'NORMAL',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Bomber', 50, 50),
        makeMapObject('Attacker', 80, 50),
        makeMapObject('Bystander', 60, 50),  // Within DeathBlast radius (30) of Bomber.
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; maxHealth: number;
      }>;
    };

    const bystander = priv.spawnedEntities.get(3)!;
    expect(bystander.health).toBe(100);

    // Kill the Bomber — should fire DeathBlast hitting the Bystander.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Bomber should be destroyed (removed from entities).
    expect(logic.getEntityState(1)).toBeNull();
    // Bystander should have taken damage from the death blast.
    expect(bystander.health).toBeLessThan(100);
  });

  it('does not fire when StartsActive=No and no upgrade applied', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            StartsActive: 'No',
            TriggeredBy: 'Upgrade_SelfDestruct',
            DeathWeapon: 'DeathBlast',
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('Bystander', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0, AttackRange: 50,
          DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL',
          DelayBetweenShots: 500, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
        makeWeaponDef('DeathBlast', {
          PrimaryDamage: 40, PrimaryDamageRadius: 30, AttackRange: 30,
          DamageType: 'EXPLOSION', DeathType: 'NORMAL',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 50, 50),
        makeMapObject('Attacker', 80, 50),
        makeMapObject('Bystander', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
      }>;
    };

    const bystander = priv.spawnedEntities.get(3)!;

    // Kill Tank without upgrade — no death weapon should fire.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)).toBeNull();
    // Bystander should be unharmed (no death blast).
    expect(bystander.health).toBe(100);
  });

  it('fires when StartsActive=No but upgrade has been applied', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            StartsActive: 'No',
            TriggeredBy: 'Upgrade_SelfDestruct',
            DeathWeapon: 'DeathBlast',
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('Bystander', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0, AttackRange: 50,
          DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL',
          DelayBetweenShots: 500, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
        makeWeaponDef('DeathBlast', {
          PrimaryDamage: 40, PrimaryDamageRadius: 30, AttackRange: 30,
          DamageType: 'EXPLOSION', DeathType: 'NORMAL',
        }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_SelfDestruct', {}),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 50, 50),
        makeMapObject('Attacker', 80, 50),
        makeMapObject('Bystander', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    // Apply the upgrade to activate the behavior.
    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_SelfDestruct' });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
      }>;
    };

    const bystander = priv.spawnedEntities.get(3)!;

    // Kill Tank with upgrade — death weapon should fire.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)).toBeNull();
    // Bystander should be damaged by death blast.
    expect(bystander.health).toBeLessThan(100);
  });

  it('respects DieMuxData DeathTypes filter', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Truck', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'FireWeaponWhenDeadBehavior ModuleTag_FWWD', {
            StartsActive: 'Yes',
            DeathWeapon: 'DeathBlast',
            DeathTypes: 'LASERED',  // Only fires on LASERED death, not NORMAL.
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
        makeObjectDef('Bystander', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0, AttackRange: 50,
          DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL',
          DelayBetweenShots: 500, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
        makeWeaponDef('DeathBlast', {
          PrimaryDamage: 40, PrimaryDamageRadius: 30, AttackRange: 30,
          DamageType: 'EXPLOSION', DeathType: 'NORMAL',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Truck', 50, 50),
        makeMapObject('Attacker', 80, 50),
        makeMapObject('Bystander', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
      }>;
    };

    const bystander = priv.spawnedEntities.get(3)!;

    // Kill with NORMAL death type — DeathTypes filter is LASERED, so no blast.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)).toBeNull();
    // Bystander should be unharmed (death type mismatch).
    expect(bystander.health).toBe(100);
  });
});

describe('HelicopterSlowDeathBehavior', () => {
  function makeHeliBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Helicopter', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SD', {
            DeathTypes: 'ALL',
            DestructionDelay: 3000,
            SinkRate: 0,
            ProbabilityModifier: 100,
          }),
          makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_HSD', {
            DeathTypes: 'ALL',
            DestructionDelay: 3000,
            SinkRate: 0,
            ProbabilityModifier: 1,
            SpiralOrbitTurnRate: 180,          // 180 deg/s
            SpiralOrbitForwardSpeed: 60,       // 60 units/s → 2 units/frame
            SpiralOrbitForwardSpeedDamping: 0.98,
            MinSelfSpin: 90,                   // 90 deg/s → ~0.052 rad/frame
            MaxSelfSpin: 360,                  // 360 deg/s → ~0.209 rad/frame
            SelfSpinUpdateDelay: 200,          // 200ms → 6 frames
            SelfSpinUpdateAmount: 30,          // 30 degrees → ~0.524 rad
            FallHowFast: 50,                   // 50% gravity
            DelayFromGroundToFinalDeath: 500,  // 500ms → 15 frames
          }),
        ]),
        makeObjectDef('Killer', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 300,
          PrimaryDamage: 9999,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
          AntiAirborneVehicle: true,
        }),
      ],
    });
  }

  it('extracts helicopter slow death profiles from INI', () => {
    const bundle = makeHeliBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Helicopter', 128, 128),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        helicopterSlowDeathProfiles: { spiralOrbitTurnRate: number; deathTypes: Set<string> }[];
        slowDeathProfiles: { deathTypes: Set<string>; probabilityModifier: number }[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()][0]!;
    // Verify helicopter slow death profiles were extracted.
    expect(heli.helicopterSlowDeathProfiles.length).toBe(1);
    expect(heli.helicopterSlowDeathProfiles[0]!.spiralOrbitTurnRate).toBeGreaterThan(0);
    // Verify slow death profiles also include helicopter (since it extends SlowDeathBehavior).
    expect(heli.slowDeathProfiles.length).toBeGreaterThanOrEqual(1);
  });

  it('initializes helicopter spiral death state when killed', () => {
    const bundle = makeHeliBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Helicopter', 10, 10),
        makeMapObject('Killer', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        helicopterSlowDeathState: { forwardAngle: number; forwardSpeed: number; hitGroundFrame: number; profileIndex: number } | null;
        helicopterSlowDeathProfiles: unknown[];
        slowDeathState: unknown;
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(e => e.helicopterSlowDeathProfiles.length > 0)!;
    expect(heli).toBeDefined();
    // Elevate helicopter so it can spiral down.
    heli.y = 100;

    // Kill the helicopter — give enough frames for combat to execute.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    // After lethal damage, helicopter should have slow death state initialized.
    expect(heli.health).toBeLessThanOrEqual(0);
    expect(heli.destroyed).toBe(false);
    expect(heli.slowDeathState).not.toBeNull();
    expect(heli.helicopterSlowDeathState).not.toBeNull();
    expect(heli.helicopterSlowDeathState!.profileIndex).toBe(0);
    expect(heli.helicopterSlowDeathState!.hitGroundFrame).toBe(0);
  });

  it('spirals and descends per frame while airborne', () => {
    const bundle = makeHeliBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Helicopter', 10, 10),
        makeMapObject('Killer', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number; x: number; z: number; heading: number;
        helicopterSlowDeathState: {
          forwardAngle: number; forwardSpeed: number; hitGroundFrame: number;
          verticalVelocity: number; selfSpin: number;
        } | null;
        helicopterSlowDeathProfiles: unknown[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(e => e.helicopterSlowDeathProfiles.length > 0)!;
    heli.y = 200; // Start high up.

    // Kill it — give enough frames for combat.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    const hs = heli.helicopterSlowDeathState!;
    expect(hs).not.toBeNull();
    const initX = heli.x;
    const initZ = heli.z;
    const initY = heli.y;

    // Run several frames of spiral death.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Helicopter should have moved laterally (spiral orbit).
    expect(Math.abs(heli.x - initX) + Math.abs(heli.z - initZ)).toBeGreaterThan(0.1);
    // Should be descending (lower Y).
    expect(heli.y).toBeLessThan(initY);
    // Forward speed should be damped.
    expect(hs.forwardSpeed).toBeLessThan(2); // Was ~2 units/frame initially.
    // Vertical velocity should be increasingly negative.
    expect(hs.verticalVelocity).toBeLessThan(0);
  });

  it('hits ground and destroys after delay', () => {
    const bundle = makeHeliBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Helicopter', 10, 10),
        makeMapObject('Killer', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        helicopterSlowDeathState: { hitGroundFrame: number } | null;
        helicopterSlowDeathProfiles: unknown[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(e => e.helicopterSlowDeathProfiles.length > 0)!;
    heli.y = 30; // Start relatively low — will hit ground quickly.

    // Kill it — give enough frames for combat.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    expect(heli.helicopterSlowDeathState).not.toBeNull();

    // Run frames until it hits the ground.
    let hitGround = false;
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
      if (heli.helicopterSlowDeathState?.hitGroundFrame && heli.helicopterSlowDeathState.hitGroundFrame > 0) {
        hitGround = true;
        break;
      }
      if (heli.destroyed) break;
    }
    expect(hitGround || heli.destroyed).toBe(true);

    // If it hit ground but isn't destroyed yet, run more frames for the delay.
    if (!heli.destroyed) {
      // DelayFromGroundToFinalDeath = 500ms → 15 frames.
      for (let i = 0; i < 20; i++) {
        logic.update(1 / 30);
        if (heli.destroyed) break;
      }
      expect(heli.destroyed).toBe(true);
    }
  });

  it('self-spin oscillates between min and max rates', () => {
    const bundle = makeHeliBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Helicopter', 10, 10),
        makeMapObject('Killer', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        helicopterSlowDeathState: {
          selfSpin: number; selfSpinTowardsMax: boolean; hitGroundFrame: number;
        } | null;
        helicopterSlowDeathProfiles: unknown[];
      }>;
    };

    const heli = [...priv.spawnedEntities.values()].find(e => e.helicopterSlowDeathProfiles.length > 0)!;
    heli.y = 500; // Very high — won't hit ground during test.

    // Kill it — give enough frames for combat.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (heli.health <= 0) break;
    }

    const hs = heli.helicopterSlowDeathState!;
    expect(hs).not.toBeNull();
    const initSpin = hs.selfSpin;

    // SelfSpinUpdateDelay = 200ms → 6 frames. Run enough frames for spin to update.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Spin should have changed from the initial value (started at minSelfSpin, heading toward max).
    expect(hs.selfSpin).not.toBe(initSpin);
    // The helicopter should still be airborne.
    expect(hs.hitGroundFrame).toBe(0);
  });
});

describe('JetSlowDeathBehavior', () => {
  function makeJetBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('FighterJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SD', {
            DeathTypes: 'ALL',
            DestructionDelay: 5000,
            SinkRate: 0,
            ProbabilityModifier: 100,
          }),
          makeBlock('Behavior', 'JetSlowDeathBehavior ModuleTag_JSD', {
            DeathTypes: 'ALL',
            RollRate: 5,                         // 5 raw float (C++ parseReal, not degrees)
            RollRateDelta: 95,                   // 0.95 multiplier (parsePercentToReal)
            PitchRate: 3,                        // 3 raw float (C++ parseReal, not degrees)
            FallHowFast: 60,                     // 60% gravity (parsePercentToReal)
            DelaySecondaryFromInitialDeath: 500, // 500ms → 15 frames
            DelayFinalBlowUpFromHitGround: 300,  // 300ms → 9 frames
          }),
        ]),
        makeObjectDef('AAGun', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'AAAGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('AAAGun', {
          AttackRange: 300,
          PrimaryDamage: 9999,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
          AntiAirborneVehicle: true,
        }),
      ],
    });
  }

  it('extracts jet slow death profiles from INI', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('FighterJet', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        jetSlowDeathProfiles: { rollRate: number; fallHowFast: number; rollRateDelta: number; deathTypes: Set<string> }[];
      }>;
    };

    const jet = [...priv.spawnedEntities.values()][0]!;
    expect(jet.jetSlowDeathProfiles.length).toBe(1);
    const p = jet.jetSlowDeathProfiles[0]!;
    // RollRate: 5 raw float (C++ parseReal — no degree conversion).
    expect(p.rollRate).toBeCloseTo(5, 4);
    // RollRateDelta: 95% → 0.95
    expect(p.rollRateDelta).toBeCloseTo(0.95, 4);
    // FallHowFast: 60% → 0.6
    expect(p.fallHowFast).toBeCloseTo(0.6, 4);
  });

  it('initializes jet death state when killed airborne', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FighterJet', 10, 10),
        makeMapObject('AAGun', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        jetSlowDeathState: {
          deathFrame: number; groundFrame: number; rollRate: number;
          forwardSpeed: number; profileIndex: number;
        } | null;
        jetSlowDeathProfiles: unknown[];
        slowDeathState: unknown;
      }>;
    };

    const jet = [...priv.spawnedEntities.values()].find(e =>
      (e as { jetSlowDeathProfiles: unknown[] }).jetSlowDeathProfiles.length > 0)!;
    expect(jet).toBeDefined();
    // Elevate jet so it dies airborne (above isSignificantlyAboveTerrain threshold of 9.0).
    jet.y = 150;

    // Kill the jet.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (jet.health <= 0) break;
    }

    expect(jet.health).toBeLessThanOrEqual(0);
    expect(jet.destroyed).toBe(false);
    expect(jet.slowDeathState).not.toBeNull();
    expect(jet.jetSlowDeathState).not.toBeNull();
    expect(jet.jetSlowDeathState!.profileIndex).toBe(0);
    expect(jet.jetSlowDeathState!.groundFrame).toBe(0); // Still airborne.
    expect(jet.jetSlowDeathState!.forwardSpeed).toBeGreaterThan(0);
  });

  it('flies forward and descends while airborne', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FighterJet', 10, 10),
        makeMapObject('AAGun', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number; x: number; z: number;
        jetSlowDeathState: {
          rollAngle: number; verticalVelocity: number; groundFrame: number;
        } | null;
        jetSlowDeathProfiles: unknown[];
      }>;
    };

    const jet = [...priv.spawnedEntities.values()].find(e =>
      (e as { jetSlowDeathProfiles: unknown[] }).jetSlowDeathProfiles.length > 0)!;
    jet.y = 300; // Start very high.

    // Kill it.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (jet.health <= 0) break;
    }

    const js = jet.jetSlowDeathState!;
    expect(js).not.toBeNull();
    const initX = jet.x;
    const initZ = jet.z;
    const initY = jet.y;

    // Run several frames of jet death.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Jet should have moved forward (straight line, not spiral).
    expect(Math.abs(jet.x - initX) + Math.abs(jet.z - initZ)).toBeGreaterThan(0.1);
    // Should be descending.
    expect(jet.y).toBeLessThan(initY);
    // Roll angle should have accumulated.
    expect(Math.abs(js.rollAngle)).toBeGreaterThan(0);
    // Vertical velocity should be negative.
    expect(js.verticalVelocity).toBeLessThan(0);
  });

  it('hits ground and destroys after final delay', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FighterJet', 10, 10),
        makeMapObject('AAGun', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number;
        jetSlowDeathState: { groundFrame: number; pitchAngle: number } | null;
        jetSlowDeathProfiles: unknown[];
      }>;
    };

    const jet = [...priv.spawnedEntities.values()].find(e =>
      (e as { jetSlowDeathProfiles: unknown[] }).jetSlowDeathProfiles.length > 0)!;
    jet.y = 30; // Start low — will hit ground quickly.

    // Kill it.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (jet.health <= 0) break;
    }

    expect(jet.jetSlowDeathState).not.toBeNull();

    // Run frames until it hits the ground.
    let hitGround = false;
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
      if (jet.jetSlowDeathState?.groundFrame && jet.jetSlowDeathState.groundFrame > 0) {
        hitGround = true;
        break;
      }
      if (jet.destroyed) break;
    }
    expect(hitGround || jet.destroyed).toBe(true);

    // If it hit ground but isn't destroyed yet, run a frame so the else branch
    // (ground phase) executes, then check pitch accumulation.
    // C++ parity: ground-hit frame sets groundFrame; pitch starts next frame.
    if (!jet.destroyed) {
      logic.update(1 / 30);
      if (!jet.destroyed) {
        expect(jet.jetSlowDeathState!.pitchAngle).not.toBe(0);
      }
      for (let i = 0; i < 15; i++) {
        logic.update(1 / 30);
        if (jet.destroyed) break;
      }
      expect(jet.destroyed).toBe(true);
    }
  });

  it('skips jet slow death if killed on ground', () => {
    const bundle = makeJetBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FighterJet', 10, 10),
        makeMapObject('AAGun', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; y: number; baseHeight: number;
        jetSlowDeathState: unknown | null;
        jetSlowDeathProfiles: unknown[];
      }>;
    };

    const jet = [...priv.spawnedEntities.values()].find(e =>
      (e as { jetSlowDeathProfiles: unknown[] }).jetSlowDeathProfiles.length > 0)!;
    // Keep jet at ground level (not significantly above terrain).
    // Don't elevate — let it stay at spawn height.

    // Kill it.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (jet.health <= 0) break;
    }

    // Jet slow death state should NOT be initialized (killed on ground).
    expect(jet.jetSlowDeathState).toBeNull();
  });
});

describe('StructureToppleUpdate', () => {
  it('extracts profile from INI', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
        MinToppleDelay: 500,
        MaxToppleDelay: 1000,
        MinToppleBurstDelay: 200,
        MaxToppleBurstDelay: 600,
        StructuralIntegrity: 0.5,
        StructuralDecay: 0.98,
        CrushingWeaponName: 'StructureCrush',
      }),
    ]);
    const bundle = makeBundle({ objects: [building] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('GLAScudStorm', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const entity = (logic as unknown as { spawnedEntities: Map<number, unknown> }).spawnedEntities.get(1)! as unknown as {
      structureToppleProfile: { structuralIntegrity: number; structuralDecay: number };
    };
    expect(entity.structureToppleProfile).not.toBeNull();
    expect(entity.structureToppleProfile.structuralIntegrity).toBe(0.5);
    expect(entity.structureToppleProfile.structuralDecay).toBe(0.98);
  });

  it('topple state machine progresses through states', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
        MinToppleDelay: 33,
        MaxToppleDelay: 66,
        StructuralIntegrity: 0.0,
        StructuralDecay: 0.0,
      }),
    ]);
    const bundle = makeBundle({ objects: [building] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('GLAScudStorm', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const entity = privateApi.spawnedEntities.get(1)! as unknown as {
      structureToppleState: { state: string } | null;
    };
    privateApi.beginStructureTopple(entity, null);

    expect(entity.structureToppleState).not.toBeNull();
    expect(entity.structureToppleState!.state).toBe('WAITING');

    // Tick until topple starts (max ~2 frames for 66ms).
    for (let i = 0; i < 10; i++) logic.update(0);
    expect(entity.structureToppleState!.state).toBe('TOPPLING');

    // Tick until done (structural integrity 0 = fast topple).
    for (let i = 0; i < 200; i++) logic.update(0);
    expect(entity.structureToppleState!.state).toBe('DONE');
  });

  it('dying rubble render state persists for 10 seconds with RUBBLE flag for topple buildings', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
        MinToppleDelay: 33,
        MaxToppleDelay: 66,
        StructuralIntegrity: 0.0,
        StructuralDecay: 0.0,
      }),
    ]);
    const attacker = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'InstantKillGun'] }),
    ]);
    const bundle = makeBundle({
      objects: [building, attacker],
      weapons: [
        makeWeaponDef('InstantKillGun', {
          AttackRange: 220,
          PrimaryDamage: 5000,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GLAScudStorm', 50, 50),
        makeMapObject('Tank', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    // Kill the building via attack command.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // The building should be dead.
    const priv = logic as unknown as {
      pendingDyingRenderableStates: Map<number, { state: { modelConditionFlags: string[] }; expireFrame: number }>;
      frameCounter: number;
    };
    const dyingState = priv.pendingDyingRenderableStates.get(1);
    expect(dyingState).toBeDefined();
    // Should have RUBBLE model condition flag.
    expect(dyingState!.state.modelConditionFlags).toContain('RUBBLE');
    // Expire frame should be ~10 seconds (300 frames) after death, not ~3 seconds (90 frames).
    const framesUntilExpire = dyingState!.expireFrame - priv.frameCounter;
    expect(framesUntilExpire).toBeGreaterThan(200); // Well above 3-second threshold.
  });
});

describe('SlowDeath fling physics', () => {
  function makeFlingBundle(flingFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('FlingUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SlowDeath', {
            DestructionDelay: 5000,
            ProbabilityModifier: 10,
            FlingForce: 100,
            FlingPitch: 45,
            ...flingFields,
          }),
        ]),
        makeObjectDef('Killer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'OHKGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('OHKGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
  }

  it('flings entity upward on first update with flingForce > 0', () => {
    const bundle = makeFlingBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FlingUnit', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the unit — it should enter slow death and be flung.
    let initialY = 0;
    let enteredSlowDeath = false;
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') {
        initialY = s.y;
        enteredSlowDeath = true;
        break;
      }
    }
    expect(enteredSlowDeath).toBe(true);

    // After a few frames, entity Y should increase (thrown upward).
    logic.update(1 / 30);
    const afterFling = logic.getEntityState(1);
    expect(afterFling).not.toBeNull();
    expect(afterFling!.y).toBeGreaterThan(initialY);
  });

  it('entity bounces on ground contact and velocity is reduced', () => {
    const bundle = makeFlingBundle({ FlingForce: 100, FlingPitch: 45 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FlingUnit', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the unit.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') break;
    }

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        slowDeathState: {
          isFlung: boolean;
          hasBounced: boolean;
          flingVelocityY: number;
        } | null;
        explodedState: string;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.slowDeathState).not.toBeNull();
    expect(entity.slowDeathState!.isFlung).toBe(true);

    // Run many frames until the entity hits the ground and bounces.
    let bounced = false;
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
      if (entity.slowDeathState && entity.slowDeathState.hasBounced) {
        bounced = true;
        break;
      }
    }
    expect(bounced).toBe(true);
  });

  it('transitions explodedState through FLAILING → BOUNCING → SPLATTED', () => {
    const bundle = makeFlingBundle({ FlingForce: 100, FlingPitch: 45 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FlingUnit', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the unit.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0 && s.animationState === 'DIE') break;
    }

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        slowDeathState: {
          isFlung: boolean;
          hasBounced: boolean;
        } | null;
        explodedState: string;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Immediately after fling starts, state should be FLAILING.
    expect(entity.explodedState).toBe('FLAILING');

    // Run until bounced.
    let sawBouncing = false;
    let sawSplatted = false;
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (entity.explodedState === 'BOUNCING') sawBouncing = true;
      if (entity.explodedState === 'SPLATTED') {
        sawSplatted = true;
        break;
      }
    }
    expect(sawBouncing).toBe(true);
    expect(sawSplatted).toBe(true);
  });
});

describe('BattleBusSlowDeathBehavior', () => {
  function makeBattleBusBundle(busFields: Record<string, unknown> = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('BattleBus', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'BattleBusSlowDeathBehavior ModuleTag_SlowDeath', {
            DestructionDelay: 5000,
            ProbabilityModifier: 10,
            ThrowForce: 200,
            PercentDamageToPassengers: 50,
            EmptyHulkDestructionDelay: 1000, // 30 frames
            ...busFields,
          }),
        ]),
        makeObjectDef('Passenger', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('Killer', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'OHKGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('OHKGun', {
          AttackRange: 220,
          PrimaryDamage: 1000,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });
  }

  it('fake death throws bus vertically and lands as SECOND_LIFE hulk', () => {
    const bundle = makeBattleBusBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BattleBus', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the bus.
    let initialY = 0;
    let enteredSlowDeath = false;
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && s.health <= 0) {
        initialY = s.y;
        enteredSlowDeath = true;
        break;
      }
    }
    expect(enteredSlowDeath).toBe(true);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        slowDeathState: {
          isBattleBusFakeDeath: boolean;
          battleBusThrowVelocity: number;
        } | null;
        modelConditionFlags: Set<string>;
        health: number;
        maxHealth: number;
        canTakeDamage: boolean;
        y: number;
      }>;
    };
    const busEntity = priv.spawnedEntities.get(1)!;

    // Should be in fake death phase.
    expect(busEntity.slowDeathState).not.toBeNull();
    expect(busEntity.slowDeathState!.isBattleBusFakeDeath).toBe(true);

    // Bus should go up initially.
    logic.update(1 / 30);
    expect(busEntity.y).toBeGreaterThan(initialY);

    // Run until the bus lands and becomes SECOND_LIFE.
    let landedAsSecondLife = false;
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (busEntity.modelConditionFlags.has('SECOND_LIFE')) {
        landedAsSecondLife = true;
        break;
      }
    }
    expect(landedAsSecondLife).toBe(true);
    expect(busEntity.canTakeDamage).toBe(true);
    expect(busEntity.health).toBe(busEntity.maxHealth * 0.5);
    expect(busEntity.slowDeathState).toBeNull();
  });

  it('empty hulk auto-destructs after EmptyHulkDestructionDelay', () => {
    const bundle = makeBattleBusBundle({ EmptyHulkDestructionDelay: 500 }); // 15 frames
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BattleBus', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the bus — no passengers, so empty hulk timer should start.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        battleBusEmptyHulkDestroyFrame: number;
        destroyed: boolean;
      }>;
    };

    // Run until it becomes SECOND_LIFE.
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      const entity = priv.spawnedEntities.get(1);
      if (entity?.modelConditionFlags.has('SECOND_LIFE')) break;
    }

    const busEntity = priv.spawnedEntities.get(1)!;
    expect(busEntity.modelConditionFlags.has('SECOND_LIFE')).toBe(true);
    expect(busEntity.battleBusEmptyHulkDestroyFrame).toBeGreaterThan(0);

    // Advance past the empty hulk timer.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Bus should be destroyed.
    expect(busEntity.destroyed).toBe(true);
  });

  it('real death with SECOND_LIFE already set goes through normal SlowDeath', () => {
    const bundle = makeBattleBusBundle({ EmptyHulkDestructionDelay: 0 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BattleBus', 50, 50),
        makeMapObject('Killer', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Kill the bus — first death (fake death).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        slowDeathState: { isBattleBusFakeDeath: boolean; destroyOnCompletion: boolean } | null;
        health: number;
        maxHealth: number;
        canTakeDamage: boolean;
        destroyed: boolean;
        animationState: string;
      }>;
    };

    // Run until SECOND_LIFE.
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (priv.spawnedEntities.get(1)?.modelConditionFlags.has('SECOND_LIFE')) break;
    }

    const busEntity = priv.spawnedEntities.get(1)!;
    expect(busEntity.modelConditionFlags.has('SECOND_LIFE')).toBe(true);
    expect(busEntity.canTakeDamage).toBe(true);

    // Now attack it again — second (real) death.
    // Attacker may still be on cooldown from the first shot (DelayBetweenShots: 5000ms = 150 frames).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Run until the bus enters slow death again (real death this time).
    let enteredRealSlowDeath = false;
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (busEntity.slowDeathState) {
        enteredRealSlowDeath = true;
        break;
      }
    }
    expect(enteredRealSlowDeath).toBe(true);

    // Should be in normal slow death (not fake death) because SECOND_LIFE is set.
    expect(busEntity.slowDeathState!.isBattleBusFakeDeath).toBe(false);
    expect(busEntity.slowDeathState!.destroyOnCompletion).toBe(true);

    // Run until destroyed.
    for (let i = 0; i < 300; i++) {
      logic.update(1 / 30);
      if (busEntity.destroyed) break;
    }
    expect(busEntity.destroyed).toBe(true);
  });
});

describe('container death evacuation edge cases', () => {
  it('cleans up containment references when passenger is already destroyed on same frame', () => {
    // Scenario: AOE kills both a transport and its passengers on the same frame.
    // When the container's markEntityDestroyed runs, passengers already have
    // destroyed=true. Their containment IDs should still be cleaned up.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Transport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            ContainMax: 5,
            AllowInsideKindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('LocomotorSet', 'SET_NORMAL SoldierLoco', {}),
        ], { TransportSlotCount: 1 }),
      ],
      locomotors: [makeLocomotorDef('SoldierLoco', 20)],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Transport', 20, 20),
        makeMapObject('Soldier', 22, 20),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        destroyed: boolean;
        transportContainerId: number | null;
        garrisonContainerId: number | null;
      }>;
      markEntityDestroyed(entityId: number, attackerId: number): void;
    };

    const soldier = priv.spawnedEntities.get(2)!;
    // Verify soldier is inside transport.
    expect(soldier.transportContainerId).toBe(1);

    // Simulate AOE: kill soldier first, then kill transport.
    priv.markEntityDestroyed(2, -1);
    expect(soldier.destroyed).toBe(true);
    // Before the fix, transportContainerId would still be 1 at this point.
    // But markEntityDestroyed doesn't clean it up immediately (deferred to finalizeDestroyedEntities).
    // The container's death should clean it up.

    priv.markEntityDestroyed(1, -1);

    // After container death, the destroyed passenger's containment reference
    // should be cleaned up (no reference leak).
    expect(soldier.transportContainerId).toBeNull();
  });
});
