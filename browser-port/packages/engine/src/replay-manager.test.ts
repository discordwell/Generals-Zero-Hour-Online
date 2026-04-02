import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ReplayManager, type ReplayFile, type ReplayPlayerInfo } from './replay-manager.js';

const testPlayers: ReplayPlayerInfo[] = [
  { id: 0, name: 'Player1', side: 'America', team: 0, color: 0xff0000 },
  { id: 1, name: 'Player2', side: 'China', team: 1, color: 0x0000ff },
];

describe('ReplayManager', () => {
  let manager: ReplayManager;

  beforeEach(() => {
    manager = new ReplayManager();
  });

  describe('recording', () => {
    it('starts in idle state', () => {
      expect(manager.getState()).toBe('idle');
    });

    it('transitions to recording state on startRecording', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      expect(manager.getState()).toBe('recording');
    });

    it('records commands during recording', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.recordCommand(0, 0, { type: 'MOVE', x: 10, z: 20 });
      manager.recordCommand(1, 1, { type: 'ATTACK', targetId: 5 });
      expect(manager.getRecordedCommandCount()).toBe(2);
    });

    it('ignores recordCommand when not recording', () => {
      manager.recordCommand(0, 0, { type: 'MOVE' });
      expect(manager.getRecordedCommandCount()).toBe(0);
    });

    it('stopRecording returns replay file', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.recordCommand(0, 0, { type: 'MOVE', x: 10 });
      manager.recordCommand(5, 1, { type: 'ATTACK' });

      const replay = manager.stopRecording();
      expect(replay).toBeTruthy();
      expect(replay!.version).toBe(1);
      expect(replay!.mapPath).toBe('maps/test.json');
      expect(replay!.playerCount).toBe(2);
      expect(replay!.players.length).toBe(2);
      expect(replay!.commands.length).toBe(2);
      expect(replay!.totalFrames).toBe(6); // frame 5 + 1
      expect(replay!.frameRate).toBe(30);
      expect(replay!.startingCredits).toBe(10000);
    });

    it('stopRecording returns null when not recording', () => {
      expect(manager.stopRecording()).toBeNull();
    });

    it('transitions back to idle after stopRecording', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.stopRecording();
      expect(manager.getState()).toBe('idle');
    });

    it('tracks totalFrames from recorded commands', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.recordCommand(0, 0, { type: 'A' });
      manager.recordCommand(100, 0, { type: 'B' });
      expect(manager.getTotalFrames()).toBe(101);
    });

    it('tracks totalFrames even when later frames contain no commands', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.recordCommand(0, 0, { type: 'A' });
      manager.recordFrame(180);
      expect(manager.getTotalFrames()).toBe(181);
    });
  });

  describe('serialization', () => {
    it('round-trips via serialize/deserialize', () => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.recordCommand(0, 0, { type: 'MOVE', x: 5 });
      manager.recordCommand(3, 1, { type: 'ATTACK', targetId: 7 });
      const original = manager.stopRecording()!;

      const json = ReplayManager.serialize(original);
      const restored = ReplayManager.deserialize(json);

      expect(restored).toBeTruthy();
      expect(restored!.mapPath).toBe('maps/test.json');
      expect(restored!.commands.length).toBe(2);
      expect(restored!.commands[0]!.command.x).toBe(5);
      expect(restored!.commands[1]!.command.targetId).toBe(7);
    });

    it('deserialize returns null for invalid JSON', () => {
      expect(ReplayManager.deserialize('not json')).toBeNull();
    });

    it('deserialize returns null for wrong version', () => {
      const bad = JSON.stringify({ version: 99, commands: [], players: [] });
      expect(ReplayManager.deserialize(bad)).toBeNull();
    });

    it('deserialize returns null for missing commands array', () => {
      const bad = JSON.stringify({ version: 1, players: [] });
      expect(ReplayManager.deserialize(bad)).toBeNull();
    });
  });

  describe('playback', () => {
    let replay: ReplayFile;

    beforeEach(() => {
      manager.startRecording('maps/test.json', testPlayers, 30, 10000);
      manager.recordCommand(0, 0, { type: 'MOVE' });
      manager.recordCommand(0, 1, { type: 'GUARD' });
      manager.recordCommand(2, 0, { type: 'ATTACK' });
      replay = manager.stopRecording()!;
      manager = new ReplayManager();
    });

    it('loadReplay sets up for playback', () => {
      manager.loadReplay(replay);
      expect(manager.getTotalFrames()).toBe(3);
      expect(manager.getCurrentFrame()).toBe(0);
    });

    it('play transitions to playing state', () => {
      manager.loadReplay(replay);
      manager.play();
      expect(manager.getState()).toBe('playing');
    });

    it('advanceFrame returns commands for current frame', () => {
      manager.loadReplay(replay);
      manager.play();

      // Frame 0 has 2 commands.
      const frame0 = manager.advanceFrame();
      expect(frame0.length).toBe(2);
      expect(manager.getCurrentFrame()).toBe(1);

      // Frame 1 has 0 commands.
      const frame1 = manager.advanceFrame();
      expect(frame1.length).toBe(0);

      // Frame 2 has 1 command.
      const frame2 = manager.advanceFrame();
      expect(frame2.length).toBe(1);
      expect(frame2[0]!.command.type).toBe('ATTACK');
    });

    it('advanceFrame returns empty when not playing', () => {
      manager.loadReplay(replay);
      const result = manager.advanceFrame();
      expect(result.length).toBe(0);
    });

    it('calls onFrame callback during playback', () => {
      const onFrame = vi.fn();
      manager.loadReplay(replay, { onFrame });
      manager.play();
      manager.advanceFrame();
      expect(onFrame).toHaveBeenCalledWith(0, expect.any(Array));
    });

    it('calls onComplete when replay ends', () => {
      const onComplete = vi.fn();
      manager.loadReplay(replay, { onComplete });
      manager.play();

      // Advance past all frames.
      for (let i = 0; i < 5; i++) {
        manager.advanceFrame();
      }

      expect(onComplete).toHaveBeenCalled();
      expect(manager.getState()).toBe('idle');
    });

    it('pause stops playback', () => {
      manager.loadReplay(replay);
      manager.play();
      manager.pause();
      expect(manager.getState()).toBe('paused');
    });

    it('setPlaybackSpeed clamps to 0.25-8 range', () => {
      manager.setPlaybackSpeed(0.1);
      expect(manager.getPlaybackSpeed()).toBe(0.25);
      manager.setPlaybackSpeed(100);
      expect(manager.getPlaybackSpeed()).toBe(8);
      manager.setPlaybackSpeed(2);
      expect(manager.getPlaybackSpeed()).toBe(2);
    });

    it('seekToFrame moves playback position', () => {
      manager.loadReplay(replay);
      manager.seekToFrame(2);
      expect(manager.getCurrentFrame()).toBe(2);
    });

    it('seekToFrame clamps to valid range', () => {
      manager.loadReplay(replay);
      manager.seekToFrame(100);
      expect(manager.getCurrentFrame()).toBe(3); // totalFrames
      manager.seekToFrame(-5);
      expect(manager.getCurrentFrame()).toBe(0);
    });

    it('getHeader returns replay header info', () => {
      manager.loadReplay(replay);
      const header = manager.getHeader();
      expect(header).toBeTruthy();
      expect(header!.mapPath).toBe('maps/test.json');
      expect(header!.players.length).toBe(2);
    });

    it('reset clears all state', () => {
      manager.loadReplay(replay);
      manager.play();
      manager.advanceFrame();
      manager.reset();

      expect(manager.getState()).toBe('idle');
      expect(manager.getCurrentFrame()).toBe(0);
      expect(manager.getTotalFrames()).toBe(0);
      expect(manager.getHeader()).toBeNull();
    });
  });
});
