/**
 * Oracle Parity Differential — runs the native C++ oracle binary on every
 * real .sav fixture, parses the same fixture in TS via @generals/engine,
 * and reports per-fixture chunk-list agreement.
 *
 * The oracle is an INDEPENDENT C++ implementation built from
 * `tools/oracle/`.  If it agrees with the TS parser on every chunk name,
 * offset, and size for every fixture, that's strong evidence the TS save
 * loader matches the C++ byte format.
 *
 * Build the oracle first:
 *   conda run -n oracle bash -c 'cd tools/oracle && cmake -S . -B build -G "Unix Makefiles" -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ -DCMAKE_MAKE_PROGRAM=make && cmake --build build'
 *
 * Then run:
 *   npx tsx tools/oracle-parity-report.ts
 *
 * Output: parity-reports/oracle-parity.{json,md}
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { listSaveGameChunks } from '@generals/engine';
import {
  inspectGameLogicChunkLayout,
  parseSourceGameLogicChunkState,
} from '../packages/app/src/runtime-save-game.js';

const FIXTURE_DIR = resolve(process.cwd(), 'fixtures/source-saves');
const ORACLE_BIN = resolve(process.cwd(), 'tools/oracle/build/oracle.exe');
const OUTPUT_DIR = resolve(process.cwd(), 'parity-reports');
const JSON_OUT = resolve(OUTPUT_DIR, 'oracle-parity.json');
const MD_OUT = resolve(OUTPUT_DIR, 'oracle-parity.md');
const STRICT = process.argv.includes('--strict');
const REAL_SAVE_SIZE_THRESHOLD = 100_000;

interface OracleChunk {
  name: string;
  blockStartOffset: number;
  blockDataOffset: number;
  blockSize: number;
}

interface OracleTocEntry {
  templateName: string;
  id: number;
}

interface OracleObject {
  tocId: number;
  templateName: string;
  blockDataOffset: number;
  blockSize: number;
}

interface OracleGameLogic {
  version: number;
  frameCounter: number;
  tocVersion: number;
  tocCount: number;
  objectCount: number;
  toc: OracleTocEntry[];
  objects: OracleObject[];
}

interface OracleResult {
  fixture: string;
  fileSize: number;
  chunkCount: number;
  chunks: OracleChunk[];
  gameLogic?: OracleGameLogic;
}

interface Mismatch {
  fixture: string;
  message: string;
  oracleChunk?: OracleChunk | null;
  tsChunk?: OracleChunk | null;
}

interface FixtureReport {
  fixture: string;
  cppChunkCount: number;
  tsChunkCount: number;
  cppFrame: number | null;
  tsFrame: number | null;
  cppObjectCount: number | null;
  tsObjectCount: number | null;
  cppTocCount: number | null;
  tsTocCount: number | null;
  agree: boolean;
  mismatches: Mismatch[];
}

interface Report {
  generatedAt: string;
  oracleBinary: string;
  fixtureDir: string;
  summary: {
    fixtureCount: number;
    agreeing: number;
    diverging: number;
    totalMismatches: number;
  };
  fixtures: FixtureReport[];
}

function runOracle(savePath: string): OracleResult {
  const stdout = execFileSync(ORACLE_BIN, [savePath], { encoding: 'utf8' });
  return JSON.parse(stdout) as OracleResult;
}

function bytesToAB(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

function listTsChunks(savePath: string): OracleChunk[] {
  const buf = readFileSync(savePath);
  const ab = bytesToAB(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return listSaveGameChunks(ab).map((c) => ({
    name: c.blockName,
    blockStartOffset: c.blockStartOffset,
    blockDataOffset: c.blockDataOffset,
    blockSize: c.blockSize,
  }));
}

function diffChunks(cpp: OracleChunk[], ts: OracleChunk[], fixture: string): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const limit = Math.max(cpp.length, ts.length);
  for (let i = 0; i < limit; i++) {
    const c = cpp[i];
    const t = ts[i];
    if (!c && t) {
      mismatches.push({
        fixture,
        message: `extra chunk in TS (oracle ran out): ${t.name}@${t.blockStartOffset}`,
        tsChunk: t,
      });
      continue;
    }
    if (c && !t) {
      mismatches.push({
        fixture,
        message: `extra chunk in oracle (TS ran out): ${c.name}@${c.blockStartOffset}`,
        oracleChunk: c,
      });
      continue;
    }
    if (!c || !t) continue;
    if (c.name !== t.name) {
      mismatches.push({
        fixture,
        message: `chunk ${i} name: oracle=${c.name} ts=${t.name}`,
        oracleChunk: c,
        tsChunk: t,
      });
    }
    if (c.blockStartOffset !== t.blockStartOffset) {
      mismatches.push({
        fixture,
        message: `chunk ${i} blockStartOffset: oracle=${c.blockStartOffset} ts=${t.blockStartOffset}`,
        oracleChunk: c,
        tsChunk: t,
      });
    }
    if (c.blockDataOffset !== t.blockDataOffset) {
      mismatches.push({
        fixture,
        message: `chunk ${i} blockDataOffset: oracle=${c.blockDataOffset} ts=${t.blockDataOffset}`,
        oracleChunk: c,
        tsChunk: t,
      });
    }
    if (c.blockSize !== t.blockSize) {
      mismatches.push({
        fixture,
        message: `chunk ${i} blockSize: oracle=${c.blockSize} ts=${t.blockSize}`,
        oracleChunk: c,
        tsChunk: t,
      });
    }
  }
  return mismatches;
}

function buildReport(): Report {
  if (!existsSync(ORACLE_BIN)) {
    throw new Error(
      `oracle binary missing: ${ORACLE_BIN}\n` +
      `Build it first: see tools/oracle/README.md`,
    );
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = readdirSync(FIXTURE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sav'))
    .map((f) => resolve(FIXTURE_DIR, f))
    .filter((p) => statSync(p).size > REAL_SAVE_SIZE_THRESHOLD)
    .sort();

  const fixtures: FixtureReport[] = [];
  for (const savePath of files) {
    const fixture = basename(savePath);
    try {
      const oracle = runOracle(savePath);
      const ts = listTsChunks(savePath);
      const mismatches = diffChunks(oracle.chunks, ts, fixture);

      // Layer 3 v2: also compare CHUNK_GameLogic header (frame counter,
      // object count, TOC count + entries).  Uses the existing TS port
      // parsers so this is a real C++ vs TS differential.
      let cppFrame: number | null = oracle.gameLogic?.frameCounter ?? null;
      let cppObjectCount: number | null = oracle.gameLogic?.objectCount ?? null;
      let cppTocCount: number | null = oracle.gameLogic?.tocCount ?? null;
      let tsFrame: number | null = null;
      let tsObjectCount: number | null = null;
      let tsTocCount: number | null = null;

      const buf = readFileSync(savePath);
      const ab = bytesToAB(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      const gameLogicChunk = ts.find((c) => c.name === 'CHUNK_GameLogic');
      if (gameLogicChunk) {
        const chunkBytes = new Uint8Array(ab, gameLogicChunk.blockDataOffset, gameLogicChunk.blockSize);
        const chunkAb = bytesToAB(chunkBytes);
        const layout = inspectGameLogicChunkLayout(chunkAb);
        tsFrame = layout.frameCounter;
        tsObjectCount = layout.objectCount;
        tsTocCount = layout.objectTocCount;
      }

      if (cppFrame !== tsFrame) {
        mismatches.push({ fixture, message: `CHUNK_GameLogic frameCounter: oracle=${cppFrame} ts=${tsFrame}` });
      }
      if (cppObjectCount !== tsObjectCount) {
        mismatches.push({ fixture, message: `CHUNK_GameLogic objectCount: oracle=${cppObjectCount} ts=${tsObjectCount}` });
      }
      if (cppTocCount !== tsTocCount) {
        mismatches.push({ fixture, message: `CHUNK_GameLogic tocCount: oracle=${cppTocCount} ts=${tsTocCount}` });
      }

      // Compare TOC + per-object headers — confirms oracle's parser
      // produces the same templateName strings, tocIds, and per-object
      // blockSizes as the TS port across the entire CHUNK_GameLogic.
      if (gameLogicChunk && oracle.gameLogic) {
        const chunkBytes = new Uint8Array(ab, gameLogicChunk.blockDataOffset, gameLogicChunk.blockSize);
        const fullState = parseSourceGameLogicChunkState(bytesToAB(chunkBytes));
        if (fullState) {
          const cppToc = oracle.gameLogic.toc;
          const tsToc = fullState.objectTocEntries;
          const tocLimit = Math.min(cppToc.length, tsToc.length);
          for (let i = 0; i < tocLimit; i++) {
            if (cppToc[i]!.templateName !== tsToc[i]!.templateName) {
              mismatches.push({
                fixture,
                message: `CHUNK_GameLogic toc[${i}] templateName: oracle=${cppToc[i]!.templateName} ts=${tsToc[i]!.templateName}`,
              });
            }
            if (cppToc[i]!.id !== tsToc[i]!.tocId) {
              mismatches.push({
                fixture,
                message: `CHUNK_GameLogic toc[${i}] id: oracle=${cppToc[i]!.id} ts=${tsToc[i]!.tocId}`,
              });
            }
          }

          // v3: per-object header diff (templateName + blockSize).  TS's
          // parsed objects array matches C++'s order — both walk the same
          // bytes — so a positional diff catches any per-entity
          // misalignment that would shift the rest of the stream.
          const cppObjs = oracle.gameLogic.objects;
          const tsObjs = fullState.objects;
          if (cppObjs.length !== tsObjs.length) {
            mismatches.push({
              fixture,
              message: `CHUNK_GameLogic object count: oracle=${cppObjs.length} ts=${tsObjs.length}`,
            });
          }
          const objLimit = Math.min(cppObjs.length, tsObjs.length);
          for (let i = 0; i < objLimit; i++) {
            const co = cppObjs[i]!;
            const to = tsObjs[i]!;
            if (co.templateName !== (to.templateName ?? '')) {
              mismatches.push({
                fixture,
                message: `CHUNK_GameLogic object[${i}] templateName: oracle=${co.templateName} ts=${to.templateName ?? '<null>'}`,
              });
            }
            const tsBlockBytes = to.blockData?.byteLength ?? -1;
            if (co.blockSize !== tsBlockBytes) {
              mismatches.push({
                fixture,
                message: `CHUNK_GameLogic object[${i}] blockSize: oracle=${co.blockSize} ts=${tsBlockBytes}`,
              });
            }
          }
        }
      }

      fixtures.push({
        fixture,
        cppChunkCount: oracle.chunks.length,
        tsChunkCount: ts.length,
        cppFrame,
        tsFrame,
        cppObjectCount,
        tsObjectCount,
        cppTocCount,
        tsTocCount,
        agree: mismatches.length === 0,
        mismatches,
      });
    } catch (e) {
      fixtures.push({
        fixture,
        cppChunkCount: 0,
        tsChunkCount: 0,
        cppFrame: null,
        tsFrame: null,
        cppObjectCount: null,
        tsObjectCount: null,
        cppTocCount: null,
        tsTocCount: null,
        agree: false,
        mismatches: [{ fixture, message: `oracle invocation failed: ${(e as Error).message}` }],
      });
    }
  }

  const agreeing = fixtures.filter((f) => f.agree).length;
  return {
    generatedAt: new Date().toISOString(),
    oracleBinary: ORACLE_BIN,
    fixtureDir: FIXTURE_DIR,
    summary: {
      fixtureCount: fixtures.length,
      agreeing,
      diverging: fixtures.length - agreeing,
      totalMismatches: fixtures.reduce((acc, f) => acc + f.mismatches.length, 0),
    },
    fixtures,
  };
}

function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push('# Oracle Parity Differential');
  lines.push('');
  lines.push('Diffs the headless C++ oracle (`tools/oracle/build/oracle.exe`)');
  lines.push('against the TS port\'s `listSaveGameChunks` for every real .sav');
  lines.push('fixture under `fixtures/source-saves/`.  100% agreement proves');
  lines.push('the TS save-chunk parser matches the original C++ byte format.');
  lines.push('');
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push(`- fixtures: ${report.summary.fixtureCount}`);
  lines.push(`- agreeing (TS == C++): ${report.summary.agreeing}`);
  lines.push(`- diverging: ${report.summary.diverging}`);
  lines.push(`- total mismatches: ${report.summary.totalMismatches}`);
  lines.push('');
  lines.push('## Per-fixture results');
  lines.push('');
  lines.push('| fixture | C++/TS chunks | C++/TS frame | C++/TS objects | C++/TS TOC | agree |');
  lines.push('|---|---|---|---|---|---|');
  for (const f of report.fixtures) {
    lines.push(
      `| ${f.fixture} | ${f.cppChunkCount}/${f.tsChunkCount} | ${f.cppFrame}/${f.tsFrame} | ${f.cppObjectCount}/${f.tsObjectCount} | ${f.cppTocCount}/${f.tsTocCount} | ${f.agree ? '✅' : '❌'} |`,
    );
  }
  if (report.summary.diverging > 0) {
    lines.push('');
    lines.push('## Mismatch detail');
    lines.push('');
    for (const f of report.fixtures.filter((x) => !x.agree)) {
      lines.push(`### ${f.fixture}`);
      lines.push('');
      for (const m of f.mismatches) {
        lines.push(`- ${m.message}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

const report = buildReport();
writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
writeFileSync(MD_OUT, renderMarkdown(report));

process.stdout.write(
  `Oracle parity: ${report.summary.agreeing}/${report.summary.fixtureCount} fixtures agree; ${report.summary.totalMismatches} total mismatches.\n`,
);
if (report.summary.diverging > 0 && STRICT) {
  process.exit(1);
}
