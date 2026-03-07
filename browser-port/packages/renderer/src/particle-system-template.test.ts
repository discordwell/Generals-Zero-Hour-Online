import { describe, it, expect } from 'vitest';
import { parseParticleSystemTemplate } from './particle-system-template.js';
import type { RawBlockDef } from '@generals/ini-data';

function makeRawBlock(name: string, fields: Record<string, unknown>): RawBlockDef {
  return { name, fields: fields as Record<string, import('@generals/core').IniValue>, blocks: [] };
}

describe('parseParticleSystemTemplate', () => {
  it('parses a basic smoke particle system from INI fields', () => {
    const block = makeRawBlock('SmokePuff', {
      Priority: 'WEAPON_EXPLOSION',
      IsOneShot: 'No',
      Shader: 'ALPHA',
      Type: 'PARTICLE',
      ParticleName: 'EXSmokNew1.tga',
      AngleZ: '0.00 0.25',
      AngularRateZ: '-0.01 0.01',
      AngularDamping: '0.99 0.99',
      VelocityDamping: '0.99 0.98',
      Gravity: '0.01',
      Lifetime: '60.00 60.00',
      SystemLifetime: '0',
      Size: '5.00 5.00',
      SizeRate: '3.00 3.00',
      SizeRateDamping: '0.95 0.95',
      Alpha1: '0.00 0.00 0',
      Alpha2: '1.00 1.00 5',
      Alpha3: '0.00 0.00 60',
      Color1: 'R:255 G:255 B:255 0',
      BurstDelay: '40.00 40.00',
      BurstCount: '0.00 2.00',
      VelocityType: 'OUTWARD',
      VolumeType: 'SPHERE',
      VolSphereRadius: '4.00',
      WindMotion: 'Unused',
    });

    const template = parseParticleSystemTemplate(block);

    expect(template.name).toBe('SmokePuff');
    expect(template.priority).toBe('WEAPON_EXPLOSION');
    expect(template.isOneShot).toBe(false);
    expect(template.shader).toBe('ALPHA');
    expect(template.type).toBe('PARTICLE');
    expect(template.particleName).toBe('EXSmokNew1.tga');
    expect(template.angleZ).toEqual({ min: 0, max: 0.25 });
    expect(template.angularRateZ).toEqual({ min: -0.01, max: 0.01 });
    expect(template.velocityDamping).toEqual({ min: 0.99, max: 0.98 });
    expect(template.gravity).toBeCloseTo(0.01);
    expect(template.lifetime).toEqual({ min: 60, max: 60 });
    expect(template.size).toEqual({ min: 5, max: 5 });
    expect(template.burstDelay).toEqual({ min: 40, max: 40 });
    expect(template.burstCount).toEqual({ min: 0, max: 2 });
    expect(template.velocityType).toBe('OUTWARD');
    expect(template.volumeType).toBe('SPHERE');
    expect(template.volSphereRadius).toBe(4);
    expect(template.windMotion).toBe('Unused');
  });

  it('parses alpha keyframes correctly', () => {
    const block = makeRawBlock('Test', {
      Alpha1: '0.00 0.00 0',
      Alpha2: '1.00 1.00 5',
      Alpha3: '0.00 0.00 60',
    });

    const template = parseParticleSystemTemplate(block);
    expect(template.alphaKeyframes).toHaveLength(2);
    expect(template.alphaKeyframes[0]).toEqual({ alphaMin: 1, alphaMax: 1, frame: 5 });
    expect(template.alphaKeyframes[1]).toEqual({ alphaMin: 0, alphaMax: 0, frame: 60 });
  });

  it('parses color keyframes correctly', () => {
    const block = makeRawBlock('Test', {
      Color1: 'R:255 G:128 B:0 0',
      Color2: 'R:0 G:0 B:0 100',
    });

    const template = parseParticleSystemTemplate(block);
    expect(template.colorKeyframes).toHaveLength(2);
    expect(template.colorKeyframes[0]).toEqual({ r: 255, g: 128, b: 0, frame: 0 });
    expect(template.colorKeyframes[1]).toEqual({ r: 0, g: 0, b: 0, frame: 100 });
  });

  it('parses Vec3 drift velocity', () => {
    const block = makeRawBlock('Test', {
      DriftVelocity: 'X:1.5 Y:-0.5 Z:2.0',
    });

    const template = parseParticleSystemTemplate(block);
    expect(template.driftVelocity).toEqual({ x: 1.5, y: -0.5, z: 2 });
  });

  it('parses STREAK type with LINE volume', () => {
    const block = makeRawBlock('Contrail', {
      Type: 'STREAK',
      Shader: 'ALPHA',
      VolumeType: 'LINE',
      VolLineStart: 'X:8.00 Y:0.00 Z:0.00',
      VolLineEnd: 'X:8.00 Y:0.00 Z:0.00',
      VelocityType: 'ORTHO',
      VelOrthoX: '-2.00 -2.00',
    });

    const template = parseParticleSystemTemplate(block);
    expect(template.type).toBe('STREAK');
    expect(template.volumeType).toBe('LINE');
    expect(template.volLineStart).toEqual({ x: 8, y: 0, z: 0 });
    expect(template.velOrtho.x).toEqual({ min: -2, max: -2 });
  });

  it('parses ADDITIVE shader type', () => {
    const block = makeRawBlock('Flash', { Shader: 'ADDITIVE' });
    expect(parseParticleSystemTemplate(block).shader).toBe('ADDITIVE');
  });

  it('defaults missing fields gracefully', () => {
    const block = makeRawBlock('Empty', {});
    const template = parseParticleSystemTemplate(block);

    expect(template.priority).toBe('NONE');
    expect(template.shader).toBe('ALPHA');
    expect(template.type).toBe('PARTICLE');
    expect(template.gravity).toBe(0);
    expect(template.isOneShot).toBe(false);
    expect(template.volumeType).toBe('POINT');
    expect(template.alphaKeyframes).toHaveLength(0);
    expect(template.colorKeyframes).toHaveLength(0);
  });
});
