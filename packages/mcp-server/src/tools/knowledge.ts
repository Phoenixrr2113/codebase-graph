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

import { getKnowledgeOps } from '../knowledgeClient';
import { createLogger } from '@codegraph/logger';
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
        description: 'Entity type: Person, Project, Task, Decision, Event, Document, Concept, Goal, Problem, Solution, Organization, CodeEntity, etc.',
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
        description: 'Relationship type: OWNS, CREATED, DECIDED, KNOWS, WORKS_FOR, DEPENDS_ON, LED_TO, SUPPORTS, CONTRADICTS, RELATED_TO, etc.',
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
  description: 'Extract entities and relationships from natural language text using an LLM, then store them in the knowledge graph. Requires OPENROUTER_API_KEY env var. Use this to remember information from conversations, documents, or any unstructured text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Natural language text to extract knowledge from (e.g., "Randy decided to use Kuzu for graph storage because it supports vector search")',
      },
      model: {
        type: 'string',
        description: 'OpenRouter model to use (default: google/gemini-2.5-flash-preview)',
      },
    },
    required: ['text'],
  },
};

export const queryKnowledgeToolDefinition: ToolDefinition = {
  name: 'query_knowledge',
  description: 'Search the knowledge graph for entities. Filter by type, text content, or both. Returns matching entities with their confidence and relevance scores.',
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
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 20)',
      },
    },
  },
};

export const recallToolDefinition: ToolDefinition = {
  name: 'recall',
  description: 'Recall everything known about an entity — returns all relationships where the entity appears as head or tail. Like asking "what do I know about X?"',
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
    const ops = await getKnowledgeOps();
    const entity: { text: string; type: string; confidence: number; properties?: Record<string, unknown> } = {
      text: args.text as string,
      type: args.type as string,
      confidence: (args.confidence as number) ?? 0.9,
    };
    if (args.properties) entity.properties = args.properties as Record<string, unknown>;
    const id = await ops.createEntity(entity);

    return {
      stored: true,
      entityId: id,
      text: args.text,
      type: args.type,
    };
  } catch (error) {
    logger.error('store_entity failed', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleStoreRelationship(args: Record<string, unknown>) {
  try {
    const ops = await getKnowledgeOps();
    const rel: { headText: string; headType: string; tailText: string; tailType: string; type: string; confidence: number; fact?: string } = {
      headText: args.headText as string,
      headType: args.headType as string,
      tailText: args.tailText as string,
      tailType: args.tailType as string,
      type: args.type as string,
      confidence: (args.confidence as number) ?? 0.9,
    };
    if (args.fact) rel.fact = args.fact as string;
    await ops.createRelationship(rel);

    return {
      stored: true,
      head: `${args.headText} (${args.headType})`,
      tail: `${args.tailText} (${args.tailType})`,
      type: args.type,
    };
  } catch (error) {
    logger.error('store_relationship failed', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleStoreFact(args: Record<string, unknown>) {
  try {
    // Dynamic import to avoid requiring @codegraph/nlp when not using this tool
    const { extractAndStore } = await import('@codegraph/nlp');
    const ops = await getKnowledgeOps();

    const text = args.text as string;
    if (!text || text.trim().length === 0) {
      return { error: 'Text is required' };
    }

    const config: Record<string, unknown> = {};
    if (args.model) {
      config.extractor = { model: args.model as string };
    }

    const result = await extractAndStore(text, ops, config);

    return {
      stored: true,
      entities: result.entities,
      relationships: result.relationships,
      sampleId: result.sampleId,
      extracted: {
        entities: result.annotated.entities.map(e => ({
          text: e.text,
          type: e.type,
        })),
        relationships: result.annotated.relationships.map(r => {
          const head = result.annotated.entities.find(e => e.id === r.headEntityId);
          const tail = result.annotated.entities.find(e => e.id === r.tailEntityId);
          return {
            head: head?.text,
            tail: tail?.text,
            type: r.type,
          };
        }),
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg.includes('OPENROUTER_API_KEY') || msg.includes('API key')) {
      return { error: 'OPENROUTER_API_KEY environment variable is not set. Set it to use LLM extraction.' };
    }
    logger.error('store_fact failed', error);
    return { error: msg };
  }
}

export async function handleQueryKnowledge(args: Record<string, unknown>) {
  try {
    const ops = await getKnowledgeOps();
    const query: { type?: string; textContains?: string; limit?: number } = {
      limit: (args.limit as number) ?? 20,
    };
    if (args.type) query.type = args.type as string;
    if (args.textContains) query.textContains = args.textContains as string;
    const results = await ops.searchEntities(query);

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
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleRecall(args: Record<string, unknown>) {
  try {
    const ops = await getKnowledgeOps();

    // Touch the entity to refresh its relevance (it's being accessed)
    const text = args.text as string;
    const type = args.type as string | undefined;
    if (type) {
      await ops.touchEntity(text, type);
    }

    const relQuery: { entityText?: string; entityType?: string; relationType?: string; limit?: number } = {
      entityText: text,
      limit: (args.limit as number) ?? 50,
    };
    if (type) relQuery.entityType = type;
    if (args.relationType) relQuery.relationType = args.relationType as string;
    const rels = await ops.getRelationships(relQuery);

    return {
      entity: text,
      relationshipCount: rels.length,
      relationships: rels.map(r => ({
        head: `${r.headText} (${r.headType})`,
        tail: `${r.tailText} (${r.tailType})`,
        type: r.relationType,
        confidence: r.confidence,
        fact: r.fact,
      })),
    };
  } catch (error) {
    logger.error('recall failed', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleDecayAndPrune(args: Record<string, unknown>) {
  try {
    const ops = await getKnowledgeOps();

    const decayConfig: Record<string, number> = {};
    if (args.decayRate) decayConfig.decayRate = args.decayRate as number;
    if (args.minRelevance) decayConfig.minRelevance = args.minRelevance as number;

    const decayResult = await ops.decayRelevance(decayConfig);

    let pruneResult = { pruned: 0 };
    if (args.prune) {
      const threshold = (args.minRelevance as number) ?? 0.1;
      pruneResult = await ops.pruneOldEntities(threshold);
    }

    return {
      decayed: decayResult.decayed,
      pruned: pruneResult.pruned,
      message: `Decayed ${decayResult.decayed} entities${args.prune ? `, pruned ${pruneResult.pruned}` : ''}`,
    };
  } catch (error) {
    logger.error('decay_and_prune failed', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleGetKnowledgeStats() {
  try {
    const ops = await getKnowledgeOps();
    const stats = await ops.getMemoryStats();

    return {
      totalEntities: stats.totalEntities,
      avgRelevance: Math.round(stats.avgRelevance * 1000) / 1000,
      lowRelevanceCount: stats.lowRelevanceCount,
      oldestAccess: stats.oldestAccess ? new Date(stats.oldestAccess).toISOString() : null,
      newestAccess: stats.newestAccess ? new Date(stats.newestAccess).toISOString() : null,
    };
  } catch (error) {
    logger.error('get_knowledge_stats failed', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Handler map (for consolidated.ts)
// ============================================================================

export const knowledgeHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  store_entity: handleStoreEntity,
  store_relationship: handleStoreRelationship,
  store_fact: handleStoreFact,
  query_knowledge: handleQueryKnowledge,
  recall: handleRecall,
  decay_and_prune: handleDecayAndPrune,
  get_knowledge_stats: handleGetKnowledgeStats,
};
