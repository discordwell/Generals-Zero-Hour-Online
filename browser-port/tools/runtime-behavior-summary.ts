/**
 * Aggregates per-fixture runtime-behavior fingerprints into a single
 * human-readable summary (and JSON roll-up) so we can spot patterns
 * across the corpus — e.g., which fixtures have idle AI, which have
 * heavy entity churn, which sections of the state are most volatile.
 *
 * Usage:
 *   npx tsx tools/runtime-behavior-summary.ts
 *
 * Reads:  parity-reports/runtime-behavior-fingerprints/*.json
 * Writes: parity-reports/runtime-behavior-summary.{json,md}
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FINGERPRINT_DIR = resolve(process.cwd(), 'parity-reports/runtime-behavior-fingerprints');
const OUT_DIR = resolve(process.cwd(), 'parity-reports');
const JSON_OUT = resolve(OUT_DIR, 'runtime-behavior-summary.json');
const MD_OUT = resolve(OUT_DIR, 'runtime-behavior-summary.md');

interface Checkpoint {
  frame: number;
  total: number;
  sections: Record<string, number>;
}
interface Fingerprint {
  fixture: string;
  startFrame: number;
  checkpoints: Checkpoint[];
}

const files = readdirSync(FINGERPRINT_DIR).filter((f) => f.endsWith('.json')).sort();
const prints: Fingerprint[] = files.map((f) =>
  JSON.parse(readFileSync(resolve(FINGERPRINT_DIR, f), 'utf8')) as Fingerprint,
);

const summary = {
  generatedAt: new Date().toISOString(),
  fixtureCount: prints.length,
  fixtures: prints.map((fp) => {
    const sectionVolatility: Record<string, number> = {};
    const firstSections = fp.checkpoints[0]?.sections ?? {};
    const lastSections = fp.checkpoints[fp.checkpoints.length - 1]?.sections ?? {};
    for (const section of Object.keys(firstSections)) {
      sectionVolatility[section] = firstSections[section] !== lastSections[section] ? 1 : 0;
    }
    return {
      fixture: fp.fixture,
      startFrame: fp.startFrame,
      endFrame: fp.checkpoints[fp.checkpoints.length - 1]?.frame ?? fp.startFrame,
      checkpointCount: fp.checkpoints.length,
      sectionVolatility,
    };
  }),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));

const mdLines: string[] = [];
mdLines.push('# Runtime Behavior Fingerprint Summary');
mdLines.push('');
mdLines.push(`Generated: ${summary.generatedAt}`);
mdLines.push(`Fixtures: ${summary.fixtureCount}`);
mdLines.push('');
mdLines.push('Per-fixture: did each CRC section change between the first and');
mdLines.push('last checkpoint? `1` = state evolved, `0` = constant across the');
mdLines.push('captured window.  A `0` for `objects` would be unusual — should');
mdLines.push('be `1` for any fixture with moving units or active AI.');
mdLines.push('');
mdLines.push('| fixture | start | end | objects | partitionManager | playerList | ai |');
mdLines.push('|---|---|---|---|---|---|---|');
for (const f of summary.fixtures) {
  const v = f.sectionVolatility;
  mdLines.push(`| ${f.fixture} | ${f.startFrame} | ${f.endFrame} | ${v.objects ?? '?'} | ${v.partitionManager ?? '?'} | ${v.playerList ?? '?'} | ${v.ai ?? '?'} |`);
}
mdLines.push('');
writeFileSync(MD_OUT, mdLines.join('\n'));

process.stdout.write(
  `Runtime behavior summary: ${summary.fixtureCount} fixtures → ${JSON_OUT}\n`,
);
