import { expect, test } from '@playwright/test';

async function waitForE2EHook(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']), {
    timeout: 120_000,
  });
}

test('challenge save/load restores mission context for a live generals challenge mission', async ({ page }) => {
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

  const savedSnapshot = await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook?.gameLogic;
    if (!hook || !logic) {
      return null;
    }

    await hook.saveGame(slotId, 'E2E Challenge Save');

    const listChunkNames = (data: ArrayBuffer): string[] => {
      const source = new Uint8Array(data);
      const chunks: string[] = [];
      let offset = 0;
      while (offset < source.byteLength) {
        const tokenLength = source[offset] ?? 0;
        offset += 1;
        const tokenBytes = source.slice(offset, offset + tokenLength);
        offset += tokenLength;
        const token = String.fromCharCode(...tokenBytes);
        if (token.toLowerCase() === 'sg_eof') {
          break;
        }
        const blockSize = new DataView(source.buffer, source.byteOffset + offset, 4).getInt32(0, true);
        offset += 4;
        chunks.push(token);
        offset += blockSize;
      }
      return chunks;
    };

    const openDatabase = async (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
      const request = indexedDB.open('generals-saves', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const db = await openDatabase();
    const storedData = await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(['save-files'], 'readonly');
      const fileReq = tx.objectStore('save-files').get(slotId);
      tx.oncomplete = () => resolve((fileReq.result as ArrayBuffer | undefined) ?? null);
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    return {
      mapWidth: logic.loadedMapData?.heightmap?.width ?? null,
      playerSide0: typeof logic.getPlayerSide === 'function' ? logic.getPlayerSide(0) : null,
      endState: typeof hook.getGameEndState === 'function' ? hook.getGameEndState() : null,
      chunkNames: storedData ? listChunkNames(storedData) : [],
    };
  }, 'e2e-challenge-save');

  expect(savedSnapshot).not.toBeNull();
  expect(savedSnapshot?.mapWidth ?? 0).toBeGreaterThan(0);
  expect(savedSnapshot?.playerSide0?.toLowerCase?.()).toBe('americaairforcegeneral');
  expect(savedSnapshot?.endState).toBeNull();
  expect(savedSnapshot?.chunkNames).toContain('CHUNK_Campaign');
  expect(savedSnapshot?.chunkNames).not.toContain('CHUNK_TS_RuntimeState');

  await page.evaluate(async (slotId: string) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    await hook.loadGameFromSlot(slotId);
  }, 'e2e-challenge-save');

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
  expect(restoredSnapshot?.mapWidth).toBe(savedSnapshot?.mapWidth ?? null);
  expect(restoredSnapshot?.playerSide0?.toLowerCase?.()).toBe('americaairforcegeneral');
  expect(restoredSnapshot?.endState).toBeNull();
  expect(errors).toEqual([]);
});
