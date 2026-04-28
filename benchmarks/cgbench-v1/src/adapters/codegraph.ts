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
    await client.ensureIndexes();

    for (const root of corpus.codeRoots) {
      const result = await indexProject(root.path, {
        client,
        embeddings: false,
        force: true,
      });
      totalDocs += result.stats.files;
    }

    // Close and reopen the client to flush the RDB snapshot to disk before
    // measuring disk bytes. FalkorDBLite only writes dump.rdb on close().
    await this.client!.close();
    this.client = null;

    const durationMs = Date.now() - start;
    const diskBytesAfter = existsSync(this.dataDir)
      ? await measureDiskBytes(this.dataDir)
      : 0;
    const totalTokens = Math.floor(diskBytesAfter / 4);

    return { durationMs, totalDocs, totalTokens, diskBytesAfter };
  }

  async query(_question: string, _opts?: QueryOpts): Promise<RankedResult[]> {
    throw new Error('query() not implemented yet — see Task 14');
  }

  async destroy(): Promise<void> {
    // Implemented in Task 15
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}
