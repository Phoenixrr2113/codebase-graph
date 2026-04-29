/**
 * @codegraph/graph - Knowledge Graph Operations
 *
 * CRUD + temporal memory operations for the knowledge graph layer (NLC merger).
 * These operations target the Entity node table and RELATES_TO edge table.
 *
 * Engine: FalkorDB (primary), FalkorDBLite (local)
 * Cypher: FalkorDB-compatible (coalesce + list concat, IN operator)
 *
 * Key design decisions:
 * - Uses codebase-graph's GraphClient interface (driver-agnostic)
 * - Single RELATES_TO table with type property (Graphiti pattern)
 * - UUIDs generated in TypeScript
 * - Atomic upserts via MERGE (entities) and NOT EXISTS guard (relationships)
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
  /**
   * ISO 8601 timestamp after which this fact is no longer valid.
   * Stored as epoch ms on the edge. Filtered from recall results after expiry
   * unless `includeExpired: true` is passed to getRelationships.
   */
  forgetAfter?: string | null;
  /** Short phrase explaining why the fact expires (e.g., "scheduled event"). */
  forgetReason?: string | null;
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
  sampleIds?: string[] | undefined;
  embedding?: number[] | undefined;
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

// --- Temporal Query Result Types ---

export interface TemporalQueryResult {
  headText: string;
  headType: string;
  tailText: string;
  tailType: string;
  relationType: string;
  confidence: number;
  fact: string | null;
  validAt: number | null;
  invalidAt: number | null;
}

export interface TemporalChangeResult {
  change: 'established' | 'superseded';
  headText: string;
  headType: string;
  tailText: string;
  tailType: string;
  relationType: string;
  confidence: number;
  fact: string | null;
  validAt: number | null;
  invalidAt: number | null;
}

export interface FactSearchResult {
  headText: string;
  headType: string;
  tailText: string;
  tailType: string;
  relationType: string;
  confidence: number;
  fact: string | null;
  validAt: number | null;
  invalidAt: number | null;
  score: number;
}

export interface TimelineEntry {
  headText: string;
  headType: string;
  tailText: string;
  tailType: string;
  relationType: string;
  confidence: number;
  fact: string | null;
  validAt: number | null;
  invalidAt: number | null;
  isActive: boolean;
}

/**
 * ABOUT edge linking method — how the bridge was created.
 */
export type AboutLinkMethod = 'exact_match' | 'embedding_similarity' | 'llm_verified' | 'manual';

/**
 * Input for creating an ABOUT edge (Entity → Code Node).
 */
export interface AboutEdgeInput {
  /** Text of the knowledge entity */
  entityText: string;
  /** Type of the knowledge entity */
  entityType: string;
  /** Label of the target code node (Function, Class, File, etc.) */
  targetLabel: string;
  /** Property name used to identify the target (e.g., 'name' for Function, 'path' for File) */
  targetKey: string;
  /** Value of the identifying property */
  targetValue: string;
  /** Match confidence (0.0–1.0) */
  confidence: number;
  /** How the link was created */
  method: AboutLinkMethod;
}

/**
 * Result when querying ABOUT edges.
 */
export interface AboutEdgeResult {
  /** Entity text */
  entityText: string;
  /** Entity type */
  entityType: string;
  /** Target node label (Function, Class, File, etc.) */
  targetLabel: string;
  /** Target identifying value (name or path) */
  targetValue: string;
  /** Match confidence */
  confidence: number;
  /** Linking method */
  method: string;
  /** ISO timestamp when the link was created */
  createdAt: string;
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
  searchEntities(query: { type?: string; textContains?: string; limit?: number }): Promise<EntitySearchResult[]>;

  // --- Relationship CRUD ---
  createRelationship(rel: KnowledgeRelationship): Promise<void>;
  getRelationships(query: { entityText?: string; entityType?: string; relationType?: string; limit?: number; includeInvalidated?: boolean; includeExpired?: boolean }): Promise<RelationshipResult[]>;
  /** Invalidate a relationship by setting invalid_at to now. Used by conflict resolution. */
  invalidateRelationship(headText: string, headType: string, tailText: string, tailType: string, relationType: string): Promise<boolean>;

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

  // --- Vector Search ---
  searchEntitiesByVector(embedding: number[], limit?: number): Promise<EntitySearchResult[]>;

  // --- ABOUT Edges (Entity → Code Node bridge) ---
  createAboutEdge(input: AboutEdgeInput): Promise<boolean>;
  getAboutEdgesForEntity(entityText: string, entityType: string, limit?: number): Promise<AboutEdgeResult[]>;
  // --- Entity Resolution ---
  /** Merge duplicate entity into canonical: transfer relationships, ABOUT edges, then delete */
  mergeEntities(canonicalText: string, canonicalType: string, duplicateText: string, duplicateType: string): Promise<{ transferredRelationships: number; transferredAboutEdges: number }>;

  // --- Speaker Queries ---
  /** Get entities mentioned by a speaker (via SAID relationships) */
  getEntitiesBySpeaker(speakerText: string, limit?: number): Promise<Array<EntitySearchResult & { fact?: string | null }>>;

  // --- Fact Search ---
  /** Search relationships by fact embedding similarity */
  searchFactsByVector(embedding: number[], limit?: number): Promise<FactSearchResult[]>;

  // --- Provenance ---
  /** Search entities by sampleId prefix */
  searchEntitiesBySource(sourcePrefix: string, limit?: number): Promise<EntitySearchResult[]>;

  // --- Temporal Queries ---
  /** Reconstruct knowledge state at a specific point in time */
  queryAtPointInTime(timestamp: number): Promise<TemporalQueryResult[]>;
  /** Find facts established or superseded within a time range */
  queryChangesInRange(from: number, to: number): Promise<TemporalChangeResult[]>;
  /** Get full chronological history of an entity's relationships */
  getEntityTimeline(entityText: string, entityType?: string): Promise<TimelineEntry[]>;
  /** Search entities by relevance score and last access time */
  searchByRelevance(opts: { minRelevance?: number; since?: number; limit?: number }): Promise<EntitySearchResult[]>;

}

// ============================================================================
// Cypher Templates (FalkorDB-compatible)
// ============================================================================

const KG_CYPHER = {
  // --- Entity operations ---

  /**
   * Upsert entity — atomic MERGE replaces check-then-insert (QUAL.2).
   * ON CREATE: initializes all fields for a new entity.
   * ON MATCH: bumps access count and relevance for existing entity.
   * Embedding is set separately (see UPSERT_ENTITY_EMBEDDING) since vecf32()
   * can't be used inside MERGE ON CREATE SET.
   */
  UPSERT_ENTITY: `
    MERGE (n:Entity {text: $text, type: $type})
    ON CREATE SET
      n.id = $id,
      n.confidence = $confidence,
      n.createdAt = $now,
      n.lastAccessedAt = $now,
      n.accessCount = 1,
      n.relevanceScore = 1.0,
      n.sampleIds = $sampleIds,
      n.properties = $properties
    ON MATCH SET
      n.lastAccessedAt = $now,
      n.accessCount = n.accessCount + 1,
      n.relevanceScore = CASE
        WHEN n.relevanceScore < 1.0 THEN n.relevanceScore + 0.1
        ELSE 1.0
      END,
      n.sampleIds = coalesce(n.sampleIds, []) + [$sampleIds]
    RETURN n.id as id
  `,

  /** Set embedding vector on entity (must use vecf32 outside MERGE) */
  UPSERT_ENTITY_EMBEDDING: `
    MATCH (n:Entity {text: $text, type: $type})
    SET n.embedding = vecf32($embedding)
    RETURN n.id as id
  `,

  /** Search entities with optional type/text filters */
  SEARCH_ENTITIES_BY_TYPE: `
    MATCH (n:Entity)
    WHERE n.type = $type
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt,
           n.embedding as embedding
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  SEARCH_ENTITIES_BY_TEXT: `
    MATCH (n:Entity)
    WHERE n.text CONTAINS $textContains
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt,
           n.embedding as embedding
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  SEARCH_ENTITIES_BY_TYPE_AND_TEXT: `
    MATCH (n:Entity)
    WHERE n.type = $type AND n.text CONTAINS $textContains
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt,
           n.embedding as embedding
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  SEARCH_ALL_ENTITIES: `
    MATCH (n:Entity)
    RETURN n.id as id, n.text as text, n.type as type,
           n.confidence as confidence, n.relevanceScore as relevanceScore,
           n.createdAt as createdAt, n.lastAccessedAt as lastAccessedAt,
           n.embedding as embedding
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  // --- Relationship operations ---

  /**
   * Upsert relationship — atomic two-step replaces check-then-insert (QUAL.2).
   * Step 1: CREATE the edge if it doesn't exist yet (conditional via WHERE NOT EXISTS).
   * Step 2: UPDATE sample tracking on the (now-guaranteed) edge.
   * Both steps run as separate queries but are idempotent, so concurrent calls
   * produce at most one edge (the CREATE has a WHERE NOT EXISTS guard).
   */
  UPSERT_RELATIONSHIP_CREATE: `
    MATCH (h:Entity), (t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
    OPTIONAL MATCH (h)-[existing:RELATES_TO]->(t)
    WHERE existing.type = $relType
    WITH h, t, existing
    WHERE existing IS NULL
    CREATE (h)-[r:RELATES_TO {
      type: $relType,
      confidence: $confidence,
      fact: $fact,
      fact_embedding: CASE WHEN $factEmbedding IS NOT NULL THEN vecf32($factEmbedding) ELSE NULL END,
      valid_at: $validAt,
      invalid_at: $invalidAt,
      created_at: $now,
      expired_at: $expiredAt,
      forget_after: $forgetAfter,
      forget_reason: $forgetReason,
      sampleIds: $sampleIds,
      properties: $properties
    }]->(t)
  `,

  UPSERT_RELATIONSHIP_UPDATE: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
      AND r.type = $relType
    SET r.sampleIds = coalesce(r.sampleIds, []) + [$sampleId]
  `,

  /** Invalidate a relationship — set invalid_at to mark it as superseded */
  INVALIDATE_RELATIONSHIP: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
      AND r.type = $relType
      AND r.invalid_at IS NULL
    SET r.invalid_at = $now
    RETURN r.type as type
  `,

  /** Get relationships for an entity (valid only — excludes invalidated and expired) */
  GET_RELATIONSHIPS: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $entityText
      AND r.invalid_at IS NULL
      AND (r.forget_after IS NULL OR r.forget_after > $now)
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  /** Get relationships for an entity (valid only, including expired — for includeExpired: true) */
  GET_RELATIONSHIPS_INCLUDE_EXPIRED: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $entityText
      AND r.invalid_at IS NULL
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  /** Get relationships for an entity (including invalidated — for history) */
  GET_RELATIONSHIPS_ALL: `
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
      AND r.invalid_at IS NULL
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  GET_RELATIONSHIPS_BY_ENTITY_TYPE: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE (h.type = $entityType OR t.type = $entityType)
      AND r.invalid_at IS NULL
    RETURN h.text as headText, h.type as headType,
           t.text as tailText, t.type as tailType,
           r.type as relationType, r.confidence as confidence,
           r.fact as fact
    LIMIT $limit
  `,

  GET_ALL_RELATIONSHIPS: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE r.invalid_at IS NULL
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

  // --- Batch operations (QUAL.3 — UNWIND batching) ---

  /**
   * Batch upsert entities in a single roundtrip.
   * Each item in $entities must have: text, type, id, confidence, sampleId, properties.
   * Embeddings are set in a separate batch query (vecf32 constraint).
   */
  BATCH_UPSERT_ENTITIES: `
    UNWIND $entities AS e
    MERGE (n:Entity {text: e.text, type: e.type})
    ON CREATE SET
      n.id = e.id,
      n.confidence = e.confidence,
      n.createdAt = $now,
      n.lastAccessedAt = $now,
      n.accessCount = 1,
      n.relevanceScore = 1.0,
      n.sampleIds = [e.sampleId],
      n.properties = e.properties
    ON MATCH SET
      n.lastAccessedAt = $now,
      n.accessCount = n.accessCount + 1,
      n.relevanceScore = CASE
        WHEN n.relevanceScore < 1.0 THEN n.relevanceScore + 0.1
        ELSE 1.0
      END,
      n.sampleIds = coalesce(n.sampleIds, []) + [e.sampleId]
    RETURN n.id as id
  `,

  /** Batch set embeddings on entities (must use vecf32 outside MERGE) */
  BATCH_SET_ENTITY_EMBEDDINGS: `
    UNWIND $items AS item
    MATCH (n:Entity {text: item.text, type: item.type})
    SET n.embedding = vecf32(item.embedding)
    RETURN n.id as id
  `,

  /**
   * Batch upsert relationships in a single roundtrip.
   * Two-step: conditional CREATE (NOT EXISTS guard) then sample tracking.
   * Note: UNWIND + subquery pattern for the NOT EXISTS guard.
   */
  BATCH_UPSERT_RELATIONSHIPS: `
    UNWIND $rels AS rel
    MATCH (h:Entity), (t:Entity)
    WHERE h.text = rel.headText AND h.type = rel.headType
      AND t.text = rel.tailText AND t.type = rel.tailType
    OPTIONAL MATCH (h)-[existing:RELATES_TO]->(t)
    WHERE existing.type = rel.relType
    WITH h, t, rel, existing
    WHERE existing IS NULL
    CREATE (h)-[r:RELATES_TO {
      type: rel.relType,
      confidence: rel.confidence,
      fact: rel.fact,
      valid_at: rel.validAt,
      invalid_at: rel.invalidAt,
      created_at: $now,
      expired_at: NULL,
      forget_after: rel.forgetAfter,
      forget_reason: rel.forgetReason,
      sampleIds: [rel.sampleId],
      properties: rel.properties
    }]->(t)
  `,

  /** Batch update sample tracking on existing relationships */
  BATCH_UPDATE_RELATIONSHIP_SAMPLES: `
    UNWIND $rels AS rel
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = rel.headText AND h.type = rel.headType
      AND t.text = rel.tailText AND t.type = rel.tailType
      AND r.type = rel.relType
    SET r.sampleIds = coalesce(r.sampleIds, []) + [rel.sampleId]
  `,

  // --- Temporal Queries ---

  /** Point-in-time: return only facts valid at a given timestamp */
  QUERY_AT_POINT_IN_TIME: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE r.valid_at <= $timestamp
      AND (r.invalid_at IS NULL OR r.invalid_at > $timestamp)
    RETURN h.text AS headText, h.type AS headType,
           t.text AS tailText, t.type AS tailType,
           r.type AS relationType, r.confidence AS confidence,
           r.fact AS fact, r.valid_at AS validAt, r.invalid_at AS invalidAt
    ORDER BY r.valid_at DESC
    LIMIT $limit
  `,

  /** Range query: facts established within a period */
  QUERY_ESTABLISHED_IN_RANGE: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE r.valid_at >= $from AND r.valid_at <= $to
    RETURN 'established' AS change,
           h.text AS headText, h.type AS headType,
           t.text AS tailText, t.type AS tailType,
           r.type AS relationType, r.confidence AS confidence,
           r.fact AS fact, r.valid_at AS validAt, r.invalid_at AS invalidAt
    ORDER BY r.valid_at ASC
  `,

  /** Range query: facts superseded (invalidated) within a period */
  QUERY_SUPERSEDED_IN_RANGE: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE r.invalid_at >= $from AND r.invalid_at <= $to
    RETURN 'superseded' AS change,
           h.text AS headText, h.type AS headType,
           t.text AS tailText, t.type AS tailType,
           r.type AS relationType, r.confidence AS confidence,
           r.fact AS fact, r.valid_at AS validAt, r.invalid_at AS invalidAt
    ORDER BY r.invalid_at ASC
  `,

  /** Entity timeline: full history of relationships for an entity (both directions) */
  GET_ENTITY_TIMELINE: `
    MATCH (h:Entity)-[r:RELATES_TO]-(t:Entity)
    WHERE h.text = $entityText
    RETURN h.text AS headText, h.type AS headType,
           t.text AS tailText, t.type AS tailType,
           r.type AS relationType, r.confidence AS confidence,
           r.fact AS fact, r.valid_at AS validAt, r.invalid_at AS invalidAt,
           CASE WHEN r.invalid_at IS NULL THEN true ELSE false END AS isActive
    ORDER BY r.valid_at ASC
    LIMIT $limit
  `,

  /** Entity timeline filtered by type */
  GET_ENTITY_TIMELINE_BY_TYPE: `
    MATCH (h:Entity)-[r:RELATES_TO]-(t:Entity)
    WHERE h.text = $entityText AND h.type = $entityType
    RETURN h.text AS headText, h.type AS headType,
           t.text AS tailText, t.type AS tailType,
           r.type AS relationType, r.confidence AS confidence,
           r.fact AS fact, r.valid_at AS validAt, r.invalid_at AS invalidAt,
           CASE WHEN r.invalid_at IS NULL THEN true ELSE false END AS isActive
    ORDER BY r.valid_at ASC
    LIMIT $limit
  `,

  /** Get entities mentioned by a speaker (via SAID relationship) */
  GET_ENTITIES_BY_SPEAKER: `
    MATCH (speaker:Entity {text: $speakerText, type: 'Person'})-[r:RELATES_TO]->(entity:Entity)
    WHERE r.type = 'SAID' AND r.invalid_at IS NULL
    RETURN entity.id AS id, entity.text AS text, entity.type AS type,
           entity.confidence AS confidence, entity.relevanceScore AS relevanceScore,
           entity.createdAt AS createdAt, entity.lastAccessedAt AS lastAccessedAt,
           r.fact AS fact
    ORDER BY entity.relevanceScore DESC
    LIMIT $limit
  `,

  /** Search entities by sampleId prefix (provenance filter) */
  SEARCH_ENTITIES_BY_SOURCE: `
    MATCH (n:Entity)
    WHERE any(sid IN coalesce(n.sampleIds, []) WHERE sid STARTS WITH $sourcePrefix)
    RETURN n.id AS id, n.text AS text, n.type AS type,
           n.confidence AS confidence, n.relevanceScore AS relevanceScore,
           n.createdAt AS createdAt, n.lastAccessedAt AS lastAccessedAt
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  /** Relevance-weighted search: entities above relevance threshold accessed since a time */
  SEARCH_BY_RELEVANCE: `
    MATCH (n:Entity)
    WHERE n.relevanceScore >= $minRelevance
      AND n.lastAccessedAt >= $since
    RETURN n.id AS id, n.text AS text, n.type AS type,
           n.confidence AS confidence, n.relevanceScore AS relevanceScore,
           n.createdAt AS createdAt, n.lastAccessedAt AS lastAccessedAt
    ORDER BY n.relevanceScore DESC
    LIMIT $limit
  `,

  // --- Vector Search (FalkorDB native HNSW) ---

  /** Vector similarity search on Entity using FalkorDB native HNSW index */
  SEARCH_ENTITIES_BY_VECTOR: `
    CALL db.idx.vector.queryNodes('Entity', 'embedding', $k, vecf32($queryVec))
    YIELD node, score
    RETURN node.id AS id, node.text AS text, node.type AS type,
           node.confidence AS confidence, node.relevanceScore AS relevanceScore,
           node.createdAt AS createdAt, node.lastAccessedAt AS lastAccessedAt,
           node.sampleIds AS sampleIds, score
  `,

  /** Vector similarity search on RELATES_TO fact embeddings */
  SEARCH_FACTS_BY_VECTOR: `
    CALL db.idx.vector.queryEdges('RELATES_TO', 'fact_embedding', $k, vecf32($queryVec))
    YIELD edge, score
    MATCH (h:Entity)-[edge]->(t:Entity)
    RETURN h.text AS headText, h.type AS headType,
           t.text AS tailText, t.type AS tailType,
           edge.type AS relationType, edge.confidence AS confidence,
           edge.fact AS fact, edge.valid_at AS validAt, edge.invalid_at AS invalidAt,
           score
    ORDER BY score ASC
  `,

  // --- ABOUT Edge Operations (Entity → Code Node bridge) ---
  // Individual CREATE_ABOUT_* templates replaced by
  // KnowledgeOperationsImpl.buildCreateAboutQuery() (QUAL.11)

  /** Get all ABOUT edges for a knowledge entity (entity → code nodes) */
  GET_ABOUT_FOR_ENTITY: `
    MATCH (e:Entity)-[r:ABOUT]->(t)
    WHERE e.text = $entityText AND e.type = $entityType
    RETURN e.text AS entityText, e.type AS entityType,
           labels(t)[0] AS targetLabel,
           CASE
             WHEN t:File THEN t.filePath
             ELSE t.name
           END AS targetValue,
           r.confidence AS confidence, r.method AS method,
           r.created_at AS createdAt
    ORDER BY r.confidence DESC
    LIMIT $limit
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
    const sampleIds = [entity.sampleId ?? 'unknown'];

    // Atomic upsert via MERGE (QUAL.2 — eliminates check-then-insert race)
    const result = await this.client.query<{ id: string }>(
      KG_CYPHER.UPSERT_ENTITY,
      {
        params: {
          id,
          text: entity.text,
          type: entity.type,
          confidence: entity.confidence ?? 1.0,
          now,
          sampleIds,
          properties: entity.properties ? JSON.stringify(entity.properties) : '{}',
        } as QueryParams,
      }
    );

    const entityId = result.data[0]?.id ?? id;

    // Set embedding separately (vecf32() can't be used inside MERGE ON CREATE SET)
    if (entity.embedding) {
      await this.client.query(
        KG_CYPHER.UPSERT_ENTITY_EMBEDDING,
        {
          params: {
            text: entity.text,
            type: entity.type,
            embedding: entity.embedding,
          } as QueryParams,
        }
      );
    }

    return entityId;
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
    const sampleId = rel.sampleId ?? 'unknown';

    // Convert ISO forgetAfter to epoch ms for storage (null if not provided or invalid)
    const forgetAfterMs = rel.forgetAfter != null
      ? (() => { const t = new Date(rel.forgetAfter!).getTime(); return isNaN(t) ? null : t; })()
      : null;

    // Atomic upsert — idempotent CREATE (guarded by NOT EXISTS) + unconditional UPDATE (QUAL.2)
    await this.client.query(KG_CYPHER.UPSERT_RELATIONSHIP_CREATE, {
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
        forgetAfter: forgetAfterMs,
        forgetReason: rel.forgetReason ?? null,
        sampleIds: [sampleId],
        properties: rel.properties ? JSON.stringify(rel.properties) : '{}',
      } as QueryParams,
    });

    // Always update sample tracking (idempotent — adds sampleId to list)
    await this.client.query(KG_CYPHER.UPSERT_RELATIONSHIP_UPDATE, {
      params: {
        headText: rel.headText,
        headType: rel.headType,
        tailText: rel.tailText,
        tailType: rel.tailType,
        relType: rel.type,
        sampleId,
      },
    });
  }

  @trace()
  async invalidateRelationship(
    headText: string,
    headType: string,
    tailText: string,
    tailType: string,
    relationType: string,
  ): Promise<boolean> {
    const now = Date.now();
    const result = await this.client.query<{ type: string }>(
      KG_CYPHER.INVALIDATE_RELATIONSHIP,
      {
        params: { headText, headType, tailText, tailType, relType: relationType, now },
      }
    );
    return result.data.length > 0;
  }

  @trace()
  async getRelationships(query: {
    entityText?: string;
    entityType?: string;
    relationType?: string;
    limit?: number;
    includeInvalidated?: boolean;
    includeExpired?: boolean;
  }): Promise<RelationshipResult[]> {
    const limit = query.limit ?? 50;
    const includeInvalidated = query.includeInvalidated ?? false;
    const includeExpired = query.includeExpired ?? false;
    const now = Date.now();

    let cypher: string;
    let params: QueryParams;

    if (query.entityText) {
      if (includeInvalidated) {
        // History mode: includes invalidated (superseded) and expired facts
        cypher = KG_CYPHER.GET_RELATIONSHIPS_ALL;
        params = { entityText: query.entityText, limit };
      } else if (includeExpired) {
        // Include expired but still exclude invalidated
        cypher = KG_CYPHER.GET_RELATIONSHIPS_INCLUDE_EXPIRED;
        params = { entityText: query.entityText, limit };
      } else {
        // Default: exclude invalidated AND expired
        cypher = KG_CYPHER.GET_RELATIONSHIPS;
        params = { entityText: query.entityText, limit, now };
      }
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
    const now = Date.now();
    const BATCH_SIZE = 50; // UNWIND batch size — tuned for FalkorDB query limits

    // Step 1: Batch upsert entities via UNWIND (QUAL.3)
    for (let i = 0; i < entities.length; i += BATCH_SIZE) {
      const batch = entities.slice(i, i + BATCH_SIZE);
      const entityParams = batch.map(e => ({
        text: e.text,
        type: e.type,
        id: e.id ?? crypto.randomUUID(),
        confidence: e.confidence ?? 1.0,
        sampleId: e.sampleId ?? sampleId,
        properties: e.properties ? JSON.stringify(e.properties) : '{}',
      }));

      await this.client.query(KG_CYPHER.BATCH_UPSERT_ENTITIES, {
        params: { entities: entityParams, now } as QueryParams,
      });

      // Set embeddings separately (vecf32 constraint)
      const withEmbeddings = batch
        .filter(e => e.embedding != null)
        .map(e => ({ text: e.text, type: e.type, embedding: e.embedding! }));

      if (withEmbeddings.length > 0) {
        await this.client.query(KG_CYPHER.BATCH_SET_ENTITY_EMBEDDINGS, {
          params: { items: withEmbeddings } as QueryParams,
        });
      }
    }

    // Step 2: Batch upsert relationships via UNWIND (QUAL.3)
    for (let i = 0; i < relationships.length; i += BATCH_SIZE) {
      const batch = relationships.slice(i, i + BATCH_SIZE);
      const relParams = batch.map(r => {
        const forgetAfterMs = r.forgetAfter != null
          ? (() => { const t = new Date(r.forgetAfter!).getTime(); return isNaN(t) ? null : t; })()
          : null;
        return {
          headText: r.headText,
          headType: r.headType,
          tailText: r.tailText,
          tailType: r.tailType,
          relType: r.type,
          confidence: r.confidence ?? 1.0,
          fact: r.fact ?? null,
          validAt: r.validAt ?? now,
          invalidAt: r.invalidAt ?? null,
          forgetAfter: forgetAfterMs,
          forgetReason: r.forgetReason ?? null,
          sampleId: r.sampleId ?? sampleId,
          properties: r.properties ? JSON.stringify(r.properties) : '{}',
        };
      });

      // Conditional CREATE (idempotent — NOT EXISTS guard)
      await this.client.query(KG_CYPHER.BATCH_UPSERT_RELATIONSHIPS, {
        params: { rels: relParams, now } as QueryParams,
      });

      // Update sample tracking on all matched edges
      await this.client.query(KG_CYPHER.BATCH_UPDATE_RELATIONSHIP_SAMPLES, {
        params: { rels: relParams } as QueryParams,
      });
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

  // --- Speaker Queries ---

  @trace()
  async getEntitiesBySpeaker(speakerText: string, limit: number = 50): Promise<Array<EntitySearchResult & { fact?: string | null }>> {
    const result = await this.client.roQuery<EntitySearchResult & { fact: string | null }>(
      KG_CYPHER.GET_ENTITIES_BY_SPEAKER,
      { params: { speakerText, limit } },
    );
    return result.data;
  }

  // --- Fact Search ---

  @trace()
  async searchFactsByVector(embedding: number[], limit: number = 10): Promise<FactSearchResult[]> {
    try {
      const result = await this.client.roQuery<FactSearchResult>(
        KG_CYPHER.SEARCH_FACTS_BY_VECTOR,
        { params: { queryVec: embedding, k: limit } },
      );
      return result.data;
    } catch {
      // If fact_embedding vector index doesn't exist or has no data, return empty
      return [];
    }
  }

  // --- Provenance ---

  @trace()
  async searchEntitiesBySource(sourcePrefix: string, limit: number = 50): Promise<EntitySearchResult[]> {
    const result = await this.client.roQuery<EntitySearchResult>(
      KG_CYPHER.SEARCH_ENTITIES_BY_SOURCE,
      { params: { sourcePrefix, limit } },
    );
    return result.data;
  }

  // --- Temporal Queries ---

  @trace()
  async queryAtPointInTime(timestamp: number): Promise<TemporalQueryResult[]> {
    const result = await this.client.roQuery<TemporalQueryResult>(
      KG_CYPHER.QUERY_AT_POINT_IN_TIME,
      { params: { timestamp, limit: 100 } },
    );
    return result.data;
  }

  @trace()
  async queryChangesInRange(from: number, to: number): Promise<TemporalChangeResult[]> {
    // Run both queries and merge results
    const [established, superseded] = await Promise.all([
      this.client.roQuery<TemporalChangeResult>(
        KG_CYPHER.QUERY_ESTABLISHED_IN_RANGE,
        { params: { from, to } },
      ),
      this.client.roQuery<TemporalChangeResult>(
        KG_CYPHER.QUERY_SUPERSEDED_IN_RANGE,
        { params: { from, to } },
      ),
    ]);

    // Merge and sort by timestamp (validAt for established, invalidAt for superseded)
    const all = [...established.data, ...superseded.data];
    all.sort((a, b) => {
      const timeA = a.change === 'established' ? (a.validAt ?? 0) : (a.invalidAt ?? 0);
      const timeB = b.change === 'established' ? (b.validAt ?? 0) : (b.invalidAt ?? 0);
      return timeA - timeB;
    });
    return all;
  }

  @trace()
  async getEntityTimeline(entityText: string, entityType?: string): Promise<TimelineEntry[]> {
    if (entityType) {
      const result = await this.client.roQuery<TimelineEntry>(
        KG_CYPHER.GET_ENTITY_TIMELINE_BY_TYPE,
        { params: { entityText, entityType, limit: 200 } },
      );
      return result.data;
    }
    const result = await this.client.roQuery<TimelineEntry>(
      KG_CYPHER.GET_ENTITY_TIMELINE,
      { params: { entityText, limit: 200 } },
    );
    return result.data;
  }

  @trace()
  async searchByRelevance(opts: {
    minRelevance?: number;
    since?: number;
    limit?: number;
  }): Promise<EntitySearchResult[]> {
    const result = await this.client.roQuery<EntitySearchResult>(
      KG_CYPHER.SEARCH_BY_RELEVANCE,
      {
        params: {
          minRelevance: opts.minRelevance ?? 0.5,
          since: opts.since ?? 0,
          limit: opts.limit ?? 50,
        },
      },
    );
    return result.data;
  }

  // --- Vector Search ---

  @trace()
  async searchEntitiesByVector(embedding: number[], limit: number = 10): Promise<EntitySearchResult[]> {
    try {
      const result = await this.client.roQuery<EntitySearchResult & { score: number }>(
        KG_CYPHER.SEARCH_ENTITIES_BY_VECTOR,
        { params: { queryVec: embedding, k: limit } }
      );
      return result.data;
    } catch {
      // If vector index doesn't exist or has no data, return empty
      return [];
    }
  }

  // --- ABOUT Edges (Entity → Code Node bridge) ---

  /** Valid target labels for ABOUT edges (labels can't be parameterized in Cypher) */
  private static readonly VALID_ABOUT_LABELS = new Set([
    'Function', 'Class', 'Interface', 'Component', 'Type', 'File', 'Variable',
  ]);

  /** Build ABOUT edge Cypher for a given target label */
  private static buildCreateAboutQuery(label: string): string {
    const matchProp = label === 'File' ? 't.filePath' : 't.name';
    return `
      MATCH (e:Entity), (t:${label})
      WHERE e.text = $entityText AND e.type = $entityType AND ${matchProp} = $targetValue
      MERGE (e)-[r:ABOUT]->(t)
      ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
      ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
      RETURN type(r) AS relType
    `;
  }

  @trace()
  async createAboutEdge(input: AboutEdgeInput): Promise<boolean> {
    if (!KnowledgeOperationsImpl.VALID_ABOUT_LABELS.has(input.targetLabel)) {
      throw new Error(`createAboutEdge: unsupported target label '${input.targetLabel}'. ` +
        `Supported: ${[...KnowledgeOperationsImpl.VALID_ABOUT_LABELS].join(', ')}`);
    }

    const cypher = KnowledgeOperationsImpl.buildCreateAboutQuery(input.targetLabel);
    const result = await this.client.query<{ relType: string }>(cypher, {
      params: {
        entityText: input.entityText,
        entityType: input.entityType,
        targetValue: input.targetValue,
        confidence: input.confidence,
        method: input.method,
        createdAt: new Date().toISOString(),
      },
    });

    return result.data.length > 0;
  }

  @trace()
  async getAboutEdgesForEntity(
    entityText: string,
    entityType: string,
    limit = 50,
  ): Promise<AboutEdgeResult[]> {
    const result = await this.client.roQuery<AboutEdgeResult>(
      KG_CYPHER.GET_ABOUT_FOR_ENTITY,
      { params: { entityText, entityType, limit } },
    );
    return result.data;
  }

  // --- Entity Resolution ---

  @trace()
  async mergeEntities(
    canonicalText: string,
    canonicalType: string,
    duplicateText: string,
    duplicateType: string,
  ): Promise<{ transferredRelationships: number; transferredAboutEdges: number }> {
    let transferredRelationships = 0;
    let transferredAboutEdges = 0;

    // 1. Transfer outgoing RELATES_TO edges from duplicate to canonical
    //    (duplicate)-[r:RELATES_TO]->(other) → (canonical)-[r2:RELATES_TO]->(other)
    try {
      const outgoing = await this.client.query<{ count: number }>(`
        MATCH (dup:Entity { text: $dupText, type: $dupType })-[r:RELATES_TO]->(other:Entity)
        MATCH (canon:Entity { text: $canonText, type: $canonType })
        WHERE other.text <> $canonText OR other.type <> $canonType
        CREATE (canon)-[r2:RELATES_TO {
          type: r.type,
          confidence: r.confidence,
          fact: r.fact,
          valid_at: r.valid_at,
          invalid_at: r.invalid_at,
          created_at: r.created_at,
          expired_at: r.expired_at,
          sampleIds: r.sampleIds,
          properties: r.properties
        }]->(other)
        DELETE r
        RETURN count(r2) AS count
      `, {
        params: {
          dupText: duplicateText, dupType: duplicateType,
          canonText: canonicalText, canonType: canonicalType,
        },
      });
      transferredRelationships += outgoing.data[0]?.count ?? 0;
    } catch {
      // No outgoing rels to transfer — that's fine
    }

    // 2. Transfer incoming RELATES_TO edges from duplicate to canonical
    //    (other)-[r:RELATES_TO]->(duplicate) → (other)-[r2:RELATES_TO]->(canonical)
    try {
      const incoming = await this.client.query<{ count: number }>(`
        MATCH (other:Entity)-[r:RELATES_TO]->(dup:Entity { text: $dupText, type: $dupType })
        MATCH (canon:Entity { text: $canonText, type: $canonType })
        WHERE other.text <> $canonText OR other.type <> $canonType
        CREATE (other)-[r2:RELATES_TO {
          type: r.type,
          confidence: r.confidence,
          fact: r.fact,
          valid_at: r.valid_at,
          invalid_at: r.invalid_at,
          created_at: r.created_at,
          expired_at: r.expired_at,
          sampleIds: r.sampleIds,
          properties: r.properties
        }]->(canon)
        DELETE r
        RETURN count(r2) AS count
      `, {
        params: {
          dupText: duplicateText, dupType: duplicateType,
          canonText: canonicalText, canonType: canonicalType,
        },
      });
      transferredRelationships += incoming.data[0]?.count ?? 0;
    } catch {
      // No incoming rels to transfer — that's fine
    }

    // 3. Transfer ABOUT edges from duplicate to canonical
    try {
      const about = await this.client.query<{ count: number }>(`
        MATCH (dup:Entity { text: $dupText, type: $dupType })-[a:ABOUT]->(target)
        MATCH (canon:Entity { text: $canonText, type: $canonType })
        CREATE (canon)-[a2:ABOUT {
          confidence: a.confidence,
          method: a.method
        }]->(target)
        DELETE a
        RETURN count(a2) AS count
      `, {
        params: {
          dupText: duplicateText, dupType: duplicateType,
          canonText: canonicalText, canonType: canonicalType,
        },
      });
      transferredAboutEdges += about.data[0]?.count ?? 0;
    } catch {
      // No ABOUT edges to transfer — that's fine
    }

    // 4. Delete the duplicate entity
    await this.client.query(`
      MATCH (e:Entity { text: $text, type: $type })
      DETACH DELETE e
    `, { params: { text: duplicateText, type: duplicateType } });

    return { transferredRelationships, transferredAboutEdges };
  }

}

// ============================================================================
// Factory
// ============================================================================

export function createKnowledgeOperations(client: GraphClient): KnowledgeOperations {
  return new KnowledgeOperationsImpl(client);
}
