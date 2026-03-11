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

import { generateObject, NoObjectGeneratedError } from 'ai';
import { createLogger } from '@codegraph/logger';
import { GraphAnswerSchema, type GraphAnswer } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
} from '../types';
import { hybridSearch, type HybridSearchOptions } from '../../hybridSearch';

const logger = createLogger({ namespace: 'core:search:graph-answer' });

export class GraphAnswerStrategy implements SearchStrategy {
  readonly type = 'GRAPH_ANSWER' as const;
  readonly description =
    'Answers questions by searching the graph for context, then synthesizing an answer with LLM';
  readonly requiresLLM = true;

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    if (!context.llm) {
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

    // Step 3: Generate answer using LLM
    try {
      const { object: answer } = (await generateObject({
        model: context.llm,
        schema: GraphAnswerSchema,
        prompt: this.buildAnswerPrompt(request.query, contextText),
        temperature: 0.2,
      })) as { object: GraphAnswer };

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
        },
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn('GRAPH_ANSWER: LLM failed to generate structured answer');
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
      throw error;
    }
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

  private buildAnswerPrompt(query: string, context: string): string {
    return `You are a code assistant that answers questions about a software codebase.
Use ONLY the information from the graph context below to answer the question.
If the context doesn't contain enough information, say so honestly.

## Graph Context (nodes and relationships found in the codebase)
${context}

## Question
${query}

Answer the question based on the graph context. Include specific names, file paths, and relationships when available.`;
  }
}
