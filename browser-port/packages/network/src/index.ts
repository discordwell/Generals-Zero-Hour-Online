/**
 * @generals/network
 *
 * Lightweight offline-capable `NetworkInterface`-compatible runtime used while the
 * native network transport is being ported.
 */
import {
  DeterministicFrameState,
  DeterministicStateKernel,
  FrameResendArchive,
  NetworkCommandIdSequencer,
  NETCOMMANDTYPE_ACKBOTH,
  NETCOMMANDTYPE_ACKSTAGE1,
  NETCOMMANDTYPE_ACKSTAGE2,
  NETCOMMANDTYPE_CHAT,
  NETCOMMANDTYPE_DESTROYPLAYER,
  NETCOMMANDTYPE_DISCONNECTCHAT,
  NETCOMMANDTYPE_DISCONNECTEND,
  NETCOMMANDTYPE_DISCONNECTFRAME,
  NETCOMMANDTYPE_DISCONNECTKEEPALIVE,
  NETCOMMANDTYPE_DISCONNECTPLAYER,
  NETCOMMANDTYPE_DISCONNECTSCREENOFF,
  NETCOMMANDTYPE_DISCONNECTSTART,
  NETCOMMANDTYPE_DISCONNECTVOTE,
  NETCOMMANDTYPE_FILE,
  NETCOMMANDTYPE_FILEANNOUNCE,
  NETCOMMANDTYPE_FILEPROGRESS,
  NETCOMMANDTYPE_FRAMEINFO,
  NETCOMMANDTYPE_FRAMERESENDREQUEST,
  NETCOMMANDTYPE_GAMECOMMAND,
  NETCOMMANDTYPE_KEEPALIVE,
  NETCOMMANDTYPE_LOADCOMPLETE,
  NETCOMMANDTYPE_MANGLERQUERY,
  NETCOMMANDTYPE_MANGLERRESPONSE,
  NETCOMMANDTYPE_PACKETROUTERACK,
  NETCOMMANDTYPE_PACKETROUTERQUERY,
  NETCOMMANDTYPE_PLAYERLEAVE,
  NETCOMMANDTYPE_PROGRESS,
  NETCOMMANDTYPE_RUNAHEAD,
  NETCOMMANDTYPE_RUNAHEADMETRICS,
  NETCOMMANDTYPE_TIMEOUTSTART,
  NETCOMMANDTYPE_WRAPPER,
  SOURCE_FRAMES_TO_KEEP,
  doesNetworkCommandRequireCommandId,
  resolveNetworkDirectWrappedCandidate,
  resolveNetworkAssembledWrappedCandidate,
  resolveNetworkMessageGetter,
  resolveNetworkMaskFromMessage,
  resolveNetworkNumericField,
  resolveNetworkNumericFieldFromMessage,
  resolveNetworkPlayerFromMessage,
  resolveNetworkFileCommandIdFromMessage,
  parseNetworkFrameInfoMessage,
  parseNetworkFrameResendRequestMessage,
  parseNetworkPacketRouterQueryMessage,
  parseNetworkPacketRouterAckMessage,
  isNetworkPacketRouterAckFromCurrentRouter,
  resolveNetworkTextFieldFromMessage,
  resolveNetworkCommandTypeFromMessage,
  isNetworkCommandSynchronized,
  hashDeterministicFrameMetadata,
} from '@generals/engine';
import type {
  GameLogicCrcConsensus,
  DeterministicGameLogicCrcSectionWriters,
  NetworkWrapperAssembly,
  Subsystem,
} from '@generals/engine';

interface ChatMessage {
  sender: number;
  text: string;
  mask: number;
}

interface NetworkUser {
  id: number;
  name: string;
  side?: string;
}

interface FileTransferRecord {
  commandId: number;
  path: string;
  progressBySlot: Map<number, number>;
}

interface PacketRouterEvents {
  onPacketRouterQueryReceived?: (querySenderId: number, localPacketRouterId: number) => void;
  onPacketRouterAckReceived?: (ackSenderId: number, packetRouterSlot: number) => void;
}

type TransportLike = {
  getIncomingBytesPerSecond?: () => number;
  getIncomingPacketsPerSecond?: () => number;
  getOutgoingBytesPerSecond?: () => number;
  getOutgoingPacketsPerSecond?: () => number;
  getUnknownBytesPerSecond?: () => number;
  getUnknownPacketsPerSecond?: () => number;
  sendLocalCommandDirect?: (command: unknown, relayMask: number) => void;
};

type TransportMetricName =
  | 'getIncomingBytesPerSecond'
  | 'getIncomingPacketsPerSecond'
  | 'getOutgoingBytesPerSecond'
  | 'getOutgoingPacketsPerSecond'
  | 'getUnknownBytesPerSecond'
  | 'getUnknownPacketsPerSecond';

const MAX_FRAME_RATE = 300;
const MAX_SLOTS = 16;
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_RUN_AHEAD = 30;
const SOURCE_NETWORK_PLAYER_TIMEOUT_MS = 60000;
const SOURCE_NETWORK_DISCONNECT_SCREEN_NOTIFY_TIMEOUT_MS = 15000;

/**
 * Represents the single-player/default network state that keeps the game logic in sync
 * even before multiplayer transport is ported.
 */
export class NetworkManager implements Subsystem {
  readonly name = '@generals/network';

  private started = false;
  private forceSinglePlayer = false;
  private localPlayerID = 0;
  private localPlayerName = 'Player 1';
  private numPlayers = 1;
  private readonly deterministicState = new DeterministicStateKernel<unknown>({
    frameHashProvider: hashDeterministicFrameMetadata,
  });
  private readonly frameState = new DeterministicFrameState();
  private lastExecutionFrame = 0;
  private frameRate = DEFAULT_FRAME_RATE;
  private runAhead = DEFAULT_RUN_AHEAD;
  private networkOn = true;
  private lastUpdateMs = 0;
  private pingFrame = 0;
  private pingsSent = 0;
  private pingsReceived = 0;
  private lastPingMs = 0;
  private pingPeriodMs = 10000;
  private pingRepeats = 5;
  private disconnectTimeoutMs = 10000;
  private disconnectPlayerTimeoutMs = SOURCE_NETWORK_PLAYER_TIMEOUT_MS;
  private disconnectScreenNotifyTimeoutMs = SOURCE_NETWORK_DISCONNECT_SCREEN_NOTIFY_TIMEOUT_MS;
  private disconnectKeepAliveIntervalMs = 500;
  private chatHistory: ChatMessage[] = [];
  private playerNames = new Map<number, string>();
  private playerSides = new Map<number, string>();
  private disconnectedPlayers = new Set<number>();
  private fileTransfers = new Map<number, FileTransferRecord>();
  private activeWrapperAssemblies = new Map<number, NetworkWrapperAssembly>();
  private readonly frameResendArchive = new FrameResendArchive({
    framesToKeep: SOURCE_FRAMES_TO_KEEP,
  });
  private readonly commandIdSequencer = new NetworkCommandIdSequencer();
  private commandIdSeed = 1;
  private crcMismatch = false;
  private loadProgress = 0;
  private transport: unknown = null;
  private localIp = '';
  private localPort = 0;
  private slotAverageFPS = new Int32Array(MAX_SLOTS).fill(-1);
  private slotAverageLatency = new Float32Array(MAX_SLOTS).fill(-1);
  private packetRouterSlot = -1;
  private lastPacketRouterQuerySender = -1;
  private lastPacketRouterAckSender = -1;
  private packetRouterEvents: PacketRouterEvents;
  private readonly nowProvider: () => number;

  constructor(options: NetworkManagerOptions = {}) {
    this.deterministicState.onFrameHashMismatch(() => {
      this.crcMismatch = true;
    });
    this.deterministicState.onGameLogicCrcMismatch(() => {
      this.crcMismatch = true;
    });

    this.forceSinglePlayer = options.forceSinglePlayer ?? false;
    if (typeof options.localPlayerID === 'number' && Number.isInteger(options.localPlayerID)) {
      this.localPlayerID = Math.max(0, options.localPlayerID);
    }
    if (options.localPlayerName) {
      this.localPlayerName = options.localPlayerName;
    }
    if (typeof options.frameRate === 'number' && Number.isFinite(options.frameRate)) {
      this.frameRate = Math.min(MAX_FRAME_RATE, Math.max(1, Math.floor(options.frameRate)));
    }
    if (typeof options.runAhead === 'number' && Number.isFinite(options.runAhead) && options.runAhead >= 0) {
      this.runAhead = Math.max(0, Math.floor(options.runAhead));
    }
    if (typeof options.disconnectTimeoutMs === 'number' && Number.isFinite(options.disconnectTimeoutMs)) {
      this.disconnectTimeoutMs = Math.max(0, options.disconnectTimeoutMs);
    }
    if (typeof options.disconnectPlayerTimeoutMs === 'number' && Number.isFinite(options.disconnectPlayerTimeoutMs)) {
      this.disconnectPlayerTimeoutMs = Math.max(0, options.disconnectPlayerTimeoutMs);
    }
    if (
      typeof options.disconnectScreenNotifyTimeoutMs === 'number'
      && Number.isFinite(options.disconnectScreenNotifyTimeoutMs)
    ) {
      this.disconnectScreenNotifyTimeoutMs = Math.max(0, options.disconnectScreenNotifyTimeoutMs);
    }
    if (
      typeof options.disconnectKeepAliveIntervalMs === 'number'
      && Number.isFinite(options.disconnectKeepAliveIntervalMs)
    ) {
      this.disconnectKeepAliveIntervalMs = Math.max(0, options.disconnectKeepAliveIntervalMs);
    }
    if (options.gameLogicCrcSectionWriters) {
      this.deterministicState.setGameLogicCrcSectionWriters(options.gameLogicCrcSectionWriters);
    }
    this.packetRouterEvents = options.packetRouterEvents ?? {};
    this.nowProvider = options.nowProvider
      ?? (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now());
  }

  init(): void {
    this.started = true;
    this.deterministicState.reset({ initialFrame: 0 });
    this.lastExecutionFrame = -1;
    this.frameState.reset({
      initialFrameReady: true,
      initialExpectedNetworkFrame: 0,
      initialPendingFrameNotices: 0,
    });
    this.lastUpdateMs = this.now();
    this.lastPingMs = this.lastUpdateMs;
    this.pingFrame = 0;
    this.pingsSent = 0;
    this.pingsReceived = 0;
    this.disconnectedPlayers.clear();
    this.playerSides.clear();

    if (this.forceSinglePlayer) {
      this.numPlayers = 1;
    }

    if (this.lastExecutionFrame < 0) {
      this.lastExecutionFrame = 0;
    }
    this.networkOn = true;
    this.crcMismatch = false;
    this.loadProgress = 0;
    this.slotAverageFPS.fill(-1);
    this.slotAverageLatency.fill(-1);
    this.packetRouterSlot = 0;
    this.lastPacketRouterQuerySender = -1;
    this.lastPacketRouterAckSender = -1;
    this.frameResendArchive.reset();
    this.activeWrapperAssemblies.clear();
  }

  reset(): void {
    this.deterministicState.reset({ initialFrame: 0 });
    this.lastExecutionFrame = 0;
    this.frameState.reset({
      initialFrameReady: this.forceSinglePlayer,
      initialExpectedNetworkFrame: 0,
      initialPendingFrameNotices: 0,
    });
    this.disconnectedPlayers.clear();
    this.lastUpdateMs = this.now();
    this.lastPingMs = this.lastUpdateMs;
    this.pingFrame = 0;
    this.pingsSent = 0;
    this.pingsReceived = 0;
    this.chatHistory.length = 0;
    this.fileTransfers.clear();
    this.playerSides.clear();
    this.slotAverageFPS.fill(-1);
    this.slotAverageLatency.fill(-1);
    this.packetRouterSlot = -1;
    this.lastPacketRouterQuerySender = -1;
    this.lastPacketRouterAckSender = -1;
    this.frameResendArchive.reset();
    this.activeWrapperAssemblies.clear();
  }

  dispose(): void {
    this.started = false;
    this.deterministicState.clearCommands();
    this.frameState.reset({
      initialFrameReady: false,
      initialExpectedNetworkFrame: 0,
      initialPendingFrameNotices: 0,
    });
    this.disconnectedPlayers.clear();
    this.chatHistory.length = 0;
    this.fileTransfers.clear();
    this.lastPacketRouterQuerySender = -1;
    this.lastPacketRouterAckSender = -1;
    this.frameResendArchive.reset();
    this.activeWrapperAssemblies.clear();
  }

  private get frameReady(): boolean {
    return this.frameState.isFrameReady();
  }

  private set frameReady(ready: boolean) {
    this.frameState.setFrameReady(ready);
  }

  private get pendingFrameNotices(): number {
    return this.frameState.getPendingFrameNotices();
  }

  private set pendingFrameNotices(count: number) {
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    this.frameState.setPendingFrameNotices(safeCount);
  }

  private get frameQueueReady(): Set<number> {
    return this.frameState.getReadyFrames();
  }

  private getGameFrameValue(): number {
    return this.deterministicState.getFrame();
  }

  private advanceGameFrame(): number {
    return this.deterministicState.advanceFrame();
  }

  private pruneDeterministicValidationWindow(frame: number): void {
    const safeFrame = Math.max(0, Math.trunc(frame));
    const framesToKeep = this.frameResendArchive.getFramesToKeep();
    // Source parity:
    // - Generals/Code/GameEngine/Source/GameNetwork/NetworkUtil.cpp (FRAMES_TO_KEEP from MAX_FRAMES_AHEAD)
    // - Generals/Code/GameEngine/Source/GameNetwork/ConnectionManager.cpp (getFrameCommandList reset window)
    // getFrameCommandList(frame) resets exactly (frame - FRAMES_TO_KEEP), which means
    // frames strictly below (frame - FRAMES_TO_KEEP + 1) are no longer retained.
    const minFrame = Math.max(0, safeFrame - framesToKeep + 1);
    this.deterministicState.pruneValidationBefore(minFrame);
  }

  private captureLocalFrameHash(frame = this.getGameFrameValue()): number {
    return this.deterministicState.recordLocalFrameHash(undefined, frame);
  }

  private queueIncomingDeterministicCommand(commandType: number, message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as { [key: string]: unknown };
    const player = resolveNetworkPlayerFromMessage(msg) ?? this.localPlayerID;
    const commandId = resolveNetworkNumericFieldFromMessage(
      msg,
      ['commandId', 'sortNumber', 'id', 'commandID', 'frame', 'executionFrame'],
      ['getCommandID', 'getID', 'getSortNumber', 'getFrame', 'getExecutionFrame'],
    );

    const sortNumber = commandId === null ? 0 : Math.trunc(commandId);
    const safePlayer = Math.max(0, Math.trunc(player));
    const dedupeKey = commandId === null ? undefined : `${commandType}:${safePlayer}:${sortNumber}`;

    this.deterministicState.enqueueCommand({
      commandType,
      playerId: safePlayer,
      sortNumber,
      payload: msg,
      dedupeKey,
    });
  }

  private recordSynchronizedFrameCommand(commandType: number, message: unknown): void {
    // FrameInfo commands are synchronized in source policy but are handled through
    // processFrameInfoCommand() for frame-count ownership instead of command replay.
    if (!isNetworkCommandSynchronized(commandType) || commandType === NETCOMMANDTYPE_FRAMEINFO) {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as { [key: string]: unknown };
    const sender = resolveNetworkPlayerFromMessage(msg);
    const frame = resolveNetworkNumericFieldFromMessage(
      msg,
      ['executionFrame', 'frame', 'gameFrame'],
      ['getExecutionFrame', 'getFrame'],
    );

    if (sender === null || frame === null) {
      return;
    }

    const safeSender = Math.trunc(sender);
    const safeFrame = Math.trunc(frame);
    if (
      !Number.isInteger(safeSender)
      || !Number.isInteger(safeFrame)
      || safeSender < 0
      || safeSender >= MAX_SLOTS
      || safeFrame < 0
    ) {
      return;
    }

    this.frameState.recordFrameCommand(safeSender, safeFrame);
    this.frameResendArchive.recordSynchronizedCommand(
      safeSender,
      safeFrame,
      msg,
    );
    this.reconcileFrameCommandState(safeFrame, [safeSender]);
  }

  private reconcileFrameCommandState(frame: number, playerIds: ReadonlyArray<number> = []): {
    status: 'ready' | 'not-ready' | 'resend';
    pendingPlayers: number[];
    continuationAllowed: boolean;
    readyToAdvance: boolean;
    disconnectScreenTransitionedToOff: boolean;
  } {
    const safeFrame = Math.max(0, Math.trunc(frame));
    const connectedPlayerIds = this.getConnectedPlayerIds();
    const uniquePlayerIds = new Set<number>(connectedPlayerIds);
    for (const playerId of playerIds) {
      const safePlayerId = Math.trunc(playerId);
      if (safePlayerId < 0 || safePlayerId >= MAX_SLOTS) {
        continue;
      }
      uniquePlayerIds.add(safePlayerId);
    }
    const evaluation = this.frameState.evaluateFrameExecutionReadiness(
      safeFrame,
      uniquePlayerIds.values(),
      this.localPlayerID,
    );

    if (evaluation.status === 'resend') {
      for (const request of evaluation.resendRequests) {
        this.sendFrameResendRequestCommand(request.playerId, request.frame);
      }
    }

    if (evaluation.disconnectScreenTransitionedToOff) {
      this.notifyOthersOfNewFrame(evaluation.frame);
    }

    return {
      status: evaluation.status,
      pendingPlayers: evaluation.pendingPlayers,
      continuationAllowed: evaluation.continuationAllowed,
      readyToAdvance: evaluation.readyToAdvance,
      disconnectScreenTransitionedToOff: evaluation.disconnectScreenTransitionedToOff,
    };
  }

  private sendFrameResendRequestCommand(playerId: number, frame: number): void {
    const safePlayerId = Math.trunc(playerId);
    const safeFrame = Math.trunc(frame);
    if (
      !Number.isInteger(safePlayerId)
      || !Number.isInteger(safeFrame)
      || safePlayerId < 0
      || safePlayerId >= MAX_SLOTS
      || safeFrame < 0
    ) {
      return;
    }

    const resendTarget = this.frameState.resolveFrameResendTarget(
      safePlayerId,
      this.disconnectedPlayers.has(safePlayerId)
        ? this.getConnectedPlayerIds()
        : [safePlayerId, ...this.getConnectedPlayerIds()],
    );
    if (resendTarget === null || resendTarget < 0 || resendTarget >= MAX_SLOTS) {
      return;
    }

    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend !== 'function') {
      return;
    }

    const message = {
      commandType: NETCOMMANDTYPE_FRAMERESENDREQUEST,
      type: 'frameresendrequest',
      sender: this.localPlayerID,
      frameToResend: safeFrame,
      frame: safeFrame,
    };
    this.assignCommandIdIfRequired(message);
    directSend.call(transport, message, 1 << resendTarget);
  }

  /**
   * Advance one local frame and mark upcoming command slots as ready.
   */
  update(): void {
    if (!this.started) {
      return;
    }
    if (!this.networkOn) {
      return;
    }

    const now = this.now();
    this.updateDisconnectTimeoutState(now);
    if (now - this.lastUpdateMs >= 1000 / this.frameRate) {
      this.lastUpdateMs = now;
      const gameFrame = this.getGameFrameValue();
      this.consumeReadyFrame(gameFrame);
      this.captureLocalFrameHash(gameFrame);
      this.deterministicState.clearCommands();
      const nextGameFrame = this.advanceGameFrame();
      this.frameResendArchive.pruneHistory(nextGameFrame);
      this.frameState.notePlayerAdvancedFrame(this.localPlayerID, nextGameFrame);
      this.lastExecutionFrame = Math.max(this.lastExecutionFrame, nextGameFrame + this.runAhead);
      this.frameState.decrementPendingFrameNotices();
      this.frameState.markFrameReady(nextGameFrame);
      this.tickPings(now);
    }
  }

  private updateDisconnectTimeoutState(nowMs: number): void {
    const connectedPlayerIds = this.getConnectedPlayerIds();
    const stall = this.frameState.evaluateDisconnectStall(
      this.getGameFrameValue(),
      nowMs,
      this.disconnectTimeoutMs,
      this.disconnectKeepAliveIntervalMs,
    );

    if (stall.shouldTurnOnScreen) {
      this.frameState.resetDisconnectPlayerTimeouts(
        this.localPlayerID,
        connectedPlayerIds,
        nowMs,
      );
    }

    if (stall.state === 'screen-on') {
      const status = this.frameState.evaluateDisconnectStatus({
        frame: this.getGameFrameValue(),
        nowMs,
        localPlayerId: this.localPlayerID,
        connectedPlayerIds,
        packetRouterSlot: this.packetRouterSlot,
        playerTimeoutMs: this.disconnectPlayerTimeoutMs,
        disconnectScreenNotifyTimeoutMs: this.disconnectScreenNotifyTimeoutMs,
        packetRouterFallbackSlots: connectedPlayerIds,
      });

      if (status.shouldNotifyOthersOfCurrentFrame) {
        this.notifyOthersOfCurrentFrame();
      }

      for (const playerId of status.playersToDisconnect) {
        this.disconnectTimedOutPlayer(playerId, status.frame);
      }
    }

    if (stall.shouldSendKeepAlive) {
      this.sendDisconnectKeepAliveCommand();
    }
  }

  private disconnectTimedOutPlayer(playerId: number, disconnectFrame: number): void {
    const safePlayerId = Math.trunc(playerId);
    const safeDisconnectFrame = Math.max(0, Math.trunc(disconnectFrame));
    if (
      !Number.isInteger(safePlayerId)
      || safePlayerId < 0
      || safePlayerId >= MAX_SLOTS
      || safePlayerId === this.localPlayerID
      || !this.isPlayerConnected(safePlayerId)
    ) {
      return;
    }

    this.sendDisconnectPlayerCommand(safePlayerId, safeDisconnectFrame);
    this.sendDestroyPlayerCommand(safePlayerId);
    this.markPlayerDisconnected(safePlayerId);
  }

  /**
   * Source parity:
   * - DisconnectManager::sendDisconnectCommand + disconnectPlayer.
   *
   * - Generals/Code/GameEngine/Source/GameNetwork/DisconnectManager.cpp
   *   (DisconnectManager::sendDisconnectCommand)
   */
  private sendDisconnectPlayerCommand(disconnectSlot: number, disconnectFrame: number): void {
    const safeDisconnectSlot = Math.trunc(disconnectSlot);
    const safeDisconnectFrame = Math.max(0, Math.trunc(disconnectFrame));
    if (
      !Number.isInteger(safeDisconnectSlot)
      || safeDisconnectSlot < 0
      || safeDisconnectSlot >= MAX_SLOTS
    ) {
      return;
    }

    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend !== 'function') {
      return;
    }

    let relayMask = 0;
    for (const playerId of this.getConnectedPlayerIds()) {
      if (playerId === this.localPlayerID) {
        continue;
      }
      relayMask |= (1 << playerId);
    }
    if (relayMask === 0) {
      return;
    }

    const message = {
      commandType: NETCOMMANDTYPE_DISCONNECTPLAYER,
      type: 'disconnectplayer',
      sender: this.localPlayerID,
      playerID: this.localPlayerID,
      disconnectSlot: safeDisconnectSlot,
      slot: safeDisconnectSlot,
      disconnectFrame: safeDisconnectFrame,
      frame: safeDisconnectFrame,
    };
    this.assignCommandIdIfRequired(message);
    this.stageLocalCommandForDeterministicSync(message.commandType, message);
    directSend.call(transport, message, relayMask);
  }

  /**
   * Source parity:
   * - Generals/Code/GameEngine/Source/GameNetwork/DisconnectManager.cpp
   *   (DisconnectManager::sendPlayerDestruct)
   *
   * - Generals/Code/GameEngine/Source/GameNetwork/ConnectionManager.cpp
   *   (ConnectionManager::sendLocalCommand local frame-data insertion path)
   */
  private sendDestroyPlayerCommand(playerSlot: number): void {
    const safePlayerSlot = Math.trunc(playerSlot);
    if (
      !Number.isInteger(safePlayerSlot)
      || safePlayerSlot < 0
      || safePlayerSlot >= MAX_SLOTS
    ) {
      return;
    }

    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend !== 'function') {
      return;
    }

    let relayMask = 0;
    for (const playerId of this.getConnectedPlayerIds()) {
      if (playerId === this.localPlayerID) {
        continue;
      }
      relayMask |= (1 << playerId);
    }
    if (relayMask === 0) {
      return;
    }

    const executionFrame = this.getExecutionFrame() + 1;
    const message = {
      commandType: NETCOMMANDTYPE_DESTROYPLAYER,
      type: 'destroyplayer',
      sender: this.localPlayerID,
      playerID: this.localPlayerID,
      playerIndex: safePlayerSlot,
      slot: safePlayerSlot,
      executionFrame,
      frame: executionFrame,
    };
    this.assignCommandIdIfRequired(message);
    this.stageLocalCommandForDeterministicSync(message.commandType, message);
    directSend.call(transport, message, relayMask);
  }

  /**
   * Source parity:
   * - Generals/Code/GameEngine/Source/GameNetwork/ConnectionManager.cpp
   *   (ConnectionManager::sendLocalCommand adds local command into frame data before relay)
   */
  private stageLocalCommandForDeterministicSync(commandType: number, message: unknown): void {
    this.queueIncomingDeterministicCommand(commandType, message);
    this.recordSynchronizedFrameCommand(commandType, message);
  }

  private sendDisconnectKeepAliveCommand(): void {
    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend !== 'function') {
      return;
    }

    let relayMask = 0;
    for (const playerId of this.getConnectedPlayerIds()) {
      if (playerId === this.localPlayerID) {
        continue;
      }
      relayMask |= (1 << playerId);
    }
    if (relayMask === 0) {
      return;
    }

    const message = {
      commandType: NETCOMMANDTYPE_DISCONNECTKEEPALIVE,
      type: 'disconnectkeepalive',
      sender: this.localPlayerID,
      playerID: this.localPlayerID,
    };
    directSend.call(transport, message, relayMask);
  }

  private tickPings(now = this.now()): void {
    if (!this.started || !this.networkOn) {
      return;
    }

    if (now - this.lastPingMs >= this.pingPeriodMs) {
      this.lastPingMs = now;
      this.pingFrame = this.getGameFrameValue();
      this.pingsSent = this.pingRepeats;
      this.pingsReceived = this.pingRepeats;
    }
  }

  liteupdate(): void {
    if (!this.started) {
      return;
    }
    this.update();
  }

  /**
   * Dispatch an inbound network command object to its handler.
   * @returns true when a command was consumed.
   */
  processIncomingCommand(message: unknown): boolean {
    const commandType = resolveNetworkCommandTypeFromMessage(message);
    if (commandType === null) {
      return false;
    }
    this.queueIncomingDeterministicCommand(commandType, message);
    this.recordSynchronizedFrameCommand(commandType, message);

    if (commandType === NETCOMMANDTYPE_FRAMEINFO) {
      this.processFrameInfoCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_RUNAHEADMETRICS) {
      this.processRunAheadMetricsCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_RUNAHEAD) {
      this.processRunaheadCommand(message);
      return true;
    }

    if (
      commandType === NETCOMMANDTYPE_ACKBOTH
      || commandType === NETCOMMANDTYPE_ACKSTAGE1
      || commandType === NETCOMMANDTYPE_ACKSTAGE2
      || commandType === NETCOMMANDTYPE_GAMECOMMAND
      || commandType === NETCOMMANDTYPE_MANGLERQUERY
      || commandType === NETCOMMANDTYPE_MANGLERRESPONSE
    ) {
      return true;
    }

    if (commandType === NETCOMMANDTYPE_PLAYERLEAVE) {
      this.processPlayerLeaveCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_DESTROYPLAYER) {
      this.processDestroyPlayerCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_KEEPALIVE) {
      return true;
    }

    if (commandType === NETCOMMANDTYPE_DISCONNECTCHAT) {
      this.processDisconnectChatCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_CHAT) {
      this.processChatCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_PROGRESS) {
      this.processProgressCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_TIMEOUTSTART) {
      this.processTimeoutStartCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_LOADCOMPLETE) {
      this.processLoadCompleteCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_FILE) {
      this.processFileCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_FILEANNOUNCE) {
      this.processFileAnnounceCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_FILEPROGRESS) {
      this.processFileProgressCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_FRAMERESENDREQUEST) {
      this.processFrameResendRequestCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_WRAPPER) {
      this.processWrapperCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_PACKETROUTERQUERY) {
      this.processPacketRouterQueryCommand(message);
      return true;
    }

    if (commandType === NETCOMMANDTYPE_PACKETROUTERACK) {
      this.processPacketRouterAckCommand(message);
      return true;
    }

    if ((commandType > NETCOMMANDTYPE_DISCONNECTSTART) && (commandType < NETCOMMANDTYPE_DISCONNECTEND)) {
      this.processDisconnectCommand(commandType, message);
      return true;
    }

    return false;
  }

  setLocalAddress(ip: string | number = 0, port = 0): void {
    const normalizedIp = String(ip).trim();
    if (!normalizedIp || normalizedIp === '0') {
      this.localIp = '';
    } else {
      this.localIp = normalizedIp;
    }
    this.localPort = port;
  }

  setLocalAddressFromHost(ip: string, port = 0): void {
    this.localIp = ip;
    this.localPort = port;
  }

  getLocalAddress(): string {
    if (!this.localIp) {
      return '';
    }
    return `${this.localIp}:${this.localPort}`;
  }

  isFrameDataReady(): boolean {
    if (!this.frameReady) {
      return false;
    }
    return this.areFrameCommandsReady(this.getGameFrameValue());
  }

  setFrameContinuationGate(gate: ((frame: number) => boolean) | null): void {
    this.frameState.setContinuationGate(gate);
  }

  setDisconnectTimeout(disconnectTimeoutMs: number): void {
    if (!Number.isFinite(disconnectTimeoutMs)) {
      return;
    }
    this.disconnectTimeoutMs = Math.max(0, disconnectTimeoutMs);
  }

  setDisconnectPlayerTimeout(disconnectPlayerTimeoutMs: number): void {
    if (!Number.isFinite(disconnectPlayerTimeoutMs)) {
      return;
    }
    this.disconnectPlayerTimeoutMs = Math.max(0, disconnectPlayerTimeoutMs);
  }

  setDisconnectScreenNotifyTimeout(disconnectScreenNotifyTimeoutMs: number): void {
    if (!Number.isFinite(disconnectScreenNotifyTimeoutMs)) {
      return;
    }
    this.disconnectScreenNotifyTimeoutMs = Math.max(0, disconnectScreenNotifyTimeoutMs);
  }

  setDisconnectKeepAliveInterval(disconnectKeepAliveIntervalMs: number): void {
    if (!Number.isFinite(disconnectKeepAliveIntervalMs)) {
      return;
    }
    this.disconnectKeepAliveIntervalMs = Math.max(0, disconnectKeepAliveIntervalMs);
  }

  private getConnectedPlayerIds(): number[] {
    const connected = new Set<number>();
    if (this.isPlayerConnected(this.localPlayerID)) {
      connected.add(this.localPlayerID);
    }

    if (this.playerNames.size > 0) {
      for (const slot of this.playerNames.keys()) {
        if (this.isPlayerConnected(slot)) {
          connected.add(slot);
        }
      }
    } else {
      for (let slot = 0; slot < this.numPlayers; slot += 1) {
        if (this.isPlayerConnected(slot)) {
          connected.add(slot);
        }
      }
    }

    if (connected.size === 0) {
      connected.add(this.localPlayerID);
    }

    return [...connected.values()];
  }

  private areFrameCommandsReady(frame: number): boolean {
    return this.reconcileFrameCommandState(frame).readyToAdvance;
  }

  /**
   * Source parity:
   * - Network::RelayCommandsToCommandList consumes frame data only after allCommandsReady.
   * - ConnectionManager::getFrameCommandList then clears consumed-frame ownership.
   */
  consumeReadyFrame(frame = this.getGameFrameValue()): boolean {
    const safeFrame = Math.max(0, Math.trunc(frame));
    const readiness = this.reconcileFrameCommandState(safeFrame);
    if (!readiness.readyToAdvance) {
      return false;
    }

    this.frameState.consumeFrameCommandData(safeFrame);
    this.pruneDeterministicValidationWindow(safeFrame);
    return true;
  }

  getPendingFrameCommandPlayers(frame = this.getGameFrameValue()): number[] {
    return this.reconcileFrameCommandState(frame).pendingPlayers;
  }

  parseUserList(game: unknown): void {
    if (this.forceSinglePlayer) {
      this.numPlayers = 1;
      this.playerNames.clear();
      this.playerSides.clear();
      this.playerNames.set(this.localPlayerID, this.localPlayerName);
      this.disconnectedPlayers.clear();
      this.frameQueueReady.clear();
      this.pendingFrameNotices = 0;
      this.frameReady = true;
      return;
    }

    const resolvedList = this.normalizeGameUserList(game);
    this.disconnectedPlayers.clear();
    // Native network code clears queued frame messages here and wipes the next runAhead-1 frames.
    this.frameQueueReady.clear();
    this.pendingFrameNotices = 0;
    this.frameReady = true;
    this.playerNames.clear();
    this.playerSides.clear();

    for (const user of resolvedList) {
      this.playerNames.set(user.id, user.name);
      if (typeof user.side === 'string' && user.side.trim().length > 0) {
        this.playerSides.set(user.id, user.side.trim());
      }
    }

    this.numPlayers = Math.max(1, this.playerNames.size);

    if (!this.playerNames.size) {
      this.playerNames.set(this.localPlayerID, this.localPlayerName);
    }
  }

  private normalizeGameUserList(game: unknown): NetworkUser[] {
    if (!game || typeof game !== 'object') {
      return [];
    }

    const maybeUsers = game as {
      packetRouterSlot?: unknown;
      getPacketRouterSlot?: () => unknown;
      users?: unknown;
      userList?: unknown;
      playerList?: unknown;
      players?: unknown;
      slots?: unknown;
      getMaxPlayers?: () => unknown;
      getNumPlayers?: () => unknown;
      getSlots?: () => unknown;
      playersBySlot?: unknown;
      localSlot?: unknown;
      localSlotNum?: unknown;
      getLocalSlotNum?: () => unknown;
      localPlayerId?: unknown;
      localPlayerID?: unknown;
      localPlayerName?: unknown;
      getSlot?: (slotNum: number) => unknown;
      getConstSlot?: (slotNum: number) => unknown;
    };

    const normalizeBoolean = (value: unknown): boolean | undefined => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        return value !== 0;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
          return true;
        }
        if (normalized === '0' || normalized === 'false' || normalized === 'no') {
          return false;
        }
      }
      return undefined;
    };

    const normalizeSlotValue = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isInteger(value)) {
        return value;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^[+-]?\d+$/.test(trimmed)) {
          return null;
        }
        const parsed = Number(trimmed);
        if (Number.isInteger(parsed)) {
          return parsed;
        }
      }

      return null;
    };

    const readSlotProperty = (slot: unknown, property: string): unknown => {
      if (!slot || typeof slot !== 'object') {
        return undefined;
      }
      const slotObj = slot as {
        [key: string]: unknown;
      };
      const candidate = slotObj[property];
      if (typeof candidate === 'function') {
        try {
          return (candidate as () => unknown).call(slotObj);
        } catch {
          return undefined;
        }
      }
      return candidate;
    };

    const normalizeSlotText = (value: unknown, fallback: string): string => {
      if (typeof value !== 'string') {
        return fallback;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : fallback;
    };

    type UserCandidate = {
      id?: number;
      name?: string;
      slot?: number;
      playerId?: number;
      player?: string;
      side?: string;
      faction?: string;
      isHuman?: boolean | number;
      isAI?: boolean | number | string;
      isOccupied?: boolean | number | string;
    };
    const candidates: UserCandidate[] = [];

    const addUserArray = (value: unknown): void => {
      if (!Array.isArray(value)) {
        return;
      }
      for (const user of value) {
        if (!user || typeof user !== 'object') {
          continue;
        }
        candidates.push(user as UserCandidate);
      }
    };

    const addUserMap = (value: unknown): void => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const mapLike = value as Record<string, UserCandidate>;
      for (const key of Object.keys(mapLike)) {
        const user = mapLike[key];
        if (!user || typeof user !== 'object') {
          continue;
        }
        if (user.id === undefined && /^\d+$/.test(key)) {
          user.id = Number.parseInt(key, 10);
        }
        candidates.push(user);
      }
    };

    const parseLegacyUserList = (value: unknown): void => {
      if (typeof value !== 'string') {
        return;
      }
      if (!value.trim()) {
        return;
      }

      const userEntries = value.split(',');
      for (const userEntry of userEntries) {
        const [namePart] = userEntry.split('@');
        if (!namePart) {
          continue;
        }
        const playerNum = candidates.length;
        candidates.push({
          id: playerNum,
          name: namePart.trim(),
          isHuman: true,
        });
      }
    };

    const normalizeLocalSlot = (value: unknown): number | null => normalizeSlotValue(value);

    const addSlot = (slot: unknown, index: number): void => {
      if (!slot || typeof slot !== 'object') {
        return;
      }

      const slotCandidate = slot as UserCandidate & {
        isAI?: boolean | number | string;
        isHuman?: boolean | number | string;
        isOccupied?: boolean | number | string;
        name?: string;
        player?: string;
        userName?: string;
        username?: string;
        user?: string;
      };
      const isAI = normalizeBoolean(readSlotProperty(slotCandidate, 'isAI'));
      const isHuman = normalizeBoolean(readSlotProperty(slotCandidate, 'isHuman'));
      const isOccupied = normalizeBoolean(readSlotProperty(slotCandidate, 'isOccupied'));

      if (isAI === true || isHuman === false || isOccupied === false) {
        return;
      }

      const idCandidate = normalizeSlotValue(readSlotProperty(slotCandidate, 'id'))
        ?? normalizeSlotValue(readSlotProperty(slotCandidate, 'slot'))
        ?? normalizeSlotValue(readSlotProperty(slotCandidate, 'playerId'));
      const name = normalizeSlotText(
        readSlotProperty(slotCandidate, 'name')
          ?? readSlotProperty(slotCandidate, 'player')
          ?? readSlotProperty(slotCandidate, 'userName')
          ?? readSlotProperty(slotCandidate, 'username')
          ?? readSlotProperty(slotCandidate, 'user'),
        `Player ${index + 1}`,
      );
      const side = normalizeSlotText(
        readSlotProperty(slotCandidate, 'side')
          ?? readSlotProperty(slotCandidate, 'getSide')
          ?? readSlotProperty(slotCandidate, 'faction')
          ?? readSlotProperty(slotCandidate, 'getFaction')
          ?? readSlotProperty(slotCandidate, 'Side')
          ?? readSlotProperty(slotCandidate, 'Faction'),
        '',
      );

      const slotId = typeof idCandidate === 'number' && idCandidate >= 0 ? idCandidate : index;
      if (slotId >= MAX_SLOTS) {
        return;
      }

      candidates.push({
        id: slotId,
        name,
        side,
        isHuman: true,
      });
    };

    const addSlotArray = (slots: unknown): void => {
      if (!Array.isArray(slots)) {
        return;
      }
      slots.forEach((slot, index) => {
        addSlot(slot, index);
      });
    };

    const addSlotByIndex = (
      getSlot: (slotNum: number) => unknown,
      maxSlots?: number,
    ): void => {
      const slotCount = typeof maxSlots === 'number' ? Math.max(0, Math.min(MAX_SLOTS, maxSlots)) : MAX_SLOTS;

      for (let index = 0; index < slotCount; index += 1) {
        const slot = getSlot(index);
        if (!slot) {
          continue;
        }
        addSlot(slot, index);
      }
    };

    addUserArray(maybeUsers.users);
    addUserArray(maybeUsers.playerList);
    addUserArray(maybeUsers.players);
    addUserMap(maybeUsers.playersBySlot);
    parseLegacyUserList(maybeUsers.userList);

    const parsedSlots = maybeUsers.getSlots?.();
    if (parsedSlots !== undefined) {
      addSlotArray(parsedSlots);
    }
    addSlotArray(maybeUsers.slots);
    if (maybeUsers.getConstSlot) {
    const localAwareSlotCount = normalizeSlotValue(
      maybeUsers.getNumPlayers?.()
        ?? maybeUsers.getMaxPlayers?.(),
    );
    addSlotByIndex((slotNum) => {
      if (!maybeUsers.getConstSlot) {
        return null;
      }
      return maybeUsers.getConstSlot(slotNum);
      }, typeof localAwareSlotCount === 'number' ? localAwareSlotCount : undefined);
    } else if (maybeUsers.getSlot) {
      addSlotByIndex((slotNum) => {
        if (!maybeUsers.getSlot) {
          return null;
        }
        return maybeUsers.getSlot(slotNum);
      });
    }

    if (Array.isArray(maybeUsers.playersBySlot as { playerId?: number; name?: string; }[])) {
      addUserArray((maybeUsers.playersBySlot as { playerId?: number; name?: string; }[]));
    }

    const localSlot = normalizeLocalSlot(
      maybeUsers.localSlot
      ?? maybeUsers.localSlotNum
      ?? maybeUsers.getLocalSlotNum?.()
      ?? maybeUsers.localPlayerId
      ?? maybeUsers.localPlayerID,
    );
    if (localSlot !== null && localSlot >= 0) {
      this.localPlayerID = localSlot;
    }

    const localPlayerNameCandidate = this.normalizePlayerName(maybeUsers.localPlayerName);
    if (localPlayerNameCandidate) {
      this.localPlayerName = localPlayerNameCandidate;
    }

    const packetRouterSlotCandidate = normalizeSlotValue(
      maybeUsers.packetRouterSlot ?? maybeUsers.getPacketRouterSlot?.(),
    );
    if (packetRouterSlotCandidate !== null && packetRouterSlotCandidate >= 0 && packetRouterSlotCandidate < MAX_SLOTS) {
      this.packetRouterSlot = packetRouterSlotCandidate;
    }

    const normalizedById = new Map<number, NetworkUser>();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }

      const isHumanValue = candidate.isHuman;
      const isHuman =
        isHumanValue === undefined
          || isHumanValue === true
          || isHumanValue === 1;
      const isAIValue = candidate.isAI;
      const isAI = isAIValue === true || isAIValue === 1 || isAIValue === '1' || isAIValue === 'true';
      const isOccupiedValue = (candidate as { isOccupied?: unknown }).isOccupied;
      const isOccupied = isOccupiedValue === undefined
        || isOccupiedValue === true
        || isOccupiedValue === 1
        || isOccupiedValue === '1'
        || isOccupiedValue === 'true';

      if (!isHuman || isAI || !isOccupied) {
        continue;
      }

      const idCandidate =
        typeof candidate.id === 'number' ? candidate.id :
        typeof candidate.slot === 'number' ? candidate.slot :
        typeof candidate.playerId === 'number' ? candidate.playerId : null;
      if (idCandidate === null || idCandidate < 0) {
        continue;
      }

      if (idCandidate >= MAX_SLOTS) {
        continue;
      }

      const name = this.normalizePlayerName(
        candidate.name ?? candidate.player ?? `Player ${idCandidate + 1}`,
      );
      const sideCandidate = typeof candidate.side === 'string'
        ? candidate.side.trim()
        : (typeof candidate.faction === 'string' ? candidate.faction.trim() : '');
      normalizedById.set(idCandidate, {
        id: idCandidate,
        name,
        side: sideCandidate || undefined,
      });
    }

    const localEntry = normalizedById.get(this.localPlayerID);
    if (localEntry?.name) {
      this.localPlayerName = localEntry.name;
    }

    if (normalizedById.size === 0 && this.forceSinglePlayer === false && this.localPlayerName) {
      normalizedById.set(this.localPlayerID, {
        id: this.localPlayerID,
        name: this.localPlayerName,
      });
    }

    return [...normalizedById.values()];
  }

  private normalizePlayerName(name: unknown): string {
    if (typeof name !== 'string') {
      return this.localPlayerName;
    }
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : this.localPlayerName;
  }

  startGame(): void {
    this.frameReady = true;
    this.frameQueueReady.clear();
    this.pendingFrameNotices = 0;
    this.disconnectedPlayers.clear();
    this.lastPingMs = this.now();
    this.pingFrame = this.getGameFrameValue();
    this.pingsSent = this.pingRepeats;
    this.pingsReceived = this.pingRepeats;
  }

  getRunAhead(): number {
    return this.runAhead;
  }

  getFrameRate(): number {
    return this.frameRate;
  }

  getPacketArrivalCushion(): number {
    return this.runAhead;
  }

  sendChat(text: string, playerMask = 0): void {
    this.chatHistory.push({ sender: this.localPlayerID, text, mask: playerMask });
  }

  sendDisconnectChat(text: string): void {
    this.sendChat(text, 0xff ^ (1 << this.localPlayerID));
  }

  sendFile(path: string, playerMask = 0, commandId = 0): void {
    const key = this.normalizeFilePath(path);
    if (!key) {
      return;
    }

    const normalizedPlayerMask = playerMask >>> 0;

    let transfer = commandId > 0 ? this.fileTransfers.get(commandId) : undefined;
    if (!transfer) {
      transfer = this.findTransferByPath(key);
    }

    if (!transfer) {
      const resolvedCommandId = commandId || this.commandIdSeed++;
      if (commandId >= this.commandIdSeed) {
        this.commandIdSeed = commandId + 1;
      }
      transfer = {
        commandId: resolvedCommandId,
        path: key,
        progressBySlot: this.createTransferProgressByPlayerMask(playerMask),
      };
      this.fileTransfers.set(resolvedCommandId, transfer);
    } else if (commandId > 0 && transfer.commandId !== commandId) {
      if (commandId >= this.commandIdSeed) {
        this.commandIdSeed = commandId + 1;
      }
      this.fileTransfers.delete(transfer.commandId);
      transfer = {
        ...transfer,
        commandId,
      };
      transfer.path = key;
      this.fileTransfers.set(commandId, transfer);
    } else if (transfer.path !== key) {
      transfer.path = key;
    }

    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      if ((normalizedPlayerMask & (1 << slot)) !== 0) {
        transfer.progressBySlot.set(slot, 100);
      }
    }
  }

  sendFileAnnounce(path: string, _playerMask = 0): number {
    const sanitized = this.normalizeFilePath(path);
    if (sanitized) {
      const commandId = this.commandIdSeed++;
      this.fileTransfers.set(commandId, {
        commandId,
        path: sanitized,
        progressBySlot: this.createTransferProgressByPlayerMask(_playerMask),
      });
      return commandId;
    }

    return 0;
  }

  getFileTransferProgress(playerId = 0, path = ''): number {
    const key = this.normalizeFilePath(path);
    if (!key) {
      return 0;
    }

    const transfer = this.findTransferByPath(key);
    if (!transfer) {
      return 0;
    }
    return transfer.progressBySlot.get(playerId) ?? 0;
  }

  private normalizeFilePath(path: string): string {
    if (!path.trim()) {
      return '';
    }
    return path;
  }

  areAllQueuesEmpty(): boolean {
    return this.frameQueueReady.size === 0;
  }

  private createTransferProgressByPlayerMask(playerMask: number): Map<number, number> {
    const progress = new Map<number, number>();
    const normalizedPlayerMask = playerMask >>> 0;
    for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
      const included = (normalizedPlayerMask & (1 << slot)) !== 0;
      progress.set(slot, included ? 0 : 100);
    }
    return progress;
  }

  private findTransferByPath(path: string): FileTransferRecord | undefined {
    for (const transfer of this.fileTransfers.values()) {
      if (transfer.path === path) {
        return transfer;
      }
    }

    return undefined;
  }

  quitGame(): void {
    this.markPlayerDisconnected(this.localPlayerID);
  }

  selfDestructPlayer(index = 0): void {
    this.markPlayerDisconnected(index);
  }

  voteForPlayerDisconnect(slot = 0): void {
    if (slot < 0 || slot >= MAX_SLOTS) {
      return;
    }
    if (slot === this.localPlayerID) {
      return;
    }
    if (this.frameState.hasDisconnectVote(slot, this.localPlayerID)) {
      return;
    }

    const voteFrame = this.getGameFrameValue();
    this.frameState.recordDisconnectVote(
      slot,
      voteFrame,
      this.localPlayerID,
    );
    this.sendDisconnectVoteCommand(slot, voteFrame);
  }

  private sendDisconnectVoteCommand(slot: number, voteFrame: number): void {
    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend !== 'function') {
      return;
    }

    let relayMask = 0;
    for (const playerId of this.getConnectedPlayerIds()) {
      if (playerId === this.localPlayerID) {
        continue;
      }
      relayMask |= (1 << playerId);
    }
    if (relayMask === 0) {
      return;
    }

    const message = {
      commandType: NETCOMMANDTYPE_DISCONNECTVOTE,
      type: 'disconnectvote',
      sender: this.localPlayerID,
      playerID: this.localPlayerID,
      voteSlot: slot,
      slot,
      voteFrame,
    };
    this.assignCommandIdIfRequired(message);
    directSend.call(transport, message, relayMask);
  }

  private assignCommandIdIfRequired(message: { commandType: number; commandId?: number }): void {
    if (!doesNetworkCommandRequireCommandId(message.commandType)) {
      return;
    }
    message.commandId = this.commandIdSequencer.generateNextCommandId();
  }

  private sendFrameDataToPlayer(playerId: number, startingFrame: number): void {
    const safePlayerId = Math.trunc(playerId);
    const safeStartingFrame = Math.trunc(startingFrame);
    if (
      !Number.isInteger(safePlayerId)
      || !Number.isInteger(safeStartingFrame)
      || safePlayerId < 0
      || safePlayerId >= MAX_SLOTS
      || safeStartingFrame < 0
    ) {
      return;
    }

    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend !== 'function') {
      return;
    }

    const currentFrame = this.getGameFrameValue();
    const resendPlan = this.frameResendArchive.buildResendPlan(
      safePlayerId,
      safeStartingFrame,
      currentFrame,
      this.getConnectedPlayerIds(),
    );
    const relayMask = 1 << safePlayerId;

    for (const framePlan of resendPlan.frames) {
      for (const commandEntry of framePlan.commands) {
        directSend.call(
          transport,
          { ...commandEntry.command },
          relayMask,
        );
      }

      for (const frameInfo of framePlan.frameInfo) {
        const frameInfoMessage = {
          commandType: NETCOMMANDTYPE_FRAMEINFO,
          type: 'frameinfo',
          sender: frameInfo.senderPlayerId,
          playerID: frameInfo.senderPlayerId,
          frame: frameInfo.frame,
          executionFrame: frameInfo.frame,
          commandCount: frameInfo.commandCount,
        };
        this.assignCommandIdIfRequired(frameInfoMessage);
        directSend.call(transport, frameInfoMessage, relayMask);
      }
    }
  }

  isPacketRouter(): boolean {
    return this.packetRouterSlot === this.localPlayerID;
  }

  getPacketRouterSlot(): number {
    return this.packetRouterSlot;
  }

  getLastPacketRouterQuerySender(): number {
    return this.lastPacketRouterQuerySender;
  }

  getLastPacketRouterAckSender(): number {
    return this.lastPacketRouterAckSender;
  }

  setSlotAverageFPS(slot = 0, fps = 0): void {
    if (slot < 0 || slot >= MAX_SLOTS) {
      return;
    }
    this.slotAverageFPS[slot] = fps;
  }

  setPacketRouterSlot(slot = -1): void {
    if (slot < 0 || slot >= MAX_SLOTS) {
      this.packetRouterSlot = -1;
      return;
    }
    this.packetRouterSlot = slot;
  }

  getIncomingBytesPerSecond(): number {
    return this.callTransportMetric('getIncomingBytesPerSecond');
  }

  getIncomingPacketsPerSecond(): number {
    return this.callTransportMetric('getIncomingPacketsPerSecond');
  }

  getOutgoingBytesPerSecond(): number {
    return this.callTransportMetric('getOutgoingBytesPerSecond');
  }

  getOutgoingPacketsPerSecond(): number {
    return this.callTransportMetric('getOutgoingPacketsPerSecond');
  }

  getUnknownBytesPerSecond(): number {
    return this.callTransportMetric('getUnknownBytesPerSecond');
  }

  getUnknownPacketsPerSecond(): number {
    return this.callTransportMetric('getUnknownPacketsPerSecond');
  }

  updateLoadProgress(percent = 0): void {
    if (percent < 0) {
      this.loadProgress = 0;
    } else if (percent > 100) {
      this.loadProgress = 100;
    } else {
      this.loadProgress = percent;
    }
  }

  loadProgressComplete(): void {
    this.loadProgress = 100;
  }

  sendTimeOutGameStart(): void {
    this.pendingFrameNotices = 1;
  }

  getLoadProgress(): number {
    return this.loadProgress;
  }

  getGameFrame(): number {
    return this.getGameFrameValue();
  }

  getDeterministicFrameHash(frame = this.getGameFrameValue()): number {
    const safeFrame = Math.max(0, Math.trunc(frame));
    return this.captureLocalFrameHash(safeFrame);
  }

  getDeterministicFrameHashFrames(): {
    local: number[];
    remote: number[];
  } {
    return {
      local: this.deterministicState.getLocalFrameHashFrames(),
      remote: this.deterministicState.getRemoteFrameHashFrames(),
    };
  }

  getDeterministicFrameHashMismatchFrames(): number[] {
    return this.deterministicState.getFrameHashMismatchFrames();
  }

  getDeterministicValidationFramesToKeep(): number {
    return this.frameResendArchive.getFramesToKeep();
  }

  getDeterministicGameLogicCrc(frame = this.getGameFrameValue()): number | null {
    const safeFrame = Math.max(0, Math.trunc(frame));
    const localGameLogicCrc = this.deterministicState.computeGameLogicCrc(safeFrame);
    if (localGameLogicCrc === null) {
      return null;
    }
    return this.deterministicState.recordLocalGameLogicCrc(localGameLogicCrc, safeFrame);
  }

  setDeterministicGameLogicCrcSectionWriters(
    sectionWriters: DeterministicGameLogicCrcSectionWriters<unknown> | null,
  ): void {
    this.deterministicState.setGameLogicCrcSectionWriters(sectionWriters);
  }

  hasPendingDeterministicGameLogicCrcValidation(frame?: number): boolean {
    if (typeof frame === 'number') {
      const safeFrame = Math.max(0, Math.trunc(frame));
      return this.deterministicState.hasPendingGameLogicCrcValidation(safeFrame);
    }
    return this.deterministicState.hasPendingGameLogicCrcValidation();
  }

  getPendingDeterministicGameLogicCrcValidationFrames(): number[] {
    return this.deterministicState.getPendingGameLogicCrcValidationFrames();
  }

  getPendingDeterministicGameLogicCrcValidationPlayers(frame: number): number[] {
    const safeFrame = Math.max(0, Math.trunc(frame));
    return this.deterministicState.getPendingGameLogicCrcValidationPlayers(safeFrame);
  }

  getDeterministicGameLogicCrcFrames(): {
    local: number[];
    remote: number[];
  } {
    return {
      local: this.deterministicState.getLocalGameLogicCrcFrames(),
      remote: this.deterministicState.getRemoteGameLogicCrcFrames(),
    };
  }

  getDeterministicGameLogicCrcMismatchFrames(): number[] {
    return this.deterministicState.getGameLogicCrcMismatchFrames();
  }

  pruneDeterministicValidationBefore(frame: number): void {
    const safeFrame = Math.max(0, Math.trunc(frame));
    this.deterministicState.pruneValidationBefore(safeFrame);
  }

  getDeterministicGameLogicCrcConsensus(frame = this.getGameFrameValue()): GameLogicCrcConsensus {
    const safeFrame = Math.max(0, Math.trunc(frame));
    this.getDeterministicGameLogicCrc(safeFrame);
    return this.deterministicState.evaluateGameLogicCrcConsensus(
      safeFrame,
      this.getConnectedPlayerIds(),
      this.localPlayerID,
    );
  }

  getExpectedFrameCommandCount(frame: number, playerId: number): number | null {
    const safeFrame = Math.max(0, Math.trunc(frame));
    const safePlayerId = Math.max(0, Math.trunc(playerId));
    return this.frameState.getExpectedFrameCommandCount(safePlayerId, safeFrame);
  }

  getReceivedFrameCommandCount(frame: number, playerId: number): number {
    const safeFrame = Math.max(0, Math.trunc(frame));
    const safePlayerId = Math.max(0, Math.trunc(playerId));
    return this.frameState.getReceivedFrameCommandCount(safePlayerId, safeFrame);
  }

  sawFrameCommandCountMismatch(): boolean {
    return this.frameState.hasObservedFrameCommandMismatch();
  }

  getFrameResendRequests(): ReadonlyArray<{ playerId: number; frame: number }> {
    return this.frameState.getFrameResendRequests();
  }

  getLocalPlayerID(): number {
    return this.localPlayerID;
  }

  getPlayerName(playerNum = 0): string {
    const cachedName = this.playerNames.get(playerNum);
    if (cachedName) {
      return cachedName;
    }
    if (playerNum === this.localPlayerID) {
      return this.localPlayerName;
    }
    return `Player ${playerNum + 1}`;
  }

  getPlayerSide(playerNum = 0): string | null {
    return this.playerSides.get(playerNum) ?? null;
  }

  getKnownPlayerSlots(): number[] {
    const slots = new Set<number>(this.playerNames.keys());
    slots.add(this.localPlayerID);
    return [...slots].sort((left, right) => left - right);
  }

  getNumPlayers(): number {
    const counted = new Set<number>();

    if (this.isPlayerConnected(this.localPlayerID)) {
      counted.add(this.localPlayerID);
    }

    if (this.playerNames.size > 0) {
      for (const slot of this.playerNames.keys()) {
        if (this.isPlayerConnected(slot)) {
          counted.add(slot);
        }
      }
    } else {
      for (let slot = 0; slot < this.numPlayers; slot += 1) {
        if (this.isPlayerConnected(slot)) {
          counted.add(slot);
        }
      }
    }

    return counted.size;
  }

  getAverageFPS(): number {
    return this.frameRate;
  }

  getSlotAverageFPS(slot = 0): number {
    if (slot < 0 || slot >= MAX_SLOTS) {
      return -1;
    }

    if ((this.isPacketRouter() === false) && (slot === this.localPlayerID)) {
      return -1;
    }

    const value = this.slotAverageFPS[slot];
    return value === undefined ? -1 : value;
  }

  getSlotAverageLatency(slot = 0): number {
    if (slot < 0 || slot >= MAX_SLOTS) {
      return -1;
    }

    if (!this.isPlayerConnected(slot) && slot !== this.localPlayerID) {
      return -1;
    }

    const value = this.slotAverageLatency[slot];
    return value === undefined ? -1 : value;
  }

  private clampPercent(value: unknown): number | null {
    const resolved = resolveNetworkNumericField(value);
    if (resolved === null) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.trunc(resolved)));
  }

  private clampProgress(value: unknown): number | null {
    const resolved = resolveNetworkNumericField(value);
    if (resolved === null) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.trunc(resolved)));
  }

  private ensureFileTransferFromMessage(message: { [key: string]: unknown }, options: { commandId?: number } = {}): void {
    const path = this.normalizeFilePath(
      resolveNetworkTextFieldFromMessage(message, ['path', 'filePath', 'filename', 'fileName', 'realFilename', 'portableFilename']) ?? '',
    );
    if (!path) {
      return;
    }

    const commandId = options.commandId
      ?? resolveNetworkFileCommandIdFromMessage(message)
      ?? this.commandIdSeed++;
    const resolvedCommandId = Math.trunc(commandId);

    if (!Number.isFinite(resolvedCommandId) || !Number.isInteger(resolvedCommandId) || resolvedCommandId < 0) {
      return;
    }

    let transfer = this.fileTransfers.get(resolvedCommandId);
    if (!transfer) {
      transfer = this.findTransferByPath(path);
    }

    const mask = resolveNetworkMaskFromMessage(message, ['playerMask', 'mask', 'recipientMask']);
    if (!transfer || transfer.commandId !== resolvedCommandId || transfer.path !== path) {
      this.fileTransfers.set(resolvedCommandId, {
        commandId: resolvedCommandId,
        path,
        progressBySlot: this.createTransferProgressByPlayerMask(mask),
      });
      return;
    }

    transfer.path = path;
    if (!transfer.progressBySlot.size) {
      transfer.progressBySlot = this.createTransferProgressByPlayerMask(mask);
    }
  }

  private updateFileProgress(commandId: number, playerId: number, progress: number): void {
    const transfer = this.fileTransfers.get(commandId);
    if (!transfer) {
      return;
    }

    const clampedProgress = this.clampProgress(progress);
    if (clampedProgress === null || playerId < 0 || playerId >= MAX_SLOTS) {
      return;
    }

    const existing = transfer.progressBySlot.get(playerId);
    if (existing === undefined) {
      transfer.progressBySlot.set(playerId, clampedProgress);
      return;
    }
    transfer.progressBySlot.set(playerId, Math.max(existing, clampedProgress));
  }

  processFrameInfoCommand(message: unknown): void {
    const parsedFrameInfo = parseNetworkFrameInfoMessage(message, {
      maxSlots: MAX_SLOTS,
    });
    if (!parsedFrameInfo) {
      return;
    }
    const sender = parsedFrameInfo.sender;
    const safeFrame = parsedFrameInfo.frame;

    if (parsedFrameInfo.commandCount !== null) {
      this.frameState.setFrameCommandCount(sender, safeFrame, parsedFrameInfo.commandCount);
      this.frameResendArchive.setFrameCommandCount(sender, safeFrame, parsedFrameInfo.commandCount);
    }
    this.frameState.notePlayerAdvancedFrame(sender, safeFrame);
    this.frameState.markFrameReady(safeFrame);
    this.reconcileFrameCommandState(safeFrame, [sender]);

    const resolvedHash = parsedFrameInfo.hash;
    if (!resolvedHash) {
      return;
    }

    if (resolvedHash.kind === 'frame-hash') {
      this.captureLocalFrameHash(safeFrame);
      this.deterministicState.recordRemoteFrameHash(safeFrame, sender, resolvedHash.value);
      return;
    }

    // Keep remote logic CRCs even when local section writers are unavailable yet.
    // Once local GameLogic CRC ownership is configured, kernel reconciliation will
    // evaluate cached remote values against locally published CRCs.
    this.deterministicState.recordRemoteGameLogicCrc(safeFrame, sender, resolvedHash.value);
    this.getDeterministicGameLogicCrc(safeFrame);
  }

  processDisconnectChatCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as { [key: string]: unknown };
    const sender = resolveNetworkPlayerFromMessage(msg);
    const text = resolveNetworkTextFieldFromMessage(msg, ['text', 'message', 'chat', 'content']);
    if (sender === null || text === null) {
      return;
    }

    this.chatHistory.push({
      sender,
      text,
      mask: 0,
    });
  }

  processChatCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as { [key: string]: unknown };
    const sender = resolveNetworkPlayerFromMessage(msg);
    const text = resolveNetworkTextFieldFromMessage(msg, ['text', 'message', 'chat', 'content']);
    if (sender === null || text === null) {
      return;
    }
    const mask = resolveNetworkMaskFromMessage(msg, ['playerMask', 'mask']);
    this.chatHistory.push({
      sender,
      text,
      mask,
    });
  }

  processProgressCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as { [key: string]: unknown };
    const percent = resolveNetworkNumericFieldFromMessage(msg, ['percentage', 'percent', 'progress']);
    const clampedPercent = this.clampPercent(percent);
    if (clampedPercent === null) {
      return;
    }
    this.updateLoadProgress(clampedPercent);
  }

  processTimeoutStartCommand(_message: unknown): void {
    this.sendTimeOutGameStart();
  }

  processLoadCompleteCommand(_message: unknown): void {
    this.loadProgressComplete();
  }

  processFileCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as { [key: string]: unknown };
    const commandId = resolveNetworkFileCommandIdFromMessage(msg);
    this.ensureFileTransferFromMessage(msg, { commandId: commandId ?? undefined });
    const sender = resolveNetworkPlayerFromMessage(msg);
    const mask = resolveNetworkMaskFromMessage(msg, ['playerMask', 'mask']);
    const path = this.normalizeFilePath(
      resolveNetworkTextFieldFromMessage(msg, ['path', 'filePath', 'filename', 'fileName', 'realFilename', 'portableFilename']) ?? '',
    );
    if (!path) {
      return;
    }
    this.sendFile(path, mask, commandId ?? this.commandIdSeed);
    if (commandId !== null && sender !== null) {
      this.updateFileProgress(Math.trunc(commandId), Math.trunc(sender), 100);
    }
  }

  processFileAnnounceCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as { [key: string]: unknown };
    const path = resolveNetworkTextFieldFromMessage(msg, ['path', 'filePath', 'filename', 'fileName', 'realFilename', 'portableFilename']);
    if (!path) {
      return;
    }
    const commandId = resolveNetworkFileCommandIdFromMessage(msg) ?? this.sendFileAnnounce(path);
    const mask = resolveNetworkMaskFromMessage(msg, ['playerMask', 'mask', 'recipientMask']);
    this.ensureFileTransferFromMessage(msg, { commandId });
    if (commandId !== null) {
      if (commandId >= this.commandIdSeed) {
        this.commandIdSeed = commandId + 1;
      }
      this.fileTransfers.set(Math.trunc(commandId), {
        commandId: Math.trunc(commandId),
        path,
        progressBySlot: this.createTransferProgressByPlayerMask(mask),
      });
    }
  }

  processFileProgressCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as { [key: string]: unknown };
    const commandId = resolveNetworkFileCommandIdFromMessage(msg);
    const sender = resolveNetworkPlayerFromMessage(msg);
    const progress = resolveNetworkNumericFieldFromMessage(msg, ['progress']);
    if (commandId === null || sender === null || progress === null) {
      return;
    }

    this.updateFileProgress(Math.trunc(commandId), Math.trunc(sender), progress);
  }

  processFrameResendRequestCommand(message: unknown): void {
    const parsedRequest = parseNetworkFrameResendRequestMessage(message, {
      maxSlots: MAX_SLOTS,
    });
    if (!parsedRequest) {
      return;
    }

    const sender = parsedRequest.sender;
    if (sender === this.localPlayerID || !this.isPlayerConnected(sender)) {
      return;
    }

    if (parsedRequest.frameToResend !== null) {
      this.sendFrameDataToPlayer(parsedRequest.sender, parsedRequest.frameToResend);
      return;
    }

    /**
     * Source parity: when a connected remote peer sends a resend request that
     * omits frame ownership metadata, record a pending-frame notice.
     *
     * Source references:
     * - Generals/Code/GameEngine/Source/GameNetwork/ConnectionManager.cpp
     *   (ConnectionManager::processFrameResendRequest)
     */
    this.frameState.incrementPendingFrameNotices();
  }

  private processPacketRouterQueryCommand(message: unknown): void {
    const parsedQuery = parseNetworkPacketRouterQueryMessage(message, {
      maxSlots: MAX_SLOTS,
    });
    if (!parsedQuery) {
      return;
    }
    const querySender = parsedQuery.sender;

    this.lastPacketRouterQuerySender = querySender;
    if (!this.isPacketRouter()) {
      return;
    }

    this.packetRouterEvents.onPacketRouterQueryReceived?.(querySender, this.packetRouterSlot);
    this.lastPacketRouterAckSender = querySender;

    const transport = this.transport as TransportLike | null;
    const directSend = transport?.sendLocalCommandDirect;
    if (typeof directSend === 'function') {
      const ackMessage = {
        commandType: NETCOMMANDTYPE_PACKETROUTERACK,
        type: 'packetrouterack',
        sender: this.localPlayerID,
      };
      directSend.call(transport, ackMessage, 1 << querySender);
    }
  }

  private processPacketRouterAckCommand(message: unknown): void {
    const parsedAck = parseNetworkPacketRouterAckMessage(message, {
      maxSlots: MAX_SLOTS,
    });
    if (!parsedAck) {
      return;
    }
    const ackSender = parsedAck.sender;

    if (!isNetworkPacketRouterAckFromCurrentRouter(ackSender, this.packetRouterSlot)) {
      return;
    }

    this.frameState.resetPacketRouterTimeout(this.now());
    // Source parity: DisconnectManager::processPacketRouterAck sets
    // disconnect state to SCREENON until allCommandsReady flips it off.
    this.frameState.markDisconnectScreenOn();
    this.lastPacketRouterAckSender = ackSender;
    this.packetRouterEvents.onPacketRouterAckReceived?.(ackSender, this.packetRouterSlot);
  }

  processWrapperCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const directWrapped = resolveNetworkDirectWrappedCandidate(message);
    if (directWrapped) {
      const wrappedHandled = this.processIncomingCommand(directWrapped);
      if (wrappedHandled) {
        return;
      }
    }

    const parsedWrapped = resolveNetworkAssembledWrappedCandidate(
      message,
      this.activeWrapperAssemblies,
    );
    if (!parsedWrapped) {
      return;
    }
    this.processIncomingCommand(parsedWrapped);
  }

  processDisconnectCommand(commandType: number, message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as { [key: string]: unknown };
    const sender = resolveNetworkPlayerFromMessage(msg);

    if (commandType === NETCOMMANDTYPE_DISCONNECTKEEPALIVE) {
      if (sender === null) {
        return;
      }
      const safeSender = Math.trunc(sender);
      if (
        safeSender < 0
        || safeSender >= MAX_SLOTS
        || !this.isPlayerConnected(safeSender)
      ) {
        return;
      }
      this.frameState.resetDisconnectPlayerTimeoutForPlayer(
        safeSender,
        this.localPlayerID,
        this.now(),
      );
      return;
    }

    if (commandType === NETCOMMANDTYPE_DISCONNECTFRAME) {
      const frame = resolveNetworkNumericFieldFromMessage(
        msg,
        ['disconnectFrame', 'frame'],
        ['getDisconnectFrame', 'getFrame'],
      );
      if (sender === null || frame === null) {
        return;
      }

      const safeSender = Math.trunc(sender);
      const safeFrame = Math.trunc(frame);
      if (
        safeSender < 0
        || safeSender >= MAX_SLOTS
        || safeFrame < 0
      ) {
        return;
      }

      const evaluation = this.frameState.recordDisconnectFrame(
        safeSender,
        safeFrame,
        this.localPlayerID,
        this.getConnectedPlayerIds(),
      );

      for (const resendTarget of evaluation.resendTargets) {
        this.sendFrameDataToPlayer(resendTarget.playerId, resendTarget.frame);
      }
      return;
    }

    if (commandType === NETCOMMANDTYPE_DISCONNECTVOTE) {
      const voteSlot = resolveNetworkNumericFieldFromMessage(
        msg,
        ['voteSlot', 'slot', 'disconnectSlot'],
        ['getVoteSlot', 'getSlot', 'getDisconnectSlot'],
      );
      const voteFrame = resolveNetworkNumericFieldFromMessage(
        msg,
        ['voteFrame', 'frame'],
        ['getVoteFrame', 'getFrame'],
      );
      if (sender === null || voteSlot === null || voteFrame === null) {
        return;
      }

      const safeSender = Math.trunc(sender);
      const safeVoteSlot = Math.trunc(voteSlot);
      const safeVoteFrame = Math.trunc(voteFrame);
      if (
        safeSender < 0
        || safeSender >= MAX_SLOTS
        || safeVoteSlot < 0
        || safeVoteSlot >= MAX_SLOTS
        || safeVoteFrame < 0
      ) {
        return;
      }

      const senderDisconnectSlot = this.frameState.translatedSlotPosition(
        safeSender,
        this.localPlayerID,
      );
      if (!this.frameState.isDisconnectPlayerInGame(
        senderDisconnectSlot,
        this.localPlayerID,
        this.getConnectedPlayerIds(),
        this.getNumPlayers(),
        this.getGameFrameValue(),
      )) {
        return;
      }

      this.frameState.recordDisconnectVote(
        safeVoteSlot,
        safeVoteFrame,
        safeSender,
      );
      return;
    }

    if (commandType === NETCOMMANDTYPE_DISCONNECTSCREENOFF) {
      const newFrame = resolveNetworkNumericFieldFromMessage(
        msg,
        ['newFrame', 'frame'],
        ['getNewFrame', 'getFrame'],
      );
      if (sender === null || newFrame === null) {
        return;
      }

      const safeSender = Math.trunc(sender);
      const safeFrame = Math.trunc(newFrame);
      if (
        safeSender < 0
        || safeSender >= MAX_SLOTS
        || safeFrame < 0
      ) {
        return;
      }

      this.frameState.recordDisconnectScreenOff(safeSender, safeFrame);
      return;
    }

    if (commandType !== NETCOMMANDTYPE_DISCONNECTPLAYER) {
      return;
    }

    const slot = resolveNetworkNumericFieldFromMessage(
      msg,
      ['disconnectSlot', 'slot', 'playerIndex'],
      ['getDisconnectSlot', 'getSlot', 'getPlayerIndex'],
    );
    if (slot === null) {
      return;
    }

    const targetSlot = Math.trunc(slot);
    if (targetSlot < 0 || targetSlot >= MAX_SLOTS) {
      return;
    }
    this.markPlayerDisconnected(targetSlot);
  }

  processRunAheadMetricsCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as {
      playerID?: unknown;
      player?: unknown;
      averageFps?: unknown;
      averageLatency?: unknown;
      getPlayerID?: () => unknown;
      getAverageFps?: () => unknown;
      getAverageFPS?: () => unknown;
      getAverageLatency?: () => unknown;
      playerId?: unknown;
      avgFps?: unknown;
      playerIdNumber?: unknown;
      sender?: unknown;
      slot?: unknown;
      getSender?: () => unknown;
      getSlot?: () => unknown;
    };

    const player = resolveNetworkPlayerFromMessage(msg);
    const averageFps = resolveNetworkNumericFieldFromMessage(
      msg,
      ['averageFps', 'avgFps'],
      ['getAverageFps', 'getAverageFPS'],
    );
    if (player === null || averageFps === null) {
      return;
    }

    const slot = Math.trunc(player);
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
      return;
    }

    if (!this.isPlayerConnected(slot) && slot !== this.localPlayerID) {
      return;
    }

    let fps = Math.trunc(averageFps);
    if (Number.isNaN(fps)) {
      return;
    }
    if (fps < 0) {
      fps = 0;
    }
    if (fps > 100) {
      fps = 100;
    }

    this.slotAverageFPS[slot] = fps;

    const averageLatency = resolveNetworkNumericField(
      resolveNetworkMessageGetter(msg, 'getAverageLatency') ?? msg.averageLatency,
    );
    if (averageLatency !== null) {
      this.slotAverageLatency[slot] = averageLatency;
    }
  }

  processRunaheadCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as {
      newRunAhead?: unknown;
      runAhead?: unknown;
      newFrameRate?: unknown;
      frameRate?: unknown;
      getNewRunAhead?: () => unknown;
      getRunAhead?: () => unknown;
      getNewFrameRate?: () => unknown;
      getFrameRate?: () => unknown;
    };

    const newRunAhead = resolveNetworkNumericFieldFromMessage(
      msg,
      ['newRunAhead', 'runAhead'],
      ['getNewRunAhead', 'getRunAhead'],
    );
    const newFrameRate = resolveNetworkNumericFieldFromMessage(
      msg,
      ['newFrameRate', 'frameRate'],
      ['getNewFrameRate', 'getFrameRate'],
    );
    if (newRunAhead === null || newFrameRate === null) {
      return;
    }

    const safeRunAhead = Math.trunc(newRunAhead);
    const safeFrameRate = Math.trunc(newFrameRate);
    if (!Number.isInteger(safeRunAhead) || !Number.isInteger(safeFrameRate)) {
      return;
    }
    if (safeRunAhead < 0 || safeFrameRate <= 0) {
      return;
    }

    this.runAhead = safeRunAhead;
    this.frameRate = Math.max(1, Math.min(MAX_FRAME_RATE, safeFrameRate));
    this.lastExecutionFrame = Math.max(this.lastExecutionFrame, this.getGameFrameValue() + this.runAhead);
  }

  processPlayerLeaveCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as {
      leavingPlayerID?: unknown;
      slot?: unknown;
      getLeavingPlayerID?: () => unknown;
      getSlot?: () => unknown;
    };
    const slot = resolveNetworkNumericFieldFromMessage(
      msg,
      ['leavingPlayerID', 'slot'],
      ['getLeavingPlayerID', 'getSlot'],
    );
    if (slot === null) {
      return;
    }

    const targetSlot = Math.trunc(slot);
    if (targetSlot < 0 || targetSlot >= MAX_SLOTS) {
      return;
    }
    this.markPlayerDisconnected(targetSlot);
  }

  processDestroyPlayerCommand(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as {
      playerIndex?: unknown;
      slot?: unknown;
      getPlayerIndex?: () => unknown;
      getSlot?: () => unknown;
    };
    const slot = resolveNetworkNumericFieldFromMessage(
      msg,
      ['playerIndex', 'slot'],
      ['getPlayerIndex', 'getSlot'],
    );
    if (slot === null) {
      return;
    }

    const targetSlot = Math.trunc(slot);
    if (targetSlot < 0 || targetSlot >= MAX_SLOTS) {
      return;
    }
    this.markPlayerDisconnected(targetSlot);
  }

  attachTransport(_transport: unknown): void {
    this.transport = _transport;
  }

  initTransport(): void {
    if (this.transport && typeof (this.transport as { init?: () => void }).init === 'function') {
      (this.transport as { init: () => void }).init();
    }
  }

  sawCRCMismatch(): boolean {
    return this.crcMismatch;
  }

  setSawCRCMismatch(): void {
    this.crcMismatch = true;
  }

  private markPlayerDisconnected(slot = 0): void {
    if (slot < 0) {
      return;
    }

    this.disconnectedPlayers.add(slot);
  }

  isPlayerConnected(playerID = 0): boolean {
    if (playerID < 0) {
      return false;
    }

    if (this.disconnectedPlayers.has(playerID)) {
      return false;
    }

    if (this.playerNames.size > 0) {
      return this.playerNames.has(playerID) || playerID === this.localPlayerID;
    }

    return playerID >= 0 && playerID < this.numPlayers;
  }

  notifyOthersOfCurrentFrame(): void {
    this.notifyOthersOfNewFrame(this.getGameFrameValue());
  }

  notifyOthersOfNewFrame(frame: number): void {
    const safeFrame = Math.max(0, Math.trunc(frame));
    this.frameState.noteExpectedNetworkFrame(safeFrame);
    this.frameState.incrementPendingFrameNotices();
  }

  getExecutionFrame(): number {
    if (!this.started) {
      return 0;
    }

    return Math.max(this.lastExecutionFrame, this.getGameFrameValue() + this.runAhead);
  }

  toggleNetworkOn(): void {
    this.networkOn = !this.networkOn;
  }

  getPingFrame(): number {
    return this.pingFrame;
  }

  getPingsSent(): number {
    return this.pingsSent;
  }

  getPingsRecieved(): number {
    return this.pingsReceived;
  }

  getPingsReceived(): number {
    return this.getPingsRecieved();
  }

  private callTransportMetric(name: TransportMetricName): number {
    const transport = this.transport as TransportLike | null;
    if (!transport) {
      return 0;
    }
    const getter = transport[name];
    if (typeof getter !== 'function') {
      return 0;
    }
    const value = getter.call(transport);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private now(): number {
    const value = this.nowProvider();
    return Number.isFinite(value) ? value : 0;
  }

}

let networkClientSingleton: NetworkManager | null = null;

export function initializeNetworkClient(options: NetworkManagerOptions = {}): NetworkManager {
  if (!networkClientSingleton) {
    networkClientSingleton = new NetworkManager(options);
  }

  networkClientSingleton.init();
  return networkClientSingleton;
}

export function getNetworkClient(): NetworkManager | null {
  return networkClientSingleton;
}

export interface NetworkManagerOptions {
  debugLabel?: string;
  forceSinglePlayer?: boolean;
  localPlayerID?: number;
  localPlayerName?: string;
  frameRate?: number;
  runAhead?: number;
  disconnectTimeoutMs?: number;
  disconnectPlayerTimeoutMs?: number;
  disconnectScreenNotifyTimeoutMs?: number;
  disconnectKeepAliveIntervalMs?: number;
  nowProvider?: () => number;
  gameLogicCrcSectionWriters?: DeterministicGameLogicCrcSectionWriters<unknown>;
  packetRouterEvents?: PacketRouterEvents;
}
