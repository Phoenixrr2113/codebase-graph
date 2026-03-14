/**
 * Centralized LLM Model Factory
 *
 * Provides a single place to configure and obtain LanguageModel instances
 * for use across the plugin-nlp package (entity extraction, conflict
 * resolution, entity resolution, and WS12 search types).
 *
 * Two-tier model system:
 *   - Default model: Used for most queries (routing, NL→Cypher, simple answers)
 *   - Complex model: Used for multi-step reasoning (GRAPH_ANSWER, CONTEXT_WALK)
 *
 * The complex model defaults to the same provider as the default model
 * (e.g., Cerebras for both tiers). This is optimal when the provider is fast
 * enough for multi-call strategies. GLM can be used as a fallback for
 * deeper reasoning when configured.
 *
 * Supports multiple providers:
 *   - cerebras (default): Fast inference via Cerebras cloud
 *   - glm: Zhipu GLM models for complex reasoning
 *   - openrouter: Uses @openrouter/ai-sdk-provider
 *   - ollama: Uses @ai-sdk/openai-compatible pointed at localhost:11434
 *
 * Configuration via env vars:
 *   LLM_PROVIDER            — "cerebras" | "openrouter" | "ollama" (default: "cerebras")
 *   LLM_MODEL               — model name override (default: provider-specific)
 *   COMPLEX_LLM_PROVIDER    — override provider for complex model (default: same as LLM_PROVIDER)
 *   COMPLEX_LLM_MODEL       — override model for complex tier (default: same as default tier)
 *   CEREBRAS_API_KEY         — required for cerebras provider
 *   CEREBRAS_MODEL           — cerebras model override (default: qwen-3-235b-a22b-instruct-2507)
 *   GLM_API_KEY              — required for glm provider
 *   GLM_MODEL                — glm model override (default: GLM-4.7)
 *   OPENROUTER_API_KEY       — required for openrouter provider
 *   OLLAMA_BASE_URL          — override Ollama URL (default: http://localhost:11434)
 *
 * Usage:
 *   import { getLLMModel, getLLMComplexModel } from './llm';
 *   const model = await getLLMModel();         // Cerebras qwen-3-235b (fast, 100% routing accuracy)
 *   const complex = await getLLMComplexModel(); // Same provider or GLM fallback
 */

import { createLogger, toErrorMessage } from '@codegraph/logger';
import type { LanguageModel } from 'ai';

const logger = createLogger({ namespace: 'nlp:llm' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProvider = 'cerebras' | 'glm' | 'openrouter' | 'ollama';

export interface LLMConfig {
  /** Which LLM provider to use. Default: from LLM_PROVIDER env or 'cerebras' */
  provider?: LLMProvider;
  /** Model name. Default: provider-specific default */
  model?: string;
  /** Temperature for generation. Default: 0.1 */
  temperature?: number;
  /** Base URL override (for Ollama or custom endpoints) */
  baseURL?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  cerebras: 'qwen-3-235b-a22b-instruct-2507',
  glm: 'GLM-4.7',
  openrouter: 'google/gemini-2.5-flash',
  ollama: 'llama3.2',
};

const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
// GLM Coding plan uses a different endpoint than the standard API
const GLM_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';

// ---------------------------------------------------------------------------
// Provider + model singletons (lazy-initialized, cached by config key)
// ---------------------------------------------------------------------------

let _openrouterProvider: unknown | null = null;

async function getOpenRouterProvider(): Promise<unknown> {
  if (!_openrouterProvider) {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    _openrouterProvider = createOpenRouter();
  }
  return _openrouterProvider;
}

/**
 * Cached model instances. Key = "provider:modelName" to allow different
 * models to coexist (default vs complex). The LanguageModel instances are
 * stateless and thread-safe, so caching is safe.
 */
const _modelCache = new Map<string, LanguageModel>();

function cacheKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

// ---------------------------------------------------------------------------
// Model factory
// ---------------------------------------------------------------------------

/**
 * Get the configured LLM provider name from env or config.
 */
export function getLLMProvider(config?: LLMConfig): LLMProvider {
  if (config?.provider) return config.provider;
  const envProvider = process.env['LLM_PROVIDER']?.toLowerCase();
  if (envProvider === 'cerebras') return 'cerebras';
  if (envProvider === 'ollama') return 'ollama';
  if (envProvider === 'glm') return 'glm';
  if (envProvider === 'openrouter') return 'openrouter';
  // Default: use LLM_PROVIDER env var to select provider explicitly.
  // If not set, prefer cerebras if its key is present, else openrouter.
  if (process.env['CEREBRAS_API_KEY']) return 'cerebras';
  return 'openrouter';
}

/**
 * Get the configured model name from env or config.
 */
export function getLLMModelName(config?: LLMConfig): string {
  if (config?.model) return config.model;
  const provider = getLLMProvider(config);
  // Provider-specific env var overrides
  if (provider === 'cerebras' && process.env['CEREBRAS_MODEL']) {
    return process.env['CEREBRAS_MODEL'];
  }
  if (provider === 'glm' && process.env['GLM_MODEL']) {
    return process.env['GLM_MODEL'];
  }
  // Generic override
  const envModel = process.env['LLM_MODEL'];
  if (envModel) return envModel;
  return DEFAULT_MODELS[provider];
}

/**
 * Check if an LLM provider is available (has required credentials/services).
 */
export function isLLMAvailable(config?: LLMConfig): boolean {
  const provider = getLLMProvider(config);
  if (provider === 'cerebras') {
    return !!process.env['CEREBRAS_API_KEY'];
  }
  if (provider === 'glm') {
    return !!process.env['GLM_API_KEY'];
  }
  if (provider === 'openrouter') {
    return !!process.env['OPENROUTER_API_KEY'];
  }
  // Ollama is assumed available if provider is set (local service)
  return true;
}

/**
 * Check if a complex LLM is available.
 *
 * The complex model uses the same provider as the default model when
 * available (e.g., Cerebras for both tiers). Falls back to GLM if
 * COMPLEX_LLM_PROVIDER is explicitly set to 'glm', or if the default
 * provider is not available.
 */
export function isComplexLLMAvailable(): boolean {
  const complexProvider = getComplexLLMProvider();
  if (!complexProvider) return false;
  return isLLMAvailable({ provider: complexProvider });
}

/**
 * Determine which provider to use for the complex model.
 *
 * Priority:
 * 1. COMPLEX_LLM_PROVIDER env var (explicit override)
 * 2. Same as default LLM_PROVIDER (unified — Cerebras for both tiers)
 * 3. GLM if GLM_API_KEY is set (legacy fallback)
 * 4. null if nothing is available
 */
function getComplexLLMProvider(): LLMProvider | null {
  // Explicit override
  const envComplex = process.env['COMPLEX_LLM_PROVIDER']?.toLowerCase();
  if (envComplex === 'cerebras') return 'cerebras';
  if (envComplex === 'glm') return 'glm';
  if (envComplex === 'openrouter') return 'openrouter';
  if (envComplex === 'ollama') return 'ollama';

  // Default: use the same provider as the default model
  const defaultProvider = getLLMProvider();
  if (isLLMAvailable({ provider: defaultProvider })) return defaultProvider;

  // Fallback: GLM if configured
  if (process.env['GLM_API_KEY']) return 'glm';

  return null;
}

/**
 * Get the model name for the complex tier.
 */
function getComplexLLMModelName(): string {
  // Explicit override
  if (process.env['COMPLEX_LLM_MODEL']) return process.env['COMPLEX_LLM_MODEL'];

  const provider = getComplexLLMProvider();
  if (!provider) return DEFAULT_MODELS.cerebras; // shouldn't reach here

  // Provider-specific overrides
  if (provider === 'glm' && process.env['GLM_MODEL']) return process.env['GLM_MODEL'];
  if (provider === 'cerebras' && process.env['CEREBRAS_MODEL']) return process.env['CEREBRAS_MODEL'];

  return DEFAULT_MODELS[provider];
}

/**
 * Get a configured LanguageModel instance (default tier — fast inference).
 *
 * Returns a cached model from the configured provider. Model instances are
 * cached by "provider:model" key since they are stateless and reusable.
 *
 * @param config - Optional configuration override
 * @returns A LanguageModel ready for use with generateText/generateObject
 * @throws Error if required credentials are missing
 */
export async function getLLMModel(config?: LLMConfig): Promise<LanguageModel> {
  const provider = getLLMProvider(config);
  const modelName = getLLMModelName(config);
  const key = cacheKey(provider, modelName);

  const cached = _modelCache.get(key);
  if (cached) return cached;

  logger.debug(`getLLMModel: creating provider=${provider}, model=${modelName}`);

  let model: LanguageModel;
  if (provider === 'cerebras') {
    model = await getCerebrasModel(modelName, config?.baseURL);
  } else if (provider === 'glm') {
    model = await getGLMModel(modelName, config?.baseURL);
  } else if (provider === 'ollama') {
    model = await getOllamaModel(modelName, config?.baseURL);
  } else {
    model = await getOpenRouterModel(modelName);
  }

  _modelCache.set(key, model);
  return model;
}

/**
 * Get the complex-tier LanguageModel for multi-step reasoning.
 *
 * Used by strategies that need deeper reasoning: GRAPH_ANSWER, CONTEXT_WALK.
 *
 * Provider priority:
 * 1. COMPLEX_LLM_PROVIDER env var (explicit override, e.g., "glm")
 * 2. Same as default provider (e.g., Cerebras for both tiers — fastest)
 * 3. GLM if GLM_API_KEY is set (legacy fallback for deep reasoning)
 * 4. null if nothing is configured
 *
 * When using the same provider for both tiers (e.g., Cerebras), the complex
 * model is identical to the default model. This is intentional — benchmarks
 * show Cerebras qwen-3-235b at ~5s for GRAPH_ANSWER vs ~22s for GLM, making
 * unified Cerebras the optimal configuration when rate limits allow.
 *
 * @returns LanguageModel for complex reasoning, or null if not configured
 */
export async function getLLMComplexModel(): Promise<LanguageModel | null> {
  const provider = getComplexLLMProvider();
  if (!provider) {
    logger.debug('No complex LLM provider available');
    return null;
  }

  const modelName = getComplexLLMModelName();
  const key = cacheKey(provider, modelName);

  const cached = _modelCache.get(key);
  if (cached) return cached;

  logger.debug(`getLLMComplexModel: creating provider=${provider}, model=${modelName}`);

  let model: LanguageModel;
  if (provider === 'cerebras') {
    model = await getCerebrasModel(modelName);
  } else if (provider === 'glm') {
    model = await getGLMModel(modelName);
  } else if (provider === 'ollama') {
    model = await getOllamaModel(modelName);
  } else {
    model = await getOpenRouterModel(modelName);
  }

  _modelCache.set(key, model);
  return model;
}

/**
 * Synchronous version for cases where the provider is already initialized.
 * Falls back to creating a new OpenRouter instance if needed.
 * Only supports OpenRouter (the default).
 */
export function getLLMModelSync(config?: LLMConfig): LanguageModel {
  const provider = getLLMProvider(config);
  const modelName = getLLMModelName(config);

  if (provider !== 'openrouter') {
    throw new Error(
      `getLLMModelSync only supports openrouter. Use getLLMModel() for ${provider}.`,
    );
  }

  // Synchronous path: import is already cached after first use
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createOpenRouter } = require('@openrouter/ai-sdk-provider') as {
    createOpenRouter: () => { chat: (model: string) => LanguageModel };
  };

  if (!_openrouterProvider) {
    _openrouterProvider = createOpenRouter();
  }

  return (_openrouterProvider as { chat: (model: string) => LanguageModel }).chat(modelName);
}

// ---------------------------------------------------------------------------
// Provider-specific model creation
// ---------------------------------------------------------------------------

async function getCerebrasModel(
  modelName: string,
  baseURL?: string,
): Promise<LanguageModel> {
  if (!process.env['CEREBRAS_API_KEY']) {
    throw new Error(
      'CEREBRAS_API_KEY environment variable is required for Cerebras LLM provider. ' +
      'Set it in your .env file or environment.',
    );
  }

  const url = baseURL ?? CEREBRAS_BASE_URL;
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  const cerebras = createOpenAICompatible({
    name: 'cerebras',
    baseURL: url,
    headers: {
      Authorization: `Bearer ${process.env['CEREBRAS_API_KEY']}`,
    },
    supportsStructuredOutputs: true,
  });

  logger.debug(`Cerebras model: ${modelName} at ${url}`);
  return cerebras.chatModel(modelName);
}

async function getGLMModel(
  modelName: string,
  baseURL?: string,
): Promise<LanguageModel> {
  if (!process.env['GLM_API_KEY']) {
    throw new Error(
      'GLM_API_KEY environment variable is required for GLM LLM provider. ' +
      'Set it in your .env file or environment.',
    );
  }

  const url = baseURL ?? GLM_BASE_URL;
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');

  // GLM supports json_object but NOT json_schema response format.
  // The AI SDK sends json_schema when supportsStructuredOutputs=true.
  // We use a custom fetch to downgrade json_schema → json_object so the
  // AI SDK includes response_format in the request (otherwise GLM responds
  // only in reasoning_content and the SDK can't parse it).
  const glmFetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body.response_format?.type === 'json_schema') {
          body.response_format = { type: 'json_object' };
          return globalThis.fetch(input, { ...init, body: JSON.stringify(body) });
        }
      } catch {
        // not JSON body, pass through
      }
    }
    return globalThis.fetch(input, init);
  };

  const glm = createOpenAICompatible({
    name: 'glm',
    baseURL: url,
    headers: {
      Authorization: `Bearer ${process.env['GLM_API_KEY']}`,
    },
    supportsStructuredOutputs: true,
    fetch: glmFetch,
  });

  logger.info(`GLM model: ${modelName} at ${url}`);
  return glm.chatModel(modelName);
}

async function getOpenRouterModel(modelName: string): Promise<LanguageModel> {
  if (!process.env['OPENROUTER_API_KEY']) {
    throw new Error(
      'OPENROUTER_API_KEY environment variable is required for OpenRouter LLM provider. ' +
      'Set it in your .env file or environment.',
    );
  }

  const provider = await getOpenRouterProvider();
  return (provider as { chat: (model: string) => LanguageModel }).chat(modelName);
}

async function getOllamaModel(
  modelName: string,
  baseURL?: string,
): Promise<LanguageModel> {
  const url = baseURL ?? process.env['OLLAMA_BASE_URL'] ?? DEFAULT_OLLAMA_URL;

  // Use @ai-sdk/openai-compatible for Ollama (OpenAI-compatible API)
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  const ollama = createOpenAICompatible({
    name: 'ollama',
    baseURL: url,
  });

  logger.debug(`Ollama model: ${modelName} at ${url}`);
  return ollama.chatModel(modelName);
}

// ---------------------------------------------------------------------------
// Warmup
// ---------------------------------------------------------------------------

/**
 * Pre-initialize LLM model instances so the first search request doesn't
 * pay the dynamic import + provider creation cost.
 *
 * Call this at server startup (fire-and-forget). Non-fatal: logs and returns
 * on any error.
 */
export async function warmupLLM(): Promise<void> {
  const start = performance.now();

  try {
    if (isLLMAvailable()) {
      await getLLMModel();
      logger.info(`LLM default model warmed up`);
    }
  } catch (err) {
    logger.warn(`LLM warmup (default) failed: ${toErrorMessage(err)}`);
  }

  try {
    if (isComplexLLMAvailable()) {
      await getLLMComplexModel();
      const cp = getComplexLLMProvider();
      const cm = getComplexLLMModelName();
      logger.info(`LLM complex model warmed up (provider=${cp}, model=${cm})`);
    }
  } catch (err) {
    logger.warn(`LLM warmup (complex) failed: ${toErrorMessage(err)}`);
  }

  const ms = (performance.now() - start).toFixed(0);
  logger.info(`LLM warmup complete in ${ms}ms`);
}

/**
 * Reset all cached model instances (for testing).
 * @internal
 */
export function _resetModelCache(): void {
  _modelCache.clear();
  _openrouterProvider = null;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/**
 * Check if an error is transient and worth retrying.
 *
 * Covers:
 * - 404 "Not Found" from Cerebras (transient model availability)
 * - 429 rate-limit errors
 * - 5xx server errors
 * - Network/fetch errors (ECONNRESET, ETIMEDOUT, etc.)
 */
function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // HTTP status codes embedded in error messages
  if (/\b(404|429|500|502|503|504)\b/.test(msg)) return true;

  // Common transient error patterns
  if (lower.includes('not found')) return true;
  if (lower.includes('rate limit')) return true;
  if (lower.includes('too many requests')) return true;
  if (lower.includes('internal server error')) return true;
  if (lower.includes('bad gateway')) return true;
  if (lower.includes('service unavailable')) return true;
  if (lower.includes('gateway timeout')) return true;

  // Network errors
  if (lower.includes('econnreset')) return true;
  if (lower.includes('etimedout')) return true;
  if (lower.includes('econnrefused')) return true;
  if (lower.includes('fetch failed')) return true;
  if (lower.includes('network error')) return true;

  return false;
}

/**
 * Retry an async operation with exponential backoff for transient errors.
 *
 * Non-transient errors (auth failures, schema validation, etc.) are thrown
 * immediately without retry. Transient errors (404, 429, 5xx, network) are
 * retried up to `maxRetries` times with exponential backoff.
 *
 * @param fn - Async function to execute
 * @param maxRetries - Maximum retry attempts (default: 2, so 3 total attempts)
 * @param baseDelayMs - Base delay between retries in ms (default: 250)
 * @returns The result of fn()
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```ts
 * const result = await withRetry(() => generateText({ model, prompt }));
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  baseDelayMs: number = 250,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry non-transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      // Don't retry if this was the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 250ms, 500ms, 1000ms, ...
      const delay = baseDelayMs * Math.pow(2, attempt);
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        `LLM transient error (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}. ` +
        `Retrying in ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Configuration helper
// ---------------------------------------------------------------------------

/**
 * Get the full resolved LLM configuration (for logging/debugging).
 */
export function getLLMConfigResolved(config?: LLMConfig): {
  provider: LLMProvider;
  model: string;
  available: boolean;
  complexProvider: LLMProvider | null;
  complexModel: string | null;
  complexAvailable: boolean;
} {
  const complexProvider = getComplexLLMProvider();
  return {
    provider: getLLMProvider(config),
    model: getLLMModelName(config),
    available: isLLMAvailable(config),
    complexProvider,
    complexModel: complexProvider ? getComplexLLMModelName() : null,
    complexAvailable: isComplexLLMAvailable(),
  };
}
