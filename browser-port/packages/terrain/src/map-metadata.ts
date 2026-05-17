import type { MapDataJSON, MapMetadataJSON, WaypointNodeJSON } from './types.js';

const SOURCE_MAX_SLOTS = 8;

function hasSourcePlayerStart(
  waypointNames: ReadonlySet<string>,
  playerIndex: number,
): boolean {
  return waypointNames.has(`Player_${playerIndex}_Start`);
}

/**
 * Source parity:
 *   GeneralsMD/Code/GameEngine/Source/GameClient/MapUtil.cpp
 *   WaypointMap::update()
 *
 * The source counts only consecutive Player_N_Start waypoints from slot 1,
 * stops at the first gap, and clamps the result to at least one player.
 */
export function countSourcePlayerStartSpots(
  waypointNodes: readonly Pick<WaypointNodeJSON, 'name'>[],
): number {
  const waypointNames = new Set(
    waypointNodes
      .map((node) => node.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  );

  let startSpotCount = 0;
  for (let playerIndex = 1; playerIndex <= SOURCE_MAX_SLOTS; playerIndex += 1) {
    if (!hasSourcePlayerStart(waypointNames, playerIndex)) {
      break;
    }
    startSpotCount += 1;
  }

  return Math.max(1, startSpotCount);
}

export function deriveMapMetadataFromWaypointNodes(
  waypointNodes: readonly Pick<WaypointNodeJSON, 'name'>[],
): MapMetadataJSON {
  const numPlayers = countSourcePlayerStartSpots(waypointNodes);
  return {
    numPlayers,
    isMultiplayer: numPlayers >= 2,
  };
}

export function deriveMapMetadataFromMapData(mapData: Pick<MapDataJSON, 'waypoints'>): MapMetadataJSON {
  return deriveMapMetadataFromWaypointNodes(mapData.waypoints?.nodes ?? []);
}

export function getMapMetadata(mapData: MapDataJSON): MapMetadataJSON {
  const numPlayers = mapData.metadata?.numPlayers;
  const isMultiplayer = mapData.metadata?.isMultiplayer;
  if (
    typeof numPlayers === 'number'
    && Number.isInteger(numPlayers)
    && numPlayers >= 1
    && typeof isMultiplayer === 'boolean'
  ) {
    return { numPlayers, isMultiplayer };
  }

  return deriveMapMetadataFromMapData(mapData);
}
