import { expect, test } from '@playwright/test';

async function waitForE2EHook(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
}

test('shell load-game flow restores a generals challenge save', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Single Player' }).click();
  await page.getByRole('button', { name: 'Generals Challenge' }).click();
  await page.locator('#campaign-difficulty-screen [data-action="start"]').click();
  await page.locator('#challenge-select-screen [data-challenge="0"]').click();
  await page.locator('#challenge-select-screen [data-ref="challenge-menu-start"]').click();

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  await page.evaluate(async () => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    await hook.saveGame('e2e-challenge-shell-save', 'E2E Challenge Shell Save');
  });

  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Load Game' }).click();
  await expect(page.locator('.load-game-overlay')).toBeVisible({ timeout: 120_000 });

  await page.getByText('E2E Challenge Shell Save').click();
  await page.locator('.load-game-overlay [data-action="load"]').click();
  await page.locator('.load-game-overlay [data-action="confirm-load"]').click();

  await waitForE2EHook(page);
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
      playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
      endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
    };
  });

  expect(restoredSnapshot).not.toBeNull();
  expect(restoredSnapshot?.mapWidth ?? 0).toBeGreaterThan(0);
  expect(restoredSnapshot?.playerSide0?.toLowerCase?.()).toBe('americaairforcegeneral');
  expect(restoredSnapshot?.endState).toBeNull();
  expect(errors).toEqual([]);
});
