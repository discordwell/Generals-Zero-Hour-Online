import type { IniValue } from '@generals/core';
import type { ObjectDef } from '@generals/ini-data';
import type { LaserBeamConfig } from '@generals/renderer';

interface ParsedColor {
  color: number;
  opacity: number;
}

function normalizeFieldName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function readField(fields: Record<string, IniValue>, fieldName: string): IniValue | undefined {
  const normalized = normalizeFieldName(fieldName);
  for (const [name, value] of Object.entries(fields)) {
    if (normalizeFieldName(name) === normalized) {
      return value;
    }
  }
  return undefined;
}

function splitValueTokens(value: IniValue | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (typeof value === 'string') {
    return value.split(/[\s,;|]+/).map((token) => token.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => splitValueTokens(entry as IniValue));
  }
  return [];
}

function readNumberField(fields: Record<string, IniValue>, fieldName: string): number | undefined {
  const tokens = splitValueTokens(readField(fields, fieldName));
  const first = tokens[0];
  if (!first) {
    return undefined;
  }
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readColorField(fields: Record<string, IniValue>, fieldName: string): ParsedColor | undefined {
  const tokens = splitValueTokens(readField(fields, fieldName));
  let red: number | undefined;
  let green: number | undefined;
  let blue: number | undefined;
  let alpha = 255;

  for (const token of tokens) {
    const match = token.match(/^([RGBA])\s*:\s*(-?\d+(?:\.\d+)?)$/i);
    if (!match) {
      continue;
    }
    const channel = match[1]!.toUpperCase();
    const value = Math.max(0, Math.min(255, Math.round(Number(match[2]))));
    if (channel === 'R') red = value;
    else if (channel === 'G') green = value;
    else if (channel === 'B') blue = value;
    else if (channel === 'A') alpha = value;
  }

  if (red === undefined || green === undefined || blue === undefined) {
    return undefined;
  }

  return {
    color: (red << 16) | (green << 8) | blue,
    opacity: alpha / 255,
  };
}

function findW3DLaserDrawBlock(objectDef: ObjectDef): { fields: Record<string, IniValue> } | undefined {
  return objectDef.blocks.find((block) => {
    const moduleType = block.name.trim().split(/\s+/)[0]?.toUpperCase();
    return block.type.toUpperCase() === 'DRAW' && moduleType === 'W3DLASERDRAW';
  });
}

export function resolveW3DLaserDrawBeamConfig(objectDef: ObjectDef | undefined): LaserBeamConfig | undefined {
  if (!objectDef) {
    return undefined;
  }
  const block = findW3DLaserDrawBlock(objectDef);
  if (!block) {
    return undefined;
  }

  const fields = block.fields;
  const config: LaserBeamConfig = {};
  const innerWidth = readNumberField(fields, 'InnerBeamWidth');
  const outerWidth = readNumberField(fields, 'OuterBeamWidth');
  const numBeams = readNumberField(fields, 'NumBeams');
  const segments = readNumberField(fields, 'Segments');
  const arcHeight = readNumberField(fields, 'ArcHeight');
  const maxIntensityLifetime = readNumberField(fields, 'MaxIntensityLifetime');
  const fadeLifetime = readNumberField(fields, 'FadeLifetime');
  const innerColor = readColorField(fields, 'InnerColor');
  const outerColor = readColorField(fields, 'OuterColor');

  if (innerWidth !== undefined) config.innerWidth = Math.max(0, innerWidth);
  if (outerWidth !== undefined) config.outerWidth = Math.max(0, outerWidth);
  if (numBeams !== undefined) config.numBeams = Math.max(1, Math.trunc(numBeams));
  if (segments !== undefined) config.segments = Math.max(1, Math.trunc(segments));
  if (arcHeight !== undefined) config.arcHeight = arcHeight;
  if (maxIntensityLifetime !== undefined) config.fullIntensityMs = Math.max(0, maxIntensityLifetime);
  if (fadeLifetime !== undefined) config.fadeMs = Math.max(0, fadeLifetime);
  if (innerColor) {
    config.innerColor = innerColor.color;
    config.innerOpacity = innerColor.opacity;
  }
  if (outerColor) {
    config.outerColor = outerColor.color;
    config.outerOpacity = outerColor.opacity;
  }

  return config;
}
