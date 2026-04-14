/**
 * Top-level .map file parser.
 *
 * Reads the table of contents, then iterates through data chunks and
 * dispatches to the appropriate extractors based on chunk label.
 */

import { DataChunkReader, CHUNK_HEADER_SIZE, MAP_MAGIC } from './DataChunkReader.js';
import type { ChunkTableEntry, DataChunk } from './DataChunkReader.js';
import { HeightmapExtractor } from './HeightmapExtractor.js';
import type { HeightmapData } from './HeightmapExtractor.js';
import { MapObjectExtractor } from './MapObjectExtractor.js';
import type { MapObject } from './MapObjectExtractor.js';
import { WaypointExtractor } from './WaypointExtractor.js';
import type { PolygonTrigger, WaypointLink, WaypointNode } from './WaypointExtractor.js';
import { BlendTileExtractor } from './BlendTileExtractor.js';
import type { TextureClass } from './BlendTileExtractor.js';
import { SidesListExtractor } from './SidesListExtractor.js';
import type { MapSidesListJSON } from './SidesListExtractor.js';

/** Complete parsed representation of a .map file. */
export interface ParsedMap {
  /** Terrain heightmap data. */
  heightmap: HeightmapData;
  /** All placed objects. */
  objects: MapObject[];
  /** Polygon trigger regions. */
  triggers: PolygonTrigger[];
  /** Waypoint nodes and links. */
  waypoints: {
    nodes: WaypointNode[];
    links: WaypointLink[];
  };
  /** Total number of blend tiles. */
  blendTileCount: number;
  /** Texture class names used by the terrain. */
  textureClasses: string[];
  /** Full texture class definitions (with firstTile/numTiles for tile-to-class resolution). */
  textureClassDefs: TextureClass[];
  /** Per-cell tile index array mapping each cell to a source tile index. */
  tileIndices: Int16Array | null;
  /** Optional packed cliff-state bits from BlendTileData (v7+). */
  cliffStateData: Uint8Array | null;
  /** Bytes per row for `cliffStateData`. */
  cliffStateStride: number;
  /** Optional SidesList payload containing sides, teams, and scripts. */
  sidesList?: MapSidesListJSON;
}

/** Chunk label constants. */
const CHUNK_HEIGHTMAP = 'HeightMapData';
const CHUNK_BLEND_TILE = 'BlendTileData';
const CHUNK_OBJECTS_LIST = 'ObjectsList';
const CHUNK_OBJECT = 'Object';
const CHUNK_POLYGON_TRIGGERS = 'PolygonTriggers';
const CHUNK_WAYPOINTS_LIST = 'WaypointsList';
const CHUNK_SIDES_LIST = 'SidesList';
const EAR_WRAPPER_MAGIC_BYTES = Uint8Array.from([0x45, 0x41, 0x52, 0x00]); // "EAR\0"
const MAP_MAGIC_BYTES = Uint8Array.from(MAP_MAGIC, (char) => char.charCodeAt(0));
const EAR_HEADER_BYTES = 8;
const EAR_WRAPPER_SCAN_LIMIT_BYTES = 1024;
const REF_PACK_TYPE_10FB = 0x10fb;
const REF_PACK_TYPE_11FB = 0x11fb;
const REF_PACK_TYPE_90FB = 0x90fb;
const REF_PACK_TYPE_91FB = 0x91fb;

function startsWithBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (haystack.length < needle.length) {
    return false;
  }
  for (let i = 0; i < needle.length; i++) {
    if (haystack[i] !== needle[i]) {
      return false;
    }
  }
  return true;
}

function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  startOffset: number,
  endExclusive: number,
): number {
  if (needle.length === 0) {
    return startOffset;
  }
  const maxStart = Math.min(haystack.length - needle.length, endExclusive - needle.length);
  if (maxStart < startOffset) {
    return -1;
  }
  for (let offset = startOffset; offset <= maxStart; offset++) {
    let matches = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[offset + i] !== needle[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return offset;
    }
  }
  return -1;
}

function isRefPackType(value: number): boolean {
  return value === REF_PACK_TYPE_10FB
    || value === REF_PACK_TYPE_11FB
    || value === REF_PACK_TYPE_90FB
    || value === REF_PACK_TYPE_91FB;
}

function readBigEndianInteger(bytes: Uint8Array, offset: number, width: 3 | 4): number {
  if (offset < 0 || offset + width > bytes.length) {
    throw new Error('RefPack read out of range.');
  }
  let value = 0;
  for (let i = 0; i < width; i++) {
    value = (value << 8) | (bytes[offset + i] ?? 0);
  }
  return value >>> 0;
}

function decodeRefPackPayload(payload: Uint8Array): Uint8Array {
  if (payload.length < 5) {
    throw new Error('RefPack payload is too short.');
  }

  let srcOffset = 0;
  const type = ((payload[srcOffset++] ?? 0) << 8) | (payload[srcOffset++] ?? 0);
  if (!isRefPackType(type)) {
    throw new Error('Unsupported RefPack header.');
  }

  const sizeFieldBytes: 3 | 4 = (type & 0x8000) !== 0 ? 4 : 3;
  if ((type & 0x0100) !== 0) {
    srcOffset += sizeFieldBytes;
  }

  const decodedLength = readBigEndianInteger(payload, srcOffset, sizeFieldBytes);
  srcOffset += sizeFieldBytes;

  const decoded = new Uint8Array(decodedLength);
  let dstOffset = 0;

  const copyLiterals = (count: number): void => {
    if (count < 0 || srcOffset + count > payload.length) {
      throw new Error('RefPack literal copy exceeds source bounds.');
    }
    if (dstOffset + count > decoded.length) {
      throw new Error('RefPack literal copy exceeds destination bounds.');
    }
    decoded.set(payload.subarray(srcOffset, srcOffset + count), dstOffset);
    srcOffset += count;
    dstOffset += count;
  };

  const copyBackReference = (distance: number, count: number): void => {
    if (distance <= 0) {
      throw new Error('RefPack back-reference distance must be positive.');
    }
    let refOffset = dstOffset - distance;
    if (refOffset < 0) {
      throw new Error('RefPack back-reference points before output start.');
    }
    if (dstOffset + count > decoded.length) {
      throw new Error('RefPack back-reference copy exceeds destination bounds.');
    }
    for (let i = 0; i < count; i++) {
      decoded[dstOffset++] = decoded[refOffset++] ?? 0;
    }
  };

  while (srcOffset < payload.length) {
    const first = payload[srcOffset++] ?? 0;

    if ((first & 0x80) === 0) {
      const second = payload[srcOffset++] ?? 0;
      const literalCount = first & 0x03;
      copyLiterals(literalCount);

      const distance = (((first & 0x60) << 3) + second) + 1;
      const copyCount = ((first & 0x1c) >> 2) + 3;
      copyBackReference(distance, copyCount);
      continue;
    }

    if ((first & 0x40) === 0) {
      const second = payload[srcOffset++] ?? 0;
      const third = payload[srcOffset++] ?? 0;
      const literalCount = second >> 6;
      copyLiterals(literalCount);

      const distance = (((second & 0x3f) << 8) + third) + 1;
      const copyCount = (first & 0x3f) + 4;
      copyBackReference(distance, copyCount);
      continue;
    }

    if ((first & 0x20) === 0) {
      const second = payload[srcOffset++] ?? 0;
      const third = payload[srcOffset++] ?? 0;
      const fourth = payload[srcOffset++] ?? 0;
      const literalCount = first & 0x03;
      copyLiterals(literalCount);

      const distance = ((((first & 0x10) >> 4) << 16) + (second << 8) + third) + 1;
      const copyCount = (((first & 0x0c) >> 2) << 8) + fourth + 5;
      copyBackReference(distance, copyCount);
      continue;
    }

    const literalRun = ((first & 0x1f) << 2) + 4;
    if (literalRun <= 112) {
      copyLiterals(literalRun);
      continue;
    }

    const eofLiteralCount = first & 0x03;
    copyLiterals(eofLiteralCount);
    break;
  }

  if (dstOffset !== decoded.length) {
    throw new Error(
      `RefPack decode length mismatch: expected ${decoded.length} bytes, got ${dstOffset}.`,
    );
  }

  return decoded;
}

function normalizeMapPayloadBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  if (startsWithBytes(bytes, MAP_MAGIC_BYTES)) {
    return buffer;
  }

  if (!startsWithBytes(bytes, EAR_WRAPPER_MAGIC_BYTES)) {
    return buffer;
  }

  // Source parity: CompressionManager::decompressData COMPRESSION_REFPACK.
  // EAR payloads are RefPack-compressed and must be decompressed before map parsing.
  if (bytes.length >= EAR_HEADER_BYTES + 2) {
    const payload = bytes.subarray(EAR_HEADER_BYTES);
    const refPackType = ((payload[0] ?? 0) << 8) | (payload[1] ?? 0);
    if (isRefPackType(refPackType)) {
      try {
        const expectedUncompressedLen = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).getUint32(4, true);
        const decoded = decodeRefPackPayload(payload);
        if (expectedUncompressedLen !== 0 && decoded.length !== expectedUncompressedLen) {
          throw new Error(
            `EAR wrapper size mismatch: header=${expectedUncompressedLen}, decoded=${decoded.length}.`,
          );
        }
        const decodedCopy = new Uint8Array(decoded.byteLength);
        decodedCopy.set(decoded);
        return decodedCopy.buffer;
      } catch {
        // Fall through to direct CkMp scan for synthetic/partially-unwrapped fixtures.
      }
    }
  }

  // Fallback for already-unwrapped or synthetic EAR-prefix payloads.
  const searchEnd = Math.min(bytes.length, EAR_WRAPPER_SCAN_LIMIT_BYTES);
  const ckmpOffset = indexOfBytes(bytes, MAP_MAGIC_BYTES, EAR_WRAPPER_MAGIC_BYTES.length, searchEnd);
  if (ckmpOffset >= 0) {
    return buffer.slice(ckmpOffset);
  }

  return buffer;
}

export class MapParser {
  /**
   * Parse a complete .map file from an ArrayBuffer.
   *
   * Reads the TOC, then walks all data chunks, extracting heightmap,
   * objects, triggers, and blend tile data.
   */
  static parse(buffer: ArrayBuffer): ParsedMap {
    const normalizedBuffer = normalizeMapPayloadBuffer(buffer);
    const reader = new DataChunkReader(normalizedBuffer);
    const toc = reader.readTableOfContents();

    // Build ID-to-name lookup from TOC
    const idToName = new Map<number, string>();
    for (const entry of toc) {
      idToName.set(entry.id, entry.name);
    }

    let heightmap: HeightmapData | undefined;
    const objects: MapObject[] = [];
    const triggers: PolygonTrigger[] = [];
    const waypointLinks: WaypointLink[] = [];
    let blendTileCount = 0;
    const textureClasses: string[] = [];
    const textureClassDefs: TextureClass[] = [];
    let tileIndices: Int16Array | null = null;
    let cliffStateData: Uint8Array | null = null;
    let cliffStateStride = 0;
    let sidesList: MapSidesListJSON | undefined;

    // Walk all chunks until end of buffer
    while (reader.position < reader.byteLength) {
      // Safety: don't read past end
      if (reader.position + CHUNK_HEADER_SIZE > reader.byteLength) break;

      const chunk = reader.readChunkHeader();
      const chunkName = idToName.get(chunk.id);
      const chunkEnd = chunk.dataOffset + chunk.dataSize;

      switch (chunkName) {
        case CHUNK_HEIGHTMAP:
          heightmap = HeightmapExtractor.extract(reader, chunk.version);
          break;

        case CHUNK_BLEND_TILE: {
          if (!heightmap) {
            // BlendTileData v7+ cliff-state decoding depends on map dimensions.
            break;
          }
          const blendInfo = BlendTileExtractor.extract(
            reader,
            chunk.version,
            heightmap.width,
            heightmap.height,
          );
          blendTileCount = blendInfo.tileCount;
          for (const tc of blendInfo.textureClasses) {
            textureClasses.push(tc.name);
            textureClassDefs.push(tc);
          }
          tileIndices = blendInfo.tileIndices;
          cliffStateData = blendInfo.cliffStateData;
          cliffStateStride = blendInfo.cliffStateStride;
          break;
        }

        case CHUNK_OBJECTS_LIST:
          // ObjectsList is a container; its child Object chunks follow
          // immediately inside its data range. We parse them inline.
          MapParser.parseObjectsList(reader, chunk, idToName, objects);
          break;

        case CHUNK_POLYGON_TRIGGERS: {
          const trigs = WaypointExtractor.extractTriggers(reader, chunk.version);
          triggers.push(...trigs);
          break;
        }

        case CHUNK_WAYPOINTS_LIST: {
          const links = WaypointExtractor.extractWaypointLinks(reader);
          waypointLinks.push(...links);
          break;
        }
        case CHUNK_SIDES_LIST:
          sidesList = SidesListExtractor.extract(reader, chunk, idToName);
          break;

        default:
          // Skip unknown chunks
          break;
      }

      // Ensure we advance past this chunk regardless of how much was read
      reader.seek(chunkEnd);
    }

    if (!heightmap) {
      throw new Error('Map file missing required HeightMapData chunk');
    }
    const waypointNodes = WaypointExtractor.extractWaypointNodes(objects, idToName);
    const waypointNodeMap = new Map<number, WaypointNode>(
      waypointNodes.map((node): [number, WaypointNode] => [node.id, node]),
    );
    const waypointLinksNormalized = WaypointExtractor.normalizeWaypointLinks(
      waypointLinks,
      waypointNodeMap,
    );

    return {
      heightmap,
      objects,
      triggers,
      waypoints: {
        nodes: waypointNodes,
        links: waypointLinksNormalized,
      },
      blendTileCount,
      textureClasses,
      textureClassDefs,
      tileIndices,
      cliffStateData,
      cliffStateStride,
      sidesList,
    };
  }

  /**
   * Parse child Object chunks within an ObjectsList container chunk.
   */
  private static parseObjectsList(
    reader: DataChunkReader,
    parentChunk: DataChunk,
    idToName: Map<number, string>,
    objects: MapObject[],
  ): void {
    const parentEnd = parentChunk.dataOffset + parentChunk.dataSize;

    while (reader.position < parentEnd) {
      if (reader.position + CHUNK_HEADER_SIZE > parentEnd) break;

      const childChunk = reader.readChunkHeader();
      const childName = idToName.get(childChunk.id);
      const childEnd = childChunk.dataOffset + childChunk.dataSize;

      if (childName === CHUNK_OBJECT) {
        const obj = MapObjectExtractor.extract(reader, childChunk.version, idToName);
        objects.push(obj);
      }

      reader.seek(childEnd);
    }
  }
}

export type { HeightmapData, MapObject, PolygonTrigger, WaypointNode, WaypointLink, ChunkTableEntry, TextureClass };
