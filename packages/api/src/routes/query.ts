/**
 * Query routes - /api/query/*
 * Endpoints for Cypher and natural language queries
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler.js';

const query = new Hono();

/** Schema for Cypher query request */
const cypherQuerySchema = z.object({
  query: z.string().min(1, 'Query is required'),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Schema for natural language query request */
const naturalQuerySchema = z.object({
  question: z.string().min(1, 'Question is required'),
  stream: z.boolean().optional().default(false),
});

/**
 * POST /api/query/cypher
 * Execute raw Cypher query
 */
query.post(
  '/cypher',
  zValidator('json', cypherQuerySchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const body = c.req.valid('json');
    void body; // Will be used when graph client is available

    // TODO: Execute Cypher query when graph package exports are updated
    // const client = await createClient();
    // const result = await client.roQuery(body.query, { params: body.params });

    return c.json({
      results: [],
      message: 'Graph client not yet available - waiting for graph package exports',
    });
  }
);

/**
 * POST /api/query/natural
 * Natural language query (converts to Cypher)
 */
query.post(
  '/natural',
  zValidator('json', naturalQuerySchema, (result) => {
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.issues);
    }
  }),
  async (c) => {
    const { stream } = c.req.valid('json');

    // TODO: Implement NL → Cypher conversion using Vercel AI SDK (API-004)
    // This requires AI SDK dependencies and nlQueryService implementation

    if (stream) {
      // TODO: Return SSE stream for streaming responses
      return c.json({
        error: 'Streaming not yet implemented - API-004 pending',
      }, 501);
    }

    return c.json({
      cypher: null,
      results: [],
      explanation: 'Natural language queries not yet implemented - API-004 pending',
    });
  }
);

export { query };
