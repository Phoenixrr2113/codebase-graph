/**
 * Knowledge Persona — Knowledge graph CRUD and memory management
 *
 * Consolidates: store_entity, store_relationship, store_fact, query_knowledge,
 *               recall, decay_and_prune, ingest_conversation, get_knowledge_stats
 */

import type { ToolDefinition } from '../tools/consolidated';
import { knowledgeHandlers } from '../tools/knowledge';
import { clampLimit } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Knowledge' });

export const knowledgePersonaDefinition: ToolDefinition = {
  name: 'knowledge',
  description: `Manage the knowledge graph — store, query, recall, and maintain entities and relationships.

**Actions:**
- **store_entity**: Store/upsert an entity. Deduplicates by text+type.
  Params: text (required), type (required: Person, Project, Decision, Concept, etc.), confidence (0-1), properties (object)
- **store_relationship**: Store a relationship between two entities. Auto-creates entities if needed.
  Params: headText, headType, tailText, tailType, type (RELATES_TO, DEPENDS_ON, USES, DECIDED, etc.), confidence, fact
- **store_fact**: Extract entities/relationships from text via LLM and store.
  Params: text (required), model (optional)
- **query**: Search entities by type, text substring, or semantic meaning.
  Params: type (filter), textContains (substring), semanticQuery (NL), limit
- **recall**: Get all relationships for an entity ("what do I know about X?").
  Params: text (required), type, relationType, limit, includeHistory
- **maintain**: Run temporal memory maintenance (decay relevance, optionally prune).
  Params: prune (boolean), decayRate (default: 0.013), minRelevance (default: 0.1)
- **ingest**: Ingest multi-turn conversations (chat, meeting notes, Slack threads).
  Params: text (required), format (chat|timestamped|paragraphs|auto), source, model
- **stats**: Get knowledge graph statistics.
  Params: none

**Examples:**
- Store decision: { action: "store_entity", text: "Use FalkorDB", type: "Decision" }
- Recall about project: { action: "recall", text: "CodeGraph" }
- Query concepts: { action: "query", type: "Concept", limit: 10 }
- Ingest chat: { action: "ingest", text: "Alice: Let's use Redis\\nBob: Agreed", format: "chat" }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['store_entity', 'store_relationship', 'store_fact', 'query', 'recall', 'maintain', 'ingest', 'stats'],
        description: 'Knowledge graph operation to perform',
      },
      // store_entity params
      text: {
        type: 'string',
        description: 'Entity text/name (for store_entity, store_fact, recall, ingest)',
      },
      type: {
        type: 'string',
        description: 'Entity type (Person, Project, Decision, Concept, etc.)',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-1 (default: 0.9)',
      },
      properties: {
        type: 'object',
        description: 'Additional key-value properties for entity',
      },
      // store_relationship params
      headText: { type: 'string', description: 'Source entity text' },
      headType: { type: 'string', description: 'Source entity type' },
      tailText: { type: 'string', description: 'Target entity text' },
      tailType: { type: 'string', description: 'Target entity type' },
      fact: { type: 'string', description: 'Human-readable relationship description' },
      // query params
      textContains: { type: 'string', description: 'Substring match filter' },
      semanticQuery: { type: 'string', description: 'Natural language semantic search' },
      limit: { type: 'number', description: 'Max results (default: 20)' },
      // recall params
      relationType: { type: 'string', description: 'Filter by relationship type' },
      includeHistory: { type: 'boolean', description: 'Include invalidated facts' },
      // maintain params
      prune: { type: 'boolean', description: 'Delete entities below threshold' },
      decayRate: { type: 'number', description: 'Decay rate per run (default: 0.013)' },
      minRelevance: { type: 'number', description: 'Min relevance threshold (default: 0.1)' },
      // ingest params
      format: {
        type: 'string',
        enum: ['chat', 'timestamped', 'paragraphs', 'auto'],
        description: 'Conversation format',
      },
      source: { type: 'string', description: 'Provenance label' },
      model: { type: 'string', description: 'LLM model override' },
    },
    required: ['action'],
  },
};

// Map persona actions to raw tool handler names
const actionToHandler: Record<string, string> = {
  store_entity: 'store_entity',
  store_relationship: 'store_relationship',
  store_fact: 'store_fact',
  query: 'query_knowledge',
  recall: 'recall',
  maintain: 'decay_and_prune',
  ingest: 'ingest_conversation',
  stats: 'get_knowledge_stats',
};

export async function handleKnowledge(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const start = Date.now();

  const handlerName = actionToHandler[action];
  if (!handlerName) {
    return { error: `Unknown knowledge action: ${action}. Use: store_entity, store_relationship, store_fact, query, recall, maintain, ingest, stats` };
  }

  const handler = knowledgeHandlers[handlerName];
  if (!handler) {
    return { error: `Handler not found for action: ${action}` };
  }

  // Forward all args except 'action' to the raw handler, with clamped limit
  const { action: _action, ...forwardArgs } = args;
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
