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
  description: `Store and recall knowledge — decisions, entities, relationships, and conversations.

**Actions:**
- **store**: Store knowledge in the graph. Auto-detects what to store based on params:
  - Entity: { action: "store", text: "Use FalkorDB", type: "Decision" }
  - Relationship: { action: "store", headText: "CodeGraph", headType: "Project", tailText: "FalkorDB", tailType: "Technology", type: "USES" }
  - Extract from text (LLM): { action: "store", text: "We decided to use JWT for auth", extract: true }
  - Ingest conversation (LLM): { action: "store", text: "Alice: Use Redis\\nBob: Agreed", format: "chat" }

- **recall**: Retrieve knowledge from the graph:
  - By entity: { action: "recall", text: "CodeGraph" }
  - By type: { action: "recall", type: "Decision", limit: 10 }
  - Semantic search: { action: "recall", text: "authentication decisions", semantic: true }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['store', 'recall'],
        description: 'store = put knowledge in, recall = get knowledge out',
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
      source: { type: 'string', description: 'Provenance label' },
      // Recall
      textContains: { type: 'string', description: 'Substring match filter' },
      semanticQuery: { type: 'string', description: 'Natural language semantic search' },
      relationType: { type: 'string', description: 'Filter by relationship type' },
      limit: { type: 'number', description: 'Max results (default: 20)' },
      includeHistory: { type: 'boolean', description: 'Include invalidated facts' },
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

export async function handleKnowledge(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const start = Date.now();

  let handlerName: string;

  if (action === 'store') {
    handlerName = detectStoreHandler(args);
  } else if (action === 'recall') {
    handlerName = detectRecallHandler(args);
  } else {
    return { error: `Unknown knowledge action: ${action}. Use: store, recall` };
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
