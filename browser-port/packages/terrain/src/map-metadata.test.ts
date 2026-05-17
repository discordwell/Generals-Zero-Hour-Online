import { describe, expect, it } from 'vitest';
import {
  countSourcePlayerStartSpots,
  deriveMapMetadataFromMapData,
  getMapMetadata,
} from './map-metadata.js';
import type { MapDataJSON, WaypointNodeJSON } from './types.js';

function waypoint(name: string): Pick<WaypointNodeJSON, 'name'> {
  return { name };
}

describe('map metadata', () => {
  it('matches source consecutive Player_N_Start counting', () => {
    expect(countSourcePlayerStartSpots([
      waypoint('Player_1_Start'),
      waypoint('Player_2_Start'),
      waypoint('Player_4_Start'),
    ])).toBe(2);
  });

  it('clamps maps with no source start spots to one player', () => {
    expect(countSourcePlayerStartSpots([
      waypoint('InitialCameraPosition'),
      waypoint('Waypoint 1'),
    ])).toBe(1);
  });

  it('derives multiplayer state from source player count', () => {
    expect(deriveMapMetadataFromMapData({
      waypoints: {
        nodes: [
          waypoint('Player_1_Start') as WaypointNodeJSON,
          waypoint('Player_2_Start') as WaypointNodeJSON,
        ],
        links: [],
      },
    })).toEqual({
      numPlayers: 2,
      isMultiplayer: true,
    });
  });

  it('uses valid converted metadata when present', () => {
    const mapData = {
      metadata: { numPlayers: 4, isMultiplayer: true },
      waypoints: {
        nodes: [],
        links: [],
      },
    } as MapDataJSON;

    expect(getMapMetadata(mapData)).toEqual({
      numPlayers: 4,
      isMultiplayer: true,
    });
  });
});
