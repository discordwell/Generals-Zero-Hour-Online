import {
  getMapMetadata,
  type MapDataJSON,
} from '@generals/terrain';
import type { MapInfo } from './game-shell.js';

function isRuntimeMapJsonPath(outputPath: string): boolean {
  return /^maps\//i.test(outputPath) && /\.json$/i.test(outputPath);
}

function deriveMapDisplayBaseName(outputPath: string): string {
  const segments = outputPath.replace(/\.json$/i, '').split('/');
  return (segments[segments.length - 1] ?? '').replace(/_/g, ' ').trim();
}

function appendSourcePlayerCount(baseName: string, numPlayers: number): string {
  return numPlayers >= 2 ? `${baseName} (${numPlayers})` : baseName;
}

export async function buildSourceBackedShellMapInfos(
  outputPaths: readonly string[],
  loadMapData: (outputPath: string) => Promise<MapDataJSON>,
): Promise<MapInfo[]> {
  const mapPaths = outputPaths
    .filter(isRuntimeMapJsonPath)
    .sort((left, right) => left.localeCompare(right));

  const mapInfos = await Promise.all(mapPaths.map(async (path): Promise<MapInfo | null> => {
    const mapData = await loadMapData(path);
    const metadata = getMapMetadata(mapData);
    if (!metadata.isMultiplayer) {
      return null;
    }

    const baseName = deriveMapDisplayBaseName(path);
    return {
      path,
      name: appendSourcePlayerCount(baseName, metadata.numPlayers),
      numPlayers: metadata.numPlayers,
      isMultiplayer: metadata.isMultiplayer,
    };
  }));

  return mapInfos
    .filter((mapInfo): mapInfo is MapInfo => mapInfo !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
