/**
 * XferLoad — binary load reader.
 *
 * Source parity: Generals/Code/GameEngine/Source/Common/System/XferLoad.cpp
 *
 * Reads from an ArrayBuffer. beginBlock() reads a 4-byte size.
 * endBlock() is a no-op (same as C++).
 */

import type { Snapshot } from './snapshot.js';
import { Xfer, XferMode } from './xfer.js';

export class XferLoad extends Xfer {
  private readonly view: DataView;
  private offset = 0;
  private readonly byteLength: number;

  constructor(data: ArrayBuffer) {
    super(XferMode.XFER_LOAD);
    this.view = new DataView(data);
    this.byteLength = data.byteLength;
  }

  open(_identifier: string): void {
    this.offset = 0;
  }

  close(): void {
    // Source parity: XferLoad::close closes file handle.
  }

  beginBlock(): number {
    const size = this.readUint32();
    return size;
  }

  endBlock(): void {
    // Source parity: XferLoad::endBlock is a no-op.
  }

  skip(dataSize: number): void {
    this.offset += dataSize;
  }

  xferByte(value: number): number {
    this.assertRemaining(1);
    const result = this.view.getUint8(this.offset);
    this.offset += 1;
    return result;
  }

  xferBool(_value: boolean): boolean {
    return this.xferByte(0) !== 0;
  }

  xferInt(_value: number): number {
    return this.readInt32();
  }

  xferUnsignedInt(_value: number): number {
    return this.readUint32();
  }

  xferShort(_value: number): number {
    this.assertRemaining(2);
    const result = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return result;
  }

  xferReal(_value: number): number {
    this.assertRemaining(4);
    const result = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return result;
  }

  xferAsciiString(_value: string): string {
    // Source parity: u16 length prefix + raw bytes
    this.assertRemaining(2);
    const length = this.view.getUint16(this.offset, true);
    this.offset += 2;
    this.assertRemaining(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.view.getUint8(this.offset + i));
    }
    this.offset += length;
    return result;
  }

  xferSnapshot(snapshot: Snapshot): void {
    snapshot.xfer(this);
  }

  xferImplementation(_data: Uint8Array): Uint8Array {
    // Load reads remaining data — caller should use beginBlock/skip for bounded reads.
    // For raw data, read what's available up to end of buffer.
    const remaining = this.byteLength - this.offset;
    const result = new Uint8Array(this.view.buffer, this.offset, remaining);
    this.offset += remaining;
    return new Uint8Array(result);
  }

  getOffset(): number {
    return this.offset;
  }

  getRemaining(): number {
    return this.byteLength - this.offset;
  }

  private readUint32(): number {
    this.assertRemaining(4);
    const result = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return result;
  }

  private readInt32(): number {
    this.assertRemaining(4);
    const result = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return result;
  }

  private assertRemaining(needed: number): void {
    if (this.offset + needed > this.byteLength) {
      throw new Error(
        `XferLoad: read past end of buffer (offset=${this.offset}, needed=${needed}, size=${this.byteLength})`,
      );
    }
  }
}
