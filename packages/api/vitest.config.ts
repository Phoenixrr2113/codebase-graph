import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@codegraph/core': resolve(__dirname, '../core/src/index.ts'),
      '@codegraph/graph': resolve(__dirname, '../graph/src/index.ts'),
      '@codegraph/logger': resolve(__dirname, '../logger/src/index.ts'),
      '@codegraph/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
