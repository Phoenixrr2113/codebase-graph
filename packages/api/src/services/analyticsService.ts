/**
 * Analytics Service
 * 
 * Central service for running and caching analytics.
 * Orchestrates security, complexity, refactoring, dataflow, and impact analysis.
 * 
 * @module services/analyticsService
 */

import { glob } from 'glob';
import {
  initParser,
  parseFile,
  scanForVulnerabilities,
  analyzeDataflow,
  analyzeRefactoring,
  sortBySeverity,
  type SecurityFinding,
  type RefactoringAnalysisInput,
} from '@codegraph/parser';
import { getClient } from '../model/graphClient';
import { getAnalyticsCache } from './analyticsCache';
import { getAnalyticsScheduler } from './analyticsScheduler';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Analytics' });

// ============================================================================
// Types
// ============================================================================

export interface SecurityResult {
  findings: SecurityFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  filesScanned: number;
  cachedAt: string | null;
}

export interface ComplexityHotspot {
  name: string;
  filePath: string;
  complexity: number;
  cognitive: number;
  nesting: number;
  lines: number;
}

export interface ComplexityResult {
  hotspots: ComplexityHotspot[];
  avgComplexity: number;
  maxComplexity: number;
  cachedAt: string | null;
}

export interface RefactoringResult {
  file: string;
  totalFunctions: number;
  extractionCandidates: Array<{
    name: string;
    couplingScore: number;
    internalCalls: number;
  }>;
  couplingLevel: 'low' | 'medium' | 'high';
  avgCouplingScore: number;
  cachedAt: string | null;
}

export interface DataflowResult {
  file: string;
  sources: number;
  sinks: number;
  vulnerabilities: Array<{
    source: string;
    sink: string;
    severity: string;
    category: string;
  }>;
  cachedAt: string | null;
}

export interface ImpactResult {
  symbol: string;
  directCallers: number;
  transitiveCallers: number;
  affectedFiles: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  cachedAt: string | null;
}

export interface AnalyticsSummary {
  projectPath: string;
  security: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  complexity: {
    hotspots: number;
    avgComplexity: number;
    maxComplexity: number;
  };
  refactoring: {
    filesAnalyzed: number;
    extractionCandidates: number;
  };
  dataflow: {
    vulnerabilities: number;
    sources: number;
    sinks: number;
  };
  lastFullScan: string | null;
  cachedAt: string | null;
}

// ============================================================================
// Analytics Service
// ============================================================================

export class AnalyticsService {
  private parserInitialized = false;
  private lastFullScan: Date | null = null;

  constructor() {
    // Wire up scheduler execution callback
    const scheduler = getAnalyticsScheduler();
    scheduler.setExecuteCallback(async (job) => {
      logger.info(`[Analytics] Executing job ${job.id}: ${job.analyses.join(', ')}`);

      for (const analysis of job.analyses) {
        try {
          if (analysis === 'full') {
            await this.runFullAnalysis(job.projectPath);
          } else if (analysis === 'security') {
            await this.getSecurityAnalysis(job.projectPath, { forceRefresh: true });
          } else if (analysis === 'complexity') {
            await this.getComplexityHotspots(job.projectPath, { forceRefresh: true });
          } else if (analysis === 'dataflow' && job.filePath) {
            await this.getDataflowAnalysis(job.filePath, { forceRefresh: true });
          }
        } catch (error) {
          logger.error(`[Analytics] Job ${job.id} failed for ${analysis}:`, error);
        }
      }
    });
  }

  /**
   * Ensure parser is initialized
   */
  private async ensureParser(): Promise<void> {
    if (!this.parserInitialized) {
      await initParser();
      this.parserInitialized = true;
    }
  }

  /**
   * Run full analysis suite
   */
  async runFullAnalysis(projectPath: string): Promise<AnalyticsSummary> {
    logger.info(`[Analytics] Starting full analysis for ${projectPath}`);
    const startTime = Date.now();

    const [security, complexity] = await Promise.all([
      this.getSecurityAnalysis(projectPath, { forceRefresh: true }),
      this.getComplexityHotspots(projectPath, { forceRefresh: true }),
    ]);

    this.lastFullScan = new Date();
    const duration = Date.now() - startTime;
    logger.info(`[Analytics] Full analysis completed in ${duration}ms`);

    const summary: AnalyticsSummary = {
      projectPath,
      security: {
        total: security.summary.total,
        critical: security.summary.critical,
        high: security.summary.high,
        medium: security.summary.medium,
        low: security.summary.low,
      },
      complexity: {
        hotspots: complexity.hotspots.length,
        avgComplexity: complexity.avgComplexity,
        maxComplexity: complexity.maxComplexity,
      },
      refactoring: {
        filesAnalyzed: 0, // Would need to run refactoring analysis
        extractionCandidates: 0,
      },
      dataflow: {
        vulnerabilities: 0, // Would need to run dataflow analysis
        sources: 0,
        sinks: 0,
      },
      lastFullScan: this.lastFullScan.toISOString(),
      cachedAt: new Date().toISOString(),
    };

    // Cache the summary
    const cache = getAnalyticsCache();
    cache.set('summary', projectPath, summary);

    return summary;
  }

  /**
   * Get security analysis (with caching)
   */
  async getSecurityAnalysis(
    projectPath: string,
    options: { forceRefresh?: boolean; severity?: string } = {}
  ): Promise<SecurityResult> {
    const cache = getAnalyticsCache();

    if (!options.forceRefresh) {
      const cached = cache.get<SecurityResult>('security', projectPath);
      if (cached) {
        logger.debug('[Analytics] Security cache hit');
        return cached;
      }
    }

    await this.ensureParser();
    logger.info(`[Analytics] Running security scan on ${projectPath}`);

    // Find all TypeScript files
    const files = await glob('**/*.{ts,tsx}', {
      cwd: projectPath,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
      ],
    });

    const allFindings: SecurityFinding[] = [];
    let filesScanned = 0;

    for (const filePath of files.slice(0, 200)) {
      try {
        const tree = await parseFile(filePath);
        const findings = scanForVulnerabilities(tree.rootNode, {
          filePath,
          includeLowSeverity: true,
        });
        allFindings.push(...findings);
        filesScanned++;
      } catch {
        // Skip files that fail to parse
      }
    }

    const sorted = sortBySeverity(allFindings);
    const result: SecurityResult = {
      findings: sorted,
      summary: {
        critical: sorted.filter(f => f.severity === 'critical').length,
        high: sorted.filter(f => f.severity === 'high').length,
        medium: sorted.filter(f => f.severity === 'medium').length,
        low: sorted.filter(f => f.severity === 'low').length,
        total: sorted.length,
      },
      filesScanned,
      cachedAt: new Date().toISOString(),
    };

    cache.set('security', projectPath, result);
    return result;
  }

  /**
   * Get complexity hotspots from graph
   */
  async getComplexityHotspots(
    projectPath: string,
    options: { forceRefresh?: boolean; minComplexity?: number } = {}
  ): Promise<ComplexityResult> {
    const cache = getAnalyticsCache();

    if (!options.forceRefresh) {
      const cached = cache.get<ComplexityResult>('complexity', projectPath);
      if (cached) {
        logger.debug('[Analytics] Complexity cache hit');
        return cached;
      }
    }

    const minComplexity = options.minComplexity ?? 5;
    const client = await getClient();

    const query = `
      MATCH (f:Function)
      WHERE f.complexity IS NOT NULL AND f.complexity > $minComplexity
      RETURN f.name as name, f.filePath as filePath, f.complexity as complexity,
             f.cognitiveComplexity as cognitive, f.nestingDepth as nesting,
             f.endLine - f.startLine as lines
      ORDER BY f.complexity DESC
      LIMIT 50
    `;

    const queryResult = await client.roQuery<ComplexityHotspot>(query, {
      params: { minComplexity }
    });

    const hotspots = queryResult.data;
    const complexities = hotspots.map(h => h.complexity);

    const result: ComplexityResult = {
      hotspots,
      avgComplexity: complexities.length > 0
        ? complexities.reduce((a, b) => a + b, 0) / complexities.length
        : 0,
      maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
      cachedAt: new Date().toISOString(),
    };

    cache.set('complexity', projectPath, result);
    return result;
  }

  /**
   * Get refactoring analysis for a file
   */
  async getRefactoringAnalysis(
    filePath: string,
    options: { forceRefresh?: boolean; threshold?: number } = {}
  ): Promise<RefactoringResult> {
    const cache = getAnalyticsCache();

    if (!options.forceRefresh) {
      const cached = cache.get<RefactoringResult>('refactoring', filePath, filePath);
      if (cached) {
        logger.debug('[Analytics] Refactoring cache hit');
        return cached;
      }
    }

    const client = await getClient();
    const threshold = options.threshold ?? 3;

    // Get functions and their coupling data
    const functionsQuery = `
      MATCH (fn:Function {filePath: $path})
      OPTIONAL MATCH (fn)-[c:CALLS]->(:Function {filePath: $path})
      WITH fn, count(c) as internalCalls
      RETURN fn.name as name, fn.startLine as startLine, fn.endLine as endLine, 
             internalCalls as calls
      ORDER BY internalCalls DESC
    `;

    const callsQuery = `
      MATCH (caller:Function {filePath: $path})-[:CALLS]->(callee:Function {filePath: $path})
      RETURN caller.name as caller, callee.name as callee
    `;

    const [functionsResult, callsResult] = await Promise.all([
      client.roQuery<{ name: string; startLine: number; endLine: number; calls: number }>(
        functionsQuery, { params: { path: filePath } }
      ),
      client.roQuery<{ caller: string; callee: string }>(
        callsQuery, { params: { path: filePath } }
      ),
    ]);

    const input: RefactoringAnalysisInput = {
      file: filePath,
      functions: functionsResult.data.map(f => ({
        name: f.name,
        startLine: f.startLine,
        endLine: f.endLine,
        internalCalls: f.calls,
        stateReads: 0,
      })),
      callRelationships: callsResult.data.map(c => ({
        caller: c.caller,
        callee: c.callee,
      })),
    };

    const analysis = analyzeRefactoring(input, { extractionThreshold: threshold });

    const result: RefactoringResult = {
      file: filePath,
      totalFunctions: analysis.totalFunctions,
      extractionCandidates: analysis.extractionCandidates.map(c => ({
        name: c.name,
        couplingScore: c.couplingScore,
        internalCalls: c.internalCalls,
      })),
      couplingLevel: analysis.couplingLevel,
      avgCouplingScore: analysis.averageCouplingScore,
      cachedAt: new Date().toISOString(),
    };

    cache.set('refactoring', filePath, result, filePath);
    return result;
  }

  /**
   * Get dataflow analysis for a file
   */
  async getDataflowAnalysis(
    filePath: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<DataflowResult> {
    const cache = getAnalyticsCache();

    if (!options.forceRefresh) {
      const cached = cache.get<DataflowResult>('dataflow', filePath, filePath);
      if (cached) {
        logger.debug('[Analytics] Dataflow cache hit');
        return cached;
      }
    }

    await this.ensureParser();

    const tree = await parseFile(filePath);
    const analysis = analyzeDataflow(tree.rootNode, filePath, { maxDepth: 10 });

    const result: DataflowResult = {
      file: filePath,
      sources: analysis.sources.length,
      sinks: analysis.sinks.length,
      vulnerabilities: analysis.vulnerabilities.map(v => ({
        source: v.source.pattern,
        sink: v.sink.pattern,
        severity: v.severity,
        category: v.category,
      })),
      cachedAt: new Date().toISOString(),
    };

    cache.set('dataflow', filePath, result, filePath);
    return result;
  }

  /**
   * Get impact analysis for a symbol
   */
  async getImpactAnalysis(
    symbol: string,
    options: { forceRefresh?: boolean; depth?: number } = {}
  ): Promise<ImpactResult> {
    const cache = getAnalyticsCache();

    if (!options.forceRefresh) {
      const cached = cache.get<ImpactResult>('impact', symbol, symbol);
      if (cached) {
        logger.debug('[Analytics] Impact cache hit');
        return cached;
      }
    }

    const client = await getClient();
    const depth = options.depth ?? 5;

    // Get direct callers
    const directQuery = `
      MATCH (caller:Function)-[:CALLS]->(fn:Function {name: $name})
      RETURN count(DISTINCT caller) as count
    `;

    // Get transitive callers (simplified)
    const transitiveQuery = `
      MATCH (caller:Function)-[:CALLS*1..${depth}]->(fn:Function {name: $name})
      RETURN count(DISTINCT caller) as count
    `;

    const [directResult, transitiveResult] = await Promise.all([
      client.roQuery<{ count: number }>(directQuery, { params: { name: symbol } }),
      client.roQuery<{ count: number }>(transitiveQuery, { params: { name: symbol } }),
    ]);

    const directCallers = directResult.data[0]?.count ?? 0;
    const transitiveCallers = transitiveResult.data[0]?.count ?? 0;

    // Calculate risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (transitiveCallers > 20) riskLevel = 'critical';
    else if (transitiveCallers > 10) riskLevel = 'high';
    else if (transitiveCallers > 5) riskLevel = 'medium';
    else riskLevel = 'low';

    const result: ImpactResult = {
      symbol,
      directCallers,
      transitiveCallers,
      affectedFiles: 0, // Would need additional query
      riskLevel,
      cachedAt: new Date().toISOString(),
    };

    cache.set('impact', symbol, result, symbol);
    return result;
  }

  /**
   * Get analytics summary
   */
  async getSummary(projectPath: string): Promise<AnalyticsSummary> {
    const cache = getAnalyticsCache();
    const cached = cache.get<AnalyticsSummary>('summary', projectPath);

    if (cached) {
      return cached;
    }

    // Generate fresh summary
    return this.runFullAnalysis(projectPath);
  }

  /**
   * Invalidate cache
   */
  invalidateCache(projectPath?: string): void {
    const cache = getAnalyticsCache();
    if (projectPath) {
      cache.invalidate(projectPath);
    } else {
      cache.invalidateAll();
    }
  }

  /**
   * Trigger post-ingestion analysis
   */
  async onIngestionComplete(projectPath: string): Promise<void> {
    const scheduler = getAnalyticsScheduler();
    await scheduler.onIngestionComplete(projectPath);
  }

  /**
   * Trigger file change analysis
   */
  onFileChange(projectPath: string, filePath: string): void {
    const scheduler = getAnalyticsScheduler();
    scheduler.queueFileChange(projectPath, filePath);
  }
}

// Singleton instance
let serviceInstance: AnalyticsService | null = null;

/**
 * Get or create the analytics service singleton
 */
export function getAnalyticsService(): AnalyticsService {
  if (!serviceInstance) {
    serviceInstance = new AnalyticsService();
  }
  return serviceInstance;
}
