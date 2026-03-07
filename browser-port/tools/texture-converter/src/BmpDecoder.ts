/**
 * BMP (Windows Bitmap) decoder.
 *
 * Supports uncompressed 24-bit and 32-bit BMP files.
 * Only 4 BMP files exist in the retail game (installer art).
 */

import type { DecodedImage } from './TgaDecoder.js';

export class BmpDecoder {
  static decode(buffer: ArrayBuffer): DecodedImage {
    const view = new DataView(buffer);

    // BMP file header (14 bytes)
    const magic = view.getUint16(0, false);
    if (magic !== 0x424D) { // 'BM'
      throw new Error('Not a BMP file');
    }

    const pixelDataOffset = view.getUint32(10, true);

    // DIB header
    const dibSize = view.getUint32(14, true);
    const width = view.getInt32(18, true);
    const rawHeight = view.getInt32(22, true);
    const height = Math.abs(rawHeight);
    const topDown = rawHeight < 0;
    const bitCount = view.getUint16(28, true);
    const compression = view.getUint32(30, true);

    if (compression !== 0) {
      throw new Error(`Unsupported BMP compression: ${compression}`);
    }

    if (bitCount !== 24 && bitCount !== 32) {
      throw new Error(`Unsupported BMP bit depth: ${bitCount}`);
    }

    const bytesPerPixel = bitCount / 8;
    const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;

    const rgba = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : (height - 1 - y);
      const rowStart = pixelDataOffset + srcY * rowStride;

      for (let x = 0; x < width; x++) {
        const srcIdx = rowStart + x * bytesPerPixel;
        const dstIdx = (y * width + x) * 4;

        // BMP is BGR(A) order
        rgba[dstIdx] = view.getUint8(srcIdx + 2);     // R
        rgba[dstIdx + 1] = view.getUint8(srcIdx + 1); // G
        rgba[dstIdx + 2] = view.getUint8(srcIdx);     // B
        rgba[dstIdx + 3] = bitCount === 32 ? view.getUint8(srcIdx + 3) : 255;
      }
    }

    return { width, height, data: rgba };
  }
}
