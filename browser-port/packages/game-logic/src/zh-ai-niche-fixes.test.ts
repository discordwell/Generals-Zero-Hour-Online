/**
 * Tests for ZH-only niche AI and state machine fixes.
 *
 * Source parity:
 *   1. Iterator safety in groupDoSpecialPowerAtLocation — AIGroup.cpp:2676-2715
 *      ZH pre-increments iterator before processing to survive list mutation
 *      (rebel ambush drowning during special power execution).
 *
 *   2. Guard isAttack/isGuardIdle/isHuntAttack query methods — AIGuard.h:148-261,
 *      StateMachine.h:158,267-270, AIStateMachine.h:1173,1230,1260.
 *
 *   3. Guard out-of-ammo + enterGuard combined conditions — AIStates.cpp:6744,
 *      AIGuardRetaliate.cpp:255-276. Verified interaction of JetAI ammo check
 *      with enterGuard exemption in guard idle state.
 *
 *   4. Tunnel network guard state — AITunnelNetworkGuardState::isAttack() —
 *      AIStates.cpp:6966-6975, AIStateMachine.h:1221-1246.
 *
 *   5. AcademyStats mine creation/clearing tracking — AcademyStats.h:114,122,
 *      Object.cpp:595-598, Weapon.cpp:2562.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  GameLogicSubsystem,
  isGuardIdle,
  isGuardAttacking,
  isHuntAttacking,
  isTunnelNetworkGuardAttacking,
} from './index.js';
import {
  groupDoSpecialPowerAtLocation,
} from './special-power-routing.js';
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

// ---------------------------------------------------------------------------
// Helper: find entities by template name
// ---------------------------------------------------------------------------
function getEntitiesByTemplate(logic: GameLogicSubsystem, templateName: string): any[] {
  const privateApi = logic as unknown as {
    spawnedEntities: Map<number, { templateName: string }>;
  };
  const result: any[] = [];
  for (const ent of privateApi.spawnedEntities.values()) {
    if (ent.templateName === templateName) {
      result.push(ent);
    }
  }
  return result;
}

// =========================================================================
// Fix 1: Iterator safety in groupDoSpecialPowerAtLocation
// =========================================================================

describe('groupDoSpecialPowerAtLocation iterator safety (AIGroup.cpp:2676)', () => {
  it('snapshots entity ID list before iteration', () => {
    // Simulate: during processing, an entity is destroyed (removed from the map).
    // The snapshot should still iterate all original IDs, skipping destroyed ones.
    const entities = new Map<number, { id: number; destroyed: boolean }>();
    entities.set(1, { id: 1, destroyed: false });
    entities.set(2, { id: 2, destroyed: false });
    entities.set(3, { id: 3, destroyed: false });

    const processed: number[] = [];
    const issuingIds = [1, 2, 3];

    groupDoSpecialPowerAtLocation(
      issuingIds,
      (entity) => {
        processed.push(entity.id);
        // Simulate: processing entity 1 causes entity 2 to be destroyed
        // (e.g., rebel ambush drowning).
        if (entity.id === 1) {
          entities.get(2)!.destroyed = true;
        }
      },
      entities,
    );

    // Entity 1 was processed. Entity 2 was destroyed during entity 1's processing,
    // so it should be skipped. Entity 3 should still be processed.
    expect(processed).toEqual([1, 3]);
  });

  it('handles empty issuing entity list', () => {
    const entities = new Map<number, { id: number; destroyed: boolean }>();
    const processed: number[] = [];

    groupDoSpecialPowerAtLocation(
      [],
      (entity) => { processed.push(entity.id); },
      entities,
    );

    expect(processed).toEqual([]);
  });

  it('handles non-existent entity IDs gracefully', () => {
    const entities = new Map<number, { id: number; destroyed: boolean }>();
    entities.set(1, { id: 1, destroyed: false });

    const processed: number[] = [];

    groupDoSpecialPowerAtLocation(
      [1, 99, 100], // 99 and 100 don't exist
      (entity) => { processed.push(entity.id); },
      entities,
    );

    expect(processed).toEqual([1]);
  });

  it('handles already-destroyed entities in the list', () => {
    const entities = new Map<number, { id: number; destroyed: boolean }>();
    entities.set(1, { id: 1, destroyed: false });
    entities.set(2, { id: 2, destroyed: true }); // pre-destroyed
    entities.set(3, { id: 3, destroyed: false });

    const processed: number[] = [];

    groupDoSpecialPowerAtLocation(
      [1, 2, 3],
      (entity) => { processed.push(entity.id); },
      entities,
    );

    expect(processed).toEqual([1, 3]);
  });

  it('survives mutation of the original ID array during iteration', () => {
    const entities = new Map<number, { id: number; destroyed: boolean }>();
    entities.set(1, { id: 1, destroyed: false });
    entities.set(2, { id: 2, destroyed: false });
    entities.set(3, { id: 3, destroyed: false });

    const processed: number[] = [];
    const issuingIds = [1, 2, 3];

    groupDoSpecialPowerAtLocation(
      issuingIds,
      (entity) => {
        processed.push(entity.id);
        // Mutate the original array — should not affect iteration.
        issuingIds.length = 0;
      },
      entities,
    );

    // All 3 entities should be processed despite array mutation.
    expect(processed).toEqual([1, 2, 3]);
  });
});

// =========================================================================
// Fix 2: Guard isAttack/isGuardIdle/isHuntAttack query methods
// =========================================================================

describe('Guard/Hunt state query methods (AIGuard.h, AIStateMachine.h)', () => {
  describe('isGuardIdle()', () => {
    it('returns true for IDLE guard state', () => {
      expect(isGuardIdle('IDLE')).toBe(true);
    });

    it('returns false for NONE guard state', () => {
      expect(isGuardIdle('NONE')).toBe(false);
    });

    it('returns false for PURSUING guard state', () => {
      expect(isGuardIdle('PURSUING')).toBe(false);
    });

    it('returns false for RETURNING guard state', () => {
      expect(isGuardIdle('RETURNING')).toBe(false);
    });
  });

  describe('isGuardAttacking()', () => {
    it('returns true for PURSUING guard state', () => {
      expect(isGuardAttacking('PURSUING')).toBe(true);
    });

    it('returns false for IDLE guard state', () => {
      expect(isGuardAttacking('IDLE')).toBe(false);
    });

    it('returns false for RETURNING guard state', () => {
      expect(isGuardAttacking('RETURNING')).toBe(false);
    });

    it('returns false for NONE guard state', () => {
      expect(isGuardAttacking('NONE')).toBe(false);
    });
  });

  describe('isHuntAttacking()', () => {
    it('returns true for ATTACKING hunt state', () => {
      expect(isHuntAttacking('ATTACKING')).toBe(true);
    });

    it('returns false for IDLE hunt state', () => {
      expect(isHuntAttacking('IDLE')).toBe(false);
    });

    it('returns false for SCANNING hunt state', () => {
      expect(isHuntAttacking('SCANNING')).toBe(false);
    });
  });
});

// =========================================================================
// Fix 3: Guard out-of-ammo + enterGuard combined conditions
// =========================================================================

describe('Guard out-of-ammo + enterGuard combined conditions (AIStates.cpp:6744)', () => {
  function makeJetGuardBundle(opts: { enterGuard?: boolean } = {}) {
    return makeBundle({
      objects: [
        makeObjectDef('Raptor', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeBlock('Locomotor', 'Locomotor', { Speed: 100 }),
          makeBlock('Behavior', 'JetAIUpdate ModuleTag_JetAI', {
            OutOfAmmoDamagePerSecond: 0,
            ReturnToBaseIdleTime: 5000,
            NeedsRunway: 'No',
          }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'RaptorMissile'] }),
        ], {
          EnterGuard: opts.enterGuard ? 'Yes' : 'No',
        }),
        makeObjectDef('EnemyVehicle', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('RaptorMissile', {
          AttackRange: 300,
          PrimaryDamage: 100,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 1000,
          ClipSize: 4,
          AutoReloadsClip: 'No',
        }),
      ],
    });
  }

  it('jet with no ammo AND no enterGuard exits guard', () => {
    const bundle = makeJetGuardBundle({ enterGuard: false });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Raptor', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const raptor = getEntitiesByTemplate(logic, 'Raptor')[0];
    expect(raptor).toBeDefined();

    // Set up guard state.
    raptor.guardState = 'IDLE';
    raptor.guardInnerRange = 200;
    raptor.guardOuterRange = 300;
    raptor.guardMode = 0;
    raptor.guardAreaTriggerIndex = -1;
    raptor.guardNextScanFrame = 0;

    // Deplete ammo.
    raptor.attackAmmoInClip = 0;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // Jet with no ammo and no enterGuard should exit guard.
    expect(raptor.guardState).toBe('NONE');
  });

  it('jet with no ammo AND enterGuard=true stays in guard', () => {
    const bundle = makeJetGuardBundle({ enterGuard: true });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Raptor', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const raptor = getEntitiesByTemplate(logic, 'Raptor')[0];
    expect(raptor).toBeDefined();
    expect(raptor.enterGuard).toBe(true);

    raptor.guardState = 'IDLE';
    raptor.guardInnerRange = 200;
    raptor.guardOuterRange = 300;
    raptor.guardMode = 0;
    raptor.guardAreaTriggerIndex = -1;
    raptor.guardNextScanFrame = 0;
    raptor.attackAmmoInClip = 0;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // EnterGuard jet should stay in guard even with no ammo.
    expect(raptor.guardState).toBe('IDLE');
  });

  it('jet with ammo stays in guard regardless of enterGuard', () => {
    const bundle = makeJetGuardBundle({ enterGuard: false });
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Raptor', 100, 100),
    ], 256, 256);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 100, y: 100, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(256, 256));
    logic.setPlayerSide(0, 'America');
    logic.update(0);

    const raptor = getEntitiesByTemplate(logic, 'Raptor')[0];
    raptor.guardState = 'IDLE';
    raptor.guardInnerRange = 200;
    raptor.guardOuterRange = 300;
    raptor.guardMode = 0;
    raptor.guardAreaTriggerIndex = -1;
    raptor.guardNextScanFrame = 0;
    raptor.attackAmmoInClip = 4;

    for (let i = 0; i < 60; i++) {
      logic.update(0);
    }

    // Jet with ammo should stay in guard.
    expect(raptor.guardState).toBe('IDLE');
  });
});

// =========================================================================
// Fix 4: Tunnel network guard state
// =========================================================================

describe('Tunnel network guard state tracking (AIStates.cpp:6966-6975)', () => {
  describe('isTunnelNetworkGuardAttacking()', () => {
    it('returns true for ATTACKING tunnel guard state', () => {
      expect(isTunnelNetworkGuardAttacking('ATTACKING')).toBe(true);
    });

    it('returns false for GUARDING tunnel guard state', () => {
      expect(isTunnelNetworkGuardAttacking('GUARDING')).toBe(false);
    });

    it('returns false for NONE tunnel guard state', () => {
      expect(isTunnelNetworkGuardAttacking('NONE')).toBe(false);
    });
  });

  it('tunnel network entity has tunnelNetworkGuardState field initialized to NONE', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_TunnelContain', {
            MaxHealthPercentToAddNewPassenger: 100,
            AllowInsideKindOf: 'INFANTRY',
            ContainMax: 10,
          }),
        ]),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('TunnelNetwork', 50, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'GLA');
    logic.update(0);

    const tunnel = getEntitiesByTemplate(logic, 'TunnelNetwork')[0];
    expect(tunnel).toBeDefined();
    expect(tunnel.tunnelNetworkGuardState).toBe('NONE');
  });

  it('tunnel network guard state can be set to GUARDING', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_TunnelContain', {
            MaxHealthPercentToAddNewPassenger: 100,
            AllowInsideKindOf: 'INFANTRY',
            ContainMax: 10,
          }),
        ]),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('TunnelNetwork', 50, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'GLA');
    logic.update(0);

    const tunnel = getEntitiesByTemplate(logic, 'TunnelNetwork')[0];
    tunnel.tunnelNetworkGuardState = 'GUARDING';
    expect(tunnel.tunnelNetworkGuardState).toBe('GUARDING');
    expect(isTunnelNetworkGuardAttacking(tunnel.tunnelNetworkGuardState)).toBe(false);
  });

  it('tunnel network guard state can transition to ATTACKING', () => {
    const bundle = makeBundle({
      objects: [
        makeObjectDef('TunnelNetwork', 'GLA', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1000, InitialHealth: 1000 }),
          makeBlock('Behavior', 'TunnelContain ModuleTag_TunnelContain', {
            MaxHealthPercentToAddNewPassenger: 100,
            AllowInsideKindOf: 'INFANTRY',
            ContainMax: 10,
          }),
        ]),
      ],
    });

    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('TunnelNetwork', 50, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'GLA');
    logic.update(0);

    const tunnel = getEntitiesByTemplate(logic, 'TunnelNetwork')[0];
    tunnel.tunnelNetworkGuardState = 'ATTACKING';
    expect(isTunnelNetworkGuardAttacking(tunnel.tunnelNetworkGuardState)).toBe(true);
  });
});

// =========================================================================
// Fix 5: AcademyStats mine creation/clearing tracking
// =========================================================================

describe('AcademyStats mine creation/clearing tracking (AcademyStats.h:114,122)', () => {
  function makeMineBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('ChinaMine', 'China', ['MINE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
          makeBlock('Behavior', 'MinefieldBehavior ModuleTag_Mines', {
            DetonatedBy: 'ENEMIES',
            DetonationWeapon: 'MineWeapon',
            ScootFromStartingPointDistance: 10,
            NumVirtualMines: 3,
            Regenerates: 'No',
            WorkersDetonate: 'No',
            RepeatDetonateMoveThresh: 5,
          }),
        ]),
        makeObjectDef('BoobyTrap', 'GLA', ['BOOBY_TRAP'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
        makeObjectDef('DemoTrap', 'GLA', ['DEMOTRAP'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 10, InitialHealth: 10 }),
        ]),
        makeObjectDef('Worker', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'ClearMineGun'] }),
        ]),
        makeObjectDef('Tank', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TankGun'] }),
        ]),
      ],
      weapons: [
        makeWeaponDef('MineWeapon', {
          PrimaryDamage: 100,
          AttackRange: 10,
          DelayBetweenShots: 500,
        }),
        makeWeaponDef('ClearMineGun', {
          PrimaryDamage: 1,
          PrimaryDamageType: 'DISARM',
          AttackRange: 30,
          DelayBetweenShots: 500,
          ClipSize: 1,
          AutoReloadsClip: 'Yes',
        }),
        makeWeaponDef('TankGun', {
          PrimaryDamage: 50,
          AttackRange: 100,
          DelayBetweenShots: 500,
        }),
      ],
    });
  }

  it('records mine creation when MINE entity is placed on map', () => {
    const bundle = makeMineBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('ChinaMine', 50, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'China');
    logic.update(0);

    // Source parity: mine creation tracked on neutral player stats.
    const neutralStats = logic.getAcademyStats('Neutral');
    expect(neutralStats).not.toBeNull();
    expect(neutralStats!.mineCount).toBe(1);
  });

  it('records BOOBY_TRAP and DEMOTRAP creation', () => {
    const bundle = makeMineBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('BoobyTrap', 50, 50),
      makeMapObject('DemoTrap', 60, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'GLA');
    logic.update(0);

    const neutralStats = logic.getAcademyStats('Neutral');
    expect(neutralStats).not.toBeNull();
    expect(neutralStats!.mineCount).toBe(2);
  });

  it('records mine clearing when DISARM damage is applied', () => {
    const bundle = makeMineBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Worker', 50, 50),
      makeMapObject('ChinaMine', 60, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 100, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    // Directly apply DISARM damage from worker to mine.
    const privateApi = logic as unknown as {
      spawnedEntities: Map<number, any>;
      applyWeaponDamageAmount(
        sourceEntityId: number | null,
        target: any,
        amount: number,
        damageType: string,
        weaponDeathType?: string,
        forceKill?: boolean,
      ): void;
    };

    const worker = getEntitiesByTemplate(logic, 'Worker')[0];
    const mine = getEntitiesByTemplate(logic, 'ChinaMine')[0];
    expect(worker).toBeDefined();
    expect(mine).toBeDefined();

    // Apply DISARM damage.
    (logic as any).applyWeaponDamageAmount(worker.id, mine, 1, 'DISARM');

    // Check that mine clearing was recorded for the worker's side.
    const americaStats = logic.getAcademyStats('America');
    expect(americaStats).not.toBeNull();
    expect(americaStats!.minesClearedCount).toBe(1);
  });

  it('non-DISARM damage does not record mine clearing', () => {
    const bundle = makeMineBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('Tank', 50, 50),
      makeMapObject('ChinaMine', 60, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 100, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'America');
    logic.setPlayerSide(1, 'China');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const tank = getEntitiesByTemplate(logic, 'Tank')[0];
    const mine = getEntitiesByTemplate(logic, 'ChinaMine')[0];

    // Apply normal EXPLOSION damage (not DISARM).
    (logic as any).applyWeaponDamageAmount(tank.id, mine, 50, 'EXPLOSION');

    // Mine clearing should NOT be recorded for non-DISARM damage.
    const americaStats = logic.getAcademyStats('America');
    // Stats may be null (no DISARM happened) or have 0 cleared.
    if (americaStats) {
      expect(americaStats.minesClearedCount).toBe(0);
    }
  });

  it('no source entity does not record mine clearing', () => {
    const bundle = makeMineBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('ChinaMine', 60, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 60, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'China');
    logic.update(0);

    const mine = getEntitiesByTemplate(logic, 'ChinaMine')[0];

    // Apply DISARM damage with no source entity.
    (logic as any).applyWeaponDamageAmount(null, mine, 1, 'DISARM');

    // No source entity = no mine clearing recorded.
    const neutralStats = logic.getAcademyStats('Neutral');
    expect(neutralStats).not.toBeNull();
    // mineCount should be 1 (from creation) but minesClearedCount should be 0.
    expect(neutralStats!.minesClearedCount).toBe(0);
  });

  it('academyStats interface includes mine tracking fields', () => {
    const bundle = makeMineBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    const mapData = makeMap([
      makeMapObject('ChinaMine', 50, 50),
      makeMapObject('Worker', 70, 50),
    ], 128, 128);
    mapData.waypoints = {
      nodes: [
        { id: 1, name: 'Player_1_Start', position: { x: 50, y: 50, z: 0 } },
        { id: 2, name: 'Player_2_Start', position: { x: 100, y: 50, z: 0 } },
      ],
      links: [],
    };

    logic.loadMapObjects(mapData, makeRegistry(bundle), makeHeightmap(128, 128));
    logic.setPlayerSide(0, 'China');
    logic.setPlayerSide(1, 'America');
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);
    logic.update(0);

    const worker = getEntitiesByTemplate(logic, 'Worker')[0];
    const mine = getEntitiesByTemplate(logic, 'ChinaMine')[0];

    // Apply DISARM damage.
    (logic as any).applyWeaponDamageAmount(worker.id, mine, 1, 'DISARM');

    // Verify both fields exist on the stats object.
    const neutralStats = logic.getAcademyStats('Neutral');
    expect(neutralStats).not.toBeNull();
    expect(typeof neutralStats!.mineCount).toBe('number');
    expect(typeof neutralStats!.minesClearedCount).toBe('number');

    const americaStats = logic.getAcademyStats('America');
    expect(americaStats).not.toBeNull();
    expect(typeof americaStats!.minesClearedCount).toBe('number');
  });
});
