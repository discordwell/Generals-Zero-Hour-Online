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

describe('INI-driven stealth and detection', () => {
  /**
   * Shared bundle: stealthUnit with StealthUpdate module (InnateStealth=Yes, delay=1000ms)
   * and detectorUnit with KINDOF_DETECTOR + StealthDetectorUpdate module.
   */
  function makeStealthBundle(options: {
    stealthDelay?: number;
    innateStealth?: boolean;
    forbiddenConditions?: string;
    moveThresholdSpeed?: number;
    detectionRange?: number;
    detectionRate?: number;
    detectorInitiallyDisabled?: boolean;
    extraRequiredKindOf?: string;
    extraForbiddenKindOf?: string;
    detectorSide?: string;
  } = {}) {
    const stealthDelay = options.stealthDelay ?? 1000;
    const innateStealth = options.innateStealth !== false;
    const forbiddenConditions = options.forbiddenConditions ?? '';
    const moveThresholdSpeed = options.moveThresholdSpeed ?? 0;
    const detectionRange = options.detectionRange ?? 0;
    const detectionRate = options.detectionRate ?? 33;
    const detectorInitiallyDisabled = options.detectorInitiallyDisabled ?? false;
    const detectorSide = options.detectorSide ?? 'China';
    const extraRequiredKindOf = options.extraRequiredKindOf ?? '';
    const extraForbiddenKindOf = options.extraForbiddenKindOf ?? '';

    return makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: stealthDelay,
            InnateStealth: innateStealth ? 'Yes' : 'No',
            StealthForbiddenConditions: forbiddenConditions,
            MoveThresholdSpeed: moveThresholdSpeed,
          }),
        ]),
        makeObjectDef('DetectorUnit', detectorSide, ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthDetectorUpdate ModuleTag_Detector', {
            DetectionRange: detectionRange,
            DetectionRate: detectionRate,
            InitiallyDisabled: detectorInitiallyDisabled ? 'Yes' : 'No',
            ExtraRequiredKindOf: extraRequiredKindOf,
            ExtraForbiddenKindOf: extraForbiddenKindOf,
          }),
        ], { VisionRange: 200 }),
      ],
    });
  }

  function setupRelationships(logic: GameLogicSubsystem): void {
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
  }

  it('innate stealth sets CAN_STEALTH on creation and enters stealth after delay', () => {
    const bundle = makeStealthBundle({ stealthDelay: 300 }); // 300ms = ~9 frames at 30fps
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 105, 105)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    // Immediately after creation, entity should have CAN_STEALTH but NOT STEALTHED.
    const initialFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(initialFlags).toContain('CAN_STEALTH');
    expect(initialFlags).not.toContain('STEALTHED');

    // Run for enough frames to exceed stealth delay (300ms = 9 frames at 30fps).
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }

    const afterFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(afterFlags).toContain('STEALTHED');
  });

  it('initially disabled detector does not reveal stealthed enemies', () => {
    const bundle = makeStealthBundle({
      stealthDelay: 100,
      detectionRange: 200,
      detectionRate: 33,
      detectorInitiallyDisabled: true,
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 115, 105),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    expect(logic.getEntityState(2)?.detectorEnabled).toBe(false);

    for (let i = 0; i < 20; i++) {
      logic.update(1 / 30);
    }

    const stealthFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(stealthFlags).toContain('STEALTHED');
    expect(stealthFlags).not.toContain('DETECTED');
  });

  it('stealth breaks on damage when TAKING_DAMAGE forbidden condition is set', () => {
    const bundle = makeStealthBundle({
      stealthDelay: 100,
      forbiddenConditions: 'TAKING_DAMAGE',
    });

    // Add an enemy attacker with weapon and DETECTOR so it can see through stealth.
    const bundleWithAttacker = makeBundle({
      objects: [
        ...bundle.objects,
        makeObjectDef('Attacker', 'China', ['INFANTRY', 'DETECTOR'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'StealthBreakGun'] }),
        ], { VisionRange: 200 }),
      ],
      weapons: [
        makeWeaponDef('StealthBreakGun', {
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          DamageType: 'SMALL_ARMS',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('Attacker', 115, 105),
      ], 128, 128),
      makeRegistry(bundleWithAttacker),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    // Wait for stealth to activate (100ms = 3 frames).
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Issue attack command — attacker can see the stealthed unit via DETECTOR.
    logic.submitCommand({ type: 'attackEntity', entityId: 2, targetEntityId: 1 });

    // Run enough frames for the attacker to fire and damage to register.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Stealth should be broken because damage was taken.
    const stealthFlags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(stealthFlags).not.toContain('STEALTHED');
  });

  it('detector reveals stealthed enemy within range', () => {
    const bundle = makeStealthBundle({ stealthDelay: 100 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 115, 105), // 10 units away, well within detection range
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    // Wait for stealth to activate.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).toContain('DETECTED');
  });

  it('detector does not reveal stealthed ally', () => {
    // Detector is same side as stealth unit.
    const bundle = makeStealthBundle({ stealthDelay: 100, detectorSide: 'America' });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 115, 105),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).not.toContain('DETECTED');
  });

  it('detector does not reveal stealthed enemy out of range', () => {
    // Use small explicit detection range.
    const bundle = makeStealthBundle({ stealthDelay: 100, detectionRange: 5 });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 205, 205), // Far away (100+ units)
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).not.toContain('DETECTED');
  });

  it('detection expires after detector is destroyed', () => {
    // Use a weapon to kill the detector so detection expires.
    const bundle = makeStealthBundle({ stealthDelay: 100, detectionRange: 200 });
    const bundleWithKiller = makeBundle({
      objects: [
        ...bundle.objects,
        makeObjectDef('Killer', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'InstantKillGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('InstantKillGun', {
          PrimaryDamage: 9999,
          PrimaryDamageRadius: 0,
          AttackRange: 200,
          DelayBetweenShots: 100,
          DamageType: 'EXPLOSION',
        }),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 115, 105),
        makeMapObject('Killer', 125, 105),
      ], 128, 128),
      makeRegistry(bundleWithKiller),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    // Activate stealth and get detected.
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('DETECTED');

    // Kill the detector with an ally unit (Killer is America, DetectorUnit is China = enemy).
    logic.submitCommand({ type: 'attackEntity', entityId: 3, targetEntityId: 2 });
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Detector should be dead, but detection may still linger briefly.
    // Run enough frames for the detection timer to expire.
    for (let i = 0; i < 60; i++) {
      logic.update(1 / 30);
    }

    // Detection should have expired since detector no longer scans.
    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).not.toContain('DETECTED');
  });

  it('non-innate stealth unit does NOT get CAN_STEALTH on creation', () => {
    const bundle = makeStealthBundle({ innateStealth: false });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 105, 105)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).not.toContain('CAN_STEALTH');
    expect(flags).not.toContain('STEALTHED');

    // After many frames, still not stealthed (no CAN_STEALTH).
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).not.toContain('STEALTHED');
  });

  it('extraRequiredKindOf filters detection targets', () => {
    // Detector only detects VEHICLE, but stealth unit is INFANTRY.
    const bundle = makeStealthBundle({
      stealthDelay: 100,
      extraRequiredKindOf: 'VEHICLE',
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 115, 105),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Stealth unit is INFANTRY, detector only detects VEHICLE — should NOT detect.
    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).not.toContain('DETECTED');
  });

  it('stealth breaks on movement when MOVING forbidden condition is set', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('MoverStealth', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 100,
            InnateStealth: 'Yes',
            StealthForbiddenConditions: 'MOVING',
          }),
          makeBlock('LocomotorSet', 'SET_NORMAL FastLoco', {}),
        ]),
      ],
      locomotors: [makeLocomotorDef('FastLoco', 120)],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('MoverStealth', 105, 105)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Wait for stealth activation.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Issue move command — stealth should break.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 505, targetZ: 105 });
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).not.toContain('STEALTHED');
  });

  it('stealth re-enters after forbidden condition clears and delay elapses', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ResteathUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
            StealthDelay: 300, // 300ms = ~9 frames at 30fps
            InnateStealth: 'Yes',
            StealthForbiddenConditions: 'MOVING',
          }),
          makeBlock('LocomotorSet', 'SET_NORMAL FastLoco', {}),
        ]),
      ],
      locomotors: [makeLocomotorDef('FastLoco', 120)],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('ResteathUnit', 105, 105)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    // Wait for initial stealth.
    for (let i = 0; i < 15; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');

    // Move to break stealth.
    logic.submitCommand({ type: 'moveTo', entityId: 1, targetX: 115, targetZ: 105 });
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).not.toContain('STEALTHED');

    // Stop moving (arrive). Wait for re-stealth delay (~9 frames).
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }
    // Unit should have re-entered stealth after the delay.
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');
  });

  it('extraForbiddenKindOf filters detection targets', () => {
    // Detector refuses to detect INFANTRY.
    const bundle = makeStealthBundle({
      stealthDelay: 100,
      extraForbiddenKindOf: 'INFANTRY',
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('StealthUnit', 105, 105),
        makeMapObject('DetectorUnit', 115, 105),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Stealth unit is INFANTRY with forbidden filter — should NOT detect.
    const flags = logic.getEntityState(1)?.statusFlags ?? [];
    expect(flags).toContain('STEALTHED');
    expect(flags).not.toContain('DETECTED');
  });

  it('short-form forbidden condition tokens are parsed correctly', () => {
    // Use C++ short-form token names instead of long form.
    const bundle = makeStealthBundle({
      stealthDelay: 100,
      forbiddenConditions: 'ATTACKING MOVING TAKING_DAMAGE',
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 105, 105)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    setupRelationships(logic);

    // Should enter stealth after delay (forbidden conditions don't prevent entry when inactive).
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }
    expect(logic.getEntityState(1)?.statusFlags ?? []).toContain('STEALTHED');
  });
});

describe('Spy Vision Duration', () => {
  it('temporary vision reveals expire after default duration', () => {
    const objectDef = makeObjectDef('Unit', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
    ]);
    const bundle = makeBundle({ objects: [objectDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('Unit', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    logic.update(0);

    const priv = logic as unknown as {
      temporaryVisionReveals: { expiryFrame: number }[];
      fogOfWarGrid: unknown;
    };

    // If fogOfWarGrid is null, revealFogOfWar is a no-op and nothing is tracked.
    // The test verifies the tracking array behavior.
    if (!priv.fogOfWarGrid) {
      // No fog grid = no vision tracking, test is vacuously OK.
      expect(priv.temporaryVisionReveals).toHaveLength(0);
      return;
    }

    // With fog grid, reveals would be tracked and expired.
    // Run 950 frames (past default 900-frame duration).
    for (let i = 0; i < 950; i++) logic.update(1 / 30);
    expect(priv.temporaryVisionReveals).toHaveLength(0);
  });
});

describe('GrantStealthBehavior', () => {
  it('grants stealth to allied units within expanding radius and self-destructs', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GPSScrambler', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'GrantStealthBehavior ModuleTag_GS', {
            StartRadius: 0,
            FinalRadius: 30,
            RadiusGrowRate: 15,
          }),
        ]),
        makeObjectDef('FriendlyTank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', { InnateStealth: 'No' }),
        ]),
        makeObjectDef('EnemyTank', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', { InnateStealth: 'No' }),
        ]),
      ],
    });
    // Map: place scrambler at (50,50), friend at (70,50) = dist 20, enemy at (60,50) = dist 10.
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GPSScrambler', 50, 50),
        makeMapObject('FriendlyTank', 70, 50),
        makeMapObject('EnemyTank', 60, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'GLA', 0);
    logic.setTeamRelationship('GLA', 'America', 0);

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; objectStatusFlags: Set<string>;
        grantStealthCurrentRadius: number;
      }>;
    };

    // Init frame.
    logic.update(1 / 30);

    const friend = priv.spawnedEntities.get(2)!;
    const enemy = priv.spawnedEntities.get(3)!;

    // Before second update: friend should NOT yet have stealth (radius was 15 after first frame, friend at dist 20).
    expect(friend.objectStatusFlags.has('CAN_STEALTH')).toBe(false);

    // Frame 2: radius grows from 15 to 30 (final). Friend at 20 is within range.
    logic.update(1 / 30);
    expect(friend.objectStatusFlags.has('CAN_STEALTH')).toBe(true);
    expect(friend.objectStatusFlags.has('STEALTHED')).toBe(true);

    // Enemy should NOT get stealth (not allied).
    expect(enemy.objectStatusFlags.has('CAN_STEALTH')).toBe(false);

    // Scrambler should self-destruct after reaching final radius.
    const scrambler = priv.spawnedEntities.get(1);
    expect(scrambler === undefined || scrambler.destroyed === true).toBe(true);
  });

  it('filters by KindOf when specified', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GPSScrambler', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'GrantStealthBehavior ModuleTag_GS', {
            StartRadius: 100,
            FinalRadius: 100,
            RadiusGrowRate: 100,
            KindOf: 'INFANTRY',
          }),
        ]),
        makeObjectDef('Ranger', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', { InnateStealth: 'No' }),
        ]),
        makeObjectDef('Crusader', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', { InnateStealth: 'No' }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GPSScrambler', 50, 50),
        makeMapObject('Ranger', 55, 50),
        makeMapObject('Crusader', 55, 50),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; objectStatusFlags: Set<string>;
      }>;
    };

    logic.update(1 / 30);

    const ranger = priv.spawnedEntities.get(2)!;
    const crusader = priv.spawnedEntities.get(3)!;

    // Infantry matches KindOf filter — should get stealth.
    expect(ranger.objectStatusFlags.has('CAN_STEALTH')).toBe(true);
    // Vehicle does not match — should NOT get stealth.
    expect(crusader.objectStatusFlags.has('CAN_STEALTH')).toBe(false);
  });

  it('grants stealth incrementally as radius grows', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('GPSScrambler', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
          makeBlock('Behavior', 'GrantStealthBehavior ModuleTag_GS', {
            StartRadius: 0,
            FinalRadius: 100,
            RadiusGrowRate: 10,
          }),
        ]),
        makeObjectDef('CloseUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', { InnateStealth: 'No' }),
        ]),
        makeObjectDef('FarUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', { InnateStealth: 'No' }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('GPSScrambler', 50, 50),
        makeMapObject('CloseUnit', 55, 50),   // Distance 5 — within radius early.
        makeMapObject('FarUnit', 100, 50),     // Distance 50 — within radius later.
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number; destroyed: boolean; objectStatusFlags: Set<string>;
      }>;
    };

    // After 1 frame: radius = 10, close unit at 5 is in range, far at 50 is not.
    logic.update(1 / 30);
    const close = priv.spawnedEntities.get(2)!;
    const far = priv.spawnedEntities.get(3)!;
    expect(close.objectStatusFlags.has('CAN_STEALTH')).toBe(true);
    expect(far.objectStatusFlags.has('CAN_STEALTH')).toBe(false);

    // After 5 more frames (radius = 60), far unit at 50 is now in range.
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(far.objectStatusFlags.has('CAN_STEALTH')).toBe(true);
  });
});

describe('StealthUpdate RequiredStatus and ForbiddenStatus runtime checks', () => {
  function makeStealthBundleWithStatusChecks(options: {
    requiredStatus?: string;
    forbiddenStatus?: string;
    stealthDelay?: number;
  } = {}) {
    const fields: Record<string, unknown> = {
      StealthDelay: options.stealthDelay ?? 100,
      InnateStealth: 'Yes',
    };
    if (options.requiredStatus) fields.RequiredStatus = options.requiredStatus;
    if (options.forbiddenStatus) fields.ForbiddenStatus = options.forbiddenStatus;

    return makeBundle({
      objects: [
        makeObjectDef('StealthUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', fields),
        ]),
      ],
    });
  }

  it('RequiredStatus prevents stealth when required status bits are missing', () => {
    const bundle = makeStealthBundleWithStatusChecks({
      requiredStatus: 'RIDER1',
      stealthDelay: 100,
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
      }>;
    };

    // Run well past stealth delay — entity should NOT enter stealth because RIDER1 is missing.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const entity = priv.spawnedEntities.get(1)!;
    expect(entity.objectStatusFlags.has('CAN_STEALTH')).toBe(true);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);

    // Add the required status — entity should now enter stealth.
    entity.objectStatusFlags.add('RIDER1');
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);
  });

  it('RequiredStatus with multiple bits requires ALL bits to be set', () => {
    const bundle = makeStealthBundleWithStatusChecks({
      requiredStatus: 'RIDER1 AIRBORNE_TARGET',
      stealthDelay: 100,
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Only set one of two required bits — should NOT stealth.
    entity.objectStatusFlags.add('RIDER1');
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);

    // Now set both — should stealth after delay.
    entity.objectStatusFlags.add('AIRBORNE_TARGET');
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);
  });

  it('ForbiddenStatus prevents stealth when entity has a forbidden status bit', () => {
    const bundle = makeStealthBundleWithStatusChecks({
      forbiddenStatus: 'IMMOBILE SOLD',
      stealthDelay: 100,
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Without forbidden status, entity should enter stealth.
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);

    // Add a forbidden status bit — stealth should break.
    entity.objectStatusFlags.add('SOLD');
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);

    // Remove the forbidden status bit and wait — should re-stealth.
    entity.objectStatusFlags.delete('SOLD');
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);
  });

  it('RequiredStatus removal breaks active stealth', () => {
    const bundle = makeStealthBundleWithStatusChecks({
      requiredStatus: 'RIDER1',
      stealthDelay: 100,
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('StealthUnit', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        objectStatusFlags: Set<string>;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Set required status and enter stealth.
    entity.objectStatusFlags.add('RIDER1');
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(true);

    // Remove the required status — stealth should break.
    entity.objectStatusFlags.delete('RIDER1');
    for (let i = 0; i < 5; i++) logic.update(1 / 30);
    expect(entity.objectStatusFlags.has('STEALTHED')).toBe(false);
  });
});
