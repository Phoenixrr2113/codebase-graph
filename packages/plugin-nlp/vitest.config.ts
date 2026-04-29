import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/__tests__/**/*.test.ts'],
  },
});
