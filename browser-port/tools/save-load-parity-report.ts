/**
 * Save-Load Parity Oracle Report — extracts authoritative C++ engine state
 * from every real .sav fixture under fixtures/source-saves/ and emits a
 * structured JSON oracle that downstream differential tests can compare
 * against the TS port's reconstructed state.
 *
 * This is Layer 1 of the parity harness, mirroring CLIaaS's
 * report-ra-source-parity.ts pattern.  It does NOT run the TS port — it
 * just dumps the C++ truth in a form e2e tests can read.
 *
 * Usage:
 *   npx tsx tools/save-load-parity-report.ts          # report-only
 *   npx tsx tools/save-load-parity-report.ts --strict # exit non-zero if
 *                                                       any save fails to
 *                                                       parse
 *
 * Outputs:
 *   test-results/parity/save-load-parity.json
 *   test-results/parity/save-load-parity.md
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { listSaveGameChunks, parseSaveGameInfo, saveDateToTimestamp } from '@generals/engine';
import {
  inspectGameLogicChunkLayout,
  parseSourceGameLogicChunkState,
} from '../packages/app/src/runtime-save-game.js';

const FIX_DIR = resolve(process.cwd(), 'fixtures/source-saves');
// NB: must NOT live under test-results/ — playwright wipes that directory on
// every test run, which would delete the oracle the differential test reads.
const OUTPUT_DIR = resolve(process.cwd(), 'parity-reports');
const JSON_OUTPUT = resolve(OUTPUT_DIR, 'save-load-parity.json');
const MD_OUTPUT = resolve(OUTPUT_DIR, 'save-load-parity.md');
const STRICT = process.argv.includes('--strict');
const REAL_SAVE_SIZE_THRESHOLD = 100_000;

interface SaveOracle {
  file: string;
  bytes: number;
  /** Save header metadata — what the game UI displays. */
  meta: {
    map: string;
    description: string;
    side: string;
    mission: number;
    timestamp: number;
  };
  /** CHUNK_GameLogic layout — frame counter + object counts. */
  gameLogic: {
    layout: string;
    version: number | null;
    frameCounter: number | null;
    objectTocCount: number | null;
    objectCount: number | null;
    polygonTriggerCount: number | null;
    firstObject: {
      templateName: string | null;
      tocId: number | null;
      version: number | null;
      internalName: string | null;
      teamId: number | null;
    };
  };
  /** Distinct template names referenced by the save's object TOC. */
  tocTemplates: string[];
  /** All chunk names present in the save, in file order. */
  chunks: string[];
  /** Parse error if any. */
  error: string | null;
}

interface SaveOracleReport {
  generatedAt: string;
  fixtureDir: string;
  summary: {
    totalRealSaves: number;
    parsed: number;
    failed: number;
    totalObjects: number;
    distinctMissions: number;
    distinctMaps: number;
  };
  saves: SaveOracle[];
}

function bytesToAB(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

function inspectSave(filePath: string): SaveOracle {
  const file = basename(filePath);
  const stat = statSync(filePath);
  const buffer = readFileSync(filePath);
  const ab = bytesToAB(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));

  try {
    const info = parseSaveGameInfo(ab);
    const chunks = listSaveGameChunks(ab);
    const gameLogicChunk = chunks.find((c) => c.blockName === 'CHUNK_GameLogic');

    let layout: SaveOracle['gameLogic'] = {
      layout: 'missing',
      version: null,
      frameCounter: null,
      objectTocCount: null,
      objectCount: null,
      polygonTriggerCount: null,
      firstObject: {
        templateName: null,
        tocId: null,
        version: null,
        internalName: null,
        teamId: null,
      },
    };

    let tocTemplates: string[] = [];

    if (gameLogicChunk) {
      const chunkBytes = new Uint8Array(
        ab,
        gameLogicChunk.blockDataOffset,
        gameLogicChunk.blockSize,
      );
      const chunkAb = bytesToAB(chunkBytes);
      const layoutInfo = inspectGameLogicChunkLayout(chunkAb);
      layout = {
        layout: layoutInfo.layout,
        version: layoutInfo.version,
        frameCounter: layoutInfo.frameCounter,
        objectTocCount: layoutInfo.objectTocCount,
        objectCount: layoutInfo.objectCount,
        polygonTriggerCount: layoutInfo.polygonTriggerCount,
        firstObject: {
          templateName: layoutInfo.firstObjectTemplateName,
          tocId: layoutInfo.firstObjectTocId,
          version: layoutInfo.firstObjectVersion,
          internalName: layoutInfo.firstObjectInternalName,
          teamId: layoutInfo.firstObjectTeamId,
        },
      };

      const fullState = parseSourceGameLogicChunkState(chunkAb);
      if (fullState) {
        tocTemplates = [...new Set(fullState.objectTocEntries.map((e) => e.templateName))]
          .filter((t) => t.length > 0)
          .sort();
      }
    }

    return {
      file,
      bytes: stat.size,
      meta: {
        map: info.mapLabel || info.missionMapName,
        description: info.description,
        side: info.campaignSide,
        mission: info.missionNumber,
        timestamp: saveDateToTimestamp(info.date),
      },
      gameLogic: layout,
      tocTemplates,
      chunks: chunks.map((c) => c.blockName),
      error: null,
    };
  } catch (e) {
    return {
      file,
      bytes: stat.size,
      meta: { map: '', description: '', side: '', mission: -1, timestamp: 0 },
      gameLogic: {
        layout: 'error',
        version: null,
        frameCounter: null,
        objectTocCount: null,
        objectCount: null,
        polygonTriggerCount: null,
        firstObject: {
          templateName: null,
          tocId: null,
          version: null,
          internalName: null,
          teamId: null,
        },
      },
      tocTemplates: [],
      chunks: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildReport(): SaveOracleReport {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = readdirSync(FIX_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sav'))
    .map((f) => resolve(FIX_DIR, f))
    .filter((p) => statSync(p).size > REAL_SAVE_SIZE_THRESHOLD)
    .sort();

  const saves = files.map(inspectSave);
  const parsed = saves.filter((s) => s.error === null);
  const failed = saves.filter((s) => s.error !== null);
  const totalObjects = parsed.reduce((acc, s) => acc + (s.gameLogic.objectCount ?? 0), 0);
  const distinctMissions = new Set(parsed.map((s) => `${s.meta.map}|m${s.meta.mission}|${s.meta.side}`)).size;
  const distinctMaps = new Set(parsed.map((s) => s.meta.map)).size;

  return {
    generatedAt: new Date().toISOString(),
    fixtureDir: FIX_DIR,
    summary: {
      totalRealSaves: saves.length,
      parsed: parsed.length,
      failed: failed.length,
      totalObjects,
      distinctMissions,
      distinctMaps,
    },
    saves,
  };
}

function renderMarkdown(report: SaveOracleReport): string {
  const lines: string[] = [];
  lines.push('# Save-Load Parity Oracle');
  lines.push('');
  lines.push('C++ engine ground-truth state extracted from `fixtures/source-saves/`.');
  lines.push('Downstream differential tests load the same `.sav` files into the TS');
  lines.push('port and assert TS == C++ for every field listed here.');
  lines.push('');
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push(`- real saves: ${report.summary.totalRealSaves}`);
  lines.push(`- parsed cleanly: ${report.summary.parsed}`);
  lines.push(`- parse failures: ${report.summary.failed}`);
  lines.push(`- total live C++ objects in oracle: ${report.summary.totalObjects.toLocaleString()}`);
  lines.push(`- distinct missions covered: ${report.summary.distinctMissions}`);
  lines.push(`- distinct maps covered: ${report.summary.distinctMaps}`);
  lines.push('');
  lines.push('## Per-Save Oracle Data');
  lines.push('');
  lines.push('| fixture | map | side | frame | objects | first object |');
  lines.push('|---|---|---|---|---|---|');
  for (const save of report.saves) {
    const first = save.gameLogic.firstObject;
    const firstLabel = first.templateName ? `${first.templateName} (toc=${first.tocId})` : '—';
    lines.push(`| ${save.file} | ${save.meta.map || '—'} | ${save.meta.side || '—'} | ${save.gameLogic.frameCounter ?? '—'} | ${save.gameLogic.objectCount ?? '—'} | ${firstLabel} |`);
  }
  if (report.summary.failed > 0) {
    lines.push('');
    lines.push('## Parse Failures');
    lines.push('');
    for (const save of report.saves.filter((s) => s.error)) {
      lines.push(`- **${save.file}** — ${save.error}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const report = buildReport();
  writeFileSync(JSON_OUTPUT, JSON.stringify(report, null, 2));
  writeFileSync(MD_OUTPUT, renderMarkdown(report));

  process.stdout.write(`Save-load parity oracle: ${report.summary.parsed}/${report.summary.totalRealSaves} fixtures parsed; ${report.summary.totalObjects.toLocaleString()} live C++ objects extracted across ${report.summary.distinctMissions} missions.\n`);
  if (report.summary.failed > 0) {
    process.stdout.write(`  ${report.summary.failed} parse failures (see ${MD_OUTPUT}).\n`);
    if (STRICT) {
      process.exit(1);
    }
  }
}

main();
