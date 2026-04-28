import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeGraphAdapter } from './adapters/codegraph.js';
import { CogneeAdapter } from './adapters/cognee.js';
import { HindsightAdapter } from './adapters/hindsight.js';
import { MastraAdapter } from './adapters/mastra.js';
import { SupermemoryAdapter } from './adapters/supermemory.js';
import { runSystem } from './runner.js';
import type { BenchmarkAdapter } from './adapter.js';
import { LanguageSchema, type BenchmarkCorpus, type Language } from './types.js';

interface ParsedArgs {
  command: 'run';
  system: string;
  corpus: string;
  questions: string;
  resultsDir: string;
  language: Language;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[2];
  if (command !== 'run') {
    throw new Error(`unknown command: ${command} (expected: run)`);
  }
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i += 2) {
    const k = argv[i]!.replace(/^--/, '');
    const v = argv[i + 1]!;
    flags[k] = v;
  }
  if (!flags['system']) throw new Error('--system required');
  if (!flags['corpus']) throw new Error('--corpus required');
  if (!flags['questions']) throw new Error('--questions required');
  if (!existsSync(flags['corpus'])) {
    throw new Error(`--corpus path does not exist: ${flags['corpus']}`);
  }
  if (!existsSync(flags['questions'])) {
    throw new Error(`--questions path does not exist: ${flags['questions']}`);
  }
  const language = LanguageSchema.parse(flags['language'] ?? 'typescript');
  return {
    command: 'run',
    system: flags['system']!,
    corpus: flags['corpus']!,
    questions: flags['questions']!,
    resultsDir: flags['results-dir'] ?? join(process.cwd(), 'results'),
    language,
  };
}

function makeAdapter(name: string, dataDir: string): BenchmarkAdapter {
  switch (name) {
    case 'codegraph':
      return new CodeGraphAdapter({ dataDir });
    case 'cognee':
      return new CogneeAdapter({ dataDir });
    case 'hindsight':
      return new HindsightAdapter({ dataDir });
    case 'mastra':
      return new MastraAdapter({ dataDir });
    case 'supermemory':
      return new SupermemoryAdapter({ dataDir, apiKey: process.env['SUPERMEMORY_API_KEY'] });
    default:
      throw new Error(
        `unknown system: ${name} (supported: codegraph, cognee, hindsight, mastra, supermemory)`,
      );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(args.resultsDir, ts);
  const perSystemDir = join(runDir, 'per-system');
  const dataDir = join(runDir, 'data', args.system);
  mkdirSync(perSystemDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const adapter = makeAdapter(args.system, dataDir);
  const corpus: BenchmarkCorpus = {
    codeRoots: [{ language: args.language, path: args.corpus, commitSha: 'cli-run' }],
  };

  try {
    const result = await runSystem({
      adapter,
      corpus,
      questionsPath: args.questions,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
