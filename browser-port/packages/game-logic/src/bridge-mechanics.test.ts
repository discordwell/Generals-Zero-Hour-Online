import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { ObjectDef } from '@generals/ini-data';

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
  makeObjectCreationListDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
  makeInputState,
} from './test-helpers.js';

describe('Bridge System', () => {
  // Helper: create a bridge entity with BridgeBehavior
  function makeBridgeObjectDef(bridgeFields: Record<string, unknown> = {}): ObjectDef {
    return makeObjectDef('TestBridge', 'civilian', ['BRIDGE', 'STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'BridgeBehavior ModuleTag_Bridge', {
        LateralScaffoldSpeed: 2.0,
        VerticalScaffoldSpeed: 1.5,
        ScaffoldObjectName: 'TestScaffold',
        ...bridgeFields,
      }),
    ]);
  }

  // Helper: create a bridge tower entity with BridgeTowerBehavior
  function makeTowerObjectDef(): ObjectDef {
    return makeObjectDef('TestBridgeTower', 'civilian', ['BRIDGE_TOWER', 'STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'BridgeTowerBehavior ModuleTag_Tower', {}),
    ]);
  }

  it('extracts BridgeBehaviorProfile from INI', () => {
    const bundle = makeBundle({
      objects: [makeBridgeObjectDef({
        BridgeDieFX: ['FX:FX_BridgeSplash', 'Delay:', '90', 'Bone:Splash01'],
        BridgeDieOCL: 'OCL:OCL_BridgeDebris Delay:120 Bone:ParentObject',
      })],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestBridge', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        bridgeBehaviorProfile: {
          scaffoldLateralSpeed: number;
          scaffoldVerticalSpeed: number;
          scaffoldObjectName: string;
          bridgeDieFX: Array<{ effectName: string; delayFrames: number; boneName: string }>;
          bridgeDieOCL: Array<{ effectName: string; delayFrames: number; boneName: string }>;
        } | null;
        bridgeBehaviorState: { towerIds: number[]; scaffoldIds: number[]; isBridgeDestroyed: boolean } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    expect(entity.bridgeBehaviorProfile).not.toBeNull();
    expect(entity.bridgeBehaviorProfile!.scaffoldLateralSpeed).toBe(2.0);
    expect(entity.bridgeBehaviorProfile!.scaffoldVerticalSpeed).toBe(1.5);
    expect(entity.bridgeBehaviorProfile!.scaffoldObjectName).toBe('TESTSCAFFOLD');
    expect(entity.bridgeBehaviorProfile!.bridgeDieFX).toEqual([{
      effectName: 'FX_BridgeSplash',
      delayFrames: 3,
      boneName: 'Splash01',
    }]);
    expect(entity.bridgeBehaviorProfile!.bridgeDieOCL).toEqual([{
      effectName: 'OCL_BridgeDebris',
      delayFrames: 4,
      boneName: 'ParentObject',
    }]);
    expect(entity.bridgeBehaviorState).not.toBeNull();
    expect(entity.bridgeBehaviorState!.isBridgeDestroyed).toBe(false);
  });

  it('extracts BridgeTowerProfile from INI', () => {
    const bundle = makeBundle({
      objects: [makeTowerObjectDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestBridgeTower', 10, 10)]),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        bridgeTowerProfile: { _marker: true } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    expect(entity.bridgeTowerProfile).not.toBeNull();
    expect(entity.bridgeTowerProfile!._marker).toBe(true);
  });

  it('extracts BridgeScaffoldBehavior default constructor state from INI', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestScaffold', 'civilian', [], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('Behavior', 'BridgeScaffoldBehavior ModuleTag_Scaffold', {}),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('TestScaffold', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        bridgeScaffoldState: {
          targetMotion: number;
          createPos: { x: number; y: number; z: number };
          riseToPos: { x: number; y: number; z: number };
          buildPos: { x: number; y: number; z: number };
          targetPos: { x: number; y: number; z: number };
          lateralSpeed: number;
          verticalSpeed: number;
        } | null;
      }>;
    };
    const entity = priv.spawnedEntities.get(1)!;

    expect(entity.bridgeScaffoldState).toEqual({
      targetMotion: 0,
      createPos: { x: 0, y: 0, z: 0 },
      riseToPos: { x: 0, y: 0, z: 0 },
      buildPos: { x: 0, y: 0, z: 0 },
      targetPos: { x: 0, y: 0, z: 0 },
      lateralSpeed: 1,
      verticalSpeed: 1,
    });
  });

  it('propagates tower damage proportionally to sibling towers and bridge', () => {
    const bundle = makeBundle({
      objects: [
        makeBridgeObjectDef(),
        makeTowerObjectDef(),
      ],
      weapons: [
        makeWeaponDef('TestCannon', {
          AttackRange: 200,
          PrimaryDamage: 20,
          DelayBetweenShots: 100,
        }),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestBridge', 20, 20),
        makeMapObject('TestBridgeTower', 15, 15),
        makeMapObject('TestBridgeTower', 25, 15),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        templateName: string;
        health: number;
        maxHealth: number;
        bridgeBehaviorState: { towerIds: number[]; isBridgeDestroyed: boolean } | null;
        bridgeTowerState: { bridgeEntityId: number; towerType: number } | null;
      }>;
      applyWeaponDamageAmount: (sourceId: number | null, target: { health: number; maxHealth: number }, amount: number, damageType: string) => void;
    };

    // Manually wire up bridge-tower relationships.
    const bridge = priv.spawnedEntities.get(1)!;
    const tower1 = priv.spawnedEntities.get(2)!;
    const tower2 = priv.spawnedEntities.get(3)!;

    bridge.bridgeBehaviorState!.towerIds = [2, 3];
    tower1.bridgeTowerState = { bridgeEntityId: 1, towerType: 0 };
    tower2.bridgeTowerState = { bridgeEntityId: 1, towerType: 1 };

    // Apply damage to tower1 (20 damage out of 200 max = 10%).
    const tower1HealthBefore = tower1.health;
    priv.applyWeaponDamageAmount(null, tower1, 20, 'EXPLOSION');

    // Tower1 should have lost health directly.
    expect(tower1.health).toBeLessThan(tower1HealthBefore);

    // Tower2 should have taken proportional damage (10% of its max health = 20).
    expect(tower2.health).toBeLessThan(200);

    // Bridge should have taken proportional damage (10% of 500 = 50).
    expect(bridge.health).toBeLessThan(500);
  });

  it('propagates tower healing proportionally to sibling towers and bridge', () => {
    const bundle = makeBundle({
      objects: [
        makeBridgeObjectDef(),
        makeTowerObjectDef(),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestBridge', 20, 20),
        makeMapObject('TestBridgeTower', 15, 15),
        makeMapObject('TestBridgeTower', 25, 15),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        templateName: string;
        health: number;
        maxHealth: number;
        bridgeBehaviorState: { towerIds: number[]; isBridgeDestroyed: boolean } | null;
        bridgeTowerState: { bridgeEntityId: number; towerType: number } | null;
        soleHealingBenefactorId: number | null;
        soleHealingBenefactorExpirationFrame: number;
      }>;
      attemptHealingFromSoleBenefactor: (target: unknown, amount: number, sourceId: number, duration: number) => boolean;
    };

    // Wire up relationships.
    const bridge = priv.spawnedEntities.get(1)!;
    const tower1 = priv.spawnedEntities.get(2)!;
    const tower2 = priv.spawnedEntities.get(3)!;

    bridge.bridgeBehaviorState!.towerIds = [2, 3];
    tower1.bridgeTowerState = { bridgeEntityId: 1, towerType: 0 };
    tower2.bridgeTowerState = { bridgeEntityId: 1, towerType: 1 };

    // Damage entities first.
    bridge.health = 300;
    tower1.health = 100;
    tower2.health = 120;

    // Heal tower1 by 40 (40/200 = 20%).
    priv.attemptHealingFromSoleBenefactor(tower1, 40, 999, 10);

    // Tower1 should be healed directly.
    expect(tower1.health).toBe(140);

    // Tower2 should be healed by 20% of 200 = 40.
    expect(tower2.health).toBe(160);

    // Bridge should be healed by 20% of 500 = 100.
    expect(bridge.health).toBe(400);
  });

  it('marks bridge cells impassable on bridge death', () => {
    const bundle = makeBundle({
      objects: [makeBridgeObjectDef()],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestBridge', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        health: number;
        maxHealth: number;
        boneFXState: {
          currentBodyState: number;
          pendingVisualEvents: Array<{ type: string; effectName: string }>;
          nextFXFrame: number[][];
        } | null;
        destroyed: boolean;
        bridgeBehaviorState: {
          towerIds: number[];
          isBridgeDestroyed: boolean;
          bridgeCells: { x: number; z: number }[];
          deathFrame: number;
        } | null;
      }>;
      navigationGrid: {
        width: number;
        bridgePassable: Uint8Array;
      } | null;
      markEntityDestroyed: (entityId: number, attackerId: number) => void;
    };

    const entity = priv.spawnedEntities.get(1)!;
    const state = entity.bridgeBehaviorState!;

    // Set up bridge cells and mark them passable in nav grid.
    state.bridgeCells = [{ x: 5, z: 5 }, { x: 6, z: 5 }];

    if (priv.navigationGrid) {
      const idx1 = 5 * priv.navigationGrid.width + 5;
      const idx2 = 5 * priv.navigationGrid.width + 6;
      priv.navigationGrid.bridgePassable[idx1] = 1;
      priv.navigationGrid.bridgePassable[idx2] = 1;

      // Kill the bridge.
      entity.health = 0;
      priv.markEntityDestroyed(1, -1);

      // Bridge cells should now be impassable.
      expect(priv.navigationGrid.bridgePassable[idx1]).toBe(0);
      expect(priv.navigationGrid.bridgePassable[idx2]).toBe(0);
      expect(state.isBridgeDestroyed).toBe(true);
    }
  });

  it('fires BridgeDieFX and BridgeDieOCL on the configured death delay', () => {
    const bundle = makeBundle({
      objects: [
        makeBridgeObjectDef({
          BridgeDieFX: ['FX:FX_BridgeSplash', 'Delay:', '66', 'Bone:Splash01'],
          BridgeDieOCL: ['OCL:OCL_BridgeDebris', 'Delay:', '66', 'Bone:ParentObject'],
        }),
        makeObjectDef('BridgeDebris', 'civilian', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 50, InitialHealth: 50 }),
        ]),
      ],
      objectCreationLists: [
        makeObjectCreationListDef('OCL_BridgeDebris', [
          makeBlock('CreateObject', 'CreateObject', { ObjectNames: 'BridgeDebris' }),
        ]),
      ],
    });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('TestBridge', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        templateName: string;
        health: number;
        destroyed: boolean;
        keepObjectOnDeath: boolean;
      }>;
      markEntityDestroyed: (entityId: number, attackerId: number) => void;
    };

    const bridge = priv.spawnedEntities.get(1)!;
    bridge.health = 0;
    priv.markEntityDestroyed(bridge.id, -1);
    logic.drainVisualEvents();

    logic.update(1 / 30);
    expect(logic.drainVisualEvents().some((event) => event.effectName === 'FX_BridgeSplash')).toBe(false);
    expect([...priv.spawnedEntities.values()].some((entity) => entity.templateName === 'BridgeDebris')).toBe(false);

    logic.update(1 / 30);
    const events = logic.drainVisualEvents();

    expect(events).toContainEqual(expect.objectContaining({
      type: 'NAMED_FX',
      effectName: 'FX_BridgeSplash',
      sourceEntityId: bridge.id,
      sourceBoneName: 'Splash01',
    }));
    expect([...priv.spawnedEntities.values()].some((entity) => entity.templateName === 'BridgeDebris')).toBe(true);
    expect(priv.spawnedEntities.get(bridge.id)).toBe(bridge);
    expect(bridge.destroyed).toBe(true);
    expect(bridge.keepObjectOnDeath).toBe(true);
  });

  it('scaffold motion state machine transitions RISE -> BUILD_ACROSS -> STILL', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestScaffold', 'civilian', [], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestScaffold', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; y: number; z: number;
        destroyed: boolean;
        bridgeScaffoldState: {
          targetMotion: number;
          createPos: { x: number; y: number; z: number };
          riseToPos: { x: number; y: number; z: number };
          buildPos: { x: number; y: number; z: number };
          targetPos: { x: number; y: number; z: number };
          lateralSpeed: number;
          verticalSpeed: number;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Manually set up scaffold state (STM_RISE=1).
    entity.bridgeScaffoldState = {
      targetMotion: 1, // STM_RISE
      createPos: { x: 10, y: 0, z: 10 },
      riseToPos: { x: 10, y: 5, z: 10 },
      buildPos: { x: 20, y: 5, z: 10 },
      targetPos: { x: 10, y: 5, z: 10 }, // target = riseToPos
      lateralSpeed: 10,
      verticalSpeed: 10,
    };
    entity.x = 10;
    entity.y = 0;
    entity.z = 10;

    // Run enough frames for scaffold to rise.
    for (let i = 0; i < 100; i++) {
      logic.update(1 / 30);
    }

    // After rising, should transition to BUILD_ACROSS (2), then to STILL (0).
    // With speed=10, a distance of 5 should be covered quickly.
    // Then BUILD_ACROSS with distance=10 should also complete.
    expect(entity.bridgeScaffoldState!.targetMotion).toBe(0); // STM_STILL
    expect(entity.x).toBeCloseTo(20, 0);
    expect(entity.y).toBeCloseTo(5, 0);
  });

  it('scaffold tear-down transitions TEAR_DOWN_ACROSS -> SINK -> destroy', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TestScaffold', 'civilian', [], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestScaffold', 20, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        x: number; y: number; z: number;
        destroyed: boolean;
        bridgeScaffoldState: {
          targetMotion: number;
          createPos: { x: number; y: number; z: number };
          riseToPos: { x: number; y: number; z: number };
          buildPos: { x: number; y: number; z: number };
          targetPos: { x: number; y: number; z: number };
          lateralSpeed: number;
          verticalSpeed: number;
        } | null;
      }>;
    };

    const entity = priv.spawnedEntities.get(1)!;

    // Start at build position and initiate tear-down.
    entity.x = 20;
    entity.y = 5;
    entity.z = 10;

    // STM_TEAR_DOWN_ACROSS = 3, target = riseToPos
    entity.bridgeScaffoldState = {
      targetMotion: 3, // STM_TEAR_DOWN_ACROSS
      createPos: { x: 10, y: 0, z: 10 },
      riseToPos: { x: 10, y: 5, z: 10 },
      buildPos: { x: 20, y: 5, z: 10 },
      targetPos: { x: 10, y: 5, z: 10 }, // target = riseToPos (tear down goes back)
      lateralSpeed: 10,
      verticalSpeed: 10,
    };

    // Run frames until scaffold should be destroyed (tear down + sink).
    for (let i = 0; i < 200; i++) {
      if (entity.destroyed) break;
      logic.update(1 / 30);
    }

    // After tear down across + sink, entity should be destroyed.
    expect(entity.destroyed).toBe(true);
  });

  it('tower death kills parent bridge', () => {
    const bundle = makeBundle({
      objects: [
        makeBridgeObjectDef(),
        makeTowerObjectDef(),
      ],
    });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([
        makeMapObject('TestBridge', 20, 20),
        makeMapObject('TestBridgeTower', 15, 15),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    const priv = logic as unknown as {
      spawnedEntities: Map<number, {
        templateName: string;
        health: number;
        destroyed: boolean;
        bridgeBehaviorState: { towerIds: number[]; isBridgeDestroyed: boolean } | null;
        bridgeTowerState: { bridgeEntityId: number; towerType: number } | null;
      }>;
      markEntityDestroyed: (entityId: number, attackerId: number) => void;
    };

    // Wire up relationships.
    const bridge = priv.spawnedEntities.get(1)!;
    const tower = priv.spawnedEntities.get(2)!;

    bridge.bridgeBehaviorState!.towerIds = [2];
    tower.bridgeTowerState = { bridgeEntityId: 1, towerType: 0 };

    // Kill the tower.
    tower.health = 0;
    priv.markEntityDestroyed(2, -1);

    // Tower should be destroyed.
    expect(tower.destroyed).toBe(true);

    // Bridge should also be destroyed (tower death kills bridge).
    expect(bridge.destroyed).toBe(true);
  });
});
