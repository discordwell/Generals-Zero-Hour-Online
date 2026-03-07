/**
 * XferSave — binary save writer.
 *
 * Source parity: Generals/Code/GameEngine/Source/Common/System/XferSave.cpp
 *
 * Uses ArrayBuffer/DataView instead of FILE*.
 * Growing buffer with ensureCapacity().
 * beginBlock() writes a 4-byte zero placeholder; endBlock() patches actual size.
 */

import type { Snapshot } from './snapshot.js';
import { Xfer, XferMode } from './xfer.js';

const INITIAL_CAPACITY = 4096;
const GROWTH_FACTOR = 2;

export class XferSave extends Xfer {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset = 0;
  private blockOffsetStack: number[] = [];

  constructor() {
    super(XferMode.XFER_SAVE);
    this.buffer = new ArrayBuffer(INITIAL_CAPACITY);
    this.view = new DataView(this.buffer);
  }

  open(_identifier: string): void {
    // Source parity: XferSave::open opens a file handle. We just reset state.
    this.offset = 0;
    this.blockOffsetStack.length = 0;
  }

  close(): void {
    // Source parity: XferSave::close flushes and closes file handle.
  }

  beginBlock(): number {
    this.blockOffsetStack.push(this.offset);
    this.writeUint32(0); // placeholder for block size
    return 0;
  }

  endBlock(): void {
    const startOffset = this.blockOffsetStack.pop();
    if (startOffset === undefined) {
      throw new Error('endBlock() without matching beginBlock()');
    }
    // Patch the placeholder with actual data size (excludes the 4-byte size field itself)
    const blockDataSize = this.offset - startOffset - 4;
    this.view.setUint32(startOffset, blockDataSize, true);
  }

  skip(_dataSize: number): void {
    // No-op for save mode
  }

  xferByte(value: number): number {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
    return value;
  }

  xferBool(value: boolean): boolean {
    this.xferByte(value ? 1 : 0);
    return value;
  }

  xferInt(value: number): number {
    this.writeInt32(value);
    return value;
  }

  xferUnsignedInt(value: number): number {
    this.writeUint32(value);
    return value;
  }

  xferShort(value: number): number {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
    return value;
  }

  xferReal(value: number): number {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
    return value;
  }

  xferAsciiString(value: string): string {
    // Source parity: u16 length prefix + raw bytes
    const length = value.length;
    this.ensureCapacity(2 + length);
    this.view.setUint16(this.offset, length, true);
    this.offset += 2;
    for (let i = 0; i < length; i++) {
      this.view.setUint8(this.offset + i, value.charCodeAt(i) & 0xff);
    }
    this.offset += length;
    return value;
  }

  xferSnapshot(snapshot: Snapshot): void {
    snapshot.xfer(this);
  }

  xferImplementation(data: Uint8Array): Uint8Array {
    this.ensureCapacity(data.byteLength);
    new Uint8Array(this.buffer, this.offset, data.byteLength).set(data);
    this.offset += data.byteLength;
    return data;
  }

  getBuffer(): ArrayBuffer {
    return this.buffer.slice(0, this.offset);
  }

  getOffset(): number {
    return this.offset;
  }

  private writeUint32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  private writeInt32(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, value | 0, true);
    this.offset += 4;
  }

  private ensureCapacity(needed: number): void {
    const required = this.offset + needed;
    if (required <= this.buffer.byteLength) {
      return;
    }
    let newSize = this.buffer.byteLength;
    while (newSize < required) {
      newSize *= GROWTH_FACTOR;
    }
    const newBuffer = new ArrayBuffer(newSize);
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer);
  }
}
