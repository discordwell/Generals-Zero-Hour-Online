/**
 * Debris rendering — procedural flying chunks for building/unit destruction.
 *
 * Source parity: W3DDebrisDraw + ObjectCreationList SEND_IT_FLYING disposition.
 * Creates small mesh chunks with initial random velocity, gravity, bouncing,
 * spin, and fade-out. Uses procedural geometry until per-object debris models
 * are loaded from INI ObjectCreationLists.
 */

import * as THREE from 'three';

export interface DebrisConfig {
  /** Number of debris chunks to spawn. Default 6. */
  count?: number;
  /** Explosion radius — scales debris spread. Default 3. */
  radius?: number;
  /** Debris chunk color (hex). Default 0x888888 (grey). */
  color?: number;
  /** Lifetime in ms before fade completes. Default 2000. */
  lifetimeMs?: number;
  /** Upward velocity range [min, max]. Default [8, 16]. */
  upwardVelocity?: [number, number];
  /** Horizontal velocity range [min, max]. Default [-6, 6]. */
  horizontalVelocity?: [number, number];
}

interface DebrisChunk {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  createdAt: number;
  lifetimeMs: number;
  groundY: number;
}

const MAX_ACTIVE_CHUNKS = 256;
const GRAVITY = -20; // world units/s²
const BOUNCE_DAMPING = 0.4;
const FRICTION = 0.95;

// Shared geometries for debris pieces.
const CHUNK_GEOMETRIES = [
  new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.BoxGeometry(0.4, 0.2, 0.3),
  new THREE.BoxGeometry(0.2, 0.35, 0.25),
  new THREE.TetrahedronGeometry(0.25),
];

export class DebrisRenderer {
  private readonly scene: THREE.Scene;
  private readonly activeChunks: DebrisChunk[] = [];
  private lastUpdateTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn debris chunks at a world position (typically on entity destruction).
   */
  spawnDebris(
    x: number,
    y: number,
    z: number,
    config: DebrisConfig = {},
  ): void {
    const count = config.count ?? 6;
    const radius = config.radius ?? 3;
    const color = config.color ?? 0x888888;
    const lifetimeMs = config.lifetimeMs ?? 2000;
    const upRange = config.upwardVelocity ?? [8, 16];
    const hRange = config.horizontalVelocity ?? [-6, 6];

    for (let i = 0; i < count; i++) {
      // Evict oldest if at capacity.
      if (this.activeChunks.length >= MAX_ACTIVE_CHUNKS) {
        const oldest = this.activeChunks.shift();
        if (oldest) {
          this.scene.remove(oldest.mesh);
          oldest.material.dispose();
        }
      }

      const geometry = CHUNK_GEOMETRIES[i % CHUNK_GEOMETRIES.length]!;
      // Slight color variation per chunk.
      const colorVariation = 0.8 + Math.random() * 0.4;
      const r = ((color >> 16) & 0xff) / 255 * colorVariation;
      const g = ((color >> 8) & 0xff) / 255 * colorVariation;
      const b = (color & 0xff) / 255 * colorVariation;

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(
          Math.min(1, r),
          Math.min(1, g),
          Math.min(1, b),
        ),
        transparent: true,
        opacity: 1.0,
        roughness: 0.8,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'debris';

      // Random offset within radius.
      const offsetX = (Math.random() - 0.5) * radius;
      const offsetZ = (Math.random() - 0.5) * radius;
      mesh.position.set(x + offsetX, y + 0.5, z + offsetZ);

      // Random initial rotation.
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      this.scene.add(mesh);

      // Random velocity. Source parity: SEND_IT_FLYING disposition.
      const vx = hRange[0] + Math.random() * (hRange[1] - hRange[0]);
      const vy = upRange[0] + Math.random() * (upRange[1] - upRange[0]);
      const vz = hRange[0] + Math.random() * (hRange[1] - hRange[0]);

      // Random spin rates (radians/s).
      const spinX = (Math.random() - 0.5) * 8;
      const spinY = (Math.random() - 0.5) * 8;
      const spinZ = (Math.random() - 0.5) * 8;

      this.activeChunks.push({
        mesh,
        material,
        vx,
        vy,
        vz,
        spinX,
        spinY,
        spinZ,
        createdAt: performance.now(),
        lifetimeMs,
        groundY: y,
      });
    }
  }

  /**
   * Update all active debris — apply physics, fade, remove expired.
   */
  update(): void {
    const now = performance.now();
    const dt = this.lastUpdateTime > 0
      ? Math.min((now - this.lastUpdateTime) / 1000, 0.05) // cap at 50ms
      : 0.016;
    this.lastUpdateTime = now;

    let writeIdx = 0;

    for (let i = 0; i < this.activeChunks.length; i++) {
      const chunk = this.activeChunks[i]!;
      const elapsed = now - chunk.createdAt;

      if (elapsed >= chunk.lifetimeMs) {
        this.scene.remove(chunk.mesh);
        chunk.material.dispose();
        continue;
      }

      // Apply gravity.
      chunk.vy += GRAVITY * dt;

      // Move.
      chunk.mesh.position.x += chunk.vx * dt;
      chunk.mesh.position.y += chunk.vy * dt;
      chunk.mesh.position.z += chunk.vz * dt;

      // Bounce off ground.
      if (chunk.mesh.position.y <= chunk.groundY && chunk.vy < 0) {
        chunk.mesh.position.y = chunk.groundY;
        chunk.vy = -chunk.vy * BOUNCE_DAMPING;
        chunk.vx *= FRICTION;
        chunk.vz *= FRICTION;
        chunk.spinX *= 0.7;
        chunk.spinY *= 0.7;
        chunk.spinZ *= 0.7;
      }

      // Spin.
      chunk.mesh.rotation.x += chunk.spinX * dt;
      chunk.mesh.rotation.y += chunk.spinY * dt;
      chunk.mesh.rotation.z += chunk.spinZ * dt;

      // Fade in last 30% of lifetime.
      const fadeStart = chunk.lifetimeMs * 0.7;
      if (elapsed > fadeStart) {
        const fadeProgress = (elapsed - fadeStart) / (chunk.lifetimeMs - fadeStart);
        chunk.material.opacity = 1 - fadeProgress;
      }

      this.activeChunks[writeIdx++] = chunk;
    }

    this.activeChunks.length = writeIdx;
  }

  getActiveChunkCount(): number {
    return this.activeChunks.length;
  }

  dispose(): void {
    for (const chunk of this.activeChunks) {
      this.scene.remove(chunk.mesh);
      chunk.material.dispose();
    }
    this.activeChunks.length = 0;
  }
}
