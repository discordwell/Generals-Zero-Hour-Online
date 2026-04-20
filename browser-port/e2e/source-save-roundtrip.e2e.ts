import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { parseSaveGameInfo } from '@generals/engine';

test.describe.configure({ mode: 'parallel' });

const E2E_AUTO_PAUSE_KEY = '__GENERALS_E2E_AUTO_PAUSE__';

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
      timeout: 120_000,
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

async function requestAutoPauseOnNextLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((key) => {
    (window as Record<string, unknown>)[key] = true;
  }, E2E_AUTO_PAUSE_KEY);
}

async function pauseLoadedSimulation(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook?.setSimulationPaused?.(true);
  });
}

interface RoundtripFixture {
  fileName: string;
  title: string;
  expectedPlayerSideLower?: string;
}

interface SourceSaveMapAssetReport {
  requiredMaps?: Array<{
    availableOutputPath?: string | null;
    saveFiles?: string[];
  }>;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function loadAutoRoundtripFixtures(): RoundtripFixture[] {
  const reportPath = resolve('source-save-map-asset-report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SourceSaveMapAssetReport;
  const fixtures: RoundtripFixture[] = [];
  const seen = new Set<string>();

  for (const map of report.requiredMaps ?? []) {
    if (!map.availableOutputPath || !map.availableOutputPath.includes('MapsZH')) {
      continue;
    }
    for (const fileName of [...(map.saveFiles ?? [])].filter((entry) => entry.startsWith('zipeater_ZH_')).sort()) {
      if (seen.has(fileName)) {
        continue;
      }
      const saveBytes = readFileSync(resolve('fixtures/source-saves', fileName));
      const saveInfo = parseSaveGameInfo(bufferToArrayBuffer(saveBytes));
      fixtures.push({
        fileName,
        title: saveInfo.description,
      });
      seen.add(fileName);
    }
  }

  return fixtures.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

const curatedRoundtripFixtures: RoundtripFixture[] = [
  {
    fileName: 'zipeater_ZH_000.sav',
    title: 'Hard Start - USA',
    expectedPlayerSideLower: 'america',
  },
  {
    fileName: 'zipeater_ZH_005.sav',
    title: 'Hard Start - GLA',
  },
  {
    fileName: 'zipeater_ZH_010.sav',
    title: 'Hard Start - China',
  },
  {
    fileName: 'zipeater_ZH_038.sav',
    title: 'Hard Air Force - 2 - Nuke',
    expectedPlayerSideLower: 'glatoxingeneral',
  },
  {
    fileName: 'zipeater_ZH_130.sav',
    title: 'Easy Demolition - 1 - Superweapon',
  },
  {
    fileName: 'zipeater_ZH_160.sav',
    title: 'Brutal Finale - China Nuke Party',
  },
  {
    fileName: 'zipeater_ZH_161.sav',
    title: "Brutal Finale - General Tao's Nuke Party",
  },
];

const roundtripFixtures: RoundtripFixture[] = (() => {
  const seen = new Set(curatedRoundtripFixtures.map((fixture) => fixture.fileName));
  const fixtures = [...curatedRoundtripFixtures];
  for (const fixture of loadAutoRoundtripFixtures()) {
    if (seen.has(fixture.fileName)) {
      continue;
    }
    fixtures.push(fixture);
  }
  return fixtures;
})();

for (const fixture of roundtripFixtures) {
  test(`roundtrips imported ZH source save through TS save/load: ${fixture.fileName}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const diagnostics: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (message) => diagnostics.push(`console:${message.type()}: ${message.text()}`));
    page.on('requestfailed', (request) => {
      diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    });

    await openLoadGameScreen(page);

    const fixturePath = resolve('fixtures/source-saves', fixture.fileName);
    await page.locator('[data-ref="load-game-import-input"]').setInputFiles(fixturePath);
    await expect(page.locator('.load-game-row-title', { hasText: fixture.title })).toBeVisible({
      timeout: 120_000,
    });

    await requestAutoPauseOnNextLoad(page);
    await page.locator('.load-game-overlay [data-action="load"]').click();
    await page.locator('.load-game-overlay [data-action="confirm-load"]').click();

    await waitForE2EHook(page, diagnostics);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });
    await pauseLoadedSimulation(page);

    const slotId = `e2e-source-roundtrip-${fixture.fileName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const saveDescription = `E2E ${fixture.title}`;

    const importedState = await page.evaluate(async ({ slotId, saveDescription }) => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      const logic = hook?.gameLogic;
      if (!hook || !logic) {
        return null;
      }
      hook.setSimulationPaused?.(true);
      const snapshot = {
        mapWidth: logic.loadedMapData?.heightmap?.width ?? null,
        mapHeight: logic.loadedMapData?.heightmap?.height ?? null,
        playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
        endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
      };
      const savedSlotId = await hook.saveGame(slotId, saveDescription);
      return { savedSlotId, snapshot };
    }, { slotId, saveDescription });

    const importedSnapshot = importedState?.snapshot ?? null;
    const savedSlotId = importedState?.savedSlotId ?? slotId;

    expect(importedSnapshot).not.toBeNull();
    expect(importedSnapshot?.mapWidth ?? 0).toBeGreaterThan(0);
    expect(importedSnapshot?.mapHeight ?? 0).toBeGreaterThan(0);
    if ('expectedPlayerSideLower' in fixture) {
      expect(importedSnapshot?.playerSide0?.toLowerCase?.()).toBe(fixture.expectedPlayerSideLower);
    } else {
      expect(importedSnapshot?.playerSide0).toBeTruthy();
    }

    await page.evaluate(async (slotId) => {
      const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
      hook?.setSimulationPaused?.(true);
      hook?.setAutoPauseOnNextLoad?.(true);
      await hook.loadGameFromSlot(slotId);
    }, savedSlotId);

    await waitForE2EHook(page, diagnostics);
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });
    await pauseLoadedSimulation(page);

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
        endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
      };
    });

    expect(restoredSnapshot).toEqual(importedSnapshot);
    expect(errors).toEqual([]);
  });
}
