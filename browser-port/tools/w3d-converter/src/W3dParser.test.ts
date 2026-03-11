/**
 * Tests for the W3D parser using synthetically constructed W3D binary buffers.
 *
 * We build minimal valid W3D chunks in memory and verify that:
 *  - The chunk reader iterates and reads them correctly
 *  - The mesh parser extracts vertices, normals, UVs, and indices
 *  - The hierarchy parser builds the bone tree
 *  - The top-level parser ties everything together
 *  - The glTF builder produces a valid GLB header
 */

import { describe, it, expect } from 'vitest';
import { W3dChunkReader, CHUNK_HEADER_SIZE } from './W3dChunkReader.js';
import { W3dChunkType } from './W3dChunkTypes.js';
import { chunkTypeName } from './W3dChunkTypes.js';
import { parseMeshChunk } from './W3dMeshParser.js';
import { parseHierarchyChunk } from './W3dHierarchyParser.js';
import { W3dParser } from './W3dParser.js';
import type { W3dFile } from './W3dParser.js';
import { GltfBuilder, computeInverseBindMatrices } from './GltfBuilder.js';
import type { TextureMap } from './GltfBuilder.js';
import { encodePng } from './PngEncoder.js';
import type { W3dPivot } from './W3dHierarchyParser.js';

/* ------------------------------------------------------------------ */
/*  Binary helpers                                                     */
/* ------------------------------------------------------------------ */

/** Growable binary buffer writer (little-endian). */
class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private pos = 0;

  constructor(initialSize = 4096) {
    this.buf = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buf);
  }

  private ensure(bytes: number): void {
    while (this.pos + bytes > this.buf.byteLength) {
      const next = new ArrayBuffer(this.buf.byteLength * 2);
      new Uint8Array(next).set(new Uint8Array(this.buf));
      this.buf = next;
      this.view = new DataView(this.buf);
    }
  }

  get offset(): number {
    return this.pos;
  }

  writeUint32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  writeInt32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  writeUint16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  writeUint8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  writeFloat32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  /** Write a null-padded string. */
  writeString(s: string, len: number): void {
    this.ensure(len);
    const enc = new TextEncoder();
    const bytes = enc.encode(s);
    new Uint8Array(this.buf).set(bytes.subarray(0, len), this.pos);
    this.pos += len;
  }

  /** Write raw zeros. */
  writeZeros(n: number): void {
    this.ensure(n);
    // Buffer is already zero-filled on allocation, but we still advance pos.
    // Make sure they are actually zero (could be reused memory).
    const arr = new Uint8Array(this.buf);
    for (let i = 0; i < n; i++) arr[this.pos + i] = 0;
    this.pos += n;
  }

  /** Write an 8-byte chunk header. Returns the offset of the size field for later patching. */
  writeChunkHeader(type: number, hasSubChunks: boolean): number {
    this.writeUint32(type);
    const sizeOffset = this.pos;
    this.writeUint32(hasSubChunks ? 0x80000000 : 0); // placeholder; size to be patched
    return sizeOffset;
  }

  /** Patch the size field of a chunk header. */
  patchChunkSize(sizeOffset: number, hasSubChunks: boolean): void {
    const dataSize = this.pos - sizeOffset - 4; // bytes after the size field
    const value = hasSubChunks ? (dataSize | 0x80000000) : dataSize;
    this.view.setUint32(sizeOffset, value >>> 0, true);
  }

  toArrayBuffer(): ArrayBuffer {
    return this.buf.slice(0, this.pos);
  }
}

/* ------------------------------------------------------------------ */
/*  Build synthetic W3D data                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a minimal MESH chunk:
 *   MESH (container)
 *     MESH_HEADER3 – 1 triangle, 3 vertices
 *     VERTICES     – 3 vertices
 *     VERTEX_NORMALS – 3 normals
 *     TEXCOORDS    – 3 UVs
 *     TRIANGLES    – 1 triangle
 */
function buildMeshBuffer(opts?: {
  headerNumTris?: number;
  headerNumVertices?: number;
}): ArrayBuffer {
  const w = new BinaryWriter();

  // ---- MESH (container) ----
  const meshSizeOff = w.writeChunkHeader(W3dChunkType.MESH, true);

  // ---- MESH_HEADER3 ----
  const hdrSizeOff = w.writeChunkHeader(W3dChunkType.MESH_HEADER3, false);
  w.writeUint32(0x00040002); // Version
  w.writeUint32(0);          // Attributes
  w.writeString('TestMesh', 32);
  w.writeString('TestContainer', 32);
  w.writeUint32(opts?.headerNumTris ?? 1); // NumTris
  w.writeUint32(opts?.headerNumVertices ?? 3); // NumVertices
  w.writeUint32(1);          // NumMaterials
  w.writeUint32(0);          // NumDamageStages
  w.writeInt32(0);           // SortLevel
  w.writeUint32(0);          // PrelitVersion
  w.writeUint32(0);          // FutureCounts[1]
  w.writeUint32(0);          // VertexChannels
  w.writeUint32(0);          // FaceChannels
  // MinCorner
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  // MaxCorner
  w.writeFloat32(1); w.writeFloat32(1); w.writeFloat32(0);
  // SphCenter
  w.writeFloat32(0.5); w.writeFloat32(0.5); w.writeFloat32(0);
  // SphRadius
  w.writeFloat32(0.707);
  w.patchChunkSize(hdrSizeOff, false);

  // ---- VERTICES ----
  const vertSizeOff = w.writeChunkHeader(W3dChunkType.VERTICES, false);
  // Triangle: (0,0,0) (1,0,0) (0,1,0)
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0);
  w.patchChunkSize(vertSizeOff, false);

  // ---- VERTEX_NORMALS ----
  const normSizeOff = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.patchChunkSize(normSizeOff, false);

  // ---- TEXCOORDS ----
  const uvSizeOff = w.writeChunkHeader(W3dChunkType.TEXCOORDS, false);
  w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(0);
  w.writeFloat32(0); w.writeFloat32(1);
  w.patchChunkSize(uvSizeOff, false);

  // ---- TRIANGLES ----
  const triSizeOff = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
  // vindex[3]
  w.writeUint32(0); w.writeUint32(1); w.writeUint32(2);
  // attributes
  w.writeUint32(0);
  // normal
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  // dist
  w.writeFloat32(0);
  w.patchChunkSize(triSizeOff, false);

  w.patchChunkSize(meshSizeOff, true);
  return w.toArrayBuffer();
}

/**
 * Build a mesh with a texture name reference (for testing texture embedding).
 */
function buildMeshWithTexture(): ArrayBuffer {
  const w = new BinaryWriter();

  const meshSizeOff = w.writeChunkHeader(W3dChunkType.MESH, true);

  // MESH_HEADER3
  const hdrSizeOff = w.writeChunkHeader(W3dChunkType.MESH_HEADER3, false);
  w.writeUint32(0x00040002);
  w.writeUint32(0);
  w.writeString('TexturedMesh', 32);
  w.writeString('Container', 32);
  w.writeUint32(1); // NumTris
  w.writeUint32(3); // NumVertices
  w.writeUint32(1);
  w.writeUint32(0);
  w.writeInt32(0);
  w.writeUint32(0);
  w.writeUint32(0);
  w.writeUint32(0);
  w.writeUint32(0);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(1); w.writeFloat32(0);
  w.writeFloat32(0.5); w.writeFloat32(0.5); w.writeFloat32(0);
  w.writeFloat32(0.707);
  w.patchChunkSize(hdrSizeOff, false);

  // VERTICES
  const vertSizeOff = w.writeChunkHeader(W3dChunkType.VERTICES, false);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0);
  w.patchChunkSize(vertSizeOff, false);

  // VERTEX_NORMALS
  const normSizeOff = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.patchChunkSize(normSizeOff, false);

  // TEXCOORDS
  const uvSizeOff = w.writeChunkHeader(W3dChunkType.TEXCOORDS, false);
  w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(0);
  w.writeFloat32(0); w.writeFloat32(1);
  w.patchChunkSize(uvSizeOff, false);

  // TRIANGLES
  const triSizeOff = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
  w.writeUint32(0); w.writeUint32(1); w.writeUint32(2);
  w.writeUint32(0);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
  w.writeFloat32(0);
  w.patchChunkSize(triSizeOff, false);

  // TEXTURES container with one texture name
  const texsSizeOff = w.writeChunkHeader(W3dChunkType.TEXTURES, true);
  const texSizeOff = w.writeChunkHeader(W3dChunkType.TEXTURE, true);
  const nameSizeOff = w.writeChunkHeader(W3dChunkType.TEXTURE_NAME, false);
  w.writeString('TestTexture.tga', 16);
  w.patchChunkSize(nameSizeOff, false);
  w.patchChunkSize(texSizeOff, true);
  w.patchChunkSize(texsSizeOff, true);

  w.patchChunkSize(meshSizeOff, true);
  return w.toArrayBuffer();
}

/** Parse the JSON chunk from a GLB file. */
function parseGlbJson(glb: ArrayBuffer): Record<string, unknown> {
  const view = new DataView(glb);
  const jsonChunkLength = view.getUint32(12, true);
  const jsonBytes = new Uint8Array(glb, 20, jsonChunkLength);
  return JSON.parse(new TextDecoder().decode(jsonBytes).trim()) as Record<string, unknown>;
}

/**
 * Build a minimal HIERARCHY chunk with 3 pivots:
 *   RootBone (no parent)
 *     ChildBone1
 *     ChildBone2
 */
function buildHierarchyBuffer(): ArrayBuffer {
  const w = new BinaryWriter();

  const hierSizeOff = w.writeChunkHeader(W3dChunkType.HIERARCHY, true);

  // HIERARCHY_HEADER
  const hdrSizeOff = w.writeChunkHeader(W3dChunkType.HIERARCHY_HEADER, false);
  w.writeUint32(0x00040001); // Version
  w.writeString('TestHierarchy', 32);
  w.writeUint32(3);          // NumPivots
  // Center
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.patchChunkSize(hdrSizeOff, false);

  // PIVOTS
  const pivSizeOff = w.writeChunkHeader(W3dChunkType.PIVOTS, false);

  // Pivot 0: RootBone (parent = 0xFFFFFFFF)
  writePivot(w, 'RootBone', 0xffffffff, [0, 0, 0], [0, 0, 0, 1]);
  // Pivot 1: ChildBone1 (parent = 0)
  writePivot(w, 'ChildBone1', 0, [1, 0, 0], [0, 0, 0, 1]);
  // Pivot 2: ChildBone2 (parent = 0)
  writePivot(w, 'ChildBone2', 0, [0, 1, 0], [0, 0, 0, 1]);

  w.patchChunkSize(pivSizeOff, false);
  w.patchChunkSize(hierSizeOff, true);

  return w.toArrayBuffer();
}

function writePivot(
  w: BinaryWriter,
  name: string,
  parent: number,
  translation: [number, number, number],
  rotation: [number, number, number, number],
): void {
  w.writeString(name, 32);
  w.writeUint32(parent);
  w.writeFloat32(translation[0]);
  w.writeFloat32(translation[1]);
  w.writeFloat32(translation[2]);
  // Euler angles (unused, write zeros).
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  // Quaternion XYZW.
  w.writeFloat32(rotation[0]);
  w.writeFloat32(rotation[1]);
  w.writeFloat32(rotation[2]);
  w.writeFloat32(rotation[3]);
}

/** Concatenate two ArrayBuffers. */
function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
  const result = new ArrayBuffer(a.byteLength + b.byteLength);
  const bytes = new Uint8Array(result);
  bytes.set(new Uint8Array(a), 0);
  bytes.set(new Uint8Array(b), a.byteLength);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('W3dChunkReader', () => {
  it('reads a chunk header correctly', () => {
    const buf = buildMeshBuffer();
    const reader = new W3dChunkReader(buf);
    const chunk = reader.readChunkAt(0);

    expect(chunk.type).toBe(W3dChunkType.MESH);
    expect(chunk.hasSubChunks).toBe(true);
    expect(chunk.dataOffset).toBe(CHUNK_HEADER_SIZE);
    expect(chunk.size).toBeGreaterThan(0);
  });

  it('iterates top-level chunks', () => {
    const meshBuf = buildMeshBuffer();
    const hierBuf = buildHierarchyBuffer();
    const combined = concatBuffers(meshBuf, hierBuf);

    const reader = new W3dChunkReader(combined);
    const chunks = [...reader.iterateChunks(0, combined.byteLength)];

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.type).toBe(W3dChunkType.MESH);
    expect(chunks[1]!.type).toBe(W3dChunkType.HIERARCHY);
  });

  it('iterates sub-chunks inside a MESH', () => {
    const buf = buildMeshBuffer();
    const reader = new W3dChunkReader(buf);
    const meshChunk = reader.readChunkAt(0);
    const subChunks = [...reader.iterateChunks(meshChunk.dataOffset, meshChunk.dataOffset + meshChunk.size)];

    // We wrote: MESH_HEADER3, VERTICES, VERTEX_NORMALS, TEXCOORDS, TRIANGLES
    const types = subChunks.map((c) => c.type);
    expect(types).toContain(W3dChunkType.MESH_HEADER3);
    expect(types).toContain(W3dChunkType.VERTICES);
    expect(types).toContain(W3dChunkType.VERTEX_NORMALS);
    expect(types).toContain(W3dChunkType.TEXCOORDS);
    expect(types).toContain(W3dChunkType.TRIANGLES);
    expect(subChunks.length).toBe(5);
  });

  it('reads strings correctly', () => {
    const buf = buildMeshBuffer();
    const reader = new W3dChunkReader(buf);
    const meshChunk = reader.readChunkAt(0);
    const subChunks = [...reader.iterateChunks(meshChunk.dataOffset, meshChunk.dataOffset + meshChunk.size)];
    const headerChunk = subChunks.find((c) => c.type === W3dChunkType.MESH_HEADER3)!;

    // Mesh name is at offset +8 within the header chunk data.
    const meshName = reader.readString(headerChunk.dataOffset + 8, 32);
    expect(meshName).toBe('TestMesh');
  });
});

describe('chunkTypeName', () => {
  it('returns known chunk names', () => {
    expect(chunkTypeName(W3dChunkType.MESH)).toBe('MESH');
    expect(chunkTypeName(W3dChunkType.HIERARCHY)).toBe('HIERARCHY');
  });

  it('returns hex string for unknown chunks', () => {
    expect(chunkTypeName(0xdeadbeef)).toBe('UNKNOWN_0xdeadbeef');
  });
});

describe('W3dMeshParser', () => {
  it('parses vertices, normals, UVs, and indices', () => {
    const buf = buildMeshBuffer();
    const reader = new W3dChunkReader(buf);
    const meshChunk = reader.readChunkAt(0);
    const mesh = parseMeshChunk(reader, meshChunk.dataOffset, meshChunk.size);

    expect(mesh.name).toBe('TestMesh');
    expect(mesh.containerName).toBe('TestContainer');

    // 3 vertices × 3 components = 9 floats
    expect(mesh.vertices.length).toBe(9);
    expect(mesh.vertices[0]).toBeCloseTo(0);
    expect(mesh.vertices[3]).toBeCloseTo(1);
    expect(mesh.vertices[7]).toBeCloseTo(1);

    // 3 normals, all pointing +Z
    expect(mesh.normals.length).toBe(9);
    expect(mesh.normals[2]).toBeCloseTo(1);

    // 3 UVs × 2 components = 6
    expect(mesh.uvs.length).toBe(6);

    // 1 triangle × 3 = 3 indices
    expect(mesh.indices.length).toBe(3);
    expect(mesh.indices[0]).toBe(0);
    expect(mesh.indices[1]).toBe(1);
    expect(mesh.indices[2]).toBe(2);
  });

  it('clamps oversized mesh header counts to available payload data', () => {
    const buf = buildMeshBuffer({ headerNumTris: 999, headerNumVertices: 999 });
    const reader = new W3dChunkReader(buf);
    const meshChunk = reader.readChunkAt(0);
    const mesh = parseMeshChunk(reader, meshChunk.dataOffset, meshChunk.size);

    expect(mesh.vertices.length).toBe(9);
    expect(mesh.normals.length).toBe(9);
    expect(mesh.uvs.length).toBe(6);
    expect(mesh.indices.length).toBe(3);
  });
});

describe('W3dHierarchyParser', () => {
  it('parses pivots with parent relationships', () => {
    const buf = buildHierarchyBuffer();
    const reader = new W3dChunkReader(buf);
    const hierChunk = reader.readChunkAt(0);
    const hierarchy = parseHierarchyChunk(reader, hierChunk.dataOffset, hierChunk.size);

    expect(hierarchy.name).toBe('TestHierarchy');
    expect(hierarchy.pivots.length).toBe(3);

    const root = hierarchy.pivots[0]!;
    expect(root.name).toBe('RootBone');
    expect(root.parentIndex).toBe(-1);
    expect(root.translation).toEqual([0, 0, 0]);
    expect(root.rotation).toEqual([0, 0, 0, 1]);

    const child1 = hierarchy.pivots[1]!;
    expect(child1.name).toBe('ChildBone1');
    expect(child1.parentIndex).toBe(0);
    expect(child1.translation).toEqual([1, 0, 0]);

    const child2 = hierarchy.pivots[2]!;
    expect(child2.name).toBe('ChildBone2');
    expect(child2.parentIndex).toBe(0);
    expect(child2.translation).toEqual([0, 1, 0]);
  });

  it('clamps oversized pivot counts to available pivot records', () => {
    const buf = buildHierarchyBuffer();
    const mutated = buf.slice(0);
    const view = new DataView(mutated);
    const numPivotsOffset = 8 + 8 + 4 + 32;
    view.setUint32(numPivotsOffset, 999, true);

    const reader = new W3dChunkReader(mutated);
    const hierChunk = reader.readChunkAt(0);
    const hierarchy = parseHierarchyChunk(reader, hierChunk.dataOffset, hierChunk.size);

    expect(hierarchy.pivots).toHaveLength(3);
  });
});

describe('W3dParser (top-level)', () => {
  it('parses a combined mesh + hierarchy buffer', () => {
    const combined = concatBuffers(buildMeshBuffer(), buildHierarchyBuffer());
    const result = W3dParser.parse(combined);

    expect(result.meshes.length).toBe(1);
    expect(result.hierarchies.length).toBe(1);
    expect(result.animations.length).toBe(0);
    expect(result.hlods.length).toBe(0);

    expect(result.meshes[0]!.name).toBe('TestMesh');
    expect(result.hierarchies[0]!.name).toBe('TestHierarchy');
  });
});

describe('GltfBuilder', () => {
  it('produces a valid GLB header', () => {
    const combined = concatBuffers(buildMeshBuffer(), buildHierarchyBuffer());
    const w3d = W3dParser.parse(combined);
    const glb = GltfBuilder.buildGlb(w3d);

    expect(glb.byteLength).toBeGreaterThan(12);

    const view = new DataView(glb);
    // GLB magic: "glTF" = 0x46546C67
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    // Version 2
    expect(view.getUint32(4, true)).toBe(2);
    // Total length matches buffer
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
  });

  it('contains a JSON chunk followed by a BIN chunk', () => {
    const w3d = W3dParser.parse(buildMeshBuffer());
    const glb = GltfBuilder.buildGlb(w3d);
    const view = new DataView(glb);

    // First chunk at offset 12.
    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    expect(jsonChunkType).toBe(0x4e4f534a); // "JSON"

    // BIN chunk follows.
    const binChunkOffset = 20 + jsonChunkLength;
    const binChunkType = view.getUint32(binChunkOffset + 4, true);
    expect(binChunkType).toBe(0x004e4942); // "BIN\0"
  });

  it('embeds valid JSON with mesh data', () => {
    const w3d = W3dParser.parse(buildMeshBuffer());
    const glb = GltfBuilder.buildGlb(w3d);
    const view = new DataView(glb);

    const jsonChunkLength = view.getUint32(12, true);
    const jsonBytes = new Uint8Array(glb, 20, jsonChunkLength);
    const jsonStr = new TextDecoder().decode(jsonBytes).trim();
    const gltf = JSON.parse(jsonStr) as Record<string, unknown>;

    expect(gltf['asset']).toBeDefined();
    expect((gltf['asset'] as Record<string, string>)['version']).toBe('2.0');
    expect((gltf['meshes'] as unknown[]).length).toBe(1);
    expect((gltf['accessors'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('produces a GLB from a mesh-only W3D (no hierarchy)', () => {
    const w3d = W3dParser.parse(buildMeshBuffer());
    const glb = GltfBuilder.buildGlb(w3d);
    expect(glb.byteLength).toBeGreaterThan(0);
  });

  it('bounds animation sampling when animation header frame counts are invalid', () => {
    const channelData = new Float32Array(281);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = i;
    }

    const w3d: W3dFile = {
      meshes: [],
      hierarchies: [],
      hlods: [],
      boxes: [],
      animations: [{
        name: 'BadHeaderAnim',
        hierarchyName: '',
        numFrames: 1_055_483_809,
        frameRate: 1_055_566_543,
        channels: [
          { pivot: 0, type: 'x', firstFrame: 0, lastFrame: 280, data: channelData },
          { pivot: 0, type: 'y', firstFrame: 0, lastFrame: 280, data: channelData },
          { pivot: 0, type: 'z', firstFrame: 0, lastFrame: 280, data: channelData },
        ],
      }],
    };

    const glb = GltfBuilder.buildGlb(w3d);
    expect(glb.byteLength).toBeGreaterThan(0);

    const view = new DataView(glb);
    const jsonChunkLength = view.getUint32(12, true);
    const jsonBytes = new Uint8Array(glb, 20, jsonChunkLength);
    const json = JSON.parse(new TextDecoder().decode(jsonBytes).trim()) as Record<string, unknown>;
    const animations = json['animations'] as Array<Record<string, unknown>>;
    expect(animations).toHaveLength(1);
    expect((animations[0]?.samplers as unknown[]).length).toBe(1);
  });

  it('embeds textures when textureMap is provided', () => {
    const w3d = W3dParser.parse(buildMeshWithTexture());
    const texMap: TextureMap = new Map();
    texMap.set('testtexture', {
      width: 2,
      height: 2,
      data: new Uint8Array(2 * 2 * 4).fill(255), // 2x2 white RGBA
    });

    const glb = GltfBuilder.buildGlb(w3d, { textures: texMap });
    const gltf = parseGlbJson(glb);

    expect(gltf['images']).toBeDefined();
    expect((gltf['images'] as unknown[]).length).toBe(1);
    expect(gltf['textures']).toBeDefined();
    expect((gltf['textures'] as unknown[]).length).toBe(1);
    expect(gltf['materials']).toBeDefined();
    expect((gltf['materials'] as unknown[]).length).toBe(1);
    expect(gltf['samplers']).toBeDefined();

    const mat = (gltf['materials'] as Record<string, unknown>[])[0]!;
    const pbr = mat['pbrMetallicRoughness'] as Record<string, unknown>;
    expect(pbr['metallicFactor']).toBe(0);
    expect(pbr['baseColorTexture']).toBeDefined();
  });

  it('creates material from W3D material data without textures', () => {
    const w3d = W3dParser.parse(buildMeshBuffer());
    // Manually add material data
    w3d.meshes[0]!.materials = [{
      diffuse: [0.8, 0.2, 0.1, 1],
      specular: [1, 1, 1, 1],
      emissive: [0.5, 0, 0, 1],
      ambient: [0.2, 0.2, 0.2, 1],
      shininess: 64,
      opacity: 0.8,
      translucency: 0,
    }];
    w3d.meshes[0]!.shaders = [];

    const glb = GltfBuilder.buildGlb(w3d);
    const gltf = parseGlbJson(glb);

    expect(gltf['materials']).toBeDefined();
    const mat = (gltf['materials'] as Record<string, unknown>[])[0]!;
    const pbr = mat['pbrMetallicRoughness'] as Record<string, unknown>;
    expect(pbr['metallicFactor']).toBe(0);
    expect(pbr['baseColorFactor']).toEqual([0.8, 0.2, 0.1, 0.8]);
    // shininess 64 → roughness = 1 - 64/128 = 0.5
    expect(pbr['roughnessFactor']).toBe(0.5);
    // Emissive should be set
    expect(mat['emissiveFactor']).toEqual([0.5, 0, 0]);
    // Opacity < 1 → BLEND
    expect(mat['alphaMode']).toBe('BLEND');
  });

  it('sets alphaMode to MASK when shader has alphaTest', () => {
    const w3d = W3dParser.parse(buildMeshBuffer());
    w3d.meshes[0]!.materials = [{
      diffuse: [1, 1, 1, 1],
      specular: [0, 0, 0, 1],
      emissive: [0, 0, 0, 1],
      ambient: [0, 0, 0, 1],
      shininess: 0,
      opacity: 1,
      translucency: 0,
    }];
    w3d.meshes[0]!.shaders = [{
      depthCompare: 0, depthMask: 0, colorMask: 0,
      destBlend: 0, fogFunc: 0, priGradient: 0, secGradient: 0,
      srcBlend: 0, texturing: 0, detailColorFunc: 0, detailAlphaFunc: 0,
      shaderPreset: 0, alphaTest: 1, postDetailColorFunc: 0, postDetailAlphaFunc: 0,
    }];

    const glb = GltfBuilder.buildGlb(w3d);
    const gltf = parseGlbJson(glb);
    const mat = (gltf['materials'] as Record<string, unknown>[])[0]!;
    expect(mat['alphaMode']).toBe('MASK');
    expect(mat['alphaCutoff']).toBe(0.5);
  });
});

describe('PngEncoder', () => {
  it('produces valid PNG with correct signature', () => {
    const rgba = new Uint8Array(4 * 4 * 4); // 4x4 RGBA
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 255; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255;
    }
    const png = encodePng(4, 4, rgba);

    // PNG signature
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80); // 'P'
    expect(png[2]).toBe(78); // 'N'
    expect(png[3]).toBe(71); // 'G'
    expect(png[4]).toBe(13);
    expect(png[5]).toBe(10);
    expect(png[6]).toBe(26);
    expect(png[7]).toBe(10);

    // IHDR chunk type at offset 12
    expect(String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!)).toBe('IHDR');
    expect(png.byteLength).toBeGreaterThan(50);
  });

  it('throws for mismatched data length', () => {
    expect(() => encodePng(2, 2, new Uint8Array(10))).toThrow();
  });

  it('produces a 1x1 PNG', () => {
    const rgba = new Uint8Array([0, 255, 0, 255]);
    const png = encodePng(1, 1, rgba);
    expect(png.byteLength).toBeGreaterThan(20);
  });
});

describe('computeInverseBindMatrices', () => {
  it('returns identity for a single root pivot at origin', () => {
    const pivots: W3dPivot[] = [{
      name: 'Root',
      parentIndex: -1,
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    }];
    const ibm = computeInverseBindMatrices(pivots);
    expect(ibm.length).toBe(16);
    // Should be identity
    expect(ibm[0]).toBeCloseTo(1);
    expect(ibm[5]).toBeCloseTo(1);
    expect(ibm[10]).toBeCloseTo(1);
    expect(ibm[15]).toBeCloseTo(1);
    // Off-diagonal should be 0
    expect(ibm[1]).toBeCloseTo(0);
    expect(ibm[4]).toBeCloseTo(0);
  });

  it('computes correct inverse for a translated child pivot', () => {
    const pivots: W3dPivot[] = [
      { name: 'Root', parentIndex: -1, translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { name: 'Child', parentIndex: 0, translation: [5, 0, 0], rotation: [0, 0, 0, 1] },
    ];
    const ibm = computeInverseBindMatrices(pivots);
    expect(ibm.length).toBe(32);

    // Root IBM should be identity
    expect(ibm[0]).toBeCloseTo(1);
    expect(ibm[12]).toBeCloseTo(0); // tx = 0

    // Child world transform: translate (5,0,0)
    // Inverse should have tx = -5
    expect(ibm[16 + 0]).toBeCloseTo(1);
    expect(ibm[16 + 12]).toBeCloseTo(-5);
  });

  it('chains translations through parent hierarchy', () => {
    const pivots: W3dPivot[] = [
      { name: 'Root', parentIndex: -1, translation: [10, 0, 0], rotation: [0, 0, 0, 1] },
      { name: 'Child', parentIndex: 0, translation: [0, 5, 0], rotation: [0, 0, 0, 1] },
    ];
    const ibm = computeInverseBindMatrices(pivots);

    // Root IBM: inverse of translate(10,0,0) → translate(-10,0,0)
    expect(ibm[12]).toBeCloseTo(-10);

    // Child world: translate(10,0,0) * translate(0,5,0) = translate(10,5,0)
    // Child IBM: inverse = translate(-10,-5,0)
    expect(ibm[16 + 12]).toBeCloseTo(-10);
    expect(ibm[16 + 13]).toBeCloseTo(-5);
  });
});
