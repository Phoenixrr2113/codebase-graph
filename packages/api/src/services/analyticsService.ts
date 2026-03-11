/**
 * Analytics Service
 *
 * Caching and scheduling wrapper around core analytics.
 * All business logic is delegated to codeGraphService;
 * this service adds caching, scheduling, and API-specific result formatting.
 *
 * @module services/analyticsService
 */

import { codeGraphService } from '@codegraph/core';
import { getAnalyticsCache } from './analyticsCache';
import { getAnalyticsScheduler } from './analyticsScheduler';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Analytics' });

// ============================================================================
// Types (API-specific shapes with caching metadata)
// ============================================================================

export interface SecurityResult {
  findings: Array<{
    type: string;
    severity: string;
    message: string;
    filePath: string;
    line: number;
    column: number;
    code: string;
    recommendation: string;
  }>;
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
        filesAnalyzed: 0,
        extractionCandidates: 0,
      },
      dataflow: {
        vulnerabilities: 0,
        sources: 0,
        sinks: 0,
      },
      lastFullScan: this.lastFullScan.toISOString(),
      cachedAt: new Date().toISOString(),
    };

    const cache = getAnalyticsCache();
    cache.set('summary', projectPath, summary);

    return summary;
  }

  /**
   * Get security analysis (with caching).
   * Delegates to codeGraphService.scanVulnerabilities().
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

    logger.info(`[Analytics] Running security scan on ${projectPath}`);

    const scanResult = await codeGraphService.scanVulnerabilities({ path: projectPath });

    const findings = scanResult.vulnerabilities;
    const result: SecurityResult = {
      findings,
      summary: {
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length,
        total: findings.length,
      },
      filesScanned: scanResult.filesScanned,
      cachedAt: new Date().toISOString(),
    };

    cache.set('security', projectPath, result);
    return result;
  }

  /**
   * Get complexity hotspots (with caching).
   * Delegates to codeGraphService.getComplexityHotspots().
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
    const serviceResult = await codeGraphService.getComplexityHotspots({
      threshold: minComplexity,
    });

    const result: ComplexityResult = {
      hotspots: serviceResult.hotspots.map(h => ({
        name: h.name,
        filePath: h.file,
        complexity: h.complexity,
        cognitive: h.cognitive,
        nesting: h.nesting,
        lines: h.lines,
      })),
      avgComplexity: serviceResult.summary.avgComplexity,
      maxComplexity: serviceResult.summary.maxComplexity,
      cachedAt: new Date().toISOString(),
    };

    cache.set('complexity', projectPath, result);
    return result;
  }

  /**
   * Get refactoring analysis for a file (with caching).
   * Delegates to codeGraphService.analyzeRefactoring().
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

    const refactorOpts: Parameters<typeof codeGraphService.analyzeRefactoring>[1] = {};
    if (options.threshold !== undefined) refactorOpts.threshold = options.threshold;
    const serviceResult = await codeGraphService.analyzeRefactoring(filePath, refactorOpts);

    const result: RefactoringResult = {
      file: serviceResult.file,
      totalFunctions: serviceResult.totalFunctions,
      extractionCandidates: serviceResult.extractionCandidates.map(c => ({
        name: c.name,
        couplingScore: c.couplingScore,
        internalCalls: c.internalCalls,
      })),
      couplingLevel: serviceResult.couplingLevel,
      avgCouplingScore: serviceResult.averageCouplingScore,
      cachedAt: new Date().toISOString(),
    };

    cache.set('refactoring', filePath, result, filePath);
    return result;
  }

  /**
   * Get dataflow analysis for a file (with caching).
   * Delegates to codeGraphService.analyzeDataflowForFile().
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

    const serviceResult = await codeGraphService.analyzeDataflowForFile(filePath);

    const result: DataflowResult = {
      file: filePath,
      sources: serviceResult.sources.length,
      sinks: serviceResult.sinks.length,
      vulnerabilities: serviceResult.vulnerabilities,
      cachedAt: new Date().toISOString(),
    };

    cache.set('dataflow', filePath, result, filePath);
    return result;
  }

  /**
   * Get impact analysis for a symbol (with caching).
   * Delegates to codeGraphService.analyzeImpact().
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

    const impactOpts: Parameters<typeof codeGraphService.analyzeImpact>[1] = {};
    if (options.depth !== undefined) impactOpts.depth = options.depth;
    const serviceResult = await codeGraphService.analyzeImpact(symbol, impactOpts);

    const result: ImpactResult = {
      symbol,
      directCallers: serviceResult.directCallers.length,
      transitiveCallers: serviceResult.transitiveCallers.length,
      affectedFiles: serviceResult.affectedFiles.length,
      riskLevel: serviceResult.riskLevel,
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
