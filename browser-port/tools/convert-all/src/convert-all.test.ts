import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import viteConfig from '../../../vite.config';
import {
  AssetManager,
  RUNTIME_ASSET_BASE_URL,
  RUNTIME_MANIFEST_FILE,
  RUNTIME_MANIFEST_PUBLIC_PATH,
} from '@generals/assets';

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ConversionManifestSnapshot {
  version: number;
  entryCount: number;
  entries: Array<{
    sourcePath: string;
    outputPath: string;
    sourceHash: string;
    outputHash: string;
    converter: string;
  }>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');
const APP_PUBLIC_DIR = resolve(PROJECT_ROOT, 'packages', 'app', 'public');
const APP_PUBLIC_ASSETS_DIR = resolve(APP_PUBLIC_DIR, RUNTIME_ASSET_BASE_URL);
const APP_PUBLIC_ASSETS_DISPLAY_PATH = `${relative(dirname(PROJECT_ROOT), APP_PUBLIC_ASSETS_DIR).replace(/\\/g, '/')}/`;
const CONVERT_ALL_PATH = resolve(PROJECT_ROOT, 'tools/convert-all.ts');
const TSX_PATH = resolve(PROJECT_ROOT, 'node_modules/tsx/dist/cli.mjs');
const MAIN_TS_PATH = resolve(PROJECT_ROOT, 'packages', 'app', 'src', 'main.ts');
const VITE_CONFIG_PATH = resolve(PROJECT_ROOT, 'vite.config.ts');

function runConvertAll(args: string[], cwd = PROJECT_ROOT): CliResult {
  const proc = spawnSync(process.execPath, [TSX_PATH, CONVERT_ALL_PATH, ...args], {
    cwd,
    encoding: 'utf8',
  });

  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? '',
  };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'generals-convert-all-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAscii(view: DataView, offset: number, text: string): number {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
  return offset + text.length;
}

function writeUint32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true);
  return offset + 4;
}

function writeInt32(view: DataView, offset: number, value: number): number {
  view.setInt32(offset, value, true);
  return offset + 4;
}

function writeUint16(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value, true);
  return offset + 2;
}

function writeUint8(view: DataView, offset: number, value: number): number {
  view.setUint8(offset, value);
  return offset + 1;
}

function buildMinimalMapBinary(heightBytes: readonly number[] = [0, 64, 128, 255]): Uint8Array {
  const mapMagic = 'CkMp';
  const chunkHeaderSize = 10;
  const chunkName = 'HeightMapData';
  const chunkId = 1;
  const width = 2;
  const height = 2;
  const borderSize = 0;
  const heightData = Uint8Array.from(heightBytes);
  const payloadSize = 4 + 4 + 4 + 4 + heightData.length;

  const tocSize = 4 + 4 + 1 + chunkName.length + 4;
  const totalSize = tocSize + chunkHeaderSize + payloadSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  let offset = 0;
  offset = writeAscii(view, offset, mapMagic);
  offset = writeUint32(view, offset, 1);
  offset = writeUint8(view, offset, chunkName.length);
  offset = writeAscii(view, offset, chunkName);
  offset = writeUint32(view, offset, chunkId);

  offset = writeUint32(view, offset, chunkId);
  offset = writeUint16(view, offset, 3);
  offset = writeInt32(view, offset, payloadSize);
  offset = writeInt32(view, offset, width);
  offset = writeInt32(view, offset, height);
  offset = writeInt32(view, offset, borderSize);
  offset = writeInt32(view, offset, heightData.length);
  for (const value of heightData) {
    offset = writeUint8(view, offset, value);
  }

  return new Uint8Array(buffer, 0, offset);
}

class W3dBinaryWriter {
  private readonly bytes: number[] = [];

  get offset(): number {
    return this.bytes.length;
  }

  writeUint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeUint16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }

  writeUint32(value: number): void {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  }

  writeInt32(value: number): void {
    this.writeUint32(value >>> 0);
  }

  writeFloat32(value: number): void {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value, true);
    this.writeBytes(new Uint8Array(buffer));
  }

  writeString(value: string, fixedLength: number): void {
    const encoded = new TextEncoder().encode(value);
    const limit = Math.min(encoded.length, fixedLength);
    for (let i = 0; i < limit; i++) {
      this.writeUint8(encoded[i]!);
    }
    for (let i = limit; i < fixedLength; i++) {
      this.writeUint8(0);
    }
  }

  writeBytes(data: Uint8Array): void {
    for (const byte of data) {
      this.writeUint8(byte);
    }
  }

  writeChunkHeader(type: number, hasSubChunks: boolean): number {
    this.writeUint32(type);
    const sizeOffset = this.offset;
    this.writeUint32(hasSubChunks ? 0x80000000 : 0);
    return sizeOffset;
  }

  patchChunkSize(sizeOffset: number, hasSubChunks: boolean): void {
    const dataSize = this.offset - sizeOffset - 4;
    const value = hasSubChunks ? ((dataSize | 0x80000000) >>> 0) : (dataSize >>> 0);
    this.bytes[sizeOffset] = value & 0xff;
    this.bytes[sizeOffset + 1] = (value >>> 8) & 0xff;
    this.bytes[sizeOffset + 2] = (value >>> 16) & 0xff;
    this.bytes[sizeOffset + 3] = (value >>> 24) & 0xff;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function buildMinimalW3dBinary(): Uint8Array {
  const chunkType = {
    mesh: 0x00000000,
    meshHeader3: 0x0000001f,
    vertices: 0x00000002,
    vertexNormals: 0x00000003,
    texcoords: 0x00000008,
    triangles: 0x00000020,
  } as const;

  const writer = new W3dBinaryWriter();
  const meshSizeOffset = writer.writeChunkHeader(chunkType.mesh, true);

  const headerSizeOffset = writer.writeChunkHeader(chunkType.meshHeader3, false);
  writer.writeUint32(0x00040002); // Version
  writer.writeUint32(0); // Attributes
  writer.writeString('SmokeMesh', 32);
  writer.writeString('SmokeContainer', 32);
  writer.writeUint32(1); // NumTris
  writer.writeUint32(3); // NumVertices
  writer.writeUint32(1); // NumMaterials
  writer.writeUint32(0); // NumDamageStages
  writer.writeInt32(0); // SortLevel
  writer.writeUint32(0); // PrelitVersion
  writer.writeUint32(0); // FutureCounts[1]
  writer.writeUint32(0); // VertexChannels
  writer.writeUint32(0); // FaceChannels
  writer.writeFloat32(0); writer.writeFloat32(0); writer.writeFloat32(0); // MinCorner
  writer.writeFloat32(1); writer.writeFloat32(1); writer.writeFloat32(0); // MaxCorner
  writer.writeFloat32(0.5); writer.writeFloat32(0.5); writer.writeFloat32(0); // SphCenter
  writer.writeFloat32(0.707); // SphRadius
  writer.patchChunkSize(headerSizeOffset, false);

  const verticesSizeOffset = writer.writeChunkHeader(chunkType.vertices, false);
  writer.writeFloat32(0); writer.writeFloat32(0); writer.writeFloat32(0);
  writer.writeFloat32(1); writer.writeFloat32(0); writer.writeFloat32(0);
  writer.writeFloat32(0); writer.writeFloat32(1); writer.writeFloat32(0);
  writer.patchChunkSize(verticesSizeOffset, false);

  const normalsSizeOffset = writer.writeChunkHeader(chunkType.vertexNormals, false);
  for (let i = 0; i < 3; i++) {
    writer.writeFloat32(0); writer.writeFloat32(0); writer.writeFloat32(1);
  }
  writer.patchChunkSize(normalsSizeOffset, false);

  const texcoordsSizeOffset = writer.writeChunkHeader(chunkType.texcoords, false);
  writer.writeFloat32(0); writer.writeFloat32(0);
  writer.writeFloat32(1); writer.writeFloat32(0);
  writer.writeFloat32(0); writer.writeFloat32(1);
  writer.patchChunkSize(texcoordsSizeOffset, false);

  const trianglesSizeOffset = writer.writeChunkHeader(chunkType.triangles, false);
  writer.writeUint32(0); writer.writeUint32(1); writer.writeUint32(2); // vindex[3]
  writer.writeUint32(0); // attributes
  writer.writeFloat32(0); writer.writeFloat32(0); writer.writeFloat32(1); // normal
  writer.writeFloat32(0); // dist
  writer.patchChunkSize(trianglesSizeOffset, false);

  writer.patchChunkSize(meshSizeOffset, true);
  return writer.toUint8Array();
}

describe('runtime asset path alignment', () => {
  it('keeps shared converter path constants internally consistent', () => {
    expect(APP_PUBLIC_ASSETS_DIR).toBe(join(APP_PUBLIC_DIR, RUNTIME_ASSET_BASE_URL));
    const expectedDisplayPath = `${relative(dirname(PROJECT_ROOT), APP_PUBLIC_ASSETS_DIR).replace(/\\/g, '/')}/`;
    expect(APP_PUBLIC_ASSETS_DISPLAY_PATH).toBe(expectedDisplayPath);
  });

  it('keeps runtime URL constants internally consistent', () => {
    expect(RUNTIME_MANIFEST_PUBLIC_PATH).toBe(`${RUNTIME_ASSET_BASE_URL}/${RUNTIME_MANIFEST_FILE}`);
  });

  it('uses the same app public directory in vite as converter defaults', () => {
    expect(viteConfig.publicDir).toBe(APP_PUBLIC_DIR);
  });

  it('keeps converter and vite path derivation independent from untracked config modules', () => {
    const convertAllSource = readFileSync(CONVERT_ALL_PATH, 'utf8');
    const viteConfigSource = readFileSync(VITE_CONFIG_PATH, 'utf8');

    expect(convertAllSource).toContain("const APP_PUBLIC_DIR = path.join(PROJECT_ROOT, 'packages', 'app', 'public');");
    expect(convertAllSource).toContain('const APP_PUBLIC_ASSETS_DIR = path.join(APP_PUBLIC_DIR, RUNTIME_ASSET_BASE_URL);');
    expect(convertAllSource).toContain("from '@generals/assets'");
    expect(convertAllSource).not.toContain('../config/asset-paths');
    expect(convertAllSource).not.toContain('packages/assets/src/types');

    expect(viteConfigSource).toContain("const APP_PUBLIC_DIR = resolve(__dirname, 'packages', 'app', 'public');");
    expect(viteConfigSource).toContain('publicDir: APP_PUBLIC_DIR');
    expect(viteConfigSource).not.toContain('config/asset-paths');
  });

  it('keeps converter manifest filename bound to shared runtime manifest constant', () => {
    const convertAllSource = readFileSync(CONVERT_ALL_PATH, 'utf8');
    expect(convertAllSource).toContain('const RUNTIME_MANIFEST_FILENAME = RUNTIME_MANIFEST_FILE;');
    expect(convertAllSource).toContain('const DEFAULT_OUTPUT_DIR = APP_PUBLIC_ASSETS_DIR;');
    expect(convertAllSource).toContain('Output directory (default: ${APP_PUBLIC_ASSETS_DISPLAY_PATH})');
  });

  it('keeps app runtime manifest loading contract strict and app-relative', () => {
    const appEntrySource = readFileSync(MAIN_TS_PATH, 'utf8');
    expect(appEntrySource).toContain('baseUrl: RUNTIME_ASSET_BASE_URL');
    expect(appEntrySource).toContain('manifestUrl: RUNTIME_MANIFEST_FILE');
    expect(appEntrySource).toContain('requireManifest: true');
    expect(appEntrySource).toContain('normalizeRuntimeAssetPath(mapPathParam)');
    expect(appEntrySource).toContain('if (mapPathParam !== null)');
    expect(appEntrySource).toContain('Requested map path "${mapPathParam}" is invalid after runtime normalization');
    expect(appEntrySource).toContain("new RegExp(`^${escapeRegExp(RUNTIME_ASSET_BASE_URL)}/`, 'i')");
    expect(appEntrySource).toContain("new RegExp(`^${escapeRegExp(RUNTIME_ASSET_BASE_URL)}$`, 'i')");
    expect(appEntrySource).toContain(".replace(/^(?:\\.\\/)+/, '')");
    expect(appEntrySource).not.toContain('replace(/^\\/?assets\\//,');
  });
});

describe('convert-all integration smoke', () => {
  it('documents app-served default output path in help text', () => {
    const result = runConvertAll(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(APP_PUBLIC_ASSETS_DISPLAY_PATH);
  });

  it('writes runtime manifest to app-served default output when --output is omitted', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const runtimeAssetsDir = APP_PUBLIC_ASSETS_DIR;
      const runtimeManifestPath = resolve(runtimeAssetsDir, RUNTIME_MANIFEST_FILE);
      const hadExistingRuntimeAssets = existsSync(runtimeAssetsDir);
      const backupRuntimeAssetsDir = resolve(
        dirname(runtimeAssetsDir),
        `${RUNTIME_ASSET_BASE_URL}.test-backup-${process.pid}-${Date.now()}`,
      );

      mkdirSync(gameDir, { recursive: true });

      if (hadExistingRuntimeAssets) {
        renameSync(runtimeAssetsDir, backupRuntimeAssetsDir);
      }

      try {
        const result = runConvertAll([
          '--game-dir',
          gameDir,
          '--only',
          'ini',
        ]);

        expect(result.status).toBe(0);
        expect(existsSync(runtimeManifestPath)).toBe(true);

        const runtimeManifest = JSON.parse(
          readFileSync(runtimeManifestPath, 'utf8'),
        ) as ConversionManifestSnapshot;
        expect(runtimeManifest.entryCount).toBe(0);
        expect(runtimeManifest.entries).toHaveLength(0);
      } finally {
        rmSync(runtimeAssetsDir, { recursive: true, force: true });
        if (hadExistingRuntimeAssets) {
          renameSync(backupRuntimeAssetsDir, runtimeAssetsDir);
        }
      }
    });
  });

  it('uses app-served default output when --output is omitted from outside project root', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const externalCwd = resolve(dir, 'external-cwd');
      const runtimeAssetsDir = APP_PUBLIC_ASSETS_DIR;
      const runtimeManifestPath = resolve(runtimeAssetsDir, RUNTIME_MANIFEST_FILE);
      const hadExistingRuntimeAssets = existsSync(runtimeAssetsDir);
      const backupRuntimeAssetsDir = resolve(
        dirname(runtimeAssetsDir),
        `${RUNTIME_ASSET_BASE_URL}.test-backup-${process.pid}-${Date.now()}-external-cwd`,
      );

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(externalCwd, { recursive: true });

      if (hadExistingRuntimeAssets) {
        renameSync(runtimeAssetsDir, backupRuntimeAssetsDir);
      }

      try {
        const result = runConvertAll([
          '--game-dir',
          gameDir,
          '--only',
          'ini',
        ], externalCwd);

        expect(result.status).toBe(0);
        expect(existsSync(runtimeManifestPath)).toBe(true);

        const runtimeManifest = JSON.parse(
          readFileSync(runtimeManifestPath, 'utf8'),
        ) as ConversionManifestSnapshot;
        expect(runtimeManifest.entryCount).toBe(0);
        expect(runtimeManifest.entries).toHaveLength(0);
      } finally {
        rmSync(runtimeAssetsDir, { recursive: true, force: true });
        if (hadExistingRuntimeAssets) {
          renameSync(backupRuntimeAssetsDir, runtimeAssetsDir);
        }
      }
    });
  });

  it('writes converted assets to app-served default output and loads them through AssetManager', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generals-convert-all-default-output-'));
    const gameDir = resolve(dir, 'game');
    const runtimeAssetsDir = APP_PUBLIC_ASSETS_DIR;
    const runtimeManifestPath = resolve(runtimeAssetsDir, RUNTIME_MANIFEST_FILE);
    const hadExistingRuntimeAssets = existsSync(runtimeAssetsDir);
    const backupRuntimeAssetsDir = resolve(
      dirname(runtimeAssetsDir),
      `${RUNTIME_ASSET_BASE_URL}.test-backup-${process.pid}-${Date.now()}`,
    );
    const textureSource = resolve(
      PROJECT_ROOT,
      '..',
      'Generals',
      'Code',
      'Libraries',
      'Source',
      'WWVegas',
      'WW3D2',
      'RequiredAssets',
      'MultProjectorGradient.tga',
    );

    mkdirSync(gameDir, { recursive: true });

    if (hadExistingRuntimeAssets) {
      renameSync(runtimeAssetsDir, backupRuntimeAssetsDir);
    }

    try {
      const extractedDir = resolve(runtimeAssetsDir, '_extracted');
      const gameMapDir = resolve(gameDir, 'maps');
      const dataIniDir = resolve(gameDir, 'Data', 'INI');

      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(resolve(extractedDir, 'models'), { recursive: true });
      mkdirSync(gameMapDir, { recursive: true });
      mkdirSync(dataIniDir, { recursive: true });

      copyFileSync(textureSource, resolve(extractedDir, 'textures', 'MultProjectorGradient.tga'));
      writeFileSync(resolve(extractedDir, 'models', 'SmokeMesh.w3d'), buildMinimalW3dBinary());
      writeFileSync(resolve(gameMapDir, 'SmokeTest.map'), buildMinimalMapBinary());
      writeFileSync(resolve(dataIniDir, 'RuntimeObject.ini'), `Object RuntimeTank
  Side = America
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--only',
        'ini,map,texture,w3d',
      ]);

      expect(result.status).toBe(0);
      expect(existsSync(runtimeManifestPath)).toBe(true);
      expect(existsSync(resolve(runtimeAssetsDir, 'data', 'ini-bundle.json'))).toBe(true);
      expect(existsSync(resolve(runtimeAssetsDir, 'maps', 'SmokeTest.json'))).toBe(true);
      expect(existsSync(resolve(runtimeAssetsDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(true);
      expect(existsSync(resolve(runtimeAssetsDir, 'models', 'SmokeMesh.glb'))).toBe(true);

      const runtimeManifestText = readFileSync(runtimeManifestPath, 'utf8');
      const runtimeManifest = JSON.parse(runtimeManifestText) as ConversionManifestSnapshot;
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'data/ini-bundle.json')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'maps/SmokeTest.json')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'models/SmokeMesh.glb')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith(`${RUNTIME_ASSET_BASE_URL}/`))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('/'))).toBe(false);

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

        if (url === `${RUNTIME_ASSET_BASE_URL}/${RUNTIME_MANIFEST_FILE}`) {
          return new Response(runtimeManifestText, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.startsWith(`${RUNTIME_ASSET_BASE_URL}/`)) {
          const runtimePath = url.slice(`${RUNTIME_ASSET_BASE_URL}/`.length);
          const absoluteAssetPath = resolve(runtimeAssetsDir, runtimePath);
          if (!existsSync(absoluteAssetPath)) {
            return new Response('', { status: 404 });
          }
          const data = readFileSync(absoluteAssetPath);
          return new Response(data, {
            status: 200,
            headers: { 'content-length': String(data.byteLength) },
          });
        }

        return new Response('', { status: 404 });
      });

      globalThis.fetch = fetchMock as typeof fetch;
      const assets = new AssetManager({
        baseUrl: RUNTIME_ASSET_BASE_URL,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        requireManifest: true,
        cacheEnabled: false,
        integrityChecks: true,
      });

      try {
        const outputHashByPath = new Map(
          runtimeManifest.entries.map((entry) => [entry.outputPath, entry.outputHash]),
        );

        await assets.init();
        const iniBundle = await assets.loadJSON('data/ini-bundle.json');
        const mapData = await assets.loadJSON('maps/SmokeTest.json');
        const textureData = await assets.loadArrayBuffer('textures/MultProjectorGradient.rgba');
        const modelData = await assets.loadArrayBuffer('models/SmokeMesh.glb');

        expect(iniBundle.path).toBe('data/ini-bundle.json');
        expect(mapData.path).toBe('maps/SmokeTest.json');
        expect(textureData.path).toBe('textures/MultProjectorGradient.rgba');
        expect(modelData.path).toBe('models/SmokeMesh.glb');

        expect(iniBundle.hash).toBe(outputHashByPath.get('data/ini-bundle.json'));
        expect(mapData.hash).toBe(outputHashByPath.get('maps/SmokeTest.json'));
        expect(textureData.hash).toBe(outputHashByPath.get('textures/MultProjectorGradient.rgba'));
        expect(modelData.hash).toBe(outputHashByPath.get('models/SmokeMesh.glb'));
      } finally {
        assets.dispose();
        globalThis.fetch = originalFetch;
      }
    } finally {
      rmSync(runtimeAssetsDir, { recursive: true, force: true });
      if (hadExistingRuntimeAssets) {
        renameSync(backupRuntimeAssetsDir, runtimeAssetsDir);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes legacy runtime manifest entries that include runtime base prefixes', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyTexturePath = resolve(outputDir, 'textures', 'Legacy.rgba');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);
      const runtimePrefix = `${RUNTIME_ASSET_BASE_URL}/`;

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(dirname(legacyTexturePath), { recursive: true });
      writeFileSync(legacyTexturePath, Uint8Array.from([1, 2, 3, 4]));
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 1,
          entries: [
            {
              sourcePath: './game/Data/INI/Legacy.ini',
              sourceHash: 'legacy-source-hash',
              outputPath: `${runtimePrefix}textures/Legacy.rgba`,
              outputHash: 'legacy-output-hash',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Conversion complete');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      const legacyEntry = runtimeManifest.entries.find((entry) => entry.converter === 'texture-converter');
      expect(legacyEntry).toBeDefined();
      expect(legacyEntry?.outputPath).toBe('textures/Legacy.rgba');
      expect(legacyEntry?.sourcePath).toBe('game/Data/INI/Legacy.ini');
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith(runtimePrefix))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('/'))).toBe(false);
    });
  });

  it('normalizes legacy runtime manifest entries with mixed-case runtime base prefixes', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyTexturePath = resolve(outputDir, 'textures', 'LegacyMixed.rgba');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(dirname(legacyTexturePath), { recursive: true });
      writeFileSync(legacyTexturePath, Uint8Array.from([7, 6, 5, 4]));
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 1,
          entries: [
            {
              sourcePath: './game/Data/INI/LegacyMixed.ini',
              sourceHash: 'legacy-source-hash',
              outputPath: 'Assets/textures/LegacyMixed.rgba',
              outputHash: 'legacy-output-hash',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Conversion complete');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      const legacyEntry = runtimeManifest.entries.find((entry) => entry.converter === 'texture-converter');
      expect(legacyEntry).toBeDefined();
      expect(legacyEntry?.outputPath).toBe('textures/LegacyMixed.rgba');
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('assets/'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('Assets/'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('/'))).toBe(false);
    });
  });

  it('drops legacy runtime manifest entries whose outputPath equals runtime base segment', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const validTexturePath = resolve(outputDir, 'textures', 'LegacyValid.rgba');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(dirname(validTexturePath), { recursive: true });
      writeFileSync(validTexturePath, Uint8Array.from([4, 3, 2, 1]));
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 2,
          entries: [
            {
              sourcePath: 'game/Data/INI/InvalidBase.ini',
              sourceHash: 'legacy-source-hash-invalid',
              outputPath: 'Assets',
              outputHash: 'legacy-output-hash-invalid',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
            {
              sourcePath: 'game/Data/INI/LegacyValid.ini',
              sourceHash: 'legacy-source-hash-valid',
              outputPath: 'textures/LegacyValid.rgba',
              outputHash: 'legacy-output-hash-valid',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Normalized existing manifest');
      expect(result.stderr).toContain('dropped: 1');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      const textureEntries = runtimeManifest.entries.filter((entry) => entry.converter === 'texture-converter');
      expect(textureEntries).toHaveLength(1);
      expect(textureEntries[0]?.outputPath).toBe('textures/LegacyValid.rgba');
      expect(
        runtimeManifest.entries.some(
          (entry) => entry.outputPath.toLowerCase() === RUNTIME_ASSET_BASE_URL,
        ),
      ).toBe(false);
    });
  });

  it('drops invalid legacy manifest entries and deduplicates colliding output paths', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyTexturePath = resolve(outputDir, 'textures', 'Legacy.rgba');
      const invalidSourceTexturePath = resolve(outputDir, 'textures', 'InvalidSource.rgba');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(dirname(legacyTexturePath), { recursive: true });
      writeFileSync(legacyTexturePath, Uint8Array.from([1, 2, 3, 4]));
      writeFileSync(invalidSourceTexturePath, Uint8Array.from([5, 6, 7, 8]));
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 4,
          entries: [
            {
              sourcePath: './game/Data/INI/LegacyA.ini',
              sourceHash: 'legacy-source-hash-a',
              outputPath: `${RUNTIME_ASSET_BASE_URL}/textures/Legacy.rgba`,
              outputHash: 'legacy-output-hash-a',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
            {
              sourcePath: './game/Data/INI/LegacyB.ini',
              sourceHash: 'legacy-source-hash-b',
              outputPath: 'textures/Legacy.rgba',
              outputHash: 'legacy-output-hash-b',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
            {
              sourcePath: './game/Data/INI/Invalid.ini',
              sourceHash: 'legacy-source-hash-c',
              outputPath: '../textures/Invalid.rgba',
              outputHash: 'legacy-output-hash-c',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
            {
              sourcePath: '../game/Data/INI/InvalidSource.ini',
              sourceHash: 'legacy-source-hash-d',
              outputPath: 'textures/InvalidSource.rgba',
              outputHash: 'legacy-output-hash-d',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Normalized existing manifest');
      expect(result.stderr).toContain('dropped: 2');
      expect(result.stderr).toContain('deduped: 1');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      const textureEntries = runtimeManifest.entries.filter((entry) => entry.converter === 'texture-converter');
      expect(textureEntries).toHaveLength(1);
      expect(textureEntries[0]?.outputPath).toBe('textures/Legacy.rgba');
      expect(textureEntries[0]?.sourcePath).toBe('game/Data/INI/LegacyB.ini');
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('Invalid.rgba'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('InvalidSource.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('assets/'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('../'))).toBe(false);
    });
  });

  it('normalizes windows-style legacy manifest separators for source/output paths', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyTexturePath = resolve(outputDir, 'textures', 'Legacy.rgba');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(dirname(legacyTexturePath), { recursive: true });
      writeFileSync(legacyTexturePath, Uint8Array.from([9, 8, 7, 6]));
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 1,
          entries: [
            {
              sourcePath: '.\\game\\Data\\INI\\Legacy.ini',
              sourceHash: 'legacy-source-hash',
              outputPath: 'assets\\textures\\Legacy.rgba',
              outputHash: 'legacy-output-hash',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Normalized existing manifest');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      const textureEntry = runtimeManifest.entries.find((entry) => entry.converter === 'texture-converter');
      expect(textureEntry).toBeDefined();
      expect(textureEntry?.sourcePath).toBe('game/Data/INI/Legacy.ini');
      expect(textureEntry?.outputPath).toBe('textures/Legacy.rgba');
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('\\'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('\\'))).toBe(false);
    });
  });

  it('normalizes repeated leading dot segments in legacy manifest source/output paths', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyTexturePath = resolve(outputDir, 'textures', 'LegacyDot.rgba');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(dirname(legacyTexturePath), { recursive: true });
      writeFileSync(legacyTexturePath, Uint8Array.from([2, 4, 6, 8]));
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 1,
          entries: [
            {
              sourcePath: '././game/Data/INI/LegacyDot.ini',
              sourceHash: 'legacy-source-hash',
              outputPath: '././assets/textures/LegacyDot.rgba',
              outputHash: 'legacy-output-hash',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Normalized existing manifest');
      expect(result.stderr).toContain('rewritten: 1');
      expect(result.stderr).toContain('dropped: 0');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      const textureEntry = runtimeManifest.entries.find((entry) => entry.converter === 'texture-converter');
      expect(textureEntry).toBeDefined();
      expect(textureEntry?.sourcePath).toBe('game/Data/INI/LegacyDot.ini');
      expect(textureEntry?.outputPath).toBe('textures/LegacyDot.rgba');
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('./'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.startsWith('./'))).toBe(false);
    });
  });

  it('drops legacy manifest entries with windows drive absolute paths', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 2,
          entries: [
            {
              sourcePath: 'game/Data/INI/LegacyA.ini',
              sourceHash: 'legacy-source-hash-a',
              outputPath: 'C:/converted/textures/LegacyA.rgba',
              outputHash: 'legacy-output-hash-a',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
            {
              sourcePath: 'C:/game/Data/INI/LegacyB.ini',
              sourceHash: 'legacy-source-hash-b',
              outputPath: 'textures/LegacyB.rgba',
              outputHash: 'legacy-output-hash-b',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Normalized existing manifest');
      expect(result.stderr).toContain('dropped: 2');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries).toHaveLength(0);
    });
  });

  it('drops legacy manifest entries with URL absolute paths', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
          version: 1,
          generatedAt: '2026-02-16T00:00:00.000Z',
          entryCount: 2,
          entries: [
            {
              sourcePath: 'game/Data/INI/LegacyA.ini',
              sourceHash: 'legacy-source-hash-a',
              outputPath: 'https://cdn.example.com/textures/LegacyA.rgba',
              outputHash: 'legacy-output-hash-a',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
            {
              sourcePath: 'https://cdn.example.com/game/Data/INI/LegacyB.ini',
              sourceHash: 'legacy-source-hash-b',
              outputPath: 'textures/LegacyB.rgba',
              outputHash: 'legacy-output-hash-b',
              converter: 'texture-converter',
              converterVersion: '1.0.0',
              timestamp: '2026-02-16T00:00:00.000Z',
            },
          ],
        }, null, 2),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('Normalized existing manifest');
      expect(result.stderr).toContain('dropped: 2');

      const runtimeManifest = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries).toHaveLength(0);
    });
  });

  it('fails fast on unknown --only step names', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      mkdirSync(gameDir, { recursive: true });

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'texture,unknown-step',
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unknown step');
      expect(existsSync(resolve(outputDir, RUNTIME_MANIFEST_FILE))).toBe(false);
    });
  });

  it('parses INI inputs in ini-only mode', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sampleIni = resolve(gameDir, 'data', 'sample.ini');
      mkdirSync(resolve(gameDir, 'data'), { recursive: true });
      writeFileSync(sampleIni, `Object Tank
  Side = America
End

AI
  AttackUsesLineOfSight = no
  SkirmishBaseDefenseExtraDistance = 37.5
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      const gameBundle = JSON.parse(
        readFileSync(resolve(outputDir, 'data', 'bundle-game.json'), 'utf8',
      ));
      expect(gameBundle.ai?.attackUsesLineOfSight).toBe(false);
      expect(gameBundle.ai?.skirmishBaseDefenseExtraDistance).toBeCloseTo(37.5);

      const runtimeManifestText = readFileSync(
        resolve(outputDir, RUNTIME_MANIFEST_FILE),
        'utf8',
      );
      const runtimeManifest = JSON.parse(runtimeManifestText) as ConversionManifestSnapshot;

      expect(runtimeManifest.version).toBe(1);
      expect(runtimeManifest.entryCount).toBe(2);
      expect(runtimeManifest.entries).toHaveLength(2);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('sample.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'data/ini-bundle.json')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('game/data/sample.ini'))).toBe(true);
      expect(runtimeManifest.entries.every((entry) => entry.sourceHash.length === 64)).toBe(true);
      expect(runtimeManifest.entries.every((entry) => !entry.outputPath.startsWith('..'))).toBe(true);
      expect(runtimeManifest.entries.every((entry) => !entry.outputPath.startsWith('/'))).toBe(true);


      const bundleText = readFileSync(
        resolve(outputDir, 'data', 'ini-bundle.json'),
        'utf8',
      );
      const bundle = JSON.parse(bundleText) as {
        objects: unknown[];
        weapons: unknown[];
        stats: { objects: number; weapons: number };
        ai?: { attackUsesLineOfSight?: boolean; skirmishBaseDefenseExtraDistance?: number };
      };
      expect(bundle.objects).toHaveLength(1);
      expect(bundle.stats.objects).toBe(1);
      expect(bundle.stats.weapons).toBe(0);
      expect(bundle.ai?.attackUsesLineOfSight).toBe(false);
      expect(bundle.ai?.skirmishBaseDefenseExtraDistance).toBeCloseTo(37.5);
    });
  });

  it('resolves INI manifest paths correctly when launched outside project root', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runDir = resolve(dir, 'runner');
      mkdirSync(runDir, { recursive: true });
      mkdirSync(resolve(gameDir, 'data'), { recursive: true });
      writeFileSync(resolve(gameDir, 'data', 'sample.ini'), `Object Tank
  Side = America
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ], runDir);

      expect(result.status).toBe(0);

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('sample.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'data/ini-bundle.json')).toBe(true);
    });
  });

  it('skips tool-only INI trees for source checkouts without runtime Data/INI', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const toolOnlyIni = resolve(
        gameDir,
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'Dazzle.INI',
      );

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(dirname(toolOnlyIni), { recursive: true });
      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(toolOnlyIni, '[ToolOnly]\nValue = 1\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entryCount).toBe(0);
      expect(runtimeManifest.entries).toHaveLength(0);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(false);
    });
  });

  it('does not scan the entire game dir when no runtime INI roots exist', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const rootIni = resolve(gameDir, 'RootOnly.ini');

      mkdirSync(gameDir, { recursive: true });
      writeFileSync(rootIni, `Object RootOnlyTank
  Side = America
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entryCount).toBe(0);
      expect(runtimeManifest.entries).toHaveLength(0);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(false);
      expect(existsSync(resolve(outputDir, 'RootOnly.json'))).toBe(false);
    });
  });

  it('uses Data/INI for source checkouts when present and ignores tool-only ini files', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const toolOnlyIni = resolve(
        gameDir,
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'Dazzle.INI',
      );

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });
      mkdirSync(dirname(toolOnlyIni), { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);
      writeFileSync(toolOnlyIni, '[ToolOnly]\nValue = 1\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Data/INI');
      expect(result.stdout).not.toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Dazzle.INI'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(true);
    });
  });

  it('resolves Data/INI include paths against the game root base directory', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runtimeIniDir = resolve(gameDir, 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const includedIni = resolve(runtimeIniDir, 'IncludedRuntime.ini');

      mkdirSync(runtimeIniDir, { recursive: true });

      writeFileSync(runtimeIni, `#include "Data/INI/IncludedRuntime.ini"
Object RuntimeTank
  Side = America
End
`);
      writeFileSync(includedIni, `Object IncludedTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Data/INI');
      expect(result.stdout).not.toContain('#include file not found');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('game/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('game/Data/INI/IncludedRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('IncludedRuntime.json'))).toBe(true);
    });
  });

  it('prefers Data/INI over Run/Data/INI when both runtime roots exist', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const dataRuntimeIniDir = resolve(gameDir, 'Data', 'INI');
      const runRuntimeIniDir = resolve(gameDir, 'Run', 'Data', 'INI');
      const dataRuntimeIni = resolve(dataRuntimeIniDir, 'DataRootRuntime.ini');
      const runRuntimeIni = resolve(runRuntimeIniDir, 'RunRootRuntime.ini');

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(dataRuntimeIniDir, { recursive: true });
      mkdirSync(runRuntimeIniDir, { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(dataRuntimeIni, `Object DataRootTank
  Side = America
End
`);
      // If Run/Data/INI were incorrectly selected, this would show up in runtime manifest output.
      writeFileSync(runRuntimeIni, `Object RunRootTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Data/INI');
      expect(result.stdout).not.toContain('Using runtime INI root: Run/Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('DataRootRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RunRootRuntime.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('DataRootRuntime.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RunRootRuntime.json'))).toBe(false);
    });
  });

  it('uses Run/Data/INI for source checkouts when root Data/INI is absent', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const toolOnlyIni = resolve(
        gameDir,
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'Dazzle.INI',
      );

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });
      mkdirSync(dirname(toolOnlyIni), { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);
      writeFileSync(toolOnlyIni, '[ToolOnly]\nValue = 1\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Run/Data/INI');
      expect(result.stdout).not.toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Run/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Dazzle.INI'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(true);
    });
  });

  it('prefers Run/Data/INI over GeneralsMD/Run/Data/INI when both roots exist and Data/INI is absent', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const zhSourceTreeMarker = resolve(gameDir, 'GeneralsMD', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runRuntimeIniDir = resolve(gameDir, 'Run', 'Data', 'INI');
      const zhRuntimeIniDir = resolve(gameDir, 'GeneralsMD', 'Run', 'Data', 'INI');
      const runRuntimeIni = resolve(runRuntimeIniDir, 'RunRootRuntime.ini');
      const zhRuntimeIni = resolve(zhRuntimeIniDir, 'ZhRootRuntime.ini');

      mkdirSync(dirname(zhSourceTreeMarker), { recursive: true });
      mkdirSync(runRuntimeIniDir, { recursive: true });
      mkdirSync(zhRuntimeIniDir, { recursive: true });

      writeFileSync(zhSourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runRuntimeIni, `Object RunRootTank
  Side = America
End
`);
      writeFileSync(zhRuntimeIni, `Object ZhRootTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Run/Data/INI');
      expect(result.stdout).not.toContain('Using runtime INI root: GeneralsMD/Run/Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RunRootRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('ZhRootRuntime.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RunRootRuntime.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('ZhRootRuntime.json'))).toBe(false);
    });
  });

  it('prefers Run/Data/INI over Generals/Run/Data/INI when both roots exist and Data/INI is absent', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const generalsSourceTreeMarker = resolve(gameDir, 'Generals', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runRuntimeIniDir = resolve(gameDir, 'Run', 'Data', 'INI');
      const generalsRuntimeIniDir = resolve(gameDir, 'Generals', 'Run', 'Data', 'INI');
      const runRuntimeIni = resolve(runRuntimeIniDir, 'RunRootRuntime.ini');
      const generalsRuntimeIni = resolve(generalsRuntimeIniDir, 'GeneralsRootRuntime.ini');

      mkdirSync(dirname(generalsSourceTreeMarker), { recursive: true });
      mkdirSync(runRuntimeIniDir, { recursive: true });
      mkdirSync(generalsRuntimeIniDir, { recursive: true });

      writeFileSync(generalsSourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runRuntimeIni, `Object RunRootTank
  Side = America
End
`);
      writeFileSync(generalsRuntimeIni, `Object GeneralsRootTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Run/Data/INI');
      expect(result.stdout).not.toContain('Using runtime INI root: Generals/Run/Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RunRootRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('GeneralsRootRuntime.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RunRootRuntime.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('GeneralsRootRuntime.json'))).toBe(false);
    });
  });

  it('uses GeneralsMD/Run/Data/INI for source-root checkouts when top-level runtime roots are absent', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'GeneralsMD', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'GeneralsMD', 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const toolOnlyIni = resolve(
        gameDir,
        'GeneralsMD',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'Dazzle.INI',
      );

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });
      mkdirSync(dirname(toolOnlyIni), { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);
      writeFileSync(toolOnlyIni, '[ToolOnly]\nValue = 1\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: GeneralsMD/Run/Data/INI');
      expect(result.stdout).not.toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('GeneralsMD/Run/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Dazzle.INI'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(true);
    });
  });

  it('resolves GeneralsMD/Run/Data/INI include paths against the GeneralsMD/Run base directory', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'GeneralsMD', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'GeneralsMD', 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const includedIni = resolve(runtimeIniDir, 'IncludedRuntime.ini');

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `#include "Data/INI/IncludedRuntime.ini"
Object RuntimeTank
  Side = America
End
`);
      writeFileSync(includedIni, `Object IncludedTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: GeneralsMD/Run/Data/INI');
      expect(result.stdout).not.toContain('#include file not found');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('GeneralsMD/Run/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('GeneralsMD/Run/Data/INI/IncludedRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('IncludedRuntime.json'))).toBe(true);
    });
  });

  it('uses Generals/Run/Data/INI for source-root checkouts when top-level runtime roots are absent', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Generals', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'Generals', 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const toolOnlyIni = resolve(
        gameDir,
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'Dazzle.INI',
      );

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });
      mkdirSync(dirname(toolOnlyIni), { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);
      writeFileSync(toolOnlyIni, '[ToolOnly]\nValue = 1\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Generals/Run/Data/INI');
      expect(result.stdout).not.toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Generals/Run/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Dazzle.INI'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(true);
    });
  });

  it('resolves Generals/Run/Data/INI include paths against the Generals/Run base directory', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Generals', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'Generals', 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const includedIni = resolve(runtimeIniDir, 'IncludedRuntime.ini');

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `#include "Data/INI/IncludedRuntime.ini"
Object RuntimeTank
  Side = America
End
`);
      writeFileSync(includedIni, `Object IncludedTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Generals/Run/Data/INI');
      expect(result.stdout).not.toContain('#include file not found');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Generals/Run/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Generals/Run/Data/INI/IncludedRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('IncludedRuntime.json'))).toBe(true);
    });
  });

  it('ignores Generals/Run/Data/INI without Generals source marker', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runtimeIniDir = resolve(gameDir, 'Generals', 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');

      mkdirSync(runtimeIniDir, { recursive: true });
      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('skipping game-dir INI parse');
      expect(result.stdout).not.toContain('Using runtime INI root: Generals/Run/Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RuntimeObject.ini'))).toBe(false);
      expect(runtimeManifest.entryCount).toBe(0);
    });
  });

  it('ignores GeneralsMD/Run/Data/INI without GeneralsMD source marker', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runtimeIniDir = resolve(gameDir, 'GeneralsMD', 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');

      mkdirSync(runtimeIniDir, { recursive: true });
      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('skipping game-dir INI parse');
      expect(result.stdout).not.toContain('Using runtime INI root: GeneralsMD/Run/Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RuntimeObject.ini'))).toBe(false);
      expect(runtimeManifest.entryCount).toBe(0);
    });
  });

  it('prefers GeneralsMD/Run/Data/INI over Generals/Run/Data/INI when both source roots exist', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const zhSourceTreeMarker = resolve(gameDir, 'GeneralsMD', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const generalsSourceTreeMarker = resolve(gameDir, 'Generals', 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const zhRuntimeIniDir = resolve(gameDir, 'GeneralsMD', 'Run', 'Data', 'INI');
      const generalsRuntimeIniDir = resolve(gameDir, 'Generals', 'Run', 'Data', 'INI');
      const zhRuntimeIni = resolve(zhRuntimeIniDir, 'ZhRuntimeObject.ini');
      const generalsRuntimeIni = resolve(generalsRuntimeIniDir, 'GeneralsRuntimeObject.ini');

      mkdirSync(dirname(zhSourceTreeMarker), { recursive: true });
      mkdirSync(dirname(generalsSourceTreeMarker), { recursive: true });
      mkdirSync(zhRuntimeIniDir, { recursive: true });
      mkdirSync(generalsRuntimeIniDir, { recursive: true });

      writeFileSync(zhSourceTreeMarker, '// source checkout marker\n');
      writeFileSync(generalsSourceTreeMarker, '// source checkout marker\n');
      writeFileSync(zhRuntimeIni, `Object ZeroHourRuntimeTank
  Side = America
End
`);
      writeFileSync(generalsRuntimeIni, `Object GeneralsRuntimeTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: GeneralsMD/Run/Data/INI');
      expect(result.stdout).not.toContain('Using runtime INI root: Generals/Run/Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('ZhRuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('GeneralsRuntimeObject.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('ZhRuntimeObject.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('GeneralsRuntimeObject.json'))).toBe(false);
    });
  });

  it('resolves Run/Data/INI include paths against the Run base directory', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const runtimeIniDir = resolve(gameDir, 'Run', 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const includedIni = resolve(runtimeIniDir, 'IncludedRuntime.ini');

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(runtimeIniDir, { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(runtimeIni, `#include "Data/INI/IncludedRuntime.ini"
Object RuntimeTank
  Side = America
End
`);
      writeFileSync(includedIni, `Object IncludedTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Run/Data/INI');
      expect(result.stdout).not.toContain('#include file not found');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Run/Data/INI/RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Run/Data/INI/IncludedRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('IncludedRuntime.json'))).toBe(true);
    });
  });

  it('prefers Data/INI runtime root and ignores unrelated ini files elsewhere in game dir', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const runtimeIniDir = resolve(gameDir, 'Data', 'INI');
      const runtimeIni = resolve(runtimeIniDir, 'RuntimeObject.ini');
      const unrelatedIni = resolve(gameDir, 'Tools', 'NotRuntime.ini');

      mkdirSync(runtimeIniDir, { recursive: true });
      mkdirSync(dirname(unrelatedIni), { recursive: true });

      writeFileSync(runtimeIni, `Object RuntimeTank
  Side = America
End
`);
      // If this file were parsed it would emit parse errors and fail the CLI.
      writeFileSync(unrelatedIni, '[ToolOnly]\nFoo = Bar\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: Data/INI');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('RuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('NotRuntime.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('RuntimeObject.json'))).toBe(true);
    });
  });

  it('falls back to legacy data runtime root and ignores non-runtime ini files outside data', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyRuntimeIniDir = resolve(gameDir, 'data');
      const legacyRuntimeIni = resolve(legacyRuntimeIniDir, 'LegacyRuntimeObject.ini');
      const unrelatedIni = resolve(gameDir, 'Tools', 'NotRuntime.ini');

      mkdirSync(legacyRuntimeIniDir, { recursive: true });
      mkdirSync(dirname(unrelatedIni), { recursive: true });

      writeFileSync(legacyRuntimeIni, `Object LegacyRuntimeTank
  Side = America
End
`);
      // If this file were parsed it would emit parse errors and fail the CLI.
      writeFileSync(unrelatedIni, '[ToolOnly]\nFoo = Bar\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: data');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('LegacyRuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('NotRuntime.ini'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('LegacyRuntimeObject.json'))).toBe(true);
    });
  });

  it('resolves data include paths against the game root base directory', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const legacyRuntimeIniDir = resolve(gameDir, 'data');
      const runtimeIni = resolve(legacyRuntimeIniDir, 'LegacyRuntimeObject.ini');
      const includedIni = resolve(legacyRuntimeIniDir, 'IncludedRuntime.ini');

      mkdirSync(legacyRuntimeIniDir, { recursive: true });

      writeFileSync(runtimeIni, `#include "data/IncludedRuntime.ini"
Object LegacyRuntimeTank
  Side = America
End
`);
      writeFileSync(includedIni, `Object IncludedLegacyTank
  Side = China
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: data');
      expect(result.stdout).not.toContain('#include file not found');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('game/data/LegacyRuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('game/data/IncludedRuntime.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('LegacyRuntimeObject.json'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('IncludedRuntime.json'))).toBe(true);
    });
  });

  it('uses legacy data runtime root for source checkouts when Data/INI and Run/Data/INI are absent', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const sourceTreeMarker = resolve(gameDir, 'Code', 'GameEngine', 'Source', 'Common', 'GameEngine.cpp');
      const legacyRuntimeIniDir = resolve(gameDir, 'data');
      const legacyRuntimeIni = resolve(legacyRuntimeIniDir, 'LegacyRuntimeObject.ini');
      const toolOnlyIni = resolve(
        gameDir,
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'Dazzle.INI',
      );

      mkdirSync(dirname(sourceTreeMarker), { recursive: true });
      mkdirSync(legacyRuntimeIniDir, { recursive: true });
      mkdirSync(dirname(toolOnlyIni), { recursive: true });

      writeFileSync(sourceTreeMarker, '// source checkout marker\n');
      writeFileSync(legacyRuntimeIni, `Object LegacyRuntimeTank
  Side = America
End
`);
      writeFileSync(toolOnlyIni, '[ToolOnly]\nValue = 1\n');

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Using runtime INI root: data');
      expect(result.stdout).not.toContain('skipping game-dir INI parse');

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('LegacyRuntimeObject.ini'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.sourcePath.includes('Dazzle.INI'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('LegacyRuntimeObject.json'))).toBe(true);
    });
  });

  it('records map/texture/w3d outputs in unified runtime manifest', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted');

      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );
      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(resolve(extractedDir, 'models'), { recursive: true });
      mkdirSync(resolve(gameDir, 'maps'), { recursive: true });

      copyFileSync(textureSource, resolve(extractedDir, 'textures', 'MultProjectorGradient.tga'));
      writeFileSync(resolve(extractedDir, 'models', 'SmokeMesh.w3d'), buildMinimalW3dBinary());
      writeFileSync(resolve(gameDir, 'maps', 'SmokeTest.map'), buildMinimalMapBinary());

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'texture,w3d,map',
      ]);

      expect(result.status).toBe(0);

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;

      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'models/SmokeMesh.glb')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath === 'maps/SmokeTest.json')).toBe(true);
      expect(runtimeManifest.entries.every((entry) => entry.outputPath.length > 0)).toBe(true);
      expect(runtimeManifest.entries.every((entry) => !entry.outputPath.startsWith('..'))).toBe(true);
      expect(runtimeManifest.entries.every((entry) => !entry.outputPath.startsWith('/'))).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('textures/textures'))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.includes('models/models'))).toBe(false);
    });
  });

  it('loads converted runtime assets through AssetManager using app runtime URLs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generals-convert-all-runtime-contract-'));
    try {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted');
      const dataIniDir = resolve(gameDir, 'Data', 'INI');
      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );

      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(resolve(extractedDir, 'models'), { recursive: true });
      mkdirSync(resolve(gameDir, 'maps'), { recursive: true });
      mkdirSync(dataIniDir, { recursive: true });

      copyFileSync(textureSource, resolve(extractedDir, 'textures', 'MultProjectorGradient.tga'));
      writeFileSync(resolve(extractedDir, 'models', 'SmokeMesh.w3d'), buildMinimalW3dBinary());
      writeFileSync(resolve(gameDir, 'maps', 'SmokeTest.map'), buildMinimalMapBinary());
      writeFileSync(resolve(dataIniDir, 'RuntimeObject.ini'), `Object RuntimeTank
  Side = America
End
`);

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini,texture,w3d,map',
      ]);
      expect(result.status).toBe(0);

      const runtimeManifestPath = resolve(outputDir, RUNTIME_MANIFEST_FILE);
      const runtimeManifestText = readFileSync(runtimeManifestPath, 'utf8');
      const runtimeManifest = JSON.parse(runtimeManifestText) as ConversionManifestSnapshot;
      const outputHashByPath = new Map(
        runtimeManifest.entries.map((entry) => [entry.outputPath, entry.outputHash]),
      );
      const converters = new Set(runtimeManifest.entries.map((entry) => entry.converter));

      expect(converters.has('ini-parser')).toBe(true);
      expect(converters.has('map-converter')).toBe(true);
      expect(converters.has('texture-converter')).toBe(true);
      expect(converters.has('w3d-converter')).toBe(true);
      expect(converters.has('convert-all')).toBe(true);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith(`${RUNTIME_ASSET_BASE_URL}/`))).toBe(false);
      expect(runtimeManifest.entries.some((entry) => entry.outputPath.startsWith('/'))).toBe(false);

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

        if (url === `${RUNTIME_ASSET_BASE_URL}/${RUNTIME_MANIFEST_FILE}`) {
          return new Response(runtimeManifestText, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.startsWith(`${RUNTIME_ASSET_BASE_URL}/`)) {
          const runtimePath = url.slice(`${RUNTIME_ASSET_BASE_URL}/`.length);
          const absoluteAssetPath = resolve(outputDir, runtimePath);
          if (!existsSync(absoluteAssetPath)) {
            return new Response('', { status: 404 });
          }
          return new Response(readFileSync(absoluteAssetPath), {
            status: 200,
            headers: { 'content-length': String(readFileSync(absoluteAssetPath).byteLength) },
          });
        }

        return new Response('', { status: 404 });
      });

      globalThis.fetch = fetchMock as typeof fetch;
      const assets = new AssetManager({
        baseUrl: RUNTIME_ASSET_BASE_URL,
        manifestUrl: RUNTIME_MANIFEST_FILE,
        requireManifest: true,
        cacheEnabled: false,
        integrityChecks: true,
      });

      try {
        await assets.init();

        const iniBundle = await assets.loadJSON('data/ini-bundle.json');
        const mapData = await assets.loadJSON(`${RUNTIME_ASSET_BASE_URL}/maps/SmokeTest.json`);
        const mixedCaseMapData = await assets.loadJSON(
          `${RUNTIME_ASSET_BASE_URL.toUpperCase()}/maps/SmokeTest.json`,
        );
        const textureData = await assets.loadArrayBuffer('textures/MultProjectorGradient.rgba');
        const modelData = await assets.loadArrayBuffer('models/SmokeMesh.glb');

        expect(iniBundle.path).toBe('data/ini-bundle.json');
        expect(mapData.path).toBe('maps/SmokeTest.json');
        expect(mixedCaseMapData.path).toBe('maps/SmokeTest.json');
        expect(textureData.path).toBe('textures/MultProjectorGradient.rgba');
        expect(modelData.path).toBe('models/SmokeMesh.glb');

        expect(iniBundle.hash).toBe(outputHashByPath.get('data/ini-bundle.json'));
        expect(mapData.hash).toBe(outputHashByPath.get('maps/SmokeTest.json'));
        expect(mixedCaseMapData.hash).toBe(outputHashByPath.get('maps/SmokeTest.json'));
        expect(textureData.hash).toBe(outputHashByPath.get('textures/MultProjectorGradient.rgba'));
        expect(modelData.hash).toBe(outputHashByPath.get('models/SmokeMesh.glb'));

        expect((iniBundle.data as { stats?: { objects?: number } }).stats?.objects).toBeGreaterThan(0);
        expect((mapData.data as { heightmap?: { width?: number } }).heightmap?.width).toBe(2);
        expect((mixedCaseMapData.data as { heightmap?: { width?: number } }).heightmap?.width).toBe(2);
        expect(textureData.data.byteLength).toBeGreaterThan(0);
        expect(modelData.data.byteLength).toBeGreaterThan(0);
      } finally {
        assets.dispose();
        globalThis.fetch = originalFetch;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps runtime manifest ordering/hashes deterministic across identical reruns', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted');
      const gameMapDir = resolve(gameDir, 'maps');

      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );
      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(gameMapDir, { recursive: true });
      copyFileSync(textureSource, resolve(extractedDir, 'textures', 'MultProjectorGradient.tga'));
      writeFileSync(resolve(gameMapDir, 'SmokeTest.map'), buildMinimalMapBinary());

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'texture,map',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      const firstStableEntries = firstManifest.entries.map((entry) => ({
        sourcePath: entry.sourcePath,
        outputPath: entry.outputPath,
        sourceHash: entry.sourceHash,
        outputHash: entry.outputHash,
        converter: entry.converter,
      }));

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'texture,map',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      const secondStableEntries = secondManifest.entries.map((entry) => ({
        sourcePath: entry.sourcePath,
        outputPath: entry.outputPath,
        sourceHash: entry.sourceHash,
        outputHash: entry.outputHash,
        converter: entry.converter,
      }));

      expect(secondStableEntries).toEqual(firstStableEntries);
      const sourcePaths = secondManifest.entries.map((entry) => entry.sourcePath);
      expect(sourcePaths).toEqual([...sourcePaths].sort((left, right) => left.localeCompare(right)));
    });
  });

  it('keeps runtime manifest deterministic across identical full reruns (ini,map,texture,w3d)', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted');
      const dataIniDir = resolve(gameDir, 'Data', 'INI');
      const gameMapDir = resolve(gameDir, 'maps');
      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );

      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(resolve(extractedDir, 'models'), { recursive: true });
      mkdirSync(gameMapDir, { recursive: true });
      mkdirSync(dataIniDir, { recursive: true });

      copyFileSync(textureSource, resolve(extractedDir, 'textures', 'MultProjectorGradient.tga'));
      writeFileSync(resolve(extractedDir, 'models', 'SmokeMesh.w3d'), buildMinimalW3dBinary());
      writeFileSync(resolve(gameMapDir, 'SmokeTest.map'), buildMinimalMapBinary());
      writeFileSync(resolve(dataIniDir, 'RuntimeObject.ini'), `Object RuntimeTank
  Side = America
End
`);

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini,map,texture,w3d',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      const firstStableEntries = firstManifest.entries.map((entry) => ({
        sourcePath: entry.sourcePath,
        outputPath: entry.outputPath,
        sourceHash: entry.sourceHash,
        outputHash: entry.outputHash,
        converter: entry.converter,
      }));
      const firstConverters = new Set(firstManifest.entries.map((entry) => entry.converter));
      expect(firstConverters.has('ini-parser')).toBe(true);
      expect(firstConverters.has('map-converter')).toBe(true);
      expect(firstConverters.has('texture-converter')).toBe(true);
      expect(firstConverters.has('w3d-converter')).toBe(true);
      expect(firstConverters.has('convert-all')).toBe(true);

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini,map,texture,w3d',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      const secondStableEntries = secondManifest.entries.map((entry) => ({
        sourcePath: entry.sourcePath,
        outputPath: entry.outputPath,
        sourceHash: entry.sourceHash,
        outputHash: entry.outputHash,
        converter: entry.converter,
      }));

      expect(secondStableEntries).toEqual(firstStableEntries);
      const sourcePaths = secondManifest.entries.map((entry) => entry.sourcePath);
      expect(sourcePaths).toEqual([...sourcePaths].sort((left, right) => left.localeCompare(right)));
      expect(secondManifest.entries.some((entry) => entry.outputPath.startsWith(`${RUNTIME_ASSET_BASE_URL}/`))).toBe(false);
    });
  }, 20000);

  it('preserves unique runtime map output paths when map basenames collide', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const gameMapDir = resolve(gameDir, 'maps');
      const extractedMapDir = resolve(outputDir, '_extracted', 'PackA');

      mkdirSync(gameMapDir, { recursive: true });
      mkdirSync(extractedMapDir, { recursive: true });
      writeFileSync(resolve(gameMapDir, 'SmokeTest.map'), buildMinimalMapBinary([0, 16, 32, 48]));
      writeFileSync(resolve(extractedMapDir, 'SmokeTest.map'), buildMinimalMapBinary([255, 192, 128, 64]));

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);
      expect(result.status).toBe(0);

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      const outputPaths = runtimeManifest.entries
        .filter((entry) => entry.converter === 'map-converter')
        .map((entry) => entry.outputPath)
        .sort((left, right) => left.localeCompare(right));
      expect(outputPaths).toEqual([
        'maps/_extracted/PackA/SmokeTest.json',
        'maps/SmokeTest.json',
      ]);

      const gameOutputHash = createHash('sha256')
        .update(readFileSync(resolve(outputDir, 'maps', 'SmokeTest.json')))
        .digest('hex');
      const extractedOutputHash = createHash('sha256')
        .update(readFileSync(resolve(outputDir, 'maps', '_extracted', 'PackA', 'SmokeTest.json')))
        .digest('hex');
      const gameEntry = runtimeManifest.entries.find((entry) => entry.outputPath === 'maps/SmokeTest.json');
      const extractedEntry = runtimeManifest.entries.find(
        (entry) => entry.outputPath === 'maps/_extracted/PackA/SmokeTest.json',
      );
      expect(gameEntry?.outputHash).toBe(gameOutputHash);
      expect(extractedEntry?.outputHash).toBe(extractedOutputHash);
    });
  });

  it('prunes stale map entries/files on map-only reruns and preserves non-map outputs', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const gameMapDir = resolve(gameDir, 'maps');
      const extractedDir = resolve(outputDir, '_extracted');
      const textureInput = resolve(extractedDir, 'textures', 'MultProjectorGradient.tga');
      const mapInput = resolve(gameMapDir, 'SmokeTest.map');

      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );
      mkdirSync(gameMapDir, { recursive: true });
      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      writeFileSync(mapInput, buildMinimalMapBinary());
      copyFileSync(textureSource, textureInput);

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map,texture',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'maps/SmokeTest.json')).toBe(true);
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(existsSync(resolve(outputDir, 'maps', 'SmokeTest.json'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(true);

      rmSync(mapInput, { force: true });

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'maps/SmokeTest.json')).toBe(false);
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(existsSync(resolve(outputDir, 'maps', 'SmokeTest.json'))).toBe(false);
      expect(existsSync(resolve(outputDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(true);
    });
  });

  it('prunes stale extracted-map entries/files on map-only reruns', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedMapDir = resolve(outputDir, '_extracted', 'PackA');
      const extractedMapInput = resolve(extractedMapDir, 'SmokeTest.map');
      const extractedMapOutput = resolve(outputDir, 'maps', '_extracted', 'PackA', 'SmokeTest.json');

      mkdirSync(gameDir, { recursive: true });
      mkdirSync(extractedMapDir, { recursive: true });
      writeFileSync(extractedMapInput, buildMinimalMapBinary());

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'maps/_extracted/PackA/SmokeTest.json')).toBe(true);
      expect(existsSync(extractedMapOutput)).toBe(true);

      rmSync(extractedMapInput, { force: true });

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'maps/_extracted/PackA/SmokeTest.json')).toBe(false);
      expect(existsSync(extractedMapOutput)).toBe(false);
    });
  });

  it('prunes stale texture entries on texture-only reruns and preserves other converters', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted');
      const textureInput = resolve(extractedDir, 'textures', 'MultProjectorGradient.tga');
      const w3dInput = resolve(extractedDir, 'models', 'SmokeMesh.w3d');

      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );
      mkdirSync(gameDir, { recursive: true });
      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(resolve(extractedDir, 'models'), { recursive: true });
      copyFileSync(textureSource, textureInput);
      writeFileSync(w3dInput, buildMinimalW3dBinary());

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'texture,w3d',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'models/SmokeMesh.glb')).toBe(true);
      expect(existsSync(resolve(outputDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(true);

      rmSync(textureInput, { force: true });

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'texture',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(false);
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'models/SmokeMesh.glb')).toBe(true);
      expect(existsSync(resolve(outputDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(false);
    });
  });

  it('prunes stale w3d entries/files on w3d-only reruns and preserves non-w3d outputs', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted');
      const textureInput = resolve(extractedDir, 'textures', 'MultProjectorGradient.tga');
      const w3dInput = resolve(extractedDir, 'models', 'SmokeMesh.w3d');

      const textureSource = resolve(
        PROJECT_ROOT,
        '..',
        'Generals',
        'Code',
        'Libraries',
        'Source',
        'WWVegas',
        'WW3D2',
        'RequiredAssets',
        'MultProjectorGradient.tga',
      );
      mkdirSync(gameDir, { recursive: true });
      mkdirSync(resolve(extractedDir, 'textures'), { recursive: true });
      mkdirSync(resolve(extractedDir, 'models'), { recursive: true });
      copyFileSync(textureSource, textureInput);
      writeFileSync(w3dInput, buildMinimalW3dBinary());

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'w3d,texture',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'models/SmokeMesh.glb')).toBe(true);
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(existsSync(resolve(outputDir, 'models', 'SmokeMesh.glb'))).toBe(true);
      expect(existsSync(resolve(outputDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(true);

      rmSync(w3dInput, { force: true });

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'w3d',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'models/SmokeMesh.glb')).toBe(false);
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'textures/MultProjectorGradient.rgba')).toBe(true);
      expect(existsSync(resolve(outputDir, 'models', 'SmokeMesh.glb'))).toBe(false);
      expect(existsSync(resolve(outputDir, 'textures', 'MultProjectorGradient.rgba'))).toBe(true);
    });
  });

  it('prunes stale INI entries on ini-only reruns and preserves non-INI converters', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const iniDir = resolve(gameDir, 'data');
      const mapDir = resolve(gameDir, 'maps');
      const iniFile = resolve(iniDir, 'sample.ini');
      const mapFile = resolve(mapDir, 'SmokeTest.map');

      mkdirSync(iniDir, { recursive: true });
      mkdirSync(mapDir, { recursive: true });
      writeFileSync(iniFile, `Object Tank
  Side = America
End
`);
      writeFileSync(mapFile, buildMinimalMapBinary());

      const firstRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini,map',
      ]);
      expect(firstRun.status).toBe(0);

      const firstManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(
        firstManifest.entries.some(
          (entry) => entry.converter === 'ini-parser' && entry.outputPath.endsWith('sample.json'),
        ),
      ).toBe(true);
      const firstIniEntry = firstManifest.entries.find(
        (entry) => entry.converter === 'ini-parser' && entry.outputPath.endsWith('sample.json'),
      );
      expect(firstIniEntry).toBeDefined();
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'data/ini-bundle.json')).toBe(true);
      expect(firstManifest.entries.some((entry) => entry.outputPath === 'maps/SmokeTest.json')).toBe(true);

      rmSync(iniFile, { force: true });

      const secondRun = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'ini',
      ]);
      expect(secondRun.status).toBe(0);

      const secondManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      expect(
        secondManifest.entries.some(
          (entry) => entry.converter === 'ini-parser' && entry.outputPath.endsWith('sample.json'),
        ),
      ).toBe(false);
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'data/ini-bundle.json')).toBe(false);
      expect(secondManifest.entries.some((entry) => entry.outputPath === 'maps/SmokeTest.json')).toBe(true);
      expect(existsSync(resolve(outputDir, firstIniEntry!.outputPath))).toBe(false);
      expect(existsSync(resolve(outputDir, 'data', 'ini-bundle.json'))).toBe(false);
    });
  });

  it('fails the pipeline when a converter step fails', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const extractedDir = resolve(outputDir, '_extracted', 'models');
      mkdirSync(extractedDir, { recursive: true });

      // Intentionally invalid W3D payload to force converter failure.
      writeFileSync(resolve(extractedDir, 'Broken.w3d'), Uint8Array.from([0, 1, 2, 3, 4, 5]));

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'w3d',
      ]);

      expect(result.status).not.toBe(0);
    });
  });

  it('ignores non-CkMp source-map files when converting maps', () => {
    return withTempDir((dir) => {
      const gameDir = resolve(dir, 'game');
      const outputDir = resolve(dir, 'out');
      const mapDir = resolve(gameDir, 'maps');
      const nodeModulesDir = resolve(gameDir, 'node_modules', 'pkg');

      mkdirSync(mapDir, { recursive: true });
      mkdirSync(nodeModulesDir, { recursive: true });

      writeFileSync(resolve(mapDir, 'SmokeTest.map'), buildMinimalMapBinary());
      writeFileSync(
        resolve(nodeModulesDir, 'index.js.map'),
        JSON.stringify({ version: 3, file: 'index.js', mappings: '' }),
      );

      const result = runConvertAll([
        '--game-dir',
        gameDir,
        '--output',
        outputDir,
        '--only',
        'map',
      ]);

      expect(result.status).toBe(0);
      expect(existsSync(resolve(outputDir, 'maps', 'SmokeTest.json'))).toBe(true);

      const runtimeManifest = JSON.parse(
        readFileSync(resolve(outputDir, RUNTIME_MANIFEST_FILE), 'utf8'),
      ) as ConversionManifestSnapshot;
      const mapEntries = runtimeManifest.entries.filter((entry) => entry.converter === 'map-converter');
      expect(mapEntries).toHaveLength(1);
      expect(mapEntries[0]?.outputPath).toBe('maps/SmokeTest.json');
      expect(mapEntries[0]?.sourcePath.toLowerCase().includes('index.js.map')).toBe(false);
    });
  });
});
