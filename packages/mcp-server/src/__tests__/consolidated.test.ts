/**
 * Consolidated MCP Tool Tests
 *
 * Tests the 5 consolidated tools: ping, configure_projects, search, get_context, query
 * Runs against whichever backend is configured (.codegraph/config.json or env vars).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { handleToolCall } from '../tools/router';
import {
  SRC_DIR,
  KNOWN_SYMBOL,
  KNOWN_FILE,
  teardownGraphClient,
  assertNoError,
} from './helpers';

afterAll(async () => {
  await teardownGraphClient();
});

// ─── ping ────────────────────────────────────────────────────────────────────

describe('ping', () => {
  it('returns ok status with timestamp', async () => {
    const result = (await handleToolCall('ping', {})) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.message).toContain('running');
    expect(result.timestamp).toBeDefined();
  });
});

// ─── configure_projects ──────────────────────────────────────────────────────

describe('configure_projects', () => {
  it('returns status with active projects', async () => {
    const result = (await handleToolCall('configure_projects', {
      action: 'status',
    })) as Record<string, unknown>;

    assertNoError(result, 'configure_projects status');
    expect(result.setupComplete).toBeDefined();
    // Should have at least the codebase-graph project
    expect(Array.isArray(result.activeProjects)).toBe(true);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
  it('finds symbols matching a keyword (all types)', async () => {
    const result = (await handleToolCall('search', {
      query: 'create',
    })) as Record<string, unknown>;

    assertNoError(result, 'search all');
    expect(result.total).toBeGreaterThan(0);
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    // Every result should have required fields
    for (const r of results) {
      expect(r.name).toBeDefined();
      expect(r.type).toBeDefined();
      expect(typeof r.type).toBe('string');
      expect((r.type as string).length).toBeGreaterThan(1); // not truncated
    }
  });

  it('filters by type: function', async () => {
    const result = (await handleToolCall('search', {
      query: 'build',
      type: 'function',
    })) as Record<string, unknown>;

    assertNoError(result, 'search function');
    const results = result.results as Array<Record<string, unknown>>;
    for (const r of results) {
      expect(r.type).toBe('Function');
    }
  });

  it('filters by type: file', async () => {
    const result = (await handleToolCall('search', {
      query: 'client',
      type: 'file',
    })) as Record<string, unknown>;

    assertNoError(result, 'search file');
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.type).toBe('File');
    }
  });

  it('returns empty results for nonexistent term', async () => {
    const result = (await handleToolCall('search', {
      query: 'xyzNonexistentTerm12345',
    })) as Record<string, unknown>;

    assertNoError(result, 'search empty');
    expect(result.total).toBe(0);
  });
});

// ─── get_context ─────────────────────────────────────────────────────────────

describe('get_context', () => {
  it('returns file context with entities', async () => {
    const result = (await handleToolCall('get_context', {
      file: KNOWN_FILE,
    })) as Record<string, unknown>;

    assertNoError(result, 'get_context file');
    expect(result.file).toBeDefined();
    const file = result.file as Record<string, unknown>;
    expect(file.path).toBe(KNOWN_FILE);
    expect(Array.isArray(file.entities)).toBe(true);
    expect((file.entities as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns symbol context with type and location', async () => {
    const result = (await handleToolCall('get_context', {
      symbol: KNOWN_SYMBOL,
    })) as Record<string, unknown>;

    assertNoError(result, 'get_context symbol');
    expect(result.entity).toBeDefined();
    const entity = result.entity as Record<string, unknown>;
    expect(entity.name).toBe(KNOWN_SYMBOL);
    expect(entity.type).toBe('Function');
    expect(typeof entity.startLine).toBe('number');
  });

  it('returns symbol context scoped to file', async () => {
    const result = (await handleToolCall('get_context', {
      symbol: KNOWN_SYMBOL,
      file: KNOWN_FILE,
    })) as Record<string, unknown>;

    assertNoError(result, 'get_context sym+file');
    const entity = result.entity as Record<string, unknown>;
    expect(entity.name).toBe(KNOWN_SYMBOL);
    expect(entity.filePath).toBe(KNOWN_FILE);
  });

  it('returns error for missing symbol', async () => {
    const result = (await handleToolCall('get_context', {
      symbol: 'xyzNonexistent999',
    })) as Record<string, unknown>;

    // Should return an error or empty result, not throw
    expect(
      result.error || (result.entity === undefined && result.file === undefined)
    ).toBeTruthy();
  });
});

// ─── query (raw Cypher) ──────────────────────────────────────────────────────

describe('query', () => {
  it('executes a MATCH query and returns rows', async () => {
    const result = (await handleToolCall('query', {
      cypher: 'MATCH (f:File) RETURN f.filePath as path LIMIT 3',
    })) as Record<string, unknown>;

    assertNoError(result, 'query files');
    expect(result.success).toBe(true);
    const data = result.data as unknown[];
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it('returns aggregate counts', async () => {
    const result = (await handleToolCall('query', {
      cypher: 'MATCH (n:Function) RETURN count(n) as cnt',
    })) as Record<string, unknown>;

    assertNoError(result, 'query count');
    const data = result.data as Array<Record<string, unknown>>;
    expect(data[0]!.cnt).toBeGreaterThan(0);
  });

  it('returns error for invalid Cypher', async () => {
    const result = (await handleToolCall('query', {
      cypher: 'THIS IS NOT VALID CYPHER',
    })) as Record<string, unknown>;

    // Should return error, not throw
    expect(result.error || result.success === false).toBeTruthy();
  });
});

// ─── unknown tool ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws for unknown tool name', async () => {
    await expect(
      handleToolCall('nonexistent_tool', {})
    ).rejects.toThrow('Unknown tool');
  });
});
