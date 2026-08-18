import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/adapters/**/*.smoke.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 90_000,
  },
});
