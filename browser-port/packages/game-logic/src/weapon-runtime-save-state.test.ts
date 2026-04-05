import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeBundle,
  makeHeightmap,
  makeLocomotorDef,
  makeMap,
  makeMapObject,
  makeObjectDef,
  makeRegistry,
  makeWeaponBlock,
  makeWeaponDef,
} from './test-helpers.js';

function makeWeaponRuntimeSaveBundle() {
  return makeBundle({
    objects: [
      makeObjectDef('Launcher', 'America', ['VEHICLE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        makeWeaponBlock('TestMissile'),
      ]),
      makeObjectDef('TestProjectile', 'America', ['PROJECTILE', 'SMALL_MISSILE'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        makeBlock('Behavior', 'MissileAIUpdate ModuleTag_AI', {
          TryToFollowTarget: 'Yes',
          FuelLifetime: 10000,
          IgnitionDelay: 0,
          InitialVelocity: 15,
          DistanceToTravelBeforeTurning: 0,
          DistanceToTargetForLock: 30,
          DetonateOnNoFuel: 'Yes',
        }),
        makeBlock('LocomotorSet', 'SET_NORMAL MissileLoco', {}),
      ]),
    ],
    weapons: [
      makeWeaponDef('TestMissile', {
        PrimaryDamage: 100,
        DamageType: 'EXPLOSION',
        AttackRange: 200,
        DelayBetweenShots: 2000,
        ProjectileObject: 'TestProjectile',
        WeaponSpeed: 15,
      }),
    ],
    locomotors: [
      makeLocomotorDef('MissileLoco', 15),
    ],
  });
}

describe('weapon runtime save-state', () => {
  it('stores projectile damage runtime in the source game-logic chunk and rebuilds active projectile visuals', () => {
    const registry = makeRegistry(makeWeaponRuntimeSaveBundle());
    const map = makeMap([
      makeMapObject('Launcher', 10, 10),
    ], 128, 128);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      resolveWeaponProfileFromDef: (weaponDef: unknown) => unknown;
      extractMissileAIProfile: (projectileObjectName: string) => unknown;
      pendingWeaponDamageEvents: Array<Record<string, unknown>>;
      historicDamageLog: Map<string, Array<{ frame: number; x: number; z: number }>>;
      activeWeaponProjectileStateByVisualId: Map<number, Record<string, unknown>>;
    };

    privateLogic.frameCounter = 40;
    const weaponDef = registry.getWeapon('TestMissile');
    if (!weaponDef) {
      throw new Error('Expected TestMissile weapon definition');
    }
    const weaponProfile = privateLogic.resolveWeaponProfileFromDef(weaponDef) as Record<string, unknown> | null;
    if (!weaponProfile) {
      throw new Error('Expected TestMissile weapon profile');
    }
    const missileAIProfile = privateLogic.extractMissileAIProfile('TestProjectile');
    privateLogic.pendingWeaponDamageEvents.push({
      sourceEntityId: 1,
      primaryVictimEntityId: null,
      impactX: 60,
      impactY: 6,
      impactZ: 24,
      executeFrame: 100,
      projectilePlannedImpactFrame: 100,
      delivery: 'PROJECTILE',
      weapon: weaponProfile,
      launchFrame: 40,
      sourceX: 10,
      sourceY: 0,
      sourceZ: 10,
      projectileVisualId: 77,
      cachedVisualType: 'MISSILE',
      bezierP1Y: 0,
      bezierP2Y: 0,
      bezierFirstPercentIndent: 0,
      bezierSecondPercentIndent: 0,
      hasBezierArc: false,
      countermeasureDivertFrame: 0,
      countermeasureNoDamage: false,
      suppressImpactVisual: false,
      missileAIProfile,
      missileAIState: {
        state: 'ATTACK',
        stateEnteredFrame: 40,
        currentX: 22,
        currentY: 4,
        currentZ: 16,
        prevX: 19,
        prevY: 3,
        prevZ: 14,
        velocityX: 3,
        velocityY: 1,
        velocityZ: 2,
        speed: 15,
        armed: true,
        fuelExpirationFrame: 340,
        noTurnDistanceLeft: 0,
        trackingTarget: false,
        targetEntityId: null,
        targetX: 60,
        targetY: 6,
        targetZ: 24,
        originalTargetX: 60,
        originalTargetY: 6,
        originalTargetZ: 24,
        usePreciseTargetY: true,
        travelDistance: 18,
        totalDistanceEstimate: 52,
        isJammed: false,
      },
      scriptWaypointPath: [{ x: 22, z: 16 }, { x: 35, z: 18 }],
      damageFXOverride: 'SMALL_ARMS',
      sourceTemplateName: 'Launcher',
    });
    privateLogic.historicDamageLog.set('TestMissile', [{ frame: 34, x: 42, z: 18 }]);
    privateLogic.activeWeaponProjectileStateByVisualId.set(77, {
      id: 77,
      visualId: 77,
      templateName: 'TestProjectile',
      sourceEntityId: 1,
      side: 'america',
      x: 22,
      y: 4,
      z: 16,
      launchFrame: 40,
    });

    const coreState = logic.captureSourceGameLogicRuntimeSaveState();
    const browserState = logic.captureBrowserRuntimeSaveState();

    expect(browserState).not.toHaveProperty('pendingWeaponDamageEvents');
    expect(browserState).not.toHaveProperty('historicDamageLog');
    expect(browserState).not.toHaveProperty('activeWeaponProjectileStateByVisualId');
    expect(coreState.pendingWeaponDamageEvents?.[0]?.weaponName).toBe('TestMissile');
    expect(coreState.historicDamageLog).toEqual([{
      weaponName: 'TestMissile',
      hits: [{ frame: 34, x: 42, z: 18 }],
    }]);

    const restored = new GameLogicSubsystem(new THREE.Scene());
    restored.loadMapObjects(map, registry, makeHeightmap(128, 128));
    restored.restoreSourceGameLogicRuntimeSaveState(coreState);
    restored.restoreBrowserRuntimeSaveState(browserState);

    const restoredPrivate = restored as unknown as typeof privateLogic;
    expect(restoredPrivate.pendingWeaponDamageEvents).toHaveLength(1);
    expect(restoredPrivate.pendingWeaponDamageEvents[0]?.weapon.name).toBe('TestMissile');
    expect(restoredPrivate.pendingWeaponDamageEvents[0]?.damageFXOverride).toBe('SMALL_ARMS');
    expect(restoredPrivate.pendingWeaponDamageEvents[0]?.sourceTemplateName).toBe('Launcher');
    expect(restoredPrivate.historicDamageLog).toEqual(new Map([
      ['TestMissile', [{ frame: 34, x: 42, z: 18 }]],
    ]));
    expect(restoredPrivate.activeWeaponProjectileStateByVisualId.get(77)).toEqual({
      id: 77,
      visualId: 77,
      templateName: 'TestProjectile',
      sourceEntityId: 1,
      side: 'america',
      x: 22,
      y: 4,
      z: 16,
      launchFrame: 40,
    });
  });

  it('hydrates legacy browser projectile damage state into source-owned runtime', () => {
    const registry = makeRegistry(makeWeaponRuntimeSaveBundle());
    const map = makeMap([
      makeMapObject('Launcher', 10, 10),
    ], 128, 128);

    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(map, registry, makeHeightmap(128, 128));

    const privateLogic = logic as unknown as {
      frameCounter: number;
      resolveWeaponProfileFromDef: (weaponDef: unknown) => unknown;
      pendingWeaponDamageEvents: Array<Record<string, unknown>>;
      historicDamageLog: Map<string, Array<{ frame: number; x: number; z: number }>>;
      activeWeaponProjectileStateByVisualId: Map<number, Record<string, unknown>>;
    };
    privateLogic.frameCounter = 40;

    const weaponDef = registry.getWeapon('TestMissile');
    if (!weaponDef) {
      throw new Error('Expected TestMissile weapon definition');
    }
    const weaponProfile = privateLogic.resolveWeaponProfileFromDef(weaponDef);

    logic.restoreBrowserRuntimeSaveState({
      version: 1,
      gameRandomSeed: 1,
      pendingWeaponDamageEvents: [{
        sourceEntityId: 1,
        primaryVictimEntityId: null,
        impactX: 60,
        impactY: 6,
        impactZ: 24,
        executeFrame: 100,
        projectilePlannedImpactFrame: 100,
        delivery: 'PROJECTILE',
        weapon: weaponProfile,
        launchFrame: 40,
        sourceX: 10,
        sourceY: 0,
        sourceZ: 10,
        projectileVisualId: 77,
        cachedVisualType: 'MISSILE',
        bezierP1Y: 0,
        bezierP2Y: 0,
        bezierFirstPercentIndent: 0,
        bezierSecondPercentIndent: 0,
        hasBezierArc: false,
        countermeasureDivertFrame: 0,
        countermeasureNoDamage: false,
        suppressImpactVisual: false,
        missileAIProfile: null,
        missileAIState: null,
        scriptWaypointPath: null,
        damageFXOverride: 'SMALL_ARMS',
        sourceTemplateName: 'Launcher',
      }],
      historicDamageLog: new Map([
        ['TestMissile', [{ frame: 34, x: 42, z: 18 }]],
      ]),
      activeWeaponProjectileStateByVisualId: new Map([
        [77, {
          id: 77,
          visualId: 77,
          templateName: 'TestProjectile',
          sourceEntityId: 1,
          side: 'america',
          x: 22,
          y: 4,
          z: 16,
          launchFrame: 40,
        }],
      ]),
    });

    expect(privateLogic.pendingWeaponDamageEvents).toHaveLength(1);
    expect(privateLogic.pendingWeaponDamageEvents[0]?.weapon.name).toBe('TestMissile');
    expect(privateLogic.historicDamageLog).toEqual(new Map([
      ['TestMissile', [{ frame: 34, x: 42, z: 18 }]],
    ]));
    expect(privateLogic.activeWeaponProjectileStateByVisualId.get(77)?.templateName).toBe('TestProjectile');
  });
});
