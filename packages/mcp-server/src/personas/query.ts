/**
 * Query Persona — Raw Cypher escape hatch with guardrails
 *
 * Consolidates: query_graph
 */

import type { ToolDefinition } from '../tools/router';
import { queryGraph, type QueryGraphInput } from '../tools/queryGraph';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Query' });

const MAX_CYPHER_LENGTH = 10_000;

export const queryPersonaDefinition: ToolDefinition = {
  name: 'query',
  description: `Execute raw read-only Cypher queries against the code graph. Power-user escape hatch.

Use search and analyze for most tasks. This tool is for custom graph queries when the other tools don't cover your needs.

**Guardrails:**
- Read-only enforcement at driver level (roQuery)
- Max query size: 10KB
- Results capped at returned data

**Schema reference:**
Node labels: File, Function, Class, Interface, Variable, Type, Component, Entity
Edge types: CONTAINS, IMPORTS, IMPORTS_SYMBOL, CALLS, EXTENDS, IMPLEMENTS, USES_TYPE, RETURNS, HAS_PARAM, HAS_METHOD, HAS_PROPERTY, RENDERS, INTRODUCED_IN, MODIFIED_IN, DELETED_IN, EXPORTS, PARENT_SECTION, ABOUT
SAID is not a separate edge label: it's a RELATES_TO edge with a \`type\` property set to "SAID" (deliberate design, same as every other relationship kind RELATES_TO carries via its \`type\` property).

**Examples:**
- All functions in a file: { cypher: "MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(fn:Function) RETURN fn.name", params: { filePath: "/src/service.ts" } }
- Call chain: { cypher: "MATCH (a:Function)-[:CALLS*1..3]->(b:Function) WHERE a.name = $name RETURN DISTINCT b.name", params: { name: "parseProject" } }`,
  inputSchema: {
    type: 'object',
    properties: {
      cypher: {
        type: 'string',
        description: 'Read-only Cypher query to execute (required)',
      },
      params: {
        type: 'object',
        description: 'Query parameters (recommended for safety)',
      },
    },
    required: ['cypher'],
  },
};

export async function handleQuery(args: Record<string, unknown>): Promise<unknown> {
  const cypher = args.cypher as string;
  const start = Date.now();

  if (!cypher) {
    return { error: 'cypher is required' };
  }

  // Guardrail: query size limit
  if (cypher.length > MAX_CYPHER_LENGTH) {
    return { error: `Query too large (${cypher.length} chars). Max: ${MAX_CYPHER_LENGTH}` };
  }

  const input: QueryGraphInput = { cypher };
  if (args.params) input.params = args.params as Record<string, unknown>;

  const result = await queryGraph(input);

  const durationMs = Date.now() - start;
  logger.debug('Query persona completed', { durationMs, cypherLength: cypher.length });

  return {
    ...(result as object),
    _meta: { toolUsed: 'query_graph', durationMs },
  };
}
