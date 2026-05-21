/**
 * Runtime Behavior Parity — Layer 1c (advancing-state CRC fingerprint).
 *
 * Layers 0 and 1 prove static and load-time parity but say nothing about
 * what happens when the simulation actually runs.  This test loads each
 * real C++ save fixture, advances the TS engine through deterministic
 * frame checkpoints (Δ=30, 60, 120, 300 frames after the save's start
 * frame), captures the per-section GameLogic CRC at every checkpoint, and
 * compares against a recorded golden fingerprint stored alongside the test.
 *
 * Why this matters: the CRC is computed over the canonical xfer-snapshot
 * of every Object, the PartitionManager, the PlayerList, and TheAI (see
 * GameLogic.cpp:5420 — the C++ source for getCRC()).  If the TS port
 * implements xferSnapshot the same way C++ does, then a stable CRC across
 * runs proves the simulation produces identical state.  Any code change
 * that perturbs entity positions, HP, AI state, etc. by even a single bit
 * will flip the CRC and fail this test.
 *
 * On a missing fingerprint, the test writes the observed value to
 * `parity-reports/runtime-behavior-fingerprints/<fixture>.json` for human
 * review and skips the assertion.  On a present fingerprint, the test
 * asserts byte-equality and fails on any mismatch.
 *
 * NOT a substitute for a real C++ oracle (Layer 3), but it locks down the
 * runtime simulation's deterministic byte-for-byte behavior — if the
 * algorithm matches C++ source, deterministic CRC across runs == identical
 * state.
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORACLE_PATH = resolve('parity-reports/save-load-parity.json');
const FINGERPRINT_DIR = resolve('parity-reports/runtime-behavior-fingerprints');
const FIXTURE_DIR = resolve('fixtures/source-saves');

const CHECKPOINTS = [0, 30, 60, 120, 300] as const;

interface OracleEntry {
  file: string;
  gameLogic: { frameCounter: number | null };
}

interface OracleReport { saves: OracleEntry[] }

interface CheckpointCRCs {
  frame: number;
  total: number;
  sections: Record<string, number>;
}

interface BehaviorFingerprint {
  fixture: string;
  startFrame: number;
  checkpoints: CheckpointCRCs[];
}

function loadOracle(): OracleEntry[] {
  if (!existsSync(ORACLE_PATH)) {
    throw new Error(`Save-load oracle missing: ${ORACLE_PATH}. Run npm run parity:save-load first.`);
  }
  return (JSON.parse(readFileSync(ORACLE_PATH, 'utf8')) as OracleReport).saves;
}

function fingerprintPath(fixture: string): string {
  return resolve(FINGERPRINT_DIR, `${fixture}.json`);
}

function loadFingerprint(fixture: string): BehaviorFingerprint | null {
  const p = fingerprintPath(fixture);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as BehaviorFingerprint;
}

function saveFingerprint(fp: BehaviorFingerprint): void {
  mkdirSync(FINGERPRINT_DIR, { recursive: true });
  writeFileSync(fingerprintPath(fp.fixture), JSON.stringify(fp, null, 2));
}

async function openLoadGameScreen(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Load Game' }).click();
  await expect(page.locator('.load-game-overlay')).toBeVisible({ timeout: 120_000 });
}

async function loadAndCheckpoint(
  page: import('@playwright/test').Page,
  fixture: string,
): Promise<{ startFrame: number; checkpoints: CheckpointCRCs[] }> {
  await openLoadGameScreen(page);

  const fixturePath = resolve(FIXTURE_DIR, fixture);
  await page.locator('[data-ref="load-game-import-input"]').setInputFiles(fixturePath);
  await page.waitForFunction(
    () => document.querySelectorAll('.load-game-row-title').length > 0,
    { timeout: 120_000 },
  );

  // Auto-pause on load so we control frame stepping ourselves.
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

  // Confirm we're paused before stepping.
  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook?.setSimulationPaused?.(true);
  });

  const startFrame = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    return hook.gameLogic.frameCounter as number;
  });

  const checkpoints: CheckpointCRCs[] = [];

  for (const delta of CHECKPOINTS) {
    if (delta > 0) {
      // Step the remaining frames to reach checkpoint Δ from start.
      const prevDelta = checkpoints[checkpoints.length - 1]?.frame ?? startFrame;
      const stepCount = (startFrame + delta) - prevDelta;
      if (stepCount > 0) {
        await page.evaluate((n) => {
          const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
          hook.stepSimulationFrames(n);
        }, stepCount);
      }
    }

    const snapshot = await page.evaluate(() => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      const total = hook.computeGameLogicCrc() as number;
      const sections = hook.computeGameLogicCrcSections() as Record<string, number>;
      return {
        frame: hook.gameLogic.frameCounter as number,
        total,
        sections,
      };
    });
    checkpoints.push(snapshot);
  }

  return { startFrame, checkpoints };
}

const oracle = (() => {
  try { return loadOracle(); }
  catch { return [] as OracleEntry[]; }
})();

// Default to 2 representative fixtures — one Generals, one Zero Hour.
// Set BEHAVIOR_FULL=1 to run all 36.
const DEFAULT_SUBSET = new Set(['zipeater_GN_000.sav', 'zipeater_ZH_000.sav']);
const fixturesToRun = process.env['BEHAVIOR_FULL'] === '1'
  ? oracle
  : oracle.filter((entry) => DEFAULT_SUBSET.has(entry.file));

for (const entry of fixturesToRun) {
  test(`runtime behavior fingerprint: ${entry.file}`, async ({ page }) => {
    test.setTimeout(240_000);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const { startFrame, checkpoints } = await loadAndCheckpoint(page, entry.file);

    // Sanity: the save's recorded frame counter should equal what the TS
    // port reports immediately after load.
    expect(startFrame, `${entry.file}: TS frameCounter mismatch with oracle`).toBe(
      entry.gameLogic.frameCounter,
    );

    // Each checkpoint's frame counter should equal startFrame + delta.
    for (let i = 0; i < CHECKPOINTS.length; i += 1) {
      expect(
        checkpoints[i]!.frame,
        `${entry.file}: checkpoint Δ=${CHECKPOINTS[i]} reached wrong frame`,
      ).toBe(startFrame + CHECKPOINTS[i]!);
    }

    const observed: BehaviorFingerprint = {
      fixture: entry.file,
      startFrame,
      checkpoints,
    };

    const recorded = loadFingerprint(entry.file);
    if (!recorded) {
      // First run — write the fingerprint and skip the equality check.
      saveFingerprint(observed);
      test.info().annotations.push({
        type: 'fingerprint-bootstrap',
        description: `Wrote initial fingerprint for ${entry.file}; re-run to gate.`,
      });
    } else {
      // Equality check — startFrame and every checkpoint's section CRCs must
      // match byte-for-byte.  This is the runtime-determinism gate.
      expect(observed.startFrame, `${entry.file}: startFrame drift`).toBe(recorded.startFrame);
      for (let i = 0; i < CHECKPOINTS.length; i += 1) {
        const obs = observed.checkpoints[i]!;
        const rec = recorded.checkpoints[i]!;
        expect(obs.frame, `${entry.file}: checkpoint Δ=${CHECKPOINTS[i]} frame drift`).toBe(rec.frame);
        expect(
          obs.total,
          `${entry.file}: checkpoint Δ=${CHECKPOINTS[i]} total CRC drift (was 0x${rec.total.toString(16)}, now 0x${obs.total.toString(16)})`,
        ).toBe(rec.total);
        for (const section of Object.keys(rec.sections)) {
          expect(
            obs.sections[section],
            `${entry.file}: checkpoint Δ=${CHECKPOINTS[i]} ${section} CRC drift (was 0x${rec.sections[section]!.toString(16)}, now 0x${(obs.sections[section] ?? 0).toString(16)})`,
          ).toBe(rec.sections[section]);
        }
      }
    }

    expect(errors).toEqual([]);
  });
}
