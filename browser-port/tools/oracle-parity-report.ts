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

interface OracleResult {
  fixture: string;
  fileSize: number;
  chunkCount: number;
  chunks: OracleChunk[];
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
      fixtures.push({
        fixture,
        cppChunkCount: oracle.chunks.length,
        tsChunkCount: ts.length,
        agree: mismatches.length === 0,
        mismatches,
      });
    } catch (e) {
      fixtures.push({
        fixture,
        cppChunkCount: 0,
        tsChunkCount: 0,
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
  lines.push('| fixture | C++ chunks | TS chunks | agree | mismatches |');
  lines.push('|---|---|---|---|---|');
  for (const f of report.fixtures) {
    lines.push(`| ${f.fixture} | ${f.cppChunkCount} | ${f.tsChunkCount} | ${f.agree ? '✅' : '❌'} | ${f.mismatches.length} |`);
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
