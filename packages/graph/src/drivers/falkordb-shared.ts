/**
 * Shared FalkorDB driver utilities — used by both FalkorDBDriver (Docker)
 * and FalkorDBLiteDriver (embedded). Both drivers use the same `Graph` type
 * from the `falkordb` npm package, so query execution and schema setup are
 * identical.
 */

import type { Graph } from 'falkordb';
import { ConstraintType, EntityType } from 'falkordb';
import type { QueryOptions as FalkorQueryOptions } from 'falkordb/dist/src/commands';
import type { QueryParams } from '../client';
import { createLogger } from '@codegraph/logger';
import { ALL_GRAPH_LABELS, EMBEDDABLE_LABELS, SYMBOL_LABELS } from '@codegraph/types';

const logger = createLogger({ namespace: 'graph:schema' });

export type EmbeddingIndexProvider = 'local' | 'voyage' | 'openrouter' | 'none';

export interface EmbeddingIndexProfile {
  provider: EmbeddingIndexProvider;
  model: string | null;
  dimension: number;
}

export interface EnsureSchemaOptions {
  embeddingDim?: number;
  embeddingProfile?: EmbeddingIndexProfile;
  allowEmbeddingMigration?: boolean;
}

export const EMBEDDING_PROFILE_METADATA_KEY = 'codegraph.embeddingProfile';
export const EMBEDDING_MIGRATION_REMEDY =
  'Run an explicit re-embed migration or a full reindex before using the requested embedding profile.';

export class EmbeddingProfileMismatchError extends Error {
  readonly code = 'EMBEDDING_PROFILE_MISMATCH' as const;

  constructor(
    public readonly storedProfile: EmbeddingIndexProfile,
    public readonly requestedProfile: EmbeddingIndexProfile,
  ) {
    super(`Embedding profile mismatch. ${EMBEDDING_MIGRATION_REMEDY}`);
    this.name = 'EmbeddingProfileMismatchError';
  }
}

function isEmbeddingIndexProfile(value: unknown): value is EmbeddingIndexProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  return (
    ['local', 'voyage', 'openrouter', 'none'].includes(String(profile['provider']))
    && (typeof profile['model'] === 'string' || profile['model'] === null)
    && typeof profile['dimension'] === 'number'
    && Number.isInteger(profile['dimension'])
    && profile['dimension'] >= 0
  );
}

function profilesMatch(left: EmbeddingIndexProfile, right: EmbeddingIndexProfile): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.dimension === right.dimension;
}

export async function readStoredEmbeddingProfile(graph: Graph): Promise<EmbeddingIndexProfile | null> {
  try {
    const result = await graph.roQuery<{ value: string }>(
      `MATCH (m:Metadata {key: '${EMBEDDING_PROFILE_METADATA_KEY}'}) RETURN m.value AS value`,
    );
    const raw = result.data?.[0]?.value;
    if (typeof raw !== 'string') return null;
    const parsed: unknown = JSON.parse(raw);
    return isEmbeddingIndexProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Shared query execution
// ============================================================================

/**
 * Execute a read-write query on a FalkorDB Graph instance.
 */
export async function executeQuery<T>(
  graph: Graph,
  cypher: string,
  params?: QueryParams,
  timeout?: number,
): Promise<{ data: T[]; metadata: string[] }> {
  const queryOptions: Record<string, unknown> = {};
  if (params) queryOptions.params = params;
  if (timeout) queryOptions.TIMEOUT = timeout;
  const opts = Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
  const result = await graph.query<T>(cypher, opts as unknown as FalkorQueryOptions);
  return {
    data: result.data ?? [],
    metadata: result.metadata ?? [],
  };
}

/**
 * Execute a read-only query on a FalkorDB Graph instance.
 */
export async function executeRoQuery<T>(
  graph: Graph,
  cypher: string,
  params?: QueryParams,
  timeout?: number,
): Promise<{ data: T[]; metadata: string[] }> {
  const queryOptions: Record<string, unknown> = {};
  if (params) queryOptions.params = params;
  if (timeout) queryOptions.TIMEOUT = timeout;
  const opts = Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
  const result = await graph.roQuery<T>(cypher, opts as unknown as FalkorQueryOptions);
  return {
    data: result.data ?? [],
    metadata: result.metadata ?? [],
  };
}

// ============================================================================
// Shared schema setup
// ============================================================================

/**
 * Create all required indexes on a FalkorDB graph instance.
 * Works identically for both remote FalkorDB and embedded FalkorDBLite
 * since they share the same engine and Graph API.
 */
export async function ensureSchemaImpl(
  graph: Graph,
  opts?: EnsureSchemaOptions,
): Promise<void> {
  const requestedProfile = opts?.embeddingProfile;
  const storedProfile = requestedProfile
    ? await readStoredEmbeddingProfile(graph)
    : null;
  const profileMismatch = storedProfile !== null
    && requestedProfile !== undefined
    && !profilesMatch(storedProfile, requestedProfile);

  if (profileMismatch && !opts?.allowEmbeddingMigration) {
    throw new EmbeddingProfileMismatchError(storedProfile, requestedProfile);
  }

  // Helper: run a query ignoring "Index already exists" errors
  const safeIndex = async (cypher: string, throwUnexpected = false): Promise<void> => {
    try {
      await graph.query(cypher);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      // Swallow duplicate index errors — they're expected on restart
      if (msg.includes('Index already exists') || msg.includes('Attribute already indexed')) return;
      if (throwUnexpected) throw error;
      // Log but don't throw for other index errors (label may not exist yet)
      // Vector indexes will be created lazily when data arrives
    }
  };

  // --- Pre-create all node labels (FalkorDB #1240 workaround) ---
  // FalkorDB has a race condition where concurrent writes that introduce new
  // labels can crash the engine (signal 11). Creating dummy nodes ensures all
  // labels exist before concurrent indexing starts. The dummy nodes are
  // immediately deleted.
  // ALL_GRAPH_LABELS is the shared source of truth (packages/types/src/labels.ts)
  // for every label FalkorDB may ever see written to it.
  const createDummies = ALL_GRAPH_LABELS.map(l => `CREATE (:${l} {__dummy: true})`).join(' ');
  try {
    await graph.query(createDummies);
    // Delete the dummy nodes
    await graph.query(`MATCH (n {__dummy: true}) DELETE n`);
  } catch {
    // Non-fatal — labels may already exist
  }

  // --- Range indexes (lookup by exact value) ---
  await safeIndex(`CREATE INDEX FOR (f:File) ON (f.filePath)`);
  for (const label of SYMBOL_LABELS) {
    if (label === 'File') continue;
    await safeIndex(`CREATE INDEX FOR (n:${label}) ON (n.id)`);
    await safeIndex(`CREATE INDEX FOR (n:${label}) ON (n.projectId)`);
  }
  await safeIndex(`CREATE INDEX FOR (f:File) ON (f.projectId)`);
  await safeIndex(`CREATE INDEX FOR (d:MarkdownDocument) ON (d.projectId)`);

  // --- Commit & Metadata range indexes (git history / state tracking) ---
  await safeIndex(`CREATE INDEX FOR (c:Commit) ON (c.hash)`);
  await safeIndex(`CREATE INDEX FOR (m:Metadata) ON (m.key)`);

  // --- Provenance range indexes (query by pipeline/task) ---
  // EMBEDDABLE_LABELS is the shared source of truth (packages/types/src/labels.ts):
  // SYMBOL_LABELS plus 'Entity', the labels that carry ProvenanceFields.
  for (const label of EMBEDDABLE_LABELS) {
    await safeIndex(`CREATE INDEX FOR (n:${label}) ON (n.sourcePipeline)`);
    await safeIndex(`CREATE INDEX FOR (n:${label}) ON (n.processedAt)`);
  }

  // --- Document entity range indexes (markdown support) ---
  await safeIndex(`CREATE INDEX FOR (d:MarkdownDocument) ON (d.path)`);
  await safeIndex(`CREATE INDEX FOR (s:Section) ON (s.filePath)`);
  await safeIndex(`CREATE INDEX FOR (cb:CodeBlock) ON (cb.filePath)`);
  await safeIndex(`CREATE INDEX FOR (l:Link) ON (l.filePath)`);

  // --- Fulltext indexes (text search) ---
  // Use CALL procedure syntax (FalkorDB's native fulltext API)
  const fulltextTargets = ['Function', 'Class', 'Component', 'Interface', 'Type'];
  for (const label of fulltextTargets) {
    await safeIndex(`CALL db.idx.fulltext.createNodeIndex('${label}', 'name')`);
  }
  // Entity uses both 'name' and 'text'
  await safeIndex(`CALL db.idx.fulltext.createNodeIndex('Entity', 'name', 'text')`);

  // --- Entity(text, type) uniqueness ---
  // Every Entity read/write path in knowledge-operations.ts (UPSERT_ENTITY,
  // BATCH_UPSERT_ENTITIES, touchEntity, getRelationships, mergeEntities, ...)
  // treats {text, type} as the entity's identity key, upserting via MERGE.
  // MERGE only behaves atomically under concurrent writes when a real
  // constraint backs the pattern. Without one, two concurrent MERGEs that
  // each observe "no matching node yet" can each create a node, leaving two
  // physical nodes that share a key. mergeEntities detects and refuses that
  // case rather than corrupting data, but it cannot resolve it (text+type
  // cannot tell the two nodes apart): the constraint is what is supposed to
  // stop it from happening in the first place, so its absence until now was
  // itself a bug, not just a missing optimization.
  //
  // A FalkorDB UNIQUE constraint needs a prerequisite exact-match index on
  // the same properties, and applies asynchronously. Verified empirically
  // against a real embedded graph, since this is not documented in enough
  // detail to trust untested (both a throwaway probe here and, separately,
  // an adversarial review that built its own populated graph): if the label
  // already has data violating the constraint when it is created, the
  // command still returns without throwing, and the constraint settles into
  // a FAILED (not enforced) status instead of raising an error here, with
  // writes continuing to work throughout - status is only visible via
  // `CALL db.constraints()`, which this setup does not poll. That FAILED
  // state is not permanent, though: this setup runs on every connect (see
  // the "expected on restart" comment on safeIndex above), and once the
  // violating data is gone, a later call is not rejected as "already
  // exists" the way it would be for an already-OPERATIONAL constraint - it
  // retries and transitions to OPERATIONAL on its own, confirmed by
  // creating a constraint over conflicting data, deleting the conflict, and
  // calling constraintCreate again with no other intervention. So this is
  // best-effort forward protection that self-heals once the underlying data
  // problem is fixed (by node identity, cleaning up duplicate-keyed Entity
  // nodes - outside what mergeEntities' {text, type} API can do on its own),
  // rather than something that needs a manual migration step to recover.
  // mergeEntities' own cardinality guard, not this constraint, is what keeps
  // merges safe in the meantime, on any graph where the constraint has not
  // yet reached OPERATIONAL.
  await safeIndex(`CREATE INDEX FOR (n:Entity) ON (n.text, n.type)`);
  try {
    await graph.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, 'Entity', 'text', 'type');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Swallow "already exists" (expected on restart; empirically confirmed
    // wording: "Constraint already exists"). Anything else is unexpected
    // enough, unlike plain index setup, to be worth a log line, since a
    // silent failure here would otherwise be undetectable.
    if (!msg.includes('already exists')) {
      logger.warn(`Entity(text, type) uniqueness constraint setup failed: ${msg}`);
    }
  }

  // --- Vector indexes (HNSW for embedding similarity search) ---
  // Dimension is auto-detected from API keys (VOYAGE_API_KEY, OPENROUTER_API_KEY)
  // or explicit CODEGRAPH_EMBEDDING_PROVIDER override.
  // If no provider is configured, vector indexes are skipped entirely.
  // If existing indexes have a different dimension (e.g. user switched from
  // local/768 to voyage/1024), drop and recreate them + clear stale embeddings.
  const embDim = requestedProfile?.dimension ?? resolveEmbeddingDimension(opts?.embeddingDim);
  // EMBEDDABLE_LABELS is the shared source of truth (packages/types/src/labels.ts):
  // the same SYMBOL_LABELS-plus-'Entity' set the provenance indexes above use,
  // since every label that carries ProvenanceFields also carries an embedding.
  const vectorTargets = EMBEDDABLE_LABELS;

  if (embDim === 0) {
    if (requestedProfile) {
      await graph.query(
        `MERGE (m:Metadata {key: '${EMBEDDING_PROFILE_METADATA_KEY}'}) SET m.value = $value`,
        { params: { value: JSON.stringify(requestedProfile) } } as unknown as FalkorQueryOptions,
      );
    }
    return;
  }

  // Check for dimension mismatch on an existing index
  const dimensionMismatch = await detectDimensionMismatch(graph, vectorTargets[0]!, embDim);
  if (dimensionMismatch && !opts?.allowEmbeddingMigration) {
    const inferredStored: EmbeddingIndexProfile = {
      provider: dimensionMismatch.existing === 1024
        ? 'voyage'
        : dimensionMismatch.existing === 1536
          ? 'openrouter'
          : 'local',
      model: null,
      dimension: dimensionMismatch.existing,
    };
    const inferredRequested = requestedProfile ?? {
      provider: embDim === 1024 ? 'voyage' : embDim === 1536 ? 'openrouter' : 'local',
      model: null,
      dimension: embDim,
    };
    throw new EmbeddingProfileMismatchError(inferredStored, inferredRequested);
  }

  if (profileMismatch || dimensionMismatch) {
    for (const label of vectorTargets) {
      await safeQuery(graph, `DROP VECTOR INDEX FOR (n:${label}) ON (n.embedding)`);
    }
    await safeQuery(graph, `DROP VECTOR INDEX FOR ()-[r:RELATES_TO]-() ON (r.fact_embedding)`);

    for (const label of vectorTargets) {
      await safeQuery(
        graph,
        `MATCH (n:${label}) WHERE n.embedding IS NOT NULL OR n.embeddingTextHash IS NOT NULL ` +
          `SET n.embedding = NULL, n.embeddingTextHash = NULL`,
      );
    }
    await safeQuery(graph, `MATCH ()-[r:RELATES_TO]-() WHERE r.fact_embedding IS NOT NULL SET r.fact_embedding = NULL`);
  }

  for (const label of vectorTargets) {
    await safeIndex(
      `CREATE VECTOR INDEX FOR (n:${label}) ON (n.embedding) OPTIONS {dimension: ${embDim}, similarityFunction: 'cosine'}`,
      Boolean(profileMismatch || dimensionMismatch),
    );
  }

  // Vector index on RELATES_TO edge (fact_embedding for knowledge graph)
  await safeIndex(
    `CREATE VECTOR INDEX FOR ()-[r:RELATES_TO]-() ON (r.fact_embedding) OPTIONS {dimension: ${embDim}, similarityFunction: 'cosine'}`
  );

  if (requestedProfile) {
    await graph.query(
      `MERGE (m:Metadata {key: '${EMBEDDING_PROFILE_METADATA_KEY}'}) SET m.value = $value`,
      { params: { value: JSON.stringify(requestedProfile) } } as unknown as FalkorQueryOptions,
    );
  }
}

// ============================================================================
// Embedding dimension resolution
// ============================================================================

/**
 * Resolve the embedding dimension from the configured provider.
 * Priority: caller override > CODEGRAPH_EMBEDDING_DIM env > provider-based detection.
 */
function resolveEmbeddingDimension(override?: number): number {
  // Caller-provided override always wins (highest priority)
  if (override !== undefined) return override;

  // Map known providers to their fixed embedding dimensions.
  const PROVIDER_DIM: Record<string, number> = {
    voyage: 1024,
    openrouter: 1536,
    local: 768,
    none: 0,
  };

  const explicit = process.env['CODEGRAPH_EMBEDDING_DIM'];
  const provider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];

  // If both are set, they must agree. Silently honoring CODEGRAPH_EMBEDDING_DIM
  // when it conflicts with the provider's actual output dimension is a
  // foot-gun: vector index gets created at the wrong dim, every embedding
  // write succeeds (FalkorDB doesn't dim-check property writes), but every
  // vector search fails silently with "dimension mismatch" buried inside a
  // catch — the user sees only "0 results."
  if (explicit && provider && PROVIDER_DIM[provider] !== undefined) {
    const explicitDim = parseInt(explicit, 10);
    const providerDim = PROVIDER_DIM[provider]!;
    if (explicitDim !== providerDim) {
      throw new Error(
        `Embedding dimension conflict: CODEGRAPH_EMBEDDING_DIM=${explicitDim} ` +
        `but CODEGRAPH_EMBEDDING_PROVIDER=${provider} produces ${providerDim}-dim ` +
        `vectors. Either remove CODEGRAPH_EMBEDDING_DIM (let it derive from the ` +
        `provider) or change the provider to match the dim.`
      );
    }
    return explicitDim;
  }

  // Env var CODEGRAPH_EMBEDDING_DIM — explicit second priority (no provider set)
  if (explicit) return parseInt(explicit, 10);

  // Explicit provider env
  if (provider && PROVIDER_DIM[provider] !== undefined) {
    return PROVIDER_DIM[provider]!;
  }

  // Auto-detect from API keys
  if (process.env['VOYAGE_API_KEY']) return 1024;
  if (process.env['OPENROUTER_API_KEY']) return 1536;

  return 768;
}

/**
 * Check if existing vector indexes have a different dimension than what
 * the current provider requires. Returns the existing dimension if there's
 * a mismatch, null if dimensions match or no index exists yet.
 */
async function detectDimensionMismatch(
  graph: Graph,
  sampleLabel: string,
  expectedDim: number,
): Promise<{ existing: number } | null> {
  try {
    // Try to query the vector index with a probe vector of the expected dimension.
    // If the index exists with a different dimension, FalkorDB will error.
    const probeVec = new Array(expectedDim).fill(0);
    probeVec[0] = 1; // non-zero to avoid degenerate case
    await graph.roQuery(
      `CALL db.idx.vector.queryNodes('${sampleLabel}', 'embedding', 1, vecf32($vec)) YIELD node RETURN node LIMIT 0`,
      { params: { vec: probeVec } } as any,
    );
    // Success — dimensions match (or no index/data yet)
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    // FalkorDB errors on dimension mismatch: "Vector dimension mismatch" or similar
    if (msg.includes('dimension') || msg.includes('Dimension') || msg.includes('length')) {
      // Try to extract existing dimension from error or try common dimensions
      const existingDim = await probeExistingDimension(graph, sampleLabel);
      return existingDim ? { existing: existingDim } : { existing: -1 };
    }
    // Index doesn't exist yet — no mismatch
    return null;
  }
}

/**
 * Probe which dimension the existing vector index uses by trying common sizes.
 */
async function probeExistingDimension(graph: Graph, label: string): Promise<number | null> {
  for (const dim of [768, 1024, 1536, 2048]) {
    try {
      const probeVec = new Array(dim).fill(0);
      probeVec[0] = 1;
      await graph.roQuery(
        `CALL db.idx.vector.queryNodes('${label}', 'embedding', 1, vecf32($vec)) YIELD node RETURN node LIMIT 0`,
        { params: { vec: probeVec } } as any,
      );
      return dim; // This dimension worked
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Run a query, ignoring any errors (for DROP INDEX etc.)
 */
async function safeQuery(graph: Graph, cypher: string): Promise<void> {
  try {
    await graph.query(cypher);
  } catch {
    // Ignore — index may not exist
  }
}
