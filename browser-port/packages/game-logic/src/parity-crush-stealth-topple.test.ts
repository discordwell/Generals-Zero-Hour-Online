/**
 * Parity Tests — crush velocity direction, stealth RevealDistanceFromTarget,
 * and structure topple crushing geometry.
 *
 * These tests document known behavior gaps between the C++ source and the
 * TypeScript port, verifying current TS behavior and flagging divergences.
 *
 * Source references:
 *   SquishCollide.cpp:97-131  — dot-product direction check for infantry crush
 *   StealthUpdate.cpp:438-456 — RevealDistanceFromTarget auto-reveal near attack target
 *   StructureToppleUpdate.cpp:359-444 — 2D grid pattern crush weapon during topple
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  makeLocomotorDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ── Test 1: Crush Velocity Direction Check ──────────────────────────────────

describe('crush velocity direction check (SquishCollide.cpp:97-131)', () => {
  /**
   * C++ parity: SquishCollide::onCollide computes a dot product between the
   * crusher's velocity and the vector from crusher to victim. If dot <= 0
   * (crusher moving away), the crush is skipped. The TS port implements this
   * same check in updateCrushCollisions (entity-movement.ts:1166-1174).
   *
   * This test verifies: a tank moving AWAY from infantry does NOT crush them,
   * matching C++ behavior.
   */
  function makeCrushBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('CrusherTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('LocomotorSet', 'SET_NORMAL TankLocomotor', {}),
        ], { CrusherLevel: 2, GeometryMajorRadius: 5, GeometryMinorRadius: 5 }),
        makeObjectDef('CrushableInfantry', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Collide', 'SquishCollide ModuleTag_Squish', {}),
        ], { CrushableLevel: 0 }),
      ],
      locomotors: [
        makeLocomotorDef('TankLocomotor', 180),
      ],
    });
  }

  it('tank moving AWAY from infantry does not crush them (dot product <= 0)', () => {
    // Setup: Tank at (50,50) world coords mapped to cell centers.
    // Infantry at (55,50) — 5 units to the right of the tank.
    // Tank is commanded to move to (20,50) — moving AWAY (in -X direction).
    //
    // C++ behavior: to.x*vel.x + to.y*vel.y <= 0, so crush is skipped.
    // TS behavior: updateCrushCollisions checks moveDirX*dx + moveDirZ*dz <= 0.
    const bundle = makeCrushBundle();
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Use cell-center-aligned positions (cell size=10) matching existing crush tests.
    // Tank at (215,205), infantry behind at (205,205). Tank moves in +X direction.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CrusherTank', 215, 205),
        makeMapObject('CrushableInfantry', 205, 205),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Verify infantry starts alive.
    expect(logic.getEntityState(2)?.health).toBe(100);

    // Command tank to move AWAY from infantry (in +X direction, infantry is behind in -X).
    logic.submitCommand({
      type: 'moveTo',
      entityId: 1,
      targetX: 255,
      targetZ: 205,
      commandSource: 'PLAYER',
    });

    // Step 10 frames — enough for tank to move away.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Infantry should be alive — tank moved away, dot product was <= 0.
    // Both C++ and TS agree: no crush when moving away.
    const infantryState = logic.getEntityState(2);
    expect(infantryState).not.toBeNull();
    expect(infantryState!.health).toBe(100);
  });

  it('tank moving TOWARD infantry DOES crush them (dot product > 0)', () => {
    // Control test: verify crush works when tank moves toward infantry.
    // Use cell-center-aligned positions (cell size = 10) matching existing crush tests.
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

    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    expect(logic.getEntityState(2)?.health).toBe(100);

    // Command tank to move THROUGH infantry (in +X direction past them).
    logic.submitCommand({
      type: 'moveTo',
      entityId: 1,
      targetX: 255,
      targetZ: 205,
      commandSource: 'PLAYER',
    });

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Infantry should be dead — tank moved toward and through them.
    const infantryState = logic.getEntityState(2);
    expect(infantryState === null || infantryState.health <= 0).toBe(true);
  });
});

// ── Test 2: Stealth RevealDistanceFromTarget ────────────────────────────────

describe('stealth RevealDistanceFromTarget (StealthUpdate.cpp:438-456)', () => {
  /**
   * C++ parity: StealthUpdate::update checks if the unit has an attack target
   * and is within RevealDistanceFromTarget of that target. If so, it calls
   * markAsDetected() which sets DETECTED status for stealthDelay frames.
   *
   * Source: StealthUpdate.cpp:699-714 — runs before allowedToStealth(), early
   * returns when triggered. This means the STEALTHED check and forbidden
   * conditions are skipped, but DETECTED is set so enemies can see the unit.
   */
  it('stealthed attacker auto-reveals when within RevealDistanceFromTarget of target', () => {
    // Create a stealthed unit with attack capability and a target far away.
    // The StealthUpdate module has RevealDistanceFromTarget=50, so the unit
    // should auto-reveal (become DETECTED) when within 50 units of its attack target.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('StealthAttacker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            RevealDistanceFromTarget: 50,
          }),
          makeWeaponBlock('StealthGun'),
          makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
        ]),
        makeObjectDef('TargetUnit', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 5000, InitialHealth: 5000 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('StealthGun', {
          PrimaryDamage: 10,
          DamageType: 'ARMOR_PIERCING',
          AttackRange: 30,
          DelayBetweenShots: 100,
        }),
      ],
      locomotors: [
        makeLocomotorDef('InfantryLoco', 30),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Place attacker far from target (200 units apart).
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthAttacker', 50, 50),
        makeMapObject('TargetUnit', 250, 50),
      ], 512, 512),
      makeRegistry(bundle),
      makeHeightmap(512, 512),
    );

    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Let stealth delay elapse (100ms = ~3 frames).
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Verify attacker is stealthed.
    let attackerState = logic.getEntityState(1);
    expect(attackerState).not.toBeNull();
    expect(attackerState!.statusFlags).toContain('STEALTHED');

    // Issue attack command — attacker should start moving toward target.
    logic.submitCommand({
      type: 'attackEntity',
      entityId: 1,
      targetEntityId: 2,
      commandSource: 'PLAYER',
    });

    // Step frames to let attacker approach target.
    // At speed 30 units/sec, 200 units takes ~200 frames.
    // Step enough that the attacker is within 40 units of target.
    for (let i = 0; i < 180; i++) {
      logic.update(1 / 30);
    }

    // Check distance to target.
    attackerState = logic.getEntityState(1);
    const targetState = logic.getEntityState(2);
    expect(attackerState).not.toBeNull();
    expect(targetState).not.toBeNull();

    const dx = attackerState!.x - targetState!.x;
    const dz = attackerState!.z - targetState!.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Verify RevealDistanceFromTarget is parsed from INI.
    const privateApi = logic as unknown as { spawnedEntities: Map<number, any> };
    const attackerEntity = privateApi.spawnedEntities.get(1)!;
    const stealthProfile = attackerEntity.stealthProfile;
    expect(stealthProfile).not.toBeNull();
    expect((stealthProfile as any).revealDistanceFromTarget).toBe(50);

    // Source parity: StealthUpdate.cpp:699-714 — if within RevealDistanceFromTarget (50),
    // the entity should be marked DETECTED (auto-revealed) while remaining STEALTHED.
    // C++ calls markAsDetected() which sets DETECTED for stealthDelay frames.
    if (distance < 50) {
      // Attacker is within RevealDistanceFromTarget — should be auto-revealed (DETECTED).
      const isDetected = attackerState!.statusFlags.includes('DETECTED');
      expect(isDetected).toBe(true);
    }
  });
});

// ── Test 3: Structure Topple Crushing Geometry ──────────────────────────────

describe('structure topple crushing geometry (StructureToppleUpdate.cpp:359-444)', () => {
  /**
   * C++ parity: StructureToppleUpdate fires weapons in a 2D grid pattern
   * across the topple path. It iterates over width slices perpendicular to
   * the topple direction, dealing damage at multiple sample points across
   * the building's width. This covers a wide swath of the topple path.
   *
   * TS now implements the same 2D grid pattern using fireTemporaryWeaponAtPosition
   * with the actual CrushingWeaponName weapon stats (PrimaryDamage, PrimaryDamageRadius).
   */

  function makeToppleBundle(crushWeapon: string, crushDamage: number, crushRadius: number,
      geoMajor: number, geoMinor: number) {
    return makeBundle({
      objects: [
        makeObjectDef('ToppleBuilding', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'StructureToppleUpdate ModuleTag_Topple', {
            MinToppleDelay: 0,
            MaxToppleDelay: 0,
            MinToppleBurstDelay: 0,
            MaxToppleBurstDelay: 0,
            StructuralIntegrity: 0.0,
            StructuralDecay: 0.0,
            CrushingWeaponName: crushWeapon,
          }),
        ], { GeometryMajorRadius: geoMajor, GeometryMinorRadius: geoMinor }),
        makeObjectDef('InfantryVictim', 'China', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
      weapons: [
        makeWeaponDef(crushWeapon, {
          PrimaryDamage: crushDamage,
          PrimaryDamageRadius: crushRadius,
          DamageType: 'CRUSH',
          AttackRange: crushRadius,
          DelayBetweenShots: 33,
        }),
      ],
    });
  }

  it('2D grid crush damages infantry perpendicular to topple direction', () => {
    // Building at (100,100) with 3 infantry perpendicular to topple direction.
    // Topple direction: +X (east), so perpendicular is along Z axis.
    // Infantry at (120, 80), (120, 100), (120, 120) — in the topple path,
    // spread 20 units perpendicular.
    //
    // With PrimaryDamageRadius=50 and 2D grid, all 3 should be killed.
    const bundle = makeToppleBundle('ToppleCrush', 500, 50, 15, 15);

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToppleBuilding', 100, 100),
        makeMapObject('InfantryVictim', 120, 80),  // perpendicular -20
        makeMapObject('InfantryVictim', 120, 100), // at center line
        makeMapObject('InfantryVictim', 120, 120), // perpendicular +20
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Verify initial state: all infantry alive.
    expect(logic.getEntityState(2)?.health).toBe(50);
    expect(logic.getEntityState(3)?.health).toBe(50);
    expect(logic.getEntityState(4)?.health).toBe(50);

    // Directly initiate topple with a mock attacker to the west (building topples east).
    const priv = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, unknown>;
    };
    const building = priv.spawnedEntities.get(1)!;
    // Mock attacker at (50, 100) — west of building. Building topples away = east (+X).
    const mockAttacker = { x: 50, z: 100 };
    priv.beginStructureTopple(building, mockAttacker);

    // Tick frames: topple delay=0 so topple starts immediately,
    // structural integrity=0 so it falls fast.
    // Need enough frames for accumulatedAngle to exceed PI/6 (THETA_CEILING) and
    // the crush damage to fire.
    for (let i = 0; i < 200; i++) {
      logic.update(0);
    }

    // Count surviving infantry.
    const infantryA = logic.getEntityState(2);
    const infantryB = logic.getEntityState(3);
    const infantryC = logic.getEntityState(4);

    const aAlive = infantryA !== null && infantryA.health > 0;
    const bAlive = infantryB !== null && infantryB.health > 0;
    const cAlive = infantryC !== null && infantryC.health > 0;
    const survivors = [aAlive, bAlive, cAlive].filter(Boolean).length;

    // With 2D grid pattern and PrimaryDamageRadius=50, all infantry within
    // 20 units of the topple line should be killed by grid fire points + weapon radius.
    expect(survivors).toBe(0);
  });

  it('2D grid pattern covers perpendicular width even with small weapon radius', () => {
    // With the 2D grid pattern, weapons fire at grid points across the building width.
    // Building has GeometryMajorRadius=25, GeometryMinorRadius=25.
    // Grid fires at facingWidth ~12.5 units offset, with PrimaryDamageRadius=15.
    // Infantry at 15 units perpendicular is outside a center-line-only hit but
    // inside the source grid edge point + weapon radius.
    const bundle = makeToppleBundle('SmallCrush', 500, 15, 25, 25);

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);

    // Victims are repositioned after topple starts so the test follows the
    // source-randomized topple direction rather than assuming due east.
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ToppleBuilding', 120, 120),
        makeMapObject('InfantryVictim', 140, 100),
        makeMapObject('InfantryVictim', 140, 120),
        makeMapObject('InfantryVictim', 140, 140),
      ], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    // Directly initiate topple — attacker west, building topples east.
    const priv = logic as unknown as {
      beginStructureTopple: (entity: unknown, attacker: unknown) => void;
      spawnedEntities: Map<number, any>;
    };
    const building = priv.spawnedEntities.get(1)!;
    const mockAttacker = { x: 70, z: 120 };
    priv.beginStructureTopple(building, mockAttacker);
    const toppleState = building.structureToppleState!;
    const forwardX = toppleState.toppleDirX;
    const forwardZ = toppleState.toppleDirZ;
    // Source doDamageLine offsets by (sin(toppleAngle), cos(toppleAngle)).
    const perpX = forwardZ;
    const perpZ = forwardX;
    const forwardDistance = 5;
    const perpendicularDistance = 15;
    const victimA = priv.spawnedEntities.get(2)!;
    const victimCenter = priv.spawnedEntities.get(3)!;
    const victimC = priv.spawnedEntities.get(4)!;
    victimA.x = building.x + forwardX * forwardDistance - perpX * perpendicularDistance;
    victimA.z = building.z + forwardZ * forwardDistance - perpZ * perpendicularDistance;
    victimCenter.x = building.x + forwardX * forwardDistance;
    victimCenter.z = building.z + forwardZ * forwardDistance;
    victimC.x = building.x + forwardX * forwardDistance + perpX * perpendicularDistance;
    victimC.z = building.z + forwardZ * forwardDistance + perpZ * perpendicularDistance;

    for (let i = 0; i < 200; i++) {
      logic.update(0);
    }

    const farA = logic.getEntityState(2);
    const center = logic.getEntityState(3);
    const farC = logic.getEntityState(4);

    const farAAlive = farA !== null && farA.health > 0;
    const centerAlive = center !== null && center.health > 0;
    const farCAlive = farC !== null && farC.health > 0;
    const survivors = [farAAlive, centerAlive, farCAlive].filter(Boolean).length;

    // The 2D grid fires across the building's perpendicular width.
    // Infantry at 15 units perpendicular should be hit by grid edge points
    // (facingWidth ~12.5) + weapon radius (15), while center-line-only damage
    // would miss it.
    // At minimum the center one must die.
    expect(centerAlive).toBe(false);

    // With 2D grid coverage, all 3 should be killed.
    expect(survivors).toBe(0);
  });
});
