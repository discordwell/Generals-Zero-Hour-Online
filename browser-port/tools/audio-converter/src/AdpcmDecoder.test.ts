import { describe, it, expect } from 'vitest';
import { parseWavHeader, decodeAdpcmToPcm } from './AdpcmDecoder.js';
import fs from 'node:fs';
import path from 'node:path';

function findFirstWav(dir: string, formatTag: number): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.wav')) continue;
    const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? dir;
    const filePath = path.join(parentPath, entry.name);
    try {
      const data = fs.readFileSync(filePath);
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const info = parseWavHeader(buf);
      if (info.formatTag === formatTag) return filePath;
    } catch {
      continue;
    }
  }
  return null;
}

describe('AdpcmDecoder', () => {
  it('parses a PCM WAV header', () => {
    // Build a minimal 44-byte PCM WAV
    const buf = new ArrayBuffer(44);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    function writeStr(offset: number, s: string) {
      for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 0x0001, true); // PCM
    view.setUint16(22, 1, true);      // mono
    view.setUint32(24, 22050, true);   // sample rate
    view.setUint32(28, 44100, true);   // byte rate
    view.setUint16(32, 2, true);       // block align
    view.setUint16(34, 16, true);      // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, 0, true);       // data size = 0

    const info = parseWavHeader(new Uint8Array(buf).buffer);
    expect(info.formatTag).toBe(0x0001);
    expect(info.channels).toBe(1);
    expect(info.sampleRate).toBe(22050);
  });

  it('decodes a retail ADPCM WAV to PCM', () => {
    const extractedDir = path.resolve(
      __dirname, '..', '..', '..', 'packages', 'app', 'public', 'assets', '_extracted',
    );
    const adpcmFile = findFirstWav(extractedDir, 0x0011);
    if (!adpcmFile) return; // skip if no retail data

    const data = fs.readFileSync(adpcmFile);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const srcInfo = parseWavHeader(buf);
    expect(srcInfo.formatTag).toBe(0x0011);

    const pcmBuf = decodeAdpcmToPcm(buf);
    const pcmInfo = parseWavHeader(pcmBuf);
    expect(pcmInfo.formatTag).toBe(0x0001);
    expect(pcmInfo.channels).toBe(srcInfo.channels);
    expect(pcmInfo.sampleRate).toBe(srcInfo.sampleRate);
    expect(pcmInfo.bitsPerSample).toBe(16);
    expect(pcmInfo.dataSize).toBeGreaterThan(0);
  });
});
