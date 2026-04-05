/**
 * ParticleSystemManager — core particle runtime using flat Float32Array pools
 * and InstancedMesh rendering.
 *
 * Source parity: ParticleSys.cpp ParticleSystemManager
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import type { IniDataRegistry } from '@generals/ini-data';
import type { GameLODManager } from './game-lod-manager.js';
import {
  parseParticleSystemTemplate,
  type ParticleSystemTemplate,
  type ParticleShaderType,
  type RandomRange,
  type AlphaKeyframe,
  type ColorKeyframe,
} from './particle-system-template.js';

// ---------------------------------------------------------------------------
// Per-particle data layout (flat Float32Array)
// ---------------------------------------------------------------------------
// Each particle occupies PARTICLE_STRIDE floats:
//   [0..2]  position (x, y, z)
//   [3..5]  velocity (vx, vy, vz)
//   [6]     alpha
//   [7..9]  color (r, g, b) normalized 0..1
//   [10]    size
//   [11]    age (frames elapsed)
//   [12]    maxAge (lifetime)
//   [13]    rotation (radians)
//   [14]    angularRate
//   [15]    sizeRate
//   [16]    sizeRateDamping
//   [17]    velocityDamping (sampled once at emission)
//   [18]    angularDamping (sampled once at emission)
//   [19]    alphaFactor (per-particle random [0,1] for alpha keyframe lerp)

export const PARTICLE_STRIDE = 20;
export const POS_X = 0;
export const POS_Y = 1;
export const POS_Z = 2;
export const VEL_X = 3;
export const VEL_Y = 4;
export const VEL_Z = 5;
export const ALPHA = 6;
export const COL_R = 7;
export const COL_G = 8;
export const COL_B = 9;
export const SIZE = 10;
export const AGE = 11;
export const MAX_AGE = 12;
export const ROTATION = 13;
export const ANG_RATE = 14;
export const SIZE_RATE = 15;
export const SIZE_RATE_DAMP = 16;
export const VEL_DAMP = 17;
export const ANG_DAMP = 18;
export const ALPHA_FACTOR = 19;

// ---------------------------------------------------------------------------
// Wind constants
// Source parity: C++ uses 2.0 * m_windRandomness where m_windRandomness ∈ [0.7, 1.3]
// giving an effective strength per particle of ~1.4–2.6.  We use a fixed 2.0 (midpoint).
// ---------------------------------------------------------------------------

const WIND_STRENGTH = 2.0;

// ---------------------------------------------------------------------------
// Live system instance
// ---------------------------------------------------------------------------

interface ParticleSystemInstance {
  id: number;
  template: ParticleSystemTemplate;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  particles: Float32Array;
  particleCount: number;
  maxParticles: number;
  burstTimer: number;
  systemAge: number;
  initialDelayRemaining: number;
  alive: boolean;
  // Rendering
  mesh: THREE.Object3D | null;
  instanceMatrix: THREE.InstancedBufferAttribute | null;
  instanceColor: THREE.InstancedBufferAttribute | null;
  instanceAlpha: THREE.InstancedBufferAttribute | null;
  // Slave/Attached systems (Fix #1)
  slaveSystemId?: number;
  masterSystemId?: number;
  attachedParticleSystems?: Map<number, number>;
  // Wind motion state (Fix #2)
  // Source parity: ParticleSys.cpp:2205-2289
  windAngle: number;
  windAngleChange: number;
  windMotionMovingToEnd: boolean;
  /** Stable target angle for current PingPong swing direction. */
  windPingPongTargetAngle: number;
  // STREAK previous positions (Fix #3)
  prevPositions?: Float32Array;
}

export interface ParticleSystemInstanceSaveState {
  id: number;
  template: ParticleSystemTemplate;
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  particleCount: number;
  particles: number[];
  burstTimer: number;
  systemAge: number;
  initialDelayRemaining: number;
  alive: boolean;
  windAngle: number;
  windAngleChange: number;
  windMotionMovingToEnd: boolean;
  windPingPongTargetAngle: number;
  slaveSystemId: number | null;
  masterSystemId: number | null;
  attachedParticleSystems: Array<[number, number]>;
  prevPositions: number[] | null;
}

export interface ParticleSystemManagerSaveState {
  version: 1;
  nextId: number;
  systems: ParticleSystemInstanceSaveState[];
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARTICLES_PER_SYSTEM = 200;
const BILLBOARD_QUAD = createBillboardGeometry();

function createBillboardGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

// ---------------------------------------------------------------------------
// Procedural radial gradient texture — soft circular falloff
// Used as a universal particle texture when real .tga assets are not available.
// Source parity: the original game uses TGA textures for particles; this is
// a procedural stand-in that gives particles a rounded, soft-edged look.
// ---------------------------------------------------------------------------

/** Cached procedural texture (shared by all particle systems). */
let proceduralGradientTexture: THREE.DataTexture | null = null;

/**
 * Create (or return cached) a 64x64 RGBA radial gradient texture.
 * The center is fully opaque white, fading smoothly to fully transparent at
 * the edges with a quadratic falloff for a natural particle look.
 */
export function getProceduralGradientTexture(): THREE.DataTexture {
  if (proceduralGradientTexture) return proceduralGradientTexture;

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const maxRadius = center;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(dist / maxRadius, 1.0);
      // Quadratic falloff: bright center → transparent edge
      const alpha = Math.max(0, 1 - t * t);

      const idx = (y * size + x) * 4;
      data[idx] = 255;     // R
      data[idx + 1] = 255; // G
      data[idx + 2] = 255; // B
      data[idx + 3] = Math.round(alpha * 255); // A
    }
  }

  proceduralGradientTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  proceduralGradientTexture.needsUpdate = true;
  return proceduralGradientTexture;
}

/** Reset cached procedural texture — used in tests. */
export function _resetProceduralTexture(): void {
  if (proceduralGradientTexture) {
    proceduralGradientTexture.dispose();
    proceduralGradientTexture = null;
  }
}

export class ParticleSystemManager implements Subsystem {
  readonly name = 'ParticleSystemManager';

  private readonly scene: THREE.Scene;
  private readonly lodManager: GameLODManager | null;
  private readonly templates = new Map<string, ParticleSystemTemplate>();
  private readonly systems = new Map<number, ParticleSystemInstance>();
  private nextId = 1;
  private totalParticleCount = 0;

  // Shared materials by shader type
  private readonly materialCache = new Map<string, THREE.Material>();

  // Temp objects to avoid GC
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempScale = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempColor = new THREE.Color();

  constructor(scene: THREE.Scene, lodManager?: GameLODManager) {
    this.scene = scene;
    this.lodManager = lodManager ?? null;
  }

  init(): void {
    // Templates are loaded via loadFromRegistry
  }

  update(dt: number): void {
    for (const [id, system] of this.systems) {
      if (!system.alive) {
        this.removeSystem(id);
        continue;
      }
      this.updateSystem(system, dt);
      this.syncInstancedMesh(system);
    }
  }

  reset(): void {
    for (const [id] of this.systems) {
      this.removeSystem(id);
    }
    this.systems.clear();
    this.totalParticleCount = 0;
    this.nextId = 1;
  }

  dispose(): void {
    this.reset();
    for (const material of this.materialCache.values()) {
      material.dispose();
    }
    this.materialCache.clear();
    this.templates.clear();
    _resetProceduralTexture();
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  loadFromRegistry(registry: IniDataRegistry): void {
    for (const [, block] of registry.particleSystems) {
      const template = parseParticleSystemTemplate(block);
      this.templates.set(template.name, template);
    }
  }

  getTemplate(name: string): ParticleSystemTemplate | undefined {
    return this.templates.get(name);
  }

  getTemplateCount(): number {
    return this.templates.size;
  }

  // -------------------------------------------------------------------------
  // System lifecycle
  // -------------------------------------------------------------------------

  createSystem(
    templateName: string,
    position: THREE.Vector3,
    orientation?: THREE.Quaternion,
  ): number | null {
    const template = this.templates.get(templateName);
    if (!template) return null;

    // Check LOD priority culling
    if (this.lodManager && this.lodManager.shouldSkipParticle(template.priority)) {
      return null;
    }

    // Check particle cap
    const cap = this.lodManager?.getParticleCap() ?? 3000;
    if (this.totalParticleCount >= cap) {
      return null;
    }

    const id = this.nextId++;
    const maxParticles = Math.min(
      DEFAULT_MAX_PARTICLES_PER_SYSTEM,
      cap - this.totalParticleCount,
    );

    const system: ParticleSystemInstance = {
      id,
      template,
      position: position.clone(),
      orientation: orientation?.clone() ?? new THREE.Quaternion(),
      particles: new Float32Array(maxParticles * PARTICLE_STRIDE),
      particleCount: 0,
      maxParticles,
      burstTimer: 0,
      systemAge: 0,
      initialDelayRemaining: randomInRange(template.initialDelay),
      alive: true,
      mesh: null,
      instanceMatrix: null,
      instanceColor: null,
      instanceAlpha: null,
      // Wind motion state
      windAngle: randomInRange({
        min: template.windPingPongStartAngleMin,
        max: template.windPingPongStartAngleMax,
      }),
      windAngleChange: randomInRange({
        min: template.windAngleChangeMin,
        max: template.windAngleChangeMax,
      }),
      windMotionMovingToEnd: true,
      windPingPongTargetAngle: randomInRange({
        min: template.windPingPongEndAngleMin,
        max: template.windPingPongEndAngleMax,
      }),
    };

    // STREAK systems need a separate prevPositions buffer
    if (template.type === 'STREAK') {
      system.prevPositions = new Float32Array(maxParticles * 3);
    }

    // Attached systems need a mapping of particle index → child system ID
    if (template.attachedSystemName) {
      system.attachedParticleSystems = new Map();
    }

    this.systems.set(id, system);

    // Create slave system if template specifies one
    if (template.slaveSystemName) {
      const slavePos = position.clone();
      if (template.slavePosOffset) {
        slavePos.x += template.slavePosOffset.x;
        slavePos.y += template.slavePosOffset.y;
        slavePos.z += template.slavePosOffset.z;
      }
      const slaveId = this.createSystem(template.slaveSystemName, slavePos, orientation);
      if (slaveId !== null) {
        system.slaveSystemId = slaveId;
        const slaveSystem = this.systems.get(slaveId);
        if (slaveSystem) {
          slaveSystem.masterSystemId = id;
        }
      }
    }

    return id;
  }

  destroySystem(id: number): void {
    const system = this.systems.get(id);
    if (system) {
      system.alive = false;
      // Cascade destroy slave system
      if (system.slaveSystemId !== undefined) {
        this.destroySystem(system.slaveSystemId);
      }
      // Cascade destroy attached particle systems
      if (system.attachedParticleSystems) {
        for (const childId of system.attachedParticleSystems.values()) {
          this.destroySystem(childId);
        }
        system.attachedParticleSystems.clear();
      }
    }
  }

  getActiveSystemCount(): number {
    return this.systems.size;
  }

  getTotalParticleCount(): number {
    return this.totalParticleCount;
  }

  /** @internal — exposes raw particle data for testing */
  _getSystemParticleData(id: number): { data: Float32Array; count: number } | null {
    const system = this.systems.get(id);
    if (!system) return null;
    return { data: system.particles, count: system.particleCount };
  }

  /** @internal — exposes system instance details for testing */
  _getSystemInfo(id: number): {
    slaveSystemId?: number;
    masterSystemId?: number;
    attachedParticleSystems?: Map<number, number>;
    windAngle: number;
    windAngleChange: number;
    windMotionMovingToEnd: boolean;
    mesh: THREE.Object3D | null;
    alive: boolean;
    prevPositions?: Float32Array;
  } | null {
    const system = this.systems.get(id);
    if (!system) return null;
    return {
      slaveSystemId: system.slaveSystemId,
      masterSystemId: system.masterSystemId,
      attachedParticleSystems: system.attachedParticleSystems,
      windAngle: system.windAngle,
      windAngleChange: system.windAngleChange,
      windMotionMovingToEnd: system.windMotionMovingToEnd,
      mesh: system.mesh,
      alive: system.alive,
      prevPositions: system.prevPositions,
    };
  }

  captureSaveState(): ParticleSystemManagerSaveState {
    return {
      version: 1,
      nextId: this.nextId,
      systems: Array.from(this.systems.values())
        .sort((left, right) => left.id - right.id)
        .map((system) => ({
          id: system.id,
          template: structuredClone(system.template),
          position: {
            x: system.position.x,
            y: system.position.y,
            z: system.position.z,
          },
          orientation: {
            x: system.orientation.x,
            y: system.orientation.y,
            z: system.orientation.z,
            w: system.orientation.w,
          },
          particleCount: system.particleCount,
          particles: Array.from(
            system.particles.slice(0, system.particleCount * PARTICLE_STRIDE),
          ),
          burstTimer: system.burstTimer,
          systemAge: system.systemAge,
          initialDelayRemaining: system.initialDelayRemaining,
          alive: system.alive,
          windAngle: system.windAngle,
          windAngleChange: system.windAngleChange,
          windMotionMovingToEnd: system.windMotionMovingToEnd,
          windPingPongTargetAngle: system.windPingPongTargetAngle,
          slaveSystemId: system.slaveSystemId ?? null,
          masterSystemId: system.masterSystemId ?? null,
          attachedParticleSystems: system.attachedParticleSystems
            ? Array.from(system.attachedParticleSystems.entries())
            : [],
          prevPositions: system.prevPositions
            ? Array.from(system.prevPositions.slice(0, system.particleCount * 3))
            : null,
        })),
    };
  }

  restoreSaveState(state: ParticleSystemManagerSaveState): void {
    if (state.version !== 1) {
      throw new Error(`Unsupported particle-system save-state version ${state.version}`);
    }

    this.reset();

    let totalParticleCount = 0;
    let maxSystemId = 0;
    for (const savedSystem of state.systems) {
      const templateName = savedSystem.template.name;
      if (!this.templates.has(templateName)) {
        this.templates.set(templateName, structuredClone(savedSystem.template));
      }
      const template = this.templates.get(templateName);
      if (!template) {
        throw new Error(`Unable to restore particle system "${templateName}" from save state.`);
      }

      const particleCapacity = Math.max(DEFAULT_MAX_PARTICLES_PER_SYSTEM, savedSystem.particleCount);
      const system: ParticleSystemInstance = {
        id: savedSystem.id,
        template,
        position: new THREE.Vector3(
          savedSystem.position.x,
          savedSystem.position.y,
          savedSystem.position.z,
        ),
        orientation: new THREE.Quaternion(
          savedSystem.orientation.x,
          savedSystem.orientation.y,
          savedSystem.orientation.z,
          savedSystem.orientation.w,
        ),
        particles: new Float32Array(particleCapacity * PARTICLE_STRIDE),
        particleCount: savedSystem.particleCount,
        maxParticles: particleCapacity,
        burstTimer: savedSystem.burstTimer,
        systemAge: savedSystem.systemAge,
        initialDelayRemaining: savedSystem.initialDelayRemaining,
        alive: savedSystem.alive,
        mesh: null,
        instanceMatrix: null,
        instanceColor: null,
        instanceAlpha: null,
        slaveSystemId: savedSystem.slaveSystemId ?? undefined,
        masterSystemId: savedSystem.masterSystemId ?? undefined,
        attachedParticleSystems: savedSystem.attachedParticleSystems.length > 0
          ? new Map(savedSystem.attachedParticleSystems)
          : undefined,
        windAngle: savedSystem.windAngle,
        windAngleChange: savedSystem.windAngleChange,
        windMotionMovingToEnd: savedSystem.windMotionMovingToEnd,
        windPingPongTargetAngle: savedSystem.windPingPongTargetAngle,
        prevPositions: savedSystem.prevPositions
          ? new Float32Array(Math.max(savedSystem.particleCount * 3, savedSystem.prevPositions.length))
          : undefined,
      };
      system.particles.set(savedSystem.particles);
      if (system.prevPositions && savedSystem.prevPositions) {
        system.prevPositions.set(savedSystem.prevPositions);
      }
      this.systems.set(system.id, system);
      totalParticleCount += system.particleCount;
      if (system.id > maxSystemId) {
        maxSystemId = system.id;
      }
      this.syncInstancedMesh(system);
    }

    this.totalParticleCount = totalParticleCount;
    this.nextId = Math.max(state.nextId, maxSystemId + 1);
  }

  // -------------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------------

  private updateSystem(system: ParticleSystemInstance, _dt: number): void {
    const template = system.template;
    system.systemAge++;

    // Check system lifetime (0 = infinite)
    if (template.systemLifetime > 0 && system.systemAge > template.systemLifetime) {
      if (template.isOneShot || system.particleCount === 0) {
        system.alive = false;
        return;
      }
    }

    // Update wind motion before particle update
    if (template.windMotion !== 'Unused') {
      this.updateWindMotion(system);
    }

    // Handle initial delay
    if (system.initialDelayRemaining > 0) {
      system.initialDelayRemaining--;
      this.updateExistingParticles(system, template);
      return;
    }

    // Emission
    const withinLifetime = template.systemLifetime === 0 || system.systemAge <= template.systemLifetime;
    if (withinLifetime) {
      system.burstTimer--;
      if (system.burstTimer <= 0) {
        const count = Math.round(randomInRange(template.burstCount));
        this.emitParticles(system, template, count);
        system.burstTimer = Math.max(1, Math.round(randomInRange(template.burstDelay)));
      }
    }

    // Update existing particles
    this.updateExistingParticles(system, template);

    // Update attached child system positions to track parent particles
    if (system.attachedParticleSystems && system.attachedParticleSystems.size > 0) {
      const data = system.particles;
      for (const [particleIdx, childId] of system.attachedParticleSystems) {
        const childSystem = this.systems.get(childId);
        if (childSystem) {
          const off = particleIdx * PARTICLE_STRIDE;
          childSystem.position.set(data[off + POS_X]!, data[off + POS_Y]!, data[off + POS_Z]!);
        }
      }
    }
  }

  private emitParticles(
    system: ParticleSystemInstance,
    template: ParticleSystemTemplate,
    count: number,
  ): void {
    const cap = this.lodManager?.getParticleCap() ?? 3000;

    for (let i = 0; i < count; i++) {
      if (system.particleCount >= system.maxParticles) break;
      if (this.totalParticleCount >= cap) break;

      const offset = system.particleCount * PARTICLE_STRIDE;
      const data = system.particles;

      // Position from emission volume
      const emitPos = this.sampleEmissionVolume(template);
      data[offset + POS_X] = system.position.x + emitPos.x;
      data[offset + POS_Y] = system.position.y + emitPos.y;
      data[offset + POS_Z] = system.position.z + emitPos.z;

      // Velocity from velocity type
      const vel = this.sampleEmissionVelocity(template, emitPos);
      data[offset + VEL_X] = vel.x;
      data[offset + VEL_Y] = vel.y;
      data[offset + VEL_Z] = vel.z;

      // Alpha — start at initial keyframe value
      data[offset + ALPHA] = template.alphaKeyframes.length > 0
        ? randomInRange({ min: template.alphaKeyframes[0]!.alphaMin, max: template.alphaKeyframes[0]!.alphaMax })
        : 1.0;

      // Color — start at first keyframe
      if (template.colorKeyframes.length > 0) {
        const c = template.colorKeyframes[0]!;
        data[offset + COL_R] = c.r / 255;
        data[offset + COL_G] = c.g / 255;
        data[offset + COL_B] = c.b / 255;
      } else {
        data[offset + COL_R] = 1;
        data[offset + COL_G] = 1;
        data[offset + COL_B] = 1;
      }

      // Size
      data[offset + SIZE] = randomInRange(template.size);
      data[offset + AGE] = 0;
      data[offset + MAX_AGE] = randomInRange(template.lifetime);
      data[offset + ROTATION] = randomInRange(template.angleZ);
      data[offset + ANG_RATE] = randomInRange(template.angularRateZ);
      data[offset + SIZE_RATE] = randomInRange(template.sizeRate);
      data[offset + SIZE_RATE_DAMP] = randomInRange(template.sizeRateDamping);
      data[offset + VEL_DAMP] = randomInRange(template.velocityDamping);
      data[offset + ANG_DAMP] = randomInRange(template.angularDamping);
      data[offset + ALPHA_FACTOR] = Math.random();

      // Initialize STREAK previous position to current position
      if (system.prevPositions) {
        const pOff = system.particleCount * 3;
        system.prevPositions[pOff] = data[offset + POS_X]!;
        system.prevPositions[pOff + 1] = data[offset + POS_Y]!;
        system.prevPositions[pOff + 2] = data[offset + POS_Z]!;
      }

      system.particleCount++;
      this.totalParticleCount++;

      // Create attached child system at particle's position
      if (template.attachedSystemName && system.attachedParticleSystems) {
        const particlePos = new THREE.Vector3(
          data[offset + POS_X]!,
          data[offset + POS_Y]!,
          data[offset + POS_Z]!,
        );
        const childId = this.createSystem(template.attachedSystemName, particlePos);
        if (childId !== null) {
          system.attachedParticleSystems.set(system.particleCount - 1, childId);
        }
      }
    }
  }

  private updateExistingParticles(system: ParticleSystemInstance, template: ParticleSystemTemplate): void {
    const data = system.particles;
    const prevPos = system.prevPositions;
    const attachedMap = system.attachedParticleSystems;
    let writeIdx = 0;

    for (let readIdx = 0; readIdx < system.particleCount; readIdx++) {
      const rOff = readIdx * PARTICLE_STRIDE;
      const age = data[rOff + AGE]! + 1;
      const maxAge = data[rOff + MAX_AGE]!;

      if (age > maxAge) {
        // Particle died — destroy attached child system if any
        if (attachedMap && attachedMap.has(readIdx)) {
          this.destroySystem(attachedMap.get(readIdx)!);
          attachedMap.delete(readIdx);
        }
        this.totalParticleCount--;
        continue;
      }

      // Copy particle to compacted position if needed
      const wOff = writeIdx * PARTICLE_STRIDE;
      if (readIdx !== writeIdx) {
        data.copyWithin(wOff, rOff, rOff + PARTICLE_STRIDE);
        // Compact STREAK prevPositions
        if (prevPos) {
          const srcP = readIdx * 3;
          const dstP = writeIdx * 3;
          prevPos[dstP] = prevPos[srcP]!;
          prevPos[dstP + 1] = prevPos[srcP + 1]!;
          prevPos[dstP + 2] = prevPos[srcP + 2]!;
        }
        // Remap attached system map keys
        if (attachedMap && attachedMap.has(readIdx)) {
          const childId = attachedMap.get(readIdx)!;
          attachedMap.delete(readIdx);
          attachedMap.set(writeIdx, childId);
        }
      }

      // Update age
      data[wOff + AGE] = age;

      // Gravity (applied to Y velocity) — C++ applies gravity first
      data[wOff + VEL_Y] = data[wOff + VEL_Y]! - template.gravity;

      // Velocity damping — use per-particle value sampled at emission
      const vdamp = data[wOff + VEL_DAMP]!;
      data[wOff + VEL_X] = data[wOff + VEL_X]! * vdamp;
      data[wOff + VEL_Y] = data[wOff + VEL_Y]! * vdamp;
      data[wOff + VEL_Z] = data[wOff + VEL_Z]! * vdamp;

      // Drift velocity
      data[wOff + VEL_X] = data[wOff + VEL_X]! + template.driftVelocity.x;
      data[wOff + VEL_Y] = data[wOff + VEL_Y]! + template.driftVelocity.y;
      data[wOff + VEL_Z] = data[wOff + VEL_Z]! + template.driftVelocity.z;

      // Save current position for STREAK rendering before position update
      if (prevPos) {
        const pOff = writeIdx * 3;
        prevPos[pOff] = data[wOff + POS_X]!;
        prevPos[pOff + 1] = data[wOff + POS_Y]!;
        prevPos[pOff + 2] = data[wOff + POS_Z]!;
      }

      // Update position
      data[wOff + POS_X] = data[wOff + POS_X]! + data[wOff + VEL_X]!;
      data[wOff + POS_Y] = data[wOff + POS_Y]! + data[wOff + VEL_Y]!;
      data[wOff + POS_Z] = data[wOff + POS_Z]! + data[wOff + VEL_Z]!;

      // Wind motion — apply as position nudge (not velocity).
      // Source parity: C++ ParticleSys.cpp:633-634 modifies m_pos directly.
      if (template.windMotion !== 'Unused') {
        data[wOff + POS_X] = data[wOff + POS_X]! + Math.cos(system.windAngle) * WIND_STRENGTH;
        data[wOff + POS_Z] = data[wOff + POS_Z]! + Math.sin(system.windAngle) * WIND_STRENGTH;
      }

      // Update rotation
      data[wOff + ROTATION] = data[wOff + ROTATION]! + data[wOff + ANG_RATE]!;
      const angDamp = data[wOff + ANG_DAMP]!;
      data[wOff + ANG_RATE] = data[wOff + ANG_RATE]! * angDamp;

      // Update size
      data[wOff + SIZE] = Math.max(0, data[wOff + SIZE]! + data[wOff + SIZE_RATE]!);
      data[wOff + SIZE_RATE] = data[wOff + SIZE_RATE]! * data[wOff + SIZE_RATE_DAMP]!;

      // Keyframe interpolation — use per-particle alpha factor for min/max lerp
      data[wOff + ALPHA] = interpolateAlphaKeyframes(template.alphaKeyframes, age, data[wOff + ALPHA_FACTOR]!);
      interpolateColorKeyframes(template.colorKeyframes, age, data, wOff);

      writeIdx++;
    }

    system.particleCount = writeIdx;
  }

  // -------------------------------------------------------------------------
  // Emission volume sampling
  // -------------------------------------------------------------------------

  private sampleEmissionVolume(template: ParticleSystemTemplate): { x: number; y: number; z: number } {
    switch (template.volumeType) {
      case 'POINT':
        return { x: 0, y: 0, z: 0 };

      case 'LINE': {
        const t = Math.random();
        return {
          x: template.volLineStart.x + t * (template.volLineEnd.x - template.volLineStart.x),
          y: template.volLineStart.y + t * (template.volLineEnd.y - template.volLineStart.y),
          z: template.volLineStart.z + t * (template.volLineEnd.z - template.volLineStart.z),
        };
      }

      case 'BOX': {
        const hs = template.volBoxHalfSize;
        return {
          x: (Math.random() * 2 - 1) * hs.x,
          y: (Math.random() * 2 - 1) * hs.y,
          z: (Math.random() * 2 - 1) * hs.z,
        };
      }

      case 'SPHERE': {
        const r = template.volSphereRadius;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = template.isHollow ? r : r * Math.cbrt(Math.random());
        return {
          x: radius * Math.sin(phi) * Math.cos(theta),
          y: radius * Math.cos(phi),
          z: radius * Math.sin(phi) * Math.sin(theta),
        };
      }

      case 'CYLINDER': {
        const cr = template.volCylinderRadius;
        const cl = template.volCylinderLength;
        const angle = Math.random() * Math.PI * 2;
        const dist = template.isHollow ? cr : cr * Math.sqrt(Math.random());
        return {
          x: dist * Math.cos(angle),
          y: (Math.random() - 0.5) * cl,
          z: dist * Math.sin(angle),
        };
      }

      default:
        return { x: 0, y: 0, z: 0 };
    }
  }

  private sampleEmissionVelocity(
    template: ParticleSystemTemplate,
    emitPos: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    switch (template.velocityType) {
      case 'ORTHO':
        return {
          x: randomInRange(template.velOrtho.x),
          y: randomInRange(template.velOrtho.y),
          z: randomInRange(template.velOrtho.z),
        };

      case 'SPHERICAL': {
        const speed = randomInRange(template.velSpherical);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        return {
          x: speed * Math.sin(phi) * Math.cos(theta),
          y: speed * Math.cos(phi),
          z: speed * Math.sin(phi) * Math.sin(theta),
        };
      }

      case 'HEMISPHERICAL': {
        const speed = randomInRange(template.velHemispherical);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random()); // hemisphere: only upper half
        return {
          x: speed * Math.sin(phi) * Math.cos(theta),
          y: speed * Math.cos(phi),
          z: speed * Math.sin(phi) * Math.sin(theta),
        };
      }

      case 'CYLINDRICAL': {
        const radial = randomInRange(template.velCylindrical.radial);
        const normal = randomInRange(template.velCylindrical.normal);
        const angle = Math.random() * Math.PI * 2;
        return {
          x: radial * Math.cos(angle),
          y: normal,
          z: radial * Math.sin(angle),
        };
      }

      case 'OUTWARD': {
        const speed = randomInRange(template.velOutward);
        const len = Math.sqrt(emitPos.x * emitPos.x + emitPos.y * emitPos.y + emitPos.z * emitPos.z);
        if (len < 0.001) {
          const theta = Math.random() * Math.PI * 2;
          return { x: speed * Math.cos(theta), y: 0, z: speed * Math.sin(theta) };
        }
        return {
          x: (emitPos.x / len) * speed,
          y: (emitPos.y / len) * speed,
          z: (emitPos.z / len) * speed,
        };
      }

      default:
        return { x: 0, y: 0, z: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Wind motion
  // -------------------------------------------------------------------------

  /**
   * Source parity: ParticleSys.cpp:2205-2289 — doWindMotion().
   * PingPong: angle oscillates between start and end targets with speed
   * proportional to distance from the center of the span (soft swing).
   * Circular: angle increments monotonically, wrapped to [0, 2π].
   */
  private updateWindMotion(system: ParticleSystemInstance): void {
    const template = system.template;

    if (template.windMotion === 'PingPong') {
      // C++ distance-based speed scaling: change is slower at extremes,
      // faster near center of the angle span.
      const halfSpan = Math.abs(system.windPingPongTargetAngle - (system.windMotionMovingToEnd
        ? randomInRange({ min: template.windPingPongStartAngleMin, max: template.windPingPongStartAngleMax })
        : system.windPingPongTargetAngle)) / 2;
      const center = system.windMotionMovingToEnd
        ? (template.windPingPongStartAngleMin + system.windPingPongTargetAngle) / 2
        : (system.windPingPongTargetAngle + template.windPingPongEndAngleMax) / 2;
      const diffFromCenter = Math.abs(system.windAngle - center);
      const speedScale = halfSpan > 0 ? Math.max(0.1, 1.0 - diffFromCenter / halfSpan) : 1.0;
      const change = system.windAngleChange * speedScale;

      if (system.windMotionMovingToEnd) {
        system.windAngle += change;
        if (system.windAngle >= system.windPingPongTargetAngle) {
          system.windMotionMovingToEnd = false;
          system.windAngleChange = randomInRange({
            min: template.windAngleChangeMin,
            max: template.windAngleChangeMax,
          });
          // Re-randomize target for the return swing
          system.windPingPongTargetAngle = randomInRange({
            min: template.windPingPongStartAngleMin,
            max: template.windPingPongStartAngleMax,
          });
        }
      } else {
        system.windAngle -= change;
        if (system.windAngle <= system.windPingPongTargetAngle) {
          system.windMotionMovingToEnd = true;
          system.windAngleChange = randomInRange({
            min: template.windAngleChangeMin,
            max: template.windAngleChangeMax,
          });
          // Re-randomize target for the forward swing
          system.windPingPongTargetAngle = randomInRange({
            min: template.windPingPongEndAngleMin,
            max: template.windPingPongEndAngleMax,
          });
        }
      }
    } else if (template.windMotion === 'Circular') {
      system.windAngle += system.windAngleChange;
      // Source parity: C++ wraps to [0, 2π] range
      const TWO_PI = Math.PI * 2;
      if (system.windAngle >= TWO_PI) {
        system.windAngle -= TWO_PI;
      } else if (system.windAngle < 0) {
        system.windAngle += TWO_PI;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering — InstancedMesh sync
  // -------------------------------------------------------------------------

  private syncInstancedMesh(system: ParticleSystemInstance): void {
    // STREAK particles use line segment rendering
    if (system.template.type === 'STREAK') {
      this.syncStreakMesh(system);
      return;
    }

    const count = system.particleCount;
    if (count === 0) {
      if (system.mesh) {
        this.scene.remove(system.mesh);
        this.disposeMesh(system.mesh);
        system.mesh = null;
      }
      return;
    }

    // Create or resize instanced mesh
    const existingMesh = system.mesh as THREE.InstancedMesh | null;
    if (!existingMesh || existingMesh.count < count) {
      if (system.mesh) {
        this.scene.remove(system.mesh);
        this.disposeMesh(system.mesh);
      }
      const material = this.getMaterial(system.template.shader, system.template.particleName || undefined);
      const capacity = Math.max(count, 32);
      const mesh = new THREE.InstancedMesh(BILLBOARD_QUAD, material, capacity);
      mesh.frustumCulled = false;
      mesh.name = `particles-${system.template.name}-${system.id}`;

      system.instanceAlpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      mesh.geometry.setAttribute('instanceAlpha', system.instanceAlpha);

      system.mesh = mesh;
      this.scene.add(mesh);
    }

    const mesh = system.mesh as THREE.InstancedMesh;
    mesh.count = count;

    const data = system.particles;
    const color = this.tempColor;

    for (let i = 0; i < count; i++) {
      const off = i * PARTICLE_STRIDE;
      const size = data[off + SIZE]!;

      this.tempPosition.set(data[off + POS_X]!, data[off + POS_Y]!, data[off + POS_Z]!);
      this.tempScale.set(size, size, size);
      this.tempQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, data[off + ROTATION]!);
      this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
      mesh.setMatrixAt(i, this.tempMatrix);

      color.setRGB(data[off + COL_R]!, data[off + COL_G]!, data[off + COL_B]!);
      mesh.setColorAt(i, color);

      if (system.instanceAlpha) {
        system.instanceAlpha.setX(i, data[off + ALPHA]!);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (system.instanceAlpha) system.instanceAlpha.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Rendering — STREAK line segments
  // -------------------------------------------------------------------------

  private syncStreakMesh(system: ParticleSystemInstance): void {
    const count = system.particleCount;
    const prevPos = system.prevPositions;

    if (count === 0 || !prevPos) {
      if (system.mesh) {
        this.scene.remove(system.mesh);
        this.disposeMesh(system.mesh);
        system.mesh = null;
      }
      return;
    }

    const data = system.particles;
    const vertexCount = count * 2; // 2 vertices per segment

    // Reuse existing LineSegments geometry if possible; only reallocate on capacity change.
    let lineSegments = system.mesh as THREE.LineSegments | null;
    let posAttr = lineSegments?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let colAttr = lineSegments?.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;

    if (!lineSegments || !posAttr || posAttr.count < vertexCount) {
      // Need to (re-)create geometry with sufficient capacity.
      if (system.mesh) {
        this.scene.remove(system.mesh);
        // Only dispose geometry — material is cached.
        if (system.mesh instanceof THREE.LineSegments) {
          system.mesh.geometry.dispose();
        }
        system.mesh = null;
      }

      const capacity = Math.max(vertexCount, 64);
      const geometry = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', posAttr);
      colAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('color', colAttr);

      const material = this.getStreakMaterial();
      lineSegments = new THREE.LineSegments(geometry, material);
      lineSegments.frustumCulled = false;
      lineSegments.name = `streak-${system.template.name}-${system.id}`;
      system.mesh = lineSegments;
      this.scene.add(lineSegments);
    }

    // Update vertex data in-place.
    const positions = posAttr!.array as Float32Array;
    const colors = colAttr!.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const off = i * PARTICLE_STRIDE;
      const pOff = i * 3;
      const vIdx = i * 6;
      const cIdx = i * 8;

      // First vertex: previous position (trailing edge — faded)
      positions[vIdx]     = prevPos[pOff]!;
      positions[vIdx + 1] = prevPos[pOff + 1]!;
      positions[vIdx + 2] = prevPos[pOff + 2]!;

      // Second vertex: current position
      positions[vIdx + 3] = data[off + POS_X]!;
      positions[vIdx + 4] = data[off + POS_Y]!;
      positions[vIdx + 5] = data[off + POS_Z]!;

      const r = data[off + COL_R]!;
      const g = data[off + COL_G]!;
      const b = data[off + COL_B]!;
      const alpha = data[off + ALPHA]!;

      // First point: alpha = 0 (fade trailing edge)
      colors[cIdx]     = r;
      colors[cIdx + 1] = g;
      colors[cIdx + 2] = b;
      colors[cIdx + 3] = 0;

      // Second point: full alpha
      colors[cIdx + 4] = r;
      colors[cIdx + 5] = g;
      colors[cIdx + 6] = b;
      colors[cIdx + 7] = alpha;
    }

    lineSegments.geometry.setDrawRange(0, vertexCount);
    posAttr!.needsUpdate = true;
    colAttr!.needsUpdate = true;
  }

  private disposeMesh(mesh: THREE.Object3D): void {
    if (mesh instanceof THREE.InstancedMesh) {
      mesh.dispose();
    } else if (mesh instanceof THREE.LineSegments) {
      mesh.geometry.dispose();
      // Material is cached via getStreakMaterial() — do NOT dispose here.
    }
  }

  private getMaterial(shaderType: ParticleShaderType, textureName?: string): THREE.Material {
    // Cache key incorporates both shader type and texture path so systems
    // with different textures (or no texture) get distinct materials.
    const cacheKey = textureName ? `${shaderType}:${textureName}` : shaderType;
    const cached = this.materialCache.get(cacheKey);
    if (cached) return cached;

    // Use the procedural radial gradient as a universal texture fallback.
    // Once real TGA asset loading is wired up, this is where we'd load
    // the actual texture by textureName instead.
    const texture = getProceduralGradientTexture();

    let material: THREE.Material;
    switch (shaderType) {
      case 'ADDITIVE':
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        break;
      case 'ALPHA_TEST':
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
        break;
      case 'MULTIPLY':
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          blending: THREE.MultiplyBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        break;
      case 'ALPHA':
      default:
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        break;
    }

    this.materialCache.set(cacheKey, material);
    return material;
  }

  /** Cached LineBasicMaterial for STREAK particle rendering. */
  private getStreakMaterial(): THREE.LineBasicMaterial {
    const key = '__STREAK__';
    const cached = this.materialCache.get(key);
    if (cached) return cached as THREE.LineBasicMaterial;

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.materialCache.set(key, material);
    return material;
  }

  private removeSystem(id: number): void {
    const system = this.systems.get(id);
    if (!system) return;
    this.totalParticleCount -= system.particleCount;
    if (system.mesh) {
      this.scene.remove(system.mesh);
      this.disposeMesh(system.mesh);
    }
    this.systems.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInRange(range: RandomRange): number {
  if (range.min === range.max) return range.min;
  return range.min + Math.random() * (range.max - range.min);
}

function interpolateAlphaKeyframes(keyframes: readonly AlphaKeyframe[], age: number, alphaFactor: number): number {
  if (keyframes.length === 0) return 1.0;
  if (keyframes.length === 1) {
    const k = keyframes[0]!;
    return k.alphaMin + alphaFactor * (k.alphaMax - k.alphaMin);
  }

  // Find bounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i]!;
    const k1 = keyframes[i + 1]!;
    if (age >= k0.frame && age <= k1.frame) {
      const span = k1.frame - k0.frame;
      if (span <= 0) return k0.alphaMin + alphaFactor * (k0.alphaMax - k0.alphaMin);
      const t = (age - k0.frame) / span;
      const a0 = k0.alphaMin + alphaFactor * (k0.alphaMax - k0.alphaMin);
      const a1 = k1.alphaMin + alphaFactor * (k1.alphaMax - k1.alphaMin);
      return a0 + t * (a1 - a0);
    }
  }

  // Past the last keyframe: use last value
  const last = keyframes[keyframes.length - 1]!;
  return last.alphaMin + alphaFactor * (last.alphaMax - last.alphaMin);
}

function interpolateColorKeyframes(
  keyframes: readonly ColorKeyframe[],
  age: number,
  data: Float32Array,
  offset: number,
): void {
  if (keyframes.length === 0) return;
  if (keyframes.length === 1) {
    const k = keyframes[0]!;
    data[offset + COL_R] = k.r / 255;
    data[offset + COL_G] = k.g / 255;
    data[offset + COL_B] = k.b / 255;
    return;
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i]!;
    const k1 = keyframes[i + 1]!;
    if (age >= k0.frame && age <= k1.frame) {
      const span = k1.frame - k0.frame;
      if (span <= 0) {
        data[offset + COL_R] = k0.r / 255;
        data[offset + COL_G] = k0.g / 255;
        data[offset + COL_B] = k0.b / 255;
        return;
      }
      const t = (age - k0.frame) / span;
      data[offset + COL_R] = (k0.r + t * (k1.r - k0.r)) / 255;
      data[offset + COL_G] = (k0.g + t * (k1.g - k0.g)) / 255;
      data[offset + COL_B] = (k0.b + t * (k1.b - k0.b)) / 255;
      return;
    }
  }

  const last = keyframes[keyframes.length - 1]!;
  data[offset + COL_R] = last.r / 255;
  data[offset + COL_G] = last.g / 255;
  data[offset + COL_B] = last.b / 255;
}
