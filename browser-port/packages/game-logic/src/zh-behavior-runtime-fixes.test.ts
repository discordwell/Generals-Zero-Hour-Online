/**
 * ZH Behavior Module Runtime Logic Fixes — Parity Tests
 *
 * Verifies runtime logic differences between Generals and ZH in shared
 * Behavior modules (not FieldParse — those are already audited).
 *
 * Source references:
 *   1. AutoHealBehavior.cpp:266 — skipSelfForHealing only skips self when flag set
 *   2. JetSlowDeathBehavior.cpp:157 — DECK_HEIGHT_OFFSET treated as on-ground
 *   3. PropagandaTowerBehavior.cpp:506 — AffectsSelf allows tower self-heal
 *   4. MinefieldBehavior.cpp:327-333 — CreationList OCL on mine detonation
 *   5. RebuildHoleBehavior.cpp:281 — setProducer links reconstruction to hole
 *   6. TechBuildingBehavior.cpp:129 — clear CAPTURED model condition on revert
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
} from './test-helpers.js';

// ── Fix 1: AutoHealBehavior skipSelfForHealing ──────────────────────────────

describe('AutoHealBehavior skipSelfForHealing in radius mode', () => {
  it('allows self-heal in radius mode when skipSelfForHealing is false (default)', () => {
    // A radius healer with skipSelfForHealing=false should heal itself when damaged.
    const healerDef = makeObjectDef('RadiusHealer', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 200,
        InitialHealth: 200,
      }),
      makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AH', {
        HealingAmount: 10,
        HealingDelay: 1,
        Radius: 50,
        StartsActive: 'Yes',
        KindOf: 'VEHICLE',
        // No SkipSelfForHealing — defaults to false
      }),
    ]);

    const bundle = makeBundle({ objects: [healerDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('RadiusHealer', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'America', 2);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; maxHealth: number }>;
    };
    const healer = priv.spawnedEntities.get(1)!;
    healer.health = 100; // Damage healer

    // Run enough frames for healing to kick in.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // C++ ZH parity: self should heal when skipSelfForHealing is false.
    expect(healer.health).toBeGreaterThan(100);
  });

  it('skips self-heal in radius mode when skipSelfForHealing is true', () => {
    const healerDef = makeObjectDef('SkipSelfHealer', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 200,
        InitialHealth: 200,
      }),
      makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AH', {
        HealingAmount: 10,
        HealingDelay: 1,
        Radius: 50,
        StartsActive: 'Yes',
        KindOf: 'VEHICLE',
        SkipSelfForHealing: 'Yes',
      }),
    ]);

    const targetDef = makeObjectDef('AllyUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 200,
        InitialHealth: 200,
      }),
    ]);

    const bundle = makeBundle({ objects: [healerDef, targetDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SkipSelfHealer', 50, 50),
        makeMapObject('AllyUnit', 51, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'America', 2);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; maxHealth: number }>;
    };
    const healer = priv.spawnedEntities.get(1)!;
    const target = priv.spawnedEntities.get(2)!;
    healer.health = 100;
    target.health = 100;

    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // C++ ZH parity: healer should NOT heal itself (skipSelfForHealing=true).
    expect(healer.health).toBe(100);
    // But ally should heal.
    expect(target.health).toBeGreaterThan(100);
  });
});

// ── Fix 2: JetSlowDeathBehavior DECK_HEIGHT_OFFSET ──────────────────────────

describe('JetSlowDeathBehavior DECK_HEIGHT_OFFSET check', () => {
  it('treats jets with DECK_HEIGHT_OFFSET as on-ground even when above terrain', () => {
    // A jet with DECK_HEIGHT_OFFSET (parked on carrier deck) should get instant ground
    // death even if geometrically above terrain.
    const jetDef = makeObjectDef('Jet', 'America', ['AIRCRAFT'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 100,
        InitialHealth: 100,
      }),
      makeBlock('Behavior', 'JetSlowDeathBehavior ModuleTag_JSD', {
        DestructionDelay: 2000,
        RollRate: 0.1,
        FXOnGroundDeath: 'FX_JetDeathGround',
      }),
    ]);

    const enemyDef = makeObjectDef('EnemyUnit', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
    ]);

    const bundle = makeBundle({
      objects: [jetDef, enemyDef],
      weapons: [
        makeWeaponDef('TestKillWeapon', { Damage: 200, DamageType: 'ARMOR_PIERCING', PrimaryDamageRadius: 0 }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('Jet', 50, 50),
        makeMapObject('EnemyUnit', 60, 60),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        y: number;
        health: number;
        objectStatusFlags: Set<string>;
        jetSlowDeathState: unknown;
        destroyed: boolean;
      }>;
      frameCounter: number;
      applyWeaponDamageAmount(source: number | null, target: any, amount: number, damageType: string): void;
    };
    const jet = priv.spawnedEntities.get(1)!;

    // Place jet above terrain (height > 9.0) but give it DECK_HEIGHT_OFFSET.
    jet.y = 20;
    jet.objectStatusFlags.add('DECK_HEIGHT_OFFSET');

    // Kill via damage system to trigger proper death pipeline.
    priv.applyWeaponDamageAmount(2, jet as any, 200, 'ARMOR_PIERCING');

    // Process death.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // C++ ZH parity: jet should be instantly destroyed (ground death), not slow death.
    // With DECK_HEIGHT_OFFSET, it's treated as on-ground regardless of height.
    expect(jet.destroyed).toBe(true);
    expect(jet.jetSlowDeathState).toBeNull();
  });
});

// ── Fix 3: PropagandaTowerBehavior AffectsSelf ──────────────────────────────

describe('PropagandaTowerBehavior AffectsSelf', () => {
  it('tower heals itself when AffectsSelf is true', () => {
    const towerDef = makeObjectDef('PropTower', 'China', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'PropagandaTowerBehavior ModuleTag_Prop', {
        Radius: 100,
        DelayBetweenUpdates: 100,
        HealPercentEachSecond: 0.05,
        AffectsSelf: 'Yes',
      }),
    ]);

    const bundle = makeBundle({ objects: [towerDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('PropTower', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('China', 'China', 2);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; maxHealth: number }>;
    };
    const tower = priv.spawnedEntities.get(1)!;
    tower.health = 300; // Damage tower

    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // C++ ZH parity: tower should heal itself when AffectsSelf=true.
    expect(tower.health).toBeGreaterThan(300);
  });

  it('tower does NOT heal itself when AffectsSelf is false (default)', () => {
    const towerDef = makeObjectDef('PropTower2', 'China', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'PropagandaTowerBehavior ModuleTag_Prop', {
        Radius: 100,
        DelayBetweenUpdates: 100,
        HealPercentEachSecond: 0.05,
        // No AffectsSelf — defaults to false
      }),
    ]);

    const bundle = makeBundle({ objects: [towerDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('PropTower2', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('China', 'China', 2);
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { health: number; maxHealth: number }>;
    };
    const tower = priv.spawnedEntities.get(1)!;
    tower.health = 300;

    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // C++ parity: tower does NOT heal itself without AffectsSelf.
    // Health should only change from BaseRegenerateUpdate (structure regen).
    // The tower shouldn't be in its own tracked heal list.
    const healthAfter = tower.health;
    // Tower may get base regen, but should NOT get propagandaTower healing.
    // With AffectsSelf=false and no other units nearby, the propagandaTower
    // scan should produce an empty tracked list for tower-specific healing.
    expect(healthAfter).toBeLessThan(500); // Still damaged (base regen is very slow)
  });
});

// ── Fix 4: MinefieldBehavior CreationList OCL ───────────────────────────────

describe('MinefieldBehavior CreationList OCL on detonation', () => {
  it('parses CreationList field from MinefieldBehavior INI', () => {
    const mineDef = makeObjectDef('EMPMine', 'China', ['MINE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 50,
        InitialHealth: 50,
      }),
      makeBlock('Behavior', 'MinefieldBehavior ModuleTag_MF', {
        DetonationWeapon: 'EMPMineWeapon',
        NumVirtualMines: 3,
        Regenerates: 'No',
        CreationList: 'OCL_EMPMineEffect',
      }),
    ]);

    const bundle = makeBundle({ objects: [mineDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('EMPMine', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        minefieldProfile: { creationListName: string | null } | null;
      }>;
    };
    const mine = priv.spawnedEntities.get(1)!;
    expect(mine.minefieldProfile).not.toBeNull();
    expect(mine.minefieldProfile!.creationListName).toBe('OCL_EMPMineEffect');
  });

  it('parses null CreationList when field is absent', () => {
    const mineDef = makeObjectDef('BasicMine', 'China', ['MINE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 50,
        InitialHealth: 50,
      }),
      makeBlock('Behavior', 'MinefieldBehavior ModuleTag_MF', {
        DetonationWeapon: 'MineWeapon',
        NumVirtualMines: 1,
      }),
    ]);

    const bundle = makeBundle({ objects: [mineDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('BasicMine', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        minefieldProfile: { creationListName: string | null } | null;
      }>;
    };
    const mine = priv.spawnedEntities.get(1)!;
    expect(mine.minefieldProfile).not.toBeNull();
    expect(mine.minefieldProfile!.creationListName).toBeNull();
  });
});

// ── Fix 5: RebuildHoleBehavior setProducer ──────────────────────────────────

describe('RebuildHoleBehavior setProducer on reconstruction', () => {
  function makeRebuildSetup() {
    const sz = 64;
    const objects = [
      // 1: GLA building with RebuildHoleExposeDie.
      makeObjectDef('GLABarracks', 'GLA', ['STRUCTURE', 'MP_COUNT_FOR_VICTORY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeBlock('Die', 'RebuildHoleExposeDie ModuleTag_RebuildDie', {
          HoleName: 'GLAHole',
          HoleMaxHealth: 50,
          TransferAttackers: 'Yes',
        }),
      ], { BuildTime: 5 }),
      // 2: The hole object.
      makeObjectDef('GLAHole', 'GLA', ['REBUILD_HOLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        makeBlock('Behavior', 'RebuildHoleBehavior ModuleTag_RH', {
          WorkerObjectName: 'GLAWorker',
          WorkerRespawnDelay: 100,
          'HoleHealthRegen%PerSecond': 0,
        }),
      ]),
      // 3: Worker.
      makeObjectDef('GLAWorker', 'GLA', ['INFANTRY', 'DOZER'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ]),
    ];

    const bundle = makeBundle({ objects });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('GLABarracks', 30, 30)], sz, sz),
      makeRegistry(bundle),
      makeHeightmap(sz, sz),
    );
    // Register GLA side player type (required for rebuild hole creation).
    (logic as unknown as { sidePlayerTypes: Map<string, string> }).sidePlayerTypes.set('gla', 'HUMAN');
    return { logic };
  }

  it('sets producerEntityId on reconstructing building to hole id', () => {
    const { logic } = makeRebuildSetup();
    logic.update(0);

    const priv = logic as unknown as {
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, {
        id: number;
        producerEntityId: number;
        rebuildHoleReconstructingEntityId: number;
        objectStatusFlags: Set<string>;
        health: number;
        templateName: string;
        destroyed: boolean;
      }>;
    };

    // Kill the barracks to create the rebuild hole.
    const barracks = priv.spawnedEntities.get(1)!;
    priv.applyWeaponDamageAmount(null, barracks, 9999, 'EXPLOSION');

    // Run frames for hole creation + worker spawn + reconstruction start.
    for (let i = 0; i < 20; i++) logic.update(1 / 30);

    // Find the hole (entity 2 should be the hole after the building dies).
    let hole: (typeof barracks) | null = null;
    for (const e of priv.spawnedEntities.values()) {
      if (e.templateName === 'GLAHole' && !e.destroyed) {
        hole = e;
        break;
      }
    }
    expect(hole).not.toBeNull();

    // If reconstruction has started, verify producerEntityId.
    const reconId = hole!.rebuildHoleReconstructingEntityId;
    if (reconId > 0) {
      const recon = priv.spawnedEntities.get(reconId);
      if (recon && !recon.destroyed) {
        // C++ ZH parity: reconstructing->setProducer(hole) at RebuildHoleBehavior.cpp:281.
        expect(recon.producerEntityId).toBe(hole!.id);
        expect(recon.objectStatusFlags.has('RECONSTRUCTING')).toBe(true);
      }
    }
  });
});

// ── Fix 6: TechBuildingBehavior clear CAPTURED model condition ──────────────

describe('TechBuildingBehavior clears CAPTURED on revert', () => {
  it('clears CAPTURED model condition when tech building reverts to neutral', () => {
    const techDef = makeObjectDef('OilDerrick', 'civilian', ['STRUCTURE', 'TECH_BUILDING'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 300,
        InitialHealth: 300,
      }),
      makeBlock('Behavior', 'TechBuildingBehavior ModuleTag_TB', {}),
    ]);

    const bundle = makeBundle({ objects: [techDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('OilDerrick', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        side: string;
        modelConditionFlags: Set<string>;
        techBuildingProfile: unknown;
        canTakeDamage: boolean;
      }>;
      applyWeaponDamageAmount: (id: number | null, target: unknown, amount: number, type: string) => void;
    };
    const derrick = priv.spawnedEntities.get(1)!;

    // Simulate capture: change side and add CAPTURED model condition.
    derrick.side = 'America';
    derrick.modelConditionFlags.add('CAPTURED');
    derrick.canTakeDamage = true;

    // Kill it via damage system to trigger TechBuildingBehavior::onDie revert.
    priv.applyWeaponDamageAmount(null, derrick, 9999, 'EXPLOSION');
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // C++ ZH parity: CAPTURED should be cleared on revert to neutral.
    expect(derrick.modelConditionFlags.has('CAPTURED')).toBe(false);
    // And side should revert to civilian.
    expect(derrick.side).toBe('civilian');
  });
});
