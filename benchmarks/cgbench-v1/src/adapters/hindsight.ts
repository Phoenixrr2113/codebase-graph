import { mkdirSync } from 'node:fs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, extname } from 'node:path';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

export interface HindsightAdapterOptions {
  dataDir: string;
  /**
   * Base URL of the running hindsight instance.
   * Defaults to 'http://localhost:8888'.
   * Set env var HINDSIGHT_URL to override.
   */
  baseUrl?: string | undefined;
}

const DEFAULT_BASE_URL = 'http://localhost:8888';

// Shapes from hindsight REST API
interface HindsightRetainResponse {
  id?: string;
  [key: string]: unknown;
}

interface HindsightRecallResult {
  id?: string;
  content?: string;
  score?: number;
  relevance?: number;
  metadata?: { path?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface HindsightRecallResponse {
  results?: HindsightRecallResult[];
  memories?: HindsightRecallResult[];
  [key: string]: unknown;
}

/**
 * Adapter for hindsight (https://github.com/vectorize-io/hindsight).
 *
 * hindsight exposes a REST API only (no MCP). It uses four parallel retrieval
 * strategies (semantic, keyword, graph, temporal). An LLM provider key is
 * required (OpenAI, Anthropic, Gemini, Groq) unless Ollama/LMStudio is used.
 *
 * Setup (Docker):
 *   docker run --rm -d -p 8888:8888 -p 9999:9999 \
 *     -e HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY \
 *     ghcr.io/vectorize-io/hindsight:latest
 *
 * This adapter is gated on HINDSIGHT_URL being set (confirms Docker is up).
 * The LLM key must be configured inside the Docker container at launch time;
 * the adapter communicates only over the local REST API.
 *
 * Ingest: POST /retain — one call per source file.
 * Query:  POST /recall — returns merged results from all retrieval strategies.
 */
export class HindsightAdapter implements BenchmarkAdapter {
  readonly name = 'hindsight';
  readonly mode = 'native' as const;

  private readonly dataDir: string;
  private readonly baseUrl: string;

  constructor(opts: HindsightAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.baseUrl =
      opts.baseUrl ??
      (process.env['HINDSIGHT_URL'] !== undefined && process.env['HINDSIGHT_URL'] !== ''
        ? process.env['HINDSIGHT_URL']
        : DEFAULT_BASE_URL);
    mkdirSync(this.dataDir, { recursive: true });
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    if (!this.isConfigured()) {
      throw new Error(
        'BLOCKED: HindsightAdapter requires a running hindsight instance. ' +
          'Set HINDSIGHT_URL env var pointing to the Docker container. ' +
          'Start with: docker run --rm -d -p 8888:8888 -p 9999:9999 ' +
          '-e HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY ' +
          'ghcr.io/vectorize-io/hindsight:latest. See COMPETITORS.md §4.',
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

        const fileBytes = Buffer.byteLength(content, 'utf8');
        totalBytes += fileBytes;

        // hindsight POST /retain
        const body = JSON.stringify({
          data: `File: ${filePath}\n\n${content}`,
          metadata: {
            source: 'cgbench',
            path: filePath,
            language: root.language,
            commitSha: root.commitSha,
          },
        });

        const res = await fetch(`${this.baseUrl}/retain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `hindsight POST /retain failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
          );
        }

        const json = (await res.json()) as HindsightRetainResponse;
        void json;
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
          data: `Knowledge: ${filePath}\n\n${content}`,
          metadata: {
            source: 'cgbench-knowledge',
            path: filePath,
          },
        });

        const res = await fetch(`${this.baseUrl}/retain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `hindsight POST /retain (knowledge) failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
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
    if (!this.isConfigured()) {
      throw new Error(
        'BLOCKED: HindsightAdapter requires a running hindsight instance (HINDSIGHT_URL). See COMPETITORS.md §4.',
      );
    }

    const topK = opts?.topK ?? 20;

    // hindsight POST /recall
    const body = JSON.stringify({
      query: question,
      n: topK,
    });

    const res = await fetch(`${this.baseUrl}/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `hindsight POST /recall failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
      );
    }

    const raw = (await res.json()) as HindsightRecallResponse;
    const results: HindsightRecallResult[] = raw.results ?? raw.memories ?? [];

    // Project metadata.path → <basename>#<basename> so cross-system gold IDs
    // resolve. Fall back to opaque service ID only if no path metadata.
    return results.map((r, idx) => {
      const score =
        typeof r.score === 'number'
          ? r.score
          : typeof r.relevance === 'number'
            ? r.relevance
            : 1 - idx * 0.01;
      const path = r.metadata?.path;
      const id = path ? `${basename(path)}#${basename(path)}` : (r.id ?? `hindsight-${idx}`);
      return {
        id,
        score,
        kind: 'knowledge' as const,
        raw: r,
      };
    });
  }

  async destroy(): Promise<void> {
    // hindsight data lives inside the Docker container — nothing to clean up
    // on the host. The container should be stopped externally after the run.
  }

  /** Returns true only when HINDSIGHT_URL is explicitly set — confirms Docker is up. */
  private isConfigured(): boolean {
    return (
      process.env['HINDSIGHT_URL'] !== undefined && process.env['HINDSIGHT_URL'] !== ''
    );
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
