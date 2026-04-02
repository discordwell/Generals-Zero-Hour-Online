import { expect, test } from '@playwright/test';

async function waitForE2EHook(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
}

test('retail shell skirmish flow boots a live match with Player_N runtime sides', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Single Player' }).click();
  await page.getByRole('button', { name: 'Skirmish' }).click();

  const tournamentDesertValue = await page.locator('#skirmish-setup-screen [data-ref="map-select"]').evaluate((select) => {
    const options = [...(select as HTMLSelectElement).options];
    return options.find((option) => /tournament desert/i.test(option.textContent ?? ''))?.value ?? null;
  });
  expect(tournamentDesertValue).not.toBeNull();
  await page.locator('#skirmish-setup-screen [data-ref="map-select"]').selectOption(String(tournamentDesertValue));

  await page.locator('#skirmish-setup-screen [data-action="start"]').click();

  await waitForE2EHook(page);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  const snapshot = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook?.gameLogic;
    if (!hook || !logic) {
      return null;
    }

    const playerSide0 = typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null;
    const playerSide1 = typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(1) : null;
    const resolvedFaction0 = playerSide0 && typeof logic.getResolvedFactionSide === 'function'
      ? logic.getResolvedFactionSide(playerSide0)
      : null;
    const resolvedFaction1 = playerSide1 && typeof logic.getResolvedFactionSide === 'function'
      ? logic.getResolvedFactionSide(playerSide1)
      : null;
    const states = typeof hook.getRenderableEntityStates === 'function'
      ? hook.getRenderableEntityStates()
      : [];
    const sideCounts: Record<string, number> = {};
    for (const state of states) {
      const side = String(state?.side ?? '');
      sideCounts[side] = (sideCounts[side] ?? 0) + 1;
    }

    return {
      playerSide0,
      playerSide1,
      resolvedFaction0,
      resolvedFaction1,
      renderCount: states.length,
      sideCounts,
    };
  });

  expect(errors).toEqual([]);
  expect(snapshot).not.toBeNull();
  expect(snapshot?.playerSide0).toBe('player_1');
  expect(snapshot?.playerSide1).toBe('player_2');
  expect(snapshot?.resolvedFaction0).toBe('america');
  expect(snapshot?.resolvedFaction1).toBe('china');
  expect(snapshot?.renderCount ?? 0).toBeGreaterThan(100);
  expect(snapshot?.sideCounts.player_1 ?? 0).toBeGreaterThan(0);
  expect(snapshot?.sideCounts.player_2 ?? 0).toBeGreaterThan(0);
});
