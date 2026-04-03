/**
 * @generals/engine
 *
 * Engine-owned runtime boundary primitives.
 */

export type { Subsystem } from './subsystem.js';
export { SubsystemRegistry } from './subsystem.js';

export type { Snapshot } from './snapshot.js';

export { Xfer, XferMode, XferStatus } from './xfer.js';
export type { Coord3D, ICoord2D, RGBAColorInt } from './xfer.js';
export { XferSave } from './xfer-save.js';
export { XferLoad } from './xfer-load.js';
export { XferCrc } from './xfer-crc.js';

export { GameState, SaveCode } from './game-state.js';
export type { SaveGameInfo } from './game-state.js';

export { SaveStorage } from './save-storage.js';
export type { SaveMetadata } from './save-storage.js';
export {
  SaveFileType,
  SOURCE_GAME_STATE_BLOCK,
  SOURCE_GAME_STATE_MAP_BLOCK,
  SOURCE_SAVE_FILE_EOF,
  listSaveGameChunks,
  parseSaveGameInfo,
  parseSaveGameMapInfo,
  saveDateToTimestamp,
} from './save-game-file.js';
export type {
  ParsedSaveGameInfo,
  ParsedSaveGameMapInfo,
  SaveDate,
  SaveGameChunkInfo,
} from './save-game-file.js';

export { EventBus, globalEventBus } from './event-bus.js';

export { GameLoop } from './game-loop.js';
export type { GameLoopCallbacks, GameLoopScheduler } from './game-loop.js';

export { DeterministicFrameState } from './frame-state.js';
export type {
  DeterministicFrameStateOptions,
  FrameResendRequest,
  FrameCommandTrackingResetOptions,
  FrameCommandReadiness,
  FrameCommandEvaluationStatus,
  FrameCommandEvaluation,
  FrameContinuationGate,
  FrameExecutionEvaluation,
  DisconnectContinuationState,
  DisconnectStallEvaluation,
  DisconnectPlayerTimeoutStatus,
  DisconnectStatusOptions,
  DisconnectStatusEvaluation,
  PacketRouterTimeoutEvaluation,
  DisconnectFrameResendTarget,
  DisconnectFrameEvaluation,
  DisconnectScreenOffEvaluation,
  DisconnectVote,
  DisconnectVoteEvaluation,
  FrameCommandCountMismatch,
  FrameCommandCountMismatchListener,
} from './frame-state.js';

export {
  DeterministicStateKernel,
  XferCrcAccumulator,
  hashDeterministicFrameMetadata,
  hashDeterministicGameLogicCrc,
  INVALID_OBJECT_ID,
  FIRST_OBJECT_ID,
  MAX_OBJECT_ID,
} from './deterministic-state.js';
export type {
  DeterministicCommand,
  DeterministicFrameSnapshot,
  DeterministicStateOptions,
  FrameHashMismatch,
  FrameHashProvider,
  FrameHashMismatchListener,
  GameLogicCrcMismatch,
  GameLogicCrcMismatchListener,
  GameLogicCrcConsensusStatus,
  GameLogicCrcConsensus,
  DeterministicGameLogicCrcSectionWriters,
  DeterministicGameLogicCrcHashOptions,
} from './deterministic-state.js';

export {
  NETCOMMANDTYPE_UNKNOWN,
  NETCOMMANDTYPE_ACKBOTH,
  NETCOMMANDTYPE_ACKSTAGE1,
  NETCOMMANDTYPE_ACKSTAGE2,
  NETCOMMANDTYPE_FRAMEINFO,
  NETCOMMANDTYPE_GAMECOMMAND,
  NETCOMMANDTYPE_PLAYERLEAVE,
  NETCOMMANDTYPE_RUNAHEADMETRICS,
  NETCOMMANDTYPE_RUNAHEAD,
  NETCOMMANDTYPE_DESTROYPLAYER,
  NETCOMMANDTYPE_KEEPALIVE,
  NETCOMMANDTYPE_DISCONNECTCHAT,
  NETCOMMANDTYPE_CHAT,
  NETCOMMANDTYPE_MANGLERQUERY,
  NETCOMMANDTYPE_MANGLERRESPONSE,
  NETCOMMANDTYPE_PROGRESS,
  NETCOMMANDTYPE_LOADCOMPLETE,
  NETCOMMANDTYPE_TIMEOUTSTART,
  NETCOMMANDTYPE_WRAPPER,
  NETCOMMANDTYPE_FILE,
  NETCOMMANDTYPE_FILEANNOUNCE,
  NETCOMMANDTYPE_FILEPROGRESS,
  NETCOMMANDTYPE_FRAMERESENDREQUEST,
  NETCOMMANDTYPE_DISCONNECTSTART,
  NETCOMMANDTYPE_DISCONNECTKEEPALIVE,
  NETCOMMANDTYPE_DISCONNECTPLAYER,
  NETCOMMANDTYPE_PACKETROUTERQUERY,
  NETCOMMANDTYPE_PACKETROUTERACK,
  NETCOMMANDTYPE_DISCONNECTVOTE,
  NETCOMMANDTYPE_DISCONNECTFRAME,
  NETCOMMANDTYPE_DISCONNECTSCREENOFF,
  NETCOMMANDTYPE_DISCONNECTEND,
  NETCOMMANDTYPE_MAX,
} from './network-command-type.js';

export {
  resolveNetworkNumericField,
  resolveNetworkTextField,
  resolveNetworkMessageGetter,
  resolveNetworkNumericFieldFromMessage,
  resolveNetworkTextFieldFromMessage,
} from './network-message-field.js';

export {
  resolveNetworkPlayerFromMessage,
  resolveNetworkFileCommandIdFromMessage,
  resolveNetworkMaskFromMessage,
  resolveNetworkFrameHashFromFrameInfo,
} from './network-message-resolver.js';
export type { ResolvedNetworkFrameHash } from './network-message-resolver.js';

export { parseNetworkFrameInfoMessage } from './network-frame-info.js';
export type { ParsedNetworkFrameInfo, ParseNetworkFrameInfoOptions } from './network-frame-info.js';
export { parseNetworkFrameResendRequestMessage } from './network-frame-resend-request.js';
export type {
  ParsedNetworkFrameResendRequest,
  ParseNetworkFrameResendRequestOptions,
} from './network-frame-resend-request.js';
export {
  parseNetworkPacketRouterQueryMessage,
  parseNetworkPacketRouterAckMessage,
  isNetworkPacketRouterAckFromCurrentRouter,
} from './network-packet-router.js';
export type {
  ParsedNetworkPacketRouterMessage,
  ParseNetworkPacketRouterMessageOptions,
} from './network-packet-router.js';

export {
  coerceNetworkPayloadToBytes,
  parseNetworkWrapperChunk,
  parseNetworkWrapperChunkFromBinary,
  parseNetworkWrapperChunkFromObject,
  parseNetworkWrapperChunkFromByteBuffer,
} from './network-wrapper-chunk.js';
export type { NetworkWrapperChunk } from './network-wrapper-chunk.js';

export {
  isNetworkWrapperAssemblyComplete,
  ingestNetworkWrapperChunk,
} from './network-wrapper-assembly.js';
export type {
  NetworkWrapperAssembly,
  NetworkWrapperAssemblyMap,
  NetworkWrapperChunkIngestResult,
} from './network-wrapper-assembly.js';

export {
  resolveNetworkDirectWrappedCandidate,
  resolveNetworkAssembledWrappedCandidate,
} from './network-wrapper-dispatch.js';

export { parseNetworkWrappedCommand } from './network-wrapped-command.js';
export type { NetworkWrappedCommand } from './network-wrapped-command.js';

export {
  normalizeNetworkCommandTypeName,
  getAsciiNetworkCommandType,
  resolveNetworkCommandTypeName,
  resolveNetworkCommandType,
  resolveNetworkCommandTypeFromMessage,
} from './network-command-type-resolver.js';

export {
  NETWORK_COMMAND_ID_INITIAL_SEED,
  NetworkCommandIdSequencer,
  doesNetworkCommandRequireCommandId,
  doesNetworkCommandRequireAck,
  doesNetworkCommandRequireDirectSend,
  isNetworkCommandSynchronized,
} from './command-id.js';
export type { NetworkCommandIdSequencerOptions } from './command-id.js';

export {
  FrameResendArchive,
  SOURCE_MAX_FRAMES_AHEAD,
  SOURCE_FRAMES_TO_KEEP,
} from './frame-resend.js';
export type {
  FrameResendArchiveOptions,
  FrameResendPlan,
  FrameResendFramePlan,
  FrameResendFrameInfo,
  FrameResendCommand,
} from './frame-resend.js';

export { ReplayManager } from './replay-manager.js';
export type {
  ReplayFile,
  ReplayHeader,
  ReplayCommand,
  ReplayPlayerInfo,
  ReplayState,
  ReplayPlaybackCallbacks,
} from './replay-manager.js';
export { ReplayStorage } from './replay-storage.js';
export type { ReplayMetadata } from './replay-storage.js';
