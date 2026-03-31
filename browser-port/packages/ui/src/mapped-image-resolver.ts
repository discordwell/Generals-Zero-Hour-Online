/**
 * MappedImage resolver — crops sub-regions from atlas textures and returns
 * image URLs suitable for <img> src attributes.
 *
 * Source parity: the C++ engine loads MappedImage INI blocks that define
 * named sub-regions within larger atlas textures (e.g., SSA10Attack is a
 * 22x24 pixel rectangle within SSUserInterface512_001.tga). This module
 * replicates that lookup for browser rendering.
 *
 * Atlas textures are stored as `.rgba` files: 4-byte LE width, 4-byte LE
 * height, then width * height * 4 bytes of raw RGBA pixel data.
 */

export interface MappedImageEntry {
  name: string;
  texture: string;
  textureWidth: number;
  textureHeight: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  rotated: boolean;
}

/**
 * Resolves MappedImage names to cropped image URLs by loading atlas `.rgba`
 * textures and extracting the specified sub-region.
 */
export class MappedImageResolver {
  private readonly entries = new Map<string, MappedImageEntry>();
  private readonly atlasCache = new Map<string, Promise<ImageData>>();
  private readonly imageUrlCache = new Map<string, Promise<string>>();
  private readonly textureBasePath: string;

  /**
   * @param textureBasePath Base URL path for atlas textures
   *   (e.g., "assets/textures/Art/Textures"). Texture filenames from
   *   MappedImage INI blocks (like "SSUserInterface512_001.tga") are lowercased
   *   and the extension replaced with ".rgba".
   */
  constructor(textureBasePath: string) {
    this.textureBasePath = textureBasePath.replace(/\/+$/, '');
  }

  /** Register MappedImage entries (typically from IniDataRegistry). */
  addEntries(entries: readonly MappedImageEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.name, entry);
    }
  }

  /** Look up a MappedImage entry by name. */
  getEntry(name: string): MappedImageEntry | undefined {
    return this.entries.get(name);
  }

  /**
   * Resolve a MappedImage name to an image URL (data: or blob: URL).
   * Returns null if the name is not registered.
   * Results are cached — repeated calls for the same name return the same URL.
   */
  async resolve(name: string): Promise<string | null> {
    const entry = this.entries.get(name);
    if (!entry) {
      return null;
    }

    const cached = this.imageUrlCache.get(name);
    if (cached) {
      return cached;
    }

    const promise = this.cropImage(entry);
    this.imageUrlCache.set(name, promise);
    return promise;
  }

  /** Number of registered MappedImage entries. */
  get size(): number {
    return this.entries.size;
  }

  private async cropImage(entry: MappedImageEntry): Promise<string> {
    const atlasImageData = await this.loadAtlas(entry.texture);

    // Compute crop dimensions from the Coords
    const cropWidth = entry.right - entry.left + 1;
    const cropHeight = entry.bottom - entry.top + 1;

    if (cropWidth <= 0 || cropHeight <= 0) {
      // Degenerate region — return a 1x1 transparent pixel
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    }

    // Create a canvas for the cropped region
    const canvas = createCanvas(cropWidth, cropHeight);
    const ctx = canvas.getContext('2d')!;

    // Extract the sub-region from the atlas pixel data
    const croppedData = ctx.createImageData(cropWidth, cropHeight);
    const src = atlasImageData.data;
    const dst = croppedData.data;
    const atlasWidth = atlasImageData.width;

    for (let y = 0; y < cropHeight; y++) {
      const srcY = entry.top + y;
      if (srcY < 0 || srcY >= atlasImageData.height) continue;
      for (let x = 0; x < cropWidth; x++) {
        const srcX = entry.left + x;
        if (srcX < 0 || srcX >= atlasWidth) continue;
        const srcIdx = (srcY * atlasWidth + srcX) * 4;
        const dstIdx = (y * cropWidth + x) * 4;
        dst[dstIdx] = src[srcIdx]!;
        dst[dstIdx + 1] = src[srcIdx + 1]!;
        dst[dstIdx + 2] = src[srcIdx + 2]!;
        dst[dstIdx + 3] = src[srcIdx + 3]!;
      }
    }

    ctx.putImageData(croppedData, 0, 0);

    // Handle rotation if needed
    if (entry.rotated) {
      return this.rotateCanvas(canvas, cropWidth, cropHeight);
    }

    return canvasToDataUrl(canvas);
  }

  /**
   * Rotate the cropped image 90 degrees counter-clockwise to undo
   * the ROTATED_90_CLOCKWISE packing status.
   */
  private rotateCanvas(
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    width: number,
    height: number,
  ): string {
    // After un-rotating 90 CW, the output dimensions swap
    const outCanvas = createCanvas(height, width);
    const outCtx = outCanvas.getContext('2d')!;

    // Rotate -90 degrees (counter-clockwise) to undo the clockwise packing
    outCtx.translate(0, width);
    outCtx.rotate(-Math.PI / 2);
    outCtx.drawImage(sourceCanvas as HTMLCanvasElement, 0, 0);

    return canvasToDataUrl(outCanvas);
  }

  private loadAtlas(textureName: string): Promise<ImageData> {
    // Normalize: lowercase, replace .tga with .rgba
    const normalizedName = textureName.toLowerCase().replace(/\.tga$/i, '.rgba');
    const cached = this.atlasCache.get(normalizedName);
    if (cached) {
      return cached;
    }

    const url = `${this.textureBasePath}/${normalizedName}`;
    const promise = fetchAndDecodeRgba(url);
    this.atlasCache.set(normalizedName, promise);
    return promise;
  }
}

/**
 * Fetch a `.rgba` file and decode it into ImageData.
 * Format: 4-byte LE width, 4-byte LE height, then width*height*4 RGBA bytes.
 */
async function fetchAndDecodeRgba(url: string): Promise<ImageData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch atlas texture: ${url} (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);

  if (buffer.byteLength < 8) {
    throw new Error(`Atlas texture too small: ${url} (${buffer.byteLength} bytes)`);
  }

  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const expectedSize = 8 + width * height * 4;

  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `Atlas texture truncated: ${url} — expected ${expectedSize} bytes, got ${buffer.byteLength}`,
    );
  }

  const pixels = new Uint8ClampedArray(buffer, 8, width * height * 4);
  return new ImageData(pixels, width, height);
}

/** Create a canvas element suitable for the current environment. */
function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Convert a canvas to a data URL. */
function canvasToDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas): string {
  if (canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/png');
  }
  // OffscreenCanvas fallback — shouldn't normally reach here since we use HTMLCanvasElement
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = canvas.width;
  tmpCanvas.height = canvas.height;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.drawImage(canvas, 0, 0);
  return tmpCanvas.toDataURL('image/png');
}
