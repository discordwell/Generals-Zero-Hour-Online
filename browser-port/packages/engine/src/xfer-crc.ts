/**
 * XferCRC — CRC computation mode.
 *
 * Source parity: Generals/Code/GameEngine/Source/Common/System/XferCRC.cpp
 *
 * Wraps the existing XferCrcAccumulator from deterministic-state.ts.
 * All xfer* methods feed bytes into the CRC accumulator.
 * xferSnapshot calls snapshot.crc() (lightweight path per C++ behavior).
 */

import { XferCrcAccumulator } from './deterministic-state.js';
import type { Snapshot } from './snapshot.js';
import { Xfer, XferMode } from './xfer.js';

export class XferCrc extends Xfer {
  private readonly accumulator: XferCrcAccumulator;

  constructor() {
    super(XferMode.XFER_CRC);
    this.accumulator = new XferCrcAccumulator();
  }

  open(_identifier: string): void {
    this.accumulator.reset();
  }

  close(): void {
    // no-op
  }

  beginBlock(): number {
    return 0;
  }

  endBlock(): void {
    // no-op
  }

  skip(_dataSize: number): void {
    // no-op
  }

  xferByte(value: number): number {
    this.accumulator.addUnsignedByte(value & 0xff);
    return value;
  }

  xferBool(value: boolean): boolean {
    this.xferByte(value ? 1 : 0);
    return value;
  }

  xferInt(value: number): number {
    // Feed as 4 bytes, matching XferCRC::xferImplementation behavior
    const unsigned = value >>> 0;
    this.accumulator.addUnsignedInt(unsigned);
    return value;
  }

  xferUnsignedInt(value: number): number {
    this.accumulator.addUnsignedInt(value >>> 0);
    return value;
  }

  xferShort(value: number): number {
    this.accumulator.addUnsignedShort(value & 0xffff);
    return value;
  }

  xferReal(value: number): number {
    // Source parity: float32 written as 4 bytes into CRC
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    this.accumulator.xferBytes(new Uint8Array(buf));
    return value;
  }

  xferAsciiString(value: string): string {
    this.accumulator.addAsciiString(value);
    return value;
  }

  xferSnapshot(snapshot: Snapshot): void {
    // Source parity: CRC mode calls the lightweight crc() path, not full xfer()
    snapshot.crc(this);
  }

  xferImplementation(data: Uint8Array): Uint8Array {
    this.accumulator.xferBytes(data);
    return data;
  }

  getCrc(): number {
    return this.accumulator.getCrc();
  }

  reset(): void {
    this.accumulator.reset();
  }
}
