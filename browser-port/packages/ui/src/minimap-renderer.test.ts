import { describe, expect, it, beforeEach } from 'vitest';

import {
  MinimapRenderer,
  type MinimapHeightmap,
  type MinimapEntity,
  type MinimapFogData,
  type MinimapCameraBounds,
  type MinimapCanvasFactory,
  type MinimapCanvasContext,
} from './minimap-renderer.js';

// ---------------------------------------------------------------------------
// Pure-data mock canvas context for headless Node.js testing.
//
// Implements the MinimapCanvasContext interface by maintaining an in-memory
// RGBA pixel buffer.  fillRect paints solid color, stroke records calls,
// getImageData / putImageData / createImageData operate on the buffer, and
// drawImage copies from another MockCanvasContext.
// ---------------------------------------------------------------------------

class MockCanvasContext implements MinimapCanvasContext {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;

  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;

  /** Tracks stroke calls for viewport tests. */
  strokeCalls: Array<{ points: Array<{ x: number; y: number }> }> = [];
  private currentPath: Array<{ x: number; y: number }> = [];

  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.pixels = new Uint8ClampedArray(w * h * 4);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b, a] = parseColor(this.fillStyle as string);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const idx = (py * this.width + px) * 4;
        this.pixels[idx] = r;
        this.pixels[idx + 1] = g;
        this.pixels[idx + 2] = b;
        this.pixels[idx + 3] = a;
      }
    }
  }

  beginPath(): void {
    this.currentPath = [];
  }
  moveTo(x: number, y: number): void {
    this.currentPath.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.currentPath.push({ x, y });
  }
  closePath(): void {
    // noop — path closed by stroke recording.
  }
  stroke(): void {
    this.strokeCalls.push({ points: [...this.currentPath] });

    // Actually paint stroked pixels for viewport detection tests.
    const [r, g, b] = parseColor(this.strokeStyle as string);
    const pts = this.currentPath;
    for (let i = 0; i < pts.length; i++) {
      const from = pts[i]!;
      const to = pts[(i + 1) % pts.length]!;
      this.drawLinePixels(from.x, from.y, to.x, to.y, r, g, b);
    }
  }

  createImageData(w: number, h: number): ImageData {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' } as ImageData;
  }

  getImageData(_sx: number, _sy: number, sw: number, sh: number): ImageData {
    const data = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const srcIdx = ((y + _sy) * this.width + (x + _sx)) * 4;
        const dstIdx = (y * sw + x) * 4;
        data[dstIdx] = this.pixels[srcIdx]!;
        data[dstIdx + 1] = this.pixels[srcIdx + 1]!;
        data[dstIdx + 2] = this.pixels[srcIdx + 2]!;
        data[dstIdx + 3] = this.pixels[srcIdx + 3]!;
      }
    }
    return { width: sw, height: sh, data, colorSpace: 'srgb' } as ImageData;
  }

  putImageData(imageData: ImageData, dx: number, dy: number): void {
    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const srcIdx = (y * imageData.width + x) * 4;
        const dstIdx = ((y + dy) * this.width + (x + dx)) * 4;
        this.pixels[dstIdx] = imageData.data[srcIdx]!;
        this.pixels[dstIdx + 1] = imageData.data[srcIdx + 1]!;
        this.pixels[dstIdx + 2] = imageData.data[srcIdx + 2]!;
        this.pixels[dstIdx + 3] = imageData.data[srcIdx + 3]!;
      }
    }
  }

  drawImage(image: unknown, _dx: number, _dy: number): void {
    // If the source is another MockCanvasContext's owner, copy pixel buffer.
    const src = image as { _mockCtx?: MockCanvasContext };
    if (src._mockCtx) {
      this.pixels.set(src._mockCtx.pixels);
    }
  }

  // Bresenham-ish line rasteriser for stroke visibility tests.
  private drawLinePixels(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const steps = Math.max(1, Math.ceil(Math.max(dx, dy)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = Math.round(x0 + (x1 - x0) * t);
      const py = Math.round(y0 + (y1 - y0) * t);
      if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
        const idx = (py * this.width + px) * 4;
        this.pixels[idx] = r;
        this.pixels[idx + 1] = g;
        this.pixels[idx + 2] = b;
        this.pixels[idx + 3] = 255;
      }
    }
  }
}

/** Mock canvas object that links back to its context for drawImage support. */
class MockCanvas {
  width: number;
  height: number;
  _mockCtx: MockCanvasContext;
  constructor(w: number, h: number, ctx: MockCanvasContext) {
    this.width = w;
    this.height = h;
    this._mockCtx = ctx;
  }
}

/** Factory that creates mock canvas/context pairs for headless tests. */
function mockCanvasFactory(w: number, h: number): { canvas: MockCanvas; ctx: MinimapCanvasContext } {
  const ctx = new MockCanvasContext(w, h);
  const canvas = new MockCanvas(w, h, ctx);
  return { canvas, ctx };
}

/** Parse "#rrggbb" or "rgba(r,g,b,a)" to [r, g, b, a]. */
function parseColor(color: string): [number, number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b, 255];
  }
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) {
    return [
      parseInt(m[1]!, 10),
      parseInt(m[2]!, 10),
      parseInt(m[3]!, 10),
      m[4] !== undefined ? Math.round(parseFloat(m[4]) * 255) : 255,
    ];
  }
  return [0, 0, 0, 255];
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SIZE = 100;

function makeFlatHeightmap(height = 10, worldWidth = 500, worldDepth = 500): MinimapHeightmap {
  return {
    worldWidth,
    worldDepth,
    getInterpolatedHeight: () => height,
  };
}

function makeGradientHeightmap(maxHeight = 30, worldWidth = 500, worldDepth = 500): MinimapHeightmap {
  return {
    worldWidth,
    worldDepth,
    getInterpolatedHeight: (wx: number) => (wx / worldWidth) * maxHeight,
  };
}

function makeEntity(
  overrides: Partial<MinimapEntity> & { id: number; x: number; z: number },
): MinimapEntity {
  return {
    side: 'USA',
    category: 'vehicle',
    ...overrides,
  };
}

function makeClearFog(cellsWide = 10, cellsDeep = 10): MinimapFogData {
  return { cellsWide, cellsDeep, cellSize: 50, data: new Uint8Array(cellsWide * cellsDeep).fill(2) };
}

function makeShroudedFog(cellsWide = 10, cellsDeep = 10): MinimapFogData {
  return { cellsWide, cellsDeep, cellSize: 50, data: new Uint8Array(cellsWide * cellsDeep).fill(0) };
}

function makeFoggedFog(cellsWide = 10, cellsDeep = 10): MinimapFogData {
  return { cellsWide, cellsDeep, cellSize: 50, data: new Uint8Array(cellsWide * cellsDeep).fill(1) };
}

function defaultCamera(): MinimapCameraBounds {
  return { targetX: 250, targetZ: 250, zoom: 60, angle: 0 };
}

/** Get RGBA at (px, py) from the mock context's backing pixel buffer. */
function getPixel(ctx: MinimapCanvasContext, px: number, py: number, width: number): [number, number, number, number] {
  const mock = ctx as MockCanvasContext;
  const idx = (py * width + px) * 4;
  return [mock.pixels[idx]!, mock.pixels[idx + 1]!, mock.pixels[idx + 2]!, mock.pixels[idx + 3]!];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MinimapRenderer', () => {
  let renderer: MinimapRenderer;

  beforeEach(() => {
    renderer = new MinimapRenderer(SIZE, mockCanvasFactory as unknown as MinimapCanvasFactory);
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it('creates a renderer with the requested size', () => {
    expect(renderer.size).toBe(SIZE);
    const canvas = renderer.getCanvas();
    expect(canvas.width).toBe(SIZE);
    expect(canvas.height).toBe(SIZE);
  });

  // -----------------------------------------------------------------------
  // Terrain rendering
  // -----------------------------------------------------------------------

  describe('renderTerrain', () => {
    it('produces non-empty image data', () => {
      const hm = makeFlatHeightmap(15);
      renderer.renderTerrain(hm);
      renderer.update(hm, [], null, defaultCamera(), 'USA');

      const ctx = renderer.getContext() as MockCanvasContext;
      let nonZero = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! > 0 || ctx.pixels[i + 1]! > 0 || ctx.pixels[i + 2]! > 0) {
          nonZero++;
        }
      }
      expect(nonZero).toBeGreaterThan(0);
    });

    it('maps low height to greener colors and high height to browner colors', () => {
      const hm = makeGradientHeightmap(30);
      renderer.renderTerrain(hm);
      renderer.update(hm, [], null, defaultCamera(), 'USA');

      const ctx = renderer.getContext();
      const midRow = Math.floor(SIZE / 2);
      const [rLow, gLow, bLow] = getPixel(ctx, 0, midRow, SIZE);
      const [rHigh, gHigh, bHigh] = getPixel(ctx, SIZE - 1, midRow, SIZE);

      // Low terrain: R ~ 40, G ~ 60, B ~ 30.
      // High terrain: R ~ 120, G ~ 160, B ~ 70.
      expect(rHigh).toBeGreaterThan(rLow);
      expect(gHigh).toBeGreaterThan(gLow);
      expect(bHigh).toBeGreaterThan(bLow);
    });

    it('clamps height outside [0, 30] range', () => {
      const hmLow: MinimapHeightmap = {
        worldWidth: 500, worldDepth: 500,
        getInterpolatedHeight: () => -10,
      };
      renderer.renderTerrain(hmLow);
      renderer.update(hmLow, [], null, defaultCamera(), 'USA');

      const ctx = renderer.getContext();
      // Pick a pixel not on the viewport stroke line.
      const [r] = getPixel(ctx, 10, 10, SIZE);
      // t = 0 -> R = 40.
      expect(r).toBe(40);
    });
  });

  // -----------------------------------------------------------------------
  // Unit rendering
  // -----------------------------------------------------------------------

  describe('renderUnits', () => {
    it('places unit dots at correct minimap coordinates', () => {
      const hm = makeFlatHeightmap(10);
      const entity = makeEntity({ id: 1, x: 250, z: 250, side: 'USA' });

      renderer.renderTerrain(hm);
      renderer.update(hm, [entity], null, defaultCamera(), 'USA');

      const ctx = renderer.getContext();
      // Entity at (250, 250) in 500x500 world -> minimap pixel (50, 50).
      const [r, g, b] = getPixel(ctx, 50, 50, SIZE);

      // Own unit color is #00cc00 (0, 204, 0).
      expect(r).toBe(0);
      expect(g).toBe(204);
      expect(b).toBe(0);
    });

    it('renders own units as green and enemy units as red', () => {
      const hm = makeFlatHeightmap(10);
      const ownUnit = makeEntity({ id: 1, x: 100, z: 250, side: 'USA' });
      const enemyUnit = makeEntity({ id: 2, x: 400, z: 250, side: 'GLA' });

      renderer.renderTerrain(hm);
      renderer.update(hm, [ownUnit, enemyUnit], null, defaultCamera(), 'USA');

      const ctx = renderer.getContext();

      // Own at px = (100/500)*100 = 20, py = 50.
      const [rOwn, gOwn] = getPixel(ctx, 20, 50, SIZE);
      expect(gOwn).toBe(204);
      expect(rOwn).toBe(0);

      // Enemy at px = (400/500)*100 = 80, py = 50.
      const [rEnemy, gEnemy] = getPixel(ctx, 80, 50, SIZE);
      expect(rEnemy).toBe(204); // 0xcc = 204
      expect(gEnemy).toBe(51);  // 0x33 = 51
    });

    it('renders buildings as larger dots than vehicles', () => {
      const hm = makeFlatHeightmap(10);
      const vehicle = makeEntity({ id: 1, x: 100, z: 250, side: 'USA', category: 'vehicle' });
      const building = makeEntity({ id: 2, x: 400, z: 250, side: 'USA', category: 'building' });

      renderer.renderTerrain(hm);

      // Render vehicle only.
      renderer.update(hm, [vehicle], null, defaultCamera(), 'USA');
      const ctx = renderer.getContext() as MockCanvasContext;

      let vehicleGreenCount = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! === 0 && ctx.pixels[i + 1]! === 204 && ctx.pixels[i + 2]! === 0) {
          vehicleGreenCount++;
        }
      }

      // Render building only.
      renderer.update(hm, [building], null, defaultCamera(), 'USA');
      let buildingGreenCount = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! === 0 && ctx.pixels[i + 1]! === 204 && ctx.pixels[i + 2]! === 0) {
          buildingGreenCount++;
        }
      }

      // Vehicle: 3x3 = 9 pixels.  Building: 5x5 = 25 pixels.
      expect(vehicleGreenCount).toBe(9);
      expect(buildingGreenCount).toBe(25);
    });
  });

  // -----------------------------------------------------------------------
  // Fog overlay
  // -----------------------------------------------------------------------

  describe('renderFogOverlay', () => {
    it('darkens pixels for shrouded cells (multiplied by 0.15)', () => {
      const hm = makeFlatHeightmap(10);
      renderer.renderTerrain(hm);

      // Get clear terrain colors at a pixel not on the viewport stroke line.
      renderer.update(hm, [], null, defaultCamera(), 'USA');
      const ctx = renderer.getContext();
      const [rClear, gClear, bClear] = getPixel(ctx, 10, 10, SIZE);

      // Now render with full shroud.
      renderer.update(hm, [], makeShroudedFog(), defaultCamera(), 'USA');
      const [rShroud, gShroud, bShroud] = getPixel(ctx, 10, 10, SIZE);

      expect(rShroud).toBe(Math.round(rClear * 0.15));
      expect(gShroud).toBe(Math.round(gClear * 0.15));
      expect(bShroud).toBe(Math.round(bClear * 0.15));
    });

    it('dims pixels for fogged cells (multiplied by 0.5)', () => {
      const hm = makeFlatHeightmap(10);
      renderer.renderTerrain(hm);

      renderer.update(hm, [], null, defaultCamera(), 'USA');
      const ctx = renderer.getContext();
      const [rClear, gClear, bClear] = getPixel(ctx, 10, 10, SIZE);

      renderer.update(hm, [], makeFoggedFog(), defaultCamera(), 'USA');
      const [rFog, gFog, bFog] = getPixel(ctx, 10, 10, SIZE);

      expect(rFog).toBe(Math.round(rClear * 0.5));
      expect(gFog).toBe(Math.round(gClear * 0.5));
      expect(bFog).toBe(Math.round(bClear * 0.5));
    });

    it('leaves clear cells unchanged', () => {
      const hm = makeFlatHeightmap(10);
      renderer.renderTerrain(hm);

      renderer.update(hm, [], null, defaultCamera(), 'USA');
      const ctx = renderer.getContext();
      const [rNo, gNo, bNo] = getPixel(ctx, 10, 10, SIZE);

      renderer.update(hm, [], makeClearFog(), defaultCamera(), 'USA');
      const [rClear, gClear, bClear] = getPixel(ctx, 10, 10, SIZE);

      expect(rClear).toBe(rNo);
      expect(gClear).toBe(gNo);
      expect(bClear).toBe(bNo);
    });
  });

  // -----------------------------------------------------------------------
  // Click-to-world coordinate conversion
  // -----------------------------------------------------------------------

  describe('getWorldPositionFromClick', () => {
    it('maps center click to center of world', () => {
      const hm = makeFlatHeightmap(10, 1000, 800);
      renderer.renderTerrain(hm);

      const pos = renderer.getWorldPositionFromClick(SIZE / 2, SIZE / 2);
      expect(pos).not.toBeNull();
      expect(pos!.x).toBeCloseTo(500, 0);
      expect(pos!.z).toBeCloseTo(400, 0);
    });

    it('maps top-left corner to world origin', () => {
      const hm = makeFlatHeightmap(10, 1000, 800);
      renderer.renderTerrain(hm);

      const pos = renderer.getWorldPositionFromClick(0, 0);
      expect(pos).not.toBeNull();
      expect(pos!.x).toBe(0);
      expect(pos!.z).toBe(0);
    });

    it('maps bottom-right corner to world max', () => {
      const hm = makeFlatHeightmap(10, 1000, 800);
      renderer.renderTerrain(hm);

      const pos = renderer.getWorldPositionFromClick(SIZE, SIZE);
      expect(pos).not.toBeNull();
      expect(pos!.x).toBe(1000);
      expect(pos!.z).toBe(800);
    });

    it('clamps out-of-bounds clicks to [0, 1] range', () => {
      const hm = makeFlatHeightmap(10, 1000, 800);
      renderer.renderTerrain(hm);

      const posNeg = renderer.getWorldPositionFromClick(-50, -50);
      expect(posNeg).not.toBeNull();
      expect(posNeg!.x).toBe(0);
      expect(posNeg!.z).toBe(0);

      const posOver = renderer.getWorldPositionFromClick(SIZE * 2, SIZE * 2);
      expect(posOver).not.toBeNull();
      expect(posOver!.x).toBe(1000);
      expect(posOver!.z).toBe(800);
    });

    it('returns null when world dimensions are unknown', () => {
      const fresh = new MinimapRenderer(SIZE, mockCanvasFactory as unknown as MinimapCanvasFactory);
      const pos = fresh.getWorldPositionFromClick(50, 50);
      expect(pos).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Viewport rectangle
  // -----------------------------------------------------------------------

  describe('renderViewport', () => {
    it('draws viewport rectangle that scales with zoom', () => {
      const hm = makeFlatHeightmap(10, 1000, 1000);
      renderer.renderTerrain(hm);

      // Small zoom.
      const smallCamera: MinimapCameraBounds = { targetX: 500, targetZ: 500, zoom: 30, angle: 0 };
      renderer.update(hm, [], null, smallCamera, 'USA');
      const ctx = renderer.getContext() as MockCanvasContext;

      let smallWhite = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! > 200 && ctx.pixels[i + 1]! > 200 && ctx.pixels[i + 2]! > 200) {
          smallWhite++;
        }
      }

      // Large zoom.
      const largeCamera: MinimapCameraBounds = { targetX: 500, targetZ: 500, zoom: 120, angle: 0 };
      renderer.update(hm, [], null, largeCamera, 'USA');

      let largeWhite = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! > 200 && ctx.pixels[i + 1]! > 200 && ctx.pixels[i + 2]! > 200) {
          largeWhite++;
        }
      }

      expect(largeWhite).toBeGreaterThan(smallWhite);
    });

    it('positions viewport rectangle correctly on the minimap', () => {
      const hm = makeFlatHeightmap(10, 1000, 1000);
      renderer.renderTerrain(hm);

      // Camera centered at (250, 250) — upper-left quadrant.
      const camera: MinimapCameraBounds = { targetX: 250, targetZ: 250, zoom: 40, angle: 0 };
      renderer.update(hm, [], null, camera, 'USA');

      const ctx = renderer.getContext() as MockCanvasContext;

      // White pixels near the viewport center (25, 25).
      let whiteNearCenter = 0;
      let whiteInOpposite = 0;

      for (let py = 15; py < 35; py++) {
        for (let px = 15; px < 35; px++) {
          const idx = (py * SIZE + px) * 4;
          if (ctx.pixels[idx]! > 200 && ctx.pixels[idx + 1]! > 200 && ctx.pixels[idx + 2]! > 200) {
            whiteNearCenter++;
          }
        }
      }

      for (let py = 75; py < 95; py++) {
        for (let px = 75; px < 95; px++) {
          const idx = (py * SIZE + px) * 4;
          if (ctx.pixels[idx]! > 200 && ctx.pixels[idx + 1]! > 200 && ctx.pixels[idx + 2]! > 200) {
            whiteInOpposite++;
          }
        }
      }

      expect(whiteNearCenter).toBeGreaterThan(0);
      expect(whiteInOpposite).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Full composite update
  // -----------------------------------------------------------------------

  describe('update', () => {
    it('composites all layers without errors', () => {
      const hm = makeFlatHeightmap(15);
      const entities = [
        makeEntity({ id: 1, x: 100, z: 100, side: 'USA' }),
        makeEntity({ id: 2, x: 400, z: 400, side: 'GLA' }),
      ];
      const fog = makeClearFog();
      const camera = defaultCamera();

      expect(() => {
        renderer.update(hm, entities, fog, camera, 'USA');
      }).not.toThrow();

      const ctx = renderer.getContext() as MockCanvasContext;
      let nonZero = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! > 0) nonZero++;
      }
      expect(nonZero).toBeGreaterThan(0);
    });

    it('lazy-renders terrain on first update if not pre-rendered', () => {
      const hm = makeFlatHeightmap(10);
      renderer.update(hm, [], null, defaultCamera(), 'USA');

      const ctx = renderer.getContext() as MockCanvasContext;
      let nonZero = 0;
      for (let i = 0; i < ctx.pixels.length; i += 4) {
        if (ctx.pixels[i]! > 0) nonZero++;
      }
      expect(nonZero).toBeGreaterThan(0);
    });

    it('shroud darkens unit dots (fog applied after units)', () => {
      const hm = makeFlatHeightmap(10);
      const entity = makeEntity({ id: 1, x: 250, z: 250, side: 'USA' });

      // Render with clear fog — unit dot should be bright green.
      renderer.renderTerrain(hm);
      renderer.update(hm, [entity], null, defaultCamera(), 'USA');
      const ctx = renderer.getContext();
      const [, gClear] = getPixel(ctx, 50, 50, SIZE);

      // Render with full shroud — unit dot should be darkened.
      renderer.update(hm, [entity], makeShroudedFog(), defaultCamera(), 'USA');
      const [, gShroud] = getPixel(ctx, 50, 50, SIZE);

      expect(gShroud).toBeLessThan(gClear);
      // Shroud multiplier is 0.15, so green ≈ 204 * 0.15 ≈ 31.
      expect(gShroud).toBe(Math.round(204 * 0.15));
    });
  });
});
