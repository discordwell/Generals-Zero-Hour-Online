import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSaveGameInfo } from '@generals/engine';

/**
 * Loads real source-save fixtures, then runs the simulation forward 300 frames
 * (10 sim seconds at 30Hz) to verify the loaded state evolves without NaN
 * positions, page errors, or premature game-end transitions.
 *
 * Complements source-save-fixture-load (which only verifies loaded state) and
 * source-save-roundtrip (which only verifies save→load→save preserves state)
 * by exercising the simulation path that real save resume actually depends on.
 */

const SIMULATION_FRAME_COUNT = 300;

async function openLoadGameScreen(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Load Game' }).click();
  await expect(page.locator('.load-game-overlay')).toBeVisible({ timeout: 120_000 });
}

async function waitForE2EHook(
  page: import('@playwright/test').Page,
  diagnostics: readonly string[],
): Promise<void> {
  try {
    await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
      timeout: 90_000,
    });
  } catch (error) {
    const loadingStatus = await page.locator('#loading-status').textContent().catch(() => null);
    throw new Error([
      `Timed out waiting for loaded game hook at status "${loadingStatus ?? '<missing>'}".`,
      ...diagnostics.slice(-20),
      error instanceof Error ? error.message : String(error),
    ].join('\n'));
  }
}

interface SimulationFixture {
  fileName: string;
  title: string;
}

interface SourceSaveMapAssetReport {
  requiredMaps?: Array<{
    availableOutputPath?: string | null;
    saveFiles?: string[];
  }>;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function loadAutoSimulationFixtures(): SimulationFixture[] {
  const reportPath = resolve('source-save-map-asset-report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SourceSaveMapAssetReport;
  const fixtures: SimulationFixture[] = [];
  const seen = new Set<string>();

  for (const map of report.requiredMaps ?? []) {
    if (!map.availableOutputPath) {
      continue;
    }
    for (const fileName of [...(map.saveFiles ?? [])].sort()) {
      if (seen.has(fileName)) {
        continue;
      }
      const saveBytes = readFileSync(resolve('fixtures/source-saves', fileName));
      const saveInfo = parseSaveGameInfo(bufferToArrayBuffer(saveBytes));
      fixtures.push({
        fileName,
        title: saveInfo.description,
      });
      seen.add(fileName);
    }
  }

  for (const fileName of readdirSync(resolve('fixtures/source-saves')).filter((entry) => entry.endsWith('.sav')).sort()) {
    if (seen.has(fileName)) {
      continue;
    }
    const saveBytes = readFileSync(resolve('fixtures/source-saves', fileName));
    const saveInfo = parseSaveGameInfo(bufferToArrayBuffer(saveBytes));
    fixtures.push({
      fileName,
      title: saveInfo.description,
    });
    seen.add(fileName);
  }

  return fixtures.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

const simulationFixtures: SimulationFixture[] = [
  {
    fileName: 'zipeater_GN_000.sav',
    title: 'Brutal Start - Training ',
  },
  {
    fileName: 'zipeater_GN_016.sav',
    title: 'Brutal Start - USA 2 ',
  },
  {
    fileName: 'zipeater_GN_038.sav',
    title: 'Normal Start - USA 2 ',
  },
  {
    fileName: 'zipeater_ZH_000.sav',
    title: 'Hard Start - USA',
  },
  {
    fileName: 'zipeater_ZH_005.sav',
    title: 'Hard Start - GLA',
  },
  {
    fileName: 'zipeater_ZH_010.sav',
    title: 'Hard Start - China',
  },
  {
    fileName: 'zipeater_ZH_038.sav',
    title: 'Hard Air Force - 2 - Nuke',
  },
  {
    fileName: 'zipeater_ZH_160.sav',
    title: 'Brutal Finale - China Nuke Party',
  },
  {
    fileName: 'zipeater_ZH_162.sav',
    title: "Brutal Finale - General Alexander's Particle Party",
  },
];

const crcRepeatFixtureNames = new Set([
  'zipeater_GN_000.sav',
  'zipeater_GN_016.sav',
  'zipeater_GN_038.sav',
  'zipeater_ZH_000.sav',
  'zipeater_ZH_005.sav',
  'zipeater_ZH_010.sav',
  'zipeater_ZH_038.sav',
  'zipeater_ZH_160.sav',
  'zipeater_ZH_162.sav',
]);

const crcRepeatFixtures = simulationFixtures.filter((fixture) =>
  crcRepeatFixtureNames.has(fixture.fileName));

const exhaustiveSimulationFixtures: SimulationFixture[] = (() => {
  if (process.env.SOURCE_SAVE_SIMULATION_EXHAUSTIVE !== '1') {
    return [];
  }
  const curated = new Set(simulationFixtures.map((fixture) => fixture.fileName));
  return loadAutoSimulationFixtures().filter((fixture) => !curated.has(fixture.fileName));
})();

interface SourceSaveSimulationSnapshot {
  frame: number;
  entityCount: number;
  nanCount: number;
  sampleNanIds: number[];
  endState: unknown;
  crc: number;
}

interface SourceSaveSimulationRun {
  initialSnapshot: SourceSaveSimulationSnapshot;
  finalSnapshot: SourceSaveSimulationSnapshot;
}

async function loadSourceSaveAndAdvance(
  page: import('@playwright/test').Page,
  fixture: SimulationFixture,
  diagnostics: readonly string[],
): Promise<SourceSaveSimulationRun> {
  await openLoadGameScreen(page);

  const fixturePath = resolve('fixtures/source-saves', fixture.fileName);
  await page.locator('[data-ref="load-game-import-input"]').setInputFiles(fixturePath);
  await expect(page.locator('.load-game-row-title', { hasText: fixture.title })).toBeVisible({
    timeout: 120_000,
  });

  // Pause on the next load so we can record initial state before frames advance.
  await page.evaluate(() => {
    (window as Record<string, unknown>)['__GENERALS_E2E_AUTO_PAUSE__'] = true;
  });

  await page.locator('.load-game-overlay [data-action="load"]').click();
  await page.locator('.load-game-overlay [data-action="confirm-load"]').click();

  await waitForE2EHook(page, diagnostics);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  const initialSnapshot = await page.evaluate((): SourceSaveSimulationSnapshot => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const visual = hook.getVisualDebugState();
    const states = hook.getRenderableEntityStates();
    let nanCount = 0;
    const sampleNanIds: number[] = [];
    for (const state of states) {
      if (!Number.isFinite(state.x) || !Number.isFinite(state.y) || !Number.isFinite(state.z)) {
        nanCount++;
        if (sampleNanIds.length < 5) {
          sampleNanIds.push(state.id ?? -1);
        }
      }
    }
    return {
      frame: visual.frame,
      entityCount: states.length,
      nanCount,
      sampleNanIds,
      endState: hook.getGameEndState(),
      crc: hook.computeGameLogicCrc(visual.frame),
    };
  });

  expect(initialSnapshot.frame).not.toBeNull();
  expect(initialSnapshot.entityCount).toBeGreaterThan(0);
  expect(initialSnapshot.nanCount).toBe(0);
  expect(initialSnapshot.endState).toBeNull();
  expect(Number.isInteger(initialSnapshot.crc)).toBe(true);

  const targetFrame = initialSnapshot.frame + SIMULATION_FRAME_COUNT;

  // Step exactly 300 fixed-timestep frames while paused. This avoids wall-clock
  // overshoot and makes the CRC checkpoint deterministic across repeated loads.
  await page.evaluate((frameCount) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.stepSimulationFrames(frameCount);
  }, SIMULATION_FRAME_COUNT);

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.setSimulationPaused(true);
  });

  const finalSnapshot = await page.evaluate((): SourceSaveSimulationSnapshot => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const visual = hook.getVisualDebugState();
    const states = hook.getRenderableEntityStates();
    let nanCount = 0;
    const sampleNanIds: number[] = [];
    for (const state of states) {
      if (!Number.isFinite(state.x) || !Number.isFinite(state.y) || !Number.isFinite(state.z)) {
        nanCount++;
        if (sampleNanIds.length < 5) {
          sampleNanIds.push(state.id ?? -1);
        }
      }
    }
    return {
      frame: visual.frame,
      entityCount: states.length,
      nanCount,
      sampleNanIds,
      endState: hook.getGameEndState(),
      crc: hook.computeGameLogicCrc(visual.frame),
    };
  });

  expect(finalSnapshot.frame).toBe(targetFrame);
  expect(
    finalSnapshot.nanCount,
    `entities with NaN position after ${SIMULATION_FRAME_COUNT} frames: ${finalSnapshot.sampleNanIds.join(',')}`,
  ).toBe(0);
  expect(Number.isInteger(finalSnapshot.crc)).toBe(true);
  // Some entities can be destroyed in combat over 300 frames; require at least
  // half the initial population to survive as a basic sanity check.
  expect(finalSnapshot.entityCount).toBeGreaterThanOrEqual(Math.floor(initialSnapshot.entityCount / 2));

  return { initialSnapshot, finalSnapshot };
}

function installPageDiagnostics(page: import('@playwright/test').Page): {
  errors: string[];
  diagnostics: string[];
} {
  const errors: string[] = [];
  const diagnostics: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (message) => {
    diagnostics.push(`console:${message.type()}: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  return { errors, diagnostics };
}

for (const fixture of simulationFixtures) {
  test(`source save survives 300-frame simulation: ${fixture.fileName}`, async ({ page }) => {
    test.setTimeout(180_000);
    const { errors, diagnostics } = installPageDiagnostics(page);

    await loadSourceSaveAndAdvance(page, fixture, diagnostics);

    expect(errors).toEqual([]);
  });
}

for (const fixture of exhaustiveSimulationFixtures) {
  test(`exhaustive source save survives 300-frame simulation: ${fixture.fileName}`, async ({ page }) => {
    test.setTimeout(180_000);
    const { errors, diagnostics } = installPageDiagnostics(page);

    await loadSourceSaveAndAdvance(page, fixture, diagnostics);

    expect(errors).toEqual([]);
  });
}

for (const fixture of crcRepeatFixtures) {
  test(`source save CRC repeats across two 300-frame resumes: ${fixture.fileName}`, async ({ page }) => {
    test.setTimeout(360_000);
    const { errors, diagnostics } = installPageDiagnostics(page);

    const first = await loadSourceSaveAndAdvance(page, fixture, diagnostics);
    const second = await loadSourceSaveAndAdvance(page, fixture, diagnostics);

    expect(second.initialSnapshot.frame).toBe(first.initialSnapshot.frame);
    expect(second.finalSnapshot.frame).toBe(first.finalSnapshot.frame);
    expect(second.initialSnapshot.crc).toBe(first.initialSnapshot.crc);
    expect(second.finalSnapshot.crc).toBe(first.finalSnapshot.crc);
    expect(errors).toEqual([]);
  });
}
