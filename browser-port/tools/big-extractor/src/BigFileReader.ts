/**
 * BIG Archive File Reader
 *
 * Parses .big archive files used by C&C Generals / Zero Hour.
 *
 * Format:
 *   Header (16 bytes):
 *     [0..3]   Magic: "BIGF" or "BIG4" (ASCII)
 *     [4..7]   Archive file size (little-endian uint32)
 *     [8..11]  Number of files (BIG-ENDIAN uint32)
 *     [12..15] First data offset / reserved (little-endian uint32)
 *
 *   File entries (starting at offset 16):
 *     Per entry:
 *       4 bytes  — data offset within archive (BIG-ENDIAN uint32)
 *       4 bytes  — data size (BIG-ENDIAN uint32)
 *       variable — null-terminated ASCII filepath
 */

export interface BigFileEntry {
  /** Normalized forward-slash path */
  path: string;
  /** Byte offset of file data within the archive */
  offset: number;
  /** Byte size of the file data */
  size: number;
}

export interface BigArchive {
  /** Archive magic identifier: "BIGF" or "BIG4" */
  magic: string;
  /** Total size of the archive in bytes */
  archiveSize: number;
  /** Number of files in the archive */
  fileCount: number;
  /** Parsed file entries */
  entries: BigFileEntry[];
}

const HEADER_SIZE = 16;
const VALID_MAGICS = new Set(['BIGF', 'BIG4']);

export class BigFileReader {
  /**
   * Parse a BIG archive from an ArrayBuffer into a BigArchive structure.
   */
  static parse(buffer: ArrayBuffer): BigArchive {
    if (buffer.byteLength < HEADER_SIZE) {
      throw new Error(
        `Buffer too small for BIG header: expected at least ${HEADER_SIZE} bytes, got ${buffer.byteLength}`,
      );
    }

    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Read magic (4 ASCII chars)
    const magic = String.fromCharCode(
      bytes[0] ?? 0,
      bytes[1] ?? 0,
      bytes[2] ?? 0,
      bytes[3] ?? 0,
    );

    if (!VALID_MAGICS.has(magic)) {
      throw new Error(
        `Invalid BIG magic: expected "BIGF" or "BIG4", got "${magic}"`,
      );
    }

    // Archive size — little-endian
    const archiveSize = view.getUint32(4, true);

    // File count — BIG-ENDIAN
    const fileCount = view.getUint32(8, false);

    // Parse file entries starting at offset 16
    const entries: BigFileEntry[] = [];
    let cursor = HEADER_SIZE;

    for (let i = 0; i < fileCount; i++) {
      if (cursor + 8 > buffer.byteLength) {
        throw new Error(
          `Unexpected end of buffer while reading entry ${i} header at offset ${cursor}`,
        );
      }

      // Offset and size are BIG-ENDIAN
      const offset = view.getUint32(cursor, false);
      cursor += 4;

      const size = view.getUint32(cursor, false);
      cursor += 4;

      // Read null-terminated path string
      const pathStart = cursor;
      while (cursor < buffer.byteLength && bytes[cursor] !== 0) {
        cursor++;
      }

      if (cursor >= buffer.byteLength && bytes[cursor] !== 0) {
        throw new Error(
          `Unexpected end of buffer while reading entry ${i} path at offset ${pathStart}`,
        );
      }

      const rawPath = new TextDecoder('ascii').decode(
        bytes.slice(pathStart, cursor),
      );

      // Skip the null terminator
      cursor++;

      // Normalize backslashes to forward slashes
      const path = rawPath.replace(/\\/g, '/');

      entries.push({ path, offset, size });
    }

    return { magic, archiveSize, fileCount, entries };
  }

  /**
   * Extract the raw bytes for a single file entry from the archive buffer.
   */
  static extractFile(buffer: ArrayBuffer, entry: BigFileEntry): Uint8Array {
    if (entry.offset + entry.size > buffer.byteLength) {
      throw new Error(
        `File entry "${entry.path}" extends beyond archive buffer: ` +
          `offset=${entry.offset}, size=${entry.size}, bufferLength=${buffer.byteLength}`,
      );
    }
    return new Uint8Array(buffer, entry.offset, entry.size);
  }

  /**
   * Find a file entry by path (case-insensitive).
   * The search path can use either forward or back slashes.
   */
  static findEntry(
    archive: BigArchive,
    path: string,
  ): BigFileEntry | undefined {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    return archive.entries.find((e) => e.path.toLowerCase() === normalized);
  }

  /**
   * List all entries whose path ends with the given extension (case-insensitive).
   * The extension should include the dot, e.g. ".tga".
   */
  static listByExtension(archive: BigArchive, ext: string): BigFileEntry[] {
    const lowerExt = ext.toLowerCase();
    return archive.entries.filter((e) =>
      e.path.toLowerCase().endsWith(lowerExt),
    );
  }

  /**
   * Returns true when an archive path can be written safely beneath an
   * extraction directory on Windows and POSIX filesystems.
   *
   * Retail PatchZH.big contains a zero-byte "Data/*" tombstone/wildcard entry.
   * The original game ignores it; the browser conversion pipeline should skip
   * it rather than trying to create a literal wildcard file.
   */
  static isExtractablePath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/').trim();
    if (!normalized || normalized.startsWith('/') || normalized.endsWith('/')) {
      return false;
    }
    if (/^[A-Za-z]:/.test(normalized)) {
      return false;
    }
    const segments = normalized.split('/');
    return segments.every((segment) =>
      segment.length > 0
      && segment !== '.'
      && segment !== '..'
      && !/[<>:"|?*]/.test(segment),
    );
  }
}
