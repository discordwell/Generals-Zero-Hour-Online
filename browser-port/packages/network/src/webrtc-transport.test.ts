import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { WebRTCTransport } from './webrtc-transport.js';

// Mock WebSocket for signaling tests.
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // Test helper: simulate server message.
  simulateMessage(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

// Mock DataChannel for peer message tests.
class MockDataChannel {
  readyState = 'open';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

describe('WebRTCTransport', () => {
  let transport: WebRTCTransport;
  let mockWs: MockWebSocket;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    mockWs = new MockWebSocket();
    // Mock WebSocket constructor.
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = vi.fn(() => mockWs);
    // Also set WebSocket.OPEN constant.
    (globalThis.WebSocket as unknown as { OPEN: number }).OPEN = 1;
  });

  afterEach(() => {
    transport?.dispose();
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it('starts in disconnected state', () => {
    transport = new WebRTCTransport('ws://test', 0);
    expect(transport.getState()).toBe('disconnected');
  });

  it('transitions to connecting on init', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();
    expect(transport.getState()).toBe('connecting');
  });

  it('sends join message on signaling connect', () => {
    transport = new WebRTCTransport('ws://test', 1);
    transport.init();
    mockWs.onopen?.();

    expect(mockWs.sentMessages.length).toBe(1);
    const msg = JSON.parse(mockWs.sentMessages[0]!);
    expect(msg.type).toBe('join');
    expect(msg.from).toBe(1);
  });

  it('returns no connected peers initially', () => {
    transport = new WebRTCTransport('ws://test', 0);
    expect(transport.getConnectedPeerIds()).toEqual([]);
  });

  it('returns disconnected for unknown peer', () => {
    transport = new WebRTCTransport('ws://test', 0);
    expect(transport.getPeerState(99)).toBe('disconnected');
  });

  it('initial metrics are zero', () => {
    transport = new WebRTCTransport('ws://test', 0);
    expect(transport.getIncomingBytesPerSecond()).toBe(0);
    expect(transport.getOutgoingBytesPerSecond()).toBe(0);
    expect(transport.getIncomingPacketsPerSecond()).toBe(0);
    expect(transport.getOutgoingPacketsPerSecond()).toBe(0);
    expect(transport.getUnknownBytesPerSecond()).toBe(0);
    expect(transport.getUnknownPacketsPerSecond()).toBe(0);
  });

  it('sendLocalCommandDirect serializes command to JSON', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();

    // Inject a mock peer with an open data channel.
    const mockChannel = new MockDataChannel();
    const peers = (transport as unknown as { peers: Map<number, unknown> }).peers;
    peers.set(1, {
      pc: { close: vi.fn(), connectionState: 'connected' },
      channel: mockChannel,
      peerId: 1,
      state: 'connected',
    });

    const command = { commandType: 5, type: 'FRAMEINFO', frame: 42 };
    transport.sendLocalCommandDirect(command, 0b10); // relayMask bit 1

    expect(mockChannel.sentMessages.length).toBe(1);
    const parsed = JSON.parse(mockChannel.sentMessages[0]!);
    expect(parsed.commandType).toBe(5);
    expect(parsed.frame).toBe(42);
  });

  it('sendLocalCommandDirect respects relay mask', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();

    const channel1 = new MockDataChannel();
    const channel2 = new MockDataChannel();
    const peers = (transport as unknown as { peers: Map<number, unknown> }).peers;
    peers.set(1, { pc: { close: vi.fn() }, channel: channel1, peerId: 1, state: 'connected' });
    peers.set(2, { pc: { close: vi.fn() }, channel: channel2, peerId: 2, state: 'connected' });

    // Only send to player 2 (bit 2 = 0b100).
    transport.sendLocalCommandDirect({ type: 'test' }, 0b100);

    expect(channel1.sentMessages.length).toBe(0);
    expect(channel2.sentMessages.length).toBe(1);
  });

  it('transitions to disconnected on signaling close', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();
    expect(transport.getState()).toBe('connecting');

    mockWs.close();
    expect(transport.getState()).toBe('disconnected');
  });

  it('transitions to failed on signaling error', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();
    mockWs.onerror?.();
    expect(transport.getState()).toBe('failed');
  });

  it('dispose cleans up signaling connection', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();
    transport.dispose();
    expect(transport.getState()).toBe('disconnected');
  });

  it('ignores signaling messages not addressed to local player', () => {
    transport = new WebRTCTransport('ws://test', 0);
    transport.init();
    mockWs.onopen?.();

    // Message addressed to player 5, not us (player 0).
    mockWs.simulateMessage({
      type: 'offer',
      from: 1,
      to: 5,
      payload: {},
    });

    // Should not create a peer connection.
    const peers = (transport as unknown as { peers: Map<number, unknown> }).peers;
    expect(peers.size).toBe(0);
  });
});
