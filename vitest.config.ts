import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// On Windows run tests through `npm test` (scripts/vitest.mjs), which normalises a
// lowercase drive letter in the working directory before Vitest loads.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    setupFiles: ['tests/setup/per-file.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Integration tests share one in-memory replica set.
    fileParallelism: false,
  },
});
