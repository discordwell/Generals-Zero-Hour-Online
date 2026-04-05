import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:42173',
    headless: true,
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite build && npx serve dist -l 42173',
    port: 42173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
