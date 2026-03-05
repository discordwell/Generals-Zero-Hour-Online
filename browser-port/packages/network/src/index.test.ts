import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { NetworkManager, getNetworkClient, initializeNetworkClient } from './index.js';
import type { DeterministicCommand } from '@generals/engine';
import { GameLogicSubsystem } from '@generals/game-logic';
import { IniDataRegistry } from '@generals/ini-data';
import { HeightmapGrid, type MapDataJSON } from '@generals/terrain';

const NETCOMMANDTYPE_WRAPPER = 17;
const NETCOMMANDTYPE_CHAT = 11;
const NETCOMMANDTYPE_RUNAHEADMETRICS = 6;
const NETCOMMANDTYPE_RUNAHEAD = 7;
const NETCOMMANDTYPE_PACKETROUTERQUERY = 25;
const NETCOMMANDTYPE_PACKETROUTERACK = 26;
const EMPTY_HEIGHTMAP_BASE64 = 'AAAAAA==';

function createMinimalMapData(): MapDataJSON {
  return {
    heightmap: {
      width: 2,
      height: 2,
      borderSize: 0,
      data: EMPTY_HEIGHTMAP_BASE64,
    },
    objects: [
      {
        position: {
          x: 5,
          y: 5,
          z: 0,
        },
        angle: 0,
        templateName: 'NetworkCrcEntity',
        flags: 0,
        properties: {},
      },
    ],
    triggers: [],
    textureClasses: [],
    blendTileCount: 0,
  };
}

function appendUint8(bytes: number[], value: number): void {
  bytes.push(value & 0xff);
}

function appendUint16LE(bytes: number[], value: number): void {
  const normalized = value & 0xffff;
  bytes.push(normalized & 0xff, (normalized >>> 8) & 0xff);
}

function appendUint32LE(bytes: number[], value: number): void {
  const normalized = value >>> 0;
  bytes.push(
    normalized & 0xff,
    (normalized >>> 8) & 0xff,
    (normalized >>> 16) & 0xff,
    (normalized >>> 24) & 0xff,
  );
}

function appendInt32LE(bytes: number[], value: number): void {
  const normalized = value | 0;
  appendUint32LE(bytes, normalized);
}

function appendFloat32(bytes: number[], value: number): void {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  bytes.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
}

function buildChatNetCommandBytes(text: string, sender = 1, playerMask = 1): Uint8Array {
  const bytes: number[] = [];
  appendUint8(bytes, 'T'.charCodeAt(0));
  appendUint8(bytes, NETCOMMANDTYPE_CHAT);
  appendUint8(bytes, 'P'.charCodeAt(0));
  appendUint8(bytes, sender);
  appendUint8(bytes, 'D'.charCodeAt(0));
  appendUint8(bytes, text.length);
  for (let i = 0; i < text.length; i += 1) {
    appendUint16LE(bytes, text.charCodeAt(i));
  }
  appendInt32LE(bytes, playerMask);
  return new Uint8Array(bytes);
}

function buildRunaheadNetCommandBytes(
  newRunAhead: number,
  newFrameRate: number,
  sender?: number,
): Uint8Array {
  const bytes: number[] = [];
  appendUint8(bytes, 'T'.charCodeAt(0));
  appendUint8(bytes, NETCOMMANDTYPE_RUNAHEAD);
  if (typeof sender === 'number') {
    appendUint8(bytes, 'P'.charCodeAt(0));
    appendUint8(bytes, sender);
  }
  appendUint8(bytes, 'D'.charCodeAt(0));
  appendUint16LE(bytes, newRunAhead);
  appendUint8(bytes, newFrameRate);
  return new Uint8Array(bytes);
}

function buildRunaheadMetricsNetCommandBytes(
  averageLatency: number,
  averageFps: number,
  sender?: number,
): Uint8Array {
  const bytes: number[] = [];
  appendUint8(bytes, 'T'.charCodeAt(0));
  appendUint8(bytes, NETCOMMANDTYPE_RUNAHEADMETRICS);
  if (typeof sender === 'number') {
    appendUint8(bytes, 'P'.charCodeAt(0));
    appendUint8(bytes, sender);
  }
  appendUint8(bytes, 'D'.charCodeAt(0));
  appendFloat32(bytes, averageLatency);
  appendUint16LE(bytes, averageFps);
  return new Uint8Array(bytes);
}

function buildWrapperChunkPayload(
  wrappedCommandId: number,
  chunkNumber: number,
  numChunks: number,
  totalDataLength: number,
  dataOffset: number,
  chunkData: Uint8Array,
): Uint8Array {
  const payload = new Uint8Array(22 + chunkData.length);
  const view = new DataView(payload.buffer);
  view.setUint16(0, wrappedCommandId, true);
  view.setUint32(2, chunkNumber, true);
  view.setUint32(6, numChunks, true);
  view.setUint32(10, totalDataLength, true);
  view.setUint32(14, chunkData.length, true);
  view.setUint32(18, dataOffset, true);
  payload.set(chunkData, 22);
  return payload;
}

function buildWrapperMessageChunks(
  wrappedCommandBytes: Uint8Array,
  wrappedCommandId: number,
  chunkSize: number,
): Array<{
  commandType: number;
  payload: Uint8Array;
}> {
  const numChunks = Math.max(1, Math.ceil(wrappedCommandBytes.length / chunkSize));
  const chunks = [];
  for (let chunkNumber = 0; chunkNumber < numChunks; chunkNumber += 1) {
    const chunkOffset = chunkNumber * chunkSize;
    const chunkData = wrappedCommandBytes.subarray(chunkOffset, chunkOffset + chunkSize);
    chunks.push({
      commandType: NETCOMMANDTYPE_WRAPPER,
      payload: buildWrapperChunkPayload(
        wrappedCommandId,
        chunkNumber,
        numChunks,
        wrappedCommandBytes.length,
        chunkOffset,
        chunkData,
      ),
    });
  }
  return chunks;
}

function makeWrappedChatCommand(text: string): {
  chunks: Array<{
    commandType: number;
    payload: Uint8Array;
  }>;
} {
  const wrappedCommandBytes = buildChatNetCommandBytes(text, 1, 1);
  return {
    chunks: buildWrapperMessageChunks(wrappedCommandBytes, 0x1234, 64),
  };
}

describe('NetworkManager.parseUserList', () => {
  it('normalizes getConstSlot sources by declared slot count', () => {
    const requestedSlots: number[] = [];
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Host',
    });
    const game = {
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getConstSlot: (slotNum: number) => {
        requestedSlots.push(slotNum);
        if (slotNum === 0) {
          return {
            id: 0,
            name: 'Host',
            isHuman: true,
          };
        }
        if (slotNum === 1) {
          return {
            id: 1,
            name: 'Opponent',
            isHuman: true,
          };
        }
        return {
          id: 99,
          name: 'Phantom',
          isHuman: true,
        };
      },
    };

    manager.parseUserList(game);

    expect(requestedSlots).toEqual([0, 1]);
    expect(manager.getNumPlayers()).toBe(2);
    expect(manager.getPlayerName(0)).toBe('Host');
    expect(manager.getPlayerName(1)).toBe('Opponent');
  });

  it('excludes AI and non-occupied users from map/array slot sources', () => {
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Local',
    });
    const game = {
      localPlayerName: 'Local',
      getNumPlayers: () => 8,
      players: [
        {
          id: 0,
          name: 'Host',
          isHuman: true,
        },
        {
          id: 1,
          name: 'Computer',
          isAI: true,
        },
        {
          id: 2,
          name: 'OpenSlot',
          isOccupied: false,
        },
        {
          id: 3,
          name: 'Second',
          isHuman: true,
        },
      ],
      playersBySlot: {
        5: {
          playerId: 5,
          player: 'BySlotValid',
          isOccupied: true,
        },
        6: {
          playerId: 6,
          player: 'BySlotAI',
          isAI: true,
        },
        7: {
          playerId: 7,
          player: 'BySlotOpen',
          isOccupied: false,
        },
      },
    };

    manager.parseUserList(game);

    expect(manager.getNumPlayers()).toBe(3);
    expect(manager.getPlayerName(0)).toBe('Host');
    expect(manager.getPlayerName(1)).toBe('Player 2');
    expect(manager.getPlayerName(2)).toBe('Player 3');
    expect(manager.getPlayerName(3)).toBe('Second');
    expect(manager.getPlayerName(5)).toBe('BySlotValid');
    expect(manager.getPlayerName(6)).toBe('Player 7');
    expect(manager.getPlayerName(7)).toBe('Player 8');
  });

  it('falls back to getSlot for slot iteration when getConstSlot is unavailable', () => {
    const requestedSlots: number[] = [];
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Local',
    });
    const game = {
      localPlayerName: 'Local',
      getSlot: (slotNum: number) => {
        requestedSlots.push(slotNum);
        if (slotNum === 0) {
          return {
            id: 0,
            name: 'Local',
            isHuman: true,
          };
        }
        if (slotNum === 1) {
          return {
            id: 1,
            name: 'Remote',
            isHuman: true,
          };
        }
        return null;
      },
    };

    manager.parseUserList(game);

    expect(requestedSlots).toContain(0);
    expect(requestedSlots).toContain(1);
    expect(requestedSlots.length).toBeGreaterThanOrEqual(2);
    expect(manager.getNumPlayers()).toBe(2);
    expect(manager.getPlayerName(0)).toBe('Local');
    expect(manager.getPlayerName(1)).toBe('Remote');
  });

  it('parses comma-separated legacy user list strings', () => {
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Backup',
    });
    const game = {
      userList: 'Alice@1.1.1.1:9999,Bob@2.2.2.2:9999',
      localPlayerName: 'Alice',
      getNumPlayers: () => 2,
    };

    manager.parseUserList(game);

    expect(manager.getNumPlayers()).toBe(2);
    expect(manager.getPlayerName(0)).toBe('Alice');
    expect(manager.getPlayerName(1)).toBe('Bob');
  });

  it('captures player side strings from slot metadata', () => {
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Host',
    });
    const game = {
      localSlotNum: 0,
      localPlayerSide: 'America',
      getNumPlayers: () => 3,
      getConstSlot: (slotNum: number) => {
        if (slotNum === 0) {
          return {
            id: 0,
            name: 'Host',
            isHuman: true,
            side: 'America',
          };
        }
        if (slotNum === 1) {
          return {
            id: 1,
            name: 'Ally',
            isHuman: true,
            getSide: () => 'China',
          };
        }
        if (slotNum === 2) {
          return {
            id: 2,
            name: 'Enemy',
            isHuman: true,
            faction: 'GLA',
          };
        }
        return null;
      },
    };

    manager.parseUserList(game);

    expect(manager.getPlayerSide(0)).toBe('America');
    expect(manager.getPlayerSide(1)).toBe('China');
    expect(manager.getPlayerSide(2)).toBe('GLA');
    expect(manager.getPlayerSide(3)).toBeNull();
  });

  it('reports known player slots from parsed users and local slot', () => {
    const manager = new NetworkManager({
      localPlayerID: 4,
      localPlayerName: 'Local',
    });
    const game = {
      localSlotNum: 4,
      players: [
        { id: 1, name: 'One', isHuman: true, side: 'America' },
        { id: 3, name: 'Three', isHuman: true, side: 'China' },
      ],
    };

    manager.parseUserList(game);

    expect(manager.getKnownPlayerSlots()).toEqual([1, 3, 4]);
  });

  it('tracks disconnected players as disconnected from connected count', () => {
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Host',
    });
    const game = {
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 4,
      getConstSlot: (slotNum: number) => {
        if (slotNum === 0) {
          return {
            id: 0,
            name: 'Host',
            isHuman: true,
          };
        }
        if (slotNum === 1) {
          return {
            id: 1,
            name: 'Player2',
            isHuman: true,
          };
        }
        return null;
      },
    };

    manager.parseUserList(game);

    expect(manager.isPlayerConnected(1)).toBe(true);
    expect(manager.getNumPlayers()).toBe(2);

    manager.selfDestructPlayer(1);

    expect(manager.isPlayerConnected(1)).toBe(false);
    expect(manager.getNumPlayers()).toBe(1);
    expect(manager.getPlayerName(1)).toBe('Player2');
  });

  it('uses getLocalSlotNum when resolving local player identity', () => {
    const gameSlots = [
      {
        id: 0,
        name: 'OpenSlot',
        isHuman: false,
      },
      {
        id: 1,
        name: 'NotLocal',
        isHuman: true,
      },
      {
        id: 2,
        name: 'ActualLocal',
        isHuman: true,
      },
    ];

    const manager = new NetworkManager({
      localPlayerName: 'FallbackLocal',
    });
    const game = {
      localSlotNum: 2,
      localPlayerName: 'ActualLocal',
      getNumPlayers: () => 3,
      getSlot: (slotNum: number) => gameSlots[slotNum] ?? null,
    };

    manager.parseUserList(game);

    expect(manager.getLocalPlayerID()).toBe(2);
    expect(manager.getPlayerName(2)).toBe('ActualLocal');
  });

  it('deduplicates players when the same slot appears across multiple user sources', () => {
    const manager = new NetworkManager({
      localPlayerID: 0,
      localPlayerName: 'Fallback',
    });
    const game = {
      users: [{ id: 0, name: 'DuplicateFromUsers' }],
      players: [
        { id: 0, name: 'DuplicateFromPlayers', isHuman: true },
        { id: 1, name: 'Second', isHuman: true },
      ],
      playersBySlot: {
        1: {
          id: 1,
          name: 'MapWins',
          isHuman: true,
        },
      },
      localPlayerName: 'DuplicateFromUsers',
      getNumPlayers: () => 2,
    };

    manager.parseUserList(game);

    expect(manager.getNumPlayers()).toBe(2);
    expect(manager.getPlayerName(0)).toBe('DuplicateFromPlayers');
    expect(manager.getPlayerName(1)).toBe('MapWins');
  });

  it('ignores malformed user entries and ignores out-of-range local slot values', () => {
    const manager = new NetworkManager({
      localPlayerID: 4,
      localPlayerName: 'FallbackLocal',
    });
    const game = {
      localSlotNum: 'badSlot',
      players: [
        { id: 'bad', name: 'MalformedID', isHuman: true },
        { id: 1, name: 'Active', isHuman: true },
        null,
      ],
      getNumPlayers: () => 4,
    };

    manager.parseUserList(game);

    expect(manager.getLocalPlayerID()).toBe(4);
    expect(manager.getNumPlayers()).toBe(2);
    expect(manager.getPlayerName(1)).toBe('Active');
    expect(manager.getPlayerName(4)).toBe('FallbackLocal');
  });
});

describe('Network deterministic kernel integration', () => {
  it('advances deterministic frame ownership during update ticks', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      frameRate: 60,
    });
    manager.init();

    const internals = manager as unknown as { lastUpdateMs: number };
    internals.lastUpdateMs = performance.now() - 1000;

    expect(manager.getGameFrame()).toBe(0);
    manager.update();
    expect(manager.getGameFrame()).toBe(1);
    expect(manager.getExecutionFrame()).toBeGreaterThanOrEqual(31);
  });

  it('sends disconnect keepalive when frame stall exceeds timeout', async () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      frameRate: 300,
      disconnectTimeoutMs: 0,
      disconnectKeepAliveIntervalMs: 20,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });
    manager.init();
    manager.setDisconnectTimeout(0);
    manager.setDisconnectKeepAliveInterval(20);

    const internals = manager as unknown as {
      lastUpdateMs: number;
    };

    // First update seeds stall observation state.
    internals.lastUpdateMs = performance.now();
    manager.update();

    // Second update after a short pause triggers timeout keepalive.
    await new Promise((resolve) => setTimeout(resolve, 2));
    internals.lastUpdateMs = performance.now();
    manager.update();

    expect(directSends).toHaveLength(1);
    expect(directSends[0]?.relayMask).toBe(1 << 1);
    expect(directSends[0]?.command).toMatchObject({
      commandType: 23,
      sender: 0,
    });

    // Keepalive pacing should suppress immediate resend.
    internals.lastUpdateMs = performance.now();
    manager.update();
    expect(directSends).toHaveLength(1);

    // After interval elapses, keepalive should send again.
    await new Promise((resolve) => setTimeout(resolve, 25));
    internals.lastUpdateMs = performance.now();
    manager.update();
    expect(directSends).toHaveLength(2);
  });

  it('resets disconnect timeout tracking on keepalive packets', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      disconnectTimeoutMs: 0,
      disconnectPlayerTimeoutMs: 20,
      disconnectKeepAliveIntervalMs: 1000,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });
    manager.init();

    const internals = manager as unknown as {
      updateDisconnectTimeoutState: (nowMs: number) => void;
      frameState: {
        translatedSlotPosition: (slot: number, localSlot: number) => number;
        hasDisconnectPlayerTimedOut: (
          translatedSlot: number,
          nowMs: number,
          playerTimeoutMs: number,
        ) => boolean;
      };
    };
    const base = performance.now();

    internals.updateDisconnectTimeoutState(base);
    internals.updateDisconnectTimeoutState(base + 1);

    const translatedSlot = internals.frameState.translatedSlotPosition(1, manager.getLocalPlayerID());
    expect(internals.frameState.hasDisconnectPlayerTimedOut(translatedSlot, base + 25, 20)).toBe(true);

    expect(manager.processIncomingCommand({
      commandType: 23,
      sender: 1,
    })).toBe(true);

    const keepAliveAppliedAt = performance.now();
    expect(internals.frameState.hasDisconnectPlayerTimedOut(translatedSlot, keepAliveAppliedAt + 5, 20)).toBe(false);
  });

  it('uses injected nowProvider for deterministic timeout and packet-router timing', () => {
    let nowMs = 1_000;
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      nowProvider: () => nowMs,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    manager.init();
    const internals = manager as unknown as {
      lastUpdateMs: number;
      lastPingMs: number;
      frameState: {
        translatedSlotPosition: (slot: number, localPlayerId: number) => number;
        hasDisconnectPlayerTimedOut: (translatedSlot: number, nowMs: number, playerTimeoutMs: number) => boolean;
        getPacketRouterTimeoutResetMs: () => number | null;
      };
    };
    expect(internals.lastUpdateMs).toBe(1_000);
    expect(internals.lastPingMs).toBe(1_000);

    nowMs = 1_200;
    manager.startGame();
    expect(internals.lastPingMs).toBe(1_200);

    manager.setPacketRouterSlot(1);
    expect(manager.processIncomingCommand({
      commandType: 26,
      sender: 1,
    })).toBe(true);
    expect(internals.frameState.getPacketRouterTimeoutResetMs()).toBe(1_200);

    nowMs = 1_300;
    expect(manager.processIncomingCommand({
      commandType: 23,
      sender: 1,
    })).toBe(true);

    const translatedSlot = internals.frameState.translatedSlotPosition(1, manager.getLocalPlayerID());
    expect(internals.frameState.hasDisconnectPlayerTimedOut(translatedSlot, 1_305, 10)).toBe(false);
    expect(internals.frameState.hasDisconnectPlayerTimedOut(translatedSlot, 1_311, 10)).toBe(true);
  });

  it('disconnects timed-out peers when local player owns packet-router responsibility', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      disconnectTimeoutMs: 0,
      disconnectPlayerTimeoutMs: 5,
      disconnectKeepAliveIntervalMs: 1000,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });
    manager.setPacketRouterSlot(0);

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });
    manager.init();

    const internals = manager as unknown as {
      updateDisconnectTimeoutState: (nowMs: number) => void;
      deterministicState: {
        peekCommands: () => ReadonlyArray<Readonly<DeterministicCommand<unknown>>>;
      };
    };
    const base = performance.now();

    internals.updateDisconnectTimeoutState(base);
    internals.updateDisconnectTimeoutState(base + 1);
    internals.updateDisconnectTimeoutState(base + 20);

    expect(manager.isPlayerConnected(1)).toBe(false);
    const disconnectCommand = directSends.find((entry) => {
      const command = entry.command as { commandType?: unknown };
      return command.commandType === 24;
    });
    const destroyCommand = directSends.find((entry) => {
      const command = entry.command as { commandType?: unknown };
      return command.commandType === 8;
    });
    expect(disconnectCommand?.relayMask).toBe(1 << 1);
    expect(disconnectCommand?.command).toMatchObject({
      commandType: 24,
      sender: 0,
      disconnectSlot: 1,
      disconnectFrame: 0,
    });
    expect(destroyCommand?.relayMask).toBe(1 << 1);
    expect(destroyCommand?.command).toMatchObject({
      commandType: 8,
      sender: 0,
      playerIndex: 1,
    });
    expect((destroyCommand?.command as { executionFrame?: number }).executionFrame).toBeGreaterThanOrEqual(31);

    const localQueuedCommandTypes = internals.deterministicState.peekCommands().map((command) => command.commandType);
    expect(localQueuedCommandTypes).toContain(24);
    expect(localQueuedCommandTypes).toContain(8);
  });

  it('validates optional frame hashes from frameinfo packets and flags mismatches', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 5,
    })).toBe(true);

    const matchingHash = manager.getDeterministicFrameHash(5);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 5,
      frameHash: matchingHash,
    })).toBe(true);
    expect(manager.sawCRCMismatch()).toBe(false);
    expect(manager.getDeterministicFrameHashMismatchFrames()).toEqual([]);

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 5,
      frameHash: (matchingHash + 1) >>> 0,
    })).toBe(true);
    expect(manager.sawCRCMismatch()).toBe(true);
    expect(manager.getDeterministicFrameHashMismatchFrames()).toEqual([5]);
  });

  it('validates logic CRC from frameinfo packets when GameLogic CRC writers are configured', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      gameLogicCrcSectionWriters: {
        writeObjects: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.nextObjectId >>> 0);
        },
        writePartitionManager: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.frame >>> 0);
        },
        writePlayerList: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.commands.length >>> 0);
        },
        writeAi: (crc) => {
          crc.addUnsignedInt(0);
        },
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 7,
    })).toBe(true);

    const matchingCrc = manager.getDeterministicGameLogicCrc(7);
    expect(matchingCrc).not.toBeNull();
    if (matchingCrc === null) {
      throw new Error('expected GameLogic CRC to be available');
    }

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 7,
      logicCRC: matchingCrc,
    })).toBe(true);
    expect(manager.sawCRCMismatch()).toBe(false);
    expect(manager.getDeterministicGameLogicCrcMismatchFrames()).toEqual([]);

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 7,
      logicCRC: (matchingCrc + 1) >>> 0,
    })).toBe(true);
    expect(manager.sawCRCMismatch()).toBe(true);
    expect(manager.getDeterministicGameLogicCrcMismatchFrames()).toEqual([7]);
  });

  it('validates logic CRC using GameLogicSubsystem-owned section writers', () => {
    const subsystem = new GameLogicSubsystem(new THREE.Scene());
    const heightmap = new HeightmapGrid(2, 2, 0, new Uint8Array([0, 0, 0, 0]));
    subsystem.loadMapObjects(createMinimalMapData(), new IniDataRegistry(), heightmap);

    try {
      const manager = new NetworkManager({
        localPlayerName: 'Host',
        localPlayerID: 0,
      });
      manager.setDeterministicGameLogicCrcSectionWriters(
        subsystem.createDeterministicGameLogicCrcSectionWriters(),
      );

      const localCrc = manager.getDeterministicGameLogicCrc(13);
      expect(localCrc).not.toBeNull();
      if (localCrc === null) {
        throw new Error('expected GameLogic CRC from GameLogicSubsystem writers');
      }

      expect(manager.processIncomingCommand({
        commandType: 3,
        sender: 1,
        frame: 13,
        logicCRC: localCrc,
      })).toBe(true);
      expect(manager.sawCRCMismatch()).toBe(false);

      expect(manager.processIncomingCommand({
        commandType: 3,
        sender: 1,
        frame: 13,
        logicCRC: (localCrc + 1) >>> 0,
      })).toBe(true);
      expect(manager.sawCRCMismatch()).toBe(true);
    } finally {
      subsystem.dispose();
    }
  });

  it('does not force metadata hash comparison for logic CRC when GameLogic CRC writers are unavailable', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 11,
      logicCRC: 0x12345678,
    })).toBe(true);
    expect(manager.sawCRCMismatch()).toBe(false);
  });

  it('reconciles cached remote logic CRC once local section writers are configured', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 12,
      logicCRC: 0xffffffff,
    })).toBe(true);
    expect(manager.sawCRCMismatch()).toBe(false);

    manager.setDeterministicGameLogicCrcSectionWriters({
      writeObjects: (crc) => {
        crc.addUnsignedInt(0x11111111);
      },
      writePartitionManager: (crc) => {
        crc.addUnsignedInt(0x22222222);
      },
      writePlayerList: (crc) => {
        crc.addUnsignedInt(0x33333333);
      },
      writeAi: (crc) => {
        crc.addUnsignedInt(0x44444444);
      },
    });

    const localCrc = manager.getDeterministicGameLogicCrc(12);
    expect(localCrc).not.toBeNull();
    expect(manager.sawCRCMismatch()).toBe(true);
  });

  it('exposes pending logic-CRC validation state until local CRC is published', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 21,
      logicCRC: 0x10101010,
    })).toBe(true);

    expect(manager.hasPendingDeterministicGameLogicCrcValidation()).toBe(true);
    expect(manager.hasPendingDeterministicGameLogicCrcValidation(21)).toBe(true);
    expect(manager.getPendingDeterministicGameLogicCrcValidationFrames()).toEqual([21]);
    expect(manager.getPendingDeterministicGameLogicCrcValidationPlayers(21)).toEqual([1]);

    manager.setDeterministicGameLogicCrcSectionWriters({
      writeObjects: (crc) => {
        crc.addUnsignedInt(0x11111111);
      },
      writePartitionManager: (crc) => {
        crc.addUnsignedInt(0x22222222);
      },
      writePlayerList: (crc) => {
        crc.addUnsignedInt(0x33333333);
      },
      writeAi: (crc) => {
        crc.addUnsignedInt(0x44444444);
      },
    });
    manager.getDeterministicGameLogicCrc(21);

    expect(manager.hasPendingDeterministicGameLogicCrcValidation()).toBe(false);
    expect(manager.getPendingDeterministicGameLogicCrcValidationFrames()).toEqual([]);
    expect(manager.getPendingDeterministicGameLogicCrcValidationPlayers(21)).toEqual([]);
  });

  it('exposes deterministic validation frame indexes and prunes old data', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      gameLogicCrcSectionWriters: {
        writeObjects: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.nextObjectId >>> 0);
        },
        writePartitionManager: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.frame >>> 0);
        },
        writePlayerList: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.commands.length >>> 0);
        },
        writeAi: (crc) => {
          crc.addUnsignedInt(0);
        },
      },
    });

    const frameHash2 = manager.getDeterministicFrameHash(2);
    const frameHash7 = manager.getDeterministicFrameHash(7);
    manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 2,
      frameHash: frameHash2,
    });
    manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 7,
      frameHash: frameHash7,
    });

    const logicCrc2 = manager.getDeterministicGameLogicCrc(2);
    const logicCrc7 = manager.getDeterministicGameLogicCrc(7);
    if (logicCrc2 === null || logicCrc7 === null) {
      throw new Error('expected local GameLogic CRC values');
    }
    manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 2,
      logicCRC: logicCrc2,
    });
    manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 7,
      logicCRC: logicCrc7,
    });

    expect(manager.getDeterministicFrameHashFrames()).toEqual({
      local: [2, 7],
      remote: [2, 7],
    });
    expect(manager.getDeterministicGameLogicCrcFrames()).toEqual({
      local: [2, 7],
      remote: [2, 7],
    });
    expect(manager.getDeterministicValidationFramesToKeep()).toBe(65);

    manager.pruneDeterministicValidationBefore(7);
    expect(manager.getDeterministicFrameHashFrames()).toEqual({
      local: [7],
      remote: [7],
    });
    expect(manager.getDeterministicGameLogicCrcFrames()).toEqual({
      local: [7],
      remote: [7],
    });
  });

  it('auto-prunes deterministic validation caches by source frame retention window during update', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      frameRate: 300,
      gameLogicCrcSectionWriters: {
        writeObjects: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.nextObjectId >>> 0);
        },
        writePartitionManager: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.frame >>> 0);
        },
        writePlayerList: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.commands.length >>> 0);
        },
        writeAi: (crc) => {
          crc.addUnsignedInt(0);
        },
      },
    });
    manager.init();

    const baselineFrame = manager.getGameFrame();
    const baselineHash = manager.getDeterministicFrameHash(baselineFrame);
    const baselineLogicCrc = manager.getDeterministicGameLogicCrc(baselineFrame);
    if (baselineLogicCrc === null) {
      throw new Error('expected baseline GameLogic CRC value');
    }

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: baselineFrame,
      frameHash: baselineHash,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: baselineFrame,
      logicCRC: baselineLogicCrc,
    })).toBe(true);

    expect(manager.getDeterministicFrameHashFrames()).toEqual({
      local: [baselineFrame],
      remote: [baselineFrame],
    });
    expect(manager.getDeterministicGameLogicCrcFrames()).toEqual({
      local: [baselineFrame],
      remote: [baselineFrame],
    });

    const internals = manager as unknown as { lastUpdateMs: number };
    const framesToKeep = manager.getDeterministicValidationFramesToKeep();
    for (let step = 0; step < framesToKeep + 2; step += 1) {
      internals.lastUpdateMs = performance.now() - 1000;
      manager.update();
    }

    expect(manager.getDeterministicFrameHashFrames().remote).toEqual([]);
    expect(manager.getDeterministicGameLogicCrcFrames()).toEqual({
      local: [],
      remote: [],
    });
    expect(manager.getDeterministicFrameHashFrames().local).not.toContain(baselineFrame);
  });

  it('prunes deterministic validation caches when consumed frame ownership advances', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      gameLogicCrcSectionWriters: {
        writeObjects: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.nextObjectId >>> 0);
        },
        writePartitionManager: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.frame >>> 0);
        },
        writePlayerList: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.commands.length >>> 0);
        },
        writeAi: (crc) => {
          crc.addUnsignedInt(0);
        },
      },
    });

    const frameHash1 = manager.getDeterministicFrameHash(1);
    const frameHash66 = manager.getDeterministicFrameHash(66);
    const logicCrc1 = manager.getDeterministicGameLogicCrc(1);
    const logicCrc66 = manager.getDeterministicGameLogicCrc(66);
    if (logicCrc1 === null || logicCrc66 === null) {
      throw new Error('expected local GameLogic CRC values');
    }

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 1,
      frameHash: frameHash1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 1,
      logicCRC: logicCrc1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 66,
      frameHash: frameHash66,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 66,
      logicCRC: logicCrc66,
    })).toBe(true);

    expect(manager.getDeterministicFrameHashFrames()).toEqual({
      local: [1, 66],
      remote: [1, 66],
    });
    expect(manager.getDeterministicGameLogicCrcFrames()).toEqual({
      local: [1, 66],
      remote: [1, 66],
    });

    expect(manager.consumeReadyFrame(66)).toBe(true);
    expect(manager.getDeterministicFrameHashFrames()).toEqual({
      local: [66],
      remote: [66],
    });
    expect(manager.getDeterministicGameLogicCrcFrames()).toEqual({
      local: [66],
      remote: [66],
    });
  });

  it('tracks deterministic mismatch frame indexes and prunes them with validation windows', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      gameLogicCrcSectionWriters: {
        writeObjects: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.nextObjectId >>> 0);
        },
        writePartitionManager: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.frame >>> 0);
        },
        writePlayerList: (crc, snapshot) => {
          crc.addUnsignedInt(snapshot.commands.length >>> 0);
        },
        writeAi: (crc) => {
          crc.addUnsignedInt(0);
        },
      },
    });

    const frameHash = manager.getDeterministicFrameHash(2);
    const logicCrc = manager.getDeterministicGameLogicCrc(2);
    if (logicCrc === null) {
      throw new Error('expected local GameLogic CRC value');
    }

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 2,
      frameHash: (frameHash + 1) >>> 0,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 2,
      logicCRC: (logicCrc + 1) >>> 0,
    })).toBe(true);

    expect(manager.getDeterministicFrameHashMismatchFrames()).toEqual([2]);
    expect(manager.getDeterministicGameLogicCrcMismatchFrames()).toEqual([2]);

    manager.pruneDeterministicValidationBefore(3);
    expect(manager.getDeterministicFrameHashMismatchFrames()).toEqual([]);
    expect(manager.getDeterministicGameLogicCrcMismatchFrames()).toEqual([]);
  });

  it('reports source-style logic-CRC consensus status across connected players', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 3,
      getSlot: (slotNum: number) => {
        if (slotNum > 2) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : `Peer ${slotNum}`,
          isHuman: true,
        };
      },
    });

    manager.setDeterministicGameLogicCrcSectionWriters({
      writeObjects: (crc) => {
        crc.addUnsignedInt(0x11111111);
      },
      writePartitionManager: (crc) => {
        crc.addUnsignedInt(0x22222222);
      },
      writePlayerList: (crc) => {
        crc.addUnsignedInt(0x33333333);
      },
      writeAi: (crc) => {
        crc.addUnsignedInt(0x44444444);
      },
    });

    const localCrc = manager.getDeterministicGameLogicCrc(30);
    expect(localCrc).not.toBeNull();
    if (localCrc === null) {
      throw new Error('expected local logic CRC');
    }

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 30,
      logicCRC: localCrc,
    })).toBe(true);

    const pending = manager.getDeterministicGameLogicCrcConsensus(30);
    expect(pending.status).toBe('pending');
    expect(pending.missingPlayerIds).toEqual([2]);

    const synchronizedCrc = manager.getDeterministicGameLogicCrc(30);
    expect(synchronizedCrc).not.toBeNull();
    if (synchronizedCrc === null) {
      throw new Error('expected synchronized local logic CRC');
    }

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 30,
      logicCRC: synchronizedCrc,
    })).toBe(true);

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 2,
      frame: 30,
      logicCRC: synchronizedCrc,
    })).toBe(true);

    const matched = manager.getDeterministicGameLogicCrcConsensus(30);
    expect(matched.status).toBe('match');
    expect(matched.mismatchedPlayerIds).toEqual([]);
    expect(matched.validatorCrc).toBe(synchronizedCrc);

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 2,
      frame: 30,
      logicCRC: (synchronizedCrc + 1) >>> 0,
    })).toBe(true);

    const mismatched = manager.getDeterministicGameLogicCrcConsensus(30);
    expect(mismatched.status).toBe('mismatch');
    expect(mismatched.mismatchedPlayerIds).toEqual([2]);
  });

  it('resets frame readiness state on repeated init', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.init();

    const internals = manager as unknown as {
      frameQueueReady: Set<number>;
      pendingFrameNotices: number;
    };

    manager.processFrameInfoCommand({
      commandType: 3,
      sender: 1,
      frame: 6,
    });
    manager.notifyOthersOfNewFrame(6);

    expect(internals.frameQueueReady.size).toBeGreaterThan(0);
    expect(internals.pendingFrameNotices).toBe(1);

    manager.init();
    expect(internals.frameQueueReady.size).toBe(0);
    expect(internals.pendingFrameNotices).toBe(0);
    expect(manager.isFrameDataReady()).toBe(true);
  });

  it('tracks frame command counts and surfaces mismatch validation', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 9,
      commandCount: 2,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 3,
      frame: 9,
      commandCount: 1,
    })).toBe(true);
    expect(manager.getExpectedFrameCommandCount(9, 1)).toBe(2);
    expect(manager.getReceivedFrameCommandCount(9, 1)).toBe(0);
    expect(manager.sawFrameCommandCountMismatch()).toBe(false);

    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 9,
      commandId: 100,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 9,
      commandId: 101,
    })).toBe(true);
    expect(manager.getReceivedFrameCommandCount(9, 1)).toBe(2);
    expect(manager.sawFrameCommandCountMismatch()).toBe(false);

    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 9,
      commandId: 102,
    })).toBe(true);
    expect(manager.getExpectedFrameCommandCount(9, 1)).toBeNull();
    expect(manager.getExpectedFrameCommandCount(9, 3)).toBeNull();
    expect(manager.getReceivedFrameCommandCount(9, 1)).toBe(0);
    expect(manager.sawFrameCommandCountMismatch()).toBe(true);
    expect(manager.getFrameResendRequests()).toEqual([{ playerId: 1, frame: 9 }]);

    expect(directSends).toHaveLength(1);
    expect(directSends[0]?.relayMask).toBe(1 << 1);
    expect(directSends[0]?.command).toMatchObject({
      commandType: 21,
      frameToResend: 9,
      sender: 0,
      commandId: 64001,
    });
  });

  it('requests frame resend when synchronized commands arrive before frame info', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 0,
      commandId: 700,
    })).toBe(true);

    expect(manager.sawFrameCommandCountMismatch()).toBe(true);
    expect(manager.getFrameResendRequests()).toEqual([{ playerId: 1, frame: 0 }]);
    expect(directSends).toHaveLength(1);
    expect(directSends[0]?.relayMask).toBe(1 << 1);
    expect(directSends[0]?.command).toMatchObject({
      commandType: 21,
      frameToResend: 0,
      sender: 0,
      commandId: 64001,
    });
  });

  it('falls back resend target to first connected slot when source slot is disconnected', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 5,
      slot: 1,
    })).toBe(true);

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 4,
      commandCount: 1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 4,
      commandId: 810,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 4,
      commandId: 811,
    })).toBe(true);

    expect(manager.sawFrameCommandCountMismatch()).toBe(true);
    expect(manager.getFrameResendRequests()).toEqual([{ playerId: 1, frame: 4 }]);
    expect(directSends).toHaveLength(1);
    expect(directSends[0]?.relayMask).toBe(1 << 0);
    expect(directSends[0]?.command).toMatchObject({
      commandType: 21,
      frameToResend: 4,
      sender: 0,
      commandId: 64001,
    });
  });

  it('recovers long-running lockstep flow under deterministic packet loss and reorder', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });

    const totalFrames = 240;
    const expectedResendFrames = new Set<number>();
    const deferredFrameInfos: Array<{ frame: number; deliverAt: number }> = [];
    const deferredCommands: Array<{ frame: number; deliverAt: number; idSeed: number }> = [];
    let nextCommandId = 10_000;
    let nextFrameToConsume = 1;

    const sendFrameInfo = (frame: number): void => {
      expect(manager.processIncomingCommand({
        commandType: 3,
        sender: 1,
        frame,
        commandCount: 1,
      })).toBe(true);
    };
    const sendFrameCommand = (frame: number, idSeed = 0): void => {
      nextCommandId += 1;
      expect(manager.processIncomingCommand({
        commandType: 4,
        sender: 1,
        executionFrame: frame,
        commandId: nextCommandId + idSeed,
      })).toBe(true);
    };
    const drainReadyFrames = (maxFrame: number): void => {
      while (nextFrameToConsume <= maxFrame) {
        if (!manager.consumeReadyFrame(nextFrameToConsume)) {
          break;
        }
        nextFrameToConsume += 1;
      }
    };

    for (let tick = 1; tick <= totalFrames + 5; tick += 1) {
      if (tick <= totalFrames) {
        const frame = tick;
        const shouldForceReorder = frame % 9 === 0;
        const shouldDelayFrameInfo = frame % 7 === 0;
        const shouldDelayCommand = frame % 11 === 0;

        if (shouldForceReorder) {
          sendFrameCommand(frame, 100);
          expectedResendFrames.add(frame);
          if (shouldDelayFrameInfo) {
            deferredFrameInfos.push({ frame, deliverAt: tick + 1 });
          } else {
            sendFrameInfo(frame);
          }
          deferredCommands.push({
            frame,
            deliverAt: tick + (frame % 5 === 0 ? 3 : 2),
            idSeed: 200,
          });
        } else {
          if (shouldDelayFrameInfo) {
            deferredFrameInfos.push({ frame, deliverAt: tick + 1 });
          } else {
            sendFrameInfo(frame);
          }

          if (shouldDelayCommand || shouldDelayFrameInfo) {
            deferredCommands.push({
              frame,
              deliverAt: tick + (shouldDelayCommand ? 2 : 1),
              idSeed: 0,
            });
          } else {
            sendFrameCommand(frame);
          }
        }
      }

      for (let index = 0; index < deferredFrameInfos.length; ) {
        const queued = deferredFrameInfos[index];
        if (!queued || queued.deliverAt > tick) {
          index += 1;
          continue;
        }
        sendFrameInfo(queued.frame);
        deferredFrameInfos.splice(index, 1);
      }

      for (let index = 0; index < deferredCommands.length; ) {
        const queued = deferredCommands[index];
        if (!queued || queued.deliverAt > tick) {
          index += 1;
          continue;
        }
        sendFrameCommand(queued.frame, queued.idSeed);
        deferredCommands.splice(index, 1);
      }

      drainReadyFrames(totalFrames);
    }

    expect(nextFrameToConsume).toBe(totalFrames + 1);
    expect(deferredFrameInfos).toEqual([]);
    expect(deferredCommands).toEqual([]);

    const resendMessages = directSends.filter((entry) => {
      const command = entry.command as { commandType?: unknown };
      return command.commandType === 21;
    });
    const resendFrames = resendMessages
      .map((entry) => {
        const command = entry.command as { frameToResend?: unknown };
        return Number(command.frameToResend);
      })
      .sort((left, right) => left - right);

    expect(resendFrames).toEqual([...expectedResendFrames].sort((left, right) => left - right));
    for (const entry of resendMessages) {
      expect(entry.relayMask).toBe(1 << 1);
    }
    expect(manager.getFrameResendRequests()).toEqual([]);
  });

  it('gates frame readiness on connected-player command completion', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    expect(manager.isFrameDataReady()).toBe(false);
    expect(manager.getPendingFrameCommandPlayers(0)).toEqual([1]);

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 0,
      commandCount: 2,
    })).toBe(true);
    expect(manager.isFrameDataReady()).toBe(false);

    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 0,
      commandId: 200,
    })).toBe(true);
    expect(manager.isFrameDataReady()).toBe(false);

    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 0,
      commandId: 201,
    })).toBe(true);
    expect(manager.getPendingFrameCommandPlayers(0)).toEqual([]);
    expect(manager.isFrameDataReady()).toBe(true);
  });

  it('consumes ready frame command ownership and requires fresh frame data afterwards', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 0,
      commandCount: 1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 0,
      commandId: 500,
    })).toBe(true);

    expect(manager.isFrameDataReady()).toBe(true);
    expect(manager.consumeReadyFrame(0)).toBe(true);
    expect(manager.isFrameDataReady()).toBe(false);
    expect(manager.getPendingFrameCommandPlayers(0)).toEqual([1]);
    expect(manager.consumeReadyFrame(0)).toBe(false);
  });

  it('applies continuation gate after frame commands are ready', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 0,
      commandCount: 1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 0,
      commandId: 900,
    })).toBe(true);
    expect(manager.isFrameDataReady()).toBe(true);

    manager.setFrameContinuationGate(() => false);
    expect(manager.isFrameDataReady()).toBe(false);

    manager.setFrameContinuationGate(() => true);
    expect(manager.isFrameDataReady()).toBe(true);
  });
});

describe('NetworkManager constructor option normalization', () => {
  it('defaults runahead and framerate to canonical constants when unspecified', () => {
    const manager = new NetworkManager();

    expect(manager.getRunAhead()).toBe(30);
    expect(manager.getFrameRate()).toBe(30);
  });

  it('clamps and floors framerate values', () => {
    const lowFrameRate = new NetworkManager({ frameRate: 0 });
    const decimalFrameRate = new NetworkManager({ frameRate: 59.8 });
    const maxFrameRate = new NetworkManager({ frameRate: 600 });
    const invalidFrameRate = new NetworkManager({ frameRate: Number.NaN });

    expect(lowFrameRate.getFrameRate()).toBe(1);
    expect(decimalFrameRate.getFrameRate()).toBe(59);
    expect(maxFrameRate.getFrameRate()).toBe(300);
    expect(invalidFrameRate.getFrameRate()).toBe(30);
  });

  it('accepts runAhead zero and ignores invalid values', () => {
    const zeroRunAhead = new NetworkManager({ runAhead: 0 });
    const invalidRunAhead = new NetworkManager({ runAhead: -1 });
    const nanRunAhead = new NetworkManager({ runAhead: Number.NaN });

    expect(zeroRunAhead.getRunAhead()).toBe(0);
    expect(invalidRunAhead.getRunAhead()).toBe(30);
    expect(nanRunAhead.getRunAhead()).toBe(30);
  });
});

describe('Network singleton lifecycle', () => {
  it('reuses the same client instance across initialize calls', () => {
    const first = initializeNetworkClient({
      localPlayerName: 'Primary',
      localPlayerID: 7,
    });
    const second = initializeNetworkClient({
      localPlayerID: 1,
      localPlayerName: 'Secondary',
    });

    expect(second).toBe(first);
    expect(first).toBe(getNetworkClient());
  });

  it('keeps singleton client state when command dispatch flows through alias', () => {
    const first = initializeNetworkClient({
      localPlayerName: 'SingletonHost',
      localPlayerID: 0,
    });
    const second = initializeNetworkClient({
      localPlayerName: 'IgnoredOptions',
      localPlayerID: 4,
    });

    expect(first).toBe(second);
    expect(getNetworkClient()).toBe(second);

    second.parseUserList({
      localPlayerName: 'SingletonHost',
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const internals = second as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = second.processIncomingCommand({
      type: 'chat',
      sender: 1,
      text: 'singleton chat',
      playerMask: 1,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'singleton chat',
      mask: 1,
    });
  });

  it('preserves local player identity once initialized', () => {
    const first = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 3,
    });

    expect(first.getLocalPlayerID()).toBe(3);
    expect(first.getPlayerName(3)).toBe('Host');
  });
});

describe('Network file transfer helpers', () => {
  it('normalizes empty paths to zero progress', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.sendFileAnnounce('   ')).toBe(0);
    expect(manager.getFileTransferProgress(0, '   ')).toBe(0);
    expect(manager.getFileTransferProgress(0, 'unannounced/file.bin')).toBe(0);
  });

  it('progress can be queried for any slot when transfer exists', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const announceId = manager.sendFileAnnounce('assets/map.cnc', 0b10);
    expect(announceId).toBe(1);

    expect(manager.getFileTransferProgress(1, 'assets/map.cnc')).toBe(0);
    expect(manager.getFileTransferProgress(2, 'assets/map.cnc')).toBe(100);

    manager.sendFile('assets/map.cnc', 0xff, announceId);

    expect(manager.getFileTransferProgress(0, 'assets/map.cnc')).toBe(100);
    expect(manager.getFileTransferProgress(2, 'assets/map.cnc')).toBe(100);
  });

  it('initializes progress from announce recipient mask and marks completion on send', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const announceId = manager.sendFileAnnounce('assets/map.cnc', 0b00000010);

    expect(manager.getFileTransferProgress(0, 'assets/map.cnc')).toBe(100);
    expect(manager.getFileTransferProgress(1, 'assets/map.cnc')).toBe(0);
    expect(manager.getFileTransferProgress(2, 'assets/map.cnc')).toBe(100);

    manager.sendFile('assets/map.cnc', 0xff, announceId);

    expect(manager.getFileTransferProgress(0, 'assets/map.cnc')).toBe(100);
    expect(manager.getFileTransferProgress(1, 'assets/map.cnc')).toBe(100);
  });

  it('reports queues as empty only when frame queue is empty', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      frameQueueReady: Set<number>;
    };

    expect(manager.areAllQueuesEmpty()).toBe(true);

    const announceId = manager.sendFileAnnounce('assets/map.cnc', 1 << 0);
    manager.sendFile('assets/map.cnc', 0xff, announceId);

    expect(manager.getFileTransferProgress(0, 'assets/map.cnc')).toBe(100);
    expect(manager.getFileTransferProgress(1, 'assets/map.cnc')).toBe(100);
    expect(manager.areAllQueuesEmpty()).toBe(true);

    internals.frameQueueReady.add(123);
    expect(manager.areAllQueuesEmpty()).toBe(false);

    internals.frameQueueReady.clear();
    expect(manager.areAllQueuesEmpty()).toBe(true);
  });
});

describe('Network chat helpers', () => {
  it('sends disconnect chat using a mask that excludes the local slot', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 1,
    });

    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    manager.sendDisconnectChat('disconnecting');

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'disconnecting',
      mask: 0xfd,
    });
  });
});

describe('Network transport metrics', () => {
  it('forwards incoming byte metrics to attached transport when available', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const transport = {
      getIncomingBytesPerSecond: () => 128,
      getIncomingPacketsPerSecond: () => 4,
      getOutgoingBytesPerSecond: () => 256,
      getOutgoingPacketsPerSecond: () => 8,
      getUnknownBytesPerSecond: () => 16,
      getUnknownPacketsPerSecond: () => 2,
    };

    manager.attachTransport(transport);

    expect(manager.getIncomingBytesPerSecond()).toBe(128);
    expect(manager.getIncomingPacketsPerSecond()).toBe(4);
    expect(manager.getOutgoingBytesPerSecond()).toBe(256);
    expect(manager.getOutgoingPacketsPerSecond()).toBe(8);
    expect(manager.getUnknownBytesPerSecond()).toBe(16);
    expect(manager.getUnknownPacketsPerSecond()).toBe(2);
  });

  it('falls back to zero for transport metrics when transport is absent', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.getIncomingBytesPerSecond()).toBe(0);
    expect(manager.getIncomingPacketsPerSecond()).toBe(0);
    expect(manager.getOutgoingBytesPerSecond()).toBe(0);
    expect(manager.getOutgoingPacketsPerSecond()).toBe(0);
    expect(manager.getUnknownBytesPerSecond()).toBe(0);
    expect(manager.getUnknownPacketsPerSecond()).toBe(0);
  });
});

describe('Network per-slot FPS metrics', () => {
  it('defaults packet-router identity to slot 0 after initialization', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 3,
    });

    manager.init();
    manager.setSlotAverageFPS(0, 58);

    expect(manager.getSlotAverageFPS(0)).toBe(58);
    expect(manager.getSlotAverageFPS(3)).toBe(-1);
  });

  it('resets packet-router and per-slot fps data in reset', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 1,
    });

    manager.init();
    manager.setPacketRouterSlot(1);
    manager.setSlotAverageFPS(0, 45);
    expect(manager.getSlotAverageFPS(0)).toBe(45);

    manager.reset();

    expect(manager.getSlotAverageFPS(0)).toBe(-1);
    expect(manager.getSlotAverageFPS(1)).toBe(-1);
  });

  it('returns -1 for invalid slots', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.getSlotAverageFPS(-1)).toBe(-1);
    expect(manager.getSlotAverageFPS(16)).toBe(-1);
    expect(manager.getSlotAverageFPS(17)).toBe(-1);
  });

  it('returns -1 for the local slot when this client is not packet router', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    expect(manager.getSlotAverageFPS(0)).toBe(-1);
  });

  it('returns stored fps data for local slot when this client is packet router', () => {
    const manager = new NetworkManager({
      localPlayerName: 'RouterHost',
      localPlayerID: 2,
    });

    manager.setPacketRouterSlot(2);
    manager.setSlotAverageFPS(2, 55);

    expect(manager.getSlotAverageFPS(2)).toBe(55);
  });

  it('returns stored fps data for remote slot entries when available', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.setSlotAverageFPS(5, 60);

    expect(manager.getSlotAverageFPS(5)).toBe(60);
  });

  it('accepts packet router slot from parsed user list metadata', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const game = {
      localSlotNum: 0,
      packetRouterSlot: 2,
      getNumPlayers: () => 4,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    };

    manager.parseUserList(game);
    manager.setSlotAverageFPS(2, 40);

    expect(manager.getSlotAverageFPS(2)).toBe(40);
  });

  it('applies run ahead metrics updates from message payloads', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    manager.processRunAheadMetricsCommand({
      player: 1,
      avgFps: 125,
      averageLatency: 0.25,
    });

    expect(manager.getSlotAverageFPS(1)).toBe(100);
  });

  it('ignores run ahead metrics for disconnected players', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });
    manager.selfDestructPlayer(1);

    manager.processRunAheadMetricsCommand({
      getPlayerID: () => 1,
      getAverageFPS: () => 42,
      getAverageLatency: () => 0.1,
    });

    expect(manager.getSlotAverageFPS(1)).toBe(-1);
  });

  it('stores run ahead latency metrics from payloads', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    manager.processRunAheadMetricsCommand({
      player: 1,
      averageFps: 75,
      averageLatency: 0.33,
    });

    expect(manager.getSlotAverageLatency(1)).toBeCloseTo(0.33);
  });

  it('ignores run ahead latency metrics without a valid latency value', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    manager.processRunAheadMetricsCommand({
      player: 1,
      averageFps: 40,
      averageLatency: 'n/a',
    });

    expect(manager.getSlotAverageLatency(1)).toBe(-1);
  });

  it('routes run-ahead metrics via incoming command dispatch', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      commandType: 6,
      player: 1,
      avgFps: 85,
      averageLatency: 0.4,
    });

    expect(handled).toBe(true);
    expect(manager.getSlotAverageFPS(1)).toBe(85);
  });

  it('ignores unknown command types in incoming command dispatch', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const unknownHandled = manager.processIncomingCommand({
      commandType: 999,
      player: 0,
      text: 'hello',
    });

    expect(unknownHandled).toBe(false);
    expect(manager.getSlotAverageFPS(0)).toBe(-1);
  });

  it('accepts string typed run-ahead command envelopes', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      type: 'runAheadMetrics',
      playerID: 1,
      averageFps: '120',
    });

    expect(handled).toBe(true);
    expect(manager.getSlotAverageFPS(1)).toBe(100);
  });

  it('accepts commandType text aliases for chat commands', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'chat',
      sender: 2,
      text: 'alias chat text',
      playerMask: 3,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 2,
      text: 'alias chat text',
      mask: 3,
    });
  });

  it('accepts frameresendrequest command type aliases in text form', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
    };

    const beforeNotices = internals.pendingFrameNotices;
    const handled = manager.processIncomingCommand({
      commandType: 'netcommandtype_frameResendRequest',
      sender: 1,
    });

    expect(handled).toBe(true);
    expect(internals.pendingFrameNotices).toBe(beforeNotices + 1);
    expect(manager.isFrameDataReady()).toBe(false);
  });

  it('accepts command type aliases from kind field', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      kind: 'chat',
      sender: 4,
      text: 'kind chat text',
      playerMask: 12,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 4,
      text: 'kind chat text',
      mask: 12,
    });
  });

  it('accepts command type aliases from netCommandType field', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      netCommandType: 'disconnectchat',
      playerID: 1,
      text: 'disconnect via netCommandType',
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'disconnect via netCommandType',
      mask: 0,
    });
  });

  it('accepts command type from getCommandType method', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const command = {
      getCommandType: () => 'chat',
      sender: 5,
      text: 'getter chat text',
      playerMask: 7,
    };

    const handled = manager.processIncomingCommand(command);

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 5,
      text: 'getter chat text',
      mask: 7,
    });
  });

  it('accepts command type from getNetCommandType method', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const command = {
      getNetCommandType: () => 'disconnectchat',
      playerID: 2,
      text: 'getter disconnect chat text',
    };

    const handled = manager.processIncomingCommand(command);

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 2,
      text: 'getter disconnect chat text',
      mask: 0,
    });
  });

  it('accepts command type aliases for no-op native packets', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const aliases = [
      'ackboth',
      'ackstage1',
      'ackstage2',
      'gamecommand',
      'manglerquery',
      'manglerresponse',
    ] as const;

    for (const alias of aliases) {
      expect(manager.processIncomingCommand({ type: alias })).toBe(true);
    }

    expect(manager.getRunAhead()).toBe(30);
    expect(manager.getFrameRate()).toBe(30);
  });

  it('prefers numeric commandType over text-based aliases', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
      pendingFrameNotices: number;
    };

    const handledChat = manager.processIncomingCommand({
      type: 'disconnectchat',
      commandType: 11,
      sender: 1,
      text: 'numeric commandType should win',
    });
    const handledFrame = manager.processIncomingCommand({
      type: 'chat',
      commandType: 21,
      sender: 1,
    });

    expect(handledChat).toBe(true);
    expect(handledFrame).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'numeric commandType should win',
      mask: 0,
    });
    expect(internals.pendingFrameNotices).toBe(1);
  });

  it('prefers commandType property over getter method alias', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
      pendingFrameNotices: number;
    };

    const handled = manager.processIncomingCommand({
      getCommandType: () => 'disconnectchat',
      commandType: 21,
      playerID: 1,
      text: 'frame resend should still win',
    });

    expect(handled).toBe(true);
    expect(internals.pendingFrameNotices).toBe(1);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('accepts numeric command type provided as string', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      netCommandType: '11',
      kind: 'disconnectchat',
      sender: 3,
      text: 'string numeric commandType',
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 3,
      text: 'string numeric commandType',
      mask: 0,
    });
  });
});

describe('Network incoming command handlers', () => {
  it('marks frame info as ready without inserting sender slot IDs into frame queue', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      frameQueueReady: Set<number>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 3,
      sender: 2,
      frame: 7,
      commandCount: 4,
    });

    expect(handled).toBe(true);
    expect(internals.frameQueueReady.has(7)).toBe(true);
    expect(internals.frameQueueReady.has(2)).toBe(false);
    expect(manager.isFrameDataReady()).toBe(true);
  });

  it('handles disconnect chat messages via command dispatch', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      type: 'disconnectchat',
      playerID: 1,
      text: 'disconnecting now',
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'disconnecting now',
      mask: 0,
    });
  });

  it('handles public chat messages via command dispatch', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      type: 'chat',
      player: 1,
      text: 'hi there',
      playerMask: 3,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'hi there',
      mask: 3,
    });
  });

  it('applies runahead settings from runahead command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const handled = manager.processIncomingCommand({
      commandType: 'runahead',
      player: 1,
      newRunAhead: 12,
      newFrameRate: 120,
    });

    expect(handled).toBe(true);
    expect(manager.getRunAhead()).toBe(12);
    expect(manager.getFrameRate()).toBe(120);
  });

  it('accepts runahead command fields via getter-style aliases', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const message = {
      commandType: '7',
      getRunAhead: () => 16,
      getFrameRate: () => '90',
    };

    const handled = manager.processIncomingCommand(message);

    expect(handled).toBe(true);
    expect(manager.getRunAhead()).toBe(16);
    expect(manager.getFrameRate()).toBe(90);
  });

  it('disconnects players when player leave command arrives', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 4,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      type: 'playerleave',
      leavingPlayerID: 1,
    });

    expect(handled).toBe(true);
    expect(manager.isPlayerConnected(1)).toBe(false);
  });

  it('disconnects players when destroyplayer command arrives', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 4,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      commandType: 8,
      playerIndex: 2,
    });

    expect(handled).toBe(true);
    expect(manager.isPlayerConnected(2)).toBe(false);
  });

  it('applies load progress updates from progress commands', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    manager.updateLoadProgress(0);
    const handled = manager.processIncomingCommand({
      commandType: 14,
      player: 0,
      percentage: '77',
    });

    expect(handled).toBe(true);
    expect(manager.getLoadProgress()).toBe(77);
  });

  it('starts timeout notices from timeoutstart command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
    };

    manager.init();
    const beforeNotices = internals.pendingFrameNotices;
    const handled = manager.processIncomingCommand({
      type: 'timeoutstart',
      sender: 0,
    });

    expect(handled).toBe(true);
    expect(internals.pendingFrameNotices).toBe(beforeNotices + 1);
  });

  it('marks load complete from loadcomplete command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    manager.updateLoadProgress(24);
    const handled = manager.processIncomingCommand({
      type: 'loadcomplete',
    });

    expect(handled).toBe(true);
    expect(manager.getLoadProgress()).toBe(100);
  });

  it('tracks incoming file command and completion state by sender', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const handled = manager.processIncomingCommand({
      commandType: 18,
      commandId: 42,
      sender: 1,
      playerMask: 0b1110,
      path: 'assets/patch.bin',
    });

    expect(handled).toBe(true);
    expect(manager.getFileTransferProgress(1, 'assets/patch.bin')).toBe(100);
    expect(manager.getFileTransferProgress(2, 'assets/patch.bin')).toBe(100);
  });

  it('tracks incoming file announce and recipient masks', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const handled = manager.processIncomingCommand({
      commandType: 19,
      commandId: 55,
      path: 'assets/map.bin',
      playerMask: 0b010,
    });

    expect(handled).toBe(true);
    expect(manager.getFileTransferProgress(0, 'assets/map.bin')).toBe(100);
    expect(manager.getFileTransferProgress(1, 'assets/map.bin')).toBe(0);
    expect(manager.getFileTransferProgress(2, 'assets/map.bin')).toBe(100);
  });

  it('updates file transfer progress for a sender from fileprogress', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const announceId = manager.sendFileAnnounce('assets/map.bin', 0b1111);
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      type: 'fileprogress',
      commandId: announceId,
      sender: 1,
      progress: 37,
    });

    expect(handled).toBe(true);
    expect(manager.getFileTransferProgress(1, 'assets/map.bin')).toBe(37);
  });

  it('acknowledges frame resend requests', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
    };

    const beforeNotices = internals.pendingFrameNotices;
    const handled = manager.processIncomingCommand({
      commandType: 21,
      sender: 1,
    });

    expect(handled).toBe(true);
    expect(manager.isFrameDataReady()).toBe(false);
    expect(internals.pendingFrameNotices).toBe(beforeNotices + 1);
  });

  it('serves frame resend request for connected remote sender when frame is provided', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    const internals = manager as unknown as {
      pendingFrameNotices: number;
      sendFrameDataToPlayer: (playerId: number, frame: number) => void;
    };
    const resendCalls: Array<{ playerId: number; frame: number }> = [];
    internals.sendFrameDataToPlayer = (playerId: number, frame: number) => {
      resendCalls.push({ playerId, frame });
    };

    const beforeNotices = internals.pendingFrameNotices;
    const handled = manager.processIncomingCommand({
      commandType: 21,
      sender: 1,
      frameToResend: 13,
    });

    expect(handled).toBe(true);
    expect(resendCalls).toEqual([{ playerId: 1, frame: 13 }]);
    expect(internals.pendingFrameNotices).toBe(beforeNotices);
  });

  it('does not serve frame resend request for local sender and ignores pending notice', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
      sendFrameDataToPlayer: (playerId: number, frame: number) => void;
    };
    const resendCalls: Array<{ playerId: number; frame: number }> = [];
    internals.sendFrameDataToPlayer = (playerId: number, frame: number) => {
      resendCalls.push({ playerId, frame });
    };

    const beforeNotices = internals.pendingFrameNotices;
    const handled = manager.processIncomingCommand({
      commandType: 21,
      sender: 0,
      frameToResend: 13,
    });

    expect(handled).toBe(true);
    expect(resendCalls).toEqual([]);
    expect(internals.pendingFrameNotices).toBe(beforeNotices);
  });

  it('consumes packet router query commands as no-op marker packets', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const beforeSlot = manager.getPacketRouterSlot();
    const handled = manager.processIncomingCommand({
      commandType: 25,
      sender: 3,
    });

    expect(handled).toBe(true);
    expect(manager.getPacketRouterSlot()).toBe(beforeSlot);
  });

  it('tracks packet-router query sender when local slot matches packet router', () => {
    const packetRouterAckTargets: Array<[number, number]> = [];
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 2,
      packetRouterEvents: {
        onPacketRouterQueryReceived: (querySender, packetRouterSlot) => {
          packetRouterAckTargets.push([querySender, packetRouterSlot]);
        },
      },
    });
    manager.setPacketRouterSlot(2);

    const handled = manager.processIncomingCommand({
      type: 'packetrouterquery',
      sender: 3,
    });

    expect(handled).toBe(true);
    expect(manager.getLastPacketRouterQuerySender()).toBe(3);
    expect(manager.getLastPacketRouterAckSender()).toBe(3);
    expect(packetRouterAckTargets).toEqual([[3, 2]]);
  });

  it('forwards packet-router query as packet-router ack back through transport', () => {
    let sentCommand: Record<string, unknown> | null = null;
    let sentMask = 0;
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 2,
    });
    manager.setPacketRouterSlot(2);
    manager.attachTransport({
      sendLocalCommandDirect: (command, relayMask: number): void => {
        sentCommand = command as Record<string, unknown>;
        sentMask = relayMask;
      },
    });

    const handled = manager.processIncomingCommand({
      commandType: NETCOMMANDTYPE_PACKETROUTERQUERY,
      sender: 5,
    });

    expect(handled).toBe(true);
    expect(sentCommand).not.toBeNull();
    expect(sentMask).toBe(1 << 5);
    expect(sentCommand?.commandType).toBe(NETCOMMANDTYPE_PACKETROUTERACK);
    expect(sentCommand?.type).toBe('packetrouterack');
    expect(sentCommand?.sender).toBe(2);
  });

  it('does not forward packet-router query as ack when local slot does not match packet router', () => {
    let sentCount = 0;
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 2,
    });
    manager.setPacketRouterSlot(4);
    manager.attachTransport({
      sendLocalCommandDirect: () => {
        sentCount += 1;
      },
    });

    const handled = manager.processIncomingCommand({
      type: 'packetrouterquery',
      sender: 5,
    });

    expect(handled).toBe(true);
    expect(sentCount).toBe(0);
  });

  it('accepts packet-router query command type names', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const beforeSlot = manager.getPacketRouterSlot();
    const handled = manager.processIncomingCommand({
      type: 'packetrouterquery',
      player: 2,
    });

    expect(handled).toBe(true);
    expect(manager.getPacketRouterSlot()).toBe(beforeSlot);
  });

  it('consumes packet router ack commands as no-op marker packets', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const beforeSlot = manager.getPacketRouterSlot();
    const handled = manager.processIncomingCommand({
      type: 'packetrouterack',
      playerID: 3,
    });

    expect(handled).toBe(true);
    expect(manager.getPacketRouterSlot()).toBe(beforeSlot);
  });

  it('accepts packet-router ack commands and tracks matching sender', () => {
    const ackNotifications: Array<[number, number]> = [];
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 2,
      packetRouterEvents: {
        onPacketRouterAckReceived: (ackSender, packetRouterSlot) => {
          ackNotifications.push([ackSender, packetRouterSlot]);
        },
      },
    });
    manager.setPacketRouterSlot(2);

    const ignored = manager.processIncomingCommand({
      type: 'packetrouterack',
      playerID: 3,
    });
    const handled = manager.processIncomingCommand({
      type: 'packetrouterack',
      sender: 2,
    });

    expect(ignored).toBe(true);
    expect(handled).toBe(true);
    expect(manager.getLastPacketRouterAckSender()).toBe(2);
    expect(ackNotifications).toEqual([[2, 2]]);
  });

  it('resets packet-router wait timeout baseline on matching packet-router ack', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 2,
    });
    manager.setPacketRouterSlot(2);

    const internals = manager as unknown as {
      frameState: {
        getPacketRouterTimeoutResetMs: () => number | null;
        evaluateWaitForPacketRouter: (
          nowMs: number,
          playerTimeoutMs: number,
        ) => { remainingMs: number; timedOut: boolean };
      };
    };

    expect(internals.frameState.getPacketRouterTimeoutResetMs()).toBeNull();
    expect(manager.processIncomingCommand({
      type: 'packetrouterack',
      sender: 2,
    })).toBe(true);

    const timeoutResetMs = internals.frameState.getPacketRouterTimeoutResetMs();
    expect(timeoutResetMs).not.toBeNull();

    const baseline = timeoutResetMs ?? 0;
    expect(internals.frameState.evaluateWaitForPacketRouter(baseline + 1, 10)).toEqual({
      remainingMs: 9,
      timedOut: false,
    });
    expect(internals.frameState.evaluateWaitForPacketRouter(baseline + 11, 10)).toEqual({
      remainingMs: 0,
      timedOut: true,
    });
  });

  it('switches disconnect continuation screen on packet-router ack and clears on ready frame', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.setPacketRouterSlot(1);
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: slotNum === 0 ? 'Host' : 'Peer',
          isHuman: true,
        };
      },
    });

    const internals = manager as unknown as {
      frameState: { getDisconnectContinuationState: () => string };
      pendingFrameNotices: number;
    };

    expect(internals.frameState.getDisconnectContinuationState()).toBe('screen-off');
    expect(manager.processIncomingCommand({
      type: 'packetrouterack',
      sender: 1,
    })).toBe(true);
    expect(internals.frameState.getDisconnectContinuationState()).toBe('screen-on');

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 1,
      frame: 0,
      commandCount: 1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 1,
      executionFrame: 0,
      commandId: 1200,
    })).toBe(true);

    expect(manager.isFrameDataReady()).toBe(true);
    expect(internals.frameState.getDisconnectContinuationState()).toBe('screen-off');
    expect(internals.pendingFrameNotices).toBe(1);
  });

  it('unwraps wrapper commands for dispatch to inner command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 17,
      wrapped: {
        commandType: 11,
        sender: 1,
        text: 'wrapped chat',
        playerMask: 1,
      },
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'wrapped chat',
      mask: 1,
    });
  });

  it('applies command type resolution rules to wrapped object commands', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const wrapped = {
      commandType: 'chat',
      getCommandType: () => 21,
      sender: 9,
      text: 'wrapped getter should prefer numeric',
      playerMask: 1,
    };
    const handled = manager.processIncomingCommand({
      type: 'wrapper',
      wrapped,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 9,
      text: 'wrapped getter should prefer numeric',
      mask: 1,
    });
    expect(internals.pendingFrameNotices).toBe(0);
  });

  it('prioritizes direct wrapped object dispatch when chunk metadata is also present', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrappedCmdId: 0x4d2,
      chunkNumber: '0',
      numChunks: '99',
      totalDataLength: 10,
      dataOffset: 99,
      dataLength: 3,
      data: buildChatNetCommandBytes('x', 1, 1),
      wrapped: {
        type: 'chat',
        sender: 9,
        text: 'wrapped object should win over chunk metadata',
        playerMask: 5,
      },
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 9,
      text: 'wrapped object should win over chunk metadata',
      mask: 5,
    });
  });

  it('prioritizes direct wrapped object dispatch when zero-chunk wrapper metadata is present', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrappedCmdId: 0x4d3,
      chunkNumber: 0,
      numChunks: 0,
      totalDataLength: 0,
      dataOffset: 0,
      dataLength: 0,
      data: new Uint8Array(),
      wrapped: {
        type: 'chat',
        sender: 7,
        text: 'wrapped object should win over zero-chunk metadata',
        playerMask: 2,
      },
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 7,
      text: 'wrapped object should win over zero-chunk metadata',
      mask: 2,
    });
  });

  it('uses valid wrapped object when object metadata fields are malformed', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrapped: {
          type: 'chat',
          sender: 9,
          text: 'malformed metadata should be ignored',
          playerMask: 6,
        },
        wrappedCommandId: 0x5006,
        chunkNumber: 'bad',
        numChunks: -1,
        totalDataLength: 'bad',
        data: new Uint8Array([0xAA]),
        dataOffset: -1,
        dataLength: 1,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5006)).toBe(false);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 9,
      text: 'malformed metadata should be ignored',
      mask: 6,
    });
  });

  it('uses wrapped command over command alias when both are present', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
      pendingFrameNotices: number;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      command: {
        type: 'chat',
        sender: 7,
        text: 'wrapper should use command field',
        playerMask: 2,
      },
      wrapped: {
        commandType: 'chat',
        sender: 8,
        text: 'wrapped command wins over command field',
        playerMask: 3,
      },
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 8,
      text: 'wrapped command wins over command field',
      mask: 3,
    });
    expect(internals.pendingFrameNotices).toBe(0);
  });

  it('resolves wrapped object commandType from wrapped netCommandType field', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'netcommandtype_wrapper',
      wrapped: {
        netCommandType: 'chat',
        sender: 6,
        text: 'wrapped netCommandType alias chat',
        playerMask: 9,
      },
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 6,
      text: 'wrapped netCommandType alias chat',
      mask: 9,
    });
  });

  it('resolves wrapped object commandType from getNetCommandType method', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        getNetCommandType: () => 'chat',
        sender: 1,
        text: 'wrapped getter getNetCommandType alias chat',
        playerMask: 3,
      },
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'wrapped getter getNetCommandType alias chat',
      mask: 3,
    });
  });

  it('processes wrapped runahead command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        type: 'runahead',
        newRunAhead: 33,
        newFrameRate: 75,
      },
    });

    expect(handled).toBe(true);
    expect(manager.getRunAhead()).toBe(33);
    expect(manager.getFrameRate()).toBe(75);
  });

  it('processes wrapped playerleave command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 4,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        commandType: 'playerleave',
        slot: 2,
      },
    });

    expect(handled).toBe(true);
    expect(manager.isPlayerConnected(2)).toBe(false);
  });

  it('processes wrapped destroyplayer command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 4,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const handled = manager.processIncomingCommand({
      type: 'wrapper',
      wrapped: {
        netCommandType: 'destroyplayer',
        playerIndex: 3,
      },
    });

    expect(handled).toBe(true);
    expect(manager.isPlayerConnected(3)).toBe(false);
  });

  it('processes runahead command from binary wrapper payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const wrapped = buildWrapperMessageChunks(buildRunaheadNetCommandBytes(28, 90), 0x6f6f, 64)[0];

    const handled = manager.processIncomingCommand(wrapped);

    expect(handled).toBe(true);
    expect(manager.getRunAhead()).toBe(28);
    expect(manager.getFrameRate()).toBe(90);
  });

  it('processes runahead metrics from binary wrapper payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const wrapped = buildWrapperMessageChunks(
      buildRunaheadMetricsNetCommandBytes(0.42, 84, 1),
      0x6f6f,
      64,
    )[0];

    const handled = manager.processIncomingCommand(wrapped);

    expect(handled).toBe(true);
    expect(manager.getSlotAverageFPS(1)).toBe(84);
    expect(manager.getSlotAverageLatency(1)).toBeCloseTo(0.42);
  });

  it('does not update metrics when wrapped runahead-metrics lacks sender', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    const initialHandled = manager.processIncomingCommand({
      type: 'runaheadmetrics',
      sender: 1,
      averageFps: 40,
      averageLatency: 0.1,
    });
    expect(initialHandled).toBe(true);
    expect(manager.getSlotAverageFPS(1)).toBe(40);
    expect(manager.getSlotAverageLatency(1)).toBeCloseTo(0.1);

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        type: 'runaheadmetrics',
        averageFps: 90,
        averageLatency: 0.9,
      },
    });

    expect(handled).toBe(true);
    expect(manager.getSlotAverageFPS(1)).toBe(40);
    expect(manager.getSlotAverageLatency(1)).toBeCloseTo(0.1);
  });

  it('does not update runahead metrics from senderless binary wrapped payloads', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localSlotNum: 0,
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => ({
        id: slotNum,
        name: `Player ${slotNum + 1}`,
        isHuman: true,
      }),
    });

    expect(
      manager.processIncomingCommand({
        type: 'runaheadmetrics',
        sender: 1,
        averageFps: 40,
        averageLatency: 0.1,
      }),
    ).toBe(true);

    expect(manager.getSlotAverageFPS(1)).toBe(40);
    expect(manager.getSlotAverageLatency(1)).toBeCloseTo(0.1);

    const wrapped = buildWrapperMessageChunks(
      buildRunaheadMetricsNetCommandBytes(0.42, 90),
      0x6f6e,
      64,
    )[0];

    const handled = manager.processIncomingCommand(wrapped);

    expect(handled).toBe(true);
    expect(manager.getSlotAverageFPS(1)).toBe(40);
    expect(manager.getSlotAverageLatency(1)).toBeCloseTo(0.1);
  });

  it('prefers wrapped commandType numeric string over wrapped getNetCommandType alias', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getLocalSlotNum: () => 0,
      getNumPlayers: () => 5,
      getSlot: (slotNum: number) => {
        if (slotNum > 4) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
      pendingFrameNotices: number;
    };

    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        commandType: '21',
        getNetCommandType: () => 'chat',
        sender: 4,
        text: 'wrapped numeric alias vs method should dispatch numeric',
      },
    });

    expect(handled).toBe(true);
    expect(internals.pendingFrameNotices).toBe(1);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('does not dispatch wrapped command when wrapped object is non-object', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const wrappedBytes = buildChatNetCommandBytes('chat', 1, 1);
    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: 17,
      wrappedCommandId: 0x1000,
      data: wrappedBytes,
      chunkNumber: 0,
      numChunks: 1,
      totalDataLength: wrappedBytes.length,
      dataLength: wrappedBytes.length,
      dataOffset: 0,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'chat',
      mask: 1,
    });
  });

  it('falls back to chunk metadata when wrapped object has unknown command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      pendingFrameNotices: number;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const wrappedBytes = buildChatNetCommandBytes('wrapped fallback', 1, 1);
    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        commandType: 'not-a-command',
        sender: 7,
        text: 'ignored wrapped should fall back',
      },
      wrappedCmdID: 0x1001,
      data: wrappedBytes,
      chunkNumber: 0,
      numChunks: 1,
      totalDataLength: wrappedBytes.length,
      dataLength: wrappedBytes.length,
      dataOffset: 0,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'wrapped fallback',
      mask: 1,
    });
    expect(internals.pendingFrameNotices).toBe(0);
  });

  it('falls back to chunk metadata when wrapped commandType is an unknown numeric string', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });

    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const wrappedBytes = buildChatNetCommandBytes('numeric-string fallback', 2, 5);
    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {
        commandType: '999',
        sender: 8,
        text: 'ignored wrapped should fall back',
      },
      wrappedCmdId: 0x1003,
      data: wrappedBytes,
      chunkNumber: 0,
      numChunks: 1,
      totalDataLength: wrappedBytes.length,
      dataLength: wrappedBytes.length,
      dataOffset: 0,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 2,
      text: 'numeric-string fallback',
      mask: 5,
    });
  });

  it('falls back to chunk metadata when inner object has unknown command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
      pendingFrameNotices: number;
    };

    const wrappedBytes = buildChatNetCommandBytes('inner fallback', 4, 1);
    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      inner: {
        commandType: 'not-a-command',
        sender: 1,
        text: 'ignored inner should fall back',
      },
      wrappedCmdId: 0x1010,
      payload: wrappedBytes,
      chunkNumber: 0,
      numChunks: 1,
      totalDataLength: wrappedBytes.length,
      dataLength: wrappedBytes.length,
      dataOffset: 0,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 4,
      text: 'inner fallback',
      mask: 1,
    });
    expect(internals.pendingFrameNotices).toBe(0);
  });

  it('falls back to chunk metadata when wrapped object is empty', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const wrappedBytes = buildChatNetCommandBytes('wrapped empty fallback', 3, 4);
    const handled = manager.processIncomingCommand({
      commandType: 'wrapper',
      wrapped: {},
      wrappedCmdId: 0x1002,
      data: wrappedBytes,
      chunkNumber: 0,
      numChunks: 1,
      totalDataLength: wrappedBytes.length,
      dataLength: wrappedBytes.length,
      dataOffset: 0,
    });

    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 3,
      text: 'wrapped empty fallback',
      mask: 4,
    });
  });

  it('safely ignores malformed object-wrapper metadata', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(() => {
      const handled = manager.processIncomingCommand({
        commandType: 17,
        wrappedCommandID: -1,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: 10,
        dataOffset: 0,
        data: buildChatNetCommandBytes('wrapped chat', 1, 1),
      });
      expect(handled).toBe(true);
    }).not.toThrow();

    expect(manager.processIncomingCommand({
      commandType: 17,
      wrappedCommandID: 1,
      chunkNumber: 0,
      numChunks: 1,
      totalDataLength: 4,
      dataOffset: 0,
      dataLength: 4,
      data: buildChatNetCommandBytes('x', 1, 1).slice(0, 1),
    })).toBe(true);

    expect(manager.processIncomingCommand({
      commandType: 17,
      wrappedCommandID: 1,
      chunkNumber: 0,
      numChunks: 2,
      totalDataLength: 5,
      dataOffset: 10,
      dataLength: 2,
      data: buildChatNetCommandBytes('ab', 1, 1),
    })).toBe(true);

    expect(internals.chatHistory).toHaveLength(0);
  });

  it('safely ignores object-wrapper chunk when data exceeds declared total length', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('wrapped overflow', 1, 1);

    expect(
      manager.processIncomingCommand({
        commandType: 17,
        wrappedCommandID: 0x5001,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: 4,
        dataOffset: 4,
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(0);
  });

  it('safely ignores object-wrapper metadata with zero chunks', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCmdId: 0x5002,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        data: new Uint8Array([0x01]),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5002)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('accepts legacy wrapper metadata aliases in object form', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('wrapped alias chat', 1, 1);

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCmdID: 0x2222,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: wrappedCommandBytes.length,
        dataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'wrapped alias chat',
      mask: 1,
    });
  });

  it('accepts string wrapper metadata in object form', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('wrapped string field chat', 3, 7);

    expect(
      manager.processIncomingCommand({
        commandType: 'netcommandtype_wrapper',
        wrappedCmdID: `${0x4444}`,
        chunkNumber: '0',
        numChunks: '1',
        totalDataLength: `${wrappedCommandBytes.length}`,
        dataLength: `${wrappedCommandBytes.length}`,
        dataOffset: '0',
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 3,
      text: 'wrapped string field chat',
      mask: 7,
    });
  });

  it('accepts payload field as object-form wrapper chunk data', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('wrapped payload alias chat', 6, 9);

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCommandId: 0x7777,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: wrappedCommandBytes.length,
        dataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        payload: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 6,
      text: 'wrapped payload alias chat',
      mask: 9,
    });
  });

  it('accepts wrappedCommandId alias in object form', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('wrapped commandId alias chat', 4, 2);

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5555,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: wrappedCommandBytes.length,
        dataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 4,
      text: 'wrapped commandId alias chat',
      mask: 2,
    });
  });


  it('safely ignores malformed binary wrapper metadata', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrapped = makeWrappedChatCommand('this wrapped chat message is intentionally long');

    const invalidNumChunks = new Uint8Array(wrapped.chunks[0].payload);
    const invalidNumChunksView = new DataView(
      invalidNumChunks.buffer,
      invalidNumChunks.byteOffset,
      invalidNumChunks.byteLength,
    );
    invalidNumChunksView.setUint32(6, 0, true);

    const invalidOffset = new Uint8Array(wrapped.chunks[0].payload);
    const invalidOffsetView = new DataView(
      invalidOffset.buffer,
      invalidOffset.byteOffset,
      invalidOffset.byteLength,
    );
    invalidOffsetView.setUint32(6, 2, true);
    invalidOffsetView.setUint32(18, 10_000, true);

    const truncatedPayloadLength = new Uint8Array(wrapped.chunks[0].payload);
    const truncatedPayloadView = new DataView(
      truncatedPayloadLength.buffer,
      truncatedPayloadLength.byteOffset,
      truncatedPayloadLength.byteLength,
    );
    truncatedPayloadView.setUint32(14, 99_999, true);

    expect(manager.processIncomingCommand({
      commandType: 17,
      payload: invalidNumChunks,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 17,
      payload: invalidOffset,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 17,
      payload: truncatedPayloadLength,
    })).toBe(true);

    expect(internals.chatHistory).toHaveLength(0);
  });

  it('does not preserve zero-chunk object wrapper chunks', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('zero chunks should be preserved');

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5002,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        data: new Uint8Array([]),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5002)).toBe(false);

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5002,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: wrappedCommandBytes.length,
        dataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5002)).toBe(false);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      text: 'zero chunks should be preserved',
    });
  });

  it('accepts zero-chunk object wrapper chunks without data payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('zero chunks without data field');

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5003,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5003)).toBe(false);

    expect(
      manager.processIncomingCommand({
        commandType: NETCOMMANDTYPE_WRAPPER,
        wrappedCommandID: 0x5003,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: wrappedCommandBytes.length,
        dataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory[0]).toMatchObject({
      text: 'zero chunks without data field',
    });
  });

  it('accepts zero-chunk object wrapper chunks with explicit dataLength 0 and no payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('zero chunks with explicit dataLength');

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5004,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        dataLength: 0,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5004)).toBe(false);

    expect(
      manager.processIncomingCommand({
        commandType: NETCOMMANDTYPE_WRAPPER,
        wrappedCommandID: 0x5004,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: wrappedCommandBytes.length,
        dataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes,
      }),
    ).toBe(true);

    expect(internals.chatHistory[0]).toMatchObject({
      text: 'zero chunks with explicit dataLength',
    });
  });

  it('accepts zero-chunk object wrapper chunks with explicit dataLength 0 and empty payload alias', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCmdID: 0x5006,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        dataLength: 0,
        payload: new Uint8Array(),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5006)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('ignores zero-chunk object wrapper chunks with explicit dataLength mismatch and empty payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCmdId: 0x5007,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        dataLength: 1,
        data: new Uint8Array(),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5007)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('accepts zero-chunk object wrapper chunks with numeric-string field values', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: '20485',
        chunkNumber: '0',
        numChunks: '0',
        totalDataLength: '0',
        dataOffset: '0',
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(20485)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('ignores zero-chunk object wrapper chunks with explicit non-zero dataLength and no payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('zero-chunk invalid datalength');

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5005,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        dataLength: wrappedCommandBytes.length,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5005)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('ignores zero-chunk object wrapper chunks with payload alias and non-zero dataLength', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x5008,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        dataLength: 4,
        payload: new Uint8Array([1, 2, 3, 4]),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5008)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('does not preserve zero-chunk binary wrapper payloads', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('zero chunks binary payload');

    const zeroPayload = buildWrapperChunkPayload(0x5003, 0, 0, 0, 0, new Uint8Array());

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        payload: zeroPayload,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5003)).toBe(false);

    expect(
      manager.processIncomingCommand({
        commandType: NETCOMMANDTYPE_WRAPPER,
        payload: buildWrapperChunkPayload(
          0x5003,
          0,
          1,
          wrappedCommandBytes.length,
          0,
          wrappedCommandBytes,
        ),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x5003)).toBe(false);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      text: 'zero chunks binary payload',
    });
  });

  it('ignores malformed zero-chunk binary wrapper payloads with stray bytes', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const zeroPayloadWithBytes = buildWrapperChunkPayload(0x6004, 0, 0, 0, 0, new Uint8Array([1, 2, 3]));

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        payload: zeroPayloadWithBytes,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x6004)).toBe(false);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('does not auto-prune partial wrapper assembly state while processing a later wrapper command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const staleWrappedCommandBytes = buildChatNetCommandBytes('this wrapped command must require multiple chunks to stay incomplete', 1, 1);
    const staleWrappedChunks = buildWrapperMessageChunks(staleWrappedCommandBytes, 0x1234, 4);
    expect(staleWrappedChunks.length).toBeGreaterThan(1);

    expect(manager.processIncomingCommand(staleWrappedChunks[0])).toBe(true);
    const staleAssembly = internals.activeWrapperAssemblies.get(0x1234);
    expect(staleAssembly).toBeDefined();

    const secondWrapped = buildChatNetCommandBytes('fresh wrapper', 2, 1);
    const secondPayload = buildWrapperChunkPayload(0x7777, 0, 1, secondWrapped.length, 0, secondWrapped);

    expect(
      manager.processIncomingCommand({
        commandType: NETCOMMANDTYPE_WRAPPER,
        payload: secondPayload,
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.activeWrapperAssemblies.has(0x1234)).toBe(true);
  });

  it('keeps partial wrapper assembly state when receiving malformed zero-chunk wrapper for another command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const staleWrappedCommandBytes = buildChatNetCommandBytes('this wrapped command must stay partial', 1, 1);
    const staleWrappedChunks = buildWrapperMessageChunks(staleWrappedCommandBytes, 0x2001, 32);
    expect(staleWrappedChunks.length).toBeGreaterThan(1);

    expect(manager.processIncomingCommand(staleWrappedChunks[0])).toBe(true);
    expect(internals.activeWrapperAssemblies.has(0x2001)).toBe(true);

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x2002,
        chunkNumber: 0,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
        dataLength: staleWrappedCommandBytes.length,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x2001)).toBe(true);

    for (let i = 1; i < staleWrappedChunks.length; i += 1) {
      expect(manager.processIncomingCommand(staleWrappedChunks[i])).toBe(true);
    }

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      text: 'this wrapped command must stay partial',
      sender: 1,
      mask: 1,
    });
  });

  it('keeps partial wrapper assembly state when receiving malformed zero-chunk binary wrapper for another command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const staleWrappedCommandBytes = buildChatNetCommandBytes('binary malformed zero-chunk should not clear stale assembly', 1, 1);
    const staleWrappedChunks = buildWrapperMessageChunks(staleWrappedCommandBytes, 0x3001, 32);
    expect(staleWrappedChunks.length).toBeGreaterThan(1);

    expect(manager.processIncomingCommand(staleWrappedChunks[0])).toBe(true);
    expect(internals.activeWrapperAssemblies.has(0x3001)).toBe(true);

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        payload: buildWrapperChunkPayload(0x3002, 0, 0, 0, 0, new Uint8Array([1, 2, 3])),
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x3001)).toBe(true);

    for (let i = 1; i < staleWrappedChunks.length; i += 1) {
      expect(manager.processIncomingCommand(staleWrappedChunks[i])).toBe(true);
    }

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      text: 'binary malformed zero-chunk should not clear stale assembly',
      sender: 1,
      mask: 1,
    });
  });

  it('does not clear active partial wrapper assembly when malformed zero-chunk wrapper references same command id', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      activeWrapperAssemblies: Map<number, {
        chunkReceived: Uint8Array;
      }>;
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('same-id malformed zero-chunk should be ignored', 1, 1);
    const wrappedChunks = buildWrapperMessageChunks(wrappedCommandBytes, 0x4001, 32);
    expect(wrappedChunks.length).toBeGreaterThan(1);

    expect(manager.processIncomingCommand(wrappedChunks[0])).toBe(true);
    expect(internals.activeWrapperAssemblies.has(0x4001)).toBe(true);

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCommandId: 0x4001,
        chunkNumber: 1,
        numChunks: 0,
        totalDataLength: 0,
        dataOffset: 0,
      }),
    ).toBe(true);

    expect(internals.activeWrapperAssemblies.has(0x4001)).toBe(true);

    for (let i = 1; i < wrappedChunks.length; i += 1) {
      expect(manager.processIncomingCommand(wrappedChunks[i])).toBe(true);
    }
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      text: 'same-id malformed zero-chunk should be ignored',
      sender: 1,
      mask: 1,
    });
  });

  it('safely ignores malformed binary wrapper payloads that are too short', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const wrapped = makeWrappedChatCommand('short wrapper safety test');
    const malformedPayload = new Uint8Array(wrapped.chunks[0].payload.slice(0, 12));
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    expect(manager.processIncomingCommand({
      type: 'wrapper',
      payload: malformedPayload,
    })).toBe(true);

    expect(internals.chatHistory).toHaveLength(0);
  });

  it('does not replace partial wrapper assembly when metadata changes for same wrapped ID', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const staleCommandBytes = buildChatNetCommandBytes('this is a long wrapped chat message', 1, 1);
    const replacementBytes = buildChatNetCommandBytes('replacement wrapped chat', 2, 1);

    expect(
      manager.processIncomingCommand({
        commandType: 17,
        wrappedCommandID: 0x3333,
        chunkNumber: 0,
        numChunks: 2,
        totalDataLength: staleCommandBytes.length,
        dataOffset: 0,
        data: staleCommandBytes.subarray(0, 3),
      }),
    ).toBe(true);
    expect(internals.chatHistory).toHaveLength(0);

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCmdId: 0x3333,
        chunkNumber: 0,
        numChunks: 1,
        totalDataLength: replacementBytes.length,
        dataOffset: 0,
        dataLength: replacementBytes.length,
        data: replacementBytes,
      }),
    ).toBe(true);
    expect(internals.chatHistory).toHaveLength(0);

    expect(
      manager.processIncomingCommand({
        commandType: 17,
        wrappedCommandID: 0x3333,
        chunkNumber: 1,
        numChunks: 2,
        totalDataLength: staleCommandBytes.length,
        dataOffset: 3,
        dataLength: staleCommandBytes.length - 3,
        data: staleCommandBytes.subarray(3),
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'this is a long wrapped chat message',
      mask: 1,
    });
  });

  it('reassembles binary wrapper chunks before dispatching inner command', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrapped = makeWrappedChatCommand('this wrapped chat message is intentionally long');

    const firstHandled = manager.processIncomingCommand(wrapped.chunks[0]);
    expect(firstHandled).toBe(true);
    expect(internals.chatHistory).toHaveLength(0);

    const secondHandled = manager.processIncomingCommand(wrapped.chunks[1]);
    expect(secondHandled).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'this wrapped chat message is intentionally long',
      mask: 1,
    });
  });

  it('keeps wrapper chunks until all pieces are present', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrapped = makeWrappedChatCommand('this wrapped chat message is intentionally long');

    const handled = manager.processIncomingCommand(wrapped.chunks[0]);
    expect(handled).toBe(true);
    expect(internals.chatHistory).toHaveLength(0);
  });

  it('ignores duplicate wrapper chunks by chunk index', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrapped = makeWrappedChatCommand('this wrapped chat message is intentionally long');

    expect(manager.processIncomingCommand(wrapped.chunks[0])).toBe(true);
    expect(manager.processIncomingCommand(wrapped.chunks[0])).toBe(true);
    expect(manager.processIncomingCommand(wrapped.chunks[1])).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
  });

  it('ignores duplicate wrapper chunk metadata when chunk size changes for same index', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };

    const wrappedCommandBytes = buildChatNetCommandBytes('this wrapped chat message checks chunk conflict', 1, 1);
    const firstHalfLength = Math.ceil(wrappedCommandBytes.length / 2);

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCommandId: 0x6001,
        chunkNumber: 0,
        numChunks: 2,
        totalDataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes.subarray(0, firstHalfLength),
      }),
    ).toBe(true);

    expect(
      manager.processIncomingCommand({
        commandType: 'wrapper',
        wrappedCmdId: 0x6001,
        chunkNumber: 0,
        numChunks: 2,
        totalDataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes.subarray(0, firstHalfLength - 1),
      }),
    ).toBe(true);

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        commandType: 'wrapper',
        wrappedCmdId: 0x6001,
        chunkNumber: 1,
        numChunks: 2,
        totalDataLength: wrappedCommandBytes.length,
        dataOffset: firstHalfLength,
        data: wrappedCommandBytes.subarray(firstHalfLength),
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'this wrapped chat message checks chunk conflict',
      mask: 1,
    });
  });

  it('dispatches wrapped command when chunks overlap but still contain a full valid payload', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrappedCommandBytes = buildChatNetCommandBytes('overlapping wrapper test', 1, 1);

    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCommandId: 0x6002,
        chunkNumber: 0,
        numChunks: 2,
        totalDataLength: wrappedCommandBytes.length,
        dataOffset: 0,
        data: wrappedCommandBytes.subarray(0, 8),
      }),
    ).toBe(true);
    expect(
      manager.processIncomingCommand({
        type: 'wrapper',
        wrappedCommandId: 0x6002,
        chunkNumber: 1,
        numChunks: 2,
        totalDataLength: wrappedCommandBytes.length,
        dataOffset: 4,
        data: wrappedCommandBytes.subarray(4),
      }),
    ).toBe(true);

    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'overlapping wrapper test',
      mask: 1,
    });
  });

  it('reassembles wrapper chunks received out of order', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    const internals = manager as unknown as {
      chatHistory: Array<{ sender: number; text: string; mask: number }>;
    };
    const wrapped = makeWrappedChatCommand('this wrapped chat message is intentionally long');

    expect(wrapped.chunks).toHaveLength(2);
    expect(manager.processIncomingCommand(wrapped.chunks[1])).toBe(true);
    expect(internals.chatHistory).toHaveLength(0);
    expect(manager.processIncomingCommand(wrapped.chunks[0])).toBe(true);
    expect(internals.chatHistory).toHaveLength(1);
    expect(internals.chatHistory[0]).toMatchObject({
      sender: 1,
      text: 'this wrapped chat message is intentionally long',
      mask: 1,
    });
  });

  it('marks disconnect players and ignores keepalive/vote packets from disconnected senders', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });

    const disconnectHandled = manager.processIncomingCommand({
      type: 'disconnectplayer',
      slot: 1,
    });
    expect(disconnectHandled).toBe(true);
    expect(manager.isPlayerConnected(1)).toBe(false);

    const keepAliveHandled = manager.processIncomingCommand({
      commandType: 23,
      player: 1,
    });
    expect(keepAliveHandled).toBe(true);

    const voteHandled = manager.processIncomingCommand({
      commandType: 27,
      sender: 1,
      voteSlot: 0,
      voteFrame: 8,
    });
    const internals = manager as unknown as {
      frameState: {
        getDisconnectVoteCount: (slot: number, frame: number) => number;
        getDisconnectFrame: (playerId: number) => number;
        hasDisconnectFrameReceipt: (playerId: number) => boolean;
      };
    };
    expect(voteHandled).toBe(true);
    expect(manager.isPlayerConnected(0)).toBe(true);
    expect(internals.frameState.getDisconnectVoteCount(0, 8)).toBe(0);

    const frameHandled = manager.processIncomingCommand({
      commandType: 28,
      sender: 1,
      frame: 9,
    });
    expect(frameHandled).toBe(true);
    expect(manager.isPlayerConnected(0)).toBe(true);
    expect(internals.frameState.getDisconnectFrame(1)).toBe(9);
    expect(internals.frameState.hasDisconnectFrameReceipt(1)).toBe(true);

    const screenOffHandled = manager.processIncomingCommand({
      commandType: 29,
      sender: 1,
      newFrame: 10,
    });
    expect(screenOffHandled).toBe(true);
    expect(manager.isPlayerConnected(0)).toBe(true);
    expect(internals.frameState.getDisconnectFrame(1)).toBe(10);
    expect(internals.frameState.hasDisconnectFrameReceipt(1)).toBe(false);
    expect(internals.frameState.getDisconnectVoteCount(0, 8)).toBe(0);
  });

  it('replays archived frame commands and frame info when a peer is behind on disconnect frame', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
      frameRate: 300,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });

    manager.init();
    const internals = manager as unknown as { lastUpdateMs: number };
    for (let i = 0; i < 3; i += 1) {
      internals.lastUpdateMs = performance.now() - 1000;
      manager.update();
    }
    expect(manager.getGameFrame()).toBeGreaterThanOrEqual(3);

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });

    expect(manager.processIncomingCommand({
      commandType: 3,
      sender: 0,
      frame: 1,
      commandCount: 1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 4,
      sender: 0,
      executionFrame: 1,
      commandId: 501,
      payload: 'local-cached-command',
    })).toBe(true);

    expect(manager.processIncomingCommand({
      commandType: 28,
      sender: 1,
      frame: 1,
    })).toBe(true);
    expect(manager.processIncomingCommand({
      commandType: 28,
      sender: 0,
      frame: 2,
    })).toBe(true);

    expect(directSends.length).toBeGreaterThanOrEqual(3);

    const replayedCommand = directSends.find((entry) => {
      const command = entry.command as { commandType?: unknown; commandId?: unknown };
      return command.commandType === 4 && command.commandId === 501;
    });
    expect(replayedCommand?.relayMask).toBe(1 << 1);

    const replayedFrameInfo = directSends.find((entry) => {
      const command = entry.command as {
        commandType?: unknown;
        sender?: unknown;
        frame?: unknown;
        commandCount?: unknown;
      };
      return (
        command.commandType === 3
        && command.sender === 0
        && command.frame === 1
        && command.commandCount === 1
      );
    });
    expect(replayedFrameInfo?.relayMask).toBe(1 << 1);
    expect(typeof (replayedFrameInfo?.command as { commandId?: unknown }).commandId).toBe('number');
  });

  it('records disconnect votes from connected senders', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });

    const internals = manager as unknown as {
      frameState: {
        getDisconnectVoteCount: (slot: number, frame: number) => number;
      };
    };

    const voteHandled = manager.processIncomingCommand({
      commandType: 27,
      sender: 1,
      voteSlot: 0,
      voteFrame: 8,
    });

    expect(voteHandled).toBe(true);
    expect(internals.frameState.getDisconnectVoteCount(0, 8)).toBe(1);
  });

  it('ignores disconnect votes from senders already voted out on the current frame', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 3,
      getSlot: (slotNum: number) => {
        if (slotNum > 2) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });

    const internals = manager as unknown as {
      frameState: {
        getDisconnectVoteCount: (slot: number, frame: number) => number;
      };
    };

    manager.voteForPlayerDisconnect(1);
    expect(manager.processIncomingCommand({
      commandType: 27,
      sender: 2,
      voteSlot: 1,
      voteFrame: 0,
    })).toBe(true);
    expect(internals.frameState.getDisconnectVoteCount(1, 0)).toBe(2);

    expect(manager.processIncomingCommand({
      commandType: 27,
      sender: 1,
      voteSlot: 2,
      voteFrame: 0,
    })).toBe(true);
    expect(internals.frameState.getDisconnectVoteCount(2, 0)).toBe(0);
  });

  it('records local disconnect votes without immediate disconnect side-effects', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });

    const internals = manager as unknown as {
      frameState: {
        getDisconnectVoteCount: (slot: number, frame: number) => number;
      };
    };

    manager.voteForPlayerDisconnect(1);
    expect(internals.frameState.getDisconnectVoteCount(1, manager.getGameFrame())).toBe(1);
    expect(manager.isPlayerConnected(1)).toBe(true);

    manager.voteForPlayerDisconnect(0);
    expect(internals.frameState.getDisconnectVoteCount(0, manager.getGameFrame())).toBe(0);
  });

  it('emits disconnect vote command once per target until local vote is reset', () => {
    const manager = new NetworkManager({
      localPlayerName: 'Host',
      localPlayerID: 0,
    });
    manager.parseUserList({
      localPlayerName: 'Host',
      getNumPlayers: () => 2,
      getSlot: (slotNum: number) => {
        if (slotNum > 1) {
          return undefined;
        }
        return {
          id: slotNum,
          name: `Player ${slotNum + 1}`,
          isHuman: true,
        };
      },
    });

    const directSends: Array<{ command: unknown; relayMask: number }> = [];
    manager.attachTransport({
      sendLocalCommandDirect: (command: unknown, relayMask: number) => {
        directSends.push({ command, relayMask });
      },
    });

    manager.voteForPlayerDisconnect(1);
    expect(directSends).toHaveLength(1);
    expect(directSends[0]?.relayMask).toBe(1 << 1);
    expect(directSends[0]?.command).toMatchObject({
      commandType: 27,
      sender: 0,
      playerID: 0,
      voteSlot: 1,
      voteFrame: 0,
      commandId: 64001,
    });

    manager.voteForPlayerDisconnect(1);
    expect(directSends).toHaveLength(1);

    expect(manager.processIncomingCommand({
      commandType: 29,
      sender: 0,
      newFrame: 0,
    })).toBe(true);

    manager.voteForPlayerDisconnect(1);
    expect(directSends).toHaveLength(2);
    expect((directSends[1]?.command as { commandId?: number }).commandId).toBe(64002);
  });
});
