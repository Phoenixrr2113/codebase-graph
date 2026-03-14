/**
 * Knowledge Graph MCP Tools
 *
 * 7 tools for persistent knowledge graph memory:
 *
 * - store_entity:       Create/upsert an entity
 * - store_relationship:  Create a relationship between entities
 * - store_fact:          Extract entities/relationships from text via LLM and store
 * - query_knowledge:     Search entities by type, text, or both
 * - recall:              Get all relationships for an entity ("what do I know about X?")
 * - decay_and_prune:     Run temporal decay + prune stale entities
 * - get_knowledge_stats: Memory statistics (counts, relevance, age)
 */

import { knowledgeService, getKnowledgeOps } from '@codegraph/core';
import { generateEmbedding, isEmbeddingAvailable } from '@codegraph/plugin-nlp';
import { createLogger, toErrorMessage } from '@codegraph/logger';
import type { ToolDefinition } from './consolidated';

const logger = createLogger({ namespace: 'MCP:Knowledge' });

// ============================================================================
// Tool Definitions
// ============================================================================

export const storeEntityToolDefinition: ToolDefinition = {
  name: 'store_entity',
  description: 'Store an entity in the knowledge graph. Deduplicates by text+type — if an entity with the same text and type exists, it is updated instead of duplicated.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Entity text/name (e.g., "Randy", "Project Alpha", "Use Kuzu for storage")',
      },
      type: {
        type: 'string',
        description: 'Entity type. Common types: Person, Organization, Project, Document, Decision, Convention, Observation, Lesson, Concept, Task, Goal, Constraint, Event, Resource, Technology, Dependency, Service, Pattern, Bug, TechnicalDebt, CodeEntity, Requirement. You may also use custom types when these don\'t fit.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-1 (default: 0.9)',
      },
      properties: {
        type: 'object',
        description: 'Optional additional properties as key-value pairs',
      },
    },
    required: ['text', 'type'],
  },
};

export const storeRelationshipToolDefinition: ToolDefinition = {
  name: 'store_relationship',
  description: 'Store a relationship between two entities in the knowledge graph. Entities are referenced by text+type and auto-created if they don\'t exist. Deduplicates existing relationships.',
  inputSchema: {
    type: 'object',
    properties: {
      headText: {
        type: 'string',
        description: 'Source entity text (e.g., "Randy")',
      },
      headType: {
        type: 'string',
        description: 'Source entity type (e.g., "Person")',
      },
      tailText: {
        type: 'string',
        description: 'Target entity text (e.g., "Use Kuzu")',
      },
      tailType: {
        type: 'string',
        description: 'Target entity type (e.g., "Decision")',
      },
      type: {
        type: 'string',
        description: 'Relationship type. Common types: RELATES_TO, PART_OF, CONTAINS, DEPENDS_ON, USES, REQUIRES, CREATED, OWNS, WORKS_FOR, KNOWS, CAUSED_BY, LED_TO, SOLVES, BLOCKS, ENABLES, SUPERSEDES, EVOLVED_FROM, DECIDED, SUPPORTS, CONTRADICTS, APPLIES, DOCUMENTED_IN, LEARNED_FROM. You may also use custom types when these don\'t fit.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-1 (default: 0.9)',
      },
      fact: {
        type: 'string',
        description: 'Optional human-readable fact describing this relationship',
      },
    },
    required: ['headText', 'headType', 'tailText', 'tailType', 'type'],
  },
};

export const storeFactToolDefinition: ToolDefinition = {
  name: 'store_fact',
  description: 'Extract entities and relationships from natural language text using an LLM, then store them in the knowledge graph. Requires an LLM provider (CEREBRAS_API_KEY or OPENROUTER_API_KEY). Use this to remember information from conversations, documents, or any unstructured text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Natural language text to extract knowledge from (e.g., "Randy decided to use Kuzu for graph storage because it supports vector search")',
      },
      model: {
        type: 'string',
        description: 'LLM model to use for extraction (default: auto-selected based on provider)',
      },
    },
    required: ['text'],
  },
};

export const queryKnowledgeToolDefinition: ToolDefinition = {
  name: 'query_knowledge',
  description:
    'Search the knowledge graph for entities. Filter by type, text content, or use ' +
    'semantic search to find entities by meaning. Returns matching entities with their ' +
    'confidence and relevance scores.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Filter by entity type (e.g., "Person", "Decision", "Project")',
      },
      textContains: {
        type: 'string',
        description: 'Filter by text content (case-sensitive substring match)',
      },
      semanticQuery: {
        type: 'string',
        description:
          'Natural language query for semantic search — finds entities by meaning, ' +
          'not just exact text. Requires embeddings to be available.',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 20)',
      },
    },
  },
};

export const recallToolDefinition: ToolDefinition = {
  name: 'recall',
  description: 'Recall everything known about an entity — returns all currently-valid relationships where the entity appears as head or tail. Like asking "what do I know about X?" By default, superseded/invalidated facts are excluded. Set includeHistory=true to see the full timeline including invalidated facts.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Entity text to recall (e.g., "Randy", "Project Alpha")',
      },
      type: {
        type: 'string',
        description: 'Optional entity type filter',
      },
      relationType: {
        type: 'string',
        description: 'Optional relationship type filter (e.g., "DECIDED", "CREATED")',
      },
      limit: {
        type: 'number',
        description: 'Maximum relationships to return (default: 50)',
      },
      includeHistory: {
        type: 'boolean',
        description: 'If true, also return invalidated/superseded facts (default: false — only current facts)',
      },
    },
    required: ['text'],
  },
};

export const decayAndPruneToolDefinition: ToolDefinition = {
  name: 'decay_and_prune',
  description: 'Run temporal memory maintenance: decay relevance scores for old entities and optionally prune entities below the threshold. Keeps the knowledge graph fresh by deprioritizing stale information.',
  inputSchema: {
    type: 'object',
    properties: {
      prune: {
        type: 'boolean',
        description: 'If true, also delete entities with relevance below threshold (default: false — decay only)',
      },
      decayRate: {
        type: 'number',
        description: 'Decay rate per run, e.g. 0.013 = 1.3% (default: 0.013)',
      },
      minRelevance: {
        type: 'number',
        description: 'Minimum relevance threshold for pruning (default: 0.1)',
      },
    },
  },
};

export const ingestConversationToolDefinition: ToolDefinition = {
  name: 'ingest_conversation',
  description:
    'Ingest a multi-turn conversation into the knowledge graph. Runs the full episodic pipeline: ' +
    'chunk into episodes → extract entities/relationships per episode with sliding context for ' +
    'pronoun resolution → store with embeddings → deduplicate via entity resolution. ' +
    'Handles chat transcripts, meeting notes, Slack threads, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description:
          'Full conversation text. Supports multiple formats:\n' +
          '- Chat: "Alice: hello\\nBob: hi there"\n' +
          '- Timestamped: "[2024-01-15 09:00] Alice: hello"\n' +
          '- Paragraphs: plain text separated by blank lines\n' +
          '- Auto-detected if format is not specified',
      },
      format: {
        type: 'string',
        description: 'Conversation format: "chat", "timestamped", "paragraphs", or "auto" (default: "auto")',
      },
      source: {
        type: 'string',
        description: 'Optional source label for provenance tracking (e.g., "slack-engineering", "meeting-2024-01-15")',
      },
      model: {
        type: 'string',
        description: 'Optional LLM model override for extraction (default: auto-selected based on provider)',
      },
    },
    required: ['text'],
  },
};

export const getKnowledgeStatsToolDefinition: ToolDefinition = {
  name: 'get_knowledge_stats',
  description: 'Get statistics about the knowledge graph: total entities, average relevance, low-relevance count, oldest/newest access timestamps.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

// ============================================================================
// All tool definitions for registration
// ============================================================================

export const knowledgeToolDefinitions: ToolDefinition[] = [
  storeEntityToolDefinition,
  storeRelationshipToolDefinition,
  storeFactToolDefinition,
  ingestConversationToolDefinition,
  queryKnowledgeToolDefinition,
  recallToolDefinition,
  decayAndPruneToolDefinition,
  getKnowledgeStatsToolDefinition,
];

// ============================================================================
// Tool Handlers
// ============================================================================

export async function handleStoreEntity(args: Record<string, unknown>) {
  try {
    const opts: { confidence?: number; properties?: Record<string, unknown> } = {};
    if (args.confidence != null) opts.confidence = args.confidence as number;
    if (args.properties != null) opts.properties = args.properties as Record<string, unknown>;
    const result = await knowledgeService.storeEntity(args.text as string, args.type as string, opts);
    return { stored: true, ...result };
  } catch (error) {
    logger.error('store_entity failed', error);
    return { error: toErrorMessage(error) };
  }
}

export async function handleStoreRelationship(args: Record<string, unknown>) {
  try {
    const opts: { confidence?: number; fact?: string } = {};
    if (args.confidence != null) opts.confidence = args.confidence as number;
    if (args.fact != null) opts.fact = args.fact as string;
    return await knowledgeService.storeRelationship(
      args.headText as string, args.headType as string,
      args.tailText as string, args.tailType as string,
      args.type as string, opts,
    );
  } catch (error) {
    logger.error('store_relationship failed', error);
    return { error: toErrorMessage(error) };
  }
}

export async function handleStoreFact(args: Record<string, unknown>) {
  try {
    // Dynamic import to avoid requiring @codegraph/plugin-nlp when not using this tool
    const { extractAndStore } = await import('@codegraph/plugin-nlp');
    const opts: { model?: string } = {};
    if (args.model != null) opts.model = args.model as string;
    return await knowledgeService.storeFact(args.text as string, extractAndStore, opts);
  } catch (error) {
    const msg = toErrorMessage(error);
    if (msg.includes('API key') || msg.includes('API_KEY') || msg.includes('not configured')) {
      return { error: 'LLM provider is not configured. Set CEREBRAS_API_KEY (recommended) or OPENROUTER_API_KEY to use LLM extraction.' };
    }
    logger.error('store_fact failed', error);
    return { error: msg };
  }
}

export async function handleQueryKnowledge(args: Record<string, unknown>) {
  try {
    const limit = (args.limit as number | undefined) ?? 20;

    // Semantic search path: embed the query and search by vector
    if (args.semanticQuery != null && isEmbeddingAvailable()) {
      const semanticQuery = args.semanticQuery as string;
      try {
        const { embedding } = await generateEmbedding(semanticQuery);
        const kgOps = await getKnowledgeOps();
        const vectorResults = await kgOps.searchEntitiesByVector(embedding, limit);

        // Also do text search if textContains was provided
        let textResults: typeof vectorResults = [];
        if (args.textContains != null || args.type != null) {
          const textQuery: { type?: string; textContains?: string; limit?: number } = { limit };
          if (args.type != null) textQuery.type = args.type as string;
          if (args.textContains != null) textQuery.textContains = args.textContains as string;
          textResults = await knowledgeService.queryKnowledge(textQuery);
        }

        // Merge results (dedup by id)
        const seen = new Set<string>();
        const merged = [];
        for (const e of vectorResults) {
          seen.add(e.id);
          merged.push({
            id: e.id,
            text: e.text,
            type: e.type,
            confidence: e.confidence,
            relevance: e.relevanceScore,
            createdAt: new Date(e.createdAt).toISOString(),
            lastAccessed: new Date(e.lastAccessedAt).toISOString(),
            source: 'semantic' as const,
          });
        }
        for (const e of textResults) {
          if (!seen.has(e.id)) {
            merged.push({
              id: e.id,
              text: e.text,
              type: e.type,
              confidence: e.confidence,
              relevance: e.relevanceScore,
              createdAt: new Date(e.createdAt).toISOString(),
              lastAccessed: new Date(e.lastAccessedAt).toISOString(),
              source: 'text' as const,
            });
          }
        }

        return { count: merged.length, entities: merged.slice(0, limit), semantic: true };
      } catch (err) {
        logger.warn(`Semantic search failed, falling back to text: ${err}`);
        // Fall through to text search below
      }
    }

    // Text search path (default)
    const query: { type?: string; textContains?: string; limit?: number } = { limit };
    if (args.type != null) query.type = args.type as string;
    if (args.textContains != null) query.textContains = args.textContains as string;
    const results = await knowledgeService.queryKnowledge(query);

    return {
      count: results.length,
      entities: results.map(e => ({
        id: e.id,
        text: e.text,
        type: e.type,
        confidence: e.confidence,
        relevance: e.relevanceScore,
        createdAt: new Date(e.createdAt).toISOString(),
        lastAccessed: new Date(e.lastAccessedAt).toISOString(),
      })),
    };
  } catch (error) {
    logger.error('query_knowledge failed', error);
    return { error: toErrorMessage(error) };
  }
}

export async function handleRecall(args: Record<string, unknown>) {
  try {
    const opts: { type?: string; relationType?: string; limit?: number; includeHistory?: boolean } = {};
    if (args.type != null) opts.type = args.type as string;
    if (args.relationType != null) opts.relationType = args.relationType as string;
    if (args.limit != null) opts.limit = args.limit as number;
    if (args.includeHistory != null) opts.includeHistory = args.includeHistory as boolean;
    return await knowledgeService.recall(args.text as string, opts);
  } catch (error) {
    logger.error('recall failed', error);
    return { error: toErrorMessage(error) };
  }
}

export async function handleDecayAndPrune(args: Record<string, unknown>) {
  try {
    const opts: { prune?: boolean; decayRate?: number; minRelevance?: number } = {};
    if (args.prune != null) opts.prune = args.prune as boolean;
    if (args.decayRate != null) opts.decayRate = args.decayRate as number;
    if (args.minRelevance != null) opts.minRelevance = args.minRelevance as number;
    const result = await knowledgeService.decayAndPrune(opts);
    return {
      ...result,
      message: `Decayed ${result.decayed} entities${args.prune ? `, pruned ${result.pruned}` : ''}`,
    };
  } catch (error) {
    logger.error('decay_and_prune failed', error);
    return { error: toErrorMessage(error) };
  }
}

export async function handleIngestConversation(args: Record<string, unknown>): Promise<unknown> {
  try {
    const text = args.text as string;
    if (!text || text.trim().length === 0) {
      return { error: 'Conversation text is required' };
    }

    // Dynamic import to avoid requiring @codegraph/plugin-nlp when not using this tool
    const nlp = await import('@codegraph/plugin-nlp');
    const opts: { format?: string; source?: string; model?: string } = {};
    if (args.format != null) opts.format = args.format as string;
    if (args.source != null) opts.source = args.source as string;
    if (args.model != null) opts.model = args.model as string;

    // Wrap ingestConversation to match IngestConversationFn signature
    const ingestFn = async (
      t: string,
      ops: Parameters<typeof nlp.ingestConversation>[1],
      config?: { format?: string; source?: string; model?: string; contextWindow?: number },
    ) => {
      return nlp.ingestConversation(t, ops, config);
    };

    return await knowledgeService.ingestConversation(text, ingestFn, opts);
  } catch (error) {
    const msg = toErrorMessage(error);
    if (msg.includes('API key') || msg.includes('API_KEY') || msg.includes('not configured')) {
      return { error: 'LLM provider is not configured. Set CEREBRAS_API_KEY (recommended) or OPENROUTER_API_KEY to use LLM extraction.' };
    }
    logger.error('ingest_conversation failed', error);
    return { error: msg };
  }
}

export async function handleGetKnowledgeStats() {
  try {
    return await knowledgeService.getKnowledgeStats();
  } catch (error) {
    logger.error('get_knowledge_stats failed', error);
    return { error: toErrorMessage(error) };
  }
}

// ============================================================================
// Handler map (for consolidated.ts)
// ============================================================================

export const knowledgeHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  store_entity: handleStoreEntity,
  store_relationship: handleStoreRelationship,
  store_fact: handleStoreFact,
  ingest_conversation: handleIngestConversation,
  query_knowledge: handleQueryKnowledge,
  recall: handleRecall,
  decay_and_prune: handleDecayAndPrune,
  get_knowledge_stats: handleGetKnowledgeStats,
};
