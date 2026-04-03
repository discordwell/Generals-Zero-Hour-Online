import { expect, test } from '@playwright/test';

const TEST_MAP_URL = '/?map=assets/maps/ScenarioSkirmish.json';

test('browser runtime save/load restores a live scripted unit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(TEST_MAP_URL);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']));

  const setup = await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    if (!hook) {
      return { supported: false as const };
    }

    hook.gameLogic.setPlayerSide(0, 'America');
    hook.setScriptTeamMembers('E2E_SAVE_TEAM', []);
    hook.setScriptTeamControllingSide('E2E_SAVE_TEAM', 'America');

    const entityId = hook.gameLogic.nextId as number;
    const created = hook.executeScriptAction({
      actionType: 'CREATE_OBJECT',
      params: ['RuntimeTank', 'E2E_SAVE_TEAM', { x: 12, y: 12, z: 0 }, 0],
    });
    if (!created) {
      return { supported: false as const };
    }

    const entity = hook.gameLogic.spawnedEntities.get(entityId) as {
      id: number;
      x: number;
      z: number;
      health: number;
      maxHealth: number;
    } | undefined;
    if (!entity) {
      return { supported: false as const };
    }

    const savedHealth = entity.health;
    const savedX = entity.x;
    const savedZ = entity.z;

    await hook.saveGame(slotId, 'E2E Runtime Save');
    const saves = await hook.listSaves();
    const saved = saves.find((save: { slotId: string }) => save.slotId === slotId) ?? null;

    hook.executeScriptAction({
      actionType: 'NAMED_DAMAGE',
      params: [entityId, Math.max(entity.maxHealth * 4, 500)],
    });

    return {
      supported: true as const,
      entityId,
      savedHealth,
      savedX,
      savedZ,
      savePresent: saved !== null,
    };
  }, 'e2e-runtime-save');

  test.skip(!setup.supported, 'Failed to create the scripted save/load test entity.');
  expect(setup.savePresent).toBe(true);

  await page.waitForFunction((entityId) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const entity = hook?.gameLogic?.spawnedEntities?.get(entityId) as {
      destroyed?: boolean;
      health?: number;
    } | undefined;
    if (!entity) {
      return true;
    }
    if (entity.destroyed) {
      return true;
    }
    return (entity.health ?? 0) <= 0;
  }, setup.entityId, { timeout: 30_000 });

  await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    await hook.loadGameFromSlot(slotId);
  }, 'e2e-runtime-save');

  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  const restored = await page.evaluate((entityId: number) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const entity = hook?.gameLogic?.spawnedEntities?.get(entityId) as {
      destroyed?: boolean;
      health?: number;
      x?: number;
      z?: number;
    } | undefined;
    if (!entity) {
      return null;
    }
    return {
      destroyed: Boolean(entity.destroyed),
      health: entity.health ?? 0,
      x: entity.x ?? 0,
      z: entity.z ?? 0,
    };
  }, setup.entityId);

  expect(restored).not.toBeNull();
  expect(restored?.destroyed).toBe(false);
  expect(restored?.health ?? 0).toBeGreaterThan(0);
  expect(restored?.health).toBe(setup.savedHealth);
  expect(restored?.x).toBeCloseTo(setup.savedX, 5);
  expect(restored?.z).toBeCloseTo(setup.savedZ, 5);
  expect(errors).toEqual([]);
});
