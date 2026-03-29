/**
 * ZH-only movement and waypoint runtime fixes.
 *
 * Source parity:
 *   1. AIGroup.cpp — clamp adjusted waypoint positions back to map bounds
 *   2. AIUpdate.cpp:5295-5302 — hasLocomotorForSurface() utility
 *   3. AIStates.cpp:2410-2514 — remove isBlockedAndStuck branch in attack approach
 *   4. AIStates.cpp:2471-2487 — setAdjustsDestination wrapping in approach state
 *   5. Weapon.cpp:2176-2208 — isWithinAttackRange uses object-to-object geometry
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  clampAdjustedWaypointToMap,
  clampWaypointPosition,
  hasLocomotorForSurface,
  shouldComputeAttackPath,
  resolveAttackApproachAdjustsDestination,
  isWithinAttackRange,
  STD_WAYPOINT_CLAMP_MARGIN,
} from './entity-movement.js';
import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogicWithMap(mapSize = 256): { self: any; mapWidth: number; mapDepth: number } {
  const scene = new THREE.Scene();
  const logic = new GameLogicSubsystem(scene);
  const bundle = makeBundle({
    objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ])],
  });
  logic.loadMapObjects(
    makeMap([makeMapObject('TestUnit', 50, 50)], mapSize, mapSize),
    makeRegistry(bundle),
    makeHeightmap(mapSize, mapSize),
  );
  const self = logic as any;
  const mapWidth = self.mapHeightmap.worldWidth;
  const mapDepth = self.mapHeightmap.worldDepth;
  return { self, mapWidth, mapDepth };
}

// ===========================================================================
// 1. Waypoint clamping in follow-path
// ===========================================================================
describe('clampAdjustedWaypointToMap — ZH waypoint clamping for follow-path', () => {
  it('clamps adjusted position back to map when original is on-map', () => {
    const { self, mapWidth, mapDepth } = makeLogicWithMap();
    const margin = STD_WAYPOINT_CLAMP_MARGIN;

    // Original waypoint is well within the map
    const originalX = 500;
    const originalZ = 500;
    // Adjusted position overshoots past the map edge
    const adjustedX = mapWidth + 100;
    const adjustedZ = mapDepth + 100;

    const [clampedX, clampedZ] = clampAdjustedWaypointToMap(
      self, originalX, originalZ, adjustedX, adjustedZ, margin,
    );

    // Should be clamped back to within map bounds minus margin
    expect(clampedX).toBe(mapWidth - margin);
    expect(clampedZ).toBe(mapDepth - margin);
  });

  it('does NOT clamp when original waypoint is off-map', () => {
    const { self, mapWidth, mapDepth } = makeLogicWithMap();
    const margin = STD_WAYPOINT_CLAMP_MARGIN;

    // Original waypoint is off-map (intentional exit)
    const originalX = mapWidth + 200;
    const originalZ = mapDepth + 200;
    // Adjusted position is also off-map
    const adjustedX = mapWidth + 300;
    const adjustedZ = mapDepth + 300;

    const [clampedX, clampedZ] = clampAdjustedWaypointToMap(
      self, originalX, originalZ, adjustedX, adjustedZ, margin,
    );

    // Should NOT be clamped — original was off-map
    expect(clampedX).toBe(adjustedX);
    expect(clampedZ).toBe(adjustedZ);
  });

  it('passes through adjusted position that is already within bounds', () => {
    const { self } = makeLogicWithMap();
    const margin = STD_WAYPOINT_CLAMP_MARGIN;

    const originalX = 500;
    const originalZ = 500;
    const adjustedX = 550;
    const adjustedZ = 550;

    const [clampedX, clampedZ] = clampAdjustedWaypointToMap(
      self, originalX, originalZ, adjustedX, adjustedZ, margin,
    );

    expect(clampedX).toBe(550);
    expect(clampedZ).toBe(550);
  });

  it('clamps adjusted position near zero edge', () => {
    const { self } = makeLogicWithMap();
    const margin = STD_WAYPOINT_CLAMP_MARGIN;

    // Original is on-map, adjusted overshoots past zero edge
    const [clampedX, clampedZ] = clampAdjustedWaypointToMap(
      self, 100, 100, -50, -50, margin,
    );

    expect(clampedX).toBe(margin);
    expect(clampedZ).toBe(margin);
  });

  it('returns adjusted position unchanged when no heightmap', () => {
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    const self = logic as any;
    // No map loaded — no heightmap

    const [clampedX, clampedZ] = clampAdjustedWaypointToMap(
      self, 500, 500, 9999, 9999, STD_WAYPOINT_CLAMP_MARGIN,
    );

    expect(clampedX).toBe(9999);
    expect(clampedZ).toBe(9999);
  });
});

// ===========================================================================
// 2. hasLocomotorForSurface() method
// ===========================================================================
describe('hasLocomotorForSurface — ZH locomotor surface check', () => {
  const SURFACE_GROUND = 1 << 0;
  const SURFACE_WATER = 1 << 1;
  const SURFACE_CLIFF = 1 << 2;
  const SURFACE_AIR = 1 << 3;

  it('returns true when entity has a matching surface in its locomotor set', () => {
    const sets = new Map<string, { surfaceMask: number }>();
    sets.set('SET_NORMAL', { surfaceMask: SURFACE_GROUND | SURFACE_WATER });

    expect(hasLocomotorForSurface(sets, SURFACE_GROUND)).toBe(true);
    expect(hasLocomotorForSurface(sets, SURFACE_WATER)).toBe(true);
  });

  it('returns false when entity lacks the surface in all locomotor sets', () => {
    const sets = new Map<string, { surfaceMask: number }>();
    sets.set('SET_NORMAL', { surfaceMask: SURFACE_GROUND });

    expect(hasLocomotorForSurface(sets, SURFACE_WATER)).toBe(false);
    expect(hasLocomotorForSurface(sets, SURFACE_AIR)).toBe(false);
    expect(hasLocomotorForSurface(sets, SURFACE_CLIFF)).toBe(false);
  });

  it('checks across multiple locomotor sets', () => {
    const sets = new Map<string, { surfaceMask: number }>();
    sets.set('SET_NORMAL', { surfaceMask: SURFACE_GROUND });
    sets.set('SET_WANDER', { surfaceMask: SURFACE_WATER });

    // GROUND is in SET_NORMAL, WATER is in SET_WANDER
    expect(hasLocomotorForSurface(sets, SURFACE_GROUND)).toBe(true);
    expect(hasLocomotorForSurface(sets, SURFACE_WATER)).toBe(true);
    // AIR is in neither
    expect(hasLocomotorForSurface(sets, SURFACE_AIR)).toBe(false);
  });

  it('returns false for empty locomotor sets', () => {
    const sets = new Map<string, { surfaceMask: number }>();
    expect(hasLocomotorForSurface(sets, SURFACE_GROUND)).toBe(false);
  });

  it('handles aircraft with air surface', () => {
    const sets = new Map<string, { surfaceMask: number }>();
    sets.set('SET_NORMAL', { surfaceMask: SURFACE_AIR | SURFACE_GROUND });

    expect(hasLocomotorForSurface(sets, SURFACE_AIR)).toBe(true);
    expect(hasLocomotorForSurface(sets, SURFACE_GROUND)).toBe(true);
    expect(hasLocomotorForSurface(sets, SURFACE_CLIFF)).toBe(false);
  });
});

// ===========================================================================
// 3. Attack approach simplification — remove isBlockedAndStuck branch
// ===========================================================================
describe('shouldComputeAttackPath — ZH always computes attack path', () => {
  it('returns true even when blocked and stuck', () => {
    // ZH removed the Generals isBlockedAndStuck fallback branch
    expect(shouldComputeAttackPath(true)).toBe(true);
  });

  it('returns true when not blocked', () => {
    expect(shouldComputeAttackPath(false)).toBe(true);
  });

  it('always returns true regardless of stuck state (ZH behavior)', () => {
    // In Generals, isBlockedAndStuck caused a fallback to requestPath
    // instead of requestAttackPath. ZH always uses requestAttackPath.
    for (let i = 0; i < 10; i++) {
      expect(shouldComputeAttackPath(i % 2 === 0)).toBe(true);
    }
  });
});

// ===========================================================================
// 4. setAdjustsDestination wrapping in approach state
// ===========================================================================
describe('resolveAttackApproachAdjustsDestination — ZH approach path adjustment', () => {
  it('returns false for contact weapons (run into target)', () => {
    // Source parity: AIStates.cpp:2476 — setAdjustsDestination(false) for contact weapons
    expect(resolveAttackApproachAdjustsDestination(true)).toBe(false);
  });

  it('returns true for ranged weapons (standard pathfinding)', () => {
    // Source parity: AIStates.cpp:2471 — setAdjustsDestination(true) for ranged weapons
    expect(resolveAttackApproachAdjustsDestination(false)).toBe(true);
  });
});

// ===========================================================================
// 5. isWithinAttackRange uses object-to-object check
// ===========================================================================
describe('isWithinAttackRange — ZH geometry-aware range check', () => {
  it('in range when center distance is within weapon range + both radii', () => {
    // Source: (0,0) radius=10, target: (100,0) radius=15, weapon range=80
    // Center dist = 100, effective range = 80 + 10 + 15 = 105
    // 100 <= 105 => in range
    expect(isWithinAttackRange(0, 0, 10, 100, 0, 15, 80)).toBe(true);
  });

  it('out of range when center distance exceeds weapon range + both radii', () => {
    // Source: (0,0) radius=5, target: (200,0) radius=5, weapon range=80
    // Center dist = 200, effective range = 80 + 5 + 5 = 90
    // 200 > 90 => out of range
    expect(isWithinAttackRange(0, 0, 5, 200, 0, 5, 80)).toBe(false);
  });

  it('geometry radii extend the effective range', () => {
    // Without geometry: dist=100, range=90 => out of range
    // With geometry: dist=100, effective range = 90 + 8 + 8 = 106 => in range
    expect(isWithinAttackRange(0, 0, 0, 100, 0, 0, 90)).toBe(false);
    expect(isWithinAttackRange(0, 0, 8, 100, 0, 8, 90)).toBe(true);
  });

  it('handles minimum attack range with geometry', () => {
    // Source: (0,0) radius=10, target: (5,0) radius=10, weapon range=200, min range=50
    // Center dist = 5, effective min range = max(0, 50 - 10 - 10) = 30
    // 5 < 30 => too close, returns false
    expect(isWithinAttackRange(0, 0, 10, 5, 0, 10, 200, 50)).toBe(false);
  });

  it('passes min range check when far enough', () => {
    // Source: (0,0) radius=10, target: (60,0) radius=10, weapon range=200, min range=50
    // Center dist = 60, effective min range = max(0, 50 - 10 - 10) = 30
    // effective max range = 200 + 10 + 10 = 220
    // 30 <= 60 <= 220 => in range
    expect(isWithinAttackRange(0, 0, 10, 60, 0, 10, 200, 50)).toBe(true);
  });

  it('zero radii fall back to center-to-center check', () => {
    // Source: (0,0) radius=0, target: (100,0) radius=0, weapon range=100
    // Center dist = 100, effective range = 100
    // 100 <= 100 => in range (exact boundary)
    expect(isWithinAttackRange(0, 0, 0, 100, 0, 0, 100)).toBe(true);
    expect(isWithinAttackRange(0, 0, 0, 101, 0, 0, 100)).toBe(false);
  });

  it('handles diagonal distance correctly', () => {
    // Source: (0,0) radius=5, target: (60,80) radius=5, weapon range=90
    // Center dist = sqrt(3600+6400) = 100
    // Effective range = 90 + 5 + 5 = 100
    // 100 <= 100 => in range
    expect(isWithinAttackRange(0, 0, 5, 60, 80, 5, 90)).toBe(true);
    // Nudge target further — out of range
    expect(isWithinAttackRange(0, 0, 5, 61, 80, 5, 90)).toBe(false);
  });

  it('large building radius makes nearby units in range', () => {
    // Source parity: buildings with large geometry can be attacked from further away
    // Source: (0,0) radius=5, target: (150,0) radius=50 (building), weapon range=100
    // Center dist = 150, effective range = 100 + 5 + 50 = 155
    // 150 <= 155 => in range
    expect(isWithinAttackRange(0, 0, 5, 150, 0, 50, 100)).toBe(true);
  });

  it('min range = 0 does not reject close targets', () => {
    // No minimum range — even point-blank should work
    expect(isWithinAttackRange(0, 0, 10, 1, 0, 10, 100, 0)).toBe(true);
    expect(isWithinAttackRange(50, 50, 5, 50, 50, 5, 100, 0)).toBe(true);
  });
});
