/**
 * Legacy MCP Tool Tests
 *
 * Tests all legacy tools that complement the consolidated tools.
 * Runs against whichever backend is configured (.codegraph/config.json or env vars).
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { handleToolCall } from '../tools/consolidated';
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

describe('legacy ping', () => {
  it('returns ok status', async () => {
    const result = (await handleToolCall('ping', {})) as Record<string, unknown>;
    expect(result.status).toBe('ok');
  });
});

// ─── find_symbol ─────────────────────────────────────────────────────────────

describe('find_symbol', () => {
  it('finds a known symbol (any kind)', async () => {
    const result = (await handleToolCall('find_symbol', {
      name: KNOWN_SYMBOL,
    })) as Record<string, unknown>;

    assertNoError(result, 'find_symbol any');
    expect(result.found).toBe(true);
    const sym = result.symbol as Record<string, unknown>;
    expect(sym.name).toBe(KNOWN_SYMBOL);
    expect(sym.kind).toBe('function');
  });

  it('finds with kind filter', async () => {
    const result = (await handleToolCall('find_symbol', {
      name: KNOWN_SYMBOL,
      kind: 'function',
    })) as Record<string, unknown>;

    assertNoError(result, 'find_symbol function');
    expect(result.found).toBe(true);
  });

  it('finds with file scope', async () => {
    const result = (await handleToolCall('find_symbol', {
      name: KNOWN_SYMBOL,
      file: KNOWN_FILE,
    })) as Record<string, unknown>;

    assertNoError(result, 'find_symbol + file');
    expect(result.found).toBe(true);
    const sym = result.symbol as Record<string, unknown>;
    expect(sym.file).toBe(KNOWN_FILE);
  });

  it('returns not-found for missing symbol', async () => {
    const result = (await handleToolCall('find_symbol', {
      name: 'xyzNonexistent999',
    })) as Record<string, unknown>;

    // Either found=false or error containing "not found"
    const errStr = result.error ? String(result.error) : '';
    expect(
      result.found === false ||
      errStr.includes('not found') ||
      errStr.includes('No symbol found')
    ).toBe(true);
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

  it('searches by fulltext', async () => {
    const result = (await handleToolCall('search_code', {
      query: 'client',
      type: 'fulltext',
    })) as Record<string, unknown>;

    assertNoError(result, 'search_code fulltext');
    const results = result.results as unknown[];
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── get_index_status ────────────────────────────────────────────────────────

describe('get_index_status', () => {
  it('returns database statistics', async () => {
    const result = (await handleToolCall('get_index_status', {})) as Record<string, unknown>;

    assertNoError(result, 'get_index_status');
    expect(result.status).toBe('ready');
    expect(typeof result.totalFiles).toBe('number');
    expect(typeof result.totalFunctions).toBe('number');
    expect((result.totalFiles as number)).toBeGreaterThan(0);
    expect((result.totalFunctions as number)).toBeGreaterThan(0);
  });
});

// ─── complexity_report ───────────────────────────────────────────────────────

describe('complexity_report', () => {
  it('returns hotspots above threshold', async () => {
    const result = (await handleToolCall('get_complexity_report', {
      threshold: 5,
    })) as Record<string, unknown>;

    assertNoError(result, 'complexity_report');
    const hotspots = result.hotspots as Array<Record<string, unknown>>;
    expect(Array.isArray(hotspots)).toBe(true);
    // With real complexity data, we should have some hotspots
    expect(hotspots.length).toBeGreaterThan(0);
    // Validate hotspot shape
    for (const h of hotspots) {
      expect(h.name).toBeDefined();
      expect(h.file).toBeDefined();
      expect(typeof h.complexity).toBe('number');
      expect((h.complexity as number)).toBeGreaterThanOrEqual(5);
    }
  });
});

// ─── analyze_impact ──────────────────────────────────────────────────────────

describe('analyze_impact', () => {
  it('returns impact analysis for a known symbol', async () => {
    const result = (await handleToolCall('analyze_impact', {
      symbol: KNOWN_SYMBOL,
    })) as Record<string, unknown>;

    assertNoError(result, 'analyze_impact');
    expect(result.riskScore).toBeDefined();
    expect(result.riskLevel).toBeDefined();
    expect(Array.isArray(result.directCallers)).toBe(true);
    expect(Array.isArray(result.affectedFiles)).toBe(true);
  });
});

// ─── get_repo_map ────────────────────────────────────────────────────────────

describe('get_repo_map', () => {
  it('returns a repo map with symbols and files', async () => {
    const result = (await handleToolCall('get_repo_map', {
      maxTokens: 1024,
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(typeof result.map).toBe('string');
    expect(result.filesIncluded).toBeGreaterThan(0);
    expect(result.symbolsIncluded).toBeGreaterThan(0);
    expect((result.map as string)).toContain('# Repository Map');
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

// ─── symbol_history ──────────────────────────────────────────────────────────

describe('symbol_history', () => {
  it('returns history for a known symbol', async () => {
    const result = (await handleToolCall('get_symbol_history', {
      symbol: KNOWN_SYMBOL,
    })) as Record<string, unknown>;

    assertNoError(result, 'symbol_history');
    expect(result.symbol).toBe(KNOWN_SYMBOL);
    expect(result.file).toBeDefined();
  });
});

// ─── explain_code ────────────────────────────────────────────────────────────

describe('explain_code', () => {
  it('returns code explanation for a known file', async () => {
    const result = (await handleToolCall('explain_code', {
      file: KNOWN_FILE,
    })) as Record<string, unknown>;

    assertNoError(result, 'explain_code');
    expect(result.code).toBeDefined();
    expect(typeof result.code).toBe('string');
    expect((result.code as string).length).toBeGreaterThan(0);
  });
});

// ─── trace_data_flow ─────────────────────────────────────────────────────────

describe('trace_data_flow', () => {
  it('returns flow analysis', async () => {
    const result = (await handleToolCall('trace_data_flow', {
      source: KNOWN_SYMBOL,
      file: KNOWN_FILE,
    })) as Record<string, unknown>;

    assertNoError(result, 'trace_data_flow');
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.paths)).toBe(true);
  });
});

// ─── find_vulnerabilities ────────────────────────────────────────────────────

describe('find_vulnerabilities', () => {
  it('returns vulnerability scan results', async () => {
    const result = (await handleToolCall('find_vulnerabilities', {})) as Record<string, unknown>;

    assertNoError(result, 'find_vulnerabilities');
    expect(Array.isArray(result.vulnerabilities)).toBe(true);
    // Should have at least some results from the test data
  });
});

// ─── analyze_refactoring ─────────────────────────────────────────────────────

describe('analyze_refactoring', () => {
  it('returns refactoring suggestions for a known file', async () => {
    const result = (await handleToolCall('analyze_file_for_refactoring', {
      file: KNOWN_FILE,
    })) as Record<string, unknown>;

    assertNoError(result, 'analyze_refactoring');
    expect(result.file).toBe(KNOWN_FILE);
    expect(typeof result.totalFunctions).toBe('number');
    expect(Array.isArray(result.extractionCandidates)).toBe(true);
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

// ─── unknown tool ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws for unknown tool name', async () => {
    await expect(
      handleToolCall('nonexistent_legacy_tool', {})
    ).rejects.toThrow('Unknown tool');
  });
});
