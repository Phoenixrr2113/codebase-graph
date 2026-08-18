import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/__tests__/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'src/__tests__/consolidated.test.ts',
      'src/__tests__/e2e-knowledge.test.ts',
      'src/__tests__/knowledge.test.ts',
      'src/__tests__/legacy.test.ts',
      'src/__tests__/reindex.test.ts',
    ],
  },
});
