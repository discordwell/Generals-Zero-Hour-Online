import { describe, it, expect, beforeAll } from 'vitest';
import { BigFileReader } from './BigFileReader.js';
import type { BigArchive } from './BigFileReader.js';

// ---------------------------------------------------------------------------
// Helpers to construct synthetic .big archives in memory
// ---------------------------------------------------------------------------

/**
 * Build a valid BIG archive ArrayBuffer from a set of file entries.
 * Each entry is { path, data } where path uses backslashes (as stored on disk).
 */
function buildBigArchive(
  files: { path: string; data: Uint8Array }[],
  magic: string = 'BIGF',
): ArrayBuffer {
  const encoder = new TextEncoder();

  // Calculate entry table size
  // Each entry: 4 (offset) + 4 (size) + path bytes + 1 (null terminator)
  let entryTableSize = 0;
  const encodedPaths: Uint8Array[] = [];
  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    encodedPaths.push(pathBytes);
    entryTableSize += 4 + 4 + pathBytes.byteLength + 1;
  }

  const headerSize = 16;
  const dataStart = headerSize + entryTableSize;

  // Total archive size
  let totalDataSize = 0;
  for (const file of files) {
    totalDataSize += file.data.byteLength;
  }
  const archiveSize = dataStart + totalDataSize;

  const buffer = new ArrayBuffer(archiveSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Write magic
  for (let i = 0; i < 4; i++) {
    bytes[i] = magic.charCodeAt(i);
  }

  // Archive size — little-endian
  view.setUint32(4, archiveSize, true);

  // File count — BIG-ENDIAN
  view.setUint32(8, files.length, false);

  // First data offset — little-endian
  view.setUint32(12, dataStart, true);

  // Write entry table and file data
  let entryCursor = headerSize;
  let dataCursor = dataStart;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const pathBytes = encodedPaths[i]!;

    // Data offset — BIG-ENDIAN
    view.setUint32(entryCursor, dataCursor, false);
    entryCursor += 4;

    // Data size — BIG-ENDIAN
    view.setUint32(entryCursor, file.data.byteLength, false);
    entryCursor += 4;

    // Path (null-terminated)
    bytes.set(pathBytes, entryCursor);
    entryCursor += pathBytes.byteLength;
    bytes[entryCursor] = 0; // null terminator
    entryCursor++;

    // File data
    bytes.set(file.data, dataCursor);
    dataCursor += file.data.byteLength;
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BigFileReader', () => {
  // Two test files with known content
  const fileA = {
    path: 'Art\\Textures\\grass.tga',
    data: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]),
  };

  const fileB = {
    path: 'Data\\INI\\GameData.ini',
    data: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), // "Hello"
  };

  const testBuffer = buildBigArchive([fileA, fileB]);

  describe('parse()', () => {
    it('should parse header correctly', () => {
      const archive = BigFileReader.parse(testBuffer);
      expect(archive.magic).toBe('BIGF');
      expect(archive.fileCount).toBe(2);
      expect(archive.archiveSize).toBe(testBuffer.byteLength);
    });

    it('should parse file entries with normalized paths', () => {
      const archive = BigFileReader.parse(testBuffer);
      expect(archive.entries).toHaveLength(2);

      const entry0 = archive.entries[0]!;
      expect(entry0.path).toBe('Art/Textures/grass.tga');
      expect(entry0.size).toBe(fileA.data.byteLength);

      const entry1 = archive.entries[1]!;
      expect(entry1.path).toBe('Data/INI/GameData.ini');
      expect(entry1.size).toBe(fileB.data.byteLength);
    });

    it('should parse BIG4 magic', () => {
      const big4Buffer = buildBigArchive([fileA], 'BIG4');
      const archive = BigFileReader.parse(big4Buffer);
      expect(archive.magic).toBe('BIG4');
      expect(archive.fileCount).toBe(1);
    });

    it('should reject invalid magic', () => {
      const badBuffer = buildBigArchive([fileA], 'BZZZ');
      expect(() => BigFileReader.parse(badBuffer)).toThrow(
        /Invalid BIG magic/,
      );
    });

    it('should handle empty archive (0 files)', () => {
      const emptyBuffer = buildBigArchive([]);
      const archive = BigFileReader.parse(emptyBuffer);
      expect(archive.magic).toBe('BIGF');
      expect(archive.fileCount).toBe(0);
      expect(archive.entries).toHaveLength(0);
    });

    it('should throw on buffer too small for header', () => {
      const tinyBuffer = new ArrayBuffer(4);
      expect(() => BigFileReader.parse(tinyBuffer)).toThrow(
        /Buffer too small/,
      );
    });
  });

  describe('extractFile()', () => {
    it('should extract correct file data for first entry', () => {
      const archive = BigFileReader.parse(testBuffer);
      const entry0 = archive.entries[0]!;
      const data = BigFileReader.extractFile(testBuffer, entry0);
      expect(data).toEqual(fileA.data);
    });

    it('should extract correct file data for second entry', () => {
      const archive = BigFileReader.parse(testBuffer);
      const entry1 = archive.entries[1]!;
      const data = BigFileReader.extractFile(testBuffer, entry1);
      expect(data).toEqual(fileB.data);
    });

    it('should throw if entry extends beyond buffer', () => {
      const archive = BigFileReader.parse(testBuffer);
      const badEntry = {
        ...archive.entries[0]!,
        size: testBuffer.byteLength * 2,
      };
      expect(() => BigFileReader.extractFile(testBuffer, badEntry)).toThrow(
        /extends beyond/,
      );
    });
  });

  describe('findEntry()', () => {
    let archive: BigArchive;

    beforeAll(() => {
      archive = BigFileReader.parse(testBuffer);
    });

    it('should find entry by exact normalized path', () => {
      const entry = BigFileReader.findEntry(
        archive,
        'Art/Textures/grass.tga',
      );
      expect(entry).toBeDefined();
      expect(entry!.path).toBe('Art/Textures/grass.tga');
    });

    it('should find entry case-insensitively', () => {
      const entry = BigFileReader.findEntry(
        archive,
        'ART/TEXTURES/GRASS.TGA',
      );
      expect(entry).toBeDefined();
      expect(entry!.path).toBe('Art/Textures/grass.tga');
    });

    it('should find entry using backslash path', () => {
      const entry = BigFileReader.findEntry(
        archive,
        'Data\\INI\\GameData.ini',
      );
      expect(entry).toBeDefined();
      expect(entry!.path).toBe('Data/INI/GameData.ini');
    });

    it('should return undefined for non-existent path', () => {
      const entry = BigFileReader.findEntry(archive, 'does/not/exist.txt');
      expect(entry).toBeUndefined();
    });
  });

  describe('listByExtension()', () => {
    let archive: BigArchive;

    beforeAll(() => {
      archive = BigFileReader.parse(testBuffer);
    });

    it('should list entries matching .tga extension', () => {
      const tgaFiles = BigFileReader.listByExtension(archive, '.tga');
      expect(tgaFiles).toHaveLength(1);
      expect(tgaFiles[0]!.path).toBe('Art/Textures/grass.tga');
    });

    it('should list entries matching .ini extension', () => {
      const iniFiles = BigFileReader.listByExtension(archive, '.ini');
      expect(iniFiles).toHaveLength(1);
      expect(iniFiles[0]!.path).toBe('Data/INI/GameData.ini');
    });

    it('should be case-insensitive', () => {
      const tgaFiles = BigFileReader.listByExtension(archive, '.TGA');
      expect(tgaFiles).toHaveLength(1);
    });

    it('should return empty array for unmatched extension', () => {
      const w3dFiles = BigFileReader.listByExtension(archive, '.w3d');
      expect(w3dFiles).toHaveLength(0);
    });
  });

  describe('isExtractablePath()', () => {
    it('allows normal archive-relative file paths', () => {
      expect(BigFileReader.isExtractablePath('Data/INI/GameData.ini')).toBe(true);
      expect(BigFileReader.isExtractablePath('Art\\W3D\\AVAvnger.W3D')).toBe(true);
    });

    it('rejects retail wildcard/tombstone and traversal paths', () => {
      expect(BigFileReader.isExtractablePath('Data/*')).toBe(false);
      expect(BigFileReader.isExtractablePath('../Data/INI/GameData.ini')).toBe(false);
      expect(BigFileReader.isExtractablePath('/Data/INI/GameData.ini')).toBe(false);
      expect(BigFileReader.isExtractablePath('C:/Data/INI/GameData.ini')).toBe(false);
    });
  });

  describe('endianness correctness', () => {
    it('should correctly read big-endian file count, offset, and size', () => {
      // Build an archive with a single file whose offset and size
      // would be parsed incorrectly if endianness were wrong.
      const data = new Uint8Array(256);
      for (let i = 0; i < data.length; i++) {
        data[i] = i & 0xff;
      }

      const buf = buildBigArchive([{ path: 'test.bin', data }]);
      const archive = BigFileReader.parse(buf);

      expect(archive.fileCount).toBe(1);

      const entry = archive.entries[0]!;
      expect(entry.size).toBe(256);

      // Verify extracted data matches
      const extracted = BigFileReader.extractFile(buf, entry);
      expect(extracted).toEqual(data);
    });
  });
});
