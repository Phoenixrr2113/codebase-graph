/**
 * @codegraph/core — Enriched Search (Standalone)
 *
 * A standalone multi-signal search that runs its own retrieval pipelines
 * (vector, text, graph-importance) in parallel and scores all signals
 * together in a unified scoring function.
 *
 * Unlike hybridSearch (which uses RRF rank fusion), enrichedSearch uses
 * score-based fusion where all signals contribute directly:
 *
 * **Retrieval pipelines (run in parallel):**
 *   1. Vector: embed query → cosine similarity across code node types
 *   2. Text: name/docstring CONTAINS with bidirectional matching
 *   3. Graph importance: top nodes by caller+importer count matching terms
 *   4. Doc snippets: markdown sections matching query terms
 *
 * **Scoring signals (unified, all weighted together):**
 *   - Vector similarity (0.25): semantic match quality
 *   - Text match (0.25): symbol name match quality
 *   - Importance (0.20): caller count + importer count (log-scaled)
 *   - Node type (0.10): Function/Class boosted over Variable/Type
 *   - Quality (0.10): documentation, export status, test coverage
 *   - Recency (0.10): recently modified code ranked higher
 *
 * **Key differences from hybridSearch:**
 *   - No RRF normalization (preserves score magnitude information)
 *   - Graph-importance pipeline can find results text/vector miss
 *   - Bidirectional substring matching ("configuration" finds "Config")
 *   - Code-verb-aware stop words (keeps "find", "get", "create")
 *   - Node-type boosting (Functions/Classes over Variable/Type)
 *   - Lower vector similarity threshold (0.50 vs 0.65)
 *   - File nodes demoted (0.5x multiplier) not filtered
 *
 * All signals computed via graph queries or local computation — no LLM calls.
 */

import { createLogger } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { createOperations } from '@codegraph/graph';
import { createKnowledgeOperations } from '@codegraph/graph';
import {
  generateEmbedding,
  isEmbeddingAvailable,
  rerank,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';
import type { HybridSearchHit, RelatedHit, HybridSearchOptions } from './hybridSearch';
import { truncateToTokenBudget } from './tokenEstimator';

const logger = createLogger({ namespace: 'core:enriched-search' });

// ============================================================================
// Types
// ============================================================================

/** Enrichment metadata added to each hit */
export interface EnrichmentData {
  callerCount: number;
  importerCount: number;
  testFileCount: number;
  aboutEdgeCount: number;
  daysSinceLastCommit: number | null;
  commitCount: number;
  importanceScore: number;
  recencyScore: number;
  documentationScore: number;
  complexityPenalty: number;
  enrichmentBonus: number;
  hasVulnerability: boolean;
}

/** A documentation snippet found alongside code results */
export interface DocSnippet {
  docPath: string;
  sectionName: string;
  preview: string;
}

/** Extended search hit with enrichment data */
export interface EnrichedSearchHit extends HybridSearchHit {
  baseScore: number;
  enrichment: EnrichmentData;
}

/** Full enriched search result */
export interface EnrichedSearchResult {
  hits: EnrichedSearchHit[];
  related: RelatedHit[];
  docSnippets: DocSnippet[];
  meta: {
    query: string;
    totalHits: number;
    vectorHits: number;
    textHits: number;
    importanceHits: number;
    graphExpanded: number;
    aboutExpanded: number;
    embeddingAvailable: boolean;
    enrichmentDurationMs: number;
    hitsEnriched: number;
    docSnippetsFound: number;
    durationMs: number;
  };
}

/** Options for enriched search */
export interface EnrichedSearchOptions extends HybridSearchOptions {
  /** Weight for base hybrid score (kept for API compat, unused in standalone) */
  baseScoreWeight?: number;
  /** Weight for enrichment bonus (kept for API compat, unused in standalone) */
  enrichmentWeight?: number;
  maxTokens?: number;
  includeDocSnippets?: boolean;
  includeVulnerabilityFlags?: boolean;
}

// ============================================================================
// Unified scoring weights (sum to 1.0)
// ============================================================================

const SIGNAL_WEIGHTS = {
  vector: 0.30,       // semantic similarity (primary signal for descriptive queries)
  text: 0.25,         // symbol name match quality
  importance: 0.15,   // caller + importer count + churn + depth (gated by relevance)
  nodeType: 0.10,     // Function/Class > Variable/Type
  quality: 0.10,      // docs + exports + test coverage
  recency: 0.10,      // recently modified
} as const;

// ============================================================================
// Node type boost values
// ============================================================================

const NODE_TYPE_BOOST: Record<string, number> = {
  Function: 1.0,
  Class: 0.95,
  Component: 0.90,
  Interface: 0.70,
  Type: 0.60,
  Variable: 0.50,
  File: 0.30,
  Entity: 0.40,
};

// ============================================================================
// Code-aware stop words (keeps imperative verbs valid in code)
// ============================================================================

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'shall', 'would',
  'should', 'could', 'can', 'may', 'might', 'must', 'need', 'not',
  'and', 'or', 'but', 'if', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'from', 'by', 'about', 'into', 'through', 'between',
  'that', 'this', 'it', 'its', 'their', 'these', 'those',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'many', 'much', 'some', 'any',
  'other', 'more', 'most', 'own', 'same', 'such', 'very', 'just', 'also',
  'than', 'then', 'there', 'here', 'only',
  // Deliberate: "find", "get", "create", "list", "show" are NOT stop words
  // because they are valid code identifiers (e.g., "findUser", "getConfig")
  'tell', 'explain', 'describe', 'give',
  'me', 'my', 'i',
]);

// ============================================================================
// Vulnerability patterns
// ============================================================================

const VULN_PATTERNS = [
  /eval\s*\(/i,
  /innerHTML\s*=/i,
  /dangerouslySetInnerHTML/i,
  /child_process/i,
  /exec\s*\(/i,
  /sql.*\+.*\$/i,
  /password.*=.*['"`]/i,
  /secret.*=.*['"`]/i,
  /api[_-]?key.*=.*['"`]/i,
];

function hasVulnerabilityPattern(props: Record<string, unknown>): boolean {
  const body = (props.bodySnippet as string) ?? (props.docstring as string) ?? '';
  const name = (props.name as string) ?? '';
  const combined = `${name} ${body}`;
  return VULN_PATTERNS.some((p) => p.test(combined));
}

// ============================================================================
// Term extraction (code-aware, keeps code verbs)
// ============================================================================

/**
 * Extract search terms from a query string.
 * Keeps code-valid verbs like "find", "get", "create" that hybridSearch filters.
 */
export function extractEnrichedTerms(query: string): string[] {
  const trimmed = query.trim();

  // Fast path: single symbol
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed)) {
    return [trimmed];
  }

  const terms: string[] = [];
  const seen = new Set<string>();

  const addTerm = (t: string) => {
    const lower = t.toLowerCase();
    if (lower.length > 1 && !seen.has(lower)) {
      seen.add(lower);
      terms.push(t);
    }
  };

  // 1. camelCase identifiers (highest priority)
  const camelCaseMatches = trimmed.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) ?? [];
  for (const m of camelCaseMatches) addTerm(m);

  // 2. PascalCase identifiers
  const pascalCaseMatches = trimmed.match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g) ?? [];
  for (const m of pascalCaseMatches) addTerm(m);

  // 3. snake_case identifiers
  const snakeCaseMatches = trimmed.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
  for (const m of snakeCaseMatches) addTerm(m);

  // 4. Split identifiers into sub-words for fuzzy matching
  for (const m of [...camelCaseMatches, ...pascalCaseMatches]) {
    const subWords = m
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (const w of subWords) addTerm(w);
  }

  // 5. Tokenize remaining words, remove stop words
  const words = trimmed
    .split(/[\s,;:!?.()\[\]{}'"`]+/)
    .map((w) => w.replace(/^[^a-zA-Z]+|[^a-zA-Z0-9]+$/g, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  for (const w of words) addTerm(w);

  return terms;
}

/**
 * Split an identifier into sub-words.
 * "hybridSearch" → ["hybrid", "search"]
 * "GraphClient" → ["graph", "client"]
 */
function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_]+/)
    .filter((w) => w.length > 1);
}

// ============================================================================
// Text match scoring (bidirectional, sub-word aware)
// ============================================================================

/**
 * Score how well a node name matches the query.
 * Supports bidirectional matching: "configuration" finds "Config".
 */
function scoreTextMatch(name: string, _query: string, searchTerms: string[]): number {
  const nameLower = name.toLowerCase();
  const nameSubWords = splitIdentifier(name);

  let bestScore = 0;

  for (const term of searchTerms) {
    const termLower = term.toLowerCase();

    // Exact match
    if (nameLower === termLower) return 1.0;

    // Name contains term (standard: "hybridSearch" contains "hybrid")
    if (nameLower.includes(termLower)) {
      // Coverage: use max of lengths to avoid penalizing long names unfairly
      const coverage = termLower.length / Math.max(nameLower.length, termLower.length);
      bestScore = Math.max(bestScore, 0.70 + 0.25 * coverage);
    }

    // Bidirectional: term contains name ("configuration" contains "config")
    if (termLower.length > nameLower.length && termLower.includes(nameLower) && nameLower.length >= 3) {
      const coverage = nameLower.length / termLower.length;
      bestScore = Math.max(bestScore, 0.55 + 0.20 * coverage);
    }

    // Sub-word matching: query sub-words match name sub-words
    const termSubWords = splitIdentifier(term);
    if (termSubWords.length > 0 && nameSubWords.length > 0) {
      const matchedSubWords = nameSubWords.filter((w) =>
        termSubWords.some((tw) => w.includes(tw) || tw.includes(w)),
      );
      if (matchedSubWords.length > 0) {
        const subWordCoverage = matchedSubWords.length / nameSubWords.length;
        bestScore = Math.max(bestScore, 0.45 + 0.30 * subWordCoverage);
      }
    }
  }

  // Multi-term matching: count how many terms match
  if (searchTerms.length > 1) {
    let matchCount = 0;
    for (const term of searchTerms) {
      const termLower = term.toLowerCase();
      if (nameLower.includes(termLower) || termLower.includes(nameLower)) matchCount++;
    }
    if (matchCount > 0) {
      bestScore = Math.max(bestScore, 0.40 + 0.35 * (matchCount / searchTerms.length));
    }
  }

  // No name match → 0 (docstring matching handled separately)
  return bestScore;
}

// ============================================================================
// Node property extraction
// ============================================================================

function extractNodeProperties(row: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (row.complexity != null) props.complexity = row.complexity;
  if (row.cognitiveComplexity != null) props.cognitiveComplexity = row.cognitiveComplexity;
  if (row.nestingDepth != null) props.nestingDepth = row.nestingDepth;
  if (row.isExported != null) props.isExported = row.isExported;
  if (row.isAsync != null) props.isAsync = row.isAsync;
  if (row.endLine != null) props.endLine = row.endLine;
  if (row.loc != null) props.loc = row.loc;
  if (row.docstring != null && typeof row.docstring === 'string') {
    props.docstring = row.docstring.length > 200
      ? row.docstring.slice(0, 200) + '...'
      : row.docstring;
  }
  return props;
}

/** Dedup key for code nodes */
function makeCodeKey(nodeType: string, filePath: string | undefined, name: string): string {
  return `${nodeType}:${filePath ?? ''}:${name}`;
}

/** Convert Euclidean distance to 0-1 score */
function distanceToScore(distance: number): number {
  return 1 / (1 + distance);
}

// ============================================================================
// Pipeline 1: Vector search
// ============================================================================

const CODE_NODE_TYPES = [
  'Function', 'Class', 'Interface', 'Component', 'Type', 'Variable',
] as const;

const MIN_VECTOR_SCORE = 0.45; // Moderate threshold — admit vector results with reasonable semantic match
// Multi-word descriptive queries (from LLMs) produce lower cosine similarity
// than single-word exact matches, so threshold must be lower to capture them

interface CandidateHit {
  hit: HybridSearchHit;
  vectorScore: number;  // 0-1, 0 if not from vector
  textScore: number;    // 0-1, 0 if not from text
  // Enrichment (filled later)
  callerCount: number;
  importerCount: number;
  testFileCount: number;
  aboutEdgeCount: number;
  daysSinceLastCommit: number | null;
  commitCount: number;
  depthFromEntry: number | null; // hops from nearest entry-point file via IMPORTS
}

async function runVectorPipeline(
  client: GraphClient,
  query: string,
  limit: number,
  scope: string | undefined,
  embeddings?: EmbeddingConfig,
): Promise<CandidateHit[]> {
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
  // Fetch more per type to avoid losing good results — we'll merge and re-rank later
  const perTypeLimit = Math.max(5, Math.ceil(limit * 1.5 / CODE_NODE_TYPES.length));

  const allResults = await Promise.all(
    CODE_NODE_TYPES.map((nt) => ops.searchByVector(nt, queryEmbedding, perTypeLimit)),
  );

  const candidates: CandidateHit[] = [];
  const seen = new Set<string>();

  for (const results of allResults) {
    for (const r of results) {
      if (scope && r.filePath && !r.filePath.startsWith(scope)) continue;

      const vScore = distanceToScore(r.distance);
      if (vScore < MIN_VECTOR_SCORE) continue;

      const key = makeCodeKey(r.nodeType, r.filePath, r.name);
      if (seen.has(key)) continue;
      seen.add(key);

      const vectorHit: HybridSearchHit = {
        key,
        nodeType: r.nodeType,
        name: r.name,
        filePath: r.filePath,
        score: 0,
        sources: ['vector'],
        vectorDistance: r.distance,
        properties: extractNodeProperties(r.properties),
      };
      if (r.startLine != null) vectorHit.startLine = r.startLine;

      candidates.push({
        hit: vectorHit,
        vectorScore: vScore,
        textScore: 0,
        callerCount: 0,
        importerCount: 0,
        testFileCount: 0,
        aboutEdgeCount: 0,
        daysSinceLastCommit: null,
        commitCount: 0,
        depthFromEntry: null,
      });
    }
  }

  return candidates;
}

// ============================================================================
// Pipeline 2: Text search (with bidirectional matching, File demotion)
// ============================================================================

interface TextSearchRow {
  nodeType: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine?: number;
  complexity?: number;
  cognitiveComplexity?: number;
  nestingDepth?: number;
  isExported?: boolean;
  isAsync?: boolean;
  docstring?: string;
  loc?: number;
  [key: string]: unknown;
}

async function runTextPipeline(
  client: GraphClient,
  query: string,
  searchTerms: string[],
  limit: number,
  scope: string | undefined,
): Promise<CandidateHit[]> {
  if (searchTerms.length === 0) return [];

  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');

  // Include ALL node types (including File), but we'll demote File in scoring
  const allTypes = ['Function', 'Class', 'Interface', 'Component', 'Type', 'Variable', 'File'];
  const labelClauses = allTypes.map((nt) => dialect.labelCheckExpr('n', nt));
  const labelFilter = `(${labelClauses.join(' OR ')})`;

  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';

  // Build OR conditions for each search term
  const termConditions = searchTerms.map((_, i) => {
    const nameMatch = `toLower(n.name) CONTAINS toLower($term${i})`;
    const docMatch = `(n.docstring IS NOT NULL AND toLower(n.docstring) CONTAINS toLower($term${i}))`;
    return `(${nameMatch} OR ${docMatch})`;
  });

  const matchFilter = termConditions.length === 1
    ? termConditions[0]
    : `(${termConditions.join(' OR ')})`;

  // Relevance ordering
  const nameMatchScores = searchTerms.map((_, i) =>
    `CASE WHEN toLower(n.name) CONTAINS toLower($term${i}) THEN 1 ELSE 0 END`,
  );
  const relevanceExpr = nameMatchScores.length === 1
    ? nameMatchScores[0]
    : `(${nameMatchScores.join(' + ')})`;

  const cypher = `
    MATCH (n)
    WHERE ${labelFilter}
      AND ${matchFilter}
      ${scopeFilter}
    RETURN n.name AS name, ${firstLabel} AS nodeType,
           n.filePath AS filePath,
           n.startLine AS startLine,
           n.endLine AS endLine,
           n.complexity AS complexity,
           n.cognitiveComplexity AS cognitiveComplexity,
           n.nestingDepth AS nestingDepth,
           n.isExported AS isExported,
           n.isAsync AS isAsync,
           n.docstring AS docstring,
           n.loc AS loc
    ORDER BY ${relevanceExpr} DESC, n.name
    LIMIT $limit
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { limit: limit * 2 };
  for (let i = 0; i < searchTerms.length; i++) {
    params[`term${i}`] = searchTerms[i]!;
  }
  if (scope) params.scope = scope;

  try {
    const result = await client.roQuery<TextSearchRow>(cypher, { params });

    return result.data.map((r) => {
      const key = makeCodeKey(r.nodeType, r.filePath, r.name);
      const tScore = scoreTextMatch(r.name, query, searchTerms);

      return {
        hit: {
          key,
          nodeType: r.nodeType,
          name: r.name,
          filePath: r.filePath,
          startLine: r.startLine,
          score: 0,
          sources: ['text'] as ('vector' | 'text' | 'graph')[],
          properties: extractNodeProperties(r),
        },
        vectorScore: 0,
        textScore: tScore,
        callerCount: 0,
        importerCount: 0,
        testFileCount: 0,
        aboutEdgeCount: 0,
        daysSinceLastCommit: null,
        commitCount: 0,
        depthFromEntry: null,
      };
    });
  } catch {
    return [];
  }
}

// ============================================================================
// Pipeline 3: Graph importance search (NEW — finds central nodes)
// ============================================================================

interface ImportanceRow {
  name: string;
  nodeType: string;
  filePath: string;
  startLine?: number;
  callerCount: number;
  importerCount: number;
  isExported?: boolean;
  docstring?: string;
  complexity?: number;
  cognitiveComplexity?: number;
}

async function runImportancePipeline(
  client: GraphClient,
  searchTerms: string[],
  limit: number,
  scope: string | undefined,
): Promise<CandidateHit[]> {
  if (searchTerms.length === 0) return [];

  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');

  // Only search Function and Class — the types with meaningful caller/importer counts
  const labelClauses = ['Function', 'Class', 'Component'].map((nt) => dialect.labelCheckExpr('n', nt));
  const labelFilter = `(${labelClauses.join(' OR ')})`;

  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';

  // Match any search term in name
  const termConditions = searchTerms.map((_, i) =>
    `toLower(n.name) CONTAINS toLower($term${i})`,
  );
  const matchFilter = `(${termConditions.join(' OR ')})`;

  const cypher = `
    MATCH (n)
    WHERE ${labelFilter}
      AND ${matchFilter}
      ${scopeFilter}
    OPTIONAL MATCH (caller)-[:CALLS]->(n)
    OPTIONAL MATCH (importer)-[:IMPORTS]->(n)
    WITH n, ${firstLabel} AS nodeType,
         count(DISTINCT caller) AS callerCount,
         count(DISTINCT importer) AS importerCount
    ORDER BY callerCount + importerCount DESC
    LIMIT $limit
    RETURN n.name AS name, nodeType,
           n.filePath AS filePath,
           n.startLine AS startLine,
           callerCount, importerCount,
           n.isExported AS isExported,
           n.docstring AS docstring,
           n.complexity AS complexity,
           n.cognitiveComplexity AS cognitiveComplexity
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { limit };
  for (let i = 0; i < searchTerms.length; i++) {
    params[`term${i}`] = searchTerms[i]!;
  }
  if (scope) params.scope = scope;

  try {
    const result = await client.roQuery<ImportanceRow>(cypher, { params });

    return result.data.map((r) => {
      const key = makeCodeKey(r.nodeType, r.filePath, r.name);
      const tScore = scoreTextMatch(r.name, '', searchTerms);

      const impHit: HybridSearchHit = {
        key,
        nodeType: r.nodeType,
        name: r.name,
        filePath: r.filePath,
        score: 0,
        sources: ['graph'],
        properties: {
          ...(r.isExported != null ? { isExported: r.isExported } : {}),
          ...(r.docstring ? { docstring: r.docstring.slice(0, 200) } : {}),
          ...(r.complexity != null ? { complexity: r.complexity } : {}),
          ...(r.cognitiveComplexity != null ? { cognitiveComplexity: r.cognitiveComplexity } : {}),
          callerCount: r.callerCount,
          importerCount: r.importerCount,
        },
      };
      if (r.startLine != null) impHit.startLine = r.startLine;

      return {
        hit: impHit,
        vectorScore: 0,
        textScore: tScore,
        callerCount: r.callerCount,
        importerCount: r.importerCount,
        testFileCount: 0,
        aboutEdgeCount: 0,
        daysSinceLastCommit: null,
        commitCount: 0,
        depthFromEntry: null,
      };
    });
  } catch {
    return [];
  }
}

// ============================================================================
// Pipeline 4: Doc snippets
// ============================================================================

async function runDocPipeline(
  client: GraphClient,
  query: string,
): Promise<DocSnippet[]> {
  const terms = query
    .split(/[\s,;:!?.()\[\]{}'"`]+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);

  if (terms.length === 0) return [];

  const termConditions = terms.map(
    (_, i) => `toLower(s.name) CONTAINS toLower($term${i})`,
  );
  const cypher = `
    MATCH (d:File)-[:CONTAINS]->(s)
    WHERE (d.extension = '.md' OR d.extension = '.mdx')
      AND (${termConditions.join(' OR ')})
    RETURN d.filePath AS docPath,
           s.name AS sectionName,
           s.docstring AS content
    LIMIT 5
  `;

  const params: Record<string, string> = {};
  for (let i = 0; i < terms.length; i++) {
    params[`term${i}`] = terms[i]!;
  }

  try {
    const result = await client.roQuery<{
      docPath: string;
      sectionName: string;
      content: string | null;
    }>(cypher, { params });

    return result.data.map((row) => ({
      docPath: row.docPath,
      sectionName: row.sectionName,
      preview: row.content
        ? row.content.slice(0, 200) + (row.content.length > 200 ? '...' : '')
        : '',
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Candidate merging (cross-pipeline dedup)
// ============================================================================

function mergeCandidates(
  vectorCandidates: CandidateHit[],
  textCandidates: CandidateHit[],
  importanceCandidates: CandidateHit[],
): CandidateHit[] {
  const merged = new Map<string, CandidateHit>();

  // Add vector candidates first
  for (const c of vectorCandidates) {
    merged.set(c.hit.key, c);
  }

  // Merge text candidates
  for (const c of textCandidates) {
    const existing = merged.get(c.hit.key);
    if (existing) {
      existing.textScore = Math.max(existing.textScore, c.textScore);
      if (!existing.hit.sources.includes('text')) {
        existing.hit.sources.push('text');
      }
      // Merge properties (text search may have richer metadata)
      Object.assign(existing.hit.properties, c.hit.properties);
      if (c.hit.startLine != null && existing.hit.startLine == null) {
        existing.hit.startLine = c.hit.startLine;
      }
    } else {
      merged.set(c.hit.key, c);
    }
  }

  // Merge importance candidates
  for (const c of importanceCandidates) {
    const existing = merged.get(c.hit.key);
    if (existing) {
      // Take the pre-computed importance data
      existing.callerCount = Math.max(existing.callerCount, c.callerCount);
      existing.importerCount = Math.max(existing.importerCount, c.importerCount);
      existing.textScore = Math.max(existing.textScore, c.textScore);
      if (!existing.hit.sources.includes('graph')) {
        existing.hit.sources.push('graph');
      }
      Object.assign(existing.hit.properties, c.hit.properties);
    } else {
      merged.set(c.hit.key, c);
    }
  }

  return Array.from(merged.values());
}

/**
 * Post-merge: ensure every candidate has a text score computed.
 * Vector-only or importance-only candidates may have textScore=0 even though
 * their names match query terms (e.g., "createOperations" matches "operations").
 */
function ensureTextScores(candidates: CandidateHit[], searchTerms: string[]): void {
  for (const c of candidates) {
    if (c.textScore === 0 && searchTerms.length > 0) {
      c.textScore = scoreTextMatch(c.hit.name, '', searchTerms);
      // If text score was computed and is significant, mark source
      if (c.textScore > 0.3 && !c.hit.sources.includes('text')) {
        c.hit.sources.push('text');
      }
    }
  }
}

// ============================================================================
// Enrichment queries (parallel per-hit)
// ============================================================================

async function enrichCandidate(
  client: GraphClient,
  candidate: CandidateHit,
): Promise<void> {
  const { hit } = candidate;
  if (hit.nodeType === 'Entity' || !hit.filePath) return;

  // Skip importance query if already enriched from importance pipeline
  const needsImportance = candidate.callerCount === 0 && candidate.importerCount === 0;

  const promises: Promise<void>[] = [];

  // Importance (if not already from importance pipeline)
  if (needsImportance) {
    promises.push(
      queryImportance(client, hit.nodeType, hit.name, hit.filePath!).then((r) => {
        candidate.callerCount = r.callerCount;
        candidate.importerCount = r.importerCount;
        candidate.testFileCount = r.testFileCount;
      }).catch(() => {}),
    );
  }

  // Recency
  promises.push(
    queryRecency(client, hit.filePath!).then((r) => {
      candidate.daysSinceLastCommit = r.daysSinceLastCommit;
      candidate.commitCount = r.commitCount;
    }).catch(() => {}),
  );

  // ABOUT edges
  promises.push(
    queryAboutEdgeCount(client, hit.nodeType, hit.name, hit.filePath!).then((count) => {
      candidate.aboutEdgeCount = count;
    }).catch(() => {}),
  );

  await Promise.all(promises);
}

// ============================================================================
// Unified scoring
// ============================================================================

function computeUnifiedScore(candidate: CandidateHit): {
  score: number;
  enrichment: EnrichmentData;
} {
  const { hit } = candidate;

  // Node type boost
  const nodeTypeBoost = NODE_TYPE_BOOST[hit.nodeType] ?? 0.5;
  // File nodes get demoted further
  const nodeTypeScore = hit.nodeType === 'File' ? nodeTypeBoost * 0.5 : nodeTypeBoost;

  // Importance (log-scaled, with churn and depth)
  const importanceScore = computeImportanceScore(
    candidate.callerCount, candidate.importerCount, candidate.commitCount, candidate.depthFromEntry,
  );

  // Recency
  const recencyScore = computeRecencyScore(candidate.daysSinceLastCommit);

  // Quality: documentation + export status + test coverage + size
  const hasDocstring = hit.properties.docstring != null;
  const documentationScore = computeDocumentationScore(hasDocstring, candidate.aboutEdgeCount);
  const isExported = hit.properties.isExported === true;
  const hasTests = candidate.testFileCount > 0;
  const locScore = computeLocScore(hit.properties, hit.nodeType);
  const qualityScore = (
    documentationScore * 0.4 +
    (isExported ? 0.35 : 0) +
    (hasTests ? 0.25 : 0)
  ) * (0.9 + locScore * 0.1); // LOC as a small multiplier (0.93-1.0)

  // Complexity penalty
  const complexity = (hit.properties.cognitiveComplexity as number)
    ?? (hit.properties.complexity as number)
    ?? 0;
  const complexityPenalty = computeComplexityPenalty(complexity);

  // Relevance gate: dampen importance/quality/recency if neither vector nor text
  // provides a strong semantic match. This prevents high-caller but irrelevant
  // functions (e.g. getGraphClient with 36 callers) from dominating results.
  const relevanceSignal = Math.max(candidate.vectorScore, candidate.textScore);
  const relevanceGate = relevanceSignal >= 0.5 ? 1.0
    : relevanceSignal >= 0.3 ? 0.6
    : relevanceSignal >= 0.15 ? 0.3
    : 0.1;

  // Unified score
  const score = Math.max(0,
    SIGNAL_WEIGHTS.vector * candidate.vectorScore +
    SIGNAL_WEIGHTS.text * candidate.textScore +
    SIGNAL_WEIGHTS.importance * importanceScore * relevanceGate +
    SIGNAL_WEIGHTS.nodeType * nodeTypeScore +
    SIGNAL_WEIGHTS.quality * qualityScore * relevanceGate +
    SIGNAL_WEIGHTS.recency * recencyScore * relevanceGate +
    complexityPenalty,
  );

  // Enrichment bonus (for compatibility with existing API)
  const enrichmentBonus =
    importanceScore * 0.35 +
    recencyScore * 0.25 +
    documentationScore * 0.20 +
    (isExported ? 0.10 : 0) +
    (hasTests ? 0.10 : 0);

  return {
    score,
    enrichment: {
      callerCount: candidate.callerCount,
      importerCount: candidate.importerCount,
      testFileCount: candidate.testFileCount,
      aboutEdgeCount: candidate.aboutEdgeCount,
      daysSinceLastCommit: candidate.daysSinceLastCommit,
      commitCount: candidate.commitCount,
      importanceScore,
      recencyScore,
      documentationScore,
      complexityPenalty,
      enrichmentBonus,
      hasVulnerability: false,
    },
  };
}

// ============================================================================
// Graph traversal (for related nodes)
// ============================================================================

interface TraversalHit {
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  edgeLabel: string;
  direction: 'outgoing' | 'incoming';
}

async function traverseNeighbors(
  client: GraphClient,
  nodeType: string,
  name: string,
  filePath: string,
  maxHops: number,
): Promise<TraversalHit[]> {
  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('other');
  const edgeType = dialect.typeExpr('r');
  const hopRange = maxHops > 1 ? `*1..${maxHops}` : '';

  const matchProps = nodeType === 'File'
    ? '{name: $name}'
    : '{name: $name, filePath: $filePath}';

  const outCypher = `
    MATCH (n:${nodeType} ${matchProps})-[r${hopRange}]->(other)
    RETURN other.name AS name, ${firstLabel} AS nodeType,
           other.filePath AS filePath, other.startLine AS startLine,
           ${edgeType} AS edgeLabel
    LIMIT 20
  `;
  const inCypher = `
    MATCH (other)-[r${hopRange}]->(n:${nodeType} ${matchProps})
    RETURN other.name AS name, ${firstLabel} AS nodeType,
           other.filePath AS filePath, other.startLine AS startLine,
           ${edgeType} AS edgeLabel
    LIMIT 20
  `;

  const params = { name, filePath };
  type RowType = { name: string; nodeType: string; filePath?: string; startLine?: number; edgeLabel: string };
  const emptyData = { data: [] as RowType[] };

  const [outResults, inResults] = await Promise.all([
    client.roQuery<RowType>(outCypher, { params }).catch(() => emptyData),
    client.roQuery<RowType>(inCypher, { params }).catch(() => emptyData),
  ]);

  const hits: TraversalHit[] = [];
  for (const row of outResults.data) {
    hits.push({
      name: row.name, nodeType: row.nodeType, edgeLabel: row.edgeLabel,
      direction: 'outgoing',
      ...(row.filePath != null ? { filePath: row.filePath } : {}),
      ...(row.startLine != null ? { startLine: row.startLine } : {}),
    });
  }
  for (const row of inResults.data) {
    hits.push({
      name: row.name, nodeType: row.nodeType, edgeLabel: row.edgeLabel,
      direction: 'incoming',
      ...(row.filePath != null ? { filePath: row.filePath } : {}),
      ...(row.startLine != null ? { startLine: row.startLine } : {}),
    });
  }
  return hits;
}

// ============================================================================
// Main enriched search function
// ============================================================================

/**
 * Execute a standalone enriched search with unified multi-signal scoring.
 *
 * Runs vector, text, and graph-importance pipelines in parallel, merges
 * candidates, enriches with graph signals, and scores using a unified
 * function that weighs all signals together.
 */
export async function enrichedSearch(
  query: string,
  client: GraphClient,
  options: EnrichedSearchOptions = {},
): Promise<EnrichedSearchResult> {
  const startTime = Date.now();
  const limit = options.limit ?? 20;
  const expandGraph = options.expandGraph ?? true;
  const maxHops = options.maxHops ?? 1;
  const includeDocSnippets = options.includeDocSnippets ?? true;
  const includeVulnFlags = options.includeVulnerabilityFlags ?? true;
  const maxTokens = options.maxTokens;
  const scope = options.scope;

  // Step 1: Extract search terms (code-aware, keeps verbs)
  const searchTerms = extractEnrichedTerms(query);
  logger.debug(`Search terms: ${searchTerms.join(', ')}`);

  // Step 2: Run all retrieval pipelines in parallel
  const [vectorCandidates, textCandidates, importanceCandidates, docSnippets] = await Promise.all([
    runVectorPipeline(client, query, limit, scope, options.embeddings),
    runTextPipeline(client, query, searchTerms, limit, scope),
    runImportancePipeline(client, searchTerms, limit, scope),
    includeDocSnippets
      ? runDocPipeline(client, query).catch(() => [] as DocSnippet[])
      : Promise.resolve([] as DocSnippet[]),
  ]);

  const embeddingAvailable = vectorCandidates.length > 0 || isEmbeddingAvailable(options.embeddings);

  // Step 3: Merge candidates (cross-pipeline dedup)
  const allCandidates = mergeCandidates(vectorCandidates, textCandidates, importanceCandidates);

  // Step 3b: Ensure all candidates have text scores (vector-only candidates need this)
  ensureTextScores(allCandidates, searchTerms);

  // Step 4: Enrich all candidates in parallel
  const enrichmentStart = Date.now();
  await Promise.all(
    allCandidates.slice(0, 30).map((c) => enrichCandidate(client, c)),
  );
  // Batch dependency depth query (one query for all unique file paths)
  await batchQueryDepthFromEntry(client, allCandidates.slice(0, 30));
  const enrichmentDurationMs = Date.now() - enrichmentStart;

  // Step 5: Unified scoring
  const enrichedHits: EnrichedSearchHit[] = allCandidates.map((candidate) => {
    const { score, enrichment } = computeUnifiedScore(candidate);

    if (includeVulnFlags) {
      enrichment.hasVulnerability = hasVulnerabilityPattern(candidate.hit.properties);
    }

    // Base score = max of retrieval scores (for diagnostics)
    const baseScore = Math.max(candidate.vectorScore, candidate.textScore);

    return {
      ...candidate.hit,
      score,
      baseScore,
      enrichment,
    };
  });

  // Step 5b: Reranker — resolves ambiguity when vector pipeline provides semantic candidates
  // Only activate when: (a) reranker is available, (b) vector pipeline returned results
  // (meaning there's genuine semantic ambiguity to resolve), (c) enough candidates exist
  const useReranking = options.reranking === true && vectorCandidates.length > 0;

  if (useReranking && enrichedHits.length >= 5) {
    enrichedHits.sort((a, b) => b.score - a.score);
    const rerankCandidates = enrichedHits.slice(0, Math.max(limit * 2, 30));

    const rerankDocs = rerankCandidates.map((hit) => {
      const parts: string[] = [];
      parts.push(`${hit.nodeType}: ${hit.name}`);
      if (hit.filePath) parts.push(hit.filePath);
      if (hit.properties.docstring) parts.push(String(hit.properties.docstring).slice(0, 300));
      if (hit.properties.bodySnippet) parts.push(String(hit.properties.bodySnippet).slice(0, 200));
      return parts.join('\n');
    });

    try {
      const rerankStart = performance.now();
      const rerankResults = await rerank(query, rerankDocs, {
        topK: Math.max(limit * 2, 30),
      });
      const rerankMs = performance.now() - rerankStart;

      // Blend: 55% unified (structural+semantic) + 45% reranker (cross-encoder relevance)
      // Stronger reranker weight than before because Voyage vectors create real ambiguity
      // that the cross-encoder is well-positioned to resolve
      const UNIFIED_WEIGHT = 0.55;
      const RERANK_WEIGHT = 0.45;

      for (const rr of rerankResults) {
        const hit = rerankCandidates[rr.index]!;
        hit.score = UNIFIED_WEIGHT * hit.score + RERANK_WEIGHT * rr.relevanceScore;
      }

      logger.debug(`Reranked ${rerankCandidates.length} hits in ${rerankMs.toFixed(0)}ms`);
    } catch (err) {
      logger.warn(`Reranking failed, using unified scores: ${err}`);
    }
  }

  // Step 6: Sort by (possibly reranked) score, take top results
  enrichedHits.sort((a, b) => b.score - a.score);

  // Apply minimum score threshold
  const minScore = options.minRRFScore ?? 0.10;
  const filteredHits = enrichedHits
    .filter((h) => h.score >= minScore)
    .slice(0, limit);

  // Step 7: Graph traversal for related nodes
  const related: RelatedHit[] = [];
  let graphExpanded = 0;
  let aboutExpanded = 0;

  if (expandGraph) {
    const codeHitsForGraph = filteredHits
      .filter((h) => h.nodeType !== 'Entity' && h.filePath)
      .slice(0, 10);

    const graphTraversals = await Promise.all(
      codeHitsForGraph.map((hit) =>
        traverseNeighbors(client, hit.nodeType, hit.name, hit.filePath!, maxHops)
          .catch(() => [] as TraversalHit[]),
      ),
    );

    for (let i = 0; i < codeHitsForGraph.length; i++) {
      for (const n of graphTraversals[i]!) {
        if (scope && n.filePath && !n.filePath.startsWith(scope)) continue;
        related.push({ ...n, sourceKey: codeHitsForGraph[i]!.key });
        graphExpanded++;
      }
    }
  }

  // ABOUT edges for knowledge graph connections
  const includeAbout = options.includeAboutEdges ?? true;
  if (includeAbout) {
    const kgOps = createKnowledgeOperations(client);
    const codeHitsForAbout = filteredHits
      .filter((h) => h.nodeType !== 'Entity' && h.name)
      .slice(0, 10);

    const aboutResults = await Promise.all(
      codeHitsForAbout.map((hit) =>
        kgOps.getAboutEdgesForCodeNode(hit.nodeType, hit.name, 5)
          .catch(() => [] as { entityText: string; entityType: string; confidence: number }[]),
      ),
    );

    for (let i = 0; i < codeHitsForAbout.length; i++) {
      for (const edge of aboutResults[i]!) {
        related.push({
          sourceKey: codeHitsForAbout[i]!.key,
          name: edge.entityText,
          nodeType: 'Entity',
          edgeLabel: 'ABOUT',
          direction: 'incoming',
          entityType: edge.entityType,
          aboutConfidence: edge.confidence,
        });
        aboutExpanded++;
      }
    }
  }

  // Step 8: Token budget truncation
  if (maxTokens) {
    truncateHitsToTokenBudget(filteredHits, maxTokens);
  }

  const durationMs = Date.now() - startTime;

  logger.info(
    `Enriched search "${query}": ${filteredHits.length} hits ` +
    `(${vectorCandidates.length} vector, ${textCandidates.length} text, ` +
    `${importanceCandidates.length} importance, ${graphExpanded} graph) in ${durationMs}ms`,
  );

  return {
    hits: filteredHits,
    related,
    docSnippets,
    meta: {
      query,
      totalHits: filteredHits.length,
      vectorHits: vectorCandidates.length,
      textHits: textCandidates.length,
      importanceHits: importanceCandidates.length,
      graphExpanded,
      aboutExpanded,
      embeddingAvailable,
      enrichmentDurationMs,
      hitsEnriched: allCandidates.length,
      docSnippetsFound: docSnippets.length,
      durationMs,
    },
  };
}

// ============================================================================
// Enrichment signal queries
// ============================================================================

async function queryImportance(
  client: GraphClient,
  nodeType: string,
  name: string,
  filePath: string,
): Promise<{ callerCount: number; importerCount: number; testFileCount: number }> {
  if (nodeType === 'File') {
    const cypher = `
      MATCH (f:File {filePath: $filePath})
      OPTIONAL MATCH (other)-[:IMPORTS]->(f)
      OPTIONAL MATCH (t)-[:IMPORTS]->(f)
        WHERE t.filePath CONTAINS 'test' OR t.filePath CONTAINS 'spec' OR t.filePath CONTAINS '__tests__'
      RETURN count(DISTINCT other) AS importerCount,
             count(DISTINCT t) AS testFileCount
    `;
    try {
      const result = await client.roQuery<{ importerCount: number; testFileCount: number }>(
        cypher, { params: { filePath } },
      );
      const row = result.data[0];
      return { callerCount: 0, importerCount: row?.importerCount ?? 0, testFileCount: row?.testFileCount ?? 0 };
    } catch {
      return { callerCount: 0, importerCount: 0, testFileCount: 0 };
    }
  }

  // Query direct CALLS to this symbol + cascade the parent file's IMPORTS count
  // (IMPORTS edges are File→File only, so functions always have importerCount=0
  //  unless we cascade the parent file's importer count)
  const cypher = `
    MATCH (n:${nodeType} {name: $name, filePath: $filePath})
    OPTIONAL MATCH (caller)-[:CALLS]->(n)
    OPTIONAL MATCH (importer)-[:IMPORTS]->(n)
    OPTIONAL MATCH (tf)-[:CALLS]->(n)
      WHERE tf.filePath IS NOT NULL
        AND (tf.filePath CONTAINS 'test' OR tf.filePath CONTAINS 'spec' OR tf.filePath CONTAINS '__tests__')
    OPTIONAL MATCH (parentFile:File {filePath: $filePath})<-[:IMPORTS]-(fileImporter)
    OPTIONAL MATCH (parentFile)<-[:IMPORTS]-(testImporter)
      WHERE testImporter.filePath CONTAINS 'test' OR testImporter.filePath CONTAINS 'spec' OR testImporter.filePath CONTAINS '__tests__'
    RETURN count(DISTINCT caller) AS callerCount,
           count(DISTINCT importer) AS importerCount,
           count(DISTINCT tf) AS testFileCount,
           count(DISTINCT fileImporter) AS fileImporterCount,
           count(DISTINCT testImporter) AS fileTestImporterCount
  `;

  try {
    const result = await client.roQuery<{
      callerCount: number; importerCount: number; testFileCount: number;
      fileImporterCount: number; fileTestImporterCount: number;
    }>(cypher, { params: { name, filePath } });
    const row = result.data[0];
    const directImporterCount = row?.importerCount ?? 0;
    const fileImporterCount = row?.fileImporterCount ?? 0;
    const directTestCount = row?.testFileCount ?? 0;
    const fileTestCount = row?.fileTestImporterCount ?? 0;
    return {
      callerCount: row?.callerCount ?? 0,
      // Combine direct importers + scaled-down parent file importers
      // (file importers are discounted to avoid overwhelming semantic signals)
      importerCount: directImporterCount + Math.floor(fileImporterCount * 0.3),
      testFileCount: Math.max(directTestCount, fileTestCount),
    };
  } catch {
    return { callerCount: 0, importerCount: 0, testFileCount: 0 };
  }
}

async function queryRecency(
  client: GraphClient,
  filePath: string,
): Promise<{ daysSinceLastCommit: number | null; commitCount: number }> {
  const cypher = `
    MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(c:Commit)
    RETURN c.date AS date
    ORDER BY c.date DESC
  `;

  try {
    const result = await client.roQuery<{ date: string }>(cypher, { params: { filePath } });
    if (result.data.length === 0) return { daysSinceLastCommit: null, commitCount: 0 };

    const lastDate = result.data[0]?.date;
    let daysSinceLastCommit: number | null = null;
    if (lastDate) {
      daysSinceLastCommit = Math.floor(
        (Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24),
      );
    }
    return { daysSinceLastCommit, commitCount: result.data.length };
  } catch {
    return { daysSinceLastCommit: null, commitCount: 0 };
  }
}

async function queryAboutEdgeCount(
  client: GraphClient,
  nodeType: string,
  name: string,
  filePath: string,
): Promise<number> {
  const matchProps = nodeType === 'File'
    ? '{filePath: $filePath}'
    : '{name: $name, filePath: $filePath}';

  const cypher = `
    MATCH (n:${nodeType} ${matchProps})<-[:ABOUT]-(e)
    RETURN count(e) AS aboutCount
  `;

  try {
    const result = await client.roQuery<{ aboutCount: number }>(cypher, {
      params: { name, filePath },
    });
    return result.data[0]?.aboutCount ?? 0;
  } catch {
    return 0;
  }
}

/** Entry-point file patterns (index, main, app, server, cli) */
const ENTRY_PATTERNS = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'cli.ts'];

/**
 * Batch query: for each unique filePath among candidates, find shortest IMPORTS
 * path to an entry-point file. One graph query instead of N per-candidate queries.
 */
async function batchQueryDepthFromEntry(
  client: GraphClient,
  candidates: CandidateHit[],
): Promise<void> {
  const filePaths = [...new Set(candidates.map((c) => c.hit.filePath).filter(Boolean))] as string[];
  if (filePaths.length === 0) return;

  // Find entry-point files in the graph
  const entryConditions = ENTRY_PATTERNS.map((p) => `f.filePath ENDS WITH '${p}'`).join(' OR ');
  const cypher = `
    MATCH (f:File)
    WHERE ${entryConditions}
    RETURN f.filePath AS fp
  `;

  try {
    const entryResult = await client.roQuery<{ fp: string }>(cypher);
    const entryFiles = entryResult.data.map((r) => r.fp);
    if (entryFiles.length === 0) return;

    // For each candidate file, find shortest path to any entry file
    // Use a single batched query with UNWIND for efficiency
    const depthCypher = `
      UNWIND $filePaths AS targetPath
      MATCH (target:File {filePath: targetPath})
      OPTIONAL MATCH path = shortestPath((entry:File)-[:IMPORTS*1..6]->(target))
        WHERE entry.filePath IN $entryFiles
      RETURN targetPath AS fp,
             CASE WHEN path IS NOT NULL THEN length(path) ELSE NULL END AS depth
    `;

    const depthResult = await client.roQuery<{ fp: string; depth: number | null }>(
      depthCypher,
      { params: { filePaths, entryFiles } },
    );

    // Build lookup map
    const depthMap = new Map<string, number | null>();
    for (const row of depthResult.data) {
      const existing = depthMap.get(row.fp);
      // Keep shortest depth
      if (existing == null || (row.depth != null && row.depth < existing)) {
        depthMap.set(row.fp, row.depth);
      }
    }

    // Apply to candidates
    for (const c of candidates) {
      if (c.hit.filePath) {
        c.depthFromEntry = depthMap.get(c.hit.filePath) ?? null;
      }
    }
  } catch (err) {
    logger.debug('Dependency depth query failed:', err);
  }
}

// ============================================================================
// Score computation helpers
// ============================================================================

function computeImportanceScore(
  callerCount: number, importerCount: number,
  commitCount: number = 0, depthFromEntry: number | null = null,
): number {
  const totalInbound = callerCount + importerCount;
  const inboundScore = totalInbound === 0 ? 0 : Math.min(1.0, Math.log(1 + totalInbound) / Math.log(21));
  // Churn: files with more commits are actively maintained / important
  const churnScore = commitCount === 0 ? 0 : Math.min(1.0, Math.log(1 + commitCount) / Math.log(50));
  // Depth: closer to entry points = more important (1 hop = 1.0, 6 hops = 0.17)
  const depthScore = depthFromEntry == null ? 0 : Math.max(0, 1.0 - (depthFromEntry - 1) * 0.17);
  // Blend: 85% structural, 10% churn, 5% depth
  return inboundScore * 0.85 + churnScore * 0.10 + depthScore * 0.05;
}

function computeRecencyScore(daysSinceLastCommit: number | null): number {
  if (daysSinceLastCommit == null) return 0.3;
  if (daysSinceLastCommit <= 1) return 1.0;
  if (daysSinceLastCommit <= 7) return 0.9;
  if (daysSinceLastCommit <= 30) return 0.7;
  if (daysSinceLastCommit <= 90) return 0.5;
  return 0.3;
}

function computeDocumentationScore(hasDocstring: boolean, aboutEdgeCount: number): number {
  let score = 0;
  if (hasDocstring) score += 0.6;
  score += Math.min(0.4, aboutEdgeCount * 0.1);
  return Math.min(1.0, score);
}

function computeLocScore(properties: Record<string, unknown>, nodeType: string): number {
  // For functions/classes: use startLine/endLine to estimate LOC
  // For files: use loc property
  let loc: number;
  if (nodeType === 'File') {
    loc = (properties.loc as number) ?? 0;
  } else {
    const startLine = (properties.startLine as number) ?? 0;
    const endLine = (properties.endLine as number) ?? 0;
    loc = endLine > startLine ? endLine - startLine : 0;
  }
  if (loc === 0) return 0.5; // unknown size — neutral
  if (loc <= 2) return 0.3;  // trivial (one-liners, re-exports)
  if (loc <= 10) return 0.6; // small but substantive
  if (loc <= 50) return 1.0; // sweet spot for functions
  if (loc <= 150) return 0.8; // getting large
  if (loc <= 300) return 0.5; // large
  return 0.3;                 // monolithic
}

function computeComplexityPenalty(complexity: number): number {
  if (complexity > 40) return -0.05;
  if (complexity > 25) return -0.03;
  if (complexity > 15) return -0.01;
  return 0;
}

function truncateHitsToTokenBudget(hits: EnrichedSearchHit[], maxTokens: number): void {
  const perHitBudget = Math.floor(maxTokens / Math.max(1, hits.length));
  const propBudget = Math.max(50, perHitBudget - 50);

  for (const hit of hits) {
    if (hit.properties.docstring && typeof hit.properties.docstring === 'string') {
      hit.properties.docstring = truncateToTokenBudget(
        hit.properties.docstring,
        Math.floor(propBudget * 0.6),
      );
    }
    if (hit.properties.bodySnippet && typeof hit.properties.bodySnippet === 'string') {
      hit.properties.bodySnippet = truncateToTokenBudget(
        hit.properties.bodySnippet,
        Math.floor(propBudget * 0.4),
      );
    }
  }
}
