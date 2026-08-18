import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      CODEGRAPH_DRIVER: 'falkordb',
      CODEGRAPH_EMBEDDING_PROVIDER: 'none',
      FALKORDB_HOST: 'localhost',
    },
    include: [
      'tests/adapters/codegraph.integration.test.ts',
      'tests/runner.integration.test.ts',
      'tests/cli.test.ts',
      'tests/cli-run-all.test.ts',
    ],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 180_000,
    hookTimeout: 90_000,
  },
});
