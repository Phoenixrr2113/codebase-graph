/**
 * Enriched Search V2 — Vector retrieval + cross-encoder reranking.
 *
 * Philosophy: use existing tools well instead of writing custom logic.
 * Vector embeddings find candidates, cross-encoder reranker ranks them.
 * No manual NLP, no text scoring, no magic thresholds, no node type biases.
 *
 * Pipeline: query → embed → vector search (wide pool) → reranker → results
 */

import { createLogger, traced } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { createOperations } from '@codegraph/graph';
import {
  generateEmbedding,
  isEmbeddingAvailable,
  rerank,
  getLastRerankWarning,
  clearLastRerankWarning,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';
import { searchCache, searchCacheKey } from './searchCache';

const logger = createLogger({ namespace: 'core:enriched-v2' });

// ============================================================================
// Types
// ============================================================================

export interface EnrichedV2Result {
  hits: EnrichedV2Hit[];
  meta: {
    query: string;
    vectorHits: number;
    durationMs: number;
    /** Set when search cannot run — explains why and what to do instead */
    notice?: string;
  };
}

export interface LinkedKnowledgeEntry {
  entityText: string;
  entityType: string;
  confidence: number;
  fact?: string | undefined;
}

export interface SiblingSymbol {
  id: string;
  name: string;
  startLine: number;
  endLine: number;
  signature?: string;
  nodeType?: string;
}

export interface EnrichedV2Hit {
  id: string;
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  isExported?: boolean;
  isAsync?: boolean;
  params?: string;
  returnType?: string;
  signature?: string;
  docstring?: string;
  bodySnippet?: string;
  complexity?: number;
  cognitiveComplexity?: number;
  loc?: number;
  callerCount?: number;
  callees?: string[];
  importerCount?: number;
  /** Number of test files that reference this symbol (via CALLS or IMPORTS) */
  testReferenceCount?: number;
  /** Shortest dependency chain length from entry points to this symbol */
  dependencyDepth?: number;
  /** ISO date of the most recent commit modifying the file containing this symbol */
  lastModified?: string;
  /** Total number of commits that modified the file containing this symbol */
  commitCount?: number;
  /** Knowledge entities linked to this code node via ABOUT edges */
  linkedKnowledge?: LinkedKnowledgeEntry[];
  /** ±1 sibling symbols in the same file (drawer-grep expansion) */
  siblings?: SiblingSymbol[];
}

export interface EnrichedV2Options {
  limit?: number;
  /** Single path prefix to scope results to */
  scope?: string;
  /** Multiple path prefixes to scope results to (for multi-project filtering) */
  scopePaths?: string[];
  embeddings?: EmbeddingConfig;
  /** Disable the reranker (vector-only mode for testing) */
  skipReranker?: boolean;
}

// Dynamic discovery: find which node labels actually have embeddings.
// Cached after first call per graph — invalidated on reindex via clearEmbeddedLabelCache().
const _embeddedLabelsCache = new Map<string, string[]>();

export async function getEmbeddedLabels(client: GraphClient): Promise<string[]> {
  const graphId = client.graphName;
  const cached = _embeddedLabelsCache.get(graphId);
  if (cached) return cached;
  try {
    // Find which labels have nodes with embeddings
    const result = await client.roQuery<{ label: string }>(
      `MATCH (n) WHERE n.embedding IS NOT NULL
       WITH labels(n)[0] AS label
       RETURN DISTINCT label ORDER BY label`
    );
    // Only include code node types that support vector search
    const validLabels = new Set(['Function', 'Class', 'Interface', 'Component', 'Variable', 'Type', 'File']);
    const labels = result.data.map(r => r.label).filter(l => validLabels.has(l));
    _embeddedLabelsCache.set(graphId, labels);
    logger.info(`Discovered embedded labels for ${graphId}: ${labels.join(', ')}`);
    return labels;
  } catch {
    // Fallback: common labels that typically have embeddings
    const fallback = ['Function', 'Class', 'Interface', 'Component'];
    _embeddedLabelsCache.set(graphId, fallback);
    logger.warn('Failed to discover embedded labels, using fallback');
    return fallback;
  }
}

/** Call after reindex to refresh the label cache. Pass graphId to clear one entry, omit to clear all. */
export function clearEmbeddedLabelCache(graphId?: string): void {
  if (graphId) {
    _embeddedLabelsCache.delete(graphId);
  } else {
    _embeddedLabelsCache.clear();
  }
}

// ============================================================================
// Reciprocal Rank Fusion (generic)
//
// For fusing results from *different* retrieval methods (e.g., vector search
// + graph traversal + keyword search). Not currently used — vector + reranker
// is a linear blend because they rank the same candidate pool.
//
// score(item) = Σ weight_i / (k + rank_i)
// k=60 is the standard default (Cormack et al. 2009, Elasticsearch, OpenSearch, Qdrant).
// ============================================================================

export interface RankedList<T> {
  /** Items sorted best-first */
  items: T[];
  /** Weight for this source (default: 1) */
  weight?: number;
  /**
   * Optional per-item weight (0.0–1.0+). Multiplied into the RRF contribution
   * before the rank-position discount. Use to apply a confidence/relevance
   * boost or penalty to individual items. Defaults to 1.0 when omitted.
   */
  scoreOf?: (item: T) => number;
}

/**
 * Generic RRF: fuses ranked lists into a single scored ranking.
 * Returns items sorted by fused score descending.
 */
export function rrfFuse<T>(
  lists: RankedList<T>[],
  key: (item: T) => string,
  k: number = 60,
): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    const scoreOf = list.scoreOf;
    for (let i = 0; i < list.items.length; i++) {
      const item = list.items[i]!;
      const id = key(item);
      const itemScore = scoreOf ? scoreOf(item) : 1;
      const contribution = (weight * itemScore) / (k + i + 1); // 1-based rank
      const existing = scores.get(id);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(id, { item, score: contribution });
      }
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}

// ============================================================================
// Graph enrichment — batch fetch relationship data for top hits
// ============================================================================

/**
 * Ceiling for the optional enrichment queries below. None of them is required
 * for a correct answer; they only decorate hits with relationship signals. A
 * slow graph should cost the decoration, never the search itself.
 */
const ENRICHMENT_TIMEOUT_MS = 5_000;

/**
 * Shortest dependency chain from an entry point (a File nothing imports) to a
 * symbol, bounded to six hops.
 *
 * The plain MATCH is deliberate and load-bearing. Under OPTIONAL MATCH, proving
 * that *no* path exists costs a full enumeration of the symbol's six-hop
 * neighbourhood. On a hub symbol in recursive code that never finishes: zod's
 * `_parse` resolves to 38 nodes carrying 1406 inbound and 2340 outbound CALLS
 * edges, and the enumeration ran past 120s while every other symbol in the same
 * batch answered in under a millisecond. Because FalkorDB serves one query at a
 * time, that stalled the whole search rather than just this one field.
 *
 * A plain MATCH yields no row for unreachable symbols, which is exactly what the
 * caller already treats as "depth unknown", so the answers are unchanged: across
 * 400 zod symbols the two forms agreed on all 388 the old query could finish,
 * and the rewrite dropped the batch from 240s to 0.4s.
 */
export const DEPENDENCY_DEPTH_CYPHER = `
  UNWIND $ids AS symbolId
  MATCH path = (entry:File)-[:CONTAINS|CALLS*1..6]->(n {id: symbolId})
  WHERE NOT ()-[:IMPORTS]->(entry)
  RETURN symbolId, min(length(path)) AS minDepth
`;

interface GraphEnrichment {
  callerCount: number;
  callees: string[];
  importerCount: number;
  testReferenceCount: number;
  dependencyDepth: number | null;
  lastModified: string | null;
  commitCount: number;
}

/** Use the persisted opaque identity for enrichment lookups. */
export function enrichmentKey(id: string): string {
  return id;
}

export async function enrichFromGraph(
  client: GraphClient,
  hits: Candidate[],
): Promise<Map<string, GraphEnrichment>> {
  if (hits.length === 0) return new Map();

  const ids = hits.map(hit => hit.id);
  const items = hits.map(hit => ({ id: hit.id }));

  // Single batch query: for each hit, count callers, callees, importers,
  // test references (files with test/spec in path), and dependency depth.
  //
  // `n` is bound by its own persisted ID before any OPTIONAL
  // expansion runs. It used to be bound inside the first OPTIONAL MATCH,
  // alongside the caller edge: `OPTIONAL MATCH (n {name: symbolName})<-[:CALLS]-(caller)`.
  // When a symbol had no callers that whole pattern failed to match, so `n`
  // came out null, and every clause after it (including the callees
  // expansion) computed against null. A function that calls other functions
  // but is called by nobody reported zero callees.
  //
  // A plain MATCH can't hang the way the one in DEPENDENCY_DEPTH_CYPHER
  // could: this is a single-hop exact-property lookup, not a bounded path
  // search over a densely connected hub, so there's no enumeration to blow
  // up. The one behavior change is that an ID with no matching node now
  // produces no row at all, instead of a row of zeros. Every call site below
  // that reads this map already treats a missing entry as "no enrichment for
  // this hit" (see the `.get(...)` calls in enrichedSearchV2Impl), so that's
  // safe: it degrades the same way `dependencyDepth` already does for an
  // unreachable symbol.
  const cypher = `
    UNWIND $items AS item
    MATCH (n {id: item.id})
    OPTIONAL MATCH (n)<-[:CALLS]-(caller)
    WITH item, n, count(DISTINCT caller) AS callers
    OPTIONAL MATCH (n)-[:CALLS]->(callee)
    WITH item, n, callers, collect(DISTINCT callee.name)[0..5] AS calleeNames
    OPTIONAL MATCH (n)<-[:IMPORTS]-(importer)
    WITH item, n, callers, calleeNames, count(DISTINCT importer) AS importers
    OPTIONAL MATCH (testFile:File)
      WHERE (testFile.filePath CONTAINS '.test.' OR testFile.filePath CONTAINS '.spec.' OR testFile.filePath CONTAINS '__tests__')
        AND ((testFile)-[:CONTAINS]->()-[:CALLS]->(n)
          OR (testFile)-[:IMPORTS]->()-[:CONTAINS]->(n))
    WITH item.id AS symbolId,
         callers, calleeNames, importers, count(DISTINCT testFile) AS testRefs
    RETURN symbolId, callers, calleeNames, importers, testRefs
  `;

  try {
    const result = await client.roQuery<Record<string, unknown>>(cypher, {
      params: { items },
      timeout: ENRICHMENT_TIMEOUT_MS,
    });

    const map = new Map<string, GraphEnrichment>();
    for (const row of result.data) {
      const key = enrichmentKey(row['symbolId'] as string);
      map.set(key, {
        callerCount: (row['callers'] as number) ?? 0,
        callees: (row['calleeNames'] as string[]) ?? [],
        importerCount: (row['importers'] as number) ?? 0,
        testReferenceCount: (row['testRefs'] as number) ?? 0,
        dependencyDepth: null,
        lastModified: null,
        commitCount: 0,
      });
    }

    // Dependency depth is keyed by the same persisted ID as the hit.
    try {
      const depthResult = await client.roQuery<Record<string, unknown>>(DEPENDENCY_DEPTH_CYPHER, {
        params: { ids },
        timeout: ENRICHMENT_TIMEOUT_MS,
      });
      const depthById = new Map<string, number>();
      for (const row of depthResult.data) {
        if (row['minDepth'] != null) {
          depthById.set(row['symbolId'] as string, row['minDepth'] as number);
        }
      }
      for (const hit of hits) {
        const depth = depthById.get(hit.id);
        if (depth == null) continue;
        const enrichment = map.get(enrichmentKey(hit.id));
        if (enrichment) enrichment.dependencyDepth = depth;
      }
    } catch (err) {
      logger.debug(`Dependency depth query failed (non-fatal): ${err}`);
    }

    // Git churn: last modified date and commit count per file.
    // Uses MODIFIED_IN edges from File to Commit (created by syncGitHistory).
    try {
      const filePaths = hits.map(h => h.filePath).filter(Boolean) as string[];
      if (filePaths.length > 0) {
        const gitCypher = `
          UNWIND $filePaths AS fp
          MATCH (f:File {filePath: fp})-[:MODIFIED_IN]->(c:Commit)
          WITH fp, max(c.date) AS lastMod, count(c) AS commits
          RETURN fp, lastMod, commits
        `;
        const gitResult = await client.roQuery<Record<string, unknown>>(gitCypher, {
          params: { filePaths },
          timeout: ENRICHMENT_TIMEOUT_MS,
        });
        // Build filePath -> git data map, then assign to hits by filePath
        const gitByFile = new Map<string, { lastModified: string; commitCount: number }>();
        for (const row of gitResult.data) {
          gitByFile.set(row['fp'] as string, {
            lastModified: row['lastMod'] as string,
            commitCount: row['commits'] as number,
          });
        }
        for (const hit of hits) {
          if (hit.filePath) {
            const gitData = gitByFile.get(hit.filePath);
            const enrichment = map.get(enrichmentKey(hit.id));
            if (gitData && enrichment) {
              enrichment.lastModified = gitData.lastModified;
              enrichment.commitCount = gitData.commitCount;
            }
          }
        }
      }
    } catch (err) {
      logger.debug(`Git churn query failed (non-fatal): ${err}`);
    }

    return map;
  } catch (err) {
    logger.warn(`Graph enrichment failed: ${err}`);
    return new Map();
  }
}

// ============================================================================
// Vector search — candidate retrieval
// ============================================================================

function distanceToScore(distance: number): number {
  return Math.max(0, 1 - distance / 2);
}

export interface Candidate {
  id: string;
  name: string;
  nodeType: string;
  filePath?: string | undefined;
  startLine?: number | undefined;
  properties: Record<string, unknown>;
  vectorScore: number;
  score: number;
}

/** Key function for rrfFuse when combining retrieval sources */
export function candidateKey(c: Candidate): string {
  return c.id;
}

/**
 * Heuristic detection of test files across language conventions.
 * Patterns covered:
 *   - /tests/ or /test/ directory anywhere in the path (Python, Java, Rust, ...)
 *   - /__tests__/ (Jest convention)
 *   - foo_test.<ext> (Go, Python pytest, Ruby)
 *   - foo.test.<ext> (TypeScript/JavaScript)
 *   - foo.spec.<ext> (TypeScript/JavaScript Jasmine/Mocha)
 *   - foo.test_<ext> / foo_spec.<ext> (Ruby, Python edge cases)
 */
export function isTestPath(filePath: string): boolean {
  return (
    /\/tests?\//i.test(filePath) ||
    /\/__tests__\//i.test(filePath) ||
    /[._]test\.[a-z]+$/i.test(filePath) ||
    /\.spec\.[a-z]+$/i.test(filePath) ||
    /[._]spec\.[a-z]+$/i.test(filePath)
  );
}

/**
 * Check if a file path matches a single scope prefix.
 * Handles both absolute paths (/Users/.../apps/web) and
 * relative paths (apps/web) by using suffix matching with
 * path separator awareness for relative scopes.
 */
function pathMatchesPrefix(filePath: string, prefix: string): boolean {
  if (prefix.startsWith('/')) {
    return filePath.startsWith(prefix);
  }
  // Relative scope: match against any path segment boundary
  // e.g. scope "apps/web" matches "/Users/.../apps/web/components/foo.tsx"
  return filePath.includes(`/${prefix}/`) || filePath.includes(`/${prefix}`);
}

/**
 * Check if a file path matches the scope filter.
 * Returns true if the path should be INCLUDED.
 */
function matchesScope(
  filePath: string | undefined,
  scope: string | undefined,
  scopePaths: string[] | undefined,
): boolean {
  if (!filePath) return true; // No path to filter on — include
  if (scope) return pathMatchesPrefix(filePath, scope);
  if (scopePaths && scopePaths.length > 0) {
    return scopePaths.some(sp => pathMatchesPrefix(filePath, sp));
  }
  return true; // No scope — include all
}

async function retrieveCandidates(
  client: GraphClient,
  query: string,
  limit: number,
  scope: string | undefined,
  scopePaths: string[] | undefined,
  embeddings?: EmbeddingConfig,
): Promise<Candidate[]> {
  if (!isEmbeddingAvailable(embeddings)) return [];

  let queryEmbedding: number[];
  try {
    const result = await generateEmbedding(query, { ...embeddings, inputType: 'query' });
    queryEmbedding = result.embedding;
  } catch (err) {
    logger.warn(`Failed to embed query: ${err}`);
    return [];
  }

  const ops = createOperations(client);
  const labels = await getEmbeddedLabels(client);
  // Wider pool = more candidates for the reranker to choose from.
  // Per-type vector pool size. Floor of 40 (was 20) accommodates limit=10
  // queries on real OSS corpora where the gold function may rank deeper than
  // 20 by raw vector similarity but be readily recognizable to the
  // cross-encoder once it sees the candidate.
  const perTypeLimit = Math.max(40, Math.ceil(limit * 10 / labels.length));

  const allResults = await Promise.all(
    labels.map(nt => ops.searchByVector(nt as any, queryEmbedding, perTypeLimit)),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const results of allResults) {
    for (const r of results) {
      if (!matchesScope(r.filePath, scope, scopePaths)) continue;

      const persistedId = typeof r.properties?.['id'] === 'string'
        ? r.properties['id']
        : r.nodeType === 'File' ? `File:${r.filePath}` : undefined;
      if (!persistedId || seen.has(persistedId)) continue;
      seen.add(persistedId);

      const vScore = distanceToScore(r.distance);
      // r.properties contains the full row from searchByVector (all node fields)
      const props = r.properties ?? {};
      candidates.push({
        id: persistedId,
        name: r.name,
        nodeType: r.nodeType,
        filePath: r.filePath,
        startLine: r.startLine,
        properties: props,
        vectorScore: vScore,
        score: vScore,
      });
    }
  }

  return candidates;
}

// ============================================================================
// Main search function
// ============================================================================

/**
 * Batch lookup: find knowledge entities linked to code nodes via ABOUT edges (reverse direction).
 * Returns a map of code node name → linked knowledge entities.
 */
async function getLinkedKnowledge(
  client: GraphClient,
  ids: string[],
): Promise<Map<string, LinkedKnowledgeEntry[]>> {
  const result = new Map<string, LinkedKnowledgeEntry[]>();
  if (ids.length === 0) return result;

  try {
    // Reverse ABOUT: (Entity)-[ABOUT]->(CodeNode) — find entities pointing at these code nodes
    const rows = await client.roQuery<{
      targetId: string;
      entityText: string;
      entityType: string;
      confidence: number;
      fact: string | null;
    }>(
      `UNWIND $ids AS targetId
       MATCH (e:Entity)-[r:ABOUT]->(t)
       WHERE t.id = targetId
       OPTIONAL MATCH (e)-[rel:RELATES_TO]-()
       WHERE rel.invalid_at IS NULL
       RETURN targetId, e.text AS entityText, e.type AS entityType,
              r.confidence AS confidence, rel.fact AS fact
       LIMIT 100`,
      { params: { ids }, timeout: ENRICHMENT_TIMEOUT_MS },
    );

    for (const row of rows.data) {
      const existing = result.get(row.targetId) ?? [];
      existing.push({
        entityText: row.entityText,
        entityType: row.entityType,
        confidence: row.confidence,
        ...(row.fact != null ? { fact: row.fact } : {}),
      });
      result.set(row.targetId, existing);
    }
  } catch (error) {
    logger.debug(`Linked knowledge query failed (non-fatal): ${error}`);
  }

  return result;
}

// ============================================================================
// Sibling expansion — drawer-grep ±1 pattern (mempalace searcher.py:175-236)
// ============================================================================

const SIBLING_SIGNATURE_CAP = 5_000; // bytes per sibling signature
const SIBLING_AGGREGATE_CAP = 10_000; // bytes aggregate siblings JSON per hit

/**
 * Fetch the ±1 sibling symbols (prev + next by startLine) of a target symbol
 * within the same file, using CONTAINS edges from the File node.
 *
 * Returns an array of 0–2 siblings. Empty when the file has only one symbol
 * or the target ID is not found.
 *
 * NOTE: File nodes use `filePath` as the property key (not `path`).
 */
export async function fetchSiblingSymbols(
  client: GraphClient,
  filePath: string,
  symbolId: string,
): Promise<SiblingSymbol[]> {
  const cypher = `
    MATCH (f:File)-[:CONTAINS]->(s)
    WHERE f.filePath = $filePath AND s.startLine IS NOT NULL
    RETURN s.id AS id, s.name AS name, s.startLine AS startLine, s.endLine AS endLine,
           s.signature AS signature, labels(s)[0] AS nodeType
    ORDER BY s.startLine
  `;
  let data: Array<Record<string, unknown>>;
  try {
    const res = await client.roQuery<Record<string, unknown>>(cypher, {
      params: { filePath },
      timeout: ENRICHMENT_TIMEOUT_MS,
    });
    data = res.data ?? [];
  } catch (err) {
    logger.debug(`fetchSiblingSymbols query failed (non-fatal): ${err}`);
    return [];
  }

  const idx = data.findIndex(
    symbol => symbol['id'] === symbolId,
  );
  if (idx === -1) return [];

  const out: SiblingSymbol[] = [];
  const prevRow = idx > 0 ? data[idx - 1] : undefined;
  const nextRow = idx < data.length - 1 ? data[idx + 1] : undefined;

  for (const row of [prevRow, nextRow]) {
    if (!row) continue;
    let sig = row['signature'] as string | undefined;
    if (sig && sig.length > SIBLING_SIGNATURE_CAP) {
      sig = sig.slice(0, SIBLING_SIGNATURE_CAP);
    }
    out.push({
      id: row['id'] as string,
      name: row['name'] as string,
      startLine: row['startLine'] as number,
      endLine: row['endLine'] as number,
      ...(sig != null ? { signature: sig } : {}),
      ...(row['nodeType'] != null ? { nodeType: row['nodeType'] as string } : {}),
    });
  }

  return out;
}

/**
 * Batch-fetch siblings for multiple hits, grouping by unique filePath to
 * minimize graph round-trips. Returns a map of persisted symbol ID to siblings.
 */
async function fetchSiblingsForHits(
  client: GraphClient,
  hits: Array<{ id: string; filePath?: string | undefined }>,
): Promise<Map<string, SiblingSymbol[]>> {
  const result = new Map<string, SiblingSymbol[]>();
  if (hits.length === 0) return result;

  // Group hits by unique filePath
  const byFile = new Map<string, Array<{ id: string }>>();
  for (const hit of hits) {
    if (!hit.filePath) continue;
    const existing = byFile.get(hit.filePath);
    if (existing) {
      existing.push({ id: hit.id });
    } else {
      byFile.set(hit.filePath, [{ id: hit.id }]);
    }
  }

  if (byFile.size === 0) return result;

  // Fetch the symbol list for each unique file in parallel
  await Promise.all(
    Array.from(byFile.entries()).map(async ([filePath, hitsInFile]) => {
      const cypher = `
        MATCH (f:File)-[:CONTAINS]->(s)
        WHERE f.filePath = $filePath AND s.startLine IS NOT NULL
        RETURN s.id AS id, s.name AS name, s.startLine AS startLine, s.endLine AS endLine,
               s.signature AS signature, labels(s)[0] AS nodeType
        ORDER BY s.startLine
      `;
      let rows: Array<Record<string, unknown>>;
      try {
        const res = await client.roQuery<Record<string, unknown>>(cypher, {
          params: { filePath },
          timeout: ENRICHMENT_TIMEOUT_MS,
        });
        rows = res.data ?? [];
      } catch (err) {
        logger.debug(`fetchSiblingsForHits query failed for ${filePath} (non-fatal): ${err}`);
        return;
      }

      for (const { id } of hitsInFile) {
        const idx = rows.findIndex(row => row['id'] === id);
        if (idx === -1) {
          result.set(id, []);
          continue;
        }

        const siblings: SiblingSymbol[] = [];
        for (const row of [rows[idx - 1], rows[idx + 1]]) {
          if (!row) continue;
          let sig = row['signature'] as string | undefined;
          if (sig && sig.length > SIBLING_SIGNATURE_CAP) sig = sig.slice(0, SIBLING_SIGNATURE_CAP);
          siblings.push({
            id: row['id'] as string,
            name: row['name'] as string,
            startLine: row['startLine'] as number,
            endLine: row['endLine'] as number,
            ...(sig != null ? { signature: sig } : {}),
            ...(row['nodeType'] != null ? { nodeType: row['nodeType'] as string } : {}),
          });
        }

        // Cap aggregate size
        if (JSON.stringify(siblings).length > SIBLING_AGGREGATE_CAP) {
          // Keep only the first sibling if both together exceed the cap
          result.set(id, siblings.slice(0, 1));
        } else {
          result.set(id, siblings);
        }
      }
    }),
  );

  return result;
}

async function enrichedSearchV2Impl(
  query: string,
  client: GraphClient,
  options: EnrichedV2Options = {},
): Promise<EnrichedV2Result> {
  const start = Date.now();
  const limit = options.limit ?? 20;
  const scope = options.scope;
  const scopePaths = options.scopePaths;

  // Check if embeddings are available before attempting vector search
  if (!isEmbeddingAvailable(options.embeddings)) {
    return {
      hits: [],
      meta: {
        query,
        vectorHits: 0,
        durationMs: Date.now() - start,
        notice: 'Embedding provider is not configured. Set VOYAGE_API_KEY or CODEGRAPH_EMBEDDING_PROVIDER. Use the query tool for graph-based searches in the meantime.',
      },
    };
  }

  // LRU cache check — avoids duplicate calls during multi-tool-call agent turns.
  // Keyed on query + scope + limit + skipReranker (fields that fully determine the result set).
  // scopePaths is included via JSON to handle multi-project filtering.
  const cacheKeyParts: Parameters<typeof searchCacheKey>[0] = {
    graphId: client.graphName,
    query,
  };
  if (options.scope !== undefined) cacheKeyParts.scope = options.scope;
  if (options.limit !== undefined) cacheKeyParts.limit = options.limit;
  if (options.skipReranker !== undefined) cacheKeyParts.skipReranker = options.skipReranker;
  const cacheKey = searchCacheKey(cacheKeyParts) +
    (options.scopePaths ? '\x00' + JSON.stringify(options.scopePaths) : '');

  const cached = searchCache.get(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for query "${query.slice(0, 60)}"`);
    return cached;
  }

  // Check if any nodes have embeddings yet (fresh query, not cached)
  let embeddedCount = 0;
  try {
    const countResult = await client.roQuery<{ count: number }>(
      'MATCH (n) WHERE n.embedding IS NOT NULL RETURN count(n) AS count'
    );
    embeddedCount = countResult.data?.[0]?.count ?? 0;
  } catch { /* non-fatal */ }
  if (embeddedCount === 0) {
    return {
      hits: [],
      meta: {
        query,
        vectorHits: 0,
        durationMs: Date.now() - start,
        notice: 'No embeddings found in the graph yet. Embeddings are generated in the background after reindex — try again shortly. Use the query tool for graph-based searches in the meantime.',
      },
    };
  }

  const candidates = await retrieveCandidates(client, query, limit, scope, scopePaths, options.embeddings);

  if (candidates.length === 0) {
    // An active-project scope that matches nothing is the most common cause of
    // an unexpectedly empty result, so name it rather than returning silence.
    const activeScope = scope ?? (scopePaths && scopePaths.length > 0 ? scopePaths.join(', ') : undefined);
    const meta: EnrichedV2Result['meta'] = { query, vectorHits: 0, durationMs: Date.now() - start };
    if (activeScope !== undefined) {
      meta.notice =
        `No matches inside the active project scope (${activeScope}). ` +
        'Indexed code may live outside it. Retry with scope "all", or point the active project at the indexed path.';
    }
    return { hits: [], meta };
  }

  // Test-file demotion (1st pass): apply BEFORE pool selection so non-test
  // candidates have a fairer shot at making it into the rerank pool. Without
  // this, the top-30 by raw vector score on a corpus with extensive tests can
  // be all test functions, and the reranker never sees the implementation.
  // Applied multiplicatively so relative ordering within tests/non-tests holds.
  const testPenalty = parseFloat(process.env['CODEGRAPH_TEST_PENALTY'] ?? '0.7');
  if (testPenalty < 1.0) {
    for (const c of candidates) {
      if (c.filePath && isTestPath(c.filePath)) {
        c.vectorScore *= testPenalty;
        c.score = c.vectorScore;
      }
    }
  }

  // Sort by vector score for reranker pool selection
  candidates.sort((a, b) => b.score - a.score);

  // Enrich reranker pool with graph data BEFORE reranking
  // so the cross-encoder can see importance signals (callers, importers, exports)
  const prerankEnrichments = candidates.length >= 3
    ? await enrichFromGraph(client, candidates.slice(0, Math.max(limit * 4, 60)))
    : new Map<string, GraphEnrichment>();

  // Reranker: cross-encoder re-scores top candidates.
  //
  // Pool size: max(limit * 4, 60). Wider pool gives the cross-encoder more
  // candidates to choose from, which matters when vector retrieval ranks the
  // gold answer outside the top 30 (real psf-requests case: NL→code query
  // for "function that follows HTTP redirects" — gold sessions.py#resolve_redirects
  // ranked outside the previous 30-candidate pool because its embedding
  // didn't lexically match the natural-language query, even though the
  // cross-encoder would readily recognize it as the intended answer).
  if (!options.skipReranker && candidates.length >= 3) {
    const rerankPool = candidates.slice(0, Math.max(limit * 4, 60));
    const docs = rerankPool.map(c => {
      const parts: string[] = [`${c.nodeType}: ${c.name}`];
      if (c.filePath) {
        const relPath = c.filePath.replace(/^.*\/packages\//, 'packages/').replace(/^.*\/apps\//, 'apps/');
        parts.push(`File: ${relPath}`);
      }
      if (c.properties.isExported) parts.push('Exported: yes');
      if (c.properties.signature) parts.push(`Signature: ${String(c.properties.signature).slice(0, 200)}`);
      if (c.properties.docstring) parts.push(String(c.properties.docstring).slice(0, 300));
      // Graph signals help the reranker distinguish core code from leaf/UI code
      const ge = prerankEnrichments.get(enrichmentKey(c.id));
      if (ge) {
        const signals: string[] = [];
        if (ge.callerCount > 0) signals.push(`called by ${ge.callerCount} functions`);
        if (ge.importerCount > 0) signals.push(`imported by ${ge.importerCount} files`);
        if (ge.callees.length > 0) signals.push(`calls ${ge.callees.join(', ')}`);
        if (signals.length > 0) parts.push(`Graph: ${signals.join(', ')}`);
      }
      return parts.join('\n');
    });

    try {
      // Reranker warning state is module-level (packages/plugin-nlp/src/reranker.ts).
      // Safe for sequential search calls — one search at a time per process. If
      // searches ever become concurrent at the service layer (Promise.all over
      // multiple search() invocations), this pattern leaks warnings between them
      // and must be replaced with a per-call status returned from rerank().
      clearLastRerankWarning();
      const rerankResults = await rerank(query, docs, { topK: rerankPool.length });

      // Reranker score is the final score — it's a cross-encoder that sees
      // both query and document, strictly more informed than our retrieval scores.
      for (const rr of rerankResults) {
        rerankPool[rr.index]!.score = rr.relevanceScore;
      }

      // Test-file demotion (2nd pass): the cross-encoder reassigns scores
      // ignoring filePath, so re-apply the demotion after rerank. testPenalty
      // is read once at the top of this function.
      if (testPenalty < 1.0) {
        for (const c of rerankPool) {
          if (c.filePath && isTestPath(c.filePath)) {
            c.score *= testPenalty;
          }
        }
      }

      rerankPool.sort((a, b) => b.score - a.score);
      candidates.splice(0, rerankPool.length, ...rerankPool);
    } catch (err) {
      logger.warn(`Reranker failed, using vector scores: ${err}`);
    }
  }

  const topHits = candidates.slice(0, limit);

  // Reuse pre-rank enrichments; fetch any missing (e.g., if reranker was skipped)
  let enrichments = prerankEnrichments;
  const missingHits = topHits.filter(hit => !enrichments.has(enrichmentKey(hit.id)));
  if (missingHits.length > 0) {
    const extra = await enrichFromGraph(client, missingHits);
    for (const [k, v] of extra) enrichments.set(k, v);
  }

  // Enrich with linked knowledge (ABOUT edges: knowledge → code)
  const knowledgeLinks = await getLinkedKnowledge(client, topHits.map(hit => hit.id));

  // Drawer-grep: fetch ±1 sibling symbols per hit, batched by unique filePath
  const siblingMap = await fetchSiblingsForHits(client, topHits);

  const durationMs = Date.now() - start;

  logger.info(
    `Enriched V2 search "${query.slice(0, 60)}": ${topHits.length} hits ` +
    `(${candidates.length} vector) in ${durationMs}ms`,
  );

  // Capture any reranker warning before building the result
  const rerankWarning = getLastRerankWarning();

  const result: EnrichedV2Result = {
    hits: topHits.map(c => {
      const graphData = enrichments.get(enrichmentKey(c.id));
      const props = c.properties;
      return {
        id: c.id,
        name: c.name,
        nodeType: c.nodeType,
        ...(c.filePath && { filePath: c.filePath }),
        ...(c.startLine != null && { startLine: c.startLine }),
        ...(props.endLine != null ? { endLine: props.endLine as number } : {}),
        ...(props.isExported != null ? { isExported: props.isExported as boolean } : {}),
        ...(props.isAsync != null ? { isAsync: props.isAsync as boolean } : {}),
        ...(props.params ? { params: props.params as string } : {}),
        ...(props.returnType ? { returnType: props.returnType as string } : {}),
        ...(props.signature ? { signature: props.signature as string } : {}),
        ...(props.docstring ? { docstring: props.docstring as string } : {}),
        ...(props.bodySnippet ? { bodySnippet: props.bodySnippet as string } : {}),
        ...(props.complexity != null ? { complexity: props.complexity as number } : {}),
        ...(props.cognitiveComplexity != null ? { cognitiveComplexity: props.cognitiveComplexity as number } : {}),
        ...(props.loc != null ? { loc: props.loc as number } : {}),
        // Graph enrichment (batch query)
        ...(graphData && {
          callerCount: graphData.callerCount,
          callees: graphData.callees,
          importerCount: graphData.importerCount,
          ...(graphData.testReferenceCount > 0 && { testReferenceCount: graphData.testReferenceCount }),
          ...(graphData.dependencyDepth != null && { dependencyDepth: graphData.dependencyDepth }),
          ...(graphData.lastModified && { lastModified: graphData.lastModified }),
          ...(graphData.commitCount > 0 && { commitCount: graphData.commitCount }),
        }),
        // Knowledge graph enrichment (ABOUT edges)
        ...(knowledgeLinks.has(c.id) ? { linkedKnowledge: knowledgeLinks.get(c.id)! } : {}),
        // Drawer-grep: ±1 sibling symbols in the same file
        ...((): { siblings?: SiblingSymbol[] } => {
          const sibs = siblingMap.get(c.id);
          return sibs && sibs.length > 0 ? { siblings: sibs } : {};
        })(),
      };
    }),
    meta: {
      query,
      vectorHits: candidates.length,
      durationMs,
      ...(rerankWarning ? { notice: rerankWarning } : {}),
    },
  };

  searchCache.set(cacheKey, result);
  return result;
}

export const enrichedSearchV2 = traced('enrichedSearchV2', enrichedSearchV2Impl);
