/**
 * Search Type Registry — Types and Interfaces
 *
 * Defines the pluggable search strategy system for WS12.
 * All search types implement SearchStrategy and are registered
 * in the SearchRegistry.
 */

import type { LanguageModel } from 'ai';
import type { GraphClient } from '@codegraph/graph';
import type { EmbeddingConfig } from '@codegraph/plugin-nlp';

// ============================================================================
// Search Type Enum
// ============================================================================

/**
 * Supported search strategies.
 *
 * - ENRICHED_V2: Vector retrieval + cross-encoder reranking
 */
export type SearchType = 'ENRICHED_V2';

// ============================================================================
// Search Context — shared dependencies passed to all strategies
// ============================================================================

export interface SearchContext {
  /** Graph client for Cypher queries */
  client: GraphClient;
  /** LLM for answer generation, query translation, routing (optional for non-LLM types) */
  llm?: LanguageModel;
  /** Complex LLM for multi-step reasoning. Falls back to llm if not set. */
  complexLlm?: LanguageModel;
  /** Embedding config for vector search */
  embeddings?: EmbeddingConfig;
}

// ============================================================================
// Search Request — unified input for all search types
// ============================================================================

export interface SearchRequest {
  /** The natural language query */
  query: string;
  /** Which search strategy to use */
  type: SearchType;
  /** Maximum results to return (default: 20) */
  limit?: number;
  /** File path scope filter */
  scope?: string;
  /** Extra options passed to specific strategies */
  options?: Record<string, unknown>;
}

// ============================================================================
// Search Result — unified output for all search types
// ============================================================================

export interface SearchResultItem {
  /** Node/entity name */
  name: string;
  /** Node type (Function, Class, Entity, etc.) */
  nodeType: string;
  /** File path (code nodes only) */
  filePath?: string;
  /** Start line (code nodes only) */
  startLine?: number;
  /** Relevance score (0-1, higher = better) */
  score: number;
  /** How this result was found */
  sources: string[];
  /** Extra properties */
  properties?: Record<string, unknown>;
}

export interface SearchRelatedItem {
  /** Related node name */
  name: string;
  /** Related node type */
  nodeType: string;
  /** File path (if code node) */
  filePath?: string;
  /** Edge label (CALLS, IMPORTS, ABOUT, etc.) */
  edgeLabel: string;
  /** Direction of the relationship */
  direction: 'outgoing' | 'incoming';
  /** Source hit this is related to */
  sourceHit: string;
}

export interface SearchResponse {
  /** Ranked result items */
  results: SearchResultItem[];
  /** Related nodes (from graph traversal) */
  related?: SearchRelatedItem[];
  /** LLM-generated answer (if applicable) */
  answer?: string;
  /** Confidence in the answer (0-1) */
  answerConfidence?: number;
  /** Answer sources (which nodes informed the answer) */
  answerSources?: Array<{ nodeType: string; name: string; relevance: string }>;
  /** Generated Cypher query (if applicable) */
  cypher?: string;
  /** Cypher query explanation (if applicable) */
  cypherExplanation?: string;
  /** How the query was routed (if applicable) */
  routedTo?: SearchType;
  /** Routing reasoning (if applicable) */
  routingReason?: string;
  /** Total result count */
  total: number;
  /** Search metadata */
  meta: {
    searchType: SearchType;
    durationMs: number;
    /** Additional strategy-specific metadata */
    [key: string]: unknown;
  };
  /** Error message (if search failed gracefully) */
  error?: string;
}

// ============================================================================
// Search Strategy Interface — implemented by each search type
// ============================================================================

export interface SearchStrategy {
  /** Unique identifier */
  readonly type: SearchType;
  /** Human-readable description */
  readonly description: string;
  /** Whether this strategy requires an LLM */
  readonly requiresLLM: boolean;

  /**
   * Execute the search strategy.
   *
   * @param request - The search request
   * @param context - Shared search context (client, llm, embeddings)
   * @returns Search response with results and optional answer
   */
  search(request: SearchRequest, context: SearchContext): Promise<SearchResponse>;
}
