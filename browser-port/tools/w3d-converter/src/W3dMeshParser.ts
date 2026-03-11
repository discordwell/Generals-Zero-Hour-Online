/**
 * Parses W3D MESH chunks (type 0x00000000) into structured mesh data.
 *
 * A MESH chunk is a container (hasSubChunks = true) holding:
 *   MESH_HEADER3  – meta info (name, counts, AABB, etc.)
 *   VERTICES      – float32[3] × numVertices
 *   VERTEX_NORMALS– float32[3] × numVertices
 *   TEXCOORDS     – float32[2] × numVertices
 *   TRIANGLES     – per-tri record (see below)
 *   VERTEX_COLORS – uint8[4] × numVertices  (optional)
 *   VERTEX_INFLUENCES – bone indices          (optional)
 *   TEXTURES / TEXTURE / TEXTURE_NAME         (optional)
 *   MATERIAL_PASS / TEXTURE_STAGE / …         (optional)
 */

import { W3dChunkReader } from './W3dChunkReader.js';
import { W3dChunkType } from './W3dChunkTypes.js';

/** W3D vertex material properties (from VERTEX_MATERIAL_INFO chunk). */
export interface W3dMaterial {
  diffuse: [number, number, number, number];   // RGBA 0–1
  specular: [number, number, number, number];  // RGBA 0–1
  emissive: [number, number, number, number];  // RGBA 0–1
  ambient: [number, number, number, number];   // RGBA 0–1
  shininess: number;
  opacity: number;
  translucency: number;
}

/** W3D shader settings (from SHADERS chunk — one 32-byte record per material pass). */
export interface W3dShader {
  depthCompare: number;
  depthMask: number;
  colorMask: number;
  destBlend: number;      // 0=zero, 1=one, 2=srcAlpha, 3=oneMinusSrcAlpha, ...
  fogFunc: number;
  priGradient: number;
  secGradient: number;
  srcBlend: number;       // 0=zero, 1=one, 2=srcAlpha, ...
  texturing: number;
  detailColorFunc: number;
  detailAlphaFunc: number;
  shaderPreset: number;
  alphaTest: number;      // 0=disable, 1=enable
  postDetailColorFunc: number;
  postDetailAlphaFunc: number;
}

export interface W3dMesh {
  name: string;
  containerName: string;
  vertices: Float32Array;    // flat [x,y,z, x,y,z, …]
  normals: Float32Array;     // flat [x,y,z, …]
  uvs: Float32Array;         // flat [u,v, u,v, …]
  indices: Uint32Array;      // triangle vertex indices (flat)
  vertexColors?: Uint8Array; // RGBA × numVertices
  boneIndices?: Uint16Array; // one per vertex
  textureNames: string[];
  attributes: number;
  materials: W3dMaterial[];
  shaders: W3dShader[];
}

/**
 * Size in bytes of one Triangle record:
 *   uint32 vindex[3]  = 12
 *   uint32 attributes =  4
 *   float32 normal[3] = 12
 *   float32 dist      =  4
 *   ----                 32
 */
const TRIANGLE_RECORD_SIZE = 32;

/*
 * MESH_HEADER3 structure is 116 bytes total:
 *   4 (Version) + 4 (Attributes) + 32 (MeshName) + 32 (ContainerName) +
 *   4 (NumTris) + 4 (NumVertices) + 4 (NumMaterials) + 4 (NumDamageStages) +
 *   4 (SortLevel) + 4 (PrelitVersion) + 4 (FutureCounts[1]) +
 *   4 (VertexChannels) + 4 (FaceChannels) +
 *   12 (MinCorner) + 12 (MaxCorner) + 12 (SphCenter) + 4 (SphRadius)
 */

export function parseMeshChunk(reader: W3dChunkReader, meshChunkDataOffset: number, meshChunkSize: number): W3dMesh {
  const endOffset = meshChunkDataOffset + meshChunkSize;

  // Defaults – will be overwritten when the corresponding sub-chunk is found.
  let name = '';
  let containerName = '';
  let attributes = 0;
  let numVertices = 0;
  let numTris = 0;
  let vertices = new Float32Array(0);
  let normals = new Float32Array(0);
  let uvs = new Float32Array(0);
  let indices = new Uint32Array(0);
  let vertexColors: Uint8Array | undefined;
  let boneIndices: Uint16Array | undefined;
  const textureNames: string[] = [];
  const materials: W3dMaterial[] = [];
  const shaders: W3dShader[] = [];

  for (const sub of reader.iterateChunks(meshChunkDataOffset, endOffset)) {
    switch (sub.type) {
      case W3dChunkType.MESH_HEADER3: {
        // Guard malformed headers in retail content variants.
        if (sub.size < 80) {
          break;
        }
        // Skip Version (4) and read Attributes.
        attributes = reader.readUint32(sub.dataOffset + 4);
        name = reader.readString(sub.dataOffset + 8, 32);
        containerName = reader.readString(sub.dataOffset + 40, 32);
        numTris = reader.readUint32(sub.dataOffset + 72);
        numVertices = reader.readUint32(sub.dataOffset + 76);
        break;
      }

      case W3dChunkType.VERTICES: {
        const availableVertices = Math.floor(sub.size / 12);
        const inferredVertices = numVertices > 0 ? numVertices : availableVertices;
        const vertexCount = Math.min(inferredVertices, availableVertices);
        vertices = reader.readFloat32Array(sub.dataOffset, vertexCount * 3);
        numVertices = vertexCount;
        break;
      }

      case W3dChunkType.VERTEX_NORMALS: {
        const availableNormals = Math.floor(sub.size / 12);
        const inferredVertices = numVertices > 0 ? numVertices : availableNormals;
        const normalCount = Math.min(inferredVertices, availableNormals);
        normals = reader.readFloat32Array(sub.dataOffset, normalCount * 3);
        if (numVertices === 0) {
          numVertices = normalCount;
        }
        break;
      }

      case W3dChunkType.TEXCOORDS: {
        const availableUvs = Math.floor(sub.size / 8);
        const inferredVertices = numVertices > 0 ? numVertices : availableUvs;
        const uvCount = Math.min(inferredVertices, availableUvs);
        uvs = reader.readFloat32Array(sub.dataOffset, uvCount * 2);
        if (numVertices === 0) {
          numVertices = uvCount;
        }
        break;
      }

      case W3dChunkType.TRIANGLES: {
        const availableTris = Math.floor(sub.size / TRIANGLE_RECORD_SIZE);
        const inferredTris = numTris > 0 ? numTris : availableTris;
        const triCount = Math.min(inferredTris, availableTris);
        indices = new Uint32Array(triCount * 3);
        for (let i = 0; i < triCount; i++) {
          const base = sub.dataOffset + i * TRIANGLE_RECORD_SIZE;
          indices[i * 3] = reader.readUint32(base);
          indices[i * 3 + 1] = reader.readUint32(base + 4);
          indices[i * 3 + 2] = reader.readUint32(base + 8);
        }
        numTris = triCount;
        break;
      }

      case W3dChunkType.VERTEX_COLORS: {
        const availableColors = Math.floor(sub.size / 4);
        const inferredVertices = numVertices > 0 ? numVertices : availableColors;
        const colorCount = Math.min(inferredVertices, availableColors);
        vertexColors = new Uint8Array(colorCount * 4);
        const raw = reader.readUint8Array(sub.dataOffset, colorCount * 4);
        vertexColors.set(raw);
        if (numVertices === 0) {
          numVertices = colorCount;
        }
        break;
      }

      case W3dChunkType.VERTEX_INFLUENCES: {
        // Each influence record = uint16 boneIdx + 6 bytes padding = 8 bytes.
        const availableInfluences = Math.floor(sub.size / 8);
        const inferredVertices = numVertices > 0 ? numVertices : availableInfluences;
        const influenceCount = Math.min(inferredVertices, availableInfluences);
        boneIndices = new Uint16Array(influenceCount);
        for (let i = 0; i < influenceCount; i++) {
          boneIndices[i] = reader.readUint16(sub.dataOffset + i * 8);
        }
        if (numVertices === 0) {
          numVertices = influenceCount;
        }
        break;
      }

      case W3dChunkType.VERTEX_MATERIALS: {
        parseVertexMaterials(reader, sub.dataOffset, sub.dataOffset + sub.size, materials);
        break;
      }

      case W3dChunkType.SHADERS: {
        parseShaders(reader, sub.dataOffset, sub.size, shaders);
        break;
      }

      case W3dChunkType.TEXTURES: {
        // Container for TEXTURE sub-chunks.
        parseTextureContainer(reader, sub.dataOffset, sub.dataOffset + sub.size, textureNames);
        break;
      }

      case W3dChunkType.MATERIAL_PASS: {
        // May contain TEXTURE_STAGE → TEXTURE_IDS and STAGE_TEXCOORDS.
        // We only care about extracting additional texture names (already handled via TEXTURES).
        // Also may contain DCG vertex colours — handle here as fallback.
        parseMaterialPass(reader, sub.dataOffset, sub.dataOffset + sub.size, numVertices, (colors) => {
          if (!vertexColors) vertexColors = colors;
        });
        break;
      }

      // Prelit chunks contain the same sub-chunk structure as MESH
      case W3dChunkType.PRELIT_UNLIT:
      case W3dChunkType.PRELIT_VERTEX:
      case W3dChunkType.PRELIT_LIGHTMAP_MULTI_PASS:
      case W3dChunkType.PRELIT_LIGHTMAP_MULTI_TEX: {
        // These contain nested material pass data; skip for now.
        break;
      }

      default:
        // Unknown / unhandled sub-chunk – skip silently.
        break;
    }
  }

  return {
    name,
    containerName,
    vertices,
    normals,
    uvs,
    indices,
    vertexColors,
    boneIndices,
    textureNames,
    attributes,
    materials,
    shaders,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseTextureContainer(
  reader: W3dChunkReader,
  offset: number,
  endOffset: number,
  out: string[],
): void {
  for (const texChunk of reader.iterateChunks(offset, endOffset)) {
    if (texChunk.type === W3dChunkType.TEXTURE) {
      parseTexture(reader, texChunk.dataOffset, texChunk.dataOffset + texChunk.size, out);
    }
  }
}

function parseTexture(
  reader: W3dChunkReader,
  offset: number,
  endOffset: number,
  out: string[],
): void {
  for (const sub of reader.iterateChunks(offset, endOffset)) {
    if (sub.type === W3dChunkType.TEXTURE_NAME) {
      out.push(reader.readString(sub.dataOffset, sub.size));
    }
  }
}

function parseVertexMaterials(
  reader: W3dChunkReader,
  offset: number,
  endOffset: number,
  out: W3dMaterial[],
): void {
  for (const vmChunk of reader.iterateChunks(offset, endOffset)) {
    if (vmChunk.type === W3dChunkType.VERTEX_MATERIAL) {
      parseVertexMaterial(reader, vmChunk.dataOffset, vmChunk.dataOffset + vmChunk.size, out);
    }
  }
}

function parseVertexMaterial(
  reader: W3dChunkReader,
  offset: number,
  endOffset: number,
  out: W3dMaterial[],
): void {
  for (const sub of reader.iterateChunks(offset, endOffset)) {
    if (sub.type === W3dChunkType.VERTEX_MATERIAL_INFO && sub.size >= 52) {
      // VERTEX_MATERIAL_INFO layout (52 bytes):
      //   uint32 Attributes (4)
      //   RGBA   Ambient    (4 × float32 = 16)  offset  4
      //   RGBA   Diffuse    (4 × float32 = 16)  offset 20
      //   RGBA   Specular   (4 × float32 = 16)  offset 36
      //   RGBA   Emissive   (4 × float32 = 16)  offset 52
      //   float32 Shininess                       offset 68
      //   float32 Opacity                         offset 72
      //   float32 Translucency                    offset 76
      // Total = 80 bytes for full struct; some retail files have shorter variants.
      const base = sub.dataOffset;
      const readRGBA = (off: number): [number, number, number, number] => [
        reader.readFloat32(off),
        reader.readFloat32(off + 4),
        reader.readFloat32(off + 8),
        reader.readFloat32(off + 12),
      ];

      const ambient = sub.size >= 20 ? readRGBA(base + 4) : [0, 0, 0, 1] as [number, number, number, number];
      const diffuse = sub.size >= 36 ? readRGBA(base + 20) : [0.8, 0.8, 0.8, 1] as [number, number, number, number];
      const specular = sub.size >= 52 ? readRGBA(base + 36) : [0, 0, 0, 1] as [number, number, number, number];
      const emissive = sub.size >= 68 ? readRGBA(base + 52) : [0, 0, 0, 1] as [number, number, number, number];
      const shininess = sub.size >= 72 ? reader.readFloat32(base + 68) : 0;
      const opacity = sub.size >= 76 ? reader.readFloat32(base + 72) : 1;
      const translucency = sub.size >= 80 ? reader.readFloat32(base + 76) : 0;

      out.push({ ambient, diffuse, specular, emissive, shininess, opacity, translucency });
    }
  }
}

/**
 * Parse SHADERS chunk: an array of 32-byte shader records.
 *
 * Each record has 15 uint8 fields (see W3dShader interface) packed
 * in a fixed 32-byte record with padding.
 */
function parseShaders(
  reader: W3dChunkReader,
  dataOffset: number,
  size: number,
  out: W3dShader[],
): void {
  const SHADER_RECORD_SIZE = 32;
  const count = Math.floor(size / SHADER_RECORD_SIZE);
  for (let i = 0; i < count; i++) {
    const base = dataOffset + i * SHADER_RECORD_SIZE;
    out.push({
      depthCompare: reader.readUint8(base),
      depthMask: reader.readUint8(base + 1),
      colorMask: reader.readUint8(base + 2),
      destBlend: reader.readUint8(base + 3),
      fogFunc: reader.readUint8(base + 4),
      priGradient: reader.readUint8(base + 5),
      secGradient: reader.readUint8(base + 6),
      srcBlend: reader.readUint8(base + 7),
      texturing: reader.readUint8(base + 8),
      detailColorFunc: reader.readUint8(base + 9),
      detailAlphaFunc: reader.readUint8(base + 10),
      shaderPreset: reader.readUint8(base + 11),
      alphaTest: reader.readUint8(base + 12),
      postDetailColorFunc: reader.readUint8(base + 13),
      postDetailAlphaFunc: reader.readUint8(base + 14),
    });
  }
}

function parseMaterialPass(
  reader: W3dChunkReader,
  offset: number,
  endOffset: number,
  numVertices: number,
  onDCG: (colors: Uint8Array) => void,
): void {
  for (const sub of reader.iterateChunks(offset, endOffset)) {
    if (sub.type === W3dChunkType.DCG) {
      const availableColors = Math.floor(sub.size / 4);
      const inferredVertices = numVertices > 0 ? numVertices : availableColors;
      const colorCount = Math.min(inferredVertices, availableColors);
      if (colorCount <= 0) {
        continue;
      }
      const colors = new Uint8Array(colorCount * 4);
      const raw = reader.readUint8Array(sub.dataOffset, colorCount * 4);
      colors.set(raw);
      onDCG(colors);
    }
  }
}
