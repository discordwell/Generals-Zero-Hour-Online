/**
 * @generals/tool-map-converter CLI
 *
 * Parses C&C Generals .map files and converts them to JSON.
 *
 * Usage:
 *   npm run convert:map -- --input <file.map> --output <file.json> [--info]
 *
 * Options:
 *   --input   Path to the .map file to parse (required)
 *   --output  Path for the JSON output file (required unless --info)
 *   --info    Print map summary (dimensions, object count) without full conversion
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MapParser } from './MapParser.js';

interface CliArgs {
  input?: string;
  output?: string;
  info: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { info: false };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--input':
        args.input = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--info':
        args.info = true;
        break;
      default:
        // Skip unknown args
        break;
    }
  }

  return args;
}

function printUsage(): void {
  console.log('Usage: map-converter --input <file.map> --output <file.json> [--info]');
  console.log('');
  console.log('Options:');
  console.log('  --input   Path to the .map file to parse (required)');
  console.log('  --output  Path for the JSON output file (required unless --info)');
  console.log('  --info    Print map summary without full conversion');
}

/** Encode a Uint8Array to base64. */
function uint8ArrayToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  const inputPath = resolve(args.input);
  console.log(`Reading: ${inputPath}`);

  const fileBuffer = await readFile(inputPath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength,
  );

  const parsed = MapParser.parse(arrayBuffer);

  if (args.info) {
    console.log('--- Map Info ---');
    console.log(`  Heightmap: ${parsed.heightmap.width} x ${parsed.heightmap.height}`);
    console.log(`  Border size: ${parsed.heightmap.borderSize}`);
    console.log(`  Objects: ${parsed.objects.length}`);
    console.log(`  Triggers: ${parsed.triggers.length}`);
    console.log(`  Waypoint nodes: ${parsed.waypoints.nodes.length}`);
    console.log(`  Waypoint links: ${parsed.waypoints.links.length}`);
    console.log(`  Blend tiles: ${parsed.blendTileCount}`);
    console.log(`  Texture classes: ${parsed.textureClasses.length}`);
    if (parsed.textureClasses.length > 0) {
      for (const tc of parsed.textureClasses) {
        console.log(`    - ${tc}`);
      }
    }
    return;
  }

  if (!args.output) {
    console.error('Error: --output is required when not using --info');
    printUsage();
    process.exit(1);
  }

  const outputPath = resolve(args.output);

  // Build JSON output
  const jsonOutput = {
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
    tileIndices: parsed.tileIndices ? uint8ArrayToBase64(
      new Uint8Array(parsed.tileIndices.buffer, parsed.tileIndices.byteOffset, parsed.tileIndices.byteLength),
    ) : undefined,
    cliffStateData: parsed.cliffStateData ? uint8ArrayToBase64(parsed.cliffStateData) : undefined,
    cliffStateStride: parsed.cliffStateData ? parsed.cliffStateStride : undefined,
    sidesList: parsed.sidesList,
  };

  const jsonStr = JSON.stringify(jsonOutput, null, 2);
  await writeFile(outputPath, jsonStr, 'utf-8');
  console.log(`Written: ${outputPath} (${jsonStr.length} bytes)`);
}

main().catch((err: unknown) => {
  console.error('map-converter error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
