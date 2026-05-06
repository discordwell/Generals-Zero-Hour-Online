import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GameLogicSubsystem } from './index.js';
import { makeBundle, makeRegistry, makeWeaponDef } from './test-helpers.js';

const CMD_FROM_PLAYER_MASK = 1 << 0;
const CMD_FROM_AI_MASK = 1 << 2;

function makeRuntime() {
  const logic = new GameLogicSubsystem(new THREE.Scene()) as unknown as {
    resolveAttackWeaponProfileForSetSelection: (
      weaponTemplateSets: unknown[],
      weaponSetFlagsMask: number,
      iniDataRegistry: unknown,
      forcedWeaponSlot?: number | null,
    ) => {
      name: string;
      autoChooseSourceMask: number;
      preferredAgainstKindOf: ReadonlySet<string>;
    } | null;
    resolveWeaponProfileFromDef: (weaponDef: unknown) => {
      autoChooseSourceMask: number;
      preferredAgainstKindOf: ReadonlySet<string>;
    } | null;
  };
  const registry = makeRegistry(makeBundle({
    objects: [],
    weapons: [
      makeWeaponDef('PrimaryGun', {
        AttackRange: 200,
        PrimaryDamage: 10,
        DamageType: 'SMALL_ARMS',
      }),
      makeWeaponDef('SecondaryRocket', {
        AttackRange: 250,
        PrimaryDamage: 25,
        DamageType: 'EXPLOSION',
      }),
    ],
  }));
  const weaponTemplateSets = [{
    conditionsMask: 0,
    weaponNamesBySlot: ['PrimaryGun', 'SecondaryRocket', null],
    autoChooseSourceMasks: [CMD_FROM_PLAYER_MASK, CMD_FROM_AI_MASK, 0],
    preferredAgainstBySlot: [[], ['AIRCRAFT', 'VEHICLE'], []],
    shareReloadTime: false,
    weaponLockSharedAcrossSets: false,
  }];
  return { logic, registry, weaponTemplateSets };
}

describe('WeaponTemplateSet slot metadata propagation', () => {
  it('keeps AutoChooseSources/PreferredAgainst on a forced slot profile', () => {
    const { logic, registry, weaponTemplateSets } = makeRuntime();

    const profile = logic.resolveAttackWeaponProfileForSetSelection(
      weaponTemplateSets,
      0,
      registry,
      1,
    );

    expect(profile).not.toBeNull();
    expect(profile!.name).toBe('SecondaryRocket');
    expect(profile!.autoChooseSourceMask).toBe(CMD_FROM_AI_MASK);
    expect([...profile!.preferredAgainstKindOf]).toEqual(['AIRCRAFT', 'VEHICLE']);
  });

  it('keeps primary slot AutoChooseSources when no slot is forced', () => {
    const { logic, registry, weaponTemplateSets } = makeRuntime();

    const profile = logic.resolveAttackWeaponProfileForSetSelection(
      weaponTemplateSets,
      0,
      registry,
      null,
    );

    expect(profile).not.toBeNull();
    expect(profile!.name).toBe('PrimaryGun');
    expect(profile!.autoChooseSourceMask).toBe(CMD_FROM_PLAYER_MASK);
    expect(profile!.preferredAgainstKindOf.size).toBe(0);
  });

  it('uses source defaults on bare weapon-template profiles', () => {
    const { logic, registry } = makeRuntime();
    const weaponDef = registry.getWeapon('PrimaryGun');

    const profile = logic.resolveWeaponProfileFromDef(weaponDef);

    expect(profile).not.toBeNull();
    expect(profile!.autoChooseSourceMask).toBe(0xffffffff);
    expect(profile!.preferredAgainstKindOf.size).toBe(0);
  });
});
