import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@generals/core': resolve(__dirname, 'packages/core/src'),
      '@generals/engine': resolve(__dirname, 'packages/engine/src'),
      '@generals/assets': resolve(__dirname, 'packages/assets/src'),
      '@generals/renderer': resolve(__dirname, 'packages/renderer/src'),
      '@generals/audio': resolve(__dirname, 'packages/audio/src'),
      '@generals/ui': resolve(__dirname, 'packages/ui/src'),
      '@generals/input': resolve(__dirname, 'packages/input/src'),
      '@generals/game-logic': resolve(__dirname, 'packages/game-logic/src'),
      '@generals/terrain': resolve(__dirname, 'packages/terrain/src'),
      '@generals/network': resolve(__dirname, 'packages/network/src'),
      '@generals/ini-data': resolve(__dirname, 'packages/ini-data/src'),
    },
  },
  test: {
    globals: true,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.spec.ts',
      'tools/*.test.ts',
      'tools/*.spec.ts',
      'tools/*/src/**/*.test.ts',
      'tools/*/src/**/*.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/index.ts'],
    },
  },
});
