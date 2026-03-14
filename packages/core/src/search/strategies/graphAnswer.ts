/**
 * GRAPH_ANSWER Search Strategy
 *
 * Answers natural language questions using the knowledge graph.
 * Flow: hybrid search → gather context from top hits → LLM answer synthesis.
 *
 * Example queries:
 * - "What does the authentication module do?"
 * - "Who created the payment service?"
 * - "What decisions were made about the database?"
 */

import { generateText, Output, type LanguageModel } from 'ai';
import { createLogger, toErrorMessage } from '@codegraph/logger';
import { GraphAnswerSchema, type GraphAnswer, withRetry } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
} from '../types';
import { hybridSearch, type HybridSearchOptions } from '../../hybridSearch';
import { isNoOutputError } from './utils';

const logger = createLogger({ namespace: 'core:search:graph-answer' });

export class GraphAnswerStrategy implements SearchStrategy {
  readonly type = 'GRAPH_ANSWER' as const;
  readonly description =
    'Answers questions by searching the graph for context, then synthesizing an answer with LLM';
  readonly requiresLLM = true;

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    if (!context.llm && !context.complexLlm) {
      throw new Error('GRAPH_ANSWER requires an LLM');
    }

    // Step 1: Hybrid search to find relevant nodes
    const hybridOpts: HybridSearchOptions = {
      limit: request.limit ?? 15,
      includeKnowledge: true,
      expandGraph: true,
      maxHops: 1,
      includeAboutEdges: true,
    };
    if (context.embeddings) hybridOpts.embeddings = context.embeddings;
    if (request.scope) hybridOpts.scope = request.scope;

    const hybridResult = await hybridSearch(request.query, context.client, hybridOpts);

    const results: SearchResultItem[] = hybridResult.hits.map((hit) => {
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

    // Step 2: Gather context from top hits
    const contextText = this.buildContextFromHits(hybridResult, request.query);

    // Step 3: Generate answer using LLM (with fallback from complex → default)
    const modelsToTry: LanguageModel[] = [];
    if (context.complexLlm) modelsToTry.push(context.complexLlm);
    if (context.llm && context.llm !== context.complexLlm) modelsToTry.push(context.llm);
    if (modelsToTry.length === 0 && context.llm) modelsToTry.push(context.llm);

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i]!;
      const isLastModel = i === modelsToTry.length - 1;

      try {
        const { output: answer } = (await withRetry(() => generateText({
          model,
          output: Output.object({ schema: GraphAnswerSchema }),
          system: this.ANSWER_SYSTEM_PROMPT,
          prompt: this.buildAnswerPrompt(request.query, contextText),
          temperature: 0.2,
          maxOutputTokens: 1000,
        }))) as { output: GraphAnswer };

        return {
          results,
          answer: answer.answer,
          answerConfidence: answer.confidence,
          answerSources: answer.sources,
          total: results.length,
          meta: {
            searchType: 'GRAPH_ANSWER',
            durationMs: 0, // filled by registry
            vectorHits: hybridResult.meta.vectorHits,
            textHits: hybridResult.meta.textHits,
            contextNodes: hybridResult.hits.length,
            ...(i > 0 ? { fallbackUsed: true } : {}),
          },
        };
      } catch (error) {
        if (isNoOutputError(error)) {
          logger.warn('GRAPH_ANSWER: LLM failed to generate structured answer');
          if (isLastModel) {
            return {
              results,
              answer: 'Unable to generate an answer from the available context.',
              answerConfidence: 0,
              total: results.length,
              meta: {
                searchType: 'GRAPH_ANSWER',
                durationMs: 0,
                error: 'LLM parse failure',
              },
            };
          }
          // Try next model
          continue;
        }

        // For other errors (API failures, rate limits, auth), try fallback
        if (!isLastModel) {
          const msg = toErrorMessage(error);
          logger.warn(`GRAPH_ANSWER: Model failed (${msg}), trying fallback model`);
          continue;
        }
        throw error;
      }
    }

    // Should not reach here, but just in case
    return {
      results,
      answer: 'Unable to generate an answer.',
      answerConfidence: 0,
      total: results.length,
      meta: { searchType: 'GRAPH_ANSWER', durationMs: 0, error: 'No models available' },
    };
  }

  private buildContextFromHits(
    result: Awaited<ReturnType<typeof hybridSearch>>,
    _query: string,
  ): string {
    const lines: string[] = [];

    // Code nodes
    for (const hit of result.hits.slice(0, 10)) {
      if (hit.nodeType === 'Entity') {
        // Knowledge entity
        const entityType = hit.properties['type'] ?? 'Concept';
        lines.push(`[Knowledge: ${entityType}] ${hit.name}`);
        if (hit.properties['sampleId']) {
          lines.push(`  Source: ${hit.properties['sampleId']}`);
        }
      } else {
        // Code node
        const loc = hit.filePath ? ` (${hit.filePath}:${hit.startLine ?? '?'})` : '';
        lines.push(`[${hit.nodeType}] ${hit.name}${loc}`);
        if (hit.properties['docstring']) {
          lines.push(`  Doc: ${String(hit.properties['docstring']).slice(0, 200)}`);
        }
        if (hit.properties['signature']) {
          lines.push(`  Sig: ${String(hit.properties['signature']).slice(0, 200)}`);
        }
      }
    }

    // Related nodes (graph-expanded neighbors, CONTAINS, IMPORTS, etc.)
    for (const rel of result.related.slice(0, 25)) {
      const loc = rel.filePath ? ` (${rel.filePath})` : '';
      lines.push(`[Related: ${rel.edgeLabel}] ${rel.name} (${rel.nodeType})${loc}`);
    }

    return lines.join('\n');
  }

  /** System prompt: role, instructions, and few-shot examples */
  private readonly ANSWER_SYSTEM_PROMPT = `You are a code assistant that answers questions about a software codebase using graph-structured context (nodes and relationships).

## Instructions:
- Use ONLY the information from the provided graph context to answer the question.
- If the context doesn't contain enough information, say so honestly.
- Include specific names, file paths, and relationships when available.
- Reference node types (Function, Class, File, etc.) to ground your answer.
- Cite relationship edges (CALLS, IMPORTS, CONTAINS, etc.) when explaining how things connect.

## Examples:

Question: "What does the SearchRegistry do?"
Context: [Class] SearchRegistry (src/search/registry.ts), [Function] register, [Function] search, SearchRegistry --[HAS_METHOD]--> register, SearchRegistry --[HAS_METHOD]--> search
Answer: The SearchRegistry class (in src/search/registry.ts) manages search strategies. It has two key methods: register() for adding strategies and search() for dispatching queries to the appropriate strategy.

Question: "What files handle authentication?"
Context: [File] auth.ts (src/auth.ts), [File] middleware.ts (src/middleware.ts), [Function] validateToken, auth.ts --[CONTAINS]--> validateToken, middleware.ts --[IMPORTS]--> auth.ts
Answer: Authentication is handled by two files: auth.ts (src/auth.ts) which contains the validateToken() function, and middleware.ts (src/middleware.ts) which imports auth.ts to use its authentication logic in the middleware pipeline.`;

  /** User prompt: context + question */
  private buildAnswerPrompt(query: string, context: string): string {
    return `## Graph Context (nodes and relationships found in the codebase)
${context}

## Question
${query}`;
  }
}
