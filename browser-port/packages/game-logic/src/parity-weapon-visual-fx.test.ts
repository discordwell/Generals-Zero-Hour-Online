/**
 * Parity Tests — Weapon visual/FX/UI fields extraction.
 *
 * Verifies that the 8 visual/FX/UI fields are correctly extracted from INI weapon
 * definitions into the AttackWeaponProfile:
 *   1. FireFX / fireFXNames — fire visual effect (per-vet-level)
 *   2. ProjectileDetonationFX / projectileDetonationFXNames — detonation FX (per-vet-level)
 *   3. ProjectileDetonationOCL / projectileDetonationOCLNames — detonation OCL (per-vet-level)
 *   4. ProjectileExhaust / projectileExhaustNames — exhaust particle system (per-vet-level)
 *   5. ShowsAmmoPips — ammo pip UI display
 *   6. PlayFXWhenStealthed — FX during stealth
 *   7. WeaponRecoil — turret recoil (degrees -> radians)
 *   8. SuspendFXDelay — FX suspension (ms -> frames)
 *
 * Source parity references:
 *   Weapon.cpp lines 187, 193-202, 233, 235, 239 — FieldParse table
 *   Weapon.cpp lines 269, 310-311, 316 — default values in clear()
 */

import { describe, expect, it } from 'vitest';

import {
  createParityAgent,
  makeBlock,
  makeObjectDef,
  makeWeaponDef,
  makeWeaponBlock,
  place,
} from './parity-agent.js';

describe('parity weapon visual/FX/UI fields', () => {
  // ── Helper: create an agent with one attacker + one target, return the attacker's weapon profile ──

  function resolveWeaponProfile(weaponFields: Record<string, unknown>) {
    const agent = createParityAgent({
      bundles: {
        objects: [
          makeObjectDef('Attacker', 'America', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
            makeWeaponBlock('TestGun'),
          ]),
          makeObjectDef('Target', 'China', ['VEHICLE'], [
            makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 500, InitialHealth: 500 }),
          ]),
        ],
        weapons: [
          makeWeaponDef('TestGun', {
            PrimaryDamage: 50,
            DamageType: 'ARMOR_PIERCING',
            AttackRange: 120,
            DelayBetweenShots: 200,
            ...weaponFields,
          }),
        ],
      },
      mapObjects: [
        place('Attacker', 'America', 10, 10),
        place('Target', 'China', 20, 20),
      ],
      sides: { America: {}, China: {} },
      enemies: [['America', 'China']],
    });

    // Get the spawned attacker entity (ID 1) and read its weapon profile
    const attacker = (agent.gameLogic as any).spawnedEntities.get(1);
    expect(attacker).toBeDefined();
    expect(attacker.attackWeapon).not.toBeNull();
    return attacker.attackWeapon;
  }

  // ── Test 1: Default values (no FX fields set) ──

  it('has correct defaults when no visual/FX fields are specified', () => {
    const profile = resolveWeaponProfile({});

    expect(profile.fireFX).toBeNull();
    expect(profile.fireFXNames).toEqual([null, null, null, null]);
    expect(profile.projectileDetonationFX).toBeNull();
    expect(profile.projectileDetonationFXNames).toEqual([null, null, null, null]);
    expect(profile.projectileDetonationOCL).toBeNull();
    expect(profile.projectileDetonationOCLNames).toEqual([null, null, null, null]);
    expect(profile.projectileExhaust).toBeNull();
    expect(profile.projectileExhaustNames).toEqual([null, null, null, null]);
    expect(profile.showsAmmoPips).toBe(false);
    expect(profile.playFXWhenStealthed).toBe(false);
    expect(profile.weaponRecoil).toBe(0);
    expect(profile.suspendFXDelayFrames).toBe(0);
  });

  // ── Test 2: FireFX extraction ──

  it('extracts FireFX and sets all vet levels', () => {
    const profile = resolveWeaponProfile({
      FireFX: 'FX_MachineGunFire',
    });

    expect(profile.fireFX).toBe('FX_MachineGunFire');
    expect(profile.fireFXNames).toEqual([
      'FX_MachineGunFire',
      'FX_MachineGunFire',
      'FX_MachineGunFire',
      'FX_MachineGunFire',
    ]);
  });

  // ── Test 3: ProjectileDetonationFX extraction ──

  it('extracts ProjectileDetonationFX and sets all vet levels', () => {
    const profile = resolveWeaponProfile({
      ProjectileDetonationFX: 'FX_MissileExplosion',
    });

    expect(profile.projectileDetonationFX).toBe('FX_MissileExplosion');
    expect(profile.projectileDetonationFXNames).toEqual([
      'FX_MissileExplosion',
      'FX_MissileExplosion',
      'FX_MissileExplosion',
      'FX_MissileExplosion',
    ]);
  });

  // ── Test 4: ProjectileDetonationOCL extraction ──

  it('extracts ProjectileDetonationOCL and sets all vet levels', () => {
    const profile = resolveWeaponProfile({
      ProjectileDetonationOCL: 'OCL_MissileDebris',
    });

    expect(profile.projectileDetonationOCL).toBe('OCL_MissileDebris');
    expect(profile.projectileDetonationOCLNames).toEqual([
      'OCL_MissileDebris',
      'OCL_MissileDebris',
      'OCL_MissileDebris',
      'OCL_MissileDebris',
    ]);
  });

  // ── Test 5: ProjectileExhaust extraction ──

  it('extracts ProjectileExhaust and sets all vet levels', () => {
    const profile = resolveWeaponProfile({
      ProjectileExhaust: 'PSys_MissileExhaust',
    });

    expect(profile.projectileExhaust).toBe('PSys_MissileExhaust');
    expect(profile.projectileExhaustNames).toEqual([
      'PSys_MissileExhaust',
      'PSys_MissileExhaust',
      'PSys_MissileExhaust',
      'PSys_MissileExhaust',
    ]);
  });

  // ── Test 6: ShowsAmmoPips boolean ──

  it('extracts ShowsAmmoPips = Yes as true', () => {
    const profile = resolveWeaponProfile({
      ShowsAmmoPips: 'Yes',
      ClipSize: 6,
    });

    expect(profile.showsAmmoPips).toBe(true);
  });

  it('extracts ShowsAmmoPips = No as false', () => {
    const profile = resolveWeaponProfile({
      ShowsAmmoPips: 'No',
    });

    expect(profile.showsAmmoPips).toBe(false);
  });

  // ── Test 7: PlayFXWhenStealthed boolean ──

  it('extracts PlayFXWhenStealthed = Yes as true', () => {
    const profile = resolveWeaponProfile({
      PlayFXWhenStealthed: 'Yes',
    });

    expect(profile.playFXWhenStealthed).toBe(true);
  });

  // ── Test 8: WeaponRecoil (degrees -> radians) ──

  it('converts WeaponRecoil from degrees to radians', () => {
    const profile = resolveWeaponProfile({
      WeaponRecoil: 5,
    });

    // 5 degrees * PI/180 = 0.08726646...
    expect(profile.weaponRecoil).toBeCloseTo(5 * Math.PI / 180, 10);
  });

  it('WeaponRecoil defaults to 0 radians', () => {
    const profile = resolveWeaponProfile({});

    expect(profile.weaponRecoil).toBe(0);
  });

  // ── Test 9: SuspendFXDelay (ms -> frames) ──

  it('converts SuspendFXDelay from ms to logic frames', () => {
    // Source parity: parseDurationUnsignedInt converts ms -> frames.
    // msToLogicFrames divides by (1000/30) ≈ 33.33ms per frame.
    // 500ms -> 500 / 33.33 = 15 frames
    const profile = resolveWeaponProfile({
      SuspendFXDelay: 500,
    });

    expect(profile.suspendFXDelayFrames).toBe(15);
  });

  it('SuspendFXDelay defaults to 0 frames', () => {
    const profile = resolveWeaponProfile({});

    expect(profile.suspendFXDelayFrames).toBe(0);
  });

  // ── Test 10: All fields combined ──

  it('extracts all 8 visual/FX/UI fields together', () => {
    const profile = resolveWeaponProfile({
      FireFX: 'FX_TankGunFire',
      ProjectileDetonationFX: 'FX_TankShellExplosion',
      ProjectileDetonationOCL: 'OCL_TankShellDebris',
      ProjectileExhaust: 'PSys_TankRound',
      ShowsAmmoPips: 'Yes',
      PlayFXWhenStealthed: 'Yes',
      WeaponRecoil: 10,
      SuspendFXDelay: 1000,
      ClipSize: 4,
    });

    expect(profile.fireFX).toBe('FX_TankGunFire');
    expect(profile.projectileDetonationFX).toBe('FX_TankShellExplosion');
    expect(profile.projectileDetonationOCL).toBe('OCL_TankShellDebris');
    expect(profile.projectileExhaust).toBe('PSys_TankRound');
    expect(profile.showsAmmoPips).toBe(true);
    expect(profile.playFXWhenStealthed).toBe(true);
    expect(profile.weaponRecoil).toBeCloseTo(10 * Math.PI / 180, 10);
    // 1000ms / 33.33 = 30 frames
    expect(profile.suspendFXDelayFrames).toBe(30);
  });
});
