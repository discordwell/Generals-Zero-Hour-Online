/**
 * ZH SpecialPower runtime logic differences tests.
 *
 * Source parity (all changes are Generals -> ZH diffs in SpecialPower modules):
 *   1. AcademyStats.recordSpecialPowerUsed — SpecialPowerModule.cpp:458
 *   2. ScriptedSpecialPowerOnly runtime enforcement — Player.cpp:1281,1291,1341
 *   3. OCLAdjustPositionToPassable — OCLSpecialPower.cpp:167-178
 *   4. getPercentReady paused clamp — SpecialPowerModule.cpp:323-327
 *   5. setReadyFrame updates pausedOnFrame — SpecialPowerModule.cpp:169-176
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
  makeSpecialPowerDef,
} from './test-helpers.js';

// ── Shared internals accessor ────────────────────────────────────────────────

interface MutableInternals {
  spawnedEntities: Map<number, any>;
  sideCredits: Map<string, number>;
  frameCounter: number;
  sharedShortcutSpecialPowerReadyFrames: Map<string, number>;
  sidePowerBonus: Map<string, any>;
  pausedShortcutSpecialPowerByName: Map<string, Map<number, any>>;
}

function getInternals(logic: GameLogicSubsystem): MutableInternals {
  return logic as unknown as MutableInternals;
}

// =============================================================================
// 1. AcademyStats.recordSpecialPowerUsed
// =============================================================================

describe('AcademyStats.recordSpecialPowerUsed (SpecialPowerModule.cpp:458)', () => {
  function makeBundle_SPUsed() {
    return makeBundle({
      objects: [
        // Simple unit with a generic special power module (no Enum restriction, so no
        // shroud or dispatch-mode gating applies).
        makeObjectDef('SPSource', 'America', ['INFANTRY'], [
          makeBlock('Behavior', 'SpecialPowerModule ModuleTag_SP', {
            SpecialPowerTemplate: 'TestPower',
          }),
        ]),
      ],
      specialPowers: [
        // No Enum, no SharedSyncedTimer — simplest possible power.
        makeSpecialPowerDef('TestPower', { ReloadTime: 0 }),
      ],
    });
  }

  it('increments specialPowerUsedCount on AcademyStats when power fires', () => {
    const bundle = makeBundle_SPUsed();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SPSource', 10, 10), // id 1
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Before firing, no stats.
    expect(logic.getAcademyStats('America')).toBeNull();

    // Fire the power (no target, simplest dispatch).
    logic.submitCommand({
      type: 'issueSpecialPower',
      specialPowerName: 'TestPower',
      issuingEntityIds: [1],
      sourceEntityId: 1,
      commandOption: 0,
      commandButtonId: 'CMD_TEST',
      targetEntityId: null,
      targetX: null,
      targetZ: null,
    });
    logic.update(0);

    const stats = logic.getAcademyStats('America');
    expect(stats).not.toBeNull();
    expect(stats!.specialPowerUsedCount).toBe(1);
  });

  it('increments multiple times for multiple firings', () => {
    const bundle = makeBundle_SPUsed();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SPSource', 10, 10), // id 1
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Fire twice.
    for (let i = 0; i < 2; i++) {
      logic.submitCommand({
        type: 'issueSpecialPower',
        specialPowerName: 'TestPower',
        issuingEntityIds: [1],
        sourceEntityId: 1,
        commandOption: 0,
        commandButtonId: 'CMD_TEST',
        targetEntityId: null,
        targetX: null,
        targetZ: null,
      });
      logic.update(0);
    }

    const stats = logic.getAcademyStats('America');
    expect(stats).not.toBeNull();
    expect(stats!.specialPowerUsedCount).toBe(2);
  });

  it('does not create stats for sides that never use powers', () => {
    const bundle = makeBundle_SPUsed();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('SPSource', 10, 10),
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    expect(logic.getAcademyStats('GLA')).toBeNull();
  });
});

// =============================================================================
// 2. ScriptedSpecialPowerOnly runtime enforcement
// =============================================================================

describe('ScriptedSpecialPowerOnly runtime enforcement (Player.cpp:1281,1291,1341)', () => {
  function makeScriptOnlyBundle() {
    return makeBundle({
      objects: [
        // A unit with a script-only power (like cargo plane).
        makeObjectDef('CargoPlane', 'America', ['AIRCRAFT'], [
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_CARGO_DROP',
            ScriptedSpecialPowerOnly: true,
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        ]),
        // A unit with a normal (non-script-only) power.
        makeObjectDef('CommandCenter', 'America', ['STRUCTURE', 'COMMANDCENTER'], [
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_CARGO_DROP', {
          ReloadTime: 6000,
          Enum: 'SPECIAL_CARGO_DROP',
        }),
        makeSpecialPowerDef('SPECIAL_PARTICLE_UPLINK_CANNON', {
          ReloadTime: 6000,
          SharedSyncedTimer: true,
          Enum: 'SPECIAL_PARTICLE_UPLINK_CANNON',
        }),
      ],
    });
  }

  it('hasAnyShortcutSpecialPower skips script-only modules', () => {
    const bundle = makeScriptOnlyBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CargoPlane', 10, 10), // id 1 — script-only power
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // CargoPlane has a special power module, but it's script-only.
    // hasAnyShortcutSpecialPower should return false.
    expect(logic.hasAnyShortcutSpecialPower('America')).toBe(false);
  });

  it('hasAnyShortcutSpecialPower returns true for non-script-only modules', () => {
    const bundle = makeScriptOnlyBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CargoPlane', 10, 10),     // id 1 — script-only
        makeMapObject('CommandCenter', 20, 10),  // id 2 — normal
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // CommandCenter has a non-script-only power, so this should return true.
    expect(logic.hasAnyShortcutSpecialPower('America')).toBe(true);
  });

  it('findMostReadyShortcutSpecialPowerOfType skips script-only modules', () => {
    const bundle = makeScriptOnlyBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CargoPlane', 10, 10), // id 1 — script-only
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Even if the cargo plane has a matching power, it should be skipped.
    const result = logic.findMostReadyShortcutSpecialPowerOfType('America', 'SPECIAL_CARGO_DROP');
    expect(result).toBeNull();
  });

  it('countReadyShortcutSpecialPowersOfType skips script-only modules', () => {
    const bundle = makeScriptOnlyBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CargoPlane', 10, 10), // id 1 — script-only
      ], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    logic.trackShortcutSpecialPowerSourceEntity('SPECIAL_CARGO_DROP', 1, 0);
    const count = logic.countReadyShortcutSpecialPowersOfType('America', 'SPECIAL_CARGO_DROP');
    expect(count).toBe(0);
  });
});

// =============================================================================
// 3. OCLAdjustPositionToPassable
// =============================================================================

describe('OCLAdjustPositionToPassable (OCLSpecialPower.cpp:167-178)', () => {
  function makeOCLAdjustBundle(adjustEnabled: boolean) {
    return makeBundle({
      objects: [
        makeObjectDef('SupplyCenter', 'America', ['STRUCTURE'], [
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_SUPPLY_DROP',
            OCLAdjustPositionToPassable: adjustEnabled,
            OCL: 'OCL_SupplyDrop',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_SUPPLY_DROP', {
          ReloadTime: 3000,
          Enum: 'SPECIAL_SUPPLY_DROP',
        }),
      ],
    });
  }

  it('oclAdjustPositionToPassable field is extracted correctly', () => {
    const bundleEnabled = makeOCLAdjustBundle(true);
    const bundleDisabled = makeOCLAdjustBundle(false);

    const logicEnabled = new GameLogicSubsystem(new THREE.Scene());
    logicEnabled.loadMapObjects(
      makeMap([makeMapObject('SupplyCenter', 10, 10)], 64, 64),
      makeRegistry(bundleEnabled),
      makeHeightmap(64, 64),
    );
    logicEnabled.update(1 / 30);

    const logicDisabled = new GameLogicSubsystem(new THREE.Scene());
    logicDisabled.loadMapObjects(
      makeMap([makeMapObject('SupplyCenter', 10, 10)], 64, 64),
      makeRegistry(bundleDisabled),
      makeHeightmap(64, 64),
    );
    logicDisabled.update(1 / 30);

    // Verify the flag was extracted (check entity's special power module profile).
    const entityEnabled = getInternals(logicEnabled).spawnedEntities.get(1);
    const entityDisabled = getInternals(logicDisabled).spawnedEntities.get(1);

    const moduleEnabled = entityEnabled?.specialPowerModules?.get('SPECIAL_SUPPLY_DROP');
    const moduleDisabled = entityDisabled?.specialPowerModules?.get('SPECIAL_SUPPLY_DROP');

    expect(moduleEnabled?.oclAdjustPositionToPassable).toBe(true);
    expect(moduleDisabled?.oclAdjustPositionToPassable).toBe(false);
  });
});

// =============================================================================
// 4. getPercentReady paused clamp
// =============================================================================

describe('getPercentReady paused clamp (SpecialPowerModule.cpp:323-327)', () => {
  function makePausedPowerBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('PowerPlant', 'America', ['STRUCTURE', 'POWERED'], [
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_PARTICLE_UPLINK_CANNON', {
          ReloadTime: 6000,
          Enum: 'SPECIAL_PARTICLE_UPLINK_CANNON',
        }),
      ],
    });
  }

  it('returns 1.0 when power is ready and not paused', () => {
    const bundle = makePausedPowerBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('PowerPlant', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Track with ready frame in the past.
    logic.trackShortcutSpecialPowerSourceEntity('SPECIAL_PARTICLE_UPLINK_CANNON', 1, 0);

    const percent = logic.getSpecialPowerPercentReady('SPECIAL_PARTICLE_UPLINK_CANNON', 1);
    expect(percent).toBe(1.0);
  });

  it('returns 0.99999 when paused and would-be fully ready', () => {
    const bundle = makePausedPowerBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('PowerPlant', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );
    logic.update(1 / 30);

    // Track with ready frame in the past (fully charged).
    logic.trackShortcutSpecialPowerSourceEntity('SPECIAL_PARTICLE_UPLINK_CANNON', 1, 0);

    // Pause the power.
    const priv = getInternals(logic);
    const pauseMap = new Map<number, any>();
    pauseMap.set(1, { pausedCount: 1, pausedOnFrame: 0 });
    priv.pausedShortcutSpecialPowerByName.set('SPECIAL_PARTICLE_UPLINK_CANNON', pauseMap);

    const percent = logic.getSpecialPowerPercentReady('SPECIAL_PARTICLE_UPLINK_CANNON', 1);
    // Source parity: ZH clamps to 0.99999 when paused at 100%.
    expect(percent).toBeLessThan(1.0);
    expect(percent).toBeCloseTo(0.99999, 4);
  });

  it('returns partial percent when not ready and not paused', () => {
    const bundle = makePausedPowerBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('PowerPlant', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Advance several frames.
    for (let i = 0; i < 10; i++) {
      logic.update(1 / 30);
    }

    // Track with ready frame far in the future.
    const priv = getInternals(logic);
    const futureFrame = priv.frameCounter + 100;
    logic.trackShortcutSpecialPowerSourceEntity('SPECIAL_PARTICLE_UPLINK_CANNON', 1, futureFrame);

    const percent = logic.getSpecialPowerPercentReady('SPECIAL_PARTICLE_UPLINK_CANNON', 1);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThan(1.0);
  });
});

// =============================================================================
// 5. setReadyFrame updates pausedOnFrame
// =============================================================================

describe('setReadyFrame updates pausedOnFrame (SpecialPowerModule.cpp:169-176)', () => {
  function makePausableBundle() {
    return makeBundle({
      objects: [
        makeObjectDef('SuperWeapon', 'America', ['STRUCTURE', 'FS_SUPERWEAPON'], [
          makeBlock('Behavior', 'OCLSpecialPower ModuleTag_SP', {
            SpecialPowerTemplate: 'SPECIAL_PARTICLE_UPLINK_CANNON',
          }),
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 2000, InitialHealth: 2000 }),
        ]),
      ],
      specialPowers: [
        makeSpecialPowerDef('SPECIAL_PARTICLE_UPLINK_CANNON', {
          ReloadTime: 6000,
          Enum: 'SPECIAL_PARTICLE_UPLINK_CANNON',
        }),
      ],
    });
  }

  it('updates pausedOnFrame when setReadyFrame is called while paused', () => {
    const bundle = makePausableBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SuperWeapon', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    // Advance to frame 5.
    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    const priv = getInternals(logic);

    // Set up a paused power at frame 2.
    const pauseMap = new Map<number, any>();
    pauseMap.set(1, { pausedCount: 1, pausedOnFrame: 2 });
    priv.pausedShortcutSpecialPowerByName.set('SPECIAL_PARTICLE_UPLINK_CANNON', pauseMap);

    // Verify initial pausedOnFrame.
    const pauseStateBefore = priv.pausedShortcutSpecialPowerByName
      .get('SPECIAL_PARTICLE_UPLINK_CANNON')!
      .get(1)!;
    expect(pauseStateBefore.pausedOnFrame).toBe(2);

    // Call setSpecialPowerReadyFrame (simulates a script changing the ready frame).
    const setReadyFrame = (logic as any).setSpecialPowerReadyFrame.bind(logic);
    setReadyFrame('SPECIAL_PARTICLE_UPLINK_CANNON', 1, false, priv.frameCounter + 100);

    // Verify that pausedOnFrame was updated to the current frame.
    const pauseStateAfter = priv.pausedShortcutSpecialPowerByName
      .get('SPECIAL_PARTICLE_UPLINK_CANNON')!
      .get(1)!;
    expect(pauseStateAfter.pausedOnFrame).toBe(priv.frameCounter);
  });

  it('does not modify pausedOnFrame when power is not paused', () => {
    const bundle = makePausableBundle();
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([makeMapObject('SuperWeapon', 10, 10)], 64, 64),
      makeRegistry(bundle),
      makeHeightmap(64, 64),
    );

    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    const priv = getInternals(logic);

    // No pause state set — the power is not paused.
    const setReadyFrame = (logic as any).setSpecialPowerReadyFrame.bind(logic);
    setReadyFrame('SPECIAL_PARTICLE_UPLINK_CANNON', 1, false, priv.frameCounter + 100);

    // No pause state should exist.
    const pausedBySource = priv.pausedShortcutSpecialPowerByName.get('SPECIAL_PARTICLE_UPLINK_CANNON');
    expect(pausedBySource).toBeUndefined();
  });
});
