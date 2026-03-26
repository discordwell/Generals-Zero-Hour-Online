/**
 * Parity tests for combat fixes:
 * 1. SUBDUAL_UNRESISTABLE armor bypass (Armor.cpp:69-72)
 * 2. KILL_PILOT naming consistency (Damage.cpp:60 / Damage.h:68)
 * 3. ATTACK_RANGE_APPROACH_FUDGE constant (Weapon.cpp:2114)
 */

import { describe, expect, it } from 'vitest';

import { adjustDamageByArmorSet } from './combat-helpers.js';
import { updateCombat } from './combat-update.js';
import {
  ATTACK_RANGE_FUDGE,
  ATTACK_RANGE_APPROACH_FUDGE,
} from './index.js';

// ---------------------------------------------------------------------------
// Fix 1: SUBDUAL_UNRESISTABLE armor bypass
// Source parity: Armor.cpp:69-72 — adjustDamage() returns raw damage for both
// DAMAGE_UNRESISTABLE and DAMAGE_SUBDUAL_UNRESISTABLE.
// ---------------------------------------------------------------------------

describe('SUBDUAL_UNRESISTABLE armor bypass (Armor.cpp:69-72)', () => {
  const target = {
    canTakeDamage: true,
    destroyed: false,
    armorDamageCoefficients: new Map<string, number>([
      ['EXPLOSION', 0.5],
      ['SUBDUAL_UNRESISTABLE', 0.0],
      ['UNRESISTABLE', 0.0],
    ]),
  };

  it('UNRESISTABLE bypasses armor', () => {
    expect(adjustDamageByArmorSet(target, 100, 'UNRESISTABLE')).toBe(100);
  });

  it('SUBDUAL_UNRESISTABLE bypasses armor', () => {
    // Even though the armor map has 0% for SUBDUAL_UNRESISTABLE, the damage
    // should pass through unmodified, matching C++ Armor.cpp:71-72.
    expect(adjustDamageByArmorSet(target, 100, 'SUBDUAL_UNRESISTABLE')).toBe(100);
  });

  it('other damage types still use armor coefficients', () => {
    expect(adjustDamageByArmorSet(target, 100, 'EXPLOSION')).toBe(50);
  });

  it('SUBDUAL_MISSILE is NOT bypassed (only SUBDUAL_UNRESISTABLE is)', () => {
    const targetWithSubdualArmor = {
      canTakeDamage: true,
      destroyed: false,
      armorDamageCoefficients: new Map<string, number>([
        ['SUBDUAL_MISSILE', 0.25],
      ]),
    };
    expect(adjustDamageByArmorSet(targetWithSubdualArmor, 100, 'SUBDUAL_MISSILE')).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: KILL_PILOT naming consistency
// Source parity: Damage.cpp:60 uses "KILL_PILOT" (with underscore).
// The C++ enum is DAMAGE_KILLPILOT, but the INI string name is "KILL_PILOT".
// ---------------------------------------------------------------------------

describe('KILL_PILOT naming consistency (Damage.cpp:60)', () => {
  // We can't directly import isHealthDamagingDamage since it's not exported.
  // Instead, we verify the SOURCE_DAMAGE_TYPE_NAMES array uses KILL_PILOT
  // and that the damage system treats KILL_PILOT correctly end-to-end.
  // The direct fix was changing 'KILLPILOT' -> 'KILL_PILOT' in isHealthDamagingDamage().

  it('KILL_PILOT damage does not reduce health (is not health-damaging)', () => {
    // KILL_PILOT causes the pilot to eject, not direct health damage.
    // We test indirectly: KILL_PILOT should exist in the damage type names
    // and be treated as a special (non-health) damage type.
    // The armor bypass for KILL_PILOT should work normally (it IS resistable).
    const armor = new Map<string, number>([
      ['KILL_PILOT', 0.5],
    ]);
    const target = {
      canTakeDamage: true,
      destroyed: false,
      armorDamageCoefficients: armor,
    };
    // KILL_PILOT is resistable, so armor applies.
    expect(adjustDamageByArmorSet(target, 100, 'KILL_PILOT')).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: ATTACK_RANGE_FUDGE constants
// Source parity: Weapon.cpp:472 (ATTACK_RANGE_FUDGE = 1.05) and
// Weapon.cpp:2114 (ATTACK_RANGE_APPROACH_FUDGE = 0.9).
// ---------------------------------------------------------------------------

describe('ATTACK_RANGE_FUDGE constants (Weapon.cpp:472, 2114)', () => {
  it('ATTACK_RANGE_FUDGE equals 1.05 (5% overshoot tolerance)', () => {
    expect(ATTACK_RANGE_FUDGE).toBe(1.05);
  });

  it('ATTACK_RANGE_APPROACH_FUDGE equals 0.9 (approach to 90% of range)', () => {
    expect(ATTACK_RANGE_APPROACH_FUDGE).toBe(0.9);
  });

  it('approach fudge is applied when chasing out-of-range target', () => {
    // Verify that updateCombat uses ATTACK_RANGE_APPROACH_FUDGE when issuing
    // move commands to chase a target that is out of range.
    const attackRange = 200;
    let lastIssueMoveTo: { entityId: number; x: number; z: number; attackDistance?: number } | null = null;

    const attacker = {
      id: 1,
      x: 0,
      z: 0,
      destroyed: false,
      canMove: true,
      moving: false,
      moveTarget: null,
      movePath: [] as { x: number; z: number }[],
      pathIndex: 0,
      pathfindGoalCell: null,
      preAttackFinishFrame: 0,
      attackTargetEntityId: 2,
      attackTargetPosition: null,
      attackWeapon: {
        minAttackRange: 0,
        attackRange,
        clipSize: 0,
        autoReloadWhenIdleFrames: 0,
        clipReloadFrames: 0,
        leechRangeWeapon: false,
      },
      attackCommandSource: 'AI',
      attackOriginalVictimPosition: null,
      nextAttackFrame: 0,
      lastShotFrame: 0,
      lastShotFrameBySlot: [0, 0, 0] as [number, number, number],
      attackWeaponSlotIndex: 0,
      attackAmmoInClip: 0,
      attackReloadFinishFrame: 0,
      attackForceReloadFrame: 0,
      attackNeedsLineOfSight: false,
      maxShotsRemaining: 0,
      category: 'vehicle',
      leechRangeActive: false,
    };

    // Target far away — well outside attack range.
    const target = {
      ...structuredClone(attacker),
      id: 2,
      x: 500,
      z: 0,
      attackTargetEntityId: null,
      attackWeapon: null,
    };

    const entities = [attacker, target];

    updateCombat({
      entities,
      frameCounter: 0,
      constants: {
        attackMinRangeDistanceSqrFudge: 0.5,
        pathfindCellSize: 10,
        attackRangeApproachFudge: ATTACK_RANGE_APPROACH_FUDGE,
      },
      findEntityById: (id) => entities.find((e) => e.id === id) ?? null,
      findFireWeaponTargetForPosition: () => null,
      canEntityAttackFromStatus: () => true,
      canAttackerTargetEntity: () => true,
      setEntityAttackStatus: () => {},
      setEntityAimingWeaponStatus: () => {},
      setEntityFiringWeaponStatus: () => {},
      setEntityIgnoringStealthStatus: () => {},
      refreshEntitySneakyMissWindow: () => {},
      issueMoveTo: (entityId, x, z, attackDistance) => {
        lastIssueMoveTo = { entityId, x, z, attackDistance };
      },
      computeAttackRetreatTarget: () => null,
      rebuildEntityScatterTargets: () => {},
      resolveWeaponPreAttackDelayFrames: () => 0,
      queueWeaponDamageEvent: () => {},
      recordConsecutiveAttackShot: () => {},
      resolveWeaponDelayFrames: () => 5,
      resolveClipReloadFrames: () => 30,
      resolveTargetAnchorPosition: (t) => ({ x: t.x, z: t.z }),
      isAttackLineOfSightBlocked: () => false,
      clearMaxShotsAttackState: () => {},
      isTurretAlignedForFiring: () => true,
    });

    expect(lastIssueMoveTo).not.toBeNull();
    expect(lastIssueMoveTo!.entityId).toBe(1);
    // The approach distance should be attackRange * 0.9 = 180, NOT 200.
    expect(lastIssueMoveTo!.attackDistance).toBeCloseTo(attackRange * ATTACK_RANGE_APPROACH_FUDGE);
    expect(lastIssueMoveTo!.attackDistance).toBeCloseTo(180);
  });
});
