import { expect, test } from '@playwright/test';

const TEST_MAP_URL = '/?map=assets/maps/ScenarioSkirmish.json';

test('retail-style save without CHUNK_TS_RuntimeState still restores a live scripted unit', async ({ page }) => {
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
    hook.setScriptTeamMembers('E2E_RETAIL_SAVE_TEAM', []);
    hook.setScriptTeamControllingSide('E2E_RETAIL_SAVE_TEAM', 'America');

    const entityId = hook.gameLogic.nextId as number;
    const created = hook.executeScriptAction({
      actionType: 'CREATE_OBJECT',
      params: ['RuntimeTank', 'E2E_RETAIL_SAVE_TEAM', { x: 18, y: 18, z: 0 }, 0],
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

    await hook.saveGame(slotId, 'E2E Retail-Style Save');

    const encodeAsciiString = (value: string): Uint8Array => {
      const bytes = new Uint8Array(1 + value.length);
      bytes[0] = value.length & 0xff;
      for (let index = 0; index < value.length; index += 1) {
        bytes[index + 1] = value.charCodeAt(index) & 0xff;
      }
      return bytes;
    };

    const stripSaveChunk = (data: ArrayBuffer, blockName: string): ArrayBuffer => {
      const source = new Uint8Array(data);
      const chunks: Uint8Array[] = [];
      let offset = 0;

      while (offset < source.byteLength) {
        const tokenLength = source[offset] ?? 0;
        offset += 1;
        const tokenBytes = source.slice(offset, offset + tokenLength);
        offset += tokenLength;
        const token = String.fromCharCode(...tokenBytes);

        if (token.toLowerCase() === 'sg_eof') {
          chunks.push(encodeAsciiString('SG_EOF'));
          break;
        }

        const blockSize = new DataView(source.buffer, source.byteOffset + offset, 4).getInt32(0, true);
        offset += 4;
        const blockBytes = source.slice(offset, offset + blockSize);
        offset += blockSize;

        if (token.toLowerCase() === blockName.toLowerCase()) {
          continue;
        }

        chunks.push(encodeAsciiString(token));
        const blockSizeBytes = new Uint8Array(4);
        new DataView(blockSizeBytes.buffer).setInt32(0, blockBytes.byteLength, true);
        chunks.push(blockSizeBytes);
        chunks.push(blockBytes);
      }

      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const stripped = new Uint8Array(totalLength);
      let writeOffset = 0;
      for (const chunk of chunks) {
        stripped.set(chunk, writeOffset);
        writeOffset += chunk.byteLength;
      }
      return stripped.buffer;
    };

    const openDatabase = async (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
      const request = indexedDB.open('generals-saves', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const db = await openDatabase();
    const existing = await new Promise<{ data: ArrayBuffer; metadata: Record<string, unknown> } | null>((resolve, reject) => {
      const tx = db.transaction(['save-files', 'save-metadata'], 'readonly');
      const fileReq = tx.objectStore('save-files').get(slotId);
      const metaReq = tx.objectStore('save-metadata').get(slotId);
      tx.oncomplete = () => {
        const data = fileReq.result as ArrayBuffer | undefined;
        const metadata = metaReq.result as Record<string, unknown> | undefined;
        if (!data || !metadata) {
          resolve(null);
          return;
        }
        resolve({ data, metadata });
      };
      tx.onerror = () => reject(tx.error);
    });
    if (!existing) {
      return { supported: false as const };
    }

    const strippedData = stripSaveChunk(existing.data, 'CHUNK_TS_RuntimeState');
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['save-files', 'save-metadata'], 'readwrite');
      tx.objectStore('save-files').put(strippedData, slotId);
      tx.objectStore('save-metadata').put({
        ...existing.metadata,
        sizeBytes: strippedData.byteLength,
      }, slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

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
      strippedByteLength: strippedData.byteLength,
    };
  }, 'e2e-retail-style-save');

  test.skip(!setup.supported, 'Failed to create and rewrite the retail-style save fixture.');
  expect(setup.strippedByteLength).toBeGreaterThan(0);

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
  }, 'e2e-retail-style-save');

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
