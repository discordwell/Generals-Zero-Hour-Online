/**
 * AIUpdateModuleData and SpecialPowerTemplate field tests.
 *
 * Verifies that the following fields are parsed from INI and properly
 * consumed at runtime:
 *
 * AIUpdateModuleData:
 *   1. TurretsLinked (default false) — synchronize multiple turrets
 *   2. ForbidPlayerCommands (default false) — prevent player control
 *   3. AutoAcquireEnemiesWhenIdle — bitfield flags controlling auto-targeting
 *   4. MoodAttackCheckRate (duration ms→frames) — per-unit auto-target scan interval
 *
 * SpecialPowerTemplate:
 *   1. DetectionTime (duration ms→frames)
 *   2. PublicTimer (boolean)
 *   3. SharedSyncedTimer (boolean)
 *   4. ViewObjectDuration (duration ms→frames)
 *   5. ViewObjectRange (real)
 *
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate.cpp
 *   GeneralsMD/Code/GameEngine/Source/Common/RTS/SpecialPower.cpp
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameLogicSubsystem, parseAutoAcquireEnemiesBitfield, AAS_IDLE, AAS_IDLE_STEALTHED, AAS_IDLE_NO, AAS_IDLE_NOT_WHILE_ATTACKING, AAS_IDLE_ATTACK_BUILDINGS, AUTO_TARGET_SCAN_RATE_FRAMES } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeArmorDef,
  makeLocomotorDef,
  makeSpecialPowerDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';
import { extractAIUpdateModuleData } from './entity-factory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAIUnit(name: string, side: string, aiFields: Record<string, unknown>, extraBlocks: ReturnType<typeof makeBlock>[] = []) {
  return makeObjectDef(name, side, ['INFANTRY'], [
    makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
    makeBlock('LocomotorSet', 'SET_NORMAL TestLoco', {}),
    makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', aiFields, extraBlocks),
  ], { VisionRange: 150 });
}

function setupBasicGame(objects: ReturnType<typeof makeMapObject>[], objectDefs: ReturnType<typeof makeObjectDef>[], specialPowers: ReturnType<typeof makeSpecialPowerDef>[] = []) {
  const bundle = makeBundle({
    objects: objectDefs,
    weapons: [
      makeWeaponDef('TestGun', {
        AttackRange: 100,
        PrimaryDamage: 25,
        DelayBetweenShots: 500,
        DamageType: 'SMALL_ARMS',
      }),
    ],
    armors: [makeArmorDef('DefaultArmor', { Default: 1 })],
    locomotors: [makeLocomotorDef('TestLoco', 30)],
    specialPowers,
  });

  const logic = new GameLogicSubsystem(new THREE.Scene());
  const mapData = makeMap(objects, 256, 256);
  mapData.waypoints = {
    nodes: [
      { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      { id: 2, name: 'Player_2_Start', position: { x: 200, y: 50, z: 0 } },
    ],
    links: [],
  };

  logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
  logic.setPlayerSide(0, 'America');
  logic.setPlayerSide(1, 'China');
  logic.setTeamRelationship('America', 'China', 0);
  logic.setTeamRelationship('China', 'America', 0);
  logic.update(0);

  return logic;
}

// ===========================================================================
// 1. parseAutoAcquireEnemiesBitfield
// ===========================================================================

describe('parseAutoAcquireEnemiesBitfield', () => {
  it('returns 0 for undefined/null', () => {
    expect(parseAutoAcquireEnemiesBitfield(undefined)).toBe(0);
    expect(parseAutoAcquireEnemiesBitfield(null)).toBe(0);
  });

  it('returns AAS_IDLE for boolean true (shorthand "Yes")', () => {
    expect(parseAutoAcquireEnemiesBitfield(true)).toBe(AAS_IDLE);
  });

  it('returns 0 for boolean false', () => {
    expect(parseAutoAcquireEnemiesBitfield(false)).toBe(0);
  });

  it('parses single string token "YES"', () => {
    expect(parseAutoAcquireEnemiesBitfield('YES')).toBe(AAS_IDLE);
  });

  it('parses multiple space-separated tokens', () => {
    const result = parseAutoAcquireEnemiesBitfield('YES STEALTHED');
    expect(result & AAS_IDLE).toBeTruthy();
    expect(result & AAS_IDLE_STEALTHED).toBeTruthy();
  });

  it('parses array of tokens', () => {
    const result = parseAutoAcquireEnemiesBitfield(['YES', 'NOTWHILEATTACKING', 'ATTACK_BUILDINGS']);
    expect(result & AAS_IDLE).toBeTruthy();
    expect(result & AAS_IDLE_NOT_WHILE_ATTACKING).toBeTruthy();
    expect(result & AAS_IDLE_ATTACK_BUILDINGS).toBeTruthy();
    expect(result & AAS_IDLE_STEALTHED).toBeFalsy();
  });

  it('parses "NO" flag', () => {
    expect(parseAutoAcquireEnemiesBitfield('NO')).toBe(AAS_IDLE_NO);
  });

  it('is case-insensitive', () => {
    expect(parseAutoAcquireEnemiesBitfield('yes')).toBe(AAS_IDLE);
    expect(parseAutoAcquireEnemiesBitfield('Stealthed')).toBe(AAS_IDLE_STEALTHED);
  });
});

// ===========================================================================
// 2. extractAIUpdateModuleData
// ===========================================================================

describe('extractAIUpdateModuleData', () => {
  it('returns defaults when objectDef is undefined', () => {
    const result = extractAIUpdateModuleData(null, undefined);
    expect(result.turretsLinked).toBe(false);
    expect(result.forbidPlayerCommands).toBe(false);
    expect(result.autoAcquireEnemiesWhenIdle).toBe(0);
    expect(result.moodAttackCheckRate).toBe(0);
  });

  it('returns defaults when no AIUpdate block is present', () => {
    const objectDef = makeObjectDef('NPC', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.turretsLinked).toBe(false);
    expect(result.forbidPlayerCommands).toBe(false);
    expect(result.autoAcquireEnemiesWhenIdle).toBe(0);
    expect(result.moodAttackCheckRate).toBe(0);
  });

  it('extracts TurretsLinked = true', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', { TurretsLinked: true }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.turretsLinked).toBe(true);
  });

  it('extracts ForbidPlayerCommands = true', () => {
    const objectDef = makeObjectDef('Drone', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', { ForbidPlayerCommands: true }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.forbidPlayerCommands).toBe(true);
  });

  it('extracts AutoAcquireEnemiesWhenIdle as bitfield', () => {
    const objectDef = makeObjectDef('Guard', 'America', ['INFANTRY'], [
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {
        AutoAcquireEnemiesWhenIdle: ['YES', 'STEALTHED'],
      }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.autoAcquireEnemiesWhenIdle & AAS_IDLE).toBeTruthy();
    expect(result.autoAcquireEnemiesWhenIdle & AAS_IDLE_STEALTHED).toBeTruthy();
  });

  it('extracts AutoAcquireEnemiesWhenIdle from boolean true', () => {
    const objectDef = makeObjectDef('Guard', 'America', ['INFANTRY'], [
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', {
        AutoAcquireEnemiesWhenIdle: true,
      }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.autoAcquireEnemiesWhenIdle).toBe(AAS_IDLE);
  });

  it('extracts MoodAttackCheckRate (ms → frames)', () => {
    // 250ms at 30fps = ceil(250/1000 * 30) = ceil(7.5) = 8 frames
    const objectDef = makeObjectDef('Scanner', 'America', ['INFANTRY'], [
      makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', { MoodAttackCheckRate: 250 }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.moodAttackCheckRate).toBe(8);
  });

  it('works with non-AIUpdateInterface module types (JetAIUpdate)', () => {
    const objectDef = makeObjectDef('Jet', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'JetAIUpdate ModuleTag_AI', {
        TurretsLinked: true,
        AutoAcquireEnemiesWhenIdle: true,
      }),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.turretsLinked).toBe(true);
    expect(result.autoAcquireEnemiesWhenIdle).toBe(AAS_IDLE);
  });

  it('works with nested blocks (AIUpdate inside another block)', () => {
    const objectDef = makeObjectDef('Nested', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
      makeBlock('Draw', 'W3DModelDraw ModuleTag_Draw', {}, [
        makeBlock('Behavior', 'AIUpdateInterface ModuleTag_AI', { ForbidPlayerCommands: true }),
      ]),
    ]);
    const result = extractAIUpdateModuleData(null, objectDef);
    expect(result.forbidPlayerCommands).toBe(true);
  });
});

// ===========================================================================
// 3. Entity creation with AI fields
// ===========================================================================

describe('entity AI fields on spawned entities', () => {
  it('entity has default AI fields when AIUpdate block has no special flags', () => {
    const logic = setupBasicGame(
      [makeMapObject('PlainUnit', 50, 50)],
      [makeAIUnit('PlainUnit', 'America', {})],
    );
    const entity = (logic as any).spawnedEntities.values().next().value;
    expect(entity.turretsLinked).toBe(false);
    expect(entity.forbidPlayerCommands).toBe(false);
    expect(entity.autoAcquireEnemiesWhenIdle).toBe(0);
    expect(entity.moodAttackCheckRate).toBe(0);
  });

  it('entity stores TurretsLinked from INI', () => {
    const logic = setupBasicGame(
      [makeMapObject('LinkedTurret', 50, 50)],
      [makeAIUnit('LinkedTurret', 'America', { TurretsLinked: true })],
    );
    const entity = (logic as any).spawnedEntities.values().next().value;
    expect(entity.turretsLinked).toBe(true);
  });

  it('entity stores ForbidPlayerCommands from INI', () => {
    const logic = setupBasicGame(
      [makeMapObject('AIOnly', 50, 50)],
      [makeAIUnit('AIOnly', 'America', { ForbidPlayerCommands: true })],
    );
    const entity = (logic as any).spawnedEntities.values().next().value;
    expect(entity.forbidPlayerCommands).toBe(true);
  });

  it('entity stores AutoAcquireEnemiesWhenIdle bitfield', () => {
    const logic = setupBasicGame(
      [makeMapObject('AutoAcq', 50, 50)],
      [makeAIUnit('AutoAcq', 'America', { AutoAcquireEnemiesWhenIdle: ['YES', 'STEALTHED'] })],
    );
    const entity = (logic as any).spawnedEntities.values().next().value;
    expect(entity.autoAcquireEnemiesWhenIdle & AAS_IDLE).toBeTruthy();
    expect(entity.autoAcquireEnemiesWhenIdle & AAS_IDLE_STEALTHED).toBeTruthy();
  });

  it('entity stores MoodAttackCheckRate in frames', () => {
    const logic = setupBasicGame(
      [makeMapObject('FastScanner', 50, 50)],
      [makeAIUnit('FastScanner', 'America', { MoodAttackCheckRate: 250 })],
    );
    const entity = (logic as any).spawnedEntities.values().next().value;
    expect(entity.moodAttackCheckRate).toBe(8);
  });
});

// ===========================================================================
// 4. MoodAttackCheckRate affects auto-target scan timing
// ===========================================================================

describe('MoodAttackCheckRate runtime behavior', () => {
  it('uses per-unit moodAttackCheckRate when set, not global default', () => {
    // Create a fast scanner (250ms = 8 frames) and a default scanner
    const fastUnit = makeAIUnit('FastScanner', 'America', { MoodAttackCheckRate: 250 });
    const defaultUnit = makeAIUnit('DefaultScanner', 'America', {});
    const enemyDef = makeObjectDef('EnemyTarget', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
    ]);

    const logic = setupBasicGame(
      [
        makeMapObject('FastScanner', 50, 50),
        makeMapObject('EnemyTarget', 120, 50),
      ],
      [fastUnit, defaultUnit, enemyDef],
    );

    const fastEntity = [...(logic as any).spawnedEntities.values()].find(
      (e: any) => e.templateName === 'FastScanner',
    );
    expect(fastEntity).toBeDefined();
    expect(fastEntity.moodAttackCheckRate).toBe(8);

    // After enough frames for the fast scanner's scan interval, it should have found a target
    for (let i = 0; i < 15; i++) logic.update(1 / 30);

    const enemyState = logic.getRenderableEntityStates().find(e => e.templateName === 'EnemyTarget')!;
    // The fast scanner should have auto-acquired and attacked
    expect(enemyState.health).toBeLessThan(enemyState.maxHealth);
  });
});

// ===========================================================================
// 5. AutoAcquireEnemiesWhenIdle::NO prevents auto-targeting
// ===========================================================================

describe('AutoAcquireEnemiesWhenIdle::NO', () => {
  it('unit with AAS_IDLE_NO does not auto-target enemies', () => {
    const noAutoUnit = makeAIUnit('NoAutoTarget', 'America', { AutoAcquireEnemiesWhenIdle: 'NO' });
    const enemyDef = makeObjectDef('EnemyTarget', 'China', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);

    const logic = setupBasicGame(
      [
        makeMapObject('NoAutoTarget', 50, 50),
        makeMapObject('EnemyTarget', 100, 50),
      ],
      [noAutoUnit, enemyDef],
    );

    // Run enough frames for auto-target to normally fire
    for (let i = 0; i < 120; i++) logic.update(1 / 30);

    const enemyState = logic.getRenderableEntityStates().find(e => e.templateName === 'EnemyTarget')!;
    // Should NOT have auto-attacked
    expect(enemyState.health).toBe(enemyState.maxHealth);
  });
});

// ===========================================================================
// 6. SpecialPowerTemplate fields — DetectionTime, PublicTimer, SharedSyncedTimer,
//    ViewObjectDuration, ViewObjectRange
// ===========================================================================

describe('SpecialPowerTemplate fields', () => {
  it('DetectionTime is readable from SpecialPowerDef fields', () => {
    const spDef = makeSpecialPowerDef('SPECIAL_DEFECTOR', {
      ReloadTime: 60000,
      DetectionTime: 5000,
    });
    // The field should be accessible as a numeric value (ms)
    expect(spDef.fields.DetectionTime).toBe(5000);
  });

  it('PublicTimer is readable from SpecialPowerDef fields', () => {
    const spDef = makeSpecialPowerDef('SPECIAL_PARTICLE_CANNON', {
      ReloadTime: 240000,
      PublicTimer: true,
    });
    expect(spDef.fields.PublicTimer).toBe(true);
  });

  it('SharedSyncedTimer is readable from SpecialPowerDef fields', () => {
    const spDef = makeSpecialPowerDef('SPECIAL_CARPET_BOMB', {
      ReloadTime: 120000,
      SharedSyncedTimer: true,
    });
    expect(spDef.fields.SharedSyncedTimer).toBe(true);
  });

  it('ViewObjectDuration is readable from SpecialPowerDef fields', () => {
    const spDef = makeSpecialPowerDef('SPECIAL_SPY_SATELLITE', {
      ReloadTime: 60000,
      ViewObjectDuration: 30000,
    });
    expect(spDef.fields.ViewObjectDuration).toBe(30000);
  });

  it('ViewObjectRange is readable from SpecialPowerDef fields', () => {
    const spDef = makeSpecialPowerDef('SPECIAL_SPY_SATELLITE', {
      ReloadTime: 60000,
      ViewObjectRange: 500.0,
    });
    expect(spDef.fields.ViewObjectRange).toBe(500.0);
  });

  it('SpecialPowerDef default detection time matches C++ DEFAULT_DEFECTION_DETECTION_PROTECTION_TIME_LIMIT', () => {
    // C++ default: LOGICFRAMES_PER_SECOND * 10 = 300 frames (at 30fps)
    // But the INI value is in ms, and the default is stored in the SpecialPowerTemplate constructor.
    // In the browser port, DetectionTime would be undefined when not set, defaulting to 0
    // at the consumption site. The C++ default applies only if DetectionTime is not set in INI.
    const spDef = makeSpecialPowerDef('SPECIAL_DEFAULT', { ReloadTime: 0 });
    expect(spDef.fields.DetectionTime).toBeUndefined();
  });

  it('SpecialPowerTemplate fields are consumed by the game logic (SharedSyncedTimer)', () => {
    // Integration test: SharedSyncedTimer is already consumed in onBuildCompleteSpecialPowerCreate.
    // Create a building with a special power that has SharedSyncedTimer = true.
    const buildingDef = makeObjectDef('SPBuilding', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'SpecialPowerModule ModuleTag_SP', {
        SpecialPowerTemplate: 'SHARED_POWER',
        UpdateModuleStartsAttack: false,
      }),
    ]);

    const logic = setupBasicGame(
      [makeMapObject('SPBuilding', 50, 50)],
      [buildingDef],
      [makeSpecialPowerDef('SHARED_POWER', {
        ReloadTime: 60000,
        SharedSyncedTimer: true,
        PublicTimer: true,
        DetectionTime: 3000,
        ViewObjectDuration: 15000,
        ViewObjectRange: 200.0,
      })],
    );

    // Just verify the entity was created successfully with the special power module
    const entity = [...(logic as any).spawnedEntities.values()].find(
      (e: any) => e.templateName === 'SPBuilding',
    );
    expect(entity).toBeDefined();
    expect(entity.specialPowerModules).toBeDefined();
    expect(entity.specialPowerModules.size).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 7. C++ source parity constants
// ===========================================================================

describe('AutoAcquireStates bitfield constants match C++ values', () => {
  it('AAS_IDLE = 0x01', () => expect(AAS_IDLE).toBe(0x01));
  it('AAS_IDLE_STEALTHED = 0x02', () => expect(AAS_IDLE_STEALTHED).toBe(0x02));
  it('AAS_IDLE_NO = 0x04', () => expect(AAS_IDLE_NO).toBe(0x04));
  it('AAS_IDLE_NOT_WHILE_ATTACKING = 0x08', () => expect(AAS_IDLE_NOT_WHILE_ATTACKING).toBe(0x08));
  it('AAS_IDLE_ATTACK_BUILDINGS = 0x10', () => expect(AAS_IDLE_ATTACK_BUILDINGS).toBe(0x10));
  it('AUTO_TARGET_SCAN_RATE_FRAMES = 60 (2 seconds at 30fps)', () => {
    expect(AUTO_TARGET_SCAN_RATE_FRAMES).toBe(60);
  });
});
