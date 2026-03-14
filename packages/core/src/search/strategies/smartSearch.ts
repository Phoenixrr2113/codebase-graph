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

import { generateText, Output } from 'ai';
import { createLogger } from '@codegraph/logger';
import { SearchRouteSchema, type SearchRoute, withRetry } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchType,
} from '../types';
import type { SearchRegistry } from '../registry';

const logger = createLogger({ namespace: 'core:search:smart-search' });

/** Heuristic routing result with confidence */
interface HeuristicResult {
  strategy: SearchType;
  confidence: 'high' | 'low';
  reason: string;
}

/**
 * Detect whether a query is a natural language question.
 *
 * Uses three complementary checks that cover all standard English question forms:
 * 1. Ends with `?` — explicit question punctuation
 * 2. Starts with a wh-word — "what", "how", "why", etc. (interrogative pronouns/adverbs)
 * 3. Starts with subject-auxiliary inversion — "is X...", "does X...", "can we..." etc.
 *    These are yes/no questions and require a multi-word query (single words like
 *    "describe" are treated as commands, not questions).
 *
 * Also catches imperative knowledge requests: "explain X", "describe X"
 */
function isQuestion(query: string): boolean {
  const lower = query.toLowerCase().trim();

  // Explicit question mark
  if (lower.endsWith('?')) return true;

  // Wh-words (interrogative pronouns/adverbs) — always signal a question
  if (/^(what|how|why|who|when|where|which|whose|whom)\b/.test(lower)) return true;

  // Subject-auxiliary inversion (yes/no questions) — only if multi-word
  // "Is this deprecated?", "Does it support OAuth?", "Can I use this?"
  // Must have at least 2 words to avoid matching single-word queries
  if (
    lower.includes(' ') &&
    /^(is|are|was|were|do|does|did|can|could|should|would|will|shall|has|have|had|isn't|aren't|doesn't|don't|won't|can't|couldn't|shouldn't|wouldn't)\b/.test(lower)
  ) {
    return true;
  }

  // Imperative knowledge requests — "explain X", "describe X"
  if (/^(explain|describe)\b/.test(lower)) return true;

  return false;
}

/**
 * Heuristic-based routing. Returns a confidence level so the caller can
 * decide whether to trust the heuristic or escalate to LLM classification.
 *
 * 'high' confidence means the pattern is strong enough to skip LLM routing.
 * 'low' confidence means the query is ambiguous and LLM routing may help.
 */
function heuristicRoute(query: string): HeuristicResult {
  const lower = query.toLowerCase().trim();

  // --- High-confidence patterns ---

  // Graph traversal patterns → NL_TO_CYPHER (strong structural signals)
  if (
    /\b(show|list|find)\s+(me\s+)?(all|every)\b/.test(lower) ||
    /\b(that|which|who)\s+(call|import|extend|implement|use)/.test(lower) ||
    /\b(calls|imports|extends|implements|contains)\b/.test(lower) ||
    /\bcount\b.*\b(function|class|file|interface)/.test(lower)
  ) {
    return { strategy: 'NL_TO_CYPHER', confidence: 'high', reason: 'structural traversal pattern' };
  }

  // Multi-hop exploration patterns → CONTEXT_WALK (strong multi-hop signals)
  if (
    /\b(flow|trace|path|chain)\b/.test(lower) &&
    /\b(from|to|through|between)\b/.test(lower)
  ) {
    return { strategy: 'CONTEXT_WALK', confidence: 'high', reason: 'multi-hop exploration pattern' };
  }

  // Boolean operators → HYBRID with structured query (AND, OR, NOT)
  if (/\b(AND|OR|NOT)\b/.test(query)) {
    return { strategy: 'HYBRID', confidence: 'high', reason: 'boolean operator query' };
  }

  // Wildcard patterns → HYBRID with pattern matching
  // Exclude trailing ? (question mark) and only match wildcards in symbol-like queries
  if (/[*]/.test(query) || (/[?]/.test(query) && /^[a-zA-Z_$*?][a-zA-Z0-9_$*?.]*$/.test(query.trim()))) {
    return { strategy: 'HYBRID', confidence: 'high', reason: 'wildcard pattern query' };
  }

  // Exact quoted phrase → HYBRID with phrase search
  if (/^["'].+["']$/.test(query.trim())) {
    return { strategy: 'HYBRID', confidence: 'high', reason: 'exact phrase search' };
  }

  // Short single-word or camelCase/PascalCase lookups → HYBRID (symbol lookup)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(query.trim()) && query.trim().length < 60) {
    return { strategy: 'HYBRID', confidence: 'high', reason: 'single symbol lookup' };
  }

  // Dot-separated paths (e.g. "auth.middleware.validate") → HYBRID (qualified symbol)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(query.trim())) {
    return { strategy: 'HYBRID', confidence: 'high', reason: 'qualified symbol lookup' };
  }

  // --- Low-confidence patterns (may benefit from LLM refinement) ---

  // Question detection → GRAPH_ANSWER (but ambiguous — LLM can improve routing + query rewrite)
  if (isQuestion(query)) {
    return { strategy: 'GRAPH_ANSWER', confidence: 'low', reason: 'question pattern' };
  }

  // Default: HYBRID (simple search) — low confidence, LLM may reclassify
  return { strategy: 'HYBRID', confidence: 'low', reason: 'no strong pattern match' };
}

// Exported for unit testing
export { isQuestion, heuristicRoute };

export class SmartSearchStrategy implements SearchStrategy {
  readonly type = 'SMART_SEARCH' as const;
  readonly description = 'Auto-routes to the best search strategy based on query analysis';
  readonly requiresLLM = false; // can fall back to heuristics

  constructor(private registry: SearchRegistry) {}

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    let routedTo: SearchType;
    let routingReason: string;
    let effectiveQuery = request.query;

    // Try heuristics first — skip LLM call when pattern confidence is high
    const heuristic = heuristicRoute(request.query);

    if (heuristic.confidence === 'high') {
      // Strong pattern match — use directly, skip LLM routing entirely
      routedTo = heuristic.strategy;
      routingReason = `Heuristic (high confidence): ${heuristic.reason}`;
    } else if (context.llm) {
      // Ambiguous query — use LLM for better classification + query rewrite
      try {
        const route = await this.classifyWithLLM(request.query, context);
        routedTo = route.strategy;
        routingReason = route.reasoning;
        if (route.rewrittenQuery) {
          effectiveQuery = route.rewrittenQuery;
        }
      } catch (error) {
        logger.warn('LLM routing failed, falling back to heuristic', error);
        routedTo = heuristic.strategy;
        routingReason = `Heuristic fallback (LLM error): ${heuristic.reason}`;
      }
    } else {
      // No LLM available — use heuristic result as-is
      routedTo = heuristic.strategy;
      routingReason = `Heuristic (no LLM): ${heuristic.reason}`;
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

    const systemPrompt = `You are a search router for a code knowledge graph. Classify the user's query and choose the best search strategy.

## Available Strategies:
${availableStrategies}

## Strategy Selection Guide:
- HYBRID: Simple lookups by name, keyword, or concept — when the user wants to find a specific symbol or file
- GRAPH_ANSWER: Questions that need an explanation or synthesis — when the user asks "what", "why", "how does X work"
- NL_TO_CYPHER: Structural queries about relationships — when the user wants to traverse edges like CALLS, IMPORTS, EXTENDS
- CONTEXT_WALK: Complex multi-hop exploration — when the user wants to trace flows, chains, or multi-step paths

## Few-Shot Examples:

Query: "sendEmail" → HYBRID (simple symbol lookup)
Query: "What does the SearchRegistry class do?" → GRAPH_ANSWER (needs explanation)
Query: "Find all functions that call hybridSearch" → NL_TO_CYPHER (traverses CALLS edges)
Query: "List classes that implement the SearchStrategy interface" → NL_TO_CYPHER (traverses IMPLEMENTS edges)
Query: "How does data flow from the API handler to the database?" → CONTEXT_WALK (multi-hop trace)
Query: "What files import the logger module?" → NL_TO_CYPHER (traverses IMPORTS edges)
Query: "Explain the authentication flow" → CONTEXT_WALK (multi-hop exploration)
Query: "What is the purpose of the middleware layer?" → GRAPH_ANSWER (needs synthesis)
Query: "validateToken" → HYBRID (simple symbol lookup)
Query: "Trace the call chain from parseRequest to sendResponse" → CONTEXT_WALK (multi-hop call trace)`;

    const { output } = (await withRetry(() => generateText({
      model: context.llm!,
      output: Output.object({ schema: SearchRouteSchema }),
      system: systemPrompt,
      prompt: `Classify this query and choose the best strategy: "${query}"`,
      temperature: 0,
      maxOutputTokens: 200,
    }))) as { output: SearchRoute };

    const result: { strategy: SearchType; reasoning: string; rewrittenQuery?: string } = {
      strategy: output.strategy as SearchType,
      reasoning: output.reasoning,
    };
    if (output.rewrittenQuery) result.rewrittenQuery = output.rewrittenQuery;
    return result;
  }
}
