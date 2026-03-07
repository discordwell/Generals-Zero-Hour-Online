import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { FXListManager } from './fx-list-manager.js';
import { ParticleSystemManager } from './particle-system-manager.js';
import { IniDataRegistry } from '@generals/ini-data';
import type { IniBlock, IniValue } from '@generals/core';

function makeBlock(type: string, name: string, fields: Record<string, unknown> = {}, blocks: IniBlock[] = []): IniBlock {
  return { type, name, fields: fields as Record<string, IniValue>, blocks };
}

function createTestRegistry(): IniDataRegistry {
  const registry = new IniDataRegistry();
  registry.loadBlocks([
    makeBlock('ParticleSystem', 'SmokePuff', {
      Priority: 'WEAPON_EXPLOSION',
      IsOneShot: 'Yes',
      Shader: 'ALPHA',
      Lifetime: '10 10',
      SystemLifetime: '1',
      BurstCount: '1 1',
      BurstDelay: '1 1',
      VolumeType: 'POINT',
      VelocityType: 'ORTHO',
    }),
    makeBlock('FXList', 'FX_TankExplosion', {}, [
      makeBlock('ParticleSystem', '', { Name: 'SmokePuff' }),
      makeBlock('Sound', '', { Name: 'ExplosionLarge' }),
      makeBlock('ViewShake', '', { Type: 'SEVERE' }),
      makeBlock('TerrainScorch', '', { Type: 'RANDOM', Radius: '10' }),
      makeBlock('LightPulse', '', { Color: 'R:255 G:128 B:51', Radius: '30', IncreaseTime: '0', DecreaseTime: '2000' }),
    ]),
    makeBlock('FXList', 'FX_Empty', {}, []),
  ]);
  return registry;
}

describe('FXListManager', () => {
  let scene: THREE.Scene;
  let particleManager: ParticleSystemManager;
  let fxManager: FXListManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    const registry = createTestRegistry();
    particleManager = new ParticleSystemManager(scene);
    particleManager.loadFromRegistry(registry);
    fxManager = new FXListManager(particleManager);
    fxManager.loadFromRegistry(registry);
    fxManager.init();
  });

  it('loads FXList templates from registry', () => {
    expect(fxManager.getTemplateCount()).toBe(2);
    expect(fxManager.hasFXList('FX_TankExplosion')).toBe(true);
    expect(fxManager.hasFXList('FX_Empty')).toBe(true);
  });

  it('triggers particle system nuggets', () => {
    const pos = new THREE.Vector3(10, 0, 10);
    const count = fxManager.triggerFXList('FX_TankExplosion', pos);
    expect(count).toBeGreaterThan(0);
    expect(particleManager.getActiveSystemCount()).toBe(1);
  });

  it('triggers sound callback', () => {
    const onSound = vi.fn();
    fxManager.setCallbacks({ onSound });

    fxManager.triggerFXList('FX_TankExplosion', new THREE.Vector3(0, 0, 0));
    expect(onSound).toHaveBeenCalledWith('ExplosionLarge', expect.any(THREE.Vector3));
  });

  it('triggers view shake callback', () => {
    const onViewShake = vi.fn();
    fxManager.setCallbacks({ onViewShake });

    fxManager.triggerFXList('FX_TankExplosion', new THREE.Vector3(0, 0, 0));
    expect(onViewShake).toHaveBeenCalledWith('SEVERE', expect.any(THREE.Vector3));
  });

  it('triggers terrain scorch callback', () => {
    const onTerrainScorch = vi.fn();
    fxManager.setCallbacks({ onTerrainScorch });

    fxManager.triggerFXList('FX_TankExplosion', new THREE.Vector3(0, 0, 0));
    expect(onTerrainScorch).toHaveBeenCalledWith('RANDOM', 10, expect.any(THREE.Vector3));
  });

  it('triggers light pulse callback', () => {
    const onLightPulse = vi.fn();
    fxManager.setCallbacks({ onLightPulse });

    fxManager.triggerFXList('FX_TankExplosion', new THREE.Vector3(0, 0, 0));
    expect(onLightPulse).toHaveBeenCalledWith(
      { r: 255, g: 128, b: 51 },
      30,
      0,
      2000,
      expect.any(THREE.Vector3),
    );
  });

  it('returns 0 for unknown FXList', () => {
    const count = fxManager.triggerFXList('FX_NonExistent', new THREE.Vector3(0, 0, 0));
    expect(count).toBe(0);
  });

  it('returns 0 for empty FXList', () => {
    const count = fxManager.triggerFXList('FX_Empty', new THREE.Vector3(0, 0, 0));
    expect(count).toBe(0);
  });

  it('triggers all nuggets in a multi-nugget FXList', () => {
    const onSound = vi.fn();
    const onViewShake = vi.fn();
    const onTerrainScorch = vi.fn();
    const onLightPulse = vi.fn();
    fxManager.setCallbacks({ onSound, onViewShake, onTerrainScorch, onLightPulse });

    const count = fxManager.triggerFXList('FX_TankExplosion', new THREE.Vector3(5, 0, 5));

    // ParticleSystem(1) + Sound(1) + ViewShake(1) + TerrainScorch(1) + LightPulse(1) = 5
    expect(count).toBe(5);
    expect(onSound).toHaveBeenCalledTimes(1);
    expect(onViewShake).toHaveBeenCalledTimes(1);
    expect(onTerrainScorch).toHaveBeenCalledTimes(1);
    expect(onLightPulse).toHaveBeenCalledTimes(1);
  });
});
