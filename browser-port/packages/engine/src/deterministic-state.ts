/**
 * Deterministic simulation-state primitives.
 *
 * Source references:
 * - Object ID lifecycle:
 *   Generals/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp (allocateObjectID, m_nextObjID)
 * - Frame ownership:
 *   Generals/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp (m_frame increment in update)
 * - Command ordering:
 *   Generals/Code/GameEngine/Source/GameNetwork/NetCommandList.cpp (addMessage sort policy)
 * - CRC validation flow:
 *   Generals/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp (processCommandList, getCRC)
 */

export const INVALID_OBJECT_ID = 0;
export const FIRST_OBJECT_ID = 1;
export const MAX_OBJECT_ID = 0x07ffffff;

export interface DeterministicCommand<TPayload = unknown> {
  commandType: number;
  playerId: number;
  sortNumber: number;
  payload: TPayload;
  /**
   * Optional dedupe key for command replay suppression.
   * Source parity note: Generals compares full command content in NetCommandList::isEqualCommandMsg.
   */
  dedupeKey?: string;
}

export interface DeterministicFrameSnapshot<TPayload = unknown> {
  frame: number;
  nextObjectId: number;
  randomSeedCrc: number;
  commands: ReadonlyArray<Readonly<DeterministicCommand<TPayload>>>;
}

export interface FrameHashMismatch {
  frame: number;
  playerId: number;
  localHash: number;
  remoteHash: number;
}

export type FrameHashProvider<TPayload = unknown> =
  (snapshot: DeterministicFrameSnapshot<TPayload>) => number;

export type FrameHashMismatchListener = (mismatch: FrameHashMismatch) => void;

export interface GameLogicCrcMismatch {
  frame: number;
  playerId: number;
  localCrc: number;
  remoteCrc: number;
}

export type GameLogicCrcMismatchListener = (mismatch: GameLogicCrcMismatch) => void;

export type GameLogicCrcConsensusStatus = 'pending' | 'match' | 'mismatch';

export interface GameLogicCrcConsensus {
  frame: number;
  expectedPlayerIds: number[];
  observedPlayerIds: number[];
  missingPlayerIds: number[];
  mismatchedPlayerIds: number[];
  validatorCrc: number | null;
  status: GameLogicCrcConsensusStatus;
}

export interface DeterministicStateOptions<TPayload = unknown> {
  initialFrame?: number;
  initialObjectId?: number;
  initialRandomSeedCrc?: number;
  frameHashProvider?: FrameHashProvider<TPayload>;
  gameLogicCrcSectionWriters?: DeterministicGameLogicCrcSectionWriters<TPayload>;
}

const UINT8_MASK = 0xff;
const UINT16_MASK = 0xffff;
const UINT32_MASK = 0xffffffff;

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertObjectIdCounter(nextObjectId: number): void {
  if (!Number.isInteger(nextObjectId) || nextObjectId < FIRST_OBJECT_ID || nextObjectId > MAX_OBJECT_ID) {
    throw new Error(
      `nextObjectId must be an integer in [${FIRST_OBJECT_ID}, ${MAX_OBJECT_ID}]`,
    );
  }
}

function normalizeUnsignedHash(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('hash must be a finite number');
  }
  return (Math.trunc(value) >>> 0);
}

function assertUnsignedByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > UINT8_MASK) {
    throw new Error(`${name} must be an integer in [0, ${UINT8_MASK}]`);
  }
}

function assertUnsignedShort(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > UINT16_MASK) {
    throw new Error(`${name} must be an integer in [0, ${UINT16_MASK}]`);
  }
}

function assertUnsignedInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MASK) {
    throw new Error(`${name} must be an integer in [0, ${UINT32_MASK}]`);
  }
}

function normalizePlayerIdList(playerIds: ReadonlyArray<number>, name: string): number[] {
  const normalized: number[] = [];
  const seen = new Set<number>();
  for (const playerId of playerIds) {
    assertNonNegativeInteger(playerId, name);
    const safePlayerId = Math.trunc(playerId);
    if (!seen.has(safePlayerId)) {
      seen.add(safePlayerId);
      normalized.push(safePlayerId);
    }
  }
  return normalized;
}

function toNetworkOrderUint32(value: number): number {
  const normalized = value >>> 0;
  return (
    ((normalized & UINT8_MASK) << 24)
    | ((normalized & 0x0000ff00) << 8)
    | ((normalized & 0x00ff0000) >>> 8)
    | ((normalized >>> 24) & UINT8_MASK)
  ) >>> 0;
}

function compareCommands<TPayload>(
  left: DeterministicCommand<TPayload>,
  right: DeterministicCommand<TPayload>,
): number {
  if (left.commandType !== right.commandType) {
    return left.commandType - right.commandType;
  }
  if (left.playerId !== right.playerId) {
    return left.playerId - right.playerId;
  }
  return left.sortNumber - right.sortNumber;
}

/**
 * Source parity:
 * - Generals/Code/GameEngine/Source/Common/System/XferCRC.cpp
 *   (XferCRC::xferImplementation, XferCRC::addCRC, XferCRC::getCRC)
 */
export class XferCrcAccumulator {
  private crc = 0;

  reset(): void {
    this.crc = 0;
  }

  addUnsignedByte(value: number): void {
    assertUnsignedByte(value, 'value');
    this.xferBytes(Uint8Array.of(value & UINT8_MASK));
  }

  addUnsignedShort(value: number): void {
    assertUnsignedShort(value, 'value');
    this.xferBytes(Uint8Array.of(
      value & UINT8_MASK,
      (value >>> 8) & UINT8_MASK,
    ));
  }

  addUnsignedInt(value: number): void {
    assertUnsignedInt(value, 'value');
    this.xferBytes(Uint8Array.of(
      value & UINT8_MASK,
      (value >>> 8) & UINT8_MASK,
      (value >>> 16) & UINT8_MASK,
      (value >>> 24) & UINT8_MASK,
    ));
  }

  /**
   * Mirrors Xfer::xferAsciiString save layout (u16 length + raw bytes).
   */
  addAsciiString(value: string): void {
    assertUnsignedShort(value.length, 'asciiStringLength');
    this.addUnsignedShort(value.length);
    if (value.length === 0) {
      return;
    }

    const asciiBytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      // AsciiString stores single-byte characters; clamp to byte range.
      asciiBytes[index] = value.charCodeAt(index) & UINT8_MASK;
    }
    this.xferBytes(asciiBytes);
  }

  getCrc(): number {
    return toNetworkOrderUint32(this.crc);
  }

  xferBytes(data: Uint8Array): void {
    if (data.byteLength < 1) {
      return;
    }

    let offset = 0;
    for (; offset + 4 <= data.byteLength; offset += 4) {
      const word = (
        (data[offset] ?? 0)
        | ((data[offset + 1] ?? 0) << 8)
        | ((data[offset + 2] ?? 0) << 16)
        | ((data[offset + 3] ?? 0) << 24)
      ) >>> 0;
      this.addCrcWord(word);
    }

    const leftover = data.byteLength - offset;
    if (leftover > 0) {
      let value = 0;
      for (let index = 0; index < leftover; index += 1) {
        value += (data[offset + index] ?? 0) << (index * 8);
      }

      // Source parity note:
      // xferImplementation pre-swaps leftover data before calling addCRC(),
      // and addCRC() swaps again, preserving historical behavior.
      const preSwappedLeftover = toNetworkOrderUint32(value >>> 0);
      this.addCrcWord(preSwappedLeftover);
    }
  }

  private addCrcWord(value: number): void {
    const networkValue = toNetworkOrderUint32(value >>> 0);
    const carry = (this.crc & 0x80000000) !== 0 ? 1 : 0;
    this.crc = ((this.crc << 1) >>> 0);
    this.crc = (this.crc + networkValue + carry) >>> 0;
  }
}

export function hashDeterministicFrameMetadata<TPayload>(
  snapshot: DeterministicFrameSnapshot<TPayload>,
): number {
  // Source parity:
  // - GameLogic::getCRC uses XferCRC with marker strings + snapshot fields.
  // This engine-level helper intentionally hashes frame metadata only; full
  // game-logic CRC section parity is implemented in hashDeterministicGameLogicCrc.
  const crc = new XferCrcAccumulator();
  crc.addAsciiString('MARKER:DeterministicFrameMetadata');
  crc.addUnsignedInt(snapshot.frame >>> 0);
  crc.addUnsignedInt(snapshot.nextObjectId >>> 0);
  crc.addUnsignedInt(snapshot.commands.length >>> 0);
  crc.addAsciiString('MARKER:RandomSeed');
  crc.addUnsignedInt((snapshot.randomSeedCrc ?? 0) >>> 0);
  crc.addAsciiString('MARKER:DeterministicFrameCommands');
  for (const command of snapshot.commands) {
    crc.addUnsignedInt(command.commandType >>> 0);
    crc.addUnsignedInt(command.playerId >>> 0);
    crc.addUnsignedInt(command.sortNumber >>> 0);
    crc.addAsciiString(command.dedupeKey ?? '');
  }

  return crc.getCrc();
}

export interface DeterministicGameLogicCrcSectionWriters<TPayload = unknown> {
  writeObjects(
    crc: XferCrcAccumulator,
    snapshot: DeterministicFrameSnapshot<TPayload>,
  ): void;
  writePartitionManager(
    crc: XferCrcAccumulator,
    snapshot: DeterministicFrameSnapshot<TPayload>,
  ): void;
  writePlayerList(
    crc: XferCrcAccumulator,
    snapshot: DeterministicFrameSnapshot<TPayload>,
  ): void;
  writeAi(
    crc: XferCrcAccumulator,
    snapshot: DeterministicFrameSnapshot<TPayload>,
  ): void;
  writeModuleFactory?(
    crc: XferCrcAccumulator,
    snapshot: DeterministicFrameSnapshot<TPayload>,
  ): void;
}

export interface DeterministicGameLogicCrcHashOptions {
  includeModuleFactory?: boolean;
}

/**
 * Source parity:
 * - Generals/Code/GameEngine/Source/GameLogic/System/GameLogic.cpp (GameLogic::getCRC)
 *   marker/section ordering:
 *   Objects -> RandomSeed -> ThePartitionManager -> [TheModuleFactory] -> ThePlayerList -> TheAI
 */
export function hashDeterministicGameLogicCrc<TPayload>(
  snapshot: DeterministicFrameSnapshot<TPayload>,
  sectionWriters: DeterministicGameLogicCrcSectionWriters<TPayload>,
  options: DeterministicGameLogicCrcHashOptions = {},
): number {
  assertUnsignedInt(snapshot.randomSeedCrc, 'randomSeedCrc');
  const includeModuleFactory = options.includeModuleFactory ?? false;
  if (includeModuleFactory && !sectionWriters.writeModuleFactory) {
    throw new Error(
      'includeModuleFactory requires writeModuleFactory in DeterministicGameLogicCrcSectionWriters',
    );
  }

  const crc = new XferCrcAccumulator();
  crc.addAsciiString('MARKER:Objects');
  sectionWriters.writeObjects(crc, snapshot);
  crc.addUnsignedInt(snapshot.randomSeedCrc >>> 0);

  crc.addAsciiString('MARKER:ThePartitionManager');
  sectionWriters.writePartitionManager(crc, snapshot);

  if (includeModuleFactory) {
    crc.addAsciiString('MARKER:TheModuleFactory');
    sectionWriters.writeModuleFactory?.(crc, snapshot);
  }

  crc.addAsciiString('MARKER:ThePlayerList');
  sectionWriters.writePlayerList(crc, snapshot);

  crc.addAsciiString('MARKER:TheAI');
  sectionWriters.writeAi(crc, snapshot);

  return crc.getCrc();
}

export class DeterministicStateKernel<TPayload = unknown> {
  private frame: number;
  private nextObjectId: number;
  private randomSeedCrc: number;
  private readonly commands: DeterministicCommand<TPayload>[] = [];
  private frameHashProvider: FrameHashProvider<TPayload> | null;
  private gameLogicCrcSectionWriters: DeterministicGameLogicCrcSectionWriters<TPayload> | null;
  private readonly localFrameHashes = new Map<number, number>();
  private readonly remoteFrameHashes = new Map<number, Map<number, number>>();
  private readonly mismatchedFrames = new Set<number>();
  private readonly mismatchListeners = new Set<FrameHashMismatchListener>();
  private readonly localGameLogicCrcs = new Map<number, number>();
  private readonly remoteGameLogicCrcs = new Map<number, Map<number, number>>();
  private readonly mismatchedGameLogicCrcFrames = new Set<number>();
  private readonly gameLogicCrcMismatchListeners = new Set<GameLogicCrcMismatchListener>();

  constructor(options: DeterministicStateOptions<TPayload> = {}) {
    const initialFrame = options.initialFrame ?? 0;
    const initialObjectId = options.initialObjectId ?? FIRST_OBJECT_ID;
    const initialRandomSeedCrc = options.initialRandomSeedCrc ?? 0;
    assertNonNegativeInteger(initialFrame, 'initialFrame');
    assertObjectIdCounter(initialObjectId);
    assertUnsignedInt(initialRandomSeedCrc, 'initialRandomSeedCrc');

    this.frame = initialFrame;
    this.nextObjectId = initialObjectId;
    this.randomSeedCrc = initialRandomSeedCrc >>> 0;
    this.frameHashProvider = options.frameHashProvider ?? null;
    this.gameLogicCrcSectionWriters = options.gameLogicCrcSectionWriters ?? null;
  }

  getFrame(): number {
    return this.frame;
  }

  setFrame(frame: number): void {
    assertNonNegativeInteger(frame, 'frame');
    this.frame = frame;
  }

  advanceFrame(): number {
    this.frame += 1;
    return this.frame;
  }

  getObjectIdCounter(): number {
    return this.nextObjectId;
  }

  setObjectIdCounter(nextObjectId: number): void {
    assertObjectIdCounter(nextObjectId);
    this.nextObjectId = nextObjectId;
  }

  allocateObjectId(): number {
    if (this.nextObjectId > MAX_OBJECT_ID) {
      throw new Error(`ObjectID counter exhausted at ${this.nextObjectId}`);
    }
    const objectId = this.nextObjectId;
    this.nextObjectId += 1;
    return objectId;
  }

  enqueueCommand(command: DeterministicCommand<TPayload>): boolean {
    assertNonNegativeInteger(command.commandType, 'commandType');
    assertNonNegativeInteger(command.playerId, 'playerId');
    assertNonNegativeInteger(command.sortNumber, 'sortNumber');

    const normalized: DeterministicCommand<TPayload> = {
      commandType: Math.trunc(command.commandType),
      playerId: Math.trunc(command.playerId),
      sortNumber: Math.trunc(command.sortNumber),
      payload: command.payload,
      dedupeKey: command.dedupeKey,
    };

    if (normalized.dedupeKey) {
      const alreadyQueued = this.commands.some((queued) =>
        queued.commandType === normalized.commandType
        && queued.playerId === normalized.playerId
        && queued.sortNumber === normalized.sortNumber
        && queued.dedupeKey === normalized.dedupeKey,
      );
      if (alreadyQueued) {
        return false;
      }
    }

    let insertIndex = this.commands.length;
    for (let index = 0; index < this.commands.length; index += 1) {
      const queued = this.commands[index];
      if (queued && compareCommands(normalized, queued) < 0) {
        insertIndex = index;
        break;
      }
    }

    this.commands.splice(insertIndex, 0, normalized);
    return true;
  }

  /**
   * Source parity:
   * - GameLogic::getCRC includes GetGameLogicRandomSeedCRC() between object
   *   and partition manager CRC sections.
   */
  getRandomSeedCrc(): number {
    return this.randomSeedCrc;
  }

  setRandomSeedCrc(randomSeedCrc: number): void {
    assertUnsignedInt(randomSeedCrc, 'randomSeedCrc');
    this.randomSeedCrc = randomSeedCrc >>> 0;
  }

  peekCommands(): ReadonlyArray<Readonly<DeterministicCommand<TPayload>>> {
    return this.commands.slice();
  }

  drainCommands(): ReadonlyArray<Readonly<DeterministicCommand<TPayload>>> {
    const drained = this.commands.slice();
    this.commands.length = 0;
    return drained;
  }

  clearCommands(): void {
    this.commands.length = 0;
  }

  setFrameHashProvider(frameHashProvider: FrameHashProvider<TPayload> | null): void {
    this.frameHashProvider = frameHashProvider;
  }

  setGameLogicCrcSectionWriters(
    gameLogicCrcSectionWriters: DeterministicGameLogicCrcSectionWriters<TPayload> | null,
  ): void {
    this.gameLogicCrcSectionWriters = gameLogicCrcSectionWriters;
  }

  getGameLogicCrcSectionWriters(): DeterministicGameLogicCrcSectionWriters<TPayload> | null {
    return this.gameLogicCrcSectionWriters;
  }

  createSnapshot(frame = this.frame): DeterministicFrameSnapshot<TPayload> {
    assertNonNegativeInteger(frame, 'frame');
    return {
      frame,
      nextObjectId: this.nextObjectId,
      randomSeedCrc: this.randomSeedCrc,
      commands: this.commands.slice(),
    };
  }

  computeFrameHash(frame = this.frame): number | null {
    const provider = this.frameHashProvider;
    if (!provider) {
      return null;
    }
    return normalizeUnsignedHash(provider(this.createSnapshot(frame)));
  }

  computeGameLogicCrc(
    frame = this.frame,
    options: DeterministicGameLogicCrcHashOptions = {},
  ): number | null {
    assertNonNegativeInteger(frame, 'frame');
    const sectionWriters = this.gameLogicCrcSectionWriters;
    if (!sectionWriters) {
      return null;
    }
    return hashDeterministicGameLogicCrc(
      this.createSnapshot(frame),
      sectionWriters,
      options,
    );
  }

  recordLocalGameLogicCrc(
    crc?: number,
    frame = this.frame,
    options: DeterministicGameLogicCrcHashOptions = {},
  ): number {
    assertNonNegativeInteger(frame, 'frame');

    const resolvedCrc = typeof crc === 'number'
      ? normalizeUnsignedHash(crc)
      : this.computeGameLogicCrc(frame, options);

    if (resolvedCrc === null) {
      throw new Error('No GameLogic CRC section writers configured');
    }

    this.localGameLogicCrcs.set(frame, resolvedCrc);
    const remoteCrcs = this.remoteGameLogicCrcs.get(frame);
    if (remoteCrcs) {
      for (const [playerId, remoteCrc] of remoteCrcs.entries()) {
        this.maybeMarkGameLogicCrcMismatch(frame, playerId, resolvedCrc, remoteCrc);
      }
    }
    return resolvedCrc;
  }

  getLocalGameLogicCrc(frame: number): number | null {
    assertNonNegativeInteger(frame, 'frame');
    const crc = this.localGameLogicCrcs.get(frame);
    return typeof crc === 'number' ? crc : null;
  }

  recordRemoteGameLogicCrc(frame: number, playerId: number, crc: number): boolean {
    assertNonNegativeInteger(frame, 'frame');
    assertNonNegativeInteger(playerId, 'playerId');
    const normalizedCrc = normalizeUnsignedHash(crc);

    let remoteCrcsForFrame = this.remoteGameLogicCrcs.get(frame);
    if (!remoteCrcsForFrame) {
      remoteCrcsForFrame = new Map<number, number>();
      this.remoteGameLogicCrcs.set(frame, remoteCrcsForFrame);
    }
    remoteCrcsForFrame.set(playerId, normalizedCrc);

    const localCrc = this.localGameLogicCrcs.get(frame);
    if (typeof localCrc !== 'number') {
      return false;
    }
    return this.maybeMarkGameLogicCrcMismatch(frame, playerId, localCrc, normalizedCrc);
  }

  getRemoteGameLogicCrcs(frame: number): ReadonlyMap<number, number> {
    assertNonNegativeInteger(frame, 'frame');
    return new Map(this.remoteGameLogicCrcs.get(frame));
  }

  getLocalFrameHashFrames(): number[] {
    return Array.from(this.localFrameHashes.keys()).sort((left, right) => left - right);
  }

  getRemoteFrameHashFrames(): number[] {
    return Array.from(this.remoteFrameHashes.entries())
      .filter(([, hashes]) => hashes.size > 0)
      .map(([frame]) => frame)
      .sort((left, right) => left - right);
  }

  getLocalGameLogicCrcFrames(): number[] {
    return Array.from(this.localGameLogicCrcs.keys()).sort((left, right) => left - right);
  }

  getRemoteGameLogicCrcFrames(): number[] {
    return Array.from(this.remoteGameLogicCrcs.entries())
      .filter(([, crcs]) => crcs.size > 0)
      .map(([frame]) => frame)
      .sort((left, right) => left - right);
  }

  /**
   * Drop stored deterministic frame-hash state for frames strictly lower than `minFrame`.
   */
  pruneFrameHashesBefore(minFrame: number): void {
    assertNonNegativeInteger(minFrame, 'minFrame');

    for (const frame of this.localFrameHashes.keys()) {
      if (frame < minFrame) {
        this.localFrameHashes.delete(frame);
      }
    }
    for (const frame of this.remoteFrameHashes.keys()) {
      if (frame < minFrame) {
        this.remoteFrameHashes.delete(frame);
      }
    }
    for (const frame of this.mismatchedFrames) {
      if (frame < minFrame) {
        this.mismatchedFrames.delete(frame);
      }
    }
  }

  /**
   * Drop stored deterministic GameLogic CRC state for frames strictly lower than `minFrame`.
   */
  pruneGameLogicCrcBefore(minFrame: number): void {
    assertNonNegativeInteger(minFrame, 'minFrame');

    for (const frame of this.localGameLogicCrcs.keys()) {
      if (frame < minFrame) {
        this.localGameLogicCrcs.delete(frame);
      }
    }
    for (const frame of this.remoteGameLogicCrcs.keys()) {
      if (frame < minFrame) {
        this.remoteGameLogicCrcs.delete(frame);
      }
    }
    for (const frame of this.mismatchedGameLogicCrcFrames) {
      if (frame < minFrame) {
        this.mismatchedGameLogicCrcFrames.delete(frame);
      }
    }
  }

  /**
   * Drop all deterministic validation caches (frame hashes + GameLogic CRCs)
   * for frames strictly lower than `minFrame`.
   */
  pruneValidationBefore(minFrame: number): void {
    this.pruneFrameHashesBefore(minFrame);
    this.pruneGameLogicCrcBefore(minFrame);
  }

  evaluateGameLogicCrcConsensus(
    frame: number,
    expectedPlayerIds: ReadonlyArray<number>,
    localPlayerId: number,
  ): GameLogicCrcConsensus {
    assertNonNegativeInteger(frame, 'frame');
    assertNonNegativeInteger(localPlayerId, 'localPlayerId');
    const expected = normalizePlayerIdList(expectedPlayerIds, 'expectedPlayerId');
    const remoteCrcs = this.remoteGameLogicCrcs.get(frame);
    const localCrc = this.localGameLogicCrcs.get(frame);

    const observedByPlayer = new Map<number, number>();
    for (const playerId of expected) {
      if (playerId === localPlayerId) {
        if (typeof localCrc === 'number') {
          observedByPlayer.set(playerId, localCrc);
        }
        continue;
      }
      const remoteCrc = remoteCrcs?.get(playerId);
      if (typeof remoteCrc === 'number') {
        observedByPlayer.set(playerId, remoteCrc);
      }
    }

    const observedPlayerIds = Array.from(observedByPlayer.keys());
    const missingPlayerIds = expected.filter((playerId) => !observedByPlayer.has(playerId));

    const validatorPlayerId = expected.find((playerId) => observedByPlayer.has(playerId));
    const validatorCrc = typeof validatorPlayerId === 'number'
      ? (observedByPlayer.get(validatorPlayerId) ?? null)
      : null;

    if (validatorCrc === null || missingPlayerIds.length > 0) {
      return {
        frame,
        expectedPlayerIds: expected,
        observedPlayerIds,
        missingPlayerIds,
        mismatchedPlayerIds: [],
        validatorCrc,
        status: 'pending',
      };
    }

    const mismatchedPlayerIds = expected.filter((playerId) =>
      observedByPlayer.get(playerId) !== validatorCrc,
    );

    return {
      frame,
      expectedPlayerIds: expected,
      observedPlayerIds,
      missingPlayerIds: [],
      mismatchedPlayerIds,
      validatorCrc,
      status: mismatchedPlayerIds.length > 0 ? 'mismatch' : 'match',
    };
  }

  getPendingGameLogicCrcValidationFrames(): number[] {
    const pendingFrames: number[] = [];
    for (const [frame, remoteCrcs] of this.remoteGameLogicCrcs.entries()) {
      if (!remoteCrcs.size) {
        continue;
      }
      if (!this.localGameLogicCrcs.has(frame)) {
        pendingFrames.push(frame);
      }
    }
    return pendingFrames.sort((left, right) => left - right);
  }

  getPendingGameLogicCrcValidationPlayers(frame: number): number[] {
    assertNonNegativeInteger(frame, 'frame');
    if (this.localGameLogicCrcs.has(frame)) {
      return [];
    }
    const remoteCrcs = this.remoteGameLogicCrcs.get(frame);
    if (!remoteCrcs) {
      return [];
    }
    return Array.from(remoteCrcs.keys()).sort((left, right) => left - right);
  }

  hasPendingGameLogicCrcValidation(frame?: number): boolean {
    if (typeof frame === 'number') {
      assertNonNegativeInteger(frame, 'frame');
      return this.getPendingGameLogicCrcValidationPlayers(frame).length > 0;
    }
    return this.getPendingGameLogicCrcValidationFrames().length > 0;
  }

  sawGameLogicCrcMismatch(frame?: number): boolean {
    if (typeof frame === 'number') {
      assertNonNegativeInteger(frame, 'frame');
      return this.mismatchedGameLogicCrcFrames.has(frame);
    }
    return this.mismatchedGameLogicCrcFrames.size > 0;
  }

  getGameLogicCrcMismatchFrames(): number[] {
    return Array.from(this.mismatchedGameLogicCrcFrames.values()).sort((left, right) => left - right);
  }

  onGameLogicCrcMismatch(listener: GameLogicCrcMismatchListener): () => void {
    this.gameLogicCrcMismatchListeners.add(listener);
    return () => {
      this.gameLogicCrcMismatchListeners.delete(listener);
    };
  }

  recordLocalFrameHash(hash?: number, frame = this.frame): number {
    assertNonNegativeInteger(frame, 'frame');

    const resolvedHash = typeof hash === 'number'
      ? normalizeUnsignedHash(hash)
      : this.computeFrameHash(frame);

    if (resolvedHash === null) {
      throw new Error('No frame hash provider configured');
    }

    this.localFrameHashes.set(frame, resolvedHash);
    const remoteHashes = this.remoteFrameHashes.get(frame);
    if (remoteHashes) {
      for (const [playerId, remoteHash] of remoteHashes.entries()) {
        this.maybeMarkMismatch(frame, playerId, resolvedHash, remoteHash);
      }
    }
    return resolvedHash;
  }

  getLocalFrameHash(frame: number): number | null {
    assertNonNegativeInteger(frame, 'frame');
    const hash = this.localFrameHashes.get(frame);
    return typeof hash === 'number' ? hash : null;
  }

  recordRemoteFrameHash(frame: number, playerId: number, hash: number): boolean {
    assertNonNegativeInteger(frame, 'frame');
    assertNonNegativeInteger(playerId, 'playerId');
    const normalizedHash = normalizeUnsignedHash(hash);

    let remoteHashesForFrame = this.remoteFrameHashes.get(frame);
    if (!remoteHashesForFrame) {
      remoteHashesForFrame = new Map<number, number>();
      this.remoteFrameHashes.set(frame, remoteHashesForFrame);
    }
    remoteHashesForFrame.set(playerId, normalizedHash);

    const localHash = this.localFrameHashes.get(frame);
    if (typeof localHash !== 'number') {
      return false;
    }
    return this.maybeMarkMismatch(frame, playerId, localHash, normalizedHash);
  }

  getRemoteFrameHashes(frame: number): ReadonlyMap<number, number> {
    assertNonNegativeInteger(frame, 'frame');
    return new Map(this.remoteFrameHashes.get(frame));
  }

  sawFrameHashMismatch(frame?: number): boolean {
    if (typeof frame === 'number') {
      assertNonNegativeInteger(frame, 'frame');
      return this.mismatchedFrames.has(frame);
    }
    return this.mismatchedFrames.size > 0;
  }

  getFrameHashMismatchFrames(): number[] {
    return Array.from(this.mismatchedFrames.values()).sort((left, right) => left - right);
  }

  onFrameHashMismatch(listener: FrameHashMismatchListener): () => void {
    this.mismatchListeners.add(listener);
    return () => {
      this.mismatchListeners.delete(listener);
    };
  }

  reset(
    options: Pick<DeterministicStateOptions<TPayload>, 'initialFrame' | 'initialObjectId' | 'initialRandomSeedCrc'> = {},
  ): void {
    const initialFrame = options.initialFrame ?? 0;
    const initialObjectId = options.initialObjectId ?? FIRST_OBJECT_ID;
    const initialRandomSeedCrc = options.initialRandomSeedCrc ?? 0;
    assertNonNegativeInteger(initialFrame, 'initialFrame');
    assertObjectIdCounter(initialObjectId);
    assertUnsignedInt(initialRandomSeedCrc, 'initialRandomSeedCrc');

    this.frame = initialFrame;
    this.nextObjectId = initialObjectId;
    this.randomSeedCrc = initialRandomSeedCrc >>> 0;
    this.commands.length = 0;
    this.localFrameHashes.clear();
    this.remoteFrameHashes.clear();
    this.mismatchedFrames.clear();
    this.localGameLogicCrcs.clear();
    this.remoteGameLogicCrcs.clear();
    this.mismatchedGameLogicCrcFrames.clear();
  }

  private maybeMarkMismatch(
    frame: number,
    playerId: number,
    localHash: number,
    remoteHash: number,
  ): boolean {
    if (localHash === remoteHash) {
      return false;
    }

    this.mismatchedFrames.add(frame);
    const mismatch: FrameHashMismatch = {
      frame,
      playerId,
      localHash,
      remoteHash,
    };

    for (const listener of this.mismatchListeners) {
      listener(mismatch);
    }
    return true;
  }

  private maybeMarkGameLogicCrcMismatch(
    frame: number,
    playerId: number,
    localCrc: number,
    remoteCrc: number,
  ): boolean {
    if (localCrc === remoteCrc) {
      return false;
    }

    this.mismatchedGameLogicCrcFrames.add(frame);
    const mismatch: GameLogicCrcMismatch = {
      frame,
      playerId,
      localCrc,
      remoteCrc,
    };

    for (const listener of this.gameLogicCrcMismatchListeners) {
      listener(mismatch);
    }
    return true;
  }
}
