import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ParticleSystemManager } from './particle-system-manager.js';
import { IniDataRegistry } from '@generals/ini-data';
import type { IniBlock, IniValue } from '@generals/core';

function makeBlock(type: string, name: string, fields: Record<string, unknown> = {}): IniBlock {
  return { type, name, fields: fields as Record<string, IniValue>, blocks: [] };
}

function createRegistryWithTemplate(): IniDataRegistry {
  const registry = new IniDataRegistry();
  registry.loadBlocks([
    makeBlock('ParticleSystem', 'SmokePuff', {
      Priority: 'WEAPON_EXPLOSION',
      IsOneShot: 'Yes',
      Shader: 'ALPHA',
      Type: 'PARTICLE',
      ParticleName: 'EXSmokNew1.tga',
      Lifetime: '30 30',
      SystemLifetime: '5',
      Size: '1.00 2.00',
      BurstDelay: '1 1',
      BurstCount: '3 3',
      Alpha1: '0.00 0.00 0',
      Alpha2: '1.00 1.00 15',
      Alpha3: '0.00 0.00 30',
      Color1: 'R:255 G:255 B:255 0',
      VelocityType: 'SPHERICAL',
      VelSpherical: '0.5 1.0',
      VolumeType: 'POINT',
    }),
  ]);
  return registry;
}

describe('ParticleSystemManager', () => {
  let scene: THREE.Scene;
  let manager: ParticleSystemManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new ParticleSystemManager(scene);
    manager.loadFromRegistry(createRegistryWithTemplate());
    manager.init();
  });

  it('loads templates from registry', () => {
    expect(manager.getTemplateCount()).toBe(1);
    expect(manager.getTemplate('SmokePuff')).toBeDefined();
  });

  it('creates a particle system and returns an id', () => {
    const id = manager.createSystem('SmokePuff', new THREE.Vector3(10, 0, 10));
    expect(id).not.toBeNull();
    expect(manager.getActiveSystemCount()).toBe(1);
  });

  it('returns null for unknown template', () => {
    const id = manager.createSystem('NonExistent', new THREE.Vector3(0, 0, 0));
    expect(id).toBeNull();
  });

  it('emits particles on update', () => {
    manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0));
    expect(manager.getTotalParticleCount()).toBe(0);

    // First update should trigger burst
    manager.update(1 / 30);
    expect(manager.getTotalParticleCount()).toBeGreaterThan(0);
  });

  it('removes expired particles', () => {
    manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0));

    // Run updates to emit and then age particles past their lifetime
    for (let i = 0; i < 50; i++) {
      manager.update(1 / 30);
    }

    // System has systemLifetime=5, particles have lifetime=30
    // After 50 frames: system stopped emitting at frame 5, particles all expired by frame 35
    expect(manager.getActiveSystemCount()).toBe(0);
    expect(manager.getTotalParticleCount()).toBe(0);
  });

  it('destroys system manually', () => {
    const id = manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0))!;
    manager.destroySystem(id);
    manager.update(1 / 30);
    // System should be cleaned up after next update
    expect(manager.getActiveSystemCount()).toBe(0);
  });

  it('resets all state', () => {
    manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0));
    manager.update(1 / 30);
    expect(manager.getActiveSystemCount()).toBe(1);

    manager.reset();
    expect(manager.getActiveSystemCount()).toBe(0);
    expect(manager.getTotalParticleCount()).toBe(0);
  });

  it('creates instanced mesh in scene', () => {
    manager.createSystem('SmokePuff', new THREE.Vector3(5, 0, 5));
    manager.update(1 / 30);

    // Check scene has instanced mesh
    const instancedMeshes = scene.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(instancedMeshes.length).toBeGreaterThan(0);
  });

  it('respects particle cap', () => {
    // Create many systems to hit the cap
    for (let i = 0; i < 100; i++) {
      manager.createSystem('SmokePuff', new THREE.Vector3(i, 0, 0));
    }

    // Run many updates
    for (let i = 0; i < 10; i++) {
      manager.update(1 / 30);
    }

    expect(manager.getTotalParticleCount()).toBeLessThanOrEqual(3000);
  });
});
