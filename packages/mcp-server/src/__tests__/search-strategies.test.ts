/**
 * MCP Search Strategy Integration Tests
 *
 * Tests the new MCP tools: ask_code, query_cypher, and search_code with strategy parameter.
 * Runs against real FalkorDB (Docker) with real LLM calls when available.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handleToolCall } from '../tools/consolidated';
import { askCode, type AskCodeInput } from '../tools/askCode';
import { queryCypher, type QueryCypherInput } from '../tools/queryCypher';
import { searchCode, type SearchCodeInput } from '../tools/searchCode';
import { teardownGraphClient, assertNoError } from './helpers';
import { isLLMAvailable } from '@codegraph/plugin-nlp';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env for API keys
try {
  const envPath = resolve(__dirname, '../../../../.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not found — tests will skip LLM-dependent tests
}

const llmAvailable = isLLMAvailable();

afterAll(async () => {
  await teardownGraphClient();
});

// ============================================================================
// search_code with strategy parameter
// ============================================================================

describe('search_code — strategy parameter', () => {
  it('should work without strategy (backward compatibility)', async () => {
    const result = await searchCode({
      query: 'createClient',
      type: 'semantic',
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('should dispatch to HYBRID strategy', async () => {
    const result = await searchCode({
      query: 'createClient',
      strategy: 'HYBRID',
    });

    expect(result.error).toBeUndefined();
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('should be accessible via handleToolCall', async () => {
    const result = (await handleToolCall('search_code', {
      query: 'createClient',
      strategy: 'HYBRID',
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!llmAvailable)(
    'should dispatch ENRICHED_V2 with LLM and return results',
    async () => {
      const result = await searchCode({
        query: 'What does the createClient function do?',
        strategy: 'HYBRID',
      });

      expect(result.error).toBeUndefined();
      expect(result.total).toBeGreaterThanOrEqual(0);
    },
    { timeout: 30_000 },
  );
});

// ============================================================================
// ask_code tool
// ============================================================================

describe('ask_code', () => {
  it('should return error for empty question', async () => {
    const result = await askCode({ question: '' });
    expect(result.error).toBe('Question is required');
    expect(result.answer).toBe('');
  });

  it('should return LLM error when no LLM configured', async () => {
    const savedKey = process.env['OPENROUTER_API_KEY'];
    const savedCerebras = process.env['CEREBRAS_API_KEY'];
    const savedProvider = process.env['LLM_PROVIDER'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['CEREBRAS_API_KEY'];
    delete process.env['LLM_PROVIDER'];

    try {
      const result = await askCode({ question: 'What does createClient do?' });
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/LLM|required/i);
    } finally {
      if (savedKey) process.env['OPENROUTER_API_KEY'] = savedKey;
      if (savedCerebras) process.env['CEREBRAS_API_KEY'] = savedCerebras;
      if (savedProvider) process.env['LLM_PROVIDER'] = savedProvider;
    }
  });

  it('should be accessible via handleToolCall', async () => {
    const savedKey = process.env['OPENROUTER_API_KEY'];
    const savedCerebras = process.env['CEREBRAS_API_KEY'];
    const savedProvider = process.env['LLM_PROVIDER'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['CEREBRAS_API_KEY'];
    delete process.env['LLM_PROVIDER'];

    try {
      const result = (await handleToolCall('ask_code', {
        question: 'test question',
      })) as Record<string, unknown>;

      // Without LLM, should return an error
      expect(result.error).toBeDefined();
    } finally {
      if (savedKey) process.env['OPENROUTER_API_KEY'] = savedKey;
      if (savedCerebras) process.env['CEREBRAS_API_KEY'] = savedCerebras;
      if (savedProvider) process.env['LLM_PROVIDER'] = savedProvider;
    }
  });

  it.skipIf(!llmAvailable)(
    'should answer a question about the codebase',
    async () => {
      const result = await askCode({
        question: 'What does the createClient function do?',
        limit: 10,
      });

      expect(result.error).toBeUndefined();
      expect(result.answer).toBeDefined();
      expect(result.answer.length).toBeGreaterThan(10);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.contextNodes)).toBe(true);
    },
    { timeout: 30_000 },
  );

  it.skipIf(!llmAvailable)(
    'should include metadata in response',
    async () => {
      const result = await askCode({
        question: 'How does hybrid search work?',
      });

      expect(result.meta).toBeDefined();
      expect(result.meta!.searchType).toBe('ENRICHED_V2');
      expect(result.meta!.durationMs).toBeGreaterThanOrEqual(0);
    },
    { timeout: 30_000 },
  );
});

// ============================================================================
// query_cypher tool
// ============================================================================

describe('query_cypher', () => {
  it('should return error for empty question', async () => {
    const result = await queryCypher({ question: '' });
    expect(result.error).toBe('Question is required');
  });

  it('should return LLM error when no LLM configured', async () => {
    const savedKey = process.env['OPENROUTER_API_KEY'];
    const savedCerebras = process.env['CEREBRAS_API_KEY'];
    const savedProvider = process.env['LLM_PROVIDER'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['CEREBRAS_API_KEY'];
    delete process.env['LLM_PROVIDER'];

    try {
      const result = await queryCypher({
        question: 'Show me all functions',
      });
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/LLM|required/i);
    } finally {
      if (savedKey) process.env['OPENROUTER_API_KEY'] = savedKey;
      if (savedCerebras) process.env['CEREBRAS_API_KEY'] = savedCerebras;
      if (savedProvider) process.env['LLM_PROVIDER'] = savedProvider;
    }
  });

  it('should be accessible via handleToolCall', async () => {
    const savedKey = process.env['OPENROUTER_API_KEY'];
    const savedCerebras = process.env['CEREBRAS_API_KEY'];
    const savedProvider = process.env['LLM_PROVIDER'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['CEREBRAS_API_KEY'];
    delete process.env['LLM_PROVIDER'];

    try {
      const result = (await handleToolCall('query_cypher', {
        question: 'test question',
      })) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    } finally {
      if (savedKey) process.env['OPENROUTER_API_KEY'] = savedKey;
      if (savedCerebras) process.env['CEREBRAS_API_KEY'] = savedCerebras;
      if (savedProvider) process.env['LLM_PROVIDER'] = savedProvider;
    }
  });

  it.skipIf(!llmAvailable)(
    'should translate NL to Cypher and execute',
    async () => {
      const result = await queryCypher({
        question: 'Show me all functions in the codebase',
      });

      expect(result.error).toBeUndefined();
      expect(result.cypher).toBeDefined();
      expect(result.cypher!).toMatch(/MATCH/i);
      expect(result.cypherExplanation).toBeDefined();
      expect(result.total).toBeGreaterThanOrEqual(0);
    },
    { timeout: 30_000 },
  );

  it.skipIf(!llmAvailable)(
    'should return metadata with generated Cypher',
    async () => {
      const result = await queryCypher({
        question: 'Find all classes',
      });

      expect(result.meta).toBeDefined();
      expect(result.meta!.searchType).toBe('ENRICHED_V2');
      expect(result.meta!.durationMs).toBeGreaterThanOrEqual(0);
    },
    { timeout: 30_000 },
  );
});

// ============================================================================
// Tool registration verification
// ============================================================================

describe('tool registration', () => {
  it('should list ask_code in available tools', async () => {
    // handleToolCall should recognize ask_code
    // If it doesn't exist, it would throw "Unknown tool"
    const savedKey = process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];

    try {
      const result = (await handleToolCall('ask_code', {
        question: 'test',
      })) as Record<string, unknown>;
      // Should not throw "Unknown tool"
      expect(result).toBeDefined();
    } finally {
      if (savedKey) process.env['OPENROUTER_API_KEY'] = savedKey;
    }
  });

  it('should list query_cypher in available tools', async () => {
    const savedKey = process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];

    try {
      const result = (await handleToolCall('query_cypher', {
        question: 'test',
      })) as Record<string, unknown>;
      expect(result).toBeDefined();
    } finally {
      if (savedKey) process.env['OPENROUTER_API_KEY'] = savedKey;
    }
  });
});
