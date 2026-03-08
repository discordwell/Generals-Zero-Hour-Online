/**
 * Replay recording and playback system.
 *
 * Source parity: RecordManager in the C++ engine records all network commands
 * per frame for deterministic replay. This implementation captures game
 * commands during play and replays them to reproduce the exact game state.
 *
 * Replay file format:
 * {
 *   version: 1,
 *   mapPath: string,
 *   playerCount: number,
 *   players: { id, name, side, team, color }[],
 *   startingCredits: number,
 *   frameRate: number,
 *   totalFrames: number,
 *   commands: { frame, playerId, command }[],
 *   recordedAt: ISO timestamp,
 * }
 */

export interface ReplayPlayerInfo {
  id: number;
  name: string;
  side: string;
  team: number;
  color: number;
}

export interface ReplayCommand {
  frame: number;
  playerId: number;
  command: Record<string, unknown>;
}

export interface ReplayHeader {
  version: number;
  mapPath: string;
  playerCount: number;
  players: ReplayPlayerInfo[];
  startingCredits: number;
  frameRate: number;
  totalFrames: number;
  recordedAt: string;
}

export interface ReplayFile extends ReplayHeader {
  commands: ReplayCommand[];
}

export type ReplayState = 'idle' | 'recording' | 'playing' | 'paused';

export interface ReplayPlaybackCallbacks {
  /** Called when replay reaches a new frame during playback. */
  onFrame?: (frame: number, commands: ReplayCommand[]) => void;
  /** Called when replay playback finishes. */
  onComplete?: () => void;
  /** Called when replay state changes. */
  onStateChange?: (state: ReplayState) => void;
}

const REPLAY_VERSION = 1;

export class ReplayManager {
  private state: ReplayState = 'idle';
  private readonly recordedCommands: ReplayCommand[] = [];
  private header: ReplayHeader | null = null;
  private currentFrame = 0;
  private totalFrames = 0;
  private playbackSpeed = 1.0;
  private callbacks: ReplayPlaybackCallbacks = {};

  // For playback: pre-indexed commands by frame.
  private commandsByFrame = new Map<number, ReplayCommand[]>();
  private loadedReplay: ReplayFile | null = null;

  getState(): ReplayState {
    return this.state;
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  getTotalFrames(): number {
    return this.totalFrames;
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeed;
  }

  getRecordedCommandCount(): number {
    return this.recordedCommands.length;
  }

  // ========================================================================
  // Recording
  // ========================================================================

  /**
   * Start recording a new replay.
   */
  startRecording(
    mapPath: string,
    players: ReplayPlayerInfo[],
    frameRate: number,
    startingCredits: number,
  ): void {
    this.reset();
    this.state = 'recording';
    this.header = {
      version: REPLAY_VERSION,
      mapPath,
      playerCount: players.length,
      players: players.map((p) => ({ ...p })),
      startingCredits,
      frameRate,
      totalFrames: 0,
      recordedAt: new Date().toISOString(),
    };
    this.callbacks.onStateChange?.(this.state);
  }

  /**
   * Record a game command at the current frame.
   */
  recordCommand(
    frame: number,
    playerId: number,
    command: Record<string, unknown>,
  ): void {
    if (this.state !== 'recording') return;
    this.recordedCommands.push({
      frame,
      playerId,
      command: { ...command },
    });
    this.totalFrames = Math.max(this.totalFrames, frame + 1);
  }

  /**
   * Stop recording and return the replay data.
   */
  stopRecording(): ReplayFile | null {
    if (this.state !== 'recording' || !this.header) return null;

    this.header.totalFrames = this.totalFrames;
    const replay: ReplayFile = {
      ...this.header,
      commands: this.recordedCommands.map((c) => ({
        frame: c.frame,
        playerId: c.playerId,
        command: { ...c.command },
      })),
    };

    this.state = 'idle';
    this.callbacks.onStateChange?.(this.state);
    return replay;
  }

  // ========================================================================
  // Serialization
  // ========================================================================

  /**
   * Serialize a replay to a JSON string for saving.
   */
  static serialize(replay: ReplayFile): string {
    return JSON.stringify(replay);
  }

  /**
   * Deserialize a replay from a JSON string.
   */
  static deserialize(json: string): ReplayFile | null {
    try {
      const data = JSON.parse(json) as ReplayFile;
      if (data.version !== REPLAY_VERSION) return null;
      if (!Array.isArray(data.commands)) return null;
      if (!Array.isArray(data.players)) return null;
      return data;
    } catch {
      return null;
    }
  }

  // ========================================================================
  // Playback
  // ========================================================================

  /**
   * Load a replay file for playback.
   */
  loadReplay(
    replay: ReplayFile,
    callbacks: ReplayPlaybackCallbacks = {},
  ): void {
    this.reset();
    this.loadedReplay = replay;
    this.totalFrames = replay.totalFrames;
    this.callbacks = callbacks;

    // Index commands by frame for O(1) lookup during playback.
    this.commandsByFrame.clear();
    for (const cmd of replay.commands) {
      const list = this.commandsByFrame.get(cmd.frame);
      if (list) {
        list.push(cmd);
      } else {
        this.commandsByFrame.set(cmd.frame, [cmd]);
      }
    }
  }

  /**
   * Start or resume playback.
   */
  play(): void {
    if (!this.loadedReplay) return;
    this.state = 'playing';
    this.callbacks.onStateChange?.(this.state);
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.callbacks.onStateChange?.(this.state);
  }

  /**
   * Set playback speed multiplier (0.25x to 8x).
   */
  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = Math.max(0.25, Math.min(8, speed));
  }

  /**
   * Seek to a specific frame (can only seek forward in deterministic replay).
   */
  seekToFrame(frame: number): void {
    if (!this.loadedReplay) return;
    this.currentFrame = Math.max(0, Math.min(frame, this.totalFrames));
  }

  /**
   * Advance replay by one frame. Returns commands for the current frame.
   * Called from the game loop during playback.
   */
  advanceFrame(): ReplayCommand[] {
    if (this.state !== 'playing' || !this.loadedReplay) return [];

    if (this.currentFrame >= this.totalFrames) {
      this.state = 'idle';
      this.callbacks.onComplete?.();
      this.callbacks.onStateChange?.(this.state);
      return [];
    }

    const commands = this.commandsByFrame.get(this.currentFrame) ?? [];
    this.callbacks.onFrame?.(this.currentFrame, commands);
    this.currentFrame++;
    return commands;
  }

  /**
   * Get the replay header (map info, players, etc.) for the loaded replay.
   */
  getHeader(): ReplayHeader | null {
    return this.loadedReplay ?? this.header;
  }

  // ========================================================================
  // Reset
  // ========================================================================

  reset(): void {
    this.state = 'idle';
    this.recordedCommands.length = 0;
    this.header = null;
    this.currentFrame = 0;
    this.totalFrames = 0;
    this.playbackSpeed = 1.0;
    this.commandsByFrame.clear();
    this.loadedReplay = null;
    this.callbacks = {};
  }
}
