#!/usr/bin/env tsx
/**
 * Ingest fact-*.md documents into the existing cgbench graph.
 *
 * Used when the benchmark is run with --skip-ingest but the document corpus
 * (Task F) wasn't included in a prior ingest. Talks to the codegraph MCP
 * server over stdio (same path the adapter uses) and calls the raw `add`
 * tool for each fact-NNN.md file. The FalkorDB graph already has the code
 * and knowledge corpora; this script only adds the missing document corpus.
 */
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnMCPClient, callMCPTool, closeMCPClient } from '../src/adapters/_mcp-base.js';

const docsDir = process.argv[2] ?? resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'documents',
  'source',
);

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const mcpServerPath = resolve(workspaceRoot, 'packages/mcp-server/src/index.ts');

async function main() {
  // Force the embedding provider/dim to match the existing 768-dim vector index.
  // The user's .env may carry CODEGRAPH_EMBEDDING_PROVIDER=voyage and
  // CODEGRAPH_EMBEDDING_DIM=1024 from a different setup — letting those leak
  // through trips the embedding-dim conflict check in falkordb-shared and
  // every `add` errors with INDEX_FAILED.
  const { CODEGRAPH_EMBEDDING_DIM: _staleDim, CODEGRAPH_EMBEDDING_PROVIDER: _staleProvider, ...sanitizedProcessEnv } =
    process.env as Record<string, string | undefined>;
  void _staleDim; void _staleProvider;

  const env: Record<string, string> = {
    ...sanitizedProcessEnv as Record<string, string>,
    FALKORDB_HOST: process.env['CGBENCH_FALKORDB_HOST'] ?? 'localhost',
    FALKORDB_PORT: process.env['CGBENCH_FALKORDB_PORT'] ?? '6380',
    CODEGRAPH_DRIVER: 'falkordb',
    CODEGRAPH_EMBEDDING_PROVIDER: 'local',
    CODEGRAPH_RERANK_PROVIDER: process.env['CODEGRAPH_RERANK_PROVIDER'] ?? 'none',
    CODEGRAPH_RAW_TOOLS: 'true',
  };

  console.error(`[ingest-fact-docs] spawning MCP server (FalkorDB ${env['FALKORDB_HOST']}:${env['FALKORDB_PORT']})`);
  const client = await spawnMCPClient({
    command: 'pnpm',
    args: ['tsx', mcpServerPath],
    env,
  });

  try {
    const entries = await readdir(docsDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name.toLowerCase() === 'readme.md') continue;
      const filePath = join(docsDir, entry.name);
      const slug = basename(entry.name, extname(entry.name));
      try {
        await callMCPTool(
          client,
          'add',
          { input: filePath, source: `cgbench:${slug}` },
          90_000,
        );
        count++;
        console.error(`[ingest-fact-docs] added ${slug}`);
      } catch (err) {
        console.warn(`[ingest-fact-docs] failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.error(`[ingest-fact-docs] done — ${count} document(s) added`);
  } finally {
    await closeMCPClient(client).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
