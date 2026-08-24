/**
 * Raw MCP Tool Tests
 *
 * Tests raw tools available via CODEGRAPH_RAW_TOOLS=1.
 * Runs against whichever backend is configured (.codegraph/config.json or env vars).
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleToolCall } from '../tools/router';
import { registerPlugins } from '@codegraph/core';
import { reindexToolDefinition, triggerReindex } from '../tools/reindex';
import { teardownGraphClient, assertNoError } from './helpers';

let fixtureDirectory: string;
let fixtureFile: string;
let previousEmbeddingProvider: string | undefined;

beforeAll(async () => {
  previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'local';
  registerPlugins();
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'codegraph-mcp-raw-'));
  const sourceDirectory = join(fixtureDirectory, 'src');
  mkdirSync(sourceDirectory);
  fixtureFile = join(sourceDirectory, 'legacy-widget.ts');
  writeFileSync(
    fixtureFile,
    'export function createLegacyWidget(): string { return "legacy-widget"; }\n',
  );

  const result = await triggerReindex({
    scope: fixtureDirectory,
    mode: 'full',
    deferEmbeddings: false,
  });
  if (!result.success) {
    throw new Error(`Unable to index raw tool fixture: ${result.errors.join('; ')}`);
  }
});

afterAll(async () => {
  await teardownGraphClient();
  if (previousEmbeddingProvider === undefined) {
    delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  } else {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
  }
  rmSync(fixtureDirectory, { recursive: true, force: true });
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
  it('exposes and validates the persisted history window inputs', async () => {
    expect(reindexToolDefinition.inputSchema.properties).toHaveProperty('historySince');
    expect(reindexToolDefinition.inputSchema.properties).toHaveProperty('historyMaxCommits');

    const result = await triggerReindex({
      mode: 'incremental',
      scope: fixtureDirectory,
      historySince: '2026-02-30',
      historyMaxCommits: 0,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('historySince'),
    ]));
  });

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
  ])('rejects impossible raw history timestamp %s before indexing', async (historySince) => {
    const result = await triggerReindex({
      mode: 'incremental',
      scope: fixtureDirectory,
      historySince,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['historySince must be a valid ISO 8601 date or timestamp']);
  });

  it('accepts a valid leap-day raw history timestamp', async () => {
    const result = await triggerReindex({
      mode: 'incremental',
      scope: fixtureDirectory,
      historySince: '2024-02-29T00:00:00Z',
    });

    expect(result.success).toBe(true);
  });

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
      scope: fixtureFile,
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
