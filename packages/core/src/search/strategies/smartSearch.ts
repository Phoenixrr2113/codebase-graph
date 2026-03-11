/**
 * SMART_SEARCH Strategy
 *
 * Auto-routes queries to the best search strategy using LLM classification.
 * Analyzes the query intent and dispatches to HYBRID, GRAPH_ANSWER,
 * NL_TO_CYPHER, or CONTEXT_WALK accordingly.
 *
 * Example queries:
 * - "sendEmail" → HYBRID (simple lookup)
 * - "What does the auth module do?" → GRAPH_ANSWER (needs explanation)
 * - "Show me all functions that call sendEmail" → NL_TO_CYPHER (graph traversal)
 * - "How does data flow from API to database?" → CONTEXT_WALK (multi-hop)
 */

import { generateObject } from 'ai';
import { createLogger } from '@codegraph/logger';
import { SearchRouteSchema, type SearchRoute } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchType,
} from '../types';
import type { SearchRegistry } from '../registry';

const logger = createLogger({ namespace: 'core:search:smart-search' });

/**
 * Heuristic-based fallback routing when the LLM is unavailable or fails.
 * Classifies queries based on patterns without needing an LLM call.
 */
function heuristicRoute(query: string): SearchType {
  const lower = query.toLowerCase().trim();

  // Graph traversal patterns → NL_TO_CYPHER
  if (
    /\b(show|list|find)\s+(me\s+)?(all|every)\b/.test(lower) ||
    /\b(that|which|who)\s+(call|import|extend|implement|use)/.test(lower) ||
    /\b(calls|imports|extends|implements|contains)\b/.test(lower) ||
    /\bcount\b.*\b(function|class|file|interface)/.test(lower)
  ) {
    return 'NL_TO_CYPHER';
  }

  // Question patterns → GRAPH_ANSWER
  if (
    /^(what|how|why|who|when|where|explain|describe)\b/i.test(lower) ||
    lower.endsWith('?')
  ) {
    return 'GRAPH_ANSWER';
  }

  // Multi-hop exploration patterns → CONTEXT_WALK
  if (
    /\b(flow|trace|path|chain)\b/.test(lower) &&
    /\b(from|to|through|between)\b/.test(lower)
  ) {
    return 'CONTEXT_WALK';
  }

  // Default: HYBRID (simple search)
  return 'HYBRID';
}

export class SmartSearchStrategy implements SearchStrategy {
  readonly type = 'SMART_SEARCH' as const;
  readonly description = 'Auto-routes to the best search strategy based on query analysis';
  readonly requiresLLM = false; // can fall back to heuristics

  constructor(private registry: SearchRegistry) {}

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    let routedTo: SearchType;
    let routingReason: string;
    let effectiveQuery = request.query;

    if (context.llm) {
      // LLM-based routing
      try {
        const route = await this.classifyWithLLM(request.query, context);
        routedTo = route.strategy;
        routingReason = route.reasoning;
        if (route.rewrittenQuery) {
          effectiveQuery = route.rewrittenQuery;
        }
      } catch (error) {
        logger.warn('LLM routing failed, falling back to heuristics', error);
        routedTo = heuristicRoute(request.query);
        routingReason = `Heuristic fallback (LLM error): matched pattern for ${routedTo}`;
      }
    } else {
      // Heuristic routing (no LLM)
      routedTo = heuristicRoute(request.query);
      routingReason = `Heuristic routing (no LLM): matched pattern for ${routedTo}`;
    }

    logger.info(`SMART_SEARCH routing: "${request.query}" → ${routedTo} (${routingReason})`);

    // Check if the routed strategy is available
    if (!this.registry.has(routedTo)) {
      logger.warn(`Strategy ${routedTo} not registered, falling back to HYBRID`);
      routedTo = 'HYBRID';
      routingReason += ' (fallback: original strategy not registered)';
    }

    // Check LLM requirement for the routed strategy
    const strategy = this.registry.get(routedTo)!;
    if (strategy.requiresLLM && !context.llm) {
      logger.warn(`Strategy ${routedTo} requires LLM but none available, falling back to HYBRID`);
      routedTo = 'HYBRID';
      routingReason += ' (fallback: LLM required but not available)';
    }

    // Dispatch to the selected strategy
    const innerRequest: SearchRequest = {
      ...request,
      query: effectiveQuery,
      type: routedTo,
    };

    const response = await this.registry.search(innerRequest, context);

    // Augment response with routing info
    return {
      ...response,
      routedTo,
      routingReason,
      meta: {
        ...response.meta,
        searchType: 'SMART_SEARCH',
        routedTo,
        routingReason,
        queryRewritten: effectiveQuery !== request.query,
      },
    };
  }

  private async classifyWithLLM(
    query: string,
    context: SearchContext,
  ): Promise<{ strategy: SearchType; reasoning: string; rewrittenQuery?: string }> {
    const availableStrategies = this.registry
      .listStrategies()
      .filter((s) => s.type !== 'SMART_SEARCH') // don't route to self
      .map((s) => `- ${s.type}: ${s.description}`)
      .join('\n');

    const { object } = (await generateObject({
      model: context.llm!,
      schema: SearchRouteSchema,
      prompt: `You are a search router for a code knowledge graph. Classify the user's query and choose the best search strategy.

## Available Strategies:
${availableStrategies}

## Guidelines:
- VECTOR/HYBRID: Simple lookups by name, keyword, or concept (e.g., "sendEmail", "auth module")
- GRAPH_ANSWER: Questions that need an explanation or synthesis (e.g., "What does X do?", "Who created Y?")
- NL_TO_CYPHER: Structural queries about relationships (e.g., "Find all functions that call X", "List classes extending Y")
- CONTEXT_WALK: Complex multi-hop exploration (e.g., "How does data flow from X to Y?", "Trace the call chain from A to B")

## User Query:
"${query}"

Choose the best strategy and optionally rewrite the query for better results.`,
      temperature: 0.1,
    })) as { object: SearchRoute };

    const result: { strategy: SearchType; reasoning: string; rewrittenQuery?: string } = {
      strategy: object.strategy as SearchType,
      reasoning: object.reasoning,
    };
    if (object.rewrittenQuery) result.rewrittenQuery = object.rewrittenQuery;
    return result;
  }
}
