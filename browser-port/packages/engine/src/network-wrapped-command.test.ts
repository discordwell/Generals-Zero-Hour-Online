import { describe, expect, it } from 'vitest';

import {
  NETCOMMANDTYPE_CHAT,
  NETCOMMANDTYPE_DESTROYPLAYER,
  NETCOMMANDTYPE_DISCONNECTCHAT,
  NETCOMMANDTYPE_DISCONNECTFRAME,
  NETCOMMANDTYPE_DISCONNECTKEEPALIVE,
  NETCOMMANDTYPE_DISCONNECTPLAYER,
  NETCOMMANDTYPE_DISCONNECTSCREENOFF,
  NETCOMMANDTYPE_DISCONNECTVOTE,
  NETCOMMANDTYPE_FILE,
  NETCOMMANDTYPE_FILEANNOUNCE,
  NETCOMMANDTYPE_FILEPROGRESS,
  NETCOMMANDTYPE_FRAMEINFO,
  NETCOMMANDTYPE_FRAMERESENDREQUEST,
  NETCOMMANDTYPE_GAMECOMMAND,
  NETCOMMANDTYPE_KEEPALIVE,
  NETCOMMANDTYPE_PACKETROUTERACK,
  NETCOMMANDTYPE_PACKETROUTERQUERY,
  NETCOMMANDTYPE_PLAYERLEAVE,
  NETCOMMANDTYPE_PROGRESS,
  NETCOMMANDTYPE_RUNAHEAD,
  NETCOMMANDTYPE_RUNAHEADMETRICS,
  NETCOMMANDTYPE_WRAPPER,
} from './network-command-type.js';
import { parseNetworkWrappedCommand } from './network-wrapped-command.js';

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

function appendUtf16(bytes: number[], text: string): void {
  appendUint8(bytes, text.length);
  for (let index = 0; index < text.length; index += 1) {
    appendUint16LE(bytes, text.charCodeAt(index));
  }
}

function appendAsciiPath(bytes: number[], text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    appendUint8(bytes, text.charCodeAt(index));
  }
  appendUint8(bytes, 0);
}

function buildWrappedPayload(
  commandType: number,
  appendPayload?: (bytes: number[]) => void,
): Uint8Array {
  const bytes: number[] = [];
  appendUint8(bytes, 'T'.charCodeAt(0));
  appendUint8(bytes, commandType);
  appendUint8(bytes, 'P'.charCodeAt(0));
  appendUint8(bytes, 1);
  appendUint8(bytes, 'F'.charCodeAt(0));
  appendUint32LE(bytes, 33);
  appendUint8(bytes, 'C'.charCodeAt(0));
  appendUint16LE(bytes, 99);
  appendUint8(bytes, 'D'.charCodeAt(0));
  appendPayload?.(bytes);
  return new Uint8Array(bytes);
}

describe('network-wrapped-command', () => {
  it('parses frameinfo payload markers', () => {
    const bytes: number[] = [];
    appendUint8(bytes, 'T'.charCodeAt(0));
    appendUint8(bytes, NETCOMMANDTYPE_FRAMEINFO);
    appendUint8(bytes, 'P'.charCodeAt(0));
    appendUint8(bytes, 2);
    appendUint8(bytes, 'F'.charCodeAt(0));
    appendUint32LE(bytes, 33);
    appendUint8(bytes, 'C'.charCodeAt(0));
    appendUint16LE(bytes, 99);
    appendUint8(bytes, 'D'.charCodeAt(0));
    appendUint16LE(bytes, 7);

    expect(parseNetworkWrappedCommand(new Uint8Array(bytes))).toEqual({
      commandType: NETCOMMANDTYPE_FRAMEINFO,
      sender: 2,
      executionFrame: 33,
      commandId: 99,
      commandCount: 7,
    });
  });

  it('parses chat payload with UTF16 text and player mask', () => {
    const bytes: number[] = [];
    appendUint8(bytes, 'T'.charCodeAt(0));
    appendUint8(bytes, NETCOMMANDTYPE_CHAT);
    appendUint8(bytes, 'P'.charCodeAt(0));
    appendUint8(bytes, 1);
    appendUint8(bytes, 'D'.charCodeAt(0));
    appendUtf16(bytes, 'hi');
    appendInt32LE(bytes, 5);

    expect(parseNetworkWrappedCommand(new Uint8Array(bytes))).toEqual({
      commandType: NETCOMMANDTYPE_CHAT,
      sender: 1,
      text: 'hi',
      playerMask: 5,
    });
  });

  it('parses wrapper payload records', () => {
    const bytes: number[] = [];
    appendUint8(bytes, 'T'.charCodeAt(0));
    appendUint8(bytes, NETCOMMANDTYPE_WRAPPER);
    appendUint8(bytes, 'D'.charCodeAt(0));
    appendUint16LE(bytes, 0x4321);
    appendUint32LE(bytes, 1);
    appendUint32LE(bytes, 2);
    appendUint32LE(bytes, 8);
    appendUint32LE(bytes, 4);
    appendUint32LE(bytes, 4);
    appendUint8(bytes, 10);
    appendUint8(bytes, 11);
    appendUint8(bytes, 12);
    appendUint8(bytes, 13);

    expect(parseNetworkWrappedCommand(new Uint8Array(bytes))).toEqual({
      commandType: NETCOMMANDTYPE_WRAPPER,
      wrappedCommandID: 0x4321,
      chunkNumber: 1,
      numChunks: 2,
      totalDataLength: 8,
      dataOffset: 4,
      data: new Uint8Array([10, 11, 12, 13]),
    });
  });

  it('returns null for malformed/truncated payloads', () => {
    const bytes: number[] = [];
    appendUint8(bytes, 'T'.charCodeAt(0));
    appendUint8(bytes, NETCOMMANDTYPE_FILEANNOUNCE);
    appendUint8(bytes, 'D'.charCodeAt(0));
    appendUint8(bytes, 'a'.charCodeAt(0));
    appendUint8(bytes, 0); // path terminator
    appendUint16LE(bytes, 77); // commandId
    // missing playerMask byte

    expect(parseNetworkWrappedCommand(new Uint8Array(bytes))).toBeNull();
    expect(parseNetworkWrappedCommand(new Uint8Array())).toBeNull();
    expect(parseNetworkWrappedCommand('')).toBeNull();
  });

  it('parses gameplay-relevant command type payload matrix', () => {
    const fileBytes = new Uint8Array([9, 8, 7, 6]);
    const wrapperChunkBytes = new Uint8Array([10, 11, 12, 13]);
    const cases: Array<{
      commandType: number;
      payload: (bytes: number[]) => void;
      expected: Record<string, unknown>;
    }> = [
      {
        commandType: NETCOMMANDTYPE_FRAMEINFO,
        payload: (bytes) => appendUint16LE(bytes, 4),
        expected: { commandCount: 4 },
      },
      {
        commandType: NETCOMMANDTYPE_RUNAHEADMETRICS,
        payload: (bytes) => {
          appendFloat32(bytes, 12.5);
          appendUint16LE(bytes, 58);
        },
        expected: { averageLatency: 12.5, averageFps: 58 },
      },
      {
        commandType: NETCOMMANDTYPE_RUNAHEAD,
        payload: (bytes) => {
          appendUint16LE(bytes, 3);
          appendUint8(bytes, 30);
        },
        expected: { runAhead: 3, frameRate: 30 },
      },
      {
        commandType: NETCOMMANDTYPE_PLAYERLEAVE,
        payload: (bytes) => appendUint8(bytes, 5),
        expected: { leavingPlayerID: 5 },
      },
      {
        commandType: NETCOMMANDTYPE_DESTROYPLAYER,
        payload: (bytes) => appendUint32LE(bytes, 7),
        expected: { playerIndex: 7 },
      },
      {
        commandType: NETCOMMANDTYPE_DISCONNECTCHAT,
        payload: (bytes) => appendUtf16(bytes, 'dc'),
        expected: { text: 'dc' },
      },
      {
        commandType: NETCOMMANDTYPE_CHAT,
        payload: (bytes) => {
          appendUtf16(bytes, 'hi');
          appendInt32LE(bytes, 3);
        },
        expected: { text: 'hi', playerMask: 3 },
      },
      {
        commandType: NETCOMMANDTYPE_PROGRESS,
        payload: (bytes) => appendUint8(bytes, 77),
        expected: { percentage: 77 },
      },
      {
        commandType: NETCOMMANDTYPE_FILE,
        payload: (bytes) => {
          appendAsciiPath(bytes, 'maps/test.bin');
          appendUint32LE(bytes, fileBytes.length);
          for (const value of fileBytes) {
            appendUint8(bytes, value);
          }
        },
        expected: { path: 'maps/test.bin' },
      },
      {
        commandType: NETCOMMANDTYPE_FILEANNOUNCE,
        payload: (bytes) => {
          appendAsciiPath(bytes, 'maps/test.bin');
          appendUint16LE(bytes, 42);
          appendUint8(bytes, 0b1010);
        },
        expected: { path: 'maps/test.bin', commandId: 42, playerMask: 0b1010 },
      },
      {
        commandType: NETCOMMANDTYPE_FILEPROGRESS,
        payload: (bytes) => {
          appendUint16LE(bytes, 42);
          appendInt32LE(bytes, 66);
        },
        expected: { commandId: 42, progress: 66 },
      },
      {
        commandType: NETCOMMANDTYPE_FRAMERESENDREQUEST,
        payload: (bytes) => appendUint32LE(bytes, 91),
        expected: { frame: 91 },
      },
      {
        commandType: NETCOMMANDTYPE_DISCONNECTPLAYER,
        payload: (bytes) => {
          appendUint8(bytes, 2);
          appendUint32LE(bytes, 99);
        },
        expected: { slot: 2, disconnectFrame: 99 },
      },
      {
        commandType: NETCOMMANDTYPE_DISCONNECTVOTE,
        payload: (bytes) => {
          appendUint8(bytes, 4);
          appendUint32LE(bytes, 33);
        },
        expected: { voteSlot: 4, voteFrame: 33 },
      },
      {
        commandType: NETCOMMANDTYPE_DISCONNECTFRAME,
        payload: (bytes) => appendUint32LE(bytes, 112),
        expected: { frame: 112 },
      },
      {
        commandType: NETCOMMANDTYPE_DISCONNECTSCREENOFF,
        payload: (bytes) => appendUint32LE(bytes, 120),
        expected: { newFrame: 120 },
      },
      {
        commandType: NETCOMMANDTYPE_WRAPPER,
        payload: (bytes) => {
          appendUint16LE(bytes, 0x5151);
          appendUint32LE(bytes, 1);
          appendUint32LE(bytes, 3);
          appendUint32LE(bytes, 16);
          appendUint32LE(bytes, wrapperChunkBytes.length);
          appendUint32LE(bytes, 8);
          for (const value of wrapperChunkBytes) {
            appendUint8(bytes, value);
          }
        },
        expected: {
          wrappedCommandID: 0x5151,
          chunkNumber: 1,
          numChunks: 3,
          totalDataLength: 16,
          dataOffset: 8,
          data: wrapperChunkBytes,
        },
      },
    ];

    for (const testCase of cases) {
      const parsed = parseNetworkWrappedCommand(buildWrappedPayload(testCase.commandType, testCase.payload));
      expect(parsed).not.toBeNull();
      expect(parsed).toEqual(expect.objectContaining({
        commandType: testCase.commandType,
        sender: 1,
        executionFrame: 33,
        ...testCase.expected,
      }));
    }
  });

  it('retains unstructured command types that do not define wrapped payload fields', () => {
    const passthroughTypes = [
      NETCOMMANDTYPE_GAMECOMMAND,
      NETCOMMANDTYPE_KEEPALIVE,
      NETCOMMANDTYPE_DISCONNECTKEEPALIVE,
      NETCOMMANDTYPE_PACKETROUTERQUERY,
      NETCOMMANDTYPE_PACKETROUTERACK,
    ];

    for (const commandType of passthroughTypes) {
      expect(parseNetworkWrappedCommand(buildWrappedPayload(commandType))).toEqual({
        commandType,
        sender: 1,
        executionFrame: 33,
        commandId: 99,
      });
    }
  });
});
