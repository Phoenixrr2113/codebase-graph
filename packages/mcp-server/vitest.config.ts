import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests hit a real Kuzu/FalkorDB database — run sequentially
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Only run .test.ts files in __tests__ directory
    include: ['src/__tests__/**/*.test.ts'],
  },
});
