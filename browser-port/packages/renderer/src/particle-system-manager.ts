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

const PARTICLE_STRIDE = 17;
const POS_X = 0;
const POS_Y = 1;
const POS_Z = 2;
const VEL_X = 3;
const VEL_Y = 4;
const VEL_Z = 5;
const ALPHA = 6;
const COL_R = 7;
const COL_G = 8;
const COL_B = 9;
const SIZE = 10;
const AGE = 11;
const MAX_AGE = 12;
const ROTATION = 13;
const ANG_RATE = 14;
const SIZE_RATE = 15;
const SIZE_RATE_DAMP = 16;

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
  mesh: THREE.InstancedMesh | null;
  instanceMatrix: THREE.InstancedBufferAttribute | null;
  instanceColor: THREE.InstancedBufferAttribute | null;
  instanceAlpha: THREE.InstancedBufferAttribute | null;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARTICLES_PER_SYSTEM = 200;
const BILLBOARD_QUAD = createBillboardGeometry();

function createBillboardGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
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
    };

    this.systems.set(id, system);
    return id;
  }

  destroySystem(id: number): void {
    const system = this.systems.get(id);
    if (system) {
      system.alive = false;
    }
  }

  getActiveSystemCount(): number {
    return this.systems.size;
  }

  getTotalParticleCount(): number {
    return this.totalParticleCount;
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

      system.particleCount++;
      this.totalParticleCount++;
    }
  }

  private updateExistingParticles(system: ParticleSystemInstance, template: ParticleSystemTemplate): void {
    const data = system.particles;
    let writeIdx = 0;

    for (let readIdx = 0; readIdx < system.particleCount; readIdx++) {
      const rOff = readIdx * PARTICLE_STRIDE;
      const age = data[rOff + AGE]! + 1;
      const maxAge = data[rOff + MAX_AGE]!;

      if (age > maxAge) {
        // Particle died
        this.totalParticleCount--;
        continue;
      }

      // Copy particle to compacted position if needed
      const wOff = writeIdx * PARTICLE_STRIDE;
      if (readIdx !== writeIdx) {
        data.copyWithin(wOff, rOff, rOff + PARTICLE_STRIDE);
      }

      // Update age
      data[wOff + AGE] = age;

      // Velocity damping
      const vdamp = randomInRange(template.velocityDamping);
      data[wOff + VEL_X] = data[wOff + VEL_X]! * vdamp;
      data[wOff + VEL_Y] = data[wOff + VEL_Y]! * vdamp;
      data[wOff + VEL_Z] = data[wOff + VEL_Z]! * vdamp;

      // Gravity (applied to Y velocity)
      data[wOff + VEL_Y] = data[wOff + VEL_Y]! - template.gravity;

      // Drift velocity
      data[wOff + VEL_X] = data[wOff + VEL_X]! + template.driftVelocity.x;
      data[wOff + VEL_Y] = data[wOff + VEL_Y]! + template.driftVelocity.y;
      data[wOff + VEL_Z] = data[wOff + VEL_Z]! + template.driftVelocity.z;

      // Update position
      data[wOff + POS_X] = data[wOff + POS_X]! + data[wOff + VEL_X]!;
      data[wOff + POS_Y] = data[wOff + POS_Y]! + data[wOff + VEL_Y]!;
      data[wOff + POS_Z] = data[wOff + POS_Z]! + data[wOff + VEL_Z]!;

      // Update rotation
      data[wOff + ROTATION] = data[wOff + ROTATION]! + data[wOff + ANG_RATE]!;
      const angDamp = randomInRange(template.angularDamping);
      data[wOff + ANG_RATE] = data[wOff + ANG_RATE]! * angDamp;

      // Update size
      data[wOff + SIZE] = Math.max(0, data[wOff + SIZE]! + data[wOff + SIZE_RATE]!);
      data[wOff + SIZE_RATE] = data[wOff + SIZE_RATE]! * data[wOff + SIZE_RATE_DAMP]!;

      // Keyframe interpolation
      data[wOff + ALPHA] = interpolateAlphaKeyframes(template.alphaKeyframes, age);
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
  // Rendering — InstancedMesh sync
  // -------------------------------------------------------------------------

  private syncInstancedMesh(system: ParticleSystemInstance): void {
    const count = system.particleCount;
    if (count === 0) {
      if (system.mesh) {
        this.scene.remove(system.mesh);
        system.mesh.dispose();
        system.mesh = null;
      }
      return;
    }

    // Create or resize instanced mesh
    if (!system.mesh || system.mesh.count < count) {
      if (system.mesh) {
        this.scene.remove(system.mesh);
        system.mesh.dispose();
      }
      const material = this.getMaterial(system.template.shader);
      const capacity = Math.max(count, 32);
      const mesh = new THREE.InstancedMesh(BILLBOARD_QUAD, material, capacity);
      mesh.frustumCulled = false;
      mesh.name = `particles-${system.template.name}-${system.id}`;

      system.instanceAlpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      mesh.geometry.setAttribute('instanceAlpha', system.instanceAlpha);

      system.mesh = mesh;
      this.scene.add(mesh);
    }

    const mesh = system.mesh;
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

  private getMaterial(shaderType: string): THREE.Material {
    const cached = this.materialCache.get(shaderType);
    if (cached) return cached;

    let material: THREE.Material;
    switch (shaderType) {
      case 'ADDITIVE':
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        break;
      case 'ALPHA_TEST':
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
        break;
      case 'MULTIPLY':
        material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
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
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        break;
    }

    this.materialCache.set(shaderType, material);
    return material;
  }

  private removeSystem(id: number): void {
    const system = this.systems.get(id);
    if (!system) return;
    this.totalParticleCount -= system.particleCount;
    if (system.mesh) {
      this.scene.remove(system.mesh);
      system.mesh.dispose();
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

function interpolateAlphaKeyframes(keyframes: readonly AlphaKeyframe[], age: number): number {
  if (keyframes.length === 0) return 1.0;
  if (keyframes.length === 1) {
    return (keyframes[0]!.alphaMin + keyframes[0]!.alphaMax) / 2;
  }

  // Find bounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i]!;
    const k1 = keyframes[i + 1]!;
    if (age >= k0.frame && age <= k1.frame) {
      const span = k1.frame - k0.frame;
      if (span <= 0) return (k0.alphaMin + k0.alphaMax) / 2;
      const t = (age - k0.frame) / span;
      const a0 = (k0.alphaMin + k0.alphaMax) / 2;
      const a1 = (k1.alphaMin + k1.alphaMax) / 2;
      return a0 + t * (a1 - a0);
    }
  }

  // Past the last keyframe: use last value
  const last = keyframes[keyframes.length - 1]!;
  return (last.alphaMin + last.alphaMax) / 2;
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
