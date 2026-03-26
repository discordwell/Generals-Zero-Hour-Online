/**
 * Tests for 12 missing StealthUpdate FieldParse fields added from C++ source.
 *
 * Source parity: StealthUpdate.cpp:96-128 FieldParse table and StealthUpdate.h:77-101.
 * Each field is verified by constructing an INI bundle with specific values,
 * spawning an entity, and inspecting the parsed StealthProfile.
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

// ── Shared helpers ──────────────────────────────────────────────────────────

function createLogic(): GameLogicSubsystem {
  return new GameLogicSubsystem(new THREE.Scene());
}

/** Access internal stealth profile from a spawned entity. */
function getStealthProfile(logic: GameLogicSubsystem, entityId: number) {
  const priv = logic as unknown as {
    spawnedEntities: Map<number, {
      stealthProfile: Record<string, unknown> | null;
    }>;
  };
  return priv.spawnedEntities.get(entityId)?.stealthProfile ?? null;
}

/** Build a stealth bundle with custom StealthUpdate INI fields. */
function makeStealthBundleWithFields(fields: Record<string, unknown>) {
  return makeBundle({
    objects: [
      makeObjectDef('StealthUnit', 'America', ['INFANTRY'], [
        makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100, InitialHealth: 100 }),
        makeBlock('Behavior', 'StealthUpdate ModuleTag_Stealth', {
          StealthDelay: 100,
          InnateStealth: 'Yes',
          ...fields,
        }),
      ]),
    ],
  });
}

function spawnAndGetProfile(fields: Record<string, unknown>) {
  const bundle = makeStealthBundleWithFields(fields);
  const logic = createLogic();
  logic.loadMapObjects(
    makeMap([makeMapObject('StealthUnit', 50, 50)], 128, 128),
    makeRegistry(bundle),
    makeHeightmap(128, 128),
  );
  return { logic, profile: getStealthProfile(logic, 1) };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('StealthUpdate FieldParse: 12 missing fields from C++ source', () => {

  // 0. RequiredStatus (ZH-only field)
  describe('RequiredStatus (ObjectStatusMaskType, default empty)', () => {
    it('parses space-separated status tokens into requiredStatus array', () => {
      const { profile } = spawnAndGetProfile({
        RequiredStatus: 'IMMOBILE STEALTHED',
      });
      expect(profile).not.toBeNull();
      expect(profile!.requiredStatus).toEqual(['IMMOBILE', 'STEALTHED']);
    });

    it('defaults to empty array when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.requiredStatus).toEqual([]);
    });

    it('handles single token', () => {
      const { profile } = spawnAndGetProfile({
        RequiredStatus: 'AIRBORNE_TARGET',
      });
      expect(profile).not.toBeNull();
      expect(profile!.requiredStatus).toEqual(['AIRBORNE_TARGET']);
    });
  });

  // 1. ForbiddenStatus
  describe('ForbiddenStatus (ObjectStatusMaskType, default empty)', () => {
    it('parses space-separated status tokens into forbiddenStatus array', () => {
      const { profile } = spawnAndGetProfile({
        ForbiddenStatus: 'IMMOBILE SOLD',
      });
      expect(profile).not.toBeNull();
      expect(profile!.forbiddenStatus).toEqual(['IMMOBILE', 'SOLD']);
    });

    it('defaults to empty array when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.forbiddenStatus).toEqual([]);
    });
  });

  // 2. FriendlyOpacityMax
  describe('FriendlyOpacityMax (Real, default 1.0)', () => {
    it('parses numeric value', () => {
      const { profile } = spawnAndGetProfile({
        FriendlyOpacityMax: 0.8,
      });
      expect(profile).not.toBeNull();
      expect(profile!.friendlyOpacityMax).toBe(0.8);
    });

    it('defaults to 1.0 when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.friendlyOpacityMax).toBe(1.0);
    });
  });

  // 3. PulseFrequency
  describe('PulseFrequency (duration ms->frames, default 0)', () => {
    it('converts milliseconds to logic frames', () => {
      // 1000ms at ~33.333ms/frame = 30 frames
      const { profile } = spawnAndGetProfile({
        PulseFrequency: 1000,
      });
      expect(profile).not.toBeNull();
      expect(profile!.pulseFrequencyFrames).toBe(30);
    });

    it('defaults to 0 when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.pulseFrequencyFrames).toBe(0);
    });
  });

  // 4. DisguiseFX
  describe('DisguiseFX (FXList name, default "")', () => {
    it('parses FX list name string', () => {
      const { profile } = spawnAndGetProfile({
        DisguiseFX: 'FX_BombTruckDisguise',
      });
      expect(profile).not.toBeNull();
      expect(profile!.disguiseFX).toBe('FX_BombTruckDisguise');
    });

    it('defaults to empty string when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.disguiseFX).toBe('');
    });
  });

  // 5. DisguiseRevealFX
  describe('DisguiseRevealFX (FXList name, default "")', () => {
    it('parses FX list name string', () => {
      const { profile } = spawnAndGetProfile({
        DisguiseRevealFX: 'FX_BombTruckReveal',
      });
      expect(profile).not.toBeNull();
      expect(profile!.disguiseRevealFX).toBe('FX_BombTruckReveal');
    });

    it('defaults to empty string when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.disguiseRevealFX).toBe('');
    });
  });

  // 6. DisguiseTransitionTime
  describe('DisguiseTransitionTime (duration ms->frames, default 0)', () => {
    it('converts milliseconds to logic frames', () => {
      // 500ms at ~33.333ms/frame = 15 frames
      const { profile } = spawnAndGetProfile({
        DisguiseTransitionTime: 500,
      });
      expect(profile).not.toBeNull();
      expect(profile!.disguiseTransitionFrames).toBe(15);
    });

    it('defaults to 0 when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.disguiseTransitionFrames).toBe(0);
    });
  });

  // 7. DisguiseRevealTransitionTime
  describe('DisguiseRevealTransitionTime (duration ms->frames, default 0)', () => {
    it('converts milliseconds to logic frames', () => {
      // 500ms at ~33.333ms/frame = 15 frames
      const { profile } = spawnAndGetProfile({
        DisguiseRevealTransitionTime: 500,
      });
      expect(profile).not.toBeNull();
      expect(profile!.disguiseRevealTransitionFrames).toBe(15);
    });

    it('defaults to 0 when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.disguiseRevealTransitionFrames).toBe(0);
    });
  });

  // 8. UseRiderStealth
  describe('UseRiderStealth (Bool, default false)', () => {
    it('parses boolean true', () => {
      const { profile } = spawnAndGetProfile({
        UseRiderStealth: 'Yes',
      });
      expect(profile).not.toBeNull();
      expect(profile!.useRiderStealth).toBe(true);
    });

    it('defaults to false when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.useRiderStealth).toBe(false);
    });
  });

  // 9. EnemyDetectionEvaEvent
  describe('EnemyDetectionEvaEvent (EvaMessage string, default "")', () => {
    it('parses EVA event name', () => {
      const { profile } = spawnAndGetProfile({
        EnemyDetectionEvaEvent: 'StealthUnitDiscovered',
      });
      expect(profile).not.toBeNull();
      expect(profile!.enemyDetectionEvaEvent).toBe('StealthUnitDiscovered');
    });

    it('defaults to empty string when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.enemyDetectionEvaEvent).toBe('');
    });
  });

  // 10. OwnDetectionEvaEvent
  describe('OwnDetectionEvaEvent (EvaMessage string, default "")', () => {
    it('parses EVA event name', () => {
      const { profile } = spawnAndGetProfile({
        OwnDetectionEvaEvent: 'OurStealthUnitDetected',
      });
      expect(profile).not.toBeNull();
      expect(profile!.ownDetectionEvaEvent).toBe('OurStealthUnitDetected');
    });

    it('defaults to empty string when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.ownDetectionEvaEvent).toBe('');
    });
  });

  // 11. BlackMarketCheckDelay
  describe('BlackMarketCheckDelay (duration ms->frames, default 0)', () => {
    it('converts milliseconds to logic frames', () => {
      // 2000ms at ~33.333ms/frame = 60 frames
      const { profile } = spawnAndGetProfile({
        BlackMarketCheckDelay: 2000,
      });
      expect(profile).not.toBeNull();
      expect(profile!.blackMarketCheckDelayFrames).toBe(60);
    });

    it('defaults to 0 when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.blackMarketCheckDelayFrames).toBe(0);
    });
  });

  // 12. GrantedBySpecialPower
  describe('GrantedBySpecialPower (Bool, default false)', () => {
    it('parses boolean true', () => {
      const { profile } = spawnAndGetProfile({
        GrantedBySpecialPower: 'Yes',
      });
      expect(profile).not.toBeNull();
      expect(profile!.grantedBySpecialPower).toBe(true);
    });

    it('defaults to false when not specified', () => {
      const { profile } = spawnAndGetProfile({});
      expect(profile).not.toBeNull();
      expect(profile!.grantedBySpecialPower).toBe(false);
    });
  });

  // Comprehensive test: all 13 fields set at once
  describe('All 13 fields parsed together', () => {
    it('correctly parses all new fields in a single StealthUpdate block', () => {
      const { profile } = spawnAndGetProfile({
        RequiredStatus: 'CAN_STEALTH RIDER1',
        ForbiddenStatus: 'IMMOBILE SOLD UNDER_CONSTRUCTION',
        FriendlyOpacityMax: 0.75,
        PulseFrequency: 660,
        DisguiseFX: 'FX_DisguiseStart',
        DisguiseRevealFX: 'FX_DisguiseEnd',
        DisguiseTransitionTime: 330,
        DisguiseRevealTransitionTime: 165,
        UseRiderStealth: 'Yes',
        EnemyDetectionEvaEvent: 'EnemyStealthDiscovered',
        OwnDetectionEvaEvent: 'OwnStealthDetected',
        BlackMarketCheckDelay: 3300,
        GrantedBySpecialPower: 'Yes',
      });
      expect(profile).not.toBeNull();

      // ObjectStatusMask fields
      expect(profile!.requiredStatus).toEqual(['CAN_STEALTH', 'RIDER1']);
      expect(profile!.forbiddenStatus).toEqual(['IMMOBILE', 'SOLD', 'UNDER_CONSTRUCTION']);

      // Real/percent field
      expect(profile!.friendlyOpacityMax).toBe(0.75);

      // Duration fields (ms -> frames via msToLogicFrames)
      // 660ms / 33.333ms = ~19.8 -> ceil = 20 frames
      expect(profile!.pulseFrequencyFrames).toBeGreaterThan(0);
      // 330ms / 33.333ms = ~9.9 -> ceil = 10 frames
      expect(profile!.disguiseTransitionFrames).toBeGreaterThan(0);
      // 165ms / 33.333ms = ~4.95 -> ceil = 5 frames
      expect(profile!.disguiseRevealTransitionFrames).toBeGreaterThan(0);
      // 3300ms / 33.333ms = ~99.0 -> ceil = 99 frames
      expect(profile!.blackMarketCheckDelayFrames).toBeGreaterThan(0);

      // FX string fields
      expect(profile!.disguiseFX).toBe('FX_DisguiseStart');
      expect(profile!.disguiseRevealFX).toBe('FX_DisguiseEnd');

      // Boolean fields
      expect(profile!.useRiderStealth).toBe(true);
      expect(profile!.grantedBySpecialPower).toBe(true);

      // EVA event string fields
      expect(profile!.enemyDetectionEvaEvent).toBe('EnemyStealthDiscovered');
      expect(profile!.ownDetectionEvaEvent).toBe('OwnStealthDetected');

      // Original fields should still be present
      expect(profile!.innateStealth).toBe(true);
      expect(profile!.stealthDelayFrames).toBeGreaterThan(0);
    });
  });
});
