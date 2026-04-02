import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAudioIndex, createAudioBufferLoader } from './audio-buffer-loader.js';
import type { RuntimeManifest } from '@generals/assets';

function makeManifest(entries: Array<{ outputPath: string; converter: string }>): RuntimeManifest {
  const raw = {
    version: 1 as const,
    generatedAt: '2025-01-01T00:00:00Z',
    entryCount: entries.length,
    entries: entries.map((e) => ({
      sourcePath: `source/${e.outputPath}`,
      sourceHash: 'abc123',
      outputPath: e.outputPath,
      outputHash: 'def456',
      converter: e.converter,
      converterVersion: '1.0.0',
      timestamp: '2025-01-01T00:00:00Z',
    })),
  };
  // Minimal RuntimeManifest stub — only raw.entries is used by buildAudioIndex
  return { raw } as RuntimeManifest;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete (globalThis as Record<string, unknown>)['fetch'];
  }
});

describe('buildAudioIndex', () => {
  it('indexes audio-converter entries by lowercase basename', () => {
    const manifest = makeManifest([
      { outputPath: 'audio/Speech/vgenlo2a.wav', converter: 'audio-converter' },
      { outputPath: 'audio/Sounds/explosion1.mp3', converter: 'audio-converter' },
    ]);
    const index = buildAudioIndex(manifest);

    expect(index.get('vgenlo2a')).toBe('audio/Speech/vgenlo2a.wav');
    expect(index.get('explosion1')).toBe('audio/Sounds/explosion1.mp3');
  });

  it('matches case-insensitively', () => {
    const manifest = makeManifest([
      { outputPath: 'audio/Music/Track01.mp3', converter: 'audio-converter' },
    ]);
    const index = buildAudioIndex(manifest);

    expect(index.get('track01')).toBe('audio/Music/Track01.mp3');
  });

  it('ignores non-audio-converter entries', () => {
    const manifest = makeManifest([
      { outputPath: 'audio/foo.wav', converter: 'audio-converter' },
      { outputPath: 'textures/bar.png', converter: 'texture-converter' },
    ]);
    const index = buildAudioIndex(manifest);

    expect(index.size).toBe(1);
    expect(index.has('bar')).toBe(false);
  });

  it('returns empty map for manifest with no audio entries', () => {
    const manifest = makeManifest([]);
    const index = buildAudioIndex(manifest);

    expect(index.size).toBe(0);
  });

  it('handles files at root level (no directory)', () => {
    const manifest = makeManifest([
      { outputPath: 'mysound.wav', converter: 'audio-converter' },
    ]);
    const index = buildAudioIndex(manifest);

    expect(index.get('mysound')).toBe('mysound.wav');
  });
});

describe('createAudioBufferLoader', () => {
  it('returns null for HTML fallback responses instead of decode payload bytes', async () => {
    const manifest = makeManifest([
      { outputPath: 'audio/Speech/vgenlo2a.wav', converter: 'audio-converter' },
    ]);
    globalThis.fetch = vi.fn(async () => new Response('<!DOCTYPE html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })) as typeof fetch;

    const loader = createAudioBufferLoader(manifest);
    await expect(loader('vgenlo2a')).resolves.toBeNull();
  });
});
