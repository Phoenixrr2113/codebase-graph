import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'src/__tests__/{conversation-said,entity-id-persistence,falkordblite,temporal-queries,v5-features,merge-entities-identity}.test.ts',
    ],
    env: {
      CODEGRAPH_EMBEDDING_PROVIDER: 'local',
    },
  },
});
