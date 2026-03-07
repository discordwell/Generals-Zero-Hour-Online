/**
 * ParticleSystemTemplate — typed data model for INI ParticleSystem definitions.
 *
 * Source parity: ParticleSys.h ParticleSystemInfo struct (lines 297-486)
 */

import type { RawBlockDef } from '@generals/ini-data';
import type { ParticlePriority } from './game-lod-manager.js';
import { PARTICLE_PRIORITY_ORDER } from './game-lod-manager.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type ParticleShaderType = 'ADDITIVE' | 'ALPHA' | 'ALPHA_TEST' | 'MULTIPLY';

export type ParticleType = 'PARTICLE' | 'DRAWABLE' | 'STREAK' | 'VOLUME_PARTICLE';

export type EmissionVolumeType = 'POINT' | 'LINE' | 'BOX' | 'SPHERE' | 'CYLINDER';

export type EmissionVelocityType = 'ORTHO' | 'SPHERICAL' | 'HEMISPHERICAL' | 'CYLINDRICAL' | 'OUTWARD';

export type WindMotionType = 'Unused' | 'PingPong' | 'Circular';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export interface RandomRange {
  min: number;
  max: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AlphaKeyframe {
  alphaMin: number;
  alphaMax: number;
  frame: number;
}

export interface ColorKeyframe {
  r: number;
  g: number;
  b: number;
  frame: number;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export interface ParticleSystemTemplate {
  name: string;
  priority: ParticlePriority;
  isOneShot: boolean;
  shader: ParticleShaderType;
  type: ParticleType;
  particleName: string;

  // Rotation
  angleZ: RandomRange;
  angularRateZ: RandomRange;
  angularDamping: RandomRange;

  // Physics
  velocityDamping: RandomRange;
  gravity: number;

  // Lifetime
  lifetime: RandomRange;
  systemLifetime: number;

  // Size
  size: RandomRange;
  startSizeRate: RandomRange;
  sizeRate: RandomRange;
  sizeRateDamping: RandomRange;

  // Alpha keyframes (up to 8)
  alphaKeyframes: AlphaKeyframe[];

  // Color keyframes (up to 8)
  colorKeyframes: ColorKeyframe[];
  colorScale: RandomRange;

  // Burst timing
  burstDelay: RandomRange;
  burstCount: RandomRange;
  initialDelay: RandomRange;

  // Drift
  driftVelocity: Vec3;

  // Velocity
  velocityType: EmissionVelocityType;
  velOrtho: Vec3Range;
  velOutward: RandomRange;
  velOutwardOther: RandomRange;
  velSpherical: RandomRange;
  velHemispherical: RandomRange;
  velCylindrical: { radial: RandomRange; normal: RandomRange };

  // Emission volume
  volumeType: EmissionVolumeType;
  volLineStart: Vec3;
  volLineEnd: Vec3;
  volBoxHalfSize: Vec3;
  volSphereRadius: number;
  volCylinderRadius: number;
  volCylinderLength: number;

  // Flags
  isHollow: boolean;
  isGroundAligned: boolean;
  isEmitAboveGroundOnly: boolean;
  isParticleUpTowardsEmitter: boolean;

  // Wind
  windMotion: WindMotionType;
  windAngleChangeMin: number;
  windAngleChangeMax: number;
  windPingPongStartAngleMin: number;
  windPingPongStartAngleMax: number;
  windPingPongEndAngleMin: number;
  windPingPongEndAngleMax: number;

  // Slave system (if any)
  slavePosOffset?: Vec3;
  slaveSystemName?: string;
  attachedSystemName?: string;
}

export interface Vec3Range {
  x: RandomRange;
  y: RandomRange;
  z: RandomRange;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseParticleSystemTemplate(block: RawBlockDef): ParticleSystemTemplate {
  const f = block.fields;
  return {
    name: block.name,
    priority: readPriority(f['Priority']) ?? 'NONE',
    isOneShot: readBoolField(f['IsOneShot']) ?? false,
    shader: readShader(f['Shader']) ?? 'ALPHA',
    type: readParticleType(f['Type']) ?? 'PARTICLE',
    particleName: readStr(f['ParticleName']) ?? '',

    angleZ: readRange(f['AngleZ']),
    angularRateZ: readRange(f['AngularRateZ']),
    angularDamping: readRange(f['AngularDamping'], 1),

    velocityDamping: readRange(f['VelocityDamping'], 1),
    gravity: readNum(f['Gravity']) ?? 0,

    lifetime: readRange(f['Lifetime'], 30),
    systemLifetime: readNum(f['SystemLifetime']) ?? 0,

    size: readRange(f['Size'], 1),
    startSizeRate: readRange(f['StartSizeRate']),
    sizeRate: readRange(f['SizeRate']),
    sizeRateDamping: readRange(f['SizeRateDamping'], 1),

    alphaKeyframes: readAlphaKeyframes(f),
    colorKeyframes: readColorKeyframes(f),
    colorScale: readRange(f['ColorScale']),

    burstDelay: readRange(f['BurstDelay']),
    burstCount: readRange(f['BurstCount'], 1),
    initialDelay: readRange(f['InitialDelay']),

    driftVelocity: readVec3(f['DriftVelocity']),

    velocityType: readVelocityType(f['VelocityType']) ?? 'ORTHO',
    velOrtho: {
      x: readRange(f['VelOrthoX']),
      y: readRange(f['VelOrthoY']),
      z: readRange(f['VelOrthoZ']),
    },
    velOutward: readRange(f['VelOutward']),
    velOutwardOther: readRange(f['VelOutwardOther']),
    velSpherical: readRange(f['VelSpherical']),
    velHemispherical: readRange(f['VelHemispherical']),
    velCylindrical: {
      radial: readRange(f['VelCylindricalRadial']),
      normal: readRange(f['VelCylindricalNormal']),
    },

    volumeType: readVolumeType(f['VolumeType']) ?? 'POINT',
    volLineStart: readVec3(f['VolLineStart']),
    volLineEnd: readVec3(f['VolLineEnd']),
    volBoxHalfSize: readVec3(f['VolBoxHalfSize']),
    volSphereRadius: readNum(f['VolSphereRadius']) ?? 0,
    volCylinderRadius: readNum(f['VolCylinderRadius']) ?? 0,
    volCylinderLength: readNum(f['VolCylinderLength']) ?? 0,

    isHollow: readBoolField(f['IsHollow']) ?? false,
    isGroundAligned: readBoolField(f['IsGroundAligned']) ?? false,
    isEmitAboveGroundOnly: readBoolField(f['IsEmitAboveGroundOnly']) ?? false,
    isParticleUpTowardsEmitter: readBoolField(f['IsParticleUpTowardsEmitter']) ?? false,

    windMotion: readWindMotion(f['WindMotion']) ?? 'Unused',
    windAngleChangeMin: readNum(f['WindAngleChangeMin']) ?? 0.15,
    windAngleChangeMax: readNum(f['WindAngleChangeMax']) ?? 0.45,
    windPingPongStartAngleMin: readNum(f['WindPingPongStartAngleMin']) ?? 0,
    windPingPongStartAngleMax: readNum(f['WindPingPongStartAngleMax']) ?? Math.PI / 4,
    windPingPongEndAngleMin: readNum(f['WindPingPongEndAngleMin']) ?? 5.5,
    windPingPongEndAngleMax: readNum(f['WindPingPongEndAngleMax']) ?? 2 * Math.PI,

    slavePosOffset: f['SlavePosOffset'] ? readVec3(f['SlavePosOffset']) : undefined,
    slaveSystemName: readStr(f['SlaveSystem']),
    attachedSystemName: readStr(f['AttachedSystem']),
  };
}

// ---------------------------------------------------------------------------
// INI field readers
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

function readBoolField(v: FieldValue): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const lower = v.trim().toLowerCase();
    if (lower === 'yes' || lower === 'true' || lower === '1') return true;
    if (lower === 'no' || lower === 'false' || lower === '0') return false;
  }
  return undefined;
}

function readRange(v: FieldValue, defaultVal = 0): RandomRange {
  if (typeof v === 'number') return { min: v, max: v };
  if (typeof v === 'string') {
    const parts = v.trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (parts.length >= 2) return { min: parts[0]!, max: parts[1]! };
    if (parts.length === 1) return { min: parts[0]!, max: parts[0]! };
  }
  if (Array.isArray(v)) {
    const nums = v.map((x) => typeof x === 'number' ? x : parseFloat(String(x))).filter(Number.isFinite);
    if (nums.length >= 2) return { min: nums[0]!, max: nums[1]! };
    if (nums.length === 1) return { min: nums[0]!, max: nums[0]! };
  }
  return { min: defaultVal, max: defaultVal };
}

function readVec3(v: FieldValue): Vec3 {
  if (typeof v === 'string') {
    // Format: "X:1.0 Y:2.0 Z:3.0"
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

function readAlphaKeyframes(fields: Record<string, FieldValue>): AlphaKeyframe[] {
  const keyframes: AlphaKeyframe[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = fields[`Alpha${i}`];
    if (v === undefined) continue;
    const parts = String(v).trim().split(/\s+/).map(Number);
    const alphaMin = Number.isFinite(parts[0]) ? parts[0]! : 0;
    const alphaMax = Number.isFinite(parts[1]) ? parts[1]! : alphaMin;
    const frame = Number.isFinite(parts[2]) ? parts[2]! : 0;
    if (alphaMin !== 0 || alphaMax !== 0 || frame !== 0) {
      keyframes.push({ alphaMin, alphaMax, frame });
    }
  }
  return keyframes;
}

function readColorKeyframes(fields: Record<string, FieldValue>): ColorKeyframe[] {
  const keyframes: ColorKeyframe[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = fields[`Color${i}`];
    if (v === undefined) continue;
    const str = String(v);
    const rMatch = str.match(/R:\s*(\d+)/i);
    const gMatch = str.match(/G:\s*(\d+)/i);
    const bMatch = str.match(/B:\s*(\d+)/i);
    const r = rMatch ? parseInt(rMatch[1]!, 10) : 0;
    const g = gMatch ? parseInt(gMatch[1]!, 10) : 0;
    const b = bMatch ? parseInt(bMatch[1]!, 10) : 0;
    // Frame is the last token after B:XXX
    const frameMatch = str.match(/B:\s*\d+\s+(\d+)/i);
    const frame = frameMatch ? parseInt(frameMatch[1]!, 10) : 0;
    if (r !== 0 || g !== 0 || b !== 0 || frame !== 0) {
      keyframes.push({ r, g, b, frame });
    }
  }
  return keyframes;
}

function readShader(v: FieldValue): ParticleShaderType | undefined {
  if (typeof v !== 'string') return undefined;
  const upper = v.trim().toUpperCase();
  const valid: ParticleShaderType[] = ['ADDITIVE', 'ALPHA', 'ALPHA_TEST', 'MULTIPLY'];
  return valid.includes(upper as ParticleShaderType) ? (upper as ParticleShaderType) : undefined;
}

function readParticleType(v: FieldValue): ParticleType | undefined {
  if (typeof v !== 'string') return undefined;
  const upper = v.trim().toUpperCase();
  const valid: ParticleType[] = ['PARTICLE', 'DRAWABLE', 'STREAK', 'VOLUME_PARTICLE'];
  return valid.includes(upper as ParticleType) ? (upper as ParticleType) : undefined;
}

function readVelocityType(v: FieldValue): EmissionVelocityType | undefined {
  if (typeof v !== 'string') return undefined;
  const upper = v.trim().toUpperCase();
  const valid: EmissionVelocityType[] = ['ORTHO', 'SPHERICAL', 'HEMISPHERICAL', 'CYLINDRICAL', 'OUTWARD'];
  return valid.includes(upper as EmissionVelocityType) ? (upper as EmissionVelocityType) : undefined;
}

function readVolumeType(v: FieldValue): EmissionVolumeType | undefined {
  if (typeof v !== 'string') return undefined;
  const upper = v.trim().toUpperCase();
  const valid: EmissionVolumeType[] = ['POINT', 'LINE', 'BOX', 'SPHERE', 'CYLINDER'];
  return valid.includes(upper as EmissionVolumeType) ? (upper as EmissionVolumeType) : undefined;
}

function readWindMotion(v: FieldValue): WindMotionType | undefined {
  if (typeof v !== 'string') return undefined;
  const lower = v.trim().toLowerCase();
  if (lower === 'unused' || lower === 'none') return 'Unused';
  if (lower === 'pingpong' || lower === 'ping_pong') return 'PingPong';
  if (lower === 'circular') return 'Circular';
  return 'Unused';
}

function readPriority(v: FieldValue): ParticlePriority | undefined {
  if (typeof v !== 'string') return undefined;
  const upper = v.trim().toUpperCase() as ParticlePriority;
  if (PARTICLE_PRIORITY_ORDER.includes(upper)) return upper;
  return undefined;
}
