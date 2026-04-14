import type { MapDataJSON } from '@generals/terrain';

import { MapParser, type ParsedMap } from './MapParser.js';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes to base64 without Node-only globals so this works in the browser app. */
export function uint8ArrayToBase64(data: Uint8Array): string {
  let output = '';
  let index = 0;

  for (; index + 2 < data.length; index += 3) {
    const triple = ((data[index] ?? 0) << 16)
      | ((data[index + 1] ?? 0) << 8)
      | (data[index + 2] ?? 0);
    output += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 6) & 0x3f];
    output += BASE64_ALPHABET[triple & 0x3f];
  }

  const remaining = data.length - index;
  if (remaining === 1) {
    const triple = (data[index] ?? 0) << 16;
    output += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    output += '==';
  } else if (remaining === 2) {
    const triple = ((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8);
    output += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 6) & 0x3f];
    output += '=';
  }

  return output;
}

function stringifyMapObjectProperty(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function parsedMapToJSON(parsed: ParsedMap): MapDataJSON {
  return {
    heightmap: {
      width: parsed.heightmap.width,
      height: parsed.heightmap.height,
      borderSize: parsed.heightmap.borderSize,
      boundaries: parsed.heightmap.boundaries,
      data: uint8ArrayToBase64(parsed.heightmap.data),
    },
    objects: parsed.objects.map((obj) => ({
      position: obj.position,
      angle: obj.angle,
      templateName: obj.templateName,
      flags: obj.flags,
      properties: Object.fromEntries(
        Array.from(obj.propertiesByName.entries()).map(([key, value]) => (
          [key, stringifyMapObjectProperty(value)]
        )),
      ),
    })),
    triggers: parsed.triggers.map((trig) => ({
      name: trig.name,
      id: trig.id,
      isWaterArea: trig.isWaterArea,
      isRiver: trig.isRiver,
      points: trig.points,
    })),
    waypoints: {
      nodes: parsed.waypoints.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        position: node.position,
        pathLabel1: node.pathLabel1,
        pathLabel2: node.pathLabel2,
        pathLabel3: node.pathLabel3,
        biDirectional: node.biDirectional,
      })),
      links: parsed.waypoints.links.map((link) => ({
        waypoint1: link.waypoint1,
        waypoint2: link.waypoint2,
      })),
    },
    textureClasses: parsed.textureClassDefs.map((tc) => ({
      name: tc.name,
      firstTile: tc.firstTile,
      numTiles: tc.numTiles,
    })),
    blendTileCount: parsed.blendTileCount,
    tileIndices: parsed.tileIndices
      ? uint8ArrayToBase64(new Uint8Array(
        parsed.tileIndices.buffer,
        parsed.tileIndices.byteOffset,
        parsed.tileIndices.byteLength,
      ))
      : undefined,
    cliffStateData: parsed.cliffStateData
      ? uint8ArrayToBase64(parsed.cliffStateData)
      : undefined,
    cliffStateStride: parsed.cliffStateData ? parsed.cliffStateStride : undefined,
    sidesList: parsed.sidesList,
  };
}

export function parseMapDataJSON(buffer: ArrayBuffer): MapDataJSON {
  return parsedMapToJSON(MapParser.parse(buffer));
}
