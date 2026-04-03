/**
 * KnowledgeService — Unified Service Layer for Knowledge Graph
 *
 * Parallel to CodeGraphServiceImpl for code graph queries, this service
 * provides a typed facade over KnowledgeOperations for knowledge graph
 * CRUD and temporal memory operations.
 *
 * Consumers: @codegraph/mcp-server, @codegraph/api, @codegraph/cli
 */

import type {
  EntitySearchResult,
  KnowledgeOperations,
  DecayConfig,
  TemporalQueryResult,
  TemporalChangeResult,
  TimelineEntry,
} from '@codegraph/graph';
import { getKnowledgeOps } from './knowledgeClient';

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeStoreResult {
  entityId: string;
  text: string;
  type: string;
}

export interface KnowledgeRelationshipStoreResult {
  stored: true;
  head: string;
  tail: string;
  type: string;
}

export interface KnowledgeRecallResult {
  entity: string;
  relationshipCount: number;
  relationships: Array<{
    head: string;
    tail: string;
    type: string;
    confidence: number;
    fact: string | null;
  }>;
}

export interface KnowledgeMaintenanceResult {
  decayed: number;
  pruned: number;
}

export interface KnowledgeStatsResult {
  totalEntities: number;
  avgRelevance: number;
  lowRelevanceCount: number;
  oldestAccess: string | null;
  newestAccess: string | null;
}

/** Result from storeFact (NLP extraction → knowledge graph) */
export interface KnowledgeFactResult {
  stored: true;
  entities: number;
  relationships: number;
  sampleId: string;
  extracted: {
    entities: Array<{ text: string; type: string }>;
    relationships: Array<{ head: string | undefined; tail: string | undefined; type: string }>;
  };
}

/**
 * Function signature for the NLP extract-and-store bridge.
 * Accepts text + KnowledgeOperations + optional config,
 * returns extraction results. Provided by @codegraph/plugin-nlp.
 */
export type ExtractAndStoreFn = (
  text: string,
  ops: KnowledgeOperations,
  config?: Record<string, unknown>,
) => Promise<{
  entities: number;
  relationships: number;
  sampleId: string;
  annotated: {
    entities: Array<{ id: string; text: string; type: string }>;
    relationships: Array<{ headEntityId: string; tailEntityId: string; type: string }>;
  };
}>;

/**
 * Function signature for the conversation ingestion pipeline.
 * Accepts conversation text + KnowledgeOperations + config,
 * runs: chunk → extract per episode with sliding context → store.
 * Provided by @codegraph/plugin-nlp.
 */
export type IngestConversationFn = (
  text: string,
  ops: KnowledgeOperations,
  config?: {
    format?: string;
    source?: string;
    model?: string;
    contextWindow?: number;
  },
) => Promise<{
  totalEpisodes: number;
  episodesWithEntities: number;
  entities: number;
  relationships: number;
  embedded: number;
  speakers: string[];
  format: string;
}>;

/** Result from ingestConversation */
export interface KnowledgeConversationResult {
  ingested: true;
  totalEpisodes: number;
  episodesWithEntities: number;
  entities: number;
  relationships: number;
  embedded: number;
  speakers: string[];
  format: string;
  source: string | null;
}

// ============================================================================
// KnowledgeService
// ============================================================================

class KnowledgeServiceImpl {
  /**
   * Store an entity in the knowledge graph.
   * Deduplicates by text+type — existing entities are updated.
   */
  async storeEntity(
    text: string,
    type: string,
    options?: { confidence?: number; properties?: Record<string, unknown> },
  ): Promise<KnowledgeStoreResult> {
    const ops = await getKnowledgeOps();
    const entity: { text: string; type: string; confidence: number; properties?: Record<string, unknown> } = {
      text,
      type,
      confidence: options?.confidence ?? 0.9,
    };
    if (options?.properties) entity.properties = options.properties;
    const id = await ops.createEntity(entity);
    return { entityId: id, text, type };
  }

  /**
   * Store a relationship between two entities.
   * Entities are referenced by text+type and must exist.
   * Deduplicates existing relationships.
   */
  async storeRelationship(
    headText: string,
    headType: string,
    tailText: string,
    tailType: string,
    relationType: string,
    options?: { confidence?: number; fact?: string },
  ): Promise<KnowledgeRelationshipStoreResult> {
    const ops = await getKnowledgeOps();
    const rel: Parameters<typeof ops.createRelationship>[0] = {
      headText,
      headType,
      tailText,
      tailType,
      type: relationType,
      confidence: options?.confidence ?? 0.9,
    };
    if (options?.fact !== undefined) rel.fact = options.fact;
    await ops.createRelationship(rel);
    return {
      stored: true,
      head: `${headText} (${headType})`,
      tail: `${tailText} (${tailType})`,
      type: relationType,
    };
  }

  /**
   * Extract entities and relationships from natural language text
   * and store them in the knowledge graph.
   *
   * Requires a `extractAndStoreFn` (from @codegraph/plugin-nlp) to
   * be passed in, keeping the NLP dependency optional for consumers
   * that don't need it.
   */
  async storeFact(
    text: string,
    extractAndStoreFn: ExtractAndStoreFn,
    options?: { model?: string },
  ): Promise<KnowledgeFactResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text is required');
    }

    const ops = await getKnowledgeOps();
    const config: Record<string, unknown> = {};
    if (options?.model) {
      config.extractor = { model: options.model };
    }

    const result = await extractAndStoreFn(text, ops, config);

    return {
      stored: true,
      entities: result.entities,
      relationships: result.relationships,
      sampleId: result.sampleId,
      extracted: {
        entities: result.annotated.entities.map((e) => ({
          text: e.text,
          type: e.type,
        })),
        relationships: result.annotated.relationships.map((r) => {
          const head = result.annotated.entities.find((e) => e.id === r.headEntityId);
          const tail = result.annotated.entities.find((e) => e.id === r.tailEntityId);
          return {
            head: head?.text,
            tail: tail?.text,
            type: r.type,
          };
        }),
      },
    };
  }

  /**
   * Search entities by type, text content, or both.
   */
  async queryKnowledge(query?: {
    type?: string;
    textContains?: string;
    limit?: number;
  }): Promise<EntitySearchResult[]> {
    const ops = await getKnowledgeOps();
    const searchQuery: Parameters<typeof ops.searchEntities>[0] = {
      limit: query?.limit ?? 20,
    };
    if (query?.type !== undefined) searchQuery.type = query.type;
    if (query?.textContains !== undefined) searchQuery.textContains = query.textContains;
    return ops.searchEntities(searchQuery);
  }

  /**
   * Recall everything known about an entity.
   * Touches the entity to refresh its relevance on access.
   */
  async recall(
    text: string,
    options?: { type?: string; relationType?: string; limit?: number; includeHistory?: boolean },
  ): Promise<KnowledgeRecallResult> {
    const ops = await getKnowledgeOps();

    // Touch the entity to refresh relevance (it's being accessed)
    if (options?.type) {
      await ops.touchEntity(text, options.type);
    }

    const relQuery: Parameters<typeof ops.getRelationships>[0] = {
      entityText: text,
      limit: options?.limit ?? 50,
    };
    if (options?.type !== undefined) relQuery.entityType = options.type;
    if (options?.relationType !== undefined) relQuery.relationType = options.relationType;
    if (options?.includeHistory) relQuery.includeInvalidated = true;
    const rels = await ops.getRelationships(relQuery);

    return {
      entity: text,
      relationshipCount: rels.length,
      relationships: rels.map((r) => ({
        head: `${r.headText} (${r.headType})`,
        tail: `${r.tailText} (${r.tailType})`,
        type: r.relationType,
        confidence: r.confidence,
        fact: r.fact,
      })),
    };
  }

  /**
   * Run temporal memory maintenance: decay relevance scores
   * for old entities and optionally prune below threshold.
   */
  async decayAndPrune(options?: {
    prune?: boolean;
    decayRate?: number;
    minRelevance?: number;
  }): Promise<KnowledgeMaintenanceResult> {
    const ops = await getKnowledgeOps();

    const decayConfig: Partial<DecayConfig> = {};
    if (options?.decayRate !== undefined) decayConfig.decayRate = options.decayRate;
    if (options?.minRelevance !== undefined) decayConfig.minRelevance = options.minRelevance;

    const decayResult = await ops.decayRelevance(decayConfig);

    let pruned = 0;
    if (options?.prune) {
      const threshold = options.minRelevance ?? 0.1;
      const pruneResult = await ops.pruneOldEntities(threshold);
      pruned = pruneResult.pruned;
    }

    return { decayed: decayResult.decayed, pruned };
  }

  /**
   * Ingest a multi-turn conversation into the knowledge graph.
   *
   * Full episodic pipeline: chunk → extract per episode with sliding
   * context → store. Speaker attribution, pronoun resolution, and
   * temporal ordering are handled automatically.
   *
   * Requires an `ingestConversationFn` (from @codegraph/plugin-nlp)
   * to keep the NLP dependency optional.
   */
  async ingestConversation(
    text: string,
    ingestConversationFn: IngestConversationFn,
    options?: { format?: string; source?: string; model?: string; contextWindow?: number },
  ): Promise<KnowledgeConversationResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Conversation text is required');
    }

    const ops = await getKnowledgeOps();
    const config: {
      format?: string;
      source?: string;
      model?: string;
      contextWindow?: number;
    } = {};
    if (options?.format) config.format = options.format;
    if (options?.source) config.source = options.source;
    if (options?.model) config.model = options.model;
    if (options?.contextWindow) config.contextWindow = options.contextWindow;

    const result = await ingestConversationFn(text, ops, config);

    return {
      ingested: true,
      totalEpisodes: result.totalEpisodes,
      episodesWithEntities: result.episodesWithEntities,
      entities: result.entities,
      relationships: result.relationships,
      embedded: result.embedded,
      speakers: result.speakers,
      format: result.format,
      source: options?.source ?? null,
    };
  }

  // --- Temporal Queries ---

  /**
   * Reconstruct knowledge state at a specific point in time.
   * Returns only facts that were valid at the given timestamp.
   */
  async queryAtPointInTime(timestamp: number): Promise<TemporalQueryResult[]> {
    const ops = await getKnowledgeOps();
    return ops.queryAtPointInTime(timestamp);
  }

  /**
   * Find facts established or superseded within a time range.
   * Returns both new facts and what they replaced.
   */
  async queryChangesInRange(from: number, to: number): Promise<TemporalChangeResult[]> {
    const ops = await getKnowledgeOps();
    return ops.queryChangesInRange(from, to);
  }

  /**
   * Get full chronological history of an entity's relationships.
   * Includes both active and superseded facts.
   */
  async getEntityTimeline(entityText: string, entityType?: string): Promise<TimelineEntry[]> {
    const ops = await getKnowledgeOps();
    return ops.getEntityTimeline(entityText, entityType);
  }

  /**
   * Search entities by relevance score and last access time.
   * Surfaces "hot" vs "cold" knowledge.
   */
  async searchByRelevance(opts?: {
    minRelevance?: number;
    since?: number;
    limit?: number;
  }): Promise<EntitySearchResult[]> {
    const ops = await getKnowledgeOps();
    return ops.searchByRelevance(opts ?? {});
  }

  /**
   * Get entities mentioned by a specific speaker.
   * Follows SAID relationships created during conversation ingestion.
   */
  async queryBySpeaker(speakerText: string, limit?: number): Promise<EntitySearchResult[]> {
    const ops = await getKnowledgeOps();
    return ops.getEntitiesBySpeaker(speakerText, limit);
  }

  /**
   * Get knowledge graph memory statistics.
   */
  async getKnowledgeStats(): Promise<KnowledgeStatsResult> {
    const ops = await getKnowledgeOps();
    const stats = await ops.getMemoryStats();

    return {
      totalEntities: stats.totalEntities,
      avgRelevance: Math.round(stats.avgRelevance * 1000) / 1000,
      lowRelevanceCount: stats.lowRelevanceCount,
      oldestAccess: stats.oldestAccess ? new Date(stats.oldestAccess).toISOString() : null,
      newestAccess: stats.newestAccess ? new Date(stats.newestAccess).toISOString() : null,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Shared KnowledgeService instance.
 * All consumers should use this singleton.
 */
export const knowledgeService = new KnowledgeServiceImpl();

/** Type alias for the service */
export type KnowledgeService = typeof knowledgeService;
