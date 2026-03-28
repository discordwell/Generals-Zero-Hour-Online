import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

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

describe('ModelConditionUpgrade', () => {
  it('sets model condition flag on upgrade application', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('CondUnit', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'ModelConditionUpgrade ModuleTag_MCU', {
            TriggeredBy: 'Upgrade_Visual',
            ConditionFlag: 'UPGRADE',
          }),
        ]),
      ],
      upgrades: [makeUpgradeDef('Upgrade_Visual', { Type: 'PLAYER', BuildTime: 0.1, BuildCost: 0 })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(makeMap([makeMapObject('CondUnit', 50, 50)]), makeRegistry(bundle), makeHeightmap());
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    expect(entity.modelConditionFlags.has('UPGRADE')).toBe(false);

    logic.submitCommand({ type: 'applyUpgrade', entityId: 1, upgradeName: 'Upgrade_Visual' });
    logic.update(1 / 30);

    expect(entity.modelConditionFlags.has('UPGRADE')).toBe(true);
  });
});

describe('ModelConditionFlags sync', () => {
  it('sets DAMAGED / REALLYDAMAGED from body damage state', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const entity = logic.getRenderableEntityStates()[0]!;
    expect(entity.modelConditionFlags).toBeDefined();
    // Full health — no damage flags.
    expect(entity.modelConditionFlags!.includes('DAMAGED')).toBe(false);
    expect(entity.modelConditionFlags!.includes('REALLYDAMAGED')).toBe(false);

    // Directly set health below 50% threshold to trigger DAMAGED.
    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { health: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.health = 45;
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('DAMAGED')).toBe(true);
    expect(updated.modelConditionFlags!.includes('REALLYDAMAGED')).toBe(false);
  });

  it('sets REALLYDAMAGED when health below 10%', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { health: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.health = 5; // 5/100 = 0.05 < 0.1 threshold
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('DAMAGED')).toBe(true);
    expect(updated.modelConditionFlags!.includes('REALLYDAMAGED')).toBe(true);
  });

  it('does not set FIRING_A for idle entities', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('FIRING_A')).toBe(false);
  });

  it('does not set construction flags for completed buildings', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const entity = logic.getRenderableEntityStates()[0]!;
    expect(entity.modelConditionFlags!.includes('ACTIVELY_BEING_CONSTRUCTED')).toBe(false);
    expect(entity.modelConditionFlags!.includes('PARTIALLY_CONSTRUCTED')).toBe(false);
  });

  it('exposes modelConditionFlags array in RenderableEntityState', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestUnit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const states = logic.getRenderableEntityStates();
    expect(states.length).toBeGreaterThan(0);
    expect(Array.isArray(states[0]!.modelConditionFlags)).toBe(true);
  });

  it('exposes currentSpeed and maxSpeed in RenderableEntityState', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestUnit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(typeof state.currentSpeed).toBe('number');
    expect(typeof state.maxSpeed).toBe('number');
    expect(state.currentSpeed).toBe(0);
  });

  it('does not set SOLD for normal entities', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('SOLD')).toBe(false);
  });

  it('does not set MOVING for stationary entities', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('StillUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('StillUnit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('MOVING')).toBe(false);
  });

  it('does not set DYING for alive entities', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('AliveUnit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('AliveUnit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('DYING')).toBe(false);
  });

  it('sets SPECIAL_DAMAGED when bodyState >= 2 (REALLYDAMAGED threshold)', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { health: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.health = 5; // bodyState >= 2
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('SPECIAL_DAMAGED')).toBe(true);
  });

  it('does not set SPECIAL_DAMAGED at full health', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('SPECIAL_DAMAGED')).toBe(false);
  });

  it('sets TOPPLED when topple state is DONE', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tree', 'America', ['SHRUBBERY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Tree', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { toppleState: string }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.toppleState = 'DONE';
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('TOPPLED')).toBe(true);
  });

  it('does not set TOPPLED when topple state is NONE', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tree', 'America', ['SHRUBBERY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Tree', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('TOPPLED')).toBe(false);
  });

  it('sets PRONE when proneFramesRemaining > 0', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Infantry', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Infantry', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { proneFramesRemaining: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.proneFramesRemaining = 30;
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('PRONE')).toBe(true);
  });

  it('does not set PRONE when proneFramesRemaining is 0', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Infantry', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Infantry', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('PRONE')).toBe(false);
  });

  it('sets ATTACKING when entity has attack target', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { attackTargetEntityId: number | null }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.attackTargetEntityId = 999;
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('ATTACKING')).toBe(true);
  });

  it('does not set ATTACKING when entity has no attack target', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('ATTACKING')).toBe(false);
  });

  it('sets ENEMYNEAR when enemyNearDetected is true', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { enemyNearDetected: boolean }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.enemyNearDetected = true;
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('ENEMYNEAR')).toBe(true);
  });

  it('does not set ENEMYNEAR when enemyNearDetected is false', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('ENEMYNEAR')).toBe(false);
  });

  it('sets TURRET_ROTATE when turret state is AIM', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Tank', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { turretStates: Array<{ state: string; currentAngle: number; holdUntilFrame: number; targetEntityId: number | null }> }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.turretStates = [{ state: 'AIM', currentAngle: 0, holdUntilFrame: 0, targetEntityId: null }];
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('TURRET_ROTATE')).toBe(true);
  });

  it('does not set TURRET_ROTATE when no turrets are aiming', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Tank', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Tank', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('TURRET_ROTATE')).toBe(false);
  });

  it('sets WEAPONSET_VETERAN when weaponSetFlagsMask has VETERAN flag', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { weaponSetFlagsMask: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.weaponSetFlagsMask = 1; // WEAPON_SET_FLAG_VETERAN = 1 << 0
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('WEAPONSET_VETERAN')).toBe(true);
  });

  it('sets WEAPONSET_ELITE when weaponSetFlagsMask has ELITE flag', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { weaponSetFlagsMask: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.weaponSetFlagsMask = 2; // WEAPON_SET_FLAG_ELITE = 1 << 1
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('WEAPONSET_ELITE')).toBe(true);
  });

  it('sets WEAPONSET_HERO when weaponSetFlagsMask has HERO flag', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { weaponSetFlagsMask: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.weaponSetFlagsMask = 4; // WEAPON_SET_FLAG_HERO = 1 << 2
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('WEAPONSET_HERO')).toBe(true);
  });

  it('does not set WEAPONSET flags at default (zero) mask', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('WEAPONSET_VETERAN')).toBe(false);
    expect(state.modelConditionFlags!.includes('WEAPONSET_ELITE')).toBe(false);
    expect(state.modelConditionFlags!.includes('WEAPONSET_HERO')).toBe(false);
  });

  it('sets AFLAME when flameStatus is AFLAME', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { flameStatus: string }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.flameStatus = 'AFLAME';
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('AFLAME')).toBe(true);
    expect(updated.modelConditionFlags!.includes('BURNED')).toBe(false);
  });

  it('sets BURNED and SMOLDERING when flameStatus is BURNED', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { flameStatus: string }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.flameStatus = 'BURNED';
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('BURNED')).toBe(true);
    expect(updated.modelConditionFlags!.includes('SMOLDERING')).toBe(true);
    expect(updated.modelConditionFlags!.includes('AFLAME')).toBe(false);
  });

  it('does not set flame flags at NORMAL flameStatus', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('AFLAME')).toBe(false);
    expect(state.modelConditionFlags!.includes('BURNED')).toBe(false);
    expect(state.modelConditionFlags!.includes('SMOLDERING')).toBe(false);
  });

  it('sets CAPTURED when capturedFromOriginalOwner is true', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { capturedFromOriginalOwner: boolean }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.capturedFromOriginalOwner = true;
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('CAPTURED')).toBe(true);
  });

  it('does not set CAPTURED when capturedFromOriginalOwner is false', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Building', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Building', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    expect(state.modelConditionFlags!.includes('CAPTURED')).toBe(false);
  });

  it('sets CONSTRUCTION_COMPLETE for fully built buildings', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const state = logic.getRenderableEntityStates()[0]!;
    // Default constructionPercent is CONSTRUCTION_COMPLETE (-1), so should be set.
    expect(state.modelConditionFlags!.includes('CONSTRUCTION_COMPLETE')).toBe(true);
  });

  it('does not set CONSTRUCTION_COMPLETE when under construction', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('TestBuilding', 'America', ['STRUCTURE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('TestBuilding', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { constructionPercent: number }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.constructionPercent = 50;
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('CONSTRUCTION_COMPLETE')).toBe(false);
  });

  it('sets FIRING_B when firing with forcedWeaponSlot 1', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { attackSubState: string; forcedWeaponSlot: number | null; attackTargetEntityId: number | null }>;
      syncModelConditionFlags(entity: unknown): void;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.attackSubState = 'FIRING';
    internalEntity.forcedWeaponSlot = 1;
    internalEntity.attackTargetEntityId = 999;
    // Call syncModelConditionFlags directly to avoid attack subsystem resetting state.
    privateApi.syncModelConditionFlags(internalEntity);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('FIRING_B')).toBe(true);
    expect(updated.modelConditionFlags!.includes('FIRING_A')).toBe(false);
    expect(updated.modelConditionFlags!.includes('FIRING_C')).toBe(false);
  });

  it('sets FIRING_C when firing with forcedWeaponSlot 2', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { attackSubState: string; forcedWeaponSlot: number | null; attackTargetEntityId: number | null }>;
      syncModelConditionFlags(entity: unknown): void;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.attackSubState = 'FIRING';
    internalEntity.forcedWeaponSlot = 2;
    internalEntity.attackTargetEntityId = 999;
    // Call syncModelConditionFlags directly to avoid attack subsystem resetting state.
    privateApi.syncModelConditionFlags(internalEntity);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('FIRING_C')).toBe(true);
    expect(updated.modelConditionFlags!.includes('FIRING_A')).toBe(false);
    expect(updated.modelConditionFlags!.includes('FIRING_B')).toBe(false);
  });

  it('sets CONTINUOUS_FIRE_MEAN from continuousFireState', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { continuousFireState: string }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.continuousFireState = 'MEAN';
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('CONTINUOUS_FIRE_MEAN')).toBe(true);
    expect(updated.modelConditionFlags!.includes('CONTINUOUS_FIRE_FAST')).toBe(false);
  });

  it('sets both CONTINUOUS_FIRE_MEAN and CONTINUOUS_FIRE_FAST when state is FAST', () => {
    const bundle = makeBundle({
      objects: [makeObjectDef('Unit', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      ])],
    });
    const registry = makeRegistry(bundle);
    const map = makeMap([makeMapObject('Unit', 4, 4)]);
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap());
    logic.update(0);

    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, { continuousFireState: string }>;
    };
    const internalEntity = [...privateApi.spawnedEntities.values()][0]!;
    internalEntity.continuousFireState = 'FAST';
    logic.update(0);

    const updated = logic.getRenderableEntityStates()[0]!;
    expect(updated.modelConditionFlags!.includes('CONTINUOUS_FIRE_MEAN')).toBe(true);
    expect(updated.modelConditionFlags!.includes('CONTINUOUS_FIRE_FAST')).toBe(true);
  });
});

describe('ModelConditionFlags entity state flags', () => {
  function createLogicWithEntity() {
    const building = makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [building] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        cheerTimerFrames: number;
        raisingFlagTimerFrames: number;
        explodedState: 'NONE' | 'FLAILING' | 'BOUNCING' | 'SPLATTED';
      }>;
    };
    return { logic, entity: priv.spawnedEntities.get(1)! };
  }

  it('SPECIAL_CHEERING flag is set while cheerTimerFrames > 0 and clears when timer expires', () => {
    const { logic, entity } = createLogicWithEntity();
    entity.cheerTimerFrames = 3;

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('SPECIAL_CHEERING')).toBe(true);

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('SPECIAL_CHEERING')).toBe(true);

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('SPECIAL_CHEERING')).toBe(true);

    // After 3 decrements the timer should be 0, next tick clears the flag.
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('SPECIAL_CHEERING')).toBe(false);
  });

  it('RAISING_FLAG flag is set while raisingFlagTimerFrames > 0', () => {
    const { logic, entity } = createLogicWithEntity();
    entity.raisingFlagTimerFrames = 2;

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('RAISING_FLAG')).toBe(true);

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('RAISING_FLAG')).toBe(true);

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('RAISING_FLAG')).toBe(false);
  });

  it('EXPLODED_FLAILING flag is set when explodedState is FLAILING', () => {
    const { logic, entity } = createLogicWithEntity();
    entity.explodedState = 'FLAILING';

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('EXPLODED_FLAILING')).toBe(true);
    expect(entity.modelConditionFlags.has('EXPLODED_BOUNCING')).toBe(false);
    expect(entity.modelConditionFlags.has('SPLATTED')).toBe(false);
  });

  it('EXPLODED_BOUNCING flag is set when explodedState is BOUNCING', () => {
    const { logic, entity } = createLogicWithEntity();
    entity.explodedState = 'BOUNCING';

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('EXPLODED_BOUNCING')).toBe(true);
    expect(entity.modelConditionFlags.has('EXPLODED_FLAILING')).toBe(false);
  });

  it('SPLATTED flag is set when explodedState is SPLATTED', () => {
    const { logic, entity } = createLogicWithEntity();
    entity.explodedState = 'SPLATTED';

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('SPLATTED')).toBe(true);
    expect(entity.modelConditionFlags.has('EXPLODED_FLAILING')).toBe(false);
    expect(entity.modelConditionFlags.has('EXPLODED_BOUNCING')).toBe(false);
  });

  it('clears exploded flags when state returns to NONE', () => {
    const { logic, entity } = createLogicWithEntity();
    entity.explodedState = 'FLAILING';
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('EXPLODED_FLAILING')).toBe(true);

    entity.explodedState = 'NONE';
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('EXPLODED_FLAILING')).toBe(false);
    expect(entity.modelConditionFlags.has('EXPLODED_BOUNCING')).toBe(false);
    expect(entity.modelConditionFlags.has('SPLATTED')).toBe(false);
  });
});

describe('CLIMBING and FLOODED condition flags', () => {
  it('CLIMBING flag is set when entity is moving on a cliff cell', () => {
    const unit = makeObjectDef('ClimbUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [unit] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('ClimbUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        moving: boolean;
        x: number;
        z: number;
      }>;
      navigationGrid: { terrainType: Uint8Array; width: number; height: number } | null;
      worldToGrid: (x: number, z: number) => [number | null, number | null];
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Set entity moving on a cliff cell.
    entity.moving = true;
    if (priv.navigationGrid) {
      const [cellX, cellZ] = priv.worldToGrid(entity.x, entity.z);
      if (cellX !== null && cellZ !== null) {
        const idx = cellZ * priv.navigationGrid.width + cellX;
        priv.navigationGrid.terrainType[idx] = 2; // NAV_CLIFF
      }
    }

    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('CLIMBING')).toBe(true);

    // Stop moving — CLIMBING should clear.
    entity.moving = false;
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('CLIMBING')).toBe(false);
  });

  it('CLIMBING flag is not set on non-cliff terrain', () => {
    const unit = makeObjectDef('ClimbUnit2', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [unit] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('ClimbUnit2', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        moving: boolean;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Moving on normal terrain (not cliff) — CLIMBING should not be set.
    entity.moving = true;
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('CLIMBING')).toBe(false);
  });

  it('FLOODED flag is set when entity Y is below water height', () => {
    const building = makeObjectDef('FloodUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [building] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('FloodUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        y: number;
      }>;
      getWaterHeightAt(worldX: number, worldZ: number): number | null;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Mock water height by overriding getWaterHeightAt.
    const origWater = priv.getWaterHeightAt.bind(priv);
    (logic as any).getWaterHeightAt = (_x: number, _z: number) => 10;

    entity.y = 5; // Below water level (10).
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('FLOODED')).toBe(true);

    // Entity above water level.
    entity.y = 15;
    logic.update(1 / 30);
    expect(entity.modelConditionFlags.has('FLOODED')).toBe(false);

    // Restore.
    (logic as any).getWaterHeightAt = origWater;
  });

  it('FLOODED flag is not set when no water is present', () => {
    const building = makeObjectDef('DryUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [building] });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('DryUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        modelConditionFlags: Set<string>;
        y: number;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    entity.y = 0;
    logic.update(1 / 30);
    // No water polygons in the default heightmap, so FLOODED should not be set.
    expect(entity.modelConditionFlags.has('FLOODED')).toBe(false);
  });
});

describe('RadiusDecalUpdate', () => {
  function makeRadiusDecalSetup() {
    const unitDef = makeObjectDef('TestUnit', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
    ]);

    const bundle = makeBundle({ objects: [unitDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 3, 3)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);
    return { logic };
  }

  it('tracks radius decal position to entity position', () => {
    const { logic } = makeRadiusDecalSetup();
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number;
        z: number;
        radiusDecalStates: Array<{
          positionX: number;
          positionY: number;
          positionZ: number;
          radius: number;
          visible: boolean;
          killWhenNoLongerAttacking: boolean;
        }>;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Add a radius decal programmatically.
    entity.radiusDecalStates.push({
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      radius: 50,
      visible: true,
      killWhenNoLongerAttacking: false,
    });

    // Run a frame — decal should update to entity position.
    logic.update(1 / 30);

    expect(entity.radiusDecalStates.length).toBe(1);
    expect(entity.radiusDecalStates[0]!.positionX).toBe(entity.x);
    expect(entity.radiusDecalStates[0]!.positionZ).toBeCloseTo(entity.z, 1);
  });

  it('removes decal when kill-when-not-attacking and entity stops attacking', () => {
    const { logic } = makeRadiusDecalSetup();
    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        radiusDecalStates: Array<{
          positionX: number;
          positionY: number;
          positionZ: number;
          radius: number;
          visible: boolean;
          killWhenNoLongerAttacking: boolean;
        }>;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Mark entity as attacking and add a kill-when-not-attacking decal.
    entity.objectStatusFlags.add('IS_ATTACKING');
    entity.radiusDecalStates.push({
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      radius: 100,
      visible: true,
      killWhenNoLongerAttacking: true,
    });

    // While attacking, decal persists.
    logic.update(1 / 30);
    expect(entity.radiusDecalStates.length).toBe(1);

    // Stop attacking — decal should be removed.
    entity.objectStatusFlags.delete('IS_ATTACKING');
    logic.update(1 / 30);
    expect(entity.radiusDecalStates.length).toBe(0);
  });
});

describe('BoneFXUpdate', () => {
  function makeBoneFXSetup(opts: {
    fxListFields?: Record<string, string>;
    oclFields?: Record<string, string>;
    psysFields?: Record<string, string>;
    health?: number;
  } = {}) {
    const fields: Record<string, string> = {
      ...opts.fxListFields,
      ...opts.oclFields,
      ...opts.psysFields,
    };

    const buildingDef = makeObjectDef('BoneFXBuilding', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: opts.health ?? 500,
        InitialHealth: opts.health ?? 500,
      }),
      makeBlock('Behavior', 'BoneFXUpdate ModuleTag_BoneFX', fields),
    ]);

    const bundle = makeBundle({ objects: [buildingDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('BoneFXBuilding', 4, 4)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);
    return { logic };
  }

  it('extracts BoneFX profile from INI', () => {
    const { logic } = makeBoneFXSetup({
      fxListFields: {
        PristineFXList1: 'Bone:FXBone01 OnlyOnce:No 100 200 FXList:FXBoneFire',
        DamagedFXList1: 'Bone:FXBone02 OnlyOnce:Yes 0 0 FXList:FXDamageFire',
      },
      oclFields: {
        PristineOCL1: 'Bone:FXBone01 OnlyOnce:No 500 1000 OCL:OCLBoneDebris',
      },
      psysFields: {
        PristineParticleSystem1: 'Bone:FXBone01 OnlyOnce:No 100 200 PSys:SmokePlume',
      },
    });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        boneFXProfile: {
          fxLists: (null | { boneName: string; effectName: string; onlyOnce: boolean })[][];
          oclLists: (null | { boneName: string; effectName: string; onlyOnce: boolean })[][];
          particleSystems: (null | { boneName: string; effectName: string })[][];
        } | null;
        boneFXState: unknown;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.boneFXProfile).not.toBeNull();

    // Pristine FXList slot 0
    const pristineFX0 = entity.boneFXProfile!.fxLists[0]![0];
    expect(pristineFX0).not.toBeNull();
    expect(pristineFX0!.boneName).toBe('FXBone01');
    expect(pristineFX0!.effectName).toBe('FXBoneFire');
    expect(pristineFX0!.onlyOnce).toBe(false);

    // Damaged FXList slot 0
    const damagedFX0 = entity.boneFXProfile!.fxLists[1]![0];
    expect(damagedFX0).not.toBeNull();
    expect(damagedFX0!.boneName).toBe('FXBone02');
    expect(damagedFX0!.effectName).toBe('FXDamageFire');
    expect(damagedFX0!.onlyOnce).toBe(true);

    // Pristine OCL slot 0
    const pristineOCL0 = entity.boneFXProfile!.oclLists[0]![0];
    expect(pristineOCL0).not.toBeNull();
    expect(pristineOCL0!.boneName).toBe('FXBone01');
    expect(pristineOCL0!.effectName).toBe('OCLBoneDebris');

    // Pristine ParticleSystem slot 0
    const pristinePS0 = entity.boneFXProfile!.particleSystems[0]![0];
    expect(pristinePS0).not.toBeNull();
    expect(pristinePS0!.effectName).toBe('SmokePlume');

    // State should be initialized.
    expect(entity.boneFXState).not.toBeNull();
  });

  it('fires FX events at scheduled frames', () => {
    const { logic } = makeBoneFXSetup({
      fxListFields: {
        // Delay of 0 ms = immediate fire, repeating.
        PristineFXList1: 'Bone:FXBone01 OnlyOnce:No 0 0 FXList:FXBoneFire',
      },
    });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        boneFXState: {
          pendingVisualEvents: Array<{ type: string; effectName: string; boneName: string }>;
          active: boolean;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.boneFXState).not.toBeNull();

    // Run a few frames — events should fire.
    logic.update(1 / 30);
    expect(entity.boneFXState!.active).toBe(true);

    // After a frame, there should be pending visual events.
    logic.update(1 / 30);
    const events = entity.boneFXState!.pendingVisualEvents;
    // Should have at least one FX event per update cycle (delay=0 means fire every frame).
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.type).toBe('FX');
    expect(events[0]!.effectName).toBe('FXBoneFire');
    expect(events[0]!.boneName).toBe('FXBone01');
  });

  it('stops after first fire when onlyOnce is set', () => {
    const { logic } = makeBoneFXSetup({
      fxListFields: {
        // Use a small delay so it doesn't fire on the very first frame but fires soon after.
        PristineFXList1: 'Bone:FXBone01 OnlyOnce:Yes 100 100 FXList:FXOneShot',
      },
    });

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        boneFXState: {
          pendingVisualEvents: Array<{ type: string; effectName: string }>;
          nextFXFrame: number[][];
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.boneFXState).not.toBeNull();

    // The delay is ~3 frames (100ms * 30/1000 = 3). Run enough frames for it to fire.
    let firedCount = 0;
    for (let f = 0; f < 10; f++) {
      logic.update(1 / 30);
      firedCount += entity.boneFXState!.pendingVisualEvents.length;
    }

    // OnlyOnce should have fired exactly once across all frames.
    expect(firedCount).toBe(1);

    // The nextFXFrame for this slot should now be -1 (disabled).
    expect(entity.boneFXState!.nextFXFrame[0]![0]).toBe(-1);

    // Subsequent frames should not produce new events for this slot.
    logic.update(1 / 30);
    const eventsAfterFinal = entity.boneFXState!.pendingVisualEvents;
    expect(eventsAfterFinal.length).toBe(0);
  });

  it('reinitializes timers on body damage state transition', () => {
    const { logic } = makeBoneFXSetup({
      fxListFields: {
        PristineFXList1: 'Bone:FXBone01 OnlyOnce:No 100 100 FXList:FXPristine',
        DamagedFXList1: 'Bone:FXBone01 OnlyOnce:No 0 0 FXList:FXDamaged',
      },
      health: 100,
    });

    const entity = (logic as any).spawnedEntities.values().next().value;
    expect(entity.boneFXState).not.toBeNull();
    expect(entity.boneFXState!.currentBodyState).toBe(0); // PRISTINE

    // Trigger damage via the game logic damage system to properly fire boneFXChangeBodyDamageState
    const priv = logic as unknown as {
      applyWeaponDamageAmount: (sourceId: number | null, target: any, amount: number, damageType: string) => void;
    };
    priv.applyWeaponDamageAmount(null, entity, 60, 'EXPLOSION');
    logic.update(1 / 30);

    // After damage transition, the body state should be DAMAGED (1)
    expect(entity.boneFXState!.currentBodyState).toBe(1);
  });

  it('isGuarding is true when entity has active guard state', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GuardUnit', 'America', ['SELECTABLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('GuardUnit', 50, 50)]), makeRegistry(bundle), makeHeightmap());
    logic.update(0);

    // Initially not guarding.
    const states = logic.getRenderableEntityStates();
    const entityState = states[0]!;
    expect(entityState.isGuarding).toBe(false);

    // Manually set guard state and verify.
    const internalEntity = [...(logic as any).spawnedEntities.values()][0]!;
    internalEntity.guardState = 'GUARDING_POSITION';
    const updatedStates = logic.getRenderableEntityStates();
    const updatedState = updatedStates[0]!;
    expect(updatedState.isGuarding).toBe(true);
  });

  it('getEntityState exposes guardState field', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GuardUnit2', 'America', ['SELECTABLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(makeMap([makeMapObject('GuardUnit2', 50, 50)]), makeRegistry(bundle), makeHeightmap());
    logic.update(0);

    const entityId = [...(logic as any).spawnedEntities.keys()][0]!;

    // Initially guard state is NONE.
    const state = logic.getEntityState(entityId);
    expect(state).toBeTruthy();
    expect(state!.guardState).toBe('NONE');

    // Manually set guard state.
    const internalEntity = (logic as any).spawnedEntities.get(entityId);
    internalEntity.guardState = 'GUARDING_POSITION';
    const updatedState = logic.getEntityState(entityId);
    expect(updatedState!.guardState).toBe('GUARDING_POSITION');
  });
});
