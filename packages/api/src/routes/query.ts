/**
 * Query routes - /api/query/*
 * @module routes/query
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';
import {
  codeGraphService,
  getGraphClient,
  createDefaultSearchRegistry,
} from '@codegraph/core';
import type { SearchResponse } from '@codegraph/core';
import { getLLMModel, getLLMComplexModel, isLLMAvailable } from '@codegraph/plugin-nlp';
import { createLogger, toErrorMessage } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Query' });

const query = new Hono();

// Lazily initialized search registry (singleton)
let _registry: ReturnType<typeof createDefaultSearchRegistry> | null = null;
function getRegistry() {
  if (!_registry) {
    _registry = createDefaultSearchRegistry();
  }
  return _registry;
}

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
 * Execute a read-only Cypher query.
 * Safety: uses roQuery() at the driver level (read-only transaction).
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
    logger.info('Raw Cypher query executed', { query: cypherQuery, paramKeys: Object.keys(params) });
    const result = await codeGraphService.executeReadQuery(cypherQuery, params);
    return c.json(result);
  }
);

/**
 * POST /api/query/natural
 * Convert natural language question to Cypher and execute
 *
 * Uses the NLToCypherStrategy from @codegraph/core which:
 * 1. Sends the question + graph schema to the configured LLM
 * 2. Generates a read-only Cypher query
 * 3. Validates the query is safe (no writes)
 * 4. Executes against FalkorDB
 * 5. Returns the Cypher, results, and explanation
 *
 * @body question - Natural language question
 * @body stream - Enable SSE streaming (not yet implemented)
 * @returns Generated Cypher, results, and explanation
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

    if (stream) {
      return c.json({
        error: 'Streaming not yet implemented',
        suggestion: 'Use non-streaming mode (stream: false)',
      }, 501);
    }

    // Check LLM availability
    if (!isLLMAvailable()) {
      return c.json({
        question,
        cypher: null,
        results: [],
        explanation: 'LLM is not configured. Set OPENROUTER_API_KEY in your environment (or LLM_PROVIDER=ollama for local inference).',
        error: 'LLM_NOT_CONFIGURED',
      }, 503);
    }

    try {
      const registry = getRegistry();
      const client = await getGraphClient();
      const llm = await getLLMModel();
      const complexLlm = await getLLMComplexModel();

      const response: SearchResponse = await registry.search(
        { query: question, type: 'SMART_SEARCH', limit: 50 },
        { client, llm, ...(complexLlm ? { complexLlm } : {}) },
      );

      // Map SearchResponse to the endpoint's shape.
      // SMART_SEARCH routes to the best strategy:
      //   - GRAPH_ANSWER for "how/what/why" questions → returns `answer`
      //   - NL_TO_CYPHER for structural queries → returns `cypher`
      //   - HYBRID for simple lookups → returns results
      return c.json({
        question,
        cypher: response.cypher ?? null,
        results: response.results.map((r) => ({
          name: r.name,
          nodeType: r.nodeType,
          filePath: r.filePath,
          startLine: r.startLine,
          score: r.score,
          properties: r.properties,
        })),
        explanation: response.cypherExplanation ?? response.error ?? null,
        // Synthesized answer (from GRAPH_ANSWER / CONTEXT_WALK)
        answer: response.answer ?? null,
        answerConfidence: response.answerConfidence ?? null,
        answerSources: response.answerSources ?? null,
        // Routing metadata
        routedTo: response.routedTo ?? null,
        routingReason: response.routingReason ?? null,
        total: response.total,
        durationMs: response.meta.durationMs,
      });
    } catch (error) {
      const msg = toErrorMessage(error);
      logger.error('Natural language query failed', error);
      return c.json({
        question,
        cypher: null,
        results: [],
        explanation: `Query failed: ${msg}`,
        error: msg,
      }, 500);
    }
  }
);

export { query };
