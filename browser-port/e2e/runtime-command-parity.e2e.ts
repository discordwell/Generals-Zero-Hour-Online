/**
 * Runtime Command Parity — Layer 1d (player-command behavior fingerprint).
 *
 * Layer 1c locks down idle simulation determinism.  This file goes further:
 * it issues actual player commands through the live command pipeline
 * (`__GENERALS_E2E__.submitCommand`), advances frames, and verifies the
 * resulting state matches a committed golden fingerprint.
 *
 * The scenario picks a deterministic VEHICLE from the save (smallest id
 * that's alive, movable, has a side, not airborne), issues a moveTo
 * command 50 units in +X / +Z, advances 30 frames, then captures the
 * post-command CRC.  Re-running with the same inputs must produce
 * identical CRCs — proves the entire command dispatch + AI + movement
 * pipeline is deterministic.
 *
 * Composes with `e2e/runtime-behavior-parity.e2e.ts`:
 *   - 1c: idle simulation is byte-deterministic
 *   - 1d: command-driven simulation is byte-deterministic
 * Together they verify the full runtime is locked down.
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FINGERPRINT_DIR = resolve('parity-reports/runtime-command-fingerprints');
const FIXTURE_DIR = resolve('fixtures/source-saves');
const FIXTURES = ['zipeater_GN_000.sav', 'zipeater_ZH_000.sav'];

interface CommandFingerprint {
  fixture: string;
  scenario: string;
  startFrame: number;
  selectedEntityId: number | null;
  selectedEntityTemplate: string | null;
  initialPosition: { x: number; z: number } | null;
  destination: { x: number; z: number };
  postCommand: {
    frame: number;
    totalCrc: number;
    sections: Record<string, number>;
    entityPosition: { x: number; z: number } | null;
    entityDestroyed: boolean;
  };
}

function fingerprintPath(fixture: string): string {
  return resolve(FINGERPRINT_DIR, `${fixture}.json`);
}

async function openLoadGameScreen(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Load Game' }).click();
  await expect(page.locator('.load-game-overlay')).toBeVisible({ timeout: 120_000 });
}

async function runCommandScenario(
  page: import('@playwright/test').Page,
  fixture: string,
): Promise<CommandFingerprint> {
  await openLoadGameScreen(page);

  await page.locator('[data-ref="load-game-import-input"]').setInputFiles(resolve(FIXTURE_DIR, fixture));
  await page.waitForFunction(
    () => document.querySelectorAll('.load-game-row-title').length > 0,
    { timeout: 120_000 },
  );

  await page.evaluate(() => {
    (window as Record<string, unknown>)['__GENERALS_E2E_AUTO_PAUSE__'] = true;
  });
  await page.locator('.load-game-overlay [data-action="load"]').click();
  await page.locator('.load-game-overlay [data-action="confirm-load"]').click();
  await page.waitForFunction(
    () => Boolean((window as Record<string, unknown>)['__GENERALS_E2E__']),
    { timeout: 120_000 },
  );
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 120_000 });

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook?.setSimulationPaused?.(true);
  });

  const setup = await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook.gameLogic;
    const startFrame = logic.frameCounter as number;
    const all = Array.from(logic.spawnedEntities.values()) as Array<{
      id: number;
      destroyed?: boolean;
      canMove?: boolean;
      side?: string;
      x: number; z: number;
      templateName?: string;
      kindOf?: Set<string>;
    }>;
    // Smallest-id alive vehicle with a side.  Deterministic across runs.
    const candidates = all
      .filter((e) => !e.destroyed && e.canMove && (e.side ?? '').length > 0)
      .filter((e) => e.kindOf?.has('VEHICLE') && !e.kindOf?.has('AIRCRAFT'))
      .sort((a, b) => a.id - b.id);
    const target = candidates[0];
    if (!target) {
      return {
        startFrame,
        selectedEntityId: null as number | null,
        selectedEntityTemplate: null as string | null,
        initialPosition: null as { x: number; z: number } | null,
        destination: { x: 0, z: 0 },
      };
    }
    const destination = { x: target.x + 50, z: target.z + 50 };
    hook.submitCommand({
      type: 'moveTo',
      entityId: target.id,
      x: destination.x,
      z: destination.z,
    });
    return {
      startFrame,
      selectedEntityId: target.id,
      selectedEntityTemplate: target.templateName ?? null,
      initialPosition: { x: target.x, z: target.z },
      destination,
    };
  });

  await page.evaluate(() => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    hook.stepSimulationFrames(30);
  });

  const post = await page.evaluate((id) => {
    const hook = (window as Record<string, any>)['__GENERALS_E2E__'];
    const logic = hook.gameLogic;
    const e = id !== null ? (logic.spawnedEntities.get(id) as
      | { x: number; z: number; destroyed?: boolean } | undefined) : undefined;
    return {
      frame: logic.frameCounter as number,
      totalCrc: hook.computeGameLogicCrc() as number,
      sections: hook.computeGameLogicCrcSections() as Record<string, number>,
      entityPosition: e ? { x: e.x, z: e.z } : null,
      entityDestroyed: e?.destroyed ?? true,
    };
  }, setup.selectedEntityId);

  return {
    fixture,
    scenario: 'move-vehicle-50-50',
    startFrame: setup.startFrame,
    selectedEntityId: setup.selectedEntityId,
    selectedEntityTemplate: setup.selectedEntityTemplate,
    initialPosition: setup.initialPosition,
    destination: setup.destination,
    postCommand: post,
  };
}

for (const fixture of FIXTURES) {
  test(`runtime command fingerprint (move): ${fixture}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const observed = await runCommandScenario(page, fixture);

    if (observed.selectedEntityId === null) {
      test.skip(true, `${fixture}: no movable VEHICLE entity available for the scenario.`);
      return;
    }

    const path = fingerprintPath(fixture);
    if (!existsSync(path)) {
      mkdirSync(FINGERPRINT_DIR, { recursive: true });
      writeFileSync(path, JSON.stringify(observed, null, 2));
      test.info().annotations.push({
        type: 'fingerprint-bootstrap',
        description: `Wrote initial command fingerprint for ${fixture}`,
      });
    } else {
      const recorded = JSON.parse(readFileSync(path, 'utf8')) as CommandFingerprint;
      expect(observed.selectedEntityId).toBe(recorded.selectedEntityId);
      expect(observed.selectedEntityTemplate).toBe(recorded.selectedEntityTemplate);
      expect(observed.startFrame).toBe(recorded.startFrame);
      expect(observed.postCommand.frame).toBe(recorded.postCommand.frame);
      expect(
        observed.postCommand.totalCrc,
        `${fixture}: post-command CRC drift (was 0x${recorded.postCommand.totalCrc.toString(16)}, now 0x${observed.postCommand.totalCrc.toString(16)})`,
      ).toBe(recorded.postCommand.totalCrc);
      expect(observed.postCommand.entityPosition).toEqual(recorded.postCommand.entityPosition);
      expect(observed.postCommand.entityDestroyed).toBe(recorded.postCommand.entityDestroyed);
    }

    expect(observed.postCommand.frame).toBe(observed.startFrame + 30);
    expect(errors).toEqual([]);
  });
}
