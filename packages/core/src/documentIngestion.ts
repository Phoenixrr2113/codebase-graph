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
import type { TextLoader } from '@codegraph/plugin-nlp';
import type { GraphClient } from '@codegraph/graph';

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
   * Optional GraphClient for per-call dependency injection. When provided,
   * knowledge ops use this client (caller manages lifecycle) instead of
   * the global singleton from getGraphClient(). Mirrors embed-nodes.ts:330.
   */
  client?: GraphClient;
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
    } else if (ext === 'md' || ext === 'markdown') {
      // Markdown files: use the plugin-markdown parser so frontmatter
      // (including bitemporal fields like valid_at) flows through to the
      // extracted relationships. Without this, every relationship gets
      // valid_at = ingest-time, breaking point-in-time queries that
      // expect the document's authored date.
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(input, 'utf-8');
      const md = await import('@codegraph/plugin-markdown');
      const parsed = await md.parseMarkdown(raw);
      text = parsed.content;
      metadata = { ...parsed.frontmatter, format: 'md' };
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
    type Loader = TextLoader;
    let loader: Loader | null = null;
    let payload: string | Buffer;

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
  // When a caller-managed client is provided, always resolve ops through it
  // (even if _extractAndStore is also set) so the client binding is verifiable
  // via DI in tests. When no client and no extractor, use the global singleton.
  const ops = extractor && !options?.client ? null : await getKnowledgeOps(options?.client);
  let totalEntities = 0;
  let totalRelationships = 0;

  const config: Record<string, unknown> = {};
  if (options?.model) {
    config.extractor = { model: options.model };
  }
  // Propagate caller-provided source as sampleId so every entity created from
  // this add() call has a traceable, user-meaningful sampleId instead of an
  // opaque auto-generated one.
  if (options?.source) {
    config.sampleId = options.source;
  }

  // Propagate document-level temporal metadata (`valid_at` from YAML
  // frontmatter, or ISO date in raw text) to every relationship the
  // extractor emits from this document. Without this, relationships
  // get valid_at = Date.now() (ingest time), so point-in-time queries
  // like "what was true on 2025-12-15?" reject documents authored at
  // that time but ingested today.
  const docValidAtMs = parseDocValidAt(metadata);
  if (docValidAtMs != null) {
    config.validAt = docValidAtMs;
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

/**
 * Pull the document's authoritative `valid_at` timestamp from parsed
 * metadata, returning ms-since-epoch or null if no usable value is
 * present. Looks for common frontmatter keys (`valid_at`, `validAt`,
 * `validFrom`, `effective_date`, `date`) and accepts either a Date
 * instance (gray-matter parses ISO 8601 dates as Date objects under
 * the default schema) or a parseable string.
 *
 * Returns null on missing or malformed values — callers fall back to
 * Date.now() for the relationship's valid_at, which is the prior
 * behavior.
 */
function parseDocValidAt(metadata: Record<string, unknown>): number | null {
  const candidates = ['valid_at', 'validAt', 'validFrom', 'effective_date', 'date'];
  for (const key of candidates) {
    const v = metadata[key];
    if (v == null) continue;
    if (v instanceof Date) {
      const ms = v.getTime();
      if (!isNaN(ms)) return ms;
    }
    if (typeof v === 'string') {
      const ms = new Date(v).getTime();
      if (!isNaN(ms)) return ms;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Heuristic: 10-digit values are seconds, 13-digit are ms
      return v < 1e12 ? v * 1000 : v;
    }
  }
  return null;
}
