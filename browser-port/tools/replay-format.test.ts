/**
 * Replay-format header parser smoke tests.
 *
 * We don't have real .rep fixtures yet, so this synthesizes a minimal
 * GENREP header and confirms the parser round-trips the structured fields.
 * When real replays land under fixtures/replays/, switch to those.
 */
import { describe, expect, it } from 'vitest';

import { isReplayFile, parseReplayHeader, REPLAY_MAX_SLOTS } from './replay-format';

function buildSyntheticHeader(): ArrayBuffer {
  // Allocate generously; we'll truncate to the final write offset.
  const buf = new ArrayBuffer(2048);
  const view = new DataView(buf);
  let off = 0;
  const writeUInt32 = (v: number): void => {
    view.setUint32(off, v >>> 0, true);
    off += 4;
  };
  const writeUInt8 = (v: number): void => {
    view.setUint8(off, v & 0xff);
    off += 1;
  };
  const writeBool32 = (v: boolean): void => writeUInt32(v ? 1 : 0);
  const writeAscii = (s: string): void => {
    for (let i = 0; i < s.length; i += 1) writeUInt8(s.charCodeAt(i));
  };
  const writeAsciiZ = (s: string): void => {
    writeAscii(s);
    writeUInt8(0);
  };
  const writeWideZ = (s: string): void => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint16(off, s.charCodeAt(i), true);
      off += 2;
    }
    view.setUint16(off, 0, true);
    off += 2;
  };

  writeAscii('GENREP');
  writeUInt32(1_700_000_000); // startTime
  writeUInt32(1_700_000_300); // endTime
  writeUInt32(9000);           // frameDuration
  writeBool32(false);          // desync
  writeBool32(false);          // quitEarly
  for (let i = 0; i < REPLAY_MAX_SLOTS; i += 1) writeBool32(false);
  writeWideZ('Last Replay');
  // SYSTEMTIME — 8 WORDs
  view.setUint16(off, 2026, true); off += 2; // year
  view.setUint16(off, 5, true); off += 2;    // month
  view.setUint16(off, 3, true); off += 2;    // dayOfWeek
  view.setUint16(off, 20, true); off += 2;   // day
  view.setUint16(off, 12, true); off += 2;   // hour
  view.setUint16(off, 34, true); off += 2;   // minute
  view.setUint16(off, 56, true); off += 2;   // second
  view.setUint16(off, 789, true); off += 2;  // milliseconds

  writeWideZ('1.04.0001');
  writeWideZ('May 20 2026');
  writeUInt32(10401);    // versionNumber
  writeUInt32(0xdead0001); // exeCRC
  writeUInt32(0xbeef0002); // iniCRC
  writeAsciiZ('US=H'); // gameOptions stub
  writeAsciiZ('0');    // localPlayerIndex

  return buf.slice(0, off);
}

describe('replay-format parseReplayHeader', () => {
  it('round-trips a synthetic GENREP header', () => {
    const buf = buildSyntheticHeader();
    expect(isReplayFile(buf)).toBe(true);
    const header = parseReplayHeader(buf);
    expect(header.magic).toBe('GENREP');
    expect(header.startTime).toBe(1_700_000_000);
    expect(header.endTime).toBe(1_700_000_300);
    expect(header.frameDuration).toBe(9000);
    expect(header.desyncGame).toBe(false);
    expect(header.quitEarly).toBe(false);
    expect(header.playerDiscons).toHaveLength(REPLAY_MAX_SLOTS);
    expect(header.playerDiscons.every((v) => v === false)).toBe(true);
    expect(header.replayName).toBe('Last Replay');
    expect(header.systemTime.year).toBe(2026);
    expect(header.systemTime.month).toBe(5);
    expect(header.systemTime.day).toBe(20);
    expect(header.systemTime.hour).toBe(12);
    expect(header.systemTime.milliseconds).toBe(789);
    expect(header.versionString).toBe('1.04.0001');
    expect(header.versionTimeString).toBe('May 20 2026');
    expect(header.versionNumber).toBe(10401);
    expect(header.exeCRC).toBe(0xdead0001);
    expect(header.iniCRC).toBe(0xbeef0002);
    expect(header.gameOptions).toBe('US=H');
    expect(header.localPlayerIndex).toBe(0);
    expect(header.headerByteLength).toBeGreaterThan(0);
  });

  it('rejects non-GENREP buffers', () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer;
    expect(isReplayFile(buf)).toBe(false);
    expect(() => parseReplayHeader(buf)).toThrow(/GENREP/);
  });
});
