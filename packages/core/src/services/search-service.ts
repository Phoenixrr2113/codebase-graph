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
      return `n.filePath STARTS WITH $path${i} OR n.path STARTS WITH $path${i}`;
    });
    pathFilter = `AND (${pathConditions.join(' OR ')})`;
  }

  const labelsExpr = dialect.labelsExpr('n');
  const cypher = `
    MATCH (n)
    WHERE ${typeFilter}
      AND (
        toLower(n.name) CONTAINS toLower($term)
        OR toLower(n.path) CONTAINS toLower($term)
      )
      ${pathFilter}
    RETURN n, ${labelsExpr} as labels
    SKIP $offset
    LIMIT $limit
  `;

  const result = await client.roQuery<{
    n: Record<string, unknown>;
    labels: string | string[];
  }>(cypher, { params: { term: query, limit, offset, ...pathParams } });

  const results: ServiceSearchResult[] = (result.data ?? []).map((row) => {
    const normalized = dialect.normalizeNode(row.n);
    const props = normalized.properties;
    const labelsArr = Array.isArray(row.labels)
      ? row.labels
      : typeof row.labels === 'string'
        ? [row.labels]
        : normalized.labels;

    return {
      name: (props['name'] as string) ?? (props['path'] as string) ?? 'unknown',
      type: labelsArr[0] ?? 'Unknown',
      filePath: (props['filePath'] as string) ?? (props['path'] as string) ?? '',
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
    cypher = `
      MATCH (n)
      WHERE ${labelFilter}
        AND n.name CONTAINS $query ${scopeFilter}
      RETURN n.name as name, ${firstLabel} as kind, n.filePath as file, n.startLine as line
      ORDER BY n.name
      LIMIT 50
    `;
  } else {
    cypher = `
      MATCH (n)
      WHERE ${labelFilter}
        AND toLower(n.name) CONTAINS toLower($query) ${scopeFilter}
      RETURN n.name as name, ${firstLabel} as kind, n.filePath as file, n.startLine as line
      ORDER BY n.name
      LIMIT 50
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
