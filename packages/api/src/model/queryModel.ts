/**
 * Query model - Execute Cypher queries
 * @module model/queryModel
 */

import { getClient } from './graphClient';

/**
 * Result of a Cypher query execution
 */
export interface CypherResult {
  results: unknown[];
  metadata: unknown;
}

/**
 * Execute a read-only Cypher query
 * @param cypherQuery - Valid Cypher query string
 * @param params - Query parameters
 * @returns Query results and metadata
 */
export async function executeCypher(
  cypherQuery: string,
  params: Record<string, unknown> = {}
): Promise<CypherResult> {
  const client = await getClient();
  const result = await client.roQuery(cypherQuery, {
    params: params as Record<string, string | number | boolean | null | unknown[]>
  });

  return {
    results: result.data ?? [],
    metadata: result.metadata ?? null,
  };
}
