/**
 * Tests for FireWeaponCollide and DockUpdate base field extraction.
 *
 * Source parity:
 *   FireWeaponCollide.cpp — CollideWeapon, FireOnce, RequiredStatus, ForbiddenStatus
 *   DockUpdate.cpp — NumberApproachPositions, AllowsPassthrough (base fields for all DockUpdate subclasses)
 */

import { describe, expect, it } from 'vitest';

import {
  extractFireWeaponCollideProfiles,
  extractSupplyWarehouseProfile,
  extractRepairDockProfile,
} from './entity-factory.js';
import { LOGIC_FRAME_RATE } from './index.js';
import { makeBlock, makeObjectDef } from './test-helpers.js';

// Minimal self mock for extraction functions.
const LOGIC_FRAME_MS = 1000 / LOGIC_FRAME_RATE;
function makeSelf() {
  return {
    msToLogicFrames(ms: number): number {
      if (!Number.isFinite(ms) || ms <= 0) return 0;
      return Math.max(1, Math.ceil(ms / LOGIC_FRAME_MS));
    },
    msToLogicFramesReal(ms: number): number {
      if (!Number.isFinite(ms) || ms <= 0) return 0;
      return ms / LOGIC_FRAME_MS;
    },
    resolveObjectDefParent(): null {
      return null;
    },
  } as any;
}

// ── FireWeaponCollide ─────────────────────────────────────────────────────

describe('FireWeaponCollide profile extraction', () => {
  it('extracts all 4 fields from INI', () => {
    const objectDef = makeObjectDef('BurningTree', 'Neutral', ['STRUCTURE'], [
      makeBlock('Behavior', 'FireWeaponCollide ModuleTag_03', {
        CollideWeapon: 'TreeFireDealDamageWeapon',
        FireOnce: 'Yes',
        RequiredStatus: 'AFLAME',
        ForbiddenStatus: 'SOLD',
      }),
    ]);
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;

    expect(p.collideWeapon).toBe('TreeFireDealDamageWeapon');
    expect(p.fireOnce).toBe(true);
    expect(p.requiredStatus).toEqual(new Set(['AFLAME']));
    expect(p.forbiddenStatus).toEqual(new Set(['SOLD']));
  });

  it('defaults FireOnce to false and status sets to empty when absent', () => {
    const objectDef = makeObjectDef('Mine', 'America', ['MINE'], [
      makeBlock('Behavior', 'FireWeaponCollide ModuleTag_01', {
        CollideWeapon: 'MineDetonationWeapon',
      }),
    ]);
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;

    expect(p.collideWeapon).toBe('MineDetonationWeapon');
    expect(p.fireOnce).toBe(false);
    expect(p.requiredStatus.size).toBe(0);
    expect(p.forbiddenStatus.size).toBe(0);
  });

  it('parses multiple status bits (space-separated)', () => {
    const objectDef = makeObjectDef('SpecialMine', 'GLA', ['MINE'], [
      makeBlock('Behavior', 'FireWeaponCollide ModuleTag_02', {
        CollideWeapon: 'TestWeapon',
        RequiredStatus: 'AFLAME STEALTHED',
        ForbiddenStatus: 'SOLD UNDER_CONSTRUCTION',
      }),
    ]);
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(1);
    const p = profiles[0]!;

    expect(p.requiredStatus).toEqual(new Set(['AFLAME', 'STEALTHED']));
    expect(p.forbiddenStatus).toEqual(new Set(['SOLD', 'UNDER_CONSTRUCTION']));
  });

  it('extracts multiple FireWeaponCollide modules per entity', () => {
    const objectDef = makeObjectDef('MultiCollider', 'America', ['VEHICLE'], [
      makeBlock('Behavior', 'FireWeaponCollide ModuleTag_01', {
        CollideWeapon: 'Weapon1',
        FireOnce: 'Yes',
      }),
      makeBlock('Behavior', 'FireWeaponCollide ModuleTag_02', {
        CollideWeapon: 'Weapon2',
        RequiredStatus: 'AFLAME',
      }),
    ]);
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]!.collideWeapon).toBe('Weapon1');
    expect(profiles[0]!.fireOnce).toBe(true);
    expect(profiles[1]!.collideWeapon).toBe('Weapon2');
    expect(profiles[1]!.fireOnce).toBe(false);
    expect(profiles[1]!.requiredStatus).toEqual(new Set(['AFLAME']));
  });

  it('skips entries without CollideWeapon', () => {
    const objectDef = makeObjectDef('BadModule', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'FireWeaponCollide ModuleTag_01', {
        FireOnce: 'Yes',
        // No CollideWeapon — should be skipped.
      }),
    ]);
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(0);
  });

  it('returns empty array for non-collide objects', () => {
    const objectDef = makeObjectDef('Tank', 'America', ['VEHICLE'], [
      makeBlock('Body', 'ActiveBody ModuleTag_Body', { MaxHealth: 100 }),
    ]);
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), objectDef);
    expect(profiles).toHaveLength(0);
  });

  it('returns empty array for undefined objectDef', () => {
    const profiles = extractFireWeaponCollideProfiles(makeSelf(), undefined);
    expect(profiles).toHaveLength(0);
  });
});

// ── DockUpdate base fields — SupplyWarehouseDockUpdate ─────────────────────

describe('DockUpdate base fields on SupplyWarehouseProfile', () => {
  it('extracts NumberApproachPositions and AllowsPassthrough', () => {
    const objectDef = makeObjectDef('SupplyWarehouse', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
        StartingBoxes: 100,
        NumberApproachPositions: 5,
        AllowsPassthrough: 'No',
      }),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.numberApproachPositions).toBe(5);
    expect(profile!.allowsPassthrough).toBe(false);
  });

  it('defaults NumberApproachPositions to -1 (unlimited) when absent', () => {
    const objectDef = makeObjectDef('SupplyWarehouse', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
        StartingBoxes: 50,
      }),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    // C++ default: m_numberApproachPositionsData = -1
    expect(profile!.numberApproachPositions).toBe(-1);
    expect(profile!.allowsPassthrough).toBe(false);
  });

  it('handles NumberApproachPositions = -1 explicitly', () => {
    const objectDef = makeObjectDef('SupplyPile', 'GLA', ['STRUCTURE'], [
      makeBlock('Behavior', 'SupplyWarehouseDockUpdate ModuleTag_Dock', {
        StartingBoxes: 400,
        NumberApproachPositions: -1,
        AllowsPassthrough: 'No',
      }),
    ]);
    const profile = extractSupplyWarehouseProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.numberApproachPositions).toBe(-1);
  });
});

// ── DockUpdate base fields — RepairDockUpdate ───────────────────────────

describe('DockUpdate base fields on RepairDockProfile', () => {
  it('extracts NumberApproachPositions and AllowsPassthrough', () => {
    const objectDef = makeObjectDef('RepairPad', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Repair', {
        TimeForFullHeal: 5000,
        NumberApproachPositions: 5,
        AllowsPassthrough: 'No',
      }),
    ]);
    const profile = extractRepairDockProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.numberApproachPositions).toBe(5);
    expect(profile!.allowsPassthrough).toBe(false);
  });

  it('defaults NumberApproachPositions to -1 (unlimited) when absent', () => {
    const objectDef = makeObjectDef('RepairPad', 'America', ['STRUCTURE'], [
      makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Repair', {
        TimeForFullHeal: 3000,
      }),
    ]);
    const profile = extractRepairDockProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    // C++ default: m_numberApproachPositionsData = -1
    expect(profile!.numberApproachPositions).toBe(-1);
    expect(profile!.allowsPassthrough).toBe(false);
  });

  it('parses AllowsPassthrough = true', () => {
    const objectDef = makeObjectDef('SpecialDock', 'China', ['STRUCTURE'], [
      makeBlock('Behavior', 'RepairDockUpdate ModuleTag_Repair', {
        TimeForFullHeal: 2000,
        AllowsPassthrough: 'Yes',
      }),
    ]);
    const profile = extractRepairDockProfile(makeSelf(), objectDef);
    expect(profile).not.toBeNull();
    expect(profile!.allowsPassthrough).toBe(true);
  });
});
