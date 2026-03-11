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

/** Check if an error is a structured output generation failure */
function isNoOutputError(error: unknown): boolean {
  return NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error);
}
import { createLogger } from '@codegraph/logger';
import { ContextWalkStepSchema, type ContextWalkStep } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
  SearchRelatedItem,
} from '../types';
import { hybridSearch, type HybridSearchOptions, type HybridSearchResult } from '../../hybridSearch';

const logger = createLogger({ namespace: 'core:search:context-walk' });

/** Maximum number of exploration rounds before forcing an answer */
const MAX_ROUNDS = 5;

/** Maximum number of nodes to accumulate before forcing an answer */
const MAX_CONTEXT_NODES = 50;

interface WalkState {
  /** All discovered nodes across rounds */
  discoveredNodes: SearchResultItem[];
  /** All discovered relationships */
  discoveredRelated: SearchRelatedItem[];
  /** Walk history for LLM context */
  walkHistory: string[];
  /** Round counter */
  round: number;
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

  /**
   * Generate a ContextWalkStep with model fallback (complex → default).
   * Throws only if ALL models fail with non-recoverable errors.
   */
  private async generateStepWithFallback(
    models: LanguageModel[],
    prompt: string,
  ): Promise<ContextWalkStep | null> {
    for (let i = 0; i < models.length; i++) {
      const model = models[i]!;
      const isLast = i === models.length - 1;
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — Zod schema type inference depth issue
        const { output } = (await generateText({
          model,
          output: Output.object({ schema: ContextWalkStepSchema }),
          prompt,
          temperature: 0.2,
        })) as { output: ContextWalkStep };
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

    // Build ordered model list for fallback: complex first, then default
    const models: LanguageModel[] = [];
    if (context.complexLlm) models.push(context.complexLlm);
    if (context.llm && context.llm !== context.complexLlm) models.push(context.llm);
    if (models.length === 0 && context.llm) models.push(context.llm);

    const maxRounds = (request.options?.['maxRounds'] as number) ?? MAX_ROUNDS;
    const state: WalkState = {
      discoveredNodes: [],
      discoveredRelated: [],
      walkHistory: [],
      round: 0,
    };

    // Step 1: Seed search
    logger.info(`CONTEXT_WALK: Starting seed search for "${request.query}"`);
    const seedOpts = buildHybridOpts(10, 1, context, request.scope);
    const seedResult = await hybridSearch(request.query, context.client, seedOpts);

    // Add seed results to state
    for (const item of hitsToResultItems(seedResult)) {
      this.addNode(state, item);
    }
    for (const item of relatedToItems(seedResult)) {
      this.addRelated(state, item);
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

      // Ask LLM what to do next (with fallback)
      const contextSummary = this.buildContextSummary(state);
      const step = await this.generateStepWithFallback(
        models,
        this.buildStepPrompt(request.query, contextSummary, state.walkHistory),
      );
      if (!step) {
        logger.warn('CONTEXT_WALK: All models failed to generate step, forcing answer');
        break;
      }

      state.walkHistory.push(
        `Round ${round}: Action=${step.action}, Reasoning="${step.reasoning}"`,
      );
      logger.debug(`CONTEXT_WALK round ${round}: ${step.action} — ${step.reasoning}`);

      if (step.action === 'answer') {
        finalAnswer = step.answer ?? 'No answer provided.';
        finalConfidence = 0.8; // Good confidence when LLM chose to answer
        break;
      }

      if (step.action === 'refine') {
        // Re-search with refined query
        const refinedQuery = step.refinedQuery ?? request.query;
        const refineOpts = buildHybridOpts(8, 1, context, request.scope);
        const refinedResult = await hybridSearch(refinedQuery, context.client, refineOpts);

        let newNodes = 0;
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
        // Expand from a specific node
        const target = step.expandTarget ?? state.discoveredNodes[0]?.name ?? request.query;
        const expandOpts = buildHybridOpts(8, 2, context, request.scope);
        const expandResult = await hybridSearch(target, context.client, expandOpts);

        let newNodes = 0;
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
    }

    // Step 3: If no answer yet, force one from the collected context
    if (!finalAnswer && state.discoveredNodes.length > 0) {
      const contextSummary = this.buildContextSummary(state);
      const finalStep = await this.generateStepWithFallback(
        models,
        this.buildFinalAnswerPrompt(request.query, contextSummary, state.walkHistory),
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

    return lines.join('\n');
  }

  private buildStepPrompt(
    query: string,
    contextSummary: string,
    walkHistory: string[],
  ): string {
    return `You are a graph exploration agent investigating a codebase knowledge graph.
Your goal is to answer the user's question by iteratively exploring the graph.

## User Question:
"${query}"

## Walk History:
${walkHistory.join('\n')}

## Currently Discovered Context:
${contextSummary}

## Choose your next action:
- "expand": Search for more related nodes by specifying an expandTarget (a node name or pattern to explore)
- "refine": Re-search with a more specific query using refinedQuery
- "answer": You have enough context to answer the question — provide your answer

Decide based on whether you have enough information to answer the question. If not, expand or refine to gather more context.`;
  }

  private buildFinalAnswerPrompt(
    query: string,
    contextSummary: string,
    walkHistory: string[],
  ): string {
    return `You are a graph exploration agent. After exploring a codebase knowledge graph, synthesize an answer.

## User Question:
"${query}"

## Walk History:
${walkHistory.join('\n')}

## All Discovered Context:
${contextSummary}

You MUST choose action "answer" and provide your best answer based on the collected context.
If the context doesn't fully address the question, explain what was found and what's missing.`;
  }
}
