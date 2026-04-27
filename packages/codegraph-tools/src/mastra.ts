/**
 * Mastra processor for CodeGraph context injection.
 *
 * Use:
 *   import { createCodeGraphProcessor } from '@codegraph/tools/mastra';
 *   const processor = createCodeGraphProcessor({ projectPath: '/your/project' });
 *   // Plug into a Mastra agent's input processors.
 *
 * Pattern: supermemory packages/tools/src/mastra/.
 */

import { LruCache } from './cache';
import type { SearchFn, SearchHit } from './vercel';

export type { SearchFn, SearchHit };

export interface MastraProcessorOpts {
  projectPath?: string;
  maxHits?: number;
  /** Test-only DI hook — override the search function. */
  _searchFn?: SearchFn;
}

export interface MastraMessage {
  role: string;
  content: string;
}

export interface MastraProcessorInput {
  messages: MastraMessage[];
  [key: string]: unknown;
}

const _cache = new LruCache<SearchHit[]>(200);

function cacheKey(projectPath: string | undefined, query: string, limit: number): string {
  return `${projectPath ?? ''}\x00${query}\x00${limit}`;
}

/**
 * Returns a Mastra-compatible input processor that injects CodeGraph search
 * results as a system message before the agent's LLM call.
 *
 * @example
 * ```ts
 * import { Agent } from '@mastra/core';
 * import { createCodeGraphProcessor } from '@codegraph/tools/mastra';
 *
 * const agent = new Agent({
 *   inputProcessors: [createCodeGraphProcessor({ projectPath: '/your/project' })],
 * });
 * ```
 */
export function createCodeGraphProcessor(opts: MastraProcessorOpts = {}): {
  name: string;
  process(input: MastraProcessorInput): Promise<MastraProcessorInput>;
} {
  const maxHits = opts.maxHits ?? 5;

  const getSearch = (): SearchFn => {
    if (opts._searchFn) return opts._searchFn;
    return async (query, searchOpts) => {
      const { enrichedSearchV2 } = await import('@codegraph/core');
      const result = await enrichedSearchV2(query, searchOpts as Parameters<typeof enrichedSearchV2>[1]);
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

  return {
    name: 'codegraph-context',

    async process(input: MastraProcessorInput): Promise<MastraProcessorInput> {
      const messages = input.messages;
      if (!Array.isArray(messages) || messages.length === 0) return input;

      const userMessages = messages.filter((m) => m.role === 'user');
      const lastUser = userMessages[userMessages.length - 1];
      if (!lastUser || typeof lastUser.content !== 'string' || lastUser.content.length < 5) {
        return input;
      }

      const text = lastUser.content;
      const key = cacheKey(opts.projectPath, text, maxHits);
      let hits = _cache.get(key);

      if (!hits) {
        try {
          hits = await getSearch()(text, { limit: maxHits, scope: opts.projectPath });
          _cache.set(key, hits);
        } catch {
          hits = [];
        }
      }

      if (hits.length === 0) return input;

      const contextLines = hits.map(
        (h) => `- ${h.name} (${h.filePath ?? 'unknown'}): ${h.signature ?? ''}`,
      );
      const contextMsg: MastraMessage = {
        role: 'system',
        content: ['## CodeGraph context', ...contextLines].join('\n'),
      };

      return { ...input, messages: [contextMsg, ...messages] };
    },
  };
}
