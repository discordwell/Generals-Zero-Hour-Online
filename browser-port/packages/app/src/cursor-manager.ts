/**
 * Cursor manager — loads converted ANI cursor data and renders animated
 * game cursors on a transparent overlay canvas.
 *
 * Source parity: Mouse.h MouseCursor enum / W3DMouse.cpp rendering.
 *
 * The overlay canvas sits on top of the game canvas with pointer-events: none.
 * The native CSS cursor is hidden when the cursor manager is active.
 */

import { RUNTIME_ASSET_BASE_URL } from '@generals/assets';
import type { RuntimeManifest } from '@generals/assets';

/** JSON metadata written by cursor-converter. */
export interface CursorMeta {
  numFrames: number;
  frameWidth: number;
  frameHeight: number;
  /** Jiffies (1/60s) base display rate. */
  displayRate: number;
  /** Frame display sequence indices. */
  sequence: number[];
  /** Per-frame display rates (jiffies), may override displayRate. */
  rates: number[];
  /** Per-frame hotspot coordinates. */
  hotspots: Array<{ x: number; y: number }>;
}

interface CachedCursor {
  meta: CursorMeta;
  frames: ImageData[];
}

/** Milliseconds per jiffy (1/60 s). */
const JIFFY_MS = 1000 / 60;

/**
 * CursorManager renders animated game cursors on an overlay canvas.
 */
export class CursorManager {
  private readonly cache = new Map<string, CachedCursor>();
  private readonly loading = new Set<string>();
  private activeCursorName: string | null = null;
  private currentFrame = 0;
  private frameTimer = 0;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private gameCanvas: HTMLCanvasElement | null = null;
  private cursorIndex: Map<string, string> | null = null;
  private disposed = false;

  /**
   * Build a name→outputPath index from cursor-converter manifest entries.
   * Maps e.g. "SCCPointer" → "cursors/SCCPointer.json"
   */
  buildCursorIndex(manifest: RuntimeManifest): void {
    const index = new Map<string, string>();
    for (const entry of manifest.raw.entries) {
      if (entry.converter !== 'cursor-converter') continue;
      if (!entry.outputPath.endsWith('.json')) continue;
      const lastSlash = entry.outputPath.lastIndexOf('/');
      const filename = lastSlash >= 0 ? entry.outputPath.slice(lastSlash + 1) : entry.outputPath;
      const name = filename.slice(0, -5); // strip .json
      index.set(name.toLowerCase(), entry.outputPath);
    }
    this.cursorIndex = index;
  }

  /**
   * Attach to a game canvas — creates the transparent overlay canvas
   * and hides the native CSS cursor.
   */
  attach(gameCanvas: HTMLCanvasElement): void {
    if (this.overlayCanvas) {
      this.overlayCanvas.remove();
    }
    this.gameCanvas = gameCanvas;

    const overlay = document.createElement('canvas');
    overlay.id = 'cursor-overlay';
    overlay.width = gameCanvas.width;
    overlay.height = gameCanvas.height;
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '9999',
    });
    gameCanvas.parentElement?.appendChild(overlay);

    this.overlayCanvas = overlay;
    this.overlayCtx = overlay.getContext('2d', { willReadFrequently: false });
    gameCanvas.style.cursor = 'none';
  }

  /**
   * Preload a cursor by name (e.g., "SCCPointer").
   * Returns immediately if already cached or loading.
   */
  async preload(name: string): Promise<void> {
    const key = name.toLowerCase();
    if (this.cache.has(key) || this.loading.has(key)) return;
    this.loading.add(key);
    try {
      const cursor = await this.loadCursor(name);
      if (cursor && !this.disposed) {
        this.cache.set(key, cursor);
      }
    } finally {
      this.loading.delete(key);
    }
  }

  /** Switch the active cursor. Resets animation. */
  setCursor(name: string): void {
    const key = name.toLowerCase();
    if (this.activeCursorName === key) return;
    this.activeCursorName = key;
    this.currentFrame = 0;
    this.frameTimer = 0;
  }

  /** Advance animation timer. dt in seconds. */
  update(dt: number): void {
    const cursor = this.getActiveCursor();
    if (!cursor) return;

    const { meta } = cursor;
    if (meta.numFrames <= 1) return;

    const dtMs = dt * 1000;
    this.frameTimer += dtMs;

    // Per-frame rate (jiffies) or fallback to displayRate
    const rate = meta.rates[this.currentFrame] ?? meta.displayRate;
    const frameDuration = rate * JIFFY_MS;

    while (this.frameTimer >= frameDuration && frameDuration > 0) {
      this.frameTimer -= frameDuration;
      this.currentFrame = (this.currentFrame + 1) % meta.numFrames;
    }
  }

  /** Draw the current cursor frame at the given mouse position. */
  draw(mouseX: number, mouseY: number): void {
    const ctx = this.overlayCtx;
    const overlay = this.overlayCanvas;
    if (!ctx || !overlay) return;

    // Sync overlay size with game canvas
    if (this.gameCanvas) {
      if (overlay.width !== this.gameCanvas.width) overlay.width = this.gameCanvas.width;
      if (overlay.height !== this.gameCanvas.height) overlay.height = this.gameCanvas.height;
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const cursor = this.getActiveCursor();
    if (!cursor) return;

    const { meta, frames } = cursor;
    const seqIdx = meta.sequence[this.currentFrame] ?? this.currentFrame;
    const frame = frames[seqIdx];
    if (!frame) return;

    const hotspot = meta.hotspots[seqIdx] ?? { x: 0, y: 0 };
    const drawX = Math.round(mouseX - hotspot.x);
    const drawY = Math.round(mouseY - hotspot.y);

    ctx.putImageData(frame, drawX, drawY);
  }

  /** Clean up DOM elements. */
  dispose(): void {
    this.disposed = true;
    if (this.overlayCanvas) {
      this.overlayCanvas.remove();
      this.overlayCanvas = null;
      this.overlayCtx = null;
    }
    if (this.gameCanvas) {
      this.gameCanvas.style.cursor = '';
      this.gameCanvas = null;
    }
    this.cache.clear();
  }

  /** Whether any cursor data has been loaded. */
  get isReady(): boolean {
    return this.cache.size > 0;
  }

  private getActiveCursor(): CachedCursor | undefined {
    if (!this.activeCursorName) return undefined;
    return this.cache.get(this.activeCursorName);
  }

  private async loadCursor(name: string): Promise<CachedCursor | null> {
    const jsonPath = this.resolveCursorPath(name);
    if (!jsonPath) return null;

    const rgbaPath = jsonPath.replace(/\.json$/, '_frames.rgba');

    try {
      const [metaResponse, rgbaResponse] = await Promise.all([
        fetch(`${RUNTIME_ASSET_BASE_URL}/${jsonPath}`),
        fetch(`${RUNTIME_ASSET_BASE_URL}/${rgbaPath}`),
      ]);

      if (!metaResponse.ok || !rgbaResponse.ok) return null;

      const meta: CursorMeta = await metaResponse.json();
      const rgbaBuf = await rgbaResponse.arrayBuffer();

      const frames = parseSpriteSheet(rgbaBuf, meta);
      return { meta, frames };
    } catch {
      return null;
    }
  }

  private resolveCursorPath(name: string): string | null {
    if (this.cursorIndex) {
      return this.cursorIndex.get(name.toLowerCase()) ?? null;
    }
    // Fallback: convention-based path
    return `cursors/${name}.json`;
  }
}

/**
 * Parse a sprite sheet RGBA file into individual ImageData frames.
 * File format: u32 LE width, u32 LE height, then raw RGBA pixels.
 */
function parseSpriteSheet(buffer: ArrayBuffer, meta: CursorMeta): ImageData[] {
  const view = new DataView(buffer);
  const sheetWidth = view.getUint32(0, true);
  // sheetHeight at offset 4 is not needed — frame count comes from meta
  const headerSize = 8;
  const pixelData = new Uint8Array(buffer, headerSize);

  const { frameWidth, frameHeight } = meta;
  const totalFrames = meta.numFrames;
  const requiredBytes = sheetWidth * frameHeight * totalFrames * 4;
  if (pixelData.length < requiredBytes) {
    return [];
  }
  const frames: ImageData[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const frameData = new Uint8ClampedArray(frameWidth * frameHeight * 4);
    const srcRowBytes = sheetWidth * 4;
    const yOffset = i * frameHeight;

    for (let row = 0; row < frameHeight; row++) {
      const srcStart = (yOffset + row) * srcRowBytes;
      const dstStart = row * frameWidth * 4;
      frameData.set(
        pixelData.subarray(srcStart, srcStart + frameWidth * 4),
        dstStart,
      );
    }

    frames.push(new ImageData(frameData, frameWidth, frameHeight));
  }

  return frames;
}

/** Exported for testing. */
export { parseSpriteSheet, JIFFY_MS };

/**
 * Resolve which cursor name to display based on game state.
 *
 * Source parity: InGameUI.cpp resolves cursor type from hover/selection state.
 */
export function resolveGameCursor(opts: {
  hasSelection: boolean;
  hoverTarget: 'none' | 'own-unit' | 'enemy' | 'ground';
  edgeScrollDir: number | null;
  pendingAbility: boolean;
  isAttackMode?: boolean;
}): string {
  // Edge scroll cursors: SCCScroll0 through SCCScroll7
  if (opts.edgeScrollDir !== null) {
    return `SCCScroll${opts.edgeScrollDir}`;
  }

  if (opts.pendingAbility) {
    return 'SCCTarget';
  }

  // Source parity: holding 'A' key shows attack cursor over ground/units.
  if (opts.hasSelection && opts.isAttackMode) {
    return 'SCCAttack';
  }

  if (opts.hasSelection) {
    switch (opts.hoverTarget) {
      case 'enemy':
        return 'SCCAttack';
      case 'own-unit':
        return 'SCCSelect';
      case 'ground':
        return 'SCCMove';
      default:
        return 'SCCMove';
    }
  }

  if (opts.hoverTarget === 'own-unit') {
    return 'SCCSelect';
  }

  return 'SCCPointer';
}

/**
 * Detect edge scroll direction from mouse position.
 * Returns 0-7 (N, NE, E, SE, S, SW, W, NW) or null if not at an edge.
 */
export function detectEdgeScrollDir(
  mouseX: number,
  mouseY: number,
  viewportWidth: number,
  viewportHeight: number,
  edgeSize: number,
): number | null {
  const atLeft = mouseX < edgeSize;
  const atRight = mouseX > viewportWidth - edgeSize;
  const atTop = mouseY < edgeSize;
  const atBottom = mouseY > viewportHeight - edgeSize;

  if (!atLeft && !atRight && !atTop && !atBottom) return null;

  // Directions: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
  if (atTop && !atLeft && !atRight) return 0;
  if (atTop && atRight) return 1;
  if (atRight && !atTop && !atBottom) return 2;
  if (atBottom && atRight) return 3;
  if (atBottom && !atLeft && !atRight) return 4;
  if (atBottom && atLeft) return 5;
  if (atLeft && !atTop && !atBottom) return 6;
  if (atTop && atLeft) return 7;

  return null;
}
