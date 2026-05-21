/**
 * Save-Load Parity Differential — Layer 1 of the parity harness.
 *
 * For each real .sav fixture, parses the C++ "ground truth" CHUNK_GameLogic
 * directly (frame counter, object count, first-object metadata), loads the
 * SAME fixture into the TS port via the load-game UI, captures the TS-side
 * runtime state via __GENERALS_E2E__, and asserts the two agree.
 *
 * Mirrors CLIaaS report-ra-agent-parity.ts but using the recorded C++ save
 * as the oracle instead of a co-running WASM engine.
 *
 * The oracle JSON must be regenerated first:
 *   npx tsx tools/save-load-parity-report.ts
 *
 * Then run:
 *   npx playwright test e2e/save-load-parity.e2e.ts
 *
 * On success the per-test "parity-coverage" annotation captures the
 * covered/missing template counts so a downstream reporter can compute the
 * cross-fixture diff matrix.
 */
import { expect, test } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORACLE_PATH = resolve('parity-reports/save-load-parity.json');
const FIXTURE_DIR = resolve('fixtures/source-saves');

interface SaveOracleEntry {
  file: string;
  meta: { map: string; description: string; side: string };
  gameLogic: {
    frameCounter: number | null;
    objectCount: number | null;
    firstObject: {
      templateName: string | null;
      tocId: number | null;
    };
  };
  tocTemplates: string[];
}

interface SaveOracleReport {
  saves: SaveOracleEntry[];
}

function loadOracle(): SaveOracleEntry[] {
  if (!existsSync(ORACLE_PATH)) {
    throw new Error(
      `Save-load oracle missing: ${ORACLE_PATH}. ` +
      `Run "npx tsx tools/save-load-parity-report.ts" first.`,
    );
  }
  const json = JSON.parse(readFileSync(ORACLE_PATH, 'utf8')) as SaveOracleReport;
  return json.saves;
}

async function openLoadGameScreen(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Load Game' }).click();
  await expect(page.locator('.load-game-overlay')).toBeVisible({ timeout: 120_000 });
}

async function loadFixtureAndCapture(
  page: import('@playwright/test').Page,
  fixture: string,
): Promise<{ frameCounter: number; objectCount: number; spawnedTemplateNames: string[] }> {
  await openLoadGameScreen(page);

  const fixturePath = resolve(FIXTURE_DIR, fixture);
  await page.locator('[data-ref="load-game-import-input"]').setInputFiles(fixturePath);
  // Wait for any row to appear after import.
  await page.waitForFunction(
    () => document.querySelectorAll('.load-game-row-title').length > 0,
    { timeout: 120_000 },
  );

  // Pause the simulation on next load so we can inspect the immediately-loaded state.
  await page.evaluate(() => {
    (window as Record<string, unknown>)['__GENERALS_E2E_AUTO_PAUSE__'] = true;
  });

  await page.locator('.load-game-overlay [data-action="load"]').click();
  await page.locator('.load-game-overlay [data-action="confirm-load"]').click();

  await page.waitForFunction(
    () => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']),
    { timeout: 120_000 },
  );
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  return await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook?.setSimulationPaused?.(true);
    const logic = hook.gameLogic;
    const spawned = Array.from(logic.spawnedEntities.values()) as Array<{
      templateName?: string;
      destroyed?: boolean;
    }>;
    // Capture ALL spawned templates (including destroyed) for diagnostic
    // purposes — destroyed-but-saved C++ objects still count as TS load
    // success if their entity record exists.
    const allTemplates = spawned
      .map((e) => e.templateName ?? '')
      .filter((name) => name.length > 0);
    const aliveTemplates = spawned
      .filter((e) => !e.destroyed)
      .map((e) => e.templateName ?? '')
      .filter((name) => name.length > 0);
    return {
      frameCounter: logic.frameCounter as number,
      objectCount: spawned.filter((e) => !e.destroyed).length,
      spawnedTemplateNames: allTemplates,
      aliveTemplateNames: aliveTemplates,
    };
  });
}

const oracle = (() => {
  try {
    return loadOracle();
  } catch {
    return [] as SaveOracleEntry[];
  }
})();

// Filter to a handful of representative saves to keep runtime bounded —
// cover one Generals + one Zero Hour + one Challenge fixture by default.
// CI can opt into the full set via PARITY_FULL=1.
const DEFAULT_SUBSET = new Set([
  'zipeater_GN_000.sav',
  'zipeater_ZH_000.sav',
  'zipeater_ZH_030.sav',
]);

const fixturesToRun = process.env['PARITY_FULL'] === '1'
  ? oracle
  : oracle.filter((entry) => DEFAULT_SUBSET.has(entry.file));

for (const entry of fixturesToRun) {
  test(`save-load parity vs C++ oracle: ${entry.file}`, async ({ page }) => {
    test.setTimeout(240_000);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const tsState = await loadFixtureAndCapture(page, entry.file);

    // Frame counter must match exactly — TS load must restore C++ frame.
    expect(tsState.frameCounter, `${entry.file}: frame counter`).toBe(
      entry.gameLogic.frameCounter,
    );

    // Object count tolerance: the C++ oracle counts every object in
    // CHUNK_GameLogic including destroyed-but-still-saved objects.  The TS
    // port skips destroyed objects when populating spawnedEntities.  Allow
    // TS to be at most equal to C++ count (TS <= C++) — any TS-only entity
    // would be a load-time fabrication bug.
    expect(
      tsState.objectCount,
      `${entry.file}: TS object count should not exceed C++ (${entry.gameLogic.objectCount})`,
    ).toBeLessThanOrEqual(entry.gameLogic.objectCount ?? Infinity);

    // Template-coverage check: the TS spawn set must cover ≥80% of the C++
    // save's distinct object templates.  Computing on distinct templates (not
    // per-entity) keeps the threshold meaningful — every template the C++
    // engine knew about should be reconstructable.  Templates the TS port
    // intentionally drops (SYSTEM / INERT KindOf decals like VerticalArrow)
    // are tolerated by the threshold; >80% means substantive load parity.
    const tsTemplateSet = new Set(tsState.spawnedTemplateNames);
    const oracleTemplates = entry.tocTemplates ?? [];
    const covered = oracleTemplates.filter((t) => tsTemplateSet.has(t));
    const missing = oracleTemplates.filter((t) => !tsTemplateSet.has(t));
    const coverage = oracleTemplates.length === 0 ? 1 : covered.length / oracleTemplates.length;

    // Attach finding metadata so downstream reporters can surface diffs.
    const finding = {
      file: entry.file,
      tsFrameCounter: tsState.frameCounter,
      cppFrameCounter: entry.gameLogic.frameCounter,
      tsObjectCount: tsState.objectCount,
      cppObjectCount: entry.gameLogic.objectCount,
      oracleTemplateCount: oracleTemplates.length,
      coveredTemplateCount: covered.length,
      missingTemplateCount: missing.length,
      missingTemplates: missing,
      coveragePercent: Math.round(coverage * 1000) / 10,
    };
    test.info().annotations.push({
      type: 'parity-coverage',
      description: JSON.stringify(finding),
    });

    // Also write a structured finding to parity-reports/ so a tool can roll
    // these up across fixtures.  Each test writes its own file to avoid
    // collisions when tests run in parallel.
    mkdirSync(resolve('parity-reports/save-load-findings'), { recursive: true });
    writeFileSync(
      resolve('parity-reports/save-load-findings', `${entry.file}.json`),
      JSON.stringify(finding, null, 2),
    );

    // Template-coverage gate: TS port must reconstruct every distinct template
    // the C++ save references.  The check counts ALL spawned entities (alive +
    // destroyed) because hulks, debris, and expired decals are legitimately
    // saved in a destroyed state — a "missing" template there was a measurement
    // artifact, not a real load gap.
    //
    // 100% coverage on every fixture as of 2026-05-20.  Drop below this
    // threshold and the harness flags a real load-time regression.
    const COVERAGE_BASELINE = 1.0;
    expect(
      coverage,
      `${entry.file}: TS port spawns ${covered.length}/${oracleTemplates.length} (${(coverage * 100).toFixed(1)}%) of C++ save's distinct templates. Missing examples: ${missing.slice(0, 5).join(', ')}`,
    ).toBeGreaterThanOrEqual(COVERAGE_BASELINE);

    expect(errors).toEqual([]);
  });
}
