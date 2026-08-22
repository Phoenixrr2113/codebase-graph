/**
 * Embedding Generation — auto-detects provider from API keys.
 *
 * Provider resolution order:
 *   1. Explicit CODEGRAPH_EMBEDDING_PROVIDER env var (override)
 *   2. VOYAGE_API_KEY present → voyage (voyage-code-3, 1024-dim)
 *   3. OPENROUTER_API_KEY present → openrouter (text-embedding-3-small, 1536-dim)
 *   4. No provider and no key present → local nomic-embed-text-v1.5 (768-dim, CPU)
 *
 * Set CODEGRAPH_EMBEDDING_PROVIDER only to override auto-detection.
 * Use CODEGRAPH_EMBEDDING_PROVIDER=none as the explicit opt-out.
 */

import { createLogger, traced } from '@codegraph/logger';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const logger = createLogger({ namespace: 'nlp:embeddings' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingProvider = 'local' | 'openrouter' | 'voyage' | 'none';

export interface EmbeddingConfig {
  /** Which provider to use. Auto-detected from API keys; set CODEGRAPH_EMBEDDING_PROVIDER only to override. */
  provider?: EmbeddingProvider;
  /** Override for local model name (default: 'nomic-ai/nomic-embed-text-v1.5') */
  localModel?: string;
  /** Override for cloud model name (default: 'openai/text-embedding-3-small') */
  cloudModel?: string;
  /** Max texts per batch for cloud API (default: 250) */
  cloudBatchSize?: number;
  /** Override for Voyage model name (default: 'voyage-code-3') */
  voyageModel?: string;
  /** Input type hint for Voyage: 'document' for indexing, 'query' for search */
  inputType?: 'document' | 'query';
  /** Receives model download and initialization progress for local embeddings. */
  onLoadProgress?: (progress: EmbeddingLoadProgress) => void;
}

export interface EmbeddingProfile {
  provider: EmbeddingProvider;
  model: string | null;
  dimension: number;
}

export interface EmbeddingLoadProgress {
  state: 'not-started' | 'downloading' | 'loading' | 'ready' | 'failed';
  model: string;
  cached: boolean;
  loadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  error?: string;
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

const VOYAGE_MODEL = 'voyage-code-3';
const VOYAGE_DIMENSIONS = 1024;
const VOYAGE_BATCH_SIZE = 128;
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

// ---------------------------------------------------------------------------
// Provider: Local (nomic-embed-text-v1.5 via @huggingface/transformers)
// ---------------------------------------------------------------------------

// Lazy singleton — model loaded on first use, reused thereafter
let _localExtractor: LocalExtractorFn | null = null;
let _localLoadPromise: Promise<LocalExtractorFn> | null = null;
let _loadedLocalModel: string | null = null;
const localProgressObservers = new Set<(progress: EmbeddingLoadProgress) => void>();
const runtimeRequire = createRequire(import.meta.url);
let localModelState: EmbeddingLoadProgress = {
  state: 'not-started',
  model: LOCAL_MODEL,
  cached: false,
};

type LocalExtractorFn = (
  text: string | string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

type ResponseConstructor = new (
  body?: BodyInit | null,
  init?: ResponseInit,
) => Response;

export function createResponseCompatibleFetch(
  fetcher: typeof globalThis.fetch,
  ResponseType: ResponseConstructor,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (ResponseType.prototype.isPrototypeOf(response)) return response;

    return new ResponseType(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function isLocalEmbeddingModelCached(model = LOCAL_MODEL): boolean {
  try {
    const entrypoint = runtimeRequire.resolve('@huggingface/transformers');
    const packageRoot = dirname(dirname(entrypoint));
    const modelRoot = join(packageRoot, '.cache', ...model.split('/'));
    return [
      join(modelRoot, 'config.json'),
      join(modelRoot, 'tokenizer.json'),
      join(modelRoot, 'onnx', 'model_quantized.onnx'),
    ].every(existsSync);
  } catch {
    return false;
  }
}

function publishLocalProgress(progress: EmbeddingLoadProgress): void {
  localModelState = progress;
  for (const observer of localProgressObservers) observer(progress);
}

export function getLocalEmbeddingModelState(model = LOCAL_MODEL): EmbeddingLoadProgress {
  if (localModelState.state === 'not-started' || localModelState.model !== model) {
    return {
      state: 'not-started',
      model,
      cached: isLocalEmbeddingModelCached(model),
    };
  }
  return { ...localModelState };
}

async function getLocalExtractor(
  model: string,
  onProgress?: (progress: EmbeddingLoadProgress) => void,
): Promise<LocalExtractorFn> {
  if (_localExtractor && _loadedLocalModel === model) {
    const ready = { state: 'ready', model, cached: true } as const;
    publishLocalProgress(ready);
    onProgress?.(ready);
    return _localExtractor;
  }

  if (onProgress) localProgressObservers.add(onProgress);
  if (_localLoadPromise) {
    try {
      return await _localLoadPromise;
    } finally {
      if (onProgress) localProgressObservers.delete(onProgress);
    }
  }

  const cachedAtStart = isLocalEmbeddingModelCached(model);
  const fileProgress = new Map<string, { loaded: number; total: number }>();
  let lastLoggedBucket = -1;

  _localLoadPromise = (async () => {
    publishLocalProgress({
      state: cachedAtStart ? 'loading' : 'downloading',
      model,
      cached: cachedAtStart,
      loadedBytes: 0,
      totalBytes: 0,
      percent: 0,
    });
    logger.info(
      cachedAtStart
        ? 'Loading cached local embedding model.'
        : 'Downloading local embedding model (approximately 132 MiB), then loading it.',
      { model },
    );
    const start = performance.now();

    const { pipeline } = await import('@huggingface/transformers');
    const originalFetch = globalThis.fetch;
    const compatibleFetch = createResponseCompatibleFetch(originalFetch, globalThis.Response);
    globalThis.fetch = compatibleFetch;
    let extractor: unknown;
    try {
      extractor = await pipeline('feature-extraction', model, {
        dtype: 'q8',
        progress_callback: (event) => {
          if (event.status !== 'progress') return;
          fileProgress.set(event.file, { loaded: event.loaded, total: event.total });
          const totals = Array.from(fileProgress.values()).reduce(
            (sum, item) => ({ loaded: sum.loaded + item.loaded, total: sum.total + item.total }),
            { loaded: 0, total: 0 },
          );
          const percent = totals.total > 0 ? Math.round((totals.loaded / totals.total) * 100) : 0;
          publishLocalProgress({
            state: cachedAtStart ? 'loading' : 'downloading',
            model,
            loadedBytes: totals.loaded,
            totalBytes: totals.total,
            percent,
            cached: cachedAtStart,
          });
          const bucket = Math.floor(percent / 10);
          if (bucket > lastLoggedBucket) {
            lastLoggedBucket = bucket;
            logger.info('Local embedding model load progress.', {
              model,
              loadedBytes: totals.loaded,
              totalBytes: totals.total,
              percent,
            });
          }
        },
      });
    } finally {
      if (globalThis.fetch === compatibleFetch) globalThis.fetch = originalFetch;
    }

    const loadMs = performance.now() - start;
    logger.info(`Local embedding model loaded in ${(loadMs / 1000).toFixed(1)}s`);

    _localExtractor = extractor as LocalExtractorFn;
    _loadedLocalModel = model;
    _localLoadPromise = null;
    publishLocalProgress({ state: 'ready', model, cached: true });
    return _localExtractor;
  })().catch((error: unknown) => {
    _localLoadPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    publishLocalProgress({ state: 'failed', model, cached: cachedAtStart, error: message });
    throw error;
  });

  try {
    return await _localLoadPromise;
  } finally {
    if (onProgress) localProgressObservers.delete(onProgress);
  }
}

async function embedLocal(
  text: string,
  model: string,
  onProgress?: (progress: EmbeddingLoadProgress) => void,
): Promise<number[]> {
  const extractor = await getLocalExtractor(model, onProgress);
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/** Batch size for grouped ONNX inference. Texts in one batch are padded to
 *  equal length, so keep small to avoid wasting compute on padding. */
const ONNX_BATCH_SIZE = 16;

async function embedLocalBatch(
  texts: string[],
  model: string,
  onProgress?: (progress: EmbeddingLoadProgress) => void,
): Promise<number[][]> {
  const extractor = await getLocalExtractor(model, onProgress);
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
const CLOUD_CONCURRENCY = 20;

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
// Provider: Voyage AI (direct API — code-optimized embeddings)
// ---------------------------------------------------------------------------

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
  usage: { total_tokens: number };
}

async function embedVoyage(
  text: string,
  model: string,
  inputType?: 'document' | 'query',
): Promise<number[]> {
  const result = await embedVoyageBatch([text], model, 1, inputType);
  return result[0]!;
}

async function embedVoyageBatch(
  texts: string[],
  model: string,
  batchSize: number,
  inputType?: 'document' | 'query',
): Promise<number[][]> {
  const apiKey = process.env['VOYAGE_API_KEY'];
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');

  // Split into chunks
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    chunks.push(texts.slice(i, i + batchSize));
  }

  // Send chunks concurrently (bounded)
  const results: number[][][] = new Array(chunks.length);
  for (let wave = 0; wave < chunks.length; wave += CLOUD_CONCURRENCY) {
    const waveChunks = chunks.slice(wave, wave + CLOUD_CONCURRENCY);
    const waveResults = await Promise.all(
      waveChunks.map(async (chunk) => {
        const body: Record<string, unknown> = {
          input: chunk,
          model,
        };
        if (inputType) body.input_type = inputType;

        const response = await fetch(VOYAGE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Voyage API error ${response.status}: ${errText}`);
        }

        const json = (await response.json()) as VoyageEmbeddingResponse;
        return json.data.map((d) => d.embedding);
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

  // Explicit env var takes priority
  const envProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  if (envProvider === 'openrouter') return 'openrouter';
  if (envProvider === 'voyage') return 'voyage';
  if (envProvider === 'local') return 'local';
  if (envProvider === 'none') return 'none';

  // Auto-detect from API keys — if you have the key, that's the provider
  if (process.env['VOYAGE_API_KEY']) return 'voyage';
  if (process.env['OPENROUTER_API_KEY']) return 'openrouter';

  return 'local';
}

function resolveLocalModel(config?: EmbeddingConfig): string {
  return config?.localModel ?? LOCAL_MODEL;
}

function resolveCloudModel(config?: EmbeddingConfig): string {
  return config?.cloudModel
    ?? process.env['CODEGRAPH_EMBEDDING_MODEL']
    ?? process.env['CODEGRAPH_CLOUD_MODEL']
    ?? CLOUD_MODEL;
}

function resolveCloudBatchSize(config?: EmbeddingConfig): number {
  return config?.cloudBatchSize ?? CLOUD_BATCH_SIZE;
}

function resolveVoyageModel(config?: EmbeddingConfig): string {
  return config?.voyageModel
    ?? process.env['CODEGRAPH_EMBEDDING_MODEL']
    ?? VOYAGE_MODEL;
}

// ---------------------------------------------------------------------------
// Embedding cache — caches query→vector for cloud providers to avoid
// redundant API calls. Local embeddings are ~10ms so not worth caching.
// ---------------------------------------------------------------------------

const EMBEDDING_CACHE_MAX = 1000;
const _embeddingCache = new Map<string, number[]>();

function embeddingCacheKey(provider: string, model: string, inputType: string | undefined, text: string): string {
  return `${provider}:${model}:${inputType ?? ''}:${text}`;
}

/** Clear the embedding cache (e.g., after model change). */
export function clearEmbeddingCache(): void {
  _embeddingCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an embedding for a single text.
 *
 * Auto-detects provider from API keys. Set CODEGRAPH_EMBEDDING_PROVIDER only to override.
 * Providers: 'local' (768-dim), 'voyage' (1024-dim), 'openrouter' (1536-dim).
 */
async function generateEmbeddingImpl(
  text: string,
  config?: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const provider = resolveProvider(config);

  if (provider === 'none') {
    throw new Error(
      'No embedding provider configured. Set VOYAGE_API_KEY, OPENROUTER_API_KEY, or CODEGRAPH_EMBEDDING_PROVIDER=local'
    );
  }

  if (provider === 'voyage') {
    const model = resolveVoyageModel(config);
    const key = embeddingCacheKey(provider, model, config?.inputType, text);
    const cached = _embeddingCache.get(key);
    if (cached) return { embedding: cached, dimensions: cached.length, provider };
    const embedding = await embedVoyage(text, model, config?.inputType);
    if (_embeddingCache.size >= EMBEDDING_CACHE_MAX) _embeddingCache.delete(_embeddingCache.keys().next().value!);
    _embeddingCache.set(key, embedding);
    return { embedding, dimensions: embedding.length, provider: 'voyage' };
  }

  if (provider === 'openrouter') {
    const model = resolveCloudModel(config);
    const key = embeddingCacheKey(provider, model, undefined, text);
    const cached = _embeddingCache.get(key);
    if (cached) return { embedding: cached, dimensions: cached.length, provider };
    const embedding = await embedCloud(text, model);
    if (_embeddingCache.size >= EMBEDDING_CACHE_MAX) _embeddingCache.delete(_embeddingCache.keys().next().value!);
    _embeddingCache.set(key, embedding);
    return { embedding, dimensions: embedding.length, provider: 'openrouter' };
  }

  // Local embeddings are ~10ms — no cache needed
  const model = resolveLocalModel(config);
  const embedding = await embedLocal(text, model, config?.onLoadProgress);
  return { embedding, dimensions: embedding.length, provider: 'local' };
}

export const generateEmbedding = traced('generateEmbedding', generateEmbeddingImpl);

/**
 * Generate embeddings for multiple texts.
 *
 * Local: processes in ONNX batches of 16 (~10ms/item on CPU).
 * Cloud: batches into chunks of `cloudBatchSize` (default 250) per API call.
 * Voyage: batches into chunks of 128 per API call with code-optimized model.
 */
export async function generateEmbeddings(
  texts: string[],
  config?: EmbeddingConfig,
): Promise<EmbeddingBatchResult> {
  const provider = resolveProvider(config);

  if (provider === 'none') {
    throw new Error(
      'No embedding provider configured. Set VOYAGE_API_KEY, OPENROUTER_API_KEY, or CODEGRAPH_EMBEDDING_PROVIDER=local'
    );
  }

  if (texts.length === 0) {
    const dims = provider === 'voyage' ? VOYAGE_DIMENSIONS
      : provider === 'openrouter' ? CLOUD_DIMENSIONS
      : LOCAL_DIMENSIONS;
    return { embeddings: [], dimensions: dims, provider };
  }

  if (provider === 'voyage') {
    const model = resolveVoyageModel(config);
    const inputType = config?.inputType ?? 'document';
    const embeddings = await embedVoyageBatch(texts, model, VOYAGE_BATCH_SIZE, inputType);
    return {
      embeddings,
      dimensions: embeddings[0]?.length ?? VOYAGE_DIMENSIONS,
      provider: 'voyage',
    };
  }

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
  const embeddings = await embedLocalBatch(texts, model, config?.onLoadProgress);
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
  if (provider === 'none') return 0;
  if (provider === 'voyage') return VOYAGE_DIMENSIONS;
  return provider === 'openrouter' ? CLOUD_DIMENSIONS : LOCAL_DIMENSIONS;
}

/**
 * Get the resolved provider for the given config.
 */
export function getEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider {
  return resolveProvider(config);
}

export function getEmbeddingProfile(config?: EmbeddingConfig): EmbeddingProfile {
  const provider = resolveProvider(config);
  if (provider === 'none') return { provider, model: null, dimension: 0 };
  if (provider === 'voyage') {
    return { provider, model: resolveVoyageModel(config), dimension: VOYAGE_DIMENSIONS };
  }
  if (provider === 'openrouter') {
    return { provider, model: resolveCloudModel(config), dimension: CLOUD_DIMENSIONS };
  }
  return { provider, model: resolveLocalModel(config), dimension: LOCAL_DIMENSIONS };
}

/**
 * Check if embeddings are available. Local is always available (auto-downloads model).
 * Cloud requires OPENROUTER_API_KEY. Voyage requires VOYAGE_API_KEY.
 */
export function isEmbeddingAvailable(config?: EmbeddingConfig): boolean {
  const provider = resolveProvider(config);
  if (provider === 'none') return false;
  if (provider === 'local') return true;
  if (provider === 'voyage') return !!process.env['VOYAGE_API_KEY'];
  return !!process.env['OPENROUTER_API_KEY'];
}

/**
 * Pre-load the local embedding model so the first embedding request
 * doesn't pay the ~2-4s ONNX initialization cost.
 *
 * Call this at server startup (fire-and-forget). Non-fatal: logs and returns
 * on any error. No-op when using cloud/voyage embeddings.
 */
export async function warmupEmbedding(config?: EmbeddingConfig): Promise<void> {
  const provider = resolveProvider(config);
  if (provider === 'none') {
    logger.warn('No embedding provider configured — set VOYAGE_API_KEY or OPENROUTER_API_KEY. Search will not work.');
    return;
  }
  if (provider !== 'local') {
    logger.debug('Embedding warmup skipped (using cloud provider)');
    return;
  }

  const model = resolveLocalModel(config);
  const start = performance.now();
  try {
    await getLocalExtractor(model);
    const ms = (performance.now() - start).toFixed(0);
    logger.info(`Embedding model warmed up in ${ms}ms`);
  } catch (err) {
    logger.warn(`Embedding warmup failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Reset the cached local model (for testing).
 * @internal
 */
export function _resetLocalModel(): void {
  _localExtractor = null;
  _localLoadPromise = null;
  _loadedLocalModel = null;
  localModelState = {
    state: 'not-started',
    model: LOCAL_MODEL,
    cached: isLocalEmbeddingModelCached(LOCAL_MODEL),
  };
}
