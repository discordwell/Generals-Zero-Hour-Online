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
      rawUnsupportedGameClientDrawables: 0,
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
      rawUnsupportedGameClientDrawables: 0,
    });
    expect(getSaveCoreChunkBlockers(chunks)).toEqual([
      { blockName: 'CHUNK_Players', mode: 'raw_passthrough' },
      { blockName: 'CHUNK_TerrainVisual', mode: 'missing' },
    ]);
  });

  it('blocks strict status on unsupported inner GameClient drawable records', () => {
    const chunks = [
      { blockName: 'CHUNK_GameClient', mode: 'parsed' },
    ] as const;
    const drawables = [{
      index: 0,
      templateName: 'LegacyScorchMark',
      objectId: 0,
      drawableId: 900,
      version: 5,
      mode: 'raw_unsupported' as const,
    }];

    expect(summarizeSaveCoreChunkStatus(chunks, drawables)).toEqual({
      status: 'blocked',
      totalCoreChunks: 1,
      parsedCoreChunks: 1,
      legacyCoreChunks: 0,
      rawPassthroughCoreChunks: 0,
      missingCoreChunks: 0,
      rawUnsupportedGameClientDrawables: 1,
    });
  });
});
