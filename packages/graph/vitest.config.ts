import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests hit a real Kuzu database
    // Use separate forks so Kuzu native module crashes on close are isolated per file
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Only run .test.ts files in __tests__ directories
    include: ['src/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'src/__tests__/about*.test.ts',
      'src/__tests__/falkordb-{operations,git-operations,knowledge-operations}.test.ts',
    ],
  },
});
