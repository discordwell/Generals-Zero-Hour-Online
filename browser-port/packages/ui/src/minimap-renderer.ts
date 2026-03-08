/**
 * MinimapRenderer — renders a top-down radar view of the battlefield.
 *
 * Source parity: C++ RadarMap class renders a top-down view to a small texture,
 * plots colored dots for units, and supports click-to-move-camera.  The original
 * uses RADAR_CELL_WIDTH/HEIGHT = 128 but we allow a configurable size (default 200).
 */

// ---------------------------------------------------------------------------
// Public interfaces (kept decoupled from game-logic/terrain types so the
// module has no cross-package imports and is independently testable).
// ---------------------------------------------------------------------------

/** Lightweight heightmap data needed for terrain rendering. */
export interface MinimapHeightmap {
  /** World-space extent in X. */
  worldWidth: number;
  /** World-space extent in Z (depth). */
  worldDepth: number;
  /** Return interpolated world-space Y height at a world XZ position. */
  getInterpolatedHeight(worldX: number, worldZ: number): number;
}

/** Entity state used for unit dot rendering. */
export interface MinimapEntity {
  id: number;
  x: number;
  z: number;
  side?: string;
  category: 'air' | 'building' | 'infantry' | 'vehicle' | 'unknown';
}

/** Fog-of-war texture data as returned by gameLogic.getFogOfWarTextureData(). */
export interface MinimapFogData {
  cellsWide: number;
  cellsDeep: number;
  cellSize: number;
  /** Each byte: 0 = SHROUDED, 1 = FOGGED, 2 = CLEAR. */
  data: Uint8Array;
}

/** Camera viewport bounds for the viewport rectangle overlay. */
export interface MinimapCameraBounds {
  targetX: number;
  targetZ: number;
  zoom: number;
  angle: number;
}

/**
 * Minimal subset of CanvasRenderingContext2D used by MinimapRenderer.
 * Allows injection of a mock for headless (Node.js) testing.
 */
export interface MinimapCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  createImageData(w: number, h: number): ImageData;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
  drawImage(image: CanvasImageSource | { width: number; height: number }, dx: number, dy: number): void;
}

/** Canvas-like object that the renderer can composite onto. */
export interface MinimapCanvas {
  width: number;
  height: number;
}

/** Factory that creates canvas + context pairs. Injected for testability. */
export type MinimapCanvasFactory = (w: number, h: number) => {
  canvas: MinimapCanvas;
  ctx: MinimapCanvasContext;
};

// ---------------------------------------------------------------------------
// MinimapRenderer
// ---------------------------------------------------------------------------

export class MinimapRenderer {
  /** Pixel size of the minimap (square). */
  readonly size: number;

  /** Compositing canvas + context. */
  private readonly canvas: MinimapCanvas;
  private readonly ctx: MinimapCanvasContext;

  /** Factory for creating additional canvases (terrain cache). */
  private readonly createCanvas: MinimapCanvasFactory;

  /** Pre-rendered terrain base layer (rendered once per map). */
  private terrainCanvas: MinimapCanvas | null = null;
  private terrainCtx: MinimapCanvasContext | null = null;

  /** Cached world dimensions from the last terrain render (for coordinate mapping). */
  private worldWidth = 0;
  private worldDepth = 0;

  constructor(size = 200, canvasFactory?: MinimapCanvasFactory) {
    this.size = size;
    this.createCanvas = canvasFactory ?? defaultCanvasFactory;

    const { canvas, ctx } = this.createCanvas(size, size);
    this.canvas = canvas;
    this.ctx = ctx;
  }

  // -----------------------------------------------------------------------
  // Layer: terrain heightmap
  // -----------------------------------------------------------------------

  /**
   * Pre-render the terrain heightmap to a cached layer.
   * Call once when a map is loaded (or when the heightmap changes).
   *
   * Color mapping mirrors main.ts: green lowlands -> brown highlands.
   * Height `h` is normalised via `t = clamp(h / 30, 0, 1)`:
   *   R: 40 + t * 80
   *   G: 60 + t * 100
   *   B: 30 + t * 40
   */
  renderTerrain(heightmap: MinimapHeightmap): void {
    this.worldWidth = heightmap.worldWidth;
    this.worldDepth = heightmap.worldDepth;

    if (!this.terrainCanvas) {
      const { canvas, ctx } = this.createCanvas(this.size, this.size);
      this.terrainCanvas = canvas;
      this.terrainCtx = ctx;
    }

    const imgData = this.terrainCtx!.createImageData(this.size, this.size);
    const pixels = imgData.data;

    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const worldX = (px / this.size) * heightmap.worldWidth;
        const worldZ = (py / this.size) * heightmap.worldDepth;
        const h = heightmap.getInterpolatedHeight(worldX, worldZ);

        // Normalise height to [0, 1].
        const t = Math.max(0, Math.min(1, h / 30));
        const r = Math.round(40 + t * 80);
        const g = Math.round(60 + t * 100);
        const b = Math.round(30 + t * 40);

        const idx = (py * this.size + px) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }

    this.terrainCtx!.putImageData(imgData, 0, 0);
  }

  // -----------------------------------------------------------------------
  // Layer: unit dots
  // -----------------------------------------------------------------------

  /**
   * Plot entity dots onto the current composited canvas.
   *
   * Colours:
   *   own units   -> bright green (#00cc00)
   *   enemy units -> red (#cc3333)
   *
   * TODO: Per-player radar colors and ally detection for full source parity
   * (C++ Radar uses player->getPlayerColor() per dot).
   *
   * Buildings get slightly larger dots (5x5) vs. units (3x3).
   */
  renderUnits(entities: readonly MinimapEntity[], localSide: string): void {
    if (this.worldWidth <= 0 || this.worldDepth <= 0) return;

    const ctx = this.ctx;

    for (const entity of entities) {
      const px = (entity.x / this.worldWidth) * this.size;
      const py = (entity.z / this.worldDepth) * this.size;

      const normalizedEntitySide = (entity.side ?? '').toUpperCase();
      const normalizedLocalSide = localSide.toUpperCase();

      const isOwn = normalizedEntitySide === normalizedLocalSide;

      // Determine dot color.
      if (isOwn) {
        ctx.fillStyle = '#00cc00'; // bright green
      } else {
        // For now treat all non-own as enemy (alliance detection can be
        // layered in later without changing the public API).
        ctx.fillStyle = '#cc3333'; // red
      }

      // Buildings render as slightly larger blips.
      const dotRadius = entity.category === 'building' ? 2 : 1;
      ctx.fillRect(
        px - dotRadius,
        py - dotRadius,
        dotRadius * 2 + 1,
        dotRadius * 2 + 1,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Layer: fog-of-war overlay
  // -----------------------------------------------------------------------

  /**
   * Darken the current composited canvas according to fog-of-war state.
   *
   * SHROUDED (0): multiply RGB by 0.15
   * FOGGED   (1): multiply RGB by 0.5
   * CLEAR    (2): no change
   *
   * Source parity: W3DRadar applies shroud by blending with a black texture.
   */
  renderFogOverlay(fogData: MinimapFogData): void {
    const imgData = this.ctx.getImageData(0, 0, this.size, this.size);
    const pixels = imgData.data;

    for (let py = 0; py < this.size; py++) {
      for (let px = 0; px < this.size; px++) {
        const fogCol = Math.floor((px / this.size) * fogData.cellsWide);
        const fogRow = Math.floor((py / this.size) * fogData.cellsDeep);
        const visibility = fogData.data[fogRow * fogData.cellsWide + fogCol] ?? 0;
        const idx = (py * this.size + px) * 4;

        if (visibility === 0) {
          // SHROUDED — darken almost completely.
          pixels[idx] = Math.round(pixels[idx]! * 0.15);
          pixels[idx + 1] = Math.round(pixels[idx + 1]! * 0.15);
          pixels[idx + 2] = Math.round(pixels[idx + 2]! * 0.15);
        } else if (visibility === 1) {
          // FOGGED — dim.
          pixels[idx] = Math.round(pixels[idx]! * 0.5);
          pixels[idx + 1] = Math.round(pixels[idx + 1]! * 0.5);
          pixels[idx + 2] = Math.round(pixels[idx + 2]! * 0.5);
        }
        // CLEAR (2) — leave as-is.
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
  }

  // -----------------------------------------------------------------------
  // Layer: camera viewport rectangle
  // -----------------------------------------------------------------------

  /**
   * Draw a white rectangle showing the current camera view on the minimap.
   *
   * Source parity: C++ Radar draws a camera frustum outline on the radar
   * texture, scaled to the radar cell resolution.
   */
  renderViewport(cameraBounds: MinimapCameraBounds): void {
    if (this.worldWidth <= 0 || this.worldDepth <= 0) return;

    const viewHalfW = cameraBounds.zoom * 0.8;
    const viewHalfH = cameraBounds.zoom * 0.5;
    const cos = Math.cos(cameraBounds.angle);
    const sin = Math.sin(cameraBounds.angle);

    const corners: readonly [number, number][] = [
      [-viewHalfW, -viewHalfH],
      [viewHalfW, -viewHalfH],
      [viewHalfW, viewHalfH],
      [-viewHalfW, viewHalfH],
    ];

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    for (let i = 0; i < corners.length; i++) {
      const [lx, lz] = corners[i]!;
      const wx = cameraBounds.targetX + lx * cos - lz * sin;
      const wz = cameraBounds.targetZ + lx * sin + lz * cos;
      const px = (wx / this.worldWidth) * this.size;
      const py = (wz / this.worldDepth) * this.size;
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }

    this.ctx.closePath();
    this.ctx.stroke();
  }

  // -----------------------------------------------------------------------
  // Composite update
  // -----------------------------------------------------------------------

  /**
   * Full-frame composite: terrain -> fog -> units -> viewport.
   * Call once per render frame.
   */
  update(
    heightmap: MinimapHeightmap,
    entities: readonly MinimapEntity[],
    fogData: MinimapFogData | null,
    cameraBounds: MinimapCameraBounds,
    localSide: string,
  ): void {
    // Ensure we have cached world dimensions even if renderTerrain was
    // not explicitly called (lazy terrain render on first update).
    if (!this.terrainCanvas) {
      this.renderTerrain(heightmap);
    }

    // Blit pre-rendered terrain as the base layer.
    this.ctx.drawImage(this.terrainCanvas as CanvasImageSource, 0, 0);

    // Draw entity dots BEFORE fog so shrouded units are hidden.
    // Source parity: C++ Radar only draws units in visible cells.
    this.renderUnits(entities, localSide);

    // Apply fog-of-war overlay (darkens both terrain and unit dots).
    if (fogData) {
      this.renderFogOverlay(fogData);
    }

    // Draw camera viewport rectangle (always visible, on top of fog).
    this.renderViewport(cameraBounds);
  }

  // -----------------------------------------------------------------------
  // Click → world coordinate mapping
  // -----------------------------------------------------------------------

  /**
   * Convert a click position (relative to minimap element, in CSS pixels) to
   * world-space XZ coordinates. Returns null if world dimensions are unknown.
   *
   * Source parity: C++ InGameUI maps mouse position on the radar window to
   * world coordinates via `(mx / radarWidth) * worldExtent`.
   */
  getWorldPositionFromClick(
    clickX: number,
    clickY: number,
  ): { x: number; z: number } | null {
    if (this.worldWidth <= 0 || this.worldDepth <= 0) return null;

    const nx = Math.max(0, Math.min(1, clickX / this.size));
    const nz = Math.max(0, Math.min(1, clickY / this.size));

    return {
      x: nx * this.worldWidth,
      z: nz * this.worldDepth,
    };
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Return the composited canvas. */
  getCanvas(): MinimapCanvas {
    return this.canvas;
  }

  /** Return the 2D rendering context (for direct manipulation / testing). */
  getContext(): MinimapCanvasContext {
    return this.ctx;
  }
}

// ---------------------------------------------------------------------------
// Default canvas factory (browser runtime)
// ---------------------------------------------------------------------------

/**
 * Default factory that creates real browser canvases.
 * Uses OffscreenCanvas when available, falls back to HTMLCanvasElement.
 */
function defaultCanvasFactory(w: number, h: number): {
  canvas: MinimapCanvas;
  ctx: MinimapCanvasContext;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d')! as unknown as MinimapCanvasContext };
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return { canvas: el, ctx: el.getContext('2d')! };
}
