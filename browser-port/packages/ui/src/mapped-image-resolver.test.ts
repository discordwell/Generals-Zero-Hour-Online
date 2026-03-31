/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { MappedImageResolver, type MappedImageEntry } from './mapped-image-resolver.js';

// jsdom does not provide ImageData or a real canvas 2D context.
// Polyfill ImageData and mock canvas getContext for image cropping tests.
beforeAll(() => {
  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as Record<string, unknown>).ImageData = class ImageData {
      readonly width: number;
      readonly height: number;
      readonly data: Uint8ClampedArray;
      constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
        if (dataOrWidth instanceof Uint8ClampedArray) {
          this.data = dataOrWidth;
          this.width = widthOrHeight;
          this.height = height ?? (dataOrWidth.length / (widthOrHeight * 4));
        } else {
          this.width = dataOrWidth;
          this.height = widthOrHeight;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        }
      }
    };
  }

  // Patch HTMLCanvasElement.prototype.getContext to return a minimal stub
  // that supports createImageData, putImageData, and toDataURL.
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === '2d') {
      const w = this.width;
      const h = this.height;
      return {
        createImageData: (iw: number, ih: number) => new ImageData(iw, ih),
        putImageData: () => {},
        translate: () => {},
        rotate: () => {},
        drawImage: () => {},
        canvas: this,
      } as unknown as CanvasRenderingContext2D;
    }
    return origGetContext.call(this, contextId, ...(args as []));
  } as typeof origGetContext;

  // Patch toDataURL to return a deterministic value
  HTMLCanvasElement.prototype.toDataURL = function () {
    return `data:image/png;base64,STUB_${this.width}x${this.height}`;
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<MappedImageEntry> = {}): MappedImageEntry {
  return {
    name: 'SSAttackMove',
    texture: 'SSUserInterface512_001.tga',
    textureWidth: 512,
    textureHeight: 512,
    left: 307,
    top: 443,
    right: 367,
    bottom: 491,
    rotated: false,
    ...overrides,
  };
}

/**
 * Create a minimal .rgba buffer: 4-byte LE width, 4-byte LE height,
 * then width*height*4 bytes of RGBA pixel data (all opaque red).
 */
function createRgbaBuffer(width: number, height: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + width * height * 4);
  const view = new DataView(buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  // Fill with opaque red pixels
  const pixels = new Uint8Array(buffer, 8);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 255;     // R
    pixels[i * 4 + 1] = 0;   // G
    pixels[i * 4 + 2] = 0;   // B
    pixels[i * 4 + 3] = 255; // A
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MappedImageResolver', () => {
  let resolver: MappedImageResolver;

  beforeEach(() => {
    resolver = new MappedImageResolver('assets/textures/Art/Textures');
    vi.restoreAllMocks();
  });

  describe('entry management', () => {
    it('registers and retrieves entries by name', () => {
      const entry = makeEntry();
      resolver.addEntries([entry]);

      expect(resolver.size).toBe(1);
      expect(resolver.getEntry('SSAttackMove')).toEqual(entry);
    });

    it('returns undefined for unknown entries', () => {
      expect(resolver.getEntry('NonExistent')).toBeUndefined();
    });

    // Source parity: C++ ImageCollection::findImageByName uses nameToLowercaseKey
    // for case-insensitive lookup. ButtonImage values in CommandButton INI may
    // differ in casing from the MappedImage block name.
    it('retrieves entries case-insensitively', () => {
      resolver.addEntries([
        makeEntry({ name: 'SAPathFinder1' }),
        makeEntry({ name: 'SAleaflet' }),
      ]);

      // Exact match still works
      expect(resolver.getEntry('SAPathFinder1')).toBeDefined();
      expect(resolver.getEntry('SAleaflet')).toBeDefined();

      // Case-insensitive match works
      expect(resolver.getEntry('SAPathfinder1')?.name).toBe('SAPathFinder1');
      expect(resolver.getEntry('SALeaflet')?.name).toBe('SAleaflet');
      expect(resolver.getEntry('sapathfinder1')?.name).toBe('SAPathFinder1');
    });

    it('overwrites entries with the same name', () => {
      const entry1 = makeEntry({ left: 10 });
      const entry2 = makeEntry({ left: 20 });
      resolver.addEntries([entry1]);
      resolver.addEntries([entry2]);

      expect(resolver.size).toBe(1);
      expect(resolver.getEntry('SSAttackMove')?.left).toBe(20);
    });

    it('handles multiple entries', () => {
      resolver.addEntries([
        makeEntry({ name: 'IconA' }),
        makeEntry({ name: 'IconB' }),
        makeEntry({ name: 'IconC' }),
      ]);

      expect(resolver.size).toBe(3);
      expect(resolver.getEntry('IconA')).toBeDefined();
      expect(resolver.getEntry('IconB')).toBeDefined();
      expect(resolver.getEntry('IconC')).toBeDefined();
    });
  });

  describe('resolve', () => {
    it('returns null for unknown image names', async () => {
      const result = await resolver.resolve('NonExistent');
      expect(result).toBeNull();
    });

    it('resolves entries with case-insensitive name lookup', async () => {
      const atlasBuffer = createRgbaBuffer(64, 64);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(atlasBuffer),
      } as Response);

      resolver.addEntries([
        makeEntry({
          name: 'SAPathFinder1',
          textureWidth: 64,
          textureHeight: 64,
          left: 0, top: 0, right: 31, bottom: 31,
        }),
      ]);

      // Resolve with different casing (as C++ ButtonImage would reference it)
      const url = await resolver.resolve('SAPathfinder1');
      expect(url).not.toBeNull();
      expect(url!.startsWith('data:')).toBe(true);
    });

    it('fetches atlas texture and returns a data URL', async () => {
      const atlasBuffer = createRgbaBuffer(512, 512);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(atlasBuffer),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      resolver.addEntries([makeEntry()]);
      const url = await resolver.resolve('SSAttackMove');

      expect(url).toBeDefined();
      expect(url).not.toBeNull();
      // Stubbed canvas returns 'data:image/png;base64,STUB_WxH'
      expect(url!.startsWith('data:')).toBe(true);

      // Verify fetch was called with the correct URL (lowercased, .tga -> .rgba)
      expect(fetch).toHaveBeenCalledWith(
        'assets/textures/Art/Textures/ssuserinterface512_001.rgba',
      );
    });

    it('caches resolved URLs for the same image name', async () => {
      const atlasBuffer = createRgbaBuffer(64, 64);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(atlasBuffer),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      resolver.addEntries([
        makeEntry({
          name: 'SmallIcon',
          textureWidth: 64,
          textureHeight: 64,
          left: 0, top: 0, right: 31, bottom: 31,
        }),
      ]);

      const url1 = await resolver.resolve('SmallIcon');
      const url2 = await resolver.resolve('SmallIcon');

      expect(url1).toBe(url2);
      // fetch should only be called once (atlas cached)
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('caches atlas loads across different images from same texture', async () => {
      const atlasBuffer = createRgbaBuffer(64, 64);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(atlasBuffer),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      resolver.addEntries([
        makeEntry({
          name: 'Icon1',
          texture: 'shared-atlas.tga',
          textureWidth: 64,
          textureHeight: 64,
          left: 0, top: 0, right: 15, bottom: 15,
        }),
        makeEntry({
          name: 'Icon2',
          texture: 'shared-atlas.tga',
          textureWidth: 64,
          textureHeight: 64,
          left: 16, top: 0, right: 31, bottom: 15,
        }),
      ]);

      await resolver.resolve('Icon1');
      await resolver.resolve('Icon2');

      // fetch should only be called once for the shared atlas
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('handles fetch failure gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      resolver.addEntries([makeEntry()]);

      await expect(resolver.resolve('SSAttackMove')).rejects.toThrow(
        /Failed to fetch atlas texture/,
      );
    });

    it('resolves rotated images', async () => {
      const atlasBuffer = createRgbaBuffer(64, 64);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(atlasBuffer),
      } as Response);

      resolver.addEntries([
        makeEntry({
          name: 'RotatedIcon',
          texture: 'atlas.tga',
          textureWidth: 64,
          textureHeight: 64,
          left: 0, top: 0, right: 23, bottom: 15,
          rotated: true,
        }),
      ]);

      const url = await resolver.resolve('RotatedIcon');
      expect(url).not.toBeNull();
      expect(url!.startsWith('data:')).toBe(true);
      // Rotated image should swap dimensions: 24x16 input -> 16x24 output
      expect(url).toContain('STUB_16x24');
    });
  });
});
