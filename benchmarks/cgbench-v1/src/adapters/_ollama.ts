/**
 * LLM HTTP client for NL → Cypher generation.
 *
 * Uses an OpenAI-compat endpoint at /v1/chat/completions. Defaults to local
 * Ollama (gemma4:26b) but can be pointed at any OpenAI-compat provider
 * (e.g. OpenRouter) via LLM_ENDPOINT, LLM_MODEL, and LLM_API_KEY env vars.
 * Retries once on Cypher safety validation failure. Returns null cypher if
 * both attempts produce unsafe queries.
 */

import { isReadOnlyCypher } from './_cypher-safety';

export interface GenerateCypherOptions {
  question: string;
  taskHint: 'B' | 'C';
  model?: string;
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface GenerateCypherResult {
  cypher: string | null;
  attempts: number;
}

const DEFAULT_MODEL = process.env['LLM_MODEL'] ?? 'gemma4:26b';
const DEFAULT_ENDPOINT_BASE = process.env['LLM_ENDPOINT'] ?? 'http://localhost:11434/v1';
const DEFAULT_ENDPOINT = `${DEFAULT_ENDPOINT_BASE}/chat/completions`;
const DEFAULT_API_KEY = process.env['LLM_API_KEY'] ?? '';

const SYSTEM_PROMPT = `You are a Cypher query generator for the CodeGraph code knowledge graph.

Schema:
- Node labels: File, Function, Class, Interface, Variable, Type, Component, Entity
- Edge types:
  - CONTAINS (File contains symbol)
  - CALLS (Function calls Function)
  - IMPORTS (File imports File)
  - EXTENDS (Class extends Class)
  - IMPLEMENTS (Class implements Interface)
  - ABOUT (Entity about symbol)
  - RELATES_TO (Entity relates to Entity)
- Required fields on every symbol: name (string), filePath (string)

Generate ONE read-only Cypher query that answers the user's question.
Forbidden clauses: CREATE, MERGE, DELETE, SET, REMOVE, DROP.
Return ONLY the Cypher between \`\`\`cypher fences. No prose, no explanation.`;

/**
 * Extract Cypher from an LLM response. Tries fenced code blocks first
 * (```cypher then bare ```), falls back to trimming the whole response.
 */
export function extractCypher(response: string): string {
  // Try ```cypher ... ``` first
  const cypherFence = response.match(/```cypher\s*\n([\s\S]*?)\n```/);
  if (cypherFence?.[1]) return cypherFence[1].trim();

  // Try bare ``` ... ```
  const bareFence = response.match(/```\s*\n([\s\S]*?)\n```/);
  if (bareFence?.[1]) return bareFence[1].trim();

  // Fallback: trim and return
  return response.trim();
}

function buildUserPrompt(question: string, taskHint: 'B' | 'C'): string {
  const hint =
    taskHint === 'B'
      ? 'This question asks about a structural relationship. Use a single-hop pattern.'
      : 'This question asks about transitive impact. Use a *1..3 variable-length pattern.';
  return `${hint}\n\nQuestion: ${question}`;
}

async function callLLM(
  messages: Array<{ role: string; content: string }>,
  model: string,
  endpoint: string,
  apiKey: string,
  timeoutMs: number = 90_000,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.0,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<unable to read body>');
    throw new Error(
      `LLM request failed: ${res.status} ${res.statusText} — ${body}`,
    );
  }
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}

/**
 * Generate a read-only Cypher query for a natural-language question.
 *
 * Calls Ollama once, validates the result is read-only via isReadOnlyCypher,
 * and if it isn't, calls Ollama once more with feedback. Returns null cypher
 * after two failed attempts.
 */
export async function generateCypher(opts: GenerateCypherOptions): Promise<GenerateCypherResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const apiKey = opts.apiKey ?? DEFAULT_API_KEY;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const userPrompt = buildUserPrompt(opts.question, opts.taskHint);

  // Attempt 1
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
  const first = await callLLM(messages, model, endpoint, apiKey, timeoutMs);
  const firstCypher = extractCypher(first);
  if (isReadOnlyCypher(firstCypher)) {
    return { cypher: firstCypher, attempts: 1 };
  }

  // Attempt 2 with feedback
  messages.push({ role: 'assistant', content: first });
  messages.push({
    role: 'user',
    content: 'Your previous response contained a forbidden clause (CREATE, MERGE, DELETE, SET, REMOVE, DROP). Generate a read-only Cypher query (MATCH ... RETURN) only.',
  });
  const second = await callLLM(messages, model, endpoint, apiKey, timeoutMs);
  const secondCypher = extractCypher(second);
  if (isReadOnlyCypher(secondCypher)) {
    return { cypher: secondCypher, attempts: 2 };
  }

  return { cypher: null, attempts: 2 };
}
