/**
 * SearchService — search and discovery methods.
 * @module services/search-service
 */

import { getGraphClient } from '../graphClient';
import { getActiveProjectPaths } from '../config';
import { hybridSearch } from '../hybridSearch';
import type { HybridSearchResult, HybridSearchOptions, CodeNodeType } from '../hybridSearch';
import { createDefaultSearchRegistry } from '../search';
import type { SearchResponse, SearchType, SearchContext } from '../search';
import { labelOr, ALL_LABELS } from './helpers';
import type {
  ServiceSearchResult,
  ServiceSymbolResult,
  ServiceCodeSearchResult,
} from './types';

// ============================================================================
// Cached singletons for search (PERF.15)
// ============================================================================

let _searchRegistry: ReturnType<typeof createDefaultSearchRegistry> | null = null;

function getSearchRegistry() {
  if (!_searchRegistry) {
    _searchRegistry = createDefaultSearchRegistry();
  }
  return _searchRegistry;
}

// ============================================================================
// Search & Discovery
// ============================================================================

/**
 * Search the codebase for entities by name.
 */
export async function searchEntities(
  query: string,
  options?: {
    type?: 'all' | 'file' | 'function' | 'class' | 'interface' | 'component';
    types?: string[];
    limit?: number;
    offset?: number;
  },
): Promise<{ results: ServiceSearchResult[]; total: number; project?: string }> {
  const client = await getGraphClient();
  const dialect = client.dialect;
  const activePaths = await getActiveProjectPaths();
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const type = options?.type ?? 'all';

  // Build type filter — support array of types or single type
  let typeFilter: string;
  if (options?.types && options.types.length > 0) {
    const capitalizedTypes = options.types.map(t => t.charAt(0).toUpperCase() + t.slice(1));
    typeFilter = `(${labelOr(dialect, 'n', capitalizedTypes)})`;
  } else if (type === 'all') {
    typeFilter = `(${labelOr(dialect, 'n', ALL_LABELS)})`;
  } else {
    typeFilter = dialect.labelCheckExpr('n', type.charAt(0).toUpperCase() + type.slice(1));
  }

  // Build project path filter using parameterized paths
  let pathFilter = '';
  const pathParams: Record<string, string> = {};
  if (activePaths.length > 0) {
    const pathConditions = activePaths.map((p, i) => {
      pathParams[`path${i}`] = p;
      return `n.filePath STARTS WITH $path${i}`;
    });
    pathFilter = `AND (${pathConditions.join(' OR ')})`;
  }

  const labelsExpr = dialect.labelsExpr('n');

  // Score results by relevance:
  //   match type: exact name (30) > name contains (20) > path contains (10)
  //   node type boost: Function/Class/Component (+5) > Interface (+3) > File (+2) > Variable/Type (+0)
  const fnCheck = dialect.labelCaseExpr('n', 'Function');
  const clsCheck = dialect.labelCaseExpr('n', 'Class');
  const cmpCheck = dialect.labelCaseExpr('n', 'Component');
  const ifCheck = dialect.labelCaseExpr('n', 'Interface');
  const fileCheck = dialect.labelCaseExpr('n', 'File');
  const cypher = `
    MATCH (n)
    WHERE ${typeFilter}
      AND (
        toLower(n.name) CONTAINS toLower($term)
        OR toLower(n.filePath) CONTAINS toLower($term)
      )
      ${pathFilter}
    WITH n, ${labelsExpr} as labels,
      CASE
        WHEN toLower(n.name) = toLower($term) THEN 30
        WHEN toLower(n.name) CONTAINS toLower($term) THEN 20
        ELSE 10
      END +
      CASE
        WHEN ${fnCheck} THEN 5
        WHEN ${clsCheck} THEN 5
        WHEN ${cmpCheck} THEN 5
        WHEN ${ifCheck} THEN 3
        WHEN ${fileCheck} THEN 2
        ELSE 0
      END AS relevance
    ORDER BY relevance DESC, n.name ASC
    SKIP $offset
    LIMIT $limit
    RETURN n, labels
  `;

  const result = await client.roQuery<{
    n: Record<string, unknown>;
    labels: string | string[];
  }>(cypher, { params: { term: query, limit, offset, ...pathParams } });

  let rows = result.data ?? [];

  // Fuzzy fallback: if no results, try token-based matching then prefix+Levenshtein
  if (rows.length === 0 && query.length >= 4) {
    const tokens = splitIdentifierTokens(query);

    // Stage 1: token-based matching (works for typos within one word of a multi-word identifier)
    if (tokens.length >= 2) {
      const tokenParams: Record<string, string | number | boolean | null | Array<unknown>> = { ...pathParams, limit: limit * 3, offset: 0 };
      const tokenConditions = tokens.map((t, i) => {
        tokenParams[`tok${i}`] = t.toLowerCase();
        return `toLower(n.name) CONTAINS $tok${i}`;
      });
      const minHits = Math.max(2, Math.ceil(tokens.length * 0.5));
      const tokenHitsExpr = tokens.map((_, i) => `CASE WHEN toLower(n.name) CONTAINS $tok${i} THEN 1 ELSE 0 END`).join(' + ');
      const fuzzyCypher = `
        MATCH (n)
        WHERE ${typeFilter}
          AND (${tokenConditions.join(' OR ')})
          ${pathFilter}
        WITH n, ${labelsExpr} as labels,
          ${tokenHitsExpr} AS tokenHits
        WHERE tokenHits >= ${minHits}
        RETURN n, labels, tokenHits
        ORDER BY tokenHits DESC, n.name ASC
        LIMIT $limit
      `;
      const fuzzyResult = await client.roQuery<{
        n: Record<string, unknown>;
        labels: string | string[];
        tokenHits: number;
      }>(fuzzyCypher, { params: tokenParams });
      // Re-rank by Levenshtein distance within same tokenHits tier
      const fuzzyRows = fuzzyResult.data ?? [];
      if (fuzzyRows.length > 1) {
        const scored = fuzzyRows.map(row => {
          const normalized = dialect.normalizeNode(row.n);
          const name = (normalized.properties['name'] as string) ?? '';
          return { row, dist: levenshtein(query.toLowerCase(), name.toLowerCase()) };
        });
        scored.sort((a, b) => a.dist - b.dist);
        rows = scored.slice(0, limit).map(s => s.row);
      } else {
        rows = fuzzyRows;
      }
    }

    // Stage 2: prefix/suffix + Levenshtein (handles typos anywhere)
    if (rows.length === 0) {
      const lenMin = Math.max(1, query.length - 3);
      const lenMax = query.length + 3;
      // Try both prefix (first 3 chars) and suffix (last 5 chars) to handle typos at any position
      const prefix = query.slice(0, 3).toLowerCase();
      const suffix = query.slice(-5).toLowerCase();
      const prefixCypher = `
        MATCH (n)
        WHERE ${typeFilter}
          AND (
            toLower(n.name) STARTS WITH $prefix
            OR toLower(n.name) ENDS WITH $suffix
          )
          AND size(n.name) >= $lenMin AND size(n.name) <= $lenMax
          ${pathFilter}
        RETURN n, ${labelsExpr} as labels
        LIMIT 200
      `;
      const prefixResult = await client.roQuery<{
        n: Record<string, unknown>;
        labels: string | string[];
      }>(prefixCypher, { params: { prefix, suffix, lenMin, lenMax, ...pathParams } });

      if (prefixResult.data.length > 0) {
        // Rank by Levenshtein distance
        const scored = prefixResult.data.map(row => {
          const normalized = dialect.normalizeNode(row.n);
          const name = (normalized.properties['name'] as string) ?? '';
          const dist = levenshtein(query.toLowerCase(), name.toLowerCase());
          return { row, dist };
        });
        scored.sort((a, b) => a.dist - b.dist);
        // Only keep results with reasonable edit distance (≤ 30% of query length)
        const maxDist = Math.max(3, Math.ceil(query.length * 0.3));
        rows = scored.filter(s => s.dist <= maxDist).slice(0, limit).map(s => s.row);
      }
    }
  }

  const results: ServiceSearchResult[] = rows.map((row) => {
    const normalized = dialect.normalizeNode(row.n);
    const props = normalized.properties;
    const labelsArr = Array.isArray(row.labels)
      ? row.labels
      : typeof row.labels === 'string'
        ? [row.labels]
        : normalized.labels;

    return {
      name: (props['name'] as string) ?? (props['filePath'] as string) ?? 'unknown',
      type: labelsArr[0] ?? 'Unknown',
      filePath: (props['filePath'] as string) ?? '',
      line: props['startLine'] as number | undefined,
    };
  });

  const response: { results: ServiceSearchResult[]; total: number; project?: string } = {
    results,
    total: results.length,
  };
  if (activePaths.length === 1) {
    const projectName = activePaths[0]?.split('/').pop();
    if (projectName) response.project = projectName;
  }
  return response;
}

/**
 * Split an identifier into tokens by camelCase and underscore boundaries.
 * "checkHardcodedSecrets" → ["check", "Hardcoded", "Secrets"]
 * "get_file_path" → ["get", "file", "path"]
 */
function splitIdentifierTokens(name: string): string[] {
  // Split on underscores first
  const parts = name.split('_').filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    // Split camelCase: insert boundary before uppercase letters
    const camelTokens = part.replace(/([a-z])([A-Z])/g, '$1\0$2').split('\0');
    tokens.push(...camelTokens.filter(t => t.length >= 2));
  }
  return tokens;
}

/**
 * Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[n]!;
}

/**
 * Find a symbol by exact name, optionally filtered by kind and file.
 */
export async function findSymbolImpl(
  name: string,
  options?: { kind?: 'function' | 'class' | 'interface' | 'variable' | 'any'; file?: string },
): Promise<{ symbol: ServiceSymbolResult | null; alternatives?: ServiceSymbolResult[] }> {
  const client = await getGraphClient();
  const dialect = client.dialect;
  const labelsExpr = dialect.labelsExpr('n');
  const kind = options?.kind ?? 'any';
  const file = options?.file;

  const kindToLabel: Record<string, string> = {
    function: 'Function',
    class: 'Class',
    interface: 'Interface',
    variable: 'Variable',
    any: '',
  };
  const label = kindToLabel[kind] || '';

  let cypher: string;
  const params: Record<string, string | number | boolean | null | Array<unknown>> = { name };
  const anyLabelFilter = `(${labelOr(dialect, 'n', ['Function', 'Class', 'Interface', 'Variable'])})`;

  if (label && file) {
    cypher = `MATCH (n:${label}) WHERE n.name = $name AND n.filePath CONTAINS $file RETURN n, ${labelsExpr} as labels LIMIT 10`;
    params.file = file;
  } else if (label) {
    cypher = `MATCH (n:${label}) WHERE n.name = $name RETURN n, ${labelsExpr} as labels LIMIT 10`;
  } else if (file) {
    cypher = `MATCH (n) WHERE n.name = $name AND n.filePath CONTAINS $file AND ${anyLabelFilter} RETURN n, ${labelsExpr} as labels LIMIT 10`;
    params.file = file;
  } else {
    cypher = `MATCH (n) WHERE n.name = $name AND ${anyLabelFilter} RETURN n, ${labelsExpr} as labels LIMIT 10`;
  }

  const result = await client.roQuery<{ n: Record<string, unknown>; labels: string | string[] }>(
    cypher,
    { params },
  );

  if (result.data.length === 0) {
    return { symbol: null };
  }

  const symbols: ServiceSymbolResult[] = result.data.map((row) => {
    const normalized = dialect.normalizeNode(row.n);
    const props = normalized.properties;
    const labelsArr = Array.isArray(row.labels)
      ? row.labels
      : typeof row.labels === 'string'
        ? [row.labels]
        : normalized.labels;
    return {
      name: (props['name'] as string) || 'unknown',
      kind: (labelsArr[0] || 'unknown').toLowerCase(),
      file: (props['filePath'] as string) || '',
      line: (props['startLine'] as number) || (props['line'] as number) || 0,
      endLine: props['endLine'] as number | undefined,
      signature: props['signature'] as string | undefined,
      complexity: props['complexity'] as number | undefined,
    };
  });

  const response: { symbol: ServiceSymbolResult | null; alternatives?: ServiceSymbolResult[] } = {
    symbol: symbols[0] ?? null,
  };
  if (symbols.length > 1) {
    response.alternatives = symbols.slice(1);
  }
  return response;
}

/**
 * Search code by name or text pattern.
 */
export async function searchCodeImpl(
  query: string,
  options?: {
    type?: 'name' | 'fulltext' | 'pattern';
    scope?: string;
  },
): Promise<ServiceCodeSearchResult[]> {
  const client = await getGraphClient();
  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');
  const scope = options?.scope && options.scope !== 'all' ? options.scope : '';
  const searchType = options?.type ?? 'name';

  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';
  const labelFilter = `(${labelOr(dialect, 'n', ['Function', 'Class', 'Interface', 'Variable', 'Component'])})`;

  let cypher: string;
  if (searchType === 'name') {
    // Rank: exact match (3) > name contains (2) > alphabetical
    cypher = `
      MATCH (n)
      WHERE ${labelFilter}
        AND n.name CONTAINS $query ${scopeFilter}
      WITH n, ${firstLabel} as kind,
        CASE
          WHEN n.name = $query THEN 3
          WHEN toLower(n.name) = toLower($query) THEN 2
          ELSE 1
        END AS relevance
      ORDER BY relevance DESC, n.name ASC
      LIMIT 50
      RETURN n.name as name, kind, n.filePath as file, n.startLine as line
    `;
  } else {
    // Fulltext/pattern: rank by relevance
    cypher = `
      MATCH (n)
      WHERE ${labelFilter}
        AND toLower(n.name) CONTAINS toLower($query) ${scopeFilter}
      WITH n, ${firstLabel} as kind,
        CASE
          WHEN toLower(n.name) = toLower($query) THEN 3
          WHEN toLower(n.name) CONTAINS toLower($query) THEN 2
          ELSE 1
        END AS relevance
      ORDER BY relevance DESC, n.name ASC
      LIMIT 50
      RETURN n.name as name, kind, n.filePath as file, n.startLine as line
    `;
  }

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { query };
  if (scope) params.scope = scope;

  const result = await client.roQuery<{
    name: string;
    kind: string;
    file: string;
    line: number;
  }>(cypher, { params });

  return result.data.map((row) => ({
    name: row.name ?? 'unknown',
    kind: (row.kind ?? 'unknown').toLowerCase(),
    file: row.file ?? '',
    line: row.line ?? 0,
  }));
}

/**
 * Hybrid search — vector + text + graph traversal + knowledge graph.
 */
export async function hybridSearchCodeImpl(
  query: string,
  options?: {
    limit?: number;
    nodeTypes?: CodeNodeType[];
    includeKnowledge?: boolean;
    scope?: string;
  },
): Promise<HybridSearchResult> {
  const client = await getGraphClient();

  const opts: HybridSearchOptions = {
    limit: options?.limit ?? 30,
    includeKnowledge: options?.includeKnowledge ?? true,
    expandGraph: true,
    maxHops: 1,
    includeAboutEdges: true,
  };
  if (options?.nodeTypes) opts.nodeTypes = options.nodeTypes;
  if (options?.scope) opts.scope = options.scope;

  return hybridSearch(query, client, opts);
}

/**
 * Strategy-based search using the SearchRegistry.
 */
export async function strategySearchImpl(
  query: string,
  strategy: string,
  options?: { limit?: number; scope?: string },
): Promise<SearchResponse> {
  const client = await getGraphClient();
  const context: SearchContext = { client };

  // LLM models are cached inside getLLMModel/getLLMComplexModel (PERF.15)
  try {
    const { isLLMAvailable, getLLMModel, getLLMComplexModel } = await import('@codegraph/plugin-nlp');
    if (isLLMAvailable()) {
      context.llm = await getLLMModel();
      const complexLlm = await getLLMComplexModel();
      if (complexLlm) context.complexLlm = complexLlm;
    }
  } catch {
    // plugin-nlp not available — strategies that require LLM will fail gracefully
  }

  const registry = getSearchRegistry();
  const searchType = strategy as SearchType;

  const request: { query: string; type: SearchType; limit?: number; scope?: string } = {
    query,
    type: searchType,
  };
  if (options?.limit) request.limit = options.limit;
  if (options?.scope && options.scope !== 'all') request.scope = options.scope;

  return registry.search(request, context);
}

// ============================================================================
// Warmup (PERF.15)
// ============================================================================

/**
 * Pre-initialize LLM providers, embedding models, and the search registry.
 */
export async function warmupSearch(): Promise<void> {
  const start = performance.now();

  // 1. Pre-warm search registry
  getSearchRegistry();

  // 2. Pre-warm LLM providers + embedding model
  try {
    const nlp = await import('@codegraph/plugin-nlp');
    await Promise.all([
      nlp.warmupLLM(),
      nlp.warmupEmbedding(),
    ]);
  } catch {
    // plugin-nlp not available — non-fatal
  }

  const ms = (performance.now() - start).toFixed(0);
  const { createLogger: cl } = await import('@codegraph/logger');
  cl({ namespace: 'core:warmup' }).info(`Search warmup complete in ${ms}ms`);
}
