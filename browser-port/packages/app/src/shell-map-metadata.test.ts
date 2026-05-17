import { describe, expect, it } from 'vitest';
import type { MapDataJSON } from '@generals/terrain';
import { buildSourceBackedShellMapInfos } from './shell-map-metadata.js';

function mapWithWaypoints(names: readonly string[]): MapDataJSON {
  return {
    heightmap: {
      width: 1,
      height: 1,
      borderSize: 0,
      data: 'AA==',
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
    textureClasses: [],
    blendTileCount: 0,
  };
}

describe('buildSourceBackedShellMapInfos', () => {
  it('filters shell maps with source MapCache metadata instead of path names', async () => {
    const mapData = new Map<string, MapDataJSON>([
      [
        'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json',
        mapWithWaypoints(['Player_1_Start', 'Player_2_Start']),
      ],
      [
        'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
        mapWithWaypoints(['Player_1_Start']),
      ],
    ]);

    const infos = await buildSourceBackedShellMapInfos(
      [
        'data/ini-bundle.json',
        'maps/_extracted/MapsZH/Maps/MD_USA01/MD_USA01.json',
        'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json',
      ],
      async (outputPath) => {
        const value = mapData.get(outputPath);
        if (!value) {
          throw new Error(`Unexpected map load: ${outputPath}`);
        }
        return value;
      },
    );

    expect(infos).toEqual([
      {
        path: 'maps/_extracted/MapsZH/Maps/Tournament Desert/Tournament Desert.json',
        name: 'Tournament Desert (2)',
        numPlayers: 2,
        isMultiplayer: true,
      },
    ]);
  });

  it('uses converter-provided map metadata when present', async () => {
    const infos = await buildSourceBackedShellMapInfos(
      ['maps/_extracted/MapsZH/Maps/Whiteout/Whiteout.json'],
      async () => ({
        ...mapWithWaypoints([]),
        metadata: {
          numPlayers: 8,
          isMultiplayer: true,
        },
      }),
    );

    expect(infos[0]).toMatchObject({
      name: 'Whiteout (8)',
      numPlayers: 8,
      isMultiplayer: true,
    });
  });
});
