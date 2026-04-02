import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';

import { ReplayStorage } from './replay-storage.js';
import type { ReplayFile } from './replay-manager.js';

let testCounter = 0;

function makeReplay(overrides: Partial<ReplayFile> = {}): ReplayFile {
  return {
    version: 1,
    mapPath: 'maps/test.json',
    playerCount: 2,
    players: [
      { id: 0, name: 'Player', side: 'America', team: 1, color: 0 },
      { id: 1, name: 'AI', side: 'China', team: 2, color: 1 },
    ],
    startingCredits: 10000,
    frameRate: 30,
    totalFrames: 180,
    recordedAt: '2026-04-02T20:15:00.000Z',
    commands: [
      { frame: 0, playerId: 0, command: { type: 'moveTo', entityId: 1, targetX: 10, targetZ: 20 } },
    ],
    ...overrides,
  };
}

describe('ReplayStorage', () => {
  let storage: ReplayStorage;

  beforeEach(() => {
    testCounter++;
    storage = new ReplayStorage(`generals-replays-test-${testCounter}`);
  });

  it('saves and loads replay metadata and payload', async () => {
    const replay = makeReplay();

    await storage.saveToDB('replay-1', replay, 'Tournament Desert');

    const loaded = await storage.loadFromDB('replay-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.replayId).toBe('replay-1');
    expect(loaded!.metadata.description).toBe('Tournament Desert');
    expect(loaded!.metadata.mapPath).toBe('maps/test.json');
    expect(loaded!.metadata.version).toBe(1);
    expect(loaded!.replay.totalFrames).toBe(180);
  });

  it('lists replays sorted newest-first by timestamp', async () => {
    await storage.saveToDB('older', makeReplay({ recordedAt: '2026-04-01T20:15:00.000Z' }), 'Older');
    await storage.saveToDB('newer', makeReplay({ recordedAt: '2026-04-03T20:15:00.000Z' }), 'Newer');

    const replays = await storage.listReplays();
    expect(replays.map((entry) => entry.replayId)).toEqual(['newer', 'older']);
  });

  it('deletes replay payload and metadata together', async () => {
    await storage.saveToDB('delete-me', makeReplay(), 'Delete');

    await storage.deleteReplay('delete-me');

    expect(await storage.loadFromDB('delete-me')).toBeNull();
    expect((await storage.listReplays()).find((entry) => entry.replayId === 'delete-me')).toBeUndefined();
  });
});
