import { test, expect } from '@playwright/test';

// Use a real extracted map for smoke coverage instead of the synthetic test fixtures.
const TEST_MAP_URL =
  '/?map=assets/maps/_extracted/MapsZH/Maps/Tournament%20Desert/Tournament%20Desert.json';

test('app loads and renders terrain', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(TEST_MAP_URL);

  // Loading screen should appear then fade (60s for asset loading under SwiftShader)
  const loadingScreen = page.locator('#loading-screen');
  await expect(loadingScreen).toBeHidden({ timeout: 60_000 });

  // Canvas should exist
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();

  // Debug info should show FPS after ~1s
  const debugInfo = page.locator('#debug-info');
  await expect(debugInfo).toContainText('FPS', { timeout: 5_000 });

  // No uncaught JS errors
  expect(errors).toEqual([]);
});

test('main menu loads when no map specified', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // Loading screen should hide after initialization
  const loadingScreen = page.locator('#loading-screen');
  await expect(loadingScreen).toBeHidden({ timeout: 60_000 });

  // Main menu buttons should be visible
  await expect(page.getByRole('button', { name: 'Single Player' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skirmish' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Options' })).toBeVisible();

  // No uncaught JS errors
  expect(errors).toEqual([]);
});
