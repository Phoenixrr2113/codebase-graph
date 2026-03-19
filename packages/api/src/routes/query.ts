/**
 * Query routes - /api/query/*
 * @module routes/query
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';
import { codeGraphService } from '@codegraph/core';
import { createLogger, toErrorMessage } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Query' });

const query = new Hono();

// ============================================================================
// POST /api/query/cypher — Raw Cypher execution
// ============================================================================

const cypherSchema = z.object({
  query: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

query.post(
  '/cypher',
  zValidator('json', cypherSchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { query: cypherQuery, params } = c.req.valid('json');
    logger.info('Raw Cypher query executed', { query: cypherQuery, paramKeys: Object.keys(params) });
    const result = await codeGraphService.executeReadQuery(cypherQuery, params);
    return c.json(result);
  }
);

// ============================================================================
// POST /api/query/natural — Search via enrichedSearchV2
// ============================================================================

const naturalQuerySchema = z.object({
  question: z.string().min(1),
  limit: z.number().optional().default(20),
  scope: z.string().optional(),
});

query.post(
  '/natural',
  zValidator('json', naturalQuerySchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { question, limit, scope } = c.req.valid('json');

    try {
      const result = await codeGraphService.search(question, {
        limit,
        ...(scope ? { scope } : {}),
      });

      return c.json({
        question,
        results: result.hits.map((h) => ({
          name: h.name,
          nodeType: h.nodeType,
          filePath: h.filePath,
          startLine: h.startLine,
          score: h.score,
          properties: h.properties,
        })),
        total: result.hits.length,
        durationMs: result.meta.durationMs,
      });
    } catch (error) {
      const msg = toErrorMessage(error);
      logger.error('Search failed', error);
      return c.json({
        question,
        results: [],
        error: msg,
      }, 500);
    }
  }
);

export { query };
