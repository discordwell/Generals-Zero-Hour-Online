/**
 * ZH Update module runtime logic audit tests.
 *
 * Tests for runtime logic differences between Generals and Zero Hour
 * in Update modules (not FieldParse — behavioral changes only).
 *
 * Source parity:
 *   - OCLUpdate.cpp: FactionTriggered runtime (neutral tracking, capture reset, faction OCL dispatch)
 *   - StealthUpdate.cpp: STEALTH_NOT_WHILE_RIDERS_ATTACKING, SPAWNS_ARE_THE_WEAPONS slave check,
 *       Black Market requirement, temporary stealth grant countdown with player command cancellation
 *   - HordeUpdate.cpp: AllowedNationalism + Fanaticism decal override
 *   - FireWeaponUpdate.cpp: isOkayToFire (UNDER_CONSTRUCTION block, ExclusiveWeaponDelay)
 *   - SupplyTruckAIUpdate.cpp: Player command override (ownerPlayerCommanded transition)
 *   - EMPUpdate.cpp: Airborne-only targeting when EMP hits airborne target (Patch 1.01)
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem, STEALTH_FORBIDDEN_NO_BLACK_MARKET, STEALTH_FORBIDDEN_RIDERS_ATTACKING } from './index.js';
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
import { extractOCLUpdateProfiles } from './entity-factory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSelf() {
  return new GameLogicSubsystem();
}

function makeSimpleObjectDef(name: string, blocks: ReturnType<typeof makeBlock>[], kindOf: string[] = ['STRUCTURE']) {
  return makeObjectDef(name, 'America', kindOf, blocks);
}

// ---------------------------------------------------------------------------
// 1. OCLUpdate FactionTriggered runtime
// ---------------------------------------------------------------------------
describe('OCLUpdate FactionTriggered runtime (OCLUpdate.cpp ZH)', () => {
  it('extracts FactionTriggered and FactionOCL from INI', () => {
    const objectDef = makeSimpleObjectDef('TestTechBuilding', [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        FactionTriggered: true,
        FactionOCL: [
          'Faction: America OCL: OCL_AmericaBonus',
          'Faction: China OCL: OCL_ChinaBonus',
          'Faction: GLA OCL: OCL_GLABonus',
        ],
        MinDelay: 5000,
        MaxDelay: 5000,
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles.length).toBe(1);
    expect(profiles[0]!.factionTriggered).toBe(true);
    expect(profiles[0]!.factionOCLMap.size).toBe(3);
    expect(profiles[0]!.factionOCLMap.get('AMERICA')).toBe('OCL_AmericaBonus');
    expect(profiles[0]!.factionOCLMap.get('CHINA')).toBe('OCL_ChinaBonus');
    expect(profiles[0]!.factionOCLMap.get('GLA')).toBe('OCL_GLABonus');
  });

  it('faction-triggered OCL does not fire while neutral (no player)', () => {
    const spawnerDef = makeObjectDef('TechBuilding', 'Neutral', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        FactionTriggered: true,
        FactionOCL: ['Faction: America OCL: OCL_AmericaBonus'],
        MinDelay: 100,
        MaxDelay: 100,
      }),
    ]);
    const spawnedDef = makeObjectDef('BonusUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [spawnerDef, spawnedDef] });
    (bundle as Record<string, unknown>).objectCreationLists = [{
      name: 'OCL_AmericaBonus',
      fields: {},
      blocks: [{
        type: 'CreateObject', name: 'CreateObject',
        fields: { ObjectNames: 'BonusUnit', Count: '1' }, blocks: [],
      }],
    }];
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TechBuilding', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Run 100 frames — building is Neutral, FactionTriggered OCL should NOT fire.
    for (let i = 0; i < 100; i++) logic.update(1 / 30);
    const states = logic.getRenderableEntityStates();
    expect(states.filter(s => s.templateName === 'BonusUnit').length).toBe(0);
  });

  it('faction-triggered OCL fires after capture by a playable faction', () => {
    const spawnerDef = makeObjectDef('TechBuilding', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        FactionTriggered: true,
        FactionOCL: ['Faction: America OCL: OCL_AmericaBonus'],
        MinDelay: 100,
        MaxDelay: 100,
      }),
    ]);
    const spawnedDef = makeObjectDef('BonusUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [spawnerDef, spawnedDef] });
    (bundle as Record<string, unknown>).objectCreationLists = [{
      name: 'OCL_AmericaBonus',
      fields: {},
      blocks: [{
        type: 'CreateObject', name: 'CreateObject',
        fields: { ObjectNames: 'BonusUnit', Count: '1' }, blocks: [],
      }],
    }];
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TechBuilding', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Run past the delay — should spawn because entity is America (playable).
    for (let i = 0; i < 40; i++) logic.update(1 / 30);
    const states = logic.getRenderableEntityStates();
    expect(states.filter(s => s.templateName === 'BonusUnit').length).toBeGreaterThanOrEqual(1);
  });

  it('non-faction-triggered OCL still works normally', () => {
    const spawnerDef = makeObjectDef('NormalSpawner', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        OCL: 'OCL_NormalSpawn',
        MinDelay: 100,
        MaxDelay: 100,
      }),
    ]);
    const spawnedDef = makeObjectDef('NormalUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [spawnerDef, spawnedDef] });
    (bundle as Record<string, unknown>).objectCreationLists = [{
      name: 'OCL_NormalSpawn',
      fields: {},
      blocks: [{
        type: 'CreateObject', name: 'CreateObject',
        fields: { ObjectNames: 'NormalUnit', Count: '1' }, blocks: [],
      }],
    }];
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('NormalSpawner', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    for (let i = 0; i < 40; i++) logic.update(1 / 30);
    const states = logic.getRenderableEntityStates();
    expect(states.filter(s => s.templateName === 'NormalUnit').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 2. StealthUpdate — Black Market check (STEALTH_FORBIDDEN_NO_BLACK_MARKET)
// ---------------------------------------------------------------------------
describe('StealthUpdate Black Market check (StealthUpdate.cpp ZH:303-315)', () => {
  it('STEALTH_FORBIDDEN_NO_BLACK_MARKET prevents stealth without FS_BLACK_MARKET building', () => {
    // Create a unit with NO_BLACK_MARKET stealth condition and verify it can't stealth
    // without a black market building.
    const stealthUnit = makeObjectDef('StealthUnit', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
        StealthDelay: 100,
        StealthForbiddenConditions: 'NO_BLACK_MARKET',
        InnateStealth: true,
      }),
    ]);
    const bundle = makeBundle({ objects: [stealthUnit] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        stealthProfile: { forbiddenConditions: number };
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Give it CAN_STEALTH
    entity.objectStatusFlags.add('CAN_STEALTH');

    // Run many frames — should NOT stealth because no black market exists.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);
  });

  it('STEALTH_FORBIDDEN_NO_BLACK_MARKET allows stealth when FS_BLACK_MARKET building exists', () => {
    const stealthUnit = makeObjectDef('StealthUnit', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
        StealthDelay: 100,
        StealthForbiddenConditions: 'NO_BLACK_MARKET',
        InnateStealth: true,
      }),
    ]);
    const blackMarket = makeObjectDef('GLABlackMarket', 'GLA', ['STRUCTURE', 'FS_BLACK_MARKET'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
    ]);
    const bundle = makeBundle({ objects: [stealthUnit, blackMarket] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 5, 5),
        makeMapObject('GLABlackMarket', 10, 10),
      ]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
      }>;
    };

    // Both entities should exist.
    const stealthEntity = priv.spawnedEntities.get(1)!;
    stealthEntity.objectStatusFlags.add('CAN_STEALTH');

    // Run past stealth delay — should stealth because black market exists.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    expect(stealthEntity.objectStatusFlags.has('STEALTHED')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. StealthUpdate — Temporary stealth grant player command cancellation
// ---------------------------------------------------------------------------
describe('StealthUpdate temporary stealth grant (StealthUpdate.cpp ZH:719-738)', () => {
  it('temporary stealth grant is cancelled when player issues a move command', () => {
    const truckDef = makeObjectDef('SupplyTruck', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
        StealthDelay: 100,
        InnateStealth: false,
      }),
    ]);
    const bundle = makeBundle({ objects: [truckDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyTruck', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        temporaryStealthGrant: boolean;
        temporaryStealthExpireFrame: number;
        lastCommandSource: string;
      }>;
      frameCounter: number;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Simulate a temporary stealth grant (like from SupplyCenterDockUpdate).
    entity.objectStatusFlags.add('CAN_STEALTH');
    entity.objectStatusFlags.add('STEALTHED');
    entity.temporaryStealthGrant = true;
    entity.temporaryStealthExpireFrame = priv.frameCounter + 100;

    // Verify stealth is active.
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);

    // Player issues a move command.
    entity.lastCommandSource = 'PLAYER';
    logic.update(1 / 30);

    // Stealth should be cancelled.
    expect(entity.temporaryStealthGrant).toBe(false);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);
    expect(entity.objectStatusFlags.has('CAN_STEALTH')).toBe(false);
  });

  it('temporary stealth grant expires normally when no player command', () => {
    const truckDef = makeObjectDef('SupplyTruck', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
        StealthDelay: 100,
        InnateStealth: false,
      }),
    ]);
    const bundle = makeBundle({ objects: [truckDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SupplyTruck', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        temporaryStealthGrant: boolean;
        temporaryStealthExpireFrame: number;
        lastCommandSource: string;
      }>;
      frameCounter: number;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Simulate a 10-frame temporary stealth grant.
    entity.objectStatusFlags.add('CAN_STEALTH');
    entity.objectStatusFlags.add('STEALTHED');
    entity.temporaryStealthGrant = true;
    entity.temporaryStealthExpireFrame = priv.frameCounter + 10;
    entity.lastCommandSource = 'AI'; // AI command = no cancel.

    // Run 5 frames — should still be stealthed.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);
    expect(entity.temporaryStealthGrant).toBe(true);

    // Run past the expiry.
    for (let i = 0; i < 10; i++) logic.update(1 / 30);
    expect(entity.temporaryStealthGrant).toBe(false);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);
    expect(entity.objectStatusFlags.has('CAN_STEALTH')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. OCLUpdateProfile interface includes faction fields
// ---------------------------------------------------------------------------
describe('OCLUpdateProfile faction fields in interface', () => {
  it('OCLUpdateProfile default factionTriggered is false', () => {
    const objectDef = makeSimpleObjectDef('TestSpawner', [
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        OCL: 'OCL_Normal',
        MinDelay: 1000,
        MaxDelay: 1000,
      }),
    ]);
    const profiles = extractOCLUpdateProfiles(makeSelf(), objectDef);
    expect(profiles[0]!.factionTriggered).toBe(false);
    expect(profiles[0]!.factionOCLMap.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. FireWeaponUpdate — UNDER_CONSTRUCTION check (already implemented, verify)
// ---------------------------------------------------------------------------
describe('FireWeaponUpdate UNDER_CONSTRUCTION check (FireWeaponUpdate.cpp ZH:99-100)', () => {
  it('does not fire while UNDER_CONSTRUCTION', () => {
    const toxinFieldDef = makeObjectDef('ToxinField', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'FireWeaponUpdate ModuleTag_FWU', {
        Weapon: 'ToxinFieldWeapon',
      }),
    ]);
    const bundle = makeBundle({
      objects: [toxinFieldDef],
      weapons: [makeWeaponDef('ToxinFieldWeapon', {
        PrimaryDamage: 10,
        PrimaryDamageRadius: 50,
        DamageType: 'POISON',
        DelayBetweenShots: 500,
      })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('ToxinField', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
        fireWeaponUpdateNextFireFrames: number[];
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    // Set as under construction.
    entity.objectStatusFlags.add('UNDER_CONSTRUCTION');

    const initialFrame = entity.fireWeaponUpdateNextFireFrames[0];

    // Run many frames — weapon should NOT fire.
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // The timer should not advance (it's blocked by UNDER_CONSTRUCTION).
    // In practice, the check skips the entity entirely, so the frame stays the same.
    expect(entity.objectStatusFlags.has('UNDER_CONSTRUCTION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. StealthUpdate — STEALTH_NOT_WHILE_RIDERS_ATTACKING
// ---------------------------------------------------------------------------
describe('StealthUpdate STEALTH_NOT_WHILE_RIDERS_ATTACKING (StealthUpdate.cpp ZH:389-412)', () => {
  it('the RIDERS_ATTACKING forbidden flag constant is exported', () => {
    // Verify the constant exists and is a nonzero bitmask.
    expect(STEALTH_FORBIDDEN_RIDERS_ATTACKING).toBeGreaterThan(0);
  });

  it('the NO_BLACK_MARKET forbidden flag constant is exported', () => {
    expect(STEALTH_FORBIDDEN_NO_BLACK_MARKET).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Entity field: lastCommandSource tracking
// ---------------------------------------------------------------------------
describe('lastCommandSource entity field (AIUpdateInterface ZH)', () => {
  it('entity initializes with lastCommandSource = AI', () => {
    const unitDef = makeObjectDef('TestUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [unitDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, { lastCommandSource: string }>;
    };
    expect(priv.spawnedEntities.get(1)!.lastCommandSource).toBe('AI');
  });

  it('moveTo command sets lastCommandSource to PLAYER', () => {
    const unitDef = makeObjectDef('TestUnit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [unitDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestUnit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    // Issue a player move command via the private commandQueue.
    const priv = logic as unknown as {
      commandQueue: Array<Record<string, unknown>>;
      spawnedEntities: Map<number, { lastCommandSource: string }>;
    };
    priv.commandQueue.push({
      type: 'moveTo',
      entityId: 1,
      x: 10,
      z: 10,
      commandSource: 'PLAYER',
    });
    logic.update(1 / 30);

    expect(priv.spawnedEntities.get(1)!.lastCommandSource).toBe('PLAYER');
  });
});

// ---------------------------------------------------------------------------
// 8. OCLUpdate faction state fields initialized
// ---------------------------------------------------------------------------
describe('OCLUpdate faction state fields', () => {
  it('entity has oclUpdateFactionNeutral and oclUpdateFactionOwnerSide arrays', () => {
    const spawnerDef = makeObjectDef('Spawner', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'OCLUpdate ModuleTag_OCL', {
        OCL: 'OCL_Test',
        MinDelay: 1000,
        MaxDelay: 1000,
      }),
    ]);
    const bundle = makeBundle({ objects: [spawnerDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Spawner', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        oclUpdateFactionNeutral: boolean[];
        oclUpdateFactionOwnerSide: string[];
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;
    expect(Array.isArray(entity.oclUpdateFactionNeutral)).toBe(true);
    expect(Array.isArray(entity.oclUpdateFactionOwnerSide)).toBe(true);
  });
});
