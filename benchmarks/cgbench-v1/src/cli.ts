import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AugmentAdapter } from './adapters/augment.js';
import { CodeGraphAdapter, type DocumentFormat } from './adapters/codegraph.js';
import { CogneeAdapter } from './adapters/cognee.js';
import { HindsightAdapter } from './adapters/hindsight.js';
import { MastraAdapter } from './adapters/mastra.js';
import { McpCodebaseIndexAdapter } from './adapters/mcp-codebase-index.js';
import { MempalaceAdapter } from './adapters/mempalace.js';
import { SupermemoryAdapter } from './adapters/supermemory.js';
import { runSystem } from './runner.js';
import { aggregate } from './aggregator.js';
import { renderBenchmarksMarkdown } from './report.js';
import type { BenchmarkAdapter } from './adapter.js';
import { LanguageSchema, type BenchmarkCorpus, type Language } from './types.js';

const DOCUMENT_FORMATS = ['md', 'pdf', 'docx', 'html', 'csv'] as const;
function isDocumentFormat(v: string): v is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(v);
}

interface ParsedRunArgs {
  command: 'run';
  system: string;
  corpus: string;
  documentCorpus?: string | undefined;
  documentFormat: DocumentFormat;
  questions: string;
  resultsDir: string;
  language: Language;
}

interface ParsedRunAllArgs {
  command: 'run-all';
  systems: string[];
  codeCorpus: string;
  knowledgeCorpus?: string | undefined;
  documentCorpus?: string | undefined;
  questionsDir: string;
  resultsDir: string;
  language: Language;
  documentFormat: DocumentFormat;
}

type ParsedArgs = ParsedRunArgs | ParsedRunAllArgs;

function parseFlags(argv: string[], startIdx: number): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = startIdx; i < argv.length; i += 2) {
    const k = argv[i]!.replace(/^--/, '');
    const v = argv[i + 1]!;
    flags[k] = v;
  }
  return flags;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[2];

  if (command === 'run-all') {
    const flags = parseFlags(argv, 3);
    if (!flags['code-corpus']) throw new Error('--code-corpus required');
    if (!flags['questions-dir']) throw new Error('--questions-dir required');
    if (!flags['systems']) throw new Error('--systems required');
    if (!existsSync(flags['code-corpus']!)) {
      throw new Error(`--code-corpus path does not exist: ${flags['code-corpus']}`);
    }
    if (!existsSync(flags['questions-dir']!)) {
      throw new Error(`--questions-dir path does not exist: ${flags['questions-dir']}`);
    }
    if (flags['knowledge-corpus'] && !existsSync(flags['knowledge-corpus'])) {
      throw new Error(`--knowledge-corpus path does not exist: ${flags['knowledge-corpus']}`);
    }
    if (flags['document-corpus'] && !existsSync(flags['document-corpus'])) {
      throw new Error(`--document-corpus path does not exist: ${flags['document-corpus']}`);
    }
    const rawFormat = flags['format'] ?? 'md';
    if (!isDocumentFormat(rawFormat)) {
      throw new Error(`--format must be one of: ${DOCUMENT_FORMATS.join(', ')} (got: ${rawFormat})`);
    }
    const systems = flags['systems']!.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (systems.length === 0) throw new Error('--systems must list at least one system');
    const language = LanguageSchema.parse(flags['language'] ?? 'typescript');
    return {
      command: 'run-all',
      systems,
      codeCorpus: flags['code-corpus']!,
      ...(flags['knowledge-corpus'] !== undefined ? { knowledgeCorpus: flags['knowledge-corpus'] } : {}),
      ...(flags['document-corpus'] !== undefined ? { documentCorpus: flags['document-corpus'] } : {}),
      questionsDir: flags['questions-dir']!,
      resultsDir: flags['results-dir'] ?? join(process.cwd(), 'results'),
      language,
      documentFormat: rawFormat,
    };
  }

  if (command !== 'run') {
    throw new Error(`unknown command: ${command} (expected: run or run-all)`);
  }

  const flags = parseFlags(argv, 3);
  if (!flags['system']) throw new Error('--system required');
  if (!flags['corpus']) throw new Error('--corpus required');
  if (!flags['questions']) throw new Error('--questions required');
  if (!existsSync(flags['corpus']!)) {
    throw new Error(`--corpus path does not exist: ${flags['corpus']}`);
  }
  if (!existsSync(flags['questions']!)) {
    throw new Error(`--questions path does not exist: ${flags['questions']}`);
  }
  if (flags['document-corpus'] && !existsSync(flags['document-corpus'])) {
    throw new Error(`--document-corpus path does not exist: ${flags['document-corpus']}`);
  }
  const rawFormat = flags['format'] ?? 'md';
  if (!isDocumentFormat(rawFormat)) {
    throw new Error(`--format must be one of: ${DOCUMENT_FORMATS.join(', ')} (got: ${rawFormat})`);
  }
  const language = LanguageSchema.parse(flags['language'] ?? 'typescript');
  return {
    command: 'run',
    system: flags['system']!,
    corpus: flags['corpus']!,
    ...(flags['document-corpus'] !== undefined ? { documentCorpus: flags['document-corpus'] } : {}),
    documentFormat: rawFormat,
    questions: flags['questions']!,
    resultsDir: flags['results-dir'] ?? join(process.cwd(), 'results'),
    language,
  };
}

export function makeAdapter(
  name: string,
  dataDir: string,
  opts?: { documentFormat?: DocumentFormat | undefined },
): BenchmarkAdapter {
  switch (name) {
    case 'codegraph':
      return new CodeGraphAdapter({
        dataDir,
        ...(opts?.documentFormat !== undefined ? { documentFormat: opts.documentFormat } : {}),
      });
    case 'mcp-codebase-index':
      return new McpCodebaseIndexAdapter({ dataDir });
    case 'mempalace':
      return new MempalaceAdapter({ dataDir });
    case 'cognee':
      return new CogneeAdapter({ dataDir });
    case 'hindsight':
      return new HindsightAdapter({ dataDir, baseUrl: process.env['HINDSIGHT_URL'] });
    case 'mastra-memory':
      return new MastraAdapter({ dataDir });
    case 'supermemory':
      return new SupermemoryAdapter({ dataDir, apiKey: process.env['SUPERMEMORY_API_KEY'] });
    case 'augment':
      return new AugmentAdapter({ dataDir });
    default:
      throw new Error(
        `unknown system: ${name} (supported: codegraph, mcp-codebase-index, mempalace, cognee, hindsight, mastra-memory, supermemory, augment)`,
      );
  }
}

async function runSingle(args: ParsedRunArgs): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(args.resultsDir, ts);
  const perSystemDir = join(runDir, 'per-system');
  const dataDir = join(runDir, 'data', args.system);
  mkdirSync(perSystemDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const adapter = makeAdapter(args.system, dataDir, { documentFormat: args.documentFormat });
  const corpus: BenchmarkCorpus = {
    codeRoots: [{ language: args.language, path: args.corpus, commitSha: 'cli-run' }],
    ...(args.documentCorpus !== undefined ? { documentRoot: args.documentCorpus } : {}),
  };

  try {
    const result = await runSystem({
      adapter,
      corpus,
      questionsPath: args.questions,
      resultsDir: runDir,
      coldQueriesCount: 5,
    });
    writeFileSync(
      join(perSystemDir, `${args.system}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(`[done] wrote ${join(perSystemDir, `${args.system}.json`)}`);
  } finally {
    // Don't let destroy errors mask the original error if main body threw.
    try { await adapter.destroy(); } catch (destroyErr) {
      console.error('destroy() failed:', destroyErr);
    }
  }
}

async function runAll(args: ParsedRunAllArgs): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(args.resultsDir, ts);
  const perSystemDir = join(runDir, 'per-system');
  mkdirSync(perSystemDir, { recursive: true });

  // Collect all task-*.jsonl files from questions dir, sort them.
  const taskFiles = readdirSync(args.questionsDir)
    .filter((f) => /^task-[a-f]\.jsonl$/.test(f))
    .sort()
    .map((f) => join(args.questionsDir, f));

  // When no task-*.jsonl files found, fall back to any .jsonl in that dir.
  const questionFiles = taskFiles.length > 0
    ? taskFiles
    : readdirSync(args.questionsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
        .map((f) => join(args.questionsDir, f));

  if (questionFiles.length === 0) {
    throw new Error(`No .jsonl question files found in --questions-dir: ${args.questionsDir}`);
  }

  // Concatenate all question files into a single temp file.
  // The runner's per-task grouping handles all task letters in one pass.
  const allLines: string[] = [];
  for (const qf of questionFiles) {
    const lines = readFileSync(qf, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    allLines.push(...lines);
  }
  const tempQuestionsPath = join('/tmp', `cgbench-runall-q-${Date.now()}.jsonl`);
  writeFileSync(tempQuestionsPath, allLines.join('\n') + '\n');

  const corpus: BenchmarkCorpus = {
    codeRoots: [{ language: args.language, path: args.codeCorpus, commitSha: 'cli-run-all' }],
    ...(args.knowledgeCorpus !== undefined ? { knowledgeRoot: args.knowledgeCorpus } : {}),
    ...(args.documentCorpus !== undefined ? { documentRoot: args.documentCorpus } : {}),
  };

  const perSystemPaths: { system: string; path: string }[] = [];

  for (const system of args.systems) {
    console.log(`[run-all] running system: ${system}`);
    const dataDir = mkdtempSync(`/tmp/cgbench-runall-${system}-`);
    const adapter = makeAdapter(system, dataDir, { documentFormat: args.documentFormat });

    try {
      const result = await runSystem({
        adapter,
        corpus,
        questionsPath: tempQuestionsPath,
        resultsDir: runDir,
        coldQueriesCount: 5,
      });
      const outPath = join(perSystemDir, `${system}.json`);
      writeFileSync(outPath, JSON.stringify(result, null, 2));
      perSystemPaths.push({ system, path: outPath });
      console.log(`[run-all] wrote ${outPath}`);
    } finally {
      try { await adapter.destroy(); } catch (destroyErr) {
        console.error(`destroy() failed for ${system}:`, destroyErr);
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }

  // Clean up the temp questions file.
  rmSync(tempQuestionsPath, { force: true });

  const summary = aggregate({
    perSystemFiles: perSystemPaths,
    caveats: [
      'CodeGraph runs with local Hugging Face embeddings (no API keys required)',
      'Cognee, Mastra, Augment ship as DEFERRED stubs in Plan 4 — see COMPETITORS.md',
    ],
    timestamp: new Date().toISOString(),
  });

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  const benchmarksMd = renderBenchmarksMarkdown(summary);
  writeFileSync(join(runDir, 'BENCHMARKS.md'), benchmarksMd);

  console.log(`[done] BENCHMARKS.md written to ${join(runDir, 'BENCHMARKS.md')}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.command === 'run-all') {
    await runAll(args);
  } else {
    await runSingle(args);
  }
}

// Only run when this file is the entry point, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
