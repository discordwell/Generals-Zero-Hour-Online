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
    // Source parity: C++ typedef Int XferBlockSize — signed 32-bit
    const size = this.readInt32();
    return size;
  }

  endBlock(): void {
    // Source parity: XferLoad::endBlock is a no-op.
  }

  skip(dataSize: number): void {
    // Source parity: XferLoad.cpp:162 has DEBUG_ASSERTCRASH(dataSize >= 0)
    if (dataSize < 0) {
      throw new Error(`XferLoad: skip called with negative dataSize (${dataSize})`);
    }
    this.assertRemaining(dataSize);
    this.offset += dataSize;
  }

  xferByte(_value: number): number {
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

  xferUnsignedShort(_value: number): number {
    this.assertRemaining(2);
    const result = this.view.getUint16(this.offset, true);
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
    // Source parity: XferLoad.cpp:201 — UnsignedByte (u8) length prefix + raw bytes.
    this.assertRemaining(1);
    const length = this.view.getUint8(this.offset);
    this.offset += 1;
    this.assertRemaining(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.view.getUint8(this.offset + i));
    }
    this.offset += length;
    return result;
  }

  xferUnicodeString(_value: string): string {
    this.assertRemaining(1);
    const length = this.view.getUint8(this.offset);
    this.offset += 1;
    this.assertRemaining(length * 2);
    const codeUnits: number[] = [];
    for (let i = 0; i < length; i++) {
      codeUnits.push(this.view.getUint16(this.offset + (i * 2), true));
    }
    this.offset += length * 2;
    return String.fromCharCode(...codeUnits);
  }

  xferSnapshot(snapshot: Snapshot): void {
    snapshot.xfer(this);
  }

  xferImplementation(data: Uint8Array): Uint8Array {
    // Source parity: XferLoad::xferImplementation reads exactly dataSize bytes.
    // If data has a non-zero length, read that many bytes. Otherwise read all remaining.
    const toRead = data.byteLength > 0 ? data.byteLength : (this.byteLength - this.offset);
    this.assertRemaining(toRead);
    const result = new Uint8Array(this.view.buffer, this.offset, toRead);
    this.offset += toRead;
    return new Uint8Array(result);
  }

  getOffset(): number {
    return this.offset;
  }

  setOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.byteLength) {
      throw new Error(
        `XferLoad: invalid offset ${offset} for buffer size ${this.byteLength}`,
      );
    }
    this.offset = offset;
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
