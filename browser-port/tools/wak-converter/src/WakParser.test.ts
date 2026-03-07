import { describe, it, expect } from 'vitest';
import { parseWak } from './WakParser.js';
import fs from 'node:fs';
import path from 'node:path';

describe('WakParser', () => {
  it('parses a synthetic WAK buffer', () => {
    // 1 track + 4-byte count = 24 bytes total
    const buf = new ArrayBuffer(24);
    const view = new DataView(buf);
    view.setFloat32(0, 100.0, true);   // startX
    view.setFloat32(4, 200.0, true);   // startY
    view.setFloat32(8, 300.0, true);   // endX
    view.setFloat32(12, 400.0, true);  // endY
    view.setInt32(16, 4, true);        // waveType
    view.setInt32(20, 1, true);        // trackCount

    const result = parseWak(buf);
    expect(result.trackCount).toBe(1);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]!.startX).toBeCloseTo(100.0);
    expect(result.tracks[0]!.startY).toBeCloseTo(200.0);
    expect(result.tracks[0]!.endX).toBeCloseTo(300.0);
    expect(result.tracks[0]!.endY).toBeCloseTo(400.0);
    expect(result.tracks[0]!.waveType).toBe(4);
  });

  it('parses a retail WAK file', () => {
    const wakPath = path.resolve(
      __dirname, '..', '..', '..', 'packages', 'app', 'public', 'assets',
      '_extracted', 'MapsZH', 'Maps', 'MD_ShellMap', 'MD_ShellMap.wak',
    );
    if (!fs.existsSync(wakPath)) return;

    const data = fs.readFileSync(wakPath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = parseWak(buf);

    // We verified earlier: 1904 bytes, last 4 bytes = 95, (1904-4)/20 = 95
    expect(result.trackCount).toBe(95);
    expect(result.tracks).toHaveLength(95);
    // All tracks should have valid float positions and wave types
    for (const track of result.tracks) {
      expect(Number.isFinite(track.startX)).toBe(true);
      expect(Number.isFinite(track.startY)).toBe(true);
      expect(track.waveType).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles empty files', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setInt32(0, 0, true);

    const result = parseWak(buf);
    expect(result.trackCount).toBe(0);
    expect(result.tracks).toHaveLength(0);
  });
});
