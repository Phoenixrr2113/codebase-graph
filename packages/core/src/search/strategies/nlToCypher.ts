/**
 * NL_TO_CYPHER Search Strategy
 *
 * Translates natural language questions into Cypher queries, executes them
 * against FalkorDB, and returns the results.
 *
 * Example queries:
 * - "Show me all functions that call sendEmail"
 * - "Find classes that implement the Logger interface"
 * - "What files import the authentication module?"
 * - "List all entities of type Decision"
 */

import { generateObject, NoObjectGeneratedError } from 'ai';
import { createLogger } from '@codegraph/logger';
import { NLToCypherSchema, type NLToCypher } from '@codegraph/plugin-nlp';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
} from '../types';

const logger = createLogger({ namespace: 'core:search:nl-to-cypher' });

/** Schema description for the LLM */
const SCHEMA_DESCRIPTION = `
## FalkorDB Graph Schema

### Code Nodes (labels):
- File: { name, filePath, language, linesOfCode, embedding }
- Function: { name, filePath, startLine, endLine, signature, docstring, linesOfCode, embedding }
- Class: { name, filePath, startLine, endLine, docstring, linesOfCode, embedding }
- Interface: { name, filePath, startLine, endLine, docstring, embedding }
- Type: { name, filePath, startLine, endLine, embedding }
- Variable: { name, filePath, startLine, endLine, embedding }
- Component: { name, filePath, startLine, endLine, docstring, embedding }

### Knowledge Nodes:
- Entity: { text, type, confidence, sampleId, createdAt, lastAccessedAt, accessCount, embedding }

### Code Edges:
- CONTAINS: File → Function/Class/Interface/Type/Variable/Component
- CALLS: Function → Function
- IMPORTS: File → File
- EXTENDS: Class → Class, Interface → Interface
- IMPLEMENTS: Class → Interface

### Knowledge Edges:
- RELATES_TO: Entity → Entity { type, confidence, fact, valid_at, invalid_at, created_at, fact_embedding }

### Bridge Edges:
- ABOUT: Entity → Function/Class/Interface/File (links knowledge to code)

### Query Patterns:
- Vector search: CALL db.idx.vector.queryNodes('Label', 'embedding', k, vecf32($vec)) YIELD node, score
- Text search: MATCH (n:Label) WHERE n.name CONTAINS $query RETURN n
- Traversal: MATCH (n:Function)-[:CALLS]->(m:Function) WHERE n.name = $name RETURN m
`.trim();

export class NLToCypherStrategy implements SearchStrategy {
  readonly type = 'NL_TO_CYPHER' as const;
  readonly description = 'Translates natural language to Cypher, executes against the graph';
  readonly requiresLLM = true;

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    if (!context.llm) {
      throw new Error('NL_TO_CYPHER requires an LLM');
    }

    // Step 1: Translate NL to Cypher
    let cypherResult: NLToCypher;

    try {
      const { object } = (await generateObject({
        model: context.llm,
        schema: NLToCypherSchema,
        prompt: this.buildTranslationPrompt(request.query),
        temperature: 0.1,
      })) as { object: NLToCypher };

      cypherResult = object;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          results: [],
          total: 0,
          error: 'Failed to translate the query to Cypher',
          meta: { searchType: 'NL_TO_CYPHER', durationMs: 0 },
        };
      }
      throw error;
    }

    const { cypher, explanation, parameters: params } = cypherResult;

    logger.info(`Generated Cypher: ${cypher}`);
    logger.debug(`Explanation: ${explanation}`);

    // Step 2: Safety check — only allow read-only queries
    if (!this.isSafeQuery(cypher)) {
      return {
        results: [],
        total: 0,
        cypher,
        cypherExplanation: explanation,
        error: 'Generated query contains write operations. Only read queries are allowed.',
        meta: { searchType: 'NL_TO_CYPHER', durationMs: 0 },
      };
    }

    // Step 3: Execute the Cypher query
    try {
      const queryParams = (params ?? {}) as Record<string, string | number | boolean | null | Array<unknown>>;
      const queryResult = await context.client.roQuery<Record<string, unknown>>(
        cypher,
        { params: queryParams },
      );
      const results = this.processQueryResults(queryResult.data);

      return {
        results,
        cypher,
        cypherExplanation: explanation,
        total: results.length,
        meta: {
          searchType: 'NL_TO_CYPHER',
          durationMs: 0, // filled by registry
          generatedCypher: cypher,
          cypherParams: queryParams,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Cypher execution failed: ${msg}`);
      return {
        results: [],
        total: 0,
        cypher,
        cypherExplanation: explanation,
        error: `Cypher execution failed: ${msg}`,
        meta: { searchType: 'NL_TO_CYPHER', durationMs: 0 },
      };
    }
  }

  private buildTranslationPrompt(query: string): string {
    return `You are a Cypher query expert for FalkorDB (a Redis-based graph database).
Translate the user's natural language question into a valid Cypher query.

${SCHEMA_DESCRIPTION}

## Important Rules:
1. Only generate READ queries (MATCH, CALL, RETURN). Never use CREATE, SET, DELETE, MERGE.
2. Use parameterized queries with $param syntax where appropriate.
3. Always include a RETURN clause.
4. Limit results to 50 unless the user asks for more.
5. For text searches, use CONTAINS (case-sensitive) or toLower() for case-insensitive.
6. Return useful fields: name, filePath, startLine, type, etc.

## User Question:
"${query}"

Generate a Cypher query that answers this question.`;
  }

  /**
   * Safety check: only allow read-only Cypher queries.
   */
  private isSafeQuery(cypher: string): boolean {
    const upper = cypher.toUpperCase();
    const dangerousKeywords = [
      'CREATE', 'SET', 'DELETE', 'DETACH', 'MERGE', 'REMOVE', 'DROP',
      'FOREACH', 'LOAD CSV',
    ];
    for (const kw of dangerousKeywords) {
      // Check for keyword at word boundary (not inside a string or comment)
      const regex = new RegExp(`\\b${kw}\\b`);
      if (regex.test(upper)) {
        logger.warn(`Unsafe Cypher keyword detected: ${kw}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Process raw query results into SearchResultItems.
   */
  private processQueryResults(
    data: Record<string, unknown>[],
  ): SearchResultItem[] {
    if (!data || data.length === 0) {
      return [];
    }

    const results: SearchResultItem[] = [];

    for (const row of data) {
      const item = this.rowToResultItem(row);
      if (item) results.push(item);
    }

    return results.slice(0, 50);
  }

  private rowToResultItem(
    row: Record<string, unknown>,
  ): SearchResultItem | null {
    // Try to extract a name/node from the result
    const name =
      this.extractString(row, 'name') ??
      this.extractString(row, 'text') ??
      this.extractString(row, 'n.name') ??
      this.extractString(row, 'node.name') ??
      this.extractString(row, 'm.name') ??
      this.stringifyFirstValue(row);

    if (!name) return null;

    const item: SearchResultItem = {
      name,
      nodeType: this.extractString(row, 'nodeType') ??
        this.extractString(row, 'type') ??
        this.extractString(row, 'labels') ??
        'Unknown',
      score: 1.0,
      sources: ['cypher'],
      properties: row,
    };

    const filePath = this.extractString(row, 'filePath') ??
      this.extractString(row, 'n.filePath') ??
      this.extractString(row, 'node.filePath');
    if (filePath) item.filePath = filePath;

    const startLine = this.extractNumber(row, 'startLine') ??
      this.extractNumber(row, 'n.startLine');
    if (startLine != null) item.startLine = startLine;

    return item;
  }

  private extractString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const val = record[key];
    return typeof val === 'string' ? val : null;
  }

  private extractNumber(
    record: Record<string, unknown>,
    key: string,
  ): number | null {
    const val = record[key];
    return typeof val === 'number' ? val : null;
  }

  private stringifyFirstValue(row: Record<string, unknown>): string | null {
    for (const val of Object.values(row)) {
      if (typeof val === 'string') return val;
      if (typeof val === 'number') return String(val);
      if (val != null && typeof val === 'object' && 'name' in val) {
        return String((val as Record<string, unknown>)['name']);
      }
    }
    return null;
  }
}
