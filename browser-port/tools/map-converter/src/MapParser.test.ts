import { describe, it, expect } from 'vitest';
import { DataChunkReader, MAP_MAGIC, CHUNK_HEADER_SIZE } from './DataChunkReader.js';
import { HeightmapExtractor, MAP_HEIGHT_SCALE } from './HeightmapExtractor.js';
import { MapObjectExtractor } from './MapObjectExtractor.js';
import { WaypointExtractor } from './WaypointExtractor.js';
import { MapParser } from './MapParser.js';
import { BlendTileExtractor } from './BlendTileExtractor.js';

// ---------------------------------------------------------------------------
// Helpers to construct synthetic .map binaries in memory
// ---------------------------------------------------------------------------

/** Helper: write a uint8 into a DataView and advance cursor. */
function writeUint8(view: DataView, offset: number, value: number): number {
  view.setUint8(offset, value);
  return offset + 1;
}

/** Helper: write a uint16 LE into a DataView and advance cursor. */
function writeUint16(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value, true);
  return offset + 2;
}

/** Helper: write an int32 LE into a DataView and advance cursor. */
function writeInt32(view: DataView, offset: number, value: number): number {
  view.setInt32(offset, value, true);
  return offset + 4;
}

/** Helper: write a uint32 LE into a DataView and advance cursor. */
function writeUint32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true);
  return offset + 4;
}

/** Helper: write a float32 LE into a DataView and advance cursor. */
function writeFloat32(view: DataView, offset: number, value: number): number {
  view.setFloat32(offset, value, true);
  return offset + 4;
}

/** Helper: write an ASCII string (raw bytes, no prefix) and advance cursor. */
function writeAscii(view: DataView, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
  return offset + str.length;
}

/** Helper: write a uint16-length-prefixed ASCII string. */
function writePrefixedAscii(view: DataView, offset: number, str: string): number {
  offset = writeUint16(view, offset, str.length);
  offset = writeAscii(view, offset, str);
  return offset;
}

function writeIntDictEntry(view: DataView, offset: number, key: number, value: number): number {
  offset = writeInt32(view, offset, (key << 8) | 1);
  return writeInt32(view, offset, value);
}

function writeBoolDictEntry(view: DataView, offset: number, key: number, value: boolean): number {
  offset = writeInt32(view, offset, (key << 8) | 0);
  return writeUint8(view, offset, value ? 1 : 0);
}

function writeAsciiDictEntry(view: DataView, offset: number, key: number, value: string): number {
  offset = writeInt32(view, offset, (key << 8) | 3);
  return writePrefixedAscii(view, offset, value);
}

/** Chunk type descriptor for building TOCs. */
interface ChunkDef {
  name: string;
  id: number;
}

/**
 * Calculate the byte size of a TOC.
 * 4 (magic) + 4 (count) + sum(1 + name.length + 4) per entry
 */
function tocSize(chunks: ChunkDef[]): number {
  let size = 4 + 4; // magic + count
  for (const c of chunks) {
    size += 1 + c.name.length + 4; // strLen(1) + name + id(4)
  }
  return size;
}

/** Write a TOC into a DataView starting at offset 0. Returns offset after TOC. */
function writeTOC(view: DataView, chunks: ChunkDef[]): number {
  let off = 0;
  off = writeAscii(view, off, MAP_MAGIC);
  off = writeUint32(view, off, chunks.length);
  for (const c of chunks) {
    off = writeUint8(view, off, c.name.length);
    off = writeAscii(view, off, c.name);
    off = writeUint32(view, off, c.id);
  }
  return off;
}

/**
 * Write a chunk header (10 bytes): id(4) + version(2) + dataSize(4).
 * Returns offset after the header.
 */
function writeChunkHeader(
  view: DataView,
  offset: number,
  id: number,
  version: number,
  dataSize: number,
): number {
  offset = writeUint32(view, offset, id);
  offset = writeUint16(view, offset, version);
  offset = writeInt32(view, offset, dataSize);
  return offset;
}

// ---------------------------------------------------------------------------
// Build a minimal valid .map binary with HeightMapData chunk (v3)
// ---------------------------------------------------------------------------

function buildMinimalMap(opts?: {
  hmWidth?: number;
  hmHeight?: number;
  hmBorder?: number;
  hmVersion?: number;
  hmBoundaries?: ReadonlyArray<{ x: number; y: number }>;
}): ArrayBuffer {
  const hmWidth = opts?.hmWidth ?? 4;
  const hmHeight = opts?.hmHeight ?? 3;
  const hmBorder = opts?.hmBorder ?? 1;
  const hmVersion = opts?.hmVersion ?? 3;
  const hmBoundaries = opts?.hmBoundaries ?? [{ x: hmWidth - hmBorder * 2, y: hmHeight - hmBorder * 2 }];

  const chunks: ChunkDef[] = [{ name: 'HeightMapData', id: 1 }];

  // HeightMapData payload: width(4) + height(4) + borderSize(4, v3+) + dataSize(4) + data
  const hmDataLen = hmWidth * hmHeight;
  let hmPayload = 4 + 4 + 4; // width, height, dataSize
  if (hmVersion >= 3) hmPayload += 4; // borderSize
  if (hmVersion >= 4) hmPayload += 4 + (hmBoundaries.length * 2 * 4); // boundary count + (x,y) pairs
  hmPayload += hmDataLen; // actual height data

  const totalSize = tocSize(chunks) + CHUNK_HEADER_SIZE + hmPayload;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let off = writeTOC(view, chunks);
  off = writeChunkHeader(view, off, 1, hmVersion, hmPayload);

  // HeightMapData payload
  off = writeInt32(view, off, hmWidth);
  off = writeInt32(view, off, hmHeight);
  if (hmVersion >= 3) {
    off = writeInt32(view, off, hmBorder);
  }
  if (hmVersion >= 4) {
    off = writeInt32(view, off, hmBoundaries.length);
    for (const boundary of hmBoundaries) {
      off = writeInt32(view, off, boundary.x);
      off = writeInt32(view, off, boundary.y);
    }
  }
  off = writeInt32(view, off, hmDataLen);

  // Fill height data with increasing values
  for (let i = 0; i < hmDataLen; i++) {
    off = writeUint8(view, off, i % 256);
  }

  return buffer;
}

function wrapMapInEarContainer(mapBuffer: ArrayBuffer): ArrayBuffer {
  const wrapperPrefix = Uint8Array.from([
    0x45, 0x41, 0x52, 0x00, // "EAR\0"
    0x1d, 0x3b, 0x10, 0x00, 0x10, 0xfb, 0x10, 0x3b, 0x1d, 0xe4,
  ]);
  const mapBytes = new Uint8Array(mapBuffer);
  const wrapped = new Uint8Array(wrapperPrefix.length + mapBytes.length);
  wrapped.set(wrapperPrefix, 0);
  wrapped.set(mapBytes, wrapperPrefix.length);
  return wrapped.buffer;
}

// ---------------------------------------------------------------------------
// Build a map with objects
// ---------------------------------------------------------------------------

function buildMapWithObjects(): ArrayBuffer {
  const chunks: ChunkDef[] = [
    { name: 'HeightMapData', id: 1 },
    { name: 'ObjectsList', id: 2 },
    { name: 'Object', id: 3 },
  ];

  // Minimal heightmap (2x2, v3)
  const hmDataLen = 4;
  const hmPayload = 4 + 4 + 4 + 4 + hmDataLen; // width + height + border + dataSize + data

  // Object payload (v2): posX(4) + posY(4) + angle(4) + flags(4) + templateName(2+len) + dict
  const templateName = 'AmericaCommandCenter';
  // Dict: 1 pair, key=42, type=INT(1), value=100
  const dictPayload = 2 + (4 + 4); // pairCount(2) + packed(4) + int32Value(4)
  const objPayload = 4 + 4 + 4 + 4 + 2 + templateName.length + dictPayload;

  // ObjectsList payload = Object chunk header + object payload
  const objListPayload = CHUNK_HEADER_SIZE + objPayload;

  const totalSize =
    tocSize(chunks) +
    CHUNK_HEADER_SIZE + hmPayload +
    CHUNK_HEADER_SIZE + objListPayload;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let off = writeTOC(view, chunks);

  // HeightMapData chunk
  off = writeChunkHeader(view, off, 1, 3, hmPayload);
  off = writeInt32(view, off, 2); // width
  off = writeInt32(view, off, 2); // height
  off = writeInt32(view, off, 0); // borderSize
  off = writeInt32(view, off, hmDataLen); // dataSize
  for (let i = 0; i < hmDataLen; i++) {
    off = writeUint8(view, off, 128);
  }

  // ObjectsList chunk
  off = writeChunkHeader(view, off, 2, 1, objListPayload);

  // Child Object chunk (v2)
  off = writeChunkHeader(view, off, 3, 2, objPayload);
  off = writeFloat32(view, off, 100.0); // posX
  off = writeFloat32(view, off, 200.0); // posY
  off = writeFloat32(view, off, 45.0);  // angle
  off = writeInt32(view, off, 0x001);   // flags: DRAWS_IN_MIRROR
  off = writePrefixedAscii(view, off, templateName);

  // Dict: 1 pair
  off = writeUint16(view, off, 1); // pairCount
  off = writeInt32(view, off, (42 << 8) | 1); // key=42, type=INT
  off = writeInt32(view, off, 100); // value

  return buffer;
}

// ---------------------------------------------------------------------------
// Build a map with polygon triggers
// ---------------------------------------------------------------------------

function buildMapWithTriggers(): ArrayBuffer {
  const chunks: ChunkDef[] = [
    { name: 'HeightMapData', id: 1 },
    { name: 'PolygonTriggers', id: 2 },
  ];

  // Minimal heightmap (2x2, v3)
  const hmDataLen = 4;
  const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

  // Trigger payload (v2): count(4) + trigger data
  // One trigger: name(2+len) + id(4) + isWaterArea(1) + pointCount(4) + points
  const trigName = 'SpawnZone';
  const numPoints = 3;
  const trigPayload =
    4 +              // triggerCount
    2 + trigName.length + // name
    4 +              // id
    1 +              // isWaterArea (v2)
    4 +              // pointCount
    numPoints * 12;  // points (x,y,z int32 each)

  const totalSize =
    tocSize(chunks) +
    CHUNK_HEADER_SIZE + hmPayload +
    CHUNK_HEADER_SIZE + trigPayload;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let off = writeTOC(view, chunks);

  // HeightMapData chunk
  off = writeChunkHeader(view, off, 1, 3, hmPayload);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 0);
  off = writeInt32(view, off, hmDataLen);
  for (let i = 0; i < hmDataLen; i++) {
    off = writeUint8(view, off, 64);
  }

  // PolygonTriggers chunk (v2)
  off = writeChunkHeader(view, off, 2, 2, trigPayload);
  off = writeInt32(view, off, 1); // triggerCount
  off = writePrefixedAscii(view, off, trigName);
  off = writeInt32(view, off, 7); // id
  off = writeUint8(view, off, 1); // isWaterArea = true
  off = writeInt32(view, off, numPoints);
  // Point 0
  off = writeInt32(view, off, 10);
  off = writeInt32(view, off, 20);
  off = writeInt32(view, off, 30);
  // Point 1
  off = writeInt32(view, off, 40);
  off = writeInt32(view, off, 50);
  off = writeInt32(view, off, 60);
  // Point 2
  off = writeInt32(view, off, 70);
  off = writeInt32(view, off, 80);
  off = writeInt32(view, off, 90);

  return buffer;
}

function buildMapWithTriggersV4(): ArrayBuffer {
  const chunks: ChunkDef[] = [
    { name: 'HeightMapData', id: 1 },
    { name: 'PolygonTriggers', id: 2 },
  ];

  // Minimal heightmap (2x2, v3)
  const hmDataLen = 4;
  const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

  // Trigger payload (v4): count + name + layerName + id + isWater + isRiver + riverStart + pointCount + points
  const trigName = 'SpawnZone';
  const layerName = 'Default';
  const numPoints = 3;
  const trigPayload =
    4 +
    (2 + trigName.length) +
    (2 + layerName.length) +
    4 +
    1 +
    1 +
    4 +
    4 +
    numPoints * 12;

  const totalSize =
    tocSize(chunks) +
    CHUNK_HEADER_SIZE + hmPayload +
    CHUNK_HEADER_SIZE + trigPayload;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let off = writeTOC(view, chunks);

  // HeightMapData chunk
  off = writeChunkHeader(view, off, 1, 3, hmPayload);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 0);
  off = writeInt32(view, off, hmDataLen);
  for (let i = 0; i < hmDataLen; i++) {
    off = writeUint8(view, off, 64);
  }

  // PolygonTriggers chunk (v4)
  off = writeChunkHeader(view, off, 2, 4, trigPayload);
  off = writeInt32(view, off, 1); // triggerCount
  off = writePrefixedAscii(view, off, trigName);
  off = writePrefixedAscii(view, off, layerName);
  off = writeInt32(view, off, 7); // id
  off = writeUint8(view, off, 1); // isWaterArea = true
  off = writeUint8(view, off, 1); // isRiver = true
  off = writeInt32(view, off, 1); // riverStart
  off = writeInt32(view, off, numPoints);
  // Point 0
  off = writeInt32(view, off, 10);
  off = writeInt32(view, off, 20);
  off = writeInt32(view, off, 30);
  // Point 1
  off = writeInt32(view, off, 40);
  off = writeInt32(view, off, 50);
  off = writeInt32(view, off, 60);
  // Point 2
  off = writeInt32(view, off, 70);
  off = writeInt32(view, off, 80);
  off = writeInt32(view, off, 90);

  return buffer;
}

// ---------------------------------------------------------------------------
// Build a map with waypoint object metadata + WaypointsList links
// ---------------------------------------------------------------------------

function buildMapWithWaypoints(): ArrayBuffer {
  const chunks: ChunkDef[] = [
    { name: 'HeightMapData', id: 1 },
    { name: 'ObjectsList', id: 2 },
    { name: 'Object', id: 3 },
    { name: 'WaypointsList', id: 4 },
    { name: 'waypointID', id: 100 },
    { name: 'waypointName', id: 101 },
    { name: 'waypointPathBiDirectional', id: 102 },
  ];

  const hmDataLen = 4;
  const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

  const templateName = '*Waypoints/Waypoint';
  const waypointName = 'TrainStopStart01';
  const dictPayload =
    2 + // pairCount
    (4 + 4) + // waypointID int
    (4 + 2 + waypointName.length) + // waypointName ascii
    (4 + 1); // waypointPathBiDirectional bool
  const objPayload = 4 + 4 + 4 + 4 + 4 + 2 + templateName.length + dictPayload;
  const objListPayload = CHUNK_HEADER_SIZE + objPayload;

  const waypointLinksPayload = 4 + 8; // count + one pair

  const totalSize =
    tocSize(chunks) +
    CHUNK_HEADER_SIZE + hmPayload +
    CHUNK_HEADER_SIZE + objListPayload +
    CHUNK_HEADER_SIZE + waypointLinksPayload +
    64;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let off = writeTOC(view, chunks);

  off = writeChunkHeader(view, off, 1, 3, hmPayload);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 0);
  off = writeInt32(view, off, hmDataLen);
  for (let i = 0; i < hmDataLen; i++) {
    off = writeUint8(view, off, 64);
  }

  off = writeChunkHeader(view, off, 2, 1, objListPayload);
  off = writeChunkHeader(view, off, 3, 3, objPayload);
  off = writeFloat32(view, off, 120.0);
  off = writeFloat32(view, off, 330.0);
  off = writeFloat32(view, off, 0.0);
  off = writeFloat32(view, off, 0.0);
  off = writeInt32(view, off, 0);
  off = writePrefixedAscii(view, off, templateName);

  off = writeUint16(view, off, 3); // pairCount
  off = writeInt32(view, off, (100 << 8) | 1); // waypointID int
  off = writeInt32(view, off, 11);
  off = writeInt32(view, off, (101 << 8) | 3); // waypointName ascii
  off = writePrefixedAscii(view, off, waypointName);
  off = writeInt32(view, off, (102 << 8) | 0); // waypointPathBiDirectional bool
  off = writeUint8(view, off, 1);

  off = writeChunkHeader(view, off, 4, 1, waypointLinksPayload);
  off = writeInt32(view, off, 1);
  off = writeInt32(view, off, 11);
  off = writeInt32(view, off, 12);

  return buffer.slice(0, off);
}

function buildMapWithWaypointGraph(): ArrayBuffer {
  const chunks: ChunkDef[] = [
    { name: 'HeightMapData', id: 1 },
    { name: 'ObjectsList', id: 2 },
    { name: 'Object', id: 3 },
    { name: 'WaypointsList', id: 4 },
    { name: 'waypointID', id: 100 },
    { name: 'waypointName', id: 101 },
    { name: 'waypointPathBiDirectional', id: 102 },
    { name: 'waypointPathLabel1', id: 103 },
    { name: 'waypointPathLabel2', id: 104 },
    { name: 'waypointPathLabel3', id: 105 },
  ];

  const hmDataLen = 4;
  const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

  const templateName = '*Waypoints/Waypoint';
  const waypointName1 = 'TrainRouteStart01';
  const waypointName2 = 'TrainRouteMid01';
  const waypointName3 = 'TrainRouteEnd01';
  const objPayload1 =
    4 + 4 + 4 + 4 + 4 + 2 + templateName.length +
    2 +
    (4 + 4) +
    (4 + 2 + waypointName1.length) +
    (4 + 1) +
    (4 + 2 + 8);
  const objPayload2 =
    4 + 4 + 4 + 4 + 4 + 2 + templateName.length +
    2 +
    (4 + 4) +
    (4 + 2 + waypointName2.length) +
    (4 + 1) +
    (4 + 2 + 9);
  const objPayload3 =
    4 + 4 + 4 + 4 + 4 + 2 + templateName.length +
    2 +
    (4 + 4) +
    (4 + 2 + waypointName3.length) +
    (4 + 1) +
    (4 + 2 + 10);

  const objListPayload = CHUNK_HEADER_SIZE + objPayload1 + CHUNK_HEADER_SIZE + objPayload2 + CHUNK_HEADER_SIZE + objPayload3;

  const waypointLinksPayload = 4 + 6 * 8; // count + 6 pairs

  const totalSize =
    tocSize(chunks) +
    CHUNK_HEADER_SIZE + hmPayload +
    CHUNK_HEADER_SIZE + objListPayload +
    CHUNK_HEADER_SIZE + waypointLinksPayload +
    64;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let off = writeTOC(view, chunks);

  off = writeChunkHeader(view, off, 1, 3, hmPayload);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 2);
  off = writeInt32(view, off, 0);
  off = writeInt32(view, off, hmDataLen);
  for (let i = 0; i < hmDataLen; i++) {
    off = writeUint8(view, off, 64);
  }

  off = writeChunkHeader(view, off, 2, 1, objListPayload);

  off = writeChunkHeader(view, off, 3, 3, objPayload1);
  off = writeFloat32(view, off, 120.0);
  off = writeFloat32(view, off, 330.0);
  off = writeFloat32(view, off, 0.0);
  off = writeFloat32(view, off, 0.0);
  off = writeInt32(view, off, 0);
  off = writePrefixedAscii(view, off, templateName);
  off = writeUint16(view, off, 4);
  off = writeIntDictEntry(view, off, 100, 11);
  off = writeAsciiDictEntry(view, off, 101, waypointName1);
  off = writeBoolDictEntry(view, off, 102, true);
  off = writeAsciiDictEntry(view, off, 103, 'RailMain');

  off = writeChunkHeader(view, off, 3, 3, objPayload2);
  off = writeFloat32(view, off, 220.0);
  off = writeFloat32(view, off, 430.0);
  off = writeFloat32(view, off, 0.0);
  off = writeFloat32(view, off, 0.0);
  off = writeInt32(view, off, 0);
  off = writePrefixedAscii(view, off, templateName);
  off = writeUint16(view, off, 4);
  off = writeIntDictEntry(view, off, 100, 12);
  off = writeAsciiDictEntry(view, off, 101, waypointName2);
  off = writeBoolDictEntry(view, off, 102, false);
  off = writeAsciiDictEntry(view, off, 104, 'LocalEdge');

  off = writeChunkHeader(view, off, 3, 3, objPayload3);
  off = writeFloat32(view, off, 320.0);
  off = writeFloat32(view, off, 530.0);
  off = writeFloat32(view, off, 0.0);
  off = writeFloat32(view, off, 0.0);
  off = writeInt32(view, off, 0);
  off = writePrefixedAscii(view, off, templateName);
  off = writeUint16(view, off, 4);
  off = writeIntDictEntry(view, off, 100, 13);
  off = writeAsciiDictEntry(view, off, 101, waypointName3);
  off = writeBoolDictEntry(view, off, 102, true);
  off = writeAsciiDictEntry(view, off, 105, 'ReturnPath');

  off = writeChunkHeader(view, off, 4, 1, waypointLinksPayload);
  off = writeInt32(view, off, 6);
  off = writeInt32(view, off, 11);
  off = writeInt32(view, off, 12);
  off = writeInt32(view, off, 11);
  off = writeInt32(view, off, 12);
  off = writeInt32(view, off, 12);
  off = writeInt32(view, off, 13);
  off = writeInt32(view, off, 13);
  off = writeInt32(view, off, 13);
  off = writeInt32(view, off, 99);
  off = writeInt32(view, off, 11);
  off = writeInt32(view, off, 13);
  off = writeInt32(view, off, 12);

  return buffer.slice(0, off);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataChunkReader', () => {
  describe('readTableOfContents()', () => {
    it('should parse the magic and chunk labels', () => {
      const buffer = buildMinimalMap();
      const reader = new DataChunkReader(buffer);
      const toc = reader.readTableOfContents();

      expect(toc).toHaveLength(1);
      expect(toc[0]!.name).toBe('HeightMapData');
      expect(toc[0]!.id).toBe(1);
    });

    it('should parse multiple TOC entries', () => {
      const buffer = buildMapWithObjects();
      const reader = new DataChunkReader(buffer);
      const toc = reader.readTableOfContents();

      expect(toc).toHaveLength(3);
      expect(toc[0]!.name).toBe('HeightMapData');
      expect(toc[1]!.name).toBe('ObjectsList');
      expect(toc[2]!.name).toBe('Object');
    });

    it('should reject invalid magic', () => {
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      writeAscii(view, 0, 'XXXX');
      writeUint32(view, 4, 0);

      const reader = new DataChunkReader(buffer);
      expect(() => reader.readTableOfContents()).toThrow(/Invalid map magic/);
    });
  });

  describe('readChunkHeader()', () => {
    it('should read chunk id, version, and data size', () => {
      const buffer = buildMinimalMap();
      const reader = new DataChunkReader(buffer);
      reader.readTableOfContents();

      const chunk = reader.readChunkHeader();
      expect(chunk.id).toBe(1);
      expect(chunk.version).toBe(3);
      expect(chunk.dataSize).toBeGreaterThan(0);
      expect(chunk.dataOffset).toBe(reader.position);
    });
  });

  describe('primitive readers', () => {
    it('should read int32 correctly', () => {
      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setInt32(0, -12345, true);

      const reader = new DataChunkReader(buffer);
      expect(reader.readInt32()).toBe(-12345);
      expect(reader.position).toBe(4);
    });

    it('should read float32 correctly', () => {
      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setFloat32(0, 3.14, true);

      const reader = new DataChunkReader(buffer);
      const val = reader.readFloat32();
      expect(val).toBeCloseTo(3.14, 2);
      expect(reader.position).toBe(4);
    });

    it('should read uint8 correctly', () => {
      const buffer = new ArrayBuffer(1);
      const view = new DataView(buffer);
      view.setUint8(0, 255);

      const reader = new DataChunkReader(buffer);
      expect(reader.readUint8()).toBe(255);
    });

    it('should read uint16 correctly', () => {
      const buffer = new ArrayBuffer(2);
      const view = new DataView(buffer);
      view.setUint16(0, 0xBEEF, true);

      const reader = new DataChunkReader(buffer);
      expect(reader.readUint16()).toBe(0xBEEF);
    });
  });

  describe('string readers', () => {
    it('should read a uint16-prefixed ASCII string', () => {
      const str = 'Hello';
      const buffer = new ArrayBuffer(2 + str.length);
      const view = new DataView(buffer);
      writePrefixedAscii(view, 0, str);

      const reader = new DataChunkReader(buffer);
      expect(reader.readAsciiString()).toBe('Hello');
      expect(reader.position).toBe(2 + str.length);
    });

    it('should read an empty string', () => {
      const buffer = new ArrayBuffer(2);
      const view = new DataView(buffer);
      writeUint16(view, 0, 0);

      const reader = new DataChunkReader(buffer);
      expect(reader.readAsciiString()).toBe('');
      expect(reader.position).toBe(2);
    });
  });

  describe('dict reader', () => {
    it('should read a dict with BOOL, INT, REAL, and ASCII_STRING entries', () => {
      // 4 pairs:
      // key=1, BOOL(0), value=true  => 4 + 1 = 5
      // key=2, INT(1), value=42     => 4 + 4 = 8
      // key=3, REAL(2), value=1.5   => 4 + 4 = 8
      // key=4, ASCII(3), "hi"       => 4 + 2 + 2 = 8
      const payloadSize = 2 + 5 + 8 + 8 + 8; // pairCount(2) + entries
      const buffer = new ArrayBuffer(payloadSize);
      const view = new DataView(buffer);

      let off = 0;
      off = writeUint16(view, off, 4); // pairCount

      // BOOL
      off = writeInt32(view, off, (1 << 8) | 0);
      off = writeUint8(view, off, 1);

      // INT
      off = writeInt32(view, off, (2 << 8) | 1);
      off = writeInt32(view, off, 42);

      // REAL
      off = writeInt32(view, off, (3 << 8) | 2);
      off = writeFloat32(view, off, 1.5);

      // ASCII_STRING
      off = writeInt32(view, off, (4 << 8) | 3);
      writePrefixedAscii(view, off, 'hi');

      const reader = new DataChunkReader(buffer);
      const dict = reader.readDict();

      expect(dict.size).toBe(4);
      expect(dict.get(1)).toBe(true);
      expect(dict.get(2)).toBe(42);
      expect(dict.get(3)).toBeCloseTo(1.5);
      expect(dict.get(4)).toBe('hi');
    });

    it('should read an empty dict', () => {
      const buffer = new ArrayBuffer(2);
      const view = new DataView(buffer);
      writeUint16(view, 0, 0);

      const reader = new DataChunkReader(buffer);
      const dict = reader.readDict();
      expect(dict.size).toBe(0);
    });
  });

  describe('seek and skip', () => {
    it('should move position with seek()', () => {
      const buffer = new ArrayBuffer(16);
      const reader = new DataChunkReader(buffer);
      reader.seek(10);
      expect(reader.position).toBe(10);
    });

    it('should advance position with skip()', () => {
      const buffer = new ArrayBuffer(16);
      const reader = new DataChunkReader(buffer);
      reader.skip(5);
      expect(reader.position).toBe(5);
      reader.skip(3);
      expect(reader.position).toBe(8);
    });
  });
});

describe('HeightmapExtractor', () => {
  it('should extract heightmap dimensions and data (v3)', () => {
    const buffer = buildMinimalMap({ hmWidth: 4, hmHeight: 3, hmBorder: 1 });
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();
    const chunk = reader.readChunkHeader();

    const hm = HeightmapExtractor.extract(reader, chunk.version);
    expect(hm.width).toBe(4);
    expect(hm.height).toBe(3);
    expect(hm.borderSize).toBe(1);
    expect(hm.data).toHaveLength(12); // 4 * 3
    // Verify data pattern (increasing mod 256)
    for (let i = 0; i < 12; i++) {
      expect(hm.data[i]).toBe(i % 256);
    }
  });

  it('should handle v1 without borderSize', () => {
    const buffer = buildMinimalMap({ hmWidth: 2, hmHeight: 2, hmVersion: 1 });
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();
    const chunk = reader.readChunkHeader();

    const hm = HeightmapExtractor.extract(reader, chunk.version);
    expect(hm.width).toBe(2);
    expect(hm.height).toBe(2);
    expect(hm.borderSize).toBe(0);
    expect(hm.data).toHaveLength(4);
  });

  it('should skip v4 boundary size pairs before reading height bytes', () => {
    const buffer = buildMinimalMap({
      hmWidth: 4,
      hmHeight: 4,
      hmBorder: 1,
      hmVersion: 4,
      hmBoundaries: [{ x: 2, y: 2 }, { x: 3, y: 3 }],
    });
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();
    const chunk = reader.readChunkHeader();

    const hm = HeightmapExtractor.extract(reader, chunk.version);
    expect(hm.width).toBe(4);
    expect(hm.height).toBe(4);
    expect(hm.borderSize).toBe(1);
    expect(hm.boundaries).toEqual([{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(hm.data).toHaveLength(16);
  });

  it('should convert to world coordinates', () => {
    const hm = {
      width: 2,
      height: 2,
      borderSize: 0,
      boundaries: [],
      data: new Uint8Array([0, 128, 255, 64]),
    };

    const world = HeightmapExtractor.toWorldCoordinates(hm);
    expect(world).toHaveLength(4);
    expect(world[0]).toBeCloseTo(0 * MAP_HEIGHT_SCALE);
    expect(world[1]).toBeCloseTo(128 * MAP_HEIGHT_SCALE);
    expect(world[2]).toBeCloseTo(255 * MAP_HEIGHT_SCALE);
    expect(world[3]).toBeCloseTo(64 * MAP_HEIGHT_SCALE);
  });
});

describe('MapObjectExtractor', () => {
  it('should extract object position, angle, flags, and template (v2)', () => {
    const buffer = buildMapWithObjects();
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();

    // Skip HeightMapData chunk
    const hmChunk = reader.readChunkHeader();
    reader.seek(hmChunk.dataOffset + hmChunk.dataSize);

    // Read ObjectsList chunk
    const objListChunk = reader.readChunkHeader();
    expect(objListChunk.id).toBe(2); // ObjectsList

    // Read child Object chunk
    const objChunk = reader.readChunkHeader();
    expect(objChunk.id).toBe(3); // Object

    const obj = MapObjectExtractor.extract(reader, objChunk.version);
    expect(obj.position.x).toBeCloseTo(100.0);
    expect(obj.position.y).toBeCloseTo(200.0);
    expect(obj.position.z).toBe(0); // v2 has no z
    expect(obj.angle).toBeCloseTo(45.0);
    expect(obj.flags).toBe(0x001);
    expect(obj.templateName).toBe('AmericaCommandCenter');
    expect(obj.properties.get(42)).toBe(100);
  });

  it('should extract v3 object with z coordinate', () => {
    // Build a standalone v3 object payload
    const templateName = 'ChinaTank';
    const objPayload = 4 + 4 + 4 + 4 + 4 + 2 + templateName.length + 2;
    // posX + posY + posZ(v3) + angle + flags + name + empty dict
    const buffer = new ArrayBuffer(objPayload);
    const view = new DataView(buffer);

    let off = 0;
    off = writeFloat32(view, off, 50.0);  // posX
    off = writeFloat32(view, off, 75.0);  // posY
    off = writeFloat32(view, off, 10.0);  // posZ (v3)
    off = writeFloat32(view, off, 90.0);  // angle
    off = writeInt32(view, off, 0x002);   // flags: ROAD_POINT1
    off = writePrefixedAscii(view, off, templateName);
    writeUint16(view, off, 0); // empty dict

    const reader = new DataChunkReader(buffer);
    const obj = MapObjectExtractor.extract(reader, 3);
    expect(obj.position.x).toBeCloseTo(50.0);
    expect(obj.position.y).toBeCloseTo(75.0);
    expect(obj.position.z).toBeCloseTo(10.0);
    expect(obj.angle).toBeCloseTo(90.0);
    expect(obj.flags).toBe(0x002);
    expect(obj.templateName).toBe('ChinaTank');
  });
});

describe('WaypointExtractor', () => {
  it('should extract polygon triggers (v2)', () => {
    const buffer = buildMapWithTriggers();
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();

    // Skip HeightMapData chunk
    const hmChunk = reader.readChunkHeader();
    reader.seek(hmChunk.dataOffset + hmChunk.dataSize);

    // Read PolygonTriggers chunk
    const trigChunk = reader.readChunkHeader();
    const triggers = WaypointExtractor.extractTriggers(reader, trigChunk.version);

    expect(triggers).toHaveLength(1);
    const trig = triggers[0]!;
    expect(trig.name).toBe('SpawnZone');
    expect(trig.id).toBe(7);
    expect(trig.isWaterArea).toBe(true);
    expect(trig.isRiver).toBe(false); // v2 doesn't have river
    expect(trig.points).toHaveLength(3);
    expect(trig.points[0]).toEqual({ x: 10, y: 20, z: 30 });
    expect(trig.points[1]).toEqual({ x: 40, y: 50, z: 60 });
    expect(trig.points[2]).toEqual({ x: 70, y: 80, z: 90 });
  });

  it('should extract polygon triggers (v4 with layer name)', () => {
    const buffer = buildMapWithTriggersV4();
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();

    // Skip HeightMapData chunk
    const hmChunk = reader.readChunkHeader();
    reader.seek(hmChunk.dataOffset + hmChunk.dataSize);

    // Read PolygonTriggers chunk
    const trigChunk = reader.readChunkHeader();
    const triggers = WaypointExtractor.extractTriggers(reader, trigChunk.version);

    expect(triggers).toHaveLength(1);
    const trig = triggers[0]!;
    expect(trig.name).toBe('SpawnZone');
    expect(trig.id).toBe(7);
    expect(trig.isWaterArea).toBe(true);
    expect(trig.isRiver).toBe(true);
    expect(trig.points).toHaveLength(3);
    expect(trig.points[0]).toEqual({ x: 10, y: 20, z: 30 });
    expect(trig.points[1]).toEqual({ x: 40, y: 50, z: 60 });
    expect(trig.points[2]).toEqual({ x: 70, y: 80, z: 90 });
  });

  it('should extract waypoint links (WaypointsList v1)', () => {
    const buffer = buildMapWithWaypoints();
    const reader = new DataChunkReader(buffer);
    reader.readTableOfContents();

    const hmChunk = reader.readChunkHeader();
    reader.seek(hmChunk.dataOffset + hmChunk.dataSize);

    const objectsChunk = reader.readChunkHeader();
    reader.seek(objectsChunk.dataOffset + objectsChunk.dataSize);

    const waypointsChunk = reader.readChunkHeader();
    const links = WaypointExtractor.extractWaypointLinks(reader);

    expect(waypointsChunk.version).toBe(1);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ waypoint1: 11, waypoint2: 12 });
  });

  it('should normalize waypoint links with node validity and directionality', () => {
    const nodesById = new Map<
      number,
      { id: number; name: string; position: { x: number; y: number; z: number }; biDirectional: boolean }
    >([
      [11, { id: 11, name: 'A', position: { x: 0, y: 0, z: 0 }, biDirectional: true }],
      [12, { id: 12, name: 'B', position: { x: 1, y: 1, z: 1 }, biDirectional: false }],
      [13, { id: 13, name: 'C', position: { x: 2, y: 2, z: 2 }, biDirectional: true }],
    ]);

    const links = [
      { waypoint1: 11, waypoint2: 12 },
      { waypoint1: 11, waypoint2: 12 },
      { waypoint1: 12, waypoint2: 12 },
      { waypoint1: 99, waypoint2: 11 },
      { waypoint1: 12, waypoint2: 13 },
      { waypoint1: 13, waypoint2: 11 },
    ];

    const normalized = WaypointExtractor.normalizeWaypointLinks(links, nodesById);

    expect(normalized).toEqual([
      { waypoint1: 11, waypoint2: 12 },
      { waypoint1: 12, waypoint2: 11 },
      { waypoint1: 12, waypoint2: 13 },
      { waypoint1: 13, waypoint2: 11 },
      { waypoint1: 11, waypoint2: 13 },
    ]);
  });
});

describe('MapParser', () => {
  it('should parse a minimal map with only heightmap', () => {
    const buffer = buildMinimalMap({ hmWidth: 5, hmHeight: 4, hmBorder: 2 });
    const parsed = MapParser.parse(buffer);

    expect(parsed.heightmap.width).toBe(5);
    expect(parsed.heightmap.height).toBe(4);
    expect(parsed.heightmap.borderSize).toBe(2);
    expect(parsed.heightmap.data).toHaveLength(20);
    expect(parsed.objects).toHaveLength(0);
    expect(parsed.triggers).toHaveLength(0);
    expect(parsed.textureClasses).toHaveLength(0);
    expect(parsed.blendTileCount).toBe(0);
    expect(parsed.cliffStateData).toBeNull();
    expect(parsed.cliffStateStride).toBe(0);
    expect(parsed.waypoints.nodes).toHaveLength(0);
    expect(parsed.waypoints.links).toHaveLength(0);
  });

  it('should parse EAR-wrapped retail map payloads', () => {
    const payload = buildMinimalMap({ hmWidth: 3, hmHeight: 3, hmBorder: 1 });
    const wrapped = wrapMapInEarContainer(payload);
    const parsed = MapParser.parse(wrapped);

    expect(parsed.heightmap.width).toBe(3);
    expect(parsed.heightmap.height).toBe(3);
    expect(parsed.heightmap.borderSize).toBe(1);
    expect(parsed.heightmap.data).toHaveLength(9);
  });

  it('should parse a map with objects', () => {
    const buffer = buildMapWithObjects();
    const parsed = MapParser.parse(buffer);

    expect(parsed.heightmap.width).toBe(2);
    expect(parsed.heightmap.height).toBe(2);
    expect(parsed.objects).toHaveLength(1);

    const obj = parsed.objects[0]!;
    expect(obj.templateName).toBe('AmericaCommandCenter');
    expect(obj.position.x).toBeCloseTo(100.0);
    expect(obj.position.y).toBeCloseTo(200.0);
    expect(obj.angle).toBeCloseTo(45.0);
    expect(parsed.waypoints.nodes).toHaveLength(0);
    expect(parsed.waypoints.links).toHaveLength(0);
  });

  it('should parse a map with triggers', () => {
    const buffer = buildMapWithTriggers();
    const parsed = MapParser.parse(buffer);

    expect(parsed.triggers).toHaveLength(1);
    expect(parsed.triggers[0]!.name).toBe('SpawnZone');
    expect(parsed.triggers[0]!.points).toHaveLength(3);
    expect(parsed.waypoints.nodes).toHaveLength(0);
    expect(parsed.waypoints.links).toHaveLength(0);
  });

  it('should parse waypoint nodes and links', () => {
    const buffer = buildMapWithWaypointGraph();
    const parsed = MapParser.parse(buffer);

    expect(parsed.waypoints.nodes).toHaveLength(3);
    expect(parsed.waypoints.links).toHaveLength(4);
    expect(parsed.waypoints.links).toEqual([
      { waypoint1: 11, waypoint2: 12 },
      { waypoint1: 12, waypoint2: 11 },
      { waypoint1: 12, waypoint2: 13 },
      { waypoint1: 13, waypoint2: 12 },
    ]);
    expect(parsed.objects).toHaveLength(3);
    expect(parsed.objects[0]!.propertiesByName.get('waypointPathBiDirectional')).toBe(true);
    expect(parsed.objects[0]!.propertiesByName.get('waypointID')).toBe(11);
    expect(parsed.objects[0]!.propertiesByName.get('waypointName')).toBe('TrainRouteStart01');
    expect(parsed.objects[1]!.propertiesByName.get('waypointPathBiDirectional')).toBe(false);
    expect(parsed.objects[1]!.propertiesByName.get('waypointName')).toBe('TrainRouteMid01');
    expect(parsed.objects[2]!.propertiesByName.get('waypointPathBiDirectional')).toBe(true);
    expect(parsed.objects[2]!.propertiesByName.get('waypointName')).toBe('TrainRouteEnd01');

    const startNode = parsed.waypoints.nodes.find((node) => node.id === 11)!;
    const midNode = parsed.waypoints.nodes.find((node) => node.id === 12)!;
    const endNode = parsed.waypoints.nodes.find((node) => node.id === 13)!;

    expect(startNode.name).toBe('TrainRouteStart01');
    expect(startNode.pathLabel1).toBe('RailMain');
    expect(startNode.biDirectional).toBe(true);
    expect(midNode.pathLabel2).toBe('LocalEdge');
    expect(midNode.biDirectional).toBe(false);
    expect(endNode.pathLabel3).toBe('ReturnPath');
    expect(endNode.biDirectional).toBe(true);

    const reversed = parsed.waypoints.links.find((link) => link.waypoint1 === 12 && link.waypoint2 === 11);
    expect(reversed).toBeDefined();
  });

  it('should drop waypoint links with invalid endpoints or self-loops', () => {
    const buffer = buildMapWithWaypoints();
    const parsed = MapParser.parse(buffer);

    expect(parsed.waypoints.nodes).toHaveLength(1);
    expect(parsed.waypoints.links).toHaveLength(0);
  });

  it('should throw if HeightMapData chunk is missing', () => {
    // Build a buffer with valid TOC but no HeightMapData chunk
    const chunks: ChunkDef[] = [{ name: 'SomeOtherChunk', id: 99 }];
    const dummyPayload = 4; // 4 bytes of nothing
    const totalSize = tocSize(chunks) + CHUNK_HEADER_SIZE + dummyPayload;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let off = writeTOC(view, chunks);
    off = writeChunkHeader(view, off, 99, 1, dummyPayload);
    void writeInt32(view, off, 0);

    expect(() => MapParser.parse(buffer)).toThrow(/missing required HeightMapData/);
  });

  it('should skip unknown chunk types gracefully', () => {
    // Build a map with HeightMapData + an unknown chunk
    const chunks: ChunkDef[] = [
      { name: 'HeightMapData', id: 1 },
      { name: 'UnknownChunk', id: 99 },
    ];

    const hmWidth = 2;
    const hmHeight = 2;
    const hmDataLen = hmWidth * hmHeight;
    const hmPayload = 4 + 4 + 4 + 4 + hmDataLen; // width + height + border + dataSize + data

    const unknownPayload = 8;

    const totalSize =
      tocSize(chunks) +
      CHUNK_HEADER_SIZE + hmPayload +
      CHUNK_HEADER_SIZE + unknownPayload;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let off = writeTOC(view, chunks);

    // HeightMapData
    off = writeChunkHeader(view, off, 1, 3, hmPayload);
    off = writeInt32(view, off, hmWidth);
    off = writeInt32(view, off, hmHeight);
    off = writeInt32(view, off, 0); // borderSize
    off = writeInt32(view, off, hmDataLen);
    for (let i = 0; i < hmDataLen; i++) {
      off = writeUint8(view, off, 200);
    }

    // Unknown chunk
    off = writeChunkHeader(view, off, 99, 1, unknownPayload);
    // Fill with junk
    for (let i = 0; i < unknownPayload; i++) {
      off = writeUint8(view, off, 0xFF);
    }

    const parsed = MapParser.parse(buffer);
    expect(parsed.heightmap.width).toBe(2);
    expect(parsed.heightmap.height).toBe(2);
    expect(parsed.objects).toHaveLength(0);
  });

  it('should reject malformed PlayerScriptsList payloads', () => {
    const chunks: ChunkDef[] = [
      { name: 'HeightMapData', id: 1 },
      { name: 'SidesList', id: 2 },
      { name: 'PlayerScriptsList', id: 3 },
      { name: 'ScriptList', id: 4 },
      { name: 'Script', id: 5 },
    ];

    const hmWidth = 2;
    const hmHeight = 2;
    const hmDataLen = hmWidth * hmHeight;
    const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

    const malformedScriptPayload = Uint8Array.from([0xff]);
    const scriptListPayload = CHUNK_HEADER_SIZE + malformedScriptPayload.length;
    const playerScriptsPayload = CHUNK_HEADER_SIZE + scriptListPayload;
    const sidesPayload = 4 + 4 + CHUNK_HEADER_SIZE + playerScriptsPayload;

    const totalSize =
      tocSize(chunks) +
      CHUNK_HEADER_SIZE + hmPayload +
      CHUNK_HEADER_SIZE + sidesPayload;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let off = writeTOC(view, chunks);

    off = writeChunkHeader(view, off, 1, 3, hmPayload);
    off = writeInt32(view, off, hmWidth);
    off = writeInt32(view, off, hmHeight);
    off = writeInt32(view, off, 0);
    off = writeInt32(view, off, hmDataLen);
    for (let i = 0; i < hmDataLen; i++) {
      off = writeUint8(view, off, 32 + i);
    }

    off = writeChunkHeader(view, off, 2, 2, sidesPayload);
    off = writeInt32(view, off, 0); // sideCount
    off = writeInt32(view, off, 0); // teamCount (version >= 2)
    off = writeChunkHeader(view, off, 3, 1, playerScriptsPayload);
    off = writeChunkHeader(view, off, 4, 1, scriptListPayload);
    off = writeChunkHeader(view, off, 5, 2, malformedScriptPayload.length);
    for (const value of malformedScriptPayload) {
      off = writeUint8(view, off, value);
    }

    // Source parity: SidesList::ParseSidesDataChunk registers
    // PlayerScriptsList and throws ERROR_CORRUPT_FILE_FORMAT when file.parse
    // fails instead of silently keeping the rest of the map.
    expect(() => MapParser.parse(buffer)).toThrow();
  });

  it('should parse PlayerScriptsList chunks with v4 conditions and v2 actions', () => {
    const chunks: ChunkDef[] = [
      { name: 'HeightMapData', id: 1 },
      { name: 'SidesList', id: 2 },
      { name: 'PlayerScriptsList', id: 3 },
      { name: 'ScriptList', id: 4 },
      { name: 'Script', id: 5 },
      { name: 'OrCondition', id: 6 },
      { name: 'Condition', id: 7 },
      { name: 'ScriptAction', id: 8 },
    ];

    const hmWidth = 2;
    const hmHeight = 2;
    const hmDataLen = hmWidth * hmHeight;
    const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

    // Parameter payload (non-COORD3D): type + int + real + ascii string
    const paramString = 'ok';
    const paramPayload = 4 + 4 + 4 + 2 + paramString.length;

    // Condition v4: type + internalNameKey + paramCount + params
    const conditionPayload = 4 + 4 + 4 + paramPayload;
    const orConditionPayload = CHUNK_HEADER_SIZE + conditionPayload;

    // Action v2: type + internalNameKey + paramCount + params
    const actionPayload = 4 + 4 + 4 + paramPayload;

    const scriptName = 'ScriptA';
    const scriptPayload =
      (2 + scriptName.length) + // name
      2 + // comment
      2 + // conditionComment
      2 + // actionComment
      6 + // active/oneShot/easy/normal/hard/subroutine flags
      4 + // delayEvaluationSeconds (v2)
      (CHUNK_HEADER_SIZE + orConditionPayload) +
      (CHUNK_HEADER_SIZE + actionPayload);

    const scriptListPayload = CHUNK_HEADER_SIZE + scriptPayload;
    const playerScriptsPayload = CHUNK_HEADER_SIZE + scriptListPayload;

    // SidesList v2: sideCount + side(dict/buildList) + teamCount + PlayerScriptsList chunk
    const oneSidePayload =
      2 + // dict pairCount (0 entries)
      4; // buildListCount (0 entries)
    const sidesPayload =
      4 + // sideCount
      oneSidePayload +
      4 + // teamCount
      (CHUNK_HEADER_SIZE + playerScriptsPayload);

    const totalSize =
      tocSize(chunks) +
      CHUNK_HEADER_SIZE + hmPayload +
      CHUNK_HEADER_SIZE + sidesPayload +
      64;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let off = writeTOC(view, chunks);

    off = writeChunkHeader(view, off, 1, 3, hmPayload);
    off = writeInt32(view, off, hmWidth);
    off = writeInt32(view, off, hmHeight);
    off = writeInt32(view, off, 0);
    off = writeInt32(view, off, hmDataLen);
    for (let i = 0; i < hmDataLen; i++) {
      off = writeUint8(view, off, 16 + i);
    }

    off = writeChunkHeader(view, off, 2, 2, sidesPayload);
    off = writeInt32(view, off, 1); // sideCount
    off = writeUint16(view, off, 0); // side dict pairCount
    off = writeInt32(view, off, 0); // side buildListCount
    off = writeInt32(view, off, 0); // teamCount

    off = writeChunkHeader(view, off, 3, 1, playerScriptsPayload);
    off = writeChunkHeader(view, off, 4, 1, scriptListPayload);
    off = writeChunkHeader(view, off, 5, 2, scriptPayload);
    off = writePrefixedAscii(view, off, scriptName);
    off = writePrefixedAscii(view, off, '');
    off = writePrefixedAscii(view, off, '');
    off = writePrefixedAscii(view, off, '');
    off = writeUint8(view, off, 1); // active
    off = writeUint8(view, off, 0); // oneShot
    off = writeUint8(view, off, 1); // easy
    off = writeUint8(view, off, 1); // normal
    off = writeUint8(view, off, 1); // hard
    off = writeUint8(view, off, 0); // subroutine
    off = writeInt32(view, off, 0); // delayEvaluationSeconds

    off = writeChunkHeader(view, off, 6, 1, orConditionPayload);
    off = writeChunkHeader(view, off, 7, 4, conditionPayload);
    off = writeInt32(view, off, 42); // conditionType
    off = writeUint32(view, off, 0); // internal NameKey (v4)
    off = writeInt32(view, off, 1); // paramCount
    off = writeInt32(view, off, 1); // param.type
    off = writeInt32(view, off, 123); // param.int
    off = writeFloat32(view, off, 1.25); // param.real
    off = writePrefixedAscii(view, off, paramString);

    off = writeChunkHeader(view, off, 8, 2, actionPayload);
    off = writeInt32(view, off, 7); // actionType
    off = writeUint32(view, off, 0); // internal NameKey (v2)
    off = writeInt32(view, off, 1); // paramCount
    off = writeInt32(view, off, 1); // param.type
    off = writeInt32(view, off, 99); // param.int
    off = writeFloat32(view, off, 2.5); // param.real
    off = writePrefixedAscii(view, off, paramString);

    const parsed = MapParser.parse(buffer.slice(0, off));
    expect(parsed.sidesList).toBeDefined();
    expect(parsed.sidesList?.sides).toHaveLength(1);
    const scripts = parsed.sidesList?.sides[0]?.scripts;
    expect(scripts?.scripts).toHaveLength(1);
    expect(scripts?.scripts[0]?.name).toBe(scriptName);
    expect(scripts?.scripts[0]?.conditions).toHaveLength(1);
    expect(scripts?.scripts[0]?.conditions[0]?.conditions).toHaveLength(1);
    expect(scripts?.scripts[0]?.actions).toHaveLength(1);
  });

  it('should parse v8 cliff-state bits from BlendTileData', () => {
    const chunks: ChunkDef[] = [
      { name: 'HeightMapData', id: 1 },
      { name: 'BlendTileData', id: 2 },
    ];

    const width = 4;
    const height = 4;
    const hmDataLen = width * height;
    const hmPayload = 4 + 4 + 4 + 4 + hmDataLen;

    const tileCount = width * height;
    const cliffStride = Math.floor((width + 7) / 8);
    const cliffBytesLen = height * cliffStride;
    const textureClassName = 'Grass';
    const blendPayload =
      4 +                  // tileCount
      tileCount * 2 +      // tileIndices
      tileCount * 2 +      // blendTileIndices
      tileCount * 2 +      // extraBlendTileIndices (v6+)
      tileCount * 2 +      // cliffInfoIndices (v5+)
      cliffBytesLen +      // cliffState bits (v7+)
      4 +                  // numBitmapTiles
      4 +                  // numBlendedTiles
      4 +                  // numCliffInfo
      4 +                  // numTextureClasses
      4 + 4 + 4 + 4 +      // firstTile + numTiles + width + legacy
      2 + textureClassName.length;

    const totalSize =
      tocSize(chunks) +
      CHUNK_HEADER_SIZE + hmPayload +
      CHUNK_HEADER_SIZE + blendPayload;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let off = writeTOC(view, chunks);

    off = writeChunkHeader(view, off, 1, 3, hmPayload);
    off = writeInt32(view, off, width);
    off = writeInt32(view, off, height);
    off = writeInt32(view, off, 0);
    off = writeInt32(view, off, hmDataLen);
    for (let i = 0; i < hmDataLen; i++) {
      off = writeUint8(view, off, 64);
    }

    off = writeChunkHeader(view, off, 2, 8, blendPayload);
    off = writeInt32(view, off, tileCount);
    off += tileCount * 2; // tileIndices
    off += tileCount * 2; // blendTileIndices
    off += tileCount * 2; // extraBlendTileIndices
    off += tileCount * 2; // cliffInfoIndices
    off = writeUint8(view, off, 0b00001000); // row 0
    off = writeUint8(view, off, 0); // row 1
    off = writeUint8(view, off, 0); // row 2
    off = writeUint8(view, off, 0); // row 3
    off = writeInt32(view, off, 1); // numBitmapTiles
    off = writeInt32(view, off, 1); // numBlendedTiles
    off = writeInt32(view, off, 1); // numCliffInfo
    off = writeInt32(view, off, 1); // numTextureClasses
    off = writeInt32(view, off, 0); // firstTile
    off = writeInt32(view, off, 1); // numTiles
    off = writeInt32(view, off, 1); // width
    off = writeInt32(view, off, 0); // legacy
    off = writePrefixedAscii(view, off, textureClassName);

    const parsed = MapParser.parse(buffer);
    expect(parsed.blendTileCount).toBe(tileCount);
    expect(parsed.textureClasses).toEqual(['Grass']);
    expect(parsed.cliffStateStride).toBe(cliffStride);
    expect(parsed.cliffStateData).not.toBeNull();
    expect(parsed.cliffStateData![0]).toBe(0b00001000);
  });
});

describe('BlendTileExtractor', () => {
  it('normalizes v7 cliff-state rows with legacy stride', () => {
    const mapWidth = 9;
    const mapHeight = 2;
    const tileCount = mapWidth * mapHeight;
    const legacyStride = Math.floor((mapWidth + 1) / 8);
    const payloadSize =
      4 +                  // tileCount
      tileCount * 2 +      // tileIndices
      tileCount * 2 +      // blendTileIndices
      tileCount * 2 +      // extraBlendTileIndices (v6+)
      tileCount * 2 +      // cliffInfoIndices (v5+)
      mapHeight * legacyStride + // v7 legacy cliff bits
      4 +                  // numBitmapTiles
      4 +                  // numBlendedTiles
      4 +                  // numCliffInfo
      4;                   // numTextureClasses

    const buffer = new ArrayBuffer(payloadSize);
    const view = new DataView(buffer);
    let off = 0;
    off = writeInt32(view, off, tileCount);
    off += tileCount * 2;
    off += tileCount * 2;
    off += tileCount * 2;
    off += tileCount * 2;
    off = writeUint8(view, off, 0b00000001);
    off = writeUint8(view, off, 0b00000010);
    off = writeInt32(view, off, 1);
    off = writeInt32(view, off, 1);
    off = writeInt32(view, off, 1);
    void writeInt32(view, off, 0);

    const reader = new DataChunkReader(buffer);
    const info = BlendTileExtractor.extract(reader, 7, mapWidth, mapHeight);
    expect(info.cliffStateStride).toBe(Math.floor((mapWidth + 7) / 8));
    expect(info.cliffStateData).not.toBeNull();
    expect(info.cliffStateData!.length).toBe(mapHeight * info.cliffStateStride);
    expect(info.cliffStateData![0]).toBe(0b00000001);
    expect(info.cliffStateData![2]).toBe(0b00000010);
  });
});
