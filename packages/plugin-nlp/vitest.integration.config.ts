import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'src/__tests__/bridge-linker-embedding.test.ts',
      'src/__tests__/bridge-linker.test.ts',
      'src/__tests__/conflict-resolution.test.ts',
      'src/__tests__/entity-resolution.test.ts',
      'src/__tests__/episodic-extraction.test.ts',
      'src/__tests__/ingest-conversation.test.ts',
    ],
    env: {
      CODEGRAPH_EMBEDDING_PROVIDER: 'local',
    },
  },
});
