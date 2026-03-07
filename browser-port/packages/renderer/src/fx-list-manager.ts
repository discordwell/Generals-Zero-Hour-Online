/**
 * FXListManager — effect orchestrator that triggers particle systems, sounds,
 * view shakes, and scorch marks from INI FXList definitions.
 *
 * Source parity: FXList.cpp
 */

import * as THREE from 'three';
import type { Subsystem } from '@generals/engine';
import type { IniDataRegistry } from '@generals/ini-data';
import { parseFXListTemplate, type FXListTemplate, type FXNugget } from './fx-list-template.js';
import type { ParticleSystemManager } from './particle-system-manager.js';

// ---------------------------------------------------------------------------
// Event callbacks (wired by app layer)
// ---------------------------------------------------------------------------

export interface FXEventCallbacks {
  onSound?: (name: string, position: THREE.Vector3) => void;
  onViewShake?: (shakeType: string, position: THREE.Vector3) => void;
  onTerrainScorch?: (scorchType: string, radius: number, position: THREE.Vector3) => void;
  onLightPulse?: (color: { r: number; g: number; b: number }, radius: number, increaseTime: number, decreaseTime: number, position: THREE.Vector3) => void;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class FXListManager implements Subsystem {
  readonly name = 'FXListManager';

  private readonly templates = new Map<string, FXListTemplate>();
  private particleSystemManager: ParticleSystemManager | null = null;
  private callbacks: FXEventCallbacks = {};

  constructor(particleSystemManager?: ParticleSystemManager) {
    this.particleSystemManager = particleSystemManager ?? null;
  }

  init(): void {
    // Templates are loaded via loadFromRegistry
  }

  update(_dt: number): void {
    // FXListManager is event-driven, no per-frame work
  }

  reset(): void {
    // No transient state
  }

  dispose(): void {
    this.templates.clear();
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  loadFromRegistry(registry: IniDataRegistry): void {
    for (const [, block] of registry.fxLists) {
      const template = parseFXListTemplate(block);
      this.templates.set(template.name, template);
    }
  }

  setParticleSystemManager(manager: ParticleSystemManager): void {
    this.particleSystemManager = manager;
  }

  setCallbacks(callbacks: FXEventCallbacks): void {
    this.callbacks = callbacks;
  }

  getTemplate(name: string): FXListTemplate | undefined {
    return this.templates.get(name);
  }

  getTemplateCount(): number {
    return this.templates.size;
  }

  // -------------------------------------------------------------------------
  // Triggering
  // -------------------------------------------------------------------------

  /**
   * Trigger an FXList by name at a world position.
   * Returns the number of nuggets successfully triggered.
   */
  triggerFXList(
    name: string,
    position: THREE.Vector3,
    orientation?: THREE.Quaternion,
  ): number {
    const template = this.templates.get(name);
    if (!template) return 0;

    let triggered = 0;
    for (const nugget of template.nuggets) {
      if (this.triggerNugget(nugget, position, orientation)) {
        triggered++;
      }
    }
    return triggered;
  }

  /**
   * Check if an FXList name is registered.
   */
  hasFXList(name: string): boolean {
    return this.templates.has(name);
  }

  // -------------------------------------------------------------------------
  // Nugget execution
  // -------------------------------------------------------------------------

  private triggerNugget(
    nugget: FXNugget,
    position: THREE.Vector3,
    orientation?: THREE.Quaternion,
  ): boolean {
    switch (nugget.type) {
      case 'ParticleSystem': {
        if (!this.particleSystemManager) return false;
        const effectPos = nugget.offset
          ? new THREE.Vector3(
              position.x + nugget.offset.x,
              position.y + nugget.offset.y,
              position.z + nugget.offset.z,
            )
          : position;
        const id = this.particleSystemManager.createSystem(
          nugget.name,
          effectPos,
          nugget.orientToObject ? orientation : undefined,
        );
        return id !== null;
      }

      case 'Sound':
        this.callbacks.onSound?.(nugget.name, position);
        return true;

      case 'ViewShake':
        this.callbacks.onViewShake?.(nugget.shakeType, position);
        return true;

      case 'LightPulse':
        this.callbacks.onLightPulse?.(
          nugget.color,
          nugget.radius,
          nugget.increaseTime,
          nugget.decreaseTime,
          position,
        );
        return true;

      case 'TerrainScorch':
        this.callbacks.onTerrainScorch?.(nugget.scorchType, nugget.radius, position);
        return true;

      case 'FXListAtBonePos':
        // Recursive: trigger the referenced FXList
        if (nugget.fxListName) {
          return this.triggerFXList(nugget.fxListName, position, orientation) > 0;
        }
        return false;

      case 'Tracer':
        // Tracer rendering is handled separately
        return false;

      case 'BuffNugget':
        // Buff application is game-logic, not visual
        return false;

      default:
        return false;
    }
  }
}
