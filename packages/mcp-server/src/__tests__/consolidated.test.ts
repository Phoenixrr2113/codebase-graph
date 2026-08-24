/**
 * Consolidated MCP Tool Tests
 *
 * Tests the 5 public persona tools against an isolated indexed fixture.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleToolCall } from '../tools/router';
import { setActiveProjects } from '@codegraph/core';
import { triggerReindex } from '../tools/reindex';
import { teardownGraphClient, assertNoError } from './helpers';
import { personaToolDefinitions } from '../personas';

let fixtureDirectory: string;
let fixtureFile: string;
let previousEmbeddingProvider: string | undefined;

describe('public persona tools', () => {
  it('registers exactly the five canonical persona names', () => {
    expect(personaToolDefinitions.map((tool) => tool.name)).toEqual([
      'search',
      'knowledge',
      'codebase',
      'query',
      'analyze',
    ]);

    const actionCount = personaToolDefinitions.reduce((total, tool) => {
      const actionSchema = tool.inputSchema.properties.action as { enum?: unknown[] } | undefined;
      return total + (actionSchema?.enum?.length ?? 1);
    }, 0);
    expect(actionCount).toBe(25);
  });
});

beforeAll(async () => {
  previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'local';
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'codegraph-mcp-personas-'));
  const sourceDirectory = join(fixtureDirectory, 'src');
  mkdirSync(sourceDirectory);
  fixtureFile = join(sourceDirectory, 'widget.ts');
  writeFileSync(
    fixtureFile,
    [
      'export class Widget {}',
      'export function buildWidget(): Widget {',
      '  return new Widget();',
      '}',
    ].join('\n'),
  );

  await setActiveProjects([fixtureDirectory]);
  const result = await triggerReindex({
    scope: fixtureDirectory,
    mode: 'full',
    deferEmbeddings: false,
  });
  if (!result.success) {
    throw new Error(`Unable to index MCP persona fixture: ${result.errors.join('; ')}`);
  }
});

afterAll(async () => {
  await setActiveProjects([]);
  await teardownGraphClient();
  if (previousEmbeddingProvider === undefined) {
    delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  } else {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
  }
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

// ─── ping ────────────────────────────────────────────────────────────────────

describe('codebase persona', () => {
  it('returns ok status with timestamp', async () => {
    const result = (await handleToolCall('codebase', {
      action: 'ping',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.message).toContain('running');
    expect(result.timestamp).toBeDefined();
  });

  it('returns status with active projects', async () => {
    const result = (await handleToolCall('codebase', {
      action: 'configure',
      projectAction: 'status',
    })) as Record<string, unknown>;

    assertNoError(result, 'codebase configure status');
    expect(result.setupComplete).toBeDefined();
    expect(result.activeProjects).toEqual([fixtureDirectory]);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
  it('finds symbols in the indexed fixture', async () => {
    const result = (await handleToolCall('search', {
      action: 'find',
      query: 'buildWidget',
    })) as Record<string, unknown>;

    assertNoError(result, 'search find');
    expect(result.total).toBeGreaterThan(0);
    const results = result.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(result._meta).toMatchObject({ action: 'find', toolUsed: 'search_code' });
  });

  it('rejects an empty search query', async () => {
    const result = (await handleToolCall('search', {
      action: 'find',
      query: '   ',
    })) as Record<string, unknown>;

    expect(result.error).toContain('required');
    expect(result.total).toBe(0);
  });
});

// ─── search context ─────────────────────────────────────────────────────────

describe('search context', () => {
  it('returns file context with entities', async () => {
    const result = (await handleToolCall('search', {
      action: 'context',
      file: fixtureFile,
    })) as Record<string, unknown>;

    assertNoError(result, 'search context file');
    expect(result.file).toBeDefined();
    const file = result.file as Record<string, unknown>;
    expect(file.path).toBe(fixtureFile);
    expect(Array.isArray(file.entities)).toBe(true);
    expect((file.entities as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns symbol context with type and location', async () => {
    const result = (await handleToolCall('search', {
      action: 'context',
      symbol: 'buildWidget',
    })) as Record<string, unknown>;

    assertNoError(result, 'search context symbol');
    expect(result.entity).toBeDefined();
    const entity = result.entity as Record<string, unknown>;
    expect(entity.name).toBe('buildWidget');
    expect(entity.type).toBe('function');
    expect(typeof entity.startLine).toBe('number');
  });

  it('returns symbol context scoped to file', async () => {
    const result = (await handleToolCall('search', {
      action: 'context',
      symbol: 'buildWidget',
      file: fixtureFile,
    })) as Record<string, unknown>;

    assertNoError(result, 'search context symbol and file');
    const entity = result.entity as Record<string, unknown>;
    expect(entity.name).toBe('buildWidget');
    expect(entity.filePath).toBe(fixtureFile);
  });

  it('returns error for missing symbol', async () => {
    const result = (await handleToolCall('search', {
      action: 'context',
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

describe('analyze', () => {
  it('runs impact through the real service against the indexed fixture', async () => {
    const lookup = (await handleToolCall('query', {
      cypher: 'MATCH (f:Function {name: $name}) RETURN f.id AS id LIMIT 1',
      params: { name: 'buildWidget' },
    })) as Record<string, unknown>;
    assertNoError(lookup, 'lookup persisted fixture symbol id');
    const rows = lookup.data as Array<{ id: string }>;
    const id = rows[0]?.id;
    expect(id).toMatch(/^sym:v1:[a-f0-9]{64}$/);

    const result = (await handleToolCall('analyze', {
      action: 'impact',
      id,
      depth: 2,
      limit: 10,
    })) as Record<string, unknown>;

    assertNoError(result, 'analyze impact');
    expect(result.status).toBe('ok');
    expect(result.target).toMatchObject({ id, name: 'buildWidget' });
    expect(result.truncated).toBe(false);
    expect(result.caveats).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(result._meta).toMatchObject({ action: 'impact', toolUsed: 'getBlastRadius' });
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
