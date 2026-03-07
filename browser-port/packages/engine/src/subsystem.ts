/**
 * Subsystem interface and lifecycle registry.
 *
 * This package is the boundary owner for subsystem lifecycle behavior.
 * Source reference: Generals/Code/GameEngine/Include/Common/SubsystemInterface.h
 * Source reference: Generals/Code/GameEngine/Source/Common/System/SubsystemInterface.cpp
 */

import type { Xfer } from './xfer.js';

export interface Subsystem {
  /** Unique subsystem name. */
  readonly name: string;
  /** Initialize subsystem resources. */
  init(): Promise<void> | void;
  /** Optional post-load hook for cross-subsystem setup. */
  postProcessLoad?(): Promise<void> | void;
  /** Per-frame update step. */
  update(dt: number): void;
  /** Reset transient state for a fresh/new game session. */
  reset(): void;
  /** Release resources. */
  dispose(): void;
  /** Optional lightweight CRC contribution for save-game validation. */
  crc?(xfer: Xfer): void;
  /** Optional full state serialization for save/load. */
  xfer?(xfer: Xfer): void;
  /** Optional post-process hook after all snapshot blocks have been loaded. */
  snapshotPostProcess?(): void;
}

export class SubsystemRegistry {
  private readonly subsystems = new Map<string, Subsystem>();
  private readonly updateOrder: Subsystem[] = [];

  register(subsystem: Subsystem): void {
    if (this.subsystems.has(subsystem.name)) {
      throw new Error(`Subsystem "${subsystem.name}" already registered`);
    }
    this.subsystems.set(subsystem.name, subsystem);
    this.updateOrder.push(subsystem);
  }

  get<T extends Subsystem>(name: string): T {
    const subsystem = this.subsystems.get(name);
    if (!subsystem) {
      throw new Error(`Subsystem "${name}" not found`);
    }
    return subsystem as T;
  }

  has(name: string): boolean {
    return this.subsystems.has(name);
  }

  async initAll(): Promise<void> {
    for (const subsystem of this.updateOrder) {
      await subsystem.init();
    }
  }

  async postProcessLoadAll(): Promise<void> {
    for (const subsystem of this.updateOrder) {
      if (typeof subsystem.postProcessLoad === 'function') {
        await subsystem.postProcessLoad();
      }
    }
  }

  updateAll(dt: number): void {
    for (const subsystem of this.updateOrder) {
      subsystem.update(dt);
    }
  }

  resetAll(): void {
    // Source parity: SubsystemInterfaceList::resetAll() iterates in reverse order.
    for (let index = this.updateOrder.length - 1; index >= 0; index -= 1) {
      const subsystem = this.updateOrder[index];
      if (subsystem) {
        subsystem.reset();
      }
    }
  }

  xferSnapshotAll(xfer: Xfer): void {
    for (const subsystem of this.updateOrder) {
      if (typeof subsystem.xfer === 'function') {
        subsystem.xfer(xfer);
      }
    }
  }

  crcAll(xfer: Xfer): void {
    for (const subsystem of this.updateOrder) {
      if (typeof subsystem.crc === 'function') {
        subsystem.crc(xfer);
      }
    }
  }

  snapshotPostProcessAll(): void {
    for (const subsystem of this.updateOrder) {
      if (typeof subsystem.snapshotPostProcess === 'function') {
        subsystem.snapshotPostProcess();
      }
    }
  }

  disposeAll(): void {
    // Source parity: shutdown happens in reverse order.
    for (let index = this.updateOrder.length - 1; index >= 0; index -= 1) {
      const subsystem = this.updateOrder[index];
      if (subsystem) {
        subsystem.dispose();
      }
    }
    this.subsystems.clear();
    this.updateOrder.length = 0;
  }
}
