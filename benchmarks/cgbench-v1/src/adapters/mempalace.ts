import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

const execFileP = promisify(execFile);

export interface MempalaceAdapterOptions {
  dataDir: string;
  /** Python executable to use; defaults to 'python3'. */
  python?: string;
}

interface MempalaceHit {
  source_file: string;
  wing: string;
  room: string;
  text: string;
  similarity: number;
  matched_via: string;
}

interface MempalaceSearchResult {
  query: string;
  results: MempalaceHit[];
  error?: string;
}

/** Run a Python snippet and return the captured JSON output. */
async function runPy<T>(python: string, script: string): Promise<T> {
  const { stdout, stderr } = await execFileP(python, ['-c', script], {
    // Large output buffer: search results can be verbose
    maxBuffer: 10 * 1024 * 1024,
  });
  // mempalace prints progress to stdout alongside JSON. Strip non-JSON lines
  // by finding the last JSON object/array.
  const trimmed = stdout.trim();
  // Find the start of the JSON blob (last occurrence of '{' or '[' at line start)
  const jsonStart = trimmed.lastIndexOf('\n{');
  if (jsonStart !== -1) {
    return JSON.parse(trimmed.slice(jsonStart + 1)) as T;
  }
  // If no prefix noise, parse whole thing
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as T;
  }
  throw new Error(
    `mempalace Python script produced no JSON.\nstdout: ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(0, 500)}`,
  );
}

export class MempalaceAdapter implements BenchmarkAdapter {
  readonly name = 'mempalace';
  readonly mode = 'native' as const;

  private readonly dataDir: string;
  private readonly python: string;

  constructor(opts: MempalaceAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.python = opts.python ?? 'python3';
    mkdirSync(this.dataDir, { recursive: true });
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    let totalDocs = 0;

    for (const root of corpus.codeRoots) {
      // Mine each code root into the palace. mempalace.mine() prints progress
      // to stdout; we extract a JSON summary appended at the end.
      const script = `
import json, sys, os
sys.stdout.reconfigure(line_buffering=True)
from mempalace.miner import mine, scan_project
from pathlib import Path

project_dir = ${JSON.stringify(root.path)}
palace_path = ${JSON.stringify(this.dataDir)}

files_before = len(scan_project(project_dir, respect_gitignore=False))
mine(project_dir, palace_path, respect_gitignore=False)

# Scan again to count total processable files (mine may skip duplicates)
total_files = len(scan_project(project_dir, respect_gitignore=False))

# Emit JSON summary as last line
print(json.dumps({"filesTotal": total_files, "projectDir": project_dir}))
`.trim();

      const result = await runPy<{ filesTotal: number; projectDir: string }>(
        this.python,
        script,
      );
      totalDocs += result.filesTotal;
    }

    const durationMs = Date.now() - start;
    const diskBytesAfter = existsSync(this.dataDir)
      ? await measureDiskBytes(this.dataDir)
      : 0;
    const totalTokens = Math.floor(diskBytesAfter / 4);

    return { durationMs, totalDocs, totalTokens, diskBytesAfter };
  }

  async query(question: string, opts?: QueryOpts): Promise<RankedResult[]> {
    const topK = opts?.topK ?? 20;

    const script = `
import json, sys
from mempalace.searcher import search_memories

result = search_memories(
    query=${JSON.stringify(question)},
    palace_path=${JSON.stringify(this.dataDir)},
    n_results=${topK},
)
print(json.dumps(result))
`.trim();

    const raw = await runPy<MempalaceSearchResult>(this.python, script);

    if (raw.error !== undefined) {
      throw new Error(`mempalace search_memories error: ${raw.error}`);
    }

    return (raw.results ?? []).map((hit) => ({
      id: this.resultId(hit),
      score: hit.similarity,
      kind: 'code' as const,
      raw: hit,
    }));
  }

  private resultId(hit: MempalaceHit): string {
    // source_file is the basename of the file stored in mempalace metadata.
    const basename = hit.source_file ?? 'unknown';
    // mempalace stores file content verbatim; there is no symbol-level
    // granularity. Use the filename as both parts so the ID is deterministic.
    return `${basename}#${basename}`;
  }

  async destroy(): Promise<void> {
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}
