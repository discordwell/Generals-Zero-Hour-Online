/**
 * WebRTC peer-to-peer transport for multiplayer.
 *
 * Source parity: The original game used DirectPlay/UDP for LAN and GameSpy
 * for internet play. This WebRTC transport provides equivalent reliable,
 * ordered delivery via DataChannel, with NAT traversal via ICE/STUN.
 *
 * Integration:
 *   const transport = new WebRTCTransport(signalingUrl, localPlayerId);
 *   networkManager.attachTransport(transport);
 *   networkManager.initTransport();
 *
 * Messages arriving on the DataChannel are forwarded to NetworkManager
 * via the onMessage callback.
 */

export type WebRTCConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

export interface WebRTCTransportConfig {
  /** STUN server URLs for NAT traversal. */
  iceServers?: RTCIceServer[];
  /** Timeout for connection establishment (ms). Default 15000. */
  connectionTimeoutMs?: number;
  /** Callback when a command is received from a peer. */
  onMessage?: (message: unknown) => void;
  /** Callback when connection state changes. */
  onStateChange?: (state: WebRTCConnectionState, peerId: number) => void;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  peerId: number;
  state: WebRTCConnectionState;
}

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave';
  from: number;
  to?: number;
  payload?: unknown;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class WebRTCTransport {
  private readonly localPlayerId: number;
  private readonly signalingUrl: string;
  private readonly config: WebRTCTransportConfig;
  private readonly peers = new Map<number, PeerConnection>();
  private signalingWs: WebSocket | null = null;
  private state: WebRTCConnectionState = 'disconnected';

  // Bandwidth tracking.
  private incomingBytes = 0;
  private outgoingBytes = 0;
  private incomingPackets = 0;
  private outgoingPackets = 0;
  private lastMetricsReset = performance.now();
  private cachedIncomingBps = 0;
  private cachedOutgoingBps = 0;
  private cachedIncomingPps = 0;
  private cachedOutgoingPps = 0;

  constructor(
    signalingUrl: string,
    localPlayerId: number,
    config: WebRTCTransportConfig = {},
  ) {
    this.signalingUrl = signalingUrl;
    this.localPlayerId = localPlayerId;
    this.config = config;
  }

  // ========================================================================
  // TransportLike interface methods
  // ========================================================================

  init(): void {
    this.connectSignaling();
  }

  sendLocalCommandDirect(command: unknown, relayMask: number): void {
    const json = JSON.stringify(command);
    const bytes = json.length; // Approximate byte count (UTF-8, mostly ASCII).

    for (const [peerId, peer] of this.peers) {
      if ((relayMask & (1 << peerId)) !== 0 && peer.channel?.readyState === 'open') {
        peer.channel.send(json);
        this.outgoingBytes += bytes;
        this.outgoingPackets++;
      }
    }
  }

  getIncomingBytesPerSecond(): number {
    this.refreshMetrics();
    return this.cachedIncomingBps;
  }

  getOutgoingBytesPerSecond(): number {
    this.refreshMetrics();
    return this.cachedOutgoingBps;
  }

  getIncomingPacketsPerSecond(): number {
    this.refreshMetrics();
    return this.cachedIncomingPps;
  }

  getOutgoingPacketsPerSecond(): number {
    this.refreshMetrics();
    return this.cachedOutgoingPps;
  }

  getUnknownBytesPerSecond(): number {
    return 0;
  }

  getUnknownPacketsPerSecond(): number {
    return 0;
  }

  // ========================================================================
  // Public API beyond TransportLike
  // ========================================================================

  getState(): WebRTCConnectionState {
    return this.state;
  }

  getConnectedPeerIds(): number[] {
    const ids: number[] = [];
    for (const [id, peer] of this.peers) {
      if (peer.state === 'connected') {
        ids.push(id);
      }
    }
    return ids;
  }

  getPeerState(peerId: number): WebRTCConnectionState {
    return this.peers.get(peerId)?.state ?? 'disconnected';
  }

  dispose(): void {
    for (const peer of this.peers.values()) {
      peer.channel?.close();
      peer.pc.close();
    }
    this.peers.clear();
    this.signalingWs?.close();
    this.signalingWs = null;
    this.setState('disconnected');
  }

  // ========================================================================
  // Signaling
  // ========================================================================

  private connectSignaling(): void {
    this.setState('connecting');

    const ws = new WebSocket(this.signalingUrl);
    this.signalingWs = ws;

    ws.onopen = () => {
      this.sendSignaling({ type: 'join', from: this.localPlayerId });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as SignalingMessage;
        this.handleSignalingMessage(msg);
      } catch {
        // Ignore malformed messages.
      }
    };

    ws.onclose = () => {
      if (this.state !== 'disconnected') {
        this.setState('disconnected');
      }
    };

    ws.onerror = () => {
      this.setState('failed');
    };
  }

  private sendSignaling(msg: SignalingMessage): void {
    if (this.signalingWs?.readyState === WebSocket.OPEN) {
      this.signalingWs.send(JSON.stringify(msg));
    }
  }

  private async handleSignalingMessage(msg: SignalingMessage): Promise<void> {
    if (msg.to !== undefined && msg.to !== this.localPlayerId) return;

    try {
      switch (msg.type) {
        case 'join':
          // Convention: lower ID creates the offer to prevent both sides offering.
          if (msg.from !== this.localPlayerId && this.localPlayerId < msg.from) {
            await this.createPeerConnection(msg.from, true);
          }
          break;

        case 'offer':
          await this.handleOffer(msg.from, msg.payload as RTCSessionDescriptionInit);
          break;

        case 'answer':
          await this.handleAnswer(msg.from, msg.payload as RTCSessionDescriptionInit);
          break;

        case 'ice-candidate':
          await this.handleIceCandidate(msg.from, msg.payload as RTCIceCandidateInit);
          break;

        case 'leave':
          this.removePeer(msg.from);
          break;
      }
    } catch (err) {
      console.error(`WebRTC signaling error for ${msg.type} from ${msg.from}:`, err);
      const peer = this.peers.get(msg.from);
      if (peer) {
        this.setPeerState(peer, 'failed');
      }
    }
  }

  // ========================================================================
  // Peer connection management
  // ========================================================================

  private async createPeerConnection(
    peerId: number,
    createOffer: boolean,
  ): Promise<PeerConnection> {
    const iceServers = this.config.iceServers ?? DEFAULT_ICE_SERVERS;
    const pc = new RTCPeerConnection({ iceServers });

    const peerConn: PeerConnection = {
      pc,
      channel: null,
      peerId,
      state: 'connecting',
    };
    this.peers.set(peerId, peerConn);

    // ICE candidate forwarding.
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'ice-candidate',
          from: this.localPlayerId,
          to: peerId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.setPeerState(peerConn, 'connected');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.setPeerState(peerConn, 'failed');
      }
    };

    // Handle incoming data channel (for the answerer side).
    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerConn, event.channel);
    };

    if (createOffer) {
      // Create data channel and offer.
      const channel = pc.createDataChannel('game', {
        ordered: true,
      });
      this.setupDataChannel(peerConn, channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignaling({
        type: 'offer',
        from: this.localPlayerId,
        to: peerId,
        payload: pc.localDescription!.toJSON(),
      });
    }

    // Connection timeout.
    const timeoutMs = this.config.connectionTimeoutMs ?? 15000;
    setTimeout(() => {
      if (peerConn.state === 'connecting') {
        this.setPeerState(peerConn, 'failed');
      }
    }, timeoutMs);

    return peerConn;
  }

  private async handleOffer(
    fromId: number,
    offer: RTCSessionDescriptionInit,
  ): Promise<void> {
    const peerConn = await this.createPeerConnection(fromId, false);
    await peerConn.pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConn.pc.createAnswer();
    await peerConn.pc.setLocalDescription(answer);

    this.sendSignaling({
      type: 'answer',
      from: this.localPlayerId,
      to: fromId,
      payload: peerConn.pc.localDescription!.toJSON(),
    });
  }

  private async handleAnswer(
    fromId: number,
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    const peer = this.peers.get(fromId);
    if (!peer) return;
    await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  private async handleIceCandidate(
    fromId: number,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const peer = this.peers.get(fromId);
    if (!peer) return;
    await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private setupDataChannel(
    peerConn: PeerConnection,
    channel: RTCDataChannel,
  ): void {
    peerConn.channel = channel;

    channel.onopen = () => {
      this.setPeerState(peerConn, 'connected');
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
        const bytes = (event.data as string).length;
        this.incomingBytes += bytes;
        this.incomingPackets++;
        this.config.onMessage?.(message);
      } catch {
        // Ignore malformed messages.
      }
    };

    channel.onclose = () => {
      this.setPeerState(peerConn, 'disconnected');
    };
  }

  private removePeer(peerId: number): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.channel?.close();
      peer.pc.close();
      this.peers.delete(peerId);
      this.config.onStateChange?.('disconnected', peerId);
    }
  }

  // ========================================================================
  // State management
  // ========================================================================

  private setState(state: WebRTCConnectionState): void {
    this.state = state;
  }

  private setPeerState(
    peerConn: PeerConnection,
    state: WebRTCConnectionState,
  ): void {
    peerConn.state = state;
    this.config.onStateChange?.(state, peerConn.peerId);

    // Update overall transport state.
    const anyConnected = [...this.peers.values()].some(
      (p) => p.state === 'connected',
    );
    if (anyConnected) {
      this.setState('connected');
    } else {
      const anyConnecting = [...this.peers.values()].some(
        (p) => p.state === 'connecting',
      );
      this.setState(anyConnecting ? 'connecting' : 'disconnected');
    }
  }

  // ========================================================================
  // Metrics
  // ========================================================================

  private refreshMetrics(): void {
    const now = performance.now();
    const elapsed = (now - this.lastMetricsReset) / 1000;
    if (elapsed >= 1.0) {
      this.cachedIncomingBps = this.incomingBytes / elapsed;
      this.cachedOutgoingBps = this.outgoingBytes / elapsed;
      this.cachedIncomingPps = this.incomingPackets / elapsed;
      this.cachedOutgoingPps = this.outgoingPackets / elapsed;
      this.incomingBytes = 0;
      this.outgoingBytes = 0;
      this.incomingPackets = 0;
      this.outgoingPackets = 0;
      this.lastMetricsReset = now;
    }
  }
}
