import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E tests hit a real Kuzu database
    // Use separate forks so Kuzu native module crashes on close are isolated per file
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['src/__tests__/**/*.test.ts'],
  },
});
