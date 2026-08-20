import { Hono } from 'hono';
import { getGraphClient, unifiedSearch, cotSearch } from '@codegraph/core';
import { safeErrorMessage } from '../safe-error';

export const naturalRoutes = new Hono();

/** POST /api/query/natural — natural language query routed to best search strategy */
naturalRoutes.post('/api/query/natural', async (c) => {
  try {
    const body = await c.req.json();
    const question = body.question as string;
    if (!question) return c.json({ error: 'question field is required' }, 400);

    const useCot = body.mode === 'cot' || question.includes('why') || question.includes('how') || question.length > 80;
    const client = await getGraphClient();

    if (useCot) {
      // Complex question → Chain-of-Thought iterative search
      const result = await cotSearch(question, client, {
        searchScope: 'all',
        limit: 10,
      });

      return c.json({
        question,
        routedTo: 'chain-of-thought',
        results: result.results.map(r => ({
          name: r.name,
          type: r.type,
          source: r.source,
          score: r.score,
          filePath: r.filePath,
        })),
        iterations: result.iterations,
        queries: result.queries,
        total: result.results.length,
        durationMs: result.durationMs,
      });
    }

    // Simple question → unified search (code + knowledge)
    const result = await unifiedSearch(question, client, {
      searchScope: 'all',
      limit: 15,
    });

    return c.json({
      question,
      routedTo: 'unified-search',
      results: result.results.map(r => ({
        name: r.name,
        type: r.type,
        source: r.source,
        score: r.score,
        filePath: r.filePath,
      })),
      total: result.results.length,
      durationMs: result.meta.durationMs,
    });
  } catch (error) {
    return c.json({ error: safeErrorMessage('POST /api/query/natural', error, 'Natural language query failed.') }, 500);
  }
});
