import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeManifest, loadManifest } from './manifest-loader.js';
import { ManifestLoadError } from './errors.js';
import type { ConversionManifest } from '@generals/core';

const VALID_MANIFEST: ConversionManifest = {
  version: 1,
  generatedAt: '2025-01-01T00:00:00.000Z',
  entryCount: 4,
  entries: [
    {
      sourcePath: 'maps/Alpine.map',
      sourceHash: 'aaa111',
      outputPath: 'maps/Alpine.json',
      outputHash: 'bbb222',
      converter: 'map-converter',
      converterVersion: '1.0.0',
      timestamp: '2025-01-01T00:00:00.000Z',
    },
    {
      sourcePath: 'textures/grass.tga',
      sourceHash: 'ccc333',
      outputPath: 'textures/grass.png',
      outputHash: 'ddd444',
      converter: 'texture-converter',
      converterVersion: '1.0.0',
      timestamp: '2025-01-01T00:00:00.000Z',
    },
    {
      sourcePath: 'Art/W3D/AVThundrblt_d1.w3d',
      sourceHash: 'eee555',
      outputPath: 'models/W3DZH/Art/W3D/AVThundrblt_d1.glb',
      outputHash: 'fff666',
      converter: 'w3d-converter',
      converterVersion: '1.0.0',
      timestamp: '2025-01-01T00:00:00.000Z',
    },
    {
      sourcePath: 'Art/W3D/ABBarracks.w3d',
      sourceHash: 'ggg777',
      outputPath: 'models/W3DZH/Art/W3D/ABBarracks.glb',
      outputHash: 'hhh888',
      converter: 'w3d-converter',
      converterVersion: '1.0.0',
      timestamp: '2025-01-01T00:00:00.000Z',
    },
  ],
};

const DUPLICATE_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 2,
  entries: [
    VALID_MANIFEST.entries[0]!,
    {
      ...VALID_MANIFEST.entries[1]!,
      outputPath: VALID_MANIFEST.entries[0]!.outputPath,
    },
  ],
};

const DUPLICATE_SOURCE_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 2,
  entries: [
    VALID_MANIFEST.entries[0]!,
    {
      ...VALID_MANIFEST.entries[1]!,
      sourcePath: VALID_MANIFEST.entries[0]!.sourcePath,
    },
  ],
};

const BASE_PREFIX_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: 'assets/maps/Alpine.json',
    },
  ],
};

const BASE_ONLY_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: 'Assets',
    },
  ],
};

const MIXED_CASE_BASE_PREFIX_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: 'Assets/maps/Alpine.json',
    },
  ],
};

const PARENT_TRAVERSAL_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: '../maps/Alpine.json',
    },
  ],
};

const PARENT_TRAVERSAL_SOURCE_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      sourcePath: '../maps/Alpine.map',
    },
  ],
};

const BACKSLASH_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: 'maps\\Alpine.json',
    },
  ],
};

const DOT_SEGMENT_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: './maps/Alpine.json',
    },
  ],
};

const WINDOWS_DRIVE_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: 'C:/maps/Alpine.json',
    },
  ],
};

const WINDOWS_DRIVE_SOURCE_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      sourcePath: 'C:/maps/Alpine.map',
    },
  ],
};

const URL_OUTPUT_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      outputPath: 'https://cdn.example.com/maps/Alpine.json',
    },
  ],
};

const URL_SOURCE_PATH_MANIFEST: ConversionManifest = {
  ...VALID_MANIFEST,
  entryCount: 1,
  entries: [
    {
      ...VALID_MANIFEST.entries[0]!,
      sourcePath: 'https://cdn.example.com/maps/Alpine.map',
    },
  ],
};

describe('RuntimeManifest', () => {
  const manifest = new RuntimeManifest(VALID_MANIFEST);

  it('indexes entries by output path', () => {
    const entry = manifest.getByOutputPath('maps/Alpine.json');
    expect(entry).toBeDefined();
    expect(entry!.sourcePath).toBe('maps/Alpine.map');
  });

  it('indexes entries by source path', () => {
    const entry = manifest.getBySourcePath('textures/grass.tga');
    expect(entry).toBeDefined();
    expect(entry!.outputPath).toBe('textures/grass.png');
  });

  it('returns undefined for missing output path', () => {
    expect(manifest.getByOutputPath('nonexistent')).toBeUndefined();
  });

  it('returns undefined for missing source path', () => {
    expect(manifest.getBySourcePath('nonexistent')).toBeUndefined();
  });

  it('checks existence with hasOutputPath', () => {
    expect(manifest.hasOutputPath('maps/Alpine.json')).toBe(true);
    expect(manifest.hasOutputPath('missing')).toBe(false);
  });

  it('lists all output paths', () => {
    const paths = manifest.getOutputPaths();
    expect(paths).toHaveLength(4);
    expect(paths).toContain('maps/Alpine.json');
    expect(paths).toContain('textures/grass.png');
    expect(paths).toContain('models/W3DZH/Art/W3D/AVThundrblt_d1.glb');
    expect(paths).toContain('models/W3DZH/Art/W3D/ABBarracks.glb');
  });

  it('reports correct size', () => {
    expect(manifest.size).toBe(4);
  });

  it('exposes raw manifest', () => {
    expect(manifest.raw).toBe(VALID_MANIFEST);
  });

  describe('getByBasenameLower', () => {
    it('resolves a .glb entry by lowercase basename', () => {
      const entry = manifest.getByBasenameLower('avthundrblt_d1');
      expect(entry).toBeDefined();
      expect(entry!.outputPath).toBe('models/W3DZH/Art/W3D/AVThundrblt_d1.glb');
    });

    it('resolves case-insensitively', () => {
      const entry = manifest.getByBasenameLower('AVThundrblt_D1');
      expect(entry).toBeDefined();
      expect(entry!.outputPath).toBe('models/W3DZH/Art/W3D/AVThundrblt_d1.glb');
    });

    it('resolves another .glb entry', () => {
      const entry = manifest.getByBasenameLower('ABBarracks');
      expect(entry).toBeDefined();
      expect(entry!.outputPath).toBe('models/W3DZH/Art/W3D/ABBarracks.glb');
    });

    it('returns undefined for non-.glb entries', () => {
      // "Alpine" exists as .json but should not be in the basename index
      expect(manifest.getByBasenameLower('Alpine')).toBeUndefined();
    });

    it('returns undefined for missing entries', () => {
      expect(manifest.getByBasenameLower('nonexistent_model')).toBeUndefined();
    });
  });
});

describe('loadManifest', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads and parses a valid manifest', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(VALID_MANIFEST)),
    });

    const result = await loadManifest('/assets/manifest.json');
    expect(result).toBeInstanceOf(RuntimeManifest);
    expect(result!.size).toBe(4);
  });

  it('returns null on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    });

    const result = await loadManifest('/assets/manifest.json');
    expect(result).toBeNull();
  });

  it('throws ManifestLoadError on non-404 HTTP errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(''),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('HTTP 500');
  });

  it('throws ManifestLoadError on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Failed to fetch');
  });

  it('throws ManifestLoadError on invalid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('not json'),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid manifest JSON');
  });

  it('throws ManifestLoadError on valid JSON but wrong schema', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ version: 2, entries: [] })),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
  });

  it('throws ManifestLoadError on duplicate outputPath entries', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(DUPLICATE_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Duplicate outputPath');
  });

  it('throws ManifestLoadError on duplicate sourcePath entries', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(DUPLICATE_SOURCE_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Duplicate sourcePath');
  });

  it('throws ManifestLoadError when outputPath includes runtime base prefix', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(BASE_PREFIX_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when outputPath exactly equals runtime base', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(BASE_ONLY_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when outputPath includes mixed-case runtime base prefix', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(MIXED_CASE_BASE_PREFIX_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when outputPath contains parent traversal', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(PARENT_TRAVERSAL_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when sourcePath contains parent traversal', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(PARENT_TRAVERSAL_SOURCE_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid sourcePath');
  });

  it('throws ManifestLoadError when outputPath uses backslashes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(BACKSLASH_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when outputPath contains dot segments', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(DOT_SEGMENT_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when outputPath is a windows drive absolute path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(WINDOWS_DRIVE_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when sourcePath is a windows drive absolute path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(WINDOWS_DRIVE_SOURCE_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid sourcePath');
  });

  it('throws ManifestLoadError when outputPath is a URL absolute path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(URL_OUTPUT_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid outputPath');
  });

  it('throws ManifestLoadError when sourcePath is a URL absolute path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(URL_SOURCE_PATH_MANIFEST)),
    });

    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow(ManifestLoadError);
    await expect(loadManifest('/assets/manifest.json')).rejects.toThrow('Invalid sourcePath');
  });
});
