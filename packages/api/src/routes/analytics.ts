/**
 * Analytics API Routes
 * 
 * REST API endpoints for analytics data.
 * 
 * @module routes/analytics
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAnalyticsService } from '../services/analyticsService';
import { getAnalyticsCache } from '../services/analyticsCache';
import { getAnalyticsScheduler } from '../services/analyticsScheduler';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Analytics' });

const analytics = new Hono();

// ============================================================================
// Request Schemas
// ============================================================================

const pathQuerySchema = z.object({
  path: z.string().optional(),
});

const securityQuerySchema = z.object({
  path: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'all']).default('all'),
  refresh: z.string().optional(),
});

const complexityQuerySchema = z.object({
  path: z.string().optional(),
  minComplexity: z.coerce.number().default(5),
  refresh: z.string().optional(),
});

const refactoringQuerySchema = z.object({
  file: z.string(),
  threshold: z.coerce.number().default(3),
  refresh: z.string().optional(),
});

const dataflowQuerySchema = z.object({
  file: z.string(),
  refresh: z.string().optional(),
});

const scanBodySchema = z.object({
  path: z.string(),
  analyses: z.array(z.enum(['security', 'complexity', 'dataflow', 'refactoring', 'full'])).default(['full']),
});

const scheduleConfigSchema = z.object({
  onIngestion: z.object({
    enabled: z.boolean().optional(),
    analyses: z.array(z.string()).optional(),
  }).optional(),
  onFileChange: z.object({
    enabled: z.boolean().optional(),
    debounceMs: z.number().optional(),
    analyses: z.array(z.string()).optional(),
  }).optional(),
  periodic: z.array(z.object({
    name: z.string(),
    cron: z.string(),
    analyses: z.array(z.string()),
    enabled: z.boolean(),
  })).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/analytics/summary
 * Get combined analytics summary for a project
 */
analytics.get('/summary', zValidator('query', pathQuerySchema), async (c) => {
  try {
    const { path: projectPath } = c.req.valid('query');
    const effectivePath = projectPath || process.cwd();
    
    const service = getAnalyticsService();
    const summary = await service.getSummary(effectivePath);
    
    return c.json({ success: true, data: summary });
  } catch (error) {
    logger.error('[Analytics API] Summary error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/security
 * Get security analysis results
 */
analytics.get('/security', zValidator('query', securityQuerySchema), async (c) => {
  try {
    const { path: projectPath, severity, refresh } = c.req.valid('query');
    const effectivePath = projectPath || process.cwd();
    
    const service = getAnalyticsService();
    const result = await service.getSecurityAnalysis(effectivePath, {
      forceRefresh: refresh === 'true',
      severity,
    });
    
    // Filter by severity if specified
    let findings = result.findings;
    if (severity !== 'all') {
      findings = findings.filter(f => f.severity === severity);
    }
    
    return c.json({
      success: true,
      data: {
        ...result,
        findings,
      },
    });
  } catch (error) {
    logger.error('[Analytics API] Security error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * POST /api/analytics/security/scan
 * Trigger a new security scan
 */
analytics.post('/security/scan', zValidator('json', scanBodySchema), async (c) => {
  try {
    const { path: projectPath, analyses } = c.req.valid('json');
    
    const service = getAnalyticsService();
    
    if (analyses.includes('full') || analyses.includes('security')) {
      const result = await service.getSecurityAnalysis(projectPath, { forceRefresh: true });
      return c.json({ success: true, data: result });
    }
    
    return c.json({ success: true, message: 'No security analysis requested' });
  } catch (error) {
    logger.error('[Analytics API] Scan error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/complexity
 * Get complexity hotspots
 */
analytics.get('/complexity', zValidator('query', complexityQuerySchema), async (c) => {
  try {
    const { path: projectPath, minComplexity, refresh } = c.req.valid('query');
    const effectivePath = projectPath || process.cwd();
    
    const service = getAnalyticsService();
    const result = await service.getComplexityHotspots(effectivePath, {
      forceRefresh: refresh === 'true',
      minComplexity,
    });
    
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('[Analytics API] Complexity error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/refactoring
 * Get refactoring analysis for a file
 */
analytics.get('/refactoring', zValidator('query', refactoringQuerySchema), async (c) => {
  try {
    const { file, threshold, refresh } = c.req.valid('query');
    
    const service = getAnalyticsService();
    const result = await service.getRefactoringAnalysis(file, {
      forceRefresh: refresh === 'true',
      threshold,
    });
    
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('[Analytics API] Refactoring error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/dataflow
 * Get dataflow analysis for a file
 */
analytics.get('/dataflow', zValidator('query', dataflowQuerySchema), async (c) => {
  try {
    const { file, refresh } = c.req.valid('query');
    
    const service = getAnalyticsService();
    const result = await service.getDataflowAnalysis(file, {
      forceRefresh: refresh === 'true',
    });
    
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('[Analytics API] Dataflow error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/impact/:symbol
 * Get impact analysis for a symbol
 */
analytics.get('/impact/:symbol', zValidator('query', z.object({
  depth: z.coerce.number().default(5),
  refresh: z.string().optional(),
})), async (c) => {
  try {
    const symbol = c.req.param('symbol');
    const { depth, refresh } = c.req.valid('query');
    
    const service = getAnalyticsService();
    const result = await service.getImpactAnalysis(symbol, {
      forceRefresh: refresh === 'true',
      depth,
    });
    
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('[Analytics API] Impact error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/cache
 * Get cache statistics
 */
analytics.get('/cache', async (c) => {
  try {
    const cache = getAnalyticsCache();
    const stats = cache.getStats();
    
    return c.json({ success: true, data: stats });
  } catch (error) {
    logger.error('[Analytics API] Cache stats error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * DELETE /api/analytics/cache
 * Clear analytics cache
 */
analytics.delete('/cache', zValidator('query', pathQuerySchema), async (c) => {
  try {
    const { path: projectPath } = c.req.valid('query');
    
    const service = getAnalyticsService();
    service.invalidateCache(projectPath);
    
    return c.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    logger.error('[Analytics API] Cache clear error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * GET /api/analytics/schedule
 * Get scheduler configuration
 */
analytics.get('/schedule', async (c) => {
  try {
    const scheduler = getAnalyticsScheduler();
    const config = scheduler.getConfig();
    const recentJobs = scheduler.getRecentJobs(10);
    
    return c.json({ 
      success: true, 
      data: { 
        config, 
        recentJobs: recentJobs.map(j => ({
          id: j.id,
          analyses: j.analyses,
          trigger: j.trigger,
          status: j.status,
          createdAt: j.createdAt.toISOString(),
        })),
      } 
    });
  } catch (error) {
    logger.error('[Analytics API] Schedule error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * PUT /api/analytics/schedule
 * Update scheduler configuration
 */
analytics.put('/schedule', zValidator('json', scheduleConfigSchema), async (c) => {
  try {
    const config = c.req.valid('json');
    
    const scheduler = getAnalyticsScheduler();
    scheduler.updateConfig(config as any);
    
    return c.json({ 
      success: true, 
      message: 'Schedule configuration updated',
      data: scheduler.getConfig(),
    });
  } catch (error) {
    logger.error('[Analytics API] Schedule update error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

/**
 * POST /api/analytics/run
 * Trigger a full analysis run
 */
analytics.post('/run', zValidator('json', scanBodySchema), async (c) => {
  try {
    const { path: projectPath, analyses } = c.req.valid('json');
    
    const service = getAnalyticsService();
    
    if (analyses.includes('full')) {
      const result = await service.runFullAnalysis(projectPath);
      return c.json({ success: true, data: result });
    }
    
    // Run specific analyses
    const results: Record<string, unknown> = {};
    
    for (const analysis of analyses) {
      if (analysis === 'security') {
        results.security = await service.getSecurityAnalysis(projectPath, { forceRefresh: true });
      } else if (analysis === 'complexity') {
        results.complexity = await service.getComplexityHotspots(projectPath, { forceRefresh: true });
      }
    }
    
    return c.json({ success: true, data: results });
  } catch (error) {
    logger.error('[Analytics API] Run error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

export default analytics;
