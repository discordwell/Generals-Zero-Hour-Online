/**
 * Parity Tests — HelicopterSlowDeathBehavior missing FieldParse fields.
 *
 * Source reference: GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/HelicopterSlowDeathUpdate.cpp
 *   Lines 110-141 — buildFieldParse() with 11 fields that were previously missing from the TS profile:
 *     MinBladeFlyOffDelay, MaxBladeFlyOffDelay, AttachParticle, AttachParticleBone,
 *     AttachParticleLoc, OCLEjectPilot, FXBlade, OCLBlade, FXHitGround, FXFinalBlowUp, SoundDeathLoop
 *
 * C++ defaults (from constructor, lines 67-102):
 *   m_minBladeFlyOffDelay = 0.0, m_maxBladeFlyOffDelay = 0.0
 *   m_attachParticleSystem = NULL, m_attachParticleBone = "", m_attachParticleLoc = {0,0,0}
 *   m_oclEjectPilot = NULL, m_fxBlade = NULL, m_oclBlade = NULL
 *   m_fxHitGround = NULL, m_fxFinalBlowUp = NULL, m_deathSound = (default AudioEventRTS)
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
} from './test-helpers.js';

function createLogic(): GameLogicSubsystem {
  return new GameLogicSubsystem(new THREE.Scene());
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** LOGIC_FRAME_RATE from C++ = 30 fps. msToLogicFrames = ms / 1000 * 30 = ms * 0.03 */
const LOGIC_FRAME_RATE = 30;
function msToFrames(ms: number): number {
  return (ms / 1000) * LOGIC_FRAME_RATE;
}

/** Build a bundle with a single helicopter object that has HelicopterSlowDeathBehavior. */
function makeHeliBundle(heliSlowDeathFields: Record<string, unknown> = {}) {
  return makeBundle({
    objects: [
      makeObjectDef('TestHeli', 'America', ['VEHICLE', 'AIRCRAFT'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 200, InitialHealth: 200 }),
        makeBlock('Behavior', 'HelicopterSlowDeathBehavior ModuleTag_HSD', {
          DeathTypes: 'ALL',
          SpiralOrbitTurnRate: 180,
          SpiralOrbitForwardSpeed: 60,
          FallHowFast: 50,
          ...heliSlowDeathFields,
        }),
      ]),
    ],
  });
}

function getHeliProfile(logic: GameLogicSubsystem) {
  const priv = logic as unknown as {
    spawnedEntities: Map<number, {
      helicopterSlowDeathProfiles: Array<{
        minBladeFlyOffDelay: number;
        maxBladeFlyOffDelay: number;
        attachParticle: string | null;
        attachParticleBone: string;
        attachParticleLoc: { x: number; y: number; z: number };
        oclEjectPilot: string | null;
        fxBlade: string | null;
        oclBlade: string | null;
        fxHitGround: string | null;
        fxFinalBlowUp: string | null;
        soundDeathLoop: string | null;
        // Existing fields for sanity check.
        spiralOrbitTurnRate: number;
        bladeObjectName: string;
        bladeBoneName: string;
        oclHitGround: string[];
        oclFinalBlowUp: string[];
      }>;
    }>;
  };

  const entity = [...priv.spawnedEntities.values()].find(
    e => e.helicopterSlowDeathProfiles.length > 0,
  );
  return entity?.helicopterSlowDeathProfiles[0];
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Parity: HelicopterSlowDeathBehavior — missing FieldParse fields', () => {

  it('C++ defaults: all new fields have correct default values when omitted from INI', () => {
    const bundle = makeHeliBundle(); // No new fields specified
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHeli', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const profile = getHeliProfile(logic);
    expect(profile).toBeDefined();

    // parseDurationReal defaults: 0.0 ms → 0 frames
    expect(profile!.minBladeFlyOffDelay).toBe(0);
    expect(profile!.maxBladeFlyOffDelay).toBe(0);

    // Pointer/string defaults: NULL → null, empty string → ''
    expect(profile!.attachParticle).toBeNull();
    expect(profile!.attachParticleBone).toBe('');
    expect(profile!.attachParticleLoc).toEqual({ x: 0, y: 0, z: 0 });
    expect(profile!.oclEjectPilot).toBeNull();
    expect(profile!.fxBlade).toBeNull();
    expect(profile!.oclBlade).toBeNull();
    expect(profile!.fxHitGround).toBeNull();
    expect(profile!.fxFinalBlowUp).toBeNull();
    expect(profile!.soundDeathLoop).toBeNull();
  });

  it('parseDurationReal fields: MinBladeFlyOffDelay and MaxBladeFlyOffDelay convert ms to frames', () => {
    const bundle = makeHeliBundle({
      MinBladeFlyOffDelay: 500,  // 500ms → 15 frames
      MaxBladeFlyOffDelay: 2000, // 2000ms → 60 frames
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHeli', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const profile = getHeliProfile(logic);
    expect(profile).toBeDefined();
    expect(profile!.minBladeFlyOffDelay).toBeCloseTo(msToFrames(500), 5);
    expect(profile!.maxBladeFlyOffDelay).toBeCloseTo(msToFrames(2000), 5);
  });

  it('particle system fields: AttachParticle, AttachParticleBone, AttachParticleLoc', () => {
    const bundle = makeHeliBundle({
      AttachParticle: 'HeliDeathSmoke',
      AttachParticleBone: 'ROTOR01',
      AttachParticleLoc: [10, 20, 30],
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHeli', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const profile = getHeliProfile(logic);
    expect(profile).toBeDefined();
    expect(profile!.attachParticle).toBe('HeliDeathSmoke');
    expect(profile!.attachParticleBone).toBe('ROTOR01');
    expect(profile!.attachParticleLoc).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('OCL/FX fields: OCLEjectPilot, FXBlade, OCLBlade, FXHitGround, FXFinalBlowUp', () => {
    const bundle = makeHeliBundle({
      OCLEjectPilot: 'OCL_EjectPilotHelicopter',
      FXBlade: 'FX_HeliBladeFlyOff',
      OCLBlade: 'OCL_HeliBladeDebris',
      FXHitGround: 'FX_HeliGroundImpact',
      FXFinalBlowUp: 'FX_HeliFinalExplosion',
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHeli', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const profile = getHeliProfile(logic);
    expect(profile).toBeDefined();
    expect(profile!.oclEjectPilot).toBe('OCL_EjectPilotHelicopter');
    expect(profile!.fxBlade).toBe('FX_HeliBladeFlyOff');
    expect(profile!.oclBlade).toBe('OCL_HeliBladeDebris');
    expect(profile!.fxHitGround).toBe('FX_HeliGroundImpact');
    expect(profile!.fxFinalBlowUp).toBe('FX_HeliFinalExplosion');
  });

  it('audio field: SoundDeathLoop', () => {
    const bundle = makeHeliBundle({
      SoundDeathLoop: 'HeliDeathLoopSound',
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHeli', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const profile = getHeliProfile(logic);
    expect(profile).toBeDefined();
    expect(profile!.soundDeathLoop).toBe('HeliDeathLoopSound');
  });

  it('all 11 new fields coexist with existing fields', () => {
    const bundle = makeHeliBundle({
      // Existing fields
      BladeObjectName: 'ChinookBlade',
      BladeBoneName: 'BLADE01',
      OCLHitGround: 'OCL_ChinookHitGround',
      OCLFinalBlowUp: 'OCL_ChinookFinalBlowUp',
      // New fields
      MinBladeFlyOffDelay: 1000,
      MaxBladeFlyOffDelay: 3000,
      AttachParticle: 'SmokePlume',
      AttachParticleBone: 'FXBONE01',
      AttachParticleLoc: [5, 10, 15],
      OCLEjectPilot: 'OCL_PilotEject',
      FXBlade: 'FX_BladeOff',
      OCLBlade: 'OCL_BladeDebris',
      FXHitGround: 'FX_GroundHit',
      FXFinalBlowUp: 'FX_BigBoom',
      SoundDeathLoop: 'CrashLoop',
    });
    const logic = createLogic();
    logic.loadMapObjects(
      makeMap([makeMapObject('TestHeli', 128, 128)], 256, 256),
      makeRegistry(bundle),
      makeHeightmap(256, 256),
    );

    const profile = getHeliProfile(logic);
    expect(profile).toBeDefined();

    // Verify existing fields still work.
    expect(profile!.bladeObjectName).toBe('ChinookBlade');
    expect(profile!.bladeBoneName).toBe('BLADE01');
    expect(profile!.oclHitGround).toContain('OCL_ChinookHitGround');
    expect(profile!.oclFinalBlowUp).toContain('OCL_ChinookFinalBlowUp');

    // Verify all 11 new fields.
    expect(profile!.minBladeFlyOffDelay).toBeCloseTo(msToFrames(1000), 5);
    expect(profile!.maxBladeFlyOffDelay).toBeCloseTo(msToFrames(3000), 5);
    expect(profile!.attachParticle).toBe('SmokePlume');
    expect(profile!.attachParticleBone).toBe('FXBONE01');
    expect(profile!.attachParticleLoc).toEqual({ x: 5, y: 10, z: 15 });
    expect(profile!.oclEjectPilot).toBe('OCL_PilotEject');
    expect(profile!.fxBlade).toBe('FX_BladeOff');
    expect(profile!.oclBlade).toBe('OCL_BladeDebris');
    expect(profile!.fxHitGround).toBe('FX_GroundHit');
    expect(profile!.fxFinalBlowUp).toBe('FX_BigBoom');
    expect(profile!.soundDeathLoop).toBe('CrashLoop');
  });
});
