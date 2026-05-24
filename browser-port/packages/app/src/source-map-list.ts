import type { MapInfo } from './game-shell.js';

const SOURCE_SKIPPED_SKIRMISH_MAPS = new Set([
  'maps\\armored fury\\armored fury.map',
  'maps\\scorched earth\\scorched earth.map',
]);

function normalizeConvertedMapPathToSourceMapPath(path: string): string {
  const normalized = path
    .replace(/\//g, '\\')
    .replace(/\.json$/i, '.map')
    .toLowerCase();
  const mapsSegment = '\\maps\\';
  const mapsIndex = normalized.lastIndexOf(mapsSegment);
  if (mapsIndex >= 0) {
    return normalized.slice(mapsIndex + 1);
  }
  return normalized;
}

/**
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Source/GameClient/MapUtil.cpp
 *   populateMapListboxNoReset()
 */
export function isSourceSkippedSkirmishMapPath(path: string): boolean {
  return SOURCE_SKIPPED_SKIRMISH_MAPS.has(
    normalizeConvertedMapPathToSourceMapPath(path),
  );
}

export function isSourceMultiplayerMapInfo(mapInfo: MapInfo): boolean {
  if (typeof mapInfo.isMultiplayer === 'boolean') {
    return mapInfo.isMultiplayer;
  }
  if (typeof mapInfo.numPlayers === 'number') {
    return mapInfo.numPlayers >= 2;
  }
  return true;
}

/**
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Source/GameClient/MapUtil.cpp
 *   populateMapListboxNoReset()
 *
 * The source groups map display names by MapMetaData::m_numPlayers, then sorts
 * display names case-insensitively inside each player-count bucket.
 */
export function compareSourceMapListOrder(left: MapInfo, right: MapInfo): number {
  const leftPlayers = left.numPlayers ?? Number.MAX_SAFE_INTEGER;
  const rightPlayers = right.numPlayers ?? Number.MAX_SAFE_INTEGER;
  if (leftPlayers !== rightPlayers) {
    return leftPlayers - rightPlayers;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' });
}
