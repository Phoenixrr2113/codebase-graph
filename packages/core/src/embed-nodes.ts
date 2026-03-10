/**
 * Embed Nodes — retroactive embedding for existing graph nodes.
 *
 * Queries all nodes of each type that have null embeddings (or all if force),
 * builds embedding text, batch-generates embeddings, and updates in place.
 *
 * Used by the `codegraph embed` CLI command.
 */

import { createLogger } from '@codegraph/logger';
import { createOperations, type GraphClient } from '@codegraph/graph';
import type { FunctionParam } from '@codegraph/types';
import {
  buildFunctionEmbeddingText,
  buildClassEmbeddingText,
  buildInterfaceEmbeddingText,
  buildComponentEmbeddingText,
  buildTypeEmbeddingText,
  buildVariableEmbeddingText,
  buildFileEmbeddingText,
  generateEmbeddings,
  isEmbeddingAvailable,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';
import { createHash } from 'node:crypto';
import { getGraphClient } from './graphClient';

const logger = createLogger({ namespace: 'Core:EmbedNodes' });

// ============================================================================
// Types
// ============================================================================

export type EmbeddableNodeType =
  | 'File'
  | 'Function'
  | 'Class'
  | 'Interface'
  | 'Variable'
  | 'Type'
  | 'Component';

export interface EmbedNodesOptions {
  /** Re-embed all nodes even if they already have embeddings (default: false) */
  force?: boolean;
  /** Only embed nodes of this type */
  nodeType?: EmbeddableNodeType;
  /** Use this client instead of the shared singleton */
  client?: GraphClient;
  /** Embedding configuration */
  embeddings?: EmbeddingConfig;
  /** Batch size for embedding generation (default: 100) */
  batchSize?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number, type: string) => void;
}

export interface EmbedNodesResult {
  embedded: number;
  skipped: number;
  errors: number;
  durationMs: number;
  /** Breakdown by node type */
  byType: Record<string, number>;
}

// ============================================================================
// Query templates — same syntax works for FalkorDB and Kuzu
// ============================================================================

const QUERIES = {
  // File
  FILES_NEEDING_EMBEDDING: `
    MATCH (f:File)
    WHERE f.embedding IS NULL
    RETURN f.path as path, f.name as name, f.extension as extension, f.loc as loc
  `,
  ALL_FILES: `
    MATCH (f:File)
    RETURN f.path as path, f.name as name, f.extension as extension, f.loc as loc
  `,

  // Function
  FUNCTIONS_NEEDING_EMBEDDING: `
    MATCH (fn:Function)
    WHERE fn.embedding IS NULL
    RETURN fn.name as name, fn.filePath as filePath, fn.startLine as startLine,
           fn.endLine as endLine, fn.isExported as isExported, fn.isAsync as isAsync,
           fn.isArrow as isArrow, fn.params as params, fn.returnType as returnType,
           fn.docstring as docstring
  `,
  ALL_FUNCTIONS: `
    MATCH (fn:Function)
    RETURN fn.name as name, fn.filePath as filePath, fn.startLine as startLine,
           fn.endLine as endLine, fn.isExported as isExported, fn.isAsync as isAsync,
           fn.isArrow as isArrow, fn.params as params, fn.returnType as returnType,
           fn.docstring as docstring
  `,

  // Class
  CLASSES_NEEDING_EMBEDDING: `
    MATCH (c:Class)
    WHERE c.embedding IS NULL
    RETURN c.name as name, c.filePath as filePath, c.startLine as startLine,
           c.endLine as endLine, c.isExported as isExported, c.isAbstract as isAbstract,
           c.extends as extends_, c.implements as implements_, c.docstring as docstring
  `,
  ALL_CLASSES: `
    MATCH (c:Class)
    RETURN c.name as name, c.filePath as filePath, c.startLine as startLine,
           c.endLine as endLine, c.isExported as isExported, c.isAbstract as isAbstract,
           c.extends as extends_, c.implements as implements_, c.docstring as docstring
  `,

  // Interface
  INTERFACES_NEEDING_EMBEDDING: `
    MATCH (i:Interface)
    WHERE i.embedding IS NULL
    RETURN i.name as name, i.filePath as filePath, i.startLine as startLine,
           i.endLine as endLine, i.isExported as isExported,
           i.extends as extends_, i.docstring as docstring
  `,
  ALL_INTERFACES: `
    MATCH (i:Interface)
    RETURN i.name as name, i.filePath as filePath, i.startLine as startLine,
           i.endLine as endLine, i.isExported as isExported,
           i.extends as extends_, i.docstring as docstring
  `,

  // Variable
  VARIABLES_NEEDING_EMBEDDING: `
    MATCH (v:Variable)
    WHERE v.embedding IS NULL
    RETURN v.name as name, v.filePath as filePath, v.line as line,
           v.kind as kind, v.type as type_, v.isExported as isExported
  `,
  ALL_VARIABLES: `
    MATCH (v:Variable)
    RETURN v.name as name, v.filePath as filePath, v.line as line,
           v.kind as kind, v.type as type_, v.isExported as isExported
  `,

  // Type
  TYPES_NEEDING_EMBEDDING: `
    MATCH (t:Type)
    WHERE t.embedding IS NULL
    RETURN t.name as name, t.filePath as filePath, t.startLine as startLine,
           t.endLine as endLine, t.kind as kind, t.isExported as isExported,
           t.docstring as docstring
  `,
  ALL_TYPES: `
    MATCH (t:Type)
    RETURN t.name as name, t.filePath as filePath, t.startLine as startLine,
           t.endLine as endLine, t.kind as kind, t.isExported as isExported,
           t.docstring as docstring
  `,

  // Component
  COMPONENTS_NEEDING_EMBEDDING: `
    MATCH (comp:Component)
    WHERE comp.embedding IS NULL
    RETURN comp.name as name, comp.filePath as filePath, comp.startLine as startLine,
           comp.endLine as endLine, comp.isExported as isExported,
           comp.propsType as propsType, comp.props as props
  `,
  ALL_COMPONENTS: `
    MATCH (comp:Component)
    RETURN comp.name as name, comp.filePath as filePath, comp.startLine as startLine,
           comp.endLine as endLine, comp.isExported as isExported,
           comp.propsType as propsType, comp.props as props
  `,
};

// ============================================================================
// Helpers
// ============================================================================

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Parse JSON string back to array, returning empty array on failure */
function parseJsonArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface NodeWithText {
  nodeType: EmbeddableNodeType;
  text: string;
  textHash: string;
  identifier: Record<string, unknown>;
}

function buildFileNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      path: r.path as string,
      name: r.name as string,
      extension: r.extension as string,
      loc: r.loc as number,
    };
    const text = buildFileEmbeddingText(entity as any);
    return {
      nodeType: 'File' as const,
      text,
      textHash: hashText(text),
      identifier: { path: entity.path },
    };
  });
}

function buildFunctionNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      name: r.name as string,
      filePath: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
      isExported: r.isExported as boolean,
      isAsync: r.isAsync as boolean,
      isArrow: r.isArrow as boolean,
      isGenerator: false,
      params: parseJsonArray<FunctionParam>(r.params as string),
      returnType: (r.returnType as string) ?? null,
      docstring: (r.docstring as string) ?? null,
    };
    const text = buildFunctionEmbeddingText(entity as any);
    return {
      nodeType: 'Function' as const,
      text,
      textHash: hashText(text),
      identifier: { name: entity.name, filePath: entity.filePath, startLine: entity.startLine },
    };
  });
}

function buildClassNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      name: r.name as string,
      filePath: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
      isExported: r.isExported as boolean,
      isAbstract: r.isAbstract as boolean,
      extends: (r.extends_ as string) ?? null,
      implements: parseJsonArray<string>(r.implements_ as string),
      docstring: (r.docstring as string) ?? null,
    };
    const text = buildClassEmbeddingText(entity as any);
    return {
      nodeType: 'Class' as const,
      text,
      textHash: hashText(text),
      identifier: { name: entity.name, filePath: entity.filePath, startLine: entity.startLine },
    };
  });
}

function buildInterfaceNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      name: r.name as string,
      filePath: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
      isExported: r.isExported as boolean,
      extends: parseJsonArray<string>(r.extends_ as string),
      docstring: (r.docstring as string) ?? null,
    };
    const text = buildInterfaceEmbeddingText(entity as any);
    return {
      nodeType: 'Interface' as const,
      text,
      textHash: hashText(text),
      identifier: { name: entity.name, filePath: entity.filePath, startLine: entity.startLine },
    };
  });
}

function buildVariableNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      name: r.name as string,
      filePath: r.filePath as string,
      line: r.line as number,
      kind: (r.kind as string) ?? 'const',
      type: (r.type_ as string) ?? null,
      isExported: r.isExported as boolean,
    };
    const text = buildVariableEmbeddingText(entity as any);
    return {
      nodeType: 'Variable' as const,
      text,
      textHash: hashText(text),
      identifier: { name: entity.name, filePath: entity.filePath, line: entity.line },
    };
  });
}

function buildTypeNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      name: r.name as string,
      filePath: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
      kind: (r.kind as string) ?? 'type',
      isExported: r.isExported as boolean,
      docstring: (r.docstring as string) ?? null,
    };
    const text = buildTypeEmbeddingText(entity as any);
    return {
      nodeType: 'Type' as const,
      text,
      textHash: hashText(text),
      identifier: { name: entity.name, filePath: entity.filePath, startLine: entity.startLine },
    };
  });
}

function buildComponentNodes(rows: Record<string, unknown>[]): NodeWithText[] {
  return rows.map((r) => {
    const entity = {
      name: r.name as string,
      filePath: r.filePath as string,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
      isExported: r.isExported as boolean,
      propsType: (r.propsType as string) ?? null,
      props: parseJsonArray(r.props as string),
    };
    const text = buildComponentEmbeddingText(entity as any);
    return {
      nodeType: 'Component' as const,
      text,
      textHash: hashText(text),
      identifier: { name: entity.name, filePath: entity.filePath, startLine: entity.startLine },
    };
  });
}

// ============================================================================
// Public API
// ============================================================================

const ALL_NODE_TYPES: EmbeddableNodeType[] = [
  'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component',
];

/**
 * Generate and store embeddings for all graph nodes that lack them.
 *
 * Queries each node table, builds embedding text, generates embeddings in
 * batches, and updates each node via `updateEmbedding()`.
 */
export async function embedAllNodes(options: EmbedNodesOptions = {}): Promise<EmbedNodesResult> {
  const startTime = Date.now();
  const { force = false, batchSize = 100, onProgress } = options;
  const embeddingConfig = options.embeddings;

  if (!isEmbeddingAvailable(embeddingConfig)) {
    logger.warn('Embedding is not available — check model/API configuration');
    return { embedded: 0, skipped: 0, errors: 0, durationMs: 0, byType: {} };
  }

  const client = options.client ?? await getGraphClient();
  const ops = createOperations(client);
  const nodeTypes = options.nodeType ? [options.nodeType] : ALL_NODE_TYPES;

  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const byType: Record<string, number> = {};

  for (const nodeType of nodeTypes) {
    try {
      // Query nodes for this type
      const rows = await queryNodesForType(client, nodeType, force);
      if (rows.length === 0) {
        logger.debug(`${nodeType}: no nodes to embed`);
        continue;
      }

      // Build embedding text for each node
      const nodes = buildNodesForType(nodeType, rows);
      logger.info(`${nodeType}: ${nodes.length} nodes to embed`);

      let typeEmbedded = 0;

      // Process in batches
      for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        const texts = batch.map((n) => n.text);

        try {
          const { embeddings } = await generateEmbeddings(texts, embeddingConfig);

          for (let j = 0; j < batch.length; j++) {
            const node = batch[j]!;
            const embedding = embeddings[j];
            if (!embedding) {
              totalSkipped++;
              continue;
            }

            try {
              await ops.updateEmbedding(node.nodeType, node.identifier, embedding, node.textHash);
              typeEmbedded++;
              totalEmbedded++;
            } catch (err) {
              totalErrors++;
              logger.warn(`Failed to update ${nodeType} embedding: ${err}`);
            }
          }
        } catch (err) {
          totalErrors += batch.length;
          logger.warn(`Batch embedding failed for ${nodeType}: ${err}`);
        }

        if (onProgress) {
          onProgress(totalEmbedded, totalEmbedded + totalSkipped + totalErrors, nodeType);
        }
      }

      byType[nodeType] = typeEmbedded;
    } catch (err) {
      logger.warn(`Failed to process ${nodeType}: ${err}`);
      totalErrors++;
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Embedded ${totalEmbedded} nodes (${totalSkipped} skipped, ${totalErrors} errors) in ${durationMs}ms`,
  );

  return { embedded: totalEmbedded, skipped: totalSkipped, errors: totalErrors, durationMs, byType };
}

// ============================================================================
// Internal: query + build dispatch
// ============================================================================

async function queryNodesForType(
  client: GraphClient,
  nodeType: EmbeddableNodeType,
  force: boolean,
): Promise<Record<string, unknown>[]> {
  const queryMap: Record<EmbeddableNodeType, { needed: string; all: string }> = {
    File: { needed: QUERIES.FILES_NEEDING_EMBEDDING, all: QUERIES.ALL_FILES },
    Function: { needed: QUERIES.FUNCTIONS_NEEDING_EMBEDDING, all: QUERIES.ALL_FUNCTIONS },
    Class: { needed: QUERIES.CLASSES_NEEDING_EMBEDDING, all: QUERIES.ALL_CLASSES },
    Interface: { needed: QUERIES.INTERFACES_NEEDING_EMBEDDING, all: QUERIES.ALL_INTERFACES },
    Variable: { needed: QUERIES.VARIABLES_NEEDING_EMBEDDING, all: QUERIES.ALL_VARIABLES },
    Type: { needed: QUERIES.TYPES_NEEDING_EMBEDDING, all: QUERIES.ALL_TYPES },
    Component: { needed: QUERIES.COMPONENTS_NEEDING_EMBEDDING, all: QUERIES.ALL_COMPONENTS },
  };

  const q = queryMap[nodeType];
  const cypher = force ? q.all : q.needed;
  const result = await client.roQuery<Record<string, unknown>>(cypher, { params: {} });
  return result.data;
}

function buildNodesForType(nodeType: EmbeddableNodeType, rows: Record<string, unknown>[]): NodeWithText[] {
  switch (nodeType) {
    case 'File': return buildFileNodes(rows);
    case 'Function': return buildFunctionNodes(rows);
    case 'Class': return buildClassNodes(rows);
    case 'Interface': return buildInterfaceNodes(rows);
    case 'Variable': return buildVariableNodes(rows);
    case 'Type': return buildTypeNodes(rows);
    case 'Component': return buildComponentNodes(rows);
  }
}
