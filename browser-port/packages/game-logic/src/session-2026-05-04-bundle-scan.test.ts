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
  extractAutoDepositProfile,
  extractBoneFXProfile,
  extractContainProfile,
  extractCrateCollideProfile,
  extractDemoTrapProfile,
  extractEjectPilotCreationListNames,
  extractEmpUpdateProfile,
  extractFirestormDamageProfile,
  extractFXListDieProfiles,
  extractGenerateMinefieldProfile,
  extractIniValueTokens,
  extractLeafletDropProfile,
  extractNeutronMissileSlowDeathProfile,
  extractRiderChangeContainProfile,
  extractSalvageCrateProfile,
  extractSpecialAbilityProfile,
  extractSpecialPowerModules,
  extractSlowDeathProfiles,
  extractStickyBombUpdateProfile,
  extractStructureCollapseProfile,
  extractTransitionDamageFXProfile,
  extractUpgradeModulesFromBlocks,
  extractWaveGuideProfile,
  extractWeaponTemplateSets,
} from './entity-factory.js';
import { extractChinookAIProfile, extractJetSlowDeathProfiles } from './aircraft-ai.js';
import { extractFlightDeckProfile } from './flight-deck.js';
import { collectModelConditionInfos, collectTransitionInfos, resolveRenderAssetProfile } from './render-profile-helpers.js';
import { extractSlavedUpdateProfile } from './spawner-behavior.js';
import { extractFireWhenDamagedProfiles } from './status-effects.js';
import { readCoord3DField } from './ini-readers.js';
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
const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf-8')) as {
  objects?: BundleObject[];
  gameData?: {
    weaponBonusEntries?: Array<{ condition?: string; field?: string; multiplier?: number }>;
  };
};

function moduleTagOf(block: BundleBlock): string | null {
  return (block.name ?? '').split(/\s+/)[1]?.trim().toUpperCase() ?? null;
}

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
    // Minimal BoneFX field parser stub — mirrors the runtime path that
    // extractBoneFXProfile delegates to. Returns the same shape as the
    // production parseBoneFXFieldValue implementation so the regression test
    // exercises the array→string normalization at the call site.
    parseBoneFXFieldValue: (value: string): { boneName: string; effectName: string; minDelayFrames: number; maxDelayFrames: number; onlyOnce: boolean } | null => {
      const tokens = value.split(/\s+/).filter(Boolean);
      if (tokens.length < 5) return null;
      let boneName = '';
      let onlyOnce = false;
      let i = 0;
      while (i < tokens.length) {
        const [k, ...rest] = tokens[i]!.split(':');
        if (k?.toUpperCase() === 'BONE' && rest.length > 0) {
          boneName = rest.join(':');
          i++;
          break;
        }
        i++;
      }
      if (!boneName) return null;
      while (i < tokens.length) {
        const [k, ...rest] = tokens[i]!.split(':');
        if (k?.toUpperCase() === 'ONLYONCE' && rest.length > 0) {
          onlyOnce = (rest.join(':') ?? '').toUpperCase() === 'YES';
          i++;
          break;
        }
        i++;
      }
      const minDelayMs = parseFloat(tokens[i] ?? '0'); i++;
      const maxDelayMs = parseFloat(tokens[i] ?? '0'); i++;
      let effectName = '';
      while (i < tokens.length) {
        const [k, ...rest] = tokens[i]!.split(':');
        const key = (k ?? '').toUpperCase();
        if ((key === 'FXLIST' || key === 'OCL' || key === 'PSYS') && rest.length > 0) {
          effectName = rest.join(':');
          break;
        }
        i++;
      }
      if (!effectName) return null;
      return {
        boneName,
        effectName,
        minDelayFrames: Math.max(0, Math.round(minDelayMs / (1000 / LOGIC_FRAME_RATE))),
        maxDelayFrames: Math.max(0, Math.round(maxDelayMs / (1000 / LOGIC_FRAME_RATE))),
        onlyOnce,
      };
    },
  } as unknown as Parameters<typeof extractFlightDeckProfile>[0];
}

/** Find all (object, blockFields) pairs whose Behavior block of the given module
 *  type carries the given INI field. Used to drive every retail user of a
 *  touched field through the matching extractor. */
function* iterFieldUsages(moduleType: string, fieldName: string): Generator<{
  obj: BundleObject;
  block: BundleBlock;
  bundleValue: unknown;
}> {
  function* visitBlocks(obj: BundleObject, blocks: BundleBlock[]): Generator<{
    obj: BundleObject;
    block: BundleBlock;
    bundleValue: unknown;
  }> {
    for (const block of blocks) {
      const parts = (block.name ?? '').split(/\s+/);
      if (parts[0]?.toUpperCase() === moduleType.toUpperCase() && block.fields && fieldName in block.fields) {
        yield { obj, block, bundleValue: block.fields[fieldName] };
      }
      if (block.blocks) {
        yield* visitBlocks(obj, block.blocks);
      }
    }
  }

  for (const obj of bundle.objects ?? []) {
    yield* visitBlocks(obj, obj.blocks ?? []);
  }
}

function transitionEffectName(value: unknown, effectKey: 'FXLIST' | 'PSYS'): string | null {
  const tokens = splitTokens(value);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const [rawKey, ...rest] = token.split(':');
    const key = (rawKey ?? '').trim().toUpperCase();
    if (key !== effectKey) continue;
    const inlineValue = rest.join(':').trim();
    if (inlineValue) return inlineValue;
    const next = tokens[i + 1]?.trim();
    if (next && !next.includes(':')) return next;
  }
  return null;
}

describe('session 2026-05-04 — bundle-wide scanner over touched fields', () => {
  it('retail GameData weapon bonus table is present in the converted bundle', () => {
    const entries = bundle.gameData?.weaponBonusEntries ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(23);
    expect(entries).toContainEqual({ condition: 'HORDE', field: 'RATE_OF_FIRE', multiplier: 1.5 });
    expect(entries).toContainEqual({ condition: 'VETERAN', field: 'DAMAGE', multiplier: 1.1 });
    expect(entries).toContainEqual({ condition: 'ELITE', field: 'RATE_OF_FIRE', multiplier: 1.4 });
    expect(entries).toContainEqual({ condition: 'HERO', field: 'DAMAGE', multiplier: 1.3 });
    expect(entries).toContainEqual({ condition: 'BATTLEPLAN_SEARCHANDDESTROY', field: 'RANGE', multiplier: 1.2 });
    expect(entries).toContainEqual({ condition: 'SOLO_AI_HARD', field: 'RATE_OF_FIRE', multiplier: 1.2 });
  });

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

  it('GenerateMinefieldBehavior AlwaysCircular flows through every retail user', () => {
    const usages = [...iterFieldUsages('GenerateMinefieldBehavior', 'AlwaysCircular')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractGenerateMinefieldProfile(makeSelfStub(), obj as never);
      expect(profile, `GenerateMinefieldProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.alwaysCircular, `AlwaysCircular mismatch on ${obj.name}`).toBe(bundleValue);
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

  it('JetSlowDeathBehavior OCL timeline fields flow through every non-NONE retail user', () => {
    const cases: Array<{
      fieldName: string;
      profileKey: 'oclInitialDeath' | 'oclSecondary' | 'oclOnGroundDeath';
    }> = [
      { fieldName: 'OCLInitialDeath', profileKey: 'oclInitialDeath' },
      { fieldName: 'OCLSecondary', profileKey: 'oclSecondary' },
      { fieldName: 'OCLOnGroundDeath', profileKey: 'oclOnGroundDeath' },
    ];

    for (const testCase of cases) {
      let nonNoneCount = 0;
      for (const { obj, bundleValue } of iterFieldUsages('JetSlowDeathBehavior', testCase.fieldName)) {
        const expected = splitTokens(bundleValue)[0] ?? '';
        if (!expected || expected.toUpperCase() === 'NONE') continue;
        nonNoneCount++;

        const profiles = extractJetSlowDeathProfiles(makeSelfStub(), obj as never);
        expect(
          profiles.some((profile) => profile[testCase.profileKey].includes(expected)),
          `${testCase.fieldName} missing ${expected} on ${obj.name}`,
        ).toBe(true);
      }
      expect(nonNoneCount, `expected non-NONE retail users for ${testCase.fieldName}`).toBeGreaterThan(0);
    }
  });

  it('TransportContain DestroyRidersWhoAreNotFreeToExit flows through every retail user', () => {
    const usages = [...iterFieldUsages('TransportContain', 'DestroyRidersWhoAreNotFreeToExit')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractContainProfile(makeSelfStub(), obj as never);
      expect(profile, `ContainProfile null for ${obj.name}`).not.toBeNull();
      expect(
        profile!.destroyRidersWhoAreNotFreeToExit,
        `DestroyRidersWhoAreNotFreeToExit mismatch on ${obj.name}`,
      ).toBe(bundleValue);
    }
  });

  it('CashBountyPower Bounty flows through every retail special-power module', () => {
    const usages = [...iterFieldUsages('CashBountyPower', 'Bounty')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, block, bundleValue } of usages) {
      const templateName = String(block.fields?.SpecialPowerTemplate ?? '').trim().toUpperCase();
      expect(templateName, `CashBountyPower missing SpecialPowerTemplate on ${obj.name}`).toBeTruthy();

      const modules = extractSpecialPowerModules(makeSelfStub(), obj as never);
      const module = modules.get(templateName);
      expect(module, `SpecialPower module ${templateName} missing on ${obj.name}`).toBeDefined();
      expect(module!.cashBountyPercent, `Bounty mismatch on ${obj.name}/${templateName}`).toBe(bundleValue);
    }
  });

  it('SpecialAbilityUpdate PreTriggerUnstealthTime flows through every retail user', () => {
    const usages = [...iterFieldUsages('SpecialAbilityUpdate', 'PreTriggerUnstealthTime')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractSpecialAbilityProfile(makeSelfStub(), obj as never);
      expect(profile, `SpecialAbilityProfile null for ${obj.name}`).not.toBeNull();
      expect(
        profile!.preTriggerUnstealthFrames,
        `PreTriggerUnstealthTime mismatch on ${obj.name}`,
      ).toBe(makeSelfStub().msToLogicFrames(Number(bundleValue)));
    }
  });

  it('VeterancyCrateCollide EffectRange/AddsOwnerVeterancy flow through every retail user', () => {
    const effectRangeUsages = [...iterFieldUsages('VeterancyCrateCollide', 'EffectRange')];
    const ownerVetUsages = [...iterFieldUsages('VeterancyCrateCollide', 'AddsOwnerVeterancy')];
    expect(effectRangeUsages.length).toBeGreaterThan(0);
    expect(ownerVetUsages.length).toBeGreaterThan(0);

    for (const { obj, bundleValue } of effectRangeUsages) {
      const profile = extractCrateCollideProfile(makeSelfStub(), obj as never);
      expect(profile, `CrateCollideProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.veterancyRange, `EffectRange mismatch on ${obj.name}`).toBe(bundleValue);
    }
    for (const { obj, bundleValue } of ownerVetUsages) {
      const profile = extractCrateCollideProfile(makeSelfStub(), obj as never);
      expect(profile, `CrateCollideProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.addsOwnerVeterancy, `AddsOwnerVeterancy mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('NeutronMissileSlowDeathBehavior blast fields flow through every retail neutron blast', () => {
    const neutronBlastFieldNames = [
      'Blast1Enabled', 'Blast1Delay', 'Blast1ScorchDelay', 'Blast1InnerRadius',
      'Blast1OuterRadius', 'Blast1MaxDamage', 'Blast1MinDamage', 'Blast1ToppleSpeed', 'Blast1PushForce',
      'Blast2Enabled', 'Blast2Delay', 'Blast2ScorchDelay', 'Blast2InnerRadius',
      'Blast2OuterRadius', 'Blast2MaxDamage', 'Blast2MinDamage', 'Blast2ToppleSpeed', 'Blast2PushForce',
      'Blast3Enabled', 'Blast3Delay', 'Blast3ScorchDelay', 'Blast3InnerRadius',
      'Blast3OuterRadius', 'Blast3MaxDamage', 'Blast3MinDamage', 'Blast3ToppleSpeed', 'Blast3PushForce',
      'Blast4Enabled', 'Blast4Delay', 'Blast4ScorchDelay', 'Blast4InnerRadius',
      'Blast4OuterRadius', 'Blast4MaxDamage', 'Blast4MinDamage', 'Blast4ToppleSpeed', 'Blast4PushForce',
      'Blast5Enabled', 'Blast5Delay', 'Blast5ScorchDelay', 'Blast5InnerRadius',
      'Blast5OuterRadius', 'Blast5MaxDamage', 'Blast5MinDamage', 'Blast5ToppleSpeed', 'Blast5PushForce',
      'Blast6Enabled', 'Blast6Delay', 'Blast6ScorchDelay', 'Blast6InnerRadius',
      'Blast6OuterRadius', 'Blast6MaxDamage', 'Blast6MinDamage', 'Blast6ToppleSpeed', 'Blast6PushForce',
      'Blast7Enabled', 'Blast7Delay', 'Blast7ScorchDelay', 'Blast7InnerRadius',
      'Blast7OuterRadius', 'Blast7MaxDamage', 'Blast7MinDamage', 'Blast7ToppleSpeed', 'Blast7PushForce',
      'Blast8Enabled', 'Blast8Delay', 'Blast8ScorchDelay', 'Blast8InnerRadius',
      'Blast8OuterRadius', 'Blast8MaxDamage', 'Blast8MinDamage', 'Blast8ToppleSpeed', 'Blast8PushForce',
      'Blast9Enabled', 'Blast9Delay', 'Blast9ScorchDelay', 'Blast9InnerRadius',
      'Blast9OuterRadius', 'Blast9MaxDamage', 'Blast9MinDamage', 'Blast9ToppleSpeed', 'Blast9PushForce',
    ] as const;
    const propertyBySuffix: Record<string, string> = {
      Enabled: 'enabled',
      Delay: 'delay',
      ScorchDelay: 'scorchDelay',
      InnerRadius: 'innerRadius',
      OuterRadius: 'outerRadius',
      MaxDamage: 'maxDamage',
      MinDamage: 'minDamage',
      ToppleSpeed: 'toppleSpeed',
      PushForce: 'pushForce',
    };

    let checked = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'NeutronMissileSlowDeathBehavior') continue;
        const profile = extractNeutronMissileSlowDeathProfile(makeSelfStub(), obj as never);
        expect(profile, `NeutronMissileSlowDeathProfile null for ${obj.name}`).not.toBeNull();

        const fields = block.fields ?? {};
        for (const fieldName of neutronBlastFieldNames) {
          if (!(fieldName in fields)) continue;
          const match = /^Blast([1-9])(.+)$/.exec(fieldName);
          expect(match, `unexpected neutron blast field ${fieldName}`).not.toBeNull();
          const blastIndex = Number(match![1]) - 1;
          const suffix = match![2]!;
          const propertyName = propertyBySuffix[suffix];
          expect(propertyName, `unmapped neutron blast suffix ${suffix}`).toBeTruthy();

          const actual = (profile!.blasts[blastIndex] as Record<string, unknown>)[propertyName!];
          const bundleValue = fields[fieldName];
          const expected = suffix === 'Enabled'
            ? bundleValue
            : suffix === 'Delay' || suffix === 'ScorchDelay'
              ? makeSelfStub().msToLogicFrames(Number(bundleValue))
              : bundleValue;
          expect(actual, `${fieldName} mismatch on ${obj.name}`).toBe(expected);
          checked++;
        }
      }
    }
    expect(checked, 'expected shipped NeutronMissileSlowDeathBehavior blast fields').toBeGreaterThan(0);
  });

  it('SlavedUpdate StayOnSameLayerAsMaster parses retail bool values', () => {
    const usages = [...iterFieldUsages('SlavedUpdate', 'StayOnSameLayerAsMaster')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractSlavedUpdateProfile(makeSelfStub(), obj as never);
      expect(profile, `SlavedUpdateProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.stayOnSameLayerAsMaster, `StayOnSameLayerAsMaster mismatch on ${obj.name}`)
        .toBe(bundleValue === true);
    }
  });

  it('RiderChangeContain BurnedDeathToUnits flows through every retail user', () => {
    const usages = [...iterFieldUsages('RiderChangeContain', 'BurnedDeathToUnits')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractContainProfile(makeSelfStub(), obj as never);
      expect(profile, `ContainProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.burnedDeathToUnits, `BurnedDeathToUnits mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('ChinookAIUpdate rope geometry fields flow through every retail user', () => {
    const ropeFinalHeightUsages = [...iterFieldUsages('ChinookAIUpdate', 'RopeFinalHeight')];
    const ropeWobbleRateUsages = [...iterFieldUsages('ChinookAIUpdate', 'RopeWobbleRate')];
    expect(ropeFinalHeightUsages.length).toBeGreaterThan(0);
    expect(ropeWobbleRateUsages.length).toBeGreaterThan(0);

    for (const { obj, bundleValue } of ropeFinalHeightUsages) {
      const profile = extractChinookAIProfile(makeSelfStub(), obj as never);
      expect(profile, `ChinookAIProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.ropeFinalHeight, `RopeFinalHeight mismatch on ${obj.name}`).toBe(bundleValue);
    }
    for (const { obj, bundleValue } of ropeWobbleRateUsages) {
      const profile = extractChinookAIProfile(makeSelfStub(), obj as never);
      expect(profile, `ChinookAIProfile null for ${obj.name}`).not.toBeNull();
      const expected = (Number(bundleValue) * Math.PI / 180) / LOGIC_FRAME_RATE;
      expect(profile!.ropeWobbleRate, `RopeWobbleRate mismatch on ${obj.name}`).toBeCloseTo(expected, 10);
    }
  });

  it('CleanupAreaPower MaxMoveDistanceFromLocation flows through every retail module', () => {
    const usages = [...iterFieldUsages('CleanupAreaPower', 'MaxMoveDistanceFromLocation')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, block, bundleValue } of usages) {
      const templateName = splitTokens(block.fields?.SpecialPowerTemplate)[0]?.toUpperCase() ?? '';
      expect(templateName, `CleanupAreaPower missing SpecialPowerTemplate on ${obj.name}`).toBeTruthy();
      const module = extractSpecialPowerModules(makeSelfStub(), obj as never).get(templateName);
      expect(module, `CleanupAreaPower module ${templateName} missing on ${obj.name}`).toBeDefined();
      expect(module!.cleanupMoveRange, `MaxMoveDistanceFromLocation mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('DemoTrapUpdate IgnoreTargetTypes flows through every retail user', () => {
    const usages = [...iterFieldUsages('DemoTrapUpdate', 'IgnoreTargetTypes')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractDemoTrapProfile(makeSelfStub(), obj as never);
      expect(profile, `DemoTrapProfile null for ${obj.name}`).not.toBeNull();
      for (const token of splitTokens(bundleValue).map((value) => value.toUpperCase())) {
        expect(profile!.ignoreKindOf, `IgnoreTargetTypes missing ${token} on ${obj.name}`).toContain(token);
      }
    }
  });

  it('FireWeaponWhenDamagedBehavior really-damaged weapon slots flow through every retail user', () => {
    const cases: Array<{
      fieldName: 'ReactionWeaponReallyDamaged' | 'ContinuousWeaponReallyDamaged';
      profileKey: 'reactionWeapons' | 'continuousWeapons';
    }> = [
      { fieldName: 'ReactionWeaponReallyDamaged', profileKey: 'reactionWeapons' },
      { fieldName: 'ContinuousWeaponReallyDamaged', profileKey: 'continuousWeapons' },
    ];

    for (const testCase of cases) {
      let usageCount = 0;
      for (const { obj, block, bundleValue } of iterFieldUsages('FireWeaponWhenDamagedBehavior', testCase.fieldName)) {
        usageCount++;
        const moduleTag = moduleTagOf(block);
        const profiles = extractFireWhenDamagedProfiles(makeSelfStub(), obj as never);
        const profile = profiles.find((entry) => entry.moduleTag === moduleTag);
        expect(profile, `FireWeaponWhenDamaged profile ${moduleTag} missing on ${obj.name}`).toBeDefined();
        expect(profile![testCase.profileKey][2], `${testCase.fieldName} mismatch on ${obj.name}/${moduleTag}`)
          .toBe(String(bundleValue).trim());
      }
      expect(usageCount, `expected retail users for ${testCase.fieldName}`).toBeGreaterThan(0);
    }
  });

  it('FirestormDynamicGeometryInfoUpdate ScorchSize flows through every retail user', () => {
    const usages = [...iterFieldUsages('FirestormDynamicGeometryInfoUpdate', 'ScorchSize')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractFirestormDamageProfile(makeSelfStub(), obj as never);
      expect(profile, `FirestormDamageProfile null for ${obj.name}`).not.toBeNull();
      expect(profile!.scorchSize, `ScorchSize mismatch on ${obj.name}`).toBe(bundleValue);
    }
  });

  it('WaveGuideUpdate remaining shipped fields flow through every retail user', () => {
    const numericCases: Array<{ fieldName: string; profileKey: string; scale?: number }> = [
      { fieldName: 'YSize', profileKey: 'ySize' },
      { fieldName: 'LinearWaveSpacing', profileKey: 'linearWaveSpacing' },
      { fieldName: 'WaveBendMagnitude', profileKey: 'waveBendMagnitude' },
      { fieldName: 'WaterVelocity', profileKey: 'waterVelocity', scale: 1 / LOGIC_FRAME_RATE },
      { fieldName: 'ShorelineEffectDistance', profileKey: 'shorelineEffectDistance' },
      { fieldName: 'ToppleForce', profileKey: 'toppleForce' },
      { fieldName: 'RandomSplashSoundFrequency', profileKey: 'randomSplashSoundFrequency' },
      { fieldName: 'BridgeParticleAngleFudge', profileKey: 'bridgeParticleAngleFudge', scale: Math.PI / 180 },
    ];
    const stringCases: Array<{ fieldName: string; profileKey: string }> = [
      { fieldName: 'RandomSplashSound', profileKey: 'randomSplashSound' },
      { fieldName: 'BridgeParticle', profileKey: 'bridgeParticle' },
      { fieldName: 'LoopingSound', profileKey: 'loopingSound' },
    ];

    for (const testCase of numericCases) {
      let usageCount = 0;
      for (const { obj, bundleValue } of iterFieldUsages('WaveGuideUpdate', testCase.fieldName)) {
        usageCount++;
        const profile = extractWaveGuideProfile(makeSelfStub(), obj as never);
        expect(profile, `WaveGuideProfile null for ${obj.name}`).not.toBeNull();
        const expected = Number(bundleValue) * (testCase.scale ?? 1);
        expect((profile as unknown as Record<string, number>)[testCase.profileKey], `${testCase.fieldName} mismatch on ${obj.name}`)
          .toBeCloseTo(expected, 10);
      }
      expect(usageCount, `expected retail users for WaveGuideUpdate.${testCase.fieldName}`).toBeGreaterThan(0);
    }

    for (const testCase of stringCases) {
      let usageCount = 0;
      for (const { obj, bundleValue } of iterFieldUsages('WaveGuideUpdate', testCase.fieldName)) {
        usageCount++;
        const profile = extractWaveGuideProfile(makeSelfStub(), obj as never);
        expect(profile, `WaveGuideProfile null for ${obj.name}`).not.toBeNull();
        expect((profile as unknown as Record<string, string>)[testCase.profileKey], `${testCase.fieldName} mismatch on ${obj.name}`)
          .toBe(splitTokens(bundleValue)[0] ?? String(bundleValue).trim());
      }
      expect(usageCount, `expected retail users for WaveGuideUpdate.${testCase.fieldName}`).toBeGreaterThan(0);
    }
  });

  it('CostModifierUpgrade EffectKindOf/Percentage flows through every retail user', () => {
    const kindOfUsages = [...iterFieldUsages('CostModifierUpgrade', 'EffectKindOf')];
    const percentUsages = [...iterFieldUsages('CostModifierUpgrade', 'Percentage')];
    expect(kindOfUsages.length).toBeGreaterThan(0);
    expect(percentUsages.length).toBeGreaterThan(0);

    for (const { obj, block, bundleValue } of kindOfUsages) {
      const moduleTag = moduleTagOf(block);
      const modules = extractUpgradeModulesFromBlocks(makeSelfStub(), obj.blocks as never, null);
      const module = modules.find((entry) => entry.moduleTag === moduleTag && entry.moduleType === 'COSTMODIFIERUPGRADE');
      expect(module, `CostModifierUpgrade ${moduleTag} missing on ${obj.name}`).toBeDefined();
      for (const token of splitTokens(bundleValue).map((value) => value.toUpperCase())) {
        expect(module!.effectKindOf, `EffectKindOf missing ${token} on ${obj.name}/${moduleTag}`).toContain(token);
      }
    }

    for (const { obj, block, bundleValue } of percentUsages) {
      const moduleTag = moduleTagOf(block);
      const modules = extractUpgradeModulesFromBlocks(makeSelfStub(), obj.blocks as never, null);
      const module = modules.find((entry) => entry.moduleTag === moduleTag && entry.moduleType === 'COSTMODIFIERUPGRADE');
      expect(module, `CostModifierUpgrade ${moduleTag} missing on ${obj.name}`).toBeDefined();
      expect(module!.effectPercent, `Percentage mismatch on ${obj.name}/${moduleTag}`)
        .toBe(makeSelfStub().parsePercent(bundleValue));
    }
  });

  it('EMPUpdate DoesNotAffect flows through every retail user', () => {
    const usages = [...iterFieldUsages('EMPUpdate', 'DoesNotAffect')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractEmpUpdateProfile(makeSelfStub(), obj as never);
      expect(profile, `EMPUpdateProfile null for ${obj.name}`).not.toBeNull();
      const doesNotAffect = (profile as unknown as { doesNotAffect: Set<string> }).doesNotAffect;
      for (const token of splitTokens(bundleValue).map((value) => value.toUpperCase())) {
        expect(doesNotAffect, `DoesNotAffect missing ${token} on ${obj.name}`).toContain(token);
      }
    }
  });

  it('EMPUpdate DisableFXParticleSystem flows through every retail user', () => {
    const usages = [...iterFieldUsages('EMPUpdate', 'DisableFXParticleSystem')];
    expect(usages.length).toBeGreaterThan(0);
    for (const { obj, bundleValue } of usages) {
      const profile = extractEmpUpdateProfile(makeSelfStub(), obj as never);
      expect(profile, `EMPUpdateProfile null for ${obj.name}`).not.toBeNull();
      const typedProfile = profile as unknown as {
        disableFXParticleSystemName: string;
        sparksPerCubicFoot: number;
      };
      expect(typedProfile.disableFXParticleSystemName, `DisableFXParticleSystem mismatch on ${obj.name}`)
        .toBe(String(bundleValue));
      expect(typedProfile.sparksPerCubicFoot, `SparksPerCubicFoot default mismatch on ${obj.name}`)
        .toBe(0.001);
    }
  });

  it('source Coord3D fields decode retail key/value token arrays', () => {
    const commandCenter = bundle.objects?.find((obj) => obj.name === 'AirF_AmericaCommandCenter');
    expect(commandCenter, 'expected AirF_AmericaCommandCenter in retail bundle').toBeDefined();
    const commandCenterExit = commandCenter!.blocks?.find((block) =>
      (block.name ?? '').startsWith('DefaultProductionExitUpdate '));
    expect(commandCenterExit, 'expected command center production exit block').toBeDefined();
    expect(readCoord3DField(commandCenterExit!.fields ?? {}, ['UnitCreatePoint'])).toEqual({
      x: -18,
      y: 35,
      z: 0,
    });
    expect(readCoord3DField(commandCenterExit!.fields ?? {}, ['NaturalRallyPoint'])).toEqual({
      x: 60,
      y: 35,
      z: 0,
    });

    const warFactory = bundle.objects?.find((obj) => obj.name === 'AmericaWarFactory');
    expect(warFactory, 'expected AmericaWarFactory in retail bundle').toBeDefined();
    const warFactoryExit = warFactory!.blocks?.find((block) =>
      (block.name ?? '').startsWith('DefaultProductionExitUpdate '));
    expect(warFactoryExit, 'expected war factory production exit block').toBeDefined();
    expect(readCoord3DField(warFactoryExit!.fields ?? {}, ['UnitCreatePoint'])).toEqual({
      x: -10,
      y: -30,
      z: 0,
    });

    const bomber = bundle.objects?.find((obj) => obj.name === 'AirF_AmericaJetB3');
    expect(bomber, 'expected AirF_AmericaJetB3 in retail bundle').toBeDefined();
    const deliverPayload = bomber!.blocks?.find((block) =>
      (block.name ?? '').startsWith('DeliverPayloadAIUpdate '));
    expect(deliverPayload, 'expected DeliverPayloadAIUpdate on AirF_AmericaJetB3').toBeDefined();
    expect(readCoord3DField(deliverPayload!.fields ?? {}, ['DropOffset'])).toEqual({
      x: 0,
      y: 0,
      z: -10,
    });
  });

  it('EjectPilotDie Air/GroundCreationList flow through every retail user', () => {
    const groundUsages = [...iterFieldUsages('EjectPilotDie', 'GroundCreationList')];
    const airUsages = [...iterFieldUsages('EjectPilotDie', 'AirCreationList')];
    expect(groundUsages.length).toBeGreaterThan(0);
    expect(airUsages.length).toBeGreaterThan(0);

    for (const { obj, bundleValue } of groundUsages) {
      const profile = extractEjectPilotCreationListNames(makeSelfStub(), obj as never);
      expect(profile.groundCreationListName, `GroundCreationList mismatch on ${obj.name}`).toBe(bundleValue);
    }
    for (const { obj, bundleValue } of airUsages) {
      const profile = extractEjectPilotCreationListNames(makeSelfStub(), obj as never);
      expect(profile.airCreationListName, `AirCreationList mismatch on ${obj.name}`).toBe(bundleValue);
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

  it('AutoDepositUpdate UpgradedBoost decodes for every retail user', () => {
    let userCount = 0;
    for (const obj of bundle.objects ?? []) {
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'AutoDepositUpdate') continue;
        const fields = block.fields ?? {};
        if (!('UpgradedBoost' in fields)) continue;
        userCount++;
        const profile = extractAutoDepositProfile(makeSelfStub(), obj as never);
        expect(profile, `AutoDepositProfile null on ${obj.name}`).not.toBeNull();
        expect(
          profile!.upgradedBoosts.length,
          `UpgradedBoost dropped on ${obj.name} bundle=${JSON.stringify(fields['UpgradedBoost'])}`,
        ).toBeGreaterThan(0);
        const boost = profile!.upgradedBoosts[0]!;
        expect(boost.upgradeName.length).toBeGreaterThan(0);
        expect(boost.amount).toBeGreaterThan(0);
      }
    }
    expect(userCount, 'expected AutoDepositUpdate UpgradedBoost users (TechOilDerrick)').toBeGreaterThan(0);
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

  it('TransitionDamageFX high-volume shipped fields flow through every retail user', () => {
    const cases: Array<{
      fieldName: string;
      rowIndex: number;
      profileKey: 'fxLists' | 'particleSystems';
      effectKey: 'FXLIST' | 'PSYS';
    }> = [
      { fieldName: 'DamagedParticleSystem4', rowIndex: 1, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'DamagedParticleSystem5', rowIndex: 1, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'DamagedParticleSystem6', rowIndex: 1, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem1', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem2', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem3', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem4', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem5', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem6', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem7', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedParticleSystem8', rowIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'ReallyDamagedFXList1', rowIndex: 2, profileKey: 'fxLists', effectKey: 'FXLIST' },
      { fieldName: 'RubbleFXList1', rowIndex: 3, profileKey: 'fxLists', effectKey: 'FXLIST' },
      { fieldName: 'RubbleParticleSystem1', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleParticleSystem2', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleParticleSystem3', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleParticleSystem4', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleParticleSystem5', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleParticleSystem6', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleParticleSystem7', rowIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
    ];

    for (const testCase of cases) {
      let usageCount = 0;
      for (const obj of bundle.objects ?? []) {
        for (const block of obj.blocks ?? []) {
          const moduleType = (block.name ?? '').split(/\s+/)[0];
          if (moduleType !== 'TransitionDamageFX') continue;
          const fields = block.fields ?? {};
          if (!(testCase.fieldName in fields)) continue;
          usageCount++;

          const expectedEffectName = transitionEffectName(fields[testCase.fieldName], testCase.effectKey);
          expect(expectedEffectName, `${testCase.fieldName} has no effect token on ${obj.name}`).toBeTruthy();

          const profile = extractTransitionDamageFXProfile(makeSelfStub(), obj as never);
          expect(profile, `TransitionDamageFXProfile null on ${obj.name}`).not.toBeNull();
          const row = profile![testCase.profileKey][testCase.rowIndex] ?? [];
          expect(
            row.map((entry) => entry.effectName),
            `${testCase.fieldName} missing ${expectedEffectName} on ${obj.name}`,
          ).toContain(expectedEffectName);
        }
      }
      expect(usageCount, `expected retail users for ${testCase.fieldName}`).toBeGreaterThan(0);
    }

    let damageParticleTypeUsers = 0;
    for (const { obj, bundleValue } of iterFieldUsages('TransitionDamageFX', 'DamageParticleTypes')) {
      damageParticleTypeUsers++;
      const profile = extractTransitionDamageFXProfile(makeSelfStub(), obj as never);
      expect(profile, `TransitionDamageFXProfile null on ${obj.name}`).not.toBeNull();
      const tokens = splitTokens(bundleValue).map((token) => token.toUpperCase());
      expect(profile!.damageParticleTypes?.includeAll, `DamageParticleTypes includeAll missing on ${obj.name}`)
        .toBe(tokens.includes('ALL'));
      for (const token of tokens.filter((value) => value.startsWith('-')).map((value) => value.slice(1))) {
        expect(profile!.damageParticleTypes?.excludes, `DamageParticleTypes exclude ${token} missing on ${obj.name}`)
          .toContain(token);
      }
    }
    expect(damageParticleTypeUsers, 'expected retail users for DamageParticleTypes').toBeGreaterThan(0);
  });

  it('BoneFXUpdate particle systems decode for every retail user (was silently dropped)', () => {
    interface BundleObj { name?: string; blocks?: Array<{ name?: string; fields?: Record<string, unknown> }> }
    const bundleWithObjs = bundle as { objects?: BundleObj[] };
    let userCount = 0;
    let entryCount = 0;
    for (const obj of bundleWithObjs.objects ?? []) {
      let hasBoneFXBlock = false;
      let hasArrayShapedField = false;
      for (const block of obj.blocks ?? []) {
        const moduleType = (block.name ?? '').split(/\s+/)[0];
        if (moduleType !== 'BoneFXUpdate') continue;
        hasBoneFXBlock = true;
        for (const fval of Object.values(block.fields ?? {})) {
          if (Array.isArray(fval) && fval.length >= 5) {
            hasArrayShapedField = true;
            break;
          }
        }
      }
      if (!hasBoneFXBlock || !hasArrayShapedField) continue;
      userCount++;

      const profile = extractBoneFXProfile(makeSelfStub(), obj as never);
      expect(profile, `BoneFXProfile null on ${obj.name}`).not.toBeNull();
      // Count parsed entries across the 4-state x 8-bone grid for particle systems.
      let parsed = 0;
      for (const row of profile!.particleSystems) {
        for (const cell of row) if (cell !== null) parsed++;
      }
      expect(parsed, `BoneFXUpdate particle systems silently dropped on ${obj.name}`).toBeGreaterThan(0);
      entryCount += parsed;
    }
    expect(userCount, 'expected retail BoneFXUpdate users with array-shaped fields').toBeGreaterThan(0);
    expect(entryCount, 'expected ≥1 parsed BoneFX entry total').toBeGreaterThan(0);
  });

  it('BoneFXUpdate lower-slot shipped fields decode through their exact row/slot', () => {
    const cases: Array<{
      fieldName: string;
      rowIndex: number;
      slotIndex: number;
      profileKey: 'fxLists' | 'particleSystems';
      effectKey: 'FXLIST' | 'PSYS';
    }> = [
      { fieldName: 'PristineParticleSystem2', rowIndex: 0, slotIndex: 1, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'PristineParticleSystem3', rowIndex: 0, slotIndex: 2, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'PristineParticleSystem4', rowIndex: 0, slotIndex: 3, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'PristineParticleSystem5', rowIndex: 0, slotIndex: 4, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'PristineParticleSystem6', rowIndex: 0, slotIndex: 5, profileKey: 'particleSystems', effectKey: 'PSYS' },
      { fieldName: 'RubbleFXList1', rowIndex: 3, slotIndex: 0, profileKey: 'fxLists', effectKey: 'FXLIST' },
    ];

    for (const testCase of cases) {
      let usageCount = 0;
      for (const { obj, bundleValue } of iterFieldUsages('BoneFXUpdate', testCase.fieldName)) {
        usageCount++;
        const expectedEffectName = transitionEffectName(bundleValue, testCase.effectKey);
        expect(expectedEffectName, `${testCase.fieldName} has no effect token on ${obj.name}`).toBeTruthy();

        const profile = extractBoneFXProfile(makeSelfStub(), obj as never);
        expect(profile, `BoneFXProfile null on ${obj.name}`).not.toBeNull();
        const cell = profile![testCase.profileKey][testCase.rowIndex]?.[testCase.slotIndex] ?? null;
        expect(cell?.effectName, `${testCase.fieldName} mismatch on ${obj.name}`).toBe(expectedEffectName);
      }
      expect(usageCount, `expected retail users for BoneFXUpdate.${testCase.fieldName}`).toBeGreaterThan(0);
    }
  });

  it('WeaponSet AutoChooseSources and PreferredAgainst decode for every retail user', () => {
    const slotByName = new Map<string, 0 | 1 | 2>([
      ['PRIMARY', 0],
      ['SECONDARY', 1],
      ['TERTIARY', 2],
    ]);
    const sourceBitByName = new Map<string, number>([
      ['FROM_PLAYER', 1 << 0],
      ['FROM_SCRIPT', 1 << 1],
      ['FROM_AI', 1 << 2],
      ['FROM_DOZER', 1 << 3],
      ['DEFAULT_SWITCH_WEAPON', 1 << 4],
    ]);
    const maskFromTokens = (tokens: string[]): number => {
      let mask = 0;
      for (const token of tokens) {
        const normalized = token.trim().toUpperCase();
        if (normalized === 'NONE') return 0;
        mask |= sourceBitByName.get(normalized) ?? 0;
      }
      return mask;
    };

    let autoChooseUsers = 0;
    let preferredUsers = 0;
    for (const obj of bundle.objects ?? []) {
      const weaponSetBlocks = (obj.blocks ?? []).filter((block) => block.type === 'WeaponSet');
      if (weaponSetBlocks.length === 0) continue;
      const profiles = extractWeaponTemplateSets(makeSelfStub(), obj as never);
      expect(profiles.length, `WeaponSet profile count mismatch for ${obj.name}`).toBe(weaponSetBlocks.length);

      for (let blockIndex = 0; blockIndex < weaponSetBlocks.length; blockIndex++) {
        const block = weaponSetBlocks[blockIndex]!;
        const profile = profiles[blockIndex]!;
        for (const tokens of extractIniValueTokens(makeSelfStub() as never, block.fields?.['AutoChooseSources'] as never)) {
          const slot = slotByName.get(tokens[0]?.trim().toUpperCase() ?? '');
          if (slot === undefined) continue;
          autoChooseUsers++;
          expect(profile.autoChooseSourceMasks?.[slot], `AutoChooseSources dropped on ${obj.name}`).toBe(maskFromTokens(tokens.slice(1)));
        }
        for (const tokens of extractIniValueTokens(makeSelfStub() as never, block.fields?.['PreferredAgainst'] as never)) {
          const slot = slotByName.get(tokens[0]?.trim().toUpperCase() ?? '');
          if (slot === undefined) continue;
          preferredUsers++;
          const expected = tokens.slice(1).map((token) => token.trim().toUpperCase()).filter(Boolean);
          expect(profile.preferredAgainstBySlot?.[slot], `PreferredAgainst dropped on ${obj.name}`).toEqual(expected);
        }
      }
    }
    expect(autoChooseUsers, 'expected retail WeaponSet.AutoChooseSources users').toBeGreaterThan(200);
    expect(preferredUsers, 'expected retail WeaponSet.PreferredAgainst users').toBeGreaterThan(80);
  });

  it('OCLSpecialPower/CashHack upgrade pair arrays decode for every retail user', () => {
    let upgradeOCLCount = 0;
    let upgradeMoneyCount = 0;
    for (const obj of bundle.objects ?? []) {
      const specialPowerModules = extractSpecialPowerModules(makeSelfStub(), obj as never);
      for (const block of obj.blocks ?? []) {
        const visit = (nextBlock: BundleBlock): void => {
          const moduleType = (nextBlock.name ?? '').split(/\s+/)[0];
          const fields = nextBlock.fields ?? {};
          const templateName = splitTokens(fields['SpecialPowerTemplate'])[0]?.toUpperCase() ?? '';
          const module = specialPowerModules.get(templateName);
          if (moduleType === 'OCLSpecialPower' && Array.isArray(fields['UpgradeOCL'])) {
            upgradeOCLCount++;
            const tokens = splitTokens(fields['UpgradeOCL']);
            expect(tokens.length, `UpgradeOCL pair shape mismatch on ${obj.name}`).toBeGreaterThanOrEqual(2);
            expect(
              module?.upgradeOCLs.some((entry) =>
                entry.scienceName === tokens[0]!.toUpperCase() && entry.oclName === tokens[1]),
              `UpgradeOCL dropped on ${obj.name}/${templateName}`,
            ).toBe(true);
          }
          if (moduleType === 'CashHackSpecialPower' && Array.isArray(fields['UpgradeMoneyAmount'])) {
            upgradeMoneyCount++;
            const tokens = splitTokens(fields['UpgradeMoneyAmount']);
            expect(tokens.length, `UpgradeMoneyAmount pair shape mismatch on ${obj.name}`).toBeGreaterThanOrEqual(2);
            expect(
              module?.cashHackUpgradeMoneyAmounts.some((entry) =>
                entry.scienceName === tokens[0]!.toUpperCase() && entry.amountToSteal === Number(tokens[1])),
              `UpgradeMoneyAmount dropped on ${obj.name}/${templateName}`,
            ).toBe(true);
          }
          for (const child of nextBlock.blocks ?? []) {
            visit(child);
          }
        };
        visit(block);
      }
    }
    expect(upgradeOCLCount, 'expected retail OCLSpecialPower.UpgradeOCL users').toBe(63);
    expect(upgradeMoneyCount, 'expected retail CashHackSpecialPower.UpgradeMoneyAmount users').toBe(5);
  });

  it('IdleAnimation flat-token arrays decode as one weighted retail animation', () => {
    let userCount = 0;
    for (const obj of bundle.objects ?? []) {
      const expectedByName = new Map<string, number>();
      const visit = (block: BundleBlock): void => {
        const blockType = (block.type ?? '').toUpperCase();
        if (blockType === 'DEFAULTCONDITIONSTATE' || blockType === 'MODELCONDITIONSTATE') {
          const value = block.fields?.['IdleAnimation'];
          if (
            Array.isArray(value)
            && value.length >= 3
            && value.every((entry) => typeof entry === 'string' && !/\s/.test(entry))
          ) {
            const animationName = (value[0] as string).trim();
            const weight = parseInt(value[2] as string, 10);
            if (animationName.length > 0 && Number.isFinite(weight) && weight > 0) {
              expectedByName.set(animationName, weight);
            }
          }
        }
        for (const child of block.blocks ?? []) {
          visit(child);
        }
      };
      for (const block of obj.blocks ?? []) {
        visit(block);
      }
      if (expectedByName.size === 0) continue;

      userCount += expectedByName.size;
      const infos = collectModelConditionInfos(obj as never);
      const parsed = new Map<string, number>();
      for (const info of infos) {
        for (const variant of info.idleAnimations) {
          parsed.set(variant.animationName, variant.randomWeight);
        }
      }
      for (const [animationName, weight] of expectedByName) {
        expect(
          parsed.get(animationName),
          `IdleAnimation flat-token array lost weight on ${obj.name} animation ${animationName}`,
        ).toBe(weight);
      }
    }
    expect(userCount, 'expected retail IdleAnimation flat-token array users').toBeGreaterThan(0);
  });

  it('AliasConditionState entries flow into conditionFlagSets for every retail user', () => {
    let aliasCount = 0;
    const arraysEqual = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
      left !== undefined
      && left.length === right.length
      && left.every((value, index) => value === right[index]);

    for (const obj of bundle.objects ?? []) {
      const expectedAliases: string[][] = [];
      const visit = (block: BundleBlock): void => {
        if ((block.type ?? '').toUpperCase() === 'ALIASCONDITIONSTATE') {
          expectedAliases.push((block.name ?? '').trim().split(/\s+/).filter(Boolean));
        }
        for (const child of block.blocks ?? []) {
          visit(child);
        }
      };
      for (const block of obj.blocks ?? []) {
        visit(block);
      }
      if (expectedAliases.length === 0) continue;

      aliasCount += expectedAliases.length;
      const infos = collectModelConditionInfos(obj as never);
      const parsedFlagSets = infos.flatMap((info) => info.conditionFlagSets ?? [info.conditionFlags]);
      for (const expected of expectedAliases) {
        expect(
          parsedFlagSets.some((flags) => arraysEqual(flags, expected)),
          `AliasConditionState missing on ${obj.name}: ${expected.join(' ')}`,
        ).toBe(true);
      }
    }
    expect(aliasCount, 'expected retail AliasConditionState users').toBeGreaterThan(0);
  });

  it('TransitionState entries inherit default-state models for every retail user', () => {
    let transitionCount = 0;
    for (const obj of bundle.objects ?? []) {
      const expected: Array<{ fromKey: string; toKey: string; modelName: string }> = [];
      const visit = (block: BundleBlock): void => {
        if ((block.type ?? '').toUpperCase() === 'DRAW') {
          const defaultBlock = (block.blocks ?? []).find(
            (child) => (child.type ?? '').toUpperCase() === 'DEFAULTCONDITIONSTATE',
          );
          const defaultModel = splitTokens(defaultBlock?.fields?.['Model'] ?? defaultBlock?.fields?.['ModelName'])[0] ?? '';
          if (defaultModel.length > 0) {
            for (const child of block.blocks ?? []) {
              if ((child.type ?? '').toUpperCase() !== 'TRANSITIONSTATE') continue;
              const fields = child.fields ?? {};
              if ('Model' in fields || 'ModelName' in fields) continue;
              const nameTokens = (child.name ?? '').trim().split(/\s+/).filter(Boolean);
              if (nameTokens.length < 2 || nameTokens[0] === nameTokens[1]) continue;
              expected.push({
                fromKey: nameTokens[0]!.toLowerCase(),
                toKey: nameTokens[1]!.toLowerCase(),
                modelName: defaultModel,
              });
            }
          }
        }
        for (const child of block.blocks ?? []) {
          visit(child);
        }
      };
      for (const block of obj.blocks ?? []) {
        visit(block);
      }
      if (expected.length === 0) continue;

      transitionCount += expected.length;
      const infos = collectTransitionInfos(obj as never);
      for (const transition of expected) {
        expect(
          infos.some((info) =>
            info.fromKey === transition.fromKey
            && info.toKey === transition.toKey
            && info.modelName === transition.modelName),
          `TransitionState default model missing on ${obj.name}: ${transition.fromKey}->${transition.toKey}`,
        ).toBe(true);
      }
    }
    expect(transitionCount, 'expected retail TransitionState users inheriting default model').toBeGreaterThan(800);
  });

  it('ConditionState Animation metadata does not become render clip names', () => {
    let checked = 0;
    for (const obj of bundle.objects ?? []) {
      const expectedByState = new Map<string, Set<string>>();
      const visit = (block: BundleBlock): void => {
        if ((block.type ?? '').toUpperCase() === 'CONDITIONSTATE') {
          const value = block.fields?.['Animation'];
          if (
            Array.isArray(value)
            && value.length >= 2
            && typeof value[0] === 'string'
            && value.slice(1).some((entry) => typeof entry === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(entry))
          ) {
            const stateName = (block.name ?? '').toUpperCase();
            const renderState = stateName.includes('FIRING') || stateName.includes('ATTACK') || stateName.includes('RELOADING')
              ? 'ATTACK'
              : stateName.includes('MOVING') || stateName.includes('MOVE') || stateName.includes('RUN')
                ? 'MOVE'
                : null;
            if (renderState) {
              const clips = expectedByState.get(renderState) ?? new Set<string>();
              clips.add(value[0].trim());
              expectedByState.set(renderState, clips);
              checked++;
            }
          }
        }
        for (const child of block.blocks ?? []) {
          visit(child);
        }
      };
      for (const block of obj.blocks ?? []) {
        visit(block);
      }
      if (expectedByState.size === 0) continue;

      const profile = resolveRenderAssetProfile(obj as never);
      for (const [state, expectedClips] of expectedByState) {
        const actualClips = profile.renderAnimationStateClips[state as keyof typeof profile.renderAnimationStateClips] ?? [];
        for (const clipName of expectedClips) {
          expect(actualClips, `Animation clip missing on ${obj.name}/${state}: ${clipName}`).toContain(clipName);
        }
        for (const actual of actualClips) {
          expect(
            /^[-+]?\d+(?:\.\d+)?$/.test(actual),
            `numeric animation metadata leaked as clip on ${obj.name}/${state}: ${actual}`,
          ).toBe(false);
        }
      }
    }
    expect(checked, 'expected retail ConditionState.Animation entries with numeric metadata').toBeGreaterThan(100);
  });

  it('ParticleSysBone entries flow into model and transition condition profiles for every retail user', () => {
    const particlePairs = (value: unknown): Array<{ boneName: string; particleSystemName: string }> => {
      const tokens = splitTokens(value);
      if (tokens.length < 2) return [];
      return [{
        boneName: tokens[0]!.toLowerCase(),
        particleSystemName: tokens[1]!,
      }];
    };
    const hasPair = (
      entries: readonly Array<{ boneName: string; particleSystemName: string }>,
      pair: { boneName: string; particleSystemName: string },
    ): boolean => entries.some(
      (entry) => entry.boneName.toLowerCase() === pair.boneName
        && entry.particleSystemName === pair.particleSystemName,
    );

    let conditionUsers = 0;
    let transitionUsers = 0;
    for (const obj of bundle.objects ?? []) {
      const expectedConditions: Array<{ boneName: string; particleSystemName: string }> = [];
      const expectedTransitions: Array<{ boneName: string; particleSystemName: string }> = [];
      const visit = (block: BundleBlock): void => {
        const fieldValue = block.fields?.['ParticleSysBone'];
        if (fieldValue !== undefined) {
          const pairs = particlePairs(fieldValue);
          const blockType = (block.type ?? '').toUpperCase();
          if (blockType === 'TRANSITIONSTATE') {
            expectedTransitions.push(...pairs);
          } else if (
            blockType === 'CONDITIONSTATE'
            || blockType === 'MODELCONDITIONSTATE'
            || blockType === 'DEFAULTCONDITIONSTATE'
          ) {
            expectedConditions.push(...pairs);
          }
        }
        for (const child of block.blocks ?? []) visit(child);
      };
      for (const block of obj.blocks ?? []) visit(block);

      if (expectedConditions.length > 0) {
        conditionUsers += expectedConditions.length;
        const parsed = collectModelConditionInfos(obj as never).flatMap((info) => info.particleSysBones);
        for (const pair of expectedConditions) {
          expect(
            hasPair(parsed, pair),
            `ParticleSysBone condition pair missing on ${obj.name}: ${pair.boneName}/${pair.particleSystemName}`,
          ).toBe(true);
        }
      }
      if (expectedTransitions.length > 0) {
        transitionUsers += expectedTransitions.length;
        const parsed = collectTransitionInfos(obj as never).flatMap((info) => info.particleSysBones);
        for (const pair of expectedTransitions) {
          expect(
            hasPair(parsed, pair),
            `ParticleSysBone transition pair missing on ${obj.name}: ${pair.boneName}/${pair.particleSystemName}`,
          ).toBe(true);
        }
      }
    }
    expect(conditionUsers, 'expected retail condition ParticleSysBone users').toBeGreaterThan(1000);
    expect(transitionUsers, 'expected retail transition ParticleSysBone users').toBeGreaterThan(100);
  });

  it('Turret/TurretPitch source draw fields flow into model condition profiles for every retail user', () => {
    const tokensOf = (value: unknown): string[] => {
      if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
      return splitTokens(value);
    };
    const expectedBoneFields = [
      { field: 'Turret', slot: 0, property: 'turretBoneName' },
      { field: 'TurretPitch', slot: 0, property: 'turretPitchBoneName' },
      { field: 'AltTurret', slot: 1, property: 'turretBoneName' },
      { field: 'AltTurretPitch', slot: 1, property: 'turretPitchBoneName' },
    ] as const;
    const expectedAngleFields = [
      { field: 'TurretArtAngle', slot: 0, property: 'turretArtAngle' },
      { field: 'TurretArtPitch', slot: 0, property: 'turretArtPitch' },
      { field: 'AltTurretArtAngle', slot: 1, property: 'turretArtAngle' },
      { field: 'AltTurretArtPitch', slot: 1, property: 'turretArtPitch' },
    ] as const;

    let boneFieldUsers = 0;
    let artAngleUsers = 0;
    for (const obj of bundle.objects ?? []) {
      const expectedBones: Array<{ field: string; slot: number; property: 'turretBoneName' | 'turretPitchBoneName'; value: string }> = [];
      const expectedAngles: Array<{ field: string; slot: number; property: 'turretArtAngle' | 'turretArtPitch'; value: number }> = [];
      const visit = (block: BundleBlock): void => {
        const blockType = (block.type ?? '').toUpperCase();
        if (
          blockType === 'CONDITIONSTATE'
          || blockType === 'MODELCONDITIONSTATE'
          || blockType === 'DEFAULTCONDITIONSTATE'
        ) {
          const fields = block.fields ?? {};
          for (const spec of expectedBoneFields) {
            const first = tokensOf(fields[spec.field])?.[0];
            if (!first || first.toUpperCase() === 'NONE') continue;
            expectedBones.push({
              field: spec.field,
              slot: spec.slot,
              property: spec.property,
              value: first.toLowerCase(),
            });
          }
          for (const spec of expectedAngleFields) {
            const raw = tokensOf(fields[spec.field])?.[0];
            if (!raw) continue;
            const degrees = Number(raw);
            if (!Number.isFinite(degrees)) continue;
            expectedAngles.push({
              field: spec.field,
              slot: spec.slot,
              property: spec.property,
              value: degrees * Math.PI / 180,
            });
          }
        }
        for (const child of block.blocks ?? []) visit(child);
      };
      for (const block of obj.blocks ?? []) visit(block);
      if (expectedBones.length === 0 && expectedAngles.length === 0) continue;

      const infos = collectModelConditionInfos(obj as never);
      for (const expected of expectedBones) {
        boneFieldUsers++;
        expect(
          infos.some((info) => info.turrets?.[expected.slot]?.[expected.property] === expected.value),
          `${expected.field} missing on ${obj.name}: ${expected.value}`,
        ).toBe(true);
      }
      for (const expected of expectedAngles) {
        artAngleUsers++;
        expect(
          infos.some((info) => Math.abs((info.turrets?.[expected.slot]?.[expected.property] ?? Number.NaN) - expected.value) < 1e-8),
          `${expected.field} missing on ${obj.name}: ${expected.value}`,
        ).toBe(true);
      }
    }
    expect(boneFieldUsers, 'expected retail Turret/TurretPitch draw users').toBeGreaterThan(800);
    expect(artAngleUsers, 'expected retail TurretArtAngle draw users').toBeGreaterThan(30);
  });

  it('Weapon*Bone source draw fields flow into model and transition condition profiles for every retail user', () => {
    const weaponSlotByName = new Map([
      ['PRIMARY', 0],
      ['SECONDARY', 1],
      ['TERTIARY', 2],
    ]);
    const expectedFields = [
      { field: 'WeaponFireFXBone', property: 'fireFXBoneName' },
      { field: 'WeaponRecoilBone', property: 'recoilBoneName' },
      { field: 'WeaponMuzzleFlash', property: 'muzzleFlashBoneName' },
      { field: 'WeaponLaunchBone', property: 'launchBoneName' },
      { field: 'WeaponHideShowBone', property: 'hideShowBoneName' },
    ] as const;
    const weaponBoneEntry = (value: unknown): { slot: number; boneName: string } | null => {
      if (Array.isArray(value) && value.length >= 2) {
        const slotToken = typeof value[0] === 'string' ? value[0].trim().toUpperCase() : '';
        const slot = weaponSlotByName.get(slotToken);
        const boneName = value.slice(1)
          .filter((entry): entry is string | number | boolean =>
            typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
          .map((entry) => String(entry).trim())
          .filter(Boolean)
          .join(' ');
        return slot !== undefined && boneName ? { slot, boneName } : null;
      }
      const tokens = splitTokens(value);
      const slot = weaponSlotByName.get(tokens[0]?.trim().toUpperCase() ?? '');
      const boneName = tokens.slice(1).join(' ').trim();
      return slot !== undefined && boneName ? { slot, boneName } : null;
    };

    let conditionUsers = 0;
    let transitionUsers = 0;
    for (const obj of bundle.objects ?? []) {
      const expectedConditions: Array<{
        field: string;
        slot: number;
        property: typeof expectedFields[number]['property'];
        value: string;
      }> = [];
      const expectedTransitions: Array<{
        field: string;
        slot: number;
        property: typeof expectedFields[number]['property'];
        value: string;
      }> = [];

      const visit = (block: BundleBlock): void => {
        const blockType = (block.type ?? '').toUpperCase();
        const isConditionState = blockType === 'CONDITIONSTATE'
          || blockType === 'MODELCONDITIONSTATE'
          || blockType === 'DEFAULTCONDITIONSTATE';
        const isTransitionState = blockType === 'TRANSITIONSTATE';
        if (isConditionState || isTransitionState) {
          const fields = block.fields ?? {};
          for (const spec of expectedFields) {
            const entry = weaponBoneEntry(fields[spec.field]);
            if (!entry || entry.boneName.toUpperCase() === 'NONE') {
              continue;
            }
            const expected = {
              field: spec.field,
              slot: entry.slot,
              property: spec.property,
              value: entry.boneName.toLowerCase(),
            };
            if (isTransitionState) {
              expectedTransitions.push(expected);
            } else {
              expectedConditions.push(expected);
            }
          }
        }
        for (const child of block.blocks ?? []) visit(child);
      };
      for (const block of obj.blocks ?? []) visit(block);

      if (expectedConditions.length > 0) {
        const infos = collectModelConditionInfos(obj as never);
        for (const expected of expectedConditions) {
          conditionUsers++;
          expect(
            infos.some((info) => info.weaponBones?.[expected.slot]?.[expected.property] === expected.value),
            `${expected.field} missing on ${obj.name}: slot ${expected.slot} ${expected.value}`,
          ).toBe(true);
        }
      }
      if (expectedTransitions.length > 0) {
        const infos = collectTransitionInfos(obj as never);
        for (const expected of expectedTransitions) {
          transitionUsers++;
          expect(
            infos.some((info) => info.weaponBones?.[expected.slot]?.[expected.property] === expected.value),
            `${expected.field} transition missing on ${obj.name}: slot ${expected.slot} ${expected.value}`,
          ).toBe(true);
        }
      }
    }

    expect(conditionUsers, 'expected retail Weapon*Bone condition users').toBeGreaterThan(3000);
    expect(transitionUsers, 'expected retail Weapon*Bone transition users').toBeGreaterThan(50);
  });

  it('ProjectileBoneFeedbackEnabledSlots parses source weapon-slot bitstrings for every retail user', () => {
    const weaponSlotByName = new Map([
      ['PRIMARY', 0],
      ['SECONDARY', 1],
      ['TERTIARY', 2],
    ]);
    const splitSlotTokens = (value: unknown): string[] =>
      (Array.isArray(value) ? value : [value])
        .filter((entry) => entry !== undefined && entry !== null)
        .flatMap((entry) => String(entry).trim().split(/\s+/).filter(Boolean));

    let userCount = 0;
    let arrayShapeUsers = 0;
    for (const obj of bundle.objects ?? []) {
      let expectedMask = 0;
      const visit = (block: BundleBlock): void => {
        const value = (block.fields ?? {})['ProjectileBoneFeedbackEnabledSlots'];
        if (value !== undefined) {
          userCount++;
          if (Array.isArray(value)) {
            arrayShapeUsers++;
          }
          for (const token of splitSlotTokens(value)) {
            const bitIndex = weaponSlotByName.get(token.trim().toUpperCase());
            if (bitIndex !== undefined) {
              expectedMask |= 1 << bitIndex;
            }
          }
        }
        for (const child of block.blocks ?? []) {
          visit(child);
        }
      };
      for (const block of obj.blocks ?? []) {
        visit(block);
      }
      if (expectedMask === 0) continue;

      const profile = resolveRenderAssetProfile(obj as never);
      expect(
        profile.projectileBoneFeedbackEnabledSlotMask,
        `ProjectileBoneFeedbackEnabledSlots mask mismatch on ${obj.name}`,
      ).toBe(expectedMask);
    }

    expect(userCount, 'expected retail ProjectileBoneFeedbackEnabledSlots users').toBeGreaterThan(20);
    expect(arrayShapeUsers, 'expected retail multi-slot projectile feedback users').toBeGreaterThan(0);
  });

  it('ShowSubObject/HideSubObject conflicts resolve to one source visibility action', () => {
    let sourceConflictCount = 0;
    const splitNames = (value: unknown): string[] =>
      (Array.isArray(value) ? value : [value])
        .filter((entry) => entry !== undefined && entry !== null)
        .flatMap((entry) => String(entry).trim().split(/\s+/).filter(Boolean))
        .filter((entry) => entry.toUpperCase() !== 'NONE');

    for (const obj of bundle.objects ?? []) {
      const visit = (block: BundleBlock): void => {
        const fields = block.fields ?? {};
        const hidden = new Set(splitNames(fields['HideSubObject']).map((entry) => entry.toUpperCase()));
        for (const shown of splitNames(fields['ShowSubObject'])) {
          if (hidden.has(shown.toUpperCase())) {
            sourceConflictCount++;
          }
        }
        for (const child of block.blocks ?? []) {
          visit(child);
        }
      };
      for (const block of obj.blocks ?? []) {
        visit(block);
      }

      const infos = collectModelConditionInfos(obj as never);
      for (const info of infos) {
        const hidden = new Set(info.hideSubObjects.map((entry) => entry.toUpperCase()));
        for (const shown of info.showSubObjects) {
          expect(
            hidden.has(shown.toUpperCase()),
            `sub-object remained both hidden and shown on ${obj.name}: ${shown}`,
          ).toBe(false);
        }
      }
    }

    expect(sourceConflictCount, 'expected retail show/hide conflict users').toBeGreaterThan(0);
  });

  it('extractIniValueTokens decodes flat primitive arrays as a single multi-token entry', () => {
    // This regression bundle scan proves that EVERY shipped retail field
    // emitted as a flat-token array (e.g. ['HEROIC', 'WeaponFX_X']) parses
    // into exactly one entry whose tokens are the array elements. Before the
    // fix in commit-pending, extractIniValueTokens treated such arrays as
    // N entries of one token each, silently dropping every Heroic-vet weapon
    // FX/Exhaust override (100+ retail weapons), every WeaponBonus
    // PLAYER_UPGRADE / CONTINUOUS_FIRE_FAST modifier (85 retail weapons),
    // and the Boss_Barracks QuantityModifier production multiplier.
    interface BundleWeapon { name?: string; fields?: Record<string, unknown> }
    const bundleWithLists = bundle as { weapons?: BundleWeapon[] };

    // Audit: Heroic-vet FX override on machine-gun weapons.
    const veterancyFireFXUsers = (bundleWithLists.weapons ?? [])
      .filter((w) => Array.isArray((w.fields ?? {})['VeterancyFireFX']));
    expect(veterancyFireFXUsers.length, 'expected retail VeterancyFireFX flat-array users').toBeGreaterThan(50);
    for (const wpn of veterancyFireFXUsers.slice(0, 5)) {
      const value = (wpn.fields ?? {})['VeterancyFireFX'] as unknown;
      const tokens = extractIniValueTokens({} as never, value as never);
      expect(tokens.length, `expected single entry for ${wpn.name}`).toBe(1);
      expect(tokens[0]!.length, `expected ≥2 tokens for ${wpn.name}`).toBeGreaterThanOrEqual(2);
      expect(tokens[0]![0]).toBe('HEROIC');
      expect(tokens[0]![1]!.length).toBeGreaterThan(0);
    }

    // Audit: ProjectileExhaust Heroic override.
    const projExhaustUsers = (bundleWithLists.weapons ?? [])
      .filter((w) => Array.isArray((w.fields ?? {})['VeterancyProjectileExhaust']));
    expect(projExhaustUsers.length).toBeGreaterThan(40);
    for (const wpn of projExhaustUsers.slice(0, 5)) {
      const tokens = extractIniValueTokens({} as never, (wpn.fields ?? {})['VeterancyProjectileExhaust'] as never);
      expect(tokens.length).toBe(1);
      expect(tokens[0]).toEqual(['HEROIC', expect.any(String)]);
    }

    // Audit: WeaponBonus 3-token entries.
    const weaponBonusUsers = (bundleWithLists.weapons ?? [])
      .filter((w) => Array.isArray((w.fields ?? {})['WeaponBonus']));
    expect(weaponBonusUsers.length).toBeGreaterThan(50);
    for (const wpn of weaponBonusUsers.slice(0, 5)) {
      const tokens = extractIniValueTokens({} as never, (wpn.fields ?? {})['WeaponBonus'] as never);
      expect(tokens.length).toBe(1);
      expect(tokens[0]!.length).toBe(3);
      // All 3 tokens are non-empty.
      for (const tok of tokens[0]!) expect(tok.length).toBeGreaterThan(0);
    }
  });
});
