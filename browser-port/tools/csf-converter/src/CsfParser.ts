/**
 * CSF (Compiled String File) parser for C&C Generals.
 *
 * Binary format (little-endian):
 *   Header (24 bytes): magic ' FSC', version, num_labels, num_strings, skip, langid
 *   Per label: ' LBL' marker, num_strings(i32), label_length(i32), ASCII label,
 *     then per string: ' RTS'/' RTSW' marker, unicode_length(i32), UCS-2 LE data (bitwise-NOT encoded),
 *     optional wave filename for STRW variant.
 *
 * C++ ref: GeneralsMD/Code/GameEngine/Source/GameClient/GameText.cpp:904-1024
 */

// Magic constants (read as little-endian int32)
const CSF_MAGIC = 0x43534620; // ' FSC' → bytes: 20 46 53 43
const CSF_LABEL = 0x4C424C20; // ' LBL' → bytes: 20 4C 42 4C
const CSF_STRING = 0x53545220; // ' RTS' → bytes: 20 52 54 53
const CSF_STRINGWITHWAVE = 0x53545257; // 'WRTS' → bytes: 57 52 54 53

export interface CsfEntry {
  text: string;
  speech?: string;
}

export interface CsfData {
  version: number;
  language: number;
  entries: Record<string, CsfEntry>;
}

export function parseCsf(buffer: ArrayBuffer): CsfData {
  const view = new DataView(buffer);
  let offset = 0;

  function readInt32(): number {
    const val = view.getInt32(offset, true);
    offset += 4;
    return val;
  }

  function readAsciiString(length: number): string {
    const bytes = new Uint8Array(buffer, offset, length);
    offset += length;
    return String.fromCharCode(...bytes);
  }

  function readUcs2NotString(charCount: number): string {
    const chars: string[] = [];
    for (let i = 0; i < charCount; i++) {
      const raw = view.getUint16(offset, true);
      chars.push(String.fromCharCode(~raw & 0xFFFF));
      offset += 2;
    }
    return chars.join('');
  }

  // Header
  const magicLE = readInt32();
  if (magicLE !== CSF_MAGIC) {
    throw new Error(`Invalid CSF magic: 0x${(magicLE >>> 0).toString(16).padStart(8, '0')}, expected 0x${CSF_MAGIC.toString(16).padStart(8, '0')}`);
  }

  const version = readInt32();
  const numLabels = readInt32();
  const _numStrings = readInt32();
  const _skip = readInt32();
  const langId = readInt32();

  const entries: Record<string, CsfEntry> = {};

  for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
    if (offset >= buffer.byteLength) break;

    const id = readInt32();
    if (id !== CSF_LABEL) {
      throw new Error(`Expected CSF_LABEL marker at offset ${offset - 4}, got 0x${(id >>> 0).toString(16).padStart(8, '0')}`);
    }

    const numStrings = readInt32();
    const labelLength = readInt32();
    const label = readAsciiString(labelLength);

    let text = '';
    let speech: string | undefined;

    for (let strIdx = 0; strIdx < numStrings; strIdx++) {
      const strId = readInt32();
      if (strId !== CSF_STRING && strId !== CSF_STRINGWITHWAVE) {
        throw new Error(`Expected CSF_STRING/CSF_STRINGWITHWAVE at offset ${offset - 4}, got 0x${(strId >>> 0).toString(16).padStart(8, '0')}`);
      }

      const charCount = readInt32();
      const decoded = charCount > 0 ? readUcs2NotString(charCount) : '';

      // Only use the first string (C++ parity: "only use the first string found")
      if (strIdx === 0) {
        text = decoded;
      }

      if (strId === CSF_STRINGWITHWAVE) {
        const waveLen = readInt32();
        const waveName = waveLen > 0 ? readAsciiString(waveLen) : '';
        if (strIdx === 0 && waveLen > 0) {
          speech = waveName;
        }
      }
    }

    entries[label] = speech ? { text, speech } : { text };
  }

  return { version, language: langId, entries };
}
