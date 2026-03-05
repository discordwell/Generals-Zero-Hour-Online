import { test, expect } from '@playwright/test';

const TEST_MAP_URL = '/?map=assets/maps/SmokeTest.json';

test('script actions drive radar visibility and endgame presentation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(TEST_MAP_URL);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']));

  const minimap = page.locator('#minimap-canvas');
  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.executeScriptAction({ actionType: 293 }); // RADAR_DISABLE
  });
  await expect(minimap).toBeHidden({ timeout: 5_000 });

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.executeScriptAction({ actionType: 294 }); // RADAR_ENABLE
  });
  await expect(minimap).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.gameLogic.setPlayerSide(0, 'America');
    hook.executeScriptAction({ actionType: 3 }); // VICTORY
  });

  await page.waitForFunction(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const endState = typeof hook?.getGameEndState === 'function'
      ? hook.getGameEndState()
      : null;
    if (!endState || typeof endState !== 'object') {
      return false;
    }
    return (endState as { status?: string }).status === 'VICTORY';
  }, { timeout: 15_000 });
  const endState = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    if (typeof hook?.getGameEndState !== 'function') {
      return null;
    }
    return hook.getGameEndState() as { status?: string } | null;
  });
  expect(endState?.status).toBe('VICTORY');
  expect(errors).toEqual([]);
});
