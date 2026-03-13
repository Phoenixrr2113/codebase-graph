/**
 * CONTEXT_WALK Search Strategy
 *
 * Iterative multi-round graph exploration using LLM-guided traversal.
 * Starts with a seed search, then iteratively expands the exploration
 * based on LLM decisions until an answer is found or max rounds are reached.
 *
 * Example queries:
 * - "How does data flow from the API handler to the database?"
 * - "Trace the call chain from parseRequest to sendResponse"
 * - "What components depend on the AuthService?"
 */

import { generateText, Output, NoObjectGeneratedError, NoOutputGeneratedError, type LanguageModel } from 'ai';
import { createLogger } from '@codegraph/logger';
import { ContextWalkStepSchema, type ContextWalkStep, withRetry } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
  SearchRelatedItem,
} from '../types';
import { hybridSearch, type HybridSearchOptions, type HybridSearchResult } from '../../hybridSearch';

/** Check if an error is a structured output generation failure */
function isNoOutputError(error: unknown): boolean {
  return NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error);
}

const logger = createLogger({ namespace: 'core:search:context-walk' });

/** Maximum number of exploration rounds before forcing an answer */
const MAX_ROUNDS = 5;

/** Maximum number of nodes to accumulate before forcing an answer */
const MAX_CONTEXT_NODES = 50;

/** Confidence threshold: if LLM signals >= this, exit early and answer */
const CONFIDENCE_EXIT_THRESHOLD = 0.8;

/** Consecutive stale rounds (0 new nodes) before forcing an answer */
const MAX_STALE_ROUNDS = 2;

interface WalkState {
  /** All discovered nodes across rounds */
  discoveredNodes: SearchResultItem[];
  /** All discovered relationships */
  discoveredRelated: SearchRelatedItem[];
  /** Walk history for LLM context */
  walkHistory: string[];
  /** Round counter */
  round: number;
  /** Consecutive rounds that discovered zero new nodes */
  staleRounds: number;
  /** Targets already expanded — prevents re-expanding the same node */
  expandedTargets: Set<string>;
}

/** Build hybrid search options with optional fields properly set */
function buildHybridOpts(
  limit: number,
  maxHops: number,
  context: SearchContext,
  scope?: string,
): HybridSearchOptions {
  const opts: HybridSearchOptions = {
    limit,
    includeKnowledge: true,
    expandGraph: true,
    maxHops,
    includeAboutEdges: true,
  };
  if (context.embeddings) opts.embeddings = context.embeddings;
  if (scope) opts.scope = scope;
  return opts;
}

/** Convert HybridSearchResult hits to SearchResultItems */
function hitsToResultItems(result: HybridSearchResult): SearchResultItem[] {
  return result.hits.map((hit) => {
    const item: SearchResultItem = {
      name: hit.name,
      nodeType: hit.nodeType,
      score: hit.score,
      sources: hit.sources,
      properties: hit.properties,
    };
    if (hit.filePath) item.filePath = hit.filePath;
    if (hit.startLine != null) item.startLine = hit.startLine;
    return item;
  });
}

/** Convert HybridSearchResult related hits to SearchRelatedItems */
function relatedToItems(result: HybridSearchResult): SearchRelatedItem[] {
  return result.related.map((rel) => {
    const item: SearchRelatedItem = {
      name: rel.name,
      nodeType: rel.nodeType,
      edgeLabel: rel.edgeLabel,
      direction: rel.direction,
      sourceHit: rel.sourceKey,
    };
    if (rel.filePath) item.filePath = rel.filePath;
    return item;
  });
}

export class ContextWalkStrategy implements SearchStrategy {
  readonly type = 'CONTEXT_WALK' as const;
  readonly description =
    'Iterative multi-round graph exploration using LLM-guided traversal';
  readonly requiresLLM = true;

  /** System prompt for step decisions: role + few-shot examples */
  private readonly STEP_SYSTEM_PROMPT = `You are a graph exploration agent investigating a codebase knowledge graph.
Your goal is to answer the user's question by iteratively exploring the graph.
Each round you choose one action: expand, refine, or answer.

## Action Guide:
- "expand": You see a promising node in the discovered context and want to explore its neighbors. Provide expandTarget with the node name. IMPORTANT: Choose a DIFFERENT node each round — never re-expand a target listed in "Already Expanded".
- "refine": The current results aren't relevant enough. Provide refinedQuery with a better search term.
- "answer": You have enough context (confidence >= 0.8) to answer the question. Provide your answer.

## Examples:

Question: "What functions call hybridSearch?"
Discovered: [Function] hybridSearch (src/hybridSearch.ts), [Function] search (src/search/registry.ts)
→ Action: expand, expandTarget: "hybridSearch", reasoning: "Need to find callers of hybridSearch by exploring its relationships"

Question: "How does authentication work?"
Discovered: [File] auth.ts, [Function] validateToken, [Function] createSession
Related: auth.ts --[CONTAINS]--> validateToken, auth.ts --[CONTAINS]--> createSession, validateToken --[CALLS]--> verifyJWT
→ Action: answer, confidence: 0.85, answer: "Authentication works through auth.ts which contains validateToken() and createSession(). validateToken calls verifyJWT to validate tokens."

Question: "What components use the Modal component?"
Discovered: [Component] Modal (src/components/Modal.tsx)
→ Action: expand, expandTarget: "Modal", reasoning: "Found the Modal component, need to explore which components render it"

Question: "Find the error handling logic"
Discovered: [Function] handleError, [Class] ErrorBoundary
Related: handleError --[CALLS]--> logError
Walk History: Round 1 expanded "handleError" but found no new error-related nodes
→ Action: refine, refinedQuery: "ErrorBoundary catch exception", reasoning: "Initial expand didn't reveal the full error handling chain, trying more specific search terms"`;

  /** System prompt for final answer synthesis */
  private readonly FINAL_ANSWER_SYSTEM_PROMPT = `You are a graph exploration agent. After exploring a codebase knowledge graph across multiple rounds, synthesize a comprehensive answer.
You MUST choose action "answer" and provide your best answer based on the collected context.
If the context doesn't fully address the question, explain what was found and what's missing.

## Example:

Question: "How does data flow from API to database?"
Discovered: [Function] handleRequest (src/api/handler.ts), [Function] validateInput (src/api/validation.ts), [Function] saveRecord (src/db/repository.ts), [Class] DatabaseClient (src/db/client.ts)
Related: handleRequest --[CALLS]--> validateInput, handleRequest --[CALLS]--> saveRecord, saveRecord --[CALLS]--> DatabaseClient.query
→ Action: answer, answer: "Data flows from the API to the database through this chain: handleRequest() in the API handler first calls validateInput() for validation, then calls saveRecord() in the repository layer, which ultimately calls DatabaseClient.query() to persist data. The flow is: API handler → validation → repository → database client."`;

  /**
   * Generate a ContextWalkStep with model fallback.
   * @param models - Ordered list of models to try (first = preferred)
   * @param systemPrompt - System prompt with role and few-shot examples
   * @param prompt - User prompt with current context and question
   * @param maxTokens - Token limit for generation (lower for step decisions, higher for answers)
   * Throws only if ALL models fail with non-recoverable errors.
   */
  private async generateStepWithFallback(
    models: LanguageModel[],
    systemPrompt: string,
    prompt: string,
    maxTokens: number = 300,
  ): Promise<ContextWalkStep | null> {
    for (let i = 0; i < models.length; i++) {
      const model = models[i]!;
      const isLast = i === models.length - 1;
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — Zod schema type inference depth issue
        const { output } = (await withRetry(() => generateText({
          model,
          output: Output.object({ schema: ContextWalkStepSchema }),
          system: systemPrompt,
          prompt,
          temperature: 0.2,
          maxOutputTokens: maxTokens,
        }))) as { output: ContextWalkStep };
        return output;
      } catch (error) {
        if (isNoOutputError(error)) {
          if (isLast) return null;
          continue;
        }
        if (!isLast) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn(`CONTEXT_WALK: Model failed (${msg}), trying fallback`);
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    if (!context.llm && !context.complexLlm) {
      throw new Error('CONTEXT_WALK requires an LLM');
    }

    // Fast models for step decisions (expand/refine routing — simple classification)
    const stepModels: LanguageModel[] = [];
    if (context.llm) stepModels.push(context.llm);
    if (context.complexLlm && context.complexLlm !== context.llm) stepModels.push(context.complexLlm);
    if (stepModels.length === 0 && context.complexLlm) stepModels.push(context.complexLlm);

    // Complex models for final answer synthesis (needs deeper reasoning)
    const answerModels: LanguageModel[] = [];
    if (context.complexLlm) answerModels.push(context.complexLlm);
    if (context.llm && context.llm !== context.complexLlm) answerModels.push(context.llm);
    if (answerModels.length === 0 && context.llm) answerModels.push(context.llm);

    const maxRounds = (request.options?.['maxRounds'] as number) ?? MAX_ROUNDS;
    const state: WalkState = {
      discoveredNodes: [],
      discoveredRelated: [],
      walkHistory: [],
      round: 0,
      staleRounds: 0,
      expandedTargets: new Set(),
    };

    // Step 1: Seed search — use 2-hop graph traversal for richer initial context
    logger.info(`CONTEXT_WALK: Starting seed search for "${request.query}"`);
    const seedOpts = buildHybridOpts(10, 1, context, request.scope);
    const seedResult = await hybridSearch(request.query, context.client, seedOpts);

    // Add seed results to state — both direct hits and graph-traversal neighbors.
    // Promoting related nodes into discoveredNodes ensures that 1-hop neighbors
    // found via graph edges (e.g., a "client" variable found via CONTAINS from a file)
    // are included in the final results, not just in the relationship list.
    for (const item of hitsToResultItems(seedResult)) {
      this.addNode(state, item);
    }
    for (const item of relatedToItems(seedResult)) {
      this.addRelated(state, item);
      // Promote graph-traversal neighbors into discoveredNodes for richer context
      const nodeItem: SearchResultItem = {
        name: item.name,
        nodeType: item.nodeType,
        score: 0.3, // Lower score than direct hits
        sources: ['graph'],
      };
      if (item.filePath) nodeItem.filePath = item.filePath;
      this.addNode(state, nodeItem);
    }
    state.walkHistory.push(
      `Round 0 (seed): Found ${seedResult.hits.length} nodes and ${seedResult.related.length} relationships for "${request.query}"`,
    );

    // Step 2: Iterative walk
    let finalAnswer: string | undefined;
    let finalConfidence = 0;

    for (let round = 1; round <= maxRounds; round++) {
      state.round = round;

      if (state.discoveredNodes.length >= MAX_CONTEXT_NODES) {
        logger.info('CONTEXT_WALK: Max context nodes reached, forcing answer');
        break;
      }

      // Early exit: consecutive stale rounds (no new nodes discovered)
      if (state.staleRounds >= MAX_STALE_ROUNDS) {
        logger.info(`CONTEXT_WALK: ${MAX_STALE_ROUNDS} consecutive stale rounds, forcing answer`);
        break;
      }

      // Per-round error handling: LLM failures skip the round rather than
      // crashing the entire walk. This handles transient model outages gracefully.
      let step: Awaited<ReturnType<typeof this.generateStepWithFallback>>;
      try {
        // Ask LLM what to do next — use fast model for step routing decisions
        const contextSummary = this.buildContextSummary(state);
        step = await this.generateStepWithFallback(
          stepModels,
          this.STEP_SYSTEM_PROMPT,
          this.buildStepPrompt(request.query, contextSummary, state.walkHistory),
          300,
        );
      } catch (roundError) {
        const msg = roundError instanceof Error ? roundError.message : String(roundError);
        logger.warn(`CONTEXT_WALK round ${round}: LLM failed (${msg}), skipping`);
        state.walkHistory.push(`Round ${round}: LLM error (${msg}), skipped`);
        state.staleRounds++;
        continue;
      }

      if (!step) {
        logger.warn('CONTEXT_WALK: All models failed to generate step, forcing answer');
        break;
      }

      state.walkHistory.push(
        `Round ${round}: Action=${step.action}, Reasoning="${step.reasoning}"`,
      );
      logger.debug(`CONTEXT_WALK round ${round}: ${step.action} — ${step.reasoning}`);

      // Confidence-based early exit: if LLM is highly confident it can answer, do so now
      if (step.confidence != null && step.confidence >= CONFIDENCE_EXIT_THRESHOLD && step.action !== 'answer') {
        logger.info(`CONTEXT_WALK: High confidence (${step.confidence.toFixed(2)}) — requesting answer`);
        state.walkHistory.push(`  Early exit: confidence=${step.confidence.toFixed(2)} >= ${CONFIDENCE_EXIT_THRESHOLD}`);
        break;
      }

      if (step.action === 'answer') {
        finalAnswer = step.answer ?? 'No answer provided.';
        finalConfidence = step.confidence ?? 0.8;
        break;
      }

      let newNodes = 0;

      if (step.action === 'refine') {
        // Re-search with refined query
        const refinedQuery = step.refinedQuery ?? request.query;
        const refineOpts = buildHybridOpts(8, 1, context, request.scope);
        const refinedResult = await hybridSearch(refinedQuery, context.client, refineOpts);

        for (const item of hitsToResultItems(refinedResult)) {
          if (this.addNode(state, item)) newNodes++;
        }
        for (const item of relatedToItems(refinedResult)) {
          this.addRelated(state, item);
        }
        state.walkHistory.push(
          `  Refined search "${refinedQuery}": ${newNodes} new nodes`,
        );
      }

      if (step.action === 'expand') {
        // Expand from a specific node — prevent re-expanding same target
        let target = step.expandTarget ?? state.discoveredNodes[0]?.name ?? request.query;

        // If this target was already expanded, pick the next unexpanded node
        if (state.expandedTargets.has(target.toLowerCase())) {
          const alternative = state.discoveredNodes.find(
            (n) => !state.expandedTargets.has(n.name.toLowerCase()),
          );
          if (alternative) {
            state.walkHistory.push(
              `  Skipped re-expand of "${target}" (already explored), pivoting to "${alternative.name}"`,
            );
            target = alternative.name;
          } else {
            state.walkHistory.push(
              `  Skipped re-expand of "${target}" — no unexplored nodes remain`,
            );
            break; // All nodes explored, force answer
          }
        }
        state.expandedTargets.add(target.toLowerCase());

        const expandOpts = buildHybridOpts(8, 2, context, request.scope);
        const expandResult = await hybridSearch(target, context.client, expandOpts);

        for (const item of hitsToResultItems(expandResult)) {
          if (this.addNode(state, item)) newNodes++;
        }
        for (const item of relatedToItems(expandResult)) {
          this.addRelated(state, item);
        }
        state.walkHistory.push(
          `  Expanded from "${target}": ${newNodes} new nodes`,
        );
      }

      // Track diminishing returns
      if (newNodes === 0) {
        state.staleRounds++;
      } else {
        state.staleRounds = 0;
      }
    }

    // Step 3: If no answer yet, force one — use complex model for synthesis
    if (!finalAnswer && state.discoveredNodes.length > 0) {
      const contextSummary = this.buildContextSummary(state);
      const finalStep = await this.generateStepWithFallback(
        answerModels,
        this.FINAL_ANSWER_SYSTEM_PROMPT,
        this.buildFinalAnswerPrompt(request.query, contextSummary, state.walkHistory),
        1000,
      );
      if (finalStep?.answer) {
        finalAnswer = finalStep.answer;
        finalConfidence = 0.6; // Lower confidence when forced
      } else {
        finalAnswer = 'Unable to synthesize an answer from the explored context.';
        finalConfidence = 0.3;
      }
    }

    const response: SearchResponse = {
      results: state.discoveredNodes,
      related: state.discoveredRelated,
      answerConfidence: finalConfidence,
      total: state.discoveredNodes.length,
      meta: {
        searchType: 'CONTEXT_WALK',
        durationMs: 0, // filled by registry
        rounds: state.round,
        totalDiscoveredNodes: state.discoveredNodes.length,
        totalDiscoveredRelated: state.discoveredRelated.length,
        walkHistory: state.walkHistory,
      },
    };
    if (finalAnswer) response.answer = finalAnswer;

    return response;
  }

  /** Add a node to the walk state, deduplicating by name+nodeType. Returns true if new. */
  private addNode(state: WalkState, node: SearchResultItem): boolean {
    const key = `${node.nodeType}:${node.name}:${node.filePath ?? ''}`;
    const exists = state.discoveredNodes.some(
      (n) => `${n.nodeType}:${n.name}:${n.filePath ?? ''}` === key,
    );
    if (!exists) {
      state.discoveredNodes.push(node);
      return true;
    }
    return false;
  }

  /** Add a related item, deduplicating. */
  private addRelated(state: WalkState, rel: SearchRelatedItem): void {
    const key = `${rel.edgeLabel}:${rel.name}:${rel.sourceHit}`;
    const exists = state.discoveredRelated.some(
      (r) => `${r.edgeLabel}:${r.name}:${r.sourceHit}` === key,
    );
    if (!exists) {
      state.discoveredRelated.push(rel);
    }
  }

  private buildContextSummary(state: WalkState): string {
    const lines: string[] = [];

    lines.push(`## Discovered Nodes (${state.discoveredNodes.length})`);
    for (const node of state.discoveredNodes.slice(0, 30)) {
      const loc = node.filePath ? ` (${node.filePath}:${node.startLine ?? '?'})` : '';
      lines.push(`- [${node.nodeType}] ${node.name}${loc} (score: ${node.score.toFixed(2)})`);
    }
    if (state.discoveredNodes.length > 30) {
      lines.push(`  ... and ${state.discoveredNodes.length - 30} more`);
    }

    lines.push(`\n## Discovered Relationships (${state.discoveredRelated.length})`);
    for (const rel of state.discoveredRelated.slice(0, 20)) {
      lines.push(
        `- ${rel.sourceHit} --[${rel.edgeLabel}]--> ${rel.name} (${rel.nodeType})`,
      );
    }
    if (state.discoveredRelated.length > 20) {
      lines.push(`  ... and ${state.discoveredRelated.length - 20} more`);
    }

    if (state.expandedTargets.size > 0) {
      lines.push(`\n## Already Expanded (do NOT re-expand these)`);
      for (const t of state.expandedTargets) {
        lines.push(`- ${t}`);
      }
    }

    return lines.join('\n');
  }

  private buildStepPrompt(
    query: string,
    contextSummary: string,
    walkHistory: string[],
  ): string {
    return `## User Question:
"${query}"

## Walk History:
${walkHistory.join('\n')}

## Currently Discovered Context:
${contextSummary}

Choose your next action (expand, refine, or answer) and provide a confidence score (0.0 to 1.0).`;
  }

  private buildFinalAnswerPrompt(
    query: string,
    contextSummary: string,
    walkHistory: string[],
  ): string {
    return `## User Question:
"${query}"

## Walk History:
${walkHistory.join('\n')}

## All Discovered Context:
${contextSummary}

Provide your best answer based on the collected context.`;
  }
}
