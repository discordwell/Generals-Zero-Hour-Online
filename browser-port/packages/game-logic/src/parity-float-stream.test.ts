/**
 * Parity Tests — FloatUpdate water tracking & ProjectileStreamUpdate buffer management.
 *
 * Source references:
 *   FloatUpdate.cpp:99-142 — units with FloatUpdate snap their Z to water surface each frame.
 *   ProjectileStreamUpdate.cpp:70-150 — circular buffer of 20, front-culling of dead projectiles,
 *     considerDying() destroys stream when owner dead + buffer empty.
 *   ProjectileStreamUpdate.h:41-44 — MAX_PROJECTILE_STREAM = 20.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MapDataJSON } from '@generals/terrain';
import { uint8ArrayToBase64 } from '@generals/terrain';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './parity-agent.js';

// ── Test 1: FloatUpdate — Water Surface Tracking ──────────────────────────

describe('FloatUpdate water surface tracking', () => {
  /**
   * Build a map with a water polygon trigger covering coordinates 0..500, 0..500
   * at the given waterHeight. Places a Boat (with FloatUpdate) and a Tank (without).
   *
   * Source parity: FloatUpdate.cpp:104-118 — when m_enabled is TRUE, each frame
   * the object's Z is set to the water surface height returned by
   * TheTerrainLogic->isUnderwater().
   */
  function makeFloatSetup(opts?: { waterHeight?: number }) {
    const sz = 64;
    const waterH = opts?.waterHeight ?? 20;
    const objects = [
      makeObjectDef('Boat', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'FloatUpdate ModuleTag_Float', { Enabled: 'Yes' }),
      ]),
      makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ]),
    ];
    const bundle = makeBundle({ objects });
    const registry = makeRegistry(bundle);
    const logic = new GameLogicSubsystem(new THREE.Scene());

    // Map with a water polygon trigger covering 0..500, 0..500 at waterH.
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

  it('snaps entity with FloatUpdate to water surface height each frame (C++ FloatUpdate.cpp:113-118)', () => {
    const waterHeight = 25;
    const logic = makeFloatSetup({ waterHeight });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        y: number;
        baseHeight: number;
        floatUpdateProfile: { enabled: boolean } | null;
      }>;
    };
    const boat = priv.spawnedEntities.get(1)!;

    // Verify FloatUpdate profile was extracted and enabled.
    expect(boat.floatUpdateProfile).not.toBeNull();
    expect(boat.floatUpdateProfile!.enabled).toBe(true);

    // Before update, entity is on terrain (height = 0 + baseHeight).
    const baseH = boat.baseHeight;
    expect(boat.y).toBeCloseTo(baseH, 1);

    // After one frame, entity should snap to water surface.
    // Source parity: C++ sets pos->z = waterZ. TS translates to entity.y = waterHeight + baseHeight.
    logic.update(1 / 30);
    expect(boat.y).toBeCloseTo(waterHeight + baseH, 1);
  });

  it('maintains water surface height across multiple frames (C++ update returns UPDATE_SLEEP_NONE)', () => {
    const waterHeight = 30;
    const logic = makeFloatSetup({ waterHeight });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        y: number;
        baseHeight: number;
        floatUpdateProfile: { enabled: boolean } | null;
      }>;
    };
    const boat = priv.spawnedEntities.get(1)!;
    const baseH = boat.baseHeight;

    // Step multiple frames — entity should stay at water surface each time.
    // C++ FloatUpdate::update returns UPDATE_SLEEP_NONE (runs every frame).
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
      expect(boat.y).toBeCloseTo(waterHeight + baseH, 1);
    }
  });

  it('does not modify entity without FloatUpdate profile', () => {
    const logic = makeFloatSetup({ waterHeight: 25 });
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        y: number;
        floatUpdateProfile: { enabled: boolean } | null;
      }>;
    };
    const tank = priv.spawnedEntities.get(2)!;

    // Tank has no FloatUpdate.
    expect(tank.floatUpdateProfile).toBeNull();

    const startY = tank.y;
    logic.update(1 / 30);
    // Tank should not have been moved to water surface.
    expect(tank.y).toBe(startY);
  });

  it('does not modify entity with FloatUpdate when not over water (C++ FloatUpdate.cpp:111)', () => {
    // Map with NO water triggers.
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

    logic.loadMapObjects(
      makeMap([makeMapObject('Boat', 50, 50)], sz, sz),
      registry,
      makeHeightmap(sz, sz),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        y: number;
        floatUpdateProfile: { enabled: boolean } | null;
      }>;
    };
    const boat = priv.spawnedEntities.get(1)!;
    expect(boat.floatUpdateProfile?.enabled).toBe(true);

    const startY = boat.y;
    logic.update(1 / 30);
    // Not over water (getWaterHeightAt returns null), so height should not change.
    expect(boat.y).toBe(startY);
  });
});

// ── Test 2: ProjectileStreamUpdate — Projectile Array Management ──────────

describe('ProjectileStreamUpdate buffer management', () => {
  /**
   * Source parity: ProjectileStreamUpdate.cpp — tracks projectiles in a circular
   * buffer of size MAX_PROJECTILE_STREAM (20). On each update(), cullFrontOfList()
   * removes dead projectiles from the front. considerDying() destroys the stream
   * entity when the owner is dead and the buffer is empty.
   */
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

  it('tracks projectiles in buffer and reports positions via getStreamPoints (C++ addProjectile, getAllPoints)', () => {
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

    // Verify profile was extracted.
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.projectileStreamProfile).not.toBeNull();
    expect(entity.projectileStreamProfile!.enabled).toBe(true);
    // State is lazy-initialized on first addProjectile call.
    expect(entity.projectileStreamState).toBeNull();

    // Add two projectiles to the stream.
    // Source parity: C++ addProjectile(sourceID, newID) stores in circular buffer.
    priv.addProjectileToStream(1, 2);
    priv.addProjectileToStream(1, 3);

    const state = priv.spawnedEntities.get(1)!.projectileStreamState!;
    expect(state).not.toBeNull();
    expect(state.projectileIds).toEqual([2, 3]);
    expect(state.nextIndex).toBe(2);

    // getStreamPoints returns positions of live projectiles.
    // Source parity: C++ getAllPoints writes projectile->getPosition() for valid entries.
    const points = logic.getStreamPoints(1);
    expect(points.length).toBe(2);
  });

  it('culls dead projectiles from front of buffer (C++ cullFrontOfList, lines 94-101)', () => {
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

    // Destroy the first projectile (front of buffer).
    // Source parity: C++ cullFrontOfList chews off the front while
    // findObjectByID(m_projectileIDs[m_firstValidIndex]) == NULL.
    priv.spawnedEntities.get(2)!.destroyed = true;

    logic.update(1 / 30);

    const state = priv.spawnedEntities.get(1)!.projectileStreamState!;
    // Front was culled; only the second projectile remains.
    expect(state.projectileIds).toEqual([3]);
    expect(logic.getStreamPoints(1).length).toBe(1);
  });

  it('wraps circular buffer at capacity of 20 (C++ MAX_PROJECTILE_STREAM = 20)', () => {
    // Create 22 unique projectile types to exceed the buffer.
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

    // Add 22 projectiles — buffer size 20 should wrap, overwriting first entries.
    // Source parity: C++ m_projectileIDs[m_nextFreeIndex] = newID;
    //               m_nextFreeIndex = (m_nextFreeIndex + 1) % MAX_PROJECTILE_STREAM;
    for (let i = 2; i <= 23; i++) {
      priv.addProjectileToStream(1, i);
    }

    const state = priv.spawnedEntities.get(1)!.projectileStreamState!;
    expect(state.projectileIds.length).toBe(20);
    // After wrapping, first two entries should be overwritten with 22, 23.
    expect(state.projectileIds[0]).toBe(22);
    expect(state.projectileIds[1]).toBe(23);
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
    // Entity without ProjectileStreamUpdate block should have null profile.
    expect(priv.spawnedEntities.get(1)!.projectileStreamProfile).toBeNull();
  });

  it('dead entries in the middle of the buffer produce (0,0,0) in getStreamPoints (C++ getAllPoints:155-159)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StreamEntity', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('ClientUpdate', 'ProjectileStreamUpdate ModuleTag_Stream', {}),
        ]),
        makeObjectDef('ProjA', 'GLA', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
        makeObjectDef('ProjB', 'GLA', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
        makeObjectDef('ProjC', 'GLA', ['PROJECTILE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StreamEntity', 5, 5),
        makeMapObject('ProjA', 10, 10),
        makeMapObject('ProjB', 20, 20),
        makeMapObject('ProjC', 30, 30),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        projectileStreamState: {
          projectileIds: number[];
        } | null;
        destroyed: boolean;
      }>;
      addProjectileToStream(streamEntityId: number, projectileId: number): void;
    };

    priv.addProjectileToStream(1, 2); // ProjA
    priv.addProjectileToStream(1, 3); // ProjB
    priv.addProjectileToStream(1, 4); // ProjC

    // Destroy the middle projectile (ProjB, id=3).
    // Source parity: C++ cullFrontOfList only removes from front.
    // Dead entries in the middle remain as holes, producing (0,0,0) in getAllPoints.
    priv.spawnedEntities.get(3)!.destroyed = true;

    // Don't call update() — we want to verify getAllPoints behavior with a hole.
    const points = logic.getStreamPoints(1);
    expect(points.length).toBe(3);

    // First point should be valid (ProjA at ~10,_,10).
    expect(points[0]!.x).not.toBe(0);
    // Middle point should be (0,0,0) since ProjB is destroyed.
    expect(points[1]).toEqual({ x: 0, y: 0, z: 0 });
    // Last point should be valid (ProjC at ~30,_,30).
    expect(points[2]!.x).not.toBe(0);
  });
});
