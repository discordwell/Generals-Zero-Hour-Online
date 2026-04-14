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
import { parsedMapToJSON } from './map-json.js';

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

  const jsonOutput = parsedMapToJSON(parsed);

  const jsonStr = JSON.stringify(jsonOutput, null, 2);
  await writeFile(outputPath, jsonStr, 'utf-8');
  console.log(`Written: ${outputPath} (${jsonStr.length} bytes)`);
}

main().catch((err: unknown) => {
  console.error('map-converter error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
