import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'src/__tests__/about*.test.ts',
      'src/__tests__/falkordb-{operations,git-operations,knowledge-operations}.test.ts',
    ],
    env: {
      CODEGRAPH_EMBEDDING_PROVIDER: 'local',
    },
  },
});
