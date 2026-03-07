/**
 * ANI (Animated Cursor) parser.
 *
 * RIFF container with:
 *   anih: header (num_frames, display_rate, width, height, etc.)
 *   seq : frame sequence order
 *   rate: per-frame display rates
 *   LIST/fram: individual frames as ICO/CUR data
 *
 * C++ ref: GeneralsMD/Code/GameEngineDevice/Source/Win32Device/GameClient/Win32Mouse.cpp:376-396
 */

export interface AniHeader {
  headerSize: number;
  numFrames: number;
  numSteps: number;
  width: number;
  height: number;
  bitCount: number;
  numPlanes: number;
  displayRate: number; // jiffies (1/60s)
  flags: number;
}

export interface AniFrame {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  rgba: Uint8Array;
}

export interface AniData {
  header: AniHeader;
  sequence: number[];
  rates: number[];
  frames: AniFrame[];
}

function readChunkHeader(view: DataView, offset: number): { id: string; size: number } {
  const id = String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
  const size = view.getUint32(offset + 4, true);
  return { id, size };
}

function parseIcoFrame(data: Uint8Array): AniFrame {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // ICO/CUR header: reserved(2), type(2), count(2)
  const type = view.getUint16(2, true); // 1=ICO, 2=CUR
  const count = view.getUint16(4, true);

  if (count === 0) {
    return { width: 32, height: 32, hotspotX: 0, hotspotY: 0, rgba: new Uint8Array(32 * 32 * 4) };
  }

  // Directory entry (16 bytes): width, height, colorCount, reserved, hotspotX, hotspotY, dataSize, dataOffset
  const width = view.getUint8(6) || 32;
  const height = view.getUint8(7) || 32;
  let hotspotX = view.getUint16(10, true);
  let hotspotY = view.getUint16(12, true);
  const dataSize = view.getUint32(14, true);
  const dataOffset = view.getUint32(18, true);

  // For ICO type, hotspot fields are actually planes/bitcount
  if (type === 1) {
    hotspotX = 0;
    hotspotY = 0;
  }

  // BMP info header at dataOffset
  const bmpOffset = dataOffset;
  const biSize = view.getUint32(bmpOffset, true);
  const biWidth = view.getInt32(bmpOffset + 4, true);
  const biHeight = view.getInt32(bmpOffset + 8, true); // double height (XOR + AND masks)
  const biBitCount = view.getUint16(bmpOffset + 14, true);
  const actualHeight = Math.abs(biHeight) / 2; // ICO height is doubled

  const rgba = new Uint8Array(width * actualHeight * 4);

  if (biBitCount === 32) {
    // 32-bit BGRA
    const pixelOffset = bmpOffset + biSize;
    for (let y = 0; y < actualHeight; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = pixelOffset + ((actualHeight - 1 - y) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        if (srcIdx + 3 < data.length) {
          rgba[dstIdx] = view.getUint8(srcIdx + 2);     // R
          rgba[dstIdx + 1] = view.getUint8(srcIdx + 1); // G
          rgba[dstIdx + 2] = view.getUint8(srcIdx);     // B
          rgba[dstIdx + 3] = view.getUint8(srcIdx + 3); // A
        }
      }
    }
  } else if (biBitCount === 24) {
    // 24-bit BGR + AND mask
    const rowBytes = Math.ceil(width * 3 / 4) * 4;
    const pixelOffset = bmpOffset + biSize;
    const andMaskOffset = pixelOffset + rowBytes * actualHeight;
    const andRowBytes = Math.ceil(width / 8 / 4) * 4;

    for (let y = 0; y < actualHeight; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = pixelOffset + (actualHeight - 1 - y) * rowBytes + x * 3;
        const dstIdx = (y * width + x) * 4;
        if (srcIdx + 2 < data.length) {
          rgba[dstIdx] = view.getUint8(srcIdx + 2);
          rgba[dstIdx + 1] = view.getUint8(srcIdx + 1);
          rgba[dstIdx + 2] = view.getUint8(srcIdx);
        }
        // AND mask
        const andIdx = andMaskOffset + (actualHeight - 1 - y) * andRowBytes + Math.floor(x / 8);
        if (andIdx < data.length) {
          const andBit = (view.getUint8(andIdx) >> (7 - (x % 8))) & 1;
          rgba[dstIdx + 3] = andBit ? 0 : 255;
        } else {
          rgba[dstIdx + 3] = 255;
        }
      }
    }
  } else if (biBitCount <= 8) {
    // Paletted
    const colorCount = biBitCount === 8 ? 256 : (1 << biBitCount);
    const paletteOffset = bmpOffset + biSize;
    const palette = new Uint8Array(colorCount * 4);
    for (let i = 0; i < colorCount * 4 && paletteOffset + i < data.length; i++) {
      palette[i] = view.getUint8(paletteOffset + i);
    }

    const pixelsPerByte = 8 / biBitCount;
    const rowBytes = Math.ceil(width / pixelsPerByte / 4) * 4;
    const pixelOffset = paletteOffset + colorCount * 4;
    const andMaskOffset = pixelOffset + rowBytes * actualHeight;
    const andRowBytes = Math.ceil(width / 8 / 4) * 4;

    for (let y = 0; y < actualHeight; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = pixelOffset + (actualHeight - 1 - y) * rowBytes;
        const byteIdx = Math.floor(x / pixelsPerByte);
        const bitShift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * biBitCount;
        const mask = (1 << biBitCount) - 1;
        const colorIdx = (view.getUint8(srcIdx + byteIdx) >> bitShift) & mask;

        const dstIdx = (y * width + x) * 4;
        rgba[dstIdx] = palette[colorIdx * 4 + 2]!;     // R
        rgba[dstIdx + 1] = palette[colorIdx * 4 + 1]!; // G
        rgba[dstIdx + 2] = palette[colorIdx * 4]!;     // B

        const andIdx = andMaskOffset + (actualHeight - 1 - y) * andRowBytes + Math.floor(x / 8);
        if (andIdx < data.length) {
          const andBit = (view.getUint8(andIdx) >> (7 - (x % 8))) & 1;
          rgba[dstIdx + 3] = andBit ? 0 : 255;
        } else {
          rgba[dstIdx + 3] = 255;
        }
      }
    }
  }

  return { width, height: actualHeight, hotspotX, hotspotY, rgba };
}

export function parseAni(buffer: ArrayBuffer): AniData {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // RIFF header
  const riff = readChunkHeader(view, 0);
  if (riff.id !== 'RIFF') throw new Error('Not a RIFF file');

  const formType = String.fromCharCode(
    view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11),
  );
  if (formType !== 'ACON') throw new Error(`Expected ACON, got ${formType}`);

  let header: AniHeader = {
    headerSize: 36, numFrames: 0, numSteps: 0,
    width: 32, height: 32, bitCount: 0, numPlanes: 0,
    displayRate: 5, flags: 0,
  };
  let sequence: number[] = [];
  let rates: number[] = [];
  const frames: AniFrame[] = [];

  let offset = 12;
  const end = 8 + riff.size;

  while (offset < end && offset < buffer.byteLength - 8) {
    const chunk = readChunkHeader(view, offset);
    const chunkDataStart = offset + 8;

    if (chunk.id === 'anih') {
      header = {
        headerSize: view.getUint32(chunkDataStart, true),
        numFrames: view.getUint32(chunkDataStart + 4, true),
        numSteps: view.getUint32(chunkDataStart + 8, true),
        width: view.getUint32(chunkDataStart + 12, true),
        height: view.getUint32(chunkDataStart + 16, true),
        bitCount: view.getUint32(chunkDataStart + 20, true),
        numPlanes: view.getUint32(chunkDataStart + 24, true),
        displayRate: view.getUint32(chunkDataStart + 28, true),
        flags: view.getUint32(chunkDataStart + 32, true),
      };
    } else if (chunk.id === 'seq ') {
      const count = chunk.size / 4;
      sequence = [];
      for (let i = 0; i < count; i++) {
        sequence.push(view.getUint32(chunkDataStart + i * 4, true));
      }
    } else if (chunk.id === 'rate') {
      const count = chunk.size / 4;
      rates = [];
      for (let i = 0; i < count; i++) {
        rates.push(view.getUint32(chunkDataStart + i * 4, true));
      }
    } else if (chunk.id === 'LIST') {
      const listType = String.fromCharCode(
        view.getUint8(chunkDataStart), view.getUint8(chunkDataStart + 1),
        view.getUint8(chunkDataStart + 2), view.getUint8(chunkDataStart + 3),
      );

      if (listType === 'fram') {
        let frameOffset = chunkDataStart + 4;
        const listEnd = chunkDataStart + chunk.size;
        while (frameOffset < listEnd && frameOffset < buffer.byteLength - 8) {
          const frameChunk = readChunkHeader(view, frameOffset);
          if (frameChunk.id === 'icon') {
            const frameData = bytes.slice(frameOffset + 8, frameOffset + 8 + frameChunk.size);
            frames.push(parseIcoFrame(frameData));
          }
          frameOffset += 8 + frameChunk.size;
          if (frameChunk.size % 2 !== 0) frameOffset++;
        }
      }
    }

    offset += 8 + chunk.size;
    if (chunk.size % 2 !== 0) offset++;
  }

  // Default sequence if none provided
  if (sequence.length === 0) {
    sequence = Array.from({ length: header.numFrames }, (_, i) => i);
  }

  // Default rates if none provided
  if (rates.length === 0) {
    rates = Array.from({ length: header.numSteps || header.numFrames }, () => header.displayRate);
  }

  return { header, sequence, rates, frames };
}
