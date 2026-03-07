/**
 * FXListTemplate — typed data model for INI FXList definitions.
 *
 * Source parity: FXList.h FXNugget hierarchy.
 * An FXList is an ordered sequence of FXNugget entries, each producing
 * a visual/audio effect when triggered.
 */

import type { RawBlockDef } from '@generals/ini-data';
import type { IniBlock } from '@generals/core';

// ---------------------------------------------------------------------------
// FXNugget types
// ---------------------------------------------------------------------------

export interface FXParticleSystemNugget {
  type: 'ParticleSystem';
  name: string;
  orientToObject: boolean;
  offset?: { x: number; y: number; z: number };
}

export interface FXSoundNugget {
  type: 'Sound';
  name: string;
}

export interface FXViewShakeNugget {
  type: 'ViewShake';
  shakeType: string;
}

export interface FXLightPulseNugget {
  type: 'LightPulse';
  color: { r: number; g: number; b: number };
  radius: number;
  increaseTime: number;
  decreaseTime: number;
}

export interface FXTerrainScorchNugget {
  type: 'TerrainScorch';
  scorchType: string;
  radius: number;
}

export interface FXListAtBonePosNugget {
  type: 'FXListAtBonePos';
  fxListName: string;
  boneName: string;
}

export interface FXTracerNugget {
  type: 'Tracer';
  speed: number;
  length: number;
  width: number;
  color: { r: number; g: number; b: number };
  probability: number;
}

export interface FXBuffNugget {
  type: 'BuffNugget';
  buffType: string;
}

export type FXNugget =
  | FXParticleSystemNugget
  | FXSoundNugget
  | FXViewShakeNugget
  | FXLightPulseNugget
  | FXTerrainScorchNugget
  | FXListAtBonePosNugget
  | FXTracerNugget
  | FXBuffNugget;

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export interface FXListTemplate {
  name: string;
  nuggets: FXNugget[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseFXListTemplate(block: RawBlockDef): FXListTemplate {
  const nuggets: FXNugget[] = [];

  for (const subBlock of block.blocks) {
    const nugget = parseNugget(subBlock);
    if (nugget) {
      nuggets.push(nugget);
    }
  }

  return { name: block.name, nuggets };
}

function parseNugget(block: IniBlock): FXNugget | null {
  switch (block.type) {
    case 'ParticleSystem':
      return {
        type: 'ParticleSystem',
        name: readStr(block.fields['Name']) ?? block.name ?? '',
        orientToObject: readBool(block.fields['OrientToObject']) ?? false,
        offset: block.fields['Offset'] ? readOffset(block.fields['Offset']) : undefined,
      };

    case 'Sound':
      return {
        type: 'Sound',
        name: readStr(block.fields['Name']) ?? block.name ?? '',
      };

    case 'ViewShake':
      return {
        type: 'ViewShake',
        shakeType: readStr(block.fields['Type']) ?? 'NORMAL',
      };

    case 'LightPulse':
      return {
        type: 'LightPulse',
        color: readColor(block.fields['Color']),
        radius: readNum(block.fields['Radius']) ?? 10,
        increaseTime: readNum(block.fields['IncreaseTime']) ?? 0,
        decreaseTime: readNum(block.fields['DecreaseTime']) ?? 1000,
      };

    case 'TerrainScorch':
      return {
        type: 'TerrainScorch',
        scorchType: readStr(block.fields['Type']) ?? 'RANDOM',
        radius: readNum(block.fields['Radius']) ?? 5,
      };

    case 'FXListAtBonePos':
      return {
        type: 'FXListAtBonePos',
        fxListName: readStr(block.fields['FX']) ?? '',
        boneName: readStr(block.fields['BoneName']) ?? '',
      };

    case 'Tracer':
    case 'TracerEffect':
      return {
        type: 'Tracer',
        speed: readNum(block.fields['Speed']) ?? 500,
        length: readNum(block.fields['Length']) ?? 2,
        width: readNum(block.fields['Width']) ?? 0.05,
        color: readColor(block.fields['Color']),
        probability: readNum(block.fields['Probability']) ?? 1,
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

type FieldValue = unknown;

function readStr(v: FieldValue): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  return undefined;
}

function readNum(v: FieldValue): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readBool(v: FieldValue): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const lower = v.trim().toLowerCase();
    if (lower === 'yes' || lower === 'true' || lower === '1') return true;
    if (lower === 'no' || lower === 'false' || lower === '0') return false;
  }
  return undefined;
}

function readColor(v: FieldValue): { r: number; g: number; b: number } {
  if (typeof v === 'string') {
    const rMatch = v.match(/R:\s*(\d+)/i);
    const gMatch = v.match(/G:\s*(\d+)/i);
    const bMatch = v.match(/B:\s*(\d+)/i);
    return {
      r: rMatch ? parseInt(rMatch[1]!, 10) : 255,
      g: gMatch ? parseInt(gMatch[1]!, 10) : 255,
      b: bMatch ? parseInt(bMatch[1]!, 10) : 255,
    };
  }
  return { r: 255, g: 255, b: 255 };
}

function readOffset(v: FieldValue): { x: number; y: number; z: number } {
  if (typeof v === 'string') {
    const xMatch = v.match(/X:\s*(-?[\d.]+)/i);
    const yMatch = v.match(/Y:\s*(-?[\d.]+)/i);
    const zMatch = v.match(/Z:\s*(-?[\d.]+)/i);
    return {
      x: xMatch ? parseFloat(xMatch[1]!) : 0,
      y: yMatch ? parseFloat(yMatch[1]!) : 0,
      z: zMatch ? parseFloat(zMatch[1]!) : 0,
    };
  }
  return { x: 0, y: 0, z: 0 };
}
