/**
 * Audio buffer loader — maps bare audio filenames from INI AudioEvent data
 * to converted asset URLs via the runtime manifest.
 *
 * The AudioManager receives bare filenames (e.g., "vgenlo2a") and this loader
 * resolves them to fetch URLs for the converted WAV/MP3 files.
 */

import type { RuntimeManifest } from '@generals/assets';
import type { AudioBufferLoader } from '@generals/audio';
import { RUNTIME_ASSET_BASE_URL } from '@generals/assets';

/**
 * Build a Map<lowercaseBasename, outputPath> from all audio-converter entries.
 */
function buildAudioIndex(manifest: RuntimeManifest): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of manifest.raw.entries) {
    if (entry.converter !== 'audio-converter') continue;
    const lastSlash = entry.outputPath.lastIndexOf('/');
    const filename = lastSlash >= 0 ? entry.outputPath.slice(lastSlash + 1) : entry.outputPath;
    const dotIdx = filename.lastIndexOf('.');
    const basename = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    index.set(basename.toLowerCase(), entry.outputPath);
  }
  return index;
}

/**
 * Create an AudioBufferLoader that resolves bare filenames via manifest lookup.
 */
export function createAudioBufferLoader(manifest: RuntimeManifest): AudioBufferLoader {
  const index = buildAudioIndex(manifest);

  return async (filename: string): Promise<ArrayBuffer | null> => {
    // Strip any extension the caller may have included
    const dotIdx = filename.lastIndexOf('.');
    const bare = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    const outputPath = index.get(bare.toLowerCase());
    if (!outputPath) return null;

    const url = `${RUNTIME_ASSET_BASE_URL}/${outputPath}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (contentType.includes('text/html')) {
        return null;
      }
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  };
}

/** Exported for testing. */
export { buildAudioIndex };
