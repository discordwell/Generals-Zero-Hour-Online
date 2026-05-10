/**
 * Extracts SidesList data (players, teams, build lists, and scripts) from map chunks.
 *
 * Mirrors SidesList::ParseSidesDataChunk and ScriptList::ParseScriptsDataChunk.
 */

import type { DataChunk, DataChunkReader } from './DataChunkReader.js';
import { CHUNK_HEADER_SIZE } from './DataChunkReader.js';
import { ScriptExtractor, type ScriptListJSON } from './ScriptExtractor.js';

export interface MapSideBuildListEntryJSON {
  buildingName: string;
  templateName: string;
  location: { x: number; y: number; z: number };
  angle: number;
  initiallyBuilt: boolean;
  numRebuilds: number;
  script?: string;
  health?: number;
  whiner?: boolean;
  unsellable?: boolean;
  repairable?: boolean;
}

export interface MapSideJSON {
  dict: Record<string, unknown>;
  buildList: MapSideBuildListEntryJSON[];
  scripts?: ScriptListJSON;
}

export interface MapTeamJSON {
  dict: Record<string, unknown>;
}

export interface MapSidesListJSON {
  sides: MapSideJSON[];
  teams: MapTeamJSON[];
}

const CHUNK_PLAYER_SCRIPTS_LIST = 'PlayerScriptsList';

export class SidesListExtractor {
  static extract(
    reader: DataChunkReader,
    chunk: DataChunk,
    idToName: ReadonlyMap<number, string>,
  ): MapSidesListJSON {
    const sides: MapSideJSON[] = [];
    const teams: MapTeamJSON[] = [];

    const sideCount = reader.readInt32();
    for (let sideIndex = 0; sideIndex < sideCount; sideIndex += 1) {
      const dict = SidesListExtractor.readDictByName(reader.readDict(), idToName);
      const buildListCount = reader.readInt32();
      const buildList: MapSideBuildListEntryJSON[] = [];

      for (let buildIndex = 0; buildIndex < buildListCount; buildIndex += 1) {
        const buildingName = reader.readAsciiString();
        const templateName = reader.readAsciiString();
        const x = reader.readFloat32();
        const y = reader.readFloat32();
        let z = reader.readFloat32();
        z = 0; // force to ground level (source parity)
        const angle = reader.readFloat32();
        const initiallyBuilt = reader.readUint8() !== 0;
        const numRebuilds = reader.readInt32();

        const entry: MapSideBuildListEntryJSON = {
          buildingName,
          templateName,
          location: { x, y, z },
          angle,
          initiallyBuilt,
          numRebuilds,
        };

        if (chunk.version >= 3) {
          entry.script = reader.readAsciiString();
          entry.health = reader.readInt32();
          entry.whiner = reader.readUint8() !== 0;
          entry.unsellable = reader.readUint8() !== 0;
          entry.repairable = reader.readUint8() !== 0;
        }

        buildList.push(entry);
      }

      sides.push({ dict, buildList });
    }

    if (chunk.version >= 2) {
      const teamCount = reader.readInt32();
      for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
        const dict = SidesListExtractor.readDictByName(reader.readDict(), idToName);
        teams.push({ dict });
      }
    }

    const chunkEnd = chunk.dataOffset + chunk.dataSize;
    const scriptLists: ScriptListJSON[] = [];

    while (reader.position < chunkEnd) {
      if (reader.position + CHUNK_HEADER_SIZE > chunkEnd) {
        break;
      }
      const child = reader.readChunkHeader();
      const childName = idToName.get(child.id);
      const childEnd = child.dataOffset + child.dataSize;

      if (childName === CHUNK_PLAYER_SCRIPTS_LIST) {
        scriptLists.push(...ScriptExtractor.extractPlayerScriptLists(reader, child, idToName));
      }

      reader.seek(childEnd);
    }

    for (let i = 0; i < sides.length && i < scriptLists.length; i += 1) {
      sides[i]!.scripts = scriptLists[i];
    }

    return { sides, teams };
  }

  private static readDictByName(
    dict: Map<number, unknown>,
    idToName: ReadonlyMap<number, string>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of dict.entries()) {
      const name = idToName.get(key) ?? String(key);
      result[name] = value;
    }
    return result;
  }
}
