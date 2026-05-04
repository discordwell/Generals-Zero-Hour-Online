/**
 * Parity tests for RiderChangeContain module extraction.
 *
 * Source references:
 *   RiderChangeContain.h — RiderInfo struct, MAX_RIDERS = 8
 *   RiderChangeContain.cpp:66-120 — constructor defaults, parseRiderInfo, buildFieldParse
 *
 * Verifies:
 *   - extractContainProfile produces moduleType 'RIDERCHANGE' for RiderChangeContain blocks
 *   - extractRiderChangeContainProfile parses Rider1–Rider8 fields into rider array
 *   - ScuttleDelay is converted from ms → frames
 *   - ScuttleStatus defaults to 'TOPPLED' per C++ constructor
 *   - Rider fields correctly map to RiderInfo struct members
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { extractContainProfile, extractRiderChangeContainProfile } from './entity-factory.js';
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
} from './test-helpers.js';

// Stub self with msToLogicFrames matching C++ LOGIC_FRAME_RATE = 30.
const self = {
  msToLogicFrames: (ms: number) => Math.round(ms / (1000 / 30)),
} as any;

const LOGIC_FRAME_RATE = 30;

// ── Helper: minimal RiderChangeContain block ──────────────────────────────

function makeRiderChangeBlock(
  fields: Record<string, unknown> = {},
  blocks: any[] = [],
) {
  return makeBlock('Behavior', 'RiderChangeContain ModuleTag_16', {
    ContainMax: 1,
    Slots: 1,
    ...fields,
  }, blocks);
}

// ── extractContainProfile: RIDERCHANGE moduleType ─────────────────────────

describe('extractContainProfile — RiderChangeContain', () => {
  it('recognizes RiderChangeContain as moduleType RIDERCHANGE', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('RIDERCHANGE');
  });

  it('parses transport capacity from Slots field', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({ Slots: 3 }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.transportCapacity).toBe(3);
  });

  it('inherits TransportContain fields like ScatterNearbyOnExit', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({ ScatterNearbyOnExit: false }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scatterNearbyOnExit).toBe(false);
  });

  it('parses InitialPayload for rider-change vehicles', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({ InitialPayload: 'GLAInfantryTerrorist 1' }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.initialPayloadTemplateName).toBe('GLAInfantryTerrorist');
    expect(profile!.initialPayloadCount).toBe(1);
  });
});

// ── extractRiderChangeContainProfile ──────────────────────────────────────

describe('extractRiderChangeContainProfile', () => {
  it('returns null when no RiderChangeContain block exists', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', { ContainMax: 5 }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).toBeNull();
  });

  it('returns null for undefined objectDef', () => {
    const profile = extractRiderChangeContainProfile(self, undefined);
    expect(profile).toBeNull();
  });

  it('parses all 7 riders from Combat Bike INI data', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryWorker', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_NORMAL'],
        Rider2: ['GLAInfantryRebel', 'RIDER2', 'WEAPON_RIDER2', 'STATUS_RIDER2', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_NORMAL'],
        Rider3: ['GLAInfantryTunnelDefender', 'RIDER3', 'WEAPON_RIDER3', 'STATUS_RIDER3', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_NORMAL'],
        Rider4: ['GLAInfantryJarmenKell', 'RIDER4', 'WEAPON_RIDER4', 'STATUS_RIDER4', 'GLAVehicleCombatBikeJarmenKellCommandSet', 'SET_NORMAL'],
        Rider5: ['GLAInfantryTerrorist', 'RIDER5', 'WEAPON_RIDER5', 'STATUS_RIDER5', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_SLUGGISH'],
        Rider6: ['GLAInfantryHijacker', 'RIDER6', 'WEAPON_RIDER6', 'STATUS_RIDER6', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_NORMAL'],
        Rider7: ['GLAInfantrySaboteur', 'RIDER7', 'WEAPON_RIDER7', 'STATUS_RIDER7', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_NORMAL'],
        ScuttleDelay: 1500,
        ScuttleStatus: 'TOPPLED',
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.riders).toHaveLength(7);
  });

  it('parses rider template names to UPPERCASE', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.riders[0]!.templateName).toBe('GLAINFANTRYREBEL');
  });

  it('parses rider struct fields correctly (C++ RiderInfo parity)', () => {
    // Source parity: parseRiderInfo reads tokens in order:
    //   templateName, modelConditionFlag, weaponSetFlag, objectStatus, commandSet, locomotorSetType
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryTerrorist', 'RIDER5', 'WEAPON_RIDER5', 'STATUS_RIDER5', 'GLAVehicleCombatBikeDefaultCommandSet', 'SET_SLUGGISH'],
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    const rider = profile!.riders[0]!;
    expect(rider.templateName).toBe('GLAINFANTRYTERRORIST');
    expect(rider.modelConditionFlag).toBe('RIDER5');
    expect(rider.weaponSetFlag).toBe('WEAPON_RIDER5');
    expect(rider.objectStatus).toBe('STATUS_RIDER5');
    expect(rider.commandSet).toBe('GLAVehicleCombatBikeDefaultCommandSet');
    expect(rider.locomotorSetType).toBe('SET_SLUGGISH');
  });

  it('converts ScuttleDelay from ms to frames (parseDurationUnsignedInt parity)', () => {
    // Source parity: 1500ms at 30fps = 45 frames
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
        ScuttleDelay: 1500,
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scuttleDelayFrames).toBe(45);
  });

  it('ScuttleDelay defaults to 0 when not specified', () => {
    // Source parity: RiderChangeContainModuleData constructor: m_scuttleFrames = 0
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scuttleDelayFrames).toBe(0);
  });

  it('ScuttleStatus defaults to TOPPLED per C++ constructor', () => {
    // Source parity: RiderChangeContainModuleData constructor: m_scuttleState = MODELCONDITION_TOPPLED
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scuttleStatus).toBe('TOPPLED');
  });

  it('parses custom ScuttleStatus from INI', () => {
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
        ScuttleStatus: 'DESTROYED',
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scuttleStatus).toBe('DESTROYED');
  });

  it('skips rider slots with fewer than 6 tokens', () => {
    // Malformed rider with only 3 tokens should be ignored
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock({
        Rider1: ['GLAInfantryRebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'DefaultCommandSet', 'SET_NORMAL'],
        Rider2: ['IncompleteData', 'RIDER2'],
      }),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.riders).toHaveLength(1);
    expect(profile!.riders[0]!.templateName).toBe('GLAINFANTRYREBEL');
  });

  it('handles all 8 rider slots (MAX_RIDERS parity)', () => {
    // Source parity: MAX_RIDERS = 8
    const fields: Record<string, unknown> = {};
    for (let i = 1; i <= 8; i++) {
      fields[`Rider${i}`] = [`Infantry${i}`, `RIDER${i}`, `WEAPON_RIDER${i}`, `STATUS_RIDER${i}`, 'CmdSet', 'SET_NORMAL'];
    }
    const objectDef = makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeRiderChangeBlock(fields),
    ]);
    const profile = extractRiderChangeContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.riders).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(profile!.riders[i]!.templateName).toBe(`INFANTRY${i + 1}`);
      expect(profile!.riders[i]!.modelConditionFlag).toBe(`RIDER${i + 1}`);
      expect(profile!.riders[i]!.weaponSetFlag).toBe(`WEAPON_RIDER${i + 1}`);
      expect(profile!.riders[i]!.objectStatus).toBe(`STATUS_RIDER${i + 1}`);
    }
  });
});

describe('RiderChangeContain runtime', () => {
  function makeRiderChangeRuntimeBundle(scuttleDelay = 90) {
    return makeBundle({
      objects: [
        makeObjectDef('CombatBike', 'GLA', ['VEHICLE'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
          makeRiderChangeBlock({
            AllowInsideKindOf: 'INFANTRY',
            ScuttleDelay: scuttleDelay,
            ScuttleStatus: 'TOPPLED',
            Rider1: ['Rebel', 'RIDER1', 'WEAPON_RIDER1', 'STATUS_RIDER1', 'BikeRebelCommandSet', 'SET_SLUGGISH'],
            Rider2: ['Worker', 'RIDER2', 'WEAPON_RIDER2', 'STATUS_RIDER2', 'BikeWorkerCommandSet', 'SET_NORMAL'],
          }),
          makeBlock('LocomotorSet', 'SET_NORMAL BikeNormalLoco', {}),
          makeBlock('LocomotorSet', 'SET_SLUGGISH BikeSlowLoco', {}),
        ], { CommandSet: 'BikeEmptyCommandSet' }),
        makeObjectDef('Rebel', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Worker', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
        ], { TransportSlotCount: 1 }),
        makeObjectDef('Hijacker', 'GLA', ['INFANTRY'], [
          makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
          makeBlock('LocomotorSet', 'SET_NORMAL InfantryLoco', {}),
        ], { TransportSlotCount: 1 }),
      ],
      locomotors: [
        makeLocomotorDef('BikeNormalLoco', 50),
        makeLocomotorDef('BikeSlowLoco', 20),
        makeLocomotorDef('InfantryLoco', 30),
      ],
    });
  }

  function loadRuntime(scuttleDelay = 90) {
    const logic = new GameLogicSubsystem(new THREE.Scene());
    logic.loadMapObjects(
      makeMap([
        makeMapObject('CombatBike', 20, 20),
        makeMapObject('Rebel', 20, 20),
        makeMapObject('Worker', 20, 20),
        makeMapObject('Hijacker', 20, 20),
      ]),
      makeRegistry(makeRiderChangeRuntimeBundle(scuttleDelay)),
      makeHeightmap(),
    );
    return logic;
  }

  it('accepts configured rider templates and applies rider bike state on entry', () => {
    const logic = loadRuntime();

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);

    const bike = (logic as any).spawnedEntities.get(1);
    const rebel = (logic as any).spawnedEntities.get(2);
    expect(rebel.transportContainerId).toBe(1);
    expect(rebel.objectStatusFlags.has('MASKED')).toBe(true);
    expect(bike.modelConditionFlags.has('RIDER1')).toBe(true);
    expect((bike.weaponSetFlagsMask & (1 << 9)) !== 0).toBe(true);
    expect(bike.objectStatusFlags.has('STATUS_RIDER1')).toBe(true);
    expect(bike.commandSetStringOverride).toBe('BikeRebelCommandSet');
    expect(bike.activeLocomotorSet).toBe('SET_SLUGGISH');

    logic.submitCommand({ type: 'enterTransport', entityId: 4, targetTransportId: 1 });
    logic.update(1 / 30);

    expect((logic as any).spawnedEntities.get(4).transportContainerId).toBeNull();
    expect(bike.modelConditionFlags.has('RIDER1')).toBe(true);
  });

  it('replaces existing rider without scuttling, then scuttles on normal rider exit', () => {
    const logic = loadRuntime(120);

    logic.submitCommand({ type: 'enterTransport', entityId: 2, targetTransportId: 1 });
    logic.update(1 / 30);
    logic.submitCommand({ type: 'enterTransport', entityId: 3, targetTransportId: 1 });
    logic.update(1 / 30);

    const bike = (logic as any).spawnedEntities.get(1);
    expect((logic as any).spawnedEntities.get(2).transportContainerId).toBeNull();
    expect((logic as any).spawnedEntities.get(3).transportContainerId).toBe(1);
    expect(bike.riderChangeScuttledFrame).toBe(0);
    expect(bike.modelConditionFlags.has('RIDER1')).toBe(false);
    expect(bike.modelConditionFlags.has('RIDER2')).toBe(true);
    expect((bike.weaponSetFlagsMask & (1 << 9)) === 0).toBe(true);
    expect((bike.weaponSetFlagsMask & (1 << 10)) !== 0).toBe(true);
    expect(bike.objectStatusFlags.has('STATUS_RIDER2')).toBe(true);
    expect(bike.commandSetStringOverride).toBe('BikeWorkerCommandSet');

    bike.moving = false;
    logic.submitCommand({ type: 'exitContainer', entityId: 3 });
    logic.update(1 / 30);

    expect((logic as any).spawnedEntities.get(3).transportContainerId).toBeNull();
    expect(bike.riderChangeScuttledFrame).toBeGreaterThan(0);
    expect(bike.objectStatusFlags.has('UNSELECTABLE')).toBe(true);
    expect(bike.objectStatusFlags.has('IMMOBILE')).toBe(true);
    expect(bike.modelConditionFlags.has('TOPPLED')).toBe(true);
    expect(bike.modelConditionFlags.has('RIDER2')).toBe(false);

    for (let i = 0; i < 5; i++) {
      logic.update(1 / 30);
    }

    const killedBike = (logic as any).spawnedEntities.get(1);
    expect(killedBike?.destroyed ?? true).toBe(true);
  });
});
