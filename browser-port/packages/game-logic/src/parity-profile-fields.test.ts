/**
 * Parity Tests — Missing profile extraction fields.
 *
 * Source references:
 *   DeployStyleAIUpdate.h:78-80  — ResetTurretBeforePacking, TurretsMustCenterBeforePacking
 *   CountermeasuresBehavior.h:83,91 — FlareBoneBaseName, MustReloadAtAirfield
 *   AssaultTransportAIUpdate.h:68 — ClearRangeRequiredToContinueAttackMove
 *
 * Tests call the exported extraction functions directly with mock INI data
 * to verify each new field is correctly parsed from behavior blocks.
 */

import { describe, expect, it } from 'vitest';
import type { IniBlock } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';
import {
  extractDeployStyleProfile,
  extractCountermeasuresProfile,
  extractAssaultTransportProfile,
} from './entity-factory.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const LOGIC_FRAME_MS = 1000 / 30;

/** Minimal GL stub — only msToLogicFrames is used by the extraction functions. */
const mockGL = {
  msToLogicFrames(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.max(1, Math.ceil(ms / LOGIC_FRAME_MS));
  },
};

function makeBlock(
  type: string,
  name: string,
  fields: Record<string, unknown>,
  blocks: IniBlock[] = [],
): IniBlock {
  return {
    type,
    name,
    fields: fields as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
  };
}

function makeObjectDef(blocks: IniBlock[]): ObjectDef {
  return {
    name: 'TestObject',
    side: 'America',
    kindOf: ['VEHICLE'],
    fields: {} as Record<string, string | number | boolean | string[] | number[]>,
    blocks,
    resolved: true,
  };
}

// ── DeployStyleProfile ──────────────────────────────────────────────────────

describe('extractDeployStyleProfile — new fields', () => {
  it('parses ResetTurretBeforePacking when set to true', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'DeployStyleAIUpdate ModuleTag_Deploy', {
        UnpackTime: 2000,
        PackTime: 1000,
        TurretsFunctionOnlyWhenDeployed: true,
        ResetTurretBeforePacking: true,
        TurretsMustCenterBeforePacking: false,
      }),
    ]);
    const profile = extractDeployStyleProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.resetTurretBeforePacking).toBe(true);
    expect(profile!.turretsMustCenterBeforePacking).toBe(false);
  });

  it('parses TurretsMustCenterBeforePacking when set to true', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'DeployStyleAIUpdate ModuleTag_Deploy', {
        UnpackTime: 1500,
        PackTime: 500,
        ResetTurretBeforePacking: false,
        TurretsMustCenterBeforePacking: true,
      }),
    ]);
    const profile = extractDeployStyleProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.resetTurretBeforePacking).toBe(false);
    expect(profile!.turretsMustCenterBeforePacking).toBe(true);
  });

  it('defaults both fields to false when not specified', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'DeployStyleAIUpdate ModuleTag_Deploy', {
        UnpackTime: 1000,
        PackTime: 500,
      }),
    ]);
    const profile = extractDeployStyleProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.resetTurretBeforePacking).toBe(false);
    expect(profile!.turretsMustCenterBeforePacking).toBe(false);
  });

  it('returns null when no DeployStyleAIUpdate block exists', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'SomeOtherUpdate ModuleTag_Other', {}),
    ]);
    const profile = extractDeployStyleProfile(mockGL, objectDef);
    expect(profile).toBeNull();
  });
});

// ── CountermeasuresProfile ──────────────────────────────────────────────────

describe('extractCountermeasuresProfile — new fields', () => {
  it('parses FlareBoneBaseName from behavior block', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'CountermeasuresBehavior ModuleTag_CM', {
        FlareTemplateName: 'GenericFlare',
        FlareBoneBaseName: 'FlareBone',
        VolleySize: 4,
        VolleyArcAngle: 90,
        VolleyVelocityFactor: 1.5,
        DelayBetweenVolleys: 500,
        NumberOfVolleys: 3,
        ReloadTime: 5000,
        EvasionRate: 50,
        MissileDecoyDelay: 200,
        ReactionLaunchLatency: 100,
        MustReloadAtAirfield: false,
      }),
    ]);
    const profile = extractCountermeasuresProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.flareBoneBaseName).toBe('FlareBone');
    expect(profile!.mustReloadAtAirfield).toBe(false);
  });

  it('parses MustReloadAtAirfield when set to true', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'CountermeasuresBehavior ModuleTag_CM', {
        FlareTemplateName: 'TestFlare',
        FlareBoneBaseName: 'Bone_Flare',
        VolleySize: 2,
        MustReloadAtAirfield: true,
      }),
    ]);
    const profile = extractCountermeasuresProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.mustReloadAtAirfield).toBe(true);
    expect(profile!.flareBoneBaseName).toBe('Bone_Flare');
  });

  it('defaults FlareBoneBaseName to empty string and MustReloadAtAirfield to false when not specified', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'CountermeasuresBehavior ModuleTag_CM', {
        FlareTemplateName: 'MinimalFlare',
        VolleySize: 1,
      }),
    ]);
    const profile = extractCountermeasuresProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.flareBoneBaseName).toBe('');
    expect(profile!.mustReloadAtAirfield).toBe(false);
  });

  it('returns null when no CountermeasuresBehavior block exists', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'SomeOtherBehavior ModuleTag_Other', {}),
    ]);
    const profile = extractCountermeasuresProfile(mockGL, objectDef);
    expect(profile).toBeNull();
  });
});

// ── AssaultTransportProfile ─────────────────────────────────────────────────

describe('extractAssaultTransportProfile — new fields', () => {
  it('parses ClearRangeRequiredToContinueAttackMove', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'AssaultTransportAIUpdate ModuleTag_AT', {
        MembersGetHealedAtLifeRatio: 0.3,
        ClearRangeRequiredToContinueAttackMove: 50.0,
      }),
    ]);
    const profile = extractAssaultTransportProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.clearRangeRequiredToContinueAttackMove).toBe(50.0);
    expect(profile!.membersGetHealedAtLifeRatio).toBeCloseTo(0.3);
  });

  it('defaults ClearRangeRequiredToContinueAttackMove to 0 when not specified', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'AssaultTransportAIUpdate ModuleTag_AT', {
        MembersGetHealedAtLifeRatio: 0.5,
      }),
    ]);
    const profile = extractAssaultTransportProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.clearRangeRequiredToContinueAttackMove).toBe(0);
  });

  it('returns null when no AssaultTransportAIUpdate block exists', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'SomeOtherAIUpdate ModuleTag_Other', {}),
    ]);
    const profile = extractAssaultTransportProfile(mockGL, objectDef);
    expect(profile).toBeNull();
  });

  it('preserves MembersGetHealedAtLifeRatio clamping with new field', () => {
    const objectDef = makeObjectDef([
      makeBlock('Behavior', 'AssaultTransportAIUpdate ModuleTag_AT', {
        MembersGetHealedAtLifeRatio: 1.5,
        ClearRangeRequiredToContinueAttackMove: 100.0,
      }),
    ]);
    const profile = extractAssaultTransportProfile(mockGL, objectDef);
    expect(profile).not.toBeNull();
    // MembersGetHealedAtLifeRatio is clamped to [0, 1]
    expect(profile!.membersGetHealedAtLifeRatio).toBe(1.0);
    expect(profile!.clearRangeRequiredToContinueAttackMove).toBe(100.0);
  });
});
