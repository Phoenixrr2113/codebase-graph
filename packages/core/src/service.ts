/**
 * CodeGraphService — Thin Facade
 *
 * Delegates to:
 * - SearchService: search (enrichedSearchV2)
 * - GraphDataService: graph traversal, entity access, project management
 *
 * Consumers: @codegraph/mcp-server, @codegraph/api, @codegraph/cli
 */

// Re-export all public types from services/types
export type {
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
  searchImpl,
  warmupSearch as warmupSearchImpl,
} from './services/search-service';

import {
  getGraphStatsImpl,
  getFullGraphImpl,
  getFileSubgraphImpl,
  getSymbolReferencesImpl,
  getDependencyTreeImpl,
  buildFileTreeImpl,
  getIndexSummaryImpl,
  getProjectsImpl,
  deleteProjectImpl,
  clearGraphImpl,
  removeFileAndCleanupImpl,
  resolveProjectRootPathImpl,
  executeReadQueryImpl,
  getEntityWithConnectionsImpl,
  getNodesPaginatedImpl,
  getNeighborsImpl,
} from './services/graph-data-service';

import {
  getBlastRadiusImpl,
  getImportCyclesImpl,
  getCallHierarchyImpl,
  getUnreferencedExportsImpl,
  getHotspotsImpl,
  getChangeCouplingImpl,
} from './services/analysis-service';

// Import types needed for method signatures
import type {
  EntityWithConnections,
  PaginatedNodesResult,
  NodesQueryOptions,
  Direction,
  NeighborsResult,
  CypherResult,
} from './services/types';

import type { EnrichedV2Result } from './enrichedSearchV2';
import type { GraphStats, GraphData, SubgraphData } from '@codegraph/types';
import type {
  FileTreeOptions,
  SymbolReferenceQuery,
  SymbolReferencesResult,
  BlastRadiusInput,
  BlastRadiusResult,
  ImportCyclesInput,
  ImportCyclesResult,
  CallHierarchyInput,
  CallHierarchyResult,
  UnreferencedExportsInput,
  UnreferencedExportsResult,
  HotspotsInput,
  HotspotsResult,
  ChangeCouplingInput,
  ChangeCouplingResult,
} from '@codegraph/graph';
import type { ProjectEntity } from '@codegraph/types';

// ============================================================================
// CodeGraphService — Thin Facade
// ============================================================================

class CodeGraphServiceImpl {
  // --- Search ---

  async search(
    query: string,
    options?: { limit?: number; scope?: string },
  ): Promise<EnrichedV2Result> {
    return searchImpl(query, options);
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

  async getSymbolReferences(query: SymbolReferenceQuery): Promise<SymbolReferencesResult> {
    return getSymbolReferencesImpl(query);
  }

  async getDependencyTree(filePath: string, depth?: number): Promise<GraphData> {
    return getDependencyTreeImpl(filePath, depth);
  }

  // --- Analysis ---

  async getBlastRadius(input: BlastRadiusInput): Promise<BlastRadiusResult> {
    return getBlastRadiusImpl(input);
  }

  async getImportCycles(input: ImportCyclesInput): Promise<ImportCyclesResult> {
    return getImportCyclesImpl(input);
  }

  async getCallHierarchy(input: CallHierarchyInput): Promise<CallHierarchyResult> {
    return getCallHierarchyImpl(input);
  }

  async getUnreferencedExports(input: UnreferencedExportsInput): Promise<UnreferencedExportsResult> {
    return getUnreferencedExportsImpl(input);
  }

  async getHotspots(input: HotspotsInput): Promise<HotspotsResult> {
    return getHotspotsImpl(input);
  }

  async getChangeCoupling(input: ChangeCouplingInput): Promise<ChangeCouplingResult> {
    return getChangeCouplingImpl(input);
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
