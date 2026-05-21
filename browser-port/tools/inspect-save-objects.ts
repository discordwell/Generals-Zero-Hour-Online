/**
 * One-off helper: counts per-template instances in CHUNK_GameLogic objects
 * so we can investigate Layer 1 differential findings (which templates the
 * C++ engine saved but the TS port doesn't restore).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listSaveGameChunks } from '@generals/engine';
import { parseSourceGameLogicChunkState } from '../packages/app/src/runtime-save-game.js';

const filePath = process.argv[2] ?? resolve('fixtures/source-saves/zipeater_GN_000.sav');
const buf = readFileSync(filePath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const chunks = listSaveGameChunks(ab);
const gl = chunks.find((c) => c.blockName === 'CHUNK_GameLogic');
if (!gl) {
  console.error(`No CHUNK_GameLogic in ${filePath}`);
  process.exit(1);
}
const glAb = ab.slice(gl.blockDataOffset, gl.blockDataOffset + gl.blockSize);
const parsed = parseSourceGameLogicChunkState(glAb);
if (!parsed) {
  console.error('Parse failed');
  process.exit(1);
}

const counts = new Map<string, number>();
for (const obj of parsed.objects) {
  const tn = obj.templateName ?? '<unresolved-toc>';
  counts.set(tn, (counts.get(tn) ?? 0) + 1);
}

const interesting = process.argv.slice(3);
if (interesting.length === 0) {
  // Default: dump the 10 most populous templates plus a few diagnostic ones.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Top 10 by instance count:');
  for (const [name, n] of sorted.slice(0, 10)) {
    console.log(`  ${n.toString().padStart(5)}  ${name}`);
  }
  console.log('\nTotal objects:', parsed.objects.length);
  console.log('Distinct templates:', counts.size);
} else {
  for (const t of interesting) {
    console.log(`${t}: ${counts.get(t) ?? 0} instances`);
  }
}
