import { defineConfig } from 'vitest/config';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  test: {
    env: {
      CODEGRAPH_DRIVER: 'falkordb',
      CODEGRAPH_EMBEDDING_PROVIDER: 'none',
      CODEGRAPH_DATA_DIR: join(tmpdir(), 'codegraph-mcp-integration'),
      FALKORDB_HOST: 'localhost',
      FALKORDB_GRAPH: 'codegraph-mcp-integration',
    },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'src/__tests__/knowledge.test.ts',
      'src/__tests__/reindex.test.ts',
    ],
  },
});
