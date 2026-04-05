import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  ParticleSystemManager,
  PARTICLE_STRIDE,
  POS_X,
  POS_Z,
  VEL_X,
  VEL_Y,
  VEL_Z,
  ALPHA,
  VEL_DAMP,
  ANG_DAMP,
  ALPHA_FACTOR,
  getProceduralGradientTexture,
  _resetProceduralTexture,
} from './particle-system-manager.js';
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

  it('captures and restores live particle systems', () => {
    const id = manager.createSystem('SmokePuff', new THREE.Vector3(5, 2, 7))!;
    manager.update(1 / 30);
    manager.update(1 / 30);

    const saved = manager.captureSaveState();
    const dataBefore = manager._getSystemParticleData(id);
    expect(dataBefore).not.toBeNull();

    const restoredScene = new THREE.Scene();
    const restoredManager = new ParticleSystemManager(restoredScene);
    restoredManager.loadFromRegistry(createRegistryWithTemplate());
    restoredManager.init();
    restoredManager.restoreSaveState(saved);

    expect(restoredManager.getActiveSystemCount()).toBe(1);
    expect(restoredManager.getTotalParticleCount()).toBe(manager.getTotalParticleCount());

    const restoredData = restoredManager._getSystemParticleData(id);
    expect(restoredData?.count).toBe(dataBefore?.count);
    expect(Array.from(restoredData?.data.slice(0, restoredData.count * PARTICLE_STRIDE) ?? []))
      .toEqual(Array.from(dataBefore?.data.slice(0, dataBefore.count * PARTICLE_STRIDE) ?? []));

    const restoredInfo = restoredManager._getSystemInfo(id);
    expect(restoredInfo?.mesh).not.toBeNull();
    expect(restoredInfo?.alive).toBe(true);
  });

  it('restores saved templates that were not preloaded in the registry', () => {
    const id = manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0))!;
    manager.update(1 / 30);
    const saved = manager.captureSaveState();

    const restoredManager = new ParticleSystemManager(new THREE.Scene());
    restoredManager.init();
    restoredManager.restoreSaveState(saved);

    expect(restoredManager.getTemplate('SmokePuff')).toBeDefined();
    expect(restoredManager.getActiveSystemCount()).toBe(1);
    expect(restoredManager._getSystemParticleData(id)?.count).toBeGreaterThan(0);
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

  it('damping value is constant per-particle across frames', () => {
    // Use a template with a damping range so the per-particle value matters
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'DampTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '100 100',
        SystemLifetime: '1',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityDamping: '0.5 0.9',
        AngularDamping: '0.3 0.7',
        VelocityType: 'ORTHO',
        VelOrthoX: '1 1',
        VelOrthoY: '1 1',
        VelOrthoZ: '1 1',
        VolumeType: 'POINT',
      }),
    ]);
    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const id = mgr.createSystem('DampTest', new THREE.Vector3(0, 0, 0))!;
    expect(id).not.toBeNull();

    // First update emits the particle
    mgr.update(1 / 30);
    const info1 = mgr._getSystemParticleData(id)!;
    expect(info1.count).toBe(1);

    // Read damping values after frame 1
    const velDamp1 = info1.data[0 * PARTICLE_STRIDE + VEL_DAMP]!;
    const angDamp1 = info1.data[0 * PARTICLE_STRIDE + ANG_DAMP]!;

    // Second update
    mgr.update(1 / 30);
    const info2 = mgr._getSystemParticleData(id)!;
    expect(info2.count).toBe(1);

    // Read damping values after frame 2 — should be identical
    const velDamp2 = info2.data[0 * PARTICLE_STRIDE + VEL_DAMP]!;
    const angDamp2 = info2.data[0 * PARTICLE_STRIDE + ANG_DAMP]!;

    expect(velDamp2).toBe(velDamp1);
    expect(angDamp2).toBe(angDamp1);

    // Also verify damping is within the configured range
    expect(velDamp1).toBeGreaterThanOrEqual(0.5);
    expect(velDamp1).toBeLessThanOrEqual(0.9);
    expect(angDamp1).toBeGreaterThanOrEqual(0.3);
    expect(angDamp1).toBeLessThanOrEqual(0.7);
  });

  it('alpha varies between particles with same keyframes', () => {
    // Use a template with distinct alphaMin/alphaMax ranges
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'AlphaVaryTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '100 100',
        SystemLifetime: '2',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '20 20',
        Alpha1: '0.00 1.00 0',     // wide alphaMin/alphaMax range
        Alpha2: '0.00 1.00 100',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
      }),
    ]);
    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const id = mgr.createSystem('AlphaVaryTest', new THREE.Vector3(0, 0, 0))!;
    mgr.update(1 / 30); // emit particles

    const info = mgr._getSystemParticleData(id)!;
    expect(info.count).toBeGreaterThanOrEqual(2);

    // Collect per-particle alpha factors
    const factors = new Set<number>();
    for (let i = 0; i < info.count; i++) {
      factors.add(info.data[i * PARTICLE_STRIDE + ALPHA_FACTOR]!);
    }

    // With 20 particles, alpha factors should not all be the same
    expect(factors.size).toBeGreaterThan(1);

    // Verify alpha values also differ (since factors differ and range is 0..1)
    const alphas = new Set<number>();
    for (let i = 0; i < info.count; i++) {
      alphas.add(info.data[i * PARTICLE_STRIDE + ALPHA]!);
    }
    expect(alphas.size).toBeGreaterThan(1);
  });

  it('physics order: gravity applied before damping', () => {
    // Gravity should be added to velocity BEFORE damping multiplies it.
    // If order is: vel_y = (vel_y - gravity) * damp
    // Then with vel_y=0, gravity=10, damp=0.5: result = (0-10)*0.5 = -5
    // Wrong order (damp then gravity): result = 0*0.5 - 10 = -10
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'PhysicsOrderTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '100 100',
        SystemLifetime: '2',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        Gravity: '10',
        VelocityDamping: '0.5 0.5',  // Fixed damping (no range)
        VelocityType: 'ORTHO',
        VelOrthoX: '0 0',
        VelOrthoY: '0 0',
        VelOrthoZ: '0 0',
        VolumeType: 'POINT',
      }),
    ]);
    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const id = mgr.createSystem('PhysicsOrderTest', new THREE.Vector3(0, 0, 0))!;
    // First update: emit particle with vel_y = 0
    mgr.update(1 / 30);

    const info = mgr._getSystemParticleData(id)!;
    expect(info.count).toBe(1);

    // After first update tick, the particle has been updated:
    // Correct order: vel_y = (0 - 10) * 0.5 = -5
    // Wrong order:   vel_y = (0 * 0.5) - 10 = -10
    const velY = info.data[0 * PARTICLE_STRIDE + VEL_Y]!;
    expect(velY).toBeCloseTo(-5, 5);
  });

  // -------------------------------------------------------------------------
  // Fix #1: Slave/Attached Particle Systems
  // -------------------------------------------------------------------------

  it('creates slave system when template has SlaveSystem', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'ParentSmoke', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '30 30',
        SystemLifetime: '5',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
        SlaveSystem: 'ChildSmoke',
        SlavePosOffset: 'X:5.0 Y:10.0 Z:0.0',
      }),
      makeBlock('ParticleSystem', 'ChildSmoke', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '30 30',
        SystemLifetime: '5',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const parentId = mgr.createSystem('ParentSmoke', new THREE.Vector3(0, 0, 0))!;
    expect(parentId).not.toBeNull();

    // Parent + slave = 2 active systems
    expect(mgr.getActiveSystemCount()).toBe(2);

    // Check slave system ID is stored
    const info = mgr._getSystemInfo(parentId)!;
    expect(info.slaveSystemId).toBeDefined();
    expect(info.slaveSystemId).not.toBeNull();

    // Destroy parent should cascade to slave
    mgr.destroySystem(parentId);
    mgr.update(1 / 30);

    // Both systems removed after update
    expect(mgr.getActiveSystemCount()).toBe(0);
  });

  it('creates and destroys attached particle systems per-particle', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'ParentTrail', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '30 30',
        SystemLifetime: '5',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '2 2',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
        AttachedSystem: 'TrailSmoke',
      }),
      makeBlock('ParticleSystem', 'TrailSmoke', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '30 30',
        SystemLifetime: '50',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const parentId = mgr.createSystem('ParentTrail', new THREE.Vector3(0, 0, 0))!;
    expect(parentId).not.toBeNull();

    // Before first update, only the parent exists (no attached yet)
    expect(mgr.getActiveSystemCount()).toBe(1);

    // First update emits 2 particles, each gets an attached system
    mgr.update(1 / 30);

    const info = mgr._getSystemInfo(parentId)!;
    expect(info.attachedParticleSystems).toBeDefined();
    // 2 particles emitted = 2 attached child systems
    expect(info.attachedParticleSystems!.size).toBe(2);

    // Parent + 2 attached = 3 active systems
    expect(mgr.getActiveSystemCount()).toBe(3);

    // Cascade destroy: destroying parent should destroy attached children
    mgr.destroySystem(parentId);
    mgr.update(1 / 30);

    expect(mgr.getActiveSystemCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Fix #2: Wind Motion
  // -------------------------------------------------------------------------

  it('wind PingPong causes lateral drift vs non-wind baseline', () => {
    // Create two registries: one with wind, one without
    const registryNoWind = new IniDataRegistry();
    registryNoWind.loadBlocks([
      makeBlock('ParticleSystem', 'NoWindTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '100 100',
        SystemLifetime: '50',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityDamping: '1.0 1.0',
        VelocityType: 'ORTHO',
        VelOrthoX: '0 0',
        VelOrthoY: '1 1',
        VelOrthoZ: '0 0',
        VolumeType: 'POINT',
      }),
    ]);

    const registryWithWind = new IniDataRegistry();
    registryWithWind.loadBlocks([
      makeBlock('ParticleSystem', 'WindTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '100 100',
        SystemLifetime: '50',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityDamping: '1.0 1.0',
        WindMotion: 'PingPong',
        WindAngleChangeMin: '0.3',
        WindAngleChangeMax: '0.3',
        WindPingPongStartAngleMin: '0',
        WindPingPongStartAngleMax: '0',
        WindPingPongEndAngleMin: '6.28',
        WindPingPongEndAngleMax: '6.28',
        VelocityType: 'ORTHO',
        VelOrthoX: '0 0',
        VelOrthoY: '1 1',
        VelOrthoZ: '0 0',
        VolumeType: 'POINT',
      }),
    ]);

    // Non-wind system
    const scene1 = new THREE.Scene();
    const mgr1 = new ParticleSystemManager(scene1);
    mgr1.loadFromRegistry(registryNoWind);
    mgr1.init();
    const id1 = mgr1.createSystem('NoWindTest', new THREE.Vector3(0, 0, 0))!;

    // Wind system
    const scene2 = new THREE.Scene();
    const mgr2 = new ParticleSystemManager(scene2);
    mgr2.loadFromRegistry(registryWithWind);
    mgr2.init();
    const id2 = mgr2.createSystem('WindTest', new THREE.Vector3(0, 0, 0))!;

    // Run several frames
    for (let i = 0; i < 10; i++) {
      mgr1.update(1 / 30);
      mgr2.update(1 / 30);
    }

    const info1 = mgr1._getSystemParticleData(id1)!;
    const info2 = mgr2._getSystemParticleData(id2)!;

    expect(info1.count).toBeGreaterThanOrEqual(1);
    expect(info2.count).toBeGreaterThanOrEqual(1);

    // Non-wind: vel_x should remain 0 (only vertical velocity)
    const noWindVelX = info1.data[0 * PARTICLE_STRIDE + VEL_X]!;
    expect(noWindVelX).toBeCloseTo(0, 5);

    // Wind: check the first particle's position — it should have lateral drift
    // Sum lateral position displacement across all particles for a robust check
    const windPosX = info2.data[0 * PARTICLE_STRIDE + POS_X]!;
    const windPosZ = info2.data[0 * PARTICLE_STRIDE + POS_Z]!;
    const lateralPos = Math.sqrt(windPosX * windPosX + windPosZ * windPosZ);
    expect(lateralPos).toBeGreaterThan(0.1);

    // Also verify wind system info has wind state
    const windInfo = mgr2._getSystemInfo(id2)!;
    expect(windInfo.windAngle).toBeDefined();
    expect(typeof windInfo.windAngleChange).toBe('number');
  });

  it('wind Circular continuously increments wind angle', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'CircularWindTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'PARTICLE',
        Lifetime: '100 100',
        SystemLifetime: '50',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '1 1',
        VelocityDamping: '1.0 1.0',
        WindMotion: 'Circular',
        WindAngleChangeMin: '0.5',
        WindAngleChangeMax: '0.5',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const id = mgr.createSystem('CircularWindTest', new THREE.Vector3(0, 0, 0))!;
    const info0 = mgr._getSystemInfo(id)!;
    const initialAngle = info0.windAngle;

    // Run a few frames
    for (let i = 0; i < 5; i++) {
      mgr.update(1 / 30);
    }

    const info1 = mgr._getSystemInfo(id)!;
    // windAngle should have increased by approximately 5 * 0.5 = 2.5
    expect(info1.windAngle).toBeGreaterThan(initialAngle);
    expect(info1.windAngle).toBeCloseTo(initialAngle + 5 * 0.5, 1);
  });

  // -------------------------------------------------------------------------
  // Fix #3: STREAK Particle Rendering
  // -------------------------------------------------------------------------

  it('STREAK type renders as LineSegments instead of InstancedMesh', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'StreakTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'STREAK',
        Lifetime: '30 30',
        SystemLifetime: '5',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '3 3',
        VelocityType: 'SPHERICAL',
        VelSpherical: '0.5 1.0',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const id = mgr.createSystem('StreakTest', new THREE.Vector3(0, 0, 0))!;
    expect(id).not.toBeNull();

    // Verify prevPositions buffer was allocated
    const info = mgr._getSystemInfo(id)!;
    expect(info.prevPositions).toBeDefined();
    expect(info.prevPositions).toBeInstanceOf(Float32Array);

    // Run an update to emit and render particles
    mgr.update(1 / 30);

    // Verify scene contains LineSegments, not InstancedMesh
    const lineSegments = scene2.children.filter((c) => c instanceof THREE.LineSegments);
    const instancedMeshes = scene2.children.filter((c) => c instanceof THREE.InstancedMesh);

    expect(lineSegments.length).toBeGreaterThan(0);
    expect(instancedMeshes.length).toBe(0);

    // Verify LineSegments has position and color attributes
    const ls = lineSegments[0] as THREE.LineSegments;
    expect(ls.geometry.getAttribute('position')).toBeDefined();
    expect(ls.geometry.getAttribute('color')).toBeDefined();

    // Verify color attribute has 4 components (RGBA) for trailing edge fade
    const colorAttr = ls.geometry.getAttribute('color');
    expect(colorAttr.itemSize).toBe(4);

    // Check trailing edge alpha (first vertex of first segment should be 0)
    const colorArray = (colorAttr as THREE.BufferAttribute).array as Float32Array;
    // First vertex alpha (index 3 in RGBA) should be 0
    expect(colorArray[3]).toBe(0);
  });

  it('STREAK prevPositions are compacted when particles die', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'StreakCompactTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA',
        Type: 'STREAK',
        Lifetime: '3 3',       // Short lifetime so particles die quickly
        SystemLifetime: '2',   // Stop emitting after 2 frames
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '2 2',
        VelocityType: 'ORTHO',
        VelOrthoX: '1 1',
        VelOrthoY: '0 0',
        VelOrthoZ: '0 0',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    const id = mgr.createSystem('StreakCompactTest', new THREE.Vector3(0, 0, 0))!;

    // First update: emit 2 particles
    mgr.update(1 / 30);
    const data1 = mgr._getSystemParticleData(id)!;
    expect(data1.count).toBe(2);

    // Run until particles die (lifetime = 3 frames)
    for (let i = 0; i < 5; i++) {
      mgr.update(1 / 30);
    }

    // All particles should have expired
    const data2 = mgr._getSystemParticleData(id);
    // System may be removed entirely or have 0 particles
    if (data2) {
      expect(data2.count).toBe(0);
    }
  });

  it('non-STREAK systems do not allocate prevPositions', () => {
    const id = manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0))!;
    const info = manager._getSystemInfo(id)!;
    expect(info.prevPositions).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Particle Texture Support
  // -------------------------------------------------------------------------

  it('particle material has a map (texture) when template specifies ParticleName', () => {
    // The default SmokePuff template has ParticleName: 'EXSmokNew1.tga'
    manager.createSystem('SmokePuff', new THREE.Vector3(0, 0, 0));
    manager.update(1 / 30);

    // Find the instanced mesh in the scene
    const instancedMeshes = scene.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(instancedMeshes.length).toBeGreaterThan(0);

    const mesh = instancedMeshes[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.map).not.toBeNull();
    expect(material.map).toBeDefined();
    // The texture should be a DataTexture (procedural gradient fallback)
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
  });

  it('ADDITIVE shader applies AdditiveBlending with texture', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'AdditiveTest', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ADDITIVE',
        Type: 'PARTICLE',
        ParticleName: 'EXFlash1.tga',
        Lifetime: '30 30',
        SystemLifetime: '5',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '3 3',
        VelocityType: 'SPHERICAL',
        VelSpherical: '0.5 1.0',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    mgr.createSystem('AdditiveTest', new THREE.Vector3(0, 0, 0));
    mgr.update(1 / 30);

    const instancedMeshes = scene2.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(instancedMeshes.length).toBeGreaterThan(0);

    const mesh = instancedMeshes[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.MeshBasicMaterial;

    // Has texture
    expect(material.map).not.toBeNull();
    // Uses additive blending
    expect(material.blending).toBe(THREE.AdditiveBlending);
    // Transparent
    expect(material.transparent).toBe(true);
    // No depth write (so additive particles don't occlude each other)
    expect(material.depthWrite).toBe(false);
  });

  it('ALPHA_TEST shader applies alphaTest threshold with texture', () => {
    const registry = new IniDataRegistry();
    registry.loadBlocks([
      makeBlock('ParticleSystem', 'AlphaTestSys', {
        Priority: 'WEAPON_EXPLOSION',
        IsOneShot: 'Yes',
        Shader: 'ALPHA_TEST',
        Type: 'PARTICLE',
        ParticleName: 'Debris.tga',
        Lifetime: '30 30',
        SystemLifetime: '5',
        Size: '1 1',
        BurstDelay: '1 1',
        BurstCount: '2 2',
        VelocityType: 'ORTHO',
        VolumeType: 'POINT',
      }),
    ]);

    const scene2 = new THREE.Scene();
    const mgr = new ParticleSystemManager(scene2);
    mgr.loadFromRegistry(registry);
    mgr.init();

    mgr.createSystem('AlphaTestSys', new THREE.Vector3(0, 0, 0));
    mgr.update(1 / 30);

    const instancedMeshes = scene2.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(instancedMeshes.length).toBeGreaterThan(0);

    const mesh = instancedMeshes[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.MeshBasicMaterial;

    // Has texture
    expect(material.map).not.toBeNull();
    // Uses alpha test
    expect(material.alphaTest).toBe(0.5);
  });

  it('procedural gradient texture is a valid 64x64 RGBA DataTexture', () => {
    _resetProceduralTexture(); // Start fresh
    const texture = getProceduralGradientTexture();

    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture.image.width).toBe(64);
    expect(texture.image.height).toBe(64);

    const data = texture.image.data as Uint8Array;
    expect(data.length).toBe(64 * 64 * 4);

    // Center pixel should be fully opaque white
    const centerX = 31;
    const centerY = 31;
    const centerIdx = (centerY * 64 + centerX) * 4;
    expect(data[centerIdx]).toBe(255);     // R
    expect(data[centerIdx + 1]).toBe(255); // G
    expect(data[centerIdx + 2]).toBe(255); // B
    expect(data[centerIdx + 3]).toBeGreaterThan(200); // A — near-opaque at center

    // Corner pixel should be fully transparent
    const cornerIdx = 0; // top-left (0, 0)
    expect(data[cornerIdx + 3]).toBe(0); // A — transparent at edge
  });

  it('procedural gradient texture is cached across calls', () => {
    _resetProceduralTexture();
    const tex1 = getProceduralGradientTexture();
    const tex2 = getProceduralGradientTexture();
    expect(tex1).toBe(tex2); // Same instance
  });
});
