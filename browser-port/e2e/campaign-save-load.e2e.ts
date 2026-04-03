import { expect, test } from '@playwright/test';

async function waitForE2EHook(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
}

test('campaign save/load preserves mission context and can still advance to the next mission', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Single Player' }).click();
  await page.getByRole('button', { name: 'USA' }).click();
  await page.locator('#campaign-difficulty-screen [data-action="start"]').click();
  await page.locator('#campaign-briefing-screen [data-ref="campaign-load-start"]').click();

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  const saveSnapshot = await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook?.gameLogic;
    if (!hook || !logic) {
      return null;
    }

    await hook.saveGame(slotId, 'E2E Campaign Save');
    return {
      mapWidth: logic.loadedMapData?.heightmap?.width ?? null,
      playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
      saves: await hook.listSaves(),
    };
  }, 'e2e-campaign-save');

  expect(saveSnapshot).not.toBeNull();
  expect(saveSnapshot?.mapWidth ?? 0).toBeGreaterThan(0);
  expect(saveSnapshot?.playerSide0?.toLowerCase?.()).toBe('america');
  expect(
    saveSnapshot?.saves?.some((save: { slotId: string }) => save.slotId === 'e2e-campaign-save'),
  ).toBe(true);

  await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    await hook.loadGameFromSlot(slotId);
  }, 'e2e-campaign-save');

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  const loadedSnapshot = await page.evaluate(() => {
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

  expect(loadedSnapshot).not.toBeNull();
  expect(loadedSnapshot?.mapWidth).toBe(saveSnapshot?.mapWidth ?? null);
  expect(loadedSnapshot?.playerSide0?.toLowerCase?.()).toBe('america');
  expect(loadedSnapshot?.endState).toBeNull();

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.executeScriptAction({ actionType: 'QUICKVICTORY' });
  });

  await page.waitForFunction(() => Boolean(document.querySelector('video')), { timeout: 60_000 });
  await page.locator('video').click({ force: true });

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  const mission2Snapshot = await page.evaluate(() => {
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

  expect(mission2Snapshot).not.toBeNull();
  expect(mission2Snapshot?.mapWidth).toBe(490);
  expect(mission2Snapshot?.playerSide0?.toLowerCase?.()).toBe('america');
  expect(mission2Snapshot?.endState?.status).not.toBe('DEFEAT');
  expect(errors).toEqual([]);
});
