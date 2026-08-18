import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'tests/**/*.integration.test.ts',
      'tests/**/*.smoke.test.ts',
      'tests/cli.test.ts',
      'tests/cli-run-all.test.ts',
    ],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
