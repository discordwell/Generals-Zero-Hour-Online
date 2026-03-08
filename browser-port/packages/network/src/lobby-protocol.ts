/**
 * Multiplayer lobby protocol — message types and state management for
 * pre-game lobby coordination.
 *
 * Source parity: The original game used GameSpy lobby protocol for internet
 * games. This implementation handles player join/leave, faction/team selection,
 * ready state, and game launch coordination via the signaling channel.
 */

// ============================================================================
// Lobby message types
// ============================================================================

export type LobbyMessageType =
  | 'lobby-join'
  | 'lobby-leave'
  | 'lobby-player-update'
  | 'lobby-chat'
  | 'lobby-ready'
  | 'lobby-start'
  | 'lobby-settings';

export interface LobbyJoinMessage {
  type: 'lobby-join';
  playerId: number;
  playerName: string;
}

export interface LobbyLeaveMessage {
  type: 'lobby-leave';
  playerId: number;
}

export interface LobbyPlayerUpdateMessage {
  type: 'lobby-player-update';
  playerId: number;
  side: string;
  team: number;
  color: number;
}

export interface LobbyChatMessage {
  type: 'lobby-chat';
  playerId: number;
  playerName: string;
  text: string;
  timestamp: number;
}

export interface LobbyReadyMessage {
  type: 'lobby-ready';
  playerId: number;
  ready: boolean;
}

export interface LobbyStartMessage {
  type: 'lobby-start';
  hostId: number;
}

export interface LobbySettingsMessage {
  type: 'lobby-settings';
  mapPath: string;
  startingCredits: number;
  superweapons: boolean;
}

export type LobbyMessage =
  | LobbyJoinMessage
  | LobbyLeaveMessage
  | LobbyPlayerUpdateMessage
  | LobbyChatMessage
  | LobbyReadyMessage
  | LobbyStartMessage
  | LobbySettingsMessage;

// ============================================================================
// Lobby player state
// ============================================================================

export interface LobbyPlayer {
  id: number;
  name: string;
  side: string;
  team: number;
  color: number;
  ready: boolean;
  isHost: boolean;
  isLocal: boolean;
}

export interface LobbySettings {
  mapPath: string;
  startingCredits: number;
  superweapons: boolean;
}

export interface LobbyState {
  players: LobbyPlayer[];
  settings: LobbySettings;
  chatHistory: LobbyChatMessage[];
}

// ============================================================================
// Lobby state manager
// ============================================================================

export interface LobbyCallbacks {
  onPlayerJoined?: (player: LobbyPlayer) => void;
  onPlayerLeft?: (playerId: number) => void;
  onPlayerUpdated?: (player: LobbyPlayer) => void;
  onChatMessage?: (msg: LobbyChatMessage) => void;
  onReadyChanged?: (playerId: number, ready: boolean) => void;
  onSettingsChanged?: (settings: LobbySettings) => void;
  onGameStart?: () => void;
  onStateChanged?: (state: LobbyState) => void;
}

const MAX_PLAYERS = 8;
const MAX_CHAT_HISTORY = 100;

const FACTION_OPTIONS = ['America', 'China', 'GLA', 'Random'] as const;
const COLOR_OPTIONS = [
  0xff0000, 0x0000ff, 0x00ff00, 0xffff00,
  0xff8800, 0x00ffff, 0xff00ff, 0xffffff,
] as const;

export { FACTION_OPTIONS, COLOR_OPTIONS };

export class LobbyManager {
  private readonly localPlayerId: number;
  private readonly localPlayerName: string;
  private readonly players = new Map<number, LobbyPlayer>();
  private settings: LobbySettings;
  private readonly chatHistory: LobbyChatMessage[] = [];
  private readonly callbacks: LobbyCallbacks;
  private sendMessage: ((msg: LobbyMessage) => void) | null = null;

  constructor(
    localPlayerId: number,
    localPlayerName: string,
    callbacks: LobbyCallbacks = {},
    initialSettings?: Partial<LobbySettings>,
    isHost = true,
  ) {
    this.localPlayerId = localPlayerId;
    this.localPlayerName = localPlayerName;
    this.callbacks = callbacks;
    this.settings = {
      mapPath: initialSettings?.mapPath ?? '',
      startingCredits: initialSettings?.startingCredits ?? 10000,
      superweapons: initialSettings?.superweapons ?? true,
    };

    // Add self.
    this.addPlayer({
      id: localPlayerId,
      name: localPlayerName,
      side: 'America',
      team: 0,
      color: COLOR_OPTIONS[localPlayerId % COLOR_OPTIONS.length]!,
      ready: false,
      isHost,
      isLocal: true,
    });
  }

  /** Set the send function for outgoing lobby messages. */
  setSendFunction(send: (msg: LobbyMessage) => void): void {
    this.sendMessage = send;
  }

  /** Process an incoming lobby message. */
  handleMessage(msg: LobbyMessage): void {
    switch (msg.type) {
      case 'lobby-join':
        this.handleJoin(msg);
        break;
      case 'lobby-leave':
        this.handleLeave(msg);
        break;
      case 'lobby-player-update':
        this.handlePlayerUpdate(msg);
        break;
      case 'lobby-chat':
        this.handleChat(msg);
        break;
      case 'lobby-ready':
        this.handleReady(msg);
        break;
      case 'lobby-settings':
        this.handleSettings(msg);
        break;
      case 'lobby-start':
        this.callbacks.onGameStart?.();
        break;
    }
  }

  // ========================================================================
  // Local player actions
  // ========================================================================

  /** Send a chat message from the local player. */
  sendChat(text: string): void {
    const msg: LobbyChatMessage = {
      type: 'lobby-chat',
      playerId: this.localPlayerId,
      playerName: this.localPlayerName,
      text,
      timestamp: Date.now(),
    };
    this.handleChat(msg); // Also add locally.
    this.sendMessage?.(msg);
  }

  /** Update local player's faction. */
  setLocalSide(side: string): void {
    const player = this.players.get(this.localPlayerId);
    if (!player) return;
    player.side = side;
    this.broadcastPlayerUpdate(player);
  }

  /** Update local player's team. */
  setLocalTeam(team: number): void {
    const player = this.players.get(this.localPlayerId);
    if (!player) return;
    player.team = team;
    this.broadcastPlayerUpdate(player);
  }

  /** Update local player's color. */
  setLocalColor(color: number): void {
    const player = this.players.get(this.localPlayerId);
    if (!player) return;
    player.color = color;
    this.broadcastPlayerUpdate(player);
  }

  /** Toggle local player's ready state. */
  toggleReady(): void {
    const player = this.players.get(this.localPlayerId);
    if (!player) return;
    player.ready = !player.ready;
    this.sendMessage?.({
      type: 'lobby-ready',
      playerId: this.localPlayerId,
      ready: player.ready,
    });
    this.callbacks.onReadyChanged?.(this.localPlayerId, player.ready);
    this.notifyStateChanged();
  }

  /** Update game settings (host only). */
  updateSettings(partial: Partial<LobbySettings>): void {
    const localPlayer = this.players.get(this.localPlayerId);
    if (!localPlayer?.isHost) return;

    Object.assign(this.settings, partial);
    this.sendMessage?.({
      type: 'lobby-settings',
      mapPath: this.settings.mapPath,
      startingCredits: this.settings.startingCredits,
      superweapons: this.settings.superweapons,
    });
    this.callbacks.onSettingsChanged?.(this.settings);
    this.notifyStateChanged();
  }

  /** Start the game (host only, all players must be ready). */
  startGame(): boolean {
    const localPlayer = this.players.get(this.localPlayerId);
    if (!localPlayer?.isHost) return false;
    if (!this.allPlayersReady()) return false;
    if (this.players.size < 2) return false;

    this.sendMessage?.({
      type: 'lobby-start',
      hostId: this.localPlayerId,
    });
    this.callbacks.onGameStart?.();
    return true;
  }

  // ========================================================================
  // State queries
  // ========================================================================

  getState(): LobbyState {
    return {
      players: [...this.players.values()].map((p) => ({ ...p })),
      settings: { ...this.settings },
      chatHistory: [...this.chatHistory],
    };
  }

  getPlayers(): LobbyPlayer[] {
    return [...this.players.values()].map((p) => ({ ...p }));
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getSettings(): LobbySettings {
    return { ...this.settings };
  }

  getChatHistory(): LobbyChatMessage[] {
    return [...this.chatHistory];
  }

  allPlayersReady(): boolean {
    for (const player of this.players.values()) {
      if (!player.ready) return false;
    }
    return true;
  }

  isHost(): boolean {
    return this.players.get(this.localPlayerId)?.isHost ?? false;
  }

  // ========================================================================
  // Message handlers
  // ========================================================================

  private handleJoin(msg: LobbyJoinMessage): void {
    if (this.players.size >= MAX_PLAYERS) return;
    if (this.players.has(msg.playerId)) return;

    const player: LobbyPlayer = {
      id: msg.playerId,
      name: msg.playerName,
      side: 'America',
      team: 0,
      color: COLOR_OPTIONS[msg.playerId % COLOR_OPTIONS.length]!,
      ready: false,
      isHost: false,
      isLocal: false,
    };
    this.addPlayer(player);
    this.callbacks.onPlayerJoined?.(player);
    this.notifyStateChanged();
  }

  private handleLeave(msg: LobbyLeaveMessage): void {
    this.players.delete(msg.playerId);
    this.callbacks.onPlayerLeft?.(msg.playerId);
    this.notifyStateChanged();
  }

  private handlePlayerUpdate(msg: LobbyPlayerUpdateMessage): void {
    const player = this.players.get(msg.playerId);
    if (!player) return;
    player.side = msg.side;
    player.team = msg.team;
    player.color = msg.color;
    this.callbacks.onPlayerUpdated?.(player);
    this.notifyStateChanged();
  }

  private handleChat(msg: LobbyChatMessage): void {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > MAX_CHAT_HISTORY) {
      this.chatHistory.shift();
    }
    this.callbacks.onChatMessage?.(msg);
    this.notifyStateChanged();
  }

  private handleReady(msg: LobbyReadyMessage): void {
    const player = this.players.get(msg.playerId);
    if (!player) return;
    player.ready = msg.ready;
    this.callbacks.onReadyChanged?.(msg.playerId, msg.ready);
    this.notifyStateChanged();
  }

  private handleSettings(msg: LobbySettingsMessage): void {
    this.settings.mapPath = msg.mapPath;
    this.settings.startingCredits = msg.startingCredits;
    this.settings.superweapons = msg.superweapons;
    this.callbacks.onSettingsChanged?.(this.settings);
    this.notifyStateChanged();
  }

  // ========================================================================
  // Internal helpers
  // ========================================================================

  private addPlayer(player: LobbyPlayer): void {
    this.players.set(player.id, player);
  }

  private broadcastPlayerUpdate(player: LobbyPlayer): void {
    this.sendMessage?.({
      type: 'lobby-player-update',
      playerId: player.id,
      side: player.side,
      team: player.team,
      color: player.color,
    });
    this.callbacks.onPlayerUpdated?.(player);
    this.notifyStateChanged();
  }

  private notifyStateChanged(): void {
    this.callbacks.onStateChanged?.(this.getState());
  }
}
