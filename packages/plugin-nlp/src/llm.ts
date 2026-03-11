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
 * Supports multiple providers:
 *   - cerebras (default): Fast inference via Cerebras cloud
 *   - glm: Zhipu GLM models for complex reasoning
 *   - openrouter: Uses @openrouter/ai-sdk-provider
 *   - ollama: Uses @ai-sdk/openai-compatible pointed at localhost:11434
 *
 * Configuration via env vars:
 *   LLM_PROVIDER        — "cerebras" | "openrouter" | "ollama" (default: "cerebras")
 *   LLM_MODEL            — model name override (default: provider-specific)
 *   CEREBRAS_API_KEY     — required for cerebras provider
 *   CEREBRAS_MODEL       — cerebras model override (default: gpt-oss-120b)
 *   GLM_API_KEY          — required for glm complex model
 *   GLM_MODEL            — glm model override (default: GLM-4.7)
 *   OPENROUTER_API_KEY   — required for openrouter provider
 *   OLLAMA_BASE_URL      — override Ollama URL (default: http://localhost:11434)
 *
 * Usage:
 *   import { getLLMModel, getLLMComplexModel } from './llm';
 *   const model = await getLLMModel();         // Cerebras gpt-oss-120b (fast)
 *   const complex = await getLLMComplexModel(); // GLM-4.7 (deep reasoning)
 */

import { createLogger } from '@codegraph/logger';
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
  cerebras: 'gpt-oss-120b',
  glm: 'GLM-4.7',
  openrouter: 'google/gemini-2.5-flash',
  ollama: 'llama3.2',
};

const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
// GLM Coding plan uses a different endpoint than the standard API
const GLM_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';

// ---------------------------------------------------------------------------
// Provider singletons (lazy-initialized)
// ---------------------------------------------------------------------------

let _openrouterProvider: unknown | null = null;

async function getOpenRouterProvider(): Promise<unknown> {
  if (!_openrouterProvider) {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    _openrouterProvider = createOpenRouter();
  }
  return _openrouterProvider;
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
 * Check if the complex LLM (GLM) is available.
 */
export function isComplexLLMAvailable(): boolean {
  return !!process.env['GLM_API_KEY'];
}

/**
 * Get a configured LanguageModel instance (default tier — fast inference).
 *
 * Returns a model from the configured provider. Caches provider instances
 * (not model instances) to avoid redundant initialization.
 *
 * @param config - Optional configuration override
 * @returns A LanguageModel ready for use with generateText/generateObject
 * @throws Error if required credentials are missing
 */
export async function getLLMModel(config?: LLMConfig): Promise<LanguageModel> {
  const provider = getLLMProvider(config);
  const modelName = getLLMModelName(config);

  logger.debug(`getLLMModel: provider=${provider}, model=${modelName}`);

  if (provider === 'cerebras') {
    return getCerebrasModel(modelName, config?.baseURL);
  }
  if (provider === 'glm') {
    return getGLMModel(modelName, config?.baseURL);
  }
  if (provider === 'ollama') {
    return getOllamaModel(modelName, config?.baseURL);
  }

  // Default: OpenRouter
  return getOpenRouterModel(modelName);
}

/**
 * Get the complex-tier LanguageModel (GLM) for multi-step reasoning.
 *
 * Used by strategies that need deeper reasoning: GRAPH_ANSWER, CONTEXT_WALK.
 * Falls back to the default model if GLM is not configured.
 *
 * @returns GLM LanguageModel, or null if not configured
 */
export async function getLLMComplexModel(): Promise<LanguageModel | null> {
  if (!process.env['GLM_API_KEY']) {
    logger.debug('GLM not configured, complex model unavailable');
    return null;
  }

  const modelName = process.env['GLM_MODEL'] || DEFAULT_MODELS.glm;
  logger.debug(`getLLMComplexModel: provider=glm, model=${modelName}`);
  return getGLMModel(modelName);
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
// Configuration helper
// ---------------------------------------------------------------------------

/**
 * Get the full resolved LLM configuration (for logging/debugging).
 */
export function getLLMConfigResolved(config?: LLMConfig): {
  provider: LLMProvider;
  model: string;
  available: boolean;
  complexAvailable: boolean;
} {
  return {
    provider: getLLMProvider(config),
    model: getLLMModelName(config),
    available: isLLMAvailable(config),
    complexAvailable: isComplexLLMAvailable(),
  };
}
