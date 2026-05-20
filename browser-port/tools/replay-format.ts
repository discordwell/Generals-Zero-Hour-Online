/**
 * Generals .rep replay file format — header parser.
 *
 * Source: GeneralsMD/Code/GameEngine/Source/Common/Recorder.cpp:540-905
 *
 * Layer 2 of the parity harness (planned).  A full implementation will:
 *
 *   1. Use parseReplayHeader() (this file) to validate file shape and pick
 *      out the starting frame, EXE CRC, INI CRC, and slot list.
 *   2. Iterate the post-header command stream — each record is a frame
 *      number + GameMessage with typed arguments, written by
 *      RecorderClass::logGameMessage / writeArgument.
 *   3. Replay the same command sequence through the TS port via
 *      __GENERALS_E2E__.submitCommand and compare per-frame CRC against
 *      the recorded values.  C++ writes per-frame CRC tokens via
 *      CRCInfo::addCRC; the first frame where TS != recorded CRC is the
 *      first frame the engines diverge.
 *
 * Today this file only exports the header parser plus the format constants
 * so a future PR can build the command stream + CRC differential on top.
 */

const MAGIC = 'GENREP';
/** Source parity: GeneralsMD MAX_SLOTS = 8 (Common/GameInfo.h). */
export const REPLAY_MAX_SLOTS = 8;

export interface ReplaySystemTime {
  year: number;
  month: number;
  dayOfWeek: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  milliseconds: number;
}

export interface ReplayHeader {
  /** "GENREP" magic, 6 bytes. */
  magic: string;
  /** Windows time_t — 8 bytes on x64, 4 bytes on x86; we read both into a number. */
  startTime: number;
  endTime: number;
  /** Total simulation frames replayed. */
  frameDuration: number;
  desyncGame: boolean;
  quitEarly: boolean;
  /** Per-slot disconnect flags (MAX_SLOTS). */
  playerDiscons: boolean[];
  replayName: string;
  systemTime: ReplaySystemTime;
  versionString: string;
  versionTimeString: string;
  versionNumber: number;
  exeCRC: number;
  iniCRC: number;
  /** Encoded GameInfo (slot list, map, settings) as ASCII. */
  gameOptions: string;
  /** Local player slot index (-1 for spectator / observed replays). */
  localPlayerIndex: number;
  /** Total bytes consumed by the header — command stream starts here. */
  headerByteLength: number;
}

class ReplayReader {
  private offset = 0;

  constructor(private readonly view: DataView) {}

  get position(): number {
    return this.offset;
  }

  readUInt32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUInt8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  /** Windows BOOL is sizeof(int) = 4 bytes (NOT C++ bool!). */
  readBool32(): boolean {
    return this.readUInt32() !== 0;
  }

  readMagic(expected: string): string {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, expected.length);
    this.offset += expected.length;
    return String.fromCharCode(...bytes);
  }

  /** C++ time_t — 8 bytes on Win64, 4 bytes on Win32.  Generals ships 32-bit. */
  readTimeT32(): number {
    return this.readUInt32();
  }

  /** ZH writes wchar_t (16-bit) strings 0-terminated via fputwc(0). */
  readWideZ(): string {
    let result = '';
    while (this.offset < this.view.byteLength - 1) {
      const c = this.view.getUint16(this.offset, true);
      this.offset += 2;
      if (c === 0) break;
      result += String.fromCharCode(c);
    }
    return result;
  }

  /** ASCII strings are written via fprintf("%s") + fputc(0). */
  readAsciiZ(): string {
    let result = '';
    while (this.offset < this.view.byteLength) {
      const c = this.view.getUint8(this.offset);
      this.offset += 1;
      if (c === 0) break;
      result += String.fromCharCode(c);
    }
    return result;
  }

  readSystemTime(): ReplaySystemTime {
    return {
      year: this.view.getUint16(this.offset += 0, true),
      month: this.view.getUint16((this.offset += 2), true),
      dayOfWeek: this.view.getUint16((this.offset += 2), true),
      day: this.view.getUint16((this.offset += 2), true),
      hour: this.view.getUint16((this.offset += 2), true),
      minute: this.view.getUint16((this.offset += 2), true),
      second: this.view.getUint16((this.offset += 2), true),
      milliseconds: this.view.getUint16((this.offset += 2), true),
      // Advance past the final field.
    };
  }
}

export function parseReplayHeader(data: ArrayBuffer): ReplayHeader {
  const view = new DataView(data);
  const r = new ReplayReader(view);

  const magic = r.readMagic(MAGIC);
  if (magic !== MAGIC) {
    throw new Error(`Replay file is missing GENREP magic; got ${JSON.stringify(magic)}`);
  }

  const startTime = r.readTimeT32();
  const endTime = r.readTimeT32();
  const frameDuration = r.readUInt32();
  // NB: Recorder.cpp uses sizeof(Bool) on Windows = 4 bytes (Win32 BOOL).
  const desyncGame = r.readBool32();
  const quitEarly = r.readBool32();
  const playerDiscons: boolean[] = [];
  for (let i = 0; i < REPLAY_MAX_SLOTS; i++) {
    playerDiscons.push(r.readBool32());
  }
  const replayName = r.readWideZ();
  // SYSTEMTIME is 16 bytes — read as 8 little-endian WORDs.
  const systemTimeStart = r.position;
  const systemTime: ReplaySystemTime = {
    year: view.getUint16(systemTimeStart, true),
    month: view.getUint16(systemTimeStart + 2, true),
    dayOfWeek: view.getUint16(systemTimeStart + 4, true),
    day: view.getUint16(systemTimeStart + 6, true),
    hour: view.getUint16(systemTimeStart + 8, true),
    minute: view.getUint16(systemTimeStart + 10, true),
    second: view.getUint16(systemTimeStart + 12, true),
    milliseconds: view.getUint16(systemTimeStart + 14, true),
  };
  // Advance the reader cursor past the 16-byte SYSTEMTIME.
  // ReplayReader has no seek; create a wrapper by reading 16 bytes.
  for (let i = 0; i < 16; i++) r.readUInt8();

  const versionString = r.readWideZ();
  const versionTimeString = r.readWideZ();
  const versionNumber = r.readUInt32();
  const exeCRC = r.readUInt32();
  const iniCRC = r.readUInt32();
  const gameOptions = r.readAsciiZ();
  const localPlayerStr = r.readAsciiZ();
  const localPlayerIndex = Number.parseInt(localPlayerStr, 10);

  return {
    magic,
    startTime,
    endTime,
    frameDuration,
    desyncGame,
    quitEarly,
    playerDiscons,
    replayName,
    systemTime,
    versionString,
    versionTimeString,
    versionNumber,
    exeCRC,
    iniCRC,
    gameOptions,
    localPlayerIndex: Number.isFinite(localPlayerIndex) ? localPlayerIndex : -1,
    headerByteLength: r.position,
  };
}

/**
 * Returns true if the given buffer starts with the GENREP magic.  Used by
 * tooling to filter replay files from a directory listing without parsing
 * the whole header.
 */
export function isReplayFile(data: ArrayBuffer): boolean {
  if (data.byteLength < MAGIC.length) return false;
  const bytes = new Uint8Array(data, 0, MAGIC.length);
  return String.fromCharCode(...bytes) === MAGIC;
}
