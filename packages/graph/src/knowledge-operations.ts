/**
 * @codegraph/graph - Knowledge Graph Operations
 *
 * CRUD + temporal memory operations for the knowledge graph layer (NLC merger).
 * These operations target the Entity node table and RELATES_TO edge table
 * defined in kuzu-schema.ts.
 *
 * Key differences from NLC's original FalkorDB operations:
 * - Uses codebase-graph's GraphClient interface (driver-agnostic)
 * - Single RELATES_TO table with type property (Graphiti pattern)
 * - UUIDs generated in TypeScript (Kuzu has no randomUUID())
 * - No ON CREATE SET / ON MATCH SET — uses check-then-insert pattern
 * - Embedding vectors passed in from caller (inference layer handles generation)
 * - Bi-temporal fields on edges (valid_at, invalid_at, created_at, expired_at)
 */

import type { GraphClient, QueryParams } from './client';
import { trace } from '@codegraph/logger';

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeEntity {
  id?: string;
  text: string;
  type: string;
  confidence?: number;
  embedding?: number[] | null;
  sampleId?: string;
  properties?: Record<string, unknown>;
}

export interface KnowledgeRelationship {
  headText: string;
  headType: string;
  tailText: string;
  tailType: string;
  type: string;
  confidence?: number;
  fact?: string;
  factEmbedding?: number[] | null;
  sampleId?: string;
  validAt?: number | null;
  invalidAt?: number | null;
  properties?: Record<string, unknown>;
}

export interface DecayConfig {
  /** How much to reduce relevanceScore per run (e.g. 0.013 = 1.3%) */
  decayRate: number;
  /** Minimum age in ms before decay starts (e.g. 604800000 = 7 days) */
  minAge: number;
  /** Minimum relevanceScore to keep (below this, entity can be pruned) */
  minRelevance: number;
}

export interface MemoryStats {
  totalEntities: number;
  avgRelevance: number;
  lowRelevanceCount: number;
  oldestAccess: number | null;
  newestAccess: number | null;
}

export interface EntitySearchResult {
  id: string;
  text: string;
  type: string;
  confidence: number;
  relevanceScore: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface RelationshipResult {
  headText: string;
  headType: string;
  tailText: string;
  tailType: string;
  relationType: string;
  confidence: number;
  fact: string | null;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_DECAY_CONFIG: DecayConfig = {
  decayRate: 0.013,        // 1.3% decay per run (~6 months to reach 0.1 from 1.0)
  minAge: 604800000,       // 7 days before decay starts
  minRelevance: 0.1,       // Keep if relevance >= 10%
};

// ============================================================================
// Knowledge Graph Operations Interface
// ============================================================================

export interface KnowledgeOperations {
  // --- Entity CRUD ---
  createEntity(entity: KnowledgeEntity): Promise<string>;
  getEntity(entityId: string): Promise<KnowledgeEntity | null>;
  getEntityByText(text: string, type: string): Promise<KnowledgeEntity | null>;
  searchEntities(query: { type?: string; textContains?: string; limit?: number }): Promise<EntitySearchResult[]>;

  // --- Relationship CRUD ---
  createRelationship(rel: KnowledgeRelationship): Promise<void>;
  getRelationships(query: { entityText?: string; entityType?: string; relationType?: string; limit?: number }): Promise<RelationshipResult[]>;

  // --- Batch Import ---
  importEntitiesAndRelationships(
    entities: KnowledgeEntity[],
    relationships: KnowledgeRelationship[],
    sampleId: string
  ): Promise<{ entities: number; relationships: number }>;

  // --- Temporal Memory ---
  touchEntity(text: string, type: string): Promise<boolean>;
  decayRelevance(config?: Partial<DecayConfig>): Promise<{ decayed: number }>;
  pruneOldEntities(threshold?: number): Promise<{ pruned: number }>;
  getMemoryStats(): Promise<MemoryStats>;

  // --- Cleanup ---
  deleteSample(sampleId: string): Promise<void>;
  deleteAllKnowledge(): Promise<void>;
}

// ============================================================================
// Cypher Templates (Kuzu-compatible)
// ============================================================================

const KG_CYPHER = {
  // --- Entity operations ---

  /** Check if entity exists by text + type */
  FIND_ENTITY: `
    MATCH (n:Entity)
    WHERE n.text = $text AND n.type = $type
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt,
           n.accessCount as accessCount
    LIMIT 1
  `,

  /** Insert new entity */
  INSERT_ENTITY: `
    CREATE (n:Entity {
      id: $id,
      text: $text,
      type: $type,
      confidence: $confidence,
      embedding: $embedding,
      createdAt: $now,
      lastAccessedAt: $now,
      accessCount: cast(1, "INT64"),
      relevanceScore: 1.0,
      sampleIds: $sampleIds,
      properties: $properties
    })
    RETURN n.id as id
  `,

  /** Update existing entity on re-encounter (bump access, update confidence) */
  UPDATE_ENTITY_ON_MATCH: `
    MATCH (n:Entity)
    WHERE n.text = $text AND n.type = $type
    SET n.lastAccessedAt = $now,
        n.accessCount = n.accessCount + 1,
        n.relevanceScore = CASE
          WHEN n.relevanceScore < 1.0 THEN n.relevanceScore + 0.1
          ELSE 1.0
        END,
        n.sampleIds = list_append(n.sampleIds, $sampleId)
    RETURN n.id as id
  `,

  /** Get entity by ID */
  GET_ENTITY: `
    MATCH (n:Entity {id: $id})
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt
  `,

  /** Search entities with optional type/text filters */
  SEARCH_ENTITIES_BY_TYPE: `
    MATCH (n:Entity)
    WHERE n.type = $type
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  SEARCH_ENTITIES_BY_TEXT: `
    MATCH (n:Entity)
    WHERE n.text CONTAINS $textContains
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  SEARCH_ENTITIES_BY_TYPE_AND_TEXT: `
    MATCH (n:Entity)
    WHERE n.type = $type AND n.text CONTAINS $textContains
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  SEARCH_ALL_ENTITIES: `
    MATCH (n:Entity)
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  // --- Relationship operations ---

  /** Check if relationship exists */
  FIND_RELATIONSHIP: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
      AND r.type = $relType
    RETURN r.type as type
    LIMIT 1
  `,

  /** Insert new relationship */
  INSERT_RELATIONSHIP: `
    MATCH (h:Entity), (t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
    CREATE (h)-[r:RELATES_TO {
      type: $relType,
      confidence: $confidence,
      fact: $fact,
      fact_embedding: $factEmbedding,
      valid_at: $validAt,
      invalid_at: $invalidAt,
      created_at: $now,
      expired_at: $expiredAt,
      sampleIds: $sampleIds,
      properties: $properties
    }]->(t)
  `,

  /** Update existing relationship on re-encounter */
  UPDATE_RELATIONSHIP_ON_MATCH: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
      AND r.type = $relType
    SET r.sampleIds = list_append(r.sampleIds, $sampleId)
  `,

  /** Get relationships for an entity */
  GET_RELATIONSHIPS: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $entityText
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  GET_RELATIONSHIPS_BY_TYPE: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE r.type = $relationType
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  GET_RELATIONSHIPS_BY_ENTITY_TYPE: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.type = $entityType OR t.type = $entityType
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  GET_ALL_RELATIONSHIPS: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  // --- Temporal Memory ---

  /** Touch entity — refresh relevance on access */
  TOUCH_ENTITY: `
    MATCH (n:Entity)
    WHERE n.text = $text AND n.type = $type
    SET n.lastAccessedAt = $now,
        n.accessCount = n.accessCount + 1,
        n.relevanceScore = CASE
          WHEN n.relevanceScore < 1.0 THEN n.relevanceScore + 0.1
          ELSE 1.0
        END
    RETURN n.id as id
  `,

  /** Decay relevance for old entities */
  DECAY_RELEVANCE: `
    MATCH (n:Entity)
    WHERE n.lastAccessedAt < $cutoff AND n.relevanceScore > $minRelevance
    SET n.relevanceScore = n.relevanceScore * (1.0 - $decayRate)
    RETURN count(n) as count
  `,

  /** Count entities below threshold */
  COUNT_LOW_RELEVANCE: `
    MATCH (n:Entity)
    WHERE n.relevanceScore < $threshold
    RETURN count(n) as count
  `,

  /** Prune entities below threshold */
  PRUNE_ENTITIES: `
    MATCH (n:Entity)
    WHERE n.relevanceScore < $threshold
    DETACH DELETE n
  `,

  /** Memory stats */
  MEMORY_STATS: `
    MATCH (n:Entity)
    RETURN
      count(n) as total,
      avg(n.relevanceScore) as avgRel,
      sum(CASE WHEN n.relevanceScore < 0.3 THEN 1 ELSE 0 END) as lowCount,
      min(n.lastAccessedAt) as oldest,
      max(n.lastAccessedAt) as newest
  `,

  // --- Cleanup ---

  /** Delete all entities from a sample */
  DELETE_SAMPLE_ENTITIES: `
    MATCH (n:Entity)
    WHERE list_contains(n.sampleIds, $sampleId)
    DETACH DELETE n
  `,

  /** Delete all knowledge graph data */
  DELETE_ALL_KNOWLEDGE: `
    MATCH (n:Entity)
    DETACH DELETE n
  `,
};

// ============================================================================
// Implementation
// ============================================================================

class KnowledgeOperationsImpl implements KnowledgeOperations {
  constructor(private readonly client: GraphClient) {}

  // --- Entity CRUD ---

  @trace()
  async createEntity(entity: KnowledgeEntity): Promise<string> {
    const now = Date.now();
    const id = entity.id ?? crypto.randomUUID();

    // Check-then-insert pattern (Kuzu doesn't support ON CREATE SET / ON MATCH SET)
    const existing = await this.client.roQuery<{ id: string }>(
      KG_CYPHER.FIND_ENTITY,
      { params: { text: entity.text, type: entity.type } }
    );

    if (existing.data.length > 0) {
      // Entity exists — bump access count and relevance
      const result = await this.client.query<{ id: string }>(
        KG_CYPHER.UPDATE_ENTITY_ON_MATCH,
        {
          params: {
            text: entity.text,
            type: entity.type,
            now,
            sampleId: entity.sampleId ?? 'unknown',
          },
        }
      );
      return result.data[0]?.id ?? existing.data[0]!.id;
    }

    // New entity — insert
    const result = await this.client.query<{ id: string }>(
      KG_CYPHER.INSERT_ENTITY,
      {
        params: {
          id,
          text: entity.text,
          type: entity.type,
          confidence: entity.confidence ?? 1.0,
          embedding: entity.embedding ?? null,
          now,
          sampleIds: [entity.sampleId ?? 'unknown'],
          properties: entity.properties ? JSON.stringify(entity.properties) : '{}',
        } as QueryParams,
      }
    );

    return result.data[0]?.id ?? id;
  }

  @trace()
  async getEntity(entityId: string): Promise<KnowledgeEntity | null> {
    const result = await this.client.roQuery<{
      id: string;
      text: string;
      type: string;
      confidence: number;
    }>(KG_CYPHER.GET_ENTITY, { params: { id: entityId } });

    if (result.data.length === 0) return null;

    const row = result.data[0]!;
    return {
      id: row.id,
      text: row.text,
      type: row.type,
      confidence: row.confidence,
    };
  }

  @trace()
  async getEntityByText(text: string, type: string): Promise<KnowledgeEntity | null> {
    const result = await this.client.roQuery<{
      id: string;
      text: string;
      type: string;
      confidence: number;
    }>(KG_CYPHER.FIND_ENTITY, { params: { text, type } });

    if (result.data.length === 0) return null;

    const row = result.data[0]!;
    return {
      id: row.id,
      text: row.text,
      type: row.type,
      confidence: row.confidence,
    };
  }

  @trace()
  async searchEntities(query: {
    type?: string;
    textContains?: string;
    limit?: number;
  }): Promise<EntitySearchResult[]> {
    const limit = query.limit ?? 50;

    let cypher: string;
    let params: QueryParams;

    if (query.type && query.textContains) {
      cypher = KG_CYPHER.SEARCH_ENTITIES_BY_TYPE_AND_TEXT;
      params = { type: query.type, textContains: query.textContains, limit };
    } else if (query.type) {
      cypher = KG_CYPHER.SEARCH_ENTITIES_BY_TYPE;
      params = { type: query.type, limit };
    } else if (query.textContains) {
      cypher = KG_CYPHER.SEARCH_ENTITIES_BY_TEXT;
      params = { textContains: query.textContains, limit };
    } else {
      cypher = KG_CYPHER.SEARCH_ALL_ENTITIES;
      params = { limit };
    }

    const result = await this.client.roQuery<EntitySearchResult>(cypher, { params });
    return result.data;
  }

  // --- Relationship CRUD ---

  @trace()
  async createRelationship(rel: KnowledgeRelationship): Promise<void> {
    const now = Date.now();

    // Check if relationship already exists
    const existing = await this.client.roQuery<{ type: string }>(
      KG_CYPHER.FIND_RELATIONSHIP,
      {
        params: {
          headText: rel.headText,
          headType: rel.headType,
          tailText: rel.tailText,
          tailType: rel.tailType,
          relType: rel.type,
        },
      }
    );

    if (existing.data.length > 0) {
      // Relationship exists — update sample tracking
      await this.client.query(KG_CYPHER.UPDATE_RELATIONSHIP_ON_MATCH, {
        params: {
          headText: rel.headText,
          headType: rel.headType,
          tailText: rel.tailText,
          tailType: rel.tailType,
          relType: rel.type,
          sampleId: rel.sampleId ?? 'unknown',
        },
      });
      return;
    }

    // New relationship — insert
    await this.client.query(KG_CYPHER.INSERT_RELATIONSHIP, {
      params: {
        headText: rel.headText,
        headType: rel.headType,
        tailText: rel.tailText,
        tailType: rel.tailType,
        relType: rel.type,
        confidence: rel.confidence ?? 1.0,
        fact: rel.fact ?? null,
        factEmbedding: rel.factEmbedding ?? null,
        validAt: rel.validAt ?? now,
        invalidAt: rel.invalidAt ?? null,
        now,
        expiredAt: null,
        sampleIds: [rel.sampleId ?? 'unknown'],
        properties: rel.properties ? JSON.stringify(rel.properties) : '{}',
      } as QueryParams,
    });
  }

  @trace()
  async getRelationships(query: {
    entityText?: string;
    entityType?: string;
    relationType?: string;
    limit?: number;
  }): Promise<RelationshipResult[]> {
    const limit = query.limit ?? 50;

    let cypher: string;
    let params: QueryParams;

    if (query.entityText) {
      cypher = KG_CYPHER.GET_RELATIONSHIPS;
      params = { entityText: query.entityText, limit };
    } else if (query.relationType) {
      cypher = KG_CYPHER.GET_RELATIONSHIPS_BY_TYPE;
      params = { relationType: query.relationType, limit };
    } else if (query.entityType) {
      cypher = KG_CYPHER.GET_RELATIONSHIPS_BY_ENTITY_TYPE;
      params = { entityType: query.entityType, limit };
    } else {
      cypher = KG_CYPHER.GET_ALL_RELATIONSHIPS;
      params = { limit };
    }

    const result = await this.client.roQuery<RelationshipResult>(cypher, { params });
    return result.data;
  }

  // --- Batch Import ---

  @trace()
  async importEntitiesAndRelationships(
    entities: KnowledgeEntity[],
    relationships: KnowledgeRelationship[],
    sampleId: string
  ): Promise<{ entities: number; relationships: number }> {
    // Create all entities first
    for (const entity of entities) {
      await this.createEntity({ ...entity, sampleId });
    }

    // Then create relationships (entities must exist)
    for (const rel of relationships) {
      await this.createRelationship({ ...rel, sampleId });
    }

    return { entities: entities.length, relationships: relationships.length };
  }

  // --- Temporal Memory ---

  @trace()
  async touchEntity(text: string, type: string): Promise<boolean> {
    const now = Date.now();
    const result = await this.client.query<{ id: string }>(
      KG_CYPHER.TOUCH_ENTITY,
      { params: { text, type, now } }
    );
    return result.data.length > 0;
  }

  @trace()
  async decayRelevance(config: Partial<DecayConfig> = {}): Promise<{ decayed: number }> {
    const cfg = { ...DEFAULT_DECAY_CONFIG, ...config };
    const cutoff = Date.now() - cfg.minAge;

    const result = await this.client.query<{ count: number }>(
      KG_CYPHER.DECAY_RELEVANCE,
      {
        params: {
          cutoff,
          decayRate: cfg.decayRate,
          minRelevance: cfg.minRelevance,
        },
      }
    );

    return { decayed: result.data[0]?.count ?? 0 };
  }

  @trace()
  async pruneOldEntities(threshold: number = 0.1): Promise<{ pruned: number }> {
    // First count what will be pruned
    const countResult = await this.client.roQuery<{ count: number }>(
      KG_CYPHER.COUNT_LOW_RELEVANCE,
      { params: { threshold } }
    );
    const pruned = countResult.data[0]?.count ?? 0;

    if (pruned > 0) {
      await this.client.query(KG_CYPHER.PRUNE_ENTITIES, { params: { threshold } });
    }

    return { pruned };
  }

  @trace()
  async getMemoryStats(): Promise<MemoryStats> {
    const result = await this.client.roQuery<{
      total: number;
      avgRel: number;
      lowCount: number;
      oldest: number | null;
      newest: number | null;
    }>(KG_CYPHER.MEMORY_STATS, { params: {} });

    const stats = result.data[0];
    return {
      totalEntities: stats?.total ?? 0,
      avgRelevance: stats?.avgRel ?? 0,
      lowRelevanceCount: stats?.lowCount ?? 0,
      oldestAccess: stats?.oldest ?? null,
      newestAccess: stats?.newest ?? null,
    };
  }

  // --- Cleanup ---

  @trace()
  async deleteSample(sampleId: string): Promise<void> {
    await this.client.query(KG_CYPHER.DELETE_SAMPLE_ENTITIES, { params: { sampleId } });
  }

  @trace()
  async deleteAllKnowledge(): Promise<void> {
    await this.client.query(KG_CYPHER.DELETE_ALL_KNOWLEDGE, { params: {} });
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createKnowledgeOperations(client: GraphClient): KnowledgeOperations {
  return new KnowledgeOperationsImpl(client);
}
