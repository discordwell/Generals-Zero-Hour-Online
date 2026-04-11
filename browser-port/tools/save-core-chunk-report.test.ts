import { describe, expect, it } from 'vitest';

import {
  getSaveCoreChunkBlockers,
  summarizeSaveCoreChunkStatus,
} from './save-core-chunk-report.js';

describe('save core chunk report', () => {
  it('passes strict status when every core chunk is parsed or legacy-readable', () => {
    const chunks = [
      { blockName: 'CHUNK_GameState', mode: 'parsed' },
      { blockName: 'CHUNK_GameClient', mode: 'legacy' },
      { blockName: 'CHUNK_GameLogic', mode: 'parsed' },
    ] as const;

    expect(summarizeSaveCoreChunkStatus(chunks)).toEqual({
      status: 'pass',
      totalCoreChunks: 3,
      parsedCoreChunks: 2,
      legacyCoreChunks: 1,
      rawPassthroughCoreChunks: 0,
      missingCoreChunks: 0,
    });
    expect(getSaveCoreChunkBlockers(chunks)).toEqual([]);
  });

  it('surfaces raw passthrough and missing chunks as strict blockers', () => {
    const chunks = [
      { blockName: 'CHUNK_GameState', mode: 'parsed' },
      { blockName: 'CHUNK_Players', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_TerrainVisual', mode: 'missing' },
    ] as const;

    expect(summarizeSaveCoreChunkStatus(chunks)).toEqual({
      status: 'blocked',
      totalCoreChunks: 3,
      parsedCoreChunks: 1,
      legacyCoreChunks: 0,
      rawPassthroughCoreChunks: 1,
      missingCoreChunks: 1,
    });
    expect(getSaveCoreChunkBlockers(chunks)).toEqual([
      { blockName: 'CHUNK_Players', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_TerrainVisual', mode: 'missing' },
    ]);
  });
});
