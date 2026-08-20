import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Redirects SQLITE_PATH to a temp database before kvStore.ts is imported.
    setupFiles: ['src/__tests__/setup.ts'],
    // The suite writes to one shared SQLite file, so keep it single-threaded.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
