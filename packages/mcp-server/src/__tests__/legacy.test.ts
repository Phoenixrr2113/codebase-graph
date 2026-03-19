/**
 * Raw MCP Tool Tests
 *
 * Tests raw tools available via CODEGRAPH_RAW_TOOLS=1.
 * Runs against whichever backend is configured (.codegraph/config.json or env vars).
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { handleToolCall } from '../tools/router';
import { registerPlugins } from '@codegraph/core';
import {
  SRC_DIR,
  KNOWN_SYMBOL,
  KNOWN_FILE,
  teardownGraphClient,
  assertNoError,
} from './helpers';

beforeAll(() => {
  registerPlugins();
});

afterAll(async () => {
  await teardownGraphClient();
});

// ─── ping ────────────────────────────────────────────────────────────────────

describe('ping', () => {
  it('returns ok status', async () => {
    const result = (await handleToolCall('ping', {})) as Record<string, unknown>;
    expect(result.status).toBe('ok');
  });
});

// ─── search_code ─────────────────────────────────────────────────────────────

describe('search_code', () => {
  it('searches by name', async () => {
    const result = (await handleToolCall('search_code', {
      query: 'create',
    })) as Record<string, unknown>;

    assertNoError(result, 'search_code name');
    const results = result.results as unknown[];
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── query (Cypher) ──────────────────────────────────────────────────────────

describe('query (Cypher)', () => {
  it('executes Cypher and returns data', async () => {
    const result = (await handleToolCall('query', {
      cypher: 'MATCH (n:Function) RETURN n.name as name LIMIT 5',
    })) as Record<string, unknown>;

    assertNoError(result, 'query');
    expect(result.success).toBe(true);
    const data = result.data as unknown[];
    expect(data.length).toBeGreaterThan(0);
  });
});

// ─── trigger_reindex ─────────────────────────────────────────────────────────

describe('trigger_reindex', () => {
  it('returns error for non-existent scope path', async () => {
    const result = (await handleToolCall('trigger_reindex', {
      mode: 'incremental',
      scope: '/nonexistent/path/to/project',
    })) as Record<string, unknown>;

    // Should fail because path doesn't exist
    expect(result.success).toBe(false);
    const errors = result.errors as string[];
    expect(errors.length).toBeGreaterThan(0);
  });

  it('can index a single file', async () => {
    const result = (await handleToolCall('trigger_reindex', {
      mode: 'full',
      scope: KNOWN_FILE,
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.filesProcessed).toBe(1);
    expect((result.symbolsUpdated as number)).toBeGreaterThan(0);
  }, 30000);
});

// ─── error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws for unknown tool name', async () => {
    await expect(
      handleToolCall('nonexistent_legacy_tool', {})
    ).rejects.toThrow('Unknown tool');
  });
});
