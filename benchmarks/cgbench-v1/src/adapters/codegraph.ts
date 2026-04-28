import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { indexProject } from '@codegraph/core';
import { createClient } from '@codegraph/graph';
import type { GraphClient } from '@codegraph/graph';

export interface CodeGraphAdapterOptions {
  dataDir: string;
}

/**
 * CodeGraph native adapter for the benchmark harness.
 *
 * Lifecycle:
 *   - constructor: prepares dataDir, no client yet
 *   - ingest():    opens client, indexes corpus, closes client to flush dump.rdb
 *   - query():     lazily reopens client (Task 14)
 *   - destroy():   closes client if open
 *
 * After ingest() returns, this.client is null. Any subsequent query() must call
 * getClient() to reopen — FalkorDBLite only flushes its RDB snapshot on close,
 * so the close-and-reopen pattern is what makes diskBytesAfter measurable.
 *
 * Git sync is disabled because fixture corpora live inside the cgbench worktree;
 * indexing would otherwise pull the parent repo's commit history into the graph.
 */
export class CodeGraphAdapter implements BenchmarkAdapter {
  readonly name = 'codegraph';
  readonly mode = 'native' as const;
  private readonly dataDir: string;
  private client: GraphClient | null = null;

  constructor(opts: CodeGraphAdapterOptions) {
    this.dataDir = opts.dataDir;
    mkdirSync(this.dataDir, { recursive: true });
  }

  private async getClient(): Promise<GraphClient> {
    if (!this.client) {
      this.client = await createClient({
        driver: 'falkordblite',
        databasePath: join(this.dataDir, 'falkordb'),
      });
    }
    return this.client;
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    let totalDocs = 0;

    const client = await this.getClient();

    for (const root of corpus.codeRoots) {
      const result = await indexProject(root.path, {
        client,
        embeddings: false,
        force: true,
        gitSync: false,
      });
      totalDocs += result.stats.files;
    }

    // Close to flush dump.rdb before disk measurement; query() reopens lazily.
    await client.close();
    this.client = null;

    const durationMs = Date.now() - start;
    const diskBytesAfter = existsSync(this.dataDir)
      ? await measureDiskBytes(this.dataDir)
      : 0;
    // Rough byte-based proxy until indexProject surfaces a real token count.
    const totalTokens = Math.floor(diskBytesAfter / 4);

    return { durationMs, totalDocs, totalTokens, diskBytesAfter };
  }

  async query(_question: string, _opts?: QueryOpts): Promise<RankedResult[]> {
    throw new Error('query() not implemented yet — see Task 14');
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}
