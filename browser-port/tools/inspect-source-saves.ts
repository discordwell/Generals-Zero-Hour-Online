/**
 * One-off inspector: prints metadata for each real source-save fixture so we
 * can group them by mission and order them by in-game date.  Used to design
 * the save-chain differential harness — adjacent saves in chronological order
 * within the same mission form a valid C++ "oracle" pair.
 */
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSaveGameInfo, saveDateToTimestamp } from '@generals/engine';

const FIX_DIR = resolve(process.cwd(), 'fixtures/source-saves');
const files = readdirSync(FIX_DIR)
  .filter((f) => f.endsWith('.sav') && statSync(resolve(FIX_DIR, f)).size > 100_000)
  .sort();

const rows: Array<{file: string; map: string; mission: number; side: string; ts: number; desc: string}> = [];
for (const f of files) {
  try {
    const buf = readFileSync(resolve(FIX_DIR, f));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const info = parseSaveGameInfo(ab as ArrayBuffer);
    rows.push({
      file: f,
      map: info.mapLabel || info.missionMapName,
      mission: info.missionNumber,
      side: info.campaignSide,
      ts: saveDateToTimestamp(info.date),
      desc: info.description.slice(0, 40),
    });
  } catch (e) {
    console.error(`${f}: ${(e as Error).message}`);
  }
}

// Group by map
const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const key = `${r.map}|m${r.mission}|${r.side}`;
  const arr = groups.get(key) ?? [];
  arr.push(r);
  groups.set(key, arr);
}

for (const [key, list] of groups) {
  list.sort((a, b) => a.ts - b.ts);
  console.log(`\n=== ${key} (${list.length} saves) ===`);
  for (const r of list) {
    console.log(`  ${r.file}  ts=${r.ts}  "${r.desc}"`);
  }
}
