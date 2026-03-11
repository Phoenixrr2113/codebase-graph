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
 * - Check-then-insert pattern for upserts
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

  // --- Vector Search ---
  searchEntitiesByVector(embedding: number[], limit?: number): Promise<EntitySearchResult[]>;

  // --- ABOUT Edges (Entity → Code Node bridge) ---
  createAboutEdge(input: AboutEdgeInput): Promise<boolean>;
  getAboutEdgesForEntity(entityText: string, entityType: string, limit?: number): Promise<AboutEdgeResult[]>;
  getAboutEdgesForCodeNode(targetLabel: string, targetValue: string, limit?: number): Promise<AboutEdgeResult[]>;
  deleteAboutEdge(entityText: string, entityType: string, targetLabel: string, targetValue: string): Promise<boolean>;
  countAboutEdges(): Promise<number>;

  // --- Entity Resolution ---
  /** Delete a single entity and all its relationships by text+type */
  deleteEntity(text: string, type: string): Promise<boolean>;
  /** Merge duplicate entity into canonical: transfer relationships, ABOUT edges, then delete */
  mergeEntities(canonicalText: string, canonicalType: string, duplicateText: string, duplicateType: string): Promise<{ transferredRelationships: number; transferredAboutEdges: number }>;

  // --- Cleanup ---
  deleteSample(sampleId: string): Promise<void>;
  deleteAllKnowledge(): Promise<void>;
}

// ============================================================================
// Cypher Templates (FalkorDB-compatible)
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

  /** Insert new entity — uses vecf32() for embedding to ensure proper vector type */
  INSERT_ENTITY: `
    CREATE (n:Entity {
      id: $id,
      text: $text,
      type: $type,
      confidence: $confidence,
      embedding: CASE WHEN $embedding IS NOT NULL THEN vecf32($embedding) ELSE NULL END,
      createdAt: $now,
      lastAccessedAt: $now,
      accessCount: 1,
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
        n.sampleIds = coalesce(n.sampleIds, []) + [$sampleId]
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

  /** Check if relationship exists */
  FIND_RELATIONSHIP: `
    MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
      AND r.type = $relType
    RETURN r.type as type
    LIMIT 1
  `,

  /** Insert new relationship — uses vecf32() for fact_embedding */
  INSERT_RELATIONSHIP: `
    MATCH (h:Entity), (t:Entity)
    WHERE h.text = $headText AND h.type = $headType
      AND t.text = $tailText AND t.type = $tailType
    CREATE (h)-[r:RELATES_TO {
      type: $relType,
      confidence: $confidence,
      fact: $fact,
      fact_embedding: CASE WHEN $factEmbedding IS NOT NULL THEN vecf32($factEmbedding) ELSE NULL END,
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
    SET r.sampleIds = coalesce(r.sampleIds, []) + [$sampleId]
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
    WHERE $sampleId IN coalesce(n.sampleIds, [])
    DETACH DELETE n
  `,

  /** Delete all knowledge graph data */
  DELETE_ALL_KNOWLEDGE: `
    MATCH (n:Entity)
    DETACH DELETE n
  `,

  // --- Vector Search (FalkorDB native HNSW) ---

  /** Vector similarity search on Entity using FalkorDB native HNSW index */
  SEARCH_ENTITIES_BY_VECTOR: `
    CALL db.idx.vector.queryNodes('Entity', 'embedding', $k, vecf32($queryVec))
    YIELD node, score
    RETURN node.id AS id, node.text AS text, node.type AS type,
           node.confidence AS confidence, node.relevanceScore AS relevanceScore,
           node.createdAt AS createdAt, node.lastAccessedAt AS lastAccessedAt,
           score
  `,

  // --- ABOUT Edge Operations (Entity → Code Node bridge) ---

  /**
   * Create an ABOUT edge from a knowledge entity to a code graph node.
   * Uses dynamic label matching with CASE WHEN to support multiple target types.
   * The $targetLabel param is checked against common code node labels.
   */
  CREATE_ABOUT_FUNCTION: `
    MATCH (e:Entity), (t:Function)
    WHERE e.text = $entityText AND e.type = $entityType AND t.name = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  CREATE_ABOUT_CLASS: `
    MATCH (e:Entity), (t:Class)
    WHERE e.text = $entityText AND e.type = $entityType AND t.name = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  CREATE_ABOUT_INTERFACE: `
    MATCH (e:Entity), (t:Interface)
    WHERE e.text = $entityText AND e.type = $entityType AND t.name = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  CREATE_ABOUT_COMPONENT: `
    MATCH (e:Entity), (t:Component)
    WHERE e.text = $entityText AND e.type = $entityType AND t.name = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  CREATE_ABOUT_TYPE: `
    MATCH (e:Entity), (t:Type)
    WHERE e.text = $entityText AND e.type = $entityType AND t.name = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  CREATE_ABOUT_FILE: `
    MATCH (e:Entity), (t:File)
    WHERE e.text = $entityText AND e.type = $entityType AND t.path = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  CREATE_ABOUT_VARIABLE: `
    MATCH (e:Entity), (t:Variable)
    WHERE e.text = $entityText AND e.type = $entityType AND t.name = $targetValue
    MERGE (e)-[r:ABOUT]->(t)
    ON CREATE SET r.confidence = $confidence, r.method = $method, r.created_at = $createdAt
    ON MATCH SET r.confidence = CASE WHEN $confidence > r.confidence THEN $confidence ELSE r.confidence END
    RETURN type(r) AS relType
  `,

  /** Get all ABOUT edges for a knowledge entity (entity → code nodes) */
  GET_ABOUT_FOR_ENTITY: `
    MATCH (e:Entity)-[r:ABOUT]->(t)
    WHERE e.text = $entityText AND e.type = $entityType
    RETURN e.text AS entityText, e.type AS entityType,
           labels(t)[0] AS targetLabel,
           CASE
             WHEN t:File THEN t.path
             ELSE t.name
           END AS targetValue,
           r.confidence AS confidence, r.method AS method,
           r.created_at AS createdAt
    ORDER BY r.confidence DESC
    LIMIT $limit
  `,

  /** Get all ABOUT edges pointing to a code node (code node ← entities) */
  GET_ABOUT_FOR_CODE_NODE: `
    MATCH (e:Entity)-[r:ABOUT]->(t)
    WHERE labels(t)[0] = $targetLabel
      AND CASE
            WHEN $targetLabel = 'File' THEN t.path = $targetValue
            ELSE t.name = $targetValue
          END
    RETURN e.text AS entityText, e.type AS entityType,
           labels(t)[0] AS targetLabel,
           CASE
             WHEN t:File THEN t.path
             ELSE t.name
           END AS targetValue,
           r.confidence AS confidence, r.method AS method,
           r.created_at AS createdAt
    ORDER BY r.confidence DESC
    LIMIT $limit
  `,

  /** Delete a specific ABOUT edge */
  DELETE_ABOUT: `
    MATCH (e:Entity)-[r:ABOUT]->(t)
    WHERE e.text = $entityText AND e.type = $entityType
      AND CASE
            WHEN $targetLabel = 'File' THEN t.path = $targetValue AND t:File
            WHEN $targetLabel = 'Function' THEN t.name = $targetValue AND t:Function
            WHEN $targetLabel = 'Class' THEN t.name = $targetValue AND t:Class
            WHEN $targetLabel = 'Interface' THEN t.name = $targetValue AND t:Interface
            WHEN $targetLabel = 'Component' THEN t.name = $targetValue AND t:Component
            WHEN $targetLabel = 'Type' THEN t.name = $targetValue AND t:Type
            WHEN $targetLabel = 'Variable' THEN t.name = $targetValue AND t:Variable
            ELSE false
          END
    DELETE r
    RETURN count(r) AS deleted
  `,

  /** Count all ABOUT edges */
  COUNT_ABOUT_EDGES: `
    MATCH (:Entity)-[r:ABOUT]->()
    RETURN count(r) AS count
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

    // Check-then-insert pattern for entity upsert
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

  /** Map of target label → Cypher template for ABOUT edge creation */
  private static readonly ABOUT_QUERIES: Record<string, string> = {
    Function: KG_CYPHER.CREATE_ABOUT_FUNCTION,
    Class: KG_CYPHER.CREATE_ABOUT_CLASS,
    Interface: KG_CYPHER.CREATE_ABOUT_INTERFACE,
    Component: KG_CYPHER.CREATE_ABOUT_COMPONENT,
    Type: KG_CYPHER.CREATE_ABOUT_TYPE,
    File: KG_CYPHER.CREATE_ABOUT_FILE,
    Variable: KG_CYPHER.CREATE_ABOUT_VARIABLE,
  };

  @trace()
  async createAboutEdge(input: AboutEdgeInput): Promise<boolean> {
    const cypher = KnowledgeOperationsImpl.ABOUT_QUERIES[input.targetLabel];
    if (!cypher) {
      throw new Error(`createAboutEdge: unsupported target label '${input.targetLabel}'. ` +
        `Supported: ${Object.keys(KnowledgeOperationsImpl.ABOUT_QUERIES).join(', ')}`);
    }

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

  @trace()
  async getAboutEdgesForCodeNode(
    targetLabel: string,
    targetValue: string,
    limit = 50,
  ): Promise<AboutEdgeResult[]> {
    const result = await this.client.roQuery<AboutEdgeResult>(
      KG_CYPHER.GET_ABOUT_FOR_CODE_NODE,
      { params: { targetLabel, targetValue, limit } },
    );
    return result.data;
  }

  @trace()
  async deleteAboutEdge(
    entityText: string,
    entityType: string,
    targetLabel: string,
    targetValue: string,
  ): Promise<boolean> {
    const result = await this.client.query<{ deleted: number }>(
      KG_CYPHER.DELETE_ABOUT,
      { params: { entityText, entityType, targetLabel, targetValue } },
    );
    return (result.data[0]?.deleted ?? 0) > 0;
  }

  @trace()
  async countAboutEdges(): Promise<number> {
    const result = await this.client.roQuery<{ count: number }>(
      KG_CYPHER.COUNT_ABOUT_EDGES,
      { params: {} },
    );
    return result.data[0]?.count ?? 0;
  }

  // --- Entity Resolution ---

  @trace()
  async deleteEntity(text: string, type: string): Promise<boolean> {
    const cypher = `
      MATCH (e:Entity { text: $text, type: $type })
      DETACH DELETE e
      RETURN count(e) AS deleted
    `;
    const result = await this.client.query<{ deleted: number }>(cypher, {
      params: { text, type },
    });
    return (result.data[0]?.deleted ?? 0) > 0;
  }

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
    await this.deleteEntity(duplicateText, duplicateType);

    return { transferredRelationships, transferredAboutEdges };
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
