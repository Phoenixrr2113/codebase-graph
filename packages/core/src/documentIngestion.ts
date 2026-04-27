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
  /**
   * DI hooks — test-only. Override internal dependencies for unit testing
   * without a real graph database or network connection.
   */
  _extractAndStore?: (text: string, ops: unknown, config?: unknown) => Promise<{ entities: number; relationships: number }>;
  _fetch?: typeof globalThis.fetch;
  _loader?: { extract: (input: string | Buffer) => Promise<{ text: string; metadata: Record<string, unknown> }> };
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
  let text = '';
  let metadata: Record<string, unknown> = {};

  // Step 1: Load content
  if (inputType === 'file') {
    const ext = getExtension(input);
    // DI hook: allow test to inject a specific loader
    const loader = options?._loader ?? nlp.getLoaderForExtension(ext);
    // For known binary/structured extensions we require a loader; unknown extensions with no loader throw
    const knownBinaryExts = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt']);
    if (!loader && ext && knownBinaryExts.has(ext)) {
      throw new Error(`unsupported file type: no loader registered for ".${ext}"`);
    }
    // For totally unknown extensions with no loader, throw as well
    if (!loader && ext && !/^txt|md|json|yaml|yml|toml|ini|csv|html?|htm/.test(ext)) {
      throw new Error(`unsupported file extension: no loader registered for ".${ext}"`);
    }
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
    logger.info(`Fetching URL: ${input}`);
    const fetcher = options?._fetch ?? globalThis.fetch;
    const fetchedAt = Date.now();
    const res = await fetcher(input, {
      headers: { 'user-agent': 'CodeGraph/0.1' },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`URL fetch failed: ${input} (HTTP ${res.status})`);
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();

    // Dispatch by content-type to the right loader
    type Loader = { extract: (input: string | Buffer | Uint8Array) => Promise<{ text: string; metadata: Record<string, unknown> }> };
    let loader: Loader | null = null;
    let payload: string | Buffer | Uint8Array;

    if (contentType === 'application/pdf') {
      loader = nlp.PDFLoader as Loader;
      payload = Buffer.from(await res.arrayBuffer());
    } else if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || contentType === 'application/msword') {
      loader = nlp.DOCXLoader as Loader;
      payload = Buffer.from(await res.arrayBuffer());
    } else if (contentType === 'text/csv' || contentType === 'application/csv') {
      loader = nlp.CSVLoader as Loader;
      payload = await res.text();
    } else if (contentType === 'text/markdown' || contentType === 'text/plain') {
      // Plain text path: no loader, just text
      text = await res.text();
      metadata = {
        format: contentType.split('/')[1],
        url: input,
        fetchedAt,
        contentType,
      };
      // Skip the loader-dispatch branch below
      loader = null;
      payload = '';
    } else {
      // Default: treat as HTML
      loader = (options?._loader ?? nlp.HTMLLoader) as Loader;
      payload = await res.text();
    }

    if (loader) {
      try {
        const result = await loader.extract(payload);
        text = result.text;
        // Merge loader metadata; URL provenance fields take precedence
        metadata = {
          ...result.metadata,
          url: input,
          fetchedAt,
          contentType,
        };
      } catch (err) {
        // Loader failed (e.g. corrupt binary payload) — preserve provenance metadata
        logger.warn(`Loader extraction failed for ${contentType} URL: ${toErrorMessage(err)}`);
        text = '';
        metadata = { url: input, fetchedAt, contentType };
      }
    }
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
  // DI hook: allow test to inject extractAndStore mock to avoid real DB connection
  const extractor = options?._extractAndStore;
  const ops = extractor ? null : await getKnowledgeOps();
  let totalEntities = 0;
  let totalRelationships = 0;

  const config: Record<string, unknown> = {};
  if (options?.model) {
    config.extractor = { model: options.model };
  }

  for (const chunk of chunks) {
    try {
      const result = extractor
        ? await extractor(chunk.text, ops, config)
        : await nlp.extractAndStore(chunk.text, ops!, config);
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
