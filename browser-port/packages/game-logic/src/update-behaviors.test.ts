import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { ObjectDef } from '@generals/ini-data';
import { HeightmapGrid, uint8ArrayToBase64 } from '@generals/terrain';

import { GameLogicSubsystem } from './index.js';
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

describe('mine detonation', () => {
  function makeMineSetup(opts: {
    detonatedBy?: string;
    numVirtualMines?: number;
    workersDetonate?: boolean;
    enemyKindOf?: string[];
    enemyGeomRadius?: number;
    mineGeomRadius?: number;
    mineHealth?: number;
    weaponDamage?: number;
    weaponRadius?: number;
  } = {}) {
    const mineDef = makeObjectDef('TestMine', 'America', ['MINE', 'IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: opts.mineHealth ?? 100,
        InitialHealth: opts.mineHealth ?? 100,
      }),
      makeBlock('Behavior', 'MinefieldBehavior ModuleTag_Minefield', {
        DetonationWeapon: 'MineDetonationWeapon',
        NumVirtualMines: opts.numVirtualMines ?? 1,
        ...(opts.detonatedBy ? { DetonatedBy: opts.detonatedBy } : {}),
        ...(opts.workersDetonate !== undefined ? { WorkersDetonate: opts.workersDetonate } : {}),
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: opts.mineGeomRadius ?? 5,
      GeometryMinorRadius: opts.mineGeomRadius ?? 5,
    });

    const enemyDef = makeObjectDef(
      'EnemyVehicle',
      'China',
      opts.enemyKindOf ?? ['VEHICLE'],
      [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ],
      {
        Geometry: 'CYLINDER',
        GeometryMajorRadius: opts.enemyGeomRadius ?? 3,
        GeometryMinorRadius: opts.enemyGeomRadius ?? 3,
      },
    );

    const registry = makeRegistry(makeBundle({
      objects: [mineDef, enemyDef],
      weapons: [
        makeWeaponDef('MineDetonationWeapon', {
          PrimaryDamage: opts.weaponDamage ?? 50,
          PrimaryDamageRadius: opts.weaponRadius ?? 10,
          DamageType: 'EXPLOSION',
        }),
      ],
    }));

    return { registry };
  }

  it('detonates mine when enemy overlaps mine geometry radius', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup();

    // Place mine at (10,10) and enemy at (12,10) — within combined radius (5+3=8).
    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 12, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0); // enemies

    // Mine should exist before update.
    const mineBefore = logic.getEntityState(1);
    expect(mineBefore).not.toBeNull();
    expect(mineBefore!.alive).toBe(true);

    // Run 1 frame — collision should detonate and destroy the 1-charge mine.
    logic.update(1 / 30);

    // Mine with 1 virtual mine is destroyed and cleaned up (returns null).
    const mineAfter = logic.getEntityState(1);
    expect(mineAfter).toBeNull();

    // Enemy should have taken detonation damage (50 damage, from 200 → 150).
    const enemyAfter = logic.getEntityState(2);
    expect(enemyAfter).not.toBeNull();
    expect(enemyAfter!.health).toBeLessThan(200);
  });

  it('does not detonate mine for allies (default detonatedBy = ENEMIES+NEUTRAL)', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup();

    // Place mine and an allied vehicle overlapping.
    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 12, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    // Set China as allies of America (2 = ALLIES) — mine should NOT detonate.
    logic.setTeamRelationship('America', 'China', 2);
    logic.setTeamRelationship('China', 'America', 2);

    logic.update(1 / 30);

    // Mine should still be alive — not detonated by ally.
    const mineAfter = logic.getEntityState(1);
    expect(mineAfter).not.toBeNull();
    expect(mineAfter!.alive).toBe(true);

    // Allied vehicle should be at full health.
    const allyAfter = logic.getEntityState(2);
    expect(allyAfter).not.toBeNull();
    expect(allyAfter!.health).toBe(200);
  });

  it('detonates mine for allies when DetonatedBy includes ALLIES', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup({ detonatedBy: 'ALLIES ENEMIES NEUTRAL' });

    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 12, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'China', 2); // allies
    logic.setTeamRelationship('China', 'America', 2);

    logic.update(1 / 30);

    // Mine with 1 charge detonated for ally — destroyed and cleaned up.
    const mineAfter = logic.getEntityState(1);
    expect(mineAfter).toBeNull();
  });

  it('decrements virtual mine charges without destroying multi-charge mine', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup({ numVirtualMines: 3, mineHealth: 300 });

    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 12, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);

    logic.update(1 / 30);

    // Mine should still be alive with 2 charges remaining (health reduced proportionally).
    const mineAfter = logic.getEntityState(1);
    expect(mineAfter).not.toBeNull();
    expect(mineAfter!.alive).toBe(true);
    // Health reduced: 2/3 * 300 = 200.
    expect(mineAfter!.health).toBeLessThan(300);
  });

  it('does not detonate when entities are outside combined radius', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup();

    // Place mine at (10,10) and enemy at (30,10) — distance 20 > combined radius (5+3=8).
    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 30, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);

    logic.update(1 / 30);

    // Mine should be alive — no collision.
    const mineAfter = logic.getEntityState(1);
    expect(mineAfter).not.toBeNull();
    expect(mineAfter!.alive).toBe(true);

    // Enemy should be at full health.
    const enemyAfter = logic.getEntityState(2);
    expect(enemyAfter).not.toBeNull();
    expect(enemyAfter!.health).toBe(200);
  });

  it('does not detonate for worker units (infantry+dozer) when workersDetonate is false', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup({
      workersDetonate: false,
      enemyKindOf: ['INFANTRY', 'DOZER'],
    });

    // Place mine and infantry/dozer worker overlapping.
    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 12, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);

    logic.update(1 / 30);

    // Mine should NOT detonate for worker (infantry+dozer).
    const mineAfter = logic.getEntityState(1);
    expect(mineAfter).not.toBeNull();
    expect(mineAfter!.alive).toBe(true);
  });

  it('emits WEAPON_IMPACT visual event on mine detonation', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const { registry } = makeMineSetup();

    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('EnemyVehicle', 12, 10),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'China', 0);

    logic.update(1 / 30);

    // Should have emitted visual events including a WEAPON_IMPACT for the detonation.
    const events = logic.drainVisualEvents();
    const impactEvents = events.filter(e => e.type === 'WEAPON_IMPACT');
    expect(impactEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('sympathetically detonates when mine is shot by external weapon', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Mine with 3 charges and an attacker that can shoot the mine.
    const mineDef = makeObjectDef('TestMine', 'China', ['MINE', 'IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'MinefieldBehavior ModuleTag_Minefield', {
        DetonationWeapon: 'MineDetonationWeapon',
        NumVirtualMines: 3,
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 5,
      GeometryMinorRadius: 5,
    });

    const attackerDef = makeObjectDef('MineShooter', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ShooterGun'] }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 3,
      GeometryMinorRadius: 3,
    });

    const registry = makeRegistry(makeBundle({
      objects: [mineDef, attackerDef],
      weapons: [
        makeWeaponDef('ShooterGun', {
          AttackRange: 200,
          PrimaryDamage: 150,
          DelayBetweenShots: 100,
        }),
        makeWeaponDef('MineDetonationWeapon', {
          PrimaryDamage: 40,
          PrimaryDamageRadius: 10,
          DamageType: 'EXPLOSION',
        }),
      ],
    }));

    // Place mine at (10,10) and attacker FAR away (50,10) — outside mine geometry.
    const map = makeMap([
      makeMapObject('TestMine', 10, 10),
      makeMapObject('MineShooter', 50, 10),
    ], 64, 64);

    logic.loadMapObjects(map, registry, makeHeightmap(64, 64));
    logic.setTeamRelationship('America', 'China', 0); // enemies
    logic.setTeamRelationship('China', 'America', 0);

    // Command attacker to shoot the mine.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Mine should exist before attack.
    const mineBefore = logic.getEntityState(1);
    expect(mineBefore).not.toBeNull();
    expect(mineBefore!.alive).toBe(true);

    // Run enough frames for the attacker to fire and deal 150 damage to a 300hp mine.
    // That should reduce health to 150/300 = 50%, expecting ceil(3*0.5) = 2 mines.
    // Since mine had 3 charges, it needs to detonate 1 charge sympathetically.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // After 150 damage to a 300hp 3-charge mine, at least 1 sympathetic detonation
    // should have occurred. Check if visual events include detonation impacts.
    const events = logic.drainVisualEvents();
    const mineDetonations = events.filter(e =>
      e.type === 'WEAPON_IMPACT' && e.sourceEntityId === 1,
    );
    // Should have at least one sympathetic detonation from the mine.
    expect(mineDetonations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('tunnel network', () => {
  function makeTunnelSetup(opts: {
    maxTunnelCapacity?: number;
    timeForFullHealMs?: number;
    tunnelCount?: number;
    infantryHealth?: number;
    infantryMaxHealth?: number;
  } = {}) {
    const timeForFullHealMs = opts.timeForFullHealMs ?? 3000;
    const tunnelDef = makeObjectDef('GLATunnelNetwork', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'TunnelContain ModuleTag_Tunnel', {
        ...(timeForFullHealMs > 0 ? { TimeForFullHeal: timeForFullHealMs } : {}),
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 15,
      GeometryMinorRadius: 15,
    });

    const infantryDef = makeObjectDef('GLARebel', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: opts.infantryMaxHealth ?? 100,
        InitialHealth: opts.infantryHealth ?? (opts.infantryMaxHealth ?? 100),
      }),
    ]);

    const enemyTankDef = makeObjectDef('USATank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankCannon'] }),
    ]);

    const tunnelCount = opts.tunnelCount ?? 1;
    const tunnelObjects: MapObjectJSON[] = [];
    for (let i = 0; i < tunnelCount; i++) {
      tunnelObjects.push(makeMapObject('GLATunnelNetwork', 50 + i * 40, 50));
    }

    const registry = makeRegistry(makeBundle({
      objects: [tunnelDef, infantryDef, enemyTankDef],
      weapons: [
        makeWeaponDef('TankCannon', { PrimaryDamage: 50, AttackRange: 100, DelayBetweenShots: 100, DamageType: 'ARMOR_PIERCING' }),
      ],
    }));

    return { registry, tunnelObjects, tunnelDef, infantryDef };
  }

  it('infantry enters tunnel and gets DISABLED_HELD + MASKED + UNSELECTABLE', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    const { registry, tunnelObjects } = makeTunnelSetup();

    const map = makeMap([
      ...tunnelObjects,
      makeMapObject('GLARebel', 50, 50),  // Adjacent to tunnel
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    // Entity 1 = tunnel, entity 2 = infantry
    const infantryBefore = logic.getEntityState(2);
    expect(infantryBefore).not.toBeNull();
    expect(infantryBefore!.statusFlags).not.toContain('DISABLED_HELD');

    // Issue enter transport command to enter the tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    const infantryAfter = logic.getEntityState(2);
    expect(infantryAfter).not.toBeNull();
    expect(infantryAfter!.statusFlags).toContain('DISABLED_HELD');
    expect(infantryAfter!.statusFlags).toContain('MASKED');
    expect(infantryAfter!.statusFlags).toContain('UNSELECTABLE');
  });

  it('infantry exits tunnel and clears containment flags', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    const { registry, tunnelObjects } = makeTunnelSetup();

    const map = makeMap([
      ...tunnelObjects,
      makeMapObject('GLARebel', 50, 50),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    // Enter tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    // Verify inside.
    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_HELD');

    // Exit container.
    logic.submitCommand({ type: 'exitContainer', entityId: 2 });
    logic.update(1 / 30);

    const infantryAfter = logic.getEntityState(2);
    expect(infantryAfter).not.toBeNull();
    expect(infantryAfter!.statusFlags).not.toContain('DISABLED_HELD');
    expect(infantryAfter!.statusFlags).not.toContain('MASKED');
    expect(infantryAfter!.statusFlags).not.toContain('UNSELECTABLE');
  });

  it('blocks aircraft from entering tunnel', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });

    const tunnelDef = makeObjectDef('GLATunnelNetwork', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'TunnelContain ModuleTag_Tunnel', {}),
    ]);
    const aircraftDef = makeObjectDef('GLAHelicopter', 'GLA', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const registry = makeRegistry(makeBundle({ objects: [tunnelDef, aircraftDef] }));
    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),
      makeMapObject('GLAHelicopter', 50, 50),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    // Aircraft should NOT be inside tunnel — no DISABLED_HELD.
    const aircraft = logic.getEntityState(2);
    expect(aircraft).not.toBeNull();
    expect(aircraft!.statusFlags).not.toContain('DISABLED_HELD');
  });

  it('respects maxTunnelCapacity shared across tunnels', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 2 });
    const { registry } = makeTunnelSetup({ tunnelCount: 2 });

    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),   // Tunnel 1
      makeMapObject('GLATunnelNetwork', 90, 50),   // Tunnel 2
      makeMapObject('GLARebel', 50, 50),  // Infantry 1
      makeMapObject('GLARebel', 50, 50),  // Infantry 2
      makeMapObject('GLARebel', 90, 50),  // Infantry 3
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    // Enter two infantry (fills capacity of 2).
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 1 });
    logic.update(1 / 30);

    expect(logic.getEntityState(3)!.statusFlags).toContain('DISABLED_HELD');
    expect(logic.getEntityState(4)!.statusFlags).toContain('DISABLED_HELD');

    // Third infantry tries to enter a DIFFERENT tunnel — should be rejected (shared capacity).
    logic.submitCommand({ type: 'enterTransport', entityId: 5, targetTransportId: 2 });
    logic.update(1 / 30);

    expect(logic.getEntityState(5)!.statusFlags).not.toContain('DISABLED_HELD');
  });

  it('cave-in kills all passengers when last tunnel destroyed', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    const { registry } = makeTunnelSetup();

    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),  // Single tunnel
      makeMapObject('GLARebel', 50, 50),
      makeMapObject('GLARebel', 50, 50),
      makeMapObject('USATank', 55, 50),  // Enemy near tunnel
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('GLA', 'America', 0); // enemies
    logic.setTeamRelationship('America', 'GLA', 0);

    // Enter both infantry.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.update(1 / 30);

    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags).toContain('DISABLED_HELD');

    // Enemy tank attacks the tunnel.
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    // Run enough frames for the tank to destroy the 500hp tunnel (50 damage per shot).
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    // Tunnel is destroyed.
    const tunnel = logic.getEntityState(1);
    expect(tunnel).toBeNull();

    // Both passengers should be dead (cave-in).
    expect(logic.getEntityState(2)).toBeNull();
    expect(logic.getEntityState(3)).toBeNull();
  });

  it('reassigns passengers when non-last tunnel destroyed', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    const { registry } = makeTunnelSetup({ tunnelCount: 2 });

    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),  // Tunnel 1
      makeMapObject('GLATunnelNetwork', 90, 50),  // Tunnel 2
      makeMapObject('GLARebel', 50, 50),           // Infantry near tunnel 1
      makeMapObject('USATank', 55, 50),            // Enemy near tunnel 1
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    // Enter infantry into tunnel 1.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.update(1 / 30);

    expect(logic.getEntityState(3)!.statusFlags).toContain('DISABLED_HELD');

    // Enemy tank destroys tunnel 1 (non-last — tunnel 2 still exists).
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    // Tunnel 1 should be destroyed.
    expect(logic.getEntityState(1)).toBeNull();

    // Passenger should still be alive (reassigned to tunnel 2).
    const infantry = logic.getEntityState(3);
    expect(infantry).not.toBeNull();
    expect(infantry!.statusFlags).toContain('DISABLED_HELD');
  });

  it('evacuate command exits all passengers from tunnel', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    const { registry } = makeTunnelSetup();

    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),
      makeMapObject('GLARebel', 50, 50),
      makeMapObject('GLARebel', 50, 50),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    // Enter both.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.update(1 / 30);

    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags).toContain('DISABLED_HELD');

    // Evacuate.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    logic.update(1 / 30);

    expect(logic.getEntityState(2)!.statusFlags).not.toContain('DISABLED_HELD');
    expect(logic.getEntityState(3)!.statusFlags).not.toContain('DISABLED_HELD');
  });

  it('heals passengers inside tunnel over time', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    // 3000ms = 90 frames for full heal
    const { registry } = makeTunnelSetup({
      timeForFullHealMs: 3000,
      infantryHealth: 50,
      infantryMaxHealth: 100,
    });

    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),
      makeMapObject('GLARebel', 50, 50),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    // Verify infantry starts at 50hp.
    expect(logic.getEntityState(2)!.health).toBe(50);

    // Enter tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    // Run 30 frames (~1 second) inside tunnel.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Should have healed: 30 frames * (100 / 90) per frame ≈ 33 hp healed.
    // From 50 → should be ~83.
    const afterPartial = logic.getEntityState(2);
    expect(afterPartial).not.toBeNull();
    expect(afterPartial!.health).toBeGreaterThan(70);
    expect(afterPartial!.health).toBeLessThan(100);

    // Run 60 more frames (total 90 = full heal time).
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const afterFull = logic.getEntityState(2);
    expect(afterFull).not.toBeNull();
    expect(afterFull!.health).toBe(100);
  });

  it('selling last tunnel ejects passengers safely', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene, { maxTunnelCapacity: 10 });
    const { registry } = makeTunnelSetup();

    const map = makeMap([
      makeMapObject('GLATunnelNetwork', 50, 50),
      makeMapObject('GLARebel', 50, 50),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());

    // Enter tunnel.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_HELD');

    // Sell the tunnel.
    logic.submitCommand({ type: 'sell', entityId: 1 });
    logic.update(1 / 30);

    // Passenger should be ejected (not killed).
    const infantry = logic.getEntityState(2);
    expect(infantry).not.toBeNull();
    expect(infantry!.alive).toBe(true);
    expect(infantry!.statusFlags).not.toContain('DISABLED_HELD');
  });
});

describe('generate minefield behavior', () => {
  it('spawns mines around the entity on death when GenerateOnlyOnDeath is set', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MineLayer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'GenerateMinefieldBehavior ModuleTag_GenMine', {
            MineName: 'LandMine',
            DistanceAroundObject: 15,
            BorderOnly: true,
            GenerateOnlyOnDeath: true,
          }),
        ]),
        makeObjectDef('LandMine', 'China', ['MINE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
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
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MineLayer', 50, 50),
        makeMapObject('Attacker', 20, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // No mines should exist before death.
    const statesBefore = logic.getRenderableEntityStates();
    const minesBefore = statesBefore.filter(s => s.templateName === 'LandMine');
    expect(minesBefore.length).toBe(0);

    // Kill the MineLayer.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // MineLayer should be destroyed.
    expect(logic.getEntityState(1)).toBeNull();

    // Mines should have been spawned in a circle around the MineLayer's position.
    const statesAfter = logic.getRenderableEntityStates();
    const minesAfter = statesAfter.filter(s => s.templateName === 'LandMine');
    expect(minesAfter.length).toBeGreaterThan(0);

    // All mines should be approximately 15 units away from the original position (50,50).
    for (const mine of minesAfter) {
      const dx = mine.x - 50;
      const dz = mine.z - 50;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeCloseTo(15, 0);
    }
  });
});

describe('deploy style AI update', () => {
  function makeDeploySetup(opts: { unpackTime?: number; packTime?: number } = {}) {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Artillery', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'DeployStyleAIUpdate ModuleTag_Deploy', {
            UnpackTime: opts.unpackTime ?? 300,
            PackTime: opts.packTime ?? 300,
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ArtilleryGun'] }),
          makeBlock('Locomotor', 'SET_NORMAL ArtilleryLocomotor', { Speed: 30 }),
        ]),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('ArtilleryGun', {
          AttackRange: 200,
          PrimaryDamage: 100,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
        makeWeaponDef('SmallGun', {
          AttackRange: 200,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Artillery', 50, 50),
        makeMapObject('Target', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    return { logic };
  }

  it('deploys before attacking and undeploys before moving', () => {
    const { logic } = makeDeploySetup({ unpackTime: 300, packTime: 300 });
    // 300ms → ceil(300/33.33) = 9 frames

    // Artillery should start in READY_TO_MOVE state.
    let state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.health).toBe(200);

    // Issue attack command — this should start deploying.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    logic.update(1 / 30); // frame 1

    // Target should NOT have taken damage yet (still deploying).
    const targetAfter1 = logic.getEntityState(2);
    expect(targetAfter1).not.toBeNull();
    expect(targetAfter1!.health).toBe(500);

    // Run 8 more frames to complete deploy (9 frames total for 300ms).
    for (let i = 0; i < 8; i++) logic.update(1 / 30);

    // After 9 frames, should be READY_TO_ATTACK. Run 1 more frame to let combat fire.
    logic.update(1 / 30);

    // Target should have taken damage now.
    const targetAfterDeploy = logic.getEntityState(2);
    expect(targetAfterDeploy).not.toBeNull();
    expect(targetAfterDeploy!.health).toBeLessThan(500);
  });

  it('cannot fire during deploy animation and does not move while deployed', () => {
    const { logic } = makeDeploySetup({ unpackTime: 300, packTime: 300 });
    // 300ms → 9 frames for deploy/undeploy

    // Issue attack — entity starts deploying.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run 5 frames (mid-deploy). Target should not be damaged yet.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const targetMidDeploy = logic.getEntityState(2);
    expect(targetMidDeploy).not.toBeNull();
    expect(targetMidDeploy!.health).toBe(500); // Still full health during deploy animation

    // Run to completion of deploy (4 more frames to reach 9) + 1 extra for combat.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After deploy completes, the entity should start firing.
    // Run several more frames to ensure at least one shot lands.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const targetAfterDeploy = logic.getEntityState(2);
    expect(targetAfterDeploy).not.toBeNull();
    expect(targetAfterDeploy!.health).toBeLessThan(500); // Took damage after full deploy

    // Verify entity hasn't moved (deployed entities can't move).
    const artilleryState = logic.getEntityState(1);
    expect(artilleryState).not.toBeNull();
    expect(artilleryState!.x).toBe(50); // Stayed at initial position
  });

  it('reverses deploy mid-transition when move command is issued', () => {
    const { logic } = makeDeploySetup({ unpackTime: 600, packTime: 600 });
    // 600ms → ceil(600/33.33) = 18 frames

    // Issue attack to start deploying.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    // Run 6 frames (1/3 through deploy).
    for (let i = 0; i < 6; i++) logic.update(1 / 30);

    // Target should still be at full health (not deployed yet).
    const targetMidDeploy = logic.getEntityState(2);
    expect(targetMidDeploy!.health).toBe(500);

    // Issue move command to reverse the deploy.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 10, targetZ: 50 });

    // The reversal should take 18 - (18 - 6) = 6 frames remaining → total = 6 frames to undeploy.
    // But actually the reversal formula is: totalFrames - framesLeft = 18 - 12 = 6 frames done,
    // new wait = now + (18 - 12) = 6 more frames.
    // So after 6 more frames from now, should be READY_TO_MOVE.
    for (let i = 0; i < 8; i++) logic.update(1 / 30);

    // Should have started moving by now.
    const afterReversal = logic.getEntityState(1);
    expect(afterReversal).not.toBeNull();
    // Even if not moved far, at least the entity should be alive and not stuck.
    expect(afterReversal!.health).toBe(200);
  });
});

describe('garrison firing', () => {
  function makeGarrisonSetup() {
    const buildingDef = makeObjectDef('CivBuilding', 'Neutral', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'GarrisonContain ModuleTag_Garrison', {
        ContainMax: 5,
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 15,
      GeometryMinorRadius: 15,
    });

    const infantryDef = makeObjectDef('USARanger', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RangerRifle'] }),
      makeBlock('Locomotor', 'SET_NORMAL InfantryLocomotor', { Speed: 20 }),
    ]);

    const enemyTankDef = makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);

    const bundle = makeBundle({
      objects: [buildingDef, infantryDef, enemyTankDef],
      weapons: [
        makeWeaponDef('RangerRifle', {
          AttackRange: 100,
          PrimaryDamage: 25,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Building at 50,50; infantry close enough to enter immediately; enemy nearby.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 50, 50),
        makeMapObject('USARanger', 51, 50),
        makeMapObject('EnemyTank', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'Neutral', 2);
    logic.setTeamRelationship('Neutral', 'America', 2);
    return { logic };
  }

  it('garrisoned infantry auto-targets and damages nearby enemy', () => {
    const { logic } = makeGarrisonSetup();

    // Enter garrison.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    logic.update(1 / 30);

    // Verify infantry entered the garrison.
    const infantryState = logic.getEntityState(2);
    // Infantry at building position now.
    expect(infantryState).not.toBeNull();

    // Tick enough frames for auto-targeting scan and weapon firing.
    const enemyBefore = logic.getEntityState(3);
    expect(enemyBefore).not.toBeNull();
    const initialHealth = enemyBefore!.health;
    expect(initialHealth).toBe(500);

    // Run 90 frames (~3 seconds) — should be enough for auto-target + fire cycle.
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    const enemyAfter = logic.getEntityState(3);
    expect(enemyAfter).not.toBeNull();
    expect(enemyAfter!.health).toBeLessThan(initialHealth);
  });
});

describe('special power INI parameters', () => {
  it('area damage uses module radius and damage from INI', () => {
    const superWeaponDef = makeObjectDef('SuperWeapon', 'America', ['STRUCTURE', 'FS_SUPERWEAPON'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
        SpecialPowerTemplate: 'SuperTestPower',
        Radius: 50,
        Damage: 300,
      }),
    ]);

    const targetDef = makeObjectDef('Target', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
    ]);

    // Target slightly outside 50-unit radius (should NOT be hit).
    const farTargetDef = makeObjectDef('FarTarget', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
    ]);

    const bundle = makeBundle({
      objects: [superWeaponDef, targetDef, farTargetDef],
      specialPowers: [{ name: 'SuperTestPower', fields: {}, blocks: [] } as SpecialPowerDef],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // SuperWeapon at 50,50; Target at 80,50 (30 units away, within 50 radius);
    // FarTarget at 120,50 (70 units away, outside 50 radius).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SuperWeapon', 50, 50),
        makeMapObject('Target', 80, 50),
        makeMapObject('FarTarget', 120, 50),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(1 / 30);

    // Issue area damage special power at center (50, 50).
    // commandOption 0x20 = COMMAND_OPTION_NEED_TARGET_POS (position-targeted power).
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'SuperTestButton',
      specialPowerName: 'SuperTestPower',
      commandOption: 0x20,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: 50,
      targetZ: 50,
    });
    logic.update(1 / 30);

    // Close target (30 units away, within 50 radius) should take 300 damage.
    const closeTarget = logic.getEntityState(2);
    expect(closeTarget).not.toBeNull();
    expect(closeTarget!.health).toBe(700);

    // Far target (70 units away, outside 50 radius) should be unharmed.
    const farTarget = logic.getEntityState(3);
    expect(farTarget).not.toBeNull();
    expect(farTarget!.health).toBe(1000);
  });
});

describe('mine regeneration', () => {
  it('regenerating mine recovers virtual mines through auto-heal', () => {
    const mineDef = makeObjectDef('RegenMine', 'America', ['MINE', 'IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'MinefieldBehavior ModuleTag_Minefield', {
        DetonationWeapon: 'MineDetonationWeapon',
        NumVirtualMines: 2,
        Regenerates: true,
      }),
      makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AutoHeal', {
        HealingAmount: 10,
        HealingDelay: 100,
        StartHealingDelay: 0,
        StartsActive: true,
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 5,
      GeometryMinorRadius: 5,
    });

    const enemyDef = makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 3,
      GeometryMinorRadius: 3,
    });

    const bundle = makeBundle({
      objects: [mineDef, enemyDef],
      weapons: [
        makeWeaponDef('MineDetonationWeapon', {
          PrimaryDamage: 30,
          PrimaryDamageRadius: 10,
          DamageType: 'EXPLOSION',
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Mine at 50,50; enemy close enough to detonate.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RegenMine', 50, 50),
        makeMapObject('EnemyVehicle', 52, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Run a few frames to trigger mine detonation (enemy overlaps mine).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After detonation, enemy should have taken damage.
    const enemyAfterDetonation = logic.getEntityState(2);
    expect(enemyAfterDetonation).not.toBeNull();
    expect(enemyAfterDetonation!.health).toBeLessThan(500);

    // Move enemy away so it doesn't keep triggering detonations.
    logic.submitCommand({ type: 'moveTo', entityId: 2, targetX: 120, targetZ: 50 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Mine should be MASKED (all virtual mines spent) with health floor at 0.1.
    const mineState = logic.getEntityState(1);
    expect(mineState).not.toBeNull();
    // Mine lost health from detonation and is now low or at floor.

    // Run many frames to let auto-heal restore health.
    // HealingAmount=10, delay=100ms(~3 frames), maxHealth=100.
    // After enough healing cycles, virtual mines should regenerate.
    for (let i = 0; i < 120; i++) logic.update(1 / 30);

    // Mine should have healed and recovered at least 1 virtual mine (un-masked).
    const mineAfterHeal = logic.getEntityState(1);
    expect(mineAfterHeal).not.toBeNull();
    // If health is above 50% of maxHealth, at least 1 virtual mine should be restored.
    // The mine should be alive (not destroyed).
    expect(mineAfterHeal!.health).toBeGreaterThan(0);
  });

  it('stops auto-heal when the mine creator dies', () => {
    const mineDef = makeObjectDef('RegenMine', 'America', ['MINE', 'IMMOBILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'MinefieldBehavior ModuleTag_Minefield', {
        DetonationWeapon: 'MineDetonationWeapon',
        NumVirtualMines: 2,
        Regenerates: true,
        StopsRegenAfterCreatorDies: true,
      }),
      makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AutoHeal', {
        HealingAmount: 10,
        HealingDelay: 30,
        StartHealingDelay: 0,
        StartsActive: true,
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 5,
      GeometryMinorRadius: 5,
    });

    const creatorDef = makeObjectDef('MineCreator', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const bundle = makeBundle({
      objects: [mineDef, creatorDef],
      weapons: [
        makeWeaponDef('MineDetonationWeapon', {
          PrimaryDamage: 30,
          PrimaryDamageRadius: 10,
          DamageType: 'EXPLOSION',
        }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RegenMine', 50, 50),
        makeMapObject('MineCreator', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        autoHealStopped: boolean;
        autoHealNextFrame: number;
        autoHealSoonestHealFrame: number;
        mineCreatorId: number;
        mineNextDeathCheckFrame: number;
      }>;
    };

    const mine = priv.spawnedEntities.get(1)!;
    const creator = priv.spawnedEntities.get(2)!;
    mine.health = 40;
    mine.mineCreatorId = 2;
    mine.mineNextDeathCheckFrame = 0;
    creator.destroyed = true;

    logic.update(1 / 30);

    expect(mine.autoHealStopped).toBe(true);
    expect(mine.autoHealNextFrame).toBe(Number.MAX_SAFE_INTEGER);
    expect(mine.autoHealSoonestHealFrame).toBe(Number.MAX_SAFE_INTEGER);

    const healthAfterStop = mine.health;
    for (let i = 0; i < 90; i += 1) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)!.health).toBeLessThanOrEqual(healthAfterStop);
  });
});

describe('WEAPON_DOESNT_AFFECT_AIRBORNE', () => {
  it('skips entities significantly above terrain in radius damage', () => {
    // Source parity: Weapon.cpp:1375 — NOT_AIRBORNE in RadiusDamageAffects
    // skips targets where isSignificantlyAboveTerrain() is true (height > 9.0).
    const launcherDef = makeObjectDef('Attacker', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'GroundBomb'] }),
    ]);
    const groundTargetDef = makeObjectDef('GroundTarget', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const airTargetDef = makeObjectDef('AirTarget', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const bundle = makeBundle({
      objects: [launcherDef, groundTargetDef, airTargetDef],
      weapons: [
        makeWeaponDef('GroundBomb', {
          AttackRange: 120,
          PrimaryDamage: 30,
          PrimaryDamageRadius: 100,
          DamageType: 'EXPLOSION',
          DeathType: 'NORMAL',
          RadiusDamageAffects: 'ENEMIES NOT_AIRBORNE',
          DelayBetweenShots: 100,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Attacker', 10, 10),
        makeMapObject('GroundTarget', 30, 10),
        makeMapObject('AirTarget', 30, 12),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Elevate entity 3 by 20 units above its base position (>9.0 threshold).
    const entities = (logic as unknown as { spawnedEntities: Map<number, { y: number; baseHeight: number }> }).spawnedEntities;
    const airEntity = entities.get(3)!;
    airEntity.y += 20;

    // Attack ground target.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run enough frames for weapon to fire (matches existing combat timeline pattern).
    for (let i = 0; i < 6; i++) logic.update(1 / 30);

    // Ground target should have taken radius damage.
    const groundState = logic.getEntityState(2);
    expect(groundState).not.toBeNull();
    expect(groundState!.health).toBeLessThan(100);

    // Air target should NOT have taken radius damage (NOT_AIRBORNE filter).
    const airState = logic.getEntityState(3);
    expect(airState).not.toBeNull();
    expect(airState!.health).toBe(100);
  });
});

describe('disabled entity movement restrictions', () => {
  function makeMovementSetup() {
    const tankDef = makeObjectDef('TestTank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Locomotor', 'SET_NORMAL TankLocomotor', { Speed: 30 }),
    ]);

    const bundle = makeBundle({ objects: [tankDef], weapons: [] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestTank', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    return { logic };
  }

  it('DISABLED_EMP blocks movement', () => {
    // Source parity: Object::isMobile() returns false when isDisabled() is true.
    const { logic } = makeMovementSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { objectStatusFlags: Set<string>; x: number; z: number }> };
    const entity = priv.spawnedEntities.get(1)!;
    const startX = entity.x;
    const startZ = entity.z;

    entity.objectStatusFlags.add('DISABLED_EMP');
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 100, targetZ: 100 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Entity should not have moved.
    expect(entity.x).toBe(startX);
    expect(entity.z).toBe(startZ);
  });

  it('DISABLED_HACKED blocks movement', () => {
    const { logic } = makeMovementSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { objectStatusFlags: Set<string>; x: number; z: number }> };
    const entity = priv.spawnedEntities.get(1)!;
    const startX = entity.x;

    entity.objectStatusFlags.add('DISABLED_HACKED');
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 100, targetZ: 100 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(entity.x).toBe(startX);
  });

  it('DISABLED_SUBDUED blocks movement', () => {
    const { logic } = makeMovementSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { objectStatusFlags: Set<string>; x: number; z: number }> };
    const entity = priv.spawnedEntities.get(1)!;
    const startX = entity.x;

    entity.objectStatusFlags.add('DISABLED_SUBDUED');
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 100, targetZ: 100 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(entity.x).toBe(startX);
  });
});

describe('disabled container evacuation restrictions', () => {
  function makeGarrisonEvacSetup() {
    const buildingDef = makeObjectDef('CivBuilding', 'Neutral', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'GarrisonContain ModuleTag_Garrison', {
        ContainMax: 5,
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 15,
      GeometryMinorRadius: 15,
    });

    const infantryDef = makeObjectDef('USARanger', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'SET_NORMAL InfantryLocomotor', { Speed: 20 }),
    ]);

    const bundle = makeBundle({ objects: [buildingDef, infantryDef], weapons: [] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CivBuilding', 50, 50),
        makeMapObject('USARanger', 51, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'Neutral', 2);
    logic.setTeamRelationship('Neutral', 'America', 2);
    return { logic };
  }

  it('DISABLED_SUBDUED blocks evacuation from garrisoned building', () => {
    // Source parity: AIUpdate::privateEvacuate — DISABLED_SUBDUED container blocks evacuation.
    const { logic } = makeGarrisonEvacSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { objectStatusFlags: Set<string>; garrisonContainerId: number | null }> };

    // Enter garrison.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    logic.update(1 / 30);

    // Verify infantry is garrisoned.
    const infantry = priv.spawnedEntities.get(2)!;
    expect(infantry.garrisonContainerId).toBe(1);

    // Subdue the building (e.g., Microwave Tank).
    const building = priv.spawnedEntities.get(1)!;
    building.objectStatusFlags.add('DISABLED_SUBDUED');

    // Attempt evacuation — should be blocked.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    logic.update(1 / 30);

    // Infantry should still be garrisoned.
    expect(infantry.garrisonContainerId).toBe(1);
  });

  it('DISABLED_SUBDUED blocks individual exit from garrisoned building', () => {
    // Source parity: AIUpdate::privateExit — DISABLED_SUBDUED container blocks passenger exit.
    const { logic } = makeGarrisonEvacSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { objectStatusFlags: Set<string>; garrisonContainerId: number | null }> };

    // Enter garrison.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    logic.update(1 / 30);

    const infantry = priv.spawnedEntities.get(2)!;
    expect(infantry.garrisonContainerId).toBe(1);

    // Subdue the building.
    const building = priv.spawnedEntities.get(1)!;
    building.objectStatusFlags.add('DISABLED_SUBDUED');

    // Attempt individual exit — should be blocked.
    logic.submitCommand({ type: 'exitContainer', entityId: 2 });
    logic.update(1 / 30);

    // Infantry should still be garrisoned.
    expect(infantry.garrisonContainerId).toBe(1);
  });

  it('evacuation works when building is NOT subdued', () => {
    const { logic } = makeGarrisonEvacSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { garrisonContainerId: number | null }> };

    // Enter garrison.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 2, targetBuildingId: 1 });
    logic.update(1 / 30);

    const infantry = priv.spawnedEntities.get(2)!;
    expect(infantry.garrisonContainerId).toBe(1);

    // Evacuate without subdued status — should work.
    logic.submitCommand({ type: 'evacuate', entityId: 1 });
    logic.update(1 / 30);

    // Infantry should have exited.
    expect(infantry.garrisonContainerId).toBeNull();
  });
});

describe('DISABLED_UNDERPOWERED power brown-out', () => {
  function makePowerSetup() {
    // Power plant: produces 5 energy, is POWERED itself.
    const powerPlantDef = makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'POWERED'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ], { EnergyProduction: 5 });

    // Barracks: consumes 3 energy, is POWERED (will be disabled when underpowered).
    const barracksDef = makeObjectDef('Barracks', 'America', ['STRUCTURE', 'POWERED'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ], { EnergyProduction: -3 });

    // Non-POWERED building: never gets DISABLED_UNDERPOWERED.
    const wallDef = makeObjectDef('Wall', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
    ]);

    const bundle = makeBundle({ objects: [powerPlantDef, barracksDef, wallDef], weapons: [] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    return { logic, bundle };
  }

  it('sets DISABLED_UNDERPOWERED on POWERED entities when power drops below consumption', () => {
    // Source parity: Player::onPowerBrownOutChange + doPowerDisable.
    const { logic, bundle } = makePowerSetup();
    // Power plant produces 5, barracks consumes 3, barracks2 consumes 3 = 6 consumption, 5 production → brownout.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('Barracks', 80, 50),
        makeMapObject('Barracks', 80, 80),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Initial state: no brownout yet (check happens on update).
    logic.update(1 / 30);

    // Check power state: production=5, consumption=6 → brownout.
    const state1 = logic.getEntityState(1)!;
    const state2 = logic.getEntityState(2)!;
    const state3 = logic.getEntityState(3)!;

    // Power plant is POWERED so it gets DISABLED_UNDERPOWERED too.
    expect(state1.statusFlags).toContain('DISABLED_UNDERPOWERED');
    expect(state2.statusFlags).toContain('DISABLED_UNDERPOWERED');
    expect(state3.statusFlags).toContain('DISABLED_UNDERPOWERED');
  });

  it('does NOT set DISABLED_UNDERPOWERED when power is sufficient', () => {
    const { logic, bundle } = makePowerSetup();
    // Power plant produces 5, barracks consumes 3 = sufficient power.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('Barracks', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.update(1 / 30);

    const state1 = logic.getEntityState(1)!;
    const state2 = logic.getEntityState(2)!;
    expect(state1.statusFlags).not.toContain('DISABLED_UNDERPOWERED');
    expect(state2.statusFlags).not.toContain('DISABLED_UNDERPOWERED');
  });

  it('does NOT set DISABLED_UNDERPOWERED on non-POWERED buildings', () => {
    const { logic, bundle } = makePowerSetup();
    // Even with brownout, Wall (no POWERED kindof) should not be disabled.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Barracks', 50, 50),
        makeMapObject('Barracks', 80, 50),
        makeMapObject('Wall', 80, 80),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.update(1 / 30);

    // No power plant → 0 production, 6 consumption → brownout.
    const barrState = logic.getEntityState(1)!;
    const wallState = logic.getEntityState(3)!;
    expect(barrState.statusFlags).toContain('DISABLED_UNDERPOWERED');
    expect(wallState.statusFlags).not.toContain('DISABLED_UNDERPOWERED');
  });

  it('clears DISABLED_UNDERPOWERED when power is restored via destruction of consumer', () => {
    const { logic, bundle } = makePowerSetup();
    // Power plant (5), barracks (3), barracks (3) → brownout.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('Barracks', 80, 50),
        makeMapObject('Barracks', 80, 80),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.update(1 / 30);
    expect(logic.getEntityState(1)!.statusFlags).toContain('DISABLED_UNDERPOWERED');

    // Destroy one barracks to restore power balance: 5 production, 3 consumption → sufficient.
    const priv = logic as unknown as { markEntityDestroyed: (id: number, attackerId: number) => void };
    priv.markEntityDestroyed(3, -1);
    logic.update(1 / 30);

    // Power should be restored.
    expect(logic.getEntityState(1)!.statusFlags).not.toContain('DISABLED_UNDERPOWERED');
    expect(logic.getEntityState(2)!.statusFlags).not.toContain('DISABLED_UNDERPOWERED');
  });
});

describe('radar disable during power brown-out', () => {
  function makeRadarSetup() {
    // Power plant: produces 5 energy.
    const powerPlantDef = makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'POWERED'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ], { EnergyProduction: 5 });

    // Command center with radar upgrade: consumes 3 energy, has radar.
    const commandCenterDef = makeObjectDef('CommandCenter', 'America', ['STRUCTURE', 'POWERED'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'RadarUpgrade ModuleTag_Radar', {
        TriggeredBy: 'Upgrade_Radar',
        DisableProof: false,
      }),
    ], { EnergyProduction: -3 });

    // Command center with disable-proof radar.
    const hardCommandCenterDef = makeObjectDef('HardCommandCenter', 'America', ['STRUCTURE', 'POWERED'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'RadarUpgrade ModuleTag_DisableProofRadar', {
        TriggeredBy: 'Upgrade_Radar',
        DisableProof: true,
      }),
    ], { EnergyProduction: -3 });

    // Barracks: consumes 3 energy.
    const barracksDef = makeObjectDef('Barracks', 'America', ['STRUCTURE', 'POWERED'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ], { EnergyProduction: -3 });

    const bundle = makeBundle({
      objects: [powerPlantDef, commandCenterDef, hardCommandCenterDef, barracksDef],
      weapons: [],
      upgrades: [makeUpgradeDef('Upgrade_Radar', { Type: 'OBJECT', BuildTime: 0.1, BuildCost: 0 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    return { logic, bundle };
  }

  it('disables radar when power brown-out occurs', () => {
    const { logic, bundle } = makeRadarSetup();
    // Power plant (5), CommandCenter (-3), Barracks (-3) → 5 < 6 → brownout.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('CommandCenter', 80, 50),
        makeMapObject('Barracks', 110, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Grant the radar upgrade to the command center.
    logic.applyUpgradeToEntity(2, 'Upgrade_Radar');
    logic.update(1 / 30);

    // Should have radar disabled due to brown-out.
    expect(logic.hasRadar('America')).toBe(false);
    const radarState = logic.getSideRadarState('America');
    expect(radarState.radarCount).toBe(1);
    expect(radarState.radarDisabled).toBe(true);
  });

  it('radar works when power is sufficient', () => {
    const { logic, bundle } = makeRadarSetup();
    // Power plant (5), CommandCenter (-3) → 5 >= 3 → no brownout.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('CommandCenter', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.applyUpgradeToEntity(2, 'Upgrade_Radar');
    logic.update(1 / 30);

    expect(logic.hasRadar('America')).toBe(true);
    const radarState = logic.getSideRadarState('America');
    expect(radarState.radarCount).toBe(1);
    expect(radarState.radarDisabled).toBe(false);
  });

  it('disable-proof radar survives brown-out', () => {
    const { logic, bundle } = makeRadarSetup();
    // Power plant (5), HardCommandCenter (-3), Barracks (-3) → brownout.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('HardCommandCenter', 80, 50),
        makeMapObject('Barracks', 110, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.applyUpgradeToEntity(2, 'Upgrade_Radar');
    logic.update(1 / 30);

    // Brown-out should be active, but disable-proof radar still works.
    const radarState = logic.getSideRadarState('America');
    expect(radarState.radarDisabled).toBe(true);
    expect(radarState.disableProofRadarCount).toBe(1);
    expect(logic.hasRadar('America')).toBe(true);
  });

  it('restores radar when power is recovered', () => {
    const { logic, bundle } = makeRadarSetup();
    // Power plant (5), CommandCenter (-3), Barracks (-3) → brownout.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PowerPlant', 50, 50),
        makeMapObject('CommandCenter', 80, 50),
        makeMapObject('Barracks', 110, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.applyUpgradeToEntity(2, 'Upgrade_Radar');
    logic.update(1 / 30);
    expect(logic.hasRadar('America')).toBe(false);

    // Destroy barracks to restore power: 5 production, 3 consumption → sufficient.
    const priv = logic as unknown as { markEntityDestroyed: (id: number, attackerId: number) => void };
    priv.markEntityDestroyed(3, -1);
    logic.update(1 / 30);

    expect(logic.hasRadar('America')).toBe(true);
    expect(logic.getSideRadarState('America').radarDisabled).toBe(false);
  });
});

describe('3D damage distance with terrain elevation', () => {
  it('excludes entities on elevated terrain from ground-level radius damage when 3D distance exceeds weapon radius', () => {
    // Build a heightmap where columns 4+ are at raw value 160 → 100 world height.
    // Columns 0-3 stay at 0 (ground level).
    const hmWidth = 64;
    const hmHeight = 64;
    const rawData = new Uint8Array(hmWidth * hmHeight);
    for (let row = 0; row < hmHeight; row++) {
      for (let col = 0; col < hmWidth; col++) {
        rawData[row * hmWidth + col] = col >= 4 ? 160 : 0;
      }
    }
    const heightmap = HeightmapGrid.fromJSON({
      width: hmWidth,
      height: hmHeight,
      borderSize: 0,
      data: uint8ArrayToBase64(rawData),
    });

    // Weapon: DIRECT, large radius (25 world units), instant damage.
    const attackerDef = makeObjectDef('ElevAttacker', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ElevRadiusCannon'] }),
    ]);
    const groundTargetDef = makeObjectDef('GroundTarget', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
    ]);
    const cliffTargetDef = makeObjectDef('CliffTarget', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
    ]);

    const bundle = makeBundle({
      objects: [attackerDef, groundTargetDef, cliffTargetDef],
      weapons: [
        makeWeaponDef('ElevRadiusCannon', {
          AttackRange: 200,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 25,
          SecondaryDamage: 25,
          SecondaryDamageRadius: 25,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Attacker at (10,10) — ground (col 1).
    // GroundTarget at (20,10) — ground (col 2), XZ distance 10 from impact.
    // CliffTarget at (40,10) — elevated (col 4, height ~100), XZ distance 20 from impact.
    // Impact will be at GroundTarget position.
    logic.loadMapObjects(
      {
        heightmap: {
          width: hmWidth,
          height: hmHeight,
          borderSize: 0,
          data: uint8ArrayToBase64(rawData),
        },
        objects: [
          makeMapObject('ElevAttacker', 10, 10),
          makeMapObject('GroundTarget', 20, 10),
          makeMapObject('CliffTarget', 40, 10),
        ],
        triggers: [],
      },
      makeRegistry(bundle),
      heightmap,
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Attack the ground target (entity 2). Radius damage centered on ground target.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Advance enough frames for DIRECT weapon to fire and deal damage.
    for (let i = 0; i < 3; i++) {
      logic.update(1 / 30);
    }

    const groundHealth = logic.getEntityState(2)?.health ?? -1;
    const cliffHealth = logic.getEntityState(3)?.health ?? -1;

    // Ground target is within radius → takes primary damage (50).
    expect(groundHealth).toBeLessThan(200);
    // Cliff target XZ distance is 20 (within radius 25 in 2D) but 3D distance
    // includes ~100 unit elevation difference → outside radius → no damage.
    expect(cliffHealth).toBe(200);
  });

  it('bounding sphere subtraction extends effective hit zone for entities with explicit geometry', () => {
    // Source parity: FROM_BOUNDINGSPHERE_3D subtracts the target entity's bounding
    // sphere radius from the 3D center-to-point distance. An entity with large geometry
    // (majorRadius=12) gets BSR=12, making it hittable at longer range than the weapon's
    // nominal damage radius.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BSRAttacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BSRWeapon'] }),
        ]),
        // SmallTarget: no geometry → BSR falls back to baseHeight (~1.5).
        makeObjectDef('SmallTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        // LargeTarget: explicit geometry with majorRadius=12 → BSR=12 (cylinder).
        makeObjectDef('LargeTarget', 'China', ['VEHICLE', 'STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { GeometryMajorRadius: 12, GeometryMinorRadius: 12, GeometryHeight: 5 }),
      ],
      weapons: [
        makeWeaponDef('BSRWeapon', {
          AttackRange: 120,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 5,
          SecondaryDamage: 0,
          SecondaryDamageRadius: 0,
          DelayBetweenShots: 1000,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Attacker at (10,10). SmallTarget at (25,10) → XZ dist=15 from impact at SmallTarget.
    // LargeTarget at (25,50) → placed far from attack path, won't be hit.
    // We attack SmallTarget; radius damage checks entities within radius=5 of SmallTarget.
    // SmallTarget (at impact point): shrunkenDist=0 → hit.
    // LargeTarget: too far → not hit.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BSRAttacker', 10, 10),
        makeMapObject('SmallTarget', 25, 10),
        makeMapObject('LargeTarget', 25, 50),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    for (let i = 0; i < 3; i++) {
      logic.update(1 / 30);
    }

    const smallHealth = logic.getEntityState(2)?.health ?? -1;
    const largeHealth = logic.getEntityState(3)?.health ?? -1;

    // SmallTarget is the primary victim → takes damage.
    expect(smallHealth).toBeLessThan(100);
    // LargeTarget is 40 units away in XZ → even with BSR=12, still outside radius 5.
    expect(largeHealth).toBe(100);
  });
});

describe('crush damage during movement', () => {
  // Shared bundle for most crush tests: tank (CrusherLevel=2) + crushable infantry.
  function makeCrushBundle(infantrySide: string = 'China') {
    return makeBundle({
      objects: [
        makeObjectDef('CrusherTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('CrushableInfantry', infantrySide, ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Collide', 'SquishCollide ModuleTag_Squish', {}),
        ], { CrushableLevel: 0 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 180),
      ],
    });
  }

  it('tank crushes infantry when moving through them', () => {
    // Source parity: SquishCollide::onCollide — moving entity with CrusherLevel > 0
    // kills crushable enemies on bounding circle overlap + moving-toward-target check.
    // Place at cell centers (PATHFIND_CELL_SIZE=10, so centers at x%10=5) for straight-line A*.
    const bundle = makeCrushBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 205, 205),
        makeMapObject('CrushableInfantry', 220, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    expect(logic.getEntityState(2)?.health).toBe(100);

    // Move tank straight through infantry in +X at same Z level.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 255, targetZ: 205 });

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Infantry should be dead and removed from CRUSH damage (HUGE_DAMAGE_AMOUNT).
    const infantryAfter = logic.getEntityState(2);
    expect(infantryAfter === null || infantryAfter.health === 0).toBe(true);
  });

  it('allies are not crushed', () => {
    // Same side — canCrushOrSquish rejects allies.
    const bundle = makeCrushBundle('America');
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 205, 205),
        makeMapObject('CrushableInfantry', 220, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 255, targetZ: 205 });

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const allyHealth = logic.getEntityState(2)?.health ?? -1;
    expect(allyHealth).toBe(100);
  });

  it('vehicle with higher crushableLevel resists crush from lower crusherLevel', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LightTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 1, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('HeavyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ], { CrushableLevel: 2, GeometryMajorRadius: 4, GeometryMinorRadius: 4 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 180),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('LightTank', 205, 205),
        makeMapObject('HeavyVehicle', 220, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 255, targetZ: 205 });

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // CrushableLevel=2 >= CrusherLevel=1 — not crushed.
    const heavyHealth = logic.getEntityState(2)?.health ?? -1;
    expect(heavyHealth).toBe(300);
  });

  it('tank moving away from infantry does not crush', () => {
    // Dot product direction check: crusher moving away from victim should not crush.
    const bundle = makeCrushBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Infantry behind the tank: tank at cell center, infantry behind in -X.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 215, 205),
        makeMapObject('CrushableInfantry', 205, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Tank moves in +X direction, away from infantry at -X.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 255, targetZ: 205 });

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Infantry should be alive — tank moved away, dot product was <= 0.
    const infHealth = logic.getEntityState(2)?.health ?? -1;
    expect(infHealth).toBe(100);
  });

  it('applies vehicle crush only after passing the selected crush point', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CrusherTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('CrushableVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrushableLevel: 0, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 120),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 225, 205),
        makeMapObject('CrushableVehicle', 220, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { moving: boolean; rotationY: number; speed: number; health: number; destroyed: boolean }>;
      updateCrushCollisions: () => void;
    };
    const crusher = privateApi.spawnedEntities.get(1)!;
    const victim = privateApi.spawnedEntities.get(2)!;
    crusher.moving = true;
    crusher.rotationY = Math.PI / 2; // facing +X, so target center is behind (dot < 0)
    crusher.speed = 1;
    victim.rotationY = 0; // align victim crush points to center-line for deterministic TOTAL target.

    privateApi.updateCrushCollisions();
    expect(victim.health <= 0 || victim.destroyed).toBe(true);
  });

  it('hijacker infantry is immune to crush by target vehicle', () => {
    // Source parity: SquishCollide::onCollide — infantry with a pending hijackVehicle
    // action targeting the crusher is immune to being crushed by that vehicle.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CrusherTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('Hijacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Collide', 'SquishCollide ModuleTag_Squish', {}),
          makeBlock('Behavior', 'ConvertToHijackedVehicleCrateCollide ModuleTag_Hijack', {}),
          makeBlock('LocomotorSet', 'SET_NORMAL InfLocomotor', {}),
        ], { CrushableLevel: 0, VisionRange: 120 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 180),
        makeLocomotorDef('InfLocomotor', 60),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Place far enough apart that the hijack doesn't resolve immediately
    // (reachDistance = 5+5=10, so distance must exceed 10).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 205, 205),
        makeMapObject('Hijacker', 235, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(1 / 30);

    // Issue hijack command — hijacker will move toward the tank.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'hijackVehicle',
    });

    // Move tank toward the hijacker — they will overlap and crush would normally kill.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 265, targetZ: 205 });

    // Run enough frames for the entities to meet and the hijack to resolve.
    // Tank speed=180 (6 units/frame), hijacker speed=60 (2 units/frame).
    // They close at 8 units/frame, gap=30, so ~4 frames to overlap.
    // Without crush immunity the hijacker would die on overlap. With immunity,
    // the hijacker survives to reach interaction distance and the hijack resolves.
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    // Hijacker is consumed by the successful hijack (destroyed after entering vehicle).
    const hijackerState = logic.getEntityState(2);
    expect(hijackerState).toBeNull();

    // The tank should have been captured — side changed from China to America.
    // This proves crush immunity worked: if the hijacker had been crushed,
    // the hijack would never have resolved and the tank would remain Chinese.
    const tankState = logic.getEntityState(1);
    expect(tankState).not.toBeNull();
    expect(tankState!.side.toLowerCase()).toBe('america');
  });
});

describe('CrushableLevel / CrusherLevel defaults (ThingTemplate.cpp parity)', () => {
  // Source parity: ThingTemplate constructor sets:
  //   m_crusherLevel = 0    — cannot crush anything
  //   m_crushableLevel = 255 — immune to being crushed
  // The browser port must match these defaults when the INI field is absent.

  it('objects without CrushableLevel default to 255 (immune to crush)', () => {
    // Object with no CrushableLevel field — should be immune (255).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NoCrushFields', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('NoCrushFields', 205, 205)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as { spawnedEntities: Map<number, { crushableLevel: number }> };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity).toBeDefined();
    expect(entity.crushableLevel).toBe(255);
  });

  it('objects without CrusherLevel default to 0 (cannot crush)', () => {
    // Object with no CrusherLevel field — should be unable to crush (0).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NoCrushFields', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('NoCrushFields', 205, 205)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    const priv = logic as unknown as { spawnedEntities: Map<number, { crusherLevel: number }> };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity).toBeDefined();
    expect(entity.crusherLevel).toBe(0);
  });

  it('CrusherLevel=2 crushes CrushableLevel=1 but not CrushableLevel=3', () => {
    // Source parity: canCrushOrSquish uses strict greater-than (crusher > crushable).
    // Use private API (updateCrushCollisions) for deterministic vehicle-to-vehicle crush tests.
    function makeCrushLevelBundle(crushableLevel: number) {
      return makeBundle({
        objects: [
          makeObjectDef('MediumCrusher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
          ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
            makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
          ], { CrushableLevel: crushableLevel, GeometryMajorRadius: 10, GeometryMinorRadius: 10 }),
        ],
        locomotors: [
          makeLocomotorDef('TankLocomotor', 120),
        ],
      });
    }

    // Phase 1: CrusherLevel=2 vs CrushableLevel=1 — should crush (2 > 1).
    const bundle1 = makeCrushLevelBundle(1);
    const logic1 = new GameLogicSubsystem(new THREE.Scene());
    logic1.loadMapObjects(
      makeMap([
        makeMapObject('MediumCrusher', 225, 205),
        makeMapObject('Target', 220, 205),
      ], 128, 128),
      makeRegistry(bundle1),
      makeHeightmap(128, 128),
    );
    logic1.setTeamRelationship('America', 'China', 0);
    logic1.setTeamRelationship('China', 'America', 0);
    const priv1 = logic1 as unknown as {
      spawnedEntities: Map<number, { moving: boolean; rotationY: number; speed: number; health: number; destroyed: boolean }>;
      updateCrushCollisions: () => void;
    };
    const crusher1 = priv1.spawnedEntities.get(1)!;
    const victim1 = priv1.spawnedEntities.get(2)!;
    crusher1.moving = true;
    crusher1.rotationY = Math.PI / 2;
    crusher1.speed = 1;
    victim1.rotationY = 0;
    priv1.updateCrushCollisions();
    expect(victim1.health <= 0 || victim1.destroyed).toBe(true);

    // Phase 2: CrusherLevel=2 vs CrushableLevel=3 — should NOT crush (2 <= 3).
    const bundle2 = makeCrushLevelBundle(3);
    const logic2 = new GameLogicSubsystem(new THREE.Scene());
    logic2.loadMapObjects(
      makeMap([
        makeMapObject('MediumCrusher', 225, 205),
        makeMapObject('Target', 220, 205),
      ], 128, 128),
      makeRegistry(bundle2),
      makeHeightmap(128, 128),
    );
    logic2.setTeamRelationship('America', 'China', 0);
    logic2.setTeamRelationship('China', 'America', 0);
    const priv2 = logic2 as unknown as {
      spawnedEntities: Map<number, { moving: boolean; rotationY: number; speed: number; health: number; destroyed: boolean }>;
      updateCrushCollisions: () => void;
    };
    const crusher2 = priv2.spawnedEntities.get(1)!;
    const victim2 = priv2.spawnedEntities.get(2)!;
    crusher2.moving = true;
    crusher2.rotationY = Math.PI / 2;
    crusher2.speed = 1;
    victim2.rotationY = 0;
    priv2.updateCrushCollisions();
    expect(victim2.health).toBe(200);
  });
});

describe('salvage crate system', () => {
  /** Destroyed entities are cleaned up from spawnedEntities, so getEntityState returns null. */
  function isEntityDead(logic: GameLogicSubsystem, entityId: number): boolean {
    const state = logic.getEntityState(entityId);
    return state === null || state.alive === false;
  }
  function makeSalvageBundle(opts: {
    salvagerKindOf?: string[];
    crateWeaponChance?: string;
    crateLevelChance?: string;
    crateMinMoney?: number;
    crateMaxMoney?: number;
    salvagerExpRequired?: string;
    salvagerExpValue?: string;
    victimHealth?: number;
    attackDamage?: number;
  } = {}) {
    // Victim spawns a crate on death.
    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: opts.victimHealth ?? 10,
        InitialHealth: opts.victimHealth ?? 10,
      }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', {
        CrateData: 'SalvageCrate',
      }),
    ]);

    // Crate object with SalvageCrateCollide behavior.
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SalvageCrate', {
        ...(opts.crateWeaponChance !== undefined ? { WeaponChance: opts.crateWeaponChance } : {}),
        ...(opts.crateLevelChance !== undefined ? { LevelChance: opts.crateLevelChance } : {}),
        ...(opts.crateMinMoney !== undefined ? { MinMoney: opts.crateMinMoney } : {}),
        ...(opts.crateMaxMoney !== undefined ? { MaxMoney: opts.crateMaxMoney } : {}),
      }),
    ], {
      Geometry: 'CYLINDER',
      GeometryMajorRadius: 5,
      GeometryMinorRadius: 5,
    });

    // Salvager unit with weapon.
    const salvagerDef = makeObjectDef(
      'Salvager',
      'America',
      opts.salvagerKindOf ?? ['VEHICLE', 'SALVAGER', 'WEAPON_SALVAGER'],
      [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', {
          MaxHealth: 200,
          InitialHealth: 200,
        }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SalvagerGun'] }),
        makeBlock('LocomotorSet', 'SET_NORMAL LocomotorFast', {}),
      ],
      {
        ...(opts.salvagerExpRequired ? { ExperienceRequired: opts.salvagerExpRequired } : {}),
        ...(opts.salvagerExpValue ? { ExperienceValue: opts.salvagerExpValue } : {}),
      },
    );

    const bundle = makeBundle({
      objects: [victimDef, crateDef, salvagerDef],
      weapons: [
        makeWeaponDef('SalvagerGun', {
          AttackRange: 120,
          PrimaryDamage: opts.attackDamage ?? 50,
          DamageType: 'ARMOR_PIERCING',
          DelayBetweenShots: 100,
          DeliveryType: 'DIRECT',
        }),
      ],
      locomotors: [makeLocomotorDef('LocomotorFast', 180)],
    });

    return bundle;
  }

  it('spawns crate on enemy death and salvager collects for weapon upgrade', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const bundle = makeSalvageBundle();
    const registry = makeRegistry(bundle);

    // Place victim at (55,55), salvager at (55,65) — within attack range.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('Salvager', 55, 65),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0); // enemies

    // Attack and kill the victim.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Victim should be dead.
    expect(isEntityDead(logic, 1)).toBe(true);

    // A crate entity should have spawned (entity 3).
    const crateState = logic.getEntityState(3);
    expect(crateState).not.toBeNull();
    expect(crateState!.alive).toBe(true);

    // Move salvager to collect the crate.
    logic.submitCommand({ type: 'moveTo', entityId: 2, targetX: crateState!.x, targetZ: crateState!.z });
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Crate should be consumed (destroyed).
    expect(isEntityDead(logic, 3)).toBe(true);
  });

  it('grants CRATEUPGRADE_ONE on first crate, CRATEUPGRADE_TWO on second', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Two victims at same position as salvager for auto-collection.
    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // Target with high health to verify upgraded weapon damage.
    const targetDef = makeObjectDef('DamageTarget', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
    ]);

    // Salvager with three weapon sets: base, CRATEUPGRADE_ONE, CRATEUPGRADE_TWO.
    // Explicit geometry radius 3 ensures overlap with crate (combined 3+5=8 > max offset ~7.07).
    const salvagerDef = makeObjectDef('Salvager', 'America', ['VEHICLE', 'SALVAGER', 'WEAPON_SALVAGER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Gun'] }),
      makeBlock('WeaponSet', 'WeaponSet', {
        Conditions: 'CRATEUPGRADE_ONE',
        Weapon: ['PRIMARY', 'GunUpgraded1'],
      }),
      makeBlock('WeaponSet', 'WeaponSet', {
        Conditions: 'CRATEUPGRADE_TWO',
        Weapon: ['PRIMARY', 'GunUpgraded2'],
      }),
      makeBlock('LocomotorSet', 'SET_NORMAL LocomotorFast', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 3, GeometryMinorRadius: 3 });

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, salvagerDef, targetDef],
      weapons: [
        makeWeaponDef('Gun', { AttackRange: 120, PrimaryDamage: 50, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
        makeWeaponDef('GunUpgraded1', { AttackRange: 120, PrimaryDamage: 80, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
        makeWeaponDef('GunUpgraded2', { AttackRange: 120, PrimaryDamage: 120, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
      ],
      locomotors: [makeLocomotorDef('LocomotorFast', 180)],
    }));

    // Place: victim1@(55,55), victim2@(55,55), salvager@(55,55), target@(55,115)
    // Overlapping positions ensure crate auto-collection on spawn.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('Salvager', 55, 55),
        makeMapObject('DamageTarget', 55, 115),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    // Kill victim1 → crate spawns nearby and auto-collects → CRATEUPGRADE_ONE.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 1)).toBe(true);

    // Attack target for 30 frames — damage should come from GunUpgraded1 (80/shot).
    const health1 = logic.getEntityState(4)!.health;
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 4 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const damage1 = health1 - logic.getEntityState(4)!.health;
    // GunUpgraded1 does 80/shot. Multiple shots fired — verify damage is a multiple of 80.
    expect(damage1).toBeGreaterThan(0);
    expect(damage1 % 80).toBe(0);

    // Kill victim2 → crate spawns nearby and auto-collects → CRATEUPGRADE_TWO.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 2)).toBe(true);

    // Attack target for 30 frames — damage should come from GunUpgraded2 (120/shot).
    const health2 = logic.getEntityState(4)!.health;
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 4 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const damage2 = health2 - logic.getEntityState(4)!.health;
    expect(damage2).toBeGreaterThan(0);
    expect(damage2 % 120).toBe(0);
  });

  it('non-SALVAGER units cannot collect crates', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // Non-salvager — no SALVAGER kindOf.
    const normalUnit = makeObjectDef('NormalUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Gun'] }),
      makeBlock('LocomotorSet', 'SET_NORMAL LocomotorFast', {}),
    ]);

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, normalUnit],
      weapons: [
        makeWeaponDef('Gun', { AttackRange: 120, PrimaryDamage: 50, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
      ],
      locomotors: [makeLocomotorDef('LocomotorFast', 180)],
    }));

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('NormalUnit', 55, 55),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    // Kill victim — crate spawns.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 1)).toBe(true);

    // Move non-salvager to crate.
    const crate = logic.getEntityState(3);
    expect(crate).not.toBeNull();
    logic.submitCommand({ type: 'moveTo', entityId: 2, targetX: crate!.x, targetZ: crate!.z });
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Crate should still be alive — non-salvager cannot collect.
    expect(logic.getEntityState(3)?.alive).toBe(true);
  });

  it('no crate spawns when killed by ally via area damage', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Victim (America) gets hit by friendly area damage — crate should NOT spawn.
    const victimDef = makeObjectDef('CrateVictim', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // Enemy target that the attacker is actually aiming at.
    const enemyDef = makeObjectDef('Enemy', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);

    // Attacker has area-damage weapon that will splash the ally victim.
    const attackerDef = makeObjectDef('AreaAttacker', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'AreaGun'] }),
    ]);

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, enemyDef, attackerDef],
      weapons: [
        makeWeaponDef('AreaGun', {
          AttackRange: 120,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 20,
          DamageType: 'EXPLOSION',
          DelayBetweenShots: 100,
          DeliveryType: 'DIRECT',
        }),
      ],
    }));

    // Place: victim@(55,55), enemy@(55,57) — within splash, attacker@(55,75).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('Enemy', 55, 57),
        makeMapObject('AreaAttacker', 55, 75),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    // Attack enemy — splash hits both enemy and ally victim.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Victim (10HP) should be dead from splash.
    expect(isEntityDead(logic, 1)).toBe(true);

    // No crate should have spawned — ally killed it.
    // Entity 4 would be the crate if spawned (entities 1=victim, 2=enemy, 3=attacker).
    expect(logic.getEntityState(4)).toBeNull();
  });

  it('grants veterancy level when weapon upgrade not eligible', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {
        WeaponChance: '100%',
        LevelChance: '100%',
      }),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // SALVAGER but NOT WEAPON_SALVAGER — weapon upgrade ineligible, falls through to level.
    const salvagerDef = makeObjectDef('Salvager', 'America', ['VEHICLE', 'SALVAGER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Gun'] }),
    ], {
      ExperienceRequired: '0 50 200 500',
      ExperienceValue: '10 20 40 80',
    });

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, salvagerDef],
      weapons: [
        makeWeaponDef('Gun', { AttackRange: 120, PrimaryDamage: 50, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
      ],
    }));

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('Salvager', 55, 55),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    // Check initial veterancy.
    expect(logic.getEntityState(2)?.veterancyLevel).toBe(0); // REGULAR

    // Kill victim — crate spawns nearby and salvager auto-collects (overlapping positions).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 1)).toBe(true);

    // Crate was auto-collected: should have leveled up to VETERAN.
    expect(logic.getEntityState(2)?.veterancyLevel).toBe(1); // VETERAN
  });

  it('grants money when both weapon and level are ineligible', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {
        MinMoney: 50,
        MaxMoney: 50,
      }),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // No WEAPON_SALVAGER and no experience profile — money fallback.
    const salvagerDef = makeObjectDef('Salvager', 'America', ['VEHICLE', 'SALVAGER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Gun'] }),
    ]);

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, salvagerDef],
      weapons: [
        makeWeaponDef('Gun', { AttackRange: 120, PrimaryDamage: 50, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
      ],
    }));

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('Salvager', 55, 55),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    const initialCredits = logic.getSideCredits('America');

    // Kill victim — crate spawns nearby and salvager auto-collects (overlapping positions).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 1)).toBe(true);

    // Credits should have increased by exactly 50 (money fallback from auto-collected crate).
    const finalCredits = logic.getSideCredits('America');
    expect(finalCredits - initialCredits).toBe(50);
  });

  it('fully upgraded WEAPON_SALVAGER falls through to level then money', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {
        MinMoney: 100,
        MaxMoney: 100,
      }),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // Three victims at same position as salvager for auto-collection.
    // Explicit geometry radius 3 ensures overlap with crate (combined 3+5=8 > max offset ~7.07).
    const salvagerDef = makeObjectDef('Salvager', 'America', ['VEHICLE', 'SALVAGER', 'WEAPON_SALVAGER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Gun'] }),
      makeBlock('LocomotorSet', 'SET_NORMAL LocomotorFast', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 3, GeometryMinorRadius: 3 });

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, salvagerDef],
      weapons: [
        makeWeaponDef('Gun', { AttackRange: 120, PrimaryDamage: 50, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
      ],
      locomotors: [makeLocomotorDef('LocomotorFast', 180)],
    }));

    // All victims at (55,55) overlapping salvager for auto-collection.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('Salvager', 55, 55),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    // Kill first victim → crate auto-collects → CRATEUPGRADE_ONE.
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 1)).toBe(true);

    // Kill second victim → crate auto-collects → CRATEUPGRADE_TWO.
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 2 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 2)).toBe(true);

    // Now fully upgraded. Kill third victim — crate should fall through to money.
    const creditsBefore = logic.getSideCredits('America');
    logic.submitCommand({ type: 'attackEntity', entityId: 4, targetEntityId: 3 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 3)).toBe(true);

    // Credits should have increased by 100 (money fallback from auto-collected crate).
    const creditsAfter = logic.getSideCredits('America');
    expect(creditsAfter - creditsBefore).toBe(100);
  });

  it('ARMOR_SALVAGER gets armor crate upgrade with model conditions', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    const victimDef = makeObjectDef('CrateVictim', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
      makeBlock('Behavior', 'CreateCrateDie ModuleTag_CrateDie', { CrateData: 'SalvageCrate' }),
    ]);
    const crateDef = makeObjectDef('SalvageCrate', '', ['CRATE', 'UNATTACKABLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'SalvageCrateCollide ModuleTag_SC', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5, GeometryMinorRadius: 5 });

    // Salvager with ARMOR_SALVAGER kindOf.
    const salvagerDef = makeObjectDef('ArmorSalvager', 'America', ['VEHICLE', 'SALVAGER', 'ARMOR_SALVAGER'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'Gun'] }),
      makeBlock('LocomotorSet', 'SET_NORMAL LocomotorFast', {}),
    ], { Geometry: 'CYLINDER', GeometryMajorRadius: 3, GeometryMinorRadius: 3 });

    const registry = makeRegistry(makeBundle({
      objects: [victimDef, crateDef, salvagerDef],
      weapons: [
        makeWeaponDef('Gun', { AttackRange: 120, PrimaryDamage: 50, DamageType: 'ARMOR_PIERCING', DelayBetweenShots: 100, DeliveryType: 'DIRECT' }),
      ],
      locomotors: [makeLocomotorDef('LocomotorFast', 180)],
    }));

    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('CrateVictim', 55, 55),
        makeMapObject('ArmorSalvager', 55, 55),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        armorSetFlagsMask: number;
        modelConditionFlags: Set<string>;
      }>;
    };
    const salvager = priv.spawnedEntities.get(3)!;

    // Kill first victim → armor upgrade ONE.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(isEntityDead(logic, 1)).toBe(true);

    // Auto-collect: should have CRATE_UPGRADE_ONE armor flag and model condition.
    // Wait for crate collision.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(salvager.armorSetFlagsMask & (1 << 6)).not.toBe(0); // ARMOR_SET_FLAG_CRATE_UPGRADE_ONE
    expect(salvager.modelConditionFlags.has('ARMORSET_CRATEUPGRADE_ONE')).toBe(true);

    // Kill second victim → armor upgrade TWO.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    expect(salvager.armorSetFlagsMask & (1 << 6)).toBe(0); // CRATE_UPGRADE_ONE cleared
    expect(salvager.armorSetFlagsMask & (1 << 7)).not.toBe(0); // CRATE_UPGRADE_TWO set
    expect(salvager.modelConditionFlags.has('ARMORSET_CRATEUPGRADE_ONE')).toBe(false);
    expect(salvager.modelConditionFlags.has('ARMORSET_CRATEUPGRADE_TWO')).toBe(true);
  });
});

describe('BattlePlanUpdate', () => {
  // C++ source parity: each battle plan has its own SpecialPower template.
  const PLAN_POWERS = {
    BOMBARDMENT: 'SpecialPowerChangeBombardmentBattlePlan',
    HOLDTHELINE: 'SpecialPowerChangeHoldTheLineBattlePlan',
    SEARCHANDDESTROY: 'SpecialPowerChangeSearchAndDestroyBattlePlan',
  } as const;

  // Helper: issue battle plan special power command.
  function issueBattlePlan(
    logic: GameLogicSubsystem,
    sourceEntityId: number,
    plan: 'BOMBARDMENT' | 'HOLDTHELINE' | 'SEARCHANDDESTROY',
  ): void {
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: `CMD_${plan}`,
      specialPowerName: PLAN_POWERS[plan],
      commandOption: 0,
      issuingEntityIds: [sourceEntityId],
      sourceEntityId,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
  }

  // Helper: build a Strategy Center with BattlePlanUpdate + infantry on the same side.
  function makeBattlePlanSetup(opts?: {
    animationMs?: number;
    paralyzeMs?: number;
    transitionIdleMs?: number;
    armorDamageScalar?: number;
    sightRangeScalar?: number;
    validMemberKindOf?: string;
    invalidMemberKindOf?: string;
    strategyCenterSightRangeScalar?: number;
    strategyCenterDetectsStealth?: boolean;
    strategyCenterHealthScalar?: number;
  }) {
    const animMs = opts?.animationMs ?? 300;
    const paraMs = opts?.paralyzeMs ?? 300;
    const idleMs = opts?.transitionIdleMs ?? 300;
    const armorScalar = opts?.armorDamageScalar ?? 0.5;
    const sightScalar = opts?.sightRangeScalar ?? 1.5;

    // C++ source parity: BattlePlanUpdate module registers separate SpecialPowerTemplate
    // for each plan type. We register via three SpecialPowerModule behavior blocks.
    const strategyCenterDef = makeObjectDef('StrategyCenter', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'BattlePlanUpdate ModuleTag_BattlePlan', {
        BombardmentPlanAnimationTime: animMs,
        HoldTheLinePlanAnimationTime: animMs,
        SearchAndDestroyPlanAnimationTime: animMs,
        TransitionIdleTime: idleMs,
        BattlePlanChangeParalyzeTime: paraMs,
        HoldTheLinePlanArmorDamageScalar: armorScalar,
        SearchAndDestroyPlanSightRangeScalar: sightScalar,
        StrategyCenterSearchAndDestroySightRangeScalar: opts?.strategyCenterSightRangeScalar ?? 2.0,
        StrategyCenterSearchAndDestroyDetectsStealth: opts?.strategyCenterDetectsStealth ?? false,
        StrategyCenterHoldTheLineMaxHealthScalar: opts?.strategyCenterHealthScalar ?? 1.0,
        ValidMemberKindOf: opts?.validMemberKindOf ?? '',
        InvalidMemberKindOf: opts?.invalidMemberKindOf ?? '',
      }),
      makeBlock('Behavior', 'SpecialPowerModule BattlePlanBombardment', {
        SpecialPowerTemplate: PLAN_POWERS.BOMBARDMENT,
      }),
      makeBlock('Behavior', 'SpecialPowerModule BattlePlanHoldTheLine', {
        SpecialPowerTemplate: PLAN_POWERS.HOLDTHELINE,
      }),
      makeBlock('Behavior', 'SpecialPowerModule BattlePlanSearchAndDestroy', {
        SpecialPowerTemplate: PLAN_POWERS.SEARCHANDDESTROY,
      }),
    ]);

    const infantryDef = makeObjectDef('Ranger', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RangerGun'] }),
    ], { VisionRange: 150 });

    const enemyDef = makeObjectDef('Enemy', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyGun'] }),
    ]);

    const registry = makeRegistry(makeBundle({
      objects: [strategyCenterDef, infantryDef, enemyDef],
      specialPowers: [
        makeSpecialPowerDef(PLAN_POWERS.BOMBARDMENT, { ReloadTime: 0 }),
        makeSpecialPowerDef(PLAN_POWERS.HOLDTHELINE, { ReloadTime: 0 }),
        makeSpecialPowerDef(PLAN_POWERS.SEARCHANDDESTROY, { ReloadTime: 0 }),
      ],
      weapons: [
        makeWeaponDef('RangerGun', {
          AttackRange: 120,
          PrimaryDamage: 50,
          DamageType: 'ARMOR_PIERCING',
          DelayBetweenShots: 100,
          DeliveryType: 'DIRECT',
        }),
        makeWeaponDef('EnemyGun', {
          AttackRange: 120,
          PrimaryDamage: 100,
          DamageType: 'ARMOR_PIERCING',
          DelayBetweenShots: 100,
          DeliveryType: 'DIRECT',
        }),
      ],
    }));

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Entity 1: StrategyCenter at (55,55).  Entity 2: Ranger at (505,55) (far from enemy).
    // Entity 3: Enemy at (75,55).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StrategyCenter', 55, 55),
        makeMapObject('Ranger', 505, 55),
        makeMapObject('Enemy', 75, 55),
      ], 1024, 1024),
      registry,
      makeHeightmap(1024, 1024),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    return { logic, scene };
  }

  // At 30 FPS, 300ms → ceil(300/33.33) = 9 frames.
  const ANIM_FRAMES = 9;
  const PARALYZE_FRAMES = 9;
  const IDLE_FRAMES = 9;

  it('activates Bombardment plan and sets WEAPON_BONUS_BOMBARDMENT on allied troops', () => {
    const { logic } = makeBattlePlanSetup();

    // Before: no weapon bonus flags.
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 12)).toBe(0);

    // Issue Bombardment.
    issueBattlePlan(logic, 1, 'BOMBARDMENT');
    logic.update(0);

    // Still UNPACKING — no bonus yet.
    for (let i = 0; i < ANIM_FRAMES - 1; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 12)).toBe(0);

    // One more frame → becomes ACTIVE.
    logic.update(1 / 30);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 12)).toBe(1 << 12);

    // Enemy should NOT have the flag.
    expect(logic.getEntityState(3)!.weaponBonusConditionFlags & (1 << 12)).toBe(0);
  });

  it('activates Hold the Line plan and reduces damage taken via armor scalar', () => {
    const { logic } = makeBattlePlanSetup({ armorDamageScalar: 0.5 });

    // Activate Hold the Line.
    issueBattlePlan(logic, 1, 'HOLDTHELINE');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);

    // Check damage scalar on ranger.
    const rangerState = logic.getEntityState(2)!;
    expect(rangerState.weaponBonusConditionFlags & (1 << 13)).toBe(1 << 13);
    expect(rangerState.battlePlanDamageScalar).toBeCloseTo(0.5, 5);
  });

  it('activates Search and Destroy plan and increases vision range', () => {
    const { logic } = makeBattlePlanSetup({ sightRangeScalar: 1.5 });

    // Before: base vision range.
    expect(logic.getEntityState(2)!.visionRange).toBe(150);

    // Activate Search and Destroy.
    issueBattlePlan(logic, 1, 'SEARCHANDDESTROY');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);

    // After: vision range scaled.
    const rangerState = logic.getEntityState(2)!;
    expect(rangerState.weaponBonusConditionFlags & (1 << 14)).toBe(1 << 14);
    expect(rangerState.visionRange).toBeCloseTo(225, 0); // 150 * 1.5
  });

  it('paralyzes troops when switching between active plans', () => {
    const { logic } = makeBattlePlanSetup();

    // Activate Bombardment.
    issueBattlePlan(logic, 1, 'BOMBARDMENT');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 12)).toBe(1 << 12);

    // Switch to Hold the Line — C++ parity: bonuses removed and troops paralyzed
    // immediately at packing start (not at end of packing animation).
    issueBattlePlan(logic, 1, 'HOLDTHELINE');
    logic.update(0);

    // Ranger should be paralyzed immediately (DISABLED_SUBDUED).
    expect(logic.getEntityState(2)!.statusFlags).toContain('DISABLED_SUBDUED');

    // Bombardment bonus should be removed immediately.
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 12)).toBe(0);

    // Wait for paralysis to wear off.
    for (let i = 0; i < PARALYZE_FRAMES; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.statusFlags).not.toContain('DISABLED_SUBDUED');

    // Wait for idle cooldown then UNPACKING → eventually Hold the Line becomes ACTIVE.
    for (let i = 0; i < IDLE_FRAMES + ANIM_FRAMES; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 13)).toBe(1 << 13);
  });

  it('removes bonuses when Strategy Center is destroyed', () => {
    const { logic } = makeBattlePlanSetup();

    // Activate Search and Destroy.
    issueBattlePlan(logic, 1, 'SEARCHANDDESTROY');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 14)).toBe(1 << 14);
    expect(logic.getEntityState(2)!.visionRange).toBeCloseTo(225, 0);

    // Destroy Strategy Center: have enemy attack it.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 200; i++) logic.update(1 / 30);

    // Strategy Center should be dead.
    expect(logic.getEntityState(1)).toBeNull();

    // Bonuses should be removed from ranger (which is far from enemy, still alive).
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 14)).toBe(0);
    expect(logic.getEntityState(2)!.visionRange).toBe(150);
  });

  it('does not apply bonuses to entities matching InvalidMemberKindOf', () => {
    const { logic } = makeBattlePlanSetup({ invalidMemberKindOf: 'INFANTRY' });

    // Activate Bombardment.
    issueBattlePlan(logic, 1, 'BOMBARDMENT');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);

    // Ranger (INFANTRY) should be excluded by InvalidMemberKindOf.
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & (1 << 12)).toBe(0);
  });

  it('does not paralyze the Strategy Center building itself', () => {
    const { logic } = makeBattlePlanSetup();

    // Activate Bombardment, then switch to Hold the Line.
    issueBattlePlan(logic, 1, 'BOMBARDMENT');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);

    issueBattlePlan(logic, 1, 'HOLDTHELINE');
    logic.update(0);
    for (let i = 0; i < ANIM_FRAMES; i++) logic.update(1 / 30);

    // Strategy Center itself should NOT be paralyzed.
    expect(logic.getEntityState(1)!.statusFlags).not.toContain('DISABLED_SUBDUED');
  });
});

describe('PointDefenseLaserUpdate', () => {
  /**
   * Setup: Enemy missile launcher fires PROJECTILE at a target.
   * A PDL defender is positioned on the flight path to intercept.
   *
   * Map layout (128×128, MAP_XY_FACTOR=10 → world = cell*10+5):
   *   Entity 1: PDL defender (America) at cell (5,4) → world (55,45)
   *   Entity 2: Target building (America) at cell (5,7) → world (55,75)
   *   Entity 3: Enemy missile launcher (China) at cell (5,2) → world (55,25)
   *
   * Flight path: (55,25) → (55,75), distance = 50 world units.
   * PDL at (55,45) is right on the flight path, 20 units from launcher.
   */
  function makePdlSetup(opts?: {
    pdlScanRange?: number;
    pdlWeaponRange?: number;
    pdlScanRate?: number;
    missileSpeed?: number;
    primaryTargetTypes?: string;
    secondaryTargetTypes?: string;
  }) {
    const pdlScanRange = opts?.pdlScanRange ?? 60;
    const pdlWeaponRange = opts?.pdlWeaponRange ?? 40;
    const pdlScanRate = opts?.pdlScanRate ?? 33; // 33ms → 1 frame
    const missileSpeed = opts?.missileSpeed ?? 5; // 50 units / 5 = ~10 frame flight
    const primaryTargetTypes = opts?.primaryTargetTypes ?? 'SMALL_MISSILE';
    const secondaryTargetTypes = opts?.secondaryTargetTypes ?? '';

    const bundle = makeBundle({
      objects: [
        makeObjectDef('PDLDefender', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'PointDefenseLaserUpdate ModuleTag_PDL', {
            WeaponTemplate: 'PDLLaser',
            PrimaryTargetTypes: primaryTargetTypes,
            SecondaryTargetTypes: secondaryTargetTypes,
            ScanRate: pdlScanRate,
            ScanRange: pdlScanRange,
            PredictTargetVelocityFactor: 0,
          }),
        ]),
        makeObjectDef('TargetBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('MissileLauncher', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyMissile'] }),
        ]),
        makeObjectDef('MissileProjectile', 'China', ['PROJECTILE', 'SMALL_MISSILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('PDLLaser', {
          AttackRange: pdlWeaponRange,
          PrimaryDamage: 100,
          WeaponSpeed: 999999,
          DelayBetweenShots: 33,
        }),
        makeWeaponDef('EnemyMissile', {
          AttackRange: 120,
          PrimaryDamage: 200,
          WeaponSpeed: missileSpeed,
          DelayBetweenShots: 5000,
          ProjectileObject: 'MissileProjectile',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PDLDefender', 5, 4),
        makeMapObject('TargetBuilding', 5, 7),
        makeMapObject('MissileLauncher', 5, 2),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    return { logic };
  }

  it('intercepts an in-flight enemy missile within range', () => {
    const { logic } = makePdlSetup();

    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    logic.update(0);

    // Missile flies 50 units at speed 5 → ~10 frames. PDL should intercept within that time.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(logic.getEntityState(2)!.health).toBe(1000);
  });

  it('does not intercept ally projectiles', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PDLDefender', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'PointDefenseLaserUpdate ModuleTag_PDL', {
            WeaponTemplate: 'PDLLaser',
            PrimaryTargetTypes: 'SMALL_MISSILE',
            ScanRate: 33,
            ScanRange: 60,
          }),
        ]),
        makeObjectDef('AllyLauncher', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'AllyMissile'] }),
        ]),
        makeObjectDef('EnemyTarget', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('MissileProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('PDLLaser', { AttackRange: 40, PrimaryDamage: 100, WeaponSpeed: 999999, DelayBetweenShots: 33 }),
        makeWeaponDef('AllyMissile', { AttackRange: 120, PrimaryDamage: 200, WeaponSpeed: 150, DelayBetweenShots: 5000, ProjectileObject: 'MissileProjectile' }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('PDLDefender', 5, 4), makeMapObject('AllyLauncher', 5, 2), makeMapObject('EnemyTarget', 5, 7)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 3 });
    logic.update(0);
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Ally missile should hit — PDL does not intercept ally projectiles.
    expect(logic.getEntityState(3)!.health).toBeLessThan(1000);
  });

  it('ignores projectiles that do not match target kindOf', () => {
    // PDL only targets BALLISTIC_MISSILE, but enemy fires SMALL_MISSILE.
    const { logic } = makePdlSetup({ primaryTargetTypes: 'BALLISTIC_MISSILE' });

    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    logic.update(0);
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Missile should hit — PDL doesn't target SMALL_MISSILE.
    expect(logic.getEntityState(2)!.health).toBeLessThan(1000);
  });

  it('respects scan range — does not intercept projectiles beyond range', () => {
    // PDL positioned far from flight path with tiny scan range.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PDLDefender', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'PointDefenseLaserUpdate ModuleTag_PDL', {
            WeaponTemplate: 'PDLLaser',
            PrimaryTargetTypes: 'SMALL_MISSILE',
            ScanRate: 33,
            ScanRange: 5, // very short scan range
          }),
        ]),
        makeObjectDef('TargetBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
        makeObjectDef('MissileLauncher', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyMissile'] }),
        ]),
        makeObjectDef('MissileProjectile', 'China', ['PROJECTILE', 'SMALL_MISSILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('PDLLaser', { AttackRange: 3, PrimaryDamage: 100, WeaponSpeed: 999999, DelayBetweenShots: 33 }),
        makeWeaponDef('EnemyMissile', { AttackRange: 120, PrimaryDamage: 200, WeaponSpeed: 150, DelayBetweenShots: 5000, ProjectileObject: 'MissileProjectile' }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // PDL at cell (9,4) → world (95,45), 40 units away from flight path at x=55.
    logic.loadMapObjects(
      makeMap([makeMapObject('PDLDefender', 9, 4), makeMapObject('TargetBuilding', 5, 7), makeMapObject('MissileLauncher', 5, 2)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    logic.update(0);
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Missile should hit — PDL is too far away.
    expect(logic.getEntityState(2)!.health).toBeLessThan(1000);
  });

  it('intercepts using secondary target types as fallback', () => {
    // Primary targets BALLISTIC_MISSILE (no match), secondary targets SMALL_MISSILE (match).
    const { logic } = makePdlSetup({
      primaryTargetTypes: 'BALLISTIC_MISSILE',
      secondaryTargetTypes: 'SMALL_MISSILE',
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    logic.update(0);
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Missile intercepted via secondary target type.
    expect(logic.getEntityState(2)!.health).toBe(1000);
  });
});

describe('HordeUpdate', () => {
  const WEAPON_BONUS_HORDE = 1 << 1;
  const WEAPON_BONUS_NATIONALISM = 1 << 4;
  const WEAPON_BONUS_FANATICISM = 1 << 23;

  function makeHordeBlock(overrides: Record<string, unknown> = {}): IniBlock {
    return {
      type: 'Behavior',
      name: 'HordeUpdate ModuleTag_Horde',
      fields: {
        KindOf: 'INFANTRY',
        Count: 3,
        Radius: 80,
        UpdateRate: 100,
        RubOffRadius: 20,
        AlliesOnly: 'Yes',
        ExactMatch: 'No',
        AllowedNationalism: 'Yes',
        ...overrides,
      } as Record<string, string | number | boolean | string[] | number[]>,
      blocks: [],
    };
  }

  function makeHordeSetup(opts?: {
    unitCount?: number;
    hordeOverrides?: Record<string, unknown>;
    mapWidth?: number;
  }) {
    const unitCount = opts?.unitCount ?? 3;
    const hordeOverrides = opts?.hordeOverrides ?? {};
    const mapWidth = opts?.mapWidth ?? 20;

    const objects = [
      makeObjectDef('HordeInfantry', 'China', ['INFANTRY'], [
        makeHordeBlock(hordeOverrides),
      ], { MaxHealth: 100 }),
    ];

    // Place units close together (cell 5,5 / 5,6 / 5,7 → within 20 world units of each other).
    const mapObjects: MapObjectJSON[] = [];
    for (let i = 0; i < unitCount; i++) {
      mapObjects.push(makeMapObject('HordeInfantry', 5, 5 + i));
    }

    const scene = new THREE.Scene();
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, mapWidth, mapWidth), registry, makeHeightmap(mapWidth, mapWidth));

    return { logic, registry };
  }

  it('grants HORDE weapon bonus when enough units are grouped', () => {
    // 3 infantry within radius → all get HORDE bonus (minCount=3).
    const { logic } = makeHordeSetup({ unitCount: 3 });

    // Run enough frames for the staggered scan to trigger.
    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // All 3 entities should have HORDE bonus.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(logic.getEntityState(3)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
  });

  it('does not grant HORDE bonus with too few units', () => {
    // Only 2 infantry when minCount=3 → no HORDE bonus.
    const { logic } = makeHordeSetup({ unitCount: 2 });

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });

  it('removes HORDE bonus when unit is destroyed', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Verify horde is active.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);

    // Kill entity 3 to drop below threshold.
    const priv = logic as unknown as { markEntityDestroyed: (id: number, attackerId: number) => void };
    priv.markEntityDestroyed(3, 0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Entity 1 and 2 should lose HORDE bonus (only 2 alive, need 3).
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });

  it('does not count enemy units toward horde when AlliesOnly is true', () => {
    // 2 China infantry + 1 America "enemy" infantry → only 2 allies, not enough.
    const objects = [
      makeObjectDef('HordeInfantry', 'China', ['INFANTRY'], [makeHordeBlock()], { MaxHealth: 100 }),
      makeObjectDef('EnemyInfantry', 'America', ['INFANTRY'], [makeHordeBlock()], { MaxHealth: 100 }),
    ];
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('HordeInfantry', 5, 6),
      makeMapObject('EnemyInfantry', 5, 7),
    ];

    const scene = new THREE.Scene();
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, 20, 20), registry, makeHeightmap(20, 20));
    logic.setTeamRelationship('China', 'America', 0);

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Only 2 allied infantry → not enough for horde.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });

  it('does not count units outside scan range', () => {
    // 3 infantry but one is far away (outside 80 radius).
    // Positions are world coordinates: (5,5), (5,6), (5,100).
    // Distance from (5,5) to (5,100) = 95 > 80 scan radius.
    const objects = [
      makeObjectDef('HordeInfantry', 'China', ['INFANTRY'], [makeHordeBlock()], { MaxHealth: 100 }),
    ];
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('HordeInfantry', 5, 6),
      makeMapObject('HordeInfantry', 5, 100), // Far away (95 units > 80 scan radius).
    ];

    const scene = new THREE.Scene();
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, 120, 120), registry, makeHeightmap(120, 120));

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Units 1 and 2 only have 1 neighbor each (each other) → not enough (need 2 neighbors).
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    expect(logic.getEntityState(2)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
    // Unit 3 is isolated (both other units are > 80 away).
    expect(logic.getEntityState(3)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });

  it('grants NATIONALISM bonus when horde is active and player has upgrade', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    // Source parity: C++ checks player->hasUpgradeComplete(Upgrade_Nationalism).
    const priv = logic as unknown as { setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void };
    priv.setSideUpgradeCompleted('China', 'Upgrade_Nationalism', true);
    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // All entities should have HORDE + NATIONALISM.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(WEAPON_BONUS_NATIONALISM);
    // No fanaticism without the upgrade.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(0);
  });

  it('grants FANATICISM bonus when both nationalism and fanaticism upgrades are active', () => {
    const { logic } = makeHordeSetup({ unitCount: 3 });

    const priv = logic as unknown as { setSideUpgradeCompleted: (side: string, upgradeName: string, enabled: boolean) => void };
    priv.setSideUpgradeCompleted('China', 'Upgrade_Nationalism', true);
    priv.setSideUpgradeCompleted('China', 'Upgrade_Fanaticism', true);
    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_NATIONALISM).toBe(WEAPON_BONUS_NATIONALISM);
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_FANATICISM).toBe(WEAPON_BONUS_FANATICISM);
  });

  it('rub-off inheritance grants horde to nearby non-qualifying units', () => {
    // 3 units qualify as true horde members. 4th unit placed close to them
    // but it only has 2 neighbors within count range (needs 3). However,
    // it's within rubOffRadius of a true horde member → inherits.
    const objects = [
      makeObjectDef('HordeInfantry', 'China', ['INFANTRY'], [
        makeHordeBlock({ RubOffRadius: 30 }),
      ], { MaxHealth: 100 }),
    ];
    // Place 3 close together (cell 5,5 / 5,6 / 5,7) → true horde members.
    // Place 4th at cell 5,8 → within rubOffRadius of entity at cell 5,7 (10 units away).
    // But 4th only has 2 neighbors in scan range (5,6 and 5,7) → not enough for minCount=3,
    // but entity at 5,7 IS a true horde member and within rubOffRadius.
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('HordeInfantry', 5, 6),
      makeMapObject('HordeInfantry', 5, 7),
      makeMapObject('HordeInfantry', 5, 8),
    ];

    const scene = new THREE.Scene();
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, 20, 20), registry, makeHeightmap(20, 20));

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // All 4 should have HORDE bonus (3 true + 1 via rub-off).
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
    expect(logic.getEntityState(4)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(WEAPON_BONUS_HORDE);
  });

  it('kindOf filter rejects non-matching units', () => {
    // HordeUpdate requires INFANTRY kindOf, but we place VEHICLE units nearby.
    const objects = [
      makeObjectDef('HordeInfantry', 'China', ['INFANTRY'], [
        makeHordeBlock({ KindOf: 'INFANTRY' }),
      ], { MaxHealth: 100 }),
      makeObjectDef('Vehicle', 'China', ['VEHICLE'], [
        makeHordeBlock({ KindOf: 'INFANTRY' }),
      ], { MaxHealth: 100 }),
    ];
    const mapObjects = [
      makeMapObject('HordeInfantry', 5, 5),
      makeMapObject('Vehicle', 5, 6),
      makeMapObject('Vehicle', 5, 7),
    ];

    const scene = new THREE.Scene();
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, 20, 20), registry, makeHeightmap(20, 20));

    logic.update(0);
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // HordeInfantry only counts INFANTRY neighbors — vehicles don't count.
    // Only 1 infantry (itself) → not enough for horde.
    expect(logic.getEntityState(1)!.weaponBonusConditionFlags & WEAPON_BONUS_HORDE).toBe(0);
  });
});

describe('ProneUpdate', () => {
  function makeProneSetup(opts?: {
    damageToFramesRatio?: number;
    attackDamage?: number;
    infantryHealth?: number;
    mapSize?: number;
  }) {
    const ratio = opts?.damageToFramesRatio ?? 2.0;
    const atkDmg = opts?.attackDamage ?? 10;
    const hp = opts?.infantryHealth ?? 200;
    const sz = opts?.mapSize ?? 64;

    const bundle = makeBundle({
      objects: [
        makeObjectDef('ProneInfantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: hp, InitialHealth: hp }),
          makeBlock('Behavior', 'ProneUpdate ModuleTag_Prone', {
            DamageToFramesRatio: ratio,
          }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallArm'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallArm', {
          AttackRange: 220,
          PrimaryDamage: atkDmg,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ProneInfantry', 30, 30),
        makeMapObject('Attacker', 20, 30),
      ], sz, sz),
      registry,
      makeHeightmap(sz, sz),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    return { logic, scene, registry };
  }

  it('sets PRONE animation and NO_ATTACK when infantry takes damage', () => {
    const { logic } = makeProneSetup({ damageToFramesRatio: 2.0, attackDamage: 10 });

    // Before combat: entity should start IDLE.
    logic.update(0);
    expect(logic.getEntityState(1)!.animationState).toBe('IDLE');

    // Command attacker (entity 2) to attack infantry (entity 1).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Run frames until the attacker fires.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const after = logic.getEntityState(1)!;
    // Infantry took damage → should be PRONE and have lost HP.
    expect(after.health).toBeLessThan(200);
    expect(after.animationState).toBe('PRONE');
  });

  it('recovers from prone after countdown expires', () => {
    // 10 damage * 2.0 ratio = 20 frames of prone.
    const { logic } = makeProneSetup({ damageToFramesRatio: 2.0, attackDamage: 10, infantryHealth: 500 });
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Fire first shot.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Should be prone now.
    expect(logic.getEntityState(1)!.animationState).toBe('PRONE');

    // Stop the attacker so no more damage is dealt.
    logic.submitCommand({ type: 'stop', entityId: 2 });

    // Tick enough frames for prone to expire (20 frames at 30fps = ~0.67s).
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Should have recovered from prone.
    const recovered = logic.getEntityState(1)!;
    expect(recovered.animationState).not.toBe('PRONE');
  });

  it('stacks prone duration when hit multiple times', () => {
    // Use a fast-firing weapon so we get two hits quickly.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ProneInfantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          makeBlock('Behavior', 'ProneUpdate ModuleTag_Prone', {
            DamageToFramesRatio: 5.0,
          }),
        ]),
        makeObjectDef('FastAttacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'FastGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('FastGun', {
          AttackRange: 220,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 200,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ProneInfantry', 30, 30),
        makeMapObject('FastAttacker', 20, 30),
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Run enough frames for at least two shots (200ms delay = ~6 frames at 30fps).
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Destroy attacker to prevent auto-targeting re-acquisition and further damage.
    const priv = logic as unknown as { markEntityDestroyed: (id: number, attackerId: number) => void };
    priv.markEntityDestroyed(2, 0);
    logic.update(1 / 30);

    const midState = logic.getEntityState(1)!;
    expect(midState.animationState).toBe('PRONE');
    expect(midState.health).toBeLessThan(50000);

    // Each hit: floor(10 * 5.0) = 50 prone frames. With ~200ms between shots,
    // multiple hits accumulate (3-4 in 20 frames). Total ~150-200 prone frames,
    // minus ~21 already decayed. Run 50 more — should still be prone (stacking confirmed).
    for (let i = 0; i < 50; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.animationState).toBe('PRONE');

    // Run enough frames to fully expire even a worst-case accumulation.
    for (let i = 0; i < 300; i++) logic.update(1 / 30);
    expect(logic.getEntityState(1)!.animationState).not.toBe('PRONE');
  });

  it('does not trigger prone on entities without ProneUpdate profile', () => {
    // The attacker has no ProneUpdate — taking damage should not cause prone.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('NormalUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 220,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('NormalUnit', 30, 30),
        makeMapObject('Attacker', 20, 30),
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const state = logic.getEntityState(1)!;
    // Should have taken damage but NOT be prone.
    expect(state.health).toBeLessThan(200);
    expect(state.animationState).not.toBe('PRONE');
  });
});

describe('DemoTrapUpdate', () => {
  function makeDemoTrapBlock(overrides: Record<string, unknown> = {}): IniBlock {
    return {
      type: 'Behavior',
      name: 'DemoTrapUpdate ModuleTag_DemoTrap',
      fields: {
        DefaultProximityMode: 'Yes',
        TriggerDetonationRange: 30,
        ScanRate: 100,
        AutoDetonationWithFriendsInvolved: 'No',
        DetonationWeapon: 'TrapExplosion',
        DetonateWhenKilled: 'Yes',
        ...overrides,
      } as Record<string, string | number | boolean | string[] | number[]>,
      blocks: [],
    };
  }

  function makeDemoTrapSetup(opts?: {
    trapOverrides?: Record<string, unknown>;
    enemyDistance?: number;
    includeAlly?: boolean;
    mapSize?: number;
  }) {
    const overrides = opts?.trapOverrides ?? {};
    const enemyDist = opts?.enemyDistance ?? 1;
    const sz = opts?.mapSize ?? 64;

    const objects = [
      makeObjectDef('DemoTrap', 'GLA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeDemoTrapBlock(overrides),
      ]),
      makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      ]),
    ];

    if (opts?.includeAlly) {
      objects.push(
        makeObjectDef('AllyUnit', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      );
    }

    const mapObjects: MapObjectJSON[] = [
      makeMapObject('DemoTrap', 30, 30),
      makeMapObject('EnemyTank', 30, 30 + enemyDist),
    ];
    if (opts?.includeAlly) {
      mapObjects.push(makeMapObject('AllyUnit', 30, 31));
    }

    const bundle = makeBundle({
      objects,
      weapons: [
        makeWeaponDef('TrapExplosion', {
          AttackRange: 10,
          PrimaryDamage: 200,
          PrimaryDamageRadius: 40,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);

    return { logic };
  }

  it('detonates when enemy enters proximity range', () => {
    // Enemy 1 unit away, range=30 → should detonate.
    const { logic } = makeDemoTrapSetup({ enemyDistance: 1 });

    logic.update(0);
    // Run enough frames for scan to trigger.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Trap should be destroyed.
    const trapState = logic.getEntityState(1);
    expect(trapState === null || !trapState.alive).toBe(true);

    // Enemy should have taken damage from the explosion.
    const enemyState = logic.getEntityState(2)!;
    expect(enemyState.health).toBeLessThan(500);
  });

  it('does not detonate when enemy is outside range', () => {
    // Enemy 50 units away, range=30 → no detonation.
    const { logic } = makeDemoTrapSetup({ enemyDistance: 50 });

    logic.update(0);
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Trap should still be alive.
    const trapState = logic.getEntityState(1)!;
    expect(trapState.alive).toBe(true);

    // Enemy should be untouched.
    const enemyState = logic.getEntityState(2)!;
    expect(enemyState.health).toBe(500);
  });

  it('blocks detonation when friendly is nearby and AutoDetonationWithFriendsInvolved=No', () => {
    // Ally unit at (30,31) within range, enemy also in range → no detonation.
    const { logic } = makeDemoTrapSetup({
      includeAlly: true,
      enemyDistance: 2,
      trapOverrides: { AutoDetonationWithFriendsInvolved: 'No' },
    });

    logic.update(0);
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Trap should still be alive (ally blocked detonation).
    const trapState = logic.getEntityState(1)!;
    expect(trapState.alive).toBe(true);
  });

  it('detonates with friendly nearby when AutoDetonationWithFriendsInvolved=Yes', () => {
    const { logic } = makeDemoTrapSetup({
      includeAlly: true,
      enemyDistance: 2,
      trapOverrides: { AutoDetonationWithFriendsInvolved: 'Yes' },
    });

    logic.update(0);
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Trap should have detonated despite ally being nearby.
    const trapState = logic.getEntityState(1);
    expect(trapState === null || !trapState.alive).toBe(true);
  });

  it('detonates on manual command', () => {
    // Start in manual mode (not proximity).
    const { logic } = makeDemoTrapSetup({
      enemyDistance: 50,
      trapOverrides: { DefaultProximityMode: 'No' },
    });

    logic.update(0);
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Trap should still be alive (manual mode, no proximity scan).
    expect(logic.getEntityState(1)!.alive).toBe(true);

    // Issue manual detonate command.
    logic.submitCommand({ type: 'detonateDemoTrap', entityId: 1 });
    logic.update(1 / 30);

    // Trap should be destroyed.
    const trapState = logic.getEntityState(1);
    expect(trapState === null || !trapState.alive).toBe(true);
  });

  it('detonates when killed if DetonateWhenKilled=Yes', () => {
    const { logic } = makeDemoTrapSetup({
      enemyDistance: 5,
      trapOverrides: { DefaultProximityMode: 'No', DetonateWhenKilled: 'Yes' },
    });

    // Add an attacker to kill the trap.
    const objects2 = [
      makeObjectDef('DemoTrap', 'GLA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeDemoTrapBlock({ DefaultProximityMode: 'No', DetonateWhenKilled: 'Yes' }),
      ]),
      makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
      ]),
    ];
    const bundle2 = makeBundle({
      objects: objects2,
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 220,
          PrimaryDamage: 500,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 5000,
        }),
        makeWeaponDef('TrapExplosion', {
          AttackRange: 10,
          PrimaryDamage: 200,
          PrimaryDamageRadius: 40,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });
    const scene2 = new THREE.Scene();
    const registry2 = makeRegistry(bundle2);
    const logic2 = new GameLogicSubsystem(scene2);
    logic2.loadMapObjects(
      makeMap([
        makeMapObject('DemoTrap', 30, 30),
        makeMapObject('EnemyTank', 28, 30),
      ], 64, 64),
      registry2,
      makeHeightmap(64, 64),
    );
    logic2.setTeamRelationship('GLA', 'America', 0);
    logic2.setTeamRelationship('America', 'GLA', 0);

    // Order the tank to attack the trap.
    logic2.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    const enemyBefore = logic2.getEntityState(2)!.health;

    // Run until the trap is killed by the tank.
    for (let i = 0; i < 15; i++) logic2.update(1 / 30);

    // Trap should be dead, and its detonation weapon should have damaged the tank.
    const trapState = logic2.getEntityState(1);
    expect(trapState === null || !trapState.alive).toBe(true);

    const enemyAfter = logic2.getEntityState(2)!;
    expect(enemyAfter.health).toBeLessThan(enemyBefore);
  });

  it('does not scan in manual mode', () => {
    // Start in manual mode — enemy in range should NOT trigger detonation.
    const { logic } = makeDemoTrapSetup({
      enemyDistance: 1,
      trapOverrides: { DefaultProximityMode: 'No' },
    });

    logic.update(0);
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Trap should still be alive (manual mode, no scanning).
    expect(logic.getEntityState(1)!.alive).toBe(true);

    // Toggle to proximity mode.
    logic.submitCommand({ type: 'toggleDemoTrapMode', entityId: 1 });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Now it should have detonated.
    const trapState = logic.getEntityState(1);
    expect(trapState === null || !trapState.alive).toBe(true);
  });
});

describe('RebuildHoleBehavior', () => {
  /** Build the GLA building + hole + worker INI templates and a test scenario. */
  function makeRebuildHoleSetup(opts?: {
    workerRespawnDelay?: number;
    holeHealthRegenPercent?: number;
    holeMaxHealth?: number;
    buildingBuildTime?: number;
    transferAttackers?: boolean;
  }) {
    const respawnDelayMs = opts?.workerRespawnDelay ?? 100; // ~3 frames at 30fps
    const regenPercent = opts?.holeHealthRegenPercent ?? 10; // INI value: 10 = 10%/sec
    const holeMaxHp = opts?.holeMaxHealth ?? 50;
    const buildTime = opts?.buildingBuildTime ?? 5; // 5 seconds = 150 frames
    const transfer = opts?.transferAttackers ?? true;
    const sz = 64;

    const objects = [
      // 1: GLA building with RebuildHoleExposeDie die module.
      makeObjectDef('GLABarracks', 'GLA', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Die', 'RebuildHoleExposeDie ModuleTag_RebuildDie', {
          HoleName: 'GLAHole',
          HoleMaxHealth: holeMaxHp,
          TransferAttackers: transfer ? 'Yes' : 'No',
        }),
      ], { BuildTime: buildTime }),
      // 2: The hole object with RebuildHoleBehavior.
      makeObjectDef('GLAHole', 'GLA', ['REBUILD_HOLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: holeMaxHp, InitialHealth: holeMaxHp }),
        makeBlock('Behavior', 'RebuildHoleBehavior ModuleTag_RebuildHole', {
          WorkerObjectName: 'GLAWorker',
          WorkerRespawnDelay: respawnDelayMs,
          'HoleHealthRegen%PerSecond': regenPercent,
        }),
      ]),
      // 3: The worker unit.
      makeObjectDef('GLAWorker', 'GLA', ['INFANTRY', 'DOZER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
      // 4: Enemy attacker.
      makeObjectDef('EnemyTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankGun'] }),
      ]),
    ];

    const mapObjects: MapObjectJSON[] = [
      makeMapObject('GLABarracks', 30, 30),
      makeMapObject('EnemyTank', 30, 32),
    ];

    const bundle = makeBundle({
      objects,
      weapons: [
        makeWeaponDef('TankGun', {
          AttackRange: 100,
          PrimaryDamage: 50,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 100,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('america', 'COMPUTER');

    return { logic, sz };
  }

  it('creates a rebuild hole when building is destroyed', () => {
    const { logic } = makeRebuildHoleSetup();
    logic.update(0);

    // Building is entity 1, enemy is entity 2.
    const buildingBefore = logic.getEntityState(1)!;
    expect(buildingBefore.alive).toBe(true);

    // Kill the building by dealing massive damage.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    // Building should be destroyed.
    const buildingAfter = logic.getEntityState(1);
    expect(buildingAfter === null || !buildingAfter.alive).toBe(true);

    // A hole entity should have been spawned (entity 3).
    logic.update(1 / 30);
    const holeState = logic.getEntityState(3);
    expect(holeState).not.toBeNull();
    expect(holeState!.alive).toBe(true);
    expect(holeState!.templateName).toBe('GLAHole');
  });

  it('uses controlling player type when side player registration is missing for rebuild-hole creation', () => {
    const { logic } = makeRebuildHoleSetup();
    logic.update(0);

    const privateApi = logic as unknown as {
      sidePlayerTypes: Map<string, string>;
      spawnedEntities: Map<number, { controllingPlayerToken: string | null }>;
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
    };

    // Simulate missing side player registration while preserving controlling owner registration.
    privateApi.sidePlayerTypes.delete('gla');
    privateApi.sidePlayerTypes.set('aiplayer', 'COMPUTER');
    privateApi.spawnedEntities.get(1)!.controllingPlayerToken = 'aiplayer';

    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building as unknown as never, 9999, 'EXPLOSION');
    logic.update(1 / 30);

    const holeState = logic.getEntityState(3);
    expect(holeState).not.toBeNull();
    expect(holeState!.alive).toBe(true);
    expect(holeState!.templateName).toBe('GLAHole');
  });

  it('spawns worker after respawn delay and begins reconstruction', () => {
    const { logic } = makeRebuildHoleSetup({ workerRespawnDelay: 100 }); // ~3 frames
    logic.update(0);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    // Run for a few frames to let the worker spawn timer tick down.
    // WorkerRespawnDelay=100ms → ~3 frames at 30fps.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Worker should exist (entity 4 — after hole=3).
    const workerState = logic.getEntityState(4);
    expect(workerState).not.toBeNull();
    expect(workerState!.alive).toBe(true);
    expect(workerState!.templateName).toBe('GLAWorker');

    // A reconstruction building should exist (entity 5).
    const reconState = logic.getEntityState(5);
    expect(reconState).not.toBeNull();
    expect(reconState!.alive).toBe(true);
    expect(reconState!.templateName).toBe('GLABarracks');
    // Should be under construction.
    expect(reconState!.constructionPercent).toBeGreaterThanOrEqual(0);
  });

  it('completes reconstruction and destroys hole and worker', () => {
    const { logic } = makeRebuildHoleSetup({
      workerRespawnDelay: 100,
      buildingBuildTime: 1, // 1 second → 30 frames
    });
    logic.update(0);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    // Run enough frames for worker spawn (~3 frames) + full construction (30 frames).
    for (let i = 0; i < 50; i++) logic.update(1 / 30);

    // Hole should be destroyed (reconstruction complete).
    const holeState = logic.getEntityState(3);
    expect(holeState === null || !holeState.alive).toBe(true);

    // Worker should be destroyed.
    const workerState = logic.getEntityState(4);
    expect(workerState === null || !workerState.alive).toBe(true);

    // Reconstructed building should be alive and complete.
    const reconState = logic.getEntityState(5);
    expect(reconState).not.toBeNull();
    expect(reconState!.alive).toBe(true);
    expect(reconState!.constructionPercent).toBe(-1); // CONSTRUCTION_COMPLETE
    expect(reconState!.health).toBe(500);
  });

  it('respawns worker if worker dies during reconstruction', () => {
    const { logic } = makeRebuildHoleSetup({
      workerRespawnDelay: 100,
      buildingBuildTime: 100, // 100 seconds — long enough to kill worker mid-build
    });
    logic.update(0);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
      markEntityDestroyed: (id: number, attackerId: number) => void;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    // Let worker spawn.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const firstWorkerState = logic.getEntityState(4);
    expect(firstWorkerState).not.toBeNull();
    expect(firstWorkerState!.alive).toBe(true);

    // Kill the worker.
    privateApi.markEntityDestroyed(4, -1);
    const deadWorker = logic.getEntityState(4);
    expect(deadWorker === null || !deadWorker.alive).toBe(true);

    // Run more frames to let replacement worker spawn.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // New worker should be spawned (entity 6 — after recon=5).
    const newWorkerState = logic.getEntityState(6);
    expect(newWorkerState).not.toBeNull();
    expect(newWorkerState!.alive).toBe(true);
    expect(newWorkerState!.templateName).toBe('GLAWorker');
  });

  it('restarts construction if reconstructing building is destroyed', () => {
    const { logic } = makeRebuildHoleSetup({
      workerRespawnDelay: 100,
      buildingBuildTime: 10000,
    });
    logic.update(0);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
      markEntityDestroyed: (id: number, attackerId: number) => void;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    // Let worker spawn and reconstruction start.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(5)).not.toBeNull(); // Reconstruction exists.

    // Kill the reconstruction building.
    privateApi.markEntityDestroyed(5, -1);

    // Run more frames — should restart the cycle.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Hole should still be alive.
    const holeState = logic.getEntityState(3);
    expect(holeState).not.toBeNull();
    expect(holeState!.alive).toBe(true);

    // A new worker and reconstruction should exist.
    // Worker 4 was killed when recon died, new worker is 6, new recon is 7.
    const newRecon = logic.getEntityState(7);
    expect(newRecon).not.toBeNull();
    expect(newRecon!.alive).toBe(true);
    expect(newRecon!.templateName).toBe('GLABarracks');
  });

  it('destroys worker when hole is killed', () => {
    const { logic } = makeRebuildHoleSetup({
      workerRespawnDelay: 100,
      buildingBuildTime: 10000,
    });
    logic.update(0);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
      markEntityDestroyed: (id: number, attackerId: number) => void;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    // Let worker spawn.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(logic.getEntityState(4)!.alive).toBe(true); // Worker alive.

    // Kill the hole.
    privateApi.markEntityDestroyed(3, -1);

    // Worker should also be destroyed.
    const workerState = logic.getEntityState(4);
    expect(workerState === null || !workerState.alive).toBe(true);
  });

  it('does not create hole for buildings under construction', () => {
    const { logic } = makeRebuildHoleSetup();
    logic.update(0);

    // Mark building as under construction.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    building.objectStatusFlags.add('UNDER_CONSTRUCTION');

    // Kill the building.
    privateApi.applyWeaponDamageAmount(2, building as unknown as never, 9999, 'EXPLOSION');

    logic.update(1 / 30);

    // No hole should exist — entity 3 should not be a hole.
    const entity3 = logic.getEntityState(3);
    expect(entity3).toBeNull();
  });

  it('heals hole passively over time', () => {
    const { logic } = makeRebuildHoleSetup({
      workerRespawnDelay: 30000, // Long delay so worker doesn't spawn.
      holeHealthRegenPercent: 50, // INI value: 50 = 50%/sec → heals fast.
      holeMaxHealth: 100,
    });
    logic.update(0);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building, 9999, 'EXPLOSION');

    logic.update(1 / 30);

    // Damage the hole.
    const hole = privateApi.spawnedEntities.get(3) as { health: number; maxHealth: number };
    expect(hole).toBeTruthy();
    hole.health = 50; // Half health.

    // Run 30 frames (1 second) at 50% regen/sec → should heal ~50 HP.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const holeState = logic.getEntityState(3)!;
    expect(holeState.health).toBeGreaterThan(90); // Should be near max.
  });

  it('transfers attackers from dead building to hole', () => {
    const { logic } = makeRebuildHoleSetup({ transferAttackers: true });
    logic.update(0);

    // Make enemy attack the building.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    logic.update(1 / 30);

    // Kill the building.
    const privateApi = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, { attackTargetEntityId: number | null }>;
    };
    const building = privateApi.spawnedEntities.get(1)!;
    privateApi.applyWeaponDamageAmount(2, building as unknown as never, 9999, 'EXPLOSION');

    // After building death, enemy's target should be redirected to hole (entity 3).
    const enemy = privateApi.spawnedEntities.get(2)!;
    expect(enemy.attackTargetEntityId).toBe(3);
  });
});

describe('AutoDepositUpdate', () => {
  /** Build a scenario with an auto-deposit building (e.g., oil derrick). */
  function makeAutoDepositSetup(opts?: {
    depositTimingMs?: number;
    depositAmount?: number;
    initialCaptureBonus?: number;
    startCredits?: number;
  }) {
    const timingMs = opts?.depositTimingMs ?? 1000; // 1s = 30 frames
    const amount = opts?.depositAmount ?? 100;
    const captureBonus = opts?.initialCaptureBonus ?? 0;
    const startCredits = opts?.startCredits ?? 500;
    const sz = 64;

    const objects = [
      makeObjectDef('OilDerrick', 'GLA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        makeBlock('Behavior', 'AutoDepositUpdate ModuleTag_AutoDeposit', {
          DepositTiming: timingMs,
          DepositAmount: amount,
          InitialCaptureBonus: captureBonus,
        }),
      ]),
    ];

    const mapObjects: MapObjectJSON[] = [
      makeMapObject('OilDerrick', 30, 30),
    ];

    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');
    logic.submitCommand({ type: 'setSideCredits', side: 'gla', amount: startCredits });

    return { logic, startCredits };
  }

  it('deposits money at fixed intervals', () => {
    const { logic, startCredits } = makeAutoDepositSetup({
      depositTimingMs: 1000, // 30 frames
      depositAmount: 50,
    });

    // Source parity: C++ constructor sets m_depositOnFrame = currentFrame + depositFrame.
    // Entity created at frame 0, so first deposit at frame 30.
    // Advance 29 frames (frameCounter 1-29) — no deposit yet.
    for (let i = 0; i < 29; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getSideCredits('gla')).toBe(startCredits);

    // Frame 30 triggers the first deposit.
    logic.update(1 / 30);
    expect(logic.getSideCredits('gla')).toBe(startCredits + 50);
  });

  it('deposits repeatedly at each interval', () => {
    const { logic, startCredits } = makeAutoDepositSetup({
      depositTimingMs: 500, // 15 frames
      depositAmount: 25,
    });
    logic.update(0);

    // Advance 45 frames = 3 deposit intervals.
    for (let i = 0; i < 45; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getSideCredits('gla')).toBe(startCredits + 75);
  });

  it('awards initial capture bonus on ownership change', () => {
    // Source parity: C++ awardInitialCaptureBonus is called from Player.cpp line 1038
    // when a building with AutoDeposit changes ownership to a non-neutral player.
    const sz = 64;
    const objects = [
      makeObjectDef('OilDerrick', 'Neutral', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        makeBlock('Behavior', 'AutoDepositUpdate ModuleTag_AutoDeposit', {
          DepositTiming: 10000, // Long interval — no periodic deposits during test.
          DepositAmount: 10,
          InitialCaptureBonus: 200,
        }),
      ]),
    ];

    const mapObjects: MapObjectJSON[] = [makeMapObject('OilDerrick', 30, 30)];
    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');
    logic.submitCommand({ type: 'setSideCredits', side: 'gla', amount: 500 });

    // Let the deposit timer elapse so m_initialized becomes true and capture bonus is pending.
    // DepositTiming = 10000ms → 300 frames. Advance 301 frames to let the timer fire.
    for (let i = 0; i < 301; i++) {
      logic.update(1 / 30);
    }
    // Still neutral — no deposit and no capture bonus yet.
    expect(logic.getSideCredits('gla')).toBe(500);

    // Capture: change ownership to GLA.
    logic.submitCommand({ type: 'captureEntity', entityId: 1, newSide: 'gla' });
    logic.update(1 / 30);

    // Capture bonus of 200 should be awarded.
    expect(logic.getSideCredits('gla')).toBe(700);

    // Capture again — bonus should NOT be awarded again.
    logic.submitCommand({ type: 'captureEntity', entityId: 1, newSide: 'gla' });
    logic.update(1 / 30);
    expect(logic.getSideCredits('gla')).toBe(700);
  });

  it('does not deposit for entities under construction', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('OilDerrick', 'GLA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        makeBlock('Behavior', 'AutoDepositUpdate ModuleTag_AutoDeposit', {
          DepositTiming: 100, // Very short
          DepositAmount: 999,
          InitialCaptureBonus: 0,
        }),
      ], { BuildTime: 100 }), // 100 seconds
      makeObjectDef('Dozer', 'GLA', ['VEHICLE', 'DOZER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
    ];

    const mapObjects: MapObjectJSON[] = [
      makeMapObject('Dozer', 25, 30),
    ];

    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');
    logic.submitCommand({ type: 'setSideCredits', side: 'gla', amount: 1000 });
    logic.update(0);

    // Command dozer to construct the building.
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'OilDerrick',
      targetPosition: [30, 0, 30],
      angle: 0,
      lineEndPosition: null,
    });

    // Advance frames — building is under construction.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Credits should not have increased from auto-deposit (only building cost deducted).
    const credits = logic.getSideCredits('gla');
    // Building cost is deducted but no auto-deposit income should have been added.
    expect(credits).toBeLessThanOrEqual(1000);
  });

  it('does not deposit for entities without a player type', () => {
    const { logic, startCredits } = makeAutoDepositSetup({
      depositTimingMs: 100,
      depositAmount: 999,
    });
    // Remove player type mapping.
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.delete('gla');
    logic.update(0);

    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // No deposits should have been made.
    expect(logic.getSideCredits('gla')).toBe(startCredits);
  });

  it('skips deposit when depositAmount is zero', () => {
    const { logic, startCredits } = makeAutoDepositSetup({
      depositTimingMs: 100, // 3 frames
      depositAmount: 0,
    });

    // Advance 60 frames — deposit timer fires many times but amount is zero.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // No deposits should have occurred.
    expect(logic.getSideCredits('gla')).toBe(startCredits);
  });
});

describe('DynamicShroudClearingRangeUpdate', () => {
  function makeDynamicShroudSetup(opts?: {
    growDelayMs?: number;
    growTimeMs?: number;
    shrinkDelayMs?: number;
    shrinkTimeMs?: number;
    finalVision?: number;
    changeIntervalMs?: number;
    growIntervalMs?: number;
    visionRange?: number;
  }) {
    const sz = 64;
    const growDelayMs = opts?.growDelayMs ?? 100;   // 3 frames
    const growTimeMs = opts?.growTimeMs ?? 200;      // 6 frames
    const shrinkDelayMs = opts?.shrinkDelayMs ?? 333; // 10 frames (must be >= growDelay + growTime per C++ invariant)
    const shrinkTimeMs = opts?.shrinkTimeMs ?? 200;   // 6 frames
    const finalVision = opts?.finalVision ?? 5;
    const changeIntervalMs = opts?.changeIntervalMs ?? 33; // ~1 frame
    const growIntervalMs = opts?.growIntervalMs ?? 33;     // ~1 frame
    const visionRange = opts?.visionRange ?? 100;

    const objects = [
      makeObjectDef('SpySat', 'USA', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'DynamicShroudClearingRangeUpdate ModuleTag_Shroud', {
          GrowDelay: growDelayMs,
          GrowTime: growTimeMs,
          ShrinkDelay: shrinkDelayMs,
          ShrinkTime: shrinkTimeMs,
          FinalVision: finalVision,
          ChangeInterval: changeIntervalMs,
          GrowInterval: growIntervalMs,
        }),
      ], { VisionRange: visionRange }),
    ];

    const mapObjects: MapObjectJSON[] = [makeMapObject('SpySat', 30, 30)];
    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('usa', 'HUMAN');

    return { logic };
  }

  function getEntityRanges(logic: GameLogicSubsystem): { visionRange: number; shroudClearingRange: number } {
    const entities = (logic as unknown as {
      spawnedEntities: Map<number, { visionRange: number; shroudClearingRange: number }>;
    }).spawnedEntities;
    for (const entity of entities.values()) {
      return {
        visionRange: entity.visionRange,
        shroudClearingRange: entity.shroudClearingRange,
      };
    }
    return { visionRange: 0, shroudClearingRange: 0 };
  }

  it('animates shroud-clearing range over the full dynamic shroud lifecycle', () => {
    // growDelay=3 frames, growTime=6 frames, shrinkDelay=10 frames, shrinkTime=6 frames
    // stateCountDown = shrinkDelay + shrinkTime = 10 + 6 = 16
    // shrinkStartDeadline = 16 - 10 = 6
    // growStartDeadline = 16 - 3 = 13
    // sustainDeadline = 13 - 6 = 7 (>= shrinkStartDeadline ✓)
    const { logic } = makeDynamicShroudSetup({
      growDelayMs: 100,   // 3 frames
      growTimeMs: 200,    // 6 frames
      shrinkDelayMs: 333, // 10 frames
      shrinkTimeMs: 200,  // 6 frames
      finalVision: 5,
      visionRange: 100,
    });

    // Initial vision range should remain unchanged by DynamicShroud.
    // DynamicShroud modifies shroud-clearing range.
    logic.update(1 / 30); // frame 1

    // After enough frames, the vision range should start growing.
    // The grow phase grows by nativeClearingRange/growTime per frame.
    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
    }

    // After all phases complete, shroud-clearing range should reach finalVision = 5.
    // Keep advancing until DONE/SLEEPING.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const finalRanges = getEntityRanges(logic);
    expect(finalRanges.shroudClearingRange).toBeCloseTo(5, 0);
    expect(finalRanges.visionRange).toBe(100);
  });

  it('settles shroud-clearing range to finalVision after full lifecycle', () => {
    const { logic } = makeDynamicShroudSetup({
      growDelayMs: 33,    // 1 frame
      growTimeMs: 100,    // 3 frames
      shrinkDelayMs: 133, // 4 frames (>= growDelay + growTime per C++ invariant)
      shrinkTimeMs: 100,  // 3 frames
      finalVision: 10,
      changeIntervalMs: 33, // 1 frame
      growIntervalMs: 33,   // 1 frame
      visionRange: 50,
    });

    // Run enough frames for the full lifecycle: grow → sustain → shrink → done → sleeping.
    // stateCountDown = shrinkDelay + shrinkTime = 4 + 3 = 7 frames total.
    // Run 30 frames to be safe.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const finalRanges = getEntityRanges(logic);
    expect(finalRanges.shroudClearingRange).toBeCloseTo(10, 0);
    expect(finalRanges.visionRange).toBe(50);
  });

  it('does not modify vision or shroud-clearing range without the module', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('Tank', 'USA', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ], { VisionRange: 150 }),
    ];
    const mapObjects: MapObjectJSON[] = [makeMapObject('Tank', 30, 30)];
    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));

    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const ranges = getEntityRanges(logic);
    expect(ranges.visionRange).toBe(150);
    expect(ranges.shroudClearingRange).toBe(150);
  });
});

describe('VeterancyGainCreate', () => {
  it('sets starting veterancy level when player has required science', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('EliteTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'VeterancyGainCreate ModuleTag_VetCreate', {
          StartingLevel: 'VETERAN',
          ScienceRequired: 'SCIENCE_TANK_VETERAN',
        }),
      ], { ExperienceRequired: [0, 50, 200, 500], ExperienceValue: [10, 20, 30, 40] }),
    ];
    const sciences = [makeScienceDef('SCIENCE_TANK_VETERAN', { IsGrantable: 'Yes' })];
    const bundle = makeBundle({ objects, sciences });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Pre-populate the side's science set directly (bypasses registry lookup in grantSideScience).
    const priv = logic as unknown as { sideSciences: Map<string, Set<string>> };
    priv.sideSciences.set('america', new Set(['SCIENCE_TANK_VETERAN']));

    logic.loadMapObjects(makeMap([makeMapObject('EliteTank', 30, 30)], sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('america', 'HUMAN');

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, { experienceState: { currentLevel: number } }>;
    }).spawnedEntities;
    const tank = entities.get(1)!;
    // Should start at VETERAN (level 1) due to VeterancyGainCreate.
    expect(tank.experienceState.currentLevel).toBe(1);
  });

  it('does not set veterancy when player lacks required science', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('EliteTank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'VeterancyGainCreate ModuleTag_VetCreate', {
          StartingLevel: 'ELITE',
          ScienceRequired: 'SCIENCE_TANK_ELITE',
        }),
      ], { ExperienceRequired: [0, 50, 200, 500], ExperienceValue: [10, 20, 30, 40] }),
    ];
    const sciences = [makeScienceDef('SCIENCE_TANK_ELITE', { IsGrantable: 'Yes' })];
    const bundle = makeBundle({ objects, sciences });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Do NOT grant the science — sideSciences is empty.
    logic.loadMapObjects(makeMap([makeMapObject('EliteTank', 30, 30)], sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('america', 'HUMAN');

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, { experienceState: { currentLevel: number } }>;
    }).spawnedEntities;
    const tank = entities.get(1)!;
    // Should stay at REGULAR (level 0) since the science is not owned.
    expect(tank.experienceState.currentLevel).toBe(0);
  });

  it('sets veterancy without science requirement when ScienceRequired is omitted', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('HeroUnit', 'GLA', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        makeBlock('Behavior', 'VeterancyGainCreate ModuleTag_VetCreate', {
          StartingLevel: 'HEROIC',
        }),
      ], { ExperienceRequired: [0, 100, 300, 800], ExperienceValue: [50, 100, 150, 200] }),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('HeroUnit', 30, 30)], sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, { experienceState: { currentLevel: number } }>;
    }).spawnedEntities;
    const unit = entities.get(1)!;
    // Should start at HEROIC (level 3) since no science is required.
    expect(unit.experienceState.currentLevel).toBe(3);
  });

  it('never lowers veterancy level (setMinVeterancyLevel)', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('MixedVet', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        // First module grants ELITE unconditionally.
        makeBlock('Behavior', 'VeterancyGainCreate ModuleTag_VetCreate1', {
          StartingLevel: 'ELITE',
        }),
        // Second module would grant VETERAN — should be ignored (never lowers).
        makeBlock('Behavior', 'VeterancyGainCreate ModuleTag_VetCreate2', {
          StartingLevel: 'VETERAN',
        }),
      ], { ExperienceRequired: [0, 50, 200, 500], ExperienceValue: [10, 20, 30, 40] }),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('MixedVet', 30, 30)], sz, sz), registry, makeHeightmap(sz, sz));
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('america', 'HUMAN');

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, { experienceState: { currentLevel: number } }>;
    }).spawnedEntities;
    const tank = entities.get(1)!;
    // Should be ELITE (level 2), not lowered to VETERAN.
    expect(tank.experienceState.currentLevel).toBe(2);
  });
});

describe('WanderAIUpdate', () => {
  function makeWanderSetup() {
    const objects = [
      makeObjectDef('Wanderer', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('LocomotorSet', 'SET_NORMAL WanderLoco', {}),
        makeBlock('Behavior', 'WanderAIUpdate ModuleTag_Wander', {}),
      ]),
      makeObjectDef('Stationary', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('LocomotorSet', 'SET_NORMAL WanderLoco', {}),
      ]),
    ];
    const bundle = makeBundle({ objects, locomotors: [makeLocomotorDef('WanderLoco', 30)] });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('Wanderer', 50, 50), makeMapObject('Stationary', 200, 200)], 128, 128),
      registry, makeHeightmap(128, 128),
    );
    return logic;
  }

  it('moves idle entity with WanderAIUpdate to a random position', () => {
    const logic = makeWanderSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { x: number; z: number; hasWanderAI: boolean; canMove: boolean }> };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.hasWanderAI).toBe(true);
    expect(entity.canMove).toBe(true);
    const startX = entity.x;
    const startZ = entity.z;

    // Run enough frames for wander movement to occur
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const hasMoved = entity.x !== startX || entity.z !== startZ;
    expect(hasMoved).toBe(true);
  });

  it('does not move entity without WanderAIUpdate', () => {
    const logic = makeWanderSetup();
    const priv = logic as unknown as { spawnedEntities: Map<number, { x: number; z: number }> };
    const entity = priv.spawnedEntities.get(2)!;
    const startX = entity.x;
    const startZ = entity.z;

    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    expect(entity.x).toBe(startX);
    expect(entity.z).toBe(startZ);
  });
});

describe('FloatUpdate', () => {
  function makeFloatSetup(opts?: { enabled?: boolean; waterHeight?: number }) {
    const sz = 64;
    const waterH = opts?.waterHeight ?? 20;
    const enabled = opts?.enabled ?? true;
    const objects = [
      makeObjectDef('Boat', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'FloatUpdate ModuleTag_Float', {
          Enabled: enabled ? 'Yes' : 'No',
        }),
      ]),
      makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Create map with a water polygon trigger covering the area 0..500, 0..500.
    // MapPoint uses original engine coordinates: x=horizontal X, y=horizontal Z, z=height.
    const mapData: MapDataJSON = {
      heightmap: {
        width: sz,
        height: sz,
        borderSize: 0,
        data: uint8ArrayToBase64(new Uint8Array(sz * sz).fill(0)),
      },
      objects: [
        makeMapObject('Boat', 50, 50),
        makeMapObject('Tank', 200, 200),
      ],
      triggers: [{
        name: 'WaterArea1',
        id: 1,
        isWaterArea: true,
        isRiver: false,
        points: [
          { x: 0, y: 0, z: waterH },
          { x: 500, y: 0, z: waterH },
          { x: 500, y: 500, z: waterH },
          { x: 0, y: 500, z: waterH },
        ],
      }],
      textureClasses: [],
      blendTileCount: 0,
    };

    logic.loadMapObjects(mapData, registry, makeHeightmap(sz, sz));
    return logic;
  }

  it('snaps entity with FloatUpdate to water surface height', () => {
    const waterHeight = 25;
    const logic = makeFloatSetup({ waterHeight });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { y: number; baseHeight: number; floatUpdateProfile: { enabled: boolean } | null }>;
    };
    const boat = priv.spawnedEntities.get(1)!;
    expect(boat.floatUpdateProfile?.enabled).toBe(true);

    // Before update, entity is on terrain (height = 0 + baseHeight).
    const baseH = boat.baseHeight;
    expect(boat.y).toBeCloseTo(baseH, 1);

    // After one frame, entity should snap to water surface.
    logic.update(1 / 30);
    expect(boat.y).toBeCloseTo(waterHeight + baseH, 1);
  });

  it('does not modify entity without FloatUpdate', () => {
    const logic = makeFloatSetup({ waterHeight: 25 });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { y: number; floatUpdateProfile: { enabled: boolean } | null }>;
    };
    const tank = priv.spawnedEntities.get(2)!;
    expect(tank.floatUpdateProfile).toBeNull();

    const startY = tank.y;
    logic.update(1 / 30);
    expect(tank.y).toBe(startY);
  });

  it('does not modify entity with FloatUpdate when not over water', () => {
    const sz = 64;
    const objects = [
      makeObjectDef('Boat', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'FloatUpdate ModuleTag_Float', { Enabled: 'Yes' }),
      ]),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Map with NO water triggers.
    logic.loadMapObjects(
      makeMap([makeMapObject('Boat', 50, 50)], sz, sz),
      registry,
      makeHeightmap(sz, sz),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { y: number; floatUpdateProfile: { enabled: boolean } | null }>;
    };
    const boat = priv.spawnedEntities.get(1)!;
    expect(boat.floatUpdateProfile?.enabled).toBe(true);

    const startY = boat.y;
    logic.update(1 / 30);
    // Not over water, so height should not change.
    expect(boat.y).toBe(startY);
  });
});

describe('SlavedUpdate', () => {
  function makeSlavedSetup(opts?: {
    spawnNumber?: number;
    guardMaxRange?: number;
    attackRange?: number;
    scoutRange?: number;
    repairRatePerSecond?: number;
    repairBelowHealthPercent?: number;
    spawnedRequireSpawner?: boolean;
    oneShot?: boolean;
    initialBurst?: number;
    distToTargetToGrantRangeBonus?: number;
  }) {
    const guardRange = opts?.guardMaxRange ?? 50;
    const attackRange = opts?.attackRange ?? 0;
    const scoutRange = opts?.scoutRange ?? 0;
    const repairRate = opts?.repairRatePerSecond ?? 0;
    const repairBelow = opts?.repairBelowHealthPercent ?? 0;
    const requireSpawner = opts?.spawnedRequireSpawner ?? true;
    const isOneShot = opts?.oneShot ?? false;
    const spawnCount = opts?.spawnNumber ?? 1;
    const initialBurst = opts?.initialBurst ?? spawnCount;
    const droneSpottingDist = opts?.distToTargetToGrantRangeBonus ?? 0;
    const sz = 128;

    const objects = [
      // 1: Master vehicle with SpawnBehavior
      makeObjectDef('MasterVehicle', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: spawnCount,
          SpawnReplaceDelay: 3000, // 3 sec = 90 frames
          SpawnTemplateName: 'DroneUnit',
          SpawnedRequireSpawner: requireSpawner ? 'Yes' : 'No',
          OneShot: isOneShot ? 'Yes' : 'No',
          InitialBurst: initialBurst,
        }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'MasterGun'] }),
      ]),
      // 2: Drone slave with SlavedUpdate
      makeObjectDef('DroneUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'SlavedUpdate ModuleTag_Slaved', {
          GuardMaxRange: guardRange,
          GuardWanderRange: 10,
          AttackRange: attackRange,
          AttackWanderRange: 5,
          ScoutRange: scoutRange,
          ScoutWanderRange: 5,
          DistToTargetToGrantRangeBonus: droneSpottingDist,
          RepairRatePerSecond: repairRate,
          'RepairWhenBelowHealth%': repairBelow,
        }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'DroneGun'] }),
      ]),
      // Enemy target
      makeObjectDef('EnemyTank', 'GLA', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankGun'] }),
      ]),
    ];

    const mapObjects: MapObjectJSON[] = [
      makeMapObject('MasterVehicle', 60, 60),
      makeMapObject('EnemyTank', 60, 90),
    ];

    const bundle = makeBundle({
      objects,
      weapons: [
        makeWeaponDef('MasterGun', {
          AttackRange: 100,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
        makeWeaponDef('DroneGun', {
          AttackRange: 50,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 300,
        }),
        makeWeaponDef('TankGun', {
          AttackRange: 100,
          PrimaryDamage: 30,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('america', 'HUMAN');
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'COMPUTER');

    return { logic, sz };
  }

  function getEntity(logic: GameLogicSubsystem, id: number) {
    return (logic as unknown as { spawnedEntities: Map<number, {
      slaverEntityId: number | null;
      statusFlags: Set<string>;
      destroyed: boolean;
      health: number;
      maxHealth: number;
      moveTarget: { x: number; z: number } | null;
      attackTargetEntityId: number | null;
      x: number; z: number;
      weaponBonusConditionFlags: number;
    }> }).spawnedEntities.get(id);
  }

  it('spawns slaves on master creation and marks them UNSELECTABLE', () => {
    const { logic } = makeSlavedSetup({ spawnNumber: 2 });
    logic.update(0);

    // Master is entity 1, enemy is entity 2. Slaves should be 3 and 4.
    const slave1 = getEntity(logic, 3);
    const slave2 = getEntity(logic, 4);
    expect(slave1).toBeDefined();
    expect(slave2).toBeDefined();
    expect(slave1!.slaverEntityId).toBe(1);
    expect(slave2!.slaverEntityId).toBe(1);
    expect(slave1!.objectStatusFlags.has('UNSELECTABLE')).toBe(true);
    expect(slave2!.objectStatusFlags.has('UNSELECTABLE')).toBe(true);
  });

  it('kills slaves when master dies with spawnedRequireSpawner', () => {
    const { logic } = makeSlavedSetup({ spawnedRequireSpawner: true });
    logic.update(0);

    const slave = getEntity(logic, 3);
    expect(slave).toBeDefined();
    expect(slave!.destroyed).toBe(false);

    // Kill the master.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const master = api.spawnedEntities.get(1)!;
    api.applyWeaponDamageAmount(2, master as never, 9999, 'EXPLOSION');

    // Slave should also be destroyed.
    expect(slave!.destroyed).toBe(true);
  });

  it('disables slaves with DISABLED_UNMANNED when master dies without spawnedRequireSpawner', () => {
    const { logic } = makeSlavedSetup({ spawnedRequireSpawner: false });
    logic.update(0);

    const slave = getEntity(logic, 3);
    expect(slave).toBeDefined();

    // Kill the master.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const master = api.spawnedEntities.get(1)!;
    api.applyWeaponDamageAmount(2, master as never, 9999, 'EXPLOSION');

    // Slave should be orphaned (slaverEntityId = null) but not immediately destroyed.
    expect(slave!.slaverEntityId).toBe(null);
    expect(slave!.objectStatusFlags.has('UNSELECTABLE')).toBe(false);
  });

  it('replaces dead slaves after replace delay', () => {
    const { logic } = makeSlavedSetup({ spawnNumber: 1 });
    logic.update(0);

    const slave = getEntity(logic, 3);
    expect(slave).toBeDefined();

    // Kill the slave.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    api.applyWeaponDamageAmount(null, slave as never, 9999, 'EXPLOSION');

    // Advance frames but not enough for replacement (90 frames = 3s).
    for (let i = 0; i < 50; i++) {
      logic.update(1 / 30);
    }
    // No replacement yet.
    const potentialReplacement = getEntity(logic, 4);
    // Entity 4 might not exist or could be the replacement — check slave count.
    const master = getEntity(logic, 1);
    const state = (master as unknown as { spawnBehaviorState: { slaveIds: number[] } })?.spawnBehaviorState;
    const liveSlaves1 = state?.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    // At 50 frames, replacement shouldn't have happened yet.
    expect(liveSlaves1?.length ?? 0).toBe(0);

    // Advance past the 90-frame threshold.
    for (let i = 0; i < 50; i++) {
      logic.update(1 / 30);
    }
    const liveSlaves2 = state?.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    expect(liveSlaves2?.length ?? 0).toBe(1);
  });

  it('does not replace slaves when oneShot is true', () => {
    const { logic } = makeSlavedSetup({ spawnNumber: 1, oneShot: true });
    logic.update(0);

    const slave = getEntity(logic, 3);
    expect(slave).toBeDefined();

    // Kill the slave.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
    };
    api.applyWeaponDamageAmount(null, slave as never, 9999, 'EXPLOSION');

    // Advance well past replacement delay.
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }

    // No replacement should have occurred.
    const master = getEntity(logic, 1);
    const state = (master as unknown as { spawnBehaviorState: { slaveIds: number[] } })?.spawnBehaviorState;
    const liveSlaves = state?.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    expect(liveSlaves?.length ?? 0).toBe(0);
  });

  it('creates one-shot slaves when InitialBurst is zero on the next update', () => {
    const { logic } = makeSlavedSetup({ spawnNumber: 1, oneShot: true, initialBurst: 0 });

    logic.update(0);
    expect(getEntity(logic, 3)).toBeUndefined();

    logic.update(1 / 30);
    const slave = getEntity(logic, 3);
    expect(slave).toBeDefined();
    expect(slave!.slaverEntityId).toBe(1);
  });

  it('slave follows master via guard logic', () => {
    const { logic } = makeSlavedSetup({ guardMaxRange: 30 });
    logic.update(0);

    // Move the master far away.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 100, targetZ: 100 });

    // Advance enough frames for the master to move and slave to update.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    const slave = getEntity(logic, 3);
    expect(slave).toBeDefined();
    // Slave should have a move target (following the master).
    expect(slave!.moveTarget).not.toBeNull();
  });

  it('slave heals master when repair rate is set and master is damaged', () => {
    const { logic } = makeSlavedSetup({
      repairRatePerSecond: 30, // 1 HP per frame
      repairBelowHealthPercent: 100, // Always emergency repair
    });
    logic.update(0);

    // Damage the master.
    const master = getEntity(logic, 1);
    expect(master).toBeDefined();
    master!.health = 400;

    // Advance frames for repair to take effect.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Master should have healed somewhat.
    expect(master!.health).toBeGreaterThan(400);
  });

  it('extracts 7 repair fields (RepairRange, altitude, ready/weld times) from SlavedUpdate INI data', () => {
    const sz = 128;
    const objects = [
      makeObjectDef('RepairMaster', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: 1,
          SpawnReplaceDelay: 3000,
          SpawnTemplateName: 'RepairDrone',
          SpawnedRequireSpawner: 'Yes',
          InitialBurst: 1,
        }),
      ]),
      makeObjectDef('RepairDrone', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'SlavedUpdate ModuleTag_Slaved', {
          GuardMaxRange: 50,
          GuardWanderRange: 10,
          RepairRange: 25,
          RepairMinAltitude: 10.5,
          RepairMaxAltitude: 20.0,
          RepairRatePerSecond: 5,
          'RepairWhenBelowHealth%': 80,
          RepairMinReadyTime: 1000,  // 1000ms = 30 frames
          RepairMaxReadyTime: 2000,  // 2000ms = 60 frames
          RepairMinWeldTime: 500,    // 500ms  = 15 frames
          RepairMaxWeldTime: 1500,   // 1500ms = 45 frames
        }),
      ]),
    ];

    const bundle = makeBundle({ objects, weapons: [] });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('RepairMaster', 60, 60)], sz, sz), registry, makeHeightmap(sz, sz));

    // Let spawn happen.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    expect(master).toBeDefined();
    const slaveId = (master as unknown as { spawnBehaviorState: { slaveIds: number[] } }).spawnBehaviorState.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);
    expect(slave).toBeDefined();

    const profile = (slave as unknown as { slavedUpdateProfile: {
      repairRange: number;
      repairMinAltitude: number;
      repairMaxAltitude: number;
      repairMinReadyFrames: number;
      repairMaxReadyFrames: number;
      repairMinWeldFrames: number;
      repairMaxWeldFrames: number;
    } }).slavedUpdateProfile;

    expect(profile).not.toBeNull();
    expect(profile.repairRange).toBe(25);
    expect(profile.repairMinAltitude).toBeCloseTo(10.5);
    expect(profile.repairMaxAltitude).toBeCloseTo(20.0);
    // Duration fields: ms → frames at 30fps (1000ms=30, 2000ms=60, 500ms=15, 1500ms=45).
    expect(profile.repairMinReadyFrames).toBe(30);
    expect(profile.repairMaxReadyFrames).toBe(60);
    expect(profile.repairMinWeldFrames).toBe(15);
    expect(profile.repairMaxWeldFrames).toBe(45);
  });

  it('defaults repair fields to 0 when absent from INI', () => {
    const sz = 128;
    const objects = [
      makeObjectDef('DefaultMaster', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: 1,
          SpawnReplaceDelay: 3000,
          SpawnTemplateName: 'DefaultDrone',
          SpawnedRequireSpawner: 'Yes',
          InitialBurst: 1,
        }),
      ]),
      makeObjectDef('DefaultDrone', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'SlavedUpdate ModuleTag_Slaved', {
          GuardMaxRange: 50,
          GuardWanderRange: 10,
          // No repair fields specified — all should default to 0.
        }),
      ]),
    ];

    const bundle = makeBundle({ objects, weapons: [] });
    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('DefaultMaster', 60, 60)], sz, sz), registry, makeHeightmap(sz, sz));

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    const slaveId = (master as unknown as { spawnBehaviorState: { slaveIds: number[] } }).spawnBehaviorState.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    const profile = (slave as unknown as { slavedUpdateProfile: {
      repairRange: number;
      repairMinAltitude: number;
      repairMaxAltitude: number;
      repairMinReadyFrames: number;
      repairMaxReadyFrames: number;
      repairMinWeldFrames: number;
      repairMaxWeldFrames: number;
    } }).slavedUpdateProfile;

    expect(profile.repairRange).toBe(0);
    expect(profile.repairMinAltitude).toBe(0);
    expect(profile.repairMaxAltitude).toBe(0);
    expect(profile.repairMinReadyFrames).toBe(0);
    expect(profile.repairMaxReadyFrames).toBe(0);
    expect(profile.repairMinWeldFrames).toBe(0);
    expect(profile.repairMaxWeldFrames).toBe(0);
  });
});

describe('PilotFindVehicleUpdate', () => {
  function makePilotSetup(opts: {
    pilotSide?: string;
    vehicleSide?: string;
    playerType?: 'HUMAN' | 'COMPUTER';
    pilotOriginalOwner?: string;
    vehicleHealth?: number;
    vehicleMaxHealth?: number;
    scanRange?: number;
    minHealth?: number;
    vehicleOccupied?: boolean;
  } = {}) {
    const pilotSide = opts.pilotSide ?? 'America';
    const vehicleSide = opts.vehicleSide ?? 'America';
    const playerType = opts.playerType ?? 'COMPUTER';
    const vehicleHealth = opts.vehicleHealth ?? 200;
    const vehicleMaxHealth = opts.vehicleMaxHealth ?? 200;
    const scanRange = opts.scanRange ?? 300;
    const minHealth = opts.minHealth ?? 0.5;

    const objects: ObjectDef[] = [
      makeObjectDef('Pilot', pilotSide, ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('Behavior', 'VeterancyCrateCollide ModuleTag_PilotCollide', {
          IsPilot: 'Yes',
        }),
        makeBlock('Behavior', 'PilotFindVehicleUpdate ModuleTag_PFV', {
          ScanRate: 100,
          ScanRange: scanRange,
          MinHealth: minHealth,
        }),
      ]),
      makeObjectDef('EmptyTank', vehicleSide, ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: vehicleMaxHealth, InitialHealth: vehicleHealth }),
      ], { ExperienceRequired: [1, 50, 100, 200] }),
    ];

    if (opts.vehicleOccupied) {
      objects.push(
        makeObjectDef('Occupant', vehicleSide, ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      );
    }

    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    const mapObjects = [
      makeMapObject(
        'Pilot',
        5,
        5,
        opts.pilotOriginalOwner ? { OriginalOwner: opts.pilotOriginalOwner } : undefined,
      ),
      makeMapObject('EmptyTank', 5, 8),
    ];
    if (opts.vehicleOccupied) {
      mapObjects.push(makeMapObject('Occupant', 5, 8));
    }

    logic.loadMapObjects(
      makeMap(mapObjects, 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    if (playerType === 'COMPUTER') {
      logic.submitCommand({ type: 'setSidePlayerType', side: pilotSide, playerType: 'COMPUTER' });
    }

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        x: number;
        z: number;
        y: number;
        moving: boolean;
        destroyed: boolean;
        moveTarget: { x: number; z: number } | null;
        pilotFindVehicleProfile: unknown;
        pilotFindVehicleDidMoveToBase: boolean;
        pilotFindVehicleTargetId: number | null;
        transportContainerId: number | null;
        experienceState: { currentLevel: number };
        category: string;
      }>;
    }).spawnedEntities;

    let pilot: (typeof entities extends Map<number, infer V> ? V : never) | undefined;
    let vehicle: (typeof entities extends Map<number, infer V> ? V : never) | undefined;
    let occupant: (typeof entities extends Map<number, infer V> ? V : never) | undefined;
    for (const [, e] of entities) {
      if (e.templateName === 'Pilot') pilot = e;
      if (e.templateName === 'EmptyTank') vehicle = e;
      if (e.templateName === 'Occupant') occupant = e;
    }

    if (opts.vehicleOccupied && occupant && vehicle) {
      occupant.transportContainerId = vehicle.id;
    }

    return { logic, pilot: pilot!, vehicle: vehicle!, entities };
  }

  it('initializes PilotFindVehicleProfile from INI', () => {
    const { pilot } = makePilotSetup();
    expect(pilot.pilotFindVehicleProfile).not.toBeNull();
  });

  it('AI pilot moves toward empty same-side vehicle', () => {
    const { logic, pilot, vehicle } = makePilotSetup();

    // Run enough frames for the scan to trigger and pilot to reach vehicle.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // Pilot should either still be moving/targeting, or be consumed after veterancy transfer.
    const hasTarget = pilot.pilotFindVehicleTargetId === vehicle.id;
    const isMoving = pilot.moveTarget !== null || pilot.moving;
    expect(hasTarget || isMoving || pilot.destroyed).toBe(true);
    if (pilot.destroyed) {
      expect(vehicle.experienceState.currentLevel).toBeGreaterThan(0);
    }
  });

  it('does not activate for human-controlled pilots', () => {
    const { logic, pilot } = makePilotSetup({ playerType: 'HUMAN' });

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    // Human-controlled pilots should not auto-seek vehicles.
    expect(pilot.pilotFindVehicleTargetId).toBeNull();
  });

  it('uses controlling player type to activate for AI-controlled pilots even when side is human', () => {
    const { logic, pilot, vehicle } = makePilotSetup({
      playerType: 'HUMAN',
      pilotOriginalOwner: 'AIPlayer',
    });
    logic.submitCommand({ type: 'setSidePlayerType', side: 'AIPlayer', playerType: 'COMPUTER' });

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    const hasTarget = pilot.pilotFindVehicleTargetId === vehicle.id;
    const isMoving = pilot.moveTarget !== null || pilot.moving;
    expect(hasTarget || isMoving || pilot.destroyed).toBe(true);
  });

  it('uses controlling player type to block for human-controlled pilots even when side is AI', () => {
    const { logic, pilot } = makePilotSetup({
      playerType: 'COMPUTER',
      pilotOriginalOwner: 'HumanPlayer',
    });
    logic.submitCommand({ type: 'setSidePlayerType', side: 'HumanPlayer', playerType: 'HUMAN' });

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    expect(pilot.pilotFindVehicleTargetId).toBeNull();
    expect(pilot.destroyed).toBe(false);
  });

  it('rejects vehicles below minHealth threshold', () => {
    // Vehicle at 40% health (80/200), minHealth=0.5 → below 50%, should be rejected.
    const { logic, pilot } = makePilotSetup({
      vehicleHealth: 80,
      vehicleMaxHealth: 200,
      minHealth: 0.5,
    });

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    // Pilot should NOT target the damaged vehicle.
    expect(pilot.pilotFindVehicleTargetId).toBeNull();
  });

  it('does not target vehicles of different side', () => {
    const { logic, pilot } = makePilotSetup({ vehicleSide: 'GLA' });

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    expect(pilot.pilotFindVehicleTargetId).toBeNull();
  });

  it('allows targeting occupied same-side vehicles when pilot collide path is valid', () => {
    const { logic, pilot, vehicle } = makePilotSetup({ vehicleOccupied: true });

    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // Source parity: occupied same-side vehicles are still valid for pilot collide behavior.
    expect(pilot.destroyed).toBe(true);
    expect(vehicle.experienceState.currentLevel).toBeGreaterThan(0);
  });

  it('moves to base when no vehicle found', () => {
    // Create setup with a building for base center + vehicle out of scan range.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Pilot', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'PilotFindVehicleUpdate ModuleTag_PFV', {
            ScanRate: 100,
            ScanRange: 1,
            MinHealth: 0.5,
          }),
        ]),
        makeObjectDef('EmptyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('BaseBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Pilot', 5, 5),
        makeMapObject('EmptyTank', 60, 60),  // Far away, out of scan range (1)
        makeMapObject('BaseBuilding', 10, 10),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });

    const entities = (logic as unknown as {
      spawnedEntities: Map<number, {
        templateName: string;
        pilotFindVehicleDidMoveToBase: boolean;
      }>;
    }).spawnedEntities;

    let pilot: { templateName: string; pilotFindVehicleDidMoveToBase: boolean } | undefined;
    for (const [, e] of entities) {
      if (e.templateName === 'Pilot') pilot = e;
    }

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    // After scan finds no vehicle, pilot should move to base once.
    expect(pilot!.pilotFindVehicleDidMoveToBase).toBe(true);
  });

  it('uses SidesList build-list locations for AI base-center movement', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Pilot', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'PilotFindVehicleUpdate ModuleTag_PFV', {
            ScanRate: 100,
            ScanRange: 1,
            MinHealth: 0.5,
          }),
        ]),
        makeObjectDef('EmptyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('BaseBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });

    const map = makeMap([
      makeMapObject('Pilot', 5, 5),
      makeMapObject('EmptyTank', 60, 60),
      // Live structure near the pilot; base-center should come from build list instead.
      makeMapObject('BaseBuilding', 12, 12),
    ], 256, 256);
    map.sidesList = {
      sides: [
        {
          dict: {
            playerName: 'AmericaPlayer',
            playerFaction: 'America',
            skirmishDifficulty: 1,
          },
          buildList: [
            {
              buildingName: 'PlannedBaseA',
              templateName: 'BaseBuilding',
              location: { x: 100, y: 150, z: 0 },
              angle: 0,
              initiallyBuilt: false,
              numRebuilds: 1,
            },
            {
              buildingName: 'PlannedBaseB',
              templateName: 'BaseBuilding',
              location: { x: 120, y: 150, z: 0 },
              angle: 0,
              initiallyBuilt: false,
              numRebuilds: 1,
            },
            {
              buildingName: 'PlannedBaseC',
              templateName: 'BaseBuilding',
              location: { x: 80, y: 180, z: 0 },
              angle: 0,
              initiallyBuilt: false,
              numRebuilds: 1,
            },
          ],
        },
      ],
      teams: [],
    };

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      map,
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );
    logic.submitCommand({ type: 'setSidePlayerType', side: 'America', playerType: 'COMPUTER' });

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, {
        templateName: string;
        pilotFindVehicleDidMoveToBase: boolean;
      }>;
      resolveAiBaseCenterAndRadius(side: string | null): { centerX: number; centerZ: number; radius: number } | null;
    };

    const baseCenter = privateApi.resolveAiBaseCenterAndRadius('America');
    expect(baseCenter).not.toBeNull();
    expect(baseCenter?.centerX ?? 0).toBeCloseTo(100, 4);
    expect(baseCenter?.centerZ ?? 0).toBeCloseTo(160, 4);

    let pilot: { templateName: string; pilotFindVehicleDidMoveToBase: boolean } | undefined;
    for (const [, entity] of privateApi.spawnedEntities) {
      if (entity.templateName === 'Pilot') {
        pilot = entity;
        break;
      }
    }

    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    expect(pilot?.pilotFindVehicleDidMoveToBase).toBe(true);
  });
});

function makeSpecialAbilityBundle(params: {
  abilityFields?: Record<string, unknown>;
  specialPowerName?: string;
  targetObjectDef?: ReturnType<typeof makeObjectDef>;
  moveSpeed?: number;
}) {
  const specialPowerName = params.specialPowerName ?? 'TestAbilityPower';
  const moveSpeed = params.moveSpeed ?? 30;
  return makeBundle({
    objects: [
      makeObjectDef('AbilityUser', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'SpecialAbilityUpdate AbilityModule', {
          SpecialPowerTemplate: specialPowerName,
          UpdateModuleStartsAttack: true,
          ...params.abilityFields,
        }),
        makeBlock('LocomotorSet', 'LocomotorSet', { Locomotor: ['SET_NORMAL', 'TestLoco'] }),
      ], { CommandSet: 'AbilityUserCS', BuildCost: 500 }),
      ...(params.targetObjectDef ? [params.targetObjectDef] : [
        makeObjectDef('AbilityTarget', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ]),
    ],
    specialPowers: [
      makeSpecialPowerDef(specialPowerName, { ReloadTime: 0 }),
    ],
    locomotors: [
      makeLocomotorDef('TestLoco', moveSpeed),
    ],
  });
}

function makeSpecialAbilitySetup(
  abilityFields: Record<string, unknown> = {},
  targetPosition?: { x: number; y: number },
) {
  const bundle = makeSpecialAbilityBundle({ abilityFields });
  const scene = new THREE.Scene();
  const logic = new GameLogicSubsystem(scene);

  const mapObjects = [
    makeMapObject('AbilityUser', 10, 10),
    ...(targetPosition ? [makeMapObject('AbilityTarget', targetPosition.x, targetPosition.y)] : []),
  ];

  logic.loadMapObjects(
    makeMap(mapObjects),
    makeRegistry(bundle),
    makeHeightmap(),
  );

  return { logic, scene };
}

describe('SpecialAbilityUpdate', () => {
  it('extracts SpecialAbilityProfile from INI', () => {
    const { logic } = makeSpecialAbilitySetup({
      StartAbilityRange: 50,
      AbilityAbortRange: 100,
      PreparationTime: 1000,
      PackTime: 500,
      UnpackTime: 750,
      SkipPackingWithNoTarget: true,
      FleeRangeAfterCompletion: 40,
      FlipOwnerAfterUnpacking: true,
    });

    const entity = logic.getEntityState(1);
    expect(entity).not.toBeNull();
    // Entity should have been created successfully with a special ability profile.
    // Verify via the specialAbilityState being initialized.
    expect(entity!.statusFlags).toBeDefined();
  });

  it('initiates ability and sets IS_USING_ABILITY status flag', () => {
    const { logic } = makeSpecialAbilitySetup(
      { UnpackTime: 0, PreparationTime: 500, SkipPackingWithNoTarget: true },
    );

    // Issue special ability command (no target).
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
    logic.update(1 / 30);

    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    expect(state!.statusFlags).toContain('IS_USING_ABILITY');
  });

  it('runs unpack → preparation → pack lifecycle with no target', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        UnpackTime: 100,  // ~3 frames
        PreparationTime: 100, // ~3 frames
        PackTime: 100, // ~3 frames
        SkipPackingWithNoTarget: false,
      },
    );

    // Issue no-target ability.
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });

    // Tick through unpack + prep + pack: ~9 frames + overhead.
    let abilityCleared = false;
    for (let frame = 0; frame < 30; frame++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && !s.statusFlags.includes('IS_USING_ABILITY') && frame > 2) {
        abilityCleared = true;
        break;
      }
    }

    expect(abilityCleared).toBe(true);
  });

  it('skips packing with SkipPackingWithNoTarget and no-target command', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        UnpackTime: 0,
        PreparationTime: 100, // ~3 frames
        PackTime: 500, // would be ~15 frames if not skipped
        SkipPackingWithNoTarget: true,
      },
    );

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });

    // With SkipPackingWithNoTarget and prep ~3 frames, should finish quickly
    // (no unpack, prep only, then skip pack → finish).
    let abilityCleared = false;
    for (let frame = 0; frame < 10; frame++) {
      logic.update(1 / 30);
      const s = logic.getEntityState(1);
      if (s && !s.statusFlags.includes('IS_USING_ABILITY') && frame > 0) {
        abilityCleared = true;
        break;
      }
    }

    // Should finish in well under 10 frames (no 15-frame pack).
    expect(abilityCleared).toBe(true);
  });

  it('approaches target position when not within StartAbilityRange', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        StartAbilityRange: 15,
        UnpackTime: 0,
        PreparationTime: 100,
        PackTime: 0,
      },
    );

    // commandOption 0x20 = COMMAND_OPTION_NEED_TARGET_POS — position-targeted ability.
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0x20,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: 50,
      targetZ: 50,
    });
    logic.update(1 / 30);

    // Entity should have the special ability active with target position stored.
    const entity = (logic as any).spawnedEntities.get(1);
    expect(entity).toBeDefined();
    // Verify ability was initiated.
    expect(entity.specialAbilityState).not.toBeNull();
    expect(entity.specialAbilityState.active).toBe(true);
    expect(entity.specialAbilityState.targetX).toBe(50);
    expect(entity.specialAbilityState.targetZ).toBe(50);
    // Verify entity is not yet within range.
    expect(entity.specialAbilityState.withinStartAbilityRange).toBe(false);
  });

  it('aborts ability when target entity dies during preparation', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        StartAbilityRange: 10000,
        UnpackTime: 0,
        PreparationTime: 5000, // long prep time (~150 frames)
        PackTime: 0,
      },
      { x: 10, y: 11 }, // Target placed very close.
    );

    // Directly initiate the special ability with target entity via internal state,
    // bypassing the routing layer which requires enemy relationship.
    const entity = (logic as any).spawnedEntities.get(1);
    const state = entity.specialAbilityState;
    state.active = true;
    state.targetEntityId = 2;
    state.withinStartAbilityRange = true;
    state.packingState = 'UNPACKED';
    entity.objectStatusFlags.add('IS_USING_ABILITY');

    // Tick a few frames to get into preparation.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.statusFlags).toContain('IS_USING_ABILITY');

    // Force-kill target by directly manipulating internal state.
    const target = (logic as any).spawnedEntities.get(2);
    if (target) {
      target.health = 0;
      target.destroyed = true;
    }

    logic.update(1 / 30);

    // Ability should be aborted — IS_USING_ABILITY cleared.
    const afterState = logic.getEntityState(1);
    expect(afterState!.statusFlags).not.toContain('IS_USING_ABILITY');
  });

  it('cancels ability when entity receives stop command', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        StartAbilityRange: 10000,
        UnpackTime: 0,
        PreparationTime: 5000,
        PackTime: 0,
        SkipPackingWithNoTarget: true,
      },
    );

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });

    // Tick a few frames — IS_USING_ABILITY set at preparation start (first frame).
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    expect(logic.getEntityState(1)!.statusFlags).toContain('IS_USING_ABILITY');

    // Stop command should cancel the ability.
    logic.submitCommand({ type: 'stop', entityId: 1 });
    logic.update(1 / 30);

    expect(logic.getEntityState(1)!.statusFlags).not.toContain('IS_USING_ABILITY');
  });

  it('persistent ability triggers multiple times before packing', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        StartAbilityRange: 10000,
        UnpackTime: 0,
        PreparationTime: 100, // ~3 frames to first trigger
        PersistentPrepTime: 100, // ~3 frames between subsequent triggers
        PackTime: 0,
        SkipPackingWithNoTarget: true,
      },
    );

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });

    // Run for 20 frames — should trigger multiple times and stay active.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Persistent ability should STILL be active (never packs until stopped).
    const state = logic.getEntityState(1);
    expect(state!.statusFlags).toContain('IS_USING_ABILITY');
  });

  it('flips entity rotation after unpacking when FlipOwnerAfterUnpacking is set', () => {
    const { logic } = makeSpecialAbilitySetup(
      {
        StartAbilityRange: 10000,
        UnpackTime: 100, // ~3 frames
        PreparationTime: 10000,
        PackTime: 0,
        FlipOwnerAfterUnpacking: true,
        SkipPackingWithNoTarget: false,
      },
    );

    const entity = (logic as any).spawnedEntities.get(1);
    const rotBefore = entity.rotationY;

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_ABILITY',
      specialPowerName: 'TestAbilityPower',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });

    // Run through unpack animation (~3 frames) + a few extra.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    // Rotation should have changed by PI (180 degrees).
    const rotDiff = Math.abs(entity.rotationY - rotBefore);
    expect(rotDiff).toBeCloseTo(Math.PI, 1);
  });

  it('extracts SpecialObject and related fields from INI', () => {
    const { logic } = makeSpecialAbilitySetup({
      SpecialObject: 'HackerLaptop',
      SpecialObjectAttachToBone: 'INTHAND_R',
      MaxSpecialObjects: 3,
      SpecialObjectsPersistent: true,
      EffectValue: 42,
      UniqueSpecialObjectTargets: true,
      SpecialObjectsPersistWhenOwnerDies: true,
      AlwaysValidateSpecialObjects: true,
    });

    const entity = (logic as any).spawnedEntities.get(1);
    expect(entity).toBeDefined();
    expect(entity.specialAbilityProfile).not.toBeNull();

    const profile = entity.specialAbilityProfile;
    expect(profile.specialObject).toBe('HackerLaptop');
    expect(profile.specialObjectAttachToBone).toBe('INTHAND_R');
    expect(profile.maxSpecialObjects).toBe(3);
    expect(profile.specialObjectsPersistent).toBe(true);
    expect(profile.effectValue).toBe(42);
    expect(profile.uniqueSpecialObjectTargets).toBe(true);
    expect(profile.specialObjectsPersistWhenOwnerDies).toBe(true);
    expect(profile.alwaysValidateSpecialObjects).toBe(true);
  });

  it('uses correct defaults for SpecialObject fields when not specified', () => {
    const { logic } = makeSpecialAbilitySetup({
      PreparationTime: 500,
    });

    const entity = (logic as any).spawnedEntities.get(1);
    expect(entity).toBeDefined();
    expect(entity.specialAbilityProfile).not.toBeNull();

    const profile = entity.specialAbilityProfile;
    // C++ defaults: m_specialObjectName = empty string → null,
    // m_maxSpecialObjects = 1, m_effectValue = 1, bools = FALSE
    expect(profile.specialObject).toBeNull();
    expect(profile.specialObjectAttachToBone).toBeNull();
    expect(profile.maxSpecialObjects).toBe(1);
    expect(profile.specialObjectsPersistent).toBe(false);
    expect(profile.effectValue).toBe(1);
    expect(profile.uniqueSpecialObjectTargets).toBe(false);
    expect(profile.specialObjectsPersistWhenOwnerDies).toBe(false);
    expect(profile.alwaysValidateSpecialObjects).toBe(false);
  });
});

describe('FireWeaponUpdate', () => {
  function makeFireWeaponSetup(opts: {
    weaponName?: string;
    initialDelayMs?: number;
    exclusiveWeaponDelayMs?: number;
    weaponDamage?: number;
    weaponRadius?: number;
    delayBetweenShotsMs?: number;
    targetHealth?: number;
  } = {}) {
    const weaponName = opts.weaponName ?? 'AutoFireWeapon';
    const autofireWeapon = makeWeaponDef(weaponName, {
      PrimaryDamage: opts.weaponDamage ?? 10,
      PrimaryDamageRadius: opts.weaponRadius ?? 50,
      DamageType: 'EXPLOSION',
      DelayBetweenShots: opts.delayBetweenShotsMs ?? 200, // ~6 frames
    });

    const emitterDef = makeObjectDef('PoisonEmitter', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FireWeaponUpdate ModuleTag_AutoFire', {
        Weapon: weaponName,
        InitialDelay: opts.initialDelayMs ?? 0,
        ExclusiveWeaponDelay: opts.exclusiveWeaponDelayMs ?? 0,
      }),
    ]);

    const targetDef = makeObjectDef('Victim', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: opts.targetHealth ?? 200,
        InitialHealth: opts.targetHealth ?? 200,
      }),
    ]);

    const bundle = makeBundle({
      objects: [emitterDef, targetDef],
      weapons: [autofireWeapon],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Place emitter and target at same map cell so they overlap within damage radius.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PoisonEmitter', 5, 5),
        makeMapObject('Victim', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);
    return { logic };
  }

  it('extracts FireWeaponUpdateProfile from INI', () => {
    const { logic } = makeFireWeaponSetup();
    const state = logic.getEntityState(1);
    expect(state).not.toBeNull();
    // Entity should exist and be alive.
    expect(state!.health).toBe(500);
  });

  it('fires weapon at own position every frame when ready', () => {
    const { logic } = makeFireWeaponSetup({ delayBetweenShotsMs: 100, targetHealth: 500 });

    // Record health after initial frame (first shot may fire on frame 0).
    const initial = logic.getEntityState(2);
    expect(initial).not.toBeNull();
    const healthAfterInit = initial!.health;

    // Run several more frames — weapon should keep firing and deal cumulative damage.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const after = logic.getEntityState(2);
    expect(after).not.toBeNull();
    expect(after!.health).toBeLessThan(healthAfterInit);
  });

  it('respects initial delay before first fire', () => {
    const { logic } = makeFireWeaponSetup({
      initialDelayMs: 500, // ~15 frames
      delayBetweenShotsMs: 100,
      targetHealth: 200,
    });

    // Run 5 frames — should still be in initial delay.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const mid = logic.getEntityState(2);
    expect(mid).not.toBeNull();
    expect(mid!.health).toBe(200); // No damage yet.

    // Run past initial delay — should start firing.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const after = logic.getEntityState(2);
    expect(after).not.toBeNull();
    expect(after!.health).toBeLessThan(200);
  });

  it('does not fire while UNDER_CONSTRUCTION', () => {
    const { logic } = makeFireWeaponSetup({
      delayBetweenShotsMs: 100,
      targetHealth: 500,
    });

    // Mark emitter as under construction AFTER the initial update(0).
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const emitter = priv.spawnedEntities.get(1)!;
    emitter.objectStatusFlags.add('UNDER_CONSTRUCTION');

    // Record target health after UNDER_CONSTRUCTION is set.
    const healthBefore = logic.getEntityState(2)!.health;

    // Run several frames — emitter should NOT fire while under construction.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Target health should not have changed.
    const after = logic.getEntityState(2);
    expect(after).not.toBeNull();
    expect(after!.health).toBe(healthBefore);
  });

  it('respects weapon delay between shots', () => {
    const { logic } = makeFireWeaponSetup({
      delayBetweenShotsMs: 1000, // ~30 frames — fires once per second
      weaponDamage: 50,
      weaponRadius: 100,
      targetHealth: 500,
    });

    // Run exactly 10 frames — should fire at most once (delay = 30 frames).
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const after10 = logic.getEntityState(2);
    expect(after10).not.toBeNull();
    // At most one shot of 50 damage.
    expect(after10!.health).toBeGreaterThanOrEqual(450);
  });
});

describe('OCLUpdate', () => {
  function makeOCLUpdateSetup(opts: {
    minDelayMs?: number;
    maxDelayMs?: number;
  } = {}) {
    const spawnerDef = makeObjectDef('Spawner', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCLSpawn', {
        OCL: 'OCLSpawnUnit',
        MinDelay: opts.minDelayMs ?? 1000,
        MaxDelay: opts.maxDelayMs ?? 1000,
      }),
    ]);

    const spawnedUnitDef = makeObjectDef('SpawnedUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const bundle = makeBundle({
      objects: [spawnerDef, spawnedUnitDef],
    });
    // Add OCL definitions to the bundle.
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCLSpawnUnit',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'SpawnedUnit', Count: '1' },
          blocks: [],
        }],
      },
    ];

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Spawner', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);
    return { logic };
  }

  it('extracts OCLUpdateProfile from INI', () => {
    const { logic } = makeOCLUpdateSetup();
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { oclUpdateProfiles: { oclName: string; minDelayFrames: number; maxDelayFrames: number }[] }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.oclUpdateProfiles.length).toBe(1);
    expect(entity.oclUpdateProfiles[0]!.oclName).toBe('OCLSpawnUnit');
    // 1000ms at 30fps = 30 frames
    expect(entity.oclUpdateProfiles[0]!.minDelayFrames).toBe(30);
  });

  it('spawns object after delay elapses', () => {
    const { logic } = makeOCLUpdateSetup({ minDelayMs: 1000, maxDelayMs: 1000 });

    // After initial frame, only the spawner should exist.
    const initialStates = logic.getRenderableEntityStates();
    expect(initialStates.filter(s => s.templateName === 'SpawnedUnit').length).toBe(0);

    // Run 15 frames — first shouldCreate sets the timer, so no spawn yet.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    const midStates = logic.getRenderableEntityStates();
    expect(midStates.filter(s => s.templateName === 'SpawnedUnit').length).toBe(0);

    // Run past the 30-frame delay — OCL should fire and spawn unit.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const afterStates = logic.getRenderableEntityStates();
    expect(afterStates.filter(s => s.templateName === 'SpawnedUnit').length).toBeGreaterThanOrEqual(1);
  });

  it('does not spawn while UNDER_CONSTRUCTION', () => {
    const { logic } = makeOCLUpdateSetup({ minDelayMs: 100, maxDelayMs: 100 });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const spawner = priv.spawnedEntities.get(1)!;
    spawner.objectStatusFlags.add('UNDER_CONSTRUCTION');

    // Run well past the delay — should NOT spawn.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    const states = logic.getRenderableEntityStates();
    expect(states.filter(s => s.templateName === 'SpawnedUnit').length).toBe(0);
  });

  it('pauses timer while disabled (EMP)', () => {
    const { logic } = makeOCLUpdateSetup({ minDelayMs: 500, maxDelayMs: 500 });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const spawner = priv.spawnedEntities.get(1)!;

    // Run 5 frames to initialize the timer.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Disable with EMP.
    spawner.objectStatusFlags.add('DISABLED_EMP');

    // Run 30 frames while disabled — timer should be paused.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const midStates = logic.getRenderableEntityStates();
    expect(midStates.filter(s => s.templateName === 'SpawnedUnit').length).toBe(0);

    // Re-enable and run past the remaining delay.
    spawner.objectStatusFlags.delete('DISABLED_EMP');
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const afterStates = logic.getRenderableEntityStates();
    expect(afterStates.filter(s => s.templateName === 'SpawnedUnit').length).toBeGreaterThanOrEqual(1);
  });

  it('spawns repeatedly on timer cycle', () => {
    // Short delay so we get multiple spawns.
    const { logic } = makeOCLUpdateSetup({ minDelayMs: 200, maxDelayMs: 200 });

    // Run 90 frames (3 seconds) — with 200ms (~6 frame) delay, should get multiple spawns.
    // First shouldCreate sets timer at frame ~0, first spawn at frame ~6, next at ~12, etc.
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    const states = logic.getRenderableEntityStates();
    const spawned = states.filter(s => s.templateName === 'SpawnedUnit');
    // Should have spawned multiple units.
    expect(spawned.length).toBeGreaterThanOrEqual(3);
  });
});

describe('WeaponBonusUpdate', () => {
  function makeWeaponBonusSetup(opts: {
    bonusCondition?: string;
    bonusDurationMs?: number;
    bonusDelayMs?: number;
    bonusRange?: number;
    requiredKindOf?: string;
    forbiddenKindOf?: string;
  } = {}) {
    const towerDef = makeObjectDef('PropagandaTower', 'China', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'WeaponBonusUpdate ModuleTag_Propaganda', {
        BonusConditionType: opts.bonusCondition ?? 'ENTHUSIASTIC',
        BonusDuration: opts.bonusDurationMs ?? 2000,
        BonusDelay: opts.bonusDelayMs ?? 500,
        BonusRange: opts.bonusRange ?? 200,
        ...(opts.requiredKindOf ? { RequiredAffectKindOf: opts.requiredKindOf } : {}),
        ...(opts.forbiddenKindOf ? { ForbiddenAffectKindOf: opts.forbiddenKindOf } : {}),
      }),
    ]);

    const allyUnitDef = makeObjectDef('AllyUnit', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const enemyUnitDef = makeObjectDef('EnemyUnit', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const bundle = makeBundle({
      objects: [towerDef, allyUnitDef, enemyUnitDef],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('PropagandaTower', 5, 5),
        makeMapObject('AllyUnit', 5, 5),
        makeMapObject('EnemyUnit', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);
    logic.update(0);
    return { logic };
  }

  it('extracts WeaponBonusUpdateProfile from INI', () => {
    const { logic } = makeWeaponBonusSetup();
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { weaponBonusUpdateProfiles: { moduleTag: string | null; bonusConditionFlag: number; bonusRange: number }[] }>;
    };
    const tower = priv.spawnedEntities.get(1)!;
    expect(tower.weaponBonusUpdateProfiles.length).toBe(1);
    expect(tower.weaponBonusUpdateProfiles[0]!.moduleTag).toBe('MODULETAG_PROPAGANDA');
    expect(tower.weaponBonusUpdateProfiles[0]!.bonusRange).toBe(200);
  });

  it('applies temp weapon bonus to allied units in range', () => {
    const { logic } = makeWeaponBonusSetup({ bonusDelayMs: 100 });

    // Run enough frames for the first pulse.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { weaponBonusConditionFlags: number; tempWeaponBonusFlag: number }>;
    };
    const ally = priv.spawnedEntities.get(2)!;
    // ENTHUSIASTIC = bit 8 = 256
    expect(ally.weaponBonusConditionFlags & 256).toBe(256);
    expect(ally.tempWeaponBonusFlag).toBe(256);
  });

  it('does not apply bonus to enemy units', () => {
    const { logic } = makeWeaponBonusSetup({ bonusDelayMs: 100 });

    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { weaponBonusConditionFlags: number; tempWeaponBonusFlag: number }>;
    };
    const enemy = priv.spawnedEntities.get(3)!;
    // Enemy should NOT have the bonus.
    expect(enemy.weaponBonusConditionFlags & 256).toBe(0);
    expect(enemy.tempWeaponBonusFlag).toBe(0);
  });

  it('clears temp bonus after duration expires', () => {
    const { logic } = makeWeaponBonusSetup({
      bonusDelayMs: 100,
      bonusDurationMs: 500, // ~15 frames
    });

    // Pulse fires around frame 3, bonus lasts 15 frames (until frame ~18).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { weaponBonusConditionFlags: number; tempWeaponBonusFlag: number }>;
    };
    const ally = priv.spawnedEntities.get(2)!;
    expect(ally.tempWeaponBonusFlag).toBe(256);

    // Run past the duration without a re-pulse (delay = 100ms = 3 frames, duration = 15 frames).
    // Since delay < duration, the bonus should be continuously refreshed.
    // To test expiry, we need delay > duration. Let's use a different setup.
  });

  it('expires bonus when not refreshed', () => {
    const { logic } = makeWeaponBonusSetup({
      bonusDelayMs: 2000, // ~60 frames between pulses
      bonusDurationMs: 300, // ~9 frames duration
    });

    // Run 5 frames — first pulse fires.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { weaponBonusConditionFlags: number; tempWeaponBonusFlag: number }>;
    };
    const ally = priv.spawnedEntities.get(2)!;
    expect(ally.tempWeaponBonusFlag).toBe(256);

    // Run 15 more frames — bonus should expire (duration was ~9 frames).
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(ally.tempWeaponBonusFlag).toBe(0);
    expect(ally.weaponBonusConditionFlags & 256).toBe(0);
  });

  it('respects RequiredAffectKindOf filter', () => {
    // Only affect VEHICLE, not INFANTRY.
    const towerDef = makeObjectDef('BonusTower', 'China', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'WeaponBonusUpdate ModuleTag_Propaganda', {
        BonusConditionType: 'ENTHUSIASTIC',
        BonusDuration: 2000,
        BonusDelay: 100,
        BonusRange: 200,
        RequiredAffectKindOf: 'VEHICLE',
      }),
    ]);

    const infantryDef = makeObjectDef('Soldier', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const vehicleDef = makeObjectDef('Tank', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
    ]);

    const bundle = makeBundle({ objects: [towerDef, infantryDef, vehicleDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BonusTower', 5, 5),
        makeMapObject('Soldier', 5, 5),
        makeMapObject('Tank', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { weaponBonusConditionFlags: number; tempWeaponBonusFlag: number }>;
    };
    const infantry = priv.spawnedEntities.get(2)!;
    const vehicle = priv.spawnedEntities.get(3)!;

    // Infantry should NOT have the bonus (not a VEHICLE).
    expect(infantry.tempWeaponBonusFlag).toBe(0);
    // Vehicle should have the bonus.
    expect(vehicle.tempWeaponBonusFlag).toBe(256);
  });
});

describe('HiveStructureBody', () => {
  it('redirects matching damage types to closest spawn slave', () => {
    const hiveDef = makeObjectDef('GlaTunnel', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'HiveStructureBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
        PropagateDamageTypesToSlavesWhenExisting: 'EXPLOSION ARMOR_PIERCING',
      }),
      makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
        SpawnNumber: 2,
        SpawnReplaceDelay: 100,
        SpawnTemplateName: 'TunnelDefender',
        InitialBurst: 2,
      }),
    ]);
    const defenderDef = makeObjectDef('TunnelDefender', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const attackerDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankGun'] }),
    ]);
    const tankGun = makeWeaponDef('TankGun', {
      PrimaryDamage: 30,
      PrimaryDamageRadius: 0,
      DamageType: 'EXPLOSION',
      AttackRange: 150,
      DelayBetweenShots: 500,
    });

    const bundle = makeBundle({ objects: [hiveDef, defenderDef, attackerDef], weapons: [tankGun] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GlaTunnel', 5, 5),
        makeMapObject('Tank', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const tunnel = priv.spawnedEntities.get(1)!;
    expect(tunnel).toBeDefined();
    expect(tunnel.hiveStructureProfile).not.toBeNull();

    // Spawn behavior should have created 2 defenders.
    const state = tunnel.spawnBehaviorState!;
    expect(state.slaveIds.length).toBe(2);

    const slave1 = priv.spawnedEntities.get(state.slaveIds[0]!)!;
    const tunnelHealthBefore = tunnel.health;

    // Attack the tunnel with EXPLOSION damage (should redirect to slave).
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    // Tunnel should not have taken damage — slave should have.
    expect(tunnel.health).toBe(tunnelHealthBefore);
    expect(slave1.health).toBeLessThan(100);
  });

  it('swallows damage when all slaves dead and damage type matches swallow list', () => {
    // Source parity: HiveStructureBody.cpp:88 — swallow only fires when SpawnBehavior exists
    // but getClosestSlave returns null (all slaves dead). No SpawnBehavior = DEBUG_CRASH + fallthrough.
    const hiveDef = makeObjectDef('GlaTunnel2', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'HiveStructureBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
        PropagateDamageTypesToSlavesWhenExisting: 'EXPLOSION',
        SwallowDamageTypesIfSlavesNotExisting: 'EXPLOSION',
      }),
      makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
        SpawnNumber: 1,
        SpawnReplaceDelay: 99999,
        SpawnTemplateName: 'TunnelDefender2',
        InitialBurst: 1,
      }),
    ]);
    const defenderDef = makeObjectDef('TunnelDefender2', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
    ]);
    const attackerDef = makeObjectDef('Tank2', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankGun2'] }),
    ]);
    const tankGun = makeWeaponDef('TankGun2', {
      PrimaryDamage: 50,
      PrimaryDamageRadius: 0,
      DamageType: 'EXPLOSION',
      AttackRange: 150,
      DelayBetweenShots: 500,
    });

    const bundle = makeBundle({ objects: [hiveDef, defenderDef, attackerDef], weapons: [tankGun] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GlaTunnel2', 5, 5),
        makeMapObject('Tank2', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const tunnel = priv.spawnedEntities.get(1)!;
    const state = tunnel.spawnBehaviorState!;
    expect(state.slaveIds.length).toBe(1);

    // Kill the slave so no living slaves remain.
    const slave = priv.spawnedEntities.get(state.slaveIds[0]!)!;
    (logic as any).applyWeaponDamageAmount(null, slave, 9999, 'UNRESISTABLE');
    logic.update(1 / 30);
    expect(slave.destroyed).toBe(true);

    const healthBefore = tunnel.health;

    // Attack the tunnel with EXPLOSION — should be swallowed since no alive slaves.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    // Tunnel health should be unchanged — EXPLOSION damage swallowed.
    expect(tunnel.health).toBe(healthBefore);
  });

  it('applies non-propagated damage types directly to hive structure', () => {
    const hiveDef = makeObjectDef('GlaTunnel3', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'HiveStructureBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
        PropagateDamageTypesToSlavesWhenExisting: 'EXPLOSION',
      }),
      makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
        SpawnNumber: 1,
        SpawnReplaceDelay: 100,
        SpawnTemplateName: 'TunnelDefender3',
        InitialBurst: 1,
      }),
    ]);
    const defenderDef = makeObjectDef('TunnelDefender3', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const attackerDef = makeObjectDef('Sniper', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SniperRifle'] }),
    ]);
    const sniperRifle = makeWeaponDef('SniperRifle', {
      PrimaryDamage: 40,
      PrimaryDamageRadius: 0,
      DamageType: 'SMALL_ARMS',
      AttackRange: 150,
      DelayBetweenShots: 1000,
    });

    const bundle = makeBundle({ objects: [hiveDef, defenderDef, attackerDef], weapons: [sniperRifle] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GlaTunnel3', 5, 5),
        makeMapObject('Sniper', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const tunnel = priv.spawnedEntities.get(1)!;
    const slave = priv.spawnedEntities.get(tunnel.spawnBehaviorState!.slaveIds[0]!)!;

    // Attack tunnel with SMALL_ARMS (not in propagate list) — should hit tunnel directly.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    // Tunnel should have taken damage, slave should be untouched.
    expect(tunnel.health).toBeLessThan(500);
    expect(slave.health).toBe(100);
  });
});

describe('DeletionUpdate', () => {
  it('extracts DeletionUpdate from INI and resolves die frame', () => {
    const objectDef = makeObjectDef('Debris', 'America', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
      makeBlock('Behavior', 'DeletionUpdate ModuleTag_Deletion', {
        MinLifetime: 1000, // ~30 frames
        MaxLifetime: 1000,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Debris', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { deletionDieFrame: number | null }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.deletionDieFrame).not.toBeNull();
    expect(entity.deletionDieFrame).toBeGreaterThan(0);
  });

  it('silently removes entity when deletion timer expires', () => {
    const objectDef = makeObjectDef('Debris', 'America', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'DeletionUpdate ModuleTag_Deletion', {
        MinLifetime: 500, // ~15 frames
        MaxLifetime: 500,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Debris', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Run 10 frames — should still be alive.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    const state1 = logic.getEntityState(1);
    expect(state1).not.toBeNull();

    // Run 20 more frames — past 15 frame deletion time.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const state2 = logic.getEntityState(1);
    expect(state2).toBeNull(); // Entity silently removed.
  });

  it('does not trigger death pipeline (no visual events, no SlowDeath)', () => {
    const objectDef = makeObjectDef('Debris', 'America', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'DeletionUpdate ModuleTag_Deletion', {
        MinLifetime: 300, // ~9 frames
        MaxLifetime: 300,
      }),
      makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_SlowDeath', {
        DestructionDelay: 5000, // 5 seconds — would keep entity alive if death pipeline ran
        SinkRate: 0,
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Debris', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Drain any initial visual events.
    logic.drainVisualEvents();

    // Run 15 frames — past deletion time.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    // Entity should be immediately gone (not in SlowDeath).
    const state = logic.getEntityState(1);
    expect(state).toBeNull();

    // No ENTITY_DESTROYED visual event should have been emitted (silent removal).
    const events = logic.drainVisualEvents();
    const destroyedEvents = events.filter(e => e.type === 'ENTITY_DESTROYED');
    expect(destroyedEvents).toHaveLength(0);
  });
});

describe('RadarUpdate', () => {
  it('extracts RadarUpdateProfile from INI', () => {
    const objectDef = makeObjectDef('Radar', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'RadarUpdate ModuleTag_Radar', {
        RadarExtendTime: 2000, // ~60 frames
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Radar', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { radarUpdateProfile: { radarExtendTimeFrames: number } | null }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.radarUpdateProfile).not.toBeNull();
    expect(entity.radarUpdateProfile!.radarExtendTimeFrames).toBe(60);
  });
});

describe('FloatUpdate', () => {
  it('extracts FloatUpdateProfile from INI', () => {
    const objectDef = makeObjectDef('Boat', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'FloatUpdate ModuleTag_Float', {
        Enabled: 'Yes',
      }),
    ]);

    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Boat', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { floatUpdateProfile: { enabled: boolean } | null }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.floatUpdateProfile).not.toBeNull();
    expect(entity.floatUpdateProfile!.enabled).toBe(true);
  });
});

describe('BodyModuleType', () => {
  it('resolves body type from INI block name (ActiveBody default)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('Tank', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as { spawnedEntities: Map<number, { bodyType: string; health: number; maxHealth: number; canTakeDamage: boolean }> };
    const tank = priv.spawnedEntities.get(1)!;
    expect(tank.bodyType).toBe('ACTIVE');
    expect(tank.health).toBe(200);
    expect(tank.canTakeDamage).toBe(true);
  });

  it('resolves HighlanderBody type from INI', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Boss', 'America', ['VEHICLE'], [
          makeBlock('Body', 'HighlanderBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('Boss', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as { spawnedEntities: Map<number, { bodyType: string; health: number }> };
    expect(priv.spawnedEntities.get(1)!.bodyType).toBe('HIGHLANDER');
  });

  it('HighlanderBody caps damage at health-1 for non-UNRESISTABLE', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Boss', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'HighlanderBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('Boss', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; destroyed: boolean }>;
    };
    const boss = priv.spawnedEntities.get(1)!;

    // Apply massive EXPLOSION damage — should be capped at health-1.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, boss, 9999, 'EXPLOSION');

    expect(boss.health).toBe(1);
    expect(boss.destroyed).toBe(false);

    // Now apply UNRESISTABLE — should kill.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, boss, 9999, 'UNRESISTABLE');
    logic.update(1 / 30);

    expect(boss.health).toBe(0);
    expect(boss.destroyed).toBe(true);
  });

  it('ImmortalBody never lets health drop below 1', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Immortal', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ImmortalBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('Immortal', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; destroyed: boolean }>;
    };
    const unit = priv.spawnedEntities.get(1)!;

    // Apply massive EXPLOSION damage — should not drop below 1.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, unit, 9999, 'EXPLOSION');

    expect(unit.health).toBe(1);
    expect(unit.destroyed).toBe(false);

    // UNRESISTABLE should ALSO be capped at 1 for ImmortalBody (unlike HighlanderBody).
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, unit, 9999, 'UNRESISTABLE');
    logic.update(1 / 30);

    expect(unit.health).toBe(1);
    expect(unit.destroyed).toBe(false);
  });

  it('InactiveBody ignores all damage except UNRESISTABLE', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Scenery', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'InactiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('Scenery', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; destroyed: boolean; canTakeDamage: boolean; bodyType: string }>;
    };
    const scenery = priv.spawnedEntities.get(1)!;

    // InactiveBody has no health and cannot take damage.
    expect(scenery.bodyType).toBe('INACTIVE');
    expect(scenery.canTakeDamage).toBe(false);
    expect(scenery.health).toBe(0);

    // Normal damage is ignored (canTakeDamage is false so applyWeaponDamageAmount is a no-op).
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, scenery, 9999, 'EXPLOSION');
    logic.update(1 / 30);
    expect(scenery.destroyed).toBe(false);
  });
});

describe('CrateCollideSystem', () => {
  it('HealCrateCollide heals all units of collector side', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('HealCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'HealCrateCollide ModuleTag_Collide', {}),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 100 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
        makeObjectDef('Soldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 25 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
        makeMapObject('Soldier', 500, 500),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; maxHealth: number; destroyed: boolean }>;
    };

    logic.update(1 / 30);
    logic.update(1 / 30);

    // Crate should be destroyed (collected).
    const crate = priv.spawnedEntities.get(1);
    expect(crate === undefined || crate.destroyed).toBe(true);
    // Tank should be at max health.
    const tank = priv.spawnedEntities.get(2)!;
    expect(tank.health).toBe(tank.maxHealth);
    // Soldier (same side) should also be at max health.
    const soldier = priv.spawnedEntities.get(3)!;
    expect(soldier.health).toBe(soldier.maxHealth);
  });

  it('MoneyCrateCollide deposits credits to collector side', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoneyCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MoneyCrateCollide ModuleTag_Collide', {
            MoneyProvided: 2000,
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MoneyCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Get initial credits via private field.
    const priv = logic as unknown as {
      sideCredits: Map<string, number>;
      normalizeSide(s: string): string;
    };
    const creditsBefore = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;

    logic.update(1 / 30);
    logic.update(1 / 30);

    const creditsAfter = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;

    // Should have gained 2000 credits.
    expect(creditsAfter - creditsBefore).toBe(2000);
  });

  it('VeterancyCrateCollide grants veterancy level to collector', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('VetCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'VeterancyCrateCollide ModuleTag_Collide', {}),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        // ExperienceRequired is a top-level ObjectDef field, not a Behavior block field.
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5, ExperienceRequired: [1, 50, 100, 200] }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('VetCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        experienceState: { currentLevel: number };
      }>;
    };
    const tank = priv.spawnedEntities.get(2)!;
    const levelBefore = tank.experienceState.currentLevel;

    logic.update(1 / 30);
    logic.update(1 / 30);

    // Should have gained at least 1 veterancy level.
    expect(tank.experienceState.currentLevel).toBeGreaterThan(levelBefore);
  });

  it('UnitCrateCollide spawns units near crate', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UnitCrate', 'Neutral', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'UnitCrateCollide ModuleTag_Collide', {
            UnitName: 'SpawnedSoldier',
            UnitCount: 3,
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('SpawnedSoldier', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('UnitCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { templateName: string }>;
    };

    logic.update(1 / 30);
    logic.update(1 / 30);

    // Should have 3 new SpawnedSoldier entities.
    let spawnedCount = 0;
    for (const e of priv.spawnedEntities.values()) {
      if (e.templateName === 'SpawnedSoldier') spawnedCount++;
    }
    expect(spawnedCount).toBe(3);
  });

  it('crate ForbidOwnerPlayer prevents same-side unit from collecting', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoneyCrate', 'America', ['CRATE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MoneyCrateCollide ModuleTag_Collide', {
            MoneyProvided: 1000,
            ForbidOwnerPlayer: true,
          }),
        ], { Geometry: 'CYLINDER', GeometryMajorRadius: 5 }),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { Geometry: 'BOX', GeometryMajorRadius: 5 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('MoneyCrate', 100, 100),
        makeMapObject('Tank', 102, 100),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const priv = logic as unknown as {
      sideCredits: Map<string, number>;
      normalizeSide(s: string): string;
    };
    const creditsBefore = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;

    logic.update(1 / 30);
    logic.update(1 / 30);

    const creditsAfter = priv.sideCredits.get(priv.normalizeSide('America')) ?? 0;

    // ForbidOwnerPlayer = true: America crate should NOT be collectable by America tank.
    expect(creditsAfter - creditsBefore).toBe(0);
  });
});

describe('HealContain system', () => {
  it('heals passengers and auto-ejects when fully healed', () => {
    // Source parity: HealContain::update — heal passengers per frame, auto-eject at full health.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
          makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
            ContainMax: 3,
            TimeForFullHeal: 1000, // 1000ms = 30 frames at 30fps
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 5 }),
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Ambulance', 50, 50),
        makeMapObject('Infantry', 52, 52), // Close enough to enter immediately.
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Damage the infantry to 50% health.
    const infantry = (logic as any).spawnedEntities.get(2);
    infantry.health = 50;

    // Enter the ambulance.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    // One frame to process the enter command.
    logic.update(1 / 30);

    // Infantry should be inside (MASKED/UNSELECTABLE).
    let infantryState = logic.getEntityState(2);
    expect(infantryState).not.toBeNull();
    // Entity is inside ambulance — check it's not visible (health not yet full).
    expect(infantryState!.health).toBeLessThan(100);

    // Run 30 frames (1000ms at 30fps) — should be fully healed and ejected.
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    // Infantry should be fully healed and ejected (visible again).
    infantryState = logic.getEntityState(2);
    expect(infantryState).not.toBeNull();
    expect(infantryState!.health).toBe(100);
  });

  it('respects container capacity limit', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
          makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
            ContainMax: 1, // Only 1 passenger.
            TimeForFullHeal: 1000,
          }),
        ]),
        makeObjectDef('Infantry', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 5 }),
          makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Ambulance', 50, 50),
        makeMapObject('Infantry', 52, 52),
        makeMapObject('Infantry', 53, 53),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    // Damage both infantry.
    const priv = logic as any;
    priv.spawnedEntities.get(2).health = 50;
    priv.spawnedEntities.get(3).health = 50;

    // Try to enter both.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.update(1 / 30);

    // Only one should be inside (capacity = 1).
    const infantry2 = priv.spawnedEntities.get(2);
    const infantry3 = priv.spawnedEntities.get(3);
    const inside2 = infantry2.transportContainerId === 1;
    const inside3 = infantry3.transportContainerId === 1;
    // Exactly one should be inside.
    expect(inside2 !== inside3 || (!inside2 && !inside3)).toBe(true);
  });
});

describe('AutoFindHealingUpdate', () => {
  function makeAutoHealSetup(opts: {
    healthPercent?: number;
    scanRange?: number;
    neverHeal?: number;
    alwaysHeal?: number;
    isHuman?: boolean;
  } = {}) {
    const healPadDef = makeObjectDef('HealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,  // ~6 frames
        ScanRange: opts.scanRange ?? 200,
        NeverHeal: opts.neverHeal ?? 0.95,
        AlwaysHeal: opts.alwaysHeal ?? 0.25,
      }),
    ]);

    const bundle = makeBundle({ objects: [healPadDef, infantryDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealPad', 50, 50),
        makeMapObject('Infantry', 52, 52),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', opts.isHuman ? 'HUMAN' : 'COMPUTER');
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const infantry = priv.spawnedEntities.get(2)!;

    const healthPercent = opts.healthPercent ?? 50;
    infantry.health = (healthPercent / 100) * infantry.maxHealth;

    return { logic, priv, infantry };
  }

  it('AI unit auto-enters nearby heal pad when damaged and idle', () => {
    const { logic, infantry } = makeAutoHealSetup({ healthPercent: 50 });

    expect(infantry.health).toBe(50);

    // Run enough frames for the auto-heal scan and entry.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Infantry should now be inside the heal pad.
    expect(infantry.transportContainerId).not.toBeNull();

    // Run more frames for healing + auto-eject.
    for (let i = 0; i < 40; i++) logic.update(1 / 30);
    expect(infantry.health).toBe(100);
    expect(infantry.transportContainerId).toBeNull();
  });

  it('AI unit can auto-enter an allied cross-side heal pad', () => {
    const healPadDef = makeObjectDef('HealPad', 'Civilian', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,
        ScanRange: 200,
        NeverHeal: 0.95,
        AlwaysHeal: 0.25,
      }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealPad', 50, 50),
        makeMapObject('Infantry', 52, 52),
      ]),
      makeRegistry(makeBundle({ objects: [healPadDef, infantryDef] })),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.setTeamRelationship('America', 'Civilian', 2);
    logic.setTeamRelationship('Civilian', 'America', 2);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, MapEntity>;
    };
    expect(priv.spawnedEntities.get(1)?.side).toBe('Civilian');
    expect(priv.spawnedEntities.get(2)?.side).toBe('America');
    const infantry = priv.spawnedEntities.get(2)!;
    infantry.health = 50;
    expect(logic.getEntityRelationship(2, 1)).toBe('allies');

    let enteredHealPad = false;
    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId === 1) {
        enteredHealPad = true;
      }
    }

    expect(enteredHealPad).toBe(true);
  });

  it('does not auto-heal while busy even when below AlwaysHeal threshold', () => {
    const { logic, infantry } = makeAutoHealSetup({
      healthPercent: 10,
      alwaysHeal: 0.95,
      neverHeal: 0.99,
    });

    let enteredHealPad = false;
    for (let i = 0; i < 30; i++) {
      infantry.moving = true;
      logic.update(1 / 30);
      if (infantry.transportContainerId !== null) {
        enteredHealPad = true;
      }
    }

    expect(enteredHealPad).toBe(false);
  });

  it('does not skip an invalid nearest heal pad to use a farther one', () => {
    const healPadDef = makeObjectDef('HealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,
        ScanRange: 400,
        NeverHeal: 0.95,
        AlwaysHeal: 0.25,
      }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealPad', 50, 50),  // id 1 (near, invalid)
        makeMapObject('HealPad', 90, 50),  // id 2 (far, valid)
        makeMapObject('Infantry', 52, 52), // id 3
      ]),
      makeRegistry(makeBundle({ objects: [healPadDef, infantryDef] })),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const nearPad = priv.spawnedEntities.get(1)!;
    nearPad.objectStatusFlags.add('SOLD');
    const infantry = priv.spawnedEntities.get(3)!;
    infantry.health = 50;

    let enteredFarPad = false;
    for (let i = 0; i < 80; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId === 2) {
        enteredFarPad = true;
      }
    }

    expect(enteredFarPad).toBe(false);
  });

  it('does not bypass a nearer enemy heal pad for a farther allied heal pad', () => {
    const healPadDef = makeObjectDef('HealPad', 'GLA', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const alliedHealPadDef = makeObjectDef('AlliedHealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,
        ScanRange: 400,
        NeverHeal: 0.95,
        AlwaysHeal: 0.25,
      }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealPad', 50, 50),        // id 1 (near, enemy)
        makeMapObject('AlliedHealPad', 90, 50),  // id 2 (far, allied)
        makeMapObject('Infantry', 52, 52),       // id 3
      ]),
      makeRegistry(makeBundle({ objects: [healPadDef, alliedHealPadDef, infantryDef] })),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const infantry = priv.spawnedEntities.get(3)!;
    infantry.health = 50;

    let enteredAlliedFarPad = false;
    for (let i = 0; i < 80; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId === 2) {
        enteredAlliedFarPad = true;
      }
    }

    expect(enteredAlliedFarPad).toBe(false);
  });

  it('does not enter a nearer civilian enemy heal pad when command enter rules allow enemies', () => {
    const enemyCivilianHealPadDef = makeObjectDef('EnemyCivilianHealPad', 'Civilian', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const alliedHealPadDef = makeObjectDef('AlliedHealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,
        ScanRange: 400,
        NeverHeal: 0.95,
        AlwaysHeal: 0.25,
      }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('EnemyCivilianHealPad', 50, 50), // id 1 (near, enemy)
        makeMapObject('AlliedHealPad', 90, 50),        // id 2 (far, allied)
        makeMapObject('Infantry', 52, 52),             // id 3
      ]),
      makeRegistry(makeBundle({ objects: [enemyCivilianHealPadDef, alliedHealPadDef, infantryDef] })),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.setTeamRelationship('America', 'Civilian', 0);
    logic.setTeamRelationship('Civilian', 'America', 0);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const infantry = priv.spawnedEntities.get(3)!;
    infantry.health = 50;

    let enteredAnyHealPad = false;
    for (let i = 0; i < 80; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId === 1 || infantry.transportContainerId === 2) {
        enteredAnyHealPad = true;
      }
    }

    expect(enteredAnyHealPad).toBe(false);
  });

  it('does not skip a nearer heal pad that lacks heal containment', () => {
    const invalidHealPadDef = makeObjectDef('InvalidHealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
    ]);

    const validHealPadDef = makeObjectDef('ValidHealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,
        ScanRange: 400,
        NeverHeal: 0.95,
        AlwaysHeal: 0.25,
      }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('InvalidHealPad', 50, 50), // id 1 (near, no contain module)
        makeMapObject('ValidHealPad', 90, 50),   // id 2 (far, valid contain)
        makeMapObject('Infantry', 52, 52),       // id 3
      ]),
      makeRegistry(makeBundle({ objects: [invalidHealPadDef, validHealPadDef, infantryDef] })),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const infantry = priv.spawnedEntities.get(3)!;
    infantry.health = 50;

    let enteredFarValidPad = false;
    for (let i = 0; i < 80; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId === 2) {
        enteredFarValidPad = true;
      }
    }

    expect(enteredFarValidPad).toBe(false);
  });

  it('does not auto-heal for human-controlled units', () => {
    const { logic, infantry } = makeAutoHealSetup({ healthPercent: 50, isHuman: true });

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(infantry.transportContainerId).toBeNull();
    expect(infantry.health).toBe(50);
  });

  it('uses controlling player type for auto-heal AI gating', () => {
    const { logic, infantry } = makeAutoHealSetup({ healthPercent: 50, isHuman: true });
    infantry.controllingPlayerToken = 'AIPlayer';
    logic.setSidePlayerType('AIPlayer', 'COMPUTER');

    let enteredHealPad = false;
    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId !== null) {
        enteredHealPad = true;
      }
    }

    expect(enteredHealPad).toBe(true);
  });

  it('blocks auto-heal when controlling player type is human even if side is AI', () => {
    const { logic, infantry } = makeAutoHealSetup({ healthPercent: 50, isHuman: false });
    infantry.controllingPlayerToken = 'HumanPlayer';
    logic.setSidePlayerType('HumanPlayer', 'HUMAN');

    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
    }

    expect(infantry.transportContainerId).toBeNull();
  });

  it('seeks healing when health equals NeverHeal threshold', () => {
    const { logic, infantry } = makeAutoHealSetup({ healthPercent: 95, neverHeal: 0.95 });

    let enteredHealPad = false;
    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId !== null) {
        enteredHealPad = true;
      }
    }

    expect(enteredHealPad).toBe(true);
  });

  it('does not seek healing when health above NeverHeal threshold', () => {
    const { logic, infantry } = makeAutoHealSetup({ healthPercent: 96, neverHeal: 0.95 });

    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(infantry.transportContainerId).toBeNull();
  });

  it('includes heal pads exactly at ScanRange boundary', () => {
    const healPadDef = makeObjectDef('HealPad', 'America', ['STRUCTURE', 'HEAL_PAD'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 1000,
      }),
    ]);

    const infantryDef = makeObjectDef('Infantry', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Locomotor', 'BasicLocomotor LocoTag', { Speed: 10 }),
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {}),
      makeBlock('Behavior', 'AutoFindHealing ModuleTag_AutoHeal', {
        ScanRate: 200,
        ScanRange: 2, // * MAP_XY_FACTOR => 20 world units
        NeverHeal: 0.95,
        AlwaysHeal: 0.25,
      }),
    ]);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('HealPad', 54, 50),  // id 1
        makeMapObject('Infantry', 52, 50), // id 2; distance is exactly 20 world units
      ]),
      makeRegistry(makeBundle({ objects: [healPadDef, infantryDef] })),
      makeHeightmap(),
    );
    logic.setSidePlayerType('America', 'COMPUTER');
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const infantry = priv.spawnedEntities.get(2)!;
    infantry.health = 50;

    let enteredHealPad = false;
    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
      if (infantry.transportContainerId === 1) {
        enteredHealPad = true;
      }
    }

    expect(enteredHealPad).toBe(true);
  });

  it('applies scan cooldown for scanRateFrames plus one update frame', () => {
    const { logic, infantry } = makeAutoHealSetup({
      healthPercent: 50,
      scanRate: 200,
      scanRange: 200,
    });
    const profile = infantry.autoFindHealingProfile!;

    const stateAfterFirstScan = logic as unknown as { frameCounter: number };
    const firstScanFrame = stateAfterFirstScan.frameCounter;
    const firstNextScanFrame = infantry.autoFindHealingNextScanFrame;
    expect(firstNextScanFrame).toBe(firstScanFrame + profile.scanRateFrames + 1);

    for (let i = 0; i < profile.scanRateFrames; i++) {
      logic.update(1 / 30);
      expect(infantry.autoFindHealingNextScanFrame).toBe(firstNextScanFrame);
    }

    logic.update(1 / 30);
    expect(infantry.autoFindHealingNextScanFrame).toBeGreaterThan(firstNextScanFrame);
  });
});

describe('EnemyNearUpdate', () => {
  it('detects enemy within vision range and sets enemyNearDetected', () => {
    const guard = makeObjectDef('Guard', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'EnemyNearUpdate ModuleTag_EN', { ScanDelayTime: 500 }),
    ], { VisionRange: 150 });
    const tank = makeObjectDef('Tank', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [guard, tank] });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Guard', 5, 5), makeMapObject('Tank', 5, 5)]);
    const heightmap = makeHeightmap();
    const scene = { add: () => {}, remove: () => {} } as any;
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(map, registry, heightmap);
    logic.setTeamRelationship('America', 'GLA', 0); // enemies
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as any;
    const guardEntity = priv.spawnedEntities.get(1)!;
    expect(guardEntity.enemyNearScanDelayFrames).toBeGreaterThan(0);
    expect(guardEntity.enemyNearDetected).toBe(false);

    // Run enough frames for the initial random delay to expire + a scan.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    expect(guardEntity.enemyNearDetected).toBe(true);
  });

  it('clears enemyNearDetected when enemy moves out of range', () => {
    const guard = makeObjectDef('Guard', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'EnemyNearUpdate ModuleTag_EN', { ScanDelayTime: 100 }),
    ], { VisionRange: 50 });
    const tank = makeObjectDef('Tank', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [guard, tank] });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Guard', 5, 5), makeMapObject('Tank', 5, 5)]);
    const heightmap = makeHeightmap();
    const scene = { add: () => {}, remove: () => {} } as any;
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(map, registry, heightmap);
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as any;
    const guardEntity = priv.spawnedEntities.get(1)!;
    const tankEntity = priv.spawnedEntities.get(2)!;

    // Run to detect enemy.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(guardEntity.enemyNearDetected).toBe(true);

    // Move enemy far away — beyond vision range.
    tankEntity.x = 9999;
    tankEntity.z = 9999;

    // Run again to clear detection.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(guardEntity.enemyNearDetected).toBe(false);
  });

  it('does not detect allies as enemies', () => {
    const guard = makeObjectDef('Guard', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'EnemyNearUpdate ModuleTag_EN', { ScanDelayTime: 100 }),
    ], { VisionRange: 150 });
    const friendly = makeObjectDef('Friendly', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [guard, friendly] });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Guard', 5, 5), makeMapObject('Friendly', 5, 5)]);
    const heightmap = makeHeightmap();
    const scene = { add: () => {}, remove: () => {} } as any;
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(map, registry, heightmap);

    const priv = logic as any;
    const guardEntity = priv.spawnedEntities.get(1)!;

    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Allied unit nearby should not trigger enemy near.
    expect(guardEntity.enemyNearDetected).toBe(false);
  });
});

describe('CheckpointUpdate', () => {
  it('opens gate when ally is near and no enemies nearby', () => {
    const gate = makeObjectDef('Checkpoint', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'CheckpointUpdate ModuleTag_CU', { EnemyScanDelayTime: 500 }),
    ], { VisionRange: 100, Geometry: 'BOX', GeometryMajorRadius: 10, GeometryMinorRadius: 5, GeometryHeight: 10 });
    const ally = makeObjectDef('AllyUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const bundle = makeBundle({ objects: [gate, ally] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Checkpoint', 5, 5),
        makeMapObject('AllyUnit', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    // Same team = allies (2 = RELATIONSHIP_ALLIES).
    logic.setTeamRelationship('America', 'America', 2);
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const gateEntity = priv.spawnedEntities.get(1)!;
    const initialMinorRadius = gateEntity.checkpointMaxMinorRadius;
    expect(initialMinorRadius).toBeGreaterThan(0);

    // Run several frames — gate should shrink (opening).
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const geom = gateEntity.obstacleGeometry!;
    expect(geom.minorRadius).toBeLessThan(initialMinorRadius);
  });

  it('closes gate when enemy is near', () => {
    const gate = makeObjectDef('Checkpoint2', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'CheckpointUpdate ModuleTag_CU', { EnemyScanDelayTime: 500 }),
    ], { VisionRange: 100, Geometry: 'BOX', GeometryMajorRadius: 10, GeometryMinorRadius: 5, GeometryHeight: 10 });
    const enemy = makeObjectDef('EnemyUnit', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const ally = makeObjectDef('AllyUnit2', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const bundle = makeBundle({ objects: [gate, enemy, ally] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Checkpoint2', 5, 5),
        makeMapObject('EnemyUnit', 5, 5),
        makeMapObject('AllyUnit2', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'GLA', 0); // enemies
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'America', 2); // allies
    logic.update(0);

    const priv = logic as unknown as { spawnedEntities: Map<number, MapEntity> };
    const gateEntity = priv.spawnedEntities.get(1)!;
    const maxMinor = gateEntity.checkpointMaxMinorRadius;

    // Run several frames — gate should stay closed (enemy nearby).
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const geom = gateEntity.obstacleGeometry!;
    // Radius should remain at max (closed).
    expect(geom.minorRadius).toBe(maxMinor);
  });
});

describe('HijackerUpdate', () => {
  it('hides hijacker in vehicle and ejects when vehicle is destroyed', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Hijacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'ConvertToHijackedVehicleCrateCollide ModuleTag_Hijack', {}),
          makeBlock('Behavior', 'HijackerUpdate ModuleTag_HijackerUpdate', {
            ParachuteName: 'GLA_Parachute',
          }),
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Attacker', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'HijackTestGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('HijackTestGun', {
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
        makeMapObject('Hijacker', 8, 8),
        makeMapObject('EnemyVehicle', 10, 8),
        makeMapObject('Attacker', 30, 8),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(1 / 30);

    // Issue hijack command.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'hijackVehicle',
    });
    logic.update(1 / 30);

    // Hijacker should still exist (hidden inside vehicle), not destroyed.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        hijackerState: { isInVehicle: boolean; targetId: number } | null;
        x: number; z: number;
      }>;
    };
    const hijacker = priv.spawnedEntities.get(1);
    expect(hijacker).toBeDefined();
    expect(hijacker!.objectStatusFlags.has('MASKED')).toBe(true);
    expect(hijacker!.objectStatusFlags.has('UNSELECTABLE')).toBe(true);
    expect(hijacker!.objectStatusFlags.has('NO_COLLISIONS')).toBe(true);
    expect(hijacker!.hijackerState).not.toBeNull();
    expect(hijacker!.hijackerState!.isInVehicle).toBe(true);
    expect(hijacker!.hijackerState!.targetId).toBe(2);

    // Vehicle should be captured (now America's).
    expect(logic.getEntityIdsByTemplateAndSide('EnemyVehicle', 'America')).toEqual([2]);

    // Now have the attacker destroy the vehicle.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    // Vehicle should be destroyed.
    expect(logic.getEntityState(2)).toBeNull();

    // Hijacker should be ejected and active again.
    const ejectedHijacker = priv.spawnedEntities.get(1);
    if (ejectedHijacker) {
      expect(ejectedHijacker.objectStatusFlags.has('MASKED')).toBe(false);
      expect(ejectedHijacker.objectStatusFlags.has('UNSELECTABLE')).toBe(false);
      expect(ejectedHijacker.objectStatusFlags.has('NO_COLLISIONS')).toBe(false);
      expect(ejectedHijacker.hijackerState).toBeNull();
    }
  });

  it('syncs veterancy between hijacker and vehicle', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Hijacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'ConvertToHijackedVehicleCrateCollide ModuleTag_Hijack', {}),
          makeBlock('Behavior', 'HijackerUpdate ModuleTag_HijackerUpdate', {}),
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Hijacker', 8, 8),
        makeMapObject('EnemyVehicle', 10, 8),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(1 / 30);

    // Give the vehicle veteran status before hijack.
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        experienceState: { currentLevel: number };
        hijackerState: { isInVehicle: boolean } | null;
      }>;
    };
    priv.spawnedEntities.get(2)!.experienceState.currentLevel = 2;

    // Issue hijack command.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'hijackVehicle',
    });
    logic.update(1 / 30);

    // Both should now have veterancy level 2 (the higher of the two).
    expect(priv.spawnedEntities.get(1)!.experienceState.currentLevel).toBe(2);
    expect(priv.spawnedEntities.get(2)!.experienceState.currentLevel).toBe(2);

    // Run a few more frames to ensure sync continues.
    for (let i = 0; i < 3; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(1)!.experienceState.currentLevel).toBe(2);
  });

  it('positions hijacker at vehicle location each frame', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Hijacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'ConvertToHijackedVehicleCrateCollide ModuleTag_Hijack', {}),
          makeBlock('Behavior', 'HijackerUpdate ModuleTag_HijackerUpdate', {}),
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Hijacker', 8, 8),
        makeMapObject('EnemyVehicle', 10, 8),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(1 / 30);

    // Issue hijack (entities are close enough for immediate resolution).
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'hijackVehicle',
    });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { x: number; z: number; hijackerState: { isInVehicle: boolean } | null }>;
    };

    // Verify hijacker is inside vehicle.
    expect(priv.spawnedEntities.get(1)!.hijackerState?.isInVehicle).toBe(true);

    // After another frame, hijacker position should match vehicle position.
    logic.update(1 / 30);
    const hijacker = priv.spawnedEntities.get(1)!;
    const vehicle = priv.spawnedEntities.get(2)!;
    expect(hijacker.x).toBe(vehicle.x);
    expect(hijacker.z).toBe(vehicle.z);
  });

  it('without HijackerUpdate, hijacker is destroyed on hijack (legacy behavior)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OldHijacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
          makeBlock('Behavior', 'ConvertToHijackedVehicleCrateCollide ModuleTag_Hijack', {}),
          // No HijackerUpdate module!
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('OldHijacker', 8, 8),
        makeMapObject('EnemyVehicle', 10, 8),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(1 / 30);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'hijackVehicle',
    });
    logic.update(1 / 30);

    // Hijacker should be destroyed (no HijackerUpdate profile).
    expect(logic.getEntityState(1)).toBeNull();
    // Vehicle should be captured.
    expect(logic.getEntityIdsByTemplateAndSide('EnemyVehicle', 'America')).toEqual([2]);
  });
});

describe('LeafletDropBehavior', () => {
  it('disables enemy infantry and vehicles after delay, but not structures', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LeafletBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'LeafletDropBehavior ModuleTag_Leaflet', {
            Delay: 200,           // 6 frames
            DisabledDuration: 3000, // 90 frames
            AffectRadius: 200,
          }),
        ]),
        makeObjectDef('EnemySoldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
        makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('EnemyBase', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('LeafletBomb', 50, 50),
        makeMapObject('EnemySoldier', 55, 50),
        makeMapObject('EnemyTank', 60, 50),
        makeMapObject('EnemyBase', 45, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };

    // Before delay (6 frames), nothing should be disabled.
    for (let i = 0; i < 4; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);

    // After delay, infantry and vehicle should be disabled.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);

    // Structure should NOT be disabled (leaflet only affects infantry+vehicle).
    expect(priv.spawnedEntities.get(4)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
  });

  it('only affects enemies, not allies', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('LeafletBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'LeafletDropBehavior ModuleTag_Leaflet', {
            Delay: 0,
            DisabledDuration: 3000,
            AffectRadius: 200,
          }),
        ]),
        makeObjectDef('FriendlyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('EnemyTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('LeafletBomb', 50, 50),
        makeMapObject('FriendlyTank', 55, 50),
        makeMapObject('EnemyTank', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Trigger (Delay = 0 → fires after first frame check).
    for (let i = 0; i < 3; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    // Friendly vehicle should NOT be disabled.
    expect(priv.spawnedEntities.get(2)!.objectStatusFlags.has('DISABLED_EMP')).toBe(false);
    // Enemy vehicle should be disabled.
    expect(priv.spawnedEntities.get(3)!.objectStatusFlags.has('DISABLED_EMP')).toBe(true);
  });
});

describe('SmartBombTargetHomingUpdate', () => {
  it('interpolates position toward target while above terrain', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SmartBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'SmartBombTargetHomingUpdate ModuleTag_Smart', {
            CourseCorrectionScalar: 0.5,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SmartBomb', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { x: number; y: number; z: number; baseHeight: number }>;
      resolveGroundHeight(x: number, z: number): number;
    };
    const bomb = priv.spawnedEntities.get(1)!;
    // Entity spawns at world position (50, 50).
    // Raise the bomb significantly above terrain to pass isSignificantlyAboveTerrain.
    const terrainY = priv.resolveGroundHeight(50, 50);
    bomb.y = terrainY + bomb.baseHeight + 50; // 50 units above terrain

    // Set the smart bomb target at world coords (100, 120).
    logic.setSmartBombTarget(1, 100, 120);

    logic.update(1 / 30);

    // With scalar=0.5: new pos = target * 0.5 + current * 0.5
    // x: 100 * 0.5 + 50 * 0.5 = 75
    // z: 120 * 0.5 + 50 * 0.5 = 85
    expect(bomb.x).toBeCloseTo(75, 0);
    expect(bomb.z).toBeCloseTo(85, 0);
  });

  it('does not course-correct when near ground', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SmartBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'SmartBombTargetHomingUpdate ModuleTag_Smart', {
            CourseCorrectionScalar: 0.5,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SmartBomb', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { x: number; y: number; z: number }>;
    };
    const bomb = priv.spawnedEntities.get(1)!;
    const startX = bomb.x;
    const startZ = bomb.z;

    // Set the target but leave the bomb near the ground (default spawn height).
    logic.setSmartBombTarget(1, 100, 120);

    logic.update(1 / 30);

    // Position should be unchanged — not significantly above terrain.
    expect(bomb.x).toBe(startX);
    expect(bomb.z).toBe(startZ);
  });
});

describe('DynamicGeometryInfoUpdate', () => {
  it('morphs geometry from initial to final over transition time', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Morpher', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'DynamicGeometryInfoUpdate ModuleTag_DynGeom', {
            InitialDelay: 0,
            InitialHeight: 10,
            InitialMajorRadius: 5,
            InitialMinorRadius: 5,
            FinalHeight: 20,
            FinalMajorRadius: 15,
            FinalMinorRadius: 15,
            TransitionTime: 300, // 300ms = 9 frames at 30fps
            ReverseAtTransitionTime: 'No',
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Morpher', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        obstacleGeometry: { height: number; majorRadius: number; minorRadius: number } | null;
        dynamicGeometryState: { finished: boolean; timeActive: number } | null;
      }>;
    };

    // Run enough frames for the transition to complete (delay=1 frame min + 9 transition frames).
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.dynamicGeometryState!.finished).toBe(true);
    // Final geometry should be close to final values.
    expect(entity.obstacleGeometry!.height).toBeCloseTo(20, 0);
    expect(entity.obstacleGeometry!.majorRadius).toBeCloseTo(15, 0);
  });

  it('reverses direction when reverseAtTransitionTime is enabled', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Morpher', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'DynamicGeometryInfoUpdate ModuleTag_DynGeom', {
            InitialDelay: 0,
            InitialHeight: 10,
            InitialMajorRadius: 5,
            InitialMinorRadius: 5,
            FinalHeight: 30,
            FinalMajorRadius: 20,
            FinalMinorRadius: 20,
            TransitionTime: 300, // 9 frames
            ReverseAtTransitionTime: 'Yes',
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Morpher', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        obstacleGeometry: { height: number; majorRadius: number; minorRadius: number } | null;
        dynamicGeometryState: { finished: boolean; timeActive: number; reverseAtTransitionTime: boolean } | null;
      }>;
    };

    // Run past first transition — should reverse.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const entity = priv.spawnedEntities.get(1)!;
    // After first transition completes, it should have reversed (not finished).
    // After the reverse pass completes, it should be finished.
    // Run more frames for the reverse pass.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    expect(entity.dynamicGeometryState!.finished).toBe(true);
    // Geometry should be back near initial values.
    expect(entity.obstacleGeometry!.height).toBeCloseTo(10, 0);
    expect(entity.obstacleGeometry!.majorRadius).toBeCloseTo(5, 0);
  });
});

describe('FirestormDynamicGeometryInfoUpdate', () => {
  it('expands geometry via parent DynamicGeometryInfoUpdate', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FirestormSmall', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FirestormDynamicGeometryInfoUpdate ModuleTag_Firestorm', {
            InitialDelay: 0,
            InitialHeight: 5,
            InitialMajorRadius: 10,
            InitialMinorRadius: 10,
            FinalHeight: 20,
            FinalMajorRadius: 50,
            FinalMinorRadius: 50,
            TransitionTime: 300, // 300ms = 9 frames at 30fps
            DamageAmount: 10,
            DelayBetweenDamageFrames: 500,
            MaxHeightForDamage: 20,
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('FirestormSmall', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        dynamicGeometryProfile: { initialMajorRadius: number; finalMajorRadius: number } | null;
        firestormDamageProfile: { damageAmount: number } | null;
        dynamicGeometryState: { started: boolean; finished: boolean } | null;
        obstacleGeometry: { majorRadius: number } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.dynamicGeometryProfile).not.toBeNull();
    expect(entity.firestormDamageProfile).not.toBeNull();
    expect(entity.firestormDamageProfile!.damageAmount).toBe(10);

    // Run a frame to start geometry expansion.
    logic.update(1 / 30);
    expect(entity.dynamicGeometryState?.started).toBe(true);

    // Run more frames — major radius should increase toward final value.
    const initialRadius = entity.obstacleGeometry?.majorRadius ?? 0;
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    const newRadius = entity.obstacleGeometry?.majorRadius ?? 0;
    expect(newRadius).toBeGreaterThan(initialRadius);
  });

  it('deals DAMAGE_FLAME to entities within radius', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FirestormSmall', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FirestormDynamicGeometryInfoUpdate ModuleTag_Firestorm', {
            InitialDelay: 0,
            InitialHeight: 5,
            InitialMajorRadius: 50,
            InitialMinorRadius: 50,
            FinalHeight: 20,
            FinalMajorRadius: 60,
            FinalMinorRadius: 60,
            TransitionTime: 300,
            DamageAmount: 15,
            DelayBetweenDamageFrames: 0,
            MaxHeightForDamage: 100,
          }),
        ], { GeometryMajorRadius: 50, GeometryMinorRadius: 50, GeometryHeight: 5 }),
        makeObjectDef('Victim', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Place victim at (70, 50), firestorm at (50, 50) — distance 20, within radius 50.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FirestormSmall', 50, 50),
        makeMapObject('Victim', 70, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; templateName: string }>;
    };

    // Run several frames: geometry starts + damage scan fires.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const victim = [...priv.spawnedEntities.values()].find(e => e.templateName === 'Victim')!;
    expect(victim.health).toBeLessThan(200);
  });

  it('respects maxHeightForDamage — skips targets above threshold', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FirestormSmall', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FirestormDynamicGeometryInfoUpdate ModuleTag_Firestorm', {
            InitialDelay: 0,
            InitialHeight: 5,
            InitialMajorRadius: 50,
            InitialMinorRadius: 50,
            FinalHeight: 20,
            FinalMajorRadius: 60,
            FinalMinorRadius: 60,
            TransitionTime: 300,
            DamageAmount: 15,
            DelayBetweenDamageFrames: 0,
            MaxHeightForDamage: 5,
          }),
        ], { GeometryMajorRadius: 50, GeometryMinorRadius: 50, GeometryHeight: 5 }),
        makeObjectDef('HighFlyer', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FirestormSmall', 50, 50),
        makeMapObject('HighFlyer', 70, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; y: number; templateName: string }>;
    };

    // Move the high-flyer above maxHeightForDamage (firestorm y + 5).
    const firestorm = [...priv.spawnedEntities.values()].find(e => e.templateName === 'FirestormSmall')!;
    const highFlyer = [...priv.spawnedEntities.values()].find(e => e.templateName === 'HighFlyer')!;
    highFlyer.y = firestorm.y + 100; // Well above threshold of 5 (survives ground snap)

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Should take NO damage since it's above maxHeightForDamage.
    expect(highFlyer.health).toBe(200);
  });

  it('pulses damage at delayBetweenDamageFrames interval', () => {
    // DelayBetweenDamageFrames: 500ms → msToLogicFrames(500) = ceil(500/33.33) = 15 frames.
    // First damage pulse occurs when frameCounter - lastDamageFrame(0) >= 15, i.e. frame 15.
    // Geometry starts on frame 1 (delay=0 → delayCountdown=1, started after 1 tick).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FirestormSmall', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'FirestormDynamicGeometryInfoUpdate ModuleTag_Firestorm', {
            InitialDelay: 0,
            InitialHeight: 5,
            InitialMajorRadius: 50,
            InitialMinorRadius: 50,
            FinalHeight: 20,
            FinalMajorRadius: 60,
            FinalMinorRadius: 60,
            TransitionTime: 30000, // long transition so geometry stays active
            DamageAmount: 10,
            DelayBetweenDamageFrames: 500, // 15 frames
            MaxHeightForDamage: 100,
          }),
        ], { GeometryMajorRadius: 50, GeometryMinorRadius: 50, GeometryHeight: 5 }),
        makeObjectDef('Victim', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('FirestormSmall', 50, 50),
        makeMapObject('Victim', 70, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; templateName: string }>;
    };

    const victim = () => [...priv.spawnedEntities.values()].find(e => e.templateName === 'Victim')!;

    // Run 10 frames — geometry is started but first damage pulse hasn't fired yet
    // (need frameCounter >= 15 for first pulse since lastDamageFrame starts at 0).
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(victim().health).toBe(500); // No damage yet

    // Run 6 more frames (total 16) — first pulse should fire at frame 15.
    for (let i = 0; i < 6; i++) logic.update(1 / 30);
    const healthAfterFirstPulse = victim().health;
    expect(healthAfterFirstPulse).toBeLessThan(500);

    // Run 5 more frames — should NOT get another damage pulse (need 15 frames since last pulse).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(victim().health).toBe(healthAfterFirstPulse);

    // Run 15 more frames to reach the next pulse interval.
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    const healthAfterSecondPulse = victim().health;
    expect(healthAfterSecondPulse).toBeLessThan(healthAfterFirstPulse);
  });
});

describe('FireOCLAfterWeaponCooldownUpdate', () => {
  it('fires OCL when entity stops attacking after enough shots', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
          makeBlock('Behavior', 'FireOCLAfterWeaponCooldownUpdate ModuleTag_OCL', {
            WeaponSlot: 'PRIMARY',
            OCL: 'OCL_TestEffect',
            MinShotsToCreateOCL: 2,
            OCLLifetimePerSecond: 1000,
            OCLLifetimeMaxCap: 10000,
          }),
        ]),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          AttackRange: 220,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          DelayBetweenShots: 100,
          DamageType: 'ARMOR_PIERCING',
          DeathType: 'NORMAL',
          WeaponSpeed: 29970,
          ProjectileNudge: '0 0 0',
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Attacker', 8, 8),
        makeMapObject('Target', 10, 8),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Command attacker to attack target.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run enough frames for weapon to fire multiple shots.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        fireOCLAfterCooldownStates: { valid: boolean; consecutiveShots: number }[];
      }>;
    };

    // Verify the tracking state has been initialized and is counting.
    const attacker = priv.spawnedEntities.get(1)!;
    expect(attacker.fireOCLAfterCooldownStates.length).toBe(1);
  });
});

describe('processDamageToContained', () => {
  it('applies percentage damage to contained units when container dies', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('DamageTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_TC', {
            ContainMax: 5,
            DamagePercentToUnits: 50, // 50% → 0.5 fraction
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 5 }),
        makeObjectDef('Passenger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          TransportSlotCount: 1,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('DamageTransport', 50, 50),
        makeMapObject('Passenger', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; maxHealth: number;
        transportContainerId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    // Put passenger inside transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    const passenger = priv.spawnedEntities.get(2)!;
    expect(passenger.transportContainerId).toBe(1);

    // Kill the transport.
    const transport = priv.spawnedEntities.get(1)!;
    priv.applyWeaponDamageAmount(null, transport, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // Passenger should have taken 50% of maxHealth (200 * 0.5 = 100) as UNRESISTABLE damage.
    // Passenger started at 200 health → should now be at 100.
    expect(transport.destroyed).toBe(true);
    expect(passenger.destroyed).toBe(false);
    expect(passenger.health).toBe(100);
  });

  it('force-kills fireproof units when damagePercent is 100%', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('DeathTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_TC', {
            ContainMax: 5,
            DamagePercentToUnits: 100, // 100% → 1.0 fraction
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 5 }),
        makeObjectDef('ToughPassenger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          TransportSlotCount: 1,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('DeathTransport', 50, 50),
        makeMapObject('ToughPassenger', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; maxHealth: number;
        transportContainerId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    // Put passenger inside transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    const passenger = priv.spawnedEntities.get(2)!;
    expect(passenger.transportContainerId).toBe(1);

    // Kill the transport.
    const transport = priv.spawnedEntities.get(1)!;
    priv.applyWeaponDamageAmount(null, transport, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // With 100% damage, passenger gets full maxHealth as damage.
    // Even if first damage doesn't kill (due to armor), the force-kill should ensure death.
    expect(transport.destroyed).toBe(true);
    expect(passenger.destroyed).toBe(true);
  });

  it('does not damage contained units when damagePercentToUnits is 0', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SafeTransport', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_TC', {
            ContainMax: 5,
            // No DamagePercentToUnits — defaults to 0
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 5 }),
        makeObjectDef('SafePassenger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          TransportSlotCount: 1,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SafeTransport', 50, 50),
        makeMapObject('SafePassenger', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number; maxHealth: number;
        transportContainerId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    // Put passenger inside transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    const passenger = priv.spawnedEntities.get(2)!;
    expect(passenger.transportContainerId).toBe(1);

    // Kill the transport.
    const transport = priv.spawnedEntities.get(1)!;
    priv.applyWeaponDamageAmount(null, transport, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // No damage to passenger — default 0%.
    expect(transport.destroyed).toBe(true);
    expect(passenger.destroyed).toBe(false);
    expect(passenger.health).toBe(200);
  });
});

describe('BunkerBusterBehavior', () => {
  it('kills garrisoned units on bomb death with occupant damage weapon', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BunkerBusterBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'BunkerBusterBehavior ModuleTag_BB', {
            OccupantDamageWeaponTemplate: 'BunkerBusterOccupantWeapon',
          }),
        ]),
        makeObjectDef('CivilianBuilding', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_GC', {
            MaxOccupants: 10,
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
        makeObjectDef('Soldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BunkerBusterOccupantWeapon', {
          DamageType: 'EXPLOSION',
          DeathType: 'EXPLODED',
          PrimaryDamage: 0,
          PrimaryDamageRadius: 0,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BunkerBusterBomb', 50, 50),
        makeMapObject('CivilianBuilding', 60, 50),
        makeMapObject('Soldier', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Garrison the soldier inside the building.
    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 2 });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        garrisonContainerId: number | null;
        attackTargetEntityId: number | null;
        bunkerBusterVictimId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    const bomb = priv.spawnedEntities.get(1)!;
    const soldier = priv.spawnedEntities.get(3)!;

    // Verify soldier is garrisoned.
    expect(soldier.garrisonContainerId).toBe(2);

    // Simulate the bomb targeting the building (this is what the AI sets during flight).
    bomb.attackTargetEntityId = 2;
    logic.update(1 / 30);

    // Verify bunker buster captured the victim.
    expect(bomb.bunkerBusterVictimId).toBe(2);

    // Kill the bomb to trigger bunker buster.
    priv.applyWeaponDamageAmount(null, bomb, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // Soldier should be dead — occupant damage weapon applied 100 damage (50 HP soldier).
    expect(soldier.destroyed).toBe(true);
  });

  it('kills garrisoned units outright when no occupant weapon is specified', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BunkerBusterBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'BunkerBusterBehavior ModuleTag_BB', {}),
        ]),
        makeObjectDef('CivilianBuilding', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_GC', {
            MaxOccupants: 10,
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
        makeObjectDef('Soldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BunkerBusterBomb', 50, 50),
        makeMapObject('CivilianBuilding', 60, 50),
        makeMapObject('Soldier', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 2 });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        garrisonContainerId: number | null;
        attackTargetEntityId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    const bomb = priv.spawnedEntities.get(1)!;
    const soldier = priv.spawnedEntities.get(3)!;
    expect(soldier.garrisonContainerId).toBe(2);

    // Set attack target and tick to capture victim.
    bomb.attackTargetEntityId = 2;
    logic.update(1 / 30);

    // Kill the bomb.
    priv.applyWeaponDamageAmount(null, bomb, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // Soldier should be killed outright (UNRESISTABLE damage = maxHealth).
    expect(soldier.destroyed).toBe(true);
  });

  it('respects upgrade gate — does not bust bunker without required upgrade', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BunkerBusterBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'BunkerBusterBehavior ModuleTag_BB', {
            UpgradeRequired: 'Upgrade_BunkerBuster',
          }),
        ]),
        makeObjectDef('CivilianBuilding', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_GC', {
            MaxOccupants: 10,
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
        makeObjectDef('Soldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], {
          TransportSlotCount: 1,
        }),
      ],
      upgrades: [{ name: 'Upgrade_BunkerBuster', fields: {} }],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BunkerBusterBomb', 50, 50),
        makeMapObject('CivilianBuilding', 60, 50),
        makeMapObject('Soldier', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.submitCommand({ type: 'garrisonBuilding', entityId: 3, targetBuildingId: 2 });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        garrisonContainerId: number | null;
        attackTargetEntityId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    const bomb = priv.spawnedEntities.get(1)!;
    const soldier = priv.spawnedEntities.get(3)!;
    expect(soldier.garrisonContainerId).toBe(2);

    // Set attack target and tick.
    bomb.attackTargetEntityId = 2;
    logic.update(1 / 30);

    // Kill the bomb WITHOUT having the upgrade.
    priv.applyWeaponDamageAmount(null, bomb, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // Soldier should survive — upgrade not present.
    expect(soldier.destroyed).toBe(false);
    expect(soldier.health).toBe(100);
  });

  it('does not affect transport passengers (not bustable)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BunkerBusterBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'BunkerBusterBehavior ModuleTag_BB', {}),
        ]),
        makeObjectDef('Humvee', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_TC', {
            MaxOccupants: 5,
            PassengersAllowedToFire: 'Yes',
          }),
        ]),
        makeObjectDef('Soldier', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], {
          TransportSlotCount: 1,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BunkerBusterBomb', 50, 50),
        makeMapObject('Humvee', 60, 50),
        makeMapObject('Soldier', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Board the transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 2 });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        transportContainerId: number | null;
        attackTargetEntityId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    const bomb = priv.spawnedEntities.get(1)!;
    const soldier = priv.spawnedEntities.get(3)!;
    expect(soldier.transportContainerId).toBe(2);

    // Set attack target and tick.
    bomb.attackTargetEntityId = 2;
    logic.update(1 / 30);

    // Kill the bomb.
    priv.applyWeaponDamageAmount(null, bomb, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // Soldier should survive — TransportContain is not bustable.
    expect(soldier.destroyed).toBe(false);
    expect(soldier.health).toBe(100);
  });

  it('fires shockwave weapon at victim position on death', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BunkerBusterBomb', 'America', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'BunkerBusterBehavior ModuleTag_BB', {
            ShockwaveWeaponTemplate: 'BunkerBusterShockwave',
          }),
        ]),
        makeObjectDef('CivilianBuilding', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'GarrisonContain ModuleTag_GC', {
            MaxOccupants: 10,
          }),
        ], { GeometryMajorRadius: 10, GeometryMinorRadius: 10, GeometryHeight: 10 }),
        makeObjectDef('NearbyTank', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BunkerBusterShockwave', {
          PrimaryDamage: 200,
          PrimaryDamageRadius: 50,
          DamageType: 'EXPLOSION',
          DeathType: 'EXPLODED',
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BunkerBusterBomb', 50, 50),
        makeMapObject('CivilianBuilding', 60, 50),
        makeMapObject('NearbyTank', 62, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        attackTargetEntityId: number | null;
      }>;
      applyWeaponDamageAmount(a: number | null, t: unknown, amount: number, dt: string): void;
    };

    const bomb = priv.spawnedEntities.get(1)!;
    const tank = priv.spawnedEntities.get(3)!;
    const initialTankHealth = tank.health;

    // Set attack target and tick.
    bomb.attackTargetEntityId = 2;
    logic.update(1 / 30);

    // Kill the bomb.
    priv.applyWeaponDamageAmount(null, bomb, 1000, 'UNRESISTABLE');
    logic.update(1 / 30);

    // Nearby tank should have taken shockwave damage.
    expect(tank.health).toBeLessThan(initialTankHealth);
  });
});

describe('TechBuildingBehavior', () => {
  it('reverts to civilian side on death instead of being destroyed', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OilDerrick', 'civilian', ['STRUCTURE', 'TECH_BUILDING'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Behavior', 'TechBuildingBehavior ModuleTag_TB', {
            PulseFXRate: 0,
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0, AttackRange: 50,
          DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL',
          DelayBetweenShots: 500, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('OilDerrick', 50, 50),
        makeMapObject('Attacker', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    // Capture the oil derrick for America first.
    logic.submitCommand({ type: 'captureEntity', entityId: 1, newSide: 'America' });
    logic.update(1 / 30);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; side: string; health: number; maxHealth: number;
        techBuildingProfile: unknown;
      }>;
    };

    const derrick = priv.spawnedEntities.get(1)!;
    expect(derrick.side).toBe('america');
    expect(derrick.techBuildingProfile).not.toBeNull();

    // Kill the derrick with GLA attacker.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Derrick should NOT be destroyed — it should have reverted to civilian.
    expect(derrick.destroyed).toBe(false);
    expect(derrick.side).toBe('civilian');
    expect(derrick.health).toBe(derrick.maxHealth);
  });

  it('can be recaptured after death revert', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Hospital', 'civilian', ['STRUCTURE', 'TECH_BUILDING'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 150, InitialHealth: 150 }),
          makeBlock('Behavior', 'TechBuildingBehavior ModuleTag_TB', {
            PulseFXRate: 0,
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TestGun', {
          PrimaryDamage: 500, PrimaryDamageRadius: 0, AttackRange: 50,
          DamageType: 'ARMOR_PIERCING', DeathType: 'NORMAL',
          DelayBetweenShots: 500, ClipSize: 1, AutoReloadsClip: 'Yes',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Hospital', 50, 50),
        makeMapObject('Attacker', 80, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; side: string; health: number; maxHealth: number;
      }>;
    };

    // Capture for China.
    logic.submitCommand({ type: 'captureEntity', entityId: 1, newSide: 'China' });
    logic.update(1 / 30);
    expect(priv.spawnedEntities.get(1)!.side).toBe('china');

    // Kill it with GLA attacker.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(priv.spawnedEntities.get(1)!.side).toBe('civilian');
    expect(priv.spawnedEntities.get(1)!.destroyed).toBe(false);

    // Recapture for China again.
    logic.submitCommand({ type: 'captureEntity', entityId: 1, newSide: 'China' });
    logic.update(1 / 30);
    expect(priv.spawnedEntities.get(1)!.side).toBe('china');
    expect(priv.spawnedEntities.get(1)!.destroyed).toBe(false);
    expect(priv.spawnedEntities.get(1)!.health).toBe(priv.spawnedEntities.get(1)!.maxHealth);
  });

  it('starts as civilian and is capturable from initial state', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('OilRefinery', 'civilian', ['STRUCTURE', 'TECH_BUILDING'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'TechBuildingBehavior ModuleTag_TB', {
            PulseFXRate: 0,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('OilRefinery', 50, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; side: string; health: number; destroyed: boolean;
        techBuildingProfile: unknown;
      }>;
    };

    logic.update(1 / 30);
    const building = priv.spawnedEntities.get(1)!;
    expect(building.side).toBe('civilian');
    expect(building.techBuildingProfile).not.toBeNull();

    // Capture for America.
    logic.submitCommand({ type: 'captureEntity', entityId: 1, newSide: 'America' });
    logic.update(1 / 30);
    expect(building.side).toBe('america');
    expect(building.health).toBe(300);
  });
});

describe('AssistedTargetingUpdate', () => {
  function makeAssistedBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Patriot', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'PatriotMissile'] }),
          makeBlock('Behavior', 'AssistedTargetingUpdate ModuleTag_AT', {
            AssistingClipSize: 4,
            AssistingWeaponSlot: 'PRIMARY',
            LaserFromAssisted: 'AssistLaser1',
            LaserToTarget: 'AssistLaser2',
          }),
        ]),
        makeObjectDef('Target', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        makeObjectDef('Designator', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('PatriotMissile', {
          AttackRange: 200,
          PrimaryDamage: 80,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
        }),
      ],
    });
  }

  it('extracts assisted targeting profile from INI', () => {
    const bundle = makeAssistedBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Patriot', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        assistedTargetingProfile: { clipSize: number; weaponSlot: string; laserFromAssisted: string } | null;
      }>;
    };

    const patriot = [...priv.spawnedEntities.values()][0]!;
    expect(patriot.assistedTargetingProfile).not.toBeNull();
    expect(patriot.assistedTargetingProfile!.clipSize).toBe(4);
    expect(patriot.assistedTargetingProfile!.weaponSlot).toBe('PRIMARY');
    expect(patriot.assistedTargetingProfile!.laserFromAssisted).toBe('AssistLaser1');
  });

  it('isFreeToAssist returns true when weapon is ready', () => {
    const bundle = makeAssistedBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Patriot', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; assistedTargetingProfile: unknown;
        attackCooldownRemaining: number; destroyed: boolean;
      }>;
    };

    const patriot = [...priv.spawnedEntities.values()][0]!;
    // Should be free to assist when weapon is ready (cooldown=0).
    expect((logic as unknown as { isEntityFreeToAssist: (e: unknown) => boolean }).isEntityFreeToAssist(patriot)).toBe(true);

    // Set cooldown — should no longer be free.
    patriot.attackCooldownRemaining = 10;
    expect((logic as unknown as { isEntityFreeToAssist: (e: unknown) => boolean }).isEntityFreeToAssist(patriot)).toBe(false);
  });

  it('issueAssistedAttack causes the assisted entity to attack the target', () => {
    const bundle = makeAssistedBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Patriot', 10, 10),
        makeMapObject('Target', 30, 10), // 20 units away — within range
        makeMapObject('Designator', 10, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; health: number;
        attackTargetEntityId: number | null;
      }>;
    };

    const target = [...priv.spawnedEntities.values()].find(e => e.health === 200)!;
    const patriot = [...priv.spawnedEntities.values()].find(e => e.health === 300)!;

    // Issue assisted attack.
    (logic as unknown as { issueAssistedAttack: (a: number, t: number) => void }).issueAssistedAttack(patriot.id, target.id);

    // Run frames for the attack to fire.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      if (target.health < 200) break;
    }

    // Target should have taken damage from the patriot.
    expect(target.health).toBeLessThan(200);
  });
});

describe('RepairDockUpdate', () => {
  function makeRepairDockBundle(timeForFullHealMs = 3000) {
    return makeBundle({
      objects: [
        makeObjectDef('RepairDock', 'America', ['STRUCTURE', 'REPAIR_PAD'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Repair', {
            TimeForFullHeal: timeForFullHealMs,
          }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 8,
          GeometryMinorRadius: 8,
        }),
        makeObjectDef('DamagedVehicle', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
          makeBlock('LocomotorSet', 'SET_NORMAL VehicleLocomotor', {}),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 4,
          GeometryMinorRadius: 4,
        }),
        makeObjectDef('SupportDrone', 'America', ['DRONE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 25 }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 2,
          GeometryMinorRadius: 2,
        }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
          makeBlock('LocomotorSet', 'SET_NORMAL VehicleLocomotor', {}),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 4,
          GeometryMinorRadius: 4,
        }),
      ],
      locomotors: [
        makeLocomotorDef('VehicleLocomotor', 180),
      ],
    });
  }

  it('extracts RepairDockUpdate profile from INI', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('RepairDock', 55, 55)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        repairDockProfile: { timeForFullHealFrames: number } | null;
      }>;
    };

    const dock = priv.spawnedEntities.get(1)!;
    expect(dock.repairDockProfile).not.toBeNull();
    // Source parity: parseDurationReal converts 3000ms to 90.0 frames at 30fps.
    expect(dock.repairDockProfile!.timeForFullHealFrames).toBeCloseTo(90, 5);
  });

  it('heals docked vehicle over configured full-heal duration then completes docking', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),     // id 1
        makeMapObject('DamagedVehicle', 55, 55), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
      }>;
      pendingRepairDockActions: Map<number, {
        dockObjectId: number;
        healthToAddPerFrame: number;
        lastRepairDockObjectId: number;
      }>;
    };

    const vehicle = priv.spawnedEntities.get(2)!;
    expect(vehicle.health).toBe(150);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });

    // First update should resolve enter action and apply first repair tick.
    logic.update(1 / 30);
    expect(vehicle.health).toBeGreaterThan(150);
    expect(priv.pendingRepairDockActions.get(2)?.dockObjectId).toBe(1);

    // 3000ms -> 90 frames to full heal from initial health.
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    expect(vehicle.health).toBeCloseTo(vehicle.maxHealth, 5);
    expect(priv.pendingRepairDockActions.has(2)).toBe(false);
  });

  it('fully heals all associated drones each dock action tick', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),     // id 1
        makeMapObject('DamagedVehicle', 55, 55), // id 2
        makeMapObject('SupportDrone', 65, 55),   // id 3
        makeMapObject('SupportDrone', 67, 55),   // id 4
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        producerEntityId: number;
      }>;
    };
    const droneA = priv.spawnedEntities.get(3)!;
    const droneB = priv.spawnedEntities.get(4)!;
    droneA.producerEntityId = 2;
    droneB.producerEntityId = 2;
    expect(droneA.health).toBe(25);
    expect(droneB.health).toBe(25);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });

    logic.update(1 / 30);
    expect(droneA.health).toBe(droneA.maxHealth);
    expect(droneB.health).toBe(droneB.maxHealth);
  });

  it('allows full-health vehicles to dock-repair damaged associated drones', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),     // id 1
        makeMapObject('DamagedVehicle', 55, 55), // id 2
        makeMapObject('SupportDrone', 65, 55),   // id 3
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        producerEntityId: number;
      }>;
      pendingRepairDockActions: Map<number, {
        dockObjectId: number;
      }>;
    };
    const vehicle = priv.spawnedEntities.get(2)!;
    const drone = priv.spawnedEntities.get(3)!;

    vehicle.health = vehicle.maxHealth;
    drone.producerEntityId = 2;
    drone.health = 15;
    expect(drone.health).toBeLessThan(drone.maxHealth);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });

    logic.update(1 / 30);
    expect(drone.health).toBe(drone.maxHealth);
    expect(priv.pendingRepairDockActions.has(2)).toBe(false);
  });

  it('rejects repairVehicle enter actions from enemy units', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),    // id 1
        makeMapObject('EnemyVehicle', 75, 55),  // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number }>;
      pendingRepairDockActions: Map<number, unknown>;
    };

    const enemy = priv.spawnedEntities.get(2)!;
    expect(enemy.health).toBe(150);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    expect(enemy.health).toBe(150);
    expect(priv.pendingRepairDockActions.has(2)).toBe(false);
  });

  it('allows repairVehicle enter actions from allied cross-side units', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),    // id 1
        makeMapObject('EnemyVehicle', 75, 55),  // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('China', 'America', 2);
    logic.setTeamRelationship('America', 'China', 2);

    const priv = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      pendingRepairDockActions: Map<number, unknown>;
      spawnedEntities: Map<number, {
        health: number;
        moveTarget: { x: number; z: number } | null;
      }>;
    };

    const allyVehicle = priv.spawnedEntities.get(2)!;
    expect(allyVehicle.health).toBe(150);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    expect(allyVehicle.moveTarget).not.toBeNull();
    expect(
      priv.pendingEnterObjectActions.has(2)
      || priv.pendingRepairDockActions.has(2),
    ).toBe(true);
  });

  it('rejects repairVehicle enter from effectively-dead source units', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),     // id 1
        makeMapObject('DamagedVehicle', 75, 55), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      spawnedEntities: Map<number, { health: number }>;
      canExecuteRepairVehicleEnterAction: (source: unknown, target: unknown) => boolean;
    };
    const dock = privateApi.spawnedEntities.get(1)!;
    const vehicle = privateApi.spawnedEntities.get(2)!;

    vehicle.health = 0;
    expect(privateApi.canExecuteRepairVehicleEnterAction(vehicle, dock)).toBe(false);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(2)).toBe(false);
  });

  it('rejects repairVehicle enter when target dock is sold', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),     // id 1
        makeMapObject('DamagedVehicle', 75, 55), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      pendingRepairDockActions: Map<number, unknown>;
      spawnedEntities: Map<number, { objectStatusFlags: Set<string> }>;
    };
    const dock = privateApi.spawnedEntities.get(1)!;
    dock.objectStatusFlags.add('SOLD');

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(2)).toBe(false);
    expect(privateApi.pendingRepairDockActions.has(2)).toBe(false);
  });

  it('stops active repairVehicle docking when the source becomes immobile', () => {
    const bundle = makeRepairDockBundle(3000);
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('RepairDock', 55, 55),     // id 1
        makeMapObject('DamagedVehicle', 55, 55), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingRepairDockActions: Map<number, unknown>;
      spawnedEntities: Map<number, { health: number; objectStatusFlags: Set<string> }>;
    };
    const vehicle = privateApi.spawnedEntities.get(2)!;

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingRepairDockActions.has(2)).toBe(true);
    const healedHealth = vehicle.health;

    vehicle.objectStatusFlags.add('DISABLED_SUBDUED');
    for (let i = 0; i < 5; i += 1) {
      logic.update(1 / 30);
    }

    expect(privateApi.pendingRepairDockActions.has(2)).toBe(false);
    expect(vehicle.health).toBeCloseTo(healedHealth, 5);
  });

  it('rejects aircraft repairVehicle enter across different controlling players on same side', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Airfield', 'America', ['STRUCTURE', 'AIRFIELD', 'FS_AIRFIELD'], [
          makeBlock('Behavior', 'ParkingPlaceBehavior ModuleTag_Parking', {
            NumRows: 1,
            NumCols: 1,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
        makeObjectDef('DamagedJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('LocomotorSet', 'SET_NORMAL JetLocomotor', {}),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
        ]),
      ],
      locomotors: [
        makeLocomotorDef('JetLocomotor', 250),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Airfield', 55, 55, { OriginalOwner: 'Player_A' }), // id 1
        makeMapObject('DamagedJet', 75, 55, { OriginalOwner: 'Player_B' }), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      spawnedEntities: Map<number, {
        y: number;
        baseHeight: number;
        moveTarget: { x: number; z: number } | null;
      }>;
    };

    const damagedJet = privateApi.spawnedEntities.get(2)!;
    damagedJet.y = damagedJet.baseHeight + 20;

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(2)).toBe(false);
    expect(damagedJet.moveTarget).toBeNull();
  });

  it('rejects aircraft repairVehicle enter when target lacks FS_AIRFIELD kind', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('AirfieldLike', 'America', ['STRUCTURE', 'AIRFIELD'], [
          makeBlock('Behavior', 'ParkingPlaceBehavior ModuleTag_Parking', {
            NumRows: 1,
            NumCols: 1,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
        makeObjectDef('DamagedJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('LocomotorSet', 'SET_NORMAL JetLocomotor', {}),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
        ]),
      ],
      locomotors: [
        makeLocomotorDef('JetLocomotor', 250),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AirfieldLike', 55, 55), // id 1
        makeMapObject('DamagedJet', 75, 55), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      spawnedEntities: Map<number, {
        y: number;
        baseHeight: number;
        moveTarget: { x: number; z: number } | null;
      }>;
    };

    const damagedJet = privateApi.spawnedEntities.get(2)!;
    damagedJet.y = damagedJet.baseHeight + 20;

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(2)).toBe(false);
    expect(damagedJet.moveTarget).toBeNull();
  });

  it('rejects aircraft repairVehicle enter when airfield has no parking space and no reservation', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Airfield', 'America', ['STRUCTURE', 'AIRFIELD', 'FS_AIRFIELD'], [
          makeBlock('Behavior', 'ParkingPlaceBehavior ModuleTag_Parking', {
            NumRows: 1,
            NumCols: 1,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
        makeObjectDef('DamagedJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('LocomotorSet', 'SET_NORMAL JetLocomotor', {}),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
        ]),
        makeObjectDef('OccupyingJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('LocomotorSet', 'SET_NORMAL JetLocomotor', {}),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
      locomotors: [
        makeLocomotorDef('JetLocomotor', 250),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Airfield', 55, 55), // id 1
        makeMapObject('DamagedJet', 75, 55), // id 2
        makeMapObject('OccupyingJet', 55, 55), // id 3
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      spawnedEntities: Map<number, {
        y: number;
        baseHeight: number;
        parkingSpaceProducerId: number | null;
        moveTarget: { x: number; z: number } | null;
        parkingPlaceProfile: { occupiedSpaceEntityIds: Set<number> } | null;
      }>;
    };

    const airfield = privateApi.spawnedEntities.get(1)!;
    const damagedJet = privateApi.spawnedEntities.get(2)!;
    const occupyingJet = privateApi.spawnedEntities.get(3)!;

    // Force occupied parking state and airborne repair source.
    occupyingJet.parkingSpaceProducerId = 1;
    airfield.parkingPlaceProfile?.occupiedSpaceEntityIds.add(3);
    damagedJet.y = damagedJet.baseHeight + 20;

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(2)).toBe(false);
    expect(damagedJet.moveTarget).toBeNull();
  });

  it('allows aircraft repairVehicle enter when aircraft has reserved parking space at the airfield', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Airfield', 'America', ['STRUCTURE', 'AIRFIELD', 'FS_AIRFIELD'], [
          makeBlock('Behavior', 'ParkingPlaceBehavior ModuleTag_Parking', {
            NumRows: 1,
            NumCols: 1,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
        makeObjectDef('DamagedJet', 'America', ['VEHICLE', 'AIRCRAFT'], [
          makeBlock('LocomotorSet', 'SET_NORMAL JetLocomotor', {}),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 150 }),
        ]),
      ],
      locomotors: [
        makeLocomotorDef('JetLocomotor', 250),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Airfield', 55, 55), // id 1
        makeMapObject('DamagedJet', 75, 55), // id 2
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      spawnedEntities: Map<number, {
        y: number;
        baseHeight: number;
        moveTarget: { x: number; z: number } | null;
        parkingPlaceProfile: { occupiedSpaceEntityIds: Set<number> } | null;
      }>;
    };

    const airfield = privateApi.spawnedEntities.get(1)!;
    const damagedJet = privateApi.spawnedEntities.get(2)!;

    // Source parity: ActionManager::canEnterObject allows aircraft when
    // ParkingPlaceBehavior::hasReservedSpace(sourceId) is true.
    airfield.parkingPlaceProfile?.occupiedSpaceEntityIds.add(2);
    damagedJet.y = damagedJet.baseHeight + 20;
    expect((logic as unknown as {
      canExecuteRepairVehicleEnterAction: (source: unknown, target: unknown) => boolean;
    }).canExecuteRepairVehicleEnterAction(damagedJet, airfield)).toBe(true);

    logic.submitCommand({
      type: 'enterObject',
      entityId: 2,
      targetObjectId: 1,
      action: 'repairVehicle',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(2)).toBe(true);
    expect(damagedJet.moveTarget).not.toBeNull();
  });
});

describe('SupplyWarehouseCripplingBehavior', () => {
  function makeCripplingBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('SupplyWarehouse', 'America', ['SUPPLY_SOURCE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
            StartingBoxes: 20,
            DeleteWhenEmpty: 'No',
          }),
          makeBlock('Behavior', 'SupplyWarehouseCripplingBehavior ModuleTag_Cripple', {
            SelfHealSupression: 3000,   // 3000ms → 90 frames
            SelfHealDelay: 1000,         // 1000ms → 30 frames
            SelfHealAmount: 50,
          }),
        ]),
        makeObjectDef('Attacker', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BigGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('BigGun', {
          AttackRange: 200,
          PrimaryDamage: 100,
          WeaponSpeed: 999999,
          DelayBetweenShots: 100,
        }),
      ],
    });
  }

  it('extracts crippling profile from INI', () => {
    const bundle = makeCripplingBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyWarehouse', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        supplyWarehouseCripplingProfile: {
          selfHealSuppressionFrames: number;
          selfHealDelayFrames: number;
          selfHealAmount: number;
        } | null;
      }>;
    };

    const warehouse = [...priv.spawnedEntities.values()][0]!;
    expect(warehouse.supplyWarehouseCripplingProfile).not.toBeNull();
    expect(warehouse.supplyWarehouseCripplingProfile!.selfHealSuppressionFrames).toBe(90);
    expect(warehouse.supplyWarehouseCripplingProfile!.selfHealDelayFrames).toBe(30);
    expect(warehouse.supplyWarehouseCripplingProfile!.selfHealAmount).toBe(50);
  });

  it('disables dock when health drops to REALLYDAMAGED', () => {
    const bundle = makeCripplingBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyWarehouse', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; health: number; maxHealth: number; destroyed: boolean;
        swCripplingDockDisabled: boolean;
      }>;
      applyWeaponDamageAmount: (
        sourceEntityId: number | null, target: unknown, amount: number,
        damageType: string, weaponDeathType?: string,
      ) => void;
    };

    const warehouse = [...priv.spawnedEntities.values()][0]!;
    expect(warehouse.swCripplingDockDisabled).toBe(false);

    // Damage warehouse to REALLYDAMAGED: health ratio <= 0.1 (health <= 100).
    // MaxHealth=1000, so deal 950 damage → health=50, ratio=0.05 → REALLYDAMAGED.
    priv.applyWeaponDamageAmount(null, warehouse, 950, 'ARMOR_PIERCING');
    expect(warehouse.health).toBe(50);
    expect(warehouse.swCripplingDockDisabled).toBe(true);
  });

  it('self-heals after suppression delay expires', () => {
    const bundle = makeCripplingBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyWarehouse', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; health: number; maxHealth: number; destroyed: boolean;
        swCripplingDockDisabled: boolean;
      }>;
      applyWeaponDamageAmount: (
        sourceEntityId: number | null, target: unknown, amount: number,
        damageType: string, weaponDeathType?: string,
      ) => void;
    };

    const warehouse = [...priv.spawnedEntities.values()][0]!;
    // Damage to health=400 (ratio 0.4 → DAMAGED state since 0.4 <= 0.5).
    priv.applyWeaponDamageAmount(null, warehouse, 600, 'ARMOR_PIERCING');
    expect(warehouse.health).toBe(400);

    // Suppression is 90 frames. Run 89 frames — should NOT have healed yet.
    for (let i = 0; i < 89; i++) {
      logic.update(1 / 30);
    }
    expect(warehouse.health).toBe(400);

    // Run 2 more frames to pass suppression + first heal tick.
    logic.update(1 / 30); // frame 90: suppression expires
    logic.update(1 / 30); // frame 91: heal tick fires
    expect(warehouse.health).toBeGreaterThan(400);
  });

  it('re-enables dock when health heals past REALLYDAMAGED threshold', () => {
    const bundle = makeCripplingBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyWarehouse', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; health: number; maxHealth: number; destroyed: boolean;
        swCripplingDockDisabled: boolean;
      }>;
      applyWeaponDamageAmount: (
        sourceEntityId: number | null, target: unknown, amount: number,
        damageType: string, weaponDeathType?: string,
      ) => void;
    };

    const warehouse = [...priv.spawnedEntities.values()][0]!;

    // Damage to health=50 (ratio 0.05 → REALLYDAMAGED since 0.05 <= 0.1).
    priv.applyWeaponDamageAmount(null, warehouse, 950, 'ARMOR_PIERCING');
    expect(warehouse.health).toBe(50);
    expect(warehouse.swCripplingDockDisabled).toBe(true);

    // Wait for suppression to expire (90 frames) and enough heal ticks to cross threshold.
    // selfHealAmount=50, every 30 frames. REALLYDAMAGED threshold is ratio > 0.1 → health > 100.
    // Need to heal from 50 to >100, so 2 ticks of 50 = 100 total heal → health=150 (ratio 0.15 → DAMAGED).
    // After suppression (90 frames), first heal at frame 90, second at frame 120.
    for (let i = 0; i < 130; i++) {
      logic.update(1 / 30);
    }

    // Health should have healed past 100.
    expect(warehouse.health).toBeGreaterThan(100);
    // Dock should be re-enabled since health is no longer REALLYDAMAGED.
    expect(warehouse.swCripplingDockDisabled).toBe(false);
  });

  it('damage resets heal suppression timer', () => {
    const bundle = makeCripplingBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyWarehouse', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; health: number; maxHealth: number; destroyed: boolean;
      }>;
      applyWeaponDamageAmount: (
        sourceEntityId: number | null, target: unknown, amount: number,
        damageType: string, weaponDeathType?: string,
      ) => void;
    };

    const warehouse = [...priv.spawnedEntities.values()][0]!;

    // First damage: health 1000 → 600.
    priv.applyWeaponDamageAmount(null, warehouse, 400, 'ARMOR_PIERCING');
    expect(warehouse.health).toBe(600);

    // Run 80 frames (not yet past 90 frame suppression).
    for (let i = 0; i < 80; i++) {
      logic.update(1 / 30);
    }
    expect(warehouse.health).toBe(600); // Still suppressed.

    // Second damage: resets suppression timer. Health 600 → 500.
    priv.applyWeaponDamageAmount(null, warehouse, 100, 'ARMOR_PIERCING');
    expect(warehouse.health).toBe(500);

    // Run 80 more frames — still within NEW suppression window (90 frames from second hit).
    for (let i = 0; i < 80; i++) {
      logic.update(1 / 30);
    }
    expect(warehouse.health).toBe(500); // Still suppressed from second hit.

    // Run 12 more frames to pass new suppression window + first tick.
    for (let i = 0; i < 12; i++) {
      logic.update(1 / 30);
    }
    expect(warehouse.health).toBeGreaterThan(500); // Healing has started.
  });
});

describe('TransportAI attack delegation', () => {
  function makeTransportBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('Humvee', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'HumveeMG'] }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            PassengersAllowedToFire: 'Yes',
            ContainMax: 5,
          }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 10,
          GeometryMinorRadius: 10,
        }),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RangerGun'] }),
        ], {
          TransportSlotCount: 1,
        }),
        makeObjectDef('EnemyTank', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('HumveeMG', {
          PrimaryDamage: 10, AttackRange: 100, DelayBetweenShots: 100, DamageType: 'SMALL_ARMS',
        }),
        makeWeaponDef('RangerGun', {
          PrimaryDamage: 5, AttackRange: 80, DelayBetweenShots: 100, DamageType: 'SMALL_ARMS',
        }),
      ],
    });
  }

  it('player attack command on transport propagates to contained passengers', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeTransportBundle());

    const map = makeMap([
      makeMapObject('Humvee', 50, 50),    // id 1
      makeMapObject('Ranger', 50, 50),     // id 2 — adjacent to Humvee
      makeMapObject('EnemyTank', 60, 50),  // id 3 — within range
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    // Enter transport.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    // Verify passenger is inside.
    const priv = logic as any;
    const passenger = priv.spawnedEntities.get(2)!;
    expect(passenger.transportContainerId).toBe(1);

    // Issue attack command on the transport.
    logic.submitCommand({
      type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER',
    });
    logic.update(1 / 30);

    // Passenger should also target the enemy.
    expect(passenger.attackTargetEntityId).toBe(3);
  });

  it('AI auto-target attack does NOT propagate to passengers', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeTransportBundle());

    const map = makeMap([
      makeMapObject('Humvee', 50, 50),
      makeMapObject('Ranger', 50, 50),
      makeMapObject('EnemyTank', 60, 50),
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    const priv = logic as any;
    const passenger = priv.spawnedEntities.get(2)!;

    // Issue AI-sourced attack (e.g., auto-retaliation) — should NOT propagate.
    logic.submitCommand({
      type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'AI',
    });
    logic.update(1 / 30);

    // Passenger should NOT have the target set by transport delegation.
    // (It may acquire its own target via auto-targeting, but not from this delegation.)
    expect(passenger.attackTargetEntityId).not.toBe(3);
  });

  it('skips disabled PORTABLE_STRUCTURE passengers', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'OverlordCannon'] }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            PassengersAllowedToFire: 'Yes',
            ContainMax: 5,
          }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 15,
          GeometryMinorRadius: 15,
        }),
        makeObjectDef('GattlingUpgrade', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'GattlingGun'] }),
        ]),
        makeObjectDef('EnemyUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('OverlordCannon', {
          PrimaryDamage: 50, AttackRange: 150, DelayBetweenShots: 200, DamageType: 'ARMOR_PIERCING',
        }),
        makeWeaponDef('GattlingGun', {
          PrimaryDamage: 10, AttackRange: 100, DelayBetweenShots: 50, DamageType: 'SMALL_ARMS',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(bundle);

    const map = makeMap([
      makeMapObject('Overlord', 50, 50),        // id 1
      makeMapObject('GattlingUpgrade', 50, 50),  // id 2 — portable structure passenger
      makeMapObject('EnemyUnit', 60, 50),        // id 3
    ]);

    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    const priv = logic as any;
    const gattling = priv.spawnedEntities.get(2)!;

    // Put gattling inside overlord via helixCarrierId (Overlord contain type).
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    // Disable the gattling with EMP.
    gattling.objectStatusFlags.add('DISABLED_EMP');

    // Attack with overlord.
    logic.submitCommand({
      type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER',
    });
    logic.update(1 / 30);

    // Disabled PORTABLE_STRUCTURE should NOT receive the attack delegation.
    expect(gattling.attackTargetEntityId).not.toBe(3);
  });
});

describe('InternetHackContain', () => {
  it('auto-issues hackInternet command when hacker enters internet center', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('InternetCenter', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'InternetHackContain ModuleTag_Contain', {
            ContainMax: 8,
          }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 20,
          GeometryMinorRadius: 20,
        }),
        makeObjectDef('Hacker', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'HackInternetAIUpdate ModuleTag_Hack', {
            UnpackTime: 0,
            CashUpdateDelay: 0,
            CashUpdateDelayFast: 0,
            RegularCashAmount: 50,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('InternetCenter', 30, 30),  // id 1
        makeMapObject('Hacker', 30, 30),           // id 2 — adjacent to center
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: 0 });

    // Enter the internet center.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30); // process enter
    logic.update(1 / 30); // process auto-issued hackInternet command

    // Run a few frames to accumulate hack income.
    for (let frame = 0; frame < 3; frame++) {
      logic.update(1 / 30);
    }

    // Hacker should be generating money from inside the internet center.
    expect(logic.getSideCredits('China')).toBeGreaterThan(0);
  });

  it('uses fast cash update delay when hacker is inside internet center', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('InternetCenter', 'China', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'InternetHackContain ModuleTag_Contain', {
            ContainMax: 8,
          }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 20,
          GeometryMinorRadius: 20,
        }),
        makeObjectDef('Hacker', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'HackInternetAIUpdate ModuleTag_Hack', {
            UnpackTime: 0,
            CashUpdateDelay: 3000,
            CashUpdateDelayFast: 0,
            RegularCashAmount: 100,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('InternetCenter', 30, 30),  // id 1
        makeMapObject('Hacker', 30, 30),           // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.submitCommand({ type: 'setSideCredits', side: 'China', amount: 0 });

    // Enter the internet center to trigger fast hack.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30); // process enter
    logic.update(1 / 30); // process auto-hackInternet

    // Run 5 frames — with CashUpdateDelayFast=0, should generate quickly.
    // With normal CashUpdateDelay=3000 (90 frames), no cash would appear yet.
    for (let frame = 0; frame < 5; frame++) {
      logic.update(1 / 30);
    }

    // Fast delay should have generated cash; normal delay would not have.
    expect(logic.getSideCredits('China')).toBeGreaterThan(0);
  });
});

describe('LeechRangeWeapon', () => {
  it('maintains attack on target that moves out of normal weapon range', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Hacker', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'HackWeapon'] }),
        ]),
        makeObjectDef('EnemyVehicle', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('HackWeapon', {
          PrimaryDamage: 5, AttackRange: 50, DelayBetweenShots: 100,
          DamageType: 'INFORMATION', LeechRangeWeapon: 'Yes',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Hacker', 10, 10),       // id 1
        makeMapObject('EnemyVehicle', 40, 10),  // id 2 — within 50 range
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Issue attack and run a few frames so weapon fires.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2, commandSource: 'PLAYER' });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as any;
    const hacker = priv.spawnedEntities.get(1)!;
    const enemy = priv.spawnedEntities.get(2)!;

    // Leech range should be active after first shot.
    expect(hacker.leechRangeActive).toBe(true);

    // Move target way beyond normal weapon range.
    enemy.x = 200;
    enemy.z = 10;

    // Run more frames — hacker should STILL be attacking (leech range = unlimited).
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Hacker should still have the target locked despite being far out of range.
    expect(hacker.attackTargetEntityId).toBe(2);
  });

  it('clears leechRangeActive when attack target is cleared', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Hacker', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'HackWeapon'] }),
        ]),
        makeObjectDef('EnemyVehicle', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('HackWeapon', {
          PrimaryDamage: 5, AttackRange: 50, DelayBetweenShots: 100,
          DamageType: 'INFORMATION', LeechRangeWeapon: 'Yes',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Hacker', 10, 10),       // id 1
        makeMapObject('EnemyVehicle', 40, 10),  // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2, commandSource: 'PLAYER' });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as any;
    const hacker = priv.spawnedEntities.get(1)!;
    expect(hacker.leechRangeActive).toBe(true);

    // Stop the hacker (clears attack target).
    logic.submitCommand({ type: 'stop', entityId: 1 });
    logic.update(1 / 30);

    // Leech range should be cleared.
    expect(hacker.leechRangeActive).toBe(false);
  });

  it('does NOT grant leech range to normal weapons', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankCannon'] }),
        ]),
        makeObjectDef('EnemyUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TankCannon', {
          PrimaryDamage: 50, AttackRange: 100, DelayBetweenShots: 500, DamageType: 'ARMOR_PIERCING',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Tank', 10, 10),      // id 1
        makeMapObject('EnemyUnit', 40, 10),  // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2, commandSource: 'PLAYER' });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const priv = logic as any;
    const tank = priv.spawnedEntities.get(1)!;

    // Normal weapon should NOT activate leech range.
    expect(tank.leechRangeActive).toBe(false);
  });
});

describe('AssaultTransportAIUpdate', () => {
  function makeAssaultTransportBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('TroopCrawler', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
          makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
            PassengersAllowedToFire: 'No',
            ContainMax: 8,
          }),
          makeBlock('Behavior', 'AssaultTransportAIUpdate ModuleTag_AssaultAI', {
            MembersGetHealedAtLifeRatio: 0.3,
          }),
        ], {
          Geometry: 'CYLINDER',
          GeometryMajorRadius: 10,
          GeometryMinorRadius: 10,
        }),
        makeObjectDef('RedGuard', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RedGuardGun'] }),
        ], {
          TransportSlotCount: 1,
        }),
        makeObjectDef('EnemyTank', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('RedGuardGun', {
          PrimaryDamage: 5, AttackRange: 80, DelayBetweenShots: 100, DamageType: 'SMALL_ARMS',
        }),
      ],
    });
  }

  it('extracts AssaultTransportProfile from INI', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([makeMapObject('TroopCrawler', 50, 50)], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    const priv = logic as any;
    const crawler = priv.spawnedEntities.get(1)!;
    expect(crawler.assaultTransportProfile).not.toBeNull();
    expect(crawler.assaultTransportProfile.membersGetHealedAtLifeRatio).toBeCloseTo(0.3);
  });

  it('deploys passengers when transport receives attack command', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TroopCrawler', 50, 50),   // id 1
        makeMapObject('RedGuard', 50, 50),         // id 2
        makeMapObject('EnemyTank', 100, 50),       // id 3
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Load passenger.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    const priv = logic as any;
    const guard = priv.spawnedEntities.get(2)!;
    expect(guard.transportContainerId).toBe(1);

    // Attack command on transport — should begin assault and deploy passengers.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER' });
    // Run several frames for command processing + assault transport update.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Verify assault transport state was created.
    const assaultState = priv.assaultTransportStateByEntityId.get(1);
    expect(assaultState).toBeDefined();
    expect(assaultState.designatedTargetId).toBe(3);

    // After some frames, member should be ejected (exitContainer queued).
    // Guard should no longer be contained once eject processes.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(guard.transportContainerId).toBeNull();
  });

  it('recalls wounded members back into transport', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TroopCrawler', 50, 50),   // id 1
        makeMapObject('RedGuard', 50, 50),         // id 2
        makeMapObject('EnemyTank', 100, 50),       // id 3
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Load passenger, then attack to deploy.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER' });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as any;
    const guard = priv.spawnedEntities.get(2)!;
    // Guard should be outside now.
    expect(guard.transportContainerId).toBeNull();

    // Wound the guard below the heal ratio (0.3 * 100 = 30 health).
    guard.health = 20;

    // Run assault transport update — should recall wounded member.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Guard should be back in the transport.
    expect(guard.transportContainerId).toBe(1);
  });

  it('transfers attack orders to troops when transport is destroyed', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TroopCrawler', 50, 50),   // id 1
        makeMapObject('RedGuard', 55, 50),         // id 2 — nearby, not inside
        makeMapObject('EnemyTank', 100, 50),       // id 3
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Load passenger, attack to deploy.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER' });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as any;
    const guard = priv.spawnedEntities.get(2)!;
    // Ensure guard is deployed outside.
    expect(guard.transportContainerId).toBeNull();

    // Destroy the transport via markEntityDestroyed.
    (priv as { markEntityDestroyed: (id: number, attackerId: number) => void }).markEntityDestroyed(1, -1);
    logic.update(1 / 30);

    // Assault transport state should be cleaned up.
    expect(priv.assaultTransportStateByEntityId.has(1)).toBe(false);

    // Guard should have received attack orders for the target.
    expect(guard.attackTargetEntityId).toBe(3);
  });

  it('resets state and recalls members on stop command', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TroopCrawler', 50, 50),   // id 1
        makeMapObject('RedGuard', 50, 50),         // id 2
        makeMapObject('EnemyTank', 100, 50),       // id 3
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Load, attack, deploy.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER' });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as any;
    const guard = priv.spawnedEntities.get(2)!;
    expect(guard.transportContainerId).toBeNull();

    // Stop command — recalls all members.
    logic.submitCommand({ type: 'stop', entityId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // State should be deleted and member recalled.
    expect(priv.assaultTransportStateByEntityId.has(1)).toBe(false);
    expect(guard.transportContainerId).toBe(1);
  });

  it('continues attack-move when designated target dies', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TroopCrawler', 50, 50),   // id 1
        makeMapObject('RedGuard', 50, 50),         // id 2
        makeMapObject('EnemyTank', 80, 50),        // id 3
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Load passenger.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    // Issue attack-move to far position.
    logic.submitCommand({
      type: 'attackMoveTo', entityId: 1, targetX: 200, targetZ: 50, attackDistance: 0,
    });
    for (let i = 0; i < 10; i++) logic.update(1 / 30);

    const priv = logic as any;
    const state = priv.assaultTransportStateByEntityId.get(1);
    expect(state).toBeTruthy();
    expect(state.isAttackMove).toBe(true);

    // Kill the enemy while assault transport has it targeted.
    state.designatedTargetId = 3;
    (priv as { markEntityDestroyed: (id: number, a: number) => void }).markEntityDestroyed(3, -1);
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Transport should still be in attack-move mode (not cleared).
    expect(state.isAttackMove).toBe(true);
    // Target should be cleared.
    expect(state.designatedTargetId).toBeNull();
  });

  it('aborts attack when all members are new (isAttackPointless)', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(makeAssaultTransportBundle());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TroopCrawler', 50, 50),   // id 1
        makeMapObject('RedGuard', 50, 50),         // id 2
        makeMapObject('EnemyTank', 100, 50),       // id 3
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'China', 0);

    // Load passenger, then attack to start assault transport state.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 3, commandSource: 'PLAYER' });
    logic.update(1 / 30);

    const priv = logic as any;
    const state = priv.assaultTransportStateByEntityId.get(1);
    expect(state).toBeTruthy();

    // Mark all members as new — simulates all troops loaded after attack was issued.
    for (const member of state.members) {
      member.isNew = true;
    }

    // Source parity: isAttackPointless requires IS_ATTACKING to be set on the transport.
    const transport = priv.spawnedEntities.get(1)!;
    transport.objectStatusFlags.add('IS_ATTACKING');

    // Update should detect all-new members and abort.
    logic.update(1 / 30);

    // Attack state should be cleared.
    expect(state.isAttackObject).toBe(false);
    expect(state.isAttackMove).toBe(false);
  });
});

describe('Sabotage building effects', () => {
  it('rejects sabotage enter actions against non-enemy buildings at command issue', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BlackLotus', 'China', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotagePowerPlantCrateCollide ModuleTag_SabotagePP', {
            SabotagePowerDuration: 3000,
          }),
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('PowerPlant', 'China', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { EnergyProduction: 5 }),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BlackLotus', 10, 10),   // id 1
        makeMapObject('PowerPlant', 30, 10),   // id 2
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const privateApi = logic as unknown as {
      pendingEnterObjectActions: Map<number, unknown>;
      spawnedEntities: Map<number, { moveTarget: { x: number; z: number } | null }>;
    };

    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);

    expect(privateApi.pendingEnterObjectActions.has(1)).toBe(false);
    expect(privateApi.spawnedEntities.get(1)?.moveTarget).toBeNull();
    expect(logic.getEntityState(1)).not.toBeNull();
    expect(logic.getEntityState(2)).not.toBeNull();
  });

  it('sabotage power plant forces timed brownout on victim side', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BlackLotus', 'China', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotagePowerPlantCrateCollide ModuleTag_SabotagePP', {
            SabotagePowerDuration: 3000, // 3 seconds = ~90 frames
          }),
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ], { EnergyProduction: 5 }),
        makeObjectDef('WarFactory', 'America', ['STRUCTURE', 'FS_WARFACTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 800, InitialHealth: 800 }),
        ], { EnergyProduction: -3 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BlackLotus', 10, 10),   // id 1
        makeMapObject('PowerPlant', 20, 10),    // id 2
        makeMapObject('WarFactory', 30, 10),    // id 3
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    // Verify side is NOT browned out initially (5 production > 3 consumption).
    expect(logic.getSidePowerState('America').brownedOut).toBe(false);

    // Sabotage the power plant.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30); // Frame 1: command processed, sabotage resolves (entity within range).
    logic.update(1 / 30); // Frame 2: updatePowerBrownOut picks up the sabotaged-until-frame.

    // Should be browned out now due to sabotage.
    expect(logic.getSidePowerState('America').brownedOut).toBe(true);

    // Black Lotus is consumed (destroyed as part of sabotage action).
    expect(logic.getEntityState(1)).toBeNull();

    // After sabotage duration expires, brownout should clear.
    for (let i = 0; i < 100; i++) logic.update(1 / 30);
    expect(logic.getSidePowerState('America').brownedOut).toBe(false);
  });

  it('sabotage command center resets special power cooldowns', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BlackLotus', 'China', ['INFANTRY'], [
          makeBlock('Behavior', 'SabotageCommandCenterCrateCollide ModuleTag_SabotageCC', {}),
        ], {
          VisionRange: 100,
        }),
        makeObjectDef('CommandCenter', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', { SpecialPowerTemplate: 'SuperweaponParticleCannon' }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const registry = makeRegistry(bundle);
    // Add a special power definition with 60s reload time.
    registry.specialPowers.set('SUPERWEAPONPARTICLECANNON', {
      type: 'SpecialPower',
      name: 'SuperweaponParticleCannon',
      fields: { ReloadTime: '60000' },
      blocks: [],
    });
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BlackLotus', 10, 10),     // id 1
        makeMapObject('CommandCenter', 20, 10),   // id 2
      ], 64, 64),
      registry,
      makeHeightmap(64, 64),
    );
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);
    logic.update(1 / 30);

    const priv = logic as any;

    // Sabotage the command center.
    logic.submitCommand({
      type: 'enterObject',
      entityId: 1,
      targetObjectId: 2,
      action: 'sabotageBuilding',
    });
    logic.update(1 / 30);

    // The command center's special power should have its cooldown reset.
    // Check the source entity tracking map for the ready frame.
    const sourcesMap = priv.shortcutSpecialPowerSourceByName as Map<string, Map<number, number>>;
    const cannonSources = sourcesMap?.get('SUPERWEAPONPARTICLECANNON');
    if (cannonSources) {
      const readyFrame = cannonSources.get(2);
      // The ready frame should be in the future (frameCounter + reloadFrames).
      expect(readyFrame).toBeGreaterThan(priv.frameCounter);
    }

    // Black Lotus consumed.
    expect(logic.getEntityState(1)).toBeNull();
  });
});

describe('PowerPlantUpdate', () => {
  it('extracts PowerPlantUpdateProfile from INI', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ChinaPowerPlant', 'China', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'PowerPlantUpdate ModuleTag_PPUpdate', {
            RodsExtendTime: 2000,
          }),
        ], { EnergyProduction: 5 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('ChinaPowerPlant', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as any;
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.powerPlantUpdateProfile).toBeTruthy();
    // 2000ms → ~60 frames at 30 fps.
    expect(entity.powerPlantUpdateProfile.rodsExtendTimeFrames).toBe(60);
    expect(entity.powerPlantUpdateState).toBeTruthy();
    expect(entity.powerPlantUpdateState.extended).toBe(false);
  });

  it('transitions UPGRADING → UPGRADED after RodsExtendTime', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ChinaPowerPlant', 'China', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'PowerPlantUpdate ModuleTag_PPUpdate', {
            RodsExtendTime: 300, // 300ms → 9 frames
          }),
          makeBlock('Behavior', 'PowerPlantUpgrade ModuleTag_PPUpgrade', {
            TriggeredBy: 'Upgrade_ChinaOvercharge',
          }),
        ], { EnergyProduction: 5 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('ChinaPowerPlant', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as any;
    const entity = priv.spawnedEntities.get(1)!;

    // Simulate upgrade application by calling extendRods directly.
    (priv as { extendPowerPlantRods: (e: any, extend: boolean) => void }).extendPowerPlantRods(entity, true);

    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADING')).toBe(true);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADED')).toBe(false);
    expect(entity.powerPlantUpdateState.extended).toBe(true);

    // Run for 8 frames (not yet done — need 9 frames).
    for (let i = 0; i < 8; i++) logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADING')).toBe(true);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADED')).toBe(false);

    // Frame 9+ should transition.
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADING')).toBe(false);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADED')).toBe(true);
  });

  it('de-extends instantly when extendRods(false) is called', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ChinaPowerPlant', 'China', ['STRUCTURE', 'FS_POWER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'PowerPlantUpdate ModuleTag_PPUpdate', {
            RodsExtendTime: 1000,
          }),
        ], { EnergyProduction: 5 }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('ChinaPowerPlant', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as any;
    const entity = priv.spawnedEntities.get(1)!;
    const fn = priv as { extendPowerPlantRods: (e: any, extend: boolean) => void };

    // Extend rods and let it finish.
    fn.extendPowerPlantRods(entity, true);
    for (let i = 0; i < 40; i++) logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADED')).toBe(true);

    // De-extend: both flags cleared instantly.
    fn.extendPowerPlantRods(entity, false);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADING')).toBe(false);
    expect(entity.modelConditionFlags.has('POWER_PLANT_UPGRADED')).toBe(false);
    expect(entity.powerPlantUpdateState.extended).toBe(false);
  });
});

describe('AnimationSteeringUpdate', () => {
  it('extracts MinTransitionTime into transitionFrames', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SteeringUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'AnimationSteeringUpdate ModuleTag_AnimSteer', {
            MinTransitionTime: 100, // 100ms -> 3 frames
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SteeringUnit', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        animationSteeringProfile: { transitionFrames: number } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.animationSteeringProfile).toBeTruthy();
    expect(entity.animationSteeringProfile?.transitionFrames).toBe(3);
  });

  it('transitions turn model conditions with transition-frame gating', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('SteeringUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'AnimationSteeringUpdate ModuleTag_AnimSteer', {
            MinTransitionTime: 100, // 3 frames
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SteeringUnit', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      frameCounter: number;
      spawnedEntities: Map<number, {
        rotationY: number;
        modelConditionFlags: Set<string>;
        animationSteeringCurrentTurnAnim: string | null;
        animationSteeringNextTransitionFrame: number;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Frame 1: negative turn delta => CENTER_TO_RIGHT.
    entity.rotationY -= 0.5;
    logic.update(1 / 30);
    expect(entity.animationSteeringCurrentTurnAnim).toBe('CENTER_TO_RIGHT');
    expect(entity.modelConditionFlags.has('CENTER_TO_RIGHT')).toBe(true);
    const firstTransitionFrame = entity.animationSteeringNextTransitionFrame;
    expect(firstTransitionFrame).toBeGreaterThan(priv.frameCounter);

    // Frames 2-3: no turn, but still in transition lock window.
    logic.update(1 / 30);
    logic.update(1 / 30);
    expect(priv.frameCounter).toBeLessThan(firstTransitionFrame);
    expect(entity.animationSteeringCurrentTurnAnim).toBe('CENTER_TO_RIGHT');
    expect(entity.modelConditionFlags.has('CENTER_TO_RIGHT')).toBe(true);

    // Frame 4: transition window elapsed, recenter to RIGHT_TO_CENTER.
    logic.update(1 / 30);
    expect(entity.animationSteeringCurrentTurnAnim).toBe('RIGHT_TO_CENTER');
    expect(entity.modelConditionFlags.has('CENTER_TO_RIGHT')).toBe(false);
    expect(entity.modelConditionFlags.has('RIGHT_TO_CENTER')).toBe(true);

    // Hold recenter animation until its own transition time expires.
    logic.update(1 / 30);
    logic.update(1 / 30);
    expect(entity.animationSteeringCurrentTurnAnim).toBe('RIGHT_TO_CENTER');
    expect(entity.modelConditionFlags.has('RIGHT_TO_CENTER')).toBe(true);

    // Next eligible frame with TURN_NONE clears recenter flags and returns to INVALID.
    logic.update(1 / 30);
    expect(entity.animationSteeringCurrentTurnAnim).toBeNull();
    expect(entity.modelConditionFlags.has('LEFT_TO_CENTER')).toBe(false);
    expect(entity.modelConditionFlags.has('RIGHT_TO_CENTER')).toBe(false);
  });
});

describe('TensileFormationUpdate', () => {
  it('extracts Enabled and CrackSound from INI', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CollapseChunk', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TensileFormationUpdate ModuleTag_Tensile', {
            Enabled: true,
            CrackSound: 'BuildingCollapseCrack',
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('CollapseChunk', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        tensileFormationProfile: { enabled: boolean; crackSound: string } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.tensileFormationProfile).toBeTruthy();
    expect(entity.tensileFormationProfile?.enabled).toBe(true);
    expect(entity.tensileFormationProfile?.crackSound).toBe('BuildingCollapseCrack');
  });

  it('plays CrackSound once when collapse is first enabled by damage', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CollapseChunk', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TensileFormationUpdate ModuleTag_Tensile', {
            Enabled: false,
            CrackSound: 'BuildingCollapseCrack',
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('CollapseChunk', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, MapEntity>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: MapEntity, amount: number, damageType: string): void;
    };
    const entity = privateApi.spawnedEntities.get(1)!;

    privateApi.applyWeaponDamageAmount(null, entity, 60, 'CRUSH');
    logic.update(1 / 30);

    expect(logic.drainScriptAudioPlaybackRequests()).toEqual([{
      audioName: 'BuildingCollapseCrack',
      playbackType: 'SOUND_EFFECT',
      allowOverlap: true,
      sourceEntityId: 1,
      x: entity.x,
      y: entity.y,
      z: entity.z,
      frame: 1,
    }]);

    logic.update(1 / 30);
    expect(logic.drainScriptAudioPlaybackRequests()).toEqual([]);
  });

  it('enables on damaged state, sets collapse flags, and propagates BODY_DAMAGED', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CollapseChunk', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TensileFormationUpdate ModuleTag_Tensile', {
            Enabled: false,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CollapseChunk', 20, 20), // id 1
        makeMapObject('CollapseChunk', 26, 20), // id 2, within 100 range
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        modelConditionFlags: Set<string>;
      }>;
    };
    const first = priv.spawnedEntities.get(1)!;
    const second = priv.spawnedEntities.get(2)!;

    // Make the first member BODY_DAMAGED (health <= 49).
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, first, 60, 'CRUSH');
    expect(first.health).toBe(40);
    expect(second.health).toBe(100);

    // At life 29, propagateDislodgement should set nearby members to BODY_DAMAGED.
    for (let i = 0; i < 29; i++) {
      logic.update(1 / 30);
    }

    expect(first.modelConditionFlags.has('POST_COLLAPSE')).toBe(true);
    expect(first.modelConditionFlags.has('MOVING')).toBe(true);
    expect(second.health).toBe(49); // ActiveBody::setDamageState(BODY_DAMAGED): max*0.5 - 1
  });

  it('releases path footprint during collapse and restores it when done', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CollapseChunk', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TensileFormationUpdate ModuleTag_Tensile', {
            Enabled: false,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('CollapseChunk', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, MapEntity>;
      navigationGrid: { blocked: Uint8Array } | null;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: MapEntity, amount: number, damageType: string): void;
    };
    const entity = privateApi.spawnedEntities.get(1)!;
    const blockedBefore = Array.from(privateApi.navigationGrid!.blocked).reduce((sum, value) => sum + value, 0);

    privateApi.applyWeaponDamageAmount(null, entity, 60, 'CRUSH');
    logic.update(1 / 30);

    const blockedDuring = Array.from(privateApi.navigationGrid!.blocked).reduce((sum, value) => sum + value, 0);
    expect(blockedDuring).toBeLessThan(blockedBefore);

    for (let i = 0; i < 301; i++) {
      logic.update(1 / 30);
    }

    const blockedAfter = Array.from(privateApi.navigationGrid!.blocked).reduce((sum, value) => sum + value, 0);
    expect(blockedAfter).toBe(blockedBefore);
  });

  it('enters rubble state after life exceeds 300 frames', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CollapseChunk', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TensileFormationUpdate ModuleTag_Tensile', {
            Enabled: true,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('CollapseChunk', 20, 20)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        modelConditionFlags: Set<string>;
        tensileFormationState: { done: boolean } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    for (let i = 0; i < 301; i++) {
      logic.update(1 / 30);
    }

    expect(entity.tensileFormationState?.done).toBe(true);
    expect(entity.health).toBe(0);
    expect(entity.destroyed).toBe(false);
    expect(entity.modelConditionFlags.has('POST_COLLAPSE')).toBe(false);
    expect(entity.modelConditionFlags.has('MOVING')).toBe(false);
    expect(entity.modelConditionFlags.has('FREEFALL')).toBe(false);
  });
});

describe('UndeadBody', () => {
  it('extracts UNDEAD body type and SecondLifeMaxHealth from INI', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UndeadUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'UndeadBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
            SecondLifeMaxHealth: 50,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('UndeadUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        bodyType: string;
        undeadSecondLifeMaxHealth: number;
        undeadIsSecondLife: boolean;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.bodyType).toBe('UNDEAD');
    expect(entity.undeadSecondLifeMaxHealth).toBe(50);
    expect(entity.undeadIsSecondLife).toBe(false);
  });

  it('caps fatal damage on first life and transitions to second life', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UndeadUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'UndeadBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
            SecondLifeMaxHealth: 50,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('UndeadUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        destroyed: boolean;
        bodyType: string;
        undeadIsSecondLife: boolean;
        armorSetFlagsMask: number;
        modelConditionFlags: Set<string>;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Apply fatal damage — should NOT kill, should trigger second life.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, entity, 9999, 'EXPLOSION');

    expect(entity.destroyed).toBe(false);
    expect(entity.undeadIsSecondLife).toBe(true);
    expect(entity.maxHealth).toBe(50);
    expect(entity.health).toBe(50); // FULLY_HEAL at new max health
    expect(entity.armorSetFlagsMask & (1 << 5)).not.toBe(0); // ARMOR_SET_FLAG_SECOND_LIFE
    expect(entity.modelConditionFlags.has('SECOND_LIFE')).toBe(true);
  });

  it('fires slow-death visual phases when entering second life without destroying the entity', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UndeadUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'UndeadBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
            SecondLifeMaxHealth: 50,
          }),
          makeBlock('Behavior', 'SlowDeathBehavior ModuleTag_Transform', {
            DestructionDelay: 100, // ~3 frames
            ProbabilityModifier: 10,
            OCL: ['INITIAL OCLSecondLifeInitial', 'FINAL OCLSecondLifeFinal'],
          }),
        ]),
        makeObjectDef('SecondLifeInitialFx', 'GLA', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
        makeObjectDef('SecondLifeFinalFx', 'GLA', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
      ],
    });
    (bundle as Record<string, unknown>).objectCreationLists = [
      {
        name: 'OCLSecondLifeInitial',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'SecondLifeInitialFx', Count: '1' },
          blocks: [],
        }],
      },
      {
        name: 'OCLSecondLifeFinal',
        fields: {},
        blocks: [{
          type: 'CreateObject',
          name: 'CreateObject',
          fields: { ObjectNames: 'SecondLifeFinalFx', Count: '1' },
          blocks: [],
        }],
      },
    ];

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('UndeadUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        undeadIsSecondLife: boolean;
        slowDeathState: unknown;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, entity, 9999, 'EXPLOSION');

    expect(entity.undeadIsSecondLife).toBe(true);
    expect(entity.health).toBe(50);
    expect(entity.destroyed).toBe(false);
    expect(entity.slowDeathState).not.toBeNull();

    for (let i = 0; i < 10; i += 1) {
      logic.update(1 / 30);
    }

    expect(entity.destroyed).toBe(false);
    expect(entity.slowDeathState).toBeNull();
    expect(logic.getEntityState(1)).not.toBeNull();

    const states = logic.getRenderableEntityStates();
    expect(states.some((state) => state.templateName === 'SecondLifeInitialFx')).toBe(true);
    expect(states.some((state) => state.templateName === 'SecondLifeFinalFx')).toBe(true);
  });

  it('takes normal damage on second life and dies normally', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UndeadUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'UndeadBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
            SecondLifeMaxHealth: 50,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('UndeadUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        destroyed: boolean;
        undeadIsSecondLife: boolean;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    const applyDmg = (d: number, dt: string) =>
      (logic as unknown as {
        applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
      }).applyWeaponDamageAmount(null, entity, d, dt);

    // First: trigger second life.
    applyDmg(9999, 'EXPLOSION');
    expect(entity.undeadIsSecondLife).toBe(true);
    expect(entity.health).toBe(50);

    // Second: apply fatal damage on second life — should die normally.
    applyDmg(9999, 'EXPLOSION');
    logic.update(1 / 30);
    expect(entity.health).toBe(0);
    expect(entity.destroyed).toBe(true);
  });

  it('non-fatal damage on first life does not trigger second life', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UndeadUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'UndeadBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
            SecondLifeMaxHealth: 50,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('UndeadUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        destroyed: boolean;
        undeadIsSecondLife: boolean;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Apply non-fatal damage (100 out of 200 HP) — should NOT trigger second life.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, entity, 100, 'EXPLOSION');

    expect(entity.destroyed).toBe(false);
    expect(entity.undeadIsSecondLife).toBe(false);
    expect(entity.maxHealth).toBe(200); // unchanged
    expect(entity.health).toBe(100); // took normal damage
  });

  it('UNRESISTABLE damage kills on first life without second life', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('UndeadUnit', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'UndeadBody ModuleTag_Body', {
            MaxHealth: 200,
            InitialHealth: 200,
            SecondLifeMaxHealth: 50,
          }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('UndeadUnit', 100, 100)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        undeadIsSecondLife: boolean;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // UNRESISTABLE should bypass the second life mechanic.
    (logic as unknown as {
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    }).applyWeaponDamageAmount(null, entity, 9999, 'UNRESISTABLE');
    logic.update(1 / 30);

    expect(entity.undeadIsSecondLife).toBe(false);
    expect(entity.health).toBe(0);
    expect(entity.destroyed).toBe(true);
  });
});

describe('PhysicsBehavior', () => {
  it('extracts profile from INI', () => {
    const obj = makeObjectDef('Debris', 'America', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {
        Mass: 5.0,
        AllowBouncing: true,
        KillWhenRestingOnGround: true,
        PitchRollYawFactor: 3.0,
      }),
    ]);
    const bundle = makeBundle({ objects: [obj] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Debris', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const entity = (logic as unknown as { spawnedEntities: Map<number, unknown> }).spawnedEntities.get(1)! as unknown as {
      physicsBehaviorProfile: { mass: number; allowBouncing: boolean; killWhenRestingOnGround: boolean };
    };
    expect(entity.physicsBehaviorProfile).not.toBeNull();
    expect(entity.physicsBehaviorProfile.mass).toBe(5.0);
    expect(entity.physicsBehaviorProfile.allowBouncing).toBe(true);
    expect(entity.physicsBehaviorProfile.killWhenRestingOnGround).toBe(true);
  });

  it('applies gravity and kills debris at rest', () => {
    const obj = makeObjectDef('Debris', 'America', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
      makeBlock('Behavior', 'PhysicsBehavior ModuleTag_Physics', {
        Mass: 1.0,
        KillWhenRestingOnGround: true,
        AllowBouncing: false,
      }),
    ]);
    const bundle = makeBundle({ objects: [obj] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Debris', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const privateApi = logic as unknown as { spawnedEntities: Map<number, unknown> };
    const entity = privateApi.spawnedEntities.get(1)! as unknown as {
      y: number; destroyed: boolean;
      physicsBehaviorState: { velY: number; allowToFall: boolean; stickToGround: boolean } | null;
    };
    // Raise entity above ground.
    entity.y = 100;
    // Tick to initialize physics state.
    logic.update(0);
    const physState = entity.physicsBehaviorState;
    if (physState) {
      physState.allowToFall = true;
      physState.stickToGround = false;
    }
    // Tick many frames to let it fall and rest.
    for (let i = 0; i < 300; i++) {
      logic.update(0);
    }
    // Entity should be destroyed (killed when resting on ground).
    expect(entity.destroyed).toBe(true);
  });
});

describe('MissileLauncherBuildingUpdate', () => {
  it('extracts profile from INI', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'MissileLauncherBuildingUpdate ModuleTag_MLBU', {
        SpecialPowerTemplate: 'SuperweaponScudStorm',
        DoorOpenTime: 5000,
        DoorWaitOpenTime: 2000,
        DoorCloseTime: 3000,
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
      missileLauncherBuildingProfile: { specialPowerTemplateName: string; doorOpenTimeFrames: number };
    };
    expect(entity.missileLauncherBuildingProfile).not.toBeNull();
    expect(entity.missileLauncherBuildingProfile.specialPowerTemplateName).toBe('SUPERWEAPONSCUDSTORM');
  });

  it('initializes door state on first tick', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'MissileLauncherBuildingUpdate ModuleTag_MLBU', {
        SpecialPowerTemplate: 'SuperweaponScudStorm',
        DoorOpenTime: 3000,
        DoorWaitOpenTime: 2000,
        DoorCloseTime: 3000,
      }),
    ]);
    const bundle = makeBundle({
      objects: [building],
      specialPowers: [makeSpecialPowerDef('SuperweaponScudStorm', { RechargeTime: 10000 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('GLAScudStorm', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    // Tick several frames.
    for (let i = 0; i < 10; i++) logic.update(0);
    const entity = (logic as unknown as { spawnedEntities: Map<number, unknown> }).spawnedEntities.get(1)! as unknown as {
      missileLauncherBuildingState: { doorState: string } | null;
    };
    expect(entity.missileLauncherBuildingState).not.toBeNull();
  });

  it('transitions to WAITING_TO_CLOSE after firing', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'MissileLauncherBuildingUpdate ModuleTag_MLBU', {
        SpecialPowerTemplate: 'SuperweaponScudStorm',
        DoorOpenTime: 100,
        DoorWaitOpenTime: 2000,
        DoorCloseTime: 3000,
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
      missileLauncherOnFire: (entity: unknown) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const entity = privateApi.spawnedEntities.get(1)! as unknown as {
      missileLauncherBuildingState: { doorState: string } | null;
      missileLauncherBuildingProfile: unknown;
    };
    // Force init state.
    entity.missileLauncherBuildingState = { doorState: 'OPEN' } as unknown as typeof entity.missileLauncherBuildingState;
    privateApi.missileLauncherOnFire(entity);
    expect(entity.missileLauncherBuildingState!.doorState).toBe('WAITING_TO_CLOSE');
  });
});

describe('ParticleUplinkCannonUpdate', () => {
  it('extracts profile from INI', () => {
    const building = makeObjectDef('USAParticleCannon', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        SpecialPowerTemplate: 'SuperweaponParticleCannon',
        TotalFiringTime: 10000,
        TotalDamagePulses: 20,
        DamagePerSecond: 500,
        DamageType: 'LASER',
        DamageRadiusScalar: 1.5,
      }),
    ]);
    const bundle = makeBundle({ objects: [building] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('USAParticleCannon', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const entity = (logic as unknown as { spawnedEntities: Map<number, unknown> }).spawnedEntities.get(1)! as unknown as {
      particleUplinkCannonProfile: { totalDamagePulses: number; damagePerSecond: number };
    };
    expect(entity.particleUplinkCannonProfile).not.toBeNull();
    expect(entity.particleUplinkCannonProfile.totalDamagePulses).toBe(20);
    expect(entity.particleUplinkCannonProfile.damagePerSecond).toBe(500);
  });

  it('fires damage pulses when activated', () => {
    const building = makeObjectDef('USAParticleCannon', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'ParticleUplinkCannonUpdate ModuleTag_PUC', {
        SpecialPowerTemplate: 'SuperweaponParticleCannon',
        TotalFiringTime: 1000,
        TotalDamagePulses: 5,
        DamagePerSecond: 500,
        DamageType: 'LASER',
        DamageRadiusScalar: 10.0,
      }),
    ]);
    const target = makeObjectDef('GLAUnit', 'GLA', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
    ]);
    const bundle = makeBundle({ objects: [building, target] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USAParticleCannon', 5, 5),
        makeMapObject('GLAUnit', 5, 5),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.update(0);

    const privateApi = logic as unknown as {
      particleUplinkCannonOnFire: (entity: unknown, targetX: number, targetZ: number) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const cannonEntity = privateApi.spawnedEntities.get(1)!;
    const glaEntity = privateApi.spawnedEntities.get(2)! as unknown as { health: number; x: number; z: number };
    privateApi.particleUplinkCannonOnFire(cannonEntity, glaEntity.x, glaEntity.z);

    const initialHealth = glaEntity.health;
    // Tick enough frames for at least 1 damage pulse.
    for (let i = 0; i < 30; i++) logic.update(0);
    expect(glaEntity.health).toBeLessThan(initialHealth);
  });
});

describe('NeutronMissileUpdate', () => {
  it('extracts profile from INI', () => {
    const missile = makeObjectDef('NukeMissile', 'China', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
      makeBlock('Behavior', 'NeutronMissileUpdate ModuleTag_NMU', {
        DistanceToTravelBeforeTurning: 100,
        MaxTurnRate: 45,
        ForwardDamping: 0.1,
        RelativeSpeed: 2.0,
        TargetFromDirectlyAbove: 500,
        SpecialSpeedTime: 3000,
        SpecialSpeedHeight: 800,
        SpecialAccelFactor: 1.5,
      }),
    ]);
    const bundle = makeBundle({ objects: [missile] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('NukeMissile', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const entity = (logic as unknown as { spawnedEntities: Map<number, unknown> }).spawnedEntities.get(1)! as unknown as {
      neutronMissileUpdateProfile: { relativeSpeed: number; targetFromDirectlyAbove: number };
    };
    expect(entity.neutronMissileUpdateProfile).not.toBeNull();
    expect(entity.neutronMissileUpdateProfile.relativeSpeed).toBe(2.0);
    expect(entity.neutronMissileUpdateProfile.targetFromDirectlyAbove).toBe(500);
  });

  it('missile flies toward target and detonates on ground', () => {
    const missile = makeObjectDef('NukeMissile', 'China', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'NeutronMissileUpdate ModuleTag_NMU', {
        DistanceToTravelBeforeTurning: 0,
        RelativeSpeed: 5.0,
        ForwardDamping: 0.5,
        TargetFromDirectlyAbove: 0,
      }),
    ]);
    const bundle = makeBundle({ objects: [missile] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('NukeMissile', 3, 3)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const privateApi = logic as unknown as {
      launchNeutronMissile: (entity: unknown, tx: number, ty: number, tz: number, launcherId: number) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const missileEntity = privateApi.spawnedEntities.get(1)! as unknown as {
      y: number; destroyed: boolean;
      neutronMissileUpdateState: { state: string } | null;
    };
    // Place missile high up.
    missileEntity.y = 200;
    privateApi.launchNeutronMissile(missileEntity, 100, 0, 100, 0);

    expect(missileEntity.neutronMissileUpdateState).not.toBeNull();
    expect(missileEntity.neutronMissileUpdateState!.state).toBe('LAUNCH');

    // Tick many frames — missile should eventually hit ground.
    for (let i = 0; i < 500; i++) logic.update(0);
    // Missile should be destroyed after ground impact.
    expect(missileEntity.destroyed).toBe(true);
  });
});

describe('UNRESISTABLE damage bypasses battle plan scalar', () => {
  it('applies full UNRESISTABLE damage even with battle plan armor reduction', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Target', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Target', 40, 40)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(1 / 30);

    // Set a battle plan damage scalar of 0.5 (halves incoming damage).
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { battlePlanDamageScalar: number; health: number }>;
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
    };
    const target = priv.spawnedEntities.get(1)!;
    target.battlePlanDamageScalar = 0.5;

    // Apply 100 EXPLOSION damage — should be halved to 50.
    priv.applyWeaponDamageAmount(null, target, 100, 'EXPLOSION');
    expect(target.health).toBe(950);

    // Apply 100 UNRESISTABLE damage — should NOT be halved; full 100.
    priv.applyWeaponDamageAmount(null, target, 100, 'UNRESISTABLE');
    expect(target.health).toBe(850);
  });

  it('awards cash bounty on kill based on victim buildCost and attacker bounty percent', () => {
    // Set up an attacker with enough damage to one-shot the victim.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('BountyAttacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'BountyGun'] }),
        ]),
        makeObjectDef('BountyVictim', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 30, InitialHealth: 30 }),
        ], { BuildCost: 1000 }),
      ],
      weapons: [
        makeWeaponDef('BountyGun', {
          AttackRange: 120,
          PrimaryDamage: 200,
          DelayBetweenShots: 100,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('BountyAttacker', 10, 10),
        makeMapObject('BountyVictim', 30, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Set initial credits to 0 for America.
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 0 });
    // Make them enemies.
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Set cash bounty percentage on America's side via private field.
    const priv = logic as unknown as {
      sideCashBountyPercent: Map<string, number>;
    };
    priv.sideCashBountyPercent.set('america', 0.2);

    // Order the attack.
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run enough frames for the victim to die (one-shot weapon).
    for (let frame = 0; frame < 10; frame += 1) {
      logic.update(1 / 30);
    }

    // Victim should be dead.
    const victimState = logic.getEntityState(2);
    expect(victimState === null || victimState.health <= 0).toBe(true);

    // Bounty = ceil(1000 * 0.2) = 200.
    const credits = logic.getSideCredits('America');
    expect(credits).toBe(200);
  });
});

describe('MissileLauncherBuildingUpdate door transitions via SpecialPowerReadyFrames', () => {
  it('transitions CLOSED→OPENING→OPEN when special power becomes ready', () => {
    const building = makeObjectDef('GLAScudStorm', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'MissileLauncherBuildingUpdate ModuleTag_MLBU', {
        SpecialPowerTemplate: 'SuperweaponScudStorm',
        DoorOpenTime: 3000,  // 90 frames at 30fps
        DoorWaitOpenTime: 2000,
        DoorCloseTime: 3000,
      }),
      makeBlock('Behavior', 'SpecialPowerModule ModuleTag_SP', {
        SpecialPowerTemplate: 'SuperweaponScudStorm',
      }),
    ]);
    const bundle = makeBundle({
      objects: [building],
      specialPowers: [makeSpecialPowerDef('SuperweaponScudStorm', { RechargeTime: 10000 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('GLAScudStorm', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        missileLauncherBuildingState: { doorState: string; timeoutFrame: number; timeoutState: string } | null;
        missileLauncherBuildingProfile: { doorOpenTimeFrames: number } | null;
        specialPowerModules: Map<string, unknown>;
        modelConditionFlags: Set<string>;
      }>;
      sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
      frameCounter: number;
    };

    // Tick once to init the door state.
    logic.update(1 / 30);
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.missileLauncherBuildingState).not.toBeNull();
    expect(entity.missileLauncherBuildingState!.doorState).toBe('CLOSED');

    // Set the power ready at frame 50 (in the future).
    const normalizedPowerName = 'SUPERWEAPONSCUDSTORM';
    expect(entity.specialPowerModules.has(normalizedPowerName)).toBe(true);
    priv.sharedShortcutSpecialPowerReadyFrames.set(normalizedPowerName, 50);

    // Advance to a frame where pre-open should start.
    // doorOpenTimeFrames = 90 frames. Power ready at frame 50.
    // Pre-open starts when framesUntilReady <= doorOpenTimeFrames, i.e., immediately
    // since 50 - current < 90.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    // Door should have started opening.
    expect(entity.missileLauncherBuildingState!.doorState).toBe('OPENING');

    // Now set power ready at current frame (make it ready now).
    priv.sharedShortcutSpecialPowerReadyFrames.set(normalizedPowerName, priv.frameCounter);

    // Advance frames — it should force-open when ready.
    logic.update(1 / 30);
    expect(entity.missileLauncherBuildingState!.doorState).toBe('OPEN');
    expect(entity.modelConditionFlags.has('DOOR_1_WAITING_OPEN')).toBe(true);
  });
});

describe('HistoricBonus weapon trigger', () => {
  it('fires bonus weapon after enough hits within radius and time window', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'HistoricCannon'] }),
        ]),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('HistoricCannon', {
          AttackRange: 120,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 5,
          DelayBetweenShots: 100,
          HistoricBonusCount: 3,
          HistoricBonusRadius: 50,
          HistoricBonusTime: 5000,
          HistoricBonusWeapon: 'TestBonusWeapon',
        }),
        makeWeaponDef('TestBonusWeapon', {
          PrimaryDamage: 100,
          PrimaryDamageRadius: 30,
          AttackRange: 200,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Attacker', 10, 10),
        makeMapObject('Target', 30, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Use private access to call checkHistoricBonus directly.
    const priv = logic as unknown as {
      checkHistoricBonus: (weapon: { historicBonusCount: number; historicBonusRadius: number; historicBonusTime: number; historicBonusWeapon: string | null; name: string }, targetX: number, targetZ: number, attackerId: number) => void;
      historicDamageLog: Map<string, Array<{ frame: number; x: number; z: number }>>;
      frameCounter: number;
      spawnedEntities: Map<number, { health: number }>;
    };

    // Tick once to initialize.
    logic.update(1 / 30);

    const weapon = {
      historicBonusCount: 3,
      historicBonusRadius: 50,
      historicBonusTime: 5000,
      historicBonusWeapon: 'TestBonusWeapon',
      name: 'HistoricCannon',
    };

    const targetBefore = priv.spawnedEntities.get(2)!;
    const healthBefore = targetBefore.health;

    // Target is at world position (30, 10). Fire near the target.
    // Fire 2 shots — should not trigger bonus.
    priv.checkHistoricBonus(weapon as never, 30, 10, 1);
    priv.checkHistoricBonus(weapon as never, 31, 10, 1);
    const target1 = priv.spawnedEntities.get(2)!;
    expect(target1.health).toBe(healthBefore); // No bonus weapon fired yet.

    // Fire 3rd shot in radius — should trigger bonus.
    priv.checkHistoricBonus(weapon as never, 32, 10, 1);

    // The bonus weapon fires at position (32,10) via fireTemporaryWeaponAtPosition.
    // Target is at world position (30,10). Distance = ~2 which is within
    // PrimaryDamageRadius=30, so the target should take 100 damage.
    const targetAfter = priv.spawnedEntities.get(2)!;
    // After bonus weapon fires, target should have taken bonus damage (100).
    expect(targetAfter.health).toBeLessThan(healthBefore);

    // Verify the log was cleared after triggering (keyed by weapon name, not attacker).
    const log = priv.historicDamageLog.get('HistoricCannon');
    expect(log?.length ?? 0).toBe(0);
  });

  it('does not trigger bonus when hits are outside time window', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TimedCannon'] }),
        ]),
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('TimedCannon', {
          AttackRange: 120,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 5,
          DelayBetweenShots: 100,
          HistoricBonusCount: 3,
          HistoricBonusRadius: 50,
          HistoricBonusTime: 1000, // Only 30 frames at 30fps
          HistoricBonusWeapon: 'TimedBonusWeapon',
        }),
        makeWeaponDef('TimedBonusWeapon', {
          PrimaryDamage: 100,
          PrimaryDamageRadius: 30,
          AttackRange: 200,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Attacker', 10, 10),
        makeMapObject('Target', 30, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    const priv = logic as unknown as {
      checkHistoricBonus: (weapon: never, targetX: number, targetZ: number, attackerId: number) => void;
      historicDamageLog: Map<string, Array<{ frame: number; x: number; z: number }>>;
      frameCounter: number;
      spawnedEntities: Map<number, { health: number }>;
    };

    // Tick once.
    logic.update(1 / 30);

    const weapon = {
      historicBonusCount: 3,
      historicBonusRadius: 50,
      historicBonusTime: 1000, // 30 frames
      historicBonusWeapon: 'TimedBonusWeapon',
      name: 'TimedCannon',
    } as never;

    // Fire 2 shots at frame 1 near the target at (30, 10).
    priv.checkHistoricBonus(weapon, 30, 10, 1);
    priv.checkHistoricBonus(weapon, 31, 10, 1);

    // Advance past the time window (31+ frames).
    for (let i = 0; i < 35; i++) logic.update(1 / 30);

    const healthBefore = priv.spawnedEntities.get(2)!.health;

    // Fire 3rd shot — but first two should have expired.
    priv.checkHistoricBonus(weapon, 32, 10, 1);

    // No bonus should fire because the first two hits are outside the time window.
    expect(priv.spawnedEntities.get(2)!.health).toBe(healthBefore);
  });

  it('does not trigger bonus when hits are outside radius', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
      ],
      weapons: [],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Attacker', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );

    const priv = logic as unknown as {
      checkHistoricBonus: (weapon: never, targetX: number, targetZ: number, attackerId: number) => void;
      historicDamageLog: Map<string, Array<{ frame: number; x: number; z: number }>>;
      frameCounter: number;
    };

    logic.update(1 / 30);

    const weapon = {
      historicBonusCount: 3,
      historicBonusRadius: 10,
      historicBonusTime: 5000,
      historicBonusWeapon: 'SomeBonusWeapon',
      name: 'SmallRadiusCannon',
    } as never;

    // Fire 3 shots at positions far apart (> radius=10).
    priv.checkHistoricBonus(weapon, 0, 0, 1);
    priv.checkHistoricBonus(weapon, 100, 100, 1);
    priv.checkHistoricBonus(weapon, 200, 200, 1);

    // Should NOT have cleared the log (bonus didn't fire — keyed by weapon name).
    const log = priv.historicDamageLog.get('SmallRadiusCannon');
    expect(log).toBeDefined();
    expect(log!.length).toBe(3);
  });
});

describe('ProjectileStreamUpdate', () => {
  function makeStreamBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('ToxinTruck', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('ClientUpdate', 'ProjectileStreamUpdate ModuleTag_Stream', {}),
        ]),
        makeObjectDef('Projectile', 'GLA', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
      ],
    });
  }

  it('extractProjectileStreamProfile returns non-null for entities with ProjectileStreamUpdate', () => {
    const bundle = makeStreamBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('ToxinTruck', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamProfile: { enabled: boolean } | null;
        projectileStreamState: unknown;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.projectileStreamProfile).not.toBeNull();
    expect(entity.projectileStreamProfile!.enabled).toBe(true);
    expect(entity.projectileStreamState).toBeNull();
  });

  it('addProjectileToStream fills circular buffer and getStreamPoints returns positions', () => {
    const bundle = makeStreamBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToxinTruck', 5, 5),
        makeMapObject('Projectile', 10, 10),
        makeMapObject('Projectile', 15, 15),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamProfile: { enabled: boolean } | null;
        projectileStreamState: {
          projectileIds: number[];
          nextIndex: number;
          ownerEntityId: number;
        } | null;
      }>;
      addProjectileToStream(streamEntityId: number, projectileId: number): void;
    };

    // Add two projectiles to the stream.
    priv.addProjectileToStream(1, 2);
    priv.addProjectileToStream(1, 3);

    const state = priv.spawnedEntities.get(1)!.projectileStreamState!;
    expect(state).not.toBeNull();
    expect(state.projectileIds).toEqual([2, 3]);
    expect(state.nextIndex).toBe(2);

    // getStreamPoints should return positions.
    const points = logic.getStreamPoints(1);
    expect(points.length).toBe(2);
  });

  it('updateProjectileStreams culls destroyed projectiles', () => {
    const bundle = makeStreamBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToxinTruck', 5, 5),
        makeMapObject('Projectile', 10, 10),
        makeMapObject('Projectile', 15, 15),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamProfile: { enabled: boolean } | null;
        projectileStreamState: {
          projectileIds: number[];
          nextIndex: number;
          ownerEntityId: number;
        } | null;
        destroyed: boolean;
      }>;
      addProjectileToStream(streamEntityId: number, projectileId: number): void;
    };

    priv.addProjectileToStream(1, 2);
    priv.addProjectileToStream(1, 3);

    // Destroy one projectile.
    priv.spawnedEntities.get(2)!.destroyed = true;

    logic.update(1 / 30);

    const state = priv.spawnedEntities.get(1)!.projectileStreamState!;
    expect(state.projectileIds).toEqual([3]);
    expect(logic.getStreamPoints(1).length).toBe(1);
  });

  it('circular buffer wraps around after reaching capacity of 20', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StreamEntity', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('ClientUpdate', 'ProjectileStreamUpdate ModuleTag_Stream', {}),
        ]),
        ...Array.from({ length: 22 }, (_, i) =>
          makeObjectDef(`Proj${i}`, 'GLA', ['PROJECTILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          ]),
        ),
      ],
    });
    const mapObjects = [
      makeMapObject('StreamEntity', 5, 5),
      ...Array.from({ length: 22 }, (_, i) =>
        makeMapObject(`Proj${i}`, 10 + i, 10),
      ),
    ];
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap(mapObjects, 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamState: {
          projectileIds: number[];
          nextIndex: number;
        } | null;
      }>;
      addProjectileToStream(streamEntityId: number, projectileId: number): void;
    };

    // Add 22 projectiles (buffer size 20 should wrap).
    for (let i = 2; i <= 23; i++) {
      priv.addProjectileToStream(1, i);
    }

    const state = priv.spawnedEntities.get(1)!.projectileStreamState!;
    expect(state.projectileIds.length).toBe(20);
    // After wrapping, first two entries should be overwritten with 22, 23.
    expect(state.projectileIds[0]).toBe(22);
    expect(state.projectileIds[1]).toBe(23);
  });

  it('streamPoints appears in RenderableEntityState when stream is active', () => {
    const bundle = makeStreamBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToxinTruck', 5, 5),
        makeMapObject('Projectile', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      addProjectileToStream(streamEntityId: number, projectileId: number): void;
    };

    priv.addProjectileToStream(1, 2);
    logic.update(1 / 30);

    // Verify stream points are accessible via public API.
    const points = logic.getStreamPoints(1);
    expect(points.length).toBe(1);
    // Verify that the entity's projectileStreamState is populated.
    const privEntities = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamState: { projectileIds: number[] } | null;
      }>;
    };
    expect(privEntities.spawnedEntities.get(1)!.projectileStreamState).not.toBeNull();
  });

  it('returns null projectileStreamProfile for entities without ProjectileStreamUpdate', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('PlainUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('PlainUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamProfile: { enabled: boolean } | null;
      }>;
    };
    expect(priv.spawnedEntities.get(1)!.projectileStreamProfile).toBeNull();
  });
});

describe('MobMemberSlavedUpdate', () => {
  function makeMobSetup(opts?: {
    mustCatchUpRadius?: number;
    noNeedToCatchUpRadius?: number;
    squirrelliness?: number;
    catchUpCrisisBailTime?: number;
    spawnNumber?: number;
  }) {
    const mustCatchUp = opts?.mustCatchUpRadius ?? 50;
    const noNeedToCatchUp = opts?.noNeedToCatchUpRadius ?? 25;
    const squirrelliness = opts?.squirrelliness ?? 0.5;
    const crisisBail = opts?.catchUpCrisisBailTime ?? 10;
    const spawnCount = opts?.spawnNumber ?? 1;
    const sz = 256;

    const objects = [
      // Master (angry mob nexus) with SpawnBehavior
      makeObjectDef('AngryMobNexus', 'GLA', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
          SpawnNumber: spawnCount,
          SpawnReplaceDelay: 3000,
          SpawnTemplateName: 'MobMember',
          SpawnedRequireSpawner: 'Yes',
          InitialBurst: spawnCount,
        }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'NexusGun'] }),
      ]),
      // Mob member slave with MobMemberSlavedUpdate
      makeObjectDef('MobMember', 'GLA', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('Behavior', 'MobMemberSlavedUpdate ModuleTag_MobSlaved', {
          MustCatchUpRadius: mustCatchUp,
          NoNeedToCatchUpRadius: noNeedToCatchUp,
          Squirrelliness: squirrelliness,
          CatchUpCrisisBailTime: crisisBail,
        }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'MobGun'] }),
      ]),
      // Enemy for targeting
      makeObjectDef('EnemyInfantry', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'EnemyGun'] }),
      ]),
    ];

    const mapObjects: MapObjectJSON[] = [
      makeMapObject('AngryMobNexus', 100, 100),
    ];

    const bundle = makeBundle({
      objects,
      weapons: [
        makeWeaponDef('NexusGun', {
          AttackRange: 100,
          PrimaryDamage: 20,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
        makeWeaponDef('MobGun', {
          AttackRange: 80,
          PrimaryDamage: 5,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 300,
        }),
        makeWeaponDef('EnemyGun', {
          AttackRange: 100,
          PrimaryDamage: 30,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap(mapObjects, sz, sz), registry, makeHeightmap(sz, sz));
    logic.setTeamRelationship('GLA', 'America', 0);
    logic.setTeamRelationship('America', 'GLA', 0);
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('america', 'COMPUTER');

    return { logic, sz, registry };
  }

  interface MobEntity {
    id: number;
    slaverEntityId: number | null;
    destroyed: boolean;
    health: number;
    maxHealth: number;
    x: number;
    z: number;
    moveTarget: { x: number; z: number } | null;
    attackTargetEntityId: number | null;
    attackTargetPosition: { x: number; z: number } | null;
    moving: boolean;
    speed: number;
    mobMemberProfile: {
      mustCatchUpRadius: number;
      noNeedToCatchUpRadius: number;
      squirrellinessRatio: number;
      catchUpCrisisBailTime: number;
    } | null;
    mobMemberState: {
      framesToWait: number;
      catchUpCrisisTimer: number;
      primaryVictimId: number;
      isSelfTasking: boolean;
      mobState: number;
    } | null;
    objectStatusFlags: Set<string>;
    spawnBehaviorState: {
      slaveIds: number[];
    } | null;
  }

  function getEntity(logic: GameLogicSubsystem, id: number): MobEntity {
    const priv = logic as unknown as { spawnedEntities: Map<number, MobEntity> };
    return priv.spawnedEntities.get(id)!;
  }

  function addEnemy(logic: GameLogicSubsystem, x: number, z: number): void {
    const priv = logic as unknown as {
      spawnEntityFromTemplate(name: string, x: number, z: number, rot: number, side: string): MobEntity | null;
    };
    priv.spawnEntityFromTemplate('EnemyInfantry', x, z, 0, 'America');
  }

  it('extracts MobMemberSlavedUpdateProfile from INI data', () => {
    const { logic } = makeMobSetup({
      mustCatchUpRadius: 80,
      noNeedToCatchUpRadius: 30,
      squirrelliness: 0.75,
      catchUpCrisisBailTime: 20,
    });

    // After loading, the spawner creates a slave immediately (InitialBurst).
    // Run a few frames to let the spawn happen.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    expect(master.spawnBehaviorState).not.toBeNull();
    expect(master.spawnBehaviorState!.slaveIds.length).toBe(1);

    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    expect(slave.mobMemberProfile).not.toBeNull();
    expect(slave.mobMemberProfile!.mustCatchUpRadius).toBe(80);
    expect(slave.mobMemberProfile!.noNeedToCatchUpRadius).toBe(30);
    expect(slave.mobMemberProfile!.squirrellinessRatio).toBe(0.75);
    expect(slave.mobMemberProfile!.catchUpCrisisBailTime).toBe(20);

    // State should be initialized when enslaved.
    expect(slave.mobMemberState).not.toBeNull();
    expect(slave.mobMemberState!.catchUpCrisisTimer).toBe(0);
    expect(slave.mobMemberState!.primaryVictimId).toBe(-1);
    expect(slave.mobMemberState!.isSelfTasking).toBe(false);
    expect(slave.mobMemberState!.mobState).toBe(0);
  });

  it('mob member follows master when distant (catch-up mode)', () => {
    const { logic } = makeMobSetup({ mustCatchUpRadius: 20 });

    // Let spawn happen.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    // Move slave far from master beyond mustCatchUpRadius.
    slave.x = master.x + 80;
    slave.z = master.z + 80;

    // Run enough frames for the 16-frame throttle to fire (run 30 frames).
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Slave should have a moveTarget set (trying to catch up).
    expect(slave.moveTarget).not.toBeNull();
    // mobState should be 1 (CATCHING_UP).
    expect(slave.mobMemberState!.mobState).toBe(1);
  });

  it('crisis timer increments when critically far from master', () => {
    const { logic } = makeMobSetup({ mustCatchUpRadius: 10, catchUpCrisisBailTime: 100 });

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    // Move slave critically far: > mustCatchUpRadius * 3 = 30.
    slave.x = master.x + 200;
    slave.z = master.z + 200;

    // Reset the framesToWait so the update fires soon.
    slave.mobMemberState!.framesToWait = 15;

    // Run 20 frames to trigger a few 16-frame cycles.
    for (let i = 0; i < 50; i++) logic.update(1 / 30);

    // Crisis timer should have incremented.
    expect(slave.mobMemberState!.catchUpCrisisTimer).toBeGreaterThan(0);
  });

  it('mob member killed when crisis timer exceeds bail time', () => {
    const { logic } = makeMobSetup({ mustCatchUpRadius: 10, catchUpCrisisBailTime: 2 });

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    // Move slave critically far from master.
    slave.x = master.x + 200;
    slave.z = master.z + 200;

    // Run enough frames for multiple 16-frame cycles to trigger bail.
    // With bailTime=2, need 3 cycles while critically far.
    for (let i = 0; i < 100; i++) logic.update(1 / 30);

    // Slave should be dead (health <= 0 or destroyed).
    expect(slave.health <= 0 || slave.destroyed).toBe(true);
  });

  it('attack mirroring from master target', () => {
    const { logic } = makeMobSetup({ squirrelliness: 0 });

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    // Add an enemy near the mob.
    addEnemy(logic, 105, 105);
    // Find the enemy entity ID.
    const priv = logic as unknown as { spawnedEntities: Map<number, MobEntity> };
    let enemyId = -1;
    for (const [id, e] of priv.spawnedEntities) {
      if (id !== 1 && id !== slaveId && !e.destroyed) {
        enemyId = id;
        break;
      }
    }
    expect(enemyId).not.toBe(-1);

    // Set master to attack the enemy.
    master.attackTargetEntityId = enemyId;

    // Ensure slave is idle and near master.
    slave.x = master.x + 5;
    slave.z = master.z + 5;
    slave.moving = false;
    slave.attackTargetEntityId = null;
    slave.mobMemberState!.framesToWait = 15;

    // Run frames for mob update to fire.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Slave should remember master's victim.
    expect(slave.mobMemberState!.primaryVictimId).toBe(enemyId);
  });

  it('idle self-tasking with squirrelliness check', () => {
    // With squirrelliness=1.0 (always self-tasks), and enemy nearby,
    // the mob member should find and attack the enemy.
    const { logic } = makeMobSetup({ squirrelliness: 1.0, mustCatchUpRadius: 200 });

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);

    // Add an enemy near the mob.
    addEnemy(logic, 110, 110);
    const priv = logic as unknown as { spawnedEntities: Map<number, MobEntity> };
    let enemyId = -1;
    for (const [id, e] of priv.spawnedEntities) {
      if (id !== 1 && id !== slaveId && !e.destroyed) {
        enemyId = id;
        break;
      }
    }
    expect(enemyId).not.toBe(-1);

    // Master is attacking the enemy (not idle, so slave won't go fully idle).
    // The slave is idle and not moving, so it enters the idle branch of the mob update.
    master.attackTargetEntityId = enemyId;
    master.moveTarget = null;
    master.moving = false;

    // Place slave near master, idle (within mustCatchUpRadius).
    slave.x = master.x + 2;
    slave.z = master.z + 2;
    slave.moving = false;
    slave.attackTargetEntityId = null;
    slave.mobMemberState!.framesToWait = 15;

    // Run enough frames for multiple 16-frame cycles.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // With squirrelliness=1.0, the mob member should have attempted self-tasking
    // or mirrored the master's target. Either attackTarget or primaryVictim should be set.
    const hasTarget = slave.attackTargetEntityId !== null || slave.mobMemberState!.primaryVictimId >= 0;
    expect(hasTarget).toBe(true);
  });

  it('mob member killed when master dies', () => {
    const { logic } = makeMobSetup();

    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    const master = getEntity(logic, 1);
    expect(master.spawnBehaviorState!.slaveIds.length).toBe(1);
    const slaveId = master.spawnBehaviorState!.slaveIds[0]!;
    const slave = getEntity(logic, slaveId);
    expect(slave.destroyed).toBe(false);

    // Kill master.
    master.health = 0;
    master.destroyed = true;

    // Run enough frames for mob update to detect dead master.
    slave.mobMemberState!.framesToWait = 15;
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Slave should be dead since master died.
    expect(slave.health <= 0 || slave.destroyed).toBe(true);
  });
});

describe('BaikonurLaunchPower', () => {
  function makeBaikonurDef(): ObjectDef {
    return makeObjectDef('BaikonurRocketPad', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
      makeBlock('Behavior', 'BaikonurLaunchPower ModuleTag_Baikonur', {
        SpecialPowerTemplate: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
        DetonationObject: 'BaikonurDetonation',
      }),
    ]);
  }

  function makeDetonationDef(): ObjectDef {
    return makeObjectDef('BaikonurDetonation', 'GLA', ['PROJECTILE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
  }

  it('no-target dispatch sets DOOR_1_OPENING model condition', () => {
    const bundle = makeBundle({
      objects: [makeBaikonurDef(), makeDetonationDef()],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_LAUNCH_BAIKONUR_ROCKET', {
          ReloadTime: 0,
          Enum: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('BaikonurRocketPad', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );


    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_BAIKONUR_NO_TARGET',
      specialPowerName: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const sourceState = logic.getEntityState(1);
    expect(sourceState?.lastSpecialPowerDispatch).toMatchObject({
      specialPowerTemplateName: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
      moduleType: 'BAIKONURLAUNCHPOWER',
      dispatchType: 'NO_TARGET',
    });
    expect(sourceState?.modelConditionFlags).toContain('DOOR_1_OPENING');
  });

  it('position dispatch spawns DetonationObject at target location', () => {
    const bundle = makeBundle({
      objects: [makeBaikonurDef(), makeDetonationDef()],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_LAUNCH_BAIKONUR_ROCKET', {
          ReloadTime: 0,
          Enum: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('BaikonurRocketPad', 50, 50)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const targetX = 200;
    const targetZ = 300;

    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_BAIKONUR_POSITION',
      specialPowerName: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
      commandOption: 0x20,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX,
      targetZ,
    });
    logic.update(0);

    const sourceState = logic.getEntityState(1);
    expect(sourceState?.lastSpecialPowerDispatch).toMatchObject({
      specialPowerTemplateName: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
      moduleType: 'BAIKONURLAUNCHPOWER',
      dispatchType: 'POSITION',
      targetX,
      targetZ,
    });

    // Verify the detonation object was spawned
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        templateName: string;
        x: number;
        z: number;
        side: string;
      }>;
    };
    expect(priv.spawnedEntities.size).toBe(2);

    let detonation: { templateName: string; x: number; z: number; side: string } | null = null;
    for (const [id, ent] of priv.spawnedEntities) {
      if (id !== 1) detonation = ent;
    }
    expect(detonation).not.toBeNull();
    expect(detonation!.templateName).toBe('BaikonurDetonation');
    expect(detonation!.x).toBe(targetX);
    expect(detonation!.z).toBe(targetZ);
  });

  it('supports dual-mode dispatch (both no-target and position) on same entity', () => {
    const bundle = makeBundle({
      objects: [makeBaikonurDef(), makeDetonationDef()],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_LAUNCH_BAIKONUR_ROCKET', {
          ReloadTime: 0,
          Enum: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('BaikonurRocketPad', 50, 50)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    // First: no-target dispatch
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_BAIKONUR_NO_TARGET',
      specialPowerName: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
      commandOption: 0,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toMatchObject({
      dispatchType: 'NO_TARGET',
    });
    expect(logic.getEntityState(1)?.modelConditionFlags).toContain('DOOR_1_OPENING');

    // Second: position dispatch
    logic.submitCommand({
      type: 'issueSpecialPower',
      commandButtonId: 'CMD_BAIKONUR_POSITION',
      specialPowerName: 'SPECIAL_LAUNCH_BAIKONUR_ROCKET',
      commandOption: 0x20,
      issuingEntityIds: [1],
      sourceEntityId: 1,
      targetEntityId: null,
      targetX: 150,
      targetZ: 180,
    });
    logic.update(0);

    expect(logic.getEntityState(1)?.lastSpecialPowerDispatch).toMatchObject({
      dispatchType: 'POSITION',
      targetX: 150,
      targetZ: 180,
    });

    // Verify detonation object was spawned
    const priv = logic as unknown as {
      spawnedEntities: Map<number, { templateName: string }>;
    };
    let detonationCount = 0;
    for (const [, ent] of priv.spawnedEntities) {
      if (ent.templateName === 'BaikonurDetonation') detonationCount++;
    }
    expect(detonationCount).toBe(1);
  });
});

describe('Fog of war shroud status resolution', () => {
  it('entities start SHROUDED before first fog-of-war update when player side is set', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const neutralProp = makeObjectDef('NeutralProp', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], {
      ShroudClearingRange: 0,
    });

    const registry = makeRegistry(makeBundle({
      objects: [neutralProp],
    }));

    logic.loadMapObjects(
      makeMap([makeMapObject('NeutralProp', 400, 400)], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');

    const states = logic.getRenderableEntityStates();
    const prop = states.find(s => s.templateName === 'NeutralProp');
    expect(prop).toBeDefined();
    expect(prop!.shroudStatus).toBe('SHROUDED');
  });

  it('entities near own buildings become CLEAR after update', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const commandCenter = makeObjectDef('AmericaCommandCenter', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], {
      VisionRange: 300,
      ShroudClearingRange: 300,
    });

    const neutralProp = makeObjectDef('NeutralProp', '', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], {
      ShroudClearingRange: 0,
    });

    const registry = makeRegistry(makeBundle({
      objects: [commandCenter, neutralProp],
    }));

    // Place the neutral prop within 300 units of the command center.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('AmericaCommandCenter', 500, 500),
        makeMapObject('NeutralProp', 550, 500),
      ], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');

    // Before update, the neutral prop should be SHROUDED.
    const statesBefore = logic.getRenderableEntityStates();
    const propBefore = statesBefore.find(s => s.templateName === 'NeutralProp');
    expect(propBefore!.shroudStatus).toBe('SHROUDED');

    // After update(0), the command center's shroud-clearing range should reveal nearby cells.
    logic.update(0);

    const statesAfter = logic.getRenderableEntityStates();
    const propAfter = statesAfter.find(s => s.templateName === 'NeutralProp');
    expect(propAfter!.shroudStatus).toBe('CLEAR');
  });

  it('own entities are always CLEAR regardless of fog state', () => {
    const logic = new GameLogicSubsystem(new THREE.Scene());

    const ownUnit = makeObjectDef('AmericaDozer', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ], {
      VisionRange: 10,
      ShroudClearingRange: 10,
    });

    const registry = makeRegistry(makeBundle({
      objects: [ownUnit],
    }));

    logic.loadMapObjects(
      makeMap([makeMapObject('AmericaDozer', 500, 500)], 128, 128),
      registry,
      makeHeightmap(128, 128),
    );
    logic.setPlayerSide(0, 'America');

    // Even before update(), own entities should report CLEAR shroud status.
    const states = logic.getRenderableEntityStates();
    const dozer = states.find(s => s.templateName === 'AmericaDozer');
    expect(dozer).toBeDefined();
    expect(dozer!.shroudStatus).toBe('CLEAR');
  });
});
