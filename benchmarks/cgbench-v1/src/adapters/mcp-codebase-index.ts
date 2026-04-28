import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import {
  spawnMCPClient,
  callMCPTool,
  closeMCPClient,
} from './_mcp-base.js';

export interface McpCodebaseIndexAdapterOptions {
  dataDir: string;
  /**
   * Path to the mcp-codebase-index server entry point.
   * Defaults to the `mcp-codebase-index` console script on PATH or
   * `/opt/anaconda3/bin/mcp-codebase-index` as a fallback.
   */
  serverScript?: string;
}

/** Response shape from the MCP TextContent array. */
interface TextContent {
  type: 'text';
  text: string;
}

/** Shape returned by search_codebase tool. */
interface SearchHit {
  file: string;
  line_number: number;
  content: string;
}

/** Shape returned by get_project_summary tool (JSON string in text). */
interface ProjectSummary {
  files?: number;
  total_lines?: number;
  functions?: number;
  [key: string]: unknown;
}

/**
 * Adapter for mcp-codebase-index (https://github.com/MikeRecognex/mcp-codebase-index).
 *
 * mcp-codebase-index is a structural codebase indexer with an MCP server.
 * It uses Python + tree-sitter to parse TypeScript, Python, Go, Rust, C#,
 * and several text formats. Query is regex-based (search_codebase).
 *
 * Ingest triggers indexing via `get_project_summary`, which builds the
 * structural index and writes a .codebase-index-cache.pkl file inside
 * PROJECT_ROOT. We track cache files for cleanup in destroy().
 *
 * Because PROJECT_ROOT must point at the actual source tree, and because
 * the server accepts only one PROJECT_ROOT per process, we spawn one server
 * per corpus root. For benchmark workloads with a single codebase this means
 * one MCP subprocess per run.
 */
export class McpCodebaseIndexAdapter implements BenchmarkAdapter {
  readonly name = 'mcp-codebase-index';
  readonly mode = 'mcp' as const;

  private readonly dataDir: string;
  private readonly serverScript: string;

  /** Active MCP clients — one per corpus root during ingest, then kept for query. */
  private clients: { client: Client; projectRoot: string }[] = [];

  constructor(opts: McpCodebaseIndexAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.serverScript =
      opts.serverScript ??
      (existsSync('/opt/anaconda3/bin/mcp-codebase-index')
        ? '/opt/anaconda3/bin/mcp-codebase-index'
        : 'mcp-codebase-index');
    mkdirSync(this.dataDir, { recursive: true });
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    let totalDocs = 0;

    for (const root of corpus.codeRoots) {
      const client = await spawnMCPClient({
        command: this.serverScript,
        args: [],
        env: {
          ...(process.env as Record<string, string>),
          PROJECT_ROOT: root.path,
        },
      });

      this.clients.push({ client, projectRoot: root.path });

      // get_project_summary triggers indexing + builds the cache.
      const raw = await callMCPTool<TextContent[]>(client, 'get_project_summary', {});
      const text = raw[0]?.text ?? '{}';
      let summary: ProjectSummary = {};
      try {
        summary = JSON.parse(text) as ProjectSummary;
      } catch {
        // server may return plain text for some responses; that's fine
      }

      // Count files from summary or fall back to 1 (at least the root).
      totalDocs += typeof summary.files === 'number' ? summary.files : 1;
    }

    const durationMs = Date.now() - start;
    const diskBytesAfter = existsSync(this.dataDir)
      ? await measureDiskBytes(this.dataDir)
      : 0;
    // Rough proxy for index size — cache files in project roots.
    const cacheBytes = this.clients.reduce((sum, c) => {
      const cachePath = join(c.projectRoot, '.codebase-index-cache.pkl');
      if (existsSync(cachePath)) {
        // du is called in measureDiskBytes so we use a simple fallback estimate
        return sum + 50_000; // ~50KB per typical small project
      }
      return sum;
    }, 0);
    const totalTokens = Math.floor((diskBytesAfter + cacheBytes) / 4);

    return { durationMs, totalDocs, totalTokens, diskBytesAfter };
  }

  async query(question: string, opts?: QueryOpts): Promise<RankedResult[]> {
    if (this.clients.length === 0) {
      return [];
    }

    const topK = opts?.topK ?? 20;

    // Build a keyword OR regex from the question.
    // Extract non-trivial words (≥3 chars), escape regex metacharacters.
    const keywords = question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .map((w) => escapeRegex(w));

    if (keywords.length === 0) {
      return [];
    }

    const pattern = keywords.join('|');

    // Collect hits across all clients (one per corpus root).
    const allHits: SearchHit[] = [];
    for (const { client } of this.clients) {
      const raw = await callMCPTool<TextContent[]>(client, 'search_codebase', {
        pattern,
        max_results: topK * 10, // over-fetch for re-scoring
      });
      const text = raw[0]?.text ?? '[]';
      let hits: SearchHit[] = [];
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
          hits = parsed as SearchHit[];
        }
      } catch {
        // non-JSON response from server; skip
      }
      allHits.push(...hits);
    }

    // Score hits by number of keyword matches in the content line.
    // Group by (file, symbol) to deduplicate, keeping highest score.
    const scored = new Map<string, { score: number; raw: SearchHit }>();

    for (const hit of allHits) {
      const contentLower = hit.content.toLowerCase();
      const termHits = keywords.filter((k) =>
        contentLower.includes(k.replace(/\\/g, '')),
      ).length;

      const symbolName = extractSymbolName(hit.content);
      const fileBase = basename(hit.file);
      const id = `${fileBase}#${symbolName ?? fileBase}`;

      const existing = scored.get(id);
      if (!existing || termHits > existing.score) {
        scored.set(id, { score: termHits, raw: hit });
      }
    }

    // Sort by score descending, truncate to topK.
    const sorted = [...scored.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, topK);

    return sorted.map(([id, { score, raw }]) => ({
      id,
      score,
      kind: 'code' as const,
      raw,
    }));
  }

  async destroy(): Promise<void> {
    // Close all MCP clients.
    for (const { client, projectRoot } of this.clients) {
      await closeMCPClient(client);

      // Remove the cache file written into the project root.
      const cachePath = join(projectRoot, '.codebase-index-cache.pkl');
      try {
        rmSync(cachePath, { force: true });
      } catch {
        // best-effort
      }
    }
    this.clients = [];

    // Remove the benchmark data dir.
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/** Escape regex metacharacters in a string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a symbol name from a source line.
 * Returns the first identifier after `function`, `class`, `const`, `let`,
 * `var`, `def`, `async def`, `type`, `interface`, or `export`.
 * Falls back to null if nothing recognizable is found.
 */
function extractSymbolName(line: string): string | null {
  const patterns = [
    // TypeScript/JavaScript
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /(?:export\s+)?class\s+(\w+)/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)/,
    /(?:export\s+)?(?:type|interface)\s+(\w+)/,
    // Python
    /(?:async\s+)?def\s+(\w+)/,
    /^class\s+(\w+)/,
    // Go
    /^func\s+\w*\s*\(.*\)\s+(\w+)/,
    /^func\s+(\w+)/,
    // Rust
    /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
    /(?:pub\s+)?struct\s+(\w+)/,
  ];

  const trimmed = line.trim();
  for (const re of patterns) {
    const m = re.exec(trimmed);
    if (m?.[1]) {
      return m[1];
    }
  }
  return null;
}
