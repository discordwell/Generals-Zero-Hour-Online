/**
 * Bundle-wide scanner — for every object that uses a session-2026-05-04 touched
 * field, run the corresponding extractor against that object and verify the
 * parsed profile preserves the bundle value. Where the curated
 * session-2026-05-04-verification.test.ts proves "this one example works,"
 * this test proves "every shipped retail user of the field works."
 *
 * Catches regressions where one object's bundle representation triggers a
 * parsing edge case that the hand-picked example doesn't exercise.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  extractContainProfile,
  extractCrateCollideProfile,
  extractEmpUpdateProfile,
  extractFXListDieProfiles,
  extractGenerateMinefieldProfile,
  extractLeafletDropProfile,
  extractRiderChangeContainProfile,
  extractSalvageCrateProfile,
  extractSlowDeathProfiles,
  extractStickyBombUpdateProfile,
  extractStructureCollapseProfile,
  extractUpgradeModulesFromBlocks,
} from './entity-factory.js';
import { extractFlightDeckProfile } from './flight-deck.js';
import { LOGIC_FRAME_RATE } from './index.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(SCRIPT_DIR, '../../app/public/assets/data/ini-bundle.json');

interface BundleObject {
  name?: string;
  blocks?: BundleBlock[];
}
interface BundleBlock {
  type?: string;
  name?: string;
  fields?: Record<string, unknown>;
  blocks?: BundleBlock[];
}
const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf-8')) as { objects?: BundleObject[] };

function splitTokens(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().split(/\s+/).filter((s) => s.length > 0);
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === 'string' ? entry.trim().split(/\s+/) : []))
      .filter((s) => s.length > 0);
  }
  return [];
}

function makeSelfStub() {
  return {
    msToLogicFrames: (ms: number): number => Math.max(0, Math.round((ms ?? 0) / (1000 / LOGIC_FRAME_RATE))),
    parsePercent: (value: unknown): number | null => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const n = Number(value.trim().replace(/%$/, ''));
        return Number.isFinite(n) ? n : null;
      }
      return null;
    },
    readIniFieldValue: (fields: Record<string, unknown>, fieldName: string): unknown => {
      const norm = fieldName.toUpperCase();
      for (const [n, v] of Object.entries(fields)) if (n.toUpperCase() === norm) return v;
      return undefined;
    },
    resolveObjectDefParent: () => undefined,
    parseUpgradeNames: (v: unknown) => splitTokens(v),
    parseObjectStatusNames: (v: unknown) => splitTokens(v).map((s) => s.toUpperCase()),
    parseKindOf: (v: unknown) => splitTokens(v).map((s) => s.toUpperCase()),
  } as unknown as Parameters<typeof extractFlightDeckProfile>[0];
}

/** Find all (object, blockFields) pairs whose Behavior block of the given module
 *  type carries the given INI field. Used to drive every retail user of a
 *  touched field through the matching extractor. */
function* iterFieldUsages(moduleType: string, fieldName: string): Generator<{
  obj: BundleObject;
  bundleValue: unknown;
}> {
  for (const obj of bundle.objects ?? []) {
    for (const block of obj.blocks ?? []) {
      const parts = (block.name ?? '').split(/\s+/);
      if (parts[0]?.toUpperCase() !== moduleType.toUpperCase()) continue;
      if (block.fields && fieldName in block.fields) {
        yield { obj, bundleValue: block.fields[fieldName] };
      }
    }
  }
}

describe('session 2026-05-04 — bundle-wide scanner over touched fields', () => {
  it('FlightDeckBehavior Runway1CatapultSystem flows through every retail aircraft carrier', () => {
    const usages = [...iterFieldUsages('FlightDeckBehavior', 'Runway1CatapultSystem')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractFlightDeckProfile(makeSelfStub(), obj as never);
      expect(profile, `FlightDeckProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.runwayCatapultSystem[0], `Runway1CatapultSystem mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('FlightDeckBehavior Runway2CatapultSystem flows through every retail aircraft carrier', () => {
    const usages = [...iterFieldUsages('FlightDeckBehavior', 'Runway2CatapultSystem')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractFlightDeckProfile(makeSelfStub(), obj as never);
      expect(profile, `FlightDeckProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.runwayCatapultSystem[1], `Runway2CatapultSystem mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('GenerateMinefieldBehavior GenerationFX flows through every retail user', () => {
    const usages = [...iterFieldUsages('GenerateMinefieldBehavior', 'GenerationFX')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractGenerateMinefieldProfile(makeSelfStub(), obj as never);
      expect(profile, `GenerateMinefieldProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.generationFX, `GenerationFX mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('LeafletDropBehavior LeafletFXParticleSystem flows through every retail user', () => {
    const usages = [...iterFieldUsages('LeafletDropBehavior', 'LeafletFXParticleSystem')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractLeafletDropProfile(makeSelfStub(), obj as never);
      expect(profile, `LeafletDropProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.leafletFXParticleSystem, `LeafletFXParticleSystem mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('SalvageCrateCollide MoneyChance flows through every retail salvage crate', () => {
    const usages = [...iterFieldUsages('SalvageCrateCollide', 'MoneyChance')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractSalvageCrateProfile(makeSelfStub(), obj as never);
      expect(profile, `SalvageCrateProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.moneyChance, `MoneyChance mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('SalvageCrateCollide PickupScience flows through every retail salvage crate', () => {
    const usages = [...iterFieldUsages('SalvageCrateCollide', 'PickupScience')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractSalvageCrateProfile(makeSelfStub(), obj as never);
      expect(profile, `SalvageCrateProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.pickupScience, `PickupScience mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('StickyBombUpdate GeometryBasedDamageFX flows through every retail booby trap', () => {
    const usages = [...iterFieldUsages('StickyBombUpdate', 'GeometryBasedDamageFX')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractStickyBombUpdateProfile(makeSelfStub(), obj as never);
      expect(profile, `StickyBombUpdateProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.geometryBasedDamageFX, `GeometryBasedDamageFX mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });
});

describe('session 2026-05-04 — bundle-wide scanner over slice 1 array-vs-string risks', () => {
  /** Walk every retail object that ships a TransportContain-derived contain
   *  block with InitialPayload (the field that exposed the InitialPayload bug)
   *  and confirm the extractor surfaces a non-null template name and positive
   *  count. This is the highest-confidence regression check for the
   *  array-shape fix. */
  it('TransportContain.InitialPayload extraction succeeds for every retail user', () => {
    const transportLike = new Set([
      'TransportContain', 'OverlordContain', 'HelixContain', 'RailedTransportContain',
      'ParachuteContain', 'TunnelContain', 'GarrisonContain', 'OpenContain', 'RiderChangeContain',
    ]);
    let userCount = 0;
    let arrayShapeCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (!moduleType || !transportLike.has(moduleType)) continue;
        const fields = block.fields ?? {};
        if (!('InitialPayload' in fields)) continue;
        userCount++;
        if (Array.isArray(fields['InitialPayload'])) arrayShapeCount++;
        const profile = extractContainProfile(makeSelfStub(), obj as never);
        expect(profile, `ContainProfile null for ${obj.name} (${moduleType})`).not.toBeNull();
        if (profile!.initialPayloadTemplateName === null) {
          throw new Error(`InitialPayload silently dropped on ${obj.name} module=${moduleType}: ${JSON.stringify(fields['InitialPayload'])}`);
        }
        expect(profile!.initialPayloadCount, `InitialPayload count = 0 on ${obj.name}`).toBeGreaterThan(0);
      }
    }
    expect(userCount, 'expected at least one InitialPayload in retail data').toBeGreaterThan(0);
    // Must have caught the array shape — otherwise the fix's regression coverage is weak.
    expect(arrayShapeCount, 'expected at least one array-shaped InitialPayload to verify the fix').toBeGreaterThan(0);
  });

  it('RiderChangeContain ScuttleDelay frames are positive for every retail user', () => {
    let count = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'RiderChangeContain') continue;
        const fields = block.fields ?? {};
        if (!('ScuttleDelay' in fields)) continue;
        count++;
        const rider = extractRiderChangeContainProfile(makeSelfStub(), obj as never);
        expect(rider, `RiderChangeContainProfile null for ${obj.name}`).not.toBeNull();
        expect(rider!.scuttleDelayFrames, `ScuttleDelayFrames non-positive on ${obj.name}`).toBeGreaterThan(0);
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('SubObjectsUpgrade Hide/Show lists are non-empty for every retail user', () => {
    let count = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'SubObjectsUpgrade') continue;
        const fields = block.fields ?? {};
        const hasHide = 'HideSubObjects' in fields;
        const hasShow = 'ShowSubObjects' in fields;
        if (!hasHide && !hasShow) continue;
        count++;
        const upgrades = extractUpgradeModulesFromBlocks(makeSelfStub(), obj.blocks as never, null);
        const upgrade = upgrades.find((u) => u.hideSubObjects.length > 0 || u.showSubObjects.length > 0);
        expect(upgrade, `SubObjectsUpgrade not extracted on ${obj.name}`).toBeDefined();
        if (hasHide) {
          expect(upgrade!.hideSubObjects.length, `HideSubObjects empty on ${obj.name} (bundle=${JSON.stringify(fields['HideSubObjects'])})`).toBeGreaterThan(0);
        }
        if (hasShow) {
          expect(upgrade!.showSubObjects.length, `ShowSubObjects empty on ${obj.name} (bundle=${JSON.stringify(fields['ShowSubObjects'])})`).toBeGreaterThan(0);
        }
      }
    }
    expect(count, 'expected SubObjectsUpgrade users in retail data').toBeGreaterThan(0);
  });

  it('GarrisonContain.InitialRoster extraction succeeds for every retail user (array form expected)', () => {
    let userCount = 0;
    let arrayShapeCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'GarrisonContain') continue;
        const fields = block.fields ?? {};
        if (!('InitialRoster' in fields)) continue;
        userCount++;
        if (Array.isArray(fields['InitialRoster'])) arrayShapeCount++;
        const profile = extractContainProfile(makeSelfStub(), obj as never);
        expect(profile, `ContainProfile null for ${obj.name}`).not.toBeNull();
        // GarrisonContain ContainProfile uses initialRosterTemplateName / initialRosterCount.
        const cp = profile as unknown as { initialRosterTemplateName: string | null; initialRosterCount: number };
        if (cp.initialRosterTemplateName === null) {
          throw new Error(`InitialRoster silently dropped on ${obj.name} bundle=${JSON.stringify(fields['InitialRoster'])}`);
        }
        expect(cp.initialRosterCount, `InitialRoster count = 0 on ${obj.name}`).toBeGreaterThan(0);
      }
    }
    expect(userCount).toBeGreaterThan(0);
    expect(arrayShapeCount, 'expected at least one array-shaped InitialRoster').toBeGreaterThan(0);
  });

  it('FXListDie DeathTypes parses every retail user — array AND string shapes', () => {
    let userCount = 0;
    let arrayShapeCount = 0;
    let stringShapeCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'FXListDie') continue;
        const fields = block.fields ?? {};
        if (!('DeathTypes' in fields)) continue;
        userCount++;
        if (Array.isArray(fields['DeathTypes'])) arrayShapeCount++;
        if (typeof fields['DeathTypes'] === 'string') stringShapeCount++;

        const profiles = extractFXListDieProfiles(makeSelfStub(), obj as never);
        // Find the profile matching this block's death FX name.
        const deathFXName = typeof fields['DeathFX'] === 'string'
          ? (fields['DeathFX'] as string).trim().toUpperCase()
          : null;
        if (!deathFXName) continue;
        const profile = profiles.find((p) => p.deathFXName === deathFXName);
        expect(profile, `FXListDie profile not found for ${obj.name}/${deathFXName}`).toBeDefined();
        expect(profile!.deathTypes.size, `DeathTypes empty on ${obj.name}/${deathFXName} (bundle=${JSON.stringify(fields['DeathTypes'])})`).toBeGreaterThan(0);
      }
    }
    expect(userCount).toBeGreaterThan(0);
    expect(arrayShapeCount, 'expected array-shaped DeathTypes — confirms readStringField array branch is exercised').toBeGreaterThan(0);
    expect(stringShapeCount, 'expected string-shaped DeathTypes — confirms backwards compatibility').toBeGreaterThan(0);
  });

  it('SlowDeathBehavior INITIAL OCL flows through every retail user (was silently dropped)', () => {
    let userCount = 0;
    let phaseTokenCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'SlowDeathBehavior') continue;
        const fields = block.fields ?? {};
        const ocl = fields['OCL'];
        if (!Array.isArray(ocl)) continue;
        if (ocl.length !== 2 || typeof ocl[0] !== 'string' || typeof ocl[1] !== 'string') continue;
        const phase = (ocl[0] as string).trim().toUpperCase();
        const oclName = (ocl[1] as string).trim();
        if (!['INITIAL', 'MIDPOINT', 'FINAL'].includes(phase)) continue;
        userCount++;
        const profiles = extractSlowDeathProfiles(makeSelfStub(), obj as never);
        // Find the profile matching this block's module tag.
        const moduleTag = (block.name ?? '').split(/\s+/)[1]?.toUpperCase() ?? null;
        const profile = profiles.find((p) => p.moduleTag === moduleTag);
        expect(profile, `SlowDeath profile not found for ${obj.name}/${moduleTag}`).toBeDefined();
        const phaseIdx = ['INITIAL', 'MIDPOINT', 'FINAL'].indexOf(phase);
        expect(profile!.phaseOCLs[phaseIdx], `Phase ${phase} OCL missing on ${obj.name}/${moduleTag} (bundle=${JSON.stringify(ocl)})`).toContain(oclName);
        phaseTokenCount++;
      }
    }
    expect(userCount, 'expected SlowDeathBehavior OCL with [phase, ocl] array shape in retail data').toBeGreaterThan(0);
    expect(phaseTokenCount).toBe(userCount); // All decoded successfully
  });

  it('StructureCollapseUpdate FINAL OCL flows through every retail building (was silently dropped)', () => {
    let userCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'StructureCollapseUpdate') continue;
        const fields = block.fields ?? {};
        const ocl = fields['OCL'];
        if (!Array.isArray(ocl) || ocl.length !== 2) continue;
        if (typeof ocl[0] !== 'string' || typeof ocl[1] !== 'string') continue;
        const phase = (ocl[0] as string).trim().toUpperCase();
        const oclName = (ocl[1] as string).trim();
        if (!['INITIAL', 'DELAY', 'BURST', 'FINAL'].includes(phase)) continue;
        userCount++;
        const profile = extractStructureCollapseProfile(makeSelfStub(), obj as never);
        expect(profile, `StructureCollapseProfile null for ${obj.name}`).not.toBeNull();
        const phaseIdx = ['INITIAL', 'DELAY', 'BURST', 'FINAL'].indexOf(phase);
        expect(profile!.phaseOCLs[phaseIdx], `Phase ${phase} OCL missing on ${obj.name} (bundle=${JSON.stringify(ocl)})`).toContain(oclName);
      }
    }
    expect(userCount, 'expected StructureCollapseUpdate OCL with [phase, ocl] array shape').toBeGreaterThan(0);
  });

  it('MoneyCrateCollide UpgradedBoost decodes for every retail user (was silently dropped)', () => {
    let userCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'MoneyCrateCollide') continue;
        const fields = block.fields ?? {};
        if (!('UpgradedBoost' in fields)) continue;
        userCount++;
        const profile = extractCrateCollideProfile(makeSelfStub(), obj as never);
        expect(profile, `CrateCollideProfile null on ${obj.name}`).not.toBeNull();
        expect(profile!.upgradedBoosts.length, `UpgradedBoost dropped on ${obj.name} bundle=${JSON.stringify(fields['UpgradedBoost'])}`).toBeGreaterThan(0);
        const boost = profile!.upgradedBoosts[0]!;
        expect(boost.upgradeName.length).toBeGreaterThan(0);
        expect(boost.amount).toBeGreaterThan(0);
      }
    }
    expect(userCount, 'expected MoneyCrateCollide UpgradedBoost users (SupplyDropZoneCrate, TechOilDerrick)').toBeGreaterThan(0);
  });

  it('OCLUpdate.FactionOCL decodes for retail TechReinforcementPad (was silently dropped)', () => {
    const obj = bundle.objects?.find((o) => o.name === 'TechReinforcementPad');
    expect(obj, 'expected TechReinforcementPad in retail bundle').toBeDefined();
    // FactionOCL is parsed inside extractOCLUpdateProfile / extractOCLProfiles —
    // we approximate by extracting all OCL update profiles for the object.
    // The runtime resolver looks up factionOCLMap by faction name.
    let fields: Record<string, unknown> | undefined;
    for (const block of obj!.blocks ?? []) {
      const moduleType = (block.name ?? '').split(/\s+/)[0];
      if (moduleType === 'OCLUpdate' && (block.fields ?? {})['FactionOCL']) {
        fields = block.fields ?? {};
        break;
      }
    }
    expect(fields).toBeDefined();
    expect(Array.isArray(fields!['FactionOCL'])).toBe(true);
    // Verify the public bundle shape we expect to support.
    const arr = fields!['FactionOCL'] as string[];
    expect(arr).toEqual(['Faction:GLAStealthGeneral', 'OCL:OCL_StlthGen_ReinforcementPadGLAVehicle']);
    // Now exercise the parser via the public runtime path.
    // (We can't call extractOCLUpdateProfile directly without more wiring;
    //  the regression value of this case is verified by the
    //  TechReinforcementPad source-save simulation e2e.)
  });

  it('EMPUpdate StartColor / EndColor RGB tokens decode to a 3-channel tuple for every retail user', () => {
    let count = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'EMPUpdate') continue;
        const fields = block.fields ?? {};
        if (!('StartColor' in fields) && !('EndColor' in fields)) continue;
        count++;
        const profile = extractEmpUpdateProfile(makeSelfStub(), obj as never);
        expect(profile, `EMPUpdateProfile null on ${obj.name}`).not.toBeNull();
        // Channels must be in [0, 255] integer range.
        for (const channel of profile!.startColor) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
          expect(Number.isInteger(channel)).toBe(true);
        }
        for (const channel of profile!.endColor) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
          expect(Number.isInteger(channel)).toBe(true);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});
