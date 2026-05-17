import { describe, expect, it } from 'vitest';
import type { ParsedMap } from './MapParser.js';
import { parsedMapToJSON } from './map-json.js';

function makeParsedMapWithWaypoints(names: readonly string[]): ParsedMap {
  return {
    heightmap: {
      width: 1,
      height: 1,
      borderSize: 0,
      boundaries: [],
      data: new Uint8Array([0]),
    },
    objects: [],
    triggers: [],
    waypoints: {
      nodes: names.map((name, index) => ({
        id: index + 1,
        name,
        position: { x: 0, y: 0, z: 0 },
        biDirectional: false,
      })),
      links: [],
    },
    blendTileCount: 0,
    textureClasses: [],
    textureClassDefs: [],
    tileIndices: null,
    cliffStateData: null,
    cliffStateStride: 0,
  };
}

describe('map JSON metadata', () => {
  it('serializes source MapCache multiplayer metadata from Player_N_Start waypoints', () => {
    const json = parsedMapToJSON(makeParsedMapWithWaypoints([
      'Player_1_Start',
      'Player_2_Start',
      'Player_3_Start',
    ]));

    expect(json.metadata).toEqual({
      numPlayers: 3,
      isMultiplayer: true,
    });
  });
});
