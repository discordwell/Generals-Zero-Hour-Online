/**
 * Parity tests for OpenContain and TransportContain FieldParse fields.
 *
 * Source references:
 *   OpenContain.cpp:72-117 — OpenContainModuleData constructor + buildFieldParse
 *   TransportContain.cpp:57-121 — TransportContainModuleData constructor + buildFieldParse
 *
 * Verifies that all 14 added containment profile fields are correctly parsed
 * from INI data with proper C++ defaults and value conversions.
 */

import { describe, expect, it } from 'vitest';

import { extractContainProfile } from './entity-factory.js';
import {
  makeBlock,
  makeObjectDef,
} from './test-helpers.js';

// Stub self with msToLogicFrames for extractContainProfile.
const self = {
  msToLogicFrames: (ms: number) => Math.round(ms / (1000 / 30)),
} as any;

const LOGIC_FRAME_RATE = 30;

// ── OpenContain field defaults ─────────────────────────────────────────────

describe('OpenContain field defaults (C++ parity)', () => {
  it('PassengersInTurret defaults to false', () => {
    // Source parity: OpenContainModuleData::m_passengersInTurret = FALSE (line 77)
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.passengersInTurret).toBe(false);
  });

  it('PassengersInTurret parses true from INI', () => {
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
        PassengersInTurret: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.passengersInTurret).toBe(true);
  });

  it('NumberOfExitPaths defaults to 1 (C++ constructor default)', () => {
    // Source parity: OpenContainModuleData::m_numberOfExitPaths = 1 (line 78)
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.numberOfExitPaths).toBe(1);
  });

  it('NumberOfExitPaths parses custom value from INI', () => {
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
        NumberOfExitPaths: 3,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.numberOfExitPaths).toBe(3);
  });

  it('WeaponBonusPassedToPassengers defaults to false', () => {
    // Source parity: OpenContainModuleData::m_weaponBonusPassedToPassengers = FALSE (line 84)
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.weaponBonusPassedToPassengers).toBe(false);
  });

  it('WeaponBonusPassedToPassengers parses true from INI', () => {
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
        WeaponBonusPassedToPassengers: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.weaponBonusPassedToPassengers).toBe(true);
  });

  it('EnterSound defaults to empty string', () => {
    // Source parity: m_enterSound is default-constructed (empty AudioEventRTS)
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.enterSound).toBe('');
  });

  it('EnterSound parses audio event name from INI', () => {
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
        EnterSound: 'HumveeLoadUnit',
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.enterSound).toBe('HumveeLoadUnit');
  });

  it('ExitSound defaults to empty string', () => {
    // Source parity: m_exitSound is default-constructed (empty AudioEventRTS)
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitSound).toBe('');
  });

  it('ExitSound parses audio event name from INI', () => {
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
        ExitSound: 'HumveeUnloadUnit',
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitSound).toBe('HumveeUnloadUnit');
  });
});

// ── OpenContain fields inherited by non-transport modules ──────────────────

describe('OpenContain fields propagate to all container module types', () => {
  it('GarrisonContain inherits OpenContain fields with correct defaults', () => {
    const objectDef = makeObjectDef('Building', 'America', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'GarrisonContain ModuleTag_Contain', {
        ContainMax: 10,
        PassengersInTurret: true,
        EnterSound: 'GarrisonEnter',
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('GARRISON');
    expect(profile!.passengersInTurret).toBe(true);
    expect(profile!.enterSound).toBe('GarrisonEnter');
    expect(profile!.exitSound).toBe('');
    // TransportContain fields use defaults for non-transport modules.
    expect(profile!.scatterNearbyOnExit).toBe(true);
    expect(profile!.goAggressiveOnExit).toBe(false);
  });

  it('TunnelContain inherits OpenContain fields', () => {
    const objectDef = makeObjectDef('TunnelNetwork', 'China', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TunnelContain ModuleTag_Contain', {
        TimeForFullHeal: 10000,
        NumberOfExitPaths: 2,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('TUNNEL');
    expect(profile!.numberOfExitPaths).toBe(2);
    // TransportContain defaults for non-transport type.
    expect(profile!.exitBone).toBe('');
    expect(profile!.delayExitInAir).toBe(false);
  });

  it('HealContain inherits OpenContain fields', () => {
    const objectDef = makeObjectDef('Ambulance', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'HealContain ModuleTag_Contain', {
        ContainMax: 3,
        TimeForFullHeal: 5000,
        ExitSound: 'HealComplete',
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('HEAL');
    expect(profile!.exitSound).toBe('HealComplete');
    expect(profile!.passengersInTurret).toBe(false);
  });
});

// ── TransportContain field defaults ────────────────────────────────────────

describe('TransportContain field defaults (C++ parity)', () => {
  it('ScatterNearbyOnExit defaults to true', () => {
    // Source parity: TransportContainModuleData::m_scatterNearbyOnExit = true (line 61)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scatterNearbyOnExit).toBe(true);
  });

  it('ScatterNearbyOnExit parses false from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        ScatterNearbyOnExit: false,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.scatterNearbyOnExit).toBe(false);
  });

  it('OrientLikeContainerOnExit defaults to false', () => {
    // Source parity: TransportContainModuleData::m_orientLikeContainerOnExit = false (line 62)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.orientLikeContainerOnExit).toBe(false);
  });

  it('OrientLikeContainerOnExit parses true from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        OrientLikeContainerOnExit: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.orientLikeContainerOnExit).toBe(true);
  });

  it('KeepContainerVelocityOnExit defaults to false', () => {
    // Source parity: TransportContainModuleData::m_keepContainerVelocityOnExit = false (line 63)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.keepContainerVelocityOnExit).toBe(false);
  });

  it('KeepContainerVelocityOnExit parses true from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        KeepContainerVelocityOnExit: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.keepContainerVelocityOnExit).toBe(true);
  });

  it('GoAggressiveOnExit defaults to false', () => {
    // Source parity: TransportContainModuleData::m_goAggressiveOnExit = FALSE (line 64)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.goAggressiveOnExit).toBe(false);
  });

  it('GoAggressiveOnExit parses true from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        GoAggressiveOnExit: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.goAggressiveOnExit).toBe(true);
  });

  it('ResetMoodCheckTimeOnExit defaults to true', () => {
    // Source parity: TransportContainModuleData::m_resetMoodCheckTimeOnExit = true (line 66)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.resetMoodCheckTimeOnExit).toBe(true);
  });

  it('ResetMoodCheckTimeOnExit parses false from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        ResetMoodCheckTimeOnExit: false,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.resetMoodCheckTimeOnExit).toBe(false);
  });

  it('ExitBone defaults to empty string', () => {
    // Source parity: m_exitBone is default-constructed (empty AsciiString)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitBone).toBe('');
  });

  it('ExitBone parses bone name from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        ExitBone: 'EXITDOOR01',
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitBone).toBe('EXITDOOR01');
  });

  it('ExitPitchRate defaults to 0', () => {
    // Source parity: TransportContainModuleData::m_exitPitchRate = 0.0f (line 68)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.exitPitchRate).toBe(0);
  });

  it('ExitPitchRate converts degrees/sec to radians/frame via parseAngularVelocityReal', () => {
    // Source parity: INI::parseAngularVelocityReal — degPerSec * (PI/180) / 30
    // ExitPitchRate = 180 deg/sec => 180 * (PI/180) / 30 = PI/30 rad/frame
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        ExitPitchRate: 180,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    const expected = 180 * (Math.PI / 180) / LOGIC_FRAME_RATE; // PI/30
    expect(profile!.exitPitchRate).toBeCloseTo(expected, 10);
  });

  it('ArmedRidersUpgradeMyWeaponSet defaults to false', () => {
    // Source parity: TransportContainModuleData::m_armedRidersUpgradeWeaponSet = FALSE (line 65)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.armedRidersUpgradeMyWeaponSet).toBe(false);
  });

  it('ArmedRidersUpgradeMyWeaponSet parses true from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        ArmedRidersUpgradeMyWeaponSet: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.armedRidersUpgradeMyWeaponSet).toBe(true);
  });

  it('DelayExitInAir defaults to false', () => {
    // Source parity: TransportContainModuleData::m_isDelayExitInAir = FALSE (line 72)
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.delayExitInAir).toBe(false);
  });

  it('DelayExitInAir parses true from INI', () => {
    const objectDef = makeObjectDef('APC', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 8,
        DelayExitInAir: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.delayExitInAir).toBe(true);
  });
});

// ── TransportContain fields inherited by transport-derived modules ─────────

describe('TransportContain fields propagate to transport-derived module types', () => {
  it('OverlordContain inherits TransportContain fields from INI', () => {
    const objectDef = makeObjectDef('Overlord', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 600, InitialHealth: 600 }),
      makeBlock('Behavior', 'OverlordContain ModuleTag_Contain', {
        ContainMax: 5,
        Slots: 5,
        ScatterNearbyOnExit: false,
        OrientLikeContainerOnExit: true,
        GoAggressiveOnExit: true,
        ExitBone: 'PSYCHEDUP',
        ExitPitchRate: 90,
        ArmedRidersUpgradeMyWeaponSet: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('OVERLORD');
    expect(profile!.scatterNearbyOnExit).toBe(false);
    expect(profile!.orientLikeContainerOnExit).toBe(true);
    expect(profile!.goAggressiveOnExit).toBe(true);
    expect(profile!.exitBone).toBe('PSYCHEDUP');
    expect(profile!.exitPitchRate).toBeCloseTo(90 * (Math.PI / 180) / LOGIC_FRAME_RATE, 10);
    expect(profile!.armedRidersUpgradeMyWeaponSet).toBe(true);
    // OpenContain fields with defaults.
    expect(profile!.passengersInTurret).toBe(false);
    expect(profile!.enterSound).toBe('');
  });

  it('HelixContain inherits TransportContain fields from INI', () => {
    const objectDef = makeObjectDef('Helix', 'China', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 400, InitialHealth: 400 }),
      makeBlock('Behavior', 'HelixContain ModuleTag_Contain', {
        ContainMax: 5,
        Slots: 5,
        KeepContainerVelocityOnExit: true,
        DelayExitInAir: true,
        EnterSound: 'HelixLoad',
        ExitSound: 'HelixUnload',
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('HELIX');
    expect(profile!.keepContainerVelocityOnExit).toBe(true);
    expect(profile!.delayExitInAir).toBe(true);
    expect(profile!.enterSound).toBe('HelixLoad');
    expect(profile!.exitSound).toBe('HelixUnload');
    // Defaults that weren't overridden.
    expect(profile!.scatterNearbyOnExit).toBe(true);
    expect(profile!.resetMoodCheckTimeOnExit).toBe(true);
  });

  it('InternetHackContain inherits TransportContain fields from INI', () => {
    const objectDef = makeObjectDef('InternetCenter', 'China', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'InternetHackContain ModuleTag_Contain', {
        ContainMax: 8,
        Slots: 8,
        ResetMoodCheckTimeOnExit: false,
        WeaponBonusPassedToPassengers: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('INTERNET_HACK');
    expect(profile!.resetMoodCheckTimeOnExit).toBe(false);
    expect(profile!.weaponBonusPassedToPassengers).toBe(true);
    // Other defaults.
    expect(profile!.scatterNearbyOnExit).toBe(true);
    expect(profile!.orientLikeContainerOnExit).toBe(false);
  });
});

// ── Non-transport modules use TransportContain defaults ────────────────────

describe('Non-transport modules use TransportContain C++ defaults', () => {
  it('OpenContain uses transport field defaults', () => {
    const objectDef = makeObjectDef('Container', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
      makeBlock('Behavior', 'OpenContain ModuleTag_Contain', {
        ContainMax: 5,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('OPEN');
    // TransportContain defaults (not parsed from INI for OPEN type).
    expect(profile!.scatterNearbyOnExit).toBe(true);
    expect(profile!.orientLikeContainerOnExit).toBe(false);
    expect(profile!.keepContainerVelocityOnExit).toBe(false);
    expect(profile!.goAggressiveOnExit).toBe(false);
    expect(profile!.resetMoodCheckTimeOnExit).toBe(true);
    expect(profile!.exitBone).toBe('');
    expect(profile!.exitPitchRate).toBe(0);
    expect(profile!.armedRidersUpgradeMyWeaponSet).toBe(false);
    expect(profile!.delayExitInAir).toBe(false);
  });

  it('ParachuteContain uses transport field defaults', () => {
    const objectDef = makeObjectDef('Chute', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
      makeBlock('Behavior', 'ParachuteContain ModuleTag_Contain', {
        ContainMax: 1,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('PARACHUTE');
    expect(profile!.scatterNearbyOnExit).toBe(true);
    expect(profile!.orientLikeContainerOnExit).toBe(false);
    expect(profile!.exitPitchRate).toBe(0);
    expect(profile!.delayExitInAir).toBe(false);
  });

  it('CaveContain uses transport field defaults', () => {
    const objectDef = makeObjectDef('Cave', 'GLA', ['STRUCTURE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 300, InitialHealth: 300 }),
      makeBlock('Behavior', 'CaveContain ModuleTag_Contain', {
        CaveIndex: 1,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('CAVE');
    expect(profile!.scatterNearbyOnExit).toBe(true);
    expect(profile!.goAggressiveOnExit).toBe(false);
    expect(profile!.armedRidersUpgradeMyWeaponSet).toBe(false);
  });
});

// ── All 14 fields on a single TransportContain profile ─────────────────────

describe('All 14 new fields set on a single TransportContain', () => {
  it('parses all OpenContain + TransportContain fields together', () => {
    const objectDef = makeObjectDef('FullyLoaded', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
      makeBlock('Behavior', 'TransportContain ModuleTag_Contain', {
        ContainMax: 10,
        Slots: 10,
        // OpenContain fields
        PassengersInTurret: true,
        NumberOfExitPaths: 4,
        WeaponBonusPassedToPassengers: true,
        EnterSound: 'BigLoad',
        ExitSound: 'BigUnload',
        // TransportContain fields
        ScatterNearbyOnExit: false,
        OrientLikeContainerOnExit: true,
        KeepContainerVelocityOnExit: true,
        GoAggressiveOnExit: true,
        ResetMoodCheckTimeOnExit: false,
        ExitBone: 'HATCH01',
        ExitPitchRate: 360,
        ArmedRidersUpgradeMyWeaponSet: true,
        DelayExitInAir: true,
      }),
    ]);
    const profile = extractContainProfile(self, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.moduleType).toBe('TRANSPORT');

    // OpenContain fields
    expect(profile!.passengersInTurret).toBe(true);
    expect(profile!.numberOfExitPaths).toBe(4);
    expect(profile!.weaponBonusPassedToPassengers).toBe(true);
    expect(profile!.enterSound).toBe('BigLoad');
    expect(profile!.exitSound).toBe('BigUnload');

    // TransportContain fields
    expect(profile!.scatterNearbyOnExit).toBe(false);
    expect(profile!.orientLikeContainerOnExit).toBe(true);
    expect(profile!.keepContainerVelocityOnExit).toBe(true);
    expect(profile!.goAggressiveOnExit).toBe(true);
    expect(profile!.resetMoodCheckTimeOnExit).toBe(false);
    expect(profile!.exitBone).toBe('HATCH01');
    // 360 deg/sec => 360 * (PI/180) / 30 = 2*PI/30 rad/frame
    expect(profile!.exitPitchRate).toBeCloseTo(360 * (Math.PI / 180) / LOGIC_FRAME_RATE, 10);
    expect(profile!.armedRidersUpgradeMyWeaponSet).toBe(true);
    expect(profile!.delayExitInAir).toBe(true);
  });
});
