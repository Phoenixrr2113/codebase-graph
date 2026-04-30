import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.ts'],
    testTimeout: 30000,  // FalkorDB connect can be slow on first call
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },  // FalkorDB connection state is process-global
    },
  },
});
