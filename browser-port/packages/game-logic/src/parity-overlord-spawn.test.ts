/**
 * Parity tests for Overlord damage state propagation to riders and
 * production exit spawn offset positioning.
 *
 * Test 1 — OverlordContain::onBodyDamageStateChange (OverlordContain.cpp:164-177):
 *   When the Overlord takes damage, its body damage state is propagated to the
 *   single contained rider. This only fires when exactly 1 rider is present
 *   and the new state is not BODY_RUBBLE.
 *
 * Test 2 — DefaultProductionExitUpdate::exitObjectViaDoor (DefaultProductionExitUpdate.cpp:74-95):
 *   Units spawn at UnitCreatePoint offset from the building center, rotated by the
 *   building's orientation angle. They should NOT spawn at the building center.
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
  makeCommandButtonDef,
  makeCommandSetDef,
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ── Test 1: Overlord Damage Propagation to Rider ────────────────────────────

describe('parity: Overlord damage state propagation to single rider', () => {
  /**
   * C++ source: OverlordContain.cpp:164-177
   *   void OverlordContain::onBodyDamageStateChange(...)
   *   {
   *     if( newState != BODY_RUBBLE  &&  m_containListSize == 1 )
   *     {
   *       Object *myGuy = m_containList.front();
   *       myGuy->getBodyModule()->setDamageState( newState );
   *     }
   *   }
   *
   * TS implementation: index.ts around line 26768-26778 —
   *   if (isOverlordOrHelix && newDamageState !== 3) {
   *     const riderIds = this.collectContainedEntityIds(target.id);
   *     if (riderIds.length === 1) {
   *       this.setEntityBodyDamageState(rider, newDamageState);
   *     }
   *   }
   *
   * Damage state thresholds (calcBodyDamageState):
   *   ratio > 0.5 => 0 (PRISTINE)
   *   ratio > 0.1 => 1 (DAMAGED)
   *   ratio > 0   => 2 (REALLYDAMAGED)
   *   else        => 3 (RUBBLE)
   */

  it('rider transitions to DAMAGED when Overlord is damaged below 50% health', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('PropagandaTower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'SmallGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('SmallGun', {
          AttackRange: 120,
          PrimaryDamage: 10,
          DelayBetweenShots: 1,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('PropagandaTower', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);

    // Load rider into overlord.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Rider starts at full health.
    const riderBefore = logic.getEntityState(2);
    expect(riderBefore).toBeDefined();
    expect(riderBefore!.health).toBe(200);

    // Damage overlord below 50% (DAMAGED threshold). 10 dmg/frame for ~80 frames.
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 80; i++) logic.update(1 / 30);

    // Overlord should be DAMAGED (health <= 500) but alive.
    const overlordState = logic.getEntityState(1);
    expect(overlordState).toBeDefined();
    expect(overlordState!.health).toBeLessThanOrEqual(500);
    expect(overlordState!.health).toBeGreaterThan(0);

    // Rider should have DAMAGED model condition and reduced health.
    // setEntityBodyDamageState sets health to maxHealth * 0.5 - 1 = 99 for DAMAGED state.
    const riderAfter = logic.getEntityState(2);
    expect(riderAfter).toBeDefined();
    expect(riderAfter!.modelConditionFlags ?? []).toContain('DAMAGED');
    expect(riderAfter!.health).toBeLessThan(200);
  });

  it('rider transitions to REALLYDAMAGED when Overlord is damaged below 10% health', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('Overlord', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
            ContainMax: 1,
            AllowInsideKindOf: 'PORTABLE_STRUCTURE',
          }),
        ]),
        makeObjectDef('PropagandaTower', 'China', ['PORTABLE_STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Attacker', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'HeavyGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('HeavyGun', {
          AttackRange: 120,
          PrimaryDamage: 20,
          DelayBetweenShots: 1,
        }),
      ],
    });
    const logic = createLogic();
    const map = makeMap([
      makeMapObject('Overlord', 20, 20),
      makeMapObject('PropagandaTower', 22, 20),
      makeMapObject('Attacker', 50, 20),
    ]);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap());
    logic.setTeamRelationship('China', 'America', 0);
    logic.setTeamRelationship('America', 'China', 0);

    // Load rider into overlord.
    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Damage overlord below 10% (REALLYDAMAGED threshold). 20 dmg/frame for ~60 frames = 1200 damage.
    // But Overlord has 1000 HP, so we need to stop before killing it.
    // Need health <= 100 (10%) but > 0. ~50 frames = 1000 damage, leaves ~0.
    // Use 46 frames = 920 damage, leaves 80 HP (8% < 10%).
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 1 });
    for (let i = 0; i < 46; i++) logic.update(1 / 30);

    // Overlord should be REALLYDAMAGED (health <= 100) but alive.
    const overlordState = logic.getEntityState(1);
    expect(overlordState).toBeDefined();
    expect(overlordState!.health).toBeLessThanOrEqual(100);
    expect(overlordState!.health).toBeGreaterThan(0);

    // Rider should have REALLYDAMAGED model condition.
    // setEntityBodyDamageState sets health to maxHealth * 0.1 - 1 = 19 for REALLYDAMAGED.
    const riderState = logic.getEntityState(2);
    expect(riderState).toBeDefined();
    expect(riderState!.modelConditionFlags ?? []).toContain('REALLYDAMAGED');
    expect(riderState!.health).toBeLessThan(100);
  });
});

// ── Test 2: Production Exit Spawn Offset ────────────────────────────────────

describe('parity: DefaultProductionExitUpdate spawn offset (UnitCreatePoint)', () => {
  /**
   * C++ source: DefaultProductionExitUpdate.cpp:74-95
   *   loc.Set( md->m_unitCreatePoint.x, md->m_unitCreatePoint.y, md->m_unitCreatePoint.z );
   *   transform->Transform_Vector( *transform, loc, &loc );
   *   newObj->setPosition( &createPoint );
   *
   * The unit is spawned at UnitCreatePoint, which is specified in the building's
   * local (model) space and then rotated/translated by the building's transform.
   * With a building at (100,100) facing angle=0 and UnitCreatePoint=[30,0,0],
   * the produced unit should appear at approximately (130,100), NOT at (100,100).
   *
   * TS implementation: production-spawn.ts resolveQueueSpawnLocation() applies
   * the rotation transform and offset, then spawnProducedUnit() places the entity
   * at that resolved position.
   */

  it('produced unit spawns at UnitCreatePoint offset from building, not at building center', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('USABarracks', 'America', ['STRUCTURE', 'FS_FACTORY'], [
          makeBlock('Body', 'StructureBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
          makeBlock('Behavior', 'ProductionUpdate ModuleTag_Prod', { MaxQueueEntries: 9 }),
          makeBlock('Behavior', 'DefaultProductionExitUpdate ModuleTag_Exit', {
            UnitCreatePoint: [30, 0, 0],
            NaturalRallyPoint: [60, 0, 0],
          }),
        ], {
          CommandSet: 'BarracksCommandSet',
        }),
        makeObjectDef('USARanger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ], { BuildCost: 100, BuildTime: 1 }),
      ],
      commandSets: [
        makeCommandSetDef('BarracksCommandSet', { '1': 'Cmd_TrainRanger' }),
      ],
      commandButtons: [
        makeCommandButtonDef('Cmd_TrainRanger', { Command: 'UNIT_BUILD', Object: 'USARanger' }),
      ],
    });

    const logic = createLogic();
    // Place factory at position (100, 100) on a sufficiently large map.
    const map = makeMap([makeMapObject('USABarracks', 100, 100)], 128, 128);
    logic.loadMapObjects(map, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.submitCommand({ type: 'setSideCredits', side: 'America', amount: 10000 });
    logic.update(1 / 30);

    // Queue a unit.
    const factoryId = logic.getRenderableEntityStates().find(e => e.templateName === 'USABarracks')!.id;
    logic.submitCommand({
      type: 'queueUnitProduction',
      entityId: factoryId,
      unitTemplateName: 'USARanger',
    });

    // Advance enough frames for the unit to be produced (BuildTime=1s = 30 frames + some buffer).
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Find the produced unit.
    const entities = logic.getRenderableEntityStates();
    const ranger = entities.find(e => e.templateName === 'USARanger');
    expect(ranger).toBeDefined();

    // The factory is at (100, 100) with angle=0 and UnitCreatePoint=[30, 0, 0].
    // In production-spawn.ts: x = producer.x + (local.x * cos(0) - local.y * sin(0)) = 100 + 30 = 130.
    // z = producer.z + (local.x * sin(0) + local.y * cos(0)) = 100 + 0 = 100.
    //
    // The unit may have moved slightly toward the rally point after spawning,
    // but it must NOT be at the factory center (100, 100). It should be near (130, 100).
    // Use getEntityState for precise pre-movement position or check that it's offset.
    const rangerState = logic.getEntityState(ranger!.id);
    expect(rangerState).toBeDefined();

    // The ranger was spawned at ~(130, 100) and may have walked toward the natural rally point.
    // Critical assertion: it is NOT at the factory center. The x coordinate must be offset.
    // The spawn point is at x=130. Even after walking, x should be >= 120 (moved further away
    // from the factory, toward the rally point at x=160+).
    expect(rangerState!.x).toBeGreaterThan(110);
    // Verify it is meaningfully offset from the factory center.
    const distFromFactory = Math.hypot(rangerState!.x - 100, rangerState!.z - 100);
    expect(distFromFactory).toBeGreaterThan(20);
  });
});
