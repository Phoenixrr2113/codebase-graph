/**
 * CodeGraphService — Thin Facade (QUAL.1)
 *
 * Delegates to focused sub-services:
 * - SearchService: search, findSymbol, searchCode, hybridSearchCode, strategySearch
 * - GraphDataService: graph traversal, entity access, project management
 *
 * Consumers: @codegraph/mcp-server, @codegraph/api, @codegraph/cli
 */

// Re-export all public types from services/types
export type {
  ServiceSearchResult,
  ServiceSymbolResult,
  ServiceCodeSearchResult,
  ServiceEntityContext,
  ServiceRelatedEntity,
  ServiceDependencyInfo,
  ServiceComplexityHotspot,
  ServiceComplexitySummary,
  ServiceProjectInfo,
  ServiceChangeInfo,
  EntityWithConnections,
  Pagination,
  PaginatedNodesResult,
  NodesQueryOptions,
  Direction,
  NeighborsResult,
  CypherResult,
} from './services/types';

// Import sub-service implementations
import {
  searchEntities,
  findSymbolImpl,
  searchCodeImpl,
  hybridSearchCodeImpl,
  strategySearchImpl,
  warmupSearch as warmupSearchImpl,
} from './services/search-service';


import {
  getGraphStatsImpl,
  getFullGraphImpl,
  getFileSubgraphImpl,
  getDependencyTreeImpl,
  buildFileTreeImpl,
  getIndexSummaryImpl,
  getProjectsImpl,
  deleteProjectImpl,
  clearGraphImpl,
  deleteFileEntitiesImpl,
  removeFileAndCleanupImpl,
  resolveProjectRootPathImpl,
  executeReadQueryImpl,
  getEntityWithConnectionsImpl,
  getNodesPaginatedImpl,
  getNeighborsImpl,
} from './services/graph-data-service';

// Import types needed for method signatures
import type {
  ServiceSearchResult,
  ServiceSymbolResult,
  ServiceCodeSearchResult,
  EntityWithConnections,
  PaginatedNodesResult,
  NodesQueryOptions,
  Direction,
  NeighborsResult,
  CypherResult,
} from './services/types';

import type { HybridSearchResult, CodeNodeType } from './hybridSearch';
import type { SearchResponse } from './search';
import type { GraphStats, GraphData, SubgraphData } from '@codegraph/types';
import type { FileTreeOptions } from '@codegraph/graph';
import type { ProjectEntity } from '@codegraph/types';

// ============================================================================
// CodeGraphService — Thin Facade
// ============================================================================

class CodeGraphServiceImpl {
  // --- Search & Discovery ---

  async search(
    query: string,
    options?: {
      type?: 'all' | 'file' | 'function' | 'class' | 'interface' | 'component';
      types?: string[];
      limit?: number;
      offset?: number;
    },
  ): Promise<{ results: ServiceSearchResult[]; total: number; project?: string }> {
    return searchEntities(query, options);
  }

  async findSymbol(
    name: string,
    options?: { kind?: 'function' | 'class' | 'interface' | 'variable' | 'any'; file?: string },
  ): Promise<{ symbol: ServiceSymbolResult | null; alternatives?: ServiceSymbolResult[] }> {
    return findSymbolImpl(name, options);
  }

  async searchCode(
    query: string,
    options?: { type?: 'name' | 'fulltext' | 'pattern'; scope?: string },
  ): Promise<ServiceCodeSearchResult[]> {
    return searchCodeImpl(query, options);
  }

  async hybridSearchCode(
    query: string,
    options?: {
      limit?: number;
      nodeTypes?: CodeNodeType[];
      includeKnowledge?: boolean;
      scope?: string;
    },
  ): Promise<HybridSearchResult> {
    return hybridSearchCodeImpl(query, options);
  }

  async strategySearch(
    query: string,
    strategy: string,
    options?: { limit?: number; scope?: string },
  ): Promise<SearchResponse> {
    return strategySearchImpl(query, strategy, options);
  }

  // --- Graph Stats ---

  async getGraphStats(): Promise<GraphStats> {
    return getGraphStatsImpl();
  }

  // --- Graph Traversal ---

  async getFullGraph(limit?: number, rootPath?: string): Promise<GraphData> {
    return getFullGraphImpl(limit, rootPath);
  }

  async getFileSubgraph(filePath: string): Promise<SubgraphData> {
    return getFileSubgraphImpl(filePath);
  }

  async getDependencyTree(filePath: string, depth?: number): Promise<GraphData> {
    return getDependencyTreeImpl(filePath, depth);
  }

  // --- Context Building ---

  async buildFileTree(options?: FileTreeOptions): Promise<string> {
    return buildFileTreeImpl(options);
  }

  async getIndexSummary(): Promise<string> {
    return getIndexSummaryImpl();
  }

  // --- Project Management ---

  async getProjects(): Promise<ProjectEntity[]> {
    return getProjectsImpl();
  }

  async deleteProject(projectId: string): Promise<void> {
    return deleteProjectImpl(projectId);
  }

  async clearGraph(): Promise<void> {
    return clearGraphImpl();
  }

  async deleteFileEntities(filePath: string): Promise<void> {
    return deleteFileEntitiesImpl(filePath);
  }

  async removeFileAndCleanup(filePath: string): Promise<void> {
    return removeFileAndCleanupImpl(filePath);
  }

  async resolveProjectRootPath(projectId: string): Promise<string | undefined> {
    return resolveProjectRootPathImpl(projectId);
  }

  // --- Raw Query Execution ---

  async executeReadQuery(
    cypherQuery: string,
    params: Record<string, unknown> = {},
  ): Promise<CypherResult> {
    return executeReadQueryImpl(cypherQuery, params);
  }

  // --- Entity & Traversal ---

  async getEntityWithConnections(id: string, depth?: number): Promise<EntityWithConnections | null> {
    return getEntityWithConnectionsImpl(id, depth);
  }

  async getNodesPaginated(options?: NodesQueryOptions): Promise<PaginatedNodesResult> {
    return getNodesPaginatedImpl(options);
  }

  async getNeighbors(
    id: string,
    direction: Direction = 'both',
    edgeTypes?: string[],
    depth: number = 1,
  ): Promise<NeighborsResult> {
    return getNeighborsImpl(id, direction, edgeTypes, depth);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const codeGraphService = new CodeGraphServiceImpl();

/** Type alias for the service */
export type CodeGraphService = typeof codeGraphService;

// ============================================================================
// Warmup (PERF.15)
// ============================================================================

export { warmupSearchImpl as warmupSearch };
