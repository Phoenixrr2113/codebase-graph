/**
 * Knowledge Persona — Simplified to store + recall
 *
 * store: Put knowledge in (entities, relationships, facts, conversations)
 * recall: Get knowledge out (semantic search, query, relationship traversal)
 */

import type { ToolDefinition } from '../tools/router';
import { knowledgeHandlers } from '../tools/knowledge';
import { clampLimit } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Knowledge' });

export const knowledgePersonaDefinition: ToolDefinition = {
  name: 'knowledge',
  description: `Store and recall knowledge - decisions, entities, relationships, and conversations.

**Actions:**
- **store**: Store knowledge in the graph. Auto-detects what to store based on params:
  - Entity: { action: "store", text: "Use FalkorDB", type: "Decision" }
  - Relationship: { action: "store", headText: "CodeGraph", headType: "Project", tailText: "FalkorDB", tailType: "Technology", type: "USES" }
  - Extract from text (LLM): { action: "store", text: "We decided to use JWT for auth", extract: true }
  - Ingest conversation (LLM): { action: "store", text: "Alice: Use Redis\\nBob: Agreed", format: "chat" }

- **add**: Ingest a document, URL, or raw text (auto-chunked, entities extracted via LLM):
  - From a file: { action: "add", input: "/path/to/spec.pdf", source: "product-spec-v2" }
  - From a URL: { action: "add", input: "https://docs.example.com/api", source: "api-docs" }

- **recall**: Retrieve knowledge from the graph:
  - By entity: { action: "recall", text: "CodeGraph" }
  - By type: { action: "recall", type: "Decision", limit: 10 }
  - Semantic search: { action: "recall", semanticQuery: "authentication decisions" }
  - Point-in-time: { action: "recall", text: "payment system", at: "2026-01-15T00:00:00Z" }
  - By speaker: { action: "recall", text: "anything", speaker: "Alice" }

- **query_knowledge**: Search entities directly by type, text, source, or fact meaning:
  - By fact meaning: { action: "query_knowledge", searchFacts: "who decided to use JWT?" }
  - By provenance: { action: "query_knowledge", source: "meeting-2024-01-15" }

- **ingest_conversation**: Ingest a multi-turn conversation with speaker attribution (LLM):
  - { action: "ingest_conversation", text: "Alice: let's use Redis\\nBob: agreed", source: "standup" }

- **resolve_entities**: Run on-demand entity deduplication (3-tier: exact, embedding, LLM):
  - { action: "resolve_entities" }

- **decay_and_prune**: Temporal maintenance - decay relevance scores, optionally prune stale entities:
  - { action: "decay_and_prune", prune: true, minRelevance: 0.1 }

- **get_knowledge_stats**: Memory statistics (entity counts, relevance, access times):
  - { action: "get_knowledge_stats" }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'store',
          'add',
          'recall',
          'query_knowledge',
          'ingest_conversation',
          'resolve_entities',
          'decay_and_prune',
          'get_knowledge_stats',
        ],
        description: 'store = put knowledge in, recall = get knowledge out, add = ingest a document/URL/text, query_knowledge = search entities directly, ingest_conversation = ingest a transcript directly, resolve_entities = dedupe entities, decay_and_prune = temporal memory maintenance, get_knowledge_stats = memory statistics',
      },
      // Common
      text: { type: 'string', description: 'Entity text, fact text, conversation, or recall query' },
      type: { type: 'string', description: 'Entity type (Person, Project, Decision, Concept, etc.) or relationship type' },
      // Store: entity
      confidence: { type: 'number', description: 'Confidence score 0-1 (default: 0.9)' },
      properties: { type: 'object', description: 'Additional key-value properties' },
      // Store: relationship
      headText: { type: 'string', description: 'Source entity text' },
      headType: { type: 'string', description: 'Source entity type' },
      tailText: { type: 'string', description: 'Target entity text' },
      tailType: { type: 'string', description: 'Target entity type' },
      fact: { type: 'string', description: 'Human-readable relationship description' },
      // Store: extract / ingest
      extract: { type: 'boolean', description: 'Extract entities from text via LLM' },
      format: {
        type: 'string',
        enum: ['chat', 'timestamped', 'paragraphs', 'auto'],
        description: 'Conversation format (triggers conversation ingestion)',
      },
      source: { type: 'string', description: 'Provenance label (store/add/ingest_conversation) or provenance filter (query_knowledge)' },
      model: { type: 'string', description: 'LLM model override for extraction (used by store extract, add, ingest_conversation)' },
      // Recall
      textContains: { type: 'string', description: 'Substring match filter' },
      semanticQuery: { type: 'string', description: 'Natural language semantic search' },
      relationType: { type: 'string', description: 'Filter by relationship type' },
      limit: { type: 'number', description: 'Max results (default: 20)' },
      includeHistory: { type: 'boolean', description: 'Include invalidated facts' },
      from: { type: 'string', description: 'ISO timestamp for range query start, used with `to` to find facts established or superseded in this period (recall)' },
      to: { type: 'string', description: 'ISO timestamp for range query end, used with `from` (recall)' },
      timeline: { type: 'boolean', description: 'If true, return the full chronological timeline of this entity including superseded facts (recall)' },
      speaker: { type: 'string', description: 'Query by speaker, returns entities mentioned by this person during conversation ingestion, e.g. "Alice" (recall)' },
      includeExpired: { type: 'boolean', description: 'If true, also return facts past their forgetAfter expiration timestamp (recall, default: false)' },
      // Add
      input: { type: 'string', description: 'File path, URL, or raw text to ingest (required for action: "add")' },
      inputType: {
        type: 'string',
        enum: ['file', 'url', 'text'],
        description: 'Override auto-detection for action: "add" (default: auto-detected)',
      },
      maxTokens: { type: 'number', description: 'Max tokens per chunk for action: "add" (default: 512)' },
      // Query_knowledge
      searchFacts: { type: 'string', description: 'Semantic search on relationship facts/explanations, e.g. "who decided to use JWT?" (query_knowledge)' },
      at: { type: 'string', description: 'ISO timestamp for point-in-time query. Standalone for recall (returns only facts valid at this moment); combined with semanticQuery for query_knowledge' },
      // Resolve_entities
      autoMergeThreshold: { type: 'number', description: 'Minimum similarity for automatic merge without LLM (resolve_entities, default: 0.95)' },
      candidateThreshold: { type: 'number', description: 'Minimum similarity to consider as an LLM-verification candidate (resolve_entities, default: 0.85)' },
      // Decay_and_prune
      prune: { type: 'boolean', description: 'If true, also delete entities below the relevance threshold (decay_and_prune, default: false)' },
      decayRate: { type: 'number', description: 'Decay rate per run, e.g. 0.013 = 1.3% (decay_and_prune, default: 0.013)' },
      minAge: { type: 'number', description: 'Minimum age in ms before decay starts (decay_and_prune, default: 604800000 = 7 days)' },
      minRelevance: { type: 'number', description: 'Minimum relevance threshold: pruning cutoff for decay_and_prune (default: 0.1), or relevance-weighted search filter for recall' },
    },
    required: ['action'],
  },
};

/**
 * Auto-detect which store handler to use based on params.
 */
function detectStoreHandler(args: Record<string, unknown>): string {
  if (args.format) return 'ingest_conversation';
  if (args.extract) return 'store_fact';
  if (args.headText && args.tailText) return 'store_relationship';
  return 'store_entity';
}

/**
 * Auto-detect which recall handler to use based on params.
 */
function detectRecallHandler(args: Record<string, unknown>): string {
  if (args.semanticQuery || args.textContains || (args.type && !args.text)) return 'query_knowledge';
  return 'recall';
}

/**
 * Actions that route straight through to the matching handler in
 * `knowledgeHandlers`, with no auto-detection needed (the action name
 * IS the handler name).
 */
const DIRECT_ACTIONS = new Set([
  'add',
  'query_knowledge',
  'ingest_conversation',
  'resolve_entities',
  'decay_and_prune',
  'get_knowledge_stats',
]);

export async function handleKnowledge(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const start = Date.now();

  let handlerName: string;

  if (action === 'store') {
    handlerName = detectStoreHandler(args);
  } else if (action === 'recall') {
    handlerName = detectRecallHandler(args);
  } else if (DIRECT_ACTIONS.has(action)) {
    handlerName = action;
  } else {
    return {
      error: `Unknown knowledge action: ${action}. Use: store, add, recall, query_knowledge, ingest_conversation, resolve_entities, decay_and_prune, get_knowledge_stats`,
    };
  }

  const handler = knowledgeHandlers[handlerName];
  if (!handler) {
    return { error: `Handler not found: ${handlerName}` };
  }

  const { action: _action, extract: _extract, ...forwardArgs } = args;
  if (forwardArgs.limit !== undefined) {
    forwardArgs.limit = clampLimit(forwardArgs.limit as number | undefined);
  }
  const result = await handler(forwardArgs);

  const durationMs = Date.now() - start;
  logger.debug('Knowledge persona completed', { action, handlerName, durationMs });

  return {
    ...(result as object),
    _meta: { action, toolUsed: handlerName, durationMs },
  };
}
