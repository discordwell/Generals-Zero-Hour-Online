/**
 * Parity Tests -- OCLUpdate periodic spawning and FireOCLAfterWeaponCooldownUpdate.
 *
 * Test 1: OCLUpdate -- Periodic Object Creation
 *   C++ OCLUpdate.cpp:124-219 -- creates objects from OCL at periodic intervals.
 *   Skips if UNDER_CONSTRUCTION. Pauses timer while disabled (isDisabled path pushes
 *   m_nextCreationFrame forward by 1 each frame). First shouldCreate() call initializes
 *   the timer without spawning.
 *   TS index.ts:27056 -- updateOCLUpdate mirrors C++ with per-module timers.
 *
 * Test 2: FireOCLAfterWeaponCooldownUpdate -- Shot Count Gating
 *   C++ FireOCLAfterWeaponCooldownUpdate.cpp:102-183 -- tracks consecutive shots on a
 *   specific weapon slot. Fires OCL when weapon stops firing (possibleNextShotFrame < now
 *   or validity changes) after MinShotsToCreateOCL consecutive shots.
 *   Lifetime is scaled: firingSeconds * oclLifetimePerSecond * 0.001 * LOGICFRAMES_PER_SECOND.
 *   TS index.ts:29641 -- updateFireOCLAfterCooldown mirrors C++ shot counting and OCL fire.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

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

function createLogic(): GameLogicSubsystem {
  const scene = new THREE.Scene();
  return new GameLogicSubsystem(scene);
}

// ── Shared OCL bundle injection helper ──────────────────────────────────────

function addOCL(
  bundle: ReturnType<typeof makeBundle>,
  oclName: string,
  spawnTemplate: string,
  count: string = '1',
): void {
  const lists = ((bundle as Record<string, unknown>).objectCreationLists ?? []) as unknown[];
  lists.push({
    name: oclName,
    fields: {},
    blocks: [{
      type: 'CreateObject',
      name: 'CreateObject',
      fields: { ObjectNames: spawnTemplate, Count: count },
      blocks: [],
    }],
  });
  (bundle as Record<string, unknown>).objectCreationLists = lists;
}

// ── Private entity access helpers ───────────────────────────────────────────

interface PrivateLogic {
  spawnedEntities: Map<number, PrivateEntity>;
  frameCounter: number;
}

interface PrivateEntity {
  id: number;
  destroyed: boolean;
  health: number;
  maxHealth: number;
  objectStatusFlags: Set<string>;
  oclUpdateProfiles: { oclName: string; minDelayFrames: number; maxDelayFrames: number }[];
  oclUpdateNextCreationFrames: number[];
  oclUpdateTimerStarted: boolean[];
  fireOCLAfterCooldownProfiles: {
    weaponSlot: number;
    oclName: string;
    minShotsRequired: number;
    oclLifetimePerSecond: number;
    oclMaxFrames: number;
  }[];
  fireOCLAfterCooldownStates: {
    valid: boolean;
    consecutiveShots: number;
    startFrame: number;
  }[];
  attackTargetEntityId: number | null;
  nextAttackFrame: number;
}

function priv(logic: GameLogicSubsystem): PrivateLogic {
  return logic as unknown as PrivateLogic;
}

// ══════════════════════════════════════════════════════════════════════════════
// Test 1: OCLUpdate -- Periodic Object Creation
// ══════════════════════════════════════════════════════════════════════════════

describe('parity: OCLUpdate periodic object creation', () => {
  /**
   * C++ source: OCLUpdate.cpp:124-219
   *   UpdateSleepTime OCLUpdate::update()
   *   {
   *     if (getObject()->isDisabled()) { m_nextCreationFrame++; return; }
   *     ...
   *     if (shouldCreate()) {
   *       if (m_nextCreationFrame == 0) { setNextCreationFrame(); return; }
   *       setNextCreationFrame();
   *       ObjectCreationList::create(data->m_ocl, getObject(), ...);
   *     }
   *   }
   *
   * C++ source: OCLUpdate.cpp:230-239
   *   Bool OCLUpdate::shouldCreate()
   *   {
   *     if (TheGameLogic->getFrame() < m_nextCreationFrame) return FALSE;
   *     if (getObject()->getStatusBits().test(OBJECT_STATUS_UNDER_CONSTRUCTION)) return FALSE;
   *     return TRUE;
   *   }
   *
   * TS source: index.ts:27056 -- updateOCLUpdate mirrors this logic exactly:
   *   - Skips destroyed/slowDeath/structureCollapse entities
   *   - Disabled path pushes nextCreationFrame +1 per frame
   *   - UNDER_CONSTRUCTION check after timer check
   *   - First timer init (oclUpdateTimerStarted[i] == false) sets timer without spawning
   *   - On timer elapse: sets next timer, executes OCL
   */

  function makeOCLSetup(opts: {
    minDelayMs?: number;
    maxDelayMs?: number;
  } = {}) {
    const minDelay = opts.minDelayMs ?? 1000;
    const maxDelay = opts.maxDelayMs ?? minDelay;

    const bundle = makeBundle({
      objects: [
        makeObjectDef('Spawner', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('Behavior', 'OCLUpdate ModuleTag_OCLSpawn', {
            OCL: 'OCLPeriodicUnit',
            MinDelay: minDelay,
            MaxDelay: maxDelay,
          }),
        ]),
        makeObjectDef('PeriodicUnit', 'America', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        ]),
      ],
    });
    addOCL(bundle, 'OCLPeriodicUnit', 'PeriodicUnit');

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('Spawner', 5, 5)]),
      makeRegistry(bundle),
      makeHeightmap(),
    );
    // Initial frame to bootstrap entity
    logic.update(0);
    return { logic, bundle };
  }

  it('spawns objects at the correct periodic interval', () => {
    // C++ parity: OCLUpdate.cpp:124-219
    //   With MinDelay=MaxDelay=1000ms (30 frames at 30fps):
    //   Frame 0: timer not started -> sets timer to frame 30 (no spawn)
    //   Frame 30: timer elapsed -> sets next to frame 60, executes OCL (spawn 1)
    //   Frame 60: timer elapsed -> sets next to frame 90, executes OCL (spawn 2)
    //   ...
    const { logic } = makeOCLSetup({ minDelayMs: 1000, maxDelayMs: 1000 });

    // Run 15 frames -- timer was just initialized, no spawn yet
    for (let i = 0; i < 15; i++) logic.update(1 / 30);
    const midStates = logic.getRenderableEntityStates();
    expect(midStates.filter(s => s.templateName === 'PeriodicUnit').length).toBe(0);

    // Run to frame 35 (past the 30-frame delay) -- first spawn
    for (let i = 0; i < 20; i++) logic.update(1 / 30);
    const firstSpawnStates = logic.getRenderableEntityStates();
    expect(firstSpawnStates.filter(s => s.templateName === 'PeriodicUnit').length).toBeGreaterThanOrEqual(1);

    // Run to ~frame 65 -- second spawn
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const secondSpawnStates = logic.getRenderableEntityStates();
    expect(secondSpawnStates.filter(s => s.templateName === 'PeriodicUnit').length).toBeGreaterThanOrEqual(2);
  });

  it('does not spawn while UNDER_CONSTRUCTION (C++ shouldCreate line 235)', () => {
    // C++ parity: OCLUpdate.cpp:235
    //   if (getObject()->getStatusBits().test(OBJECT_STATUS_UNDER_CONSTRUCTION)) return FALSE;
    //
    // TS parity: index.ts:27081
    //   if (entity.objectStatusFlags.has('UNDER_CONSTRUCTION')) continue;
    const { logic } = makeOCLSetup({ minDelayMs: 100, maxDelayMs: 100 });

    const spawner = priv(logic).spawnedEntities.get(1)!;
    spawner.objectStatusFlags.add('UNDER_CONSTRUCTION');

    // Run well past the delay -- should NOT spawn any units
    for (let i = 0; i < 60; i++) logic.update(1 / 30);
    const states = logic.getRenderableEntityStates();
    expect(states.filter(s => s.templateName === 'PeriodicUnit').length).toBe(0);

    // Remove construction flag and run again -- should now spawn
    spawner.objectStatusFlags.delete('UNDER_CONSTRUCTION');
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const afterStates = logic.getRenderableEntityStates();
    expect(afterStates.filter(s => s.templateName === 'PeriodicUnit').length).toBeGreaterThanOrEqual(1);
  });

  it('pauses timer while disabled and resumes after re-enable (C++ line 126-129)', () => {
    // C++ parity: OCLUpdate.cpp:126-129
    //   if (getObject()->isDisabled()) {
    //     m_nextCreationFrame++;
    //     return UPDATE_SLEEP_NONE;
    //   }
    //
    // TS parity: index.ts:27072-27076
    //   if (isDisabled) {
    //     entity.oclUpdateNextCreationFrames[i] = (entity.oclUpdateNextCreationFrames[i] ?? 0) + 1;
    //     continue;
    //   }
    //
    // Effect: each disabled frame pushes the creation frame forward by 1, effectively pausing.
    const { logic } = makeOCLSetup({ minDelayMs: 500, maxDelayMs: 500 }); // 15 frames

    // Run 5 frames to start the timer
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // Record the creation frame before disabling
    const spawner = priv(logic).spawnedEntities.get(1)!;
    const creationFrameBefore = spawner.oclUpdateNextCreationFrames[0]!;
    expect(creationFrameBefore).toBeGreaterThan(0);

    // Disable with EMP
    spawner.objectStatusFlags.add('DISABLED_EMP');

    // Run 30 frames while disabled -- timer should pause (no spawn)
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const midStates = logic.getRenderableEntityStates();
    expect(midStates.filter(s => s.templateName === 'PeriodicUnit').length).toBe(0);

    // The creation frame should have been pushed forward by ~30 frames
    const creationFrameAfterDisable = spawner.oclUpdateNextCreationFrames[0]!;
    expect(creationFrameAfterDisable).toBeGreaterThan(creationFrameBefore);

    // Re-enable and run past the remaining delay
    spawner.objectStatusFlags.delete('DISABLED_EMP');
    for (let i = 0; i < 30; i++) logic.update(1 / 30);
    const afterStates = logic.getRenderableEntityStates();
    expect(afterStates.filter(s => s.templateName === 'PeriodicUnit').length).toBeGreaterThanOrEqual(1);
  });

  it('spawns repeatedly on timer cycle with short delay', () => {
    // C++ parity: OCLUpdate.cpp:180-216
    //   Each time shouldCreate() returns TRUE and timer is started,
    //   setNextCreationFrame() is called and OCL is executed.
    //   With MinDelay=MaxDelay=200ms (6 frames), many spawns occur over 90 frames.
    const { logic } = makeOCLSetup({ minDelayMs: 200, maxDelayMs: 200 });

    // Run 90 frames (3 seconds) -- with 6-frame delay, expect many spawns
    // First shouldCreate sets timer at ~frame 0, first spawn at ~frame 6, next at ~12...
    for (let i = 0; i < 90; i++) logic.update(1 / 30);

    const states = logic.getRenderableEntityStates();
    const spawned = states.filter(s => s.templateName === 'PeriodicUnit');
    // Should have spawned multiple units (roughly 90/6 - 1 = ~14, minus initial timer set)
    expect(spawned.length).toBeGreaterThanOrEqual(5);
  });

  it('first shouldCreate sets timer without spawning (C++ line 173-178)', () => {
    // C++ parity: OCLUpdate.cpp:173-178
    //   if (m_nextCreationFrame == 0) {
    //     setNextCreationFrame();
    //     return UPDATE_SLEEP_NONE;
    //   }
    //
    // TS parity: index.ts:27084-27088
    //   if (!entity.oclUpdateTimerStarted[i]) {
    //     entity.oclUpdateTimerStarted[i] = true;
    //     entity.oclUpdateNextCreationFrames[i] = this.frameCounter + delay;
    //     continue;
    //   }
    //
    // Verify that the first eligible frame only initializes the timer, no spawn.
    const { logic } = makeOCLSetup({ minDelayMs: 100, maxDelayMs: 100 }); // 3 frames

    const spawner = priv(logic).spawnedEntities.get(1)!;

    // After the initial update(0), the timer should have been started
    // but no unit should be spawned yet
    expect(spawner.oclUpdateTimerStarted[0]).toBe(true);
    expect(spawner.oclUpdateNextCreationFrames[0]).toBeGreaterThan(0);

    // No PeriodicUnit should exist at frame 0
    const states = logic.getRenderableEntityStates();
    expect(states.filter(s => s.templateName === 'PeriodicUnit').length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Test 2: FireOCLAfterWeaponCooldownUpdate -- Shot Count Gating
// ══════════════════════════════════════════════════════════════════════════════

describe('parity: FireOCLAfterWeaponCooldownUpdate shot count gating', () => {
  /**
   * C++ source: FireOCLAfterWeaponCooldownUpdate.cpp:102-183
   *   update():
   *     - Checks weapon slot matches m_weaponSlot
   *     - On lastShotFrame == now-1: m_consecutiveShots++, record m_startFrame on first
   *     - On possibleNextShotFrame < now (could fire but didn't):
   *       if m_minShotsRequired <= m_consecutiveShots -> fireOCL()
   *     - On validity change (weapon switch / no weapon): fire OCL if enough shots
   *     - On validity change: resetStats()
   *
   * C++ source: FireOCLAfterWeaponCooldownUpdate.cpp:193-208
   *   fireOCL():
   *     seconds = (now - m_startFrame) * SECONDS_PER_LOGICFRAME_REAL
   *     seconds *= m_oclLifetimePerSecond * 0.001
   *     oclFrames = (UnsignedInt)(seconds * LOGICFRAMES_PER_SECOND)
   *     oclFrames = MIN(oclFrames, m_oclMaxFrames)
   *     ObjectCreationList::create(m_ocl, obj, obj, oclFrames)
   *     resetStats()
   *
   * TS source: index.ts updateFireOCLAfterCooldown:
   *   - isFiring = entity.attackTargetEntityId !== null && entity.nextAttackFrame > 0
   *   - On lastShotFrame === frameCounter: consecutiveShots++ (backward-looking, matches C++)
   *   - On stop (isFiring false && enough shots) -> fireOCLAfterCooldown()
   *   - Lifetime: firingSeconds * oclLifetimePerSecond * 0.001 * LOGIC_FRAME_RATE
   *
   * Uses entity.lastShotFrame (set by combat-update when weapon fires) for a backward-
   * looking check that matches C++ weapon->getLastShotFrame() == now-1.
   */

  function makeFireOCLSetup(opts: {
    minShots?: number;
    delayBetweenShotsMs?: number;
    attackRange?: number;
    targetHealth?: number;
  } = {}) {
    const minShots = opts.minShots ?? 1;
    const delayMs = opts.delayBetweenShotsMs ?? 200; // 6 frames
    const range = opts.attackRange ?? 220;
    const targetHp = opts.targetHealth ?? 5000;

    const bundle = makeBundle({
      objects: [
        makeObjectDef('ShooterUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'CooldownGun'] }),
          makeBlock('Behavior', 'FireOCLAfterWeaponCooldownUpdate ModuleTag_FireOCL', {
            WeaponSlot: 'PRIMARY',
            OCL: 'OCL_AfterCooldown',
            MinShotsToCreateOCL: minShots,
            OCLLifetimePerSecond: 1000,
            OCLLifetimeMaxCap: 10000,
          }),
        ]),
        makeObjectDef('TargetUnit', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: targetHp, InitialHealth: targetHp }),
        ]),
        makeObjectDef('CooldownEffect', 'America', ['INERT'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 1, InitialHealth: 1 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('CooldownGun', {
          AttackRange: range,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          DelayBetweenShots: delayMs,
          DamageType: 'ARMOR_PIERCING',
          DeathType: 'NORMAL',
          WeaponSpeed: 999,
          ProjectileNudge: '0 0 0',
        }),
      ],
    });
    addOCL(bundle, 'OCL_AfterCooldown', 'CooldownEffect');

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ShooterUnit', 8, 8),
        makeMapObject('TargetUnit', 10, 8),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    return { logic };
  }

  it('tracks firing state and counts consecutive shots correctly', () => {
    // C++ parity: FireOCLAfterWeaponCooldownUpdate.cpp:141-152
    //   if (weapon->getLastShotFrame() == now - 1) {
    //     m_consecutiveShots++;
    //     if (m_consecutiveShots == 1) m_startFrame = now;
    //   }
    //
    // TS uses entity.lastShotFrame === this.frameCounter (backward-looking, matches C++).
    // Each shot fired by combat-update increments consecutiveShots.
    // With DelayBetweenShots=200ms (6 frames), 30 frames yields ~4-5 shots.
    const { logic } = makeFireOCLSetup({ minShots: 1 });

    // Command attacker to attack target
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run enough frames for weapon to fire multiple times
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Verify the tracking state has been initialized
    const attacker = priv(logic).spawnedEntities.get(1)!;
    expect(attacker.fireOCLAfterCooldownStates.length).toBe(1);
    const state = attacker.fireOCLAfterCooldownStates[0]!;
    // consecutiveShots should reflect actual shots fired (> 1 with fixed counting)
    expect(state.consecutiveShots).toBeGreaterThan(1);
    expect(state.startFrame).toBeGreaterThan(0);
    // valid should be true while actively firing
    expect(state.valid).toBe(true);
  });

  it('fires OCL when entity stops firing with MinShotsToCreateOCL=1', () => {
    // C++ parity: FireOCLAfterWeaponCooldownUpdate.cpp:153-161
    //   else if (weapon->getPossibleNextShotFrame() < now) {
    //     if (data->m_minShotsRequired <= m_consecutiveShots) fireOCL();
    //   }
    //
    // TS parity: index.ts:29672-29674
    //   else if (state.valid && state.consecutiveShots >= profile.minShotsRequired) {
    //     this.fireOCLAfterCooldown(entity, profile, state);
    //   }
    //
    // With MinShotsToCreateOCL=1 and TS consecutiveShots always being 1,
    // the OCL fires when the entity stops attacking.
    // Use high OCLLifetimeMaxCap and OCLLifetimePerSecond to ensure the spawned
    // entity persists long enough to detect.
    const bundle = makeBundle({
      objects: [
        makeObjectDef('ShooterUnit', 'America', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          makeBlock('WeaponSet', 'WeaponSet', { Weapon: ['PRIMARY', 'CooldownGun'] }),
          makeBlock('Behavior', 'FireOCLAfterWeaponCooldownUpdate ModuleTag_FireOCL', {
            WeaponSlot: 'PRIMARY',
            OCL: 'OCL_AfterCooldown',
            MinShotsToCreateOCL: 1,
            OCLLifetimePerSecond: 30000, // High so spawned entity lasts long
            OCLLifetimeMaxCap: 100000,   // ~3333 frames max
          }),
        ]),
        makeObjectDef('TargetUnit', 'China', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 30, InitialHealth: 30 }),
        ]),
        makeObjectDef('CooldownEffect', 'America', ['STRUCTURE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
        ]),
      ],
      weapons: [
        makeWeaponDef('CooldownGun', {
          AttackRange: 220,
          PrimaryDamage: 10,
          PrimaryDamageRadius: 0,
          DelayBetweenShots: 200,
          DamageType: 'ARMOR_PIERCING',
          DeathType: 'NORMAL',
          WeaponSpeed: 999,
          ProjectileNudge: '0 0 0',
        }),
      ],
    });
    addOCL(bundle, 'OCL_AfterCooldown', 'CooldownEffect');

    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([
        makeMapObject('ShooterUnit', 8, 8),
        makeMapObject('TargetUnit', 10, 8),
      ], 128, 128),
      makeRegistry(bundle),
      makeHeightmap(128, 128),
    );
    logic.setTeamRelationship('America', 'China', 0);
    logic.setTeamRelationship('China', 'America', 0);

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run enough frames to kill the target (30HP / 10dmg = 3 shots * 6 frames = ~18)
    // plus extra for attack setup and OCL processing
    for (let i = 0; i < 60; i++) logic.update(1 / 30);

    // Verify target is dead
    const target = priv(logic).spawnedEntities.get(2);
    expect(target === undefined || target.destroyed).toBe(true);

    // The attacker's state should show that the OCL was fired (consecutiveShots reset to 0)
    const attacker = priv(logic).spawnedEntities.get(1)!;
    const state = attacker.fireOCLAfterCooldownStates[0]!;

    // After the target dies and state.valid transitions false->false,
    // the OCL fires on the transition frame (state.valid was true, isFiring becomes false).
    // After OCL fires, resetStats() sets consecutiveShots=0, startFrame=0.
    expect(state.consecutiveShots).toBe(0);
    expect(state.startFrame).toBe(0);

    // CooldownEffect should have been spawned and persist due to high lifetime
    const allStates = logic.getRenderableEntityStates();
    const effects = allStates.filter(s => s.templateName === 'CooldownEffect');
    expect(effects.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire OCL when shot count is below minimum', () => {
    // C++ parity: FireOCLAfterWeaponCooldownUpdate.cpp:157-158
    //   if (data->m_minShotsRequired <= m_consecutiveShots) fireOCL();
    //
    // With MinShotsToCreateOCL=5 and target dying in 3 shots (30HP / 10dmg),
    // consecutiveShots=3 < minShots=5, so the OCL should not fire.
    const { logic } = makeFireOCLSetup({
      minShots: 5,
      delayBetweenShotsMs: 200,
      targetHealth: 30, // Target dies in 3 shots (30HP / 10dmg)
    });

    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });

    // Run enough to kill the target
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // Verify target is dead
    const target = priv(logic).spawnedEntities.get(2);
    expect(target === undefined || target.destroyed).toBe(true);

    // Run more frames for the cooldown OCL logic to trigger (if it would)
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    // CooldownEffect should NOT have been spawned -- consecutiveShots(3) < minShots(5)
    const states = logic.getRenderableEntityStates();
    const effects = states.filter(s => s.templateName === 'CooldownEffect');
    expect(effects.length).toBe(0);
  });

  it('profile extraction maps INI fields to correct internal values', () => {
    // C++ parity: FireOCLAfterWeaponCooldownUpdate.cpp:71-85
    //   { "WeaponSlot",          INI::parseLookupList, ...m_weaponSlot }
    //   { "OCL",                 INI::parseObjectCreationList, ...m_ocl }
    //   { "MinShotsToCreateOCL", INI::parseUnsignedInt, ...m_minShotsRequired }
    //   { "OCLLifetimePerSecond",INI::parseUnsignedInt, ...m_oclLifetimePerSecond }
    //   { "OCLLifetimeMaxCap",   INI::parseDurationUnsignedInt, ...m_oclMaxFrames }
    //
    // TS parity: entity-factory.ts:4014-4036 -- extractFireOCLAfterCooldownProfiles
    const { logic } = makeFireOCLSetup({ minShots: 5 });

    const attacker = priv(logic).spawnedEntities.get(1)!;
    expect(attacker.fireOCLAfterCooldownProfiles.length).toBe(1);

    const profile = attacker.fireOCLAfterCooldownProfiles[0]!;
    expect(profile.weaponSlot).toBe(0); // PRIMARY = 0
    expect(profile.oclName).toBe('OCL_AfterCooldown');
    expect(profile.minShotsRequired).toBe(5);
    expect(profile.oclLifetimePerSecond).toBe(1000);
    // OCLLifetimeMaxCap = 10000ms parsed as duration -> 10000/1000*30 = 300 frames
    expect(profile.oclMaxFrames).toBe(300);
  });

  it('resets shot count after OCL fires (C++ resetStats line 186-190)', () => {
    // C++ parity: FireOCLAfterWeaponCooldownUpdate.cpp:186-190
    //   void FireOCLAfterWeaponCooldownUpdate::resetStats() {
    //     m_consecutiveShots = 0;
    //     m_startFrame = 0;
    //   }
    //
    // Called at end of fireOCL() (line 207) and on validity changes (line 179).
    //
    // TS parity: index.ts:29702-29703
    //   state.consecutiveShots = 0;
    //   state.startFrame = 0;
    //
    // With MinShotsToCreateOCL=1 the OCL fires when consecutiveShots >= 1.
    // We observe the reset by checking state after the target dies and firing ceases.
    const { logic } = makeFireOCLSetup({
      minShots: 1,
      delayBetweenShotsMs: 200,
      targetHealth: 5000, // Keep target alive for observation
    });

    // Fire at the target
    logic.submitCommand({ type: 'attackEntity', entityId: 1, targetEntityId: 2 });
    for (let i = 0; i < 30; i++) logic.update(1 / 30);

    const attacker = priv(logic).spawnedEntities.get(1)!;
    const state = attacker.fireOCLAfterCooldownStates[0]!;

    // Should be actively firing -- state.valid true, consecutiveShots >= 1
    expect(state.valid).toBe(true);
    expect(state.consecutiveShots).toBeGreaterThanOrEqual(1);
    const startFrameBeforeStop = state.startFrame;
    expect(startFrameBeforeStop).toBeGreaterThan(0);

    // Now kill the target to stop firing
    const target = priv(logic).spawnedEntities.get(2)!;
    (target as unknown as { health: number }).health = 0;
    (target as unknown as { destroyed: boolean }).destroyed = true;

    // Run frames to process the stop
    for (let i = 0; i < 5; i++) logic.update(1 / 30);

    // After the stop, the state machine should have:
    // 1. Detected isFiring=false (target destroyed -> attackTargetEntityId cleared)
    // 2. Checked state.valid=true && consecutiveShots(1) >= minShotsRequired(1) -> true
    // 3. Called fireOCLAfterCooldown which calls resetStats
    // 4. Set state.valid = false
    expect(state.consecutiveShots).toBe(0);
    expect(state.startFrame).toBe(0);
    expect(state.valid).toBe(false);
  });
});
