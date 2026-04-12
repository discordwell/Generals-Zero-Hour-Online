import { expect, test } from '@playwright/test';

async function waitForE2EHook(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
}

async function getMissionSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook?.gameLogic;
    if (!hook || !logic) {
      return null;
    }

    const renderStates = typeof hook.getRenderableEntityStates === 'function'
      ? hook.getRenderableEntityStates()
      : [];
    const sideCounts: Record<string, number> = {};
    for (const state of renderStates) {
      const side = String(state?.side ?? '');
      sideCounts[side] = (sideCounts[side] ?? 0) + 1;
    }

    const selector = typeof logic.resolveScriptPlayerConditionSelector === 'function'
      ? logic.resolveScriptPlayerConditionSelector('ThePlayer')
      : null;
    const conditionThePlayer = typeof logic.evaluateScriptCondition === 'function'
      ? logic.evaluateScriptCondition({ conditionType: 5, params: ['ThePlayer'] })
      : null;

    return {
      frame: logic.frameCounter ?? null,
      playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
      localSide: typeof logic.resolveLocalPlayerSide === 'function' ? logic.resolveLocalPlayerSide() : null,
      endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
      renderCount: renderStates.length,
      sideCounts,
      selector,
      conditionThePlayer,
    };
  });
}

test('USA campaign mission 1 -> mission 2 transition does not auto-defeat', async ({ page }) => {
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
  await page.waitForFunction(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const states = hook?.getRenderableEntityStates?.();
    return Array.isArray(states) && states.length > 1000;
  }, { timeout: 120_000 });

  const mission1Snapshot = await getMissionSnapshot(page);
  console.log('campaign transition: mission1 snapshot', JSON.stringify(mission1Snapshot));

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.executeScriptAction({ actionType: 'QUICKVICTORY' });
  });

  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video);
  }, { timeout: 60_000 });
  await page.locator('video').click({ force: true });

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook?.gameLogic;
    const width = logic?.loadedMapData?.heightmap?.width;
    const states = hook?.getRenderableEntityStates?.();
    return width === 490 && Array.isArray(states) && states.length > 1000;
  }, { timeout: 120_000 });

  await page.waitForTimeout(5_000);
  const mission2Snapshot = await getMissionSnapshot(page);
  console.log('campaign transition: mission2 snapshot', JSON.stringify(mission2Snapshot));

  const missionSaveState = await page.evaluate(async () => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const saves = await hook.listSaves();
    const missionSave = saves
      .filter((save: { description?: string }) => save.description === 'Mission Start - USA 2')
      .sort((a: { timestamp: number }, b: { timestamp: number }) => b.timestamp - a.timestamp)[0] ?? null;
    return { missionSave, saves };
  });
  console.log('campaign transition: saves after mission autosave', JSON.stringify(missionSaveState.saves));
  const missionSave = missionSaveState.missionSave;

  expect(missionSave).not.toBeNull();
  expect(missionSave?.slotId).toMatch(/^\d{8}$/);
  expect(missionSave?.saveFileType).toBe(1);

  await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    await hook.loadGameFromSlot(slotId);
  }, missionSave!.slotId);

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook?.gameLogic;
    return logic?.loadedMapData?.heightmap?.width === 490;
  }, { timeout: 120_000 });

  const loadedMissionSaveSnapshot = await getMissionSnapshot(page);
  console.log('campaign transition: mission save load snapshot', JSON.stringify(loadedMissionSaveSnapshot));

  expect(errors).toEqual([]);
  expect(mission2Snapshot).not.toBeNull();
  expect(mission2Snapshot?.conditionThePlayer).toBe(false);
  expect(mission2Snapshot?.endState?.status).not.toBe('DEFEAT');
  expect(loadedMissionSaveSnapshot).not.toBeNull();
  expect(loadedMissionSaveSnapshot?.playerSide0?.toLowerCase?.()).toBe('america');
  expect(loadedMissionSaveSnapshot?.endState?.status).not.toBe('DEFEAT');
});
