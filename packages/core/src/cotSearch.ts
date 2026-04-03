/**
 * Chain-of-Thought Search — Iterative search with LLM validation
 *
 * Process: search → LLM validates answer → generates follow-up → search again
 * → merge results → up to N iterations until convergence.
 *
 * Uses unified search as the retrieval backbone. Falls back to single-pass
 * if LLM is unavailable.
 */

import { createLogger, toErrorMessage } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { unifiedSearch, type UnifiedSearchResult, type UnifiedSearchOptions } from './unifiedSearch';

const logger = createLogger({ namespace: 'core:cot-search' });

// ============================================================================
// Types
// ============================================================================

export interface CotSearchOptions extends UnifiedSearchOptions {
  /** Maximum iterations (default: 3) */
  maxIterations?: number;
  /** LLM model for validation (uses default if not set) */
  model?: string;
}

export interface CotSearchResult {
  /** Final merged results */
  results: UnifiedSearchResult[];
  /** Number of iterations performed */
  iterations: number;
  /** Queries used in each iteration */
  queries: string[];
  /** Whether CoT mode was used (false = fell back to single-pass) */
  cotUsed: boolean;
  /** Total duration */
  durationMs: number;
}

// ============================================================================
// LLM Helpers
// ============================================================================

async function generateFollowUp(
  query: string,
  results: UnifiedSearchResult[],
): Promise<{ followUpQuery: string | null; isConverged: boolean }> {
  try {
    const { getLLMModel, isLLMAvailable } = await import('@codegraph/plugin-nlp');
    if (!isLLMAvailable()) {
      return { followUpQuery: null, isConverged: true };
    }

    const { generateText } = await import('ai');
    const model = await getLLMModel();

    const resultSummary = results.slice(0, 5).map(r =>
      `- [${r.source}] ${r.name} (${r.type})${r.filePath ? ` at ${r.filePath}` : ''}`
    ).join('\n');

    const { text } = await generateText({
      model,
      system: 'You are a search refinement assistant. Given a query and initial search results, determine if the results answer the query. If not, suggest ONE follow-up search query. Respond with ONLY the follow-up query, or "CONVERGED" if the results are sufficient.',
      prompt: `Original query: "${query}"\n\nSearch results:\n${resultSummary}\n\nDo these results answer the query? If not, what should I search for next?`,
      maxOutputTokens: 100,
    });

    const trimmed = text.trim();
    if (trimmed === 'CONVERGED' || trimmed.toLowerCase().includes('converged')) {
      return { followUpQuery: null, isConverged: true };
    }

    return { followUpQuery: trimmed, isConverged: false };
  } catch (err) {
    logger.warn(`CoT follow-up generation failed: ${toErrorMessage(err)}`);
    return { followUpQuery: null, isConverged: true };
  }
}

// ============================================================================
// Chain-of-Thought Search
// ============================================================================

export async function cotSearch(
  query: string,
  client: GraphClient,
  options: CotSearchOptions = {},
): Promise<CotSearchResult> {
  const start = Date.now();
  const maxIterations = options.maxIterations ?? 3;
  const limit = options.limit ?? 20;
  const queries: string[] = [query];

  // First pass: unified search
  const firstPass = await unifiedSearch(query, client, {
    ...options,
    searchScope: options.searchScope ?? 'all',
    limit: limit * 2,
  });

  let allResults = [...firstPass.results];
  let iterations = 1;
  let cotUsed = false;

  // Iterative refinement
  for (let i = 1; i < maxIterations; i++) {
    const { followUpQuery, isConverged } = await generateFollowUp(query, allResults);

    if (isConverged || !followUpQuery) {
      break;
    }

    cotUsed = true;
    queries.push(followUpQuery);
    logger.info(`CoT iteration ${i + 1}: "${followUpQuery}"`);

    const nextPass = await unifiedSearch(followUpQuery, client, {
      ...options,
      searchScope: options.searchScope ?? 'all',
      limit,
    });

    // Merge: deduplicate by name+type
    const seen = new Set(allResults.map(r => `${r.name}:${r.type}`));
    for (const r of nextPass.results) {
      const key = `${r.name}:${r.type}`;
      if (!seen.has(key)) {
        allResults.push(r);
        seen.add(key);
      }
    }

    iterations = i + 1;
  }

  // Sort by score and trim
  allResults.sort((a, b) => b.score - a.score);
  const finalResults = allResults.slice(0, limit);

  const durationMs = Date.now() - start;
  logger.info(`CoT search "${query.slice(0, 60)}": ${finalResults.length} results in ${iterations} iterations (${durationMs}ms)`);

  return {
    results: finalResults,
    iterations,
    queries,
    cotUsed,
    durationMs,
  };
}
