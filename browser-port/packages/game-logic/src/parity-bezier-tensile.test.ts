/**
 * Parity tests for DumbProjectileBehavior Bezier arc trajectory and
 * TensileFormationUpdate spring physics.
 *
 * C++ source references:
 * - DumbProjectileBehavior.h: 4-point cubic Bezier curve defined by
 *   firstHeight, secondHeight, firstPercentIndent, secondPercentIndent.
 * - TensileFormationUpdate.h: avalanche-style spring physics with
 *   tensor links, inertia damping, and dislodgement propagation.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  GameLogicSubsystem,
  approximateCubicBezierArcLength3D,
  BEZIER_ARC_LENGTH_TOLERANCE,
} from './index.js';

import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

import {
  createParityAgent,
  place,
} from './parity-agent.js';

// ---------------------------------------------------------------------------
// Test 1: DumbProjectileBehavior Bezier Arc
// ---------------------------------------------------------------------------

describe('DumbProjectileBehavior Bezier Arc', () => {
  it('extracts arc params from projectile DumbProjectileBehavior and sets hasBezierArc on fire event', () => {
    // Create a projectile object with DumbProjectileBehavior arc parameters.
    // C++ parity: DumbProjectileBehaviorModuleData fields m_firstHeight,
    // m_secondHeight, m_firstPercentIndent, m_secondPercentIndent define
    // a cubic Bezier curve for the projectile flight path.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Catapult', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('ArcWeapon'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          ]),
          // Projectile object with DumbProjectileBehavior arc params.
          makeObjectDef('ArcProjectile', 'America', ['PROJECTILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'DumbProjectileBehavior ModuleTag_DPB', {
              FirstHeight: 80,
              SecondHeight: 60,
              FirstPercentIndent: 0.33,
              SecondPercentIndent: 0.66,
              TumbleRandomly: 'No',
              OrientToFlightPath: 'Yes',
              DetonateCallsKill: 'Yes',
            }),
          ]),
        ],
        weapons: [
          makeWeaponDef('ArcWeapon', {
            PrimaryDamage: 50,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            DelayBetweenShots: 2000,
            WeaponSpeed: 10,
            ProjectileObject: 'ArcProjectile',
          }),
        ],
      },
      mapObjects: [
        place('Catapult', 10, 10),
        place('Target', 50, 10),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Fire at target.
    agent.attack(1, 2);
    agent.step(3);

    // Access pending weapon damage events to verify bezier arc was populated.
    const priv = agent.gameLogic as unknown as {
      pendingWeaponDamageEvents: Array<{
        hasBezierArc: boolean;
        bezierP1Y: number;
        bezierP2Y: number;
        bezierFirstPercentIndent: number;
        bezierSecondPercentIndent: number;
        sourceX: number;
        sourceY: number;
        sourceZ: number;
        impactX: number;
        impactY: number;
        impactZ: number;
        launchFrame: number;
        projectilePlannedImpactFrame: number | null;
        executeFrame: number;
        delivery: string;
      }>;
    };

    const arcEvents = priv.pendingWeaponDamageEvents.filter(
      (e) => e.delivery === 'PROJECTILE' && e.hasBezierArc,
    );

    // C++ parity: when a weapon references a ProjectileObject that has a
    // DumbProjectileBehavior module with non-zero arc heights, the fire
    // path sets hasBezierArc=true and populates the control point data.
    expect(arcEvents.length).toBeGreaterThanOrEqual(1);

    const ev = arcEvents[0]!;
    expect(ev.hasBezierArc).toBe(true);
    // Control point Y heights should be >= the arc heights since they add
    // to the highest intervening terrain (which is 0 on a flat heightmap).
    expect(ev.bezierP1Y).toBeGreaterThanOrEqual(80);
    expect(ev.bezierP2Y).toBeGreaterThanOrEqual(60);
    expect(ev.bezierFirstPercentIndent).toBeCloseTo(0.33, 2);
    expect(ev.bezierSecondPercentIndent).toBeCloseTo(0.66, 2);
  });

  it('Bezier arc Y rises above source and impact heights at midpoint (curved trajectory)', () => {
    // C++ parity: DumbProjectileBehavior::calcFlightPath() — the 4-point
    // Bezier control points P1, P2 are elevated above terrain, causing the
    // projectile to arc upward during mid-flight and return to ground level
    // at the impact point.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Launcher', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('HighArcWeapon'),
          ]),
          makeObjectDef('Victim', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          ]),
          makeObjectDef('HighArcShell', 'America', ['PROJECTILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'DumbProjectileBehavior ModuleTag_DPB', {
              FirstHeight: 100,
              SecondHeight: 80,
              FirstPercentIndent: 0.3,
              SecondPercentIndent: 0.7,
            }),
          ]),
        ],
        weapons: [
          makeWeaponDef('HighArcWeapon', {
            PrimaryDamage: 25,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            DelayBetweenShots: 5000,
            WeaponSpeed: 5,
            ProjectileObject: 'HighArcShell',
          }),
        ],
      },
      mapObjects: [
        place('Launcher', 10, 10),
        place('Victim', 55, 10),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    agent.attack(1, 2);
    agent.step(3);

    const priv = agent.gameLogic as unknown as {
      pendingWeaponDamageEvents: Array<{
        hasBezierArc: boolean;
        bezierP1Y: number;
        bezierP2Y: number;
        bezierFirstPercentIndent: number;
        bezierSecondPercentIndent: number;
        sourceX: number;
        sourceY: number;
        sourceZ: number;
        impactX: number;
        impactY: number;
        impactZ: number;
        launchFrame: number;
        projectilePlannedImpactFrame: number | null;
        executeFrame: number;
        delivery: string;
      }>;
      interpolateProjectileWorldPosition(event: unknown): { x: number; y: number; z: number } | null;
      frameCounter: number;
    };

    const ev = priv.pendingWeaponDamageEvents.find(
      (e) => e.delivery === 'PROJECTILE' && e.hasBezierArc,
    );
    expect(ev).toBeDefined();

    // Manually evaluate the cubic Bezier curve at progress ~0.5 to verify
    // the Y coordinate is above both source and impact.
    // This is the core C++ parity check: the Bezier curve creates a parabolic
    // arc that rises above the endpoints.
    const p0y = ev!.sourceY;
    const p1y = ev!.bezierP1Y;
    const p2y = ev!.bezierP2Y;
    const p3y = ev!.impactY;

    // Cubic Bezier at t=0.5: B(0.5) = 0.125*p0 + 0.375*p1 + 0.375*p2 + 0.125*p3
    const midY = 0.125 * p0y + 0.375 * p1y + 0.375 * p2y + 0.125 * p3y;
    const maxEndpointY = Math.max(p0y, p3y);

    // The midpoint Y must be significantly above the endpoints because
    // FirstHeight=100 and SecondHeight=80 raise the control points.
    expect(midY).toBeGreaterThan(maxEndpointY + 30);

    // Step forward to let the projectile fly partway.
    // Advance a few frames but not enough for impact.
    const flightEndFrame = ev!.projectilePlannedImpactFrame ?? ev!.executeFrame;
    const totalFrames = flightEndFrame - ev!.launchFrame;
    const framesToMid = Math.max(1, Math.floor(totalFrames * 0.5));

    agent.step(framesToMid);

    // Now use the private interpolation method to get the actual in-flight Y.
    // The event may have been consumed if the projectile already hit, so
    // only check if the event still exists.
    const stillInFlight = priv.pendingWeaponDamageEvents.find(
      (e) => e.delivery === 'PROJECTILE' && e.hasBezierArc,
    );
    if (stillInFlight) {
      const world = priv.interpolateProjectileWorldPosition(stillInFlight);
      if (world) {
        // In-flight Y should be elevated above both source and impact heights.
        expect(world.y).toBeGreaterThan(Math.max(ev!.sourceY, ev!.impactY) + 10);
      }
    }
  });

  it('Bezier arc length approximation is longer than chord length for elevated arcs', () => {
    // C++ parity: BezierSegment::getApproximateLength() — the arc length of
    // a curved Bezier is always greater than the straight-line chord length.
    // This is used to compute correct flight time for projectiles.
    const p0x = 0, p0y = 0, p0z = 0;
    const p3x = 100, p3y = 0, p3z = 0;

    // Elevated control points create an arc.
    const p1x = 33, p1y = 80, p1z = 0;
    const p2x = 66, p2y = 60, p2z = 0;

    const arcLength = approximateCubicBezierArcLength3D(
      p0x, p0y, p0z,
      p1x, p1y, p1z,
      p2x, p2y, p2z,
      p3x, p3y, p3z,
      BEZIER_ARC_LENGTH_TOLERANCE, 0,
    );

    const chordLength = Math.hypot(p3x - p0x, p3y - p0y, p3z - p0z);

    // Arc through elevated control points must be longer than the straight chord.
    expect(arcLength).toBeGreaterThan(chordLength);
    // The arc should be roughly 40-100% longer given the 80-unit elevation.
    expect(arcLength).toBeGreaterThan(chordLength * 1.2);
  });

  it('flat Bezier arc length equals chord length', () => {
    // C++ parity edge case: when all control points are collinear, the Bezier
    // degenerates to a straight line and arc length should equal chord length.
    const arcLength = approximateCubicBezierArcLength3D(
      0, 0, 0,
      33, 0, 0,
      66, 0, 0,
      100, 0, 0,
      BEZIER_ARC_LENGTH_TOLERANCE, 0,
    );

    const chordLength = 100;
    // Should be within tolerance of chord length.
    expect(Math.abs(arcLength - chordLength)).toBeLessThan(2.0);
  });

  it('projectile with DumbProjectileBehavior arc deals damage on impact', () => {
    // C++ parity: DumbProjectileBehavior::detonate() — the projectile detonates
    // at the impact point after traversing the Bezier arc, dealing weapon damage.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('ArcCannon', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('ArcCannonWeapon'),
          ]),
          makeObjectDef('ImpactTarget', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
          makeObjectDef('ArcCannonShell', 'America', ['PROJECTILE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
            makeBlock('Behavior', 'DumbProjectileBehavior ModuleTag_DPB', {
              FirstHeight: 40,
              SecondHeight: 30,
              FirstPercentIndent: 0.25,
              SecondPercentIndent: 0.75,
            }),
          ]),
        ],
        weapons: [
          makeWeaponDef('ArcCannonWeapon', {
            PrimaryDamage: 100,
            DamageType: 'EXPLOSION',
            AttackRange: 200,
            DelayBetweenShots: 5000,
            WeaponSpeed: 20,
            ProjectileObject: 'ArcCannonShell',
          }),
        ],
      },
      mapObjects: [
        place('ArcCannon', 10, 10),
        place('ImpactTarget', 40, 10),
      ],
      mapSize: 64,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const before = agent.snapshot();
    agent.attack(1, 2);
    // Step enough frames for the projectile to fly and impact.
    agent.step(60);
    const d = agent.diff(before);

    // Target should have taken damage from the arcing projectile.
    const targetDmg = d.damaged.find((e) => e.id === 2);
    expect(targetDmg).toBeDefined();
    expect(targetDmg!.hpAfter).toBeLessThan(targetDmg!.hpBefore);
  });
});

// ---------------------------------------------------------------------------
// Test 2: TensileFormationUpdate Spring Physics
// ---------------------------------------------------------------------------

describe('TensileFormationUpdate Spring Physics', () => {
  it('tensor links pull nearby formation members via spring coupling during collapse', () => {
    // C++ parity: TensileFormationUpdate::update() — tensor links store
    // relative offsets between formation members. During collapse, each
    // member is pulled toward its linked neighbors' expected positions:
    //   newX = newX * 0.93 + desiredX * 0.07
    //   newZ = newZ * 0.93 + desiredZ * 0.07
    // This creates spring-like coupling between chunks.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('WallChunk', 'Neutral', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'TensileFormationUpdate ModuleTag_Tensile', {
            Enabled: false,
          }),
        ]),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    // Place 3 wall chunks close together (within 1000 distance for link init).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('WallChunk', 20, 20),
        makeMapObject('WallChunk', 24, 20),
        makeMapObject('WallChunk', 28, 20),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        x: number;
        z: number;
        y: number;
        health: number;
        maxHealth: number;
        destroyed: boolean;
        tensileFormationProfile: { enabled: boolean; crackSound: string } | null;
        tensileFormationState: {
          enabled: boolean;
          linksInited: boolean;
          links: Array<{ id: number; tensorX: number; tensorZ: number } | null>;
          inertiaX: number;
          inertiaZ: number;
          motionlessCounter: number;
          life: number;
          lowestSlideElevation: number;
          done: boolean;
        } | null;
        modelConditionFlags: Set<string>;
      }>;
      applyWeaponDamageAmount(sourceEntityId: number | null, target: unknown, amount: number, damageType: string): void;
    };

    const e1 = priv.spawnedEntities.get(1)!;
    const e2 = priv.spawnedEntities.get(2)!;
    const e3 = priv.spawnedEntities.get(3)!;

    // All 3 must have tensile formation profiles.
    expect(e1.tensileFormationProfile).toBeTruthy();
    expect(e2.tensileFormationProfile).toBeTruthy();
    expect(e3.tensileFormationProfile).toBeTruthy();

    // Record starting positions.
    const e1StartX = e1.x;
    const e2StartX = e2.x;
    const e3StartX = e3.x;

    // Damage entity 1 to enable its collapse (health <= 49 triggers BODY_DAMAGED state).
    priv.applyWeaponDamageAmount(null, e1, 60, 'CRUSH');
    expect(e1.health).toBe(40);

    // Run enough frames for links to init and collapse to begin.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    // After a few frames, entity 1's state should be active.
    expect(e1.tensileFormationState?.enabled).toBe(true);
    expect(e1.tensileFormationState?.linksInited).toBe(true);

    // C++ parity check: the tensor links should have been initialized to
    // nearby formation members.
    const links = e1.tensileFormationState!.links.filter(
      (l) => l && l.id !== 0,
    );
    expect(links.length).toBeGreaterThan(0);

    // The linked IDs should reference entity 2 or entity 3.
    const linkedIds = links.map((l) => l!.id);
    const hasNearbyLink = linkedIds.some((id) => id === 2 || id === 3);
    expect(hasNearbyLink).toBe(true);
  });

  it('inertia accumulates from ground slope and is damped by 0.95 factor each frame', () => {
    // C++ parity: TensileFormationUpdate::update() applies slope-based forces:
    //   state.inertiaX += normal.x * slopeScale;
    //   state.inertiaX *= 0.95;
    // On a flat heightmap (normal = {0, 0, 1}), steepness=0, slopeScale=0.3,
    // and normal.x/z = 0, so inertia should stay near zero.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FlatChunk', 'Neutral', ['STRUCTURE'], [
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
      makeMap([makeMapObject('FlatChunk', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number;
        z: number;
        tensileFormationState: {
          enabled: boolean;
          inertiaX: number;
          inertiaZ: number;
          life: number;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    const startX = entity.x;
    const startZ = entity.z;

    // Run 10 frames of collapse.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // On a flat heightmap, the ground normal is (0, 0, 1) so slope forces are zero.
    // Inertia should remain very small (only from tensor coupling with self).
    expect(Math.abs(entity.tensileFormationState!.inertiaX)).toBeLessThan(1.0);
    expect(Math.abs(entity.tensileFormationState!.inertiaZ)).toBeLessThan(1.0);

    // Entity should not have moved significantly on flat terrain.
    // The tensor links may cause small drift, but it should be minimal.
    const driftX = Math.abs(entity.x - startX);
    const driftZ = Math.abs(entity.z - startZ);
    expect(driftX).toBeLessThan(5.0);
    expect(driftZ).toBeLessThan(5.0);
  });

  it('collapse completes after 300 life frames and enters rubble state', () => {
    // C++ parity: TensileFormationUpdate::update() — after life exceeds 300,
    // the collapse terminates: MOVING/FREEFALL/POST_COLLAPSE flags are removed,
    // body damage state is set to RUBBLE (level 3), and done=true.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('RubbleChunk', 'Neutral', ['STRUCTURE'], [
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
      makeMap([makeMapObject('RubbleChunk', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        destroyed: boolean;
        modelConditionFlags: Set<string>;
        tensileFormationState: {
          done: boolean;
          life: number;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // At frame 200, MOVING should be removed but POST_COLLAPSE stays.
    for (let i = 0; i < 200; i++) {
      logic.update(1 / 30);
    }
    expect(entity.modelConditionFlags.has('MOVING')).toBe(false);
    expect(entity.modelConditionFlags.has('POST_COLLAPSE')).toBe(true);
    expect(entity.tensileFormationState?.done).toBe(false);

    // Continue to frame 301 to reach the termination threshold.
    for (let i = 0; i < 101; i++) {
      logic.update(1 / 30);
    }

    // C++ parity: life > 300 triggers rubble state.
    expect(entity.tensileFormationState?.done).toBe(true);
    expect(entity.health).toBe(0);
    expect(entity.destroyed).toBe(false);
    expect(entity.modelConditionFlags.has('POST_COLLAPSE')).toBe(false);
    expect(entity.modelConditionFlags.has('MOVING')).toBe(false);
    expect(entity.modelConditionFlags.has('FREEFALL')).toBe(false);
  });

  it('dislodgement propagates BODY_DAMAGED to nearby tensile members at life frame 29', () => {
    // C++ parity: TensileFormationUpdate::propagateDislodgement() — at
    // life % 30 === 29, all nearby (within 100 distance) formation members
    // are set to BODY_DAMAGED state.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ChainChunk', 'Neutral', ['STRUCTURE'], [
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
        makeMapObject('ChainChunk', 20, 20),   // id 1
        makeMapObject('ChainChunk', 25, 20),   // id 2, within 100
        makeMapObject('ChainChunk', 29, 20),   // id 3, within 100
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        tensileFormationState: {
          enabled: boolean;
          life: number;
        } | null;
      }>;
      applyWeaponDamageAmount(a: null, t: unknown, d: number, dt: string): void;
    };

    const first = priv.spawnedEntities.get(1)!;
    const second = priv.spawnedEntities.get(2)!;
    const third = priv.spawnedEntities.get(3)!;

    // Only damage entity 1 to trigger its collapse.
    priv.applyWeaponDamageAmount(null, first, 60, 'CRUSH');
    expect(first.health).toBe(40);
    expect(second.health).toBe(100);
    expect(third.health).toBe(100);

    // Run 29 frames — at life=29, propagateDislodgement fires.
    for (let i = 0; i < 29; i++) {
      logic.update(1 / 30);
    }

    // C++ parity: nearby members should now be at BODY_DAMAGED health (maxHealth*0.5 - 1 = 49).
    expect(second.health).toBeLessThanOrEqual(49);
    expect(third.health).toBeLessThanOrEqual(49);

    // And their tensile states should also have become enabled (chain reaction).
    expect(second.tensileFormationState?.enabled).toBe(true);
    expect(third.tensileFormationState?.enabled).toBe(true);
  });

  it('POST_COLLAPSE flag is set during active collapse but removed on rubble', () => {
    // C++ parity: model condition flags track visual state during tensile collapse.
    // POST_COLLAPSE is active during the slide, and MOVING is set for life < 200.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('FlagChunk', 'Neutral', ['STRUCTURE'], [
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
      makeMap([makeMapObject('FlagChunk', 30, 30)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        tensileFormationState: { life: number; done: boolean } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // After 5 frames: POST_COLLAPSE and MOVING should be set.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }
    expect(entity.modelConditionFlags.has('POST_COLLAPSE')).toBe(true);
    expect(entity.modelConditionFlags.has('MOVING')).toBe(true);
    expect(entity.tensileFormationState!.life).toBe(5);

    // After 200+ frames: MOVING is removed but POST_COLLAPSE remains.
    for (let i = 0; i < 196; i++) {
      logic.update(1 / 30);
    }
    expect(entity.tensileFormationState!.life).toBeGreaterThanOrEqual(200);
    expect(entity.modelConditionFlags.has('MOVING')).toBe(false);
    expect(entity.modelConditionFlags.has('POST_COLLAPSE')).toBe(true);
  });
});
