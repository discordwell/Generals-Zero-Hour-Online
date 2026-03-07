/**
 * Golden fixture tests for the W3D → glTF conversion pipeline.
 *
 * Builds comprehensive synthetic W3D files with:
 *  - Multiple meshes with bone influences
 *  - Hierarchy with multi-level bone tree
 *  - Animation channels (translation + rotation)
 *  - HLOD with LOD levels
 *  - BOX and NULL_OBJECT chunks
 * Then verifies the full pipeline: parse → build GLB → verify structure.
 */

import { describe, it, expect } from 'vitest';
import { W3dParser } from './W3dParser.js';
import { W3dChunkType } from './W3dChunkTypes.js';
import { GltfBuilder } from './GltfBuilder.js';

// ---------------------------------------------------------------------------
// Binary writer (same as unit tests)
// ---------------------------------------------------------------------------

class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private pos = 0;

  constructor(initialSize = 16384) {
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

  get offset(): number { return this.pos; }

  writeUint32(v: number): void { this.ensure(4); this.view.setUint32(this.pos, v, true); this.pos += 4; }
  writeUint16(v: number): void { this.ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
  writeUint8(v: number): void { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  writeFloat32(v: number): void { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }

  writeString(s: string, len: number): void {
    this.ensure(len);
    const bytes = new TextEncoder().encode(s);
    new Uint8Array(this.buf).set(bytes.subarray(0, len), this.pos);
    this.pos += len;
  }

  writeZeros(n: number): void {
    this.ensure(n);
    const arr = new Uint8Array(this.buf);
    for (let i = 0; i < n; i++) arr[this.pos + i] = 0;
    this.pos += n;
  }

  writeChunkHeader(type: number, hasSubChunks: boolean): number {
    this.writeUint32(type);
    const sizeOffset = this.pos;
    this.writeUint32(hasSubChunks ? 0x80000000 : 0);
    return sizeOffset;
  }

  patchChunkSize(sizeOffset: number, hasSubChunks: boolean): void {
    const dataSize = this.pos - sizeOffset - 4;
    const value = hasSubChunks ? (dataSize | 0x80000000) : dataSize;
    this.view.setUint32(sizeOffset, value >>> 0, true);
  }

  toArrayBuffer(): ArrayBuffer { return this.buf.slice(0, this.pos); }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function writePivot(
  w: BinaryWriter, name: string, parent: number,
  trans: [number, number, number], rot: [number, number, number, number],
): void {
  w.writeString(name, 32);
  w.writeUint32(parent);
  w.writeFloat32(trans[0]); w.writeFloat32(trans[1]); w.writeFloat32(trans[2]);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0); // euler
  w.writeFloat32(rot[0]); w.writeFloat32(rot[1]); w.writeFloat32(rot[2]); w.writeFloat32(rot[3]);
}

function writeMeshHeader(
  w: BinaryWriter, name: string, container: string, numTris: number, numVerts: number,
): number {
  const sizeOff = w.writeChunkHeader(W3dChunkType.MESH_HEADER3, false);
  w.writeUint32(0x00040002); // Version
  w.writeUint32(0);          // Attributes
  w.writeString(name, 32);
  w.writeString(container, 32);
  w.writeUint32(numTris);
  w.writeUint32(numVerts);
  w.writeUint32(1); w.writeUint32(0); w.writeUint32(0); w.writeUint32(0); w.writeUint32(0);
  w.writeUint32(0); w.writeUint32(0);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(1); w.writeFloat32(1);
  w.writeFloat32(0.5); w.writeFloat32(0.5); w.writeFloat32(0.5);
  w.writeFloat32(1);
  w.patchChunkSize(sizeOff, false);
  return sizeOff;
}

/** Build a complete W3D file with mesh, hierarchy, animation, HLOD, BOX, and NULL_OBJECT. */
function buildCompleteW3d(): ArrayBuffer {
  const w = new BinaryWriter();

  // ---- Hierarchy: RootBone → Turret → Barrel ----
  const hierOuter = w.writeChunkHeader(W3dChunkType.HIERARCHY, true);

  const hierHdr = w.writeChunkHeader(W3dChunkType.HIERARCHY_HEADER, false);
  w.writeUint32(0x00040001);
  w.writeString('BCTANK', 32);
  w.writeUint32(3);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.patchChunkSize(hierHdr, false);

  const pivots = w.writeChunkHeader(W3dChunkType.PIVOTS, false);
  writePivot(w, 'RootTransform', 0xffffffff, [0, 0, 0], [0, 0, 0, 1]);
  writePivot(w, 'Turret', 0, [0, 1.5, 0], [0, 0, 0, 1]);
  writePivot(w, 'Barrel', 1, [0, 0, 2], [0, 0, 0, 1]);
  w.patchChunkSize(pivots, false);
  w.patchChunkSize(hierOuter, true);

  // ---- Mesh 1: Hull (4 vertices, 2 triangles) ----
  const mesh1Outer = w.writeChunkHeader(W3dChunkType.MESH, true);
  writeMeshHeader(w, 'BCTANK_HULL', 'BCTANK', 2, 4);

  const verts1 = w.writeChunkHeader(W3dChunkType.VERTICES, false);
  w.writeFloat32(-1); w.writeFloat32(0); w.writeFloat32(-1);
  w.writeFloat32(1);  w.writeFloat32(0); w.writeFloat32(-1);
  w.writeFloat32(1);  w.writeFloat32(0); w.writeFloat32(1);
  w.writeFloat32(-1); w.writeFloat32(0); w.writeFloat32(1);
  w.patchChunkSize(verts1, false);

  const norms1 = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
  for (let i = 0; i < 4; i++) { w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); }
  w.patchChunkSize(norms1, false);

  const uvs1 = w.writeChunkHeader(W3dChunkType.TEXCOORDS, false);
  w.writeFloat32(0); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(0);
  w.writeFloat32(1); w.writeFloat32(1);
  w.writeFloat32(0); w.writeFloat32(1);
  w.patchChunkSize(uvs1, false);

  const tris1 = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
  // Triangle 0
  w.writeUint32(0); w.writeUint32(1); w.writeUint32(2);
  w.writeUint32(0);
  w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
  // Triangle 1
  w.writeUint32(0); w.writeUint32(2); w.writeUint32(3);
  w.writeUint32(0);
  w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
  w.patchChunkSize(tris1, false);

  // Bone influences: all vertices → bone 0 (RootTransform)
  const bones1 = w.writeChunkHeader(W3dChunkType.VERTEX_INFLUENCES, false);
  for (let i = 0; i < 4; i++) {
    w.writeUint16(0); // bone index
    w.writeUint16(0); w.writeUint16(0); w.writeUint16(0); // padding
  }
  w.patchChunkSize(bones1, false);

  w.patchChunkSize(mesh1Outer, true);

  // ---- Mesh 2: Turret (3 vertices, 1 triangle) ----
  const mesh2Outer = w.writeChunkHeader(W3dChunkType.MESH, true);
  writeMeshHeader(w, 'BCTANK_TURRET', 'BCTANK', 1, 3);

  const verts2 = w.writeChunkHeader(W3dChunkType.VERTICES, false);
  w.writeFloat32(0);  w.writeFloat32(2); w.writeFloat32(-0.5);
  w.writeFloat32(0.5); w.writeFloat32(2); w.writeFloat32(0.5);
  w.writeFloat32(-0.5); w.writeFloat32(2); w.writeFloat32(0.5);
  w.patchChunkSize(verts2, false);

  const norms2 = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
  for (let i = 0; i < 3; i++) { w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); }
  w.patchChunkSize(norms2, false);

  const uvs2 = w.writeChunkHeader(W3dChunkType.TEXCOORDS, false);
  w.writeFloat32(0.5); w.writeFloat32(0);
  w.writeFloat32(1);   w.writeFloat32(1);
  w.writeFloat32(0);   w.writeFloat32(1);
  w.patchChunkSize(uvs2, false);

  const tris2 = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
  w.writeUint32(0); w.writeUint32(1); w.writeUint32(2);
  w.writeUint32(0);
  w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
  w.patchChunkSize(tris2, false);

  // Bone influences: all → bone 1 (Turret)
  const bones2 = w.writeChunkHeader(W3dChunkType.VERTEX_INFLUENCES, false);
  for (let i = 0; i < 3; i++) {
    w.writeUint16(1);
    w.writeUint16(0); w.writeUint16(0); w.writeUint16(0);
  }
  w.patchChunkSize(bones2, false);

  w.patchChunkSize(mesh2Outer, true);

  // ---- Animation: turret rotation ----
  const animOuter = w.writeChunkHeader(W3dChunkType.ANIMATION, true);

  const animHdr = w.writeChunkHeader(W3dChunkType.ANIMATION_HEADER, false);
  w.writeUint32(0x00040001); // Version
  w.writeString('BCTANK.BCTANK', 32);
  w.writeString('BCTANK', 32);
  w.writeUint32(10); // NumFrames
  w.writeUint32(30); // FrameRate
  w.patchChunkSize(animHdr, false);

  // Y-rotation channel for Turret (pivot 1)
  const ch1 = w.writeChunkHeader(W3dChunkType.ANIMATION_CHANNEL, false);
  w.writeUint16(0);  // FirstFrame
  w.writeUint16(9);  // LastFrame
  w.writeUint16(4);  // VectorLen (quaternion)
  w.writeUint16(6);  // Flags = quaternion
  w.writeUint16(1);  // Pivot = Turret
  w.writeUint16(0);  // pad
  // 10 frames × 4 components
  for (let f = 0; f < 10; f++) {
    const angle = (f / 9) * Math.PI * 0.5; // 0 to 90 degrees
    w.writeFloat32(0);
    w.writeFloat32(Math.sin(angle / 2));
    w.writeFloat32(0);
    w.writeFloat32(Math.cos(angle / 2));
  }
  w.patchChunkSize(ch1, false);

  w.patchChunkSize(animOuter, true);

  // ---- HLOD ----
  const hlodOuter = w.writeChunkHeader(W3dChunkType.HLOD, true);

  const hlodHdr = w.writeChunkHeader(W3dChunkType.HLOD_HEADER, false);
  w.writeUint32(0x00040001);
  w.writeUint32(1); // LodCount
  w.writeString('BCTANK', 32);
  w.writeString('BCTANK', 32);
  w.patchChunkSize(hlodHdr, false);

  const lodArray = w.writeChunkHeader(W3dChunkType.HLOD_LOD_ARRAY, true);
  const lodHdr = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT_ARRAY_HEADER, false);
  w.writeUint32(2); // ModelCount
  w.writeFloat32(0); // MaxScreenSize
  w.patchChunkSize(lodHdr, false);
  // Sub-object 1
  const sub1 = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT, false);
  w.writeUint32(0); // BoneIndex
  w.writeString('BCTANK.BCTANK_HULL', 32);
  w.patchChunkSize(sub1, false);
  // Sub-object 2
  const sub2 = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT, false);
  w.writeUint32(1); // BoneIndex
  w.writeString('BCTANK.BCTANK_TURRET', 32);
  w.patchChunkSize(sub2, false);
  w.patchChunkSize(lodArray, true);

  w.patchChunkSize(hlodOuter, true);

  // ---- BOX ----
  const boxOuter = w.writeChunkHeader(W3dChunkType.BOX, false);
  w.writeUint32(0);       // Version
  w.writeUint32(0);       // Attributes
  w.writeString('BCTANK_BOX', 32);
  w.writeUint32(0x0000ffff); // Color
  // Center
  w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0);
  // Extent
  w.writeFloat32(2); w.writeFloat32(1.5); w.writeFloat32(3);
  w.patchChunkSize(boxOuter, false);

  return w.toArrayBuffer();
}

/** Extract glTF JSON from a GLB buffer. */
function extractGltfJson(glb: ArrayBuffer): Record<string, unknown> {
  const view = new DataView(glb);
  const jsonLen = view.getUint32(12, true);
  const jsonBytes = new Uint8Array(glb, 20, jsonLen);
  return JSON.parse(new TextDecoder().decode(jsonBytes).trim());
}

// ---------------------------------------------------------------------------
// Golden tests
// ---------------------------------------------------------------------------

describe('W3D golden fixtures', () => {
  it('parses a complete W3D file with all chunk types', () => {
    const buffer = buildCompleteW3d();
    const result = W3dParser.parse(buffer);

    expect(result.meshes).toHaveLength(2);
    expect(result.hierarchies).toHaveLength(1);
    expect(result.animations).toHaveLength(1);
    expect(result.hlods).toHaveLength(1);
    expect(result.boxes).toHaveLength(1);

    // BOX details
    const box = result.boxes[0]!;
    expect(box.name).toBe('BCTANK_BOX');
    expect(box.center[0]).toBeCloseTo(0);
    expect(box.center[1]).toBeCloseTo(1);
    expect(box.center[2]).toBeCloseTo(0);
    expect(box.extent[0]).toBeCloseTo(2);
    expect(box.extent[1]).toBeCloseTo(1.5);
    expect(box.extent[2]).toBeCloseTo(3);

    // Mesh details
    expect(result.meshes[0]!.name).toBe('BCTANK_HULL');
    expect(result.meshes[0]!.vertices.length).toBe(12); // 4 verts × 3
    expect(result.meshes[0]!.indices.length).toBe(6);   // 2 tris × 3
    expect(result.meshes[0]!.boneIndices).toBeDefined();

    expect(result.meshes[1]!.name).toBe('BCTANK_TURRET');
    expect(result.meshes[1]!.vertices.length).toBe(9);  // 3 verts × 3
    expect(result.meshes[1]!.boneIndices![0]).toBe(1);   // Turret bone

    // Hierarchy details
    const hier = result.hierarchies[0]!;
    expect(hier.name).toBe('BCTANK');
    expect(hier.pivots).toHaveLength(3);
    expect(hier.pivots[0]!.name).toBe('RootTransform');
    expect(hier.pivots[0]!.parentIndex).toBe(-1);
    expect(hier.pivots[1]!.name).toBe('Turret');
    expect(hier.pivots[1]!.parentIndex).toBe(0);
    expect(hier.pivots[2]!.name).toBe('Barrel');
    expect(hier.pivots[2]!.parentIndex).toBe(1);

    // Animation details
    const anim = result.animations[0]!;
    expect(anim.name).toBe('BCTANK.BCTANK');
    expect(anim.hierarchyName).toBe('BCTANK');
    expect(anim.numFrames).toBe(10);
    expect(anim.frameRate).toBe(30);
    expect(anim.channels).toHaveLength(1);
    expect(anim.channels[0]!.pivot).toBe(1); // Turret
    expect(anim.channels[0]!.type).toBe('quaternion');
    expect(anim.channels[0]!.data.length).toBe(40); // 10 frames × 4

    // HLOD details
    const hlod = result.hlods[0]!;
    expect(hlod.name).toBe('BCTANK');
    expect(hlod.lods).toHaveLength(1);
    expect(hlod.lods[0]!.subObjects).toHaveLength(2);
  });

  it('produces valid GLB from complete W3D', () => {
    const w3d = W3dParser.parse(buildCompleteW3d());
    const glb = GltfBuilder.buildGlb(w3d);
    const gltf = extractGltfJson(glb);

    // Basic structure
    expect(gltf['asset']).toBeDefined();
    expect((gltf['asset'] as Record<string, string>)['version']).toBe('2.0');

    // Should have 2 meshes
    const meshes = gltf['meshes'] as unknown[];
    expect(meshes).toHaveLength(2);

    // Should have joint nodes (3 pivots) + mesh nodes (2 meshes) = 5 nodes
    const nodes = gltf['nodes'] as unknown[];
    expect(nodes).toHaveLength(5);

    // Should have a skin
    const skins = gltf['skins'] as unknown[];
    expect(skins).toHaveLength(1);

    // Should have animations
    const anims = gltf['animations'] as unknown[];
    expect(anims).toHaveLength(1);

    // Accessors should exist
    const accessors = gltf['accessors'] as unknown[];
    expect(accessors.length).toBeGreaterThan(4);
  });

  it('handles skinned meshes with correct joint references', () => {
    const w3d = W3dParser.parse(buildCompleteW3d());
    const glb = GltfBuilder.buildGlb(w3d);
    const gltf = extractGltfJson(glb);

    const nodes = gltf['nodes'] as Array<Record<string, unknown>>;

    // Find mesh nodes (those with 'mesh' property)
    const meshNodes = nodes.filter((n) => n['mesh'] !== undefined);
    expect(meshNodes).toHaveLength(2);

    // Both mesh nodes with bone indices should have skin reference
    const skinnedNodes = meshNodes.filter((n) => n['skin'] !== undefined);
    expect(skinnedNodes).toHaveLength(2);
  });

  it('animation data is correct for rotation channel', () => {
    const buffer = buildCompleteW3d();
    const result = W3dParser.parse(buffer);
    const anim = result.animations[0]!;
    const ch = anim.channels[0]!;

    // Frame 0: no rotation → quat (0, 0, 0, 1)
    expect(ch.data[0]).toBeCloseTo(0, 4);
    expect(ch.data[1]).toBeCloseTo(0, 4);
    expect(ch.data[2]).toBeCloseTo(0, 4);
    expect(ch.data[3]).toBeCloseTo(1, 4);

    // Frame 9: 90 degrees Y → quat (0, sin(45°), 0, cos(45°))
    const lastIdx = 9 * 4;
    expect(ch.data[lastIdx]!).toBeCloseTo(0, 4);
    expect(ch.data[lastIdx + 1]!).toBeCloseTo(Math.sin(Math.PI / 4), 4);
    expect(ch.data[lastIdx + 2]!).toBeCloseTo(0, 4);
    expect(ch.data[lastIdx + 3]!).toBeCloseTo(Math.cos(Math.PI / 4), 4);
  });

  it('exports multi-LOD scenes from HLOD data', () => {
    // Build a W3D with 2 LOD levels: LOD0 (high detail, 2 meshes) and LOD1 (low detail, 1 mesh)
    const w = new BinaryWriter();

    // Mesh 1: high-detail hull (LOD0 only)
    const m1 = w.writeChunkHeader(W3dChunkType.MESH, true);
    writeMeshHeader(w, 'TANK.HULL_HI', 'TANK', 2, 4);
    const v1 = w.writeChunkHeader(W3dChunkType.VERTICES, false);
    for (let i = 0; i < 4; i++) { w.writeFloat32(i); w.writeFloat32(0); w.writeFloat32(0); }
    w.patchChunkSize(v1, false);
    const n1 = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
    for (let i = 0; i < 4; i++) { w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); }
    w.patchChunkSize(n1, false);
    const t1 = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
    w.writeUint32(0); w.writeUint32(1); w.writeUint32(2); w.writeUint32(0);
    w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
    w.writeUint32(0); w.writeUint32(2); w.writeUint32(3); w.writeUint32(0);
    w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
    w.patchChunkSize(t1, false);
    w.patchChunkSize(m1, true);

    // Mesh 2: turret (LOD0 only)
    const m2 = w.writeChunkHeader(W3dChunkType.MESH, true);
    writeMeshHeader(w, 'TANK.TURRET_HI', 'TANK', 1, 3);
    const v2 = w.writeChunkHeader(W3dChunkType.VERTICES, false);
    for (let i = 0; i < 3; i++) { w.writeFloat32(i); w.writeFloat32(1); w.writeFloat32(0); }
    w.patchChunkSize(v2, false);
    const n2 = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
    for (let i = 0; i < 3; i++) { w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); }
    w.patchChunkSize(n2, false);
    const t2 = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
    w.writeUint32(0); w.writeUint32(1); w.writeUint32(2); w.writeUint32(0);
    w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
    w.patchChunkSize(t2, false);
    w.patchChunkSize(m2, true);

    // Mesh 3: low-detail body (LOD1 only)
    const m3 = w.writeChunkHeader(W3dChunkType.MESH, true);
    writeMeshHeader(w, 'TANK.BODY_LO', 'TANK', 1, 3);
    const v3 = w.writeChunkHeader(W3dChunkType.VERTICES, false);
    for (let i = 0; i < 3; i++) { w.writeFloat32(i * 2); w.writeFloat32(0); w.writeFloat32(0); }
    w.patchChunkSize(v3, false);
    const n3 = w.writeChunkHeader(W3dChunkType.VERTEX_NORMALS, false);
    for (let i = 0; i < 3; i++) { w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); }
    w.patchChunkSize(n3, false);
    const t3 = w.writeChunkHeader(W3dChunkType.TRIANGLES, false);
    w.writeUint32(0); w.writeUint32(1); w.writeUint32(2); w.writeUint32(0);
    w.writeFloat32(0); w.writeFloat32(1); w.writeFloat32(0); w.writeFloat32(0);
    w.patchChunkSize(t3, false);
    w.patchChunkSize(m3, true);

    // HLOD with 2 LOD levels
    const hlodO = w.writeChunkHeader(W3dChunkType.HLOD, true);
    const hh = w.writeChunkHeader(W3dChunkType.HLOD_HEADER, false);
    w.writeUint32(0x00040001);
    w.writeUint32(2); // 2 LOD levels
    w.writeString('TANK', 32);
    w.writeString('TANK', 32);
    w.patchChunkSize(hh, false);

    // LOD0: high detail (maxScreenSize=0)
    const lod0 = w.writeChunkHeader(W3dChunkType.HLOD_LOD_ARRAY, true);
    const l0h = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT_ARRAY_HEADER, false);
    w.writeUint32(2); w.writeFloat32(0);
    w.patchChunkSize(l0h, false);
    const s0a = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT, false);
    w.writeUint32(0); w.writeString('TANK.HULL_HI', 32);
    w.patchChunkSize(s0a, false);
    const s0b = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT, false);
    w.writeUint32(0); w.writeString('TANK.TURRET_HI', 32);
    w.patchChunkSize(s0b, false);
    w.patchChunkSize(lod0, true);

    // LOD1: low detail (maxScreenSize=50)
    const lod1 = w.writeChunkHeader(W3dChunkType.HLOD_LOD_ARRAY, true);
    const l1h = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT_ARRAY_HEADER, false);
    w.writeUint32(1); w.writeFloat32(50);
    w.patchChunkSize(l1h, false);
    const s1a = w.writeChunkHeader(W3dChunkType.HLOD_SUB_OBJECT, false);
    w.writeUint32(0); w.writeString('TANK.BODY_LO', 32);
    w.patchChunkSize(s1a, false);
    w.patchChunkSize(lod1, true);

    w.patchChunkSize(hlodO, true);

    const w3d = W3dParser.parse(w.toArrayBuffer());
    expect(w3d.hlods[0]!.lods).toHaveLength(2);

    const glb = GltfBuilder.buildGlb(w3d);
    const gltf = extractGltfJson(glb) as Record<string, unknown>;

    // Should produce 2 scenes (one per LOD level)
    const scenes = gltf['scenes'] as Array<Record<string, unknown>>;
    expect(scenes).toHaveLength(2);

    // Scene 0 (highest detail, maxScreenSize=0): 2 mesh nodes
    const scene0Nodes = scenes[0]!['nodes'] as number[];
    expect(scene0Nodes).toHaveLength(2);
    expect(scenes[0]!['extras']).toBeUndefined(); // maxScreenSize=0 has no extras

    // Scene 1 (low detail, maxScreenSize=50): 1 mesh node + maxScreenSize in extras
    const scene1Nodes = scenes[1]!['nodes'] as number[];
    expect(scene1Nodes).toHaveLength(1);
    const extras = scenes[1]!['extras'] as Record<string, unknown>;
    expect(extras).toBeDefined();
    expect(extras['maxScreenSize']).toBe(50);

    // Should have 3 meshes total
    const meshes = gltf['meshes'] as unknown[];
    expect(meshes).toHaveLength(3);
  });

  it('parses hierarchy with chain validation', () => {
    const buffer = buildCompleteW3d();
    const result = W3dParser.parse(buffer);
    const hier = result.hierarchies[0]!;

    // Validate parent indices are in bounds
    for (const pivot of hier.pivots) {
      if (pivot.parentIndex !== -1) {
        expect(pivot.parentIndex).toBeGreaterThanOrEqual(0);
        expect(pivot.parentIndex).toBeLessThan(hier.pivots.length);
      }
    }

    // Barrel (idx 2) → Turret (idx 1) → RootTransform (idx 0) → root (-1)
    expect(hier.pivots[2]!.parentIndex).toBe(1);
    expect(hier.pivots[1]!.parentIndex).toBe(0);
    expect(hier.pivots[0]!.parentIndex).toBe(-1);
  });
});
