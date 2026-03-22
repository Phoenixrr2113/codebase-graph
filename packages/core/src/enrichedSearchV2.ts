/**
 * Enriched Search V2 — Vector retrieval + cross-encoder reranking.
 *
 * Philosophy: use existing tools well instead of writing custom logic.
 * Vector embeddings find candidates, cross-encoder reranker ranks them.
 * No manual NLP, no text scoring, no magic thresholds, no node type biases.
 *
 * Pipeline: query → embed → vector search (wide pool) → reranker → results
 */

import { createLogger } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { createOperations } from '@codegraph/graph';
import {
  generateEmbedding,
  isEmbeddingAvailable,
  rerank,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';

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

export interface EnrichedV2Hit {
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
// Cached after first call — invalidated on reindex via clearEmbeddedLabelCache().
let _embeddedLabelsCache: string[] | null = null;

async function getEmbeddedLabels(client: GraphClient): Promise<string[]> {
  if (_embeddedLabelsCache) return _embeddedLabelsCache;
  try {
    // Find which labels have nodes with embeddings
    const result = await client.roQuery<{ label: string }>(
      `MATCH (n) WHERE n.embedding IS NOT NULL
       WITH labels(n)[0] AS label
       RETURN DISTINCT label ORDER BY label`
    );
    // Only include code node types that support vector search
    const validLabels = new Set(['Function', 'Class', 'Interface', 'Component', 'Variable', 'Type', 'File']);
    _embeddedLabelsCache = result.data.map(r => r.label).filter(l => validLabels.has(l));
    logger.info(`Discovered embedded labels: ${_embeddedLabelsCache.join(', ')}`);
  } catch {
    // Fallback: common labels that typically have embeddings
    _embeddedLabelsCache = ['Function', 'Class', 'Interface', 'Component'];
    logger.warn('Failed to discover embedded labels, using fallback');
  }
  return _embeddedLabelsCache;
}

/** Call after reindex to refresh the label cache */
export function clearEmbeddedLabelCache(): void {
  _embeddedLabelsCache = null;
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
    for (let i = 0; i < list.items.length; i++) {
      const item = list.items[i]!;
      const id = key(item);
      const contribution = weight / (k + i + 1); // 1-based rank
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

interface GraphEnrichment {
  callerCount: number;
  callees: string[];
  importerCount: number;
  testReferenceCount: number;
  dependencyDepth: number | null;
  lastModified: string | null;
  commitCount: number;
}

async function enrichFromGraph(
  client: GraphClient,
  hits: Candidate[],
): Promise<Map<string, GraphEnrichment>> {
  if (hits.length === 0) return new Map();

  const names = hits.map(h => h.name);

  // Single batch query: for each hit, count callers, callees, importers,
  // test references (files with test/spec in path), and dependency depth
  const cypher = `
    UNWIND $names AS symbolName
    OPTIONAL MATCH (n {name: symbolName})<-[:CALLS]-(caller)
    WITH symbolName, n, count(DISTINCT caller) AS callers
    OPTIONAL MATCH (n)-[:CALLS]->(callee)
    WITH symbolName, n, callers, collect(DISTINCT callee.name)[0..5] AS calleeNames
    OPTIONAL MATCH (n)<-[:IMPORTS]-(importer)
    WITH symbolName, n, callers, calleeNames, count(DISTINCT importer) AS importers
    OPTIONAL MATCH (testFile:File)
      WHERE (testFile.filePath CONTAINS '.test.' OR testFile.filePath CONTAINS '.spec.' OR testFile.filePath CONTAINS '__tests__')
        AND ((testFile)-[:CONTAINS]->()-[:CALLS]->(n)
          OR (testFile)-[:IMPORTS]->()-[:CONTAINS]->(n))
    WITH symbolName, callers, calleeNames, importers, count(DISTINCT testFile) AS testRefs
    RETURN symbolName, callers, calleeNames, importers, testRefs
  `;

  try {
    const result = await client.roQuery<Record<string, unknown>>(cypher, {
      params: { names },
    });

    const map = new Map<string, GraphEnrichment>();
    for (const row of result.data) {
      map.set(row['symbolName'] as string, {
        callerCount: (row['callers'] as number) ?? 0,
        callees: (row['calleeNames'] as string[]) ?? [],
        importerCount: (row['importers'] as number) ?? 0,
        testReferenceCount: (row['testRefs'] as number) ?? 0,
        dependencyDepth: null,
        lastModified: null,
        commitCount: 0,
      });
    }

    // Dependency depth: shortest path from any entry point (file with no importers)
    // Run as a separate bounded query to avoid blowing up the main query
    try {
      const depthCypher = `
        UNWIND $names AS symbolName
        MATCH (n {name: symbolName})
        OPTIONAL MATCH path = (entry)-[:CONTAINS|CALLS*1..6]->(n)
          WHERE entry:File AND NOT ()-[:IMPORTS]->(entry)
        WITH symbolName, CASE WHEN path IS NOT NULL THEN length(path) ELSE NULL END AS d
        RETURN symbolName, min(d) AS minDepth
      `;
      const depthResult = await client.roQuery<Record<string, unknown>>(depthCypher, {
        params: { names },
      });
      for (const row of depthResult.data) {
        const name = row['symbolName'] as string;
        const enrichment = map.get(name);
        if (enrichment && row['minDepth'] != null) {
          enrichment.dependencyDepth = row['minDepth'] as number;
        }
      }
    } catch (err) {
      logger.debug(`Dependency depth query failed (non-fatal): ${err}`);
    }

    // Git churn: last modified date and commit count per file
    // Uses MODIFIED_IN edges from File→Commit (created by syncGitHistory)
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
        });
        // Build filePath→git data map, then assign to hits by filePath
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
            const enrichment = map.get(hit.name);
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

interface Candidate {
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
  return `${c.nodeType}:${c.filePath}:${c.name}`;
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
  const perTypeLimit = Math.max(20, Math.ceil(limit * 5 / labels.length));

  const allResults = await Promise.all(
    labels.map(nt => ops.searchByVector(nt as any, queryEmbedding, perTypeLimit)),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const results of allResults) {
    for (const r of results) {
      if (!matchesScope(r.filePath, scope, scopePaths)) continue;

      const key = `${r.nodeType}:${r.filePath}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const vScore = distanceToScore(r.distance);
      // r.properties contains the full row from searchByVector (all node fields)
      const props = r.properties ?? {};
      candidates.push({
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

export async function enrichedSearchV2(
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
    return { hits: [], meta: { query, vectorHits: 0, durationMs: Date.now() - start } };
  }

  // Sort by vector score for reranker pool selection
  candidates.sort((a, b) => b.score - a.score);

  // Enrich reranker pool with graph data BEFORE reranking
  // so the cross-encoder can see importance signals (callers, importers, exports)
  const prerankEnrichments = candidates.length >= 3
    ? await enrichFromGraph(client, candidates.slice(0, Math.max(limit * 2, 30)))
    : new Map<string, GraphEnrichment>();

  // Reranker: cross-encoder re-scores top candidates
  if (!options.skipReranker && candidates.length >= 3) {
    const rerankPool = candidates.slice(0, Math.max(limit * 2, 30));
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
      const ge = prerankEnrichments.get(c.name);
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
      const rerankResults = await rerank(query, docs, { topK: rerankPool.length });

      // Reranker score is the final score — it's a cross-encoder that sees
      // both query and document, strictly more informed than our retrieval scores.
      for (const rr of rerankResults) {
        rerankPool[rr.index]!.score = rr.relevanceScore;
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
  const missingHits = topHits.filter(h => !enrichments.has(h.name));
  if (missingHits.length > 0) {
    const extra = await enrichFromGraph(client, missingHits);
    for (const [k, v] of extra) enrichments.set(k, v);
  }

  const durationMs = Date.now() - start;

  logger.info(
    `Enriched V2 search "${query.slice(0, 60)}": ${topHits.length} hits ` +
    `(${candidates.length} vector) in ${durationMs}ms`,
  );

  return {
    hits: topHits.map(c => {
      const graphData = enrichments.get(c.name);
      const props = c.properties;
      return {
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
      };
    }),
    meta: {
      query,
      vectorHits: candidates.length,
      durationMs,
    },
  };
}
