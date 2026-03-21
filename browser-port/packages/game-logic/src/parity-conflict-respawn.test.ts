/**
 * Parity tests for upgrade ConflictsWith mutual exclusion and slave respawn timing.
 *
 * Test 1: Upgrade ConflictsWith Mutual Exclusion
 *   C++ UpgradeModule.h:89 — upgrades can have a ConflictsWith list. When a conflicting
 *   upgrade is present, the module is blocked from executing (wouldUpgrade returns false).
 *   TS: upgrade-modules.ts:124 reads ConflictsWith. index.ts:17790 enforces via
 *   wouldUpgradeModuleWithMask().
 *
 * Test 2: SpawnBehavior Slave Respawn Timing
 *   C++ SpawnBehavior.cpp:59 — SPAWN_DELAY_MIN_FRAMES=16. Slaves respawn after a delay
 *   stored in m_replacementTimes (frame = currentFrame + m_spawnReplaceDelayData).
 *   TS: spawner-behavior.ts onSlaveDeath pushes frameCounter + spawnReplaceDelayFrames.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import {
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeUpgradeDef,
  makeBundle,
  makeRegistry,
  makeHeightmap,
  makeMap,
  makeMapObject,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Test 1: Upgrade ConflictsWith Mutual Exclusion
// ---------------------------------------------------------------------------
// C++ source: UpgradeModule.h:98 — { "ConflictsWith", INI::parseAsciiStringVector, ... }
// UpgradeMux::wouldUpgrade() checks m_conflictingMask against the entity's upgrade mask.
// If any conflicting upgrade bit is set, the module refuses to execute.
//
// TS: upgrade-modules.ts:124 — ConflictsWith parsed into a Set<string>.
// index.ts:17790 — wouldUpgradeModuleWithMask iterates module.conflictsWith and
// returns false if any conflicting upgrade is present in the mask.
//
// Expected behavior: If UpgradeA's module has ConflictsWith=UpgradeB, then after
// applying UpgradeB to the entity, UpgradeA's module should be blocked from executing.

describe('Upgrade ConflictsWith mutual exclusion', () => {
  function makeConflictSetup() {
    // Unit with two WeaponBonusUpgrade modules that conflict with each other.
    // ModuleA: TriggeredBy=Upgrade_AP, ConflictsWith=Upgrade_HEAT
    // ModuleB: TriggeredBy=Upgrade_HEAT, ConflictsWith=Upgrade_AP
    const unitDef = makeObjectDef('TestTank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'WeaponBonusUpgrade ModuleTag_UpgradeA', {
        TriggeredBy: 'Upgrade_AP',
        ConflictsWith: 'Upgrade_HEAT',
      }),
      makeBlock('Behavior', 'WeaponBonusUpgrade ModuleTag_UpgradeB', {
        TriggeredBy: 'Upgrade_HEAT',
        ConflictsWith: 'Upgrade_AP',
      }),
      makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'TestGun'] }),
    ]);

    const bundle = makeBundle({
      objects: [unitDef],
      weapons: [
        makeWeaponDef('TestGun', {
          AttackRange: 100,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          WeaponSpeed: 999999,
          DelayBetweenShots: 500,
        }),
      ],
      upgrades: [
        makeUpgradeDef('Upgrade_AP', {}),
        makeUpgradeDef('Upgrade_HEAT', {}),
      ],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('TestTank', 50, 50)], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.update(0);

    return { logic };
  }

  function getEntityInternal(logic: GameLogicSubsystem, id: number) {
    return (logic as unknown as {
      spawnedEntities: Map<number, {
        completedUpgrades: Set<string>;
        executedUpgradeModules: Set<string>;
        upgradeModules: Array<{
          id: string;
          moduleType: string;
          triggeredBy: Set<string>;
          conflictsWith: Set<string>;
        }>;
        weaponBonusConditionFlags: number;
      }>;
    }).spawnedEntities.get(id);
  }

  it('applying UpgradeA activates its module when no conflict present', () => {
    // C++ parity: wouldUpgrade checks conflicting mask — no conflict set → module executes.
    const { logic } = makeConflictSetup();

    logic.applyUpgradeToEntity(1, 'Upgrade_AP');
    logic.update(1 / 30);

    const entity = getEntityInternal(logic, 1)!;
    expect(entity.completedUpgrades.has('UPGRADE_AP')).toBe(true);
    // ModuleTag_UpgradeA should have executed (no conflict present).
    expect(entity.executedUpgradeModules.size).toBeGreaterThanOrEqual(1);
  });

  it('applying conflicting UpgradeB blocks UpgradeA module (C++ parity)', () => {
    // C++ source: UpgradeMux::wouldUpgrade iterates m_conflictingMask against the
    // entity upgrade mask. If UpgradeB is present, ModuleA (ConflictsWith=Upgrade_HEAT)
    // is blocked.
    //
    // TS: index.ts:17790 — for (const conflictingUpgrade of module.conflictsWith)
    //   if (upgradeMask.has(conflictingUpgrade)) return false;
    const { logic } = makeConflictSetup();

    // Apply UpgradeA first.
    logic.applyUpgradeToEntity(1, 'Upgrade_AP');
    logic.update(1 / 30);

    const entity = getEntityInternal(logic, 1)!;
    expect(entity.completedUpgrades.has('UPGRADE_AP')).toBe(true);

    // Now apply the conflicting UpgradeB.
    logic.applyUpgradeToEntity(1, 'Upgrade_HEAT');
    logic.update(1 / 30);

    expect(entity.completedUpgrades.has('UPGRADE_HEAT')).toBe(true);

    // ModuleB (TriggeredBy=Upgrade_HEAT, ConflictsWith=Upgrade_AP) should NOT
    // execute because Upgrade_AP is present and conflicts.
    // ModuleA (TriggeredBy=Upgrade_AP, ConflictsWith=Upgrade_HEAT) was already
    // executed, but now Upgrade_HEAT is present — on re-evaluation, it should
    // be considered conflicted.

    // Verify both upgrades are in the completed set.
    expect(entity.completedUpgrades.has('UPGRADE_AP')).toBe(true);
    expect(entity.completedUpgrades.has('UPGRADE_HEAT')).toBe(true);

    // The key parity check: ModuleB should NOT have executed because Upgrade_AP
    // is in the entity's upgrade mask and ModuleB has ConflictsWith=Upgrade_AP.
    const moduleBExecuted = entity.upgradeModules
      .filter(m => m.triggeredBy.has('UPGRADE_HEAT'))
      .some(m => entity.executedUpgradeModules.has(m.id));
    expect(moduleBExecuted).toBe(false);
  });

  it('only the non-conflicted module executes when both upgrades coexist', () => {
    // C++ parity: when both upgrades are present, both modules conflict with each
    // other — neither can freshly execute. The first one applied (ModuleA) was already
    // executed before the conflict arose.
    const { logic } = makeConflictSetup();

    // Apply both upgrades.
    logic.applyUpgradeToEntity(1, 'Upgrade_AP');
    logic.update(1 / 30);
    logic.applyUpgradeToEntity(1, 'Upgrade_HEAT');
    logic.update(1 / 30);

    const entity = getEntityInternal(logic, 1)!;

    // ModuleA (TriggeredBy=Upgrade_AP): was executed before conflict arose.
    const moduleAExecuted = entity.upgradeModules
      .filter(m => m.triggeredBy.has('UPGRADE_AP'))
      .some(m => entity.executedUpgradeModules.has(m.id));

    // ModuleB (TriggeredBy=Upgrade_HEAT): blocked because Upgrade_AP exists.
    const moduleBExecuted = entity.upgradeModules
      .filter(m => m.triggeredBy.has('UPGRADE_HEAT'))
      .some(m => entity.executedUpgradeModules.has(m.id));

    // ModuleA executed first (no conflict at the time).
    expect(moduleAExecuted).toBe(true);
    // ModuleB blocked by conflict.
    expect(moduleBExecuted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: SpawnBehavior Slave Respawn Timing
// ---------------------------------------------------------------------------
// C++ source: SpawnBehavior.cpp:59 — #define SPAWN_DELAY_MIN_FRAMES (16)
// SpawnBehavior.cpp:766 — onSpawnDeath:
//   Int replacementTime = md->m_spawnReplaceDelayData + TheGameLogic->getFrame();
//   m_replacementTimes.push_back(replacementTime);
// SpawnBehavior.cpp:257 — update loop: if (currentTime > replacementTime) → spawn.
//
// TS: spawner-behavior.ts:340 — onSlaveDeath:
//   state.replacementFrames.push(self.frameCounter + state.profile.spawnReplaceDelayFrames);
// spawner-behavior.ts:189 — updateSpawnBehaviors:
//   if (self.frameCounter > nextFrame) → createSpawnSlave().
//
// Expected behavior: After a slave dies, a replacement spawns after exactly
// spawnReplaceDelayFrames. The replacement should use the correct template.

describe('SpawnBehavior slave respawn timing', () => {
  function makeSpawnSetup(spawnReplaceDelayMs = 2000) {
    const sz = 128;

    const masterDef = makeObjectDef('SpawnMaster', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
        SpawnNumber: 1,
        SpawnReplaceDelay: spawnReplaceDelayMs,
        SpawnTemplateName: 'SpawnSlave',
        SpawnedRequireSpawner: 'Yes',
        InitialBurst: 1,
      }),
    ]);

    const slaveDef = makeObjectDef('SpawnSlave', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 50,
        InitialHealth: 50,
      }),
    ]);

    const bundle = makeBundle({
      objects: [masterDef, slaveDef],
    });

    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SpawnMaster', 60, 60)], sz, sz),
      makeRegistry(bundle),
      makeHeightmap(sz, sz),
    );
    logic.update(0); // First update: initialBurst spawns slave.

    return { logic, sz };
  }

  function getEntity(logic: GameLogicSubsystem, id: number) {
    return (logic as unknown as {
      spawnedEntities: Map<number, {
        id: number;
        destroyed: boolean;
        health: number;
        maxHealth: number;
        templateName: string;
        slaverEntityId: number | null;
        spawnBehaviorState: {
          profile: { spawnReplaceDelayFrames: number; spawnTemplateNames: string[] };
          slaveIds: number[];
          replacementFrames: number[];
        } | null;
        objectStatusFlags: Set<string>;
      }>;
    }).spawnedEntities.get(id);
  }

  it('slave spawns initially via InitialBurst', () => {
    const { logic } = makeSpawnSetup();

    // Master is entity 1 (placed on map). Slave should be entity 2 (spawned by InitialBurst).
    const master = getEntity(logic, 1);
    const slave = getEntity(logic, 2);
    expect(master).toBeDefined();
    expect(slave).toBeDefined();
    expect(slave!.destroyed).toBe(false);
    expect(slave!.slaverEntityId).toBe(1);
    expect(master!.spawnBehaviorState!.slaveIds).toContain(2);
  });

  it('slave does not respawn before SpawnReplaceDelay expires (C++ parity)', () => {
    // C++ source: SpawnBehavior.cpp:766 — replacementTime = delay + currentFrame.
    // SpawnBehavior.cpp:257 — spawn only when currentTime > replacementTime.
    //
    // SpawnReplaceDelay = 2000ms. At 30fps, LOGIC_FRAME_MS = 33.33ms.
    // msToLogicFrames(2000) = ceil(2000 / 33.33) = ceil(60) = 60 frames.
    const { logic } = makeSpawnSetup(2000);

    const slave = getEntity(logic, 2);
    expect(slave).toBeDefined();
    expect(slave!.destroyed).toBe(false);

    // Kill the slave.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (source: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };
    api.applyWeaponDamageAmount(null, slave as never, 9999, 'EXPLOSION');
    expect(slave!.destroyed).toBe(true);

    // Verify the replacement was scheduled.
    const master = getEntity(logic, 1);
    expect(master!.spawnBehaviorState!.replacementFrames.length).toBe(1);

    // Advance 30 frames (1 second) — only half the 60-frame delay.
    for (let i = 0; i < 30; i++) {
      logic.update(1 / 30);
    }

    // No replacement should have occurred yet.
    const liveSlaves30 = master!.spawnBehaviorState!.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    expect(liveSlaves30.length).toBe(0);
  });

  it('slave respawns after SpawnReplaceDelay expires (C++ parity)', () => {
    // C++ source: SpawnBehavior.cpp:257 — once currentTime > replacementTime, spawn fires.
    // TS: spawner-behavior.ts:189 — if (self.frameCounter > nextFrame) → createSpawnSlave().
    const { logic } = makeSpawnSetup(2000);

    const slave = getEntity(logic, 2);
    expect(slave).toBeDefined();

    // Kill the slave.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (source: number | null, target: unknown, amount: number, type: string) => void;
    };
    api.applyWeaponDamageAmount(null, slave as never, 9999, 'EXPLOSION');
    expect(slave!.destroyed).toBe(true);

    // Advance past the full 60-frame delay (+ margin for timing).
    for (let i = 0; i < 70; i++) {
      logic.update(1 / 30);
    }

    // Replacement slave should have been spawned.
    const master = getEntity(logic, 1);
    const liveSlaves = master!.spawnBehaviorState!.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    expect(liveSlaves.length).toBe(1);

    // Verify the replacement is a new entity (not the original slave ID 2).
    const newSlaveId = liveSlaves[0]!;
    expect(newSlaveId).not.toBe(2);

    // Verify the replacement is the correct template.
    const newSlave = getEntity(logic, newSlaveId);
    expect(newSlave).toBeDefined();
    expect(newSlave!.templateName.toUpperCase()).toBe('SPAWNSLAVE');
    expect(newSlave!.slaverEntityId).toBe(1);
  });

  it('respawned slave uses the correct template name (C++ parity)', () => {
    // C++ source: SpawnBehavior::createASpawn reads m_spawnTemplateName.
    // TS: spawner-behavior.ts:248 — templateNames[state.templateNameIndex % length].
    const { logic } = makeSpawnSetup(1000); // 1 second = 30 frames delay.

    const slave = getEntity(logic, 2);
    expect(slave).toBeDefined();

    // Kill the slave.
    const api = logic as unknown as {
      applyWeaponDamageAmount: (source: number | null, target: unknown, amount: number, type: string) => void;
    };
    api.applyWeaponDamageAmount(null, slave as never, 9999, 'EXPLOSION');

    // Advance past the 30-frame delay.
    for (let i = 0; i < 40; i++) {
      logic.update(1 / 30);
    }

    const master = getEntity(logic, 1);
    const liveSlaves = master!.spawnBehaviorState!.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    expect(liveSlaves.length).toBe(1);

    const newSlave = getEntity(logic, liveSlaves[0]!);
    expect(newSlave).toBeDefined();
    expect(newSlave!.templateName.toUpperCase()).toBe('SPAWNSLAVE');
  });

  it('multiple slave deaths schedule independent replacement timers', () => {
    // C++ source: SpawnBehavior.cpp:766 — each death pushes its own replacement time.
    // TS: spawner-behavior.ts:340 — each onSlaveDeath pushes independently.
    const sz = 128;

    const masterDef = makeObjectDef('SpawnMaster2', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 500,
        InitialHealth: 500,
      }),
      makeBlock('Behavior', 'SpawnBehavior ModuleTag_Spawn', {
        SpawnNumber: 2,
        SpawnReplaceDelay: 2000, // 60 frames
        SpawnTemplateName: 'SpawnSlave2',
        SpawnedRequireSpawner: 'Yes',
        InitialBurst: 2,
      }),
    ]);

    const slaveDef = makeObjectDef('SpawnSlave2', 'America', ['INFANTRY'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', {
        MaxHealth: 50,
        InitialHealth: 50,
      }),
    ]);

    const bundle = makeBundle({ objects: [masterDef, slaveDef] });
    const scene = new THREE.Scene();
    const logic = new GameLogicSubsystem(scene);
    logic.loadMapObjects(
      makeMap([makeMapObject('SpawnMaster2', 60, 60)], sz, sz),
      makeRegistry(bundle),
      makeHeightmap(sz, sz),
    );
    logic.update(0); // Spawns both slaves via InitialBurst.

    const api = logic as unknown as {
      applyWeaponDamageAmount: (source: number | null, target: unknown, amount: number, type: string) => void;
      spawnedEntities: Map<number, unknown>;
    };

    // Master is 1. Slaves should be 2 and 3.
    const slave1 = getEntity(logic, 2);
    const slave2 = getEntity(logic, 3);
    expect(slave1).toBeDefined();
    expect(slave2).toBeDefined();
    expect(slave1!.destroyed).toBe(false);
    expect(slave2!.destroyed).toBe(false);

    // Kill both slaves.
    api.applyWeaponDamageAmount(null, slave1 as never, 9999, 'EXPLOSION');
    api.applyWeaponDamageAmount(null, slave2 as never, 9999, 'EXPLOSION');

    const master = getEntity(logic, 1);
    // Both deaths should have scheduled replacement timers.
    expect(master!.spawnBehaviorState!.replacementFrames.length).toBe(2);

    // Advance past the replacement delay.
    for (let i = 0; i < 70; i++) {
      logic.update(1 / 30);
    }

    // Both slaves should have been replaced.
    const liveSlaves = master!.spawnBehaviorState!.slaveIds.filter((id: number) => {
      const e = getEntity(logic, id);
      return e && !e.destroyed;
    });
    expect(liveSlaves.length).toBe(2);
  });
});
