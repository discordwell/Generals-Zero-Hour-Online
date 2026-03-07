import { describe, it, expect } from 'vitest';
import { BmpDecoder } from './BmpDecoder.js';
import fs from 'node:fs';
import path from 'node:path';

function buildBmp24(width: number, height: number, fill: { r: number; g: number; b: number }): ArrayBuffer {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = 14 + 40 + pixelDataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // File header (14 bytes)
  bytes[0] = 0x42; bytes[1] = 0x4D; // 'BM'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true); // pixel data offset

  // DIB header (40 bytes - BITMAPINFOHEADER)
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive = bottom-up
  view.setUint16(26, 1, true);    // planes
  view.setUint16(28, 24, true);   // bit count
  view.setUint32(30, 0, true);    // compression (none)

  // Pixel data (BGR, bottom-up)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = 54 + y * rowStride + x * 3;
      bytes[idx] = fill.b;
      bytes[idx + 1] = fill.g;
      bytes[idx + 2] = fill.r;
    }
  }

  return buf;
}

describe('BmpDecoder', () => {
  it('decodes a synthetic 24-bit BMP', () => {
    const buf = buildBmp24(4, 3, { r: 255, g: 128, b: 64 });
    const result = BmpDecoder.decode(buf);
    expect(result.width).toBe(4);
    expect(result.height).toBe(3);
    expect(result.data.length).toBe(4 * 3 * 4);
    // Check first pixel (should be the fill color)
    expect(result.data[0]).toBe(255); // R
    expect(result.data[1]).toBe(128); // G
    expect(result.data[2]).toBe(64);  // B
    expect(result.data[3]).toBe(255); // A (opaque for 24-bit)
  });

  it('decodes a retail BMP file', () => {
    const bmpPath = path.resolve(
      __dirname, '..', '..', '..', '..', 'retail', 'installed', 'Install_Final.bmp',
    );
    if (!fs.existsSync(bmpPath)) return;

    const data = fs.readFileSync(bmpPath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = BmpDecoder.decode(buf);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.data.length).toBe(result.width * result.height * 4);
  });
});
