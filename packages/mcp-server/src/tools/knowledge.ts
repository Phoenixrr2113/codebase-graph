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
import type { ToolDefinition } from './router';

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
    'Search the knowledge graph for entities. Filter by type, text content, source/provenance, ' +
    'or use semantic search to find entities by meaning. Returns matching entities with their ' +
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
      source: {
        type: 'string',
        description: 'Filter by provenance — returns only entities whose sampleIds contain this prefix (e.g., "meeting-2024-01-15", "slack-engineering")',
      },
      searchFacts: {
        type: 'string',
        description: 'Semantic search on relationship facts/explanations (not entity names). Finds relationships by meaning, e.g. "who decided to use JWT?" searches the fact embeddings on RELATES_TO edges.',
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
  description: 'Recall everything known about an entity — returns all currently-valid relationships where the entity appears as head or tail. Like asking "what do I know about X?" Supports temporal queries: use `at` for point-in-time, `from`/`to` for range queries, `timeline` for full history, `minRelevance` for relevance-weighted search.',
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
      includeExpired: {
        type: 'boolean',
        description: 'If true, also return facts that have passed their forgetAfter expiration timestamp (default: false — expired facts are hidden)',
      },
      at: {
        type: 'string',
        description: 'ISO timestamp for point-in-time query — returns only facts valid at this moment (e.g., "2026-03-01T00:00:00Z")',
      },
      from: {
        type: 'string',
        description: 'ISO timestamp for range query start — used with `to` to find facts established or superseded in this period',
      },
      to: {
        type: 'string',
        description: 'ISO timestamp for range query end — used with `from`',
      },
      timeline: {
        type: 'boolean',
        description: 'If true, return the full chronological timeline of this entity including superseded facts with timestamps',
      },
      minRelevance: {
        type: 'number',
        description: 'Minimum relevance score (0-1) for relevance-weighted entity search',
      },
      speaker: {
        type: 'string',
        description: 'Query by speaker — returns entities mentioned by this person during conversation ingestion (e.g., "Alice")',
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
      minAge: {
        type: 'number',
        description: 'Minimum age in milliseconds before decay starts (default: 604800000 = 7 days)',
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

export const resolveEntitiesToolDefinition: ToolDefinition = {
  name: 'resolve_entities',
  description: 'Run on-demand entity resolution (deduplication) on the knowledge graph. Uses 3-tier matching: exact text → embedding similarity → LLM verification. Merges duplicate entities by transferring relationships and ABOUT edges to the canonical entity.',
  inputSchema: {
    type: 'object',
    properties: {
      autoMergeThreshold: {
        type: 'number',
        description: 'Minimum similarity for automatic merge without LLM (default: 0.95)',
      },
      candidateThreshold: {
        type: 'number',
        description: 'Minimum similarity to consider as candidate for LLM verification (default: 0.85)',
      },
    },
  },
};

export const addDocumentToolDefinition: ToolDefinition = {
  name: 'add',
  description:
    'Ingest any content into the knowledge graph. Accepts file paths (PDF, DOCX, HTML, CSV, ' +
    'or any text file), URLs (fetches and extracts), or raw text. Auto-detects format, ' +
    'chunks into LLM-friendly pieces, extracts entities/relationships, and stores with provenance.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'File path, URL, or raw text to ingest',
      },
      inputType: {
        type: 'string',
        description: 'Override auto-detection: "file", "url", or "text"',
        enum: ['file', 'url', 'text'],
      },
      source: {
        type: 'string',
        description: 'Source label for provenance tracking (e.g., "quarterly-report-q1")',
      },
      maxTokens: {
        type: 'number',
        description: 'Max tokens per chunk (default: 512)',
      },
      model: {
        type: 'string',
        description: 'LLM model for entity extraction',
      },
    },
    required: ['input'],
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
  addDocumentToolDefinition,
  ingestConversationToolDefinition,
  queryKnowledgeToolDefinition,
  recallToolDefinition,
  resolveEntitiesToolDefinition,
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

    // Fact embedding search: search by relationship meaning
    if (args.searchFacts != null && isEmbeddingAvailable()) {
      const factQuery = args.searchFacts as string;
      try {
        const { embedding } = await generateEmbedding(factQuery);
        const kgOps = await getKnowledgeOps();
        const facts = await kgOps.searchFactsByVector(embedding, limit);
        return {
          count: facts.length,
          searchFacts: factQuery,
          facts: facts.map(f => ({
            head: `${f.headText} (${f.headType})`,
            tail: `${f.tailText} (${f.tailType})`,
            type: f.relationType,
            confidence: f.confidence,
            fact: f.fact,
            validAt: f.validAt ? new Date(f.validAt).toISOString() : null,
            score: f.score,
          })),
        };
      } catch (err) {
        logger.warn(`Fact search failed: ${err}`);
        // Fall through to standard search
      }
    }

    // Source/provenance filter path: query entities by sampleId prefix
    if (args.source != null) {
      const sourcePrefix = args.source as string;
      try {
        const kgOps = await getKnowledgeOps();
        const results = await kgOps.searchEntitiesBySource(sourcePrefix, limit);
        return {
          count: results.length,
          source: sourcePrefix,
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
      } catch {
        // Fall through to standard search
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
    // --- Temporal query: point-in-time ---
    if (args.at != null) {
      const timestamp = new Date(args.at as string).getTime();
      const results = await knowledgeService.queryAtPointInTime(timestamp);
      return {
        mode: 'point_in_time',
        at: args.at,
        count: results.length,
        facts: results.map(r => ({
          head: `${r.headText} (${r.headType})`,
          tail: `${r.tailText} (${r.tailType})`,
          type: r.relationType,
          confidence: r.confidence,
          fact: r.fact,
          validAt: r.validAt ? new Date(r.validAt).toISOString() : null,
        })),
      };
    }

    // --- Temporal query: range ---
    if (args.from != null && args.to != null) {
      const from = new Date(args.from as string).getTime();
      const to = new Date(args.to as string).getTime();
      const results = await knowledgeService.queryChangesInRange(from, to);
      return {
        mode: 'range',
        from: args.from,
        to: args.to,
        count: results.length,
        changes: results.map(r => ({
          change: r.change,
          head: `${r.headText} (${r.headType})`,
          tail: `${r.tailText} (${r.tailType})`,
          type: r.relationType,
          confidence: r.confidence,
          fact: r.fact,
          validAt: r.validAt ? new Date(r.validAt).toISOString() : null,
          invalidAt: r.invalidAt ? new Date(r.invalidAt).toISOString() : null,
        })),
      };
    }

    // --- Temporal query: entity timeline ---
    if (args.timeline === true) {
      const results = await knowledgeService.getEntityTimeline(
        args.text as string,
        args.type as string | undefined,
      );
      return {
        mode: 'timeline',
        entity: args.text,
        count: results.length,
        timeline: results.map(r => ({
          head: `${r.headText} (${r.headType})`,
          tail: `${r.tailText} (${r.tailType})`,
          type: r.relationType,
          confidence: r.confidence,
          fact: r.fact,
          validAt: r.validAt ? new Date(r.validAt).toISOString() : null,
          invalidAt: r.invalidAt ? new Date(r.invalidAt).toISOString() : null,
          isActive: r.isActive,
        })),
      };
    }

    // --- Speaker query: what did this person say? ---
    if (args.speaker != null) {
      const results = await knowledgeService.queryBySpeaker(args.speaker as string, (args.limit as number | undefined) ?? 50);
      return {
        mode: 'speaker',
        speaker: args.speaker,
        count: results.length,
        entities: results.map(e => ({
          text: e.text,
          type: e.type,
          confidence: e.confidence,
          relevance: e.relevanceScore,
          createdAt: new Date(e.createdAt).toISOString(),
        })),
      };
    }

    // --- Relevance-weighted search ---
    if (args.minRelevance != null) {
      const results = await knowledgeService.searchByRelevance({
        minRelevance: args.minRelevance as number,
        limit: (args.limit as number | undefined) ?? 50,
      });
      return {
        mode: 'relevance',
        minRelevance: args.minRelevance,
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
    }

    // --- Default: standard recall with ABOUT edge enrichment ---
    const opts: { type?: string; relationType?: string; limit?: number; includeHistory?: boolean; includeExpired?: boolean } = {};
    if (args.type != null) opts.type = args.type as string;
    if (args.relationType != null) opts.relationType = args.relationType as string;
    if (args.limit != null) opts.limit = args.limit as number;
    if (args.includeHistory != null) opts.includeHistory = args.includeHistory as boolean;
    if (args.includeExpired != null) opts.includeExpired = args.includeExpired as boolean;
    const result = await knowledgeService.recall(args.text as string, opts);

    // Enrich with ABOUT edges (knowledge → code bridges) if entity type is known
    if (args.type != null) {
      try {
        const kgOps = await getKnowledgeOps();
        const aboutEdges = await kgOps.getAboutEdgesForEntity(args.text as string, args.type as string);
        if (aboutEdges.length > 0) {
          return {
            ...result,
            bridges: aboutEdges.map(a => ({
              targetLabel: a.targetLabel,
              targetValue: a.targetValue,
              confidence: a.confidence,
              method: a.method,
              createdAt: a.createdAt,
            })),
          };
        }
      } catch {
        // ABOUT edge query failed — return standard result
      }
    }

    return result;
  } catch (error) {
    logger.error('recall failed', error);
    return { error: toErrorMessage(error) };
  }
}

export async function handleDecayAndPrune(args: Record<string, unknown>) {
  try {
    const opts: { prune?: boolean; decayRate?: number; minAge?: number; minRelevance?: number } = {};
    if (args.prune != null) opts.prune = args.prune as boolean;
    if (args.decayRate != null) opts.decayRate = args.decayRate as number;
    if (args.minAge != null) opts.minAge = args.minAge as number;
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

export async function handleAdd(args: Record<string, unknown>) {
  try {
    const { add } = await import('@codegraph/core');
    const input = args.input as string;
    if (!input || input.trim().length === 0) {
      return { error: 'Input is required (file path, URL, or text)' };
    }

    const opts: { inputType?: 'file' | 'url' | 'text'; source?: string; maxTokens?: number; model?: string } = {};
    if (args.inputType != null) opts.inputType = args.inputType as 'file' | 'url' | 'text';
    if (args.source != null) opts.source = args.source as string;
    if (args.maxTokens != null) opts.maxTokens = args.maxTokens as number;
    if (args.model != null) opts.model = args.model as string;

    const result = await add(input, opts);
    return {
      ...result,
      message: `Ingested ${result.entities} entities and ${result.relationships} relationships from ${result.chunks} chunks (${result.inputType}: ${result.metadata.format ?? 'text'})`,
    };
  } catch (error) {
    const msg = toErrorMessage(error);
    if (msg.includes('API key') || msg.includes('API_KEY') || msg.includes('not configured')) {
      return { error: 'LLM provider is not configured. Set CEREBRAS_API_KEY (recommended) or OPENROUTER_API_KEY to use document ingestion.' };
    }
    logger.error('add failed', error);
    return { error: msg };
  }
}

export async function handleResolveEntities(args: Record<string, unknown>) {
  try {
    // Dynamic import to avoid requiring @codegraph/plugin-nlp when not using this tool
    const { resolveEntities } = await import('@codegraph/plugin-nlp');
    const kgOps = await getKnowledgeOps();
    const config: Record<string, unknown> = {};
    if (args.autoMergeThreshold != null) config.autoMergeThreshold = args.autoMergeThreshold as number;
    if (args.candidateThreshold != null) config.candidateThreshold = args.candidateThreshold as number;
    const result = await resolveEntities(kgOps, config);
    return {
      total: result.total,
      merged: result.merged,
      kept: result.kept,
      tier1Merges: result.tier1Merges,
      tier2Merges: result.tier2Merges,
      tier3Merges: result.tier3Merges,
      llmCalls: result.llmCalls,
      merges: result.merges.map((m: { canonical: string; duplicate: string; tier: number; similarity?: number | undefined }) => ({
        canonical: m.canonical,
        duplicate: m.duplicate,
        tier: m.tier,
        similarity: m.similarity ?? null,
      })),
    };
  } catch (error) {
    const msg = toErrorMessage(error);
    if (msg.includes('API key') || msg.includes('API_KEY') || msg.includes('not configured')) {
      return { error: 'LLM provider is not configured. Entity resolution tier 3 (LLM verification) requires CEREBRAS_API_KEY or OPENROUTER_API_KEY. Tiers 1-2 (exact + embedding) may still work.' };
    }
    logger.error('resolve_entities failed', error);
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
  add: handleAdd,
  ingest_conversation: handleIngestConversation,
  query_knowledge: handleQueryKnowledge,
  recall: handleRecall,
  resolve_entities: handleResolveEntities,
  decay_and_prune: handleDecayAndPrune,
  get_knowledge_stats: handleGetKnowledgeStats,
};
