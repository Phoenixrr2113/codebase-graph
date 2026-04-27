/**
 * Vercel AI SDK middleware for CodeGraph.
 *
 * Wrap a base model with `withCodeGraph(model, { projectPath })` and the
 * agent gets automatic codebase context injected before the LLM call.
 *
 * Detects code-search-shaped questions via keyword heuristics ("where is",
 * "what does", "how does", identifier-shaped tokens). If the heuristic fires,
 * runs enrichedSearchV2 and prepends the top hits as a system message.
 *
 * Pattern: supermemory packages/tools/src/vercel/.
 */

import { LruCache } from './cache';

export interface SearchHit {
  name: string;
  filePath?: string | undefined;
  signature?: string | undefined;
  score: number;
  docstring?: string | undefined;
}

export type SearchFn = (
  query: string,
  opts: { limit: number; scope?: string },
) => Promise<SearchHit[]>;

export interface CodeGraphMiddlewareOpts {
  /** Project root to scope searches. */
  projectPath?: string;
  /** Maximum hits to inject. Default: 5. */
  maxHits?: number;
  /**
   * Test-only DI hook — override the search function.
   * Production code leaves this undefined to use enrichedSearchV2.
   */
  _searchFn?: SearchFn;
}

// Module-level LRU cache (shared across all withCodeGraph instances in the process)
const _cache = new LruCache<SearchHit[]>(200);

function cacheKey(projectPath: string | undefined, query: string, limit: number): string {
  return `${projectPath ?? ''}\x00${query}\x00${limit}`;
}

// Code-search query patterns — fire when the user message looks like a
// codebase question. Conservative: short messages or pure prose shouldn't
// trigger a search.
const CODE_QUERY_PATTERNS = [
  /\bwhere is\b/i,
  /\bwhat does\b.{1,60}\bdo\b/i,
  /\bhow does\b/i,
  /\bdefinition of\b/i,
  /\bdoes\b.{1,40}\bcall\b/i,
  /\bimplementation of\b/i,
  /\bfind\b.{1,30}\bfunction\b/i,
  /\bshow me\b.{1,40}\bcode\b/i,
];

function isCodeQuery(text: string): boolean {
  return CODE_QUERY_PATTERNS.some((p) => p.test(text));
}

function formatHits(hits: SearchHit[]): string {
  const lines = hits.map(
    (h) =>
      `- ${h.name} (${h.filePath ?? 'unknown'}): ${h.signature ?? ''}${h.docstring ? ' — ' + h.docstring.slice(0, 100) : ''}`,
  );
  return [
    '## CodeGraph search context',
    'The following symbols were found in the codebase relevant to the user question:',
    '',
    ...lines,
  ].join('\n');
}

function extractUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return '';
  // Find the last user message
  const userMessages = (prompt as Array<{ role?: string; content?: unknown }>)
    .filter((m) => m.role === 'user');
  const last = userMessages[userMessages.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return (last.content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ');
  }
  return '';
}

/**
 * Wraps a Vercel AI SDK model with CodeGraph context injection.
 *
 * Compatible with the Vercel AI SDK v3+ LanguageModel shape: intercepts
 * `doGenerate` / `doStream`, detects code-search queries, runs
 * enrichedSearchV2, and prepends top hits as a system message.
 *
 * @example
 * ```ts
 * import { openai } from '@ai-sdk/openai';
 * import { withCodeGraph } from '@codegraph/tools/vercel';
 *
 * const model = withCodeGraph(openai('gpt-4o'), { projectPath: '/your/project' });
 * ```
 */
export function withCodeGraph<M extends Record<string, unknown>>(
  model: M,
  opts: CodeGraphMiddlewareOpts,
): M {
  const maxHits = opts.maxHits ?? 5;

  const getSearch = (): SearchFn => {
    if (opts._searchFn) return opts._searchFn;
    return async (query, searchOpts) => {
      const { enrichedSearchV2, getGraphClient } = await import('@codegraph/core');
      const client = await getGraphClient();
      const result = await enrichedSearchV2(query, client, { limit: searchOpts.limit, ...(searchOpts.scope !== undefined ? { scope: searchOpts.scope } : {}) });
      // enrichedSearchV2 returns EnrichedV2Result — normalise to SearchHit[]
      const hits = (result as unknown as { hits?: unknown[] })?.hits ?? [];
      return hits.map((h) => {
        const hit = h as Record<string, unknown>;
        return {
          name: (hit['name'] as string) ?? '',
          filePath: hit['filePath'] as string | undefined,
          signature: hit['signature'] as string | undefined,
          score: (hit['score'] as number) ?? 0,
          docstring: hit['docstring'] as string | undefined,
        };
      });
    };
  };

  async function injectContext(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const text = extractUserText(params['prompt']);
    if (!text || !isCodeQuery(text)) return params;

    const key = cacheKey(opts.projectPath, text, maxHits);
    let hits = _cache.get(key);
    if (!hits) {
      try {
        const searchOpts: { limit: number; scope?: string } = { limit: maxHits };
        if (opts.projectPath !== undefined) searchOpts.scope = opts.projectPath;
        hits = await getSearch()(text, searchOpts);
        _cache.set(key, hits);
      } catch {
        hits = [];
      }
    }
    if (hits.length === 0) return params;

    const contextMsg = { role: 'system', content: formatHits(hits) };
    return { ...params, prompt: [contextMsg, ...((params['prompt'] as unknown[]) ?? [])] };
  }

  return new Proxy(model, {
    get(target, prop) {
      if (prop === 'doGenerate') {
        const original = target[prop];
        if (typeof original !== 'function') return original;
        return async (...args: unknown[]) => {
          const params = await injectContext((args[0] as Record<string, unknown>) ?? {});
          return (original as (...a: unknown[]) => unknown).apply(target, [params, ...args.slice(1)]);
        };
      }
      if (prop === 'doStream') {
        const original = target[prop];
        if (typeof original !== 'function') return original;
        return async (...args: unknown[]) => {
          const params = await injectContext((args[0] as Record<string, unknown>) ?? {});
          return (original as (...a: unknown[]) => unknown).apply(target, [params, ...args.slice(1)]);
        };
      }
      return (target as Record<string | symbol, unknown>)[prop];
    },
  });
}
