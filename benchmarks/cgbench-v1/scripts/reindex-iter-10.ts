/**
 * Focused reindex script for cgbench iter-10 verification gate.
 *
 * - Connects to FalkorDB :6380 (the cgbench-falkordb container)
 * - Forces full reindex of zod corpus
 * - Uses local 768-dim embeddings (matches cgbench iter-10 config)
 * - Skips git sync (zod is in cgbench corpora, not in our repo)
 *
 * This bypasses the MCP-server-spawn approach used by the cgbench adapter
 * because we only need a fresh code graph — we're not running ingestion.
 * (The knowledge corpus was already ingested in a prior iter and persisted
 *  in :6380; --skip-ingest in the cgbench run-all reuses it.)
 */
import { indexProject, getGraphClient } from '@codegraph/core';

const ZOD_PATH = '/Users/randywilson/Desktop/codebase-graph/benchmarks/cgbench-v1/corpora/code/colinhacks-zod';

async function main(): Promise<void> {
  // Make absolutely sure we're hitting the cgbench FalkorDB on :6380
  process.env['FALKORDB_HOST'] = process.env['FALKORDB_HOST'] || 'localhost';
  process.env['FALKORDB_PORT'] = process.env['FALKORDB_PORT'] || '6380';
  process.env['CODEGRAPH_DRIVER'] = 'falkordb';
  process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'local';
  process.env['CODEGRAPH_EMBEDDING_DIM'] = '768';

  console.log(`[reindex] FalkorDB: ${process.env['FALKORDB_HOST']}:${process.env['FALKORDB_PORT']}`);
  console.log(`[reindex] Embeddings: local @ 768-dim`);
  console.log(`[reindex] Project: ${ZOD_PATH}`);

  const start = Date.now();
  const client = await getGraphClient();
  const result = await indexProject(ZOD_PATH, {
    force: true,
    deepAnalysis: true,
    includeExternals: false,
    gitSync: false,
    client,
  });

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[reindex] Done in ${duration}s`);
  console.log(`[reindex] success=${result.success}`);
  console.log(`[reindex] stats=${JSON.stringify(result.stats)}`);
  if (result.errorMessages && result.errorMessages.length > 0) {
    console.error(`[reindex] errors:`);
    for (const err of result.errorMessages.slice(0, 10)) {
      console.error(`  - ${err}`);
    }
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error(`[reindex] FATAL:`, err);
  process.exit(1);
});
