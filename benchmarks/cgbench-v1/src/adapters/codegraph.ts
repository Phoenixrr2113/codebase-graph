import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { indexProject } from '@codegraph/core';
import { createClient } from '@codegraph/graph';
import type { GraphClient, QueryOptions } from '@codegraph/graph';

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

  async query(question: string, opts?: QueryOpts): Promise<RankedResult[]> {
    const client = await this.getClient();
    const limit = opts?.topK ?? 20;

    // Lexical fallback: enrichedSearchV2 requires embeddings, which are disabled
    // during benchmark ingest (embeddings: false). Use a direct Cypher name-match
    // across all code node types so the benchmark can work without a vector index.
    //
    // Strategy:
    //   1. Extract non-trivial words (≥3 chars) from the question.
    //   2. For each word, also include a 4-char stem (e.g. "retries" → "retr")
    //      so morphological variants match (e.g. "retry", "retryWithBackoff").
    //   3. Match nodes whose name or filePath contains any of the terms/stems.
    //   4. Score by number of term/stem hits.
    const rawTerms = question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    // Expand with 4-char stems for each term longer than 4 chars.
    const expanded: string[] = [];
    for (const t of rawTerms) {
      expanded.push(t);
      if (t.length > 4) {
        expanded.push(t.slice(0, 4));
      }
    }
    const uniqueTerms = [...new Set(expanded)];

    if (uniqueTerms.length === 0) {
      return [];
    }

    // Build a CASE-based score expression: +1 for each term/stem that appears in
    // the node name or filePath. Nodes with no match are excluded.
    const matchClause = (i: number): string =>
      `(toLower(n.name) CONTAINS $t${i} OR toLower(n.filePath) CONTAINS $t${i})`;

    const scoreExpr = uniqueTerms
      .map((_, i) => `CASE WHEN ${matchClause(i)} THEN 1 ELSE 0 END`)
      .join(' + ');

    const params: QueryOptions['params'] = { limit };
    for (let i = 0; i < uniqueTerms.length; i++) {
      params[`t${i}`] = uniqueTerms[i]!;
    }

    const cypher = `
      MATCH (n)
      WHERE n.name IS NOT NULL
        AND (${uniqueTerms.map((_, i) => matchClause(i)).join(' OR ')})
      WITH n, (${scoreExpr}) AS matchScore
      WHERE matchScore > 0
      RETURN n.name AS name, n.filePath AS filePath, labels(n)[0] AS nodeType, matchScore
      ORDER BY matchScore DESC
      LIMIT $limit
    `;

    const result = await client.roQuery<{
      name: string;
      filePath: string | null;
      nodeType: string;
      matchScore: number;
    }>(cypher, { params });

    return result.data.map((row) => ({
      id: this.resultId(row),
      score: row.matchScore,
      kind: 'code' as const,
      raw: row,
    }));
  }

  private resultId(hit: { filePath?: string | null; name?: string | null }): string {
    const file = hit.filePath ?? 'unknown';
    const name = hit.name ?? 'unknown';
    return `${file}#${name}`;
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}
