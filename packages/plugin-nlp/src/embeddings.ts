/**
 * Two-tier Embedding Generation Utility
 *
 * Tier 1 — LOCAL (default, free, always available):
 *   Uses @huggingface/transformers with nomic-embed-text-v1.5 (768-dim).
 *   Model auto-downloads ~140MB to ~/.cache/huggingface on first use.
 *   No API key needed. Runs on CPU via ONNX runtime. ~10ms/embedding.
 *
 * Tier 2 — CLOUD (opt-in, requires OPENROUTER_API_KEY):
 *   Uses OpenRouter with openai/text-embedding-3-small (1536-dim).
 *   Higher quality for production, costs ~$0.02/1M tokens.
 *   Activated via config: { embeddingProvider: "openrouter" }
 *
 * The provider is selected via EmbeddingConfig. Dimensions are determined
 * by the provider (768 local, 1536 cloud). Both are first-class — the
 * Kuzu schema uses configurable FLOAT[N] columns to support either.
 */

import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'nlp:embeddings' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingProvider = 'local' | 'openrouter';

export interface EmbeddingConfig {
  /** Which provider to use. Default: 'local' */
  provider?: EmbeddingProvider;
  /** Override for local model name (default: 'nomic-ai/nomic-embed-text-v1.5') */
  localModel?: string;
  /** Override for cloud model name (default: 'openai/text-embedding-3-small') */
  cloudModel?: string;
  /** Max texts per batch for cloud API (default: 96) */
  cloudBatchSize?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  provider: EmbeddingProvider;
}

export interface EmbeddingBatchResult {
  embeddings: number[][];
  dimensions: number;
  provider: EmbeddingProvider;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCAL_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const LOCAL_DIMENSIONS = 768;

const CLOUD_MODEL = 'openai/text-embedding-3-small';
const CLOUD_DIMENSIONS = 1536;
const CLOUD_BATCH_SIZE = 250;

// ---------------------------------------------------------------------------
// Provider: Local (nomic-embed-text-v1.5 via @huggingface/transformers)
// ---------------------------------------------------------------------------

// Lazy singleton — model loaded on first use, reused thereafter
let _localExtractor: LocalExtractorFn | null = null;
let _localLoadPromise: Promise<LocalExtractorFn> | null = null;

type LocalExtractorFn = (
  text: string | string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

async function getLocalExtractor(model: string): Promise<LocalExtractorFn> {
  if (_localExtractor) return _localExtractor;
  if (_localLoadPromise) return _localLoadPromise;

  _localLoadPromise = (async () => {
    logger.info('Loading local embedding model (first run downloads ~140MB)...', { model });
    const start = performance.now();

    const { pipeline } = await import('@huggingface/transformers');
    // Use quantized int8 model for ~2x faster inference vs fp32.
    // Quality difference is negligible for code embeddings.
    const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' });

    const loadMs = performance.now() - start;
    logger.info(`Local embedding model loaded in ${(loadMs / 1000).toFixed(1)}s`);

    _localExtractor = extractor as unknown as LocalExtractorFn;
    _localLoadPromise = null;
    return _localExtractor;
  })();

  return _localLoadPromise;
}

async function embedLocal(text: string, model: string): Promise<number[]> {
  const extractor = await getLocalExtractor(model);
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/** Batch size for grouped ONNX inference. Texts in one batch are padded to
 *  equal length, so keep small to avoid wasting compute on padding. */
const ONNX_BATCH_SIZE = 16;

async function embedLocalBatch(texts: string[], model: string): Promise<number[][]> {
  const extractor = await getLocalExtractor(model);
  const results: number[][] = [];

  // Process in small batches — the ONNX runtime can leverage SIMD for
  // batched tensor ops, reducing per-item overhead vs one-at-a-time.
  // Batch size is kept small because tokenizer pads all inputs to the
  // length of the longest text in the batch.
  for (let i = 0; i < texts.length; i += ONNX_BATCH_SIZE) {
    const batch = texts.slice(i, i + ONNX_BATCH_SIZE);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const dims = output.dims;
    const embeddingDim = dims[dims.length - 1]!;
    for (let j = 0; j < batch.length; j++) {
      results.push(Array.from(output.data.slice(j * embeddingDim, (j + 1) * embeddingDim)));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Provider: Cloud (OpenRouter via Vercel AI SDK)
// ---------------------------------------------------------------------------

async function getCloudEmbeddingModel(model: string) {
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
  const openrouter = createOpenRouter();
  return openrouter.textEmbeddingModel(model);
}

async function embedCloud(text: string, model: string): Promise<number[]> {
  // Call doEmbed directly instead of AI SDK's embed() wrapper.
  // The embed() wrapper in ai@6.0.116 crashes with "Cannot read properties
  // of undefined (reading 'length')" because @openrouter/ai-sdk-provider@1.5.4
  // doesn't include a `warnings` array in its doEmbed response, and the SDK's
  // logWarnings() assumes warnings is always defined.
  const embeddingModel = await getCloudEmbeddingModel(model);
  const result = await embeddingModel.doEmbed({ values: [text], headers: {} });
  return result.embeddings[0]!;
}

/** Max concurrent API requests to avoid rate limits */
const CLOUD_CONCURRENCY = 10;

async function embedCloudBatch(
  texts: string[],
  model: string,
  batchSize: number,
): Promise<number[][]> {
  // Call doEmbed directly — see embedCloud comment for rationale.
  const embeddingModel = await getCloudEmbeddingModel(model);

  // Split into chunks
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    chunks.push(texts.slice(i, i + batchSize));
  }

  // Send chunks concurrently (bounded by CLOUD_CONCURRENCY)
  const results: number[][][] = new Array(chunks.length);
  for (let wave = 0; wave < chunks.length; wave += CLOUD_CONCURRENCY) {
    const waveChunks = chunks.slice(wave, wave + CLOUD_CONCURRENCY);
    const waveResults = await Promise.all(
      waveChunks.map(async (chunk) => {
        const result = await embeddingModel.doEmbed({ values: chunk, headers: {} });
        return result.embeddings;
      }),
    );
    for (let j = 0; j < waveResults.length; j++) {
      results[wave + j] = waveResults[j]!;
    }
  }

  return results.flat();
}

// ---------------------------------------------------------------------------
// Resolved config helpers
// ---------------------------------------------------------------------------

function resolveProvider(config?: EmbeddingConfig): EmbeddingProvider {
  // Explicit config takes priority
  if (config?.provider) return config.provider;

  // Env var override: CODEGRAPH_EMBEDDING_PROVIDER=openrouter
  const envProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  if (envProvider === 'openrouter') return 'openrouter';

  return 'local';
}

function resolveLocalModel(config?: EmbeddingConfig): string {
  return config?.localModel ?? LOCAL_MODEL;
}

function resolveCloudModel(config?: EmbeddingConfig): string {
  if (config?.cloudModel) return config.cloudModel;
  const envModel = process.env['CODEGRAPH_CLOUD_MODEL'];
  if (envModel) return envModel;
  return CLOUD_MODEL;
}

function resolveCloudBatchSize(config?: EmbeddingConfig): number {
  return config?.cloudBatchSize ?? CLOUD_BATCH_SIZE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an embedding for a single text.
 *
 * Uses local model (768-dim) by default. Set `config.provider = 'openrouter'`
 * or env `CODEGRAPH_EMBEDDING_PROVIDER=openrouter` for cloud (1536-dim).
 */
export async function generateEmbedding(
  text: string,
  config?: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const provider = resolveProvider(config);

  if (provider === 'openrouter') {
    const model = resolveCloudModel(config);
    const embedding = await embedCloud(text, model);
    return { embedding, dimensions: embedding.length, provider: 'openrouter' };
  }

  const model = resolveLocalModel(config);
  const embedding = await embedLocal(text, model);
  return { embedding, dimensions: embedding.length, provider: 'local' };
}

/**
 * Generate embeddings for multiple texts.
 *
 * Local: processes sequentially (~10ms/item on CPU).
 * Cloud: batches into chunks of `cloudBatchSize` (default 96) per API call.
 */
export async function generateEmbeddings(
  texts: string[],
  config?: EmbeddingConfig,
): Promise<EmbeddingBatchResult> {
  if (texts.length === 0) {
    const provider = resolveProvider(config);
    return {
      embeddings: [],
      dimensions: provider === 'openrouter' ? CLOUD_DIMENSIONS : LOCAL_DIMENSIONS,
      provider,
    };
  }

  const provider = resolveProvider(config);

  if (provider === 'openrouter') {
    const model = resolveCloudModel(config);
    const batchSize = resolveCloudBatchSize(config);
    const embeddings = await embedCloudBatch(texts, model, batchSize);
    return {
      embeddings,
      dimensions: embeddings[0]?.length ?? CLOUD_DIMENSIONS,
      provider: 'openrouter',
    };
  }

  const model = resolveLocalModel(config);
  const embeddings = await embedLocalBatch(texts, model);
  return {
    embeddings,
    dimensions: embeddings[0]?.length ?? LOCAL_DIMENSIONS,
    provider: 'local',
  };
}

/**
 * Get the embedding dimensions for the given config (without generating anything).
 */
export function getEmbeddingDimensions(config?: EmbeddingConfig): number {
  const provider = resolveProvider(config);
  return provider === 'openrouter' ? CLOUD_DIMENSIONS : LOCAL_DIMENSIONS;
}

/**
 * Get the resolved provider for the given config.
 */
export function getEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider {
  return resolveProvider(config);
}

/**
 * Check if embeddings are available. Local is always available (auto-downloads model).
 * Cloud requires OPENROUTER_API_KEY env var.
 */
export function isEmbeddingAvailable(config?: EmbeddingConfig): boolean {
  const provider = resolveProvider(config);
  if (provider === 'local') return true;
  return !!process.env['OPENROUTER_API_KEY'];
}

/**
 * Reset the cached local model (for testing).
 * @internal
 */
export function _resetLocalModel(): void {
  _localExtractor = null;
  _localLoadPromise = null;
}
