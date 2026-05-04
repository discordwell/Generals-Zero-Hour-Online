import type { IniValue } from '@generals/core';
import type { RenderableObjectCategory } from './types.js';

export function nominalHeightForCategory(category: RenderableObjectCategory): number {
  switch (category) {
    case 'air':
      return 2.4;
    case 'building':
      return 8;
    case 'infantry':
      return 2;
    case 'vehicle':
      return 3;
    case 'unknown':
    default:
      return 2;
  }
}

export function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function readStringList(fields: Record<string, IniValue>, names: string[]): string[] {
  for (const name of names) {
    const values = readStringListValue(fields[name]);
    if (values.length > 0) {
      return values;
    }
  }

  return [];
}

export function readStringListValue(value: IniValue | undefined): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => readStringListValue(entry as IniValue))
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

export function readBooleanField(fields: Record<string, IniValue>, names: string[]): boolean | null {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'yes' || normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'no' || normalized === 'false' || normalized === '0') {
        return false;
      }
    }
  }

  return null;
}

export function readStringField(fields: Record<string, IniValue>, names: string[]): string | null {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    } else if (Array.isArray(value)) {
      // Source parity: the INI converter sometimes emits multi-token fields as
      // an array of token strings (e.g., DeathTypes = ALL -CRUSHED becomes
      // ["ALL", "-CRUSHED"]). Callers that split on whitespace get the right
      // result if we join the array back into a single space-separated string;
      // single-token callers see the same result they would have for the raw
      // string form.
      const joined = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .join(' ');
      if (joined.length > 0) {
        return joined;
      }
    }
  }

  return null;
}

export function readNumericList(values: IniValue | undefined): number[] {
  if (typeof values === 'undefined') return [];
  if (typeof values === 'number') return [values];
  if (typeof values === 'string') {
    const parts = values
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => Number(part));
    return parts.filter((value) => Number.isFinite(value));
  }
  if (Array.isArray(values)) {
    return values.flatMap((value) => readNumericList(value as IniValue)).filter((value) => Number.isFinite(value));
  }
  return [];
}

export function readNumericField(fields: Record<string, IniValue>, names: string[]): number | null {
  for (const name of names) {
    const values = readNumericList(fields[name]);
    if (values.length > 0 && Number.isFinite(values[0])) {
      const [value] = values;
      if (value !== undefined) {
        return value;
      }
    }
  }

  return null;
}

export function toByte(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.trunc(value);
  return Math.max(0, Math.min(255, normalized));
}

export function readNumericListField(fields: Record<string, IniValue>, names: string[]): number[] | null {
  for (const name of names) {
    const values = readNumericList(fields[name]);
    if (values.length > 0) {
      return values;
    }
  }

  return null;
}

export function readCoord3DField(
  fields: Record<string, IniValue>,
  names: string[],
): { x: number; y: number; z: number } | null {
  const values = readNumericListField(fields, names);
  if (!values || values.length < 2) {
    return null;
  }
  return {
    x: values[0] ?? 0,
    y: values[1] ?? 0,
    z: values[2] ?? 0,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pointInPolygon(
  x: number,
  y: number,
  points: Array<{ x: number; y: number; z: number }>,
): boolean {
  if (points.length < 3) return false;

  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const aY = a.y;
    const bY = b.y;
    if ((aY > y) !== (bY > y)) {
      const ratio = (y - aY) / (bY - aY);
      const intersectX = a.x + ratio * (b.x - a.x);
      if (intersectX > x) {
        inside = !inside;
      }
    }
  }

  return inside;
}
