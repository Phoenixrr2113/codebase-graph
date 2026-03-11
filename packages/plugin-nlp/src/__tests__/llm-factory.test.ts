/**
 * LLM Factory — Unit Tests
 *
 * Tests the centralized LLM model factory (llm.ts).
 * Tests provider detection, model name resolution, and availability checks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getLLMProvider,
  getLLMModelName,
  isLLMAvailable,
  getLLMConfigResolved,
  type LLMConfig,
} from '../llm';

// ============================================================================
// Provider detection
// ============================================================================

describe('getLLMProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should default to openrouter', () => {
    delete process.env['LLM_PROVIDER'];
    expect(getLLMProvider()).toBe('openrouter');
  });

  it('should use config.provider when specified', () => {
    expect(getLLMProvider({ provider: 'ollama' })).toBe('ollama');
    expect(getLLMProvider({ provider: 'openrouter' })).toBe('openrouter');
  });

  it('should read LLM_PROVIDER env var', () => {
    process.env['LLM_PROVIDER'] = 'ollama';
    expect(getLLMProvider()).toBe('ollama');
  });

  it('should prefer config over env var', () => {
    process.env['LLM_PROVIDER'] = 'ollama';
    expect(getLLMProvider({ provider: 'openrouter' })).toBe('openrouter');
  });
});

// ============================================================================
// Model name resolution
// ============================================================================

describe('getLLMModelName', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should default to openrouter default model', () => {
    delete process.env['LLM_MODEL'];
    delete process.env['LLM_PROVIDER'];
    const name = getLLMModelName();
    expect(name).toBe('google/gemini-2.5-flash');
  });

  it('should use ollama default model when provider is ollama', () => {
    delete process.env['LLM_MODEL'];
    const name = getLLMModelName({ provider: 'ollama' });
    expect(name).toBe('llama3.2');
  });

  it('should use config.model when specified', () => {
    const name = getLLMModelName({ model: 'anthropic/claude-sonnet-4' });
    expect(name).toBe('anthropic/claude-sonnet-4');
  });

  it('should read LLM_MODEL env var', () => {
    process.env['LLM_MODEL'] = 'my-custom-model';
    const name = getLLMModelName();
    expect(name).toBe('my-custom-model');
  });

  it('should prefer config.model over env var', () => {
    process.env['LLM_MODEL'] = 'env-model';
    const name = getLLMModelName({ model: 'config-model' });
    expect(name).toBe('config-model');
  });
});

// ============================================================================
// Availability check
// ============================================================================

describe('isLLMAvailable', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return true for openrouter when API key is set', () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    expect(isLLMAvailable()).toBe(true);
  });

  it('should return false for openrouter when API key is missing', () => {
    delete process.env['OPENROUTER_API_KEY'];
    expect(isLLMAvailable()).toBe(false);
  });

  it('should always return true for ollama (local service)', () => {
    delete process.env['OPENROUTER_API_KEY'];
    expect(isLLMAvailable({ provider: 'ollama' })).toBe(true);
  });
});

// ============================================================================
// Config resolution
// ============================================================================

describe('getLLMConfigResolved', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return full resolved config', () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    delete process.env['LLM_PROVIDER'];
    delete process.env['LLM_MODEL'];

    const config = getLLMConfigResolved();
    expect(config.provider).toBe('openrouter');
    expect(config.model).toBe('google/gemini-2.5-flash');
    expect(config.available).toBe(true);
  });

  it('should reflect overrides', () => {
    delete process.env['OPENROUTER_API_KEY'];
    const config = getLLMConfigResolved({
      provider: 'ollama',
      model: 'llama3.2',
    });
    expect(config.provider).toBe('ollama');
    expect(config.model).toBe('llama3.2');
    expect(config.available).toBe(true);
  });
});
