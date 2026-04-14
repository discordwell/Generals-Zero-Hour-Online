import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

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

const sourceSaveFixtures = [
  {
    fileName: 'zipeater_ZH_000.sav',
    title: 'Hard Start - USA',
    expectedMapWidth: 610,
    expectedMapHeight: 460,
    expectedPlayerSideLower: 'america',
  },
  {
    fileName: 'zipeater_ZH_161.sav',
    title: "Brutal Finale - General Tao's Nuke Party",
    expectedMapWidth: 375,
    expectedMapHeight: 500,
    expectedPlayerSideLower: null,
  },
] as const;

for (const fixture of sourceSaveFixtures) {
  test(`shell imports and loads real Zero Hour source save: ${fixture.fileName}`, async ({ page }) => {
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

    await page.locator('.load-game-overlay [data-action="load"]').click();
    await page.locator('.load-game-overlay [data-action="confirm-load"]').click();

    await waitForE2EHook(page, diagnostics);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

    const restoredSnapshot = await page.evaluate(() => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      const logic = hook?.gameLogic;
      if (!hook || !logic) {
        return null;
      }
      return {
        mapWidth: logic.loadedMapData?.heightmap?.width ?? null,
        mapHeight: logic.loadedMapData?.heightmap?.height ?? null,
        playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
        visual: typeof hook.getVisualDebugState === 'function' ? hook.getVisualDebugState() : null,
        endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
      };
    });

    expect(restoredSnapshot).not.toBeNull();
    expect(restoredSnapshot?.mapWidth).toBe(fixture.expectedMapWidth);
    expect(restoredSnapshot?.mapHeight).toBe(fixture.expectedMapHeight);
    if (fixture.expectedPlayerSideLower) {
      expect(restoredSnapshot?.playerSide0?.toLowerCase?.()).toBe(fixture.expectedPlayerSideLower);
    } else {
      expect(restoredSnapshot?.playerSide0).toBeTruthy();
    }
    expect(restoredSnapshot?.visual?.placementSpawnedObjects ?? 0).toBeGreaterThan(0);
    expect(restoredSnapshot?.visual?.renderableCount ?? 0).toBeGreaterThan(0);
    expect(restoredSnapshot?.endState).toBeNull();
    expect(errors).toEqual([]);
  });
}
