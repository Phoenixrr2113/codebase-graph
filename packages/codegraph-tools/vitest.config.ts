import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Point workspace packages to their src entry so vitest doesn't need a
      // dist build. The dynamic import('@codegraph/core') in vercel.ts / mastra.ts
      // is only reached when _searchFn is NOT provided — all tests inject _searchFn.
      '@codegraph/core': resolve(__dirname, '../core/src/index.ts'),
      '@codegraph/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
