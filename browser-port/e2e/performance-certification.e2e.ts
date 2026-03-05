import { expect, test } from '@playwright/test';

const TEST_MAP_URL = '/?map=assets/maps/ScenarioSkirmish.json';
const MAX_LOAD_TIME_MS = 15_000;
const MAX_AVERAGE_FRAME_TIME_MS = 45;
const MAX_P95_FRAME_TIME_MS = 90;
const MAX_USED_HEAP_BYTES = 300 * 1024 * 1024;

test('performance certification stays within load/frame/memory thresholds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const loadStartMs = Date.now();
  await page.goto(TEST_MAP_URL);
  await expect(page.locator('#loading-screen')).toBeHidden({ timeout: MAX_LOAD_TIME_MS });
  const loadDurationMs = Date.now() - loadStartMs;

  const metrics = await page.evaluate(async () => {
    const frameDurations: number[] = [];
    let previous = performance.now();

    await new Promise<void>((resolve) => {
      let remaining = 120;
      const tick = (timestamp: number) => {
        frameDurations.push(timestamp - previous);
        previous = timestamp;
        remaining -= 1;
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const sorted = [...frameDurations].sort((left, right) => left - right);
    const averageFrameTimeMs = frameDurations.reduce((sum, value) => sum + value, 0) / frameDurations.length;
    const p95Index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
    );
    const p95FrameTimeMs = sorted[p95Index] ?? averageFrameTimeMs;

    const memory = performance as Performance & {
      memory?: {
        usedJSHeapSize?: number;
      };
    };

    return {
      frameSampleCount: frameDurations.length,
      averageFrameTimeMs,
      p95FrameTimeMs,
      usedHeapBytes: typeof memory.memory?.usedJSHeapSize === 'number'
        ? memory.memory.usedJSHeapSize
        : null,
    };
  });

  expect(errors).toEqual([]);
  expect(loadDurationMs).toBeLessThanOrEqual(MAX_LOAD_TIME_MS);
  expect(metrics.frameSampleCount).toBe(120);
  expect(metrics.averageFrameTimeMs).toBeLessThanOrEqual(MAX_AVERAGE_FRAME_TIME_MS);
  expect(metrics.p95FrameTimeMs).toBeLessThanOrEqual(MAX_P95_FRAME_TIME_MS);
  if (metrics.usedHeapBytes !== null) {
    expect(metrics.usedHeapBytes).toBeLessThanOrEqual(MAX_USED_HEAP_BYTES);
  }
});
