/**
 * Parity tests for 13 missing fields across GarrisonContain, ProductionUpdate,
 * AutoHealBehavior, and SpawnBehavior.
 *
 * Validates that INI fields are correctly parsed and stored on entity profiles
 * with source-accurate defaults.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

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
// GarrisonContain — 5 missing fields
// ---------------------------------------------------------------------------
describe('GarrisonContain missing fields', () => {
  function makeGarrisonSetup(garrisonFields: Record<string, unknown> = {}) {
    const buildingDef = makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 1000,
        InitialHealth: 1000,
      }),
      makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
        ContainMax: 5,
        ...garrisonFields,
      }),
    ]);

    const bundle = makeBundle({ objects: [buildingDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestBuilding', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const entity = allEntities.values().next().value;
    return { logic, entity };
  }

  it('parses HealObjects (default false)', () => {
    const { entity } = makeGarrisonSetup();
    expect(entity.containProfile.healObjects).toBe(false);
  });

  it('parses HealObjects = true', () => {
    const { entity } = makeGarrisonSetup({ HealObjects: true });
    expect(entity.containProfile.healObjects).toBe(true);
  });

  it('parses MobileGarrison (default false)', () => {
    const { entity } = makeGarrisonSetup();
    expect(entity.containProfile.mobileGarrison).toBe(false);
  });

  it('parses MobileGarrison = true', () => {
    const { entity } = makeGarrisonSetup({ MobileGarrison: true });
    expect(entity.containProfile.mobileGarrison).toBe(true);
  });

  it('parses ImmuneToClearBuildingAttacks (default false)', () => {
    const { entity } = makeGarrisonSetup();
    expect(entity.containProfile.immuneToClearBuildingAttacks).toBe(false);
  });

  it('parses ImmuneToClearBuildingAttacks = true', () => {
    const { entity } = makeGarrisonSetup({ ImmuneToClearBuildingAttacks: true });
    expect(entity.containProfile.immuneToClearBuildingAttacks).toBe(true);
  });

  it('parses IsEnclosingContainer (default true for garrison)', () => {
    const { entity } = makeGarrisonSetup();
    expect(entity.containProfile.isEnclosingContainer).toBe(true);
  });

  it('parses IsEnclosingContainer = false', () => {
    const { entity } = makeGarrisonSetup({ IsEnclosingContainer: false });
    expect(entity.containProfile.isEnclosingContainer).toBe(false);
  });

  it('parses InitialRoster (default empty)', () => {
    const { entity } = makeGarrisonSetup();
    expect(entity.containProfile.initialRosterTemplateName).toBeNull();
    expect(entity.containProfile.initialRosterCount).toBe(0);
  });

  it('parses InitialRoster with template and count', () => {
    const { entity } = makeGarrisonSetup({ InitialRoster: 'AmericaInfantryRanger 3' });
    expect(entity.containProfile.initialRosterTemplateName).toBe('AMERICAINFANTRYRANGER');
    expect(entity.containProfile.initialRosterCount).toBe(3);
  });

  it('sets timeForFullHealFrames when HealObjects is true and TimeForFullHeal is specified', () => {
    // TimeForFullHeal is in ms, converted to frames. 1000ms at 30fps = 30 frames.
    const { entity } = makeGarrisonSetup({ HealObjects: true, TimeForFullHeal: 1000 });
    expect(entity.containProfile.timeForFullHealFrames).toBeGreaterThan(0);
  });

  it('keeps timeForFullHealFrames = 0 when HealObjects is false even with TimeForFullHeal', () => {
    const { entity } = makeGarrisonSetup({ HealObjects: false, TimeForFullHeal: 1000 });
    expect(entity.containProfile.timeForFullHealFrames).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ProductionUpdate — 3 missing fields
// ---------------------------------------------------------------------------
describe('ProductionUpdate missing fields', () => {
  function makeProductionSetup(productionFields: Record<string, unknown> = {}) {
    const factoryDef = makeObjectDef('TestFactory', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'ProductionUpdate ModuleTag_Production', {
        MaxQueueEntries: 6,
        ...productionFields,
      }),
    ]);

    const bundle = makeBundle({ objects: [factoryDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestFactory', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const entity = allEntities.values().next().value;
    return { logic, entity };
  }

  it('parses NumDoorAnimations (default 0)', () => {
    const { entity } = makeProductionSetup();
    expect(entity.productionProfile.numDoorAnimations).toBe(0);
  });

  it('parses NumDoorAnimations = 2', () => {
    const { entity } = makeProductionSetup({ NumDoorAnimations: 2 });
    expect(entity.productionProfile.numDoorAnimations).toBe(2);
  });

  it('parses DoorOpeningTime (default 0)', () => {
    const { entity } = makeProductionSetup();
    expect(entity.productionProfile.doorOpeningTimeFrames).toBe(0);
  });

  it('parses DoorOpeningTime as duration (ms to frames)', () => {
    // 1000ms at 30fps = 30 frames
    const { entity } = makeProductionSetup({ DoorOpeningTime: 1000 });
    expect(entity.productionProfile.doorOpeningTimeFrames).toBeGreaterThan(0);
  });

  it('parses ConstructionCompleteDuration (default 0)', () => {
    const { entity } = makeProductionSetup();
    expect(entity.productionProfile.constructionCompleteDurationFrames).toBe(0);
  });

  it('parses ConstructionCompleteDuration as duration (ms to frames)', () => {
    // 2000ms at 30fps = 60 frames
    const { entity } = makeProductionSetup({ ConstructionCompleteDuration: 2000 });
    expect(entity.productionProfile.constructionCompleteDurationFrames).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AutoHealBehavior — 3 missing fields
// ---------------------------------------------------------------------------
describe('AutoHealBehavior missing fields', () => {
  function makeAutoHealSetup(autoHealFields: Record<string, unknown> = {}) {
    const healerDef = makeObjectDef('TestHealer', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 200,
        InitialHealth: 200,
      }),
      makeBlock('Behavior', 'AutoHealBehavior ModuleTag_AutoHeal', {
        HealingAmount: 5,
        HealingDelay: 10,
        StartsActive: true,
        ...autoHealFields,
      }),
    ]);

    const bundle = makeBundle({ objects: [healerDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHealer', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const entity = allEntities.values().next().value;
    return { logic, entity };
  }

  it('parses RadiusParticleSystemName (default empty string)', () => {
    const { entity } = makeAutoHealSetup();
    expect(entity.autoHealProfile.radiusParticleSystemName).toBe('');
  });

  it('parses RadiusParticleSystemName with value', () => {
    const { entity } = makeAutoHealSetup({ RadiusParticleSystemName: 'HealRadiusFX' });
    expect(entity.autoHealProfile.radiusParticleSystemName).toBe('HealRadiusFX');
  });

  it('parses UnitHealPulseParticleSystemName (default empty string)', () => {
    const { entity } = makeAutoHealSetup();
    expect(entity.autoHealProfile.unitHealPulseParticleSystemName).toBe('');
  });

  it('parses UnitHealPulseParticleSystemName with value', () => {
    const { entity } = makeAutoHealSetup({ UnitHealPulseParticleSystemName: 'HealPulseFX' });
    expect(entity.autoHealProfile.unitHealPulseParticleSystemName).toBe('HealPulseFX');
  });

  it('parses SkipSelfForHealing (default false)', () => {
    const { entity } = makeAutoHealSetup();
    expect(entity.autoHealProfile.skipSelfForHealing).toBe(false);
  });

  it('parses SkipSelfForHealing = true', () => {
    const { entity } = makeAutoHealSetup({ SkipSelfForHealing: true });
    expect(entity.autoHealProfile.skipSelfForHealing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SpawnBehavior — 2 missing fields
// ---------------------------------------------------------------------------
describe('SpawnBehavior missing fields', () => {
  function makeSpawnSetup(spawnFields: Record<string, unknown> = {}) {
    const slaveDef = makeObjectDef('TestSlave', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 50,
        InitialHealth: 50,
      }),
    ]);

    const spawnerDef = makeObjectDef('TestSpawner', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
        SpawnNumber: 3,
        SpawnReplaceDelay: 5000,
        SpawnTemplateName: 'TestSlave',
        ...spawnFields,
      }),
    ]);

    const bundle = makeBundle({ objects: [spawnerDef, slaveDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestSpawner', 50, 50)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Entity ID 1 is the spawner (first entity from the map object).
    const allEntities = (logic as any).spawnedEntities as Map<number, any>;
    const spawnerEntity = allEntities.get(1);
    return { logic, entity: spawnerEntity };
  }

  it('parses CanReclaimOrphans (default false)', () => {
    const { entity } = makeSpawnSetup();
    expect(entity.spawnBehaviorState.profile.canReclaimOrphans).toBe(false);
  });

  it('parses CanReclaimOrphans = true', () => {
    const { entity } = makeSpawnSetup({ CanReclaimOrphans: true });
    expect(entity.spawnBehaviorState.profile.canReclaimOrphans).toBe(true);
  });

  it('parses ExitByBudding (default false)', () => {
    const { entity } = makeSpawnSetup();
    expect(entity.spawnBehaviorState.profile.exitByBudding).toBe(false);
  });

  it('parses ExitByBudding = true', () => {
    const { entity } = makeSpawnSetup({ ExitByBudding: true });
    expect(entity.spawnBehaviorState.profile.exitByBudding).toBe(true);
  });
});
