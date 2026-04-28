import { mkdirSync } from 'node:fs';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface SupermemoryAdapterOptions {
  dataDir: string;
  /** Bearer token from https://app.supermemory.ai — env var SUPERMEMORY_API_KEY */
  apiKey?: string | undefined;
  /** Override API base URL; defaults to 'https://api.supermemory.ai/v3' */
  baseUrl?: string | undefined;
}

const DEFAULT_BASE_URL = 'https://api.supermemory.ai/v3';

// Shapes returned by supermemory REST API (v3)
interface SupermemoryAddResponse {
  id?: string;
  [key: string]: unknown;
}

interface SupermemorySearchDocument {
  id: string;
  score?: number;
  metadata?: {
    title?: string;
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface SupermemorySearchResponse {
  documents?: SupermemorySearchDocument[];
  results?: SupermemorySearchDocument[];
  [key: string]: unknown;
}

/**
 * Adapter for supermemory (https://github.com/supermemoryai/supermemory).
 *
 * supermemory is a cloud-hosted memory service with hybrid RAG retrieval.
 * This adapter uses the v3 REST API directly (no npm SDK required).
 * All data transits supermemory.ai — there is no self-hosted option in the
 * public repo.
 *
 * Ingest: reads source files from each code root and POSTs them as documents.
 * Query: POSTs to /search/memories and maps results to RankedResult[].
 *
 * Gated on SUPERMEMORY_API_KEY — skipped in CI if the key is absent.
 */
export class SupermemoryAdapter implements BenchmarkAdapter {
  readonly name = 'supermemory';
  readonly mode = 'native' as const;

  private readonly dataDir: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(opts: SupermemoryAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    mkdirSync(this.dataDir, { recursive: true });
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    if (!this.apiKey) {
      throw new Error(
        'BLOCKED: SupermemoryAdapter requires SUPERMEMORY_API_KEY in env. See COMPETITORS.md.',
      );
    }

    const start = Date.now();
    let totalDocs = 0;
    let totalBytes = 0;

    for (const root of corpus.codeRoots) {
      const files = collectSourceFiles(root.path);
      for (const filePath of files) {
        let content: string;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        totalBytes += Buffer.byteLength(content, 'utf8');

        // supermemory v3: POST /memories
        const body = JSON.stringify({
          content: `File: ${filePath}\n\n${content}`,
          metadata: {
            source: 'cgbench',
            path: filePath,
            language: root.language,
            commitSha: root.commitSha,
          },
        });

        const res = await fetch(`${this.baseUrl}/memories`, {
          method: 'POST',
          headers: this.headers(),
          body,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `supermemory POST /memories failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
          );
        }

        const json = (await res.json()) as SupermemoryAddResponse;
        void json; // id available if needed for cleanup
        totalDocs++;
      }
    }

    if (corpus.knowledgeRoot !== undefined) {
      const knowledgeFiles = collectSourceFiles(corpus.knowledgeRoot);
      for (const filePath of knowledgeFiles) {
        let content: string;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        totalBytes += Buffer.byteLength(content, 'utf8');

        const body = JSON.stringify({
          content: `Knowledge: ${filePath}\n\n${content}`,
          metadata: {
            source: 'cgbench-knowledge',
            path: filePath,
          },
        });

        const res = await fetch(`${this.baseUrl}/memories`, {
          method: 'POST',
          headers: this.headers(),
          body,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `supermemory POST /memories (knowledge) failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
          );
        }

        await res.json();
        totalDocs++;
      }
    }

    const durationMs = Date.now() - start;
    const totalTokens = Math.floor(totalBytes / 4);

    return { durationMs, totalDocs, totalTokens, diskBytesAfter: totalBytes };
  }

  async query(question: string, opts?: QueryOpts): Promise<RankedResult[]> {
    if (!this.apiKey) {
      throw new Error('BLOCKED: SupermemoryAdapter requires SUPERMEMORY_API_KEY');
    }

    const topK = opts?.topK ?? 20;

    const body = JSON.stringify({
      q: question,
      limit: topK,
    });

    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: this.headers(),
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `supermemory POST /search failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
      );
    }

    const raw = (await res.json()) as SupermemorySearchResponse;

    // v3 returns either .documents or .results depending on endpoint variant
    const docs: SupermemorySearchDocument[] = raw.documents ?? raw.results ?? [];

    return docs.map((doc, idx) => ({
      id: doc.id ?? `supermemory-${idx}`,
      score: typeof doc.score === 'number' ? doc.score : 1 - idx * 0.01,
      kind: 'knowledge' as const,
      raw: doc,
    }));
  }

  async destroy(): Promise<void> {
    // supermemory is cloud-hosted — we can't easily bulk-delete the ingested
    // documents without storing IDs during ingest. No-op for now; data will
    // remain in the user's supermemory account after the benchmark run.
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
}

/** Recursively collect source files under a directory (non-hidden, non-binary). */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.md', '.txt']);

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current, { encoding: 'utf8' });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const full = join(current, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (sourceExts.has(extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}
