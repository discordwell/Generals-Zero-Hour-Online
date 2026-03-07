import { describe, it, expect } from 'vitest';
import { parseCsf } from './CsfParser.js';
import fs from 'node:fs';
import path from 'node:path';

function buildCsfBuffer(entries: Array<{ label: string; text: string; speech?: string }>): ArrayBuffer {
  const parts: number[] = [];

  function writeInt32(val: number) {
    parts.push(val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF);
  }

  function writeAscii(str: string) {
    for (let i = 0; i < str.length; i++) {
      parts.push(str.charCodeAt(i));
    }
  }

  function writeUcs2Not(str: string) {
    for (let i = 0; i < str.length; i++) {
      const val = ~str.charCodeAt(i) & 0xFFFF;
      parts.push(val & 0xFF, (val >> 8) & 0xFF);
    }
  }

  // Header: magic ' FSC', version 3, num_labels, num_strings, skip 0, langid 0
  writeInt32(0x43534620); // CSF magic LE
  writeInt32(3);          // version
  writeInt32(entries.length);
  writeInt32(entries.length);
  writeInt32(0);          // skip
  writeInt32(0);          // langid

  for (const entry of entries) {
    writeInt32(0x4C424C20); // ' LBL'
    writeInt32(1);          // num_strings
    writeInt32(entry.label.length);
    writeAscii(entry.label);

    if (entry.speech) {
      writeInt32(0x53545257); // 'WRTS'
    } else {
      writeInt32(0x53545220); // ' RTS'
    }
    writeInt32(entry.text.length);
    writeUcs2Not(entry.text);

    if (entry.speech) {
      writeInt32(entry.speech.length);
      writeAscii(entry.speech);
    }
  }

  return new Uint8Array(parts).buffer;
}

describe('CsfParser', () => {
  it('parses a minimal synthetic CSF', () => {
    const buf = buildCsfBuffer([
      { label: 'GUI:OK', text: 'OK' },
      { label: 'GUI:Cancel', text: 'Cancel' },
    ]);

    const result = parseCsf(buf);
    expect(result.version).toBe(3);
    expect(Object.keys(result.entries)).toHaveLength(2);
    expect(result.entries['GUI:OK']?.text).toBe('OK');
    expect(result.entries['GUI:Cancel']?.text).toBe('Cancel');
  });

  it('parses speech (wave) references', () => {
    const buf = buildCsfBuffer([
      { label: 'VOICE:Hello', text: 'Hello Commander', speech: 'hello.wav' },
    ]);

    const result = parseCsf(buf);
    expect(result.entries['VOICE:Hello']?.text).toBe('Hello Commander');
    expect(result.entries['VOICE:Hello']?.speech).toBe('hello.wav');
  });

  it('parses the retail generals.csf file', () => {
    const csfPath = path.resolve(
      __dirname, '..', '..', '..', 'packages', 'app', 'public', 'assets',
      '_extracted', 'EnglishZH', 'Data', 'English', 'generals.csf',
    );
    if (!fs.existsSync(csfPath)) {
      return; // skip if no retail data
    }

    const data = fs.readFileSync(csfPath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const result = parseCsf(buf);

    // Header says 0x18dc = 6364 labels
    const keys = Object.keys(result.entries);
    expect(keys.length).toBeGreaterThan(6000);
    // Verify at least some entries have non-empty text
    const nonEmpty = keys.filter((k) => result.entries[k]!.text.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(5000);
  });
});
