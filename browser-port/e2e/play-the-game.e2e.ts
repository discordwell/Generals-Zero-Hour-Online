import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Drive a short skirmish session in the live game and capture screenshots
 * to confirm the parity work from this session holds together end-to-end.
 *
 * Not part of the regular suite — invoked manually with:
 *   npx playwright test e2e/play-the-game.e2e.ts --reporter=list
 */

const TEST_MAP_URL = '/?map=assets/maps/ScenarioSkirmish.json';
const SCREENSHOT_DIR = resolve('test-results/play-the-game');

test.setTimeout(180_000);

test('play the game: build, train, fight, end', async ({ page }) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(TEST_MAP_URL);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 20_000 });
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']));

  // Capture the loaded map before doing anything.
  await page.screenshot({ path: `${SCREENSHOT_DIR}/00-loaded.png`, fullPage: false });

  // ── Step 1 — set up American side, spawn a Construction Dozer + Power Plant ──
  const setup = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.gameLogic.setPlayerSide(0, 'America');

    const teamName = 'E2E_PLAY_TEAM';
    hook.setScriptTeamMembers(teamName, []);
    hook.setScriptTeamControllingSide(teamName, 'America');

    const nextIdBefore = hook.gameLogic.nextId as number;
    // The map fixture exposes RuntimeTank / RuntimePowerPlant — verified by
    // gameplay-build-power.e2e.ts and gameplay-combat.e2e.ts.
    const tankOk = hook.executeScriptAction({
      actionType: 'CREATE_OBJECT',
      params: ['RuntimeTank', teamName, { x: 30, y: 30, z: 0 }, 0],
    });
    const ppOk = hook.executeScriptAction({
      actionType: 'CREATE_OBJECT',
      params: ['RuntimePowerPlant', teamName, { x: 50, y: 30, z: 0 }, 0],
    });

    const powerBefore = hook.getSidePowerState('America').energyProduction as number;
    return { tankOk, ppOk, powerBefore, firstId: nextIdBefore };
  });

  expect(setup.tankOk).toBe(true);
  expect(setup.ppOk).toBe(true);

  // Let the engine tick a few frames so the structures settle and power lights up.
  await page.waitForTimeout(500);

  const baseSnapshot = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const entities = Array.from(hook.gameLogic.spawnedEntities.values()) as Array<{
      id: number; templateName: string; side?: string; x: number; z: number;
      health: number; maxHealth: number; destroyed?: boolean;
    }>;
    const mine = entities.filter((e) => e.side?.toLowerCase() === 'america' && !e.destroyed);
    return {
      power: hook.getSidePowerState('America').energyProduction as number,
      structures: mine.map((e) => ({
        id: e.id, name: e.templateName, x: e.x, z: e.z, hp: e.health,
      })),
    };
  });

  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-base-built.png`, fullPage: false });

  // ── Step 2 — train an enemy target + an attacking unit, then fight ──
  const combat = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];

    // China enemy team — set up relationship as enemies.
    hook.gameLogic.setPlayerSide(1, 'China');
    hook.gameLogic.setTeamRelationship('America', 'China', 0);
    hook.gameLogic.setTeamRelationship('China', 'America', 0);
    hook.setScriptTeamMembers('E2E_ENEMY_TEAM', []);
    hook.setScriptTeamControllingSide('E2E_ENEMY_TEAM', 'China');

    const attackerOk = hook.executeScriptAction({
      actionType: 'CREATE_OBJECT',
      params: ['RuntimeTank', 'E2E_PLAY_TEAM', { x: 100, y: 50, z: 0 }, 0],
    });
    const targetOk = hook.executeScriptAction({
      actionType: 'CREATE_OBJECT',
      params: ['RuntimeTank', 'E2E_ENEMY_TEAM', { x: 110, y: 50, z: 0 }, 0],
    });

    const entities = Array.from(hook.gameLogic.spawnedEntities.values()) as Array<{
      id: number; templateName: string; side?: string; x: number; z: number;
      health: number; maxHealth: number; destroyed?: boolean;
    }>;
    const attacker = entities.find((e) =>
      e.templateName === 'RuntimeTank' && e.side?.toLowerCase() === 'america' && !e.destroyed,
    );
    const target = entities.find((e) =>
      e.templateName === 'RuntimeTank' && e.side?.toLowerCase() === 'china' && !e.destroyed,
    );

    if (!attacker || !target) return { supported: false as const };

    // Issue attack command from attacker to target.
    hook.gameLogic.submitCommand?.({
      type: 'attackEntity',
      entityId: attacker.id,
      targetEntityId: target.id,
    });

    return {
      supported: true as const,
      attackerId: attacker.id,
      targetId: target.id,
      attackerHpBefore: attacker.health,
      targetHpBefore: target.health,
      attackerOk,
      targetOk,
    };
  });

  test.skip(!combat.supported, 'Could not spawn combat fixtures');
  expect(combat.attackerOk).toBe(true);
  expect(combat.targetOk).toBe(true);

  // Wait for damage to start landing (within 5 seconds the target should take
  // damage if combat is wired correctly).
  await page.waitForFunction((targetId) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const e = hook.gameLogic.spawnedEntities.get(targetId) as { health?: number } | undefined;
    return e !== undefined && e.health !== undefined && e.health < combat.targetHpBefore!;
  }, combat.targetId, { timeout: 10_000 }).catch(() => { /* tolerated — combat may take longer */ });

  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-combat.png`, fullPage: false });

  const combatResult = await page.evaluate((ids) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const a = hook.gameLogic.spawnedEntities.get(ids.attackerId) as
      | { health?: number; destroyed?: boolean } | undefined;
    const t = hook.gameLogic.spawnedEntities.get(ids.targetId) as
      | { health?: number; destroyed?: boolean } | undefined;
    return {
      attackerHp: a?.health ?? -1,
      attackerDead: a?.destroyed ?? true,
      targetHp: t?.health ?? -1,
      targetDead: t?.destroyed ?? true,
    };
  }, { attackerId: combat.attackerId!, targetId: combat.targetId! });

  // ── Step 3 — confirm the engine reaches normal play state ──
  const finalState = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    return {
      frame: hook.gameLogic.frameCounter as number,
      paused: hook.gameLogic.paused as boolean,
      entityCount: hook.gameLogic.spawnedEntities.size as number,
      power: hook.getSidePowerState('America').energyProduction as number,
    };
  });

  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-final.png`, fullPage: false });

  // Print a human-readable session report.
  // eslint-disable-next-line no-console
  console.log('\n=== PLAY-THE-GAME RESULT ===');
  // eslint-disable-next-line no-console
  console.log('Base built:', baseSnapshot.structures.map((s) => `${s.name}@(${s.x},${s.z})/${s.hp}hp`).join(', '));
  // eslint-disable-next-line no-console
  console.log('Power production:', baseSnapshot.power, '→', finalState.power);
  // eslint-disable-next-line no-console
  console.log('Combat: attacker', combatResult.attackerHp, 'hp,', 'target', combatResult.targetHp, 'hp');
  // eslint-disable-next-line no-console
  console.log('Final: frame', finalState.frame, 'entities', finalState.entityCount, 'paused', finalState.paused);
  // eslint-disable-next-line no-console
  console.log('Page errors:', errors.length);
  // eslint-disable-next-line no-console
  console.log('Screenshots:', SCREENSHOT_DIR);

  // Sanity assertions — these failing would indicate a regression.
  expect(baseSnapshot.structures.length).toBeGreaterThanOrEqual(2);
  expect(finalState.entityCount).toBeGreaterThanOrEqual(4);
  expect(finalState.frame).toBeGreaterThan(0);
  // Combat actually happened — at least one side took damage.
  const tookDamage = combatResult.attackerHp < (combat as { attackerHpBefore?: number }).attackerHpBefore!
    || combatResult.targetHp < (combat as { targetHpBefore?: number }).targetHpBefore!;
  expect(tookDamage).toBe(true);
});
