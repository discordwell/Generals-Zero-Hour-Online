import { expect, test } from '@playwright/test';

const TEST_MAP_URL = '/?map=assets/maps/ScenarioSkirmish.json';
const PARTICLE_TEMPLATE_CANDIDATES = [
  '_TestEffect1',
  '_TestEffect2',
  '_FireTest',
  'BuildingFireSmall',
  'ForwardLightSmokePuffs',
] as const;

test('save/load restores live particle systems through CHUNK_ParticleSystem', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(TEST_MAP_URL);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']));

  const beforeSave = await page.evaluate(async ({ slotId, candidateTemplateNames }: {
    slotId: string;
    candidateTemplateNames: readonly string[];
  }) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    if (!hook) {
      return { supported: false as const, attempts: [] as Array<{ templateName: string; systemId: number | null; particleCount: number }> };
    }

    const waitForParticles = async (): Promise<boolean> => {
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const debugState = hook.getParticleSystemDebugState();
        if ((debugState?.totalParticleCount ?? 0) > 0) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };

    const attempts: Array<{ templateName: string; systemId: number | null; particleCount: number }> = [];
    let selectedTemplateName: string | null = null;
    let selectedSystemId: number | null = null;
    for (const templateName of candidateTemplateNames) {
      const systemId = hook.debugSpawnParticleSystem(templateName, { x: 18, y: 0, z: 18 });
      let particleCount = 0;
      if (systemId !== null && systemId !== undefined) {
        const activeBeforeSave = await waitForParticles();
        if (activeBeforeSave) {
          const debugState = hook.getParticleSystemDebugState();
          particleCount = debugState?.totalParticleCount ?? 0;
          selectedTemplateName = templateName;
          selectedSystemId = systemId;
          attempts.push({ templateName, systemId, particleCount });
          break;
        }
      }
      attempts.push({ templateName, systemId, particleCount });
    }

    if (selectedTemplateName === null || selectedSystemId === null) {
      return { supported: false as const, attempts };
    }

    const debugState = hook.getParticleSystemDebugState();
    await hook.saveGame(slotId, 'E2E Particle Save');

    return {
      supported: true as const,
      attempts,
      systemId: selectedSystemId,
      templateName: selectedTemplateName,
      activeSystemCount: debugState.activeSystemCount,
      totalParticleCount: debugState.totalParticleCount,
      templateNames: debugState.saveState.systems.map((system: { template: { name: string } }) => system.template.name),
    };
  }, { slotId: 'e2e-particle-save', candidateTemplateNames: PARTICLE_TEMPLATE_CANDIDATES });

  expect(beforeSave.supported, JSON.stringify(beforeSave.attempts)).toBe(true);
  expect(beforeSave.activeSystemCount).toBeGreaterThan(0);
  expect(beforeSave.totalParticleCount).toBeGreaterThan(0);
  expect(beforeSave.templateNames).toContain(beforeSave.templateName);

  await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    await hook.loadGameFromSlot(slotId);
  }, 'e2e-particle-save');

  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });

  await page.waitForFunction(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const debugState = hook?.getParticleSystemDebugState?.();
    return (debugState?.activeSystemCount ?? 0) > 0 && (debugState?.totalParticleCount ?? 0) > 0;
  }, { timeout: 30_000 });

  const afterLoad = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const debugState = hook?.getParticleSystemDebugState?.();
    return {
      activeSystemCount: debugState?.activeSystemCount ?? 0,
      totalParticleCount: debugState?.totalParticleCount ?? 0,
      templateNames: (debugState?.saveState?.systems ?? [])
        .map((system: { template: { name: string } }) => system.template.name),
    };
  });

  expect(afterLoad.activeSystemCount).toBeGreaterThan(0);
  expect(afterLoad.totalParticleCount).toBeGreaterThan(0);
  expect(afterLoad.templateNames).toContain(beforeSave.templateName);
  expect(errors).toEqual([]);
});
