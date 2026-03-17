/**
 * Enriched Search V2 — Built incrementally, signal by signal.
 *
 * Each signal is added one at a time and benchmarked.
 * Signals (in order of addition):
 *   1. Vector similarity (cosine via Voyage embeddings)
 *   2. Text match (symbol name matching)
 *   3. Node type boost (Function/Class > Variable/Type)
 *   4. Importance (caller + importer counts)
 *   5. Quality (docs, exports, tests)
 *   6. Recency (git commit freshness)
 *
 * Toggle signals via ENABLED_SIGNALS to test incrementally.
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
import type { HybridSearchOptions } from './hybridSearch';

const logger = createLogger({ namespace: 'core:enriched-v2' });

// ============================================================================
// Signal toggles — flip these to test incrementally
// ============================================================================

interface SignalConfig {
  vector: boolean;
  text: boolean;
  nodeType: boolean;
  importance: boolean;
  quality: boolean;
  recency: boolean;
  reranker: boolean;
}

const ENABLED_SIGNALS: SignalConfig = {
  vector: true,      // Step 1
  text: true,        // Step 2
  nodeType: true,    // Step 3 — ENABLED
  importance: false,  // Step 4 — DISABLED (hurts MRR)
  quality: false,     // Step 5 — DISABLED (neutral/slight regression)
  recency: false,     // Step 6
  reranker: true,     // Step 7 — ENABLED
};

// ============================================================================
// Types
// ============================================================================

export interface EnrichedV2Result {
  hits: EnrichedV2Hit[];
  meta: {
    query: string;
    vectorHits: number;
    textHits: number;
    importanceHits: number;
    durationMs: number;
    signals: string[];
  };
}

export interface EnrichedV2Hit {
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  score: number;
  sources: string[];
  properties: Record<string, unknown>;
}

export interface EnrichedV2Options extends HybridSearchOptions {
  /** Override which signals are enabled */
  signals?: Partial<SignalConfig>;
}

// ============================================================================
// Constants
// ============================================================================

const CODE_NODE_TYPES = ['Function', 'Class', 'Interface', 'Component', 'Type', 'Variable'] as const;

const MIN_VECTOR_SCORE = 0.45;

const NODE_TYPE_BOOST: Record<string, number> = {
  Function: 1.0,
  Class: 0.95,
  Component: 0.90,
  Interface: 0.70,
  Type: 0.50,
  Variable: 0.40,
  File: 0.30,
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
  'if', 'while', 'about', 'against', 'its', 'it', 'this', 'that',
  'what', 'which', 'who', 'whom', 'these', 'those', 'am',
  'like', 'using', 'used', 'across',
]);

// ============================================================================
// Term extraction
// ============================================================================

function extractTerms(query: string): string[] {
  const trimmed = query.trim();

  // Fast path: single symbol
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed)) return [trimmed];

  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const lower = t.toLowerCase();
    if (lower.length > 1 && !seen.has(lower)) {
      seen.add(lower);
      terms.push(t);
    }
  };

  // camelCase identifiers
  for (const m of trimmed.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) ?? []) add(m);
  // PascalCase identifiers
  for (const m of trimmed.match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g) ?? []) add(m);

  // Regular words (after stop word removal)
  const words = trimmed
    .split(/[\s,;:!?.()\[\]{}'"`]+/)
    .map(w => w.replace(/^[^a-zA-Z]+|[^a-zA-Z0-9]+$/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  for (const w of words) add(w);

  return terms;
}

// ============================================================================
// Text scoring
// ============================================================================

function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(w => w.length > 1);
}

function scoreTextMatch(name: string, searchTerms: string[]): number {
  if (searchTerms.length === 0) return 0;
  const nameLower = name.toLowerCase();
  const nameSubWords = splitIdentifier(name);
  let bestScore = 0;

  for (const term of searchTerms) {
    const termLower = term.toLowerCase();

    // Exact match
    if (nameLower === termLower) return 1.0;

    // Name contains term
    if (nameLower.includes(termLower)) {
      const coverage = termLower.length / Math.max(nameLower.length, termLower.length);
      bestScore = Math.max(bestScore, 0.70 + 0.25 * coverage);
    }

    // Bidirectional: term contains name
    if (termLower.length > nameLower.length && termLower.includes(nameLower) && nameLower.length >= 3) {
      const coverage = nameLower.length / termLower.length;
      bestScore = Math.max(bestScore, 0.55 + 0.20 * coverage);
    }

    // Sub-word matching
    const termSubWords = splitIdentifier(term);
    if (termSubWords.length > 0 && nameSubWords.length > 0) {
      const matched = nameSubWords.filter(w =>
        termSubWords.some(tw => w.includes(tw) || tw.includes(w)),
      );
      if (matched.length > 0) {
        bestScore = Math.max(bestScore, 0.45 + 0.30 * (matched.length / nameSubWords.length));
      }
    }
  }

  // Multi-term coverage
  if (searchTerms.length > 1) {
    let matchCount = 0;
    for (const term of searchTerms) {
      const tl = term.toLowerCase();
      if (nameLower.includes(tl) || tl.includes(nameLower)) matchCount++;
    }
    if (matchCount > 0) {
      bestScore = Math.max(bestScore, 0.40 + 0.35 * (matchCount / searchTerms.length));
    }
  }

  return bestScore;
}

// ============================================================================
// Distance → similarity score
// ============================================================================

function distanceToScore(distance: number): number {
  return Math.max(0, 1 - distance / 2);
}

// ============================================================================
// Candidate type
// ============================================================================

interface Candidate {
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  properties: Record<string, unknown>;
  sources: string[];
  // Signals
  vectorScore: number;
  textScore: number;
  callerCount: number;
  importerCount: number;
}

// ============================================================================
// Pipeline 1: Vector search
// ============================================================================

async function runVectorPipeline(
  client: GraphClient,
  query: string,
  limit: number,
  scope: string | undefined,
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
  const perTypeLimit = Math.max(5, Math.ceil(limit * 1.5 / CODE_NODE_TYPES.length));

  const allResults = await Promise.all(
    CODE_NODE_TYPES.map(nt => ops.searchByVector(nt, queryEmbedding, perTypeLimit)),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const results of allResults) {
    for (const r of results) {
      if (scope && r.filePath && !r.filePath.startsWith(scope)) continue;
      const vScore = distanceToScore(r.distance);
      if (vScore < MIN_VECTOR_SCORE) continue;

      const key = `${r.nodeType}:${r.filePath}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        name: r.name,
        nodeType: r.nodeType,
        filePath: r.filePath,
        properties: {
          ...(r as any).properties,
          isExported: (r as any).isExported,
          docstring: (r as any).docstring,
        },
        sources: ['vector'],
        vectorScore: vScore,
        textScore: 0,
        callerCount: 0,
        importerCount: 0,
      });
    }
  }

  return candidates;
}

// ============================================================================
// Pipeline 2: Text search
// ============================================================================

async function runTextPipeline(
  client: GraphClient,
  _query: string,
  searchTerms: string[],
  limit: number,
  scope: string | undefined,
): Promise<Candidate[]> {
  if (searchTerms.length === 0) return [];

  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');

  // Match any search term in name or docstring
  const termConditions = searchTerms.map((_, i) => {
    const nameMatch = `toLower(n.name) CONTAINS toLower($term${i})`;
    const docMatch = `(n.docstring IS NOT NULL AND toLower(n.docstring) CONTAINS toLower($term${i}))`;
    return `(${nameMatch} OR ${docMatch})`;
  });

  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';

  const cypher = `
    MATCH (n)
    WHERE (${termConditions.join(' OR ')})
      ${scopeFilter}
      AND n.filePath IS NOT NULL
    RETURN n.name AS name, ${firstLabel} AS nodeType,
           n.filePath AS filePath, n.startLine AS startLine,
           n.isExported AS isExported, n.docstring AS docstring,
           n.complexity AS complexity
    LIMIT $limit
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { limit: limit * 2 };
  for (let i = 0; i < searchTerms.length; i++) {
    params[`term${i}`] = searchTerms[i]!;
  }
  if (scope) params.scope = scope;

  try {
    const result = await client.roQuery<any>(cypher, { params });
    return result.data.map((r: any) => ({
      name: r.name,
      nodeType: r.nodeType,
      filePath: r.filePath,
      startLine: r.startLine,
      properties: {
        isExported: r.isExported,
        docstring: r.docstring?.slice(0, 200),
        complexity: r.complexity,
      },
      sources: ['text'],
      vectorScore: 0,
      textScore: scoreTextMatch(r.name, searchTerms),
      callerCount: 0,
      importerCount: 0,
    }));
  } catch (err) {
    logger.warn(`Text pipeline failed: ${err}`);
    return [];
  }
}

// ============================================================================
// Pipeline 3: Importance (top callers/importers matching terms)
// ============================================================================

async function runImportancePipeline(
  client: GraphClient,
  searchTerms: string[],
  limit: number,
  scope: string | undefined,
): Promise<Candidate[]> {
  if (searchTerms.length === 0) return [];

  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');

  const labelClauses = ['Function', 'Class', 'Component'].map(nt => dialect.labelCheckExpr('n', nt));
  const labelFilter = `(${labelClauses.join(' OR ')})`;
  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';

  const termConditions = searchTerms.map((_, i) => `toLower(n.name) CONTAINS toLower($term${i})`);
  const matchFilter = `(${termConditions.join(' OR ')})`;

  const cypher = `
    MATCH (n)
    WHERE ${labelFilter} AND ${matchFilter} ${scopeFilter}
    OPTIONAL MATCH (caller)-[:CALLS]->(n)
    OPTIONAL MATCH (importer)-[:IMPORTS]->(n)
    WITH n, ${firstLabel} AS nodeType,
         count(DISTINCT caller) AS callerCount,
         count(DISTINCT importer) AS importerCount
    ORDER BY callerCount + importerCount DESC
    LIMIT $limit
    RETURN n.name AS name, nodeType, n.filePath AS filePath,
           n.startLine AS startLine, callerCount, importerCount,
           n.isExported AS isExported, n.docstring AS docstring
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { limit };
  for (let i = 0; i < searchTerms.length; i++) {
    params[`term${i}`] = searchTerms[i]!;
  }
  if (scope) params.scope = scope;

  try {
    const result = await client.roQuery<any>(cypher, { params });
    return result.data.map((r: any) => ({
      name: r.name,
      nodeType: r.nodeType,
      filePath: r.filePath,
      startLine: r.startLine,
      properties: {
        isExported: r.isExported,
        docstring: r.docstring?.slice(0, 200),
        callerCount: r.callerCount,
        importerCount: r.importerCount,
      },
      sources: ['graph'],
      vectorScore: 0,
      textScore: scoreTextMatch(r.name, searchTerms),
      callerCount: r.callerCount ?? 0,
      importerCount: r.importerCount ?? 0,
    }));
  } catch (err) {
    logger.warn(`Importance pipeline failed: ${err}`);
    return [];
  }
}

// ============================================================================
// Merge candidates
// ============================================================================

function mergeCandidates(...pipelines: Candidate[][]): Candidate[] {
  const merged = new Map<string, Candidate>();

  for (const candidates of pipelines) {
    for (const c of candidates) {
      const key = `${c.nodeType}:${c.filePath}:${c.name}`;
      const existing = merged.get(key);
      if (existing) {
        existing.vectorScore = Math.max(existing.vectorScore, c.vectorScore);
        existing.textScore = Math.max(existing.textScore, c.textScore);
        existing.callerCount = Math.max(existing.callerCount, c.callerCount);
        existing.importerCount = Math.max(existing.importerCount, c.importerCount);
        for (const src of c.sources) {
          if (!existing.sources.includes(src)) existing.sources.push(src);
        }
        Object.assign(existing.properties, c.properties);
        if (c.startLine != null && existing.startLine == null) existing.startLine = c.startLine;
      } else {
        merged.set(key, { ...c });
      }
    }
  }

  return Array.from(merged.values());
}

// ============================================================================
// Ensure text scores for all candidates (vector-only candidates need this)
// ============================================================================

function ensureTextScores(candidates: Candidate[], searchTerms: string[]): void {
  for (const c of candidates) {
    if (c.textScore === 0 && searchTerms.length > 0) {
      c.textScore = scoreTextMatch(c.name, searchTerms);
      if (c.textScore > 0.3 && !c.sources.includes('text')) {
        c.sources.push('text');
      }
    }
  }
}

// ============================================================================
// Enrich candidates with importance data (for candidates not from importance pipeline)
// ============================================================================

async function enrichImportance(
  client: GraphClient,
  candidates: Candidate[],
): Promise<void> {
  const needsEnrichment = candidates.filter(c => c.callerCount === 0 && c.importerCount === 0);
  if (needsEnrichment.length === 0) return;

  await Promise.all(needsEnrichment.map(async (c) => {
    try {
      const dialect = client.dialect;
      const labelCheck = dialect.labelCheckExpr('n', c.nodeType);
      const cypher = `
        MATCH (n) WHERE ${labelCheck} AND n.name = $name AND n.filePath = $filePath
        OPTIONAL MATCH (caller)-[:CALLS]->(n)
        OPTIONAL MATCH (importer)-[:IMPORTS]->(n)
        RETURN count(DISTINCT caller) AS callerCount, count(DISTINCT importer) AS importerCount
      `;
      const result = await client.roQuery<any>(cypher, { params: { name: c.name, filePath: c.filePath ?? '' } });
      const row = result.data[0];
      if (row) {
        c.callerCount = row.callerCount ?? 0;
        c.importerCount = row.importerCount ?? 0;
      }
    } catch { /* ignore */ }
  }));
}

// ============================================================================
// Scoring — simple, composable
// ============================================================================

function computeScore(c: Candidate, signals: SignalConfig): number {
  let score = 0;

  // Signal 1: Vector similarity (0.50 weight — primary signal for semantic queries)
  if (signals.vector) {
    score += 0.50 * c.vectorScore;
  }

  // Signal 2: Text match (0.40 weight — symbol name matching)
  if (signals.text) {
    score += 0.40 * c.textScore;
  }

  // Signal 3: Node type boost (0.10 weight — prefer functions/classes over variables)
  if (signals.nodeType) {
    const boost = NODE_TYPE_BOOST[c.nodeType] ?? 0.5;
    score += 0.10 * boost;
  }

  // Signal 4: Importance (log-scaled caller + importer counts, gated by relevance)
  if (signals.importance) {
    const totalFanIn = c.callerCount + c.importerCount;
    const importanceScore = totalFanIn > 0 ? Math.min(1, Math.log2(totalFanIn + 1) / 6) : 0;
    const relevance = Math.max(c.vectorScore, c.textScore);
    const gate = relevance >= 0.5 ? 1.0 : relevance >= 0.3 ? 0.6 : relevance >= 0.15 ? 0.3 : 0.1;
    score += 0.15 * importanceScore * gate;
  }

  // Signal 5: Quality (docs + exports, gated by relevance)
  if (signals.quality) {
    const hasDoc = c.properties.docstring != null;
    const isExported = c.properties.isExported === true;
    const qualityScore = (hasDoc ? 0.5 : 0) + (isExported ? 0.5 : 0);
    const relevance = Math.max(c.vectorScore, c.textScore);
    const gate = relevance >= 0.5 ? 1.0 : relevance >= 0.3 ? 0.6 : relevance >= 0.15 ? 0.3 : 0.1;
    score += 0.10 * qualityScore * gate;
  }

  // Signal 6: Recency (placeholder)
  if (signals.recency) {
    score += 0.10 * 0.5;
  }

  return score;
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
  const signals = { ...ENABLED_SIGNALS, ...options.signals };

  const searchTerms = extractTerms(query);
  const activeSignals = Object.entries(signals).filter(([, v]) => v).map(([k]) => k);

  // Run pipelines in parallel
  const [vectorCandidates, textCandidates, importanceCandidates] = await Promise.all([
    signals.vector ? runVectorPipeline(client, query, limit, scope, options.embeddings) : Promise.resolve([]),
    signals.text ? runTextPipeline(client, query, searchTerms, limit, scope) : Promise.resolve([]),
    signals.importance ? runImportancePipeline(client, searchTerms, limit, scope) : Promise.resolve([]),
  ]);

  // Merge all candidates
  const allCandidates = mergeCandidates(vectorCandidates, textCandidates, importanceCandidates);

  // Ensure text scores for vector-only candidates
  if (signals.text) {
    ensureTextScores(allCandidates, searchTerms);
  }

  // Enrich with importance data if signal is enabled
  if (signals.importance) {
    await enrichImportance(client, allCandidates);
  }

  // Score all candidates
  const scored = allCandidates.map(c => ({
    ...c,
    score: computeScore(c, signals),
  }));

  // Sort by initial score
  scored.sort((a, b) => b.score - a.score);

  // Reranker: use Voyage cross-encoder to re-score top candidates
  if (signals.reranker && scored.length >= 3) {
    const rerankPool = scored.slice(0, Math.max(limit * 2, 30));
    const rerankDocs = rerankPool.map(c => {
      const parts: string[] = [`${c.nodeType}: ${c.name}`];
      if (c.filePath) {
        // Include just the relative path portion for context
        const relPath = c.filePath.replace(/^.*\/packages\//, 'packages/');
        parts.push(`File: ${relPath}`);
      }
      if (c.properties.signature) parts.push(`Signature: ${String(c.properties.signature).slice(0, 200)}`);
      if (c.properties.docstring) parts.push(String(c.properties.docstring).slice(0, 300));
      return parts.join('\n');
    });

    try {
      const rerankResults = await rerank(query, rerankDocs, { topK: rerankPool.length });

      // Blend: 60% base score + 40% reranker relevance
      for (const rr of rerankResults) {
        const c = rerankPool[rr.index]!;
        c.score = 0.60 * c.score + 0.40 * rr.relevanceScore;
      }

      // Re-sort after reranking
      rerankPool.sort((a, b) => b.score - a.score);
      // Replace top section with reranked results
      scored.splice(0, rerankPool.length, ...rerankPool);
    } catch (err) {
      logger.warn(`Reranker failed, using base scores: ${err}`);
    }
  }

  const topHits = scored.slice(0, limit);

  const durationMs = Date.now() - start;

  logger.info(
    `Enriched V2 search "${query.slice(0, 60)}": ${topHits.length} hits ` +
    `(${vectorCandidates.length} vector, ${textCandidates.length} text, ${importanceCandidates.length} importance) ` +
    `signals=[${activeSignals.join(',')}] in ${durationMs}ms`,
  );

  return {
    hits: topHits.map(c => {
      const hit: EnrichedV2Hit = {
        name: c.name,
        nodeType: c.nodeType,
        score: c.score,
        sources: c.sources,
        properties: c.properties,
      };
      if (c.filePath) hit.filePath = c.filePath;
      if (c.startLine != null) hit.startLine = c.startLine;
      return hit;
    }),
    meta: {
      query,
      vectorHits: vectorCandidates.length,
      textHits: textCandidates.length,
      importanceHits: importanceCandidates.length,
      durationMs,
      signals: activeSignals,
    },
  };
}
