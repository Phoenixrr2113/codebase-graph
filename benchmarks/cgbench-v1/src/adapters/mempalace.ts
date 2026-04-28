import { mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
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
  /**
   * Stems of knowledge files ingested (e.g. "knowledge-001").
   * Used in resultId() to emit bare-stem IDs for knowledge results so they
   * match the gold IDs in task-d/task-e (which use bare stems, no extension).
   * Code result IDs keep the existing `<basename>#<basename>` convention.
   */
  private knowledgeStems: Set<string> = new Set();

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

    // Ingest knowledge corpus if provided.
    // Each .md file is mined individually using the same mine() call so that
    // mempalace indexes its content. The file stem is tracked in knowledgeStems
    // so resultId() can emit bare-stem IDs (matching task-d/task-e gold format).
    if (corpus.knowledgeRoot !== undefined) {
      const knowledgeFiles = readdirSync(corpus.knowledgeRoot)
        .filter((f) => f.endsWith('.md'))
        .sort();

      for (const fileName of knowledgeFiles) {
        const filePath = join(corpus.knowledgeRoot, fileName);
        const stem = basename(fileName, '.md');

        const script = `
import json, sys
sys.stdout.reconfigure(line_buffering=True)
from mempalace.miner import mine
import os, tempfile, shutil
from pathlib import Path

# Create a temp dir containing just this one file so mine() indexes it alone
tmp = tempfile.mkdtemp()
try:
    shutil.copy2(${JSON.stringify(filePath)}, os.path.join(tmp, ${JSON.stringify(fileName)}))
    mine(tmp, ${JSON.stringify(this.dataDir)}, respect_gitignore=False)
    print(json.dumps({"ok": True, "file": ${JSON.stringify(fileName)}}))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`.trim();

        await runPy<{ ok: boolean; file: string }>(this.python, script);
        this.knowledgeStems.add(stem);
        totalDocs++;
      }
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

    return (raw.results ?? []).map((hit) => {
      const id = this.resultId(hit);
      // Knowledge results get the 'knowledge' kind so task-d/e scores work correctly.
      // We detect knowledge results by checking if the ID is a bare stem (no '#').
      const kind = id.includes('#') ? ('code' as const) : ('knowledge' as const);
      return { id, score: hit.similarity, kind, raw: hit };
    });
  }

  private resultId(hit: MempalaceHit): string {
    // source_file is the basename of the file stored in mempalace metadata.
    const sourceFile = hit.source_file ?? 'unknown';
    // Knowledge files: strip extension and return bare stem to match gold IDs
    // in task-d/task-e (e.g. "knowledge-001"). Check against stems tracked during
    // ingest — if source_file is "knowledge-001.md" then stem is "knowledge-001".
    const dotIdx = sourceFile.lastIndexOf('.');
    const stem = dotIdx > 0 ? sourceFile.slice(0, dotIdx) : sourceFile;
    if (this.knowledgeStems.has(stem)) {
      return stem;
    }
    // Code files: use the filename as both parts so the ID is deterministic.
    return `${sourceFile}#${sourceFile}`;
  }

  async destroy(): Promise<void> {
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}
