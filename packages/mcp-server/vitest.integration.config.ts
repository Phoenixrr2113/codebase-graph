import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      CODEGRAPH_DRIVER: 'falkordb',
      CODEGRAPH_EMBEDDING_PROVIDER: 'none',
      FALKORDB_HOST: 'localhost',
    },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'src/__tests__/consolidated.test.ts',
      'src/__tests__/e2e-knowledge.test.ts',
      'src/__tests__/knowledge.test.ts',
      'src/__tests__/legacy.test.ts',
      'src/__tests__/reindex.test.ts',
    ],
  },
});
