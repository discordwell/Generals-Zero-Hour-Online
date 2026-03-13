import fs from 'node:fs';
import path from 'node:path';

import type { MapDataJSON } from '@generals/terrain';

export const RUNTIME_MAP_FIXTURE_CONVERTER = 'runtime-map-fixture-converter';

export interface RuntimeMapFixture {
  sourcePath: string;
  outputPath: string;
  mapData: MapDataJSON;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertMapFixtureShape(sourcePath: string, value: unknown): MapDataJSON {
  if (!isObjectRecord(value)) {
    throw new Error(`Runtime map fixture must be an object: ${sourcePath}`);
  }

  const heightmap = value['heightmap'];
  if (!isObjectRecord(heightmap)) {
    throw new Error(`Runtime map fixture is missing heightmap data: ${sourcePath}`);
  }

  if (
    typeof heightmap['width'] !== 'number'
    || typeof heightmap['height'] !== 'number'
    || typeof heightmap['borderSize'] !== 'number'
    || typeof heightmap['data'] !== 'string'
  ) {
    throw new Error(`Runtime map fixture has an invalid heightmap payload: ${sourcePath}`);
  }

  const expectedHeightByteLength = heightmap['width'] * heightmap['height'];
  const actualHeightByteLength = Buffer.from(heightmap['data'], 'base64').length;
  if (actualHeightByteLength !== expectedHeightByteLength) {
    throw new Error(
      `Runtime map fixture heightmap data length mismatch: expected ${expectedHeightByteLength}, got ${actualHeightByteLength} (${sourcePath})`,
    );
  }

  if (!Array.isArray(value['objects']) || !Array.isArray(value['triggers'])) {
    throw new Error(`Runtime map fixture must define objects/triggers arrays: ${sourcePath}`);
  }

  if (!Array.isArray(value['textureClasses']) || typeof value['blendTileCount'] !== 'number') {
    throw new Error(`Runtime map fixture must define textureClasses/blendTileCount: ${sourcePath}`);
  }

  const waypoints = value['waypoints'];
  if (waypoints !== undefined) {
    if (!isObjectRecord(waypoints) || !Array.isArray(waypoints['nodes']) || !Array.isArray(waypoints['links'])) {
      throw new Error(`Runtime map fixture has invalid waypoint data: ${sourcePath}`);
    }
  }

  return value as MapDataJSON;
}

export function loadRuntimeMapFixtures(projectRoot: string): RuntimeMapFixture[] {
  const fixtureDir = path.join(projectRoot, 'tools', 'convert-all', 'fixtures', 'maps');
  if (!fs.existsSync(fixtureDir)) {
    return [];
  }

  return fs.readdirSync(fixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const sourcePath = path.join(fixtureDir, entry.name);
      const mapData = assertMapFixtureShape(
        sourcePath,
        JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as unknown,
      );

      return {
        sourcePath,
        outputPath: path.posix.join('maps', entry.name),
        mapData,
      };
    });
}
