/**
 * Xfer — abstract serialization base class.
 *
 * Source parity: Generals/Code/GameEngine/Include/Common/Xfer.h
 *
 * C++ Xfer uses void-pointer mutation: xfer->xferInt(&myInt).
 * TypeScript adaptation uses return values: value = xfer.xferInt(value).
 */

import type { Snapshot } from './snapshot.js';

export enum XferMode {
  XFER_SAVE = 1,
  XFER_LOAD = 2,
  XFER_CRC = 3,
}

export enum XferStatus {
  XFER_STATUS_OK = 0,
  XFER_STATUS_ERROR = 1,
  XFER_STATUS_NOT_FOUND = 2,
  XFER_STATUS_INVALID_VERSION = 3,
  XFER_STATUS_EOF = 4,
}

export interface Coord3D {
  x: number;
  y: number;
  z: number;
}

export abstract class Xfer {
  protected mode: XferMode;

  constructor(mode: XferMode) {
    this.mode = mode;
  }

  getMode(): XferMode {
    return this.mode;
  }

  abstract open(identifier: string): void;
  abstract close(): void;

  /**
   * Begin a size-prefixed block.
   * Save: writes a 4-byte placeholder, returns 0.
   * Load: reads the 4-byte size, returns it.
   * CRC: no-op, returns 0.
   */
  abstract beginBlock(): number;

  /**
   * End a size-prefixed block.
   * Save: patches the placeholder with actual size.
   * Load/CRC: no-op.
   */
  abstract endBlock(): void;

  abstract skip(dataSize: number): void;

  /**
   * Source parity: Xfer::xferVersion writes/reads a u8 version tag.
   * On load, throws if savedVersion > currentVersion.
   */
  xferVersion(currentVersion: number): number {
    const saved = this.xferByte(currentVersion);
    if (this.mode === XferMode.XFER_LOAD && saved > currentVersion) {
      throw new Error(
        `Version mismatch: saved version ${saved} > current version ${currentVersion}`,
      );
    }
    return saved;
  }

  abstract xferByte(value: number): number;
  xferUnsignedByte(value: number): number {
    return this.xferByte(value & 0xff);
  }
  abstract xferBool(value: boolean): boolean;
  abstract xferInt(value: number): number;
  abstract xferUnsignedInt(value: number): number;
  abstract xferShort(value: number): number;
  abstract xferUnsignedShort(value: number): number;
  abstract xferReal(value: number): number;
  abstract xferAsciiString(value: string): string;
  abstract xferUnicodeString(value: string): string;

  xferCoord3D(value: Coord3D): Coord3D {
    const x = this.xferReal(value.x);
    const y = this.xferReal(value.y);
    const z = this.xferReal(value.z);
    return { x, y, z };
  }

  xferObjectID(value: number): number {
    return this.xferUnsignedInt(value);
  }

  xferMarkerLabel(_label: string): void {
    // Source parity: Xfer::xferMarkerLabel is a complete no-op in C++ (Xfer.cpp:200-202).
    // Markers exist only for debugging readability; they produce no bytes in the stream.
  }

  xferUser(data: Uint8Array): Uint8Array;
  xferUser<T>(
    value: T,
    writer: (xfer: Xfer, v: T) => void,
    reader: (xfer: Xfer) => T,
  ): T;

  /**
   * Two source-backed forms:
   * - raw bytes: xferUser(Uint8Array)
   * - typed adapter: xferUser(value, writer, reader)
   */
  xferUser<T>(
    valueOrData: T | Uint8Array,
    writer?: (xfer: Xfer, v: T) => void,
    reader?: (xfer: Xfer) => T,
  ): T | Uint8Array {
    if (valueOrData instanceof Uint8Array) {
      return this.xferImplementation(valueOrData);
    }
    if (!writer || !reader) {
      throw new Error('xferUser requires either raw bytes or a writer/reader pair');
    }
    if (this.mode === XferMode.XFER_SAVE || this.mode === XferMode.XFER_CRC) {
      writer(this, valueOrData);
      return valueOrData;
    }
    return reader(this);
  }

  xferNumberList(values: number[]): number[] {
    const length = this.xferUnsignedInt(values.length);
    if (this.mode === XferMode.XFER_LOAD) {
      const result: number[] = [];
      for (let i = 0; i < length; i++) {
        result.push(this.xferReal(0));
      }
      return result;
    }
    for (let i = 0; i < length; i++) {
      this.xferReal(values[i]!);
    }
    return values;
  }

  xferIntList(values: number[]): number[] {
    const length = this.xferUnsignedInt(values.length);
    if (this.mode === XferMode.XFER_LOAD) {
      const result: number[] = [];
      for (let i = 0; i < length; i++) {
        result.push(this.xferInt(0));
      }
      return result;
    }
    for (let i = 0; i < length; i++) {
      this.xferInt(values[i]!);
    }
    return values;
  }

  xferObjectIDList(values: number[]): number[] {
    const length = this.xferUnsignedInt(values.length);
    if (this.mode === XferMode.XFER_LOAD) {
      const result: number[] = [];
      for (let i = 0; i < length; i++) {
        result.push(this.xferObjectID(0));
      }
      return result;
    }
    for (let i = 0; i < length; i++) {
      this.xferObjectID(values[i]!);
    }
    return values;
  }

  xferStringList(values: string[]): string[] {
    const length = this.xferUnsignedInt(values.length);
    if (this.mode === XferMode.XFER_LOAD) {
      const result: string[] = [];
      for (let i = 0; i < length; i++) {
        result.push(this.xferAsciiString(''));
      }
      return result;
    }
    for (let i = 0; i < length; i++) {
      this.xferAsciiString(values[i]!);
    }
    return values;
  }

  xferStringSet(values: Set<string>): Set<string> {
    const arr = this.xferStringList([...values]);
    return new Set(arr);
  }

  /**
   * Serialize a long string (no 255-char limit).
   * Uses u32 length prefix. NOT part of C++ Xfer — used for JSON blobs
   * where the browser port serializes pre-parsed profile data.
   */
  xferLongString(value: string): string {
    if (this.mode === XferMode.XFER_SAVE || this.mode === XferMode.XFER_CRC) {
      const encoded = new TextEncoder().encode(value);
      this.xferUnsignedInt(encoded.byteLength);
      if (encoded.byteLength > 0) {
        this.xferImplementation(encoded);
      }
      return value;
    }
    // XFER_LOAD
    const byteLength = this.xferUnsignedInt(0);
    if (byteLength === 0) return '';
    // Guard against corrupt saves specifying absurd lengths (max 16MB).
    if (byteLength > 16 * 1024 * 1024) {
      throw new Error(`xferLongString: byte length ${byteLength} exceeds 16MB safety cap`);
    }
    const bytes = new Uint8Array(byteLength);
    const read = this.xferImplementation(bytes);
    return new TextDecoder().decode(read);
  }

  abstract xferSnapshot(snapshot: Snapshot): void;

  abstract xferImplementation(data: Uint8Array): Uint8Array;
}
