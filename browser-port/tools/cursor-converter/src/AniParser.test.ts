import { describe, it, expect } from 'vitest';
import { parseAni } from './AniParser.js';
import fs from 'node:fs';
import path from 'node:path';

describe('AniParser', () => {
  it('parses a retail ANI cursor file', () => {
    const aniPath = path.resolve(
      __dirname, '..', '..', '..', '..', 'retail', 'installed', 'SCCMove_S.ani',
    );
    if (!fs.existsSync(aniPath)) return; // skip if no retail data

    const data = fs.readFileSync(aniPath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = parseAni(buf);

    expect(result.header.numFrames).toBeGreaterThan(0);
    expect(result.frames.length).toBe(result.header.numFrames);
    expect(result.sequence.length).toBeGreaterThan(0);
    // Each frame should have RGBA data
    for (const frame of result.frames) {
      expect(frame.rgba.length).toBe(frame.width * frame.height * 4);
    }
  });

  it('parses a retail select cursor', () => {
    const aniPath = path.resolve(
      __dirname, '..', '..', '..', '..', 'retail', 'installed', 'SCCSelect.ani',
    );
    if (!fs.existsSync(aniPath)) return;

    const data = fs.readFileSync(aniPath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = parseAni(buf);

    expect(result.header.numFrames).toBeGreaterThan(0);
    expect(result.rates.length).toBeGreaterThan(0);
  });
});
