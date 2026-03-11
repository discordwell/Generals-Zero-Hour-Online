/**
 * Minimal PNG encoder — converts raw RGBA pixel data to a valid PNG file.
 *
 * Uses zlib deflate for compression. Produces 8-bit RGBA (color type 6) PNGs.
 * No dependency on canvas or image libraries.
 */

import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** CRC-32 lookup table (pre-computed once). */
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  // chunk = length(4) + type(4) + data + crc(4)
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeUint32BE(chunk, 0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  // CRC covers type + data
  const crc = crc32(chunk, 4, 8 + data.length);
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}

/**
 * Encode raw RGBA pixel data as a PNG file.
 *
 * @param width  Image width in pixels
 * @param height Image height in pixels
 * @param rgba   Raw RGBA pixel data (width × height × 4 bytes)
 * @returns PNG file as Uint8Array
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(`RGBA data length ${rgba.length} does not match ${width}×${height}×4 = ${width * height * 4}`);
  }

  // IHDR: width(4) + height(4) + bitDepth(1) + colorType(1) + compression(1) + filter(1) + interlace(1)
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  // Build raw scanlines: each row = filter byte (0=None) + row RGBA data
  const rowBytes = width * 4;
  const rawData = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + rowBytes);
    rawData[rawOffset] = 0; // filter: None
    rawData.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), rawOffset + 1);
  }

  // Compress with zlib deflate
  const compressed = deflateSync(Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength));
  const idatData = new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);

  // Build chunks
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  // Assemble PNG
  const totalLength = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLength);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset); offset += PNG_SIGNATURE.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}
