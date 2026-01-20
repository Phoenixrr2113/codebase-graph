/**
 * Query routes - /api/query/*
 * @module routes/query
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';
import * as queryModel from '../model/queryModel';

const query = new Hono();

/**
 * Request schema for Cypher query
 */
const cypherQuerySchema = z.object({
  query: z.string().min(1, 'Query is required'),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

/**
 * Request schema for natural language query
 */
const naturalQuerySchema = z.object({
  question: z.string().min(1, 'Question is required'),
  stream: z.boolean().optional().default(false),
});

/**
 * POST /api/query/cypher
 * Execute a raw Cypher query
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
    const result = await queryModel.executeCypher(cypherQuery, params);
    return c.json(result);
  }
);

/**
 * POST /api/query/natural
 * Convert natural language question to Cypher and execute
 * 
 * @body question - Natural language question
 * @body stream - Enable SSE streaming (not yet implemented)
 * @returns Generated Cypher, results, and explanation
 * @note This endpoint requires AI SDK integration (not yet implemented)
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
