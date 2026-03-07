/**
 * Converts parsed W3D data into a glTF 2.0 GLB (binary) file.
 *
 * GLB structure:
 *   12-byte header: magic(0x46546C67) + version(2) + totalLength
 *   JSON chunk:  chunkLength + chunkType(0x4E4F534A) + padded JSON
 *   BIN  chunk:  chunkLength + chunkType(0x004E4942) + binary data
 */

import type { W3dFile } from './W3dParser.js';
import type { W3dMesh } from './W3dMeshParser.js';
import type { W3dHierarchy, W3dPivot } from './W3dHierarchyParser.js';
import type { W3dAnimation, W3dAnimChannel } from './W3dAnimationParser.js';
import type { W3dHlod } from './W3dHlodParser.js';

/* ------------------------------------------------------------------ */
/*  glTF JSON type helpers (minimal)                                   */
/* ------------------------------------------------------------------ */

interface GltfAccessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  max?: number[];
  min?: number[];
  byteOffset?: number;
}

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
  byteStride?: number;
}

interface GltfMeshPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}

interface GltfNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
}

interface GltfSkin {
  joints: number[];
  inverseBindMatrices?: number;
  skeleton?: number;
  name?: string;
}

interface GltfAnimSampler {
  input: number;
  output: number;
  interpolation?: string;
}

interface GltfAnimChannel {
  sampler: number;
  target: { node: number; path: string };
}

interface GltfAnimationDef {
  name?: string;
  channels: GltfAnimChannel[];
  samplers: GltfAnimSampler[];
}

interface GltfScene {
  nodes: number[];
  extras?: Record<string, unknown>;
}

interface GltfDocument {
  asset: { version: string; generator: string };
  scene: number;
  scenes: GltfScene[];
  nodes: GltfNode[];
  meshes: Array<{ name?: string; primitives: GltfMeshPrimitive[] }>;
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  buffers: Array<{ byteLength: number }>;
  skins?: GltfSkin[];
  animations?: GltfAnimationDef[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FLOAT = 5126;   // GL_FLOAT
const USHORT = 5123;  // GL_UNSIGNED_SHORT
const UINT = 5125;    // GL_UNSIGNED_INT
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const MAX_SAFE_ANIMATION_FRAMES = 20000;

/* ------------------------------------------------------------------ */
/*  Binary data accumulator                                            */
/* ------------------------------------------------------------------ */

class BinaryAccumulator {
  private parts: ArrayBuffer[] = [];
  private _byteLength = 0;

  get byteLength(): number {
    return this._byteLength;
  }

  /** Append typed-array data, aligning to 4 bytes. Returns the byte offset. */
  append(data: ArrayBuffer | ArrayBufferView): number {
    const buf = ArrayBuffer.isView(data)
      ? (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;
    const offset = this._byteLength;
    this.parts.push(buf);
    this._byteLength += buf.byteLength;
    // Pad to 4-byte alignment.
    const pad = (4 - (buf.byteLength % 4)) % 4;
    if (pad > 0) {
      this.parts.push(new ArrayBuffer(pad));
      this._byteLength += pad;
    }
    return offset;
  }

  /** Merge all parts into a single ArrayBuffer. */
  toArrayBuffer(): ArrayBuffer {
    const result = new ArrayBuffer(this._byteLength);
    const out = new Uint8Array(result);
    let pos = 0;
    for (const part of this.parts) {
      out.set(new Uint8Array(part), pos);
      pos += part.byteLength;
    }
    return result;
  }
}

/* ------------------------------------------------------------------ */
/*  Builder                                                            */
/* ------------------------------------------------------------------ */

export class GltfBuilder {
  /**
   * Build a glTF 2.0 GLB file from parsed W3D data.
   *
   * Strategy:
   *  - Each W3D mesh becomes a glTF mesh + a node referencing it.
   *  - If a hierarchy is present, skeleton joints are emitted as nodes,
   *    and meshes that have bone indices get a skin.
   *  - Animations are converted to glTF animation samplers + channels.
   */
  static buildGlb(w3d: W3dFile): ArrayBuffer {
    const bin = new BinaryAccumulator();
    const accessors: GltfAccessor[] = [];
    const bufferViews: GltfBufferView[] = [];
    const nodes: GltfNode[] = [];
    const gltfMeshes: Array<{ name?: string; primitives: GltfMeshPrimitive[] }> = [];
    const skins: GltfSkin[] = [];
    const animationDefs: GltfAnimationDef[] = [];
    const sceneNodes: number[] = [];

    // Helper: add a buffer view + accessor, return accessor index.
    function addAccessor(
      data: ArrayBufferView,
      componentType: number,
      count: number,
      type: string,
      target?: number,
      min?: number[],
      max?: number[],
    ): number {
      const byteOffset = bin.append(data);
      const bvIdx = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset,
        byteLength: data.byteLength,
        ...(target !== undefined ? { target } : {}),
      });
      const accIdx = accessors.length;
      accessors.push({
        bufferView: bvIdx,
        componentType,
        count,
        type,
        ...(min ? { min } : {}),
        ...(max ? { max } : {}),
      });
      return accIdx;
    }

    // ------------------------------------------------------------------
    //  Hierarchy → joint nodes
    // ------------------------------------------------------------------
    const hierarchy = w3d.hierarchies[0]; // Use first hierarchy if present.
    let jointNodeOffset = 0; // Index of the first joint node in the nodes array.
    const jointIndices: number[] = [];

    if (hierarchy && hierarchy.pivots.length > 0) {
      jointNodeOffset = nodes.length;
      const rootChildren: number[] = [];

      for (let i = 0; i < hierarchy.pivots.length; i++) {
        const pivot = hierarchy.pivots[i] as W3dPivot;
        const nodeIdx = jointNodeOffset + i;
        jointIndices.push(nodeIdx);

        const node: GltfNode = { name: pivot.name || `Joint_${i}` };

        // Apply transform.
        const [tx, ty, tz] = pivot.translation;
        if (tx !== 0 || ty !== 0 || tz !== 0) {
          node.translation = [tx, ty, tz];
        }
        const [qx, qy, qz, qw] = pivot.rotation;
        if (qx !== 0 || qy !== 0 || qz !== 0 || qw !== 1) {
          node.rotation = [qx, qy, qz, qw];
        }

        nodes.push(node);

        if (pivot.parentIndex === -1) {
          rootChildren.push(nodeIdx);
        }
      }

      // Wire up parent → children.
      for (let i = 0; i < hierarchy.pivots.length; i++) {
        const pivot = hierarchy.pivots[i] as W3dPivot;
        if (pivot.parentIndex >= 0 && pivot.parentIndex < hierarchy.pivots.length) {
          const parentNode = nodes[jointNodeOffset + pivot.parentIndex];
          if (parentNode) {
            if (!parentNode.children) parentNode.children = [];
            parentNode.children.push(jointNodeOffset + i);
          }
        }
      }

      // Add hierarchy root(s) to scene.
      for (const ri of rootChildren) {
        sceneNodes.push(ri);
      }

      // Build inverse bind matrices (identity for now — proper computation
      // would require accumulating the hierarchy transforms).
      const ibmData = new Float32Array(hierarchy.pivots.length * 16);
      for (let i = 0; i < hierarchy.pivots.length; i++) {
        // Identity 4x4 matrix in column-major order.
        const base = i * 16;
        ibmData[base + 0] = 1;
        ibmData[base + 5] = 1;
        ibmData[base + 10] = 1;
        ibmData[base + 15] = 1;
      }
      const ibmAccessor = addAccessor(ibmData, FLOAT, hierarchy.pivots.length, 'MAT4');

      skins.push({
        joints: jointIndices,
        inverseBindMatrices: ibmAccessor,
        skeleton: jointIndices[0],
        name: hierarchy.name,
      });
    }

    // ------------------------------------------------------------------
    //  Meshes — build glTF mesh + node for each W3D mesh
    // ------------------------------------------------------------------

    // Map mesh name → node index (for HLOD scene grouping).
    const meshNameToNodeIdx = new Map<string, number>();

    for (const mesh of w3d.meshes) {
      const meshNodeIdx = buildMeshNode(
        mesh, bin, accessors, bufferViews, nodes, gltfMeshes, skins,
      );
      meshNameToNodeIdx.set(mesh.name, meshNodeIdx);
      sceneNodes.push(meshNodeIdx);
    }

    // ------------------------------------------------------------------
    //  Animations
    // ------------------------------------------------------------------
    for (const anim of w3d.animations) {
      const gltfAnim = buildGltfAnimation(anim, hierarchy, jointNodeOffset, bin, bufferViews, accessors);
      if (gltfAnim) animationDefs.push(gltfAnim);
    }

    // ------------------------------------------------------------------
    //  Build scenes (multi-LOD if HLOD data present)
    // ------------------------------------------------------------------
    const hlod = w3d.hlods[0];
    const scenes = buildLodScenes(hlod, meshNameToNodeIdx, sceneNodes, jointIndices);

    // ------------------------------------------------------------------
    //  Assemble glTF JSON
    // ------------------------------------------------------------------
    const binBuffer = bin.toArrayBuffer();

    const gltf: GltfDocument = {
      asset: { version: '2.0', generator: 'generals-w3d-converter' },
      scene: 0,
      scenes,
      nodes,
      meshes: gltfMeshes,
      accessors,
      bufferViews,
      buffers: [{ byteLength: binBuffer.byteLength }],
    };

    if (skins.length > 0) gltf.skins = skins;
    if (animationDefs.length > 0) gltf.animations = animationDefs;

    // ------------------------------------------------------------------
    //  Pack into GLB
    // ------------------------------------------------------------------
    return packGlb(gltf, binBuffer);
  }
}

/* ------------------------------------------------------------------ */
/*  Mesh node builder (extracted to share with LOD grouping)           */
/* ------------------------------------------------------------------ */

function buildMeshNode(
  mesh: W3dMesh,
  bin: BinaryAccumulator,
  accessors: GltfAccessor[],
  bufferViews: GltfBufferView[],
  nodes: GltfNode[],
  gltfMeshes: Array<{ name?: string; primitives: GltfMeshPrimitive[] }>,
  skins: GltfSkin[],
): number {
  function addAccessor(
    data: ArrayBufferView,
    componentType: number,
    count: number,
    type: string,
    target?: number,
    min?: number[],
    max?: number[],
  ): number {
    const byteOffset = bin.append(data);
    const bvIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: data.byteLength,
      ...(target !== undefined ? { target } : {}),
    });
    const accIdx = accessors.length;
    accessors.push({
      bufferView: bvIdx,
      componentType,
      count,
      type,
      ...(min ? { min } : {}),
      ...(max ? { max } : {}),
    });
    return accIdx;
  }

  const primitiveAttrs: Record<string, number> = {};

  // Positions.
  if (mesh.vertices.length > 0) {
    const posMin = [Infinity, Infinity, Infinity];
    const posMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = mesh.vertices[i + c] ?? 0;
        if (v < (posMin[c] ?? Infinity)) posMin[c] = v;
        if (v > (posMax[c] ?? -Infinity)) posMax[c] = v;
      }
    }
    primitiveAttrs['POSITION'] = addAccessor(
      mesh.vertices,
      FLOAT,
      mesh.vertices.length / 3,
      'VEC3',
      ARRAY_BUFFER,
      posMin,
      posMax,
    );
  }

  // Normals.
  if (mesh.normals.length > 0) {
    primitiveAttrs['NORMAL'] = addAccessor(
      mesh.normals,
      FLOAT,
      mesh.normals.length / 3,
      'VEC3',
      ARRAY_BUFFER,
    );
  }

  // UVs.
  if (mesh.uvs.length > 0) {
    primitiveAttrs['TEXCOORD_0'] = addAccessor(
      mesh.uvs,
      FLOAT,
      mesh.uvs.length / 2,
      'VEC2',
      ARRAY_BUFFER,
    );
  }

  // Vertex colors.
  if (mesh.vertexColors && mesh.vertexColors.length > 0) {
    primitiveAttrs['COLOR_0'] = addAccessor(
      mesh.vertexColors,
      5121, // GL_UNSIGNED_BYTE
      mesh.vertexColors.length / 4,
      'VEC4',
      ARRAY_BUFFER,
    );
    const lastAcc = accessors[accessors.length - 1];
    if (lastAcc) (lastAcc as GltfAccessor & { normalized?: boolean }).normalized = true;
  }

  // Skinning attributes.
  if (mesh.boneIndices && mesh.boneIndices.length > 0 && skins.length > 0) {
    const numVerts = mesh.boneIndices.length;
    const joints4 = new Uint16Array(numVerts * 4);
    const weights4 = new Float32Array(numVerts * 4);
    for (let i = 0; i < numVerts; i++) {
      joints4[i * 4] = mesh.boneIndices[i] ?? 0;
      weights4[i * 4] = 1.0;
    }
    primitiveAttrs['JOINTS_0'] = addAccessor(joints4, USHORT, numVerts, 'VEC4', ARRAY_BUFFER);
    primitiveAttrs['WEIGHTS_0'] = addAccessor(weights4, FLOAT, numVerts, 'VEC4', ARRAY_BUFFER);
  }

  // Indices.
  let indicesAccessor: number | undefined;
  if (mesh.indices.length > 0) {
    const maxIndex = mesh.indices.reduce((m, v) => Math.max(m, v), 0);
    if (maxIndex <= 0xffff) {
      const shortIndices = new Uint16Array(mesh.indices.length);
      for (let i = 0; i < mesh.indices.length; i++) {
        shortIndices[i] = mesh.indices[i] ?? 0;
      }
      indicesAccessor = addAccessor(shortIndices, USHORT, shortIndices.length, 'SCALAR', ELEMENT_ARRAY_BUFFER);
    } else {
      indicesAccessor = addAccessor(mesh.indices, UINT, mesh.indices.length, 'SCALAR', ELEMENT_ARRAY_BUFFER);
    }
  }

  const primitive: GltfMeshPrimitive = {
    attributes: primitiveAttrs,
    mode: 4, // TRIANGLES
  };
  if (indicesAccessor !== undefined) primitive.indices = indicesAccessor;

  const gltfMeshIdx = gltfMeshes.length;
  gltfMeshes.push({ name: mesh.name, primitives: [primitive] });

  const meshNode: GltfNode = { name: mesh.name, mesh: gltfMeshIdx };
  if (mesh.boneIndices && skins.length > 0) {
    meshNode.skin = 0;
  }
  const meshNodeIdx = nodes.length;
  nodes.push(meshNode);
  return meshNodeIdx;
}

/* ------------------------------------------------------------------ */
/*  LOD scene builder                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build glTF scenes from HLOD data. When multiple LOD levels exist,
 * creates one scene per LOD (highest-detail = scene 0), with
 * maxScreenSize stored in scene extras.
 *
 * Falls back to a single scene with all mesh nodes when no HLOD data exists.
 */
function buildLodScenes(
  hlod: W3dHlod | undefined,
  meshNameToNodeIdx: Map<string, number>,
  allMeshNodes: number[],
  jointRootNodes: number[],
): GltfScene[] {
  // No HLOD or single LOD → single scene with all meshes
  if (!hlod || hlod.lods.length <= 1) {
    return [{ nodes: [...allMeshNodes] }];
  }

  // Multiple LOD levels: sort by maxScreenSize descending (highest detail first).
  // In W3D, LOD 0 is typically the highest-detail level (maxScreenSize=0),
  // and higher indices are lower detail with larger maxScreenSize thresholds.
  const sortedLods = [...hlod.lods].sort((a, b) => a.maxScreenSize - b.maxScreenSize);

  const scenes: GltfScene[] = [];
  const assignedNodes = new Set<number>();

  for (const lod of sortedLods) {
    const lodNodes: number[] = [];

    // Joint/skeleton root nodes are shared across all scenes
    for (const jn of jointRootNodes) {
      lodNodes.push(jn);
    }

    for (const subObj of lod.subObjects) {
      // Sub-object names use format "HLODNAME.MESHNAME"
      const nodeIdx = meshNameToNodeIdx.get(subObj.name);
      if (nodeIdx !== undefined) {
        lodNodes.push(nodeIdx);
        assignedNodes.add(nodeIdx);
      }
    }

    const scene: GltfScene = { nodes: lodNodes };
    if (lod.maxScreenSize > 0) {
      scene.extras = { maxScreenSize: lod.maxScreenSize };
    }
    scenes.push(scene);
  }

  // Any meshes not assigned to an HLOD LOD go into the first (highest-detail) scene.
  const firstScene = scenes[0];
  if (firstScene) {
    for (const nodeIdx of allMeshNodes) {
      if (!assignedNodes.has(nodeIdx)) {
        firstScene.nodes.push(nodeIdx);
      }
    }
  }

  return scenes;
}

/* ------------------------------------------------------------------ */
/*  Animation builder                                                  */
/* ------------------------------------------------------------------ */

function buildGltfAnimation(
  anim: W3dAnimation,
  hierarchy: W3dHierarchy | undefined,
  jointNodeOffset: number,
  bin: BinaryAccumulator,
  bufferViews: GltfBufferView[],
  accessors: GltfAccessor[],
): GltfAnimationDef | null {
  if (anim.channels.length === 0) return null;

  const samplers: GltfAnimSampler[] = [];
  const channels: GltfAnimChannel[] = [];

  // Group channels by (pivot, path) to combine scalar X/Y/Z into VEC3.
  const translationGroups = new Map<number, { x?: W3dAnimChannel; y?: W3dAnimChannel; z?: W3dAnimChannel }>();
  const rotationChannels: W3dAnimChannel[] = [];

  for (const ch of anim.channels) {
    if (ch.type === 'quaternion') {
      rotationChannels.push(ch);
    } else {
      let group = translationGroups.get(ch.pivot);
      if (!group) {
        group = {};
        translationGroups.set(ch.pivot, group);
      }
      group[ch.type] = ch;
    }
  }

  // Some retail files carry invalid animation-header frame rates; keep output bounded/stable.
  const frameRate =
    Number.isFinite(anim.frameRate) && anim.frameRate > 0 && anim.frameRate <= 1000
      ? anim.frameRate
      : 30;

  function addAcc(
    data: ArrayBufferView,
    componentType: number,
    count: number,
    type: string,
    min?: number[],
    max?: number[],
  ): number {
    const byteOffset = bin.append(data);
    const bvIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength });
    const accIdx = accessors.length;
    accessors.push({
      bufferView: bvIdx,
      componentType,
      count,
      type,
      ...(min ? { min } : {}),
      ...(max ? { max } : {}),
    });
    return accIdx;
  }

  // Translation channels.
  for (const [pivot, group] of translationGroups) {
    const channelFirstFrames = [group.x?.firstFrame, group.y?.firstFrame, group.z?.firstFrame]
      .filter((v): v is number => typeof v === 'number');
    const channelLastFrames = [group.x?.lastFrame, group.y?.lastFrame, group.z?.lastFrame]
      .filter((v): v is number => typeof v === 'number');

    const firstFrame = channelFirstFrames.length > 0 ? Math.min(...channelFirstFrames) : 0;
    const lastFrame = channelLastFrames.length > 0 ? Math.max(...channelLastFrames) : firstFrame;
    const rawNumFrames = Math.max(1, lastFrame - firstFrame + 1);
    const numFrames = Math.min(rawNumFrames, MAX_SAFE_ANIMATION_FRAMES);

    const times = new Float32Array(numFrames);
    const values = new Float32Array(numFrames * 3);

    for (let f = 0; f < numFrames; f++) {
      const frame = firstFrame + f;
      times[f] = frame / frameRate;
      values[f * 3] = getChannelValue(group.x, frame);
      values[f * 3 + 1] = getChannelValue(group.y, frame);
      values[f * 3 + 2] = getChannelValue(group.z, frame);
    }

    const inputAcc = addAcc(times, FLOAT, numFrames, 'SCALAR', [times[0] ?? 0], [times[numFrames - 1] ?? 0]);
    const outputAcc = addAcc(values, FLOAT, numFrames, 'VEC3');

    const samplerIdx = samplers.length;
    samplers.push({ input: inputAcc, output: outputAcc, interpolation: 'LINEAR' });

    const targetNode = jointNodeOffset + pivot;
    if (!hierarchy || pivot < hierarchy.pivots.length) {
      channels.push({ sampler: samplerIdx, target: { node: targetNode, path: 'translation' } });
    }
  }

  // Rotation channels.
  for (const ch of rotationChannels) {
    const rawNumFrames = Math.max(1, ch.lastFrame - ch.firstFrame + 1);
    const channelFrameCapacity = Math.max(1, Math.floor(ch.data.length / 4));
    const numFrames = Math.min(rawNumFrames, channelFrameCapacity, MAX_SAFE_ANIMATION_FRAMES);
    const times = new Float32Array(numFrames);
    const values = new Float32Array(numFrames * 4);

    for (let f = 0; f < numFrames; f++) {
      times[f] = (ch.firstFrame + f) / frameRate;
      // W3D quaternion data is XYZW; glTF also expects XYZW.
      values[f * 4] = ch.data[f * 4] ?? 0;
      values[f * 4 + 1] = ch.data[f * 4 + 1] ?? 0;
      values[f * 4 + 2] = ch.data[f * 4 + 2] ?? 0;
      values[f * 4 + 3] = ch.data[f * 4 + 3] ?? 1;
    }

    const inputAcc = addAcc(times, FLOAT, numFrames, 'SCALAR', [times[0] ?? 0], [times[numFrames - 1] ?? 0]);
    const outputAcc = addAcc(values, FLOAT, numFrames, 'VEC4');

    const samplerIdx = samplers.length;
    samplers.push({ input: inputAcc, output: outputAcc, interpolation: 'LINEAR' });

    const targetNode = jointNodeOffset + ch.pivot;
    if (!hierarchy || ch.pivot < hierarchy.pivots.length) {
      channels.push({ sampler: samplerIdx, target: { node: targetNode, path: 'rotation' } });
    }
  }

  if (channels.length === 0) return null;

  return { name: anim.name, channels, samplers };
}

function getChannelValue(ch: W3dAnimChannel | undefined, frame: number): number {
  if (!ch) return 0;
  const idx = frame - ch.firstFrame;
  if (idx < 0) return ch.data[0] ?? 0;
  if (idx >= ch.data.length) return ch.data[ch.data.length - 1] ?? 0;
  return ch.data[idx] ?? 0;
}

/* ------------------------------------------------------------------ */
/*  GLB packing                                                        */
/* ------------------------------------------------------------------ */

function packGlb(gltf: GltfDocument, binBuffer: ArrayBuffer): ArrayBuffer {
  // JSON chunk: must be padded with spaces (0x20) to 4-byte alignment.
  const jsonString = JSON.stringify(gltf);
  const jsonEncoder = new TextEncoder();
  const jsonBytes = jsonEncoder.encode(jsonString);
  const jsonPadLen = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunkLength = jsonBytes.byteLength + jsonPadLen;

  // BIN chunk: must be padded with zeros to 4-byte alignment.
  const binPadLen = (4 - (binBuffer.byteLength % 4)) % 4;
  const binChunkLength = binBuffer.byteLength + binPadLen;

  // Total GLB size.
  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  const bytes = new Uint8Array(glb);
  let offset = 0;

  // GLB header.
  view.setUint32(offset, 0x46546c67, true); offset += 4; // magic "glTF"
  view.setUint32(offset, 2, true); offset += 4;           // version 2
  view.setUint32(offset, totalLength, true); offset += 4;

  // JSON chunk header.
  view.setUint32(offset, jsonChunkLength, true); offset += 4;
  view.setUint32(offset, 0x4e4f534a, true); offset += 4; // "JSON"
  bytes.set(jsonBytes, offset); offset += jsonBytes.byteLength;
  // Pad with spaces.
  for (let i = 0; i < jsonPadLen; i++) {
    bytes[offset++] = 0x20;
  }

  // BIN chunk header.
  view.setUint32(offset, binChunkLength, true); offset += 4;
  view.setUint32(offset, 0x004e4942, true); offset += 4; // "BIN\0"
  bytes.set(new Uint8Array(binBuffer), offset); offset += binBuffer.byteLength;
  // Pad with zeros (already zeroed).

  return glb;
}
