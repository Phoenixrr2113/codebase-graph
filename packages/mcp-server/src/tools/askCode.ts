/**
 * MCP Tool: ask_code
 *
 * Answers natural language questions about the codebase using GRAPH_ANSWER strategy.
 * Delegates to codeGraphService.strategySearch() with GRAPH_ANSWER type.
 *
 * Examples:
 *   "What does the authentication module do?"
 *   "Who created the payment service?"
 *   "What decisions were made about the database?"
 *
 * Requires an LLM provider (OPENROUTER_API_KEY or Ollama).
 */

import { codeGraphService } from '@codegraph/core';
import type { SearchResultItem } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// ============================================================================
// Input / Output Types
// ============================================================================

export interface AskCodeInput {
  /** The question to ask about the codebase */
  question: string;
  /** File path scope filter */
  scope?: string;
  /** Maximum context results to consider */
  limit?: number;
}

export interface AskCodeOutput {
  /** LLM-generated answer */
  answer: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Sources that informed the answer */
  sources?: Array<{ nodeType: string; name: string; relevance: string }>;
  /** Code/knowledge nodes found during search */
  contextNodes: Array<{
    name: string;
    kind: string;
    file?: string;
    line?: number;
    score: number;
  }>;
  /** Total context nodes found */
  total: number;
  /** Search metadata */
  meta?: {
    searchType: string;
    durationMs: number;
    vectorHits?: number;
    textHits?: number;
  };
  /** Error message (if search failed gracefully) */
  error?: string;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const askCodeToolDefinition: ToolDefinition = {
  name: 'ask_code',
  description:
    'Ask a natural language question about the codebase and get an AI-synthesized answer. ' +
    'Uses hybrid search to find relevant code nodes and knowledge entities, then an LLM ' +
    'synthesizes an answer from the context. Best for: "What does X do?", "How does Y work?", ' +
    '"Who created Z?". Requires an LLM provider (OpenRouter or Ollama).',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Natural language question about the codebase',
      },
      scope: {
        type: 'string',
        description: 'Limit search to specific scope (file path prefix)',
      },
      limit: {
        type: 'number',
        default: 15,
        description: 'Maximum context results to consider (default: 15)',
      },
    },
    required: ['question'],
  },
};

// ============================================================================
// Handler
// ============================================================================

export async function askCode(input: AskCodeInput): Promise<AskCodeOutput> {
  try {
    if (!input.question || input.question.trim() === '') {
      return {
        answer: '',
        confidence: 0,
        contextNodes: [],
        total: 0,
        error: 'Question is required',
      };
    }

    // Delegate to service layer — strategySearch handles LLM availability internally
    const opts: Parameters<typeof codeGraphService.strategySearch>[2] = {
      limit: input.limit ?? 15,
    };
    if (input.scope) opts.scope = input.scope;

    const response = await codeGraphService.strategySearch(
      input.question,
      'GRAPH_ANSWER',
      opts,
    );

    // Check if the strategy failed due to missing LLM
    if (response.error && response.error.includes('LLM')) {
      return {
        answer: '',
        confidence: 0,
        contextNodes: [],
        total: 0,
        error:
          'LLM provider is required for ask_code. Set OPENROUTER_API_KEY in your environment, ' +
          'or configure Ollama (LLM_PROVIDER=ollama).',
      };
    }

    const contextNodes = response.results.map((r: SearchResultItem) => {
      const node: AskCodeOutput['contextNodes'][number] = {
        name: r.name,
        kind: r.nodeType.toLowerCase(),
        score: r.score,
      };
      if (r.filePath) node.file = r.filePath;
      if (r.startLine != null) node.line = r.startLine;
      return node;
    });

    const meta: NonNullable<AskCodeOutput['meta']> = {
      searchType: 'GRAPH_ANSWER',
      durationMs: response.meta.durationMs,
    };
    if (typeof response.meta['vectorHits'] === 'number') meta.vectorHits = response.meta['vectorHits'];
    if (typeof response.meta['textHits'] === 'number') meta.textHits = response.meta['textHits'];

    const output: AskCodeOutput = {
      answer: response.answer ?? 'No answer could be generated from the available context.',
      confidence: response.answerConfidence ?? 0,
      contextNodes,
      total: response.total,
      meta,
    };
    if (response.answerSources) output.sources = response.answerSources;
    if (response.error) output.error = response.error;
    return output;
  } catch (error) {
    return {
      answer: '',
      confidence: 0,
      contextNodes: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Unknown error during ask_code',
    };
  }
}
