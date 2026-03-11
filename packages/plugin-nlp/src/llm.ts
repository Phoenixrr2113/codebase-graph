/**
 * Centralized LLM Model Factory
 *
 * Provides a single place to configure and obtain LanguageModel instances
 * for use across the plugin-nlp package (entity extraction, conflict
 * resolution, entity resolution, and WS12 search types).
 *
 * Supports multiple providers:
 *   - openrouter (default): Uses @openrouter/ai-sdk-provider
 *   - ollama: Uses @ai-sdk/openai-compatible pointed at localhost:11434
 *
 * Configuration via env vars:
 *   LLM_PROVIDER       — "openrouter" | "ollama" (default: "openrouter")
 *   LLM_MODEL           — model name override (default: provider-specific)
 *   OPENROUTER_API_KEY  — required for openrouter provider
 *   OLLAMA_BASE_URL     — override Ollama URL (default: http://localhost:11434)
 *
 * Usage:
 *   import { getLLMModel, getLLMConfig } from './llm';
 *   const model = getLLMModel();  // returns configured LanguageModel
 *   const model = getLLMModel({ provider: 'ollama', model: 'llama3' });
 */

import { createLogger } from '@codegraph/logger';
import type { LanguageModel } from 'ai';

const logger = createLogger({ namespace: 'nlp:llm' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProvider = 'openrouter' | 'ollama';

export interface LLMConfig {
  /** Which LLM provider to use. Default: from LLM_PROVIDER env or 'openrouter' */
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
  openrouter: 'google/gemini-2.5-flash',
  ollama: 'llama3.2',
};

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
  if (envProvider === 'ollama') return 'ollama';
  return 'openrouter';
}

/**
 * Get the configured model name from env or config.
 */
export function getLLMModelName(config?: LLMConfig): string {
  if (config?.model) return config.model;
  const envModel = process.env['LLM_MODEL'];
  if (envModel) return envModel;
  return DEFAULT_MODELS[getLLMProvider(config)];
}

/**
 * Check if an LLM provider is available (has required credentials/services).
 */
export function isLLMAvailable(config?: LLMConfig): boolean {
  const provider = getLLMProvider(config);
  if (provider === 'openrouter') {
    return !!process.env['OPENROUTER_API_KEY'];
  }
  // Ollama is assumed available if provider is set (local service)
  return true;
}

/**
 * Get a configured LanguageModel instance.
 *
 * Returns a model from the configured provider. Caches provider instances
 * (not model instances) to avoid redundant initialization.
 *
 * @param config - Optional configuration override
 * @returns A LanguageModel ready for use with generateText/generateObject
 * @throws Error if required credentials are missing
 *
 * @example
 * ```typescript
 * // Default: OpenRouter with gemini-2.5-flash
 * const model = await getLLMModel();
 *
 * // Explicit Ollama
 * const model = await getLLMModel({ provider: 'ollama', model: 'llama3.2' });
 *
 * // Override model
 * const model = await getLLMModel({ model: 'anthropic/claude-sonnet-4' });
 * ```
 */
export async function getLLMModel(config?: LLMConfig): Promise<LanguageModel> {
  const provider = getLLMProvider(config);
  const modelName = getLLMModelName(config);

  logger.debug(`getLLMModel: provider=${provider}, model=${modelName}`);

  if (provider === 'ollama') {
    return getOllamaModel(modelName, config?.baseURL);
  }

  // Default: OpenRouter
  return getOpenRouterModel(modelName);
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
} {
  return {
    provider: getLLMProvider(config),
    model: getLLMModelName(config),
    available: isLLMAvailable(config),
  };
}
