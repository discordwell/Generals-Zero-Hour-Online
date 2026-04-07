import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inspectRuntimeSaveCoreChunkStatus } from '../packages/app/src/runtime-save-game.js';

function main(): void {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: tsx tools/save-core-chunk-report.ts <save-file-path>');
    process.exitCode = 1;
    return;
  }

  const absolutePath = resolve(process.cwd(), inputPath);
  const fileData = readFileSync(absolutePath);
  const chunkStatus = inspectRuntimeSaveCoreChunkStatus(
    fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength),
  );

  process.stdout.write(JSON.stringify({
    savePath: absolutePath,
    coreChunks: chunkStatus,
  }, null, 2));
  process.stdout.write('\n');
}

main();
