/**
 * Document Ingestion — Unified add() entry point
 *
 * Auto-detects input type (file path, URL, raw text), selects the appropriate
 * loader, chunks text, runs extractAndStore on each chunk, and bridges to code.
 *
 * Composes: loaders + chunker + extractAndStore from @codegraph/plugin-nlp
 */

import { getKnowledgeOps } from './knowledgeClient';
import { createLogger, toErrorMessage } from '@codegraph/logger';

const logger = createLogger({ namespace: 'DocumentIngestion' });

// ============================================================================
// Types
// ============================================================================

export interface AddOptions {
  /** Override auto-detection: 'file', 'url', or 'text' */
  inputType?: 'file' | 'url' | 'text';
  /** Chunking config */
  maxTokens?: number;
  overlap?: number;
  /** LLM model for extraction */
  model?: string;
  /** Source label for provenance tracking */
  source?: string;
}

export interface AddResult {
  /** Input type detected */
  inputType: 'file' | 'url' | 'text';
  /** Number of chunks processed */
  chunks: number;
  /** Total entities extracted across all chunks */
  entities: number;
  /** Total relationships extracted across all chunks */
  relationships: number;
  /** Loader metadata (format, pageCount, etc.) */
  metadata: Record<string, unknown>;
  /** Source label */
  source: string | null;
}

// ============================================================================
// Input Detection
// ============================================================================

function detectInputType(input: string): 'file' | 'url' | 'text' {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return 'url';
  }
  // Check for file path patterns (starts with / or ~, or has a file extension)
  if (input.startsWith('/') || input.startsWith('~') || /^[A-Z]:\\/.test(input)) {
    return 'file';
  }
  // Check if it looks like a relative file path with an extension
  if (/\.\w{1,5}$/.test(input) && !input.includes('\n') && input.length < 500) {
    return 'file';
  }
  return 'text';
}

function getExtension(path: string): string {
  const match = path.match(/\.(\w+)$/);
  return match ? match[1]!.toLowerCase() : '';
}

// ============================================================================
// Unified add() Function
// ============================================================================

/**
 * Ingest any content into the knowledge graph.
 *
 * Accepts file paths, URLs, or raw text. Auto-detects format, loads content,
 * chunks into LLM-friendly pieces, extracts entities/relationships, and stores
 * them with provenance tracking and bridge linking.
 */
export async function add(input: string, options?: AddOptions): Promise<AddResult> {
  // Dynamic imports to keep NLP dependencies optional
  const nlp = await import('@codegraph/plugin-nlp');

  const inputType = options?.inputType ?? detectInputType(input);
  let text: string;
  let metadata: Record<string, unknown> = {};

  // Step 1: Load content
  if (inputType === 'file') {
    const ext = getExtension(input);
    const loader = nlp.getLoaderForExtension(ext);
    if (loader) {
      logger.info(`Loading ${ext} file: ${input}`);
      const result = await loader.extract(input);
      text = result.text;
      metadata = result.metadata;
    } else {
      // No specialized loader — read as plain text
      const { readFile } = await import('node:fs/promises');
      text = await readFile(input, 'utf-8');
      metadata = { format: ext || 'text' };
    }
  } else if (inputType === 'url') {
    // Use HTML loader for URLs
    logger.info(`Fetching URL: ${input}`);
    const result = await nlp.HTMLLoader.extract(input);
    text = result.text;
    metadata = result.metadata;
  } else {
    // Raw text
    text = input;
    metadata = { format: 'text' };
  }

  if (!text || !text.trim()) {
    return {
      inputType,
      chunks: 0,
      entities: 0,
      relationships: 0,
      metadata,
      source: options?.source ?? null,
    };
  }

  // Step 2: Chunk text
  const chunks = nlp.chunkText(text, {
    maxTokens: options?.maxTokens ?? 512,
    overlap: options?.overlap ?? 50,
  });

  logger.info(`Chunked into ${chunks.length} pieces (${nlp.estimateTokens(text)} total tokens)`);

  // Step 3: Extract and store each chunk
  const ops = await getKnowledgeOps();
  let totalEntities = 0;
  let totalRelationships = 0;

  const config: Record<string, unknown> = {};
  if (options?.model) {
    config.extractor = { model: options.model };
  }

  for (const chunk of chunks) {
    try {
      const result = await nlp.extractAndStore(chunk.text, ops, config);
      totalEntities += result.entities;
      totalRelationships += result.relationships;
    } catch (err) {
      logger.warn(`Chunk ${chunk.index} extraction failed: ${toErrorMessage(err)}`);
      // Continue with remaining chunks
    }
  }

  logger.info(`Ingested: ${totalEntities} entities, ${totalRelationships} relationships from ${chunks.length} chunks`);

  return {
    inputType,
    chunks: chunks.length,
    entities: totalEntities,
    relationships: totalRelationships,
    metadata,
    source: options?.source ?? null,
  };
}
