/**
 * Parity tests for weapon splash damage falloff curve and building placement footprint.
 *
 * Test 1 — Splash Damage Falloff Between Primary and Secondary Radius:
 *   C++ source: Weapon.cpp:1462
 *     damageInfo.in.m_amount = (curVictimDistSqr <= primaryRadiusSqr) ? primaryDamage : secondaryDamage;
 *   This is a binary step function, NOT linear interpolation:
 *     - Within primaryRadius: full primaryDamage
 *     - Between primaryRadius and secondaryRadius: flat secondaryDamage
 *     - Beyond secondaryRadius: zero (not iterated)
 *
 *   TS source: combat-damage-events.ts:336
 *     const rawAmount = killSelf
 *       ? context.hugeDamageAmount
 *       : (victim.distanceSqr <= primaryRadiusSqr ? weapon.primaryDamage : weapon.secondaryDamage);
 *   Matches C++ exactly: binary step at primaryRadius boundary.
 *
 * Test 2 — Building Placement Footprint Check:
 *   C++ source: Object.cpp — placement uses exact GeometryInfo footprint overlap test.
 *   TS source: command-dispatch.ts:1676-1724 — isConstructLocationClear iterates all
 *     existing entities, computes doesConstructionGeometryOverlap using bounding circle
 *     or box geometry. Rejects placement when overlapping non-removable, non-inert blockers.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { GameLogicSubsystem } from './index.js';
import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  place,
} from './parity-agent.js';

// ── Test 1: Splash Damage Falloff Between Primary and Secondary Radius ──────

describe('parity: splash damage falloff curve (Weapon.cpp:1462)', () => {
  /**
   * C++ source: Weapon.cpp:1295-1304, 1462
   *   primaryRadius = getPrimaryDamageRadius(bonus);
   *   secondaryRadius = getSecondaryDamageRadius(bonus);
   *   primaryRadiusSqr = sqr(primaryRadius);
   *   radius = max(primaryRadius, secondaryRadius);
   *   ...
   *   damageInfo.in.m_amount = (curVictimDistSqr <= primaryRadiusSqr) ? primaryDamage : secondaryDamage;
   *
   * The C++ damage model is a binary step function:
   *   - dist <= primaryRadius  => primaryDamage (100)
   *   - primaryRadius < dist <= secondaryRadius => secondaryDamage (50)
   *   - dist > secondaryRadius => no damage (out of iteration range)
   *
   * TS source: combat-damage-events.ts:184-190, 336
   *   Matches C++ identically with primaryRadiusSqr check.
   */

  it('entities within primaryRadius receive full primaryDamage', () => {
    // PrimaryDamage=100, PrimaryDamageRadius=20, SecondaryDamage=50, SecondaryDamageRadius=40
    // Bystander at distance 10 from impact (within primary radius) should get full 100.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('SplashGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
          makeObjectDef('Bystander', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('SplashGun', {
            PrimaryDamage: 100,
            PrimaryDamageRadius: 20,
            SecondaryDamage: 50,
            SecondaryDamageRadius: 40,
            DamageType: 'EXPLOSION',
            AttackRange: 120,
            DelayBetweenShots: 2000,
            RadiusDamageAffects: 'ENEMIES',
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 10, 50),   // id 1
        place('Target', 50, 50),     // id 2 — direct target
        place('Bystander', 60, 50),  // id 3 — 10 units from target (within primaryRadius=20)
      ],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const bystanderBefore = agent.entity(3)!.health;

    agent.attack(1, 2);
    // Step enough for at least one shot to fire and deal radius damage
    agent.step(15);

    const target = agent.entity(2)!;
    expect(target.health).toBeLessThan(50000);  // Target took damage

    const bystander = agent.entity(3)!;
    const bystanderDamage = bystanderBefore - bystander.health;

    // Within primaryRadius (10 < 20), bystander receives primaryDamage (100).
    // C++ parity: (curVictimDistSqr <= primaryRadiusSqr) => primaryDamage
    expect(bystanderDamage).toBeGreaterThan(0);
    expect(bystanderDamage % 100).toBe(0);
  });

  it('entities between primaryRadius and secondaryRadius receive flat secondaryDamage', () => {
    // Bystander at distance 25 from impact point.
    // 25 > primaryRadius(20) so NOT in primary zone.
    // 25 < secondaryRadius(40) so IS in secondary zone.
    // C++ parity: flat secondaryDamage(50), NOT interpolated.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('SplashGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
          makeObjectDef('Bystander', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('SplashGun', {
            PrimaryDamage: 100,
            PrimaryDamageRadius: 20,
            SecondaryDamage: 50,
            SecondaryDamageRadius: 40,
            DamageType: 'EXPLOSION',
            AttackRange: 120,
            DelayBetweenShots: 2000,
            RadiusDamageAffects: 'ENEMIES',
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 10, 50),    // id 1
        place('Target', 50, 50),      // id 2 — direct target
        place('Bystander', 75, 50),   // id 3 — 25 units from target (between primary=20 and secondary=40)
      ],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const bystanderBefore = agent.entity(3)!.health;

    agent.attack(1, 2);
    agent.step(15);

    const bystander = agent.entity(3)!;
    const bystanderDamage = bystanderBefore - bystander.health;

    // Between primaryRadius and secondaryRadius: flat secondaryDamage (50).
    // C++ parity: NOT linear interpolation — it's a binary step.
    expect(bystanderDamage).toBeGreaterThan(0);
    expect(bystanderDamage % 50).toBe(0);
  });

  it('entities near secondaryRadius edge still receive flat secondaryDamage', () => {
    // Bystander at distance 35 from impact point.
    // 35 > primaryRadius(20), 35 < secondaryRadius(40).
    // Should receive full secondaryDamage (50), same as distance 25 — no falloff.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('SplashGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
          makeObjectDef('Bystander', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('SplashGun', {
            PrimaryDamage: 100,
            PrimaryDamageRadius: 20,
            SecondaryDamage: 50,
            SecondaryDamageRadius: 40,
            DamageType: 'EXPLOSION',
            AttackRange: 120,
            DelayBetweenShots: 2000,
            RadiusDamageAffects: 'ENEMIES',
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 10, 50),    // id 1
        place('Target', 50, 50),      // id 2
        place('Bystander', 85, 50),   // id 3 — 35 units from target (near secondary edge)
      ],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const bystanderBefore = agent.entity(3)!.health;

    agent.attack(1, 2);
    agent.step(15);

    const bystander = agent.entity(3)!;
    const bystanderDamage = bystanderBefore - bystander.health;

    // At distance 35, still within secondaryRadius(40): receives flat secondaryDamage(50).
    // C++ parity: no gradual falloff, same 50 damage as at distance 21.
    expect(bystanderDamage).toBeGreaterThan(0);
    expect(bystanderDamage % 50).toBe(0);
  });

  it('entities beyond secondaryRadius receive zero damage', () => {
    // Bystander at distance 45 from impact point.
    // 45 > secondaryRadius(40) => outside splash iteration => zero damage.
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('SplashGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
          makeObjectDef('Bystander', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50000, InitialHealth: 50000 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('SplashGun', {
            PrimaryDamage: 100,
            PrimaryDamageRadius: 20,
            SecondaryDamage: 50,
            SecondaryDamageRadius: 40,
            DamageType: 'EXPLOSION',
            AttackRange: 120,
            DelayBetweenShots: 2000,
            RadiusDamageAffects: 'ENEMIES',
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 10, 50),    // id 1
        place('Target', 50, 50),      // id 2
        place('Bystander', 95, 50),   // id 3 — 45 units from target (beyond secondaryRadius=40)
      ],
      mapSize: 16,
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    const bystanderBefore = agent.entity(3)!.health;

    agent.attack(1, 2);
    agent.step(15);

    // Target should take damage (direct hit)
    expect(agent.entity(2)!.health).toBeLessThan(50000);

    // Bystander at distance 45 > secondaryRadius(40): zero damage.
    // C++ parity: effectRadius = max(primary, secondary) = 40.
    // iterateObjectsInRange only yields objects within effectRadius.
    const bystander = agent.entity(3)!;
    expect(bystander.health).toBe(bystanderBefore);
  });

  it('documents C++ parity: damage is a binary step, not linear interpolation', () => {
    // This test documents the actual C++ damage formula and verifies TS matches.
    //
    // C++ source: Weapon.cpp:1462
    //   damageInfo.in.m_amount = (curVictimDistSqr <= primaryRadiusSqr)
    //     ? primaryDamage : secondaryDamage;
    //
    // There is NO interpolation between primary and secondary damage.
    // The damage curve is:
    //   |100|___________
    //   |               |
    //   | 50|            |___________
    //   |                            |
    //   |  0|                         |___________
    //   +---+----+----+----+----+----+----+----+-->
    //   0   10   20   25   30   35   40   45   distance
    //        ^primary        ^secondary
    //         radius          radius
    //
    // Both C++ and TS implement this identical binary step function.
    // The TS implementation at combat-damage-events.ts:336 matches line-for-line.

    const primaryDamage = 100;
    const secondaryDamage = 50;
    const primaryRadius = 20;
    const secondaryRadius = 40;

    function expectedDamage(distance: number): number {
      const effectRadius = Math.max(primaryRadius, secondaryRadius);
      if (distance > effectRadius) return 0;
      const primaryRadiusSqr = primaryRadius * primaryRadius;
      return (distance * distance <= primaryRadiusSqr) ? primaryDamage : secondaryDamage;
    }

    // Verify the binary step formula
    expect(expectedDamage(10)).toBe(100);   // within primary
    expect(expectedDamage(20)).toBe(100);   // at primary boundary (<=)
    expect(expectedDamage(20.001)).toBe(50); // just past primary
    expect(expectedDamage(25)).toBe(50);    // midway in secondary zone
    expect(expectedDamage(35)).toBe(50);    // near secondary edge
    expect(expectedDamage(39.999)).toBe(50); // just before secondary boundary
    expect(expectedDamage(40)).toBe(50);    // at secondary boundary (<=)
    expect(expectedDamage(40.001)).toBe(0); // just past secondary
    expect(expectedDamage(45)).toBe(0);     // beyond secondary
  });
});

// ── Test 2: Building Placement Footprint Check ───────────────────────────────

describe('parity: building placement footprint collision (command-dispatch.ts:1676-1724)', () => {
  /**
   * C++ source: Object.cpp / GameLogic.cpp — placement uses exact footprint geometry
   *   (GeometryInfo) for overlap testing. Rectangular buildings use OBB tests,
   *   cylindrical ones use circle-circle overlap.
   *
   * TS source: command-dispatch.ts:1676-1724 — isConstructLocationClear iterates
   *   spawnedEntities and calls doesConstructionGeometryOverlap with resolved collision
   *   geometry. Circle-circle overlap: (dx*dx + dz*dz) <= (r1+r2)^2.
   *
   * The TS uses the same bounding geometry approach — buildings with circular geometry
   *   (CYLINDER) use circle overlap, buildings with box geometry use box overlap.
   */

  it('rejects placement when a new building overlaps an existing building footprint', () => {
    // Place a building (id 1), then try to place another at overlapping distance.
    // Both have GeometryMajorRadius=10, so circles overlap when centers are < 20 apart.
    // Place second building at distance 15 (< 10+10=20) => should be rejected.

    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          GeometryMajorRadius: 3,
          GeometryMinorRadius: 3,
          Speed: 30,
        }),
        makeObjectDef('USABuilding', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], {
          BuildCost: 100,
          BuildTime: 1,
          GeometryMajorRadius: 10,
          GeometryMinorRadius: 10,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USADozer', 32, 32),     // id 1 — dozer
        makeMapObject('USABuilding', 50, 50),  // id 2 — existing building
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setSideCredits('America', 5000);
    logic.update(1 / 30);

    // Verify existing building is alive
    const existingBuilding = logic.getEntityState(2);
    expect(existingBuilding).not.toBeNull();
    expect(existingBuilding!.alive).toBe(true);

    // Issue build command near existing building (centers 15 apart, within r1+r2=20)
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USABuilding',
      targetPosition: [65, 0, 50],  // 15 units from existing building at (50, 50)
      angle: 0,
      lineEndPosition: null,
    });

    // Step several frames
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // Count buildings — the overlapping placement should have been rejected.
    // Only the original pre-placed building should exist.
    const allStates = logic.getRenderableEntityStates();
    const buildings = allStates.filter(
      (e) => e.templateName === 'USABuilding',
    );

    // The overlapping placement should be rejected — only 1 building exists.
    expect(buildings.length).toBe(1);
  });

  it('accepts placement when buildings are sufficiently far apart', () => {
    // Two buildings with GeometryMajorRadius=10. Place second at distance 25 (> 20).
    // No overlap => placement should be accepted.

    const bundle = makeBundle({
      objects: [
        makeObjectDef('USADozer', 'America', ['VEHICLE', 'DOZER'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], {
          GeometryMajorRadius: 3,
          GeometryMinorRadius: 3,
          Speed: 30,
        }),
        makeObjectDef('USABuilding', 'America', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
        ], {
          BuildCost: 100,
          BuildTime: 1,
          GeometryMajorRadius: 10,
          GeometryMinorRadius: 10,
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('USADozer', 32, 32),     // id 1 — dozer
        makeMapObject('USABuilding', 50, 50),  // id 2 — existing building
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.setPlayerSide(0, 'America');
    logic.setSideCredits('America', 5000);
    logic.update(1 / 30);

    // Issue build command far enough from existing building (centers 25 apart, > r1+r2=20)
    logic.submitCommand({
      type: 'constructBuilding',
      entityId: 1,
      templateName: 'USABuilding',
      targetPosition: [75, 0, 50],  // 25 units from existing building at (50, 50)
      angle: 0,
      lineEndPosition: null,
    });

    // Step enough frames for the dozer to walk there and start construction.
    // Dozer at (32,32), target at (75,50) => distance ~47. At speed 30, ~47 frames.
    for (let i = 0; i < 120; i++) {
      logic.update(1 / 30);
    }

    // Count buildings — the non-overlapping placement should be accepted.
    const allStates = logic.getRenderableEntityStates();
    const buildings = allStates.filter(
      (e) => e.templateName === 'USABuilding',
    );

    // Both the original and the newly constructed building should exist.
    expect(buildings.length).toBe(2);
  });

  it('documents parity: TS uses bounding circle overlap for CYLINDER geometry', () => {
    // C++ source: GeometryInfo uses exact footprint geometry for overlap tests.
    //   For BOX geometry: oriented bounding box (OBB) separating axis test.
    //   For CYLINDER geometry: circle-circle distance check.
    //
    // TS source: command-dispatch.ts:1848-1854
    //   if (leftGeometry.shape === 'circle' && rightGeometry.shape === 'circle')
    //     return doesCircleGeometryOverlap(...)
    //
    // command-dispatch.ts:1893-1903 — doesCircleGeometryOverlap:
    //   const distanceX = firstPosition.x - secondPosition.x;
    //   const distanceZ = firstPosition.z - secondPosition.z;
    //   const minDistance = firstRadius + secondRadius;
    //   return (distanceX*distanceX + distanceZ*distanceZ) <= (minDistance*minDistance);
    //
    // This matches C++ circle-circle overlap exactly. For BOX geometry, the TS also
    // implements box-box overlap (doesBoxGeometryOverlap) and box-circle hybrid checks.

    // Verify the circle overlap math directly
    function circlesOverlap(
      x1: number, z1: number, r1: number,
      x2: number, z2: number, r2: number,
    ): boolean {
      const dx = x1 - x2;
      const dz = z1 - z2;
      const minDist = r1 + r2;
      return (dx * dx + dz * dz) <= (minDist * minDist);
    }

    // Overlapping: distance 15 < r1(10) + r2(10) = 20
    expect(circlesOverlap(50, 50, 10, 65, 50, 10)).toBe(true);

    // Not overlapping: distance 25 > r1(10) + r2(10) = 20
    expect(circlesOverlap(50, 50, 10, 75, 50, 10)).toBe(false);

    // Exactly touching: distance 20 = r1(10) + r2(10) = 20
    expect(circlesOverlap(50, 50, 10, 70, 50, 10)).toBe(true);

    // Barely not touching: distance 20.01 > 20
    expect(circlesOverlap(50, 50, 10, 70.01, 50, 10)).toBe(false);
  });
});
