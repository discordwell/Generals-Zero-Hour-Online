import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

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

const simulationFixtures: SimulationFixture[] = [
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
];

for (const fixture of simulationFixtures) {
  test(`source save survives 300-frame simulation: ${fixture.fileName}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const diagnostics: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (message) => {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });

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

    const initialSnapshot = await page.evaluate(() => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      const visual = hook.getVisualDebugState();
      const states = hook.getRenderableEntityStates();
      let nanCount = 0;
      for (const state of states) {
        if (!Number.isFinite(state.x) || !Number.isFinite(state.y) || !Number.isFinite(state.z)) {
          nanCount++;
        }
      }
      return {
        frame: visual.frame,
        entityCount: states.length,
        nanCount,
        endState: hook.getGameEndState(),
      };
    });

    expect(initialSnapshot.frame).not.toBeNull();
    expect(initialSnapshot.entityCount).toBeGreaterThan(0);
    expect(initialSnapshot.nanCount).toBe(0);
    expect(initialSnapshot.endState).toBeNull();

    const initialFrame = initialSnapshot.frame ?? 0;
    const targetFrame = initialFrame + SIMULATION_FRAME_COUNT;

    // Unpause and let the simulation advance 300 frames (~10s wall clock at 30Hz).
    await page.evaluate(() => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      hook.setSimulationPaused(false);
    });

    try {
      await page.waitForFunction(
        (target) => {
          const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
          const visual = hook?.getVisualDebugState?.();
          return typeof visual?.frame === 'number' && visual.frame >= target;
        },
        targetFrame,
        { timeout: 60_000 },
      );
    } catch (error) {
      throw new Error([
        `Simulation did not advance to frame ${targetFrame} within 60s.`,
        ...diagnostics.slice(-20),
        error instanceof Error ? error.message : String(error),
      ].join('\n'));
    }

    await page.evaluate(() => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      hook.setSimulationPaused(true);
    });

    const finalSnapshot = await page.evaluate(() => {
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
      };
    });

    expect(finalSnapshot.frame).toBeGreaterThanOrEqual(targetFrame);
    expect(finalSnapshot.nanCount, `entities with NaN position after ${SIMULATION_FRAME_COUNT} frames: ${finalSnapshot.sampleNanIds.join(',')}`).toBe(0);
    // Some entities can be destroyed in combat over 300 frames; require at least
    // half the initial population to survive as a basic sanity check.
    expect(finalSnapshot.entityCount).toBeGreaterThanOrEqual(Math.floor(initialSnapshot.entityCount / 2));
    expect(errors).toEqual([]);
  });
}
