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

import { describe, expect, it } from 'vitest';

import { extractContainProfile, extractRiderChangeContainProfile } from './entity-factory.js';
import {
  makeBlock,
  makeObjectDef,
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
