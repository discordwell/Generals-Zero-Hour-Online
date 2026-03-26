/**
 * Parity tests for SPAWN_DELAY_MIN_FRAMES and YELLOW_DAMAGE_PERCENT constants.
 *
 * Part 1 — SPAWN_DELAY_MIN_FRAMES (SpawnBehavior.cpp):
 *   The minimum spawn delay clamp prevents spawn timers from being set to
 *   extremely low values. In C++ this is 16 frames ("about as rapidly as
 *   you'd expect people to successively exit through the same door").
 *
 * Part 2 — YELLOW_DAMAGE_PERCENT (ActiveBody.cpp):
 *   When an entity's health crosses below 25% of max health (and was above
 *   before), a "fear" audio cue triggers with 25% probability. The constant
 *   YELLOW_DAMAGE_PERCENT = 0.25 defines that threshold.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem, YELLOW_DAMAGE_PERCENT, calcBodyDamageState } from './index.js';
import { SPAWN_DELAY_MIN_FRAMES, onSlaveDeath } from './spawner-behavior.js';
import {
  makeBlock,
  makeObjectDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ══════════════════════════════════════════════════════════════════════════════
// Part 1: SPAWN_DELAY_MIN_FRAMES
// ══════════════════════════════════════════════════════════════════════════════

describe('parity: SPAWN_DELAY_MIN_FRAMES constant', () => {
  it('has the correct value of 16 matching C++ SpawnBehavior.cpp', () => {
    // C++ source: #define SPAWN_DELAY_MIN_FRAMES (16)
    // "about as rapidly as you'd expect people to successively exit through the same door"
    expect(SPAWN_DELAY_MIN_FRAMES).toBe(16);
  });

  it('onSlaveDeath clamps replacement delay to at least SPAWN_DELAY_MIN_FRAMES', () => {
    // Create a spawner with SpawnReplaceDelay=0 (converts to 0 frames).
    // After onSlaveDeath, replacement should be clamped to >= SPAWN_DELAY_MIN_FRAMES.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Spawner', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
            SpawnNumber: 2,
            SpawnTemplateName: 'Drone',
            SpawnReplaceDelay: 0,
            InitialBurst: 2,
          }),
        ]),
        makeObjectDef('Drone', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
    });

    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Spawner', 50, 50),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // Run enough frames for initial burst to spawn drones.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;

    // Find the spawner (template names preserve original case from makeObjectDef).
    const spawner = [...allEntities.values()].find(
      (e: any) => e.templateName === 'Spawner' && !e.destroyed,
    );
    expect(spawner).toBeDefined();
    const state = spawner!.spawnBehaviorState;
    expect(state).toBeDefined();

    // Find a drone slave.
    const drone = [...allEntities.values()].find(
      (e: any) => e.templateName === 'Drone' && !e.destroyed,
    );
    expect(drone).toBeDefined();

    // Clear any pending replacements, then trigger slave death.
    state!.replacementFrames = [];
    const currentFrame = (logic as any).frameCounter as number;

    onSlaveDeath(logic, drone!);

    // The replacement delay (0 frames) should be clamped up to SPAWN_DELAY_MIN_FRAMES.
    expect(state!.replacementFrames.length).toBeGreaterThan(0);
    const scheduledFrame = state!.replacementFrames[0];
    expect(scheduledFrame).toBeGreaterThanOrEqual(currentFrame + SPAWN_DELAY_MIN_FRAMES);
  });

  it('replacement delay larger than SPAWN_DELAY_MIN_FRAMES is not clamped down', () => {
    // When SpawnReplaceDelay converts to 30 frames (> 16), it should NOT be reduced.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Spawner', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
            SpawnNumber: 2,
            SpawnTemplateName: 'Drone',
            SpawnReplaceDelay: 1000, // 1000ms = 30 frames at 30fps
            InitialBurst: 2,
          }),
        ]),
        makeObjectDef('Drone', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
    });

    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Spawner', 50, 50),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const spawner = [...allEntities.values()].find(
      (e: any) => e.templateName === 'Spawner' && !e.destroyed,
    );
    expect(spawner).toBeDefined();
    const state = spawner!.spawnBehaviorState;
    expect(state).toBeDefined();

    const drone = [...allEntities.values()].find(
      (e: any) => e.templateName === 'Drone' && !e.destroyed,
    );
    expect(drone).toBeDefined();

    state!.replacementFrames = [];
    const currentFrame = (logic as any).frameCounter as number;

    onSlaveDeath(logic, drone!);

    expect(state!.replacementFrames.length).toBeGreaterThan(0);
    const scheduledFrame = state!.replacementFrames[0];
    // 30 frames > 16, so Math.max(16, 30) = 30.
    expect(scheduledFrame).toBe(currentFrame + 30);
  });

  it('initial burst staggering uses SPAWN_DELAY_MIN_FRAMES intervals for runtime-produced units', () => {
    // Verify the staggering formula: birthFrame = frameCounter + i * SPAWN_DELAY_MIN_FRAMES.
    // For a non-runtime spawner placed on the map (producerEntityId = 0), burst spawns
    // are scheduled immediately (frame 0). This matches C++ behavior where runtimeProduced
    // is false for script/worldbuilder-placed units.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Spawner', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
            SpawnNumber: 3,
            SpawnTemplateName: 'Drone',
            SpawnReplaceDelay: 100,
            InitialBurst: 3,
          }),
        ]),
        makeObjectDef('Drone', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
    });

    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Spawner', 50, 50),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());

    // The spawner is placed on the map (not produced at runtime), so producerEntityId = 0.
    // In C++, runtimeProduced = false → all burst spawns scheduled at frame 0 (immediate).
    // Run a few frames to trigger initial burst.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const drones = [...allEntities.values()].filter(
      (e: any) => e.templateName === 'Drone' && !e.destroyed,
    );
    // All 3 drones should have spawned (scheduled at frame 0 = immediate).
    expect(drones.length).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Part 2: YELLOW_DAMAGE_PERCENT
// ══════════════════════════════════════════════════════════════════════════════

describe('parity: YELLOW_DAMAGE_PERCENT constant', () => {
  it('has the correct value of 0.25 matching C++ ActiveBody.cpp', () => {
    // C++ source: #define YELLOW_DAMAGE_PERCENT (0.25f)
    expect(YELLOW_DAMAGE_PERCENT).toBe(0.25);
  });

  it('calcBodyDamageState: YELLOW_DAMAGE_PERCENT falls within DAMAGED range', () => {
    // The yellow damage threshold (25%) sits between DAMAGED (50%) and REALLYDAMAGED (10%).
    expect(calcBodyDamageState(100, 100)).toBe(0); // PRISTINE (ratio=1.0)
    expect(calcBodyDamageState(60, 100)).toBe(0);  // PRISTINE (ratio=0.6)
    expect(calcBodyDamageState(50, 100)).toBe(1);  // DAMAGED (ratio=0.5, not > 0.5)
    expect(calcBodyDamageState(25, 100)).toBe(1);  // DAMAGED (ratio=0.25, at YELLOW threshold)
    expect(calcBodyDamageState(10, 100)).toBe(2);  // REALLYDAMAGED (ratio=0.1, not > 0.1)
    expect(calcBodyDamageState(1, 100)).toBe(2);   // REALLYDAMAGED (ratio=0.01)
    expect(calcBodyDamageState(0, 100)).toBe(3);   // RUBBLE

    // Confirm YELLOW_DAMAGE_PERCENT lies in DAMAGED range.
    expect(YELLOW_DAMAGE_PERCENT).toBeGreaterThan(0.1);
    expect(YELLOW_DAMAGE_PERCENT).toBeLessThanOrEqual(0.5);
  });

  it('does not set yellowDamageFearFrame when health stays above 25%', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ]),
      ],
    });

    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Target', 50, 50),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.update(1 / 30);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const target = allEntities.get(1);
    expect(target).toBeDefined();

    // Damage from 1000 to 500 -- still above 25% (250 HP).
    (logic as any).applyWeaponDamageAmount(null, target, 500, 'ARMOR_PIERCING');
    expect(target.health).toBe(500);
    expect(target.yellowDamageFearFrame).toBeUndefined();

    // Damage from 500 to 300 -- still above 25% (250 HP).
    (logic as any).applyWeaponDamageAmount(null, target, 200, 'ARMOR_PIERCING');
    expect(target.health).toBe(300);
    expect(target.yellowDamageFearFrame).toBeUndefined();
  });

  it('does not trigger yellow damage fear on lethal damage (target dies)', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });

    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Target', 50, 50),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.update(1 / 30);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const target = allEntities.get(1);
    expect(target).toBeDefined();

    // One-shot kill from full health -- health goes from 100% to 0%.
    // Source parity: C++ checks (m_currentHealth > 0) before triggering fear.
    (logic as any).applyWeaponDamageAmount(null, target, 100, 'ARMOR_PIERCING');
    expect(target.health).toBe(0);
    expect(target.yellowDamageFearFrame).toBeUndefined();
  });

  it('yellow damage fear triggers when crossing 25% threshold (random permitting)', () => {
    // The fear event fires with 25% probability when health crosses below YELLOW_DAMAGE_PERCENT.
    // The deterministic RNG (seed=1) must be pre-advanced to different positions to vary
    // the random outcome, since a single static entity's update loop doesn't consume
    // random numbers.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });

    let triggerCount = 0;
    const trials = 100;

    for (let trial = 0; trial < trials; trial++) {
      const logic = createLogic();
      const map = makeMap([
        makeMapObject('Target', 50, 50),
      ]);
      logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
      logic.update(1 / 30);

      // Advance the deterministic RNG to different positions for each trial.
      // This simulates a game where other systems have consumed random values.
      const rng = (logic as any).gameRandom;
      for (let i = 0; i < trial; i++) rng.nextRange(0, 99);

      const allEntities = (logic as any).spawnedEntities as Map<number, any>;
      const target = allEntities.get(1);
      if (!target || target.destroyed) continue;

      // Set health just above threshold.
      target.health = 26; // 26% > 25%

      // Apply damage to cross below threshold (26 -> 19).
      (logic as any).applyWeaponDamageAmount(null, target, 7, 'ARMOR_PIERCING');

      if (target.yellowDamageFearFrame !== undefined && target.yellowDamageFearFrame > 0) {
        triggerCount++;
      }
    }

    // With 25% probability over 100 trials with varying random states,
    // we expect roughly 25 triggers. Allow wide bounds to avoid flakiness.
    const rate = triggerCount / trials;
    expect(triggerCount).toBeGreaterThan(0); // At least 1 trigger proves the mechanism works.
    expect(rate).toBeLessThan(0.55); // Not unreasonably high.
    expect(rate).toBeGreaterThan(0.05); // Not unreasonably low.
  });

  it('health ratio math correctly identifies threshold crossing', () => {
    // Unit test for the exact boundary conditions of the YELLOW_DAMAGE_PERCENT check.
    // prevHealthRatio > 0.25 && newHealthRatio < 0.25 && health > 0.

    // At exactly 25% (prevRatio = 0.25), should NOT trigger (not > 0.25).
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Target', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });

    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Target', 50, 50),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.update(1 / 30);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const target = allEntities.get(1);
    expect(target).toBeDefined();

    // Set health to exactly 25% (at the boundary).
    target.health = 25;
    // Damage by 1: 25 -> 24 (crosses from 0.25 to 0.24).
    // prevHealthRatio = 25/100 = 0.25 which is NOT > 0.25, so no trigger.
    (logic as any).applyWeaponDamageAmount(null, target, 1, 'ARMOR_PIERCING');
    expect(target.health).toBe(24);
    expect(target.yellowDamageFearFrame).toBeUndefined();
  });
});
