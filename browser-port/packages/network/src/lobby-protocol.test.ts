import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LobbyManager, type LobbyMessage, type LobbyCallbacks } from './lobby-protocol.js';

describe('LobbyManager', () => {
  let lobby: LobbyManager;
  let sentMessages: LobbyMessage[];
  let callbacks: LobbyCallbacks;

  beforeEach(() => {
    sentMessages = [];
    callbacks = {
      onPlayerJoined: vi.fn(),
      onPlayerLeft: vi.fn(),
      onPlayerUpdated: vi.fn(),
      onChatMessage: vi.fn(),
      onReadyChanged: vi.fn(),
      onSettingsChanged: vi.fn(),
      onGameStart: vi.fn(),
      onStateChanged: vi.fn(),
    };
    lobby = new LobbyManager(0, 'Host', callbacks);
    lobby.setSendFunction((msg) => sentMessages.push(msg));
  });

  it('initializes with local player as host', () => {
    const players = lobby.getPlayers();
    expect(players.length).toBe(1);
    expect(players[0]!.id).toBe(0);
    expect(players[0]!.name).toBe('Host');
    expect(players[0]!.isHost).toBe(true);
    expect(players[0]!.isLocal).toBe(true);
    expect(lobby.isHost()).toBe(true);
  });

  it('handles player join', () => {
    lobby.handleMessage({
      type: 'lobby-join',
      playerId: 1,
      playerName: 'Player2',
    });
    expect(lobby.getPlayerCount()).toBe(2);
    expect(callbacks.onPlayerJoined).toHaveBeenCalled();
  });

  it('prevents duplicate player join', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    expect(lobby.getPlayerCount()).toBe(2);
  });

  it('caps players at 8', () => {
    for (let i = 1; i <= 9; i++) {
      lobby.handleMessage({ type: 'lobby-join', playerId: i, playerName: `P${i}` });
    }
    expect(lobby.getPlayerCount()).toBe(8);
  });

  it('handles player leave', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.handleMessage({ type: 'lobby-leave', playerId: 1 });
    expect(lobby.getPlayerCount()).toBe(1);
    expect(callbacks.onPlayerLeft).toHaveBeenCalledWith(1);
  });

  it('handles player faction update', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.handleMessage({
      type: 'lobby-player-update',
      playerId: 1,
      side: 'GLA',
      team: 2,
      color: 0x00ff00,
    });
    const player = lobby.getPlayers().find((p) => p.id === 1)!;
    expect(player.side).toBe('GLA');
    expect(player.team).toBe(2);
    expect(player.color).toBe(0x00ff00);
  });

  it('setLocalSide broadcasts update', () => {
    lobby.setLocalSide('China');
    const player = lobby.getPlayers().find((p) => p.id === 0)!;
    expect(player.side).toBe('China');
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]!.type).toBe('lobby-player-update');
  });

  it('setLocalTeam broadcasts update', () => {
    lobby.setLocalTeam(3);
    const player = lobby.getPlayers().find((p) => p.id === 0)!;
    expect(player.team).toBe(3);
  });

  it('setLocalColor broadcasts update', () => {
    lobby.setLocalColor(0xff00ff);
    const player = lobby.getPlayers().find((p) => p.id === 0)!;
    expect(player.color).toBe(0xff00ff);
  });

  it('handles chat messages', () => {
    lobby.sendChat('Hello!');
    expect(lobby.getChatHistory().length).toBe(1);
    expect(lobby.getChatHistory()[0]!.text).toBe('Hello!');
    expect(callbacks.onChatMessage).toHaveBeenCalled();
    expect(sentMessages.length).toBe(1);
  });

  it('caps chat history at 100', () => {
    for (let i = 0; i < 110; i++) {
      lobby.handleMessage({
        type: 'lobby-chat',
        playerId: 0,
        playerName: 'Host',
        text: `msg ${i}`,
        timestamp: Date.now(),
      });
    }
    expect(lobby.getChatHistory().length).toBe(100);
  });

  it('toggleReady flips ready state', () => {
    expect(lobby.getPlayers()[0]!.ready).toBe(false);
    lobby.toggleReady();
    expect(lobby.getPlayers()[0]!.ready).toBe(true);
    lobby.toggleReady();
    expect(lobby.getPlayers()[0]!.ready).toBe(false);
  });

  it('handles remote ready messages', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.handleMessage({ type: 'lobby-ready', playerId: 1, ready: true });
    const player = lobby.getPlayers().find((p) => p.id === 1)!;
    expect(player.ready).toBe(true);
  });

  it('allPlayersReady returns false if any not ready', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.toggleReady();
    expect(lobby.allPlayersReady()).toBe(false);
  });

  it('allPlayersReady returns true when all ready', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.toggleReady();
    lobby.handleMessage({ type: 'lobby-ready', playerId: 1, ready: true });
    expect(lobby.allPlayersReady()).toBe(true);
  });

  it('updateSettings changes settings and broadcasts', () => {
    lobby.updateSettings({ mapPath: 'maps/test.json', startingCredits: 5000 });
    const settings = lobby.getSettings();
    expect(settings.mapPath).toBe('maps/test.json');
    expect(settings.startingCredits).toBe(5000);
    expect(callbacks.onSettingsChanged).toHaveBeenCalled();
    expect(sentMessages.some((m) => m.type === 'lobby-settings')).toBe(true);
  });

  it('non-host cannot update settings', () => {
    const clientLobby = new LobbyManager(1, 'Client', {});
    // Remove host flag from client.
    const player = clientLobby.getPlayers()[0]!;
    player.isHost = false;
    clientLobby.updateSettings({ mapPath: 'test' });
    expect(clientLobby.getSettings().mapPath).toBe('');
  });

  it('startGame requires all ready and at least 2 players', () => {
    lobby.toggleReady();
    // Only 1 player — should fail.
    expect(lobby.startGame()).toBe(false);

    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    // Player 2 not ready.
    expect(lobby.startGame()).toBe(false);

    lobby.handleMessage({ type: 'lobby-ready', playerId: 1, ready: true });
    expect(lobby.startGame()).toBe(true);
    expect(callbacks.onGameStart).toHaveBeenCalled();
  });

  it('handles settings message from remote', () => {
    lobby.handleMessage({
      type: 'lobby-settings',
      mapPath: 'remote-map.json',
      startingCredits: 25000,
      superweapons: false,
    });
    const settings = lobby.getSettings();
    expect(settings.mapPath).toBe('remote-map.json');
    expect(settings.startingCredits).toBe(25000);
    expect(settings.superweapons).toBe(false);
  });

  it('handles game start message', () => {
    lobby.handleMessage({ type: 'lobby-start', hostId: 0 });
    expect(callbacks.onGameStart).toHaveBeenCalled();
  });

  it('getState returns complete snapshot', () => {
    lobby.handleMessage({ type: 'lobby-join', playerId: 1, playerName: 'P2' });
    lobby.sendChat('Test');
    const state = lobby.getState();
    expect(state.players.length).toBe(2);
    expect(state.chatHistory.length).toBe(1);
    expect(state.settings.startingCredits).toBe(10000);
  });
});
