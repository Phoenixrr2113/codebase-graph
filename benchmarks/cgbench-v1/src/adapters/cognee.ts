import { mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

const execFileP = promisify(execFile);

export interface CogneeAdapterOptions {
  dataDir: string;
  /** Local Ollama OpenAI-compat URL. Default: http://localhost:11434/v1 */
  llmEndpoint?: string;
  /** Ollama model in `openai/<model>` form. Default: openai/qwen3.5:9b */
  llmModel?: string;
  /** Python executable. Defaults to '/opt/anaconda3/bin/python3'. */
  python?: string;
}

/** Shape of the JSON payload printed by the ingest Python script. */
interface CogneeIngestResult {
  totalDocs: number;
  error?: string;
}

/** Shape of a single hit in the query JSON payload. */
interface CogneeHit {
  /** Source file name (basename only, from DocumentChunk.is_part_of.name or raw_data_location). */
  source_file: string;
  /** Chunk text content. */
  text: string;
  /** Similarity / relevance score (0–1 or raw distance). */
  score: number;
}

/** Shape of the full JSON payload printed by the query Python script. */
interface CogneeQueryResult {
  results: CogneeHit[];
  error?: string;
}

/** Extract only the JSON blob (last line starting with '{' or '[') from mixed stdout. */
function extractJson(stdout: string): string {
  const trimmed = stdout.trim();
  const lastBrace = trimmed.lastIndexOf('\n{');
  const lastBracket = trimmed.lastIndexOf('\n[');
  const lastIdx = Math.max(lastBrace, lastBracket);
  if (lastIdx !== -1) {
    return trimmed.slice(lastIdx + 1);
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  throw new Error(`No JSON found in output:\n${stdout.slice(0, 500)}`);
}

/** Run a Python snippet and return the parsed JSON output. */
async function runPy<T>(
  python: string,
  script: string,
  env?: Record<string, string>,
  cwd?: string,
): Promise<T> {
  const { stdout, stderr } = await execFileP(python, ['-c', script], {
    maxBuffer: 20 * 1024 * 1024,
    // Run in the provided cwd (typically a temp dir with no .env file) so that
    // pydantic BaseSettings does not pick up the project's .env file, which may
    // contain incompatible provider settings (e.g. LLM_PROVIDER=cerebras).
    cwd: cwd ?? '/tmp',
    env: { ...process.env, ...env },
  });
  try {
    return JSON.parse(extractJson(stdout)) as T;
  } catch (err) {
    throw new Error(
      `cognee Python script produced no parseable JSON.\nstdout: ${stdout.slice(0, 1000)}\nstderr: ${stderr.slice(0, 500)}\nparse error: ${String(err)}`,
    );
  }
}

/** Supported code file extensions for cognee ingest. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);

export class CogneeAdapter implements BenchmarkAdapter {
  readonly name = 'cognee';
  readonly mode = 'native' as const;

  private readonly dataDir: string;
  private readonly llmEndpoint: string;
  private readonly llmModel: string;
  private readonly python: string;

  /**
   * Stems of knowledge files ingested (e.g. "knowledge-001").
   * Used in resultId() to emit bare-stem IDs for knowledge results so they
   * match the gold IDs in task-d/task-e (which use bare stems, no extension).
   */
  private knowledgeStems: Set<string> = new Set();

  /**
   * Basenames of code files ingested (e.g. "retry.ts").
   * Used to identify code results vs knowledge results in resultId().
   */
  private codeStems: Set<string> = new Set();

  constructor(opts: CogneeAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.python = opts.python ?? '/opt/anaconda3/bin/python3';
    this.llmEndpoint = opts.llmEndpoint ?? 'http://localhost:11434/v1';
    this.llmModel = opts.llmModel ?? 'openai/qwen3.5:9b';

    mkdirSync(this.dataDir, { recursive: true });
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    const allFilePaths: string[] = [];

    // Collect code files
    for (const root of corpus.codeRoots) {
      const files = this.walkFiles(root.path, CODE_EXTENSIONS);
      for (const f of files) {
        allFilePaths.push(f);
        this.codeStems.add(basename(f));
      }
    }

    // Collect knowledge corpus files (pattern: <word>-<digits>.md, skip README etc.)
    if (corpus.knowledgeRoot !== undefined) {
      const knowledgeFiles = readdirSync(corpus.knowledgeRoot)
        .filter((f) => /^[a-z]+-\d+\.md$/i.test(f))
        .sort();
      for (const fileName of knowledgeFiles) {
        const filePath = join(corpus.knowledgeRoot, fileName);
        allFilePaths.push(filePath);
        const stem = basename(fileName, '.md');
        this.knowledgeStems.add(stem);
      }
    }

    // Collect document corpus files
    if (corpus.documentRoot !== undefined) {
      const docDir = join(corpus.documentRoot, 'md');
      if (existsSync(docDir)) {
        const docFiles = readdirSync(docDir)
          .filter((f) => /^[a-z]+-\d+\.md$/i.test(f))
          .sort();
        for (const fileName of docFiles) {
          const filePath = join(docDir, fileName);
          allFilePaths.push(filePath);
          const stem = basename(fileName, '.md');
          this.knowledgeStems.add(stem);
        }
      }
    }

    // Liveness probe: confirm Ollama is up before launching the expensive cognify pipeline.
    await this.checkOllama();

    if (allFilePaths.length === 0) {
      return { durationMs: Date.now() - start, totalDocs: 0, totalTokens: 0, diskBytesAfter: 0 };
    }

    const dataRootDir = join(this.dataDir, 'cognee_data');
    const systemRootDir = join(this.dataDir, 'cognee_system');
    mkdirSync(dataRootDir, { recursive: true });
    mkdirSync(systemRootDir, { recursive: true });

    const filePathsJson = JSON.stringify(allFilePaths);

    // Pass directories as env vars so BaseSettings (lru_cached) picks them
    // up on first construction before any cognee code runs.
    const script = `
import asyncio, json, os, sys

# Patch starlette compat before importing cognee (starlette 0.46.x renamed
# HTTP_422_UNPROCESSABLE_ENTITY to HTTP_422_UNPROCESSABLE_CONTENT in 0.47+).
import starlette.status as _st
if not hasattr(_st, 'HTTP_422_UNPROCESSABLE_CONTENT'):
    _st.HTTP_422_UNPROCESSABLE_CONTENT = _st.HTTP_422_UNPROCESSABLE_ENTITY

# cognee's BaseSettings reads DATA_ROOT_DIRECTORY / SYSTEM_ROOT_DIRECTORY from env
# before any @lru_cache call, so we must set them BEFORE importing cognee modules.
import cognee

async def main():
    file_paths = ${filePathsJson}
    total = len(file_paths)

    # Add all files to cognee (will stage them for cognify)
    await cognee.add(file_paths, dataset_name="cgbench")

    # Build the knowledge graph — this makes LLM calls per chunk
    await cognee.cognify(datasets=["cgbench"])

    print(json.dumps({"totalDocs": total}))

asyncio.run(main())
`.trim();

    const env: Record<string, string> = {
      // LLM provider config via env vars (read by LLMConfig BaseSettings).
      // openai/xxx with LLM_ENDPOINT triggers litellm's OpenAI-compat path for Ollama.
      // Must be a model that supports function/tool calling — cognee uses structured output
      // (KnowledgeGraph tool) during cognify. qwen3.5:9b supports tools.
      LLM_PROVIDER: 'openai',
      LLM_MODEL: this.llmModel,
      LLM_ENDPOINT: this.llmEndpoint,
      LLM_API_KEY: 'ollama', // placeholder; Ollama does not validate the key
      // Embedding config: fastembed runs locally (no API key, no network call)
      // BAAI/bge-small-en-v1.5 is 384-dim, cached after first download
      EMBEDDING_PROVIDER: 'fastembed',
      EMBEDDING_MODEL: 'BAAI/bge-small-en-v1.5',
      EMBEDDING_DIMENSIONS: '384',
      // Isolate storage to our dataDir (read by BaseConfig BaseSettings)
      DATA_ROOT_DIRECTORY: dataRootDir,
      SYSTEM_ROOT_DIRECTORY: systemRootDir,
      // Skip the 30s pre-flight LLM connection test that runs at add() time
      COGNEE_SKIP_CONNECTION_TEST: 'true',
      // Disable multi-user access control so search results are returned as flat lists
      // (not wrapped in dataset-keyed dicts). Default is enabled in cognee 1.0+.
      ENABLE_BACKEND_ACCESS_CONTROL: 'false',
    };

    // Run in dataDir so pydantic BaseSettings finds no .env with conflicting vars
    const result = await runPy<CogneeIngestResult>(this.python, script, env, this.dataDir);

    if (result.error !== undefined) {
      throw new Error(`cognee ingest error: ${result.error}`);
    }

    const durationMs = Date.now() - start;
    const diskBytesAfter = existsSync(this.dataDir)
      ? await measureDiskBytes(this.dataDir)
      : 0;
    const totalTokens = Math.floor(diskBytesAfter / 4);

    return { durationMs, totalDocs: result.totalDocs, totalTokens, diskBytesAfter };
  }

  async query(question: string, opts?: QueryOpts): Promise<RankedResult[]> {
    const topK = opts?.topK ?? 20;
    const dataRootDir = join(this.dataDir, 'cognee_data');
    const systemRootDir = join(this.dataDir, 'cognee_system');

    const script = `
import asyncio, json, os

import starlette.status as _st
if not hasattr(_st, 'HTTP_422_UNPROCESSABLE_CONTENT'):
    _st.HTTP_422_UNPROCESSABLE_CONTENT = _st.HTTP_422_UNPROCESSABLE_ENTITY

import cognee
from cognee import SearchType

async def main():
    # ENABLE_BACKEND_ACCESS_CONTROL=false (set in env) disables multi-user mode so
    # cognee.search returns a flat list of chunk-payload dicts via search_result.result ->
    # result_object path (no dataset wrapper dicts).
    results = await cognee.search(
        ${JSON.stringify(question)},
        query_type=SearchType.CHUNKS,
        top_k=${topK},
    )

    hits = []
    for item in results:
        # In no-access-control mode (ENABLE_BACKEND_ACCESS_CONTROL=false), results is a
        # flat list of chunk payload dicts (keys: text, chunk_index, word_count, etc.).
        # In access-control mode, each item is a dict with a "search_result" key.
        # Normalise both shapes to a single chunk dict.
        if isinstance(item, dict) and "search_result" in item:
            chunk = item["search_result"]
        elif isinstance(item, dict):
            chunk = item
        else:
            # Pydantic SearchResult object (older cognee shape)
            sr = item.search_result
            chunk = {"text": getattr(sr, "text", "") or ""}
            if hasattr(sr, "is_part_of") and sr.is_part_of is not None:
                doc = sr.is_part_of
                raw_loc = getattr(doc, "raw_data_location", "") or ""
                doc_name = getattr(doc, "name", "") or ""
                chunk["raw_data_location"] = raw_loc or doc_name

        if not isinstance(chunk, dict):
            continue

        text = str(chunk.get("text", "") or "")
        # Chunk payload dicts may contain raw_data_location directly, or it may live in
        # a nested "is_part_of" sub-object.  Fall back gracefully.
        raw_loc = chunk.get("raw_data_location", "") or ""
        if isinstance(raw_loc, dict):
            raw_loc = raw_loc.get("raw_data_location", "") or ""
        source_file = os.path.basename(str(raw_loc)) if raw_loc else ""

        chunk_index = int(chunk.get("chunk_index", 0) or 0)
        score = max(0.0, 1.0 - (chunk_index * 0.01))
        hits.append({"source_file": source_file, "text": text[:200], "score": score})

    print(json.dumps({"results": hits}))

asyncio.run(main())
`.trim();

    const env: Record<string, string> = {
      LLM_PROVIDER: 'openai',
      LLM_MODEL: this.llmModel,
      LLM_ENDPOINT: this.llmEndpoint,
      LLM_API_KEY: 'ollama', // placeholder; Ollama does not validate the key
      EMBEDDING_PROVIDER: 'fastembed',
      EMBEDDING_MODEL: 'BAAI/bge-small-en-v1.5',
      EMBEDDING_DIMENSIONS: '384',
      DATA_ROOT_DIRECTORY: dataRootDir,
      SYSTEM_ROOT_DIRECTORY: systemRootDir,
      COGNEE_SKIP_CONNECTION_TEST: 'true',
      // Disable multi-user access control so search results are returned as flat lists
      // (not wrapped in dataset-keyed dicts). Default is enabled in cognee 1.0+.
      ENABLE_BACKEND_ACCESS_CONTROL: 'false',
    };

    // Run in dataDir so pydantic BaseSettings finds no .env with conflicting vars
    const raw = await runPy<CogneeQueryResult>(this.python, script, env, this.dataDir);

    if (raw.error !== undefined) {
      throw new Error(`cognee search error: ${raw.error}`);
    }

    return (raw.results ?? []).map((hit) => {
      const id = this.resultId(hit);
      const kind = id.includes('#') ? ('code' as const) : ('knowledge' as const);
      return { id, score: hit.score, kind, raw: hit };
    });
  }

  private resultId(hit: CogneeHit): string {
    const sourceFile = hit.source_file ?? 'unknown';
    const dotIdx = sourceFile.lastIndexOf('.');
    const stem = dotIdx > 0 ? sourceFile.slice(0, dotIdx) : sourceFile;

    // Knowledge/document files: bare stem matches gold IDs (e.g. "knowledge-001")
    if (this.knowledgeStems.has(stem)) {
      return stem;
    }

    // Code files: <basename>#<basename> convention
    return `${sourceFile}#${sourceFile}`;
  }

  /**
   * Probe Ollama before launching the cognify pipeline.
   * Checks the native /api/tags endpoint (not the /v1 OpenAI-compat surface)
   * and verifies the configured model is pulled.
   */
  private async checkOllama(): Promise<void> {
    try {
      // Derive the native-API URL from the OpenAI-compat endpoint.
      // These are separate API surfaces — keep them as distinct values.
      const tagsUrl = this.llmEndpoint.replace(/\/v1\/?$/, '/api/tags');
      const res = await fetch(tagsUrl);
      if (!res.ok) throw new Error(`Ollama tags endpoint returned ${res.status}`);
      const data = await res.json() as { models?: { name: string }[] };
      const modelName = this.llmModel.replace(/^openai\//, '');
      const installed = (data.models ?? []).some(
        (m) => m.name === modelName || m.name.startsWith(modelName + ':'),
      );
      if (!installed) {
        throw new Error(
          `Ollama model not pulled: ${modelName}. Run \`ollama pull ${modelName}\` first.`,
        );
      }
    } catch (err) {
      throw new Error(
        `Ollama not reachable at ${this.llmEndpoint}. Start with \`ollama serve\` and pull the model. ` +
          `Original: ${(err as Error).message}`,
      );
    }
  }

  async destroy(): Promise<void> {
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  /** Walk a directory recursively and return files with matching extensions. */
  private walkFiles(dir: string, extensions: Set<string>): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden dirs (node_modules, .git, __pycache__, etc.)
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__pycache__') {
          results.push(...this.walkFiles(fullPath, extensions));
        }
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        const ext = dotIdx > 0 ? entry.name.slice(dotIdx) : '';
        if (extensions.has(ext)) {
          results.push(fullPath);
        }
      }
    }
    return results;
  }
}
