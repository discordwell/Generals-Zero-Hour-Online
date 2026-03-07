/**
 * Snapshot interface for serializable subsystems.
 *
 * Source parity: Generals/Code/GameEngine/Include/Common/Snapshot.h
 *
 * Every subsystem or game object that participates in save/load implements
 * this interface. The three methods map to the three Xfer modes:
 * - crc(): lightweight CRC contribution (XFER_CRC)
 * - xfer(): full state serialization (XFER_SAVE / XFER_LOAD)
 * - loadPostProcess(): cross-reference fixup after all blocks are loaded
 */

import type { Xfer } from './xfer.js';

export interface Snapshot {
  crc(xfer: Xfer): void;
  xfer(xfer: Xfer): void;
  loadPostProcess(): void;
}
