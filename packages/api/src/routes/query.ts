/**
 * Query routes - /api/query/*
 * Endpoints for Cypher and natural language queries
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createClient } from '@codegraph/graph';
import { HttpError } from '../middleware/errorHandler';

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
    const { query: cypherQuery, params } = c.req.valid('json');

    const client = await createClient();
    const result = await client.roQuery(cypherQuery, {
      params: params as Record<string, string | number | boolean | null | unknown[]>
    });

    return c.json({
      results: result.data ?? [],
      metadata: result.metadata ?? null,
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
    const { question, stream } = c.req.valid('json');

    // Natural language query conversion requires AI SDK setup
    // For now, return guidance on using Cypher directly

    if (stream) {
      // SSE streaming would require AI SDK streamText
      return c.json({
        error: 'Streaming not yet implemented - requires AI SDK integration',
        suggestion: 'Use POST /api/query/cypher with a manual Cypher query',
      }, 501);
    }

    return c.json({
      question,
      cypher: null,
      results: [],
      explanation: 'Natural language → Cypher conversion requires AI SDK setup. Use POST /api/query/cypher with manual Cypher queries for now.',
      exampleCypher: "MATCH (f:Function) WHERE f.name CONTAINS 'search' RETURN f.name, f.filePath LIMIT 10",
    });
  }
);

export { query };
