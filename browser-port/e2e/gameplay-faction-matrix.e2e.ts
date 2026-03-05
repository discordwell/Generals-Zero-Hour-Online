import { expect, test } from '@playwright/test';

const TEST_MAP_URL = '/?map=assets/maps/ScenarioSkirmish.json';

const FACTION_MATRIX = [
  { playerSide: 'America', aiSide: 'China' },
  { playerSide: 'China', aiSide: 'GLA' },
  { playerSide: 'GLA', aiSide: 'America' },
] as const;

for (const matrixCase of FACTION_MATRIX) {
  test(`faction matrix ${matrixCase.playerSide} vs ${matrixCase.aiSide} sustains cross-side combat`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(TEST_MAP_URL);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 15_000 });
    await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']));

    const setup = await page.evaluate(({ playerSide, aiSide }) => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      hook.gameLogic.setPlayerSide(0, playerSide);
      hook.gameLogic.setPlayerSide(1, aiSide);
      hook.gameLogic.setTeamRelationship(playerSide, aiSide, 0);
      hook.gameLogic.setTeamRelationship(aiSide, playerSide, 0);

      const playerTeam = `E2E_MATRIX_PLAYER_${playerSide.toUpperCase()}`;
      const aiTeam = `E2E_MATRIX_AI_${aiSide.toUpperCase()}`;
      const teamsReady =
        hook.setScriptTeamMembers(playerTeam, [])
        && hook.setScriptTeamControllingSide(playerTeam, playerSide)
        && hook.setScriptTeamMembers(aiTeam, [])
        && hook.setScriptTeamControllingSide(aiTeam, aiSide);

      const idsBefore = new Set(
        Array.from((hook.gameLogic.spawnedEntities as Map<number, unknown>).keys()),
      );
      const createdPlayer = hook.executeScriptAction({
        actionType: 'CREATE_OBJECT',
        params: ['RuntimeTank', playerTeam, { x: 1.1, y: 1.1, z: 0 }, 0],
      });
      const createdAi = hook.executeScriptAction({
        actionType: 'CREATE_OBJECT',
        params: ['RuntimeEnemy', aiTeam, { x: 1.6, y: 1.1, z: 0 }, 0],
      });
      if (!teamsReady || !createdPlayer || !createdAi) {
        return {
          supported: false as const,
          reason: 'create_failed',
          teamsReady,
          createdPlayer,
          createdAi,
          playerSide,
          aiSide,
        };
      }

      const entitiesById = hook.gameLogic.spawnedEntities as Map<number, {
        id: number;
        health: number;
        side?: string;
        destroyed?: boolean;
      }>;
      const createdEntities = Array.from(entitiesById.values()).filter((entity) => !idsBefore.has(entity.id));
      const normalizedPlayerSide = playerSide.trim().toUpperCase();
      const normalizedAiSide = aiSide.trim().toUpperCase();
      const playerEntity = createdEntities.find((entity) =>
        (entity.side ?? '').toUpperCase() === normalizedPlayerSide,
      ) ?? null;
      const aiEntity = createdEntities.find((entity) =>
        (entity.side ?? '').toUpperCase() === normalizedAiSide,
      ) ?? null;

      if (!playerEntity || !aiEntity) {
        return {
          supported: false as const,
          reason: 'entity_lookup_failed',
          playerSide,
          aiSide,
          createdEntityCount: createdEntities.length,
        };
      }

      const attackIssued = hook.executeScriptAction({
        actionType: 'TEAM_ATTACK_TEAM',
        params: [aiTeam, playerTeam],
      });
      if (!attackIssued) {
        return {
          supported: false as const,
          reason: 'team_attack_failed',
          playerSide,
          aiSide,
        };
      }

      return {
        supported: true as const,
        playerEntityId: playerEntity.id,
        playerEntityHealth: playerEntity.health,
        aiEntityId: aiEntity.id,
        aiEntityHealth: aiEntity.health,
      };
    }, matrixCase);

    expect(setup.supported, JSON.stringify(setup)).toBe(true);

    await page.waitForFunction(
      ({ playerEntityId, playerEntityHealth, aiEntityId, aiEntityHealth }) => {
        const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
        const playerEntity = hook.gameLogic.spawnedEntities.get(playerEntityId) as
          | { health?: number; destroyed?: boolean }
          | undefined;
        const aiEntity = hook.gameLogic.spawnedEntities.get(aiEntityId) as
          | { health?: number; destroyed?: boolean }
          | undefined;
        const playerTookDamage = !playerEntity
          || !!playerEntity.destroyed
          || (playerEntity.health ?? playerEntityHealth) < playerEntityHealth;
        const aiTookDamage = !aiEntity
          || !!aiEntity.destroyed
          || (aiEntity.health ?? aiEntityHealth) < aiEntityHealth;
        return playerTookDamage || aiTookDamage;
      },
      setup,
      { timeout: 15_000 },
    );

    expect(errors).toEqual([]);
  });
}
