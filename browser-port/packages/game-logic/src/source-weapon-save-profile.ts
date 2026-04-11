import type { IniDataRegistry, WeaponDef } from '@generals/ini-data';
import type { IniValue } from '@generals/core';
import { readNumericField, readNumericList } from './ini-readers.js';
import { findWeaponDefByName } from './registry-lookups.js';

interface SourceWeaponSaveProfileContext {
  iniDataRegistry?: IniDataRegistry | null;
  msToLogicFrames(ms: number): number;
  readIniFieldValue?(fields: WeaponDef['fields'], key: string): unknown;
  extractIniValueTokens?(value: unknown): string[][];
}

export interface SourceWeaponSaveProfile {
  name: string;
  clipSize: number;
  clipReloadFrames: number;
  shotsPerBarrel: number;
  minTargetPitch: number;
  maxTargetPitch: number;
  suspendFXDelayFrames: number;
  scatterTargetCount: number;
}

function resolveWeaponFieldValue(
  self: SourceWeaponSaveProfileContext,
  weaponDef: WeaponDef,
  key: string,
): unknown {
  return typeof self.readIniFieldValue === 'function'
    ? self.readIniFieldValue(weaponDef.fields, key)
    : weaponDef.fields[key];
}

function resolveScatterTargetCount(self: SourceWeaponSaveProfileContext, weaponDef: WeaponDef): number {
  const scatterTargetValue = resolveWeaponFieldValue(self, weaponDef, 'ScatterTarget');
  if (typeof scatterTargetValue === 'undefined' || scatterTargetValue === null) {
    return 0;
  }

  let count = 0;
  if (typeof self.extractIniValueTokens === 'function') {
    for (const tokens of self.extractIniValueTokens(scatterTargetValue)) {
      const numericTokens = tokens
        .map((token) => Number(token))
        .filter((value) => Number.isFinite(value));
      if (numericTokens.length >= 2) {
        count += 1;
      }
    }
    if (count > 0) {
      return count;
    }
  }

  return Math.floor(readNumericList(scatterTargetValue as IniValue).length / 2);
}

export function resolveSourceWeaponSaveProfile(
  self: SourceWeaponSaveProfileContext,
  weaponName: string | null | undefined,
): SourceWeaponSaveProfile | null {
  const normalizedWeaponName = weaponName?.trim() ?? '';
  if (!normalizedWeaponName || !self.iniDataRegistry) {
    return null;
  }

  const weaponDef = findWeaponDefByName(self.iniDataRegistry, normalizedWeaponName);
  if (!weaponDef) {
    return null;
  }

  const clipSize = Math.max(0, Math.trunc(readNumericField(weaponDef.fields, ['ClipSize']) ?? 0));
  const shotsPerBarrel = Math.max(1, Math.trunc(readNumericField(weaponDef.fields, ['ShotsPerBarrel']) ?? 1));
  return {
    name: weaponDef.name,
    clipSize,
    clipReloadFrames: Math.max(0, self.msToLogicFrames(readNumericField(weaponDef.fields, ['ClipReloadTime']) ?? 0)),
    shotsPerBarrel,
    minTargetPitch: (readNumericField(weaponDef.fields, ['MinTargetPitch']) ?? -180) * (Math.PI / 180),
    maxTargetPitch: (readNumericField(weaponDef.fields, ['MaxTargetPitch']) ?? 180) * (Math.PI / 180),
    suspendFXDelayFrames: Math.max(
      0,
      self.msToLogicFrames(readNumericField(weaponDef.fields, ['SuspendFXDelay']) ?? 0),
    ),
    scatterTargetCount: resolveScatterTargetCount(self, weaponDef),
  };
}
