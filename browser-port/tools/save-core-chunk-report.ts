import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listSaveGameChunks } from '@generals/engine';
import {
  inspectGameLogicChunkLayout,
  inspectRuntimeSaveCoreChunkStatus,
} from '../packages/app/src/runtime-save-game.js';

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
  const chunkList = listSaveGameChunks(
    fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength),
  );
  const gameLogicChunk = chunkList.find((chunk) => chunk.blockName === 'CHUNK_GameLogic');
  const gameLogicLayout = gameLogicChunk
    ? inspectGameLogicChunkLayout(
      new Uint8Array(
        fileData.buffer,
        fileData.byteOffset + gameLogicChunk.blockDataOffset,
        gameLogicChunk.blockSize,
      ).slice(),
    )
    : null;

  process.stdout.write(JSON.stringify({
    savePath: absolutePath,
    coreChunks: chunkStatus,
    gameLogicLayout,
  }, null, 2));
  process.stdout.write('\n');
}

main();
