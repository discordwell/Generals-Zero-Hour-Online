import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const quoteShellArg = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;
const nodeCommand = quoteShellArg(process.execPath);
const viteCli = quoteShellArg(path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js'));
const viteCommand = `${nodeCommand} ${viteCli}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 180_000,
  workers: 2,
  retries: 0,
  use: {
    baseURL: 'http://localhost:42173',
    headless: true,
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: `${viteCommand} build && ${viteCommand} preview --host 127.0.0.1 --port 42173`,
    port: 42173,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
