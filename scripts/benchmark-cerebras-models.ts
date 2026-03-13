#!/usr/bin/env npx tsx
/**
 * Cerebras Model Benchmark
 *
 * Tests available Cerebras models for latency and quality across our use cases.
 * Runs multiple rounds to get stable latency numbers.
 *
 * Usage: pnpm build && npx tsx scripts/benchmark-cerebras-models.ts
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

if (!process.env['CEREBRAS_API_KEY']) {
  console.error('ERROR: CEREBRAS_API_KEY not set in .env');
  process.exit(1);
}

// Dynamic imports (pnpm workspace resolution)
const ai = await import('../packages/plugin-nlp/node_modules/ai/dist/index.js');
const { generateText, Output } = ai;
const { createOpenAICompatible } = await import(
  '../packages/plugin-nlp/node_modules/@ai-sdk/openai-compatible/dist/index.js'
);
const { SearchRouteSchema } = await import('../packages/plugin-nlp/dist/index.js');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cerebras = createOpenAICompatible({
  name: 'cerebras',
  baseURL: 'https://api.cerebras.ai/v1',
  headers: { Authorization: `Bearer ${process.env['CEREBRAS_API_KEY']}` },
  supportsStructuredOutputs: true,
});

const MODELS = ['llama3.1-8b', 'gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507', 'zai-glm-4.7'];
const ROUNDS = 3; // run each test N times for stable numbers

// ---------------------------------------------------------------------------
// Test prompts — varying difficulty
// ---------------------------------------------------------------------------

const TESTS = [
  {
    name: 'routing-easy',
    prompt: `You are a search router for a code knowledge graph. Classify the user's query and choose the best search strategy.

## Available Strategies:
- HYBRID: Simple lookups by name, keyword, or concept
- GRAPH_ANSWER: Questions that need an explanation or synthesis
- NL_TO_CYPHER: Structural queries about relationships
- CONTEXT_WALK: Complex multi-hop exploration

## User Query:
"sendEmail"

Choose the best strategy.`,
    schema: true,
    expected: 'HYBRID',
  },
  {
    name: 'routing-medium',
    prompt: `You are a search router for a code knowledge graph. Classify the user's query and choose the best search strategy.

## Available Strategies:
- HYBRID: Simple lookups by name, keyword, or concept
- GRAPH_ANSWER: Questions that need an explanation or synthesis
- NL_TO_CYPHER: Structural queries about relationships
- CONTEXT_WALK: Complex multi-hop exploration

## User Query:
"What does the hybridSearch function do?"

Choose the best strategy.`,
    schema: true,
    expected: 'GRAPH_ANSWER',
  },
  {
    name: 'routing-hard',
    prompt: `You are a search router for a code knowledge graph. Classify the user's query and choose the best search strategy.

## Available Strategies:
- HYBRID: Simple lookups by name, keyword, or concept
- GRAPH_ANSWER: Questions that need an explanation or synthesis
- NL_TO_CYPHER: Structural queries about relationships
- CONTEXT_WALK: Complex multi-hop exploration

## User Query:
"How does data flow from the API route handler through the search registry to the graph database?"

Choose the best strategy.`,
    schema: true,
    expected: 'CONTEXT_WALK',
  },
  {
    name: 'cypher',
    prompt: `You are a Cypher query generator for a code knowledge graph.
The graph has these node types: File, Function, Class, Interface, Variable, Type, Component
And these edge types: CALLS, CONTAINS, IMPORTS, EXTENDS, IMPLEMENTS, RENDERS, USES_HOOK

Generate a Cypher query for this natural language request:
"Find all classes that extend BaseSearchStrategy and list the functions they contain"

Return ONLY the Cypher query, no explanation.`,
    schema: false,
    expected: null,
  },
  {
    name: 'answer',
    prompt: `Based on the following code context, answer the question.

## Code Context:
- hybridSearch is a function in packages/core/src/hybridSearch.ts
- It combines vector similarity search, text matching, and graph traversal
- It takes a query string, search options, and a graph client
- It returns ranked results with scores from multiple search sources
- It calls generateEmbedding for vector search and uses Cypher for text/graph
- The vector similarity uses cosine distance on 768-dim embeddings
- Text matching uses FalkorDB full-text index
- Graph traversal follows CALLS/IMPORTS edges up to 3 hops
- Results are merged using reciprocal rank fusion (RRF)

## Question: Explain how hybridSearch combines results from different sources and what tradeoffs this approach has.

Provide a detailed but concise answer (3-4 sentences).`,
    schema: false,
    expected: null,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface Result {
  model: string;
  test: string;
  round: number;
  latencyMs: number;
  output: string;
  correct?: boolean;
  error?: string;
}

const results: Result[] = [];

async function runTest(
  modelId: string,
  test: (typeof TESTS)[0],
  round: number,
): Promise<void> {
  const model = cerebras.chatModel(modelId);
  const start = Date.now();
  try {
    if (test.schema) {
      const result = await generateText({
        model,
        output: Output.object({ schema: SearchRouteSchema }),
        prompt: test.prompt,
        temperature: 0,
        maxOutputTokens: 200,
      });
      const latency = Date.now() - start;
      const output = result.output as { strategy?: string; reasoning?: string } | null;
      const correct = test.expected ? output?.strategy === test.expected : undefined;
      results.push({
        model: modelId,
        test: test.name,
        round,
        latencyMs: latency,
        output: JSON.stringify(output),
        correct,
      });
      if (round === 1) {
        const mark = correct === true ? '✓' : correct === false ? '✗' : '?';
        console.log(
          `  ${mark} ${test.name}: ${latency}ms | strategy=${output?.strategy} (expected ${test.expected})`,
        );
      }
    } else {
      const result = await generateText({
        model,
        prompt: test.prompt,
        temperature: 0,
        maxOutputTokens: 500,
      });
      const latency = Date.now() - start;
      const text = result.text
        .split('\n')
        .filter((l: string) => l.trim())
        .slice(0, 4)
        .join(' | ');
      results.push({
        model: modelId,
        test: test.name,
        round,
        latencyMs: latency,
        output: text.slice(0, 400),
      });
      if (round === 1) {
        console.log(`  ✓ ${test.name}: ${latency}ms → ${text.slice(0, 120)}`);
      }
    }
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message.slice(0, 150) : String(err);
    results.push({ model: modelId, test: test.name, round, latencyMs: latency, output: '', error: msg });
    if (round === 1) {
      console.log(`  ✗ ${test.name}: ${latency}ms → ERROR: ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log(`║  Cerebras Model Benchmark — ${ROUNDS} rounds per test          ║`);
console.log('╚══════════════════════════════════════════════════════════╝\n');

for (const modelId of MODELS) {
  console.log(`\n━━ ${modelId} ━━`);
  for (let round = 1; round <= ROUNDS; round++) {
    if (round > 1) process.stdout.write(`  round ${round}...`);
    for (const test of TESTS) {
      await runTest(modelId, test, round);
      await new Promise((r) => setTimeout(r, 300));
    }
    if (round > 1) console.log(' done');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║                         RESULTS SUMMARY                             ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

// Latency comparison (median across rounds)
console.log('\n─── LATENCY (median of 3 rounds) ───\n');

// Short labels for header
const labels: Record<string, string> = {
  'llama3.1-8b': 'llama-8b',
  'gpt-oss-120b': 'gpt-120b',
  'qwen-3-235b-a22b-instruct-2507': 'qwen-235b',
  'zai-glm-4.7': 'glm-4.7',
};

const colW = 12;
const header = 'Test'.padEnd(18) + MODELS.map((m) => labels[m].padStart(colW)).join('');
console.log(header);
console.log('─'.repeat(18 + MODELS.length * colW));

for (const test of TESTS) {
  const getMedian = (modelId: string) => {
    const latencies = results
      .filter((r) => r.model === modelId && r.test === test.name && !r.error)
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    if (latencies.length === 0) return null;
    return latencies[Math.floor(latencies.length / 2)];
  };

  let line = test.name.padEnd(18);
  for (const modelId of MODELS) {
    const med = getMedian(modelId);
    line += (med !== null ? med + 'ms' : 'ERROR').padStart(colW);
  }
  console.log(line);
}

// Overall averages
let avgLine = 'AVERAGE'.padEnd(18);
for (const modelId of MODELS) {
  const all = results.filter((r) => r.model === modelId && !r.error);
  const avg = all.length > 0 ? Math.round(all.reduce((s, r) => s + r.latencyMs, 0) / all.length) : 0;
  avgLine += (avg > 0 ? avg + 'ms' : 'N/A').padStart(colW);
}
console.log('─'.repeat(18 + MODELS.length * colW));
console.log(avgLine);

// Quality — routing accuracy
console.log('\n─── ROUTING ACCURACY (across all rounds) ───\n');
for (const modelId of MODELS) {
  const routingResults = results.filter(
    (r) => r.model === modelId && r.test.startsWith('routing') && r.correct !== undefined,
  );
  const correct = routingResults.filter((r) => r.correct).length;
  const total = routingResults.length;
  console.log(`${modelId.padEnd(20)} ${correct}/${total} correct (${total > 0 ? Math.round((correct / total) * 100) : 0}%)`);

  // Show failures
  for (const r of routingResults.filter((r) => !r.correct)) {
    try {
      const parsed = JSON.parse(r.output);
      const test = TESTS.find((t) => t.name === r.test);
      console.log(`  ✗ ${r.test} round ${r.round}: got ${parsed?.strategy}, expected ${test?.expected}`);
    } catch {
      // skip
    }
  }
}

// Quality — output samples (round 1 only)
console.log('\n─── CYPHER OUTPUT COMPARISON ───\n');
for (const modelId of MODELS) {
  const r = results.find((r) => r.model === modelId && r.test === 'cypher' && r.round === 1);
  if (r && !r.error) {
    console.log(`${modelId}:`);
    console.log(`  ${r.output.slice(0, 200)}\n`);
  }
}

console.log('─── ANSWER OUTPUT COMPARISON ───\n');
for (const modelId of MODELS) {
  const r = results.find((r) => r.model === modelId && r.test === 'answer' && r.round === 1);
  if (r && !r.error) {
    console.log(`${modelId}:`);
    // Wrap at ~100 chars
    const words = r.output.split(' ');
    let line = '  ';
    for (const w of words) {
      if (line.length + w.length > 100) {
        console.log(line);
        line = '  ' + w;
      } else {
        line += (line.length > 2 ? ' ' : '') + w;
      }
    }
    if (line.trim()) console.log(line);
    console.log('');
  }
}

// Cost estimate
console.log('─── COST ESTIMATE (per 1000 SMART_SEARCH queries) ───\n');
const avgInputTokens = 200; // routing prompt
const avgOutputTokens = 50;
const costs: Record<string, [number, number]> = {
  'llama3.1-8b': [0.10, 0.10],
  'gpt-oss-120b': [0.35, 0.75],
  'qwen-3-235b-a22b-instruct-2507': [0.60, 1.20],
  'zai-glm-4.7': [2.25, 2.75],
};
for (const modelId of MODELS) {
  const [inCost, outCost] = costs[modelId] || [0, 0];
  const totalCost = ((avgInputTokens * inCost + avgOutputTokens * outCost) / 1_000_000) * 1000;
  console.log(
    `${(labels[modelId] || modelId).padEnd(14)} $${totalCost.toFixed(4)} per 1K queries ($${inCost}/$${outCost} per M tokens)`,
  );
}

console.log('\n✅ Benchmark complete.\n');
