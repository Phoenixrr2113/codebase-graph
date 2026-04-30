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
  - CALLS (Function-or-Class-or-Interface calls Function)
    NOTE: a CALLS edge can originate from a Class constructor, an Interface
    method, or a Variable initialiser — NOT just from a Function. If the
    question asks about classes/interfaces/types/constructors that call X,
    omit the caller label entirely (use \`(caller)\` not \`(caller:Function)\`).
  - IMPORTS (File imports File)
  - EXTENDS (Class extends Class)
  - IMPLEMENTS (Class implements Interface)
  - ABOUT (Entity about symbol)
  - RELATES_TO (Entity relates to Entity)
- Required fields on every symbol: name (string), filePath (string)

CRITICAL: filePath is stored as an ABSOLUTE path on disk
(e.g. "/Users/x/repo/packages/zod/src/v4/core/util.ts"), NOT a bare filename.
Never write \`{filePath: 'util.ts'}\` — that always returns 0 rows. When the
question references a file by short name, match with CONTAINS instead:
  WHERE node.filePath CONTAINS '/util.ts'   (anchor with leading slash)

LABEL DISCIPLINE — read the question carefully:
- "functions that call X" → \`(caller)-[:CALLS]->(...)\`
  (CodeGraph stores \`export const X = () => {...}\` as a :Variable node, not
  :Function — these are still "functions" in the user's mental model. Drop
  the source-label filter so the query catches both :Function and Variable-
  with-function-value callers.)
- "classes that call X" / "constructors that call X" → \`(caller)-[:CALLS]->(...)\`
  (omit the label so Class/Interface/Variable nodes are not filtered out)
- "classes that extend X" → \`(c:Class)-[:EXTENDS]->(...)\`
- "classes that implement X" → \`(c:Class)-[:IMPLEMENTS]->(...)\`
- "anything affected by X" / transitive impact → omit caller label, use
  variable-length \`-[:CALLS*1..3]->\`

Generate ONE read-only Cypher query that answers the user's question.
Forbidden clauses: CREATE, MERGE, DELETE, SET, REMOVE, DROP.

EVERY query MUST end with a RETURN clause. A bare MATCH without RETURN is not
a valid query — it returns nothing. Prefer returning the matched node directly
(e.g. RETURN caller) so callers can read both name and filePath. End with
LIMIT 50 unless the question implies otherwise.

Examples:
  // "functions that call send in sessions.py"
  // No source-label filter — catches both :Function declarations and
  // :Variable nodes initialised with arrow functions.
  MATCH (caller)-[:CALLS]->(target:Function {name: 'send'})
  WHERE target.filePath CONTAINS '/sessions.py'
  RETURN caller LIMIT 50

  // "constructors or types that call floatSafeRemainder from util.ts"
  MATCH (caller)-[:CALLS]->(target:Function {name: 'floatSafeRemainder'})
  WHERE target.filePath CONTAINS '/util.ts'
  RETURN caller LIMIT 50

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
  const firstCheck = checkCypher(firstCypher);
  if (firstCheck.ok) {
    return { cypher: firstCypher, attempts: 1 };
  }

  // Attempt 2 with feedback
  messages.push({ role: 'assistant', content: first });
  messages.push({
    role: 'user',
    content: `Your previous response was rejected: ${firstCheck.reason}. Generate a read-only Cypher query that ends with a RETURN clause. Use only MATCH, WHERE, WITH, RETURN, LIMIT, ORDER BY.`,
  });
  const second = await callLLM(messages, model, endpoint, apiKey, timeoutMs);
  const secondCypher = extractCypher(second);
  const secondCheck = checkCypher(secondCypher);
  if (secondCheck.ok) {
    return { cypher: secondCypher, attempts: 2 };
  }

  return { cypher: null, attempts: 2 };
}

/**
 * Validate a Cypher query against the safety rules AND minimum-completeness
 * rules (must contain a RETURN clause — Cypher without RETURN runs silently
 * and returns nothing, which is one of the most common LLM failure modes).
 */
function checkCypher(cypher: string): { ok: boolean; reason?: string } {
  if (!isReadOnlyCypher(cypher)) {
    return { ok: false, reason: 'contains a forbidden clause (CREATE, MERGE, DELETE, SET, REMOVE, DROP)' };
  }
  // Strip strings & comments before token-checking so "RETURN" inside a literal
  // doesn't satisfy the rule, and so a comment containing RETURN doesn't either.
  const stripped = cypher
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  if (!/\bRETURN\b/i.test(stripped)) {
    return { ok: false, reason: 'missing RETURN clause' };
  }
  return { ok: true };
}
